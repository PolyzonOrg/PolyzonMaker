// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_keycap_preset_six = (p?: Params, o?: Options) => say("Six 1u", "Шесть 1u", p, o);
export const t_keycap_preset_enter = (p?: Params, o?: Options) => say("Enter 2.25u", "Enter 2,25u", p, o);
export const t_keycap_preset_space = (p?: Params, o?: Options) => say("Spacebar 6.25u", "Пробел 6,25u", p, o);
export const t_keycap_cap = (p?: Params, o?: Options) => say("Keycap", "Колпачок", p, o);
export const t_keycap_size_hint = (p?: Params, o?: Options) => say("1u is a regular key; from 2u up, the cap gets stabilizer stems.", "1u — обычная клавиша; от 2u появляются стойки под стабилизаторы.", p, o);
export const t_keycap_dish = (p?: Params, o?: Options) => say("Dish depth", "Глубина чашки", p, o);
export const t_keycap_dish_hint = (p?: Params, o?: Options) => say("How far the top dips for your fingertip. 0 is flat.", "Вогнутость верха под палец. 0 — плоский.", p, o);
export const t_keycap_fit = (p?: Params, o?: Options) => say("Switch fit", "Посадка на свитч", p, o);
export const t_keycap_fit_hint = (p?: Params, o?: Options) => say("How much wider than standard the cross socket is. Won't go on — add 0.05; wobbles — take some off.", "Насколько крестовина шире стандартной. Не надевается — прибавьте 0,05; болтается — убавьте.", p, o);
export const t_keycap_legend = (p?: Params, o?: Options) => say("Legend", "Текст на клавише", p, o);
export const t_keycap_legend_size = (p?: Params, o?: Options) => say("Legend size", "Размер букв", p, o);
export const t_keycap_summary = (p?: Params, o?: Options) => say("{size}u: {width} × {depth} mm, {height} mm tall, MX stem.", "{size}u: {width} × {depth} мм, высота {height} мм, крестовина MX.", p, o);
export const t_keycap_summary_stabilisers = (p?: Params, o?: Options) => say("{size}u: {width} × {depth} mm, {height} mm tall, MX stem, stabilizer stems {spacing} mm apart.", "{size}u: {width} × {depth} мм, высота {height} мм, крестовина MX, стойки стабилизаторов через {spacing} мм.", p, o);
export const t_keycap_scad_title = (p?: Params, o?: Options) => say("Polyzon Maker — “Keyboard keycaps”", "Polyzon Maker — «Колпачки для клавиатуры»", p, o);
export const t_keycap_scad_print = (p?: Params, o?: Options) => say("Prints upright; for a smooth top, use 0.12 mm layers", "Печатается стоя; для гладкого верха — слой 0,12 мм", p, o);
