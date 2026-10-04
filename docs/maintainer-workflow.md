# ECSpresso maintainer workflow

This document is the repository-wide guide for humans and coding agents that
change ECSpresso itself. Application developers should use the consumer skill
under `skills/ecspresso/` instead.

## Start with the public contract

Translate the requested change into the public surfaces it may affect:

- runtime behavior in `src/`;
- inferred and exported types;
- system ordering, command playback, and change detection;
- package entry points and optional peer dependencies;
- documentation, examples, and the bundled consumer skill.

Inspect the implementation and its closest tests before editing. Search for the
public symbol, its internal representation, and all documentation examples.
Treat current source and tests as evidence; treat comments, generated output,
and prior behavior descriptions as claims to verify.

## Preserve runtime and type contracts together

Many ECSpresso APIs have coupled runtime and compile-time behavior. When
changing a query, builder, plugin, callback, or resource API:

1. Identify the runtime implementation and the types that expose it.
2. Check inference for both inline and reusable definitions.
3. Add or update runtime tests for observable behavior.
4. Add compile-time assertions for meaningful guarantees and rejected misuse.
5. Confirm public exports from `src/index.ts` and any package subpath export.

Do not make the type surface more permissive merely to make an implementation
compile. Use runtime validation at untyped boundaries and keep unavoidable
internal casts narrow and explained.

## Reason about system changes

For changes involving systems, map the affected boundary before coding:

- `with`, `optional`, and `changed` identify component values a query consumes;
- `without` and `parentHas` add membership or hierarchy dependencies;
- `mutates` declares writes to required components and publishes change marks;
- resources expose shared state but do not distinguish reads from writes;
- phase and priority determine when other systems can observe effects;
- events and command-buffer operations create additional producer/consumer
  paths;
- screens, groups, and required assets determine whether processing runs.

Declarations are an inspection index, not a complete dependency graph.
Omitting `mutates` leaves required components writable, readonly narrowing is
shallow, optional and otherwise visible components may still be accessed, and
the callback's world reference can reach beyond declared queries and resources.
Inspect the processing code and its immediate producers and consumers.

Prefer extending the system that already owns a responsibility. Add a system
when the behavior has a distinct phase, lifecycle, gating rule, or independently
testable responsibility. Keep domain calculations in pure helpers when they do
not require ECS lifecycle access.

## Validate proportionally

Choose the smallest validation that exercises the affected contract:

- pure unit tests for calculations and data transformations;
- small-world simulation tests for queries, ordering, events, change marks, and
  command-buffer behavior;
- type tests for inference and rejected API misuse;
- focused plugin tests for integrations and lifecycle behavior;
- example or browser checks only when presentation, input feel, or a real
  adapter boundary changed.

Small-world tests should register the immediate producer and consumer, use
known time steps, and initialize the world when resources, plugins, assets, or
hooks require it. Fixed-update tests should configure the fixed timestep and
advance enough accumulated time to make the expected number of steps explicit.

Run `bun run check` before handoff. Run `bun run build` when changing exports,
build behavior, generated declarations, or packaging. Inspect a package tarball
when changing the npm file allowlist or published artifacts.

## CI and merge requirements

The CI workflow runs independent `test`, `typecheck`, and `build` jobs on pull
requests to `master`, pushes to `master`, and merge-group events. All three
checks must pass before human merges. The active repository ruleset requires
checks from GitHub Actions and an up-to-date branch, with no human or admin
bypass. The ruleset is configured in GitHub repository settings, separately
from workflow YAML.

The release workflow uses the write-enabled `ECSpresso automated releases`
deploy key through the `RELEASE_DEPLOY_KEY` Actions secret to push its version
commit and tag. It runs tests, typechecking, and the build before pushing.
GitHub's deploy-key bypass applies to all repository deploy keys, so review
this exception before adding another write-enabled key. To rotate the release
key, replace the deploy key and Actions secret together. Other release API
operations continue to use `GITHUB_TOKEN`.

## Keep documentation and distributions aligned

The source consumer skill is `skills/ecspresso/`; its distributable mirror is
`plugins/ecspresso/skills/ecspresso/`. Update both copies together. The skill
must reference only files bundled in that skill or stable public URLs; the npm
package currently ships `dist` and `CHANGELOG.md`, not the repository `docs/`
tree.

The built-in plugin catalog must use exact subpaths from `package.json` exports.
When adding, moving, or removing a plugin, update the implementation, package
exports, TypeDoc entry points, source docs, examples where relevant, changelog,
and both consumer-skill copies.
