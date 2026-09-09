# ECSpresso repository guidance

These instructions apply to work on the ECSpresso library repository. For the
maintainer workflow, read `docs/maintainer-workflow.md`. The consumer skill in
`skills/ecspresso/` describes how applications use the published package; it is
not the authority for changing ECSpresso internals.

## Working agreement

- Ask one clarifying question at a time when significant ambiguity would change
  the implementation. Otherwise, inspect the repository and make a bounded,
  evidence-based assumption.
- Distinguish observed behavior from inference. Cite the source, test, command,
  or runtime output behind conclusions; label conjecture explicitly.
- For multi-part work, maintain progress in `agent-todos.local.md`.
- Preserve unrelated work in a dirty worktree.

## TypeScript and design conventions

- Use Bun for scripts and tests. Run `bun run check` for completed work; use
  `bun run check:types` for an earlier focused type check when useful.
- Do not use explicit `any`, non-null assertions, or unchecked casts to bypass
  the type checker. Narrow unknown values at runtime. If the type cannot be
  expressed safely, stop and explain the constraint.
- Prefer pure functions, immutable values, `const`, and array transformations.
  Mutate only where the ECS API or a measured hot path requires it.
- Prefer named function declarations over anonymous functions assigned to
  constants when extracting reusable logic.
- Avoid classes, `switch` statements, deeply nested branches, and conditionals
  that contain substantial logic. Prefer early returns and small functions.
- Use `as const` when it materially improves inference; do not add it
  mechanically.
- In React bindings or examples, reserve `useEffect` for synchronization with
  external systems.
- Match `.editorconfig`: tabs for code and spaces for JSON.

## Library constraints

- Treat runtime behavior and type-level behavior as separate public contracts;
  cover both when a change affects both.
- Do not add compatibility shims, aliases, overloads, or duplicate APIs unless
  explicitly requested. Deliberate public breaking changes require clear
  documentation and changelog treatment.
- Keep allocation out of update hot paths where practical. Reuse objects only
  when it does not obscure correctness.
- Add only high-value tests for behavior, ordering, type guarantees, packaging,
  or other regression-prone contracts.
- When plugin entry points change, update `package.json`, `typedoc.json`, source
  documentation, and the consumer skill catalog together.
- Keep `skills/ecspresso/` byte-aligned with
  `plugins/ecspresso/skills/ecspresso/`.
