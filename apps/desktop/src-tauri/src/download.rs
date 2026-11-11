//! Big files: carry on after a dropped line, check the hash, and only then give the file its name.

use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Seek, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::Duration,
};

const ATTEMPTS: u32 = 5;
/// How often a waiting download looks up, and how long a silent line is given.
const LOOK: Duration = Duration::from_millis(500);
const STALL: Duration = Duration::from_secs(60);

#[derive(Debug)]
pub enum Failure {
    Cancelled,
    /// The server said no for good: 401, 403, 404
    Refused(u16),
    /// The file arrived, and it is not the one we asked for
    WrongHash,
    Network(String),
    Disk(String),
    /// A package cannot be built or found for this computer: another try ends the same way
    Build(String),
    /// A plugin's program cannot run here: FENCE_MISSING or FENCE_OPEN (fence.rs)
    Fenced(&'static str),
}

impl std::fmt::Display for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            Self::Cancelled => write!(f, "cancelled"),
            Self::Refused(code) => write!(f, "the server refused: {code}"),
            Self::WrongHash => write!(f, "the file does not match its checksum"),
            Self::Network(e) => write!(f, "network: {e}"),
            Self::Disk(e) => write!(f, "disk: {e}"),
            Self::Build(e) => write!(f, "build: {e}"),
            Self::Fenced(code) => write!(f, "fence: {code}"),
        }
    }
}

pub fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(20)))
        .timeout_recv_response(Some(Duration::from_secs(30)))
        .timeout_recv_body(None)
        .user_agent(concat!("polyzon-maker/", env!("CARGO_PKG_VERSION")))
        .http_status_as_error(false)
        .tls_config(tls())
        .build()
        .into()
}

fn tls() -> ureq::tls::TlsConfig {
    let provider = if cfg!(target_os = "linux") { ureq::tls::TlsProvider::Rustls } else { ureq::tls::TlsProvider::NativeTls };
    ureq::tls::TlsConfig::builder().provider(provider).build()
}

fn part_of(dest: &Path) -> PathBuf {
    let mut name = dest.as_os_str().to_owned();
    name.push(".part");
    PathBuf::from(name)
}

fn sha256_of(path: &Path) -> io::Result<String> {
    let mut f = File::open(path)?;
    let mut hash = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hash.update(&buf[..n]);
    }
    Ok(hash.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// A read from a dead connection can wait for ever and cannot be interrupted, so it happens on its own
/// thread: whoever waits for the chunks can give up. The thread ends with the connection.
fn chunks_of(mut body: impl Read + Send + 'static) -> mpsc::Receiver<io::Result<Vec<u8>>> {
    let (send, chunks) = mpsc::sync_channel(4);
    std::thread::spawn(move || loop {
        let mut buf = vec![0u8; 256 << 10];
        match body.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                buf.truncate(n);
                if send.send(Ok(buf)).is_err() {
                    break;
                }
            }
            Err(e) => {
                let _ = send.send(Err(e));
                break;
            }
        }
    });
    chunks
}

/// One try: from what is already in `part`. Ok(total bytes).
fn pull(
    agent: &ureq::Agent,
    url: &str,
    part: &Path,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<u64, Failure> {
    let have = fs::metadata(part).map_or(0, |m| m.len());
    let mut req = agent.get(url);
    if have > 0 {
        req = req.header("Range", format!("bytes={have}-"));
    }
    let res = req.call().map_err(|e| Failure::Network(e.to_string()))?;
    let code = res.status().as_u16();
    if code == 416 {
        return Ok(have); // nothing left to send: the file is whole
    }
    if matches!(code, 401 | 403 | 404 | 410) {
        return Err(Failure::Refused(code));
    }
    if !(200..300).contains(&code) {
        return Err(Failure::Network(format!("status {code}")));
    }
    let resumed = code == 206;
    let length = res.headers().get("content-length").and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<u64>().ok());
    let start = if resumed { have } else { 0 };
    let total = length.map_or(0, |l| l + start);
    let disk = |e: io::Error| Failure::Disk(e.to_string());
    let mut out = OpenOptions::new().create(true).write(true).truncate(!resumed).open(part).map_err(disk)?;
    out.seek(io::SeekFrom::End(0)).map_err(disk)?;
    let chunks = chunks_of(res.into_body().into_reader());
    let mut done = start;
    let mut quiet = Duration::ZERO;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(Failure::Cancelled);
        }
        let chunk = match chunks.recv_timeout(LOOK) {
            Ok(chunk) => chunk.map_err(|e| Failure::Network(e.to_string()))?,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                quiet += LOOK;
                if quiet >= STALL {
                    return Err(Failure::Network("the line went quiet".into()));
                }
                continue;
            }
        };
        quiet = Duration::ZERO;
        out.write_all(&chunk).map_err(disk)?;
        done += chunk.len() as u64;
        progress(done, total);
    }
    out.sync_all().map_err(disk)?;
    if total > 0 && done < total {
        return Err(Failure::Network("the line dropped".into()));
    }
    Ok(done)
}

/// Gets `urls[0]`, or the next one when a source fails. A file already there with the right hash
/// is not fetched again. `progress` gets (done, total) bytes.
pub fn fetch(
    agent: &ureq::Agent,
    urls: &[String],
    dest: &Path,
    sha256: &str,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<(), Failure> {
    let disk = |e: io::Error| Failure::Disk(e.to_string());
    if dest.exists() {
        if sha256.is_empty() || sha256_of(dest).map_err(disk)? == sha256 {
            return Ok(());
        }
        fs::remove_file(dest).map_err(disk)?;
    }
    if let Some(dir) = dest.parent() {
        fs::create_dir_all(dir).map_err(disk)?;
    }
    let part = part_of(dest);
    let mut last = Failure::Network("no source".into());
    for url in urls {
        for attempt in 0..ATTEMPTS {
            if cancel.load(Ordering::Relaxed) {
                return Err(Failure::Cancelled);
            }
            match pull(agent, url, &part, cancel, progress) {
                Ok(_) => {
                    if !sha256.is_empty() && sha256_of(&part).map_err(disk)? != sha256 {
                        fs::remove_file(&part).map_err(disk)?; // never kept: the next try starts clean
                        last = Failure::WrongHash;
                        break;
                    }
                    return fs::rename(&part, dest).map_err(disk);
                }
                Err(Failure::Network(e)) => {
                    last = Failure::Network(e);
                    std::thread::sleep(Duration::from_millis(500 << attempt));
                }
                Err(Failure::Refused(c)) => {
                    last = Failure::Refused(c);
                    break;
                }
                Err(other) => return Err(other),
            }
        }
    }
    Err(last)
}

/// Unpacks a .zip, .tar.gz or .tgz. Entries that point outside `into` are refused (TZ §18.1).
pub fn unpack(archive: &Path, into: &Path) -> Result<(), String> {
    let name = archive.to_string_lossy().to_lowercase();
    fs::create_dir_all(into).map_err(|e| e.to_string())?;
    if name.ends_with(".zip") || name.ends_with(".whl") {
        let file = File::open(archive).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
        zip.extract(into).map_err(|e| e.to_string())
    } else {
        let file = File::open(archive).map_err(|e| e.to_string())?;
        let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(file));
        for entry in tar.entries().map_err(|e| e.to_string())? {
            let mut entry = entry.map_err(|e| e.to_string())?;
            if !entry.unpack_in(into).map_err(|e| e.to_string())? {
                return Err("an archive entry points outside its folder".into());
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::BufRead, net::TcpListener, sync::Arc, thread};

    const BODY_LEN: usize = 300_000;

    fn body() -> Vec<u8> {
        (0..BODY_LEN).map(|i| (i % 251) as u8).collect()
    }

    fn sha(bytes: &[u8]) -> String {
        Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
    }

    /// A small HTTP server for the tests. `cut`: it drops the line after that many bytes, once.
    fn serve(cut: Option<usize>, ranges: bool) -> (String, Arc<std::sync::atomic::AtomicUsize>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/file.bin", listener.local_addr().unwrap());
        let hits = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let seen = hits.clone();
        thread::spawn(move || {
            let body = body();
            for (i, stream) in listener.incoming().enumerate() {
                let mut stream = stream.unwrap();
                seen.fetch_add(1, Ordering::SeqCst);
                let mut reader = io::BufReader::new(stream.try_clone().unwrap());
                let mut from = 0;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 || line.trim().is_empty() {
                        break;
                    }
                    if let Some(r) = line.to_lowercase().strip_prefix("range: bytes=") {
                        if ranges {
                            from = r.trim().trim_end_matches('-').parse().unwrap();
                        }
                    }
                }
                let status = if from > 0 { "206 Partial Content" } else { "200 OK" };
                let rest = &body[from..];
                let head = format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", rest.len());
                let _ = stream.write_all(head.as_bytes());
                let send = if i == 0 { cut.unwrap_or(rest.len()) } else { rest.len() };
                let _ = stream.write_all(&rest[..send]);
            }
        });
        (url, hits)
    }

    fn temp() -> PathBuf {
        std::env::temp_dir().join(format!("maker-dl-{}", crate::store::random_id()))
    }

    #[test]
    fn a_dropped_line_carries_on_and_the_hash_is_checked() {
        let (url, hits) = serve(Some(100_000), true);
        let dest = temp().join("file.bin");
        fetch(&agent(), &[url], &dest, &sha(&body()), &AtomicBool::new(false), &mut |_, _| {}).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), body());
        assert_eq!(hits.load(Ordering::SeqCst), 2, "the second request only asks for the rest");
    }

    #[test]
    fn a_server_without_ranges_starts_over_and_still_gives_the_whole_file() {
        let (url, _) = serve(Some(100_000), false);
        let dest = temp().join("file.bin");
        fetch(&agent(), &[url], &dest, &sha(&body()), &AtomicBool::new(false), &mut |_, _| {}).unwrap();
        assert_eq!(fs::read(&dest).unwrap().len(), BODY_LEN);
    }

    #[test]
    fn a_file_with_the_wrong_hash_is_never_given_its_name() {
        let (url, _) = serve(None, true);
        let dest = temp().join("file.bin");
        let got = fetch(&agent(), &[url], &dest, &"0".repeat(64), &AtomicBool::new(false), &mut |_, _| {});
        assert!(matches!(got, Err(Failure::WrongHash)));
        assert!(!dest.exists() && !part_of(&dest).exists());
    }

    #[test]
    fn cancelling_stops_and_keeps_the_part_for_later() {
        let (url, _) = serve(None, true);
        let dest = temp().join("file.bin");
        let cancel = AtomicBool::new(false);
        let got = fetch(&agent(), &[url.clone()], &dest, "", &cancel, &mut |done, _| {
            if done > 1000 {
                cancel.store(true, Ordering::Relaxed);
            }
        });
        assert!(matches!(got, Err(Failure::Cancelled)));
        assert!(!dest.exists() && part_of(&dest).exists());
        fetch(&agent(), &[url], &dest, &sha(&body()), &AtomicBool::new(false), &mut |_, _| {}).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), body());
    }

    #[test]
    fn the_next_source_is_tried_when_the_first_one_is_down() {
        let (url, _) = serve(None, true);
        let dest = temp().join("file.bin");
        let dead = "http://127.0.0.1:9/file.bin".to_string();
        fetch(&agent(), &[dead, url], &dest, &sha(&body()), &AtomicBool::new(false), &mut |_, _| {}).unwrap();
        assert!(dest.exists());
    }

    #[test]
    fn an_archive_cannot_write_outside_its_folder() {
        let dir = temp();
        fs::create_dir_all(&dir).unwrap();
        let archive = dir.join("evil.zip");
        let mut zip = zip::ZipWriter::new(File::create(&archive).unwrap());
        let options: zip::write::SimpleFileOptions = Default::default();
        zip.start_file("../outside.txt", options).unwrap();
        zip.write_all(b"x").unwrap();
        zip.finish().unwrap();
        assert!(unpack(&archive, &dir.join("into")).is_err() || !dir.join("outside.txt").exists());
        assert!(!dir.join("outside.txt").exists());
    }
}
