# @polyzon/mesh-kit

Print preparation for 3D meshes, in TypeScript: read a model, analyse it, plan explicit
operations in millimetres, apply them, and export STL / 3MF / GLB files that are read back
before they count as ready. Runs in Node and in Web Workers (no DOM). MIT.

Geometry is a plain triangle soup: a `Float32Array` of xyz triples, 9 floats per triangle,
counter-clockwise from outside, **millimetres, Z up**. Every function returns arrays that own
their buffers, so a worker can transfer them (`transferList`).

## Quick start

```ts
import { analyze, apply, exportModel, loadManifold, plan, readModel, STATUS_TEXT } from '@polyzon/mesh-kit';

const wasm = await loadManifold(); // in a bundled worker: loadManifold({ locateFile: () => wasmUrl })
const tris = await readModel('figure.glb', bytes, { glbUnit: 'm' }); // units are said, never guessed

const report = analyze(tris, { wasm, buildVolume: [256, 256, 256] });
STATUS_TEXT[report.status]; // 'has file/geometry errors' | 'needs a check before printing' | 'basic checks passed'

const ops = plan(report, { height: 80 }); // scale → repair (if needed) → place on bed
for (const op of ops) console.log(op.op, op.params, op.expected); // show the user before running

const { mesh, steps, report: after } = await apply(tris, ops, { wasm, signal });
const files = await exportModel(mesh, { formats: ['stl', '3mf', 'glb'], name: 'Figure' });
// files[i].ready === false → no bytes, `problems` says what the read-back found
```

## The pipeline

**original → `analyze` → choose the size → `plan` → `apply` → analysed again → `exportModel`.**

- `analyze(mesh, { wasm?, buildVolume? })` → size X/Y/Z (mm), vertices, faces, components (largest
  first, with centres), open edges and holes (with centres), non-manifold edges, flipped edges,
  degenerate faces, and `checks`: each `passed` / `warning` / `failed` / `not-checked`. A check
  that did not run is `not-checked`, never `passed`: the closed-solid check needs `wasm`, the fit
  check needs `buildVolume`, self-intersections and wall thickness have no algorithm yet. The
  `status` is `has-errors`, `needs-check` or `basic-passed` — there is no «will print».
- `plan(report, options)` → `Op[]`, each `{ op, version, params, units: 'mm', expected }`. Scale
  is always first, so every later length is in mm of the print. Defaults are non-destructive:
  repair only when the report has defects, and it lists every hole it will close; no flat cut,
  no remesh, no simplification, no parts removed or merged unless asked.
- `apply(mesh, ops, { wasm?, progress?, signal?, buildVolume? })` → `{ mesh, steps, report }`.
  Runs on a copy (the input is never changed), refuses an op of another algorithm version,
  checks `signal` between operations (a running WASM call is not interrupted — end the worker).

| Op | Params (mm) | What it does |
|---|---|---|
| `scale` | `{ height }` or `{ factor }` | About the origin. `factor: 1000` for a model in metres. |
| `repair` | `weldTolerance`, `nonManifold`, `orientation`, `fillHoles: 'all' \| 'none' \| centres[]` | Weld (tolerance = model diagonal × 10⁻⁶), drop degenerate and duplicate faces, part surfaces that touch (a solid manifold accepts keeps every face), cut out the non-manifold fans it refuses, make the winding agree and face outward, close the chosen holes. |
| `remesh` | `{ voxel }` | Rebuild the surface on a voxel grid (manifold `levelSet` over a hole-tolerant signed distance); reports the measured deviation in mm. Only on request. |
| `simplify` | `{ maxDeviation }` | meshoptimizer, then the deviation is measured; a tighter target or manifold's own simplification when it overshoots. A closed solid stays closed. |
| `flat-bottom` | `{ cut }` | Cut that much off the bottom of a closed solid. |
| `place-on-bed` | — | Stand on z = 0, centred on X and Y. |

Each op is also exported as a pure function (`scaleOp`, `repairOp`, `remeshOp`, `simplifyOp`,
`flatBottomOp`, `placeOnBedOp`): triangles in, `{ mesh, changes }` out.

`exportModel(meshOrParts, { formats, name, glbUnit })` writes STL (mm), 3MF in the plain profile
(geometry and millimetres, one object per part, no colours/materials/components) and GLB (metres
and Y up by default, `glbUnit: 'mm'` to keep mm), reads each one back and compares the object
count, triangles, size and open/non-manifold edges. `transferList(result)` gives the ArrayBuffers
for `postMessage`.

## Building blocks

| Module | Exports | From Studio (`PolyzonOrg/PolyzonStudio`, `origin/main` 7381cf3) |
|---|---|---|
| `analyze.ts` | `analyze`, `weldTolerance`, `STATUS_TEXT` | new |
| `ops.ts` | `plan`, `apply`, the ops, `OP_VERSIONS` | new |
| `export-files.ts` | `exportModel`, `transferList` | new |
| `mesh-repair.ts` | `repairMesh`, `toWorkMesh`, `fillHoles`, `orientConsistently`, `orientOutward`, `removeDegenerate`, `removeDuplicates`, `removeNonManifold`, `removeSmallShells` | `src/lib/tools/shared/mesh-repair.ts` |
| `mesh-triangulate.ts` | `earClip` | `src/lib/tools/shared/mesh-triangulate.ts` |
| `stl.ts` | `parseStl`, `writeStl`, `bounds`, `translate`, `placeOnBed`, `merge`, `meshStats` | `src/lib/tools/stl.ts` |
| `weld.ts` | `weld`, `unweld` | `src/lib/tools/weld.ts` |
| `mesh-import.ts` | `importMesh`, `parseObj`, `parse3mf`, `parse3mfObjects` | `src/lib/tools/shared/mesh-import.ts` |
| `model-file.ts` | `readModel`, `readGlb` | `src/lib/tools/shared/model-file.ts` |
| `glb.ts` | `glbMesh`, `writeGlb` | reader: `src/lib/server/glb-convert.ts`; writer new |
| `threemf.ts` | `model3mf`, `write3mf` (colour parts or `plain`) | `src/lib/tools/shared/threemf.ts` |
| `zip.ts`, `zip-read.ts` | `zipStore`, `crc32`, `unzip`, `zipEntries`, `zipRead` | `src/lib/tools/shared/zip.ts`, `shared/zip-read.ts` |
| `model-convert.ts` | `toMillimetres`, `writeObj`, `guessUnit`, `UNIT_MM` | `src/lib/tools/model-convert/model.ts` |
| `manifold.ts` | `loadManifold`, `manifoldOf`, `tryManifold`, `toManifold`, `fromManifold` | `src/lib/tools/manifold.ts`, `src/lib/tools/solid.ts` |
| `kit.ts`, `plane.ts`, `section.ts` | `Bin`, `prism`, `segments`; `planeAt`, `planeFrame`; `deepestPoint`, `spreadPoints` | `src/lib/tools/booleans/kit.ts`, `plane.ts`, `section.ts` |
| `sdf.ts` | `meshSdf`, `solidSdf`, `surfaceDeviation` | `meshSdf` from `src/lib/tools/booleans/sdf.ts`; the rest new |
| `remesh.ts` | `voxelRemesh`, `remeshSamples` | new |
| `hollow.ts` | `hollow`, `makeCavity`, `drainHole`, `makeBox`, `cavityEdge` | `src/lib/tools/stl-hollow/model.ts` + `hollow.worker.ts` |
| `cut.ts` | `cutPart`, connectors (`socketShape`, `dowelShape`, `pinsIn`, `allocatePins`) | `src/lib/tools/stl-slicer/model.ts` |
| `big-print-plan.ts`, `big-print.ts` | `planCuts`, `orientations`, `partsFor`; `bigPrint`, `bigPrintModel`, `printPose`, `PRINTERS` | `src/lib/tools/big-print/plan.ts`, `model.ts`, `big-print.worker.ts` (the auto cut plan for models bigger than the bed) |
| `mini-base.ts` | `miniBase`, `miniBaseLayout`, `MINI_BASE_PRESETS` | `src/lib/tools/mini-base/model.ts`, rebuilt on manifold-3d |
| `errors.ts` | `MeshKitError` with a `code` | replaces Studio's localised `ToolError` |

Hollow, cut, big-print and mini-base are functions on manifold solids; they are not plan
operations yet.

## Differences from Studio

- Errors are `MeshKitError` with a stable `code` and an English message; notes that were
  localised sentences are codes (`CutNote`, `HollowNote`, `SolidFixes`). The app translates.
- GLB is read without three.js, and its unit is given by the caller (Studio guessed metres from
  the size). A buffer by URI is refused, never fetched; ZIP unpacking is capped (1 GiB by default).
- `manifoldOf`/`toManifold` reject an inside-out (negative volume) solid so that repair runs.
- `fillHoles` takes an optional loop filter (close only chosen holes).
- 3MF and STL say `Polyzon mesh-kit` as the application by default (`write3mf(..., { application })`).

## Development

```bash
npm install
npm test
npx tsc --noEmit
npm run build
```

`tsconfig` uses `moduleResolution: Bundler`: manifold-3d's type files re-export without file
extensions, which `NodeNext` cannot follow. manifold-3d is pinned to 3.2.1, the version Studio
runs and its workarounds were written for.

Dependencies: [manifold-3d](https://github.com/elalish/manifold) (Apache-2.0) and
[meshoptimizer](https://github.com/zeux/meshoptimizer) (MIT). An app that bundles them ships
their license texts.
