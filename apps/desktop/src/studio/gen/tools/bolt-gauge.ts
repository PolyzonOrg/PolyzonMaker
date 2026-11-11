// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_bolt_gauge_preset_electronics = (p?: Params, o?: Options) => say("Electronics M2–M5", "Электроника M2–M5", p, o);
export const t_bolt_gauge_preset_furniture = (p?: Params, o?: Options) => say("Furniture M6–M16", "Мебель M6–M16", p, o);
export const t_bolt_gauge_preset_length_only = (p?: Params, o?: Options) => say("Length only", "Только длина", p, o);
export const t_bolt_gauge_thread_sizes = (p?: Params, o?: Options) => say("Thread sizes", "Размеры резьбы", p, o);
export const t_bolt_gauge_from = (p?: Params, o?: Options) => say("From", "От", p, o);
export const t_bolt_gauge_to = (p?: Params, o?: Options) => say("To", "До", p, o);
export const t_bolt_gauge_on_plate = (p?: Params, o?: Options) => say("On the plate", "Что на пластине", p, o);
export const t_bolt_gauge_holes = (p?: Params, o?: Options) => say("Bolt holes", "Отверстия под болты", p, o);
export const t_bolt_gauge_hole_rule = (p?: Params, o?: Options) => say("A bolt passes through its own hole but not through the next smaller one.", "Болт проходит в своё отверстие и не проходит в меньшее.", p, o);
export const t_bolt_gauge_nuts = (p?: Params, o?: Options) => say("Nut pockets", "Гнёзда под гайки", p, o);
export const t_bolt_gauge_nuts_hint = (p?: Params, o?: Options) => say("A nut drops into the pocket of its size. M10–M14 get two pockets each: ISO and DIN (GOST, Russian standard).", "Гайка ложится в гнездо своего размера. У M10–M14 по два гнезда: ISO и DIN (ГОСТ).", p, o);
export const t_bolt_gauge_ruler = (p?: Params, o?: Options) => say("Length ruler", "Линейка для длины", p, o);
export const t_bolt_gauge_ruler_option = (p?: Params, o?: Options) => say("{length} mm", "{length} мм", p, o);
export const t_bolt_gauge_ruler_hint = (p?: Params, o?: Options) => say("Put the head against the wall — the end of the screw shows its length. Flat-head screws are measured including the head.", "Голову — к стенке, конец винта покажет длину. Потайной винт меряют вместе с головой.", p, o);
export const t_bolt_gauge_play_hint = (p?: Params, o?: Options) => say("Added to every hole and pocket: printed holes come out smaller. Too tight — increase it.", "Прибавка к каждому отверстию и гнезду: напечатанные отверстия выходят меньше. Туго — прибавьте.", p, o);
export const t_bolt_gauge_plate_thickness = (p?: Params, o?: Options) => say("Plate thickness", "Толщина пластины", p, o);
export const t_bolt_gauge_summary = (p?: Params, o?: Options) => say("{from}–{to} gauge: {contents}. Plate {width} × {depth} mm.", "Калибр {from}–{to}: {contents}. Пластина {width} × {depth} мм.", p, o);
export const t_bolt_gauge_summary_holes = (p?: Params, o?: Options) => say({"one":"{n} hole","other":"{n} holes"}, {"one":"{n} отверстие","few":"{n} отверстия","many":"{n} отверстий","other":"{n} отверстия"}, p, o);
export const t_bolt_gauge_summary_nuts = (p?: Params, o?: Options) => say({"one":"{n} nut pocket","other":"{n} nut pockets"}, {"one":"{n} гнездо под гайку","few":"{n} гнезда под гайки","many":"{n} гнёзд под гайки","other":"{n} гнезда под гайки"}, p, o);
export const t_bolt_gauge_summary_ruler = (p?: Params, o?: Options) => say("ruler up to {length} mm", "линейка до {length} мм", p, o);
export const t_bolt_gauge_summary_din = (p?: Params, o?: Options) => say("Two pockets of the same size are for ISO 4032 and DIN 934 nuts (GOST 5915, Russian standard).", "Два гнезда одного размера — гайки ISO 4032 и DIN 934 (ГОСТ 5915).", p, o);
export const t_bolt_gauge_summary_ruler_use = (p?: Params, o?: Options) => say("Length is measured from the stop: head against the wall, and the end shows the length.", "Длину меряют от упора: голова у стенки, конец показывает длину.", p, o);
export const t_bolt_gauge_scad_title = (p?: Params, o?: Options) => say("Polyzon Maker — “Bolt and nut gauge”", "Polyzon Maker — «Калибр болтов и гаек»", p, o);
export const t_bolt_gauge_filename = (p?: Params, o?: Options) => say("bolt-gauge", "kalibr", p, o);
