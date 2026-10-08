# Testing application behavior

Use validation proportional to the changed boundary.

## Validation layers

- Typechecking validates API use, inference, and the shallow access constraints
  created by declarations such as `mutates`.
- Small-world simulation validates behavior, ordering, change propagation,
  events, and structural commands.
- Rendered observation checks the presentation adapter in the relevant game state.
- Playtesting evaluates input responsiveness, presentation, and feel.

Do not treat one layer as evidence for another. A successful typecheck does not
prove system order, and a simulation test does not assess game feel.

## Small-world recipe

1. Construct the smallest world containing the relevant component, event, and
   resource types.
2. Register the system under test and its immediate producer or consumer when
   the behavior crosses a system boundary.
3. Initialize the world when plugins, resources, assets, or hooks require it.
4. Spawn only the entities required for the behavior.
5. Trigger the real execution path: publish an event for synchronous handlers,
   advance explicit time for scheduled processing, and cross the command playback
   boundary for deferred structure. Assert state, events, and entity visibility.
6. Dispose the world in `finally`, including when assertions fail.

For movement, advance known time and assert the resulting position. For an
interaction, include the immediate consumer—for example, movement followed by
collision—and assert both the state change and emitted event or command effect.

Fixed-update tests should configure the timestep and advance enough accumulated
time to make the number of fixed steps explicit. When validating `changed`
queries, account for spawn marks and test a later tick when necessary to isolate
the producer's mark.

Prefer one boundary-level regression test over several tests that only repeat
static configuration or implementation details.

## Event-only damage

This complete Bun test uses the public health plugin. Its initialized system
handles `damage` synchronously; no `update()` is needed to observe health or
`entityDied`. Death removal is an application policy, not health-plugin behavior.

```typescript
import { expect, test } from 'bun:test';
import ECSpresso from 'ecspresso';
import { createHealthPlugin } from 'ecspresso/plugins/combat/health';

test('damage and death are synchronous without a frame', async () => {
	const world = ECSpresso.create().withPlugin(createHealthPlugin()).build();
	const deaths: number[] = [];
	world.addSystem('death-response').setEventHandlers({
		entityDied({ data }) { deaths.push(data.entityId); },
	});
	try {
		await world.initialize();
		const target = world.spawn({ health: { current: 10, max: 10 } });
		world.eventBus.publish('damage', { entityId: target.id, amount: 3 });
		expect(target.components.health.current).toBe(7);
		expect(deaths).toEqual([]);
		world.eventBus.publish('damage', { entityId: target.id, amount: 7 });
		world.eventBus.publish('damage', { entityId: target.id, amount: 1 });
		expect(target.components.health.current).toBe(0);
		expect(deaths).toEqual([target.id]);
		expect(world.getEntity(target.id)).toBeDefined(); // Health does not remove it.
	} finally {
		await world.dispose();
	}
});
```

This establishes damage/death delivery and repeated damage after death. It does
not establish that collision publishes damage, a health bar updates, hit feedback
survives renderer synchronization, or the interaction feels responsive.

## Combat crossing boundaries

This fixture uses real collision detection, projectile damage forwarding, and
health handling. A small application handler supplies death removal. Homing runs
in `fixedUpdate`; transform propagation and collision use their default
`postUpdate` phase. The first half-step establishes baseline world transforms; the next completes
one fixed step. Current transform propagation processes all transforms, so this
fixture does not establish `changed` consumption or correct change publication.
Collision then publishes
hit/damage/death synchronously. A system ordered after collision still sees the
entities; a render-phase probe sees removal after command playback.

```typescript
import { expect, test } from 'bun:test';
import ECSpresso from 'ecspresso';
import { createHealthPlugin } from 'ecspresso/plugins/combat/health';
import {
	createProjectilePlugin, createProjectile, createProjectileTarget,
} from 'ecspresso/plugins/combat/projectile';
import {
	createCollisionPlugin, defineCollisionLayers, createCircleCollider, collisionSystems,
} from 'ecspresso/plugins/physics/collision';
import { createTransformPlugin, createTransform } from 'ecspresso/plugins/spatial/transform';

test('collision delivers damage and removal becomes visible after postUpdate', async () => {
	const layers = defineCollisionLayers({ shot: ['target'], target: ['shot'] });
	const world = ECSpresso.create()
		.withFixedTimestep(0.1)
		.withPlugin(createTransformPlugin())
		.withPlugin(createCollisionPlugin({ layers }))
		.withPlugin(createHealthPlugin())
		.withPlugin(createProjectilePlugin<'combat', keyof typeof layers>({ phase: 'fixedUpdate' }))
		.build();
	const hits: number[] = [];
	const deaths: number[] = [];
	world.addSystem('death-response').setEventHandlers({
		projectileHit({ data }) { hits.push(data.targetId); },
		entityDied({ data, ecs }) {
			expect(ecs.getComponent(data.entityId, 'health')?.current).toBe(0);
			deaths.push(data.entityId);
			ecs.commands.removeEntity(data.entityId); // Application-owned death policy.
		},
	});
	try {
		await world.initialize();
		const source = world.spawn({});
		const target = world.spawn({
			...createTransform(10, 0), ...createCircleCollider(1), ...layers.target(),
			health: { current: 5, max: 5 },
		});
		const shot = world.spawn({
			...createTransform(0, 0), ...createCircleCollider(1), ...layers.shot(),
			...createProjectile(5, 100, source.id), ...createProjectileTarget(target.id),
		});
		const visibility: string[] = [];
		world.addSystem('before-playback').inPhase('postUpdate').after(collisionSystems.detect)
			.setProcess(({ ecs }) => {
				if (deaths.length === 0) return;
				expect(ecs.getEntity(target.id)).toBeDefined();
				expect(ecs.getEntity(shot.id)).toBeDefined();
				visibility.push('queued');
			});
		world.addSystem('after-playback').inPhase('render').setProcess(({ ecs }) => {
			if (deaths.length === 0) return;
			expect(ecs.getEntity(target.id)).toBeUndefined();
			expect(ecs.getEntity(shot.id)).toBeUndefined();
			visibility.push('removed');
		});
		world.update(0.05); // No fixed step yet; establish baseline world transforms.
		expect(shot.components.localTransform.x).toBe(0);
		expect(hits).toEqual([]);
		world.update(0.05); // Accumulated 0.1s: one homing step reaches the target.
		expect(hits).toEqual([target.id]);
		expect(deaths).toEqual([target.id]);
		expect(visibility).toEqual(['queued', 'removed']);
	} finally {
		await world.dispose();
	}
});
```

The render-phase probe is an ECS visibility assertion, not rendered evidence: it
creates no canvas, sprite, or health bar. When feedback is part of the outcome,
exercise the application's actual renderer with this death response. Observe
whether an effect attached to the removed entity needs a separately owned visual
entity, whether synchronization overwrites it, and whether it cleans up on exit.
Then reach the combat state through normal controls and observe legibility and
responsiveness at the intended pace. Choose scenario-specific criteria; do not
invent a universal latency threshold or substitute a test for owner acceptance
of feel. For temporary feedback, select [transient responses](recipes.md#transient-responses).

### Reproducing the examples

In the ECSpresso repository, the two blocks above match
`scripts/skill-examples/event-only.test.ts` and
`scripts/skill-examples/combat-boundary.test.ts`. Documentation checks guard that
alignment. From the repository root:

```sh
bun test scripts/skill-examples
bun run check:types
bun test scripts/skill-documentation.test.ts
bun run check
```

These commands use repository source aliases for public `ecspresso` imports.
They validate current source API use, not built or published package exports.
To check built exports separately, use this isolated consumer procedure from the
repository root. Copy the build instead of linking the repository: Bun can find
repository source aliases inside a symlinked package, mixing source and built
modules. The subshell's trap removes its temporary directory on exit.

```sh
bun run build
(
  repo=$(pwd)
  consumer=$(mktemp -d)
  trap 'rm -rf "$consumer"' EXIT
  cp scripts/skill-examples/*.test.ts "$consumer/"
  mkdir -p "$consumer/node_modules/ecspresso"
  cp package.json "$consumer/node_modules/ecspresso/"
  cp -R dist "$consumer/node_modules/ecspresso/"
  ln -s "$repo/node_modules/@types" "$consumer/node_modules/@types"
  cat > "$consumer/tsconfig.json" <<'JSON'
{"compilerOptions":{"strict":true,"skipLibCheck":true,"module":"ESNext","moduleResolution":"bundler","target":"ESNext","types":["bun"],"noEmit":true}}
JSON
  cd "$consumer"
  bun test . && "$repo/node_modules/.bin/tsc" --noEmit -p tsconfig.json
)
```

As in the repository typecheck, `skipLibCheck` skips dependency declaration
internals; both fixtures are typechecked. This checks the local build, not a
registry publication. Consumer projects can
use their installed version and normal typecheck command instead.

## Completion evidence

Report each relevant criterion as **passed**, **failed**, or **unmeasured**, with
the scenario and command/observation supporting it. For example:

| Criterion | Evidence | Status |
|---|---|---|
| A lethal projectile delivers one death and deferred removal | Combat fixture with two 0.05s updates | Passed when the test passes |
| Hit flash remains visible through renderer synchronization | Actual adapter in combat state, including expiry and repeat hits | Unmeasured until observed |
| Player can distinguish a hit at intended combat pace | Focused normal-control play and owner judgment | Unmeasured until played/accepted |

A failed check needs repair or an explicit unresolved finding. Unmeasured
required rendered feedback means partial verification and an unmet acceptance
criterion even when simulation passes. Pure calculations can finish with unit
and type checks; browser evidence is unnecessary for those. State assertion,
rendered observation, playtesting, and owner acceptance are separate claims.
