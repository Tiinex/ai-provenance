# TRACEABLE Validator Milestone 1 Definition Of Done

This file is the temporary operational progress surface for validator Milestone 1.

It is intentionally plain markdown.

It is not a Tiinex trace, not a schema note, and not a fixture.

## Current Status

- Status: invalidated
  - Reason: Milestone 1 starts from a mixed state where validator logic, test fixtures, schema expectations, and hand-authored `.trace.md` artifacts have all been moving at the same time.
  - Consequence: no earlier green test run, partial validation pass, or remembered agent summary should be treated as current proof for this milestone.
- Last trusted full milestone pass:
  - none yet
- Immediate posture:
  - use this file as the operational source of truth
  - treat any logic-bearing change as invalidating all milestone test checkmarks below until the required reruns pass again

## Current Active Slice

- Focus: root-first validator plus one active subschema at a time
  - Current validator base: `docs/.topics/.schemas/tiinex.root.v1.schema.md`
  - Current schema under migration: `docs/.topics/.schemas/tiinex.topic.v1.schema.md`
  - Immediate goal: validate one migrated subschema fully before creating or porting the next one
  - Current reduction: only the machine-authoritative contracts in `Schema Validation Contract` and `Artifact Creation Contract` should define required validator behavior for migrated schemas
  - Migration posture: treat `docs/.topics/.schemas/.old/` as read-only reference material only; do not preserve or reintroduce old schema-reading behavior in the validator
  - Do not widen this slice into parallel subschema creation, backport layers, or generalized compatibility code before the current migrated schema has a passing proof path
- Active checklist
  - [x] extract the validator authority surface from the root schema
  - [x] define the root parse model from that authority surface
  - [x] implement the first root validator path
  - [x] add focused tests for the root validator path
  - [x] decide the first topic-port lineage boundary before editing the topic schema note itself
  - [x] fully port `tiinex.topic.v1` contract sections to the new root-style machine contract model
  - [ ] rotate the topic schema footer checksum after the final topic edit set
  - [ ] rerun the bounded validation checks for the fully ported topic schema
  - [ ] choose the next single subschema only after the topic proof path is green

## Implementation Gate

- The root parse model for the first validator path should cover:
  - continuity header structure under `# Continuity Context`
  - machine contract structure under `## Schema Validation Contract`
  - contract groups as third-level headings
  - category labels plus first following hyphen list
  - named declaration and method-entry shapes
  - footer structure under `# Continuity Integrity`
- The first implementation should deliberately exclude:
  - embedded `## Traceable State`
  - runtime-trace top-level section checks
  - broad fixture migration or trace-repair work
  - old schema compatibility layers for files moved under `.old`
  - creating the next subschema before the current one validates cleanly
- The first proof path should be:
  - one bounded root validator implementation
  - one fully ported active subschema
  - focused tests for valid structure plus a few invalid contract-shape cases for that active subschema
  - one rerun of the bounded validator checks after the final logic-bearing edit for that schema

## Parked Background

- Broader Milestone 1 work still exists, but it is background for this file until the root validator path is green.
- That parked background currently includes:
  - structure-reader improvements beyond the current `showTraces` surface
  - bounded writer-surface design
  - fixture classification and canonical generated-fixture proof
  - broader validator/fixture realignment across maintained trace artifacts
- Older schema files moved under `docs/.topics/.schemas/.old/` are not part of the active support target for this pass.
- The broader provenance surface has moved since this milestone note began.
- Current repo reality that matters for orientation but is not the active implementation leaf:
  - `showTraces` is a live maintained provenance surface
  - current provenance readers also parse embedded `## Traceable State`
  - current runtime-trace validation checks owned runtime-structure sections and optional state blocks
  - the public provenance tool surface now includes `show_traceable_traces`, `transfer_trace`, and `validate_traceable_continuity`
  - the maintained schema tree already uses the `.schema.md` suffix

## Current Discoveries

- [x] The current root-validator slice can be grounded narrowly from `docs/.topics/.schemas/tiinex.root.v1.schema.md` without re-opening the full milestone surface.
- [x] For the root-validator slice, `Schema Validation Contract` is the machine authority; prose outside that section should not be promoted into extra required validator rules.
- [x] The next productive reduction is to build the root parse model around the contract's group, category-label, hyphen-list, envelope, and footer shapes rather than around broad trace reconstruction.
- [x] `showTraces` is still a live maintained provenance surface, not an old idea; the current extension package wires and tests it as `show_traceable_traces` with `targetPath`, `detailLevel`, `maxItems`, `offset`, and `includeSchemas`.
- [x] The broader maintained format has moved beyond continuity header plus footer alone: current provenance readers and validators also parse embedded `## Traceable State` JSON and continuation metadata such as `parentTracePath` and `continuedFromParent`.
- [x] Migrated schema work should optimize for one active schema at a time, not for mixed old/new compatibility while multiple schema families are in motion.
- [x] Files moved under `docs/.topics/.schemas/.old/` should be treated as reference material only for wording and shape inspiration, not as validator support targets.
- [x] Topic turned out to need the established schema-note parent chain through `tiinex.definition.v1`, not the temporary continuation hop we initially preserved.
- [ ] We still need to rotate the topic schema footer checksum and rerun the observed validation pass against the final topic file state.

## Notes

- This file is the active operational surface for the root-validator leaf, not the full historical ledger for all validator-adjacent work.
- Active lineage context may still live in `.topics/`, but this file should stay implementation-oriented and boring.
- If a point starts reading like schema law, validator prose, or continuity history, move that content back to the right carrier instead of expanding this file into another pseudo-format.