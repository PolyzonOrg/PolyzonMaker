// The graphics part of the first-run check: a heavy shader for a moment, in megapixels a second.
// It only ranks machines roughly; a model's real speed is measured by running it.

const VERTEX = `#version 300 es
void main() { vec2 p = vec2(gl_VertexID & 1, gl_VertexID >> 1) * 4.0 - 1.0; gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
out vec4 color;
uniform float seed;
void main() {
	vec2 p = gl_FragCoord.xy * 0.01 + seed;
	float v = 0.0;
	for (int i = 0; i < 96; i++) {
		p = vec2(p.x * p.x - p.y * p.y, 2.0 * p.x * p.y) * 0.5 + vec2(sin(p.y + v), cos(p.x - v));
		v += length(p) * 0.01;
	}
	color = vec4(fract(v), fract(v * 3.0), fract(v * 7.0), 1.0);
}`;

const SIDE = 768;
const MILLISECONDS = 1400;

export async function gpuTest(): Promise<{ score: number; renderer: string }> {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = SIDE;
	const gl = canvas.getContext('webgl2', { antialias: false, powerPreference: 'high-performance' });
	if (!gl) return { score: 0, renderer: '' };
	const debug = gl.getExtension('WEBGL_debug_renderer_info');
	const renderer = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
	const shader = (type: number, source: string) => {
		const s = gl.createShader(type)!;
		gl.shaderSource(s, source);
		gl.compileShader(s);
		return s;
	};
	const program = gl.createProgram()!;
	gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
	gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return { score: 0, renderer };
	gl.useProgram(program);
	const seed = gl.getUniformLocation(program, 'seed');
	const pixel = new Uint8Array(4);
	const started = performance.now();
	let frames = 0;
	while (performance.now() - started < MILLISECONDS) {
		gl.uniform1f(seed, frames * 0.01);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); // waits for the frame to finish
		frames++;
		await new Promise((r) => setTimeout(r));
	}
	const seconds = (performance.now() - started) / 1000;
	gl.getExtension('WEBGL_lose_context')?.loseContext();
	return { score: Math.round(((frames * SIDE * SIDE) / 1e6 / seconds) * 10) / 10, renderer };
}
