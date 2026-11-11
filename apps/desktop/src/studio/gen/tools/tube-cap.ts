// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_tube_cap_preset_round = (p?: Params, o?: Options) => say("Round 25 mm", "Круглая 25 мм", p, o);
export const t_tube_cap_preset_foot = (p?: Params, o?: Options) => say("Foot with felt pad", "Ножка с фетром", p, o);
export const t_tube_cap_profile_square = (p?: Params, o?: Options) => say("Square", "Квадратная", p, o);
export const t_tube_cap_profile_rect = (p?: Params, o?: Options) => say("Rectangular", "Прямоугольная", p, o);
export const t_tube_cap_profile_round = (p?: Params, o?: Options) => say("Round", "Круглая", p, o);
export const t_tube_cap_filename = (p?: Params, o?: Options) => say("tube-cap", "zaglushka", p, o);
export const t_tube_cap_tube = (p?: Params, o?: Options) => say("Tube", "Труба", p, o);
export const t_tube_cap_profile = (p?: Params, o?: Options) => say("Profile", "Профиль", p, o);
export const t_tube_cap_outer_diameter = (p?: Params, o?: Options) => say("Outer diameter", "Диаметр снаружи", p, o);
export const t_tube_cap_outer_width = (p?: Params, o?: Options) => say("Outer width", "Ширина снаружи", p, o);
export const t_tube_cap_outer_height = (p?: Params, o?: Options) => say("Outer height", "Высота снаружи", p, o);
export const t_tube_cap_tube_wall = (p?: Params, o?: Options) => say("Tube wall", "Стенка трубы", p, o);
export const t_tube_cap_tube_wall_hint = (p?: Params, o?: Options) => say("Measure it at the end of the tube: the insert size depends on it.", "Померьте на торце трубы: от неё зависит размер вставки.", p, o);
export const t_tube_cap_cap = (p?: Params, o?: Options) => say("Cap", "Заглушка", p, o);
export const t_tube_cap_plug_depth = (p?: Params, o?: Options) => say("Insert depth", "Вставка в трубу", p, o);
export const t_tube_cap_cap_thickness = (p?: Params, o?: Options) => say("Cap thickness", "Толщина крышки", p, o);
export const t_tube_cap_cap_thickness_hint = (p?: Params, o?: Options) => say("For a furniture foot, 5–8 mm.", "Для ножки мебели — 5–8 мм.", p, o);
export const t_tube_cap_felt = (p?: Params, o?: Options) => say("Felt pad recess", "Под фетровую накладку", p, o);
export const t_tube_cap_felt_hint = (p?: Params, o?: Options) => say("A 1 mm recess underneath for a stick-on pad.", "Углубление 1 мм снизу под наклейку.", p, o);
export const t_tube_cap_summary = (p?: Params, o?: Options) => say({"one":"{n} cap for a {size} mm tube ({inside} mm inside), {depth} mm ribbed insert. Too tight? Add clearance. Wobbly? Reduce it.","other":"{n} caps for a {size} mm tube ({inside} mm inside), {depth} mm ribbed insert. Too tight? Add clearance. Wobbly? Reduce it."}, {"one":"{n} заглушка на трубу {size} мм (внутри {inside} мм), вставка {depth} мм с рёбрами. Туго — прибавьте зазор, болтается — уменьшите.","few":"{n} заглушки на трубу {size} мм (внутри {inside} мм), вставка {depth} мм с рёбрами. Туго — прибавьте зазор, болтается — уменьшите.","many":"{n} заглушек на трубу {size} мм (внутри {inside} мм), вставка {depth} мм с рёбрами. Туго — прибавьте зазор, болтается — уменьшите.","other":"{n} заглушки на трубу {size} мм (внутри {inside} мм), вставка {depth} мм с рёбрами. Туго — прибавьте зазор, болтается — уменьшите."}, p, o);
export const t_tube_cap_scad_title = (p?: Params, o?: Options) => say("Polyzon Maker — “Tube end caps”", "Polyzon Maker — «Заглушки для труб»", p, o);
