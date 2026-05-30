---
description: Temporary reading and editing discipline for Tiinex trace artifacts. Use when reading or editing any .trace.md file so schema boundaries, parent lineage, origin provenance, and repair discipline are not conflated.
applyTo: "**/*.trace.md"
---

# Trace Lineage Working Instruction

This instruction is a temporary guardrail for trace artifacts.

It exists to help agents read and edit `.trace.md` files in a way that preserves schema meaning, lineage meaning, and bounded repair discipline until stronger tooling carries more of that load directly.

Treat this file as reading and conduct guidance.

Do not treat it as a replacement for schema notes, validator behavior, or continuity integrity checks.

## Reading Order

When reading a trace artifact, prefer this order:

1. continuity envelope
2. current schema identity
3. parent lineage signal
4. body sections
5. continuity integrity footer

That means the agent should first identify the current schema from the envelope, then interpret the rest of the file through that schema rather than through freeform prose alone.

## Schema Authority

For Tiinex trace work, schema notes under `docs/.topics/.schemas/` are the primary schema authority.

When a trace artifact names a current schema or parent schema, the agent should treat that schema note as stronger than a convenient prose reading of the trace body.

If schema guidance and local body wording appear to disagree, prefer the schema note until the conflict is resolved deliberately.

Do not invent extra fields, hidden semantics, or envelope meanings that are not supported by the named schema or the continuity envelope.

## Common Reading Modes

When the current schema is one of the common Tiinex trace schemas below, prefer the corresponding reading posture.

### Topic Read

When `Current -> Current Schema` is `tiinex.topic.v1`:

- read the artifact as a working thread, not as a landed outcome
- treat body sections such as current read, design direction, risks, and next artifacts as the main carrier of meaning
- do not over-read `Why` or `Summary` as if they settle the topic by themselves
- if the artifact looks like it now governs what should happen, check whether it should really be a decision artifact instead

### Decision Read

When `Current -> Current Schema` is `tiinex.decision.v1`:

- read the artifact for the landed decision first
- look for explicit state, scope, actor-bearing decision signal, and operative direction
- treat `Current -> Why` as rationale support, not as the decision itself
- do not reduce a decision artifact to general discussion when the main value is what now governs

### Evidence Read

When `Current -> Current Schema` is `tiinex.evidence.v1`:

- read the artifact for what material is being preserved and what it supports
- look for provenance, representation method, fidelity limits, and supported claim or question
- prefer an explicit `Origin` block as provenance when concrete supporting artifacts exist
- do not overclaim from evidence that is partial, transformed, summarized, or only weakly grounded

### Feedback Read

When `Current -> Current Schema` is `tiinex.feedback.v1`:

- read the artifact as interaction-shaped signal, not as generic evidence or broad topic prose
- look for source surface, reply or response relation, representation method, and current disposition
- preserve the difference between quoted feedback, normalized summary, and mixed representation
- do not flatten weakly interactive signal into feedback when the interaction relation is absent or unclear

## Lineage Discipline

Treat `Parent` as continuity lineage, not as a generic hint that the file was merely inspired by something else.

Treat `Origin` as provenance or grounding context, not as an automatic continuity parent.

Treat `Current -> Summary` as a compact reading aid, not as permission to overwrite more specific schema or lineage meaning elsewhere in the file.

Treat `Why` as motivation or transition signal, not as a substitute for a decision body, evidence body, or parent relation.

Do not silently convert:

- origin into parent
- body prose into envelope truth
- repair convenience into lineage semantics

## Edit Discipline

When editing a trace artifact, preserve the schema boundary first.

That means:

- keep the continuity envelope recognizable
- keep required schema-bearing fields intact
- avoid moving meaning out of the schema-bearing surface and into arbitrary prose
- avoid adding ad hoc metadata outside the named schema unless the change is explicitly experimental and clearly marked

If a change needs a new structural field or a new interpretation rule, prefer evolving the relevant schema note instead of improvising a local one-off pattern inside a single trace.

## Validation Honesty

Do not claim stronger certainty, stronger validation, or stronger provenance than the available evidence supports.

That means:

- do not say a trace is validated unless the relevant validation was actually run
- do not say a parent relation is confirmed if it is only inferred from nearby prose or naming
- do not say a checksum matches if the checksum-bearing surface was not actually refreshed or checked
- do not say provenance is committed or remotely recoverable when only local paths are present
- do not treat a clean local editor state as proof that lineage semantics are correct

When the current basis is partial, say so plainly and keep the claim narrow.

## Repair Read

Repair discipline should be read in layers:

1. lineage semantics
2. carrier semantics
3. repair procedure

Do not assume a Git-grounded repair sequence is the same thing as Tiinex lineage semantics.

When a trace mentions commit-pinned links, rotating checksums, or dependency order, treat that as carrier-shaped repair discipline unless the schema explicitly says otherwise.

## Drift Guard

When uncertainty appears, prefer a narrower claim.

Do not invent missing parents.

Do not rewrite older lineage lightly.

Do not flatten schema, origin, evidence, decision, and repair into one blended story just because the file is readable as prose.

If the current meaning is unclear, the safe move is to identify the uncertainty, consult the named schema, and preserve the file's existing structure until a stronger basis exists.