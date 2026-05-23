import path from "node:path";
import { promises as fs } from "node:fs";
import * as vscode from "vscode";
import { allocateNextTraceableLineageLabel, buildTraceableEvidenceFileName, computeStoredParentTracePath, parseTraceableEvidenceFileName } from "./traceableLineage";
import { buildTraceableMarkdownPathRenderOptions, formatTraceablePathReference } from "./traceableContract";
import type {
  TraceableMarkdownPathRenderOptions,
  TraceableSubagentEvidenceFileState,
  TraceableSubagentInput,
  TraceableSubagentOutputMode,
  TraceableSubagentRunResult
} from "./traceableSubagent";
import { normalizeTraceableOutputMode, renderTraceableSubagentMarkdown } from "./traceableSubagent";
import type { TraceableSubagentDetailSnapshot } from "./traceableSubagentStatusDetail";

export const TRACEABLE_EVIDENCE_STATE_SCHEMA = "tiinex.traceable-state.v1";

export interface ParsedTraceableEvidenceState {
  snapshot: TraceableSubagentDetailSnapshot;
  result?: TraceableSubagentRunResult;
}

function slugifyTraceableRoleLabel(value: string | undefined): string {
  const normalized = (value ?? "")
    .replace(/\s*\([^)]*\)/g, " ")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return normalized || "traceable";
}

function getEvidenceRoleSlug(snapshot: TraceableSubagentDetailSnapshot): string {
  if (!isGenericTraceLaneHeader(snapshot) && snapshot.header.agentName.trim()) {
    return slugifyTraceableRoleLabel(snapshot.header.agentName);
  }
  if (snapshot.header.modelLabel.trim()) {
    return slugifyTraceableRoleLabel(snapshot.header.modelLabel);
  }
  return "traceable";
}

async function allocateEvidenceFilePath(folderPath: string, roleSlug: string): Promise<{ filePath: string; fileName: string }> {
  const entries = await fs.readdir(folderPath, { withFileTypes: true }).catch(() => []);
  const fileName = buildTraceableEvidenceFileName(
    allocateNextTraceableLineageLabel(entries.filter((entry) => entry.isFile()).map((entry) => entry.name)),
    roleSlug
  );
  return {
    fileName,
    filePath: path.join(folderPath, fileName)
  };
}

async function allocateContinuationEvidenceFilePath(folderPath: string, parentTracePath: string, roleSlug: string): Promise<{ filePath: string; fileName: string }> {
  const parentParts = parseTraceableEvidenceFileName(path.basename(parentTracePath));
  if (!parentParts) {
    throw new Error(`TRACEABLE continuation parent ${JSON.stringify(parentTracePath)} does not use a supported lineage filename.`);
  }
  const entries = await fs.readdir(folderPath, { withFileTypes: true }).catch(() => []);
  const lineageLabel = allocateNextTraceableLineageLabel(
    entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
    parentParts.lineageLabel
  );
  const fileName = buildTraceableEvidenceFileName(lineageLabel, roleSlug);
  return {
    fileName,
    filePath: path.join(folderPath, fileName)
  };
}

function parseAllocatedEvidenceFileName(fileName: string | undefined): { index: string; slug: string } | undefined {
  const parsed = parseTraceableEvidenceFileName(fileName);
  if (!parsed) {
    return undefined;
  }
  return {
    index: parsed.lineageLabel,
    slug: parsed.slug
  };
}

async function renameEvidenceFileForSnapshot(
  snapshot: TraceableSubagentDetailSnapshot,
  exportState: TraceableSubagentEvidenceFileState
): Promise<TraceableSubagentEvidenceFileState> {
  const currentFileName = exportState.fileName?.trim();
  const currentFilePath = exportState.filePath?.trim();
  if (!currentFileName || !currentFilePath) {
    return exportState;
  }
  const parsed = parseAllocatedEvidenceFileName(currentFileName);
  if (!parsed) {
    return exportState;
  }
  const desiredSlug = getEvidenceRoleSlug(snapshot);
  if (!desiredSlug || parsed.slug === desiredSlug) {
    return exportState;
  }
  const nextFileName = buildTraceableEvidenceFileName(parsed.index, desiredSlug);
  const nextFilePath = path.join(path.dirname(currentFilePath), nextFileName);
  if (nextFilePath === currentFilePath) {
    return exportState;
  }
  await fs.rename(currentFilePath, nextFilePath);
  return {
    ...exportState,
    fileName: nextFileName,
    filePath: nextFilePath
  };
}

function summarizeRequestSummary(snapshot: TraceableSubagentDetailSnapshot, pathRenderOptions: TraceableMarkdownPathRenderOptions): string[] {
  if (snapshot.requestSummary.length === 0) {
    return ["- No request summary captured yet."];
  }
  return snapshot.requestSummary.map((item) => {
    const rawText = item.title ?? item.value;
    const rewritten = rawText.replace(/(^|\n)Export folder:\s+(.+)$/u, (_match, prefix, folderPath) => {
      return `${prefix}Export folder: ${formatTraceablePathReference(folderPath.trim(), pathRenderOptions)}`;
    });
    return `- ${item.label}: ${rewritten}`;
  });
}

function isGenericTraceLaneHeader(snapshot: TraceableSubagentDetailSnapshot): boolean {
  return !snapshot.header.agentResolved && (snapshot.header.agentName ?? "").trim() === "Trace lane";
}

function getEvidenceTitle(snapshot: TraceableSubagentDetailSnapshot): string {
  if (!isGenericTraceLaneHeader(snapshot) && snapshot.header.agentName.trim()) {
    return `${snapshot.header.agentName.trim()} Evidence`;
  }
  if (snapshot.header.modelLabel.trim()) {
    return `${snapshot.header.modelLabel.trim()} Evidence`;
  }
  return "Traceable Evidence";
}

function getEvidenceRoleDisplay(snapshot: TraceableSubagentDetailSnapshot): string {
  if (!isGenericTraceLaneHeader(snapshot) && snapshot.header.agentName.trim()) {
    return snapshot.header.agentName.trim();
  }
  return "-";
}

function buildTraceableEvidenceState(
  snapshot: TraceableSubagentDetailSnapshot,
  exportState: TraceableSubagentEvidenceFileState,
  result: TraceableSubagentRunResult | undefined
): Record<string, unknown> {
  const sanitizedResult = result
    ? {
      request: result.request,
      outputMode: result.outputMode,
      model: result.model,
      allowedToolNames: result.allowedToolNames,
      toolCalls: result.toolCalls,
      traceStatus: result.traceStatus,
      steps: result.steps,
      expectedButMissing: result.expectedButMissing,
      continuedFromParent: result.continuedFromParent,
      parentTracePath: result.parentTracePath,
      lineageDepth: result.lineageDepth,
      lineageLabel: result.lineageLabel,
      activeCarryForward: result.activeCarryForward,
      recoverableCarryState: result.recoverableCarryState,
      carryStateDisposition: result.carryStateDisposition,
      stopReason: result.stopReason,
      stoppedBy: result.stoppedBy,
      stopSource: result.stopSource,
      stopRequestedAt: result.stopRequestedAt,
      completionClaim: result.completionClaim,
      finalSummary: result.finalSummary,
      validationIssues: result.validationIssues,
      opaqueDelegations: result.opaqueDelegations,
      usage: result.usage,
      timingSummary: result.timingSummary,
      iterationMetrics: result.iterationMetrics,
      elapsedMs: result.elapsedMs,
      evidenceFile: result.evidenceFile
    }
    : undefined;
  return {
    schema: TRACEABLE_EVIDENCE_STATE_SCHEMA,
    snapshot: {
      ...snapshot,
      evidenceFile: { ...exportState },
      header: {
        ...snapshot.header,
        displayTitle: getEvidenceTitle(snapshot),
        roleDisplay: getEvidenceRoleDisplay(snapshot)
      }
    },
    result: sanitizedResult
  };
}

export function parseTraceableEvidenceStateMarkdown(markdown: string): ParsedTraceableEvidenceState | undefined {
  const match = markdown.match(/## Traceable State\s+```json\s*([\s\S]*?)\s*```/u);
  if (!match?.[1]) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }
  const record = parsed as Record<string, unknown>;
  if (record.schema !== TRACEABLE_EVIDENCE_STATE_SCHEMA) {
    return undefined;
  }
  const snapshot = record.snapshot;
  if (!snapshot || typeof snapshot !== "object") {
    return undefined;
  }
  return {
    snapshot: snapshot as TraceableSubagentDetailSnapshot,
    result: record.result && typeof record.result === "object"
      ? record.result as TraceableSubagentRunResult
      : undefined
  };
}

function parseEvidenceTimestampMs(value: string | undefined): number | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatEvidenceClockTime(value: string | undefined): string | undefined {
  const timestampMs = parseEvidenceTimestampMs(value);
  if (timestampMs === undefined) {
    return undefined;
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(timestampMs));
}

function formatEvidenceElapsed(ms: number | undefined): string | undefined {
  if (!Number.isFinite(ms) || (ms ?? 0) < 0) {
    return undefined;
  }
  const totalMs = ms as number;
  if (totalMs < 1000) {
    return `${totalMs}ms`;
  }
  const totalSeconds = Math.floor(totalMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function humanizeEvidencePhase(phase: TraceableSubagentDetailSnapshot["statusHistory"][number]["phase"]): string {
  switch (phase) {
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "warning":
      return "Warning";
    case "error":
      return "Failed";
    case "idle":
      return "Idle";
  }
}

function humanizeToolPhase(phase: TraceableSubagentDetailSnapshot["recentTools"][number]["phase"]): string {
  switch (phase) {
    case "success":
      return "Succeeded";
    case "failure":
      return "Failed";
    case "deferred":
      return "Deferred";
    case "running":
      return "Running";
  }
}

function humanizeToolLabel(toolName: string): string {
  const normalized = toolName.trim().replace(/^copilot_/u, "");
  if (!normalized) {
    return "Tool";
  }
  return normalized
    .replace(/[_/]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function rewriteEvidenceTextPathMentions(
  text: string,
  exportState: TraceableSubagentEvidenceFileState,
  pathRenderOptions: TraceableMarkdownPathRenderOptions
): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return trimmed;
  }
  const candidatePaths = [
    exportState.filePath?.trim(),
    exportState.filePath?.trim() ? path.dirname(exportState.filePath.trim()) : undefined
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .flatMap((candidatePath) => candidatePath.includes("\\")
      ? [candidatePath, candidatePath.replace(/\\/g, "\\\\")]
      : [candidatePath])
    .sort((left, right) => right.length - left.length);
  let rewritten = trimmed;
  for (const candidatePath of candidatePaths) {
    rewritten = rewritten.split(candidatePath).join(
      formatTraceablePathReference(candidatePath.replace(/\\\\/g, "\\"), pathRenderOptions, candidatePath)
    );
  }
  return rewritten;
}

function summarizeActivityTimeline(
  snapshot: TraceableSubagentDetailSnapshot,
  exportState: TraceableSubagentEvidenceFileState,
  pathRenderOptions: TraceableMarkdownPathRenderOptions
): string[] {
  type TimelineEntry = {
    occurredAtMs: number;
    occurredAtLabel: string;
    line: string;
    order: number;
  };
  const entries: TimelineEntry[] = [];
  const sortedStatusEvents = [...snapshot.statusHistory].sort((left, right) => {
    const leftMs = parseEvidenceTimestampMs(left.occurredAt) ?? Number.MAX_SAFE_INTEGER;
    const rightMs = parseEvidenceTimestampMs(right.occurredAt) ?? Number.MAX_SAFE_INTEGER;
    return leftMs - rightMs;
  });

  for (const [index, event] of sortedStatusEvents.entries()) {
    const occurredAtMs = parseEvidenceTimestampMs(event.occurredAt) ?? Number.MAX_SAFE_INTEGER;
    const occurredAtLabel = formatEvidenceClockTime(event.occurredAt) ?? event.occurredAt;
    const nextStatusMs = parseEvidenceTimestampMs(sortedStatusEvents[index + 1]?.occurredAt)
      ?? (event.phase === "completed" || event.phase === "error" || event.phase === "warning"
        ? parseEvidenceTimestampMs(snapshot.updatedAt)
        : undefined);
    const duration = nextStatusMs !== undefined && Number.isFinite(occurredAtMs)
      ? formatEvidenceElapsed(Math.max(0, nextStatusMs - occurredAtMs))
      : undefined;
    const detailSuffix = event.detail?.trim()
      ? `: ${rewriteEvidenceTextPathMentions(event.detail.trim(), exportState, pathRenderOptions)}`
      : "";
    entries.push({
      occurredAtMs,
      occurredAtLabel,
      line: `- ${occurredAtLabel} · Status · ${humanizeEvidencePhase(event.phase)} · ${rewriteEvidenceTextPathMentions(event.message, exportState, pathRenderOptions)}${detailSuffix}${duration ? ` · for ${duration}` : ""}`,
      order: index
    });
  }

  for (const [index, event] of snapshot.recentTools.entries()) {
    const occurredAtMs = parseEvidenceTimestampMs(event.occurredAt) ?? Number.MAX_SAFE_INTEGER;
    const occurredAtLabel = formatEvidenceClockTime(event.occurredAt) ?? (event.occurredAt || "pending");
    const target = typeof event.input?.filePath === "string" && event.input.filePath.trim()
      ? ` · ${formatTraceablePathReference(event.input.filePath.trim(), pathRenderOptions)}`
      : "";
    const note = event.note?.trim() ? `: ${event.note.trim()}` : "";
    const duration = formatEvidenceElapsed(event.elapsedMs);
    entries.push({
      occurredAtMs,
      occurredAtLabel,
      line: `- ${occurredAtLabel} · Tool · ${humanizeToolLabel(event.toolName)} · ${humanizeToolPhase(event.phase)}${target}${note}${duration ? ` · ${duration}` : ""}`,
      order: sortedStatusEvents.length + index
    });
  }

  if (entries.length === 0) {
    return ["- No activity recorded yet."];
  }

  return entries
    .sort((left, right) => left.occurredAtMs === right.occurredAtMs ? left.order - right.order : left.occurredAtMs - right.occurredAtMs)
    .map((entry) => entry.line);
}

function buildPathRenderOptions(evidenceFilePath: string | undefined): TraceableMarkdownPathRenderOptions {
  return buildTraceableMarkdownPathRenderOptions(evidenceFilePath);
}

function renderEvidenceMarkdown(
  snapshot: TraceableSubagentDetailSnapshot,
  exportState: TraceableSubagentEvidenceFileState,
  outputMode: TraceableSubagentOutputMode,
  finalOutputMarkdown?: string,
  result?: TraceableSubagentRunResult
): string {
  const pathRenderOptions = buildPathRenderOptions(exportState.filePath);
  const evidenceState = buildTraceableEvidenceState(snapshot, exportState, result);
  const lines = [
    `# ${getEvidenceTitle(snapshot)}`,
    "",
    "## Metadata",
    "",
    `- Run Id: ${snapshot.startedAt}`,
    `- Updated At: ${snapshot.updatedAt}`,
    `- Role: ${getEvidenceRoleDisplay(snapshot)}`,
    `- Model: ${snapshot.header.modelLabel}`,
    `- Output Mode: ${outputMode}`,
    `- Export Status: ${exportState.status}`,
    `- Evidence File: ${formatTraceablePathReference(exportState.filePath, pathRenderOptions)}`,
    `- Requested By: ${exportState.requestedBy ?? "-"}`,
    "",
    "## Request Contract Summary",
    "",
    ...summarizeRequestSummary(snapshot, pathRenderOptions),
    "",
    "## Final Output",
    ""
  ];
  const selfReconciliationNote = exportState.status === "ready"
    && typeof finalOutputMarkdown === "string"
    && /_Pending final result\._|evidenceFile\.status\s*==\s*"writing"|Final Output shows:\s*_Pending final result\._/u.test(finalOutputMarkdown)
      ? [
        "> Note: this lane inspected its own evidence file while it was still being written.",
        "> The authoritative artifact state for this final export is the metadata and `Traceable State` block in this file, which are now finalized as `ready`.",
        ""
      ]
      : [];
  lines.push(...selfReconciliationNote);
  if (finalOutputMarkdown?.trim()) {
    lines.push(finalOutputMarkdown.trim());
  } else {
    lines.push("_Pending final result._");
  }
  lines.push(
    "",
    "## Traceable State",
    "",
    "```json",
    JSON.stringify(evidenceState, null, 2),
    "```",
    "",
    "## Activity Timeline",
    "",
    ...summarizeActivityTimeline(snapshot, exportState, pathRenderOptions)
  );
  return `${lines.join("\n").trimEnd()}\n`;
}

export class TraceableSubagentEvidenceController {
  private snapshot: TraceableSubagentDetailSnapshot;
  private exportState: TraceableSubagentEvidenceFileState = { status: "idle" };
  private lastResultMarkdown: string | undefined;
  private lastResult: TraceableSubagentRunResult | undefined;
  private activeRunId: string | undefined;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(initialSnapshot: TraceableSubagentDetailSnapshot) {
    this.snapshot = initialSnapshot;
  }

  updateSnapshot(snapshot: TraceableSubagentDetailSnapshot): TraceableSubagentDetailSnapshot {
    if (this.activeRunId && snapshot.startedAt !== this.activeRunId) {
      this.exportState = { status: "idle" };
      this.lastResultMarkdown = undefined;
      this.lastResult = undefined;
      this.activeRunId = undefined;
    }
    this.snapshot = snapshot;
    if (this.activeRunId === snapshot.startedAt
      && this.exportState.filePath
      && (this.exportState.status === "writing" || this.exportState.status === "ready")) {
      void this.persistCurrentEvidence();
    }
    return this.getSnapshot();
  }

  getSnapshot(): TraceableSubagentDetailSnapshot {
    return {
      ...this.snapshot,
      resultSummary: this.lastResult
        ? {
          finalSummary: this.lastResult.finalSummary,
          carryStateDisposition: this.lastResult.carryStateDisposition,
          activeCarryForward: this.lastResult.activeCarryForward,
          recoverableCarryState: this.lastResult.recoverableCarryState
        }
        : this.snapshot.resultSummary,
      evidenceFile: { ...this.exportState }
    };
  }

  async prepareRequestedExport(input: TraceableSubagentInput): Promise<TraceableSubagentEvidenceFileState | undefined> {
    const requestedOutputMode = normalizeTraceableOutputMode(input.outputMode)
      ?? (input.exportToFolder?.trim() ? "summary-with-evidence-path" : undefined);
    if (!requestedOutputMode) {
      return undefined;
    }
    const exportToFolder = input.exportToFolder?.trim();
    if (!exportToFolder) {
      throw new Error("TRACEABLE tool-triggered export requires exportToFolder. Use the Export button for interactive folder picking.");
    }
    return this.beginExport(requestedOutputMode, exportToFolder, "tool-input", input.parentTracePath?.trim());
  }

  async finalizeRequestedExport(result: TraceableSubagentRunResult, summaryMarkdown: string): Promise<TraceableSubagentRunResult> {
    this.lastResult = result;
    this.lastResultMarkdown = summaryMarkdown;
    if (this.exportState.status !== "writing" || !this.exportState.filePath) {
      return result;
    }
    const outputMode = this.exportState.outputMode ?? result.outputMode ?? "summary-with-evidence-path";
    const renamedState = await renameEvidenceFileForSnapshot(this.snapshot, this.exportState);
    this.exportState = renamedState;
    const readyState: TraceableSubagentEvidenceFileState = {
      ...renamedState,
      status: "ready",
      outputMode
    };
    const readyFilePath = readyState.filePath;
    if (!readyFilePath) {
      throw new Error("TRACEABLE evidence export lost its file path before finalizing the evidence file.");
    }
    const workspaceRoots = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
    const exportAwareResult = result.continuedFromParent && result.parentTracePath
      ? {
        ...result,
        parentTracePath: computeStoredParentTracePath(result.parentTracePath, readyFilePath, workspaceRoots),
        request: {
          ...result.request,
          parentTracePath: computeStoredParentTracePath(result.parentTracePath, readyFilePath, workspaceRoots)
        }
      }
      : result;
    const linkedSummaryMarkdown = renderTraceableSubagentMarkdown(exportAwareResult, {
      ...buildPathRenderOptions(readyFilePath),
      includeSupportArtifacts: false
    });
    const evidenceMarkdown = renderEvidenceMarkdown(this.snapshot, readyState, outputMode, linkedSummaryMarkdown, exportAwareResult);
    try {
      await this.writeEvidenceFile(readyFilePath, evidenceMarkdown);
      this.exportState = readyState;
      this.lastResult = exportAwareResult;
      this.lastResultMarkdown = linkedSummaryMarkdown;
      return {
        ...exportAwareResult,
        outputMode,
        evidenceFile: { ...readyState },
        evidenceMarkdown
      };
    } catch (error) {
      const failedState: TraceableSubagentEvidenceFileState = {
        ...readyState,
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      };
      this.exportState = failedState;
      return {
        ...result,
        outputMode,
        evidenceFile: { ...failedState }
      };
    }
  }

  async exportCurrentSnapshotViaDialog(): Promise<TraceableSubagentEvidenceFileState | undefined> {
    const state = await this.beginExport("summary-with-evidence-path", undefined, "ui-export");
    if (!state?.filePath) {
      return state;
    }
    if (this.snapshot.status.phase === "running") {
      return { ...this.exportState };
    }
    const renamedState = await renameEvidenceFileForSnapshot(this.snapshot, state);
    this.exportState = renamedState;
    const readyState: TraceableSubagentEvidenceFileState = {
      ...renamedState,
      status: "ready"
    };
    const readyFilePath = readyState.filePath;
    if (!readyFilePath) {
      throw new Error("TRACEABLE evidence export lost its file path before finishing the snapshot export.");
    }
    const renderedResultMarkdown = this.lastResult
      ? renderTraceableSubagentMarkdown(this.lastResult, {
        ...buildPathRenderOptions(readyFilePath),
        includeSupportArtifacts: false
      })
      : this.lastResultMarkdown;
    const evidenceMarkdown = renderEvidenceMarkdown(this.snapshot, readyState, state.outputMode ?? "summary-with-evidence-path", renderedResultMarkdown, this.lastResult);
    try {
      await this.writeEvidenceFile(readyFilePath, evidenceMarkdown);
      this.exportState = readyState;
      this.lastResultMarkdown = renderedResultMarkdown ?? evidenceMarkdown;
      return { ...this.exportState };
    } catch (error) {
      this.exportState = {
        ...readyState,
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      };
      throw error;
    }
  }

  private async beginExport(
    outputMode: TraceableSubagentOutputMode,
    preferredFolderPath: string | undefined,
    requestedBy: "tool-input" | "ui-export",
    parentTracePath?: string
  ): Promise<TraceableSubagentEvidenceFileState | undefined> {
    const currentRunId = this.snapshot.startedAt;
    if (this.activeRunId && this.activeRunId === currentRunId && this.exportState.filePath) {
      return { ...this.exportState };
    }
    const folderPath = preferredFolderPath || await this.pickExportFolder();
    if (!folderPath) {
      throw new Error("Traceable evidence export was cancelled before a destination folder was selected.");
    }
    await fs.mkdir(folderPath, { recursive: true });
    const allocation = parentTracePath?.trim()
      ? await allocateContinuationEvidenceFilePath(folderPath, parentTracePath.trim(), getEvidenceRoleSlug(this.snapshot))
      : await allocateEvidenceFilePath(folderPath, getEvidenceRoleSlug(this.snapshot));
    const writingState: TraceableSubagentEvidenceFileState = {
      status: this.snapshot.status.phase === "running" ? "writing" : "ready",
      filePath: allocation.filePath,
      fileName: allocation.fileName,
      requestedBy,
      outputMode
    };
    const evidenceMarkdown = renderEvidenceMarkdown(this.snapshot, writingState, outputMode, this.lastResultMarkdown, this.lastResult);
    await this.writeEvidenceFile(allocation.filePath, evidenceMarkdown);
    this.exportState = writingState;
    this.activeRunId = currentRunId;
    return { ...writingState };
  }

  private async persistCurrentEvidence(): Promise<void> {
    if (!this.exportState.filePath) {
      return;
    }
    const exportState = await renameEvidenceFileForSnapshot(this.snapshot, this.exportState);
    this.exportState = exportState;
    const expectedFilePath = exportState.filePath;
    const expectedStatus = exportState.status;
    this.writeQueue = this.writeQueue.then(async () => {
      if (!expectedFilePath
        || this.exportState.filePath !== expectedFilePath
        || this.exportState.status !== expectedStatus
        || this.exportState.status !== "writing") {
        return;
      }
      const outputMode = this.exportState.outputMode ?? "summary-with-evidence-path";
      const evidenceMarkdown = renderEvidenceMarkdown(this.snapshot, this.exportState, outputMode, this.lastResultMarkdown, this.lastResult);
      await this.writeEvidenceFile(expectedFilePath, evidenceMarkdown);
    }).catch(() => {
      // Keep the write queue usable after a failed best-effort live update.
    });
    await this.writeQueue;
  }

  private async pickExportFolder(): Promise<string | undefined> {
    const selection = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Choose TRACEABLE evidence folder"
    });
    return selection?.[0]?.fsPath;
  }

  private async writeEvidenceFile(filePath: string, content: string): Promise<void> {
    await fs.writeFile(filePath, content, "utf8");
  }
}