// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_furniture_handle_preset_bar = (p?: Params, o?: Options) => say("{size} mm bar", "Ручка {size} мм", p, o);
export const t_furniture_handle_preset_long = (p?: Params, o?: Options) => say("Long, {size} mm", "Длинная {size} мм", p, o);
export const t_furniture_handle_preset_arch = (p?: Params, o?: Options) => say("{size} mm D-handle", "Скоба {size} мм", p, o);
export const t_furniture_handle_preset_set = (p?: Params, o?: Options) => say("Dresser set", "Набор на комод", p, o);
export const t_furniture_handle_group_handle = (p?: Params, o?: Options) => say("Handle", "Ручка", p, o);
export const t_furniture_handle_style = (p?: Params, o?: Options) => say("Style", "Вид", p, o);
export const t_furniture_handle_style_bar = (p?: Params, o?: Options) => say("Straight bar on posts", "Прямая на стойках", p, o);
export const t_furniture_handle_style_arch = (p?: Params, o?: Options) => say("D-handle", "Скоба", p, o);
export const t_furniture_handle_centres = (p?: Params, o?: Options) => say("Hole spacing", "Межосевое", p, o);
export const t_furniture_handle_centres_option = (p?: Params, o?: Options) => say("{size} mm", "{size} мм", p, o);
export const t_furniture_handle_centres_hint = (p?: Params, o?: Options) => say("Center-to-center distance between the screw holes, on the 32 mm system.", "Расстояние между отверстиями под винты — по системе 32 мм.", p, o);
export const t_furniture_handle_overhang = (p?: Params, o?: Options) => say("Overhang past posts", "Выступ за стойки", p, o);
export const t_furniture_handle_projection = (p?: Params, o?: Options) => say("Projection", "Вылет от фасада", p, o);
export const t_furniture_handle_screw = (p?: Params, o?: Options) => say("Screw", "Винт", p, o);
export const t_furniture_handle_screw_m4 = (p?: Params, o?: Options) => say("M4 screw into plastic", "Винт M4 в пластик", p, o);
export const t_furniture_handle_screw_insert = (p?: Params, o?: Options) => say("M4 heat-set insert", "Термовставка M4", p, o);
export const t_furniture_handle_summary_m4 = (p?: Params, o?: Options) => say({"one":"{n} handle, {centres} mm hole spacing, {projection} mm projection; an M4 screw threads straight into the plastic (⌀ 3.4 mm hole).","other":"{n} handles, {centres} mm hole spacing, {projection} mm projection; an M4 screw threads straight into the plastic (⌀ 3.4 mm hole)."}, {"one":"{n} ручка, межосевое {centres} мм, вылет {projection} мм; винт M4 вкручивается прямо в пластик (отверстие ⌀ 3,4 мм).","few":"{n} ручки, межосевое {centres} мм, вылет {projection} мм; винт M4 вкручивается прямо в пластик (отверстие ⌀ 3,4 мм).","many":"{n} ручек, межосевое {centres} мм, вылет {projection} мм; винт M4 вкручивается прямо в пластик (отверстие ⌀ 3,4 мм).","other":"{n} ручки, межосевое {centres} мм, вылет {projection} мм; винт M4 вкручивается прямо в пластик (отверстие ⌀ 3,4 мм)."}, p, o);
export const t_furniture_handle_summary_insert = (p?: Params, o?: Options) => say({"one":"{n} handle, {centres} mm hole spacing, {projection} mm projection; for an M4 heat-set insert (⌀ 5.6 mm hole).","other":"{n} handles, {centres} mm hole spacing, {projection} mm projection; for M4 heat-set inserts (⌀ 5.6 mm hole)."}, {"one":"{n} ручка, межосевое {centres} мм, вылет {projection} мм; под термовставку M4 (отверстие ⌀ 5,6 мм).","few":"{n} ручки, межосевое {centres} мм, вылет {projection} мм; под термовставку M4 (отверстие ⌀ 5,6 мм).","many":"{n} ручек, межосевое {centres} мм, вылет {projection} мм; под термовставку M4 (отверстие ⌀ 5,6 мм).","other":"{n} ручки, межосевое {centres} мм, вылет {projection} мм; под термовставку M4 (отверстие ⌀ 5,6 мм)."}, p, o);
export const t_furniture_handle_print_side = (p?: Params, o?: Options) => say("Prints on its side.", "Печатается на боку.", p, o);
export const t_furniture_handle_print_face_down = (p?: Params, o?: Options) => say("Prints face down, so the front comes out smooth.", "Печатается ручкой вниз — лицевая сторона гладкая.", p, o);
export const t_furniture_handle_scad_title = (p?: Params, o?: Options) => say("Polyzon Maker — “Furniture handles”", "Polyzon Maker — «Мебельные ручки»", p, o);
export const t_furniture_handle_filename = (p?: Params, o?: Options) => say("handle", "ruchka", p, o);
