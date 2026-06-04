# Continuity Context

- Envelope Schema: [tiinex.root.v1](https://github.com/Tiinex/docs/blob/0e6d169685d56c913cb890ba568a96b366ebd4bf/.topics/.schemas/tiinex.root.v1.schema.md)
- Parent
  - Parent Schema: [tiinex.decision.v1](https://github.com/Tiinex/docs/blob/613f592976c75e73deee101a555674b1cce08304/.topics/.schemas/tiinex.decision.v1.md)
  - Created At: 2026-05-30 00:20:00
  - Trace: [001-1-finding-taxonomy.trace.md](001-1-finding-taxonomy.trace.md)
  - Origin:
    - [relative](001-1-finding-taxonomy.trace.md)
    - [absolute](C:/Users/micro/Documents/Repos/Tiinex/ai-provenance/.topics/tools/validator/001-1-finding-taxonomy.trace.md)
- Current
  - Current Schema: [tiinex.evidence.v1](https://github.com/Tiinex/docs/blob/613f592976c75e73deee101a555674b1cce08304/.topics/.schemas/tiinex.evidence.v1.md)
  - Created At: 2026-06-02 22:32:04
  - Authors: Anchor
  - Why: Preserves the short validator false-positive log so later policy and Problems-surface work can cite concrete repro notes instead of vague judgment.
  - Summary: False-positive log for the current validator scope, focused on cases that should stay unreported or be treated as legacy/internal states.

---

# Validator False-Positive Log

## Provenance

- Source: current code-grounded validator audit and taxonomy notes
- Related Artifacts:
  - [001-1.trace.md](001-1.trace.md)
  - [001-2-current-validator-behavior-audit.trace.md](001-2-current-validator-behavior-audit.trace.md)
- Representation: short reproducible notes, not a full incident catalog

## Evidence Material

### Case 1: Legacy-no-checksum is not broken lineage

- Repro note: evaluate a child trace whose `Traceable State` includes `parentTracePath` but omits `parentTraceChecksumSha256`
- Observed current behavior: the core returns `legacy-no-checksum`
- Why this matters: the current validator treats the absence as legacy internal state, not as a surfaced Problems finding

### Case 2: Unsupported checksum method stays report-only

- Repro note: use a footer integrity method other than `sha256-base64url-c14n-v1`
- Observed current behavior: the parser can describe the method as unsupported, but the current finding surface does not promote it into a separate machine finding
- Why this matters: this is a boundary case for policy, not a normal broken-lineage signal

## Interpretation Limits

- This log documents the current suppression boundary and internal statuses, not a broad list of every future false-positive class.
- It should be read together with the decision note on Problems-vs-report policy.
- The current validator also does not enforce origin-shape lawfulness or schema-parent conformance, so those gaps are not counted here as surfaced false positives yet.

## Follow-up

- attach the Problems policy decision next so these notes can be tied to an explicit surface rule
- add more repro cases only when a new validator finding or suppression boundary appears

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [001-1-finding-taxonomy.trace.md](001-1-finding-taxonomy.trace.md)
  - Value: 290Z_NqmkN-9YdwsFmv_UeyeONQkwji0bw2JBe_gVJo