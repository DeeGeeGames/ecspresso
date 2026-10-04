import { definePlugin, type ComponentsConfig, type ResourcesConfig } from "ecspresso";
import type { TransformComponentTypes, BoundsRect } from "ecspresso/plugins/rendering/renderer2D";

// -- Custom plugin --
// A plugin packages related components, events, and systems into a reusable unit.
// Provisions declare owned types; requirements declare types supplied by other plugins.

interface BouncingComponents {
	velocity: { x: number; y: number };
	radius: number;
}

interface BouncingEvents {
	wallHit: { x: number; y: number };
}

// The plugin reads the 'bounds' resource (provided by the renderer plugin).
// It is a requirement, not a resource provided by this plugin.
interface BouncingResources {
	bounds: BoundsRect;
}

export function createBouncingPlugin() {
	return definePlugin('bouncing')
		.withComponentTypes<BouncingComponents>()
		.withEventTypes<BouncingEvents>()
		.requires<ComponentsConfig<TransformComponentTypes> & ResourcesConfig<BouncingResources>>()
		.install((world) => {
			world.addSystem('movement')
				.setProcessEach({ with: ['localTransform', 'velocity'], mutates: ['localTransform'] }, ({ entity, dt }) => {
					const { localTransform, velocity } = entity.components;
					localTransform.x += velocity.x * dt;
					localTransform.y += velocity.y * dt;
				});
			world.addSystem('bounce')
				.withResources(['bounds'])
				.setProcessEach({ with: ['localTransform', 'velocity', 'radius'], mutates: ['localTransform', 'velocity'] }, ({ entity, ecs, resources: { bounds } }) => {
					const { localTransform, velocity, radius } = entity.components;
					const maxX = Math.max(radius, bounds.width - radius);
					const maxY = Math.max(radius, bounds.height - radius);
					const x = Math.max(radius, Math.min(maxX, localTransform.x));
					const y = Math.max(radius, Math.min(maxY, localTransform.y));
					const hitX = (x <= radius && velocity.x < 0) || (x >= maxX && velocity.x > 0);
					const hitY = (y <= radius && velocity.y < 0) || (y >= maxY && velocity.y > 0);
					if (x === localTransform.x && y === localTransform.y && !hitX && !hitY) return false;
					localTransform.x = x;
					localTransform.y = y;
					if (hitX) velocity.x *= -1;
					if (hitY) velocity.y *= -1;
					if (hitX || hitY) ecs.eventBus.publish('wallHit', { x, y });
				});
		});
}
