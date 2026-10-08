# Inspecting a requested outcome

Read this when an existing mechanic's ownership or execution path is unclear.
Trace one concrete scenario, such as “a lethal projectile removes the enemy and
shows a readable death response.” Keep the useful neighborhood in working
context or an existing task/PR; a whole-project report is unnecessary.

## Bound the scenario

Identify the trigger, relevant game state, expected state change, and visible
result. For interaction or presentation work, reach that state with normal
controls when practical and observe the baseline. If setup is unavailable,
record that limitation. Define mechanical and presentation/play completion
criteria before changing code; use [testing.md](testing.md#completion-evidence)
for evidence limits.

## Follow the source

- Locate component, resource, and event definitions and their registration
  sites. Check the installed version and actual composition root: a type
  declaration alone does not install a producer or initialize a resource.
- Find relevant query readers, writers, event publications and handlers. Follow
  immediate helpers, direct component writes, resource effects, and command
  operations. Search event names as well as query components: health's damage
  handler can change state and publish death without a processing query.
- Inspect inherited `definePlugin().setSystemDefaults(...)` and
  `world.systemScope(...)` defaults, per-system overrides, and plugin options.
  Check phase, explicit ordering references, priority, screens, groups, required
  assets, empty-query gating, and initialization. For event handlers, inspect
  their live gates and publisher timing rather than assuming their processing
  phase controls delivery.
- Locate structural changes and the consumers that need their effects. Separate
  direct mutations, synchronous event delivery, scheduled processing, and
  deferred commands. A death event can fire while the dead entity still exists.
  Use the current [API reference](api-reference.md) and
  [change-tracking contract](change-tracking.md) for visibility and marking;
  use [lifecycle.md](lifecycle.md) for activation and cleanup.
- If the outcome is visible, follow data into its presentation adapter and final
  synchronization. Identify who owns displayed health, transforms, tint, alpha,
  animations, and view-object lifetime. Check whether another writer overwrites
  feedback, and what happens when the source entity or screen disappears.

## Keep claims bounded

Distinguish declared metadata, behavior observed in source, behavior observed in
an executed scenario, and unresolved assumptions. Queries plus `mutates` are an
inspection starting point, not a complete read/write or mechanic graph. Resources
do not declare read versus write; callbacks and helpers can reach beyond query
metadata. Missing metadata does not establish independence.

Record consequential assumptions and ask about material behavior choices, such
as repeat-hit policy or which clocks pause. Resolve routine implementation gaps
from source. Stop expanding when the owner, immediate interactions, gates, and
presentation path explain the scenario; expand only for a dependency you find.

## Select verification

Choose the smallest useful check: a pure helper test, an event-only world, or a
producer-to-consumer simulation with explicit time and command visibility.
Account for fixed-step accumulation and initial spawn marks; see
[testing.md](testing.md). For presentation or feel, add the relevant rendered
state and focused normal-control play. Select only the applicable
[recipe section](recipes.md); API and lifecycle references remain authoritative.
