import { Graphics } from 'pixi.js';
import ECSpresso from "ecspresso";
import {
	createRenderer2DPlugin,
	createGraphicsComponents,
} from "ecspresso/plugins/rendering/renderer2D";
import { createInputPlugin } from "ecspresso/plugins/input/input";

// ==================== Solar System Data ====================

const SOLAR_SYSTEM = {
	sun: {
		name: 'Sun',
		color: 0xFFD700,
		radius: 35,
	},
	planets: [
		{
			name: 'Mercury',
			color: 0xB0B0B0,
			radius: 6,
			orbitRadius: 70,
			orbitSpeed: 0.8,
			moons: [],
		},
		{
			name: 'Venus',
			color: 0xE6B800,
			radius: 9,
			orbitRadius: 100,
			orbitSpeed: 0.6,
			moons: [],
		},
		{
			name: 'Earth',
			color: 0x4169E1,
			radius: 10,
			orbitRadius: 140,
			orbitSpeed: 0.4,
			moons: [
				{ name: 'Moon', color: 0xC0C0C0, radius: 4, orbitRadius: 20, orbitSpeed: 1.2 },
			],
		},
		{
			name: 'Mars',
			color: 0xCD5C5C,
			radius: 8,
			orbitRadius: 185,
			orbitSpeed: 0.3,
			moons: [
				{ name: 'Phobos', color: 0x8B8B83, radius: 3, orbitRadius: 15, orbitSpeed: 1.5 },
				{ name: 'Deimos', color: 0x9C9C8B, radius: 2, orbitRadius: 22, orbitSpeed: 1.2 },
			],
		},
		{
			name: 'Jupiter',
			color: 0xDAA520,
			radius: 22,
			orbitRadius: 260,
			orbitSpeed: 0.18,
			moons: [
				{ name: 'Io', color: 0xFFFF66, radius: 4, orbitRadius: 32, orbitSpeed: 1.3 },
				{ name: 'Europa', color: 0xADD8E6, radius: 4, orbitRadius: 40, orbitSpeed: 1.0 },
				{ name: 'Ganymede', color: 0xC0C0C0, radius: 5, orbitRadius: 50, orbitSpeed: 0.7 },
				{ name: 'Callisto', color: 0x808080, radius: 5, orbitRadius: 60, orbitSpeed: 0.5 },
			],
		},
		{
			name: 'Saturn',
			color: 0xF4C542,
			radius: 18,
			orbitRadius: 350,
			orbitSpeed: 0.12,
			moons: [
				{ name: 'Titan', color: 0xD2691E, radius: 5, orbitRadius: 35, orbitSpeed: 0.7 },
				{ name: 'Enceladus', color: 0xFFFFFF, radius: 3, orbitRadius: 28, orbitSpeed: 1.1 },
			],
		},
	],
};

// ==================== ECS Setup ====================

const ecs = ECSpresso.create()
	.withPlugin(createRenderer2DPlugin({
		background: 0x000011,
		startLoop: true,
	}))
	.withPlugin(createInputPlugin({
		actions: {
			panUp: { keys: ['w', 'ArrowUp'] },
			panDown: { keys: ['s', 'ArrowDown'] },
			panLeft: { keys: ['a', 'ArrowLeft'] },
			panRight: { keys: ['d', 'ArrowRight'] },
		},
	}))
	.withComponentTypes<{
		orbit: { radius: number; speed: number; angle: number };
		celestialBody: { name: string; color: number; radius: number };
	}>()
	.withEventTypes<{
		bodyDestroyed: { name: string; childCount: number };
	}>()
	.withResource('camera', { x: 0, y: 0 })
	.build();

type ECS = typeof ecs;

// ==================== Orbit System ====================
// Updates localTransform based on orbital angle and radius
ecs.addSystem('orbit')
	.inPhase('fixedUpdate')
	.setProcessEach({ with: ['orbit', 'localTransform'], mutates: ['orbit', 'localTransform'] }, ({ entity, dt }) => {
		const { orbit, localTransform } = entity.components;

		// Update orbital angle
		orbit.angle += orbit.speed * dt;

		// Compute local position from orbit
		localTransform.x = Math.cos(orbit.angle) * orbit.radius;
		localTransform.y = Math.sin(orbit.angle) * orbit.radius;
	});

// ==================== Camera System ====================
// Scrolls the view based on input actions
ecs.addSystem('camera')
	.inPhase('preUpdate')
	.withResources(['inputState', 'camera', 'rootContainer'])
	.setProcess(({ dt, resources: { inputState: input, camera, rootContainer } }) => {

		const scrollSpeed = 400;

		if (input.actions.isActive('panUp')) camera.y += scrollSpeed * dt;
		if (input.actions.isActive('panDown')) camera.y -= scrollSpeed * dt;
		if (input.actions.isActive('panLeft')) camera.x += scrollSpeed * dt;
		if (input.actions.isActive('panRight')) camera.x -= scrollSpeed * dt;

		rootContainer.position.set(camera.x, camera.y);
	});

// ==================== Initialize System ====================
ecs.addSystem('initialize')
	.setOnInitialize((ecs) => {
		const pixiApp = ecs.getResource('pixiApp');

		// Add reactive query to auto-update hierarchy display.
		// Callbacks are deferred to a microtask so the display rebuilds after
		// all synchronous entity removals have completed (the onExit hook fires
		// via beforeEntityRemoved, before the entity is actually deleted).
		let displayUpdateScheduled = false;
		function scheduleDisplayUpdate(): void {
			if (displayUpdateScheduled) return;
			displayUpdateScheduled = true;
			queueMicrotask(() => {
				displayUpdateScheduled = false;
				updateHierarchyDisplay(ecs);
			});
		}

		ecs.addReactiveQuery('celestialBodies', {
			with: ['celestialBody'],
			onEnter: scheduleDisplayUpdate,
			onExit: scheduleDisplayUpdate,
		});

		const centerX = pixiApp.screen.width / 2;
		const centerY = pixiApp.screen.height / 2;

		// Create the sun (root entity)
		const sunGraphics = createCelestialGraphics(SOLAR_SYSTEM.sun.color, SOLAR_SYSTEM.sun.radius);

		const sun = ecs.spawn({
			...createGraphicsComponents(sunGraphics, { x: centerX, y: centerY }),
			celestialBody: { ...SOLAR_SYSTEM.sun },
		});

		// Register click handler for sun
		registerClickHandler(sunGraphics, sun.id, ecs);

		// Create planets as children of sun
		for (const planetData of SOLAR_SYSTEM.planets) {
			const planetGraphics = createCelestialGraphics(planetData.color, planetData.radius);

			const planet = ecs.spawnChild(sun.id, {
				...createGraphicsComponents(planetGraphics),
				orbit: {
					radius: planetData.orbitRadius,
					speed: planetData.orbitSpeed,
					angle: Math.random() * Math.PI * 2,
				},
				celestialBody: {
					name: planetData.name,
					color: planetData.color,
					radius: planetData.radius,
				},
			});

			registerClickHandler(planetGraphics, planet.id, ecs);

			// Create moons as children of planet
			for (const moonData of planetData.moons) {
				const moonGraphics = createCelestialGraphics(moonData.color, moonData.radius);

				const moon = ecs.spawnChild(planet.id, {
					...createGraphicsComponents(moonGraphics),
					orbit: {
						radius: moonData.orbitRadius,
						speed: moonData.orbitSpeed,
						angle: Math.random() * Math.PI * 2,
					},
					celestialBody: {
						name: moonData.name,
						color: moonData.color,
						radius: moonData.radius,
					},
				});

				registerClickHandler(moonGraphics, moon.id, ecs);
			}
		}
	});

// ==================== Helper Functions ====================

function createCelestialGraphics(color: number, radius: number): Graphics {
	const graphics = new Graphics();

	// Draw invisible hit area for small bodies (minimum 15px radius for easier clicking)
	const hitRadius = Math.max(radius, 15);
	if (hitRadius > radius) {
		graphics.circle(0, 0, hitRadius);
		graphics.fill({ color: 0x000000, alpha: 0 });
	}

	// Draw the visible body
	graphics.circle(0, 0, radius);
	graphics.fill(color);

	// Add glow effect for larger bodies
	if (radius > 15) {
		graphics.circle(0, 0, radius + 5);
		graphics.fill({ color, alpha: 0.3 });
	}

	graphics.eventMode = 'static';
	graphics.cursor = 'pointer';

	return graphics;
}

function registerClickHandler(
	graphics: Graphics,
	entityId: number,
	world: ECS
): void {
	graphics.on('pointerdown', () => {
		if (!world.entityManager.getEntity(entityId)) return;

		const celestialBody = world.getComponent(entityId, 'celestialBody');
		if (!celestialBody) return;

		const descendants = world.getDescendants(entityId);

		world.eventBus.publish('bodyDestroyed', {
			name: celestialBody.name,
			childCount: descendants.length,
		});

		// cascade: true (default) removes all children
		world.removeEntity(entityId);
	});
}

function centerOnEntity(entityId: number, world: ECS): void {
	if (!world.entityManager.getEntity(entityId)) return;

	const worldTransform = world.getComponent(entityId, 'worldTransform');
	if (!worldTransform) return;

	const pixiApp = world.getResource('pixiApp');
	const camera = world.getResource('camera');

	camera.x = pixiApp.screen.width / 2 - worldTransform.x;
	camera.y = pixiApp.screen.height / 2 - worldTransform.y;
}

function updateHierarchyDisplay(world: ECS): void {
	const treeEl = document.getElementById('hierarchy-tree');
	if (!treeEl) return;

	treeEl.innerHTML = '';

	const roots = world.getRootEntities();

	if (roots.length === 0) {
		treeEl.textContent = '(empty - all bodies destroyed)';
		return;
	}

	for (const rootId of roots) {
		buildTreeNodes(rootId, 0, treeEl, world);
	}
}

function createTreeItem(
	entityId: number,
	name: string,
	depth: number,
	world: ECS
): HTMLElement {
	const item = document.createElement('div');
	item.style.cursor = 'pointer';
	item.style.padding = `2px 4px 2px ${depth * 16 + 4}px`;

	const prefix = depth === 0 ? '' : '- ';
	item.textContent = `${prefix}${name}`;

	item.addEventListener('mouseenter', () => {
		item.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
	});
	item.addEventListener('mouseleave', () => {
		item.style.backgroundColor = 'transparent';
	});
	item.addEventListener('click', () => {
		centerOnEntity(entityId, world);
	});

	return item;
}

function buildTreeNodes(
	entityId: number,
	depth: number,
	container: HTMLElement,
	world: ECS
): void {
	const celestialBody = world.getComponent(entityId, 'celestialBody');
	if (!celestialBody) return;

	const item = createTreeItem(entityId, celestialBody.name, depth, world);
	container.appendChild(item);

	const children = world.getChildren(entityId);
	for (const childId of children) {
		buildTreeNodes(childId, depth + 1, container, world);
	}
}

// ==================== Event Handlers ====================

ecs.on('bodyDestroyed', (data) => {
	const infoPanel = document.getElementById('info-panel');
	if (infoPanel) {
		const childText = data.childCount > 0
			? ` and ${data.childCount} child${data.childCount > 1 ? 'ren' : ''}`
			: '';
		infoPanel.textContent = `Destroyed ${data.name}${childText}. WASD/Arrows to scroll, click to destroy.`;
	}
});

// ==================== Start ====================

await ecs.initialize();
