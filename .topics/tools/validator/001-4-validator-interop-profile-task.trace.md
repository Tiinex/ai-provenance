# Continuity Context

- Envelope Schema: [tiinex.continuation.v1](https://github.com/Tiinex/docs/blob/613f592976c75e73deee101a555674b1cce08304/.topics/.schemas/tiinex.continuation.v1.md)
- Parent
  - Parent Schema: [tiinex.topic.v1](https://github.com/Tiinex/docs/blob/613f592976c75e73deee101a555674b1cce08304/.topics/.schemas/tiinex.topic.v1.md)
  - Created At: 2026-06-01 21:35:19
  - Trace: [001.trace.md](001.trace.md)
  - Origin:
    - [relative](../001.trace.md)
    - [absolute](C:/Users/micro/Documents/Repos/Tiinex/ai-provenance/.topics/tools/validator/001.trace.md)
- Current
  - Current Schema: [tiinex.task.v1](https://github.com/Tiinex/docs/blob/613f592976c75e73deee101a555674b1cce08304/.topics/.schemas/tiinex.task.v1.md)
  - Created At: 2026-06-03 02:18:04
  - Why: Collects the remaining validator-format improvements into one bounded task before any validator split or code change.
  - Summary: Task leaf for validator interop-profile hardening and schema-versus-adapter separation.

---

# Validator Interop Profile Task

This task collects the remaining improvements we want to make before touching
the validator.

## Objective

Define the interop profile shape that lets external lineage or provenance
formats export to `.trace.md` without collapsing into an opaque blob.

## Working Mode

This leaf is the running review surface for the validator interop work.

Append new blind spots, refinements, or revised conclusions here as review
continues.

Do not start validator implementation changes from this leaf until the task is
ready to move from review into production work.

## Autonomy Policy

Proceed autonomously within this leaf while the task remains in review.

Only pause to report when one of these happens:

- a new finding changes the current conclusion
- a schema needs a concrete edit instead of another review note
- the task reaches a real decision boundary or implementation-ready point

Do not pause for ordinary intermediate progress while the review still has
meaningful work to do.

## Review Gate

Review all schema notes in the current schema directory before treating this
leaf as complete.

Only when this leaf no longer gains new blind spots, revised conclusions, or
profile refinements should we consider commit and push.

When the work does move forward, the validator should reach a level where it
can protect the schemas rather than merely describe them.

## Review Findings

- `tiinex.capability.v1` is the most likely complementary home for interop
  profiles and adapter declarations.
- `tiinex.capability.v1` still seems to need an explicit interop-profile shape
  so source-format mappings can be described without turning the manifest into
  a generic capability blob.
- `tiinex.capability.v1` now carries explicit interop profile shape,
  fidelity/retention, root/adapter separation, canonical identity mapping, and
  round-trip expectation rules for the current todo set.
- `tiinex.capability.v1` now also demonstrates those interop fields in a
  concrete minimal example, which reduces the remaining ambiguity from prose-
  only contract text.
- `tiinex.schema.v1` should stay at the root-contract level and not absorb
  per-format mapping details.
- `tiinex.machine.runtime.v1` and `tiinex.ai.runtime.v1` already have the right
  runtime layering; they do not need interop-profile fields.
- `tiinex.archive.v1`, `tiinex.zip.v1`, `tiinex.encrypted.v1`,
  `tiinex.pointer.v1`, and `tiinex.reduction.v1` already cover their own
  transport or continuity roles and do not appear to need this profile split.
- The schema-directory review gate is now satisfied: no reviewed schema note
  displaced `tiinex.capability.v1` as the correct home for adapter-facing
  interop profiles.
- `tiinex.pointer.v1` remains a thin continuity redirect and should not absorb
  source-format mapping rules or adapter-profile semantics.
- `tiinex.archive.v1`, `tiinex.zip.v1`, and `tiinex.encrypted.v1` remain
  carrier or visibility schemas; they can host packaging semantics, but they
  are not the right home for first-class source-format decomposition rules.
- `tiinex.signal.v1`, `tiinex.feedback.v1`, and `tiinex.evidence.v1` clarify
  the artifact roles available after decomposition, which strengthens the case
  for keeping interop shape in capability manifests instead of flattening
  import outcomes into a generic blob.
- `tiinex.reduction.v1` reads as a post-compaction carry-forward schema rather
  than an initial import fallback, so blob fallback should stay a capability-
  profile policy rather than being reframed as reduction by default.

## Draft OpenLineage Mapping Skeleton

This is the current candidate shape for mapping OpenLineage into Tiinex
interop profiles.

### Candidate Profile Shape

- Profile Id: openlineage.trace-md.v1
- Source Format: OpenLineage
- Profile Version: 1
- Target Shape: Tiinex `.trace.md` export with optional embedded capability
  note
- Interop Mode: decomposition-first

### Candidate Entity Mapping

- RunEvent / Run Metadata Update -> `tiinex.runtime.v1`
- JobEvent / Job Metadata Update -> `tiinex.task.v1` when the job is being
  treated as executable work, otherwise `tiinex.topic.v1` when the source only
  carries design intent
- DatasetEvent / Dataset Metadata Update -> `tiinex.evidence.v1` for preserved
  dataset metadata, schema snapshots, or other fidelity-bearing facts

### Candidate Relationship Mapping

- `run.parent` facet -> continuity parent relation
- `job.namespace` + `job.name` -> stable source identity tuple
- `dataset.namespace` + `dataset.name` -> stable dataset identity tuple
- `sourceCodeLocation` -> origin or linked artifact reference when a committed
  target exists
- `schemaURL` -> schema reference or linked supporting evidence when the target
  is recoverable

### Candidate Canonical Identity Mapping

- `run.runId` should remain the canonical run identity when the source model
  exposes it.
- `job.namespace` + `job.name` should remain the canonical job identity tuple;
  any source-side version or revision signal should be preserved separately
  rather than fused into the display name.
- `dataset.namespace` + `dataset.name` should remain the canonical dataset
  identity tuple.
- profile versioning should stay independent from both capability-manifest
  versioning and any source-model object version so adapter evolution can be
  tracked without pretending the upstream format changed.

### Candidate Fidelity Rules

- preserve entities, relations, and facets separately when the source model
  makes them available separately
- preserve ordering when the source semantics make ordering meaningful
- preserve duplicates only when the source model distinguishes them
- preserve recoverable custom facets rather than flattening them into one blob
- allow blob fallback only when the source cannot be decomposed further

### Candidate Round-Trip Expectations

- round-trip should preserve stable identity tuples for runs, jobs, and
  datasets even when the readable export reshapes the body into multiple Tiinex
  leaves.
- round-trip should preserve lifecycle timestamps, parent relations, and named
  facet provenance when those signals are recoverable from the source model.
- round-trip does not need byte-identical source-event regeneration, but it
  should preserve enough structured signal that a later adapter can reconstruct
  the same lineage claims and the same declared lossiness boundary.
- when blob fallback is used, the export should declare that downgrade
  explicitly instead of letting later readers mistake the artifact for a full
  decomposition-first export.

## Decision Notes

- Interop profile versions should be versioned separately from the root
  capability schema so adapter behavior can evolve without forcing every
  capability-manifest change to bump the same version line.
- The current storage policy is now frozen enough for implementation: same-repo
  `.trace.md` parents or references should store relative paths, cross-repo
  `.trace.md` parents should default to committed git-origin-backed storage,
  uncommitted cross-repo parents should fail by default, and any weaker
  cross-repo relative storage should remain an explicit downgrade override
  rather than a silent fallback.
- For non-`.trace.md` targets, current relative-or-absolute storage remains the
  active policy; the stronger origin-backed rule is for trace continuity edges,
  not every file reference in the repo.
- Unknown custom facets and other unknown fields should be preserved as linked
  evidence when they are recoverable, summarized in readable notes when they
  are small enough, and allowed to fall back to an explicit blob only when that
  is needed for incremental porting or fidelity recovery.
- Semantic round-trip is the current bar, not byte-identical source-event
  replay. The adapter should preserve stable identity, lineage claims,
  recoverable timestamps, and declared degradation boundaries even when the
  readable export is decomposed across several Tiinex leaves.
- The first OpenLineage export shape should be a small chain of linked trace
  leaves rather than one oversized compound trace, so each slice stays bounded
  and can be inspected or repaired on its own.

## Research Sweep Summary

- The base schema direction is now stable at the architecture level: the root
  schema stays generic, capability manifests carry adapter-specific profile
  entries, and source-format mapping should stay decomposition-first.
- The full schema-directory sweep no longer appears to be the bottleneck. The
  remaining review work is no longer storage-policy discovery; that policy is
  now frozen well enough for a first implementation pass.
- The current validator implementation is still narrower than the target
  contract. It validates checksum, traversal, and runtime-heading surfaces, but
  it does not yet enforce schema-parent conformance or origin-shape lawfulness.
- The trace-format redesign contract now has a concrete first slice: git-root
  discovery, git-origin parsing/rendering, same-repo relative storage,
  cross-repo commit-pinned storage, and explicit downgrade override behavior.
- Repair work should remain separate from validation work and stay
  decision-driven rather than broad or silent.
- OpenLineage now has source-model evidence plus a candidate profile shape, so
  the remaining issue is fidelity policy and adapter shape, not whether the
  source model is sufficiently rich.

## Ready For Implementation

The schema-directory review gate is now satisfied.

Implementation can start as soon as the remaining open questions above are
frozen enough to lock one profile shape and one storage policy.

The storage policy itself is now locked for the first pass. The remaining
questions are narrower rendering or scope questions, not whether same-repo and
cross-repo trace storage should follow different default rules.

The first coding pass should target the trace-format contract, not the broader
validator cleanup.

### First Coding Slice

- git-root discovery helper
- same-repo versus cross-repo resolution using discovered git roots
- git origin driver parse and render support
- default reject of uncommitted cross-origin `.trace.md` parents
- header parsing and rendering for `Parent Origin`, `Parent Created At`,
  `Why`, and `Summary`
- checksum handling review against the new header and cross-origin model

## Done Criteria

- the interop profile has a named shape with stable fields
- canonical id, namespace, and version mapping is stated
- root schema rules are separated from adapter or source-format rules
- lossiness is stated explicitly
- unknown-field retention is stated explicitly
- ordering and duplicate-handling rules are stated where the source model supports them
- round-trip fidelity expectations are stated explicitly
- validator code remains unchanged until this task is settled

## Scope And Constraints

This task stays on the schema and profile side first.

In scope:

- interop profile shape
- canonical identity mapping for ids, namespaces, and versions
- ordering and duplicate-handling policy
- round-trip fidelity and lossiness policy
- export and import lossiness policy
- unknown-field retention policy
- root-versus-adapter rule split
- format-specific adapters such as OpenLineage

Out of scope for now:

- validator implementation changes
- broad repo rewrites
- collapsing all source formats into one blob shape

## Origin

- validator root:
  - [relative](../001.trace.md)
  - [absolute](C:/Users/micro/Documents/Repos/Tiinex/ai-provenance/.topics/tools/validator/001.trace.md)
- schema under review:
  - [relative](../../../../docs/.topics/.schemas/tiinex.schema.v1.md)
  - [absolute](C:/Users/micro/Documents/Repos/Tiinex/docs/.topics/.schemas/tiinex.schema.v1.md)
- source-model evidence:
  - [OpenLineage evidence leaf](../export-and-import/OpenLineage/001.trace.md)
  - [ChatGPT platform note](001-3-message-from-chatgpt-platform.trace.md)

## Subtasks

- define interop profile shape
- draft capability-side interop profile shape
- specify lossiness policy
- specify unknown-field retention
- separate root and adapter rules
- decide whether profile versions need their own numbering
- draft a first OpenLineage mapping skeleton
- define whether unknown custom facets are preserved, surfaced, or downgraded

## Risks

- the root schema can become overloaded if adapter rules are kept there too long
- a blob-friendly fallback can become the default if decomposition rules stay vague
- validator changes can happen too early if the profile split is not explicit enough

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [001.trace.md](001.trace.md)
  - Value: RnY5TwmiUx3_yBuDJvyKOLL5JUNr9wLZ7pf1cdlWwDw