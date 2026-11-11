// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_model_simplify_triangles_millions = (p?: Params, o?: Options) => say("{n} million triangles", "{n} млн треугольников", p, o);
export const t_model_simplify_triangles = (p?: Params, o?: Options) => say({"one":"{n} triangle","other":"{n} triangles"}, {"one":"{n} треугольник","few":"{n} треугольника","many":"{n} треугольников","other":"{n} треугольника"}, p, o);
export const t_model_simplify_times = (p?: Params, o?: Options) => say({"one":"{n}×","other":"{n}×"}, {"one":"в {n} раз","few":"в {n} раза","many":"в {n} раз","other":"в {n} раза"}, p, o);
export const t_model_simplify_summary_simple = (p?: Params, o?: Options) => say("The mesh is already simple ({triangles}) — there's almost nothing to simplify.", "Сетка и так простая ({triangles}) — упрощать почти нечего.", p, o);
export const t_model_simplify_summary = (p?: Params, o?: Options) => say("From {before} down to {after} — {times} fewer. The volume changed by {change}%.", "Было {before}, стало {after} — {times} меньше. Объём изменился на {change} %.", p, o);
export const t_model_simplify_change_tiny = (p?: Params, o?: Options) => say("less than 0.1", "меньше чем 0,1", p, o);
export const t_model_simplify_tolerance_option = (p?: Params, o?: Options) => say("{size} mm", "{size} мм", p, o);
export const t_model_simplify_filename = (p?: Params, o?: Options) => say("simplified", "prosche", p, o);
export const t_model_simplify_busy = (p?: Params, o?: Options) => say("Simplifying…", "Упрощаем…", p, o);
export const t_model_simplify_file_info = (p?: Params, o?: Options) => say("{triangles} in the file; {size} as STL.", "В файле {triangles}, STL — {size}.", p, o);
export const t_model_simplify_group = (p?: Params, o?: Options) => say("Simplification", "Упрощение", p, o);
export const t_model_simplify_tolerance = (p?: Params, o?: Options) => say("Accuracy", "Точность", p, o);
export const t_model_simplify_tolerance_hint = (p?: Params, o?: Options) => say("How far the surface may shift. A 0.4 mm nozzle can't print a difference under 0.05 mm; 0.2 is plenty for viewing on a website.", "На сколько поверхность может сдвинуться. Сопло 0,4 мм не напечатает разницы меньше 0,05 мм; для просмотра на сайте хватит 0,2.", p, o);
export const t_model_simplify_empty = (p?: Params, o?: Options) => say("Open a heavy model — we'll keep just as many triangles as printing needs.", "Откройте тяжёлую модель — оставим столько треугольников, сколько нужно для печати.", p, o);
