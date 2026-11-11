// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_flat_spring_preset_soft = (p?: Params, o?: Options) => say("Soft zigzag", "Мягкая змейка", p, o);
export const t_flat_spring_preset_stiff = (p?: Params, o?: Options) => say("Stiff zigzag", "Жёсткая змейка", p, o);
export const t_flat_spring_preset_clock = (p?: Params, o?: Options) => say("Clock spiral", "Часовая спираль", p, o);
export const t_flat_spring_preset_return = (p?: Params, o?: Options) => say("Return spiral", "Возвратная спираль", p, o);
export const t_flat_spring_spring = (p?: Params, o?: Options) => say("Spring", "Пружина", p, o);
export const t_flat_spring_kind = (p?: Params, o?: Options) => say("Type", "Вид", p, o);
export const t_flat_spring_kind_zigzag = (p?: Params, o?: Options) => say("Zigzag compression", "Змейка на сжатие", p, o);
export const t_flat_spring_kind_spiral = (p?: Params, o?: Options) => say("Spiral torsion", "Спираль на кручение", p, o);
export const t_flat_spring_kind_hint = (p?: Params, o?: Options) => say("Both print flat — no coils hanging in midair. Use PETG or nylon: PLA fatigues and sags.", "Обе печатаются плашмя — витки не висят в воздухе. Пластик — PETG или нейлон: PLA устаёт и проседает.", p, o);
export const t_flat_spring_strip = (p?: Params, o?: Options) => say("Strip width", "Полоса", p, o);
export const t_flat_spring_strip_hint = (p?: Params, o?: Options) => say("Thinner is softer. A multiple of the line width: 0.8, 1.2, or 1.6 mm for a 0.4 nozzle.", "Тоньше — мягче. Кратно ширине линии: 0,8, 1,2, 1,6 мм для сопла 0,4.", p, o);
export const t_flat_spring_turns = (p?: Params, o?: Options) => say("Turns", "Витков", p, o);
export const t_flat_spring_pad_holes = (p?: Params, o?: Options) => say("Holes in the end pads", "Отверстия в площадках", p, o);
export const t_flat_spring_pad_holes_hint = (p?: Params, o?: Options) => say("0 means no holes.", "0 — без отверстий.", p, o);
export const t_flat_spring_outer = (p?: Params, o?: Options) => say("Outer diameter", "Наружный диаметр", p, o);
export const t_flat_spring_hub = (p?: Params, o?: Options) => say("Hub diameter", "Ступица", p, o);
export const t_flat_spring_bore = (p?: Params, o?: Options) => say("Hub bore", "Отверстие в ступице", p, o);
export const t_flat_spring_turns_count = (p?: Params, o?: Options) => say({"one":"{n} turn","other":"{n} turns"}, {"one":"{n} виток","few":"{n} витка","many":"{n} витков","other":"{n} витка"}, p, o);
export const t_flat_spring_summary_spiral = (p?: Params, o?: Options) => say("Spiral ⌀ {outer} mm, {turns} of {strip} mm strip, hub ⌀ {hub} mm for a ⌀ {bore} mm shaft.", "Спираль ⌀ {outer} мм, {turns} полосой {strip} мм, ступица ⌀ {hub} мм под вал ⌀ {bore} мм.", p, o);
export const t_flat_spring_summary_zigzag = (p?: Params, o?: Options) => say("Zigzag {width} × {length} mm, {turns} of {strip} mm strip: compresses by about {travel} mm.", "Змейка {width} × {length} мм, {turns} полосой {strip} мм: сжимается примерно на {travel} мм.", p, o);
export const t_flat_spring_scad_title = (p?: Params, o?: Options) => say("Polyzon Maker — “Springs”", "Polyzon Maker — «Пружины»", p, o);
export const t_flat_spring_scad_thickness = (p?: Params, o?: Options) => say("Thickness {thickness} mm; print flat in PETG or nylon", "Толщина {thickness} мм; печатается плашмя из PETG или нейлона", p, o);
export const t_flat_spring_filename = (p?: Params, o?: Options) => say("spring", "pruzhina", p, o);
