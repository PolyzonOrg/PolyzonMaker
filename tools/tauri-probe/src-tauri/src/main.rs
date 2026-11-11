// Polyzon Ark shell probe (T-06): one window and three commands, nothing else.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, path::PathBuf, time::Instant};
use tauri::{
    ipc::{InvokeBody, Request},
    AppHandle, State,
};

/// ARK_PROBE_OUT: where the report and the STL go (probe.py sets it).
/// ARK_PROBE_EXIT: close once the report is written, for runs nobody watches.
struct Run {
    out: PathBuf,
    started: Instant,
    exit: bool,
}

/// Spaces and Cyrillic on purpose: such paths must work (TZ §18.1).
const PRINT_FILE: &str = "Ковчег тест/модель для печати.stl";

#[derive(serde::Serialize)]
struct Info {
    os: &'static str,
    arch: &'static str,
    tauri: &'static str,
    webview: String,
    out: String,
    since_start_ms: u128,
}

#[tauri::command]
fn info(run: State<Run>) -> Info {
    Info {
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        tauri: tauri::VERSION,
        webview: tauri::webview_version().unwrap_or_else(|e| format!("unknown: {e}")),
        out: run.out.display().to_string(),
        since_start_ms: run.started.elapsed().as_millis(),
    }
}

#[derive(serde::Serialize)]
struct Saved {
    path: String,
    bytes: u64,
}

/// The STL arrives as the raw request body, not as JSON.
#[tauri::command]
async fn save(request: Request<'_>, run: State<'_, Run>) -> Result<Saved, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw bytes".into());
    };
    let path = run.out.join(PRINT_FILE);
    let write = || -> std::io::Result<u64> {
        fs::create_dir_all(path.parent().unwrap())?;
        fs::write(&path, bytes)?;
        Ok(fs::metadata(&path)?.len())
    };
    let bytes = write().map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(Saved { path: path.display().to_string(), bytes })
}

#[tauri::command]
fn finish(report: String, run: State<Run>, app: AppHandle) -> Result<String, String> {
    let path = run.out.join("report.json");
    fs::create_dir_all(&run.out)
        .and_then(|_| fs::write(&path, report))
        .map_err(|e| format!("{}: {e}", path.display()))?;
    if run.exit {
        app.exit(0);
    }
    Ok(path.display().to_string())
}

fn main() {
    let run = Run {
        out: std::env::var_os("ARK_PROBE_OUT")
            .map(PathBuf::from)
            .unwrap_or_else(|| std::env::temp_dir().join("ark-probe")),
        started: Instant::now(),
        exit: std::env::var_os("ARK_PROBE_EXIT").is_some(),
    };
    tauri::Builder::default()
        .manage(run)
        .invoke_handler(tauri::generate_handler![info, save, finish])
        .run(tauri::generate_context!())
        .expect("the probe window did not start");
}
