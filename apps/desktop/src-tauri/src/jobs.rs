//! The queue: one job at a time, each in its own folder, each state written to disk before anything
//! else happens (TZ §9.3). After a crash finished results are still finished, and a job that was
//! running says so instead of pretending it never started.

use crate::{
    assistant::Assistant,
    catalog::{self, Model, Runtime},
    glb, hardware,
    memory::{self, Verdict},
    packs,
    power::{self, After},
    provenance,
    store::{self, Store},
    sys, telemetry, tray,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Condvar, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

const MODEL_FILE: &str = "model.glb";
const PICTURE_FILE: &str = "picture.png";
const LOG_FILE: &str = "engine.log";
const LOG_TAIL: usize = 4000;
/// A run on a graphics card that says nothing for this long is stuck, not slow: progress bars and the
/// heartbeats of `--verbose` count as saying something. A processor is left alone: a stage can take hours.
const STALL_SECONDS: u64 = 1800;
/// How often memory is looked at while an engine runs: a model can take gigabytes a second while it loads.
const SAMPLE_EVERY: Duration = Duration::from_secs(1);
/// Under this share of the picture the cut found nothing to make a model of.
const EMPTY_PICTURE: f64 = 0.002;

type Failure = (String, String);

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct Job {
    pub id: String,
    /// The first job of what this one belongs to: variants and models of one start stay together
    pub thread: String,
    pub created: u64,
    /// "model": a picture to 3D. "picture": words to a picture.
    pub kind: String,
    pub title: String,
    pub prompt: String,
    /// The input's file name in the job folder
    pub input: String,
    pub model: String,
    pub device: String,
    pub preset: String,
    pub seed: u64,
    /// queued, preparing, running, finalizing, succeeded, failed, cancelled, interrupted
    pub state: String,
    /// What the engine is doing now, from its own reports
    pub stage: String,
    /// UNSUPPORTED_DEVICE, DRIVER_MISMATCH, PACKAGE_INCOMPLETE, DISK_FULL, GPU_OOM, HOST_OOM,
    /// INVALID_INPUT, NO_SUBJECT, ENGINE_CRASH, ENGINE_HANG, INVALID_OUTPUT
    pub error: String,
    pub detail: String,
    pub seconds: f64,
    /// When the engine got its turn, in seconds since 1970: the page counts from here, not from its opening
    pub started: u64,
    /// Its place in the queue: when it was lined up, in ms, or what a move gave it. Jobs from before it
    /// hold 0 and go by `created`.
    pub turn: u64,
    pub output: String,
    /// The step of the memory ladder it ran on: empty, model or sequential
    pub offload: String,
    /// The most main memory its engine took, in MB; on a Mac graphics memory too
    pub peak_mb: u64,
    /// What the person should know about how it went: see `job.note.*` in the page
    pub notes: Vec<String>,
    /// good or bad, if the person said
    pub rating: String,
}

#[derive(Default)]
struct Queue {
    jobs: Vec<Job>,
    active: Option<String>,
    /// What the computer does when the queue runs out (power.rs)
    after: After,
    /// The program is closing: nothing new starts, since its engine would outlive the program
    closing: bool,
}

pub struct Jobs {
    store: Arc<Store>,
    queue: Mutex<Queue>,
    wake: Condvar,
    cancel: AtomicBool,
    assistant: Arc<Assistant>,
}

/// A run ended: with nothing more waiting, what was chosen for after the queue comes due if the queue did
/// anything. One the person emptied by hand ends with them there, and the choice goes with it.
fn due(q: &mut Queue, waiting: bool, did: bool) -> Option<After> {
    if waiting {
        return None;
    }
    if !did {
        q.after = After::Nothing;
    }
    (q.after != After::Nothing).then_some(q.after)
}

/// Where a job stands in the queue: the engine takes the smallest first.
fn place(job: &Job) -> u64 {
    if job.turn > 0 { job.turn } else { job.created * 1000 }
}

fn is_active(state: &str) -> bool {
    matches!(state, "preparing" | "running" | "finalizing")
}

impl Jobs {
    /// Reads what is on disk; a job that was running when Polyzon Maker stopped becomes interrupted.
    pub fn open(store: Arc<Store>, assistant: Arc<Assistant>) -> Self {
        let jobs = store::read_each(&store.jobs(), "job.json");
        let this = Self { store, queue: Mutex::new(Queue { jobs, active: None, after: After::Nothing, closing: false }), wake: Condvar::new(), cancel: AtomicBool::new(false), assistant };
        let mut q = this.queue.lock().unwrap();
        for job in q.jobs.iter_mut().filter(|j| is_active(&j.state)) {
            telemetry::event(&this.store, "job_lost", &job.model, &job.device, &lost_code(job), 0.0);
            job.state = "interrupted".into();
            job.stage.clear();
            save(&this.store, job);
        }
        drop(q);
        this
    }

    pub fn list(&self) -> Vec<Job> {
        let mut jobs = self.queue.lock().unwrap().jobs.clone();
        jobs.sort_by_key(|j| std::cmp::Reverse(j.created));
        jobs
    }

    pub fn dir(&self, id: &str) -> Result<PathBuf, String> {
        store::safe_name(id)?;
        Ok(self.store.jobs().join(id))
    }

    /// Queues a job. The same `id` twice is one job (TZ §9.3).
    pub fn add(&self, mut job: Job) -> Result<Job, String> {
        let mut q = self.queue.lock().unwrap();
        if let Some(same) = q.jobs.iter().find(|j| j.id == job.id) {
            return Ok(same.clone());
        }
        if job.id.is_empty() {
            job.id = store::random_id();
        }
        if job.thread.is_empty() {
            job.thread = job.id.clone();
        }
        job.created = store::now();
        // after everything lined up so far, even when the clock says otherwise
        let now_ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64);
        job.turn = q.jobs.iter().map(place).max().map_or(now_ms, |last| now_ms.max(last + 1));
        job.state = "queued".into();
        save(&self.store, &job);
        q.jobs.push(job.clone());
        drop(q);
        self.wake.notify_all();
        Ok(job)
    }

    /// What the engine takes next: the first of the smallest place, as `waiting` lists them; nothing while
    /// paused or closing.
    fn next_in(&self, q: &Queue) -> Option<Job> {
        if q.closing || self.store.settings().queue_paused {
            return None;
        }
        q.jobs.iter().filter(|j| j.state == "queued").min_by_key(|j| place(j)).cloned()
    }

    #[cfg(test)]
    fn next(&self) -> Option<Job> {
        self.next_in(&self.queue.lock().unwrap())
    }

    /// Nothing new starts while it is on; what runs runs to its end. Kept in the settings, so a restart does not undo it.
    pub fn pause(&self, on: bool) -> Result<(), String> {
        let mut settings = self.store.settings();
        settings.queue_paused = on;
        self.store.save_settings(settings).map_err(|e| e.to_string())?;
        self.wake.notify_all();
        Ok(())
    }

    /// Sleep or shut down when the queue runs out, or not; only what this system offers.
    pub fn choose(&self, after: After) -> Result<(), String> {
        if !power::OFFERED.contains(&after) {
            return Err(format!("{after:?} is not offered here"));
        }
        self.queue.lock().unwrap().after = after;
        self.wake.notify_all();
        Ok(())
    }

    pub fn chosen(&self) -> After {
        self.queue.lock().unwrap().after
    }

    /// The minute before `after`: true when it went by with the choice still standing and nothing new in the
    /// queue, and the choice is then used up. A no, or another model lined up, ends it at once.
    fn hold_off(&self, after: After, grace: Duration) -> bool {
        let standing = |q: &mut Queue| q.after == after && !q.jobs.iter().any(|j| j.state == "queued");
        let (mut q, waited) = self.wake.wait_timeout_while(self.queue.lock().unwrap(), grace, standing).unwrap();
        let now = waited.timed_out() && standing(&mut q);
        if now {
            q.after = After::Nothing;
        }
        now
    }

    /// When the queue has run out: the choice comes due, with the window up and a minute to say no.
    fn after_queue(&self, app: &AppHandle, due: Option<After>) {
        let tell = |soon| crate::news(app, "after-queue", power::Plan::new(self.chosen(), soon));
        let Some(after) = due else { return tell(None) };
        tell(Some(power::GRACE));
        tray::show(app);
        let now = self.hold_off(after, power::GRACE);
        tell(None);
        if let (true, Err(e)) = (now, power::go(after)) {
            crate::news(app, "after-queue-failed", (after, e.to_string()));
        }
    }

    /// What waits, in the order the engine takes it.
    pub fn waiting(&self) -> Vec<Job> {
        let mut jobs: Vec<Job> = self.queue.lock().unwrap().jobs.iter().filter(|j| j.state == "queued").cloned().collect();
        jobs.sort_by_key(place); // stable: equal places keep the order they came in, as `work` takes them
        jobs
    }

    /// One place earlier or later for a waiting job; the jobs that changed, for the page. Nothing when it cannot go.
    pub fn shift(&self, id: &str, earlier: bool) -> Vec<Job> {
        let order: Vec<String> = self.waiting().into_iter().map(|j| j.id).collect();
        let Some(at) = order.iter().position(|j| j == id) else { return vec![] };
        let Some(other) = (if earlier { at.checked_sub(1) } else { Some(at + 1).filter(|&i| i < order.len()) }) else { return vec![] };
        let mut q = self.queue.lock().unwrap();
        let place_of = |id: &str| q.jobs.iter().find(|j| j.id == id).map_or(0, place);
        let (mine, theirs) = (place_of(&order[at]), place_of(&order[other]));
        // two jobs from before turns, made in one second, stand level: one apart, so the move shows
        let (mine, theirs) = if mine == theirs { (if earlier { mine.saturating_sub(1) } else { mine + 1 }, theirs) } else { (theirs, mine) };
        let mut changed = vec![];
        for job in q.jobs.iter_mut() {
            let turn = if job.id == order[at] { mine } else if job.id == order[other] { theirs } else { continue };
            job.turn = turn;
            save(&self.store, job);
            changed.push(job.clone());
        }
        changed
    }

    /// A finished model from elsewhere, a plugin's: it goes straight to the library.
    pub fn import(&self, title: &str, glb: &[u8]) -> Result<Job, String> {
        let id = store::random_id();
        store::write_atomic(&self.dir(&id)?.join("model.glb"), glb).map_err(|e| e.to_string())?;
        let job = Job {
            id: id.clone(),
            thread: id,
            created: store::now(),
            kind: "model".into(),
            title: title.into(),
            state: "succeeded".into(),
            output: "model.glb".into(),
            ..Default::default()
        };
        save(&self.store, &job);
        self.queue.lock().unwrap().jobs.push(job.clone());
        Ok(job)
    }

    /// The job, when it changed here; a running one stops and reports by itself.
    pub fn cancel(&self, id: &str) -> Option<Job> {
        let mut q = self.queue.lock().unwrap();
        if q.active.as_deref() == Some(id) {
            self.cancel.store(true, Ordering::Relaxed);
            return None;
        }
        let job = q.jobs.iter_mut().find(|j| j.id == id && j.state == "queued")?;
        job.state = "cancelled".into();
        save(&self.store, job);
        Some(job.clone())
    }

    /// What the person thought of a finished result. Saying it again changes it.
    pub fn rate(&self, id: &str, rating: &str) -> Option<Job> {
        if !matches!(rating, "good" | "bad") {
            return None;
        }
        let mut q = self.queue.lock().unwrap();
        let job = q.jobs.iter_mut().find(|j| j.id == id && j.state == "succeeded")?;
        job.rating = rating.into();
        save(&self.store, job);
        let job = job.clone();
        drop(q);
        telemetry::event(&self.store, "job_rated", &job.model, &job.device, &told(rating, &job), 0.0);
        Some(job)
    }

    /// The model of what runs now.
    pub fn running_model(&self) -> Option<String> {
        let q = self.queue.lock().unwrap();
        q.jobs.iter().find(|j| Some(&j.id) == q.active.as_ref()).map(|j| j.model.clone())
    }

    /// Is something running now? Closing the window asks first.
    pub fn busy(&self) -> bool {
        self.queue.lock().unwrap().active.is_some()
    }

    /// Stops what runs and what waits, and waits for it: the person quit, and said yes to losing them.
    pub fn stop(&self) {
        for job in self.queue.lock().unwrap().jobs.iter_mut().filter(|j| j.state == "queued") {
            job.state = "cancelled".into();
            save(&self.store, job);
        }
        self.close();
    }

    /// Stops what runs and starts nothing more, and waits for it, so that no engine outlives the program.
    /// What waits stays in line for the next start.
    pub fn close(&self) {
        let mut q = self.queue.lock().unwrap();
        q.closing = true;
        // under the lock the worker takes its next job with: a job taken just now is stopped too
        self.cancel.store(true, Ordering::Relaxed);
        drop(q);
        for _ in 0..40 {
            if !self.busy() {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    /// Back in the queue with the same input and settings.
    pub fn retry(&self, app: &AppHandle, id: &str) {
        let mut q = self.queue.lock().unwrap();
        if let Some(job) = q.jobs.iter_mut().find(|j| j.id == id && matches!(j.state.as_str(), "failed" | "cancelled" | "interrupted")) {
            job.state = "queued".into();
            job.error.clear();
            job.detail.clear();
            job.notes.clear();
            job.peak_mb = 0;
            save(&self.store, job);
            crate::news(app, "job", job.clone());
        }
        drop(q);
        self.wake.notify_all();
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        let path = self.dir(id)?;
        let mut q = self.queue.lock().unwrap();
        if q.active.as_deref() == Some(id) {
            return Err("the job is running".into());
        }
        // the folder first: a file in use must not leave a job that comes back after a restart
        match fs::remove_dir_all(path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.to_string()),
            _ => q.jobs.retain(|j| j.id != id),
        }
        Ok(())
    }

    fn update(&self, app: &AppHandle, id: &str, change: impl FnOnce(&mut Job)) {
        let mut q = self.queue.lock().unwrap();
        if let Some(job) = q.jobs.iter_mut().find(|j| j.id == id) {
            change(job);
            save(&self.store, job);
            crate::news(app, "job", job.clone());
        }
    }

    /// The worker: runs for as long as the app does.
    pub fn work(self: Arc<Self>, app: AppHandle) {
        std::thread::spawn(move || {
            let mut tally = tray::Tally::default();
            loop {
                let job = {
                    let mut q = self.queue.lock().unwrap();
                    loop {
                        if let Some(job) = self.next_in(&q) {
                            q.active = Some(job.id.clone());
                            // under the lock, as `cancel` and `close` set it: a stop that comes right after is not undone
                            self.cancel.store(false, Ordering::Relaxed);
                            break job;
                        }
                        q = self.wake.wait(q).unwrap();
                    }
                };
                let awake = sys::Awake::hold();
                let id = job.id.clone();
                self.run(&app, job);
                let (told, due) = {
                    let mut q = self.queue.lock().unwrap();
                    q.active = None;
                    let state = q.jobs.iter().find(|j| j.id == id).map_or("", |j| j.state.as_str());
                    let waiting = q.jobs.iter().any(|j| j.state == "queued");
                    let told = tally.after(state, waiting);
                    (told, due(&mut q, waiting, told.is_some()))
                };
                drop(awake);
                if let Some((done, failed)) = told {
                    tray::tell(&app, done, failed);
                }
                self.after_queue(&app, due);
            }
        });
    }

    fn run(&self, app: &AppHandle, job: Job) {
        let started = Instant::now();
        let id = job.id.clone();
        self.update(app, &id, |j| {
            j.state = "preparing".into();
            j.stage = "prepare".into();
            j.started = store::now();
        });
        let result = self.steps(app, &job);
        if let Ok(output) = &result {
            // the file says an AI made it; a file it cannot mark is still a good result
            let system = catalog::model(&job.model).map_or_else(|| job.model.clone(), |m| m.name);
            let _ = provenance::mark(&self.store.jobs().join(&id).join(output), &provenance::Made::now(&system));
        }
        let seconds = started.elapsed().as_secs_f64();
        // a result that stands is done, though a stop came for what ran after it (second_try)
        let cancelled = result.is_err() && self.cancel.load(Ordering::Relaxed);
        let closing = self.queue.lock().unwrap().closing;
        let settings_error = match &result {
            Err(e) if !cancelled => Some(e.clone()),
            _ => None,
        };
        let mut lost = String::new();
        self.update(app, &id, |j| {
            j.seconds = seconds;
            lost = lost_code(j);
            j.stage.clear();
            match result {
                Ok(output) => {
                    j.state = "succeeded".into();
                    j.output = output;
                }
                Err((code, detail)) => {
                    j.state = ended(cancelled, closing).into();
                    if !cancelled {
                        j.error = code;
                        j.detail = detail;
                    }
                }
            }
        });
        let (event, code) = match settings_error {
            Some((code, detail)) => ("job_failed", self.how_it_went(&id, &failure_code(&code, &detail))),
            // as a run the program closed under is told at the next start (Jobs::open)
            None if cancelled && closing => ("job_lost", lost),
            None if cancelled => ("job_cancelled", String::new()),
            None => ("job_done", self.how_it_went(&id, "")),
        };
        telemetry::event(&self.store, event, &job.model, &job.device, &code, seconds);
    }

    fn how_it_went(&self, id: &str, first: &str) -> String {
        self.queue.lock().unwrap().jobs.iter().find(|j| j.id == id).map_or_else(|| first.to_string(), |j| told(first, j))
    }

    fn steps(&self, app: &AppHandle, job: &Job) -> Result<String, (String, String)> {
        let fail = |code: &str, detail: String| (code.to_string(), detail);
        let dir = self.store.jobs().join(&job.id);
        if !job.input.is_empty() && !dir.join(&job.input).exists() {
            return Err(fail("INVALID_INPUT", format!("{} is gone", job.input)));
        }
        // a model on its way in again (for another device, say) has its files changed under it: it is run once
        // the install is over, or found broken if the install failed
        let packs = app.state::<packs::Packs>();
        let say = || self.update(app, &job.id, |j| j.stage = "install".into());
        wait_for_install(|| packs.installing(&job.model), &self.cancel, say, Duration::from_millis(500))?;
        let root = packs::dir(&self.store, &job.model);
        let pack = packs::find(&self.store, &job.model).filter(|p| !p.broken).ok_or_else(|| fail("PACKAGE_INCOMPLETE", job.model.clone()))?;
        let gentle = self.store.settings().gentle;
        if !pack.file.is_empty() {
            return self.custom_picture(app, job, &root, &pack.file, gentle, &dir);
        }
        let model = catalog::model(&job.model).ok_or_else(|| fail("PACKAGE_INCOMPLETE", job.model.clone()))?;
        let need = model.need_mb(&job.device);
        if job.device != "cpu" {
            self.assistant.make_room(hardware::gpu_free_mb(), need);
        }
        let output = if job.kind == "picture" { PICTURE_FILE } else { MODEL_FILE };
        let run = Run { model: &model, root: &root, dir: &dir, gentle, need };
        self.generate(app, job, &run)?;
        self.update(app, &job.id, |j| {
            j.state = "finalizing".into();
            j.stage = "export".into();
        });
        verify(&dir.join(output), &job.kind)?;
        if job.kind == "model" {
            self.second_try(app, job, &run)?;
        }
        Ok(output.to_string())
    }

    /// A generator can end well and leave a plate. It gets one more seed, and the better result stays.
    fn second_try(&self, app: &AppHandle, job: &Job, run: &Run) -> Result<(), Failure> {
        let path = run.dir.join(MODEL_FILE);
        let Some(first) = shape_of(&path) else { return Ok(()) };
        if !first.failed() {
            return Ok(());
        }
        // a stop that came while the first was finishing: no second run is started to be stopped
        if !seeded(run.model) || self.cancel.load(Ordering::Relaxed) {
            self.update(app, &job.id, |j| j.notes.push("flat".into()));
            return Ok(());
        }
        let kept = run.dir.join("first.glb");
        fs::rename(&path, &kept).map_err(|e| ("DISK_FULL".to_string(), e.to_string()))?;
        let again = Job { seed: job.seed.wrapping_add(1), ..job.clone() };
        self.update(app, &job.id, |j| {
            j.seed = again.seed;
            j.notes.push("second_try".into());
        });
        let tried = self.generate(app, &again, run).and_then(|()| verify(&path, "model"));
        let stopped = self.cancel.load(Ordering::Relaxed);
        let second = tried.ok().and_then(|()| shape_of(&path));
        let best = match second.filter(|&s| second_wins(s, first, stopped)) {
            Some(shape) => {
                let _ = fs::remove_file(&kept);
                shape
            }
            None => {
                fs::rename(&kept, &path).map_err(|e| ("DISK_FULL".to_string(), e.to_string()))?;
                self.update(app, &job.id, |j| j.seed = job.seed);
                first
            }
        };
        self.update(app, &job.id, |j| {
            j.state = "finalizing".into();
            j.stage = "export".into();
            if best.failed() {
                j.notes.push("flat".into());
            }
        });
        Ok(())
    }

    /// One run of the engine, down the memory ladder when the graphics card runs out.
    fn generate(&self, app: &AppHandle, job: &Job, run: &Run) -> Result<(), Failure> {
        let Run { model, root, dir, gentle, need } = *run;
        let output = if job.kind == "picture" { PICTURE_FILE } else { MODEL_FILE };
        let path = dir.join(output);
        match &model.runtime {
            Runtime::Plugin { plugin, adapter, .. } => self.plugin(app, job, run, plugin, adapter, &path),
            Runtime::Python { engine, cut, variant, .. } => {
                fs::write(root.join("runner.py"), packs::RUNNER).map_err(|e| ("DISK_FULL".to_string(), e.to_string()))?;
                let image = if *cut { self.cut(app, job, root, dir, gentle)? } else { job.input.clone() };
                let known = self.queue.lock().unwrap().jobs.iter().find(|j| j.id == job.id).map_or(String::new(), |j| j.offload.clone());
                let mut step = if job.device == "cuda" { lower_step(first_step(hardware::gpu_free_mb(), need), &known) } else { "none" };
                loop {
                    let mut cmd = python(root, engine, &dir.join(&image), &path, job, gentle)?;
                    if !variant.is_empty() {
                        cmd.args(["--variant", variant]);
                    }
                    if step != "none" {
                        cmd.args(["--offload", step]);
                    }
                    self.update(app, &job.id, |j| {
                        j.state = "running".into();
                        j.stage = "load".into();
                        j.offload = if step == "none" { String::new() } else { step.to_string() };
                    });
                    match self.spawn(app, job, cmd, dir) {
                        Err((code, detail)) => match lower(&job.device, &code, step) {
                            Some(next) => step = next,
                            None => return Err((code, detail)),
                        },
                        done => return done,
                    }
                }
            }
            Runtime::Native { exe, weights, steps, turn, .. } => {
                let bin = packs::find_exe(&root.join("bin"), exe).ok_or_else(|| ("PACKAGE_INCOMPLETE".to_string(), exe.clone()))?;
                let w = plain_path(self.store.data(), &root.join("weights"));
                let mut c = sys::engine(&bin, gentle);
                if job.kind == "picture" {
                    let file = |i: usize| w.join(&weights[i].name);
                    c.arg("--diffusion-model").arg(file(0)).arg("--llm").arg(file(1)).arg("--vae").arg(file(2));
                    c.args(["-p", &job.prompt, "--cfg-scale", "1.0", "--steps", &steps.to_string()]);
                    c.args(["-W", "1024", "-H", "1024", "--seed", &job.seed.to_string(), "-o", output]);
                    if job.device != "cpu" {
                        c.arg("--offload-to-cpu"); // measured: half the graphics memory for about the same time
                    }
                    if gentle {
                        c.args(["-t", &sys::threads().to_string()]); // sd-cli takes every core by itself
                    }
                } else {
                    c.arg(&job.input).arg(output).arg("--models").arg(&w);
                    c.args(["--seed", &job.seed.to_string(), "--box-uv"]);
                    let preset = model.presets.iter().find(|p| p.id == job.preset).or(model.presets.first());
                    c.args(preset.map_or(&[][..], |p| &p.args[..]));
                    match job.device.as_str() {
                        "cpu" => { c.args(["--backend", "CPU"]); }
                        "vulkan" => { c.args(["--backend", "Vulkan"]); }
                        _ => {}
                    }
                    if job.device != "cpu" {
                        // a card that stopped working is said at once, not found out after hours on the processor
                        c.arg("--require-gpu");
                    }
                    c.arg("--verbose"); // the heartbeats tell a long stage from a stuck one
                }
                self.update(app, &job.id, |j| {
                    j.state = "running".into();
                    j.stage = "generate".into();
                });
                self.spawn(app, job, c, dir)?;
                // Pixal3D would lie on its back without its turn, and face away with only its own export's (catalog.json)
                let Some(turn) = turn else { return Ok(()) };
                match fs::read(&path).ok().and_then(|bytes| glb::turned(&bytes, turn)) {
                    Some(bytes) => fs::write(&path, bytes).map_err(|e| ("DISK_FULL".to_string(), e.to_string())),
                    None => Ok(()), // a file that cannot be read fails the check after the run
                }
            }
        }
    }

    /// A plugin's model, in its fence (PLUGINS.md). It sees no job folder: the picture is copied into a
    /// folder of its own for the run, and what it made is taken out of there.
    fn plugin(&self, app: &AppHandle, job: &Job, run: &Run, plugin: &str, adapter: &str, path: &Path) -> Result<(), Failure> {
        let Run { model, root, dir, gentle, .. } = *run;
        let disk = |e: std::io::Error| ("DISK_FULL".to_string(), e.to_string());
        let folder = root.join("run").join(&job.id);
        let _ = fs::remove_dir_all(&folder);
        fs::create_dir_all(&folder).map_err(disk)?;
        let picture = folder.join(format!("input.{}", Path::new(&job.input).extension().and_then(|e| e.to_str()).unwrap_or("png")));
        fs::copy(dir.join(&job.input), &picture).map_err(|e| ("INVALID_INPUT".to_string(), e.to_string()))?;
        if packs::fence_open(&self.store, plugin, root) {
            return Err(("FENCE_OPEN".into(), String::new()));
        }
        let mut c = packs::plugin_program(&self.store, plugin, adapter, root, &folder, gentle).map_err(|e| ("PACKAGE_INCOMPLETE".to_string(), e))?;
        c.arg("--image").arg(&picture).arg("--out").arg(folder.join(MODEL_FILE));
        c.args(["--device", &job.device, "--seed", &job.seed.to_string()]);
        let preset = model.presets.iter().find(|p| p.id == job.preset).or(model.presets.first());
        c.args(preset.map_or(&[][..], |p| &p.args[..]));
        self.update(app, &job.id, |j| {
            j.state = "running".into();
            j.stage = "load".into();
        });
        // the models folder can lie on another disk than the jobs: a copy, not a move
        let made = self.spawn(app, job, c, dir).and_then(|()| fs::copy(folder.join(MODEL_FILE), path).map(drop).map_err(|e| ("INVALID_OUTPUT".to_string(), e.to_string())));
        let _ = fs::remove_dir_all(&folder);
        made
    }

    /// The background off, once for a job: a second run and a retry start from what was cut. When the
    /// cut itself fails, the engine has a cutter of its own, a smaller one.
    fn cut(&self, app: &AppHandle, job: &Job, root: &Path, dir: &Path, gentle: bool) -> Result<String, Failure> {
        let image = format!("cut-{}.png", file_stem(&job.input));
        if !dir.join(&image).exists() {
            self.update(app, &job.id, |j| j.stage = "background".into());
            let cmd = python(root, "cut", &dir.join(&job.input), &dir.join(&image), job, gentle)?;
            if let Err((code, detail)) = self.spawn(app, job, cmd, dir) {
                if code == "CANCELLED" {
                    return Err((code, detail));
                }
                let _ = fs::remove_file(dir.join(&image));
                return Ok(job.input.clone());
            }
        }
        let subject = fs::read(dir.join(&image).with_extension("json")).ok().and_then(|b| serde_json::from_slice(&b).ok());
        let Some(subject) = subject else { return Ok(image) };
        let (notes, empty) = subject_notes(&subject);
        if empty {
            return Err(("NO_SUBJECT".into(), String::new()));
        }
        self.update(app, &job.id, |j| notes.into_iter().for_each(|n| note(j, n)));
        Ok(image)
    }

    /// A picture from a model file from Hugging Face: one file, ordinary settings.
    fn custom_picture(&self, app: &AppHandle, job: &Job, root: &Path, file: &str, gentle: bool, dir: &Path) -> Result<String, (String, String)> {
        let bin = packs::find_exe(&root.join("bin"), "sd-cli").ok_or(("PACKAGE_INCOMPLETE".to_string(), "sd-cli".to_string()))?;
        let path = dir.join(PICTURE_FILE);
        let mut c = sys::engine(&bin, gentle);
        let weights = plain_path(self.store.data(), &root.join("weights"));
        c.arg("-m").arg(weights.join(file)).args(["-p", &job.prompt, "--cfg-scale", "6", "--steps", "24"]);
        c.args(["-W", "768", "-H", "768", "--seed", &job.seed.to_string(), "-o", PICTURE_FILE]);
        if gentle {
            c.args(["-t", &sys::threads().to_string()]);
        }
        self.update(app, &job.id, |j| {
            j.state = "running".into();
            j.stage = "generate".into();
        });
        self.spawn(app, job, c, dir)?;
        verify(&path, "picture")?;
        Ok(PICTURE_FILE.to_string())
    }

    /// Runs one engine process: its output goes to the job's log, and its stage reports to the page.
    fn spawn(&self, app: &AppHandle, job: &Job, mut c: Command, dir: &Path) -> Result<(), (String, String)> {
        let log_path = dir.join(LOG_FILE);
        // the log grows over retries: what went wrong is read from this run alone
        let earlier = fs::metadata(&log_path).map_or(0, |m| m.len() as usize);
        c.current_dir(dir).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = sys::start(&mut c, self.store.settings().gentle).map_err(|e| ("ENGINE_CRASH".to_string(), e.to_string()))?;
        let (stdout, stderr) = (child.stdout.take(), child.stderr.take());
        let log = Arc::new(Mutex::new(fs::OpenOptions::new().create(true).append(true).open(&log_path).ok()));
        let started = Instant::now();
        let heard = Arc::new(AtomicU64::new(0));
        let reader = |stream: Box<dyn Read + Send>, log: Arc<Mutex<Option<fs::File>>>, id: String, app: AppHandle| {
            let heard = heard.clone();
            std::thread::spawn(move || {
                each_line(stream, |line| {
                    heard.store(started.elapsed().as_secs(), Ordering::Relaxed);
                    if let Some(f) = log.lock().unwrap().as_mut() {
                        use std::io::Write;
                        let _ = writeln!(f, "{line}");
                    }
                    if let Some(stage) = next_stage(line) {
                        crate::news(&app, "stage", (id.clone(), stage));
                    }
                });
            })
        };
        let mut threads = vec![];
        if let Some(s) = stdout {
            threads.push(reader(Box::new(s), log.clone(), job.id.clone(), app.clone()));
        }
        if let Some(s) = stderr {
            threads.push(reader(Box::new(s), log.clone(), job.id.clone(), app.clone()));
        }
        let mut sampler = memory::Sampler::new();
        let mut watch = memory::Watch::new(sampler.budget);
        let ended = self.wait(app, job, &mut child, (&mut sampler, &mut watch), started, &heard);
        if watch.peak_mb > 0 {
            self.update(app, &job.id, |j| j.peak_mb = j.peak_mb.max(watch.peak_mb));
        }
        let status = ended?;
        // a process the engine started and left would hold its output open, and the job would wait on it for
        // good, past the reach of the stop button (a compile worker of a crashed engine, say)
        child.end_rest();
        for t in threads {
            let _ = t.join();
        }
        if status.success() {
            return Ok(());
        }
        let bytes = fs::read(&log_path).unwrap_or_default();
        let text = String::from_utf8_lossy(bytes.get(earlier..).unwrap_or_default()).into_owned();
        let start = text.char_indices().rev().nth(LOG_TAIL).map_or(0, |(i, _)| i);
        let tail = text[start..].to_string();
        let signal = signal_of(&status);
        // an engine that cannot even start writes nothing
        let detail = format!("exit code {:?}{}\n{tail}", status.code(), signal.map_or(String::new(), |s| format!(", signal {s}")));
        let code = if killed_for_memory(status.code(), signal, watch.low) { "HOST_OOM" } else { classify(&tail) };
        Err((code.into(), detail))
    }

    /// Waits for the engine to end. It is stopped when the person cancels, when a card run goes silent, and
    /// before the computer runs out of memory: the system must never have to choose what to close.
    fn wait(&self, app: &AppHandle, job: &Job, child: &mut Child, (sampler, watch): (&mut memory::Sampler, &mut memory::Watch), started: Instant, heard: &AtomicU64) -> Result<ExitStatus, Failure> {
        let mut next_sample = Duration::ZERO;
        loop {
            if self.cancel.load(Ordering::Relaxed) {
                sys::kill_tree(child);
                return Err(("CANCELLED".into(), String::new()));
            }
            if stuck(&job.device, started.elapsed().as_secs(), heard.load(Ordering::Relaxed)) {
                sys::kill_tree(child);
                return Err(("ENGINE_HANG".into(), format!("no output for {STALL_SECONDS} s")));
            }
            let at = started.elapsed();
            if at >= next_sample {
                next_sample = at + SAMPLE_EVERY;
                match watch.see(&sampler.sample(child.id()), at) {
                    Verdict::Stop(why) => {
                        sys::kill_tree(child);
                        return Err(("HOST_OOM".into(), format!("stopped by Polyzon Maker: {why}")));
                    }
                    Verdict::Low => self.update(app, &job.id, |j| note(j, "memory_low")),
                    Verdict::Fine => {}
                }
            }
            match child.try_wait() {
                Ok(Some(status)) => return Ok(status),
                Ok(None) => std::thread::sleep(Duration::from_millis(150)),
                Err(e) => {
                    sys::kill_tree(child);
                    return Err(("ENGINE_CRASH".into(), e.to_string()));
                }
            }
        }
    }
}

fn note(job: &mut Job, note: &str) {
    if !job.notes.iter().any(|n| n == note) {
        job.notes.push(note.to_string());
    }
}

#[cfg(unix)]
fn signal_of(status: &ExitStatus) -> Option<i32> {
    std::os::unix::process::ExitStatusExt::signal(status)
}

#[cfg(not(unix))]
fn signal_of(_: &ExitStatus) -> Option<i32> {
    None
}

/// The system took the engine down for memory: macOS and Linux kill it outright when memory runs out,
/// Windows ends it with STATUS_NO_MEMORY or STATUS_COMMITMENT_LIMIT. A kill while memory was fine is
/// somebody else's, a person's in Activity Monitor say.
fn killed_for_memory(code: Option<i32>, signal: Option<i32>, low: bool) -> bool {
    const NO_MEMORY: u32 = 0xC000_0017;
    const COMMITMENT_LIMIT: u32 = 0xC000_012D;
    const SIGKILL: i32 = 9;
    matches!(code.map(|c| c as u32), Some(NO_MEMORY | COMMITMENT_LIMIT)) || (signal == Some(SIGKILL) && low)
}

/// What a report says of a job lost when the program stopped: the stage, and whether memory was short then.
/// Waits while `installing` says the job's model is being installed, telling the page once; a stop ends the wait.
fn wait_for_install(installing: impl Fn() -> bool, cancel: &AtomicBool, mut say: impl FnMut(), every: Duration) -> Result<(), Failure> {
    let mut told = false;
    while installing() {
        if cancel.load(Ordering::Relaxed) {
            return Err(("CANCELLED".into(), String::new()));
        }
        if !told {
            say();
            told = true;
        }
        std::thread::sleep(every);
    }
    Ok(())
}

/// How a run with no result ended. Stopped as the program closed (the Dock's Quit, the end of a session) it
/// is interrupted, as if the program had closed under it: nobody pressed Stop, and «nothing was kept» would
/// tell them they did.
fn ended(stopped: bool, closing: bool) -> &'static str {
    match (stopped, closing) {
        (true, true) => "interrupted",
        (true, false) => "cancelled",
        (false, _) => "failed",
    }
}

fn lost_code(job: &Job) -> String {
    if job.notes.iter().any(|n| n == "memory_low") { format!("{}_mem", job.stage) } else { job.stage.clone() }
}

/// What a finished job adds to its report, in words short enough for the server's 40 letters: the
/// detail it ran at, a second seed, a plate, what was wrong with its picture, the step of the memory ladder.
fn quality(job: &Job) -> String {
    let told = job.notes.iter().filter_map(|n| match n.as_str() {
        "second_try" => Some("2nd"),
        "flat" => Some("flat"),
        "subject_small" => Some("small"),
        "subject_cut" => Some("cut"),
        "subject_many" => Some("many"),
        "low_res" => Some("lowres"),
        "memory_low" => Some("tight"),
        _ => None,
    });
    let step = match job.offload.as_str() {
        "" => None,
        "sequential" => Some("seq"),
        other => Some(other),
    };
    let preset = (!job.preset.is_empty()).then(|| job.preset.clone());
    // the memory it took, in whole gigabytes up: what the catalog's numbers are checked against
    let peak = (job.peak_mb > 0).then(|| format!("m{}", job.peak_mb.div_ceil(1024)));
    preset.into_iter().chain(peak).chain(told.chain(step).map(String::from)).collect::<Vec<_>>().join("_")
}

/// What a report says of a job: what happened, then what it ran with. A rating or a failure says little
/// without it; the server takes 40 letters, so what happened comes first and only the end can be cut.
fn told(first: &str, job: &Job) -> String {
    [first.to_string(), quality(job)].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join("_")
}

/// A crash alone says little: what Python named goes with it. Only the name, never the rest of the line.
fn failure_code(code: &str, detail: &str) -> String {
    match telemetry::exception(detail) {
        Some(name) if code == "ENGINE_CRASH" => format!("{code}_{name}"),
        _ => code.to_string(),
    }
}

/// What one run of the engine needs, the same for each try.
#[derive(Clone, Copy)]
struct Run<'a> {
    model: &'a Model,
    root: &'a Path,
    dir: &'a Path,
    gentle: bool,
    need: u64,
}

/// Engines end progress bars with a carriage return, so lines are told apart by both. A line that
/// never ends stops growing at a limit: this runs for hours on what a program prints.
fn each_line(stream: impl Read, mut line_out: impl FnMut(&str)) {
    const LONGEST: usize = 8192;
    let mut stream = stream;
    let mut chunk = [0u8; 4096];
    let mut line: Vec<u8> = Vec::with_capacity(256);
    while let Ok(read) = stream.read(&mut chunk) {
        if read == 0 {
            break;
        }
        for &byte in &chunk[..read] {
            if byte == b'\n' || byte == b'\r' {
                if !line.is_empty() {
                    line_out(&String::from_utf8_lossy(&line));
                    line.clear();
                }
            } else if line.len() < LONGEST {
                line.push(byte);
            }
        }
    }
    if !line.is_empty() {
        line_out(&String::from_utf8_lossy(&line));
    }
}

/// The step of the memory ladder (TZ §6) a run starts on: all on the card, one stage of the pipeline at
/// a time, or layer by layer. Not knowing what is free means trying the fast way.
fn first_step(free_mb: Option<u64>, need_mb: u64) -> &'static str {
    match free_mb {
        Some(free) if free * 2 < need_mb => "sequential",
        Some(free) if free < need_mb => "model",
        _ => "none",
    }
}

/// The step to try after a run that ran out of graphics memory. Only a card with memory of its own frees any
/// by moving parts to main memory; on a Mac both are one, and the next run would need as much again.
fn lower(device: &str, code: &str, step: &str) -> Option<&'static str> {
    (code == "GPU_OOM" && device == "cuda").then(|| next_step(step)).flatten()
}

fn next_step(step: &str) -> Option<&'static str> {
    match step {
        "none" => Some("model"),
        "model" => Some("sequential"),
        _ => None,
    }
}

/// What an earlier run of this job found out stays true: a second seed needs the same memory.
fn lower_step(step: &'static str, known: &str) -> &'static str {
    match known {
        "sequential" => "sequential",
        "model" if step == "none" => "model",
        _ => step,
    }
}

fn stuck(device: &str, now: u64, heard: u64) -> bool {
    device != "cpu" && now.saturating_sub(heard) > STALL_SECONDS
}

/// What the cut found: how the picture will go, and whether there is anything to make at all.
fn subject_notes(subject: &serde_json::Value) -> (Vec<&'static str>, bool) {
    let share = subject["share"].as_f64().unwrap_or(1.0);
    let mut notes = vec![];
    if share < 0.03 {
        notes.push("subject_small");
    }
    if subject["edges"].as_u64().unwrap_or(0) >= 2 {
        notes.push("subject_cut");
    }
    if subject["pieces"].as_u64().unwrap_or(1) >= 3 {
        notes.push("subject_many");
    }
    (notes, share < EMPTY_PICTURE)
}

/// Whether a second seed's result takes the first one's place. Stopping the second run stops only
/// the extra try: the first is a finished result and stays.
fn second_wins(second: glb::Shape, first: glb::Shape, stopped: bool) -> bool {
    !stopped && second.better_than(first)
}

/// Does another seed give another result? Models without sampling give the same again.
fn seeded(model: &Model) -> bool {
    !matches!(&model.runtime, Runtime::Python { engine, .. } if engine == "triposr" || engine == "photos")
}

fn shape_of(path: &Path) -> Option<glb::Shape> {
    glb::read(&fs::read(path).ok()?)
}

/// A line from the runner, {"done": "load"}: what comes after that stage. A plugin's program says the
/// stage it starts instead, {"stage": "generate"}, since it may have no background to take off.
fn next_stage(line: &str) -> Option<&'static str> {
    let said: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
    if let Some(stage) = said.get("stage").and_then(|s| s.as_str()) {
        return ["load", "generate", "export"].into_iter().find(|known| *known == stage);
    }
    match said.get("done")?.as_str()? {
        "load" => Some("background"),
        "background" => Some("generate"),
        "generate" => Some("export"),
        _ => None,
    }
}

fn classify(tail: &str) -> &'static str {
    let t = tail.to_lowercase();
    let has = |words: &[&str]| words.iter().any(|w| t.contains(w));
    // ggml's own words for the card come first: its CUDA build says just "out of memory"
    let card = ["cuda out of memory", "outofmemoryerror", "vk_error_out_of_device_memory", "not enough gpu memory", "mps backend out of memory", "failed to allocate metal buffer", "cuda error: out of memory", "cudamalloc failed", "outofdevicememory", "device memory allocation"];
    if has(&card) {
        "GPU_OOM"
    } else if has(&["memoryerror", "paging file", "cannot allocate memory", "bad_alloc", "defaultcpuallocator", "not enough memory", "unable to allocate", "out of memory"]) {
        "HOST_OOM"
    } else if has(&["no space left", "not enough space", "disk full"]) {
        "DISK_FULL"
    } else if has(&["no kernel image", "driver version", "nvidia driver", "vulkan: no", "no vulkan device", "no usable gpu backend"]) {
        "DRIVER_MISMATCH"
    } else if has(&["cannot identify image", "unsupported image", "failed to load image"]) {
        "INVALID_INPUT"
    } else {
        "ENGINE_CRASH"
    }
}

fn python(root: &Path, engine: &str, image: &Path, out: &Path, job: &Job, gentle: bool) -> Result<Command, (String, String)> {
    let py = packs::python_in(&root.join("env"));
    let repo = packs::repo_root(&root.join("repo")).ok_or(("PACKAGE_INCOMPLETE".to_string(), "repo".to_string()))?;
    let mut c = sys::engine(py, gentle);
    c.arg(root.join("runner.py")).args([engine, "--repo"]).arg(repo);
    c.arg("--image").arg(image).arg("--out").arg(out);
    if engine != "cut" {
        c.args(["--device", &job.device, "--seed", &job.seed.to_string()]);
    }
    packs::cache_env(&mut c, root, false);
    c.env("HF_HUB_OFFLINE", "1"); // weights are on disk: a generation touches no network (TZ FR-13)
    Ok(c)
}

/// Native engines run inside the job's folder and read ANSI command lines on Windows, where a user
/// name in Cyrillic would break an absolute path. From the job folder, data lies two levels up.
fn plain_path(data: &Path, target: &Path) -> PathBuf {
    target.strip_prefix(data).map_or_else(|_| target.to_path_buf(), |rest| Path::new("..").join("..").join(rest))
}

fn file_stem(name: &str) -> &str {
    Path::new(name).file_stem().and_then(|s| s.to_str()).unwrap_or("input")
}

/// A result counts only if it is what it says it is.
fn verify(path: &Path, kind: &str) -> Result<(), (String, String)> {
    let bad = |d: String| ("INVALID_OUTPUT".to_string(), d);
    let bytes = fs::read(path).map_err(|e| bad(e.to_string()))?;
    let magic: &[u8] = if kind == "picture" { b"\x89PNG" } else { b"glTF" };
    if bytes.len() < 1024 || !bytes.starts_with(magic) {
        return Err(bad(format!("{} bytes, not a {kind}", bytes.len())));
    }
    Ok(())
}

fn save(store: &Store, job: &Job) {
    let path = store.jobs().join(&job.id).join("job.json");
    if let Ok(json) = serde_json::to_vec_pretty(job) {
        let _ = store::write_atomic(&path, &json);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_job_starts_its_own_thread_unless_it_joins_one() {
        let d = std::env::temp_dir().join(format!("maker-thread-{}", store::random_id()));
        let jobs = Jobs::open(Arc::new(Store::open(d.join("c"), d.join("d")).unwrap()), Arc::default());
        let first = jobs.add(Job::default()).unwrap();
        assert_eq!(first.thread, first.id);
        let next = jobs.add(Job { thread: first.id.clone(), ..Job::default() }).unwrap();
        assert_eq!(next.thread, first.id);
        assert_ne!(next.id, first.id);
    }

    fn store() -> Arc<Store> {
        let d = std::env::temp_dir().join(format!("maker-jobs-{}", store::random_id()));
        Arc::new(Store::open(d.join("c"), d.join("d")).unwrap())
    }

    #[test]
    fn a_job_that_was_running_at_a_crash_says_so_and_finished_ones_stay() {
        let s = store();
        for (id, state) in [("a", "running"), ("b", "succeeded"), ("c", "queued")] {
            save(&s, &Job { id: id.into(), state: state.into(), stage: "generate".into(), ..Job::default() });
        }
        let jobs = Jobs::open(s, Arc::default()).list();
        let state = |id: &str| jobs.iter().find(|j| j.id == id).unwrap().state.clone();
        assert_eq!((state("a").as_str(), state("b").as_str(), state("c").as_str()), ("interrupted", "succeeded", "queued"));
    }

    #[test]
    fn a_waiting_job_moves_up_or_down_and_the_engine_takes_them_in_that_order() {
        let jobs = Jobs::open(store(), Arc::default());
        for id in ["a", "b", "c"] {
            jobs.add(Job { id: id.into(), ..Job::default() }).unwrap();
        }
        let order = |jobs: &Jobs| jobs.waiting().into_iter().map(|j| j.id).collect::<Vec<_>>();
        assert_eq!(order(&jobs), ["a", "b", "c"]);
        assert_eq!(jobs.shift("c", true).len(), 2);
        assert_eq!(order(&jobs), ["a", "c", "b"]);
        assert!(jobs.shift("a", true).is_empty(), "the first has nowhere to go up");
        assert!(jobs.shift("b", false).is_empty(), "the last has nowhere to go down");
        jobs.shift("a", false);
        assert_eq!(order(&jobs), ["c", "a", "b"]);
        // a job lined up later goes after them, whatever the clock says
        jobs.add(Job { id: "d".into(), ..Job::default() }).unwrap();
        assert_eq!(order(&jobs), ["c", "a", "b", "d"]);
        // and a job from before turns existed goes by when it was made
        let old = Job { id: "old".into(), created: 1, state: "queued".into(), ..Job::default() };
        jobs.queue.lock().unwrap().jobs.push(old);
        assert_eq!(order(&jobs)[0], "old");
    }

    #[test]
    fn a_paused_queue_starts_nothing_new_and_stays_paused_after_a_restart() {
        let store = store();
        let jobs = Jobs::open(store.clone(), Arc::default());
        for id in ["a", "b"] {
            jobs.add(Job { id: id.into(), ..Job::default() }).unwrap();
        }
        assert_eq!(jobs.next().map(|j| j.id), Some("a".into()));
        jobs.pause(true).unwrap();
        assert!(jobs.next().is_none());
        // the program closed and opened again: the queue is still waiting for the person
        assert!(Jobs::open(store.clone(), Arc::default()).next().is_none());
        jobs.pause(false).unwrap();
        assert_eq!(jobs.next().map(|j| j.id), Some("a".into()));
    }

    #[test]
    fn a_job_whose_model_is_being_installed_waits_for_the_install_and_a_stop_ends_the_wait() {
        let (left, said) = (std::cell::Cell::new(3u32), std::cell::Cell::new(0));
        let installing = || {
            left.set(left.get().saturating_sub(1));
            left.get() > 0
        };
        let waited = wait_for_install(installing, &AtomicBool::new(false), || said.set(said.get() + 1), Duration::ZERO);
        assert!(waited.is_ok() && left.get() == 0, "it went on once the install was over");
        assert_eq!(said.get(), 1, "the page heard once what it waits for");
        assert!(wait_for_install(|| false, &AtomicBool::new(false), || panic!("nothing to wait for"), Duration::ZERO).is_ok());
        let stopped = wait_for_install(|| true, &AtomicBool::new(true), || {}, Duration::ZERO);
        assert_eq!(stopped.unwrap_err().0, "CANCELLED");
    }

    #[test]
    fn a_run_the_program_stopped_as_it_closed_reads_interrupted_and_not_as_stopped_by_the_person() {
        assert_eq!(ended(true, true), "interrupted", "the Dock's Quit, the end of a session: nobody pressed Stop");
        assert_eq!(ended(true, false), "cancelled");
        assert_eq!(ended(false, true), "failed", "it failed on its own, whatever came after");
        assert_eq!(ended(false, false), "failed");
    }

    #[test]
    fn a_program_that_closes_starts_nothing_new_and_what_waits_runs_at_the_next_start() {
        let store = store();
        let jobs = Jobs::open(store.clone(), Arc::default());
        jobs.add(Job { id: "a".into(), ..Job::default() }).unwrap();
        jobs.close();
        assert!(jobs.next().is_none(), "no engine is started that would outlive the program");
        assert_eq!(Jobs::open(store, Arc::default()).next().map(|j| j.id), Some("a".into()));
    }

    #[test]
    fn what_was_chosen_for_after_the_queue_comes_due_only_once_the_queue_has_done_something() {
        let jobs = Jobs::open(store(), Arc::default());
        jobs.choose(After::Sleep).unwrap();
        let mut q = jobs.queue.lock().unwrap();
        assert_eq!(due(&mut q, true, true), None, "more waits");
        assert_eq!(due(&mut q, false, true), Some(After::Sleep));
        assert_eq!(due(&mut q, false, false), None, "the person took everything out of the queue: they are there");
        assert_eq!(q.after, After::Nothing, "and the choice goes with it");
    }

    #[test]
    fn the_computer_sleeps_only_when_nobody_says_no_in_the_minute() {
        let jobs = Arc::new(Jobs::open(store(), Arc::default()));
        jobs.choose(After::Sleep).unwrap();
        assert!(jobs.hold_off(After::Sleep, Duration::from_millis(50)), "nobody there");
        assert_eq!(jobs.chosen(), After::Nothing, "it is used once");

        let meanwhile = |then: fn(&Jobs)| {
            jobs.choose(After::Sleep).unwrap();
            let other = jobs.clone();
            let person = std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(50));
                then(&other);
            });
            let started = Instant::now();
            let now = jobs.hold_off(After::Sleep, Duration::from_secs(30));
            person.join().unwrap();
            assert!(started.elapsed() < Duration::from_secs(10), "heard at once, not at the end of the minute");
            now
        };
        assert!(!meanwhile(|jobs| jobs.choose(After::Nothing).unwrap()), "a no");
        assert_eq!(jobs.chosen(), After::Nothing);
        assert!(!meanwhile(|jobs| drop(jobs.add(Job::default()))), "another model lined up: the queue goes on");
        assert_eq!(jobs.chosen(), After::Sleep, "kept for the end of the longer queue");
    }

    #[test]
    fn the_same_id_twice_is_one_job() {
        let jobs = Jobs::open(store(), Arc::default());
        let job = Job { id: "same".into(), ..Job::default() };
        jobs.add(job.clone()).unwrap();
        jobs.add(job).unwrap();
        assert_eq!(jobs.list().len(), 1);
    }

    #[test]
    fn engine_failures_get_a_name_a_person_can_act_on() {
        assert_eq!(classify("torch.cuda.OutOfMemoryError: CUDA out of memory"), "GPU_OOM");
        // trellis.cpp on a Mac: ggml's Metal backend, src/ggml-metal/ggml-metal.cpp
        assert_eq!(classify("ggml_backend_metal_buffer_type_alloc_buffer: failed to allocate Metal buffer of 6442450944 bytes (out of memory)"), "GPU_OOM");
        assert_eq!(classify("OSError: The paging file is too small"), "HOST_OOM");
        assert_eq!(classify("no space left on device"), "DISK_FULL");
        assert_eq!(classify("no kernel image is available for execution"), "DRIVER_MISMATCH");
        assert_eq!(classify("Traceback: KeyError"), "ENGINE_CRASH");
    }

    #[test]
    fn main_memory_running_out_is_told_apart_from_graphics_memory() {
        // PyTorch, numpy and a native engine, each in its own words
        assert_eq!(classify("RuntimeError: [enforce fail at alloc_cpu.cpp:117] DefaultCPUAllocator: not enough memory: you tried to allocate 2147483648 bytes."), "HOST_OOM");
        assert_eq!(classify("numpy.core._exceptions._ArrayMemoryError: Unable to allocate 3.20 GiB for an array"), "HOST_OOM");
        assert_eq!(classify("[E] out of memory while reading weights"), "HOST_OOM");
        assert_eq!(classify("RuntimeError: MPS backend out of memory (MPS allocated: 17.00 GB)"), "GPU_OOM");
        assert_eq!(classify("torch.OutOfMemoryError: CUDA out of memory. Tried to allocate 2.00 GiB"), "GPU_OOM");
        // ggml, under sd-cli and llama.cpp
        assert_eq!(classify("ggml_backend_cuda_buffer_type_alloc_buffer: allocating 4096.00 MiB on device 0: cudaMalloc failed: out of memory"), "GPU_OOM");
        assert_eq!(classify("CUDA error: out of memory"), "GPU_OOM");
        assert_eq!(classify("ggml_vulkan: Device memory allocation of size 4294967296 failed."), "GPU_OOM");
        assert_eq!(classify("vk::Device::allocateMemory: ErrorOutOfDeviceMemory"), "GPU_OOM");
    }

    #[test]
    fn an_engine_the_system_ended_for_memory_says_so() {
        assert!(killed_for_memory(Some(0xC000_0017_u32 as i32), None, false), "Windows: STATUS_NO_MEMORY");
        assert!(killed_for_memory(Some(0xC000_012D_u32 as i32), None, false), "Windows: STATUS_COMMITMENT_LIMIT");
        assert!(killed_for_memory(None, Some(9), true), "macOS or Linux killed it while memory was short");
        assert!(!killed_for_memory(None, Some(9), false), "a kill while memory was fine is somebody else's");
        assert!(!killed_for_memory(None, Some(15), true));
        assert!(!killed_for_memory(Some(1), None, true), "an engine that failed by itself says why in its log");
    }

    #[test]
    fn a_job_lost_while_memory_was_short_says_so_and_keeps_its_note() {
        let s = store();
        save(&s, &Job { id: "a".into(), state: "running".into(), stage: "load".into(), notes: vec!["memory_low".into()], ..Job::default() });
        let job = Jobs::open(s, Arc::default()).list().remove(0);
        assert_eq!((job.state.as_str(), job.notes.as_slice()), ("interrupted", ["memory_low".to_string()].as_slice()));
        assert_eq!(lost_code(&Job { stage: "load".into(), notes: vec!["memory_low".into()], ..Job::default() }), "load_mem");
        assert_eq!(lost_code(&Job { stage: "generate".into(), ..Job::default() }), "generate");
    }

    #[test]
    fn the_ladder_starts_where_the_free_memory_says_and_only_goes_down() {
        assert_eq!(first_step(Some(16000), 8000), "none");
        assert_eq!(first_step(Some(6000), 8000), "model");
        assert_eq!(first_step(Some(3000), 8000), "sequential");
        assert_eq!(first_step(None, 8000), "none", "a card that says nothing is tried the fast way");
        assert_eq!(next_step("none"), Some("model"));
        assert_eq!(next_step("model"), Some("sequential"));
        assert_eq!(next_step("sequential"), None);
    }

    #[test]
    fn only_a_card_with_memory_of_its_own_goes_down_the_ladder() {
        assert_eq!(lower("cuda", "GPU_OOM", "none"), Some("model"));
        assert_eq!(lower("cuda", "GPU_OOM", "sequential"), None, "the bottom of the ladder");
        assert_eq!(lower("mps", "GPU_OOM", "none"), None, "on a Mac main memory is the same memory");
        assert_eq!(lower("cuda", "HOST_OOM", "none"), None, "main memory short: moving parts there makes it worse");
    }

    #[test]
    fn a_second_seed_starts_on_the_step_the_first_one_ended_on() {
        assert_eq!(lower_step("none", ""), "none");
        assert_eq!(lower_step("none", "model"), "model");
        assert_eq!(lower_step("none", "sequential"), "sequential");
        assert_eq!(lower_step("sequential", "model"), "sequential", "less memory free now wins");
    }

    #[test]
    fn silence_stops_a_graphics_card_run_and_never_a_processor_one() {
        assert!(!stuck("cuda", STALL_SECONDS, 0));
        assert!(stuck("cuda", STALL_SECONDS + 1, 0));
        assert!(stuck("vulkan", 10_000, 10_000 - STALL_SECONDS - 1));
        assert!(!stuck("cuda", 10_000, 9_000));
        assert!(!stuck("cpu", 100_000, 0));
    }

    #[test]
    fn a_progress_bar_counts_as_lines_and_a_endless_one_stays_small() {
        let mut lines = vec![];
        each_line("load\r\n10%\r20%\r30%\nend".as_bytes(), |l| lines.push(l.to_string()));
        assert_eq!(lines, ["load", "10%", "20%", "30%", "end"]);
        let mut longest = 0;
        each_line(vec![b'x'; 100_000].as_slice(), |l| longest = l.len());
        assert_eq!(longest, 8192);
        let mut broken = String::new();
        each_line([0xff, b'a', b'\n'].as_slice(), |l| broken = l.to_string());
        assert!(broken.ends_with('a'), "bytes that are not text must not end the reading");
    }

    #[test]
    fn what_the_cut_found_becomes_advice_or_stops_the_run() {
        let notes = |value: serde_json::Value| subject_notes(&value);
        assert_eq!(notes(serde_json::json!({ "share": 0.3, "pieces": 1, "edges": 0 })), (vec![], false));
        assert_eq!(notes(serde_json::json!({ "share": 0.01, "pieces": 1, "edges": 0 })), (vec!["subject_small"], false));
        assert_eq!(notes(serde_json::json!({ "share": 0.4, "pieces": 4, "edges": 2 })), (vec!["subject_cut", "subject_many"], false));
        assert!(notes(serde_json::json!({ "share": 0.0, "pieces": 0, "edges": 0 })).1);
    }

    #[test]
    fn a_rating_is_kept_for_finished_results_only() {
        let s = store();
        save(&s, &Job { id: "done".into(), state: "succeeded".into(), ..Job::default() });
        save(&s, &Job { id: "failed".into(), state: "failed".into(), ..Job::default() });
        let jobs = Jobs::open(s.clone(), Arc::default());
        assert_eq!(jobs.rate("done", "bad").unwrap().rating, "bad");
        assert!(jobs.rate("failed", "good").is_none());
        assert!(jobs.rate("done", "made up").is_none());
        assert_eq!(Jobs::open(s, Arc::default()).list().iter().find(|j| j.id == "done").unwrap().rating, "bad");
    }

    #[test]
    fn a_crash_is_reported_with_the_name_python_gave_it() {
        assert_eq!(failure_code("ENGINE_CRASH", "exit code Some(1)\nModuleNotFoundError: No module named 'diso'"), "ENGINE_CRASH_ModuleNotFoundError");
        assert_eq!(failure_code("ENGINE_CRASH", "[E] generate failed"), "ENGINE_CRASH");
        assert_eq!(failure_code("GPU_OOM", "torch.cuda.OutOfMemoryError: CUDA out of memory"), "GPU_OOM");
    }

    #[test]
    fn a_report_says_what_the_result_ran_with_and_what_was_wrong_with_its_picture() {
        let job = |preset: &str, notes: &[&str], offload: &str| Job { preset: preset.into(), notes: notes.iter().map(|n| n.to_string()).collect(), offload: offload.into(), ..Job::default() };
        assert_eq!(quality(&job("1024", &[], "")), "1024");
        assert_eq!(quality(&job("512", &["second_try", "flat"], "model")), "512_2nd_flat_model");
        assert_eq!(quality(&job("", &["subject_small", "subject_cut", "subject_many", "low_res"], "sequential")), "small_cut_many_lowres_seq");
        // everything at once still fits what the server takes
        let all = quality(&job("1024", &["second_try", "flat", "subject_small", "subject_cut", "subject_many", "low_res"], "sequential"));
        assert!(all.len() <= 40 && all.ends_with("_seq"), "{all}");
        // what the person was told that says nothing of quality stays out
        assert_eq!(quality(&job("1024", &["made_up"], "")), "1024");
        // the memory it took, in gigabytes up, and whether memory got short
        let heavy = Job { peak_mb: 21_000, ..job("1024", &["second_try", "memory_low"], "sequential") };
        assert_eq!(quality(&heavy), "1024_m21_2nd_tight_seq");
        assert_eq!(quality(&Job { peak_mb: 10_241, ..job("", &[], "") }), "m11");
        // a rating and a failure go with what they were about
        assert_eq!(told("bad", &job("1024", &["flat"], "")), "bad_1024_flat");
        assert_eq!(told("good", &job("", &[], "")), "good");
        assert_eq!(told("GPU_OOM", &job("1024", &[], "sequential")), "GPU_OOM_1024_seq");
        assert_eq!(told("", &job("1024", &[], "")), "1024");
    }

    #[test]
    fn a_second_seed_stopped_halfway_leaves_the_first_result_and_a_better_one_takes_its_place() {
        let plate = glb::Shape { faces: 5000, flat: 0.99 };
        let good = glb::Shape { faces: 5000, flat: 0.2 };
        assert!(second_wins(good, plate, false));
        assert!(!second_wins(good, plate, true), "stopped: the first, a finished result, stays");
        assert!(!second_wins(plate, good, false), "no better");
    }

    #[test]
    fn only_a_model_that_samples_gets_a_second_seed() {
        let model = |id: &str| catalog::model(id).unwrap();
        assert!(seeded(&model("trellis2")));
        assert!(seeded(&model("hunyuan-2-1")));
        assert!(!seeded(&model("triposr")));
        assert!(!seeded(&model("pi3")));
    }

    #[test]
    fn stages_come_from_the_engine_and_other_lines_are_ignored() {
        assert_eq!(next_stage("{\"done\": \"load\"}"), Some("background"));
        assert_eq!(next_stage("{\"done\": \"generate\"}"), Some("export"));
        assert_eq!(next_stage("Loading weights 10%"), None);
        assert_eq!(next_stage("{\"stage\": \"generate\"}"), Some("generate"), "a plugin's program says where it is");
        assert_eq!(next_stage("{\"stage\": \"settings\"}"), None);
    }

    #[test]
    fn a_cyrillic_user_name_never_reaches_a_native_engine() {
        let data = Path::new("C:/Users/Иван/AppData/Local/org.polyzon.maker");
        let got = plain_path(data, &data.join("packs/trellis2/weights"));
        assert_eq!(got, Path::new("../../packs/trellis2/weights"));
        assert!(got.to_str().unwrap().is_ascii());
        // a folder chosen elsewhere stays as it is
        assert_eq!(plain_path(data, Path::new("D:/models/w")), Path::new("D:/models/w"));
    }

    #[test]
    fn only_a_real_file_counts_as_a_result() {
        let dir = std::env::temp_dir().join(format!("maker-out-{}", store::random_id()));
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("model.glb");
        assert!(verify(&p, "model").is_err());
        fs::write(&p, b"glTF").unwrap();
        assert!(verify(&p, "model").is_err(), "too small");
        fs::write(&p, [b"glTF".as_slice(), &[0u8; 2000]].concat()).unwrap();
        assert!(verify(&p, "model").is_ok());
        assert!(verify(&p, "picture").is_err());
    }
}
