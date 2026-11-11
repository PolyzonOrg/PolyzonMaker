// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_model_convert_read_failed = (p?: Params, o?: Options) => say("Couldn't read the file.", "Файл не прочитался.", p, o);
export const t_model_convert_units = (p?: Params, o?: Options) => say("Units in the file", "Единицы в файле", p, o);
export const t_model_convert_unit_cm = (p?: Params, o?: Options) => say("cm", "см", p, o);
export const t_model_convert_unit_in = (p?: Params, o?: Options) => say("inches", "дюймы", p, o);
export const t_model_convert_units_hint = (p?: Params, o?: Options) => say("Models from Blender and other apps are often in meters or inches; slicers need millimeters.", "Модели из Blender и других программ бывают в метрах или дюймах; слайсеру нужны миллиметры.", p, o);
export const t_model_convert_on_bed = (p?: Params, o?: Options) => say("Place on the bed", "Поставить на стол", p, o);
export const t_model_convert_on_bed_hint = (p?: Params, o?: Options) => say("The bottom of the model at zero, centered.", "Низ модели на нуле, по центру.", p, o);
export const t_model_convert_summary = (p?: Params, o?: Options) => say({"one":"{x} × {y} × {z} mm, {n} triangle.","other":"{x} × {y} × {z} mm, {n} triangles."}, {"one":"{x} × {y} × {z} мм, {n} треугольник.","few":"{x} × {y} × {z} мм, {n} треугольника.","many":"{x} × {y} × {z} мм, {n} треугольников.","other":"{x} × {y} × {z} мм, {n} треугольника."}, p, o);
