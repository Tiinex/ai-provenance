# TRACEABLE Provenance Completeness Review

This note captures the current design read for TRACEABLE provenance completeness as of May 23, 2026.

It exists to preserve the conclusions from the recent UX, evidence, replayability, and `view_traceable_subagent` review so those details do not drift back into chat-only memory.

## Purpose

The immediate goal is not to add more polish blindly.

The immediate goal is to decide whether the current TRACEABLE UX and `.trace.md` artifact are complete enough for a provenance-focused operator who needs to:

- understand one lane truthfully
- understand how conditions changed over time
- inspect parent-child lineage without folklore
- replay or reconstruct enough of the run to trust later judgments
- use `view_traceable_subagent` as a bounded reading surface rather than a lossy convenience summary

## Current Read

Current assessment:

- live TRACEABLE UX is already strong for active lane debugging
- the `.trace.md` artifact is already fairly strong for one-lane inspection
- lineage understanding is present but not yet fully self-explanatory
- replayability is medium, not high
- `view_traceable_subagent` currently trails the strongest parts of the live panel

The system is therefore good enough for day-to-day inspection, but not yet complete enough to be treated as a fully trusted long-horizon provenance surface.

## Working Definitions

For this review, use the following distinctions.

- `data gap`: required provenance truth is not durably stored in the artifact state
- `UX gap`: the truth exists but the human-facing UX does not expose it clearly enough
- `view-tool gap`: the truth exists and may even appear in the live panel, but `view_traceable_subagent` does not yet expose it well enough as a bounded reading surface

## Coverage Matrix

### 1. Request And Contract

Question: can a reader tell what was asked for?

- Current read: mostly yes
- Evidence now includes user input, mode, output choice, parent trace, role, requested model, carry context, carry state, and budget/tool policy summaries
- Assessment: strong enough for single-lane reading

Question: can a reader distinguish explicit request from inherited continuation state and implicit defaults?

- Current read: partially
- Inherited surfaces are captured in request summary today
- Explicit versus inherited is understandable
- Implicit defaults are weaker, especially when the default influenced runtime behavior without being requested directly
- Assessment: acceptable for local debugging, not yet ideal for long-term provenance reading

Gap class:

- UX gap for clearer explicit vs inherited vs implicit framing
- data gap where implicit runtime decisions are not durably explained

### 2. Runtime Model Decision

Question: can a reader tell which model was actually selected?

- Current read: yes
- Requested model and selected runtime model are now separated cleanly
- Assessment: strong

Question: can a reader tell why that model was selected?

- Current read: no, not strongly enough
- The artifact shows the selected runtime model, but not a first-class model-selection rationale
- The artifact does not yet preserve a compact explanation of candidate set, blocklist effect, inheritance/default path, or final selector resolution chain
- Assessment: insufficient for long-term provenance

Gap class:

- primary data gap
- secondary view-tool gap once the data exists

### 3. Tool Policy And Tool Use

Question: can a reader tell which tools were declared, allowed, blocked, observed, and actually used?

- Current read: partially
- Allowed tools and observed tool calls are available
- The live panel does a better job than the bounded evidence viewer at showing tool access versus observed use
- A compact "declared vs allowed vs blocked vs observed vs executed" audit surface does not yet exist as a first-class artifact view
- Assessment: good operator signal, not yet full provenance completeness

Question: can a reader inspect individual tool calls deeply enough?

- Current read: live panel yes, view tool no
- Persisted tool output exists in the artifact model
- The live panel can reconstruct richer tool detail than `view_traceable_subagent` currently exposes
- Assessment: strong persistence, weaker bounded replay surface

Gap class:

- UX gap and view-tool gap
- not primarily a data gap for per-call detail

### 4. Evidence Basis

Question: can a reader tell what grounded the answer?

- Current read: only partially
- The system can show read targets and tool activity
- The system does not yet provide a first-class claim-to-evidence surface that says which anchors materially carried the final summary
- Counting file reads is not the same thing as explaining what grounded the conclusion
- Assessment: insufficient for high-confidence provenance reading

Gap class:

- primary data gap if claim-to-anchor linkage is needed durably
- otherwise at minimum a serious UX and view-tool gap

### 5. Temporal Understanding And Replay

Question: can a reader understand how the run evolved over time?

- Current read: partially yes
- Status history, recent tools, timing summary, and iteration metrics exist
- The live panel provides a useful activity feed
- The bounded evidence surfaces do not yet give iteration metrics and major decision points a first-class replay-oriented view
- Assessment: enough for debugging, not enough for high replayability

Question: can a reader reconstruct the run path later when conditions may have changed?

- Current read: not strongly enough
- The artifact preserves useful raw material, but still leaves too much reconstruction burden on the reader
- Assessment: medium replayability

Gap class:

- partly data gap
- strongly a view-tool gap

### 6. Carry State And Handoff

Question: can a reader tell what moved forward to the next lane?

- Current read: yes in data, only partly in bounded views
- Carry state and disposition are modeled well enough to persist
- The live panel exposes handoff more clearly than the bounded evidence viewer
- Assessment: good foundation, incomplete reader surface

Gap class:

- mainly view-tool gap

### 7. Lineage

Question: can a reader understand where this trace sits in the wider chain?

- Current read: partially
- Parent, depth, label, and direct child discovery exist
- The live panel can enrich lineage by loading ancestor artifacts
- The artifact itself is not yet fully self-describing as a lineage object; it relies on adjacent files remaining available
- Assessment: useful locally, weaker under time, relocation, or partial artifact loss

Gap class:

- primary data gap for long-horizon robustness
- secondary view-tool gap for lineage-centric reading

### 8. Environment And Assumption Drift

Question: can a future reader tell whether changed conditions may explain a different result?

- Current read: not adequately
- The current implementation uses workspace and configuration context at runtime
- The artifact does not yet clearly preserve enough host/config/package fingerprint to explain changed behavior over time
- Assessment: clear long-term provenance gap

Gap class:

- primary data gap

## Replayability Read

Current replayability scorecard:

- single-lane forensic read: fairly strong
- live debugging support: strong
- historical comparison across changed conditions: weak to medium
- lineage replay: medium at best
- bounded evidence replay through `view_traceable_subagent`: medium at best

The most important limitation is that the current system preserves many ingredients of replayability without yet turning them into a stable replay-reading contract.

## Definition Of Done For Provenance Completeness

Before TRACEABLE should be considered complete enough on this axis, the following should hold.

1. One `.trace.md` artifact should be sufficient to understand one lane without guessing about request, result, model choice, tool use, carry state, and stop semantics.
2. One `.trace.md` artifact plus available parent artifacts should be sufficient to understand lineage without manual freeform comparison.
3. The artifact should clearly distinguish explicit request, inherited state, and implicit defaulting.
4. The artifact should preserve which runtime model was selected and why that selection occurred.
5. The artifact should preserve enough tool-policy truth to distinguish declared, allowed, blocked, observed, and executed tool surfaces.
6. The artifact should preserve the evidence basis for major conclusions, not just the list of file reads.
7. The artifact should preserve what was handed forward, what remained recoverable, and what was consumed or expired.
8. The artifact should preserve enough host/config/package context to explain meaningful future drift.
9. `view_traceable_subagent` should expose bounded reading surfaces for all of the above without requiring `state-json` as the normal working view.
10. Replayability should be high enough that a later reader can reconstruct the run path and major decision points with low inference burden.

## Candidate Persistent Field Additions

This section distinguishes between gaps that require new persisted state and gaps that can be closed by rendering on top of existing state.

### Required New Persistent Fields

These are the leading candidates for new durable state.

#### 1. Runtime Decision Envelope

Purpose:

- explain why the runtime behaved as it did

Candidate shape:

```json
{
  "runtimeDecisionSummary": {
    "modelSelection": {
      "requestedModel": "auto",
      "selectionMode": "implicit-default",
      "selectedModelDisplayName": "Raptor mini (Preview)",
      "selectedModelId": "...",
      "candidateCount": 4,
      "blockedCandidateIds": ["..."],
      "preferredCandidateIds": ["..."],
      "rationale": [
        "no explicit modelSelector was provided",
        "no agentRole model override was present",
        "no parent trace source supplied a model",
        "selected first allowed runtime candidate after blocklist filtering"
      ]
    },
    "toolPolicy": {
      "declaredAllowedTools": ["..."],
      "effectiveAllowedTools": ["..."],
      "blockedTools": ["..."],
      "restricted": true
    }
  }
}
```

#### 2. Evidence Basis Envelope

Purpose:

- preserve what actually grounded the answer

Candidate shape:

```json
{
  "evidenceBasis": {
    "primaryAnchors": [
      {
        "path": "...",
        "kind": "file",
        "usedFor": ["final-summary", "missing-signal"],
        "readCount": 2
      }
    ],
    "secondaryAnchors": [
      {
        "path": "...",
        "kind": "artifact",
        "usedFor": ["lineage-context"]
      }
    ],
    "unsupportedClaims": [
      "explicit Tiinex philosophical manifesto was not found"
    ]
  }
}
```

#### 3. Environment Fingerprint

Purpose:

- preserve enough context to explain future drift

Candidate shape:

```json
{
  "runtimeFingerprint": {
    "extensionVersion": "...",
    "hostSurface": "vscode-lm-tool",
    "platform": "win32",
    "workspaceFolders": ["ai-provenance", "feedback", "youtube"],
    "relevantConfig": {
      "includeSupportArtifacts": true,
      "evidenceMaxItems": 10,
      "traceableAutoReveal": "yes"
    }
  }
}
```

#### 4. Lineage Snapshot Envelope

Purpose:

- reduce dependence on external reconstruction when the chain is partially missing later

Candidate shape:

```json
{
  "lineageSnapshot": {
    "parent": {
      "path": "...",
      "title": "01-gpt-5-mini.trace.md",
      "model": "GPT-5 mini",
      "completionClaim": "complete",
      "updatedAt": "..."
    },
    "self": {
      "label": "02",
      "depth": 1
    }
  }
}
```

#### 5. Replay Summary Envelope

Purpose:

- make iteration and decision progression easier to reconstruct later

Candidate shape:

```json
{
  "replaySummary": {
    "majorDecisionPoints": [
      {
        "at": "...",
        "kind": "model-selection",
        "summary": "Implicit runtime model selected after default fallback"
      },
      {
        "at": "...",
        "kind": "grounding-warning",
        "summary": "No explicit manifesto located in workspace reads"
      }
    ]
  }
}
```

### Gaps That Mostly Need Better Rendering

These gaps appear closable primarily through UX and view work on top of existing data.

- carry/handoff inspection
- bounded per-call tool forensics from persisted tool output
- timeline-oriented replay view over status history, timing, and iteration metrics
- compact lineage reading over parent/current/children relationships
- explicit audit framing over request summary and tool policy surfaces

## Implementation Matrix

This section tracks the intended implementation order so the design note stays synchronized with actual code changes.

| Priority | Slice | Type | Current status | Notes |
|---|---|---|---|---|
| 1 | `runtimeDecisionSummary` | data gap | landed on May 23, 2026 | First durable runtime-decision slice. Current v1 focus is model-selection provenance. |
| 1 | `runtimeFingerprint` | data gap | landed on May 23, 2026 | Persists extension/runtime/config context needed for future drift analysis. |
| 2 | `evidenceBasis` | data gap | landed on May 23, 2026 | Current v1 derives anchors conservatively from observed reads, carried file context, parent-trace lineage, and explicit missing items. Direct child claim-to-anchor assertions are still not persisted. |
| 3 | `lineageSnapshot` | data gap | planned | Needed to reduce reconstruction burden when parent artifacts move or disappear. |
| 4 | `replaySummary` | data gap | planned | Needed to turn existing timing and iteration ingredients into higher replayability. |
| 5 | `request-contract` surface | view-tool gap | landed on May 23, 2026 | `view_traceable_subagent` now separates explicit request items, inherited state, contextual inputs, and noted implicit defaults in a bounded contract view. |
| 6 | `runtime-decision` surface | view-tool gap | landed on May 23, 2026 | `view_traceable_subagent` now exposes a bounded runtime-decision surface for model-selection rationale and runtime fingerprint. |
| 6 | `evidence-basis` surface | view-tool gap | landed on May 23, 2026 | `view_traceable_subagent` now exposes bounded primary anchors, secondary anchors, and unsupported claims without falling back to `state-json`. |
| 7 | `tool-forensics` surface | view-tool gap | landed on May 23, 2026 | `view_traceable_subagent` now exposes bounded per-call tool inputs, typed output summaries, metadata, part kinds, and raw-output capture state from persisted tool records. |
| 8 | `timeline` surface | replay gap | landed on May 23, 2026 | `view_traceable_subagent` now exposes a replay-oriented axis over status history, recent tools, and key decision points without falling back to generic summaries. |
| 9 | `carry-handoff` surface | view-tool gap | landed on May 23, 2026 | `view_traceable_subagent` now exposes active, recoverable, consumed, expired, or empty carry-state outcomes in a bounded handoff view. |
| 10 | `lineage` surface | view-tool gap | landed on May 23, 2026 | `view_traceable_subagent` now exposes parent/current/children relationships as a bounded lineage view without forcing the reader into generic markdown reconstruction. |

## Landed Slice: Runtime Decision And Runtime Fingerprint

The first persistent provenance slice landed on May 23, 2026.

What now persists:

- `runtimeDecisionSummary`
  - current v1 focus: model-selection provenance
  - includes requested model when present
  - includes selection mode
  - includes matched selector when one existed
  - includes selected runtime model identity
  - includes compact rationale lines explaining the path that was taken

- `runtimeFingerprint`
  - extension version when available
  - host surface
  - platform
  - open workspace folder names
  - relevant TRACEABLE configuration values for model policy and undeclared runtime limits

Current limitation of the landed slice:

- `runtimeDecisionSummary` is still model-selection centric rather than a full runtime-policy envelope
- it does not yet include the complete declared-vs-effective tool-policy audit
- it now has a dedicated bounded `view_traceable_subagent` surface, but that surface is still technical and model-centric rather than a fuller runtime-policy audit

Why this slice was first:

- it closes one of the clearest long-horizon data gaps
- it is small enough to validate without widening into UI churn
- it creates a pattern for the next persistent provenance fields

## Landed Slice: Evidence Basis V1

The next persistent provenance slice landed on May 23, 2026.

What now persists:

- `evidenceBasis`
  - derives primary anchors from successful observed read targets
  - preserves read counts for those anchors
  - marks anchor use conservatively across observed grounding, final-summary references, missing-signal references, request-context matches, and lineage-context
  - carries parent-trace and request-context anchors forward as secondary anchors when they were not themselves observed reads
  - preserves explicit missing items as `unsupportedClaims`
  - includes a note that makes the v1 derivation limits explicit

What now renders through bounded evidence reading:

- `view_traceable_subagent.surface = runtime-decision`
  - shows model-selection rationale and runtime fingerprint without requiring `state-json`

- `view_traceable_subagent.surface = evidence-basis`
  - shows primary anchors, secondary anchors, and unsupported claims in a bounded reader-oriented format

Current limitation of the landed evidence-basis slice:

- it is still runtime-derived rather than child-declared claim-to-anchor truth
- it does not yet preserve explicit per-claim linkage from the child payload into the final summary
- unsupported claims currently reflect explicit missing items rather than a richer claim graph

## Landed Slice: Request Contract View

The next bounded view slice landed on May 23, 2026.

What now renders through bounded evidence reading:

- `view_traceable_subagent.surface = request-contract`
  - separates explicit request items from inherited state and contextual inputs
  - notes safe implicit defaults when those defaults can be derived conservatively from persisted request and runtime-decision state
  - avoids pushing the operator back to `request-summary` or `state-json` for basic contract reconstruction

Current limitation of the landed request-contract slice:

- it still depends on the current request-summary labeling rather than a richer typed request-contract schema
- implicit defaults are conservative and currently focus on model-selection and undeclared request-envelope defaults
- it improves contract readability, but it is not yet the replay-oriented view needed for status and decision sequencing

## Landed Slice: Timeline View

The next bounded replay slice landed on May 23, 2026.

What now renders through bounded evidence reading:

- `view_traceable_subagent.surface = timeline`
  - shows replay-oriented timing metadata such as start, update, duration, and total entry counts
  - lifts key decision points such as trace status, stop reason, completion claim, and model-selection mode into a compact replay header
  - interleaves status-history and recent-tool activity into one bounded timeline axis

Current limitation of the landed timeline slice:

- it still derives its replay axis from current status-history and recent-tools persistence rather than a richer purpose-built replay summary
- decision points are intentionally compact and do not yet include a fuller declared-vs-effective policy timeline
- it improves replayability, but it is not yet the carry-state lens needed for handoff inspection

## Landed Slice: Carry Handoff View

The next bounded handoff slice landed on May 23, 2026.

What now renders through bounded evidence reading:

- `view_traceable_subagent.surface = carry-handoff`
  - shows the resolved carry-state disposition for the current trace boundary
  - separates active carry-forward from recoverable carry-state when either is present
  - exposes remaining goals, open questions, constraints, next suggested start, and anchor lists without forcing the operator into `state-json`

Current limitation of the landed carry-handoff slice:

- it still reflects the currently persisted carry-state objects rather than a richer lifecycle audit across multiple boundaries
- consumed and expired states remain summary-oriented when no carry package survives on the result
- it improves handoff readability, but it is not yet the chain-oriented lineage view

## Landed Slice: Tool Forensics View

The next bounded tool-detail slice landed on May 23, 2026.

What now renders through bounded evidence reading:

- `view_traceable_subagent.surface = tool-forensics`
  - exposes bounded per-call tool inputs from the persisted request summary
  - surfaces typed output fields such as output kind, summary, metadata, part kinds, and raw-output capture state
  - keeps raw output bounded so the surface remains readable while still showing whether richer persisted output exists

Current limitation of the landed tool-forensics slice:

- it reflects only what was durably persisted on tool-call records rather than every richer live-panel rehydration path
- elapsed time remains opportunistic because the persisted tool-call record does not yet carry a first-class elapsed field for every call
- it improves bounded inspection of one tool call, but it is not yet the broader declared-vs-allowed-vs-observed policy audit

## Landed Slice: Lineage View

The next bounded chain-reading slice landed on May 23, 2026.

What now renders through bounded evidence reading:

- `view_traceable_subagent.surface = lineage`
  - exposes current trace identity, parent linkage, continuation status, lineage label, lineage depth, and direct children in one bounded view
  - treats the current artifact as one node in a chain instead of leaving lineage detail spread across reconstructed markdown and summary fallbacks
  - keeps parent and child file references directly inspectable from the bounded reading surface

Current limitation of the landed lineage slice:

- it still depends on adjacent evidence files remaining available because the fuller lineage snapshot envelope is not yet persisted
- it derives direct-children relationships from local neighboring filenames rather than a dedicated persisted child registry
- it improves chain readability, but it is not yet the stronger lineage-snapshot data slice described earlier in this design note

## Proposed `view_traceable_subagent` Target Surfaces

The view tool should become a bounded provenance lens rather than a collection of generic markdown summaries.

Recommended target surfaces:

1. `summary`
   - quick situation read
   - what this trace is, how it ended, what looks risky

2. `request-contract`
   - explicit request
   - inherited state
   - implicit defaults

3. `runtime-decision`
   - model selection rationale
   - tool-policy rationale
   - important runtime gating decisions

4. `evidence-basis`
   - primary and secondary anchors
   - unsupported claims
   - where the conclusion really came from

5. `tool-forensics`
   - bounded per-call tool detail
   - input, output summary, raw-output indicator, error/defer state, elapsed time

6. `timeline`
   - status history
   - iteration metrics
   - major decision points

7. `carry-handoff`
   - active carry-forward
   - recoverable state
   - consumed or expired state

8. `lineage`
   - parent, current, children
   - compact change-oriented chain reading

9. `state-json`
   - raw escape hatch
   - not the normal working view

## Recommended Implementation Order

1. Close the data gaps that would otherwise make future views half-blind.
2. Add the minimum new persistent state needed for model rationale, evidence basis, drift fingerprint, lineage snapshot, and replay summary.
3. Add or rename `view_traceable_subagent` surfaces around provenance questions rather than around generic data buckets.
4. Bring the view tool closer to the strongest parts of the live panel without forcing the panel itself to become the only trustworthy reading surface.
5. Only after that, optimize compactness and presentation polish.

## Immediate Design Rule

Do not treat `view_traceable_subagent` as a markdown summarizer.

Treat it as the bounded set of eyes that should save context without making the reader blind.

That means:

- optimize for the right provenance questions first
- keep uncertainty explicit
- prefer truthful bounded surfaces over visually rich but inferentially lossy summaries
- let `state-json` remain a fallback, not the primary proof surface

## Short Conclusion

TRACEABLE already has a strong foundation.

What remains is not random polish.

What remains is to close the gap between:

- what the artifact already knows
- what the live panel can already infer
- what a bounded evidence-reading tool should let a provenance-focused operator understand quickly and safely

Until those surfaces converge, the system is good for active debugging but not yet complete as a long-horizon provenance and replay surface.