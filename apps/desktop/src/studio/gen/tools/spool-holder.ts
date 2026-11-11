// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_spool_holder_preset_kg = (p?: Params, o?: Options) => say("1 kg spool (200 mm)", "Катушка 1 кг (200 мм)", p, o);
export const t_spool_holder_preset_half = (p?: Params, o?: Options) => say("0.5 kg spool (160 mm)", "Катушка 0,5 кг (160 мм)", p, o);
export const t_spool_holder_preset_big = (p?: Params, o?: Options) => say("3 kg spool (300 mm)", "Катушка 3 кг (300 мм)", p, o);
export const t_spool_holder_preset_small = (p?: Params, o?: Options) => say("On 625 bearings", "На подшипниках 625", p, o);
export const t_spool_holder_summary = (p?: Params, o?: Options) => say({"one":"For a {spool} mm spool: {n} {bearing} bearing ({outer} × {bore} × {width}) on an M{bore} bolt, axles {spacing} mm apart.","other":"For a {spool} mm spool: {n} {bearing} bearings ({outer} × {bore} × {width}) on M{bore} bolts, axles {spacing} mm apart."}, {"one":"Под катушку {spool} мм: {n} подшипник {bearing} ({outer} × {bore} × {width}) на болтах M{bore}, оси через {spacing} мм.","few":"Под катушку {spool} мм: {n} подшипника {bearing} ({outer} × {bore} × {width}) на болтах M{bore}, оси через {spacing} мм.","many":"Под катушку {spool} мм: {n} подшипников {bearing} ({outer} × {bore} × {width}) на болтах M{bore}, оси через {spacing} мм.","other":"Под катушку {spool} мм: {n} подшипника {bearing} ({outer} × {bore} × {width}) на болтах M{bore}, оси через {spacing} мм."}, p, o);
export const t_spool_holder_summary_one_cradle = (p?: Params, o?: Options) => say("One cradle: the spool rests on its two bearings.", "Одна опора: катушка лежит на её двух подшипниках.", p, o);
export const t_spool_holder_summary_two_cradles = (p?: Params, o?: Options) => say("Two cradles go under the edges of the spool.", "Две опоры ставятся под края катушки.", p, o);
export const t_spool_holder_header_title = (p?: Params, o?: Options) => say("Polyzon Maker — “Spool holder”", "Polyzon Maker — «Держатель катушки»", p, o);
export const t_spool_holder_header_print = (p?: Params, o?: Options) => say("Prints upright, no supports", "Печатается стоя, без поддержек", p, o);
export const t_spool_holder_bearing_choice = (p?: Params, o?: Options) => say("{id} ({size} mm)", "{id} ({size} мм)", p, o);
export const t_spool_holder_count_two = (p?: Params, o?: Options) => say("Two", "Две", p, o);
export const t_spool_holder_count_one = (p?: Params, o?: Options) => say("One", "Одна", p, o);
export const t_spool_holder_filename = (p?: Params, o?: Options) => say("spool-holder", "derzhatel-katushki", p, o);
export const t_spool_holder_group_spool = (p?: Params, o?: Options) => say("Spool", "Катушка", p, o);
export const t_spool_holder_spool = (p?: Params, o?: Options) => say("Spool diameter", "Диаметр катушки", p, o);
export const t_spool_holder_spool_hint = (p?: Params, o?: Options) => say("Outside, across the flanges: a 1 kg spool is usually 200 mm, 0.5 kg is 160–170, 3 kg is about 300.", "Снаружи, по щёкам: 1 кг — обычно 200 мм, 0,5 кг — 160–170, 3 кг — около 300.", p, o);
export const t_spool_holder_group_cradles = (p?: Params, o?: Options) => say("Cradles", "Опоры", p, o);
export const t_spool_holder_bearings = (p?: Params, o?: Options) => say("Bearings", "Подшипники", p, o);
export const t_spool_holder_bearing_608_hint = (p?: Params, o?: Options) => say("608 — the kind in scooters and skateboards, on an M8 bolt.", "608 — как в самокатах и скейтах, на болт M8.", p, o);
export const t_spool_holder_bearing_625_hint = (p?: Params, o?: Options) => say("625 — smaller and lighter, on an M5 bolt.", "625 — меньше и легче, на болт M5.", p, o);
export const t_spool_holder_count = (p?: Params, o?: Options) => say("Number of cradles", "Сколько опор", p, o);
export const t_spool_holder_base = (p?: Params, o?: Options) => say("Base thickness", "Толщина основания", p, o);
export const t_spool_holder_clearance_hint = (p?: Params, o?: Options) => say("Around the bolt and at the sides of the bearing.", "Вокруг болта и по бокам подшипника.", p, o);
