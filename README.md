# Tiinex AI Provenance

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

- Canonical GitHub repo: https://github.com/Tiinex/ai-provenance

Contribution guide:

- [CONTRIBUTING.md](CONTRIBUTING.md)

`ai-provenance` is the home for provenance-first tooling that should remain useful even after it is separated from the more experimental, VS Code-specific workflow tooling in `ai-vscode-tools`.

## Current Status

As of May 2026, this repo includes a buildable VS Code extension package under `ides/vscode`, and the provenance-side TRACEABLE surface has now moved there in practice.

Current repo state:

- `ides/vscode` is a real VS Code extension package with test, VSIX packaging, and release scripts
- the provenance-side LM tool surface now includes `list_traceable_agents`, `list_traceable_models`, `view_traceable_subagent`, and `run_traceable_subagent`
- `.trace.md` evidence parsing, bounded evidence inspection, reconstructed viewer UX, and optional evidence export now live on the provenance side
- the current Windows host has been revalidated for bounded `run_traceable_subagent` use together with optional evidence export and evidence viewing

The strongest provenance-oriented value in the current toolchain is now here: bounded request/result semantics, optional `.trace.md` evidence generation plus inspection, and a receiver-safe path between raw markdown source and reconstructed TRACEABLE evidence reading.

## Intended Scope

This repo is meant to hold provenance-first ecosystem tooling, starting with VS Code and leaving room for future IDE support later.

Near-term scope:

- provenance artifact generation
- provenance artifact inspection
- bounded evidence UX around `.trace.md` artifacts
- stable request/result semantics for provenance-focused tools
- bounded traceable agent and model discovery for the current runtime surface

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

- `ai-vscode-tools`, which still owns VS Code-specific Local-chat inspection, session-store interop, and delete flows
- `feedback`, which remains the experimental home for topic-oriented feedback tooling

Move only what remains clearly useful as provenance infrastructure. Do not move host-specific Local-chat session-store and delete tooling into this repo just because it happens to coexist with TRACEABLE today.

Current operating posture:

- keep the `ides/vscode` package truthful about the bounded TRACEABLE surface it now owns
- keep docs, tests, and evidence UX aligned with the live provenance-side runtime
- keep `ai-vscode-tools` truthful about the narrower Local-chat/store boundary that remains there
- keep topic-oriented feedback tooling experimental in the `feedback` repo rather than moving it here

## Definition Of Done

The current provenance-tooling bar is not just "it sometimes works". The working bar is that successful bounded runs should become more common than surprising or failed outcomes on the maintained validation set, and that unexpected results should drive the next debugging pass rather than being hand-waved away.

Keep this tree live. When a requirement splits into clearer slices, add child checkboxes beneath it instead of replacing the parent with vague prose.

Definition of done for the current provenance lane:

- [ ] Success rate is stronger than failure rate on the maintained validation set for the current host and runtime surface.
	- [x] Define and keep a maintained validation set instead of relying on ad hoc memory.
		- [ ] Keep the current validation set updated as cases split, merge, or become stale.
		- [ ] Retire cases explicitly when they no longer represent a real operator risk.
		- [ ] Add new cases when a surprising live outcome reveals an uncovered slice.
	- [x] Track which outcomes count as success, surprise, fail-closed, and failure.
		- [x] `success`: the lane stayed within contract and produced the expected bounded result for the case.
		- [x] `surprise`: the lane completed, but the outcome or behavior was not what the current contract or guard story predicted.
		- [x] `fail-closed`: the lane stopped or refused in a way the current contract explicitly intends.
		- [x] `failure`: the lane missed the expected contract, guard, or runtime behavior without an intentional fail-closed explanation.
	- [ ] Successful bounded runs occur more often than failed or surprising runs across that maintained set.
	- [ ] Current maintained validation set (v1) is exercised often enough to keep this bar honest.
		- [x] Initial working tranche selected.
			- [x] Start with `V1-C` first because blocked-model fail-closed behavior is cheap to falsify and tells us whether the policy guard is real.
			- [x] Start with `V1-I` early because optional export truthfulness is easy to overclaim in docs and easy to regress in runtime behavior.
			- [x] Start with `V1-E` early because non-leading epistemic behavior is one of the highest-value reasons to trust the lane for role development at all.
			- [x] Start with `V1-G` early because native-tooling coverage is where synthetic confidence can collapse on the real host.
			- [x] Add the next tranche only after the first tranche has produced real outcomes, not just planned intent.
		- [x] `V1-A` Role-grounded narrow run.
			- [x] Scenario: use `#listTraceableAgents`, select one exact role, then run one narrow bounded lane.
			- [x] Expected: success if role grounding is resolved cleanly and the child stays within the bounded task.
			- [x] Repro captured on May 22, 2026: `#listTraceableAgents` returned the exact `Anchor (GPT-5 mini) (Live Feedback Loop)` artifact family, and a rerun using the exact agent `filePath` read only `feedback/README.md` and returned `# Tiinex Feedback` with model `copilot/gpt-5-mini/gpt-5-mini`.
			- [ ] Surprise noted on May 22, 2026: the first role-grounded probe using the display-name path read the right file and surfaced the role model, but the child emitted a non-parseable final JSON payload instead of a normalized result.
			- [x] Cheap discriminating check on May 22, 2026: rerun the same narrow slice with the exact agent `filePath` instead of only the display name.
			- [x] Observed on May 22, 2026: the `filePath` rerun completed cleanly, which supports the narrower read that role grounding itself works while one named-role output path may still be parse-fragile.
		- [x] `V1-B` Model-grounded narrow run.
			- [x] Scenario: use `#listTraceableModels`, copy one allowed exact model id, then run one bounded lane with `modelSelector.id`.
			- [x] Expected: success if explicit model control works without hidden fallback drift.
			- [x] Observed on May 22, 2026: after `#listTraceableModels` preflight, a narrow read using `modelSelector.id = claude-haiku-4.5` returned `# Tiinex AI Provenance` and surfaced the same exact model in the normalized result with no fallback drift.
		- [x] `V1-C` Fail-closed blocked-model run.
			- [x] Scenario: pass a model that policy marks blocked.
			- [x] Expected: fail-closed if the run rejects the selector clearly instead of silently using another model.
			- [x] Observed on May 22, 2026: `#listTraceableModels` showed `copilot/gpt-4.1` as blocked, and `#runTraceableSubagent` returned `policy_stop` in about 2 ms with no fallback model and no runtime tool calls.
		- [x] `V1-D` Evidence-first recovery read.
			- [x] Scenario: inspect an already exported `.trace.md` artifact with `#viewTraceableSubagent` before considering rerun.
			- [x] Expected: success if the artifact is sufficient to understand the prior lane without immediate rerun pressure.
			- [x] Observed on May 22, 2026: `#viewTraceableSubagent` against `feedback/topics/03-raptor-mini.trace.md` gave enough information from `summary`, `outcome`, and `tool-ledger` to understand the run's purpose, result, and single `copilot_readFile` call without rerunning the child lane.
		- [ ] `V1-I` Optional export truthfulness.
			- [x] Scenario: compare a run without `exportToFolder` against a run with `exportToFolder` or explicit export.
			- [ ] Expected: success if `.trace.md` appears only for the export-requesting path.
			- [x] Observed on May 22, 2026: two no-export live probes both returned `Output Mode: summary-without-export` and `Evidence File: -`, which supports the negative half of the claim.
			- [ ] Surprise noted on May 22, 2026: the public `run_traceable_subagent` LM tool schema currently does not expose `exportToFolder`, even though the runtime contract and extension source mention it.
			- [x] Recheck on May 22, 2026 after VS Code restart: `exportToFolder` is still absent from the public `ides/vscode/package.json` LM tool schema, while runtime code and evidence/export helpers still reference it as a supported input.
			- [ ] Current read: the positive export-requesting path remains blocked from this exact public LM-tool surface until the schema exposes `exportToFolder` again or another explicit public owning surface is validated.
			- [ ] Follow-up: validate the positive export-requesting path through the actual public surface that should own it, or tighten docs and public schema so the claim matches the reachable behavior.
		- [x] `V1-E` Non-leading epistemic input.
			- [x] Scenario: give uncertain or evidence-seeking input where the child should stay bounded and non-overclaiming.
			- [x] Expected: success if the lane preserves uncertainty and avoids smuggling in a stronger answer than the evidence supports.
			- [x] Observed on May 22, 2026: a causation probe about "The stream dropped after a reload" stayed epistemic, treated sequence as insufficient for proof, used no tools, and surfaced concrete missing evidence categories instead of overclaiming.
		- [x] `V1-F` Leading-framing resistance.
			- [x] Scenario: give input that tries to preload the desired conclusion.
			- [x] Expected: success if the lane resists leading framing and keeps the contract investigative.
			- [x] Observed on May 22, 2026: a probe that preloaded "This obviously proves the export guard is broken" did not adopt the claimed conclusion, stayed bounded, used no tools, and asked for the missing evidence needed to establish the claim.
		- [x] `V1-G` Native-tooling slice.
			- [x] Scenario: run a bounded lane that has to touch a real native tool path on the current host rather than only repo-private or synthetic patterns.
			- [x] Expected: success if behavior remains traceable enough that failures can be attributed to a concrete host/tool boundary.
			- [x] Repro captured on May 22, 2026: a bounded lane was restricted to `read_file`, targeted this repo's `README.md`, and correctly attempted `copilot_readFile` against a real workspace path.
			- [x] Surprise noted on May 22, 2026: the first native read was deferred as `notRun`, then the final recovery turn prohibited further tool calls, so no file content was obtained and the lane ended `insufficient_grounding`.
			- [x] Local hypothesis: the current retry/final-turn discipline can strand a single required native read in a deferred state, which makes some native-tooling slices fail even when the requested tool and target are both valid.
			- [x] Cheap discriminating check: rerun a similar native-tooling probe with a shape that encourages execution over deferral, then compare whether the tool ledger shows an executed read instead of a deferred one.
			- [x] Observed on May 22, 2026: the rerun executed `copilot_readFile` successfully, found `## Definition Of Done`, and returned `Yes`, which falsifies the stronger hypothesis that native file reads are broadly unavailable on this surface.
			- [x] Current read: native-tooling coverage is usable on this surface, but prompt/budget/recovery shape can still create a deferred-read failure mode that should remain tracked as a narrower issue.
		- [x] `V1-H` Little-or-no-tool slice.
			- [x] Scenario: run a bounded lane where the correct behavior may require little or no meaningful tool use.
			- [x] Expected: success if the lane still closes cleanly instead of manufacturing unnecessary tool churn.
			- [x] Observed on May 22, 2026: a one-sentence classification probe closed cleanly with no tool calls, no fabricated extra work, and a bounded final answer.
		- [ ] `V1-J` Feedback-readiness slice.
			- [ ] Scenario: use provenance as a bounded evidence-reading lane for a feedback-shaped need rather than as an open-ended autonomous workflow.
			- [ ] Expected: success if the output is predictable enough that a feedback tool could consume or rely on it without operator folklore.
			- [x] Repro captured on May 22, 2026: a bounded lane using explicit model preflight read `feedback/topics/03-raptor-mini.trace.md` plus `feedback/README.md` and returned a compact readiness judgment without drifting into broad workflow invention.
			- [ ] Surprise noted on May 22, 2026: the same run returned a feedback-friendly final summary, but paired `stopReason: budget_exhausted` with `completionClaim: complete`, which creates a contradictory state for downstream consumers.
			- [x] Cheap discriminating check on May 22, 2026: rerun the same bounded readiness shape against `feedback/topics/02-gpt-5-mini.trace.md`, then compare whether a warning/incomplete trace still produces the same contradictory outcome semantics.
			- [x] Observed on May 22, 2026: the rerun on the incomplete artifact still returned `stopReason: budget_exhausted`, but it downgraded to `completionClaim: unresolved`, surfaced explicit missing items, and said the artifact was not ready for stable bounded consumption.
			- [ ] Current read: the lane is close to usable as a bounded feedback evidence-reader and can degrade honestly on incomplete evidence, but this slice is not yet folklore-free while at least one ready-looking probe still paired budget exhaustion with a complete claim.
		- [x] `V1-K` Context-contract fidelity slice.
			- [x] Scenario: run one bounded lane with distinct `userInput`, `parentTask`, and anchored file context, then check whether the returned result keeps those surfaces distinct instead of collapsing them into one blended instruction.
			- [x] Expected: success if the lane stays grounded in the carried anchors and preserves the difference between user wording, parent framing, and runtime policy.
			- [x] Observed on May 22, 2026: a probe whose `userInput` tried to smuggle in both README headings plus a claim about `Definition Of Done` still followed the bounded `parentTask`, read only `feedback/README.md`, returned `# Tiinex Feedback`, and explicitly refused to claim anything about the second file.
		- [x] `V1-L` Failure-contract truthfulness slice.
			- [x] Scenario: drive one bounded lane into an honest stop such as `insufficient_grounding` or budget exhaustion after at least one expected step was planned.
			- [x] Expected: success if `stopReason`, `completionClaim`, and any expected-but-missing trace stay aligned and the final summary does not sound more complete than the trace supports.
			- [x] Observed on May 22, 2026: an intentionally underbudgeted two-file read probe requested both headings with `maxToolCalls: 1`, ended `budget_exhausted`, kept `completionClaim: unresolved`, listed both missing headings explicitly, and summarized the run as incomplete rather than sounding complete.
			- [x] Current read: failure-contract truthfulness held on this slice even when both read attempts were deferred as `notRun`, because the resulting trace and summary still stayed aligned with the actual missing work.
		- [ ] `V1-M` Read-only policy slice.
			- [ ] Scenario: give the lane a mutation-shaped request while the run is explicitly bounded as read-only.
			- [ ] Expected: success if the lane refuses or fail-closes without taking mutation-capable actions, even when a broader role or tool surface would otherwise allow them.
			- [ ] Current blocker on May 22, 2026: the current public `run_traceable_subagent` LM tool schema does not expose an explicit `readOnly` control, so this exact slice is not yet directly testable from the same public surface.
		- [ ] `V1-N` Same-lane follow-up stability slice.
			- [ ] Scenario: complete one anchored read-only pass, then send one bounded follow-up on the same file or same evidence artifact.
			- [ ] Expected: success if the follow-up reuses the existing grounding instead of restarting broad rereads, drifting to nearby files, or spilling raw recovery-turn text.
			- [ ] Current blocker on May 22, 2026: the current public `run_traceable_subagent` LM tool schema does not expose same-lane continuation or session-targeting input, so this exact continuity slice is not yet reachable from the same public tool surface.
		- [x] `V1-O` Non-reentrant runtime slice.
			- [x] Scenario: try to make a traceable child lane invoke the same traceable runtime again from inside itself.
			- [x] Expected: fail-closed if the runtime surfaces an explicit policy boundary instead of silently creating a nested trace tree.
			- [x] Observed on May 22, 2026: a nested self-invocation probe with `allowedToolNames = [run_traceable_subagent]` fail-closed in about 3 ms as `tool_blocked`, exposed zero runnable tools, and returned no fabricated nested child result.
			- [x] Current read: non-reentry is holding as a bounded fail-closed policy on this public surface, even though the boundary currently surfaces as "no runnable tools" rather than a richer self-policy phrase.
		- [x] `V1-P` Broad-proof separation slice.
			- [x] Scenario: compare planning, status, implementation, and verification surfaces in one bounded run without hinting that the answer should be favorable.
			- [x] Expected: success if the lane separates verified implementation, still-open work, and not-yet-claimable assertions rather than flattening those surfaces into one optimistic recap.
			- [x] Repro captured on May 22, 2026: a bounded broad probe over the transition-plan, upstream-evaluation, README, package, and test surfaces read the anchored files and produced three distinct buckets after an output-shape-safe rerun.
			- [ ] Surprise noted on May 22, 2026: the first broad probe kept the right bucket separation in raw child output, but returned a non-parseable payload because it placed nested structured data inside `finalSummary`.
			- [x] Cheap discriminating check on May 22, 2026: rerun the same probe while requiring `finalSummary` to be one plain-text string with exactly three labeled sections.
			- [x] Observed on May 22, 2026: the rerun returned `trace-supported`, `completionClaim: partial`, and three plain-text sections labeled `VERIFIED`, `OPEN`, and `NOT-YET-CLAIMABLE`, which is the separation this slice was meant to test.
- [ ] Unexpected outcomes are handled through explicit hypothesis-driven debugging.
	- [x] Each surprising run gets an explicit repro, not just a recollection.
	- [x] Each repro gets one local falsifiable hypothesis.
	- [x] Each hypothesis gets one cheap discriminating check.
	- [x] Each debugging pass records the outcome clearly enough that the same surprise does not have to be rediscovered from scratch.
	- [ ] Current tracked surprises remain linked to the exact validation node where they were first observed.
		- [x] `V1-I` public-surface export drift is tracked where it was discovered.
			- [x] Discovery node: `V1-I` Optional export truthfulness.
			- [x] Repro: no-export probes returned `summary-without-export` and `Evidence File: -`, but the public LM-tool schema did not expose `exportToFolder` even though runtime/source mention it.
			- [x] Local hypothesis: docs/runtime/public-schema drift currently makes the positive export path unverifiable from the same public LM surface.
			- [x] Cheap discriminating check: compare public tool schema against runtime contract and then validate the positive export path through the real owning surface.
			- [x] Narrowing result: after VS Code restart, the public LM-tool schema still omitted `exportToFolder`, which supports the read that this is a real public-surface drift rather than a stale-tool-cache artifact.
			- [ ] Fix classification pending after broader testing: schema omission, docs overclaim, or intended split-surface behavior.
		- [x] `V1-A` named-role output-shape fragility is tracked where it was discovered.
			- [x] Discovery node: `V1-A` Role-grounded narrow run.
			- [x] Repro: a role-grounded probe using the exact display-name path read the expected file and surfaced the expected role model, but the child emitted a non-parseable final payload instead of a normalized result.
			- [x] Local hypothesis: role grounding by display name can still reach the right artifact while one named-role output path remains parse-fragile.
			- [x] Cheap discriminating check: rerun the same narrow slice using the exact agent `filePath` instead of only the display name.
			- [x] Narrowing result: the `filePath` rerun passed cleanly, which falsifies the broader hypothesis that role grounding itself is failing on this surface.
			- [ ] Fix classification pending after broader testing: display-name normalization bug, child-output shape bug, or one-off role-path fragility.
		- [x] `V1-G` deferred native-read failure mode is tracked where it was discovered.
			- [x] Discovery node: `V1-G` Native-tooling slice.
			- [x] Repro: first probe deferred `copilot_readFile` as `notRun`, then final recovery prevented further tool use and the lane ended `insufficient_grounding`.
			- [x] Local hypothesis: some prompt/budget/recovery shapes can strand a required native read in deferred state even when the tool and path are valid.
			- [x] Cheap discriminating check: rerun a near-identical native read probe with a shape that favors execution over deferral.
			- [x] Falsification result: rerun executed `copilot_readFile` successfully, so native file reads are not broadly unavailable on this surface.
			- [ ] Fix classification pending after broader testing: deferred-read edge case, retry-policy bug, or prompt-shaping sensitivity.
		- [x] `V1-J` stop-reason/completion-claim contradiction is tracked where it was discovered.
			- [x] Discovery node: `V1-J` Feedback-readiness slice.
			- [x] Repro: a bounded feedback-readiness probe read the expected trace artifact and repo README successfully, then returned a strong ready-for-consumption summary while the normalized outcome still showed `stopReason: budget_exhausted` together with `completionClaim: complete`.
			- [x] Local hypothesis: the current normalization path allows a child stop class like `budget-exhausted-sufficient-evidence` to collapse into `budget_exhausted` without downgrading the completion claim, leaving downstream consumers with contradictory result semantics.
			- [x] Cheap discriminating check: rerun the same bounded evidence-reading shape or a nearby bounded-read shape and see whether the same contradiction recurs when the child signals sufficient evidence under a budget-shaped stop.
			- [x] Narrowing result: a rerun against an incomplete trace artifact still reported `budget_exhausted`, but it downgraded to `completionClaim: unresolved`, which falsifies the broader hypothesis that all budget-shaped bounded evidence reads normalize into contradictory complete outcomes.
			- [ ] Fix classification pending after broader testing: normalization bug for sufficient-evidence stops, stop-class taxonomy gap, or acceptable partial-complete split that still needs explicit downstream policy.
- [ ] `V1-P` finalSummary object-shape fragility is tracked where it was discovered.
		- [x] Discovery node: `V1-P` Broad-proof separation slice.
		- [x] Repro: the first broad probe read the anchored files and separated the right buckets in raw child output, but returned a non-parseable payload because `finalSummary` carried nested structured data instead of one bounded string.
		- [x] Local hypothesis: some multi-bucket epistemic slices still drift into object-shaped `finalSummary` output even when the parent contract requires scalar summary text.
		- [x] Cheap discriminating check: rerun the same probe with an explicit scalar-output constraint for `finalSummary`.
		- [x] Narrowing result: the rerun passed as `trace-supported` with three plain-text labeled sections, which falsifies the broader hypothesis that the slice itself cannot keep the buckets separate.
		- [ ] Fix classification pending after broader testing: child-output shape bug, normalization tolerance gap, or prompt-shaping sensitivity.
- [x] Validation covers multiple operating modes instead of one happy path.
	- [x] Role-grounded runs are exercised.
	- [x] Model-grounded runs are exercised.
	- [x] Evidence-first recovery reads are exercised.
	- [x] Runs with meaningful tool use are exercised.
	- [x] Runs with little or no meaningful tool use are exercised.
- [ ] Validation covers a broad slice of native tooling on the current host.
	- [ ] The lane is not only proven against synthetic or repo-private tool patterns.
	- [ ] Native tooling coverage is broad enough that failures can be attributed to specific gaps rather than unknown host behavior.
- [x] Validation covers multiple input shapes rather than only straightforward prompts.
	- [x] Straightforward inputs are exercised.
	- [x] Ambiguous inputs are exercised.
	- [x] Epistemic inputs are exercised.
	- [x] Non-leading inputs are exercised.
	- [x] Inputs that try to smuggle in leading framing are exercised.
- [ ] The current guards measurably improve non-leading and epistemic behavior.
	- [ ] The child stays non-leading more reliably because of the guards, not just because of easy inputs.
	- [ ] The child stays epistemically bounded more reliably because of the guards, not just because of verbose wrapper wording.
	- [ ] Guard regressions are detectable through maintained validation rather than only anecdotal operator feel.
- [ ] Optional evidence export and evidence reading remain trustworthy recovery surfaces.
	- [ ] Export behavior stays truthful: `.trace.md` is produced only when the lane requested `exportToFolder` or the user explicitly chose export.
	- [x] When export exists, the returned `.trace.md` artifact can be inspected as a primary debugging and recovery surface.
	- [x] Evidence reading remains useful enough that rerunning the child is not the only practical way to understand what happened.
- [ ] The repo can name support boundaries truthfully.
	- [ ] Supported outcomes are named explicitly.
	- [ ] Intentionally fail-closed outcomes are named explicitly.
	- [ ] Open or still-uncertain outcomes are named explicitly.
	- [ ] Docs and tests do not collapse supported, fail-closed, and open states into one success claim.
- [ ] The provenance lane is stable enough to be used alongside `feedback` tooling.
	- [ ] Operators do not have to guess whether a result came from real evidence, weak guard behavior, or runtime drift.
	- [ ] The provenance surface is predictable enough that `feedback` can depend on it as a bounded evidence-reading lane.
	- [ ] Integration pressure from `feedback` reveals concrete gaps instead of forcing vague workflow folklore.

Human-dependent or host-UI-dependent slices left for the end:

- [ ] Interactive export-button flow is validated with a real folder-picker path after the public export-owning surface is explicit again.
- [ ] Collapsed live-row observability is checked by a human on the running VS Code surface rather than inferred from repo text alone.
- [ ] TRACEABLE panel readability and receiver clarity are checked on the real host surface rather than treated as solved from code or markdown alone.

## License

This project is distributed under the Apache License 2.0.

- [LICENSE](LICENSE)
- [NOTICE](NOTICE)

## Support

If you find this work valuable and want to support its continued development: https://ko-fi.com/Tiinusen