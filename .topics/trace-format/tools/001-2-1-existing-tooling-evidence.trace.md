# Continuity Context

- Envelope Schema: [tiinex.continuation.v1](https://github.com/Tiinex/docs/blob/134ead70f229cd7a29fad1ada5aa0dd0f2b02ff9/.topics/.schemas/tiinex.continuation.v1.md)
- Parent
  - Parent Schema: [tiinex.task.v1](https://github.com/Tiinex/docs/blob/134ead70f229cd7a29fad1ada5aa0dd0f2b02ff9/.topics/.schemas/tiinex.task.v1.md)
  - Created At: 2026-05-28 21:48:32
  - Trace: [001-2-schema-lineage-repair.trace.md](001-2-schema-lineage-repair.trace.md)
  - Origin:
    - [relative](001-2-schema-lineage-repair.trace.md)
    - [absolute](C:/Users/micro/Documents/Repos/Tiinex/ai-provenance/.topics/trace-format/tools/001-2-schema-lineage-repair.trace.md)
- Current
  - Current Schema: [tiinex.evidence.v1](https://github.com/Tiinex/docs/blob/134ead70f229cd7a29fad1ada5aa0dd0f2b02ff9/.topics/.schemas/tiinex.evidence.v1.md)
  - Created At: 2026-05-29 01:37:57
  - Why: Preserves the concrete references that currently justify a bounded V1 schema-lineage repair solution and its current confidence limits.
  - Summary: Evidence slice showing that existing code, contract artifacts, and repeated docs repairs are enough for audit-plus-proposal V1 but not for broad auto-apply.

---

# Existing Tooling Evidence For Schema-Lineage Repair V1

## Supported Claim

The current ecosystem already contains enough evidence to justify a first repair
surface that:

- audits `docs/.topics`
- classifies findings
- proposes bounded repairs
- stops on weak or ambiguous cases

The current ecosystem does not yet contain enough evidence to justify broad
automatic apply behavior across files or repositories.

## Provenance

- Scope reviewed: `ai-provenance` tooling code, `ai-provenance` trace-format
  design artifacts, and repeated observed repairs in `docs/.topics`
- Representation: curated evidence summary with exact file references
- Review basis: existing implementation, existing contract notes, existing
  validation checklist, and repeated real repair cases already performed by hand

## Evidence Material

### Evidence 1

- Source: `traceableLineageIntegrity.ts`
- Origin:
  - [relative](../../../ides/vscode/src/traceableLineageIntegrity.ts)
  - [absolute](C:/Users/micro/Documents/Repos/Tiinex/ai-provenance/ides/vscode/src/traceableLineageIntegrity.ts)
  - [browse + git](https://github.com/Tiinex/ai-provenance/blob/7bf064bd79a7adf336323e1eea5eaa869fb7030a/ides/vscode/src/traceableLineageIntegrity.ts)
- Representation: code reading
- Supports: bounded checksum and parent-integrity diagnostics already exist as
  concrete implementation, not just as a proposal

What it shows:

- checksum canonicalization is already explicit and deterministic
- the code already distinguishes statuses such as `missing-parent`,
  `unreadable-parent`, `checksum-mismatch`, and `cycle-detected`
- this is enough to support a first repair surface that can inspect and explain
  integrity problems without inventing integrity semantics from scratch

### Evidence 2

- Source: `implementation-contract.md`
- Origin:
  - [relative](../implementation-contract.md)
  - [absolute](C:/Users/micro/Documents/Repos/Tiinex/ai-provenance/.topics/trace-format/implementation-contract.md)
  - [browse + git](https://github.com/Tiinex/ai-provenance/blob/7bf064bd79a7adf336323e1eea5eaa869fb7030a/.topics/trace-format/implementation-contract.md)
- Representation: contract excerpt
- Supports: the git-driver and origin-backed target model is already described
  clearly enough to constrain V1 target resolution

What it shows:

- the design already expects git-driver classification, parsing, rendering, and
  committed-target validation
- the contract already prefers commit-pinned origin-backed cross-repo storage
- the first implementation slice is already scoped in a way that matches a
  bounded audit-first V1 rather than a broad autonomous rewrite tool

### Evidence 3

- Source: `validation-checklist.md`
- Origin:
  - [relative](../validation-checklist.md)
  - [absolute](C:/Users/micro/Documents/Repos/Tiinex/ai-provenance/.topics/trace-format/validation-checklist.md)
  - [browse + git](https://github.com/Tiinex/ai-provenance/blob/7bf064bd79a7adf336323e1eea5eaa869fb7030a/.topics/trace-format/validation-checklist.md)
- Representation: validation checklist
- Supports: V1 already has a concrete acceptance surface for same-repo,
  cross-repo, git-driver, timestamp, and integrity behavior

What it shows:

- same-repo relative behavior and cross-repo origin-backed behavior are already
  testable contract checks
- commit-pinned origin rendering and round-trip parsing are already expected
- repair tooling is already expected to detect and improve weakened links later

### Evidence 4

- Source: `001-2-schema-lineage-repair.trace.md`
- Origin:
  - [relative](001-2-schema-lineage-repair.trace.md)
  - [absolute](C:/Users/micro/Documents/Repos/Tiinex/ai-provenance/.topics/trace-format/tools/001-2-schema-lineage-repair.trace.md)
- Representation: bounded task contract
- Supports: the repair problem is already reduced to a small failure taxonomy
  with explicit stop conditions rather than a vague "fix lineage" ambition

What it shows:

- the current working task now distinguishes `stale-target`,
  `missing-origin-backed-target`, `wrong-published-parent`, `digest-stale`, and
  `ambiguous-candidate`
- the task explicitly separates `audit finding`, `repair proposal`, and
  `applied repair`
- the task already says that ambiguous or weakly grounded cases should stop

### Evidence 5

- Source: `tiinex.schema.v1.md`
- Origin:
  - [relative](../../../docs/.topics/.schemas/tiinex.schema.v1.md)
  - [absolute](C:/Users/micro/Documents/Repos/Tiinex/docs/.topics/.schemas/tiinex.schema.v1.md)
  - [browse + git](https://github.com/Tiinex/docs/blob/134ead70f229cd7a29fad1ada5aa0dd0f2b02ff9/.topics/.schemas/tiinex.schema.v1.md)
- Representation: schema contract
- Supports: schema-bearing fields and origin blocks already have enough shared
  rules that a V1 audit can detect meaningful deviations

What it shows:

- schema references across repos should use origin-backed URLs when available
- schema artifacts should keep origin visible and distinguish required versus
  recommended structure
- withheld information should be marked explicitly rather than blurred away

### Evidence 6

- Source: `tiinex.continuation.v1.md`
- Origin:
  - [relative](../../../docs/.topics/.schemas/tiinex.continuation.v1.md)
  - [absolute](C:/Users/micro/Documents/Repos/Tiinex/docs/.topics/.schemas/tiinex.continuation.v1.md)
  - [browse + git](https://github.com/Tiinex/docs/blob/134ead70f229cd7a29fad1ada5aa0dd0f2b02ff9/.topics/.schemas/tiinex.continuation.v1.md)
- Representation: schema contract
- Supports: ancestry, parent blocks, browseable targets, and footer semantics
  already have a shared envelope contract that repair findings can judge against

What it shows:

- schema links to another repository should prefer origin-backed URLs when they
  exist
- parent blocks should preserve real ancestry rather than cosmetically cleaner
  but false lineage
- relation-oriented footer behavior already has a defined preferred method form

### Evidence 7

- Source: `docs/.topics` manual repair set
- Repair Cases:
  - `tiinex.archive.v1.md`
    - Origin:
      - [relative](../../../docs/.topics/.schemas/tiinex.archive.v1.md)
      - [absolute](C:/Users/micro/Documents/Repos/Tiinex/docs/.topics/.schemas/tiinex.archive.v1.md)
      - [browse + git](https://github.com/Tiinex/docs/blob/134ead70f229cd7a29fad1ada5aa0dd0f2b02ff9/.topics/.schemas/tiinex.archive.v1.md)
  - `tiinex.zip.v1.md`
    - Origin:
      - [relative](../../../docs/.topics/.schemas/tiinex.zip.v1.md)
      - [absolute](C:/Users/micro/Documents/Repos/Tiinex/docs/.topics/.schemas/tiinex.zip.v1.md)
      - [browse + git](https://github.com/Tiinex/docs/blob/134ead70f229cd7a29fad1ada5aa0dd0f2b02ff9/.topics/.schemas/tiinex.zip.v1.md)
  - `kickstarter/001.trace.md`
    - Origin:
      - [relative](../../../docs/.topics/kickstarter/001.trace.md)
      - [absolute](C:/Users/micro/Documents/Repos/Tiinex/docs/.topics/kickstarter/001.trace.md)
      - [browse + git](https://github.com/Tiinex/docs/blob/134ead70f229cd7a29fad1ada5aa0dd0f2b02ff9/.topics/kickstarter/001.trace.md)
  - `rfc/001.trace.md`
    - Origin:
      - [relative](../../../docs/.topics/rfc/001.trace.md)
      - [absolute](C:/Users/micro/Documents/Repos/Tiinex/docs/.topics/rfc/001.trace.md)
      - [browse + git](https://github.com/Tiinex/docs/blob/134ead70f229cd7a29fad1ada5aa0dd0f2b02ff9/.topics/rfc/001.trace.md)
  - `rfc/001-1.trace.md`
    - Origin:
      - [relative](../../../docs/.topics/rfc/001-1.trace.md)
      - [absolute](C:/Users/micro/Documents/Repos/Tiinex/docs/.topics/rfc/001-1.trace.md)
      - [browse + git](https://github.com/Tiinex/docs/blob/134ead70f229cd7a29fad1ada5aa0dd0f2b02ff9/.topics/rfc/001-1.trace.md)
  - `rfc/rfc-editor-friendly/001.trace.md`
    - Origin:
      - [relative](../../../docs/.topics/rfc/rfc-editor-friendly/001.trace.md)
      - [absolute](C:/Users/micro/Documents/Repos/Tiinex/docs/.topics/rfc/rfc-editor-friendly/001.trace.md)
      - [browse + git](https://github.com/Tiinex/docs/blob/134ead70f229cd7a29fad1ada5aa0dd0f2b02ff9/.topics/rfc/rfc-editor-friendly/001.trace.md)
  - `rfc/rfc-editor-friendly/001-1-draft.trace.md`
    - Origin:
      - [relative](../../../docs/.topics/rfc/rfc-editor-friendly/001-1-draft.trace.md)
      - [absolute](C:/Users/micro/Documents/Repos/Tiinex/docs/.topics/rfc/rfc-editor-friendly/001-1-draft.trace.md)
      - [browse + git](https://github.com/Tiinex/docs/blob/134ead70f229cd7a29fad1ada5aa0dd0f2b02ff9/.topics/rfc/rfc-editor-friendly/001-1-draft.trace.md)
  - `rfc/rfc-editor-friendly/001-2-rfc-envelope.trace.md`
    - Origin:
      - [relative](../../../docs/.topics/rfc/rfc-editor-friendly/001-2-rfc-envelope.trace.md)
      - [absolute](C:/Users/micro/Documents/Repos/Tiinex/docs/.topics/rfc/rfc-editor-friendly/001-2-rfc-envelope.trace.md)
      - [browse + git](https://github.com/Tiinex/docs/blob/134ead70f229cd7a29fad1ada5aa0dd0f2b02ff9/.topics/rfc/rfc-editor-friendly/001-2-rfc-envelope.trace.md)
- Representation: observed manual repair cases in a real repo
- Supports: the failure modes are not hypothetical; they recur in real lineage
  material and are narrow enough to classify

What it shows:

- broken or stale `browse + git` targets were observed in real schema files
- plain-text schema fields instead of browseable schema links were observed in
  real `.trace.md` files
- several prose RFC artifacts were carrying the wrong body schema and had to be
  reclassified to `tiinex.topic.v1`
- these are exactly the kinds of bounded findings a first repair surface should
  detect and explain before anyone attempts automatic mutation

## Interpretation Limits

- This evidence is strong enough for `audit finding` and `repair proposal`.
- This evidence is not strong enough for broad `applied repair` across several
  files or repositories without explicit operator review.
- Existing code already supports checksum evaluation, but not yet the whole
  candidate-selection and rewrite surface for origin and schema repair.
- The docs repairs prove the failure modes are real, but they do not yet prove
  that multi-file chain rewrites can be selected safely without human
  supervision.

## Preliminary Conclusion

The current evidence is sufficient to say that the plan holds for a first V1
repair tool if that tool is limited to:

- `docs/.topics`
- read-only audit first
- explicit classification output
- bounded repair proposals
- hard stops on ambiguous or weakly grounded cases

The same evidence is not sufficient to justify a broader autopilot that chooses
between competing candidates, rewrites larger chains automatically, or mutates
multiple repositories without deliberate review.

## Open Gap

The main remaining evidence gap is not whether the problem is real.

The remaining gap is whether candidate ranking, parent-first package planning,
and eventual apply behavior can be made safe enough to automate beyond the
proposal stage.

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [001-2-schema-lineage-repair.trace.md](001-2-schema-lineage-repair.trace.md)
  - Value: o2IrHigUctznXaTFKkxL53GXaoCGu9I9QaD4E11yojI