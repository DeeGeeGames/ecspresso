import { expect, test } from 'bun:test';
import { Container, ParticleContainer, Texture, TextureSource } from 'pixi.js';
import ECSpresso, { definePlugin } from 'ecspresso';
import { createLocalTransform, createTransformPlugin, transformSystems } from 'ecspresso/plugins/spatial/transform';
import { createParticlePlugin, createParticleEmitter, defineParticleEffect, burstParticles } from 'ecspresso/plugins/rendering/particles';

test('new world-space emitters burst at derived spawn positions on their first update', async () => {
	const root = new Container();
	const frame = new Texture({ source: new TextureSource({ width: 1, height: 1 }) });
	const world = ECSpresso.create()
		.withPlugin(createTransformPlugin())
		.withPlugin(definePlugin('example-particle-scene')
			.withComponentTypes<{ renderLayer: string }>()
			.withResourceTypes<{ rootContainer: Container }>()
			.install(ecs => { ecs.addResource('rootContainer', root); }))
		.withPlugin(createParticlePlugin({ phase: 'postUpdate', after: [transformSystems.propagate] }))
		.build();
	await world.initialize();
	const effect = defineParticleEffect({ texture: frame, maxParticles: 1, spawnRate: 0, burstCount: 1, speed: 0, lifetime: 1 });

	for (const position of [{ x: 120, y: 100 }, { x: 640, y: 340 }]) {
		const emitter = world.spawn({ ...createLocalTransform(position.x, position.y), ...createParticleEmitter(effect) });
		burstParticles(world, emitter.id);
		world.update(0.01);
		const particles = root.children.at(-1);
		expect(particles).toBeInstanceOf(ParticleContainer);
		if (!(particles instanceof ParticleContainer)) throw new Error('Missing particle display container');
		const particle = particles.particleChildren[0];
		expect(particle?.x).toBe(position.x);
		expect(particle?.y).toBe(position.y);
	}
	await world.dispose();
	root.destroy();
	frame.destroy(true);
});
