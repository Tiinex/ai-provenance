# Continuity Context

- Envelope Schema: [tiinex.root.v1](https://github.com/Tiinex/docs/blob/f6106423ab395137600bd3633a56296223006671/.topics/.schemas/tiinex.root.v1.schema.md)
- Parent
  - Parent Schema: [tiinex.evidence.v1](https://github.com/Tiinex/docs/blob/f6106423ab395137600bd3633a56296223006671/.topics/.schemas/tiinex.evidence.v1.schema.md)
  - Created At: 2026-05-29 01:37:57
  - Trace: [001-2-1-existing-tooling-evidence.trace.md](001-2-1-existing-tooling-evidence.trace.md)
  - Origin:
    - [relative](001-2-1-existing-tooling-evidence.trace.md)
    - [absolute](C:/Users/micro/Documents/Repos/Tiinex/ai-provenance/.topics/trace-format/tools/001-2-1-existing-tooling-evidence.trace.md)
    - [browse + git](https://github.com/Tiinex/ai-provenance/blob/4c697e188115489da37587b3145186c198c9166f/.topics/trace-format/tools/001-2-1-existing-tooling-evidence.trace.md)
- Current
  - Current Schema: [tiinex.decision.v1](https://github.com/Tiinex/docs/blob/f6106423ab395137600bd3633a56296223006671/.topics/.schemas/tiinex.decision.v1.schema.md)
  - Created At: 2026-05-29 02:17:56
  - Why: Captures the landed operator decisions that change how schema-lineage repair V1 should be planned and executed.
  - Summary: Decision leaf establishing domain-bound audit, decision-driven repair, and separation between audit and repair surfaces.

---

# Schema Lineage Repair V1 Operating Decisions

## Decision

- State: accepted for current V1 planning
- Subject: the next bounded planning and implementation slice for schema-lineage repair tooling

Current operative decisions:

1. V1 should not be hard-limited by one folder boundary such as `docs/.topics`
   when the lineage under review belongs to the same controlled multi-root
   domain.
2. The tooling should still remain domain-bounded and operator-steerable rather
   than drifting into broad autonomous repo repair.
3. Audit and repair should be treated as separate surfaces or modes rather than
   one blended behavior.
4. Repair may be developed alongside audit, but repair must remain
   decision-driven rather than silently self-authorizing.
5. Proposal and repair behavior may span several links when the workspace and
   carried provenance make those links recoverable enough to inspect.
6. Repair history should be preserved in the artifact itself through a
   recommended repair note under carried origin, for example a `Repaired`
   structure with at least type and reason.

## Basis

- The current workspace is a controlled multi-root domain rather than a single
  isolated repo.
- Folder-only scope would weaken the intended value of the validation and repair
  surface by failing exactly where shared lineage crosses repo boundaries.
- The evidence leaf already shows that the problem space involves origin,
  schema references, and published targets across more than one repo surface.
- Operator-facing and agent-facing interfaces both need a result shape that can
  be inspected without hidden inference.
- Separation between audit and repair reduces ambiguity about whether the tool
  is diagnosing, proposing, or mutating.

## Consequences

- The old narrow wording "V1 equals docs/.topics only" should not govern the
  next planning pass.
- The next planning pass should define a domain-bound audit surface instead of a
  path-bound one.
- The next planning pass should specify what makes a target verifierbar across a
  shared multi-root domain.
- The next planning pass should define a UX-friendly findings payload that works
  both for direct user reading and for tool-mediated agent use.
- The next planning pass should define the repair-history note shape before
  repair output is treated as stable.

## Review Conditions

- Revisit these decisions after the first read-only audit output and first
  decision-driven repair preview exist.
- Revisit if the multi-root domain assumption stops being truthful for the
  target workspace.
- Revisit if the proposed repair-history note creates more drift than clarity.

## Immediate Next Questions

The next unresolved planning questions are now narrower:

1. What exact rules make a cross-repo target verifierbar enough for proposal or
   repair inside one shared domain?
2. What is the smallest findings payload that stays readable in both human and
   agent interfaces?
3. What exact shape should the recommended repair-history note take so it
   remains useful without bloating the artifact?

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [001-2-1-existing-tooling-evidence.trace.md](001-2-1-existing-tooling-evidence.trace.md)
  - Value: WK-dAfHLH8U21mNO5Wx8nM1GlvTnmMeYdW4z3D8-ofw