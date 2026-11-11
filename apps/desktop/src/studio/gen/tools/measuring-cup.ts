// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_measuring_cup_preset_spoons = (p?: Params, o?: Options) => say("Teaspoon and tablespoon", "Чайная и столовая ложки", p, o);
export const t_measuring_cup_preset_set = (p?: Params, o?: Options) => say("Spoon set", "Набор ложек", p, o);
export const t_measuring_cup_preset_coffee = (p?: Params, o?: Options) => say("Coffee scoop", "Мерка для кофе", p, o);
export const t_measuring_cup_preset_glass = (p?: Params, o?: Options) => say("200 ml cup", "Стакан 200 мл", p, o);
export const t_measuring_cup_preset_cups = (p?: Params, o?: Options) => say("50, 100, and 200 ml", "¼, ½ и 1 стакан", p, o);
export const t_measuring_cup_volume = (p?: Params, o?: Options) => say("{volume} ml", "{volume} мл", p, o);
export const t_measuring_cup_summary = (p?: Params, o?: Options) => say({"one":"{n} measure: {list} — that's exactly what it holds, filled to the brim. For food, use PETG or PLA without additives.","other":"{n} measures: {list} — that's exactly what each holds, filled to the brim. For food, use PETG or PLA without additives."}, {"one":"{n} мерка: {list} — внутренний объём ровно такой, до края. Для продуктов — PETG или PLA без добавок.","few":"{n} мерки: {list} — внутренний объём ровно такой, до края. Для продуктов — PETG или PLA без добавок.","many":"{n} мерок: {list} — внутренний объём ровно такой, до края. Для продуктов — PETG или PLA без добавок.","other":"{n} мерки: {list} — внутренний объём ровно такой, до края. Для продуктов — PETG или PLA без добавок."}, p, o);
export const t_measuring_cup_scad_title = (p?: Params, o?: Options) => say("Polyzon Maker — “Measuring spoons and cups”", "Polyzon Maker — «Мерные ложки и стаканы»", p, o);
export const t_measuring_cup_filename = (p?: Params, o?: Options) => say("measures", "merki", p, o);
export const t_measuring_cup_group_volume = (p?: Params, o?: Options) => say("Volume", "Объём", p, o);
export const t_measuring_cup_volumes = (p?: Params, o?: Options) => say("Milliliters", "Сколько миллилитров", p, o);
export const t_measuring_cup_volumes_hint = (p?: Params, o?: Options) => say("For several, separate them with a comma and a space: “2.5, 5, 15”. A teaspoon is 5 ml, a tablespoon 15, a US cup about 240.", "Несколько — через запятую с пробелом: «2,5, 5, 15». Чайная ложка — 5 мл, столовая — 15, стакан — 200.", p, o);
export const t_measuring_cup_ratio = (p?: Params, o?: Options) => say("Height to width", "Высота к ширине", p, o);
export const t_measuring_cup_ratio_hint = (p?: Params, o?: Options) => say("Below 1 makes a wide spoon; above 1, a narrow cup.", "Ниже 1 — широкая ложка, выше — узкий стакан.", p, o);
export const t_measuring_cup_handle = (p?: Params, o?: Options) => say("Labeled handle", "Ручка с подписью", p, o);
export const t_measuring_cup_handle_hint = (p?: Params, o?: Options) => say("Without a handle, the volume is debossed on the bottom.", "Без ручки объём вдавлен на дне.", p, o);
