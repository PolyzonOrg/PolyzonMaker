// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_bag_clip_preset_chips = (p?: Params, o?: Options) => say("Chip bag", "Для пакета чипсов", p, o);
export const t_bag_clip_preset_coffee = (p?: Params, o?: Options) => say("Coffee bag", "Для кофе", p, o);
export const t_bag_clip_preset_freezer = (p?: Params, o?: Options) => say("Freezer bag", "Для заморозки", p, o);
export const t_bag_clip_preset_set = (p?: Params, o?: Options) => say("Set of 4", "Набор из 4", p, o);
export const t_bag_clip_group_clip = (p?: Params, o?: Options) => say("Clip", "Зажим", p, o);
export const t_bag_clip_length_hint = (p?: Params, o?: Options) => say("A little wider than the bag.", "Чуть шире пакета.", p, o);
export const t_bag_clip_rod = (p?: Params, o?: Options) => say("Rod diameter", "Диаметр стержня", p, o);
export const t_bag_clip_bag = (p?: Params, o?: Options) => say("Room for the bag", "Место под пакет", p, o);
export const t_bag_clip_bag_hint = (p?: Params, o?: Options) => say("Clearance for the folded bag. If the clip slips off, make it smaller; if it won't snap on, make it larger.", "Зазор для сложенного пакета. Слетает — убавьте, не защёлкивается — прибавьте.", p, o);
export const t_bag_clip_sleeve_wall = (p?: Params, o?: Options) => say("Sleeve thickness", "Толщина рукава", p, o);
export const t_bag_clip_summary = (p?: Params, o?: Options) => say("A {length} mm clip: fold the bag over the rod, then snap the sleeve on from above — its {mouth} mm slot is narrower than the {rod} mm rod.", "Зажим {length} мм: пакет загнуть на стержень, сверху защёлкнуть рукав — его прорезь {mouth} мм уже стержня {rod} мм.", p, o);
export const t_bag_clip_scad_title = (p?: Params, o?: Options) => say("Polyzon Maker — “Bag clip”", "Polyzon Maker — «Клипса для пакетов»", p, o);
export const t_bag_clip_scad_flat = (p?: Params, o?: Options) => say("Both parts lie flat side down on the bed", "Обе детали лежат плоской стороной на столе", p, o);
export const t_bag_clip_filename = (p?: Params, o?: Options) => say("bag-clip", "klipsa-paket", p, o);
