//! The local text model: llama-server in the background, one model at a time, on a loopback port with a
//! key made for this run. The page cannot reach loopback, so a conversation goes through here and comes
//! back as events, word by word.

use crate::{
    packs,
    store::{self, Store},
    sys,
};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader},
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Child, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

/// A 16 GB model takes its time coming off a disk.
const LOAD_SECONDS: u64 = 300;
const CONTEXT: &str = "32768";
const MAX_ANSWER: u32 = 6000;
/// A model out of use goes back out of memory, and comes back with the next question.
const IDLE_SECONDS: u64 = 600;

struct Running {
    child: Child,
    port: u16,
    key: String,
    model: String,
}

#[derive(Default)]
pub struct Assistant {
    running: Mutex<Option<Running>>,
    talks: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// When the model last did something
    used: Mutex<Option<Instant>>,
}

#[derive(Clone, Serialize)]
struct Delta<'a> {
    id: &'a str,
    text: &'a str,
}

#[derive(Clone, Serialize)]
struct End<'a> {
    id: &'a str,
    error: &'a str,
}

/// The model file and, for a model that sees, its vision file.
fn weights(root: &Path) -> Result<(PathBuf, Option<PathBuf>), String> {
    let mut files: Vec<PathBuf> = fs::read_dir(root.join("weights")).map_err(|e| e.to_string())?.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "gguf")).collect();
    files.sort(); // of a model in parts, the first one is the one to name
    let is_vision = |p: &&PathBuf| p.file_name().is_some_and(|n| n.to_string_lossy().contains("mmproj"));
    let vision = files.iter().find(is_vision).cloned();
    let model = files.iter().find(|p| !is_vision(p)).cloned().ok_or("the model has no file")?;
    Ok((model, vision))
}

fn free_port() -> Result<u16, String> {
    Ok(TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?.local_addr().map_err(|e| e.to_string())?.port())
}

fn local_agent(timeout: Option<Duration>) -> ureq::Agent {
    ureq::Agent::config_builder().proxy(None).http_status_as_error(false).timeout_global(timeout).build().into()
}

fn tail(log: &Path) -> String {
    let text = fs::read_to_string(log).unwrap_or_default();
    let lines: Vec<&str> = text.lines().rev().take(6).collect();
    lines.into_iter().rev().collect::<Vec<_>>().join("\n")
}

impl Assistant {
    /// Holds `id` in memory, letting go of the one before.
    pub fn start(&self, store: &Store, id: &str) -> Result<(), String> {
        let mut running = self.running.lock().unwrap();
        if let Some(now) = running.as_mut() {
            if now.model == id && matches!(now.child.try_wait(), Ok(None)) {
                *self.used.lock().unwrap() = Some(Instant::now());
                return Ok(());
            }
        }
        if let Some(mut old) = running.take() {
            let _ = old.child.kill();
            let _ = old.child.wait();
        }
        let installed = packs::find(store, id).filter(|p| !p.broken).ok_or("the model is not installed")?;
        let root = packs::dir(store, id);
        let exe = packs::find_exe(&root.join("bin"), "llama-server").ok_or("llama-server is missing")?;
        let (model, vision) = weights(&root)?;
        let port = free_port()?;
        let key = store::random_id();
        let log = store.data().join("assistant.log");
        let out = fs::File::create(&log).map_err(|e| e.to_string())?;
        let mut c = sys::engine(&exe, false);
        c.arg("--model").arg(&model);
        if let Some(file) = vision {
            c.arg("--mmproj").arg(file);
        }
        c.args(["--host", "127.0.0.1", "--port", &port.to_string(), "--ctx-size", CONTEXT, "--parallel", "1", "--jinja", "--no-webui"]);
        c.env("LLAMA_API_KEY", &key); // not on the command line, where every program can read it
        c.args(["--n-gpu-layers", gpu_layers(&installed.device)]);
        c.stdin(Stdio::null()).stdout(Stdio::from(out.try_clone().map_err(|e| e.to_string())?)).stderr(Stdio::from(out));
        let mut child = c.spawn().map_err(|e| e.to_string())?;
        let agent = local_agent(Some(Duration::from_secs(2)));
        let started = Instant::now();
        while started.elapsed().as_secs() < LOAD_SECONDS {
            if let Ok(Some(_)) = child.try_wait() {
                return Err(format!("the model did not start:\n{}", tail(&log)));
            }
            if agent.get(format!("http://127.0.0.1:{port}/health")).call().is_ok_and(|r| r.status() == 200) {
                *running = Some(Running { child, port, key, model: id.into() });
                *self.used.lock().unwrap() = Some(Instant::now());
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(400));
        }
        let _ = child.kill();
        Err(format!("the model did not start in time:\n{}", tail(&log)))
    }

    /// Answers on its own thread, as `assistant-delta` events and one `assistant-end`.
    pub fn chat(self: Arc<Self>, app: AppHandle, id: String, messages: serde_json::Value) -> Result<(), String> {
        let (port, key) = {
            let running = self.running.lock().unwrap();
            let now = running.as_ref().ok_or("no model is loaded")?;
            (now.port, now.key.clone())
        };
        let stop = Arc::new(AtomicBool::new(false));
        self.talks.lock().unwrap().insert(id.clone(), stop.clone());
        std::thread::spawn(move || {
            let result = talk(port, &key, messages, &stop, &mut |text| {
                let _ = app.emit("assistant-delta", Delta { id: &id, text });
            });
            self.talks.lock().unwrap().remove(&id);
            *self.used.lock().unwrap() = Some(Instant::now());
            let error = result.err().unwrap_or_default();
            let _ = app.emit("assistant-end", End { id: &id, error: &error });
        });
        Ok(())
    }

    pub fn cancel(&self, id: &str) {
        if let Some(stop) = self.talks.lock().unwrap().get(id) {
            stop.store(true, Ordering::Relaxed);
        }
    }

    pub fn stop(&self) {
        if let Some(mut old) = self.running.lock().unwrap().take() {
            let _ = old.child.kill();
            let _ = old.child.wait();
        }
    }

    /// A generation needs the graphics card. The text model gets out of the way unless there is room
    /// for both, or someone is in the middle of an answer; the next question loads it again.
    pub fn make_room(&self, free_mb: Option<u64>, need_mb: u64) {
        if should_leave(free_mb, need_mb, !self.talks.lock().unwrap().is_empty()) {
            self.stop();
        }
    }

    /// Runs for as long as the app does.
    pub fn let_go_when_idle(self: Arc<Self>) {
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(30));
            let idle = self.used.lock().unwrap().is_some_and(|at| at.elapsed().as_secs() > IDLE_SECONDS);
            if idle && self.talks.lock().unwrap().is_empty() {
                self.stop();
                *self.used.lock().unwrap() = None;
            }
        });
    }
}

fn should_leave(free_mb: Option<u64>, need_mb: u64, talking: bool) -> bool {
    !talking && free_mb.is_none_or(|free| free < need_mb)
}

/// What a line of the stream says: words, the end, or nothing that matters.
fn words_of(line: &str) -> Option<Result<String, String>> {
    let data = line.strip_prefix("data:")?.trim();
    if data == "[DONE]" {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(data).ok()?;
    if let Some(message) = value["error"]["message"].as_str() {
        return Some(Err(message.to_string()));
    }
    value["choices"][0]["delta"]["content"].as_str().filter(|t| !t.is_empty()).map(|t| Ok(t.to_string()))
}

/// Streams one answer. It keeps reading only while nobody stopped it: closing the connection stops the model.
fn talk(port: u16, key: &str, messages: serde_json::Value, stop: &AtomicBool, emit: &mut dyn FnMut(&str)) -> Result<(), String> {
    let body = serde_json::json!({ "messages": messages, "stream": true, "temperature": 0.3, "max_tokens": MAX_ANSWER, "cache_prompt": true });
    let reply = local_agent(None)
        .post(format!("http://127.0.0.1:{port}/v1/chat/completions"))
        .header("Authorization", format!("Bearer {key}"))
        .header("Content-Type", "application/json")
        .send(body.to_string())
        .map_err(|e| e.to_string())?;
    let status = reply.status();
    let mut reader = BufReader::new(reply.into_body().into_reader());
    if status != 200 {
        let mut text = String::new();
        let _ = std::io::Read::read_to_string(&mut reader, &mut text);
        return Err(text.chars().take(400).collect());
    }
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line).map_err(|e| e.to_string())? == 0 || stop.load(Ordering::Relaxed) {
            return Ok(());
        }
        match words_of(line.trim_end()) {
            Some(Ok(words)) => emit(&words),
            Some(Err(message)) => return Err(message),
            None => {}
        }
    }
}

/// The layers on the card. With `auto`, llama.cpp's own fit (on by default since b7xxx, the catalog pins
/// b11854) puts there as many as its free memory holds and keeps the rest in main memory, as LM Studio
/// does; a number here, as the 999 before, switches that off and a model bigger than the card fails to load.
fn gpu_layers(device: &str) -> &'static str {
    if device == "cpu" { "0" } else { "auto" }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpStream,
    };

    #[test]
    fn a_text_model_bigger_than_the_card_keeps_the_rest_in_main_memory() {
        assert_eq!(gpu_layers("cuda"), "auto");
        assert_eq!(gpu_layers("vulkan"), "auto");
        assert_eq!(gpu_layers("metal"), "auto");
        assert_eq!(gpu_layers("cpu"), "0", "on the processor nothing goes to a card");
    }

    #[test]
    fn the_text_model_leaves_only_when_a_generation_needs_the_room() {
        assert!(!should_leave(Some(9000), 8000, false), "room for both");
        assert!(should_leave(Some(4000), 8000, false));
        assert!(should_leave(None, 8000, false), "a card that does not say gets the room");
        assert!(!should_leave(Some(4000), 8000, true), "an answer on its way is not cut off");
    }

    #[test]
    fn a_stream_line_gives_its_words() {
        assert_eq!(words_of(r#"data: {"choices":[{"delta":{"content":"куб"}}]}"#), Some(Ok("куб".into())));
    }

    #[test]
    fn thinking_and_the_end_give_no_words() {
        assert_eq!(words_of(r#"data: {"choices":[{"delta":{"reasoning_content":"hm"}}]}"#), None);
        assert_eq!(words_of("data: [DONE]"), None);
        assert_eq!(words_of(": ping"), None);
    }

    #[test]
    fn an_error_in_the_stream_is_said() {
        assert_eq!(words_of(r#"data: {"error":{"message":"too long"}}"#), Some(Err("too long".into())));
    }

    fn serve(answer: &'static str) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut c, _): (TcpStream, _) = listener.accept().unwrap();
            let mut buffer = [0u8; 4096];
            let _ = c.read(&mut buffer);
            let _ = c.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\n\r\n{answer}", answer.len()).as_bytes());
            // on Windows a socket closed with bytes unread resets the connection and takes the answer with it
            let _ = c.shutdown(std::net::Shutdown::Write);
            let _ = c.read_to_end(&mut Vec::new());
        });
        port
    }

    #[test]
    fn talking_gathers_the_answer_from_the_stream() {
        let port = serve("data: {\"choices\":[{\"delta\":{\"content\":\"го\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"тово\"}}]}\n\ndata: [DONE]\n\n");
        let mut text = String::new();
        talk(port, "key", serde_json::json!([]), &AtomicBool::new(false), &mut |t| text.push_str(t)).unwrap();
        assert_eq!(text, "готово");
    }

    #[test]
    fn stopping_ends_the_answer_with_no_error() {
        let port = serve("data: {\"choices\":[{\"delta\":{\"content\":\"го\"}}]}\n\n");
        let mut text = String::new();
        assert!(talk(port, "key", serde_json::json!([]), &AtomicBool::new(true), &mut |t| text.push_str(t)).is_ok());
        assert_eq!(text, "");
    }

    #[test]
    fn the_vision_file_is_told_from_the_model() {
        let dir = std::env::temp_dir().join(format!("maker-assistant-{}", store::random_id()));
        fs::create_dir_all(dir.join("weights")).unwrap();
        fs::write(dir.join("weights/model.gguf"), "").unwrap();
        fs::write(dir.join("weights/mmproj-F16.gguf"), "").unwrap();
        let (model, vision) = weights(&dir).unwrap();
        assert!(model.ends_with("model.gguf"));
        assert!(vision.unwrap().ends_with("mmproj-F16.gguf"));
        let _ = fs::remove_dir_all(dir);
    }
}
