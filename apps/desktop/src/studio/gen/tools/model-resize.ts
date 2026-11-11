// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_model_resize_position = (p?: Params, o?: Options) => say("Orientation", "Положение", p, o);
export const t_model_resize_flat = (p?: Params, o?: Options) => say("Lay flat side down", "Положить плоской стороной", p, o);
export const t_model_resize_flat_hint = (p?: Params, o?: Options) => say("Puts the largest flat face on the bed, square to its edges — like “Place on face” in a slicer.", "Самой большой плоской гранью на стол и ровно по краям стола, как «Положить на грань» в слайсере.", p, o);
export const t_model_resize_no_flat = (p?: Params, o?: Options) => say("There's no flat face — the model stays as it is in the file.", "Плоской грани нет — модель стоит, как в файле.", p, o);
export const t_model_resize_turn = (p?: Params, o?: Options) => say("Rotate around {axis}", "Повернуть вокруг {axis}", p, o);
export const t_model_resize_mirror = (p?: Params, o?: Options) => say("Mirror", "Отразить зеркально", p, o);
export const t_model_resize_mirror_hint = (p?: Params, o?: Options) => say("Turns a right-hand part into a left-hand one: left and right swap.", "Левая деталь из правой: слева направо меняется местами.", p, o);
export const t_model_resize_by = (p?: Params, o?: Options) => say("Set by", "Задать", p, o);
export const t_model_resize_scale = (p?: Params, o?: Options) => say("Scale", "Масштаб", p, o);
export const t_model_resize_max = (p?: Params, o?: Options) => say("Longest side", "Наибольшая сторона", p, o);
export const t_model_resize_value_hint = (p?: Params, o?: Options) => say("Proportions are kept: the other sides change along with this one.", "Пропорции сохраняются: остальные стороны меняются вместе с этой.", p, o);
export const t_model_resize_size = (p?: Params, o?: Options) => say("{x} × {y} × {z} mm, scale {scale}%.", "{x} × {y} × {z} мм, масштаб {scale} %.", p, o);
export const t_model_resize_too_big = (p?: Params, o?: Options) => say("Bigger than the bed of most printers ({bed} mm) — split it into parts with “Cut model”.", "Больше стола большинства принтеров ({bed} мм) — разрежьте модель на части в «Разрезать модель».", p, o);
export const t_model_resize_empty = (p?: Params, o?: Options) => say("Open a model — we'll give it an exact size and lay it flat side down on the bed.", "Откройте модель — зададим ей точный размер и положим плоской стороной на стол.", p, o);
