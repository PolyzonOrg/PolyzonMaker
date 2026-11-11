// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_cable_raceway_preset_thin = (p?: Params, o?: Options) => say("A couple of wires", "Пара проводов", p, o);
export const t_cable_raceway_preset_desk = (p?: Params, o?: Options) => say("Under a desk", "Под столом", p, o);
export const t_cable_raceway_preset_tv = (p?: Params, o?: Options) => say("Under a TV", "Под телевизором", p, o);
export const t_cable_raceway_preset_wide = (p?: Params, o?: Options) => say("Wide", "Широкий", p, o);
export const t_cable_raceway_summary = (p?: Params, o?: Options) => say("Outside {width} × {height} mm, {length} mm long; {mount}. Fits {wires} 5 mm thick.", "Снаружи {width} × {height} мм, длина {length} мм; {mount}. Внутри поместится {wires} толщиной 5 мм.", p, o);
export const t_cable_raceway_summary_screws = (p?: Params, o?: Options) => say({"one":"{n} hole for a 3.5–4 mm screw","other":"{n} holes for 3.5–4 mm screws"}, {"one":"{n} отверстие под шуруп 3,5–4 мм","few":"{n} отверстия под шуруп 3,5–4 мм","many":"{n} отверстий под шуруп 3,5–4 мм","other":"{n} отверстия под шуруп 3,5–4 мм"}, p, o);
export const t_cable_raceway_summary_tape = (p?: Params, o?: Options) => say("mounts with double-sided tape", "на двусторонний скотч", p, o);
export const t_cable_raceway_summary_wires = (p?: Params, o?: Options) => say({"one":"{n} wire","other":"{n} wires"}, {"one":"{n} провод","few":"{n} провода","many":"{n} проводов","other":"{n} провода"}, p, o);
export const t_cable_raceway_scad_title = (p?: Params, o?: Options) => say("Polyzon Maker — “Cable raceway”", "Polyzon Maker — «Кабель-канал»", p, o);
export const t_cable_raceway_scad_inside = (p?: Params, o?: Options) => say("Inside {width} × {height} mm, wall {wall} mm, snap clearance {clearance} mm", "Внутри {width} × {height} мм, стенка {wall} мм, зазор защёлки {clearance} мм", p, o);
export const t_cable_raceway_scad_print = (p?: Params, o?: Options) => say("Print the channel on its back and the cover face down; no supports", "Канал печатается на спинке, крышка — лицом вниз; без поддержек", p, o);
export const t_cable_raceway_mount_tape = (p?: Params, o?: Options) => say("Tape", "На скотч", p, o);
export const t_cable_raceway_mount_screws = (p?: Params, o?: Options) => say("Screws", "На шурупы", p, o);
export const t_cable_raceway_filename = (p?: Params, o?: Options) => say("cable-raceway", "kabel-kanal", p, o);
export const t_cable_raceway_length_hint = (p?: Params, o?: Options) => say("Print a long run in sections: they butt together end to end.", "Длинную трассу печатайте отрезками: они стыкуются торцами.", p, o);
export const t_cable_raceway_inner_width = (p?: Params, o?: Options) => say("Inner width", "Ширина внутри", p, o);
export const t_cable_raceway_inner_height = (p?: Params, o?: Options) => say("Inner height", "Высота внутри", p, o);
export const t_cable_raceway_wall_hint = (p?: Params, o?: Options) => say("Thinner gives a softer snap; thicker makes the channel stronger.", "Тоньше — защёлка мягче, толще — канал прочнее.", p, o);
export const t_cable_raceway_mount_and_snap = (p?: Params, o?: Options) => say("Mounting and snap fit", "Крепление и защёлка", p, o);
export const t_cable_raceway_screw_step = (p?: Params, o?: Options) => say("Hole spacing", "Шаг отверстий", p, o);
export const t_cable_raceway_screw_step_hint = (p?: Params, o?: Options) => say("Countersunk holes: the screw head sits flush with the bottom.", "Отверстия с зенковкой: головка шурупа уходит заподлицо с дном.", p, o);
export const t_cable_raceway_clearance = (p?: Params, o?: Options) => say("Snap clearance", "Зазор защёлки", p, o);
export const t_cable_raceway_clearance_hint = (p?: Params, o?: Options) => say("0.2 mm — the cover clicks into place; more makes it easier to remove.", "0,2 мм — крышка садится с щелчком; больше — снимается легче.", p, o);
