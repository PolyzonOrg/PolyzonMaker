// What views.ts takes from Studio's chat, which stays out: the sides a picture of a model can show.

export const VIEW_NAMES = ['iso', 'iso_back', 'front', 'back', 'left', 'right', 'top', 'bottom'] as const;
export type ViewName = (typeof VIEW_NAMES)[number];

/** How to look at a build: other sides, a section through it, one part alone. */
export interface Look {
	views?: ViewName[];
	/** Keeps the side where the coordinate is at most `at` mm; the cut face shows white. */
	section?: { axis: 'x' | 'y' | 'z'; at: number };
	part?: string;
}

/** A section keeps the side below its plane: these views look at the cut face. */
const SECTION_VIEWS: Record<'x' | 'y' | 'z', ViewName[]> = {
	x: ['iso', 'right', 'front', 'top'],
	y: ['iso_back', 'back', 'top', 'right'],
	z: ['iso', 'top', 'front', 'right']
};

export function viewsOf(look?: Look): ViewName[] {
	return look?.views ?? (look?.section ? SECTION_VIEWS[look.section.axis] : ['iso', 'front', 'top', 'right']);
}
