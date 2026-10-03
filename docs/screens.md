# Screen Management

Manage game states/screens with transitions and overlay support:

```typescript
import type { ScreenDefinition } from 'ecspresso';

type Screens = {
  menu: ScreenDefinition<
    Record<string, never>,           // Config (passed when entering)
    { selectedOption: number }       // State (mutable during screen)
  >;
  gameplay: ScreenDefinition<
    { difficulty: string; level: number },
    { score: number; isPaused: boolean }
  >;
  pause: ScreenDefinition<Record<string, never>, Record<string, never>>;
};

const game = ECSpresso.create()
  .withComponentTypes<Components>()
  .withEventTypes<Events>()
  .withResourceTypes<Resources>()
  .withScreens(screens => screens
    .add('menu', {
      initialState: () => ({ selectedOption: 0 }),
      onEnter: () => console.log('Entered menu'),
      onExit: () => console.log('Left menu'),
    })
    .add('gameplay', {
      initialState: () => ({ score: 0, isPaused: false }),
      onEnter: (config) => console.log(`Starting level ${config.level}`),
      onResume: ({ state }) => console.log(`Resuming with ${state.score} points`),
      onExit: () => console.log('Gameplay ended'),
      requiredAssetGroups: ['level1'],
    })
    .add('pause', {
      initialState: () => ({}),
    })
  )
  .build();

await game.initialize();
await game.setScreen('menu', {});                     // Set initial screen
await game.setScreen('gameplay', { difficulty: 'hard', level: 1 }); // Transition
await game.pushScreen('pause', {});                   // Push overlay
await game.popScreen();                               // Pop overlay

const current = game.getCurrentScreen();              // 'gameplay'
const config = game.getScreenConfig();                // { difficulty: 'hard', level: 1 }
const state = game.getScreenState();                  // { score: 0, isPaused: false }
game.updateScreenState({ score: 100 });
```

## Keep Screens Authoritative

Use the ECSpresso screen manager as the source of truth for navigation whenever
a view affects system activity, input routing, lifecycle, or back behavior.
This includes menu steps and settings pages, not only gameplay scenes.

A DOM, canvas, or renderer integration may cache view elements, but it should
show them from screen lifecycle hooks rather than track an independent current
screen:

```typescript
game.onScreenEnter('menu', () => showView('menu'));
game.onScreenEnter('modeSelect', () => showView('modeSelect'));
game.onScreenEnter('settings', ({ config }) => showSettings(config.returnTo));
game.onScreenResume('gameplay', () => showView('gameplay'));

// Settings preserves the previous screen and returns through the same stack.
const returnTo = game.getCurrentScreen();
if (returnTo !== null) {
  await game.pushScreen('settings', { returnTo });
  await game.popScreen();
}
```

Avoid a second UI-only router whose state can disagree with
`getCurrentScreen()`. That split commonly leaves gameplay systems or menu input
active behind the wrong view.

### Renderer Adapter Boundary

For a nontrivial UI, keep the renderer integration as a view adapter driven by
screen lifecycle hooks. The adapter may own presentation-only state such as
cached DOM or canvas objects, focus targets, prompt variants, animation state,
and retained views used to draw an overlay. It may also remember which view it
last presented when that value is needed only for presentation behavior such
as focus restoration or transition animation.

Navigation state stays in ECSpresso. The adapter should not maintain its own
screen stack, decide which application screen is active, or perform transitions
that bypass `setScreen`, `pushScreen`, and `popScreen`.

As the adapter grows, split screen-specific templates or view specifications by
feature and compose them in a small renderer runtime:

```typescript
const views = {
  menu: createMenuView(),
  settings: createSettingsView(),
  gameplay: createGameplayView(),
} as const;

function presentView(name: keyof typeof views): void {
  views[name].show();
  views[name].focusDefault();
}

game.onScreenEnter('menu', () => presentView('menu'));
game.onScreenEnter('settings', () => presentView('settings'));
game.onScreenEnter('gameplay', () => presentView('gameplay'));
game.onScreenResume('menu', () => presentView('menu'));
game.onScreenResume('settings', () => presentView('settings'));
game.onScreenResume('gameplay', () => presentView('gameplay'));
```

This separation is organizational: ECSpresso owns application navigation and
lifecycle, while the adapter owns how the current screen is presented.

## Extracted Screen Configurators

Use `ScreenConfiguratorFn` when a `.withScreens(...)` callback is extracted into a named helper:

```typescript
import type { ScreenConfiguratorFn, ScreenDefinition } from 'ecspresso';

type AppScreens = {
  playing: ScreenDefinition<{ level: number }>;
  pause: ScreenDefinition;
};

export const configureScreens: ScreenConfiguratorFn<AppScreens> = function configureScreens(screens) {
  return screens
    .add('playing', { initialState: config => config })
    .add('pause', { initialState: () => ({}) });
};

const game = ECSpresso.create()
  .withScreens(configureScreens)
  .build();
```

## Screen Hooks

### Screen state subscriptions

Use `onResourceChange('$screen', ...)` to observe the current screen and state.
Register before or after `initialize()`. Initialization establishes the first
snapshot without calling the subscriber.

```typescript
const game = ECSpresso.create()
  .withScreens(screens => screens
    .add('gameplay', { initialState: () => ({ score: 0 }) }))
  .build();

const offState = game.onResourceChange('$screen', (screen, previous) => {
  console.log(screen.current, screen.state, previous.state);
});

await game.initialize();
await game.setScreen('gameplay', {});
game.update(0); // Subscriber sees entry into gameplay.

game.updateScreenState('gameplay', current => ({ score: current.score + 1 }));
game.update(0); // Subscriber sees the new state and the previous state.

offState();
```

Screen updates and transitions notify at the end of the next `update()` call,
after render systems run. A running game loop performs this flush; the example
calls `update(0)` explicitly. Changes between flushes are batched into one
notification with the latest value. If the final shallow properties match the
previous snapshot, no notification fires. Use lifecycle hooks below when every
individual enter, resume, or exit matters.

Observation is shallow: `updateScreenState` replaces the state object and is
observable, while `getScreenState('gameplay').score += 1` mutates a nested value
and does not notify a `$screen` subscriber. Replace nested objects in the update
if their previous contents need to remain available to the callback; snapshots
retain nested references. Explicit `setResource`/`updateResource` calls notify
resource subscribers immediately, but screen updates use the frame flush.

### Screen lifecycle subscriptions

Subscribe to a specific screen entering, resuming, or exiting without writing inline `screenEnter` / `screenResume` / `screenExit` event guards. Multiple handlers can be registered for the same screen and fire in registration order. Each returns a disposer.

```typescript
const offEnter = game.onScreenEnter('gameplay', ({ config, ecs }) => {
  // Fires on setScreen('gameplay', ...) and pushScreen('gameplay', ...)
  console.log(`Starting level ${config.level}`);
  ecs.spawn({ player: true });
});

const offResume = game.onScreenResume('gameplay', ({ config, state, ecs }) => {
  // Fires after popScreen() restores gameplay as the current screen
  console.log(`Resuming level ${config.level} with score ${state.score}`);
  ecs.updateScreenState('gameplay', { isPaused: false });
});

const offExit = game.onScreenExit('gameplay', ({ ecs }) => {
  // Fires when leaving 'gameplay' via setScreen away or popScreen
  console.log('Gameplay ended');
});

// Later, if needed:
offEnter();
offResume();
offExit();
```

## Screen-Scoped Entities

Pass `{ scope: screenName }` to `spawn` or `spawnChild` to have the entity automatically removed when that screen exits. This replaces hand-maintained per-component teardown lists.

```typescript
await game.setScreen('gameplay', { level: 1 });

// Removed automatically when 'gameplay' exits
game.spawn({ enemy: { hp: 10 } }, { scope: 'gameplay' });
game.spawnChild(parentId, { projectile: { speed: 5 } }, { scope: 'gameplay' });
```

The screen name is type-checked against your declared screens.

## Screen-Scoped Systems

```typescript
game.addSystem('menuUI')
  .inScreens(['menu'])                         // Only runs in 'menu'
  .setProcess(({ ecs }) => {
    renderMenu(ecs.getScreenState().selectedOption);
  });

game.addSystem('animations')
  .excludeScreens(['pause'])                   // Runs in all screens except 'pause'
  .setProcess(() => { /* ... */ });
```

When several application-owned systems share the same screen gate, capture it
once with `game.systemScope({ inScreens: ['gameplay'] })` and pass that registrar
to their registration functions. See
[Application Registration Modules](./systems.md#application-registration-modules).

## Pause and Overlay Semantics

`pushScreen('pause', ...)` makes `pause` current while preserving the previous
screen on the stack. Systems gated with `.inScreens(['gameplay'])` stop because
`gameplay` is no longer current. ECSpresso does not automatically stop every
other system in the world.

In particular, independently installed timer, tween, coroutine, physics, and
animation plugins keep running unless their systems have compatible screen
gates or their system groups are disabled. A complete pause implementation
must account for both application systems and shared simulation plugins:

```typescript
const CLOCK_GROUPS = ['timers', 'tweens', 'coroutines'] as const;

function pauseSimulation(ecs: typeof game): void {
  CLOCK_GROUPS.forEach(group => ecs.disableSystemGroup(group));
}

function resumeSimulation(ecs: typeof game): void {
  CLOCK_GROUPS.forEach(group => ecs.enableSystemGroup(group));
}

game.onScreenEnter('pause', ({ ecs }) => pauseSimulation(ecs));
game.onScreenEnter('gameplay', ({ ecs }) => resumeSimulation(ecs));
game.onScreenResume('gameplay', ({ ecs }) => resumeSimulation(ecs));
```

Keep input and pause-menu navigation enabled. Disable only groups whose clocks
or simulation state should freeze. Also handle non-gameplay destinations such
as menus or game-over screens when long-lived entities carry timers or
animations that must not continue there.

## Screen Resource

Access screen state through the `$screen` resource:

```typescript
game.addSystem('ui')
  .setProcess(({ ecs }) => {
    const screen = ecs.getResource('$screen');
    screen.current;        // Current screen name
    screen.config;         // Current screen config
    screen.state;          // Current screen state (mutable)
    screen.isOverlay;      // true if screen was pushed
    screen.stackDepth;     // Number of screens in stack
    screen.isCurrent('gameplay');   // Check current screen
    screen.isActive('menu');        // true if in current or stack
  });
```
