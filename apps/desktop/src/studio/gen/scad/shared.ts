// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const scad_worker_timeout = (p?: Params, o?: Options) => say({"one":"The background worker didn't start within {n} second. Reload the page.","other":"The background worker didn't start within {n} seconds. Reload the page."}, {"one":"Воркер не запустился за {n} секунду. Перезагрузите страницу.","few":"Воркер не запустился за {n} секунды. Перезагрузите страницу.","many":"Воркер не запустился за {n} секунд. Перезагрузите страницу.","other":"Воркер не запустился за {n} секунды. Перезагрузите страницу."}, p, o);
export const scad_worker_timeout_keys = (p?: Params, o?: Options) => say({"one":"The background worker didn't start within {n} second. Reload the page ({keys}).","other":"The background worker didn't start within {n} seconds. Reload the page ({keys})."}, {"one":"Воркер не запустился за {n} секунду. Перезагрузите страницу ({keys}).","few":"Воркер не запустился за {n} секунды. Перезагрузите страницу ({keys}).","many":"Воркер не запустился за {n} секунд. Перезагрузите страницу ({keys}).","other":"Воркер не запустился за {n} секунды. Перезагрузите страницу ({keys})."}, p, o);
export const scad_view_iso = (p?: Params, o?: Options) => say("Isometric", "Изометрия", p, o);
export const scad_view_iso_back = (p?: Params, o?: Options) => say("Isometric from the back", "Изометрия сзади", p, o);
export const scad_view_front = (p?: Params, o?: Options) => say("Front (X → , Z ↑)", "Спереди (X → , Z ↑)", p, o);
export const scad_view_back = (p?: Params, o?: Options) => say("Back (X ← , Z ↑)", "Сзади (X ← , Z ↑)", p, o);
export const scad_view_left = (p?: Params, o?: Options) => say("Left (Y ← , Z ↑)", "Слева (Y ← , Z ↑)", p, o);
export const scad_view_right = (p?: Params, o?: Options) => say("Right (Y → , Z ↑)", "Справа (Y → , Z ↑)", p, o);
export const scad_view_top = (p?: Params, o?: Options) => say("Top (X → , Y ↑)", "Сверху (X → , Y ↑)", p, o);
export const scad_view_bottom = (p?: Params, o?: Options) => say("Bottom (X ← , Y ↑)", "Снизу (X ← , Y ↑)", p, o);
export const scad_view_section = (p?: Params, o?: Options) => say("{view} · section at {axis} = {at} mm", "{view} · разрез {axis} = {at} мм", p, o);
export const scad_view_scale = (p?: Params, o?: Options) => say("{size} mm", "{size} мм", p, o);
export const scad_view_size = (p?: Params, o?: Options) => say("{x} × {y} × {z} mm", "{x} × {y} × {z} мм", p, o);
export const scad_view_legend_more = (p?: Params, o?: Options) => say("… and {n} more", "… и ещё {n}", p, o);
