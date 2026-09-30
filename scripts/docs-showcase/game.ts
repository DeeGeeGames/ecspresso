import ECSpresso from 'ecspresso';

type Components = {
	position: { x: number; y: number };
	velocity: { x: number; y: number };
	health: { value: number };
};

// The runner owns each registered world and disposes it on restart.
export function createDemo(registerWorld: (world: { dispose(): Promise<void> }) => void) {
	const world = ECSpresso.create()
		.withComponentTypes<Components>()
		.withResource('input', { x: 0, y: 0 })
		.withResource('settings', { speed: 160 })
		.withResource('game', {
			time: 0, score: 0, immunity: 0, phase: 'playing',
			coins: [
				{ x: 90, y: 70 }, { x: 210, y: 60 }, { x: 420, y: 65 }, { x: 550, y: 80 },
				{ x: 80, y: 285 }, { x: 220, y: 300 }, { x: 430, y: 290 }, { x: 555, y: 280 },
			],
			hazards: [{ x: 170, y: 175 }, { x: 470, y: 180 }, { x: 320, y: 85 }],
		})
		.build();
	registerWorld(world);

	// Try changing speed above, then press Run.
	world.addSystem('movement')
		.withResources(['input', 'settings', 'game'])
		.addQuery('moving', {
			with: ['position', 'velocity'],
			mutates: ['position'],
		})
		.setProcess(({ queries, resources, dt }) => {
			queries.moving.forEach(entity => {
				if (resources.game.phase !== 'playing') return;
				const { position } = entity.components;
				position.x = Math.max(18, Math.min(622,
					position.x + resources.input.x * resources.settings.speed * dt));
				position.y = Math.max(18, Math.min(342,
					position.y + resources.input.y * resources.settings.speed * dt));
			});
		});

	world.addSystem('collect-and-dodge')
		.withResources(['game'])
		.addQuery('players', { with: ['position', 'health'], mutates: ['health'] })
		.setProcess(({ queries, resources: { game }, dt }) => {
			queries.players.forEach(entity => {
				if (game.phase !== 'playing') return;
				game.time += dt;
				game.immunity = Math.max(0, game.immunity - dt);
				game.hazards = [
					{ x: 170 + Math.sin(game.time * 0.9) * 75, y: 180 + Math.cos(game.time) * 80 },
					{ x: 470 + Math.cos(game.time * 0.8) * 65, y: 180 + Math.sin(game.time) * 90 },
					{ x: 320 + Math.sin(game.time * 0.7) * 140, y: 95 + Math.sin(game.time * 1.2) * 30 },
				];
				const { position, health } = entity.components;
				const distance = (point: { x: number; y: number }) =>
					Math.hypot(point.x - position.x, point.y - position.y);
				const remaining = game.coins.filter(coin => distance(coin) > 23);
				game.score += game.coins.length - remaining.length;
				game.coins = remaining;
				const hit = game.immunity === 0 && game.hazards.some(hazard => distance(hazard) < 25);
				health.value -= Number(hit);
				game.immunity = hit ? 1.5 : game.immunity;
				game.phase = health.value <= 0 ? 'lost' : game.coins.length === 0 ? 'won' : 'playing';
			});
		});

	return {
		world,
		start() {
			world.spawn({ position: { x: 320, y: 180 },
				velocity: { x: 0, y: 0 }, health: { value: 3 } });
		},
		setInput(x: number, y: number) {
			Object.assign(world.getResource('input'), { x, y });
		},
		read() {
			const { position, health } = world.getSingleton(['position', 'health']).components;
			const game = world.getResource('game');
			return { player: { ...position }, health: health.value, ...game };
		},
	};
}
