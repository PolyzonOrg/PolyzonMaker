// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_keystone_plate_preset_two = (p?: Params, o?: Options) => say("Two jacks", "Два гнезда", p, o);
export const t_keystone_plate_preset_one = (p?: Params, o?: Options) => say("One jack", "Одно гнездо", p, o);
export const t_keystone_plate_preset_four = (p?: Params, o?: Options) => say("Four jacks", "Четыре гнезда", p, o);
export const t_keystone_plate_preset_surface = (p?: Params, o?: Options) => say("With a surface box", "Накладная с коробкой", p, o);
export const t_keystone_plate_preset_blank = (p?: Params, o?: Options) => say("Blank", "Заглушка", p, o);
export const t_keystone_plate_summary_ports_flush = (p?: Params, o?: Options) => say({"one":"{size} × {size} mm plate: {n} keystone jack, screws {spacing} mm apart for an in-wall box.","other":"{size} × {size} mm plate: {n} keystone jacks, screws {spacing} mm apart for an in-wall box."}, {"one":"Рамка {size} × {size} мм: {n} гнездо keystone, винты через {spacing} мм на подрозетник.","few":"Рамка {size} × {size} мм: {n} гнезда keystone, винты через {spacing} мм на подрозетник.","many":"Рамка {size} × {size} мм: {n} гнёзд keystone, винты через {spacing} мм на подрозетник.","other":"Рамка {size} × {size} мм: {n} гнезда keystone, винты через {spacing} мм на подрозетник."}, p, o);
export const t_keystone_plate_summary_ports_surface = (p?: Params, o?: Options) => say({"one":"{size} × {size} mm plate: {n} keystone jack, screws {spacing} mm apart, surface box {depth} mm deep.","other":"{size} × {size} mm plate: {n} keystone jacks, screws {spacing} mm apart, surface box {depth} mm deep."}, {"one":"Рамка {size} × {size} мм: {n} гнездо keystone, винты через {spacing} мм, накладная коробка глубиной {depth} мм.","few":"Рамка {size} × {size} мм: {n} гнезда keystone, винты через {spacing} мм, накладная коробка глубиной {depth} мм.","many":"Рамка {size} × {size} мм: {n} гнёзд keystone, винты через {spacing} мм, накладная коробка глубиной {depth} мм.","other":"Рамка {size} × {size} мм: {n} гнезда keystone, винты через {spacing} мм, накладная коробка глубиной {depth} мм."}, p, o);
export const t_keystone_plate_summary_blank_flush = (p?: Params, o?: Options) => say("{size} × {size} mm plate: blank, screws {spacing} mm apart for an in-wall box.", "Рамка {size} × {size} мм: заглушка, винты через {spacing} мм на подрозетник.", p, o);
export const t_keystone_plate_summary_blank_surface = (p?: Params, o?: Options) => say("{size} × {size} mm plate: blank, screws {spacing} mm apart, surface box {depth} mm deep.", "Рамка {size} × {size} мм: заглушка, винты через {spacing} мм, накладная коробка глубиной {depth} мм.", p, o);
export const t_keystone_plate_header_title = (p?: Params, o?: Options) => say("Polyzon Maker — “Keystone wall plates”", "Polyzon Maker — «Розетки keystone»", p, o);
export const t_keystone_plate_header_print = (p?: Params, o?: Options) => say("The plate prints face down, the box bottom down; no supports needed", "Рамка печатается лицом вниз, коробка — дном вниз; поддержки не нужны", p, o);
export const t_keystone_plate_mount_flush = (p?: Params, o?: Options) => say("In-wall box", "На подрозетник", p, o);
export const t_keystone_plate_mount_surface = (p?: Params, o?: Options) => say("Surface box", "Накладная", p, o);
export const t_keystone_plate_group_plate = (p?: Params, o?: Options) => say("Plate", "Рамка", p, o);
export const t_keystone_plate_size_hint = (p?: Params, o?: Options) => say("80 × 80 matches European plates; 86 × 86 is the Chinese “86” type.", "80 × 80 — как европейские рамки, 86 × 86 — тип «86».", p, o);
export const t_keystone_plate_ports = (p?: Params, o?: Options) => say("Keystone jacks", "Гнёзд keystone", p, o);
export const t_keystone_plate_ports_hint = (p?: Params, o?: Options) => say("Ethernet, TV, HDMI, USB — any keystone module. 0 makes a blank.", "Сеть, ТВ, HDMI, USB — любой модуль keystone. 0 — заглушка.", p, o);
export const t_keystone_plate_thickness_hint = (p?: Params, o?: Options) => say("Around the jack opening it stays 1.6 mm anyway — for the module's latch.", "У окна гнезда всё равно 1,6 мм — под защёлку модуля.", p, o);
export const t_keystone_plate_mount = (p?: Params, o?: Options) => say("Mounting", "Куда", p, o);
export const t_keystone_plate_depth = (p?: Params, o?: Options) => say("Box depth", "Глубина коробки", p, o);
export const t_keystone_plate_depth_hint = (p?: Params, o?: Options) => say("A module with its cable takes up about 35 mm.", "Модуль с кабелем занимает около 35 мм.", p, o);
export const t_keystone_plate_surface_note = (p?: Params, o?: Options) => say("The box goes on the wall with two screws, and the plate onto its posts with 3 mm self-tapping screws; the cable comes in from below.", "Коробка — двумя шурупами к стене, рамка — к её стойкам саморезами 3 мм; кабель входит снизу.", p, o);
export const t_keystone_plate_flush_note = (p?: Params, o?: Options) => say("Use the screws that came with the in-wall box or the outlet.", "Винты — от подрозетника или механизма.", p, o);
