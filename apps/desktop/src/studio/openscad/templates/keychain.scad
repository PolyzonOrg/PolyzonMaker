// Брелок с отверстием и выпуклой надписью. Форма обтягивает текст:
// длинное имя — длинный брелок, ничего не вылезает за край.
// Для надписи другим цветом — смена пластика на высоте толщины брелока.
$fn = 48;

/* [Надпись] */
// Текст
label = "Привет";
// Высота заглавных букв, мм
font_size = 8;          // [4:0.5:16]
// Надпись над брелоком, мм
text_height = 1;        // [0.4:0.2:2]
/* [Брелок] */
// Толщина, мм
thickness = 3;          // [2:0.5:6]
// Поля вокруг надписи, мм
margin = 3.5;           // [2:0.5:8]
/* [Отверстие] */
// Диаметр отверстия, мм
hole_diameter = 5;      // [3:0.5:8]

ring = max(hole_diameter + 6, font_size + 2 * margin);
hole_x = ring / 2;
text_x0 = ring - 1;

module words() {
    text(label, font = "Noto Sans", size = font_size, halign = "left", valign = "center");
}

module outline() {
    hull() {
        translate([hole_x, 0]) circle(d = ring);
        translate([text_x0, 0]) offset(r = margin) words();
    }
}

difference() {
    linear_extrude(height = thickness) outline();
    translate([hole_x, 0, -1])
        cylinder(h = thickness + 2, d = hole_diameter);
}
translate([text_x0, 0, thickness])
    linear_extrude(height = text_height) words();
