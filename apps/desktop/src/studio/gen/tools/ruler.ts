// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_ruler_preset_150 = (p?: Params, o?: Options) => say("15 cm ruler", "Линейка 15 см", p, o);
export const t_ruler_preset_200 = (p?: Params, o?: Options) => say("20 cm ruler", "Линейка 20 см", p, o);
export const t_ruler_preset_small = (p?: Params, o?: Options) => say("10 cm pocket ruler", "Карманная 10 см", p, o);
export const t_ruler_preset_radius = (p?: Params, o?: Options) => say("Radius gauges 1–10", "Радиусные шаблоны 1–10", p, o);
export const t_ruler_preset_radius_big = (p?: Params, o?: Options) => say("Radius gauges 10–25", "Радиусы 10–25", p, o);
export const t_ruler_engraved_cm = (p?: Params, o?: Options) => say("cm", "см", p, o);
export const t_ruler_summary_gauges = (p?: Params, o?: Options) => say({"one":"{n} gauge: a convex radius on one end, a concave one on the other. The markings are recessed 0.6 mm — change filament at that depth, and the labels come out in color.","other":"{n} gauges: a convex radius on one end, a concave one on the other. The markings are recessed 0.6 mm — change filament at that depth, and the labels come out in color."}, {"one":"{n} шаблон: с одного конца выпуклый радиус, с другого вогнутый. Деления вдавлены на 0,6 мм — смените пластик на этой глубине, и надписи станут цветными.","few":"{n} шаблона: с одного конца выпуклый радиус, с другого вогнутый. Деления вдавлены на 0,6 мм — смените пластик на этой глубине, и надписи станут цветными.","many":"{n} шаблонов: с одного конца выпуклый радиус, с другого вогнутый. Деления вдавлены на 0,6 мм — смените пластик на этой глубине, и надписи станут цветными.","other":"{n} шаблона: с одного конца выпуклый радиус, с другого вогнутый. Деления вдавлены на 0,6 мм — смените пластик на этой глубине, и надписи станут цветными."}, p, o);
export const t_ruler_summary_ruler = (p?: Params, o?: Options) => say("A {cm} cm ruler. The marks are recessed 0.6 mm — change filament at that depth, and they come out in color. Print it without scaling and check it against a real ruler.", "Линейка на {cm} см. Деления вдавлены на 0,6 мм — смените пластик на этой глубине, и они станут цветными. Печатайте без масштабирования и проверьте по настоящей линейке.", p, o);
export const t_ruler_scad_title = (p?: Params, o?: Options) => say("Polyzon Maker — “Rulers and gauges”", "Polyzon Maker — «Линейки и шаблоны»", p, o);
export const t_ruler_kind_ruler = (p?: Params, o?: Options) => say("Ruler", "Линейка", p, o);
export const t_ruler_kind_radius = (p?: Params, o?: Options) => say("Radius gauges", "Радиусные шаблоны", p, o);
export const t_ruler_filename = (p?: Params, o?: Options) => say("ruler", "lineyka", p, o);
export const t_ruler_gauges_filename = (p?: Params, o?: Options) => say("radius-gauges", "shablony-radiusov", p, o);
export const t_ruler_group_what = (p?: Params, o?: Options) => say("What to make", "Что", p, o);
export const t_ruler_kind = (p?: Params, o?: Options) => say("Tool", "Инструмент", p, o);
export const t_ruler_scale_length = (p?: Params, o?: Options) => say("Scale length", "Длина шкалы", p, o);
export const t_ruler_millimetres = (p?: Params, o?: Options) => say("Millimeter marks", "Миллиметры", p, o);
export const t_ruler_millimetres_hint = (p?: Params, o?: Options) => say("Without them, marks only every 5 mm.", "Без них — только через 5 мм.", p, o);
export const t_ruler_radii = (p?: Params, o?: Options) => say("Radii", "Радиусы", p, o);
export const t_ruler_radii_hint = (p?: Params, o?: Options) => say("In millimeters, comma-separated, up to 16.", "В миллиметрах через запятую, до 16 штук.", p, o);
