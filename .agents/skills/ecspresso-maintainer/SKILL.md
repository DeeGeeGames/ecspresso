---
name: ecspresso-maintainer
description: Develop and maintain the ECSpresso library repository itself, including runtime and type contracts, tests, exports, documentation, packaging, and its bundled consumer skill. Do not use for applications that only consume ECSpresso.
---

# ECSpresso Maintainer

Use this skill only when changing or reviewing the ECSpresso repository itself.
For application development with the published library, use the consumer
`ecspresso` skill instead.

Read the repository `AGENTS.md` first, then read
[`docs/maintainer-workflow.md`](../../../docs/maintainer-workflow.md) completely
before making changes. Treat that document as the canonical cross-agent
workflow; this skill supplies routing rather than duplicating it.

Inspect `CHANGELOG.md` when a change affects a published API, behavior, import
path, or release artifact. Keep runtime and type-level contracts aligned, select
tests by regression value, and finish with the validation required by
`AGENTS.md`.

When changing the consumer skill, edit `skills/ecspresso/` as the source and
keep `plugins/ecspresso/skills/ecspresso/` byte-identical. Do not put repository
maintenance instructions into the consumer skill.
