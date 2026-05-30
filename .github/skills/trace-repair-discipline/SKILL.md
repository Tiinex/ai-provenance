---
name: trace-repair-discipline
description: Use when repairing Tiinex trace artifacts after parent edits, checksum rotation, origin correction, or lineage drift. Helps agents repair traces in a safe order without conflating lineage semantics with Git-specific carrier behavior.
---

# Trace Repair Discipline

Use this skill when a trace artifact is already supposed to exist, but its lineage or integrity surface now needs repair.

This skill is about repair order and repair boundaries.

It is not a license to redesign the trace freely while repairing it.

## Use This Skill When

Use this skill when:

- a parent trace changed and a dependent child now carries a stale parent checksum
- a `Parent` block is wrong, incomplete, or points at the wrong artifact
- an `Origin` block needs correction without changing the continuity parent
- a trace footer checksum is stale after a legitimate edit
- cross-repo lineage needs a committed remote reference so the grounding travels outside the local machine

Do not use this skill for ordinary writing or for schema invention.

If the real problem is that the schema itself is missing a rule, use the schema-authoring path instead of improvising during repair.

## Core Distinction

Keep these layers separate during repair:

1. lineage semantics
2. carrier semantics
3. repair procedure

Working meanings:

- lineage semantics: what relation is actually intended between artifacts
- carrier semantics: how the storage or versioning system handles identity and history
- repair procedure: the concrete sequence of edits needed to restore truthful continuity

Do not treat a Git-shaped repair sequence as if it were the definition of lineage itself.

## Repair Order

Prefer this order when several linked traces need repair:

1. identify the intended relation before editing any links
2. repair the upstream artifact that other traces depend on
3. repair the dependent trace's `Parent` or `Origin` fields
4. refresh any parent checksum stored in `Traceable State`
5. refresh the local continuity integrity footer last

If a parent is still unsettled, avoid repeatedly rotating the child against provisional parent state unless the work is explicitly temporary.

## Parent Versus Origin

During repair:

- change `Parent` only when the continuity lineage relation itself is wrong or newly clarified
- change `Origin` when provenance or grounding references are incomplete, missing, or misleading
- do not upgrade `Origin` into `Parent` just because the origin artifact strongly influenced the current one
- do not downgrade `Parent` into mere provenance if the artifact is actually a continuation of that parent

## Cross-Repo Read

When the relevant grounding artifact lives in another repository, prefer at least one committed cross-repo reference that a remote reader can resolve.

For current Tiinex practice, that usually means a `browse + git` candidate.

Do not rely only on local absolute paths or same-host relative paths when the repair is supposed to preserve travel-ready provenance.

## Edit Boundaries

Repair only what the evidence supports.

That means:

- do not rewrite body meaning just because the envelope is broken
- do not invent new lineage claims to make the chain look cleaner
- do not smuggle schema changes into a repair pass unless the task explicitly includes schema evolution
- do not treat a green local checksum as proof that remote or committed state has been validated

## Validation Posture

After repair, prefer checking:

- the named schema still matches the artifact's role
- the `Parent` relation now expresses the intended lineage and not only nearby provenance
- any carried parent checksum matches the repaired parent state the child actually names
- the local footer checksum was refreshed after the substantive repair edits

During repair, do not claim success more strongly than the evidence allows.

- do not call the repair complete if the intended lineage relation is still ambiguous
- do not call provenance committed if the artifact still relies only on local paths
- do not call a checksum verified if it was only assumed to rotate correctly
- do not call the chain trustworthy merely because one edited file is locally green

If the available validator only proves local content consistency, say so plainly instead of overclaiming stronger continuity guarantees.

## Good Outcome

A good repair leaves behind:

- clearer lineage truth
- less ambiguity between parent and origin
- a refreshed checksum surface that matches the repaired artifact
- no unnecessary schema drift or prose drift introduced during the repair itself