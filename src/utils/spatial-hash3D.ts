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
}

export interface SpatialHashGrid3D {
	cellSize: number;
	invCellSize: number;
	cells: Map<number, number[]>;
	entries: Map<number, SpatialEntry3D>;
	/** Previous-frame entries held for in-place reuse during rebuild. Internal. */
	_entriesPrev: Map<number, SpatialEntry3D>;
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
		entries: new Map(),
		_entriesPrev: new Map(),
	};
}

/**
 * Prepare the grid for a rebuild.
 *
 * Swaps `entries` with `_entriesPrev` so `insertEntity3D` can reuse existing
 * `SpatialEntry3D` objects in place (steady-state rebuilds allocate zero
 * entries). Any stale entries left in `_entriesPrev` from the previous
 * rebuild are dropped here.
 *
 * Cell buckets are cleared in place — keys are retained so subsequent
 * inserts hit the existing array rather than allocating a fresh one.
 */
export function clearGrid3D(grid: SpatialHashGrid3D): void {
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
	const recycled = grid._entriesPrev.get(entityId);
	if (recycled) {
		grid._entriesPrev.delete(entityId);
		recycled.x = x;
		recycled.y = y;
		recycled.z = z;
		recycled.halfW = halfW;
		recycled.halfH = halfH;
		recycled.halfD = halfD;
		grid.entries.set(entityId, recycled);
	} else {
		grid.entries.set(entityId, { entityId, x, y, z, halfW, halfH, halfD });
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
		const entry = grid.entries.get(entityId);
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
