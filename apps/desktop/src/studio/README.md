# Tools from Polyzon Studio

`sync-studio.mjs` copies Studio's tools here unchanged, so a newer Studio is one more run of it. It owns
`tools/`, `gen/` and the files in its `LIB` list. Everything else in this folder is this app's own stand-in
for what only makes sense in Studio, and the sync leaves it alone:

| File | Stands in for |
| --- | --- |
| `components/tools/ToolShell.svelte` | The form and scene of every tool, in this app's design |
| `components/tools/FavoriteButton.svelte` | Studio's favourite star, here the pin that puts a tool in the menu |
| `fields.ts`, `memory.ts` | The open tool's form as its fields register it, and the values each tool is left with |
| `agent.ts` | What another program sees of the tools and OpenSCAD |
| `i18n/current.ts`, `i18n/say.ts` | Studio's language runtime: the window's language, en and ru |
| `save.ts` | Browser downloads: a file goes through the system's save dialog |
| `styles/studio.css` | Studio's tokens on this app's, and the Tailwind classes the tools use |

`cad/` is Studio's CAD kernels as they are, under this app's language in `src/cad`. `cad/schema.ts` is there for
its types: nothing imports zod when the app runs.

Studio's class names are kept inside `.studio`, because `.btn` or `.card` mean something else in the app.
So the app's own parts of a tool's page sit outside that class, and the tool's form inside it.
