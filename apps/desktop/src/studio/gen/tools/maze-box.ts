// Made by sync-studio.mjs from Polyzon Studio's messages.
import { say, type Options, type Params } from '$lib/i18n/say';

export const t_maze_box_preset_gift = (p?: Params, o?: Options) => say("For a gift", "Для подарка", p, o);
export const t_maze_box_preset_money = (p?: Params, o?: Options) => say("For cash", "Для купюры", p, o);
export const t_maze_box_preset_big = (p?: Params, o?: Options) => say("Large", "Большая", p, o);
export const t_maze_box_summary = (p?: Params, o?: Options) => say({"one":"Inside ⌀ {inner} × {height} mm, outside ⌀ {outer} mm; a {cols} × {rows} maze, and the longest path from the entrance to the bottom is {n} cell.","other":"Inside ⌀ {inner} × {height} mm, outside ⌀ {outer} mm; a {cols} × {rows} maze, and the longest path from the entrance to the bottom is {n} cells."}, {"one":"Внутри ⌀ {inner} × {height} мм, снаружи ⌀ {outer} мм; лабиринт {cols} × {rows} клеток, самый длинный путь от входа до дна — {n} клетка.","few":"Внутри ⌀ {inner} × {height} мм, снаружи ⌀ {outer} мм; лабиринт {cols} × {rows} клеток, самый длинный путь от входа до дна — {n} клетки.","many":"Внутри ⌀ {inner} × {height} мм, снаружи ⌀ {outer} мм; лабиринт {cols} × {rows} клеток, самый длинный путь от входа до дна — {n} клеток.","other":"Внутри ⌀ {inner} × {height} мм, снаружи ⌀ {outer} мм; лабиринт {cols} × {rows} клеток, самый длинный путь от входа до дна — {n} клетки."}, p, o);
export const t_maze_box_header_title = (p?: Params, o?: Options) => say("Polyzon Maker — “Maze gift box”", "Polyzon Maker — «Шкатулка-лабиринт»", p, o);
export const t_maze_box_header_grooves = (p?: Params, o?: Options) => say("Groove {groove} × {depth} mm, clearance {clearance} mm, maze #{seed}", "Канавка {groove} × {depth} мм, зазор {clearance} мм, лабиринт №{seed}", p, o);
export const t_maze_box_header_print = (p?: Params, o?: Options) => say("Print the cup upright and the cap lid-down; no supports", "Стакан печатается стоя, колпак — крышкой вниз; без поддержек", p, o);
export const t_maze_box_filename = (p?: Params, o?: Options) => say("maze-box", "labirint", p, o);
export const t_maze_box_group_box = (p?: Params, o?: Options) => say("Box", "Шкатулка", p, o);
export const t_maze_box_inner = (p?: Params, o?: Options) => say("Inner diameter", "Диаметр внутри", p, o);
export const t_maze_box_inner_hint = (p?: Params, o?: Options) => say("A rolled-up bill needs 20 mm or more; a ring in its box, 40 or more.", "Купюра, свёрнутая трубочкой, — от 20 мм; кольцо в коробочке — от 40.", p, o);
export const t_maze_box_height = (p?: Params, o?: Options) => say("Inner height", "Высота внутри", p, o);
export const t_maze_box_shuffle = (p?: Params, o?: Options) => say("New maze", "Другой лабиринт", p, o);
export const t_maze_box_group_grooves = (p?: Params, o?: Options) => say("Grooves", "Канавки", p, o);
export const t_maze_box_groove = (p?: Params, o?: Options) => say("Groove width", "Ширина канавки", p, o);
export const t_maze_box_groove_hint = (p?: Params, o?: Options) => say("Wider makes the maze simpler and more reliable to print; narrower gives it more paths.", "Шире — лабиринт проще и надёжнее в печати, уже — больше ходов.", p, o);
export const t_maze_box_clearance_hint = (p?: Params, o?: Options) => say("0.35 mm — the cap moves freely without wobbling. Print the cup upright and the cap lid-down.", "0,35 мм — колпак ходит свободно, но не болтается. Стакан печатается стоя, колпак — крышкой вниз.", p, o);
