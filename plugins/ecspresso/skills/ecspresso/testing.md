# Testing application behavior

Use validation proportional to the changed boundary.

## Validation layers

- Typechecking validates API use, inference, and the shallow access constraints
  created by declarations such as `mutates`.
- Small-world simulation validates behavior, ordering, change propagation,
  events, and structural commands.
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
5. Advance explicit time steps and assert observable state, events, and entity
   structure.

For movement, advance known time and assert the resulting position. For an
interaction, include the immediate consumer—for example, movement followed by
collision—and assert both the state change and emitted event or command effect.

Fixed-update tests should configure the timestep and advance enough accumulated
time to make the number of fixed steps explicit. When validating `changed`
queries, account for spawn marks and test a later tick when necessary to isolate
the producer's mark.

Prefer one boundary-level regression test over several tests that only repeat
static configuration or implementation details.
