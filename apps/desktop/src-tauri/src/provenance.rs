//! A generator's own files say that an AI made them, the way the IPTC standard asks (digital source type
//! «trainedAlgorithmicMedia», Photo Metadata 2025.1 for the AI system): a GLB gets a Khronos
//! KHR_xmp_json_ld packet, the program in `asset.generator` and mesh-kit's invisible mark in its
//! coordinates (each moves by one step of its last digit at most); a PNG gets an XMP packet in an iTXt
//! chunk, its pixels stay as they were. The print files get theirs from mesh-kit (provenance.ts). A file
//! this cannot read, or one already marked, is left alone.

use serde_json::{json, Value};
use std::{fs, path::Path};

pub const AI_SOURCE: &str = "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";
const IPTC_EXT: &str = "http://iptc.org/std/Iptc4xmpExt/2008-02-29/";
const XMP: &str = "http://ns.adobe.com/xap/1.0/";

pub struct Made {
    /// The AI model, e.g. «TRELLIS.2»
    pub system: String,
    /// The program and its version
    pub tool: String,
    /// ISO 8601
    pub created: String,
}

impl Made {
    pub fn now(system: &str) -> Self {
        Made { system: system.to_string(), tool: format!("Polyzon Maker {}", env!("CARGO_PKG_VERSION")), created: iso(crate::store::now()) }
    }
}

/// Marks a finished file in place. False: not a GLB or PNG it could read, or marked already.
pub fn mark(path: &Path, made: &Made) -> std::io::Result<bool> {
    let bytes = fs::read(path)?;
    let marked = match path.extension().and_then(|e| e.to_str()) {
        Some("glb") => glb(&bytes, made),
        Some("png") => png(&bytes, made),
        _ => None,
    };
    match marked {
        Some(out) => crate::store::write_atomic(path, &out).map(|()| true),
        None => Ok(false),
    }
}

fn u32_at(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

fn glb(bytes: &[u8], made: &Made) -> Option<Vec<u8>> {
    if u32_at(bytes, 0)? != 0x4654_6C67 || u32_at(bytes, 16)? != 0x4E4F_534A {
        return None;
    }
    let json_end = 20 + u32_at(bytes, 12)? as usize;
    let mut doc: Value = serde_json::from_slice(bytes.get(20..json_end)?).ok()?;
    let packets = doc.pointer("/extensions/KHR_xmp_json_ld/packets").and_then(Value::as_array).cloned().unwrap_or_default();
    if packets.iter().any(|p| p["Iptc4xmpExt:DigitalSourceType"].is_string()) {
        return None;
    }
    let packet = json!({
        "@context": { "Iptc4xmpExt": IPTC_EXT, "xmp": XMP },
        "@id": "",
        "Iptc4xmpExt:DigitalSourceType": AI_SOURCE,
        "Iptc4xmpExt:AISystemUsed": made.system,
        "xmp:CreatorTool": made.tool,
        "xmp:CreateDate": made.created
    });
    let index = packets.len();
    let root = doc.as_object_mut()?;
    let extensions = root.entry("extensions").or_insert_with(|| json!({})).as_object_mut()?;
    let xmp = extensions.entry("KHR_xmp_json_ld").or_insert_with(|| json!({ "packets": [] })).as_object_mut()?;
    xmp.entry("packets").or_insert_with(|| json!([])).as_array_mut()?.push(packet);
    let used = root.entry("extensionsUsed").or_insert_with(|| json!([])).as_array_mut()?;
    if !used.iter().any(|u| u == "KHR_xmp_json_ld") {
        used.push(json!("KHR_xmp_json_ld"));
    }
    let asset = root.entry("asset").or_insert_with(|| json!({ "version": "2.0" })).as_object_mut()?;
    asset.insert("generator".into(), json!(format!("{} ({})", made.tool, made.system)));
    let asset_extensions = asset.entry("extensions").or_insert_with(|| json!({})).as_object_mut()?;
    asset_extensions.insert("KHR_xmp_json_ld".into(), json!({ "packet": index }));

    let mut rest = bytes.get(json_end..)?.to_vec();
    if u32_at(&rest, 4) == Some(0x004E_4942) {
        let length = (u32_at(&rest, 0)? as usize).min(rest.len() - 8);
        mark_positions(&mut doc, &mut rest[8..8 + length]);
    }
    let mut text = serde_json::to_vec(&doc).ok()?;
    while text.len() % 4 != 0 {
        text.push(b' ');
    }
    let mut out = Vec::with_capacity(20 + text.len() + rest.len());
    out.extend_from_slice(&0x4654_6C67u32.to_le_bytes());
    out.extend_from_slice(&2u32.to_le_bytes());
    out.extend_from_slice(&((20 + text.len() + rest.len()) as u32).to_le_bytes());
    out.extend_from_slice(&(text.len() as u32).to_le_bytes());
    out.extend_from_slice(&0x4E4F_534Au32.to_le_bytes());
    out.extend_from_slice(&text);
    out.extend_from_slice(&rest);
    Some(out)
}

const SALT: u32 = 0x504d_4b31; // «PMK1»

/// mesh-kit's `markCoordinates` for one float32: its last bit set from a hash of the rest. Zeros,
/// infinities and NaN stay as they are.
fn marked(bits: u32) -> u32 {
    if bits & 0x7fff_ffff == 0 || bits & 0x7f80_0000 == 0x7f80_0000 {
        return bits;
    }
    let rest = bits & !1;
    let mut h = rest ^ SALT;
    h = (h ^ (h >> 16)).wrapping_mul(0x85eb_ca6b);
    h = (h ^ (h >> 13)).wrapping_mul(0xc2b2_ae35);
    rest | ((h ^ (h >> 16)) & 1)
}

/// The invisible mark in every float position of the binary chunk, and the bounds the file declares
/// written again from the marked numbers, as glTF asks. Compressed or sparse positions are left alone.
fn mark_positions(doc: &mut Value, bin: &mut [u8]) {
    let primitives = doc["meshes"].as_array().into_iter().flatten().flat_map(|m| m["primitives"].as_array().into_iter().flatten());
    let mut positions: Vec<usize> = primitives.filter_map(|p| p["attributes"]["POSITION"].as_u64()).map(|a| a as usize).collect();
    positions.sort_unstable();
    positions.dedup();
    for index in positions {
        let accessor = &doc["accessors"][index];
        let Some(view) = accessor["bufferView"].as_u64().map(|v| &doc["bufferViews"][v as usize]) else { continue };
        if accessor["componentType"] != 5126 || accessor["type"] != "VEC3" || !accessor["sparse"].is_null() || view["buffer"].as_u64().unwrap_or(0) != 0 {
            continue;
        }
        let at = |v: &Value| v.as_u64().unwrap_or(0) as usize;
        let start = at(&view["byteOffset"]) + at(&accessor["byteOffset"]);
        let stride = view["byteStride"].as_u64().map_or(12, |s| s as usize);
        let count = at(&accessor["count"]);
        if count == 0 || stride < 12 || start + (count - 1) * stride + 12 > bin.len() {
            continue;
        }
        let (mut low, mut high) = ([f32::INFINITY; 3], [f32::NEG_INFINITY; 3]);
        for point in 0..count {
            for axis in 0..3 {
                let word = &mut bin[start + point * stride + axis * 4..][..4];
                let value = f32::from_bits(marked(u32::from_le_bytes(word.try_into().unwrap())));
                word.copy_from_slice(&value.to_bits().to_le_bytes());
                low[axis] = low[axis].min(value);
                high[axis] = high[axis].max(value);
            }
        }
        if low.iter().chain(&high).all(|v| v.is_finite()) {
            doc["accessors"][index]["min"] = json!(low);
            doc["accessors"][index]["max"] = json!(high);
        }
    }
}

const PNG: &[u8] = b"\x89PNG\r\n\x1a\n";
const XMP_KEYWORD: &[u8] = b"XML:com.adobe.xmp";

fn png(bytes: &[u8], made: &Made) -> Option<Vec<u8>> {
    if !bytes.starts_with(PNG) || bytes.get(12..16)? != b"IHDR" {
        return None;
    }
    let after_header = 8 + 12 + u32::from_be_bytes(bytes.get(8..12)?.try_into().ok()?) as usize;
    if bytes.windows(XMP_KEYWORD.len()).any(|w| w == XMP_KEYWORD) {
        return None;
    }
    let esc = |s: &str| s.replace('&', "&amp;").replace('<', "&lt;").replace('"', "&quot;");
    let xmp = format!(
        "<?xpacket begin=\"\u{feff}\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?><x:xmpmeta xmlns:x=\"adobe:ns:meta/\"><rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\"><rdf:Description rdf:about=\"\" xmlns:Iptc4xmpExt=\"{IPTC_EXT}\" xmlns:xmp=\"{XMP}\" Iptc4xmpExt:DigitalSourceType=\"{AI_SOURCE}\" Iptc4xmpExt:AISystemUsed=\"{}\" xmp:CreatorTool=\"{}\" xmp:CreateDate=\"{}\"/></rdf:RDF></x:xmpmeta><?xpacket end=\"r\"?>",
        esc(&made.system),
        esc(&made.tool),
        esc(&made.created)
    );
    // keyword, no compression, no language, no translated keyword, then the text
    let mut data = XMP_KEYWORD.to_vec();
    data.extend_from_slice(&[0, 0, 0, 0, 0]);
    data.extend_from_slice(xmp.as_bytes());
    let mut chunk = (data.len() as u32).to_be_bytes().to_vec();
    let typed = [b"iTXt".as_slice(), &data].concat();
    chunk.extend_from_slice(&typed);
    chunk.extend_from_slice(&crc32(&typed).to_be_bytes());
    Some([bytes.get(..after_header)?, &chunk, bytes.get(after_header..)?].concat())
}

/// PNG's CRC-32 (ISO 3309), bit by bit: a picture is marked once.
fn crc32(data: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            crc = if crc & 1 != 0 { (crc >> 1) ^ 0xEDB8_8320 } else { crc >> 1 };
        }
    }
    !crc
}

/// Seconds since 1970 as an ISO 8601 UTC time (Howard Hinnant's civil-from-days).
pub fn iso(seconds: u64) -> String {
    let days = (seconds / 86_400) as i64;
    let rest = seconds % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z", rest / 3600, rest % 3600 / 60, rest % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn made() -> Made {
        Made { system: "TRELLIS.2".into(), tool: "Polyzon Maker 0.2.1".into(), created: "2026-11-08T12:00:00Z".into() }
    }

    /// A GLB with one triangle, as a generator writes it.
    // 0.7071 is a sample number whose marked bits are written out below, not 1/√2
    #[allow(clippy::approx_constant)]
    fn sample_glb() -> Vec<u8> {
        let doc = json!({
            "asset": { "version": "2.0", "generator": "trimesh" },
            "buffers": [{ "byteLength": 48 }],
            "meshes": [{ "primitives": [{ "attributes": { "POSITION": 0 }, "indices": 1 }] }],
            "accessors": [
                { "bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3" },
                { "bufferView": 1, "componentType": 5125, "count": 3, "type": "SCALAR" }
            ],
            "bufferViews": [{ "buffer": 0, "byteOffset": 0, "byteLength": 36 }, { "buffer": 0, "byteOffset": 36, "byteLength": 12 }]
        });
        let mut json = doc.to_string().into_bytes();
        while !json.len().is_multiple_of(4) {
            json.push(b' ');
        }
        let mut bin: Vec<u8> = [1.0f32, -2.5, 123.456, 0.001, 1e-30, 0.0, 0.7071, 2.0, 3.0].iter().flat_map(|v| v.to_le_bytes()).collect();
        bin.extend([0u32, 1, 2].iter().flat_map(|c| c.to_le_bytes()));
        let total = 12 + 8 + json.len() + 8 + bin.len();
        let mut out = Vec::new();
        for v in [0x4654_6C67u32, 2, total as u32, json.len() as u32, 0x4E4F_534A] {
            out.extend_from_slice(&v.to_le_bytes());
        }
        out.extend_from_slice(&json);
        out.extend_from_slice(&(bin.len() as u32).to_le_bytes());
        out.extend_from_slice(&0x004E_4942u32.to_le_bytes());
        out.extend_from_slice(&bin);
        out
    }

    #[test]
    fn a_generated_glb_says_an_ai_made_it_and_keeps_its_shape() {
        let before = sample_glb();
        let after = glb(&before, &made()).unwrap();
        assert_eq!(u32_at(&after, 8).unwrap() as usize, after.len());
        let json_end = 20 + u32_at(&after, 12).unwrap() as usize;
        assert_eq!(json_end % 4, 0);
        let doc: Value = serde_json::from_slice(&after[20..json_end]).unwrap();
        let packet = &doc["extensions"]["KHR_xmp_json_ld"]["packets"][doc["asset"]["extensions"]["KHR_xmp_json_ld"]["packet"].as_u64().unwrap() as usize];
        assert_eq!(packet["Iptc4xmpExt:DigitalSourceType"], AI_SOURCE);
        assert_eq!(packet["Iptc4xmpExt:AISystemUsed"], "TRELLIS.2");
        assert_eq!(packet["@context"]["Iptc4xmpExt"], IPTC_EXT);
        assert!(doc["extensionsUsed"].as_array().unwrap().iter().any(|u| u == "KHR_xmp_json_ld"));
        assert_eq!(doc["asset"]["generator"], "Polyzon Maker 0.2.1 (TRELLIS.2)");
        // the corners carry the same mark mesh-kit puts in (numbers from its markCoordinates), the indices
        // and the chunk stay, the bounds follow the marked numbers, and the file is still read as a model
        let bin = &after[json_end + 8..];
        let floats: Vec<u32> = bin[..36].as_chunks::<4>().0.iter().map(|w| u32::from_le_bytes(*w)).collect();
        assert_eq!(floats, [0x3f80_0001, 0xc020_0001, 0x42f6_e978, 0x3a83_126f, 0x0da2_4261, 0x0000_0000, 0x3f35_0480, 0x4000_0000, 0x4040_0000]);
        let old_bin = 20 + u32_at(&before, 12).unwrap() as usize;
        assert_eq!(&after[json_end..json_end + 8], &before[old_bin..old_bin + 8]);
        assert_eq!(&bin[36..], &before[old_bin + 8 + 36..]);
        let corner = |i: usize| f32::from_bits(floats[i]);
        let bound = |key: &str| doc["accessors"][0][key].as_array().unwrap().iter().map(|v| v.as_f64().unwrap() as f32).collect::<Vec<_>>();
        assert_eq!(bound("max"), [corner(0), corner(7), corner(2)]);
        assert_eq!(bound("min"), [corner(3), corner(1), corner(5)]);
        assert_eq!(crate::glb::read(&before).map(|s| s.faces), Some(1));
        assert_eq!(crate::glb::read(&after).map(|s| s.faces), Some(1));
        // once is enough
        assert!(glb(&after, &made()).is_none());
    }

    /// The smallest PNG: one white pixel.
    fn sample_png() -> Vec<u8> {
        let chunk = |kind: &[u8], data: &[u8]| {
            let typed = [kind, data].concat();
            [(data.len() as u32).to_be_bytes().as_slice(), &typed, &crc32(&typed).to_be_bytes()].concat()
        };
        let ihdr = [0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0];
        let idat = [0x78, 0x9c, 0x63, 0xf8, 0x0f, 0x00, 0x01, 0x01, 0x01, 0x00];
        [PNG, &chunk(b"IHDR", &ihdr), &chunk(b"IDAT", &idat), &chunk(b"IEND", &[])].concat()
    }

    #[test]
    fn a_generated_picture_carries_xmp_with_every_chunk_checksum_right() {
        let before = sample_png();
        let after = png(&before, &made()).unwrap();
        let text = String::from_utf8_lossy(&after);
        assert!(text.contains("Iptc4xmpExt:DigitalSourceType=\"http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia\""));
        assert!(text.contains("Iptc4xmpExt:AISystemUsed=\"TRELLIS.2\""));
        // walk the chunks: each length fits and each CRC is right, the iTXt right after IHDR
        let mut at = 8;
        let mut kinds = vec![];
        while at < after.len() {
            let len = u32::from_be_bytes(after[at..at + 4].try_into().unwrap()) as usize;
            let typed = &after[at + 4..at + 8 + len];
            assert_eq!(u32::from_be_bytes(after[at + 8 + len..at + 12 + len].try_into().unwrap()), crc32(typed));
            kinds.push(String::from_utf8_lossy(&typed[..4]).to_string());
            at += 12 + len;
        }
        assert_eq!(kinds, ["IHDR", "iTXt", "IDAT", "IEND"]);
        assert!(png(&after, &made()).is_none());
    }

    #[test]
    fn crc_and_dates_are_the_standard_ones() {
        assert_eq!(crc32(b"IEND"), 0xAE42_6082);
        assert_eq!(iso(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso(1_794_140_335), "2026-11-08T12:18:55Z");
        assert_eq!(iso(951_782_400), "2000-02-29T00:00:00Z");
    }

    #[test]
    fn anything_else_is_left_alone() {
        assert!(glb(b"not a model", &made()).is_none());
        assert!(png(b"not a picture", &made()).is_none());
    }
}
