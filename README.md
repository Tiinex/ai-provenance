# Tiinex AI Provenance

> **Current status: partially current.**
>
> This repository contains provenance-related work, but only the validator, linting, and provenance pieces that are still actively used should be treated as current without fresh validation.
>
> Treat VS Code extension, TRACEABLE runtime, Marketplace, LM tool, and workflow claims as historical or requiring revalidation unless a current validation note explicitly confirms them.
>
> Current Tiinex grounding surfaces:
>
> - `Tiinex/docs` — schemas, artifacts, policies, topics, and semantics
> - `Tiinex/site` — current public viewer / reference implementation
> - `Tiinex/ai-provenance` — partially current provenance validation/linting surface only
>
> Do not infer current Tiinex architecture or product state from this repo alone.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

- Canonical GitHub repo: https://github.com/Tiinex/ai-provenance

## Current Truth

Tiinex is provenance-first.

AI and LLM workflows are important use cases and pressure tests, but they are not the identity boundary of Tiinex.

This repo should not be used to describe Tiinex as a general-purpose AI runtime.

## Current Without Fresh Revalidation

Treat only these areas as current without additional verification:

- actively used validator pieces
- actively used linting pieces
- actively used provenance inspection or provenance-format pieces

If a claim is about VS Code extension behavior, TRACEABLE runtime behavior, Marketplace delivery, LM tools, host-specific workflows, or operator runtime state, verify it against a current validation note before presenting it as current.

## Historical Status Snapshot — Requires Revalidation

Older notes in this repository may describe:

- VS Code extension package work under `ides/vscode`
- TRACEABLE runtime experiments
- evidence parsing and evidence viewing experiments
- Marketplace-facing extension preparation
- LM tool surfaces and bounded runtime claims

Those notes may still be useful as history or source material, but they are not current Tiinex product truth unless revalidated.

## Intended Scope

This repo is meant to hold provenance-first tooling that can support readable artifacts, validation, linting, and inspection.

It should remain subordinate to the broader Tiinex identity:

> Tiinex keeps provenance readable in Markdown artifacts you own.

## Boundary

This repository is intentionally separate from:

- `Tiinex/docs`, which holds current schemas, artifacts, policies, topics, and semantics
- `Tiinex/site`, which holds the current public viewer/reference implementation
- stale or experimental Tiinex repos that should not be treated as current without revalidation

## Contribution Guide

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [TRACEABLE_PROVENANCE_COMPLETENESS_REVIEW.md](TRACEABLE_PROVENANCE_COMPLETENESS_REVIEW.md)
