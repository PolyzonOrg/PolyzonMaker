//! Plugins: a zip with plugin.json and whatever it brings: its page (index.html), panels, commands,
//! themes and models (contributions.rs). Its pages run in a sandboxed frame that sees nothing of the
//! computer: no files, no network, not this app's commands. All they can do is ask the page, and the page
//! answers only what the person granted at install. A model's program runs in the plugin's fence (fence.rs).
//! PLUGINS.md says all of it for a plugin's author.

use crate::contributions::{self, Contributes};
use crate::store::{self, Store};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::{self, Read},
    path::{Component, Path, PathBuf},
};
use tauri::http::{header, Response, StatusCode, Uri};

pub const PERMISSIONS: [&str; 4] = ["jobs.read", "jobs.create", "library.add", "program"];
const MAX_BYTES: u64 = 64 << 20;
const MAX_FILES: usize = 2000;
/// What a plugin's pages use to talk to the app. It is ours: a plugin cannot replace it.
const BRIDGE: &[u8] = include_bytes!("../plugin-bridge.js");
/// A page's real address. The handler is told `plugin://localhost/...` on every system, but on Windows the
/// page lives at `http://plugin.localhost/...`, and rules naming anything else shut it out of its own files.
const HOME: &str = if cfg!(windows) { "http://plugin.localhost" } else { "plugin://localhost" };
/// Runs before any script in every frame. A page's rules do not cover WebRTC, which reaches any address,
/// so no frame gets it; the app itself never uses it. It cannot be got back: a nested frame is another
/// origin and starts with this same script.
pub const NO_WEBRTC: &str = "for (const name of Object.getOwnPropertyNames(window)) if (/^(webkit)?RTC/.test(name)) delete window[name]";

#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub contributes: Contributes,
    /// Whether it has a page of its own; read from its files, not from what it says
    #[serde(default, skip_deserializing)]
    pub page: bool,
}

/// What the person allowed. It lives in the settings, where a plugin cannot reach.
#[derive(Clone, Serialize, Deserialize, Default, PartialEq, Debug)]
#[serde(default)]
pub struct Grant {
    pub permissions: Vec<String>,
    pub off: bool,
    /// The person let its program run on a computer where the fence does not close the network
    pub network: bool,
}

fn check(m: &Manifest, has: &dyn Fn(&str) -> bool) -> Result<(), String> {
    let id_ok = (2..=40).contains(&m.id.len())
        && m.id.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
        && m.id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    let version_ok = (1..=20).contains(&m.version.len()) && m.version.chars().all(|c| c.is_ascii_digit() || c == '.');
    let name_ok = !m.name.trim().is_empty() && m.name.chars().count() <= 60;
    let words_ok = m.author.chars().count() <= 60 && m.description.chars().count() <= 300;
    let asks_ok = m.permissions.iter().all(|p| PERMISSIONS.contains(&p.as_str()));
    if !(id_ok && version_ok && name_ok && words_ok && asks_ok) {
        return Err("BAD_MANIFEST".into());
    }
    if !m.page && m.contributes.is_empty() {
        return Err("NOT_A_PLUGIN".into());
    }
    contributions::check(&m.contributes, has, m.page, &m.permissions)
}

fn archive(zip: &Path) -> Result<zip::ZipArchive<File>, String> {
    let file = File::open(zip).map_err(|e| e.to_string())?;
    zip::ZipArchive::new(file).map_err(|_| "NOT_A_PLUGIN".to_string())
}

/// Reads and judges a plugin without unpacking anything.
pub fn inspect(zip: &Path) -> Result<Manifest, String> {
    let mut files = archive(zip)?;
    if files.len() > MAX_FILES {
        return Err("TOO_LARGE".into());
    }
    let (mut total, mut names) = (0u64, std::collections::HashSet::new());
    for i in 0..files.len() {
        let entry = files.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_symlink() || entry.enclosed_name().is_none() {
            return Err("BAD_FILE".into());
        }
        total = total.saturating_add(entry.size());
        names.insert(entry.name().to_string());
    }
    if total > MAX_BYTES {
        return Err("TOO_LARGE".into());
    }
    let mut text = String::new();
    let mut manifest = files.by_name("plugin.json").map_err(|_| "NOT_A_PLUGIN".to_string())?;
    manifest.by_ref().take(64 << 10).read_to_string(&mut text).map_err(|_| "BAD_MANIFEST".to_string())?;
    let mut manifest: Manifest = serde_json::from_str(&text).map_err(|e| format!("BAD_MANIFEST: {e}"))?;
    manifest.page = names.contains("index.html");
    check(&manifest, &|name| names.contains(name))?;
    Ok(manifest)
}

/// Unpacks beside the old version and swaps at the end: a failure leaves what was there.
pub fn install(store: &Store, zip: &Path) -> Result<Manifest, String> {
    let manifest = inspect(zip)?;
    let dir = folder(store);
    let new = dir.join(format!(".new-{}", manifest.id));
    let _ = fs::remove_dir_all(&new);
    let unpacked = unpack(zip, &new);
    if let Err(e) = unpacked {
        let _ = fs::remove_dir_all(&new);
        return Err(e);
    }
    let target = dir.join(&manifest.id);
    let _ = fs::remove_dir_all(&target);
    fs::rename(&new, &target).map_err(|e| e.to_string())?;
    Ok(manifest)
}

fn unpack(zip: &Path, to: &Path) -> Result<(), String> {
    let mut files = archive(zip)?;
    let mut left = MAX_BYTES;
    for i in 0..files.len() {
        let mut entry = files.by_index(i).map_err(|e| e.to_string())?;
        let path = to.join(entry.enclosed_name().ok_or("BAD_FILE")?);
        if entry.is_dir() {
            fs::create_dir_all(&path).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        // the sizes in a zip are only what it says about itself
        let written = io::copy(&mut entry.by_ref().take(left + 1), &mut File::create(&path).map_err(|e| e.to_string())?);
        left = left.checked_sub(written.map_err(|e| e.to_string())?).ok_or("TOO_LARGE")?;
    }
    Ok(())
}

pub fn folder(store: &Store) -> PathBuf {
    store.data().join("plugins")
}

pub fn list(store: &Store) -> Vec<Manifest> {
    let mut all: Vec<Manifest> = store::read_each(&folder(store), "plugin.json");
    for m in &mut all {
        m.page = folder(store).join(&m.id).join("index.html").is_file();
    }
    all
}

/// Tells the catalog which models the plugins bring now: those of plugins that are on, whose program the
/// person allowed, on a system with a fence to run it in.
pub fn refresh(store: &Store) {
    let grants = store.settings().plugins;
    let on = |m: &&Manifest| grants.get(&m.id).is_some_and(|g| !g.off && g.permissions.iter().any(|p| p == "program"));
    let models = if crate::fence::READY { list(store).iter().filter(on).flat_map(|m| contributions::models(&m.id, &m.name, &m.contributes)).collect() } else { vec![] };
    crate::catalog::set_plugin_models(models);
}

/// The plugin, its models and its fence. The settings are the caller's.
pub fn remove(store: &Store, id: &str) -> Result<(), String> {
    store::safe_name(id)?;
    if let Some(m) = list(store).into_iter().find(|m| m.id == id) {
        for model in &m.contributes.models {
            if let Some(own) = model.get("id").and_then(|v| v.as_str()) {
                crate::packs::remove(store, &contributions::model_id(id, own))?;
            }
        }
    }
    crate::fence::forget(&crate::fence::name(id));
    let dir = folder(store).join(id);
    if dir.exists() { fs::remove_dir_all(dir).map_err(|e| e.to_string()) } else { Ok(()) }
}

fn kind(name: &str) -> &'static str {
    match name.rsplit('.').next().unwrap_or("") {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "wasm" => "application/wasm",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    }
}

/// One plain path below the plugin's folder. The address comes from the plugin itself.
fn inside(dir: &Path, path: &str) -> Option<PathBuf> {
    let path = if path.is_empty() { "index.html" } else { path };
    let plain = !path.contains(['\\', '\0', ':']) && Path::new(path).components().all(|c| matches!(c, Component::Normal(_)));
    Some(dir.join(path)).filter(|p| plain && p.is_file())
}

/// Each page may load only from its own plugin's folder and may talk to nothing else. Those limits
/// hold whatever its code does, because the rules arrive with the page and code can only tighten them.
fn rules(own: &str) -> String {
    format!(
        "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' {own}; style-src 'unsafe-inline' {own}; img-src data: blob: {own}; \
         font-src {own}; media-src blob: {own}; connect-src {own}; worker-src blob: {own}; base-uri 'none'; form-action 'none'"
    )
}

fn plain(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder().status(status).body(vec![]).unwrap()
}

/// Answers `plugin://localhost/<id>/<path>`.
pub fn serve(store: &Store, uri: &Uri) -> Response<Vec<u8>> {
    // addresses stay undecoded: a plugin's files have plain names, and %2e is then just a missing file
    let path = uri.path().trim_start_matches('/');
    let (id, rest) = path.split_once('/').unwrap_or((path, ""));
    let on = store.settings().plugins.get(id).is_some_and(|grant| !grant.off);
    if !on || store::safe_name(id).is_err() {
        return plain(StatusCode::NOT_FOUND);
    }
    let bytes = if rest == "maker.js" {
        Ok(BRIDGE.to_vec())
    } else {
        inside(&folder(store).join(id), rest).ok_or(()).and_then(|p| fs::read(p).map_err(|_| ()))
    };
    let Ok(bytes) = bytes else { return plain(StatusCode::NOT_FOUND) };
    Response::builder()
        .header(header::CONTENT_TYPE, kind(if rest.is_empty() { "index.html" } else { rest }))
        .header(header::CONTENT_SECURITY_POLICY, rules(&format!("{HOME}/{id}/")))
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        // a sandboxed page has no origin of its own, so even its own files count as another site's
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "no-store")
        .body(bytes)
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::{write::SimpleFileOptions, ZipWriter};

    const GOOD: &str = r#"{"id":"stand","name":"Подставка","version":"1.2.0","permissions":["library.add"]}"#;

    fn folder_for_test() -> PathBuf {
        let d = std::env::temp_dir().join(format!("maker-pl-{}", store::random_id()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn zip_of(dir: &Path, files: &[(&str, &[u8])]) -> PathBuf {
        let path = dir.join(format!("{}.zip", store::random_id()));
        let mut zip = ZipWriter::new(File::create(&path).unwrap());
        for (name, bytes) in files {
            zip.start_file(*name, SimpleFileOptions::default()).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
        path
    }

    fn opened(dir: &Path) -> Store {
        Store::open(dir.join("config"), dir.join("data")).unwrap()
    }

    fn turned_on(store: &Store, id: &str) {
        let mut settings = store.settings();
        settings.plugins.insert(id.into(), Grant::default());
        store.save_settings(settings).unwrap();
    }

    fn uri(path: &str) -> Uri {
        format!("plugin://localhost/{path}").parse().unwrap()
    }

    #[test]
    fn a_plugin_says_who_it_is_and_what_it_asks_for() {
        let d = folder_for_test();
        let zip = zip_of(&d, &[("plugin.json", GOOD.as_bytes()), ("index.html", b"<p>hi")]);
        let m = inspect(&zip).unwrap();
        assert_eq!((m.id.as_str(), m.name.as_str()), ("stand", "Подставка"));
        assert_eq!(m.permissions, ["library.add"]);
    }

    #[test]
    fn something_that_is_not_a_plugin_is_refused_by_name() {
        let d = folder_for_test();
        fs::write(d.join("x.zip"), b"not a zip").unwrap();
        assert_eq!(inspect(&d.join("x.zip")).unwrap_err(), "NOT_A_PLUGIN");
        assert_eq!(inspect(&zip_of(&d, &[("readme.txt", b"hi")])).unwrap_err(), "NOT_A_PLUGIN");
        assert_eq!(inspect(&zip_of(&d, &[("plugin.json", GOOD.as_bytes())])).unwrap_err(), "NOT_A_PLUGIN");
        assert!(inspect(&zip_of(&d, &[("plugin.json", b"{"), ("index.html", b"")])).unwrap_err().starts_with("BAD_MANIFEST: "));
    }

    #[test]
    fn the_examples_beside_the_app_are_plugins_it_takes() {
        let d = folder_for_test();
        let tools = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../tools");
        let mut seen = vec![];
        for example in fs::read_dir(&tools).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().starts_with("plugin-")) {
            let files: Vec<(String, Vec<u8>)> = fs::read_dir(example.path()).unwrap().flatten().filter(|f| f.path().is_file()).map(|f| (f.file_name().to_string_lossy().into_owned(), fs::read(f.path()).unwrap())).collect();
            let named: Vec<(&str, &[u8])> = files.iter().map(|(n, b)| (n.as_str(), b.as_slice())).collect();
            let m = inspect(&zip_of(&d, &named)).unwrap_or_else(|e| panic!("{}: {e}", example.path().display()));
            seen.push(m.id);
        }
        seen.sort();
        assert_eq!(seen, ["coaster", "lathe", "sand"]);
    }

    #[test]
    fn a_plugin_without_a_page_is_one_when_it_brings_something_else() {
        let d = folder_for_test();
        let theme = r##"{"id":"sand","name":"Sand","version":"1","contributes":{"themes":[{"id":"sand","title":"Sand","base":"light","colors":{"--bg":"#f4efe6"}}]}}"##;
        let m = inspect(&zip_of(&d, &[("plugin.json", theme.as_bytes())])).unwrap();
        assert!(!m.page);
        assert_eq!(m.contributes.themes[0].colors["--bg"], "#f4efe6");
        let command = r#"{"id":"go","name":"Go","version":"1","contributes":{"commands":[{"id":"go","title":"Go","where":"app"}]}}"#;
        assert!(inspect(&zip_of(&d, &[("plugin.json", command.as_bytes())])).unwrap_err().contains("index.html"), "a command needs the page it opens");
        assert!(inspect(&zip_of(&d, &[("plugin.json", command.as_bytes()), ("index.html", b"")])).unwrap().page);
        let unknown = r#"{"id":"go","name":"Go","version":"1","contributes":{"views":[]}}"#;
        assert!(inspect(&zip_of(&d, &[("plugin.json", unknown.as_bytes()), ("index.html", b"")])).unwrap_err().starts_with("BAD_MANIFEST"));
    }

    #[test]
    fn a_manifest_cannot_name_a_path_or_ask_for_what_does_not_exist() {
        let d = folder_for_test();
        for bad in [
            r#"{"id":"../evil","name":"x","version":"1"}"#,
            r#"{"id":"Upper","name":"x","version":"1"}"#,
            r#"{"id":"ok-id","name":" ","version":"1"}"#,
            r#"{"id":"ok-id","name":"x","version":"1;2"}"#,
            r#"{"id":"ok-id","name":"x","version":"1","permissions":["files.all"]}"#,
        ] {
            let zip = zip_of(&d, &[("plugin.json", bad.as_bytes()), ("index.html", b"")]);
            assert_eq!(inspect(&zip).unwrap_err(), "BAD_MANIFEST", "{bad}");
        }
    }

    #[test]
    fn a_zip_cannot_write_outside_its_folder() {
        let d = folder_for_test();
        let zip = zip_of(&d, &[("plugin.json", GOOD.as_bytes()), ("index.html", b""), ("../../evil.txt", b"x")]);
        assert_eq!(inspect(&zip).unwrap_err(), "BAD_FILE");
        assert!(!d.join("evil.txt").exists());
    }

    #[test]
    fn a_zip_cannot_carry_a_link() {
        let d = folder_for_test();
        let path = d.join("link.zip");
        let mut zip = ZipWriter::new(File::create(&path).unwrap());
        zip.start_file("plugin.json", SimpleFileOptions::default()).unwrap();
        zip.write_all(GOOD.as_bytes()).unwrap();
        zip.start_file("index.html", SimpleFileOptions::default()).unwrap();
        zip.add_symlink("up", "../..", SimpleFileOptions::default()).unwrap();
        zip.finish().unwrap();
        assert_eq!(inspect(&path).unwrap_err(), "BAD_FILE");
    }

    #[test]
    fn a_new_version_replaces_the_old_one_and_a_broken_one_changes_nothing() {
        let d = folder_for_test();
        let s = opened(&d);
        install(&s, &zip_of(&d, &[("plugin.json", GOOD.as_bytes()), ("index.html", b"one"), ("old.js", b"x")])).unwrap();
        install(&s, &zip_of(&d, &[("plugin.json", GOOD.as_bytes()), ("index.html", b"two")])).unwrap();
        let dir = folder(&s).join("stand");
        assert_eq!(fs::read(dir.join("index.html")).unwrap(), b"two");
        assert!(!dir.join("old.js").exists());
        assert!(install(&s, &zip_of(&d, &[("plugin.json", b"{"), ("index.html", b"three")])).is_err());
        assert_eq!(fs::read(dir.join("index.html")).unwrap(), b"two");
        assert_eq!(list(&s).len(), 1);
        remove(&s, "stand").unwrap();
        assert!(list(&s).is_empty());
    }

    #[test]
    fn only_a_plugin_that_is_on_is_served_and_only_its_own_files() {
        let d = folder_for_test();
        let s = opened(&d);
        install(&s, &zip_of(&d, &[("plugin.json", GOOD.as_bytes()), ("index.html", b"<p>hi"), ("js/app.js", b"1")])).unwrap();
        fs::write(s.data().join("secret.txt"), b"x").unwrap();
        assert_eq!(serve(&s, &uri("stand/index.html")).status(), 404, "not turned on yet");

        turned_on(&s, "stand");
        let page = serve(&s, &uri("stand/"));
        assert_eq!(page.status(), 200);
        assert_eq!(page.body(), b"<p>hi");
        let rules = page.headers()[header::CONTENT_SECURITY_POLICY].to_str().unwrap();
        assert!(rules.contains(&format!("connect-src {HOME}/stand/;")), "{rules}");
        assert_eq!(serve(&s, &uri("stand/js/app.js")).status(), 200);
        assert_eq!(serve(&s, &uri("stand/maker.js")).body(), BRIDGE);
        for away in ["stand/../../secret.txt", "stand/%2e%2e/%2e%2e/secret.txt", "stand/..%5c..%5csecret.txt", "other/index.html", "stand/none.js"] {
            assert_eq!(serve(&s, &uri(away)).status(), 404, "{away}");
        }

        let mut settings = s.settings();
        settings.plugins.get_mut("stand").unwrap().off = true;
        s.save_settings(settings).unwrap();
        assert_eq!(serve(&s, &uri("stand/index.html")).status(), 404, "turned off");
    }
}
