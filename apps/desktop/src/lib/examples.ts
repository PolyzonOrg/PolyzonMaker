// What the catalog's models have really made, for their pages: renders of the models after print
// preparation, the same as on maker.polyzon.org. The pictures are in public/examples. Only real
// work goes here, with the time it took; a model with none shows none.

export interface Example {
	file: string;
	/** The model that made the 3D model */
	model: string;
	/** The picture model whose picture it was made from, when it began with words */
	from?: string;
	seconds: number;
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
	{ file: 'penguin.webp', model: 'hunyuan-mini', seconds: 30.4, alt: { ru: 'Пингвин с пустой табличкой', en: 'Penguin holding a blank sign' } }
];

/** The works of a model: those it made, and for a picture model those made from its pictures. */
export function examplesOf(id: string): Example[] {
	return EXAMPLES.filter((e) => e.model === id || e.from === id);
}
