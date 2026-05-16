/**
 * Query-walk micro-bench.
 *
 * Designed to isolate the cost of per-frame query result rebuild — exactly
 * the work that an incremental query cache aims to remove. Uses a stable
 * world (entities spawn once, mutate cheaply) and several systems whose
 * queries have non-trivial `with` / `without` / `parentHas` shapes, so the
 * filter walk in `getEntitiesWithQueryInto` dominates per-frame time
 * relative to the per-entity work each system does.
 *
 * Contrast this with `bench/ecs-physics.bench.ts`, which is collision-bound
 * and where query rebuild is a small slice of frame time.
 *
 * Usage:
 *   bun bench/query-walk.bench.ts
 *   bun bench/query-walk.bench.ts --count=10000 --frames=600
 *   bun bench/query-walk.bench.ts --count=20000 --frames=300 --runs=5
 */

import ECSpresso from '../src';
import type { WorldConfigFrom } from '../src/type-utils';
import { createDiagnosticsPlugin } from '../src/plugins/debug/diagnostics';

interface Args {
	count: number;
	frames: number;
	runs: number;
}

function parseArgs(argv: string[]): Args {
	const parsed: Args = { count: 10000, frames: 600, runs: 3 };
	for (const arg of argv.slice(2)) {
		const [key, value] = arg.replace(/^--/, '').split('=');
		if (!key || value === undefined) continue;
		if (key === 'count') parsed.count = Number(value);
		else if (key === 'frames') parsed.frames = Number(value);
		else if (key === 'runs') parsed.runs = Number(value);
	}
	return parsed;
}

interface Components {
	position: { x: number; y: number };
	velocity: { x: number; y: number };
	health: { value: number };
	alive: true;
	sleeping: true;
	tagA: true;
	tagB: true;
	parentTag: true;
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

async function buildWorld(args: Args) {
	const ecs = ECSpresso.create<WorldConfigFrom<Components>>()
		.withPlugin(createDiagnosticsPlugin())
		.build();

	// Read-only walks. Per-entity work is intentionally cheap so query
	// rebuild dominates each system's tick.
	ecs.addSystem('movement')
		.addQuery('moving', { with: ['position', 'velocity'], without: ['sleeping'] })
		.setProcess(({ queries, dt }) => {
			for (const e of queries.moving) {
				e.components.position.x += e.components.velocity.x * dt;
				e.components.position.y += e.components.velocity.y * dt;
			}
		});

	ecs.addSystem('regen')
		.addQuery('alive', { with: ['health', 'alive'] })
		.setProcess(({ queries, dt }) => {
			for (const e of queries.alive) {
				if (e.components.health.value < 100) e.components.health.value += dt;
			}
		});

	ecs.addSystem('aiA')
		.addQuery('a', { with: ['position', 'velocity', 'tagA'], without: ['sleeping'] })
		.setProcess(({ queries }) => {
			for (const e of queries.a) e.components.velocity.x *= 0.999;
		});

	ecs.addSystem('aiB')
		.addQuery('b', { with: ['position', 'velocity', 'tagB'], without: ['sleeping'] })
		.setProcess(({ queries }) => {
			for (const e of queries.b) e.components.velocity.y *= 0.999;
		});

	ecs.addSystem('culling')
		.addQuery('dead', { with: ['position'], without: ['alive'] })
		.setProcess(({ queries }) => {
			// touch a field so the iteration isn't optimized away
			for (const e of queries.dead) e.components.position.x = e.components.position.x;
		});

	ecs.addSystem('childrenOfTagged')
		.addQuery('kids', { with: ['position'], parentHas: ['parentTag'] })
		.setProcess(({ queries }) => {
			for (const e of queries.kids) e.components.position.y = e.components.position.y;
		});

	await ecs.initialize();

	// Spawn entities. Most are alive + tagA OR tagB; a slice has parentTag and
	// children pointing at them. A small fraction start "sleeping" (to keep
	// the without-cache path non-empty) and dead (to populate the culling
	// query).
	const rng = mulberry32(0xC0FFEE);
	const parentIds: number[] = [];
	for (let i = 0; i < args.count; i++) {
		const components: Partial<Components> = {
			position: { x: rng() * 1000, y: rng() * 1000 },
			velocity: { x: (rng() - 0.5) * 100, y: (rng() - 0.5) * 100 },
			health: { value: 50 },
		};
		if (rng() < 0.95) components.alive = true;
		if (i % 2 === 0) components.tagA = true;
		else components.tagB = true;
		if (rng() < 0.05) components.sleeping = true;
		if (i < args.count * 0.02) {
			components.parentTag = true;
		}
		const e = ecs.spawn(components as Components);
		if (components.parentTag) parentIds.push(e.id);
	}

	// Give each parent a few children so parentHas query has work to do.
	for (const parentId of parentIds) {
		for (let k = 0; k < 5; k++) {
			ecs.spawnChild(parentId, {
				position: { x: rng() * 10, y: rng() * 10 },
			});
		}
	}

	return ecs;
}

async function runOnce(args: Args): Promise<{ totalMs: number; perFrame: number; systems: Array<[string, number]> }> {
	const ecs = await buildWorld(args);
	// Warmup: 10 frames so the JIT settles and caches (if present) fully populate.
	for (let i = 0; i < 10; i++) ecs.update(1 / 60);

	Bun.gc(true);
	const t0 = Bun.nanoseconds();
	for (let i = 0; i < args.frames; i++) ecs.update(1 / 60);
	const t1 = Bun.nanoseconds();

	const totalMs = (t1 - t0) / 1e6;
	const perFrame = totalMs / args.frames;

	const systems = Array.from(ecs.systemTimings.entries())
		.filter(([, ms]) => ms > 0)
		.sort(([, a], [, b]) => b - a)
		.slice(0, 10);

	return { totalMs, perFrame, systems };
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv);
	console.log(`== query-walk bench ==`);
	console.log(`  count=${args.count}  frames=${args.frames}  runs=${args.runs}`);

	const totals: number[] = [];
	const perFrames: number[] = [];
	let lastSystems: Array<[string, number]> = [];

	for (let r = 0; r < args.runs; r++) {
		const { totalMs, perFrame, systems } = await runOnce(args);
		totals.push(totalMs);
		perFrames.push(perFrame);
		lastSystems = systems;
		console.log(`  run ${r + 1}: total ${totalMs.toFixed(1)} ms   avg ${perFrame.toFixed(3)} ms/frame`);
	}

	function median(xs: number[]): number {
		const sorted = xs.slice().sort((a, b) => a - b);
		const mid = sorted[Math.floor(sorted.length / 2)];
		return mid ?? 0;
	}
	console.log(`  median total: ${median(totals).toFixed(1)} ms   median per-frame: ${median(perFrames).toFixed(3)} ms`);

	if (lastSystems.length > 0) {
		console.log('  top systems (last run, last frame):');
		for (const [name, ms] of lastSystems) {
			console.log(`    ${name.padEnd(24)} ${ms.toFixed(3)} ms`);
		}
	}
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
