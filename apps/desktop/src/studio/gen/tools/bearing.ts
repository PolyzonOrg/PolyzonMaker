// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_bearing_filename = (p?: Params, o?: Options) => say("bearing", "podshipnik", p, o);
export const t_bearing_sizes = (p?: Params, o?: Options) => say("Standard sizes", "Готовые размеры", p, o);
export const t_bearing_sizes_hint = (p?: Params, o?: Options) => say("ISO 15 sizes: the bearing replaces a factory one with the same number.", "Размеры по ISO 15: подшипник встаёт вместо заводского того же номера.", p, o);
export const t_bearing_outer = (p?: Params, o?: Options) => say("Outer diameter", "Наружный диаметр", p, o);
export const t_bearing_summary = (p?: Params, o?: Options) => say("{bore} × {outer} × {width} mm, {rollers} ⌀ {roller} mm, {clearance} mm clearance.", "{bore} × {outer} × {width} мм, {rollers} ⌀ {roller} мм, зазор {clearance} мм.", p, o);
export const t_bearing_summary_as = (p?: Params, o?: Options) => say("Same as {name}: {bore} × {outer} × {width} mm, {rollers} ⌀ {roller} mm, {clearance} mm clearance.", "Как {name}: {bore} × {outer} × {width} мм, {rollers} ⌀ {roller} мм, зазор {clearance} мм.", p, o);
export const t_bearing_rollers = (p?: Params, o?: Options) => say({"one":"{n} roller","other":"{n} rollers"}, {"one":"{n} ролик","few":"{n} ролика","many":"{n} роликов","other":"{n} ролика"}, p, o);
export const t_bearing_gaps = (p?: Params, o?: Options) => say("Clearances", "Зазоры", p, o);
export const t_bearing_clearance = (p?: Params, o?: Options) => say("Clearance between parts", "Зазор между деталями", p, o);
export const t_bearing_clearance_hint = (p?: Params, o?: Options) => say("0.3 mm suits a 0.4 mm nozzle and 0.2 mm layers. After printing, turn the ring to break the rollers loose.", "0,3 мм — для сопла 0,4 и слоя 0,2. После печати проверните кольцо, чтобы ролики отлипли.", p, o);
export const t_bearing_fit = (p?: Params, o?: Options) => say("Shaft allowance", "Запас на вал", p, o);
export const t_bearing_fit_hint = (p?: Params, o?: Options) => say("The bore gets bigger by this much: 0.1 mm is a snug fit, 0.2 a loose one.", "Отверстие станет больше на эту величину: 0,1 мм — плотно, 0,2 — свободно.", p, o);
export const t_bearing_header_title = (p?: Params, o?: Options) => say("Polyzon Maker — “Bearing” (prints assembled, ISO 15 sizes)", "Polyzon Maker — «Подшипник» (печать целиком, размеры по ISO 15)", p, o);
export const t_bearing_header_print = (p?: Params, o?: Options) => say("Rollers with a 45° ridge run in V-grooves in the rings; prints upright, no supports", "Ролики с гребнем 45° бегут в V-канавках колец; печатается стоя, без поддержек", p, o);
