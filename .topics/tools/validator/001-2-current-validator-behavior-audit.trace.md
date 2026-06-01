# Continuity Context

- Envelope Schema: [tiinex.continuation.v1](https://github.com/Tiinex/docs/blob/613f592976c75e73deee101a555674b1cce08304/.topics/.schemas/tiinex.continuation.v1.md)
- Parent
  - Parent Schema: [tiinex.topic.v1](https://github.com/Tiinex/docs/blob/613f592976c75e73deee101a555674b1cce08304/.topics/.schemas/tiinex.topic.v1.md)
  - Created At: 2026-05-30 00:00:00
  - Trace: [001.trace.md](001.trace.md)
  - Origin:
    - [relative](001.trace.md)
    - [absolute](C:/Users/micro/Documents/Repos/Tiinex/ai-provenance/.topics/tools/validator/001.trace.md)
- Current
  - Current Schema: [tiinex.evidence.v1](https://github.com/Tiinex/docs/blob/613f592976c75e73deee101a555674b1cce08304/.topics/.schemas/tiinex.evidence.v1.md)
  - Created At: 2026-05-31 21:15:58
  - Authors: Linus
  - Why: Preserves a code-grounded audit of what the current continuity validator actually validates today so later validator work does not assume broader schema or origin checks already exist.
  - Summary: Evidence audit of the current ai-provenance continuity validator showing that it validates checksum and traversal surfaces, plus runtime-trace headings, but not parent-schema conformance or origin-shape lawfulness.

---

# Evidence: Current Validator Behavior Audit

## Provenance

- Source: direct code reading of the current ai-provenance validator implementation and its adjacent tests on commit `f76e424f7e5e0628efe04226a5ed97425a1301cb`
- Core Validator Implementation:
  - [relative](../../../../ides/vscode/src/traceableContinuityValidation.js)
  - [absolute](C:/Users/micro/Documents/Repos/Tiinex/ai-provenance/ides/vscode/src/traceableContinuityValidation.js)
  - [browse + git](https://github.com/Tiinex/ai-provenance/blob/f76e424f7e5e0628efe04226a5ed97425a1301cb/ides/vscode/src/traceableContinuityValidation.js)
- Type Surface:
  - [relative](../../../../ides/vscode/src/traceableContinuityValidation.d.ts)
  - [absolute](C:/Users/micro/Documents/Repos/Tiinex/ai-provenance/ides/vscode/src/traceableContinuityValidation.d.ts)
  - [browse + git](https://github.com/Tiinex/ai-provenance/blob/f76e424f7e5e0628efe04226a5ed97425a1301cb/ides/vscode/src/traceableContinuityValidation.d.ts)
- VS Code Wiring:
  - [relative](../../../../ides/vscode/src/extension.ts)
  - [absolute](C:/Users/micro/Documents/Repos/Tiinex/ai-provenance/ides/vscode/src/extension.ts)
  - [browse + git](https://github.com/Tiinex/ai-provenance/blob/f76e424f7e5e0628efe04226a5ed97425a1301cb/ides/vscode/src/extension.ts)
- Test Surface:
  - [relative](../../../../ides/vscode/tests/test.mjs)
  - [absolute](C:/Users/micro/Documents/Repos/Tiinex/ai-provenance/ides/vscode/tests/test.mjs)
  - [browse + git](https://github.com/Tiinex/ai-provenance/blob/f76e424f7e5e0628efe04226a5ed97425a1301cb/ides/vscode/tests/test.mjs)
- Representation: code-grounded audit with behavior summarized from the current implementation and test surface, not from broad historical inference

## Evidence Material

- The validator parses a narrow continuity shape: `Current Schema`, `Parent Schema`, `Parent Trace`, `Parent -> Origin` entries for `relative`, `absolute`, and `browse + git`, footer integrity fields, optional `## Traceable State` JSON, and markdown headings.
- Backward traversal chooses parents in this exact order: `Traceable State parentTracePath`, then `Parent Trace`, then `Parent Origin relative`. `browse + git` and `absolute` are only enough to mark the parent as external-only; they are not otherwise validated as lawful origin targets.
- The continuity footer check only computes `computeTraceableContinuityChecksumSha256(markdown)` against the current artifact body. The implementation records `Towards`, but does not dereference or validate that the footer target actually matches the declared parent relation.
- The continuity finding surface only emits a finding when the current artifact footer checksum mismatches. Missing footer proof and unsupported checksum methods are represented as internal statuses, but are not emitted as machine findings in the current finding set.
- Direct-parent checksum validation only runs when `Traceable State parentTracePath` exists. That path can emit missing-parent, unreadable-parent, checksum-mismatch, and cycle-detected findings. If the direct-parent checksum is absent, the core returns `legacy-no-checksum`, but that status does not become a surfaced finding.
- Runtime structure validation only applies when the current schema id resolves to `tiinex.runtime.trace.v1`. In that case, it checks for a fixed set of required and recommended heading names, plus optional state sections. It does not generally validate arbitrary `.trace.md` bodies against their declared current schema.
- The declared finding universe is currently limited to ten finding codes across four categories: continuity-integrity, direct-parent-integrity, runtime-trace-structure, and backward-traversal.
- The VS Code auto-diagnostics path applies to markdown files ending in `.trace.md` and markdown files under `.topics/.schemas/`. It re-runs after edits with a debounce timer and maps core findings with `surfaces: ["problems"]` onto top-of-document diagnostics.

## Exact Current Finding Surface

- `continuity-checksum-mismatch`
- `traceable-parent-missing-parent`
- `traceable-parent-unreadable-parent`
- `traceable-parent-checksum-mismatch`
- `traceable-parent-cycle-detected`
- `runtime-required-sections-missing`
- `runtime-recommended-sections-missing`
- `runtime-technical-detail-sections-missing`
- `backward-validation-unreadable-parent`
- `backward-validation-cycle-detected`

## Explicit Non-Checks In The Current Implementation

- It does not validate whether a general `.trace.md` artifact satisfies the body expectations of its declared current schema or parent schema.
- It does not validate whether a schema note itself satisfies the body expectations of its parent schema.
- It does not validate whether `Origin` entries are semantically lawful for their labels, including whether `browse + git` actually points to a commit-pinned Git origin rather than to a weaker locator.
- It does not validate whether `Parent Schema`, `Current Schema`, `Created At`, `Why`, `Summary`, or `Authors` satisfy stronger envelope policy beyond being parsable as text.
- It does not validate whether the footer `Towards` reference is the right target for the proof; today it only validates whether the stored checksum matches the current file body under the canonicalization rule.

## Supports

- Claim: the current validator is broader than checksum-only, but still materially narrower than a full continuity-lawfulness validator.
- Claim: the current validator does not presently enforce origin-shape lawfulness or schema-parent conformance.
- Claim: the current validator already provides a useful auto-running editor surface, but its machine finding scope remains limited to checksum, traversal, and runtime-trace heading checks.

## Interpretation Notes and Limits

- This audit is grounded in the current ai-provenance VS Code validator implementation and adjacent tests on the cited commit, not in a full repo-wide runtime experiment matrix.
- The evidence here is about what the current validator code does today, not what the root topic intends it to do later.
- If another validator surface exists outside this implementation path, that would need its own audit rather than being inferred from this one.

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [001.trace.md](001.trace.md)
  - Value: vfDxrADeEz1b8-L5bOeCEPayWxs9e-0HKvrmKfVyRZM