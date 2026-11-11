// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_print_hinge_preset_box = (p?: Params, o?: Options) => say("Small box", "Для шкатулки", p, o);
export const t_print_hinge_preset_door = (p?: Params, o?: Options) => say("Cabinet door", "Для дверцы", p, o);
export const t_print_hinge_preset_big = (p?: Params, o?: Options) => say("Large", "Большая", p, o);
export const t_print_hinge_filename = (p?: Params, o?: Options) => say("hinge", "petlya", p, o);
export const t_print_hinge_group_hinge = (p?: Params, o?: Options) => say("Hinge", "Петля", p, o);
export const t_print_hinge_leaf = (p?: Params, o?: Options) => say("Leaf width", "Ширина створки", p, o);
export const t_print_hinge_knuckles = (p?: Params, o?: Options) => say("Knuckles", "Колен", p, o);
export const t_print_hinge_knuckles_hint = (p?: Params, o?: Options) => say("An odd number: both outer knuckles belong to the same leaf.", "Нечётное число: крайние колена у одной створки.", p, o);
export const t_print_hinge_clearance_hint = (p?: Params, o?: Options) => say("If the hinge fused, increase it; 0.3–0.4 mm works for most printers.", "Если петля спеклась — прибавьте; 0,3–0,4 мм подходит большинству принтеров.", p, o);
export const t_print_hinge_group_fasteners = (p?: Params, o?: Options) => say("Fasteners", "Крепёж", p, o);
export const t_print_hinge_screw = (p?: Params, o?: Options) => say("Screw diameter", "Саморез", p, o);
export const t_print_hinge_holes = (p?: Params, o?: Options) => say("Holes per leaf", "Отверстий на створку", p, o);
export const t_print_hinge_summary = (p?: Params, o?: Options) => say({"one":"Hinge {length} × {width} mm, {n} knuckle, {gap} mm clearance. Prints open and fully assembled; after printing, work it back and forth to free it up.","other":"Hinge {length} × {width} mm, {n} knuckles, {gap} mm clearance. Prints open and fully assembled; after printing, work it back and forth to free it up."}, {"one":"Петля {length} × {width} мм, {n} колено, зазор {gap} мм. Печатается раскрытой и сразу собранной; после печати разомните её, покачав туда-сюда.","few":"Петля {length} × {width} мм, {n} колена, зазор {gap} мм. Печатается раскрытой и сразу собранной; после печати разомните её, покачав туда-сюда.","many":"Петля {length} × {width} мм, {n} колен, зазор {gap} мм. Печатается раскрытой и сразу собранной; после печати разомните её, покачав туда-сюда.","other":"Петля {length} × {width} мм, {n} колена, зазор {gap} мм. Печатается раскрытой и сразу собранной; после печати разомните её, покачав туда-сюда."}, p, o);
export const t_print_hinge_header_title = (p?: Params, o?: Options) => say("Polyzon Maker — “Hinges”", "Polyzon Maker — «Петли»", p, o);
