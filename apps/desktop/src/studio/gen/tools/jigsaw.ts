// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_jigsaw_filename = (p?: Params, o?: Options) => say("jigsaw", "pazl", p, o);
export const t_jigsaw_preset_kids = (p?: Params, o?: Options) => say("Toddlers, 6 pieces", "Для малышей, 6 частей", p, o);
export const t_jigsaw_preset_gift = (p?: Params, o?: Options) => say("With a message", "С надписью", p, o);
export const t_jigsaw_preset_gift_text = (p?: Params, o?: Options) => say("Happy birthday!", "С днём рождения!", p, o);
export const t_jigsaw_preset_card = (p?: Params, o?: Options) => say("Card, 20 pieces", "Открытка 20 частей", p, o);
export const t_jigsaw_puzzle = (p?: Params, o?: Options) => say("Puzzle", "Пазл", p, o);
export const t_jigsaw_cols = (p?: Params, o?: Options) => say("Pieces across", "Деталей по ширине", p, o);
export const t_jigsaw_rows = (p?: Params, o?: Options) => say("Pieces down", "Деталей по высоте", p, o);
export const t_jigsaw_knob = (p?: Params, o?: Options) => say("Tabs", "Замки", p, o);
export const t_jigsaw_knob_hint = (p?: Params, o?: Options) => say("Tab size relative to the side of a piece.", "Размер замка от стороны детали.", p, o);
export const t_jigsaw_gap = (p?: Params, o?: Options) => say("Clearance between pieces", "Зазор между деталями", p, o);
export const t_jigsaw_gap_hint = (p?: Params, o?: Options) => say("The puzzle prints assembled; at 0.3 mm, the pieces break apart easily by hand.", "Пазл печатается собранным; 0,3 мм — детали разламываются руками без усилия.", p, o);
export const t_jigsaw_reshuffle = (p?: Params, o?: Options) => say("New tab pattern", "Другой рисунок замков", p, o);
export const t_jigsaw_summary = (p?: Params, o?: Options) => say("{pieces}, {w} × {h} mm each; the puzzle is {width} × {height} mm and prints assembled with {gap} mm clearance.", "{pieces} по {w} × {h} мм, пазл {width} × {height} мм; печатается собранным, зазор {gap} мм.", p, o);
export const t_jigsaw_pieces = (p?: Params, o?: Options) => say({"one":"{n} piece","other":"{n} pieces"}, {"one":"{n} деталь","few":"{n} детали","many":"{n} деталей","other":"{n} детали"}, p, o);
export const t_jigsaw_text_and_tray = (p?: Params, o?: Options) => say("Text and tray", "Надпись и рамка", p, o);
export const t_jigsaw_text = (p?: Params, o?: Options) => say("Text on top", "Надпись поверх", p, o);
export const t_jigsaw_text_placeholder = (p?: Params, o?: Options) => say("For example: Happy birthday!", "Например: С днём рождения!", p, o);
export const t_jigsaw_text_hint = (p?: Params, o?: Options) => say("Cut 0.6 mm deep across the whole puzzle — put it together to read it.", "Вырезается на 0,6 мм поперёк всего пазла — собери, чтобы прочитать.", p, o);
export const t_jigsaw_tray = (p?: Params, o?: Options) => say("Tray frame", "Рамка-лоток", p, o);
export const t_jigsaw_tray_hint = (p?: Params, o?: Options) => say("For putting the puzzle together and storing it, with a notch to lift it out.", "Чтобы собирать на ней и хранить; с выемкой, чтобы вынуть пазл.", p, o);
export const t_jigsaw_header_title = (p?: Params, o?: Options) => say("Polyzon Maker — “Jigsaw puzzles”", "Polyzon Maker — «Пазлы»", p, o);
