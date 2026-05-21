# AI Provenance Migration Plan

This file records the current intended split between `ai-vscode-tools` and `ai-provenance`.

## Current Decision

Primary required migration candidates:

- `run_traceable_subagent`

These are currently the strongest provenance-qualified surfaces in the existing stack.

## Why These Qualify

- They create and inspect `.trace.md` evidence artifacts.
- They preserve a bounded request contract and bounded evidence output.
- They expose provenance-oriented reading surfaces rather than only host automation.
- They already support moving between raw markdown evidence and reconstructed TRACEABLE evidence UX.

## Why Other Current Tooling Stays Put

The following remains in `ai-vscode-tools` for now:

- Local-chat session-store inspection tied directly to VS Code workspace storage
- exact delete flows against current session artifacts
- offline cleanup queueing and delete hacks shaped around current VS Code behavior
- live-chat targeting or transport logic that still depends on current VS Code host quirks

Reason:

These surfaces are still strongly VS Code-specific and operationally homebrew. Moving them into `ai-provenance` now would blur the line between durable provenance infrastructure and experimental host-specific tooling.

## Feedback Boundary

Topic-oriented feedback tooling belongs in the `feedback` repo for now, especially the still-experimental surfaces around topic creation and topic reading.

Reason:

- that tooling is still experimental
- it is more about feedback/topic workflow than durable provenance infrastructure
- moving it here now would mix two immature boundaries at once

## First Migration Wave

1. Establish `ai-provenance` README, branding, and package intent.
2. Identify the minimal remaining code/data contract needed by `run_traceable_subagent` after the `view_traceable_subagent` read surface move.
3. Separate provenance artifact logic from `ai-vscode-tools` host-specific workflow glue.
4. Move the provenance-first core into `ai-provenance`.
5. Leave compatibility shims or transitional wrappers in `ai-vscode-tools` only if they remain truthful and temporary.

Current progress inside that wave:

- the first moved slice is the `.trace.md` read-side: package-local Traceable State parsing plus a bounded VS Code inspect command in `ides/vscode`, now carrying multiple bounded read surfaces rather than only one compact summary
- the first host-independent run-side contract is also present there now: request/result, output-mode, evidence-file, tool-ledger related TRACEABLE types, request-envelope construction, payload extraction/normalization, result-construction/validation helpers, and the host-independent TRACEABLE markdown rendering layer have been copied into package-local source without moving the runtime execution path yet
- the run-side runtime execution path is still intentionally left in `ai-vscode-tools` until the next boundary cut is explicit enough

## IDE Layout Rule

When a repo name does not already declare VS Code directly, IDE-specific packages should live under `ides/<ide>`.

For this repo, that means:

- `ides/vscode` is the current package location for the VS Code extension
- future IDE-specific implementations should be peers there rather than root takeovers

## Non-Goal

This plan does not claim that all TRACEABLE-adjacent code should move immediately. The goal is a clean provenance boundary, not a broad repo drain.