# Tiinex AI Provenance for VS Code

This package is the VS Code-specific extension surface for the `ai-provenance` repo.

It intentionally lives under `ides/vscode` because the repo itself is broader than one IDE.

## Quick Start

After you install the extension in VS Code, the shortest useful first flow is:

1. type `#` in chat and pick `#listTraceableAgents` or `#listTraceableModels`
2. run one narrow lane with `#runTraceableSubagent`
3. inspect the returned evidence file with `#viewTraceableSubagent`

The important operator detail is that chat usually exposes the prompt-reference names after `#`, not the raw internal tool ids. In practice you should expect `#listTraceableAgents`, not `list_traceable_agents`.

## What To Expect

This package is built for bounded provenance-first TRACEABLE work.

- It helps you preflight roles and models before a run.
- It can export and reopen `.trace.md` evidence artifacts when the lane requests `exportToFolder` or when the user explicitly chooses export.
- It is designed for narrow investigation slices, not broad autonomous orchestration.
- In chat, the first-class invocation surface is usually `#` plus the prompt reference name.

Current status:

- buildable as a real VS Code extension
- ready for local main-host junction linking on Windows
- now carries the provenance-side TRACEABLE tool surface: `list_traceable_agents`, `list_traceable_models`, `view_traceable_subagent`, and `run_traceable_subagent`
- now also carries the reconstructed `.trace.md` evidence viewer UX with source/preview reopen commands on the provenance side
- now also carries the first host-independent TRACEABLE contract slice: request/result, request-envelope, payload extraction, result construction, full markdown rendering, and evidence-related types
- now carries release-check, VSIX packaging, and semantic-version scripts for Marketplace-oriented delivery

Current included surface:

- `Tiinex: Inspect TRACEABLE Evidence` parses the embedded `Traceable State` block from a `.trace.md` file and lets you choose a bounded surface without rerunning the child lane
- `Tiinex: Open Reconstructed Traceable View` opens a provenance-owned reconstructed viewer for a `.trace.md` artifact and can reopen back into source or markdown preview
- `list_traceable_agents` exposes the bounded workspace-supported traceable agent catalog from the provenance side
- `list_traceable_models` exposes the bounded runtime-discoverable traceable model catalog from the provenance side
- `run_traceable_subagent` runs the provenance-owned TRACEABLE child-lane runtime with optional evidence export support
- current bounded surfaces: rendered-output, request-summary, summary, outcome, tool-ledger, status-history, tool-summary, file-summary, and state-json
- a separate provenance LM tool namespace is now present through `list_traceable_agents`, `list_traceable_models`, `view_traceable_subagent`, and `run_traceable_subagent`
- provenance-specific settings now live under `tiinex.aiProvenance.*`

What it exposes in VS Code:

- display name: `Tiinex AI Provenance`
- LM tool surfaces: `list_traceable_agents`, `list_traceable_models`, `view_traceable_subagent`, `run_traceable_subagent`
- command namespace: `tiinex.aiProvenance.*`
- settings namespace: `tiinex.aiProvenance.*`
- TRACEABLE panel/status shell under the provenance namespace

Canonical tool usage:

Canonical prompt references in chat:

- `#listTraceableAgents`: use this first when you want a grounded role-backed run; copy the exact returned display name or file path into `run_traceable_subagent.agentRole` instead of guessing a role label.
- `#listTraceableModels`: use this first when you need explicit model control; prefer `sendableOnly: true`, narrow with `query` when useful, and treat entries marked `Policy: blocked` as non-selectable for `run_traceable_subagent`.
- `#runTraceableSubagent`: keep `userInput` close to the source wording, keep `parentTask` as the bounded contract, keep `budgetPolicy` small, and restrict `allowedToolNames` to the minimum slice needed.
- `#viewTraceableSubagent`: after a run returns an evidence file, inspect that artifact before rerunning the child lane; start with `summary` or `outcome`, then use `tool-ledger` or `state-json` only when deeper debugging is needed.

Canonical examples:

- Role-grounded preflight flow: `#listTraceableAgents` -> `#runTraceableSubagent` with `agentRole` -> `#viewTraceableSubagent` on the returned evidence file.
- Model-grounded preflight flow: `#listTraceableModels` -> copy one allowed exact model id -> `#runTraceableSubagent` with `modelSelector.id` -> `#viewTraceableSubagent` on the returned evidence file.
- Recovery flow: if a run already produced `.trace.md` through `exportToFolder` or explicit export, inspect it with `#viewTraceableSubagent` before launching another lane.

Local development loop:

- This section is for extension contributors rather than Marketplace-first users.
- `npm test` builds and runs the current validation slice
- `npm run package:vsix` produces a local VSIX for install testing
- `npm run release:check` is the release gate used before publishing

Release flow:

- `npm test`
- `npm run package:vsix`
- `npm run release:check`
- `npm run release:patch`, `npm run release:minor`, `npm run release:major`
- `npm run publish:vsce`

Non-goal for this package scaffold:

- no MCP server surface
- no extra agent runtime surface
- no claim of native `runSubagent` UX parity or of broader host-private agent enumeration beyond the bounded provenance traceable surfaces