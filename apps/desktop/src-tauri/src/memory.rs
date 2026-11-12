//! How much memory the computer has left while an engine runs. The engine is stopped while the system can
//! still answer: before macOS pauses programs and asks to quit one, before Windows crawls through its
//! paging file. A model that needs more than the computer has fails with a reason, the computer stays usable.

use std::time::Duration;
use sysinfo::{Pid, Process, ProcessRefreshKind, ProcessesToUpdate, System};

/// What the system and the programs people keep open take, besides the reserve. To be measured.
pub const SYSTEM_MB: u64 = 3000;
/// Critical pressure for this long stops the engine: a moment of it is the system making room.
const CRITICAL_FOR: Duration = Duration::from_secs(2);
/// Swap that grew this much past what this computer may swap, while memory is short, is the system drowning.
const SWAP_GROWN_MB: u64 = 2048;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug, Default)]
pub enum Pressure {
    #[default]
    Normal,
    Warn,
    Critical,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Sample {
    pub free_mb: u64,
    pub swap_mb: u64,
    pub pressure: Pressure,
    /// What the engine and what it started hold of main memory; on a Mac with its graphics memory
    pub engine_mb: u64,
}

/// What this computer can give an engine: a reserve stays for the system and the programs that are open.
/// A Mac swaps to a fast disk and copes with a little of it; elsewhere swapping is already too late.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Budget {
    pub reserve_mb: u64,
    pub swap_ok_mb: u64,
    pub room_mb: u64,
}

impl Budget {
    pub fn of(total_mb: u64, mac: bool) -> Self {
        let reserve_mb = (total_mb / 8).clamp(2048, 4096);
        let swap_ok_mb = if mac { total_mb / 8 } else { 0 };
        Self { reserve_mb, swap_ok_mb, room_mb: (total_mb + swap_ok_mb).saturating_sub(reserve_mb + SYSTEM_MB) }
    }
}

#[derive(Debug, PartialEq)]
pub enum Verdict {
    Fine,
    /// Memory got short for the first time in this run
    Low,
    /// Stop the engine now; what was seen, in numbers
    Stop(String),
}

/// One run of an engine, sample by sample.
pub struct Watch {
    budget: Budget,
    swap_start: Option<u64>,
    critical_since: Option<Duration>,
    pub peak_mb: u64,
    /// Memory got short at least once
    pub low: bool,
}

impl Watch {
    pub fn new(budget: Budget) -> Self {
        Self { budget, swap_start: None, critical_since: None, peak_mb: 0, low: false }
    }

    /// `at`: how long the engine has been running.
    pub fn see(&mut self, s: &Sample, at: Duration) -> Verdict {
        self.peak_mb = self.peak_mb.max(s.engine_mb);
        let grown = s.swap_mb.saturating_sub(*self.swap_start.get_or_insert(s.swap_mb));
        let room = self.budget.room_mb;
        let numbers = format!("free {} MB, swap +{grown} MB, engine {} MB, room {room} MB", s.free_mb, s.engine_mb);
        if s.pressure == Pressure::Critical {
            let since = *self.critical_since.get_or_insert(at);
            if at.saturating_sub(since) >= CRITICAL_FOR {
                return Verdict::Stop(format!("memory pressure critical; {numbers}"));
            }
        } else {
            self.critical_since = None;
        }
        if s.pressure == Pressure::Normal {
            return Verdict::Fine;
        }
        if s.engine_mb > room {
            return Verdict::Stop(format!("engine over this computer's room; {numbers}"));
        }
        if grown > self.budget.swap_ok_mb + SWAP_GROWN_MB {
            return Verdict::Stop(format!("swapping; {numbers}"));
        }
        if self.low {
            return Verdict::Fine;
        }
        self.low = true;
        Verdict::Low
    }
}

/// Where a system without a pressure signal stands: by what is free against the reserve.
#[cfg_attr(target_os = "macos", allow(dead_code))]
fn by_free(free_mb: u64, reserve_mb: u64) -> Pressure {
    if free_mb < (reserve_mb / 2).max(1024) {
        Pressure::Critical
    } else if free_mb < reserve_mb {
        Pressure::Warn
    } else {
        Pressure::Normal
    }
}

/// Linux: the share of the last ten seconds in which everything waited for memory.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn by_psi(text: &str) -> Option<Pressure> {
    let full = text.lines().find(|l| l.starts_with("full "))?;
    let avg10: f64 = full.split_whitespace().find_map(|w| w.strip_prefix("avg10="))?.parse().ok()?;
    Some(if avg10 >= 25.0 {
        Pressure::Critical
    } else if avg10 >= 10.0 {
        Pressure::Warn
    } else {
        Pressure::Normal
    })
}

/// macOS: what the kernel itself says, the level at which it starts to pause programs.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn by_level(level: i32) -> Pressure {
    match level {
        4 => Pressure::Critical,
        2 => Pressure::Warn,
        _ => Pressure::Normal,
    }
}

#[cfg(target_os = "macos")]
fn pressure(_free_mb: u64, _reserve_mb: u64) -> Pressure {
    extern "C" {
        fn sysctlbyname(name: *const std::ffi::c_char, old: *mut std::ffi::c_void, len: *mut usize, new: *mut std::ffi::c_void, new_len: usize) -> i32;
    }
    let (mut level, mut len) = (0i32, std::mem::size_of::<i32>());
    // SAFETY: reads one int into `level`, whose size `len` gives
    let read = unsafe { sysctlbyname(c"kern.memorystatus_vm_pressure_level".as_ptr(), (&mut level as *mut i32).cast(), &mut len, std::ptr::null_mut(), 0) };
    if read == 0 { by_level(level) } else { Pressure::Normal }
}

#[cfg(target_os = "linux")]
fn pressure(free_mb: u64, reserve_mb: u64) -> Pressure {
    let psi = std::fs::read_to_string("/proc/pressure/memory").ok().and_then(|t| by_psi(&t));
    psi.unwrap_or_default().max(by_free(free_mb, reserve_mb))
}

#[cfg(target_os = "windows")]
fn pressure(free_mb: u64, reserve_mb: u64) -> Pressure {
    by_free(free_mb, reserve_mb)
}

/// A process's own memory: on a Mac the footprint, graphics memory included; on Linux the anonymous part,
/// so weights mapped from the disk do not count; on Windows its commit.
#[cfg(target_os = "macos")]
fn own_mb(pid: Pid, _: &Process) -> u64 {
    extern "C" {
        fn proc_pid_rusage(pid: i32, flavor: i32, buffer: *mut u64) -> i32;
    }
    // rusage_info_v0: a 16-byte uuid, then ten counters; ri_phys_footprint is the eighth of them
    let mut info = [0u64; 12];
    // SAFETY: flavor 0 fills exactly the 96 bytes of `info`
    if unsafe { proc_pid_rusage(pid.as_u32() as i32, 0, info.as_mut_ptr()) } != 0 {
        return 0;
    }
    info[9] >> 20
}

#[cfg(target_os = "linux")]
fn own_mb(pid: Pid, _: &Process) -> u64 {
    let status = std::fs::read_to_string(format!("/proc/{pid}/status")).unwrap_or_default();
    let kb: u64 = status.lines().filter(|l| l.starts_with("RssAnon:") || l.starts_with("RssShmem:")).filter_map(|l| l.split_whitespace().nth(1)?.parse::<u64>().ok()).sum();
    kb >> 10
}

#[cfg(target_os = "windows")]
fn own_mb(_: Pid, p: &Process) -> u64 {
    p.virtual_memory() >> 20
}

/// The processes under `root`, itself included: Windows' venv python starts the real one as its child.
fn tree(root: Pid, parent_of: impl Fn(Pid) -> Option<Pid>, all: impl Iterator<Item = Pid>) -> Vec<Pid> {
    all.filter(|&pid| {
        let mut at = Some(pid);
        for _ in 0..16 {
            match at {
                Some(p) if p == root => return true,
                Some(p) => at = parent_of(p),
                None => return false,
            }
        }
        false
    })
    .collect()
}

pub struct Sampler {
    system: System,
    pub budget: Budget,
}

impl Sampler {
    pub fn new() -> Self {
        let mut system = System::new();
        system.refresh_memory();
        // a smaller computer when one is tried out on this one (POLYZON_RAM_MB)
        let budget = Budget::of(crate::hardware::total_mb(system.total_memory() >> 20), cfg!(target_os = "macos"));
        Self { system, budget }
    }

    pub fn sample(&mut self, root: u32) -> Sample {
        self.system.refresh_memory();
        let free_mb = self.system.available_memory() >> 20;
        let kind = if cfg!(target_os = "windows") { ProcessRefreshKind::nothing().with_memory() } else { ProcessRefreshKind::nothing() };
        self.system.refresh_processes_specifics(ProcessesToUpdate::All, true, kind);
        let procs = self.system.processes();
        let parent_of = |pid: Pid| procs.get(&pid).and_then(Process::parent);
        let engine_mb = tree(Pid::from_u32(root), parent_of, procs.keys().copied()).into_iter().filter_map(|pid| Some(own_mb(pid, procs.get(&pid)?))).sum();
        Sample { free_mb, swap_mb: self.system.used_swap() >> 20, pressure: pressure(free_mb, self.budget.reserve_mb), engine_mb }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const S: Duration = Duration::from_secs(1);

    fn at(pressure: Pressure, engine_mb: u64, swap_mb: u64) -> Sample {
        Sample { free_mb: 1000, swap_mb, pressure, engine_mb }
    }

    #[test]
    fn a_computer_keeps_a_reserve_and_a_mac_may_swap_a_little() {
        // 8 GB: 8192 + 1024 swap - 2048 reserve - 3000 system
        assert_eq!(Budget::of(8192, true), Budget { reserve_mb: 2048, swap_ok_mb: 1024, room_mb: 4168 });
        assert_eq!(Budget::of(16384, true).room_mb, 13384);
        assert_eq!(Budget::of(24576, true).room_mb, 21576);
        assert_eq!(Budget::of(24576, false), Budget { reserve_mb: 3072, swap_ok_mb: 0, room_mb: 18504 });
        assert_eq!(Budget::of(65536, false).reserve_mb, 4096, "a big computer keeps no more than 4 GB back");
        assert_eq!(Budget::of(1024, false).room_mb, 0);
    }

    #[test]
    fn a_moment_of_critical_pressure_is_borne_and_two_seconds_stop_the_engine() {
        let mut w = Watch::new(Budget::of(24576, true));
        assert_eq!(w.see(&at(Pressure::Normal, 5000, 0), S), Verdict::Fine);
        assert_eq!(w.see(&at(Pressure::Critical, 9000, 0), 2 * S), Verdict::Low);
        assert_eq!(w.see(&at(Pressure::Warn, 9000, 0), 3 * S), Verdict::Fine, "it passed: the count starts again");
        assert_eq!(w.see(&at(Pressure::Critical, 9000, 0), 4 * S), Verdict::Fine);
        assert_eq!(w.see(&at(Pressure::Critical, 9000, 0), 5 * S), Verdict::Fine);
        assert!(matches!(w.see(&at(Pressure::Critical, 9000, 0), 6 * S), Verdict::Stop(why) if why.starts_with("memory pressure critical")));
        assert_eq!(w.peak_mb, 9000);
        assert!(w.low);
    }

    #[test]
    fn an_engine_past_the_room_stops_only_once_memory_is_short() {
        let mut w = Watch::new(Budget::of(24576, true));
        assert_eq!(w.see(&at(Pressure::Normal, 30000, 0), S), Verdict::Fine, "the system copes: it is let be");
        assert!(matches!(w.see(&at(Pressure::Warn, 22000, 0), 2 * S), Verdict::Stop(why) if why.contains("engine 22000 MB, room 21576 MB")));
    }

    #[test]
    fn swap_that_keeps_growing_while_memory_is_short_stops_the_engine() {
        let mut w = Watch::new(Budget::of(24576, true));
        assert_eq!(w.see(&at(Pressure::Normal, 1000, 500), S), Verdict::Fine);
        // a Mac may swap 3072 + 2048 more than it had at the start
        assert_eq!(w.see(&at(Pressure::Warn, 1000, 500 + 5120), 2 * S), Verdict::Low);
        assert!(matches!(w.see(&at(Pressure::Warn, 1000, 500 + 5121), 3 * S), Verdict::Stop(why) if why.starts_with("swapping")));
        let mut pc = Watch::new(Budget::of(24576, false));
        assert_eq!(pc.see(&at(Pressure::Normal, 1000, 0), S), Verdict::Fine);
        assert!(matches!(pc.see(&at(Pressure::Warn, 1000, 2049), 2 * S), Verdict::Stop(_)), "elsewhere 2 GB of swap is already too much");
        assert_eq!(Watch::new(Budget::of(24576, false)).see(&at(Pressure::Normal, 1000, 9000), S), Verdict::Fine, "swap from before the run is not counted");
    }

    #[test]
    fn short_memory_is_told_once() {
        let mut w = Watch::new(Budget::of(16384, false));
        assert_eq!(w.see(&at(Pressure::Warn, 1000, 0), S), Verdict::Low);
        assert_eq!(w.see(&at(Pressure::Warn, 1000, 0), 2 * S), Verdict::Fine);
    }

    #[test]
    fn pressure_is_read_the_way_each_system_gives_it() {
        assert_eq!(by_free(8000, 3072), Pressure::Normal);
        assert_eq!(by_free(3000, 3072), Pressure::Warn);
        assert_eq!(by_free(1500, 3072), Pressure::Critical);
        assert_eq!(by_free(1500, 2048), Pressure::Warn, "never critical above 1 GB free");
        let psi = |full: &str| by_psi(&format!("some avg10=40.00 avg60=1.00 avg300=0.50 total=1\nfull avg10={full} avg60=0.10 avg300=0.00 total=2\n"));
        assert_eq!(psi("0.00"), Some(Pressure::Normal), "only the time when everything waited counts");
        assert_eq!(psi("12.50"), Some(Pressure::Warn));
        assert_eq!(psi("30.00"), Some(Pressure::Critical));
        assert_eq!(by_psi("garbage"), None);
        assert_eq!((by_level(1), by_level(2), by_level(4)), (Pressure::Normal, Pressure::Warn, Pressure::Critical));
    }

    #[test]
    fn an_engine_counts_with_what_it_started_and_nothing_else() {
        let parents = [(1, None), (10, Some(1)), (11, Some(10)), (12, Some(11)), (20, Some(1)), (21, Some(20))];
        let parent_of = |pid: Pid| parents.iter().find(|(p, _)| Pid::from_u32(*p) == pid).and_then(|(_, up)| up.map(Pid::from_u32));
        let mut got = tree(Pid::from_u32(10), parent_of, parents.iter().map(|(p, _)| Pid::from_u32(*p)));
        got.sort();
        assert_eq!(got, [10, 11, 12].map(Pid::from_u32));
    }

    #[test]
    fn this_computer_can_be_sampled() {
        let mut s = Sampler::new();
        let got = s.sample(std::process::id());
        assert!(got.free_mb > 0 && got.engine_mb > 0, "{got:?}");
        assert!(s.budget.room_mb > 0);
    }
}
