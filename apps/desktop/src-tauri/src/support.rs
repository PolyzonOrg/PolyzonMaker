//! A report for support, made only when the person asks for it and saved where they choose: what it takes to
//! see why something did not work, and nothing of theirs beyond it. No pictures, descriptions, titles or
//! models, no keys or ids, and the home folder written as ~ wherever a path held it, as it holds the name.

use crate::{hardware::Hardware, jobs::Job, store::{Settings, Store}};
use serde_json::json;
use std::{
    fs,
    io::{Cursor, Write},
    path::Path,
};

/// The newest jobs it tells of, and how much of the end of a log
const JOBS: usize = 20;
const LOG_TAIL: usize = 200 << 10;

pub fn report(store: &Store, jobs: &[Job], hw: &Hardware, version: &str, home: &str) -> Result<Vec<u8>, String> {
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options: zip::write::SimpleFileOptions = Default::default();
    let mut put = |name: &str, text: &str| -> Result<(), String> {
        zip.start_file(name, options).map_err(|e| e.to_string())?;
        zip.write_all(hidden(text, home).as_bytes()).map_err(|e| e.to_string())
    };
    put("about.txt", &about(&store.settings(), hw, version))?;
    put("installed.json", &serde_json::to_string_pretty(&crate::packs::installed(store)).unwrap_or_default())?;
    for job in jobs.iter().take(JOBS) {
        put(&format!("jobs/{}/job.json", job.id), &serde_json::to_string_pretty(&told(job)).unwrap_or_default())?;
        if let Some(log) = tail(&store.jobs().join(&job.id).join("engine.log")) {
            put(&format!("jobs/{}/engine.log", job.id), &log)?;
        }
    }
    if let Some(log) = tail(&store.data().join("assistant.log")) {
        put("assistant.log", &log)?;
    }
    Ok(zip.finish().map_err(|e| e.to_string())?.into_inner())
}

/// The version, the computer as the anonymous reports tell it, and the settings as switches: no folders, keys or id.
fn about(s: &Settings, hw: &Hardware, version: &str) -> String {
    let switches = json!({
        "language": s.language, "theme": s.theme, "onboarded": s.onboarded, "reports": s.analytics, "consent": s.consent,
        "gentle": s.gentle, "own_models_folder": !s.models_dir.is_empty(), "old_models_folders": s.old_models_dirs.len(),
        "hf_mirror": s.hf_mirror, "api": s.api_enabled, "updates_off": s.updates_off, "updates_manual": s.updates_manual,
        "queue_paused": s.queue_paused, "plugins": s.plugins.len(), "benchmark": s.benchmark,
    });
    let pretty = serde_json::to_string_pretty(&switches).unwrap_or_default();
    format!(
        "Polyzon Maker {version}\n{}\nfree: memory {} MB, disk {} GB\n\nsettings: {pretty}\n",
        crate::telemetry::machine_detail(hw),
        hw.ram_free_mb,
        hw.disk_free_gb.map_or("?".into(), |g| g.to_string())
    )
}

/// A job as it ran, without what the person wrote or named.
fn told(job: &Job) -> Job {
    Job { title: String::new(), prompt: String::new(), input: String::new(), ..job.clone() }
}

/// The end of a log: what went wrong is near it.
fn tail(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    Some(String::from_utf8_lossy(&bytes[bytes.len().saturating_sub(LOG_TAIL)..]).into_owned())
}

/// The home folder as ~, however a path spells it: as is, with forward slashes, or escaped in JSON.
fn hidden(text: &str, home: &str) -> String {
    if home.len() < 3 {
        return text.to_string();
    }
    [home.replace('\\', "\\\\"), home.to_string(), home.replace('\\', "/")].iter().fold(text.to_string(), |t, h| t.replace(h.as_str(), "~"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::random_id;
    use std::io::Read;

    #[test]
    fn a_report_tells_how_it_went_and_nothing_of_the_persons() {
        let home = r"C:\Users\Ivan";
        let d = std::env::temp_dir().join(format!("maker-support-{}", random_id()));
        let s = Store::open(d.join("c"), d.join("d")).unwrap();
        s.save_settings(Settings { install_id: "0123456789abcdef".into(), api_token: "secret-token".into(), models_dir: format!(r"{home}\models"), ..s.settings() }).unwrap();
        let job = Job { id: "a1".into(), title: "Кот Мурзик".into(), prompt: "мой кот на диване".into(), input: "murzik.png".into(), model: "trellis2".into(), state: "failed".into(), error: "GPU_OOM".into(), detail: format!(r"torch.OutOfMemoryError in {home}\AppData\x.py"), ..Job::default() };
        fs::create_dir_all(s.jobs().join("a1")).unwrap();
        fs::write(s.jobs().join("a1/engine.log"), format!("{}loading {}/models/trellis\nCUDA out of memory\n", "x".repeat(LOG_TAIL), home.replace('\\', "/"))).unwrap();
        let hw = Hardware { cpu: "AMD Ryzen 7 7840HS".into(), ram_mb: 32768, ..Hardware::default() };

        let zip = report(&s, &[job], &hw, "0.3.4", home).unwrap();
        let mut archive = zip::ZipArchive::new(Cursor::new(zip)).unwrap();
        let mut all = String::new();
        for i in 0..archive.len() {
            let mut f = archive.by_index(i).unwrap();
            all += &format!("== {}\n", f.name());
            f.read_to_string(&mut all).unwrap();
        }
        // how it went
        for said in ["Polyzon Maker 0.3.4", "AMD Ryzen 7 7840HS", "== jobs/a1/job.json", "GPU_OOM", "trellis2", "CUDA out of memory", "\"own_models_folder\": true"] {
            assert!(all.contains(said), "missing {said}");
        }
        // nothing of the person's: their words, names, keys and id, and their name in a path
        for kept in ["Мурзик", "мой кот", "murzik.png", "secret-token", "0123456789abcdef", "Ivan"] {
            assert!(!all.contains(kept), "{kept} got into the report");
        }
        assert!(all.contains(r"~\\AppData") && all.contains("~/models"));
        // only the end of a long log
        assert!(all.len() < LOG_TAIL + 20_000);
    }
}
