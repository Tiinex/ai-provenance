# Continuity Context

- Envelope Schema: [tiinex.continuation.v1](https://github.com/Tiinex/docs/blob/613f592976c75e73deee101a555674b1cce08304/.topics/.schemas/tiinex.continuation.v1.md)
- Parent
  - Parent Schema: [tiinex.schema.v1](https://github.com/Tiinex/docs/blob/613f592976c75e73deee101a555674b1cce08304/.topics/.schemas/tiinex.schema.v1.md)
  - Created At: 2026-05-28 18:11:47
  - Trace: [tiinex.schema.v1.md](https://github.com/Tiinex/docs/blob/613f592976c75e73deee101a555674b1cce08304/.topics/.schemas/tiinex.schema.v1.md)
- Current
  - Current Schema: [tiinex.runtime.trace.v1](tiinex.runtime.trace.v1.md)
  - Created At: 2026-05-28 19:01:45
  - Summary: Shared schema for Tiinex runtime-generated trace and evidence exports, with primary home in ai-provenance.

---

# tiinex.runtime.trace.v1
- Status: provisional runtime schema note
- Schema Definition: [tiinex.schema.v1](https://github.com/Tiinex/docs/blob/613f592976c75e73deee101a555674b1cce08304/.topics/.schemas/tiinex.schema.v1.md)
- Origin:
  - [relative](../trace-format/001.trace.md)
  - [absolute](C:/Users/micro/Documents/Repos/Tiinex/ai-provenance/.topics/trace-format/001.trace.md)
  - [browse + git](https://github.com/Tiinex/ai-provenance/blob/eb154c2111048e29702e7b09554af6aa1ca56290/.topics/trace-format/001.trace.md)

## Summary

This schema id names runtime-generated trace or evidence artifacts produced by
the current Tiinex runtime surfaces.

It is intended for artifacts whose main body is a bounded runtime export,
observed execution result, or evidence package rather than a hand-written topic
document.

## Required Body Expectations

Artifacts using `tiinex.runtime.trace.v1` should contain a readable body after
the continuity envelope.

The body should include, at minimum:

- a leading title identifying the export or evidence artifact
- runtime-grounded metadata for the run or export being shown
- at least one outcome surface that tells the reader what happened

## Recommended Body Sections

The exact section names may vary, but runtime trace documents should usually
provide some combination of:

- metadata
- request contract summary
- final output or outcome
- recent steps
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

## Interpretation Notes

- runtime trace bodies may be long and semi-structured
- code fences, JSON blocks, and detailed runtime ledgers are acceptable here
- the body should preserve observed runtime signal rather than being rewritten
  into polished topic prose
- this schema describes the exported artifact shape, not the entire abstract
  agent runtime architecture

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
  - Towards: [tiinex.schema.v1.md](https://github.com/Tiinex/docs/blob/613f592976c75e73deee101a555674b1cce08304/.topics/.schemas/tiinex.schema.v1.md)
  - Value: PFqnBlsXp5OwzKFfUPVbSoCsDPPIlzqL7qCrtXMzBNA