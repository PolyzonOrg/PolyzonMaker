//! `polyzon-client --mcp`: the Model Context Protocol over stdin and stdout, for Claude, Codex, Cursor and
//! the like. It only speaks to the running app through the local API, so one set of rules holds for
//! both; the key comes from Polyzon Maker's own settings and never lands in a client's configuration.

use crate::store::Settings;
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, Read, Write},
    path::PathBuf,
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

/// Clients give up on a call after about a minute: longer work comes back as "still running"
const WAIT_SECONDS: u64 = 50;
const OPEN_SECONDS: u64 = 30;

fn config_file() -> Option<PathBuf> {
    let var = std::env::var_os;
    #[cfg(target_os = "windows")]
    let base = var("APPDATA").map(PathBuf::from);
    #[cfg(target_os = "macos")]
    let base = var("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"));
    #[cfg(target_os = "linux")]
    let base = var("XDG_CONFIG_HOME").map(PathBuf::from).or_else(|| var("HOME").map(|h| PathBuf::from(h).join(".config")));
    Some(base?.join("org.polyzon.maker").join("settings.json"))
}

/// The API's short codes, as something an assistant can act on.
fn in_words(code: &str) -> String {
    match code {
        "job" => "There is no such job.",
        "key" => "The key was not accepted. Is the API on in Polyzon Maker's Settings?",
        "model_not_installed" => "That model is not installed. See maker_list_models and maker_install_model.",
        "model" => "There is no such model. See maker_list_models.",
        "preset" => "That model has no such preset. See maker_list_models.",
        "prompt_required" => "This model makes pictures from words: pass a prompt.",
        "model_needs_a_picture" => "This model makes 3D from a picture: pass image_path or picture_job.",
        "not_a_picture" => "That file is not a PNG, JPEG or WebP picture.",
        "too_large" => "That picture is over 64 MB.",
        "not_a_finished_model" => "Only a finished 3D model can be prepared for print.",
        "not_prepared" => "This model has no print files yet. Call maker_prepare_for_print first.",
        "no_slicer" => "No slicer was found on this computer.",
        "running" => "The job is running. Cancel it first.",
        "window_silent" => "Polyzon Maker's window did not answer in time. It may still be starting: call this again.",
        other => other,
    }
    .to_string()
}

/// The agent on the other end, as its `initialize` names it: told to Polyzon Maker, whose window shows who is connected.
static AGENT: Mutex<String> = Mutex::new(String::new());

/// Polyzon Maker's settings on this computer, with the API on.
fn settings() -> Result<Settings, String> {
    let settings: Settings = config_file()
        .and_then(|f| fs::read(f).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .ok_or("Polyzon Maker has not been set up yet: open it once and go through the first steps.")?;
    if !settings.api_enabled {
        return Err("The API is off. Turn on «API for other programs» in Polyzon Maker's Settings.".into());
    }
    Ok(settings)
}

/// Starts the program for an agent, apart from it. Not on the agent's pipes: what the program prints would get
/// into the conversation, and a write after the agent left ends the program. Not in the agent's process group,
/// so the program stays when the agent stops this server. On macOS through `open`, as a person starts it.
fn start_app() -> std::io::Result<()> {
    use std::process::{Command, Stdio};
    let exe = std::env::current_exe()?;
    let bundle = exe.ancestors().nth(3).filter(|b| b.extension().is_some_and(|e| e == "app")); // X.app/Contents/MacOS/exe
    let mut c = match bundle {
        Some(app) if cfg!(target_os = "macos") => {
            let mut c = Command::new("/usr/bin/open");
            c.arg(app);
            c
        }
        _ => Command::new(&exe),
    };
    c.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(&mut c, 0);
    c.spawn().map(drop)
}

pub struct Client {
    agent: ureq::Agent,
    base: String,
    token: String,
}

impl Client {
    fn new(port: u16, token: String) -> Self {
        // a person's proxy has no business with an address on this computer
        let agent = ureq::Agent::config_builder().proxy(None).http_status_as_error(false).build().into();
        Self { agent, base: format!("http://127.0.0.1:{port}"), token }
    }

    /// Says which agent this is; nothing is lost when nobody hears it.
    fn hello(&self) {
        let name = AGENT.lock().unwrap().clone();
        if !name.is_empty() {
            let _ = self.post("/v1/hello", json!({ "name": name }).to_string().as_bytes());
        }
    }

    /// The app, only when it is already running: an agent that starts up must not open the program.
    fn running() -> Option<Self> {
        let settings = settings().ok()?;
        let client = Self::new(settings.api_port, settings.api_token);
        client.get("/v1/status").ok()?;
        Some(client)
    }

    /// The settings of the app on this computer; it is started when it is not running.
    fn find() -> Result<Self, String> {
        let settings = settings()?;
        let client = Self::new(settings.api_port, settings.api_token);
        if client.get("/v1/status").is_err() {
            let _ = start_app();
            let started = Instant::now();
            while client.get("/v1/status").is_err() {
                if started.elapsed().as_secs() > OPEN_SECONDS {
                    return Err("Polyzon Maker did not start. Open it by hand and try again.".into());
                }
                thread::sleep(Duration::from_millis(500));
            }
        }
        client.hello();
        Ok(client)
    }

    fn get(&self, path: &str) -> Result<Value, String> {
        self.read(self.agent.get(format!("{}{path}", self.base)).header("Authorization", format!("Bearer {}", self.token)).call())
    }

    fn post(&self, path: &str, body: &[u8]) -> Result<Value, String> {
        let request = self.agent.post(format!("{}{path}", self.base)).header("Authorization", format!("Bearer {}", self.token));
        self.read(request.send(body))
    }

    fn read(&self, reply: Result<ureq::http::Response<ureq::Body>, ureq::Error>) -> Result<Value, String> {
        let mut reply = reply.map_err(|e| e.to_string())?;
        let ok = reply.status().is_success();
        let value: Value = reply.body_mut().read_json().unwrap_or(Value::Null);
        if ok { Ok(value) } else { Err(in_words(value["error"].as_str().unwrap_or("error"))) }
    }

    fn file(&self, id: &str, name: &str) -> Option<Vec<u8>> {
        let url = format!("{}/v1/jobs/{id}/files/{name}", self.base);
        let mut reply = self.agent.get(url).header("Authorization", format!("Bearer {}", self.token)).call().ok()?;
        if !reply.status().is_success() {
            return None;
        }
        let mut bytes = vec![];
        reply.body_mut().as_reader().read_to_end(&mut bytes).ok()?;
        Some(bytes)
    }
}

fn finished(job: &Value) -> bool {
    matches!(job["state"].as_str(), Some("succeeded" | "failed" | "cancelled" | "interrupted"))
}

/// A job with where its files are, and what to do next when it has not finished.
fn described(client: &Client, job: Value) -> Value {
    let folder = client.get("/v1/status").ok().and_then(|s| s["jobs_folder"].as_str().map(String::from)).unwrap_or_default();
    let id = job["id"].as_str().unwrap_or("");
    let path = |name: &str| PathBuf::from(&folder).join(id).join(name);
    let files: Vec<String> = ["model.glb", "picture.png", "print.stl", "print.3mf", "thumb.png"]
        .iter()
        .map(|n| path(n))
        .filter(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    let mut out = json!({ "id": job["id"], "thread": job["thread"], "kind": job["kind"], "title": job["title"], "state": job["state"],
        "stage": job["stage"], "error": job["error"], "seconds": job["seconds"], "model": job["model"], "files": files });
    if !finished(&job) {
        out["next"] = json!("Still working. Call maker_wait_job with this id.");
    }
    out
}

fn wait(client: &Client, id: &str, seconds: u64) -> Result<Value, String> {
    let started = Instant::now();
    loop {
        let job = client.get(&format!("/v1/jobs/{id}"))?;
        if finished(&job) || started.elapsed().as_secs() >= seconds {
            return Ok(described(client, job));
        }
        thread::sleep(Duration::from_secs(1));
    }
}

fn text(args: &Value, key: &str) -> Option<String> {
    args[key].as_str().map(str::trim).filter(|v| !v.is_empty()).map(String::from)
}

fn query(pairs: &[(&str, Option<String>)]) -> String {
    let mut q = url::form_urlencoded::Serializer::new(String::new());
    for (key, value) in pairs {
        if let Some(value) = value {
            q.append_pair(key, value);
        }
    }
    q.finish()
}

/// The newest installed model of a kind, when the caller did not name one.
fn model_of(client: &Client, args: &Value, kind: &str) -> Result<String, String> {
    if let Some(model) = text(args, "model") {
        return Ok(model);
    }
    let installed = client.get("/v1/models")?;
    let found = installed.as_array().and_then(|list| list.iter().find(|m| m["kind"] == kind));
    found
        .and_then(|m| m["id"].as_str())
        .map(String::from)
        .ok_or_else(|| format!("No {kind} model is installed. See maker_list_models and maker_install_model."))
}

fn image(bytes: &[u8]) -> Value {
    use base64::Engine;
    let kind = if bytes.starts_with(&[0xFF, 0xD8]) { "image/jpeg" } else { "image/png" };
    json!({ "type": "image", "mimeType": kind, "data": base64::engine::general_purpose::STANDARD.encode(bytes) })
}

fn say(value: Value) -> Vec<Value> {
    vec![json!({ "type": "text", "text": value.to_string() })]
}

fn id_of(args: &Value) -> Result<String, String> {
    text(args, "id").ok_or_else(|| "id is required".to_string())
}

fn generate_picture(client: &Client, args: &Value) -> Result<Vec<Value>, String> {
    let prompt = text(args, "prompt").ok_or("prompt is required")?;
    let model = model_of(client, args, "picture")?;
    let count = args["variants"].as_u64().unwrap_or(1).clamp(1, 4);
    let mut thread = text(args, "thread");
    let mut ids = vec![];
    for i in 0..count {
        let seed = args["seed"].as_u64().map(|s| (s + i).to_string());
        let q = query(&[("model", Some(model.clone())), ("prompt", Some(prompt.clone())), ("seed", seed), ("thread", thread.clone())]);
        let job = client.post(&format!("/v1/jobs?{q}"), b"")?;
        thread = thread.or_else(|| job["id"].as_str().map(String::from));
        ids.push(job["id"].as_str().unwrap_or("").to_string());
    }
    let mut left = args["timeout_seconds"].as_u64().unwrap_or(WAIT_SECONDS);
    let mut jobs = vec![];
    for id in &ids {
        let started = Instant::now();
        jobs.push(wait(client, id, left)?);
        left = left.saturating_sub(started.elapsed().as_secs());
    }
    Ok(say(json!(jobs)))
}

fn generate_model(client: &Client, args: &Value) -> Result<Vec<Value>, String> {
    let model = model_of(client, args, "3d")?;
    let (bytes, mut thread) = if let Some(path) = text(args, "image_path") {
        (fs::read(&path).map_err(|e| format!("{path}: {e}"))?, None)
    } else {
        let id = text(args, "picture_job").ok_or("image_path or picture_job is required")?;
        (client.file(&id, "picture.png").ok_or("that job has no finished picture")?, client.get(&format!("/v1/jobs/{id}"))?["thread"].as_str().map(String::from))
    };
    thread = text(args, "thread").or(thread);
    let seed = args["seed"].as_u64().map(|s| s.to_string());
    let q = query(&[("model", Some(model)), ("preset", text(args, "preset")), ("seed", seed), ("title", text(args, "title")), ("thread", thread)]);
    let job = client.post(&format!("/v1/jobs?{q}"), &bytes)?;
    let seconds = args["timeout_seconds"].as_u64().unwrap_or(WAIT_SECONDS);
    Ok(say(wait(client, job["id"].as_str().unwrap_or(""), seconds)?))
}

/// What came out, as a picture the model can look at. A 3D model is rendered by Polyzon Maker's window.
fn view(client: &Client, args: &Value) -> Result<Vec<Value>, String> {
    let id = id_of(args)?;
    let job = client.get(&format!("/v1/jobs/{id}"))?;
    if job["state"] != "succeeded" {
        return Ok(say(described(client, job)));
    }
    let name = if job["kind"] == "picture" { "picture.png" } else { "thumb.png" };
    let mut bytes = client.file(&id, name);
    if bytes.is_none() {
        client.post(&format!("/v1/jobs/{id}/open"), b"")?;
        for _ in 0..30 {
            thread::sleep(Duration::from_millis(500));
            bytes = client.file(&id, name);
            if bytes.is_some() {
                break;
            }
        }
    }
    let mut content = say(described(client, job));
    content.extend(bytes.map(|b| image(&b)));
    Ok(content)
}

fn prepare(client: &Client, args: &Value) -> Result<Vec<Value>, String> {
    let id = id_of(args)?;
    let height = args["height_mm"].as_u64().map_or(String::new(), |h| format!("?height={h}"));
    client.post(&format!("/v1/jobs/{id}/prepare{height}"), b"")?;
    for _ in 0..WAIT_SECONDS {
        thread::sleep(Duration::from_secs(1));
        if client.file(&id, "print.3mf").is_some() {
            break;
        }
    }
    Ok(say(described(client, client.get(&format!("/v1/jobs/{id}"))?)))
}

fn tool(client: &Client, call: &str, args: &Value) -> Result<Vec<Value>, String> {
    Ok(say(client.post(&format!("/v1/tools/{call}"), args.to_string().as_bytes())?))
}

/// The language of CAD programs, also what the assistant reads.
const CAD_GUIDE: &str = include_str!("../../src/cad/GUIDE.md");

/// A CAD answer is a few lines of text: a model reads them after every build.
fn post_cad(client: &Client, call: &str, args: &Value) -> Result<Vec<Value>, String> {
    let done = client.post(&format!("/v1/cad/{call}"), args.to_string().as_bytes())?;
    Ok(vec![json!({ "type": "text", "text": done["text"].as_str().unwrap_or("") })])
}

fn post_scad(client: &Client, call: &str, args: &Value) -> Result<Vec<Value>, String> {
    Ok(say(client.post(&format!("/v1/scad/{call}"), args.to_string().as_bytes())?))
}

fn call(client: &Client, name: &str, args: &Value) -> Result<Vec<Value>, String> {
    match name {
        "maker_status" => Ok(say(client.get("/v1/status")?)),
        "maker_list_models" => Ok(say(json!({ "installed": client.get("/v1/models")?, "catalog": client.get("/v1/catalog")? }))),
        "maker_install_model" => {
            let id = id_of(args)?;
            client.post(&format!("/v1/models/{id}/install"), b"")?;
            Ok(say(json!({ "started": id, "next": "It downloads in Polyzon Maker's window, gigabytes at a time. maker_list_models shows it when it is ready." })))
        }
        "maker_generate_picture" => generate_picture(client, args),
        "maker_generate_model" => generate_model(client, args),
        "maker_list_jobs" => {
            let jobs = client.get("/v1/jobs")?;
            let list: Vec<Value> = jobs.as_array().into_iter().flatten().take(args["limit"].as_u64().unwrap_or(20) as usize).cloned().collect();
            Ok(say(json!(list.into_iter().map(|j| described(client, j)).collect::<Vec<_>>())))
        }
        "maker_get_job" => Ok(say(described(client, client.get(&format!("/v1/jobs/{}", id_of(args)?))?))),
        "maker_wait_job" => Ok(say(wait(client, &id_of(args)?, args["timeout_seconds"].as_u64().unwrap_or(WAIT_SECONDS))?)),
        "maker_view_result" => view(client, args),
        "maker_cancel_job" => Ok(say(client.post(&format!("/v1/jobs/{}/cancel", id_of(args)?), b"")?)),
        "maker_prepare_for_print" => prepare(client, args),
        "maker_open_in_window" => Ok(say(client.post(&format!("/v1/jobs/{}/open", id_of(args)?), b"")?)),
        "maker_open_in_slicer" => Ok(say(client.post(&format!("/v1/jobs/{}/slicer", id_of(args)?), b"")?)),
        "maker_tools_list" => {
            let query: String = url::form_urlencoded::byte_serialize(args["query"].as_str().unwrap_or("").as_bytes()).collect();
            Ok(say(client.get(&format!("/v1/tools?query={query}"))?))
        }
        "maker_tool_open" => tool(client, "open", args),
        "maker_tool_set" => tool(client, "set", args),
        "maker_tool_press" => tool(client, "press", args),
        "maker_tool_status" => tool(client, "status", args),
        "maker_tool_view" => {
            use base64::Engine;
            let png = client.post("/v1/tools/view", b"{}")?;
            let bytes = base64::engine::general_purpose::STANDARD.decode(png["png"].as_str().unwrap_or("")).map_err(|e| e.to_string())?;
            Ok(vec![image(&bytes)])
        }
        "maker_cad_guide" => Ok(vec![json!({ "type": "text", "text": CAD_GUIDE })]),
        "maker_cad_open" => post_cad(client, "open", args),
        "maker_cad_set" => post_cad(client, "set", args),
        "maker_cad_status" => post_cad(client, "status", args),
        "maker_cad_view" => {
            use base64::Engine;
            let png = client.post("/v1/cad/view", args.to_string().as_bytes())?;
            let bytes = base64::engine::general_purpose::STANDARD.decode(png["png"].as_str().unwrap_or("")).map_err(|e| e.to_string())?;
            Ok(vec![image(&bytes)])
        }
        "maker_cad_finish" => {
            let done = client.post("/v1/cad/finish", b"{}")?;
            let id = done["job"].as_str().unwrap_or("");
            Ok(say(described(client, client.get(&format!("/v1/jobs/{id}"))?)))
        }
        "maker_scad_open" => post_scad(client, "open", args),
        "maker_scad_set" => post_scad(client, "set", args),
        "maker_scad_status" => post_scad(client, "status", args),
        "maker_scad_view" => {
            use base64::Engine;
            let png = client.post("/v1/scad/view", args.to_string().as_bytes())?;
            let bytes = base64::engine::general_purpose::STANDARD.decode(png["png"].as_str().unwrap_or("")).map_err(|e| e.to_string())?;
            Ok(vec![image(&bytes)])
        }
        "maker_scad_finish" => {
            let done = client.post("/v1/scad/finish", b"{}")?;
            let id = done["job"].as_str().unwrap_or("");
            Ok(say(described(client, client.get(&format!("/v1/jobs/{id}"))?)))
        }
        "maker_tool_finish" => {
            let done = client.post("/v1/tools/finish", b"{}")?;
            let id = done["job"].as_str().unwrap_or("");
            Ok(say(described(client, client.get(&format!("/v1/jobs/{id}"))?)))
        }
        other => Err(format!("no such tool: {other}")),
    }
}

fn tools() -> Value {
    let id = json!({ "id": { "type": "string", "description": "The job's id" } });
    let tool = |name: &str, description: &str, properties: Value, required: &[&str]| {
        json!({ "name": name, "description": description, "inputSchema": { "type": "object", "properties": properties, "required": required } })
    };
    json!([
        tool("maker_status", "Is Polyzon Maker busy, which version it is, how many jobs wait.", json!({}), &[]),
        tool("maker_list_models", "The models installed on this computer and all the models Polyzon Maker can install.", json!({}), &[]),
        tool("maker_install_model", "Starts downloading a model from the catalog.", json!({ "id": { "type": "string" } }), &["id"]),
        tool("maker_generate_picture", "Makes pictures from words on this computer. Good pictures show one object on a plain background.", json!({
            "prompt": { "type": "string" },
            "variants": { "type": "integer", "minimum": 1, "maximum": 4, "description": "How many to make, 1 by default" },
            "model": { "type": "string" }, "seed": { "type": "integer" }, "thread": { "type": "string", "description": "Add to this generation" },
            "timeout_seconds": { "type": "integer", "description": "How long to wait before answering; the work goes on anyway" }
        }), &["prompt"]),
        tool("maker_generate_model", "Makes a 3D model from a picture: a file on this computer, or a finished picture job.", json!({
            "image_path": { "type": "string", "description": "A PNG, JPEG or WebP file" },
            "picture_job": { "type": "string", "description": "The id of a finished picture job" },
            "model": { "type": "string" }, "preset": { "type": "string", "description": "512 or 1024 where the model has them" },
            "seed": { "type": "integer" }, "title": { "type": "string" }, "thread": { "type": "string" }, "timeout_seconds": { "type": "integer" }
        }), &[]),
        tool("maker_list_jobs", "What has been made, newest first.", json!({ "limit": { "type": "integer" } }), &[]),
        tool("maker_get_job", "One job: state, error, and the paths of its files.", id.clone(), &["id"]),
        tool("maker_wait_job", "Waits for a job to finish.", json!({ "id": { "type": "string" }, "timeout_seconds": { "type": "integer" } }), &["id"]),
        tool("maker_view_result", "Shows what a job made as an image: the picture, or a render of the 3D model.", id.clone(), &["id"]),
        tool("maker_cancel_job", "Stops a job.", id.clone(), &["id"]),
        tool("maker_prepare_for_print", "Checks and repairs a 3D model and writes print.stl and print.3mf at a height in millimetres.", json!({
            "id": { "type": "string" }, "height_mm": { "type": "integer", "description": "Leave out to keep the model's own size: a tool's model is the size it was made, a generated one comes out 80 mm tall" }
        }), &["id"]),
        tool("maker_open_in_window", "Shows a job in Polyzon Maker's window.", id.clone(), &["id"]),
        tool("maker_open_in_slicer", "Opens a prepared model in the slicer installed on this computer.", id, &["id"]),
        tool("maker_tools_list", "The parametric tools: Gridfinity bins, boxes, drawer inserts, bricks, vases, hooks, signs, Braille signs, gears, threads, and tools that hollow, cut or repair a model. They need no graphics card and answer in seconds. Prefer one when the object has exact sizes.", json!({
            "query": { "type": "string", "description": "What to look for, in any words; leave out for all of them" }
        }), &[]),
        tool("maker_tool_open", "Opens a tool in the window and returns its form: every field with its value, limits and choices, and the size of the model built so far.", json!({
            "slug": { "type": "string", "description": "From maker_tools_list" }
        }), &["slug"]),
        tool("maker_tool_set", "Fills fields of the open tool, waits for the model to rebuild and returns the form again. Some fields appear only after a choice: read the form that comes back.", json!({
            "values": { "type": "object", "description": "Field name to value, as maker_tool_open named them. A file field takes {\"job\": \"<id>\"}" }
        }), &["values"]),
        tool("maker_tool_press", "Presses a button of the open tool's form, such as a ready-made variant, and returns the form.", json!({
            "label": { "type": "string", "description": "Its text, from the form's buttons" }
        }), &["label"]),
        tool("maker_tool_status", "The form of the open tool and where its build stands, after a call that answered with building: true.", json!({}), &[]),
        tool("maker_tool_view", "Shows the open tool's model as an image: look at it before finishing, and change the fields if it is wrong.", json!({}), &[]),
        tool("maker_scad_open", "Opens the OpenSCAD page and builds what is there: a new program from code, a template or a kept program. Answers with size, errors and the program's parameters. Lists the templates and kept programs.", json!({
            "code": { "type": "string" }, "title": { "type": "string" },
            "template": { "type": "string", "description": "A template's id" }, "program": { "type": "string", "description": "A kept program's id" }
        }), &[]),
        tool("maker_scad_set", "Changes the open program and rebuilds it: new code, or parameters by name. Answers with size and errors, and error lines point into the code. Sending only the parameters that change costs far less than sending the code.", json!({
            "code": { "type": "string" }, "params": { "type": "object", "description": "Parameter name to value" }
        }), &[]),
        tool("maker_scad_status", "Where the build stands, after an answer with building: true.", json!({}), &[]),
        tool("maker_scad_view", "Shows the built model as one image with a scale, from up to four sides. Look before finishing. A section cuts through it to show the inside.", json!({
            "views": { "type": "array", "items": { "type": "string", "enum": ["iso", "iso_back", "front", "back", "left", "right", "top", "bottom"] }, "maxItems": 4 },
            "section": { "type": "object", "description": "{\"axis\": \"x\", \"at\": 10} keeps the side below that plane" }
        }), &[]),
        tool("maker_scad_finish", "Puts the built model in the library as a job, with its program kept beside it. From there maker_prepare_for_print and maker_open_in_slicer work as for any model.", json!({}), &[]),
        tool("maker_cad_guide", "The CAD language in one page. Read it once before writing a program.", json!({}), &[]),
        tool("maker_cad_open", "Opens the CAD page and builds: a new program from code, an example or a kept program. Answers in a few lines: size, parts, warnings, errors with their line.", json!({
            "code": { "type": "string" }, "title": { "type": "string" },
            "example": { "type": "string" }, "program": { "type": "string", "description": "A kept program's id" }
        }), &[]),
        tool("maker_cad_set", "Changes the open program and rebuilds. Send edits, not the whole text, whenever a few words change: each find must be in the program exactly once. Or params by name, or the whole code.", json!({
            "edits": { "type": "array", "items": { "type": "object", "properties": { "find": { "type": "string" }, "put": { "type": "string" } }, "required": ["find", "put"] } },
            "params": { "type": "object" }, "code": { "type": "string" }
        }), &[]),
        tool("maker_cad_status", "Where the build stands, after an answer that says building.", json!({}), &[]),
        tool("maker_cad_view", "Shows the model in one image: up to four sides, each cell cell px wide (default 256). One part alone, or a section to see inside. Look after a build instead of reasoning about it.", json!({
            "views": { "type": "array", "items": { "type": "string", "enum": ["iso", "iso_back", "front", "back", "left", "right", "top", "bottom"] }, "maxItems": 4 },
            "section": { "type": "object", "description": "{\"axis\": \"x\", \"at\": 10}" },
            "part": { "type": "string" }, "cell": { "type": "integer", "minimum": 128, "maximum": 512 }
        }), &[]),
        tool("maker_cad_finish", "Puts the built model in the library as a job, its program beside it.", json!({}), &[]),
        tool("maker_tool_finish", "Puts the open tool's model in the library as a job. From there maker_prepare_for_print and maker_open_in_slicer work as for any model.", json!({}), &[]),
    ])
}

/// One message in, at most one message out; a notification gets no answer.
fn answer(line: &str, client: &mut Option<Client>, connect: &dyn Fn() -> Result<Client, String>) -> Option<Value> {
    let Ok(message) = serde_json::from_str::<Value>(line) else {
        return Some(json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "not JSON" } }));
    };
    let id = message.get("id").cloned()?;
    let params = &message["params"];
    let result = match message["method"].as_str().unwrap_or("") {
        "initialize" => {
            let info = &params["clientInfo"];
            *AGENT.lock().unwrap() = info["title"].as_str().or(info["name"].as_str()).unwrap_or("").to_string();
            json!({
            "protocolVersion": params["protocolVersion"].as_str().unwrap_or("2025-06-18"),
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "polyzon-maker", "title": "Polyzon Maker", "version": env!("CARGO_PKG_VERSION") },
            "instructions": "Generates 3D models and pictures on this computer with Polyzon Maker. Generation can take minutes: when a job comes back unfinished, call maker_wait_job."
            })
        }
        "ping" => json!({}),
        "tools/list" => json!({ "tools": tools() }),
        "tools/call" => {
            // a new key, another port or a restart of the program ends a connection: the next call makes a new one
            let done = client.take().map_or_else(connect, Ok).and_then(|open| {
                let done = call(&open, params["name"].as_str().unwrap_or(""), &params["arguments"]);
                if done.is_ok() {
                    *client = Some(open);
                }
                done
            });
            match done {
                Ok(content) => json!({ "content": content, "isError": false }),
                Err(problem) => json!({ "content": [{ "type": "text", "text": problem }], "isError": true }),
            }
        }
        other => {
            return Some(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": format!("no such method: {other}") } }));
        }
    };
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

pub fn run() {
    let mut client = None;
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines().map_while(Result::ok) {
        if line.trim().is_empty() {
            continue;
        }
        let greeting = serde_json::from_str::<Value>(&line).is_ok_and(|m| m["method"] == "initialize");
        if let Some(reply) = answer(&line, &mut client, &Client::find) {
            if writeln!(stdout, "{reply}").and_then(|()| stdout.flush()).is_err() {
                return;
            }
        }
        // the window shows who connected; when the program is not running it hears at the first call instead
        if greeting {
            thread::spawn(|| Client::running().map(|c| c.hello()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{api::Api, jobs::Jobs, store::{self, Store}};
    use std::{net::TcpListener, sync::Arc};

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n and the rest of a picture";

    fn no_maker() -> Result<Client, String> {
        Err("The API is off.".into())
    }

    fn talk(message: Value) -> Option<Value> {
        answer(&message.to_string(), &mut None, &no_maker)
    }

    #[test]
    fn it_answers_the_handshake_in_the_clients_version() {
        let reply = talk(json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-11-25", "capabilities": {} } })).unwrap();
        assert_eq!(reply["id"], 1);
        assert_eq!(reply["result"]["protocolVersion"], "2025-11-25");
        assert_eq!(reply["result"]["serverInfo"]["name"], "polyzon-maker");
        assert!(reply["result"]["capabilities"]["tools"].is_object());
    }

    #[test]
    fn a_notification_gets_no_answer_and_nonsense_gets_an_error() {
        assert!(talk(json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).is_none());
        assert_eq!(talk(json!({ "jsonrpc": "2.0", "id": 2, "method": "resources/list" })).unwrap()["error"]["code"], -32601);
        assert_eq!(answer("{ half a message", &mut None, &no_maker).unwrap()["error"]["code"], -32700);
    }

    #[test]
    fn every_tool_says_what_it_takes() {
        let reply = talk(json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/list" })).unwrap();
        let tools = reply["result"]["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 31);
        for tool in tools {
            assert!(tool["name"].as_str().unwrap().starts_with("maker_"));
            assert!(!tool["description"].as_str().unwrap().is_empty());
            assert_eq!(tool["inputSchema"]["type"], "object");
        }
    }

    #[test]
    fn a_closed_door_is_explained_to_the_model_and_not_thrown_at_the_client() {
        let call = json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": { "name": "maker_status", "arguments": {} } });
        let reply = talk(call).unwrap();
        assert_eq!(reply["result"]["isError"], true);
        assert!(reply["result"]["content"][0]["text"].as_str().unwrap().contains("API"));
    }

    struct Stand {
        client: Client,
        store: Arc<Store>,
        _api: Api,
    }

    fn stand() -> Stand {
        let d = std::env::temp_dir().join(format!("client-mcp-{}", store::random_id()));
        let store = Arc::new(Store::open(d.join("c"), d.join("d")).unwrap());
        let port = TcpListener::bind(("127.0.0.1", 0)).unwrap().local_addr().unwrap().port();
        store.save_settings(Settings { api_enabled: true, api_port: port, api_token: "secret".into(), ..store.settings() }).unwrap();
        let jobs = Arc::new(Jobs::open(store.clone(), Arc::default()));
        let api = Api::default();
        api.apply(&store, &jobs, Arc::new(|_| {})).unwrap();
        for (id, device) in [("trellis2", "vulkan"), ("zimage", "cuda")] {
            crate::packs::install_for_tests(&store, id, device);
        }
        Stand { client: Client::new(port, "secret".into()), store, _api: api }
    }

    fn tool(s: &Stand, name: &str, args: Value) -> Result<Value, String> {
        let content = call(&s.client, name, &args)?;
        Ok(serde_json::from_str(content[0]["text"].as_str().unwrap()).unwrap())
    }

    #[test]
    fn a_file_on_this_computer_becomes_a_model_job() {
        let s = stand();
        let path = s.store.data().join("cat.png");
        fs::write(&path, PNG).unwrap();
        let job = tool(&s, "maker_generate_model", json!({ "image_path": path, "preset": "512", "title": "Кот", "timeout_seconds": 0 })).unwrap();
        assert_eq!((job["state"].as_str(), job["kind"].as_str(), job["model"].as_str()), (Some("queued"), Some("model"), Some("trellis2")));
        assert_eq!(job["title"], "Кот");
        assert!(job["next"].as_str().unwrap().contains("maker_wait_job"));
        assert_eq!(tool(&s, "maker_status", json!({})).unwrap()["queued"], 1);
    }

    #[test]
    fn variants_stay_in_one_generation() {
        let s = stand();
        let jobs = tool(&s, "maker_generate_picture", json!({ "prompt": "a red boat", "variants": 3, "seed": 5, "timeout_seconds": 0 })).unwrap();
        let jobs = jobs.as_array().unwrap();
        assert_eq!(jobs.len(), 3);
        assert!(jobs.iter().all(|j| j["thread"] == jobs[0]["id"]));
        assert_eq!(tool(&s, "maker_list_jobs", json!({})).unwrap().as_array().unwrap().len(), 3);
    }

    #[test]
    fn what_cannot_be_done_comes_back_as_words() {
        let s = stand();
        assert!(tool(&s, "maker_generate_model", json!({})).unwrap_err().contains("image_path"));
        assert!(tool(&s, "maker_generate_model", json!({ "image_path": "/no/such/file.png" })).is_err());
        assert_eq!(tool(&s, "maker_get_job", json!({ "id": "nothing" })).unwrap_err(), "There is no such job.");
        assert!(tool(&s, "maker_nothing", json!({})).unwrap_err().contains("no such tool"));
    }

    #[test]
    fn every_listed_tool_is_really_there() {
        let s = stand();
        for tool in tools().as_array().unwrap() {
            let name = tool["name"].as_str().unwrap();
            let done = call(&s.client, name, &json!({}));
            assert!(!done.is_err_and(|e| e.contains("no such tool")), "{name}");
        }
    }

    #[test]
    fn a_wrong_key_is_turned_away() {
        let s = stand();
        let port: u16 = s.client.base.rsplit(':').next().unwrap().parse().unwrap();
        assert!(Client::new(port, "wrong".into()).get("/v1/status").unwrap_err().contains("key"));
    }
}
