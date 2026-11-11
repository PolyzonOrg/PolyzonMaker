// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_fan_grille_preset_pc = (p?: Params, o?: Options) => say("PC case 120", "Корпус ПК 120", p, o);
export const t_fan_grille_preset_printer = (p?: Params, o?: Options) => say("Printer fan 40", "Обдув принтера 40", p, o);
export const t_fan_grille_preset_quiet = (p?: Params, o?: Options) => say("Quiet 140", "Тихая 140", p, o);
export const t_fan_grille_preset_grid = (p?: Params, o?: Options) => say("Mesh 80", "Сетка 80", p, o);
export const t_fan_grille_fan = (p?: Params, o?: Options) => say("Fan", "Вентилятор", p, o);
export const t_fan_grille_size_option = (p?: Params, o?: Options) => say("{size} mm", "{size} мм", p, o);
export const t_fan_grille_size_hint = (p?: Params, o?: Options) => say("Screw holes are at the standard spacing for this size.", "Отверстия под винты — на стандартном расстоянии для этого размера.", p, o);
export const t_fan_grille_countersink = (p?: Params, o?: Options) => say("Countersunk holes", "Потайные отверстия", p, o);
export const t_fan_grille_countersink_hint = (p?: Params, o?: Options) => say("Screw heads sit flush with the grille.", "Головки винтов утопают в решётку.", p, o);
export const t_fan_grille_pattern = (p?: Params, o?: Options) => say("Pattern", "Рисунок", p, o);
export const t_fan_grille_pattern_hex = (p?: Params, o?: Options) => say("Honeycomb", "Соты", p, o);
export const t_fan_grille_pattern_rings = (p?: Params, o?: Options) => say("Rings", "Кольца", p, o);
export const t_fan_grille_pattern_slots = (p?: Params, o?: Options) => say("Slots", "Прорези", p, o);
export const t_fan_grille_pattern_grid = (p?: Params, o?: Options) => say("Mesh", "Сетка", p, o);
export const t_fan_grille_pitch_hint = (p?: Params, o?: Options) => say("Distance between neighboring openings. Finer keeps fingers out; coarser is quieter.", "Расстояние между соседними отверстиями. Мельче — защищает пальцы, крупнее — тише.", p, o);
export const t_fan_grille_bar_thickness = (p?: Params, o?: Options) => say("Bar thickness", "Толщина перемычек", p, o);
export const t_fan_grille_bar_hint = (p?: Params, o?: Options) => say("At least two line widths: 0.9 mm or more for a 0.4 nozzle.", "Не тоньше двух ширин линии: для сопла 0,4 — от 0,9 мм.", p, o);
export const t_fan_grille_plate = (p?: Params, o?: Options) => say("Plate", "Пластина", p, o);
export const t_fan_grille_summary = (p?: Params, o?: Options) => say("Screw holes {spacing} mm apart, Ø {screw} mm. About {open}% open area — the more, the quieter it runs and the stronger the airflow.", "Отверстия под винты через {spacing} мм, Ø {screw} мм. Открыто ≈ {open}% площади — чем больше, тем тише и сильнее поток.", p, o);
export const t_fan_grille_scad_title = (p?: Params, o?: Options) => say("Polyzon Maker — “Fan grilles”: {fan} mm, {pattern}, {thickness} mm thick", "Polyzon Maker — «Решётки вентилятора»: {fan} мм, {pattern}, толщина {thickness} мм", p, o);
export const t_fan_grille_word_rings = (p?: Params, o?: Options) => say("rings", "кольца", p, o);
export const t_fan_grille_word_hex = (p?: Params, o?: Options) => say("honeycomb", "соты", p, o);
export const t_fan_grille_word_slots = (p?: Params, o?: Options) => say("slots", "прорези", p, o);
export const t_fan_grille_word_grid = (p?: Params, o?: Options) => say("mesh", "сетка", p, o);
export const t_fan_grille_scad_print = (p?: Params, o?: Options) => say("Prints flat, no supports", "Печатается плашмя, без поддержек", p, o);
export const t_fan_grille_filename = (p?: Params, o?: Options) => say("fan-grille", "reshetka", p, o);
