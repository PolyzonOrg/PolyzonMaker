// Прямозубая шестерня с эвольвентным профилем: две шестерни одного
// модуля сцепляются, межосевое расстояние = модуль × (z1 + z2) / 2.
$fn = 64;

/* [Шестерня] */
// Число зубьев
teeth = 20;             // [8:1:80]
// Модуль, мм
mod = 2;                // [0.5:0.25:5]
// Толщина, мм
thickness = 8;          // [2:0.5:30]
// Угол зацепления, °
pressure_angle = 20;    // [14.5:0.5:25]
/* [Ступица] */
// Диаметр вала, мм
bore = 5;               // [0:0.5:30]
// Лыска на валу (D-профиль)
d_flat = true;
// Диаметр ступицы, мм
hub_diameter = 14;      // [0:1:60]
// Высота ступицы над колесом, мм
hub_height = 4;         // [0:0.5:30]

pitch_r = mod * teeth / 2;
base_r = pitch_r * cos(pressure_angle);
tip_r = pitch_r + mod;
root_r = pitch_r - 1.25 * mod;
// Половина угла зуба на основной окружности, в градусах.
half = 90 / teeth + (tan(pressure_angle) - pressure_angle * PI / 180) * 180 / PI;

// Точка эвольвенты: параметр t (рад) → радиус и угол развёртки.
function inv_r(t) = base_r * sqrt(1 + t * t);
function inv_a(t) = t * 180 / PI - atan(t);
function t_at(r) = sqrt(max(0, pow(r / base_r, 2) - 1));
function polar(r, a) = [r * cos(a), r * sin(a)];

module tooth() {
    t0 = t_at(max(base_r, root_r));
    t1 = t_at(tip_r);
    flank = [for (i = [0 : 8]) let (t = t0 + (t1 - t0) * i / 8) polar(inv_r(t), inv_a(t) - half)];
    polygon(concat(
        [polar(root_r - mod / 2, -half)],
        flank,
        [for (i = [8 : -1 : 0]) [flank[i][0], -flank[i][1]]],
        [polar(root_r - mod / 2, half)]
    ));
}

module gear2d() {
    union() {
        circle(r = root_r);
        for (i = [0 : teeth - 1]) rotate(i * 360 / teeth) tooth();
    }
}

module bore2d() {
    if (bore > 0)
        difference() {
            circle(d = bore, $fn = 32);
            if (d_flat) translate([bore / 2 - bore * 0.15, -bore]) square([bore, 2 * bore]);
        }
}

difference() {
    union() {
        linear_extrude(height = thickness) gear2d();
        if (hub_height > 0 && hub_diameter > bore)
            cylinder(h = thickness + hub_height, d = min(hub_diameter, 2 * root_r - 2));
    }
    translate([0, 0, -1]) linear_extrude(height = thickness + hub_height + 2) bore2d();
}
