# Runtime Schema Candidates

This note captures a candidate direction for Tiinex-specific AI runtime schemas
before promoting anything into maintained schema canon.

## Current Read

The transfer-test artifacts point to one clearly repeated primary artifact
shape, not several equally mature schema families.

Across the observed traces, the recurring body is:

- metadata for the concrete run/export
- request contract framing
- outcome surface with stop reason, completion claim, and final summary
- diagnostic annexes such as carry, sender adaptation, evidence basis,
  routing/model decisions, fingerprint, previews, and raw child output

Representative examples:

- [001-leo.trace.md](../.templates/transfer-test/001-leo.trace.md)
- [001-2-2-leo.trace.md](../.templates/transfer-test/001-2-2-leo.trace.md)
- [001-1-1-1-1-1-1-leo.trace.md](../.templates/transfer-test/001-1-1-1-1-1-1-leo.trace.md)

That evidence first suggested a possible TRACEABLE child, but the narrower
comparison against the existing ai-provenance runtime schema showed that the
repeated export shape is better treated as the owned body of
`tiinex.runtime.trace.v1` rather than as proof of a second maintained schema
family.

## Landed Read

The current ai-provenance runtime should keep one owned schema:

- [tiinex.runtime.trace.v1](../.schemas/tiinex.runtime.trace.v1.md)

The repeated TRACEABLE export shape is now treated as the concrete body that
this schema must describe more sharply.

The comparison showed that the strongest additions were not a separate schema
family but stronger requirements inside the existing ai-provenance runtime
schema:

- explicit outcome triple: stop reason, completion claim, final summary
- routing or salvage interpretation when the runtime had to recover or narrow
  the child result
- carry-forward state when inherited context materially shaped the run
- evidence-basis signal describing what the runtime actually grounded against
- clearer diagnostic annex expectations such as decision summary, fingerprint,
  raw child output, and iteration metrics

## Reserved Future Child

### tiinex.traceable.snapshot.v1

This is only a reserve candidate for later.

Use it only if the runtime starts emitting standalone artifacts whose main job
is one of these:

- carry package snapshots
- sender adaptation snapshots
- runtime state snapshots
- compact technical state exports without a full run result body

Current transfer-test evidence still does not justify landing this as
maintained schema canon. The observed artifacts still look like one repeated
run-export family, not a second mature standalone shape.

## What Should Stay In The Child For Now

These signals still look ai-provenance-runtime-specific rather than
parent-worthy:

- carry summaries and inherited continuation state
- sender adaptation state
- salvage or recovery interpretation
- evidence-basis structure
- runtime fingerprint details
- raw child output preservation

## What Might Later Move Up To Parent

If later non-Tiinex AI runtime artifacts keep repeating the same pattern,
these are the strongest candidates to lift into the generic AI runtime parent
as recommended semantics:

- the outcome triple: stop reason, completion claim, final summary
- an optional diagnostic annex for technical explanation or validation detail

Those feel broader than TRACEABLE itself, but current evidence is still mostly
from Tiinex runtime exports, so they should stay child-owned for now.

## Naming Read

The current name
[tiinex.runtime.trace.v1](../.schemas/tiinex.runtime.trace.v1.md) remains a bit
broad, but it is still the better maintained home for the current
ai-provenance runtime export shape than a second TRACEABLE-specific schema.

If a later rename happens, it should happen by renaming this owned schema,
not by keeping two parallel maintained children for the same artifact family.

## Decision Read

Recommended next move:

1. keep strengthening `tiinex.runtime.trace.v1` as the owned ai-provenance
  runtime schema
2. only create a second maintained child if a real standalone snapshot or
  materially different export family appears
3. only then decide whether the AI runtime parent should absorb the outcome
  triple or a generic diagnostics recommendation