// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_rack_panel_preset_patch = (p?: Params, o?: Options) => say("1U patch panel", "Патч-панель 1U", p, o);
export const t_rack_panel_preset_blank = (p?: Params, o?: Options) => say("1U blank", "Заглушка 1U", p, o);
export const t_rack_panel_preset_vent = (p?: Params, o?: Options) => say("2U vented", "Вентиляция 2U", p, o);
export const t_rack_panel_preset_patch2 = (p?: Params, o?: Options) => say("2U patch panel", "Патч-панель 2U", p, o);
export const t_rack_panel_summary_ports = (p?: Params, o?: Options) => say({"one":"{n} keystone jack","other":"{n} keystone jacks"}, {"one":"{n} гнездо keystone","few":"{n} гнезда keystone","many":"{n} гнёзд keystone","other":"{n} гнезда keystone"}, p, o);
export const t_rack_panel_summary_vent = (p?: Params, o?: Options) => say("ventilation slots", "вентиляционные прорези", p, o);
export const t_rack_panel_summary_blank = (p?: Params, o?: Options) => say("blank", "заглушка", p, o);
export const t_rack_panel_summary_slots = (p?: Params, o?: Options) => say({"one":"{n} slot for an M6 or 10-32 screw","other":"{n} slots for M6 or 10-32 screws"}, {"one":"{n} паз под винт M6 или 10-32","few":"{n} паза под винт M6 или 10-32","many":"{n} пазов под винт M6 или 10-32","other":"{n} паза под винт M6 или 10-32"}, p, o);
export const t_rack_panel_summary = (p?: Params, o?: Options) => say("{units}U: {width} × {height} mm, {what}; {slots}.", "{units}U: {width} × {height} мм, {what}; {slots}.", p, o);
export const t_rack_panel_scad_title = (p?: Params, o?: Options) => say("Polyzon Maker — “10″ rack panels” (EIA-310)", "Polyzon Maker — «Панель для 10″ стойки» (EIA-310)", p, o);
export const t_rack_panel_scad_thickness = (p?: Params, o?: Options) => say("{thickness} mm thick; prints face down", "Толщина {thickness} мм; печатается лицом вниз", p, o);
export const t_rack_panel_scad_thickness_ribs = (p?: Params, o?: Options) => say("{thickness} mm thick, stiffening ribs on the back; prints face down", "Толщина {thickness} мм, рёбра жёсткости сзади; печатается лицом вниз", p, o);
export const t_rack_panel_fill_keystone = (p?: Params, o?: Options) => say("Keystone jacks", "Гнёзда keystone", p, o);
export const t_rack_panel_fill_vent = (p?: Params, o?: Options) => say("Vented", "Вентиляция", p, o);
export const t_rack_panel_fill_blank = (p?: Params, o?: Options) => say("Blank", "Заглушка", p, o);
export const t_rack_panel_filename = (p?: Params, o?: Options) => say("rack-panel-10in", "stojka-10", p, o);
export const t_rack_panel_group_panel = (p?: Params, o?: Options) => say("Panel", "Панель", p, o);
export const t_rack_panel_units_hint_one = (p?: Params, o?: Options) => say("1U = 44.45 mm. The panel is 254 mm wide: you need a bed of at least 256 mm, or print it diagonally on a 220 × 220 bed.", "1U = 44,45 мм. Ширина 254 мм: нужен стол от 256 мм или печать по диагонали стола 220 × 220.", p, o);
export const t_rack_panel_units_hint_more = (p?: Params, o?: Options) => say("1U = 44.45 mm. The panel is 254 mm wide: you need a bed of at least 256 mm — only 1U fits diagonally on a 220 × 220 bed.", "1U = 44,45 мм. Ширина 254 мм: нужен стол от 256 мм — по диагонали стола 220 × 220 помещается только 1U.", p, o);
export const t_rack_panel_fill = (p?: Params, o?: Options) => say("On the panel", "Что на панели", p, o);
export const t_rack_panel_ports = (p?: Params, o?: Options) => say("Jacks per row", "Гнёзд в ряду", p, o);
export const t_rack_panel_ports_hint = (p?: Params, o?: Options) => say("A 14.9 × 19.4 mm cutout with 1.6 mm of plastic around it, like factory panels: RJ45, USB, and HDMI modules snap in.", "Окно 14,9 × 19,4 мм, у окна 1,6 мм пластика — как у заводских панелей: защёлкиваются модули RJ45, USB, HDMI.", p, o);
export const t_rack_panel_ribs = (p?: Params, o?: Options) => say("Stiffening ribs", "Рёбра жёсткости", p, o);
export const t_rack_panel_ribs_hint = (p?: Params, o?: Options) => say("Along the top and bottom at the back, between the rails: a long panel won't sag.", "Сзади по верху и низу, между стойками: длинная панель не прогибается.", p, o);
