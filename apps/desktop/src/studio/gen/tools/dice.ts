// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_dice_summary_d4 = (p?: Params, o?: Options) => say("{kind}: {size} mm tall, numbers {depth} mm deep.", "{kind}: {size} мм в высоту, цифры {depth} мм вглубь.", p, o);
export const t_dice_summary_numbers = (p?: Params, o?: Options) => say("{kind}: {size} mm face to face, numbers {depth} mm deep.", "{kind}: {size} мм между гранями, цифры {depth} мм вглубь.", p, o);
export const t_dice_summary_pips = (p?: Params, o?: Options) => say("{kind}: {size} mm face to face, pips {depth} mm deep.", "{kind}: {size} мм между гранями, точки {depth} мм вглубь.", p, o);
export const t_dice_header_title = (p?: Params, o?: Options) => say("Polyzon Maker — “Dice”", "Polyzon Maker — «Игральные кубики»", p, o);
export const t_dice_header_print = (p?: Params, o?: Options) => say("Lies on a face, prints without supports", "Лежит на грани, печатается без поддержек", p, o);
export const t_dice_face_pips = (p?: Params, o?: Options) => say("Pips", "Точки", p, o);
export const t_dice_face_numbers = (p?: Params, o?: Options) => say("Numbers", "Цифры", p, o);
export const t_dice_filename = (p?: Params, o?: Options) => say("dice", "kubik", p, o);
export const t_dice_group = (p?: Params, o?: Options) => say("Die", "Кубик", p, o);
export const t_dice_kind = (p?: Params, o?: Options) => say("Sides", "Граней", p, o);
export const t_dice_kind_hint = (p?: Params, o?: Options) => say("Opposite faces add up just like on store-bought dice: 7 on a d6, 21 on a d20, 9 on a d10.", "Противоположные грани в сумме — как у магазинных: d6 — 7, d20 — 21, d10 — 9.", p, o);
export const t_dice_faces = (p?: Params, o?: Options) => say("On the faces", "На гранях", p, o);
export const t_dice_size = (p?: Params, o?: Options) => say("Face to face", "Между гранями", p, o);
export const t_dice_depth_pips = (p?: Params, o?: Options) => say("Pip depth", "Глубина точек", p, o);
export const t_dice_depth_numbers = (p?: Params, o?: Options) => say("Number depth", "Глубина цифр", p, o);
export const t_dice_depth_hint = (p?: Params, o?: Options) => say("Rub paint or wax into the numbers and pips to make them stand out.", "Цифры и точки можно затереть краской или воском — станут контрастными.", p, o);
