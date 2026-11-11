// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_print_kit_number_invalid = (p?: Params, o?: Options) => say("Enter a number, like {example}", "Введите число, например {example}", p, o);
export const t_print_kit_money = (p?: Params, o?: Options) => say("{symbol}{amount}", "{amount} {symbol}", p, o);
export const t_print_kit_kilograms = (p?: Params, o?: Options) => say("{n} kg", "{n} кг", p, o);
export const t_print_kit_grams = (p?: Params, o?: Options) => say("{n} g", "{n} г", p, o);
export const t_print_kit_hours_minutes = (p?: Params, o?: Options) => say("{h} h {m} min", "{h} ч {m} мин", p, o);
export const t_print_kit_hours = (p?: Params, o?: Options) => say("{h} h", "{h} ч", p, o);
export const t_print_kit_minutes = (p?: Params, o?: Options) => say("{m} min", "{m} мин", p, o);
export const t_print_kit_seconds = (p?: Params, o?: Options) => say("{s} s", "{s} с", p, o);
