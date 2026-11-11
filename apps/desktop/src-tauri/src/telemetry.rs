//! Anonymous reports, only after a yes (TZ §18.2): what happened and on what kind of machine, so that
//! the next update can fix what really goes wrong. A record is short codes and rounded numbers: never a
//! picture, a prompt, a file name or a path. Records wait in a small file and leave when there is a
//! network; a failed send costs the person nothing.

use crate::{hardware::Hardware, store::Store};
use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};

const ENDPOINT: &str = "https://maker.polyzon.org/api/events";
/// What the server takes at a time
const BATCH: usize = 100;
/// Records kept when nothing can be sent; the oldest go first
const MAX_WAITING: usize = 500;
/// What the page may report; everything else comes from here
const FROM_PAGE: [&str; 6] = ["print_done", "print_failed", "slicer_opened", "job_rated", "ui_error", "assistant_done"];

static WRITING: Mutex<()> = Mutex::new(());
static SENDING: AtomicBool = AtomicBool::new(false);
static CRASH_NOTE: OnceLock<PathBuf> = OnceLock::new();

fn file(store: &Store) -> PathBuf {
    store.data().join("telemetry.jsonl")
}

fn outbox(store: &Store) -> PathBuf {
    store.data().join("telemetry.sending")
}

fn crash_note(data: &Path) -> PathBuf {
    data.join("crash.note")
}

/// A short code, not free text: free text can hold a path.
fn clean(code: &str) -> String {
    code.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_').take(40).collect()
}

fn record(id: &str, event: &str, model: &str, device: &str, code: &str, seconds: f64) -> Value {
    // which model someone chose from Hugging Face is their business and stays on their computer
    let model = if model.starts_with("hf-") { "custom" } else { model };
    json!({
        "id": id,
        "app": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "event": clean(event),
        "model": clean(model),
        "device": clean(device),
        "code": clean(code),
        "seconds": seconds.round(),
    })
}

/// What records look like, for the consent screen.
pub fn sample() -> Value {
    json!([
        record("0123456789abcdef", "app_start", "", "nvidia_16g", "ram_24g", 0.0),
        record("0123456789abcdef", "job_failed", "trellis2", "vulkan", "GPU_OOM_1024_seq", 42.0),
        record("0123456789abcdef", "job_rated", "hunyuanmini", "cuda", "bad_flat_small", 0.0),
    ])
}

/// Failed Python ends with the name of what went wrong: the name alone, as what follows it can hold a path.
pub fn exception(log: &str) -> Option<String> {
    log.lines().rev().find_map(|line| {
        let name = line.split(':').next()?.trim();
        let short = name.rsplit('.').next()?;
        let looks = short.ends_with("Error") || short.ends_with("Exception") || short == "KeyboardInterrupt";
        (looks && short.chars().all(|c| c.is_ascii_alphanumeric())).then(|| short.to_string())
    })
}

/// A card and memory in round numbers: enough to see what runs where, and no way to tell one computer.
pub fn machine(hardware: &Hardware) -> (String, String) {
    let round = |mb: u64, step: u64| (mb + step * 512) / (step * 1024) * step;
    let cuda = |g: &crate::hardware::Gpu| match g.vendor.as_str() {
        "nvidia" if g.cuda >= 1.0 => format!("_cu{}", g.cuda as u32),
        "nvidia" => "_nocuda".to_string(),
        _ => String::new(),
    };
    let card = hardware.gpus.first().map_or("none".to_string(), |g| format!("{}_{}g{}", g.vendor, round(g.vram_mb, 2), cuda(g)));
    (card, format!("ram_{}g", round(hardware.ram_mb, 4)))
}

fn yes(store: &Store) -> Option<String> {
    let s = store.settings();
    (s.analytics == Some(true)).then_some(s.install_id)
}

fn keep(store: &Store, line: &Value) {
    let _writing = WRITING.lock().unwrap();
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(file(store)) {
        let _ = writeln!(f, "{line}");
    }
}

/// Keeps a record and sends what waits, on another thread: a slow network must not hold up the queue.
pub fn event(store: &Arc<Store>, event: &str, model: &str, device: &str, code: &str, seconds: f64) {
    let Some(id) = yes(store) else { return };
    keep(store, &record(&id, event, model, device, code, seconds));
    let store = store.clone();
    std::thread::spawn(move || send(&store));
}

pub fn from_page(store: &Arc<Store>, name: &str, model: &str, device: &str, code: &str, seconds: f64) {
    if FROM_PAGE.contains(&name) {
        event(store, name, model, device, code, seconds);
    }
}

fn post(rows: &[Value]) -> bool {
    crate::download::agent()
        .post(ENDPOINT)
        .header("Content-Type", "application/json")
        .send(json!({ "events": rows }).to_string())
        .is_ok_and(|r| r.status().is_success())
}

/// Takes what waits out of the way of new records, sends it in batches, and keeps what did not leave.
fn flush(store: &Store, deliver: impl Fn(&[Value]) -> bool) {
    {
        let _writing = WRITING.lock().unwrap();
        if !outbox(store).exists() && fs::rename(file(store), outbox(store)).is_err() {
            return;
        }
    }
    let Ok(text) = fs::read_to_string(outbox(store)) else { return };
    let rows: Vec<Value> = text.lines().filter_map(|l| serde_json::from_str(l).ok()).collect();
    let rows = &rows[rows.len().saturating_sub(MAX_WAITING)..];
    let mut sent = 0;
    for batch in rows.chunks(BATCH) {
        if !deliver(batch) {
            break;
        }
        sent += batch.len();
    }
    if sent == rows.len() {
        let _ = fs::remove_file(outbox(store));
    } else {
        let left: Vec<String> = rows[sent..].iter().map(Value::to_string).collect();
        let _ = fs::write(outbox(store), left.join("\n") + "\n");
    }
}

/// Sends what is waiting; on any failure the records stay for the next time.
pub fn send(store: &Store) {
    if store.settings().analytics != Some(true) {
        let _writing = WRITING.lock().unwrap();
        let _ = fs::remove_file(file(store));
        let _ = fs::remove_file(outbox(store));
        return;
    }
    if !SENDING.swap(true, Ordering::SeqCst) {
        flush(store, post);
        SENDING.store(false, Ordering::SeqCst);
    }
}

/// A panic ends the process at once: only a note on the disk outlives it, with where and never what,
/// since a message can hold a path. The next start reports it.
pub fn note_crashes(data: &Path) {
    let _ = CRASH_NOTE.set(crash_note(data));
    std::panic::set_hook(Box::new(|info| {
        if let (Some(note), Some(at)) = (CRASH_NOTE.get(), info.location()) {
            let name = at.file().rsplit(['/', '\\']).next().unwrap_or("");
            let _ = fs::write(note, format!("{name}_{}", at.line()).replace('.', "_"));
        }
    }));
}

/// What happens once per start, on its own thread: a report of the machine and of the crash before.
pub fn started(store: &Arc<Store>, hardware: &Hardware) {
    let (card, memory) = machine(hardware);
    event(store, "app_start", "", &card, &memory, 0.0);
    if let Ok(place) = fs::read_to_string(crash_note(store.data())) {
        event(store, "app_crash", "", &card, &place, 0.0);
        let _ = fs::remove_file(crash_note(store.data()));
    }
    send(store);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hardware::Gpu;
    use crate::store::{random_id, Settings};
    use std::cell::Cell;

    fn store(analytics: Option<bool>) -> Arc<Store> {
        let d = std::env::temp_dir().join(format!("maker-tel-{}", random_id()));
        let s = Store::open(d.join("c"), d.join("d")).unwrap();
        s.save_settings(Settings { analytics, install_id: "id".into(), ..s.settings() }).unwrap();
        Arc::new(s)
    }

    fn lines(path: &Path) -> usize {
        fs::read_to_string(path).map_or(0, |t| t.lines().count())
    }

    #[test]
    fn nothing_is_kept_before_a_yes() {
        for answer in [None, Some(false)] {
            let s = store(answer);
            event(&s, "job_failed", "trellis2", "cpu", "GPU_OOM", 3.0);
            assert!(!file(&s).exists());
        }
    }

    #[test]
    fn a_record_cannot_carry_a_path_or_a_prompt() {
        let r = record("x", "job_failed", "m", "d", "C:\\Users\\Ivan\\Мои фото\\кот.png", 1.0);
        let code = r["code"].as_str().unwrap();
        assert!(!code.contains('\\') && !code.contains(':') && !code.contains('.') && !code.contains(' '));
        assert!(code.len() <= 40);
        assert_eq!(sample()[1]["code"], "GPU_OOM_1024_seq");
    }

    #[test]
    fn a_model_from_hugging_face_is_nobodys_business() {
        let r = record("x", "job_failed", "hf-some_person-uncensored_model", "cuda", "", 1.0);
        assert_eq!(r["model"], "custom");
        assert_eq!(record("x", "job_failed", "trellis2", "cuda", "", 1.0)["model"], "trellis2");
    }

    #[test]
    fn a_no_after_a_yes_drops_what_was_waiting() {
        let s = store(Some(true));
        fs::write(file(&s), "{}\n").unwrap();
        fs::write(outbox(&s), "{}\n").unwrap();
        s.save_settings(Settings { analytics: Some(false), ..s.settings() }).unwrap();
        send(&s);
        assert!(!file(&s).exists() && !outbox(&s).exists());
    }

    #[test]
    fn the_name_of_what_failed_is_taken_and_the_rest_of_the_line_is_not() {
        let log = "Traceback (most recent call last):\n  File \"C:\\Users\\Ivan\\x.py\", line 3\nKeyError: 'C:\\\\Users\\\\Ivan\\\\кот.png'\n";
        assert_eq!(exception(log).as_deref(), Some("KeyError"));
        assert_eq!(exception("torch.cuda.OutOfMemoryError: CUDA out of memory").as_deref(), Some("OutOfMemoryError"));
        assert_eq!(exception("[E] generate failed --- main.cpp:926"), None);
    }

    #[test]
    fn a_machine_is_told_in_round_numbers() {
        let hardware = |vram_mb, cuda, ram_mb| Hardware { gpus: vec![Gpu { vendor: "nvidia".into(), vram_mb, cuda, ..Gpu::default() }], ram_mb, ..Hardware::default() };
        assert_eq!(machine(&hardware(16303, 13.3, 24417)), ("nvidia_16g_cu13".to_string(), "ram_24g".to_string()));
        // a card whose CUDA the program could not see is what reports should show first
        assert_eq!(machine(&hardware(8188, 0.0, 15900)), ("nvidia_8g_nocuda".to_string(), "ram_16g".to_string()));
        let amd = Hardware { gpus: vec![Gpu { vendor: "amd".into(), vram_mb: 16368, ..Gpu::default() }], ram_mb: 32000, ..Hardware::default() };
        assert_eq!(machine(&amd).0, "amd_16g");
        assert_eq!(machine(&Hardware { ram_mb: 8000, ..Hardware::default() }), ("none".to_string(), "ram_8g".to_string()));
    }

    #[test]
    fn the_page_reports_only_what_it_is_allowed_to() {
        let s = store(Some(true));
        from_page(&s, "app_crash", "", "", "made_up", 0.0);
        assert!(!file(&s).exists());
    }

    fn wait(s: &Store, count: usize) {
        let rows = vec![record("x", "job_done", "m", "d", "", 1.0).to_string(); count];
        fs::write(file(s), rows.join("\n") + "\n").unwrap();
    }

    #[test]
    fn what_was_sent_is_gone_and_new_records_are_not_lost_while_sending() {
        let s = store(Some(true));
        wait(&s, 250);
        let sent = Cell::new(0);
        flush(&s, |batch| {
            assert!(batch.len() <= BATCH);
            keep(&s, &record("x", "job_done", "new", "", "", 0.0)); // arrives while the network is busy
            sent.set(sent.get() + batch.len());
            true
        });
        assert_eq!(sent.get(), 250);
        assert!(!outbox(&s).exists());
        assert_eq!(lines(&file(&s)), 3, "records of the time of sending wait for the next one");
    }

    #[test]
    fn a_broken_network_keeps_what_did_not_leave() {
        let s = store(Some(true));
        wait(&s, 250);
        let tries = Cell::new(0);
        flush(&s, |_| {
            tries.set(tries.get() + 1);
            tries.get() < 2
        });
        assert_eq!(lines(&outbox(&s)), 150);
        flush(&s, |_| true);
        assert!(!outbox(&s).exists());
    }

    #[test]
    fn a_long_time_offline_keeps_the_newest() {
        let s = store(Some(true));
        wait(&s, MAX_WAITING + 50);
        let sent = Cell::new(0);
        flush(&s, |batch| {
            sent.set(sent.get() + batch.len());
            true
        });
        assert_eq!(sent.get(), MAX_WAITING);
    }

    #[test]
    fn a_crash_is_noted_by_place_and_reported_once() {
        let s = store(Some(true));
        fs::write(crash_note(s.data()), "jobs_rs_120").unwrap();
        started(&s, &Hardware::default());
        assert!(!crash_note(s.data()).exists());
    }
}
