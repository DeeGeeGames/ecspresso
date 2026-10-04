import {
	BoxGeometry,
	ConeGeometry,
	CylinderGeometry,
	DirectionalLight,
	DoubleSide,
	GridHelper,
	Group,
	Mesh,
	MeshBasicMaterial,
	MeshLambertMaterial,
	MeshPhongMaterial,
	PlaneGeometry,
	SphereGeometry,
	SpotLight,
	Vector3,
	AdditiveBlending,
	Scene
} from 'three';
import type { World } from './types';

// Helper to create a simple ground plane
export function createGround() {
	const groundGeometry = new PlaneGeometry(1000, 1000);
	const groundMaterial = new MeshLambertMaterial({
		color: 0x3a773a,
		side: DoubleSide
	});
	const ground = new Mesh(groundGeometry, groundMaterial);
	ground.rotation.x = Math.PI / 2;
	ground.position.y = 0;
	ground.receiveShadow = true;

	// Add a grid helper for visual reference
	const grid = new GridHelper(1000, 100, 0x000000, 0x888888);
	grid.position.y = 0.1;

	const groundGroup = new Group();
	groundGroup.add(ground);
	groundGroup.add(grid);

	return groundGroup;
}

// Helper to create a simple skybox
export function createSkybox() {
	const skyGeometry = new SphereGeometry(500, 32, 32);
	const skyMaterial = new MeshBasicMaterial({
		color: 0x87ceeb,
		side: DoubleSide
	});
	const sky = new Mesh(skyGeometry, skyMaterial);
	return sky;
}

// Helper to create the player turret
export function createTurret() {
	const group = new Group();

	// Base (cylinder)
	const baseGeometry = new CylinderGeometry(5, 5, 2, 32);
	const baseMaterial = new MeshPhongMaterial({ color: 0x555555 });
	const base = new Mesh(baseGeometry, baseMaterial);
	base.position.y = 1;
	base.castShadow = true;
	base.receiveShadow = true;

	// Rotating platform (slightly smaller cylinder)
	const platformGeometry = new CylinderGeometry(4, 4, 1.5, 32);
	const platformMaterial = new MeshPhongMaterial({ color: 0x777777 });
	const platform = new Mesh(platformGeometry, platformMaterial);
	platform.position.y = 2.5;
	platform.castShadow = true;
	platform.receiveShadow = true;

	// Gun barrel (long box)
	const barrelGeometry = new BoxGeometry(1, 1, 10);
	const barrelMaterial = new MeshPhongMaterial({ color: 0x333333 });
	const barrel = new Mesh(barrelGeometry, barrelMaterial);
	barrel.position.z = 5;
	barrel.position.y = 3;
	barrel.castShadow = true;
	barrel.receiveShadow = true;

	group.add(base);
	group.add(platform);
	group.add(barrel);

	return group;
}

// Helper to create a ground enemy
export function createGroundEnemy() {
	const group = new Group();

	// Body (box)
	const bodyGeometry = new BoxGeometry(3, 2, 5);
	const bodyMaterial = new MeshPhongMaterial({ color: 0x8b0000 });
	const body = new Mesh(bodyGeometry, bodyMaterial);
	body.position.y = 1.5;
	body.castShadow = true;
	body.receiveShadow = true;

	// Wheels (cylinders)
	const wheelGeometry = new CylinderGeometry(0.75, 0.75, 0.5, 16);
	const wheelMaterial = new MeshPhongMaterial({ color: 0x222222 });

	// Front left wheel
	const wheelFL = new Mesh(wheelGeometry, wheelMaterial);
	wheelFL.rotation.z = Math.PI / 2;
	wheelFL.position.set(-1.75, 0.75, 1.5);

	// Front right wheel
	const wheelFR = new Mesh(wheelGeometry, wheelMaterial);
	wheelFR.rotation.z = Math.PI / 2;
	wheelFR.position.set(1.75, 0.75, 1.5);

	// Back left wheel
	const wheelBL = new Mesh(wheelGeometry, wheelMaterial);
	wheelBL.rotation.z = Math.PI / 2;
	wheelBL.position.set(-1.75, 0.75, -1.5);

	// Back right wheel
	const wheelBR = new Mesh(wheelGeometry, wheelMaterial);
	wheelBR.rotation.z = Math.PI / 2;
	wheelBR.position.set(1.75, 0.75, -1.5);

	// Turret (smaller box)
	const turretGeometry = new BoxGeometry(2, 1, 2);
	const turretMaterial = new MeshPhongMaterial({ color: 0xaa0000 });
	const turret = new Mesh(turretGeometry, turretMaterial);
	turret.position.y = 3;
	turret.castShadow = true;

	group.add(body, wheelFL, wheelFR, wheelBL, wheelBR, turret);

	return group;
}

// Helper to create an air enemy
export function createAirEnemy() {
	const group = new Group();

	// Body (sphere)
	const bodyGeometry = new SphereGeometry(1.5, 16, 16);
	const bodyMaterial = new MeshPhongMaterial({ color: 0x0000aa });
	const body = new Mesh(bodyGeometry, bodyMaterial);
	body.castShadow = true;

	// Wings (boxes)
	const wingGeometry = new BoxGeometry(6, 0.2, 1.5);
	const wingMaterial = new MeshPhongMaterial({ color: 0x0000dd });
	const wings = new Mesh(wingGeometry, wingMaterial);
	wings.castShadow = true;

	// Tail (cone)
	const tailGeometry = new ConeGeometry(0.5, 2, 16);
	const tailMaterial = new MeshPhongMaterial({ color: 0x0000dd });
	const tail = new Mesh(tailGeometry, tailMaterial);
	tail.rotation.x = Math.PI / 2;
	tail.position.z = -2;
	tail.castShadow = true;

	group.add(body, wings, tail);

	return group;
}

// Helper to create a projectile
export function createProjectile() {
	const group = new Group();

	// Main projectile sphere
	const geometry = new SphereGeometry(1.5, 16, 16);
	const material = new MeshPhongMaterial({
		color: 0xff0000,
		emissive: 0xff5500,
		emissiveIntensity: 2.0
	});
	const projectile = new Mesh(geometry, material);
	projectile.castShadow = true;

	// Add a trailing effect
	for (let i = 1; i <= 5; i++) {
		const trailSize = 1.5 - (i * 0.2);
		const trailGeometry = new SphereGeometry(trailSize, 12, 12);
		const trailOpacity = 1 - (i * 0.15);
		const trailMaterial = new MeshBasicMaterial({
			color: 0xff9900,
			transparent: true,
			opacity: trailOpacity
		});
		const trailPart = new Mesh(trailGeometry, trailMaterial);
		trailPart.position.z = i * 2; // Position behind the main projectile
		group.add(trailPart);
	}

	// Add the main projectile to the group
	group.add(projectile);

	return group;
}

// Helper to set up lighting for the scene
export function setupLighting(scene: Scene) {
	// Ambient light (overall scene illumination)
	const ambientLight = new DirectionalLight(0xffffff, 0.5);
	ambientLight.position.set(0, 100, 0);

	// Directional light (sun-like)
	const directionalLight = new DirectionalLight(0xffffff, 0.8);
	directionalLight.position.set(50, 200, 100);
	directionalLight.castShadow = true;

	// Set up shadow properties
	directionalLight.shadow.mapSize.width = 2048;
	directionalLight.shadow.mapSize.height = 2048;
	directionalLight.shadow.camera.near = 0.5;
	directionalLight.shadow.camera.far = 500;
	directionalLight.shadow.camera.left = -100;
	directionalLight.shadow.camera.right = 100;
	directionalLight.shadow.camera.top = 100;
	directionalLight.shadow.camera.bottom = -100;

	// Player spotlight
	const spotLight = new SpotLight(0xffffff, 1.5);
	spotLight.position.set(0, 15, 0);
	spotLight.angle = Math.PI / 4;
	spotLight.penumbra = 0.1;
	spotLight.decay = 2;
	spotLight.distance = 200;
	spotLight.castShadow = true;

	scene.add(ambientLight, directionalLight, spotLight);

	return { ambientLight, directionalLight, spotLight };
}

// Create radar display mesh for UI
export function createRadarDisplay() {
	const radarGeometry = new PlaneGeometry(20, 20);
	const radarMaterial = new MeshBasicMaterial({
		color: 0x003300, // Darker green background
		transparent: true,
		opacity: 0.9 // More opaque
	});
	const radar = new Mesh(radarGeometry, radarMaterial);
	radar.rotation.x = -Math.PI / 2;
	radar.position.set(0, 0.2, 0);

	// Add grid lines for better visual reference
	const gridGeometry = new GridHelper(20, 10, 0x00ff00, 0x005500);
	gridGeometry.rotation.x = Math.PI / 2;
	gridGeometry.position.y = 0.25;

	// Center point
	const centerGeometry = new SphereGeometry(0.5, 8, 8);
	const centerMaterial = new MeshBasicMaterial({ color: 0x00ff00 });
	const center = new Mesh(centerGeometry, centerMaterial);
	center.position.set(0, 0.3, 0);

	// Border for radar display
	const borderGeometry = new PlaneGeometry(20.5, 20.5);
	const borderMaterial = new MeshBasicMaterial({
		color: 0x00ff00,
		transparent: true,
		opacity: 0.7
	});
	const border = new Mesh(borderGeometry, borderMaterial);
	border.position.y = 0.1;
	border.rotation.x = -Math.PI / 2;

	// Group for radar and center
	const radarGroup = new Group();
	radarGroup.add(border);
	radarGroup.add(radar);
	radarGroup.add(gridGeometry);
	radarGroup.add(center);
	radarGroup.name = 'radar'; // Add name for easy identification

	return radarGroup;
}

// Helper to create a radar blip for an enemy
export function createRadarBlip(type: 'ground' | 'air') {
	// Larger blip size
	const geometry = new SphereGeometry(0.6, 8, 8);

	// Brighter colors with emissive property
	const material = new MeshPhongMaterial({
		color: type === 'ground' ? 0xff3333 : 0x3333ff,
		emissive: type === 'ground' ? 0xff0000 : 0x0000ff,
		emissiveIntensity: 1.5,
		shininess: 100
	});

	const blip = new Mesh(geometry, material);
	blip.position.y = 0.5; // Raised higher above radar

	return blip;
}

// Helper to calculate direction from player to enemy
export function getDirectionToEnemy(playerPos: Vector3, enemyPos: Vector3): Vector3 {
	return new Vector3(
		enemyPos.x - playerPos.x,
		enemyPos.y - playerPos.y,
		enemyPos.z - playerPos.z
	).normalize();
}

// Helper to calculate distance between two points
export function getDistance(pointA: Vector3, pointB: Vector3): number {
	return pointA.distanceTo(pointB);
}

// Helper to calculate angle between player's forward direction and enemy direction
export function getAngleToEnemy(playerForward: Vector3, enemyDirection: Vector3): number {
	// Project vectors onto the XZ plane for a 2D angle
	const playerForwardXZ = new Vector3(playerForward.x, 0, playerForward.z).normalize();
	const enemyDirectionXZ = new Vector3(enemyDirection.x, 0, enemyDirection.z).normalize();

	// Calculate the signed angle
	let angle = Math.atan2(
		enemyDirectionXZ.x * playerForwardXZ.z - enemyDirectionXZ.z * playerForwardXZ.x,
		enemyDirectionXZ.x * playerForwardXZ.x + enemyDirectionXZ.z * playerForwardXZ.z
	);

	return angle;
}

// Helper to create a DOM-based UI element
export function createUIElement(id: string, text: string, x: string, y: string): HTMLElement {
	const element = document.createElement('div');
	element.id = id;
	element.innerText = text;
	element.style.position = 'absolute';
	element.style.left = x;
	element.style.top = y;
	element.style.color = 'white';
	element.style.fontFamily = 'Arial, sans-serif';
	element.style.fontSize = '18px';
	element.style.padding = '10px';
	element.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
	element.style.borderRadius = '5px';
	element.style.userSelect = 'none';

	document.getElementById('game-container')?.appendChild(element);
	return element;
}

// Helper to update UI elements with game state info
export function updateUI(ecs: World) {
	const uiElements = ecs.getResource('uiElements');
	const gameState = ecs.getResource('gameState');

	if (uiElements.scoreElement) {
		uiElements.scoreElement.innerText = `Score: ${gameState.score}`;
	}

	if (uiElements.waveElement) {
		uiElements.waveElement.innerText = `Wave: ${gameState.wave}`;
	}

	const playerEntities = ecs.entityManager.getEntitiesWithQuery(['player']);
	const playerEntity = playerEntities[0];
	if (playerEntity && uiElements.healthElement) {
		const player = playerEntity.components.player;
		uiElements.healthElement.innerText = `Health: ${player.health}/${player.maxHealth}`;
	}
}

// Helper to create an explosion effect at a given position
export function createExplosion() {
	const explosionGroup = new Group();

	const particles = Array.from({ length: 20 }, function createParticle() {
		const size = 0.5 + Math.random() * 1.5;
		const geometry = new SphereGeometry(size, 8, 8);
		const material = new MeshBasicMaterial({
			color: Math.random() > 0.5 ? 0xff5500 : 0xffaa00,
			transparent: true,
			opacity: 0.8,
			blending: AdditiveBlending
		});

		const particle = new Mesh(geometry, material);

		// Random position offset
		const distance = Math.random() * 5;
		const angle1 = Math.random() * Math.PI * 2;
		const angle2 = Math.random() * Math.PI * 2;

		particle.position.x = Math.sin(angle1) * Math.cos(angle2) * distance;
		particle.position.y = Math.sin(angle1) * Math.sin(angle2) * distance;
		particle.position.z = Math.cos(angle1) * distance;

		// Random velocity
		const speed = 5 + Math.random() * 10;
		const direction = new Vector3(
			particle.position.x,
			particle.position.y,
			particle.position.z
		).normalize();

		explosionGroup.add(particle);
		return {
			mesh: particle,
			velocity: direction.multiplyScalar(speed),
			drag: 0.9 + Math.random() * 0.1,
			lifetime: 1 + Math.random(),
		};
	});

	return { group: explosionGroup, particles, elapsed: 0 };
}

export function updateExplosion(explosion: ReturnType<typeof createExplosion>, dt: number) {
	explosion.elapsed += dt;
	for (const particle of explosion.particles) {
		if (particle.lifetime <= 0) continue;
		particle.mesh.position.addScaledVector(particle.velocity, dt);
		particle.velocity.multiplyScalar(Math.pow(particle.drag, dt * 60));
		particle.lifetime -= dt;
		particle.mesh.material.opacity = Math.max(0, particle.lifetime);
	}
	return explosion.elapsed >= 2 || explosion.particles.every(particle => particle.lifetime <= 0);
}

export function disposeExplosion(explosion: ReturnType<typeof createExplosion>) {
	for (const { mesh } of explosion.particles) {
		mesh.geometry.dispose();
		mesh.material.dispose();
	}
}
