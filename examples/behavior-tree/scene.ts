import { Container, Graphics } from 'pixi.js';
import { createBeanGraphics, drawBean } from '../brand';
import { COLORS, EXPLORE_CELL_SIZE, EXPLORE_COLS, EXPLORE_TOTAL, THREAT_RADIUS, VILLAGER_RADIUS } from './config';

export function drawVillager(graphics: Graphics, color: number): void {
	drawBean(graphics.clear(), VILLAGER_RADIUS, color);
}

export function drawStateIndicator(indicator: Graphics, state: string): void {
	const colorMap: Record<string, number> = {
		flee: COLORS.flee, eat: COLORS.eat, gather: COLORS.gather,
		explore: COLORS.explore, idle: COLORS.idle,
	};
	indicator.clear().circle(0, 0, 3).fill(colorMap[state] ?? COLORS.idle);
}

export function drawResource(graphics: Graphics, supply: number): Graphics {
	return graphics.clear().rect(-10, -10, 20, 20).fill({
		color: supply > 0 ? COLORS.resource : COLORS.resourceDepleted,
		alpha: Math.max(0.2, supply / 5),
	});
}

export function drawHungerBar(bar: Graphics, hunger: number, carried: number): void {
	bar.clear()
		.rect(-10, -VILLAGER_RADIUS - 8, 20, 3).fill(COLORS.hungerBarBg)
		.rect(-10, -VILLAGER_RADIUS - 8, 20 * hunger / 100, 3).fill(COLORS.hungerBar);
	if (carried > 0) bar.circle(0, -VILLAGER_RADIUS - 13, 2).fill(COLORS.carriedIndicator);
}

export function createFog(container: Container): Graphics[] {
	return Array.from({ length: EXPLORE_TOTAL }, function fogCell(_value, index) {
		const graphics = new Graphics()
			.rect(1, 1, EXPLORE_CELL_SIZE - 2, EXPLORE_CELL_SIZE - 2)
			.fill({ color: COLORS.fogCell, alpha: 0.3 });
		graphics.position.set((index % EXPLORE_COLS) * EXPLORE_CELL_SIZE, Math.floor(index / EXPLORE_COLS) * EXPLORE_CELL_SIZE);
		container.addChild(graphics);
		return graphics;
	});
}

export function markCellExplored(cells: readonly Graphics[], index: number): void {
	const graphics = cells[index];
	if (!graphics) return;
	graphics.clear().rect(1, 1, EXPLORE_CELL_SIZE - 2, EXPLORE_CELL_SIZE - 2)
		.fill({ color: COLORS.exploredCell, alpha: 0.15 });
}

export function createBaseGraphics(): Graphics {
	return new Graphics().rect(-20, -20, 40, 40)
		.fill({ color: COLORS.base, alpha: 0.8 })
		.stroke({ color: COLORS.base, width: 2, alpha: 0.5 });
}

export function createThreatGraphics(): Graphics {
	return new Graphics().circle(0, 0, THREAT_RADIUS)
		.fill({ color: COLORS.threat, alpha: 0.08 })
		.circle(0, 0, 6).fill({ color: COLORS.threat, alpha: 0.6 });
}

export function createVillagerGraphics() {
	const gfx = createBeanGraphics(VILLAGER_RADIUS, COLORS.idle);
	const hungerBar = new Graphics();
	const stateIndicator = new Graphics().circle(0, 0, 3).fill(COLORS.idle);
	stateIndicator.position.set(0, VILLAGER_RADIUS + 5);
	gfx.addChild(hungerBar, stateIndicator);
	return { gfx, hungerBar, stateIndicator };
}
