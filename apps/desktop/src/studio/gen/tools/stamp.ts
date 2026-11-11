// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_stamp_preset_name = (p?: Params, o?: Options) => say("Name stamp", "Именной штамп", p, o);
export const t_stamp_sample_name = (p?: Params, o?: Options) => say("Alex", "Иван", p, o);
export const t_stamp_preset_wax = (p?: Params, o?: Options) => say("Wax seal", "Печать для сургуча", p, o);
export const t_stamp_sample_wax = (p?: Params, o?: Options) => say("M", "М", p, o);
export const t_stamp_preset_cookie = (p?: Params, o?: Options) => say("Cookie stamp", "Штамп для печенья", p, o);
export const t_stamp_preset_clay = (p?: Params, o?: Options) => say("Star for clay", "Звезда для глины", p, o);
export const t_stamp_face_heart = (p?: Params, o?: Options) => say("Heart", "Сердце", p, o);
export const t_stamp_face_star = (p?: Params, o?: Options) => say("Star", "Звезда", p, o);
export const t_stamp_shape_rect = (p?: Params, o?: Options) => say("Rectangular", "Прямоугольный", p, o);
export const t_stamp_shape_round = (p?: Params, o?: Options) => say("Round", "Круглый", p, o);
export const t_stamp_filename = (p?: Params, o?: Options) => say("stamp", "shtamp", p, o);
export const t_stamp_group_face = (p?: Params, o?: Options) => say("Design", "Рисунок", p, o);
export const t_stamp_face = (p?: Params, o?: Options) => say("What's on the stamp", "Что на штампе", p, o);
export const t_stamp_text_hint = (p?: Params, o?: Options) => say("Type as usual: the impression reads the right way.", "Пишите как обычно: на отпечатке читается правильно.", p, o);
export const t_stamp_relief = (p?: Params, o?: Options) => say("Relief depth", "Глубина рельефа", p, o);
export const t_stamp_relief_hint = (p?: Params, o?: Options) => say("1–1.5 mm for ink, 2–3 mm for clay, sealing wax, and cookies.", "1–1,5 мм — для чернил, 2–3 мм — для глины, сургуча и печенья.", p, o);
export const t_stamp_border = (p?: Params, o?: Options) => say("Border", "Рамка по краю", p, o);
export const t_stamp_border_hint = (p?: Params, o?: Options) => say("Without a border, the base tapers toward the design at 45°, so the stamp prints face down without supports.", "Без рамки основа сужается к рисунку под 45° — штамп печатается лицом вниз без поддержек.", p, o);
export const t_stamp_group_stamp = (p?: Params, o?: Options) => say("Stamp", "Штамп", p, o);
export const t_stamp_base = (p?: Params, o?: Options) => say("Base thickness", "Толщина основы", p, o);
export const t_stamp_knob = (p?: Params, o?: Options) => say("Handle", "Ручка", p, o);
export const t_stamp_knob_hint = (p?: Params, o?: Options) => say("A mark on the end of the handle shows which way is up on the design.", "Метка на торце ручки показывает, где у рисунка верх.", p, o);
export const t_stamp_knob_height = (p?: Params, o?: Options) => say("Handle height", "Высота ручки", p, o);
export const t_stamp_summary_round = (p?: Params, o?: Options) => say("Ø {diameter} mm stamp, {relief} mm relief. Prints face down for a crisper design; the impression reads the right way.", "Штамп Ø {diameter} мм, рельеф {relief} мм. Печатается лицом вниз — так рисунок получается чётче; отпечаток читается правильно.", p, o);
export const t_stamp_summary_rect = (p?: Params, o?: Options) => say("{width} × {height} mm stamp, {relief} mm relief. Prints face down for a crisper design; the impression reads the right way.", "Штамп {width} × {height} мм, рельеф {relief} мм. Печатается лицом вниз — так рисунок получается чётче; отпечаток читается правильно.", p, o);
export const t_stamp_header_title = (p?: Params, o?: Options) => say("Polyzon Maker — “Stamps”", "Polyzon Maker — «Штампы»", p, o);
