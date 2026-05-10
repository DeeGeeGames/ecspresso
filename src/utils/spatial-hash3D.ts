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
	/** Rebuild generation when this entry was last inserted. Internal. */
	_aliveGen: number;
}

export interface SpatialHashGrid3D {
	cellSize: number;
	invCellSize: number;
	cells: Map<number, number[]>;
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
	if (existing) {
		existing.x = x;
		existing.y = y;
		existing.z = z;
		existing.halfW = halfW;
		existing.halfH = halfH;
		existing.halfD = halfD;
		existing._aliveGen = gen;
	} else {
		grid.entries[entityId] = { entityId, x, y, z, halfW, halfH, halfD, _aliveGen: gen };
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
					bucket.push(entityId);
				} else {
					grid.cells.set(key, [entityId]);
				}
			}
		}
	}
}

/**
 * Collect entity IDs from all cells overlapping the given 3D box.
 *
 * When `minId` is provided, only entries with `entityId > minId` are added.
 * This is used by symmetric broadphase pair generation to avoid emitting
 * (a, b) pairs where `b.id <= a.id`, removing the need for a post-hoc filter
 * and halving Set churn in dense scenes.
 */
export function gridQueryBox3D(
	grid: SpatialHashGrid3D,
	minX: number,
	minY: number,
	minZ: number,
	maxX: number,
	maxY: number,
	maxZ: number,
	result: Set<number>,
	minId: number = -1,
): void {
	const inv = grid.invCellSize;
	const minCX = Math.floor(minX * inv);
	const maxCX = Math.floor(maxX * inv);
	const minCY = Math.floor(minY * inv);
	const maxCY = Math.floor(maxY * inv);
	const minCZ = Math.floor(minZ * inv);
	const maxCZ = Math.floor(maxZ * inv);

	for (let cx = minCX; cx <= maxCX; cx++) {
		for (let cy = minCY; cy <= maxCY; cy++) {
			for (let cz = minCZ; cz <= maxCZ; cz++) {
				const bucket = grid.cells.get(hashCell3D(cx, cy, cz));
				if (!bucket) continue;
				for (const id of bucket) {
					if (id > minId) result.add(id);
				}
			}
		}
	}
}

// Module-scoped reusable set to reduce GC pressure
const _radiusCandidates3D = new Set<number>();

/**
 * Collect entity IDs within a sphere. Uses box broadphase then
 * 3D AABB-to-point distance filter.
 */
export function gridQueryRadius3D(
	grid: SpatialHashGrid3D,
	cx: number,
	cy: number,
	cz: number,
	radius: number,
	result: Set<number>,
): void {
	const candidates = _radiusCandidates3D;
	candidates.clear();
	gridQueryBox3D(
		grid,
		cx - radius, cy - radius, cz - radius,
		cx + radius, cy + radius, cz + radius,
		candidates,
	);

	const rSq = radius * radius;

	for (const entityId of candidates) {
		const entry = grid.entries[entityId];
		if (!entry) continue;

		// Closest point on entity AABB to query center
		const closestX = Math.max(entry.x - entry.halfW, Math.min(cx, entry.x + entry.halfW));
		const closestY = Math.max(entry.y - entry.halfH, Math.min(cy, entry.y + entry.halfH));
		const closestZ = Math.max(entry.z - entry.halfD, Math.min(cz, entry.z + entry.halfD));
		const dx = cx - closestX;
		const dy = cy - closestY;
		const dz = cz - closestZ;

		if (dx * dx + dy * dy + dz * dz <= rSq) {
			result.add(entityId);
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
	queryBoxInto(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, result: Set<number>, minId?: number): void;
	queryRadius(cx: number, cy: number, cz: number, radius: number): number[];
	queryRadiusInto(cx: number, cy: number, cz: number, radius: number, result: Set<number>): void;
	getEntry(entityId: number): SpatialEntry3D | undefined;
}
