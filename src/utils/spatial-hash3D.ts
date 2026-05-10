/**
 * Spatial Hash Grid 3D
 *
 * Uniform-grid spatial hash for broadphase collision detection and
 * proximity queries in 3D. Pure data structure, no ECS dependencies.
 */

// ==================== Data Structures ====================

export interface SpatialEntry3D {
	entityId: number;
	x: number;
	y: number;
	z: number;
	halfW: number;
	halfH: number;
	halfD: number;
	/** Generation stamp used by query functions to dedup multi-cell hits without a Set. Internal. */
	_lastSeenGen: number;
	/** Rebuild generation when this entry was last inserted. Internal. */
	_aliveGen: number;
}

export interface SpatialHashGrid3D {
	cellSize: number;
	invCellSize: number;
	cells: Map<number, SpatialEntry3D[]>;
	/**
	 * Dense, indexed by entityId. Holes are `undefined`. Entries from previous
	 * rebuilds remain in place for in-place reuse (zero allocation in steady
	 * state); liveness is determined by `entry._aliveGen === grid._aliveGen`.
	 * Internal — read live entries via `getLiveEntry3D` / `liveEntryCount3D` helpers.
	 *
	 * High-water-mark grows with max entityId ever inserted; despawned ids
	 * leave their slot occupied by a stale entry. Acceptable when the entity
	 * manager recycles ids or peak count is bounded.
	 */
	entries: (SpatialEntry3D | undefined)[];
	/** Monotonic counter bumped by each `clearGrid3D` call. Internal. */
	_aliveGen: number;
	/** Monotonic counter bumped on each query; entries record their last-seen gen for O(1) dedup. Internal. */
	_queryGen: number;
}

// ==================== Pure Functions ====================

/**
 * Hash a cell coordinate triple to a single integer key.
 * Uses large-prime XOR to distribute values.
 */
export function hashCell3D(cx: number, cy: number, cz: number): number {
	// Large primes for spatial hashing distribution
	return (cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791);
}

/**
 * Create a new empty 3D spatial hash grid.
 */
export function createGrid3D(cellSize: number): SpatialHashGrid3D {
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
 * Bumps the alive-generation counter so entries inserted prior to this call
 * are implicitly stale (any access via `getLiveEntry3D` / `liveEntryCount3D`
 * filters by the current gen). Existing `SpatialEntry3D` objects remain in
 * the `entries` array for in-place reuse by the next `insertEntity3D`, so
 * steady-state rebuilds allocate zero entries.
 *
 * Cell buckets are cleared in place — keys are retained so subsequent
 * inserts hit the existing array rather than allocating a fresh one.
 */
export function clearGrid3D(grid: SpatialHashGrid3D): void {
	grid._aliveGen++;

	for (const bucket of grid.cells.values()) {
		bucket.length = 0;
	}
}

/**
 * Insert an entity into all overlapping cells of the grid.
 */
export function insertEntity3D(
	grid: SpatialHashGrid3D,
	entityId: number,
	x: number,
	y: number,
	z: number,
	halfW: number,
	halfH: number,
	halfD: number,
): void {
	const gen = grid._aliveGen;
	const existing = grid.entries[entityId];
	let entry: SpatialEntry3D;
	if (existing) {
		existing.x = x;
		existing.y = y;
		existing.z = z;
		existing.halfW = halfW;
		existing.halfH = halfH;
		existing.halfD = halfD;
		existing._lastSeenGen = 0;
		existing._aliveGen = gen;
		entry = existing;
	} else {
		entry = { entityId, x, y, z, halfW, halfH, halfD, _lastSeenGen: 0, _aliveGen: gen };
		grid.entries[entityId] = entry;
	}

	const inv = grid.invCellSize;
	const minCX = Math.floor((x - halfW) * inv);
	const maxCX = Math.floor((x + halfW) * inv);
	const minCY = Math.floor((y - halfH) * inv);
	const maxCY = Math.floor((y + halfH) * inv);
	const minCZ = Math.floor((z - halfD) * inv);
	const maxCZ = Math.floor((z + halfD) * inv);

	for (let cx = minCX; cx <= maxCX; cx++) {
		for (let cy = minCY; cy <= maxCY; cy++) {
			for (let cz = minCZ; cz <= maxCZ; cz++) {
				const key = hashCell3D(cx, cy, cz);
				const bucket = grid.cells.get(key);
				if (bucket) {
					bucket.push(entry);
				} else {
					grid.cells.set(key, [entry]);
				}
			}
		}
	}
}

/**
 * Collect entity IDs from all cells overlapping the given 3D box.
 *
 * Appends to `result` (caller clears/truncates first if reusing). Multi-cell
 * entries are deduplicated via a per-grid generation stamp on each
 * `SpatialEntry3D`.
 *
 * When `minId` is provided, only entries with `entityId > minId` are added —
 * used for symmetric broadphase pair generation.
 */
export function gridQueryBox3D(
	grid: SpatialHashGrid3D,
	minX: number,
	minY: number,
	minZ: number,
	maxX: number,
	maxY: number,
	maxZ: number,
	result: number[],
	minId: number = -1,
): void {
	const inv = grid.invCellSize;
	const minCX = Math.floor(minX * inv);
	const maxCX = Math.floor(maxX * inv);
	const minCY = Math.floor(minY * inv);
	const maxCY = Math.floor(maxY * inv);
	const minCZ = Math.floor(minZ * inv);
	const maxCZ = Math.floor(maxZ * inv);

	const gen = ++grid._queryGen;

	for (let cx = minCX; cx <= maxCX; cx++) {
		for (let cy = minCY; cy <= maxCY; cy++) {
			for (let cz = minCZ; cz <= maxCZ; cz++) {
				const bucket = grid.cells.get(hashCell3D(cx, cy, cz));
				if (!bucket) continue;
				for (const entry of bucket) {
					if (entry.entityId <= minId || entry._lastSeenGen === gen) continue;
					entry._lastSeenGen = gen;
					result.push(entry.entityId);
				}
			}
		}
	}
}

/**
 * Collect entity IDs within a sphere. AABB-to-point distance filter against
 * the cells overlapping the sphere's bounding box. Appends to `result`.
 */
export function gridQueryRadius3D(
	grid: SpatialHashGrid3D,
	cx: number,
	cy: number,
	cz: number,
	radius: number,
	result: number[],
): void {
	const rSq = radius * radius;
	const inv = grid.invCellSize;
	const minCX = Math.floor((cx - radius) * inv);
	const maxCX = Math.floor((cx + radius) * inv);
	const minCY = Math.floor((cy - radius) * inv);
	const maxCY = Math.floor((cy + radius) * inv);
	const minCZ = Math.floor((cz - radius) * inv);
	const maxCZ = Math.floor((cz + radius) * inv);

	const gen = ++grid._queryGen;

	for (let icx = minCX; icx <= maxCX; icx++) {
		for (let icy = minCY; icy <= maxCY; icy++) {
			for (let icz = minCZ; icz <= maxCZ; icz++) {
				const bucket = grid.cells.get(hashCell3D(icx, icy, icz));
				if (!bucket) continue;
				for (const entry of bucket) {
					if (entry._lastSeenGen === gen) continue;
					entry._lastSeenGen = gen;

					const closestX = Math.max(entry.x - entry.halfW, Math.min(cx, entry.x + entry.halfW));
					const closestY = Math.max(entry.y - entry.halfH, Math.min(cy, entry.y + entry.halfH));
					const closestZ = Math.max(entry.z - entry.halfD, Math.min(cz, entry.z + entry.halfD));
					const dx = cx - closestX;
					const dy = cy - closestY;
					const dz = cz - closestZ;

					if (dx * dx + dy * dy + dz * dz <= rSq) {
						result.push(entry.entityId);
					}
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
export function getLiveEntry3D(grid: SpatialHashGrid3D, entityId: number): SpatialEntry3D | undefined {
	const entry = grid.entries[entityId];
	if (!entry || entry._aliveGen !== grid._aliveGen) return undefined;
	return entry;
}

/**
 * Count entries inserted in the current rebuild generation. Linear scan —
 * intended for tests and diagnostics, not hot paths.
 */
export function liveEntryCount3D(grid: SpatialHashGrid3D): number {
	const gen = grid._aliveGen;
	let n = 0;
	for (const entry of grid.entries) {
		if (entry && entry._aliveGen === gen) n++;
	}
	return n;
}

// ==================== SpatialIndex3D Interface ====================

/**
 * High-level spatial index API for 3D broadphase queries.
 *
 * Defined here (the utility layer) so that narrowphase3D can accept it
 * without importing the ECS plugin. The spatial-index3D plugin creates
 * an object that implements this interface and registers it as a resource.
 */
export interface SpatialIndex3D {
	readonly grid: SpatialHashGrid3D;
	queryBox(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): number[];
	queryBoxInto(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, result: number[], minId?: number): void;
	queryRadius(cx: number, cy: number, cz: number, radius: number): number[];
	queryRadiusInto(cx: number, cy: number, cz: number, radius: number, result: number[]): void;
	getEntry(entityId: number): SpatialEntry3D | undefined;
}
