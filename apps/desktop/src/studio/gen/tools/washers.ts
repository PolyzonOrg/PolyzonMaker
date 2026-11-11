// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_washers_preset_m3 = (p?: Params, o?: Options) => say("M3 washers ×20", "Шайбы M3 ×20", p, o);
export const t_washers_preset_wide = (p?: Params, o?: Options) => say("Wide M5 ×10", "Широкие M5 ×10", p, o);
export const t_washers_preset_spacer = (p?: Params, o?: Options) => say("10 mm spacers", "Проставки 10 мм", p, o);
export const t_washers_preset_gasket = (p?: Params, o?: Options) => say("TPU gasket", "Прокладка для TPU", p, o);
export const t_washers_kind_din125 = (p?: Params, o?: Options) => say("DIN 125 washer", "Шайба DIN 125", p, o);
export const t_washers_kind_din9021 = (p?: Params, o?: Options) => say("Wide DIN 9021", "Широкая DIN 9021", p, o);
export const t_washers_kind_spacer = (p?: Params, o?: Options) => say("Spacer", "Проставка", p, o);
export const t_washers_kind_ring = (p?: Params, o?: Options) => say("Ring or gasket", "Кольцо, прокладка", p, o);
export const t_washers_section_square = (p?: Params, o?: Options) => say("Flat", "Плоская", p, o);
export const t_washers_section_round = (p?: Params, o?: Options) => say("Round", "Круглое сечение", p, o);
export const t_washers_group_part = (p?: Params, o?: Options) => say("Part", "Деталь", p, o);
export const t_washers_kind = (p?: Params, o?: Options) => say("What to print", "Что печатаем", p, o);
export const t_washers_size = (p?: Params, o?: Options) => say("Thread", "Резьба", p, o);
export const t_washers_size_hint = (p?: Params, o?: Options) => say("A washer thinner than 0.6 mm won't print — thinner standard sizes become 0.6 mm.", "Тоньше 0,6 мм шайба не печатается — тонкие из стандарта станут 0,6 мм.", p, o);
export const t_washers_inner = (p?: Params, o?: Options) => say("Inner diameter", "Внутри", p, o);
export const t_washers_outer = (p?: Params, o?: Options) => say("Outer diameter", "Снаружи", p, o);
export const t_washers_section = (p?: Params, o?: Options) => say("Cross-section", "Сечение", p, o);
export const t_washers_section_hint = (p?: Params, o?: Options) => say("Print in TPU. A flat gasket prints better; a round cross-section works like a rubber O-ring, but the underside sags a little.", "Печатайте из TPU. Плоская прокладка печатается лучше; круглое сечение — как резиновое кольцо, низ немного провиснет.", p, o);
export const t_washers_summary_din125 = (p?: Params, o?: Options) => say({"one":"{n} DIN 125-A washer: ⌀ {inner} × ⌀ {outer} × {height} mm.","other":"{n} DIN 125-A washers: ⌀ {inner} × ⌀ {outer} × {height} mm."}, {"one":"{n} шайба по DIN 125-A: ⌀ {inner} × ⌀ {outer} × {height} мм.","few":"{n} шайбы по DIN 125-A: ⌀ {inner} × ⌀ {outer} × {height} мм.","many":"{n} шайб по DIN 125-A: ⌀ {inner} × ⌀ {outer} × {height} мм.","other":"{n} шайбы по DIN 125-A: ⌀ {inner} × ⌀ {outer} × {height} мм."}, p, o);
export const t_washers_summary_din9021 = (p?: Params, o?: Options) => say({"one":"{n} DIN 9021 wide washer: ⌀ {inner} × ⌀ {outer} × {height} mm.","other":"{n} DIN 9021 wide washers: ⌀ {inner} × ⌀ {outer} × {height} mm."}, {"one":"{n} широкая шайба по DIN 9021: ⌀ {inner} × ⌀ {outer} × {height} мм.","few":"{n} широкие шайбы по DIN 9021: ⌀ {inner} × ⌀ {outer} × {height} мм.","many":"{n} широких шайб по DIN 9021: ⌀ {inner} × ⌀ {outer} × {height} мм.","other":"{n} широкой шайбы по DIN 9021: ⌀ {inner} × ⌀ {outer} × {height} мм."}, p, o);
export const t_washers_summary_spacer = (p?: Params, o?: Options) => say({"one":"{n} spacer: ⌀ {inner} × ⌀ {outer} × {height} mm.","other":"{n} spacers: ⌀ {inner} × ⌀ {outer} × {height} mm."}, {"one":"{n} проставка: ⌀ {inner} × ⌀ {outer} × {height} мм.","few":"{n} проставки: ⌀ {inner} × ⌀ {outer} × {height} мм.","many":"{n} проставок: ⌀ {inner} × ⌀ {outer} × {height} мм.","other":"{n} проставки: ⌀ {inner} × ⌀ {outer} × {height} мм."}, p, o);
export const t_washers_summary_ring = (p?: Params, o?: Options) => say({"one":"{n} ring: ⌀ {inner} × ⌀ {outer} × {height} mm.","other":"{n} rings: ⌀ {inner} × ⌀ {outer} × {height} mm."}, {"one":"{n} кольцо: ⌀ {inner} × ⌀ {outer} × {height} мм.","few":"{n} кольца: ⌀ {inner} × ⌀ {outer} × {height} мм.","many":"{n} колец: ⌀ {inner} × ⌀ {outer} × {height} мм.","other":"{n} кольца: ⌀ {inner} × ⌀ {outer} × {height} мм."}, p, o);
export const t_washers_header_title = (p?: Params, o?: Options) => say("Polyzon Maker — “Washers and spacers”", "Polyzon Maker — «Шайбы и проставки»", p, o);
