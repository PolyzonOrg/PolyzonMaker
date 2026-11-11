/**
 * A CAD part as the assistant describes it: a list of features, like the
 * timeline of a CAD program — sketch a profile and extrude, revolve, loft or
 * sweep it, combine bodies, fillet and chamfer edges, shell. Later features
 * name earlier ones by id. The browser builds it with OpenCascade (build.ts);
 * the tree is data, never code, and this schema bounds it on both sides.
 *
 * Axes are the studio's: X right, Y depth, Z up, millimetres. A sketch lies on
 * a plane through the origin, moved by `offset` along the plane's normal:
 * XY (top view: x → X, y → Y, normal +Z), XZ (front view: x → X, y → Z,
 * normal +Y), YZ (side view: x → Y, y → Z, normal +X).
 */
import { z } from 'zod';

const LIMIT = 2000;
const num = z.number().finite().min(-LIMIT).max(LIMIT);
const size = z.number().finite().gt(0).max(LIMIT);
const v2 = z.tuple([num, num]);
const v3 = z.tuple([num, num, num]);
const id = z.string().regex(/^[A-Za-z][\w-]{0,31}$/, 'id: a letter, then letters, digits, _ or -');

export const CAD_PLANES = ['XY', 'XZ', 'YZ'] as const;
export type CadPlane = (typeof CAD_PLANES)[number];
const plane = z.enum(CAD_PLANES);
const axis = z.union([z.enum(['X', 'Y', 'Z']), v3]);

/** One step of a path; each ends at the point it names. */
const segment = z.union([
	z.object({ line: v2 }).strict(),
	/** A circular arc through `via`. */
	z.object({ arc: v2, via: v2 }).strict(),
	/** An arc tangent to the previous segment. */
	z.object({ tangentArc: v2 }).strict(),
	/** A smooth curve through these points; the last one is the end. */
	z.object({ spline: z.array(v2).min(1).max(100) }).strict(),
	z.object({ bezier: v2, c1: v2, c2: v2 }).strict()
]);

const holes = z
	.array(z.lazy(() => shape2d))
	.max(60)
	.optional();
const center2 = v2.optional();

/** A closed 2D shape in the sketch plane's x/y. */
const shape2d: z.ZodType<CadShape2D> = z.lazy(() =>
	z.discriminatedUnion('type', [
		z
			.object({
				type: z.literal('rect'),
				width: size,
				height: size,
				/** Corner radius. */
				radius: z.number().min(0).max(LIMIT).optional(),
				center: center2,
				holes
			})
			.strict(),
		z.object({ type: z.literal('circle'), radius: size, center: center2, holes }).strict(),
		z.object({ type: z.literal('ellipse'), rx: size, ry: size, center: center2, holes }).strict(),
		z
			.object({
				type: z.literal('polygon'),
				points: z.array(v2).min(3).max(200),
				/** Rounds every corner. */
				radius: z.number().min(0).max(LIMIT).optional(),
				holes
			})
			.strict(),
		/** A smooth closed curve through the points. */
		z.object({ type: z.literal('spline'), points: z.array(v2).min(3).max(200), holes }).strict(),
		z
			.object({
				type: z.literal('path'),
				start: v2,
				segments: z.array(segment).min(1).max(200),
				/** Close by mirroring the drawn half across the line from start to end. */
				mirror: z.boolean().optional(),
				radius: z.number().min(0).max(LIMIT).optional(),
				holes
			})
			.strict()
	])
);

export type CadSegment = z.infer<typeof segment>;
type Holes = { holes?: CadShape2D[] };
export type CadShape2D =
	| ({
			type: 'rect';
			width: number;
			height: number;
			radius?: number;
			center?: [number, number];
	  } & Holes)
	| ({ type: 'circle'; radius: number; center?: [number, number] } & Holes)
	| ({ type: 'ellipse'; rx: number; ry: number; center?: [number, number] } & Holes)
	| ({ type: 'polygon'; points: [number, number][]; radius?: number } & Holes)
	| ({ type: 'spline'; points: [number, number][] } & Holes)
	| ({
			type: 'path';
			start: [number, number];
			segments: CadSegment[];
			mirror?: boolean;
			radius?: number;
	  } & Holes);

const sketch = { plane, offset: num.optional(), profile: shape2d };

type Selector = {
	all?: true;
	direction?: 'X' | 'Y' | 'Z';
	inPlane?: CadPlane;
	offset?: number;
	inBox?: [[number, number, number], [number, number, number]];
	near?: [number, number, number];
	within?: number;
	curve?: 'line' | 'circle' | 'curve';
	surface?: 'plane' | 'cylinder' | 'curved';
	parallelTo?: CadPlane;
	not?: Selector;
	and?: Selector[];
	or?: Selector[];
};
/** Which edges (fillet, chamfer) or faces (shell) an operation takes. */
const selector: z.ZodType<Selector> = z.lazy(() =>
	z
		.object({
			all: z.literal(true).optional(),
			/** Straight edges parallel to an axis. */
			direction: z.enum(['X', 'Y', 'Z']).optional(),
			/** Lying in a plane (with `offset` along its normal). */
			inPlane: plane.optional(),
			offset: num.optional(),
			inBox: z.tuple([v3, v3]).optional(),
			/** Within `within` mm (default 1) of a point. */
			near: v3.optional(),
			within: size.optional(),
			curve: z.enum(['line', 'circle', 'curve']).optional(),
			surface: z.enum(['plane', 'cylinder', 'curved']).optional(),
			/** Planar faces parallel to a plane. */
			parallelTo: plane.optional(),
			not: selector.optional(),
			and: z.array(selector).min(1).max(10).optional(),
			or: z.array(selector).min(1).max(10).optional()
		})
		.strict()
);
export type CadSelector = Selector;

const target = id;
const feature = z.discriminatedUnion('op', [
	z
		.object({
			id,
			op: z.literal('extrude'),
			...sketch,
			distance: num.refine((d) => d !== 0, 'distance must not be 0'),
			/** Centre the body on the sketch plane. */
			symmetric: z.boolean().optional(),
			/** Degrees of twist over the length. */
			twist: z.number().min(-3600).max(3600).optional(),
			/** Scale of the far end, for tapered bodies. */
			scaleEnd: z.number().min(0.01).max(100).optional()
		})
		.strict(),
	z
		.object({
			id,
			op: z.literal('revolve'),
			...sketch,
			/** Sketch axis (through the sketch origin) to turn around. */
			axis: z.enum(['x', 'y']),
			angle: z.number().gt(0).max(360).optional()
		})
		.strict(),
	z
		.object({
			id,
			op: z.literal('loft'),
			sections: z.array(z.object(sketch).strict()).min(2).max(30),
			/** Straight faces between sections instead of a smooth skin. */
			ruled: z.boolean().optional()
		})
		.strict(),
	z
		.object({
			id,
			op: z.literal('sweep'),
			/** The profile is drawn across the path at its first point. */
			profile: shape2d,
			path: z.array(v3).min(2).max(100),
			/** Smooth curve through the path points (default) or straight segments. */
			smooth: z.boolean().optional()
		})
		.strict(),
	z.object({ id, op: z.literal('box'), from: v3, to: v3 }).strict(),
	z
		.object({
			id,
			op: z.literal('cylinder'),
			radius: size,
			height: size,
			base: v3.optional(),
			axis: axis.optional()
		})
		.strict(),
	z.object({ id, op: z.literal('sphere'), radius: size, center: v3.optional() }).strict(),
	z
		.object({
			id,
			op: z.enum(['union', 'cut', 'intersect']),
			target,
			tools: z.array(id).min(1).max(60)
		})
		.strict(),
	z
		.object({
			id,
			op: z.literal('fillet'),
			target,
			radius: size,
			edges: selector.optional()
		})
		.strict(),
	z
		.object({
			id,
			op: z.literal('chamfer'),
			target,
			distance: size,
			edges: selector.optional()
		})
		.strict(),
	z
		.object({
			id,
			op: z.literal('shell'),
			target,
			thickness: size,
			/** The faces removed to open the shell. */
			faces: selector
		})
		.strict(),
	z
		.object({
			id,
			op: z.literal('transform'),
			target,
			translate: v3.optional(),
			rotate: z
				.object({ axis, angle: z.number().min(-3600).max(3600), origin: v3.optional() })
				.strict()
				.optional(),
			scale: z.number().min(0.01).max(100).optional()
		})
		.strict(),
	z
		.object({
			id,
			op: z.literal('mirror'),
			target,
			plane,
			offset: num.optional(),
			/** Fuse with the original (default) or keep the mirror image only. */
			keepOriginal: z.boolean().optional()
		})
		.strict(),
	z
		.object({
			id,
			op: z.literal('pattern'),
			target,
			count: z.number().int().min(2).max(100),
			/** Linear: the offset between copies. */
			step: v3.optional(),
			/** Circular: around this axis through `origin`, copies spread over `angle` (360). */
			axis: axis.optional(),
			angle: z.number().gt(0).max(360).optional(),
			origin: v3.optional()
		})
		.strict()
]);
export type CadFeature = z.infer<typeof feature>;

export const CAD_MAX_FEATURES = 80;

/** Longest CAD program (program.ts) the assistant may send to the browser. */
export const CAD_CODE_MAX = 60_000;
/**
 * The one thing a program may not say: `import` — dynamic import is syntax,
 * so no shadowed name or lockdown can take it away. Everything else that
 * reaches outside is undefined inside the program (program.ts SHADOWED, lockdown).
 */
export const CAD_CODE_BANNED = /\bimport\b/;

export const cadModelSchema = z
	.object({
		features: z.array(feature).min(1).max(CAD_MAX_FEATURES),
		/** The part; the last feature by default. */
		result: id.optional()
	})
	.strict()
	.superRefine((model, ctx) => {
		const seen = new Set<string>();
		model.features.forEach((f, i) => {
			if (seen.has(f.id))
				ctx.addIssue({
					code: 'custom',
					path: ['features', i, 'id'],
					message: `duplicate id ${f.id}`
				});
			const refs = 'tools' in f ? [f.target, ...f.tools] : 'target' in f ? [f.target] : [];
			for (const ref of refs) {
				if (!seen.has(ref))
					ctx.addIssue({
						code: 'custom',
						path: ['features', i],
						message: `${f.id} refers to ${ref}, which is not defined before it`
					});
			}
			seen.add(f.id);
		});
		if (model.result && !seen.has(model.result))
			ctx.addIssue({
				code: 'custom',
				path: ['result'],
				message: `result ${model.result} is not a feature`
			});
	});
export type CadModel = z.infer<typeof cadModelSchema>;
