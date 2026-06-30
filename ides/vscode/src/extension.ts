import path from "node:path";
import { execFileSync } from "node:child_process";
import { promises as fs, readFileSync } from "node:fs";
import { get as httpsGet } from "node:https";
import * as vscode from "vscode";
import {
  evaluateParsedTraceableEvidenceLineageIntegrity,
  parseTraceableEvidenceStateMarkdown,
  renderViewTraceableSubagentMarkdown,
  renderTraceableEvidenceSurfaceMarkdown,
  type ParsedTraceableEvidenceState,
  type TraceableEvidenceSurface,
  type ViewTraceableSubagentInput
} from "./traceableEvidence";
import {
  renderShowTracesMarkdown,
  type ShowTracesInput
} from "./traceableShowTraces";
import {
  buildTraceableStructureIndex,
  compareTraceableStructureSchemaEntries,
  type TraceableStructureNode,
  type TraceableStructureSchemaEntry
} from "./traceableStructure";
import {
  getSelectedTraceableStructureSnapshot,
  registerTraceableStructureTreeView
} from "./traceableStructureTreeView";
import {
  formatTraceableModelIdDisplayName,
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
import {
  formatTraceablePathReference,
  getMaximumDepthOutsideOfWorkspaceRootForRelativePaths,
  type TraceableMarkdownPathRenderOptions,
  type TraceableResolvedPathTarget
} from "./traceableContract";
import {
  getUniqueWorkspaceFolderMatchByName,
  isPathWithinAnyWorkspaceRoot,
  resolveDriveLessAbsolutePathOnWindows,
  resolveRelativeOpenPathInWorkspace
} from "./traceableOpenPath.js";
import {
  computeTraceableContinuityChecksumSha256,
  computeTargetedTraceableContinuityChecksumSha256,
  parseTraceableContinuityMarkdown,
  renderTraceableContinuityValidationMarkdown,
  validateTraceableContinuityArtifactChainSync
} from "./traceableContinuityValidation.js";
import { validateTraceableRootSchemaSync, type TraceableSchemaValidationResult } from "./traceableRootSchemaValidation.js";
import { validateTraceableDecisionSchemaSync } from "./traceableDecisionSchemaValidation.js";
import { validateTraceableEvidenceSchemaSync } from "./traceableEvidenceSchemaValidation.js";
import { validateTraceablePointerSchemaSync } from "./traceablePointerSchemaValidation.js";
import { validateTraceableTaskSchemaSync } from "./traceableTaskSchemaValidation.js";
import { validateTraceableTopicSchemaSync } from "./traceableTopicSchemaValidation.js";
import { getTraceableEvidenceFileNameFormatOptions } from "./traceableEvidenceFileNameConfig";
import {
  buildTraceableRenameMoveWorkspaceEdit,
  planTraceableLineageMoveRetainedDescendantRewrites,
  planTraceableStandaloneMoveDependencyRewrites,
  inspectTraceableLineageMoveScopes,
  normalizeTraceableRenameMoveFileSelection,
  planTraceableStandaloneMoveReturnDisplacementMoves,
  planTraceableStandaloneMoveDependencyMoves,
  planTraceableRewriteMove,
  planTraceableRewriteRequestedRename,
  planTraceableRenameMoveOperation,
  rewriteTraceableEvidenceParentConnection,
  type TraceablePreparedRenameMove,
  type TraceablePreparedRewriteFile,
  type TraceableLineageMoveScope,
  type TraceableRenameMoveRewriteBehavior
} from "./traceableFileOperations";
import { isTraceableLineageChecksumEnabled } from "./traceableLineageIntegrity";
import {
  allocateNextTraceableLineageLabel,
  buildTraceableEvidenceFileName,
  computeStoredParentTracePath,
  resolveTraceableGitRoot
} from "./traceableLineage";
import {
  renderTraceableLineageRepairMarkdown,
  resolveTraceableLineageRepairGitRoot,
  runTraceableLineageRepair,
  type TraceableLineageRepairResult
} from "./traceableLineageRepair";
import {
  createTraceableCopyMutation,
  createTraceableMoveMutation,
  createTraceableRewriteMutation,
  type PreparedTraceableMutationPlan,
  type TraceableMutationPlan,
  type TraceableMutationPlanMutation
} from "./traceableMutationPlan";

const {
  computeTargetedTraceableContinuityChecksumSha256: computeTargetedSchemaNoteContinuityChecksumSha256,
  parseSchemaNoteMarkdown
} = require("./traceableSchemaValidationShared.js") as {
  computeTargetedTraceableContinuityChecksumSha256: (
    filePath: string,
    markdown: string,
    footerIntegrity: unknown,
    readTextFileSync?: (filePath: string) => string
  ) => string | undefined;
  parseSchemaNoteMarkdown: (markdown: string) => {
    currentCreatedAt?: string;
    footerIntegrity?: unknown;
  };
};

const OPEN_OVERVIEW_COMMAND = "tiinex.aiProvenance.openOverview";
const INSPECT_TRACEABLE_EVIDENCE_COMMAND = "tiinex.aiProvenance.inspectTraceableEvidence";
const OPEN_TRACEABLE_SUBAGENT_STATUS_DETAIL_COMMAND = "tiinex.aiProvenance.openTraceableSubagentStatusDetail";
const STOP_TRACEABLE_SUBAGENT_COMMAND = "tiinex.aiProvenance.stopTraceableSubagent";
const OPEN_TRACEABLE_EVIDENCE_EDITOR_COMMAND = "tiinex.aiProvenance.openTraceableEvidenceEditor";
const REOPEN_TRACEABLE_EVIDENCE_SOURCE_COMMAND = "tiinex.aiProvenance.reopenTraceableEvidenceSource";
const REOPEN_TRACEABLE_EVIDENCE_PREVIEW_COMMAND = "tiinex.aiProvenance.reopenTraceableEvidencePreview";
const REWRITE_MOVE_TRACE_COMMAND = "tiinex.aiProvenance.rewriteMoveTrace";
const REWRITE_COPY_TRACE_COMMAND = "tiinex.aiProvenance.rewriteCopyTrace";
const RETURN_TO_PARENT_TRACE_COMMAND = "tiinex.aiProvenance.returnToParentTrace";
const REPAIR_TRACE_LINEAGE_COMMAND = "tiinex.aiProvenance.repairTraceLineage";
const VALIDATE_TRACEABLE_CONTINUITY_COMMAND = "tiinex.aiProvenance.validateTraceableContinuity";
const ROTATE_TRACEABLE_CONTINUITY_CHECKSUM_COMMAND = "tiinex.aiProvenance.rotateTraceableContinuityChecksum";
const REFRESH_TRACEABLE_PERMALINK_FROM_LATEST_COMMAND = "tiinex.aiProvenance.refreshTraceablePermalinkFromLatest";
const REPAIR_TRACEABLE_PARENT_TRACE_TARGET_COMMAND = "tiinex.aiProvenance.repairTraceableParentTraceTarget";
const ADD_FILE_TO_TRACEABLE_CHAT_COMMAND = "tiinex.aiProvenance.addFileToTraceableChat";
const NEW_TRACEABLE_CHAT_COMMAND = "tiinex.aiProvenance.newTraceableChat";
const CREATE_TRACEABLE_CHAT_FROM_VIEW_COMMAND = "tiinex.aiProvenance.createTraceableChatFromView";
const RESUME_TRACEABLE_CHAT_COMMAND = "tiinex.aiProvenance.resumeTraceableChat";
const SET_DEFAULT_NEW_TRACEABLE_CHAT_EXPORT_FOLDER_COMMAND = "tiinex.aiProvenance.setDefaultNewTraceableChatExportFolder";
const RUN_TRACEABLE_SUBAGENT_TOOL = "run_traceable_subagent";
const VIEW_TRACEABLE_SUBAGENT_TOOL = "view_traceable_subagent";
const TRANSFER_TRACE_TOOL = "transfer_trace";
const VALIDATE_TRACEABLE_CONTINUITY_TOOL = "validate_traceable_continuity";
const REPAIR_TRACE_LINEAGE_TOOL = "repair_traceable_lineage";
const SHOW_TRACEABLE_TRACES_TOOL = "show_traceable_traces";
const TRACEABLE_EVIDENCE_EDITOR_VIEW_TYPE = "tiinexTraceableEvidenceEditor";
const TRACEABLE_EVIDENCE_REFRESH_DEBOUNCE_MS = 250;
const TRACEABLE_PANEL_VISIBLE_CONTEXT = "tiinex.aiProvenance.traceablePanelVisible";
const RETURN_TO_PARENT_TRACE_ELIGIBLE_CONTEXT = "tiinex.aiProvenance.returnToParentEligibleResources";
const TRACEABLE_PANEL_FALLBACK_COMMAND = "workbench.action.terminal.focus";
const TOGGLE_MAXIMIZED_PANEL_COMMAND = "workbench.action.toggleMaximizedPanel";
const TRACEABLE_BUSY_MESSAGE = "Another TRACEABLE run is already starting or running. Wait for it to settle before sending another turn.";
const TRACEABLE_NATIVE_COPY_PASTE_UNSUPPORTED_MESSAGE = "Native Explorer copy/paste for .trace.md is not supported because VS Code does not expose the source trace or replace intent on file-create hooks. TRACEABLE removed the created copy. Use Copy Trace... instead.";
const TRACEABLE_CROSS_WORKSPACE_DESTINATION_UNSUPPORTED_MESSAGE = "TRACEABLE move/copy destinations must stay inside the same repo root as the source evidence file. Choose a destination inside the same repo root.";
const LAST_TRACEABLE_NODE_SCHEMA_ID_STATE_KEY = "traceableStructure.lastTraceNodeSchemaId";
const DEFAULT_NEW_TOPIC_LOCATION_SETTING = "defaultNewTraceableTopicLocation";

const TRACEABLE_NODE_SCHEMA_COMMANDS = [
  { command: "tiinex.aiProvenance.createTraceableNodeFromView.schema.topic", schemaId: "tiinex.topic.v1", title: "Topic" },
  { command: "tiinex.aiProvenance.createTraceableNodeFromView.schema.zip", schemaId: "tiinex.zip.v1", title: "Zip" },
  { command: "tiinex.aiProvenance.createTraceableNodeFromView.schema.signal", schemaId: "tiinex.signal.v1", title: "Signal" },
  { command: "tiinex.aiProvenance.createTraceableNodeFromView.schema.task", schemaId: "tiinex.task.v1", title: "Task" },
  { command: "tiinex.aiProvenance.createTraceableNodeFromView.schema.reduction", schemaId: "tiinex.reduction.v1", title: "Reduction" },
  { command: "tiinex.aiProvenance.createTraceableNodeFromView.schema.runtime", schemaId: "tiinex.runtime.v1", title: "Runtime" },
  { command: "tiinex.aiProvenance.createTraceableNodeFromView.schema.feedback", schemaId: "tiinex.feedback.v1", title: "Feedback" },
  { command: "tiinex.aiProvenance.createTraceableNodeFromView.schema.machineRuntime", schemaId: "tiinex.machine.runtime.v1", title: "Machine Runtime" },
  { command: "tiinex.aiProvenance.createTraceableNodeFromView.schema.evidence", schemaId: "tiinex.evidence.v1", title: "Evidence" },
  { command: "tiinex.aiProvenance.createTraceableNodeFromView.schema.encrypted", schemaId: "tiinex.encrypted.v1", title: "Encrypted" },
  { command: "tiinex.aiProvenance.createTraceableNodeFromView.schema.decision", schemaId: "tiinex.decision.v1", title: "Decision" },
  { command: "tiinex.aiProvenance.createTraceableNodeFromView.schema.continuation", schemaId: "tiinex.continuation.v1", title: "Continuation" },
  { command: "tiinex.aiProvenance.createTraceableNodeFromView.schema.capability", schemaId: "tiinex.capability.v1", title: "Capability" },
  { command: "tiinex.aiProvenance.createTraceableNodeFromView.schema.broken", schemaId: "tiinex.broken.v1", title: "Broken" },
  { command: "tiinex.aiProvenance.createTraceableNodeFromView.schema.archive", schemaId: "tiinex.archive.v1", title: "Archive" },
  { command: "tiinex.aiProvenance.createTraceableNodeFromView.schema.aiRuntime", schemaId: "tiinex.ai.runtime.v1", title: "AI Runtime" },
  { command: "tiinex.aiProvenance.createTraceableNodeFromView.schema.pointer", schemaId: "tiinex.pointer.v1", title: "Pointer" }
] as const;

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
type TraceableRenameMoveRewriteMode = TraceableRenameMoveRewriteBehavior;
type TraceableDefaultFileAction = "ask" | "alone" | "lineage";
type TraceableRenameMovePromptOutcome =
  | { action: "alone" }
  | { action: "lineage"; scope: TraceableLineageMoveScope }
  | { action: "cancel" };

interface ListTraceableAgentsInput {
  query?: string;
  limit?: number;
}

interface ListTraceableModelsInput {
  query?: string;
  limit?: number;
  sendableOnly?: boolean;
}

type TransferTraceOperation = "move" | "copy";
type TransferTraceAction = "alone" | "lineage";

interface TransferTraceInput {
  sourcePath: string;
  sourcePaths?: string[];
  destinationFolderPath: string;
  operation: TransferTraceOperation;
  action: TransferTraceAction;
  lineageScope?: TraceableLineageMoveScope;
  reveal?: boolean;
}

interface ValidateTraceableContinuityInput {
  filePath: string;
  maxDepth?: number;
}

interface RepairTraceableLineageInput {
  targetPath: string;
  autoCommit?: boolean;
  commitMessagePrefix?: string;
  maxIterations?: number;
}

interface ResolvedShowTracesInput extends ShowTracesInput {
  detailLevel?: "compact" | "standard" | "full";
}

type TraceableTransferSelection =
  | { action: "alone"; operation: TransferTraceOperation }
  | { action: "lineage"; operation: TransferTraceOperation; scope: TraceableLineageMoveScope };

interface PendingTraceableRewriteRename {
  oldUri: vscode.Uri;
  newUri: vscode.Uri;
  finalUri: vscode.Uri;
  rewrittenMarkdown: string;
  additionalMoves: readonly TraceablePreparedRenameMove[];
  additionalRewrites: readonly TraceablePreparedRewriteFile[];
}

const traceableSubagentToolMutex = new QueuedMutex();
const traceableLineageRepairMutex = new QueuedMutex();

const TRACEABLE_SURFACE_OPTIONS: Array<{ label: string; description: string; surface: TraceableEvidenceSurface }> = [
  { label: "Rendered Output", description: "Render the reconstructed TRACEABLE output surface", surface: "rendered-output" },
  { label: "Conversation Brief", description: "Compact current-turn, parent-context, routing, and grounding-gap brief for agent inspection", surface: "conversation-brief" },
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

function resolveMarkdownArtifactUri(target?: vscode.Uri): vscode.Uri | undefined {
  if (target && target.scheme === "file" && /\.md$/iu.test(target.fsPath)) {
    return target;
  }
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active && active.scheme === "file" && /\.md$/iu.test(active.fsPath)) {
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

function normalizeComparableFsPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function hasDirtyOpenDocumentForPath(filePath: string): boolean {
  const normalizedTarget = normalizeComparableFsPath(filePath);
  return vscode.workspace.textDocuments.some((document) => (
    document.uri.scheme === "file"
    && normalizeComparableFsPath(document.uri.fsPath) === normalizedTarget
    && document.isDirty
  ));
}

function hasTrackedGitChangesForPath(filePath: string): boolean {
  const gitRoot = resolveTraceableGitRoot(filePath);
  if (!gitRoot) {
    return false;
  }
  const relativePath = path.relative(gitRoot, filePath);
  if (!relativePath || relativePath.startsWith("..")) {
    return false;
  }
  try {
    const status = execFileSync("git", ["-C", gitRoot, "status", "--porcelain", "--", relativePath], { encoding: "utf8" }).trim();
    return status.length > 0;
  } catch {
    return false;
  }
}

function isContinuityChecksumMismatchDiagnostic(diagnostic: vscode.Diagnostic): boolean {
  return normalizeDiagnosticCode(diagnostic.code) === "continuity-checksum-mismatch";
}

function buildSchemaLayoutCodeActions(
  document: vscode.TextDocument,
  diagnostics: readonly vscode.Diagnostic[]
): vscode.CodeAction[] {
  const actions: vscode.CodeAction[] = [];
  const validationResult = getSchemaValidationResultForDocument(document);
  if (!validationResult) {
    return actions;
  }

  const diagnosticCodes = new Set(
    diagnostics
      .map((diagnostic) => normalizeDiagnosticCode(diagnostic.code))
      .filter((code): code is string => Boolean(code))
  );

  if (
    diagnosticCodes.has("root-schema-layout-title-mismatch")
    || diagnosticCodes.has("topic-schema-layout-title-mismatch")
    || diagnosticCodes.has("decision-schema-layout-title-mismatch")
    || diagnosticCodes.has("task-schema-layout-title-mismatch")
    || diagnosticCodes.has("evidence-schema-layout-title-mismatch")
    || diagnosticCodes.has("pointer-schema-layout-title-mismatch")
    || diagnosticCodes.has("root-schema-layout-unexpected-heading")
    || diagnosticCodes.has("topic-schema-layout-unexpected-heading")
    || diagnosticCodes.has("decision-schema-layout-unexpected-heading")
    || diagnosticCodes.has("task-schema-layout-unexpected-heading")
    || diagnosticCodes.has("evidence-schema-layout-unexpected-heading")
    || diagnosticCodes.has("pointer-schema-layout-unexpected-heading")
  ) {
    const edit = createNormalizeSchemaDisplayHeadingEdit(document);
    if (edit) {
      const action = new vscode.CodeAction("Normalize schema display heading", vscode.CodeActionKind.QuickFix);
      action.edit = edit;
      action.diagnostics = diagnostics.filter((diagnostic) => {
        const code = normalizeDiagnosticCode(diagnostic.code);
        return code === "root-schema-layout-title-mismatch"
          || code === "topic-schema-layout-title-mismatch"
          || code === "decision-schema-layout-title-mismatch"
          || code === "task-schema-layout-title-mismatch"
          || code === "evidence-schema-layout-title-mismatch"
          || code === "pointer-schema-layout-title-mismatch"
          || code === "root-schema-layout-unexpected-heading"
          || code === "topic-schema-layout-unexpected-heading"
          || code === "decision-schema-layout-unexpected-heading"
          || code === "task-schema-layout-unexpected-heading"
          || code === "evidence-schema-layout-unexpected-heading"
          || code === "pointer-schema-layout-unexpected-heading";
      });
      action.isPreferred = true;
      actions.push(action);
    }
  }

  for (const diagnostic of diagnostics) {
    const diagnosticCode = normalizeDiagnosticCode(diagnostic.code);
    if (diagnosticCode !== "root-schema-layout-missing-heading"
      && diagnosticCode !== "topic-schema-layout-missing-heading"
      && diagnosticCode !== "decision-schema-layout-missing-heading"
      && diagnosticCode !== "task-schema-layout-missing-heading"
      && diagnosticCode !== "evidence-schema-layout-missing-heading"
      && diagnosticCode !== "pointer-schema-layout-missing-heading") {
      continue;
    }
    const finding = validationResult.findings.find((candidate) => candidate.code === diagnosticCode && candidate.message === diagnostic.message);
    if (!finding) {
      continue;
    }
    const edit = createInsertMissingSchemaHeadingEdit(document, finding);
    if (!edit) {
      continue;
    }
    const action = new vscode.CodeAction(
      `Insert heading: ${finding.placement?.expectedHeading ?? "missing heading"}`,
      vscode.CodeActionKind.QuickFix
    );
    action.edit = edit;
    action.diagnostics = [diagnostic];
    actions.push(action);
  }

  return actions;
}

function buildContinuityEnvelopeCodeActions(document: vscode.TextDocument, diagnostics: readonly vscode.Diagnostic[]): vscode.CodeAction[] {
  const actions: vscode.CodeAction[] = [];
  const lines = Array.from({ length: document.lineCount }, (_, index) => document.lineAt(index).text);
  const seenRefreshActionKeys = new Set<string>();
  const seenFooterTowardsModes = new Set<"self" | "target">();
  const parsed = parseTraceableContinuityMarkdown(document.getText());
  const footerTowardsMode: "self" | "target" = (
    parsed.parentCreatedAt?.trim()
    || parsed.parentTrace?.target?.trim()
    || parsed.parentSchema?.target?.trim()
    || parsed.parentSchema?.label?.trim()
    || parsed.parentOrigin?.relative?.trim()
    || parsed.parentOrigin?.absolute?.trim()
    || parsed.parentOrigin?.browseGit?.trim()
  ) ? "target" : "self";
  for (const diagnostic of diagnostics) {
    const diagnosticCode = normalizeDiagnosticCode(diagnostic.code);
    const refreshFieldKey = getTraceablePermalinkRefreshFieldKey(lines, diagnostic.range.start.line);
    if ((diagnosticCode && isRefreshableTraceablePermalinkDiagnosticCode(diagnosticCode)) || isRefreshableTraceablePermalinkFieldKey(refreshFieldKey)) {
      const refreshActionKey = `${refreshFieldKey ?? diagnosticCode ?? "unknown"}:${diagnostic.range.start.line}`;
      if (!seenRefreshActionKeys.has(refreshActionKey)) {
        seenRefreshActionKeys.add(refreshActionKey);
        const action = new vscode.CodeAction("Refresh permalink from latest", vscode.CodeActionKind.QuickFix);
        action.command = {
          command: REFRESH_TRACEABLE_PERMALINK_FROM_LATEST_COMMAND,
          title: "Refresh permalink from latest",
          arguments: [document.uri, diagnostic.range.start.line, diagnosticCode]
        };
        action.diagnostics = [diagnostic];
        actions.push(action);
      }
    }
    if (diagnosticCode === "continuity-checksum-missing") {
      const edit = createInsertContinuityIntegrityFooterEdit(document);
      if (!edit) {
        continue;
      }
      const action = new vscode.CodeAction("Insert Continuity Integrity footer", vscode.CodeActionKind.QuickFix);
      action.edit = edit;
      action.diagnostics = [diagnostic];
      actions.push(action);
      continue;
    }
    if (diagnosticCode === "continuity-checksum-v1-legacy") {
      const action = new vscode.CodeAction("Upgrade Continuity Integrity footer to v2", vscode.CodeActionKind.QuickFix);
      action.command = {
        command: ROTATE_TRACEABLE_CONTINUITY_CHECKSUM_COMMAND,
        title: "Upgrade Continuity Integrity footer to v2",
        arguments: [document.uri]
      };
      action.diagnostics = [diagnostic];
      actions.push(action);
      continue;
    }
    if (diagnosticCode === "traceable-parent-trace-unreadable" || diagnosticCode === "traceable-parent-trace-unresolvable") {
      const action = new vscode.CodeAction("Repair Parent Trace target", vscode.CodeActionKind.QuickFix);
      action.command = {
        command: REPAIR_TRACEABLE_PARENT_TRACE_TARGET_COMMAND,
        title: "Repair Parent Trace target",
        arguments: [document.uri]
      };
      action.diagnostics = [diagnostic];
      actions.push(action);
      continue;
    }
    if (diagnosticCode === "continuity-footer-self-required-without-parent"
      || diagnosticCode === "continuity-footer-towards-permalink-required"
      || diagnosticCode === "continuity-footer-towards-unreadable") {
      if (!seenFooterTowardsModes.has(footerTowardsMode)) {
        const edit = createSetContinuityFooterTowardsEdit(document);
        if (!edit) {
          continue;
        }
        seenFooterTowardsModes.add(footerTowardsMode);
        const action = new vscode.CodeAction(
          footerTowardsMode === "self"
            ? "Replace footer Towards with self"
            : "Replace footer Towards target",
          vscode.CodeActionKind.QuickFix
        );
        action.edit = edit;
        action.diagnostics = [diagnostic];
        actions.push(action);
      }
      continue;
    }
    if (diagnosticCode === "continuity-current-created-at-missing") {
      const edit = createSetCurrentCreatedAtEdit(document, false);
      if (!edit) {
        continue;
      }
      const action = new vscode.CodeAction("Insert Current Created At", vscode.CodeActionKind.QuickFix);
      action.edit = edit;
      action.diagnostics = [diagnostic];
      actions.push(action);
      continue;
    }
    if (diagnosticCode === "continuity-current-created-at-invalid") {
      const edit = createSetCurrentCreatedAtEdit(document, true);
      if (!edit) {
        continue;
      }
      const action = new vscode.CodeAction("Replace Current Created At", vscode.CodeActionKind.QuickFix);
      action.edit = edit;
      action.diagnostics = [diagnostic];
      actions.push(action);
      continue;
    }
    if (diagnosticCode === "traceable-parent-created-at-missing" || diagnosticCode === "traceable-parent-created-at-invalid") {
      const edit = createSetContinuityParentCreatedAtEdit(document);
      if (!edit) {
        continue;
      }
      const action = new vscode.CodeAction(
        diagnosticCode === "traceable-parent-created-at-missing"
          ? "Insert Parent Created At from parent trace"
          : "Replace Parent Created At from parent trace",
        vscode.CodeActionKind.QuickFix
      );
      action.edit = edit;
      action.diagnostics = [diagnostic];
      actions.push(action);
      continue;
    }
    if (diagnosticCode === "traceable-parent-schema-missing" || diagnosticCode === "traceable-parent-schema-mismatch") {
      const edit = createSetContinuityParentSchemaEdit(document);
      if (!edit) {
        continue;
      }
      const action = new vscode.CodeAction(
        diagnosticCode === "traceable-parent-schema-missing"
          ? "Insert Parent Schema from parent trace"
          : "Replace Parent Schema from parent trace",
        vscode.CodeActionKind.QuickFix
      );
      action.edit = edit;
      action.diagnostics = [diagnostic];
      actions.push(action);
      continue;
    }
    if (diagnosticCode === "traceable-parent-checksum-mismatch") {
      const edit = createSetTraceableParentChecksumEdit(document);
      if (!edit) {
        continue;
      }
      const action = new vscode.CodeAction("Replace stored parent checksum from parent trace", vscode.CodeActionKind.QuickFix);
      action.edit = edit;
      action.diagnostics = [diagnostic];
      actions.push(action);
      continue;
    }
    if (diagnosticCode === "topic-schema-parent-created-at-missing" || diagnosticCode === "topic-schema-parent-created-at-invalid" || diagnosticCode === "topic-schema-parent-created-at-mismatch"
      || diagnosticCode === "decision-schema-parent-created-at-missing" || diagnosticCode === "decision-schema-parent-created-at-invalid" || diagnosticCode === "decision-schema-parent-created-at-mismatch"
      || diagnosticCode === "task-schema-parent-created-at-missing" || diagnosticCode === "task-schema-parent-created-at-invalid" || diagnosticCode === "task-schema-parent-created-at-mismatch"
      || diagnosticCode === "evidence-schema-parent-created-at-missing" || diagnosticCode === "evidence-schema-parent-created-at-invalid" || diagnosticCode === "evidence-schema-parent-created-at-mismatch"
      || diagnosticCode === "pointer-schema-parent-created-at-missing" || diagnosticCode === "pointer-schema-parent-created-at-invalid" || diagnosticCode === "pointer-schema-parent-created-at-mismatch") {
      const edit = createSetTopicSchemaParentCreatedAtEdit(document);
      if (!edit) {
        continue;
      }
      const action = new vscode.CodeAction(
        diagnosticCode === "topic-schema-parent-created-at-missing" || diagnosticCode === "decision-schema-parent-created-at-missing" || diagnosticCode === "task-schema-parent-created-at-missing" || diagnosticCode === "evidence-schema-parent-created-at-missing" || diagnosticCode === "pointer-schema-parent-created-at-missing"
          ? "Insert Parent Created At from parent trace"
          : "Replace Parent Created At from parent trace",
        vscode.CodeActionKind.QuickFix
      );
      action.edit = edit;
      action.diagnostics = [diagnostic];
      actions.push(action);
      continue;
    }
    if (diagnosticCode === "topic-schema-parent-origin-missing" || diagnosticCode === "decision-schema-parent-origin-missing" || diagnosticCode === "task-schema-parent-origin-missing" || diagnosticCode === "evidence-schema-parent-origin-missing" || diagnosticCode === "pointer-schema-parent-origin-missing") {
      const edit = createInsertTopicSchemaParentOriginEdit(document, false);
      if (!edit) {
        continue;
      }
      const action = new vscode.CodeAction("Insert Parent Origin scaffold", vscode.CodeActionKind.QuickFix);
      action.edit = edit;
      action.diagnostics = [diagnostic];
      actions.push(action);
      continue;
    }
    if (diagnosticCode === "topic-schema-parent-origin-browse-git-missing" || diagnosticCode === "decision-schema-parent-origin-browse-git-missing" || diagnosticCode === "task-schema-parent-origin-browse-git-missing" || diagnosticCode === "evidence-schema-parent-origin-browse-git-missing" || diagnosticCode === "pointer-schema-parent-origin-browse-git-missing") {
      const edit = createInsertTopicSchemaParentOriginEdit(document, true);
      if (!edit) {
        continue;
      }
      const action = new vscode.CodeAction("Insert browse + git permalink scaffold", vscode.CodeActionKind.QuickFix);
      action.edit = edit;
      action.diagnostics = [diagnostic];
      actions.push(action);
      continue;
    }
    if (diagnosticCode === "topic-schema-parent-origin-unpinned-browse-git" || diagnosticCode === "topic-schema-parent-origin-browse-git-mismatch"
      || diagnosticCode === "decision-schema-parent-origin-unpinned-browse-git" || diagnosticCode === "decision-schema-parent-origin-browse-git-mismatch"
      || diagnosticCode === "task-schema-parent-origin-unpinned-browse-git" || diagnosticCode === "task-schema-parent-origin-browse-git-mismatch"
      || diagnosticCode === "evidence-schema-parent-origin-unpinned-browse-git" || diagnosticCode === "evidence-schema-parent-origin-browse-git-mismatch"
      || diagnosticCode === "pointer-schema-parent-origin-unpinned-browse-git" || diagnosticCode === "pointer-schema-parent-origin-browse-git-mismatch") {
      const edit = createInsertTopicSchemaParentOriginEdit(document, true);
      if (!edit) {
        continue;
      }
      const action = new vscode.CodeAction("Replace browse + git permalink", vscode.CodeActionKind.QuickFix);
      action.edit = edit;
      action.diagnostics = [diagnostic];
      actions.push(action);
      continue;
    }
    if (diagnosticCode === "topic-schema-footer-target-mismatch" || diagnosticCode === "topic-schema-footer-target-not-permalink"
      || diagnosticCode === "decision-schema-footer-target-mismatch" || diagnosticCode === "decision-schema-footer-target-not-permalink"
      || diagnosticCode === "task-schema-footer-target-mismatch" || diagnosticCode === "task-schema-footer-target-not-permalink"
      || diagnosticCode === "evidence-schema-footer-target-mismatch" || diagnosticCode === "evidence-schema-footer-target-not-permalink"
      || diagnosticCode === "pointer-schema-footer-target-mismatch" || diagnosticCode === "pointer-schema-footer-target-not-permalink") {
      const edit = createSetTopicSchemaFooterTowardsEdit(document);
      if (!edit) {
        continue;
      }
      const action = new vscode.CodeAction("Replace footer Towards permalink", vscode.CodeActionKind.QuickFix);
      action.edit = edit;
      action.diagnostics = [diagnostic];
      actions.push(action);
    }
  }
  return actions;
}

function buildSchemaContractCodeActions(document: vscode.TextDocument, diagnostics: readonly vscode.Diagnostic[]): vscode.CodeAction[] {
  const actions: vscode.CodeAction[] = [];
  for (const diagnostic of diagnostics) {
    const edit = createNormalizeCurrentLineContractLabelEdit(document, diagnostic.range.start.line);
    if (!edit) {
      continue;
    }
    const diagnosticCode = normalizeDiagnosticCode(diagnostic.code);
    const title = diagnosticCode?.includes("star-bullets-present")
      ? "Convert bullet to hyphen"
      : "Normalize contract label";
    const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
    action.edit = edit;
    action.diagnostics = [diagnostic];
    actions.push(action);
  }
  return actions;
}

function hasDirtyOpenTraceableDocument(resolvedUri: vscode.Uri): boolean {
  if (!isTraceableEvidenceFileUri(resolvedUri)) {
    return false;
  }
  const resolvedKey = getTraceableEvidenceResourceKey(resolvedUri);
  return vscode.workspace.textDocuments.some((document) => (
    document.uri.scheme === resolvedUri.scheme
    && getTraceableEvidenceResourceKey(document.uri) === resolvedKey
    && document.isDirty
  ));
}

function collectOpenTraceableDocuments(resolvedUri: vscode.Uri): vscode.TextDocument[] {
  if (!isTraceableEvidenceFileUri(resolvedUri)) {
    return [];
  }
  const resolvedKey = getTraceableEvidenceResourceKey(resolvedUri);
  return vscode.workspace.textDocuments.filter((document) => (
    document.uri.scheme === resolvedUri.scheme
    && getTraceableEvidenceResourceKey(document.uri) === resolvedKey
  ));
}

function collectRelatedTraceableTabs(resolvedUri: vscode.Uri): vscode.Tab[] {
  if (!isTraceableEvidenceFileUri(resolvedUri)) {
    return [];
  }
  return (vscode.window.tabGroups.all ?? [])
    .flatMap((group) => group.tabs)
    .filter((tab) => isRelatedTraceableEvidenceTab(tab, resolvedUri));
}

async function closeNonDirtyRelatedTraceableTabs(resources: readonly vscode.Uri[]): Promise<void> {
  const uniqueResources = [...new Map(
    resources
      .filter((resource) => isTraceableEvidenceFileUri(resource))
      .map((resource) => [getTraceableEvidenceResourceKey(resource), resource])
  ).values()];
  const tabsToClose = new Set<vscode.Tab>();
  for (const resource of uniqueResources) {
    if (hasDirtyOpenTraceableDocument(resource)) {
      continue;
    }
    for (const tab of collectRelatedTraceableTabs(resource)) {
      tabsToClose.add(tab);
    }
  }
  for (const tab of tabsToClose) {
    await closeTabIfStillOpen(tab);
  }
}

async function saveAndCloseMatchingGeneratedDirtyTraceableDocuments(contentByResourceKey: ReadonlyMap<string, { resource: vscode.Uri; expectedContent: string }>): Promise<void> {
  for (const { resource, expectedContent } of contentByResourceKey.values()) {
    const documents = collectOpenTraceableDocuments(resource);
    let settled = false;
    for (const document of documents) {
      if (!document.isDirty || document.getText() !== expectedContent) {
        continue;
      }
      try {
        settled = await document.save() || settled;
      } catch {
        // Best-effort; leave unmatched or unsaveable documents alone.
      }
    }
    if (settled && !hasDirtyOpenTraceableDocument(resource)) {
      for (const tab of collectRelatedTraceableTabs(resource)) {
        await closeTabIfStillOpen(tab);
      }
    }
  }
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
  const formattedFolder = normalizedFolder
    ? formatTraceablePathReference(normalizedFolder, buildTraceableSummaryPathRenderOptions({ exportToFolder: normalizedFolder }), normalizedFolder)
    : undefined;
  switch (mode) {
    case "summary-with-evidence-path":
      return {
        value: "S+P",
        title: `Return the compact TRACEABLE result and include evidence path metadata.${formattedFolder ? `\nExport folder: ${formattedFolder}` : "\nTool-triggered export requires exportToFolder. Use the Export button for interactive folder picking."}`
      };
    case "full-markdown-with-evidence-path":
      return {
        value: "full + path",
        title: `Return the full raw evidence markdown inline and include evidence path metadata.${formattedFolder ? `\nExport folder: ${formattedFolder}` : "\nTool-triggered export requires exportToFolder. Use the Export button for interactive folder picking."}`
      };
    case "evidence-path-only":
      return {
        value: "path only",
        title: `Return only the bounded completion summary plus evidence path metadata.${formattedFolder ? `\nExport folder: ${formattedFolder}` : "\nTool-triggered export requires exportToFolder. Use the Export button for interactive folder picking."}`
      };
    default:
      return formattedFolder
        ? {
          value: "S+P",
          title: `Evidence export requested with the default summary-with-evidence-path mode.\nExport folder: ${formattedFolder}`
        }
        : undefined;
  }
}

function buildTraceableSummaryPathRenderOptions(input: Pick<TraceableSubagentInput, "exportToFolder" | "parentTracePath">): TraceableMarkdownPathRenderOptions {
  const baseDir = input.exportToFolder?.trim()
    || (input.parentTracePath?.trim() ? path.dirname(input.parentTracePath.trim()) : undefined);
  const workspaceRoot = baseDir
    ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(baseDir))?.uri.fsPath
    : undefined;
  return baseDir
    ? {
      mode: "relative-markdown",
      baseDir,
      workspaceRoot,
      maximumDepthOutsideOfWorkspaceRootForRelativePaths: getMaximumDepthOutsideOfWorkspaceRootForRelativePaths()
    }
    : { mode: "plain" };
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
  const pathRenderOptions = buildTraceableSummaryPathRenderOptions(effectiveInput);
  const inheritedLabels: string[] = [];
  const detailLines = [`Inherited from parent trace: ${formatTraceablePathReference(effectiveInput.parentTracePath.trim(), pathRenderOptions, effectiveInput.parentTracePath.trim())}`];
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
    detailLines.push(`Role: ${formatTraceablePathReference(effectiveInput.agentRole.filePath?.trim(), pathRenderOptions, effectiveInput.agentRole.name.trim())}`);
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
  const pathRenderOptions = buildTraceableSummaryPathRenderOptions(input);
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
      title: formatTraceablePathReference(input.parentTracePath.trim(), pathRenderOptions, input.parentTracePath.trim())
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
      title: formatTraceablePathReference(input.agentRole.filePath?.trim(), pathRenderOptions, input.agentRole.name.trim())
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
    const inheritedContextTitleParts = [`Continuation parent: ${formatTraceablePathReference(input.parentTracePath.trim(), pathRenderOptions, input.parentTracePath.trim())}`];
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

function renderTransferTraceResultMarkdown(input: {
  operation: TransferTraceOperation;
  action: TransferTraceAction;
  sourcePaths: readonly string[];
  destinationFolderPath: string;
  lineageScope?: TraceableLineageMoveScope;
  outputPaths: readonly string[];
  droppedSourcePaths?: readonly string[];
}): string {
  const primarySourcePath = input.sourcePaths[0] ?? "-";
  const lines = [
    "# Trace Transfer Result",
    "",
    `- Operation: ${input.operation}`,
    `- Action: ${input.action}`,
    `- Source: ${primarySourcePath}`,
    `- Source Count: ${input.sourcePaths.length}`,
    `- Destination Folder: ${input.destinationFolderPath}`,
    `- Outputs: ${input.outputPaths.length}`
  ];
  if (input.lineageScope) {
    lines.push(`- Lineage Scope: ${input.lineageScope}`);
  }
  if (input.sourcePaths.length > 1) {
    lines.push("", "## Source Paths", "");
    for (const sourcePath of input.sourcePaths) {
      lines.push(`- ${sourcePath}`);
    }
  }
  if ((input.droppedSourcePaths?.length ?? 0) > 0) {
    lines.push("", "## Dropped Source Paths", "");
    for (const sourcePath of input.droppedSourcePaths ?? []) {
      lines.push(`- ${sourcePath}`);
    }
  }
  if (input.outputPaths.length > 0) {
    lines.push("", "## Output Paths", "");
    for (const outputPath of input.outputPaths) {
      lines.push(`- ${outputPath}`);
    }
  }
  return `${lines.join("\n")}\n`;
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
    "- Purpose: provide exact display names for `runTrace` without manual workspace traversal.",
    "- Recommended flow: find one exact role here, then pass `agentRole.name` or `agentRole.filePath` into `runTrace` instead of guessing a role label.",
    `- Total matching agents: ${filteredEntries.length}`
  ];
  if (normalizedQuery) {
    lines.push(`- Query: ${input.query?.trim()}`);
  }
  if (limitedEntries.length === 0) {
    lines.push("", "No matching traceable agents found in the current workspace runtime surface.");
    return `${lines.join("\n")}\n`;
  }
  for (const entry of limitedEntries) {
    const tags = [
      entry.candidate ? "candidate" : undefined,
      entry.experimental ? "experimental" : undefined,
      entry.modelDeclaration ? `model=${entry.modelDeclaration}` : undefined
    ].filter(Boolean);
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

function getConfiguredTraceableRenameMoveRewriteBehavior(resource?: vscode.Uri): TraceableRenameMoveRewriteMode {
  const configured = getProvenanceConfiguration(resource).get<string>("traceableRenameMoveRewriteBehavior", "ask");
  return configured === "always" || configured === "never" ? configured : "ask";
}

function getConfiguredTraceableDisableMoveCopyLogic(resource?: vscode.Uri): boolean {
  return getProvenanceConfiguration(resource).get<boolean>("traceableDisableMoveCopyLogic", false) === true;
}

function getConfiguredTraceableDefaultMoveAction(resource?: vscode.Uri): TraceableDefaultFileAction {
  const configured = getProvenanceConfiguration(resource).get<string>("traceableDefaultMoveAction", "ask");
  if (configured === "alone" || configured === "lineage") {
    return configured;
  }
  if (configured === "rewrite") {
    return "alone";
  }
  if (configured === "preserve") {
    return "lineage";
  }
  return "ask";
}

function getConfiguredTraceableDefaultCopyAction(resource?: vscode.Uri): TraceableDefaultFileAction {
  const configured = getProvenanceConfiguration(resource).get<string>("traceableDefaultCopyAction", "ask");
  return configured === "alone" || configured === "lineage" ? configured : "ask";
}

function getConfiguredTraceableDefaultMultiSelectLineageScope(resource?: vscode.Uri): TraceableLineageMoveScope | "ask" {
  const configured = getProvenanceConfiguration(resource).get<string>("traceableDefaultMultiSelectLineageScope", "ask");
  return configured === "leaves" || configured === "branch" ? configured : "ask";
}

function pickPreferredTraceableLineageScope(
  availableScopes: readonly TraceableLineageMoveScope[]
): TraceableLineageMoveScope | undefined {
  if (availableScopes.includes("tree-plus-seeds")) {
    return "tree-plus-seeds";
  }
  if (availableScopes.includes("tree")) {
    return "tree";
  }
  if (availableScopes.includes("branch")) {
    return "branch";
  }
  if (availableScopes.includes("leaves")) {
    return "leaves";
  }
  return undefined;
}

function mapConfiguredTraceableActionToPromptOutcome(
  action: TraceableDefaultFileAction,
  availableScopes: readonly TraceableLineageMoveScope[]
): TraceableRenameMovePromptOutcome | undefined {
  if (action === "alone") {
    return { action: "alone" };
  }
  if (action === "lineage") {
    const preferredScope = pickPreferredTraceableLineageScope(availableScopes);
    return preferredScope ? { action: "lineage", scope: preferredScope } : undefined;
  }
  return undefined;
}

function getConfiguredTraceableMovePromptOutcome(
  resource: vscode.Uri | undefined,
  availableScopes: readonly TraceableLineageMoveScope[]
): TraceableRenameMovePromptOutcome | undefined {
  if (getConfiguredTraceableDisableMoveCopyLogic(resource)) {
    return undefined;
  }
  const configuredAction = mapConfiguredTraceableActionToPromptOutcome(getConfiguredTraceableDefaultMoveAction(resource), availableScopes);
  if (configuredAction) {
    return configuredAction;
  }
  const legacyBehavior = getConfiguredTraceableRenameMoveRewriteBehavior(resource);
  if (legacyBehavior === "always") {
    const preferredScope = pickPreferredTraceableLineageScope(availableScopes);
    return preferredScope ? { action: "lineage", scope: preferredScope } : { action: "alone" };
  }
  return undefined;
}

function getConfiguredTraceableCopyPromptOutcome(
  resource: vscode.Uri | undefined,
  availableScopes: readonly TraceableLineageMoveScope[]
): TraceableRenameMovePromptOutcome | undefined {
  if (getConfiguredTraceableDisableMoveCopyLogic(resource)) {
    return undefined;
  }
  return mapConfiguredTraceableActionToPromptOutcome(getConfiguredTraceableDefaultCopyAction(resource), availableScopes);
}

function formatTraceableLineageScopeLabel(scope: TraceableLineageMoveScope): string {
  if (scope === "leaves") {
    return "Leaves";
  }
  if (scope === "branch") {
    return "Branch";
  }
  if (scope === "tree-plus-seeds") {
    return "Tree + Seeds";
  }
  return "Tree";
}

async function confirmTraceableLineageMoveScope(
  files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[],
  availableScopes: readonly TraceableLineageMoveScope[]
): Promise<TraceableLineageMoveScope | undefined> {
  if (files.length > 1) {
    const configuredMultiSelectScope = getConfiguredTraceableDefaultMultiSelectLineageScope(files[0]?.newUri);
    if (configuredMultiSelectScope !== "ask" && availableScopes.includes(configuredMultiSelectScope)) {
      return configuredMultiSelectScope;
    }
  }
  if (availableScopes.length === 1) {
    return availableScopes[0];
  }
  const message = files.length === 1
    ? `Choose which lineage TRACEABLE should move with ${path.basename(files[0].oldUri.fsPath)}.`
    : `Choose which lineage TRACEABLE should move with these ${files.length} evidence files.`;
  const selection = await vscode.window.showInformationMessage(
    message,
    { modal: true },
    ...availableScopes.map((scope) => formatTraceableLineageScopeLabel(scope))
  );
  return availableScopes.find((scope) => formatTraceableLineageScopeLabel(scope) === selection);

}

async function confirmTraceableTransferRewrite(
  files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[],
  availableScopes: readonly TraceableLineageMoveScope[],
  operationLabel: "move" | "copy"
): Promise<TraceableRenameMovePromptOutcome> {
  const message = files.length === 1
    ? `Choose how TRACEABLE should ${operationLabel} ${path.basename(files[0].oldUri.fsPath)} into the destination.`
    : `Choose how TRACEABLE should ${operationLabel} these ${files.length} evidence files into the destination.`;
  const options = [
    "Alone",
    ...(availableScopes.length > 0 ? ["Lineage"] : [])
  ] as const;
  if (options.length === 1) {
    return { action: "alone" };
  }
  const selection = await vscode.window.showInformationMessage(
    message,
    { modal: true },
    ...options
  );
  if (selection === "Alone") {
    return { action: "alone" };
  }
  if (selection === "Lineage") {
    const configuredMultiSelectScope = files.length > 1
      ? getConfiguredTraceableDefaultMultiSelectLineageScope(files[0]?.newUri)
      : "ask";
    if (configuredMultiSelectScope === "leaves" && !availableScopes.includes("leaves")) {
      return { action: "alone" };
    }
    const scope = await confirmTraceableLineageMoveScope(files, availableScopes);
    return scope ? { action: "lineage", scope } : { action: "cancel" };
  }
  return { action: "cancel" };
}

async function confirmTraceableRenameMoveRewrite(
  files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[],
  availableScopes: readonly TraceableLineageMoveScope[]
): Promise<TraceableRenameMovePromptOutcome> {
  return confirmTraceableTransferRewrite(files, availableScopes, "move");
}

function buildTraceableRenamePairKey(oldUri: vscode.Uri, newUri: vscode.Uri): string {
  return `${oldUri.fsPath.toLowerCase()}=>${newUri.fsPath.toLowerCase()}`;
}

function normalizeTraceableMovePathKey(filePath: string): string {
  return path.resolve(filePath).replace(/\\+/g, "/").toLowerCase();
}

function areSameTraceableMovePath(leftPath: string, rightPath: string): boolean {
  return normalizeTraceableMovePathKey(leftPath) === normalizeTraceableMovePathKey(rightPath);
}

async function filterMeaningfulTraceableLineageScopes(
  files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[],
  availableScopes: readonly TraceableLineageMoveScope[],
  workspaceRoots: readonly string[]
): Promise<TraceableLineageMoveScope[]> {
  if (availableScopes.length === 0 || files.length === 0) {
    return [...availableScopes];
  }
  const requestedPathKeys = new Set(files.map((file) => normalizeTraceableMovePathKey(file.oldUri.fsPath)));
  const meaningfulScopes: TraceableLineageMoveScope[] = [];
  for (const scope of availableScopes) {
    try {
      const plannedMoves = await planTraceableRenameMoveOperation({
        files,
        workspaceRoots,
        allowExistingRequestedTargets: false,
        lineageScope: scope,
        hostOwnedRequestedFiles: files
      });
      const includesAdditionalMove = (plannedMoves ?? []).some((move) => !requestedPathKeys.has(normalizeTraceableMovePathKey(move.oldUri.fsPath)));
      if (includesAdditionalMove) {
        meaningfulScopes.push(scope);
      }
    } catch {
      // Ignore non-viable lineage scopes for this exact destination.
    }
  }
  return meaningfulScopes;
}

function resolvePromptableTraceableLineageScopes(
  availableScopes: readonly TraceableLineageMoveScope[],
  meaningfulScopes: readonly TraceableLineageMoveScope[]
): TraceableLineageMoveScope[] {
  return meaningfulScopes.length > 0 ? [...meaningfulScopes] : [...availableScopes];
}

async function resolveTraceableTransferPromptOutcome(input: {
  files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[];
  workspaceRoots: readonly string[];
  operationLabel: "move" | "copy";
  resource?: vscode.Uri;
}): Promise<TraceableRenameMovePromptOutcome> {
  const availableScopeSets = await Promise.all(input.files.map((file) => inspectTraceableLineageMoveScopes(file.oldUri.fsPath, input.workspaceRoots)));
  const availableScopes = availableScopeSets.reduce<TraceableLineageMoveScope[]>((sharedScopes, scopes, index) => {
    if (index === 0) {
      return [...scopes];
    }
    return sharedScopes.filter((scope) => scopes.includes(scope));
  }, []).filter((scope) => input.files.length <= 1 || (scope !== "tree" && scope !== "tree-plus-seeds"));
  const meaningfulScopes = await filterMeaningfulTraceableLineageScopes(input.files, availableScopes, input.workspaceRoots);
  const promptableScopes = resolvePromptableTraceableLineageScopes(availableScopes, meaningfulScopes);
  const configuredPromptOutcome = input.operationLabel === "copy"
    ? getConfiguredTraceableCopyPromptOutcome(input.resource, meaningfulScopes)
    : getConfiguredTraceableMovePromptOutcome(input.resource, meaningfulScopes);
  return configuredPromptOutcome
    ?? await confirmTraceableTransferRewrite(input.files, promptableScopes, input.operationLabel);
}
  const pendingTraceableRewriteRenames = new Map<string, PendingTraceableRewriteRename>();
  const cancelledTraceableRenamePairs = new Map<string, { oldUri: vscode.Uri; newUri: vscode.Uri }>();
  const suppressedTraceableRenamePairs = new Set<string>();
  let traceableExtensionOwnedRenameDepth = 0;
  let traceableOwnedMoveQueue: Promise<void> = Promise.resolve();

async function withTraceableExtensionOwnedRenameSuppressed<T>(operation: () => Thenable<T> | Promise<T>): Promise<T> {
  traceableExtensionOwnedRenameDepth += 1;
  try {
    return await operation();
  } finally {
    traceableExtensionOwnedRenameDepth = Math.max(0, traceableExtensionOwnedRenameDepth - 1);
  }
}

async function traceablePathExists(targetUri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(targetUri);
    return true;
  } catch {
    return false;
  }
}

async function collectCreatedTraceableEvidenceUris(targets: readonly vscode.Uri[]): Promise<vscode.Uri[]> {
  const pending = [...targets];
  const visited = new Set<string>();
  const collected: vscode.Uri[] = [];
  while (pending.length > 0) {
    const next = pending.shift();
    if (!next || next.scheme !== "file") {
      continue;
    }
    const key = next.fsPath.toLowerCase();
    if (visited.has(key)) {
      continue;
    }
    visited.add(key);
    let stat: vscode.FileStat;
    try {
      stat = await vscode.workspace.fs.stat(next);
    } catch {
      continue;
    }
    if ((stat.type & vscode.FileType.Directory) !== 0) {
      let entries: [string, vscode.FileType][] = [];
      try {
        entries = await vscode.workspace.fs.readDirectory(next);
      } catch {
        continue;
      }
      for (const [name] of entries) {
        pending.push(vscode.Uri.file(path.join(next.fsPath, name)));
      }
      continue;
    }
    if (next.fsPath.toLowerCase().endsWith(".trace.md")) {
      collected.push(next);
    }
  }
  return collected;
}

function buildTraceableStagedMoveUri(targetUri: vscode.Uri): vscode.Uri {
  const stagedBaseName = `.${path.basename(targetUri.fsPath)}`;
  return vscode.Uri.file(path.join(path.dirname(targetUri.fsPath), stagedBaseName));
}

async function ensureTraceableStagedMoveUriAvailable(targetUri: vscode.Uri): Promise<void> {
  if (await traceablePathExists(targetUri)) {
    throw new Error(`TRACEABLE staged move requires ${targetUri.fsPath} to be free before the move can start.`);
  }
}

async function performTraceableStagedFileMoveOperation(moves: readonly TraceablePreparedRenameMove[]): Promise<void> {
  const actionableMoves = moves.filter(({ oldUri, newUri, rewrittenMarkdown }) => (
    !areSameTraceableMovePath(oldUri.fsPath, newUri.fsPath)
    || typeof rewrittenMarkdown === "string"
  ));
  if (actionableMoves.length === 0) {
    return;
  }
  const stagedMoves = await Promise.all(actionableMoves.map(async (move, index) => ({
    ...move,
    originalBytes: await vscode.workspace.fs.readFile(move.oldUri),
    stageUri: buildTraceableStagedMoveUri(move.oldUri),
    currentUri: move.oldUri
  })));

  try {
    await withTraceableExtensionOwnedRenameSuppressed(async () => {
      for (const move of stagedMoves) {
        await ensureTraceableStagedMoveUriAvailable(move.stageUri);
      }
      for (const move of stagedMoves) {
        await vscode.workspace.fs.rename(move.oldUri, move.stageUri, { overwrite: false });
        move.currentUri = move.stageUri;
      }
      for (const move of stagedMoves) {
        if (!areSameTraceableMovePath(move.currentUri.fsPath, move.newUri.fsPath)) {
          await vscode.workspace.fs.rename(move.currentUri, move.newUri, { overwrite: false });
          move.currentUri = move.newUri;
        }
      }
      for (const move of stagedMoves) {
        if (typeof move.rewrittenMarkdown === "string") {
          await vscode.workspace.fs.writeFile(move.newUri, Buffer.from(move.rewrittenMarkdown, "utf8"));
        }
      }
    });
  } catch (error) {
    await withTraceableExtensionOwnedRenameSuppressed(async () => {
      for (const move of [...stagedMoves].reverse()) {
        try {
          if (!areSameTraceableMovePath(move.currentUri.fsPath, move.oldUri.fsPath) && await traceablePathExists(move.currentUri)) {
            await vscode.workspace.fs.rename(move.currentUri, move.oldUri, { overwrite: false });
          }
        } catch {
          // Best-effort rollback continues for the remaining files.
        }
        try {
          if (!await traceablePathExists(move.oldUri)) {
            await vscode.workspace.fs.writeFile(move.oldUri, move.originalBytes);
          } else if (typeof move.rewrittenMarkdown === "string") {
            await vscode.workspace.fs.writeFile(move.oldUri, move.originalBytes);
          }
        } catch {
          // Best-effort rollback continues for the remaining files.
        }
      }
    });
    throw error;
  }
}

async function performTraceablePreparedCopyOperation(copies: readonly TraceablePreparedRenameMove[]): Promise<void> {
  const actionableCopies = copies.filter(({ oldUri, newUri }) => {
    if (areSameTraceableMovePath(oldUri.fsPath, newUri.fsPath)) {
      throw new Error(`TRACEABLE copy target resolves to the source path at ${newUri.fsPath}. Choose a different destination or strategy.`);
    }
    return true;
  });
  if (actionableCopies.length === 0) {
    throw new Error("TRACEABLE copy could not prepare any file writes.");
  }
  const writtenTargets: vscode.Uri[] = [];
  try {
    for (const copy of actionableCopies) {
      if (await traceablePathExists(copy.newUri)) {
        throw new Error(`TRACEABLE copy target already exists at ${copy.newUri.fsPath}.`);
      }
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(copy.newUri.fsPath)));
      const content = typeof copy.rewrittenMarkdown === "string"
        ? Buffer.from(copy.rewrittenMarkdown, "utf8")
        : await vscode.workspace.fs.readFile(copy.oldUri);
      await vscode.workspace.fs.writeFile(copy.newUri, content);
      writtenTargets.push(copy.newUri);
    }
  } catch (error) {
    for (const target of [...writtenTargets].reverse()) {
      try {
        await vscode.workspace.fs.delete(target, { recursive: false, useTrash: false });
      } catch {
        // Best-effort cleanup continues for the remaining files.
      }
    }
    throw error;
  }
}

async function ApplyTraceableMutationPlan(plan: TraceableMutationPlan): Promise<void> {
  if (plan.blocked) {
    throw new Error("TRACEABLE mutation plan is blocked and cannot be applied.");
  }
  const moveMutations = plan.mutations.filter((mutation) => mutation.kind === "move-file");
  const copyMutations = plan.mutations.filter((mutation) => mutation.kind === "copy-file");
  const rewriteMutations = plan.mutations.filter((mutation) => mutation.kind === "rewrite-file");
  const generatedTraceableContentEntries: Array<readonly [string, { resource: vscode.Uri; expectedContent: string }]> = [
    ...moveMutations.flatMap((mutation) => typeof mutation.rewrittenMarkdown === "string" && isTraceableEvidenceFileUri(mutation.newUri)
      ? [[getTraceableEvidenceResourceKey(mutation.newUri), { resource: mutation.newUri, expectedContent: mutation.rewrittenMarkdown }] as const]
      : []),
    ...copyMutations.flatMap((mutation) => typeof mutation.rewrittenMarkdown === "string" && isTraceableEvidenceFileUri(mutation.newUri)
      ? [[getTraceableEvidenceResourceKey(mutation.newUri), { resource: mutation.newUri, expectedContent: mutation.rewrittenMarkdown }] as const]
      : []),
    ...rewriteMutations.flatMap((mutation) => isTraceableEvidenceFileUri(mutation.fileUri)
      ? [[getTraceableEvidenceResourceKey(mutation.fileUri), { resource: mutation.fileUri, expectedContent: mutation.nextContent }] as const]
      : [])
  ];
  const generatedTraceableContentByResourceKey = new Map<string, { resource: vscode.Uri; expectedContent: string }>(generatedTraceableContentEntries);
  if (moveMutations.length > 0 && copyMutations.length > 0) {
    throw new Error("TRACEABLE mutation plan cannot mix move-file and copy-file mutations in the current apply surface.");
  }
  await saveAndCloseMatchingGeneratedDirtyTraceableDocuments(generatedTraceableContentByResourceKey);
  await closeNonDirtyRelatedTraceableTabs([
    ...moveMutations.flatMap((mutation) => [mutation.oldUri, mutation.newUri]),
    ...rewriteMutations.map((mutation) => mutation.fileUri)
  ]);
  if (moveMutations.length > 0) {
    await performTraceableStagedFileMoveOperation(moveMutations);
  } else if (copyMutations.length > 0) {
    await performTraceablePreparedCopyOperation(copyMutations);
  }
  for (const mutation of rewriteMutations) {
    await vscode.workspace.fs.writeFile(mutation.fileUri, Buffer.from(mutation.nextContent, "utf8"));
  }
  await saveAndCloseMatchingGeneratedDirtyTraceableDocuments(generatedTraceableContentByResourceKey);
}

function enqueueTraceableOwnedMoveOperation(operation: () => Promise<void>): void {
  void runTraceableOwnedMoveOperation(operation).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`TRACEABLE staged move could not be completed: ${message}`);
  });
}

function runTraceableOwnedMoveOperation<T>(operation: () => Promise<T>): Promise<T> {
  const queuedOperation = traceableOwnedMoveQueue.then(operation, operation);
  traceableOwnedMoveQueue = queuedOperation.then(() => undefined, () => undefined);
  return queuedOperation;
}

async function performTraceableLineageMoveOperation(
  files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[],
  lineageScope: TraceableLineageMoveScope,
  workspaceRoots: readonly string[]
): Promise<readonly TraceablePreparedRenameMove[]> {
  const plannedMoves = await planTraceableRenameMoveOperation({
    files,
    workspaceRoots,
    allowExistingRequestedTargets: false,
    lineageScope,
    hostOwnedRequestedFiles: files
  });
  if (!plannedMoves || plannedMoves.length === 0) {
    throw new Error("TRACEABLE lineage move could not prepare any file updates.");
  }
  await performTraceableStagedFileMoveOperation(plannedMoves);
  return plannedMoves;
}

async function prepareTraceableLineageMoveMutationPlan(
  files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[],
  lineageScope: TraceableLineageMoveScope,
  workspaceRoots: readonly string[]
): Promise<PreparedTraceableMutationPlan> {
  const plannedMoves = await planTraceableRenameMoveOperation({
    files,
    workspaceRoots,
    allowExistingRequestedTargets: false,
    lineageScope,
    hostOwnedRequestedFiles: files
  });
  if (!plannedMoves || plannedMoves.length === 0) {
    throw new Error("TRACEABLE lineage move could not prepare any file updates.");
  }
  const retainedDescendantRewrites = await planTraceableLineageMoveRetainedDescendantRewrites({
    files,
    workspaceRoots,
    lineageScope
  });
  return {
    plan: {
      blocked: false,
        mutations: [
          ...plannedMoves.map((move) => createTraceableMoveMutation(move)),
          ...retainedDescendantRewrites.map((rewrite) => createTraceableRewriteMutation(rewrite.fileUri, rewrite.nextContent))
        ]
    },
    outputPaths: plannedMoves.map((move) => move.newUri.fsPath)
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
    const haystack = [entry.displayName, entry.id, entry.vendor, entry.family, entry.version]
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
    "- Purpose: preflight exact model ids for `runTrace` without waiting for model-selection failure.",
    "- Recommended flow: use `sendableOnly: true` when practical, copy an exact returned id only when you need explicit model control, and treat `Policy: blocked` as non-selectable for `runTrace`.",
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
  lines.push("- Typical next step: after choosing an allowed exact id here, run a narrow `runTrace` lane and inspect the returned evidence file with `viewTrace` before rerunning.");
  if (limitedEntries.length === 0) {
    lines.push("", "No matching traceable models found in the current runtime surface.");
    return `${lines.join("\n")}\n`;
  }
  lines.push("");
  for (const { entry, preferred, blocked } of limitedEntries) {
    const policyLabels = [blocked ? "blocked" : undefined, preferred ? "preferred" : undefined].filter(Boolean);
    lines.push(`- ${entry.displayName ?? formatTraceableModelIdDisplayName(entry.id) ?? entry.id ?? "(missing id)"}`);
    lines.push(`  - Exact Id: ${entry.id ?? "-"}`);
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
    throw new Error("viewTrace requires a non-empty evidenceFilePath.");
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

async function resolveMarkdownArtifactFilePath(filePath: string): Promise<string> {
  const normalized = filePath.trim();
  if (!normalized) {
    throw new Error("validateTrace requires a non-empty filePath.");
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
    throw new Error(`Relative filePath ${JSON.stringify(normalized)} matched multiple workspace files. Provide an absolute path instead.`);
  }
  throw new Error(`Could not resolve filePath ${JSON.stringify(normalized)} under any open workspace folder. Provide an absolute path instead.`);
}

function getTraceableOpenWorkspaceFolders(): Array<{ name: string; fsPath: string }> {
  return (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
    name: folder.name,
    fsPath: folder.uri.fsPath
  }));
}

function normalizeTraceableWorkspaceFolderKey(folderPath: string): string {
  return path.resolve(folderPath).replace(/\\+/g, "/").replace(/\/+$/u, "").toLowerCase();
}

function assertTraceableDestinationWithinSourceWorkspace(sourceUri: vscode.Uri, destinationUri: vscode.Uri): void {
  const sourceGitRoot = resolveTraceableGitRoot(sourceUri.fsPath);
  const destinationGitRoot = resolveTraceableGitRoot(destinationUri.fsPath);
  if (sourceGitRoot || destinationGitRoot) {
    if (!sourceGitRoot || !destinationGitRoot || normalizeTraceableWorkspaceFolderKey(sourceGitRoot) !== normalizeTraceableWorkspaceFolderKey(destinationGitRoot)) {
      throw new Error(TRACEABLE_CROSS_WORKSPACE_DESTINATION_UNSUPPORTED_MESSAGE);
    }
    return;
  }
  const sourceWorkspaceFolder = vscode.workspace.getWorkspaceFolder(sourceUri);
  if (!sourceWorkspaceFolder) {
    return;
  }
  const destinationWorkspaceFolder = vscode.workspace.getWorkspaceFolder(destinationUri);
  if (!destinationWorkspaceFolder) {
    throw new Error(TRACEABLE_CROSS_WORKSPACE_DESTINATION_UNSUPPORTED_MESSAGE);
  }
  if (normalizeTraceableWorkspaceFolderKey(sourceWorkspaceFolder.uri.fsPath) !== normalizeTraceableWorkspaceFolderKey(destinationWorkspaceFolder.uri.fsPath)) {
    throw new Error(TRACEABLE_CROSS_WORKSPACE_DESTINATION_UNSUPPORTED_MESSAGE);
  }
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

function getConfiguredTraceableChatCollapse(resource?: vscode.Uri): "auto" | "always" {
  const configured = getProvenanceConfiguration(resource).get<string>("chatCollapse", "auto");
  return configured === "always" ? "always" : "auto";
}

function getConfiguredAllRolesAvailableAsChatSender(resource?: vscode.Uri): boolean {
  return getProvenanceConfiguration(resource).get<boolean>("allRolesAvailableAsChatSender", false) === true;
}

function getConfiguredDefaultChatSenderRole(resource?: vscode.Uri): string | undefined {
  const configured = getProvenanceConfiguration(resource).get<string>("defaultChatSenderRole", "").trim();
  return configured || undefined;
}

function getConfiguredQuickSelectRole(resource?: vscode.Uri): boolean {
  return getProvenanceConfiguration(resource).get<boolean>("quickSelectRole", true) === true;
}

function getConfiguredHideRolesWithSameBody(resource?: vscode.Uri): boolean {
  return getProvenanceConfiguration(resource).get<boolean>("hideRolesWithSameBody", false) === true;
}

interface ChatSenderRoleOption {
  label: string;
  value: string;
}

function ensureTraceableSenderTrackSuffix(
  displayName: string,
  entry: Pick<Awaited<ReturnType<typeof listTraceableAgentCatalogEntries>>[number], "candidate" | "experimental">
): string {
  const trimmedDisplayName = displayName.trim();
  if (entry.experimental) {
    return /\(experimental\)\s*$/iu.test(trimmedDisplayName) ? trimmedDisplayName : `${trimmedDisplayName} (Experimental)`;
  }
  if (entry.candidate) {
    return /\(candidate\)\s*$/iu.test(trimmedDisplayName) ? trimmedDisplayName : `${trimmedDisplayName} (Candidate)`;
  }
  return trimmedDisplayName;
}

function stripTraceableSenderTrackSuffix(value: string): string {
  return value.replace(/\s*\((?:candidate|experimental)\)\s*$/iu, "").trim();
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

function getTraceableSenderTrackRank(entry: Awaited<ReturnType<typeof listTraceableAgentCatalogEntries>>[number]): number {
  const displayName = entry.displayName.trim();
  if (entry.experimental || /\(experimental\)\s*$/iu.test(displayName)) {
    return 2;
  }
  if (entry.candidate || /\(candidate\)\s*$/iu.test(displayName)) {
    return 1;
  }
  return 0;
}

function getTraceableSenderOptionTrackRank(option: ChatSenderRoleOption): number {
  const displayValue = `${option.label} ${option.value}`.trim();
  if (/\(experimental\)\s*$/iu.test(displayValue)) {
    return 2;
  }
  if (/\(candidate\)\s*$/iu.test(displayValue)) {
    return 1;
  }
  return 0;
}

function compareChatSenderRoleOptions(left: ChatSenderRoleOption, right: ChatSenderRoleOption): number {
  const leftLabel = stripTraceableSenderTrackSuffix(stripTraceableRoleModelSuffix(left.label || left.value));
  const rightLabel = stripTraceableSenderTrackSuffix(stripTraceableRoleModelSuffix(right.label || right.value));
  const labelComparison = leftLabel.localeCompare(rightLabel, undefined, { sensitivity: "base" });
  if (labelComparison !== 0) {
    return labelComparison;
  }
  const trackComparison = getTraceableSenderOptionTrackRank(left) - getTraceableSenderOptionTrackRank(right);
  if (trackComparison !== 0) {
    return trackComparison;
  }
  return (left.value || left.label).localeCompare((right.value || right.label), undefined, { sensitivity: "base" });
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
  const exactSimplifiedLabelMatches = options.filter((option) => normalizeChatSenderRoleLookupValue(stripTraceableRoleModelSuffix(option.label)) === normalizedConfiguredValue);
  if (exactSimplifiedLabelMatches.length > 0) {
    return exactSimplifiedLabelMatches[0].value;
  }
  const prefixMatches = options.filter((option) => normalizeChatSenderRoleLookupValue(option.label).startsWith(normalizedConfiguredValue));
  if (prefixMatches.length === 1) {
    return prefixMatches[0].value;
  }
  const simplifiedPrefixMatches = options.filter((option) => normalizeChatSenderRoleLookupValue(stripTraceableRoleModelSuffix(option.label)).startsWith(normalizedConfiguredValue));
  return simplifiedPrefixMatches.length > 0 ? simplifiedPrefixMatches[0].value : undefined;
}

function comparePreferredChatSenderEntries(
  left: Awaited<ReturnType<typeof listTraceableAgentCatalogEntries>>[number],
  right: Awaited<ReturnType<typeof listTraceableAgentCatalogEntries>>[number]
): number {
  const leftLabel = stripTraceableRoleModelSuffix(left.displayName);
  const rightLabel = stripTraceableRoleModelSuffix(right.displayName);
  const labelComparison = leftLabel.localeCompare(rightLabel, undefined, { sensitivity: "base" });
  if (labelComparison !== 0) {
    return labelComparison;
  }
  const trackComparison = getTraceableSenderTrackRank(left) - getTraceableSenderTrackRank(right);
  if (trackComparison !== 0) {
    return trackComparison;
  }
  return left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" });
}

function buildTraceableSenderBodyToolsetIdentityKey(
  entry: Awaited<ReturnType<typeof listTraceableAgentCatalogEntries>>[number]
): string | undefined {
  const bodySignature = entry.bodySignature.trim();
  if (!bodySignature) {
    return undefined;
  }
  const normalizedToolDeclarations = [...new Set(
    entry.toolDeclarations
      .map((toolName) => toolName.trim().normalize("NFKC").toLowerCase())
      .filter(Boolean)
  )].sort();
  return JSON.stringify({
    bodySignature,
    toolDeclarations: normalizedToolDeclarations
  });
}

function maybeHideChatSenderRolesWithSameBody(
  entries: readonly Awaited<ReturnType<typeof listTraceableAgentCatalogEntries>>[number][],
  resource?: vscode.Uri
): Awaited<ReturnType<typeof listTraceableAgentCatalogEntries>>[number][] {
  if (!getConfiguredHideRolesWithSameBody(resource)) {
    return [...entries];
  }
  const dedupedEntriesByBodySignature = new Map<string, Awaited<ReturnType<typeof listTraceableAgentCatalogEntries>>[number]>();
  const dedupedEntriesWithoutBodySignature: Awaited<ReturnType<typeof listTraceableAgentCatalogEntries>>[number][] = [];
  for (const entry of entries) {
    const bodyToolsetIdentityKey = buildTraceableSenderBodyToolsetIdentityKey(entry);
    if (!bodyToolsetIdentityKey) {
      dedupedEntriesWithoutBodySignature.push(entry);
      continue;
    }
    const existing = dedupedEntriesByBodySignature.get(bodyToolsetIdentityKey);
    if (!existing || comparePreferredChatSenderEntries(entry, existing) < 0) {
      dedupedEntriesByBodySignature.set(bodyToolsetIdentityKey, entry);
    }
  }
  return [...dedupedEntriesByBodySignature.values(), ...dedupedEntriesWithoutBodySignature].sort(comparePreferredChatSenderEntries);
}

async function listConfiguredChatSenderRoleOptions(resource?: vscode.Uri): Promise<ChatSenderRoleOption[]> {
  const allEntries = await listTraceableAgentCatalogEntries();
  const includeAllRoles = getConfiguredAllRolesAvailableAsChatSender(resource);
  const filteredEntries = maybeHideChatSenderRolesWithSameBody(allEntries
    .filter((entry) => includeAllRoles || entry.humanRole)
    .sort(comparePreferredChatSenderEntries), resource);
  if (includeAllRoles) {
    return filteredEntries.map((entry) => ({
      label: ensureTraceableSenderTrackSuffix(entry.displayName, entry),
      value: ensureTraceableSenderTrackSuffix(entry.displayName, entry)
    })).sort(compareChatSenderRoleOptions);
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
    }))
    .sort(compareChatSenderRoleOptions);
}

async function resolveConfiguredDefaultChatSenderRole(resource?: vscode.Uri): Promise<string | undefined> {
  const configuredValue = getConfiguredDefaultChatSenderRole(resource);
  if (!configuredValue) {
    return undefined;
  }
  const availableOptions = await listConfiguredChatSenderRoleOptions(resource);
  return resolveConfiguredDefaultChatSenderRoleOption(configuredValue, availableOptions);
}

type PromptableChatSenderRoleOption = {
  label: string;
  description?: string;
  senderRole: string;
};

function buildPromptableChatSenderRoleOptions(
  availableRoles: readonly ChatSenderRoleOption[],
  resolvedDefaultSenderRole: string | undefined
): PromptableChatSenderRoleOption[] {
  const defaultOption = resolvedDefaultSenderRole
    ? availableRoles.find((roleOption) => roleOption.value === resolvedDefaultSenderRole)
    : undefined;
  const remainingRoles = defaultOption
    ? availableRoles.filter((roleOption) => roleOption.value !== defaultOption.value)
    : [...availableRoles];
  const options: PromptableChatSenderRoleOption[] = [];
  if (defaultOption) {
    options.push({
      label: defaultOption.label,
      description: defaultOption.value !== defaultOption.label ? defaultOption.value : undefined,
      senderRole: defaultOption.value
    });
  }
  options.push({
    label: "No sender role",
    description: "Leave the sender empty",
    senderRole: ""
  });
  options.push(...remainingRoles.map((roleOption) => ({
    label: roleOption.label,
    description: roleOption.value !== roleOption.label ? roleOption.value : undefined,
    senderRole: roleOption.value
  })));
  return options;
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

function buildTraceableExplorerResourceContextKeys(resource: vscode.Uri): string[] {
  const keys = new Set<string>();
  const resolvedFsPath = path.resolve(resource.fsPath);
  const uriPath = resource.path;
  const decodedUriPath = decodeURIComponent(uriPath);
  const normalizedUriPath = uriPath.replace(/\\/g, "/");
  const normalizedDecodedUriPath = decodedUriPath.replace(/\\/g, "/");
  keys.add(resource.fsPath);
  keys.add(resolvedFsPath);
  keys.add(resource.fsPath.toLowerCase());
  keys.add(resolvedFsPath.toLowerCase());
  keys.add(uriPath);
  keys.add(decodedUriPath);
  keys.add(normalizedUriPath);
  keys.add(normalizedDecodedUriPath);
  keys.add(uriPath.toLowerCase());
  keys.add(decodedUriPath.toLowerCase());
  keys.add(normalizedUriPath.toLowerCase());
  keys.add(normalizedDecodedUriPath.toLowerCase());
  return [...keys];
}

function tryExtractTraceableMarkdownLinkTarget(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const match = /^\[[^\]]+\]\(([^)]+)\)$/u.exec(trimmed);
  return match?.[1]?.trim() || undefined;
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

type TraceableEditorValidationKind = "continuity-trace" | "root-schema" | "topic-schema" | "decision-schema" | "task-schema" | "evidence-schema" | "pointer-schema" | "schema-generic" | "validator-generic";

function isSuppressedTraceableFixturePath(fsPath: string): boolean {
  const normalized = path.resolve(fsPath).replace(/\\+/gu, "/").toLowerCase();
  return normalized.includes("/lineage-bridge/packages/bridge/src/fixtures/")
    && normalized.endsWith(".trace.md");
}

function getTraceableEditorValidationKindForFsPath(fsPath: string): TraceableEditorValidationKind | undefined {
  const normalized = path.resolve(fsPath);
  const normalizedLower = normalized.toLowerCase();
  if (isSuppressedTraceableFixturePath(normalized)) {
    return undefined;
  }
  if (normalizedLower.endsWith(".trace.md")) {
    return "continuity-trace";
  }
  if (normalizedLower.endsWith("tiinex.root.v1.schema.md")) {
    return "root-schema";
  }
  if (normalizedLower.endsWith("tiinex.topic.v1.schema.md")) {
    return "topic-schema";
  }
  
  if (normalizedLower.endsWith("tiinex.decision.v1.schema.md")) {
    return "decision-schema";
  }
  if (normalizedLower.endsWith("tiinex.task.v1.schema.md")) {
    return "task-schema";
  }
  if (normalizedLower.endsWith("tiinex.evidence.v1.schema.md")) {
    return "evidence-schema";
  }
  if (normalizedLower.endsWith("tiinex.pointer.v1.schema.md")) {
    return "pointer-schema";
  }
  // Generic schema validation kind: run continuity checks for any schema note
  // file that doesn't match a dedicated validator above. This ensures basic
  // continuity envelope and continuity integrity diagnostics (and related
  // quick fixes) are available for all `*.schema.md` files.
  if (normalizedLower.endsWith(".schema.md")) {
    return "schema-generic";
  }
  if (normalizedLower.endsWith(".validator.md")) {
    return "validator-generic";
  }
  // Treat a set of other markdown artifact types as generic schema-like
  // artifacts so they receive continuity footer and checksum diagnostics
  // and quick fixes (v1 checksum support). These are not specialized
  // schema validators and should only get the continuity envelope checks.
  if (normalizedLower.endsWith(".origin.md") || normalizedLower.endsWith(".adapter.md") || normalizedLower.endsWith(".tool.md") || normalizedLower.endsWith(".interface.md")) {
    return "schema-generic";
  }
  return undefined;
}

function isTraceableContinuityEligibleDocument(document: vscode.TextDocument): boolean {
  return document.uri.scheme === "file"
    && document.languageId === "markdown"
    && getTraceableEditorValidationKindForFsPath(document.uri.fsPath) !== undefined;
}

function createTopOfDocumentRange(document: vscode.TextDocument): vscode.Range {
  if (document.lineCount < 1) {
    return new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));
  }
  return new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, Math.max(document.lineAt(0).text.length, 1)));
}

function collectOutdatedTraceablePermalinkDiagnostics(
  document: vscode.TextDocument,
  source: string
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  const lines = Array.from({ length: document.lineCount }, (_, index) => document.lineAt(index).text);
  const refreshedTargetCache = new Map<string, string | undefined>();
  const currentTargetMarkdownCache = new Map<string, string | undefined>();
  const latestTargetMarkdownCache = new Map<string, string | undefined>();
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const fieldKey = getTraceablePermalinkRefreshFieldKey(lines, lineIndex);
    if (!isRefreshableTraceablePermalinkFieldKey(fieldKey)) {
      continue;
    }
    const currentTarget = extractFirstMarkdownLinkTarget(lines[lineIndex]);
    if (!currentTarget) {
      continue;
    }
    const currentPermalink = parseGitHubCommitPermalink(currentTarget);
    if (!currentPermalink) {
      continue;
    }
    let refreshedTarget = refreshedTargetCache.get(currentTarget);
    if (refreshedTarget === undefined && !refreshedTargetCache.has(currentTarget)) {
      refreshedTarget = tryResolveTraceableLatestPermalinkForTarget(document, currentTarget, { allowRemoteQuery: false });
      refreshedTargetCache.set(currentTarget, refreshedTarget);
    }
    if (!refreshedTarget) {
      continue;
    }
    const refreshedPermalink = parseGitHubCommitPermalink(refreshedTarget);
    if (!refreshedPermalink) {
      continue;
    }
    if (currentPermalink.repoSlug === refreshedPermalink.repoSlug
      && currentPermalink.relativePath === refreshedPermalink.relativePath
      && currentPermalink.revision !== refreshedPermalink.revision) {
      let currentTargetMarkdown = currentTargetMarkdownCache.get(currentTarget);
      if (currentTargetMarkdown === undefined && !currentTargetMarkdownCache.has(currentTarget)) {
        currentTargetMarkdown = readTraceablePermalinkTargetMarkdownForDocument(document, currentTarget);
        currentTargetMarkdownCache.set(currentTarget, currentTargetMarkdown);
      }
      let latestTargetMarkdown = latestTargetMarkdownCache.get(currentTarget);
      if (latestTargetMarkdown === undefined && !latestTargetMarkdownCache.has(currentTarget)) {
        latestTargetMarkdown = readTraceableLatestMarkdownForPermalinkTarget(document, currentTarget, { allowRemoteQuery: false });
        latestTargetMarkdownCache.set(currentTarget, latestTargetMarkdown);
      }
      if (typeof currentTargetMarkdown === "string"
        && typeof latestTargetMarkdown === "string"
        && currentTargetMarkdown.replace(/\r\n?/gu, "\n") === latestTargetMarkdown.replace(/\r\n?/gu, "\n")) {
        continue;
      }
      const diagnostic = new vscode.Diagnostic(
        document.lineAt(lineIndex).range,
        "Commit-pinned permalink is out of date; a newer latest-origin permalink is available for this target.",
        vscode.DiagnosticSeverity.Warning
      );
      diagnostic.source = source;
      diagnostic.code = "traceable-permalink-outdated";
      diagnostics.push(diagnostic);
    }
  }
  return diagnostics;
}

function findTraceableDiagnosticLineRange(
  document: vscode.TextDocument,
  predicate: (lineText: string) => boolean
): vscode.Range | undefined {
  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex += 1) {
    const line = document.lineAt(lineIndex);
    if (!predicate(line.text)) {
      continue;
    }
    return new vscode.Range(
      new vscode.Position(lineIndex, 0),
      new vscode.Position(lineIndex, Math.max(line.text.length, 1))
    );
  }
  return undefined;
}

function findTraceableDiagnosticLineRangeInSection(
  document: vscode.TextDocument,
  sectionHeading: string,
  predicate: (lineText: string) => boolean
): vscode.Range | undefined {
  let inSection = false;
  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex += 1) {
    const line = document.lineAt(lineIndex);
    const trimmed = line.text.trim();
    if (!inSection) {
      if (trimmed === sectionHeading) {
        inSection = true;
      }
      continue;
    }
    if (/^#\s+/u.test(trimmed) && trimmed !== sectionHeading) {
      break;
    }
    if (!predicate(line.text)) {
      continue;
    }
    return new vscode.Range(
      new vscode.Position(lineIndex, 0),
      new vscode.Position(lineIndex, Math.max(line.text.length, 1))
    );
  }
  return undefined;
}

function findTraceablePreferredContinuityIntegrityValueRange(document: vscode.TextDocument): vscode.Range | undefined {
  let inSection = false;
  const entries: Array<{ method?: string; towardsTarget?: string; valueLineIndex?: number }> = [];
  let currentEntry: { method?: string; towardsTarget?: string; valueLineIndex?: number } | undefined;

  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex += 1) {
    const lineText = document.lineAt(lineIndex).text;
    const trimmed = lineText.trim();
    if (!inSection) {
      if (trimmed === "# Continuity Integrity") {
        inSection = true;
      }
      continue;
    }
    if (/^#\s+/u.test(trimmed) && trimmed !== "# Continuity Integrity") {
      break;
    }

    const methodMatch = trimmed.match(/^-[ \t]+([^:]+)$/u);
    if (methodMatch) {
      currentEntry = { method: methodMatch[1].trim() };
      entries.push(currentEntry);
      continue;
    }

    const towardsMatch = trimmed.match(/^-[ \t]+Towards:\s+(.*)$/u);
    if (towardsMatch) {
      currentEntry ??= {};
      if (entries[entries.length - 1] !== currentEntry) {
        entries.push(currentEntry);
      }
      const targetMatch = towardsMatch[1].trim().match(/^\[[^\]]*\]\(([^)]+)\)$/u);
      currentEntry.towardsTarget = targetMatch?.[1]?.trim() || towardsMatch[1].trim();
      continue;
    }

    if (/^-[ \t]+Value:\s+/u.test(trimmed)) {
      currentEntry ??= {};
      if (entries[entries.length - 1] !== currentEntry) {
        entries.push(currentEntry);
      }
      currentEntry.valueLineIndex = lineIndex;
    }
  }

  let preferredEntry = entries[entries.length - 1];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.method === "sha256-base64url-c14n-v2" && entry?.towardsTarget === "self" && Number.isInteger(entry.valueLineIndex)) {
      preferredEntry = entry;
      break;
    }
  }

  const valueLineIndex = preferredEntry?.valueLineIndex;
  if (typeof valueLineIndex === "number") {
    const line = document.lineAt(valueLineIndex);
    return new vscode.Range(
      new vscode.Position(valueLineIndex, 0),
      new vscode.Position(valueLineIndex, Math.max(line.text.length, 1))
    );
  }

  return findTraceableDiagnosticLineRangeInSection(document, "# Continuity Integrity", (lineText) => lineText.trimStart().startsWith("- Value:"));
}

function collectDocumentMarkdownHeadings(document: vscode.TextDocument): Array<{ level: number; text: string; lineIndex: number }> {
  const headings: Array<{ level: number; text: string; lineIndex: number }> = [];
  let inFence = false;
  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex += 1) {
    const lineText = document.lineAt(lineIndex).text;
    if (/^```/u.test(lineText.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    const match = lineText.match(/^(#{1,6})\s+(.+)$/u);
    if (!match) {
      continue;
    }
    headings.push({
      level: match[1].length,
      text: match[2].trim(),
      lineIndex
    });
  }
  return headings;
}

function getExpectedSchemaDisplayHeading(validationKind: TraceableEditorValidationKind | undefined): string | undefined {
  switch (validationKind) {
    case "root-schema":
      return "Root";
    case "topic-schema":
      return "Topic";
    case "decision-schema":
      return "Decision";
    case "task-schema":
      return "Task";
    case "evidence-schema":
      return "Evidence";
    case "pointer-schema":
      return "Pointer";
    default:
      return undefined;
  }
}

function getSchemaValidationResultForDocument(document: vscode.TextDocument): TraceableSchemaValidationResult | undefined {
  const validationKind = getTraceableEditorValidationKindForFsPath(document.uri.fsPath);
  if (!validationKind || validationKind === "continuity-trace" || validationKind === "schema-generic" || validationKind === "validator-generic") {
    return undefined;
  }
  const readTextFileSync = (filePath: string): string => normalizeComparableFsPath(filePath) === normalizeComparableFsPath(document.uri.fsPath)
    ? document.getText()
    : readFileSync(filePath, "utf8");
  if (validationKind === "root-schema") {
    return validateTraceableRootSchemaSync({ filePath: document.uri.fsPath, readTextFileSync });
  }
  if (validationKind === "topic-schema") {
    return validateTraceableTopicSchemaSync({ filePath: document.uri.fsPath, readTextFileSync });
  }
  if (validationKind === "task-schema") {
    return validateTraceableTaskSchemaSync({ filePath: document.uri.fsPath, readTextFileSync });
  }
  if (validationKind === "evidence-schema") {
    return validateTraceableEvidenceSchemaSync({ filePath: document.uri.fsPath, readTextFileSync });
  }
  if (validationKind === "pointer-schema") {
    return validateTraceablePointerSchemaSync({ filePath: document.uri.fsPath, readTextFileSync });
  }
  return validateTraceableDecisionSchemaSync({ filePath: document.uri.fsPath, readTextFileSync });
}

function createNormalizeSchemaDisplayHeadingEdit(document: vscode.TextDocument): vscode.WorkspaceEdit | undefined {
  const expectedHeading = getExpectedSchemaDisplayHeading(getTraceableEditorValidationKindForFsPath(document.uri.fsPath));
  if (!expectedHeading) {
    return undefined;
  }
  const titleHeading = collectDocumentMarkdownHeadings(document)
    .find((heading) => heading.level === 1 && heading.text !== "Continuity Context" && heading.text !== "Continuity Integrity");
  if (!titleHeading) {
    return undefined;
  }
  const line = document.lineAt(titleHeading.lineIndex);
  const expectedLine = `# ${expectedHeading}`;
  if (line.text.trim() === expectedLine) {
    return undefined;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, line.range, expectedLine);
  return edit;
}

function createInsertMissingSchemaHeadingEdit(
  document: vscode.TextDocument,
  finding: TraceableSchemaValidationResult["findings"][number]
): vscode.WorkspaceEdit | undefined {
  const expectedHeading = finding.placement?.expectedHeading;
  const headingLevel = finding.placement?.headingLevel ?? 2;
  if (!expectedHeading) {
    return undefined;
  }
  const headings = collectDocumentMarkdownHeadings(document);
  const anchorAfterHeading = finding.placement?.anchorAfterHeading
    ? headings.find((heading) => heading.text === finding.placement?.anchorAfterHeading)
    : undefined;
  const anchorBeforeHeading = finding.placement?.anchorBeforeHeading
    ? headings.find((heading) => heading.text === finding.placement?.anchorBeforeHeading)
    : undefined;
  const newHeadingLine = `${"#".repeat(headingLevel)} ${expectedHeading}`;
  const insertionText = `\n${newHeadingLine}\n`;
  const edit = new vscode.WorkspaceEdit();

  if (anchorAfterHeading) {
    edit.insert(document.uri, new vscode.Position(anchorAfterHeading.lineIndex, 0), insertionText);
    return edit;
  }
  if (anchorBeforeHeading) {
    edit.insert(document.uri, new vscode.Position(anchorBeforeHeading.lineIndex + 1, 0), insertionText);
    return edit;
  }
  return undefined;
}

function normalizeDiagnosticCode(code: vscode.Diagnostic["code"]): string | undefined {
  if (typeof code === "string") {
    return code;
  }
  if (typeof code === "number") {
    return String(code);
  }
  if (code && typeof code === "object" && "value" in code) {
    return typeof code.value === "string" || typeof code.value === "number" ? String(code.value) : undefined;
  }
  return undefined;
}

const ROOT_SCHEMA_CONTRACT_GROUP_HEADINGS = [
  "Machine Authority Surfaces",
  "Contract Syntax",
  "Named Declaration",
  "Contract Category Extension",
  "Document Layout",
  "Continuity Context",
  "Parent",
  "Parent Origin",
  "Current",
  "Schema Reference Fields",
  "Trace Field",
  "Created At",
  "Envelope Extension",
  "Continuity Integrity Footer",
  "Method Entry",
  "Extension",
  "Optional Machine Sections"
];

const TOPIC_SCHEMA_CONTRACT_GROUP_HEADINGS = [
  "Topic Scope",
  "Topic Body",
  "Topic Envelope Companions",
  "File Naming",
  "Interpretation Boundaries"
];

const TOPIC_SCHEMA_ARTIFACT_CONTRACT_GROUP_HEADINGS = [
  "Prompt Fields",
  "Template Body"
];

const TRACEABLE_CONTRACT_CATEGORY_LABELS = [
  "Allowed Labels",
  "Allowed Shapes",
  "Allowed Target Blocks",
  "Applies To",
  "Category Shape",
  "Declaration Fields",
  "Entry Shape",
  "Fields",
  "Footer Sections",
  "Generation Authority",
  "Group Shape",
  "Header Sections",
  "Integrity Authority",
  "Known Category Labels",
  "List Marker",
  "Non-Authoritative For Validation",
  "Optional Fields",
  "Optional Sections",
  "Ordering",
  "Required Entries",
  "Required Fields",
  "Required Heading",
  "Required Shape",
  "Required When",
  "Rules",
  "Towards Allowed Shapes",
  "Validation Authority"
];

function formatTraceableCurrentUtcTimestamp(): string {
  const now = new Date();
  const year = String(now.getUTCFullYear()).padStart(4, "0");
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const hour = String(now.getUTCHours()).padStart(2, "0");
  const minute = String(now.getUTCMinutes()).padStart(2, "0");
  const second = String(now.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function getNearestTraceableLabel(candidate: string, knownLabels: readonly string[]): string | undefined {
  const normalizedCandidate = candidate.trim().toLowerCase();
  if (!normalizedCandidate) {
    return undefined;
  }
  const computeDistance = (left: string, right: string): number => {
    const rows = Array.from({ length: left.length + 1 }, () => new Array<number>(right.length + 1).fill(0));
    for (let row = 0; row <= left.length; row += 1) rows[row][0] = row;
    for (let column = 0; column <= right.length; column += 1) rows[0][column] = column;
    for (let row = 1; row <= left.length; row += 1) {
      for (let column = 1; column <= right.length; column += 1) {
        const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
        rows[row][column] = Math.min(
          rows[row - 1][column] + 1,
          rows[row][column - 1] + 1,
          rows[row - 1][column - 1] + substitutionCost
        );
      }
    }
    return rows[left.length][right.length];
  };

  const ranked = knownLabels
    .map((label) => ({ label, distance: computeDistance(normalizedCandidate, label.toLowerCase()) }))
    .sort((left, right) => left.distance - right.distance || left.label.localeCompare(right.label));
  if (!ranked[0]) {
    return undefined;
  }
  const threshold = Math.max(1, Math.ceil(normalizedCandidate.length / 4));
  if (ranked[0].distance > threshold) {
    return undefined;
  }
  if (ranked[1] && ranked[1].distance === ranked[0].distance) {
    return undefined;
  }
  return ranked[0].label;
}

function getTraceableContractSectionForLine(document: vscode.TextDocument, lineIndex: number): "Schema Validation Contract" | "Artifact Creation Contract" | undefined {
  let activeSection: "Schema Validation Contract" | "Artifact Creation Contract" | undefined;
  let inFence = false;
  for (let index = 0; index <= Math.min(lineIndex, document.lineCount - 1); index += 1) {
    const lineText = document.lineAt(index).text.trim();
    if (/^```/u.test(lineText)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    if (lineText === "## Schema Validation Contract") {
      activeSection = "Schema Validation Contract";
      continue;
    }
    if (lineText === "## Artifact Creation Contract") {
      activeSection = "Artifact Creation Contract";
      continue;
    }
    if (/^##\s+/u.test(lineText) || /^#\s+/u.test(lineText) || lineText === "---") {
      activeSection = undefined;
    }
  }
  return activeSection;
}

function createSetCurrentCreatedAtEdit(document: vscode.TextDocument, replaceExistingLine: boolean): vscode.WorkspaceEdit | undefined {
  const timestamp = formatTraceableCurrentUtcTimestamp();
  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex += 1) {
    const lineText = document.lineAt(lineIndex).text.trim();
    if (lineText === "- Current") {
      const nextLineIndex = Math.min(lineIndex + 1, Math.max(document.lineCount - 1, 0));
      const nextLine = document.lineAt(nextLineIndex);
      const createdAtMatch = nextLine.text.match(/^(\s*)- Created At:\s+.*$/u);
      const edit = new vscode.WorkspaceEdit();
      if (replaceExistingLine && createdAtMatch) {
        edit.replace(document.uri, nextLine.range, `${createdAtMatch[1]}- Created At: ${timestamp}`);
        return edit;
      }
      if (!replaceExistingLine) {
        const indentation = nextLine.text.match(/^(\s*)-/u)?.[1] ?? "  ";
        edit.insert(document.uri, new vscode.Position(lineIndex + 1, 0), `${indentation}- Created At: ${timestamp}\n`);
        return edit;
      }
    }
  }
  return undefined;
}

function readTraceablePermalinkTargetMarkdownForDocument(document: vscode.TextDocument, permalinkTarget: string): string | undefined {
  const permalink = parseGitHubCommitPermalink(permalinkTarget);
  if (!permalink) {
    return undefined;
  }
  const gitRoot = resolveTraceableGitRootForRepoSlug(permalink.repoSlug) ?? resolveTraceableGitRoot(document.uri.fsPath);
  if (!gitRoot) {
    return undefined;
  }
  if (readTraceableRepoSlugForGitRoot(gitRoot) !== permalink.repoSlug) {
    return undefined;
  }
  try {
    return execFileSync("git", ["-C", gitRoot, "show", `${permalink.revision}:${permalink.relativePath}`], { encoding: "utf8" });
  } catch {
    return undefined;
  }
}

function readTraceableLatestMarkdownForPermalinkTarget(
  document: vscode.TextDocument,
  permalinkTarget: string,
  options?: { allowRemoteQuery?: boolean }
): string | undefined {
  const permalink = parseGitHubCommitPermalink(permalinkTarget);
  if (!permalink) {
    return undefined;
  }
  const gitRoot = resolveTraceableGitRootForRepoSlug(permalink.repoSlug) ?? resolveTraceableGitRoot(document.uri.fsPath);
  if (!gitRoot) {
    return undefined;
  }
  if (readTraceableRepoSlugForGitRoot(gitRoot) !== permalink.repoSlug) {
    return undefined;
  }

  const allowRemoteQuery = options?.allowRemoteQuery !== false;
  for (const branchName of listTraceableLatestBranchCandidates(gitRoot, { allowRemoteQuery })) {
    const commitHash = resolveTraceableCommitHashForBranch(gitRoot, branchName, { allowRemoteQuery });
    if (!commitHash || !gitRefExistsAtPath(gitRoot, commitHash, permalink.relativePath)) {
      continue;
    }
    try {
      return execFileSync("git", ["-C", gitRoot, "show", `${commitHash}:${permalink.relativePath}`], { encoding: "utf8" });
    } catch {
      continue;
    }
  }
  return undefined;
}

function readTraceableLocalTargetMarkdownForDocument(document: vscode.TextDocument, reference: string): string | undefined {
  const trimmed = reference.trim();
  if (!trimmed) {
    return undefined;
  }
  const resolvedPath = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(path.dirname(document.uri.fsPath), trimmed);
  try {
    return readFileSync(resolvedPath, "utf8");
  } catch {
    return undefined;
  }
}

function collectTraceableParentReferenceTargets(document: vscode.TextDocument): {
  parentTraceTarget?: string;
  parentOriginRelative?: string;
  parentOriginAbsolute?: string;
  parentOriginBrowseGitTarget?: string;
} {
  let parentTraceTarget: string | undefined;
  let parentOriginRelative: string | undefined;
  let parentOriginAbsolute: string | undefined;
  let parentOriginBrowseGitTarget: string | undefined;
  let inParentBlock = false;
  let inParentOriginBlock = false;

  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex += 1) {
    const lineText = document.lineAt(lineIndex).text;
    const trimmed = lineText.trim();
    if (trimmed === "- Parent") {
      inParentBlock = true;
      inParentOriginBlock = false;
      continue;
    }
    if (inParentBlock && !lineText.startsWith("  ") && trimmed) {
      break;
    }
    if (!inParentBlock) {
      continue;
    }
    if (trimmed === "- Origin:") {
      inParentOriginBlock = true;
      continue;
    }
    if (trimmed.startsWith("- Trace:")) {
      parentTraceTarget = trimmed.match(/\((.*?)\)/u)?.[1]?.trim() || parentTraceTarget;
      inParentOriginBlock = false;
      continue;
    }
    if (!inParentOriginBlock) {
      continue;
    }
    if (trimmed.startsWith("- [relative](")) {
      parentOriginRelative = trimmed.match(/\((.*?)\)/u)?.[1]?.trim() || parentOriginRelative;
      continue;
    }
    if (trimmed.startsWith("- [absolute](")) {
      parentOriginAbsolute = trimmed.match(/\((.*?)\)/u)?.[1]?.trim() || parentOriginAbsolute;
      continue;
    }
    if (trimmed.startsWith("- [browse + git](")) {
      parentOriginBrowseGitTarget = trimmed.match(/\((.*?)\)/u)?.[1]?.trim() || parentOriginBrowseGitTarget;
      continue;
    }
  }

  return {
    parentTraceTarget,
    parentOriginRelative,
    parentOriginAbsolute,
    parentOriginBrowseGitTarget
  };
}

function readTraceableParentArtifactMarkdownForDocument(document: vscode.TextDocument): string | undefined {
  const references = collectTraceableParentReferenceTargets(document);
  return (references.parentTraceTarget ? readTraceableLocalTargetMarkdownForDocument(document, references.parentTraceTarget) : undefined)
    ?? (references.parentOriginRelative ? readTraceableLocalTargetMarkdownForDocument(document, references.parentOriginRelative) : undefined)
    ?? (references.parentOriginAbsolute ? readTraceableLocalTargetMarkdownForDocument(document, references.parentOriginAbsolute) : undefined)
    ?? (references.parentOriginBrowseGitTarget ? readTraceablePermalinkTargetMarkdownForDocument(document, references.parentOriginBrowseGitTarget) : undefined);
}

function normalizeGitHubRepoSlugFromRemoteUrl(remoteUrl: string): string | undefined {
  const trimmed = remoteUrl.trim();
  const sshMatch = trimmed.match(/^git@github\.com:(.+?)(?:\.git)?$/iu);
  if (sshMatch) {
    return sshMatch[1];
  }
  const httpsMatch = trimmed.match(/^https:\/\/github\.com\/(.+?)(?:\.git)?$/iu);
  return httpsMatch?.[1];
}

function parseGitHubCommitPermalink(target: string): { repoSlug: string; revision: string; relativePath: string } | undefined {
  const trimmed = target.trim();
  const githubMatch = trimmed.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/(?:blob|raw)\/([0-9a-f]{7,40})\/(.+)$/iu);
  if (githubMatch) {
    return {
      repoSlug: githubMatch[1],
      revision: githubMatch[2],
      relativePath: decodeURIComponent(githubMatch[3])
    };
  }
  const rawMatch = trimmed.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/([0-9a-f]{7,40})\/(.+)$/iu);
  if (rawMatch) {
    return {
      repoSlug: rawMatch[1],
      revision: rawMatch[2],
      relativePath: decodeURIComponent(rawMatch[3])
    };
  }
  return undefined;
}

function parseGitHubBlobLikeTarget(target: string): { repoSlug: string; revision: string; relativePath: string } | undefined {
  const trimmed = target.trim();
  const githubMatch = trimmed.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/(?:blob|raw)\/([^/]+)\/(.+)$/iu);
  if (githubMatch) {
    return {
      repoSlug: githubMatch[1],
      revision: decodeURIComponent(githubMatch[2]),
      relativePath: decodeURIComponent(githubMatch[3])
    };
  }
  const rawMatch = trimmed.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/([^/]+)\/(.+)$/iu);
  if (rawMatch) {
    return {
      repoSlug: rawMatch[1],
      revision: decodeURIComponent(rawMatch[2]),
      relativePath: decodeURIComponent(rawMatch[3])
    };
  }
  return undefined;
}

function isRefreshableTraceablePermalinkDiagnosticCode(code: string): boolean {
  return [
    "traceable-envelope-schema-permalink-required",
    "traceable-envelope-schema-unreadable",
    "traceable-current-schema-permalink-required",
    "traceable-current-schema-unreadable",
    "traceable-parent-schema-permalink-required",
    "traceable-parent-schema-unreadable",
    "traceable-current-origin-browse-git-permalink-required",
    "traceable-current-origin-browse-git-unreadable",
    "continuity-footer-towards-permalink-required",
    "continuity-footer-towards-unreadable",
    "root-schema-envelope-schema-unreadable",
    "root-schema-current-schema-unreadable",
    "topic-schema-envelope-schema-unreadable",
    "topic-schema-current-schema-unreadable",
    "topic-schema-parent-schema-unreadable",
    "topic-schema-parent-origin-unpinned-browse-git",
    "topic-schema-parent-origin-browse-git-mismatch",
    "topic-schema-footer-target-mismatch",
    "topic-schema-footer-target-not-permalink",
    "decision-schema-envelope-schema-unreadable",
    "decision-schema-current-schema-unreadable",
    "decision-schema-parent-schema-unreadable",
    "decision-schema-parent-origin-unpinned-browse-git",
    "decision-schema-parent-origin-browse-git-mismatch",
    "decision-schema-footer-target-mismatch",
    "decision-schema-footer-target-not-permalink",
    "task-schema-envelope-schema-unreadable",
    "task-schema-current-schema-unreadable",
    "task-schema-parent-schema-unreadable",
    "task-schema-parent-origin-unpinned-browse-git",
    "task-schema-parent-origin-browse-git-mismatch",
    "task-schema-footer-target-mismatch",
    "task-schema-footer-target-not-permalink",
    "evidence-schema-envelope-schema-unreadable",
    "evidence-schema-current-schema-unreadable",
    "evidence-schema-parent-schema-unreadable",
    "evidence-schema-parent-origin-unpinned-browse-git",
    "evidence-schema-parent-origin-browse-git-mismatch",
    "evidence-schema-footer-target-mismatch",
    "evidence-schema-footer-target-not-permalink",
    "pointer-schema-envelope-schema-unreadable",
    "pointer-schema-current-schema-unreadable",
    "pointer-schema-parent-schema-unreadable",
    "pointer-schema-parent-origin-unpinned-browse-git",
    "pointer-schema-parent-origin-browse-git-mismatch",
    "pointer-schema-footer-target-mismatch",
    "pointer-schema-footer-target-not-permalink"
  ].includes(code);
}

function isRefreshableTraceablePermalinkFieldKey(fieldKey: string | undefined): boolean {
  return fieldKey === "envelope-schema"
    || fieldKey === "parent-schema"
    || fieldKey === "current-schema"
    || fieldKey === "parent-origin-browse-git"
    || fieldKey === "current-origin-browse-git"
    || fieldKey === "footer-towards";
}

function getTraceablePermalinkRefreshFieldKey(lines: readonly string[], targetLineIndex: number): string | undefined {
  if (targetLineIndex < 0 || targetLineIndex >= lines.length) {
    return undefined;
  }
  const trimmed = lines[targetLineIndex].trim();
  if (trimmed.startsWith("- Envelope Schema:")) {
    return "envelope-schema";
  }
  if (trimmed.startsWith("- Parent Schema:")) {
    return "parent-schema";
  }
  if (trimmed.startsWith("- Current Schema:")) {
    return "current-schema";
  }
  if (trimmed.startsWith("- Towards:")) {
    return "footer-towards";
  }
  if (!trimmed.startsWith("- [browse + git](")) {
    return undefined;
  }
  let currentTopLevel: "parent" | "current" | undefined;
  let inOriginBlock = false;
  for (let index = 0; index <= targetLineIndex; index += 1) {
    const lineText = lines[index];
    const currentTrimmed = lineText.trim();
    if (currentTrimmed === "- Parent") {
      currentTopLevel = "parent";
      inOriginBlock = false;
      continue;
    }
    if (currentTrimmed === "- Current") {
      currentTopLevel = "current";
      inOriginBlock = false;
      continue;
    }
    if (/^(?: {2,}|\t+)-\s+Origin:\s*$/u.test(lineText)) {
      inOriginBlock = true;
      continue;
    }
    if (inOriginBlock && /^(?: {4,}|\t{2,})-\s+.+/u.test(lineText)) {
      continue;
    }
    if ((currentTopLevel === "parent" || currentTopLevel === "current") && /^(?: {2,}|\t+)-\s+(?!Origin:).+/u.test(lineText)) {
      inOriginBlock = false;
    }
  }
  if (!inOriginBlock) {
    return undefined;
  }
  return currentTopLevel === "parent" ? "parent-origin-browse-git" : currentTopLevel === "current" ? "current-origin-browse-git" : undefined;
}

function getTraceablePermalinkRefreshFieldOccurrence(lines: readonly string[], targetLineIndex: number, fieldKey: string): number {
  let occurrence = 0;
  for (let index = 0; index <= targetLineIndex; index += 1) {
    if (getTraceablePermalinkRefreshFieldKey(lines, index) === fieldKey) {
      occurrence += 1;
    }
  }
  return Math.max(occurrence - 1, 0);
}

function findTraceablePermalinkRefreshLineInLatest(currentLines: readonly string[], latestLines: readonly string[], targetLineIndex: number): string | undefined {
  const fieldKey = getTraceablePermalinkRefreshFieldKey(currentLines, targetLineIndex);
  if (!fieldKey) {
    return undefined;
  }
  const targetOccurrence = getTraceablePermalinkRefreshFieldOccurrence(currentLines, targetLineIndex, fieldKey);
  let latestOccurrence = 0;
  for (let index = 0; index < latestLines.length; index += 1) {
    if (getTraceablePermalinkRefreshFieldKey(latestLines, index) !== fieldKey) {
      continue;
    }
    if (latestOccurrence === targetOccurrence) {
      return latestLines[index];
    }
    latestOccurrence += 1;
  }
  return undefined;
}

function extractFirstMarkdownLinkTarget(lineText: string): string | undefined {
  const match = lineText.match(/\[[^\]]*\]\(([^)]+)\)/u);
  return match?.[1]?.trim();
}

function replaceFirstMarkdownLinkTarget(lineText: string, nextTarget: string): string | undefined {
  const match = lineText.match(/(\[[^\]]*\]\()([^)]+)(\))/u);
  if (!match) {
    return undefined;
  }
  return `${lineText.slice(0, match.index ?? 0)}${match[1]}${nextTarget}${match[3]}${lineText.slice((match.index ?? 0) + match[0].length)}`;
}

const traceableBranchCommitCache = new Map<string, string | undefined>();
const traceableGitRootRepoSlugCache = new Map<string, string | undefined>();
const traceableRepoSlugGitRootCache = new Map<string, string | undefined>();

function clearTraceableLatestPermalinkCaches(): void {
  traceableGitRootRepoSlugCache.clear();
  traceableRepoSlugGitRootCache.clear();
  traceableBranchCommitCache.clear();
}

function readTraceableRepoSlugForGitRoot(gitRoot: string): string | undefined {
  if (traceableGitRootRepoSlugCache.has(gitRoot)) {
    return traceableGitRootRepoSlugCache.get(gitRoot);
  }
  let repoSlug: string | undefined;
  try {
    const remoteUrl = execFileSync("git", ["-C", gitRoot, "config", "--get", "remote.origin.url"], { encoding: "utf8" }).trim();
    repoSlug = normalizeGitHubRepoSlugFromRemoteUrl(remoteUrl);
  } catch {
    repoSlug = undefined;
  }
  traceableGitRootRepoSlugCache.set(gitRoot, repoSlug);
  if (repoSlug && !traceableRepoSlugGitRootCache.has(repoSlug)) {
    traceableRepoSlugGitRootCache.set(repoSlug, gitRoot);
  }
  return repoSlug;
}

function gitRefExistsAtPath(gitRoot: string, revision: string, relativePath: string): boolean {
  try {
    execFileSync("git", ["-C", gitRoot, "cat-file", "-e", `${revision}:${relativePath}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function resolveTraceableGitRootForRepoSlug(repoSlug: string): string | undefined {
  const normalizedRepoSlug = repoSlug.trim();
  if (!normalizedRepoSlug) {
    return undefined;
  }
  if (traceableRepoSlugGitRootCache.has(normalizedRepoSlug)) {
    return traceableRepoSlugGitRootCache.get(normalizedRepoSlug);
  }
  const seen = new Set<string>();
  for (const workspaceFolder of vscode.workspace.workspaceFolders ?? []) {
    const gitRoot = resolveTraceableGitRoot(workspaceFolder.uri.fsPath);
    if (!gitRoot || seen.has(gitRoot)) {
      continue;
    }
    seen.add(gitRoot);
    if (readTraceableRepoSlugForGitRoot(gitRoot) === normalizedRepoSlug) {
      traceableRepoSlugGitRootCache.set(normalizedRepoSlug, gitRoot);
      return gitRoot;
    }
  }
  traceableRepoSlugGitRootCache.set(normalizedRepoSlug, undefined);
  return undefined;
}

function resolveTraceableCommitHashForBranch(
  gitRoot: string,
  branchName: string,
  options?: { allowRemoteQuery?: boolean }
): string | undefined {
  const allowRemoteQuery = options?.allowRemoteQuery !== false;
  const cacheKey = `${gitRoot}::${branchName}::${allowRemoteQuery ? "remote" : "local"}`;
  if (traceableBranchCommitCache.has(cacheKey)) {
    return traceableBranchCommitCache.get(cacheKey);
  }
  for (const ref of [`origin/${branchName}`, `refs/remotes/origin/${branchName}`, branchName, `refs/heads/${branchName}`]) {
    try {
      const commitHash = execFileSync("git", ["-C", gitRoot, "rev-parse", ref], { encoding: "utf8" }).trim();
      if (/^[0-9a-f]{40}$/iu.test(commitHash)) {
        traceableBranchCommitCache.set(cacheKey, commitHash);
        return commitHash;
      }
    } catch {
      continue;
    }
  }
  if (!allowRemoteQuery) {
    traceableBranchCommitCache.set(cacheKey, undefined);
    return undefined;
  }
  try {
    const output = execFileSync("git", ["-C", gitRoot, "ls-remote", "origin", `refs/heads/${branchName}`], { encoding: "utf8" }).trim();
    const commitHash = output.split(/\s+/u)[0]?.trim();
    if (commitHash && /^[0-9a-f]{40}$/iu.test(commitHash)) {
      traceableBranchCommitCache.set(cacheKey, commitHash);
      return commitHash;
    }
  } catch {
    // Ignore remote lookup failures and let the caller try other branches.
  }
  traceableBranchCommitCache.set(cacheKey, undefined);
  return undefined;
}

function encodeGitHubPath(relativePath: string): string {
  return relativePath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function tryResolveTraceableLatestPermalinkForTarget(
  document: vscode.TextDocument,
  linkTarget: string,
  options?: { allowRemoteQuery?: boolean }
): string | undefined {
  const permalink = parseGitHubBlobLikeTarget(linkTarget);
  let repoSlug: string | undefined;
  let gitRoot: string | undefined;
  let relativePath: string | undefined;
  const allowRemoteQuery = options?.allowRemoteQuery !== false;

  if (permalink) {
    repoSlug = permalink.repoSlug;
    relativePath = permalink.relativePath;
    gitRoot = resolveTraceableGitRootForRepoSlug(repoSlug);
  } else if (!/^[a-z]+:\/\//iu.test(linkTarget)) {
    const resolvedTargetPath = path.resolve(path.dirname(document.uri.fsPath), linkTarget);
    gitRoot = resolveTraceableGitRoot(resolvedTargetPath);
    if (gitRoot) {
      relativePath = path.relative(gitRoot, resolvedTargetPath).replace(/\\+/gu, "/");
      repoSlug = readTraceableRepoSlugForGitRoot(gitRoot);
    }
  }

  if (!repoSlug || !gitRoot || !relativePath || relativePath.startsWith("../")) {
    return undefined;
  }

  for (const branchName of listTraceableLatestBranchCandidates(gitRoot, { allowRemoteQuery })) {
    const commitHash = resolveTraceableCommitHashForBranch(gitRoot, branchName, { allowRemoteQuery });
    if (!commitHash || !gitRefExistsAtPath(gitRoot, commitHash, relativePath)) {
      continue;
    }
    return `https://github.com/${repoSlug}/blob/${commitHash}/${encodeGitHubPath(relativePath)}`;
  }
  return undefined;
}

function buildSchemaIdentityFileNameCandidates(identity: string): string[] {
  const trimmed = identity.trim();
  if (!trimmed) {
    return [];
  }
  const candidates = new Set<string>([`${trimmed}.schema.md`]);
  const parts = trimmed.split(".").filter(Boolean);
  const versionIndex = parts.findIndex((part) => /^v\d+$/iu.test(part));
  if (versionIndex >= 0 && versionIndex < parts.length - 1) {
    const reordered = [...parts.slice(0, versionIndex), ...parts.slice(versionIndex + 1), parts[versionIndex]].join(".");
    candidates.add(`${reordered}.schema.md`);
  }
  return Array.from(candidates);
}

async function findLikelyLocalSchemaTargetForIdentity(document: vscode.TextDocument, identity: string | undefined): Promise<string | undefined> {
  const trimmed = identity?.trim();
  if (!trimmed) {
    return undefined;
  }
  for (const candidateName of buildSchemaIdentityFileNameCandidates(trimmed)) {
    const matches = await vscode.workspace.findFiles(`**/${candidateName}`, undefined, 5);
    if (matches.length > 0) {
      return matches[0].fsPath;
    }
  }
  return undefined;
}

async function resolveTraceableRefreshSeedTarget(document: vscode.TextDocument, lineIndex: number): Promise<string | undefined> {
  const lineText = document.lineAt(lineIndex).text;
  const directTarget = extractFirstMarkdownLinkTarget(lineText);
  if (directTarget) {
    const directResolved = tryResolveTraceableLatestPermalinkForTarget(document, directTarget);
    if (directResolved) {
      return directTarget;
    }
  }

  const fieldKey = getTraceablePermalinkRefreshFieldKey(
    Array.from({ length: document.lineCount }, (_, index) => document.lineAt(index).text),
    lineIndex
  );
  if (!fieldKey) {
    return undefined;
  }

  const parsed = parseTraceableContinuityMarkdown(document.getText());
  switch (fieldKey) {
    case "envelope-schema":
      return parsed.envelopeSchema?.target
        || await findLikelyLocalSchemaTargetForIdentity(document, parsed.envelopeSchema?.label);
    case "parent-schema":
      return parsed.parentSchema?.target
        || parsed.parentOrigin?.relative
        || parsed.parentOrigin?.absolute
        || await findLikelyLocalSchemaTargetForIdentity(document, parsed.parentSchema?.label);
    case "current-schema":
      return parsed.currentSchema?.target
        || parsed.currentOrigin?.relative
        || parsed.currentOrigin?.absolute
        || await findLikelyLocalSchemaTargetForIdentity(document, parsed.currentSchema?.label);
    case "parent-origin-browse-git":
      return parsed.parentOrigin?.relative
        || parsed.parentOrigin?.absolute
        || parsed.parentTrace?.target
        || parsed.parentSchema?.target
        || await findLikelyLocalSchemaTargetForIdentity(document, parsed.parentSchema?.label);
    case "current-origin-browse-git":
      return parsed.currentOrigin?.relative
        || parsed.currentOrigin?.absolute
        || parsed.currentSchema?.target
        || await findLikelyLocalSchemaTargetForIdentity(document, parsed.currentSchema?.label);
    case "footer-towards":
      return parsed.footerIntegrity?.towardsTarget;
    default:
      return undefined;
  }
}

function resolveTraceableOriginDefaultBranch(gitRoot: string): string | undefined {
  try {
    const symbolicRef = execFileSync("git", ["-C", gitRoot, "symbolic-ref", "refs/remotes/origin/HEAD"], { encoding: "utf8" }).trim();
    const match = symbolicRef.match(/^refs\/remotes\/origin\/(.+)$/u);
    return match?.[1]?.trim();
  } catch {
    return undefined;
  }
}

function resolveTraceableOriginHeadBranchViaRemote(gitRoot: string): string | undefined {
  try {
    const output = execFileSync("git", ["-C", gitRoot, "ls-remote", "--symref", "origin", "HEAD"], { encoding: "utf8" });
    const match = output.match(/^ref:\s+refs\/heads\/(.+)\s+HEAD$/mu);
    return match?.[1]?.trim();
  } catch {
    return undefined;
  }
}

function resolveTraceableUpstreamBranchName(gitRoot: string): string | undefined {
  try {
    const upstream = execFileSync("git", ["-C", gitRoot, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], { encoding: "utf8" }).trim();
    const match = upstream.match(/^origin\/(.+)$/u);
    return match?.[1]?.trim();
  } catch {
    return undefined;
  }
}

function listTraceableLatestBranchCandidates(
  gitRoot: string,
  options?: { allowRemoteQuery?: boolean }
): string[] {
  const allowRemoteQuery = options?.allowRemoteQuery !== false;
  const candidates = [
    resolveTraceableOriginDefaultBranch(gitRoot),
    allowRemoteQuery ? resolveTraceableOriginHeadBranchViaRemote(gitRoot) : undefined,
    resolveTraceableUpstreamBranchName(gitRoot),
    "master",
    "main",
  ];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function readHttpsText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = httpsGet(url, {
      headers: {
        "User-Agent": "Tiinex-AI-Provenance"
      }
    }, (response) => {
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode ?? "unknown"} while reading ${url}`));
        return;
      }
      response.setEncoding("utf8");
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => resolve(body));
    });
    request.on("error", reject);
  });
}

async function readTraceableLatestMarkdownForDocument(
  document: vscode.TextDocument,
  options?: { allowRemoteQuery?: boolean; allowHttpFetch?: boolean }
): Promise<string | undefined> {
  const gitRoot = resolveTraceableGitRoot(document.uri.fsPath);
  if (!gitRoot) {
    return undefined;
  }
  const relativePath = path.relative(gitRoot, document.uri.fsPath).replace(/\\+/gu, "/");
  if (!relativePath || relativePath.startsWith("../")) {
    return undefined;
  }
  try {
    const remoteUrl = execFileSync("git", ["-C", gitRoot, "config", "--get", "remote.origin.url"], { encoding: "utf8" }).trim();
    const repoSlug = normalizeGitHubRepoSlugFromRemoteUrl(remoteUrl);
    if (!repoSlug) {
      return undefined;
    }
    const allowRemoteQuery = options?.allowRemoteQuery !== false;
    const allowHttpFetch = options?.allowHttpFetch !== false;
    const encodedPath = relativePath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
    for (const branchName of listTraceableLatestBranchCandidates(gitRoot, { allowRemoteQuery })) {
      const localCommitHash = resolveTraceableCommitHashForBranch(gitRoot, branchName, { allowRemoteQuery });
      if (localCommitHash && gitRefExistsAtPath(gitRoot, localCommitHash, relativePath)) {
        try {
          return execFileSync("git", ["-C", gitRoot, "show", `${localCommitHash}:${relativePath}`], { encoding: "utf8" });
        } catch {
          // Fall through to HTTP if the local object is not readable.
        }
      }
      if (!allowHttpFetch) {
        continue;
      }
      try {
        return await readHttpsText(`https://raw.githubusercontent.com/${repoSlug}/${encodeURIComponent(branchName)}/${encodedPath}`);
      } catch {
        continue;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

async function createRefreshTraceablePermalinkFromLatestEdit(document: vscode.TextDocument, lineIndex: number): Promise<vscode.WorkspaceEdit | undefined> {
  if (lineIndex < 0 || lineIndex >= document.lineCount) {
    return undefined;
  }
  const currentLine = document.lineAt(lineIndex);
  const currentTarget = await resolveTraceableRefreshSeedTarget(document, lineIndex);
  if (currentTarget) {
    const refreshedTarget = tryResolveTraceableLatestPermalinkForTarget(document, currentTarget);
    if (!refreshedTarget || !parseGitHubCommitPermalink(refreshedTarget)) {
      return undefined;
    }
    const replacementLine = replaceFirstMarkdownLinkTarget(currentLine.text, refreshedTarget);
    if (!replacementLine || replacementLine === currentLine.text) {
      return undefined;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, currentLine.range, replacementLine);
    return edit;
  }

  const currentLines = Array.from({ length: document.lineCount }, (_, index) => document.lineAt(index).text);
  const latestMarkdown = await readTraceableLatestMarkdownForDocument(document);
  if (!latestMarkdown) {
    return undefined;
  }
  const latestLines = latestMarkdown.replace(/\r\n?/gu, "\n").split("\n");
  const replacementLine = findTraceablePermalinkRefreshLineInLatest(currentLines, latestLines, lineIndex);
  if (!replacementLine) {
    return undefined;
  }
  const replacementTarget = extractFirstMarkdownLinkTarget(replacementLine);
  if (!replacementTarget || !parseGitHubCommitPermalink(replacementTarget) || currentLine.text === replacementLine) {
    return undefined;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, currentLine.range, replacementLine);
  return edit;
}

async function refreshTraceablePermalinkFromLatest(output: vscode.OutputChannel, target?: vscode.Uri, lineIndex?: number, diagnosticCode?: string): Promise<void> {
  const artifactUri = resolveMarkdownArtifactUri(target);
  if (!artifactUri) {
    void vscode.window.showErrorMessage("Open a markdown continuity artifact first, or invoke the fix from a markdown file.");
    return;
  }
  if (typeof lineIndex !== "number" || lineIndex < 0) {
    void vscode.window.showErrorMessage("Could not resolve the permalink line for this quick fix.");
    return;
  }
  const document = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === artifactUri.toString())
    ?? await vscode.workspace.openTextDocument(artifactUri);
  const edit = await createRefreshTraceablePermalinkFromLatestEdit(document, lineIndex);
  if (!edit) {
    void vscode.window.showErrorMessage("Could not recover a refreshed permalink from the latest origin version of this file.");
    return;
  }
  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    void vscode.window.showErrorMessage("VS Code could not apply the permalink refresh edit.");
    return;
  }
  const updatedDocument = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === artifactUri.toString())
    ?? await vscode.workspace.openTextDocument(artifactUri);
  if (/^# Continuity Integrity\s*$/mu.test(updatedDocument.getText())) {
    await rotateTraceableContinuityChecksum(output, artifactUri);
  }
  output.appendLine(`Refreshed permalink from latest for ${artifactUri.fsPath}${diagnosticCode ? ` (${diagnosticCode})` : ""}`);
}

async function createRepairTraceableParentTraceTargetEdit(document: vscode.TextDocument): Promise<vscode.WorkspaceEdit | undefined> {
  const parsed = parseTraceableContinuityMarkdown(document.getText());
  const repairTarget = parsed.parentOrigin?.relative
    || parsed.parentOrigin?.absolute
    || parsed.parentSchema?.target
    || await findLikelyLocalSchemaTargetForIdentity(document, parsed.parentSchema?.label);
  if (!repairTarget) {
    return undefined;
  }
  const resolvedRepairPath = path.isAbsolute(repairTarget)
    ? repairTarget
    : path.resolve(path.dirname(document.uri.fsPath), repairTarget);
  let relativeTarget = path.relative(path.dirname(document.uri.fsPath), resolvedRepairPath).replace(/\\+/gu, "/");
  if (!relativeTarget || relativeTarget.startsWith("../") || relativeTarget.startsWith("./")) {
    // keep as-is
  } else {
    relativeTarget = `./${relativeTarget}`;
  }
  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex += 1) {
    const line = document.lineAt(lineIndex);
    if (!line.text.trim().startsWith("- Trace:")) {
      continue;
    }
    const replacementLine = replaceFirstMarkdownLinkTarget(line.text, relativeTarget);
    if (!replacementLine || replacementLine === line.text) {
      return undefined;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, line.range, replacementLine);
    return edit;
  }
  return undefined;
}

async function repairTraceableParentTraceTarget(output: vscode.OutputChannel, target?: vscode.Uri): Promise<void> {
  const artifactUri = resolveMarkdownArtifactUri(target);
  if (!artifactUri) {
    void vscode.window.showErrorMessage("Open a markdown continuity artifact first, or invoke the fix from a markdown file.");
    return;
  }
  const document = vscode.workspace.textDocuments.find((candidate) => candidate.uri.toString() === artifactUri.toString())
    ?? await vscode.workspace.openTextDocument(artifactUri);
  const edit = await createRepairTraceableParentTraceTargetEdit(document);
  if (!edit) {
    void vscode.window.showErrorMessage("Could not repair Parent Trace from the current continuity context.");
    return;
  }
  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    void vscode.window.showErrorMessage("VS Code could not apply the Parent Trace repair edit.");
    return;
  }
  output.appendLine(`Repaired Parent Trace target for ${artifactUri.fsPath}`);
}

function createInsertContinuityIntegrityFooterEdit(document: vscode.TextDocument): vscode.WorkspaceEdit | undefined {
  const parsed = parseTraceableContinuityMarkdown(document.getText());
  const hasParent = Boolean(
    parsed.parentCreatedAt?.trim()
    || parsed.parentTrace?.target?.trim()
    || parsed.parentSchema?.target?.trim()
    || parsed.parentSchema?.label?.trim()
    || parsed.parentOrigin?.relative?.trim()
    || parsed.parentOrigin?.absolute?.trim()
    || parsed.parentOrigin?.browseGit?.trim()
  );
  const comparisonTarget = hasParent
    ? parsed.parentOrigin?.browseGit?.trim() || parsed.parentTrace?.target?.trim() || parsed.currentSchema?.target?.trim()
    : undefined;
  const comparisonLabel = comparisonTarget
    ? parsed.parentTrace?.label?.trim()
      || parsed.currentSchema?.label?.trim()
      || path.posix.basename(comparisonTarget.split("/").pop() ?? "target")
    : undefined;
  const endOfLine = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";

  // Normalize current text into LF-delimited lines for trimming.
  const originalText = document.getText();
  const normalized = originalText.replace(/\r\n?/gu, "\n");
  const lines = normalized.split("\n");

  // Trim trailing empty lines and any trailing '---' separators so we don't
  // create duplicate separators or multiple blank lines when inserting.
  let lastContentLine = lines.length - 1;
  while (lastContentLine >= 0) {
    const t = (lines[lastContentLine] ?? "").trim();
    if (t === "" || t === "---") {
      lastContentLine -= 1;
      continue;
    }
    break;
  }

  const startLineIndex = Math.max(lastContentLine + 1, 0);

  const prefix = lines.slice(0, startLineIndex).join("\n");
  const computeForTarget = (method: string, towards: string, markdownPayload: string) => computeTargetedTraceableContinuityChecksumSha256(
    document.uri.fsPath,
    markdownPayload,
    { method, towardsTarget: towards },
    (filePath: string) => normalizeComparableFsPath(filePath) === normalizeComparableFsPath(document.uri.fsPath)
      ? markdownPayload
      : readFileSync(filePath, "utf8"),
    getTraceableOpenWorkspaceFolders()
  );
  const buildFooterLines = (targetValue: string, selfValue: string) => {
    const footerLines: string[] = [];
    if (lastContentLine >= 0) {
      footerLines.push("");
    }
    footerLines.push("---", "", "# Continuity Integrity", "");
    if (comparisonTarget && comparisonLabel) {
      footerLines.push(
        "- sha256-base64url-c14n-v1",
        `  - Towards: [${comparisonLabel}](${comparisonTarget})`,
        `  - Value: ${targetValue}`,
        ""
      );
    }
    footerLines.push(
      "- sha256-base64url-c14n-v2",
      "  - Towards: self",
      `  - Value: ${selfValue}`
    );
    return footerLines;
  };

  const initialFooterText = buildFooterLines("TARGET_PLACEHOLDER", "SELF_PLACEHOLDER").join("\n");
  const initialMarkdown = prefix.length === 0 ? initialFooterText : `${prefix}\n${initialFooterText}`;
  const targetChecksum = comparisonTarget
    ? computeForTarget("sha256-base64url-c14n-v1", comparisonTarget, initialMarkdown) ?? "TARGET_PLACEHOLDER"
    : "TARGET_PLACEHOLDER";
  const footerWithTargetText = buildFooterLines(targetChecksum, "SELF_PLACEHOLDER").join("\n");
  const markdownWithTarget = prefix.length === 0 ? footerWithTargetText : `${prefix}\n${footerWithTargetText}`;
  const selfChecksum = computeForTarget("sha256-base64url-c14n-v2", "self", markdownWithTarget) ?? "SELF_PLACEHOLDER";
  const footerFinalText = buildFooterLines(targetChecksum, selfChecksum).join("\n").replace(/\n/g, endOfLine);
  const edit = new vscode.WorkspaceEdit();
  const lastLine = Math.max(document.lineCount - 1, 0);
  if (startLineIndex <= lastLine) {
    edit.replace(document.uri, new vscode.Range(new vscode.Position(startLineIndex, 0), document.lineAt(lastLine).range.end), footerFinalText);
  } else {
    const lastCharacter = document.lineAt(lastLine).text.length;
    const insertionText = lastContentLine >= 0 ? `${endOfLine}${footerFinalText}` : footerFinalText;
    edit.insert(document.uri, new vscode.Position(lastLine, lastCharacter), insertionText);
  }
  return edit;
}

function createSetContinuityFooterTowardsEdit(document: vscode.TextDocument): vscode.WorkspaceEdit | undefined {
  const parsed = parseTraceableContinuityMarkdown(document.getText());
  const hasParent = Boolean(
    parsed.parentCreatedAt?.trim()
    || parsed.parentTrace?.target?.trim()
    || parsed.parentSchema?.target?.trim()
    || parsed.parentSchema?.label?.trim()
    || parsed.parentOrigin?.relative?.trim()
    || parsed.parentOrigin?.absolute?.trim()
    || parsed.parentOrigin?.browseGit?.trim()
  );
  const target = hasParent
    ? parsed.parentOrigin?.browseGit?.trim() || parsed.parentTrace?.target?.trim() || parsed.currentSchema?.target?.trim()
    : "self";
  if (!target) {
    return undefined;
  }
  const label = target === "self"
    ? "self"
    : parsed.parentTrace?.label?.trim()
      || parsed.currentSchema?.label?.trim()
      || path.posix.basename(target.split("/").pop() ?? "target");
  let towardsLineIndex: number | undefined;
  let valueLineIndex: number | undefined;
  let inIntegrityBlock = false;
  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex += 1) {
    const lineText = document.lineAt(lineIndex).text;
    const trimmed = lineText.trim();
    if (trimmed === "# Continuity Integrity") {
      inIntegrityBlock = true;
      continue;
    }
    if (inIntegrityBlock && /^#\s+/u.test(trimmed) && trimmed !== "# Continuity Integrity") {
      break;
    }
    if (!inIntegrityBlock) {
      continue;
    }
    if (trimmed.startsWith("- Towards:")) {
      towardsLineIndex = lineIndex;
      continue;
    }
    if (trimmed.startsWith("- Value:")) {
      valueLineIndex = lineIndex;
    }
  }
  if (towardsLineIndex === undefined || valueLineIndex === undefined) {
    return undefined;
  }
  const currentLines = Array.from({ length: document.lineCount }, (_, index) => document.lineAt(index).text);
  const towardsLine = document.lineAt(towardsLineIndex).text;
  const valueLine = document.lineAt(valueLineIndex).text;
  const towardsIndent = towardsLine.match(/^\s*/u)?.[0] ?? "";
  const valueIndent = valueLine.match(/^\s*/u)?.[0] ?? "";
  currentLines[towardsLineIndex] = `${towardsIndent}- Towards: [${label}](${target})`;
  currentLines[valueLineIndex] = `${valueIndent}- Value: PLACEHOLDER`;
  const nextMarkdown = currentLines.join("\n");
  const checksum = computeTargetedTraceableContinuityChecksumSha256(
    document.uri.fsPath,
    nextMarkdown,
    { towardsTarget: target },
    (filePath: string) => normalizeComparableFsPath(filePath) === normalizeComparableFsPath(document.uri.fsPath)
      ? nextMarkdown
      : readFileSync(filePath, "utf8"),
    getTraceableOpenWorkspaceFolders()
  );
  if (!checksum) {
    return undefined;
  }
  currentLines[valueLineIndex] = `${valueIndent}- Value: ${checksum}`;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, document.lineAt(towardsLineIndex).range, currentLines[towardsLineIndex]);
  edit.replace(document.uri, document.lineAt(valueLineIndex).range, currentLines[valueLineIndex]);
  return edit;
}

function createSetContinuityParentCreatedAtEdit(document: vscode.TextDocument): vscode.WorkspaceEdit | undefined {
  let parentCreatedAtLineIndex: number | undefined;
  let parentSchemaLineIndex: number | undefined;
  let inParentBlock = false;
  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex += 1) {
    const lineText = document.lineAt(lineIndex).text;
    const trimmed = lineText.trim();
    if (trimmed === "- Parent") {
      inParentBlock = true;
      continue;
    }
    if (inParentBlock && !lineText.startsWith("  ") && trimmed) {
      break;
    }
    if (!inParentBlock) {
      continue;
    }
    if (trimmed.startsWith("- Created At:")) {
      parentCreatedAtLineIndex = lineIndex;
      continue;
    }
    if (trimmed.startsWith("- Parent Schema:")) {
      parentSchemaLineIndex = lineIndex;
      continue;
    }
  }

  const parentCreatedAt = parseTraceableContinuityMarkdown(readTraceableParentArtifactMarkdownForDocument(document) ?? "").currentCreatedAt;
  if (!parentCreatedAt) {
    return undefined;
  }
  const edit = new vscode.WorkspaceEdit();
  if (parentCreatedAtLineIndex !== undefined) {
    const line = document.lineAt(parentCreatedAtLineIndex);
    const indentation = line.text.match(/^(\s*)/u)?.[1] ?? "  ";
    edit.replace(document.uri, line.range, `${indentation}- Created At: ${parentCreatedAt}`);
    return edit;
  }
  if (parentSchemaLineIndex === undefined) {
    return undefined;
  }
  const parentSchemaLine = document.lineAt(parentSchemaLineIndex);
  const indentation = parentSchemaLine.text.match(/^(\s*)/u)?.[1] ?? "  ";
  edit.insert(document.uri, new vscode.Position(parentSchemaLineIndex + 1, 0), `${indentation}- Created At: ${parentCreatedAt}\n`);
  return edit;
}

function createSetContinuityParentSchemaEdit(document: vscode.TextDocument): vscode.WorkspaceEdit | undefined {
  let parentBlockLineIndex: number | undefined;
  let parentSchemaLineIndex: number | undefined;
  let parentCreatedAtLineIndex: number | undefined;
  let parentTraceLineIndex: number | undefined;
  let inParentBlock = false;
  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex += 1) {
    const lineText = document.lineAt(lineIndex).text;
    const trimmed = lineText.trim();
    if (trimmed === "- Parent") {
      parentBlockLineIndex = lineIndex;
      inParentBlock = true;
      continue;
    }
    if (inParentBlock && !lineText.startsWith("  ") && trimmed) {
      break;
    }
    if (!inParentBlock) {
      continue;
    }
    if (trimmed.startsWith("- Parent Schema:")) {
      parentSchemaLineIndex = lineIndex;
      continue;
    }
    if (trimmed.startsWith("- Created At:")) {
      parentCreatedAtLineIndex = lineIndex;
      continue;
    }
    if (trimmed.startsWith("- Trace:")) {
      parentTraceLineIndex = lineIndex;
      continue;
    }
  }

  const parentCurrentSchema = parseTraceableContinuityMarkdown(readTraceableParentArtifactMarkdownForDocument(document) ?? "").currentSchema;
  const parentSchemaLabel = parentCurrentSchema?.label?.trim() || parentCurrentSchema?.target?.trim();
  if (!parentSchemaLabel) {
    return undefined;
  }

  const replacementLine = parentCurrentSchema?.target?.trim()
    ? `  - Parent Schema: [${parentSchemaLabel}](${parentCurrentSchema.target.trim()})`
    : `  - Parent Schema: ${parentSchemaLabel}`;
  const edit = new vscode.WorkspaceEdit();
  if (parentSchemaLineIndex !== undefined) {
    edit.replace(document.uri, document.lineAt(parentSchemaLineIndex).range, replacementLine);
    return edit;
  }
  if (parentBlockLineIndex === undefined) {
    return undefined;
  }

  const insertBeforeLineIndex = parentCreatedAtLineIndex ?? parentTraceLineIndex;
  if (insertBeforeLineIndex !== undefined) {
    edit.insert(document.uri, new vscode.Position(insertBeforeLineIndex, 0), `${replacementLine}\n`);
    return edit;
  }
  edit.insert(document.uri, new vscode.Position(parentBlockLineIndex + 1, 0), `${replacementLine}\n`);
  return edit;
}

function createSetTraceableParentChecksumEdit(document: vscode.TextDocument): vscode.WorkspaceEdit | undefined {
  let checksumLineIndex: number | undefined;
  let inTraceableStateSection = false;
  let inFence = false;
  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex += 1) {
    const lineText = document.lineAt(lineIndex).text;
    const trimmed = lineText.trim();
    if (!inTraceableStateSection) {
      if (trimmed === "## Traceable State") {
        inTraceableStateSection = true;
      }
      continue;
    }
    if (!inFence && /^#\s+/u.test(trimmed)) {
      break;
    }
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) {
      continue;
    }
    if (!lineText.includes('"parentTraceChecksumSha256"')) {
      continue;
    }
    checksumLineIndex = lineIndex;
    break;
  }
  if (checksumLineIndex === undefined) {
    return undefined;
  }

  const markdown = document.getText();
  const validation = validateTraceableContinuityArtifactChainSync({
    filePath: document.uri.fsPath,
    maxDepth: 1,
    workspaceRoots: getTraceableOpenWorkspaceFolders(),
    readTextFileSync: (filePath) => normalizeComparableFsPath(filePath) === normalizeComparableFsPath(document.uri.fsPath)
      ? markdown
      : readFileSync(filePath, "utf8")
  });
  const nextChecksum = validation.nodes[0]?.traceableParentIntegrity?.actualParentTraceChecksumSha256;
  if (!nextChecksum) {
    return undefined;
  }

  const line = document.lineAt(checksumLineIndex);
  const replacement = line.text.replace(/("parentTraceChecksumSha256"\s*:\s*")([^"]*)(")/u, `$1${nextChecksum}$3`);
  if (replacement === line.text) {
    return undefined;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, line.range, replacement);
  return edit;
}

function createSetTopicSchemaParentCreatedAtEdit(document: vscode.TextDocument): vscode.WorkspaceEdit | undefined {
  let parentCreatedAtLineIndex: number | undefined;
  let parentSchemaLineIndex: number | undefined;
  let inParentBlock = false;
  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex += 1) {
    const lineText = document.lineAt(lineIndex).text;
    const trimmed = lineText.trim();
    if (trimmed === "- Parent") {
      inParentBlock = true;
      continue;
    }
    if (inParentBlock && !lineText.startsWith("  ") && trimmed) {
      break;
    }
    if (!inParentBlock) {
      continue;
    }
    if (trimmed.startsWith("- Created At:")) {
      parentCreatedAtLineIndex = lineIndex;
      continue;
    }
    if (trimmed.startsWith("- Parent Schema:")) {
      parentSchemaLineIndex = lineIndex;
      continue;
    }
  }

  const parentCreatedAt = parseSchemaNoteMarkdown(readTraceableParentArtifactMarkdownForDocument(document) ?? "").currentCreatedAt;
  if (!parentCreatedAt) {
    return undefined;
  }
  const edit = new vscode.WorkspaceEdit();
  if (parentCreatedAtLineIndex !== undefined) {
    const line = document.lineAt(parentCreatedAtLineIndex);
    const indentation = line.text.match(/^(\s*)/u)?.[1] ?? "  ";
    edit.replace(document.uri, line.range, `${indentation}- Created At: ${parentCreatedAt}`);
    return edit;
  }
  if (parentSchemaLineIndex === undefined) {
    return undefined;
  }
  const parentSchemaLine = document.lineAt(parentSchemaLineIndex);
  const indentation = parentSchemaLine.text.match(/^(\s*)/u)?.[1] ?? "  ";
  edit.insert(document.uri, new vscode.Position(parentSchemaLineIndex + 1, 0), `${indentation}- Created At: ${parentCreatedAt}\n`);
  return edit;
}

function createNormalizeCurrentLineContractLabelEdit(document: vscode.TextDocument, lineIndex: number): vscode.WorkspaceEdit | undefined {
  const section = getTraceableContractSectionForLine(document, lineIndex);
  if (!section) {
    return undefined;
  }
  const validationKind = getTraceableEditorValidationKindForFsPath(document.uri.fsPath);
  const line = document.lineAt(lineIndex);
  const trimmed = line.text.trim();
  if (!trimmed) {
    return undefined;
  }
  let replacementLine: string | undefined;
  const groupHeadingMatch = line.text.match(/^(\s*###\s+)(.+)$/u);
  if (groupHeadingMatch) {
    const candidates = section === "Schema Validation Contract"
      ? validationKind === "root-schema"
        ? ROOT_SCHEMA_CONTRACT_GROUP_HEADINGS
        : TOPIC_SCHEMA_CONTRACT_GROUP_HEADINGS
      : TOPIC_SCHEMA_ARTIFACT_CONTRACT_GROUP_HEADINGS;
    const nearest = getNearestTraceableLabel(groupHeadingMatch[2], candidates);
    if (!nearest || nearest === groupHeadingMatch[2].trim()) {
      return undefined;
    }
    replacementLine = `${groupHeadingMatch[1]}${nearest}`;
  } else if (!/^[-*#`]/u.test(trimmed)) {
    const nearest = getNearestTraceableLabel(trimmed, TRACEABLE_CONTRACT_CATEGORY_LABELS);
    if (!nearest || nearest === trimmed) {
      return undefined;
    }
    const indentation = line.text.match(/^(\s*)/u)?.[1] ?? "";
    replacementLine = `${indentation}${nearest}`;
  } else if (/^(\s*)\*\s+/u.test(line.text)) {
    replacementLine = line.text.replace(/^(\s*)\*\s+/u, "$1- ");
  }
  if (!replacementLine || replacementLine === line.text) {
    return undefined;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, line.range, replacementLine);
  return edit;
}

function createInsertTopicSchemaParentOriginEdit(document: vscode.TextDocument, onlyBrowseGitLine: boolean): vscode.WorkspaceEdit | undefined {
  const normalizeGitHubBrowseBaseUrl = (remoteUrl: string): string | undefined => {
    const trimmed = remoteUrl.trim();
    const sshMatch = trimmed.match(/^git@github\.com:(.+?)(?:\.git)?$/iu);
    if (sshMatch) {
      return `https://github.com/${sshMatch[1]}`;
    }
    const httpsMatch = trimmed.match(/^https:\/\/github\.com\/(.+?)(?:\.git)?$/iu);
    if (httpsMatch) {
      return `https://github.com/${httpsMatch[1]}`;
    }
    return undefined;
  };
  const tryResolveTopicSchemaParentOriginBrowseGitTarget = (linkTarget: string): string => {
    const resolvedTargetPath = path.isAbsolute(linkTarget)
      ? path.resolve(linkTarget)
      : path.resolve(path.dirname(document.uri.fsPath), linkTarget);
    const gitRoot = resolveTraceableGitRoot(resolvedTargetPath);
    if (!gitRoot) {
      return "PASTE_COMMIT_PINNED_PERMALINK_HERE";
    }
    try {
      const remoteUrl = execFileSync("git", ["-C", gitRoot, "config", "--get", "remote.origin.url"], { encoding: "utf8" }).trim();
      const browseBaseUrl = normalizeGitHubBrowseBaseUrl(remoteUrl);
      const commitHash = execFileSync("git", ["-C", gitRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      const relativePath = path.relative(gitRoot, resolvedTargetPath).replace(/\\+/g, "/");
      if (!browseBaseUrl || !/^[0-9a-f]{40}$/iu.test(commitHash) || !relativePath || relativePath.startsWith("../")) {
        return "PASTE_COMMIT_PINNED_PERMALINK_HERE";
      }
      return `${browseBaseUrl}/blob/${commitHash}/${relativePath}`;
    } catch {
      return "PASTE_COMMIT_PINNED_PERMALINK_HERE";
    }
  };
  const parentReferences = collectTraceableParentReferenceTargets(document);
  const localParentReference = parentReferences.parentTraceTarget
    ?? parentReferences.parentOriginRelative
    ?? parentReferences.parentOriginAbsolute;
  const browseGitTarget = localParentReference
    ? tryResolveTopicSchemaParentOriginBrowseGitTarget(localParentReference)
    : parentReferences.parentOriginBrowseGitTarget ?? "PASTE_COMMIT_PINNED_PERMALINK_HERE";
  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex += 1) {
    const lineText = document.lineAt(lineIndex).text;
    if (!lineText.trim().startsWith("- Trace:")) {
      continue;
    }
    const traceTargetMatch = lineText.match(/\((.*?)\)/u);
    const traceTarget = traceTargetMatch?.[1]?.trim() || parentReferences.parentOriginRelative || "parent.trace.md";
    const edit = new vscode.WorkspaceEdit();
    if (!onlyBrowseGitLine) {
      const insertion = [
        "  - Origin:",
        `    - [relative](${traceTarget})`,
        `    - [browse + git](${browseGitTarget})`
      ].join("\n");
      edit.insert(document.uri, new vscode.Position(lineIndex + 1, 0), `${insertion}\n`);
      return edit;
    }

    let originLineIndex: number | undefined;
    let relativeLineIndex: number | undefined;
    for (let nestedLineIndex = lineIndex + 1; nestedLineIndex < document.lineCount; nestedLineIndex += 1) {
      const nestedLineText = document.lineAt(nestedLineIndex).text;
      if (nestedLineText.trim() === "- Origin:") {
        originLineIndex = nestedLineIndex;
        continue;
      }
      if (nestedLineText.trim().startsWith("- [relative](")) {
        relativeLineIndex = nestedLineIndex;
        continue;
      }
      if (nestedLineText.trim().startsWith("- [browse + git](")) {
        edit.replace(document.uri, document.lineAt(nestedLineIndex).range, `    - [browse + git](${browseGitTarget})`);
        return edit;
      }
      if (!nestedLineText.startsWith("  ") && nestedLineText.trim()) {
        break;
      }
    }
    if (originLineIndex !== undefined) {
      const insertionLineIndex = relativeLineIndex !== undefined ? relativeLineIndex + 1 : originLineIndex + 1;
      edit.insert(document.uri, new vscode.Position(insertionLineIndex, 0), `    - [browse + git](${browseGitTarget})\n`);
      return edit;
    }
  }
  return undefined;
}

function createSetTopicSchemaFooterTowardsEdit(document: vscode.TextDocument): vscode.WorkspaceEdit | undefined {
  const normalizeGitHubBrowseBaseUrl = (remoteUrl: string): string | undefined => {
    const trimmed = remoteUrl.trim();
    const sshMatch = trimmed.match(/^git@github\.com:(.+?)(?:\.git)?$/iu);
    if (sshMatch) {
      return `https://github.com/${sshMatch[1]}`;
    }
    const httpsMatch = trimmed.match(/^https:\/\/github\.com\/(.+?)(?:\.git)?$/iu);
    if (httpsMatch) {
      return `https://github.com/${httpsMatch[1]}`;
    }
    return undefined;
  };
  const tryResolveBrowseGitTargetFromLinkTarget = (linkTarget: string): string | undefined => {
    const resolvedTargetPath = path.resolve(path.dirname(document.uri.fsPath), linkTarget);
    const gitRoot = resolveTraceableGitRoot(resolvedTargetPath);
    if (!gitRoot) {
      return undefined;
    }
    try {
      const remoteUrl = execFileSync("git", ["-C", gitRoot, "config", "--get", "remote.origin.url"], { encoding: "utf8" }).trim();
      const browseBaseUrl = normalizeGitHubBrowseBaseUrl(remoteUrl);
      const commitHash = execFileSync("git", ["-C", gitRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      const relativePath = path.relative(gitRoot, resolvedTargetPath).replace(/\\+/g, "/");
      if (!browseBaseUrl || !/^[0-9a-f]{40}$/iu.test(commitHash) || !relativePath || relativePath.startsWith("../")) {
        return undefined;
      }
      return `${browseBaseUrl}/blob/${commitHash}/${relativePath}`;
    } catch {
      return undefined;
    }
  };

  let footerTowardsLineIndex: number | undefined;
  let footerTowardsLabel: string | undefined;
  let parentOriginBrowseGitTarget: string | undefined;
  let traceTarget: string | undefined;

  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex += 1) {
    const lineText = document.lineAt(lineIndex).text.trim();
    if (lineText.startsWith("- Trace:")) {
      const traceMatch = lineText.match(/\((.*?)\)/u);
      traceTarget = traceMatch?.[1]?.trim() || traceTarget;
      continue;
    }
    if (lineText.startsWith("- [browse + git](")) {
      const browseMatch = lineText.match(/\((.*?)\)/u);
      parentOriginBrowseGitTarget = browseMatch?.[1]?.trim() || parentOriginBrowseGitTarget;
      continue;
    }
    if (lineText.startsWith("- Towards:")) {
      footerTowardsLineIndex = lineIndex;
      const labelMatch = lineText.match(/^-\s+Towards:\s+\[(.*?)\]\((.*?)\)$/u);
      footerTowardsLabel = labelMatch?.[1]?.trim();
    }
  }

  const nextTarget = parentOriginBrowseGitTarget
    ?? (traceTarget ? tryResolveBrowseGitTargetFromLinkTarget(traceTarget) : undefined);
  if (footerTowardsLineIndex === undefined || !nextTarget) {
    return undefined;
  }

  const line = document.lineAt(footerTowardsLineIndex);
  const label = footerTowardsLabel || path.posix.basename(nextTarget.split("/").pop() ?? "target");
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, line.range, `  - Towards: [${label}](${nextTarget})`);
  return edit;
}

function createSingleLineDiagnosticRange(document: vscode.TextDocument, lineIndex: number): vscode.Range {
  const boundedLineIndex = Math.max(0, Math.min(lineIndex, Math.max(document.lineCount - 1, 0)));
  const line = document.lineAt(boundedLineIndex);
  return new vscode.Range(
    new vscode.Position(boundedLineIndex, 0),
    new vscode.Position(boundedLineIndex, Math.max(line.text.length, 1))
  );
}

function countSharedPrefixLength(left: string, right: string): number {
  const normalizedLeft = left.trim().toLowerCase();
  const normalizedRight = right.trim().toLowerCase();
  const maxLength = Math.min(normalizedLeft.length, normalizedRight.length);
  let index = 0;
  while (index < maxLength && normalizedLeft[index] === normalizedRight[index]) {
    index += 1;
  }
  return index;
}

function getTraceableSchemaPlacementRange(
  document: vscode.TextDocument,
  finding: TraceableSchemaValidationResult["findings"][number]
): vscode.Range | undefined {
  const placement = finding.placement;
  if (!placement) {
    return undefined;
  }
  if (placement.lineText) {
    const trimmedTarget = placement.lineText.trim();
    const exactLine = findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === trimmedTarget);
    if (exactLine) {
      return exactLine;
    }
    const headerMatch = trimmedTarget.match(/^(#{1,6})\s+(.+)$/u);
    const targetText = headerMatch ? headerMatch[2].trim() : trimmedTarget;
    const bestPrefixMatch = Array.from({ length: document.lineCount }, (_, lineIndex) => ({
      lineIndex,
      lineText: document.lineAt(lineIndex).text.trim()
    }))
      .filter(({ lineText }) => lineText.length > 0)
      .map(({ lineIndex, lineText }) => {
        const currentText = headerMatch
          ? lineText.replace(/^#{1,6}\s+/u, "").trim()
          : lineText;
        return {
          lineIndex,
          prefixLength: countSharedPrefixLength(currentText, targetText),
          headerCompatible: !headerMatch || /^#{1,6}\s+/u.test(lineText)
        };
      })
      .filter((candidate) => candidate.headerCompatible && candidate.prefixLength >= Math.min(4, Math.max(3, targetText.length)))
      .sort((left, right) => right.prefixLength - left.prefixLength || left.lineIndex - right.lineIndex)[0];
    if (bestPrefixMatch) {
      return createSingleLineDiagnosticRange(document, bestPrefixMatch.lineIndex);
    }
  }
  const headings = collectDocumentMarkdownHeadings(document);
  const expectedLevel = placement.headingLevel;
  if (placement.actualHeading) {
    const actualHeading = headings.find((heading) => heading.text === placement.actualHeading && (expectedLevel === undefined || heading.level === expectedLevel));
    if (actualHeading) {
      return createSingleLineDiagnosticRange(document, actualHeading.lineIndex);
    }
  }
  const beforeHeading = placement.anchorBeforeHeading
    ? headings.find((heading) => heading.text === placement.anchorBeforeHeading)
    : undefined;
  const afterHeading = placement.anchorAfterHeading
    ? headings.find((heading) => heading.text === placement.anchorAfterHeading)
    : undefined;
  if (beforeHeading && afterHeading) {
    if (afterHeading.lineIndex - beforeHeading.lineIndex > 1) {
      return createSingleLineDiagnosticRange(document, afterHeading.lineIndex - 1);
    }
    return createSingleLineDiagnosticRange(document, afterHeading.lineIndex);
  }
  if (beforeHeading) {
    return createSingleLineDiagnosticRange(document, Math.min(beforeHeading.lineIndex + 1, Math.max(document.lineCount - 1, 0)));
  }
  if (afterHeading) {
    return createSingleLineDiagnosticRange(document, Math.max(afterHeading.lineIndex - 1, 0));
  }
  if (placement.expectedHeading) {
    const expectedHeading = headings.find((heading) => heading.text === placement.expectedHeading && (expectedLevel === undefined || heading.level === expectedLevel));
    if (expectedHeading) {
      return createSingleLineDiagnosticRange(document, expectedHeading.lineIndex);
    }
  }
  return undefined;
}

function getTraceableDiagnosticRange(
  document: vscode.TextDocument,
  finding: ReturnType<typeof validateTraceableContinuityArtifactChainSync>["findings"][number]
): vscode.Range | undefined {
  switch (finding.code) {
    case "continuity-checksum-missing":
    case "continuity-checksum-mismatch":
    case "continuity-checksum-v1-legacy":
      return findTraceablePreferredContinuityIntegrityValueRange(document)
        ?? findTraceableDiagnosticLineRangeInSection(document, "# Continuity Integrity", (lineText) => lineText.trimStart().startsWith("- Towards:"))
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "# Continuity Integrity")
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "# Continuity Context");
    case "continuity-footer-self-required-without-parent":
    case "continuity-footer-towards-permalink-required":
    case "continuity-footer-towards-unreadable":
      return findTraceableDiagnosticLineRangeInSection(document, "# Continuity Integrity", (lineText) => lineText.trimStart().startsWith("- Towards:"))
        ?? findTraceableDiagnosticLineRangeInSection(document, "# Continuity Integrity", (lineText) => lineText.trimStart().startsWith("- Value:"))
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "# Continuity Integrity")
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "# Continuity Context");
    case "traceable-envelope-schema-permalink-required":
    case "traceable-envelope-schema-unreadable":
      return findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim().startsWith("- Envelope Schema:"))
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "# Continuity Context");
    case "traceable-current-origin-browse-git-permalink-required":
    case "traceable-current-origin-browse-git-unreadable":
      return findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim().startsWith("- [browse + git]"))
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "- Origin:")
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "- Current")
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "# Continuity Context");
    case "traceable-current-schema-permalink-required":
    case "traceable-current-schema-unreadable":
      return findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim().startsWith("- Current Schema:"))
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "- Current")
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "# Continuity Context");
    case "continuity-current-created-at-missing":
    case "continuity-current-created-at-invalid":
      return findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim().startsWith("- Created At:"))
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "- Current")
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "# Continuity Context");
    case "traceable-parent-created-at-missing":
    case "traceable-parent-created-at-invalid":
      return findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim().startsWith("- Created At:"))
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "- Parent")
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "# Continuity Context");
    case "traceable-parent-trace-unresolvable":
    case "traceable-parent-trace-unreadable":
      return findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim().startsWith("- Trace:"))
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "- Parent")
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "# Continuity Context");
    case "traceable-parent-schema-permalink-required":
    case "traceable-parent-schema-missing":
    case "traceable-parent-schema-unreadable":
    case "traceable-parent-schema-mismatch":
      return findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim().startsWith("- Parent Schema:"))
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "- Parent")
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "# Continuity Context");
    case "traceable-parent-origin-unpinned-browse-git":
      return findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim().startsWith("- [browse + git]"))
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "- Origin:")
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "- Parent")
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "# Continuity Context");
    case "traceable-parent-unreadable-parent":
    case "traceable-parent-cycle-detected":
      return findTraceableDiagnosticLineRange(document, (lineText) => lineText.includes('"parentTracePath"'))
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "## Traceable State")
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim().startsWith("- Trace:"))
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "# Continuity Context");
    case "traceable-parent-checksum-mismatch":
      return findTraceableDiagnosticLineRangeInSection(document, "# Continuity Integrity", (lineText) => lineText.trimStart().startsWith("- Value:"))
        ?? findTraceableDiagnosticLineRangeInSection(document, "# Continuity Integrity", (lineText) => lineText.trimStart().startsWith("- Towards:"))
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "# Continuity Integrity")
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim().startsWith("- Trace:"))
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.includes('"parentTraceChecksumSha256"'))
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "## Traceable State")
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "# Continuity Context");
    case "schema-validation-friendly-shape-missing":
      return findTraceableDiagnosticLineRange(document, (lineText) => /^#\s+/u.test(lineText.trim()))
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "## Summary");
    case "schema-validation-contract-duplicate-groups":
    case "schema-validation-contract-category-list-missing":
    case "schema-validation-contract-unlabeled-list":
    case "schema-validation-contract-star-bullets-present":
    case "schema-validation-contract-unexpected-content":
    case "root-schema-validation-contract-missing":
    case "root-schema-contract-duplicate-groups":
    case "root-schema-contract-category-list-missing":
    case "root-schema-contract-unlabeled-list":
    case "root-schema-contract-star-bullets-present":
    case "root-schema-contract-unexpected-content":
    case "root-schema-contract-groups-missing":
      return findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "## Schema Validation Contract");
    case "artifact-creation-contract-duplicate-groups":
    case "artifact-creation-contract-category-list-missing":
    case "artifact-creation-contract-unlabeled-list":
    case "artifact-creation-contract-star-bullets-present":
    case "artifact-creation-contract-unexpected-content":
      return findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "## Artifact Creation Contract");
    case "task-required-structure-missing":
    case "topic-required-structure-missing":
      return findTraceableDiagnosticLineRange(document, (lineText) => /^#\s+/u.test(lineText.trim()) && lineText.trim() !== "# Continuity Context" && lineText.trim() !== "# Continuity Integrity");
    case "runtime-required-sections-missing":
    case "runtime-recommended-sections-missing":
    case "runtime-technical-detail-sections-missing":
      return findTraceableDiagnosticLineRange(document, (lineText) => /^#\s+/u.test(lineText.trim()) && lineText.trim() !== "# Continuity Context" && lineText.trim() !== "# Continuity Integrity");
    default:
      return undefined;
  }
}

function getTraceableSchemaDiagnosticRange(
  document: vscode.TextDocument,
  finding: TraceableSchemaValidationResult["findings"][number]
): vscode.Range | undefined {
  switch (finding.code) {
    case "continuity-checksum-mismatch":
    case "continuity-checksum-v1-legacy":
      return findTraceablePreferredContinuityIntegrityValueRange(document)
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "# Continuity Integrity");
    case "continuity-current-created-at-missing":
    case "continuity-current-created-at-invalid":
      return findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "- Current")
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "# Continuity Context");
    case "topic-schema-envelope-schema-mismatch":
    case "topic-schema-envelope-schema-unreadable":
    case "decision-schema-envelope-schema-mismatch":
    case "decision-schema-envelope-schema-unreadable":
    case "task-schema-envelope-schema-mismatch":
    case "task-schema-envelope-schema-unreadable":
    case "evidence-schema-envelope-schema-mismatch":
    case "evidence-schema-envelope-schema-unreadable":
    case "pointer-schema-envelope-schema-mismatch":
    case "pointer-schema-envelope-schema-unreadable":
    case "root-schema-envelope-schema-mismatch":
    case "root-schema-envelope-schema-unreadable":
      return findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim().startsWith("- Envelope Schema:"))
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "# Continuity Context");
    case "root-schema-current-schema-mismatch":
    case "root-schema-current-schema-unreadable":
    case "topic-schema-current-schema-mismatch":
    case "topic-schema-current-schema-unreadable":
    case "decision-schema-current-schema-mismatch":
    case "decision-schema-current-schema-unreadable":
    case "task-schema-current-schema-mismatch":
    case "task-schema-current-schema-unreadable":
    case "evidence-schema-current-schema-mismatch":
    case "evidence-schema-current-schema-unreadable":
    case "pointer-schema-current-schema-mismatch":
    case "pointer-schema-current-schema-unreadable":
      return findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim().startsWith("- Current Schema:"))
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "# Continuity Context");
    case "root-schema-parent-present":
    case "topic-schema-parent-schema-mismatch":
    case "topic-schema-parent-schema-unreadable":
    case "decision-schema-parent-schema-mismatch":
    case "decision-schema-parent-schema-unreadable":
    case "task-schema-parent-schema-mismatch":
    case "task-schema-parent-schema-unreadable":
    case "evidence-schema-parent-schema-mismatch":
    case "evidence-schema-parent-schema-unreadable":
    case "pointer-schema-parent-schema-mismatch":
    case "pointer-schema-parent-schema-unreadable":
      return findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim().startsWith("- Parent Schema:"))
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "# Continuity Context");
    case "topic-schema-parent-created-at-missing":
    case "topic-schema-parent-created-at-invalid":
    case "topic-schema-parent-created-at-mismatch":
    case "decision-schema-parent-created-at-missing":
    case "decision-schema-parent-created-at-invalid":
    case "decision-schema-parent-created-at-mismatch":
    case "task-schema-parent-created-at-missing":
    case "task-schema-parent-created-at-invalid":
    case "task-schema-parent-created-at-mismatch":
    case "evidence-schema-parent-created-at-missing":
    case "evidence-schema-parent-created-at-invalid":
    case "evidence-schema-parent-created-at-mismatch":
    case "pointer-schema-parent-created-at-missing":
    case "pointer-schema-parent-created-at-invalid":
    case "pointer-schema-parent-created-at-mismatch":
      return findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim().startsWith("- Created At:"))
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim().startsWith("- Parent Schema:"))
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "- Parent")
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "# Continuity Context");
    case "topic-schema-parent-origin-missing":
    case "decision-schema-parent-origin-missing":
    case "task-schema-parent-origin-missing":
    case "evidence-schema-parent-origin-missing":
    case "pointer-schema-parent-origin-missing":
      return findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "- Parent")
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim().startsWith("- Trace:"))
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "# Continuity Context");
    case "topic-schema-parent-origin-browse-git-missing":
    case "decision-schema-parent-origin-browse-git-missing":
    case "task-schema-parent-origin-browse-git-missing":
    case "evidence-schema-parent-origin-browse-git-missing":
    case "pointer-schema-parent-origin-browse-git-missing":
      return findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "- Origin:")
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim().startsWith("- Trace:"))
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "# Continuity Context");
    case "topic-schema-parent-origin-unpinned-browse-git":
    case "topic-schema-parent-origin-browse-git-mismatch":
    case "decision-schema-parent-origin-unpinned-browse-git":
    case "decision-schema-parent-origin-browse-git-mismatch":
    case "task-schema-parent-origin-unpinned-browse-git":
    case "task-schema-parent-origin-browse-git-mismatch":
    case "evidence-schema-parent-origin-unpinned-browse-git":
    case "evidence-schema-parent-origin-browse-git-mismatch":
    case "pointer-schema-parent-origin-unpinned-browse-git":
    case "pointer-schema-parent-origin-browse-git-mismatch":
      return findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim().startsWith("- [browse + git]"))
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "- Origin:")
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "# Continuity Context");
    case "topic-schema-parent-trace-unresolvable":
    case "topic-schema-parent-root-invalid":
    case "decision-schema-parent-trace-unresolvable":
    case "decision-schema-parent-root-invalid":
    case "task-schema-parent-trace-unresolvable":
    case "task-schema-parent-root-invalid":
    case "evidence-schema-parent-trace-unresolvable":
    case "evidence-schema-parent-root-invalid":
    case "pointer-schema-parent-trace-unresolvable":
    case "pointer-schema-parent-root-invalid":
      return findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim().startsWith("- Trace:"))
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "# Continuity Context");
    case "root-schema-lineage-unexpected-envelope-field":
    case "topic-schema-lineage-unexpected-envelope-field":
    case "decision-schema-lineage-unexpected-envelope-field":
    case "task-schema-lineage-unexpected-envelope-field":
    case "evidence-schema-lineage-unexpected-envelope-field":
    case "pointer-schema-lineage-unexpected-envelope-field":
      return getTraceableSchemaPlacementRange(document, finding)
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "# Continuity Context");
    case "topic-schema-footer-target-mismatch":
    case "topic-schema-footer-target-not-permalink":
    case "decision-schema-footer-target-mismatch":
    case "decision-schema-footer-target-not-permalink":
    case "task-schema-footer-target-mismatch":
    case "task-schema-footer-target-not-permalink":
    case "evidence-schema-footer-target-mismatch":
    case "evidence-schema-footer-target-not-permalink":
    case "pointer-schema-footer-target-mismatch":
    case "pointer-schema-footer-target-not-permalink":
      return findTraceableDiagnosticLineRangeInSection(document, "# Continuity Integrity", (lineText) => lineText.trimStart().startsWith("- Towards:"))
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "# Continuity Integrity");
    case "root-schema-validation-contract-missing":
    case "root-schema-contract-duplicate-groups":
    case "root-schema-contract-category-list-missing":
    case "root-schema-contract-unlabeled-list":
    case "root-schema-contract-star-bullets-present":
    case "root-schema-contract-unexpected-content":
    case "root-schema-contract-groups-missing":
    case "topic-schema-validation-contract-missing":
    case "topic-schema-contract-duplicate-groups":
    case "topic-schema-contract-category-list-missing":
    case "topic-schema-contract-unlabeled-list":
    case "topic-schema-contract-star-bullets-present":
    case "topic-schema-contract-unexpected-content":
    case "topic-schema-contract-unexpected-group":
    case "topic-schema-contract-unexpected-category-label":
      return getTraceableSchemaPlacementRange(document, finding)
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "## Schema Validation Contract");
    case "topic-schema-artifact-creation-contract-missing":
    case "topic-schema-artifact-creation-contract-duplicate-groups":
    case "topic-schema-artifact-creation-contract-category-list-missing":
    case "topic-schema-artifact-creation-contract-unlabeled-list":
    case "topic-schema-artifact-creation-contract-star-bullets-present":
    case "topic-schema-artifact-creation-contract-unexpected-content":
    case "topic-schema-artifact-creation-contract-unexpected-group":
    case "topic-schema-artifact-creation-contract-unexpected-category-label":
      return getTraceableSchemaPlacementRange(document, finding)
        ?? findTraceableDiagnosticLineRange(document, (lineText) => lineText.trim() === "## Artifact Creation Contract");
    case "root-schema-layout-title-mismatch":
    case "root-schema-layout-missing-heading":
    case "root-schema-layout-unexpected-heading":
    case "root-schema-layout-heading-order":
    case "topic-schema-layout-title-mismatch":
    case "topic-schema-layout-missing-heading":
    case "topic-schema-layout-unexpected-heading":
    case "topic-schema-layout-heading-order":
      return getTraceableSchemaPlacementRange(document, finding);
    default:
      return undefined;
  }
}

function buildTraceableContinuityDiagnostics(
  document: vscode.TextDocument,
  result: ReturnType<typeof validateTraceableContinuityArtifactChainSync>
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  const topRange = createTopOfDocumentRange(document);
  const currentFilePath = document.uri.fsPath;
  const addDiagnostic = (
    message: string,
    severity: vscode.DiagnosticSeverity,
    range?: vscode.Range,
    code?: string
  ): void => {
    const diagnostic = new vscode.Diagnostic(range ?? topRange, message, severity);
    diagnostic.source = "Tiinex Traceable Continuity";
    if (code) {
      diagnostic.code = code;
    }
    diagnostics.push(diagnostic);
  };

  if (!result.nodes[0]) {
    addDiagnostic(
      "Continuity validation did not produce a readable root node for this artifact.",
      vscode.DiagnosticSeverity.Error,
      undefined,
      "continuity-root-node-missing"
    );
    return diagnostics;
  }

  for (const finding of result.findings) {
    if (!finding.surfaces.includes("problems")) {
      continue;
    }
    if (finding.filePath && path.normalize(finding.filePath) !== path.normalize(currentFilePath)) {
      continue;
    }

    const severity = finding.severity === "error"
      ? vscode.DiagnosticSeverity.Error
      : finding.severity === "warning"
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Information;
    addDiagnostic(finding.message, severity, getTraceableDiagnosticRange(document, finding), finding.code);
  }

  diagnostics.push(...collectOutdatedTraceablePermalinkDiagnostics(document, "Tiinex Traceable Continuity"));

  return diagnostics;
}

function buildTraceableSchemaDiagnostics(
  document: vscode.TextDocument,
  result: TraceableSchemaValidationResult
): vscode.Diagnostic[] {
  const diagnostics: vscode.Diagnostic[] = [];
  const topRange = createTopOfDocumentRange(document);
  const currentFilePath = document.uri.fsPath;
  for (const finding of result.findings) {
    if (finding.filePath && path.normalize(finding.filePath) !== path.normalize(currentFilePath)) {
      continue;
    }
    const severity = finding.severity === "error"
      ? vscode.DiagnosticSeverity.Error
      : finding.severity === "warning"
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Information;
    const diagnostic = new vscode.Diagnostic(
      getTraceableSchemaDiagnosticRange(document, finding) ?? topRange,
      finding.message,
      severity
    );
    diagnostic.source = "Tiinex Schema Validation";
    diagnostic.code = finding.code;
    diagnostics.push(diagnostic);
  }
  diagnostics.push(...collectOutdatedTraceablePermalinkDiagnostics(document, "Tiinex Schema Validation"));
  return diagnostics;
}

async function rotateTraceableContinuityChecksum(output: vscode.OutputChannel, target?: vscode.Uri): Promise<void> {
  const artifactUri = resolveMarkdownArtifactUri(target);
  if (!artifactUri) {
    void vscode.window.showErrorMessage("Open a markdown continuity artifact first, or invoke the fix from a markdown file.");
    return;
  }

  const document = await vscode.workspace.openTextDocument(artifactUri);
  const markdown = document.getText();
  const validation = validateTraceableContinuityArtifactChainSync({
    filePath: artifactUri.fsPath,
    maxDepth: 1,
    workspaceRoots: getTraceableOpenWorkspaceFolders(),
    readTextFileSync: (filePath) => normalizeComparableFsPath(filePath) === normalizeComparableFsPath(artifactUri.fsPath)
      ? markdown
      : readFileSync(filePath, "utf8")
  });
  const directParentPath = validation.nodes[0]?.backwardLink.resolvedPath;
  const workspaceFolders = (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
    name: folder.name,
    fsPath: folder.uri.fsPath
  }));
  if (directParentPath && isPathWithinAnyWorkspaceRoot(directParentPath, workspaceFolders)) {
    if (hasDirtyOpenDocumentForPath(directParentPath) || hasTrackedGitChangesForPath(directParentPath)) {
      void vscode.window.showWarningMessage("Commit the direct parent artifact before rotating this checksum. The parent is reachable in the workspace and still dirty.");
      return;
    }
  }

  const readTextFileSync = (filePath: string): string => normalizeComparableFsPath(filePath) === normalizeComparableFsPath(artifactUri.fsPath)
    ? markdown
    : readFileSync(filePath, "utf8");
  const parsed = parseTraceableContinuityMarkdown(markdown);
  const hasParent = Boolean(
    parsed.parentCreatedAt?.trim()
    || parsed.parentTrace?.target?.trim()
    || parsed.parentSchema?.target?.trim()
    || parsed.parentSchema?.label?.trim()
    || parsed.parentOrigin?.relative?.trim()
    || parsed.parentOrigin?.absolute?.trim()
    || parsed.parentOrigin?.browseGit?.trim()
  );
  const comparisonTarget = hasParent
    ? parsed.parentOrigin?.browseGit?.trim() || parsed.parentTrace?.target?.trim() || parsed.currentSchema?.target?.trim()
    : undefined;
  const comparisonLabel = comparisonTarget
    ? parsed.parentTrace?.label?.trim()
      || parsed.currentSchema?.label?.trim()
      || path.posix.basename(comparisonTarget.split("/").pop() ?? "target")
    : undefined;
  const normalizedLines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const integrityHeadingLineIndex = normalizedLines.findIndex((line) => line.trim() === "# Continuity Integrity");
  if (integrityHeadingLineIndex < 0) {
    void vscode.window.showErrorMessage("Could not locate a Continuity Integrity section in the current document.");
    return;
  }
  let lastContentLineIndex = integrityHeadingLineIndex - 1;
  while (lastContentLineIndex >= 0) {
    const trimmed = normalizedLines[lastContentLineIndex]?.trim() ?? "";
    if (trimmed === "" || trimmed === "---") {
      lastContentLineIndex -= 1;
      continue;
    }
    break;
  }
  const footerStartLineIndex = Math.max(lastContentLineIndex + 1, 0);
  const prefixMarkdown = normalizedLines.slice(0, footerStartLineIndex).join("\n");
  const footerMarkdown = normalizedLines.slice(footerStartLineIndex).join("\n");
  const endOfLine = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  const computeForTarget = (method: string, towards: string, markdownPayload: string) => computeTargetedTraceableContinuityChecksumSha256(
    artifactUri.fsPath,
    markdownPayload,
    { method, towardsTarget: towards },
    (filePath: string) => normalizeComparableFsPath(filePath) === normalizeComparableFsPath(artifactUri.fsPath)
      ? markdownPayload
      : readFileSync(filePath, "utf8"),
    getTraceableOpenWorkspaceFolders()
  );
  const buildSection = (targetValue: string, selfValue: string) => {
    const lines: string[] = [];
    if (lastContentLineIndex >= 0) {
      lines.push("");
    }
    lines.push("---", "", "# Continuity Integrity", "");
    if (comparisonTarget && comparisonLabel) {
      lines.push(
        "- sha256-base64url-c14n-v1",
        `  - Towards: [${comparisonLabel}](${comparisonTarget})`,
        `  - Value: ${targetValue}`,
        ""
      );
    }
    lines.push(
      "- sha256-base64url-c14n-v2",
      "  - Towards: self",
      `  - Value: ${selfValue}`
    );
    return lines.join("\n");
  };
  const previewFooterMarkdown = buildSection("TARGET_PLACEHOLDER", "SELF_PLACEHOLDER");
  const previewMarkdown = prefixMarkdown.length === 0 ? previewFooterMarkdown : `${prefixMarkdown}\n${previewFooterMarkdown}`;
  const targetChecksum = comparisonTarget
    ? computeForTarget("sha256-base64url-c14n-v1", comparisonTarget, previewMarkdown) ?? "TARGET_PLACEHOLDER"
    : "TARGET_PLACEHOLDER";
  const footerWithTarget = buildSection(targetChecksum, "SELF_PLACEHOLDER");
  const markdownWithTarget = prefixMarkdown.length === 0 ? footerWithTarget : `${prefixMarkdown}\n${footerWithTarget}`;
  const selfChecksum = computeForTarget("sha256-base64url-c14n-v2", "self", markdownWithTarget) ?? "SELF_PLACEHOLDER";
  const nextFooterMarkdown = buildSection(targetChecksum, selfChecksum);
  if (footerMarkdown === nextFooterMarkdown) {
    void vscode.window.showInformationMessage("The continuity checksum is already up to date.");
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    artifactUri,
    new vscode.Range(new vscode.Position(footerStartLineIndex, 0), document.positionAt(markdown.length)),
    nextFooterMarkdown.replace(/\n/g, endOfLine)
  );
  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    void vscode.window.showErrorMessage("VS Code could not apply the checksum rotation edit.");
    return;
  }
  output.appendLine(`Rotated continuity checksum for: ${artifactUri.fsPath}`);
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Tiinex Traceable Provenance");
  output.appendLine("Activated Tiinex Traceable Provenance extension scaffold.");
  const unsavedTraceableAgentChatState = new Map<string, {
    priorTurnsSummary?: string;
    activeCarryForward?: TraceableSubagentRunResult["activeCarryForward"];
  }>();
  let activeUnsavedTraceableAgentChatKey: string | undefined;
  let traceablePanelRestoreCommand: string | undefined;
  let traceablePanelPinnedOpen = false;
  void vscode.commands.executeCommand("setContext", TRACEABLE_PANEL_VISIBLE_CONTEXT, false);
  void vscode.commands.executeCommand("setContext", RETURN_TO_PARENT_TRACE_ELIGIBLE_CONTEXT, {});
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
      toolSelectionRestricted: false,
      routingNote: ""
    },
    status: { phase: "idle", message: "idle" },
    environment: {},
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
        environment: parentParsed.snapshot.environment,
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
        const candidate = tryExtractTraceableMarkdownLinkTarget(item.title) || item.title?.trim() || item.value.trim();
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
      parsedState.snapshot = {
        ...parsedState.snapshot,
        lineageIntegrity: evaluateParsedTraceableEvidenceLineageIntegrity(resolvedUri.fsPath, parsedState)
      };
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
      chatCollapseMode: getConfiguredTraceableChatCollapse(resolvedUri),
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
  const syncTraceableAuxiliaryViewsFromEvidenceSnapshot = (
    snapshot: TraceableSubagentDetailSnapshot,
    options: { updatePanel?: boolean } = {}
  ): void => {
    traceableStatusDetail.update(snapshot);
    if (options.updatePanel === true) {
      traceableStatusPanel.update(snapshot);
    }
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
    syncTraceableAuxiliaryViewsFromEvidenceSnapshot(latestState.parsedState.snapshot);
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
        return;
      }
      if (message.type === "repairTraceLineage") {
        await repairTraceableLineage(resolvedUri);
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
    syncTraceableAuxiliaryViewsFromEvidenceSnapshot(initialState.parsedState.snapshot);
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
    const { parsedState } = await readTraceableEvidenceViewState(resolvedUri);
    const rawParentRequest = parsedState?.result?.request;
    const parentRequest = rawParentRequest && typeof rawParentRequest === "object"
      ? rawParentRequest as Record<string, unknown>
      : undefined;
    if (!parentRequest) {
      throw new Error(`TRACEABLE continuation parent ${JSON.stringify(resolvedUri.fsPath)} does not expose a readable request contract.`);
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
    (snapshot) => {
      const evidenceFilePath = snapshot.evidenceFile?.filePath?.trim();
      const resource = evidenceFilePath ? vscode.Uri.file(evidenceFilePath) : undefined;
      return getConfiguredTraceableChatCollapse(resource);
    },
    async (snapshot) => {
      const evidenceFilePath = snapshot.evidenceFile?.filePath?.trim();
      const resource = evidenceFilePath ? vscode.Uri.file(evidenceFilePath) : undefined;
      return listConfiguredChatSenderRoleOptions(resource);
    },
    async (snapshot) => {
      const evidenceFilePath = snapshot.evidenceFile?.filePath?.trim();
      const resource = evidenceFilePath ? vscode.Uri.file(evidenceFilePath) : undefined;
      return resolveConfiguredDefaultChatSenderRole(resource);
    },
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
  const revealTraceablePanel = async (reason: "auto" | "manual" = "manual", options: { focusComposer?: boolean } = {}): Promise<void> => {
    traceablePanelRestoreCommand = await getTraceablePanelRestoreCommand();
    traceablePanelPinnedOpen = shouldKeepTraceablePanelPinned({
      reason,
      autoHideMode: getTraceableAutoHideMode(),
      currentlyPinnedOpen: traceablePanelPinnedOpen
    });
    traceableStatusPanel.setPinnedOpen(traceablePanelPinnedOpen);
    await vscode.commands.executeCommand("setContext", TRACEABLE_PANEL_VISIBLE_CONTEXT, true);
    await traceableStatusPanel.open({ reason, focusComposer: options.focusComposer === true });
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

  const prepareTraceableRunExecution = async (
    requestedInput: TraceableSubagentInput,
    options: { revealReason?: "auto" | "manual"; focusComposerOnReveal?: boolean } = {}
  ) => {
    const preparedInput = await prepareTraceableSubagentInput(requestedInput);
    const effectiveInput = preparedInput.input;
    if (shouldAutoRevealTraceablePanel(effectiveInput.reveal)) {
      void (async () => {
        await revealTraceablePanel(options.revealReason === "manual" ? "manual" : "auto", {
          focusComposer: options.focusComposerOnReveal === true
        });
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
        const finalizedEvidenceFilePath = finalized.evidenceFile?.filePath?.trim();
        if (finalizedEvidenceFilePath) {
          const latestState = await readTraceableEvidenceViewState(vscode.Uri.file(finalizedEvidenceFilePath));
          if (latestState.parsedState?.snapshot) {
            const latestSnapshot = traceableEvidence.updateSnapshot(latestState.parsedState.snapshot);
            syncTraceableAuxiliaryViewsFromEvidenceSnapshot(latestSnapshot, { updatePanel: true });
            return finalized;
          }
        }
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

  const openTraceableChatResultWhenPanelNotAutoRevealed = async (result: TraceableSubagentRunResult): Promise<void> => {
    if (shouldAutoRevealTraceablePanel(true) || !result.evidenceFile?.filePath) {
      return;
    }
    await openTraceableEvidenceEditor(result.evidenceFile.filePath, {
      initialChatViewEnabled: true,
      applyConfiguredDefaultView: false
    });
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
      entries.map((entry) => {
        const tags = [
          entry.candidate ? "candidate" : undefined,
          entry.experimental ? "experimental" : undefined,
          entry.modelDeclaration ? `model=${entry.modelDeclaration}` : undefined
        ].filter(Boolean);
        return {
          label: entry.displayName,
          description: tags.join(" | ") || undefined,
          detail: entry.filePath,
          agentName: entry.displayName,
          agentFilePath: entry.filePath
        };
      }),
      {
        title: "New Traceable Chat",
        placeHolder: "Choose which traceable agent role to chat with"
      }
    );
    if (!picked) {
      return undefined;
    }
    return {
      name: picked.agentName,
      filePath: picked.agentFilePath
    };
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
    const resolvedDefaultSenderRole = await resolveConfiguredDefaultChatSenderRole(resource);
    if (getConfiguredQuickSelectRole(resource) && resolvedDefaultSenderRole) {
      return resolvedDefaultSenderRole;
    }
    const promptableOptions = buildPromptableChatSenderRoleOptions(availableRoles, resolvedDefaultSenderRole);
    const picked = await vscode.window.showQuickPick(
      promptableOptions,
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
    options: { openResult?: boolean; rejectIfBusy?: boolean; focusComposerOnReveal?: boolean } = {}
  ): Promise<TraceableSubagentRunResult> => {
    const lease = await acquireTraceableRunLease(logLabel, options.rejectIfBusy !== false);
    try {
      const prepared = await prepareTraceableRunExecution(requestedInput, {
        revealReason: options.focusComposerOnReveal === true ? "manual" : "auto",
        focusComposerOnReveal: options.focusComposerOnReveal === true
      });
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

  const getTraceableStructureWorkspaceFolders = (): Array<{ name: string; fsPath: string }> => {
    return (vscode.workspace.workspaceFolders ?? []).map((workspaceFolder) => ({
      name: workspaceFolder.name,
      fsPath: workspaceFolder.uri.fsPath
    }));
  };

  const slugifyTraceNodeSummary = (value: string): string => {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 48);
  };

  const toRelativeMarkdownLinkTarget = (fromFilePath: string, targetPath: string): string => {
    const relativePath = path.relative(path.dirname(fromFilePath), targetPath).replace(/\\+/g, "/");
    return relativePath || path.basename(targetPath);
  };

  const sentenceFromSummary = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) {
      return "Describe the current topic here.";
    }
    return /[.!?]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
  };

  const formatUtcTraceTimestamp = (date: Date): string => {
    const year = String(date.getUTCFullYear());
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    const hours = String(date.getUTCHours()).padStart(2, "0");
    const minutes = String(date.getUTCMinutes()).padStart(2, "0");
    const seconds = String(date.getUTCSeconds()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };

  type TraceNodeOriginReference =
    | { kind: "file"; filePath: string }
    | { kind: "url"; url: string };

  type TraceNodeParentOrOriginResolution = {
    parentNode?: TraceableStructureNode;
    currentOrigin?: TraceNodeOriginReference;
    targetFolderPath?: string;
  };

  const browseGitBaseUrlByGitRoot = new Map<string, string | null>();
  const headCommitByGitRoot = new Map<string, string | null>();

  const normalizeGitHubBrowseBaseUrl = (remoteUrl: string | undefined): string | undefined => {
    const trimmed = remoteUrl?.trim();
    if (!trimmed) {
      return undefined;
    }
    const sshMatch = trimmed.match(/^git@github\.com:(.+?)(?:\.git)?$/iu);
    if (sshMatch) {
      return `https://github.com/${sshMatch[1]}`;
    }
    const httpsMatch = trimmed.match(/^https:\/\/github\.com\/(.+?)(?:\.git)?$/iu);
    if (httpsMatch) {
      return `https://github.com/${httpsMatch[1]}`;
    }
    return undefined;
  };

  const resolveGitHubBrowseBaseUrl = (gitRoot: string | undefined): string | undefined => {
    const normalizedGitRoot = gitRoot ? path.resolve(gitRoot) : undefined;
    if (!normalizedGitRoot) {
      return undefined;
    }
    if (browseGitBaseUrlByGitRoot.has(normalizedGitRoot)) {
      return browseGitBaseUrlByGitRoot.get(normalizedGitRoot) ?? undefined;
    }
    try {
      const remoteUrl = execFileSync("git", ["-C", normalizedGitRoot, "config", "--get", "remote.origin.url"], { encoding: "utf8" }).trim();
      const browseBaseUrl = normalizeGitHubBrowseBaseUrl(remoteUrl);
      browseGitBaseUrlByGitRoot.set(normalizedGitRoot, browseBaseUrl ?? null);
      return browseBaseUrl;
    } catch {
      browseGitBaseUrlByGitRoot.set(normalizedGitRoot, null);
      return undefined;
    }
  };

  const resolveHeadCommitHash = (gitRoot: string | undefined): string | undefined => {
    const normalizedGitRoot = gitRoot ? path.resolve(gitRoot) : undefined;
    if (!normalizedGitRoot) {
      return undefined;
    }
    if (headCommitByGitRoot.has(normalizedGitRoot)) {
      return headCommitByGitRoot.get(normalizedGitRoot) ?? undefined;
    }
    try {
      const commitHash = execFileSync("git", ["-C", normalizedGitRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      const normalizedCommitHash = /^[0-9a-f]{40}$/iu.test(commitHash) ? commitHash : undefined;
      headCommitByGitRoot.set(normalizedGitRoot, normalizedCommitHash ?? null);
      return normalizedCommitHash;
    } catch {
      headCommitByGitRoot.set(normalizedGitRoot, null);
      return undefined;
    }
  };

  const tryResolveBrowseGitUrlForPath = (targetPath: string): string | undefined => {
    const gitRoot = resolveTraceableGitRoot(targetPath);
    const browseBaseUrl = resolveGitHubBrowseBaseUrl(gitRoot);
    const commitHash = resolveHeadCommitHash(gitRoot);
    if (!gitRoot || !browseBaseUrl || !commitHash) {
      return undefined;
    }
    const relativePath = path.relative(gitRoot, targetPath).replace(/\\+/g, "/");
    if (!relativePath || relativePath.startsWith("../")) {
      return undefined;
    }
    return `${browseBaseUrl}/blob/${commitHash}/${relativePath}`;
  };

  const buildEnvelopeSchemaLine = (currentSchemaPath: string, outputFilePath: string): string => {
    const continuationSchemaPath = path.join(path.dirname(currentSchemaPath), "tiinex.root.v1.schema.md");
    return `- Envelope Schema: [tiinex.root.v1](${toRelativeMarkdownLinkTarget(outputFilePath, continuationSchemaPath)})`;
  };

  const buildLocalOriginLines = (fromFilePath: string, targetPath: string, indent = "  "): string[] => {
    const lines = [
      `${indent}- [relative](${toRelativeMarkdownLinkTarget(fromFilePath, targetPath)})`,
      `${indent}- [absolute](${path.resolve(targetPath).replace(/\\+/g, "/")})`
    ];
    const browseGitUrl = tryResolveBrowseGitUrlForPath(targetPath);
    if (browseGitUrl) {
      lines.push(`${indent}- [browse + git](${browseGitUrl})`);
    }
    return lines;
  };

  const buildOriginLines = (fromFilePath: string, origin: TraceNodeOriginReference, indent = "  "): string[] => {
    if (origin.kind === "file") {
      return buildLocalOriginLines(fromFilePath, origin.filePath, indent);
    }
    return [`${indent}- [link](${origin.url.trim()})`];
  };

  const tryResolveSchemaTargetForNewTrace = (targetPath: string | undefined, baseFilePath: string, outputFilePath: string): { label: string; target: string } | undefined => {
    const trimmedTarget = targetPath?.trim();
    if (!trimmedTarget) {
      return undefined;
    }
    if (/^https?:\/\//iu.test(trimmedTarget)) {
      return { label: trimmedTarget, target: trimmedTarget };
    }
    const resolvedPath = resolveTraceableReferenceForCommand(baseFilePath, trimmedTarget);
    if (!resolvedPath) {
      return undefined;
    }
    return {
      label: path.basename(resolvedPath),
      target: toRelativeMarkdownLinkTarget(outputFilePath, resolvedPath)
    };
  };

  type TraceableCreateTemplate = {
    version?: number;
    createTitle?: string;
    summaryPrompt?: string;
    summaryPlaceholder?: string;
    whyPrompt?: string;
    whyPlaceholder?: string;
    bodyLines?: string[];
  };

  const TRACEABLE_CREATE_TEMPLATE_BLOCK_RE = /```traceable-create-template\s*\r?\n([\s\S]*?)```/giu;
  const TRACEABLE_CREATE_TEMPLATE_FRONT_MATTER_RE = /^\s*---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n([\s\S]*))?$/u;

  const DEFAULT_TRACEABLE_CREATE_TEMPLATES = new Map<string, TraceableCreateTemplate>([
    ["tiinex.topic.v1", {
      createTitle: "Create Topic",
      summaryPrompt: "Enter a short title for the topic",
      summaryPlaceholder: "What is this topic about?",
      whyPrompt: "Optional: capture why this topic exists",
      whyPlaceholder: "Why does this topic matter right now?",
      bodyLines: [
        "# {{summary}}",
        "",
        "{{summarySentence}}",
        "",
        "## Current Read",
        "",
        "Describe the current topic state, what is already known, and what this topic is trying to advance.",
        "",
        "## Design Direction",
        "",
        "Describe the direction this topic should take next.",
        "",
        "## Next Artifacts",
        "",
        "- Add the next concrete child topic, proof, task, or decision artifact."
      ]
    }],
    ["tiinex.task.v1", {
      createTitle: "Create Task",
      summaryPrompt: "Enter a short title for the task",
      summaryPlaceholder: "What concrete work needs to be done?",
      whyPrompt: "Optional: capture why this task exists",
      whyPlaceholder: "Why does this task matter right now?",
      bodyLines: [
        "# {{summary}}",
        "",
        "## Objective",
        "",
        "Describe the concrete work being asked for.",
        "",
        "## Done Criteria",
        "",
        "- Define what completion means for this task.",
        "",
        "## Scope",
        "",
        "- Capture boundaries, constraints, and non-goals.",
        "",
        "## Dependencies",
        "",
        "- List dependencies, blockers, or required artifacts when they exist."
      ]
    }]
  ]);

  const parseTraceableCreateTemplateFrontMatter = (frontMatter: string): Record<string, string> | undefined => {
    const parsed: Record<string, string> = {};
    for (const line of frontMatter.split(/\r?\n/u)) {
      const trimmedLine = line.trim();
      if (!trimmedLine) {
        continue;
      }
      const separatorIndex = trimmedLine.indexOf(":");
      if (separatorIndex <= 0) {
        return undefined;
      }
      const key = trimmedLine.slice(0, separatorIndex).trim();
      const value = trimmedLine.slice(separatorIndex + 1).trim();
      if (!key) {
        return undefined;
      }
      parsed[key] = value;
    }
    return parsed;
  };

  const trimTrailingEmptyLines = (lines: string[]): string[] => {
    const trimmed = [...lines];
    while (trimmed.length > 0 && !trimmed[trimmed.length - 1]?.trim()) {
      trimmed.pop();
    }
    return trimmed;
  };

  const coerceTraceableCreateTemplate = (value: Partial<TraceableCreateTemplate> | undefined): TraceableCreateTemplate | undefined => {
    if (!value || typeof value !== "object") {
      return undefined;
    }
    const bodyLines = Array.isArray(value.bodyLines)
      ? value.bodyLines.filter((entry): entry is string => typeof entry === "string")
      : undefined;
    if (Array.isArray(value.bodyLines) && bodyLines?.length !== value.bodyLines.length) {
      return undefined;
    }
    const version = typeof value.version === "number" ? value.version : undefined;
    if (version !== undefined && version !== 1) {
      return undefined;
    }
    return {
      version,
      createTitle: typeof value.createTitle === "string" ? value.createTitle : undefined,
      summaryPrompt: typeof value.summaryPrompt === "string" ? value.summaryPrompt : undefined,
      summaryPlaceholder: typeof value.summaryPlaceholder === "string" ? value.summaryPlaceholder : undefined,
      whyPrompt: typeof value.whyPrompt === "string" ? value.whyPrompt : undefined,
      whyPlaceholder: typeof value.whyPlaceholder === "string" ? value.whyPlaceholder : undefined,
      bodyLines
    };
  };

  const parseTraceableCreateTemplateBlock = (blockContent: string): TraceableCreateTemplate | undefined => {
    const frontMatterMatch = blockContent.match(TRACEABLE_CREATE_TEMPLATE_FRONT_MATTER_RE);
    if (frontMatterMatch) {
      const frontMatter = parseTraceableCreateTemplateFrontMatter(frontMatterMatch[1]);
      if (!frontMatter) {
        return undefined;
      }
      const versionValue = frontMatter.version?.trim();
      const bodyLines = trimTrailingEmptyLines((frontMatterMatch[2] || "").split(/\r?\n/u));
      return coerceTraceableCreateTemplate({
        version: versionValue ? Number(versionValue) : undefined,
        createTitle: frontMatter.createTitle,
        summaryPrompt: frontMatter.summaryPrompt,
        summaryPlaceholder: frontMatter.summaryPlaceholder,
        whyPrompt: frontMatter.whyPrompt,
        whyPlaceholder: frontMatter.whyPlaceholder,
        bodyLines
      });
    }
    try {
      return coerceTraceableCreateTemplate(JSON.parse(blockContent));
    } catch {
      return undefined;
    }
  };

  const resolveTraceableCreateTemplate = async (schemaEntry: TraceableStructureSchemaEntry): Promise<TraceableCreateTemplate | undefined> => {
    const defaultTemplate = DEFAULT_TRACEABLE_CREATE_TEMPLATES.get(schemaEntry.id);
    let markdown: string | undefined;
    try {
      markdown = await fs.readFile(schemaEntry.path, "utf8");
    } catch {
      return defaultTemplate;
    }
    const matches = [...markdown.matchAll(TRACEABLE_CREATE_TEMPLATE_BLOCK_RE)];
    const match = matches.at(-1);
    if (!match) {
      return defaultTemplate;
    }
    const parsedTemplate = parseTraceableCreateTemplateBlock(match[1]);
    if (!parsedTemplate) {
      output.appendLine(`TRACEABLE create-template parse failed for ${schemaEntry.path}: unsupported template block shape`);
      return defaultTemplate;
    }
    return parsedTemplate;
  };

  const interpolateTraceableCreateTemplateLine = (
    line: string,
    input: {
      schemaEntry: TraceableStructureSchemaEntry;
      summary: string;
      why?: string;
      parentNode?: TraceableStructureNode;
    }
  ): string => {
    const replacements: Record<string, string> = {
      summary: input.summary.trim(),
      summarySentence: sentenceFromSummary(input.summary),
      why: input.why?.trim() || "Describe why this node exists.",
      schemaId: input.schemaEntry.id,
      schemaDisplayName: input.schemaEntry.displayName,
      parentTraceDisplayPath: input.parentNode?.displayPath ?? "(root)"
    };
    return line.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*\}\}/gu, (_match, token: string) => {
      return replacements[token] ?? "";
    });
  };

  const renderTraceableCreateTemplateBody = (
    template: TraceableCreateTemplate | undefined,
    input: {
      schemaEntry: TraceableStructureSchemaEntry;
      summary: string;
      why?: string;
      parentNode?: TraceableStructureNode;
    }
  ): string[] => {
    if (template?.bodyLines && template.bodyLines.length > 0) {
      return template.bodyLines.map((line) => interpolateTraceableCreateTemplateLine(line, input));
    }
    if (input.schemaEntry.id === "tiinex.topic.v1") {
      return [
        `# ${input.summary.trim()}`,
        "",
        sentenceFromSummary(input.summary),
        "",
        "## Current Read",
        "",
        "Describe the current topic state, what is already known, and what this topic is trying to advance.",
        "",
        "## Design Direction",
        "",
        "Describe the direction this topic should take next.",
        "",
        "## Next Artifacts",
        "",
        "- Add the next concrete child topic, proof, task, or decision artifact."
      ];
    }
    return [
      "# Summary",
      "",
      input.summary.trim(),
      "",
      "## Why",
      "",
      input.why?.trim() || "Describe why this node exists.",
      "",
      "## Notes",
      "",
      `- Schema: ${input.schemaEntry.id}`,
      input.parentNode ? `- Parent Trace: ${input.parentNode.displayPath}` : "- Parent Trace: (root)"
    ];
  };

  const buildTraceNodeMarkdown = (input: {
    filePath: string;
    schemaEntry: TraceableStructureSchemaEntry;
    summary: string;
    why?: string;
    template?: TraceableCreateTemplate;
    parentNode?: TraceableStructureNode;
    currentOrigin?: TraceNodeOriginReference;
    workspaceRoots: string[];
  }): string => {
    const createdAt = formatUtcTraceTimestamp(new Date());
    const lines: string[] = ["# Continuity Context", "", buildEnvelopeSchemaLine(input.schemaEntry.path, input.filePath)];
    if (input.parentNode) {
      lines.push("- Parent");
      const parentSchemaLink = tryResolveSchemaTargetForNewTrace(input.parentNode.currentSchemaTarget, input.parentNode.path, input.filePath);
      if (input.parentNode.currentSchemaId) {
        lines.push(parentSchemaLink
          ? `  - Parent Schema: [${input.parentNode.currentSchemaId}](${parentSchemaLink.target})`
          : `  - Parent Schema: ${input.parentNode.currentSchemaId}`);
      }
      lines.push(`  - Trace: [${path.basename(input.parentNode.path)}](${computeStoredParentTracePath(input.parentNode.path, input.filePath, input.workspaceRoots)})`);
      if (input.parentNode.currentCreatedAt) {
        lines.push(`  - Created At: ${input.parentNode.currentCreatedAt}`);
      }
      lines.push("  - Origin:");
      lines.push(...buildLocalOriginLines(input.filePath, input.parentNode.path, "    "));
      lines.push("");
    }
    lines.push("- Current");
    lines.push(`  - Current Schema: [${input.schemaEntry.id}](${toRelativeMarkdownLinkTarget(input.filePath, input.schemaEntry.path)})`);
    lines.push(`  - Created At: ${createdAt}`);
    lines.push(`  - Why: ${input.why?.trim() || "Describe why this node exists."}`);
    lines.push(`  - Summary: ${input.summary.trim()}`);
    if (!input.parentNode && input.currentOrigin) {
      lines.push("  - Origin:");
      lines.push(...buildOriginLines(input.filePath, input.currentOrigin, "    "));
    }
    lines.push("", "---", "", ...renderTraceableCreateTemplateBody(input.template, input));
    return `${lines.join("\n")}\n`;
  };

  const collectTraceNodesInFolder = (
    structureIndex: Awaited<ReturnType<typeof buildTraceableStructureIndex>>,
    folderPath: string
  ): TraceableStructureNode[] => {
    const normalizedFolderPath = path.resolve(folderPath).toLowerCase();
    return [...structureIndex.nodesByPathKey.values()]
      .filter((node) => path.resolve(node.folderPath).toLowerCase() === normalizedFolderPath)
      .sort((left, right) => (right.modifiedAt ?? 0) - (left.modifiedAt ?? 0) || left.path.localeCompare(right.path));
  };

  const findTraceNodeByFilePath = (
    structureIndex: Awaited<ReturnType<typeof buildTraceableStructureIndex>>,
    filePath: string
  ): TraceableStructureNode | undefined => {
    const normalizedFilePath = path.resolve(filePath).toLowerCase();
    return [...structureIndex.nodesByPathKey.values()].find((node) => path.resolve(node.path).toLowerCase() === normalizedFilePath);
  };

  const promptForOriginFilePath = async (defaultFolderPath: string): Promise<string | undefined> => {
    const pickedFiles = await vscode.window.showOpenDialog({
      title: "Select Parent Or Origin File",
      openLabel: "Use File",
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      defaultUri: vscode.Uri.file(defaultFolderPath)
    });
    return pickedFiles?.[0]?.fsPath;
  };

  const promptForOptionalParentOrOrigin = async (
    structureIndex: Awaited<ReturnType<typeof buildTraceableStructureIndex>>,
    defaultFolderPath: string
  ): Promise<TraceNodeParentOrOriginResolution | undefined> => {
    const originMode = await vscode.window.showQuickPick([
      { label: "Select file", value: "file" as const, detail: "Choose any local file. .trace.md creates a child trace; other files become the current origin." },
      { label: "Enter link", value: "url" as const, detail: "Use a URL as the current origin." },
      { label: "No origin", value: "none" as const, detail: "Leave the new trace without an origin." }
    ], {
      title: "Create Trace Node",
      placeHolder: "No parent trace was found here. Choose an optional origin for the new trace"
    });
    if (!originMode || originMode.value === "none") {
      return {};
    }
    if (originMode.value === "file") {
      const selectedPath = await promptForOriginFilePath(defaultFolderPath);
      if (!selectedPath) {
        return undefined;
      }
      if (selectedPath.toLowerCase().endsWith(".trace.md")) {
        const selectedParentNode = findTraceNodeByFilePath(structureIndex, selectedPath);
        if (!selectedParentNode) {
          void vscode.window.showErrorMessage("The selected parent trace must be inside the current open workspace roots.");
          return undefined;
        }
        return {
          parentNode: selectedParentNode,
          targetFolderPath: selectedParentNode.folderPath
        };
      }
      return {
        currentOrigin: { kind: "file", filePath: selectedPath }
      };
    }
    const enteredUrl = (await vscode.window.showInputBox({
      title: "Create Trace Node",
      prompt: "Enter an origin link for the new trace",
      placeHolder: "https://...",
      validateInput: (candidate) => /^https?:\/\//iu.test(candidate.trim()) ? undefined : "Enter an absolute http or https URL."
    }))?.trim();
    return enteredUrl ? { currentOrigin: { kind: "url", url: enteredUrl } } : undefined;
  };

  const resolveFolderSuggestedParentNode = async (
    structureIndex: Awaited<ReturnType<typeof buildTraceableStructureIndex>>,
    targetFolderPath: string
  ): Promise<TraceableStructureNode | undefined> => {
    const parentFolderPath = path.dirname(targetFolderPath);
    if (path.resolve(parentFolderPath).toLowerCase() === path.resolve(targetFolderPath).toLowerCase()) {
      return undefined;
    }
    const candidates = collectTraceNodesInFolder(structureIndex, parentFolderPath);
    if (candidates.length === 0) {
      return undefined;
    }
    if (candidates.length === 1) {
      return candidates[0];
    }
    const pickedParent = await vscode.window.showQuickPick([
      ...candidates.map((candidate) => ({
        label: path.basename(candidate.path),
        description: candidate.currentSchemaId ?? candidate.displayPath,
        detail: candidate.displaySummary ?? candidate.displayPath,
        node: candidate
      })),
      {
        label: "No parent trace",
        description: "Create this trace without a parent trace.",
        detail: "The new trace will not inherit a parent trace from the parent folder.",
        node: undefined as TraceableStructureNode | undefined
      }
    ], {
      title: "Create Trace Node",
      placeHolder: "Choose a parent trace from the parent folder"
    });
    return pickedParent?.node;
  };

  const findWorkspaceFolderForPath = (
    candidatePath: string,
    workspaceFolders: ReadonlyArray<ReturnType<typeof getTraceableStructureWorkspaceFolders>[number]>
  ): ReturnType<typeof getTraceableStructureWorkspaceFolders>[number] | undefined => {
    const normalizedCandidatePath = path.resolve(candidatePath).toLowerCase();
    return workspaceFolders.find((workspaceFolder) => {
      const normalizedWorkspacePath = path.resolve(workspaceFolder.fsPath).toLowerCase();
      return normalizedCandidatePath === normalizedWorkspacePath || normalizedCandidatePath.startsWith(`${normalizedWorkspacePath}${path.sep}`);
    });
  };

  const resolveWorkspaceTopicFolder = async (workspaceFolderPath: string): Promise<string | undefined> => {
    const topicFolderPath = path.join(workspaceFolderPath, ".topics");
    try {
      const stat = await fs.stat(topicFolderPath);
      return stat.isDirectory() ? topicFolderPath : undefined;
    } catch {
      return undefined;
    }
  };

  const isWithinFolder = (candidatePath: string, containerPath: string): boolean => {
    const normalizedCandidatePath = path.resolve(candidatePath).toLowerCase();
    const normalizedContainerPath = path.resolve(containerPath).toLowerCase();
    return normalizedCandidatePath === normalizedContainerPath || normalizedCandidatePath.startsWith(`${normalizedContainerPath}${path.sep}`);
  };

  const resolveDefaultNewTopicLocation = (resource?: vscode.Uri): "ask" | "topic-space" | "same-folder" => {
    const configured = getProvenanceConfiguration(resource).get<string>(DEFAULT_NEW_TOPIC_LOCATION_SETTING, "topic-space").trim().toLowerCase();
    return configured === "ask" || configured === "same-folder" || configured === "topic-space"
      ? configured
      : "topic-space";
  };

  const resolveTraceNodeCreationTarget = async (input: {
    schemaEntry: TraceableStructureSchemaEntry;
    selectedTarget: { targetFolderPath: string; parentNode?: TraceableStructureNode } | undefined;
    workspaceFolders: ReadonlyArray<ReturnType<typeof getTraceableStructureWorkspaceFolders>[number]>;
  }): Promise<{ targetFolderPath: string; selectedTraceParentNode?: TraceableStructureNode; explicitFolderChoice: boolean } | undefined> => {
    const fallbackFolderPath = input.selectedTarget
      ? undefined
      : await promptForTraceNodeFolder();
    const baseTargetFolderPath = input.selectedTarget?.targetFolderPath ?? fallbackFolderPath;
    const explicitFolderChoice = Boolean(!input.selectedTarget && fallbackFolderPath);
    if (!baseTargetFolderPath) {
      return undefined;
    }

    if (input.schemaEntry.id !== "tiinex.topic.v1") {
      return {
        targetFolderPath: baseTargetFolderPath,
        selectedTraceParentNode: input.selectedTarget?.parentNode,
        explicitFolderChoice
      };
    }

    const workspaceFolder = findWorkspaceFolderForPath(baseTargetFolderPath, input.workspaceFolders);
    if (!workspaceFolder) {
      return {
        targetFolderPath: baseTargetFolderPath,
        selectedTraceParentNode: input.selectedTarget?.parentNode,
        explicitFolderChoice
      };
    }

    const topicFolderPath = await resolveWorkspaceTopicFolder(workspaceFolder.fsPath);
    if (explicitFolderChoice || !topicFolderPath || isWithinFolder(baseTargetFolderPath, topicFolderPath)) {
      return {
        targetFolderPath: baseTargetFolderPath,
        selectedTraceParentNode: input.selectedTarget?.parentNode,
        explicitFolderChoice
      };
    }

    const defaultLocation = resolveDefaultNewTopicLocation(vscode.Uri.file(workspaceFolder.fsPath));
    if (defaultLocation === "topic-space") {
      return {
        targetFolderPath: topicFolderPath,
        selectedTraceParentNode: undefined,
        explicitFolderChoice
      };
    }
    if (defaultLocation === "same-folder") {
      return {
        targetFolderPath: baseTargetFolderPath,
        selectedTraceParentNode: input.selectedTarget?.parentNode,
        explicitFolderChoice
      };
    }

    const locationPick = await vscode.window.showQuickPick([
      {
        label: ".topics",
        description: path.relative(workspaceFolder.fsPath, topicFolderPath).replace(/\\+/g, "/") || ".topics",
        detail: "Create this topic in the workspace topic space.",
        targetFolderPath: topicFolderPath,
        selectedTraceParentNode: undefined
      },
      {
        label: "Same folder",
        description: path.relative(workspaceFolder.fsPath, baseTargetFolderPath).replace(/\\+/g, "/") || workspaceFolder.name,
        detail: "Create this topic beside the current selection.",
        targetFolderPath: baseTargetFolderPath,
        selectedTraceParentNode: input.selectedTarget?.parentNode
      }
    ], {
      title: "Create Topic Trace Node",
      placeHolder: "Choose where this topic should be created"
    });
    if (!locationPick) {
      return undefined;
    }
    return {
      targetFolderPath: locationPick.targetFolderPath,
      selectedTraceParentNode: locationPick.selectedTraceParentNode,
      explicitFolderChoice
    };
  };

  const promptForTraceNodeFolder = async (defaultFolderPath?: string): Promise<string | undefined> => {
    const pickedFolders = await vscode.window.showOpenDialog({
      title: "Create Trace Node",
      openLabel: "Use Folder",
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      defaultUri: defaultFolderPath ? vscode.Uri.file(defaultFolderPath) : undefined
    });
    return pickedFolders?.[0]?.fsPath;
  };

  const resolveSelectedTraceableCreateTarget = (
    structureIndex: Awaited<ReturnType<typeof buildTraceableStructureIndex>>
  ): { targetFolderPath: string; parentNode?: TraceableStructureNode } | undefined => {
    const selection = getSelectedTraceableStructureSnapshot();
    if (!selection) {
      return undefined;
    }
    if (selection.kind === "trace" && selection.nodePathKey) {
      const parentNode = structureIndex.nodesByPathKey.get(selection.nodePathKey);
      if (!parentNode) {
        return undefined;
      }
      return {
        targetFolderPath: parentNode.folderPath,
        parentNode
      };
    }
    const targetFolderPath = selection.folderPath ?? selection.workspaceFolderPath;
    return targetFolderPath ? { targetFolderPath } : undefined;
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
      const result = await runTraceableSubagentFromCommand({
        agentRole: {
          name: selectedRole.name,
          filePath: selectedRole.filePath
        },
        userInput: firstMessage,
        ...(senderRole ? { parentRoles: senderRole } : {}),
        inputMode: "DIRECT",
        reveal: true,
        exportToFolder: resolvedTarget.folderPath
      }, "New Traceable Chat (folder)", { openResult: false, focusComposerOnReveal: true });
      await openTraceableChatResultWhenPanelNotAutoRevealed(result);
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
      const result = await runTraceableSubagentFromCommand({
        parentTracePath: resolvedTarget.filePath,
        userInput: firstMessage,
        ...(senderRole ? { parentRoles: senderRole } : {}),
        inputMode: "DIRECT",
        reveal: true,
        exportToFolder: path.dirname(resolvedTarget.filePath)
      }, "New Traceable Chat (continuation)", { openResult: false, focusComposerOnReveal: true });
      await openTraceableChatResultWhenPanelNotAutoRevealed(result);
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
    }, "New Traceable Chat (agent)", { openResult: false, focusComposerOnReveal: true });
    await openTraceableChatResultWhenPanelNotAutoRevealed(result);
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

  const startNewTraceableNodeFromView = async (requestedSchemaId?: string): Promise<void> => {
    const workspaceFolders = getTraceableStructureWorkspaceFolders();
    if (workspaceFolders.length === 0) {
      void vscode.window.showErrorMessage("Create Trace Node requires at least one open workspace folder.");
      return;
    }

    const structureIndex = await buildTraceableStructureIndex(workspaceFolders);
    const schemaEntries = [...structureIndex.schemaEntries].sort(compareTraceableStructureSchemaEntries);
    if (schemaEntries.length === 0) {
      void vscode.window.showErrorMessage("No schema notes were found in the current multi-root workspace.");
      return;
    }

    const rememberedSchemaId = context.workspaceState.get<string>(LAST_TRACEABLE_NODE_SCHEMA_ID_STATE_KEY)?.trim();
    const selectedSchema = (requestedSchemaId?.trim()
      ? schemaEntries.find((entry) => entry.id === requestedSchemaId.trim())
      : undefined)
      ?? (rememberedSchemaId ? schemaEntries.find((entry) => entry.id === rememberedSchemaId) : undefined)
      ?? schemaEntries[0];
    if (!selectedSchema) {
      if (requestedSchemaId?.trim()) {
        void vscode.window.showErrorMessage(`The requested schema ${requestedSchemaId.trim()} is not available in the current multi-root workspace.`);
      }
      return;
    }

    const createTemplate = await resolveTraceableCreateTemplate(selectedSchema);

    const selectedTarget = resolveSelectedTraceableCreateTarget(structureIndex);
    const resolvedCreateTarget = await resolveTraceNodeCreationTarget({
      schemaEntry: selectedSchema,
      selectedTarget,
      workspaceFolders
    });
    if (!resolvedCreateTarget) {
      return;
    }
    const targetFolder = resolvedCreateTarget.targetFolderPath;
    if (!isPathWithinAnyWorkspaceRoot(targetFolder, workspaceFolders)) {
      void vscode.window.showErrorMessage("Create Trace Node currently supports folders inside the open workspace roots only.");
      return;
    }

    let effectiveTargetFolder = targetFolder;
    let parentNode = resolvedCreateTarget.selectedTraceParentNode
      ?? await resolveFolderSuggestedParentNode(structureIndex, effectiveTargetFolder);
    let currentOrigin: TraceNodeOriginReference | undefined;
    if (!parentNode) {
      const parentOrOrigin = await promptForOptionalParentOrOrigin(structureIndex, path.dirname(effectiveTargetFolder));
      if (parentOrOrigin === undefined) {
        return;
      }
      if (parentOrOrigin.targetFolderPath) {
        effectiveTargetFolder = parentOrOrigin.targetFolderPath;
      }
      parentNode = parentOrOrigin.parentNode;
      currentOrigin = parentOrOrigin.currentOrigin;
    }

    const createTitle = createTemplate?.createTitle?.trim() || `Create ${selectedSchema.displayName}`;

    const summary = (await vscode.window.showInputBox({
      title: createTitle,
      prompt: createTemplate?.summaryPrompt?.trim() || "Enter a short Summary for the new trace node",
      placeHolder: createTemplate?.summaryPlaceholder?.trim() || "What is this node actually about?",
      validateInput: (candidate) => candidate.trim() ? undefined : "A Summary is required to create a trace node."
    }))?.trim();
    if (!summary) {
      return;
    }

    const why = (await vscode.window.showInputBox({
      title: createTitle,
      prompt: createTemplate?.whyPrompt?.trim() || "Optional: enter a Why note for the new trace node",
      placeHolder: createTemplate?.whyPlaceholder?.trim() || "Why does this node exist?"
    }))?.trim();

    const existingEntries = await fs.readdir(effectiveTargetFolder, { withFileTypes: true }).catch(() => []);
    const fileNameFormatOptions = getTraceableEvidenceFileNameFormatOptions();
    const lineageParentNode = parentNode
      && path.resolve(parentNode.folderPath).toLowerCase() === path.resolve(effectiveTargetFolder).toLowerCase()
      ? parentNode
      : undefined;
    const lineageLabel = allocateNextTraceableLineageLabel(
      existingEntries.filter((entry) => entry.isFile()).map((entry) => entry.name),
      lineageParentNode?.parsedFileName.lineageLabel,
      fileNameFormatOptions
    );
    const fileName = buildTraceableEvidenceFileName(lineageLabel, slugifyTraceNodeSummary(summary), fileNameFormatOptions);
    const filePath = path.join(effectiveTargetFolder, fileName);
    const markdown = buildTraceNodeMarkdown({
      filePath,
      schemaEntry: selectedSchema,
      summary,
      why,
      template: createTemplate,
      parentNode,
      currentOrigin,
      workspaceRoots: getTraceableWorkspaceRoots()
    });

    await vscode.workspace.fs.writeFile(vscode.Uri.file(filePath), new TextEncoder().encode(markdown));
    await context.workspaceState.update(LAST_TRACEABLE_NODE_SCHEMA_ID_STATE_KEY, selectedSchema.id);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    await vscode.window.showTextDocument(document, { preview: false });
    await vscode.commands.executeCommand("tiinex.aiProvenance.traceableStructure.refresh");
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

  const getTraceableWorkspaceRoots = (): string[] => (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);

  const resolveTraceableTransferSourceUri = async (sourcePath: string): Promise<vscode.Uri> => {
    const resolvedPath = await resolveTraceableOpenPath(sourcePath);
    if (!resolvedPath.toLowerCase().endsWith(".trace.md")) {
      throw new Error(`transferTrace requires a .trace.md source file. Got ${JSON.stringify(resolvedPath)}.`);
    }
    const sourceUri = vscode.Uri.file(resolvedPath);
    let stat: vscode.FileStat | undefined;
    try {
      stat = await vscode.workspace.fs.stat(sourceUri);
    } catch {
      stat = undefined;
    }
    if (!stat || (stat.type & vscode.FileType.File) === 0) {
      throw new Error(`transferTrace source path is not a readable file: ${JSON.stringify(resolvedPath)}.`);
    }
    return sourceUri;
  };

  const resolveTraceableTransferDestinationFolderUri = async (destinationFolderPath: string): Promise<vscode.Uri> => {
    const resolvedPath = await resolveTraceableOpenPath(destinationFolderPath);
    const destinationUri = vscode.Uri.file(resolvedPath);
    let stat: vscode.FileStat | undefined;
    try {
      stat = await vscode.workspace.fs.stat(destinationUri);
    } catch {
      stat = undefined;
    }
    if (!stat || (stat.type & vscode.FileType.Directory) === 0) {
      throw new Error(`transferTrace destinationFolderPath must point to a readable folder. Got ${JSON.stringify(resolvedPath)}.`);
    }
    return destinationUri;
  };

  const resolveMeaningfulTraceableLineageScopesForDestination = async (
    candidate: vscode.Uri,
    destinationFolder: vscode.Uri
  ): Promise<TraceableLineageMoveScope[]> => {
    const requestedFiles = [{
      oldUri: candidate,
      newUri: vscode.Uri.file(path.join(destinationFolder.fsPath, path.basename(candidate.fsPath)))
    }];
    const workspaceRoots = getTraceableWorkspaceRoots();
    const availableScopes = await inspectTraceableLineageMoveScopes(candidate.fsPath, workspaceRoots);
    return filterMeaningfulTraceableLineageScopes(requestedFiles, availableScopes, workspaceRoots);
  };

  const canPlanExplicitTraceableLineageScopeForDestination = async (
    candidate: vscode.Uri,
    destinationFolder: vscode.Uri,
    requestedScope: TraceableLineageMoveScope
  ): Promise<boolean> => {
    const requestedFiles = [{
      oldUri: candidate,
      newUri: vscode.Uri.file(path.join(destinationFolder.fsPath, path.basename(candidate.fsPath)))
    }];
    const workspaceRoots = getTraceableWorkspaceRoots();
    const requestedPathKeys = new Set(requestedFiles.map((file) => normalizeTraceableMovePathKey(file.oldUri.fsPath)));
    const plannedMoves = await planTraceableRenameMoveOperation({
      files: requestedFiles,
      workspaceRoots,
      allowExistingRequestedTargets: false,
      lineageScope: requestedScope,
      hostOwnedRequestedFiles: requestedFiles
    });
    return (plannedMoves ?? []).some((move) => !requestedPathKeys.has(normalizeTraceableMovePathKey(move.oldUri.fsPath)));
  };

  const resolveTransferTraceLineageScope = async (
    candidate: vscode.Uri,
    destinationFolder: vscode.Uri,
    requestedScope: TraceableLineageMoveScope | undefined
  ): Promise<TraceableLineageMoveScope> => {
    const meaningfulScopes = await resolveMeaningfulTraceableLineageScopesForDestination(candidate, destinationFolder);
    if (requestedScope) {
      if (meaningfulScopes.includes(requestedScope)) {
        return requestedScope;
      }
      if (await canPlanExplicitTraceableLineageScopeForDestination(candidate, destinationFolder, requestedScope)) {
        return requestedScope;
      }
    }
    if (meaningfulScopes.length === 0) {
      throw new Error("TRACEABLE lineage transfer is not available here because no additional lineage files would move.");
    }
    if (requestedScope) {
      if (!meaningfulScopes.includes(requestedScope)) {
        throw new Error(`TRACEABLE lineage transfer does not support scope ${requestedScope} here. Available scopes: ${meaningfulScopes.join(", ")}.`);
      }
      return requestedScope;
    }
    if (meaningfulScopes.length === 1) {
      return meaningfulScopes[0];
    }
    throw new Error(`TRACEABLE lineage transfer requires an explicit lineageScope here. Available scopes: ${meaningfulScopes.join(", ")}.`);
  };

  const resolveTraceableReferenceForCommand = (currentFilePath: string, referencePath: string | undefined): string | undefined => {
    const trimmed = referencePath?.trim();
    if (!trimmed) {
      return undefined;
    }
    if (trimmed.startsWith("file:///")) {
      const withoutScheme = decodeURIComponent(trimmed.slice("file:///".length));
      const normalized = withoutScheme.replace(/\\+/g, "/");
      const candidateName = path.basename(normalized.startsWith("/") ? normalized.slice(1) : normalized);
      return path.resolve(path.dirname(currentFilePath), candidateName);
    }
    return path.isAbsolute(trimmed)
      ? path.resolve(trimmed)
      : path.resolve(path.dirname(currentFilePath), trimmed);
  };

  const resolveReturnToParentTraceDestinationFolder = async (candidate: vscode.Uri): Promise<string | undefined> => {
    const visitedPaths = new Set<string>();
    let currentFilePath = candidate.fsPath;
    const startingFolderPath = path.resolve(path.dirname(candidate.fsPath)).toLowerCase();
    while (currentFilePath && !visitedPaths.has(path.resolve(currentFilePath).toLowerCase())) {
      visitedPaths.add(path.resolve(currentFilePath).toLowerCase());
      const markdown = await fs.readFile(currentFilePath, "utf8").catch(() => undefined);
      const parsed = typeof markdown === "string" ? parseTraceableEvidenceStateMarkdown(markdown) : undefined;
      const parentReference = typeof parsed?.result?.parentTracePath === "string"
        ? parsed.result.parentTracePath
        : undefined;
      const resolvedParentPath = resolveTraceableReferenceForCommand(currentFilePath, parentReference);
      if (!resolvedParentPath?.trim()) {
        return undefined;
      }
      const destinationFolderPath = path.resolve(path.dirname(resolvedParentPath));
      if (destinationFolderPath.toLowerCase() !== startingFolderPath) {
        return destinationFolderPath;
      }
      currentFilePath = resolvedParentPath;
    }
    return undefined;
  };

  const resolveStoredParentTracePathFromParsedState = (filePath: string, parsedState: ParsedTraceableEvidenceState | undefined): string | undefined => {
    const parentReference = typeof parsedState?.result?.parentTracePath === "string"
      ? parsedState.result.parentTracePath.trim()
      : "";
    if (!parentReference) {
      return undefined;
    }
    return path.isAbsolute(parentReference)
      ? path.resolve(parentReference)
      : path.resolve(path.dirname(filePath), parentReference);
  };

  const collectTraceableAncestorPathKeys = async (startPath: string): Promise<Set<string>> => {
    const visited = new Set<string>();
    let currentPath: string | undefined = startPath;
    while (currentPath) {
      const normalizedCurrentPath = path.resolve(currentPath).toLowerCase();
      if (visited.has(normalizedCurrentPath)) {
        break;
      }
      visited.add(normalizedCurrentPath);
      const parsed = (await readParsedTraceableEvidenceFromFileWithRetry(currentPath)).parsed;
      currentPath = resolveStoredParentTracePathFromParsedState(currentPath, parsed);
    }
    return visited;
  };

  const repairTraceableParentConnection = async (
    candidate: vscode.Uri,
    parentPathOverride: string | null
  ): Promise<boolean> => {
    const rewrittenMarkdown = await rewriteTraceableEvidenceParentConnection({
      filePath: candidate.fsPath,
      workspaceRoots: getTraceableWorkspaceRoots(),
      parentPathOverride
    });
    if (!rewrittenMarkdown) {
      void vscode.window.showWarningMessage("TRACEABLE could not rewrite the selected file's parent connection.");
      return false;
    }
    await ApplyTraceableMutationPlan({
      blocked: false,
      mutations: [createTraceableRewriteMutation(candidate, rewrittenMarkdown)]
    });
    return true;
  };

  const getBrokenTraceableLineageIntegrity = async (
    candidate: vscode.Uri
  ): Promise<ReturnType<typeof evaluateParsedTraceableEvidenceLineageIntegrity> | undefined> => {
    if (!isTraceableLineageChecksumEnabled(candidate)) {
      return undefined;
    }
    const { parsedState } = await readTraceableEvidenceViewState(candidate);
    if (!parsedState) {
      return undefined;
    }
    const integrity = evaluateParsedTraceableEvidenceLineageIntegrity(candidate.fsPath, parsedState);
    if (!integrity || integrity.status === "ok" || integrity.status === "legacy-no-checksum" || integrity.status === "disabled") {
      return undefined;
    }
    return integrity;
  };

  const describeTraceableLineageRepairDetail = (
    integrity: NonNullable<Awaited<ReturnType<typeof getBrokenTraceableLineageIntegrity>>>
  ): string => {
    return integrity.status === "checksum-mismatch"
      ? "Stored parent checksum no longer matches the resolved parent artifact."
      : integrity.status === "missing-parent"
        ? "Stored parent trace could not be resolved."
        : integrity.status === "unreadable-parent"
          ? "Stored parent trace exists but could not be read."
          : "The stored parent trace edge would create a lineage cycle.";
  };

  const promptTraceableLineageRepair = async (
    candidate: vscode.Uri,
    commandLabel: string,
    integrity: NonNullable<Awaited<ReturnType<typeof getBrokenTraceableLineageIntegrity>>>
  ): Promise<boolean> => {
    const reconnectTarget = integrity.resolvedParentTracePath?.trim();
    const actions = ["Detach", ...(reconnectTarget && integrity.status !== "missing-parent" && integrity.status !== "unreadable-parent" && integrity.status !== "cycle-detected" ? ["Re-connect"] : []), "Manually connect"] as const;
    const selection = await vscode.window.showWarningMessage(
      `${commandLabel} found broken lineage for ${path.basename(candidate.fsPath)}. Repair the parent edge before continuing.`,
      { modal: true, detail: describeTraceableLineageRepairDetail(integrity) },
      ...actions
    );
    if (selection === "Detach") {
      return repairTraceableParentConnection(candidate, null);
    }
    if (selection === "Re-connect" && reconnectTarget) {
      return repairTraceableParentConnection(candidate, reconnectTarget);
    }
    if (selection === "Manually connect") {
      const pickedFiles = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        defaultUri: vscode.Uri.file(path.dirname(candidate.fsPath)),
        openLabel: "Connect Parent Trace",
        filters: { "Traceable Evidence": ["trace.md"] },
        title: "Choose a parent .trace.md artifact"
      });
      const selectedParent = pickedFiles?.[0];
      if (!selectedParent || selectedParent.scheme !== "file") {
        return false;
      }
      if (!selectedParent.fsPath.toLowerCase().endsWith(".trace.md")) {
        void vscode.window.showWarningMessage("Manual connect requires a .trace.md parent artifact.");
        return false;
      }
      if (path.resolve(selectedParent.fsPath).toLowerCase() === path.resolve(candidate.fsPath).toLowerCase()) {
        void vscode.window.showWarningMessage("Manual connect cannot use the selected trace as its own parent.");
        return false;
      }
      const selectedParentParsed = (await readParsedTraceableEvidenceFromFileWithRetry(selectedParent.fsPath)).parsed;
      if (!selectedParentParsed?.result) {
        void vscode.window.showWarningMessage("Manual connect requires a readable .trace.md artifact with a supported Traceable State block.");
        return false;
      }
      const ancestorPathKeys = await collectTraceableAncestorPathKeys(selectedParent.fsPath);
      if (ancestorPathKeys.has(path.resolve(candidate.fsPath).toLowerCase())) {
        void vscode.window.showWarningMessage("Manual connect was rejected because it would create a lineage cycle.");
        return false;
      }
      return repairTraceableParentConnection(candidate, selectedParent.fsPath);
    }
    return false;
  };

  const runTraceableLineageRepairInternal = async (input: RepairTraceableLineageInput): Promise<TraceableLineageRepairResult> => {
    const resolvedTargetPath = await resolveMarkdownArtifactFilePath(input.targetPath);
    if (!resolvedTargetPath.toLowerCase().endsWith(".trace.md")) {
      throw new Error(`Trace lineage repair requires a .trace.md file. Got ${JSON.stringify(resolvedTargetPath)}.`);
    }
    const repoRoot = resolveTraceableLineageRepairGitRoot(resolvedTargetPath);
    if (!repoRoot) {
      throw new Error(`Trace lineage repair requires a git-backed repository root. Could not resolve one for ${JSON.stringify(resolvedTargetPath)}.`);
    }
    return runTraceableLineageRepair(
      {
        repoRoot,
        targets: [resolvedTargetPath],
        autoCommit: input.autoCommit,
        commitMessagePrefix: input.commitMessagePrefix,
        maxIterations: input.maxIterations
      },
      {
        parseSchemaNoteMarkdown,
        workspaceRoots: getTraceableOpenWorkspaceFolders().map((folder) => folder.fsPath)
      }
    );
  };

  const showTraceableLineageRepairResult = async (result: TraceableLineageRepairResult): Promise<void> => {
    const document = await vscode.workspace.openTextDocument({
      language: "markdown",
      content: renderTraceableLineageRepairMarkdown(result)
    });
    await vscode.window.showTextDocument(document, { preview: false });
  };

  const repairTraceableLineage = async (target?: vscode.Uri): Promise<void> => {
    const candidate = resolveTraceableEvidenceUri(target);
    if (!candidate) {
      void vscode.window.showWarningMessage("Choose a .trace.md file first to repair TRACEABLE lineage.");
      return;
    }
    const integrity = await getBrokenTraceableLineageIntegrity(candidate);
    if (integrity && integrity.status !== "checksum-mismatch") {
      await promptTraceableLineageRepair(candidate, "Repair Trace Lineage", integrity);
      return;
    }
    const confirmation = await vscode.window.showWarningMessage(
      `Repair TRACEABLE lineage for ${path.basename(candidate.fsPath)} and create intermediate checkpoint commits when descendants depend on committed parents?`,
      {
        modal: true,
        detail: "This runs connected-component lineage repair in-process inside the extension."
      },
      "Repair Lineage"
    );
    if (confirmation !== "Repair Lineage") {
      return;
    }
    const lease = await traceableLineageRepairMutex.acquire("repairTraceLineage command");
    try {
      try {
        const result = await runTraceableLineageRepairInternal({
          targetPath: candidate.fsPath,
          autoCommit: true,
          commitMessagePrefix: "Repair trace lineage"
        });
        output.appendLine(`TRACEABLE lineage repair completed for ${candidate.fsPath}`);
        await showTraceableLineageRepairResult(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        output.appendLine(`TRACEABLE lineage repair failed for ${candidate.fsPath}: ${message}`);
        void vscode.window.showErrorMessage(`TRACEABLE lineage repair failed: ${message}`);
      }
    } finally {
      lease.release();
    }
  };

  const ensureTraceableLineageReadyForCommand = async (
    candidate: vscode.Uri,
    commandLabel: string
  ): Promise<boolean> => {
    const integrity = await getBrokenTraceableLineageIntegrity(candidate);
    if (!integrity) {
      return true;
    }
    return promptTraceableLineageRepair(candidate, commandLabel, integrity);
  };

  const isReturnToParentTraceEligible = async (candidate: vscode.Uri): Promise<boolean> => {
    if (candidate.scheme !== "file" || !candidate.fsPath.toLowerCase().endsWith(".trace.md")) {
      return false;
    }
    return Boolean(await resolveReturnToParentTraceDestinationFolder(candidate));
  };

  const refreshReturnToParentTraceEligibleContext = async (): Promise<void> => {
    const eligibleEntries: Record<string, boolean> = {};
    const traceFiles = await vscode.workspace.findFiles("**/*.trace.md");
    await Promise.all(traceFiles.map(async (resource) => {
      if (!(await isReturnToParentTraceEligible(resource))) {
        return;
      }
      for (const key of buildTraceableExplorerResourceContextKeys(resource)) {
        eligibleEntries[key] = true;
      }
    }));
    await vscode.commands.executeCommand("setContext", RETURN_TO_PARENT_TRACE_ELIGIBLE_CONTEXT, eligibleEntries);
  };

  let returnToParentTraceContextRefreshTimer: NodeJS.Timeout | undefined;
  let returnToParentTraceContextRefreshInFlight = false;
  let returnToParentTraceContextRefreshQueued = false;
  const scheduleReturnToParentTraceContextRefresh = (): void => {
    if (returnToParentTraceContextRefreshTimer) {
      clearTimeout(returnToParentTraceContextRefreshTimer);
    }
    returnToParentTraceContextRefreshTimer = setTimeout(() => {
      returnToParentTraceContextRefreshTimer = undefined;
      void flushReturnToParentTraceContextRefresh();
    }, 80);
  };
  const flushReturnToParentTraceContextRefresh = async (): Promise<void> => {
    if (returnToParentTraceContextRefreshInFlight) {
      returnToParentTraceContextRefreshQueued = true;
      return;
    }
    returnToParentTraceContextRefreshInFlight = true;
    try {
      await refreshReturnToParentTraceEligibleContext();
    } finally {
      returnToParentTraceContextRefreshInFlight = false;
      if (returnToParentTraceContextRefreshQueued) {
        returnToParentTraceContextRefreshQueued = false;
        scheduleReturnToParentTraceContextRefresh();
      }
    }
  };
  void flushReturnToParentTraceContextRefresh();

  const traceableContinuityDiagnostics = vscode.languages.createDiagnosticCollection("tiinexTraceableContinuity");
  const traceableContinuityValidationTimers = new Map<string, NodeJS.Timeout>();
  const clearTraceableContinuityValidationTimer = (filePath: string): void => {
    const key = path.resolve(filePath).toLowerCase();
    const timer = traceableContinuityValidationTimers.get(key);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    traceableContinuityValidationTimers.delete(key);
  };
  const refreshTraceableContinuityDiagnosticsForDocument = async (document: vscode.TextDocument): Promise<void> => {
    clearTraceableContinuityValidationTimer(document.uri.fsPath);
    const validationKind = getTraceableEditorValidationKindForFsPath(document.uri.fsPath);
    if (!validationKind || document.uri.scheme !== "file" || document.languageId !== "markdown") {
      traceableContinuityDiagnostics.delete(document.uri);
      return;
    }
    try {
      const normalizedDocumentPath = path.resolve(document.uri.fsPath).toLowerCase();
      const readTextFileSync = (filePath: string): string => path.resolve(filePath).toLowerCase() === normalizedDocumentPath
        ? document.getText()
        : readFileSync(filePath, "utf8");
      if (validationKind === "continuity-trace" || validationKind === "schema-generic" || validationKind === "validator-generic") {
        const result = validateTraceableContinuityArtifactChainSync({
          filePath: document.uri.fsPath,
          workspaceRoots: getTraceableOpenWorkspaceFolders(),
          readTextFileSync
        });
        traceableContinuityDiagnostics.set(document.uri, buildTraceableContinuityDiagnostics(document, result));
        return;
      }
      const result = validationKind === "root-schema"
        ? validateTraceableRootSchemaSync({
          filePath: document.uri.fsPath,
          readTextFileSync
        })
        : validationKind === "topic-schema"
          ? validateTraceableTopicSchemaSync({
            filePath: document.uri.fsPath,
            readTextFileSync
          })
          : validationKind === "task-schema"
            ? validateTraceableTaskSchemaSync({
              filePath: document.uri.fsPath,
              readTextFileSync
            })
            : validationKind === "evidence-schema"
              ? validateTraceableEvidenceSchemaSync({
                filePath: document.uri.fsPath,
                readTextFileSync
              })
              : validationKind === "pointer-schema"
                ? validateTraceablePointerSchemaSync({
                  filePath: document.uri.fsPath,
                  readTextFileSync
                })
              : validateTraceableDecisionSchemaSync({
                filePath: document.uri.fsPath,
                readTextFileSync
              });
      traceableContinuityDiagnostics.set(document.uri, buildTraceableSchemaDiagnostics(document, result));
    } catch (error) {
      traceableContinuityDiagnostics.set(document.uri, [new vscode.Diagnostic(
        createTopOfDocumentRange(document),
        `Continuity validation failed: ${error instanceof Error ? error.message : String(error)}`,
        vscode.DiagnosticSeverity.Error
      )]);
    }
  };
  const scheduleTraceableContinuityDiagnosticsRefresh = (document: vscode.TextDocument | undefined, delayMs = 180): void => {
    if (!document || document.uri.scheme !== "file") {
      return;
    }
    clearTraceableContinuityValidationTimer(document.uri.fsPath);
    if (!isTraceableContinuityEligibleDocument(document)) {
      traceableContinuityDiagnostics.delete(document.uri);
      return;
    }
    const key = path.resolve(document.uri.fsPath).toLowerCase();
    traceableContinuityValidationTimers.set(key, setTimeout(() => {
      traceableContinuityValidationTimers.delete(key);
      void refreshTraceableContinuityDiagnosticsForDocument(document);
    }, delayMs));
  };
  const refreshTraceableContinuityDiagnosticsForOpenDocuments = (): void => {
    for (const document of vscode.workspace.textDocuments) {
      scheduleTraceableContinuityDiagnosticsRefresh(document, 0);
    }
  };
  context.subscriptions.push(traceableContinuityDiagnostics);
  context.subscriptions.push(vscode.languages.registerCodeActionsProvider({ language: "markdown", scheme: "file" }, {
    provideCodeActions(document, _range, context) {
      const validationKind = getTraceableEditorValidationKindForFsPath(document.uri.fsPath);
      if (!validationKind) {
        return undefined;
      }
      const actions: vscode.CodeAction[] = [];
      // Use the diagnostics provided by the code action request when available
      // (these are diagnostics intersecting the requested range). When the
      // request's diagnostics are empty, fall back to the stored diagnostics
      // for this document so actions are offered even when the user's cursor
      // is not exactly on the diagnostic range.
      const requestHasDiagnostics = Boolean(context?.diagnostics && context.diagnostics.length > 0);
      const providedDiagnostics = requestHasDiagnostics
        ? context.diagnostics
        : (traceableContinuityDiagnostics.get(document.uri) ?? []);
      const checksumDiagnostics = providedDiagnostics.filter(isContinuityChecksumMismatchDiagnostic);
      if (checksumDiagnostics.length > 0) {
        const action = new vscode.CodeAction("Rotate continuity checksum", vscode.CodeActionKind.QuickFix);
        action.command = {
          command: ROTATE_TRACEABLE_CONTINUITY_CHECKSUM_COMMAND,
          title: "Rotate continuity checksum",
          arguments: [document.uri]
        };
        action.isPreferred = true;
        actions.push(action);
      }
      actions.push(...buildContinuityEnvelopeCodeActions(document, providedDiagnostics));
      actions.push(...buildSchemaLayoutCodeActions(document, providedDiagnostics));
      actions.push(...buildSchemaContractCodeActions(document, providedDiagnostics));
      for (const action of actions) {
        action.diagnostics = undefined;
      }
      return actions.length > 0 ? actions : undefined;
    }
  }, {
    providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
  }));
  context.subscriptions.push({
    dispose: () => {
      for (const timer of traceableContinuityValidationTimers.values()) {
        clearTimeout(timer);
      }
      traceableContinuityValidationTimers.clear();
    }
  });
  refreshTraceableContinuityDiagnosticsForOpenDocuments();

  const returnToParentTraceWatcher = vscode.workspace.createFileSystemWatcher("**/*.trace.md");
  context.subscriptions.push(returnToParentTraceWatcher);
  context.subscriptions.push(returnToParentTraceWatcher.onDidChange(() => {
    scheduleReturnToParentTraceContextRefresh();
  }));
  context.subscriptions.push(returnToParentTraceWatcher.onDidCreate(() => {
    scheduleReturnToParentTraceContextRefresh();
  }));
  context.subscriptions.push(returnToParentTraceWatcher.onDidDelete(() => {
    scheduleReturnToParentTraceContextRefresh();
  }));
  context.subscriptions.push(vscode.workspace.onDidRenameFiles(() => {
    scheduleReturnToParentTraceContextRefresh();
  }));
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
    if (document.uri.scheme === "file" && document.uri.fsPath.toLowerCase().endsWith(".trace.md")) {
      scheduleReturnToParentTraceContextRefresh();
    }
    clearTraceableLatestPermalinkCaches();
    scheduleTraceableContinuityDiagnosticsRefresh(document, 0);
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
    scheduleReturnToParentTraceContextRefresh();
    refreshTraceableContinuityDiagnosticsForOpenDocuments();
  }));
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((document) => {
    scheduleTraceableContinuityDiagnosticsRefresh(document, 40);
  }));
  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((document) => {
    clearTraceableContinuityValidationTimer(document.uri.fsPath);
    traceableContinuityDiagnostics.delete(document.uri);
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
    scheduleTraceableContinuityDiagnosticsRefresh(event.document, 220);
  }));
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
    scheduleTraceableContinuityDiagnosticsRefresh(editor?.document, 0);
  }));
  context.subscriptions.push(vscode.window.onDidChangeWindowState((state) => {
    if (!state.focused) {
      return;
    }
    clearTraceableLatestPermalinkCaches();
    refreshTraceableContinuityDiagnosticsForOpenDocuments();
  }));

  const prepareTraceableRewriteRequestedMove = async (
    sourceUri: vscode.Uri,
    requestedUri: vscode.Uri
  ): Promise<PendingTraceableRewriteRename> => {
    const workspaceRoots = getTraceableWorkspaceRoots();
    const fileNameFormatOptions = getTraceableEvidenceFileNameFormatOptions(getProvenanceConfiguration(requestedUri));
    const requestedFolderChanged = path.resolve(path.dirname(sourceUri.fsPath)).toLowerCase() !== path.resolve(path.dirname(requestedUri.fsPath)).toLowerCase();
    const requestedBaseNameUnchanged = path.basename(sourceUri.fsPath).toLowerCase() === path.basename(requestedUri.fsPath).toLowerCase();

    if (requestedFolderChanged && requestedBaseNameUnchanged) {
      const plan = await planTraceableRewriteMove({
        sourcePath: sourceUri.fsPath,
        destinationFolderPath: path.dirname(requestedUri.fsPath),
        workspaceRoots,
        fileNameFormatOptions
      });
      if (!plan) {
        throw new Error("TRACEABLE rewrite move could not read a supported Traceable State block from the selected file.");
      }
      const returnDisplacementMoves = await planTraceableStandaloneMoveReturnDisplacementMoves({
        sourcePath: sourceUri.fsPath,
        destinationPath: plan.finalPath,
        workspaceRoots
      });
      const dependentRewrites = await planTraceableStandaloneMoveDependencyRewrites({
        sourcePath: sourceUri.fsPath,
        destinationPath: plan.finalPath,
        workspaceRoots
      });
      return {
        oldUri: sourceUri,
        newUri: requestedUri,
        finalUri: vscode.Uri.file(plan.finalPath),
        rewrittenMarkdown: plan.rewrittenMarkdown,
        additionalMoves: [...returnDisplacementMoves],
        additionalRewrites: dependentRewrites
      };
    }

    const plan = await planTraceableRewriteRequestedRename({
      sourcePath: sourceUri.fsPath,
      requestedPath: requestedUri.fsPath,
      workspaceRoots,
      fileNameFormatOptions
    });
    if (!plan) {
      throw new Error("TRACEABLE rewrite rename could not read a supported Traceable State block from the selected file.");
    }
    return {
      oldUri: sourceUri,
      newUri: requestedUri,
      finalUri: vscode.Uri.file(plan.finalPath),
      rewrittenMarkdown: plan.rewrittenMarkdown,
      additionalMoves: [],
      additionalRewrites: []
    };
  };

  const performTraceableRewriteMoveToFolder = async (candidate: vscode.Uri, destinationFolder: vscode.Uri): Promise<string[]> => {
    const preparedPlan = await prepareTraceableRewriteMoveMutationPlan(
      candidate,
      vscode.Uri.file(path.join(destinationFolder.fsPath, path.basename(candidate.fsPath)))
    );
    await ApplyTraceableMutationPlan(preparedPlan.plan);
    return preparedPlan.outputPaths;
  };

  const prepareTraceableRewriteMoveMutationPlan = async (
    candidate: vscode.Uri,
    requestedUri: vscode.Uri
  ): Promise<PreparedTraceableMutationPlan> => {
    const preparedMove = await prepareTraceableRewriteRequestedMove(
      candidate,
      requestedUri
    );
    return {
      plan: {
        blocked: false,
        mutations: [
          createTraceableMoveMutation({
            oldUri: candidate,
            newUri: preparedMove.finalUri,
            rewrittenMarkdown: preparedMove.rewrittenMarkdown
          }),
          ...preparedMove.additionalMoves.map((move) => createTraceableMoveMutation(move)),
          ...preparedMove.additionalRewrites.map((rewrite) => createTraceableRewriteMutation(rewrite.fileUri, rewrite.nextContent))
        ]
      },
      outputPaths: [preparedMove.finalUri.fsPath]
    };
  };

  const performTraceableRewriteCopyToFolder = async (candidate: vscode.Uri, destinationFolder: vscode.Uri): Promise<string[]> => {
    const preparedPlan = await prepareTraceableRewriteCopyMutationPlan(candidate, destinationFolder);
    await ApplyTraceableMutationPlan(preparedPlan.plan);
    return preparedPlan.outputPaths;
  };

  const prepareTraceableRewriteCopyMutationPlan = async (
    candidate: vscode.Uri,
    destinationFolder: vscode.Uri
  ): Promise<PreparedTraceableMutationPlan> => {
    const plan = await planTraceableRewriteMove({
      sourcePath: candidate.fsPath,
      destinationFolderPath: destinationFolder.fsPath,
      workspaceRoots: getTraceableWorkspaceRoots(),
      fileNameFormatOptions: getTraceableEvidenceFileNameFormatOptions(getProvenanceConfiguration(destinationFolder))
    });
    if (!plan) {
      throw new Error("TRACEABLE rewrite copy could not read a supported Traceable State block from the selected file.");
    }
    return {
      plan: {
        blocked: false,
        mutations: [createTraceableCopyMutation({
          oldUri: candidate,
          newUri: vscode.Uri.file(plan.finalPath),
          rewrittenMarkdown: plan.rewrittenMarkdown
        })]
      },
      outputPaths: [plan.finalPath]
    };
  };

  const performTraceablePreserveMoveToFolder = async (
    candidate: vscode.Uri,
    destinationFolder: vscode.Uri,
    lineageScope: TraceableLineageMoveScope
  ): Promise<string[]> => {
    const preparedPlan = await prepareTraceableLineageMoveMutationPlan([{
      oldUri: candidate,
      newUri: vscode.Uri.file(path.join(destinationFolder.fsPath, path.basename(candidate.fsPath)))
    }], lineageScope, getTraceableWorkspaceRoots());
    await ApplyTraceableMutationPlan(preparedPlan.plan);
    return preparedPlan.outputPaths;
  };

  const performTraceablePreserveCopyToFolder = async (
    candidate: vscode.Uri,
    destinationFolder: vscode.Uri,
    lineageScope: TraceableLineageMoveScope
  ): Promise<string[]> => {
    const requestedFiles = [{
      oldUri: candidate,
      newUri: vscode.Uri.file(path.join(destinationFolder.fsPath, path.basename(candidate.fsPath)))
    }];
    const plannedMoves = await planTraceableRenameMoveOperation({
      files: requestedFiles,
      workspaceRoots: getTraceableWorkspaceRoots(),
      allowExistingRequestedTargets: false,
      lineageScope,
      hostOwnedRequestedFiles: requestedFiles
    });
    if (!plannedMoves || plannedMoves.length === 0) {
      throw new Error("TRACEABLE lineage copy could not prepare any file updates.");
    }
    const preparedPlan: PreparedTraceableMutationPlan = {
      plan: {
        blocked: false,
        mutations: plannedMoves.map((move) => createTraceableCopyMutation(move))
      },
      outputPaths: plannedMoves.map((move) => move.newUri.fsPath)
    };
    await ApplyTraceableMutationPlan(preparedPlan.plan);
    return preparedPlan.outputPaths;
  };

  const executeTraceableTransferSelection = async (
    candidate: vscode.Uri,
    destinationFolder: vscode.Uri,
    selection: TraceableTransferSelection
  ): Promise<string[]> => {
    assertTraceableDestinationWithinSourceWorkspace(candidate, destinationFolder);
    if (selection.action === "alone") {
      return selection.operation === "move"
        ? performTraceableRewriteMoveToFolder(candidate, destinationFolder)
        : performTraceableRewriteCopyToFolder(candidate, destinationFolder);
    }
    return selection.operation === "move"
      ? performTraceablePreserveMoveToFolder(candidate, destinationFolder, selection.scope)
      : performTraceablePreserveCopyToFolder(candidate, destinationFolder, selection.scope);
  };

  const performTraceablePlainMoveToFolder = async (candidate: vscode.Uri, destinationFolder: vscode.Uri): Promise<string[]> => {
    const finalUri = vscode.Uri.file(path.join(destinationFolder.fsPath, path.basename(candidate.fsPath)));
    if (path.resolve(candidate.fsPath).toLowerCase() === path.resolve(finalUri.fsPath).toLowerCase()) {
      void vscode.window.showInformationMessage("TRACEABLE plain move skipped because the file is already in the destination folder.");
      return [finalUri.fsPath];
    }
    const preparedPlan: PreparedTraceableMutationPlan = {
      plan: {
        blocked: false,
        mutations: [createTraceableMoveMutation({
          oldUri: candidate,
          newUri: finalUri
        })]
      },
      outputPaths: [finalUri.fsPath]
    };
    await ApplyTraceableMutationPlan(preparedPlan.plan);
    return preparedPlan.outputPaths;
  };

  const transferTrace = async (input: TransferTraceInput): Promise<{ outputPaths: string[]; lineageScope?: TraceableLineageMoveScope; sourcePaths: string[]; droppedSourcePaths: string[] }> => {
    const requestedSourcePaths = [
      input.sourcePath,
      ...(Array.isArray(input.sourcePaths) ? input.sourcePaths : [])
    ].filter((value, index, array): value is string => {
      if (typeof value !== "string") {
        return false;
      }
      const trimmed = value.trim();
      return Boolean(trimmed) && array.findIndex((candidate) => typeof candidate === "string" && candidate.trim() === trimmed) === index;
    });
    if (requestedSourcePaths.length === 0) {
      throw new Error("transferTrace requires at least one sourcePath.");
    }
    const sourceUris = await Promise.all(requestedSourcePaths.map((sourcePath) => resolveTraceableTransferSourceUri(sourcePath)));
    const destinationFolderUri = await resolveTraceableTransferDestinationFolderUri(input.destinationFolderPath);
    if (sourceUris.some((sourceUri) => getConfiguredTraceableDisableMoveCopyLogic(sourceUri))) {
      throw new Error("TRACEABLE move/copy logic is disabled for this resource. Re-enable `tiinex.aiProvenance.traceableDisableMoveCopyLogic` to use transferTrace.");
    }
    for (const sourceUri of sourceUris) {
      assertTraceableDestinationWithinSourceWorkspace(sourceUri, destinationFolderUri);
    }
    const workspaceRoots = getTraceableWorkspaceRoots();
    const requestedFiles = sourceUris.map((sourceUri) => ({
      oldUri: sourceUri,
      newUri: vscode.Uri.file(path.join(destinationFolderUri.fsPath, path.basename(sourceUri.fsPath)))
    }));
    const normalizedSelection = requestedFiles.length > 1
      ? await normalizeTraceableRenameMoveFileSelection({ files: requestedFiles, workspaceRoots })
      : { plannedFiles: requestedFiles, droppedFiles: [] };
    const plannedFiles = normalizedSelection.plannedFiles;
    if (plannedFiles.length === 0) {
      throw new Error("transferTrace could not plan any source files after overlap normalization.");
    }
    if (input.action === "alone") {
      const outputPaths = await runTraceableOwnedMoveOperation(async () => {
        const outputs: string[] = [];
        for (const file of plannedFiles) {
          const nextOutputPaths = await executeTraceableTransferSelection(file.oldUri, destinationFolderUri, {
            action: "alone",
            operation: input.operation
          });
          outputs.push(...nextOutputPaths);
        }
        return outputs;
      });
      return {
        outputPaths,
        sourcePaths: plannedFiles.map((file) => file.oldUri.fsPath),
        droppedSourcePaths: normalizedSelection.droppedFiles.map((file) => file.oldUri.fsPath)
      };
    }
    const sharedScopeSets = await Promise.all(plannedFiles.map((file) => inspectTraceableLineageMoveScopes(file.oldUri.fsPath, workspaceRoots)));
    const sharedScopes = sharedScopeSets.reduce<TraceableLineageMoveScope[]>((result, scopes, index) => {
      if (index === 0) {
        return [...scopes];
      }
      return result.filter((scope) => scopes.includes(scope));
    }, []).filter((scope) => plannedFiles.length <= 1 || (scope !== "tree" && scope !== "tree-plus-seeds"));
    const requestedLineageScope = input.lineageScope;
    const lineageScope = requestedLineageScope
      ? await resolveTransferTraceLineageScope(plannedFiles[0].oldUri, destinationFolderUri, requestedLineageScope)
      : sharedScopes[0]
        ? await resolveTransferTraceLineageScope(plannedFiles[0].oldUri, destinationFolderUri, sharedScopes[0])
        : await resolveTransferTraceLineageScope(plannedFiles[0].oldUri, destinationFolderUri, requestedLineageScope);
    const outputPaths = await runTraceableOwnedMoveOperation(async () => {
      const outputs: string[] = [];
      for (const file of plannedFiles) {
        const nextOutputPaths = await executeTraceableTransferSelection(file.oldUri, destinationFolderUri, {
          action: "lineage",
          operation: input.operation,
          scope: lineageScope
        });
        outputs.push(...nextOutputPaths);
      }
      return outputs;
    });
    return {
      outputPaths,
      lineageScope,
      sourcePaths: plannedFiles.map((file) => file.oldUri.fsPath),
      droppedSourcePaths: normalizedSelection.droppedFiles.map((file) => file.oldUri.fsPath)
    };
  };

  const rewriteMoveTrace = async (target?: vscode.Uri): Promise<void> => {
    const candidate = target;
    if (!candidate || candidate.scheme !== "file" || !candidate.fsPath.toLowerCase().endsWith(".trace.md")) {
      void vscode.window.showErrorMessage("Invoke Move Trace from a .trace.md file in the Explorer.");
      return;
    }
    if (getConfiguredTraceableDisableMoveCopyLogic(candidate)) {
      void vscode.window.showInformationMessage("TRACEABLE move/copy logic is disabled for this resource. Re-enable `tiinex.aiProvenance.traceableDisableMoveCopyLogic` to use rewrite or lineage move flows again.");
      return;
    }
    if (!(await ensureTraceableLineageReadyForCommand(candidate, "Move Trace"))) {
      return;
    }
    const pickedFolders = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      defaultUri: vscode.Uri.file(path.dirname(candidate.fsPath)),
      openLabel: "Move Trace Here",
      title: "Choose TRACEABLE move destination folder"
    });
    const destinationFolder = pickedFolders?.[0];
    if (!destinationFolder || destinationFolder.scheme !== "file") {
      return;
    }
    const requestedFiles = [{ oldUri: candidate, newUri: vscode.Uri.file(path.join(destinationFolder.fsPath, path.basename(candidate.fsPath))) }];
    const workspaceRoots = getTraceableWorkspaceRoots();
    const promptOutcome = await resolveTraceableTransferPromptOutcome({
      files: requestedFiles,
      workspaceRoots,
      operationLabel: "move",
      resource: candidate
    });
    if (promptOutcome.action === "cancel") {
      return;
    }
    try {
      await executeTraceableTransferSelection(candidate, destinationFolder, promptOutcome.action === "alone"
        ? { action: "alone", operation: "move" }
        : { action: "lineage", operation: "move", scope: promptOutcome.scope });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`TRACEABLE move could not be completed: ${message}`);
    }
  };

  const rewriteCopyTrace = async (target?: vscode.Uri): Promise<void> => {
    const candidate = target;
    if (!candidate || candidate.scheme !== "file" || !candidate.fsPath.toLowerCase().endsWith(".trace.md")) {
      void vscode.window.showErrorMessage("Invoke Copy Trace from a .trace.md file in the Explorer.");
      return;
    }
    if (getConfiguredTraceableDisableMoveCopyLogic(candidate)) {
      void vscode.window.showInformationMessage("TRACEABLE move/copy logic is disabled for this resource. Re-enable `tiinex.aiProvenance.traceableDisableMoveCopyLogic` to use rewrite or lineage copy flows again.");
      return;
    }
    if (!(await ensureTraceableLineageReadyForCommand(candidate, "Copy Trace"))) {
      return;
    }
    const pickedFolders = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      defaultUri: vscode.Uri.file(path.dirname(candidate.fsPath)),
      openLabel: "Copy Trace Here",
      title: "Choose TRACEABLE copy destination folder"
    });
    const destinationFolder = pickedFolders?.[0];
    if (!destinationFolder || destinationFolder.scheme !== "file") {
      return;
    }
    const requestedFiles = [{ oldUri: candidate, newUri: vscode.Uri.file(path.join(destinationFolder.fsPath, path.basename(candidate.fsPath))) }];
    const workspaceRoots = getTraceableWorkspaceRoots();
    const promptOutcome = await resolveTraceableTransferPromptOutcome({
      files: requestedFiles,
      workspaceRoots,
      operationLabel: "copy",
      resource: candidate
    });
    if (promptOutcome.action === "cancel") {
      return;
    }
    try {
      await executeTraceableTransferSelection(candidate, destinationFolder, promptOutcome.action === "alone"
        ? { action: "alone", operation: "copy" }
        : { action: "lineage", operation: "copy", scope: promptOutcome.scope });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`TRACEABLE copy could not be completed: ${message}`);
    }
  };

  const returnToParentTrace = async (target?: vscode.Uri): Promise<void> => {
    const candidate = target;
    if (!candidate || candidate.scheme !== "file" || !candidate.fsPath.toLowerCase().endsWith(".trace.md")) {
      void vscode.window.showErrorMessage("Invoke Return to Parent Trace from a .trace.md file in the Explorer.");
      return;
    }
    if (getConfiguredTraceableDisableMoveCopyLogic(candidate)) {
      void vscode.window.showInformationMessage("TRACEABLE move/copy logic is disabled for this resource. Re-enable `tiinex.aiProvenance.traceableDisableMoveCopyLogic` to use rewrite or lineage move flows again.");
      return;
    }
    if (!(await ensureTraceableLineageReadyForCommand(candidate, "Return to Parent Trace"))) {
      return;
    }
    const destinationFolderPath = await resolveReturnToParentTraceDestinationFolder(candidate);
    if (!destinationFolderPath?.trim()) {
      void vscode.window.showInformationMessage("Return to Parent Trace skipped because no ancestor parent trace leaves the current folder.");
      return;
    }
    const destinationFolder = vscode.Uri.file(destinationFolderPath);
    const requestedFiles = [{ oldUri: candidate, newUri: vscode.Uri.file(path.join(destinationFolder.fsPath, path.basename(candidate.fsPath))) }];
    const workspaceRoots = getTraceableWorkspaceRoots();
    const promptOutcome = await resolveTraceableTransferPromptOutcome({
      files: requestedFiles,
      workspaceRoots,
      operationLabel: "move",
      resource: candidate
    });
    if (promptOutcome.action === "cancel") {
      return;
    }
    try {
      await executeTraceableTransferSelection(candidate, destinationFolder, promptOutcome.action === "alone"
        ? { action: "alone", operation: "move" }
        : { action: "lineage", operation: "move", scope: promptOutcome.scope });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Return to Parent Trace could not be completed: ${message}`);
    }
  };

  const addFileToTraceableChat = async (target?: vscode.Uri): Promise<void> => {
    const candidate = target;
    if (!candidate || candidate.scheme !== "file") {
      void vscode.window.showErrorMessage("Invoke Add File to Traceable Chat from a file in the Explorer.");
      return;
    }
    void vscode.window.showInformationMessage("Add File to Traceable Chat is not implemented yet. This will later insert a file reference into the active Traceable chat composer.");
  };

  context.subscriptions.push(output);
  context.subscriptions.push(...registerTraceableStructureTreeView(context));
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
    vscode.workspace.onDidCreateFiles((event) => {
      void (async () => {
        const createdTraceUris = await collectCreatedTraceableEvidenceUris(event.files);
        const revertedPaths: string[] = [];
        for (const fileUri of createdTraceUris) {
          if (getConfiguredTraceableDisableMoveCopyLogic(fileUri)) {
            continue;
          }
          let markdown: string | undefined;
          try {
            markdown = Buffer.from(await vscode.workspace.fs.readFile(fileUri)).toString("utf8");
          } catch {
            continue;
          }
          const parsed = typeof markdown === "string" ? parseTraceableEvidenceStateMarkdown(markdown) : undefined;
          if (!parsed?.result) {
            continue;
          }
          try {
            await vscode.workspace.fs.delete(fileUri, { recursive: false, useTrash: false });
            revertedPaths.push(fileUri.fsPath);
          } catch {
            // Leave the file in place if rollback fails; the operator still needs the warning.
          }
        }
        if (revertedPaths.length > 0) {
          const detail = revertedPaths.length === 1
            ? ` Removed: ${path.basename(revertedPaths[0])}.`
            : ` Removed ${revertedPaths.length} created trace copies.`;
          void vscode.window.showErrorMessage(`${TRACEABLE_NATIVE_COPY_PASTE_UNSUPPORTED_MESSAGE}${detail}`);
        }
      })();
    }),
    vscode.workspace.onWillRenameFiles((event) => {
      if (traceableExtensionOwnedRenameDepth > 0) {
        return;
      }
      const relevantFiles = event.files.filter(({ oldUri, newUri }) => {
        const pairKey = buildTraceableRenamePairKey(oldUri, newUri);
        if (suppressedTraceableRenamePairs.delete(pairKey)) {
          return false;
        }
        return (
        oldUri.scheme === "file"
        && newUri.scheme === "file"
        && oldUri.fsPath.toLowerCase().endsWith(".trace.md")
        && newUri.fsPath.toLowerCase().endsWith(".trace.md")
        );
      });
      if (relevantFiles.length === 0) {
        return;
      }
      if (relevantFiles.some((file) => getConfiguredTraceableDisableMoveCopyLogic(file.newUri) || getConfiguredTraceableDisableMoveCopyLogic(file.oldUri))) {
        return;
      }
      if (relevantFiles.some((file) => {
        try {
          assertTraceableDestinationWithinSourceWorkspace(file.oldUri, file.newUri);
          return false;
        } catch {
          return true;
        }
      })) {
        void vscode.window.showErrorMessage(TRACEABLE_CROSS_WORKSPACE_DESTINATION_UNSUPPORTED_MESSAGE);
        event.waitUntil(Promise.reject(new Error(TRACEABLE_CROSS_WORKSPACE_DESTINATION_UNSUPPORTED_MESSAGE)));
        return;
      }
      event.waitUntil((async () => {
        for (const file of relevantFiles) {
          pendingTraceableRewriteRenames.delete(buildTraceableRenamePairKey(file.oldUri, file.newUri));
        }
        const workspaceRoots = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
        const normalizedSelection = relevantFiles.length > 1
          ? await normalizeTraceableRenameMoveFileSelection({ files: relevantFiles, workspaceRoots })
          : { plannedFiles: relevantFiles, droppedFiles: [] };
        const plannedRelevantFiles = normalizedSelection.plannedFiles;
        const promptOutcome = await resolveTraceableTransferPromptOutcome({
          files: plannedRelevantFiles,
          workspaceRoots,
          operationLabel: "move",
          resource: plannedRelevantFiles[0]?.newUri
        });
        const takeoverError = new Error("TRACEABLE rename or move is being handled by the extension-owned staged move flow.");
        if (promptOutcome.action === "cancel") {
          for (const file of relevantFiles) {
            cancelledTraceableRenamePairs.set(buildTraceableRenamePairKey(file.oldUri, file.newUri), file);
          }
          return Promise.reject(new Error("TRACEABLE rename or move cancelled by user."));
        }
        if (promptOutcome.action === "alone") {
          for (const file of plannedRelevantFiles) {
            const preparedMove = await prepareTraceableRewriteRequestedMove(file.oldUri, file.newUri);
            pendingTraceableRewriteRenames.set(buildTraceableRenamePairKey(file.oldUri, file.newUri), preparedMove);
          }
          return new vscode.WorkspaceEdit();
        }
        try {
          const lineageEdit = await buildTraceableRenameMoveWorkspaceEdit({
            files: plannedRelevantFiles,
            workspaceRoots,
            hostOwnsRequestedSourceRenames: true,
            allowExistingRequestedTargets: false,
            lineageScope: promptOutcome.scope,
            hostOwnedRequestedFiles: plannedRelevantFiles,
            onPlannedRename: ({ oldUri, newUri }) => {
              suppressedTraceableRenamePairs.add(buildTraceableRenamePairKey(oldUri, newUri));
            }
          });
          if (!lineageEdit || lineageEdit.size === 0) {
            throw new Error("TRACEABLE lineage move could not prepare any file updates.");
          }
          return lineageEdit;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          void vscode.window.showErrorMessage(`TRACEABLE rename or move rewrite could not be prepared: ${message}`);
          return Promise.reject(new Error(`TRACEABLE rename or move could not be prepared: ${message}`));
        }
      })());
    }),
    vscode.workspace.onDidRenameFiles((event) => {
      void (async () => {
        const cancelledFiles = event.files.flatMap((file) => {
          const pairKey = buildTraceableRenamePairKey(file.oldUri, file.newUri);
          const cancelled = cancelledTraceableRenamePairs.get(pairKey);
          if (!cancelled) {
            return [];
          }
          cancelledTraceableRenamePairs.delete(pairKey);
          return [cancelled];
        });
        for (const file of cancelledFiles) {
          try {
            const oldExists = await vscode.workspace.fs.stat(file.oldUri).then(() => true, () => false);
            const newExists = await vscode.workspace.fs.stat(file.newUri).then(() => true, () => false);
            if (oldExists || !newExists) {
              continue;
            }
            suppressedTraceableRenamePairs.add(buildTraceableRenamePairKey(file.newUri, file.oldUri));
            await withTraceableExtensionOwnedRenameSuppressed(() => vscode.workspace.fs.rename(file.newUri, file.oldUri, { overwrite: false }));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`TRACEABLE cancel rollback could not restore the original file location: ${message}`);
          }
        }
        const pendingFiles = event.files.flatMap((file) => {
          const pairKey = buildTraceableRenamePairKey(file.oldUri, file.newUri);
          const pending = pendingTraceableRewriteRenames.get(pairKey);
          if (!pending) {
            return [];
          }
          pendingTraceableRewriteRenames.delete(pairKey);
          return [pending];
        });
        if (pendingFiles.length === 0) {
          return;
        }
        for (const file of pendingFiles) {
          try {
            let targetUri = file.newUri;
            if (path.resolve(file.finalUri.fsPath).toLowerCase() !== path.resolve(file.newUri.fsPath).toLowerCase()) {
              const finalUri = file.finalUri;
              suppressedTraceableRenamePairs.add(buildTraceableRenamePairKey(file.newUri, finalUri));
              await vscode.workspace.fs.rename(file.newUri, finalUri, { overwrite: false });
              targetUri = finalUri;
            }
            await ApplyTraceableMutationPlan({
              blocked: false,
              mutations: [
                createTraceableRewriteMutation(targetUri, file.rewrittenMarkdown),
                ...file.additionalMoves.map((move) => createTraceableMoveMutation(move)),
                ...file.additionalRewrites.map((rewrite) => createTraceableRewriteMutation(rewrite.fileUri, rewrite.nextContent))
              ]
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`TRACEABLE rewrite could not be completed: ${message}`);
          }
        }
      })();
    }),
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
    vscode.commands.registerCommand(CREATE_TRACEABLE_CHAT_FROM_VIEW_COMMAND, async () => {
      await startNewTraceableNodeFromView();
    }),
    ...TRACEABLE_NODE_SCHEMA_COMMANDS.map(({ command, schemaId }) => vscode.commands.registerCommand(command, async () => {
      await startNewTraceableNodeFromView(schemaId);
    })),
    vscode.commands.registerCommand(RESUME_TRACEABLE_CHAT_COMMAND, async (target?: vscode.Uri) => {
      await startNewTraceableChat(target);
    }),
    vscode.commands.registerCommand(SET_DEFAULT_NEW_TRACEABLE_CHAT_EXPORT_FOLDER_COMMAND, async (target?: vscode.Uri) => {
      await setDefaultNewTraceableChatExportFolder(target);
    }),
    vscode.commands.registerCommand(REWRITE_MOVE_TRACE_COMMAND, async (target?: vscode.Uri) => {
      await rewriteMoveTrace(target);
    }),
    vscode.commands.registerCommand(REWRITE_COPY_TRACE_COMMAND, async (target?: vscode.Uri) => {
      await rewriteCopyTrace(target);
    }),
    vscode.commands.registerCommand(RETURN_TO_PARENT_TRACE_COMMAND, async (target?: vscode.Uri) => {
      await returnToParentTrace(target);
    }),
    vscode.commands.registerCommand(REPAIR_TRACE_LINEAGE_COMMAND, async (target?: vscode.Uri) => {
      await repairTraceableLineage(target);
    }),
    vscode.commands.registerCommand(VALIDATE_TRACEABLE_CONTINUITY_COMMAND, async (target?: vscode.Uri) => {
      const artifactUri = resolveMarkdownArtifactUri(target);
      if (!artifactUri) {
        void vscode.window.showErrorMessage("Open a markdown continuity artifact first, or invoke the command from a markdown file.");
        return;
      }
      const summary = renderTraceableContinuityValidationMarkdown(validateTraceableContinuityArtifactChainSync({
        filePath: artifactUri.fsPath,
        workspaceRoots: getTraceableOpenWorkspaceFolders()
      }));
      const document = await vscode.workspace.openTextDocument({
        language: "markdown",
        content: summary
      });
      await vscode.window.showTextDocument(document, { preview: false });
      output.appendLine(`Validated continuity artifact: ${artifactUri.fsPath}`);
    }),
    vscode.commands.registerCommand(ROTATE_TRACEABLE_CONTINUITY_CHECKSUM_COMMAND, async (target?: vscode.Uri) => {
      await rotateTraceableContinuityChecksum(output, target);
    }),
    vscode.commands.registerCommand(REFRESH_TRACEABLE_PERMALINK_FROM_LATEST_COMMAND, async (target?: vscode.Uri, lineIndex?: number, diagnosticCode?: string) => {
      await refreshTraceablePermalinkFromLatest(output, target, lineIndex, diagnosticCode);
    }),
    vscode.commands.registerCommand(REPAIR_TRACEABLE_PARENT_TRACE_TARGET_COMMAND, async (target?: vscode.Uri) => {
      await repairTraceableParentTraceTarget(output, target);
    }),
    vscode.commands.registerCommand(ADD_FILE_TO_TRACEABLE_CHAT_COMMAND, async (target?: vscode.Uri) => {
      await addFileToTraceableChat(target);
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
    vscode.lm.registerTool(SHOW_TRACEABLE_TRACES_TOOL, {
      prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<ResolvedShowTracesInput>): vscode.PreparedToolInvocation {
        return {
          invocationMessage: `Show traces${options.input.targetPath ? ` near ${JSON.stringify(options.input.targetPath)}` : " across the workspace"}${options.input.detailLevel ? ` as ${options.input.detailLevel}` : ""}`
        };
      },
      async invoke(options: vscode.LanguageModelToolInvocationOptions<ResolvedShowTracesInput>): Promise<vscode.LanguageModelToolResult> {
        const resolvedTargetPath = options.input.targetPath
          ? await resolveTraceableOpenPath(options.input.targetPath)
          : undefined;
        return textResult(await renderShowTracesMarkdown({
          workspaceFolders: getTraceableOpenWorkspaceFolders(),
          resolvedTargetPath,
          view: {
            ...options.input,
            detailLevel: options.input.detailLevel ?? "standard",
            includeSchemas: options.input.includeSchemas ?? true
          }
        }));
      }
    }),
    vscode.lm.registerTool(TRANSFER_TRACE_TOOL, {
      prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<TransferTraceInput>): vscode.PreparedToolInvocation {
        return {
          invocationMessage: `Transfer TRACEABLE ${options.input.operation} ${options.input.action} from ${JSON.stringify(options.input.sourcePath)} to ${JSON.stringify(options.input.destinationFolderPath)}`
        };
      },
      async invoke(options: vscode.LanguageModelToolInvocationOptions<TransferTraceInput>): Promise<vscode.LanguageModelToolResult> {
        const result = await transferTrace(options.input);
        if (options.input.reveal && result.outputPaths[0]) {
          await openTraceableEvidenceEditor(result.outputPaths[0]);
        }
        return textResult(renderTransferTraceResultMarkdown({
          operation: options.input.operation,
          action: options.input.action,
          sourcePaths: result.sourcePaths,
          destinationFolderPath: options.input.destinationFolderPath,
          lineageScope: result.lineageScope,
          outputPaths: result.outputPaths,
          droppedSourcePaths: result.droppedSourcePaths
        }));
      }
    }),
    vscode.lm.registerTool(VALIDATE_TRACEABLE_CONTINUITY_TOOL, {
      prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<ValidateTraceableContinuityInput>): vscode.PreparedToolInvocation {
        return {
          invocationMessage: `Validate continuity backward from ${JSON.stringify(options.input.filePath)}`
        };
      },
      async invoke(options: vscode.LanguageModelToolInvocationOptions<ValidateTraceableContinuityInput>): Promise<vscode.LanguageModelToolResult> {
        const resolvedArtifactPath = await resolveMarkdownArtifactFilePath(options.input.filePath);
        if (!resolvedArtifactPath.toLowerCase().endsWith(".md")) {
          throw new Error(`Continuity validation requires a markdown artifact. Got ${JSON.stringify(resolvedArtifactPath)}.`);
        }
        return textResult(renderTraceableContinuityValidationMarkdown(validateTraceableContinuityArtifactChainSync({
          filePath: resolvedArtifactPath,
          maxDepth: options.input.maxDepth,
          workspaceRoots: getTraceableOpenWorkspaceFolders()
        })));
      }
    }),
    vscode.lm.registerTool(REPAIR_TRACE_LINEAGE_TOOL, {
      prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<RepairTraceableLineageInput>): vscode.PreparedToolInvocation {
        return {
          invocationMessage: `Repair trace lineage from ${JSON.stringify(options.input.targetPath)}`
        };
      },
      async invoke(options: vscode.LanguageModelToolInvocationOptions<RepairTraceableLineageInput>): Promise<vscode.LanguageModelToolResult> {
        if (traceableLineageRepairMutex.isLocked()) {
          throw new Error(TRACEABLE_BUSY_MESSAGE);
        }
        const lease = await traceableLineageRepairMutex.acquire("repairTraceLineage tool");
        try {
          const result = await runTraceableLineageRepairInternal({
            targetPath: options.input.targetPath,
            autoCommit: options.input.autoCommit !== false,
            commitMessagePrefix: options.input.commitMessagePrefix,
            maxIterations: options.input.maxIterations
          });
          return textResult(renderTraceableLineageRepairMarkdown(result));
        } finally {
          lease.release();
        }
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