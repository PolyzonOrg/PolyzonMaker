// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_filament_swatch_colour_default = (p?: Params, o?: Options) => say("White", "Белый", p, o);
export const t_filament_swatch_preset_petg_colour = (p?: Params, o?: Options) => say("Clear", "Прозрачный", p, o);
export const t_filament_swatch_preset_thin = (p?: Params, o?: Options) => say("Fine steps", "Тонкие шаги", p, o);
export const t_filament_swatch_preset_small = (p?: Params, o?: Options) => say("Small", "Маленькая", p, o);
export const t_filament_swatch_group_label = (p?: Params, o?: Options) => say("Label", "Подпись", p, o);
export const t_filament_swatch_maker = (p?: Params, o?: Options) => say("Brand", "Производитель", p, o);
export const t_filament_swatch_colour = (p?: Params, o?: Options) => say("Color", "Цвет", p, o);
export const t_filament_swatch_temps = (p?: Params, o?: Options) => say("Temperatures", "Температуры", p, o);
export const t_filament_swatch_temps_hint = (p?: Params, o?: Options) => say("Nozzle and bed, in whatever format you like.", "Сопло и стол, как вам удобно.", p, o);
export const t_filament_swatch_group_card = (p?: Params, o?: Options) => say("Card", "Карточка", p, o);
export const t_filament_swatch_steps = (p?: Params, o?: Options) => say("Steps", "Ступенек", p, o);
export const t_filament_swatch_step = (p?: Params, o?: Options) => say("Step size", "Шаг ступенек", p, o);
export const t_filament_swatch_step_hint = (p?: Params, o?: Options) => say("How much thicker each step is than the one before; the thickest is the card itself.", "Насколько каждая ступенька толще предыдущей; самая толстая — сама карточка.", p, o);
export const t_filament_swatch_summary = (p?: Params, o?: Options) => say({"one":"A {width} × {height} mm card, {n} step from {from} to {to} mm. Print it in the filament you're labeling.","other":"A {width} × {height} mm card, {n} steps from {from} to {to} mm. Print it in the filament you're labeling."}, {"one":"Карточка {width} × {height} мм, {n} ступенька от {from} до {to} мм. Печатайте тем пластиком, который подписываете.","few":"Карточка {width} × {height} мм, {n} ступеньки от {from} до {to} мм. Печатайте тем пластиком, который подписываете.","many":"Карточка {width} × {height} мм, {n} ступенек от {from} до {to} мм. Печатайте тем пластиком, который подписываете.","other":"Карточка {width} × {height} мм, {n} ступеньки от {from} до {to} мм. Печатайте тем пластиком, который подписываете."}, p, o);
export const t_filament_swatch_scad_title = (p?: Params, o?: Options) => say("Polyzon Maker — “Filament swatches”", "Polyzon Maker — «Образцы пластика»", p, o);
export const t_filament_swatch_filename = (p?: Params, o?: Options) => say("swatch", "obrazec", p, o);
export const t_filament_swatch_plastic_filename = (p?: Params, o?: Options) => say("filament", "plastik", p, o);
