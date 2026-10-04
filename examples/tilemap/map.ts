// ==================== Constants ====================

export const TILE_SIZE = 16;
export const RENDER_SCALE = 2;
export const TILE_PX = TILE_SIZE * RENDER_SCALE;

export const MAP_W = 24;
export const MAP_H = 16;
export const MAP_PX_W = MAP_W * TILE_PX;
export const MAP_PX_H = MAP_H * TILE_PX;

export const TILESHEET_COLUMNS = 12;

export const VIEWPORT_W = 800;
export const VIEWPORT_H = 600;

export const PLAYER_SPEED = 180;
export const PLAYER_BOX = Math.floor(TILE_PX * 0.7);

// GIDs into Kenney Tiny Town `tilemap_packed.png` (12 cols × 11 rows, 16×16 tiles).
// GID 0 is empty; GID = tile-index + 1.
export const GID_GRASS = 1;
export const GID_GRASS_FLOWER = 3;
export const GID_PATH = 26;
export const GID_PINE_TREE = 4;
export const GID_AUTUMN_TREE = 9;
export const GID_FENCE = 43;
export const GID_STONE = 42;

// 24×16 procedural map. Char legend:
//   `.` grass      `,` grass+flower   `p` path
//   `#` fence      `T` pine tree      `t` autumn tree
//   `S` player spawn (rendered as grass)
export const MAP: readonly string[] = [
	'########################',
	'#.......T..............#',
	'#..,...................#',
	'#......ppppppppp.......#',
	'#......p.......p..T....#',
	'#..T...p...S...p.......#',
	'#......p.......p.......#',
	'#......ppppppppp.......#',
	'#.....,................#',
	'#........T.............#',
	'#.............t........#',
	'#...#####..............#',
	'#...#...#.......t......#',
	'#...#####..............#',
	'#...................T..#',
	'########################',
];

// ==================== Map Decode ====================

interface DecodedMap {
	ground: Uint32Array;
	decorations: Uint32Array;
	spawnTx: number;
	spawnTy: number;
}

const groundOverride: Record<string, number> = {
	',': GID_GRASS_FLOWER,
	'p': GID_PATH,
};

const decorGidFor: Record<string, number> = {
	'#': GID_FENCE,
	'T': GID_PINE_TREE,
	't': GID_AUTUMN_TREE,
};

export function decodeMap(rows: readonly string[]): DecodedMap {
	const ground = new Uint32Array(MAP_W * MAP_H);
	const decorations = new Uint32Array(MAP_W * MAP_H);
	const spawn = { tx: Math.floor(MAP_W / 2), ty: Math.floor(MAP_H / 2) };

	rows.forEach((row, ty) => {
		Array.from(row).forEach((ch, tx) => {
			const idx = ty * MAP_W + tx;
			ground[idx] = groundOverride[ch] ?? GID_GRASS;
			const decor = decorGidFor[ch];
			if (decor !== undefined) decorations[idx] = decor;
			if (ch === 'S') {
				spawn.tx = tx;
				spawn.ty = ty;
			}
		});
	});

	return { ground, decorations, spawnTx: spawn.tx, spawnTy: spawn.ty };
}
