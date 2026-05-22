# Contributing To Tiinex AI Provenance

This repo is meant to stay provenance-first.

If you contribute here, optimize for stable evidence contracts, bounded outputs, and truthful tool behavior before adding more UX or more tool names.

## What Belongs Here

- provenance artifact generation
- provenance artifact inspection
- bounded evidence UX around `.trace.md` artifacts
- stable request/result contracts for provenance-oriented tools
- bounded discovery surfaces that help agents choose roles, models, and evidence safely
- IDE-portable contracts that future ports can implement under `ides/<ide>`

## What Does Not Belong Here

- VS Code Local-chat session-store inspection
- destructive cleanup workflows tied to host-private artifacts
- broad live-chat transport or targeting logic that depends on current host quirks
- convenience surfaces that outrank the maintained provenance contract

If a change is primarily about host-private session behavior rather than provenance artifacts and evidence reading, it probably belongs in `ai-vscode-tools` instead.

## Contribution Priorities

Preserve this order when making changes:

1. Contract truth
2. Evidence readability
3. Bounded tool behavior
4. Portability of the core contract
5. UX polish

Do not add new public tool surfaces just because the host can support another command. Prefer a smaller number of stronger tools with explicit ids, explicit paths, and bounded outputs.

## Public Contract Surface

Today the main maintained VS Code package lives in `ides/vscode`.

Current public TRACEABLE tool cluster:

- `list_traceable_agents`
- `list_traceable_models`
- `run_traceable_subagent`
- `view_traceable_subagent`

Current contract-bearing implementation anchors:

- `ides/vscode/src/traceableContract.ts`
- `ides/vscode/src/traceableSubagent.ts`
- `ides/vscode/src/traceableSubagentEvidence.ts`
- `ides/vscode/src/traceableEvidence.ts`

If you change request shapes, result shapes, evidence-file behavior, or payload normalization, treat that as contract work rather than as a local implementation tweak.

## Porting Guidance

This repo does not yet publish a standalone SDK.

The practical interface for ports today is the maintained request/result and evidence contract already present in code. A future IDE port should preserve the split below even if type names and host APIs differ:

- discovery layer: bounded lookup for supported role and model inputs
- execution layer: bounded child-lane request plus compact result
- evidence layer: stable `.trace.md` export plus bounded evidence inspection
- viewer layer: reconstructed reading surfaces over the same evidence artifact

Minimum expectations for a credible port:

- exact or well-bounded request envelopes
- explicit result status rather than optimistic success text
- stable evidence artifacts that remain inspectable after the run
- bounded evidence views that do not require raw artifact reading first
- truthful separation between portable contract and host-specific shell code

## Adding Or Changing A Tool

Before adding a public tool:

1. Define the contract first.
2. Decide whether the behavior can fit inside an existing tool with bounded inputs.
3. Prefer evidence-first follow-up over rerun-heavy workflows.
4. Add canonical usage guidance where agents will actually see it.

Required update surfaces for public tool changes:

- `ides/vscode/package.json`
- `ides/vscode/src/extension.ts`
- `ides/vscode/tests/test.mjs`
- `ides/vscode/README.md` when operator-facing guidance changes

If the change affects evidence naming, payload parsing, model selection, or policy behavior, include at least one focused regression assertion for that exact slice.

## Docs And Naming Rules

- Use established names such as `CONTRIBUTING.md` for repo-entry guidance.
- Keep machine-facing LM tool identifiers stable, descriptive, and snake_case.
- Do not let README summaries or temporary notes silently outrank maintained contract files and tests.
- When examples are needed, place short canonical flows in the public tool surface, not only in long docs.

## Validation

For `ides/vscode` work, run:

```powershell
npm test
```

from `ides/vscode`.

When the change affects live host behavior, validate the narrowest live slice after the repo test passes.

## Pull Request Bar

A contribution is not ready if it does any of the following:

- makes the tool surface look stronger than the runtime can prove
- adds tool sprawl where a stronger bounded contract would suffice
- hides contract changes inside convenience docs only
- weakens evidence readability or recoverability
- blurs the boundary between provenance infrastructure and host-specific workflow hacks

Prefer smaller, traceable structural changes over broader rewrites.