// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_shelf_bracket_preset_shelf = (p?: Params, o?: Options) => say("Shelf bracket", "Кронштейн полки", p, o);
export const t_shelf_bracket_preset_small = (p?: Params, o?: Options) => say("Small", "Маленький", p, o);
export const t_shelf_bracket_preset_corner = (p?: Params, o?: Options) => say("Corner brace", "Мебельный уголок", p, o);
export const t_shelf_bracket_preset_tee = (p?: Params, o?: Options) => say("T-plate", "Т-пластина", p, o);
export const t_shelf_bracket_preset_straight = (p?: Params, o?: Options) => say("Straight plate", "Прямая пластина", p, o);
export const t_shelf_bracket_group_part = (p?: Params, o?: Options) => say("Part", "Деталь", p, o);
export const t_shelf_bracket_kind = (p?: Params, o?: Options) => say("Type", "Что", p, o);
export const t_shelf_bracket_kind_shelf = (p?: Params, o?: Options) => say("Bracket", "Кронштейн", p, o);
export const t_shelf_bracket_kind_corner = (p?: Params, o?: Options) => say("Corner brace", "Уголок", p, o);
export const t_shelf_bracket_kind_tee = (p?: Params, o?: Options) => say("T-plate", "Т-пластина", p, o);
export const t_shelf_bracket_kind_straight = (p?: Params, o?: Options) => say("Straight", "Прямая", p, o);
export const t_shelf_bracket_arm_wall = (p?: Params, o?: Options) => say("Along the wall", "По стене", p, o);
export const t_shelf_bracket_arm_first = (p?: Params, o?: Options) => say("First arm", "Первое плечо", p, o);
export const t_shelf_bracket_arm_shelf = (p?: Params, o?: Options) => say("Under the shelf", "Под полкой", p, o);
export const t_shelf_bracket_arm_second = (p?: Params, o?: Options) => say("Second arm", "Второе плечо", p, o);
export const t_shelf_bracket_gusset = (p?: Params, o?: Options) => say("Gusset", "Косынка", p, o);
export const t_shelf_bracket_gusset_hint = (p?: Params, o?: Options) => say("A triangular rib between the arms — much stiffer.", "Треугольное ребро между плечами — намного жёстче.", p, o);
export const t_shelf_bracket_group_fasteners = (p?: Params, o?: Options) => say("Fasteners", "Крепёж", p, o);
export const t_shelf_bracket_screw = (p?: Params, o?: Options) => say("Screw", "Саморез", p, o);
export const t_shelf_bracket_holes = (p?: Params, o?: Options) => say("Holes per arm", "Отверстий на плечо", p, o);
export const t_shelf_bracket_summary_count = (p?: Params, o?: Options) => say({"one":"{n} part.","other":"{n} parts."}, {"one":"{n} деталь.","few":"{n} детали.","many":"{n} деталей.","other":"{n} детали."}, p, o);
export const t_shelf_bracket_summary_shelf = (p?: Params, o?: Options) => say("A {a} × {b} mm bracket. It prints on its side, so the bend won't split along the layers; for pan-head screws.", "Кронштейн {a} × {b} мм, печатается на боку — изгиб не сломается по слоям; под саморезы с полукруглой головкой.", p, o);
export const t_shelf_bracket_summary_plate = (p?: Params, o?: Options) => say("A plate for {screw} mm countersunk screws.", "Пластина под потайные саморезы {screw} мм.", p, o);
export const t_shelf_bracket_scad_title = (p?: Params, o?: Options) => say("Polyzon Maker — “Brackets and corner braces”", "Polyzon Maker — «Уголки и кронштейны»", p, o);
export const t_shelf_bracket_filename = (p?: Params, o?: Options) => say("bracket", "ugolok", p, o);
