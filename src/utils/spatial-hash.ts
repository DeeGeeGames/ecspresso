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
	/** Rebuild generation when this entry was last inserted. Internal. */
	_aliveGen: number;
}

/**
 * A cell bucket — entries plus the alive-gen at which the bucket was last
 * filled. Buckets are reset lazily on the next insert in a new generation
 * (see `insertEntity`); queries skip buckets whose `_gen` is stale.
 *
 * Internal — exposed only through `SpatialHashGrid.cells`.
 */
interface CellBucket extends Array<SpatialEntry> {
	_gen: number;
}

export interface SpatialHashGrid {
	cellSize: number;
	invCellSize: number;
	cells: Map<number, CellBucket>;
	/**
	 * Dense, indexed by entityId. Holes are `undefined`. Entries from previous
	 * rebuilds remain in place for in-place reuse (zero allocation in steady
	 * state); liveness is determined by `entry._aliveGen === grid._aliveGen`.
	 * Internal — read live entries via `getEntry` / `liveEntryCount` helpers.
	 *
	 * High-water-mark grows with max entityId ever inserted; despawned ids
	 * leave their slot occupied by a stale entry. Acceptable when the entity
	 * manager recycles ids or peak count is bounded.
	 */
	entries: (SpatialEntry | undefined)[];
	/** Monotonic counter bumped by each `clearGrid` call. Internal. */
	_aliveGen: number;
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
		entries: [],
		_aliveGen: 0,
		_queryGen: 0,
	};
}

/**
 * Prepare the grid for a rebuild.
 *
 * O(1): bumps the alive-generation counter so entries inserted prior to this
 * call are implicitly stale. `getLiveEntry` / `liveEntryCount` filter
 * entries by the current gen; queries skip buckets whose own `_gen` lags
 * behind the alive gen; `insertEntity` resets a bucket's `length` lazily
 * the first time it is touched in a new generation.
 *
 * Existing `SpatialEntry` objects and `CellBucket` arrays remain in place
 * for reuse, so steady-state rebuilds allocate zero entries and zero
 * buckets, regardless of how many cells have ever been touched.
 */
export function clearGrid(grid: SpatialHashGrid): void {
	grid._aliveGen++;
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
	const gen = grid._aliveGen;
	const existing = grid.entries[entityId];
	let entry: SpatialEntry;
	if (existing) {
		existing.x = x;
		existing.y = y;
		existing.halfW = halfW;
		existing.halfH = halfH;
		existing._aliveGen = gen;
		entry = existing;
	} else {
		entry = { entityId, x, y, halfW, halfH, _lastSeenGen: 0, _aliveGen: gen };
		grid.entries[entityId] = entry;
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
			if (bucket && bucket._gen === gen) {
				// Hot path: bucket already populated this generation.
				bucket.push(entry);
			} else if (bucket) {
				// First touch in this generation — drop stale entries from prior rebuilds.
				bucket.length = 0;
				bucket._gen = gen;
				bucket.push(entry);
			} else {
				const fresh = [entry] as CellBucket;
				fresh._gen = gen;
				grid.cells.set(key, fresh);
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
	const aliveGen = grid._aliveGen;

	for (let cx = minCX; cx <= maxCX; cx++) {
		for (let cy = minCY; cy <= maxCY; cy++) {
			const bucket = grid.cells.get(hashCell(cx, cy));
			if (!bucket || bucket._gen !== aliveGen) continue;
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
	const aliveGen = grid._aliveGen;

	for (let icx = minCX; icx <= maxCX; icx++) {
		for (let icy = minCY; icy <= maxCY; icy++) {
			const bucket = grid.cells.get(hashCell(icx, icy));
			if (!bucket || bucket._gen !== aliveGen) continue;
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

/**
 * Get the current-generation entry for an entityId, or `undefined` if the
 * entity isn't in the index for this rebuild. Stale entries from previous
 * rebuilds remain in `entries` for in-place reuse but are filtered here.
 */
export function getLiveEntry(grid: SpatialHashGrid, entityId: number): SpatialEntry | undefined {
	const entry = grid.entries[entityId];
	if (!entry || entry._aliveGen !== grid._aliveGen) return undefined;
	return entry;
}

/**
 * Count entries inserted in the current rebuild generation. Linear scan —
 * intended for tests and diagnostics, not hot paths.
 */
export function liveEntryCount(grid: SpatialHashGrid): number {
	const gen = grid._aliveGen;
	let n = 0;
	for (const entry of grid.entries) {
		if (entry && entry._aliveGen === gen) n++;
	}
	return n;
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
