// Microbench: empty-handlers fast path of EventBus.publish.
// Useful for evaluating the cost of the rest-then-destructure signature.
import EventBus from '../src/event-bus';

interface Events { ping: { x: number }; void: void; }

const bus = new EventBus<Events>();
const payload = { x: 1 };
const N = 50_000_000;

// Warmup
for (let i = 0; i < 1_000_000; i++) bus.publish('ping', payload);

for (let run = 1; run <= 3; run++) {
	const t0 = performance.now();
	for (let i = 0; i < N; i++) bus.publish('ping', payload);
	const t1 = performance.now();
	const ns = (t1 - t0) * 1e6 / N;
	console.log(`run ${run}: ${(t1 - t0).toFixed(1)} ms over ${N} calls => ${ns.toFixed(2)} ns/call`);
}
