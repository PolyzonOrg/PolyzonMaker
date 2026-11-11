// Настенный крюк: пластина под два самореза и J-образный крюк.
// Лежит так, как печатается, — на боку: слои идут вдоль крюка,
// и он не отломится по слою под нагрузкой.
$fn = 48;

/* [Крюк] */
// Вылет от стены, мм
reach = 35;             // [15:1:80]
// Высота загиба, мм
lip = 16;               // [6:1:40]
// Толщина крюка, мм
arm = 8;                // [5:0.5:15]
// Ширина, мм
width = 18;             // [10:1:40]
/* [Пластина] */
// Высота пластины, мм
plate_height = 70;      // [40:5:140]
// Толщина пластины, мм
plate = 5;              // [3:0.5:10]
/* [Саморезы] */
// Диаметр самореза, мм
screw = 4;              // [2.5:0.5:6]
// Диаметр шляпки, мм
head = 8;               // [5:0.5:12]

w = max(width, head + 4);
arm_y = arm / 2;
// Загиб — дуга: центр над концом прямого участка, конец смотрит вверх и чуть внутрь.
bend = max(arm, lip / 1.34);
bend_c = [max(reach, plate + arm + 2 * bend) - bend - arm / 2, arm_y + bend];
// Отверстия: верхнее у края пластины, нижнее над крюком.
holes = [plate_height - head / 2 - 5, max(arm + head / 2 + 6, plate_height * 0.4)];

// Дуга шириной arm от угла a0 до a1 вокруг центра c радиусом r.
module arc(c, r, a0, a1) {
    polygon(concat(
        [for (a = [a0 : 5 : a1]) c + (r + arm / 2) * [cos(a), sin(a)]],
        [for (a = [a1 : -5 : a0]) c + (r - arm / 2) * [cos(a), sin(a)]]
    ));
    translate(c + r * [cos(a1), sin(a1)]) circle(d = arm);
}

// Профиль сбоку: x — от стены, y — вверх.
module profile() {
    // Внешние углы скруглены на 1 мм, внутренние — на 4 мм.
    offset(r = 1) offset(r = -1)
        offset(r = -4) offset(r = 4)
            union() {
                square([plate, plate_height]);
                hull() {
                    translate([plate, arm_y]) circle(d = arm);
                    translate([bend_c[0], arm_y]) circle(d = arm);
                }
                arc(bend_c, bend, -90, 20);
            }
}

difference() {
    linear_extrude(height = w) profile();
    for (y = holes) {
        // Сквозное отверстие и потай под шляпку с лицевой стороны.
        translate([-1, y, w / 2]) rotate([0, 90, 0])
            cylinder(h = plate + 2, d = screw, $fn = 24);
        translate([plate - (head - screw) / 2, y, w / 2]) rotate([0, 90, 0])
            cylinder(h = (head - screw) / 2 + 0.01, d1 = screw, d2 = head, $fn = 24);
    }
}
