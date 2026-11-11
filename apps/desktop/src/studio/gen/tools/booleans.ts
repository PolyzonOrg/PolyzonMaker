// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_booleans_volume_cm3 = (p?: Params, o?: Options) => say("{value} cm³", "{value} см³", p, o);
export const t_booleans_volume_ml = (p?: Params, o?: Options) => say("{value} ml", "{value} мл", p, o);
export const t_booleans_out_of_memory = (p?: Params, o?: Options) => say("Your browser ran out of memory — try a simpler model or lower detail.", "Не хватило памяти браузера — попробуйте модель попроще или меньшую детализацию.", p, o);
export const t_booleans_part_show = (p?: Params, o?: Options) => say("Show: {name}", "Показывать: {name}", p, o);
export const t_booleans_part_download = (p?: Params, o?: Options) => say("Download STL: {name}", "Скачать STL: {name}", p, o);
