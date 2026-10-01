/**
 * Behavior Tree — Villager AI
 *
 * Demonstrates a behavior tree plugin driving multi-step, priority-based AI.
 * Villagers autonomously gather resources, eat when hungry, and flee threats.
 *
 * Top-level selector (priority order):
 *   1. Flee    — run from nearby threat (player)
 *   2. Eat     — find food when hunger is low
 *   3. Gather  — harvest resource → carry to base → deposit
 *   4. Explore — visit uncharted map cells, clearing fog of war
 *   5. Idle    — wander randomly
 *
 * Move the mouse to act as a threat. Villagers within range flee.
 * Watch hunger bars deplete over time, driving villagers to food.
 */

import { createBeanGraphics, drawBean } from '../brand';
import { Graphics } from 'pixi.js';
import ECSpresso from 'ecspresso';
import {
	createRenderer2DPlugin,
	createGraphicsComponents,
} from 'ecspresso/plugins/rendering/renderer2D';
import { createInputPlugin } from 'ecspresso/plugins/input/input';
import { createSpatialIndexPlugin } from 'ecspresso/plugins/spatial/spatial-index';
import { defineCollisionLayers, createCollisionPlugin, createCircleCollider, type LayersOf } from 'ecspresso/plugins/physics/collision';
import { createDetectionPlugin, createDetector } from 'ecspresso/plugins/ai/detection';
import { createSteeringPlugin, createMoveSpeed } from 'ecspresso/plugins/physics/steering';
import { createDiagnosticsPlugin } from 'ecspresso/plugins/debug/diagnostics';
import {
	NodeStatus,
	createBehaviorTreePlugin,
	createBehaviorTreeHelpers,
	createBehaviorTree,
	selector,
	sequence,
} from 'ecspresso/plugins/ai/behavior-tree';

// ==================== Constants ====================

const WORLD_W = 800;
const WORLD_H = 600;
const VILLAGER_COUNT = 6;
const VILLAGER_SPEED = 80;
const VILLAGER_RADIUS = 8;
const FLEE_SPEED = 160;
const THREAT_RADIUS = 120;
const HUNGER_RATE = 8; // per second
const HUNGER_THRESHOLD = 40; // start seeking food below this
const EAT_RATE = 50; // per second
const HARVEST_TIME = 1.5; // seconds
const DEPOSIT_AMOUNT = 1;
const EXPLORE_CELL_SIZE = 80;
const EXPLORE_COLS = Math.ceil(WORLD_W / EXPLORE_CELL_SIZE);
const EXPLORE_ROWS = Math.ceil(WORLD_H / EXPLORE_CELL_SIZE);
const EXPLORE_TOTAL = EXPLORE_COLS * EXPLORE_ROWS;

const COLORS = {
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

// ==================== Types ====================

interface VillagerBB {
	hunger: number;
	carried: number;
	targetEntityId: number | null;
	harvestTimer: number;
	wanderTarget: Vector2D | null;
	activeState: 'idle' | 'flee' | 'eat' | 'gather' | 'explore';
	/** Bitset tracking which map cells this villager has visited. */
	visitedCells: Uint8Array;
}

interface Vector2D {
	x: number;
	y: number;
}

function isVillagerBlackboard(value: unknown): value is VillagerBB {
	return value !== null
		&& typeof value === 'object'
		&& 'hunger' in value && typeof value.hunger === 'number'
		&& 'carried' in value && typeof value.carried === 'number'
		&& 'targetEntityId' in value
		&& (typeof value.targetEntityId === 'number' || value.targetEntityId === null)
		&& 'harvestTimer' in value && typeof value.harvestTimer === 'number'
		&& 'wanderTarget' in value
		&& (value.wanderTarget === null
			|| (typeof value.wanderTarget === 'object'
				&& 'x' in value.wanderTarget && typeof value.wanderTarget.x === 'number'
				&& 'y' in value.wanderTarget && typeof value.wanderTarget.y === 'number'))
		&& 'activeState' in value
		&& (value.activeState === 'idle'
			|| value.activeState === 'flee'
			|| value.activeState === 'eat'
			|| value.activeState === 'gather'
			|| value.activeState === 'explore')
		&& 'visitedCells' in value
		&& value.visitedCells instanceof Uint8Array;
}

interface AppComponents {
	villager: true;
	resource: { supply: number };
	food: true;
	base: true;
	threat: true;
	hungerBar: Graphics;
	stateIndicator: Graphics;
}

// ==================== Collision Layers ====================

const layers = defineCollisionLayers({
	villager: ['threat'],
	threat: ['villager'],
	resource: [],
	food: [],
	base: [],
});

// ==================== Build ECS ====================

const ecs = ECSpresso
	.create()
	.withPlugin(createRenderer2DPlugin({ background: '#111118', width: WORLD_W, height: WORLD_H }))
	.withPlugin(createCollisionPlugin({ layers }))
	.withPlugin(createSpatialIndexPlugin())
	.withPlugin(createDetectionPlugin<'ai', LayersOf<typeof layers>>())
	.withPlugin(createSteeringPlugin({ arrivalThreshold: 10 }))
	.withPlugin(createInputPlugin({
		actions: {},
	}))
	.withPlugin(createBehaviorTreePlugin())
	.withPlugin(createDiagnosticsPlugin())
	.withComponentTypes<AppComponents>()
	.build();

type ECS = typeof ecs;

// Typed helpers — callbacks get full ECS type for ecs parameter
const { defineBehaviorTree, action, condition, guard } = ecs.getHelpers(createBehaviorTreeHelpers);

// ==================== Helpers ====================

function distSq(ax: number, ay: number, bx: number, by: number): number {
	const dx = ax - bx;
	const dy = ay - by;
	return dx * dx + dy * dy;
}

function findNearest<K extends 'resource' | 'food' | 'base'>(
	world: ECS,
	fromId: number,
	componentName: K,
): { entityId: number; x: number; y: number } | null {
	const fromWt = world.getComponent(fromId, 'worldTransform');
	if (!fromWt) return null;

	const entities = world.getEntitiesWithQuery([componentName, 'worldTransform'] as const);

	const nearest = entities.reduce<{ entityId: number; x: number; y: number; distance: number } | null>(function selectNearest(current, entity) {
		const resource = componentName === 'resource' ? world.getComponent(entity.id, 'resource') : undefined;
		if (resource && resource.supply <= 0) return current;
		const { x, y } = entity.components.worldTransform;
		const distance = distSq(fromWt.x, fromWt.y, x, y);
		if (current && distance >= current.distance) return current;
		return { entityId: entity.id, x, y, distance };
	}, null);
	return nearest ? { entityId: nearest.entityId, x: nearest.x, y: nearest.y } : null;
}

function setMoveTarget(world: ECS, entityId: number, x: number, y: number): void {
	world.addComponent(entityId, 'moveTarget', { x, y });
}

function clearMoveTarget(world: ECS, entityId: number): void {
	if (world.hasComponent(entityId, 'moveTarget')) {
		world.removeComponent(entityId, 'moveTarget');
	}
}

function setVillagerColor(world: ECS, entityId: number, color: number): void {
	const gfx = world.getComponent(entityId, 'graphics');
	if (!gfx) return;
	drawBean(gfx.clear(), VILLAGER_RADIUS, color);
}

function updateStateIndicator(world: ECS, entityId: number, state: string): void {
	const indicator = world.getComponent(entityId, 'stateIndicator');
	if (!indicator) return;
	const colorMap: Record<string, number> = {
		flee: COLORS.flee,
		eat: COLORS.eat,
		gather: COLORS.gather,
		explore: COLORS.explore,
		idle: COLORS.idle,
	};
	indicator.clear()
		.circle(0, 0, 3)
		.fill(colorMap[state] ?? COLORS.idle);
}

// ==================== Explore Helpers ====================

/** Convert world position to cell index. */
function worldToCell(x: number, y: number): number {
	const col = Math.floor(x / EXPLORE_CELL_SIZE);
	const row = Math.floor(y / EXPLORE_CELL_SIZE);
	return Math.max(0, Math.min(EXPLORE_TOTAL - 1, row * EXPLORE_COLS + col));
}

/** Get the center position of a cell. */
function cellCenter(cellIndex: number): Vector2D {
	const col = cellIndex % EXPLORE_COLS;
	const row = Math.floor(cellIndex / EXPLORE_COLS);
	return {
		x: col * EXPLORE_CELL_SIZE + EXPLORE_CELL_SIZE / 2,
		y: row * EXPLORE_CELL_SIZE + EXPLORE_CELL_SIZE / 2,
	};
}

/** Find the nearest unvisited cell from a world position. Returns cell index or -1. */
function findNearestUnvisited(visited: Uint8Array, fromX: number, fromY: number): number {
	return visited.reduce(function selectNearest(current, explored, index) {
		if (explored) return current;
		const center = cellCenter(index);
		const distance = distSq(fromX, fromY, center.x, center.y);
		return distance < current.distance ? { index, distance } : current;
	}, { index: -1, distance: Infinity }).index;
}

/** Shared fog cell graphics — drawn once after initialize, updated as villagers explore. */
const fogCellGraphics: Graphics[] = [];

function markCellExplored(cellIndex: number): void {
	const gfx = fogCellGraphics[cellIndex];
	if (!gfx) return;
	gfx.clear()
		.rect(1, 1, EXPLORE_CELL_SIZE - 2, EXPLORE_CELL_SIZE - 2)
		.fill({ color: COLORS.exploredCell, alpha: 0.15 });
}

// ==================== Walk-To Action Factory ====================

function walkToAction(
	name: string,
	target: 'resource' | 'food' | 'base',
	state: VillagerBB['activeState'],
	color: number,
	arrivalDist: number,
	trackTarget = false,
) {
	return action<VillagerBB>(name, ({ ecs: world, entityId, blackboard: bb }) => {
		bb.activeState = state;
		setVillagerColor(world, entityId, color);
		updateStateIndicator(world, entityId, state);

		if (!world.hasComponent(entityId, 'moveTarget')) {
			const found = findNearest(world, entityId, target);
			if (!found) return NodeStatus.Failure;
			if (trackTarget) bb.targetEntityId = found.entityId;

			const myWt = world.getComponent(entityId, 'worldTransform');
			if (myWt && distSq(myWt.x, myWt.y, found.x, found.y) < arrivalDist * arrivalDist) {
				return NodeStatus.Success;
			}
			setMoveTarget(world, entityId, found.x, found.y);
			return NodeStatus.Running;
		}
		return NodeStatus.Running;
	}, {
		onAbort: ({ ecs: world, entityId, blackboard: bb }) => {
			clearMoveTarget(world, entityId);
			if (trackTarget) bb.targetEntityId = null;
			bb.activeState = 'idle';
		},
	});
}

// ==================== Behavior Tree Definition ====================

const villagerTree = defineBehaviorTree<VillagerBB>('villager', {
	blackboard: {
		hunger: 100,
		carried: 0,
		targetEntityId: null,
		harvestTimer: 0,
		wanderTarget: null,
		activeState: 'idle',
		visitedCells: new Uint8Array(EXPLORE_TOTAL),
	},
	root: selector<VillagerBB>([
		// Priority 1: Flee from threat
		guard<VillagerBB>(
			({ ecs: world, entityId }) => {
				const detected = world.getComponent(entityId, 'detectedEntities');
				return (detected?.entities.length ?? 0) > 0;
			},
			action<VillagerBB>('flee', ({ ecs: world, entityId, blackboard: bb }) => {
				bb.activeState = 'flee';
				const detected = world.getComponent(entityId, 'detectedEntities');
				const nearest = detected?.entities[0];
				if (!nearest) return NodeStatus.Success;

				const myWt = world.getComponent(entityId, 'worldTransform');
				const threatWt = world.getComponent(nearest.entityId, 'worldTransform');
				if (!myWt || !threatWt) return NodeStatus.Success;

				const dx = myWt.x - threatWt.x;
				const dy = myWt.y - threatWt.y;
				const len = Math.sqrt(dx * dx + dy * dy);
				if (len < 1) return NodeStatus.Running;

				const fleeX = myWt.x + (dx / len) * 100;
				const fleeY = myWt.y + (dy / len) * 100;

				// Clamp to world bounds
				const targetX = Math.max(20, Math.min(WORLD_W - 20, fleeX));
				const targetY = Math.max(20, Math.min(WORLD_H - 20, fleeY));

				setMoveTarget(world, entityId, targetX, targetY);

				// Boost speed while fleeing
				world.addComponent(entityId, 'moveSpeed', FLEE_SPEED);
				setVillagerColor(world, entityId, COLORS.flee);
				updateStateIndicator(world, entityId, 'flee');

				return NodeStatus.Running;
			}, {
				onAbort: ({ ecs: world, entityId, blackboard: bb }) => {
					clearMoveTarget(world, entityId);
					world.addComponent(entityId, 'moveSpeed', VILLAGER_SPEED);
					bb.activeState = 'idle';
				},
			}),
		),

		// Priority 2: Eat when hungry
		guard<VillagerBB>(
			({ blackboard: bb }) => bb.hunger < HUNGER_THRESHOLD,
			sequence<VillagerBB>([
				// Find food
				condition<VillagerBB>('food exists', ({ ecs: world, entityId }) => {
					return findNearest(world, entityId, 'food') !== null;
				}),
				walkToAction('walk to food', 'food', 'eat', COLORS.eat, 20, true),
				// Eat
				action<VillagerBB>('eat', ({ blackboard: bb, dt }) => {
					bb.activeState = 'eat';
					bb.hunger = Math.min(100, bb.hunger + EAT_RATE * dt);
					return bb.hunger >= 100 ? NodeStatus.Success : NodeStatus.Running;
				}),
			]),
		),

		// Priority 3: Gather resources
		sequence<VillagerBB>([
			selector<VillagerBB>([
				// Already carrying? Go deposit
				guard<VillagerBB>(
					({ blackboard: bb }) => bb.carried > 0,
					sequence<VillagerBB>([
						walkToAction('walk to base', 'base', 'gather', COLORS.gather, 25),
						// Deposit
						action<VillagerBB>('deposit', ({ blackboard: bb }) => {
							bb.carried = 0;
							return NodeStatus.Success;
						}),
					]),
				),
				// Not carrying? Go harvest
				sequence<VillagerBB>([
					condition<VillagerBB>('resource exists', ({ ecs: world, entityId }) => {
						return findNearest(world, entityId, 'resource') !== null;
					}),
					walkToAction('walk to resource', 'resource', 'gather', COLORS.gather, 20, true),
					// Harvest
					action<VillagerBB>('harvest', ({ ecs: world, blackboard: bb, dt }) => {
						bb.activeState = 'gather';
						bb.harvestTimer += dt;
						if (bb.harvestTimer >= HARVEST_TIME) {
							bb.harvestTimer = 0;
							if (bb.targetEntityId !== null) {
								const res = world.getComponent(bb.targetEntityId, 'resource');
								if (res && res.supply > 0) {
									res.supply -= DEPOSIT_AMOUNT;
									bb.carried += DEPOSIT_AMOUNT;
									const gfx = world.getComponent(bb.targetEntityId, 'graphics');
									if (gfx) {
										const alpha = Math.max(0.2, res.supply / 5);
										gfx.clear().rect(-10, -10, 20, 20).fill({ color: res.supply > 0 ? COLORS.resource : COLORS.resourceDepleted, alpha });
									}
								}
							}
							bb.targetEntityId = null;
							return NodeStatus.Success;
						}
						return NodeStatus.Running;
					}, {
						onAbort: ({ blackboard: bb }) => {
							bb.harvestTimer = 0;
							bb.targetEntityId = null;
						},
					}),
				]),
			]),
		]),

		// Priority 4: Explore unvisited cells
		guard<VillagerBB>(
			({ ecs: world, entityId, blackboard: bb }) => {
				const wt = world.getComponent(entityId, 'worldTransform');
				if (!wt) return false;
				return findNearestUnvisited(bb.visitedCells, wt.x, wt.y) !== -1;
			},
			action<VillagerBB>('explore', ({ ecs: world, entityId, blackboard: bb }) => {
				bb.activeState = 'explore';
				setVillagerColor(world, entityId, COLORS.explore);
				updateStateIndicator(world, entityId, 'explore');

				const wt = world.getComponent(entityId, 'worldTransform');
				if (!wt) return NodeStatus.Failure;

				// Mark current cell as visited
				const currentCell = worldToCell(wt.x, wt.y);
				if (!bb.visitedCells[currentCell]) {
					bb.visitedCells[currentCell] = 1;
					markCellExplored(currentCell);
				}

				// If we have a move target, keep walking
				if (world.hasComponent(entityId, 'moveTarget')) {
					return NodeStatus.Running;
				}

				// Pick next unvisited cell
				const nextCell = findNearestUnvisited(bb.visitedCells, wt.x, wt.y);
				if (nextCell === -1) return NodeStatus.Success; // fully explored
				const target = cellCenter(nextCell);
				setMoveTarget(world, entityId, target.x, target.y);
				return NodeStatus.Running;
			}, {
				onAbort: ({ ecs: world, entityId, blackboard: bb }) => {
					clearMoveTarget(world, entityId);
					bb.activeState = 'idle';
				},
			}),
		),

		// Priority 5: Idle wander
		action<VillagerBB>('wander', ({ ecs: world, entityId, blackboard: bb }) => {
			bb.activeState = 'idle';
			setVillagerColor(world, entityId, COLORS.idle);
			updateStateIndicator(world, entityId, 'idle');

			if (!world.hasComponent(entityId, 'moveTarget')) {
				const x = 40 + Math.random() * (WORLD_W - 80);
				const y = 40 + Math.random() * (WORLD_H - 80);
				setMoveTarget(world, entityId, x, y);
			}
			return NodeStatus.Running;
		}, {
			onAbort: ({ ecs: world, entityId }) => {
				clearMoveTarget(world, entityId);
			},
		}),
	]),
});

// ==================== Systems ====================

// Hunger drain system
ecs
	.addSystem('hunger-drain')
	.inPhase('update')
	.setPriority(50)
	.addQuery('villagers', { with: ['villager', 'behaviorTree'] })
	.setProcess(({ queries, dt }) => {
		for (const entity of queries.villagers) {
			const blackboard = entity.components.behaviorTree.blackboard;
			if (!isVillagerBlackboard(blackboard)) continue;
			blackboard.hunger = Math.max(0, blackboard.hunger - HUNGER_RATE * dt);
		}
	});

// Hunger bar + carried indicator update system
ecs
	.addSystem('hunger-bar-update')
	.inPhase('render')
	.setPriority(900)
	.addQuery('villagers', { with: ['villager', 'behaviorTree', 'hungerBar'] })
	.setProcess(({ queries }) => {
		for (const entity of queries.villagers) {
			const bb = entity.components.behaviorTree.blackboard;
			if (!isVillagerBlackboard(bb)) continue;
			const bar = entity.components.hungerBar;
			const pct = bb.hunger / 100;
			const barW = 20;
			const barH = 3;
			bar.clear()
				.rect(-barW / 2, -VILLAGER_RADIUS - 8, barW, barH)
				.fill(COLORS.hungerBarBg)
				.rect(-barW / 2, -VILLAGER_RADIUS - 8, barW * pct, barH)
				.fill(COLORS.hungerBar);

			if (bb.carried > 0) {
				bar.circle(0, -VILLAGER_RADIUS - 13, 2).fill(COLORS.carriedIndicator);
			}
		}
	});

// Threat follows mouse
ecs
	.addSystem('threat-follow-mouse')
	.inPhase('update')
	.setPriority(0)
	.addQuery('threats', { with: ['threat', 'localTransform'] })
	.withResources(['inputState'])
	.setProcess(({ queries, ecs: world, resources: { inputState: input } }) => {
		const pointer = input.pointer;
		for (const entity of queries.threats) {
			const lt = entity.components.localTransform;
			lt.x = pointer.position.x;
			lt.y = pointer.position.y;
			world.markChanged(entity.id, 'localTransform');
		}
	});

// ==================== Initialize & Spawn ====================

await ecs.initialize();

const rootContainer = ecs.getResource('rootContainer');

// Draw fog-of-war grid
for (let i = 0; i < EXPLORE_TOTAL; i++) {
	const col = i % EXPLORE_COLS;
	const row = Math.floor(i / EXPLORE_COLS);
	const gfx = new Graphics()
		.rect(1, 1, EXPLORE_CELL_SIZE - 2, EXPLORE_CELL_SIZE - 2)
		.fill({ color: COLORS.fogCell, alpha: 0.3 });
	gfx.position.set(col * EXPLORE_CELL_SIZE, row * EXPLORE_CELL_SIZE);
	rootContainer.addChild(gfx);
	fogCellGraphics.push(gfx);
}

// Spawn base (depot)
const baseGfx = new Graphics()
	.rect(-20, -20, 40, 40)
	.fill({ color: COLORS.base, alpha: 0.8 })
	.stroke({ color: COLORS.base, width: 2, alpha: 0.5 });
ecs.spawn({
	...createGraphicsComponents(baseGfx, { x: WORLD_W / 2, y: WORLD_H / 2 }),
	...layers.base(),
	base: true,
});

// Label
const baseLabel = new Graphics();
baseLabel.position.set(WORLD_W / 2, WORLD_H / 2 + 28);
rootContainer.addChild(baseLabel);

// Spawn resources
const resourcePositions: Vector2D[] = [
	{ x: 80, y: 80 }, { x: 180, y: 60 }, { x: 700, y: 100 },
	{ x: 650, y: 500 }, { x: 100, y: 480 }, { x: 350, y: 50 },
	{ x: 500, y: 530 }, { x: 720, y: 300 },
];

resourcePositions.forEach(function spawnResource(pos) {
	const gfx = new Graphics().rect(-10, -10, 20, 20).fill(COLORS.resource);
	ecs.spawn({
		...createGraphicsComponents(gfx, pos),
		...layers.resource(),
		resource: { supply: 5 },
	});
});

// Spawn food sources
const foodPositions: Vector2D[] = [
	{ x: 200, y: 300 }, { x: 600, y: 200 }, { x: 400, y: 500 },
];

foodPositions.forEach(function spawnFood(pos) {
	const gfx = createBeanGraphics(10, COLORS.food);
	ecs.spawn({
		...createGraphicsComponents(gfx, pos),
		...layers.food(),
		food: true,
	});
});

// Spawn threat (follows mouse)
const threatGfx = new Graphics()
	.circle(0, 0, THREAT_RADIUS)
	.fill({ color: COLORS.threat, alpha: 0.08 })
	.circle(0, 0, 6)
	.fill({ color: COLORS.threat, alpha: 0.6 });
ecs.spawn({
	...createGraphicsComponents(threatGfx, { x: -100, y: -100 }),
	...layers.threat(),
	...createCircleCollider(THREAT_RADIUS),
	threat: true,
});

// Spawn villagers
Array.from({ length: VILLAGER_COUNT }).forEach(function spawnVillager(_value, i) {
	const angle = (i / VILLAGER_COUNT) * Math.PI * 2;
	const spawnR = 80;
	const x = WORLD_W / 2 + Math.cos(angle) * spawnR;
	const y = WORLD_H / 2 + Math.sin(angle) * spawnR;

	const gfx = createBeanGraphics(VILLAGER_RADIUS, COLORS.idle);

	// Hunger bar (child of villager graphic so it moves with it)
	const hungerBar = new Graphics();
	gfx.addChild(hungerBar);

	// State indicator dot
	const stateIndicator = new Graphics().circle(0, 0, 3).fill(COLORS.idle);
	stateIndicator.position.set(0, VILLAGER_RADIUS + 5);
	gfx.addChild(stateIndicator);

	ecs.spawn({
		...createGraphicsComponents(gfx, { x, y }),
		...layers.villager(),
		...createCircleCollider(VILLAGER_RADIUS),
		...createDetector(THREAT_RADIUS + 20, ['threat']),
		...createMoveSpeed(VILLAGER_SPEED),
		...createBehaviorTree(villagerTree, {
			hunger: 60 + Math.random() * 40,
			visitedCells: new Uint8Array(EXPLORE_TOTAL),
		}),
		villager: true,
		hungerBar,
		stateIndicator,
	});
});
