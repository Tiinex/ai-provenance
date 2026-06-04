# Process Retrospective Draft

Status: staged working note, not a continuity leaf.

Source leaf:
- [001-4-validator-interop-profile-task.trace.md](001-4-validator-interop-profile-task.trace.md)

Why this file exists:

This note captures the process reflection that surfaced while working from the
validator interop-profile task leaf.

It is staged here because the reflection was triggered by that exact leaf and
should stay close to the operative context for now.

It is not intended to remain permanently inside the validator topic space.

Recommended long-term home:

- promote the material into its own docs topic when we want lineage around AI
  working method, compact risk, subtask discipline, and confidence handling
- the most honest future home is probably a new shared docs topic rather than a
  child inside the validator branch
- a plausible future root would be something like `docs/.topics/working-method/`
  or another cross-repo process-oriented topic chosen deliberately later

## What the reflection is about

The main issue is not that the local code slices were ungrounded.

The main issue is that long compacted conversation state can preserve enough
local facts for implementation while still weakening the exact boundary between:

- what the current leaf explicitly authorizes
- what is merely a nearby, reasonable continuation
- what should first have been split into a narrower subtask leaf

That creates a real risk of doing work that is locally coherent and validated,
but broader than the current lineage made explicit.

## Retrospective read

Observed strength:

- local validator and trace-format slices were often highly falsifiable
- nearby schema notes and real `.trace.md` artifacts gave strong grounding
- focused tests and builds gave concrete post-edit validation

Observed weakness:

- the boundary between schema-review work and implementation work stayed too
  implicit for too long
- compacted chat state can carry the active direction while dropping some of the
  surrounding boundary logic that originally constrained the move
- that makes it easier to take a reasonable adjacent implementation slice
  without a fresh explicit subtask authorizing the jump

## Confidence split

The most important retrospective distinction is between two different kinds of
confidence.

Local slice confidence:

- confidence can be high when the next step is grounded in nearby code, a small
  hypothesis, and an executable validation check

Task-boundary confidence:

- confidence is lower when the question is whether the current leaf truly
  authorizes the adjacent class of work rather than merely making it look like a
  sensible next move

Those two confidence bands should not be merged into one status feeling.

## Proposed subtask discipline

When a task leaf starts broad but the next work becomes implementation-shaped,
prefer an explicit child task before crossing the boundary.

Recommended discipline:

1. keep the parent leaf at the policy, review, or decision level
2. create one child task for each concrete implementation slice
3. state the exact allowed surface for that slice in the child
4. state the cheapest falsifiable validation check before editing
5. keep confidence reports split between local-slice confidence and
   task-boundary confidence
6. if compact happens, preserve the active leaf, allowed scope, next check, and
   out-of-bounds surfaces explicitly in the compacted state

## Practical rule for future work

If the next step can be described as "still the same work, but now in code",
that is usually the moment to ask whether a dedicated child task should exist.

If the answer matters, create the child task first instead of relying on memory
or momentum.

## Suggested future leaf shape

If this note is promoted into lineage later, the future continuity leaf should
probably capture:

- why compact can weaken boundary memory even when local grounding survives
- why subtask discipline improves autonomy instead of slowing it down
- how to separate local validation confidence from task-boundary confidence
- what minimum context a compact must preserve so the next agent pass does not
  drift into a merely adjacent slice

## Narrow conclusion

The main lesson is not "avoid autonomy".

The main lesson is that autonomy gets better when broad review leaves hand off
to explicit implementation subtasks before the work crosses from policy or
schema interpretation into concrete runtime edits.