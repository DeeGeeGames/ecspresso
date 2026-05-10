/**
 * Spatial-hash 3D query micro-benchmark
 *
 * Measures box-query throughput against a populated grid.
 */

import {
	createGrid3D,
	clearGrid3D,
	insertEntity3D,
	gridQueryBox3D,
} from '../src/utils/spatial-hash3D';
import { mulberry32, printRow } from './bench-utils';

type Args = { counts: number[]; queries: number; worldSize: number; radius: number; cellSize: number; queryHalf: number };

function parseArgs(argv: string[]): Args {
	const defaults: Args = {
		counts: [1000, 5000, 10000],
		queries: 10000,
		worldSize: 4000,
		radius: 3,
		cellSize: 64,
		queryHalf: 32,
	};
	const parsed: Args = { ...defaults };
	for (const arg of argv.slice(2)) {
		const [key, value] = arg.replace(/^--/, '').split('=');
		if (!key || value === undefined) continue;
		if (key === 'counts') parsed.counts = value.split(',').map(Number);
		else if (key === 'queries') parsed.queries = Number(value);
		else if (key === 'worldSize') parsed.worldSize = Number(value);
		else if (key === 'radius') parsed.radius = Number(value);
		else if (key === 'cellSize') parsed.cellSize = Number(value);
		else if (key === 'queryHalf') parsed.queryHalf = Number(value);
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
	perQueryUs: number;
	hits: number;
	heapDeltaMB: number;
}

function measureBox(bodies: Body[], args: Args): RunResult {
	const grid = createGrid3D(args.cellSize);
	clearGrid3D(grid);
	for (const b of bodies) insertEntity3D(grid, b.id, b.x, b.y, b.z, b.r, b.r, b.r);

	const rng = mulberry32(0xdeadbeef);
	const half = args.queryHalf;

	const xs: number[] = new Array(args.queries);
	const ys: number[] = new Array(args.queries);
	const zs: number[] = new Array(args.queries);
	for (let i = 0; i < args.queries; i++) {
		xs[i] = rng() * args.worldSize;
		ys[i] = rng() * args.worldSize;
		zs[i] = rng() * args.worldSize;
	}

	const result: number[] = [];

	for (let i = 0; i < 20; i++) {
		result.length = 0;
		gridQueryBox3D(grid, xs[0]! - half, ys[0]! - half, zs[0]! - half, xs[0]! + half, ys[0]! + half, zs[0]! + half, result);
	}

	Bun.gc(true);
	const heapBefore = process.memoryUsage().heapUsed;
	const t0 = Bun.nanoseconds();
	let hits = 0;

	for (let i = 0; i < args.queries; i++) {
		result.length = 0;
		gridQueryBox3D(
			grid,
			xs[i]! - half, ys[i]! - half, zs[i]! - half,
			xs[i]! + half, ys[i]! + half, zs[i]! + half,
			result,
		);
		hits += result.length;
	}

	const t1 = Bun.nanoseconds();
	const heapAfter = process.memoryUsage().heapUsed;
	const totalMs = (t1 - t0) / 1e6;
	return {
		totalMs,
		perQueryUs: (totalMs * 1000) / args.queries,
		hits: Math.round(hits / args.queries),
		heapDeltaMB: (heapAfter - heapBefore) / (1024 * 1024),
	};
}

function main() {
	const args = parseArgs(process.argv);

	console.log('Spatial-hash 3D query micro-benchmark (gridQueryBox3D)');
	console.log(`  queries=${args.queries}  worldSize=${args.worldSize}  radius=${args.radius}  cellSize=${args.cellSize}  queryHalf=${args.queryHalf}`);
	console.log();

	const widths = [6, 12, 12, 10, 12];
	const header = ['N', 'us/query', 'queries/s', 'hits/q', 'heapΔ MB'];
	printRow(header, widths);
	printRow(widths.map(w => '-'.repeat(w)), widths);

	for (const count of args.counts) {
		const bodies = buildBodies(count, args.worldSize, args.radius);
		const r = measureBox(bodies, args);
		printRow([
			String(count),
			r.perQueryUs.toFixed(3),
			Math.round(1e6 / r.perQueryUs).toLocaleString(),
			String(r.hits),
			r.heapDeltaMB.toFixed(2),
		], widths);
	}
}

main();
