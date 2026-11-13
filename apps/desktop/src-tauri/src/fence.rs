//! The fence a plugin's own program runs in (PLUGINS.md). On Windows it is an AppContainer: of the
//! computer's files the program reaches only the system's own, which every app may read, and the folders
//! granted to it here; the person's files are not among them. It gets no network, starts no other
//! program, and has no clipboard. Other systems have no fence yet, and there a plugin's program does not run.

use crate::sys;
#[cfg(not(windows))]
use std::ffi::OsString;
use std::{collections::HashMap, path::Path, process::Command, sync::Mutex};

/// Whether this system has a fence. Where it has none, plugins bring no programs.
pub const READY: bool = cfg!(windows);

/// The fence of one plugin: each has its own, so that one plugin's folders stay closed to another.
pub fn name(plugin: &str) -> String {
    format!("polyzon.maker.{plugin}")
}

/// `program` started inside the fence `name`, in `folder`. Our own program starts it there: the line
/// it gets is `--fence <name> <folder> -- <program> <args…>`, and what follows `program` is added by the caller.
pub fn command(name: &str, folder: &Path, program: &Path, gentle: bool) -> Result<Command, String> {
    let me = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut c = sys::engine(me, gentle);
    c.arg("--fence").arg(name).arg(folder).arg("--").arg(program);
    Ok(c)
}

/// What the last look found: the network is closed to programs in a fence on this computer, or not.
static OPEN: Mutex<Option<HashMap<String, bool>>> = Mutex::new(None);

/// Whether a program in this fence can reach the internet after all. Windows closes the network to
/// an AppContainer with a rule of its firewall, and a rule made for one program by its path, or a
/// security program's own, comes before it. So the fence is tried with `python` itself, once a session:
/// a connection that goes through means it is open here. Offline, it counts as closed.
pub fn open_here(name: &str, folder: &Path, python: &Path) -> bool {
    if let Some(known) = OPEN.lock().unwrap().as_ref().and_then(|seen| seen.get(name).copied()) {
        return known;
    }
    let Ok(mut c) = command(name, folder, python, false) else { return false };
    c.args(["-I", "-S", "-c", "import socket; socket.create_connection(('1.1.1.1', 443), 4)"]);
    c.stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    let open = c.status().is_ok_and(|s| s.success());
    let online = || std::net::TcpStream::connect_timeout(&std::net::SocketAddr::from(([1, 1, 1, 1], 443)), std::time::Duration::from_secs(4)).is_ok();
    if settled(open, online) {
        OPEN.lock().unwrap().get_or_insert_with(HashMap::new).insert(name.to_string(), open);
    }
    open
}

/// Whether what a look found holds for the rest of the session. «Closed» counts only when this computer is
/// online: offline, nothing gets through, fence or not, and the network may come back open to the fence.
fn settled(open: bool, online: impl FnOnce() -> bool) -> bool {
    open || online()
}

#[cfg(windows)]
pub use inside::{forget, grant, launch};

#[cfg(not(windows))]
pub fn grant(_name: &str, _path: &Path, _write: bool) -> Result<(), String> {
    Err("FENCE_MISSING".into())
}

#[cfg(not(windows))]
pub fn launch(_args: &[OsString]) -> i32 {
    eprintln!("fence: this system has none");
    126
}

#[cfg(not(windows))]
pub fn forget(_name: &str) {}

#[cfg(windows)]
mod inside {
    use std::{
        ffi::{c_void, OsStr, OsString},
        iter, mem,
        os::windows::ffi::OsStrExt,
        path::Path,
        ptr,
    };
    use windows_sys::Win32::{
        Foundation::{CloseHandle, GetLastError, LocalFree, ERROR_ALREADY_EXISTS},
        Security::{
            AclSizeInformation,
            Authorization::{GetNamedSecurityInfoW, SetEntriesInAclW, SetNamedSecurityInfoW, EXPLICIT_ACCESS_W, GRANT_ACCESS, NO_MULTIPLE_TRUSTEE, SE_FILE_OBJECT, TRUSTEE_IS_SID, TRUSTEE_IS_WELL_KNOWN_GROUP, TRUSTEE_W},
            EqualSid, FreeSid, GetAce, GetAclInformation,
            Isolation::{CreateAppContainerProfile, DeleteAppContainerProfile, DeriveAppContainerSidFromAppContainerName},
            ACCESS_ALLOWED_ACE, ACL, ACL_SIZE_INFORMATION, DACL_SECURITY_INFORMATION, PSID, SECURITY_CAPABILITIES, SUB_CONTAINERS_AND_OBJECTS_INHERIT,
        },
        Storage::FileSystem::{DELETE, FILE_GENERIC_EXECUTE, FILE_GENERIC_READ, FILE_GENERIC_WRITE},
        System::{
            Console::{GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE},
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicUIRestrictions, JobObjectExtendedLimitInformation, SetInformationJobObject, JOBOBJECT_BASIC_UI_RESTRICTIONS,
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_ACTIVE_PROCESS, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_UILIMIT_DESKTOP, JOB_OBJECT_UILIMIT_DISPLAYSETTINGS,
                JOB_OBJECT_UILIMIT_EXITWINDOWS, JOB_OBJECT_UILIMIT_GLOBALATOMS, JOB_OBJECT_UILIMIT_HANDLES, JOB_OBJECT_UILIMIT_READCLIPBOARD, JOB_OBJECT_UILIMIT_SYSTEMPARAMETERS,
                JOB_OBJECT_UILIMIT_WRITECLIPBOARD,
            },
            Threading::{
                CreateProcessW, DeleteProcThreadAttributeList, GetExitCodeProcess, InitializeProcThreadAttributeList, ResumeThread, TerminateProcess, UpdateProcThreadAttribute, WaitForSingleObject,
                CREATE_NO_WINDOW, CREATE_SUSPENDED, EXTENDED_STARTUPINFO_PRESENT, INFINITE, LPPROC_THREAD_ATTRIBUTE_LIST, PROCESS_INFORMATION, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
                STARTF_USESTDHANDLES, STARTUPINFOEXW,
            },
        },
    };

    const READ: u32 = FILE_GENERIC_READ | FILE_GENERIC_EXECUTE;
    const WRITE: u32 = READ | FILE_GENERIC_WRITE | DELETE;
    const ALLOWED: u8 = 0; // ACCESS_ALLOWED_ACE_TYPE
    const USAGE: &str = "usage: --fence <name> <folder> -- <program> <args>";

    fn wide(s: impl AsRef<OsStr>) -> Vec<u16> {
        s.as_ref().encode_wide().chain(iter::once(0)).collect()
    }

    fn failed(what: &str, code: u32) -> String {
        format!("{what}: {}", std::io::Error::from_raw_os_error(code as i32))
    }

    /// A SID the system handed out, given back when it is dropped.
    struct Sid(PSID);

    impl Drop for Sid {
        fn drop(&mut self) {
            // SAFETY: the SID came from the AppContainer calls, which ask for FreeSid
            unsafe { FreeSid(self.0) };
        }
    }

    /// The container of one fence, made the first time it is asked for.
    fn container(name: &str) -> Result<Sid, String> {
        let n = wide(name);
        let mut sid: PSID = ptr::null_mut();
        // SAFETY: valid strings in, a SID out that `Sid` frees
        let made = unsafe { CreateAppContainerProfile(n.as_ptr(), n.as_ptr(), n.as_ptr(), ptr::null(), 0, &mut sid) };
        let exists = (ERROR_ALREADY_EXISTS & 0xffff) | 0x8007_0000;
        if made as u32 == exists {
            // SAFETY: as above
            let derived = unsafe { DeriveAppContainerSidFromAppContainerName(n.as_ptr(), &mut sid) };
            if derived < 0 {
                return Err(failed("the fence", derived as u32 & 0xffff));
            }
        } else if made < 0 {
            return Err(failed("the fence", made as u32 & 0xffff));
        }
        Ok(Sid(sid))
    }

    /// The fence goes with the plugin: what Windows keeps for it is let go.
    pub fn forget(name: &str) {
        // SAFETY: a plain call with a valid string; a fence that was never made is no error worth telling
        unsafe { DeleteAppContainerProfile(wide(name).as_ptr()) };
    }

    /// Whether the folder's own rules already let the fence in as far as `want`, for all it holds.
    fn has(dacl: *const ACL, sid: PSID, want: u32) -> bool {
        // SAFETY: the list came from GetNamedSecurityInfoW and is read only within its size
        unsafe {
            let mut info: ACL_SIZE_INFORMATION = mem::zeroed();
            if GetAclInformation(dacl, &mut info as *mut _ as *mut c_void, mem::size_of::<ACL_SIZE_INFORMATION>() as u32, AclSizeInformation) == 0 {
                return false;
            }
            (0..info.AceCount).any(|i| {
                let mut ace: *mut c_void = ptr::null_mut();
                if GetAce(dacl, i, &mut ace) == 0 {
                    return false;
                }
                let ace = &*(ace as *const ACCESS_ALLOWED_ACE);
                let inherits = ace.Header.AceFlags as u32 & SUB_CONTAINERS_AND_OBJECTS_INHERIT == SUB_CONTAINERS_AND_OBJECTS_INHERIT;
                ace.Header.AceType == ALLOWED && inherits && ace.Mask & want == want && EqualSid(&ace.SidStart as *const u32 as PSID, sid) != 0
            })
        }
    }

    /// Lets the fence `name` read `path` and all it holds, or also write there. Asked again, it changes nothing.
    pub fn grant(name: &str, path: &Path, write: bool) -> Result<(), String> {
        let sid = container(name)?;
        let want = if write { WRITE } else { READ };
        let p = wide(path);
        let mut dacl: *mut ACL = ptr::null_mut();
        let mut descriptor = ptr::null_mut();
        // SAFETY: a valid path; the descriptor is freed below and `dacl` points into it
        let got = unsafe { GetNamedSecurityInfoW(p.as_ptr(), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, ptr::null_mut(), ptr::null_mut(), &mut dacl, ptr::null_mut(), &mut descriptor) };
        if got != 0 {
            return Err(failed(&path.display().to_string(), got));
        }
        // no list at all lets everyone in: a drive that keeps no permissions is one
        let result = if dacl.is_null() || has(dacl, sid.0, want) { Ok(()) } else { add(&p, dacl, sid.0, want) };
        // SAFETY: allocated by GetNamedSecurityInfoW
        unsafe { LocalFree(descriptor) };
        result.map_err(|code| failed(&path.display().to_string(), code))
    }

    fn add(path: &[u16], dacl: *const ACL, sid: PSID, want: u32) -> Result<(), u32> {
        let entry = EXPLICIT_ACCESS_W {
            grfAccessPermissions: want,
            grfAccessMode: GRANT_ACCESS,
            grfInheritance: SUB_CONTAINERS_AND_OBJECTS_INHERIT,
            Trustee: TRUSTEE_W { pMultipleTrustee: ptr::null_mut(), MultipleTrusteeOperation: NO_MULTIPLE_TRUSTEE, TrusteeForm: TRUSTEE_IS_SID, TrusteeType: TRUSTEE_IS_WELL_KNOWN_GROUP, ptstrName: sid as *mut u16 },
        };
        let mut new: *mut ACL = ptr::null_mut();
        // SAFETY: one entry in, a new list out that is freed below; setting it reaches all the folder holds
        unsafe {
            let made = SetEntriesInAclW(1, &entry, dacl, &mut new);
            if made != 0 {
                return Err(made);
            }
            let set = SetNamedSecurityInfoW(path.as_ptr(), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, ptr::null_mut(), ptr::null_mut(), new, ptr::null());
            LocalFree(new as *mut c_void);
            if set != 0 { Err(set) } else { Ok(()) }
        }
    }

    /// One argument as Windows programs read their command line back.
    fn quoted(arg: &OsStr, line: &mut Vec<u16>) {
        let text: Vec<u16> = arg.encode_wide().collect();
        let (quote, slash) = (b'"' as u16, b'\\' as u16);
        if !text.is_empty() && !text.iter().any(|&c| c == quote || c == b' ' as u16 || c == b'\t' as u16) {
            line.extend(text);
            return;
        }
        line.push(quote);
        let mut slashes = 0;
        for c in text {
            if c == slash {
                slashes += 1;
                continue;
            }
            let doubled = if c == quote { slashes * 2 + 1 } else { slashes };
            line.extend(iter::repeat_n(slash, doubled));
            slashes = 0;
            line.push(c);
        }
        line.extend(iter::repeat_n(slash, slashes * 2));
        line.push(quote);
    }

    fn command_line(program: &OsStr, args: &[OsString]) -> Vec<u16> {
        let mut line = vec![];
        quoted(program, &mut line);
        for arg in args {
            line.push(b' ' as u16);
            quoted(arg, &mut line);
        }
        line.push(0);
        line
    }

    /// `--fence <name> <folder> -- <program> <args…>`: runs the program inside the fence, in that folder,
    /// with this process's input and output, and gives its exit code.
    pub fn launch(args: &[OsString]) -> i32 {
        match start(args) {
            Ok(code) => code as i32,
            Err(e) => {
                eprintln!("fence: {e}");
                126
            }
        }
    }

    fn start(args: &[OsString]) -> Result<u32, String> {
        let [name, folder, dash, program, rest @ ..] = args else { return Err(USAGE.into()) };
        if dash != "--" {
            return Err(USAGE.into());
        }
        let sid = container(&name.to_string_lossy())?;
        let capabilities = SECURITY_CAPABILITIES { AppContainerSid: sid.0, Capabilities: ptr::null_mut(), CapabilityCount: 0, Reserved: 0 };
        let mut line = command_line(program, rest);
        let (exe, dir) = (wide(program), wide(folder));
        // SAFETY: the attribute list lives in `list` for the whole call, and every handle is closed or kept on purpose
        unsafe {
            let mut size = 0usize;
            InitializeProcThreadAttributeList(ptr::null_mut(), 1, 0, &mut size);
            let mut list = vec![0u8; size];
            let attributes = list.as_mut_ptr() as LPPROC_THREAD_ATTRIBUTE_LIST;
            if InitializeProcThreadAttributeList(attributes, 1, 0, &mut size) == 0 {
                return Err(failed("the fence", GetLastError()));
            }
            let set = UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES as usize, &capabilities as *const _ as *const c_void, mem::size_of::<SECURITY_CAPABILITIES>(), ptr::null_mut(), ptr::null());
            if set == 0 {
                DeleteProcThreadAttributeList(attributes);
                return Err(failed("the fence", GetLastError()));
            }
            let mut info: STARTUPINFOEXW = mem::zeroed();
            info.StartupInfo.cb = mem::size_of::<STARTUPINFOEXW>() as u32;
            info.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
            info.StartupInfo.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
            info.StartupInfo.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
            info.StartupInfo.hStdError = GetStdHandle(STD_ERROR_HANDLE);
            info.lpAttributeList = attributes;
            let mut process: PROCESS_INFORMATION = mem::zeroed();
            // held until it is in the job, so that nothing can start before the job's rules apply
            let flags = EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW | CREATE_SUSPENDED;
            let made = CreateProcessW(exe.as_ptr(), line.as_mut_ptr(), ptr::null(), ptr::null(), 1, flags, ptr::null(), dir.as_ptr(), &info.StartupInfo, &mut process);
            let error = GetLastError();
            DeleteProcThreadAttributeList(attributes);
            if made == 0 {
                return Err(failed(&program.to_string_lossy(), error));
            }
            let job = CreateJobObjectW(ptr::null(), ptr::null());
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = mem::zeroed();
            // one process and no more: one it started could be a program some firewall rule lets out by its path
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
            limits.BasicLimitInformation.ActiveProcessLimit = 1;
            let screen = JOBOBJECT_BASIC_UI_RESTRICTIONS {
                UIRestrictionsClass: JOB_OBJECT_UILIMIT_DESKTOP
                    | JOB_OBJECT_UILIMIT_DISPLAYSETTINGS
                    | JOB_OBJECT_UILIMIT_EXITWINDOWS
                    | JOB_OBJECT_UILIMIT_GLOBALATOMS
                    | JOB_OBJECT_UILIMIT_HANDLES
                    | JOB_OBJECT_UILIMIT_READCLIPBOARD
                    | JOB_OBJECT_UILIMIT_SYSTEMPARAMETERS
                    | JOB_OBJECT_UILIMIT_WRITECLIPBOARD,
            };
            let limited = !job.is_null()
                && SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits as *const _ as *const c_void, mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32) != 0
                && SetInformationJobObject(job, JobObjectBasicUIRestrictions, &screen as *const _ as *const c_void, mem::size_of::<JOBOBJECT_BASIC_UI_RESTRICTIONS>() as u32) != 0
                && AssignProcessToJobObject(job, process.hProcess) != 0;
            if !limited {
                let error = GetLastError();
                TerminateProcess(process.hProcess, 1);
                CloseHandle(process.hThread);
                CloseHandle(process.hProcess);
                return Err(failed("the fence's job", error));
            }
            ResumeThread(process.hThread);
            WaitForSingleObject(process.hProcess, INFINITE);
            let mut code = 1u32;
            GetExitCodeProcess(process.hProcess, &mut code);
            CloseHandle(process.hThread);
            CloseHandle(process.hProcess);
            // the job is left open: it closes as this process ends and takes whatever was left running
            Ok(code)
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::{fs, path::PathBuf};

        const CMD: &str = r"C:\Windows\System32\cmd.exe";

        /// cmd.exe reads its line back by its own rules, so each word goes as it is, and no path has a space
        fn inside(name: &str, folder: &Path, words: &[&str]) -> u32 {
            let head = [name, &folder.to_string_lossy(), "--", CMD, "/c"].map(OsString::from);
            let args: Vec<OsString> = head.into_iter().chain(words.iter().map(OsString::from)).collect();
            start(&args).unwrap()
        }

        #[test]
        fn a_fenced_program_reaches_only_the_folders_it_was_given() {
            let name = format!("polyzon.maker.test-{}", crate::store::random_id());
            let base = std::env::temp_dir().join(format!("maker-fence-{}", crate::store::random_id()));
            let (own, shown, secret) = (base.join("own"), base.join("shown"), base.join("secret"));
            for d in [&own, &shown, &secret] {
                fs::create_dir_all(d).unwrap();
            }
            fs::write(shown.join("r.txt"), "shown").unwrap();
            fs::write(secret.join("s.txt"), "secret").unwrap();
            grant(&name, &own, true).unwrap();
            grant(&name, &shown, false).unwrap();
            grant(&name, &own, true).unwrap();

            let path = |p: PathBuf| p.to_string_lossy().into_owned();
            assert!(!path(base.clone()).contains(' '), "the test needs a temporary folder without spaces");
            assert_eq!(inside(&name, &own, &["echo", "made>", "made.txt"]), 0);
            assert_eq!(fs::read_to_string(own.join("made.txt")).unwrap().trim(), "made");
            assert_eq!(inside(&name, &own, &["type", &path(shown.join("r.txt")), ">", "nul"]), 0, "may read what it was shown");
            assert_ne!(inside(&name, &own, &["echo", "x>", &path(shown.join("w.txt"))]), 0, "may not write there");
            assert!(!shown.join("w.txt").exists());
            assert_ne!(inside(&name, &own, &["type", &path(secret.join("s.txt")), ">", "nul"]), 0, "may not read the rest");
            let home = std::env::var("USERPROFILE").unwrap();
            assert_ne!(inside(&name, &own, &["dir", &home, ">", "nul"]), 0, "may not look into the person's folder");
            assert_ne!(inside(&name, &own, &["cmd", "/c", "exit", "0"]), 0, "may not start another program");
            forget(&name);
            let _ = fs::remove_dir_all(base);
        }

        #[test]
        fn arguments_reach_the_program_as_they_were() {
            let mut line = vec![];
            for arg in ["plain", "two words", "say \"hi\"", r"ends\", ""] {
                quoted(OsStr::new(arg), &mut line);
                line.push(b' ' as u16);
            }
            // a backslash means itself unless quotes follow it, as at the end of a quoted argument
            assert_eq!(String::from_utf16_lossy(&line), r#"plain "two words" "say \"hi\"" ends\ "" "#);
            let mut spaced = vec![];
            quoted(OsStr::new(r"C:\a b\"), &mut spaced);
            assert_eq!(String::from_utf16_lossy(&spaced), r#""C:\a b\\""#);
        }
    }
}

#[cfg(test)]
mod look_tests {
    #[test]
    fn a_fence_found_closed_while_offline_is_looked_at_again() {
        assert!(super::settled(true, || panic!("open is open, online or not")));
        assert!(super::settled(false, || true), "closed with the internet there: closed");
        assert!(!super::settled(false, || false), "closed with no internet: nothing is known yet");
    }
}
