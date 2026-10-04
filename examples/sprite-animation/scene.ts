import { Container, Graphics, TextStyle, Texture, type Renderer } from 'pixi.js';

const FRAME_SIZE = 48;

// ==================== Texture Generation ====================

/** Draw a stick figure at a given walk phase (0-3) */
function drawStickFigure(
	gfx: Graphics,
	color: number,
	phase: number,
): Graphics {
	const cx = FRAME_SIZE / 2;
	const headY = 10;
	const bodyTop = 16;
	const bodyBottom = 30;
	const legLen = 14;

	// Head
	gfx.circle(cx, headY, 6).fill(color);
	// Body
	gfx.moveTo(cx, bodyTop).lineTo(cx, bodyBottom).stroke({ color, width: 2 });

	// Arms — swing based on phase
	const armSwing = Math.sin((phase / 4) * Math.PI * 2) * 8;
	gfx.moveTo(cx, bodyTop + 4)
		.lineTo(cx - 10, bodyTop + 10 + armSwing)
		.stroke({ color, width: 2 });
	gfx.moveTo(cx, bodyTop + 4)
		.lineTo(cx + 10, bodyTop + 10 - armSwing)
		.stroke({ color, width: 2 });

	// Legs — alternate based on phase
	const legSwing = Math.sin((phase / 4) * Math.PI * 2) * 10;
	gfx.moveTo(cx, bodyBottom)
		.lineTo(cx - 4 + legSwing, bodyBottom + legLen)
		.stroke({ color, width: 2 });
	gfx.moveTo(cx, bodyBottom)
		.lineTo(cx + 4 - legSwing, bodyBottom + legLen)
		.stroke({ color, width: 2 });

	return gfx;
}

/** Generate walk-cycle textures for a stick figure */
export function generateWalkFrames(renderer: Renderer, color: number, frameCount: number): Texture[] {
	return Array.from({ length: frameCount }, (_, i) => {
		const gfx = new Graphics();
		drawStickFigure(gfx, color, i);
		const texture = renderer.generateTexture(gfx);
		gfx.destroy();
		return texture;
	});
}

/** Generate a pulsing circle animation (for coin / collectible) */
export function generatePulseFrames(renderer: Renderer, color: number, frameCount: number): Texture[] {
	return Array.from({ length: frameCount }, (_, i) => {
		const gfx = new Graphics();
		const t = i / frameCount;
		const radius = 12 + Math.sin(t * Math.PI * 2) * 4;
		const alpha = 0.6 + Math.sin(t * Math.PI * 2) * 0.4;
		gfx.circle(FRAME_SIZE / 2, FRAME_SIZE / 2, radius).fill({ color, alpha });
		const texture = renderer.generateTexture(gfx);
		gfx.destroy();
		return texture;
	});
}

/** Generate an explosion animation (expanding ring that fades) */
export function generateExplosionFrames(renderer: Renderer, frameCount: number): Texture[] {
	return Array.from({ length: frameCount }, (_, i) => {
		const gfx = new Graphics();
		const t = i / (frameCount - 1);
		const radius = 6 + t * 20;
		const alpha = 1 - t;
		// Outer ring
		gfx.circle(FRAME_SIZE / 2, FRAME_SIZE / 2, radius)
			.fill({ color: 0xff4400, alpha: alpha * 0.3 });
		gfx.circle(FRAME_SIZE / 2, FRAME_SIZE / 2, radius * 0.7)
			.fill({ color: 0xffaa00, alpha: alpha * 0.6 });
		// Core
		gfx.circle(FRAME_SIZE / 2, FRAME_SIZE / 2, radius * 0.3)
			.fill({ color: 0xffffcc, alpha });
		const texture = renderer.generateTexture(gfx);
		gfx.destroy();
		return texture;
	});
}

/** Generate a spinning square animation */
export function generateSpinFrames(renderer: Renderer, color: number, frameCount: number): Texture[] {
	return Array.from({ length: frameCount }, (_, i) => {
		const gfx = new Graphics();
		const t = i / frameCount;
		const cx = FRAME_SIZE / 2;
		const cy = FRAME_SIZE / 2;
		const scaleX = Math.cos(t * Math.PI * 2);
		const halfW = 10 * Math.abs(scaleX);
		const halfH = 10;
		gfx.rect(cx - halfW, cy - halfH, halfW * 2, halfH * 2).fill(color);
		const texture = renderer.generateTexture(gfx);
		gfx.destroy();
		return texture;
	});
}

// Objects and frame textures belong to this example, not the renderer plugin.
// Frames can be shared by several sprites; release each texture once at teardown.
export function createSceneAssets() {
	const objects = new Set<Container>();
	const textures = new Set<Texture>();
	const listeners = new AbortController();
	return {
		listeners,
		own<T extends Container>(object: T): T {
			objects.add(object);
			return object;
		},
		frames(frames: Texture[]): Texture[] {
			frames.forEach(function ownFrame(texture) { textures.add(texture); });
			return frames;
		},
		dispose() {
			listeners.abort();
			objects.forEach(function destroyObject(object) { object.destroy(); });
			textures.forEach(function destroyFrame(texture) { texture.destroy(true); });
			objects.clear();
			textures.clear();
		},
	};
}

export const labelStyle = new TextStyle({ fontFamily: 'monospace', fontSize: 13, fill: '#aaaaaa' });
export const smallLabelStyle = new TextStyle({ fontFamily: 'monospace', fontSize: 11, fill: '#666666' });
export const indicatorStyle = new TextStyle({ fontFamily: 'monospace', fontSize: 14, fill: '#ffffff' });
export const infoStyle = new TextStyle({ fontFamily: 'monospace', fontSize: 11, fill: '#555555' });
