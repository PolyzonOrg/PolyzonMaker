//! Installing a model so that nobody has to meet Python, CUDA or a terminal: every step can be
//! repeated, a finished step is not done twice, and the pack counts as installed only at the end.

use crate::{
    catalog::{self, Archive, Model, Runtime},
    download::{self, Failure},
    fence,
    hf::HfFile,
    plugins,
    store::{self, Store},
    sys,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::AppHandle;

pub const RUNNER: &str = include_str!("../../../../tools/bench/runner.py");

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Installed {
    pub id: String,
    pub device: String,
    pub version: u32,
    pub at: u64,
    /// For a model from Hugging Face: its name and its one file
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub file: String,
    /// "text" for a text model from Hugging Face
    #[serde(default)]
    pub kind: String,
    /// A text model that came with its vision file
    #[serde(default)]
    pub vision: bool,
    /// Set when it is read: the record is there, but what it needs to start is not
    #[serde(default)]
    pub broken: bool,
}

/// The picture engine that reads a single model file. Any picture pack carries the same one.
const PICTURE_ENGINE: &str = "zimage";
/// The text engine: any text model carries the same one.
const TEXT_ENGINE: &str = "gemma-4-e4b";

/// Letters and digits of a repository and a file, so that two sizes of one model are two packs.
pub fn text_pack_id(repo: &str, file: &str) -> String {
    let stem = file.rsplit('/').next().unwrap_or(file).trim_end_matches(".gguf");
    let plain: String = format!("{repo}-{stem}").chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' }).collect();
    format!("hf-{plain}")
}

/// What the page shows while a pack installs. Bytes are real; a step without bytes shows no percent.
#[derive(Serialize, Clone, Default)]
pub struct Progress {
    pub id: String,
    /// running, done, failed, cancelled
    pub state: String,
    /// tool, runtime, python, torch, packages, weights, check
    pub stage: String,
    pub done: u64,
    pub total: u64,
    pub error: String,
}

/// How long an install waits for a network that went away, from the last byte that arrived.
const PATIENCE: Duration = if cfg!(test) { Duration::from_millis(200) } else { Duration::from_secs(30 * 60) };
/// How often a waiting install looks whether the network is back.
const LOOK_AGAIN: Duration = if cfg!(test) { Duration::from_millis(10) } else { Duration::from_secs(10) };

/// What an install told last, and when bytes last arrived in it.
#[derive(Default)]
struct Heard {
    last: Progress,
    moved: Option<Instant>,
}

impl Heard {
    /// A step that only starts is not movement: a try that fails at once starts its steps again too.
    fn tell(&mut self, p: &Progress) {
        if p.stage == self.last.stage && p.done > self.last.done {
            self.moved = Some(Instant::now());
        }
        self.last = p.clone();
    }
}

/// Runs an install again after a network failure, so that a Wi-Fi or a VPN that goes away does not
/// end it: at once when bytes had arrived before it failed, as after a dropped line, and once the
/// network is back when it is down, saying so meanwhile. It ends as before when the network is there
/// and nothing arrived, when the engine's own check failed, and after PATIENCE without a byte.
fn patiently(cancel: &AtomicBool, heard: &Mutex<Heard>, emit: &dyn Fn(Progress), online: &dyn Fn() -> bool, run: &dyn Fn() -> Result<(), Failure>) -> Result<(), Failure> {
    let start = Instant::now();
    loop {
        let before = heard.lock().unwrap().moved;
        let result = run();
        if !matches!(result, Err(Failure::Network(_))) {
            return result;
        }
        let (moved, last) = {
            let heard = heard.lock().unwrap();
            (heard.moved, heard.last.clone())
        };
        if last.stage == "check" {
            return result;
        }
        let mut down = false;
        while !online() {
            if moved.unwrap_or(start).elapsed() >= PATIENCE {
                return result;
            }
            down = true;
            emit(Progress { error: "offline".into(), ..last.clone() });
            if !pause(cancel, LOOK_AGAIN) {
                return Err(Failure::Cancelled);
            }
        }
        if !down && moved == before {
            return result;
        }
        if cancel.load(Ordering::Relaxed) {
            return Err(Failure::Cancelled);
        }
    }
}

/// Waits, and says false at once when the install is cancelled meanwhile.
fn pause(cancel: &AtomicBool, time: Duration) -> bool {
    let until = Instant::now() + time;
    while Instant::now() < until {
        if cancel.load(Ordering::Relaxed) {
            return false;
        }
        std::thread::sleep(Duration::from_millis(50).min(time));
    }
    !cancel.load(Ordering::Relaxed)
}

/// Is there a network at all? An answer of any kind from a well-known server counts.
fn online() -> bool {
    let agent = download::agent();
    ["https://huggingface.co/", "https://github.com/", "https://maker.polyzon.org/"].iter().any(|url| agent.head(*url).call().is_ok())
}

#[derive(Default)]
pub struct Packs {
    running: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// One install at a time: models share downloads, tools and their half-written files
    line: Arc<Mutex<()>>,
}

/// Where a model is, in whichever folder it was installed; a new one goes to the current folder.
pub fn dir(store: &Store, id: &str) -> PathBuf {
    let found = store.pack_folders().into_iter().map(|f| f.join(id)).find(|p| p.join("installed.json").exists());
    found.unwrap_or_else(|| store.packs().join(id))
}

pub fn installed(store: &Store) -> Vec<Installed> {
    // one at a time: reading can mend an environment (mend_env writes into it), and two at once, as the page
    // can ask off the window's thread, tripped each other and called a whole model broken
    static ONE: Mutex<()> = Mutex::new(());
    let _one = ONE.lock().unwrap_or_else(|e| e.into_inner());
    let folders = store.pack_folders();
    let records = folders.iter().flat_map(|f| store::read_each::<Installed>(f, "installed.json")).collect::<Vec<_>>();
    // the same model can lie in two folders: the one that runs is the first, as in `dir`
    let mut seen = std::collections::HashSet::new();
    let whole: Vec<_> = records.into_iter().filter(|p| seen.insert(p.id.clone())).map(|p| checked(store, p)).collect();
    let halves: Vec<_> = folders.iter().flat_map(|f| unfinished(f)).filter(|p| seen.insert(p.id.clone())).collect();
    whole.into_iter().chain(halves).collect()
}

/// An install that stopped halfway holds gigabytes: it is listed, to be finished or removed.
fn unfinished(folder: &Path) -> Vec<Installed> {
    let started = |path: &Path| !path.join("installed.json").exists() && fs::read_dir(path).is_ok_and(|mut d| d.next().is_some());
    let entries = fs::read_dir(folder).into_iter().flatten().flatten();
    let halves = entries.filter(|e| started(&e.path())).map(|e| e.file_name().to_string_lossy().into_owned());
    // a Hugging Face one too: its parts can be gigabytes, and only a listed model can be removed. It is known
    // by the file it was getting, as a finished one is.
    halves
        .filter(|id| catalog::model(id).is_some() || id.starts_with("hf-"))
        .map(|id| {
            let file = if id.starts_with("hf-") { getting(&folder.join(&id)) } else { String::new() };
            Installed { id, file, broken: true, ..Installed::default() }
        })
        .collect()
}

/// The file an install of one stopped halfway: the first in its weights, without the `.part` of one not whole.
fn getting(pack: &Path) -> String {
    let first = fs::read_dir(pack.join("weights")).into_iter().flatten().flatten().next();
    first.map_or(String::new(), |e| e.file_name().to_string_lossy().trim_end_matches(".part").to_string())
}

/// What downloads left a week ago and more: parts of an install that was stopped or failed, an archive of a
/// version since replaced. Nothing else ever took them away, so they held gigabytes for good. Newer ones stay,
/// for an install to go on from where it stopped; all of them are downloads, fetched again when needed. A
/// folder of pieces is as old as the newest of them.
pub fn sweep_downloads(store: &Store) {
    let week = Duration::from_secs(7 * 24 * 3600);
    let newest = |p: &Path| -> Option<std::time::SystemTime> {
        if !p.is_dir() {
            return fs::metadata(p).and_then(|m| m.modified()).ok();
        }
        fs::read_dir(p).ok()?.flatten().filter_map(|e| e.metadata().and_then(|m| m.modified()).ok()).max()
    };
    for dir in store.pack_folders().into_iter().map(|f| f.join(".downloads")) {
        for path in fs::read_dir(&dir).into_iter().flatten().flatten().map(|e| e.path()) {
            if !newest(&path).and_then(|t| t.elapsed().ok()).is_some_and(|age| age > week) {
                continue;
            }
            let _ = if path.is_dir() { fs::remove_dir_all(&path) } else { fs::remove_file(&path) };
        }
    }
}

pub fn find(store: &Store, id: &str) -> Option<Installed> {
    let pack = fs::read(dir(store, id).join("installed.json")).ok().and_then(|b| serde_json::from_slice(&b).ok())?;
    Some(checked(store, pack))
}

fn checked(store: &Store, mut pack: Installed) -> Installed {
    pack.broken = !whole(store, &dir(store, &pack.id), &pack);
    pack
}

/// Whether a model can start. Its record says it was installed once, not that its files are still there.
fn whole(store: &Store, root: &Path, pack: &Installed) -> bool {
    match catalog::model(&pack.id).map(|m| m.runtime) {
        Some(Runtime::Python { weights_bytes, .. }) => {
            python_in(&root.join("env")).exists() && repo_root(&root.join("repo")).is_some() && (weights_bytes == 0 || has_weights(root)) && mend_env(store, root)
        }
        Some(Runtime::Native { exe, weights, .. }) => find_exe(&root.join("bin"), &exe).is_some() && weights.iter().all(|w| root.join("weights").join(&w.name).exists()),
        Some(Runtime::Plugin { code, weights, .. }) => {
            let code_ok = code.is_none() || repo_root(&root.join("code")).is_some();
            let weights_ok = weights.iter().all(|w| root.join("weights").join(&w.name).exists());
            root.join(".step-packages").exists() && code_ok && weights_ok && mend_env(store, root)
        }
        None => root.join("weights").join(&pack.file).exists(),
    }
}

fn has_weights(root: &Path) -> bool {
    ["hf", "u2net"].iter().any(|dir| fs::read_dir(root.join(dir)).is_ok_and(|mut d| d.next().is_some()))
}

fn cfg_value<'a>(cfg: &'a str, key: &str) -> Option<&'a str> {
    cfg.lines().find_map(|line| line.split_once('=').filter(|(k, _)| k.trim() == key).map(|(_, v)| v.trim()))
}

/// An environment names its Python by the full path, and that path stays behind when models change folders
/// by hand. Any Python of the same version will do: the environment is pointed at it. False: there is none.
pub fn mend_env(store: &Store, root: &Path) -> bool {
    let file = root.join("env").join("pyvenv.cfg");
    let Ok(cfg) = fs::read_to_string(&file) else { return false };
    let Some(home) = cfg_value(&cfg, "home") else { return false };
    let program = if cfg!(windows) { "python.exe" } else { "python3" };
    let env = root.join("env");
    if Path::new(home).join(program).exists() {
        // the path in the file is right, and that says nothing about the one built into the program
        return !path_built_in(&env) || relink(&env, &Path::new(home).join(program));
    }
    let version = cfg_value(&cfg, "version_info").unwrap_or("").split('.').take(2).collect::<Vec<_>>().join(".");
    let tools = store.pack_folders().into_iter().map(|f| f.join(".tools").join("python"));
    let Some(found) = tools.into_iter().find_map(|dir| interpreter(&dir, &version)) else { return false };
    let Some(new_home) = found.parent().map(|p| p.to_string_lossy().into_owned()) else { return false };
    if store::write_atomic(&file, cfg.replace(home, &new_home).as_bytes()).is_err() {
        return false;
    }
    relink(&env, &found)
}

/// An environment made by version starts through uv's small program. A folder renamed under it keeps
/// pyvenv.cfg right, as the move from the old name did, and leaves that program pointing nowhere.
fn path_built_in(env: &Path) -> bool {
    cfg!(windows) && fs::read(python_in(env)).is_ok_and(|bytes| bytes.windows(13).any(|w| w == b"uv trampoline"))
}

/// On these systems the environment's Python is a link to the real one.
#[cfg(unix)]
fn relink(env: &Path, python: &Path) -> bool {
    let link = python_in(env);
    let _ = fs::remove_file(&link);
    std::os::unix::fs::symlink(python, link).is_ok()
}

/// Here it is a small program. An environment made by version has the old path built into it, so it gets
/// the standard one, which reads the path from pyvenv.cfg.
#[cfg(not(unix))]
fn relink(env: &Path, python: &Path) -> bool {
    let Some(home) = python.parent() else { return false };
    ["python.exe", "pythonw.exe"].iter().all(|name| fs::copy(home.join("Lib/venv/scripts/nt").join(name), env.join("Scripts").join(name)).is_ok())
}

impl Packs {
    pub fn install(&self, app: AppHandle, store: Arc<Store>, id: String, device: String) -> Result<(), String> {
        let model = catalog::model(&id).ok_or("no such model")?;
        self.start(app, store, id, device, model, true, |job| job.run());
        Ok(())
    }

    /// One file from a Hugging Face repository, with the picture engine to run it. The file has no
    /// pinned hash: the person chose it from the open list, and only formats that hold data are taken.
    pub fn install_file(&self, app: AppHandle, store: Arc<Store>, repo: String, file: String, device: String) -> Result<String, String> {
        if !(file.ends_with(".safetensors") || file.ends_with(".gguf")) || file.contains("..") || repo.contains("..") {
            return Err("only .safetensors and .gguf files".into());
        }
        let id = format!("hf-{}", repo.replace(['/', '.'], "-").to_lowercase());
        let engine = catalog::model(PICTURE_ENGINE).expect("the catalog has a picture engine");
        let name = file.rsplit('/').next().unwrap_or(&file).to_string();
        let weights = [catalog::Weight { url: format!("https://huggingface.co/{repo}/resolve/main/{file}"), sha256: String::new(), size: 0, name }];
        self.start(app, store, id.clone(), device, Model { id: id.clone(), ..engine.clone() }, false, move |job| job.custom(&repo, &weights, ""));
        Ok(id)
    }

    /// A text model from Hugging Face: its parts and its vision file, each checked by hash.
    pub fn install_text(&self, app: AppHandle, store: Arc<Store>, repo: String, files: Vec<HfFile>, device: String) -> Result<String, String> {
        if repo.contains("..") || files.iter().any(|f| !f.name.ends_with(".gguf") || f.name.contains("..") || f.sha256.is_empty()) || files.is_empty() {
            return Err("only .gguf files with a hash".into());
        }
        let id = text_pack_id(&repo, &files[0].name);
        let engine = catalog::model(TEXT_ENGINE).expect("the catalog has a text engine");
        let weights: Vec<catalog::Weight> = files.iter().map(|f| catalog::Weight { url: format!("https://huggingface.co/{repo}/resolve/main/{}", f.name), sha256: f.sha256.clone(), size: f.size, name: f.name.rsplit('/').next().unwrap_or(&f.name).to_string() }).collect();
        self.start(app, store, id.clone(), device, Model { id: id.clone(), ..engine.clone() }, false, move |job| job.custom(&repo, &weights, "text"));
        Ok(id)
    }

    /// Every install goes through here, on its own thread and after the others: they share downloads, tools and
    /// half-written files. A second ask for one already on its way is that one. The Hugging Face installs once
    /// skipped the line and this check, so two could write one file at once and the second could not be stopped.
    /// `told`: a catalog model's install goes into the anonymous reports; one chosen on Hugging Face does not.
    #[allow(clippy::too_many_arguments)]
    fn start(&self, app: AppHandle, store: Arc<Store>, id: String, device: String, model: Model, told: bool, work: impl Fn(&Install) -> Result<(), Failure> + Send + 'static) {
        let cancel = Arc::new(AtomicBool::new(false));
        {
            let mut running = self.running.lock().unwrap();
            if running.contains_key(&id) {
                return;
            }
            running.insert(id.clone(), cancel.clone());
        }
        let line = self.line.clone();
        std::thread::spawn(move || {
            let _turn = line.lock().unwrap_or_else(|e| e.into_inner());
            let heard = Mutex::new(Heard::default());
            let emit = |p: Progress| {
                heard.lock().unwrap().tell(&p);
                crate::news(&app, "pack", p);
            };
            let started = std::time::Instant::now();
            let job = Install { store: &store, model: &model, device: &device, cancel: &cancel, emit: &emit };
            let result = patiently(&cancel, &heard, &emit, &online, &|| work(&job));
            let state = match &result {
                Ok(()) => "done",
                Err(Failure::Cancelled) => "cancelled",
                Err(_) => "failed",
            };
            let error = result.err().map_or(String::new(), |e| e.to_string());
            let seconds = started.elapsed().as_secs_f64();
            match state {
                "failed" if told => {
                    let code = error.split(':').next().unwrap_or("").replace(' ', "_");
                    crate::telemetry::event(&store, "install_failed", &id, &device, &code, seconds);
                }
                "done" if told => crate::telemetry::event(&store, "install_done", &id, &device, "", seconds),
                _ => {}
            }
            emit(Progress { id: id.clone(), state: state.into(), error, ..Progress::default() });
            let packs: tauri::State<Packs> = tauri::Manager::state(&app);
            packs.running.lock().unwrap().remove(&id);
        });
    }

    /// A model on its way in: its folder is being written
    pub fn installing(&self, id: &str) -> bool {
        self.running.lock().unwrap().contains_key(id)
    }

    pub fn busy(&self) -> bool {
        !self.running.lock().unwrap().is_empty()
    }

    pub fn stop(&self) {
        for flag in self.running.lock().unwrap().values() {
            flag.store(true, Ordering::Relaxed);
        }
        for _ in 0..30 {
            if !self.busy() {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    pub fn cancel(&self, id: &str) {
        if let Some(flag) = self.running.lock().unwrap().get(id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

pub fn remove(store: &Store, id: &str) -> Result<(), String> {
    store::safe_name(id)?;
    for path in store.pack_folders().into_iter().map(|f| f.join(id)).filter(|p| p.exists()) {
        // the record first: a locked file further on must not leave a model that looks whole
        let _ = fs::remove_file(path.join("installed.json"));
        fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
    }
    // what uv keeps is only of use to models that need Python
    if !installed(store).iter().any(|p| matches!(catalog::model(&p.id).map(|m| m.runtime), Some(Runtime::Python { .. } | Runtime::Plugin { .. }))) {
        for folder in store.pack_folders() {
            let _ = fs::remove_dir_all(folder.join(".uv-cache"));
        }
    }
    Ok(())
}

struct Install<'a> {
    store: &'a Store,
    model: &'a Model,
    device: &'a str,
    cancel: &'a AtomicBool,
    emit: &'a (dyn Fn(Progress) + Sync),
}

impl Install<'_> {
    /// An install runs as gently as a generation: the person may be working while models arrive
    fn gentle(&self) -> bool {
        self.store.settings().gentle
    }

    fn stage(&self, stage: &str, done: u64, total: u64) {
        (self.emit)(Progress {
            id: self.model.id.clone(),
            state: "running".into(),
            stage: stage.into(),
            done,
            total,
            error: String::new(),
        });
    }

    fn run(&self) -> Result<(), Failure> {
        if self.cancel.load(Ordering::Relaxed) {
            return Err(Failure::Cancelled); // stopped while it waited for its turn
        }
        let root = dir(self.store, &self.model.id);
        fs::create_dir_all(&root).map_err(disk)?;
        match &self.model.runtime {
            Runtime::Native { exe, archives, weights, .. } => self.native(&root, exe, archives, weights)?,
            Runtime::Python { .. } => self.python(&root)?,
            Runtime::Plugin { .. } => self.plugin(&root)?,
        }
        let done = Installed { id: self.model.id.clone(), device: self.device.into(), version: catalog::version(), at: store::now(), name: String::new(), file: String::new(), kind: String::new(), vision: false, broken: false };
        let json = serde_json::to_vec_pretty(&done).map_err(|e| Failure::Disk(e.to_string()))?;
        store::write_atomic(&root.join("installed.json"), &json).map_err(disk)
    }

    fn custom(&self, repo: &str, weights: &[catalog::Weight], kind: &str) -> Result<(), Failure> {
        let root = dir(self.store, &self.model.id);
        fs::create_dir_all(&root).map_err(disk)?;
        let Runtime::Native { exe, archives, .. } = &self.model.runtime else { return Ok(()) };
        self.native(&root, exe, archives, weights)?;
        let vision = weights.iter().any(|w| w.name.contains("mmproj"));
        let done = Installed { id: self.model.id.clone(), device: self.device.into(), version: 0, at: store::now(), name: repo.into(), file: weights[0].name.clone(), kind: kind.into(), vision, broken: false };
        let json = serde_json::to_vec_pretty(&done).map_err(|e| Failure::Disk(e.to_string()))?;
        store::write_atomic(&root.join("installed.json"), &json).map_err(disk)
    }

    fn fetch(&self, urls: Vec<String>, dest: &Path, sha: &str, stage: &str, base: u64, all: u64) -> Result<(), Failure> {
        let agent = download::agent();
        download::fetch(&agent, &urls, dest, sha, self.cancel, &mut |done, _| self.stage(stage, base + done, all))
    }

    fn native(&self, root: &Path, exe: &str, archives: &HashMap<String, Vec<Archive>>, weights: &[catalog::Weight]) -> Result<(), Failure> {
        let key = format!("{}-{}", catalog::os_key(), self.device);
        let parts = archives.get(&key).ok_or_else(|| Failure::Network(format!("no build for {key}")))?;
        let bin = root.join("bin");
        let unpacked = bin.join(format!(".ok-{}", self.device));
        if !unpacked.exists() {
            let all = parts.iter().map(|p| p.size).sum();
            let mut base = 0;
            for part in parts {
                let name = part.url.rsplit('/').next().unwrap_or("runtime.zip");
                let arc = self.store.downloads().join(name);
                self.fetch(vec![part.url.clone()], &arc, &part.sha256, "runtime", base, all)?;
                download::unpack(&arc, &bin).map_err(Failure::Disk)?;
                let _ = fs::remove_file(&arc);
                base += part.size;
            }
            let program = find_exe(&bin, exe).ok_or_else(|| Failure::Disk(format!("{exe} did not unpack")))?;
            self.visual_cpp(program.parent().unwrap_or(&bin))?;
            fs::write(&unpacked, "ok").map_err(disk)?;
        }
        let all = weights.iter().map(|w| w.size).sum();
        let mut base = 0;
        let mirror = !hf_open();
        for w in weights {
            let mut urls = vec![w.url.clone()];
            let other = w.url.replace("https://huggingface.co/", "https://hf-mirror.com/");
            if mirror { urls.insert(0, other) } else { urls.push(other) }
            self.fetch(urls, &root.join("weights").join(&w.name), &w.sha256, "weights", base, all)?;
            base += w.size;
        }
        Ok(())
    }

    fn step(&self, root: &Path, name: &str, work: impl FnOnce() -> Result<(), Failure>) -> Result<(), Failure> {
        let mark = root.join(format!(".step-{name}"));
        if mark.exists() {
            return Ok(());
        }
        work()?;
        fs::write(mark, "ok").map_err(disk)
    }

    fn python(&self, root: &Path) -> Result<(), Failure> {
        let Runtime::Python { engine, python, torch, torchvision, repo_url, packages, weights_bytes, cut, variant } = &self.model.runtime else {
            return Ok(());
        };
        let uv = self.uv()?;
        let log = root.join("install.log");
        let env_dir = root.join("env");
        let repo = root.join("repo");
        fs::write(root.join("runner.py"), RUNNER).map_err(disk)?;

        // an install over a damaged model: what is gone is done again, and only that
        if repo_root(&repo).is_none() {
            let _ = fs::remove_file(root.join(".step-repo"));
        }
        if !python_in(&env_dir).exists() {
            for step in ["python", "torch", "packages"] {
                let _ = fs::remove_file(root.join(format!(".step-{step}")));
            }
        }
        if !has_weights(root) {
            let _ = fs::remove_file(root.join(".step-weights"));
        }
        let earlier = fs::read(root.join("installed.json")).ok().and_then(|b| serde_json::from_slice::<Installed>(&b).ok());
        if earlier.is_some_and(|was| was.device != self.device) {
            let _ = fs::remove_file(root.join(".step-torch"));
        }
        self.step(root, "repo", || {
            self.stage("runtime", 0, 0);
            let arc = self.store.downloads().join(format!("{}-repo.zip", self.model.id));
            self.fetch(vec![repo_url.clone()], &arc, "", "runtime", 0, 0)?;
            let _ = fs::remove_dir_all(&repo);
            // no hash to check it by: one that will not unpack goes, or every try after would fail on it
            if let Err(e) = download::unpack(&arc, &repo) {
                let _ = fs::remove_file(&arc);
                return Err(Failure::Disk(e));
            }
            let _ = fs::remove_file(&arc);
            Ok(())
        })?;
        let tool = |args: &[&str]| self.tool(&uv, args);
        self.step(root, "python", || {
            self.stage("python", 0, 0);
            self.make_env(&uv, python, &env_dir, &log)
        })?;
        if !mend_env(self.store, root) {
            self.stage("python", 0, 0);
            self.fetch_python(&uv, python, &log)?;
            if !mend_env(self.store, root) {
                return Err(Failure::Disk("the environment cannot find its Python".into()));
            }
        }
        let py = python_in(&env_dir);
        let py_text = py.to_string_lossy().into_owned();
        let cache = self.store.packs().join(".uv-cache");
        self.step(root, "torch", || self.torch(&uv, &py_text, torch, torchvision, &log))?;
        self.step(root, "packages", || {
            self.stage("packages", 0, 0);
            let list = root.join("requirements.txt");
            fs::write(&list, packages.join("\n")).map_err(disk)?;
            let list_text = list.to_string_lossy().into_owned();
            let install = || self.call(tool(&["pip", "install", "--python", &py_text, "-r", &list_text]), &log);
            self.watching("packages", &[&cache], PACKAGES_BYTES, install)
        })?;
        let repo_root = repo_root(&repo).ok_or_else(|| Failure::Disk("the engine's code did not unpack".into()))?;
        let script = root.join("runner.py");
        self.step(root, "weights", || {
            let fetch = |stalled: &AtomicBool| self.prefetch(&py, &script, engine, variant, &repo_root, *cut, root, &log, stalled);
            // what a resumed download already has counts: `done` starts from it
            let (hf, cutter) = (root.join("hf"), root.join("u2net"));
            self.watching_from(0, "weights", &[&hf, &cutter], *weights_bytes, Some(WEIGHTS_PATIENCE), fetch)
        })?;
        self.stage("check", 0, 0);
        let device = self.device.to_string();
        let mut check = sys::engine(&py, self.gentle());
        check.arg(&script).args([engine.as_str(), "--repo"]).arg(root).args(["--check", "--device", &device]);
        cache_env(&mut check, root, false);
        self.call(check, &log)
    }

    fn torch(&self, uv: &Path, py: &str, torch: &str, torchvision: &str, log: &Path) -> Result<(), Failure> {
        self.stage("torch", 0, 0);
        let (torch_pin, vision_pin) = (format!("torch=={torch}"), format!("torchvision=={torchvision}"));
        // the same version built for another device counts as installed for uv: it is put in again
        let mut args = vec!["pip", "install", "--python", py, &torch_pin, &vision_pin, "--reinstall-package", "torch", "--reinstall-package", "torchvision"];
        let index = torch_index(self.device, crate::hardware::cuda(), crate::hardware::compute_capability());
        if let Some(url) = &index {
            args.extend(["--index-url", url]);
        }
        let size = if self.device == "cuda" { TORCH_CUDA_BYTES } else { TORCH_CPU_BYTES };
        let cache = self.store.packs().join(".uv-cache");
        self.watching("torch", &[&cache], size, || self.call(self.tool(uv, &args), log))
    }

    /// A plugin's model (PLUGINS.md). What it brings is fetched by the app and checked against its hash,
    /// and none of it runs outside the plugin's fence: packages come only as built wheels, so none runs
    /// code to build itself, and an environment that packages reached halfway is made again, not mended,
    /// since a package's startup file would run in any step of ours that starts its Python.
    fn plugin(&self, root: &Path) -> Result<(), Failure> {
        let Runtime::Plugin { python, torch, torchvision, code, packages, weights, adapter, plugin } = &self.model.runtime else { return Ok(()) };
        if !fence::READY {
            return Err(Failure::Fenced("FENCE_MISSING"));
        }
        let uv = self.uv()?;
        let log = root.join("install.log");
        let env_dir = root.join("env");
        let earlier = fs::read(root.join("installed.json")).ok().and_then(|b| serde_json::from_slice::<Installed>(&b).ok());
        if !root.join(".step-packages").exists() || earlier.is_some_and(|was| was.device != self.device) {
            let _ = fs::remove_dir_all(&env_dir);
            for step in ["python", "torch", "packages"] {
                let _ = fs::remove_file(root.join(format!(".step-{step}")));
            }
        }
        if let Some(code) = code {
            self.step(root, "code", || {
                let arc = self.store.downloads().join(format!("{}-code.zip", self.model.id));
                self.fetch(vec![code.url.clone()], &arc, &code.sha256, "runtime", 0, code.size)?;
                let _ = fs::remove_dir_all(root.join("code"));
                download::unpack(&arc, &root.join("code")).map_err(Failure::Disk)?;
                let _ = fs::remove_file(&arc);
                Ok(())
            })?;
        }
        self.step(root, "python", || {
            self.stage("python", 0, 0);
            self.make_env(&uv, python, &env_dir, &log)
        })?;
        if !mend_env(self.store, root) {
            return Err(Failure::Disk("the environment cannot find its Python".into()));
        }
        let py_text = python_in(&env_dir).to_string_lossy().into_owned();
        if !torch.is_empty() {
            self.step(root, "torch", || self.torch(&uv, &py_text, torch, torchvision, &log))?;
        }
        self.step(root, "packages", || {
            self.stage("packages", 0, 0);
            let list = root.join("requirements.txt");
            fs::write(&list, packages.join("\n")).map_err(disk)?;
            let list_text = list.to_string_lossy().into_owned();
            let cache = self.store.packs().join(".uv-cache");
            let install = || self.call(self.tool(&uv, &["pip", "install", "--python", &py_text, "--no-build", "-r", &list_text]), &log);
            self.watching("packages", &[&cache], PACKAGES_BYTES, install)
        })?;
        let all = weights.iter().map(|w| w.size).sum();
        let mut base = 0;
        for w in weights {
            let other = w.url.replace("https://huggingface.co/", "https://hf-mirror.com/");
            let urls = if other == w.url { vec![other] } else if hf_open() { vec![w.url.clone(), other] } else { vec![other, w.url.clone()] };
            self.fetch(urls, &root.join("weights").join(&w.name), &w.sha256, "weights", base, all)?;
            base += w.size;
        }
        self.stage("fence", 0, 0);
        fence_in(self.store, plugin, root).map_err(Failure::Disk)?;
        self.stage("check", 0, 0);
        if fence_open(self.store, plugin, root) {
            return Err(Failure::Fenced("FENCE_OPEN"));
        }
        let mut check = plugin_program(self.store, plugin, adapter, root, &root.join("run"), false).map_err(Failure::Disk)?;
        check.args(["--check", "--device", self.device]);
        self.call(check, &log)
    }

    #[allow(clippy::too_many_arguments)]
    fn prefetch(&self, py: &Path, script: &Path, engine: &str, variant: &str, repo: &Path, cut: bool, root: &Path, log: &Path, stalled: &AtomicBool) -> Result<(), Failure> {
        let run = |name: &str| {
            let mut c = sys::engine(py, self.gentle());
            c.arg(script).args([name, "--repo"]).arg(repo).arg("--prefetch");
            if !variant.is_empty() {
                c.args(["--variant", variant]);
            }
            cache_env(&mut c, root, !hf_open());
            self.call_until(c, log, stalled)
        };
        run(engine)?;
        if cut { run("cut") } else { Ok(()) }
    }

    /// Runs `work` and reports what lands in `folder` meanwhile: uv and the models' own downloads say
    /// nothing while they work, so what has reached the disk is the only measure there is.
    fn watching<T>(&self, stage: &str, folders: &[&Path], expected: u64, work: impl FnOnce() -> T) -> T {
        let from = folders.iter().map(|f| store::dir_size(f)).sum();
        self.watching_from(from, stage, folders, expected, None, |_| work())
    }

    /// With `patience`, `work` is told through its flag once nothing new has landed for that long.
    fn watching_from<T>(&self, from: u64, stage: &str, folders: &[&Path], expected: u64, patience: Option<Duration>, work: impl FnOnce(&AtomicBool) -> T) -> T {
        let (finished, stalled) = (AtomicBool::new(false), AtomicBool::new(false));
        std::thread::scope(|s| {
            s.spawn(|| {
                let (mut most, mut moved) = (0, Instant::now());
                while !finished.load(Ordering::Relaxed) {
                    let landed: u64 = folders.iter().map(|f| store::dir_size(f)).sum();
                    if landed > most {
                        (most, moved) = (landed, Instant::now());
                    }
                    if patience.is_some_and(|p| moved.elapsed() > p) {
                        stalled.store(true, Ordering::Relaxed);
                    }
                    self.stage(stage, landed.saturating_sub(from).min(expected), expected);
                    std::thread::sleep(Duration::from_secs(1));
                }
            });
            let result = work(&stalled);
            finished.store(true, Ordering::Relaxed);
            result
        })
    }

    /// uv with everything kept in our folder: no links on PATH, no Windows registry entries, none of
    /// the person's uv settings, the computer's own certificates for networks that inspect traffic.
    fn tool(&self, uv: &Path, args: &[&str]) -> Command {
        let mut c = sys::engine(uv, self.gentle());
        c.args(args);
        let scratch = self.store.packs().join(".tmp");
        let _ = fs::create_dir_all(&scratch);
        c.env("TEMP", &scratch).env("TMP", &scratch).env("TMPDIR", &scratch);
        c.env("UV_NO_CONFIG", "1");
        c.env("UV_SYSTEM_CERTS", "1");
        c.env("UV_PYTHON_INSTALL_DIR", self.store.tools().join("python"));
        c.env("UV_CACHE_DIR", self.store.packs().join(".uv-cache"));
        c.env("UV_PYTHON_INSTALL_BIN", "0");
        c.env("UV_PYTHON_INSTALL_REGISTRY", "0");
        c
    }

    /// uv's Python, with what it needs to start.
    fn fetch_python(&self, uv: &Path, python: &str, log: &Path) -> Result<PathBuf, Failure> {
        // uv can fail on its version link and still leave a good Python: the file decides, not the exit
        if let Err(Failure::Cancelled) = self.call(self.tool(uv, &["python", "install", python]), log) {
            return Err(Failure::Cancelled);
        }
        let interpreter = interpreter(&self.store.tools().join("python"), python).ok_or_else(|| Failure::Network(tail(log)))?;
        self.visual_cpp(interpreter.parent().ok_or_else(|| Failure::Disk("no folder for Python".into()))?)?;
        Ok(interpreter)
    }

    /// An environment made from that very file.
    fn make_env(&self, uv: &Path, python: &str, env: &Path, log: &Path) -> Result<(), Failure> {
        let interpreter = self.fetch_python(uv, python, log)?;
        let (from, to) = (interpreter.to_string_lossy(), env.to_string_lossy());
        self.call(self.tool(uv, &["venv", "--clear", "--python", &from, &to]), log)
    }

    /// The Visual C++ libraries beside the program that needs them, on Windows. A fresh system may not
    /// have them and an old copy in System32 has crashed newer builds; the program's folder wins over
    /// both and takes no administrator rights.
    fn visual_cpp(&self, beside: &Path) -> Result<(), Failure> {
        let Some(archive) = catalog::vcrt(&format!("{}-{}", catalog::os_key(), std::env::consts::ARCH)) else { return Ok(()) };
        const LAST: &str = "vcruntime140_1.dll";
        let dir = self.store.tools().join("vcrt");
        if find_file(&dir, LAST).is_none() {
            let file = archive.url.rsplit('/').next().unwrap_or("vcrt.whl");
            let arc = self.store.downloads().join(file);
            self.fetch(vec![archive.url.clone()], &arc, &archive.sha256, "tool", 0, archive.size)?;
            download::unpack(&arc, &dir).map_err(Failure::Disk)?;
            let _ = fs::remove_file(&arc);
        }
        let found = find_file(&dir, LAST).ok_or_else(|| Failure::Disk("the Visual C++ libraries did not unpack".into()))?;
        let libraries = fs::read_dir(found.parent().unwrap_or(&dir)).map_err(disk)?;
        for dll in libraries.flatten().filter(|e| e.file_name().to_string_lossy().ends_with(".dll")) {
            fs::copy(dll.path(), beside.join(dll.file_name())).map_err(disk)?;
        }
        Ok(())
    }

    /// Runs a tool with its output in `log`; stops it when the install is cancelled.
    fn call(&self, c: Command, log: &Path) -> Result<(), Failure> {
        self.call_until(c, log, &AtomicBool::new(false))
    }

    /// The same, and stopped as a network failure when `stalled` says nothing arrives any more.
    fn call_until(&self, mut c: Command, log: &Path, stalled: &AtomicBool) -> Result<(), Failure> {
        let mut out = fs::OpenOptions::new().create(true).append(true).open(log).map_err(disk)?;
        writeln!(out, "\n$ {c:?}").map_err(disk)?;
        c.stdout(Stdio::from(out.try_clone().map_err(disk)?)).stderr(Stdio::from(out));
        let mut child = sys::start(&mut c, self.gentle()).map_err(disk)?;
        loop {
            if self.cancel.load(Ordering::Relaxed) {
                sys::kill_tree(&mut child);
                return Err(Failure::Cancelled);
            }
            if stalled.load(Ordering::Relaxed) {
                sys::kill_tree(&mut child);
                return Err(Failure::Network(format!("nothing arrived for a long while
{}", tail(log))));
            }
            match child.try_wait().map_err(disk)? {
                Some(s) if s.success() => return Ok(()),
                Some(_) => return Err(failed_command(tail(log))),
                None => std::thread::sleep(Duration::from_millis(200)),
            }
        }
    }

    /// The uv binary, fetched once and shared by every Python pack.
    fn uv(&self) -> Result<PathBuf, Failure> {
        let dir = self.store.tools().join("uv");
        let name = if cfg!(windows) { "uv.exe" } else { "uv" };
        if let Some(found) = find_file(&dir, name) {
            return Ok(found);
        }
        let key = format!("{}-{}", catalog::os_key(), std::env::consts::ARCH);
        let archive = catalog::uv(&key).ok_or_else(|| Failure::Network(format!("no uv for {key}")))?;
        let file = archive.url.rsplit('/').next().unwrap_or("uv.zip");
        let arc = self.store.downloads().join(file);
        self.fetch(vec![archive.url.clone()], &arc, &archive.sha256, "tool", 0, archive.size)?;
        // into a folder of its own first: a program cut off halfway must not count as there
        let fresh = self.store.tools().join("uv-new");
        let _ = fs::remove_dir_all(&fresh);
        download::unpack(&arc, &fresh).map_err(Failure::Disk)?;
        let _ = fs::remove_dir_all(&dir);
        fs::rename(&fresh, &dir).map_err(disk)?;
        let _ = fs::remove_file(&arc);
        let uv = find_file(&dir, name).ok_or_else(|| Failure::Disk("uv did not unpack".into()))?;
        make_runnable(&uv).map_err(disk)?;
        Ok(uv)
    }
}

/// Roughly what uv unpacks into its cache, measured from the wheels of torch 2.7.1
const TORCH_CUDA_BYTES: u64 = 5_500 << 20;
const TORCH_CPU_BYTES: u64 = 450 << 20;
/// Before its first byte the engine starts Python and its libraries, and Hugging Face writes 10 MB
/// at a time: five quiet minutes is a download that has stopped, not a slow one.
const WEIGHTS_PATIENCE: Duration = Duration::from_secs(300);
const PACKAGES_BYTES: u64 = 1 << 30;

/// The interpreter uv unpacked for `version`, by its folder: cpython-3.10.22-windows-x86_64-none.
fn interpreter(dir: &Path, version: &str) -> Option<PathBuf> {
    let name = if cfg!(windows) { "python.exe" } else { "bin/python3" };
    let start = format!("cpython-{version}.");
    // a fixed place and not a search: the standard library holds a stub called python.exe
    let home = fs::read_dir(dir).ok()?.flatten().find(|e| e.file_name().to_string_lossy().starts_with(&start))?;
    Some(home.path().join(name)).filter(|p| p.exists())
}

pub fn python_in(env: &Path) -> PathBuf {
    env.join(if cfg!(windows) { "Scripts/python.exe" } else { "bin/python" })
}

pub fn repo_root(repo: &Path) -> Option<PathBuf> {
    fs::read_dir(repo).ok()?.flatten().map(|e| e.path()).find(|p| p.is_dir())
}

/// The Python an environment was made from, where its own launcher finds it.
fn base_python(env: &Path) -> Option<PathBuf> {
    let cfg = fs::read_to_string(env.join("pyvenv.cfg")).ok()?;
    let name = if cfg!(windows) { "python.exe" } else { "python3" };
    Some(Path::new(cfg_value(&cfg, "home")?).join(name)).filter(|p| p.exists())
}

/// What a plugin's program may reach: its model's folder to read, three folders in it to write in, the
/// Python it runs on, and the plugin's own files. Asked again, it changes nothing.
pub fn fence_in(store: &Store, plugin: &str, root: &Path) -> Result<(), String> {
    let python = base_python(&root.join("env")).ok_or("the environment has no Python")?;
    let name = fence::name(plugin);
    for (path, write) in [(root.to_path_buf(), false), (root.join("tmp"), true), (root.join("cache"), true), (root.join("run"), true)] {
        fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        fence::grant(&name, &path, write)?;
    }
    fence::grant(&name, python.parent().ok_or("no folder for Python")?, false)?;
    fence::grant(&name, &plugins::folder(store).join(plugin), false)
}

/// Whether the fence leaves the network open on this computer and the person has not said it may run so.
pub fn fence_open(store: &Store, plugin: &str, root: &Path) -> bool {
    let Some(python) = base_python(&root.join("env")) else { return true };
    let allowed = store.settings().plugins.get(plugin).is_some_and(|g| g.network);
    !allowed && fence::open_here(&fence::name(plugin), &root.join("run"), &python)
}

/// A plugin model's program inside its fence, in `folder`: the Python it was made from, started as the
/// environment's own launcher would start it (the fence lets nothing start a second program), with its
/// file and where its weights and code lie. The caller adds what to make.
pub fn plugin_program(store: &Store, plugin: &str, adapter: &str, root: &Path, folder: &Path, gentle: bool) -> Result<Command, String> {
    let env = root.join("env");
    let python = base_python(&env).ok_or("the environment has no Python")?;
    let mut c = fence::command(&fence::name(plugin), folder, &python, gentle)?;
    c.arg(plugins::folder(store).join(plugin).join(adapter));
    c.arg("--weights").arg(root.join("weights"));
    if let Some(code) = repo_root(&root.join("code")) {
        c.arg("--code").arg(code);
    }
    cache_env(&mut c, root, false);
    c.env("__PYVENV_LAUNCHER__", python_in(&env)).env("PYTHONNOUSERSITE", "1").env("PYTHONPYCACHEPREFIX", root.join("cache").join("pyc"));
    c.env("HF_HUB_OFFLINE", "1");
    Ok(c)
}

/// Where models look for weights, inside the pack; nothing outside it is touched.
/// MPS's high and low marks for the share of the Mac's memory that is counted.
fn mps_marks(share: f64) -> (String, String) {
    let share = share.clamp(0.05, 1.0);
    (format!("{share:.2}"), format!("{:.2}", share * 0.8))
}

pub fn cache_env(c: &mut Command, root: &Path, mirror: bool) {
    c.env("HF_HOME", root.join("hf")).env("U2NET_HOME", root.join("u2net")).env("PYTHONUNBUFFERED", "1");
    c.env("TORCH_HOME", root.join("torch")).env("XDG_CACHE_HOME", root.join("cache")).env("HF_HUB_DISABLE_TELEMETRY", "1");
    c.env("PYTHONIOENCODING", "utf-8");
    // the model's folder is on the disk the person chose; the system disk may be full
    let scratch = root.join("tmp");
    let _ = fs::create_dir_all(&scratch);
    c.env("TEMP", &scratch).env("TMP", &scratch).env("TMPDIR", &scratch);
    // hf-xet stalls with 0 bytes on large checkpoints where plain HTTPS runs (xet-core #869, #883),
    // and plain HTTPS is what the folder watch sees grow and what resumes a cut download
    c.env("HF_HUB_DISABLE_XET", "1");
    // an operation Apple's graphics lack runs on the processor instead of stopping the model, as
    // Hunyuan3D's authors advise for Macs; elsewhere torch never reads it
    c.env("PYTORCH_ENABLE_MPS_FALLBACK", "1");
    // torch lets MPS take 1.7 times what macOS recommends, past the memory the Mac has: Hunyuan3D-2.1 then
    // swapped a 24 GB Mac to a halt. At 1.0 MPS says it is out of memory instead, which the app can tell.
    // The low mark, where MPS starts to give memory back, may not stand over the high one. A smaller Mac tried
    // out on this one (POLYZON_RAM_MB) gets its share of the marks.
    let (high, low) = mps_marks(crate::hardware::counted_share(crate::hardware::real_total_mb()));
    c.env("PYTORCH_MPS_HIGH_WATERMARK_RATIO", high).env("PYTORCH_MPS_LOW_WATERMARK_RATIO", low);
    if mirror {
        c.env("HF_ENDPOINT", "https://hf-mirror.com");
    }
}

/// The driver decides which CUDA build runs: RTX 50 cards need 12.8, an old driver cannot load it.
/// An RTX 50 runs only the 12.8 build; cards before the RTX 20 are left out of it, so they take 12.6.
fn torch_index(device: &str, cuda: f32, capability: Option<f32>) -> Option<String> {
    let tag = match device {
        "cuda" if cuda >= 12.8 && capability.is_none_or(|c| c >= 7.5) => "cu128",
        "cuda" if cuda >= 12.6 => "cu126",
        "cuda" => "cu118",
        "cpu" if !cfg!(target_os = "macos") => "cpu",
        _ => return None, // the plain build for Apple's chips
    };
    Some(format!("https://download.pytorch.org/whl/{tag}"))
}

/// Can Hugging Face be reached from here? From some countries it cannot.
fn hf_open() -> bool {
    download::agent().head("https://huggingface.co/").call().is_ok_and(|r| r.status().as_u16() < 500)
}

fn find_file(dir: &Path, name: &str) -> Option<PathBuf> {
    for entry in fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_file(&path, name) {
                return Some(found);
            }
        } else if entry.file_name() == name {
            return Some(path);
        }
    }
    None
}

pub fn find_exe(root: &Path, name: &str) -> Option<PathBuf> {
    let exe = find_file(root, &format!("{name}{}", std::env::consts::EXE_SUFFIX))?;
    make_runnable(&exe).ok()?;
    Some(exe)
}

/// Zip archives do not keep the executable bit.
fn make_runnable(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(path)?.permissions().mode();
        fs::set_permissions(path, fs::Permissions::from_mode(mode | 0o111))?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

fn tail(log: &Path) -> String {
    let text = fs::read_to_string(log).unwrap_or_default();
    let cut = text.char_indices().rev().nth(1200).map_or(0, |(i, _)| i);
    text[cut..].to_string()
}

fn disk(e: io::Error) -> Failure {
    Failure::Disk(e.to_string())
}

/// What a command that ended badly says about itself, from its log's tail. A package with no build for this
/// computer, or one that does not compile here, fails the same way every time; a lost connection may not.
fn failed_command(tail: String) -> Failure {
    let last = tail.rsplit("\n$ ").next().unwrap_or_default(); // the log holds earlier commands too
    let offline = ["Failed to fetch", "Failed to download", "error sending request"].iter().any(|m| last.contains(m));
    let build = ["Failed to build", "No solution found", "matching platform tag"].iter().any(|m| last.contains(m));
    if build && !offline { Failure::Build(tail) } else { Failure::Network(tail) }
}

/// A model with everything it needs to count as whole, for tests of what comes after an install.
#[cfg(test)]
pub fn install_for_tests(store: &Store, id: &str, device: &str) {
    let root = store.packs().join(id);
    let Some(Runtime::Native { exe, weights, .. }) = catalog::model(id).map(|m| m.runtime) else { panic!("{id} is not a native model") };
    fs::create_dir_all(root.join("bin")).unwrap();
    fs::create_dir_all(root.join("weights")).unwrap();
    fs::write(root.join("bin").join(format!("{exe}{}", std::env::consts::EXE_SUFFIX)), "engine").unwrap();
    for weight in weights {
        fs::write(root.join("weights").join(weight.name), "weights").unwrap();
    }
    let record = Installed { id: id.into(), device: device.into(), version: 1, at: 1, ..Installed::default() };
    fs::write(root.join("installed.json"), serde_json::to_vec(&record).unwrap()).unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An install as `patiently` sees it: each try reports bytes and ends as the script says.
    struct Tries {
        heard: Mutex<Heard>,
        told: Mutex<Vec<Progress>>,
        tries: Mutex<usize>,
    }

    impl Tries {
        fn new() -> Self {
            Tries { heard: Mutex::new(Heard::default()), told: Mutex::new(Vec::new()), tries: Mutex::new(0) }
        }

        fn emit(&self, p: Progress) {
            self.heard.lock().unwrap().tell(&p);
            self.told.lock().unwrap().push(p);
        }

        /// `script(try) -> (bytes that arrive, at which stage, how it ends)`
        fn run(&self, cancel: &AtomicBool, online: &dyn Fn() -> bool, script: impl Fn(usize) -> (u64, &'static str, Result<(), Failure>)) -> Result<(), Failure> {
            let run = || {
                let n = {
                    let mut tries = self.tries.lock().unwrap();
                    *tries += 1;
                    *tries
                };
                let (bytes, stage, end) = script(n);
                self.emit(Progress { stage: stage.into(), done: 0, ..Progress::default() });
                for done in (1..=bytes).map(|b| b * 1000) {
                    self.emit(Progress { stage: stage.into(), done, ..Progress::default() });
                }
                end
            };
            patiently(cancel, &self.heard, &|p| self.emit(p), online, &run)
        }

        fn tries(&self) -> usize {
            *self.tries.lock().unwrap()
        }

        fn said_offline(&self) -> bool {
            self.told.lock().unwrap().iter().any(|p| p.error == "offline")
        }
    }

    fn lost() -> Result<(), Failure> {
        Err(Failure::Network("the line went quiet".into()))
    }

    #[test]
    fn a_download_whose_line_dropped_carries_on_by_itself() {
        let t = Tries::new();
        let got = t.run(&AtomicBool::new(false), &|| true, |n| if n == 1 { (5, "weights", lost()) } else { (3, "weights", Ok(())) });
        assert!(got.is_ok());
        assert_eq!(t.tries(), 2);
    }

    #[test]
    fn an_install_that_lost_the_network_waits_for_it_and_carries_on() {
        let t = Tries::new();
        let looks = Mutex::new(0);
        let online = || {
            let mut looks = looks.lock().unwrap();
            *looks += 1;
            *looks > 3 // the Wi-Fi is back at the fourth look
        };
        let got = t.run(&AtomicBool::new(false), &online, |n| if n == 1 { (0, "weights", lost()) } else { (2, "weights", Ok(())) });
        assert!(got.is_ok());
        assert_eq!(t.tries(), 2);
        assert!(t.said_offline(), "the page heard why it waits");
    }

    #[test]
    fn a_network_failure_with_the_network_there_and_nothing_arriving_ends_the_install() {
        let t = Tries::new();
        let got = t.run(&AtomicBool::new(false), &|| true, |_| (0, "weights", lost()));
        assert!(matches!(got, Err(Failure::Network(_))));
        assert_eq!(t.tries(), 1);
    }

    #[test]
    fn a_failed_check_of_the_engine_is_not_tried_again() {
        let t = Tries::new();
        let got = t.run(&AtomicBool::new(false), &|| false, |_| (1, "check", lost()));
        assert!(matches!(got, Err(Failure::Network(_))));
        assert_eq!(t.tries(), 1);
    }

    #[test]
    fn other_failures_end_the_install_at_once() {
        let t = Tries::new();
        let got = t.run(&AtomicBool::new(false), &|| false, |_| (4, "weights", Err(Failure::Disk("no space".into()))));
        assert!(matches!(got, Err(Failure::Disk(_))));
        assert_eq!(t.tries(), 1);
    }

    #[test]
    fn a_network_that_does_not_come_back_ends_the_install_after_a_while() {
        let t = Tries::new();
        let started = Instant::now();
        let got = t.run(&AtomicBool::new(false), &|| false, |_| (1, "weights", lost()));
        assert!(matches!(got, Err(Failure::Network(_))));
        assert!(started.elapsed() >= PATIENCE && t.said_offline());
    }

    #[test]
    fn cancelling_while_it_waits_for_the_network_stops_it() {
        let t = Tries::new();
        let cancel = AtomicBool::new(false);
        let online = || {
            cancel.store(true, Ordering::Relaxed);
            false
        };
        let got = t.run(&cancel, &online, |_| (1, "weights", lost()));
        assert!(matches!(got, Err(Failure::Cancelled)));
    }

    #[test]
    fn a_package_that_does_not_build_here_is_not_called_a_network_failure() {
        // what uv said on an Apple Silicon Mac for TripoSR (2026-11-09)
        let xatlas = "  × Failed to build `xatlas==0.0.9`\n  ├─▶ The build backend returned an error\n  ╰─▶ Call to `scikit_build_core.build.build_wheel` failed (exit status: 1)\n      hint: This usually indicates a problem with the package or the build environment.";
        assert!(matches!(failed_command(xatlas.into()), Failure::Build(_)));
        let resolve = "  × No solution found when resolving dependencies:\n  ╰─▶ Because torch==2.7.1 has no wheels with a matching platform tag (e.g., `macosx_14_0_x86_64`)";
        assert!(matches!(failed_command(resolve.into()), Failure::Build(_)));
        let offline = "error: Failed to fetch: `https://pypi.org/simple/numpy/`\n  Caused by: error sending request for url";
        assert!(matches!(failed_command(offline.into()), Failure::Network(_)));
        assert!(Failure::Build("x".into()).to_string().starts_with("build: "));
    }

    #[test]
    fn a_pack_counts_as_installed_only_with_its_record() {
        let d = std::env::temp_dir().join(format!("maker-packs-{}", store::random_id()));
        let s = Store::open(d.join("c"), d.join("d")).unwrap();
        fs::create_dir_all(dir(&s, "half")).unwrap();
        fs::create_dir_all(dir(&s, "whole")).unwrap();
        let rec = Installed { id: "whole".into(), device: "cpu".into(), version: 1, at: 1, name: String::new(), file: String::new(), kind: String::new(), vision: false, broken: false };
        fs::write(dir(&s, "whole").join("installed.json"), serde_json::to_vec(&rec).unwrap()).unwrap();
        let ids: Vec<_> = installed(&s).into_iter().map(|i| i.id).collect();
        assert_eq!(ids, ["whole"]);
        remove(&s, "whole").unwrap();
        assert!(installed(&s).is_empty());
        assert!(remove(&s, "../jobs").is_err());
    }

    #[test]
    fn model_weights_come_over_plain_https_not_xet() {
        // hf-xet 1.8 sat at 0 bytes on Hunyuan3D-2.1's one 7.4 GB checkpoint on a Mac (2026-11-10)
        let mut c = Command::new("python");
        cache_env(&mut c, Path::new("pack"), false);
        assert!(c.get_envs().any(|(k, v)| k == "HF_HUB_DISABLE_XET" && v == Some("1".as_ref())));
    }

    #[test]
    fn an_operation_apple_graphics_lack_runs_on_the_processor_instead_of_stopping_the_model() {
        // TripoSG on an M4 Pro: `aten::max_pool3d_with_indices` is not implemented for MPS (bench 2026-11-05c)
        let mut c = Command::new("python");
        cache_env(&mut c, Path::new("pack"), false);
        assert!(c.get_envs().any(|(k, v)| k == "PYTORCH_ENABLE_MPS_FALLBACK" && v == Some("1".as_ref())));
    }

    #[test]
    fn graphics_memory_on_a_mac_stops_at_what_the_system_can_give_and_never_swaps_the_mac_to_a_halt() {
        // torch's own limit lets MPS take 1.7 times what macOS recommends: past the memory the Mac has
        let mut c = Command::new("python");
        cache_env(&mut c, Path::new("pack"), false);
        let env = |name: &str| c.get_envs().find(|(k, _)| *k == name).and_then(|(_, v)| v).and_then(|v| v.to_str()).map(str::to_string);
        assert_eq!(env("PYTORCH_MPS_HIGH_WATERMARK_RATIO").as_deref(), Some("1.00"));
        // the low mark may not stand over the high one, or torch refuses to start on the Mac
        let low: f32 = env("PYTORCH_MPS_LOW_WATERMARK_RATIO").unwrap().parse().unwrap();
        // an 8 GB Mac tried out on a 24 GB one gets a third of the marks
        assert_eq!(mps_marks(8192.0 / 24576.0), ("0.33".to_string(), "0.27".to_string()));
        assert_eq!(mps_marks(3.0).0, "1.00", "never past what macOS recommends");
        assert!(low <= 1.0, "{low}");
    }

    #[test]
    fn a_download_that_gets_nothing_is_stopped_and_one_that_trickles_is_not() {
        let (d, s) = scratch();
        let model = catalog::model("triposr").unwrap();
        let cancel = AtomicBool::new(false);
        let install = Install { store: &s, model: &model, device: "cpu", cancel: &cancel, emit: &|_| {} };
        let folder = d.join("hf");
        fs::create_dir_all(&folder).unwrap();
        let forever = if cfg!(windows) { ["ping", "-n", "600", "127.0.0.1"].as_slice() } else { ["sleep", "600"].as_slice() };
        let mut c = sys::engine(forever[0], false);
        c.args(&forever[1..]);
        let started = std::time::Instant::now();
        let got = install.watching_from(0, "weights", &[&folder], 100, Some(Duration::from_secs(2)), |stalled| install.call_until(c, &d.join("log"), stalled));
        assert!(matches!(got, Err(Failure::Network(_))), "{got:?}");
        assert!(started.elapsed() < Duration::from_secs(30));
        let trickle = |stalled: &AtomicBool| {
            for i in 0..12 {
                fs::write(folder.join("part"), vec![0; 10 * (i + 1)]).unwrap();
                std::thread::sleep(Duration::from_millis(300));
            }
            stalled.load(Ordering::Relaxed)
        };
        assert!(!install.watching_from(0, "weights", &[&folder], 1000, Some(Duration::from_secs(2)), trickle));
        let _ = fs::remove_dir_all(d);
    }

    fn scratch() -> (PathBuf, Store) {
        let d = std::env::temp_dir().join(format!("maker-packs-{}", store::random_id()));
        let s = Store::open(d.join("c"), d.join("d")).unwrap();
        (d, s)
    }

    #[test]
    fn a_hugging_face_install_stopped_halfway_is_listed_so_it_can_be_removed() {
        let (_d, s) = scratch();
        fs::create_dir_all(s.packs().join("hf-someone-model/weights")).unwrap();
        fs::write(s.packs().join("hf-someone-model/weights/model.gguf.part"), b"gigabytes").unwrap();
        // the app's own folders are no model
        fs::create_dir_all(s.downloads()).unwrap();
        fs::write(s.downloads().join("x.part"), b"half").unwrap();
        let half = installed(&s);
        assert_eq!(half.iter().map(|p| (p.id.as_str(), p.broken)).collect::<Vec<_>>(), [("hf-someone-model", true)]);
        assert_eq!(half[0].file, "model.gguf", "the file it was getting, which the person knows it by");
        remove(&s, "hf-someone-model").unwrap();
        assert!(!s.packs().join("hf-someone-model").exists());
    }

    #[test]
    fn downloads_left_a_week_go_and_newer_ones_stay_to_go_on_from() {
        let (_d, s) = scratch();
        let downloads = s.downloads();
        fs::create_dir_all(downloads.join("hunyuan.zip.pieces")).unwrap();
        for name in ["old.zip.part", "new.zip.part", "hunyuan.zip.pieces/0"] {
            fs::write(downloads.join(name), b"half").unwrap();
        }
        let week_ago = std::time::SystemTime::now() - Duration::from_secs(8 * 24 * 3600);
        for name in ["old.zip.part", "hunyuan.zip.pieces/0"] {
            fs::File::options().write(true).open(downloads.join(name)).unwrap().set_modified(week_ago).unwrap();
        }
        // a folder is as old as the newest thing in it
        fs::File::options().write(true).open(downloads.join("hunyuan.zip.pieces/0")).unwrap();
        sweep_downloads(&s);
        assert!(!downloads.join("old.zip.part").exists(), "a part left for a week stays");
        assert!(!downloads.join("hunyuan.zip.pieces").exists(), "pieces left for a week stay");
        assert!(downloads.join("new.zip.part").exists(), "a recent part went: it could go on from where it stopped");
    }

    /// An environment as this system makes one: its Python in Scripts on Windows, in bin elsewhere
    fn env_pointing_at(root: &Path, home: &str) {
        let python = python_in(&root.join("env"));
        fs::create_dir_all(python.parent().unwrap()).unwrap();
        fs::write(&python, "the old path built in").unwrap();
        fs::write(root.join("env/pyvenv.cfg"), format!("home = {home}\nimplementation = CPython\nversion_info = 3.10.22\n")).unwrap();
    }

    fn python_in_folder(folder: &Path, version: &str) -> PathBuf {
        let program = folder.join(".tools/python").join(format!("cpython-{version}-windows-x86_64-none")).join(if cfg!(windows) { "python.exe" } else { "bin/python3" });
        fs::create_dir_all(program.parent().unwrap()).unwrap();
        fs::write(&program, "python").unwrap();
        let stubs = program.with_file_name("Lib/venv/scripts/nt");
        fs::create_dir_all(&stubs).unwrap();
        fs::write(stubs.join("python.exe"), "starts Python by pyvenv.cfg").unwrap();
        fs::write(stubs.join("pythonw.exe"), "starts Python by pyvenv.cfg").unwrap();
        program.parent().unwrap().to_path_buf()
    }

    #[test]
    fn a_model_moved_by_hand_finds_the_python_that_moved_with_it() {
        let (d, s) = scratch();
        let folder = d.join("moved");
        s.set_models_folder(&folder.to_string_lossy()).unwrap();
        let root = folder.join("triposr");
        env_pointing_at(&root, "C:/gone/.tools/python/cpython-3.10.22-windows-x86_64-none");
        let home = python_in_folder(&folder, "3.10.22");
        assert!(mend_env(&s, &root));
        let cfg = fs::read_to_string(root.join("env/pyvenv.cfg")).unwrap();
        assert_eq!(Path::new(cfg_value(&cfg, "home").unwrap()), home);
        assert!(cfg.contains("version_info = 3.10.22"), "the rest of the file stays");
        if cfg!(windows) {
            assert_eq!(fs::read_to_string(root.join("env/Scripts/python.exe")).unwrap(), "starts Python by pyvenv.cfg");
        } else {
            assert_eq!(fs::read_link(python_in(&root.join("env"))).unwrap(), home.join("python3"));
        }
    }

    #[test]
    fn a_program_with_an_old_path_built_in_is_replaced_though_the_file_is_right() {
        let (_d, s) = scratch();
        let home = python_in_folder(&s.packs(), "3.10.22");
        let root = s.packs().join("triposr");
        env_pointing_at(&root, &home.to_string_lossy());
        fs::write(python_in(&root.join("env")), "error: uv trampoline failed to spawn Python").unwrap();
        assert!(mend_env(&s, &root));
        if cfg!(windows) {
            assert_eq!(fs::read_to_string(python_in(&root.join("env"))).unwrap(), "starts Python by pyvenv.cfg");
        }
    }

    #[test]
    fn a_python_in_the_earlier_folder_serves_too() {
        let (d, s) = scratch();
        python_in_folder(&s.packs(), "3.10.20");
        let folder = d.join("new");
        s.set_models_folder(&folder.to_string_lossy()).unwrap();
        let root = folder.join("triposr");
        env_pointing_at(&root, "C:/gone");
        assert!(mend_env(&s, &root));
    }

    #[test]
    fn without_a_python_of_that_version_the_environment_stays_as_it_was() {
        let (_d, s) = scratch();
        python_in_folder(&s.packs(), "3.12.4");
        let root = s.packs().join("triposr");
        env_pointing_at(&root, "C:/gone");
        assert!(!mend_env(&s, &root));
        assert!(fs::read_to_string(root.join("env/pyvenv.cfg")).unwrap().contains("home = C:/gone"));
    }

    fn record(s: &Store, id: &str, file: &str) {
        let rec = Installed { id: id.into(), device: "cpu".into(), version: 1, at: 1, name: String::new(), file: file.into(), kind: String::new(), vision: false, broken: false };
        fs::create_dir_all(dir(s, id)).unwrap();
        fs::write(dir(s, id).join("installed.json"), serde_json::to_vec(&rec).unwrap()).unwrap();
    }

    #[test]
    fn a_record_without_its_files_does_not_count_as_a_working_model() {
        let (_d, s) = scratch();
        record(&s, "triposr", "");
        record(&s, "hf-model", "model.gguf");
        assert!(installed(&s).iter().all(|p| p.broken));
        assert!(find(&s, "triposr").unwrap().broken);
        fs::create_dir_all(dir(&s, "hf-model").join("weights")).unwrap();
        fs::write(dir(&s, "hf-model").join("weights/model.gguf"), "weights").unwrap();
        assert!(!find(&s, "hf-model").unwrap().broken);
    }

    #[test]
    fn an_install_that_stopped_halfway_is_listed_and_can_be_removed() {
        let (_d, s) = scratch();
        fs::create_dir_all(s.packs().join("triposr/weights")).unwrap();
        fs::create_dir_all(s.packs().join("empty-folder")).unwrap();
        fs::create_dir_all(s.packs().join("trellis2")).unwrap();
        let listed = installed(&s);
        assert_eq!(listed.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(), ["triposr"]);
        assert!(listed[0].broken);
        remove(&s, "triposr").unwrap();
        assert!(installed(&s).is_empty() && !s.packs().join("triposr").exists());
    }

    #[test]
    fn removing_a_model_clears_every_folder_that_holds_it() {
        let (d, s) = scratch();
        record(&s, "hf-model", "model.gguf");
        s.set_models_folder(&d.join("new").to_string_lossy()).unwrap();
        record(&s, "hf-model", "model.gguf");
        remove(&s, "hf-model").unwrap();
        assert!(installed(&s).is_empty());
    }

    #[test]
    fn what_uv_keeps_goes_with_the_last_model_that_needs_python() {
        let (_d, s) = scratch();
        fs::create_dir_all(s.packs().join(".uv-cache")).unwrap();
        record(&s, "triposr", "");
        record(&s, "hunyuan-mini", "");
        remove(&s, "triposr").unwrap();
        assert!(s.packs().join(".uv-cache").exists());
        remove(&s, "hunyuan-mini").unwrap();
        assert!(!s.packs().join(".uv-cache").exists());
    }

    #[test]
    fn a_model_lying_in_two_folders_counts_once() {
        let (d, s) = scratch();
        record(&s, "hf-model", "model.gguf");
        s.set_models_folder(&d.join("new").to_string_lossy()).unwrap();
        fs::create_dir_all(s.packs().join("hf-model")).unwrap();
        fs::copy(s.data().join("packs/hf-model/installed.json"), s.packs().join("hf-model/installed.json")).unwrap();
        assert_eq!(installed(&s).len(), 1);
    }

    #[test]
    fn nvidia_gets_the_cuda_build_and_the_rest_the_small_one() {
        assert!(torch_index("cuda", 13.3, Some(12.0)).unwrap().ends_with("cu128"));
        assert!(torch_index("cuda", 13.3, None).unwrap().ends_with("cu128"));
        assert!(torch_index("cuda", 13.3, Some(6.1)).unwrap().ends_with("cu126"), "a GTX 10 cannot run the newest build");
        assert!(torch_index("cuda", 12.6, None).unwrap().ends_with("cu126"));
        assert!(torch_index("cuda", 11.8, None).unwrap().ends_with("cu118"));
        assert!(torch_index("mps", 0.0, None).is_none());
        if !cfg!(target_os = "macos") {
            assert!(torch_index("cpu", 0.0, None).unwrap().ends_with("/cpu"));
        }
    }

    #[test]
    fn the_python_is_found_by_its_version_folder() {
        let d = std::env::temp_dir().join(format!("maker-py-{}", store::random_id()));
        let name = if cfg!(windows) { "python.exe" } else { "bin/python3" };
        let real = d.join("cpython-3.10.22-windows-x86_64-none").join(name);
        fs::create_dir_all(real.parent().unwrap()).unwrap();
        fs::write(&real, "x").unwrap();
        // the standard library holds a stub with the same name, and venv refuses it
        let stub = d.join("cpython-3.10.22-windows-x86_64-none/Lib/venv/scripts/nt");
        fs::create_dir_all(&stub).unwrap();
        fs::write(stub.join("python.exe"), "stub").unwrap();
        fs::write(stub.join("python3"), "stub").unwrap();
        fs::create_dir_all(d.join("cpython-3.10-windows-x86_64-none")).unwrap(); // the minor version link
        assert_eq!(interpreter(&d, "3.10"), Some(real));
        assert_eq!(interpreter(&d, "3.12"), None);
    }

    #[test]
    fn a_model_keeps_working_after_the_folder_changes() {
        let d = std::env::temp_dir().join(format!("maker-move-{}", store::random_id()));
        let s = Store::open(d.join("c"), d.join("d")).unwrap();
        let first = d.join("first");
        s.set_models_folder(first.to_str().unwrap()).unwrap();
        fs::create_dir_all(first.join("trellis2")).unwrap();
        fs::write(first.join("trellis2/installed.json"), r#"{"id":"trellis2","device":"cuda","version":1,"at":1}"#).unwrap();
        s.set_models_folder(d.join("second").to_str().unwrap()).unwrap();
        assert_eq!(dir(&s, "trellis2"), first.join("trellis2"));
        assert_eq!(find(&s, "trellis2").unwrap().device, "cuda");
        assert_eq!(installed(&s).len(), 1);
        assert_eq!(dir(&s, "triposr"), d.join("second").join("triposr"));
        remove(&s, "trellis2").unwrap();
        assert!(installed(&s).is_empty() && !first.join("trellis2").exists());
    }

    /// The real uv and the real Python, twice over: the second time finds Python already there. The
    /// computer is as hostile as it gets: any of these reaching uv or Python would break them.
    #[test]
    #[ignore = "downloads uv and Python"]
    fn the_real_python_step_makes_an_environment() {
        for (name, value) in [
            ("PYTHONHOME", "/nowhere"),
            ("PYTHONPATH", "/nowhere"),
            ("VIRTUAL_ENV", "/nowhere"),
            ("CONDA_PREFIX", "/nowhere"),
            ("UV_OFFLINE", "1"),
            ("UV_PYTHON_PREFERENCE", "only-system"),
            ("UV_PYTHON_DOWNLOADS", "never"),
            ("UV_PYTHON_INSTALL_DIR", "/nowhere"),
            ("UV_DEFAULT_INDEX", "http://127.0.0.1:9/simple"),
        ] {
            std::env::set_var(name, value);
        }
        let d = std::env::temp_dir().join(format!("maker-env-{}", store::random_id()));
        let s = Store::open(d.join("c"), d.join("d")).unwrap();
        let model = catalog::model("triposr").unwrap();
        let cancel = AtomicBool::new(false);
        let install = Install { store: &s, model: &model, device: "cpu", cancel: &cancel, emit: &|_| {} };
        let uv = install.uv().unwrap();
        let (env, log) = (d.join("env"), d.join("install.log"));
        for _ in 0..2 {
            let made = install.make_env(&uv, "3.10", &env, &log);
            assert!(made.is_ok(), "{}", tail(&log));
            let version = sys::engine(python_in(&env), false).arg("--version").output().unwrap();
            assert!(String::from_utf8_lossy(&version.stdout).starts_with("Python 3.10"), "{version:?}");
        }
        // and packages reach the environment over the network, whatever the computer is set to
        let py = python_in(&env);
        let wheel = install.tool(&uv, &["pip", "install", "--python", &py.to_string_lossy(), "idna==3.20"]);
        assert!(install.call(wheel, &log).is_ok(), "{}", tail(&log));
        // the libraries a fresh Windows lacks come from our folder, not from the system
        #[cfg(windows)]
        {
            let code = "import ctypes; b = ctypes.create_unicode_buffer(600); \
                ctypes.windll.kernel32.GetModuleFileNameW(ctypes.c_void_p(ctypes.WinDLL('msvcp140.dll')._handle), b, 600); print(b.value)";
            let out = sys::engine(python_in(&env), false).args(["-c", code]).output().unwrap();
            let path = String::from_utf8_lossy(&out.stdout).to_lowercase();
            assert!(path.contains(".tools"), "{path} {}", String::from_utf8_lossy(&out.stderr));
        }
    }

    /// Real servers, real files, nothing is run: `cargo test -- --ignored`.
    #[test]
    #[ignore = "downloads from GitHub and Hugging Face"]
    fn the_real_files_arrive_whole_resume_and_unpack() {
        let dir = std::env::temp_dir().join(format!("maker-real-{}", store::random_id()));
        let agent = download::agent();
        let Runtime::Native { archives, weights, .. } = catalog::model("trellis2").unwrap().runtime else { panic!() };

        // stopped halfway, then carried on: the hash decides whether the two halves make the file
        let engine = &archives["windows-vulkan"][0];
        let arc = dir.join("engine.zip");
        let cancel = AtomicBool::new(false);
        let stopped = download::fetch(&agent, std::slice::from_ref(&engine.url), &arc, &engine.sha256, &cancel, &mut |done, _| {
            if done > 4 << 20 {
                cancel.store(true, Ordering::Relaxed);
            }
        });
        assert!(matches!(stopped, Err(Failure::Cancelled)));
        assert!(!arc.exists());
        download::fetch(&agent, std::slice::from_ref(&engine.url), &arc, &engine.sha256, &AtomicBool::new(false), &mut |_, _| {}).unwrap();
        assert_eq!(fs::metadata(&arc).unwrap().len(), engine.size);
        download::unpack(&arc, &dir.join("bin")).unwrap();
        assert!(find_exe(&dir.join("bin"), "trellis-cli").is_some());

        // a weight file through Hugging Face's redirect, checked against its pinned hash
        let w = weights.iter().find(|w| w.name == "ss_dec.gguf").unwrap();
        let dest = dir.join("weights").join(&w.name);
        download::fetch(&agent, std::slice::from_ref(&w.url), &dest, &w.sha256, &AtomicBool::new(false), &mut |_, _| {}).unwrap();
        assert_eq!(fs::metadata(&dest).unwrap().len(), w.size);

        // the tool every Python model needs, for this system
        let uv = catalog::uv(&format!("{}-{}", catalog::os_key(), std::env::consts::ARCH)).unwrap();
        let arc = dir.join(uv.url.rsplit('/').next().unwrap());
        download::fetch(&agent, std::slice::from_ref(&uv.url), &arc, &uv.sha256, &AtomicBool::new(false), &mut |_, _| {}).unwrap();
        download::unpack(&arc, &dir.join("uv")).unwrap();
        assert!(find_exe(&dir.join("uv"), "uv").is_some());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_text_pack_is_named_as_the_page_names_it() {
        assert_eq!(text_pack_id("unsloth/Gemma-4.0", "sub/m-Q4_K_M.gguf"), "hf-unsloth-gemma-4-0-m-q4-k-m");
    }

    #[test]
    fn the_runner_ships_with_the_app_and_reports_stages() {
        assert!(RUNNER.contains("\"done\": name"));
    }
}
