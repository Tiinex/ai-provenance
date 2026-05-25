# TRACEABLE Drift Continuity Probe

This artifact captures a practical long-distance TRACEABLE probe for measuring drift and continuation quality across a multi-turn lineage.

The goal is not to test whether the lane can repeat earlier text on demand.

The goal is to test whether early valuable signal still steers later behavior after several distracting turns.

## Intent

- Measure whether early-turn signal survives until steps 9-10.
- Measure whether that signal still changes the behavior of the answer, not just the wording of a recap.
- Measure whether later low-signal turns overwrite earlier high-value signal.
- Measure whether lineage, carry, and inspection surfaces stay coherent deep into a continuation chain.

## Early Signals

Plant two early signals and keep them singular and concrete.

- Signal 1: one clear priority.
- Signal 2: one clear constraint.

Examples of good signals:

- Priority: the main thing the sender wants optimized later.
- Constraint: one thing the lane should not assume, violate, or optimize away later.

Avoid vague or poetic signals. They should be easy to recognize and easy to misuse later if drift occurs.

## 10-Step Probe Shape

1. Clean baseline opening.
2. Plant the priority.
3. Plant the constraint.
4. Ask a natural follow-up that does not require recalling step 2 or 3.
5. Continue on a legitimate side track.
6. Add a style or compression request, such as one-sentence brevity.
7. Add a mildly ambiguous continuation turn.
8. Add another distracting but valid turn.
9. Reactivate the earlier priority indirectly and see whether it still governs the answer.
10. Require both the earlier priority and the earlier constraint at once.

## Critical Design Rule

Do not turn the late probe into trivia such as "what did I say earlier?"

Prefer behavioral checks such as:

- answer using my earlier priority
- answer while respecting my earlier constraint
- recommend a next step that still reflects what I said several turns ago

This makes drift visible in behavior, not just in recall wording.

## Recommended Run Setup

Keep the live probe narrow and stable.

- Use `DIRECT` continuation the whole way.
- Keep the same `agentRole` for the full chain.
- Keep the same `parentRoles` for the full chain.
- Keep the same explicit model for the full chain.
- Keep the same export folder for the full chain.
- Keep each turn small and bounded.

The point is to isolate drift and continuity, not to mix in role changes, model changes, or tool-rich task solving.

## Checkpoints

Do not inspect every node in the chain.

Preferred checkpoint nodes:

- Step 1
- Step 4
- Step 7
- Step 10

Preferred inspect surfaces:

- `conversation-brief`
- `lineage`
- `latest-carry-package`
- `latest-role-state` when sender continuity matters

## Pass Signals

- The earlier priority still influences late-turn advice.
- The earlier constraint is still obeyed late in the chain.
- Later low-signal turns do not silently outrank earlier important signal.
- `parentTracePath`, `lineageLabel`, and `lineageDepth` remain coherent.
- Inspection remains bounded and useful without falling back to raw evidence reading.

## Failure Signals

- The lane can restate the earlier signal but no longer uses it.
- The lane obeys the most recent low-value turn while forgetting the earlier priority.
- The lane violates the earlier constraint at steps 9-10.
- The lane treats the late probe as a fresh standalone request instead of a continuation.
- Carry or lineage surfaces become noisy, contradictory, or too bloated to inspect efficiently.

## Why This Probe Exists

TRACEABLE should preserve meaningful continuity, not just produce plausible local answers.

This probe exists to catch the case where a lane reads something valuable early, survives several turns, and then silently drifts by the time that early signal becomes important again.