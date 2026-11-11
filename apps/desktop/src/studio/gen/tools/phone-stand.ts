// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_phone_stand_preset_phone = (p?: Params, o?: Options) => say("Phone", "Телефон", p, o);
export const t_phone_stand_preset_video = (p?: Params, o?: Options) => say("Phone for video", "Телефон для видео", p, o);
export const t_phone_stand_preset_tablet = (p?: Params, o?: Options) => say("Tablet", "Планшет", p, o);
export const t_phone_stand_preset_reader = (p?: Params, o?: Options) => say("E-reader", "Электронная книга", p, o);
export const t_phone_stand_device = (p?: Params, o?: Options) => say("Device", "Устройство", p, o);
export const t_phone_stand_device_thickness = (p?: Params, o?: Options) => say("Thickness with case", "Толщина в чехле", p, o);
export const t_phone_stand_device_hint = (p?: Params, o?: Options) => say("Add 1–2 mm so it slides in easily.", "С запасом 1–2 мм, чтобы вставлялось свободно.", p, o);
export const t_phone_stand_angle = (p?: Params, o?: Options) => say("Angle", "Наклон", p, o);
export const t_phone_stand_back_height = (p?: Params, o?: Options) => say("Back height", "Высота спинки", p, o);
export const t_phone_stand_lip = (p?: Params, o?: Options) => say("Front lip", "Бортик спереди", p, o);
export const t_phone_stand_cable = (p?: Params, o?: Options) => say("Room for charger", "Под зарядку", p, o);
export const t_phone_stand_cable_hint = (p?: Params, o?: Options) => say("The device sits on a ledge with room for a straight plug underneath; the cable runs out the back.", "Устройство встаёт на полку: под ней место для прямого штекера, кабель уходит назад.", p, o);
export const t_phone_stand_summary = (p?: Params, o?: Options) => say("{angle}° angle, {gap} mm slot for the device in its case; {depth} × {width} mm base. Prints on its side.", "Наклон {angle}°, щель {gap} мм под устройство в чехле; основание {depth} × {width} мм. Печатается на боку.", p, o);
export const t_phone_stand_summary_cable = (p?: Params, o?: Options) => say("The device sits on a ledge with room underneath for a plug up to {plug} mm; the cable runs out the back through a channel.", "Устройство стоит на полке: под ней место для штекера до {plug} мм, кабель уходит назад по каналу.", p, o);
export const t_phone_stand_scad_title = (p?: Params, o?: Options) => say("Polyzon Maker — “Phone stand”", "Polyzon Maker — «Подставка для телефона»", p, o);
export const t_phone_stand_filename = (p?: Params, o?: Options) => say("phone-stand", "podstavka-telefon", p, o);
