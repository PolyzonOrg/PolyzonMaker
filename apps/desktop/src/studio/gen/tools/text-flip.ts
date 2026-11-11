// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_text_flip_words = (p?: Params, o?: Options) => say("Words", "Слова", p, o);
export const t_text_flip_front = (p?: Params, o?: Options) => say("Word from the front", "Слово спереди", p, o);
export const t_text_flip_front_placeholder = (p?: Params, o?: Options) => say("e.g., MOM", "Например, ДОМ", p, o);
export const t_text_flip_sample_front = (p?: Params, o?: Options) => say("SUMMER", "ЛЕТО", p, o);
export const t_text_flip_side = (p?: Params, o?: Options) => say("Word from the right", "Слово справа", p, o);
export const t_text_flip_side_placeholder = (p?: Params, o?: Options) => say("e.g., DAD", "Например, КОТ", p, o);
export const t_text_flip_sample_side = (p?: Params, o?: Options) => say("WINTER", "ЗИМА", p, o);
export const t_text_flip_uppercase = (p?: Params, o?: Options) => say("Capitals only", "Только заглавные", p, o);
export const t_text_flip_uppercase_hint = (p?: Params, o?: Options) => say("Capital letters are all the same height, so each pair holds together more securely.", "Заглавные буквы одной высоты, поэтому пары держатся друг за друга надёжнее.", p, o);
export const t_text_flip_different_lengths = (p?: Params, o?: Options) => say("The words are different lengths: letters of the shorter word repeat in neighboring blocks, and it still reads only once.", "Слова разной длины: буквы короткого слова повторяются в соседних блоках и всё равно читаются один раз.", p, o);
export const t_text_flip_pairs_missed = (p?: Params, o?: Options) => say("These didn't intersect: {pairs}. Those letters will be missing — try a bolder weight.", "Не пересеклись: {pairs}. Этих букв не будет — попробуйте начертание жирнее.", p, o);
export const t_text_flip_pair = (p?: Params, o?: Options) => say("{a} and {b}", "{a} и {b}", p, o);
export const t_text_flip_size_shape = (p?: Params, o?: Options) => say("Size and shape", "Размер и форма", p, o);
export const t_text_flip_weight = (p?: Params, o?: Options) => say("Font weight", "Начертание", p, o);
export const t_text_flip_weight_hint = (p?: Params, o?: Options) => say("Thick strokes make strong intersections.", "Толстые штрихи дают прочные пересечения.", p, o);
export const t_text_flip_spacing = (p?: Params, o?: Options) => say("Gap between blocks", "Зазор между блоками", p, o);
export const t_text_flip_base_hint = (p?: Params, o?: Options) => say("Joins all the letters into one part.", "Связывает все буквы в одну деталь.", p, o);
export const t_text_flip_base_thickness = (p?: Params, o?: Options) => say("Base thickness", "Толщина подставки", p, o);
export const t_text_flip_reading_hint = (p?: Params, o?: Options) => say("The first word reads from the front, the second from the right. If the letters have overhangs, turn on supports in your slicer.", "Спереди читается первое слово, справа — второе. Если у букв есть нависающие части, включите поддержки в слайсере.", p, o);
export const t_text_flip_empty = (p?: Params, o?: Options) => say("Type two words — the first shows from the front, the second from the right.", "Напишите два слова — первое будет видно спереди, второе справа.", p, o);
export const t_text_flip_both_words = (p?: Params, o?: Options) => say("Type both words — at least one letter each.", "Напишите оба слова — хотя бы по одной букве.", p, o);
export const t_text_flip_no_overlap = (p?: Params, o?: Options) => say("The letters didn't intersect — try other words or a bolder weight.", "Буквы не пересеклись — попробуйте другие слова или начертание жирнее.", p, o);
export const t_text_flip_word_filename = (p?: Params, o?: Options) => say("word", "slovo", p, o);
