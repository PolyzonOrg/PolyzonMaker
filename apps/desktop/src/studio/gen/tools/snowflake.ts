// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_snowflake_preset_tree = (p?: Params, o?: Options) => say("For the tree", "На ёлку", p, o);
export const t_snowflake_preset_window = (p?: Params, o?: Options) => say("Large, for a window", "Большая на окно", p, o);
export const t_snowflake_preset_set = (p?: Params, o?: Options) => say("Set of 6, all different", "Набор из 6 разных", p, o);
export const t_snowflake_preset_gift = (p?: Params, o?: Options) => say("For a gift", "На подарок", p, o);
export const t_snowflake_summary_set = (p?: Params, o?: Options) => say({"one":"{n} snowflake","other":"{n} different snowflakes"}, {"one":"{n} разная снежинка","few":"{n} разные снежинки","many":"{n} разных снежинок","other":"{n} разной снежинки"}, p, o);
export const t_snowflake_summary_single = (p?: Params, o?: Options) => say("Snowflake", "Снежинка", p, o);
export const t_snowflake_summary = (p?: Params, o?: Options) => say("{what} ⌀ {diameter} mm, {thickness} mm thick. Each number makes a different pattern — note yours to print the same one again.", "{what} ⌀ {diameter} мм, толщина {thickness} мм. Другое число — другой узор; запомните его, чтобы напечатать такую же.", p, o);
export const t_snowflake_scad_title = (p?: Params, o?: Options) => say("Polyzon Maker — “Snowflakes”", "Polyzon Maker — «Снежинки»", p, o);
export const t_snowflake_scad_pattern = (p?: Params, o?: Options) => say("Pattern #{seed}", "Узор № {seed}", p, o);
export const t_snowflake_filename = (p?: Params, o?: Options) => say("snowflake", "snezhinka", p, o);
export const t_snowflake_seed = (p?: Params, o?: Options) => say("Pattern number", "Номер узора", p, o);
export const t_snowflake_seed_hint = (p?: Params, o?: Options) => say("Every number is its own pattern. Like this one? Note the number.", "Каждый номер — свой узор. Понравился — запомните номер.", p, o);
export const t_snowflake_shuffle = (p?: Params, o?: Options) => say("New pattern", "Другой узор", p, o);
export const t_snowflake_branches = (p?: Params, o?: Options) => say("Branches per arm", "Веточек на луче", p, o);
export const t_snowflake_relief = (p?: Params, o?: Options) => say("Faceted arms", "Грани на лучах", p, o);
export const t_snowflake_relief_hint = (p?: Params, o?: Options) => say("Narrow ridges along the arms catch the light like carved ice.", "Узкие рёбра поверх лучей ловят свет, как резной лёд.", p, o);
export const t_snowflake_stroke = (p?: Params, o?: Options) => say("Arm thickness", "Толщина лучей", p, o);
export const t_snowflake_stroke_hint = (p?: Params, o?: Options) => say("At least 1.2 mm — three lines with a 0.4 nozzle.", "Не тоньше 1,2 мм — три линии сопла 0,4.", p, o);
export const t_snowflake_loop = (p?: Params, o?: Options) => say("Hanging loop", "Ушко для нитки", p, o);
export const t_snowflake_count_hint = (p?: Params, o?: Options) => say("Each one gets its own pattern.", "Каждая следующая — со своим узором.", p, o);
