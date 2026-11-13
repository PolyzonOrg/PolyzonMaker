//! Big files: carry on after a dropped line, check the hash, and only then give the file its name.

use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Seek, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
        mpsc, Mutex,
    },
    time::{Duration, Instant},
};

const ATTEMPTS: u32 = 5;
/// How often a waiting download looks up, and how long a silent line is given: a line lost to a
/// network that changed under it (a VPN coming on) sends nothing and says nothing.
const LOOK: Duration = Duration::from_millis(500);
const STALL: Duration = Duration::from_secs(30);
/// How often a download in pieces tells how far it is.
const TELL: Duration = Duration::from_millis(if cfg!(test) { 5 } else { 250 });
/// From this size a file comes in pieces over several lines at once: one line from far away is
/// slow, and some networks hold each line to a trickle (one line 1.8 MB/s, eight 10.1 MB/s).
const SPLIT_FROM: u64 = if cfg!(test) { 1 << 20 } else { 4 << 20 };
const LINES: usize = 8;
/// A piece's size, between these, so that every line has two to take. Each piece costs a request
/// and a redirect, about 0.7 s before its first byte, so pieces are not small.
const REAL_PIECES: (u64, u64) = (2 << 20, 32 << 20);
const PIECES: (u64, u64) = if cfg!(test) { (16 << 10, 64 << 10) } else { REAL_PIECES };

fn piece_size(total: u64, (smallest, largest): (u64, u64)) -> u64 {
    total.div_ceil(LINES as u64 * 2).clamp(smallest, largest)
}

/// Beside the part: its size, its piece size, then each piece that has landed.
fn pieces_of(part: &Path) -> PathBuf {
    let mut name = part.as_os_str().to_owned();
    name.push(".pieces");
    PathBuf::from(name)
}

/// Beside the part: the server's name for the version of the file the part is of (its strong ETag).
fn tag_of(part: &Path) -> PathBuf {
    let mut name = part.as_os_str().to_owned();
    name.push(".tag");
    PathBuf::from(name)
}

/// A part and everything kept beside it, gone: the next try starts the file afresh.
fn forget(part: &Path) {
    for path in [part.to_path_buf(), pieces_of(part), tag_of(part)] {
        let _ = fs::remove_file(path);
    }
}

type Answer = ureq::http::Response<ureq::Body>;

/// The version an answer is of, when the server names it for sure: a weak ETag («W/…») may stay
/// the same while bytes change.
fn tag(res: &Answer) -> Option<&str> {
    res.headers().get("etag")?.to_str().ok().filter(|t| !t.starts_with("W/"))
}

/// The whole file's size, from a range answer's «bytes 0-99/1000» or «bytes */1000».
fn total_of(res: &Answer) -> Option<u64> {
    res.headers().get("content-range")?.to_str().ok()?.rsplit_once('/')?.1.trim().parse().ok()
}

/// What a part is of: the version and the size the server gave when it began.
struct Version {
    tag: Option<String>,
    total: Option<u64>,
}

impl Version {
    fn of(part: &Path, total: Option<u64>) -> Self {
        Self { tag: fs::read_to_string(tag_of(part)).ok(), total }
    }

    /// Whether a range answer is of this same file. A server may hand out ranges of a newer file
    /// whatever If-Range says (Hugging Face's CDN does), so the answer itself is checked.
    fn holds(&self, res: &Answer) -> bool {
        let same_tag = self.tag.as_deref().zip(tag(res)).is_none_or(|(kept, now)| kept == now);
        let same_size = self.total.zip(total_of(res)).is_none_or(|(kept, now)| kept == now);
        same_tag && same_size
    }
}

/// The version a fresh answer starts the part as.
fn begin(part: &Path, res: &Answer) -> Result<(), Failure> {
    match tag(res) {
        Some(t) => fs::write(tag_of(part), t).map_err(disk),
        None => {
            let _ = fs::remove_file(tag_of(part));
            Ok(())
        }
    }
}

/// Waits `ms`, and less when `cancel` comes meanwhile.
fn nap(cancel: &AtomicBool, ms: u64) {
    let until = Instant::now() + Duration::from_millis(ms);
    while !cancel.load(Ordering::Relaxed) && Instant::now() < until {
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[derive(Debug)]
pub enum Failure {
    Cancelled,
    /// The server said no for good: 401, 403, 404
    Refused(u16),
    /// The file arrived, and it is not the one we asked for
    WrongHash,
    /// The file on the server is not the one the part was begun from: a newer version took its place
    Changed,
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
            Self::Changed => write!(f, "the file changed on the server"),
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

fn disk(e: io::Error) -> Failure {
    Failure::Disk(e.to_string())
}

/// Writes what `body` brings into `out` until it ends; `took` hears how much each time.
fn stream(body: impl Read + Send + 'static, out: &mut File, stop: &AtomicBool, took: &mut dyn FnMut(u64)) -> Result<(), Failure> {
    let chunks = chunks_of(body);
    let mut quiet = Duration::ZERO;
    loop {
        if stop.load(Ordering::Relaxed) {
            return Err(Failure::Cancelled);
        }
        match chunks.recv_timeout(LOOK) {
            Ok(chunk) => {
                let chunk = chunk.map_err(|e| Failure::Network(e.to_string()))?;
                quiet = Duration::ZERO;
                out.write_all(&chunk).map_err(disk)?;
                took(chunk.len() as u64);
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => return Ok(()),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                quiet += LOOK;
                if quiet >= STALL {
                    return Err(Failure::Network("the line went quiet".into()));
                }
            }
        }
    }
}

/// What a first answer brought: the whole file, or word that it is big enough to come in pieces.
enum Pulled {
    Whole,
    Split(u64),
}

/// One try over one line, from what is already in `part`. With `split`, a big file from a server that
/// gives ranges is left unread for `split` to fetch.
fn pull(agent: &ureq::Agent, url: &str, part: &Path, cancel: &AtomicBool, progress: &mut dyn FnMut(u64, u64)) -> Result<Pulled, Failure> {
    let have = fs::metadata(part).map_or(0, |m| m.len());
    let mut req = agent.get(url);
    if have > 0 {
        req = req.header("Range", format!("bytes={have}-"));
    }
    let res = req.call().map_err(|e| Failure::Network(e.to_string()))?;
    let code = res.status().as_u16();
    if code == 416 {
        // nothing left to send: the file is whole, unless the server's file is now another size
        return if Version::of(part, Some(have)).holds(&res) { Ok(Pulled::Whole) } else { Err(Failure::Changed) };
    }
    if matches!(code, 401 | 403 | 404 | 410) {
        return Err(Failure::Refused(code));
    }
    if !(200..300).contains(&code) {
        return Err(Failure::Network(format!("status {code}")));
    }
    let resumed = code == 206;
    if resumed && !Version::of(part, None).holds(&res) {
        return Err(Failure::Changed);
    }
    if !resumed {
        begin(part, &res)?;
    }
    let length = res.headers().get("content-length").and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<u64>().ok());
    let start = if resumed { have } else { 0 };
    let total = length.map_or(0, |l| l + start);
    // a server that answered a range with the whole file does not give ranges, whatever it says
    let ranges = resumed || (have == 0 && res.headers().get("accept-ranges").and_then(|v| v.to_str().ok()).is_some_and(|v| v.contains("bytes")));
    if ranges && total >= SPLIT_FROM {
        return Ok(Pulled::Split(total));
    }
    let mut out = OpenOptions::new().create(true).write(true).truncate(!resumed).open(part).map_err(disk)?;
    out.seek(io::SeekFrom::End(0)).map_err(disk)?;
    let mut done = start;
    stream(res.into_body().into_reader(), &mut out, cancel, &mut |n| {
        done += n;
        progress(done, total);
    })?;
    out.sync_all().map_err(disk)?;
    if total > 0 && done < total {
        return Err(Failure::Network("the line dropped".into()));
    }
    Ok(Pulled::Whole)
}

/// A file in pieces: its size, the size of a piece, and which pieces have landed.
struct Plan {
    total: u64,
    piece: u64,
    landed: Vec<bool>,
}

impl Plan {
    fn size(&self, i: usize) -> u64 {
        self.piece.min(self.total - i as u64 * self.piece)
    }
}

/// A new plan, kept beside the part. What one line brought before is the file's start: the
/// pieces it holds whole count as landed.
fn plan(part: &Path, total: u64) -> Result<Plan, Failure> {
    plan_in(part, total, piece_size(total, PIECES))
}

fn plan_in(part: &Path, total: u64, piece: u64) -> Result<Plan, Failure> {
    let have = fs::metadata(part).map_or(0, |m| m.len()).min(total);
    let count = total.div_ceil(piece) as usize;
    let landed: Vec<bool> = (0..count).map(|i| (i as u64 + 1) * piece <= have).collect();
    let lines: String = landed.iter().enumerate().filter(|(_, l)| **l).map(|(i, _)| format!("{i}\n")).collect();
    fs::write(pieces_of(part), format!("{total} {piece}\n{lines}")).map_err(disk)?;
    Ok(Plan { total, piece, landed })
}

/// The plan kept beside the part. A line cut off by a crash is not counted.
fn read_plan(part: &Path) -> Option<Plan> {
    let text = fs::read_to_string(pieces_of(part)).ok()?;
    let mut lines = text.split_inclusive('\n').filter(|l| l.ends_with('\n')).map(str::trim);
    let (total, piece) = lines.next()?.split_once(' ')?;
    let (total, piece): (u64, u64) = (total.parse().ok()?, piece.parse().ok()?);
    if piece == 0 || fs::metadata(part).ok()?.len() != total {
        return None;
    }
    let mut landed = vec![false; total.div_ceil(piece) as usize];
    for i in lines {
        *landed.get_mut(i.parse::<usize>().ok()?)? = true;
    }
    Some(Plan { total, piece, landed })
}

/// The missing pieces of `part`, LINES of them at a time, each into its place. A piece that lands is
/// written down beside the part, so that a later try asks only for the rest.
fn split(agent: &ureq::Agent, url: &str, part: &Path, plan: Plan, cancel: &AtomicBool, progress: &mut dyn FnMut(u64, u64)) -> Result<(), Failure> {
    let file = OpenOptions::new().create(true).write(true).truncate(false).open(part).map_err(disk)?;
    if file.metadata().map_err(disk)?.len() != plan.total {
        file.set_len(plan.total).map_err(disk)?;
    }
    drop(file);
    let todo: Vec<usize> = (0..plan.landed.len()).filter(|&i| !plan.landed[i]).collect();
    let done = AtomicU64::new((0..plan.landed.len()).filter(|&i| plan.landed[i]).map(|i| plan.size(i)).sum());
    let record = Mutex::new(OpenOptions::new().append(true).open(pieces_of(part)).map_err(disk)?);
    let (next, stop, failed) = (AtomicUsize::new(0), AtomicBool::new(false), Mutex::new(None));
    let working = AtomicUsize::new(LINES.min(todo.len()));
    let version = Version::of(part, Some(plan.total));
    std::thread::scope(|lines| {
        for _ in 0..working.load(Ordering::Relaxed) {
            lines.spawn(|| {
                while let Some(&i) = todo.get(next.fetch_add(1, Ordering::Relaxed)) {
                    let landed = piece(agent, url, part, (i as u64 * plan.piece, plan.size(i)), &version, &stop, &done)
                        .and_then(|()| writeln!(record.lock().unwrap(), "{i}").map_err(disk));
                    if let Err(e) = landed {
                        failed.lock().unwrap().get_or_insert(e);
                        stop.store(true, Ordering::Relaxed);
                        break;
                    }
                }
                working.fetch_sub(1, Ordering::Relaxed);
            });
        }
        while working.load(Ordering::Relaxed) > 0 {
            if cancel.load(Ordering::Relaxed) {
                stop.store(true, Ordering::Relaxed);
            }
            progress(done.load(Ordering::Relaxed), plan.total);
            std::thread::sleep(TELL);
        }
    });
    progress(done.load(Ordering::Relaxed), plan.total);
    match failed.into_inner().unwrap() {
        Some(e) => Err(e),
        None if cancel.load(Ordering::Relaxed) => Err(Failure::Cancelled),
        None => Ok(()),
    }
}

/// One piece of `len` bytes at `from`, carried on from where a dropped line left it.
fn piece(agent: &ureq::Agent, url: &str, part: &Path, (from, len): (u64, u64), version: &Version, stop: &AtomicBool, done: &AtomicU64) -> Result<(), Failure> {
    let mut out = OpenOptions::new().write(true).open(part).map_err(disk)?;
    let (mut got, mut last) = (0, Failure::Network("no answer".into()));
    for attempt in 0..ATTEMPTS {
        if attempt > 0 {
            nap(stop, 500 << attempt);
        }
        if stop.load(Ordering::Relaxed) {
            return Err(Failure::Cancelled);
        }
        let res = match agent.get(url).header("Range", format!("bytes={}-{}", from + got, from + len - 1)).call() {
            Ok(res) => res,
            Err(e) => {
                last = Failure::Network(e.to_string());
                continue;
            }
        };
        match res.status().as_u16() {
            206 if version.holds(&res) => {}
            // another file, or a shorter one that ends before this piece
            206 | 416 => return Err(Failure::Changed),
            code @ (401 | 403 | 404 | 410) => return Err(Failure::Refused(code)),
            code => {
                last = Failure::Network(format!("status {code} for a piece"));
                continue;
            }
        }
        out.seek(io::SeekFrom::Start(from + got)).map_err(disk)?;
        let body = res.into_body().into_reader().take(len - got);
        let streamed = stream(body, &mut out, stop, &mut |n| {
            got += n;
            done.fetch_add(n, Ordering::Relaxed);
        });
        match streamed {
            Ok(()) if got == len => return out.sync_data().map_err(disk),
            Ok(()) => last = Failure::Network("the line dropped".into()),
            Err(Failure::Network(e)) => last = Failure::Network(e),
            Err(other) => return Err(other),
        }
    }
    Err(last)
}

/// Gets the part over one line, or in pieces when it is big: a plan left beside it says it was.
fn pull_or_split(agent: &ureq::Agent, url: &str, part: &Path, cancel: &AtomicBool, progress: &mut dyn FnMut(u64, u64)) -> Result<(), Failure> {
    if let Some(plan) = read_plan(part) {
        return split(agent, url, part, plan, cancel, progress);
    }
    if pieces_of(part).exists() {
        forget(part); // a plan that cannot be read: which pieces are in the part is not known, so none are
    }
    match pull(agent, url, part, cancel, progress)? {
        Pulled::Whole => Ok(()),
        Pulled::Split(total) => split(agent, url, part, plan(part, total)?, cancel, progress),
    }
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
    let (mut last, mut restarted) = (Failure::Network("no source".into()), false);
    for url in urls {
        for attempt in 0..ATTEMPTS {
            if cancel.load(Ordering::Relaxed) {
                return Err(Failure::Cancelled);
            }
            match pull_or_split(agent, url, &part, cancel, progress) {
                Ok(()) => {
                    let _ = fs::remove_file(pieces_of(&part));
                    let _ = fs::remove_file(tag_of(&part));
                    if !sha256.is_empty() && sha256_of(&part).map_err(disk)? != sha256 {
                        fs::remove_file(&part).map_err(disk)?; // never kept: the next try starts clean
                        last = Failure::WrongHash;
                        break;
                    }
                    return fs::rename(&part, dest).map_err(disk);
                }
                // what came before is of the old file: start the new one from its first byte, once
                Err(Failure::Changed) if !restarted => {
                    forget(&part);
                    restarted = true;
                }
                Err(Failure::Changed) => {
                    forget(&part);
                    last = Failure::Network("the file kept changing on the server".into());
                    break;
                }
                Err(Failure::Network(e)) => {
                    last = Failure::Network(e);
                    if attempt + 1 < ATTEMPTS {
                        nap(cancel, 500 << attempt); // no wait after the last try: the next source is tried at once
                    }
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
    use std::{io::BufRead, net::TcpListener, sync::atomic::AtomicUsize, sync::Arc, thread};

    const BODY_LEN: usize = 300_000;

    fn body() -> Vec<u8> {
        (0..BODY_LEN).map(|i| (i % 251) as u8).collect()
    }

    fn sha(bytes: &[u8]) -> String {
        Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
    }

    /// What the test server saw: requests, the most lines open at once, and the ranges asked for.
    #[derive(Default)]
    struct Seen {
        hits: AtomicUsize,
        open: AtomicUsize,
        most: AtomicUsize,
        asked: std::sync::Mutex<Vec<(usize, usize)>>,
    }

    impl Seen {
        /// Bytes asked for by range since the list was last emptied.
        fn asked_bytes(&self) -> usize {
            self.asked.lock().unwrap().drain(..).map(|(from, to)| to + 1 - from).sum()
        }
    }

    /// A small HTTP server for the tests, a line each request. `cut`: request number `.0` gets only
    /// `.1` bytes of its answer. `ranges`: it answers a range with that range, as a CDN does.
    fn serve_body(body: Vec<u8>, cut: Option<(usize, usize)>, ranges: bool) -> (String, Arc<Seen>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/file.bin", listener.local_addr().unwrap());
        let seen = Arc::new(Seen::default());
        let (body, server) = (Arc::new(body), seen.clone());
        thread::spawn(move || {
            for (i, stream) in listener.incoming().enumerate() {
                let (mut stream, body, seen) = (stream.unwrap(), body.clone(), server.clone());
                thread::spawn(move || {
                    seen.hits.fetch_add(1, Ordering::SeqCst);
                    let open = seen.open.fetch_add(1, Ordering::SeqCst) + 1;
                    seen.most.fetch_max(open, Ordering::SeqCst);
                    let mut reader = io::BufReader::new(stream.try_clone().unwrap());
                    let mut range = None;
                    loop {
                        let mut line = String::new();
                        if reader.read_line(&mut line).unwrap_or(0) == 0 || line.trim().is_empty() {
                            break;
                        }
                        if let Some(r) = line.to_lowercase().strip_prefix("range: bytes=") {
                            let (from, to) = r.trim().split_once('-').unwrap();
                            let from: usize = from.parse().unwrap();
                            // only a piece names its end: the rest of a file from one line does not
                            if !to.is_empty() {
                                seen.asked.lock().unwrap().push((from, to.parse::<usize>().unwrap().min(body.len() - 1)));
                            }
                            let to = to.parse().map_or(body.len() - 1, |to: usize| to.min(body.len() - 1));
                            range = ranges.then_some((from, to));
                        }
                    }
                    let accept = if ranges { "Accept-Ranges: bytes\r\n" } else { "" };
                    let (head, part) = match range {
                        Some((from, to)) => {
                            (format!("HTTP/1.1 206 Partial Content\r\n{accept}Content-Range: bytes {from}-{to}/{}\r\nContent-Length: {}\r\n", body.len(), to + 1 - from), &body[from..=to])
                        }
                        None => (format!("HTTP/1.1 200 OK\r\n{accept}Content-Length: {}\r\n", body.len()), &body[..]),
                    };
                    let _ = stream.write_all(format!("{head}Connection: close\r\n\r\n").as_bytes());
                    // a moment before the body, so that lines asked for together are open together
                    thread::sleep(Duration::from_millis(20));
                    let send = match cut {
                        Some((n, bytes)) if n == i => bytes.min(part.len()),
                        _ => part.len(),
                    };
                    let _ = stream.write_all(&part[..send]);
                    seen.open.fetch_sub(1, Ordering::SeqCst);
                });
            }
        });
        (url, seen)
    }

    fn serve(cut: Option<usize>, ranges: bool) -> (String, Arc<Seen>) {
        serve_body(body(), cut.map(|bytes| (0, bytes)), ranges)
    }

    /// Big enough to come in pieces: not a whole number of them.
    fn big() -> Vec<u8> {
        (0..3 * SPLIT_FROM as usize + 12_345).map(|i| (i % 249) as u8).collect()
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
        assert_eq!(hits.hits.load(Ordering::SeqCst), 2, "the second request only asks for the rest");
    }

    #[test]
    fn a_big_file_comes_over_several_lines_at_once() {
        let (url, seen) = serve_body(big(), None, true);
        let dest = temp().join("file.bin");
        let mut last = (0, 0);
        fetch(&agent(), &[url], &dest, &sha(&big()), &AtomicBool::new(false), &mut |done, all| last = (done, all)).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), big());
        assert!(seen.most.load(Ordering::SeqCst) >= 2, "more than one line was open at a time");
        assert_eq!(seen.asked_bytes(), big().len(), "each byte was asked for once");
        assert_eq!(last, (big().len() as u64, big().len() as u64));
        assert!(!pieces_of(&part_of(&dest)).exists(), "nothing is left beside the file");
    }

    #[test]
    fn a_split_download_stopped_halfway_takes_up_where_it_stopped() {
        let (url, seen) = serve_body(big(), None, true);
        let dest = temp().join("file.bin");
        let cancel = AtomicBool::new(false);
        let half = big().len() as u64 / 2;
        let got = fetch(&agent(), std::slice::from_ref(&url), &dest, "", &cancel, &mut |done, _| {
            if done > half {
                cancel.store(true, Ordering::Relaxed);
            }
        });
        assert!(matches!(got, Err(Failure::Cancelled)));
        assert!(!dest.exists() && part_of(&dest).exists());
        seen.asked_bytes();
        fetch(&agent(), &[url], &dest, &sha(&big()), &AtomicBool::new(false), &mut |_, _| {}).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), big());
        assert!(seen.asked_bytes() < big().len() - half as usize / 2, "what had landed was not asked for again");
    }

    #[test]
    fn what_one_line_brought_before_counts_when_the_file_comes_in_pieces() {
        let (url, seen) = serve_body(big(), None, true);
        let dest = temp().join("file.bin");
        fs::create_dir_all(dest.parent().unwrap()).unwrap();
        // as an older version left it: the start of the file, from one line
        let had = big().len() / 2;
        fs::write(part_of(&dest), &big()[..had]).unwrap();
        fetch(&agent(), &[url], &dest, &sha(&big()), &AtomicBool::new(false), &mut |_, _| {}).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), big());
        assert!(seen.asked_bytes() <= big().len() - had + PIECES.1 as usize, "only the rest was asked for");
    }

    #[test]
    fn a_piece_whose_line_drops_is_asked_for_again_from_where_it_dropped() {
        let (url, _) = serve_body(big(), Some((2, 5_000)), true);
        let dest = temp().join("file.bin");
        fetch(&agent(), &[url], &dest, &sha(&big()), &AtomicBool::new(false), &mut |_, _| {}).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), big());
    }

    /// A server whose file can be replaced while the test runs, as a «resolve/main» link's is. It names each
    /// version by a strong ETag and, as Hugging Face's CDN does, answers a range whatever If-Range says.
    fn serve_versions(now: Arc<std::sync::Mutex<(Vec<u8>, String)>>) -> (String, Arc<Seen>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/file.bin", listener.local_addr().unwrap());
        let seen = Arc::new(Seen::default());
        let server = seen.clone();
        thread::spawn(move || {
            for stream in listener.incoming() {
                let (mut stream, now, seen) = (stream.unwrap(), now.clone(), server.clone());
                thread::spawn(move || {
                    let (body, tag) = now.lock().unwrap().clone();
                    let mut reader = io::BufReader::new(stream.try_clone().unwrap());
                    let mut range = None;
                    loop {
                        let mut line = String::new();
                        if reader.read_line(&mut line).unwrap_or(0) == 0 || line.trim().is_empty() {
                            break;
                        }
                        if let Some(r) = line.to_lowercase().strip_prefix("range: bytes=") {
                            let (from, to) = r.trim().split_once('-').unwrap();
                            range = Some((from.parse::<usize>().unwrap(), to.parse::<usize>().ok()));
                        }
                    }
                    let head = match range {
                        Some((from, _)) if from >= body.len() => format!("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{}\r\nContent-Length: 0\r\n", body.len()),
                        Some((from, to)) => {
                            let to = to.map_or(body.len() - 1, |t| t.min(body.len() - 1));
                            seen.asked.lock().unwrap().push((from, to));
                            let _ = stream.write_all(format!("HTTP/1.1 206 Partial Content\r\nAccept-Ranges: bytes\r\nETag: {tag}\r\nContent-Range: bytes {from}-{to}/{}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len(), to + 1 - from).as_bytes());
                            let _ = stream.write_all(&body[from..=to]);
                            return;
                        }
                        None => format!("HTTP/1.1 200 OK\r\nAccept-Ranges: bytes\r\nETag: {tag}\r\nContent-Length: {}\r\n", body.len()),
                    };
                    let _ = stream.write_all(format!("{head}Connection: close\r\n\r\n").as_bytes());
                    if head.starts_with("HTTP/1.1 200") {
                        let _ = stream.write_all(&body);
                    }
                });
            }
        });
        (url, seen)
    }

    /// Stops a fetch once `at` bytes have come, leaving its part (and its plan) behind.
    fn stopped_at(url: &str, dest: &Path, at: u64) {
        let cancel = AtomicBool::new(false);
        let got = fetch(&agent(), &[url.to_string()], dest, "", &cancel, &mut |done, _| {
            if done > at {
                cancel.store(true, Ordering::Relaxed);
            }
        });
        assert!(matches!(got, Err(Failure::Cancelled)) && part_of(dest).exists(), "the part stays for later");
    }

    #[test]
    fn a_part_of_a_file_since_replaced_is_not_carried_on_with_the_new_ones_bytes() {
        let now = Arc::new(std::sync::Mutex::new((Vec::new(), String::new())));
        let (url, _) = serve_versions(now.clone());
        let flip = |bytes: &[u8]| bytes.iter().map(|b| b ^ 0xff).collect::<Vec<u8>>();
        let small: Vec<u8> = (0..300_000).map(|i| (i % 253) as u8).collect();
        let shorter: Vec<u8> = (0..2 * SPLIT_FROM as usize + 777).map(|i| (i % 241) as u8).collect();
        // in pieces and over one line, a new file of the same size: only the server's name for it tells;
        // in pieces, a shorter one: pieces of the old plan lie past its end
        for (old, new) in [(big(), flip(&big())), (small.clone(), flip(&small)), (big(), shorter)] {
            *now.lock().unwrap() = (old.clone(), "\"old\"".into());
            let dest = temp().join("file.bin");
            stopped_at(&url, &dest, old.len() as u64 / 3);
            *now.lock().unwrap() = (new.clone(), "\"new\"".into());
            fetch(&agent(), std::slice::from_ref(&url), &dest, "", &AtomicBool::new(false), &mut |_, _| {}).unwrap();
            assert!(fs::read(&dest).unwrap() == new, "the new file whole, not the old one's start and the new one's end ({} bytes)", new.len());
            assert!(!tag_of(&part_of(&dest)).exists(), "nothing is left beside the file");
        }
    }

    #[test]
    fn a_part_of_the_same_file_still_goes_on_from_where_it_stopped() {
        let now = Arc::new(std::sync::Mutex::new((big(), "\"v1\"".to_string())));
        let (url, seen) = serve_versions(now);
        let dest = temp().join("file.bin");
        let half = big().len() as u64 / 2;
        stopped_at(&url, &dest, half);
        seen.asked_bytes();
        fetch(&agent(), &[url], &dest, &sha(&big()), &AtomicBool::new(false), &mut |_, _| {}).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), big());
        assert!(seen.asked_bytes() < big().len() - half as usize / 2, "what had landed was not asked for again");
    }

    #[test]
    fn a_download_cancelled_while_it_waits_to_try_again_stops_at_once() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/file.bin", listener.local_addr().unwrap());
        thread::spawn(move || {
            for stream in listener.incoming() {
                let mut stream = stream.unwrap();
                let (mut reader, mut line) = (io::BufReader::new(stream.try_clone().unwrap()), String::new());
                while reader.read_line(&mut line).unwrap_or(0) > 0 && line != "\r\n" {
                    line.clear();
                }
                let _ = stream.write_all(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            }
        });
        let cancel = Arc::new(AtomicBool::new(false));
        let stopper = cancel.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(700)); // during the second wait, 0.5 to 1.5 s
            stopper.store(true, Ordering::Relaxed);
        });
        let started = std::time::Instant::now();
        let got = fetch(&agent(), &[url], &temp().join("file.bin"), "", &cancel, &mut |_, _| {});
        assert!(matches!(got, Err(Failure::Cancelled)));
        assert!(started.elapsed() < Duration::from_millis(1300), "it stopped in the wait, not after it: {:?}", started.elapsed());
    }

    /// One real file over one line and then in pieces, timed: `cargo test -- --ignored --nocapture lines_timed`.
    #[test]
    #[ignore = "downloads from Hugging Face"]
    fn lines_timed() {
        let url = "https://huggingface.co/ilintar/trellis2-gguf/resolve/a57397bd3d351599d9729fc144b3f87c3f87d65b/q4/ss_dec.gguf";
        let total = 147_379_392;
        let dir = temp();
        fs::create_dir_all(&dir).unwrap();
        let (agent, stop, done) = (agent(), AtomicBool::new(false), AtomicU64::new(0));
        let one = dir.join("one.part");
        fs::File::create(&one).unwrap().set_len(total).unwrap();
        let t = std::time::Instant::now();
        piece(&agent, url, &one, (0, total), &Version { tag: None, total: None }, &stop, &done).unwrap();
        eprintln!("one line: {:.1} s", t.elapsed().as_secs_f64());
        let part = dir.join("split.part");
        let t = std::time::Instant::now();
        // in the pieces the program uses, not the tests' small ones
        split(&agent, url, &part, plan_in(&part, total, piece_size(total, REAL_PIECES)).unwrap(), &stop, &mut |_, _| {}).unwrap();
        eprintln!("in pieces: {:.1} s", t.elapsed().as_secs_f64());
        let t = std::time::Instant::now();
        let hash = sha256_of(&part).unwrap();
        eprintln!("hash: {:.1} s, {}", t.elapsed().as_secs_f64(), &hash[..8]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_split_file_with_the_wrong_hash_leaves_nothing_behind() {
        let (url, _) = serve_body(big(), None, true);
        let dest = temp().join("file.bin");
        let got = fetch(&agent(), &[url], &dest, &"0".repeat(64), &AtomicBool::new(false), &mut |_, _| {});
        assert!(matches!(got, Err(Failure::WrongHash)));
        assert!(!dest.exists() && !part_of(&dest).exists() && !pieces_of(&part_of(&dest)).exists());
    }

    #[test]
    fn a_big_file_from_a_server_without_ranges_still_comes_whole_over_one_line() {
        let (url, seen) = serve_body(big(), None, false);
        let dest = temp().join("file.bin");
        fetch(&agent(), &[url], &dest, &sha(&big()), &AtomicBool::new(false), &mut |_, _| {}).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), big());
        assert_eq!(seen.hits.load(Ordering::SeqCst), 1);
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
        let got = fetch(&agent(), std::slice::from_ref(&url), &dest, "", &cancel, &mut |done, _| {
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
