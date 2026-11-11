// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_pipe_cover_pipe_steel_dn = (p?: Params, o?: Options) => say("Steel DN{dn} ({inch})", "Сталь DN{dn} ({inch})", p, o);
export const t_pipe_cover_pipe_pp = (p?: Params, o?: Options) => say("Polypropylene {d}", "Полипропилен {d}", p, o);
export const t_pipe_cover_pipe_mp = (p?: Params, o?: Options) => say("PEX-AL-PEX {d}", "Металлопластик {d}", p, o);
export const t_pipe_cover_preset_steel = (p?: Params, o?: Options) => say("Steel {inch}", "Сталь {inch}", p, o);
export const t_pipe_cover_filename = (p?: Params, o?: Options) => say("pipe-cover", "nakladka", p, o);
export const t_pipe_cover_pipe = (p?: Params, o?: Options) => say("Pipe", "Труба", p, o);
export const t_pipe_cover_pipe_diameter = (p?: Params, o?: Options) => say("Pipe diameter", "Диаметр трубы", p, o);
export const t_pipe_cover_pipe_diameter_hint = (p?: Params, o?: Options) => say("Outside diameter. For any other pipe, measure it with calipers.", "Снаружи. Своя труба — померьте штангенциркулем.", p, o);
export const t_pipe_cover_cover = (p?: Params, o?: Options) => say("Cover", "Накладка", p, o);
export const t_pipe_cover_cover_diameter = (p?: Params, o?: Options) => say("Cover diameter", "Диаметр накладки", p, o);
export const t_pipe_cover_rim = (p?: Params, o?: Options) => say("Rim", "Бортик", p, o);
export const t_pipe_cover_rim_hint = (p?: Params, o?: Options) => say("How far the cover reaches over the rough edge of the hole.", "Насколько накладка закрывает неровный край отверстия.", p, o);
export const t_pipe_cover_split = (p?: Params, o?: Options) => say("Two halves", "Из двух половин", p, o);
export const t_pipe_cover_split_hint = (p?: Params, o?: Options) => say("Fits around a pipe that's already installed.", "Надевается на трубу, которая уже стоит.", p, o);
export const t_pipe_cover_summary = (p?: Params, o?: Options) => say({"one":"{n} ⌀ {diameter} mm cover for a {pipe} mm pipe, {rim} mm rim. For heating pipes, print in PETG or ABS — PLA will soften.","other":"{n} ⌀ {diameter} mm covers for a {pipe} mm pipe, {rim} mm rim. For heating pipes, print in PETG or ABS — PLA will soften."}, {"one":"{n} накладка ⌀ {diameter} мм на трубу {pipe} мм, бортик {rim} мм. Для отопления печатайте из PETG или ABS — PLA размягчится.","few":"{n} накладки ⌀ {diameter} мм на трубу {pipe} мм, бортик {rim} мм. Для отопления печатайте из PETG или ABS — PLA размягчится.","many":"{n} накладок ⌀ {diameter} мм на трубу {pipe} мм, бортик {rim} мм. Для отопления печатайте из PETG или ABS — PLA размягчится.","other":"{n} накладки ⌀ {diameter} мм на трубу {pipe} мм, бортик {rim} мм. Для отопления печатайте из PETG или ABS — PLA размягчится."}, p, o);
export const t_pipe_cover_summary_split = (p?: Params, o?: Options) => say("Two halves: fit them on from both sides and slide them along the pipe until the dovetails click.", "Из двух половин: наденьте с двух сторон и сдвиньте вдоль трубы до щелчка ласточкиных хвостов.", p, o);
export const t_pipe_cover_scad_title = (p?: Params, o?: Options) => say("Polyzon Maker — “Pipe covers”", "Polyzon Maker — «Накладки на трубы»", p, o);
