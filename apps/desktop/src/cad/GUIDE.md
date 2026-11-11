# CAD programs

JavaScript, run in a sandbox. mm, X right, Y back, Z up, the front is at -Y. A new shape stands on Z = 0, centred on X and Y. Shapes never change: every call gives a new one.

End with `return { body, wheels, door }`: names are the parts. Lists and nested objects work. `part('name', shape)` names one on the way. Failing parts do not sink the others if given as functions: `return { door: () => makeDoor() }`.

## Shapes
box(w, d, h, radius)   cyl(r, h)   cone(r1, r2, h)   ball(r)   torus(R, r)   pipe(r, wall, h)
soft(w, d, h, n)   pillow: n 2 ellipsoid, 4 cushion, 8 nearly a box
lathe([[r, z], …], smooth)   turned around Z
poly([[x, y], …], h, radius)   outline in top view raised h
profile('x'|'y'|'z', [[a, b], …], depth, radius)   outline seen along an axis, centred across it: 'x' takes [y, z], 'y' [x, z]. A side view of a car, a bracket; profile.keep(other view) carves a shape from two views; as a region of .patch it draws windows of any shape.
sweep([[x, y], …], [[x, y, z], …], smooth)   an outline along a path
loft('x'|'y'|'z', [[at, w, h, n, u, v], …])   smooth body through sections along an axis: w across, h the other way; n 2 ellipse, 4–6 rounded box; u, v move the section. Hulls, fuselages, cars, bottles.
hull(a, b, …)   bar([[x, y, z], …], r)   round bar smooth through points   rod(a, b, r)   straight
text('ABC', size, depth)
model('Title')   a model of the library
use('Title', { width: 900 })   another kept program or example as one shape, its colours kept; values set its params. Scenes are made of these. No await inside a used program.

## Ready parts
wing(span, root, tip, { sweep, rise, twist, thick })   root at origin, out along +X, leading edge at -Y
rotor(blades, r, chord, { hub, pitch, twist, tip })   wheel(r, width, { axis, spokes, tyre })
track([[y, z, r], …], width, { belt, lugs })   a caterpillar around wheels seen from the side, centred on X = 0
gear(teeth, module, h, bore)   spring(r, wire, coils, h)

## Place
.at(x, y, z)   the middle of the underside goes here; also takes a point
.mid(x, y, z)   the middle goes here
.move(x, y, z)  .x(d)  .y(d)  .z(d)
.on(b, side, u, v, sink)   stands on that side of b with its underside down, turned to face out, u right and v up from the middle of the side as seen from outside. Lands on the real surface of b, curved too. side: top bottom front back left right.
.to(b, side, u, v, sink)   the same without turning
.rot(x, y, z)   about its own middle   .turn(deg, axis, pivot)
.scale(k | [x, y, z])   .fit({ z: 80 })   .flip('x')

## Copies
.both('x', at)   this and its mirror; chain .both('x').both('y') for four
.row(n, dx, dy, dz)   .grid(nx, ny, dx, dy)   .ring(n, R, axis)   centred on where it stands
.around(n, axis, pivot)   n copies turned around an axis through pivot (the origin): fins, spokes
group(a, b, …)   moves as one and keeps colours

## Shape it
.add(a, b)   one body   .cut(a, b)   .keep(a)
.hole(d, [[x, y], …], depth, side)   through unless depth; points from the middle of side   .corners(inset, side) gives four points
.round(r, which)   .bevel(s, which)   which: 'top' 'bottom' 'z'; all edges without it. Round before cutting with a smooth body: smooth bodies (loft, soft, hull, bar) have no edges.
.shell(wall, side)   hollow, open at side
.patch(region, lift, color)   a coloured skin on a curved body inside region: windows, stripes
.color(name | '#rrggbb')   black white gray dark red orange yellow green blue navy purple pink brown wood cream steel brass copper rubber glass

## Read
.w .d .h   sizes   .left .right .front .back .bottom .top   coordinates
.p(x, y, z)   a point of the bounding box by fractions, -1 to 1: p(0, 0, 1) is the middle of the top
.corners(inset, side)

## Other
param('width', 120, 40, 300, 5)   a number the window shows as a slider; set it by name
sdf.sphere, sdf.box, sdf.capsule, sdf.tube, sdf.union(k, …), sdf.cut(k, …), sdf.mesh(shape, detail)   sculpting with blends
draw, sketchCircle and the rest of replicad work; their shapes go into everything above.
place('part', x, y, z, rx, ry, rz)  paint('part', color)  drop('part')   the window writes these at the top

Build, read the warnings, look with maker_cad_view, change a few words with maker_cad_set edits.
