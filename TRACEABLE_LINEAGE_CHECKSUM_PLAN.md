# TRACEABLE Lineage Checksum Plan

This note captures the current design read for adding direct-parent lineage integrity to TRACEABLE `.trace.md` artifacts before implementation work starts.

The goal is not elegant crypto for its own sake. The goal is a bounded, understandable integrity rule that both humans and AI-facing lineage consumers can react to in the same way when a parent-child relationship no longer looks trustworthy.

## Current Read

The present TRACEABLE lineage model stores `parentTracePath` in the child and then follows that reference when lineage is rendered, when continuation is resumed, and when move or copy helpers need to reason about parent-relative placement.

That is enough to model normal continuation and relocation, but it is not enough to distinguish between:

- a normal parent-child relationship that is still trustworthy
- a child whose parent link now points to the wrong artifact
- a child whose recorded parent no longer matches the parent content that originally grounded that continuation

The checksum design in this note is meant to tighten that boundary without introducing unnecessary cascade edits across entire lineage trees.

## Design Goals

- Protect the direct parent-child relationship, not the entire lineage tree transitively.
- Let both human UX and AI-facing tooling detect and name the same broken-lineage condition.
- Keep checksum usage optional at the product level even when it is enabled by default.
- Make lineage repair explicit and operator-steerable rather than hidden or one-way.
- Protect UX and tooling from lineage loops or repair flows that could recurse or spin indefinitely.
- Keep rewrite rules small enough that ordinary TRACEABLE move and copy flows stay operationally believable.
- Avoid whole-tree checksum cascades when only one local parent-child edge is relevant.
- Make the integrity rule explicit and deterministic enough that it can be reimplemented consistently anywhere TRACEABLE needs it.

## Non-Goals

- This plan does not try to prove full-chain lineage authenticity end-to-end.
- This plan does not try to make TRACEABLE tamper-proof against a fully trusted writer that intentionally rewrites both parent content and child checksum fields consistently.
- This plan does not treat every file-content change as suspicious by default. Legitimate TRACEABLE rewrites are expected and must remain first-class.
- This plan does not introduce a general undo system.

## Recommendation

TRACEABLE should add a direct-parent integrity field to the child artifact footer.

The checksum should be computed from the current parent `.trace.md` markdown using a narrow canonical rule:

1. Read the parent `.trace.md` file as text.
2. Normalize line endings to `\n` before hashing.
3. Remove trailing whitespace at the end of the file.
4. Remove the final remaining line entirely.
5. Hash the remaining text.

The child should then store that checksum in a machine-readable footer field.

This intentionally treats the final line of the parent as a non-authoritative footer carrier so TRACEABLE can append integrity metadata without the footer poisoning the checksum input.

## Hash Choice

Use `SHA-256`, not `MD5`.

`MD5` is unnecessary here and too weak for new integrity work. `SHA-256` is widely available in Node, cheap enough for this repo scale, and strong enough that the remaining risk lives in trusted-writer semantics rather than in the digest algorithm itself.

For storage format, prefer base64url without padding over hex.

Reason:

- full SHA-256 hex is 64 characters and more visually noisy in markdown
- full SHA-256 base64url is 43 characters and still represents the full digest

Recommended serialized field value:

- full SHA-256 digest encoded as base64url without padding

Do not truncate in v1 unless storage pressure becomes real and measured. The footer should optimize for clarity and correctness before micro-compactness.

## Footer Model

The child should carry a machine-readable footer field for direct-parent integrity.

Recommended initial field name:

- `parentTraceChecksumSha256`

Recommended meaning:

- checksum of the direct parent `.trace.md` file after applying the canonical parent-checksum normalization rule above

Recommended location:

- child footer block at the end of the `.trace.md` file

The footer should be explicit and narrow rather than freeform prose so both repo code and AI-facing surfaces can parse it deterministically.

The checksum footer is optional.

That means:

- legacy artifacts may have no checksum footer at all
- new or rewritten artifacts should write it when checksum support is enabled
- repair operations may deliberately remove it as part of detaching lineage

## Integrity Scope

This checksum protects the direct parent edge only.

That means:

- if child `B` points to parent `A`, `B` stores a checksum derived from `A`
- `B` does not need to carry checksums for `A`'s ancestors
- if `A` changes legitimately, only direct children of `A` need checksum updates

This is the main reason the design avoids unnecessary whole-lineage cascade edits.

There is still rewrite work when a parent changes, but the blast radius stays at the immediately dependent edge rather than propagating down the full subtree by default.

## Broken Lineage Definition

A child should be treated as `Broken Lineage` when any of these conditions hold:

- `parentTracePath` resolves to no readable `.trace.md` parent
- the resolved parent cannot be parsed as a readable TRACEABLE artifact
- the child footer has a checksum field but the resolved parent's canonical checksum does not match it

Optional future tightening:

- treat malformed checksum encoding in the child footer as broken lineage too

For the first implementation, absence of the checksum field in older artifacts should be treated as legacy-no-checksum rather than immediately broken, unless the repo deliberately opts into a stricter migration gate later.

If checksum support is disabled in settings, the field should be ignored entirely by runtime logic rather than treated as present-but-failing.

## Human And AI Behavior

The same underlying direct-parent integrity result should be reused by both human UX and AI-facing operations.

That means:

- reconstructed evidence view
- move commands
- copy commands
- return-to-parent flow
- continuation or resume flows
- lineage rendering helpers
- AI-facing tool surfaces that inspect or rely on lineage

should all consume one shared integrity evaluator instead of each improvising its own partial rule.

If the evaluator says the direct parent edge is broken, all those surfaces should react through the same conceptual state even if the UX copy differs slightly by context.

## Command Reaction Model

When a command needs to use lineage and the direct parent edge is broken, TRACEABLE should surface that before continuing.

Recommended command behavior for move, copy, and related lineage-aware operations:

1. Detect broken direct-parent integrity before building the final plan.
2. Offer explicit repair choices rather than only a yes or no detach prompt.

Recommended initial repair choices:

1. `Detach`
   - remove the stored `parentTracePath`
   - remove the stored `parentTraceChecksumSha256`
   - mark the child as no longer continued from parent

2. `Re-connect`
   - keep the existing `parentTracePath`
   - recompute and rewrite only `parentTraceChecksumSha256`
   - only offer this when the configured parent path resolves to a readable parent artifact

3. `Manually connect`
   - open a dialog so the operator can choose a different desired parent artifact
   - rewrite both `parentTracePath` and `parentTraceChecksumSha256`
   - reject obviously invalid choices such as the current file itself, unreadable non-trace files, parent targets the repo explicitly decides are structurally invalid, and parent targets that would create a direct or indirect lineage loop

3. If the operator chooses one of the supported repair actions, continue with the requested operation using the repaired local state.
4. If the operator declines repair:
   - do not silently clear or rewrite the link
   - preserve the broken relationship as explicit state
   - surface `Broken Lineage` clearly in the evidence UI
   - let the command either fail closed or continue only if that operation has an explicitly allowed degraded path

The exact per-command continue-or-stop rule should be decided command-by-command, but the detection and prompt semantics should remain shared.

If checksum support is disabled in settings, these repair prompts should not appear at all and checksum-related command preflight should be bypassed.

## UI Surfacing

If the user chooses not to remove a broken parent link, TRACEABLE should show that state prominently.

Required visibility:

- details view: a top activity near the beginning of the activity stream with warning severity
- chat view: a clearly visible top warning entry near the beginning of the rendered chat activity stream

Recommended label:

- `Broken Lineage`

Recommended detail copy shape:

- what is broken
- which parent path was involved
- whether the parent was missing, unreadable, or checksum-mismatched
- what the operator chose when prompted

The warning should be visible enough that both a human operator and an AI reading the same reconstructed evidence understand why lineage-dependent actions are now suspect.

## Shared Integrity Evaluator

TRACEABLE should introduce one shared direct-parent integrity evaluator that returns a structured result rather than a boolean only.

Recommended result shape:

- `status: "ok" | "missing-parent" | "unreadable-parent" | "checksum-mismatch" | "legacy-no-checksum" | "cycle-detected"`
- `resolvedParentPath?: string`
- `storedChecksum?: string`
- `computedChecksum?: string`
- `message: string`

This evaluator should be reusable from:

- evidence view state reading
- lineage rendering
- move and copy command preflight
- return-to-parent preflight
- AI-facing tool logic that depends on parent lineage

When checksum support is disabled in settings, the evaluator should either short-circuit to a disabled state or be bypassed by callers. It should not emit checksum-mismatch results while the feature is toggled off.

Optional extension to the result shape if needed:

- `status: "ok" | "missing-parent" | "unreadable-parent" | "checksum-mismatch" | "legacy-no-checksum" | "cycle-detected" | "disabled"`

The evaluator should keep a visited-path set while following lineage and stop immediately on repeats.

That means:

- lineage rendering must not recurse forever on cyclic artifacts
- move or copy preflight must not keep walking a broken cyclic parent chain
- repair affordances must not offer `Re-connect` or `Manually connect` targets that would create a loop

Recommended failure mode for loops:

- classify the edge as broken lineage
- report a specific `cycle-detected` reason rather than collapsing it into a generic unreadable-parent bucket
- fail closed on any automation that would otherwise continue traversing the loop

## Rewrite Responsibilities

The following rule is the most important operational consequence of this design:

If a TRACEABLE rewrite changes a parent file's canonical checksum input, then direct children of that parent must have their stored `parentTraceChecksumSha256` updated in the same rewrite operation or in a clearly bounded follow-up phase that still counts as part of that same logical mutation.

That includes legitimate TRACEABLE move or copy operations when they rewrite the parent markdown in a way that changes the canonical hash input.

This is not treated as accidental blast radius. It is part of the integrity process.

The intended boundary is still narrow:

- update direct children of each rewritten parent
- do not recursively rewrite grandchildren unless their own direct parent changed

Repair semantics should follow the same locality rule.

That means:

- `Detach` changes only the selected child
- `Re-connect` changes only the selected child when the parent path is still valid
- `Manually connect` changes only the selected child unless the chosen command is itself also performing a broader move or copy rewrite

Repair flows must also remain loop-safe.

That means:

- a repair action must validate the resulting direct parent edge before writing it
- `Manually connect` must reject any target that would create a self-loop or a reachable ancestor cycle
- command-side repair code must use bounded traversal with visited-path protection instead of open-ended parent chasing

## Compatibility Rule For Existing Artifacts

Existing `.trace.md` artifacts without the checksum footer should remain readable.

Recommended initial behavior:

- no checksum field means `legacy-no-checksum`
- lineage may still be followed, but integrity-aware surfaces should know the edge is unverified rather than fully trusted
- new artifacts and rewritten artifacts should start writing the new footer field
- a user setting should allow checksum logic to be turned off temporarily without deleting existing footer fields from disk

This keeps the migration incremental instead of forcing a repo-wide rewrite before any code can ship.

## Settings Model

TRACEABLE should expose one user-facing setting for this feature.

Recommended initial setting:

- `tiinex.aiProvenance.traceableLineageChecksumEnabled`

Recommended default:

- enabled

Recommended disabled semantics:

- ignore `parentTraceChecksumSha256` during lineage reads and command preflight
- do not surface checksum mismatch as broken lineage while disabled
- do not prompt for checksum-specific repair actions while disabled
- do not require repair before move or copy when checksum support is disabled
- do not write or update `parentTraceChecksumSha256` while disabled; existing fields may remain on disk but are operationally ignored until the feature is re-enabled

Recommended enabled semantics:

- validate the checksum when lineage-aware operations consult the shared evaluator
- offer repair actions when a broken direct parent edge is found
- continue writing checksum footers for new or rewritten artifacts

The setting exists to support operator-controlled maintenance windows such as large repo moves where the user deliberately wants to postpone checksum repairs until the structural changes are complete.

## Implementation Slices

Recommended order:

### Slice 1: Shared Integrity Primitives

- add parent-checksum canonicalization helper
- add SHA-256 base64url helper
- add shared direct-parent integrity evaluator
- add parsing and serialization support for `parentTraceChecksumSha256`
- add the checksum enabled setting and one shared feature-gate reader

Primary files for this slice:

- `ides/vscode/src/traceableEvidence.ts`
- `ides/vscode/src/traceableSubagentEvidence.ts`
- `ides/vscode/src/traceableContract.ts`
- `ides/vscode/src/traceableSubagent.ts`
- `ides/vscode/src/extension.ts`
- `ides/vscode/package.json`
- `ides/vscode/tests/test.mjs`

Recommended implementation shape:

- introduce one shared helper that canonicalizes a parent `.trace.md` string by normalizing line endings, trimming trailing whitespace, and dropping the final remaining line
- introduce one shared helper that computes `SHA-256` and encodes it as base64url without padding
- define one shared integrity result shape that can represent `ok`, `legacy-no-checksum`, `missing-parent`, `unreadable-parent`, `checksum-mismatch`, `cycle-detected`, and optionally `disabled`
- thread the new `parentTraceChecksumSha256` field through the central TRACEABLE result and parse surfaces instead of hiding it in one-off JSON blobs
- add `tiinex.aiProvenance.traceableLineageChecksumEnabled` to package settings with a default of enabled
- add one shared reader for that setting so command, read, and write paths do not each interpret the feature gate differently

Slice 1 is done when:

- the checksum field has one canonical name in the codebase
- one shared evaluator exists and can be called from both human and AI-facing flows
- disabling the setting is observable in code as one shared gate rather than many local checks

### Slice 2: Write Path

- when finalizing a continued child export, compute and store the parent checksum in the child footer
- when rewriting moved or copied children, preserve or recompute `parentTraceChecksumSha256` against the resolved direct parent
- when rewriting a parent, update direct children that still point to it
- when checksum support is disabled, suppress checksum writes and updates entirely instead of performing hidden maintenance work

Primary files for this slice:

- `ides/vscode/src/traceableSubagentEvidence.ts`
- `ides/vscode/src/traceableFileOperations.ts`
- `ides/vscode/src/traceableEvidence.ts`
- `ides/vscode/tests/test.mjs`

Recommended implementation shape:

- continuation export finalization should compute the direct-parent checksum from the resolved parent artifact before the child evidence file is finalized
- rewrite helpers should preserve or recompute the checksum field in the same place where `parentTracePath`, `continuedFromParent`, and rewritten evidence metadata are already updated
- parent rewrites should identify direct children that still point to the rewritten parent and update only those child checksum footers
- write paths should remain local: direct-child updates only, no automatic recursive grandchild rewrites
- if checksum support is disabled, the write path should skip checksum creation and checksum maintenance entirely

Operational note:

- this slice is where accidental blast radius is most likely, so the code should prefer one shared rewrite helper for checksum updates over duplicating that logic across explicit move, native move, copy, and repair paths

Slice 2 is done when:

- new continued child artifacts can emit the checksum field
- legitimate TRACEABLE rewrites keep direct-parent checksums coherent
- disabled mode performs no hidden checksum maintenance work

### Slice 3: Read And Surface

- enrich evidence-view state with direct-parent integrity status
- expose `Broken Lineage` in details and chat when applicable
- ensure lineage renderers and related inspectors can report checksum mismatch clearly

Primary files for this slice:

- `ides/vscode/src/traceableEvidence.ts`
- `ides/vscode/src/traceableSubagentStatusDetail.ts`
- `ides/vscode/src/traceableSubagentStatusPanel.ts`
- `ides/vscode/src/extension.ts`
- `ides/vscode/tests/test.mjs`

Recommended implementation shape:

- evidence view state loading should compute direct-parent integrity once and attach that result to the snapshot or to a derived view model instead of recomputing it ad hoc in every renderer
- lineage rendering should explicitly report checksum mismatch, missing parent, unreadable parent, cycle detection, and legacy-no-checksum as distinct states where appropriate
- when the operator chooses not to repair a broken edge, details and chat should both get a top-level warning activity driven by the same underlying integrity result
- the surface should say why the lineage is broken, not just that it is broken

Recommended label for the top activity:

- `Broken Lineage`

Recommended secondary detail:

- whether the failure is missing parent, unreadable parent, checksum mismatch, cycle, or legacy-unverified

Slice 3 is done when:

- a broken edge becomes visible in both reconstructed evidence details and chat
- the surfaced reason matches the evaluator result instead of vague fallback wording
- lineage readers stop safely on cycles instead of continuing or hanging

### Slice 4: Command Prompts

- before move, copy, and related lineage-dependent operations, consult the shared evaluator
- if broken, prompt with the initial repair actions: `Detach`, `Re-connect`, `Manually connect`, or cancel/decline
- only show `Re-connect` when the stored parent path resolves to a readable parent artifact
- if repair is declined, surface the warning consistently and choose the command-specific fail or continue behavior explicitly

Primary files for this slice:

- `ides/vscode/src/extension.ts`
- `ides/vscode/src/traceableFileOperations.ts`
- `ides/vscode/src/traceableEvidence.ts`
- `ides/vscode/tests/test.mjs`

Recommended implementation shape:

- move, copy, return-to-parent, and any other lineage-aware command should call the shared evaluator before final plan execution
- the prompt should present `Detach`, `Re-connect`, `Manually connect`, and a decline path consistently
- `Re-connect` should only appear when the currently stored parent path resolves to a readable `.trace.md` artifact
- `Manually connect` should run through bounded validation before any write:
   - reject the selected file itself
   - reject unreadable or non-trace targets
   - reject targets that create a direct or indirect cycle
- decline behavior should be explicit per command rather than implicit or left to chance

Recommended first command set:

- `Move Trace...`
- `Copy Trace...`
- `Return to Parent Trace`
- native rename or move takeover paths that already reason about trace-aware lineage semantics

Slice 4 is done when:

- broken lineage is detected before mutation rather than after the command has already committed a partial plan
- the initial repair affordances exist with the intended visibility rules
- command behavior after declining repair is intentional and documented instead of accidental

### Slice 5: AI-Facing Consistency

- ensure lineage-aware tool outputs include the same broken-lineage diagnosis humans see
- avoid AI-only silent recovery paths that differ from human UX semantics

Primary files for this slice:

- `ides/vscode/src/traceableEvidence.ts`
- `ides/vscode/src/extension.ts`
- any AI-facing tool renderers or inspectors that expose lineage state
- `ides/vscode/tests/test.mjs`

Recommended implementation shape:

- lineage-aware AI surfaces should consume the same integrity evaluator and reason labels used by the human evidence UI
- AI-facing outputs should not silently auto-repair a broken edge that the human UX would prompt about
- if a broken edge is preserved after a declined repair, AI-facing outputs should say so explicitly rather than flattening it away

Slice 5 is done when:

- the same artifact yields the same integrity diagnosis in both AI and human surfaces
- repair semantics are not hidden behind AI-only convenience paths

## Concrete Breakdown

The smallest practical end-to-end implementation plan is:

1. Add the checksum field, settings gate, canonicalization helper, hash helper, and shared evaluator.
2. Make continuation export write the checksum field for new child artifacts.
3. Make move and copy rewrite paths preserve or recompute direct-parent checksums, including direct-child updates when a parent artifact is rewritten.
4. Make evidence reading and lineage rendering surface the evaluator result, including `cycle-detected`.
5. Add a top `Broken Lineage` warning activity to details and chat when a broken edge is preserved.
6. Add repair prompts with `Detach`, `Re-connect`, and `Manually connect` to lineage-aware commands.
7. Make AI-facing lineage consumers reuse the same evaluator and wording boundaries.

## Suggested File-Level Responsibilities

To keep the implementation coherent, prefer these boundaries:

- `traceableEvidence.ts`: checksum parsing, parent-edge evaluation, lineage read behavior, lineage render copy
- `traceableSubagentEvidence.ts`: new-child export writing of `parentTraceChecksumSha256`
- `traceableFileOperations.ts`: rewrite-time checksum maintenance and repair-safe state rewriting
- `extension.ts`: command preflight, repair prompts, evidence-editor integration, and settings wiring that is host-facing
- `traceableSubagentStatusDetail.ts`: any snapshot-level structural additions needed so the panel can show broken-lineage state cleanly
- `traceableSubagentStatusPanel.ts`: top warning activity rendering in details and chat
- `package.json`: feature setting contribution
- `tests/test.mjs`: source-level and bundle-level regression locks for the new surface

## Definition Of Ready For Implementation

The plan is ready to leave design and enter coding when all of the following are accepted:

- `parentTraceChecksumSha256` is the agreed field name
- `SHA-256` base64url without padding is the agreed digest representation
- checksum support is enabled by default but user-toggleable off
- repair actions are `Detach`, `Re-connect`, and `Manually connect`
- `Re-connect` is shown only when the stored parent path is reachable
- loops and cycles are treated as first-class broken-lineage states and rejected in manual connect flows
- `Broken Lineage` is surfaced in both details and chat when the operator keeps a broken edge

## Validation Plan

The feature should not be considered done until all of these have concrete coverage.

### Integrity Computation

- canonical checksum stays stable across line-ending normalization differences
- canonical checksum ignores only trailing whitespace and the final line, not arbitrary interior changes
- changing parent content above the footer changes the computed checksum

### Normal Continuation

- new child export writes `parentTraceChecksumSha256`
- lineage remains healthy for normal fresh continuations

### Rewrite And Move Flows

- moving or copying a child with an unchanged parent preserves a valid checksum state
- rewriting a parent updates direct children checksums where required
- direct-parent updates do not cascade unnecessarily into grandchildren when their direct parent did not change

### Broken Lineage Detection

- missing parent reports broken lineage
- unreadable parent reports broken lineage
- checksum mismatch reports broken lineage
- legacy child without checksum is distinguishable from checksum mismatch
- lineage cycles report broken lineage through a specific `cycle-detected` outcome
- disabled checksum support suppresses checksum-mismatch detection instead of reporting false breakage

### UX Behavior

- move or copy preflight prompts when broken lineage is detected
- `Detach` clears the parent link and checksum cleanly
- `Re-connect` is visible only when the stored parent path is reachable and rewrites only the checksum
- `Manually connect` lets the operator select a replacement parent and rewrites both the parent path and checksum
- declining repair leaves the link intact and surfaces `Broken Lineage` at the top of details and chat
- disabling the checksum setting suppresses checksum repair prompts entirely
- cyclic parent selections are rejected before write and explained clearly instead of allowing the UX to enter a loop-prone state

### AI Consistency

- AI-facing lineage consumers report the same integrity outcome as the human evidence UI for the same artifact

## Main Risks

- The biggest operational risk is forgetting to update direct children when a legitimate rewrite changes a parent's canonical checksum input.
- The biggest UX risk is surfacing broken lineage too weakly, so operators continue acting on an untrusted edge without realizing it.
- The biggest inferential risk is letting human and AI surfaces disagree about whether the same lineage edge is broken.
- A major safety risk is allowing cyclic parent relationships to enter the artifact set and then relying on ad hoc readers to notice them later.

## Recommendation Summary

This plan is worth implementing if TRACEABLE keeps the integrity scope narrow.

The correct unit of protection is the direct parent edge, not the whole ancestor chain.

The best current balance is:

- store a direct-parent checksum in the child footer
- compute it from the parent markdown after trimming trailing whitespace and dropping the final line
- use SHA-256 encoded as base64url without padding
- keep checksum support enabled by default but user-toggleable off when operators intentionally want to ignore checksum logic temporarily
- react to mismatch through one shared evaluator
- prompt on lineage-aware commands with explicit repair actions: `Detach`, `Re-connect`, and `Manually connect`
- reject loop-creating parent selections and treat lineage cycles as a first-class broken-lineage state for both UX and tooling
- surface `Broken Lineage` prominently when the operator chooses not to repair the link

That keeps the design strict enough to be useful, while avoiding the unnecessary cascade behavior of full-tree checksum propagation.