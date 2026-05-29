# Continuity Context

- Envelope Schema: [tiinex.continuation.v1](https://github.com/Tiinex/docs/blob/d26b73c3f83a618cc04338c49ca10b62bc91e876/.topics/.schemas/tiinex.continuation.v1.md)
- Parent
  - Parent Schema: [tiinex.ai.runtime.v1](https://github.com/Tiinex/docs/blob/c147ecd83fb1ae21fff1a68fc4c5a434fe730a38/.topics/.schemas/tiinex.ai.runtime.v1.md)
  - Created At: 2026-05-29 23:21:06
  - Trace: [tiinex.ai.runtime.v1.md](https://github.com/Tiinex/docs/blob/c147ecd83fb1ae21fff1a68fc4c5a434fe730a38/.topics/.schemas/tiinex.ai.runtime.v1.md)
  - Origin:
    - [relative](../../../docs/.topics/.schemas/tiinex.ai.runtime.v1.md)
    - [absolute](C:/Users/micro/Documents/Repos/Tiinex/docs/.topics/.schemas/tiinex.ai.runtime.v1.md)
    - [browse + git](https://github.com/Tiinex/docs/blob/c147ecd83fb1ae21fff1a68fc4c5a434fe730a38/.topics/.schemas/tiinex.ai.runtime.v1.md)
- Current
  - Current Schema: [tiinex.runtime.trace.v1](tiinex.runtime.trace.v1.md)
  - Created At: 2026-05-28 19:01:45
  - Summary: Shared schema for current Tiinex runtime-generated AI trace and evidence exports, layered on top of the broader AI runtime contract.

---

# tiinex.runtime.trace.v1
- Status: provisional runtime schema note
- Schema Definition: [tiinex.schema.v1](https://github.com/Tiinex/docs/blob/d26b73c3f83a618cc04338c49ca10b62bc91e876/.topics/.schemas/tiinex.schema.v1.md)
- Origin:
  - [relative](../trace-format/001.trace.md)
  - [absolute](C:/Users/micro/Documents/Repos/Tiinex/ai-provenance/.topics/trace-format/001.trace.md)
  - [browse + git](https://github.com/Tiinex/ai-provenance/blob/eb154c2111048e29702e7b09554af6aa1ca56290/.topics/trace-format/001.trace.md)

## Summary

This schema id names runtime-generated trace or evidence artifacts produced by
the current Tiinex runtime surfaces.

It is intended for artifacts whose main body is a bounded Tiinex-specific AI
runtime export, observed execution result, or evidence package rather than a
hand-written topic document.

## Required Body Expectations

Artifacts using `tiinex.runtime.trace.v1` should contain a readable body after
the continuity envelope.

The body should include, at minimum:

- a leading title identifying the export or evidence artifact
- runtime-grounded metadata for the run or export being shown
- some Tiinex-runtime-specific signal such as lane, role, carry state, or tool
  ledger when that signal exists
- at least one outcome surface that tells the reader what happened

## Recommended Body Sections

The exact section names may vary, but runtime trace documents should usually
provide some combination of:

- metadata
- request contract summary
- final output or outcome
- recent steps
- tool ledger or carry state
- technical details

## Envelope Expectations

When this body schema is used, it is expected to sit inside an envelope that
identifies at least:

- `Envelope Schema`
- `Current -> Current Schema: tiinex.runtime.trace.v1`
- `Current -> Created At`

Recommended envelope-side companions are:

- `Current -> Summary`
- parent signal when the runtime export continues another trace

## Schema Layer

This schema is a narrower child of [tiinex.ai.runtime.v1](https://github.com/Tiinex/docs/blob/c147ecd83fb1ae21fff1a68fc4c5a434fe730a38/.topics/.schemas/tiinex.ai.runtime.v1.md).

It should only add current Tiinex-runtime-specific semantics above the broader
AI runtime layer rather than re-owning the whole generic runtime export space.

## File Naming Conventions

Artifacts using `tiinex.runtime.trace.v1` should follow lineage-first trace
filenames with an optional runtime or role suffix when that improves human
discrimination.

Recommended form:

- `<lineage>.trace.md`
- `<lineage>-<runtime-stem>.trace.md`

Examples:

- `001.trace.md`
- `001-sigma.trace.md`
- `001-1-leo.trace.md`
- `001-parallax.trace.md`

Rules:

- keep the lineage label first
- use a short runtime or role stem only when it helps distinguish sibling
  traces
- prefer stable, human-readable stems over verbose model or transport labels
- keep the `.trace.md` suffix stable

## What This Schema Is For

Use `tiinex.runtime.trace.v1` when the artifact is primarily trying to:

- preserve runtime-observed evidence
- capture an agent-lane export or execution result
- capture current Tiinex-runtime-specific AI surfaces such as TRACEABLE child
  lanes, carry packages, or detailed tool ledgers
- carry machine-shaped output in a human-readable markdown container
- keep technical runtime details attached to a specific trace artifact

## What This Schema Is Not For

Do not use this schema for ordinary topic notes, pointer-only artifacts, or
schema definitions.

It is not primarily for:

- hand-authored design threads
- pure pointer roots
- shared schema notes
- polished RFC or narrative topic documents

It also should not be treated as the generic runtime base when the broader
`tiinex.runtime.v1`, `tiinex.machine.runtime.v1`, or
`tiinex.ai.runtime.v1` contracts are the truer fit.

## Interpretation Notes

- runtime trace bodies may be long and semi-structured
- code fences, JSON blocks, and detailed runtime ledgers are acceptable here
- the body should preserve observed runtime signal rather than being rewritten
  into polished topic prose
- this schema describes the current Tiinex runtime export shape, not the entire
  abstract agent runtime architecture

## Minimal Example

```md
# Continuity Context

- Envelope Schema: tiinex.continuation.v1
- Current
  - Current Schema: tiinex.runtime.trace.v1
  - Created At: 2026-05-28 19:01:45
  - Summary: TRACEABLE subagent evidence export for Sigma.

---

# Sigma Evidence

## Metadata

- Run Id: 2026-05-27T20:15:13.695Z
- Role: Sigma
- Export Status: ready

## Final Output

- Final Summary: Child lane returned an unresolved result.
```

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [tiinex.ai.runtime.v1.md](https://github.com/Tiinex/docs/blob/c147ecd83fb1ae21fff1a68fc4c5a434fe730a38/.topics/.schemas/tiinex.ai.runtime.v1.md)
  - Value: ZL9hRmchUPHttqkVNUpB1Iyv3wxQNk4GE_8LqZtW2pc