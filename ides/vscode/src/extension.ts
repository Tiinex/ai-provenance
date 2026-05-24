import path from "node:path";
import { promises as fs } from "node:fs";
import * as vscode from "vscode";
import {
  parseTraceableEvidenceStateMarkdown,
  renderViewTraceableSubagentMarkdown,
  renderTraceableEvidenceSurfaceMarkdown,
  type ParsedTraceableEvidenceState,
  type TraceableEvidenceSurface,
  type ViewTraceableSubagentInput
} from "./traceableEvidence";
import {
  listTraceableAgentCatalogEntries,
  listTraceableAgentCatalogLintFindings,
  listTraceableModelCatalogEntries,
  prepareTraceableSubagentInput,
  runTraceableSubagent,
  renderTraceableSubagentMarkdown,
  type TraceableSubagentInput,
  type TraceableSubagentRequestSummaryItem,
  type TraceableSubagentRunResult,
  type TraceableSubagentToolDetail
} from "./traceableSubagent";
import { TraceableSubagentEvidenceController } from "./traceableSubagentEvidence";
import { QueuedMutex, type MutexLease } from "./mutex";
import { TraceableSubagentStatusBarController } from "./traceableSubagentStatusBar";
import { TraceableSubagentStatusDetailController, type TraceableSubagentDetailSnapshot } from "./traceableSubagentStatusDetail";
import {
  TRACEABLE_SUBAGENT_PANEL_CONTAINER_ID,
  TRACEABLE_SUBAGENT_PANEL_VIEW_ID,
  TraceableSubagentStatusPanelProvider,
  renderTraceableSubagentPanelHtml
} from "./traceableSubagentStatusPanel";
import { type TraceableResolvedPathTarget } from "./traceableContract";
import {
  getUniqueWorkspaceFolderMatchByName,
  isPathWithinAnyWorkspaceRoot,
  resolveDriveLessAbsolutePathOnWindows,
  resolveRelativeOpenPathInWorkspace
} from "./traceableOpenPath.js";

const OPEN_OVERVIEW_COMMAND = "tiinex.aiProvenance.openOverview";
const INSPECT_TRACEABLE_EVIDENCE_COMMAND = "tiinex.aiProvenance.inspectTraceableEvidence";
const OPEN_TRACEABLE_SUBAGENT_STATUS_DETAIL_COMMAND = "tiinex.aiProvenance.openTraceableSubagentStatusDetail";
const STOP_TRACEABLE_SUBAGENT_COMMAND = "tiinex.aiProvenance.stopTraceableSubagent";
const OPEN_TRACEABLE_EVIDENCE_EDITOR_COMMAND = "tiinex.aiProvenance.openTraceableEvidenceEditor";
const REOPEN_TRACEABLE_EVIDENCE_SOURCE_COMMAND = "tiinex.aiProvenance.reopenTraceableEvidenceSource";
const REOPEN_TRACEABLE_EVIDENCE_PREVIEW_COMMAND = "tiinex.aiProvenance.reopenTraceableEvidencePreview";
const NEW_TRACEABLE_CHAT_COMMAND = "tiinex.aiProvenance.newTraceableChat";
const RESUME_TRACEABLE_CHAT_COMMAND = "tiinex.aiProvenance.resumeTraceableChat";
const SET_DEFAULT_NEW_TRACEABLE_CHAT_EXPORT_FOLDER_COMMAND = "tiinex.aiProvenance.setDefaultNewTraceableChatExportFolder";
const RUN_TRACEABLE_SUBAGENT_TOOL = "run_traceable_subagent";
const VIEW_TRACEABLE_SUBAGENT_TOOL = "view_traceable_subagent";
const TRACEABLE_EVIDENCE_EDITOR_VIEW_TYPE = "tiinexTraceableEvidenceEditor";
const TRACEABLE_EVIDENCE_REFRESH_DEBOUNCE_MS = 250;
const TRACEABLE_PANEL_VISIBLE_CONTEXT = "tiinex.aiProvenance.traceablePanelVisible";
const TRACEABLE_PANEL_FALLBACK_COMMAND = "workbench.action.terminal.focus";
const TOGGLE_MAXIMIZED_PANEL_COMMAND = "workbench.action.toggleMaximizedPanel";
const TRACEABLE_BUSY_MESSAGE = "Another TRACEABLE run is already starting or running. Wait for it to settle before sending another turn.";

function isTraceableResolvedPathTarget(value: unknown): value is TraceableResolvedPathTarget {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<TraceableResolvedPathTarget>;
  if (candidate.kind === "absolute") {
    return typeof candidate.path === "string";
  }
  if (candidate.kind === "relative") {
    return typeof candidate.path === "string" && typeof candidate.baseDir === "string";
  }
  return false;
}

type TraceableAutoRevealMode = "yes" | "no" | "always";
type TraceableAutoHideMode = "yes" | "no";
type TraceableEvidenceOpenTarget = "traceable" | "markdown" | "source";

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
  { label: "Request Contract", description: "Separate explicit request, inherited state, contextual inputs, and safe implicit defaults", surface: "request-contract" },
  { label: "Summary", description: "Compact overview of the evidence artifact", surface: "summary" },
  { label: "Outcome", description: "Current status, trace status, stop reason, and final summary", surface: "outcome" },
  { label: "Runtime Decision", description: "Persisted model-selection rationale and runtime fingerprint", surface: "runtime-decision" },
  { label: "Evidence Basis", description: "Persisted grounding anchors, carried context, and unsupported claims", surface: "evidence-basis" },
  { label: "Timeline", description: "Replay-oriented activity timeline with status events, recent tools, and decision points", surface: "timeline" },
  { label: "Carry Handoff", description: "Resolved carry-state disposition plus active or recoverable handoff details", surface: "carry-handoff" },
  { label: "Latest Role State", description: "Latest known sender adaptation state for one role within the current lineage", surface: "latest-role-state" },
  { label: "Latest Carry Package", description: "Latest active or recoverable carry package within the current lineage", surface: "latest-carry-package" },
  { label: "Tool Forensics", description: "Bounded per-call inputs, typed outputs, metadata, and raw-output capture state", surface: "tool-forensics" },
  { label: "Lineage", description: "Parent/current/children chain view over continuation and neighboring trace artifacts", surface: "lineage" },
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
  if (readTabInputViewType(input) === TRACEABLE_EVIDENCE_EDITOR_VIEW_TYPE) {
    return false;
  }
  const resolvedKey = getTraceableEvidenceResourceKey(resolvedUri);
  const sourceUri = readTabInputUri(input, "uri");
  if (sourceUri?.scheme === resolvedUri.scheme && getTraceableEvidenceResourceKey(sourceUri) === resolvedKey) {
    return true;
  }
  const modifiedUri = readTabInputUri(input, "modified");
  if (modifiedUri?.scheme === resolvedUri.scheme && getTraceableEvidenceResourceKey(modifiedUri) === resolvedKey) {
    return true;
  }
  const normalizedLabel = typeof tab.label === "string" ? tab.label.trim().toLowerCase() : "";
  const resolvedBaseName = path.basename(resolvedUri.fsPath).toLowerCase();
  return normalizedLabel === resolvedBaseName || normalizedLabel === `preview ${resolvedBaseName}`;
}

function getActiveTraceableEvidenceTab(): vscode.Tab | undefined {
  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (!activeTab) {
    return undefined;
  }
  return readTabInputViewType(activeTab.input) === TRACEABLE_EVIDENCE_EDITOR_VIEW_TYPE ? activeTab : undefined;
}

function isActiveTabForResource(resolvedUri: vscode.Uri): boolean {
  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (!activeTab) {
    return false;
  }
  const resolvedKey = getTraceableEvidenceResourceKey(resolvedUri);
  const directUri = readTabInputUri(activeTab.input, "uri") ?? readTabInputUri(activeTab.input, "modified");
  if (directUri?.scheme === resolvedUri.scheme && getTraceableEvidenceResourceKey(directUri) === resolvedKey) {
    return true;
  }
  const normalizedLabel = normalizeTraceableEvidenceTabLabel(activeTab.label);
  return normalizedLabel === path.basename(resolvedUri.fsPath).toLowerCase();
}

async function closeTabIfStillOpen(targetTab: vscode.Tab | undefined): Promise<void> {
  if (!targetTab) {
    return;
  }
  const stillOpen = (vscode.window.tabGroups.all ?? []).some((group) => group.tabs.includes(targetTab));
  if (!stillOpen) {
    return;
  }
  await vscode.window.tabGroups.close(targetTab, false);
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
    case "DIRECT":
      return "D";
    case "RESUME":
      return "R";
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
    case "DIRECT":
      return "Declared input mode: DIRECT\nTreat userInput as the only fresh prompt and do not inject or inherit parentTask or parentFrame text into the prompt surface.";
    case "RESUME":
      return "Declared input mode: RESUME\nResume from parentTracePath and inherited carry only; do not accept fresh userInput, parentTask, or parentFrame text.";
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

function hasExplicitBudgetPolicy(input: TraceableSubagentInput | undefined): boolean {
  return Boolean(
    Number.isInteger(input?.budgetPolicy?.maxIterations)
    || Number.isInteger(input?.budgetPolicy?.maxToolCalls)
  );
}

function hasExplicitModelSelector(input: TraceableSubagentInput | undefined): boolean {
  return Boolean(
    input?.modelSelector?.id?.trim()
    || input?.modelSelector?.vendor?.trim()
    || input?.modelSelector?.family?.trim()
    || input?.modelSelector?.version?.trim()
  );
}

function hasExplicitAgentRole(input: TraceableSubagentInput | undefined): boolean {
  return Boolean(input?.agentRole?.name?.trim() || input?.agentRole?.filePath?.trim());
}

function normalizeParentRoles(input: TraceableSubagentInput["parentRoles"]): string[] {
  if (typeof input === "string") {
    const trimmed = input.trim();
    return trimmed ? [trimmed] : [];
  }
  if (!Array.isArray(input)) {
    return [];
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of input) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

function hasExplicitParentRoles(input: TraceableSubagentInput | undefined): boolean {
  return normalizeParentRoles(input?.parentRoles).length > 0;
}

function hasCarryContext(input: TraceableSubagentInput | undefined): boolean {
  const carriedContext = input?.carriedContext;
  return Boolean(
    carriedContext?.priorTurnsSummary?.trim()
    || (Array.isArray(carriedContext?.fileContext) && carriedContext.fileContext.length > 0)
    || (Array.isArray(carriedContext?.reductions) && carriedContext.reductions.length > 0)
  );
}

function hasCarryState(input: TraceableSubagentInput | undefined): boolean {
  const carryState = input?.activeCarryForward;
  return Boolean(
    (Array.isArray(carryState?.remainingGoals) && carryState.remainingGoals.length > 0)
    || (Array.isArray(carryState?.openQuestions) && carryState.openQuestions.length > 0)
    || (Array.isArray(carryState?.constraints) && carryState.constraints.length > 0)
    || carryState?.nextSuggestedStart?.trim()
    || (Array.isArray(carryState?.relevantFileAnchors) && carryState.relevantFileAnchors.length > 0)
    || (Array.isArray(carryState?.relevantArtifactAnchors) && carryState.relevantArtifactAnchors.length > 0)
  );
}

function buildInheritedRequestSummaryItem(
  effectiveInput: TraceableSubagentInput,
  requestedInput: TraceableSubagentInput | undefined
): TraceableSubagentRequestSummaryItem | undefined {
  if (!effectiveInput.parentTracePath?.trim() || !requestedInput) {
    return undefined;
  }
  const inheritedLabels: string[] = [];
  const detailLines = [`Inherited from parent trace: ${effectiveInput.parentTracePath.trim()}`];
  if (!requestedInput.inputMode && !requestedInput.validationMode) {
    const formattedMode = formatTraceableModeSummaryValue(effectiveInput.inputMode, effectiveInput.validationMode);
    const modeDescription = describeTraceableModeSummary(effectiveInput.inputMode, effectiveInput.validationMode);
    if (formattedMode && modeDescription) {
      inheritedLabels.push("mode");
      detailLines.push(`Mode: ${formattedMode}`);
      detailLines.push(modeDescription);
    }
  }
  if (!requestedInput.outputMode && !requestedInput.exportToFolder?.trim()) {
    const outputModeSummary = describeTraceableOutputMode(effectiveInput.outputMode, effectiveInput.exportToFolder);
    if (outputModeSummary) {
      inheritedLabels.push("output");
      detailLines.push(`Output: ${outputModeSummary.title}`);
    }
  }
  if (!hasExplicitAgentRole(requestedInput) && effectiveInput.agentRole?.name?.trim()) {
    inheritedLabels.push("role");
    detailLines.push(`Role: ${effectiveInput.agentRole.filePath?.trim() || effectiveInput.agentRole.name.trim()}`);
  }
  if (!hasExplicitModelSelector(requestedInput) && effectiveInput.modelSelector?.id?.trim()) {
    inheritedLabels.push("model");
    detailLines.push(`Model: ${effectiveInput.modelSelector.id.trim()}`);
  }
  if (!hasExplicitBudgetPolicy(requestedInput) && (effectiveInput.budgetPolicy?.maxIterations || effectiveInput.budgetPolicy?.maxToolCalls)) {
    inheritedLabels.push("budget");
    detailLines.push(`Budget: ${effectiveInput.budgetPolicy?.maxIterations ?? "-"}i · ${effectiveInput.budgetPolicy?.maxToolCalls ?? "-"}t`);
  }
  if (requestedInput.allowedToolNames === undefined && Array.isArray(effectiveInput.allowedToolNames) && effectiveInput.allowedToolNames.length > 0) {
    inheritedLabels.push("allowlist");
    detailLines.push(`Allowlist: ${effectiveInput.allowedToolNames.join(", ")}`);
  }
  if (requestedInput.blockedToolNames === undefined && Array.isArray(effectiveInput.blockedToolNames) && effectiveInput.blockedToolNames.length > 0) {
    inheritedLabels.push("blocklist");
    detailLines.push(`Blocklist: ${effectiveInput.blockedToolNames.join(", ")}`);
  }
  if (!hasCarryContext(requestedInput) && hasCarryContext(effectiveInput)) {
    inheritedLabels.push("carry");
  }
  if (!hasCarryState(requestedInput) && hasCarryState(effectiveInput)) {
    inheritedLabels.push("state");
  }
  if (inheritedLabels.length === 0) {
    return undefined;
  }
  return {
    label: "Inherited",
    value: compactTraceableSummaryText(inheritedLabels.join(" · "), 24),
    title: detailLines.join("\n")
  };
}

function buildTraceableRequestSummary(
  input: TraceableSubagentInput,
  requestedInput?: TraceableSubagentInput
): TraceableSubagentRequestSummaryItem[] {
  const summary: TraceableSubagentRequestSummaryItem[] = [];
  const continuationRequested = Boolean(requestedInput?.parentTracePath?.trim());
  const showModeBadge = !continuationRequested || Boolean(requestedInput?.inputMode || requestedInput?.validationMode);
  const showOutputBadge = !continuationRequested || Boolean(requestedInput?.outputMode || requestedInput?.exportToFolder?.trim());
  const showRoleBadge = !continuationRequested || hasExplicitAgentRole(requestedInput);
  const showParentRolesBadge = !continuationRequested || hasExplicitParentRoles(requestedInput);
  const showModelBadge = !continuationRequested || hasExplicitModelSelector(requestedInput);
  const showBudgetBadge = !continuationRequested || hasExplicitBudgetPolicy(requestedInput);
  const showAllowlistBadge = !continuationRequested || requestedInput?.allowedToolNames !== undefined;
  const showBlocklistBadge = !continuationRequested || requestedInput?.blockedToolNames !== undefined;
  if (input.parentTracePath?.trim()) {
    summary.push({
      label: "Parent Trace",
      value: path.basename(input.parentTracePath.trim()),
      title: input.parentTracePath.trim()
    });
  }
  const parentFrame = input.parentFrame?.trim() || input.parentTask?.trim() || "";
  if (parentFrame) {
    summary.push({
      label: "Parent Frame",
      value: compactTraceableSummaryText(parentFrame, 54),
      title: parentFrame
    });
  }
  if (input.userInput?.trim()) {
    summary.push({
      label: "User Input",
      value: compactTraceableSummaryText(input.userInput, 54),
      title: input.userInput
    });
  }
  const parentRoles = normalizeParentRoles(input.parentRoles);
  if (showParentRolesBadge && parentRoles.length > 0) {
    summary.push({
      label: "Parent Roles",
      value: compactTraceableSummaryText(parentRoles.join(" · "), 36),
      title: `Incoming userInput was provided on behalf of these parent roles:\n${parentRoles.join("\n")}`
    });
  }
  const formattedMode = formatTraceableModeSummaryValue(input.inputMode, input.validationMode);
  const modeDescription = describeTraceableModeSummary(input.inputMode, input.validationMode);
  if (showModeBadge && formattedMode && modeDescription) {
    summary.push({
      label: "Mode",
      value: formattedMode,
      title: modeDescription
    });
  } else if (showModeBadge) {
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
  if (showOutputBadge && outputModeSummary) {
    summary.push({
      label: "Output",
      value: outputModeSummary.value,
      title: outputModeSummary.title
    });
  }
  if (showRoleBadge && input.agentRole?.name?.trim()) {
    summary.push({
      label: "Role",
      value: input.agentRole.name.trim(),
      title: input.agentRole.filePath?.trim() || input.agentRole.name.trim()
    });
  }
  if (showModelBadge && input.modelSelector?.id?.trim()) {
    summary.push({
      label: "Requested Model",
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
  const carryStateParts: string[] = [];
  const carryStateTitleParts: string[] = [];
  if (Array.isArray(input.activeCarryForward?.remainingGoals) && input.activeCarryForward.remainingGoals.length > 0) {
    const goalCount = input.activeCarryForward.remainingGoals.length;
    carryStateParts.push(`${goalCount} goal${goalCount === 1 ? "" : "s"}`);
    carryStateTitleParts.push(`Remaining goals: ${input.activeCarryForward.remainingGoals.join(" | ")}`);
  }
  if (Array.isArray(input.activeCarryForward?.openQuestions) && input.activeCarryForward.openQuestions.length > 0) {
    const questionCount = input.activeCarryForward.openQuestions.length;
    carryStateParts.push(`${questionCount} question${questionCount === 1 ? "" : "s"}`);
    carryStateTitleParts.push(`Open questions: ${input.activeCarryForward.openQuestions.join(" | ")}`);
  }
  if (Array.isArray(input.activeCarryForward?.constraints) && input.activeCarryForward.constraints.length > 0) {
    const constraintCount = input.activeCarryForward.constraints.length;
    carryStateParts.push(`${constraintCount} constraint${constraintCount === 1 ? "" : "s"}`);
    carryStateTitleParts.push(`Constraints: ${input.activeCarryForward.constraints.join(" | ")}`);
  }
  if (input.activeCarryForward?.nextSuggestedStart?.trim()) {
    carryStateParts.push("next start");
    carryStateTitleParts.push(`Next suggested start: ${input.activeCarryForward.nextSuggestedStart.trim()}`);
  }
  if (Array.isArray(input.activeCarryForward?.relevantFileAnchors) && input.activeCarryForward.relevantFileAnchors.length > 0) {
    carryStateTitleParts.push(`Carry file anchors: ${input.activeCarryForward.relevantFileAnchors.join(", ")}`);
  }
  if (carryStateParts.length > 0) {
    summary.push({
      label: "Carry State",
      value: compactTraceableSummaryText(carryStateParts.join(" · "), 36),
      title: carryStateTitleParts.join("\n")
    });
  }
  if (input.parentTracePath?.trim() && (carryParts.length > 0 || carryStateParts.length > 0)) {
    const inheritedContextSources = ["parent"];
    const inheritedContextTitleParts = [`Continuation parent: ${input.parentTracePath.trim()}`];
    if (carryParts.length > 0) {
      inheritedContextSources.push("context");
      inheritedContextTitleParts.push("Inherited carried context is present for this run.");
    }
    if (carryStateParts.length > 0) {
      inheritedContextSources.push("state");
      inheritedContextTitleParts.push("Inherited carry-forward state is present for this run.");
    }
    summary.push({
      label: "Context In",
      value: compactTraceableSummaryText(inheritedContextSources.join(" · "), 24),
      title: inheritedContextTitleParts.join("\n")
    });
  }
  if (showBudgetBadge && (input.budgetPolicy?.maxIterations || input.budgetPolicy?.maxToolCalls)) {
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
  if (showAllowlistBadge && Array.isArray(input.allowedToolNames) && input.allowedToolNames.length > 0) {
    summary.push({
      label: "Allowlist",
      value: `${input.allowedToolNames.length} tool${input.allowedToolNames.length === 1 ? "" : "s"}`,
      title: `Allowed tools: ${input.allowedToolNames.join(", ")}`
    });
  }
  if (showBlocklistBadge && Array.isArray(input.blockedToolNames) && input.blockedToolNames.length > 0) {
    summary.push({
      label: "Blocklist",
      value: `${input.blockedToolNames.length} tool${input.blockedToolNames.length === 1 ? "" : "s"}`,
      title: `Blocked tools: ${input.blockedToolNames.join(", ")}`
    });
  }
  const inheritedSummaryItem = buildInheritedRequestSummaryItem(input, requestedInput);
  if (inheritedSummaryItem) {
    summary.push(inheritedSummaryItem);
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

function getTraceableEvidenceOpenTarget(): TraceableEvidenceOpenTarget {
  const configured = getProvenanceConfiguration().get<string>("traceableEvidenceOpenTarget", "traceable");
  if (configured === "markdown" || configured === "source") {
    return configured;
  }
  return "traceable";
}

async function narrowTraceableMarkdownEditorAssociation(resource: vscode.Uri): Promise<boolean> {
  const config = vscode.workspace.getConfiguration("workbench", resource);
  const inspected = config.inspect<Record<string, string>>("editorAssociations");
  const migrateAssociation = async (
    value: Record<string, string> | undefined,
    target: vscode.ConfigurationTarget
  ): Promise<boolean> => {
    if (!value || value["*.md"] !== TRACEABLE_EVIDENCE_EDITOR_VIEW_TYPE) {
      return false;
    }
    const nextValue: Record<string, string> = { ...value };
    delete nextValue["*.md"];
    if (!nextValue["*.trace.md"]) {
      nextValue["*.trace.md"] = TRACEABLE_EVIDENCE_EDITOR_VIEW_TYPE;
    }
    await config.update("editorAssociations", nextValue, target);
    return true;
  };
  if (await migrateAssociation(inspected?.workspaceFolderValue, vscode.ConfigurationTarget.WorkspaceFolder)) {
    return true;
  }
  if (await migrateAssociation(inspected?.workspaceValue, vscode.ConfigurationTarget.Workspace)) {
    return true;
  }
  if (await migrateAssociation(inspected?.globalValue, vscode.ConfigurationTarget.Global)) {
    return true;
  }
  return false;
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
    private readonly invokeImpl: (input: TInput, budget: number, preparedState?: unknown, token?: vscode.CancellationToken) => Promise<string>,
    private readonly mutex: QueuedMutex,
    private readonly prepareInvoke?: (input: TInput) => Promise<unknown> | unknown,
    private readonly rejectIfBusy = false
  ) {}

  prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<TInput>): vscode.PreparedToolInvocation {
    return {
      invocationMessage: this.invocationMessage(options.input)
    };
  }

  async invoke(options: vscode.LanguageModelToolInvocationOptions<TInput>, token: vscode.CancellationToken): Promise<vscode.LanguageModelToolResult> {
    if (this.rejectIfBusy && this.mutex.isLocked()) {
      throw new Error(TRACEABLE_BUSY_MESSAGE);
    }
    const lease = await this.mutex.acquire(`${this.displayName} invocation`);
    const budget = outputBudget(options.tokenizationOptions?.tokenBudget);
    try {
      const preparedState = await this.prepareInvoke?.(options.input);
      const content = await this.invokeImpl(options.input, budget, preparedState, token);
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
    "- Recommended flow: find one exact role here, then pass `agentRole.name` or `agentRole.filePath` into `run_traceable_subagent` instead of guessing a role label.",
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
    "- Recommended flow: use `sendableOnly: true` when practical, copy an exact returned id only when you need explicit model control, and treat `Policy: blocked` as non-selectable for `run_traceable_subagent`.",
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
  lines.push("- Typical next step: after choosing an allowed exact id here, run a narrow `run_traceable_subagent` lane and inspect the returned evidence file with `view_traceable_subagent` before rerunning.");
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

function getTraceableOpenWorkspaceFolders(): Array<{ name: string; fsPath: string }> {
  return (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
    name: folder.name,
    fsPath: folder.uri.fsPath
  }));
}

async function resolveTraceableOpenPath(targetPath: string | TraceableResolvedPathTarget, baseDir?: string): Promise<string> {
  if (typeof targetPath !== "string") {
    return targetPath.kind === "relative"
      ? path.resolve(targetPath.baseDir, targetPath.path)
      : path.resolve(targetPath.path);
  }
  const normalized = targetPath.trim();
  if (!normalized) {
    throw new Error("TRACEABLE open path requires a non-empty target path.");
  }
  if (/^file:\/\//iu.test(normalized)) {
    return vscode.Uri.parse(normalized).fsPath;
  }
  const workspaceFolders = getTraceableOpenWorkspaceFolders();
  const cwdRoot = path.parse(process.cwd()).root.replace(/[\\/]+$/u, "");
  const driveLessAbsolutePath = await resolveDriveLessAbsolutePathOnWindows(normalized, workspaceFolders, cwdRoot, pathExists);
  if (driveLessAbsolutePath) {
    return driveLessAbsolutePath;
  }
  if (path.isAbsolute(normalized)) {
    return path.resolve(normalized);
  }
  if (typeof baseDir === "string" && baseDir.trim()) {
    return path.resolve(baseDir.trim(), normalized);
  }
  const workspaceResolvedPath = await resolveRelativeOpenPathInWorkspace(normalized, workspaceFolders, pathExists);
  if (workspaceResolvedPath) {
    return workspaceResolvedPath;
  }
  throw new Error(`Could not resolve relative open path ${JSON.stringify(normalized)} under any open workspace folder or workspace root.`);
}

function truncateTraceableViewOutput(content: string, budget: number): string {
  if (content.length <= budget) {
    return content.endsWith("\n") ? content : `${content}\n`;
  }
  const suffix = "\n\n[truncated to fit tool output budget]\n";
  const headBudget = Math.max(0, budget - suffix.length);
  return `${content.slice(0, headBudget).trimEnd()}${suffix}`;
}

function getProvenanceConfiguration(resource?: vscode.Uri): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("tiinex.aiProvenance", resource);
}

function getConfiguredEvidenceMaxItems(): number {
  const configured = getProvenanceConfiguration().get<number>("evidenceMaxItems", 10);
  return Number.isFinite(configured) && (configured ?? 0) > 0 ? Math.round(configured ?? 10) : 10;
}

function getConfiguredIncludeSupportArtifacts(): boolean {
  return getProvenanceConfiguration().get<boolean>("includeSupportArtifacts", true);
}

function getConfiguredTraceableDefaultView(resource?: vscode.Uri): "detailed" | "chat" {
  const configured = getProvenanceConfiguration(resource).get<string>("defaultView", "detailed");
  return configured === "chat" ? "chat" : "detailed";
}

function getConfiguredAllRolesAvailableAsChatSender(resource?: vscode.Uri): boolean {
  return getProvenanceConfiguration(resource).get<boolean>("allRolesAvailableAsChatSender", false) === true;
}

function getConfiguredDefaultChatSenderRole(resource?: vscode.Uri): string | undefined {
  const configured = getProvenanceConfiguration(resource).get<string>("defaultChatSenderRole", "").trim();
  return configured || undefined;
}

interface ChatSenderRoleOption {
  label: string;
  value: string;
}

function stripTraceableRoleModelSuffix(displayName: string): string {
  return displayName.replace(/(?:\s*\([^)]*\))+\s*$/u, "").trim() || displayName.trim();
}

function buildChatSenderRoleIdentityKey(displayName: string): string {
  return stripTraceableRoleModelSuffix(displayName).normalize("NFKC").toLowerCase();
}

function normalizeChatSenderRoleLookupValue(value: string): string {
  return value.trim().normalize("NFKC").toLowerCase();
}

function resolveConfiguredDefaultChatSenderRoleOption(
  configuredValue: string | undefined,
  options: readonly ChatSenderRoleOption[]
): string | undefined {
  const normalizedConfiguredValue = configuredValue ? normalizeChatSenderRoleLookupValue(configuredValue) : "";
  if (!normalizedConfiguredValue) {
    return undefined;
  }
  const exactValueMatch = options.find((option) => normalizeChatSenderRoleLookupValue(option.value) === normalizedConfiguredValue);
  if (exactValueMatch) {
    return exactValueMatch.value;
  }
  const exactLabelMatch = options.find((option) => normalizeChatSenderRoleLookupValue(option.label) === normalizedConfiguredValue);
  if (exactLabelMatch) {
    return exactLabelMatch.value;
  }
  const prefixMatches = options.filter((option) => normalizeChatSenderRoleLookupValue(option.label).startsWith(normalizedConfiguredValue));
  return prefixMatches.length === 1 ? prefixMatches[0].value : undefined;
}

function comparePreferredChatSenderEntries(
  left: Awaited<ReturnType<typeof listTraceableAgentCatalogEntries>>[number],
  right: Awaited<ReturnType<typeof listTraceableAgentCatalogEntries>>[number]
): number {
  if (left.experimental !== right.experimental) {
    return left.experimental ? 1 : -1;
  }
  if (left.candidate !== right.candidate) {
    return left.candidate ? 1 : -1;
  }
  const leftLabel = stripTraceableRoleModelSuffix(left.displayName);
  const rightLabel = stripTraceableRoleModelSuffix(right.displayName);
  const labelComparison = leftLabel.localeCompare(rightLabel, undefined, { sensitivity: "base" });
  if (labelComparison !== 0) {
    return labelComparison;
  }
  return left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" });
}

async function listConfiguredChatSenderRoleOptions(resource?: vscode.Uri): Promise<ChatSenderRoleOption[]> {
  const allEntries = await listTraceableAgentCatalogEntries();
  const includeAllRoles = getConfiguredAllRolesAvailableAsChatSender(resource);
  const filteredEntries = allEntries.filter((entry) => includeAllRoles || entry.humanRole);
  if (includeAllRoles) {
    return filteredEntries.map((entry) => ({
      label: entry.displayName,
      value: entry.displayName
    }));
  }
  const dedupedEntriesByRole = new Map<string, typeof filteredEntries[number]>();
  for (const entry of filteredEntries) {
    const existing = dedupedEntriesByRole.get(buildChatSenderRoleIdentityKey(entry.displayName));
    if (!existing || comparePreferredChatSenderEntries(entry, existing) < 0) {
      dedupedEntriesByRole.set(buildChatSenderRoleIdentityKey(entry.displayName), entry);
    }
  }
  return [...dedupedEntriesByRole.values()]
    .sort(comparePreferredChatSenderEntries)
    .map((entry) => ({
      label: stripTraceableRoleModelSuffix(entry.displayName),
      value: entry.displayName
    }));
}

async function resolveConfiguredDefaultChatSenderRole(resource?: vscode.Uri): Promise<string | undefined> {
  const configuredValue = getConfiguredDefaultChatSenderRole(resource);
  if (!configuredValue) {
    return undefined;
  }
  const availableOptions = await listConfiguredChatSenderRoleOptions(resource);
  return resolveConfiguredDefaultChatSenderRoleOption(configuredValue, availableOptions);
}

function resolveConfiguredNewTraceableChatExportFolder(resource?: vscode.Uri): string | undefined {
  const configured = getProvenanceConfiguration(resource).get<string>("defaultNewTraceableChatExportTo", "").trim();
  if (!configured) {
    return undefined;
  }
  if (path.isAbsolute(configured)) {
    return path.resolve(configured);
  }
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  if (workspaceFolders.length !== 1) {
    return undefined;
  }
  return path.resolve(workspaceFolders[0].uri.fsPath, configured);
}

function formatNewTraceableChatExportFolderSettingValue(folderPath: string): string {
  return path.resolve(folderPath);
}

async function delayMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readParsedTraceableEvidenceFromFileWithRetry(evidenceFilePath: string, attempts = 5): Promise<{
  markdown: string;
  parsed: ParsedTraceableEvidenceState | undefined;
}> {
  let lastMarkdown = "";
  let lastParsed: ParsedTraceableEvidenceState | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const markdown = await fs.readFile(evidenceFilePath, "utf8");
    const parsed = parseTraceableEvidenceStateMarkdown(markdown);
    lastMarkdown = markdown;
    lastParsed = parsed;
    if (parsed) {
      return { markdown, parsed };
    }
    const exportStillWriting = /- Export Status:\s+writing\b/u.test(markdown)
      || /"status"\s*:\s*"writing"/u.test(markdown);
    if (!exportStillWriting || attempt === attempts - 1) {
      break;
    }
    await delayMs(80 * (attempt + 1));
  }
  return { markdown: lastMarkdown, parsed: lastParsed };
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
  const { parsed } = await readParsedTraceableEvidenceFromFileWithRetry(evidenceFilePath);
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
  const unsavedTraceableAgentChatState = new Map<string, {
    priorTurnsSummary?: string;
    activeCarryForward?: TraceableSubagentRunResult["activeCarryForward"];
  }>();
  let activeUnsavedTraceableAgentChatKey: string | undefined;
  let traceablePanelRestoreCommand: string | undefined;
  let traceablePanelPinnedOpen = false;
  void vscode.commands.executeCommand("setContext", TRACEABLE_PANEL_VISIBLE_CONTEXT, false);
  const traceableStatusDetail = new TraceableSubagentStatusDetailController();
  let activeTraceableRun:
    | {
      cancelSource: vscode.CancellationTokenSource;
      stopSource: "traceable-panel" | "host-cancel" | "unknown";
      stopRequestedAt?: string;
    }
    | undefined;
  let traceablePanelMaximizedByEditorContinuation = false;
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
  const traceableEvidenceLoadedToolDetails = new Map<string, Map<string, TraceableSubagentToolDetail>>();
  const traceableEvidencePanelInitialChatViewByKey = new Map<string, boolean>();
  const traceableEvidenceProgrammaticOpenByKey = new Set<string>();
  let activeTraceableEvidencePanelKey: string | undefined;

  const getTraceableEvidencePanelKey = (uri: vscode.Uri): string => getTraceableEvidenceResourceKey(uri);
  const resolveStoredTraceableReference = (currentFilePath: string, reference: string | undefined): string | undefined => {
    const normalized = reference?.trim();
    if (!normalized) {
      return undefined;
    }
    return path.isAbsolute(normalized)
      ? path.resolve(normalized)
      : path.resolve(path.dirname(currentFilePath), normalized);
  };
  const buildTraceableLineageEntriesFromParent = async (initialParentTracePath: string | undefined, currentFilePath?: string): Promise<TraceableSubagentDetailSnapshot["lineageEntries"]> => {
    const entries: NonNullable<TraceableSubagentDetailSnapshot["lineageEntries"]> = [];
    const resolvedInitialParent = currentFilePath
      ? resolveStoredTraceableReference(currentFilePath, initialParentTracePath)
      : initialParentTracePath?.trim();
    if (!resolvedInitialParent) {
      return undefined;
    }
    let parentTracePath: string | undefined = resolvedInitialParent;
    let parentCurrentFilePath = parentTracePath;
    const seen = new Set<string>(currentFilePath ? [path.resolve(currentFilePath)] : []);
    for (let depth = 0; depth < 6; depth += 1) {
      if (!parentTracePath) {
        break;
      }
      const normalizedParentPath = path.resolve(parentTracePath);
      if (seen.has(normalizedParentPath)) {
        break;
      }
      seen.add(normalizedParentPath);
      const parentRead = await readParsedTraceableEvidenceFromFileWithRetry(normalizedParentPath).catch(() => undefined);
      if (!parentRead?.markdown) {
        break;
      }
      const parentParsed = parentRead.parsed;
      if (!parentParsed) {
        break;
      }
      entries.unshift({
        filePath: normalizedParentPath,
        title: path.basename(normalizedParentPath),
        occurredAt: parentParsed.snapshot.updatedAt,
        startedAt: parentParsed.snapshot.startedAt,
        updatedAt: parentParsed.snapshot.updatedAt,
        finalSummary: parentParsed.result?.finalSummary ?? parentParsed.snapshot.resultSummary?.finalSummary,
        completionClaim: typeof parentParsed.result?.completionClaim === "string" ? parentParsed.result.completionClaim : undefined,
        status: parentParsed.snapshot.status,
        header: parentParsed.snapshot.header,
        evidenceFile: parentParsed.snapshot.evidenceFile,
        requestSummary: parentParsed.snapshot.requestSummary,
        statusHistory: parentParsed.snapshot.statusHistory,
        recentTools: parentParsed.snapshot.recentTools,
        timingSummary: parentParsed.snapshot.timingSummary,
        resultSummary: parentParsed.snapshot.resultSummary
      });
      parentCurrentFilePath = normalizedParentPath;
      parentTracePath = resolveStoredTraceableReference(parentCurrentFilePath, parentParsed.result?.parentTracePath);
    }
    return entries.length > 0 ? entries : undefined;
  };
  const extractSnapshotParentTracePath = (snapshot: TraceableSubagentDetailSnapshot): string | undefined => {
    for (const item of snapshot.requestSummary) {
      if (item.label.trim().toLowerCase() === "parent trace") {
        const candidate = item.title?.trim() || item.value.trim();
        if (candidate) {
          return candidate;
        }
      }
    }
    return undefined;
  };
  const enrichSnapshotWithLineage = async (
    snapshot: TraceableSubagentDetailSnapshot,
    currentFilePath?: string
  ): Promise<TraceableSubagentDetailSnapshot> => {
    const lineageEntries = await buildTraceableLineageEntriesFromParent(
      extractSnapshotParentTracePath(snapshot),
      currentFilePath ?? snapshot.evidenceFile?.filePath
    );
    return {
      ...snapshot,
      lineageEntries
    };
  };
  const readTraceableEvidenceViewState = async (resolvedUri: vscode.Uri): Promise<{
    sourceDocument: vscode.TextDocument | undefined;
    parsedState: ReturnType<typeof parseTraceableEvidenceStateMarkdown>;
  }> => {
    const panelKey = getTraceableEvidencePanelKey(resolvedUri);
    const sourceDocument = vscode.workspace.textDocuments.find((document) => (
      document.uri.scheme === resolvedUri.scheme
      && getTraceableEvidencePanelKey(document.uri) === panelKey
    ));
    const parsedState = sourceDocument?.isDirty
      ? parseTraceableEvidenceStateMarkdown(sourceDocument.getText())
      : (await readParsedTraceableEvidenceFromFileWithRetry(resolvedUri.fsPath)).parsed;
    if (parsedState) {
      parsedState.snapshot = await enrichSnapshotWithLineage(parsedState.snapshot, resolvedUri.fsPath);
    }
    return { sourceDocument, parsedState };
  };
  const renderTraceableEvidencePanel = async (
    panel: vscode.WebviewPanel,
    resolvedUri: vscode.Uri,
    snapshot: TraceableSubagentDetailSnapshot,
    loadedToolDetailsByCallId: ReadonlyMap<string, TraceableSubagentToolDetail> = new Map()
  ): Promise<void> => {
    const codiconCssHref = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "node_modules", "@vscode", "codicons", "dist", "codicon.css")
    ).toString();
    const chatSenderRoleOptions = await listConfiguredChatSenderRoleOptions(resolvedUri);
    const defaultChatSenderRole = await resolveConfiguredDefaultChatSenderRole(resolvedUri);
    panel.title = path.basename(resolvedUri.fsPath);
    panel.webview.html = renderTraceableSubagentPanelHtml(snapshot, codiconCssHref, {
      pinnedOpen: true,
      hideToolbarControls: true,
      initialChatViewEnabled: traceableEvidencePanelInitialChatViewByKey.get(getTraceableEvidencePanelKey(resolvedUri)) === true,
      chatSenderRoleOptions,
      defaultChatSenderRole,
      loadedToolDetailsByCallId
    });
  };

  const postChatSubmitRejected = async (webview: vscode.Webview | undefined): Promise<void> => {
    await webview?.postMessage({ type: "chatSubmitState", pending: false });
  };

  const acquireTraceableRunLease = async (label: string, rejectIfBusy = false): Promise<MutexLease> => {
    if (rejectIfBusy && traceableSubagentToolMutex.isLocked()) {
      throw new Error(TRACEABLE_BUSY_MESSAGE);
    }
    return traceableSubagentToolMutex.acquire(label);
  };
  const buildPersistedToolDetail = (
    snapshot: TraceableSubagentDetailSnapshot,
    result: ParsedTraceableEvidenceState["result"],
    callId: string
  ): TraceableSubagentToolDetail | undefined => {
    const matchingCall = result?.toolCalls.find((entry) => entry.callId === callId);
    if (!matchingCall?.output) {
      return undefined;
    }
    const matchingEvent = snapshot.recentTools.find((entry) => entry.callId === callId);
    const phase = matchingEvent?.phase
      ?? (matchingCall.result === "success"
        ? "success"
        : matchingCall.result === "notRun"
          ? "deferred"
          : "failure");
    return {
      callId,
      toolName: matchingEvent?.toolName ?? matchingCall.toolName,
      phase,
      input: matchingEvent?.input,
      note: matchingEvent?.note ?? matchingCall.note,
      outputKind: matchingCall.output.kind,
      outputSummary: matchingCall.output.summary,
      outputMetadataSummary: matchingCall.output.metadataSummary,
      rawOutput: matchingCall.output.rawText,
      rawOutputTruncated: matchingCall.output.rawTextTruncated,
      partKinds: matchingCall.output.partKinds ?? []
    };
  };
  const buildPersistedToolDetailMap = (
    snapshot: TraceableSubagentDetailSnapshot,
    result: ParsedTraceableEvidenceState["result"],
    existing: ReadonlyMap<string, TraceableSubagentToolDetail> = new Map()
  ): Map<string, TraceableSubagentToolDetail> => {
    const merged = new Map(existing);
    for (const entry of result?.toolCalls ?? []) {
      if (merged.has(entry.callId)) {
        continue;
      }
      const detail = buildPersistedToolDetail(snapshot, result, entry.callId);
      if (detail) {
        merged.set(entry.callId, detail);
      }
    }
    return merged;
  };
  const buildUnavailableToolDetail = (
    snapshot: TraceableSubagentDetailSnapshot,
    callId: string
  ): TraceableSubagentToolDetail => {
    const matchingEvent = snapshot.recentTools.find((entry) => entry.callId === callId);
    return {
      callId,
      toolName: matchingEvent?.toolName ?? "tool",
      phase: matchingEvent?.phase ?? "failure",
      input: matchingEvent?.input,
      note: matchingEvent?.note,
      outputSummary: matchingEvent?.phase === "running"
        ? "This tool call is still running."
        : "This evidence file does not contain persisted tool output for this call.",
      partKinds: []
    };
  };
  const tryBuildRehydratedReadToolDetail = async (
    snapshot: TraceableSubagentDetailSnapshot,
    callId: string
  ): Promise<TraceableSubagentToolDetail | undefined> => {
    const matchingEvent = snapshot.recentTools.find((entry) => entry.callId === callId);
    if (!matchingEvent) {
      return undefined;
    }
    const normalizedToolName = matchingEvent.toolName.trim();
    if (normalizedToolName !== "copilot_readFile" && normalizedToolName !== "read_file") {
      return undefined;
    }
    const matchingInput = matchingEvent.input;
    const filePath = typeof matchingInput?.filePath === "string" ? matchingInput.filePath.trim() : "";
    const rawStartLine = typeof matchingInput?.startLine === "number" ? matchingInput.startLine : undefined;
    const rawEndLine = typeof matchingInput?.endLine === "number" ? matchingInput.endLine : undefined;
    if (
      !filePath
      || rawStartLine === undefined
      || rawEndLine === undefined
      || !Number.isInteger(rawStartLine)
      || !Number.isInteger(rawEndLine)
      || rawStartLine < 1
      || rawEndLine < rawStartLine
    ) {
      return undefined;
    }
    const startLine = rawStartLine;
    const endLine = rawEndLine;
    try {
      const markdown = await fs.readFile(filePath, "utf8");
      const lines = markdown.split(/\r?\n/);
      const rawOutput = lines.slice(startLine - 1, endLine).join("\n").trimEnd();
      return {
        callId,
        toolName: matchingEvent.toolName,
        phase: matchingEvent.phase,
        input: matchingEvent.input,
        note: matchingEvent.note,
        outputKind: "text",
        outputSummary: rawOutput
          ? rawOutput.replace(/\s+/g, " ").trim().slice(0, 280)
          : "Read output rehydrated from the current workspace file.",
        rawOutput,
        rawOutputTruncated: false,
        partKinds: ["text"]
      };
    } catch {
      return {
        callId,
        toolName: matchingEvent.toolName,
        phase: matchingEvent.phase,
        input: matchingEvent.input,
        note: matchingEvent.note,
        outputKind: "text",
        outputSummary: "Could not rehydrate read output from the current workspace file.",
        partKinds: ["text"]
      };
    }
  };
  const renderTraceableEvidenceErrorPanel = (panel: vscode.WebviewPanel, resolvedUri: vscode.Uri, message: string): void => {
    panel.title = path.basename(resolvedUri.fsPath);
    panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    :root {
      color-scheme: dark;
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --muted: var(--vscode-descriptionForeground);
      --border: var(--vscode-panel-border);
      --error: var(--vscode-errorForeground);
    }
    body {
      margin: 0;
      padding: 20px;
      background: var(--bg);
      color: var(--fg);
      font-family: var(--vscode-font-family);
    }
    .traceable-error {
      border: 1px solid color-mix(in srgb, var(--error) 48%, var(--border));
      border-radius: 10px;
      padding: 16px;
      background: color-mix(in srgb, var(--error) 10%, transparent);
    }
    .traceable-error-title {
      font-weight: 700;
      margin-bottom: 8px;
    }
    .traceable-error-copy {
      color: var(--muted);
      line-height: 1.45;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <div class="traceable-error">
    <div class="traceable-error-title">TRACEABLE evidence view unavailable</div>
    <div class="traceable-error-copy">${message.replace(/[&<>]/g, (value) => value === "&" ? "&amp;" : value === "<" ? "&lt;" : "&gt;")}</div>
  </div>
</body>
</html>`;
  };
  const refreshTraceableEvidencePanel = async (panelKey: string, resolvedUri: vscode.Uri, panel: vscode.WebviewPanel): Promise<boolean> => {
    const latestState = await readTraceableEvidenceViewState(resolvedUri);
    if (traceableEvidencePanels.get(panelKey) !== panel) {
      return false;
    }
    if (!latestState.parsedState) {
      renderTraceableEvidenceErrorPanel(panel, resolvedUri, "This TRACEABLE evidence file does not contain a readable Traceable State block.");
      return true;
    }
    const mergedLoadedDetails = buildPersistedToolDetailMap(
      latestState.parsedState.snapshot,
      latestState.parsedState.result,
      traceableEvidenceLoadedToolDetails.get(panelKey) ?? new Map()
    );
    traceableEvidenceLoadedToolDetails.set(panelKey, mergedLoadedDetails);
    await renderTraceableEvidencePanel(
      panel,
      resolvedUri,
      latestState.parsedState.snapshot,
      mergedLoadedDetails
    );
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
    if (!sourceUri || !traceableEvidencePanels.get(panelKey)) {
      void vscode.window.showWarningMessage("The active TRACEABLE evidence view is no longer available.");
      return;
    }
    if (isActiveTabForResource(sourceUri)) {
      await vscode.commands.executeCommand("reopenActiveEditorWith", "default");
      return;
    }
    await vscode.commands.executeCommand("vscode.openWith", sourceUri, "default", {
      preview: false,
      preserveFocus: false
    });
  };
  const reopenTraceableEvidencePreview = async (): Promise<void> => {
    const panelKey = activeTraceableEvidencePanelKey;
    if (!panelKey) {
      void vscode.window.showWarningMessage("Open a TRACEABLE evidence view first.");
      return;
    }
    const sourceUri = traceableEvidencePanelSources.get(panelKey);
    if (!sourceUri || !traceableEvidencePanels.get(panelKey)) {
      void vscode.window.showWarningMessage("The active TRACEABLE evidence view is no longer available.");
      return;
    }
    if (isActiveTabForResource(sourceUri)) {
      try {
        await vscode.commands.executeCommand("reopenActiveEditorWith", "vscode.markdown.preview.editor");
      } catch {
        await vscode.commands.executeCommand("markdown.reopenAsPreview");
      }
      return;
    }
    await openMarkdownPreviewLikeSource(sourceUri);
  };
  const openTraceableFile = async (
    filePath: string | TraceableResolvedPathTarget,
    startLine?: number,
    endLine?: number,
    baseDir?: string
  ): Promise<void> => {
    let normalizedPath: string;
    try {
      normalizedPath = await resolveTraceableOpenPath(filePath, baseDir);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not resolve the selected path.";
      void vscode.window.showWarningMessage(message);
      return;
    }
    const workspaceFolders = getTraceableOpenWorkspaceFolders();
    const withinWorkspaceRoot = isPathWithinAnyWorkspaceRoot(normalizedPath, workspaceFolders);
    const targetUri = vscode.Uri.file(normalizedPath);
    try {
      const targetStat = await fs.stat(normalizedPath);
      if (targetStat.isDirectory()) {
        if (!withinWorkspaceRoot) {
          await vscode.commands.executeCommand("revealFileInOS", targetUri);
          return;
        }
        await vscode.commands.executeCommand("workbench.view.explorer");
        await vscode.commands.executeCommand("revealInExplorer", targetUri);
        return;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
        const workspaceRootFallback = getUniqueWorkspaceFolderMatchByName(path.basename(normalizedPath), workspaceFolders);
        if (workspaceRootFallback) {
          await vscode.commands.executeCommand("workbench.view.explorer");
          await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(workspaceRootFallback));
          return;
        }
        void vscode.window.showWarningMessage(`The selected path no longer exists: ${normalizedPath}`);
        return;
      }
      // Fall through to the existing open flow so other file-system errors keep the previous behavior.
    }
    if (!withinWorkspaceRoot) {
      await vscode.commands.executeCommand("revealFileInOS", targetUri);
      return;
    }
    if (/\.trace\.md$/iu.test(normalizedPath) && !Number.isInteger(startLine) && !Number.isInteger(endLine)) {
      switch (getTraceableEvidenceOpenTarget()) {
        case "source":
          await vscode.commands.executeCommand("vscode.open", targetUri, {
            preview: false,
            preserveFocus: false
          });
          return;
        case "markdown":
          await openMarkdownPreviewLikeSource(targetUri);
          return;
        case "traceable":
        default:
          await openTraceableEvidenceEditor(targetUri);
          return;
      }
    }
    if (/\.md$/iu.test(normalizedPath) && !Number.isInteger(startLine) && !Number.isInteger(endLine)) {
      const document = await vscode.workspace.openTextDocument(targetUri);
      await vscode.window.showTextDocument(document, {
        preview: false,
        preserveFocus: false
      });
      return;
    }
    const targetLine = Number.isInteger(startLine) ? Math.max(0, (startLine ?? 1) - 1) : 0;
    const targetEndLine = Number.isInteger(endLine) ? Math.max(targetLine, (endLine ?? startLine ?? 1) - 1) : targetLine;
    const document = await vscode.workspace.openTextDocument(targetUri);
    await vscode.window.showTextDocument(document, {
      preview: false,
      preserveFocus: false,
      selection: new vscode.Range(targetLine, 0, targetEndLine, 0)
    });
  };
  const openTraceableEvidenceEditor = async (
    target?: vscode.Uri | string,
    options: { initialChatViewEnabled?: boolean; applyConfiguredDefaultView?: boolean } = {}
  ): Promise<void> => {
    const resolvedUri = await resolveActiveTraceableEvidenceUri(target);
    if (!resolvedUri || resolvedUri.scheme !== "file" || !resolvedUri.fsPath.toLowerCase().endsWith(".trace.md")) {
      void vscode.window.showWarningMessage("Open a .trace.md evidence file first, or pass one explicitly.");
      return;
    }
    const panelKey = getTraceableEvidencePanelKey(resolvedUri);
    traceableEvidenceProgrammaticOpenByKey.add(panelKey);
    const initialView = options.initialChatViewEnabled === true
      ? "chat"
      : options.initialChatViewEnabled === false
        ? "detailed"
        : options.applyConfiguredDefaultView !== false && getConfiguredTraceableDefaultView(resolvedUri) === "chat"
          ? "chat"
          : "detailed";
    if (initialView === "chat") {
      traceableEvidencePanelInitialChatViewByKey.set(panelKey, true);
    } else {
      traceableEvidencePanelInitialChatViewByKey.delete(panelKey);
    }
    const { sourceDocument } = await readTraceableEvidenceViewState(resolvedUri);
    const tabsToReplace = getRelatedTraceableTabsToReplace(resolvedUri);
    if (isActiveTabForResource(resolvedUri)) {
      await vscode.commands.executeCommand("reopenActiveEditorWith", TRACEABLE_EVIDENCE_EDITOR_VIEW_TYPE);
      return;
    }
    await vscode.commands.executeCommand("vscode.openWith", resolvedUri, TRACEABLE_EVIDENCE_EDITOR_VIEW_TYPE, {
      preview: false,
      preserveFocus: false
    });
    if (tabsToReplace.length > 0 && !sourceDocument?.isDirty) {
      await vscode.window.tabGroups.close(tabsToReplace, false);
    }
  };
  const resolveTraceableEvidenceCustomEditor = async (document: { uri: vscode.Uri }, panel: vscode.WebviewPanel): Promise<void> => {
    const resolvedUri = document.uri;
    if (!resolvedUri.fsPath.toLowerCase().endsWith(".trace.md")) {
      const narrowedAssociation = await narrowTraceableMarkdownEditorAssociation(resolvedUri).catch(() => false);
      void vscode.window.showInformationMessage(
        narrowedAssociation
          ? "TRACEABLE Evidence is only for .trace.md files. Narrowed the editor association from *.md to *.trace.md and reopened this markdown file with the default editor."
          : "TRACEABLE Evidence is only for .trace.md files. Reopening this markdown file with the default editor."
      );
      await vscode.commands.executeCommand("vscode.openWith", resolvedUri, "default", {
        preview: false,
        preserveFocus: false
      });
      panel.dispose();
      return;
    }
    const panelKey = getTraceableEvidencePanelKey(resolvedUri);
    const openedProgrammatically = traceableEvidenceProgrammaticOpenByKey.delete(panelKey);
    if (!openedProgrammatically && getConfiguredTraceableDefaultView(resolvedUri) === "chat") {
      traceableEvidencePanelInitialChatViewByKey.set(panelKey, true);
    }
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "node_modules", "@vscode", "codicons", "dist")]
    };
    traceableEvidencePanels.set(panelKey, panel);
    traceableEvidencePanelSources.set(panelKey, resolvedUri);
    traceableEvidenceLoadedToolDetails.set(panelKey, new Map());
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
        void flushRefresh();
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
      traceableEvidenceLoadedToolDetails.delete(panelKey);
      traceableEvidencePanelInitialChatViewByKey.delete(panelKey);
      if (activeTraceableEvidencePanelKey === panelKey) {
        activeTraceableEvidencePanelKey = undefined;
      }
    });
    panel.webview.onDidReceiveMessage(async (message) => {
      if (!message || typeof message.type !== "string") {
        return;
      }
      if (message.type === "submitChatTurn" && typeof message.prompt === "string") {
        try {
          await continueTraceableChatFromEvidenceEditor(
            panel,
            resolvedUri,
            message.prompt,
            typeof message.parentRoles === "string" || Array.isArray(message.parentRoles)
              ? message.parentRoles
              : undefined
          );
        } catch (error) {
          await postChatSubmitRejected(panel.webview);
          const detail = error instanceof Error ? error.message : "TRACEABLE continuation could not be started.";
          void vscode.window.showWarningMessage(detail);
        }
        return;
      }
      if (message.type === "openFile") {
        const startLine = typeof message.startLine === "number" ? message.startLine : undefined;
        const endLine = typeof message.endLine === "number" ? message.endLine : undefined;
        if (isTraceableResolvedPathTarget(message.target)) {
          await openTraceableFile(message.target, startLine, endLine);
          return;
        }
        if (typeof message.filePath !== "string") {
          return;
        }
        const baseDir = typeof message.baseDir === "string" ? message.baseDir : undefined;
        await openTraceableFile(message.filePath, startLine, endLine, baseDir);
        return;
      }
      if (message.type === "loadToolDetail" && typeof message.callId === "string") {
        const callId = message.callId.trim();
        if (!callId) {
          return;
        }
        const parsedState = (await readTraceableEvidenceViewState(resolvedUri)).parsedState;
        const initialSnapshot = parsedState?.snapshot;
        if (!initialSnapshot || !parsedState) {
          return;
        }
        const loadedDetails = buildPersistedToolDetailMap(
          initialSnapshot,
          parsedState.result,
          traceableEvidenceLoadedToolDetails.get(panelKey) ?? new Map<string, TraceableSubagentToolDetail>()
        );
        const detail = buildPersistedToolDetail(initialSnapshot, parsedState.result, callId)
          ?? traceableStatusBar.getObservedToolDetail(callId)
          ?? await tryBuildRehydratedReadToolDetail(initialSnapshot, callId)
          ?? buildUnavailableToolDetail(initialSnapshot, callId);
        loadedDetails.set(callId, detail);
        traceableEvidenceLoadedToolDetails.set(panelKey, loadedDetails);
        await renderTraceableEvidencePanel(panel, resolvedUri, initialSnapshot, loadedDetails);
      }
    });
    const initialState = await readTraceableEvidenceViewState(resolvedUri);
    if (!initialState.parsedState) {
      renderTraceableEvidenceErrorPanel(panel, resolvedUri, "This TRACEABLE evidence file does not contain a readable Traceable State block.");
      return;
    }
    const initialLoadedToolDetails = buildPersistedToolDetailMap(
      initialState.parsedState.snapshot,
      initialState.parsedState.result,
      traceableEvidenceLoadedToolDetails.get(panelKey) ?? new Map()
    );
    traceableEvidenceLoadedToolDetails.set(panelKey, initialLoadedToolDetails);
    await renderTraceableEvidencePanel(
      panel,
      resolvedUri,
      initialState.parsedState.snapshot,
      initialLoadedToolDetails
    );
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
    traceablePanelMaximizedByEditorContinuation = false;
    traceablePanelRestoreCommand = undefined;
  };

  const revealAndMaximizeTraceablePanelForEditorContinuation = async (): Promise<void> => {
    await revealTraceablePanel("auto");
    if (traceablePanelMaximizedByEditorContinuation) {
      return;
    }
    try {
      await vscode.commands.executeCommand(TOGGLE_MAXIMIZED_PANEL_COMMAND);
      traceablePanelMaximizedByEditorContinuation = true;
    } catch {
      // Best effort only.
    }
  };

  const continueTraceableChatFromEvidenceEditor = async (
    panel: vscode.WebviewPanel,
    resolvedUri: vscode.Uri,
    userInput: string,
    parentRoles?: string | string[]
  ): Promise<void> => {
    const prompt = userInput.trim();
    if (!prompt) {
      return;
    }
    const revealMode = getTraceableAutoRevealMode();
    const revealToPanel = revealMode === "yes" || revealMode === "always";
    const requestedInput: TraceableSubagentInput = {
      parentTracePath: resolvedUri.fsPath,
      userInput: prompt,
      parentRoles,
      inputMode: "DIRECT",
      reveal: false,
      exportToFolder: path.dirname(resolvedUri.fsPath)
    };
    const lease = await acquireTraceableRunLease("Traceable Evidence Chat Turn", true);
    try {
      const prepared = await prepareTraceableRunExecution(requestedInput);
      await prepared.beforeRun();
      const pendingEvidenceFilePath = traceableEvidence.getSnapshot().evidenceFile?.filePath?.trim();
      if (revealToPanel) {
        await revealAndMaximizeTraceablePanelForEditorContinuation();
        panel.dispose();
      } else if (pendingEvidenceFilePath) {
        await openTraceableEvidenceEditor(pendingEvidenceFilePath, { initialChatViewEnabled: true });
        panel.dispose();
      }
      const cancelSource = new vscode.CancellationTokenSource();
      const activeRunState = {
        cancelSource,
        stopSource: "unknown" as "traceable-panel" | "host-cancel" | "unknown",
        stopRequestedAt: undefined as string | undefined
      };
      activeTraceableRun = activeRunState;
      try {
        const result = await runTraceableSubagent(requestedInput, {
          accessInformation: context.languageModelAccessInformation,
          debugLogDir: context.globalStorageUri.fsPath,
          preparedInput: prepared.preparedInput,
          token: cancelSource.token,
          statusReporter: prepared.statusReporter,
          getStopSource: () => activeRunState.stopSource,
          getStopRequestedAt: () => activeRunState.stopRequestedAt
        });
        const finalizedResult = await prepared.afterRun(result);
        output.appendLine("Traceable Evidence Chat Turn: completed.");
        const finalizedEvidenceFilePath = finalizedResult.evidenceFile?.filePath?.trim();
        if (!revealToPanel && pendingEvidenceFilePath && finalizedEvidenceFilePath && finalizedEvidenceFilePath !== pendingEvidenceFilePath) {
          traceableEvidencePanels.get(getTraceableEvidencePanelKey(vscode.Uri.file(pendingEvidenceFilePath)))?.dispose();
          await openTraceableEvidenceEditor(finalizedEvidenceFilePath, { initialChatViewEnabled: true });
        }
        if (!revealToPanel && !pendingEvidenceFilePath) {
          if (finalizedResult.evidenceFile?.filePath) {
            await openTraceableEvidenceEditor(finalizedResult.evidenceFile.filePath, { initialChatViewEnabled: true });
          } else {
            await openTraceableCommandResult(finalizedResult);
          }
          panel.dispose();
        }
      } finally {
        if (activeTraceableRun === activeRunState) {
          activeTraceableRun = undefined;
        }
        cancelSource.dispose();
      }
    } finally {
      lease.release();
    }
  };
  const traceableStatusPanel = new TraceableSubagentStatusPanelProvider(
    context.extensionUri,
    async () => {
      const exportedState = await traceableEvidence.exportCurrentSnapshotViaDialog();
      if (exportedState?.filePath && activeUnsavedTraceableAgentChatKey) {
        unsavedTraceableAgentChatState.delete(activeUnsavedTraceableAgentChatKey);
        activeUnsavedTraceableAgentChatKey = undefined;
      }
      const snapshot = await enrichSnapshotWithLineage(traceableEvidence.getSnapshot());
      traceableStatusDetail.update(snapshot);
      traceableStatusPanel.update(snapshot);
    },
    openTraceableFile,
    async ({ parentTracePath, userInput, parentRoles }) => {
      try {
        await runTraceableSubagentFromCommand({
          parentTracePath,
          userInput,
          parentRoles,
          inputMode: "DIRECT",
          reveal: true,
          exportToFolder: path.dirname(parentTracePath)
        }, "Traceable Panel Chat Turn", { openResult: false, rejectIfBusy: true });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "TRACEABLE continuation could not be started.";
        void vscode.window.showWarningMessage(detail);
        throw error;
      }
    },
    (snapshot) => {
      const evidenceFilePath = snapshot.evidenceFile?.filePath?.trim();
      const resource = evidenceFilePath ? vscode.Uri.file(evidenceFilePath) : undefined;
      return getConfiguredTraceableDefaultView(resource) === "chat";
    },
    async () => listConfiguredChatSenderRoleOptions(),
    async () => resolveConfiguredDefaultChatSenderRole(),
    async (callId) => traceableStatusBar.getObservedToolDetail(callId),
    async () => {
      if (!activeTraceableRun || activeTraceableRun.cancelSource.token.isCancellationRequested) {
        void vscode.window.showInformationMessage("No active TRACEABLE run is currently available to stop.");
        return;
      }
      activeTraceableRun.stopSource = "traceable-panel";
      activeTraceableRun.stopRequestedAt = new Date().toISOString();
      activeTraceableRun.cancelSource.cancel();
      output.appendLine(`TRACEABLE stop requested from panel at ${activeTraceableRun.stopRequestedAt}`);
    },
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
      void (async () => {
        const lineageEnrichedSnapshot = await enrichSnapshotWithLineage(enrichedSnapshot);
        traceableStatusDetail.update(lineageEnrichedSnapshot);
        traceableStatusPanel.update(lineageEnrichedSnapshot);
      })();
    }
  });

  type NewTraceableChatResolvedTarget =
    | { kind: "agent"; uri: vscode.Uri }
    | { kind: "folder"; uri: vscode.Uri; folderPath: string }
    | { kind: "trace"; uri: vscode.Uri; filePath: string };

  const prepareTraceableRunExecution = async (requestedInput: TraceableSubagentInput) => {
    const preparedInput = await prepareTraceableSubagentInput(requestedInput);
    const effectiveInput = preparedInput.input;
    if (shouldAutoRevealTraceablePanel(effectiveInput.reveal)) {
      void (async () => {
        await revealTraceablePanel("auto");
      })();
    }
    const reporter = traceableStatusBar.startRun({
      agentName: effectiveInput.agentRole?.name
    });
    reporter.setRequestSummary?.(buildTraceableRequestSummary(effectiveInput, requestedInput));
    return {
      preparedInput,
      statusReporter: reporter,
      beforeRun: async () => {
        await traceableEvidence.prepareRequestedExport(effectiveInput);
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
  };

  const executePreparedTraceableRun = async (
    requestedInput: TraceableSubagentInput,
    runHooks: Awaited<ReturnType<typeof prepareTraceableRunExecution>>,
    token?: vscode.CancellationToken
  ): Promise<TraceableSubagentRunResult> => {
    await runHooks.beforeRun();
    const cancelSource = new vscode.CancellationTokenSource();
    const activeRunState = {
      cancelSource,
      stopSource: "unknown" as "traceable-panel" | "host-cancel" | "unknown",
      stopRequestedAt: undefined as string | undefined
    };
    activeTraceableRun = activeRunState;
    const hostCancellationSubscription = token?.onCancellationRequested(() => {
      if (!cancelSource.token.isCancellationRequested) {
        activeRunState.stopSource = activeRunState.stopSource === "traceable-panel" ? "traceable-panel" : "host-cancel";
        activeRunState.stopRequestedAt ??= new Date().toISOString();
        cancelSource.cancel();
      }
    }) ?? { dispose() {} };
    try {
      const result = await runTraceableSubagent(requestedInput, {
        accessInformation: context.languageModelAccessInformation,
        debugLogDir: context.globalStorageUri.fsPath,
        preparedInput: runHooks.preparedInput,
        token: cancelSource.token,
        statusReporter: runHooks.statusReporter,
        getStopSource: () => activeRunState.stopSource,
        getStopRequestedAt: () => activeRunState.stopRequestedAt
      });
      return await runHooks.afterRun(result);
    } finally {
      hostCancellationSubscription.dispose();
      if (activeTraceableRun === activeRunState) {
        activeTraceableRun = undefined;
      }
      cancelSource.dispose();
    }
  };

  const openTraceableCommandResult = async (result: TraceableSubagentRunResult): Promise<void> => {
    if (result.evidenceFile?.filePath) {
      await openTraceableEvidenceEditor(result.evidenceFile.filePath, { applyConfiguredDefaultView: false });
      return;
    }
    const document = await vscode.workspace.openTextDocument({
      language: "markdown",
      content: renderTraceableSubagentMarkdown(result)
    });
    await vscode.window.showTextDocument(document, { preview: false });
  };

  const resolveNewTraceableChatTarget = async (target?: vscode.Uri): Promise<NewTraceableChatResolvedTarget | undefined> => {
    const candidate = target ?? vscode.window.activeTextEditor?.document.uri;
    if (!candidate || candidate.scheme !== "file") {
      void vscode.window.showErrorMessage("Invoke New Traceable Chat from a .agent.md file, a .trace.md file, or a folder in the Explorer.");
      return undefined;
    }
    if (/\.trace\.md$/iu.test(candidate.fsPath)) {
      return { kind: "trace", uri: candidate, filePath: candidate.fsPath };
    }
    if (/\.agent\.md$/iu.test(candidate.fsPath)) {
      return { kind: "agent", uri: candidate };
    }
    try {
      const stat = await fs.stat(candidate.fsPath);
      if (stat.isDirectory()) {
        return { kind: "folder", uri: candidate, folderPath: candidate.fsPath };
      }
    } catch {
      // Fall through to the user-facing error below.
    }
    void vscode.window.showErrorMessage("New Traceable Chat currently supports .agent.md files, .trace.md files, and folders only.");
    return undefined;
  };

  const promptForTraceableAgentRoleSelection = async (): Promise<{ name: string; filePath: string } | undefined> => {
    const entries = await listTraceableAgentCatalogEntries();
    if (entries.length === 0) {
      void vscode.window.showErrorMessage("No traceable agent roles are currently available in the open workspace.");
      return undefined;
    }
    const picked = await vscode.window.showQuickPick(
      entries.map((entry) => ({
        label: entry.displayName,
        description: entry.workspaceFolderName,
        detail: entry.filePath,
        agentName: entry.displayName,
        agentFilePath: entry.filePath
      })),
      {
        title: "New Traceable Chat",
        placeHolder: "Choose which traceable agent role to chat with"
      }
    );
    return picked
      ? { name: picked.agentName, filePath: picked.agentFilePath }
      : undefined;
  };

  const promptForFirstTraceableMessage = async (): Promise<string | undefined> => {
    const value = await vscode.window.showInputBox({
      title: "New Traceable Chat",
      prompt: "Enter the first user message for this traceable chat",
      placeHolder: "Type the first message that should start the traceable lane",
      validateInput: (candidate) => candidate.trim() ? undefined : "A first message is required to start a traceable chat."
    });
    return value?.trim() || undefined;
  };

  const promptForChatSenderRoleSelection = async (resource?: vscode.Uri): Promise<string | undefined> => {
    const availableRoles = await listConfiguredChatSenderRoleOptions(resource);
    const picked = await vscode.window.showQuickPick(
      [
        {
          label: "No sender role",
          description: "Leave the sender empty",
          senderRole: ""
        },
        ...availableRoles.map((roleOption) => ({
          label: roleOption.label,
          description: roleOption.value !== roleOption.label ? roleOption.value : undefined,
          senderRole: roleOption.value
        }))
      ],
      {
        title: "New Traceable Chat",
        placeHolder: "Optional: choose which sender role is behind the opening message"
      }
    );
    if (!picked) {
      return undefined;
    }
    return picked.senderRole || "";
  };

  const promptForAgentEntryExportFolder = async (resource: vscode.Uri): Promise<string | null | undefined> => {
    const configuredFolder = resolveConfiguredNewTraceableChatExportFolder(resource);
    if (configuredFolder) {
      return configuredFolder;
    }
    const selectedFolder = await traceableEvidence.pickExportFolderViaDialog();
    return selectedFolder || null;
  };

  const runTraceableSubagentFromCommand = async (
    requestedInput: TraceableSubagentInput,
    logLabel: string,
    options: { openResult?: boolean; rejectIfBusy?: boolean } = {}
  ): Promise<TraceableSubagentRunResult> => {
    const lease = await acquireTraceableRunLease(logLabel, options.rejectIfBusy !== false);
    try {
      const prepared = await prepareTraceableRunExecution(requestedInput);
      const result = await executePreparedTraceableRun(requestedInput, prepared);
      if (options.openResult !== false) {
        await openTraceableCommandResult(result);
      }
      output.appendLine(`${logLabel}: completed.`);
      return result;
    } finally {
      lease.release();
    }
  };

  const startNewTraceableChat = async (target?: vscode.Uri): Promise<void> => {
    const resolvedTarget = await resolveNewTraceableChatTarget(target);
    if (!resolvedTarget) {
      return;
    }
    if (resolvedTarget.kind === "folder") {
      const selectedRole = await promptForTraceableAgentRoleSelection();
      if (!selectedRole) {
        return;
      }
      const firstMessage = await promptForFirstTraceableMessage();
      if (!firstMessage) {
        return;
      }
      const senderRole = await promptForChatSenderRoleSelection(resolvedTarget.uri);
      if (senderRole === undefined) {
        return;
      }
      await runTraceableSubagentFromCommand({
        agentRole: {
          name: selectedRole.name,
          filePath: selectedRole.filePath
        },
        userInput: firstMessage,
        ...(senderRole ? { parentRoles: senderRole } : {}),
        inputMode: "DIRECT",
        reveal: true,
        exportToFolder: resolvedTarget.folderPath
      }, "New Traceable Chat (folder)", { openResult: false });
      return;
    }
    if (resolvedTarget.kind === "trace") {
      const firstMessage = await promptForFirstTraceableMessage();
      if (!firstMessage) {
        return;
      }
      const senderRole = await promptForChatSenderRoleSelection(resolvedTarget.uri);
      if (senderRole === undefined) {
        return;
      }
      await runTraceableSubagentFromCommand({
        parentTracePath: resolvedTarget.filePath,
        userInput: firstMessage,
        ...(senderRole ? { parentRoles: senderRole } : {}),
        inputMode: "DIRECT",
        reveal: true,
        exportToFolder: path.dirname(resolvedTarget.filePath)
      }, "New Traceable Chat (continuation)", { openResult: false });
      return;
    }
    const existingUnsavedState = unsavedTraceableAgentChatState.get(resolvedTarget.uri.fsPath);
    const exportFolder = existingUnsavedState
      ? null
      : await promptForAgentEntryExportFolder(resolvedTarget.uri);
    if (exportFolder === undefined) {
      return;
    }
    const firstMessage = await promptForFirstTraceableMessage();
    if (!firstMessage) {
      return;
    }
    const senderRole = await promptForChatSenderRoleSelection(resolvedTarget.uri);
    if (senderRole === undefined) {
      return;
    }
    const result = await runTraceableSubagentFromCommand({
      agentRole: {
        name: path.basename(resolvedTarget.uri.fsPath).replace(/\.agent\.md$/iu, "") || path.basename(resolvedTarget.uri.fsPath),
        filePath: resolvedTarget.uri.fsPath
      },
      userInput: firstMessage,
      ...(senderRole ? { parentRoles: senderRole } : {}),
      inputMode: "DIRECT",
      reveal: true,
      ...(existingUnsavedState?.priorTurnsSummary
        ? {
          carriedContext: {
            priorTurnsSummary: existingUnsavedState.priorTurnsSummary
          }
        }
        : {}),
      ...(existingUnsavedState?.activeCarryForward
        ? {
          activeCarryForward: existingUnsavedState.activeCarryForward
        }
        : {}),
      ...(exportFolder ? { exportToFolder: exportFolder } : {})
    }, "New Traceable Chat (agent)", { openResult: false });
    if (result.evidenceFile?.filePath) {
      unsavedTraceableAgentChatState.delete(resolvedTarget.uri.fsPath);
      if (activeUnsavedTraceableAgentChatKey === resolvedTarget.uri.fsPath) {
        activeUnsavedTraceableAgentChatKey = undefined;
      }
      return;
    }
    unsavedTraceableAgentChatState.set(resolvedTarget.uri.fsPath, {
      priorTurnsSummary: result.finalSummary?.trim() || undefined,
      activeCarryForward: result.activeCarryForward
    });
    activeUnsavedTraceableAgentChatKey = resolvedTarget.uri.fsPath;
  };

  const setDefaultNewTraceableChatExportFolder = async (target?: vscode.Uri): Promise<void> => {
    const candidate = target;
    if (!candidate || candidate.scheme !== "file") {
      void vscode.window.showErrorMessage("Invoke Set Default New Traceable Chat Export Folder from a folder in the Explorer.");
      return;
    }
    let stat;
    try {
      stat = await fs.stat(candidate.fsPath);
    } catch {
      void vscode.window.showErrorMessage("The selected export target folder could not be read.");
      return;
    }
    if (!stat.isDirectory()) {
      void vscode.window.showErrorMessage("Set Default New Traceable Chat Export Folder currently supports folders only.");
      return;
    }
    const settingValue = formatNewTraceableChatExportFolderSettingValue(candidate.fsPath);
    await getProvenanceConfiguration(candidate).update("defaultNewTraceableChatExportTo", settingValue, vscode.ConfigurationTarget.Workspace);
    void vscode.window.showInformationMessage(`Default New Traceable Chat export folder set to ${candidate.fsPath}`);
  };

  context.subscriptions.push(output);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(TRACEABLE_EVIDENCE_EDITOR_VIEW_TYPE, {
      async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
        return {
          uri,
          dispose: () => undefined
        };
      },
      async resolveCustomEditor(document: vscode.CustomDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
        await resolveTraceableEvidenceCustomEditor(document, webviewPanel);
      }
    }, {
      webviewOptions: {
        retainContextWhenHidden: true
      },
      supportsMultipleEditorsPerDocument: false
    }),
    vscode.workspace.registerTextDocumentContentProvider("tiinex-traceable-subagent-status", traceableStatusDetail),
    vscode.commands.registerCommand(OPEN_TRACEABLE_SUBAGENT_STATUS_DETAIL_COMMAND, async () => {
      await revealTraceablePanel("manual");
    }),
    vscode.commands.registerCommand(STOP_TRACEABLE_SUBAGENT_COMMAND, async () => {
      if (!activeTraceableRun || activeTraceableRun.cancelSource.token.isCancellationRequested) {
        void vscode.window.showInformationMessage("No active TRACEABLE run is currently available to stop.");
        return;
      }
      activeTraceableRun.stopSource = "traceable-panel";
      activeTraceableRun.stopRequestedAt = new Date().toISOString();
      activeTraceableRun.cancelSource.cancel();
      output.appendLine(`TRACEABLE stop requested from command at ${activeTraceableRun.stopRequestedAt}`);
    }),
    vscode.commands.registerCommand(OPEN_OVERVIEW_COMMAND, async () => {
      const repoReadme = vscode.Uri.file(path.resolve(context.extensionPath, "..", "..", "README.md"));
      const document = await vscode.workspace.openTextDocument(repoReadme);
      await vscode.window.showTextDocument(document, { preview: false });
      output.appendLine(`Opened provenance overview: ${repoReadme.fsPath}`);
    }),
    vscode.commands.registerCommand(NEW_TRACEABLE_CHAT_COMMAND, async (target?: vscode.Uri) => {
      await startNewTraceableChat(target);
    }),
    vscode.commands.registerCommand(RESUME_TRACEABLE_CHAT_COMMAND, async (target?: vscode.Uri) => {
      await startNewTraceableChat(target);
    }),
    vscode.commands.registerCommand(SET_DEFAULT_NEW_TRACEABLE_CHAT_EXPORT_FOLDER_COMMAND, async (target?: vscode.Uri) => {
      await setDefaultNewTraceableChatExportFolder(target);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(INSPECT_TRACEABLE_EVIDENCE_COMMAND, async (target?: vscode.Uri) => {
      const evidenceUri = resolveTraceableEvidenceUri(target);
      if (!evidenceUri) {
        void vscode.window.showErrorMessage("Open a .trace.md evidence file first, or invoke the command from a .trace.md file.");
        return;
      }
      const { markdown, parsed } = await readParsedTraceableEvidenceFromFileWithRetry(evidenceUri.fsPath);
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
        const { markdown, parsed } = await readParsedTraceableEvidenceFromFileWithRetry(resolvedEvidenceFilePath);
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
        async (input, _budget, preparedState, token) => {
          const runHooks = preparedState as Awaited<ReturnType<typeof prepareTraceableRunExecution>> | undefined;
          const finalResult = runHooks
            ? await executePreparedTraceableRun(input, runHooks, token)
            : await runTraceableSubagent(input, {
              accessInformation: context.languageModelAccessInformation,
              debugLogDir: context.globalStorageUri.fsPath,
              token
            });
          return renderTraceableSubagentMarkdown(finalResult);
        },
        traceableSubagentToolMutex,
        async (input) => prepareTraceableRunExecution(input),
        true
      )
    )
  );
}

export function deactivate(): void {
}