// ==================== Constants ====================

export const WORLD_W = 800;
export const WORLD_H = 600;
export const VILLAGER_COUNT = 6;
export const VILLAGER_SPEED = 80;
export const VILLAGER_RADIUS = 8;
export const FLEE_SPEED = 160;
export const THREAT_RADIUS = 120;
export const HUNGER_RATE = 8; // per second
export const HUNGER_THRESHOLD = 40; // start seeking food below this
export const EAT_RATE = 50; // per second
export const HARVEST_TIME = 1.5; // seconds
export const DEPOSIT_AMOUNT = 1;
export const EXPLORE_CELL_SIZE = 80;
export const EXPLORE_COLS = Math.ceil(WORLD_W / EXPLORE_CELL_SIZE);
export const EXPLORE_ROWS = Math.ceil(WORLD_H / EXPLORE_CELL_SIZE);
export const EXPLORE_TOTAL = EXPLORE_COLS * EXPLORE_ROWS;

export const COLORS = {
	villager: 0x44bb88,
	flee: 0xff4444,
	eat: 0xffaa22,
	gather: 0x4488ff,
	explore: 0x44dddd,
	idle: 0x888888,
	resource: 0x22cc66,
	resourceDepleted: 0x334433,
	food: 0xffcc44,
	base: 0x8866cc,
	threat: 0xff2222,
	hungerBar: 0xff4444,
	hungerBarBg: 0x442222,
	carriedIndicator: 0x22cc66,
	fogCell: 0x223344,
	exploredCell: 0x1a2a3a,
} as const;

export const resourcePositions = [
	{ x: 80, y: 80 }, { x: 180, y: 60 }, { x: 700, y: 100 },
	{ x: 650, y: 500 }, { x: 100, y: 480 }, { x: 350, y: 50 },
	{ x: 500, y: 530 }, { x: 720, y: 300 },
];

export const foodPositions = [
	{ x: 200, y: 300 }, { x: 600, y: 200 }, { x: 400, y: 500 },
];
