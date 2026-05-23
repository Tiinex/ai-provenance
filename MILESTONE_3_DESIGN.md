# Milestone 3 Design Note

This note captures the current design read for Milestone 3 before implementation work starts.

The goal is high-confidence implementation with minimal guessing.

## Purpose

Milestone 3 should make `run_traceable_subagent` strong enough to support artifact-backed continuation with explicit lineage and truthful stop propagation.

This is not only a provenance feature. It is also a quality bar for whether the provenance-side lane is competitive enough to test role behavior in a native-chat-like setting without inventing hidden convenience magic.

## Scope

Milestone 3 should include:

- continuation from an existing parent `.trace.md` artifact
- creation of one child `.trace.md` artifact without mutating the parent
- explicit parent reference stored in the child artifact
- default inheritance from the parent contract, with explicit overrides
- selective carry-forward state that can preserve continuity without forcing the next run to inherit an ever-growing blob
- minimal lineage observability in the evidence/viewer surface so a human can see parent-child relationships rather than infer them from filenames alone
- truthful stop or cancellation propagation into the active traceable run
- evidence and live status that distinguish user-stopped runs from normal completion

Milestone 3 should not include:

- replay support
- topic UX integration
- command-heavy or invoke-heavy user UX layers
- temporary cache-backed continuation without a durable parent artifact

Those belong in Milestone 4 or later.

## Current Gaps

The current implementation has four major gaps relative to Milestone 3:

1. The public `run_traceable_subagent` input contract does not expose continuation-from-parent-trace input yet.
2. The runtime accepts a cancellation token in its TypeScript surface, but the current LM tool wiring does not pass the registered tool's cancellation token through and the runtime does not yet use it as a first-class control path.
3. The TRACEABLE panel exposes no stop action today.
4. The current stop-reason vocabulary does not have an explicit user-stop state.

## Design Principles

Use these principles to keep the implementation honest:

- Prefer durable artifact truth over temporary session magic.
- Keep lineage one-way. Children know their parent; parents do not maintain child lists.
- Store enough lineage in the artifact itself that the continuation story does not depend on file naming alone.
- Reuse one cancellation path for both host cancel and TRACEABLE stop.
- Do not invent provenance-side magic to hide differences from native Copilot behavior.
- Name remaining host differences explicitly when they still exist.
- Keep active inheritance narrow and selective; broad historical recovery should not be the same thing as automatic carry-forward.
- Prefer explicit carry-state schemas over freeform compacting blobs.
- Let completion end active carry by default; retain broader recoverability through inspectable artifacts rather than blind inheritance.

## Recommended V1 Decisions

The current code shape already suggests a few narrow v1 decisions that should reduce surface area and avoid unnecessary churn.

- `inheritParentContract` should stay implicit in v1 rather than becoming a separate public input. If `parentTracePath` is present, inheritance should happen by default and explicit per-field overrides should remain the escape hatch.
- Lineage metadata should be stored in both the durable artifact state and the sanitized result object for continued runs. The state block is the durable truth on disk, while the result object keeps parent-facing rendering and evidence inspection surfaces from needing to rediscover that metadata indirectly.
- `user_cancelled` should become a real stop reason, but it should map to the existing live-status `warning` phase rather than forcing a new panel phase. The current panel and detail surfaces already understand `warning`, and a user stop is not a clean completion but also not a hard policy failure.
- The first continuation release should require a durable parent artifact. Temporary or cache-backed continuation should remain out of scope for v1 even if it becomes desirable later.
- Carry-state should be split into two levels in v1:
  - `active carry-forward`: the small, selective state that a deferred child inherits by default
  - `recoverable carry-state`: a broader but still bounded package that remains inspectable in the artifact and can be recovered later without becoming automatic inheritance
- Completed runs should not automatically emit active carry-forward. A completed run may emit a recoverable handoff package when the model has grounded reason to think later multi-step work is likely, but that package should stay recoverable rather than auto-inherited.
- Viewer observability should derive lineage from artifact metadata rather than mutating parents to store child lists. Parent artifacts remain the durable source of truth; the viewer computes parent, children, and sibling relationships from the saved lineage fields.

## Host API Read

The current VS Code tool API shape is favorable for Milestone 3 cancellation work.

- `LanguageModelTool.invoke` receives a real `CancellationToken` as its second argument.
- `LanguageModelToolInvocationOptions` carries the tool invocation payload plus `toolInvocationToken`, but not the cancellation token itself.
- This means TRACEABLE does not need a speculative host workaround just to observe tool-level cancellation. The immediate code gap is that the current wrapper ignores the `token` parameter instead of threading it into `runTraceableSubagent`.

Current research read:

- host-side cancellation looks implementable on the current API surface
- the remaining design work is mainly ownership, evidence semantics, and UI wiring rather than an unknown host limitation

## Proposed Public Input Contract

The first continuation surface should stay narrow.

Recommended public inputs for `run_traceable_subagent`:

- `inputMode?: "OPERATIVE" | "EPISTEMIC" | "NON_LEADING_EPISTEMIC" | "DIRECT" | "RESUME"`
- `parentTracePath?: string`
  - Absolute or workspace-relative path to an existing parent `.trace.md` artifact.
  - When provided, the runtime treats the request as a continuation from that artifact.

Expected continuation behavior is now mode-specific:

- `OPERATIVE`, `EPISTEMIC`, and `NON_LEADING_EPISTEMIC`
  - `userInput` remains required and becomes the new follow-up input.
  - `parentTask` remains required as the bounded contract.
  - If `parentTracePath` is present, the child may inherit the parent request contract by default.
- `DIRECT`
  - `userInput` remains required and becomes the only fresh prompt.
  - `parentTask` and `parentFrame` must not be injected or inherited into the prompt surface.
  - `parentTracePath` may still carry lineage, carry state, and bounded continuation metadata.
- `RESUME`
  - `parentTracePath` becomes required.
  - `userInput`, `parentTask`, and `parentFrame` must not be supplied.
  - The run resumes from the existing trace, carry state, and continuation context without a fresh prompt.

Fields that should inherit by default when present on the parent for classic continuation modes and prompt-free resume:

- `outputMode`
- `inputMode` when the caller does not explicitly choose a new one
- `validationMode`
- `agentRole`
- `parentExpectations`
- `carriedContext`
- `wrapperPolicy`
- `budgetPolicy` only when it was explicitly declared on the parent request and the caller does not override it
- `modelSelector`
- `allowedToolNames`
- `blockedToolNames`

Active carry-forward that should inherit by default when present on the parent:

- only the parent's explicit `activeCarryForward` package
- not the parent's whole historical carry-state or raw output

Fields that should not inherit blindly:

- `userInput`
- `parentTask` for `DIRECT` and `RESUME`
- `parentFrame` for `DIRECT` and `RESUME`
- undeclared runtime fail-safe budgets that were never part of the public request contract
- `exportToFolder` when the caller explicitly overrides it
- any future stop or replay control fields
- recoverable-but-inactive carry-state from older completed traces
- prior raw output or full historical reasoning transcripts

## Proposed V1 Schema Diff

This section translates the current design read into the smallest concrete contract changes that should be needed for a first Milestone 3 implementation.

### `TraceableSubagentInput`

Current shape already includes the full bounded request contract. The recommended v1 continuation change remains intentionally small, but input-mode semantics now need to distinguish between classic prompted continuation, user-only direct continuation, and strict prompt-free resume.

Add:

- `inputMode` variants: `DIRECT`, `RESUME`
- `parentTracePath?: string`

Do not add in v1:

- `inheritParentContract`
- replay fields
- temporary-session continuation fields

Recommended interpretation:

- If `parentTracePath` is absent, the run behaves like today's one-shot traceable lane.
- If `parentTracePath` is present with `OPERATIVE`, `EPISTEMIC`, or `NON_LEADING_EPISTEMIC`, the run becomes a prompted continuation request and may inherit the parent contract by default.
- If `parentTracePath` is present with `DIRECT`, the run becomes a user-only continuation request and must not inherit parent prompt framing.
- If `parentTracePath` is present with `RESUME`, the run becomes a strict prompt-free resume request.
- Explicitly present request fields override inherited values, except that `DIRECT` and `RESUME` must not reintroduce parent prompt framing through inheritance.

### Declared Budget Versus Hidden Runtime Guard

The budget surface should distinguish between a caller-declared child budget and a runtime-only fail-safe.

Recommended interpretation:

- `budgetPolicy` remains the only public, child-visible budget contract.
- If the caller provides `budgetPolicy`, the runtime may surface that budget in the request contract, request summary, and prompt framing.
- If the caller omits `budgetPolicy`, the runtime should still protect itself against runaway execution, but that guard should remain internal rather than being surfaced as if the parent explicitly declared a child budget.
- The hidden runtime guard exists to approximate native live-chat conditions more closely: the child should not optimize its reasoning around a synthetic budget that the caller never provided.

Recommended v1 behavior for undeclared budgets:

- use a separate runtime fail-safe setting instead of the same public `budgetPolicy` path
- keep that fail-safe out of the request envelope and request summary when `budgetPolicy` was omitted
- treat the fail-safe as a safety brake rather than as an instruction to the child about how to pace itself

Recommended configuration direction:

- add one or two numeric settings for undeclared TRACEABLE runtime limits
- start with high defaults intended as fail-safe rather than as practical delegation budgets
- keep those settings semantically separate from caller-declared `budgetPolicy`

Recommended `RESUME` budget resolution order when no explicit budget is passed by the caller:

- first use a child-provided recommended next budget if a deferred parent explicitly emitted one
- otherwise fall back to an inherited parent `budgetPolicy` only when that budget was explicitly declared on the parent request
- otherwise use the hidden runtime fail-safe

Recommended `RESUME` guardrails:

- do not let `RESUME` expose a hidden fail-safe budget to the child as if it were a declared parent contract
- keep room for a future resume-specific clamp or cap if long resume chains become a real failure mode

### `TraceableStopReason`

Add:

- `user_cancelled`

Recommended reconciliation behavior:

- `user_cancelled` should force `completionClaim` to `unresolved`
- `user_cancelled` should not be treated as `completed`
- `user_cancelled` should not be treated as a hard policy failure

### `TraceableSubagentRunResult`

Additive v1 lineage fields:

- `parentTracePath?: string`
- `lineageDepth?: number`
- `lineageLabel?: string`
- `continuedFromParent?: boolean`

Additive v1 carry fields:

- `activeCarryForward?: TraceableCarryForwardState`
- `recoverableCarryState?: TraceableCarryForwardState`
- `carryStateDisposition?: "none" | "active" | "recoverable" | "consumed" | "expired"`

Additive v1 stop fields:

- `stoppedBy?: "user" | "host"`
- `stopSource?: "traceable-panel" | "host-cancel" | "unknown"`
- `stopRequestedAt?: string`

Recommended meaning:

- lineage fields are present only for continued child runs
- stop fields are present only when the run actually ended through the stop path
- active carry-forward is present only when the run intentionally leaves bounded state for default inheritance
- recoverable carry-state may remain present for later research or recovery even when no active carry-forward remains

### Durable Traceable State Block

The durable state block should carry the same additive continuation and stop metadata as the sanitized result, so continued artifacts remain self-describing on disk.

Recommended additive state fields:

- `parentTracePath?: string`
- `lineageDepth?: number`
- `lineageLabel?: string`
- `continuedFromParent?: boolean`
- `activeCarryForward?: TraceableCarryForwardState`
- `recoverableCarryState?: TraceableCarryForwardState`
- `carryStateDisposition?: "none" | "active" | "recoverable" | "consumed" | "expired"`
- `stoppedBy?: "user" | "host"`
- `stopSource?: "traceable-panel" | "host-cancel" | "unknown"`
- `stopRequestedAt?: string`

Recommended v1 rule:

- keep these fields additive under the current schema version unless implementation proves that older artifacts become semantically ambiguous without a schema bump

### Package Schema For `run_traceable_subagent`

The public package contribution should add exactly one new Milestone 3 field in v1:

- `parentTracePath`
  - type: `string`
  - description: path to an existing parent `.trace.md` artifact to continue from

The schema description should state that:

- continuation is artifact-backed in v1
- the child inherits the parent contract by default
- explicit request fields still override inherited values
- omitted `exportToFolder` exports beside the parent during continuation

### Live Status Mapping

No new panel status phase is recommended for v1.

Recommended mapping:

- `user_cancelled` maps to the existing `warning` phase in TRACEABLE live status
- completed runs stay `completed`
- hard policy or tool failures stay `error`

This keeps the UI diff small while still making user stop visible and non-completed.

## Child Naming And Lineage

Child naming should remain human-readable, but lineage must not depend on filename shape alone.

Recommended naming rule:

- parent `01-anchor.trace.md`
- first child `01-01-anchor.trace.md`
- next sibling `01-02-anchor.trace.md`
- child of that child `01-02-01-anchor.trace.md`

Recommended resolution rule:

- take the next free suffix in the immediate parent lineage
- do not maintain sibling references anywhere else
- fail only on real filesystem conflict conditions, not because prior child metadata is missing

Recommended stored lineage fields inside the child artifact state:

- `parentTracePath: string`
- `lineageDepth: number`
- `lineageLabel: string`

Minimum requirement:

- `parentTracePath` is mandatory for continued children

Path policy:

- use relative paths when the child and parent can be expressed cleanly inside the org-root layout
- use absolute paths only when the artifact is intentionally written outside that boundary

## Evidence Model

The embedded traceable state block is already the right place to carry this metadata.

Recommended additions to both the sanitized result and the durable state record for continuation runs:

- `parentTracePath`
- `lineageDepth`
- `lineageLabel`
- `continuedFromParent: true`

Recommended additions for bounded continuity state:

- `activeCarryForward?: TraceableCarryForwardState`
- `recoverableCarryState?: TraceableCarryForwardState`
- `carryStateDisposition?: "none" | "active" | "recoverable" | "consumed" | "expired"`

Recommended additions for stop-aware runs:

- `stoppedBy?: "user" | "host"`
- `stopSource?: "traceable-panel" | "host-cancel" | "unknown"`
- `stopRequestedAt?: string`

If these fields can be added without changing the meaning of existing state, keep the current state schema version and treat them as additive.

Recommended carry-state contract:

- `activeCarryForward` is the only carry package that should auto-inherit into the immediate next child by default.
- `recoverableCarryState` remains inspectable in the artifact but should not auto-inherit unless a future recovery path explicitly selects it.
- The model should decide what to carry forward, but only inside a bounded schema rather than freeform summary text.
- The schema should include both `keep` and `drop` pressure so the model names what must continue and what should be left behind.

Recommended v1 carry-state fields:

- `remainingGoals: string[]`
- `openQuestions: string[]`
- `constraints: string[]`
- `decisionsMade: string[]`
- `nextSuggestedStart: string`
- `relevantFileAnchors: string[]`
- `relevantArtifactAnchors: string[]`
- `keepReasons: string[]`
- `dropReasons: string[]`

Recommended guardrails:

- carry-state should be absent when there is no grounded reason to preserve continuity
- carry-state should stay bounded in item count so it does not become a growing blob
- completed runs should normally clear active carry-forward even if they leave a recoverable package behind

## Stop And Cancellation Semantics

Milestone 3 should not reuse `policy_stop` for user intent.

Recommended new stop reason:

- `user_cancelled`

Recommended default result semantics when a run is stopped by the user or host:

- `stopReason: user_cancelled`
- `completionClaim: unresolved`
- `traceStatus`: keep truthful to the evidence available so far; do not report a clean completed trace
- `finalSummary`: state explicitly that the run was stopped before normal completion

Recommended live-status behavior:

- a user-stopped run should appear as stopped, not completed
- a user-stopped run should not be colored or summarized like a hard policy failure
- in the current TRACEABLE detail and panel model, `user_cancelled` should map to the existing `warning` phase rather than introducing a new visual phase in v1

## Cancellation Flow

The implementation should converge on one active-run control path.

Recommended ownership model:

1. The extension layer creates a run controller for each active traceable run.
2. The run controller owns a cancellation source.
3. The LM-tool invocation token and TRACEABLE stop button both feed the same cancellation source.
4. The runtime receives the resulting token and checks it at defined interruption points.
5. The final result and evidence capture the stop as `user_cancelled` when cancellation came from the user-facing path.

This avoids separate stop worlds for host cancel and panel stop.

## TRACEABLE Panel Expectations

Milestone 3 should add a stop button to the TRACEABLE panel.

Requirements:

- visible only while a run is active
- wired to the same active-run cancellation path as host cancellation
- no replay button in this milestone
- stopped state should remain inspectable after the run ends

Minimum lineage observability expectations for the same evidence/viewer surface:

- show whether the current trace has a parent
- show the current trace's lineage label and depth
- show discoverable children derived from saved lineage metadata when siblings or children exist
- show whether carry-state is `active`, `recoverable`, `consumed`, or absent
- keep this derived and inspectable rather than mutating parents to maintain child indexes

## Validation Plan

Milestone 3 should not be considered done until all of these have concrete coverage.

Contract validation:

- package schema exposes continuation inputs publicly
- public docs and descriptions name continuation and stop behavior truthfully
- stop reason normalization recognizes `user_cancelled`

Runtime validation:

- continuation from a parent artifact creates a child artifact in the expected lineage slot
- default inheritance works when only a follow-up `userInput` is provided
- explicit overrides beat inherited values where expected
- deferred runs can leave bounded active carry-forward without forcing blind inheritance of the whole parent history
- completed runs can leave at most recoverable carry-state unless a grounded policy says active carry should remain open
- parent artifact remains unchanged

Cancellation validation:

- host cancellation propagates into the traceable run
- TRACEABLE stop-button cancellation propagates into the same run
- stopped runs emit `user_cancelled`
- stopped runs write evidence with stop metadata

Comparative validation:

- measured continuation slices are at least competitive with `runSubagent` on the same host
- the provenance-side continuation lane is useful as a native-chat-like role-behavior probe even when hidden Copilot context injection remains outside the traced contract

Observability validation:

- a human can identify the current trace's parent-child relationship from the evidence or viewer without reconstructing lineage purely from filenames
- a human can tell whether carry-state is active, merely recoverable, already consumed, or absent
- the evidence surface makes it inspectable what was intentionally carried forward versus left behind

## M2-Parity Pass Bar

Milestone 2 was not treated as done just because the feature existed in code. It cleared because the artifact lifecycle became believable as product behavior on the real Windows host, with repo-test coverage plus repeated live validation and truthful naming of what still was not claimed.

Milestone 3 should clear against the same standard.

That means Milestone 3 is not done when:

- continuation fields compile
- a child trace can be written once in a happy-path demo
- a stop button exists visually

Milestone 3 is only done when the continuation and stop lifecycle are believable as real product behavior on the maintained Windows host, with bounded repo-visible validation and explicit naming of what still remains outside the claim.

## Recommended Maintained Validation Set For M3

To reach a DoD at least as strong as Milestone 2, Milestone 3 should define and keep a maintained validation set rather than closing from one or two impressive manual runs.

Recommended initial M3 slice set:

- `M3-A` Parent-artifact continuation entry.
  - Scenario: continue from one explicit exported parent `.trace.md`.
  - Expected: the public surface accepts the parent artifact path and does not require a hidden same-session handoff.

- `M3-B` Child-artifact lineage write.
  - Scenario: run one continuation and inspect the saved child artifact.
  - Expected: one new child `.trace.md` is written, the parent remains unchanged, and the child carries explicit parent reference metadata.

- `M3-C` Next-free lineage slot resolution.
  - Scenario: continue the same parent twice, then continue one child.
  - Expected: sibling numbering takes the next free immediate slot and grandchild numbering nests under the chosen child without requiring sibling metadata elsewhere.

- `M3-D` Parent-contract inheritance.
  - Scenario: continue a parent while only changing `userInput`.
  - Expected: the child reuses the parent contract strongly enough to stay grounded without the caller restating the whole request.

- `M3-E` Explicit override precedence.
  - Scenario: continue a parent while overriding one bounded field such as `modelSelector.id`, `allowedToolNames`, or `exportToFolder`.
  - Expected: the explicit child request value wins over the inherited parent value while the rest of the parent contract remains intact.

- `M3-E2` Deferred carry-forward selection.
  - Scenario: a run defers and writes a bounded carry package for the next child.
  - Expected: the artifact exposes explicit active carry-forward, the package remains bounded, and the next child inherits only that selected state rather than a whole historical blob.

- `M3-E3` Completed-run recovery package discipline.
  - Scenario: a run completes after meaningful multi-step work.
  - Expected: active carry-forward is cleared by default, and any retained handoff state is marked recoverable rather than auto-inherited.

- `M3-F` Host cancel propagation.
  - Scenario: launch a traceable run from a host surface and stop it through the host-owned cancellation path.
  - Expected: the runtime halts, the result ends as `user_cancelled`, and saved evidence does not pretend the run completed normally.

- `M3-G` TRACEABLE stop propagation.
  - Scenario: launch a traceable run and stop it from the TRACEABLE panel.
  - Expected: the same active run stops through the shared cancellation path and leaves inspectable stop evidence.

- `M3-H` Live-status truthfulness for stopped runs.
  - Scenario: inspect a stopped run in the status bar, panel, and saved artifact.
  - Expected: the run reads as stopped or warning-shaped rather than completed or hard-failed, and the same stop truth is visible across live and saved surfaces.

- `M3-H2` Lineage observability.
  - Scenario: inspect a parent and child after one real continuation run.
  - Expected: the viewer or evidence surface makes the relationship visible enough that a human can see the parent-child pairing and current lineage position without guessing from filenames alone.

- `M3-I` Comparative continuation usefulness.
  - Scenario: compare one measured continuation-shaped task between `run_traceable_subagent` and `runSubagent` on the same host.
  - Expected: the provenance-side lane is at least competitive on the measured slice and weak differences can be explained concretely rather than hand-waved as generic host magic.

- `M3-J` Hidden-host-difference truthfulness.
  - Scenario: examine a case where native Copilot behavior still differs.
  - Expected: TRACEABLE names the remaining difference explicitly and does not manufacture provenance-side magic to imitate an ungrounded native effect.

Recommended milestone-closing rule:

- close Milestone 3 only after the initial maintained M3 slice set has been exercised enough times on the maintained host surface that continuation success and truthful fail-stop behavior are stronger than surprise or silent drift on that set

## Open Questions To Keep Explicit

These are not blockers for the initial design note, but they should remain explicit during implementation:

- whether lineage fields belong primarily in the top-level state record, the result object, or both
- whether `stopSource` should distinguish host cancel from panel stop in the durable artifact or only in debug logs
- whether user-triggered stop from a host surface should map to `stoppedBy: user` or a broader actor label
- whether carry-state should use one schema for both active and recoverable packages or two closely related schemas with different budget caps
- whether completed runs should be allowed to emit recoverable carry-state automatically or only under an explicit grounded policy for likely multi-step follow-up
- whether minimal lineage observability should live only in reconstructed evidence markdown first or also in the TRACEABLE panel within the same milestone

## Recommended Implementation Order

1. Add continuation input contract and parsing.
2. Add lineage resolution and child naming.
3. Add additive state and evidence fields for lineage.
4. Add `user_cancelled` stop semantics.
5. Thread cancellation through the LM tool wrapper and runtime.
6. Add TRACEABLE panel stop wiring.
7. Add contract, runtime, and live validation coverage.

That order keeps the primary truth in contract, runtime, and evidence before UI polish or broader UX work.