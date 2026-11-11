// Подставка для телефона: наклонная спинка на треугольной опоре,
// полочка с бортиком и вырез под кабель. Печатается стоя, без поддержек.
$fn = 32;

/* [Подставка] */
// Ширина, мм
width = 70;             // [40:5:140]
// Толщина стенок, мм
thickness = 5;          // [3:0.5:10]
/* [Спинка] */
// Длина спинки, мм
back_length = 95;       // [50:5:160]
// Наклон спинки, °
back_angle = 65;        // [50:1:80]
/* [Полочка] */
// Глубина под телефон в чехле, мм
slot = 13;              // [8:0.5:25]
// Высота бортика, мм
lip = 12;               // [6:1:25]
/* [Кабель] */
// Ширина выреза под кабель, мм
cable = 14;             // [0:1:30]

t = thickness;
// Опорные точки профиля: y — вглубь от бортика, z — вверх.
lip_top = [t / 2, lip];
front = [t / 2, t / 2];
corner = [t / 2 + slot + t, t / 2];
back_top = corner + back_length * [cos(back_angle), sin(back_angle)];
brace = corner + back_length * 0.6 * [cos(back_angle), sin(back_angle)];
foot = [back_top[0] + 12, t / 2];

// Отрезок толщиной t со скруглёнными концами.
module bar(a, b) {
    hull() {
        translate(a) circle(d = t);
        translate(b) circle(d = t);
    }
}

module profile() {
    // Внутренние углы скруглены — ни одной острой ступеньки.
    offset(r = -3) offset(r = 3) {
        bar(lip_top, front);
        bar(front, corner);
        bar(corner, back_top);
        bar(corner, foot);
        bar(brace, foot);
    }
}

difference() {
    rotate([90, 0, 90]) linear_extrude(height = width) profile();
    // Вырез в бортике: кабель уходит вниз из разъёма.
    if (cable > 0)
        translate([(width - cable) / 2, -1, t])
            cube([cable, t + 2, lip + t]);
}
