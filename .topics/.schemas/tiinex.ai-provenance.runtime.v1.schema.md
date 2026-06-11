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
  - Current Schema: [tiinex.ai-provenance.runtime.v1](tiinex.ai-provenance.runtime.v1.schema.md)
  - Created At: 2026-06-12 00:00:00
  - Summary: Minimal local child schema for the concrete TRACEABLE runtime result shape emitted by ai-provenance M0 provider-boundary work.

---

# tiinex.ai-provenance.runtime.v1
- Status: provisional runtime schema note
- Schema Definition: [tiinex.schema.v1](https://github.com/Tiinex/docs/blob/f87360aea750afe382aabae1fd208556a8fc99bd/.topics/.schemas/tiinex.schema.v1.schema.md)
- Origin:
  - [relative](../../tiinex_ai_runtime_m0_provider_boundary_plan_v2.md)
  - [absolute](C:/Users/micro/Documents/Repos/Tiinex/ai-provenance/tiinex_ai_runtime_m0_provider_boundary_plan_v2.md)

## Summary

This schema names the concrete ai-provenance TRACEABLE runtime result shape
that M0 preserves while model-provider routing becomes provider-agnostic.

It is intentionally narrower than the generic
`tiinex.ai.runtime.v1` parent schema and only owns the concrete fields that the
local TRACEABLE runtime actually emits, persists, or meaningfully preserves.

## Scope Rule

Use `tiinex.ai-provenance.runtime.v1` when the artifact or embedded state is
primarily trying to preserve a concrete TRACEABLE child-lane result or evidence
state for this repository's runtime.

This schema is for the parseable ai-provenance runtime result shape, not for the
broader abstract AI-runtime model and not for generic topic documents.

## Required M0 Runtime Shape

Artifacts using this schema should preserve, either directly or through an
embedded `Traceable State` block, the following M0-compatible runtime fields:

- provider route
- selected model identity when known
- request contract summary or request envelope signal
- runtime decision summary
- outcome triple:
  - stop reason
  - completion claim
  - final summary
- usage provenance or usage summary
- degraded or unresolved state when the run could not complete normally

## Required Concrete ai-provenance Semantics

When this schema is used, the runtime shape should make it understandable:

- which TRACEABLE lane or child run produced the result
- which provider route was selected or configured for that run
- whether the selected route still used the native VS Code LM host surface or a
  later external route
- which model identity the runtime actually selected when that signal exists
- whether tools were allowed, blocked, or absent for the run
- whether the child result was completed, partial, unresolved, degraded, or
  otherwise narrowed by runtime policy

## M0 Optional But Expected Sections

The following sections are optional at the schema layer but expected often
enough in M0 exports that readers should treat them as normal:

- tool ledger when tool calls were present
- evidence basis when grounding anchors were derived
- runtime fingerprint
- validation issues
- timing summary
- usage summary
- bounded raw model text

## Provider Capability Rule

This child schema must not encode Copilot or VS Code LM as the only provider
route.

It must also allow text-only external providers in M0.

If a provider route cannot support tool calling for a given run, the preserved
runtime state should clearly show that the run stayed text-only or degraded,
rather than pretending that tool parity existed.

## Relationship To Parent Schema

This schema is a local child of [tiinex.ai.runtime.v1](https://github.com/Tiinex/docs/blob/f87360aea750afe382aabae1fd208556a8fc99bd/.topics/.schemas/tiinex.ai.runtime.v1.schema.md).

The parent owns generic AI-runtime semantics.

This child owns only the concrete ai-provenance TRACEABLE runtime result shape,
including provider-route metadata, runtime decision summaries, bounded outcome
fields, and local evidence-oriented diagnostics that M0 already emits.

## What This Schema Is Not For

Do not use this schema for:

- generic runtime theory notes
- hand-authored design documents without concrete runtime result shape
- ordinary topic traces whose primary purpose is discussion rather than runtime
  state preservation
- speculative future provider-taxonomy design beyond the fields that M0 really
  emits

## Minimal Example

````md
## Traceable State

```json
{
  "schema": "tiinex.traceable-state.v1",
  "result": {
    "model": {
      "id": "gpt-5.4-mini",
      "vendor": "copilot"
    },
    "traceStatus": "trace-supported",
    "stopReason": "completed",
    "completionClaim": "partial",
    "finalSummary": "Returned one bounded answer.",
    "runtimeDecisionSummary": {
      "modelSelection": {
        "selectionMode": "explicit-selector"
      }
    },
    "runtimeFingerprint": {
      "providerRoute": "vscode-lm",
      "hostSurface": "vscode-lm-tool"
    }
  }
}
```
````

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [tiinex.ai.runtime.v1.schema.md](https://github.com/Tiinex/docs/blob/f87360aea750afe382aabae1fd208556a8fc99bd/.topics/.schemas/tiinex.ai.runtime.v1.schema.md)
  - Value: T2RD5-nrFEAXOvshHwsTNNlliZNUe4dbXoPsBWUY3BE