import { Assets, Container, Graphics, Sprite, type Application, type Texture } from 'pixi.js';

// The same cream field, cup badge, and bean seam used by the landing-page game.
export const examplePalette = {
	background: 0xfff6ea,
	ink: 0x3c2516,
	steam: 0xf3dcc1,
	bean: 0x9d683d,
	spark: 0xb85b3d,
} as const;

export function drawBean(graphics: Graphics, radius: number, color: number = examplePalette.bean): Graphics {
	return graphics
		.ellipse(0, 0, radius * 0.72, radius * 0.95).fill(color)
		.moveTo(0, -radius * 0.65)
		.bezierCurveTo(-radius * 0.4, -radius * 0.1, radius * 0.4, radius * 0.1, 0, radius * 0.65)
		.stroke({ color: examplePalette.background, width: Math.max(1, radius * 0.12) });
}

export function createBeanGraphics(radius: number, color: number = examplePalette.bean): Graphics {
	return drawBean(new Graphics(), radius, color);
}

export async function createCupTexture(renderer: Application['renderer'], radius: number): Promise<Texture> {
	const texture = await Assets.load<Texture>(new URL('../brand/ecspresso-icon-light-transparent.svg', document.baseURI).href);
	const cup = new Sprite(texture);
	cup.anchor.set(0.5);
	cup.width = radius * 1.9;
	cup.height = radius * 1.9;
	const badge = new Container();
	badge.addChild(new Graphics().circle(0, 0, radius).fill(examplePalette.steam), cup);
	const result = renderer.generateTexture(badge);
	badge.destroy({ children: true });
	return result;
}
