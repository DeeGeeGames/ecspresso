import ECSpresso from 'ecspresso';

// Run one update per button press so writes and no-ops are easy to compare.
export function createLesson() {
	const world = ECSpresso.create()
		.withComponentTypes<{ counter: { value: number } }>()
		.build();
	const counter = world.spawn({ counter: { value: 0 } });
	let shouldWrite = false;
	let observedUpdates = 0;

	world.addSystem('producer')
		.setProcessEach({ with: ['counter'], mutates: ['counter'] }, ({ entity }) => {
			if (!shouldWrite) return false; // Skip the automatic change mark.
			entity.components.counter.value += 1;
		});

	// The consumer runs after the producer, in the same update.
	world.addSystem('consumer')
		.setProcessEach({ with: ['counter'], changed: ['counter'] }, () => {
			observedUpdates += 1;
		});

	// Spawning is a change too. Establish the initial baseline first.
	world.update(0);
	observedUpdates = 0;

	return {
		world,
		step(write: boolean) {
			shouldWrite = write;
			world.update(0);
			return { value: counter.components.counter.value, observedUpdates };
		},
	};
}
