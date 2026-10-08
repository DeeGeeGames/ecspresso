# Contextual mechanic recipes

Read only the section selected by the current task. These are diagnosis lessons,
not requirements to redesign every mechanic. Follow the linked contracts for the
installed version.

## Writers feeding changed consumers

- **Applies:** a writer feeds a transform, UI, or other `changed` consumer.
- **Failure:** values change in memory, but the consumer skips the update; spawn
  marks make the first frame appear correct and hide a missing later mark.
- **Inspect:** all writers, including event handlers and helpers; consumer
  subscription and scheduling; automatic marks and manual publication.
- **Remedy:** use the supported [change-tracking contract](change-tracking.md)
  at the actual owner. Declare query writes or publish manual marks as
  appropriate; do not widen declarations just to silence type errors.
- **Verify:** consume the spawn baseline, perform a later write through the real
  producer, and assert the downstream result at its intended run. Include a
  no-change case if per-entity marking precision matters.
- **Excludes:** consumers that intentionally poll values, and unrelated writers.
  Do not add change tracking everywhere or treat `mutates` as a complete graph.

## Presentation ownership

- **Applies:** a visible effect shares properties with a renderer synchronization
  system, animation, tween, or view cache.
- **Failure:** setting tint/alpha/scale appears locally correct but synchronization
  restores the base value before display, or the next frame erases feedback.
- **Inspect:** every writer of the affected presentation property; source
  components, renderer order, cached view objects, and cleanup ownership.
- **Remedy:** choose a single final writer or deliberate composition rule at the
  existing adapter. Store effect state where that writer reads it; coordinate
  ordering only when it explains the ownership. Use [plugins.md](plugins.md)
  for the actual adapter and [lifecycle.md](lifecycle.md) for lifetime rules.
- **Verify:** observe the real adapter after synchronization across multiple
  frames, including effect expiry and entity/screen removal. Simulation of the
  effect state alone does not establish visibility.
- **Excludes:** pure state/calculation changes and adapters with no competing
  writer. Do not add a second renderer or a universal visual-style rule.

## Pause consistency

- **Applies:** pause/overlay behavior should freeze some simulation or effects.
- **Failure:** movement stops but damage, timers, tweens, coroutines, or transient
  expiry continue; resume reveals a state that advanced behind the menu.
- **Inspect:** independently advancing plugins and clocks, live event gates,
  screen scopes, system groups, and resume/exit hooks. Determine which menu/UI
  behavior should intentionally continue; ask when this changes product policy.
- **Remedy:** apply the existing [pause/lifecycle mechanisms](lifecycle.md#pause-and-overlays)
  to the owners that must freeze, including event paths where relevant. Keep
  intended navigation and UI activity running; a screen overlay is not a global
  pause promise.
- **Verify:** advance known time while paused and after resume. Assert frozen
  simulation state and deliberately active UI/clock state separately, then
  observe the overlay interaction when presentation is part of the request.
- **Excludes:** unrelated background activity and requests that do not change
  pause. Do not invent global pause scopes or a new clock API.

## Transient responses

- **Applies:** hit flashes, knockback, invulnerability, temporary animations, or
  similar bounded responses are requested.
- **Failure:** feedback never expires, repeat hits stack/reset unexpectedly, or
  removal/state transitions leave a stale effect or erase the intended response.
- **Inspect:** start trigger, duration/clock, expiry owner, repeat-hit behavior,
  removal, pause, and screen/state transitions. Trace the final presentation
  writer for visible effects.
- **Remedy:** define the response lifecycle at its current owner, including the
  repeat-hit rule and cleanup. Ask about material behavior choices. A visual
  that outlives its source may need separately owned state/entity; use
  [API operations](api-reference.md), [lifecycle.md](lifecycle.md), and
  [presentation ownership](recipes.md#presentation-ownership) rather than
  assuming a dead entity remains renderable.
- **Verify:** exercise start, expiry, a repeated trigger, removal, and relevant
  transitions. Assert state with explicit time; observe the rendered response
  and assess feel separately when required. See [testing.md](testing.md).
- **Excludes:** permanent state changes and discretionary new mechanics. A polish
  request can be satisfied by its observable effect without adding combat rules.
