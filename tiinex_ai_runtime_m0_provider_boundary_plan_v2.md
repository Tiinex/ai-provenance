# Tiinex AI Runtime M0 — Provider Boundary, Local Model Route, And Runtime Schema

## Purpose

Implement the smallest practical provider-agnostic Tiinex AI runtime slice inside `Tiinex/ai-provenance`.

The goal is to reduce dependency on native VS Code/Copilot language model routing while preserving the existing TRACEABLE runtime value:

- lineage
- runtime decision summary
- budget policy
- tool allow/block policy
- evidence output
- traceable chat surface
- status panel
- controlled model selection

This task should make Tiinex capable of using external/local providers, starting with a free local Ollama path through an OpenAI-compatible provider interface.

This is not a full Copilot clone.

This is not autocomplete.

This is not a broad rewrite.

This is a provider-boundary extraction plus the smallest usable local runtime path.

## Working Status

- 2026-06-12: Phase 0, 0.5, 1, 2, and the first Phase 3/4 route slice are implemented in code.
- 2026-06-12: Native `vscode-lm` now runs behind a provider adapter and external `openai-compatible`/`ollama` routes fail closed when misconfigured.
- 2026-06-12: External M0 remains text-only; tool calling is still explicitly unsupported for external routes in this phase.
- 2026-06-12: Current next focus is mock-covered transport behavior and bounded failure handling, not M0.5 feature expansion.

---

## M0 Core Cut

The first shippable M0 is intentionally smaller than full external-provider parity.

M0 core is complete when:

- Phase 0 boundary audit is done.
- Phase 0.5 local child runtime schema exists.
- Phase 1 native VS Code LM behavior is behind a compatibility provider adapter.
- Phase 2 provider settings exist and can disable Tiinex use of VS Code LM.
- Phase 3 OpenAI-compatible text-only provider works through mock tests.
- Phase 4 Ollama/local route is configurable.
- Phase 8 build/test coverage passes for the above.

The M0 core does **not** require:

- external provider tool calling
- full Traceable Chat parity
- full runtime evidence/schema cleanup
- live paid provider calls
- autocomplete
- full Copilot replacement UX

M0 must solve the immediate cost problem first:

> A text-only TRACEABLE lane can run through a local or OpenAI-compatible provider without using native VS Code LM/Copilot.

---

## M0.5 / Stretch Scope

The following phases remain valuable, but are not required for the first shippable M0 core:

- Phase 5 — Provider Tool Calling
- Phase 6 — Traceable Chat Provider Integration
- Phase 7 — Runtime Evidence And Schema Alignment beyond the minimal provider-route/failure recording needed by M0

Only start these after M0 core is green, unless implementation shows they are unexpectedly cheap and low-risk.

---

## M0 Text-Only External Provider Rule

External providers in M0 may be text-only.

If `runtimeProvider` is `openai-compatible` or `ollama` and provider tool support is unavailable, unsupported, or disabled, the runtime must not attempt to fake full tool parity.

It should instead:

- run a text-only DIRECT lane when the request can be satisfied without tools
- report unsupported tool capability clearly when tools are required
- preserve a bounded degraded/unresolved result when the request cannot be completed text-only
- avoid falling back to VS Code LM/Copilot unless explicitly configured

---

## Compatibility-Critical Runtime Fields

The provider extraction must preserve these existing runtime/result surfaces as compatibility-critical:

- request envelope / request contract summary
- selected model identity
- runtime decision summary
- allowed tool names
- tool call ledger
- trace status
- stop reason
- completion claim
- final summary
- validation issues
- opaque delegations
- usage summary
- timing summary
- raw model text bounds
- evidence basis
- debug log path when present
- status panel update path

Other presentation details may change if needed, but these fields must remain understandable and bounded.

---

## Current Grounding Snapshot

Repository:

- `Tiinex/ai-provenance`

Primary package:

- `ides/vscode`

Known existing runtime surface:

- VS Code extension package
- TRACEABLE language model tools
- `run_traceable_subagent`
- `list_traceable_models`
- `list_traceable_agents`
- `view_traceable_subagent`
- trace/evidence inspection
- runtime decision summaries
- budget policy
- tool allow/block lists
- evidence export
- status panel
- traceable chat commands

Known current coupling:

- model discovery currently uses `vscode.lm.selectChatModels(...)`
- model invocation currently uses `model.sendRequest(...)`
- tool execution currently uses `vscode.lm.invokeTool(...)`
- model alias declarations are currently mostly Copilot-shaped
- runtime fingerprint currently treats the host surface as VS Code LM
- settings currently include `traceablePreferredModels`, `traceableBlockedModels`, and undeclared runtime budgets, but not external provider config

Known useful existing seam:

The current runtime already receives tool calls, applies budget/defer/block rules, invokes tools, records tool results, and feeds tool results back into the model conversation.

Therefore the correct next move is not to rewrite the runtime.

The correct next move is to extract the model/provider transport behind an adapter.

---

## External Provider Decision

Use this order:

1. Native VS Code LM provider remains the compatibility adapter.
2. OpenAI-compatible provider is implemented as the first external provider abstraction.
3. Ollama is supported through the OpenAI-compatible/local endpoint path.
4. Paid cloud providers are not required for M0.

Initial free local target:

- Ollama
- model setting should default to empty or user-configured
- recommended local first model for dogfood: `qwen2.5-coder:7b`
- fallback for weaker machines: `qwen2.5-coder:3b` or `qwen2.5-coder:1.5b`
- do not hard-code these as required models

Do not require the user to install a specific model for tests.

Tests must use mocks.

Manual dogfood may use Ollama if installed.

---

## Dependency / Environment Notes For Implementer

Before implementing, inspect local environment.

Expected package path:

```bash
cd ides/vscode
```

Expected validation commands:

```bash
npm run build
npm test
```

Optional package command after build/test pass:

```bash
npm run package:vsix
```

If dependencies are missing:

```bash
npm install
```

For optional local dogfood only:

```bash
ollama pull qwen2.5-coder:7b
```

If the machine cannot run 7B comfortably, try:

```bash
ollama pull qwen2.5-coder:3b
```

or:

```bash
ollama pull qwen2.5-coder:1.5b
```

Do not block implementation on Ollama being installed.

If Ollama is unavailable, complete implementation and tests using mock providers, then report manual dogfood as not run.

---

## Governing Schema Context

Use current schema intent from `Tiinex/docs` as conceptual authority.

Relevant schema family:

- `tiinex.runtime.v1`
- `tiinex.machine.runtime.v1`
- `tiinex.ai.runtime.v1`

Use `tiinex.ai.runtime.v1` as the generic parent for AI-runtime semantics.

Do not copy old schema assumptions from this runtime if they conflict with current `Tiinex/docs`.

Do not perform broad schema cleanup.

---

## Required Local Child Schema

`ai-provenance` needs its own child runtime schema because the generic `tiinex.ai.runtime.v1` must remain host-agnostic.

Create a local schema in `Tiinex/ai-provenance` for this runtime’s concrete parseable output shape.

Suggested path:

```text
.topics/.schemas/tiinex.ai-provenance.runtime.v1.schema.md
```

Conceptual parent schema:

```text
tiinex.ai.runtime.v1
```

The local child schema owns the concrete TRACEABLE runtime/result/provider/tool shape for this repo.

It should not redefine the generic AI-runtime layer.

It should not move generic AI-runtime semantics out of `Tiinex/docs`.

It should not encode Copilot as the only provider route.

It should not require all providers to support tool calling.

---

## Local Child Schema Scope Rule

The local child schema must be minimal and code-led.

It should describe the smallest concrete runtime shape M0 actually emits or preserves, not a speculative future taxonomy.

Required for M0:

- provider route
- model id
- request contract summary
- runtime decision summary
- outcome fields:
  - stop reason
  - completion claim
  - final summary
- usage provenance:
  - exact
  - partial
  - unavailable
- degraded/failure state
- evidence basis if emitted
- tool ledger if present

Not required for M0 schema:

- full external tool-calling taxonomy
- multi-provider benchmark schema
- complete chat UX schema
- future model qualification schema

The schema may include forward-compatible optional sections, but validation-relevant required fields must match what M0 actually emits.

---

## Implementation Style Rule

This markdown is an orientation brief, not the source of truth.

Verify against the repository before implementation.

If code contradicts this plan, trust the code and report the mismatch.

Proceed independently through the M0 core phases unless a hard stop is hit.

Avoid repeated review interruptions.

Run local validation after meaningful patches.

At the end, report:

- files changed
- validations run
- what passed
- what was not run
- remaining uncertainty

---

## Hard Stops

Stop and report instead of continuing if:

- provider abstraction requires rewriting most of `traceableSubagent.ts`
- external provider tool calling cannot be mapped cleanly to current tool execution
- VS Code API prevents this extension from invoking the existing tool surface
- provider config would require storing raw API keys directly in settings
- tests would require live paid provider calls
- local build/test cannot run because dependencies are unavailable and cannot be installed
- schema creation conflicts materially with current `Tiinex/docs` schema semantics
- the task begins to require broad schema cleanup or trace-file mass rewriting

---

# Phase 0 — Boundary Audit

## Goal

Identify the exact runtime seams before patching.

## Inspect

Primary files:

- `ides/vscode/src/traceableSubagent.ts`
- `ides/vscode/src/extension.ts`
- `ides/vscode/package.json`
- `ides/vscode/tests/test.mjs`
- any nearby test or fixture files related to TRACEABLE runtime/model selection

## Audit Checklist

Before patching, identify:

- [ ] functions that call `vscode.lm.selectChatModels`
- [ ] functions that call `model.sendRequest`
- [ ] functions that call `vscode.lm.invokeTool`
- [ ] functions/types that depend on `vscode.LanguageModelChatMessage`
- [ ] functions/types that depend on `vscode.LanguageModelTextPart`
- [ ] functions/types that depend on `vscode.LanguageModelToolCallPart`
- [ ] functions/types that depend on `vscode.LanguageModelToolResultPart`
- [ ] existing runtime result fields that must remain compatible
- [ ] existing status panel assumptions that must not break
- [ ] existing evidence export assumptions that must not break
- [ ] existing model catalog assumptions that must not break

## DoD

- [ ] Short audit note exists in final report.
- [ ] Implementation target is narrowed to provider boundary.
- [ ] No broad rewrite has started before the audit.

---

# Phase 0.5 — Local AI-Provenance Runtime Schema

## Goal

Add a local child schema for this runtime’s concrete parseable runtime output.

## Suggested File

```text
.topics/.schemas/tiinex.ai-provenance.runtime.v1.schema.md
```

## Parent Relationship

Parent schema:

```text
tiinex.ai.runtime.v1
```

If the local repo has no `.topics/.schemas` directory, create it.

If a schema directory already exists, preserve its conventions.

## Required Schema Semantics

The schema should define stable parseable runtime signals for `ai-provenance` TRACEABLE runs:

- request contract
- provider route
- model selection
- runtime decision summary
- tool ledger
- budget policy
- stop reason
- completion claim
- final summary
- usage provenance
- evidence basis
- degraded/failure state
- raw provider output bounds

## Required Body Contract Groups

Inside `Schema Validation Contract`, include groups similar to:

```text
### AI-Provenance Runtime Scope
### Required Runtime Signals
### Provider Route
### Model Selection
### Runtime Decision Summary
### Tool Ledger
### Outcome
### Usage
### Evidence Basis
### Degraded Or Failure State
### Interpretation Boundaries
```

Adjust names if local schema style suggests better headings.

## Required Rules

- validation-relevant rules go inside `Schema Validation Contract`
- generation-only guidance goes inside `Artifact Creation Contract`
- explanatory prose must not silently define validator requirements
- schema must distinguish provider route from model id
- schema must distinguish runtime outcome from evidence basis
- schema must distinguish unsupported tool calling from failed tool calling
- schema must support text-only providers
- schema must not require Copilot
- schema must not require tool calling for all providers
- schema must include a minimal valid example
- schema should include a degraded/failure example or explicit degraded/failure rule

## Cross-Repo Parent Link Guidance

Because the parent schema lives in `Tiinex/docs`, include a clear parent/recovery surface.

Prefer:

- readable schema name
- relative link only if there is a local checked-in copy
- remote browse link when cross-repo
- pinned recovery link if the current repo convention supports it

Do not invent brittle old commit links.

If a pinned link is added, verify it resolves.

## DoD

- [ ] local child runtime schema file exists
- [ ] it declares `tiinex.ai.runtime.v1` as parent schema
- [ ] it has a clear `Schema Validation Contract`
- [ ] it defines required runtime result signals
- [ ] it defines provider route separately from model id
- [ ] it defines tool ledger without requiring all providers to support tools
- [ ] it defines usage provenance as exact/partial/unavailable or equivalent
- [ ] it defines degraded/failure state
- [ ] it includes a minimal valid example
- [ ] it does not encode Copilot as the only provider route
- [ ] it does not redefine generic AI-runtime semantics
- [ ] it is referenced later by runtime output alignment work

---

# Phase 1 — Extract Native VS Code LM Provider Adapter

## Goal

Move current VS Code LM behavior behind a provider adapter without changing behavior.

## Suggested New Files

Only add files if they reduce complexity.

Suggested:

```text
ides/vscode/src/traceableModelProvider.ts
ides/vscode/src/traceableVscodeLmProvider.ts
ides/vscode/src/traceableRuntimeProviderConfig.ts
```

## Suggested Provider Types

Use this as orientation, not as an exact forced implementation:

```ts
export type TraceableProviderId =
  | "vscode-lm"
  | "openai-compatible"
  | "ollama";

export interface TraceableProviderCapabilities {
  streaming: boolean;
  toolCalling: "native" | "none" | "unknown";
  usage: "exact" | "partial" | "unavailable";
}

export interface TraceableProviderModel {
  providerId: TraceableProviderId;
  id: string;
  displayName?: string;
  vendor?: string;
  family?: string;
  version?: string;
  sendable: boolean;
  capabilities: TraceableProviderCapabilities;
}

export interface TraceableProviderToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface TraceableProviderUsage {
  provenance: "exact" | "partial" | "unavailable";
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  note?: string;
}

export type TraceableProviderMessage =
  | {
      role: "system" | "user" | "assistant";
      content: string;
    }
  | {
      role: "tool";
      toolCallId: string;
      name: string;
      content: string;
    };

export interface TraceableProviderToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface TraceableProviderResponsePart {
  type: "text" | "toolCall" | "data";
  text?: string;
  toolCall?: TraceableProviderToolCall;
  data?: unknown;
}

export interface TraceableProviderRequest {
  model: TraceableProviderModel;
  messages: TraceableProviderMessage[];
  tools: TraceableProviderToolDefinition[];
  maxOutputTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface TraceableProviderResponse {
  parts: TraceableProviderResponsePart[];
  rawText: string;
  usage?: TraceableProviderUsage;
}

export interface TraceableModelProvider {
  id: TraceableProviderId;
  listModels(): Promise<TraceableProviderModel[]>;
  selectModel(selector: TraceableModelSelector): Promise<TraceableProviderModel | undefined>;
  sendRequest(request: TraceableProviderRequest): Promise<TraceableProviderResponse>;
}
```

If the existing VS Code types make this exact shape too expensive, preserve the intent:

- provider-neutral model identity
- provider-neutral usage
- provider-neutral response parts
- provider-neutral tool call shape
- native adapter wraps VS Code LM

## Requirements

- default provider remains `vscode-lm`
- existing `list_traceable_models` behavior remains compatible
- existing `run_traceable_subagent` behavior remains compatible
- existing tool execution remains compatible
- existing runtime evidence output remains compatible
- existing runtime decision summary remains compatible

## DoD

- [ ] native VS Code LM provider adapter exists
- [ ] main runtime can route through provider adapter
- [ ] no behavior change intended for existing VS Code LM path
- [ ] existing model catalog still works
- [ ] existing runtime evidence shape remains compatible
- [ ] existing tests pass
- [ ] no external provider behavior is mixed into this phase

---

# Phase 2 — Provider Settings

## Goal

Add minimal runtime provider configuration.

## Suggested Settings

Add to `ides/vscode/package.json` configuration:

```json
{
  "tiinex.aiProvenance.runtimeProvider": {
    "type": "string",
    "enum": ["vscode-lm", "openai-compatible", "ollama"],
    "default": "vscode-lm",
    "description": "Select the model provider route used by TRACEABLE runtime. `vscode-lm` preserves current behavior. `openai-compatible` and `ollama` are opt-in external/local routes."
  },
  "tiinex.aiProvenance.disableVscodeLmProviderForTraceableRuntime": {
    "type": "boolean",
    "default": false,
    "description": "When true, TRACEABLE runtime must not use the VS Code LM/Copilot provider route. This does not unload Copilot globally; it only controls Tiinex runtime routing."
  },
  "tiinex.aiProvenance.openAiCompatibleBaseUrl": {
    "type": "string",
    "default": "",
    "description": "Base URL for an OpenAI-compatible chat completions endpoint. For local Ollama this may be a localhost endpoint."
  },
  "tiinex.aiProvenance.openAiCompatibleApiKeyEnv": {
    "type": "string",
    "default": "",
    "description": "Name of the environment variable containing the API key for the OpenAI-compatible provider. Leave empty for local providers that do not require a key."
  },
  "tiinex.aiProvenance.openAiCompatibleModel": {
    "type": "string",
    "default": "",
    "description": "Model id for the OpenAI-compatible provider route."
  },
  "tiinex.aiProvenance.openAiCompatibleMaxOutputTokens": {
    "type": "number",
    "default": 1200,
    "minimum": 1,
    "description": "Maximum output token budget for OpenAI-compatible provider calls."
  },
  "tiinex.aiProvenance.openAiCompatibleTemperature": {
    "type": "number",
    "default": 0.2,
    "minimum": 0,
    "maximum": 2,
    "description": "Temperature for OpenAI-compatible provider calls."
  },
  "tiinex.aiProvenance.externalProviderMaxRequestsPerRun": {
    "type": "number",
    "default": 2,
    "minimum": 1,
    "description": "Fail-safe cap on external provider calls per TRACEABLE run."
  }
}
```

Adjust naming if existing config conventions require it.

## Rules

- do not store raw API keys directly in settings
- use env var indirection
- missing provider config must fail closed
- if `disableVscodeLmProviderForTraceableRuntime` is true, Tiinex runtime must not route through VS Code LM
- runtime fingerprint must record provider route without leaking secrets
- external provider route must be opt-in
- no implicit expensive fallback

## DoD

- [ ] provider settings exist
- [ ] settings are read through a small config module
- [ ] missing external provider config fails closed with clear output
- [ ] `disableVscodeLmProviderForTraceableRuntime` is honored
- [ ] runtime fingerprint records provider route
- [ ] no raw API key is written to trace/evidence/debug output
- [ ] tests cover missing provider config

---

# Phase 3 — OpenAI-Compatible Text-Only Provider

## Goal

Implement first external provider route in the smallest safe form.

## Scope

Text-only request/response.

No tool calling yet.

No streaming required for M0.

Use mock tests.

## Endpoint Shape

Target an OpenAI-compatible chat completions shape.

Implement defensively:

- configurable base URL
- configurable model
- API key from env var if configured
- no API key required when env setting is empty
- max output token setting
- temperature setting
- timeout or cancellation support if practical

## Provider Behavior

Required:

- convert TRACEABLE messages into provider request
- parse assistant text response
- normalize usage if present
- mark usage unavailable if absent
- preserve raw provider text within existing bounds
- return bounded failure on HTTP/network/provider errors

Not required yet:

- streaming
- tool calling
- multimodal input
- embeddings
- provider-specific model listing from remote API

## DoD

- [ ] OpenAI-compatible provider adapter exists
- [ ] text-only `DIRECT` run can complete through mocked external provider
- [ ] provider failure returns bounded unresolved result
- [ ] usage exact/partial/unavailable is normalized
- [ ] no external tool calls are attempted in this phase
- [ ] tests do not require network
- [ ] tests do not require secrets
- [ ] external provider route does not silently fall back to VS Code LM unless explicitly configured

---

# Phase 4 — Ollama Local Route

## Goal

Make local free provider dogfood practical through the OpenAI-compatible provider route or a thin `ollama` alias.

## Preferred Approach

Use OpenAI-compatible provider implementation if it can target Ollama cleanly.

The `ollama` provider route may simply be config sugar over the OpenAI-compatible route.

## Expected User Config Example

Example only; do not hard-code:

```json
{
  "tiinex.aiProvenance.runtimeProvider": "ollama",
  "tiinex.aiProvenance.openAiCompatibleBaseUrl": "http://localhost:11434/v1",
  "tiinex.aiProvenance.openAiCompatibleModel": "qwen2.5-coder:7b",
  "tiinex.aiProvenance.disableVscodeLmProviderForTraceableRuntime": true
}
```

If the actual Ollama route needs a different endpoint, implement the correct local route after verifying locally.

## Rules

- do not require Ollama for tests
- do not require a specific local model in tests
- missing local model must produce clear bounded error
- missing local server must produce clear bounded error
- local provider does not imply tool calling support
- text-only provider mode is acceptable for M0

## DoD

- [ ] Ollama-compatible config path exists
- [ ] local provider route can be selected without Copilot
- [ ] missing local server/model failure is bounded
- [ ] tests use mock transport
- [ ] manual dogfood instructions are documented
- [ ] no paid provider call is required

---

# Phase 5 — Provider Tool Calling

## Status

M0.5 / Stretch.

Do not treat this phase as required for the first shippable M0 core.

Start only after M0 core is green, unless implementation proves this phase is unexpectedly small and low-risk.

## Goal

Allow external providers to use the same bounded TRACEABLE tool execution policy as native VS Code LM provider.

## Current Runtime Invariant

The runtime, not the provider, owns:

- allowed tools
- blocked tools
- budget enforcement
- repeated anchored-read deferral
- non-reentrant `run_traceable_subagent` block
- `runSubagent` block inside TRACEABLE lanes
- tool ledger
- tool result persistence

Preserve this.

## Design Target

- convert selected VS Code tools into neutral provider tool definitions
- expose only allowed tools to provider
- parse provider tool calls into neutral `TraceableProviderToolCall`
- apply existing budget/defer/block logic
- execute approved tool calls through existing VS Code tool invocation path if possible
- feed tool result messages back to provider
- keep same ledger/evidence semantics

## Rules

- if provider has no tool-calling support, mark unsupported
- if provider emits malformed tool-call JSON, degrade honestly
- never expose blocked tools
- never allow self-reentry
- preserve tool-call budgets
- preserve malformed/failed tool call evidence

## DoD

Either:

- [ ] external provider tool calling is implemented and tested

or:

- [ ] external provider tool calling is explicitly marked unsupported for M0

If implemented:

- [ ] provider tool definitions are generated from selected tool surface
- [ ] external provider can request at least one safe read/search tool in a controlled mock test
- [ ] tool ledger records external-provider tool calls
- [ ] tool-call budget is enforced
- [ ] blocked tools remain blocked
- [ ] malformed tool calls do not crash runtime
- [ ] provider without tool support degrades honestly
- [ ] native VS Code LM path remains working

---

# Phase 6 — Traceable Chat Provider Integration

## Status

M0.5 / Stretch.

Do not treat this phase as required for the first shippable M0 core.

Start only after M0 core is green, unless implementation proves this phase is unexpectedly small and low-risk.

## Goal

Make Tiinex Traceable Chat usable enough for narrow dogfood without native Copilot Chat.

## Current Known UI Surface

Existing commands/settings include:

- `New Traceable Chat`
- `Resume Traceable Chat`
- chat sender role settings
- default sender role
- quick select role
- chat collapse setting
- traceable panel/status surface

Known placeholder:

- `Add File to Traceable Chat` may not be fully implemented

## M0.5 Target

- Traceable Chat can run through selected runtime provider
- provider/model route is visible in runtime decision summary
- runtime panel exposes selected provider/model
- evidence output records provider route
- disabled VS Code LM provider is respected

## Rules

- no full native Chat UX parity
- no autocomplete
- no broad UI rewrite
- no hidden fallback to Copilot
- placeholder features remain honestly marked if incomplete

## DoD

- [ ] New Traceable Chat uses runtime provider routing
- [ ] Resume Traceable Chat preserves or reports provider route
- [ ] runtime panel/status shows provider/model route
- [ ] evidence output records provider route
- [ ] user can avoid Tiinex runtime using VS Code LM/Copilot through settings
- [ ] incomplete file attachment features remain explicit

---

# Phase 7 — Runtime Evidence And Schema Alignment

## Status

Mostly M0.5 / Stretch.

For M0 core, do only the minimum needed to record:

- provider route
- model id
- bounded failure/degraded state
- usage provenance

Do not do broad output-shape cleanup during M0 core.

## Goal

Align runtime outputs with the new local child schema.

## Requirements

Runtime/evidence output should preserve:

- request contract
- provider route
- model id
- runtime decision summary
- completion claim
- stop reason
- final summary
- tool ledger if present
- usage provenance
- degraded/failure state
- evidence basis if present

## Rules

- do not leak API keys
- do not invent generic schema requirements in runtime code
- do not perform broad docs schema cleanup
- generic `tiinex.ai.runtime.v1` remains host-agnostic
- local `tiinex.ai-provenance.runtime.v1` owns concrete runtime shape

## M0 Core DoD

- [ ] runtime fingerprint supports provider routes beyond `vscode-lm`
- [ ] runtime decision summary includes provider id
- [ ] evidence/debug output does not leak API keys
- [ ] provider failures are preserved as bounded runtime outcomes
- [ ] output remains readable without custom viewer

## M0.5 DoD

- [ ] runtime output references or fully aligns with local child schema
- [ ] richer tool ledger schema alignment is completed if external tool calling is implemented
- [ ] schema alignment is documented but not overclaimed

---

# Phase 8 — Tests

## Rules

No live paid provider calls in tests.

No required Ollama server in tests.

No required secrets in tests.

Use mock provider transports.

## Minimum M0 Core Tests

- [ ] default provider remains VS Code LM route
- [ ] disabled VS Code LM provider fails closed when no external provider is configured
- [ ] OpenAI-compatible text-only response produces parseable runtime result
- [ ] provider failure produces bounded unresolved result
- [ ] missing API key env var produces bounded failure
- [ ] usage exact/partial/unavailable is normalized
- [ ] runtime evidence/debug output does not include API key values
- [ ] local child schema file exists and is minimally parseable
- [ ] existing extension tests still pass

## Optional M0.5 Tests

- [ ] external provider does not receive blocked tools
- [ ] malformed provider tool call is recorded as incomplete/degraded if tool calling is implemented
- [ ] provider without tool support degrades honestly when tool use is required

## Expected Commands

```bash
cd ides/vscode
npm run build
npm test
```

Optional after green:

```bash
npm run package:vsix
```

## DoD

- [ ] build passes
- [ ] tests pass
- [ ] no live provider calls are required
- [ ] no secrets are required
- [ ] package command is run only after build/test are green, or explicitly skipped

---

# Phase 9 — Manual Dogfood

Only after build/test pass.

## Dogfood 1 — Local Text-Only

Provider:

- Ollama / local OpenAI-compatible endpoint

Mode:

- DIRECT

Tools:

- none

Budgets:

- max provider requests: 1–2
- max output tokens: low
- max iterations: 1–2

Expected:

- bounded answer
- provider route recorded
- no Copilot use when disabled
- usage exact/partial/unavailable recorded honestly

## Dogfood 2 — Local Missing Server

Provider:

- Ollama route configured but server unavailable

Expected:

- bounded failure
- no crash
- no Copilot fallback when disabled

## Dogfood 3 — Tool-Enabled External Provider

M0.5 only.

Only if Phase 5 tool calling is implemented.

Provider:

- local or mock-capable external provider

Tools:

- one safe read/search tool

Budgets:

- max tool calls: 1–2

Expected:

- tool ledger records request/result
- budget enforced
- blocked tools not exposed

## DoD

- [ ] at least one local text-only dogfood is attempted if Ollama is installed
- [ ] if Ollama is not installed, dogfood is explicitly skipped
- [ ] no paid provider dogfood is required
- [ ] dogfood result is summarized in final report

---

# Cost Controls

External provider defaults should be strict.

Suggested defaults:

- max provider requests per run: 2
- max output tokens: 1200
- max tool calls: 2
- max iterations: 2
- no implicit expensive fallback
- no paid live calls in tests
- no automatic cloud fallback when local provider fails

Usage rules:

- if exact token usage is returned, preserve it
- if partial usage is returned, mark partial
- if usage is missing, mark unavailable
- do not guess cost
- do not estimate money unless pricing data is explicitly provided

---

# Implementation Order

Do not skip order unless code facts require it.

## M0 Core Order

1. Phase 0 — Boundary audit
2. Phase 0.5 — Local child runtime schema
3. Phase 1 — Native VS Code LM adapter
4. Phase 2 — Provider settings
5. Phase 3 — OpenAI-compatible text-only provider
6. Phase 4 — Ollama local route
7. Phase 7 minimal provider-route/failure/usage evidence alignment only
8. Phase 8 — Tests
9. Phase 9 — Manual dogfood

## M0.5 / Stretch Order

10. Phase 5 — Provider tool calling
11. Phase 6 — Traceable Chat provider integration
12. Phase 7 full runtime evidence/schema alignment

Proceed independently through M0 core.

Stop only on hard stops.

If a phase is too large, close the smallest working subset and clearly mark what remains.

Do not begin M0.5/stretch phases until M0 core is green unless they are unexpectedly trivial and low-risk.

---

# Final M0 Core DoD

- [ ] Boundary audit completed.
- [ ] `ai-provenance` owns a child runtime schema for concrete TRACEABLE provider/runtime output.
- [ ] Child runtime schema inherits conceptually from `tiinex.ai.runtime.v1`.
- [ ] Child runtime schema is minimal and code-led, not speculative.
- [ ] Generic docs schemas remain host-agnostic.
- [ ] Existing VS Code LM/Copilot-backed runtime still works as a provider adapter.
- [ ] Tiinex runtime can be configured to avoid VS Code LM/Copilot provider use.
- [ ] OpenAI-compatible provider can run a text-only TRACEABLE lane through mock tests.
- [ ] Ollama/local OpenAI-compatible endpoint can be configured.
- [ ] External provider failures are bounded and traceable.
- [ ] API keys are not persisted in evidence/debug output.
- [ ] Runtime decision summary records provider route and model.
- [ ] Usage metadata is exact/partial/unavailable, not guessed.
- [ ] External provider tool-calling is either explicitly unsupported for M0 or implemented only if cheap and low-risk.
- [ ] Existing build/test pass.
- [ ] No broad schema cleanup was mixed into this runtime task.
- [ ] No trace-file mass rewrite was mixed into this runtime task.
- [ ] No live paid provider call is required.
- [ ] Remaining gaps are listed as M0.5 or M1 candidates, not hidden.

---

# M0.5 / Stretch DoD

Only after M0 core is green:

- [ ] External provider tool-calling is implemented with budgeted tool ledger, or remains explicitly unsupported.
- [ ] Traceable Chat can use provider route enough for narrow dogfood.
- [ ] Runtime output fully aligns with local child schema beyond minimal M0 provider-route/failure recording.
- [ ] Tool ledger schema alignment covers external provider calls.
- [ ] Remaining native-chat UX gaps are listed honestly.

---

# Final Report Format

At completion, respond with:

```text
Implemented:
- ...

Changed files:
- ...

Validation:
- npm run build: pass/fail/not run
- npm test: pass/fail/not run
- npm run package:vsix: pass/fail/not run/skipped

Provider status:
- vscode-lm:
- openai-compatible:
- ollama:

Schema status:
- local child runtime schema:

Dogfood:
- local Ollama text-only:
- missing-server failure:
- tool-enabled provider:

M0 core status:
- complete/incomplete
- if incomplete, why

M0.5/stretch status:
- not started/partial/complete

Remaining gaps:
- ...

Hard stop hit:
- yes/no
- if yes, why
```

Keep final response compact.
