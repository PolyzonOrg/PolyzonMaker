// Polyzon Maker: the Rust side. The page draws; everything that touches the computer goes through the
// few commands below. No shell and no file access from the page (TZ §18.1).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api;
mod assistant;
mod catalog;
mod chats;
mod contributions;
mod download;
mod fence;
mod glb;
mod hardware;
mod hf;
mod jobs;
mod memory;
mod mcp;
mod packs;
mod plugins;
mod programs;
mod power;
mod provenance;
mod slicers;
mod store;
mod sys;
mod telemetry;
#[cfg(windows)]
mod titlebar;
mod tray;

use api::{Api, Tell, MAX_IMAGE_BYTES};
use jobs::{Job, Jobs};
use packs::Packs;
use std::{fs, sync::{Arc, Mutex}, time::Duration};
use store::{Settings, Store};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    AppHandle, Emitter, Manager, State,
};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_updater::{Update, UpdaterExt};

type Result<T> = std::result::Result<T, String>;

const IMAGE_TYPES: [&str; 4] = ["png", "jpg", "jpeg", "webp"];

fn text<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(text)
}

#[tauri::command]
fn settings(store: State<Arc<Store>>) -> Settings {
    store.settings()
}

#[tauri::command]
async fn save_settings(store: State<'_, Arc<Store>>, new: Settings) -> Result<Settings> {
    let new = store::from_page(store.settings(), new);
    store.save_settings(new.clone()).map_err(text)?;
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || telemetry::send(&store));
    Ok(new)
}

/// What the page saw: a result printed, opened or rated, an error of its own.
#[tauri::command]
fn report(store: State<Arc<Store>>, event: String, model: String, device: String, code: String, seconds: f64) {
    telemetry::from_page(store.inner(), &event, &model, &device, &code, seconds);
}

#[tauri::command]
fn job_rate(app: AppHandle, jobs: State<Arc<Jobs>>, id: String, rating: String) {
    if let Some(job) = jobs.rate(&id, &rating) {
        let _ = app.emit("job", job);
    }
}

#[tauri::command]
async fn hardware(store: State<'_, Arc<Store>>) -> Result<hardware::Hardware> {
    let dir = store.packs();
    blocking(move || hardware::detect(&dir)).await
}

#[tauri::command]
async fn disk_free(store: State<'_, Arc<Store>>) -> Result<Option<u64>> {
    let dir = store.packs();
    blocking(move || hardware::free_gb(&dir)).await
}

/// The short test. `bench` events name each step as it starts.
#[tauri::command]
async fn measure(app: AppHandle, store: State<'_, Arc<Store>>, threads: usize) -> Result<hardware::Measured> {
    let dir = store.packs();
    blocking(move || {
        hardware::measure(threads, &dir, |step| {
            let _ = app.emit("bench", step);
        })
    })
    .await
}

#[tauri::command]
fn models() -> serde_json::Value {
    catalog::json()
}

#[tauri::command]
fn packs_installed(store: State<Arc<Store>>) -> Vec<packs::Installed> {
    packs::installed(&store)
}

#[tauri::command]
fn pack_install(app: AppHandle, store: State<Arc<Store>>, packs: State<Packs>, id: String, device: String) -> Result<()> {
    packs.install(app, store.inner().clone(), id, device)
}

#[tauri::command]
fn pack_install_file(app: AppHandle, store: State<Arc<Store>>, packs: State<Packs>, repo: String, file: String, device: String) -> Result<String> {
    packs.install_file(app, store.inner().clone(), repo, file, device)
}

#[tauri::command]
fn pack_install_text(app: AppHandle, store: State<Arc<Store>>, packs: State<Packs>, repo: String, files: Vec<hf::HfFile>, device: String) -> Result<String> {
    packs.install_text(app, store.inner().clone(), repo, files, device)
}

#[tauri::command]
async fn hf_files(repo: String) -> Result<Vec<hf::HfFile>> {
    blocking(move || hf::files(&repo)).await?
}

#[tauri::command]
fn pack_cancel(packs: State<Packs>, id: String) {
    packs.cancel(&id);
}

#[tauri::command]
async fn pack_remove(store: State<'_, Arc<Store>>, jobs: State<'_, Arc<Jobs>>, assistant: State<'_, Arc<assistant::Assistant>>, id: String) -> Result<()> {
    if jobs.running_model().as_deref() == Some(id.as_str()) {
        return Err("BUSY".into()); // its files are in use, and Windows would stop halfway through them
    }
    if packs::find(&store, &id).is_some_and(|p| p.kind == "text") || catalog::model(&id).is_some_and(|m| m.kind == "text") {
        assistant.stop();
    }
    let store = store.inner().clone();
    blocking(move || packs::remove(&store, &id)).await?
}

#[tauri::command]
async fn hf_search(query: String, task: String) -> Result<Vec<hf::HfModel>> {
    blocking(move || hf::search(&query, &task)).await?
}

#[tauri::command]
async fn hf_readme(repo: String) -> Result<String> {
    blocking(move || hf::readme(&repo)).await?
}

/// A picture for a new job, as the raw request body; its name comes in a header.
#[tauri::command]
fn job_image(request: Request<'_>, jobs: State<Arc<Jobs>>) -> Result<serde_json::Value> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("expected raw bytes".into()) };
    let name = request.headers().get("x-name").and_then(|v| v.to_str().ok()).unwrap_or("picture.png");
    let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
    if !IMAGE_TYPES.contains(&ext.as_str()) {
        return Err("INVALID_INPUT: PNG, JPEG or WebP".into());
    }
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("INVALID_INPUT: the picture is too large".into());
    }
    let id = store::random_id();
    let input = format!("input.{ext}");
    let dir = jobs.dir(&id)?;
    store::write_atomic(&dir.join(&input), bytes).map_err(text)?;
    Ok(serde_json::json!({ "id": id, "input": input }))
}

/// The queue paused or going on; what it is now.
#[tauri::command]
fn queue_pause(jobs: State<Arc<Jobs>>, store: State<Arc<Store>>, on: bool) -> Result<bool> {
    jobs.pause(on)?;
    Ok(store.settings().queue_paused)
}

/// What the computer does when the queue runs out: changed when `after` is given, and as it is now.
#[tauri::command]
fn queue_after(jobs: State<Arc<Jobs>>, after: Option<power::After>) -> Result<power::Plan> {
    if let Some(after) = after {
        jobs.choose(after)?;
    }
    Ok(power::Plan::new(jobs.chosen(), None))
}

/// A waiting job one place earlier or later in the queue.
#[tauri::command]
fn job_move(app: AppHandle, jobs: State<Arc<Jobs>>, id: String, earlier: bool) {
    for job in jobs.shift(&id, earlier) {
        let _ = app.emit("job", &job);
    }
}

#[tauri::command]
fn job_add(app: AppHandle, jobs: State<Arc<Jobs>>, job: Job) -> Result<Job> {
    let job = jobs.add(job)?;
    let _ = app.emit("job", &job); // a job waiting in the queue is shown too, not only one that runs
    Ok(job)
}

/// A finished model as the raw request body; its title comes in a header.
/// What the page put in a header, which carries only ASCII: names and titles come percent-encoded.
fn header_text(request: &Request<'_>, name: &str) -> String {
    let value = request.headers().get(name).and_then(|v| v.to_str().ok()).unwrap_or("");
    url::form_urlencoded::parse(format!("t={value}").as_bytes()).next().map_or(String::new(), |(_, v)| v.into_owned())
}

#[tauri::command]
fn job_import(request: Request<'_>, app: AppHandle, jobs: State<Arc<Jobs>>) -> Result<Job> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("expected raw bytes".into()) };
    let job = jobs.import(&header_text(&request, "x-title"), bytes)?;
    let _ = app.emit("job", &job);
    Ok(job)
}

/// A tool's file, where the person chooses to put it.
#[tauri::command]
async fn file_save(app: AppHandle, request: Request<'_>) -> Result<Option<String>> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("expected raw bytes".into()) };
    let (bytes, name) = (bytes.clone(), header_text(&request, "x-name"));
    let ext = name.rsplit('.').next().unwrap_or("stl").to_string();
    blocking(move || {
        let chosen = app.dialog().file().set_file_name(&name).add_filter(ext.to_uppercase(), &[ext.as_str()]).blocking_save_file();
        let Some(to) = chosen else { return Ok(None) };
        let to = to.into_path().map_err(text)?;
        fs::write(&to, bytes).map_err(text)?;
        Ok(Some(to.to_string_lossy().into_owned()))
    })
    .await?
}

#[tauri::command]
async fn assistant_start(store: State<'_, Arc<Store>>, assistant: State<'_, Arc<assistant::Assistant>>, id: String) -> Result<()> {
    let (store, assistant) = (store.inner().clone(), assistant.inner().clone());
    blocking(move || assistant.start(&store, &id)).await?
}

#[tauri::command]
fn assistant_chat(app: AppHandle, assistant: State<Arc<assistant::Assistant>>, id: String, messages: serde_json::Value) -> Result<()> {
    assistant.inner().clone().chat(app, id, messages)
}

#[tauri::command]
fn assistant_cancel(assistant: State<Arc<assistant::Assistant>>, id: String) {
    assistant.cancel(&id);
}

#[tauri::command]
fn chats_list(store: State<Arc<Store>>) -> Vec<serde_json::Value> {
    chats::list(&store)
}

#[tauri::command]
fn chat_read(store: State<Arc<Store>>, id: String) -> Result<serde_json::Value> {
    chats::read(&store, &id)
}

#[tauri::command]
fn chat_save(store: State<Arc<Store>>, chat: serde_json::Value) -> Result<serde_json::Value> {
    chats::save(&store, chat)
}

#[tauri::command]
fn chat_delete(store: State<Arc<Store>>, id: String) -> Result<()> {
    chats::delete(&store, &id)
}

#[tauri::command]
fn programs_list(store: State<Arc<Store>>) -> Vec<programs::Program> {
    programs::list(&store)
}

#[tauri::command]
fn program_save(store: State<Arc<Store>>, program: programs::Program) -> Result<programs::Program> {
    programs::save(&store, program)
}

#[tauri::command]
fn program_delete(store: State<Arc<Store>>, id: String) -> Result<()> {
    programs::delete(&store, &id)
}

/// The window has started listening for calls that come through the local API.
#[tauri::command]
fn tools_ready(api: State<Api>) {
    api.window_is_ready();
}

/// The window's answer to a call that came through the local API.
#[tauri::command]
fn tool_answer(api: State<Api>, id: String, value: serde_json::Value) {
    api.answered(&id, value);
}

#[tauri::command]
fn jobs_list(jobs: State<Arc<Jobs>>) -> Vec<Job> {
    jobs.list()
}

#[tauri::command]
fn job_cancel(app: AppHandle, jobs: State<Arc<Jobs>>, id: String) {
    if let Some(job) = jobs.cancel(&id) {
        let _ = app.emit("job", job);
    }
}

#[tauri::command]
fn job_retry(app: AppHandle, jobs: State<Arc<Jobs>>, id: String) {
    jobs.retry(&app, &id);
}

#[tauri::command]
fn job_delete(jobs: State<Arc<Jobs>>, id: String) -> Result<()> {
    jobs.delete(&id)
}

/// A file of a job, as raw bytes for the page.
#[tauri::command]
async fn job_read(jobs: State<'_, Arc<Jobs>>, id: String, name: String) -> Result<Response> {
    store::safe_name(&name)?;
    let path = jobs.dir(&id)?.join(name);
    Ok(Response::new(blocking(move || fs::read(path)).await?.map_err(text)?))
}

/// A file the page made for a job (the preview picture, a print version).
#[tauri::command]
fn job_write(request: Request<'_>, jobs: State<Arc<Jobs>>) -> Result<()> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("expected raw bytes".into()) };
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).unwrap_or("");
    store::safe_name(header("x-name"))?;
    store::write_atomic(&jobs.dir(header("x-id"))?.join(header("x-name")), bytes).map_err(text)
}

#[tauri::command]
async fn job_reveal(jobs: State<'_, Arc<Jobs>>, id: String, name: String) -> Result<()> {
    store::safe_name(&name)?;
    let path = jobs.dir(&id)?.join(name);
    sys::reveal(&path.to_string_lossy()).map_err(text)
}

/// Asks where to save a file of a job and copies it there. None: the person changed their mind.
#[tauri::command]
async fn job_export(app: AppHandle, jobs: State<'_, Arc<Jobs>>, id: String, name: String, suggested: String) -> Result<Option<String>> {
    store::safe_name(&name)?;
    let from = jobs.dir(&id)?.join(&name);
    let ext = name.rsplit('.').next().unwrap_or("stl").to_string();
    blocking(move || {
        let chosen = app.dialog().file().set_file_name(&suggested).add_filter(ext.to_uppercase(), &[ext.as_str()]).blocking_save_file();
        let Some(to) = chosen else { return Ok(None) };
        let to = to.into_path().map_err(text)?;
        fs::copy(from, &to).map_err(text)?;
        Ok(Some(to.to_string_lossy().into_owned()))
    })
    .await?
}

#[tauri::command]
fn slicers_found() -> Vec<slicers::Slicer> {
    slicers::find()
}

#[tauri::command]
fn slicer_open(jobs: State<Arc<Jobs>>, slicer: String, id: String, name: String) -> Result<()> {
    store::safe_name(&name)?;
    slicers::open(&slicer, &jobs.dir(&id)?.join(name)).map_err(text)
}

/// Web pages only, and only those Polyzon Maker links to.
#[tauri::command]
fn open_url(url: String) -> Result<()> {
    // and two agents' own install links, which only fill in this program as an MCP server
    const HOSTS: [&str; 7] = ["https://huggingface.co/", "https://github.com/", "https://maker.polyzon.org/", "https://polyzon.org/", "https://www.nvidia.com/", "cursor://anysphere.cursor-deeplink/mcp/install?", "lmstudio://add-mcp?"];
    if !HOSTS.iter().any(|h| url.starts_with(h)) {
        return Err("not a page Polyzon Maker links to".into());
    }
    sys::open(&url).map_err(text)
}

/// The clipboard, when the web view refuses the page (lib/clipboard.ts).
/// The person has read where the window goes: from now on closing puts it in the tray at once.
#[tauri::command]
fn to_tray(app: AppHandle, store: State<Arc<Store>>) -> Result<()> {
    let mut settings = store.settings();
    settings.tray_told = true;
    store.save_settings(settings).map_err(text)?;
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(text)?;
    }
    Ok(())
}

/// The language the page shows, for the tray's menu.
#[tauri::command]
fn tray_language(app: AppHandle, lang: String) -> Result<()> {
    tray::relabel(&app, lang == "ru").map_err(text)
}

#[tauri::command]
fn copy_text(content: String) -> Result<()> {
    sys::copy_text(&content).map_err(text)
}

/// Asks where new models should go. None: the person changed their mind.
#[tauri::command]
async fn models_folder(app: AppHandle, store: State<'_, Arc<Store>>, packs: State<'_, Packs>) -> Result<Option<Settings>> {
    if packs.busy() {
        return Err("BUSY".into()); // a download in progress keeps its folder
    }
    let store = store.inner().clone();
    blocking(move || {
        let Some(chosen) = app.dialog().file().blocking_pick_folder().and_then(|p| p.into_path().ok()) else { return Ok(None) };
        store.set_models_folder(&chosen.to_string_lossy()).map(Some)
    })
    .await?
}

fn announce(app: &AppHandle) -> api::Notify {
    let app = app.clone();
    Arc::new(move |tell| {
        let _ = match tell {
            Tell::Job(job) => app.emit("job", job),
            Tell::Open(id) => app.emit("api-open", id),
            Tell::Prepare(id, height) => app.emit("api-prepare", (id, height)),
            Tell::Install(id) => app.emit("api-install", id),
            Tell::Tool(id, call, args) => app.emit("api-tool", serde_json::json!({ "id": id, "call": call, "args": args })),
        };
    })
}

/// The AI agents that connected through MCP since the program started: name and seconds ago.
#[tauri::command]
fn api_agents(door: State<Api>) -> Vec<serde_json::Value> {
    door.agents()
}

/// Turns the door for other programs on or off, moves it to another port, changes its key.
#[tauri::command]
fn api_set(app: AppHandle, store: State<Arc<Store>>, jobs: State<Arc<Jobs>>, door: State<Api>, enabled: bool, port: u16, new_key: bool) -> Result<Settings> {
    let was = store.settings();
    let mut new = was.clone();
    new.api_enabled = enabled;
    new.api_port = if port < 1024 { api::DEFAULT_PORT } else { port };
    if new.api_token.is_empty() || new_key {
        new.api_token = store::random_id() + &store::random_id();
    }
    store.save_settings(new.clone()).map_err(text)?;
    if let Err(problem) = door.apply(store.inner(), jobs.inner(), announce(&app)) {
        // what worked goes on working: a taken port must not close the door that was open
        store.save_settings(was).map_err(text)?;
        let _ = door.apply(store.inner(), jobs.inner(), announce(&app));
        return Err(problem);
    }
    Ok(new)
}

#[tauri::command]
fn plugins_list(store: State<Arc<Store>>) -> Vec<plugins::Manifest> {
    plugins::list(&store)
}

/// Asks for a plugin's file and reads what it asks for. Nothing is installed yet.
#[tauri::command]
async fn plugin_pick(app: AppHandle) -> Result<Option<serde_json::Value>> {
    blocking(move || {
        let Some(path) = app.dialog().file().add_filter("Plugin", &["zip"]).blocking_pick_file().and_then(|p| p.into_path().ok()) else { return Ok(None) };
        let manifest = plugins::inspect(&path)?;
        Ok(Some(serde_json::json!({ "path": path, "manifest": manifest })))
    })
    .await?
}

/// The person read what it asks for and said yes.
#[tauri::command]
async fn plugin_install(store: State<'_, Arc<Store>>, path: String) -> Result<Settings> {
    let store = store.inner().clone();
    blocking(move || {
        let manifest = plugins::install(&store, std::path::Path::new(&path))?;
        let mut settings = store.settings();
        // a new version is asked about again, as the first was: the yes to an open network among it
        settings.plugins.insert(manifest.id, plugins::Grant { permissions: manifest.permissions, ..plugins::Grant::default() });
        store.save_settings(settings.clone()).map_err(text)?;
        plugins::refresh(&store);
        Ok(settings)
    })
    .await?
}

fn change_grant(store: &Store, id: &str, change: impl FnOnce(&mut plugins::Grant)) -> Result<Settings> {
    let mut settings = store.settings();
    if let Some(grant) = settings.plugins.get_mut(id) {
        change(grant);
    }
    store.save_settings(settings.clone()).map_err(text)?;
    plugins::refresh(store);
    Ok(settings)
}

#[tauri::command]
fn plugin_switch(store: State<Arc<Store>>, id: String, on: bool) -> Result<Settings> {
    change_grant(&store, &id, |grant| grant.off = !on)
}

/// The person's answer for a computer where the fence leaves the network open (fence.rs).
#[tauri::command]
fn plugin_network(store: State<Arc<Store>>, id: String, allow: bool) -> Result<Settings> {
    change_grant(&store, &id, |grant| grant.network = allow)
}

#[tauri::command]
async fn plugin_remove(store: State<'_, Arc<Store>>, id: String) -> Result<Settings> {
    let store = store.inner().clone();
    blocking(move || {
        plugins::remove(&store, &id)?;
        let mut settings = store.settings();
        settings.plugins.remove(&id);
        store.save_settings(settings.clone()).map_err(text)?;
        plugins::refresh(&store);
        Ok(settings)
    })
    .await?
}

/// The new version, downloaded and checked against our key, waiting for a quiet moment.
#[derive(Default)]
struct Fetched(Mutex<Option<(Update, Vec<u8>)>>);

/// A newer version, if there is one.
#[tauri::command]
async fn update_check(app: AppHandle) -> Result<Option<serde_json::Value>> {
    let found = app.updater().map_err(text)?.check().await.map_err(text)?;
    Ok(found.map(|u| serde_json::json!({ "version": u.version, "notes": u.body, "date": u.raw_json["pub_date"] })))
}

/// Safe during any work: nothing changes until the install.
#[tauri::command]
async fn update_download(app: AppHandle, fetched: State<'_, Fetched>) -> Result<()> {
    let Some(update) = app.updater().map_err(text)?.check().await.map_err(text)? else { return Ok(()) };
    let (mut done, progress) = (0u64, app.clone());
    let report = move |chunk: usize, total: Option<u64>| {
        done += chunk as u64;
        let _ = progress.emit("update", (done, total));
    };
    let bytes = update.download(report, || {}).await.map_err(text)?;
    *fetched.0.lock().unwrap() = Some((update, bytes));
    Ok(())
}

/// Installs what was downloaded and starts it. Never in the middle of someone's work.
#[tauri::command]
fn update_install(app: AppHandle, jobs: State<Arc<Jobs>>, packs: State<Packs>, fetched: State<Fetched>) -> Result<()> {
    if jobs.busy() || packs.busy() {
        return Err("BUSY".into());
    }
    let Some((update, bytes)) = fetched.0.lock().unwrap().take() else { return Err("NOT_DOWNLOADED".into()) };
    update.install(bytes).map_err(text)?;
    app.state::<Arc<assistant::Assistant>>().stop();
    app.restart()
}

/// A version downloaded but not restarted for goes in as the app closes, and starts next time.
fn install_on_close(app: &AppHandle) {
    if let Some((update, bytes)) = app.state::<Fetched>().0.lock().unwrap().take() {
        let _ = update.restart_after_install(false).install(bytes);
    }
}

#[tauri::command]
fn telemetry_sample() -> serde_json::Value {
    telemetry::sample()
}

#[tauri::command]
fn data_folder(app: AppHandle, store: State<Arc<Store>>) -> serde_json::Value {
    let exe = std::env::current_exe().ok();
    serde_json::json!({ "data": store.data(), "models": store.packs(), "version": app.package_info().version.to_string(), "exe": exe })
}

/// The title bar is on the screen: on Windows its maximize button gets what snap layouts need.
#[tauri::command]
fn snap_ready(window: tauri::WebviewWindow) {
    #[cfg(windows)]
    titlebar::attach(&window);
    #[cfg(not(windows))]
    let _ = window;
}

/// The window's close button comes here when something is running: the page has asked.
#[tauri::command]
async fn quit(app: AppHandle, jobs: State<'_, Arc<Jobs>>, packs: State<'_, Packs>) -> Result<()> {
    let jobs = jobs.inner().clone();
    blocking(move || jobs.stop()).await?;
    packs.stop();
    if let Some(assistant) = app.try_state::<Arc<assistant::Assistant>>() {
        assistant.stop();
    }
    app.exit(0);
    Ok(())
}

fn main() {
    // a plugin's program, to be started inside its fence: before anything else, which would take this for a second copy
    let args: Vec<std::ffi::OsString> = std::env::args_os().collect();
    if args.get(1).is_some_and(|a| a == "--fence") {
        std::process::exit(fence::launch(&args[2..]));
    }
    store::take_over_old_folders();
    if std::env::args().any(|a| a == "--mcp") {
        return mcp::run();
    }
    // WebKitGTK draws a blank window with NVIDIA's driver unless this is set
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    tauri::Builder::default()
        // a second copy would run a second queue over the same folders: it hands over to the first
        .plugin(tauri_plugin_single_instance::init(|app, _, _| tray::show(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri::plugin::Builder::<tauri::Wry>::new("no-webrtc").js_init_script_on_all_frames(plugins::NO_WEBRTC).build())
        .register_uri_scheme_protocol("plugin", |ctx, request| plugins::serve(&ctx.app_handle().state::<Arc<Store>>(), request.uri()))
        .on_window_event(|window, event| {
            #[cfg(windows)]
            if let tauri::WindowEvent::Resized(_) = event {
                titlebar::place();
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                // with the icon there, closing only puts the window away: the queue goes on, and the icon's menu quits.
                // The first time the page says so first, and the window goes when the person has read it (to_tray).
                if tray::holds(app) {
                    api.prevent_close();
                    if app.state::<Arc<Store>>().settings().tray_told {
                        let _ = window.hide();
                    } else {
                        let _ = app.emit("close-to-tray", ());
                    }
                    return;
                }
                let busy = app.state::<Arc<Jobs>>().busy() || app.state::<Packs>().busy();
                if busy {
                    api.prevent_close();
                    let _ = app.emit("close-requested", ());
                }
            }
        })
        .setup(|app| {
            let store = Arc::new(Store::open(app.path().app_config_dir()?, app.path().app_local_data_dir()?)?);
            telemetry::note_crashes(store.data());
            plugins::refresh(&store);
            let assistant = Arc::new(assistant::Assistant::default());
            assistant.clone().let_go_when_idle();
            let jobs = Arc::new(Jobs::open(store.clone(), assistant.clone()));
            jobs.clone().work(app.handle().clone());
            let reporting = store.clone();
            std::thread::spawn(move || telemetry::started(&reporting, &hardware::detect(reporting.data())));
            let door = Api::default();
            // a port taken by something else only turns the door off: the app itself is fine
            let _ = door.apply(&store, &jobs, announce(app.handle()));
            app.manage(door);
            app.manage(store);
            app.manage(jobs);
            app.manage(Packs::default());
            app.manage(assistant);
            app.manage(Fetched::default());
            // no icon is no reason not to start: the close button then closes, as before
            let _ = tray::attach(app.handle());
            // back from an update that went in from the tray: the window stays there, as it was
            if tray::came_back(app.state::<Arc<Store>>().data()) && tray::holds(app.handle()) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            let away = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(60));
                tray::update_if_away(&away);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            settings,
            save_settings,
            hardware,
            measure,
            models,
            packs_installed,
            pack_install,
            pack_install_file,
            pack_install_text,
            hf_files,
            pack_cancel,
            pack_remove,
            hf_search,
            hf_readme,
            job_image,
            job_add,
            job_move,
            queue_pause,
            queue_after,
            job_import,
            file_save,
            tool_answer,
            tools_ready,
            assistant_start,
            assistant_chat,
            assistant_cancel,
            chats_list,
            chat_read,
            chat_save,
            chat_delete,
            programs_list,
            program_save,
            program_delete,
            jobs_list,
            job_cancel,
            job_retry,
            job_delete,
            disk_free,
            job_read,
            job_write,
            job_reveal,
            job_export,
            slicers_found,
            slicer_open,
            open_url,
            copy_text,
            tray_language,
            to_tray,
            models_folder,
            api_set,
            api_agents,
            plugins_list,
            plugin_pick,
            plugin_install,
            plugin_switch,
            plugin_network,
            plugin_remove,
            update_check,
            update_download,
            update_install,
            snap_ready,
            telemetry_sample,
            report,
            job_rate,
            data_folder,
            quit,
        ])
        .build(tauri::generate_context!())
        .expect("Polyzon Maker did not start")
        .run(|app, event| {
            // the Dock icon of a Mac whose window was put away brings it back
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { has_visible_windows: false, .. } = event {
                tray::show(app);
            }
            if let tauri::RunEvent::Exit = event {
                // nothing asks when no job runs, and a text model would stay in memory after the window
                app.state::<Arc<assistant::Assistant>>().stop();
                install_on_close(app);
            }
        });
}
