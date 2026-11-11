# Polyzon Maker

Generate 3D models from photos and words on your own computer, then get them ready to print.
Tauri 2 with the system WebView, Svelte 5, a small Rust core and `@polyzon/mesh-kit`.

- `src/` the interface. `lib/core.ts` is its only door to the computer; `lib/catalog.ts` decides what fits this machine.
- `src-tauri/src/` the core: `jobs.rs` the queue, `packs.rs` installing models, `download.rs` resuming downloads,
  `hardware.rs` the first-run check, `telemetry.rs` the reports people agreed to send, `glb.rs` the check of a finished model, `api.rs` the door for other programs.
- `src/cad/` the CAD page's language and scene; `GUIDE.md` is the language in one page, for people and models.
  `src/assistant/` the local assistant: it writes blocks, the app builds them and shows it the result.
- `src-tauri/catalog.json` the models Polyzon Maker installs, each file pinned by hash; times come from `tools/bench`.

**Work on the interface:** `npm install`, `npm run dev`, open http://localhost:5199. A plain browser uses the stand-in
core in `lib/mock.ts`: `?gpu=none` shows a machine without a graphics card, `?fail=GPU_OOM` a failed generation.

**Build the installer:** double-click `BUILD.cmd` on Windows, or `sh build.sh` on macOS and Linux. Rust and Node are
fetched and pinned; the result lands in `release/`.

**Checks:** `npm test`, `npm run check`, and `cargo test` in `src-tauri/`.

**Other programs:** Settings can turn on a local API, see [API.md](API.md).

**Release an update:** set `TAURI_SIGNING_PRIVATE_KEY` to the key's path and build on each system: this adds the signed
update files to `release/`. Linux and the unsigned Mac disk images can be built on GitHub instead
(`.github/workflows/linux.yml`, `mac.yml`, started by hand), and their update files signed afterwards with
`npx tauri signer sign`. `publish.py` sends them to `maker.polyzon.org` with the upload key and the server's address
in `MAKER_UPLOAD_KEY` and `MAKER_UPLOAD_HOST`, which the maintainers keep; then `downloads.json` for the site and
`latest.json` last, so that nobody sees a version before its files. A run for one system adds to what is live for that
version. On a Mac, `sh apps/desktop/release-mac.sh` does all of this for both chips. The update window shows the notes
given to it: `## Heading` lines, and `- item` lines under them. Installed copies accept only files signed with that key,
so a lost key means no more updates for them. The key never goes into this repository.

Nothing leaves the computer except downloads the person starts, anonymous reports they agreed to, and a look at
`latest.json` at startup. A new version then downloads by itself and goes in when the app closes. Settings can turn off
either step.
