//! Small differences between the three systems, in one place.

use std::{
    ffi::OsStr,
    process::{Child, Command, Stdio},
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(target_os = "windows")]
const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;

/// A command that shows no console window on Windows.
pub fn hidden(program: impl AsRef<OsStr>) -> Command {
    let mut c = Command::new(program);
    c.stdin(Stdio::null());
    #[cfg(target_os = "windows")]
    c.creation_flags(CREATE_NO_WINDOW);
    c
}

/// What a program needs from the system to start and to reach the network. All else stays out: a
/// person's PYTHONPATH, conda, pip and uv settings, CUDA paths, and what an AppImage sets for itself,
/// like LD_LIBRARY_PATH. Whatever is installed on the computer, the engines never see it.
const KEPT: [&str; 44] = [
    "SystemRoot", "SystemDrive", "windir", "ComSpec", "PATHEXT", "OS", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE",
    "PROCESSOR_IDENTIFIER", "USERPROFILE", "USERNAME", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "APPDATA", "ProgramData",
    "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "CommonProgramFiles", "ALLUSERSPROFILE", "DriverData",
    "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR",
    "TEMP", "TMP", "TMPDIR",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy",
    "SSL_CERT_FILE", "SSL_CERT_DIR",
];

fn isolate(c: &mut Command) {
    c.env_clear();
    for name in KEPT {
        if let Some(value) = std::env::var_os(name) {
            c.env(name, value);
        }
    }
    #[cfg(target_os = "windows")]
    {
        let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
        c.env("PATH", format!(r"{root}\System32;{root};{root}\System32\Wbem"));
    }
    #[cfg(not(target_os = "windows"))]
    c.env("PATH", "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin");
    c.env("PYTHONNOUSERSITE", "1").env("PYTHONUTF8", "1");
}

/// An engine or a tool of ours: its own process group, so that it can be stopped with all it started,
/// and a clean environment, so that nothing on the computer changes what it does.
pub fn engine(program: impl AsRef<OsStr>, gentle: bool) -> Command {
    #[cfg(target_os = "windows")]
    {
        let mut c = hidden(program);
        isolate(&mut c);
        if gentle {
            c.creation_flags(CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS);
        }
        c
    }
    #[cfg(not(target_os = "windows"))]
    {
        use std::os::unix::process::CommandExt;
        let mut c = if gentle {
            let mut n = hidden("nice");
            n.args(["-n", "10"]).arg(program);
            n
        } else {
            hidden(program)
        };
        isolate(&mut c);
        c.process_group(0);
        c
    }
}

/// Stops a process and everything it started.
pub fn kill_tree(child: &mut Child) {
    #[cfg(target_os = "windows")]
    let _ = hidden("taskkill").args(["/PID", &child.id().to_string(), "/T", "/F"]).status();
    // the call itself and not the `kill` tool: procps reads `-123` as digits and signals group 1, which is everything
    #[cfg(not(target_os = "windows"))]
    {
        extern "C" {
            fn kill(pid: i32, signal: i32) -> i32;
        }
        const SIGKILL: i32 = 9;
        // SAFETY: a plain system call on the group `engine` made for this child, not yet reaped
        unsafe { kill(-(child.id() as i32), SIGKILL) };
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// Output of a short system tool; None when it is missing, fails, or hangs: a driver tool that stops
/// answering must not stop the program from starting.
pub fn quiet(program: &str, args: &[&str]) -> Option<String> {
    use std::io::Read;
    let mut child = hidden(program).args(args).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.read_to_end(&mut bytes);
        bytes
    });
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    loop {
        match child.try_wait().ok()? {
            Some(status) => {
                let bytes = reader.join().ok()?;
                return status.success().then(|| String::from_utf8_lossy(&bytes).into_owned());
            }
            None if std::time::Instant::now() > deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            None => std::thread::sleep(std::time::Duration::from_millis(50)),
        }
    }
}

/// Opens a file or a web page the way the system opens it.
pub fn open(target: &str) -> std::io::Result<()> {
    #[cfg(target_os = "windows")]
    let mut c = {
        let mut c = hidden("rundll32");
        c.args(["url.dll,FileProtocolHandler", target]);
        c
    };
    #[cfg(target_os = "macos")]
    let mut c = {
        let mut c = hidden("open");
        c.arg(target);
        c
    };
    #[cfg(target_os = "linux")]
    let mut c = {
        let mut c = hidden("xdg-open");
        c.arg(target);
        c
    };
    c.spawn().map(|_| ())
}

/// Shows a file in the file manager.
pub fn reveal(path: &str) -> std::io::Result<()> {
    #[cfg(target_os = "windows")]
    return hidden("explorer").arg(format!("/select,{path}")).spawn().map(|_| ());
    #[cfg(target_os = "macos")]
    return hidden("open").args(["-R", path]).spawn().map(|_| ());
    #[cfg(target_os = "linux")]
    return open(std::path::Path::new(path).parent().and_then(|p| p.to_str()).unwrap_or(path));
}

/// Puts text on the clipboard with the system's own tool, for when the web view refuses the page. Windows'
/// web view lets the page copy, so there is none there.
pub fn copy_text(text: &str) -> std::io::Result<()> {
    use std::io::Write;
    let tools: &[&str] = if cfg!(target_os = "macos") {
        &["/usr/bin/pbcopy"]
    } else if cfg!(target_os = "linux") {
        &["wl-copy", "xclip -selection clipboard", "xsel --clipboard --input"]
    } else {
        &[]
    };
    for tool in tools {
        let mut words = tool.split(' ');
        let mut c = hidden(words.next().unwrap_or_default());
        // pbcopy reads by the locale, and a program started from the Dock has none: Cyrillic would not survive
        c.args(words).env("LANG", "en_US.UTF-8").stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null());
        let Ok(mut child) = c.spawn() else { continue };
        let written = child.stdin.take().map(|mut input| input.write_all(text.as_bytes()));
        if child.wait()?.success() && matches!(written, Some(Ok(()))) {
            return Ok(());
        }
    }
    Err(std::io::Error::other("no clipboard tool here"))
}

/// Keeps the computer awake while it lives; the screen may still turn off (TZ §13).
pub struct Awake {
    #[allow(dead_code)]
    holder: Option<Child>,
}

impl Awake {
    pub fn hold() -> Self {
        #[cfg(target_os = "windows")]
        {
            #[link(name = "kernel32")]
            extern "system" {
                fn SetThreadExecutionState(flags: u32) -> u32;
            }
            // ES_CONTINUOUS | ES_SYSTEM_REQUIRED, for this thread until `drop`
            unsafe { SetThreadExecutionState(0x8000_0000 | 0x0000_0001) };
            Self { holder: None }
        }
        #[cfg(target_os = "macos")]
        {
            let holder = hidden("caffeinate").args(["-i", "-w", &std::process::id().to_string()]).spawn().ok();
            Self { holder }
        }
        #[cfg(target_os = "linux")]
        {
            let args = ["--what=idle:sleep", "--who=Polyzon Maker", "--why=Generating a model", "sleep", "604800"];
            Self { holder: hidden("systemd-inhibit").args(args).spawn().ok() }
        }
    }
}

impl Drop for Awake {
    fn drop(&mut self) {
        #[cfg(target_os = "windows")]
        {
            #[link(name = "kernel32")]
            extern "system" {
                fn SetThreadExecutionState(flags: u32) -> u32;
            }
            unsafe { SetThreadExecutionState(0x8000_0000) };
        }
        if let Some(c) = &mut self.holder {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_engine_sees_the_system_and_not_what_a_person_set_up() {
        for name in ["PYTHONPATH", "PYTHONHOME", "CONDA_PREFIX", "VIRTUAL_ENV", "UV_INDEX_URL", "PIP_INDEX_URL", "LD_LIBRARY_PATH"] {
            std::env::set_var(name, "somebody-elses");
        }
        let (shell, print) = if cfg!(windows) { ("cmd", ["/c", "set"]) } else { ("sh", ["-c", "env"]) };
        let out = engine(shell, false).args(print).output().unwrap();
        let seen = String::from_utf8_lossy(&out.stdout);
        assert!(!seen.contains("somebody-elses"), "{seen}");
        assert!(seen.contains("PYTHONNOUSERSITE=1"), "{seen}");
        assert!(seen.to_uppercase().contains(if cfg!(windows) { "SYSTEMROOT=" } else { "PATH=/" }), "{seen}");
    }
}

#[cfg(all(test, not(target_os = "windows")))]
mod unix_tests {
    use super::*;
    use std::{thread, time::Duration};

    #[test]
    fn stopping_an_engine_takes_what_it_started_and_nothing_else() {
        let pids = std::env::temp_dir().join(format!("maker-kill-{}", crate::store::random_id()));
        let script = format!("sleep 300 & echo $! > {}; wait", pids.display());
        let mut engine = engine("sh", false);
        let mut child = engine.args(["-c", &script]).spawn().unwrap();
        while !pids.exists() || std::fs::read_to_string(&pids).unwrap().trim().is_empty() {
            thread::sleep(Duration::from_millis(20));
        }
        let started = std::fs::read_to_string(&pids).unwrap();
        // killed and waiting for init to collect it still has a line in `ps`, marked Z
        let alive = |pid: &str| quiet("ps", &["-o", "stat=", "-p", pid]).is_some_and(|s| !s.trim_start().starts_with('Z'));
        assert!(alive(started.trim()));
        kill_tree(&mut child);
        thread::sleep(Duration::from_millis(200));
        assert!(!alive(started.trim()), "the engine's own child outlived it");
    }
}
