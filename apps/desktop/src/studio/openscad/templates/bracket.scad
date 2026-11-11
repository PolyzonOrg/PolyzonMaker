// Уголок-кронштейн: две полки, рёбра жёсткости по краям, потайные отверстия.
// Лежит так, как печатается, — на боку: слои огибают угол, и он не лопнет по сгибу.
$fn = 48;

/* [Уголок] */
// Длина полок, мм
arm = 60;               // [30:5:150]
// Ширина, мм
width = 30;             // [15:5:80]
// Толщина, мм
thickness = 5;          // [3:0.5:12]
/* [Рёбра жёсткости] */
// Размер ребра, мм
gusset = 30;            // [0:1:100]
// Толщина ребра, мм
gusset_thickness = 4;   // [2:0.5:10]
/* [Отверстия] */
// Диаметр самореза, мм
screw = 4.5;            // [3:0.5:8]
// Диаметр шляпки, мм
head = 9;               // [6:0.5:14]

t = thickness;
g = min(gusset, arm - 2);
// Два отверстия на полке — дальше от угла, чем ребро, чтобы не мешало отвёртке.
holes = [max(t + head / 2 + 3, arm * 0.45), arm - head / 2 - 4];

// Профиль уголка: внутренний угол скруглён.
module profile() {
    offset(r = -t) offset(r = t)
        union() {
            square([arm, t]);
            square([t, arm]);
        }
}

module rib() {
    linear_extrude(height = gusset_thickness)
        polygon([[t, t], [g, t], [t, g]]);
}

// Отверстие сквозь полку и потай на внутренней стороне.
module hole() {
    translate([0, 0, -1]) cylinder(h = t + 2, d = screw, $fn = 24);
    translate([0, 0, t - (head - screw) / 2])
        cylinder(h = (head - screw) / 2 + 0.01, d1 = screw, d2 = head, $fn = 24);
}

difference() {
    union() {
        linear_extrude(height = width) profile();
        if (g > t + 2) {
            rib();
            translate([0, 0, width - gusset_thickness]) rib();
        }
    }
    for (p = holes) {
        // Полка вдоль x: отверстие по y.
        translate([p, 0, width / 2]) rotate([-90, 0, 0]) hole();
        // Полка вдоль y: отверстие по x.
        translate([0, p, width / 2]) rotate([0, 90, 0]) hole();
    }
}
