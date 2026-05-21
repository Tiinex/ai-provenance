# Tiinex AI Provenance

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

- Canonical GitHub repo: https://github.com/Tiinex/ai-provenance

`ai-provenance` is the home for provenance-first tooling that should remain useful even after it is separated from the more experimental, VS Code-specific workflow tooling in `ai-vscode-tools`.

## Current Status

As of May 2026, this repo includes a buildable VS Code extension package under `ides/vscode`, and the provenance-side TRACEABLE surface has now moved there in practice.

Current repo state:

- `ides/vscode` is a real VS Code extension package with test, VSIX packaging, and release scripts
- the provenance-side LM tool surface now includes `list_traceable_agents`, `view_traceable_subagent`, and `run_traceable_subagent`
- `.trace.md` evidence parsing, bounded evidence inspection, reconstructed viewer UX, and evidence export now live on the provenance side
- the current Windows host has been revalidated for bounded `run_traceable_subagent` use together with evidence export and evidence viewing

The strongest provenance-oriented value in the current toolchain is now here: bounded request/result semantics, `.trace.md` evidence generation and inspection, and a receiver-safe path between raw markdown source and reconstructed TRACEABLE evidence reading.

## Intended Scope

This repo is meant to hold provenance-first ecosystem tooling, starting with VS Code and leaving room for future IDE support later.

Near-term scope:

- provenance artifact generation
- provenance artifact inspection
- bounded evidence UX around `.trace.md` artifacts
- stable request/result semantics for provenance-focused tools
- bounded traceable agent discovery for workspace-supported agent artifacts

Current out-of-scope areas:

- VS Code Local-chat session-store inspection
- destructive delete flows tied to current VS Code artifacts
- exact offline cleanup hacks
- live-chat transport or targeting logic that still depends on VS Code host quirks

## VS Code First, Not VS Code Only

The first delivery target is VS Code, but the repo name is intentionally broader because the long-term goal is provenance tooling that can be exposed through one or more IDE packages rather than remaining permanently fused to one experimental workflow repo.

## Repo Layout Rule

When a repo does not have `vscode` in its name, IDE-specific implementation should live under `ides/<ide>` rather than taking over the repo root.

Current rule application here:

- shared repo docs, assets, and migration notes stay in the repo root
- the actual VS Code extension package lives in `ides/vscode`
- future IDE ports should follow the same pattern, for example `ides/<future-ide>`

This keeps the repo name honest, keeps the root clean, and avoids accidentally treating one IDE package as the whole product.

## Boundary

This repo is intentionally separate from:

- `ai-vscode-tools`, which still owns VS Code-specific Local-chat inspection, session-store interop, delete flows, and the bounded `list_traceable_models` helper
- `feedback`, which remains the experimental home for topic-oriented feedback tooling

Move only what remains clearly useful as provenance infrastructure. Do not move host-specific Local-chat session-store and delete tooling into this repo just because it happens to coexist with TRACEABLE today.

Current operating posture:

- keep the `ides/vscode` package truthful about the bounded TRACEABLE surface it now owns
- keep docs, tests, and evidence UX aligned with the live provenance-side runtime
- keep `ai-vscode-tools` truthful about the narrower Local-chat/store boundary that remains there
- keep topic-oriented feedback tooling experimental in the `feedback` repo rather than moving it here

## License

This project is distributed under the Apache License 2.0.

- [LICENSE](LICENSE)
- [NOTICE](NOTICE)

## Support

If you find this work valuable and want to support its continued development: https://ko-fi.com/Tiinusen