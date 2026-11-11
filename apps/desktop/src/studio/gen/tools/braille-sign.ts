// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_braille_sign_preset_room = (p?: Params, o?: Options) => say("Room", "Кабинет", p, o);
export const t_braille_sign_sample_room = (p?: Params, o?: Options) => say("Room 12", "Кабинет 12", p, o);
export const t_braille_sign_preset_wc = (p?: Params, o?: Options) => say("Restroom", "Туалет", p, o);
export const t_braille_sign_sample_wc = (p?: Params, o?: Options) => say("Restroom", "Туалет", p, o);
export const t_braille_sign_preset_exit = (p?: Params, o?: Options) => say("Exit", "Выход", p, o);
export const t_braille_sign_sample_exit = (p?: Params, o?: Options) => say("Exit", "Выход", p, o);
export const t_braille_sign_preset_two_lines = (p?: Params, o?: Options) => say("Two lines", "Две строки", p, o);
export const t_braille_sign_sample_two_lines = (p?: Params, o?: Options) => say("Reception\nDesk 3", "Регистратура\nОкно 3", p, o);
export const t_braille_sign_line = (p?: Params, o?: Options) => say("Line {n}", "Строка {n}", p, o);
export const t_braille_sign_braille_note = (p?: Params, o?: Options) => say("Under each line, the same text in Braille: Latin and Cyrillic letters, numbers, and punctuation. Dots ⌀ 1.5 mm and 0.6 mm high, 2.7 mm pitch, characters 6.6 mm apart — the standard font of GOST R 56832-2020 (Russian standard).", "Под каждой строкой — она же шрифтом Брайля: русские и латинские буквы, цифры, знаки препинания. Точки ⌀ 1,5 и высотой 0,6 мм, шаг 2,7 мм, знаки через 6,6 мм — стандартный шрифт ГОСТ Р 56832-2020.", p, o);
export const t_braille_sign_letters_hint = (p?: Params, o?: Options) => say("Raised letters for low-vision readers: 15 mm or taller, in a color that contrasts with the sign.", "Рельефные буквы для слабовидящих: от 15 мм, контрастным цветом к табличке.", p, o);
export const t_braille_sign_letter_relief = (p?: Params, o?: Options) => say("Letter relief", "Выступ букв", p, o);
export const t_braille_sign_plate = (p?: Params, o?: Options) => say("Sign", "Табличка", p, o);
export const t_braille_sign_width_hint = (p?: Params, o?: Options) => say("Grows on its own if a Braille line doesn't fit.", "Растёт сама, если не помещается строка Брайля.", p, o);
export const t_braille_sign_rounding = (p?: Params, o?: Options) => say("Corner rounding", "Скругление", p, o);
export const t_braille_sign_screw_holes = (p?: Params, o?: Options) => say("Screw holes", "Отверстия под шурупы", p, o);
export const t_braille_sign_screw_holes_hint = (p?: Params, o?: Options) => say("Two countersunk holes at the edges; without them, mount it with double-sided tape.", "Два отверстия с зенковкой по краям; без них — на двусторонний скотч.", p, o);
export const t_braille_sign_summary = (p?: Params, o?: Options) => say({"one":"Sign {width} × {height} mm; {n} Braille dot per GOST R 56832-2020 (Russian standard).","other":"Sign {width} × {height} mm; {n} Braille dots per GOST R 56832-2020 (Russian standard)."}, {"one":"Табличка {width} × {height} мм; {n} точка Брайля по ГОСТ Р 56832-2020.","few":"Табличка {width} × {height} мм; {n} точки Брайля по ГОСТ Р 56832-2020.","many":"Табличка {width} × {height} мм; {n} точек Брайля по ГОСТ Р 56832-2020.","other":"Табличка {width} × {height} мм; {n} точки Брайля по ГОСТ Р 56832-2020."}, p, o);
export const t_braille_sign_scad_title = (p?: Params, o?: Options) => say("Polyzon Maker — “Braille signs”", "Polyzon Maker — «Таблички со шрифтом Брайля»", p, o);
export const t_braille_sign_scad_dots = (p?: Params, o?: Options) => say("Dots ⌀ 1.5 × 0.6 mm, 2.7 mm pitch, characters 6.6 mm apart, words 13.2 mm apart; prints face up", "Точки ⌀ 1,5 × 0,6 мм, шаг 2,7 мм, знаки через 6,6 мм, слова через 13,2 мм; печатается лицом вверх", p, o);
export const t_braille_sign_filename = (p?: Params, o?: Options) => say("braille-sign", "tablichka-brajl", p, o);
