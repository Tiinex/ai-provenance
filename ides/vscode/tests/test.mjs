import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getUniqueWorkspaceFolderMatchByName,
  isPathWithinAnyWorkspaceRoot,
  resolveDriveLessAbsolutePathOnWindows,
  resolveRelativeOpenPathInWorkspace
} from "../src/traceableOpenPath.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");

async function main() {
  const workspaceFolders = [
    { name: "ai-provenance", fsPath: path.win32.normalize("C:/Users/micro/Documents/Repos/Tiinex/ai-provenance") },
    { name: "ai", fsPath: path.win32.normalize("C:/Users/micro/Documents/Repos/Tiinex/ai") },
    { name: "youtube", fsPath: path.win32.normalize("C:/Users/micro/Documents/Repos/Tiinex/youtube") }
  ];
  const existingPaths = new Set([
    path.win32.normalize("C:/Users/micro/Documents/Repos/Tiinex/ai-provenance/.topics"),
    path.win32.normalize("C:/Users/micro/Documents/Repos/Tiinex/ai"),
    path.win32.normalize("C:/Users/micro/Documents")
  ]);
  const pathExists = async (filePath) => existingPaths.has(path.win32.normalize(filePath));

  assert.equal(
    await resolveRelativeOpenPathInWorkspace(".topics", workspaceFolders, pathExists),
    path.win32.normalize("C:/Users/micro/Documents/Repos/Tiinex/ai-provenance/.topics"),
    "Relative open paths should resolve inside the current workspace folder when that target exists."
  );
  assert.equal(
    await resolveRelativeOpenPathInWorkspace("ai", workspaceFolders, pathExists),
    path.win32.normalize("C:/Users/micro/Documents/Repos/Tiinex/ai"),
    "Relative open paths that name another workspace root should resolve to that root in a multi-root workspace."
  );
  assert.equal(
    await resolveDriveLessAbsolutePathOnWindows("/Users/micro/Documents", workspaceFolders, "C:", pathExists, "win32"),
    path.win32.normalize("C:/Users/micro/Documents"),
    "Drive-less absolute Windows paths should recover to an existing drive-rooted path."
  );
  assert.equal(
    getUniqueWorkspaceFolderMatchByName("ai", workspaceFolders),
    path.win32.normalize("C:/Users/micro/Documents/Repos/Tiinex/ai"),
    "Workspace-root fallback should uniquely match repo names in a multi-root workspace."
  );
  assert.equal(
    isPathWithinAnyWorkspaceRoot(path.win32.normalize("C:/Users/micro/Documents/Repos/Tiinex/ai-provenance/.topics"), workspaceFolders),
    true,
    "Paths inside any workspace root should be recognized as workspace-contained targets."
  );
  assert.equal(
    isPathWithinAnyWorkspaceRoot(path.win32.normalize("C:/Users/micro/Documents"), workspaceFolders),
    false,
    "Paths outside all workspace roots should be recognized as external targets."
  );

  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  assert.equal(packageJson.name, "ai-provenance", "Unexpected extension package name.");
  assert.equal(packageJson.publisher, "tiinex", "Unexpected publisher.");
  assert.equal(packageJson.icon, "assets/logo-transparent.png", "Provenance extension icon path is missing or stale.");
  assert.ok(packageJson.activationEvents?.includes("onLanguageModelTool:list_traceable_agents"), "Provenance traceable agent catalog activation is missing.");
  assert.ok(packageJson.activationEvents?.includes("onLanguageModelTool:list_traceable_models"), "Provenance traceable model catalog activation is missing.");
  assert.ok(packageJson.activationEvents?.includes("onLanguageModelTool:view_traceable_subagent"), "Provenance LM tool activation is missing.");
  assert.ok(packageJson.activationEvents?.includes("onLanguageModelTool:run_traceable_subagent"), "Provenance runtime LM tool activation is missing.");
  assert.ok(packageJson.contributes?.languageModelTools?.some((entry) => entry.name === "list_traceable_agents"), "Provenance traceable agent catalog contribution is missing.");
  assert.ok(packageJson.contributes?.languageModelTools?.some((entry) => entry.name === "list_traceable_models"), "Provenance traceable model catalog contribution is missing.");
  assert.ok(packageJson.contributes?.languageModelTools?.some((entry) => entry.name === "run_traceable_subagent"), "Provenance runtime LM tool contribution is missing.");
  assert.ok(packageJson.contributes?.languageModelTools?.some((entry) => entry.name === "view_traceable_subagent"), "Provenance LM tool contribution is missing.");
  const runTraceableTool = packageJson.contributes?.languageModelTools?.find((entry) => entry.name === "run_traceable_subagent");
  assert.ok(runTraceableTool?.inputSchema?.properties?.parentTracePath, "run_traceable_subagent is missing the public parentTracePath continuation input schema property.");
  assert.ok(runTraceableTool?.inputSchema?.properties?.exportToFolder, "run_traceable_subagent is missing the public exportToFolder input schema property.");
  assert.ok(runTraceableTool?.inputSchema?.properties?.outputMode, "run_traceable_subagent is missing the public outputMode input schema property.");
  assert.ok(runTraceableTool?.inputSchema?.properties?.inputMode, "run_traceable_subagent is missing the public inputMode input schema property.");
  assert.ok(runTraceableTool?.inputSchema?.properties?.validationMode, "run_traceable_subagent is missing the public validationMode input schema property.");
  assert.ok(runTraceableTool?.inputSchema?.properties?.reveal, "run_traceable_subagent is missing the public reveal input schema property.");
  assert.ok(runTraceableTool?.inputSchema?.properties?.inputMode?.enum?.includes("DIRECT"), "run_traceable_subagent is missing the public DIRECT inputMode variant.");
  assert.ok(runTraceableTool?.inputSchema?.properties?.inputMode?.enum?.includes("RESUME"), "run_traceable_subagent is missing the public RESUME inputMode variant.");
  assert.deepEqual(runTraceableTool?.inputSchema?.required ?? [], [], "run_traceable_subagent should not hard-require userInput and parentTask for every inputMode.");
  assert.ok(packageJson.contributes?.languageModelTools?.find((entry) => entry.name === "run_traceable_subagent")?.modelDescription?.includes("Canonical usage:"), "run_traceable_subagent is missing canonical usage guidance in the public tool description.");
  assert.ok(packageJson.contributes?.languageModelTools?.find((entry) => entry.name === "run_traceable_subagent")?.modelDescription?.includes("artifact-backed continuation"), "run_traceable_subagent is missing truthful continuation guidance in the public tool description.");
  assert.ok(packageJson.contributes?.languageModelTools?.find((entry) => entry.name === "list_traceable_models")?.modelDescription?.includes("sendableOnly: true"), "list_traceable_models is missing exact preflight guidance in the public tool description.");
  assert.ok(packageJson.contributes?.languageModelTools?.find((entry) => entry.name === "view_traceable_subagent")?.modelDescription?.includes("Prefer this over rerunning the same child lane"), "view_traceable_subagent is missing inspect-before-rerun guidance in the public tool description.");
  assert.ok(packageJson.contributes?.configuration?.properties?.["tiinex.aiProvenance.evidenceMaxItems"], "Provenance namespaced settings are missing.");
  assert.ok(packageJson.contributes?.configuration?.properties?.["tiinex.aiProvenance.traceableAutoReveal"], "Provenance TRACEABLE auto-reveal setting is missing.");
  assert.ok(packageJson.contributes?.configuration?.properties?.["tiinex.aiProvenance.traceableAutoHide"], "Provenance TRACEABLE auto-hide setting is missing.");
  assert.ok(packageJson.contributes?.configuration?.properties?.["tiinex.aiProvenance.traceablePreferredModels"], "Provenance TRACEABLE preferred-models setting is missing.");
  assert.ok(packageJson.contributes?.configuration?.properties?.["tiinex.aiProvenance.traceableBlockedModels"], "Provenance TRACEABLE blocked-models setting is missing.");
  assert.ok(packageJson.contributes?.configuration?.properties?.["tiinex.aiProvenance.traceableUndeclaredMaxIterations"], "Provenance TRACEABLE undeclared max-iterations setting is missing.");
  assert.ok(packageJson.contributes?.configuration?.properties?.["tiinex.aiProvenance.traceableUndeclaredMaxToolCalls"], "Provenance TRACEABLE undeclared max-tool-calls setting is missing.");
  assert.ok(packageJson.contributes?.views?.tiinexAiProvenanceTraceablePanel?.some((entry) => entry.id === "tiinex.aiProvenance.traceableStatus"), "Provenance TRACEABLE panel view contribution is missing.");
  assert.ok(packageJson.contributes?.commands?.some((entry) => entry.command === "tiinex.aiProvenance.openOverview"), "Overview command is missing.");
  assert.ok(packageJson.contributes?.commands?.some((entry) => entry.command === "tiinex.aiProvenance.inspectTraceableEvidence"), "TRACEABLE evidence inspect command is missing.");
  assert.ok(packageJson.contributes?.commands?.some((entry) => entry.command === "tiinex.aiProvenance.stopTraceableSubagent"), "TRACEABLE stop command is missing.");
  assert.ok(packageJson.contributes?.commands?.some((entry) => entry.command === "tiinex.aiProvenance.openTraceableEvidenceEditor"), "TRACEABLE evidence editor command is missing.");
  assert.ok(packageJson.contributes?.commands?.some((entry) => entry.command === "tiinex.aiProvenance.reopenTraceableEvidenceSource"), "TRACEABLE evidence reopen-source command is missing.");
  assert.ok(packageJson.contributes?.commands?.some((entry) => entry.command === "tiinex.aiProvenance.reopenTraceableEvidencePreview"), "TRACEABLE evidence reopen-preview command is missing.");
  assert.ok(!("mcp" in (packageJson.scripts ?? {})), "This scaffold should not expose an MCP script.");
  assert.ok(!Object.keys(packageJson.devDependencies ?? {}).includes("@modelcontextprotocol/sdk"), "This scaffold should not pull in MCP dependencies.");
  const bundle = await readFile(path.join(packageRoot, "dist", "extension.js"), "utf8");
  assert.ok(bundle.includes("inspectTraceableEvidence"), "Built bundle is missing the TRACEABLE evidence inspect command.");
  assert.ok(bundle.includes("openTraceableEvidenceEditor"), "Built bundle is missing the TRACEABLE evidence viewer command.");
  assert.ok(bundle.includes("reopenTraceableEvidenceSource"), "Built bundle is missing the TRACEABLE evidence reopen-source command.");
  assert.ok(bundle.includes("reopenTraceableEvidencePreview"), "Built bundle is missing the TRACEABLE evidence reopen-preview command.");
  assert.ok(bundle.includes("run_traceable_subagent"), "Built bundle is missing the provenance TRACEABLE runtime tool wiring.");
  assert.ok(bundle.includes("list_traceable_agents"), "Built bundle is missing the provenance traceable agent catalog tool wiring.");
  assert.ok(bundle.includes("list_traceable_models"), "Built bundle is missing the provenance traceable model catalog tool wiring.");
  assert.ok(bundle.includes("Preferred matches"), "Built bundle is missing the traceable model policy summary rendering.");
  assert.ok(bundle.includes("Policy:"), "Built bundle is missing per-model policy flag rendering.");
  assert.ok(bundle.includes("Recommended flow:"), "Built bundle is missing embedded workflow guidance for traceable catalog tools.");
  assert.ok(bundle.includes("Typical next step:"), "Built bundle is missing the canonical next-step guidance for the traceable model catalog.");
  assert.ok(bundle.includes("openTraceableSubagentStatusDetail"), "Built bundle is missing the provenance TRACEABLE panel reveal command.");
  assert.ok(bundle.includes("stopTraceableSubagent"), "Built bundle is missing the provenance TRACEABLE stop command.");
  assert.ok(bundle.includes("tiinex.aiProvenance.traceableStatus"), "Built bundle is missing the provenance TRACEABLE panel view id.");
  assert.ok(bundle.includes("Tool Ledger"), "Built bundle is missing the TRACEABLE evidence surface picker labels.");
  assert.ok(bundle.includes("Rendered Output"), "Built bundle is missing the moved traceable rendered-output label.");
  assert.ok(bundle.includes("hideToolbarControls"), "Built bundle is missing the restored TRACEABLE evidence panel renderer wiring.");
  assert.ok(bundle.includes("tiinexTraceableEvidenceEditor"), "Built bundle is missing the restored TRACEABLE evidence editor view type.");
  assert.ok(bundle.includes("view_traceable_subagent"), "Built bundle is missing the provenance LM tool wiring.");
  assert.ok(bundle.includes("## Lineage"), "Built bundle is missing the evidence lineage observability section.");
  assert.ok(bundle.includes("### Direct Children"), "Built bundle is missing direct-child lineage rendering in evidence views.");
  assert.ok(bundle.includes("Carry State"), "Built bundle is missing the separate carry-state request summary label.");
  const source = await readFile(path.join(packageRoot, "src", "traceableEvidence.ts"), "utf8");
  assert.ok(source.includes("TRACEABLE_EVIDENCE_STATE_SCHEMA"), "Traceable evidence parser source is missing the schema constant.");
  assert.ok(source.includes("renderTraceableEvidenceToolLedgerMarkdown"), "Traceable evidence source is missing the bounded tool-ledger renderer.");
  assert.ok(source.includes("renderViewTraceableSubagentMarkdown"), "Traceable evidence source is missing the moved traceable view renderer.");
  assert.ok(source.includes("buildTraceableEvidenceLineageLines"), "Traceable evidence source is missing the derived lineage observability helper.");
  assert.ok(source.includes("Direct Children"), "Traceable evidence source is missing direct-child lineage labels.");
  assert.ok(source.includes("function extractTraceableEvidenceStateJson"), "Traceable evidence parser should extract the Traceable State JSON block with a dedicated helper.");
  assert.ok(source.includes("const closingMatch = /^```[ \\t]*$/um.exec(remainder);"), "Traceable evidence parser should close the Traceable State block only on a standalone fence line.");
  const panelSource = await readFile(path.join(packageRoot, "src", "traceableSubagentStatusPanel.ts"), "utf8");
  assert.ok(panelSource.includes("export function renderTraceableSubagentPanelHtml"), "Traceable panel source is missing the restored committed viewer renderer.");
  assert.ok(panelSource.includes("hideToolbarControls"), "Traceable panel source is missing the restored viewer toolbar-control behavior.");
  assert.ok(panelSource.includes("tiinex.aiProvenance.traceableStatus"), "Traceable panel source is missing the provenance panel view id.");
  assert.ok(panelSource.includes("type PanelOpenFilePayload ="), "Traceable panel source is missing the clearer open-file payload union.");
  assert.ok(panelSource.includes("ancestorGroupOpenById"), "Traceable panel source is missing persisted Earlier Trace disclosure state.");
  assert.ok(panelSource.includes("renderAncestorSummaryActionIcon"), "Traceable panel source is missing latest-step icon rendering for Earlier Trace summaries.");
  assert.ok(panelSource.includes("renderAncestorStatusChip"), "Traceable panel source is missing trace-status-aligned Earlier Trace badges.");
  assert.ok(panelSource.includes("buildActivityEntries(lineageSnapshot).filter((activity) => activity.kind !== \"ancestor\")"), "Traceable panel source is missing full activity-pipeline rendering for Earlier Trace expansions.");
  assert.ok(panelSource.includes("extractOutputEvidencePaths"), "Traceable panel source is missing structured output evidence extraction for expanded Output rows.");
  assert.ok(panelSource.includes("activity-request-badge-inherited"), "Traceable panel source is missing inherited-parameter badge styling for continuation summaries.");
  assert.ok(panelSource.includes("nextSuggestedStart"), "Traceable panel source is missing structured handoff detail rendering for expanded Handoff rows.");
  assert.ok(panelSource.includes('"loadToolDetail"'), "Traceable panel source is missing the on-demand tool-detail fetch message wiring.");
  assert.ok(panelSource.includes("loadedToolDetailsByCallId"), "Traceable panel source is missing cached loaded tool-detail state for expanded tool rows.");
  assert.ok(panelSource.includes("renderToolRawDisclosure"), "Traceable panel source is missing secondary raw input/output disclosures for tool rows.");
  assert.ok(panelSource.includes("isNestedInteractiveTarget"), "Traceable panel source is missing the nested-interaction guard that keeps raw disclosures from collapsing whole activities.");
  assert.ok(panelSource.includes("No persisted tool output is available for this call in the current trace view."), "Traceable panel source is missing a visible fallback when evidence views do not contain persisted tool output.");
  assert.ok(panelSource.includes("event-tool-main-toggle"), "Traceable panel source is missing an explicit main toggle control for tool rows.");
  assert.ok(panelSource.includes("data-tool-output-disclosure=\"true\""), "Traceable panel source is missing dedicated output disclosures for tool rows.");
  assert.ok(panelSource.includes("data-tool-input-disclosure=\"true\""), "Traceable panel source is missing dedicated input disclosures for tool rows.");
  assert.ok(panelSource.includes("requestToolOutputLoad"), "Traceable panel source is missing auto-load behavior when tool output disclosures open.");
  assert.ok(panelSource.includes("renderJsonHighlightedMarkup"), "Traceable panel source is missing syntax-highlighted JSON rendering for tool data.");
  assert.ok(panelSource.includes("Loading output..."), "Traceable panel source is missing a visible loading state while tool output is being fetched.");
  assert.ok(panelSource.includes("event-tool-section-copy"), "Traceable panel source is missing copy controls for tool input/output disclosures.");
  assert.ok(panelSource.includes("renderRequestDetailSection(\"Kind\", detail.outputKind.trim())"), "Traceable panel source is missing output-kind rendering for typed persisted tool output.");
  assert.ok(panelSource.includes("renderRequestDetailSection(\"Data\", detail.outputMetadataSummary.trim())"), "Traceable panel source is missing metadata rendering for data-like tool outputs.");
  assert.ok(panelSource.includes("data-copy-source-id"), "Traceable panel source is missing source-targeted copy wiring for large tool values.");
  assert.ok(panelSource.includes("navigator.clipboard?.writeText"), "Traceable panel source is missing direct clipboard support for copied tool values.");
  assert.ok(panelSource.includes("disclosure.dataset.toolOutputNeedsLoad !== 'true'"), "Traceable panel source should not reopen output disclosures that would auto-load on initial render or reopen.");
  assert.ok(panelSource.includes("disclosure.dataset.toolOutputArmed !== 'true'"), "Traceable panel source should require explicit user interaction before output loading starts.");
  assert.ok(panelSource.includes("event-tool-loading-fallback"), "Traceable panel source is missing a fallback message when tool output loading stalls.");
  assert.ok(panelSource.includes("max-height: calc(20 * 1.45em + 18px)"), "Traceable panel source should cap large input/output blocks to about 20 lines before scrolling.");
  assert.ok(panelSource.includes("white-space: pre;"), "Traceable panel source should preserve raw input/output formatting and rely on scroll instead of wrapping-truncation behavior.");
  assert.ok(panelSource.includes("<span class=\"event-tool-section-summary-label\">${escapeHtml(label)}</span><span class=\"event-expand-indicator\""), "Traceable panel source should keep the disclosure twistie adjacent to the section label.");
  assert.ok(panelSource.includes("No persisted tool output is available for this call in the current trace view."), "Traceable panel source is missing the truthful persisted-output fallback for trace views.");
  assert.ok(panelSource.includes("event-tool.tool-expanded .event-meta-chips"), "Traceable panel source should hide tool and parameter chips when an expanded tool row already shows those details.");
  assert.ok(panelSource.includes("includeDurationChip: event.count > 1"), "Traceable panel source should avoid duplicate duration badges for single tool calls.");
  assert.ok(panelSource.indexOf('"Input"') < panelSource.indexOf('renderToolOutputDetail(event, detail)'), "Traceable panel source should render tool input before tool output in expanded tool details.");
  assert.ok(panelSource.includes("data-ancestor-group-id"), "Traceable panel source is missing ancestor-group identity for persisted disclosure state.");
  assert.ok(panelSource.includes("describePathChipAction"), "Traceable panel source is missing descriptive path-chip action copy.");
  assert.ok(panelSource.includes("Open or reveal from workspace context"), "Traceable panel source is missing workspace-context path-chip guidance.");
  assert.ok(panelSource.includes("Reveal in Windows File Explorer"), "Traceable panel source is missing external Windows explorer path-chip guidance.");
  const extensionSource = await readFile(path.join(packageRoot, "src", "extension.ts"), "utf8");
  const runtimeSource = await readFile(path.join(packageRoot, "src", "traceableSubagent.ts"), "utf8");
  assert.ok(runtimeSource.includes("tiinex.aiProvenance"), "Traceable runtime source is missing the provenance configuration namespace.");
  assert.ok(runtimeSource.includes("export async function runTraceableSubagent"), "Traceable runtime source is missing the moved runtime entrypoint.");
  assert.ok(runtimeSource.includes("export async function listTraceableAgentCatalogEntries"), "Traceable runtime source is missing the moved traceable agent catalog entries export.");
  assert.ok(runtimeSource.includes("export async function listTraceableModelCatalogEntries"), "Traceable runtime source is missing the moved traceable model catalog entries export.");
  assert.ok(runtimeSource.includes("copilot/gpt-4.1"), "Traceable runtime source is missing the supported copilot/gpt-4.1 declaration for preferred-model configuration.");
  assert.ok(runtimeSource.includes("\"gpt-5.5\", { vendor: \"copilot\", id: \"gpt-5.5\" }"), "Traceable runtime source is missing bare human-label support for role models such as GPT-5.5.");
  assert.ok(runtimeSource.includes("\"claude-sonnet-4.5\", { vendor: \"copilot\", id: \"claude-sonnet-4.5\" }"), "Traceable runtime source is missing bare human-label support for role models such as Claude Sonnet 4.5.");
  assert.ok(runtimeSource.includes("\"raptor-mini-preview\", { vendor: \"copilot\", id: \"oswe-vscode-prime\" }"), "Traceable runtime source is missing bare human-label support for role models such as Raptor mini (Preview).");
  assert.ok(runtimeSource.includes("copilotgpt-4.1"), "Traceable runtime source is missing the normalized exact lookup form for copilot/gpt-4.1 settings.");
  assert.ok(runtimeSource.includes("copilot/gpt-5.5"), "Traceable runtime source is missing the supported copilot/gpt-5.5 declaration for blocked-model configuration.");
  assert.ok(runtimeSource.includes("copilotgpt-5.5"), "Traceable runtime source is missing the normalized exact lookup form for copilot/gpt-5.5 settings.");
  assert.ok(runtimeSource.includes("copilot/oswe-vscode-prime"), "Traceable runtime source is missing the supported copilot/oswe-vscode-prime declaration for low-cost preferred-model configuration.");
  assert.ok(runtimeSource.includes("copilotoswe-vscode-prime"), "Traceable runtime source is missing the normalized exact lookup form for copilot/oswe-vscode-prime settings.");
  assert.ok(runtimeSource.includes("Explicit modelSelector.id is blocked by tiinex.aiProvenance.traceableBlockedModels"), "Traceable runtime source is missing explicit blocked-model rejection.");
  assert.ok(runtimeSource.includes("Math.random() * (index + 1)"), "Traceable runtime source is missing selector shuffling for preferred and role model pools.");
  assert.ok(runtimeSource.includes("value === true"), "Traceable runtime source is missing boolean completion-claim normalization for child JSON payloads.");
  assert.ok(runtimeSource.includes("stopReason === \"budget_exhausted\" || stopReason === \"insufficient_grounding\""), "Traceable runtime source is missing completion-claim reconciliation for budget or grounding stops.");
  assert.ok(runtimeSource.includes("function reconcileCompletionClaimWithSteps"), "Traceable runtime source is missing step-aware completion-claim reconciliation.");
  assert.ok(runtimeSource.includes("done|complete|completed|success|successful|succeeded|verified|grounded|finished"), "Traceable runtime source is missing common child step-status normalization for completed work.");
  assert.ok(runtimeSource.includes('completed, ${attemptedStepCount} attempted'), "Traceable runtime source is missing clearer attempted-step reporting when no steps were completed.");
  assert.ok(runtimeSource.includes("user_cancelled"), "Traceable runtime source is missing the user_cancelled stop-reason handling for cancellation-aware runs.");
  assert.ok(runtimeSource.includes("options.token?.isCancellationRequested"), "Traceable runtime source is missing explicit cancellation checks for the active run token.");
  assert.ok(runtimeSource.includes("stoppedBy: extra.stoppedBy"), "Traceable runtime source is missing fallback stoppedBy preservation for cancellation-aware runs.");
  assert.ok(runtimeSource.includes("stopSource: extra.stopSource"), "Traceable runtime source is missing fallback stopSource preservation for cancellation-aware runs.");
  assert.ok(runtimeSource.includes("stopRequestedAt: extra.stopRequestedAt"), "Traceable runtime source is missing fallback stopRequestedAt preservation for cancellation-aware runs.");
  assert.ok(runtimeSource.includes("activeCarryForward?: TraceableCarryForwardState"), "Traceable runtime source is missing the separate active carry-forward contract.");
  assert.ok(runtimeSource.includes("Active carry-forward state for this run"), "Traceable runtime source is missing prompt grounding for active carry-forward state.");
  assert.ok(runtimeSource.includes("activeCarryForward: parsedPayload.activeCarryForward"), "Traceable runtime source is missing child-payload carry-forward mapping into the final run result.");
  assert.ok(runtimeSource.includes("recoverableCarryState: parsedPayload.recoverableCarryState"), "Traceable runtime source is missing child-payload recoverable carry-state mapping into the final run result.");
  assert.ok(runtimeSource.includes("carryStateDisposition: parsedPayload.carryStateDisposition"), "Traceable runtime source is missing child-payload carry disposition mapping into the final run result.");
  assert.ok(runtimeSource.includes("export async function prepareTraceableSubagentInput"), "Traceable runtime source is missing the public continuation-input preparation helper.");
  assert.ok(runtimeSource.includes('"DIRECT" | "RESUME"'), "Traceable runtime source is missing the DIRECT/RESUME inputMode contract.");
  assert.ok(runtimeSource.includes("TRACEABLE DIRECT mode requires a non-empty userInput."), "Traceable runtime source is missing DIRECT-mode userInput enforcement.");
  assert.ok(runtimeSource.includes("TRACEABLE RESUME mode requires parentTracePath."), "Traceable runtime source is missing RESUME-mode parentTracePath enforcement.");
  assert.ok(runtimeSource.includes("TRACEABLE RESUME mode does not allow userInput, parentTask, or parentFrame."), "Traceable runtime source is missing strict RESUME prompt rejection.");
  assert.ok(runtimeSource.includes("traceableUndeclaredMaxIterations"), "Traceable runtime source is missing the undeclared max-iterations runtime setting.");
  assert.ok(runtimeSource.includes("traceableUndeclaredMaxToolCalls"), "Traceable runtime source is missing the undeclared max-tool-calls runtime setting.");
  assert.ok(runtimeSource.includes("if (explicitBudgetPolicy)"), "Traceable runtime source should only expose budgetPolicy in the request envelope when it was explicitly declared.");
  assert.ok(runtimeSource.includes("parseTraceableEvidenceStateMarkdown"), "Traceable runtime source is missing readable parent evidence parsing for continuation.");
  assert.ok(runtimeSource.includes("continuedFromParent: true"), "Traceable runtime source is missing continuation metadata for child runs.");
  assert.ok(runtimeSource.includes("lineageLabel"), "Traceable runtime source is missing lineage metadata handling for continuation runs.");
  assert.ok(runtimeSource.includes("function canonicalizeExplicitTraceableModelSelector"), "Traceable runtime source is missing explicit model-selector canonicalization through the supported declaration map.");
  assert.ok(runtimeSource.includes("function isAutomaticTraceableModelSelector"), "Traceable runtime source should recognize modelSelector.id=auto as a non-concrete selector.");
  assert.ok(runtimeSource.includes("if (isAutomaticTraceableModelSelector(normalizedSelector))"), "Traceable runtime source should not route modelSelector.id=auto through the explicit exact-model selector path.");
  assert.ok(runtimeSource.includes("const canUseImplicitAutoSelection = !resolvedAgentArtifact"), "Traceable runtime source should allow implicit auto selection only when no agent-role model source is present.");
  assert.ok(runtimeSource.includes("!input.parentTracePath?.trim()"), "Traceable runtime source should keep implicit auto selection disabled when a parent trace source exists.");
  assert.ok(runtimeSource.includes("allowedSendableModels[Math.floor(Math.random() * allowedSendableModels.length)]"), "Traceable runtime source should select from the unblocked broad runtime model pool for implicit auto selection.");
  assert.ok(runtimeSource.includes("inferModelSelectorFromDeclaration(selector.id)"), "Traceable runtime source is missing explicit selector fallback canonicalization by bare model id.");
  assert.ok(runtimeSource.includes("recordToolDetail?(detail: TraceableSubagentToolDetail)"), "Traceable runtime source is missing the separate on-demand tool-detail reporter contract.");
  assert.ok(runtimeSource.includes("summarizeToolResultContent(toolResult.content)"), "Traceable runtime source is missing bounded successful tool-output capture for on-demand panel loading.");
  assert.ok(runtimeSource.includes("const MAX_TOOL_DETAIL_TEXT_CHARS = 120000"), "Traceable runtime source should keep substantially larger tool-detail captures for debugging than the compact output preview cap.");
  assert.ok(runtimeSource.includes("modelDisplayName?: string;"), "Traceable runtime source is missing a separate selected-model display field on run results.");
  assert.ok(runtimeSource.includes("modelDisplayName: selectedModelDisplayName"), "Traceable runtime source should persist the actually selected runtime model display name in final run results.");
  assert.ok(runtimeSource.includes("function buildPersistedToolOutput"), "Traceable runtime source is missing bounded persisted tool-output construction for evidence export.");
  assert.ok(runtimeSource.includes("output: buildPersistedToolOutput(toolOutput)"), "Traceable runtime source should persist bounded successful tool output in the tool ledger.");
  assert.ok(runtimeSource.includes("function isBinaryLikeToolDataCandidate"), "Traceable runtime source is missing binary-like data detection for safer persisted tool output.");
  assert.ok(runtimeSource.includes("outputMetadataSummary"), "Traceable runtime source is missing metadata summaries for data-like tool outputs.");
  assert.ok(extensionSource.includes("traceableEvidenceLoadedToolDetails"), "Extension source is missing cached on-demand tool-detail state for evidence panels.");
  assert.ok(extensionSource.includes("readParsedTraceableEvidenceFromFileWithRetry"), "Extension source is missing bounded retry handling for freshly written TRACEABLE evidence files.");
  assert.ok(extensionSource.includes("const { markdown, parsed } = await readParsedTraceableEvidenceFromFileWithRetry(resolvedEvidenceFilePath);"), "Extension source should use bounded retry when the public view_traceable_subagent tool reads freshly written evidence files.");
  assert.ok(extensionSource.includes(": (await readParsedTraceableEvidenceFromFileWithRetry(resolvedUri.fsPath)).parsed;"), "Extension source should use bounded retry when the TRACEABLE custom editor rehydrates the latest evidence file state.");
  assert.ok(extensionSource.includes("const parentRead = await readParsedTraceableEvidenceFromFileWithRetry(normalizedParentPath)"), "Extension source should use bounded retry when TRACEABLE lineage rehydrates parent evidence files.");
  assert.ok(!extensionSource.includes("modelLabel: effectiveInput.modelSelector?.id"), "Extension source should not seed the TRACEABLE header model label from the requested selector before a runtime model is actually chosen.");
  assert.ok(extensionSource.includes("buildUnavailableToolDetail"), "Extension source is missing evidence-panel fallback rendering for unavailable tool output.");
  assert.ok(extensionSource.includes("tryBuildRehydratedReadToolDetail"), "Extension source is missing on-demand rehydration for readFile outputs in evidence views.");
  assert.ok(extensionSource.includes("buildPersistedToolDetailMap"), "Extension source is missing persisted tool-detail preloading for evidence views.");
  assert.ok(extensionSource.includes("buildPersistedToolDetail(initialSnapshot, parsedState.result, callId)"), "Extension source should consult persisted tool output before falling back to live or reconstructed evidence details.");
  assert.ok(extensionSource.includes("outputKind: matchingCall.output.kind"), "Extension source should propagate persisted output kind into panel-loaded tool details.");
  assert.ok(extensionSource.includes("copilot_readFile") && extensionSource.includes("read_file"), "Extension source should recognize both native readFile tool names when rehydrating evidence output.");
  assert.ok(extensionSource.includes("Could not rehydrate read output from the current workspace file."), "Extension source is missing a truthful fallback when readFile output cannot be rehydrated from the workspace.");
  assert.ok(extensionSource.includes("This evidence file does not contain persisted tool output for this call."), "Extension source should state plainly when trace files lack persisted tool output.");
  assert.ok(runtimeSource.includes("function normalizeFinalSummaryValue"), "Traceable runtime source is missing tolerant finalSummary normalization for child JSON payloads.");
  assert.ok(runtimeSource.includes("no further reads needed"), "Traceable runtime source is missing natural-language completed stop-reason normalization for child JSON payloads.");
  assert.ok(runtimeSource.includes("sufficient per contract"), "Traceable runtime source is missing completed stop-reason normalization for minimal-read contract phrasing.");
  assert.ok(runtimeSource.includes("\\bcomplete(?:d)?\\b"), "Traceable runtime source is missing the broader completed stop-reason normalization that accepts natural-language child summaries.");
  const evidenceExportSource = await readFile(path.join(packageRoot, "src", "traceableSubagentEvidence.ts"), "utf8");
  assert.ok(evidenceExportSource.includes("renameEvidenceFileForSnapshot"), "Traceable evidence export source is missing evidence-file rename support when the final role or model label becomes known after export begins.");
  assert.ok(evidenceExportSource.includes("formatSelectedRuntimeModelLabel(result)"), "Traceable evidence export source should align renamed evidence files with the selected runtime model when available.");
  assert.ok(evidenceExportSource.includes("cleanupStaleEvidenceFile"), "Traceable evidence export source should clean up stale pre-rename evidence files after final export succeeds.");
  assert.ok(evidenceExportSource.includes("const displayName = result?.modelDisplayName?.trim();"), "Traceable evidence export source should prefer the selected runtime model display name over synthesized selector ids.");
  assert.ok(evidenceExportSource.includes("function extractTraceableEvidenceStateJson"), "Traceable evidence export parser should extract the Traceable State JSON block with a dedicated helper.");
  assert.ok(evidenceExportSource.includes("const closingMatch = /^```[ \\t]*$/um.exec(remainder);"), "Traceable evidence export parser should close the Traceable State block only on a standalone fence line.");
  assert.ok(evidenceExportSource.includes("function formatSelectedRuntimeModelLabel"), "Traceable evidence export source is missing a helper that prefers the selected runtime model in evidence labels.");
  assert.ok(evidenceExportSource.includes("modelLabel: effectiveModelLabel"), "Traceable evidence state should overwrite the snapshot model label with the effective runtime model label when available.");
  assert.ok(evidenceExportSource.includes("`- Model: ${effectiveModelLabel}`"), "Traceable evidence markdown should show the effective selected runtime model rather than a stale selector label.");
  assert.ok(evidenceExportSource.includes("stoppedBy: result.stoppedBy"), "Traceable evidence export source is missing stoppedBy persistence for cancellation-aware runs.");
  assert.ok(evidenceExportSource.includes("stopSource: result.stopSource"), "Traceable evidence export source is missing stopSource persistence for cancellation-aware runs.");
  assert.ok(evidenceExportSource.includes("stopRequestedAt: result.stopRequestedAt"), "Traceable evidence export source is missing stopRequestedAt persistence for cancellation-aware runs.");
  assert.ok(evidenceExportSource.includes("activeCarryForward: result.activeCarryForward"), "Traceable evidence export source is missing active carry-forward persistence.");
  assert.ok(evidenceExportSource.includes("recoverableCarryState: result.recoverableCarryState"), "Traceable evidence export source is missing recoverable carry-state persistence.");
  assert.ok(evidenceExportSource.includes("continuedFromParent: result.continuedFromParent"), "Traceable evidence export source is missing continuation metadata persistence for child runs.");
  assert.ok(evidenceExportSource.includes("allocateContinuationEvidenceFilePath"), "Traceable evidence export source is missing continuation-aware evidence file allocation.");
  assert.ok(evidenceExportSource.includes("evidenceFile: { ...exportState }"), "Traceable evidence export source is missing finalized export-state persistence in the embedded Traceable State block.");
  const contractSource = await readFile(path.join(packageRoot, "src", "traceableContract.ts"), "utf8");
  assert.ok(contractSource.includes("output?: {") && contractSource.includes("kind?: \"text\" | \"structured\" | \"data\" | \"mixed\";") && contractSource.includes("rawTextTruncated?: boolean;"), "Traceable contract source is missing the typed persisted tool-output contract on tool-call records.");
  assert.ok(contractSource.includes("export interface TraceableSubagentRunResult"), "Traceable contract source is missing the run result contract.");
  assert.ok(contractSource.includes("normalizeTraceableOutputMode"), "Traceable contract source is missing output-mode normalization.");
  assert.ok(contractSource.includes("buildTraceableSubagentRequestEnvelope"), "Traceable contract source is missing request-envelope construction.");
  assert.ok(contractSource.includes("resolveTraceableParentFrame"), "Traceable contract source is missing parent-frame resolution.");
  assert.ok(contractSource.includes("extractTraceableSubagentPayload"), "Traceable contract source is missing payload extraction.");
  assert.ok(contractSource.includes("normalizeParsedPayload"), "Traceable contract source is missing payload normalization.");
  assert.ok(contractSource.includes("export function reconcileCompletionClaimWithSteps"), "Traceable contract source is missing step-aware completion-claim reconciliation.");
  assert.ok(contractSource.includes("done|complete|completed|success|successful|succeeded|verified|grounded|finished"), "Traceable contract source is missing common child step-status normalization for completed work.");
  assert.ok(contractSource.includes("function normalizeFinalSummaryValue"), "Traceable contract source is missing tolerant finalSummary normalization.");
  assert.ok(contractSource.includes("resolveTraceStatus"), "Traceable contract source is missing trace-status resolution.");
  assert.ok(contractSource.includes("user_cancelled"), "Traceable contract source is missing the user_cancelled stop-reason contract.");
  assert.ok(contractSource.includes("parentTracePath?: string"), "Traceable contract source is missing parentTracePath on the public continuation surface.");
  assert.ok(contractSource.includes("continuedFromParent?: boolean"), "Traceable contract source is missing continuedFromParent metadata on the run result.");
  assert.ok(contractSource.includes("lineageDepth?: number"), "Traceable contract source is missing lineageDepth metadata on the run result.");
  assert.ok(contractSource.includes("lineageLabel?: string"), "Traceable contract source is missing lineageLabel metadata on the run result.");
  assert.ok(contractSource.includes("buildUnparseableChildPayloadFallback"), "Traceable contract source is missing unparseable-payload fallback construction.");
  assert.ok(contractSource.includes("collectTraceableInputValidationIssues"), "Traceable contract source is missing input validation helpers.");
  assert.ok(contractSource.includes('"DIRECT" | "RESUME"'), "Traceable contract source is missing the DIRECT/RESUME inputMode contract.");
  assert.ok(contractSource.includes("traceableUndeclaredMaxIterations"), "Traceable contract source is missing the undeclared max-iterations runtime setting.");
  assert.ok(contractSource.includes("traceableUndeclaredMaxToolCalls"), "Traceable contract source is missing the undeclared max-tool-calls runtime setting.");
  assert.ok(contractSource.includes("renderTraceableSubagentEvidencePathOnly"), "Traceable contract source is missing evidence-path-only markdown rendering.");
  assert.ok(contractSource.includes("formatTraceablePathReference"), "Traceable contract source is missing path-reference rendering.");
  assert.ok(contractSource.includes("renderTraceableSubagentMarkdown"), "Traceable contract source is missing full markdown rendering.");
  assert.ok(contractSource.includes("appendBoundedJsonPreview"), "Traceable contract source is missing bounded JSON previews.");
  assert.ok(contractSource.includes("stoppedBy?: \"user\" | \"host\""), "Traceable contract source is missing stoppedBy metadata on the run result.");
  assert.ok(contractSource.includes("stopSource?: \"traceable-panel\" | \"host-cancel\" | \"unknown\""), "Traceable contract source is missing stopSource metadata on the run result.");
  assert.ok(contractSource.includes("stopRequestedAt?: string"), "Traceable contract source is missing stopRequestedAt metadata on the run result.");
  assert.ok(contractSource.includes("export interface TraceableCarryForwardState"), "Traceable contract source is missing the carry-forward state contract.");
  assert.ok(contractSource.includes("activeCarryForward?: TraceableCarryForwardState"), "Traceable contract source is missing the active carry-forward field.");
  assert.ok(contractSource.includes("carryStateDisposition?: TraceableCarryStateDisposition"), "Traceable contract source is missing carry-state disposition metadata.");
  assert.ok(extensionSource.includes("async invoke(options: vscode.LanguageModelToolInvocationOptions<TInput>, token: vscode.CancellationToken)"), "Traceable extension source is missing cancellation-aware LM tool invoke wiring.");
  assert.ok(extensionSource.includes("this.invokeImpl(options.input, budget, preparedState, token)"), "Traceable extension source is missing token threading into queued tool invocations.");
  assert.ok(extensionSource.includes("prepareTraceableSubagentInput(input)"), "Traceable extension source is missing pre-run continuation preparation before export and execution.");
  assert.ok(extensionSource.includes("buildInheritedRequestSummaryItem"), "Traceable extension source is missing inherited-request summary synthesis for continuation runs.");
  assert.ok(extensionSource.includes("label: \"Inherited\""), "Traceable extension source is missing inherited request-summary items for continuation runs.");
  assert.ok(extensionSource.includes("buildTraceableRequestSummary(effectiveInput, input)"), "Traceable extension source is missing request-summary rendering for effective input plus original override provenance.");
  assert.ok(extensionSource.includes("Declared input mode: DIRECT"), "Traceable extension source is missing DIRECT mode summary rendering.");
  assert.ok(extensionSource.includes("Declared input mode: RESUME"), "Traceable extension source is missing RESUME mode summary rendering.");
  assert.ok(extensionSource.includes("label: \"Carry State\""), "Traceable extension source is missing the separate carry-state request summary item.");
  assert.ok(extensionSource.includes("resolveRelativeOpenPathInWorkspace"), "Traceable extension source is missing the multi-root relative open-path resolver.");
  assert.ok(extensionSource.includes("resolveDriveLessAbsolutePathOnWindows"), "Traceable extension source is missing Windows drive-less absolute path recovery.");
  assert.ok(extensionSource.includes("revealFileInOS"), "Traceable extension source is missing OS-level reveal handling for targets outside workspace roots.");
  assert.ok(extensionSource.includes("isPathWithinAnyWorkspaceRoot"), "Traceable extension source is missing the workspace-root boundary check for open targets.");
  assert.ok(contractSource.includes("extractObservedReadTargets"), "Traceable contract source is missing observed-read target summaries.");
  console.log("ai-provenance vscode scaffold checks passed");
}

await main();