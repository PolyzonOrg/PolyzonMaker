// Открывашка для бутылок: зуб в окне головки цепляет край пробки,
// край окна упирается в её верх — рычаг поднимает пробку.
// Пробка 26 мм (кроненпробка). Печатать из PETG или PLA, заполнение 100%.
$fn = 64;

/* [Открывашка] */
// Длина, мм
length = 100;           // [70:5:150]
// Ширина ручки, мм
handle = 22;            // [16:1:34]
// Толщина, мм
thickness = 6;          // [5:0.5:10]
/* [Окно под пробку] */
// Диаметр окна, мм
opening = 28;           // [26:0.5:32]
// Вылет зуба, мм
tooth = 3.5;            // [2:0.5:6]
// Ширина зуба, мм
tooth_width = 11;       // [6:1:16]
/* [Подвес] */
// Отверстие на ручке, мм
hang_hole = 6;          // [0:0.5:10]

// Ободок вокруг окна — четверть его диаметра (7 мм при 28).
rim = opening / 4;
head = opening + 2 * rim;

module outline() {
    // Внешние углы скруглены, переход головки в ручку плавный.
    offset(r = -6) offset(r = 6)
        hull() {
            circle(d = head);
            translate([length - head / 2 - handle / 2, 0]) circle(d = handle);
        }
}

module window() {
    difference() {
        circle(d = opening);
        // Зуб — со стороны, дальней от ручки.
        translate([-opening / 2 - 1, -tooth_width / 2])
            offset(r = 1) offset(r = -1)
                square([tooth + 1, tooth_width]);
    }
}

linear_extrude(height = thickness)
    difference() {
        outline();
        window();
        if (hang_hole > 0)
            translate([length - head / 2 - handle / 2, 0]) circle(d = hang_hole);
    }
