//! What this computer has, and a short test of what it can do. Names of devices only say what to
//! try: a package is proved by running it (TZ §8.1), so nothing here promises a model will work.

use crate::sys::quiet;
use serde::Serialize;
use std::{
    fs,
    hint::black_box,
    io::Write,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        OnceLock,
    },
    thread,
    time::{Duration, Instant},
};
use sysinfo::{Disks, System};

#[derive(Serialize, Clone, Default)]
pub struct Gpu {
    /// nvidia, amd, intel, apple or other
    pub vendor: String,
    pub name: String,
    /// 0 when the system does not say
    pub vram_mb: u64,
    pub driver: String,
    /// The CUDA version the driver offers, NVIDIA only
    pub cuda: f32,
}

#[derive(Serialize, Clone, Default)]
pub struct Hardware {
    pub os: &'static str,
    pub os_version: String,
    pub arch: &'static str,
    pub cpu: String,
    pub cores: usize,
    pub threads: usize,
    pub avx2: bool,
    pub ram_mb: u64,
    pub ram_free_mb: u64,
    /// None: no disk is known to hold the folder, as with a network share
    pub disk_free_gb: Option<u64>,
    pub gpus: Vec<Gpu>,
    pub webview: String,
}

pub fn detect(data_dir: &Path) -> Hardware {
    let mut s = System::new();
    s.refresh_memory();
    s.refresh_cpu_all();
    #[cfg(target_arch = "x86_64")]
    let avx2 = std::is_x86_feature_detected!("avx2");
    #[cfg(not(target_arch = "x86_64"))]
    let avx2 = false;
    Hardware {
        os: std::env::consts::OS,
        os_version: System::long_os_version().unwrap_or_default(),
        arch: std::env::consts::ARCH,
        cpu: s.cpus().first().map(|c| c.brand().trim().to_string()).unwrap_or_default(),
        cores: System::physical_core_count().unwrap_or(1),
        threads: s.cpus().len().max(1),
        avx2,
        ram_mb: total_mb(s.total_memory() >> 20),
        ram_free_mb: s.available_memory() >> 20,
        disk_free_gb: free_gb(data_dir),
        gpus: gpus(),
        webview: tauri::webview_version().unwrap_or_default(),
    }
}

/// The look at this computer made as the app starts: the window asks for it at once and the start's report
/// needs it too, and two looks side by side ran the driver tools twice. A later question looks again.
pub fn at_start(data_dir: &Path) -> Hardware {
    static FIRST: OnceLock<Hardware> = OnceLock::new();
    FIRST.get_or_init(|| detect(data_dir)).clone()
}

/// For a test of a smaller computer on a big one (tools/bench/ballast.py): POLYZON_RAM_MB=8192 makes a 24 GB
/// Mac count as an 8 GB one, in what it is offered and in how far an engine may go. Never more than it has.
pub fn total_mb(real_mb: u64) -> u64 {
    capped(real_mb, std::env::var("POLYZON_RAM_MB").ok().as_deref())
}

/// All the memory this computer has, whatever a test asks it to count.
pub fn real_total_mb() -> u64 {
    let mut s = System::new();
    s.refresh_memory();
    s.total_memory() >> 20
}

fn capped(real_mb: u64, asked: Option<&str>) -> u64 {
    asked.and_then(|v| v.trim().parse::<u64>().ok()).filter(|&v| v >= 1024).map_or(real_mb, |v| v.min(real_mb))
}

/// The share of this computer's memory the app counts with: below 1 only in such a test.
pub fn counted_share(real_mb: u64) -> f64 {
    if real_mb == 0 { 1.0 } else { total_mb(real_mb) as f64 / real_mb as f64 }
}

/// Free space on the disk that holds `path`: the mount with the longest matching prefix.
pub fn free_gb(path: &Path) -> Option<u64> {
    let disks = Disks::new_with_refreshed_list();
    let best = disks
        .list()
        .iter()
        .filter(|d| path.starts_with(d.mount_point()))
        .max_by_key(|d| d.mount_point().as_os_str().len());
    best.map(|d| d.available_space() >> 30)
}

fn vendor_of(name: &str) -> &'static str {
    let n = name.to_lowercase();
    if ["nvidia", "geforce", "quadro", "tesla"].iter().any(|k| n.contains(k)) {
        "nvidia"
    } else if ["amd", "radeon", "ati "].iter().any(|k| n.contains(k)) {
        "amd"
    } else if n.contains("intel") || n.contains(" arc ") {
        "intel"
    } else if n.contains("apple") {
        "apple"
    } else {
        "other"
    }
}

fn gpus() -> Vec<Gpu> {
    let mut list = nvidia();
    let told = !list.is_empty();
    for mut g in system_gpus() {
        // a virtual adapter is no use for computing, and the driver tool knows the NVIDIA cards better
        let n = g.name.to_lowercase();
        let virtual_one = ["basic", "remote", "virtual", "hyper-v", "parsec", "llvmpipe"].iter().any(|k| n.contains(k));
        if virtual_one || (g.vendor == "nvidia" && told) {
            continue;
        }
        // without the driver tool the driver's own number still says which CUDA it runs
        if g.vendor == "nvidia" {
            g.cuda = system_driver(&g.driver).map_or(0.0, |d| cuda_for_driver(&d));
        }
        list.push(g);
    }
    list
}

/// The driver tool: on the path, or where older Windows drivers put it.
fn nvidia_smi() -> String {
    #[cfg(target_os = "windows")]
    for (var, place) in [("SystemRoot", "System32\\nvidia-smi.exe"), ("ProgramFiles", "NVIDIA Corporation\\NVSMI\\nvidia-smi.exe")] {
        if let Some(path) = std::env::var_os(var).map(|base| Path::new(&base).join(place)).filter(|p| p.exists()) {
            return path.to_string_lossy().into_owned();
        }
    }
    "nvidia-smi".into()
}

/// The CUDA a driver of this version runs at least: NVIDIA's minimums, the stricter of Windows and Linux.
/// Used when the driver tool cannot be run or says it in words this code does not know.
fn cuda_for_driver(driver: &str) -> f32 {
    const TABLE: [(f32, f32); 11] = [(580.88, 13.0), (576.02, 12.9), (570.65, 12.8), (560.76, 12.6), (555.85, 12.5), (551.61, 12.4), (545.84, 12.3), (536.25, 12.2), (531.14, 12.1), (527.41, 12.0), (520.61, 11.8)];
    let mut parts = driver.trim().split('.');
    let major: f32 = parts.next().and_then(|m| m.parse().ok()).unwrap_or(0.0);
    let minor: f32 = parts.next().and_then(|m| m.parse().ok()).unwrap_or(0.0);
    let version = major + minor / 100.0;
    TABLE.iter().find(|(least, _)| version >= *least).map_or(0.0, |(_, cuda)| *cuda)
}

/// Windows names an NVIDIA driver 32.0.15.6109: the last five digits are the version, 561.09.
fn windows_driver(version: &str) -> Option<String> {
    let parts: Vec<&str> = version.split('.').collect();
    let digits: String = parts.get(2..)?.concat();
    (digits.len() >= 5 && digits.chars().all(|c| c.is_ascii_digit())).then(|| {
        let last = &digits[digits.len() - 5..];
        format!("{}.{}", &last[..3], &last[3..])
    })
}

/// Linux says it in /proc/driver/nvidia/version: "... Kernel Module  550.54.14  ...".
fn linux_driver(text: &str) -> Option<String> {
    text.split("Kernel Module").nth(1)?.split_whitespace().next().map(str::to_string)
}

fn system_driver(registry: &str) -> Option<String> {
    if cfg!(target_os = "linux") {
        fs::read_to_string("/proc/driver/nvidia/version").ok().as_deref().and_then(linux_driver)
    } else {
        windows_driver(registry)
    }
}

/// Graphics memory free right now on the emptiest NVIDIA card; None where the system cannot say.
pub fn gpu_free_mb() -> Option<u64> {
    let out = quiet(&nvidia_smi(), &["--query-gpu=memory.free", "--format=csv,noheader,nounits"])?;
    out.lines().filter_map(|l| l.trim().parse().ok()).max()
}

fn nvidia() -> Vec<Gpu> {
    let query = ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"];
    let Some(out) = quiet(&nvidia_smi(), &query) else { return vec![] };
    parse_nvidia(&out, cuda())
}

/// One card a line. A field the tool cannot fill, as "[N/A]" for memory on some laptops, leaves it unknown
/// and does not lose the card.
fn parse_nvidia(out: &str, cuda: f32) -> Vec<Gpu> {
    out.lines()
        .filter_map(|l| {
            let f: Vec<&str> = l.split(',').map(str::trim).collect();
            let name = f.first().filter(|n| !n.is_empty())?;
            Some(Gpu {
                vendor: "nvidia".into(),
                name: (*name).into(),
                vram_mb: f.get(1).and_then(|v| v.parse().ok()).unwrap_or(0),
                driver: f.get(2).copied().unwrap_or("").into(),
                cuda,
            })
        })
        .collect()
}

/// The CUDA version this machine's driver offers; 0 without an NVIDIA driver.
pub fn cuda() -> f32 {
    let smi = nvidia_smi();
    if let Some(found) = quiet(&smi, &[]).as_deref().and_then(cuda_version) {
        return found;
    }
    let driver = quiet(&smi, &["--query-gpu=driver_version", "--format=csv,noheader"]);
    driver.as_deref().and_then(|d| d.lines().next()).map_or(0.0, cuda_for_driver)
}

/// What the newest NVIDIA card here can run, 12.0 for an RTX 50; None when the driver cannot say.
pub fn compute_capability() -> Option<f32> {
    compute_capability_of(&quiet(&nvidia_smi(), &["--query-gpu=compute_cap", "--format=csv,noheader"])?)
}

fn compute_capability_of(out: &str) -> Option<f32> {
    out.lines().filter_map(|l| l.trim().parse::<f32>().ok()).reduce(f32::max)
}

/// From the banner or the long report. Drivers from 610 say "CUDA UMD Version", older ones "CUDA Version",
/// and the long report puts spaces before the colon.
fn cuda_version(text: &str) -> Option<f32> {
    ["CUDA UMD Version", "CUDA Version"].iter().find_map(|name| {
        let rest = text.split(name).nth(1)?.trim_start().strip_prefix(':')?;
        rest.split_whitespace().next()?.parse().ok()
    })
}

/// The display adapters' class in the registry: one numbered key (0000, 0001…) a driver.
#[cfg(target_os = "windows")]
const ADAPTERS: &str = r"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}";

/// The registry, because Win32_VideoController's memory field stops at 4 GB; read here and not through
/// PowerShell, which took 0.7-2.6 s to start each time, twice as the app started.
#[cfg(target_os = "windows")]
fn system_gpus() -> Vec<Gpu> {
    use winreg::{enums::HKEY_LOCAL_MACHINE, RegKey};
    let Ok(class) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(ADAPTERS) else { return vec![] };
    class
        .enum_keys()
        .flatten()
        .filter(|k| k.starts_with('0'))
        .filter_map(|k| class.open_subkey(k).ok())
        .filter_map(|key| {
            let name = key.get_value::<String, _>("DriverDesc").ok().filter(|n| !n.is_empty())?;
            let size = |value: &str| key.get_raw_value(value).map_or(0, |v| registry_number(&v.bytes));
            let memory = match size("HardwareInformation.qwMemorySize") {
                0 => size("HardwareInformation.MemorySize"),
                m => m,
            };
            Some(Gpu {
                vendor: vendor_of(&name).into(),
                vram_mb: memory >> 20,
                driver: key.get_value("DriverVersion").unwrap_or_default(),
                name,
                cuda: 0.0,
            })
        })
        .collect()
}

/// A size as drivers write it, little-endian: a QWORD (NVIDIA's qwMemorySize), a DWORD (Intel's MemorySize),
/// or the same four bytes as binary (AMD's). Fewer than four bytes are no size.
#[cfg(any(target_os = "windows", test))]
fn registry_number(bytes: &[u8]) -> u64 {
    if bytes.len() < 4 {
        return 0;
    }
    let mut wide = [0u8; 8];
    let n = bytes.len().min(8);
    wide[..n].copy_from_slice(&bytes[..n]);
    u64::from_le_bytes(wide)
}

/// Apple's chips: the graphics are the chip's own, named as it is ("Apple M4 Pro"), and the kernel says that at
/// once, where system_profiler took a second or more each look. An Intel Mac's cards still come from it.
#[cfg(target_os = "macos")]
fn system_gpus() -> Vec<Gpu> {
    let Some(name) = chip() else { return profiler_gpus() };
    let mut s = System::new();
    s.refresh_memory();
    // unified memory: the chip and the processor share it, so it is not a second budget
    vec![Gpu { vendor: "apple".into(), name, vram_mb: s.total_memory() >> 20, driver: String::new(), cuda: 0.0 }]
}

/// The chip's name, where it is Apple's
#[cfg(target_os = "macos")]
fn chip() -> Option<String> {
    extern "C" {
        fn sysctlbyname(name: *const std::ffi::c_char, old: *mut std::ffi::c_void, len: *mut usize, new: *mut std::ffi::c_void, new_len: usize) -> i32;
    }
    let (mut buf, mut len) = ([0u8; 128], 128usize);
    // SAFETY: writes at most `len` bytes into `buf` and says in `len` how many
    let read = unsafe { sysctlbyname(c"machdep.cpu.brand_string".as_ptr(), buf.as_mut_ptr().cast(), &mut len, std::ptr::null_mut(), 0) };
    let name = String::from_utf8_lossy(&buf[..len.min(buf.len())]).trim_end_matches('\0').trim().to_string();
    (read == 0 && name.starts_with("Apple")).then_some(name)
}

#[cfg(target_os = "macos")]
fn profiler_gpus() -> Vec<Gpu> {
    let Some(out) = quiet("system_profiler", &["SPDisplaysDataType", "-json"]) else { return vec![] };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&out) else { return vec![] };
    let mut s = System::new();
    s.refresh_memory();
    json["SPDisplaysDataType"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|g| {
            let name = g["sppci_model"].as_str()?;
            // unified memory: the chip and the processor share it, so it is not a second budget
            Some(Gpu {
                vendor: vendor_of(name).into(),
                name: name.into(),
                vram_mb: s.total_memory() >> 20,
                driver: String::new(),
                cuda: 0.0,
            })
        })
        .collect()
}

#[cfg(target_os = "linux")]
fn system_gpus() -> Vec<Gpu> {
    let names = quiet("lspci", &["-mm"]).unwrap_or_default();
    let Ok(cards) = fs::read_dir("/sys/class/drm") else { return vec![] };
    cards
        .flatten()
        .filter(|c| {
            let n = c.file_name().to_string_lossy().to_string();
            n.starts_with("card") && !n.contains('-')
        })
        .filter_map(|c| {
            let dev = c.path().join("device");
            let id = fs::read_to_string(dev.join("vendor")).ok()?;
            let vendor = match id.trim() {
                "0x10de" => "nvidia",
                "0x1002" => "amd",
                "0x8086" => "intel",
                _ => "other",
            };
            let vram = fs::read_to_string(dev.join("mem_info_vram_total")).ok().and_then(|v| v.trim().parse::<u64>().ok());
            let name = names
                .lines()
                .find(|l| l.contains("VGA") || l.contains("3D controller") || l.contains("Display"))
                .filter(|l| vendor_of(l) == vendor)
                .map_or_else(|| vendor.to_uppercase(), |l| l.split('"').nth(5).unwrap_or(l).to_string());
            Some(Gpu { vendor: vendor.into(), name, vram_mb: vram.unwrap_or(0) >> 20, driver: String::new(), cuda: 0.0 })
        })
        .collect()
}

// ---------------------------------------------------------------- the short test

#[derive(Serialize, Clone, Default)]
pub struct Measured {
    /// Work per second on one thread, then on all of them; only comparable with itself
    pub cpu_single: f64,
    pub cpu_multi: f64,
    pub memory_mbs: f64,
    pub disk_write_mbs: f64,
    pub disk_read_mbs: f64,
}

/// A float workload of the kind neural networks run: multiply and add over a small matrix.
fn crunch(stop: &AtomicBool) -> u64 {
    const N: usize = 48;
    let a: Vec<f32> = (0..N * N).map(|i| (i as f32 * 0.37).sin()).collect();
    let b: Vec<f32> = (0..N * N).map(|i| (i as f32 * 0.11).cos()).collect();
    let mut c = vec![0f32; N * N];
    let mut rounds = 0;
    while !stop.load(Ordering::Relaxed) {
        for i in 0..N {
            for k in 0..N {
                let v = a[i * N + k];
                for j in 0..N {
                    c[i * N + j] += v * b[k * N + j];
                }
            }
        }
        black_box(&mut c);
        rounds += 1;
    }
    rounds
}

fn cpu_score(threads: usize, seconds: f64) -> f64 {
    let stop = AtomicBool::new(false);
    let total: u64 = thread::scope(|s| {
        let workers: Vec<_> = (0..threads).map(|_| s.spawn(|| crunch(&stop))).collect();
        thread::sleep(Duration::from_secs_f64(seconds));
        stop.store(true, Ordering::Relaxed);
        workers.into_iter().map(|w| w.join().unwrap_or(0)).sum()
    });
    total as f64 / seconds
}

fn memory_speed() -> f64 {
    let mut from = vec![1u8; 256 << 20];
    let mut to = vec![0u8; 256 << 20];
    let t = Instant::now();
    let mut copied = 0usize;
    while t.elapsed().as_secs_f64() < 0.7 {
        to.copy_from_slice(&from);
        black_box(&mut to);
        from[copied % 256] ^= 1;
        copied += from.len();
    }
    (copied >> 20) as f64 / t.elapsed().as_secs_f64()
}

/// 128 MB through the real disk where the models will live, removed afterwards.
fn disk_speed(dir: &Path) -> std::io::Result<(f64, f64)> {
    fs::create_dir_all(dir)?;
    let path = dir.join("speed-check.tmp");
    let block = vec![0x5au8; 4 << 20];
    let t = Instant::now();
    let mut f = fs::File::create(&path)?;
    for _ in 0..32 {
        f.write_all(&block)?;
    }
    f.sync_all()?;
    drop(f);
    let write = 128.0 / t.elapsed().as_secs_f64();
    let t = Instant::now();
    black_box(fs::read(&path)?);
    let read = 128.0 / t.elapsed().as_secs_f64();
    fs::remove_file(&path)?;
    Ok((write, read))
}

/// About six seconds. `step` names what starts next, for the page.
pub fn measure(threads: usize, dir: &Path, step: impl Fn(&str)) -> Measured {
    step("cpu");
    let cpu_single = cpu_score(1, 1.5);
    let cpu_multi = cpu_score(threads, 2.0);
    step("memory");
    let memory_mbs = memory_speed();
    step("disk");
    let (disk_write_mbs, disk_read_mbs) = disk_speed(dir).unwrap_or((0.0, 0.0));
    Measured { cpu_single, cpu_multi, memory_mbs, disk_write_mbs, disk_read_mbs }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn an_apple_chip_gives_its_graphics_as_system_profiler_names_them_without_asking_it() {
        let Some(name) = chip() else {
            if cfg!(target_arch = "aarch64") {
                panic!("an Apple chip whose name the kernel did not give");
            }
            return;
        };
        assert_eq!(system_gpus().iter().map(|g| (g.vendor.as_str(), g.name.as_str())).collect::<Vec<_>>(), [("apple", name.as_str())]);
        let profiler: Vec<String> = profiler_gpus().into_iter().map(|g| g.name).collect();
        // a Mac in a virtual machine shows paravirtual graphics; on a real one they are the chip's
        if !profiler.iter().any(|n| n.contains("Paravirtual")) {
            assert_eq!(profiler, [name], "system_profiler named them otherwise");
        }
    }

    #[test]
    fn vendors_come_from_the_names_systems_really_report() {
        assert_eq!(vendor_of("NVIDIA GeForce RTX 5070 Ti"), "nvidia");
        assert_eq!(vendor_of("AMD Radeon(TM) Graphics"), "amd");
        assert_eq!(vendor_of("Intel(R) Arc(TM) A750 Graphics"), "intel");
        assert_eq!(vendor_of("Apple M3 Pro"), "apple");
        assert_eq!(vendor_of("Microsoft Basic Display Adapter"), "other");
    }

    #[test]
    fn a_cards_memory_is_read_as_each_driver_writes_it() {
        // NVIDIA: qwMemorySize, a QWORD past 4 GB (16 GB)
        assert_eq!(registry_number(&(16u64 << 30).to_le_bytes()) >> 20, 16384);
        // AMD: MemorySize as four bytes of binary (4 GB - 1, all it can hold); Intel: a DWORD (2 GB)
        assert_eq!(registry_number(&[0xff, 0xff, 0xff, 0xff]), u32::MAX as u64);
        assert_eq!(registry_number(&(2u32 << 30).to_le_bytes()) >> 20, 2048);
        // nothing written, or too little to be a size
        assert_eq!(registry_number(&[]), 0);
        assert_eq!(registry_number(&[1, 2]), 0);
    }

    #[test]
    fn the_cuda_version_is_read_from_the_driver_banner() {
        let banner = "| NVIDIA-SMI 610.88   Driver Version: 610.88   CUDA Version: 13.3     |";
        assert_eq!(cuda_version(banner), Some(13.3));
        assert_eq!(cuda_version("no such line"), None);
    }

    /// Word for word from the owner's RTX 5070 Ti, driver 610.88: the old words are gone from the banner.
    #[test]
    fn a_driver_that_says_umd_version_is_read_too() {
        let banner = "| NVIDIA-SMI 610.88                 KMD Version: 610.88        CUDA UMD Version: 13.3     |";
        assert_eq!(cuda_version(banner), Some(13.3));
        let query = "CUDA Version                                           : 13.3 [Deprecated; will be removed in CUDA 14.0. Use CUDA UMD Version instead]";
        assert_eq!(cuda_version(query), Some(13.3));
        assert_eq!(cuda_version("CUDA UMD Version                                       : 14.0"), Some(14.0));
    }

    #[test]
    fn a_driver_number_says_which_cuda_it_runs() {
        assert_eq!(cuda_for_driver("610.88"), 13.0);
        assert_eq!(cuda_for_driver("572.16"), 12.8);
        assert_eq!(cuda_for_driver("560.94"), 12.6);
        assert_eq!(cuda_for_driver("537.42"), 12.2);
        assert_eq!(cuda_for_driver("472.12"), 0.0);
        assert_eq!(cuda_for_driver(""), 0.0);
    }

    #[test]
    fn the_driver_is_found_without_the_driver_tool() {
        assert_eq!(windows_driver("32.0.15.6109").as_deref(), Some("561.09"));
        assert_eq!(windows_driver("31.0.15.3742").as_deref(), Some("537.42"));
        assert_eq!(windows_driver("27.21.14.5671").as_deref(), Some("456.71"));
        assert_eq!(windows_driver("odd"), None);
        let module = "NVRM version: NVIDIA UNIX x86_64 Kernel Module  550.54.14  Thu Feb 22 01:44:30 UTC 2024\nGCC version:  gcc version 12.2.0";
        assert_eq!(linux_driver(module).as_deref(), Some("550.54.14"));
        assert_eq!(linux_driver("nothing here"), None);
    }

    #[test]
    fn every_card_the_driver_tool_names_is_kept_even_without_its_memory() {
        let out = "NVIDIA GeForce RTX 4090, 24564, 610.88\nNVIDIA GeForce RTX 3060 Laptop GPU, [N/A], 610.88\n";
        let cards = parse_nvidia(out, 13.3);
        assert_eq!(cards.len(), 2);
        assert_eq!((cards[0].vram_mb, cards[1].vram_mb), (24564, 0));
        assert!(cards.iter().all(|c| c.vendor == "nvidia" && c.cuda == 13.3));
    }

    #[test]
    fn the_newest_card_decides_the_compute_capability() {
        assert_eq!(compute_capability_of("12.0\n8.6\n"), Some(12.0));
        assert_eq!(compute_capability_of("[N/A]\n"), None);
    }

    #[test]
    fn a_big_computer_counts_as_a_small_one_only_when_asked_and_never_as_a_bigger_one() {
        assert_eq!(capped(24576, Some("8192")), 8192);
        assert_eq!(capped(24576, None), 24576);
        assert_eq!(capped(8192, Some("65536")), 8192, "never more than it has");
        assert_eq!(capped(24576, Some("eight")), 24576);
        assert_eq!(capped(24576, Some("8")), 24576, "a slip of a unit, gigabytes for megabytes, is not a computer");
    }

    #[test]
    fn free_space_is_found_for_a_real_folder() {
        assert!(free_gb(&std::env::temp_dir()).is_some_and(|gb| gb > 0));
    }

    #[test]
    fn the_short_test_gives_numbers_and_leaves_no_file() {
        let dir = std::env::temp_dir().join(format!("maker-bench-{}", crate::store::random_id()));
        let m = measure(2, &dir, |_| {});
        assert!(m.cpu_single > 0.0 && m.cpu_multi >= m.cpu_single * 0.5 && m.memory_mbs > 0.0);
        assert!(m.disk_write_mbs > 0.0 && m.disk_read_mbs > 0.0);
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
    }
}
