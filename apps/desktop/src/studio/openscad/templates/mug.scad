// Кружка: стакан со скруглённым краем и D-образная ручка.
// Печатается стоя, без поддержек: ручка нарастает плавной дугой.

/* [Корпус] */
// Диаметр, мм
diameter = 80;          // [50:5:130]
// Высота, мм
height = 95;            // [50:5:160]
// Толщина стенки, мм
wall = 3;               // [2:0.5:6]
// Толщина дна, мм
bottom = 4;             // [2:0.5:8]
/* [Ручка] */
// Высота ручки, мм
handle_height = 60;     // [30:5:120]
// Вынос ручки от стенки, мм
handle_reach = 28;      // [18:1:45]
// Толщина ручки, мм
handle_thickness = 10;  // [6:0.5:16]

r = diameter / 2;
// Ручка не выше корпуса: по 6 мм от дна и от края.
handle_h = min(handle_height, height - 12);
// Скругление внутри у дна — кружку проще мыть.
fillet = min(wall + 1, (height - bottom) / 4);

// Стенка в разрезе: фаска у стола, скруглённый край, скругление у дна.
// Один rotate_extrude без вычитаний — кружка считается за секунды.
profile = concat(
    [[0, 0], [r - 0.8, 0], [r, 0.8]],
    [for (a = [0 : 15 : 180]) [r - wall / 2 + wall / 2 * cos(a), height - wall / 2 + wall / 2 * sin(a)]],
    [for (a = [0 : -15 : -90]) [r - wall - fillet + fillet * cos(a), bottom + fillet + fillet * sin(a)]],
    [[0, bottom]]
);

// Половина тора, вытянутая в «D»; концы уходят в стенку, лишнее внутри срезано.
module handle() {
    zr = handle_h / 2 - handle_thickness / 2;
    xr = handle_reach - handle_thickness / 2 + wall / 2;
    difference() {
        translate([r - wall / 2, 0, height / 2])
            scale([xr / zr, 1, 1])
                rotate([90, 0, 0])
                    rotate([0, 0, -90])
                        rotate_extrude(angle = 180, $fn = 32)
                            translate([zr, 0])
                                scale([1, 1.3])
                                    circle(d = handle_thickness, $fn = 20);
        cylinder(h = height, r = r - wall / 2, $fn = 48);
    }
}

rotate_extrude($fn = 96) polygon(profile);
handle();
