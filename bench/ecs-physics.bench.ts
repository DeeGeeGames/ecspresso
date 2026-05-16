/**
 * End-to-end ECS physics load benchmark
 *
 * Mirrors the examples/15-diagnostics scene without the Pixi renderer:
 * N dynamic circle bodies bouncing in a 800×600 box under gravity, with
 * all-vs-all collision in a single layer.
 *
 * Measures total wall time, per-frame average, and per-phase / per-system
 * timings via the diagnostics plugin. Supports toggling the spatial index
 * to directly compare against the O(N²) brute-force path.
 *
 * Use this bench to evaluate the broader performance tasks in
 * tasks.local/performance/ — especially those that can't be measured with
 * the narrowphase micro-bench (query walks, command-buffer playback,
 * integration loop, transform propagation).
 *
 * Usage:
 *   bun bench/ecs-physics.bench.ts
 *   bun bench/ecs-physics.bench.ts --count=2000 --frames=300 --spatial
 *   bun bench/ecs-physics.bench.ts --count=1000 --frames=600 --no-spatial
 */

import ECSpresso from '../src';
import { createTransformPlugin } from '../src/plugins/spatial/transform';
import {
	createPhysics2DPlugin,
	createRigidBody,
} from '../src/plugins/physics/physics2D';
import {
	defineCollisionLayers,
	createCircleCollider,
} from '../src/plugins/physics/collision';
import { createSpatialIndexPlugin } from '../src/plugins/spatial/spatial-index';
import { createDiagnosticsPlugin } from '../src/plugins/debug/diagnostics';

// -- CLI --

interface Args {
	count: number;
	frames: number;
	spatial: boolean;
	worldW: number;
	worldH: number;
	radius: number;
	dt: number;
}

function parseArgs(argv: string[]): Args {
	const parsed: Args = {
		count: 1000,
		frames: 300,
		spatial: true,
		worldW: 800,
		worldH: 600,
		radius: 10,
		dt: 1 / 60,
	};
	for (const arg of argv.slice(2)) {
		const bare = arg.replace(/^--/, '');
		if (bare === 'spatial') { parsed.spatial = true; continue; }
		if (bare === 'no-spatial') { parsed.spatial = false; continue; }
		const [key, value] = bare.split('=');
		if (!key || value === undefined) continue;
		if (key === 'count') parsed.count = Number(value);
		else if (key === 'frames') parsed.frames = Number(value);
		else if (key === 'worldW') parsed.worldW = Number(value);
		else if (key === 'worldH') parsed.worldH = Number(value);
		else if (key === 'radius') parsed.radius = Number(value);
		else if (key === 'dt') parsed.dt = Number(value);
	}
	return parsed;
}

// -- World construction --

async function buildWorld(args: Args) {
	const layers = defineCollisionLayers({ ball: ['ball'] });

	const ecs = ECSpresso.create()
		.withPlugin(createTransformPlugin())
		.withPlugin(createPhysics2DPlugin({
			gravity: { x: 0, y: 400 },
			layers,
		}))
		.withPlugin(createSpatialIndexPlugin({ cellSize: 32 }))
		.withPlugin(createDiagnosticsPlugin())
		.withComponentTypes<{ radius: number }>()
		// Opt into explicit-only change tracking. The bench has no reactive
		// consumers, so plugin polite-marks (velocity/localTransform/worldTransform)
		// become no-ops.
		.setTrackedChanges()
		.build();

	if (!args.spatial) {
		ecs.disableSystemGroup('spatialIndex');
		ecs.removeResource('spatialIndex');
	}

	// Bounce system — mirrors the example
	ecs
		.addSystem('bounce')
		.inPhase('postUpdate')
		.addQuery('balls', { with: ['worldTransform', 'velocity', 'radius'] })
		.setProcess(({ queries }) => {
			for (const entity of queries.balls) {
				const { worldTransform, velocity, radius } = entity.components;

				if (worldTransform.x < radius) {
					worldTransform.x = radius;
					velocity.x = Math.abs(velocity.x) * 0.9;
				} else if (worldTransform.x > args.worldW - radius) {
					worldTransform.x = args.worldW - radius;
					velocity.x = -Math.abs(velocity.x) * 0.9;
				}

				if (worldTransform.y < radius) {
					worldTransform.y = radius;
					velocity.y = Math.abs(velocity.y) * 0.9;
				} else if (worldTransform.y > args.worldH - radius) {
					worldTransform.y = args.worldH - radius;
					velocity.y = -Math.abs(velocity.y) * 0.9;
				}
			}
		});

	await ecs.initialize();

	// Spawn bodies — deterministic positions
	const rng = mulberry32(0xc0ffee);
	for (let i = 0; i < args.count; i++) {
		const x = args.radius + rng() * (args.worldW - args.radius * 2);
		const y = args.radius + rng() * (args.worldH / 2);

		ecs.spawn({
			localTransform: { x, y, rotation: 0, scaleX: 1, scaleY: 1 },
			worldTransform: { x, y, rotation: 0, scaleX: 1, scaleY: 1 },
			...createRigidBody('dynamic', { mass: 1, restitution: 0.7, drag: 0.01 }),
			...createCircleCollider(args.radius),
			...layers.ball(),
			velocity: {
				x: (rng() - 0.5) * 400,
				y: (rng() - 0.5) * 200,
			},
			radius: args.radius,
		});
	}

	return ecs;
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

// -- Measurement --

async function run(args: Args): Promise<void> {
	const label = args.spatial ? 'with spatial-index' : 'brute-force (no spatial-index)';
	console.log(`\n== ${label} ==`);
	console.log(`  count=${args.count}  frames=${args.frames}  dt=${args.dt.toFixed(4)}  world=${args.worldW}×${args.worldH}`);

	const ecs = await buildWorld(args);

	// Warmup: 10 frames to let JIT settle and physics reach a steady state
	for (let i = 0; i < 10; i++) ecs.update(args.dt);

	Bun.gc(true);
	const heapBefore = process.memoryUsage().heapUsed;
	const t0 = Bun.nanoseconds();

	for (let i = 0; i < args.frames; i++) {
		ecs.update(args.dt);
	}

	const t1 = Bun.nanoseconds();
	const heapAfter = process.memoryUsage().heapUsed;

	const totalMs = (t1 - t0) / 1e6;
	const msPerFrame = totalMs / args.frames;
	const fps = 1000 / msPerFrame;
	const heapDeltaMB = (heapAfter - heapBefore) / (1024 * 1024);

	console.log(`  total: ${totalMs.toFixed(1)} ms   avg: ${msPerFrame.toFixed(3)} ms/frame   ≈ ${fps.toFixed(0)} fps`);
	console.log(`  heap Δ: ${heapDeltaMB.toFixed(2)} MB (retained across ${args.frames} frames)`);
	console.log(`  entities at end: ${ecs.entityCount}`);

	// Phase timings are in ms, from the most recent frame
	const phases = ecs.phaseTimings;
	console.log('  phase timings (last frame):');
	for (const [name, ms] of Object.entries(phases)) {
		if (ms > 0) console.log(`    ${name.padEnd(12)} ${ms.toFixed(3)} ms`);
	}

	// Top systems by last-frame timing
	const sorted = Array.from(ecs.systemTimings.entries())
		.filter(([, ms]) => ms > 0)
		.sort(([, a], [, b]) => b - a)
		.slice(0, 8);
	if (sorted.length > 0) {
		console.log('  top systems (last frame):');
		for (const [name, ms] of sorted) {
			console.log(`    ${name.padEnd(32)} ${ms.toFixed(3)} ms`);
		}
	}
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv);
	await run(args);
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
