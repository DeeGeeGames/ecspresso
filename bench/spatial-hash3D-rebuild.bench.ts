/**
 * Spatial-hash 3D rebuild micro-benchmark
 *
 * Measures the per-frame 3D rebuild cycle in isolation:
 *   clearGrid3D() + N × insertEntity3D()
 */

import {
	createGrid3D,
	clearGrid3D,
	insertEntity3D,
} from '../src/utils/spatial-hash3D';
import { mulberry32, printRow } from './bench-utils';

type Args = { counts: number[]; iters: number; worldSize: number; radius: number; cellSize: number };

function parseArgs(argv: string[]): Args {
	const defaults: Args = {
		counts: [1000, 5000, 10000],
		iters: 500,
		worldSize: 4000,
		radius: 3,
		cellSize: 64,
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

type Body = { id: number; x: number; y: number; z: number; r: number };

function buildBodies(count: number, worldSize: number, radius: number): Body[] {
	const rng = mulberry32(0xc0ffee);
	const out: Body[] = [];
	for (let i = 0; i < count; i++) {
		out.push({
			id: i,
			x: rng() * worldSize,
			y: rng() * worldSize,
			z: rng() * worldSize,
			r: radius,
		});
	}
	return out;
}

interface RunResult {
	totalMs: number;
	perIterMs: number;
	heapDeltaMB: number;
}

function measureRebuild(bodies: Body[], cellSize: number, iters: number): RunResult {
	const grid = createGrid3D(cellSize);

	for (let i = 0; i < 20; i++) {
		clearGrid3D(grid);
		for (const b of bodies) insertEntity3D(grid, b.id, b.x, b.y, b.z, b.r, b.r, b.r);
	}

	Bun.gc(true);
	const heapBefore = process.memoryUsage().heapUsed;
	const t0 = Bun.nanoseconds();

	for (let i = 0; i < iters; i++) {
		clearGrid3D(grid);
		for (const b of bodies) insertEntity3D(grid, b.id, b.x, b.y, b.z, b.r, b.r, b.r);
	}

	const t1 = Bun.nanoseconds();
	const heapAfter = process.memoryUsage().heapUsed;

	const totalMs = (t1 - t0) / 1e6;
	return {
		totalMs,
		perIterMs: totalMs / iters,
		heapDeltaMB: (heapAfter - heapBefore) / (1024 * 1024),
	};
}

function main() {
	const args = parseArgs(process.argv);

	console.log('Spatial-hash 3D rebuild micro-benchmark');
	console.log(`  iters=${args.iters}  worldSize=${args.worldSize}  radius=${args.radius}  cellSize=${args.cellSize}`);
	console.log();

	const widths = [6, 10, 12, 12, 12];
	const header = ['N', 'ms/iter', 'iters/s', 'inserts/s', 'heapΔ MB'];
	printRow(header, widths);
	printRow(widths.map(w => '-'.repeat(w)), widths);

	for (const count of args.counts) {
		const bodies = buildBodies(count, args.worldSize, args.radius);
		const r = measureRebuild(bodies, args.cellSize, args.iters);
		const insertsPerSec = (count * args.iters) / (r.totalMs / 1000);
		printRow([
			String(count),
			r.perIterMs.toFixed(3),
			Math.round(1000 / r.perIterMs).toString(),
			Math.round(insertsPerSec).toLocaleString(),
			r.heapDeltaMB.toFixed(2),
		], widths);
	}
}

main();
