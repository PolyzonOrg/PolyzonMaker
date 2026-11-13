//! A door for other programs on this computer, off until the person turns it on. It listens on the
//! loopback address only and wants the key on every request. There are no CORS headers and the Host
//! header is checked, so a web page cannot use it even when it guesses the port. See API.md.

use crate::{
    catalog,
    jobs::{Job, Jobs},
    packs, slicers,
    store::{self, Store},
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs::File,
    io::Read,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::Duration,
};
use tiny_http::{Header, Method, Request, Response, Server};

pub const DEFAULT_PORT: u16 = 7878;
pub const MAX_IMAGE_BYTES: usize = 64 << 20;
const TOOL_CALLS: [&str; 17] = ["cad_open", "cad_set", "cad_status", "cad_view", "cad_finish", "list", "open", "set", "press", "status", "view", "finish", "scad_open", "scad_set", "scad_status", "scad_view", "scad_finish"];
const TOOL_WAIT: Duration = Duration::from_secs(50);
const WINDOW_START_TENTHS: u32 = if cfg!(test) { 1 } else { 400 };

type Waiting = Arc<Mutex<HashMap<String, mpsc::Sender<Value>>>>;
/// The AI agents that said hello, by name, with when they last did (seconds since 1970).
type Seen = Arc<Mutex<Vec<(String, u64)>>>;

fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// What the window has to hear about or do: print preparation and model choice live there.
pub enum Tell {
    /// boxed: the other news is a few words, and every Tell is as big as its biggest
    Job(Box<Job>),
    Open(String),
    Prepare(String, u32),
    Install(String),
    /// One call to the tools: the window does the work, and its answer comes back through `Api::answered`.
    Tool(String, String, Value),
}

pub type Notify = Arc<dyn Fn(Tell) + Send + Sync>;

struct Door {
    store: Arc<Store>,
    jobs: Arc<Jobs>,
    notify: Notify,
    port: u16,
    waiting: Waiting,
    window_ready: Arc<AtomicBool>,
    seen: Seen,
}

enum Reply {
    Json(u16, Value),
    File(PathBuf),
}

fn fail(status: u16, code: &str) -> Reply {
    Reply::Json(status, json!({ "error": code }))
}

/// PNG, JPEG or WebP, by what the bytes are and not by what they are called.
fn image_type(bytes: &[u8]) -> Option<&'static str> {
    match bytes {
        [0x89, b'P', b'N', b'G', ..] => Some("png"),
        [0xFF, 0xD8, 0xFF, ..] => Some("jpg"),
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => Some("webp"),
        _ => None,
    }
}

fn same(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0, |bad, (x, y)| bad | (x ^ y)) == 0
}

impl Door {
    fn answer(&self, method: &Method, url: &str, host: &str, key: &str, body: &mut dyn Read) -> Reply {
        if host != format!("127.0.0.1:{}", self.port) && host != format!("localhost:{}", self.port) {
            return fail(403, "host"); // a site that rebinds its name to this computer
        }
        let token = self.store.settings().api_token;
        if token.is_empty() || !same(key.as_bytes(), format!("Bearer {token}").as_bytes()) {
            return fail(401, "key");
        }
        let (path, query) = url.split_once('?').unwrap_or((url, ""));
        let parts: Vec<&str> = path.trim_matches('/').split('/').collect();
        match (method, parts.as_slice()) {
            (Method::Get, ["v1", "status"]) => self.status(),
            (Method::Post, ["v1", "hello"]) => self.hello(body),
            (Method::Get, ["v1", "models"]) => self.models(),
            (Method::Get, ["v1", "catalog"]) => self.catalog(),
            (Method::Post, ["v1", "models", id, "install"]) => self.install(id),
            (Method::Get, ["v1", "jobs"]) => Reply::Json(200, json!(self.jobs.list())),
            (Method::Post, ["v1", "jobs"]) => self.add(query, body),
            (Method::Get, ["v1", "jobs", id]) => self.job(id).map_or(fail(404, "job"), |j| Reply::Json(200, json!(j))),
            (Method::Get, ["v1", "jobs", id, "files", name]) => self.file(id, name),
            (Method::Post, ["v1", "jobs", id, "cancel"]) => self.cancel(id),
            (Method::Post, ["v1", "jobs", id, "open"]) => self.open(id),
            (Method::Post, ["v1", "jobs", id, "prepare"]) => self.prepare(id, query),
            (Method::Post, ["v1", "jobs", id, "slicer"]) => self.slicer(id),
            (Method::Delete, ["v1", "jobs", id]) => self.delete(id),
            (Method::Get, ["v1", "tools"]) => self.tool("list", query, body),
            (Method::Post, ["v1", "tools", call]) => self.tool(call, query, body),
            (Method::Post, ["v1", "scad", call]) => self.tool(&format!("scad_{call}"), query, body),
            (Method::Post, ["v1", "cad", call]) => self.tool(&format!("cad_{call}"), query, body),
            _ => fail(404, "route"),
        }
    }

    fn job(&self, id: &str) -> Option<Job> {
        self.jobs.list().into_iter().find(|j| j.id == id)
    }

    /// An agent that connected through MCP says its name, so the window can show who is connected.
    fn hello(&self, body: &mut dyn Read) -> Reply {
        let mut text = String::new();
        if (&mut *body).take(4096).read_to_string(&mut text).is_err() {
            return fail(400, "json");
        }
        let said: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        // a name to show, never markup or a page of text
        let name: String = said["name"].as_str().unwrap_or("").chars().filter(|c| !c.is_control() && *c != '<' && *c != '>').take(60).collect();
        let name = name.trim();
        if name.is_empty() {
            return fail(400, "name");
        }
        let mut seen = self.seen.lock().unwrap();
        seen.retain(|(n, _)| n != name);
        seen.insert(0, (name.to_string(), now()));
        seen.truncate(8);
        Reply::Json(200, json!({ "ok": true }))
    }

    fn status(&self) -> Reply {
        let waiting = self.jobs.list().iter().filter(|j| j.state == "queued").count();
        let folder = self.store.jobs();
        Reply::Json(200, json!({ "app": "Polyzon Maker", "version": env!("CARGO_PKG_VERSION"), "busy": self.jobs.busy(), "queued": waiting, "jobs_folder": folder }))
    }

    fn models(&self) -> Reply {
        // what can run: one with files missing, or a download stopped halfway, would only fail as a job
        let rows: Vec<Value> = packs::installed(&self.store)
            .iter()
            .filter(|p| !p.broken)
            .map(|p| {
                let model = catalog::model(&p.id);
                let presets: Vec<&str> = model.iter().flat_map(|m| m.presets.iter().map(|x| x.id.as_str())).collect();
                let kind = if p.kind.is_empty() { model.as_ref().map_or("picture", |m| m.kind.as_str()) } else { &p.kind };
                json!({ "id": p.id, "kind": kind, "device": p.device, "presets": presets })
            })
            .collect();
        Reply::Json(200, json!(rows))
    }

    fn catalog(&self) -> Reply {
        let all = catalog::json();
        let rows: Vec<Value> = all["models"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|m| {
                let installed = m["id"].as_str().is_some_and(|id| packs::find(&self.store, id).is_some_and(|p| !p.broken));
                let mut row = json!({ "id": m["id"], "name": m["name"], "kind": m["kind"], "installed": installed });
                if !m["plugin"].is_null() {
                    row["plugin"] = m["plugin"]["id"].clone();
                }
                row
            })
            .collect();
        Reply::Json(200, json!(rows))
    }

    fn install(&self, id: &str) -> Reply {
        if catalog::model(id).is_none() {
            return fail(404, "model");
        }
        (self.notify)(Tell::Install(id.to_string()));
        Reply::Json(202, json!({ "ok": true }))
    }

    fn open(&self, id: &str) -> Reply {
        if self.job(id).is_none() {
            return fail(404, "job");
        }
        (self.notify)(Tell::Open(id.to_string()));
        Reply::Json(202, json!({ "ok": true }))
    }

    /// Print files are made in the window, by the code that shows the person what it did.
    fn prepare(&self, id: &str, query: &str) -> Reply {
        let Some(job) = self.job(id) else { return fail(404, "job") };
        if job.kind != "model" || job.state != "succeeded" {
            return fail(409, "not_a_finished_model");
        }
        let q: HashMap<String, String> = url::form_urlencoded::parse(query.as_bytes()).into_owned().collect();
        // none: the size the model has, which for a finished model is the size it was made
        let height = q.get("height").and_then(|h| h.parse().ok()).map_or(0u32, |h: u32| h.clamp(1, 1000));
        (self.notify)(Tell::Prepare(id.to_string(), height));
        Reply::Json(202, json!({ "ok": true, "height": height }))
    }

    /// A window that never answers is an error, not a hang.
    fn tool(&self, call: &str, query: &str, body: &mut dyn Read) -> Reply {
        if !TOOL_CALLS.contains(&call) {
            return fail(404, "route");
        }
        let mut text = String::new();
        if body.take(1 << 20).read_to_string(&mut text).is_err() {
            return fail(400, "json");
        }
        let args = if text.is_empty() {
            json!(url::form_urlencoded::parse(query.as_bytes()).into_owned().collect::<HashMap<String, String>>())
        } else {
            match serde_json::from_str(&text) {
                Ok(value) => value,
                Err(_) => return fail(400, "json"),
            }
        };
        // a client that starts the app is here before the window can hear it, and a call nobody
        // hears would only wait for nothing
        for _ in 0..WINDOW_START_TENTHS {
            if self.window_ready.load(Ordering::Relaxed) {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
        if !self.window_ready.load(Ordering::Relaxed) {
            return fail(504, "window_silent");
        }
        let id = store::random_id();
        let (answer, answered) = mpsc::channel();
        self.waiting.lock().unwrap().insert(id.clone(), answer);
        (self.notify)(Tell::Tool(id.clone(), call.to_string(), args));
        let reply = answered.recv_timeout(TOOL_WAIT);
        self.waiting.lock().unwrap().remove(&id);
        match reply {
            Ok(value) if value["error"].is_string() => Reply::Json(409, value),
            Ok(value) => Reply::Json(200, value),
            Err(_) => fail(504, "window_silent"),
        }
    }

    fn slicer(&self, id: &str) -> Reply {
        let found = slicers::find();
        let chosen = self.store.settings().slicer;
        let Some(slicer) = found.iter().find(|s| s.path == chosen).or(found.first()) else { return fail(409, "no_slicer") };
        let Some(path) = self.jobs.dir(id).ok().map(|d| d.join(slicer.file)).filter(|p| p.is_file()) else {
            return fail(409, "not_prepared");
        };
        match slicers::open(&slicer.path, &path) {
            Ok(()) => Reply::Json(200, json!({ "ok": true, "slicer": slicer.name })),
            Err(_) => fail(500, "slicer"),
        }
    }

    /// `prompt` in the query: words to a picture. Otherwise the body is a picture to make a model from.
    fn add(&self, query: &str, body: &mut dyn Read) -> Reply {
        let q: HashMap<String, String> = url::form_urlencoded::parse(query.as_bytes()).into_owned().collect();
        let text = |k: &str| q.get(k).map_or("", |v| v.trim());
        let model = text("model");
        let pack = store::safe_name(model).ok().and_then(|m| packs::find(&self.store, m)).filter(|p| !p.broken);
        let Some(pack) = pack else { return fail(409, "model_not_installed") };
        if pack.kind == "text" {
            return fail(400, "text_model");
        }
        let known = catalog::model(model);
        let kind = known.as_ref().map_or("picture", |m| m.kind.as_str());
        let prompt = text("prompt");
        if (kind == "picture") != !prompt.is_empty() {
            return fail(400, if prompt.is_empty() { "prompt_required" } else { "model_needs_a_picture" });
        }
        let preset = known.iter().flat_map(|m| &m.presets).find(|p| p.id == text("preset") || text("preset").is_empty());
        if known.as_ref().is_some_and(|m| !m.presets.is_empty()) && preset.is_none() {
            return fail(400, "preset");
        }
        let id = store::random_id();
        let input = if prompt.is_empty() {
            match self.keep_picture(&id, body) {
                Ok(name) => name,
                Err(reply) => return reply,
            }
        } else {
            String::new()
        };
        let title = if text("title").is_empty() { prompt } else { text("title") };
        let job = Job {
            id,
            kind: if prompt.is_empty() { "model" } else { "picture" }.into(),
            title: title.chars().take(120).collect(),
            thread: text("thread").into(),
            prompt: prompt.into(),
            input,
            model: model.into(),
            device: pack.device,
            preset: preset.map_or(String::new(), |p| p.id.clone()),
            seed: text("seed").parse().unwrap_or_else(|_| u64::from(store::now() as u32)),
            ..Job::default()
        };
        match self.jobs.add(job) {
            Ok(job) => {
                (self.notify)(Tell::Job(Box::new(job.clone())));
                Reply::Json(201, json!(job))
            }
            Err(_) => fail(500, "queue"),
        }
    }

    fn keep_picture(&self, id: &str, body: &mut dyn Read) -> Result<String, Reply> {
        let mut bytes = vec![];
        body.take(MAX_IMAGE_BYTES as u64 + 1).read_to_end(&mut bytes).map_err(|_| fail(400, "body"))?;
        if bytes.len() > MAX_IMAGE_BYTES {
            return Err(fail(413, "too_large"));
        }
        let ext = image_type(&bytes).ok_or_else(|| fail(415, "not_a_picture"))?;
        let input = format!("input.{ext}");
        let dir = self.jobs.dir(id).map_err(|_| fail(500, "folder"))?;
        store::write_atomic(&dir.join(&input), &bytes).map_err(|_| fail(500, "disk"))?;
        Ok(input)
    }

    fn file(&self, id: &str, name: &str) -> Reply {
        let path = store::safe_name(name).ok().and_then(|n| self.jobs.dir(id).ok().map(|d| d.join(n)));
        path.filter(|p| p.is_file()).map_or(fail(404, "file"), Reply::File)
    }

    fn cancel(&self, id: &str) -> Reply {
        if self.job(id).is_none() {
            return fail(404, "job");
        }
        if let Some(job) = self.jobs.cancel(id) {
            (self.notify)(Tell::Job(Box::new(job)));
        }
        Reply::Json(202, json!({ "ok": true }))
    }

    fn delete(&self, id: &str) -> Reply {
        if self.job(id).is_none() {
            return fail(404, "job");
        }
        match self.jobs.delete(id) {
            Ok(()) => Reply::Json(200, json!({ "ok": true })),
            Err(_) => fail(409, "running"),
        }
    }

    fn serve(&self, mut request: Request) {
        let header = |r: &Request, name: &'static str| {
            r.headers().iter().find(|h| h.field.equiv(name)).map_or(String::new(), |h| h.value.to_string())
        };
        let (method, url) = (request.method().clone(), request.url().to_string());
        let (host, key) = (header(&request, "Host"), header(&request, "Authorization"));
        let reply = self.answer(&method, &url, &host, &key, request.as_reader());
        let _ = match reply {
            Reply::Json(status, value) => {
                let kind = Header::from_bytes("Content-Type", "application/json").unwrap();
                request.respond(Response::from_string(value.to_string()).with_status_code(status).with_header(kind))
            }
            Reply::File(path) => match File::open(path) {
                Ok(file) => request.respond(Response::from_file(file)),
                Err(_) => request.respond(Response::empty(404)),
            },
        };
    }
}

struct Open {
    port: u16,
    server: Arc<Server>,
    thread: JoinHandle<()>,
}

#[derive(Default)]
pub struct Api {
    open: Mutex<Option<Open>>,
    waiting: Waiting,
    window_ready: Arc<AtomicBool>,
    seen: Seen,
}

impl Api {
    fn close(open: Open) {
        open.server.unblock();
        drop(open.server);
        let _ = open.thread.join();
    }

    /// The agents that connected since the program started, the latest first: name and seconds ago.
    pub fn agents(&self) -> Vec<Value> {
        let at = now();
        self.seen.lock().unwrap().iter().map(|(name, when)| json!({ "name": name, "seconds_ago": at.saturating_sub(*when) })).collect()
    }

    /// The window hears calls to the tools from now on.
    pub fn window_is_ready(&self) {
        self.window_ready.store(true, Ordering::Relaxed);
    }

    /// The window's answer to a call that `Tell::Tool` carried; one nobody waits for any more is dropped.
    pub fn answered(&self, id: &str, value: Value) {
        if let Some(waiter) = self.waiting.lock().unwrap().remove(id) {
            let _ = waiter.send(value);
        }
    }

    /// Brings the door in line with the settings. PORT_BUSY: another program holds the port.
    pub fn apply(&self, store: &Arc<Store>, jobs: &Arc<Jobs>, notify: Notify) -> Result<(), String> {
        let wanted = store.settings();
        let mut open = self.open.lock().unwrap();
        if wanted.api_enabled && open.as_ref().is_some_and(|o| o.port == wanted.api_port) {
            return Ok(());
        }
        if let Some(was) = open.take() {
            Self::close(was);
        }
        if !wanted.api_enabled {
            return Ok(());
        }
        let port = wanted.api_port;
        // the old door lets go of its port a moment after it closes
        let bound = (0..10).find_map(|_| {
            Server::http(("127.0.0.1", port)).ok().or_else(|| {
                thread::sleep(Duration::from_millis(100));
                None
            })
        });
        let server = Arc::new(bound.ok_or("PORT_BUSY")?);
        let door = Arc::new(Door { store: store.clone(), jobs: jobs.clone(), notify, port, waiting: self.waiting.clone(), window_ready: self.window_ready.clone(), seen: self.seen.clone() });
        let listening = server.clone();
        let thread = thread::spawn(move || {
            for request in listening.incoming_requests() {
                let door = door.clone();
                thread::spawn(move || door.serve(request));
            }
        });
        *open = Some(Open { port, server, thread });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{random_id, Settings};
    use std::{
        fs,
        io::Write,
        net::{TcpListener, TcpStream},
        sync::atomic::{AtomicUsize, Ordering},
    };

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n and the rest of a picture";

    struct Stand {
        store: Arc<Store>,
        jobs: Arc<Jobs>,
        api: Api,
        told: Arc<AtomicUsize>,
        asked: Arc<Mutex<Vec<(String, String, Value)>>>,
        port: u16,
    }

    impl Stand {
        fn new() -> Self {
            let d = std::env::temp_dir().join(format!("maker-api-{}", random_id()));
            let store = Arc::new(Store::open(d.join("c"), d.join("d")).unwrap());
            let port = TcpListener::bind(("127.0.0.1", 0)).unwrap().local_addr().unwrap().port();
            let settings = Settings { api_enabled: true, api_port: port, api_token: "secret".into(), ..store.settings() };
            store.save_settings(settings).unwrap();
            let jobs = Arc::new(Jobs::open(store.clone(), Arc::default()));
            let stand = Self { store, jobs, api: Api::default(), told: Arc::default(), asked: Arc::default(), port };
            stand.apply().unwrap();
            stand
        }

        fn apply(&self) -> Result<(), String> {
            let (told, asked) = (self.told.clone(), self.asked.clone());
            self.api.apply(&self.store, &self.jobs, Arc::new(move |tell| {
                told.fetch_add(1, Ordering::Relaxed);
                if let Tell::Tool(id, call, args) = tell {
                    asked.lock().unwrap().push((id, call, args));
                }
            }))
        }

        fn install(&self, id: &str, device: &str) {
            packs::install_for_tests(&self.store, id, device);
        }

        fn raw(&self, head: &str, body: &[u8]) -> (u16, String) {
            let mut s = TcpStream::connect(("127.0.0.1", self.port)).unwrap();
            write!(s, "{head}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
            s.write_all(body).unwrap();
            let mut bytes = vec![];
            s.read_to_end(&mut bytes).unwrap();
            let all = String::from_utf8_lossy(&bytes);
            let status = all.split(' ').nth(1).unwrap().parse().unwrap();
            (status, all.split_once("\r\n\r\n").unwrap().1.to_string())
        }

        fn ask(&self, method: &str, path: &str, body: &[u8]) -> (u16, Value) {
            let head = format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer secret", self.port);
            let (status, text) = self.raw(&head, body);
            (status, serde_json::from_str(&text).unwrap_or(Value::String(text)))
        }
    }

    #[test]
    fn an_agent_that_says_hello_is_shown_by_its_name_latest_first_and_once() {
        let s = Stand::new();
        assert!(s.api.agents().is_empty());
        assert_eq!(s.ask("POST", "/v1/hello", br#"{"name":"Claude Code"}"#).0, 200);
        assert_eq!(s.ask("POST", "/v1/hello", br#"{"name":"Codex<script>"}"#).0, 200);
        assert_eq!(s.ask("POST", "/v1/hello", br#"{"name":"Claude Code"}"#).0, 200);
        assert_eq!(s.ask("POST", "/v1/hello", br#"{"name":"  "}"#).0, 400);
        let names: Vec<String> = s.api.agents().iter().map(|a| a["name"].as_str().unwrap().to_string()).collect();
        assert_eq!(names, ["Claude Code", "Codexscript"]);
    }

    #[test]
    fn nothing_happens_without_the_key_or_from_another_name() {
        let s = Stand::new();
        let port = s.port;
        let no_key = format!("GET /v1/status HTTP/1.1\r\nHost: 127.0.0.1:{port}");
        assert_eq!(s.raw(&no_key, b"").0, 401);
        assert_eq!(s.raw(&format!("{no_key}\r\nAuthorization: Bearer wrong"), b"").0, 401);
        let rebound = "GET /v1/status HTTP/1.1\r\nHost: evil.example\r\nAuthorization: Bearer secret";
        assert_eq!(s.raw(rebound, b"").0, 403);
        assert_eq!(s.ask("GET", "/v1/status", b"").0, 200);
        assert_eq!(s.ask("GET", "/v1/nothing", b"").0, 404);
    }

    #[test]
    fn a_call_to_the_tools_waits_for_the_window_and_brings_back_its_answer() {
        let s = Stand::new();
        s.api.window_is_ready();
        thread::scope(|scope| {
            let call = scope.spawn(|| s.ask("POST", "/v1/tools/set", br#"{"values":{"Size":40}}"#));
            let (id, name, args) = loop {
                if let Some(asked) = s.asked.lock().unwrap().pop() {
                    break asked;
                }
                thread::sleep(Duration::from_millis(5));
            };
            assert_eq!((name.as_str(), args["values"]["Size"].as_u64()), ("set", Some(40)));
            s.api.answered(&id, json!({ "ready": true }));
            let (status, value) = call.join().unwrap();
            assert_eq!((status, value["ready"].as_bool()), (200, Some(true)));
        });

        thread::scope(|scope| {
            let call = scope.spawn(|| s.ask("POST", "/v1/tools/press", br#"{"label":"x"}"#));
            let id = loop {
                if let Some(asked) = s.asked.lock().unwrap().pop() {
                    break asked.0;
                }
                thread::sleep(Duration::from_millis(5));
            };
            s.api.answered(&id, json!({ "error": "No button" }));
            assert_eq!(call.join().unwrap().0, 409, "what the window refused is not a success");
        });

        assert_eq!(s.ask("POST", "/v1/tools/format-disk", b"").0, 404, "only the calls the window knows");
        assert_eq!(s.ask("POST", "/v1/tools/set", b"{not json").0, 400);
        s.api.answered("nobody", json!({})); // a late answer changes nothing
    }

    #[test]
    fn a_door_with_an_empty_key_stays_shut() {
        let s = Stand::new();
        s.store.save_settings(Settings { api_token: String::new(), ..s.store.settings() }).unwrap();
        let head = format!("GET /v1/status HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer ", s.port);
        assert_eq!(s.raw(&head, b"").0, 401);
    }

    #[test]
    fn a_picture_becomes_a_job_that_the_window_hears_about() {
        let s = Stand::new();
        s.install("trellis2", "vulkan");
        let (status, job) = s.ask("POST", "/v1/jobs?model=trellis2&preset=1024&seed=7&title=%D0%9A%D0%BE%D1%82", PNG);
        assert_eq!(status, 201, "{job}");
        assert_eq!((job["state"].as_str(), job["kind"].as_str()), (Some("queued"), Some("model")));
        assert_eq!((job["device"].as_str(), job["preset"].as_str(), job["seed"].as_u64()), (Some("vulkan"), Some("1024"), Some(7)));
        assert_eq!(job["title"], "Кот");
        assert_eq!(s.told.load(Ordering::Relaxed), 1);
        let id = job["id"].as_str().unwrap();
        assert_eq!(fs::read(s.store.jobs().join(id).join("input.png")).unwrap(), PNG);
        assert_eq!(s.ask("GET", &format!("/v1/jobs/{id}"), b"").1["state"], "queued");
        assert_eq!(s.ask("GET", &format!("/v1/jobs/{id}/files/input.png"), b"").1, String::from_utf8_lossy(PNG).as_ref());
        assert_eq!(s.ask("GET", "/v1/jobs", b"").1.as_array().unwrap().len(), 1);
        assert_eq!(s.ask("POST", &format!("/v1/jobs/{id}/cancel"), b"").0, 202);
        assert_eq!(s.ask("GET", &format!("/v1/jobs/{id}"), b"").1["state"], "cancelled");
        assert_eq!(s.ask("DELETE", &format!("/v1/jobs/{id}"), b"").0, 200);
        assert_eq!(s.ask("GET", &format!("/v1/jobs/{id}"), b"").0, 404);
    }

    #[test]
    fn words_go_to_a_picture_model_and_only_there() {
        let s = Stand::new();
        s.install("zimage", "cuda");
        s.install("trellis2", "cuda");
        let (status, job) = s.ask("POST", "/v1/jobs?model=zimage&prompt=a%20red%20boat", b"");
        assert_eq!(status, 201, "{job}");
        assert_eq!((job["kind"].as_str(), job["prompt"].as_str()), (Some("picture"), Some("a red boat")));
        assert_eq!(s.ask("POST", "/v1/jobs?model=trellis2&prompt=a%20boat", b"").1["error"], "model_needs_a_picture");
        assert_eq!(s.ask("POST", "/v1/jobs?model=zimage", PNG).1["error"], "prompt_required");
    }

    #[test]
    fn what_cannot_run_is_refused_with_a_reason() {
        let s = Stand::new();
        s.install("trellis2", "cuda");
        let refused = |path: &str, body: &[u8]| s.ask("POST", path, body);
        assert_eq!(refused("/v1/jobs?model=triposr", PNG), (409, json!({ "error": "model_not_installed" })));
        assert_eq!(refused("/v1/jobs?model=..%2F..%2Fsecret", PNG).0, 409);
        assert_eq!(refused("/v1/jobs?model=trellis2", b"this is not a picture").0, 415);
        assert_eq!(refused("/v1/jobs?model=trellis2&preset=9000", PNG), (400, json!({ "error": "preset" })));
        assert_eq!(s.ask("GET", "/v1/jobs", b"").1, json!([]));
    }

    #[test]
    fn a_file_name_cannot_leave_the_job_folder() {
        let s = Stand::new();
        s.install("trellis2", "cuda");
        let id = s.ask("POST", "/v1/jobs?model=trellis2", PNG).1["id"].as_str().unwrap().to_string();
        for name in ["..%2F..%2Fsettings.json", "..", ".hidden", "a%2Fb", "input.jpg"] {
            assert_eq!(s.ask("GET", &format!("/v1/jobs/{id}/files/{name}"), b"").0, 404, "{name}");
        }
    }

    #[test]
    fn the_window_is_asked_to_do_what_only_it_can() {
        let s = Stand::new();
        s.install("trellis2", "vulkan");
        let id = s.ask("POST", "/v1/jobs?model=trellis2", PNG).1["id"].as_str().unwrap().to_string();
        assert_eq!(s.ask("POST", &format!("/v1/jobs/{id}/open"), b"").0, 202);
        assert_eq!(s.ask("POST", "/v1/jobs/nothing/open", b"").0, 404);
        assert_eq!(s.ask("POST", &format!("/v1/jobs/{id}/prepare"), b"").1["error"], "not_a_finished_model");
        assert_eq!(s.ask("POST", "/v1/models/triposr/install", b"").0, 202);
        assert_eq!(s.ask("POST", "/v1/models/nothing/install", b"").0, 404);
    }

    #[test]
    fn the_catalog_says_what_is_installed() {
        let s = Stand::new();
        s.install("trellis2", "vulkan");
        let (_, list) = s.ask("GET", "/v1/catalog", b"");
        let row = |id: &str| list.as_array().unwrap().iter().find(|m| m["id"] == id).unwrap().clone();
        assert_eq!(row("trellis2")["installed"], true);
        assert_eq!(row("triposr")["installed"], false);
    }

    #[test]
    fn it_lists_what_is_installed() {
        let s = Stand::new();
        s.install("trellis2", "vulkan");
        // a download stopped halfway is on disk, and no model to run: an agent that picked it would only fail
        std::fs::create_dir_all(s.store.packs().join("hf-someone-model/weights")).unwrap();
        std::fs::write(s.store.packs().join("hf-someone-model/weights/model.gguf.part"), b"half").unwrap();
        let (_, list) = s.ask("GET", "/v1/models", b"");
        assert_eq!(list.as_array().unwrap().len(), 1, "{list}");
        assert_eq!(list[0]["id"], "trellis2");
        assert_eq!(list[0]["kind"], "3d");
        assert!(list[0]["presets"].as_array().unwrap().contains(&json!("512")));
    }

    #[test]
    fn turned_off_it_is_gone_and_turned_on_it_is_back() {
        let s = Stand::new();
        s.store.save_settings(Settings { api_enabled: false, ..s.store.settings() }).unwrap();
        s.apply().unwrap();
        // the listening thread lets go of the port a moment later
        let gone = (0..50).any(|_| {
            thread::sleep(Duration::from_millis(100));
            TcpStream::connect(("127.0.0.1", s.port)).is_err()
        });
        assert!(gone);
        s.store.save_settings(Settings { api_enabled: true, ..s.store.settings() }).unwrap();
        s.apply().unwrap();
        assert_eq!(s.ask("GET", "/v1/status", b"").0, 200);
    }

    #[test]
    fn a_port_someone_else_holds_is_said_so() {
        let s = Stand::new();
        let other = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = other.local_addr().unwrap().port();
        s.store.save_settings(Settings { api_port: port, ..s.store.settings() }).unwrap();
        assert_eq!(s.apply(), Err("PORT_BUSY".to_string()));
    }
}
