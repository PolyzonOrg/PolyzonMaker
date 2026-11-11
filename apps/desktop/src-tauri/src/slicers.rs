//! Slicers on this computer, and handing them a file: the program and one path as a separate
//! argument, never a command line built from text (TZ §18.1). Polyzon Maker sends no G-code and starts no print.
//! They are recognised by name among what is installed, so a slicer Polyzon Maker has never heard of is found
//! too, wherever it was put.

use crate::sys;
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct Slicer {
    pub name: String,
    pub path: String,
    /// What it opens best: resin slicers take STL and not 3MF
    pub file: &'static str,
}

const WORDS: [&str; 18] = [
    "slicer", "slic3r", "cura", "bambu", "orca", "creality print", "chitubox", "lychee", "flashprint", "ideamaker",
    "simplify3d", "luban", "qidi", "photon workshop", "mattercontrol", "prusa", "anycubic", "elegoo",
];
const RESIN: [&str; 3] = ["chitubox", "lychee", "photon"];
/// Have the words in their names and are something else
const OTHERS: [&str; 7] = ["3d slicer", "image slicer", "pdf", "driver", "firmware", "wifi", "launcher"];

fn is_slicer(name: &str) -> bool {
    let name = name.to_lowercase();
    // the medical imaging program is called plain «Slicer 5.6»
    let plain = name == "slicer" || name.starts_with("slicer ");
    !plain && WORDS.iter().any(|w| name.contains(w)) && !OTHERS.iter().any(|w| name.contains(w))
}

/// «UltiMaker Cura 5.8.1» and «OrcaSlicer version 2.2 (x64)» without what changes between versions.
fn short(name: &str) -> String {
    let noise = |word: &str| {
        let w = word.trim_matches(['(', ')']).to_lowercase();
        let number = w.strip_prefix('v').unwrap_or(&w).starts_with(|c: char| c.is_ascii_digit());
        number || matches!(w.as_str(), "version" | "x64" | "x86" | "64-bit" | "32-bit")
    };
    let mut words: Vec<&str> = name.split_whitespace().collect();
    while words.len() > 1 && words.last().is_some_and(|w| noise(w)) {
        words.pop();
    }
    words.join(" ")
}

fn slicer(name: &str, path: String) -> Slicer {
    let lower = name.to_lowercase();
    let file = if RESIN.iter().any(|w| lower.contains(w)) { "print.stl" } else { "print.3mf" };
    Slicer { name: short(name), path, file }
}

/// One name once: two versions of a slicer are not two choices.
fn unique(found: Vec<Slicer>) -> Vec<Slicer> {
    let mut kept: Vec<Slicer> = vec![];
    for s in found {
        if !kept.iter().any(|k| k.name == s.name) {
            kept.push(s);
        }
    }
    kept
}

#[cfg_attr(not(any(windows, test)), allow(dead_code))]
fn is_program(path: &Path) -> bool {
    let name = path.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    name.ends_with(".exe") && !["unins", "uninstall", "update", "crash", "vc_redist", "helper"].iter().any(|w| name.contains(w))
}

/// The program in an installed folder: named after the slicer if one is, else the biggest.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
fn program_in(folder: &Path, name: &str) -> Option<PathBuf> {
    let first = name.split_whitespace().next().unwrap_or("").to_lowercase();
    let mut programs = vec![];
    let mut folders = vec![folder.to_path_buf()];
    for depth in 0..2 {
        for dir in std::mem::take(&mut folders) {
            for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
                let path = entry.path();
                if path.is_dir() && depth == 0 {
                    folders.push(path);
                } else if is_program(&path) {
                    programs.push(path);
                }
            }
        }
    }
    let named = |p: &&PathBuf| p.file_stem().is_some_and(|s| s.to_string_lossy().to_lowercase().contains(&first));
    let size = |p: &&PathBuf| fs::metadata(p).map_or(0, |m| m.len());
    programs.iter().find(named).or_else(|| programs.iter().max_by_key(size)).cloned()
}

/// What the system's list of programs says about one, as found in the registry.
#[cfg_attr(not(any(windows, test)), allow(dead_code))]
fn from_entry(name: &str, location: &str, icon: &str) -> Option<Slicer> {
    if !is_slicer(name) {
        return None;
    }
    let drawn = PathBuf::from(icon.trim_matches('"').split(',').next().unwrap_or("").trim_matches('"'));
    let program = if is_program(&drawn) && drawn.exists() { Some(drawn) } else { program_in(Path::new(location), name) };
    Some(slicer(name, program?.to_string_lossy().into_owned()))
}

#[cfg(target_os = "windows")]
fn installed() -> Vec<Slicer> {
    use winreg::{enums::*, RegKey};
    const LIST: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";
    const OLD_LIST: &str = r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall";
    let mut found = vec![];
    for (hive, list) in [(HKEY_LOCAL_MACHINE, LIST), (HKEY_LOCAL_MACHINE, OLD_LIST), (HKEY_CURRENT_USER, LIST)] {
        let Ok(list) = RegKey::predef(hive).open_subkey_with_flags(list, KEY_READ) else { continue };
        for program in list.enum_keys().flatten() {
            let Ok(key) = list.open_subkey(&program) else { continue };
            let Ok(name) = key.get_value::<String, _>("DisplayName") else { continue };
            let location: String = key.get_value("InstallLocation").unwrap_or_default();
            let icon: String = key.get_value("DisplayIcon").unwrap_or_default();
            found.extend(from_entry(&name, &location, &icon));
        }
    }
    // a portable copy or a folder its installer left out of the list
    for root in ["ProgramFiles", "ProgramFiles(x86)"].iter().filter_map(std::env::var_os) {
        for dir in fs::read_dir(root).into_iter().flatten().flatten() {
            let name = dir.file_name().to_string_lossy().into_owned();
            if is_slicer(&name) {
                if let Some(program) = program_in(&dir.path(), &name) {
                    found.push(slicer(&name, program.to_string_lossy().into_owned()));
                }
            }
        }
    }
    found
}

#[cfg(target_os = "macos")]
fn installed() -> Vec<Slicer> {
    let home = std::env::var_os("HOME").map(|h| Path::new(&h).join("Applications"));
    let mut found = vec![];
    for dir in std::iter::once(PathBuf::from("/Applications")).chain(home) {
        for app in fs::read_dir(dir).into_iter().flatten().flatten() {
            let path = app.path();
            let name = path.file_stem().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            if path.extension().is_some_and(|e| e == "app") && is_slicer(&name) {
                found.push(slicer(&name, path.to_string_lossy().into_owned()));
            }
        }
    }
    found
}

/// The command of a `.desktop` file without its placeholders.
#[cfg_attr(not(any(target_os = "linux", test)), allow(dead_code))]
fn from_desktop(text: &str) -> Option<Slicer> {
    let value = |key: &str| text.lines().find_map(|l| l.strip_prefix(key)).map(str::trim);
    let name = value("Name=")?;
    if !is_slicer(name) {
        return None;
    }
    let command: Vec<&str> = value("Exec=")?.split_whitespace().filter(|w| !w.starts_with('%')).collect();
    Some(slicer(name, command.join(" ").trim_matches('"').to_string()))
}

#[cfg(target_os = "linux")]
fn installed() -> Vec<Slicer> {
    let home = std::env::var_os("HOME").map(|h| Path::new(&h).join(".local/share/applications"));
    let places = ["/usr/share/applications", "/usr/local/share/applications", "/var/lib/flatpak/exports/share/applications"];
    let mut found = vec![];
    for dir in places.iter().map(PathBuf::from).chain(home) {
        for file in fs::read_dir(dir).into_iter().flatten().flatten() {
            if file.path().extension().is_some_and(|e| e == "desktop") {
                found.extend(fs::read_to_string(file.path()).ok().and_then(|t| from_desktop(&t)));
            }
        }
    }
    found
}

pub fn find() -> Vec<Slicer> {
    unique(installed())
}

pub fn open(chosen: &str, file: &Path) -> std::io::Result<()> {
    if !find().iter().any(|s| s.path == chosen) {
        return Err(std::io::Error::other("not a slicer found on this computer"));
    }
    #[cfg(target_os = "macos")]
    return sys::hidden("open").args(["-a", chosen]).arg(file).spawn().map(|_| ());
    #[cfg(target_os = "linux")]
    {
        // a flatpak or a launcher with arguments
        let mut words = chosen.split_whitespace();
        return sys::hidden(words.next().unwrap_or(chosen)).args(words).arg(file).spawn().map(|_| ());
    }
    #[cfg(target_os = "windows")]
    sys::hidden(chosen).arg(file).spawn().map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder() -> PathBuf {
        let root = std::env::temp_dir().join(format!("maker-sl-{}", crate::store::random_id()));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn slicers_are_known_by_name_even_ones_not_on_any_list() {
        for name in ["Bambu Studio", "UltiMaker Cura 5.8.1", "Anycubic Slicer Next", "ElegooSlicer", "CHITUBOX Basic", "Lychee Slicer", "Some New Slicer 1.0"] {
            assert!(is_slicer(name), "{name}");
        }
        for name in ["Slicer 5.6.2", "3D Slicer", "PDF Slicer", "NVIDIA Graphics Driver", "Google Chrome", "Anycubic Wifi Tool"] {
            assert!(!is_slicer(name), "{name}");
        }
    }

    #[test]
    fn a_name_loses_what_changes_between_versions() {
        assert_eq!(short("UltiMaker Cura 5.8.1"), "UltiMaker Cura");
        assert_eq!(short("OrcaSlicer version 2.2.0 (x64)"), "OrcaSlicer");
        assert_eq!(short("Bambu Studio"), "Bambu Studio");
        assert_eq!(short("Cura v4"), "Cura");
    }

    #[test]
    fn the_list_of_programs_gives_the_program_itself() {
        let root = folder();
        let exe = root.join("AnycubicSlicerNext.exe");
        fs::write(&exe, "x").unwrap();
        fs::write(root.join("unins000.exe"), "a much bigger file than the program").unwrap();
        let icon = format!("\"{}\",0", exe.display());
        let found = from_entry("Anycubic Slicer Next 1.3.0", "", &icon).unwrap();
        assert_eq!((found.name.as_str(), found.path.as_str()), ("Anycubic Slicer Next", exe.to_str().unwrap()));
        // no icon to go by: the folder decides, and an uninstaller is never the program
        let found = from_entry("Anycubic Slicer Next", root.to_str().unwrap(), "").unwrap();
        assert_eq!(found.path, exe.to_str().unwrap());
        assert!(from_entry("Google Chrome", root.to_str().unwrap(), &icon).is_none());
    }

    #[test]
    fn a_program_is_found_a_level_down_and_by_its_name_first() {
        let root = folder();
        fs::create_dir_all(root.join("bin")).unwrap();
        fs::write(root.join("bin").join("other-big-tool.exe"), "a bigger file").unwrap();
        fs::write(root.join("bin").join("Cura.exe"), "x").unwrap();
        assert!(program_in(&root, "UltiMaker Cura").is_some());
        assert!(program_in(&root, "Cura 5").unwrap().ends_with("Cura.exe"));
    }

    #[test]
    fn resin_slicers_get_an_stl() {
        assert_eq!(slicer("CHITUBOX Basic", "x".into()).file, "print.stl");
        assert_eq!(slicer("Bambu Studio", "x".into()).file, "print.3mf");
    }

    #[test]
    fn a_slicer_is_offered_once_whatever_the_number_of_versions() {
        let two = vec![slicer("Cura 5.8", "a".into()), slicer("Cura 4.13", "b".into()), slicer("Bambu Studio", "c".into())];
        assert_eq!(unique(two).len(), 2);
    }

    #[test]
    fn a_desktop_file_gives_the_command_without_its_placeholders() {
        let found = from_desktop("[Desktop Entry]\nName=PrusaSlicer\nExec=flatpak run com.prusa3d.PrusaSlicer %F\n").unwrap();
        assert_eq!((found.name.as_str(), found.path.as_str()), ("PrusaSlicer", "flatpak run com.prusa3d.PrusaSlicer"));
        assert!(from_desktop("Name=Firefox\nExec=firefox %u\n").is_none());
    }

    #[test]
    fn only_a_slicer_found_here_can_be_started() {
        assert!(open("C:/Windows/System32/cmd.exe", Path::new("x.stl")).is_err());
    }
}
