/**
 * Particle System Plugin for ECSpresso
 *
 * High-performance particle system where particles live outside the ECS in
 * pre-allocated pools. Renders via PixiJS v8's ParticleContainer + Particle API.
 * Renderer2D is a required dependency.
 *
 * Follows the established plugin pattern: immutable shared config
 * (ParticleEffectConfig) + mutable per-entity state (ParticleEmitter) component,
 * side-storage Map for PixiJS objects, kit pattern for typed helpers.
 */

import { definePlugin, type BasePluginOptions } from 'ecspresso';
import type { BaseWorld } from 'ecspresso';
import type { WorldConfigFrom } from '../../type-utils';
import type { TransformComponentTypes, LocalTransform } from 'ecspresso/plugins/spatial/transform';

/** BaseWorld narrowed to particle components for typed access in helpers. */
type ParticleWorld = BaseWorld<ParticleComponentTypes>;

// ==================== Value Types ====================

/** Fixed value or random range [min, max] */
export type ParticleValue = number | readonly [number, number];

/** Emission geometry */
export type EmissionShape = 'point' | 'circle';

/** Blend modes for particle rendering */
export type ParticleBlendMode = 'normal' | 'add' | 'multiply' | 'screen';

// ==================== Config Types ====================

/**
 * User-facing config input for defining a particle effect.
 * All properties optional except maxParticles and texture.
 */
export interface ParticleEffectInput {
	/** Pool size — maximum simultaneous particles */
	maxParticles: number;
	/** PixiJS Texture for particles */
	texture: unknown;
	/** Particles per second (0 = burst-only, default: 10) */
	spawnRate?: number;
	/** Particles per burst (default: 0) */
	burstCount?: number;
	/** Emitter lifetime in seconds (-1 = infinite, default: -1) */
	duration?: number;
	/** Per-particle lifetime in seconds (default: 1) */
	lifetime?: ParticleValue;
	/** Initial speed in pixels/second (default: 100) */
	speed?: ParticleValue;
	/** Emission direction in radians (default: [0, 2*PI]) */
	angle?: ParticleValue;
	/** Spawn geometry (default: 'point') */
	emissionShape?: EmissionShape;
	/** Radius for 'circle' shape (default: 0) */
	emissionRadius?: number;
	/** Acceleration in pixels/second^2 (default: {x: 0, y: 0}) */
	gravity?: { readonly x: number; readonly y: number };
	/** Initial scale (default: 1) */
	startSize?: ParticleValue;
	/** Final scale (default: same as startSize) */
	endSize?: ParticleValue;
	/** Initial opacity (default: 1) */
	startAlpha?: ParticleValue;
	/** Final opacity (default: 0) */
	endAlpha?: ParticleValue;
	/** Initial hex color (default: 0xffffff) */
	startTint?: number;
	/** Final hex color (default: same as startTint) */
	endTint?: number;
	/** Initial rotation in radians (default: 0) */
	startRotation?: ParticleValue;
	/** Rotation velocity in rad/s (default: 0) */
	rotationSpeed?: ParticleValue;
	/** Blend mode (default: 'normal') */
	blendMode?: ParticleBlendMode;
	/** Particles in world coordinates (default: true) */
	worldSpace?: boolean;
}

/**
 * Frozen, fully-resolved particle effect config.
 * Output of defineParticleEffect.
 */
export interface ParticleEffectConfig {
	readonly maxParticles: number;
	readonly texture: unknown;
	readonly spawnRate: number;
	readonly burstCount: number;
	readonly duration: number;
	readonly lifetime: ParticleValue;
	readonly speed: ParticleValue;
	readonly angle: ParticleValue;
	readonly emissionShape: EmissionShape;
	readonly emissionRadius: number;
	readonly gravity: { readonly x: number; readonly y: number };
	readonly startSize: ParticleValue;
	readonly endSize: ParticleValue;
	readonly startAlpha: ParticleValue;
	readonly endAlpha: ParticleValue;
	readonly startTint: number;
	readonly endTint: number;
	readonly startRotation: ParticleValue;
	readonly rotationSpeed: ParticleValue;
	readonly blendMode: ParticleBlendMode;
	readonly worldSpace: boolean;
}

// ==================== Per-Particle Pool Element ====================

/**
 * Mutable per-particle state. Pre-allocated, never GC'd.
 */
export interface ParticleState {
	active: boolean;
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	maxLife: number;
	size: number;
	startSize: number;
	endSize: number;
	alpha: number;
	startAlpha: number;
	endAlpha: number;
	tint: number;
	rotation: number;
	rotationSpeed: number;
}

// ==================== ECS Component ====================

/**
 * Per-entity emitter state stored as an ECS component.
 */
export interface ParticleEmitter {
	readonly config: ParticleEffectConfig;
	activeCount: number;
	spawnAccumulator: number;
	elapsed: number;
	playing: boolean;
	pendingBurst: number;
	finished: boolean;
	onComplete?: (data: ParticleEmitterEventData) => void;
}

/**
 * Component types provided by the particle plugin.
 */
export interface ParticleComponentTypes {
	particleEmitter: ParticleEmitter;
}

// ==================== Event Types ====================

/**
 * Data published when an emitter completes.
 */
export interface ParticleEmitterEventData {
	entityId: number;
}

// ==================== Plugin Options ====================

export interface ParticlePluginOptions<G extends string = 'particles'> extends BasePluginOptions<G> {}

// ==================== Pure Functions (Simulation Engine) ====================

/**
 * Sample a ParticleValue: returns fixed value or random within [min, max].
 */
export function sampleRange(value: ParticleValue): number {
	if (typeof value === 'number') return value;
	const [min, max] = value;
	return min + Math.random() * (max - min);
}

/**
 * Linear interpolation between two hex colors (RGB channels).
 */
export function lerpTint(start: number, end: number, t: number): number {
	if (start === end) return start;
	const sr = (start >> 16) & 0xff;
	const sg = (start >> 8) & 0xff;
	const sb = start & 0xff;
	const er = (end >> 16) & 0xff;
	const eg = (end >> 8) & 0xff;
	const eb = end & 0xff;
	const r = (sr + (er - sr) * t) | 0;
	const g = (sg + (eg - sg) * t) | 0;
	const b = (sb + (eb - sb) * t) | 0;
	return (r << 16) | (g << 8) | b;
}

// ==================== Config Builder ====================

const TWO_PI = Math.PI * 2;

/**
 * Define a particle effect config with defaults applied and frozen.
 */
export function defineParticleEffect(input: ParticleEffectInput): ParticleEffectConfig {
	const startSize = input.startSize ?? 1;
	const startTint = input.startTint ?? 0xffffff;
	return Object.freeze({
		maxParticles: input.maxParticles,
		texture: input.texture,
		spawnRate: input.spawnRate ?? 10,
		burstCount: input.burstCount ?? 0,
		duration: input.duration ?? -1,
		lifetime: input.lifetime ?? 1,
		speed: input.speed ?? 100,
		angle: input.angle ?? [0, TWO_PI] as const,
		emissionShape: input.emissionShape ?? 'point',
		emissionRadius: input.emissionRadius ?? 0,
		gravity: Object.freeze(input.gravity ?? { x: 0, y: 0 }),
		startSize,
		endSize: input.endSize ?? startSize,
		startAlpha: input.startAlpha ?? 1,
		endAlpha: input.endAlpha ?? 0,
		startTint,
		endTint: input.endTint ?? startTint,
		startRotation: input.startRotation ?? 0,
		rotationSpeed: input.rotationSpeed ?? 0,
		blendMode: input.blendMode ?? 'normal',
		worldSpace: input.worldSpace ?? true,
	});
}

// ==================== Component Factory ====================

/**
 * Create a particleEmitter component suitable for spreading into spawn().
 */
export function createParticleEmitter(
	config: ParticleEffectConfig,
	options?: {
		playing?: boolean;
		onComplete?: (data: ParticleEmitterEventData) => void;
	},
): Pick<ParticleComponentTypes, 'particleEmitter'> {
	return {
		particleEmitter: {
			config,
			activeCount: 0,
			spawnAccumulator: 0,
			elapsed: 0,
			playing: options?.playing ?? true,
			pendingBurst: 0,
			finished: false,
			onComplete: options?.onComplete,
		},
	};
}

// ==================== Helper Functions ====================

/**
 * Queue a burst of particles on an emitter.
 * Returns false if entity has no particleEmitter component.
 */
export function burstParticles(
	ecs: ParticleWorld,
	entityId: number,
	count?: number,
): boolean {
	const emitter = ecs.getComponent(entityId, 'particleEmitter');
	if (!emitter) return false;
	emitter.pendingBurst += count ?? emitter.config.burstCount;
	ecs.markChanged(entityId, 'particleEmitter');
	return true;
}

/**
 * Stop an emitter from spawning new particles.
 * Existing particles continue their lifecycle.
 */
export function stopEmitter(
	ecs: ParticleWorld,
	entityId: number,
): boolean {
	const emitter = ecs.getComponent(entityId, 'particleEmitter');
	if (!emitter) return false;
	emitter.playing = false;
	return true;
}

/**
 * Resume a stopped emitter.
 */
export function resumeEmitter(
	ecs: ParticleWorld,
	entityId: number,
): boolean {
	const emitter = ecs.getComponent(entityId, 'particleEmitter');
	if (!emitter) return false;
	emitter.playing = true;
	return true;
}

// ==================== Side Storage ====================

/**
 * Runtime data stored outside the ECS, keyed by entity ID.
 */
export interface EmitterRuntimeData {
	particles: ParticleState[];
	pixiContainer: unknown;
	pixiParticles: unknown[];
}

// ==================== Spawn Logic ====================

function spawnParticle(
	particle: ParticleState,
	config: ParticleEffectConfig,
	emitterX: number,
	emitterY: number,
	emitterRotation: number,
): void {
	particle.active = true;
	const life = sampleRange(config.lifetime);
	particle.life = life;
	particle.maxLife = life;

	// Position from emission shape
	if (config.emissionShape === 'circle' && config.emissionRadius > 0) {
		const angle = Math.random() * TWO_PI;
		const radius = Math.random() * config.emissionRadius;
		particle.x = emitterX + Math.cos(angle) * radius;
		particle.y = emitterY + Math.sin(angle) * radius;
	} else {
		particle.x = emitterX;
		particle.y = emitterY;
	}

	// Velocity from speed + angle + emitter rotation
	const speed = sampleRange(config.speed);
	const angle = sampleRange(config.angle) + emitterRotation;
	particle.vx = Math.cos(angle) * speed;
	particle.vy = Math.sin(angle) * speed;

	// Visual properties
	particle.startSize = sampleRange(config.startSize);
	particle.endSize = sampleRange(config.endSize);
	particle.size = particle.startSize;
	particle.startAlpha = sampleRange(config.startAlpha);
	particle.endAlpha = sampleRange(config.endAlpha);
	particle.alpha = particle.startAlpha;
	particle.tint = config.startTint;
	particle.rotation = sampleRange(config.startRotation);
	particle.rotationSpeed = sampleRange(config.rotationSpeed);
}

// ==================== Update Logic ====================

function updateParticles(
	emitter: ParticleEmitter,
	data: EmitterRuntimeData,
	dt: number,
	emitterX: number,
	emitterY: number,
	emitterRotation: number,
): void {
	const config = emitter.config;

	// Update emitter elapsed time
	emitter.elapsed += dt;

	// Determine if spawning is allowed
	const durationExpired = config.duration >= 0 && emitter.elapsed >= config.duration;
	const canSpawn = emitter.playing && !durationExpired;

	// Continuous spawning
	if (canSpawn && config.spawnRate > 0) {
		emitter.spawnAccumulator += config.spawnRate * dt;
		const toSpawn = Math.floor(emitter.spawnAccumulator);
		emitter.spawnAccumulator -= toSpawn;

		for (let i = 0; i < toSpawn; i++) {
			if (emitter.activeCount >= config.maxParticles) break;
			const particle = data.particles[emitter.activeCount];
			if (!particle) break;
			spawnParticle(particle, config, emitterX, emitterY, emitterRotation);
			emitter.activeCount++;
		}
	}

	// Burst spawning
	if (emitter.pendingBurst > 0) {
		const burstCount = Math.min(
			emitter.pendingBurst,
			config.maxParticles - emitter.activeCount,
		);
		for (let i = 0; i < burstCount; i++) {
			const particle = data.particles[emitter.activeCount];
			if (!particle) break;
			spawnParticle(particle, config, emitterX, emitterY, emitterRotation);
			emitter.activeCount++;
		}
		emitter.pendingBurst -= burstCount;
	}

	// Update active particles
	const gravityX = config.gravity.x;
	const gravityY = config.gravity.y;
	const hasGravity = gravityX !== 0 || gravityY !== 0;
	const hasTintLerp = config.startTint !== config.endTint;

	let i = 0;
	while (i < emitter.activeCount) {
		const p = data.particles[i];
		if (!p) break;

		p.life -= dt;

		if (p.life <= 0) {
			// Swap-and-pop: move last active particle to this slot
			emitter.activeCount--;
			if (i < emitter.activeCount) {
				const last = data.particles[emitter.activeCount];
				if (last) {
					// Copy last particle data to current slot
					data.particles[i] = last;
					data.particles[emitter.activeCount] = p;
					// Also swap PixiJS particle refs
					const tmpPixi = data.pixiParticles[i];
					data.pixiParticles[i] = data.pixiParticles[emitter.activeCount];
					data.pixiParticles[emitter.activeCount] = tmpPixi;
				}
			}
			p.active = false;
			continue;
		}

		// Physics
		if (hasGravity) {
			p.vx += gravityX * dt;
			p.vy += gravityY * dt;
		}
		p.x += p.vx * dt;
		p.y += p.vy * dt;

		// Interpolation
		const t = 1 - p.life / p.maxLife;
		p.size = p.startSize + (p.endSize - p.startSize) * t;
		p.alpha = p.startAlpha + (p.endAlpha - p.startAlpha) * t;

		if (hasTintLerp) {
			p.tint = lerpTint(config.startTint, config.endTint, t);
		}

		// Rotation
		p.rotation += p.rotationSpeed * dt;

		i++;
	}
}

// ==================== Pool Allocation ====================

function createParticlePool(maxParticles: number): ParticleState[] {
	const pool: ParticleState[] = new Array(maxParticles);
	for (let i = 0; i < maxParticles; i++) {
		pool[i] = {
			active: false,
			x: 0, y: 0,
			vx: 0, vy: 0,
			life: 0, maxLife: 0,
			size: 0,
			startSize: 0, endSize: 0,
			alpha: 0,
			startAlpha: 0, endAlpha: 0,
			tint: 0xffffff,
			rotation: 0,
			rotationSpeed: 0,
		};
	}
	return pool;
}

// ==================== Presets ====================

export const particlePresets = {
	explosion(texture: unknown, overrides?: Partial<ParticleEffectInput>): ParticleEffectConfig {
		return defineParticleEffect({
			maxParticles: 50,
			texture,
			spawnRate: 0,
			burstCount: 30,
			duration: 1,
			lifetime: [0.3, 0.8],
			speed: [100, 300],
			angle: [0, TWO_PI],
			startSize: [0.5, 1.5],
			endSize: [0.1, 0.3],
			startAlpha: 1,
			endAlpha: 0,
			...overrides,
		});
	},

	smoke(texture: unknown, overrides?: Partial<ParticleEffectInput>): ParticleEffectConfig {
		return defineParticleEffect({
			maxParticles: 60,
			texture,
			spawnRate: 15,
			duration: -1,
			lifetime: [1, 3],
			speed: [20, 60],
			angle: [-Math.PI / 2 - 0.3, -Math.PI / 2 + 0.3],
			startSize: [0.3, 0.6],
			endSize: [1, 2],
			startAlpha: 0.4,
			endAlpha: 0,
			...overrides,
		});
	},

	fire(texture: unknown, overrides?: Partial<ParticleEffectInput>): ParticleEffectConfig {
		return defineParticleEffect({
			maxParticles: 80,
			texture,
			spawnRate: 30,
			duration: -1,
			lifetime: [0.3, 1],
			speed: [40, 120],
			angle: [-Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5],
			startSize: [0.5, 1],
			endSize: [0.1, 0.3],
			startAlpha: 1,
			endAlpha: 0,
			startTint: 0xff8800,
			endTint: 0xff2200,
			blendMode: 'add',
			...overrides,
		});
	},

	sparkle(texture: unknown, overrides?: Partial<ParticleEffectInput>): ParticleEffectConfig {
		return defineParticleEffect({
			maxParticles: 30,
			texture,
			spawnRate: 10,
			duration: -1,
			lifetime: [0.5, 1.5],
			speed: [10, 40],
			angle: [0, TWO_PI],
			startSize: [0.2, 0.8],
			endSize: [0.1, 0.4],
			startAlpha: [0.5, 1],
			endAlpha: 0,
			...overrides,
		});
	},

	trail(texture: unknown, overrides?: Partial<ParticleEffectInput>): ParticleEffectConfig {
		return defineParticleEffect({
			maxParticles: 40,
			texture,
			spawnRate: 20,
			duration: -1,
			lifetime: [0.3, 0.8],
			speed: 0,
			startSize: [0.5, 1],
			endSize: [0.05, 0.2],
			startAlpha: 0.8,
			endAlpha: 0,
			...overrides,
		});
	},
} as const;

// ==================== Plugin Factory ====================

type ParticleLabels = 'particle-update' | 'particle-render-sync';

type ParticleRequires = WorldConfigFrom<TransformComponentTypes & { renderLayer: string }>;

/**
 * Create a particle system plugin for ECSpresso.
 *
 * Provides:
 * - Pre-allocated particle pools outside the entity system
 * - Continuous and burst emission modes
 * - Velocity, gravity, lifetime, interpolation (size, alpha, tint, rotation)
 * - World-space and local-space particle emission
 * - PixiJS ParticleContainer rendering (via renderer2D dependency)
 * - Presets for common effects (explosion, smoke, fire, sparkle, trail)
 *
 * Renderer2D is a required dependency.
 */
export function createParticlePlugin<
	G extends string = 'particles',
>(
	options?: ParticlePluginOptions<G>,
) {
	const {
		systemGroup = 'particles',
		priority = 0,
		phase = 'update',
	} = options ?? {};

	// Side storage for runtime particle data
	const emitterData = new Map<number, EmitterRuntimeData>();

	return definePlugin('particles')
		.withComponentTypes<ParticleComponentTypes>()
		.withLabels<ParticleLabels>()
		.withGroups<G>()
		.withReactiveQueryNames<'particle-emitters'>()
		.requires<ParticleRequires>()
		.install((world) => {
			// Required component: particleEmitter needs localTransform
			world.registerRequired('particleEmitter', 'localTransform', (): LocalTransform => ({
				x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1,
			}));

			// Dispose: clean up side storage when particleEmitter removed
			world.registerDispose('particleEmitter', ({ entityId }: { value: ParticleEmitter; entityId: number }) => {
				const data = emitterData.get(entityId);
				if (data) {
					// Remove PixiJS container from scene graph
					const container = data.pixiContainer as { removeFromParent?: () => void; destroy?: () => void } | null;
					if (container) {
						container.removeFromParent?.();
						container.destroy?.();
					}
					emitterData.delete(entityId);
				}
			});

			// ==================== Particle Update System ====================
			world
				.addSystem('particle-update')
				.setPriority(priority)
				.inPhase(phase)
				.inGroup(systemGroup)
				.addQuery('emitters', {
					with: ['particleEmitter'],
				})
				.setProcess(({ queries, dt, ecs }) => {
					for (const entity of queries.emitters) {
						const emitter = entity.components.particleEmitter;

						// Lazily create particle pool on first encounter
						let data = emitterData.get(entity.id);
						if (!data) {
							data = {
								particles: createParticlePool(emitter.config.maxParticles),
								pixiContainer: null,
								pixiParticles: [],
							};
							emitterData.set(entity.id, data);
						}

						const worldTransform = ecs.getComponent(entity.id, 'worldTransform');
						const ex = worldTransform?.x ?? 0;
						const ey = worldTransform?.y ?? 0;
						const erot = worldTransform?.rotation ?? 0;

						updateParticles(emitter, data, dt, ex, ey, erot);

						// Check completion
						const config = emitter.config;
						const durationExpired = config.duration >= 0 && emitter.elapsed >= config.duration;
						if (durationExpired && emitter.activeCount === 0 && !emitter.finished) {
							emitter.finished = true;

							if (emitter.onComplete) {
								emitter.onComplete({ entityId: entity.id });
							}

							ecs.commands.removeComponent(entity.id, 'particleEmitter');
						}
					}
				});

			// ==================== Particle Render Sync System ====================
			world
				.addSystem('particle-render-sync')
				.setPriority(400)
				.inPhase('render')
				.inGroup(systemGroup)
				.setOnInitialize(async (ecs) => {
					// Dynamic import PixiJS
					const pixi = await import('pixi.js');
					const ParticleContainerClass = pixi.ParticleContainer;
					const ParticleClass = pixi.Particle;

					// Get root container
					const rootContainer = ecs.tryGetResource<{ addChild(child: unknown): void }>('rootContainer');

					// Reactive query for particleEmitter component
					ecs.addReactiveQuery('particle-emitters', {
						with: ['particleEmitter'],
						onEnter: (entity) => {
							const emitter = entity.components.particleEmitter;
							const config = emitter.config;

							// Create PixiJS ParticleContainer
							const pixiContainer = new ParticleContainerClass({
								dynamicProperties: {
									position: true,
									rotation: true,
									color: true,
									vertex: true,
								},
							});

							// Set blend mode
							pixiContainer.blendMode = config.blendMode;

							// Pre-allocate Particle objects
							const pixiParticles: InstanceType<typeof ParticleClass>[] = [];
							for (let i = 0; i < config.maxParticles; i++) {
								const p = new ParticleClass({
									texture: config.texture,
								} as ConstructorParameters<typeof ParticleClass>[0]);
								p.alpha = 0;
								pixiParticles.push(p);
								pixiContainer.addParticle(p);
							}

							// Create pre-allocated pool
							const particles = createParticlePool(config.maxParticles);

							// Add to scene (cross-plugin structural access for renderLayer)
							if (rootContainer) {
								const layerName = ecs.getComponent(entity.id, 'renderLayer');
								if (layerName) {
									(rootContainer as { addChild(child: unknown): void }).addChild(pixiContainer);
								} else {
									(rootContainer as { addChild(child: unknown): void }).addChild(pixiContainer);
								}
							}

							// Store in side storage
							emitterData.set(entity.id, {
								particles,
								pixiContainer,
								pixiParticles,
							});
						},
						onExit: (entityId) => {
							const data = emitterData.get(entityId);
							if (data) {
								const container = data.pixiContainer as { removeFromParent?: () => void; destroy?: () => void } | null;
								if (container) {
									container.removeFromParent?.();
									container.destroy?.();
								}
								emitterData.delete(entityId);
							}
						},
					});
				})
				.setProcess(({ ecs }) => {
					// Sync ParticleState -> PixiJS Particle properties
					for (const [entityId, data] of emitterData) {
						const emitter = ecs.getComponent(entityId, 'particleEmitter');
						if (!emitter) continue;

						const config = emitter.config;

						// Local-space: sync container position to emitter's worldTransform
						if (!config.worldSpace) {
							const wt = ecs.getComponent(entityId, 'worldTransform');
							if (wt) {
								const container = data.pixiContainer as {
									position: { set(x: number, y: number): void };
									rotation: number;
									scale: { set(x: number, y: number): void };
								};
								container.position.set(wt.x, wt.y);
								container.rotation = wt.rotation;
								container.scale.set(wt.scaleX, wt.scaleY);
							}
						}

						// Sync active particles
						for (let i = 0; i < emitter.activeCount; i++) {
							const ps = data.particles[i];
							const pp = data.pixiParticles[i] as {
								x: number;
								y: number;
								scaleX: number;
								scaleY: number;
								rotation: number;
								tint: number;
								alpha: number;
							};
							if (!ps || !pp) continue;
							pp.x = ps.x;
							pp.y = ps.y;
							pp.scaleX = ps.size;
							pp.scaleY = ps.size;
							pp.rotation = ps.rotation;
							pp.tint = ps.tint;
							pp.alpha = ps.alpha;
						}

						// Hide inactive particles
						for (let i = emitter.activeCount; i < config.maxParticles; i++) {
							const pp = data.pixiParticles[i] as { alpha: number } | undefined;
							if (pp) {
								pp.alpha = 0;
							}
						}
					}
				});
		});
}

/**
 * Get the runtime data for an emitter entity.
 * Useful for tests and advanced usage.
 * @internal Exported for testing only.
 */
export function getEmitterData(
	emitterDataMap: Map<number, EmitterRuntimeData>,
	entityId: number,
): EmitterRuntimeData | undefined {
	return emitterDataMap.get(entityId);
}
