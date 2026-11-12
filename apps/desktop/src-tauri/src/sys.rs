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

/// The threads a gentle engine computes on: all the processor's cores but two for the person, one on a small one.
pub fn spare(physical: usize) -> usize {
    physical.saturating_sub(if physical >= 6 { 2 } else { 1 }).max(1)
}

/// The threads of this computer's engines, when they are gentle.
pub fn threads() -> usize {
    let logical = std::thread::available_parallelism().map_or(2, |n| n.get());
    spare(sysinfo::System::physical_core_count().unwrap_or(logical.div_ceil(2)))
}

/// An engine or a tool of ours: its own process group, so that it can be stopped with all it started,
/// and a clean environment, so that nothing on the computer changes what it does. A gentle one runs at a
/// lower priority and leaves the person some of the processor's cores.
pub fn engine(program: impl AsRef<OsStr>, gentle: bool) -> Command {
    #[cfg(target_os = "windows")]
    let mut c = {
        let mut c = hidden(program);
        isolate(&mut c);
        c.creation_flags(flags(gentle));
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut c = {
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
    };
    if gentle {
        let n = threads().to_string();
        for name in ["OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "VECLIB_MAXIMUM_THREADS", "NUMEXPR_NUM_THREADS"] {
            c.env(name, &n);
        }
    }
    c
}

#[cfg(target_os = "windows")]
fn flags(gentle: bool) -> u32 {
    if gentle { CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS } else { CREATE_NO_WINDOW }
}

/// A started engine. On Windows it runs in a job that ends with Polyzon Maker and takes the engine and all
/// it started with it, though the app be killed; elsewhere its process group is stopped by the app.
pub struct Contained {
    pub child: Child,
    #[cfg(target_os = "windows")]
    _job: Option<windows::Job>,
}

impl std::ops::Deref for Contained {
    type Target = Child;
    fn deref(&self) -> &Child {
        &self.child
    }
}

impl std::ops::DerefMut for Contained {
    fn deref_mut(&mut self) -> &mut Child {
        &mut self.child
    }
}

/// Starts an engine made by `engine`. A job that cannot be made leaves the engine running as before.
pub fn start(c: &mut Command, gentle: bool) -> std::io::Result<Contained> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::io::AsRawHandle;
        // held until it is in the job: what it starts at once, as a venv's python does, is then inside too
        c.creation_flags(flags(gentle) | windows::CREATE_SUSPENDED);
        let child = c.spawn()?;
        // SAFETY: the handle is the child's own, open while `child` lives
        let job = unsafe { windows::contain(child.as_raw_handle() as _, gentle) };
        // SAFETY: only the threads of the process just made, which is ours
        unsafe { windows::resume(child.id()) };
        Ok(Contained { child, _job: job })
    }
    #[cfg(not(target_os = "windows"))]
    {
        let child = c.spawn()?;
        // when memory runs out, the kernel stops the engine before the person's desktop
        #[cfg(target_os = "linux")]
        let _ = std::fs::write(format!("/proc/{}/oom_score_adj", child.id()), "800");
        let _ = gentle;
        Ok(Contained { child })
    }
}

#[cfg(target_os = "windows")]
mod windows {
    use std::{ffi::c_void, mem, ptr};
    use windows_sys::Win32::{
        Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE},
        System::{
            Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD, THREADENTRY32},
            JobObjects::{AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE},
            Threading::{OpenThread, ProcessMemoryPriority, ResumeThread, SetProcessInformation, MEMORY_PRIORITY_INFORMATION, MEMORY_PRIORITY_LOW, THREAD_SUSPEND_RESUME},
        },
    };

    pub use windows_sys::Win32::System::Threading::CREATE_SUSPENDED;

    pub struct Job(HANDLE);

    // SAFETY: a job handle may be closed from any thread
    unsafe impl Send for Job {}

    impl Drop for Job {
        fn drop(&mut self) {
            // SAFETY: our own handle, closed once; the job ends with it and stops what is left in it
            unsafe { CloseHandle(self.0) };
        }
    }

    /// A job that ends when its handle closes, the process in it; a gentle one's memory is the first the
    /// system takes back when it runs short, before the person's programs'.
    pub unsafe fn contain(process: HANDLE, gentle: bool) -> Option<Job> {
        if gentle {
            let low = MEMORY_PRIORITY_INFORMATION { MemoryPriority: MEMORY_PRIORITY_LOW };
            SetProcessInformation(process, ProcessMemoryPriority, &low as *const _ as *const c_void, mem::size_of::<MEMORY_PRIORITY_INFORMATION>() as u32);
        }
        let job = CreateJobObjectW(ptr::null(), ptr::null());
        if job.is_null() {
            return None;
        }
        let job = Job(job);
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = mem::zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let set = SetInformationJobObject(job.0, JobObjectExtendedLimitInformation, &limits as *const _ as *const c_void, mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32);
        (set != 0 && AssignProcessToJobObject(job.0, process) != 0).then_some(job)
    }

    /// Lets a process started held go: its one thread, found by the system's list of threads.
    pub unsafe fn resume(pid: u32) {
        let all = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
        if all == INVALID_HANDLE_VALUE {
            return;
        }
        let mut entry: THREADENTRY32 = mem::zeroed();
        entry.dwSize = mem::size_of::<THREADENTRY32>() as u32;
        let mut more = Thread32First(all, &mut entry) != 0;
        while more {
            if entry.th32OwnerProcessID == pid {
                let thread = OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID);
                if !thread.is_null() {
                    ResumeThread(thread);
                    CloseHandle(thread);
                }
            }
            more = Thread32Next(all, &mut entry) != 0;
        }
        CloseHandle(all);
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
    fn a_gentle_engine_leaves_the_person_two_cores_or_one_of_a_few() {
        assert_eq!([16, 8, 6, 5, 4, 2, 1, 0].map(spare), [14, 6, 4, 4, 3, 1, 1, 1]);
        assert!(threads() >= 1);
    }

    #[test]
    fn a_gentle_engine_computes_on_fewer_threads_and_a_full_speed_one_on_all() {
        let threads_of = |gentle: bool| engine("x", gentle).get_envs().find(|(k, _)| *k == "OMP_NUM_THREADS").and_then(|(_, v)| v).map(|v| v.to_string_lossy().into_owned());
        assert_eq!(threads_of(true), Some(threads().to_string()));
        assert_eq!(threads_of(false), None);
    }

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

#[cfg(all(test, target_os = "windows"))]
mod windows_tests {
    use super::*;
    use std::{thread, time::Duration};
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

    /// The processes `parent` started, as the system lists them now.
    fn children_of(parent: u32) -> Vec<Pid> {
        let mut s = System::new();
        s.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
        s.processes().iter().filter(|(_, p)| p.parent() == Some(Pid::from_u32(parent))).map(|(pid, _)| *pid).collect()
    }

    fn alive(pid: Pid) -> bool {
        let mut s = System::new();
        s.refresh_processes_specifics(ProcessesToUpdate::Some(&[pid]), true, ProcessRefreshKind::nothing());
        s.process(pid).is_some()
    }

    #[test]
    fn an_engine_started_held_runs_and_dies_with_what_it_started_when_its_job_ends() {
        let mut c = engine("cmd", true);
        c.args(["/c", "ping -n 60 127.0.0.1 > nul"]);
        let held = start(&mut c, true).unwrap();
        let shell = held.child.id();
        // it was let go: the shell got as far as starting ping
        let mut started = vec![];
        for _ in 0..100 {
            started = children_of(shell);
            if !started.is_empty() {
                break;
            }
            thread::sleep(Duration::from_millis(50));
        }
        assert!(!started.is_empty(), "the engine never ran: it was not let go");
        // the app gone, its job handle closes: the engine and what it started go with it
        drop(held);
        thread::sleep(Duration::from_millis(500));
        assert!(!alive(Pid::from_u32(shell)), "the engine outlived its job");
        assert!(started.iter().all(|pid| !alive(*pid)), "what the engine started outlived its job");
    }
}
