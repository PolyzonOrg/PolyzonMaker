//! Programs the person keeps, OpenSCAD and CAD. One small JSON file each under the data folder: a program is
//! text, and a folder of files is easy to back up and hard to break.

use crate::store::{self, Store};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};

const MAX_BYTES: usize = 1 << 20;

#[derive(Clone, Serialize, Deserialize, PartialEq, Debug, Default)]
#[serde(default)]
pub struct Program {
    pub id: String,
    pub title: String,
    pub code: String,
    /// "" for OpenSCAD, "cad" for a CAD program.
    pub kind: String,
    pub updated: u64,
}

fn file(store: &Store, id: &str) -> Result<PathBuf, String> {
    store::safe_name(id)?;
    Ok(store.data().join("programs").join(format!("{id}.json")))
}

/// Newest first. A file that cannot be read is left alone, not shown.
pub fn list(store: &Store) -> Vec<Program> {
    let Ok(entries) = fs::read_dir(store.data().join("programs")) else { return vec![] };
    let mut found: Vec<Program> = entries.flatten().filter_map(|e| serde_json::from_slice(&fs::read(e.path()).ok()?).ok()).collect();
    found.sort_by(|a, b| b.updated.cmp(&a.updated).then_with(|| a.id.cmp(&b.id)));
    found
}

/// A program without an id is a new one.
pub fn save(store: &Store, mut program: Program) -> Result<Program, String> {
    if program.code.len() > MAX_BYTES {
        return Err("TOO_LONG".into());
    }
    if program.id.is_empty() {
        program.id = store::random_id();
    }
    program.updated = store::now();
    let bytes = serde_json::to_vec(&program).map_err(|e| e.to_string())?;
    store::write_atomic(&file(store, &program.id)?, &bytes).map_err(|e| e.to_string())?;
    Ok(program)
}

pub fn delete(store: &Store, id: &str) -> Result<(), String> {
    match fs::remove_file(file(store, id)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opened() -> Store {
        let d = std::env::temp_dir().join(format!("maker-pr-{}", store::random_id()));
        Store::open(d.join("c"), d.join("d")).unwrap()
    }

    #[test]
    fn a_program_is_kept_and_changed_in_place_and_goes_away() {
        let s = opened();
        assert!(list(&s).is_empty());
        let first = save(&s, Program { title: "Кружка".into(), code: "cube(1);".into(), ..Default::default() }).unwrap();
        assert!(!first.id.is_empty());
        let same = save(&s, Program { code: "cube(2);".into(), ..first.clone() }).unwrap();
        assert_eq!(same.id, first.id);
        assert_eq!(list(&s), vec![same.clone()]);
        delete(&s, &same.id).unwrap();
        assert!(list(&s).is_empty());
        delete(&s, &same.id).unwrap();
    }

    #[test]
    fn a_name_cannot_leave_the_folder_and_a_huge_text_is_refused() {
        let s = opened();
        let outside = Program { id: "../../evil".into(), code: "x".into(), ..Default::default() };
        assert!(save(&s, outside).is_err());
        assert!(delete(&s, "../../settings").is_err());
        let huge = Program { code: "x".repeat(MAX_BYTES + 1), ..Default::default() };
        assert_eq!(save(&s, huge).unwrap_err(), "TOO_LONG");
    }

    #[test]
    fn a_broken_file_does_not_hide_the_others() {
        let s = opened();
        let kept = save(&s, Program { code: "sphere(1);".into(), ..Default::default() }).unwrap();
        fs::write(s.data().join("programs/broken.json"), b"{ half").unwrap();
        assert_eq!(list(&s), vec![kept]);
    }
}
