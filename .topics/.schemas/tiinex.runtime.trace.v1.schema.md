# Continuity Context

- Envelope Schema: [tiinex.root.v1](https://github.com/Tiinex/docs/blob/f87360aea750afe382aabae1fd208556a8fc99bd/.topics/.schemas/tiinex.root.v1.schema.md)
- Parent
  - Parent Schema: [tiinex.ai.runtime.v1](https://github.com/Tiinex/docs/blob/f87360aea750afe382aabae1fd208556a8fc99bd/.topics/.schemas/tiinex.ai.runtime.v1.schema.md)
  - Created At: 2026-05-29 23:21:06
  - Trace: [tiinex.ai.runtime.v1.schema.md](https://github.com/Tiinex/docs/blob/f87360aea750afe382aabae1fd208556a8fc99bd/.topics/.schemas/tiinex.ai.runtime.v1.schema.md)
  - Origin:
    - [relative](../../../docs/.topics/.schemas/tiinex.ai.runtime.v1.schema.md)
    - [absolute](C:/Users/micro/Documents/Repos/Tiinex/docs/.topics/.schemas/tiinex.ai.runtime.v1.schema.md)
    - [browse + git](https://github.com/Tiinex/docs/blob/f87360aea750afe382aabae1fd208556a8fc99bd/.topics/.schemas/tiinex.ai.runtime.v1.schema.md)
- Current
  - Current Schema: [tiinex.runtime.trace.v1](tiinex.runtime.trace.v1.schema.md)
  - Created At: 2026-05-28 19:01:45
  - Summary: Shared schema for current Tiinex runtime-generated AI trace and evidence exports, layered on top of the broader AI runtime contract.

---

# tiinex.runtime.trace.v1
- Status: provisional runtime schema note
- Schema Definition: [tiinex.schema.v1](https://github.com/Tiinex/docs/blob/f87360aea750afe382aabae1fd208556a8fc99bd/.topics/.schemas/tiinex.schema.v1.schema.md)
- Origin:
  - [relative](../trace-format/001.trace.md)
  - [absolute](C:/Users/micro/Documents/Repos/Tiinex/ai-provenance/.topics/trace-format/001.trace.md)
  - [browse + git](https://github.com/Tiinex/ai-provenance/blob/cef557407f4d59e583fb3154dcbee22cd653684c/.topics/trace-format/001.trace.md)

## Summary

This schema id names runtime-generated trace or evidence artifacts produced by
the current ai-provenance runtime surfaces.

It is intended for artifacts whose main body is a bounded ai-provenance AI
runtime export, observed execution result, or evidence package rather than a
hand-written topic document.

## Required Body Expectations

Artifacts using `tiinex.runtime.trace.v1` should contain a readable body after
the continuity envelope.

The body should include, at minimum:

- a leading title identifying the export or evidence artifact
- runtime-grounded metadata for the run or export being shown
- request contract framing for the run being preserved
- at least one outcome surface that tells the reader what happened
- technical details sufficient for later runtime interpretation

## Required ai-provenance Runtime Semantics

Artifacts using `tiinex.runtime.trace.v1` should make it clear:

- what bounded run, export, or child-lane result is being preserved
- what request framing materially shaped the run when that signal is known
- what outcome the runtime concluded through the triple of stop reason,
  completion claim, and final summary when that outcome shape exists
- when the runtime salvaged, narrowed, or otherwise interpreted an imperfect
  child result
- what continuation carry or inherited context materially affected the run when
  such carry exists
- what evidence basis or grounding anchors the runtime used or did not have

## Recommended Body Sections

The exact section names may vary, but runtime trace documents should usually
provide some combination of:

- metadata
- request contract summary
- final output or outcome
- quick read
- at a glance
- outcome
- recent steps
- expected but missing
- technical details

## Repeated Structural Pattern

The current transfer-test exports show a repeated structural pattern strongly
enough that this schema should describe it explicitly.

When the artifact is a full ai-provenance runtime export, the body will often
look like this:

- `## Metadata`
- `## Request Contract Summary`
- `## Final Output`
- inside the final output block, a nested runtime result body with:
  - `## Quick Read`
  - `## At a Glance`
  - `## Outcome`
  - `## Recent Steps`
  - optional `## Expected But Missing`
  - `## Technical Details`

This is not a claim that every future export must keep every heading forever,
but it is the current structural center of gravity and should be treated as the
default readable shape unless a later runtime family proves otherwise.

## Recommended Diagnostic Sections

When the signal exists, runtime trace documents should usually preserve:

- request contract preview
- runtime tool ledger preview
- usage summary
- evidence basis
- runtime decision summary
- runtime fingerprint
- iteration metrics preview
- child trace preview
- raw child output

These diagnostic blocks currently appear most often as subsection-style detail
inside `## Technical Details`.

## Recommended Optional State Sections

When the artifact is preserving more than the short human-facing export body,
it may also include additional state-heavy sections such as:

- sender adaptation state
- traceable state
- activity timeline

These sections are not required for every artifact, but the transfer-test chain
shows them often enough that they are part of the currently understood export
shape.

## Recommended ai-provenance-Specific Fields

- explicit run id
- explicit role, lane, or runtime identity when known
- explicit output mode or export status when known
- explicit parent trace when the run continues another export
- explicit carry or inherited continuation summary when present
- explicit sender adaptation state when present

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

This schema is a narrower child of [tiinex.ai.runtime.v1](https://github.com/Tiinex/docs/blob/f87360aea750afe382aabae1fd208556a8fc99bd/.topics/.schemas/tiinex.ai.runtime.v1.schema.md).

It should only add current ai-provenance-runtime-specific semantics above the
broader AI runtime layer rather than re-owning the whole generic runtime export space.

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
- capture current ai-provenance-runtime-specific AI surfaces such as child
  lanes, carry packages, salvage-aware outcomes, or detailed tool ledgers
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
- carry, salvage, sender adaptation, evidence basis, and raw child output are
  treated as owned ai-provenance runtime semantics here
- repeated heading structure is part of the readable artifact shape, not just a
  cosmetic presentation choice
- this schema describes the current ai-provenance runtime export shape, not the
  entire abstract agent runtime architecture

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

## Request Contract Summary

- User Input: Investigate the carry package.

## Final Output

- Stop Reason: completed
- Completion Claim: partial
- Final Summary: Child lane returned one bounded recommendation.

## Technical Details

### Evidence Basis
    {
      "primaryAnchors": [],
      "secondaryAnchors": []
    }
```

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [tiinex.ai.runtime.v1.schema.md](https://github.com/Tiinex/docs/blob/f87360aea750afe382aabae1fd208556a8fc99bd/.topics/.schemas/tiinex.ai.runtime.v1.schema.md)
  - Value: T2RD5-nrFEAXOvshHwsTNNlliZNUe4dbXoPsBWUY3BE