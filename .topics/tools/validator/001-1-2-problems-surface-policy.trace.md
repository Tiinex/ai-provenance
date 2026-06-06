# Continuity Context

- Envelope Schema: [tiinex.root.v1](https://github.com/Tiinex/docs/blob/0e6d169685d56c913cb890ba568a96b366ebd4bf/.topics/.schemas/tiinex.root.v1.schema.md)
- Parent
  - Parent Schema: [tiinex.decision.v1](https://github.com/Tiinex/docs/blob/f6106423ab395137600bd3633a56296223006671/.topics/.schemas/tiinex.decision.v1.schema.md)
  - Created At: 2026-05-30 00:20:00
  - Trace: [001-1-finding-taxonomy.trace.md](001-1-finding-taxonomy.trace.md)
  - Origin:
    - [relative](001-1-finding-taxonomy.trace.md)
    - [absolute](C:/Users/micro/Documents/Repos/Tiinex/ai-provenance/.topics/tools/validator/001-1-finding-taxonomy.trace.md)
    - [browse + git](https://github.com/Tiinex/ai-provenance/blob/4c697e188115489da37587b3145186c198c9166f/.topics/tools/validator/001-1-finding-taxonomy.trace.md)
- Current
  - Current Schema: [tiinex.decision.v1](https://github.com/Tiinex/docs/blob/f6106423ab395137600bd3633a56296223006671/.topics/.schemas/tiinex.decision.v1.schema.md)
  - Created At: 2026-06-02 22:32:04
  - Authors: Anchor
  - Why: Fixes the Problems-surface policy so the validator reports only machine findings and does not invent new classes at the editor layer.
  - Summary: Decision note for what should and should not appear directly in Problems for the current validator line.

---

# Problems Surface Policy

## Decision

- State: accepted
- Subject: which validator outcomes should appear directly in Problems
- Decision: only machine findings that belong to the normalized finding set and are declared for Problems should appear directly in Problems; internal statuses and report-only states stay out of Problems

## Basis

- the validator root is machine-first and separates finding verification from content cleanup
- the current taxonomy already distinguishes surfaced findings from internal or report-only statuses
- the false-positive log shows the cases that should remain non-actionable at the Problems layer

## Consequences

- `legacy-no-checksum` stays internal/report-only unless the machine taxonomy later promotes it
- unsupported checksum methods stay out of Problems until they become explicit machine findings
- the editor layer does not invent new failure classes for the user
- bounded validation reports can still explain suppressed or internal states without turning them into actionable diagnostics

## Operational Effect

- the validator code may emit additional detail in bounded reports, but Problems should remain conservative and taxonomy-bound
- if a future state deserves Problems visibility, it must first become a machine finding with a declared default surface

## Review Conditions

- revisit if missing-proof versus broken-proof needs its own surfaced machine code
- revisit if unsupported checksum methods become actionable rather than internal

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [001-1-finding-taxonomy.trace.md](001-1-finding-taxonomy.trace.md)
  - Value: U3AhNc1N3mFpgV4wAMVIIZlRqbXeMLuBy45GOGBvztY