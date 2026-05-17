/**
 * End-to-end ECS physics 3D load benchmark
 *
 * Parallel to ecs-physics.bench.ts: N dynamic sphere bodies bouncing in
 * an axis-aligned 3D box under gravity, with all-vs-all collision in a
 * single layer. Used to measure the impact of perf changes on the 3D
 * plugin path (collision3D, physics3D, spatial-index3D, transform3D).
 *
 * Usage:
 *   bun bench/ecs-physics3D.bench.ts
 *   bun bench/ecs-physics3D.bench.ts --count=2000 --frames=300 --spatial
 *   bun bench/ecs-physics3D.bench.ts --count=1000 --frames=600 --no-spatial
 */

import ECSpresso from '../src';
import { createTransform3DPlugin } from '../src/plugins/spatial/transform3D';
import {
	createPhysics3DPlugin,
	createRigidBody3D,
} from '../src/plugins/physics/physics3D';
import {
	defineCollisionLayers,
	createSphereCollider,
} from '../src/plugins/physics/collision3D';
import { createSpatialIndex3DPlugin } from '../src/plugins/spatial/spatial-index3D';
import { createDiagnosticsPlugin } from '../src/plugins/debug/diagnostics';
import { mulberry32 } from './bench-utils';

// -- CLI --

interface Args {
	count: number;
	frames: number;
	spatial: boolean;
	worldW: number;
	worldH: number;
	worldD: number;
	radius: number;
	dt: number;
}

function parseArgs(argv: string[]): Args {
	const parsed: Args = {
		count: 1000,
		frames: 300,
		spatial: true,
		worldW: 80,
		worldH: 60,
		worldD: 80,
		radius: 1,
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
		else if (key === 'worldD') parsed.worldD = Number(value);
		else if (key === 'radius') parsed.radius = Number(value);
		else if (key === 'dt') parsed.dt = Number(value);
	}
	return parsed;
}

// -- World construction --

async function buildWorld(args: Args) {
	const layers = defineCollisionLayers({ ball: ['ball'] });

	const ecs = ECSpresso.create()
		.withPlugin(createTransform3DPlugin())
		.withPlugin(createPhysics3DPlugin({
			gravity: { x: 0, y: -40, z: 0 },
			layers,
		}))
		.withPlugin(createSpatialIndex3DPlugin({ cellSize: 4 }))
		.withPlugin(createDiagnosticsPlugin())
		.withComponentTypes<{ radius: number }>()
		// Opt out of change tracking entirely. The bench has no reactive
		// consumers (no `changed:` filters anywhere), so every markChanged
		// from physics/transform plugins becomes a no-op.
		.disableChangeTracking()
		.build();

	if (!args.spatial) {
		ecs.disableSystemGroup('spatialIndex3D');
		ecs.removeResource('spatialIndex3D');
	}

	// Bounce system — mirrors the 2D bench, extended to z-axis
	ecs
		.addSystem('bounce')
		.inPhase('postUpdate')
		.addQuery('balls', { with: ['worldTransform3D', 'velocity3D', 'radius'] })
		.setProcess(({ queries }) => {
			for (const entity of queries.balls) {
				const { worldTransform3D, velocity3D, radius } = entity.components;

				if (worldTransform3D.x < radius) {
					worldTransform3D.x = radius;
					velocity3D.x = Math.abs(velocity3D.x) * 0.9;
				} else if (worldTransform3D.x > args.worldW - radius) {
					worldTransform3D.x = args.worldW - radius;
					velocity3D.x = -Math.abs(velocity3D.x) * 0.9;
				}

				if (worldTransform3D.y < radius) {
					worldTransform3D.y = radius;
					velocity3D.y = Math.abs(velocity3D.y) * 0.9;
				} else if (worldTransform3D.y > args.worldH - radius) {
					worldTransform3D.y = args.worldH - radius;
					velocity3D.y = -Math.abs(velocity3D.y) * 0.9;
				}

				if (worldTransform3D.z < radius) {
					worldTransform3D.z = radius;
					velocity3D.z = Math.abs(velocity3D.z) * 0.9;
				} else if (worldTransform3D.z > args.worldD - radius) {
					worldTransform3D.z = args.worldD - radius;
					velocity3D.z = -Math.abs(velocity3D.z) * 0.9;
				}
			}
		});

	await ecs.initialize();

	// Spawn bodies — deterministic positions
	const rng = mulberry32(0xc0ffee);
	for (let i = 0; i < args.count; i++) {
		const x = args.radius + rng() * (args.worldW - args.radius * 2);
		const y = args.radius + rng() * (args.worldH / 2);
		const z = args.radius + rng() * (args.worldD - args.radius * 2);

		ecs.spawn({
			localTransform3D: { x, y, z, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 },
			worldTransform3D: { x, y, z, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 },
			...createRigidBody3D('dynamic', { mass: 1, restitution: 0.7, drag: 0.01 }),
			...createSphereCollider(args.radius),
			...layers.ball(),
			velocity3D: {
				x: (rng() - 0.5) * 40,
				y: (rng() - 0.5) * 20,
				z: (rng() - 0.5) * 40,
			},
			radius: args.radius,
		});
	}

	return ecs;
}

// -- Measurement --

async function run(args: Args): Promise<void> {
	const label = args.spatial ? 'with spatial-index3D' : 'brute-force (no spatial-index3D)';
	console.log(`\n== ${label} ==`);
	console.log(`  count=${args.count}  frames=${args.frames}  dt=${args.dt.toFixed(4)}  world=${args.worldW}×${args.worldH}×${args.worldD}`);

	const ecs = await buildWorld(args);

	// Warmup: 30 frames to let JIT settle and physics reach a steady state
	for (let i = 0; i < 30; i++) ecs.update(args.dt);

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

	const phases = ecs.phaseTimings;
	console.log('  phase timings (last frame):');
	for (const [name, ms] of Object.entries(phases)) {
		if (ms > 0) console.log(`    ${name.padEnd(12)} ${ms.toFixed(3)} ms`);
	}

	const sorted = Array.from(ecs.systemTimings.entries())
		.filter(([, ms]) => ms > 0)
		.sort(([, a], [, b]) => b - a)
		.slice(0, 8);
	if (sorted.length > 0) {
		console.log('  top systems (last frame):');
		for (const [name, ms] of sorted) {
			console.log(`    ${name.padEnd(34)} ${ms.toFixed(3)} ms`);
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
