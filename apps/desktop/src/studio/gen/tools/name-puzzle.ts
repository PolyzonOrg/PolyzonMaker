// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_name_puzzle_default_name = (p?: Params, o?: Options) => say("EMMA", "МАША", p, o);
export const t_name_puzzle_preset_kids = (p?: Params, o?: Options) => say("For toddlers", "Для малышей", p, o);
export const t_name_puzzle_preset_long = (p?: Params, o?: Options) => say("Long name", "Длинное имя", p, o);
export const t_name_puzzle_preset_long_name = (p?: Params, o?: Options) => say("ALEXANDER", "АЛЕКСАНДР", p, o);
export const t_name_puzzle_preset_round = (p?: Params, o?: Options) => say("Rounded letters", "Круглые буквы", p, o);
export const t_name_puzzle_part_tray = (p?: Params, o?: Options) => say("Tray", "Лоток", p, o);
export const t_name_puzzle_part_letter = (p?: Params, o?: Options) => say("Letter {letter}", "Буква {letter}", p, o);
export const t_name_puzzle_summary_empty = (p?: Params, o?: Options) => say("Enter a name.", "Впишите имя.", p, o);
export const t_name_puzzle_summary = (p?: Params, o?: Options) => say({"one":"{n} letter, {cap} mm tall; tray {width} × {height} mm.","other":"{n} letters, {cap} mm tall; tray {width} × {height} mm."}, {"one":"{n} буква по {cap} мм; лоток {width} × {height} мм.","few":"{n} буквы по {cap} мм; лоток {width} × {height} мм.","many":"{n} букв по {cap} мм; лоток {width} × {height} мм.","other":"{n} буквы по {cap} мм; лоток {width} × {height} мм."}, p, o);
export const t_name_puzzle_scad_title = (p?: Params, o?: Options) => say("Polyzon Maker — “Name puzzle”", "Polyzon Maker — «Именной пазл»", p, o);
export const t_name_puzzle_scad_name = (p?: Params, o?: Options) => say("“{name}”: {summary}", "«{name}»: {summary}", p, o);
export const t_name_puzzle_scad_gap = (p?: Params, o?: Options) => say("Slot clearance {gap} mm, letters {thickness} mm", "Зазор в гнёздах {gap} мм, буквы {thickness} мм", p, o);
export const t_name_puzzle_filename = (p?: Params, o?: Options) => say("name-puzzle", "imennoj-pazl", p, o);
export const t_name_puzzle_3mf_failed = (p?: Params, o?: Options) => say("Couldn't build the 3MF.", "Не удалось собрать 3MF.", p, o);
export const t_name_puzzle_group_name = (p?: Params, o?: Options) => say("Name", "Имя", p, o);
export const t_name_puzzle_name = (p?: Params, o?: Options) => say("Name", "Имя", p, o);
export const t_name_puzzle_name_hint = (p?: Params, o?: Options) => say("Capital letters, no spaces. Accent marks (as in É or Ö) become separate tiny pieces: for kids under three, stick to plain letters.", "Заглавными, без пробелов. Точки над Ё и кратка над Й — отдельные кусочки: малышам до трёх лет лучше Е и И.", p, o);
export const t_name_puzzle_cap_hint = (p?: Params, o?: Options) => say("Letters 35 mm and up are easy for small hands to grab.", "Буквы от 35 мм удобно брать маленькой рукой.", p, o);
export const t_name_puzzle_spacing = (p?: Params, o?: Options) => say("Letter spacing", "Между буквами", p, o);
export const t_name_puzzle_group_pieces = (p?: Params, o?: Options) => say("Letters and tray", "Буквы и лоток", p, o);
export const t_name_puzzle_thickness = (p?: Params, o?: Options) => say("Letter thickness", "Толщина букв", p, o);
export const t_name_puzzle_depth = (p?: Params, o?: Options) => say("Slot depth", "Глубина гнёзд", p, o);
export const t_name_puzzle_depth_hint = (p?: Params, o?: Options) => say("Less than the letter thickness: the letters stick up above the tray and are easy to pull out.", "Меньше толщины букв: они выступают над лотком, их легко достать.", p, o);
export const t_name_puzzle_floor = (p?: Params, o?: Options) => say("Tray floor", "Дно лотка", p, o);
export const t_name_puzzle_gap = (p?: Params, o?: Options) => say("Slot clearance", "Зазор в гнёздах", p, o);
export const t_name_puzzle_gap_hint = (p?: Params, o?: Options) => say("0.5 mm — the letter goes in easily but doesn't wobble.", "0,5 мм — буква входит свободно, но не болтается.", p, o);
