// Programs a person can open and change. They also show an agent how the language reads.

export interface Example {
	id: string;
	label: { en: string; ru: string };
	code: string;
}

export const EXAMPLES: Example[] = [
	{
		id: 'tv',
		label: { en: 'Television', ru: 'Телевизор' },
		code: `const w = param('width', 1230, 600, 2000)
const panel = box(w, 40, w * .58, 6).color('black').at(0, 0, 90)
const screen = box(w - 16, w * .58 - 16, 1).on(panel, 'front').color('glass')
const neck = box(260, 60, 90).to(panel, 'bottom', 0, 0, 2).color('dark')
const foot = box(520, 260, 12, 4).at(0, 0, 0).color('dark')
return { panel, screen, neck, foot }
`
	},
	{
		id: 'phone',
		label: { en: 'Phone', ru: 'Телефон' },
		code: `const body = box(72, 8, 150, 3).color('navy')
const glass = box(69, 147, .6, .3).on(body, 'front').color('glass')
const hole = cyl(2, .3).on(glass, 'front', 0, 66).color('black')
const power = box(1, 18, 1).on(body, 'right', 0, 40).color('steel')
const volume = box(1, 30, 1).on(body, 'left', 0, 40).color('steel')
const bump = box(30, 30, 1.6, 6).on(body, 'back', 16, 54).color('navy')
const lens = cyl(6, 1).on(bump, 'back', 6, 6).color('glass')
const lenses = group(lens, lens.z(-13), lens.x(-12.5).z(-6))
return { body, glass, hole, power, volume, bump, lenses }
`
	},
	{
		id: 'laptop',
		label: { en: 'Laptop', ru: 'Ноутбук' },
		code: `const base = box(320, 220, 14, 5).color('gray')
const lid = box(320, 8, 214, 4).rot(-14, 0, 0).on(base, 'top', 0, 108, 3).color('gray')
const screen = box(296, 186, .6, .3).on(lid, 'front', 0, 0).rot(-14, 0, 0).color('glass')
const key = box(16, 16, 1.4, 2).color('dark')
const keys = key.grid(13, 5, 21, 21).on(base, 'top', 0, 26, .4)
const pad = box(90, 64, .6, 3).on(base, 'top', 0, -70).color('dark')
return { base, lid, screen, keys, pad }
`
	},
	{
		id: 'bed',
		label: { en: 'Bed', ru: 'Кровать' },
		code: `const legs = cyl(25, 120).grid(2, 2, 1500, 1900).color('wood')
const frame = box(1640, 2040, 120, 12).at(0, 0, 120).color('wood')
const mattress = soft(1600, 2000, 220, 8).on(frame, 'top', 0, 0, 40).color('white')
const head = box(1640, 60, 800, 20).at(0, 1040, 120).color('wood')
const pillow = soft(700, 460, 150, 4).on(mattress, 'top', 0, 700, 20).color('cream')
const pillows = pillow.row(2, 800)
const blanket = soft(1660, 1200, 90, 6).on(mattress, 'top', 0, -300, 20).color('blue')
return { legs, frame, mattress, head, pillows, blanket }
`
	},
	{
		id: 'sofa',
		label: { en: 'Sofa', ru: 'Диван' },
		code: `const seats = 3, seat = 620
const width = seats * seat
const feet = cyl(20, 100).grid(2, 2, width + 160, 760).color('black')
const base = box(width + 300, 880, 220, 30).at(0, 0, 100).color('gray')
const arm = soft(170, 880, 460, 6).at(width / 2 + 90, 0, 100).both().color('gray')
const back = soft(width, 200, 560, 6).at(0, 360, 200).color('gray')
const cushion = soft(seat - 10, 720, 180, 7).on(base, 'top', -seat, -40, 40).color('dark')
const sit = cushion.row(seats, seat).x(seat)
const rest = soft(seat - 10, 180, 420, 5).rot(-12, 0, 0).on(sit, 'top', -seat, 290, 30).row(seats, seat).x(seat).color('dark')
return { feet, base, arm, back, sit, rest }
`
	},
	{
		id: 'chair',
		label: { en: 'Chair', ru: 'Стул' },
		code: `const seat = soft(460, 440, 70, 5).at(0, 0, 420).color('wood')
const leg = cone(22, 16, 430).rot(4, 4, 0).at(190, 170, 0).color('wood')
const legs = group(leg, leg.flip('y').y(-340)).both()
const back = box(420, 28, 320, 14).rot(-8, 0, 0).on(seat, 'top', 0, 200, 16).color('wood').cut(box(300, 60, 120, 20).mid(0, 225, 700))
return { seat, legs, back }
`
	},
	{
		id: 'lamp',
		label: { en: 'Lamp', ru: 'Лампа' },
		code: `const foot = lathe([[0, 0], [90, 0], [92, 6], [40, 16], [12, 26], [0, 26]]).color('brass')
const stem = bar([[0, 0, 20], [0, 0, 180], [40, 0, 300], [120, 0, 340]], 6).color('brass')
const shade = lathe([[10, 60], [34, 60], [76, 0], [72, 0], [30, 56], [10, 56]]).rot(0, 180, 0).mid(120, 0, 310).color('white')
const bulb = ball(22).mid(120, 0, 306).color('yellow')
return { foot, stem, shade, bulb }
`
	},
	{
		id: 'teapot',
		label: { en: 'Teapot', ru: 'Чайник' },
		code: `const pot = lathe([[0, 0], [48, 0], [74, 26], [82, 58], [70, 92], [44, 108], [30, 112], [0, 112]], true).color('cream')
const lid = lathe([[0, 0], [34, 0], [28, 10], [8, 16], [10, 26], [0, 30]], true).on(pot, 'top', 0, 0, 2).color('cream')
const spout = bar([[66, 0, 50], [100, 0, 70], [116, 0, 104], [132, 0, 118]], 9).color('cream')
const handle = bar([[-66, 0, 86], [-112, 0, 90], [-124, 0, 58], [-96, 0, 30], [-74, 0, 34]], 6).color('cream')
return { teapot: group(pot, spout, handle), lid }
`
	},
	{
		id: 'car',
		label: { en: 'Car', ru: 'Машина' },
		code: `const lower = loft('y', [[-225, 130, 34, 4, 0, 48], [-200, 165, 44, 5, 0, 52], [-100, 178, 56, 5, 0, 56], [100, 178, 58, 5, 0, 58], [200, 168, 54, 5, 0, 60], [225, 140, 40, 4, 0, 62]]).color('red')
const cabin = loft('y', [[-80, 130, 14, 3, 0, 84], [-50, 150, 44, 3, 0, 96], [20, 150, 66, 4, 0, 104], [90, 146, 56, 4, 0, 100], [150, 130, 16, 3, 0, 86]]).color('red')
const arch = cyl(38, 240).rot(0, 90, 0)
const wheelsAt = [-135, 135]
const shell = lower.add(cabin).cut(...wheelsAt.map((y) => arch.mid(0, y, 32)))
const glassBand = box(240, 240, 30).at(0, 40, 92)
const body = shell.patch(glassBand, .6, 'glass')
const wheels = group(...wheelsAt.map((y) => wheel(32, 26).at(82, y, 0).both()))
const lamp = soft(36, 8, 12, 3).on(lower, 'front', 56, 8, 3).both().color('white')
const tail = soft(40, 6, 10, 3).on(lower, 'back', 56, 10, 2).both().color('red')
return { body, wheels, lamp, tail }
`
	},
	{
		id: 'helicopter',
		label: { en: 'Helicopter', ru: 'Вертолёт' },
		code: `const hull = loft('y', [[-150, 8, 8, 2, 0, 74], [-125, 76, 84, 2.5, 0, 72], [-60, 104, 120, 3, 0, 76], [40, 96, 112, 3, 0, 84], [110, 40, 50, 2.5, 0, 112], [340, 8, 14, 2, 0, 120]]).color('yellow')
const skin = hull.patch(box(200, 90, 62).at(0, -105, 88), .8, 'glass')
const mast = cyl(7, 26).on(hull, 'top', 0, -10, 4).color('dark')
const main = rotor(4, 200, 16).on(mast).color('dark')
const fin = wing(66, 44, 26, { sweep: 26, thick: .1 }).rot(0, -90, 0).to(hull, 'back', 0, -6, 12).color('yellow')
const stab = wing(40, 26, 16, { sweep: 8, thick: .1 }).move(0, 290, 118).both().color('yellow')
const tailRotor = rotor(2, 34, 7).rot(0, 90, 0).mid(10, 330, 150).color('dark')
const skid = bar([[62, -120, 20], [62, -100, 6], [62, 90, 6], [62, 106, 14]], 3.4).both().color('dark')
const strut = rod([62, -50, 6], [30, -50, 40], 2.6).both().color('dark')
const struts = group(strut, strut.y(100))
return { skin, mast, main, fin, stab, tailRotor, skid, struts }
`
	},
	{
		id: 'plane',
		label: { en: 'Plane', ru: 'Самолёт' },
		code: `const body = loft('y', [[-300, 6, 8, 2, 0, 62], [-268, 44, 50, 2, 0, 60], [-200, 64, 66, 2, 0, 60], [140, 64, 66, 2, 0, 60], [280, 22, 26, 2, 0, 74], [330, 6, 8, 2, 0, 80]]).color('white')
const glass = body.patch(box(60, 30, 24).at(0, -262, 66), .5, 'glass')
const wings = wing(330, 120, 36, { sweep: 110, rise: 34, twist: -2 }).move(26, -60, 46).both().color('white')
const tailplane = wing(110, 50, 22, { sweep: 44, rise: 8 }).move(6, 270, 78).both().color('white')
const fin = wing(110, 76, 34, { sweep: 70, thick: .1 }).rot(0, -90, 0).mid(0, 300, 136).color('navy')
const engine = loft('y', [[-40, 30, 30], [-30, 44, 44], [30, 40, 40], [50, 24, 24]]).mid(130, -26, 16).both().color('steel')
const window = cyl(2.6, .8).on(body, 'right', 10, 12).row(26, 0, 13).both().color('glass')
return { glass, wings, tailplane, fin, engine, window }
`
	},
	{
		id: 'rocket',
		label: { en: 'Rocket', ru: 'Ракета' },
		code: `const hull = lathe([[0, 0], [60, 0], [60, 420], [50, 520], [26, 600], [0, 640]], false).color('white')
const stripe = hull.patch(box(200, 200, 40).at(0, 0, 330), .6, 'red')
const fins = wing(110, 120, 40, { sweep: 90, thick: .08 }).rot(90, 0, 0).mid(115, 0, 56).around(4).color('red')
const nozzle = cone(28, 44, 50).rot(180, 0, 0).at(0, 0, -44).color('dark')
const window = cyl(16, 2).on(hull, 'front', 0, 120).color('glass')
return { stripe, fins, nozzle, window }
`
	},
	{
		id: 'drone',
		label: { en: 'Drone', ru: 'Дрон' },
		code: `const body = soft(90, 150, 44, 3).at(0, 0, 60).color('white')
const camera = ball(16).to(body, 'front', 0, -18, 10).color('black')
const arm = bar([[30, 40, 84], [130, 130, 96]], 7, false).color('dark')
const arms = arm.both('x').both('y')
const motors = cyl(14, 22).mid(130, 130, 104).both('x').both('y').color('steel')
const props = rotor(2, 76, 12).mid(130, 130, 118).both('x').both('y').color('black')
const skid = bar([[60, -60, 8], [60, 60, 8]], 3).both().color('dark')
const legs = rod([60, 0, 8], [30, 0, 66], 2.5).both().color('dark')
return { body, camera, arms, motors, props, skid, legs }
`
	},
	{
		id: 'tank',
		label: { en: 'Tank', ru: 'Танк' },
		code: `const hull = poly([[-90, -220], [90, -220], [110, -150], [110, 180], [90, 220], [-90, 220], [-110, 180], [-110, -150]], 60, 6).at(0, 0, 50).color('green')
const turret = lathe([[0, 0], [86, 0], [74, 34], [0, 40]]).on(hull, 'top', 0, 20).color('green')
const barrel = cyl(7, 240).rot(90, 0, 0).to(turret, 'front', 0, -6, 12).color('green')
const tracks = track([[-200, 36, 34], [200, 36, 34], [160, 86, 16], [-160, 86, 16]], 44).x(135).both()
const hatch = cyl(20, 6).on(turret, 'top', 20, 6).color('green')
return { hull, turret, barrel, tracks, hatch }
`
	},
	{
		id: 'gearbox',
		label: { en: 'Gears', ru: 'Шестерни' },
		code: `const big = gear(32, 3, 12, 10).at(0, 0, 8).color('steel')
const small = gear(16, 3, 12, 8).at(72, 0, 8).color('brass')
const plate = box(190, 130, 8, 4).mid(30, 0, 4).color('dark')
const holes = plate.hole(5, plate.corners(10))
const shafts = group(cyl(4.9, 30).at(0, 0, 4), cyl(3.9, 30).at(72, 0, 4)).color('steel')
const logo = text('MAKER', 12, 1).on(plate, 'top', 30, -48).color('white')
return { holes, big, small, shafts, logo }
`
	},
	{
		id: 'hook',
		label: { en: 'Wall hook', ru: 'Крючок на стену' },
		code: `const plate = box(40, 4, 110, 2).color('steel')
const screws = plate.hole(4.5, [[0, 38], [0, -38]], undefined, 'front')
const arm = bar([[0, 0, 40], [0, -36, 34], [0, -46, 14], [0, -36, 2], [0, -24, 8]], 5).color('steel')
return { wall: screws.add(arm) }
`
	},
	{
		id: 'holder',
		label: { en: 'Phone holder', ru: 'Держатель телефона' },
		code: `const w = param('phone', 80, 60, 110), t = param('thick', 12, 8, 20)
const base = box(w + 20, 90, 8, 3)
const cradle = box(w + 10, t + 8, 60, 3).rot(16, 0, 0).on(base, 'top', 0, 4, 2).cut(box(w, t, 70).rot(16, 0, 0).at(0, 4, 18))
const cable = box(16, 30, 12).at(0, 0, -2)
return { holder: base.add(cradle).cut(cable).color('orange') }
`
	}
];
