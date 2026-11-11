//! What a plugin adds to the app, as its manifest declares it (PLUGINS.md). As with a VS Code extension's
//! `contributes`, nothing of the plugin runs to make these known: the app reads the list, checks all of
//! it before installing, and puts each where it belongs.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};

/// No plugin brings more than this of any one kind.
const MAX_EACH: usize = 10;
/// What a theme may colour: the app's own tokens, nothing else of its look.
pub const THEME_TOKENS: [&str; 21] = [
    "--bg", "--chrome", "--surface", "--surface-2", "--surface-3", "--surface-4", "--button", "--button-hover", "--ink", "--ink-muted", "--ink-faint", "--line", "--on-ink", "--good", "--warn",
    "--bad", "--viewer", "--tip-bg", "--tip-ink", "--tip-line", "--tip-key",
];
/// What the app gives every run of a model's program itself: a preset cannot say them again.
const OURS: [&str; 7] = ["--image", "--out", "--device", "--seed", "--weights", "--code", "--check"];
const PYTHONS: [&str; 3] = ["3.10", "3.11", "3.12"];
const SYSTEMS: [&str; 3] = ["windows", "linux", "macos"];
const DEVICES: [&str; 4] = ["cuda", "vulkan", "mps", "cpu"];

#[derive(Clone, Serialize, Deserialize, PartialEq, Debug, Default)]
#[serde(default, deny_unknown_fields)]
pub struct Contributes {
    pub panels: Vec<Panel>,
    pub commands: Vec<Action>,
    pub themes: Vec<Theme>,
    /// Each as the app's own catalog writes a model, with the plugin's program in its runtime
    pub models: Vec<Value>,
}

impl Contributes {
    pub fn is_empty(&self) -> bool {
        self.panels.is_empty() && self.commands.is_empty() && self.themes.is_empty() && self.models.is_empty()
    }
}

/// A frame of the plugin's inside one of the app's pages, beside what that page shows.
#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
#[serde(deny_unknown_fields)]
pub struct Panel {
    pub id: String,
    pub title: String,
    pub file: String,
    #[serde(rename = "where")]
    pub place: String,
    #[serde(default = "panel_height")]
    pub height: u32,
}

fn panel_height() -> u32 {
    240
}

/// A command: a button where it belongs and a line in the shortcuts, which opens the plugin's page with it.
#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
#[serde(deny_unknown_fields)]
pub struct Action {
    pub id: String,
    pub title: String,
    #[serde(rename = "where")]
    pub place: String,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
#[serde(deny_unknown_fields)]
pub struct Theme {
    pub id: String,
    pub title: String,
    pub base: String,
    pub colors: BTreeMap<String, String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Model {
    id: String,
    name: String,
    kind: String,
    #[serde(default = "quality")]
    quality: u8,
    summary: Words,
    publisher: String,
    license: String,
    license_url: String,
    source_url: String,
    #[serde(default)]
    regions_excluded: Vec<String>,
    #[serde(default)]
    presets: Vec<Preset>,
    runtime: Runtime,
    targets: Vec<Target>,
}

fn quality() -> u8 {
    3
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Words {
    en: String,
    #[serde(default)]
    ru: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Preset {
    id: String,
    args: Vec<String>,
    #[serde(default)]
    time_factor: Option<f64>,
    #[serde(default)]
    vram_factor: Option<f64>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Runtime {
    python: String,
    #[serde(default)]
    torch: String,
    #[serde(default)]
    torchvision: String,
    #[serde(default)]
    code: Option<File>,
    #[serde(default)]
    packages: Vec<String>,
    #[serde(default)]
    weights: Vec<File>,
    adapter: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct File {
    url: String,
    sha256: String,
    size: u64,
    #[serde(default)]
    name: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Target {
    os: String,
    device: String,
    ref_seconds: u64,
    #[serde(default)]
    min_vram_mb: u64,
    #[serde(default)]
    min_ram_mb: u64,
    #[serde(default)]
    disk_gb: f64,
}

/// Lowercase letters, digits and dashes, as a plugin's own id.
pub fn slug(s: &str) -> bool {
    (1..=40).contains(&s.len()) && s.starts_with(|c: char| c.is_ascii_alphanumeric()) && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn title(s: &str) -> bool {
    !s.trim().is_empty() && s.chars().count() <= 60
}

/// A file of the plugin's by a plain relative name.
fn plain(s: &str) -> bool {
    (1..=200).contains(&s.len()) && !s.starts_with('/') && s.split('/').all(|part| !part.is_empty() && part != "." && part != ".." && part.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)))
}

fn https(s: &str) -> bool {
    s.starts_with("https://") && s.len() <= 2000 && !s.chars().any(char::is_whitespace)
}

fn sha(s: &str) -> bool {
    s.len() == 64 && s.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
}

fn color(s: &str) -> bool {
    s.strip_prefix('#').is_some_and(|hex| [3, 6, 8].contains(&hex.len()) && hex.chars().all(|c| c.is_ascii_hexdigit()))
}

fn version(s: &str) -> bool {
    !s.is_empty() && s.len() <= 20 && s.split('.').all(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
}

/// A package from PyPI at one exact version, `name==1.2.3` or `name[extra]==1.2.3`: no address, no range.
fn pinned(s: &str) -> bool {
    let Some((name, at)) = s.split_once("==") else { return false };
    let (bare, extras) = name.split_once('[').map_or((name, ""), |(bare, rest)| (bare, rest));
    let name_ok = !bare.is_empty() && bare.starts_with(|c: char| c.is_ascii_alphanumeric()) && bare.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c));
    let extras_ok = extras.is_empty() || extras.strip_suffix(']').is_some_and(|e| !e.is_empty() && e.chars().all(|c| c.is_ascii_alphanumeric() || "._,-".contains(c)));
    let at_ok = !at.is_empty() && at.len() <= 40 && at.chars().all(|c| c.is_ascii_alphanumeric() || ".+!_-".contains(c));
    s.len() <= 120 && name_ok && extras_ok && at_ok
}

fn bad(place: impl std::fmt::Display, why: &str) -> String {
    format!("BAD_MANIFEST: {place}: {why}")
}

fn need(ok: bool, place: impl std::fmt::Display, why: &str) -> Result<(), String> {
    if ok { Ok(()) } else { Err(bad(place, why)) }
}

fn unique<'a>(ids: impl Iterator<Item = &'a str>, place: &str) -> Result<(), String> {
    let mut seen = HashSet::new();
    for id in ids {
        need(slug(id), format!("{place} «{id}»"), "an id is lowercase letters, digits and dashes")?;
        need(seen.insert(id), format!("{place} «{id}»"), "two have this id")?;
    }
    Ok(())
}

/// Judges what a plugin contributes. `has` says whether the plugin carries a file; `page` whether it has
/// its own page, where its commands are carried out.
pub fn check(c: &Contributes, has: &dyn Fn(&str) -> bool, page: bool, permissions: &[String]) -> Result<(), String> {
    for (kind, n) in [("panels", c.panels.len()), ("commands", c.commands.len()), ("themes", c.themes.len()), ("models", c.models.len())] {
        need(n <= MAX_EACH, format!("contributes.{kind}"), "at most 10")?;
    }
    unique(c.panels.iter().map(|p| p.id.as_str()), "panel")?;
    for p in &c.panels {
        let at = format!("panel «{}»", p.id);
        need(title(&p.title), &at, "a title of 1 to 60 characters")?;
        need(plain(&p.file) && p.file.ends_with(".html") && has(&p.file), &at, "its file is an .html file the plugin carries")?;
        need(p.place == "result", &at, "\"where\" is \"result\"")?;
        need((120..=720).contains(&p.height), &at, "a height from 120 to 720")?;
    }
    unique(c.commands.iter().map(|a| a.id.as_str()), "command")?;
    for a in &c.commands {
        let at = format!("command «{}»", a.id);
        need(title(&a.title), &at, "a title of 1 to 60 characters")?;
        need(["result", "app"].contains(&a.place.as_str()), &at, "\"where\" is \"result\" or \"app\"")?;
        need(page, &at, "a command opens the plugin's page, and it has no index.html")?;
    }
    unique(c.themes.iter().map(|t| t.id.as_str()), "theme")?;
    for t in &c.themes {
        let at = format!("theme «{}»", t.id);
        need(title(&t.title), &at, "a title of 1 to 60 characters")?;
        need(t.base == "light" || t.base == "dark", &at, "\"base\" is \"light\" or \"dark\"")?;
        need(!t.colors.is_empty(), &at, "it colours nothing")?;
        for (token, value) in &t.colors {
            need(THEME_TOKENS.contains(&token.as_str()), format!("{at} {token}"), "not one of the app's colour tokens")?;
            need(color(value), format!("{at} {token}"), "a colour is #rgb, #rrggbb or #rrggbbaa")?;
        }
    }
    let program = permissions.iter().any(|p| p == "program");
    need(program == !c.models.is_empty(), "permissions", "\"program\" is asked for exactly when the plugin brings models")?;
    let mut ids = HashSet::new();
    for (i, value) in c.models.iter().enumerate() {
        let m: Model = serde_json::from_value(value.clone()).map_err(|e| bad(format!("model {i}"), &e.to_string()))?;
        need(ids.insert(m.id.clone()), format!("model «{}»", m.id), "two have this id")?;
        model(&m, has)?;
    }
    Ok(())
}

fn model(m: &Model, has: &dyn Fn(&str) -> bool) -> Result<(), String> {
    let at = format!("model «{}»", m.id);
    need(slug(&m.id), &at, "an id is lowercase letters, digits and dashes")?;
    need(title(&m.name) && title(&m.publisher) && title(&m.license), &at, "a name, publisher and license of 1 to 60 characters")?;
    need(m.kind == "3d", &at, "\"kind\" is \"3d\": a model makes a 3D model from a picture")?;
    need((1..=5).contains(&m.quality), &at, "\"quality\" from 1 to 5")?;
    need(!m.summary.en.trim().is_empty() && m.summary.en.chars().count() <= 200 && m.summary.ru.chars().count() <= 200, &at, "a summary in English of up to 200 characters")?;
    need(https(&m.license_url) && https(&m.source_url), &at, "\"license_url\" and \"source_url\" are https addresses")?;
    need(m.regions_excluded.iter().all(|r| r.len() == 2 && r.chars().all(|c| c.is_ascii_uppercase())), &at, "regions are two capital letters, as EU or UK")?;
    let r = &m.runtime;
    need(PYTHONS.contains(&r.python.as_str()), format!("{at} runtime"), "\"python\" is 3.10, 3.11 or 3.12")?;
    need(r.torch.is_empty() == r.torchvision.is_empty() && (r.torch.is_empty() || version(&r.torch) && version(&r.torchvision)), format!("{at} runtime"), "\"torch\" and \"torchvision\" both, as 2.7.1 and 0.22.1, or neither")?;
    need(plain(&r.adapter) && r.adapter.ends_with(".py") && has(&r.adapter), format!("{at} runtime"), "\"adapter\" is a .py file the plugin carries")?;
    need(r.packages.len() <= 400, format!("{at} runtime"), "at most 400 packages")?;
    for p in &r.packages {
        need(pinned(p), format!("{at} package «{p}»"), "a package from PyPI at one exact version, as name==1.2.3")?;
    }
    if let Some(code) = &r.code {
        need(https(&code.url) && sha(&code.sha256) && code.size > 0 && code.name.is_empty(), format!("{at} code"), "an https .zip with its sha256 and size")?;
    }
    need(r.weights.len() <= 200, format!("{at} runtime"), "at most 200 weight files")?;
    let mut names = HashSet::new();
    for w in &r.weights {
        let place = format!("{at} weight «{}»", w.name);
        need(https(&w.url) && sha(&w.sha256) && w.size > 0, &place, "an https file with its sha256 and size")?;
        need(plain(&w.name) && names.insert(w.name.as_str()), &place, "a plain relative name, once")?;
    }
    unique(m.presets.iter().map(|p| p.id.as_str()), &format!("{at} preset"))?;
    for p in &m.presets {
        let fine = p.args.len() <= 20 && p.args.iter().all(|a| a.len() <= 200 && !OURS.contains(&a.split('=').next().unwrap_or("")));
        let factors = [p.time_factor, p.vram_factor].iter().all(|f| f.is_none_or(|f| f > 0.0 && f <= 100.0));
        need(fine && factors, format!("{at} preset «{}»", p.id), "up to 20 arguments, none of the app's own")?;
    }
    need(!m.targets.is_empty() && m.targets.len() <= 20, &at, "1 to 20 targets")?;
    for t in &m.targets {
        let known = SYSTEMS.contains(&t.os.as_str()) && DEVICES.contains(&t.device.as_str());
        let sane = t.ref_seconds > 0 && t.min_vram_mb <= 1 << 20 && t.min_ram_mb <= 1 << 21 && (0.0..=10_000.0).contains(&t.disk_gb);
        need(known && sane, format!("{at} target {}/{}", t.os, t.device), "a system, a device, a time in seconds and the memory in MB")?;
    }
    Ok(())
}

/// The id a plugin's model has in the app: never one of the app's own, never another plugin's.
pub fn model_id(plugin: &str, model: &str) -> String {
    format!("{plugin}.{model}")
}

/// A plugin's models as the app's own catalog writes models, for a plugin that was checked. The times
/// are its author's, so every one counts as not tested.
pub fn models(plugin: &str, plugin_name: &str, c: &Contributes) -> Vec<Value> {
    c.models
        .iter()
        .filter_map(|value| {
            let mut m = value.clone();
            let id = model_id(plugin, m.get("id")?.as_str()?);
            m["id"] = json!(id);
            m["plugin"] = json!({ "id": plugin, "name": plugin_name });
            m["runtime"]["type"] = json!("plugin");
            m["runtime"]["plugin"] = json!(plugin);
            if m["quality"].is_null() {
                m["quality"] = json!(quality());
            }
            let english = m["summary"]["en"].clone();
            if m["summary"]["ru"].as_str().is_none_or(str::is_empty) {
                m["summary"]["ru"] = english;
            }
            for key in ["regions_excluded", "presets"] {
                if m[key].is_null() {
                    m[key] = json!([]);
                }
            }
            for preset in m["presets"].as_array_mut()? {
                for factor in ["time_factor", "vram_factor"] {
                    if preset[factor].is_null() {
                        preset[factor] = json!(1.0);
                    }
                }
            }
            for target in m["targets"].as_array_mut()? {
                target["status"] = json!("experimental");
                for key in ["min_vram_mb", "min_ram_mb", "disk_gb"] {
                    if target[key].is_null() {
                        target[key] = json!(0);
                    }
                }
            }
            Some(m)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHA: &str = "0000000000000000000000000000000000000000000000000000000000000000";

    fn a_model() -> Value {
        json!({
            "id": "shape", "name": "Shape 1", "kind": "3d", "summary": { "en": "A test model." },
            "publisher": "Lab", "license": "MIT", "license_url": "https://example.org/l", "source_url": "https://example.org/s",
            "runtime": { "python": "3.10", "torch": "2.7.1", "torchvision": "0.22.1", "packages": ["numpy==2.2.6", "trimesh[easy]==4.5.3"],
                "code": { "url": "https://codeload.github.com/a/b/zip/1", "sha256": SHA, "size": 10 },
                "weights": [{ "url": "https://huggingface.co/a/b/resolve/1/model.safetensors", "sha256": SHA, "size": 5, "name": "model.safetensors" }],
                "adapter": "adapter.py" },
            "presets": [{ "id": "fine", "args": ["--steps", "50"] }],
            "targets": [{ "os": "windows", "device": "cuda", "ref_seconds": 60, "min_vram_mb": 8000 }]
        })
    }

    fn with(models: Vec<Value>) -> Contributes {
        Contributes { models, ..Contributes::default() }
    }

    fn judged(c: &Contributes, page: bool, permissions: &[&str]) -> Result<(), String> {
        let has = |name: &str| ["adapter.py", "panel.html"].contains(&name);
        check(c, &has, page, &permissions.iter().map(|p| p.to_string()).collect::<Vec<_>>())
    }

    #[test]
    fn a_model_with_its_program_pinned_is_taken_and_written_as_the_catalog_writes_models() {
        let c = with(vec![a_model()]);
        assert_eq!(judged(&c, false, &["program"]), Ok(()));
        let [m] = &models("lab", "Lab tools", &c)[..] else { panic!() };
        assert_eq!(m["id"], "lab.shape");
        assert_eq!(m["plugin"]["name"], "Lab tools");
        assert_eq!((&m["runtime"]["type"], &m["runtime"]["plugin"]), (&json!("plugin"), &json!("lab")));
        assert_eq!(m["summary"]["ru"], "A test model.");
        assert_eq!(m["targets"][0]["status"], "experimental");
        assert_eq!(m["presets"][0]["time_factor"], 1.0);
        let parsed: crate::catalog::Model = serde_json::from_value(m.clone()).unwrap();
        assert!(matches!(parsed.runtime, crate::catalog::Runtime::Plugin { .. }));
    }

    #[test]
    fn a_model_must_ask_for_the_program_and_only_a_model_may() {
        assert!(judged(&with(vec![a_model()]), false, &[]).unwrap_err().contains("permissions"));
        assert!(judged(&Contributes::default(), true, &["program"]).unwrap_err().contains("permissions"));
    }

    #[test]
    fn what_a_model_installs_is_pinned_and_what_it_runs_is_its_own() {
        let broken = |path: &[&str], value: Value| {
            let mut m = a_model();
            let mut at = &mut m;
            for key in &path[..path.len() - 1] {
                at = &mut at[*key];
            }
            at[path[path.len() - 1]] = value;
            judged(&with(vec![m]), false, &["program"]).unwrap_err()
        };
        assert!(broken(&["runtime", "packages"], json!(["numpy>=2"])).contains("numpy>=2"));
        assert!(broken(&["runtime", "packages"], json!(["git+https://github.com/a/b==1"])).contains("package"));
        assert!(broken(&["runtime", "code", "sha256"], json!("abc")).contains("code"));
        assert!(broken(&["runtime", "code", "url"], json!("http://example.org/a.zip")).contains("code"));
        assert!(broken(&["runtime", "weights"], json!([{ "url": "https://x.org/a", "sha256": SHA, "size": 1, "name": "../../a" }])).contains("weight"));
        assert!(broken(&["runtime", "adapter"], json!("missing.py")).contains("adapter"));
        assert!(broken(&["runtime", "adapter"], json!("../adapter.py")).contains("adapter"));
        assert!(broken(&["runtime", "torchvision"], json!("")).contains("torch"));
        assert!(broken(&["presets"], json!([{ "id": "p", "args": ["--out", "C:/x.glb"] }])).contains("preset"));
        assert!(broken(&["presets"], json!([{ "id": "p", "args": ["--out=C:/x.glb"] }])).contains("preset"));
        assert!(broken(&["kind"], json!("picture")).contains("kind"));
        assert!(broken(&["runtime", "shell"], json!("rm -rf /")).contains("model 0"), "nothing the app does not know");
    }

    #[test]
    fn a_theme_colours_only_the_app_s_tokens_with_plain_colours() {
        let theme = |colors: Value| Contributes { themes: vec![serde_json::from_value(json!({ "id": "sand", "title": "Sand", "base": "light", "colors": colors })).unwrap()], ..Contributes::default() };
        assert_eq!(judged(&theme(json!({ "--bg": "#f4efe6", "--line": "#0000001a" })), false, &[]), Ok(()));
        assert!(judged(&theme(json!({ "--bg": "url(https://x.org/a.png)" })), false, &[]).is_err());
        assert!(judged(&theme(json!({ "--bg": "#fff;background:red" })), false, &[]).is_err());
        assert!(judged(&theme(json!({ "font-family": "#ffffff" })), false, &[]).is_err());
    }

    #[test]
    fn panels_and_commands_say_where_they_go() {
        let panel = |file: &str, place: &str| Contributes { panels: vec![Panel { id: "size".into(), title: "Size".into(), file: file.into(), place: place.into(), height: 240 }], ..Contributes::default() };
        assert_eq!(judged(&panel("panel.html", "result"), false, &[]), Ok(()));
        assert!(judged(&panel("none.html", "result"), false, &[]).is_err());
        assert!(judged(&panel("panel.html", "settings"), false, &[]).is_err());
        let command = Contributes { commands: vec![Action { id: "go".into(), title: "Go".into(), place: "result".into() }], ..Contributes::default() };
        assert_eq!(judged(&command, true, &[]), Ok(()));
        assert!(judged(&command, false, &[]).unwrap_err().contains("index.html"));
        let twice = Contributes { commands: vec![Action { id: "go".into(), title: "Go".into(), place: "app".into() }; 2], ..Contributes::default() };
        assert!(judged(&twice, true, &[]).unwrap_err().contains("two"));
    }

    #[test]
    fn an_unknown_kind_of_contribution_is_refused() {
        assert!(serde_json::from_value::<Contributes>(json!({ "views": [] })).is_err());
    }
}
