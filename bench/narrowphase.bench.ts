/**
 * Narrowphase micro-benchmark
 *
 * Directly measures the collision detection hot path in isolation from the
 * rest of the ECS. Builds a synthetic list of circle colliders, runs
 * `detectCollisions` many times, and reports throughput + heap delta for:
 *   - brute-force (no spatial index) — O(N²)
 *   - broadphase  (with spatial index) — O(N·d)
 *
 * This is the bench to use when evaluating fixes to:
 *   - tasks.local/performance/collider-info-pooling.md
 *   - tasks.local/performance/broadphase-map-reuse.md
 *   - tasks.local/performance/contact-allocation.md
 *
 * Usage:
 *   bun bench/narrowphase.bench.ts
 *   bun bench/narrowphase.bench.ts --counts=500,1000,2000 --iters=200
 */

import {
	fillBaseColliderInfo,
	detectCollisions,
	createBroadphaseScratch,
	AABB_SHAPE,
	CIRCLE_SHAPE,
	type BaseColliderInfo,
	type Contact,
} from '../src/utils/narrowphase';
import {
	createGrid,
	clearGrid,
	insertEntity,
	gridQueryRect,
	type SpatialHashGrid,
} from '../src/utils/spatial-hash';
import type { SpatialIndex } from '../src/utils/spatial-hash';

// -- CLI --

type Args = { counts: number[]; iters: number; worldSize: number; radius: number; cellSize: number };

function parseArgs(argv: string[]): Args {
	const defaults: Args = {
		counts: [250, 500, 1000, 2000],
		iters: 200,
		worldSize: 800,
		radius: 10,
		cellSize: 32,
	};
	const parsed: Args = { ...defaults };
	for (const arg of argv.slice(2)) {
		const [key, value] = arg.replace(/^--/, '').split('=');
		if (!key || value === undefined) continue;
		if (key === 'counts') parsed.counts = value.split(',').map(Number);
		else if (key === 'iters') parsed.iters = Number(value);
		else if (key === 'worldSize') parsed.worldSize = Number(value);
		else if (key === 'radius') parsed.radius = Number(value);
		else if (key === 'cellSize') parsed.cellSize = Number(value);
	}
	return parsed;
}

// -- Synthetic collider construction --

function buildColliders(count: number, worldSize: number, radius: number): BaseColliderInfo<'ball'>[] {
	const colliders: BaseColliderInfo<'ball'>[] = [];
	const rng = mulberry32(0xc0ffee); // deterministic
	for (let i = 0; i < count; i++) {
		const x = rng() * worldSize;
		const y = rng() * worldSize;
		const info: BaseColliderInfo<'ball'> = {
			entityId: i, x, y, layer: 'ball', collidesWith: ['ball'],
			layerBit: 0, collidesWithMask: 0,
			shape: AABB_SHAPE, halfWidth: 0, halfHeight: 0, radius: 0,
		};
		if (fillBaseColliderInfo(info, i, x, y, 'ball', ['ball'], undefined, { radius })) {
			colliders.push(info);
		}
	}
	return colliders;
}

function mulberry32(seed: number): () => number {
	let s = seed >>> 0;
	return function(): number {
		s = (s + 0x6D2B79F5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return (((t ^ (t >>> 14)) >>> 0) / 4294967296);
	};
}

// -- Spatial index construction --

function buildSpatialIndex(cellSize: number): { grid: SpatialHashGrid; index: SpatialIndex } {
	const grid = createGrid(cellSize);
	const index: SpatialIndex = {
		grid,
		queryRect(minX, minY, maxX, maxY) {
			const out: number[] = [];
			gridQueryRect(grid, minX, minY, maxX, maxY, out);
			return out;
		},
		queryRectInto(minX, minY, maxX, maxY, result, minId) {
			gridQueryRect(grid, minX, minY, maxX, maxY, result, minId);
		},
		queryRadius() { return []; },
		queryRadiusInto() {},
		getEntry(id) { return grid.entries.get(id); },
	};
	return { grid, index };
}

function populateGrid(grid: SpatialHashGrid, colliders: BaseColliderInfo<'ball'>[]): void {
	clearGrid(grid);
	for (const c of colliders) {
		const r = c.shape === CIRCLE_SHAPE ? c.radius : c.halfWidth;
		insertEntity(grid, c.entityId, c.x, c.y, r, r);
	}
}

// -- Measurement --

interface RunResult {
	totalMs: number;
	perIterMs: number;
	pairHits: number;
	heapDeltaMB: number;
}

function measure(
	colliders: BaseColliderInfo<'ball'>[],
	spatialIndex: SpatialIndex | undefined,
	iters: number,
): RunResult {
	let pairHits = 0;
	const onContact = (_a: BaseColliderInfo<'ball'>, _b: BaseColliderInfo<'ball'>, _c: Contact) => { pairHits++; };
	const scratch = createBroadphaseScratch<BaseColliderInfo<'ball'>>();

	// Warmup — let the JIT settle
	for (let i = 0; i < 10; i++) {
		detectCollisions(colliders, colliders.length, scratch, spatialIndex, onContact, null);
	}
	pairHits = 0;

	Bun.gc(true);
	const heapBefore = process.memoryUsage().heapUsed;
	const t0 = Bun.nanoseconds();

	for (let i = 0; i < iters; i++) {
		detectCollisions(colliders, colliders.length, scratch, spatialIndex, onContact, null);
	}

	const t1 = Bun.nanoseconds();
	const heapAfter = process.memoryUsage().heapUsed;

	const totalMs = (t1 - t0) / 1e6;
	return {
		totalMs,
		perIterMs: totalMs / iters,
		pairHits: Math.round(pairHits / iters),
		heapDeltaMB: (heapAfter - heapBefore) / (1024 * 1024),
	};
}

// -- Main --

function main() {
	const args = parseArgs(process.argv);

	console.log('Narrowphase micro-benchmark');
	console.log(`  iters=${args.iters}  worldSize=${args.worldSize}  radius=${args.radius}  cellSize=${args.cellSize}`);
	console.log();

	const header = ['N', 'mode', 'ms/iter', 'iters/s', 'pairs/iter', 'heapΔ MB'];
	const widths = [6, 12, 10, 12, 12, 10];
	printRow(header, widths);
	printRow(widths.map(w => '-'.repeat(w)), widths);

	for (const count of args.counts) {
		const colliders = buildColliders(count, args.worldSize, args.radius);
		const { grid, index } = buildSpatialIndex(args.cellSize);
		populateGrid(grid, colliders);

		const brute = measure(colliders, undefined, args.iters);
		const broad = measure(colliders, index, args.iters);

		printRow([
			String(count),
			'brute',
			brute.perIterMs.toFixed(3),
			Math.round(1000 / brute.perIterMs).toString(),
			String(brute.pairHits),
			brute.heapDeltaMB.toFixed(2),
		], widths);

		printRow([
			String(count),
			'broadphase',
			broad.perIterMs.toFixed(3),
			Math.round(1000 / broad.perIterMs).toString(),
			String(broad.pairHits),
			broad.heapDeltaMB.toFixed(2),
		], widths);

		const speedup = brute.perIterMs / broad.perIterMs;
		console.log(`  → broadphase is ${speedup.toFixed(1)}× faster at N=${count}`);
		console.log();
	}
}

function printRow(cells: string[], widths: number[]): void {
	const row = cells.map((c, i) => c.padStart(widths[i] ?? 8)).join('  ');
	console.log('  ' + row);
}

main();
