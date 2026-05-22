# Tiinex AI Provenance for VS Code

This package is the VS Code-specific extension surface for the `ai-provenance` repo.

It intentionally lives under `ides/vscode` because the repo itself is broader than one IDE.

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
- `run_traceable_subagent` runs the provenance-owned TRACEABLE child-lane runtime with evidence export support
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

- `list_traceable_agents`: use this first when you want a grounded role-backed run; copy the exact returned display name or file path into `run_traceable_subagent.agentRole` instead of guessing a role label.
- `list_traceable_models`: use this first when you need explicit model control; prefer `sendableOnly: true`, narrow with `query` when useful, and treat entries marked `Policy: blocked` as non-selectable for `run_traceable_subagent`.
- `run_traceable_subagent`: keep `userInput` close to the source wording, keep `parentTask` as the bounded contract, keep `budgetPolicy` small, and restrict `allowedToolNames` to the minimum slice needed.
- `view_traceable_subagent`: after a run returns an evidence file, inspect that artifact before rerunning the child lane; start with `summary` or `outcome`, then use `tool-ledger` or `state-json` only when deeper debugging is needed.

Canonical examples:

- Role-grounded preflight flow: `list_traceable_agents` -> `run_traceable_subagent` with `agentRole` -> `view_traceable_subagent` on the returned evidence file.
- Model-grounded preflight flow: `list_traceable_models` -> copy one allowed exact model id -> `run_traceable_subagent` with `modelSelector.id` -> `view_traceable_subagent` on the returned evidence file.
- Recovery flow: if a run already produced `.trace.md`, inspect it with `view_traceable_subagent` before launching another lane.

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