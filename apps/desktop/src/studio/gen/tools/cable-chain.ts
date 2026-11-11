// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_cable_chain_preset_x = (p?: Params, o?: Options) => say("Printer X axis", "Для оси X принтера", p, o);
export const t_cable_chain_preset_bed = (p?: Params, o?: Options) => say("Under the printer bed", "Под стол принтера", p, o);
export const t_cable_chain_preset_cnc = (p?: Params, o?: Options) => say("CNC", "Для ЧПУ", p, o);
export const t_cable_chain_preset_assembled = (p?: Params, o?: Options) => say("Pre-assembled", "Сразу собранная", p, o);
export const t_cable_chain_inside = (p?: Params, o?: Options) => say("Inside", "Внутри", p, o);
export const t_cable_chain_width_hint = (p?: Params, o?: Options) => say("The wires lie side by side: add up their thicknesses plus a couple of millimeters.", "Провода лежат рядом: сложите их толщины и прибавьте пару миллиметров.", p, o);
export const t_cable_chain_chain = (p?: Params, o?: Options) => say("Chain", "Цепь", p, o);
export const t_cable_chain_links = (p?: Params, o?: Options) => say("Links", "Звеньев", p, o);
export const t_cable_chain_assembled = (p?: Params, o?: Options) => say("Print assembled", "Печатать собранной", p, o);
export const t_cable_chain_assembled_hint = (p?: Params, o?: Options) => say("The links come out already joined, with extra clearance on the pins. Otherwise you get separate links that snap together by hand.", "Звенья уже соединены, оси с увеличенным зазором. Иначе — отдельные звенья, которые защёлкиваются руками.", p, o);
export const t_cable_chain_pin_clearance = (p?: Params, o?: Options) => say("Pin clearance", "Зазор оси", p, o);
export const t_cable_chain_links_count = (p?: Params, o?: Options) => say({"one":"{n} link","other":"{n} links"}, {"one":"{n} звено","few":"{n} звена","many":"{n} звеньев","other":"{n} звена"}, p, o);
export const t_cable_chain_summary_assembled = (p?: Params, o?: Options) => say("{links} at {pitch} mm — a {length} mm chain; {width} × {height} mm inside; prints as a ready chain.", "{links} по {pitch} мм — цепь {length} мм; внутри {width} × {height} мм; печатается сразу цепью.", p, o);
export const t_cable_chain_summary_loose = (p?: Params, o?: Options) => say("{links} at {pitch} mm — a {length} mm chain; {width} × {height} mm inside; the links snap into each other.", "{links} по {pitch} мм — цепь {length} мм; внутри {width} × {height} мм; звенья защёлкиваются друг в друга.", p, o);
export const t_cable_chain_summary_bed = (p?: Params, o?: Options) => say("{length} mm long: a 220 mm bed holds {links} — print the chain in sections and join them.", "В длину {length} мм: на стол 220 мм помещается {links} — печатайте цепь частями и соедините их.", p, o);
export const t_cable_chain_scad_title = (p?: Params, o?: Options) => say("Polyzon Maker — “Cable chain”", "Polyzon Maker — «Кабель-цепь»", p, o);
export const t_cable_chain_scad_print = (p?: Params, o?: Options) => say("Links stand on the bottom crossbar, no supports", "Звенья стоят на нижней перекладине, без поддержек", p, o);
export const t_cable_chain_filename = (p?: Params, o?: Options) => say("cable-chain", "kabel-cep", p, o);
