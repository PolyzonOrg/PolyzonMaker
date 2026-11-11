// Ваза: плавный силуэт через четыре радиуса — дно, «пузо», горло, край.
// Можно печатать в режиме вазы (спиралью) — тогда стенка задаётся в слайсере.

/* [Форма] */
// Высота, мм
height = 140;           // [60:5:250]
// Радиус дна, мм
base_radius = 32;       // [15:1:80]
// Радиус «пуза», мм
belly_radius = 46;      // [15:1:100]
// Высота «пуза», доля высоты
belly_at = 0.35;        // [0.15:0.05:0.6]
// Радиус горла, мм
neck_radius = 22;       // [10:1:80]
// Радиус края, мм
top_radius = 28;        // [10:1:90]
/* [Стенки] */
// Толщина стенки, мм
wall = 2;               // [1:0.2:5]
// Толщина дна, мм
bottom = 3;             // [1.5:0.5:8]

// Опорные точки силуэта (высота, радиус); между ними — плавная S-кривая
// с горизонтальной касательной в каждой точке.
keys = [[0, base_radius], [belly_at * height, belly_radius], [0.78 * height, neck_radius], [height, top_radius]];

function ease(u) = u * u * (3 - 2 * u);
function radius_at(z, i = 0) =
    i >= len(keys) - 2 || z <= keys[i + 1][0]
        ? keys[i][1] + (keys[i + 1][1] - keys[i][1])
            * ease(min(1, max(0, (z - keys[i][0]) / (keys[i + 1][0] - keys[i][0]))))
        : radius_at(z, i + 1);

steps = round(height / 2);
outer = [for (k = [0 : steps]) let (z = height * k / steps) [radius_at(z), z]];
inner = [for (k = [steps : -1 : 0]) let (z = bottom + (height - bottom) * k / steps) [radius_at(z) - wall, z]];

// Стенка в разрезе, один rotate_extrude — без вычитаний, считается мгновенно.
rotate_extrude($fn = 128)
    polygon(concat([[0, 0]], outer, inner, [[0, bottom]]));
