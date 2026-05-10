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
}

export interface SpatialHashGrid {
	cellSize: number;
	invCellSize: number;
	cells: Map<number, number[]>;
	entries: Map<number, SpatialEntry>;
	/** Previous-frame entries held for in-place reuse during rebuild. Internal. */
	_entriesPrev: Map<number, SpatialEntry>;
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
	if (recycled) {
		grid._entriesPrev.delete(entityId);
		recycled.x = x;
		recycled.y = y;
		recycled.halfW = halfW;
		recycled.halfH = halfH;
		grid.entries.set(entityId, recycled);
	} else {
		grid.entries.set(entityId, { entityId, x, y, halfW, halfH });
	}

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
				bucket.push(entityId);
			} else {
				grid.cells.set(key, [entityId]);
			}
		}
	}
}

/**
 * Collect entity IDs from all cells overlapping the given rectangle.
 *
 * When `minId` is provided, only entries with `entityId > minId` are added.
 * This is used by symmetric broadphase pair generation to avoid emitting
 * (a, b) pairs where `b.id <= a.id`, removing the need for a post-hoc filter
 * and halving Set churn in dense scenes.
 */
export function gridQueryRect(
	grid: SpatialHashGrid,
	minX: number,
	minY: number,
	maxX: number,
	maxY: number,
	result: Set<number>,
	minId: number = -1,
): void {
	const inv = grid.invCellSize;
	const minCX = Math.floor(minX * inv);
	const maxCX = Math.floor(maxX * inv);
	const minCY = Math.floor(minY * inv);
	const maxCY = Math.floor(maxY * inv);

	for (let cx = minCX; cx <= maxCX; cx++) {
		for (let cy = minCY; cy <= maxCY; cy++) {
			const bucket = grid.cells.get(hashCell(cx, cy));
			if (!bucket) continue;
			for (let i = 0; i < bucket.length; i++) {
				const entry = bucket[i];
				if (entry !== undefined && entry > minId) result.add(entry);
			}
		}
	}
}

// Module-scoped reusable set to reduce GC pressure
const _radiusCandidates = new Set<number>();

/**
 * Collect entity IDs within a circle. Uses rect broadphase then
 * AABB-to-point distance filter.
 */
export function gridQueryRadius(
	grid: SpatialHashGrid,
	cx: number,
	cy: number,
	radius: number,
	result: Set<number>,
): void {
	// Broadphase: rect query for bounding box of circle
	const candidates = _radiusCandidates;
	candidates.clear();
	gridQueryRect(grid, cx - radius, cy - radius, cx + radius, cy + radius, candidates);

	const rSq = radius * radius;

	for (const entityId of candidates) {
		const entry = grid.entries.get(entityId);
		if (!entry) continue;

		// Closest point on entity AABB to query center
		const closestX = Math.max(entry.x - entry.halfW, Math.min(cx, entry.x + entry.halfW));
		const closestY = Math.max(entry.y - entry.halfH, Math.min(cy, entry.y + entry.halfH));
		const dx = cx - closestX;
		const dy = cy - closestY;

		if (dx * dx + dy * dy <= rSq) {
			result.add(entityId);
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
	queryRectInto(minX: number, minY: number, maxX: number, maxY: number, result: Set<number>, minId?: number): void;
	queryRadius(cx: number, cy: number, radius: number): number[];
	queryRadiusInto(cx: number, cy: number, radius: number, result: Set<number>): void;
	getEntry(entityId: number): SpatialEntry | undefined;
}
