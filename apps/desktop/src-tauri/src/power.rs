//! Sleep or shut down when the queue runs out, for a queue left for the night (owner, 2026-11-11). It is
//! chosen for one queue and kept in memory only: a restart forgets it and the computer stays on, which is
//! the safe way to be wrong.
use crate::sys;
use serde::{Deserialize, Serialize};
use std::{io, time::Duration};

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Default, Debug)]
#[serde(rename_all = "lowercase")]
pub enum After {
    #[default]
    Nothing,
    Sleep,
    Shutdown,
}

/// A Mac is shut down from a program only with root, or with the person's leave to drive System Events,
/// which it asks for in a dialog nobody answers at night.
pub const OFFERED: &[After] =
    if cfg!(target_os = "macos") { &[After::Nothing, After::Sleep] } else { &[After::Nothing, After::Sleep, After::Shutdown] };

/// The minute a person who is still there has to say no; the window comes up with it.
pub const GRACE: Duration = Duration::from_secs(60);

/// What the page is told: the choice, what this system offers, and the seconds left when it is about to happen.
#[derive(Serialize, Clone)]
pub struct Plan {
    pub chosen: After,
    pub offered: &'static [After],
    pub soon: Option<u64>,
}

impl Plan {
    pub fn new(chosen: After, soon: Option<Duration>) -> Self {
        Self { chosen, offered: OFFERED, soon: soon.map(|d| d.as_secs()) }
    }
}

/// Asks the system, as its own menu would: a program with unsaved work may still hold a shutdown up.
pub fn go(after: After) -> io::Result<()> {
    match after {
        After::Nothing => Ok(()),
        After::Sleep => sleep(),
        After::Shutdown => shut_down(),
    }
}

#[cfg(target_os = "windows")]
fn sleep() -> io::Result<()> {
    #[link(name = "powrprof")]
    extern "system" {
        fn SetSuspendState(hibernate: u8, force: u8, wake_events_off: u8) -> u8;
    }
    // sleep, not hibernation; not forced; what is set to wake the computer still does
    match unsafe { SetSuspendState(0, 0, 0) } {
        0 => Err(io::Error::last_os_error()),
        _ => Ok(()),
    }
}

#[cfg(target_os = "macos")]
fn sleep() -> io::Result<()> {
    run("pmset", &["sleepnow"])
}

#[cfg(target_os = "linux")]
fn sleep() -> io::Result<()> {
    run("systemctl", &["suspend"])
}

#[cfg(target_os = "windows")]
fn shut_down() -> io::Result<()> {
    run("shutdown", &["/s", "/t", "0"])
}

#[cfg(target_os = "macos")]
fn shut_down() -> io::Result<()> {
    Err(io::ErrorKind::Unsupported.into())
}

#[cfg(target_os = "linux")]
fn shut_down() -> io::Result<()> {
    run("systemctl", &["poweroff"])
}

fn run(program: &str, args: &[&str]) -> io::Result<()> {
    let out = sys::hidden(program).args(args).output()?;
    if out.status.success() {
        return Ok(());
    }
    Err(io::Error::other(String::from_utf8_lossy(&out.stderr).trim().to_string()))
}
