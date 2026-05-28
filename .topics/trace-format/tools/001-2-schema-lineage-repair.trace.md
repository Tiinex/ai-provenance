# Continuity Context

- Envelope Schema: [tiinex.continuation.v1](https://github.com/Tiinex/docs/blob/d26b73c3f83a618cc04338c49ca10b62bc91e876/.topics/.schemas/tiinex.continuation.v1.md)
- Parent
  - Parent Schema: [tiinex.topic.v1](https://github.com/Tiinex/docs/blob/d26b73c3f83a618cc04338c49ca10b62bc91e876/.topics/.schemas/tiinex.topic.v1.md)
  - Created At: 2026-05-28 21:23:20
  - Trace: [001.trace.md](001.trace.md)
  - Origin:
    - [relative](001.trace.md)
    - [absolute](C:/Users/micro/Documents/Repos/Tiinex/ai-provenance/.topics/trace-format/tools/001.trace.md)
- Current
  - Current Schema: [tiinex.topic.v1](https://github.com/Tiinex/docs/blob/d26b73c3f83a618cc04338c49ca10b62bc91e876/.topics/.schemas/tiinex.topic.v1.md)
  - Created At: 2026-05-28 21:48:32
  - Why: Starts a dedicated repair track under the tools topic so schema-lineage fixup behavior can be designed separately from audit-only and preview-resolution work.
  - Summary: Direction for tooling that can repair or upgrade schema lineage when links, parent targets, or footer integrity drift.

---

# Schema Lineage Repair Direction

This topic captures the repair-oriented branch of the tools work.

The goal is not just to detect schema drift, but to define what a bounded and
trustworthy repair surface should be allowed to rewrite when the lineage is no
longer coherent.

## Current Read

The audit side can tell us when a schema chain is wrong, but that only solves
half the problem. The workflow still becomes expensive if every detected issue
requires a human to manually reconstruct the right commit-pinned target and the
right footer digest.

The repair problem therefore needs its own bounded topic rather than being
treated as a casual extension of audit behavior.

## Working Scope

The repair surface should eventually help with at least these cases:

1. parent trace still points to a local or stale target and should be upgraded
   to a committed browseable target
2. docs-schema references were published in the wrong order and need to be
   repinned to the correct already-published parent commit
3. final continuity footer no longer matches the rewritten or upgraded parent
   target

What this track should avoid for now:

- broad autonomous repo rewrites
- silent mutation without a visible proposed before/after plan
- pretending a weak guessed match is the same as a grounded repair

## Repair Contract Direction

The likely repair shape should stay narrow and staged:

1. inspect and classify the broken edge
2. propose one concrete replacement target
3. show the exact continuity fields that would change
4. recompute the footer digest from the rewritten artifact
5. apply only after explicit operator confirmation when the blast radius is not
   trivial

This keeps repair as a bounded rewrite tool rather than as a freeform content
editor.

## Risks

- a repair tool can silently create new drift if it rewrites links without a
  strong published-parent policy
- a repair tool can overfit to one repo pattern and become unsafe across other
  topic spaces
- digest refresh becomes misleading if the replacement parent itself was chosen
  on weak evidence

## Next Steps

- define the minimum classification vocabulary for repairable lineage failures
- decide which repairs can be auto-proposed versus which should stop for human
  review
- define the smallest preview surface that shows exactly what would change

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [001.trace.md](001.trace.md)
  - Value: v9zU4FGJwB-phb5wPVfWRUyAkrXJVWywjGheCBO04ko