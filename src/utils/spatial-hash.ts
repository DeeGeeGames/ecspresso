/**
 * Spatial Hash Grid
 *
 * Uniform-grid spatial hash for broadphase collision detection and
 * proximity queries. Pure data structure, no ECS dependencies.
 */

// ==================== Data Structure ====================

export interface SpatialEntry {
	entityId: number;
	x: number;
	y: number;
	halfW: number;
	halfH: number;
	/** Generation stamp used by query functions to dedup multi-cell hits without a Set. Internal. */
	_lastSeenGen: number;
}

export interface SpatialHashGrid {
	cellSize: number;
	invCellSize: number;
	cells: Map<number, SpatialEntry[]>;
	entries: Map<number, SpatialEntry>;
	/** Previous-frame entries held for in-place reuse during rebuild. Internal. */
	_entriesPrev: Map<number, SpatialEntry>;
	/** Monotonic counter bumped on each query; entries record their last-seen gen for O(1) dedup. Internal. */
	_queryGen: number;
}

// ==================== Pure Functions ====================

/**
 * Hash a cell coordinate pair to a single integer key.
 * Uses large-prime XOR to distribute values.
 */
export function hashCell(cx: number, cy: number): number {
	// Large primes for spatial hashing distribution
	return (cx * 73856093) ^ (cy * 19349663);
}

/**
 * Create a new empty spatial hash grid.
 */
export function createGrid(cellSize: number): SpatialHashGrid {
	return {
		cellSize,
		invCellSize: 1 / cellSize,
		cells: new Map(),
		entries: new Map(),
		_entriesPrev: new Map(),
		_queryGen: 0,
	};
}

/**
 * Prepare the grid for a rebuild.
 *
 * Swaps `entries` with `_entriesPrev` so `insertEntity` can reuse existing
 * `SpatialEntry` objects in place (steady-state rebuilds allocate zero
 * entries). Any stale entries left in `_entriesPrev` from the previous
 * rebuild are dropped here.
 *
 * Cell buckets are cleared in place — keys are retained so subsequent
 * inserts hit the existing array rather than allocating a fresh one.
 */
export function clearGrid(grid: SpatialHashGrid): void {
	grid._entriesPrev.clear();
	const tmp = grid.entries;
	grid.entries = grid._entriesPrev;
	grid._entriesPrev = tmp;

	for (const bucket of grid.cells.values()) {
		bucket.length = 0;
	}
}

/**
 * Insert an entity into all overlapping cells of the grid.
 */
export function insertEntity(
	grid: SpatialHashGrid,
	entityId: number,
	x: number,
	y: number,
	halfW: number,
	halfH: number,
): void {
	const recycled = grid._entriesPrev.get(entityId);
	let entry: SpatialEntry;
	if (recycled) {
		grid._entriesPrev.delete(entityId);
		recycled.x = x;
		recycled.y = y;
		recycled.halfW = halfW;
		recycled.halfH = halfH;
		recycled._lastSeenGen = 0;
		entry = recycled;
	} else {
		entry = { entityId, x, y, halfW, halfH, _lastSeenGen: 0 };
	}
	grid.entries.set(entityId, entry);

	const inv = grid.invCellSize;
	const minCX = Math.floor((x - halfW) * inv);
	const maxCX = Math.floor((x + halfW) * inv);
	const minCY = Math.floor((y - halfH) * inv);
	const maxCY = Math.floor((y + halfH) * inv);

	for (let cx = minCX; cx <= maxCX; cx++) {
		for (let cy = minCY; cy <= maxCY; cy++) {
			const key = hashCell(cx, cy);
			const bucket = grid.cells.get(key);
			if (bucket) {
				bucket.push(entry);
			} else {
				grid.cells.set(key, [entry]);
			}
		}
	}
}

/**
 * Collect entity IDs from all cells overlapping the given rectangle.
 *
 * Appends to `result` (caller clears/truncates first if reusing). Multi-cell
 * entries are deduplicated via a per-grid generation stamp on each
 * `SpatialEntry`.
 *
 * When `minId` is provided, only entries with `entityId > minId` are added —
 * used for symmetric broadphase pair generation.
 */
export function gridQueryRect(
	grid: SpatialHashGrid,
	minX: number,
	minY: number,
	maxX: number,
	maxY: number,
	result: number[],
	minId: number = -1,
): void {
	const inv = grid.invCellSize;
	const minCX = Math.floor(minX * inv);
	const maxCX = Math.floor(maxX * inv);
	const minCY = Math.floor(minY * inv);
	const maxCY = Math.floor(maxY * inv);

	const gen = ++grid._queryGen;

	for (let cx = minCX; cx <= maxCX; cx++) {
		for (let cy = minCY; cy <= maxCY; cy++) {
			const bucket = grid.cells.get(hashCell(cx, cy));
			if (!bucket) continue;
			for (const entry of bucket) {
				if (entry.entityId <= minId || entry._lastSeenGen === gen) continue;
				entry._lastSeenGen = gen;
				result.push(entry.entityId);
			}
		}
	}
}

/**
 * Collect entity IDs within a circle. AABB-to-point distance filter against
 * the cells overlapping the circle's bounding rect. Appends to `result`.
 */
export function gridQueryRadius(
	grid: SpatialHashGrid,
	cx: number,
	cy: number,
	radius: number,
	result: number[],
): void {
	const rSq = radius * radius;
	const inv = grid.invCellSize;
	const minCX = Math.floor((cx - radius) * inv);
	const maxCX = Math.floor((cx + radius) * inv);
	const minCY = Math.floor((cy - radius) * inv);
	const maxCY = Math.floor((cy + radius) * inv);

	const gen = ++grid._queryGen;

	for (let icx = minCX; icx <= maxCX; icx++) {
		for (let icy = minCY; icy <= maxCY; icy++) {
			const bucket = grid.cells.get(hashCell(icx, icy));
			if (!bucket) continue;
			for (const entry of bucket) {
				if (entry._lastSeenGen === gen) continue;
				entry._lastSeenGen = gen;

				const closestX = Math.max(entry.x - entry.halfW, Math.min(cx, entry.x + entry.halfW));
				const closestY = Math.max(entry.y - entry.halfH, Math.min(cy, entry.y + entry.halfH));
				const dx = cx - closestX;
				const dy = cy - closestY;

				if (dx * dx + dy * dy <= rSq) {
					result.push(entry.entityId);
				}
			}
		}
	}
}

// ==================== Resource API ====================

// TODO: Move SpatialIndex interface to src/plugins/spatial/spatial-index.ts.
// It's a resource API concern, not a data structure concern. This file should
// only contain the grid primitives (SpatialEntry, SpatialHashGrid, and the
// pure functions that operate on them).
export interface SpatialIndex {
	readonly grid: SpatialHashGrid;
	queryRect(minX: number, minY: number, maxX: number, maxY: number): number[];
	queryRectInto(minX: number, minY: number, maxX: number, maxY: number, result: number[], minId?: number): void;
	queryRadius(cx: number, cy: number, radius: number): number[];
	queryRadiusInto(cx: number, cy: number, radius: number, result: number[]): void;
	getEntry(entityId: number): SpatialEntry | undefined;
}
