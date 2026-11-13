//! Conversations with the assistant. One JSON file each under the data folder, like programs.

use crate::store::{self, Store};
use serde_json::{json, Value};
use std::{fs, path::PathBuf};

/// Pictures of builds are in here too.
const MAX_BYTES: usize = 16 << 20;

fn file(store: &Store, id: &str) -> Result<PathBuf, String> {
    store::safe_name(id)?;
    Ok(store.data().join("chats").join(format!("{id}.json")))
}

/// What a list shows of each, newest first: a chat is opened by itself, as it can hold many pictures. A
/// file that cannot be read is left alone, not shown.
pub fn list(store: &Store) -> Vec<Value> {
    let Ok(entries) = fs::read_dir(store.data().join("chats")) else { return vec![] };
    // the chats only, not a save on its way in
    let files = entries.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "json"));
    let chats = files.filter_map(|p| serde_json::from_slice::<Value>(&fs::read(p).ok()?).ok());
    let mut found: Vec<Value> = chats.map(|c| json!({ "id": c["id"], "title": c["title"], "updated": c["updated"] })).collect();
    found.sort_by_key(|c| std::cmp::Reverse(c["updated"].as_u64().unwrap_or(0)));
    found
}

pub fn read(store: &Store, id: &str) -> Result<Value, String> {
    serde_json::from_slice(&fs::read(file(store, id)?).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// A chat without an id is a new one.
pub fn save(store: &Store, mut chat: Value) -> Result<Value, String> {
    let id = match chat["id"].as_str().filter(|id| !id.is_empty()) {
        Some(id) => id.to_string(),
        None => store::random_id(),
    };
    chat["id"] = json!(id);
    let bytes = serde_json::to_vec(&chat).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err("TOO_LONG".into());
    }
    store::write_atomic(&file(store, &id)?, &bytes).map_err(|e| e.to_string())?;
    Ok(chat)
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

    fn store() -> Store {
        let d = std::env::temp_dir().join(format!("maker-chats-{}", store::random_id()));
        Store::open(d.join("c"), d.join("d")).unwrap()
    }

    #[test]
    fn a_chat_is_kept_and_comes_back_newest_first() {
        let s = store();
        let first = save(&s, json!({ "title": "куб", "updated": 1 })).unwrap();
        save(&s, json!({ "title": "шар", "updated": 2 })).unwrap();
        let chats = list(&s);
        assert_eq!(chats[0]["title"], "шар");
        assert_eq!(chats[1]["id"], first["id"]);
    }

    #[test]
    fn a_list_holds_names_and_a_chat_comes_whole_when_opened() {
        let s = store();
        let chat = save(&s, json!({ "title": "куб", "updated": 1, "lines": [{ "picture": "data:..." }] })).unwrap();
        assert!(list(&s)[0].get("lines").is_none());
        assert_eq!(read(&s, chat["id"].as_str().unwrap()).unwrap()["lines"][0]["picture"], "data:...");
        assert!(read(&s, "no-such-chat").is_err());
    }

    #[test]
    fn saving_again_replaces_it_and_delete_takes_it_away() {
        let s = store();
        let chat = save(&s, json!({ "title": "куб" })).unwrap();
        let id = chat["id"].as_str().unwrap();
        save(&s, json!({ "id": id, "title": "шар" })).unwrap();
        assert_eq!(list(&s).len(), 1);
        delete(&s, id).unwrap();
        assert!(list(&s).is_empty());
    }

    #[test]
    fn a_name_cannot_climb_out_of_the_folder() {
        assert!(save(&store(), json!({ "id": "../up" })).is_err());
    }
}
