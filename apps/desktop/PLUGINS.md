# Polyzon Maker plugins

A plugin can add a page, panels, commands, themes and AI models to the app. It is a `.zip` with
`plugin.json` at its root and whatever it brings. File names are plain ASCII with no spaces. A plugin can
hold up to 2000 files and 64 MB. Installing the same `id` again replaces the old version, and the person
is asked about its permissions again.

Three complete examples lie in `tools/`:

| Example | What it shows |
| --- | --- |
| `plugin-example` | A page, a panel on the model page and a command there |
| `plugin-theme-example` | A theme, and nothing else: a plugin of one file |
| `plugin-model-example` | An AI model: a vase turned from a picture's silhouette, in plain Python |

## How this compares with VS Code

VS Code extensions were the model for how open a plugin is, and not for how safe it is.

**What is the same:** a manifest declares what a plugin adds, and nothing runs to make it known. This is
VS Code's `contributes` with its contribution points.

**What is different:**

- **VS Code:** extensions run in a separate process, the extension host. That process is there for
  speed and stability: VS Code's own documentation says an extension can do anything VS Code can. What
  protects people is a question about trusting the publisher and a signed package from the Marketplace.
- **Polyzon Maker:** nothing a plugin brings runs with the app's rights.
  - Its pages run in sandboxed frames, as Figma's plugin interface does, and can only ask the app's page.
  - Its models' programs run in a fence the operating system enforces.
  - Each permission is listed in plain words before the plugin is installed.

## plugin.json

```json
{
	"id": "coaster",
	"name": "Coaster",
	"version": "1.1.0",
	"author": "You",
	"description": "One or two sentences, shown before installing.",
	"permissions": ["jobs.read", "library.add"],
	"contributes": {
		"panels": [{ "id": "base", "title": "Coaster", "file": "panel.html", "where": "result", "height": 120 }],
		"commands": [{ "id": "fit", "title": "Coaster for this model", "where": "result" }],
		"themes": [],
		"models": []
	}
}
```

**The manifest's own fields:**

- `id`: lowercase letters, digits and dashes.
- `version`: digits and dots.
- `name`: up to 60 characters. `description`: up to 300.

**Contributions:**

- Every contribution has an `id` of lowercase letters, digits and dashes, unique within its kind, and a
  `title` of up to 60 characters.
- A plugin brings up to 10 of each kind.
- An unknown kind under `contributes` is refused, not ignored. A newer plugin then says plainly that this
  version of the app cannot take it.

When the manifest is wrong, the person sees that the plugin was not installed, along with which part
failed and why, for the plugin's author.

## What a plugin can add

| Contribution | Where it appears |
| --- | --- |
| A page (`index.html`) | «Open» on the plugin's card in Plugins |
| `panels`, `"where": "result"` | A frame of the given `height` (120 to 720) on the page of a finished model, under its title |
| `commands`, `"where": "result"` | A button on the page of a finished model |
| `commands`, `"where": "app"` | A button on the plugin's card |
| `themes` | Settings → «Plugin theme» |
| `models` | Models, among the 3D models |

### Pages and panels

A page and a panel are HTML files of the plugin. Each talks to the app through `maker.js`, which the app
provides:

```html
<script src="maker.js"></script>
<script>
	const job = await maker.library.add('Coaster', stlBytes);
	await maker.open(job.id);
</script>
```

### Commands

A command is carried out by the plugin's page, so a plugin with commands needs an `index.html`. Running
a command opens the page and tells it which command ran, and on which model:

```js
maker.on('command', ({ command, job }) => {
	// `job` is the model's id when the command ran on a model's page
});
```

A panel hears where it is, at first and each time the page shows another model:

```js
maker.on('context', ({ page, job }) => show(job));
```

What happened before the page listened is handed over once, to its first listener for that name.

### Themes

A theme only colours: there is no CSS and no code in it.

- `base` is `light` or `dark`.
- `colors` sets any of the app's colour tokens: `--bg`, `--chrome`, `--surface`, `--surface-2`,
  `--surface-3`, `--surface-4`, `--button`, `--button-hover`, `--ink`, `--ink-muted`, `--ink-faint`,
  `--line`, `--on-ink`, `--good`, `--warn`, `--bad`, `--viewer`, `--tip-bg`, `--tip-ink`, `--tip-line`,
  `--tip-key`.
- Each value is `#rgb`, `#rrggbb` or `#rrggbbaa`. The app checks them at install, and again when it sets them.
- What a theme leaves out comes from its base.
- When the plugin is turned off or removed, the app follows the system's light or dark again.

## What a page and a panel can call

| Call | Permission | What it does |
| --- | --- | --- |
| `maker.info()` | | App version, language and theme, so the page can match |
| `maker.context()` | | Where the frame is: `{ page }`, and `{ page: 'result', job }` for a panel |
| `maker.on(name, fn)` | | `command` and `context`, above |
| `maker.open(id)` | | Shows a job in the app |
| `maker.jobs.list()` | `jobs.read` | Jobs: `id`, `title`, `kind`, `state`, `created` |
| `maker.jobs.file(id, name)` | `jobs.read` | `model.glb`, `picture.png`, `print.stl` or `print.3mf`, as an `ArrayBuffer` |
| `maker.jobs.picture(prompt, { variants })` | `jobs.create` | Starts pictures, 1 to 4 |
| `maker.jobs.model(image, { title, preset })` | `jobs.create` | Starts a 3D model from picture bytes |
| `maker.library.add(title, file)` | `library.add` | Adds a finished `Uint8Array`: binary STL in millimetres, or GLB in metres, as glTF has it. The size stays as made |

A call that is not allowed rejects with `NOT_ALLOWED`. The person sees the permissions in plain words
before installing, and grants them all or none.

## What a page and a panel cannot do

**The sandbox and its rules.** The page runs in a sandboxed frame with no origin of its own, and the
rules that come with it let it load only its own files. It has:

- no network, no cookies or storage, no popups;
- no way to navigate the app;
- no access to the computer's files;
- no way to call the app's commands.

The calls above are all it has, and the app's page checks every call (`src/lib/plugins.ts`).

**Two gaps in a page's rules, closed elsewhere:**

- **WebRTC** is taken out of every frame before any script runs (`NO_WEBRTC` in
  `src-tauri/src/plugins.rs`).
- **A preconnect link** is stopped by leaving the web view without a network, set in `tauri.conf.json`:
  - Windows: no name resolution (`additionalBrowserArgs`);
  - Linux: a proxy that goes nowhere (`proxyUrl`).

  The app's own page needs no network: anything that goes online does so from the Rust side.

On macOS the proxy needs macOS 14, so it is not set there, and a preconnect link may still open a connection.

A plugin cannot remember anything between runs yet: there is no call for that.

## Models

A model in `models` is written as the app's own catalog writes one (`src-tauri/catalog.json`), plus its
program, the adapter. It needs the permission `program`, and only a plugin with models may ask for it:

```json
{
	"id": "vase",
	"name": "Vase from a silhouette",
	"kind": "3d",
	"quality": 1,
	"summary": { "en": "One sentence.", "ru": "Одно предложение." },
	"publisher": "You",
	"license": "MIT",
	"license_url": "https://…",
	"source_url": "https://…",
	"regions_excluded": [],
	"runtime": {
		"python": "3.10",
		"torch": "2.7.1",
		"torchvision": "0.22.1",
		"code": { "url": "https://codeload.github.com/owner/repo/zip/<commit>", "sha256": "…", "size": 1234 },
		"packages": ["numpy==2.2.6", "trimesh==4.5.3"],
		"weights": [{ "url": "https://huggingface.co/owner/name/resolve/<commit>/model.safetensors", "sha256": "…", "size": 5678, "name": "model.safetensors" }],
		"adapter": "adapter.py"
	},
	"presets": [{ "id": "fine", "args": ["--steps", "50"], "time_factor": 3 }],
	"targets": [{ "os": "windows", "device": "cuda", "ref_seconds": 60, "min_vram_mb": 8000, "min_ram_mb": 16000, "disk_gb": 12 }]
}
```

**What the fields mean:**

- `kind` is `3d`: a model makes a 3D model from one picture.
- `python` is 3.10, 3.11 or 3.12.
- `torch` and `torchvision` come both or neither. PyTorch comes from its own index, built for the
  person's graphics card as for the app's models.
- `code` is a zip of the model's code, and `weights` are its files.
  - The app downloads both itself and checks each against its `sha256`.
  - A weight from Hugging Face may also come from its mirror.
  - Its `name` is where it lies under `--weights`.
- `packages` are from PyPI, each at one exact version, as `name==1.2.3`. No addresses and no ranges.
  - They are installed only as built wheels.
  - A package that would have to build itself runs code to do it, so it is not installed.
- `targets` give times and memory.
  - These are the author's: the app shows them as not tested, and says so on the model's row.
  - The app never picks a plugin's model by itself. It offers its own models first, and the assistant
    takes a plugin's model only when none of the app's own 3D models is installed.

### The adapter

The adapter is a Python file of the plugin, run as:

```
python adapter.py --weights DIR [--code DIR] --check --device cuda
python adapter.py --weights DIR [--code DIR] --image IN.png --out OUT.glb --device cuda --seed N [preset args]
```

**What it is given:**

- `--check` comes once, at the end of the install. It should load what it needs and exit 0.
- `--image` is the picture, usually a PNG.
- `--out` is where it writes a GLB, in metres as glTF has it.

**What it says back:**

- It may print `{"stage": "generate"}` and `{"stage": "export"}` as it goes, and the page shows them.
- Its output goes to the job's log.
- A failure with "CUDA out of memory" in its output is shown as running out of graphics memory.

A preset's arguments go at the end; they may not repeat the app's own (`--image`, `--out` and the rest).

### The fence

**What the program reaches.** The adapter runs in the plugin's fence, which the operating system
enforces. On Windows this is an AppContainer of the plugin's own (`src-tauri/src/fence.rs`). Inside it the
program reaches:

- its model's folder, to read, and three folders of it to write in (`tmp`, `cache`, `run`);
- the Python it runs on and the plugin's own files, to read;
- what Windows lets every app read: the system's own files.

**What it does not reach:**

- the person's files: Documents, Desktop, the other jobs, the app's settings;
- other plugins' folders;
- the clipboard;
- other programs: it cannot start one. Its Python starts directly, not through the environment's
  launcher, since a fenced program may run only as one process.

**The network.** Windows closes the network to an AppContainer with a rule of its firewall. A rule that a
person or a security program made for one program by its path comes before it. That way is shut for
programs the fence started, since none can start. Any other rule that opens the network on a computer
cannot be read from the app.

So before a plugin's program first runs in a session, the app tries the fence with that program's Python:
a connection to 1.1.1.1:443. If it goes through, the fence is open on this computer, and the program does
not run until the person says it may. They are told that their files stay closed to it, and that it could
reach the internet. A computer that is offline at that moment counts as closed.

**What was checked, and what was not:**

- **Checked on the development PC:**
  - The fenced program read only the folders it was granted, could not write in a folder it could only
    read, and could not list the person's folder or Desktop.
  - It could not start another program, and could not open the clipboard.
  - Name lookups and UDP were blocked.
- **The network on the development PC:** its network passes through an interception of its own, so a
  TCP connection to an address went through. That is the case the check before each first run exists for.
- **Not checked yet:** whether CUDA works inside an AppContainer. Owed on a PC with an NVIDIA card.
- **Other systems:** Linux and macOS have no fence in the app yet. There a plugin's models do not appear,
  and the plugin's card and install dialog say so.

**What happens to a plugin's model:**

- Removing the plugin removes its models and its fence.
- Turning it off hides its models; they stay installed.

## Not in yet

- Keys for a plugin's commands: a command is a button for now.
- Panels and commands on other pages than a finished model's.
- Models of other kinds than 3D from one picture.
- A shared list of plugins to browse: a plugin is a file someone hands over.
- Storage for a page between runs.
