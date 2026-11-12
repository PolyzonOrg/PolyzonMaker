// What the catalog's models have really made, for their pages: 3D models drawn in grey, as on
// maker.polyzon.org, and the pictures the picture models drew. The files are in public/examples. Only
// real work goes here, with the time it took; a model with none shows none, and a failed result none.

export interface Example {
	file: string;
	/** The model that made it: the 3D model, or the picture model for a picture */
	model: string;
	/** A picture a picture model drew; without it, a 3D model */
	kind?: 'picture';
	/** The picture model whose picture the 3D model was made from, when it began with words */
	from?: string;
	/** That picture, when it is among the examples too */
	picture?: string;
	seconds: number;
	/** Where it ran, when not on the graphics card */
	device?: 'cpu';
	alt: { ru: string; en: string };
}

/** Where every time below was measured */
export const MEASURED_ON = 'RTX 5070 Ti, Windows 11';

export const EXAMPLES: Example[] = [
	{ file: 'dragon-klein.webp', model: 'trellis2', from: 'klein', seconds: 77.2, alt: { ru: 'Керамический дракончик, сделанный из текстового описания: слова, картинка, 3D-модель', en: 'Ceramic dragon figurine made from a text prompt: words, picture, 3D model' } },
	{ file: 'dragon-zimage.webp', model: 'triposg', from: 'zimage', seconds: 60.3, alt: { ru: 'Дракончик анфас, модель сделана из текстового описания', en: 'Dragon figurine from the front, a model made from a text prompt' } },
	{ file: 'goblin.webp', model: 'trellis2', seconds: 56.4, alt: { ru: 'Гоблин в доспехах с секирой', en: 'Armoured goblin with a poleaxe' } },
	{ file: 'dinosaur.webp', model: 'hunyuan-mini', seconds: 30.9, alt: { ru: 'Мультяшный динозавр в профиль', en: 'Cartoon dinosaur in profile' } },
	{ file: 'tank-cartoon.webp', model: 'hunyuan-mini', seconds: 31.4, alt: { ru: 'Игрушечный танк с антенной', en: 'Toy tank with an antenna' } },
	{ file: 'tank-toy.webp', model: 'trellis2', seconds: 100.5, alt: { ru: 'Маленький танк с гусеницами', en: 'Small tracked tank' } },
	{ file: 'cat.webp', model: 'hunyuan-mini', seconds: 30.6, alt: { ru: 'Сидящий британский кот', en: 'Sitting British Shorthair cat' } },
	{ file: 'kitten.webp', model: 'triposg', seconds: 46.6, alt: { ru: 'Котёнок с большими глазами и хвостом крючком', en: 'Big-eyed kitten with a curled tail' } },
	{ file: 'airplane.webp', model: 'trellis2', seconds: 65.5, alt: { ru: 'Пухлый игрушечный самолёт', en: 'Chubby toy airplane' } },
	{ file: 'jet.webp', model: 'hunyuan-mini', seconds: 30, alt: { ru: 'Самолётик со скошенными крыльями', en: 'Small swept-wing jet' } },
	{ file: 'penguin.webp', model: 'hunyuan-mini', seconds: 30.4, alt: { ru: 'Пингвин с пустой табличкой', en: 'Penguin holding a blank sign' } },
	// 2026-11-12, Polyzon Maker 0.3.2: four FLUX.2 klein pictures, each made into 3D by every model
	// installed there; TRELLIS.2's kitten came out a plate and is left out
	{ file: 'picture-kitten-klein.webp', model: 'klein', kind: 'picture', seconds: 10.6, alt: { ru: 'Картинка: котёнок с большими глазами', en: 'Picture: big-eyed kitten' } },
	{ file: 'kitten-hunyuan2.webp', model: 'hunyuan-2', from: 'klein', picture: 'picture-kitten-klein.webp', seconds: 66.5, alt: { ru: 'Котёнок с большими глазами', en: 'Big-eyed kitten' } },
	{ file: 'kitten-mini.webp', model: 'hunyuan-mini', from: 'klein', picture: 'picture-kitten-klein.webp', seconds: 66.6, alt: { ru: 'Котёнок с большими глазами', en: 'Big-eyed kitten' } },
	{ file: 'kitten-pixal3d.webp', model: 'pixal3d', from: 'klein', picture: 'picture-kitten-klein.webp', seconds: 250.6, alt: { ru: 'Котёнок с большими глазами', en: 'Big-eyed kitten' } },
	{ file: 'kitten-triposr.webp', model: 'triposr', from: 'klein', picture: 'picture-kitten-klein.webp', seconds: 34.2, device: 'cpu', alt: { ru: 'Котёнок с большими глазами', en: 'Big-eyed kitten' } },
	{ file: 'picture-dragon-klein.webp', model: 'klein', kind: 'picture', seconds: 27.4, alt: { ru: 'Картинка: керамический дракончик', en: 'Picture: ceramic dragon figurine' } },
	{ file: 'dragon-hunyuan2.webp', model: 'hunyuan-2', from: 'klein', picture: 'picture-dragon-klein.webp', seconds: 82.9, alt: { ru: 'Керамический дракончик', en: 'Ceramic dragon figurine' } },
	{ file: 'dragon-mini.webp', model: 'hunyuan-mini', from: 'klein', picture: 'picture-dragon-klein.webp', seconds: 104.2, alt: { ru: 'Керамический дракончик', en: 'Ceramic dragon figurine' } },
	{ file: 'dragon-trellis2.webp', model: 'trellis2', from: 'klein', picture: 'picture-dragon-klein.webp', seconds: 99.4, alt: { ru: 'Керамический дракончик', en: 'Ceramic dragon figurine' } },
	{ file: 'dragon-pixal3d.webp', model: 'pixal3d', from: 'klein', picture: 'picture-dragon-klein.webp', seconds: 259.7, alt: { ru: 'Керамический дракончик', en: 'Ceramic dragon figurine' } },
	{ file: 'dragon-triposr.webp', model: 'triposr', from: 'klein', picture: 'picture-dragon-klein.webp', seconds: 49.2, device: 'cpu', alt: { ru: 'Керамический дракончик', en: 'Ceramic dragon figurine' } },
	{ file: 'picture-lamp-klein.webp', model: 'klein', kind: 'picture', seconds: 10.7, alt: { ru: 'Картинка: настольная лампа с абажуром', en: 'Picture: desk lamp with a lampshade' } },
	{ file: 'lamp-hunyuan2.webp', model: 'hunyuan-2', from: 'klein', picture: 'picture-lamp-klein.webp', seconds: 66.3, alt: { ru: 'Настольная лампа с абажуром', en: 'Desk lamp with a lampshade' } },
	{ file: 'lamp-mini.webp', model: 'hunyuan-mini', from: 'klein', picture: 'picture-lamp-klein.webp', seconds: 68.1, alt: { ru: 'Настольная лампа с абажуром', en: 'Desk lamp with a lampshade' } },
	{ file: 'lamp-trellis2.webp', model: 'trellis2', from: 'klein', picture: 'picture-lamp-klein.webp', seconds: 58.8, alt: { ru: 'Настольная лампа с абажуром', en: 'Desk lamp with a lampshade' } },
	{ file: 'lamp-pixal3d.webp', model: 'pixal3d', from: 'klein', picture: 'picture-lamp-klein.webp', seconds: 135.4, alt: { ru: 'Настольная лампа с абажуром', en: 'Desk lamp with a lampshade' } },
	{ file: 'lamp-triposr.webp', model: 'triposr', from: 'klein', picture: 'picture-lamp-klein.webp', seconds: 33.1, device: 'cpu', alt: { ru: 'Настольная лампа с абажуром', en: 'Desk lamp with a lampshade' } },
	{ file: 'picture-tank-klein.webp', model: 'klein', kind: 'picture', seconds: 10.8, alt: { ru: 'Картинка: игрушечный танк с антенной', en: 'Picture: toy tank with an antenna' } },
	{ file: 'tank-hunyuan2.webp', model: 'hunyuan-2', from: 'klein', picture: 'picture-tank-klein.webp', seconds: 67.2, alt: { ru: 'Игрушечный танк с антенной', en: 'Toy tank with an antenna' } },
	{ file: 'tank-mini.webp', model: 'hunyuan-mini', from: 'klein', picture: 'picture-tank-klein.webp', seconds: 66, alt: { ru: 'Игрушечный танк с антенной', en: 'Toy tank with an antenna' } },
	{ file: 'tank-trellis2.webp', model: 'trellis2', from: 'klein', picture: 'picture-tank-klein.webp', seconds: 122.3, alt: { ru: 'Игрушечный танк с антенной', en: 'Toy tank with an antenna' } },
	{ file: 'tank-pixal3d.webp', model: 'pixal3d', from: 'klein', picture: 'picture-tank-klein.webp', seconds: 364.9, alt: { ru: 'Игрушечный танк с антенной', en: 'Toy tank with an antenna' } },
	{ file: 'tank-triposr.webp', model: 'triposr', from: 'klein', picture: 'picture-tank-klein.webp', seconds: 35.4, device: 'cpu', alt: { ru: 'Игрушечный танк с антенной', en: 'Toy tank with an antenna' } }
];

/** A source picture and what was made from it. Without one: works whose picture is not ours to show. */
export interface Group {
	picture?: Example;
	made: Example[];
}

/** The works of a model, source by source: each picture with what this model made from it, or for a
 * picture model each of its pictures with everything made from it; then the works without a picture. */
export function groupsOf(id: string): Group[] {
	const ours = (e: Example) => e.model === id || e.from === id;
	const pictures = EXAMPLES.filter((p) => p.kind === 'picture' && (p.model === id || EXAMPLES.some((e) => e.picture === p.file && e.model === id)));
	const groups: Group[] = pictures.map((picture) => ({ picture, made: EXAMPLES.filter((e) => e.picture === picture.file && ours(e)) }));
	const rest = EXAMPLES.filter((e) => e.kind !== 'picture' && !e.picture && ours(e));
	return rest.length ? [...groups, { made: rest }] : groups;
}

/** Everything a model's page shows, in the order it shows it. */
export const examplesOf = (id: string): Example[] => groupsOf(id).flatMap((g) => (g.picture ? [g.picture, ...g.made] : g.made));
