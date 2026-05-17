/**
 * Pathfinding Plugin for ECSpresso
 *
 * A* pathfinding on a weighted grid. Produces waypoint lists consumed by the
 * steering plugin — the pathfinding system writes the `path` component and
 * sets `moveTarget` to the first waypoint; the waypoint advancement handler
 * listens for `arriveAtTarget` and advances to the next waypoint.
 *
 * Exports the pure `findPath(grid, start, goal, options?)` function for
 * turn-based / non-realtime consumers that don't need the component dance.
 */

import { definePlugin, type BasePluginOptions } from 'ecspresso';
import type { WorldConfigFrom } from 'ecspresso';
import type { Vector2D } from '../../utils/math';
import type { TransformWorldConfig } from '../spatial/transform';
import type { SteeringWorldConfig } from '../physics/steering';

// ==================== Topology / Grid Types ====================

/** Flat-indexed cell position in a `NavGrid`. Transparent alias, not branded. */
export type CellIndex = number;

/**
 * Grid topology. v1 ships `square4`; other values are accepted at construction
 * but throw at `findPath` time.
 */
export type NavGridTopology = 'square4' | 'square8' | 'hex-pointy' | 'hex-flat';

/**
 * Weighted navigation grid. Row-major storage (`idx = row * width + col`).
 * Cell value `0` = impassable, `1`–`255` = traversal cost into that cell.
 */
export interface NavGrid {
	readonly topology: NavGridTopology;
	readonly width: number;
	readonly height: number;
	readonly cellSize: number;
	readonly originX: number;
	readonly originY: number;
	readonly cells: Uint8Array;
	worldToCell(wx: number, wy: number): CellIndex;
	cellToWorld(idx: CellIndex): Vector2D;
	cellFromXY(x: number, y: number): CellIndex;
	cellToXY(idx: CellIndex): { x: number; y: number };
}

/** Options accepted by `createNavGrid`. */
export interface CreateNavGridOptions {
	topology?: NavGridTopology;
	width: number;
	height: number;
	cellSize?: number;
	originX?: number;
	originY?: number;
	cells?: Uint8Array;
	defaultCost?: number;
}

// ==================== Component Types ====================

/** Signals the pathfinding system to compute a route to `target`. */
export interface PathRequest {
	target: Vector2D;
}

/** Active route; waypoints are in world-space, advanced by `currentIndex`. */
export interface Path {
	waypoints: Vector2D[];
	currentIndex: number;
}

/** Component types provided by the pathfinding plugin. */
export interface PathfindingComponentTypes {
	pathRequest: PathRequest;
	path: Path;
}

// ==================== Event Types ====================

/** Fired when A* produces a route. `path` is empty when start is already at the goal. */
export interface PathFoundEvent {
	entityId: number;
	path: Vector2D[];
}

/** Fired when no path exists to the target. */
export interface PathBlockedEvent {
	entityId: number;
}

/** Event types provided by the pathfinding plugin. */
export interface PathfindingEventTypes {
	pathFound: PathFoundEvent;
	pathBlocked: PathBlockedEvent;
}

// ==================== Resource Types ====================

/** Resource types provided by the pathfinding plugin. */
export interface PathfindingResourceTypes {
	navGrid: NavGrid;
}

// ==================== WorldConfig ====================

/** WorldConfig representing the pathfinding plugin's provided types. */
export type PathfindingWorldConfig = WorldConfigFrom<
	PathfindingComponentTypes,
	PathfindingEventTypes,
	PathfindingResourceTypes
>;

// ==================== Plugin Options ====================

export interface PathfindingPluginOptions<G extends string = 'ai'> extends BasePluginOptions<G> {
	/** The navigation grid. Construct via `createNavGrid`. */
	grid: NavGrid;
	/** Max path requests processed per frame (default 4). */
	maxRequestsPerFrame?: number;
	/** Default `maxNodesExpanded` passed to A* per request (default 10_000). */
	maxNodesExpanded?: number;
}

// ==================== NavGrid Construction ====================

interface TopologyOps {
	neighbors(grid: NavGrid, idx: CellIndex, out: number[]): number;
	stepCost(grid: NavGrid, from: CellIndex, to: CellIndex): number;
	heuristic(grid: NavGrid, a: CellIndex, b: CellIndex): number;
}

const square4Ops: TopologyOps = {
	neighbors(grid, idx, out) {
		const col = idx % grid.width;
		const row = (idx - col) / grid.width;
		let count = 0;
		if (col > 0) out[count++] = idx - 1;
		if (col < grid.width - 1) out[count++] = idx + 1;
		if (row > 0) out[count++] = idx - grid.width;
		if (row < grid.height - 1) out[count++] = idx + grid.width;
		return count;
	},
	stepCost(grid, _from, to) {
		return grid.cells[to] ?? 0;
	},
	heuristic(grid, a, b) {
		const ax = a % grid.width;
		const ay = (a - ax) / grid.width;
		const bx = b % grid.width;
		const by = (b - bx) / grid.width;
		return Math.abs(ax - bx) + Math.abs(ay - by);
	},
};

const unimplementedOps = (topology: NavGridTopology): TopologyOps => {
	const err = (): never => {
		throw new Error(`pathfinding: topology '${topology}' is not implemented in v1`);
	};
	return {
		neighbors: err,
		stepCost: err,
		heuristic: err,
	};
};

const topologyOps: Readonly<Record<NavGridTopology, TopologyOps>> = Object.freeze({
	'square4': square4Ops,
	'square8': unimplementedOps('square8'),
	'hex-pointy': unimplementedOps('hex-pointy'),
	'hex-flat': unimplementedOps('hex-flat'),
});

/**
 * Create a weighted navigation grid.
 *
 * @example
 * ```typescript
 * const grid = createNavGrid({ width: 32, height: 32, cellSize: 16 });
 * grid.cells[grid.cellFromXY(5, 5)] = 0; // block a cell
 * ```
 */
export function createNavGrid(options: CreateNavGridOptions): NavGrid {
	const topology = options.topology ?? 'square4';
	const cellSize = options.cellSize ?? 32;
	const originX = options.originX ?? 0;
	const originY = options.originY ?? 0;
	const { width, height } = options;
	const defaultCost = options.defaultCost ?? 1;

	if (!Number.isInteger(width) || width <= 0) {
		throw new Error(`pathfinding: width must be a positive integer, got ${width}`);
	}
	if (!Number.isInteger(height) || height <= 0) {
		throw new Error(`pathfinding: height must be a positive integer, got ${height}`);
	}
	if (cellSize <= 0) {
		throw new Error(`pathfinding: cellSize must be > 0, got ${cellSize}`);
	}
	if (defaultCost < 0 || defaultCost > 255) {
		throw new Error(`pathfinding: defaultCost must be in 0–255, got ${defaultCost}`);
	}

	const expectedLen = width * height;
	const cells = options.cells ?? new Uint8Array(expectedLen).fill(defaultCost);
	if (cells.length !== expectedLen) {
		throw new Error(
			`pathfinding: cells length ${cells.length} does not match width*height ${expectedLen}`,
		);
	}

	const invCellSize = 1 / cellSize;

	const worldToCell = (wx: number, wy: number): CellIndex => {
		const col = Math.floor((wx - originX) * invCellSize);
		const row = Math.floor((wy - originY) * invCellSize);
		const cCol = col < 0 ? 0 : col >= width ? width - 1 : col;
		const cRow = row < 0 ? 0 : row >= height ? height - 1 : row;
		return cRow * width + cCol;
	};

	const cellToWorld = (idx: CellIndex): Vector2D => {
		const col = idx % width;
		const row = (idx - col) / width;
		return {
			x: originX + (col + 0.5) * cellSize,
			y: originY + (row + 0.5) * cellSize,
		};
	};

	const cellFromXY = (x: number, y: number): CellIndex => y * width + x;

	const cellToXY = (idx: CellIndex): { x: number; y: number } => {
		const x = idx % width;
		return { x, y: (idx - x) / width };
	};

	return {
		topology, width, height, cellSize, originX, originY, cells,
		worldToCell, cellToWorld, cellFromXY, cellToXY,
	};
}

// ==================== Helper Functions ====================

/**
 * Create a `pathRequest` component for spreading into `spawn()` / `addComponent()`.
 *
 * @example
 * ```typescript
 * ecs.spawn({
 *   ...createTransform(0, 0),
 *   ...createMoveSpeed(100),
 *   ...createPathRequest({ x: 200, y: 300 }),
 * });
 * ```
 */
export function createPathRequest(target: Vector2D): Pick<PathfindingComponentTypes, 'pathRequest'> {
	return { pathRequest: { target: { x: target.x, y: target.y } } };
}

// ==================== Pure A* API ====================

export interface FindPathOptions {
	/** Cap on A* node expansions; returns `null` if exceeded. Default 10_000. */
	maxNodesExpanded?: number;
	/** Dynamic per-call obstacles layered on top of the static grid. */
	blockedCells?: Set<CellIndex>;
	/** Accept arrival within N cells of goal (topology-aware distance). Default 0. */
	goalTolerance?: number;
}

interface PathHeap {
	ids: Int32Array;
	priorities: Float32Array;
	size: number;
}

// Why: parallel-typed-array heap keeps cells & priorities in cache without per-node allocations.
function heapPush(heap: PathHeap, id: number, priority: number): void {
	let i = heap.size;
	heap.size = i + 1;
	while (i > 0) {
		const parent = (i - 1) >> 1;
		if ((heap.priorities[parent] ?? 0) <= priority) break;
		heap.ids[i] = heap.ids[parent] ?? 0;
		heap.priorities[i] = heap.priorities[parent] ?? 0;
		i = parent;
	}
	heap.ids[i] = id;
	heap.priorities[i] = priority;
}

function heapPop(heap: PathHeap): number {
	const top = heap.ids[0] ?? -1;
	const last = heap.size - 1;
	heap.size = last;
	if (last <= 0) return top;
	const movedId = heap.ids[last] ?? 0;
	const movedPri = heap.priorities[last] ?? 0;
	let i = 0;
	const half = last >> 1;
	while (i < half) {
		let child = (i << 1) + 1;
		const right = child + 1;
		if (right < last && (heap.priorities[right] ?? 0) < (heap.priorities[child] ?? 0)) child = right;
		if ((heap.priorities[child] ?? 0) >= movedPri) break;
		heap.ids[i] = heap.ids[child] ?? 0;
		heap.priorities[i] = heap.priorities[child] ?? 0;
		i = child;
	}
	heap.ids[i] = movedId;
	heap.priorities[i] = movedPri;
	return top;
}

function reconstructPath(cameFrom: Int32Array, end: CellIndex): CellIndex[] {
	// Why: two-pass (count then fill) avoids unshift/reverse allocation.
	let count = 1;
	let cur = end;
	while ((cameFrom[cur] ?? -1) !== -1) {
		count++;
		cur = cameFrom[cur] ?? -1;
	}
	const path = new Array<CellIndex>(count);
	cur = end;
	for (let i = count - 1; i >= 0; i--) {
		path[i] = cur;
		if (i > 0) cur = cameFrom[cur] ?? -1;
	}
	return path;
}

/**
 * Compute a path through `grid` from `start` to `goal`.
 *
 * Returns a list of cell indices starting with `start` and ending at a cell
 * within `goalTolerance` of `goal`, or `null` if no such path exists within
 * `maxNodesExpanded` expansions.
 *
 * `start` is always treated as passable (even if its grid cell is 0 or the
 * cell is in `blockedCells`) — actors physics-pushed onto a wall still get a
 * valid origin.
 */
export function findPath(
	grid: NavGrid,
	start: CellIndex,
	goal: CellIndex,
	options?: FindPathOptions,
): CellIndex[] | null {
	const n = grid.cells.length;
	if (start < 0 || start >= n) return null;
	if (goal < 0 || goal >= n) return null;

	const maxNodesExpanded = options?.maxNodesExpanded ?? 10_000;
	const blockedCells = options?.blockedCells;
	const goalTolerance = options?.goalTolerance ?? 0;
	const ops = topologyOps[grid.topology];

	// Per-call allocations: ~n bytes × 5 (gScore, cameFrom, closed, heap ids, heap priorities).
	// For a 100×100 grid that's ~120 KB per search. Acceptable for v1 game-grid scales.
	// Deferred optimization: closure-scoped reusable pool keyed by `n`, reset per call.
	const gScore = new Float32Array(n);
	gScore.fill(Number.POSITIVE_INFINITY);
	const cameFrom = new Int32Array(n);
	cameFrom.fill(-1);
	const closed = new Uint8Array(n);
	const heap: PathHeap = {
		ids: new Int32Array(n),
		priorities: new Float32Array(n),
		size: 0,
	};
	const neighborBuf: number[] = [];

	gScore[start] = 0;
	heapPush(heap, start, ops.heuristic(grid, start, goal));

	let expanded = 0;
	while (heap.size > 0) {
		if (expanded >= maxNodesExpanded) return null;
		const current = heapPop(heap);
		if (closed[current]) continue;
		closed[current] = 1;
		expanded++;

		if (ops.heuristic(grid, current, goal) <= goalTolerance) {
			return reconstructPath(cameFrom, current);
		}

		neighborBuf.length = 0;
		const count = ops.neighbors(grid, current, neighborBuf);
		for (let k = 0; k < count; k++) {
			const next = neighborBuf[k] ?? -1;
			if (next < 0 || closed[next]) continue;
			const cellCost = grid.cells[next] ?? 0;
			if (cellCost === 0) continue;
			if (blockedCells && blockedCells.has(next)) continue;

			const tentative = (gScore[current] ?? Number.POSITIVE_INFINITY) + ops.stepCost(grid, current, next);
			if (tentative < (gScore[next] ?? Number.POSITIVE_INFINITY)) {
				gScore[next] = tentative;
				cameFrom[next] = current;
				heapPush(heap, next, tentative + ops.heuristic(grid, next, goal));
			}
		}
	}
	return null;
}

// ==================== Plugin Factory ====================

/**
 * Create a pathfinding plugin for ECSpresso.
 *
 * Requires the transform and steering plugins to be installed (entities need
 * `worldTransform` for start-cell detection and `moveTarget`/`moveSpeed` for
 * waypoint traversal).
 *
 * @example
 * ```typescript
 * const grid = createNavGrid({ width: 32, height: 32, cellSize: 16 });
 * const ecs = ECSpresso.create()
 *   .withPlugin(createTransformPlugin())
 *   .withPlugin(createSteeringPlugin())
 *   .withPlugin(createPathfindingPlugin({ grid }))
 *   .build();
 *
 * ecs.spawn({
 *   ...createTransform(0, 0),
 *   ...createMoveSpeed(100),
 *   ...createPathRequest({ x: 500, y: 300 }),
 * });
 * ```
 */
export function createPathfindingPlugin<G extends string = 'ai'>(
	options: PathfindingPluginOptions<G>,
) {
	const {
		grid,
		systemGroup = 'ai' as G,
		priority = 150,
		phase = 'update',
		maxRequestsPerFrame = 4,
		maxNodesExpanded = 10_000,
	} = options;

	return definePlugin('pathfinding')
		.withComponentTypes<PathfindingComponentTypes>()
		.withEventTypes<PathfindingEventTypes>()
		.withResourceTypes<PathfindingResourceTypes>()
		.withLabels<'pathfinding-request' | 'pathfinding-waypoint-advance'>()
		.withGroups<G>()
		.requires<TransformWorldConfig & SteeringWorldConfig>()
		.install((world) => {
			world.addResource('navGrid', grid);

			world
				.addSystem('pathfinding-request')
				.setPriority(priority)
				.inPhase(phase)
				.inGroup(systemGroup)
				.addQuery('requests', {
					with: ['pathRequest', 'worldTransform'],
				})
				.setProcess(({ queries, ecs }) => {
					const navGrid = ecs.getResource('navGrid');
					let processed = 0;
					for (const entity of queries.requests) {
						if (processed >= maxRequestsPerFrame) break;
						processed++;
						const { pathRequest, worldTransform } = entity.components;
						const startIdx = navGrid.worldToCell(worldTransform.x, worldTransform.y);
						const goalIdx = navGrid.worldToCell(pathRequest.target.x, pathRequest.target.y);
						const result = findPath(navGrid, startIdx, goalIdx, { maxNodesExpanded });
						ecs.commands.removeComponent(entity.id, 'pathRequest');

						if (result === null) {
							ecs.eventBus.publish('pathBlocked', { entityId: entity.id });
							continue;
						}

						const waypoints = result.slice(1).map(idx => navGrid.cellToWorld(idx));
						ecs.eventBus.publish('pathFound', { entityId: entity.id, path: waypoints });
						if (waypoints.length === 0) continue;

						const existingPath = ecs.getComponent(entity.id, 'path');
						if (existingPath) {
							existingPath.waypoints = waypoints;
							existingPath.currentIndex = 0;
							ecs.markChanged(entity.id, 'path');
						} else {
							ecs.addComponent(entity.id, 'path', { waypoints, currentIndex: 0 });
						}

						const first = waypoints[0];
						if (!first) continue;
						const existingMT = ecs.getComponent(entity.id, 'moveTarget');
						if (existingMT) {
							existingMT.x = first.x;
							existingMT.y = first.y;
							ecs.markChanged(entity.id, 'moveTarget');
						} else {
							ecs.addComponent(entity.id, 'moveTarget', { x: first.x, y: first.y });
						}
					}
				});

			world
				.addSystem('pathfinding-waypoint-advance')
				.inGroup(systemGroup)
				.setEventHandlers({
					arriveAtTarget({ data, ecs }) {
						const path = ecs.getComponent(data.entityId, 'path');
						if (!path) return;
						const next = path.currentIndex + 1;
						if (next >= path.waypoints.length) {
							ecs.commands.removeComponent(data.entityId, 'path');
							return;
						}
						path.currentIndex = next;
						ecs.markChanged(data.entityId, 'path');
						const wp = path.waypoints[next];
						if (!wp) return;
						// Why: use command buffer so the add is queued AFTER steering's
						// queued `removeComponent('moveTarget')` in the same phase.
						ecs.commands.addComponent(data.entityId, 'moveTarget', { x: wp.x, y: wp.y });
					},
				});
		});
}
