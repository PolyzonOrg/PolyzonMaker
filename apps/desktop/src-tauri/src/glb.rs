//! What a finished model is, read from the file. A generator can end without an error and leave a flat
//! plate, or an object between a floor and a wall. On the reference PC that was all 12 of the 233 results
//! that could not be printed, every one from TRELLIS.2, and another seed fixed those the picture did not
//! doom. Node transforms are left out: the measure below only asks whether surface lies in a plane.

use serde_json::Value;

/// From this share of the surface in one plane a model counts as a failed run. The measure and the number
/// are mesh-kit's `largestPlane` and `FLAT_PLATE`: good models reached 0.24, failed ones started at 0.35.
pub const FLAT_PLATE: f64 = 0.3;
const MIN_FACES: usize = 64;
const SLABS_PER_AXIS: usize = 34;

#[derive(Debug, Clone, Copy)]
pub struct Shape {
    pub faces: usize,
    pub flat: f64,
}

impl Shape {
    pub fn failed(self) -> bool {
        self.faces < MIN_FACES || self.flat >= FLAT_PLATE
    }

    pub fn better_than(self, other: Shape) -> bool {
        (!self.failed() && other.failed()) || (self.failed() == other.failed() && self.flat < other.flat)
    }
}

struct Part {
    points: Vec<[f32; 3]>,
    corners: Vec<u32>,
}

fn u32_at(bytes: &[u8], at: usize) -> Option<usize> {
    Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?) as usize)
}

/// The JSON and the binary chunk of a GLB.
fn chunks(bytes: &[u8]) -> Option<(&[u8], &[u8])> {
    if bytes.get(..4)? != b"glTF" {
        return None;
    }
    let json_length = u32_at(bytes, 12)?;
    let json = bytes.get(20..20 + json_length)?;
    let bin_start = 20 + json_length;
    let bin_length = u32_at(bytes, bin_start)?;
    Some((json, bytes.get(bin_start + 8..bin_start + 8 + bin_length)?))
}

/// Where an accessor's numbers lie: the first byte, the distance between items and how many there are.
fn items<'a>(doc: &Value, bin: &'a [u8], accessor: usize, size: usize) -> Option<(&'a [u8], usize, usize)> {
    let a = &doc["accessors"][accessor];
    let view = &doc["bufferViews"][a["bufferView"].as_u64()? as usize];
    // the file's numbers are outside data: a sum of them that does not fit is no file, not a wrap round to a
    // slice too short for what is read from it next
    let start = usize::try_from(view["byteOffset"].as_u64().unwrap_or(0)).ok()?.checked_add(usize::try_from(a["byteOffset"].as_u64().unwrap_or(0)).ok()?)?;
    let stride = usize::try_from(view["byteStride"].as_u64().unwrap_or(size as u64)).ok()?;
    let count = usize::try_from(a["count"].as_u64()?).ok()?;
    if count == 0 {
        return Some((&[], stride, 0));
    }
    let end = stride.checked_mul(count - 1)?.checked_add(size)?.checked_add(start)?;
    Some((bin.get(start..end)?, stride, count))
}

fn points_of(doc: &Value, bin: &[u8], accessor: usize) -> Option<Vec<[f32; 3]>> {
    if doc["accessors"][accessor]["componentType"].as_u64()? != 5126 {
        return None;
    }
    let (data, stride, count) = items(doc, bin, accessor, 12)?;
    let float = |at: usize| f32::from_le_bytes([data[at], data[at + 1], data[at + 2], data[at + 3]]);
    Some((0..count).map(|i| [float(i * stride), float(i * stride + 4), float(i * stride + 8)]).collect())
}

fn corners_of(doc: &Value, bin: &[u8], accessor: usize) -> Option<Vec<u32>> {
    let size = match doc["accessors"][accessor]["componentType"].as_u64()? {
        5121 => 1,
        5123 => 2,
        5125 => 4,
        _ => return None,
    };
    let (data, stride, count) = items(doc, bin, accessor, size)?;
    Some((0..count)
        .map(|i| {
            let at = i * stride;
            match size {
                1 => u32::from(data[at]),
                2 => u32::from(u16::from_le_bytes([data[at], data[at + 1]])),
                _ => u32::from_le_bytes([data[at], data[at + 1], data[at + 2], data[at + 3]]),
            }
        })
        .collect())
}

fn parts(doc: &Value, bin: &[u8]) -> Option<Vec<Part>> {
    let mut found = vec![];
    for mesh in doc["meshes"].as_array()? {
        for primitive in mesh["primitives"].as_array()? {
            if primitive["mode"].as_u64().unwrap_or(4) != 4 {
                continue;
            }
            let points = points_of(doc, bin, primitive["attributes"]["POSITION"].as_u64()? as usize)?;
            let corners = match primitive["indices"].as_u64() {
                Some(accessor) => corners_of(doc, bin, accessor as usize)?,
                None => (0..points.len() as u32).collect(),
            };
            found.push(Part { points, corners });
        }
    }
    Some(found)
}

/// How much of the surface lies in one axis-aligned plane; see mesh-kit's `largestPlane`.
fn measure(parts: &[Part]) -> Shape {
    let mut low = [f32::INFINITY; 3];
    let mut high = [f32::NEG_INFINITY; 3];
    for point in parts.iter().flat_map(|p| &p.points).filter(|p| p.iter().all(|v| v.is_finite())) {
        for axis in 0..3 {
            low[axis] = low[axis].min(point[axis]);
            high[axis] = high[axis].max(point[axis]);
        }
    }
    let span = (0..3).map(|axis| high[axis] - low[axis]).fold(0.0, f32::max);
    let slab = f64::from(span) / 32.0;
    let mut slabs = [0f64; 3 * SLABS_PER_AXIS];
    let (mut faces, mut total) = (0, 0f64);
    for part in parts {
        for corners in part.corners.as_chunks::<3>().0 {
            let at = |i: usize| part.points.get(corners[i] as usize).filter(|p| p.iter().all(|v| v.is_finite()));
            let (Some(a), Some(b), Some(c)) = (at(0), at(1), at(2)) else { continue };
            faces += 1;
            let u = [f64::from(b[0] - a[0]), f64::from(b[1] - a[1]), f64::from(b[2] - a[2])];
            let v = [f64::from(c[0] - a[0]), f64::from(c[1] - a[1]), f64::from(c[2] - a[2])];
            let normal = [(u[1] * v[2] - u[2] * v[1]).abs(), (u[2] * v[0] - u[0] * v[2]).abs(), (u[0] * v[1] - u[1] * v[0]).abs()];
            let area = normal.iter().map(|n| n * n).sum::<f64>().sqrt();
            total += area;
            let axis = (0..3).fold(0, |best, i| if normal[i] > normal[best] { i } else { best });
            if slab > 0.0 && normal[axis] >= 0.95 * area {
                let slot = (f64::from(a[axis] - low[axis]) / slab) as usize;
                slabs[axis * SLABS_PER_AXIS + slot.min(SLABS_PER_AXIS - 1)] += area;
            }
        }
    }
    let most = slabs.windows(2).map(|pair| pair[0] + pair[1]).fold(0.0, f64::max);
    Shape { faces, flat: if total > 0.0 { most / total } else { 0.0 } }
}

/// None: a file this code cannot read, such as compressed geometry. It proves nothing either way.
pub fn read(bytes: &[u8]) -> Option<Shape> {
    let (json, bin) = chunks(bytes)?;
    let doc: Value = serde_json::from_slice(json).ok()?;
    Some(measure(&parts(&doc, bin)?))
}

/// The same GLB with its scene under one more node that turns it by `turn` (rows). The mesh is left as
/// it is: every reader, mesh-kit's and three.js's among them, applies node matrices.
pub fn turned(bytes: &[u8], turn: &[[f32; 3]; 3]) -> Option<Vec<u8>> {
    let (json, bin) = chunks(bytes)?;
    let mut doc: Value = serde_json::from_slice(json).ok()?;
    let scene = doc["scene"].as_u64().unwrap_or(0) as usize;
    let roots = doc.get_mut("scenes")?.get_mut(scene)?.get_mut("nodes")?;
    let children = roots.take();
    let nodes = doc.get_mut("nodes")?.as_array_mut()?;
    let t = |row: usize, column: usize| turn[row][column];
    let matrix = [t(0, 0), t(1, 0), t(2, 0), 0.0, t(0, 1), t(1, 1), t(2, 1), 0.0, t(0, 2), t(1, 2), t(2, 2), 0.0, 0.0, 0.0, 0.0, 1.0];
    let root = nodes.len();
    nodes.push(serde_json::json!({ "children": children, "matrix": matrix }));
    doc["scenes"][scene]["nodes"] = serde_json::json!([root]);
    let mut json = serde_json::to_vec(&doc).ok()?;
    json.resize(json.len().div_ceil(4) * 4, b' ');
    let mut out = b"glTF".to_vec();
    out.extend(2u32.to_le_bytes());
    out.extend(u32::try_from(28 + json.len() + bin.len()).ok()?.to_le_bytes());
    out.extend(u32::try_from(json.len()).ok()?.to_le_bytes());
    out.extend(b"JSON");
    out.extend(json);
    out.extend(u32::try_from(bin.len()).ok()?.to_le_bytes());
    out.extend(b"BIN\0");
    out.extend(bin);
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A GLB of indexed triangles, as a generator writes one.
    fn glb(points: &[[f32; 3]], corners: &[u32]) -> Vec<u8> {
        let mut bin: Vec<u8> = points.iter().flatten().flat_map(|v| v.to_le_bytes()).collect();
        let points_length = bin.len();
        bin.extend(corners.iter().flat_map(|c| c.to_le_bytes()));
        let json = serde_json::json!({
            "asset": { "version": "2.0" },
            "scene": 0,
            "scenes": [{ "nodes": [0] }],
            "nodes": [{ "mesh": 0 }],
            "meshes": [{ "primitives": [{ "attributes": { "POSITION": 0 }, "indices": 1 }] }],
            "accessors": [
                { "bufferView": 0, "componentType": 5126, "count": points.len(), "type": "VEC3" },
                { "bufferView": 1, "componentType": 5125, "count": corners.len(), "type": "SCALAR" }
            ],
            "bufferViews": [
                { "buffer": 0, "byteOffset": 0, "byteLength": points_length },
                { "buffer": 0, "byteOffset": points_length, "byteLength": corners.len() * 4 }
            ]
        })
        .to_string();
        let mut json = json.into_bytes();
        json.resize(json.len().div_ceil(4) * 4, b' ');
        let mut out = b"glTF".to_vec();
        out.extend(2u32.to_le_bytes());
        out.extend(((28 + json.len() + bin.len()) as u32).to_le_bytes());
        out.extend((json.len() as u32).to_le_bytes());
        out.extend(b"JSON");
        out.extend(json);
        out.extend((bin.len() as u32).to_le_bytes());
        out.extend(b"BIN\0");
        out.extend(bin);
        out
    }

    /// A round lump: its surface faces every way.
    fn ball(rings: u32) -> (Vec<[f32; 3]>, Vec<u32>) {
        let (mut points, mut corners) = (vec![], vec![]);
        let at = |r: u32, s: u32| r * rings + s % rings;
        for r in 0..rings {
            let polar = (r as f32 + 0.5) / rings as f32 * std::f32::consts::PI;
            for s in 0..rings {
                let around = s as f32 / rings as f32 * std::f32::consts::TAU;
                points.push([polar.sin() * around.cos(), polar.sin() * around.sin(), polar.cos()]);
            }
        }
        for r in 0..rings - 1 {
            for s in 0..rings {
                corners.extend([at(r, s), at(r + 1, s), at(r, s + 1), at(r, s + 1), at(r + 1, s), at(r + 1, s + 1)]);
            }
        }
        (points, corners)
    }

    /// A sheet of `n` by `n` squares in the plane z = 0.
    fn sheet(n: u32, size: f32, first: u32) -> (Vec<[f32; 3]>, Vec<u32>) {
        let (mut points, mut corners) = (vec![], vec![]);
        for y in 0..=n {
            for x in 0..=n {
                points.push([(x as f32 / n as f32 - 0.5) * size, (y as f32 / n as f32 - 0.5) * size, -1.0]);
            }
        }
        let at = |x: u32, y: u32| first + y * (n + 1) + x;
        for y in 0..n {
            for x in 0..n {
                corners.extend([at(x, y), at(x + 1, y), at(x, y + 1), at(x, y + 1), at(x + 1, y), at(x + 1, y + 1)]);
            }
        }
        (points, corners)
    }

    #[test]
    fn a_file_whose_numbers_reach_past_its_end_is_no_shape_and_no_crash() {
        // a program's output, a plugin's say, is outside data: a stride this big wrapped round and panicked,
        // and with panic = "abort" the whole program closed
        let (points, corners) = ball(4);
        let good = glb(&points, &corners);
        let json_length = u32::from_le_bytes(good[12..16].try_into().unwrap()) as usize;
        let mut doc: serde_json::Value = serde_json::from_slice(&good[20..20 + json_length]).unwrap();
        doc["bufferViews"][0]["byteStride"] = serde_json::json!(1u64 << 62);
        let mut json = doc.to_string().into_bytes();
        json.resize(json.len().div_ceil(4) * 4, b' ');
        let bin = &good[20 + json_length..];
        let mut bad = b"glTF".to_vec();
        bad.extend(2u32.to_le_bytes());
        bad.extend(((20 + json.len() + bin.len()) as u32).to_le_bytes());
        bad.extend((json.len() as u32).to_le_bytes());
        bad.extend(b"JSON");
        bad.extend(json);
        bad.extend(bin);
        assert!(read(&bad).is_none());
    }

    #[test]
    fn a_round_object_passes() {
        let (points, corners) = ball(24);
        let shape = read(&glb(&points, &corners)).unwrap();
        assert!(!shape.failed(), "{shape:?}");
        assert_eq!(shape.faces, corners.len() / 3);
    }

    #[test]
    fn a_flat_plate_fails() {
        let (points, corners) = sheet(10, 2.0, 0);
        let shape = read(&glb(&points, &corners)).unwrap();
        assert!(shape.failed(), "{shape:?}");
        assert!(shape.flat > 0.9);
    }

    #[test]
    fn an_object_standing_on_a_floor_fails_as_the_plate_it_mostly_is() {
        let (mut points, mut corners) = ball(24);
        let (floor, cells) = sheet(10, 6.0, points.len() as u32);
        points.extend(floor);
        corners.extend(cells);
        assert!(read(&glb(&points, &corners)).unwrap().failed());
    }

    #[test]
    fn almost_nothing_fails() {
        let (points, corners) = ball(4);
        let shape = read(&glb(&points, &corners[..12])).unwrap();
        assert_eq!(shape.faces, 4);
        assert!(shape.failed());
    }

    #[test]
    fn the_better_of_two_runs_is_the_one_less_flat() {
        let plate = Shape { faces: 1000, flat: 0.99 };
        let cat = Shape { faces: 1000, flat: 0.35 };
        let good = Shape { faces: 1000, flat: 0.06 };
        assert!(cat.better_than(plate) && good.better_than(cat) && !plate.better_than(good));
    }

    #[test]
    fn a_turned_file_holds_the_same_mesh_under_a_node_that_turns_it() {
        let (points, corners) = ball(8);
        let before = glb(&points, &corners);
        // a quarter turn about x, not its own transpose: (x, y, z) becomes (x, -z, y)
        let after = turned(&before, &[[1.0, 0.0, 0.0], [0.0, 0.0, -1.0], [0.0, 1.0, 0.0]]).unwrap();
        let (json, bin) = chunks(&after).unwrap();
        assert_eq!(bin, chunks(&before).unwrap().1);
        let doc: Value = serde_json::from_slice(json).unwrap();
        assert_eq!(doc["scenes"][0]["nodes"], serde_json::json!([1]));
        assert_eq!(doc["nodes"][1]["children"], serde_json::json!([0]));
        let m: Vec<f64> = doc["nodes"][1]["matrix"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
        // glTF keeps a matrix by columns: +z, the third column, must land on -y
        assert_eq!(&m[8..11], &[0.0, -1.0, 0.0]);
        assert_eq!(m, [1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0]);
        assert_eq!(read(&after).unwrap().faces, corners.len() / 3);
        assert_eq!(u32_at(&after, 8), Some(after.len()), "the header's length is the file's");
        assert!(turned(b"glTF", &[[1.0, 0.0, 0.0]; 3]).is_none());
    }

    #[test]
    fn a_file_it_cannot_read_proves_nothing() {
        assert!(read(b"glTF").is_none());
        assert!(read(&[0u8; 64]).is_none());
        let (points, corners) = ball(8);
        let whole = glb(&points, &corners);
        assert!(read(&whole[..whole.len() / 2]).is_none(), "a cut file must not crash");
    }
}
