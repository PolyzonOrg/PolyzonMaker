// Коробка со скруглёнными углами и крышкой на бортике.
// Крышка печатается рядом, бортиком вверх; зазор задаёт, насколько туго она сидит.
$fn = 48;

/* [Коробка] */
// Ширина, мм
width = 80;             // [30:5:200]
// Глубина, мм
depth = 60;             // [25:5:150]
// Высота, мм
height = 40;            // [15:5:120]
// Толщина стенки, мм
wall = 2;               // [1.2:0.2:5]
// Радиус углов, мм
corner = 6;             // [1:0.5:20]
/* [Крышка] */
// Толщина крышки, мм
lid = 2.4;              // [1.2:0.2:5]
// Высота бортика, мм
lip = 6;                // [2:1:15]
// Зазор бортика, мм
clearance = 0.25;       // [0.1:0.05:0.6]

// Прямоугольник со скруглёнными углами, по центру.
module rounded(w, d, r) {
    rr = max(0.01, min(r, w / 2 - 0.01, d / 2 - 0.01));
    offset(r = rr) square([w - 2 * rr, d - 2 * rr], center = true);
}

module box() {
    difference() {
        linear_extrude(height = height) rounded(width, depth, corner);
        translate([0, 0, wall])
            linear_extrude(height = height) rounded(width - 2 * wall, depth - 2 * wall, corner - wall);
    }
}

module lid_part() {
    inside_w = width - 2 * wall - 2 * clearance;
    inside_d = depth - 2 * wall - 2 * clearance;
    linear_extrude(height = lid) rounded(width, depth, corner);
    translate([0, 0, lid])
        linear_extrude(height = lip)
            difference() {
                rounded(inside_w, inside_d, corner - wall - clearance);
                rounded(inside_w - 2 * wall, inside_d - 2 * wall, corner - 2 * wall - clearance);
            }
}

box();
translate([0, depth + 10, 0]) lid_part();
