# Polyzon Maker design code

One look for everything. A control comes from the shared set in `src/app.css` and `src/parts/`. A style
written for one screen is a bug. When something new is needed, add it here and to the shared set, then
use it. Check every interface change against this page before calling it done.

## Look

Flat, minimal, modern. No shadows, gradients, glows or blur. Depth comes from surface steps alone.
Colour carries meaning (good, warning, bad), never decoration. What floats over the page, like an open
dropdown, gets a 1 px `--line` border in place of a shadow. A panel that lies over the page in a narrow
window dims what still shows of the page, and a click there closes the panel.

## The window

The window's own colour, `--chrome`, carries the title bar and the menu. Everything people work in is a
`.pane`: rounded, 8 px from the window's edge, in `--bg`. The assistant is a second pane beside the first.
Nothing at the edge of a pane wears `--chrome`, or the rounding disappears into the window.

The person sets the menu's width by dragging its edge. Below the narrowest width with words it folds to its
icons, and the button in the title bar folds and unfolds it. It never disappears: the icons stay, each with
its word as a tooltip.

The menu opens with «Новая модель», the one way to the page where a model starts, and its key Mod+N; under it
the pages are places, each in the menu once.

Under the pages come the tools the person pinned, in the order they pinned them, then the recent models. The
pin is on every tool's card and in its header, filled while the tool is pinned; a pinned tool in the menu shows
a cross to unpin it under the pointer.

## Screens beside each other

The assistant docks beside any page, so a page lays itself out by the room it has (`@container` on `.content`), never by the width of the window. Below 700 px a result page is one column that scrolls: the model on top, as tall as its toolbar needs, the panel under it.

## Tokens

Colours are defined for light and dark in `src/app.css`. Never write a colour value in a component.

| Token | Use |
| --- | --- |
| `--bg` | The work area and dialogs |
| `--chrome` | The window around the work area: menu, title bar |
| `--surface` | Panels and bars inside the work area: the work area's own colour, told apart by a `--line` |
| `--viewer` | 3D scenes: the work area's colour too, so that the pane keeps its rounded edge |
| `--surface-2` | Blocks and cards |
| `--surface-3` | Controls inside a block: fields, selected chips |
| `--surface-4` | Selected state in a segmented control |
| `--button`, `--button-hover` | Ordinary buttons, in every place |
| `--ink`, `--on-ink` | Main text; the primary button and text on it |
| `--ink-muted`, `--ink-faint` | Secondary text; hints and captions. Both read at 4.5 : 1 or more on the window, the menu, blocks and fields, in both themes |
| `--good`, `--warn`, `--bad` | Status only |

| Scale | Values |
| --- | --- |
| Radius | `--r-sm` 8 small controls, `--r` 12 controls, `--r-lg` 16 blocks, `--r-pill` chips and bars |
| Spacing | Multiples of 4: 4, 8, 12, 16, 24, 32 |
| Text | 28 page title, 18 section, 14 body, 13 secondary, 12 captions; nothing under 12 |
| Control height | 44 big, 38 default, 32 small; a click target is never under 24 × 24. Controls side by side on one line are one height: buttons, fields and selectors alike (`.btn.small`, `.input.small`, `Select small` go together) |
| Motion | 120 ms hover and press, 200–260 ms panels and pages, 320 ms step changes, nothing over 500 ms |

`--ease` is the only easing curve. `prefers-reduced-motion` turns motion off, and the code for that is in `app.css`.

## Controls

| Control | Class or part | Rules |
| --- | --- | --- |
| Button | `.btn`, `.primary`, `.ghost`, `.danger`, `.small`, `.big` | One primary per view. Names the action with a verb. |
| Icon button | `.tool` | Only for the conventions below. Always has a tooltip and an `aria-label`. |
| Text field | `.input`, `textarea` | Shows focus with the caret, no frame. |
| Dropdown | `Select` | Never a system `select`: the system draws those in its own style. Arrows, Enter, Esc and typing work. In a row of controls it is as wide as its words, so its own name is never cut; only a long chosen name stops at 220 px. |
| Switch | `input[role=switch]` | A setting that applies at once. |
| Segmented control | `.seg` | Two to five short options, all visible. |
| Action list | `.menu-list` | A page's secondary actions in one block, one to a row with an icon and a word, the most used first; what cannot be undone last, below a line, in red. The same rows make a menu behind «⋯». |
| Block | `.card` | Holds one topic. Blocks do not nest. Fields inside step up to `--surface-3` by themselves. |
| Setting | `.setting` | What it is on the left, the control on the right. |
| Link | `.link` | Goes somewhere or shows more. An action is a button. |
| Note | `.note`, `.bad`, `.warn`, `.good` | A line of status text. |
| Code | `.code` | Logs and technical details. |
| Chip | `.chip`, `.good`, `.warn`, `.bad` | A state, never an action. |
| Progress | `.bar` | See below. |
| Dialog | `Dialog` | Only for what cannot wait. Esc and a click outside close it. |
| Toast | `Toasts`, `showToast` | Says what just happened, and that something nobody handled went wrong. What the person must act on stays next to the problem. |
| 3D view | `ViewControls` | Every 3D view has the same toolbar at its right edge: turn or move, the whole model and three sides, turn by itself, grid, shadows where the view has them, surface, zoom, and what the model is. A page puts its own tools on top of it. |
| Plugin frame | `PluginFrame` | A plugin's page or panel. A panel is a section of the page's side panel: its title as the other sections have theirs, the frame inside a `--line` with `--r-sm` corners, as tall as the plugin asked. A plugin's command is a row among the page's own actions, with the plugin icon and the plugin's name as its tip. The plugin draws what is inside; the app draws nothing over it. |
| List and page | Models | The list on the left under a `--line`, the chosen one on the right: its name, and how it installs here on the right of it; what it makes and needs; examples of its work. A row shows its icon, name, one line of summary and its state or time here. Up and down walk the list. Under 760 px one of the two at a time, the page with a way back. Examples are only real work, with the time and where it was measured; a model with none says so. |
| Versions bar | `Strip` | The versions of one generation, across the top of its page under a `--line`: the pictures, then an arrow and the models made from them, each kind under its word and counted in it. The one on the page is ringed, one being made shows its progress, one that failed a red cross over what it started from. Arrows, Home and End move along it. |
| Splitter | `Edge` | A long thin target at a border: 16 px wide, wider than the line it draws, arrows move it. The menu and the assistant have one each, and CAD and OpenSCAD one each for their code and their side panel (`DeskEdges`). Each keeps its width; a desk keeps its scene at least 360 px and a narrowing window takes it from the code first; where a desk stacks its columns, they have none. |
| Tooltip | `Tip`, a control's `title` | One for the whole program: a control's `title` says what it is and how it stands now ("Grid off"), `data-keys` names the shortcut and it shows as key caps, `data-tip-side` on a toolbar says where there is room. A title that comes and goes is `data-tip`. Never the system's own tooltip. |
| Model as printed | Result | A generated model is closed for print at once, its surface where it was: holes patched, hollows filled, overlapping parts joined. The view shows that one, "For print / As generated" switches back. A rebuild on a grid smooths detail, so it is only a button, offered when the repair could not close the model. |

## Icons

Icons come from `Icon.svelte`, one stroke width, Lucide's geometry. Every navigation item and primary
action has an icon and a word: on first use people do better with both (Wiedenbeck 1999). An icon alone is
for conventions only: close, search, settings, window controls, fold menu, and it has a tooltip. The
folded menu is the one exception: the person chose it, having seen the words.

## Behaviour

These come from the research listed at the end. Where a rule is a judgement call it says so.

**Work in progress.** While a model or a picture is made, a few specks drift slowly in from every side, an even stream, and are gone in the middle, as if it were put together from them: they are gone at the edge of the picture they fly into, which stands over them. With reduced motion they come at half the pace, without their short tails.

**Feedback.** Under 0.1 s show the result. Up to 1 s keep the context, a busy state at most. Over 1 s show a
progress indicator. Over 10 s show how far along it is, an estimate, and a way to stop (Nielsen 1993).

**Progress.** Determinate whenever the total is known (Myers 1985). The bar only moves forward and never
stalls near the end (Harrison et al. 2007). Show real named steps with amounts, speed and time left, never
invented activity. When the total is unknown the bar breathes, it does not run back and forth. Long work
continues in the background and tells the person when it ends.

**Choice.** Choices come grouped and in a sensible order; there is no rule about how few (Hick-Hyman applies
to organised, familiar sets). Do not ask people to keep more than about four things in mind (Cowan 2001).
Things most people need are on the screen; the rest is one step away, two at most. Everything works with
the defaults.

**Errors.** Nothing fails silently: a failure nobody handled still reaches the person as a toast. Prevent them first: constrain fields, disable what cannot work and say why. A message says what
happened and what to do, in plain words, next to the problem. Codes and logs stay behind "Technical
details".

**Reversal.** Prefer undo over asking. A confirmation is only for what cannot be undone, and its button
names the action: "Delete", never "OK" (Shneiderman, rule 6).

**Consistency.** Same action, same word, same place on every screen. Window controls, dialogs and shortcuts
behave the way the system does (Nielsen, heuristic 4).

**Keyboard.** Everything can be reached by keyboard. Shortcuts are shown in tooltips and menus, where people
learn them (Grossman et al. 2007, Cockburn et al. 2014). Standard shortcuts are never taken over.

**Reading.** Prose stays around 65 characters a line. Both themes keep text at 4.5:1 and controls at 3:1
against what is next to them (WCAG 2.2).

## Sources

- Nielsen, response time limits: https://www.nngroup.com/articles/response-times-3-important-limits/
- Nielsen, ten usability heuristics: https://www.nngroup.com/articles/ten-usability-heuristics/
- WCAG 2.2: https://www.w3.org/TR/WCAG22/, target size https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- Myers, The importance of percent-done progress indicators, CHI 1985
- Harrison, Amento, Kuznetsov, Bell, Rethinking the progress bar, UIST 2007
- Wiedenbeck, The use of icons and labels in an end user application program, Behaviour & IT 1999
- Cowan, The magical number 4 in short-term memory, BBS 2001
- Shneiderman, Designing the User Interface, eight golden rules
- Grossman, Dragicevic, Balakrishnan, Strategies for accelerating on-line learning of hotkeys, CHI 2007
- Cockburn, Gutwin, Scarr, Malacria, Supporting novice to expert transitions, ACM Computing Surveys 2014

Left out on purpose: the "400 ms Doherty threshold" and "7 ± 2 items" are quoted everywhere and do not hold
up as design limits.
