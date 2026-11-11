// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_planter_filename = (p?: Params, o?: Options) => say("planter", "kashpo", p, o);
export const t_planter_preset_succulent = (p?: Params, o?: Options) => say("Succulent", "Для суккулента", p, o);
export const t_planter_preset_mid = (p?: Params, o?: Options) => say("Medium", "Средний", p, o);
export const t_planter_preset_square = (p?: Params, o?: Options) => say("Square", "Квадратный", p, o);
export const t_planter_preset_herbs = (p?: Params, o?: Options) => say("Herbs", "Для зелени", p, o);
export const t_planter_planter = (p?: Params, o?: Options) => say("Planter", "Кашпо", p, o);
export const t_planter_shape_round = (p?: Params, o?: Options) => say("Round", "Круглое", p, o);
export const t_planter_shape_square = (p?: Params, o?: Options) => say("Square", "Квадратное", p, o);
export const t_planter_top = (p?: Params, o?: Options) => say("Top width", "Ширина сверху", p, o);
export const t_planter_bottom = (p?: Params, o?: Options) => say("Bottom width", "Ширина снизу", p, o);
export const t_planter_bottom_hint = (p?: Params, o?: Options) => say("The wall flares out at no more than 40°, so it prints without supports.", "Стенка расширяется кверху не круче 40° — печатается без поддержек.", p, o);
export const t_planter_floor = (p?: Params, o?: Options) => say("Bottom thickness", "Толщина дна", p, o);
export const t_planter_water = (p?: Params, o?: Options) => say("Water", "Вода", p, o);
export const t_planter_holes = (p?: Params, o?: Options) => say("Drainage holes", "Дренажных отверстий", p, o);
export const t_planter_holes_hint = (p?: Params, o?: Options) => say("Excess water drains out, so the roots don't rot.", "Лишняя вода уходит — корни не гниют.", p, o);
export const t_planter_hole_diameter = (p?: Params, o?: Options) => say("Hole diameter", "Диаметр отверстий", p, o);
export const t_planter_saucer = (p?: Params, o?: Options) => say("Saucer", "Поддон", p, o);
export const t_planter_saucer_hint = (p?: Params, o?: Options) => say("With ribs: the planter sits above the water, not in it.", "С рёбрами: кашпо стоит над водой, а не в ней.", p, o);
export const t_planter_saucer_height = (p?: Params, o?: Options) => say("Saucer height", "Высота поддона", p, o);
export const t_planter_summary_holes = (p?: Params, o?: Options) => say("A planter of about {litres} L with {holes}. Height: {height} mm.", "Кашпо около {litres} л, {holes}. Высота {height} мм.", p, o);
export const t_planter_summary_holes_saucer = (p?: Params, o?: Options) => say("A planter of about {litres} L with {holes} and a ribbed saucer. Height: {height} mm.", "Кашпо около {litres} л, {holes}, поддон с рёбрами. Высота {height} мм.", p, o);
export const t_planter_summary_no_holes = (p?: Params, o?: Options) => say("A planter of about {litres} L, no drainage holes. Height: {height} mm.", "Кашпо около {litres} л, без отверстий. Высота {height} мм.", p, o);
export const t_planter_summary_no_holes_saucer = (p?: Params, o?: Options) => say("A planter of about {litres} L, no drainage holes, with a ribbed saucer. Height: {height} mm.", "Кашпо около {litres} л, без отверстий, поддон с рёбрами. Высота {height} мм.", p, o);
export const t_planter_drain_holes = (p?: Params, o?: Options) => say({"one":"{n} drainage hole","other":"{n} drainage holes"}, {"one":"{n} дренажное отверстие","few":"{n} дренажных отверстия","many":"{n} дренажных отверстий","other":"{n} дренажного отверстия"}, p, o);
export const t_planter_header_title = (p?: Params, o?: Options) => say("Polyzon Maker — “Planter with saucer”", "Polyzon Maker — «Кашпо с поддоном»", p, o);
export const t_planter_header_print = (p?: Params, o?: Options) => say("Both print open side up, no supports", "Печатаются открытой стороной вверх, без поддержек", p, o);
