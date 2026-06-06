# Continuity Context

- Envelope Schema: [tiinex.root.v1](https://github.com/Tiinex/docs/blob/f6106423ab395137600bd3633a56296223006671/.topics/.schemas/tiinex.root.v1.schema.md)
- Parent
  - Parent Schema: [tiinex.task.v1](https://github.com/Tiinex/docs/blob/f6106423ab395137600bd3633a56296223006671/.topics/.schemas/tiinex.task.v1.schema.md)
  - Created At: 2026-05-28 21:23:20
  - Trace: [001.trace.md](001.trace.md)
  - Origin:
    - [relative](001.trace.md)
    - [absolute](C:/Users/micro/Documents/Repos/Tiinex/ai-provenance/.topics/trace-format/tools/001.trace.md)
    - [browse + git](https://github.com/Tiinex/ai-provenance/blob/4c697e188115489da37587b3145186c198c9166f/.topics/trace-format/tools/001.trace.md)
- Current
  - Current Schema: [tiinex.task.v1](https://github.com/Tiinex/docs/blob/f6106423ab395137600bd3633a56296223006671/.topics/.schemas/tiinex.task.v1.schema.md)
  - Created At: 2026-05-28 21:48:32
  - Why: Carries the bounded repair task for schema-lineage fixup behavior when links, parent targets, or footer integrity drift.
  - Summary: Task for defining bounded schema-lineage repair behavior.

---

# Schema Lineage Repair

This artifact now acts as the repair task under the tools root.

The goal is not just to detect schema drift, but to define what a bounded and
trustworthy repair surface should be allowed to rewrite when the lineage is no
longer coherent.

## Objective

Define the bounded repair behavior needed when schema-lineage audit detects a
real broken edge.

## Done Criteria

- the repair task distinguishes audit from mutation clearly
- the task defines a narrow staged rewrite contract
- the task states what kinds of repair remain out of scope for now
- the task names a small failure taxonomy instead of treating every broken edge
  as one generic repair case
- the task makes explicit which findings must stop rather than auto-repair

## Scope And Constraints

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

## Failure Taxonomy

The first repair surface should classify findings before it proposes mutation.

Current minimum vocabulary:

- `stale-target`: the carried target exists, but it is no longer the preferred
  published target for the intended relation
- `missing-origin-backed-target`: a stronger committed or browseable target is
  expected, but no valid published target has been established yet
- `wrong-published-parent`: the artifact points at the wrong already-published
  parent target
- `digest-stale`: the continuity footer no longer matches the artifact text
  after a known rewrite
- `ambiguous-candidate`: more than one plausible replacement target exists or
  the available evidence is too weak to choose one safely

This vocabulary should stay small enough that operators can reason about it
quickly, but explicit enough that the tool does not flatten high-confidence and
low-confidence repairs into one bucket.

## Repair Contract

The likely repair shape should stay narrow and staged:

1. inspect and classify the broken edge
2. propose one concrete replacement target
3. show the exact continuity fields that would change
4. recompute the footer digest from the rewritten artifact
5. apply only after explicit operator confirmation when the blast radius is not
   trivial

This keeps repair as a bounded rewrite tool rather than as a freeform content
editor.

Digest refresh should only happen after the replacement target is already
grounded well enough to survive inspection.

The repair surface should also separate three output modes clearly:

- `audit finding`: names the classification and the evidence behind it without
  proposing mutation yet
- `repair proposal`: names one concrete rewrite candidate and shows the exact
  before/after fields
- `applied repair`: records that the rewrite was actually carried out and that
  any dependent digest values were refreshed afterward

## Stop Conditions

The repair surface should stop rather than auto-repair when:

- the finding is `ambiguous-candidate`
- the finding is `missing-origin-backed-target`
- the replacement parent cannot be tied to a clearly published target
- the proposed rewrite would cross too many files or repo boundaries for the
  current bounded pass

The first useful automation target is not “fix everything automatically.”

It is “make safe cases obvious and make unsafe cases stop early with a clear
reason.”

## Risks

- a repair tool can silently create new drift if it rewrites links without a
  strong published-parent policy
- a repair tool can overfit to one repo pattern and become unsafe across other
  topic spaces
- digest refresh becomes misleading if the replacement parent itself was chosen
  on weak evidence

## Subtasks

- define the minimum classification vocabulary for repairable lineage failures
- decide which repairs can be auto-proposed versus which should stop for human
  review
- define the smallest preview surface that shows exactly what would change

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [001.trace.md](001.trace.md)
  - Value: 8UkekHFBzjPSEFn6sAERk4q_DXT0orM9t_xDvclHakU