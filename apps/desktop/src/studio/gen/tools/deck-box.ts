// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_deck_box_preset_tcg = (p?: Params, o?: Options) => say("63 × 88 cards, sleeved", "Карты 63 × 88 в протекторах", p, o);
export const t_deck_box_preset_bare = (p?: Params, o?: Options) => say("63 × 88 cards, unsleeved", "Карты 63 × 88 без протекторов", p, o);
export const t_deck_box_preset_small = (p?: Params, o?: Options) => say("59 × 86 small cards", "Малые карты 59 × 86", p, o);
export const t_deck_box_preset_poker = (p?: Params, o?: Options) => say("54-card deck", "Колода 54 карты", p, o);
export const t_deck_box_filename = (p?: Params, o?: Options) => say("deck-box", "korobka-kart", p, o);
export const t_deck_box_group_cards = (p?: Params, o?: Options) => say("Cards", "Карты", p, o);
export const t_deck_box_card_width = (p?: Params, o?: Options) => say("Card width", "Ширина карты", p, o);
export const t_deck_box_card_width_hint = (p?: Params, o?: Options) => say("Including the sleeve, if any: usually 66 × 91 mm for 63 × 88 cards.", "С протектором, если он есть: обычно 66 × 91 мм для карт 63 × 88.", p, o);
export const t_deck_box_card_height = (p?: Params, o?: Options) => say("Card height", "Высота карты", p, o);
export const t_deck_box_count = (p?: Params, o?: Options) => say("Number of cards", "Сколько карт", p, o);
export const t_deck_box_card_thickness = (p?: Params, o?: Options) => say("Card thickness", "Толщина карты", p, o);
export const t_deck_box_card_thickness_hint = (p?: Params, o?: Options) => say("Unsleeved ≈ 0.3 mm, sleeved ≈ 0.6, double-sleeved ≈ 0.8. For an exact value, measure a stack of 10 cards and divide by 10.", "Без протектора ≈ 0,3 мм, в протекторе ≈ 0,6, в двойном ≈ 0,8. Точнее — измерить пачку из 10 карт и разделить.", p, o);
export const t_deck_box_group_box = (p?: Params, o?: Options) => say("Box", "Коробка", p, o);
export const t_deck_box_clearance = (p?: Params, o?: Options) => say("Clearance around the deck", "Запас вокруг колоды", p, o);
export const t_deck_box_cap = (p?: Params, o?: Options) => say("Lid covers", "Крышка закрывает", p, o);
export const t_deck_box_notch = (p?: Params, o?: Options) => say("Finger notch", "Вырез под палец", p, o);
export const t_deck_box_notch_hint = (p?: Params, o?: Options) => say("A half-circle cut into the front wall makes the deck easy to take out.", "Полукруг в передней стенке: колоду легко достать.", p, o);
export const t_deck_box_summary = (p?: Params, o?: Options) => say({"one":"Inside {width} × {depth} × {height} mm for {n} card; closed box {outerWidth} × {outerDepth} × {outerHeight} mm.","other":"Inside {width} × {depth} × {height} mm for {n} cards; closed box {outerWidth} × {outerDepth} × {outerHeight} mm."}, {"one":"Внутри {width} × {depth} × {height} мм на {n} карту; закрытая коробка {outerWidth} × {outerDepth} × {outerHeight} мм.","few":"Внутри {width} × {depth} × {height} мм на {n} карты; закрытая коробка {outerWidth} × {outerDepth} × {outerHeight} мм.","many":"Внутри {width} × {depth} × {height} мм на {n} карт; закрытая коробка {outerWidth} × {outerDepth} × {outerHeight} мм.","other":"Внутри {width} × {depth} × {height} мм на {n} карты; закрытая коробка {outerWidth} × {outerDepth} × {outerHeight} мм."}, p, o);
export const t_deck_box_header_title = (p?: Params, o?: Options) => say("Polyzon Maker — “Card deck box”", "Polyzon Maker — «Коробка для карт»", p, o);
export const t_deck_box_header_print = (p?: Params, o?: Options) => say("Base and lid print open side up", "Основание и крышка печатаются открытой стороной вверх", p, o);
