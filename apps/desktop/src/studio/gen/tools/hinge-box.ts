// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_hinge_box_preset_rings = (p?: Params, o?: Options) => say("For rings", "Для колец", p, o);
export const t_hinge_box_preset_bits = (p?: Params, o?: Options) => say("Bits and drill bits", "Для бит и свёрл", p, o);
export const t_hinge_box_preset_sd = (p?: Params, o?: Options) => say("USB drives and SD cards", "Для флешек и карт памяти", p, o);
export const t_hinge_box_preset_big = (p?: Params, o?: Options) => say("Large", "Большая", p, o);
export const t_hinge_box_filename = (p?: Params, o?: Options) => say("hinged-box", "shkatulka", p, o);
export const t_hinge_box_group_inside = (p?: Params, o?: Options) => say("Inside", "Внутри", p, o);
export const t_hinge_box_box_height = (p?: Params, o?: Options) => say("Box height", "Высота коробки", p, o);
export const t_hinge_box_box_height_hint = (p?: Params, o?: Options) => say("At least {min} mm with this lid — otherwise the lid hits the hinge as it closes.", "Не ниже {min} мм при такой крышке: иначе крышка заденет петлю, когда закрывается.", p, o);
export const t_hinge_box_lid_height = (p?: Params, o?: Options) => say("Lid height", "Высота крышки", p, o);
export const t_hinge_box_group_walls_hinge = (p?: Params, o?: Options) => say("Walls and hinge", "Стенки и петля", p, o);
export const t_hinge_box_knuckles = (p?: Params, o?: Options) => say("Hinge knuckles", "Звеньев петли", p, o);
export const t_hinge_box_clearance = (p?: Params, o?: Options) => say("Hinge clearance", "Зазор в петле", p, o);
export const t_hinge_box_clearance_hint = (p?: Params, o?: Options) => say("If the hinge fused during printing, add 0.1 mm; if it wobbles, reduce it.", "Если петля срослась при печати — прибавьте 0,1 мм; болтается — убавьте.", p, o);
export const t_hinge_box_summary = (p?: Params, o?: Options) => say("Closed box: {w} × {d} × {h} mm. After printing, close the lid firmly once — the hinge breaks free and moves easily from then on.", "Закрытая шкатулка {w} × {d} × {h} мм. После печати крышку закрыть с усилием один раз — петля разойдётся и дальше ходит легко.", p, o);
export const t_hinge_box_scad_title = (p?: Params, o?: Options) => say("Polyzon Maker — “Hinged box”", "Polyzon Maker — «Шкатулка с петлёй»", p, o);
export const t_hinge_box_scad_print = (p?: Params, o?: Options) => say("Prints open, fully assembled, no supports", "Печатается открытой, целиком, без поддержек", p, o);
