import path from "node:path";
import { promises as fs } from "node:fs";
import * as vscode from "vscode";
import {
  parseTraceableEvidenceStateMarkdown,
  renderViewTraceableSubagentMarkdown,
  renderTraceableEvidenceSurfaceMarkdown,
  type TraceableEvidenceSurface,
  type ViewTraceableSubagentInput
} from "./traceableEvidence";
import {
  listTraceableAgentCatalogEntries,
  listTraceableAgentCatalogLintFindings,
  listTraceableModelCatalogEntries,
  runTraceableSubagent,
  renderTraceableSubagentMarkdown,
  type TraceableSubagentInput,
  type TraceableSubagentRequestSummaryItem,
  type TraceableSubagentRunResult
} from "./traceableSubagent";
import { TraceableSubagentEvidenceController } from "./traceableSubagentEvidence";
import { QueuedMutex } from "./mutex";
import { TraceableSubagentStatusBarController } from "./traceableSubagentStatusBar";
import { TraceableSubagentStatusDetailController, type TraceableSubagentDetailSnapshot } from "./traceableSubagentStatusDetail";
import {
  TRACEABLE_SUBAGENT_PANEL_CONTAINER_ID,
  TRACEABLE_SUBAGENT_PANEL_VIEW_ID,
  TraceableSubagentStatusPanelProvider,
  renderTraceableSubagentPanelHtml
} from "./traceableSubagentStatusPanel";

const OPEN_OVERVIEW_COMMAND = "tiinex.aiProvenance.openOverview";
const INSPECT_TRACEABLE_EVIDENCE_COMMAND = "tiinex.aiProvenance.inspectTraceableEvidence";
const OPEN_TRACEABLE_SUBAGENT_STATUS_DETAIL_COMMAND = "tiinex.aiProvenance.openTraceableSubagentStatusDetail";
const OPEN_TRACEABLE_EVIDENCE_EDITOR_COMMAND = "tiinex.aiProvenance.openTraceableEvidenceEditor";
const REOPEN_TRACEABLE_EVIDENCE_SOURCE_COMMAND = "tiinex.aiProvenance.reopenTraceableEvidenceSource";
const REOPEN_TRACEABLE_EVIDENCE_PREVIEW_COMMAND = "tiinex.aiProvenance.reopenTraceableEvidencePreview";
const RUN_TRACEABLE_SUBAGENT_TOOL = "run_traceable_subagent";
const VIEW_TRACEABLE_SUBAGENT_TOOL = "view_traceable_subagent";
const TRACEABLE_EVIDENCE_EDITOR_VIEW_TYPE = "tiinexTraceableEvidenceEditor";
const TRACEABLE_EVIDENCE_REFRESH_DEBOUNCE_MS = 250;
const TRACEABLE_PANEL_VISIBLE_CONTEXT = "tiinex.aiProvenance.traceablePanelVisible";
const TRACEABLE_PANEL_FALLBACK_COMMAND = "workbench.action.terminal.focus";

type TraceableAutoRevealMode = "yes" | "no" | "always";
type TraceableAutoHideMode = "yes" | "no";

interface ListTraceableAgentsInput {
  query?: string;
  limit?: number;
}

interface ListTraceableModelsInput {
  query?: string;
  limit?: number;
  sendableOnly?: boolean;
}

const traceableSubagentToolMutex = new QueuedMutex();

const TRACEABLE_SURFACE_OPTIONS: Array<{ label: string; description: string; surface: TraceableEvidenceSurface }> = [
  { label: "Rendered Output", description: "Render the reconstructed TRACEABLE output surface", surface: "rendered-output" },
  { label: "Request Summary", description: "Bounded request-summary items captured in the evidence snapshot", surface: "request-summary" },
  { label: "Summary", description: "Compact overview of the evidence artifact", surface: "summary" },
  { label: "Outcome", description: "Current status, trace status, stop reason, and final summary", surface: "outcome" },
  { label: "Tool Ledger", description: "Latest bounded tool-call ledger", surface: "tool-ledger" },
  { label: "Status History", description: "Latest bounded status events", surface: "status-history" },
  { label: "Tool Summary", description: "Aggregated tool-call counts by tool name", surface: "tool-summary" },
  { label: "File Summary", description: "Aggregated read-target counts from readFile calls", surface: "file-summary" },
  { label: "State JSON", description: "Raw parsed snapshot/result JSON envelope", surface: "state-json" }
];

function resolveTraceableEvidenceUri(target?: vscode.Uri): vscode.Uri | undefined {
  if (target && target.scheme === "file" && /\.trace\.md$/iu.test(target.fsPath)) {
    return target;
  }
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active && active.scheme === "file" && /\.trace\.md$/iu.test(active.fsPath)) {
    return active;
  }
  return undefined;
}

function getTraceableEvidenceResourceKey(uri: vscode.Uri): string {
  return path.normalize(uri.fsPath).toLowerCase();
}

function readTabInputUri(input: unknown, key: "uri" | "modified"): vscode.Uri | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const candidate = (input as Record<string, unknown>)[key];
  if (!candidate || typeof candidate !== "object") {
    return undefined;
  }
  const uriLike = candidate as Partial<vscode.Uri>;
  return typeof uriLike.fsPath === "string" && typeof uriLike.scheme === "string"
    ? uriLike as vscode.Uri
    : undefined;
}

function readTabInputViewType(input: unknown): string | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const viewType = (input as Record<string, unknown>).viewType;
  return typeof viewType === "string" ? viewType : undefined;
}

function normalizePotentialTraceableUri(value: unknown): vscode.Uri | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as Partial<vscode.Uri> & { path?: string };
  if (typeof candidate.fsPath === "string" && typeof candidate.scheme === "string") {
    return candidate as vscode.Uri;
  }
  if (typeof candidate.path === "string" && typeof candidate.scheme === "string" && candidate.scheme === "file") {
    return vscode.Uri.file(candidate.path);
  }
  return undefined;
}

function isTraceableEvidenceFileUri(uri: vscode.Uri | undefined): uri is vscode.Uri {
  return Boolean(uri && uri.scheme === "file" && uri.fsPath.toLowerCase().endsWith(".trace.md"));
}

function isRelatedTraceableEvidenceTab(tab: { label?: string; input?: unknown }, resolvedUri: vscode.Uri): boolean {
  const input = tab.input;
  const resolvedKey = getTraceableEvidenceResourceKey(resolvedUri);
  const sourceUri = readTabInputUri(input, "uri");
  if (sourceUri?.scheme === resolvedUri.scheme && getTraceableEvidenceResourceKey(sourceUri) === resolvedKey) {
    return true;
  }
  const modifiedUri = readTabInputUri(input, "modified");
  if (modifiedUri?.scheme === resolvedUri.scheme && getTraceableEvidenceResourceKey(modifiedUri) === resolvedKey) {
    return true;
  }
  if (readTabInputViewType(input) === TRACEABLE_EVIDENCE_EDITOR_VIEW_TYPE) {
    return false;
  }
  const normalizedLabel = typeof tab.label === "string" ? tab.label.trim().toLowerCase() : "";
  const resolvedBaseName = path.basename(resolvedUri.fsPath).toLowerCase();
  return normalizedLabel === resolvedBaseName || normalizedLabel === `preview ${resolvedBaseName}`;
}

function normalizeTraceableEvidenceTabLabel(label: string | undefined): string | undefined {
  const trimmed = label?.trim();
  if (!trimmed) {
    return undefined;
  }
  const withoutPreviewPrefix = trimmed.replace(/^preview\s+/iu, "").trim();
  return withoutPreviewPrefix.toLowerCase().endsWith(".trace.md") ? withoutPreviewPrefix : undefined;
}

async function resolveActiveTraceableEvidenceUri(target?: vscode.Uri | string): Promise<vscode.Uri | undefined> {
  if (target instanceof vscode.Uri && isTraceableEvidenceFileUri(target)) {
    return target;
  }
  if (typeof target === "string" && target.trim()) {
    const targetUri = vscode.Uri.file(target.trim());
    if (isTraceableEvidenceFileUri(targetUri)) {
      return targetUri;
    }
  }
  const normalizedTargetUri = normalizePotentialTraceableUri(target);
  if (isTraceableEvidenceFileUri(normalizedTargetUri)) {
    return normalizedTargetUri;
  }
  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (activeTab) {
    const directUri = readTabInputUri(activeTab.input, "uri") ?? readTabInputUri(activeTab.input, "modified");
    if (isTraceableEvidenceFileUri(directUri)) {
      return directUri;
    }
    const normalizedLabel = normalizeTraceableEvidenceTabLabel(activeTab.label);
    if (normalizedLabel) {
      const openDocumentMatch = vscode.workspace.textDocuments.find((document) => (
        document.uri.scheme === "file"
        && path.basename(document.uri.fsPath).toLowerCase() === normalizedLabel.toLowerCase()
      ));
      if (openDocumentMatch) {
        return openDocumentMatch.uri;
      }
      const workspaceMatches = await vscode.workspace.findFiles("**/*.trace.md", undefined, 50);
      const basenameMatches = workspaceMatches.filter((candidate) => path.basename(candidate.fsPath).toLowerCase() === normalizedLabel.toLowerCase());
      if (basenameMatches.length === 1) {
        return basenameMatches[0];
      }
    }
  }
  const visibleTraceableTabLabels = (vscode.window.tabGroups.all ?? [])
    .flatMap((group) => group.tabs)
    .map((tab) => normalizeTraceableEvidenceTabLabel(tab.label))
    .filter((label): label is string => Boolean(label));
  const uniqueVisibleTraceableLabels = [...new Set(visibleTraceableTabLabels)];
  if (uniqueVisibleTraceableLabels.length === 1) {
    const visibleLabel = uniqueVisibleTraceableLabels[0];
    const openDocumentMatch = vscode.workspace.textDocuments.find((document) => (
      document.uri.scheme === "file"
      && path.basename(document.uri.fsPath).toLowerCase() === visibleLabel.toLowerCase()
    ));
    if (openDocumentMatch) {
      return openDocumentMatch.uri;
    }
    const workspaceMatches = await vscode.workspace.findFiles("**/*.trace.md", undefined, 50);
    const basenameMatches = workspaceMatches.filter((candidate) => path.basename(candidate.fsPath).toLowerCase() === visibleLabel.toLowerCase());
    if (basenameMatches.length === 1) {
      return basenameMatches[0];
    }
  }
  const activeEditorUri = vscode.window.activeTextEditor?.document.uri;
  if (isTraceableEvidenceFileUri(activeEditorUri)) {
    return activeEditorUri;
  }
  return undefined;
}

async function openMarkdownPreviewLikeSource(target: vscode.Uri): Promise<void> {
  const document = await vscode.workspace.openTextDocument(target);
  await vscode.window.showTextDocument(document, {
    preview: false,
    preserveFocus: false
  });
  try {
    await vscode.commands.executeCommand("reopenActiveEditorWith", "vscode.markdown.preview.editor");
  } catch {
    try {
      await vscode.commands.executeCommand("markdown.reopenAsPreview");
    } catch {
      await vscode.commands.executeCommand("markdown.showPreview", target);
    }
  }
}

function compactTraceableSummaryText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatTraceableInputMode(mode: TraceableSubagentInput["inputMode"]): string | undefined {
  switch (mode) {
    case "OPERATIVE":
      return "O";
    case "EPISTEMIC":
      return "E";
    case "NON_LEADING_EPISTEMIC":
      return "NLE";
    default:
      return undefined;
  }
}

function formatTraceableModeSummaryValue(
  inputMode: TraceableSubagentInput["inputMode"],
  validationMode: TraceableSubagentInput["validationMode"]
): string | undefined {
  const modeCode = formatTraceableInputMode(inputMode);
  if (!modeCode) {
    return undefined;
  }
  const normalizedValidationMode = validationMode?.trim().toUpperCase();
  if (normalizedValidationMode === "WARN") {
    return `${modeCode}-W`;
  }
  if (normalizedValidationMode === "ERROR") {
    return `${modeCode}-E`;
  }
  return modeCode;
}

function describeTraceableInputMode(mode: TraceableSubagentInput["inputMode"]): string | undefined {
  switch (mode) {
    case "OPERATIVE":
      return "Declared input mode: OPERATIVE\nTreat the bounded task contract as explicit operational direction.";
    case "EPISTEMIC":
      return "Declared input mode: EPISTEMIC\nTreat the input as inquiry-shaped framing rather than as a fixed target conclusion.";
    case "NON_LEADING_EPISTEMIC":
      return "Declared input mode: NON_LEADING_EPISTEMIC\nTreat the input as inquiry-shaped framing and avoid smuggling the target conclusion into the task contract.";
    default:
      return undefined;
  }
}

function describeTraceableValidationMode(mode: TraceableSubagentInput["validationMode"]): string | undefined {
  switch (mode) {
    case "NONE":
      return "Declared validation mode: NONE\nDo not apply any extra input-mode mismatch gate by default.";
    case "WARN":
      return "Declared validation mode: WARN\nSurface input-mode mismatches as trace-visible warnings while preserving the original userInput and parentFrame text unchanged.";
    case "ERROR":
      return "Declared validation mode: ERROR\nTreat input-mode mismatches as hard validation errors and stop the lane before model execution.";
    default:
      return undefined;
  }
}

function describeTraceableModeSummary(
  inputMode: TraceableSubagentInput["inputMode"],
  validationMode: TraceableSubagentInput["validationMode"]
): string | undefined {
  const inputModeDescription = describeTraceableInputMode(inputMode);
  const validationModeDescription = describeTraceableValidationMode(validationMode);
  if (!inputModeDescription) {
    return validationModeDescription;
  }
  if (!validationModeDescription) {
    return inputMode === "NON_LEADING_EPISTEMIC"
      ? `${inputModeDescription}\nDeclared mode code: ${formatTraceableModeSummaryValue(inputMode, validationMode)}\nNON_LEADING_EPISTEMIC requires validationMode WARN or ERROR.`
      : `${inputModeDescription}\nDeclared mode code: ${formatTraceableModeSummaryValue(inputMode, validationMode)}`;
  }
  return `${inputModeDescription}\n${validationModeDescription}\nDeclared mode code: ${formatTraceableModeSummaryValue(inputMode, validationMode)}`;
}

function describeTraceableOutputMode(mode: TraceableSubagentInput["outputMode"], exportToFolder: string | undefined): {
  value: string;
  title: string;
} | undefined {
  const normalizedFolder = exportToFolder?.trim();
  switch (mode) {
    case "summary-with-evidence-path":
      return {
        value: "S+P",
        title: `Return the compact TRACEABLE result and include evidence path metadata.${normalizedFolder ? `\nExport folder: ${normalizedFolder}` : "\nTool-triggered export requires exportToFolder. Use the Export button for interactive folder picking."}`
      };
    case "full-markdown-with-evidence-path":
      return {
        value: "full + path",
        title: `Return the full raw evidence markdown inline and include evidence path metadata.${normalizedFolder ? `\nExport folder: ${normalizedFolder}` : "\nTool-triggered export requires exportToFolder. Use the Export button for interactive folder picking."}`
      };
    case "evidence-path-only":
      return {
        value: "path only",
        title: `Return only the bounded completion summary plus evidence path metadata.${normalizedFolder ? `\nExport folder: ${normalizedFolder}` : "\nTool-triggered export requires exportToFolder. Use the Export button for interactive folder picking."}`
      };
    default:
      return normalizedFolder
        ? {
          value: "S+P",
          title: `Evidence export requested with the default summary-with-evidence-path mode.\nExport folder: ${normalizedFolder}`
        }
        : undefined;
  }
}

function buildTraceableRequestSummary(input: TraceableSubagentInput): TraceableSubagentRequestSummaryItem[] {
  const summary: TraceableSubagentRequestSummaryItem[] = [];
  const parentFrame = input.parentFrame?.trim() || input.parentTask?.trim() || "";
  summary.push({
    label: "Parent Frame",
    value: compactTraceableSummaryText(parentFrame, 54),
    title: parentFrame
  });
  if (input.userInput.trim()) {
    summary.push({
      label: "User Input",
      value: compactTraceableSummaryText(input.userInput, 54),
      title: input.userInput
    });
  }
  const formattedMode = formatTraceableModeSummaryValue(input.inputMode, input.validationMode);
  const modeDescription = describeTraceableModeSummary(input.inputMode, input.validationMode);
  if (formattedMode && modeDescription) {
    summary.push({
      label: "Mode",
      value: formattedMode,
      title: modeDescription
    });
  } else {
    const validationModeDescription = describeTraceableValidationMode(input.validationMode);
    if (input.validationMode?.trim() && validationModeDescription) {
      summary.push({
        label: "Validation",
        value: input.validationMode.trim().toLowerCase(),
        title: validationModeDescription
      });
    }
  }
  const outputModeSummary = describeTraceableOutputMode(input.outputMode, input.exportToFolder);
  if (outputModeSummary) {
    summary.push({
      label: "Output",
      value: outputModeSummary.value,
      title: outputModeSummary.title
    });
  }
  if (input.agentRole?.name?.trim()) {
    summary.push({
      label: "Role",
      value: input.agentRole.name.trim(),
      title: input.agentRole.filePath?.trim() || input.agentRole.name.trim()
    });
  }
  if (input.modelSelector?.id?.trim()) {
    summary.push({
      label: "Model",
      value: compactTraceableSummaryText(input.modelSelector.id.trim(), 24),
      title: input.modelSelector.id.trim()
    });
  }
  const carryParts: string[] = [];
  const carryTitleParts: string[] = [];
  if (input.carriedContext?.priorTurnsSummary?.trim()) {
    carryParts.push("context");
    carryTitleParts.push("Prior context summary carried into this trace run");
  }
  if (Array.isArray(input.carriedContext?.fileContext) && input.carriedContext.fileContext.length > 0) {
    const fileCount = input.carriedContext.fileContext.length;
    carryParts.push(`${fileCount} file${fileCount === 1 ? "" : "s"}`);
    carryTitleParts.push(`File anchors: ${input.carriedContext.fileContext.join(", ")}`);
  }
  if (Array.isArray(input.carriedContext?.reductions) && input.carriedContext.reductions.length > 0) {
    const reductionCount = input.carriedContext.reductions.length;
    carryParts.push(`${reductionCount} reduction${reductionCount === 1 ? "" : "s"}`);
    carryTitleParts.push(`Reductions: ${input.carriedContext.reductions.join(" | ")}`);
  }
  if (carryParts.length > 0) {
    summary.push({
      label: "Carry",
      value: compactTraceableSummaryText(carryParts.join(" · "), 36),
      title: carryTitleParts.join("\n")
    });
  }
  if (input.budgetPolicy?.maxIterations || input.budgetPolicy?.maxToolCalls) {
    const budgetParts: string[] = [];
    if (input.budgetPolicy.maxIterations) {
      budgetParts.push(`up to ${input.budgetPolicy.maxIterations} model turn${input.budgetPolicy.maxIterations === 1 ? "" : "s"}`);
    }
    if (input.budgetPolicy.maxToolCalls) {
      budgetParts.push(`up to ${input.budgetPolicy.maxToolCalls} tool call${input.budgetPolicy.maxToolCalls === 1 ? "" : "s"}`);
    }
    summary.push({
      label: "Budget",
      value: `${input.budgetPolicy.maxIterations ?? "-"}i · ${input.budgetPolicy.maxToolCalls ?? "-"}t`,
      title: budgetParts.length > 0
        ? `This child run may use ${budgetParts.join(" and ")}.`
        : "This child run has a bounded model-turn and tool-call budget."
    });
  }
  if (Array.isArray(input.allowedToolNames) && input.allowedToolNames.length > 0) {
    summary.push({
      label: "Allowlist",
      value: `${input.allowedToolNames.length} tool${input.allowedToolNames.length === 1 ? "" : "s"}`,
      title: `Allowed tools: ${input.allowedToolNames.join(", ")}`
    });
  }
  if (Array.isArray(input.blockedToolNames) && input.blockedToolNames.length > 0) {
    summary.push({
      label: "Blocklist",
      value: `${input.blockedToolNames.length} tool${input.blockedToolNames.length === 1 ? "" : "s"}`,
      title: `Blocked tools: ${input.blockedToolNames.join(", ")}`
    });
  }
  if (input.reveal) {
    summary.push({
      label: "Reveal",
      value: "Panel",
      title: "TRACEABLE panel requested at invocation start"
    });
  }
  return summary;
}

function getTraceableAutoRevealMode(): TraceableAutoRevealMode {
  const configured = getProvenanceConfiguration().get<string>("traceableAutoReveal", "yes");
  return configured === "no" || configured === "always" ? configured : "yes";
}

function getTraceableAutoHideMode(): TraceableAutoHideMode {
  const configured = getProvenanceConfiguration().get<unknown>("traceableAutoHide", "yes");
  if (configured === false || configured === "false" || configured === "no") {
    return "no";
  }
  return "yes";
}

function shouldAutoRevealTraceablePanel(inputReveal: boolean | undefined): boolean {
  const mode = getTraceableAutoRevealMode();
  if (mode === "always") {
    return true;
  }
  if (mode === "no") {
    return false;
  }
  return Boolean(inputReveal);
}

function shouldKeepTraceablePanelPinned(options: {
  reason: "auto" | "manual";
  autoHideMode: TraceableAutoHideMode;
  currentlyPinnedOpen: boolean;
}): boolean {
  if (options.reason === "manual") {
    return true;
  }
  if (options.currentlyPinnedOpen) {
    return true;
  }
  return options.autoHideMode !== "yes";
}

function toTraceablePanelRestoreCommand(activePanel: unknown): string | undefined {
  if (typeof activePanel !== "string" || !activePanel.trim()) {
    return undefined;
  }
  const trimmed = activePanel.trim();
  if (trimmed === TRACEABLE_SUBAGENT_PANEL_CONTAINER_ID || trimmed === `workbench.view.extension.${TRACEABLE_SUBAGENT_PANEL_CONTAINER_ID}`) {
    return undefined;
  }
  if (trimmed.startsWith("workbench.view.extension.")) {
    return trimmed;
  }
  switch (trimmed) {
    case "terminal":
      return "workbench.action.terminal.focus";
    case "workbench.panel.markers":
      return "workbench.action.problems.focus";
    default:
      return undefined;
  }
}

async function getTraceablePanelRestoreCommand(): Promise<string | undefined> {
  try {
    const activePanel = await vscode.commands.executeCommand("getContextKeyValue", "activePanel");
    return toTraceablePanelRestoreCommand(activePanel);
  } catch {
    return undefined;
  }
}

function summarizeInvocationText(value: string | undefined, maxChars = 32): string | undefined {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length <= maxChars
    ? trimmed
    : `${trimmed.slice(0, Math.max(0, maxChars - 16))}... [truncated]`;
}

function formatFileCount(fileCount: number): string {
  return `${fileCount} file${fileCount === 1 ? "" : "s"}`;
}

function traceableSubagentInvocationAction(input: TraceableSubagentInput): string | undefined {
  const source = input.userInput?.trim() || input.parentFrame?.trim() || input.parentTask?.trim();
  if (!source) {
    return undefined;
  }
  const normalized = source.toLowerCase();
  if (/^(compare|contrast|cross-check)\b/.test(normalized)) {
    return "Comparing";
  }
  if (/^(review|inspect|check|probe|audit|examine)\b/.test(normalized)) {
    return "Reviewing";
  }
  if (/^(analy[sz]e|determine|classify|separate|validate|verify)\b/.test(normalized)) {
    return "Analyzing";
  }
  if (/^(summari[sz]e)\b/.test(normalized)) {
    return "Summarizing";
  }
  if (/^(trace|map)\b/.test(normalized)) {
    return "Tracing";
  }
  return undefined;
}

function traceableSubagentInvocationSuffix(input: TraceableSubagentInput, action: string | undefined): string | undefined {
  const source = `${input.userInput?.trim() ?? ""} ${input.parentFrame?.trim() ?? input.parentTask?.trim() ?? ""}`.toLowerCase();
  if (!source) {
    return undefined;
  }
  if (action === "Comparing") {
    if (/\b(gap|gaps|open|missing|claim|claims|prove|proof|validation)\b/.test(source)) {
      return "for gaps";
    }
    return "for differences";
  }
  if (action === "Reviewing") {
    if (/\b(validation|verify|proof|prove|host)\b/.test(source)) {
      return "for validation";
    }
    if (/\b(behavior|implementation|runtime|contract)\b/.test(source)) {
      return "for behavior";
    }
  }
  if (action === "Analyzing") {
    if (/\b(validation|verify|proof|prove|host)\b/.test(source)) {
      return "for validation";
    }
    return "for evidence";
  }
  return undefined;
}

function traceableSubagentInvocationMessage(input: TraceableSubagentInput): string {
  const summary = summarizeInvocationText(input.parentFrame) ?? summarizeInvocationText(input.parentTask) ?? summarizeInvocationText(input.userInput);
  const action = traceableSubagentInvocationAction(input);
  const suffix = traceableSubagentInvocationSuffix(input, action);
  const fileCount = Array.isArray(input.carriedContext?.fileContext) ? input.carriedContext.fileContext.length : 0;
  const normalizedAllowedTools = Array.isArray(input.allowedToolNames)
    ? input.allowedToolNames.map((toolName) => toolName.trim()).filter(Boolean)
    : [];
  if (fileCount > 0 && normalizedAllowedTools.length === 1 && normalizedAllowedTools[0] === "copilot_readFile") {
    return `Trace lane: ${formatFileCount(fileCount)}${suffix ? ` ${suffix}` : ""}`;
  }
  if (fileCount > 0) {
    return `Trace lane: ${formatFileCount(fileCount)}${suffix ? ` ${suffix}` : ""}`;
  }
  if (!summary) {
    return "Trace lane";
  }
  return `Trace lane: ${summary}`;
}

function outputBudget(tokenBudget: number | undefined): number {
  if (!Number.isFinite(tokenBudget) || !tokenBudget || tokenBudget <= 0) {
    return 12000;
  }
  return Math.max(2000, Math.min(24000, Math.floor(tokenBudget * 4)));
}

class QueuedReadOnlyTool<TInput> implements vscode.LanguageModelTool<TInput> {
  constructor(
    private readonly displayName: string,
    private readonly invocationMessage: (input: TInput) => string,
    private readonly invokeImpl: (input: TInput, budget: number, preparedState?: unknown) => Promise<string>,
    private readonly mutex: QueuedMutex,
    private readonly prepareInvoke?: (input: TInput) => Promise<unknown> | unknown
  ) {}

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<TInput>): vscode.PreparedToolInvocation {
    return {
      invocationMessage: this.invocationMessage(options.input)
    };
  }

  async invoke(options: vscode.LanguageModelToolInvocationOptions<TInput>): Promise<vscode.LanguageModelToolResult> {
    const preparedState = await this.prepareInvoke?.(options.input);
    const lease = await this.mutex.acquire(`${this.displayName} invocation`);
    const budget = outputBudget(options.tokenizationOptions?.tokenBudget);
    try {
      const content = await this.invokeImpl(options.input, budget, preparedState);
      return textResult(content);
    } finally {
      lease.release();
    }
  }
}

function textResult(content: string): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(content)]);
}

function renderTraceableAgentCatalogMarkdown(
  entries: Awaited<ReturnType<typeof listTraceableAgentCatalogEntries>>,
  input: ListTraceableAgentsInput
): string {
  const normalizedQuery = input.query?.trim().toLowerCase() ?? "";
  const filteredEntries = normalizedQuery
    ? entries.filter((entry) => entry.displayName.toLowerCase().includes(normalizedQuery) || entry.artifactStem.toLowerCase().includes(normalizedQuery))
    : entries;
  const limitedEntries = filteredEntries.slice(0, input.limit ?? 20);
  const lines = [
    "# Traceable Agent Catalog",
    "",
    "- Scope: workspace-supported `.github/agents/*.agent.md` runtime artifacts.",
    "- Purpose: provide exact display names for `run_traceable_subagent` without manual workspace traversal.",
    `- Total matching agents: ${filteredEntries.length}`
  ];
  if (normalizedQuery) {
    lines.push(`- Query: ${input.query?.trim()}`);
  }
  if (limitedEntries.length === 0) {
    lines.push("", "No matching traceable agents found in the current workspace runtime surface.");
    return `${lines.join("\n")}\n`;
  }
  lines.push("");
  for (const entry of limitedEntries) {
    const tags = [
      entry.workspaceFolderName,
      entry.candidate ? "candidate" : undefined,
      entry.experimental ? "experimental" : undefined,
      entry.humanRole ? "human-role" : undefined,
      entry.modelDeclaration ? `model=${entry.modelDeclaration}` : undefined
    ].filter(Boolean);
    lines.push(`- ${entry.displayName}`);
    lines.push(`  - Stem: ${entry.artifactStem}`);
    lines.push(`  - File: ${entry.filePath}`);
    lines.push(`  - Tags: ${tags.join(", ") || "-"}`);
  }
  if (limitedEntries.length < filteredEntries.length) {
    lines.push("", `Showing ${limitedEntries.length}/${filteredEntries.length} matching agents.`);
  }
  return `${lines.join("\n")}\n`;
}

function renderTraceableAgentCatalogMarkdownWithLint(
  entries: Awaited<ReturnType<typeof listTraceableAgentCatalogEntries>>,
  lintFindings: Awaited<ReturnType<typeof listTraceableAgentCatalogLintFindings>>,
  input: ListTraceableAgentsInput
): string {
  const baseMarkdown = renderTraceableAgentCatalogMarkdown(entries, input).trimEnd();
  const normalizedQuery = input.query?.trim().toLowerCase() ?? "";
  const filteredLintFindings = normalizedQuery
    ? lintFindings.filter((finding) => finding.artifactStem.toLowerCase().includes(normalizedQuery) || finding.filePath.toLowerCase().includes(normalizedQuery))
    : lintFindings;
  if (filteredLintFindings.length === 0) {
    return `${baseMarkdown}\n`;
  }
  const lines = [baseMarkdown, "", "## Frontmatter Lint Findings", ""];
  for (const finding of filteredLintFindings.slice(0, input.limit ?? 20)) {
    lines.push(`- ${finding.artifactStem}`);
    lines.push(`  - File: ${finding.filePath}`);
    lines.push(`  - Workspace: ${finding.workspaceFolderName}`);
    lines.push(`  - Error: ${finding.message}`);
  }
  if (filteredLintFindings.length > (input.limit ?? 20)) {
    lines.push("", `Showing ${Math.min(filteredLintFindings.length, input.limit ?? 20)}/${filteredLintFindings.length} lint findings.`);
  }
  return `${lines.join("\n")}\n`;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseConfiguredStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .flatMap((entry) => typeof entry === "string" ? [entry.trim()] : [])
    .filter(Boolean);
}

function normalizeModelPolicyLabel(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9.\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
}

function readTraceableModelPolicySettings(): { preferred: Set<string>; blocked: Set<string> } {
  const config = vscode.workspace.getConfiguration("tiinex.aiProvenance");
  return {
    preferred: new Set(parseConfiguredStringList(config.get("traceablePreferredModels", [])).map((value) => normalizeModelPolicyLabel(value))),
    blocked: new Set(parseConfiguredStringList(config.get("traceableBlockedModels", [])).map((value) => normalizeModelPolicyLabel(value)))
  };
}

function buildTraceableModelPolicyAliases(entry: Awaited<ReturnType<typeof listTraceableModelCatalogEntries>>[number]): string[] {
  const aliases = [
    entry.vendor && entry.id ? `${entry.vendor}/${entry.id}` : undefined,
    entry.vendor && entry.id ? `${entry.id}-${entry.vendor}` : undefined,
    entry.vendor && entry.family ? `${entry.vendor}/${entry.family}` : undefined,
    entry.vendor && entry.family ? `${entry.family}-${entry.vendor}` : undefined
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => normalizeModelPolicyLabel(value));
  return [...new Set(aliases)];
}

function renderTraceableModelCatalogMarkdown(
  entries: Awaited<ReturnType<typeof listTraceableModelCatalogEntries>>,
  input: ListTraceableModelsInput
): string {
  const policy = readTraceableModelPolicySettings();
  const normalizedQuery = input.query?.trim().toLowerCase() ?? "";
  const filteredEntries = entries.filter((entry) => {
    if (input.sendableOnly && !entry.sendable) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    const haystack = [entry.id, entry.vendor, entry.family, entry.version]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalizedQuery);
  });
  const annotatedEntries = filteredEntries.map((entry) => {
    const aliases = buildTraceableModelPolicyAliases(entry);
    return {
      entry,
      preferred: aliases.some((alias) => policy.preferred.has(alias)),
      blocked: aliases.some((alias) => policy.blocked.has(alias))
    };
  });
  const limitedEntries = annotatedEntries.slice(0, input.limit ?? 20);
  const lines = [
    "# Traceable Model Catalog",
    "",
    "- Scope: runtime-discoverable models from `selectChatModels({})`.",
    "- Purpose: preflight exact model ids for `run_traceable_subagent` without waiting for model-selection failure.",
    `- Total matching models: ${filteredEntries.length}`
  ];
  if (normalizedQuery) {
    lines.push(`- Query: ${input.query?.trim()}`);
  }
  if (input.sendableOnly) {
    lines.push("- Filter: sendable-only");
  }
  lines.push(`- Preferred matches: ${annotatedEntries.filter((entry) => entry.preferred).length}`);
  lines.push(`- Blocked matches: ${annotatedEntries.filter((entry) => entry.blocked).length}`);
  if (limitedEntries.length === 0) {
    lines.push("", "No matching traceable models found in the current runtime surface.");
    return `${lines.join("\n")}\n`;
  }
  lines.push("");
  for (const { entry, preferred, blocked } of limitedEntries) {
    const policyLabels = [blocked ? "blocked" : undefined, preferred ? "preferred" : undefined].filter(Boolean);
    lines.push(`- ${entry.id ?? "(missing id)"}`);
    lines.push(`  - Vendor: ${entry.vendor ?? "-"}`);
    lines.push(`  - Family: ${entry.family ?? "-"}`);
    lines.push(`  - Version: ${entry.version ?? "-"}`);
    lines.push(`  - Sendable: ${entry.sendable ? "yes" : "no"}`);
    lines.push(`  - Policy: ${policyLabels.join(", ") || "-"}`);
  }
  if (limitedEntries.length < filteredEntries.length) {
    lines.push("", `Showing ${limitedEntries.length}/${filteredEntries.length} matching models.`);
  }
  return `${lines.join("\n")}\n`;
}

async function resolveTraceableEvidenceFilePath(evidenceFilePath: string): Promise<string> {
  const normalized = evidenceFilePath.trim();
  if (!normalized) {
    throw new Error("view_traceable_subagent requires a non-empty evidenceFilePath.");
  }
  if (path.isAbsolute(normalized)) {
    return path.resolve(normalized);
  }
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  const candidates: string[] = [];
  for (const folder of workspaceFolders) {
    const candidate = path.resolve(folder.uri.fsPath, normalized);
    if (await pathExists(candidate)) {
      candidates.push(candidate);
    }
  }
  if (candidates.length === 1) {
    return candidates[0];
  }
  if (candidates.length > 1) {
    throw new Error(`Relative evidenceFilePath ${JSON.stringify(normalized)} matched multiple workspace files. Provide an absolute path instead.`);
  }
  throw new Error(`Could not resolve evidenceFilePath ${JSON.stringify(normalized)} under any open workspace folder. Provide an absolute path instead.`);
}

function truncateTraceableViewOutput(content: string, budget: number): string {
  if (content.length <= budget) {
    return content.endsWith("\n") ? content : `${content}\n`;
  }
  const suffix = "\n\n[truncated to fit tool output budget]\n";
  const headBudget = Math.max(0, budget - suffix.length);
  return `${content.slice(0, headBudget).trimEnd()}${suffix}`;
}

function getProvenanceConfiguration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("tiinex.aiProvenance");
}

function getConfiguredEvidenceMaxItems(): number {
  const configured = getProvenanceConfiguration().get<number>("evidenceMaxItems", 10);
  return Number.isFinite(configured) && (configured ?? 0) > 0 ? Math.round(configured ?? 10) : 10;
}

function getConfiguredIncludeSupportArtifacts(): boolean {
  return getProvenanceConfiguration().get<boolean>("includeSupportArtifacts", true);
}

async function renderTraceableEvidenceSurfaceFromFile(input: {
  evidenceFilePath: string;
  surface: TraceableEvidenceSurface;
  maxItems?: number;
  offset?: number;
  includeSupportArtifacts?: boolean;
}): Promise<string> {
  const evidenceFilePath = await resolveTraceableEvidenceFilePath(input.evidenceFilePath);
  if (!evidenceFilePath.toLowerCase().endsWith(".trace.md")) {
    throw new Error(`TRACEABLE evidence inspect requires a .trace.md file. Got ${JSON.stringify(evidenceFilePath)}.`);
  }
  const markdown = await fs.readFile(evidenceFilePath, "utf8");
  const parsed = parseTraceableEvidenceStateMarkdown(markdown);
  if (!parsed) {
    throw new Error(`TRACEABLE evidence file ${JSON.stringify(evidenceFilePath)} does not contain a readable Traceable State block.`);
  }
  return renderTraceableEvidenceSurfaceMarkdown({
    filePath: evidenceFilePath,
    parsed,
    surface: input.surface,
    maxItems: input.maxItems,
    offset: input.offset,
    includeSupportArtifacts: input.includeSupportArtifacts
  });
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Tiinex AI Provenance");
  output.appendLine("Activated Tiinex AI Provenance extension scaffold.");
  let traceablePanelRestoreCommand: string | undefined;
  let traceablePanelPinnedOpen = false;
  void vscode.commands.executeCommand("setContext", TRACEABLE_PANEL_VISIBLE_CONTEXT, false);
  const traceableStatusDetail = new TraceableSubagentStatusDetailController();
  const traceableEvidence = new TraceableSubagentEvidenceController({
    header: {
      agentName: "Trace lane",
      agentFilePath: "",
      agentResolved: false,
      modelLabel: "model",
      candidate: false,
      experimental: false,
      humanRole: false,
      toolsetNames: [],
      selectedToolNames: [],
      toolSelectionRestricted: false
    },
    status: { phase: "idle", message: "idle" },
    evidenceFile: { status: "idle" },
    requestSummary: [],
    statusHistory: [],
    recentTools: [],
    startedAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  });
  const traceableEvidencePanels = new Map<string, vscode.WebviewPanel>();
  const traceableEvidencePanelSources = new Map<string, vscode.Uri>();
  let activeTraceableEvidencePanelKey: string | undefined;

  const getTraceableEvidencePanelKey = (uri: vscode.Uri): string => getTraceableEvidenceResourceKey(uri);
  const readTraceableEvidenceViewState = async (resolvedUri: vscode.Uri): Promise<{
    sourceDocument: vscode.TextDocument | undefined;
    parsedState: ReturnType<typeof parseTraceableEvidenceStateMarkdown>;
  }> => {
    const panelKey = getTraceableEvidencePanelKey(resolvedUri);
    const sourceDocument = vscode.workspace.textDocuments.find((document) => (
      document.uri.scheme === resolvedUri.scheme
      && getTraceableEvidencePanelKey(document.uri) === panelKey
    ));
    const markdown = sourceDocument ? sourceDocument.getText() : await fs.readFile(resolvedUri.fsPath, "utf8");
    const parsedState = parseTraceableEvidenceStateMarkdown(markdown);
    return { sourceDocument, parsedState };
  };
  const renderTraceableEvidencePanel = (panel: vscode.WebviewPanel, resolvedUri: vscode.Uri, snapshot: TraceableSubagentDetailSnapshot): void => {
    const codiconCssHref = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "node_modules", "@vscode", "codicons", "dist", "codicon.css")
    ).toString();
    panel.title = path.basename(resolvedUri.fsPath);
    panel.webview.html = renderTraceableSubagentPanelHtml(snapshot, codiconCssHref, {
      pinnedOpen: true,
      hideToolbarControls: true
    });
  };
  const refreshTraceableEvidencePanel = async (panelKey: string, resolvedUri: vscode.Uri, panel: vscode.WebviewPanel): Promise<boolean> => {
    const latestState = await readTraceableEvidenceViewState(resolvedUri);
    if (!latestState.parsedState || traceableEvidencePanels.get(panelKey) !== panel) {
      return false;
    }
    renderTraceableEvidencePanel(panel, resolvedUri, latestState.parsedState.snapshot);
    return true;
  };
  const getRelatedTraceableTabsToReplace = (resolvedUri: vscode.Uri): vscode.Tab[] => {
    return (vscode.window.tabGroups.all ?? [])
      .flatMap((group) => group.tabs)
      .filter((tab) => isRelatedTraceableEvidenceTab(tab, resolvedUri));
  };
  const reopenTraceableEvidenceSource = async (): Promise<void> => {
    const panelKey = activeTraceableEvidencePanelKey;
    if (!panelKey) {
      void vscode.window.showWarningMessage("Open a TRACEABLE evidence view first.");
      return;
    }
    const sourceUri = traceableEvidencePanelSources.get(panelKey);
    const panel = traceableEvidencePanels.get(panelKey);
    if (!sourceUri || !panel) {
      void vscode.window.showWarningMessage("The active TRACEABLE evidence view is no longer available.");
      return;
    }
    await vscode.commands.executeCommand("vscode.open", sourceUri, {
      preview: false,
      preserveFocus: false
    });
    panel.dispose();
  };
  const reopenTraceableEvidencePreview = async (): Promise<void> => {
    const panelKey = activeTraceableEvidencePanelKey;
    if (!panelKey) {
      void vscode.window.showWarningMessage("Open a TRACEABLE evidence view first.");
      return;
    }
    const sourceUri = traceableEvidencePanelSources.get(panelKey);
    const panel = traceableEvidencePanels.get(panelKey);
    if (!sourceUri || !panel) {
      void vscode.window.showWarningMessage("The active TRACEABLE evidence view is no longer available.");
      return;
    }
    await openMarkdownPreviewLikeSource(sourceUri);
    panel.dispose();
  };
  const openTraceableFile = async (filePath: string, startLine?: number, endLine?: number): Promise<void> => {
    const normalizedPath = filePath.trim();
    if (/\.md$/iu.test(normalizedPath) && !Number.isInteger(startLine) && !Number.isInteger(endLine)) {
      await openMarkdownPreviewLikeSource(vscode.Uri.file(normalizedPath));
      return;
    }
    const targetLine = Number.isInteger(startLine) ? Math.max(0, (startLine ?? 1) - 1) : 0;
    const targetEndLine = Number.isInteger(endLine) ? Math.max(targetLine, (endLine ?? startLine ?? 1) - 1) : targetLine;
    await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(normalizedPath), {
      preview: false,
      preserveFocus: false,
      selection: new vscode.Range(targetLine, 0, targetEndLine, 0)
    });
  };
  const openTraceableEvidenceEditor = async (target?: vscode.Uri | string): Promise<void> => {
    const resolvedUri = await resolveActiveTraceableEvidenceUri(target);
    if (!resolvedUri || resolvedUri.scheme !== "file" || !resolvedUri.fsPath.toLowerCase().endsWith(".trace.md")) {
      void vscode.window.showWarningMessage("Open a .trace.md evidence file first, or pass one explicitly.");
      return;
    }
    const panelKey = getTraceableEvidencePanelKey(resolvedUri);
    const { sourceDocument, parsedState } = await readTraceableEvidenceViewState(resolvedUri);
    if (!parsedState) {
      void vscode.window.showErrorMessage("This TRACEABLE evidence file does not contain a readable Traceable State block.");
      return;
    }
    const tabsToReplace = getRelatedTraceableTabsToReplace(resolvedUri);
    const existingPanel = traceableEvidencePanels.get(panelKey);
    if (existingPanel) {
      traceableEvidencePanelSources.set(panelKey, resolvedUri);
      activeTraceableEvidencePanelKey = panelKey;
      renderTraceableEvidencePanel(existingPanel, resolvedUri, parsedState.snapshot);
      existingPanel.reveal(vscode.ViewColumn.Active, false);
      if (tabsToReplace.length > 0 && !sourceDocument?.isDirty) {
        await vscode.window.tabGroups.close(tabsToReplace, false);
      }
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      TRACEABLE_EVIDENCE_EDITOR_VIEW_TYPE,
      path.basename(resolvedUri.fsPath),
      {
        viewColumn: vscode.ViewColumn.Active,
        preserveFocus: false
      },
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "node_modules", "@vscode", "codicons", "dist")],
        retainContextWhenHidden: true
      }
    );
    traceableEvidencePanels.set(panelKey, panel);
    traceableEvidencePanelSources.set(panelKey, resolvedUri);
    activeTraceableEvidencePanelKey = panelKey;
    const panelDisposables: vscode.Disposable[] = [];
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let refreshInFlight = false;
    let refreshQueued = false;
    const scheduleRefresh = (): void => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        void flushRefresh();
      }, TRACEABLE_EVIDENCE_REFRESH_DEBOUNCE_MS);
    };
    const flushRefresh = async (): Promise<void> => {
      if (refreshInFlight) {
        refreshQueued = true;
        return;
      }
      refreshInFlight = true;
      try {
        await refreshTraceableEvidencePanel(panelKey, resolvedUri, panel);
      } finally {
        refreshInFlight = false;
        if (refreshQueued) {
          refreshQueued = false;
          scheduleRefresh();
        }
      }
    };
    const sourceWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(path.dirname(resolvedUri.fsPath)), path.basename(resolvedUri.fsPath))
    );
    panelDisposables.push(sourceWatcher);
    panelDisposables.push(sourceWatcher.onDidChange(() => {
      scheduleRefresh();
    }));
    panelDisposables.push(sourceWatcher.onDidCreate(() => {
      scheduleRefresh();
    }));
    panelDisposables.push(vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.scheme !== resolvedUri.scheme || getTraceableEvidencePanelKey(event.document.uri) !== panelKey) {
        return;
      }
      scheduleRefresh();
    }));
    panelDisposables.push(panel.onDidChangeViewState((event) => {
      if (event.webviewPanel.active) {
        activeTraceableEvidencePanelKey = panelKey;
      }
    }));
    panel.onDidDispose(() => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
      for (const disposable of panelDisposables) {
        disposable.dispose();
      }
      if (traceableEvidencePanels.get(panelKey) === panel) {
        traceableEvidencePanels.delete(panelKey);
      }
      traceableEvidencePanelSources.delete(panelKey);
      if (activeTraceableEvidencePanelKey === panelKey) {
        activeTraceableEvidencePanelKey = undefined;
      }
    });
    renderTraceableEvidencePanel(panel, resolvedUri, parsedState.snapshot);
    panel.webview.onDidReceiveMessage(async (message) => {
      if (!message || typeof message.type !== "string") {
        return;
      }
      if (message.type === "openFile" && typeof message.filePath === "string") {
        const startLine = typeof message.startLine === "number" ? message.startLine : undefined;
        const endLine = typeof message.endLine === "number" ? message.endLine : undefined;
        await openTraceableFile(message.filePath, startLine, endLine);
      }
    });
    if (tabsToReplace.length > 0 && !sourceDocument?.isDirty) {
      await vscode.window.tabGroups.close(tabsToReplace, false);
    }
  };
  const hideTraceablePanel = async (options: { restoreFocus?: boolean; hideStatusBar?: boolean; resetKeepOpen?: boolean } = {}): Promise<void> => {
    await vscode.commands.executeCommand("setContext", TRACEABLE_PANEL_VISIBLE_CONTEXT, false);
    if (options.hideStatusBar) {
      traceableStatusBar.hideNow();
    }
    if (options.restoreFocus) {
      await vscode.commands.executeCommand(traceablePanelRestoreCommand ?? TRACEABLE_PANEL_FALLBACK_COMMAND);
    }
    if (options.resetKeepOpen) {
      traceablePanelPinnedOpen = false;
    }
    traceablePanelRestoreCommand = undefined;
  };
  const traceableStatusPanel = new TraceableSubagentStatusPanelProvider(
    context.extensionUri,
    async () => {
      await traceableEvidence.exportCurrentSnapshotViaDialog();
      const snapshot = traceableEvidence.getSnapshot();
      traceableStatusDetail.update(snapshot);
      traceableStatusPanel.update(snapshot);
    },
    openTraceableFile,
    async () => {
      await hideTraceablePanel({ restoreFocus: true, hideStatusBar: true, resetKeepOpen: true });
      traceableStatusPanel.setPinnedOpen(false);
    },
    async () => {
      traceablePanelPinnedOpen = true;
      traceableStatusPanel.setPinnedOpen(true);
    }
  );
  const revealTraceablePanel = async (reason: "auto" | "manual" = "manual"): Promise<void> => {
    traceablePanelRestoreCommand = await getTraceablePanelRestoreCommand();
    traceablePanelPinnedOpen = shouldKeepTraceablePanelPinned({
      reason,
      autoHideMode: getTraceableAutoHideMode(),
      currentlyPinnedOpen: traceablePanelPinnedOpen
    });
    traceableStatusPanel.setPinnedOpen(traceablePanelPinnedOpen);
    await vscode.commands.executeCommand("setContext", TRACEABLE_PANEL_VISIBLE_CONTEXT, true);
    await traceableStatusPanel.open();
  };
  const traceableStatusBar = new TraceableSubagentStatusBarController({
    detailCommandId: OPEN_TRACEABLE_SUBAGENT_STATUS_DETAIL_COMMAND,
    onDidAutoHide: async () => {
      if (getTraceableAutoHideMode() !== "yes") {
        traceablePanelPinnedOpen = true;
        traceableStatusPanel.setPinnedOpen(true);
        return;
      }
      if (traceablePanelPinnedOpen) {
        return;
      }
      traceableStatusPanel.setPinnedOpen(false);
      await hideTraceablePanel();
    },
    updateDetailView: (snapshot) => {
      const enrichedSnapshot = traceableEvidence.updateSnapshot(snapshot);
      traceableStatusDetail.update(enrichedSnapshot);
      traceableStatusPanel.update(enrichedSnapshot);
    }
  });

  context.subscriptions.push(output);
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("tiinex-traceable-subagent-status", traceableStatusDetail),
    vscode.commands.registerCommand(OPEN_TRACEABLE_SUBAGENT_STATUS_DETAIL_COMMAND, async () => {
      await revealTraceablePanel("manual");
    }),
    vscode.commands.registerCommand(OPEN_OVERVIEW_COMMAND, async () => {
      const repoReadme = vscode.Uri.file(path.resolve(context.extensionPath, "..", "..", "README.md"));
      const document = await vscode.workspace.openTextDocument(repoReadme);
      await vscode.window.showTextDocument(document, { preview: false });
      output.appendLine(`Opened provenance overview: ${repoReadme.fsPath}`);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(INSPECT_TRACEABLE_EVIDENCE_COMMAND, async (target?: vscode.Uri) => {
      const evidenceUri = resolveTraceableEvidenceUri(target);
      if (!evidenceUri) {
        void vscode.window.showErrorMessage("Open a .trace.md evidence file first, or invoke the command from a .trace.md file.");
        return;
      }
      const markdown = await fs.readFile(evidenceUri.fsPath, "utf8");
      const parsed = parseTraceableEvidenceStateMarkdown(markdown);
      if (!parsed) {
        void vscode.window.showErrorMessage("This TRACEABLE evidence file does not contain a readable Traceable State block.");
        return;
      }
      const selectedSurface = await vscode.window.showQuickPick(
        TRACEABLE_SURFACE_OPTIONS.map((option) => ({
          label: option.label,
          description: option.description,
          surface: option.surface
        })),
        {
          title: "Inspect TRACEABLE Evidence",
          placeHolder: "Choose which bounded evidence surface to render"
        }
      );
      if (!selectedSurface) {
        return;
      }
      const summary = renderViewTraceableSubagentMarkdown({
        filePath: evidenceUri.fsPath,
        markdown,
        parsed,
        view: {
          evidenceFilePath: evidenceUri.fsPath,
          surface: selectedSurface.surface,
          maxItems: getConfiguredEvidenceMaxItems(),
          includeSupportArtifacts: getConfiguredIncludeSupportArtifacts()
        }
      });
      const document = await vscode.workspace.openTextDocument({
        language: "markdown",
        content: summary
      });
      await vscode.window.showTextDocument(document, { preview: false });
      output.appendLine(`Inspected TRACEABLE evidence (${selectedSurface.surface}): ${evidenceUri.fsPath}`);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(OPEN_TRACEABLE_EVIDENCE_EDITOR_COMMAND, async (target?: vscode.Uri | string) => {
      await openTraceableEvidenceEditor(target);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(REOPEN_TRACEABLE_EVIDENCE_SOURCE_COMMAND, async () => {
      await reopenTraceableEvidenceSource();
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(REOPEN_TRACEABLE_EVIDENCE_PREVIEW_COMMAND, async () => {
      await reopenTraceableEvidencePreview();
    })
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(TRACEABLE_SUBAGENT_PANEL_VIEW_ID, traceableStatusPanel, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    traceableStatusDetail,
    traceableStatusPanel,
    traceableStatusBar,
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("tiinex.aiProvenance.traceableAutoHide") && getTraceableAutoHideMode() !== "yes") {
        traceablePanelPinnedOpen = true;
        traceableStatusPanel.setPinnedOpen(true);
      }
    }),
    vscode.lm.registerTool("list_traceable_agents", {
      prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<ListTraceableAgentsInput>): vscode.PreparedToolInvocation {
        return {
          invocationMessage: `List traceable agents${options.input.query ? ` matching ${JSON.stringify(options.input.query)}` : ""}`
        };
      },
      async invoke(options: vscode.LanguageModelToolInvocationOptions<ListTraceableAgentsInput>): Promise<vscode.LanguageModelToolResult> {
        return textResult(renderTraceableAgentCatalogMarkdownWithLint(
          await listTraceableAgentCatalogEntries(),
          await listTraceableAgentCatalogLintFindings(),
          options.input
        ));
      }
    }),
    vscode.lm.registerTool("list_traceable_models", {
      prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<ListTraceableModelsInput>): vscode.PreparedToolInvocation {
        return {
          invocationMessage: `List traceable models${options.input.query ? ` matching ${JSON.stringify(options.input.query)}` : ""}`
        };
      },
      async invoke(options: vscode.LanguageModelToolInvocationOptions<ListTraceableModelsInput>): Promise<vscode.LanguageModelToolResult> {
        return textResult(renderTraceableModelCatalogMarkdown(
          await listTraceableModelCatalogEntries(context.languageModelAccessInformation),
          options.input
        ));
      }
    }),
    vscode.lm.registerTool(VIEW_TRACEABLE_SUBAGENT_TOOL, {
      prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<ViewTraceableSubagentInput>): vscode.PreparedToolInvocation {
        return {
          invocationMessage: `View TRACEABLE evidence from ${JSON.stringify(options.input.evidenceFilePath)}${options.input.surface ? ` as ${options.input.surface}` : ""}`
        };
      },
      async invoke(options: vscode.LanguageModelToolInvocationOptions<ViewTraceableSubagentInput>): Promise<vscode.LanguageModelToolResult> {
        const resolvedEvidenceFilePath = await resolveTraceableEvidenceFilePath(options.input.evidenceFilePath);
        if (!resolvedEvidenceFilePath.toLowerCase().endsWith(".trace.md")) {
          throw new Error(`TRACEABLE evidence view requires a .trace.md file. Got ${JSON.stringify(resolvedEvidenceFilePath)}.`);
        }
        const markdown = await fs.readFile(resolvedEvidenceFilePath, "utf8");
        const parsed = parseTraceableEvidenceStateMarkdown(markdown);
        if (!parsed) {
          throw new Error(`TRACEABLE evidence file ${JSON.stringify(resolvedEvidenceFilePath)} does not contain a readable Traceable State block.`);
        }
        const rendered = renderViewTraceableSubagentMarkdown({
          filePath: resolvedEvidenceFilePath,
          markdown,
          parsed,
          view: {
            ...options.input,
            maxItems: options.input.maxItems ?? getConfiguredEvidenceMaxItems(),
            includeSupportArtifacts: options.input.includeSupportArtifacts ?? getConfiguredIncludeSupportArtifacts(),
            surface: options.input.surface ?? "rendered-output"
          }
        });
        if (options.input.reveal && shouldAutoRevealTraceablePanel(options.input.reveal)) {
          await openTraceableEvidenceEditor(resolvedEvidenceFilePath);
        }
        const budget = Number.isFinite(options.tokenizationOptions?.tokenBudget)
          ? Math.max(2000, Math.min(24000, Math.floor((options.tokenizationOptions?.tokenBudget ?? 0) * 4)))
          : 12000;
        return textResult(truncateTraceableViewOutput(rendered, budget));
      }
    }),
    vscode.lm.registerTool(
      RUN_TRACEABLE_SUBAGENT_TOOL,
      new QueuedReadOnlyTool<TraceableSubagentInput>(
        "Run Traceable Subagent",
        (input) => traceableSubagentInvocationMessage(input),
        async (input, _budget, preparedState) => {
          const runHooks = preparedState as {
            statusReporter?: ReturnType<TraceableSubagentStatusBarController["startRun"]>;
            beforeRun?: () => Promise<void>;
            afterRun?: (result: TraceableSubagentRunResult) => Promise<TraceableSubagentRunResult>;
          } | undefined;
          await runHooks?.beforeRun?.();
          const result = await runTraceableSubagent(input, {
            accessInformation: context.languageModelAccessInformation,
            debugLogDir: context.globalStorageUri.fsPath,
            statusReporter: runHooks?.statusReporter
          });
          const finalResult = runHooks?.afterRun ? await runHooks.afterRun(result) : result;
          return renderTraceableSubagentMarkdown(finalResult);
        },
        traceableSubagentToolMutex,
        (input) => {
          if (shouldAutoRevealTraceablePanel(input.reveal)) {
            void (async () => {
              await revealTraceablePanel("auto");
            })();
          }
          const reporter = traceableStatusBar.startRun({
            agentName: input.agentRole?.name,
            modelLabel: input.modelSelector?.id
          });
          reporter.setRequestSummary?.(buildTraceableRequestSummary(input));
          reporter.update("queued");
          return {
            statusReporter: reporter,
            beforeRun: async () => {
              await traceableEvidence.prepareRequestedExport(input);
              const snapshot = traceableEvidence.getSnapshot();
              traceableStatusDetail.update(snapshot);
              traceableStatusPanel.update(snapshot);
            },
            afterRun: async (result: TraceableSubagentRunResult) => {
              const finalized = await traceableEvidence.finalizeRequestedExport(result, renderTraceableSubagentMarkdown(result));
              const snapshot = traceableEvidence.getSnapshot();
              traceableStatusDetail.update(snapshot);
              traceableStatusPanel.update(snapshot);
              return finalized;
            }
          };
        }
      )
    )
  );
}

export function deactivate(): void {
}