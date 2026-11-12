//! Search on Hugging Face, for the Models page. It only reads the public list; what can run is the
//! page's decision (`classify` in catalog.ts).

use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct Sibling {
    rfilename: String,
}

#[derive(Deserialize)]
struct Raw {
    id: String,
    #[serde(default)]
    downloads: u64,
    #[serde(default)]
    likes: u64,
    #[serde(default)]
    pipeline_tag: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    gated: serde_json::Value,
    #[serde(default)]
    siblings: Vec<Sibling>,
    #[serde(default, rename = "lastModified")]
    last_modified: String,
}

#[derive(Serialize)]
pub struct HfModel {
    pub id: String,
    pub downloads: u64,
    pub likes: u64,
    pub task: String,
    pub tags: Vec<String>,
    pub gated: bool,
    pub files: Vec<String>,
    /// When the repository last changed, as Hugging Face writes it; empty when it does not say
    pub updated: String,
}

fn parse(body: &str) -> Result<Vec<HfModel>, String> {
    let raw: Vec<Raw> = serde_json::from_str(body).map_err(|e| e.to_string())?;
    Ok(raw
        .into_iter()
        .map(|m| HfModel {
            id: m.id,
            downloads: m.downloads,
            likes: m.likes,
            task: m.pipeline_tag.unwrap_or_default(),
            tags: m.tags,
            gated: m.gated.as_bool().unwrap_or(m.gated.is_string()),
            files: m.siblings.into_iter().map(|s| s.rfilename).collect(),
            updated: m.last_modified,
        })
        .collect())
}

/// A README's first 200 KB is far more than a page shows; the rest is not fetched.
const README_MAX: usize = 200 << 10;

fn readme_text(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(&bytes[..bytes.len().min(README_MAX)]).into_owned();
    // a cut through a letter leaves a replacement character at the end
    text.trim_end_matches('\u{fffd}').to_string()
}

/// "owner/name" and nothing that could step elsewhere on the server
fn repo_ok(repo: &str) -> bool {
    let plain = |s: &str| !s.is_empty() && s != "." && s != ".." && s.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c));
    matches!(repo.split_once('/'), Some((owner, name)) if plain(owner) && plain(name))
}

/// The README of a repository, as Markdown. Empty when it has none.
pub fn readme(repo: &str) -> Result<String, String> {
    use std::io::Read;
    if !repo_ok(repo) {
        return Err("not a repository".into());
    }
    let agent = crate::download::agent();
    let mut last = String::new();
    for host in ["https://huggingface.co", "https://hf-mirror.com"] {
        match agent.get(format!("{host}/{repo}/raw/main/README.md")).call() {
            Ok(res) if res.status().is_success() => {
                let mut bytes = Vec::new();
                res.into_body().into_reader().take(README_MAX as u64).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
                return Ok(readme_text(&bytes));
            }
            Ok(res) if res.status().as_u16() == 404 => return Ok(String::new()),
            Ok(res) => last = format!("status {}", res.status()),
            Err(e) => last = e.to_string(),
        }
    }
    Err(last)
}

/// A file of a repository, with what it takes to fetch it safely.
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
pub struct HfFile {
    pub name: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Deserialize)]
struct TreeLfs {
    oid: String,
    size: u64,
}

#[derive(Deserialize)]
struct TreeItem {
    path: String,
    #[serde(default)]
    lfs: Option<TreeLfs>,
}

fn parse_tree(body: &str) -> Result<Vec<HfFile>, String> {
    let items: Vec<TreeItem> = serde_json::from_str(body).map_err(|e| e.to_string())?;
    Ok(items.into_iter().filter(|i| i.path.ends_with(".gguf")).filter_map(|i| i.lfs.map(|l| HfFile { name: i.path, size: l.size, sha256: l.oid })).collect())
}

/// The .gguf files of a repository, each with its size and hash.
pub fn files(repo: &str) -> Result<Vec<HfFile>, String> {
    let agent = crate::download::agent();
    let mut last = String::new();
    for host in ["https://huggingface.co", "https://hf-mirror.com"] {
        match agent.get(format!("{host}/api/models/{repo}/tree/main?recursive=true")).call() {
            Ok(mut res) if res.status().is_success() => return parse_tree(&res.body_mut().read_to_string().map_err(|e| e.to_string())?),
            Ok(res) => last = format!("status {}", res.status()),
            Err(e) => last = e.to_string(),
        }
    }
    Err(last)
}

/// `task` is a Hugging Face pipeline tag, or empty for all of them; "gguf" is everything in that format.
pub fn search(query: &str, task: &str) -> Result<Vec<HfModel>, String> {
    let agent = crate::download::agent();
    let mut last = String::new();
    for host in ["https://huggingface.co", "https://hf-mirror.com"] {
        let mut req = agent
            .get(format!("{host}/api/models"))
            .query("limit", "40")
            .query("sort", "downloads")
            .query("direction", "-1")
            .query("full", "true");
        if !query.is_empty() {
            req = req.query("search", query);
        }
        if task == "gguf" {
            req = req.query("filter", "gguf");
        } else if !task.is_empty() {
            req = req.query("pipeline_tag", task);
        }
        match req.call() {
            Ok(mut res) if res.status().is_success() => {
                let body = res.body_mut().read_to_string().map_err(|e| e.to_string())?;
                return parse(&body);
            }
            Ok(res) => last = format!("status {}", res.status()),
            Err(e) => last = e.to_string(),
        }
    }
    Err(last)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_public_list_is_read_with_gated_models_marked() {
        let body = r#"[
            {"id":"a/open","downloads":5,"likes":1,"pipeline_tag":"text-to-image","tags":["gguf"],
             "gated":false,"siblings":[{"rfilename":"model.gguf"}]},
            {"id":"b/closed","gated":"manual"}]"#;
        let got = parse(body).unwrap();
        assert_eq!((got[0].task.as_str(), got[0].gated, got[0].files.len()), ("text-to-image", false, 1));
        assert!(got[1].gated && got[1].files.is_empty());
    }

    #[test]
    fn a_listed_model_says_when_it_was_last_changed() {
        let got = parse(r#"[{"id":"a/b","lastModified":"2026-08-14T09:30:00.000Z"},{"id":"c/d"}]"#).unwrap();
        assert_eq!(got[0].updated, "2026-08-14T09:30:00.000Z");
        assert_eq!(got[1].updated, "");
    }

    #[test]
    fn a_readme_is_cut_to_what_a_page_shows_and_never_split_inside_a_letter() {
        // one byte, then two bytes a letter: the cut falls inside one
        let long = format!("a{}", "й".repeat(README_MAX));
        let cut = readme_text(long.as_bytes());
        assert!(cut.len() <= README_MAX && cut.starts_with('a') && cut[1..].chars().all(|c| c == 'й'));
        assert_eq!(readme_text(b"# Title\n"), "# Title\n");
    }

    #[test]
    fn only_a_plain_owner_and_name_make_a_readme_address() {
        assert!(repo_ok("google/gemma-4-e4b") && repo_ok("unsloth/Qwen3.6-27B-GGUF"));
        assert!(!repo_ok("../etc") && !repo_ok("a/b/c") && !repo_ok("a/..") && !repo_ok("a b/c") && !repo_ok("a/"));
    }

    #[test]
    fn a_repository_tree_gives_its_gguf_files_with_hashes() {
        let body = r#"[
            {"type":"file","path":"README.md","size":100},
            {"type":"file","path":"model-Q4.gguf","size":200,"lfs":{"oid":"abc","size":7000}},
            {"type":"directory","path":"sub"}]"#;
        assert_eq!(parse_tree(body).unwrap(), vec![HfFile { name: "model-Q4.gguf".into(), size: 7000, sha256: "abc".into() }]);
    }
}
