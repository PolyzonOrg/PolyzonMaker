//! The models Polyzon Maker knows how to install, built into the app. Every file is pinned by hash and every
//! time comes from a real run on the reference PC (`tools/bench`); nothing here is a promise.

use serde::Deserialize;
use std::{
    collections::HashMap,
    sync::{OnceLock, RwLock},
};

pub const JSON: &str = include_str!("../catalog.json");

#[derive(Deserialize, Clone)]
pub struct Archive {
    pub url: String,
    pub sha256: String,
    pub size: u64,
}

#[derive(Deserialize, Clone)]
pub struct Weight {
    pub url: String,
    pub sha256: String,
    pub size: u64,
    pub name: String,
}

#[derive(Deserialize, Clone)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Runtime {
    Native {
        exe: String,
        archives: HashMap<String, Vec<Archive>>,
        #[serde(default)]
        weights: Vec<Weight>,
        #[serde(default)]
        steps: u32,
        /// The turn, by rows, the model's own export gives its GLB and the engine leaves out
        #[serde(default)]
        turn: Option<[[f32; 3]; 3]>,
    },
    Python {
        engine: String,
        python: String,
        torch: String,
        torchvision: String,
        repo_url: String,
        packages: Vec<String>,
        weights_bytes: u64,
        cut: bool,
        /// Which weights of the engine's family; empty for its first
        #[serde(default)]
        variant: String,
    },
    /// A model a plugin brings: its own program, run inside the plugin's fence (PLUGINS.md)
    Plugin {
        python: String,
        #[serde(default)]
        torch: String,
        #[serde(default)]
        torchvision: String,
        #[serde(default)]
        code: Option<Archive>,
        #[serde(default)]
        packages: Vec<String>,
        #[serde(default)]
        weights: Vec<Weight>,
        /// The program, a file of the plugin's
        adapter: String,
        /// Which plugin; the app writes this, not the plugin
        plugin: String,
    },
}

#[derive(Deserialize, Clone)]
pub struct Preset {
    pub id: String,
    pub args: Vec<String>,
}

#[derive(Deserialize, Clone)]
pub struct Target {
    pub os: String,
    pub device: String,
    #[serde(default)]
    pub min_vram_mb: u64,
}

#[derive(Deserialize, Clone)]
pub struct Model {
    pub id: String,
    /// As its authors call it, e.g. «TRELLIS.2»
    pub name: String,
    /// "3d", "picture" or "text"
    pub kind: String,
    #[serde(default)]
    pub presets: Vec<Preset>,
    pub runtime: Runtime,
    #[serde(default)]
    pub targets: Vec<Target>,
}

impl Model {
    /// The graphics memory this model wants on this system and device; 0 when nothing says.
    pub fn need_mb(&self, device: &str) -> u64 {
        self.targets.iter().find(|t| t.os == os_key() && t.device == device).map_or(0, |t| t.min_vram_mb)
    }
}

#[derive(Deserialize)]
struct Tool {
    archives: HashMap<String, Archive>,
}

#[derive(Deserialize)]
struct Tools {
    uv: Tool,
    /// Visual C++ libraries, Windows only
    vcrt: Tool,
}

#[derive(Deserialize)]
struct Catalog {
    version: u32,
    tools: Tools,
    models: Vec<Model>,
}

fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| serde_json::from_str(JSON).expect("catalog.json is built into the app"))
}

/// The models of the plugins that are on, as the page reads them and as the app runs them.
static PLUGIN_MODELS: RwLock<Vec<(Model, serde_json::Value)>> = RwLock::new(Vec::new());

pub fn model(id: &str) -> Option<Model> {
    let own = catalog().models.iter().find(|m| m.id == id).cloned();
    own.or_else(|| PLUGIN_MODELS.read().unwrap().iter().find(|(m, _)| m.id == id).map(|(m, _)| m.clone()))
}

/// What the plugins that are on bring now; each was checked when it was installed.
pub fn set_plugin_models(models: Vec<serde_json::Value>) {
    let parsed = models.into_iter().filter_map(|value| Some((serde_json::from_value(value.clone()).ok()?, value))).collect();
    *PLUGIN_MODELS.write().unwrap() = parsed;
}

/// The catalog as the page reads it: the app's own models, then those of the plugins that are on.
pub fn json() -> serde_json::Value {
    let mut all: serde_json::Value = serde_json::from_str(JSON).unwrap_or_default();
    if let Some(models) = all["models"].as_array_mut() {
        models.extend(PLUGIN_MODELS.read().unwrap().iter().map(|(_, value)| value.clone()));
    }
    all
}

pub fn uv(key: &str) -> Option<Archive> {
    catalog().tools.uv.archives.get(key).cloned()
}

pub fn vcrt(key: &str) -> Option<Archive> {
    catalog().tools.vcrt.archives.get(key).cloned()
}

pub fn version() -> u32 {
    catalog().version
}

pub fn os_key() -> &'static str {
    match std::env::consts::OS {
        "macos" => "macos",
        "windows" => "windows",
        _ => "linux",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_model_parses_and_every_file_is_pinned() {
        assert!(catalog().models.len() >= 6);
        for m in &catalog().models {
            if let Runtime::Native { archives, weights, .. } = &m.runtime {
                assert!(!archives.is_empty(), "{}", m.id);
                for w in weights {
                    assert_eq!(w.sha256.len(), 64, "{} {}", m.id, w.name);
                    assert!(w.url.contains("/resolve/") && !w.url.contains("/main/"), "{}", w.url);
                }
                for a in archives.values().flatten() {
                    assert_eq!(a.sha256.len(), 64, "{}", a.url);
                }
            }
        }
    }

    #[test]
    fn a_model_turned_after_the_engine_is_turned_as_its_own_code_exports_it() {
        for m in &catalog().models {
            if let Runtime::Native { turn: Some(t), .. } = &m.runtime {
                // a turn: rows of unit length at right angles, and no mirror
                for i in 0..3 {
                    for j in 0..3 {
                        let dot: f32 = (0..3).map(|k| t[i][k] * t[j][k]).sum();
                        assert_eq!(dot, if i == j { 1.0 } else { 0.0 }, "{}", m.id);
                    }
                }
                let det = t[0][0] * (t[1][1] * t[2][2] - t[1][2] * t[2][1]) - t[0][1] * (t[1][0] * t[2][2] - t[1][2] * t[2][0])
                    + t[0][2] * (t[1][0] * t[2][1] - t[1][1] * t[2][0]);
                assert_eq!(det, 1.0, "{}", m.id);
            }
        }
        // TencentARC/Pixal3D inference.py turns TRELLIS.2's export by this; trellis.cpp v0.8.1 does not
        let turn = |id: &str| match &model(id).unwrap().runtime {
            Runtime::Native { turn, .. } => *turn,
            _ => None,
        };
        assert_eq!(turn("pixal3d"), Some([[-1.0, 0.0, 0.0], [0.0, 0.0, -1.0], [0.0, -1.0, 0.0]]));
        assert_eq!(turn("trellis2"), None);
    }

    #[test]
    fn every_way_a_native_model_runs_has_a_build_to_download() {
        // the install looks up `<os>-<device>`; without one it stops at «no build for macos-metal»
        for m in &catalog().models {
            if let Runtime::Native { archives, .. } = &m.runtime {
                for t in &m.targets {
                    let key = format!("{}-{}", t.os, t.device);
                    assert!(archives.get(&key).is_some_and(|a| !a.is_empty()), "{} {key}", m.id);
                }
            }
        }
    }

    #[test]
    fn a_model_says_what_it_needs_on_this_system() {
        let trellis = model("trellis2").unwrap();
        assert_eq!(trellis.need_mb("cpu"), 0);
        assert_eq!(trellis.need_mb("no such device"), 0);
        if os_key() != "macos" {
            assert_eq!(trellis.need_mb("cuda"), 4000);
        }
    }

    #[test]
    fn the_tool_exists_for_every_system_we_target() {
        for key in ["windows-x86_64", "macos-aarch64", "linux-x86_64"] {
            assert!(uv(key).is_some(), "{key}");
        }
    }
}
