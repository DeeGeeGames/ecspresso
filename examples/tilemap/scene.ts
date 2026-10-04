import { Assets, Graphics, Rectangle, RenderTexture, Sprite, Texture, type Renderer } from 'pixi.js';
import { PLAYER_BOX, TILE_SIZE, TILESHEET_COLUMNS } from './map';

/** Drawing and atlas ownership are local presentation details, independent of ECS. */
export async function createTilePresentation(renderer: Renderer) {
	const tilesheet: Texture = await Assets.load('./assets/tilemap_packed.png');
	tilesheet.source.scaleMode = 'nearest';
	const textures = new Map<number, Texture>();
	const sprites = new Set<Sprite>();
	const playerTextures = new Set<Texture>();

	function tileTexture(gid: number): Texture {
		const cached = textures.get(gid);
		if (cached) return cached;
		const id = gid - 1;
		const sliceTexture = new Texture({
			source: tilesheet.source,
			frame: new Rectangle((id % TILESHEET_COLUMNS) * TILE_SIZE, Math.floor(id / TILESHEET_COLUMNS) * TILE_SIZE, TILE_SIZE, TILE_SIZE),
		});
		const slice = new Sprite(sliceTexture);
		// Dedicated textures prevent GPU filtering from bleeding neighboring tiles.
		const texture = RenderTexture.create({ width: TILE_SIZE, height: TILE_SIZE });
		texture.source.scaleMode = 'nearest';
		renderer.render({ container: slice, target: texture });
		slice.destroy();
		sliceTexture.destroy(); // The Assets-managed atlas source remains shared.
		textures.set(gid, texture);
		return texture;
	}

	return {
		createTileSprite(gid: number): Sprite {
			const sprite = new Sprite(tileTexture(gid));
			sprite.anchor.set(0, 0);
			sprites.add(sprite);
			return sprite;
		},
		createPlayerSprite(): Sprite {
			const graphics = new Graphics().rect(0, 0, PLAYER_BOX, PLAYER_BOX)
				.fill(0xff4466).stroke({ color: 0xffe0e0, width: 2 });
			const texture = renderer.generateTexture(graphics);
			graphics.destroy();
			playerTextures.add(texture);
			const sprite = new Sprite(texture);
			sprite.anchor.set(0.5, 0.5);
			sprites.add(sprite);
			return sprite;
		},
		dispose() {
			sprites.forEach(function destroySprite(sprite) { sprite.destroy(); });
			textures.forEach(function destroyTile(texture) { texture.destroy(true); });
			playerTextures.forEach(function destroyPlayer(texture) { texture.destroy(true); });
			sprites.clear();
			textures.clear();
			playerTextures.clear();
		},
	};
}
