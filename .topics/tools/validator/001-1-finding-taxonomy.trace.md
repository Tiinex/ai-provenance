# Continuity Context

- Envelope Schema: [tiinex.root.v1](https://github.com/Tiinex/docs/blob/0e6d169685d56c913cb890ba568a96b366ebd4bf/.topics/.schemas/tiinex.root.v1.schema.md)
- Parent
  - Parent Schema: [tiinex.topic.v1](https://github.com/Tiinex/docs/blob/4a64e25b9d4dc657104bee51877d140ee93f4bc2/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Created At: 2026-05-30 00:00:00
  - Trace: [001.trace.md](001.trace.md)
  - Origin:
    - [relative](001.trace.md)
    - [absolute](C:/Users/micro/Documents/Repos/Tiinex/ai-provenance/.topics/tools/validator/001.t    - [browse + git](https://github.com/Tiinex/ai-provenance/blob/4c697e188115489da37587b3145186c198c9166f/.topics/tools/validator/001.trace.md)
race.md)
- Current
  - Current Schema: [tiinex.decision.v1](https://github.com/Tiinex/docs/blob/f6106423ab395137600bd3633a56296223006671/.topics/.schemas/tiinex.decision.v1.schema.md)
  - Created At: 2026-05-30 00:20:00
  - Why: Fixes the first operational meaning of continuity-validator findings so the core and Problems surface stop drifting apart.
  - Summary: Decision child defining the current machine finding taxonomy, category boundaries, and default surface policy for continuity validation.

---

# Validator Finding Taxonomy V1

## Decision

- State: accepted for the current validator V1 line
- Subject: normalized machine finding classes for continuity validation
- Decision: the continuity validator should emit stable machine findings that separate defect code, defect category, severity, and default human surfaces before any UI layer summarizes them

## Category Map

- `continuity-integrity`: findings about the current artifact's own continuity footer proof
- `direct-parent-integrity`: findings about explicit `Traceable State` parent linkage and stored parent checksum proof
- `runtime-trace-structure`: findings about required or recommended structure inside `tiinex.runtime.trace.v1`
- `backward-traversal`: findings about why backward parent traversal stopped before a clean root completion

## Current Codes

- `continuity-checksum-mismatch`
  - Meaning: the current artifact footer checksum does not match the current artifact body
  - Default Severity: error
  - Default Surfaces: Problems, report
- `traceable-parent-missing-parent`
  - Meaning: `Traceable State parentTracePath` resolves to no readable local parent artifact
  - Default Severity: error
  - Default Surfaces: Problems, report
- `traceable-parent-unreadable-parent`
  - Meaning: `Traceable State parentTracePath` resolves to a parent path that exists in the chain logic but could not be read successfully
  - Default Severity: error
  - Default Surfaces: Problems, report
- `traceable-parent-checksum-mismatch`
  - Meaning: the stored direct-parent checksum does not match the resolved parent artifact body
  - Default Severity: error
  - Default Surfaces: Problems, report
- `traceable-parent-cycle-detected`
  - Meaning: the explicit direct-parent linkage would create a cycle
  - Default Severity: error
  - Default Surfaces: Problems, report
- `runtime-required-sections-missing`
  - Meaning: a `tiinex.runtime.trace.v1` artifact is missing required top-level runtime sections
  - Default Severity: warning
  - Default Surfaces: Problems, report
- `runtime-recommended-sections-missing`
  - Meaning: a `tiinex.runtime.trace.v1` artifact is missing recommended but non-required top-level runtime sections
  - Default Severity: information
  - Default Surfaces: Problems, report
- `runtime-technical-detail-sections-missing`
  - Meaning: a `tiinex.runtime.trace.v1` artifact is missing recommended technical-detail sections
  - Default Severity: information
  - Default Surfaces: Problems, report
- `backward-validation-unreadable-parent`
  - Meaning: backward traversal stopped because an ancestor parent artifact could not be read
  - Default Severity: warning
  - Default Surfaces: Problems, report
- `backward-validation-cycle-detected`
  - Meaning: backward traversal stopped because the lineage looped back onto itself
  - Default Severity: error
  - Default Surfaces: Problems, report

## Surface Rule

- Problems may translate machine severities into editor severities, but they should not invent new finding classes.
- The bounded validation report should render the same core finding codes rather than a separate local taxonomy.
- Future false-positive reduction should prefer changing the machine finding emission rule or the declared default surfaces rather than teaching each consumer its own exception table.

## Review Conditions

- Revisit when legacy or draft-era artifacts need explicit machine finding codes instead of consumer-side suppression only.
- Revisit when unsupported checksum methods need to become a first-class surfaced finding instead of remaining report-only context.
- Revisit when missing-proof and broken-proof need to be distinguished more explicitly in the machine finding set.

## Traceable State

```json
{

    "parentTraceChecksumSha256": "M2-6QLkEeiAsxEgVZ_NOByRUAUq57EPXVbj6gQ-nH9A",
    "lineageLabel": "001-1",
    "lineageDepth": 2
  }
}
```

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [001.trace.md](001.trace.md)
  - Value: M2-6QLkEeiAsxEgVZ_NOByRUAUq57EPXVbj6gQ-nH9Arl-c14n-v1
  - Towards: [001.trace.md](001.trace.md)
  - Value: nvhLEdk3h4neusmqObX3IhmUOlnvjBYoC8kvGGG1l4w6srl-c14n-v1
  - Towards: [001.trace.md](001.trace.md)
  - Value: 5YvpEu0usaVeD8iOfQNpEEsOADsFenPQaXrCq7_pZGM