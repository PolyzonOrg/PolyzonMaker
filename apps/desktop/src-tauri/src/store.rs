//! Where Polyzon Maker keeps things, and how: small JSON files written whole, so a crash leaves the old
//! version or the new one, never half of either. Big files stay plain files next to them.

use crate::plugins::Grant;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs, io,
    path::{Path, PathBuf},
    sync::Mutex,
};

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Settings {
    pub onboarded: bool,
    /// "" = follow the system
    pub language: String,
    /// "" = follow the system, or "light", "dark"
    pub theme: String,
    /// None until the person has answered; nothing is sent before that (TZ §18.2)
    pub analytics: Option<bool>,
    /// Random, made only after a yes, dropped after a no
    pub install_id: String,
    /// Where new models go; "" = the app's own data folder
    pub models_dir: String,
    /// Where they went before: what is installed there stays and keeps working
    pub old_models_dirs: Vec<String>,
    /// What the first-run check measured, as the page sent it
    pub benchmark: Option<serde_json::Value>,
    pub show_mature: bool,
    /// Keep the computer usable while generating: lower priority for the engines
    pub gentle: bool,
    /// The version of the reports the person said yes or no to: an answer to an older one counts for nothing
    pub consent: u32,
    pub hf_mirror: bool,
    pub slicer: String,
    /// The local API for other programs: off until the person turns it on
    pub api_enabled: bool,
    pub api_port: u16,
    pub api_token: String,
    /// Do not look for a new version when Polyzon Maker starts
    pub updates_off: bool,
    /// Do not fetch a new version by itself; it comes when the person asks
    pub updates_manual: bool,
    /// The first close was explained: with the tray there, closing only puts the window away
    pub tray_told: bool,
    /// The queue starts nothing new until the person goes on, after a restart too
    pub queue_paused: bool,
    pub plugins: BTreeMap<String, Grant>,
}

/// Reports now say more than version 0.1 asked about: a yes to that one is asked again, a no stays.
pub const CONSENT: u32 = 2;

pub struct Store {
    config: PathBuf,
    data: PathBuf,
    settings: Mutex<Settings>,
}

/// Settings as the page sends them, made right against what is stored: what has a command of its own
/// keeps its stored value, since the page's copy may be older, and consent goes with an id or without one.
pub fn from_page(was: Settings, mut new: Settings) -> Settings {
    if new.analytics == Some(true) && new.install_id.is_empty() {
        new.install_id = random_id();
    }
    if new.analytics != Some(true) {
        new.install_id.clear();
    }
    if new.analytics.is_some() {
        new.consent = CONSENT;
    }
    (new.models_dir, new.old_models_dirs) = (was.models_dir, was.old_models_dirs);
    (new.api_enabled, new.api_port, new.api_token) = (was.api_enabled, was.api_port, was.api_token);
    (new.tray_told, new.queue_paused) = (was.tray_told, was.queue_paused); // to_tray's and queue_pause's
    new
}

impl Store {
    pub fn open(config: PathBuf, data: PathBuf) -> io::Result<Self> {
        fs::create_dir_all(&config)?;
        fs::create_dir_all(&data)?;
        let mut settings: Settings = fs::read(config.join("settings.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_else(|| Settings { gentle: true, ..Settings::default() });
        if settings.analytics == Some(true) && settings.consent < CONSENT {
            settings.analytics = None;
            settings.install_id.clear();
        }
        Ok(Self { config, data, settings: Mutex::new(settings) })
    }

    pub fn settings(&self) -> Settings {
        self.settings.lock().unwrap().clone()
    }

    pub fn save_settings(&self, new: Settings) -> io::Result<()> {
        write_atomic(&self.config.join("settings.json"), &serde_json::to_vec_pretty(&new)?)?;
        *self.settings.lock().unwrap() = new;
        Ok(())
    }

    pub fn jobs(&self) -> PathBuf {
        self.data.join("jobs")
    }

    /// Engines, environments and weights: the big part. New models go here.
    pub fn packs(&self) -> PathBuf {
        let chosen = self.settings().models_dir;
        if chosen.is_empty() { self.data.join("packs") } else { PathBuf::from(chosen) }
    }

    /// Every folder that may hold models, the current one first.
    pub fn pack_folders(&self) -> Vec<PathBuf> {
        let earlier = self.settings().old_models_dirs.into_iter().map(PathBuf::from);
        let mut all = vec![self.packs()];
        for folder in std::iter::once(self.data.join("packs")).chain(earlier) {
            if !all.contains(&folder) {
                all.push(folder);
            }
        }
        all
    }

    /// New models go to `path` from now on. Nothing moves: 50 GB across disks is not worth the risk,
    /// and engines keep absolute paths to their Python. Engines also read only plain ASCII paths.
    pub fn set_models_folder(&self, path: &str) -> Result<Settings, String> {
        if !path.is_ascii() {
            return Err("LATIN_ONLY".into());
        }
        let probe = Path::new(path).join(".maker-write-test");
        fs::create_dir_all(path).and_then(|()| fs::write(&probe, b"")).map_err(|_| "NOT_WRITABLE".to_string())?;
        let _ = fs::remove_file(probe);
        let mut new = self.settings();
        let was = std::mem::replace(&mut new.models_dir, path.to_string());
        new.old_models_dirs.retain(|d| d != path && *d != was);
        if !was.is_empty() && was != path {
            new.old_models_dirs.push(was);
        }
        self.save_settings(new.clone()).map_err(|e| e.to_string())?;
        Ok(new)
    }

    pub fn downloads(&self) -> PathBuf {
        self.packs().join(".downloads")
    }

    /// Next to the models: a full system disk must not stop an install on another one.
    pub fn tools(&self) -> PathBuf {
        self.packs().join(".tools")
    }

    pub fn data(&self) -> &Path {
        &self.data
    }
}

/// ponytail: only for copies installed under the old name, so that nobody downloads gigabytes twice;
/// goes away before the first public release. It runs before anything else: WebView2 makes the new
/// folder the moment a window opens, and then there would be nothing left to move into.
pub fn take_over_old_folders() {
    let var = |name: &str| std::env::var_os(name).map(PathBuf::from);
    #[cfg(target_os = "windows")]
    let bases = [var("APPDATA"), var("LOCALAPPDATA")];
    #[cfg(target_os = "macos")]
    let bases = [var("HOME").map(|h| h.join("Library/Application Support")), None];
    #[cfg(target_os = "linux")]
    let bases = [var("HOME").map(|h| h.join(".config")), var("HOME").map(|h| h.join(".local/share"))];
    for base in bases.into_iter().flatten() {
        move_old_folder(&base, "org.polyzon.ark", "org.polyzon.maker");
    }
}

fn move_old_folder(base: &Path, old: &str, new: &str) {
    if base.join(old).is_dir() && !base.join(new).exists() {
        let _ = fs::rename(base.join(old), base.join(new));
    }
    // an environment names its Python by the full path
    for pack in fs::read_dir(base.join(new).join("packs")).into_iter().flatten().flatten() {
        let file = pack.path().join("env").join("pyvenv.cfg");
        if let Ok(text) = fs::read_to_string(&file) {
            if text.contains(old) {
                let _ = fs::write(&file, text.replace(old, new));
            }
        }
    }
}

/// Temporary file in the same folder, then a rename: readers see all of it or nothing.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)
}

/// The JSON file `name` of every folder in `dir`; folders without a readable one are skipped.
pub fn read_each<T: serde::de::DeserializeOwned>(dir: &Path, name: &str) -> Vec<T> {
    let Ok(entries) = fs::read_dir(dir) else { return vec![] };
    entries
        .flatten()
        .filter_map(|e| fs::read(e.path().join(name)).ok())
        .filter_map(|b| serde_json::from_slice(&b).ok())
        .collect()
}

/// A file name from the page: one plain name, never a path.
pub fn safe_name(name: &str) -> Result<&str, String> {
    let bad = name.is_empty() || name.contains(['/', '\\', ':', '\0']) || name.starts_with('.');
    if bad { Err(format!("not a file name: {name}")) } else { Ok(name) }
}

pub fn dir_size(dir: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(dir) else { return 0 };
    entries
        .flatten()
        .map(|e| match e.file_type() {
            Ok(kind) if kind.is_dir() => dir_size(&e.path()),
            // asked of the file itself: on Windows the folder's listing says 0 until a download closes it
            Ok(kind) if kind.is_file() => fs::metadata(e.path()).map_or(0, |m| m.len()),
            _ => 0,
        })
        .sum()
}

/// Now, seconds since 1970.
pub fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// Sixteen hex digits nobody else will have: not a secret, just a name.
pub fn random_id() -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos()));
    h.write_u32(std::process::id());
    format!("{:016x}", h.finish())
}

#[cfg(test)]
mod tests {

    #[test]
    fn the_pages_older_copy_does_not_undo_what_other_commands_set() {
        // the page loaded its settings before to_tray, the folder change and the API switch, then saved a language
        let was = Settings { tray_told: true, queue_paused: true, models_dir: "D:/Models".into(), api_enabled: true, api_port: 7900, ..Settings::default() };
        let page = Settings { language: "en".into(), ..Settings::default() };
        let saved = from_page(was, page);
        assert!(saved.tray_told && saved.queue_paused);
        assert_eq!((saved.models_dir.as_str(), saved.api_enabled, saved.api_port), ("D:/Models", true, 7900));
        assert_eq!(saved.language, "en");
        // a yes to reports gets an id and the current consent; a no drops the id
        let yes = from_page(Settings::default(), Settings { analytics: Some(true), ..Settings::default() });
        assert!(!yes.install_id.is_empty() && yes.consent == CONSENT);
        let no = from_page(Settings::default(), Settings { analytics: Some(false), install_id: "old".into(), ..Settings::default() });
        assert!(no.install_id.is_empty());
    }
    use super::*;

    fn temp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("maker-test-{}", random_id()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn settings_survive_a_restart_and_a_broken_file_is_not_fatal() {
        let d = temp();
        let s = Store::open(d.join("c"), d.join("d")).unwrap();
        assert!(s.settings().gentle && s.settings().analytics.is_none());
        s.save_settings(Settings { analytics: Some(false), language: "ru".into(), ..s.settings() }).unwrap();
        let again = Store::open(d.join("c"), d.join("d")).unwrap();
        assert_eq!((again.settings().analytics, again.settings().language.as_str()), (Some(false), "ru"));
        fs::write(d.join("c/settings.json"), "{ half a file").unwrap();
        assert!(Store::open(d.join("c"), d.join("d")).unwrap().settings().gentle);
    }

    #[test]
    fn a_copy_from_before_the_rename_keeps_its_models() {
        let d = temp();
        let env = d.join("org.polyzon.ark/packs/triposr/env");
        fs::create_dir_all(&env).unwrap();
        fs::write(d.join("org.polyzon.ark/settings.json"), "{}").unwrap();
        fs::write(env.join("pyvenv.cfg"), "home = C:/Users/a/org.polyzon.ark/packs/.tools\n").unwrap();
        move_old_folder(&d, "org.polyzon.ark", "org.polyzon.maker");
        let new = d.join("org.polyzon.maker");
        assert!(new.join("settings.json").exists());
        let moved = fs::read_to_string(new.join("packs/triposr/env/pyvenv.cfg")).unwrap();
        assert!(moved.contains("org.polyzon.maker") && !moved.contains("org.polyzon.ark"));
        // a second start finds nothing to do, and a folder already in use is left alone
        fs::create_dir_all(d.join("org.polyzon.ark")).unwrap();
        move_old_folder(&d, "org.polyzon.ark", "org.polyzon.maker");
        assert!(d.join("org.polyzon.ark").exists() && new.join("settings.json").exists());
    }

    #[test]
    fn a_file_still_being_written_counts_with_what_is_in_it_now() {
        use std::io::Write;
        let d = temp();
        let mut file = fs::File::create(d.join("model.incomplete")).unwrap();
        file.write_all(&vec![1; 1 << 20]).unwrap();
        file.flush().unwrap();
        assert_eq!(dir_size(&d), 1 << 20); // the file is open, as it is during a download
    }

    #[test]
    fn a_new_models_folder_keeps_the_old_ones_in_view() {
        let d = temp();
        let s = Store::open(d.join("c"), d.join("d")).unwrap();
        let (one, two) = (d.join("one"), d.join("two"));
        let default = d.join("d").join("packs");
        assert_eq!(s.pack_folders(), [default.clone()]);
        s.set_models_folder(one.to_str().unwrap()).unwrap();
        assert_eq!(s.pack_folders(), [one.clone(), default.clone()]);
        s.set_models_folder(two.to_str().unwrap()).unwrap();
        assert_eq!(s.pack_folders(), [two.clone(), default.clone(), one.clone()]);
        assert!(s.tools().starts_with(&two) && s.downloads().starts_with(&two));
        // back to the first one: it is the current folder again, listed once
        s.set_models_folder(one.to_str().unwrap()).unwrap();
        assert_eq!(s.pack_folders(), [one, default, two]);
    }

    #[test]
    fn a_folder_engines_cannot_read_or_nobody_can_write_is_refused() {
        let d = temp();
        let s = Store::open(d.join("c"), d.join("d")).unwrap();
        assert_eq!(s.set_models_folder(d.join("Модели").to_str().unwrap()).err().as_deref(), Some("LATIN_ONLY"));
        let file = d.join("a-file");
        fs::write(&file, b"").unwrap();
        assert_eq!(s.set_models_folder(file.join("x").to_str().unwrap()).err().as_deref(), Some("NOT_WRITABLE"));
        assert!(s.settings().models_dir.is_empty());
    }

    #[test]
    fn a_name_from_the_page_cannot_leave_the_job_folder() {
        for bad in ["../x", "a/b", "a\\b", "C:x", "", ".env"] {
            assert!(safe_name(bad).is_err(), "{bad}");
        }
        assert_eq!(safe_name("model.glb"), Ok("model.glb"));
    }
}
