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