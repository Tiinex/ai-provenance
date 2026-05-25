import * as vscode from "vscode";
import path from "node:path";
import type {
  TraceableCarryForwardState,
  TraceableCarryStateDisposition,
  TraceableSenderAdaptationState,
  TraceableSubagentEvidenceFileState,
  TraceableSubagentRequestSummaryItem,
  TraceableSubagentStatusHeader,
  TraceableSubagentTimingSummary,
  TraceableSubagentToolStatusEvent
} from "./traceableContract";
import { normalizeToolReferenceKey } from "./toolNameNormalization";

const TRACEABLE_STATUS_DETAIL_SCHEME = "tiinex-traceable-subagent-status";
const TRACEABLE_STATUS_DETAIL_PATH = "/live.md";

type DetailPhase = "idle" | "running" | "completed" | "warning" | "error";

export interface TraceableSubagentDetailStatusState {
  phase: DetailPhase;
  message: string;
  detail?: string;
}

export interface TraceableSubagentStatusHistoryEvent {
  id: string;
  phase: DetailPhase;
  message: string;
  detail?: string;
  occurredAt: string;
}

export interface TraceableSubagentDetailSnapshot {
  header: Required<TraceableSubagentStatusHeader>;
  status: TraceableSubagentDetailStatusState;
  evidenceFile?: TraceableSubagentEvidenceFileState;
  lineageEntries?: Array<{
    filePath: string;
    title: string;
    occurredAt: string;
    startedAt?: string;
    updatedAt?: string;
    finalSummary?: string;
    completionClaim?: string;
    status?: {
      phase: DetailPhase;
      message: string;
      detail?: string;
    };
    header?: Required<TraceableSubagentStatusHeader>;
    evidenceFile?: TraceableSubagentEvidenceFileState;
    requestSummary?: TraceableSubagentRequestSummaryItem[];
    statusHistory?: TraceableSubagentStatusHistoryEvent[];
    recentTools?: TraceableSubagentToolStatusEvent[];
    timingSummary?: TraceableSubagentTimingSummary;
    resultSummary?: {
      finalSummary?: string;
      senderAdaptationState?: TraceableSenderAdaptationState;
      carryStateDisposition?: TraceableCarryStateDisposition;
      activeCarryForward?: TraceableCarryForwardState;
      recoverableCarryState?: TraceableCarryForwardState;
    };
  }>;
  resultSummary?: {
    finalSummary?: string;
    senderAdaptationState?: TraceableSenderAdaptationState;
    carryStateDisposition?: TraceableCarryStateDisposition;
    activeCarryForward?: TraceableCarryForwardState;
    recoverableCarryState?: TraceableCarryForwardState;
  };
  requestSummary: TraceableSubagentRequestSummaryItem[];
  statusHistory: TraceableSubagentStatusHistoryEvent[];
  recentTools: TraceableSubagentToolStatusEvent[];
  timingSummary?: TraceableSubagentTimingSummary;
  startedAt: string;
  updatedAt: string;
}

function normalizeHeaderToolsetNames(toolsetNames: readonly string[]): string[] {
  const normalized: string[] = [];
  for (const value of toolsetNames) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const normalizedValue = normalizeToolReferenceKey(trimmed);
    if (!normalized.includes(normalizedValue)) {
      normalized.push(normalizedValue);
    }
  }
  return normalized;
}

function buildHeaderMetadataSegments(header: Required<TraceableSubagentStatusHeader>): string[] {
  const segments = [header.agentName, header.modelLabel];
  if (header.agentName !== "Trace lane" && !header.agentResolved) {
    segments.push("role-pending");
  }
  if (header.candidate) {
    segments.push("candidate");
  }
  if (header.experimental) {
    segments.push("experimental");
  }
  if (header.humanRole) {
    segments.push("human-role");
  }
  return segments;
}

function summarizeHeaderToolset(header: Required<TraceableSubagentStatusHeader>): string | undefined {
  const normalizedToolset = normalizeHeaderToolsetNames(header.toolsetNames);
  return normalizedToolset.length > 0 ? normalizedToolset.join(", ") : undefined;
}

function phaseIcon(phase: DetailPhase | TraceableSubagentToolStatusEvent["phase"]): string {
  switch (phase) {
    case "running":
      return "$(sync~spin)";
    case "completed":
    case "success":
      return "$(check)";
    case "warning":
    case "deferred":
      return "$(warning)";
    case "error":
    case "failure":
      return "$(error)";
    case "idle":
      return "$(circle-large-outline)";
  }
}

function phaseGlyph(phase: DetailPhase | TraceableSubagentToolStatusEvent["phase"]): string {
  switch (phase) {
    case "running":
      return "↻";
    case "completed":
    case "success":
      return "✓";
    case "warning":
    case "deferred":
      return "⚠";
    case "error":
    case "failure":
      return "✕";
    case "idle":
      return "○";
  }
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}\[\]()#+!|]/g, "\\$&");
}

function parseTraceableSnapshotTimestampMs(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toMarkdownFileTarget(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const prefixed = /^[A-Za-z]:\//.test(normalized) ? `/${normalized}` : normalized;
  return `file://${encodeURI(prefixed)}`;
}

function summarizeToolLabel(event: TraceableSubagentToolStatusEvent): string {
  const filePath = typeof event.input?.filePath === "string" ? event.input.filePath.trim() : "";
  if (event.toolName === "copilot_readFile" && filePath) {
    const normalized = filePath.replace(/\\/g, "/");
    const fileName = normalized.slice(normalized.lastIndexOf("/") + 1);
    return event.phase === "deferred" ? `defer ${fileName}` : `read ${fileName}`;
  }
  const normalizedName = event.toolName.startsWith("copilot_") ? event.toolName.slice("copilot_".length) : event.toolName;
  return event.phase === "deferred" ? `defer ${normalizedName}` : normalizedName;
}

function summarizeDetailLine(event: TraceableSubagentToolStatusEvent): string {
  const details = [event.toolName];
  const startLine = typeof event.input?.startLine === "number" ? event.input.startLine : undefined;
  const endLine = typeof event.input?.endLine === "number" ? event.input.endLine : undefined;
  if (Number.isInteger(startLine) && Number.isInteger(endLine)) {
    details.push(`lines ${startLine}-${endLine}`);
  }
  return details.join(" · ");
}

function renderToolBlock(event: TraceableSubagentToolStatusEvent): string[] {
  const details = [escapeMarkdown(summarizeDetailLine(event))];
  const filePath = typeof event.input?.filePath === "string" ? event.input.filePath.trim() : "";
  if (filePath) {
    const fileName = path.basename(filePath);
    const fileUri = toMarkdownFileTarget(filePath);
    details.push(`[${escapeMarkdown(fileName)}](${fileUri})`);
  }
  const lines = [`${phaseGlyph(event.phase)} ${escapeMarkdown(summarizeToolLabel(event))} · ${details.join(" · ")}`];
  if (event.note?.trim()) {
    lines.push(`  ${escapeMarkdown(event.note.trim())}`);
  }
  return lines;
}

export function renderTraceableSubagentDetailMarkdown(snapshot: TraceableSubagentDetailSnapshot): string {
  const toolLines = snapshot.recentTools.length === 0
    ? ["○ No tool calls recorded in the current trace lane yet."]
    : snapshot.recentTools.slice().reverse().flatMap((event) => [...renderToolBlock(event), ""]);
  const toolsetSummary = summarizeHeaderToolset(snapshot.header);
  const lines = [
    `${phaseGlyph(snapshot.status.phase)} Traceable Subagent Status`,
    "",
    `${buildHeaderMetadataSegments(snapshot.header).map((value) => escapeMarkdown(value)).join(" · ")} · ${escapeMarkdown(snapshot.status.message)}`,
    `Updated ${escapeMarkdown(snapshot.updatedAt)}`
  ];
  if (toolsetSummary) {
    lines.push(`Toolset: ${escapeMarkdown(toolsetSummary)}`);
  }
  if ((snapshot.header.routingNote ?? "").trim()) {
    lines.push(`Routing: ${escapeMarkdown((snapshot.header.routingNote ?? "").trim())}`);
  }
  if (snapshot.evidenceFile && snapshot.evidenceFile.status !== "idle") {
    lines.push(`Evidence: ${escapeMarkdown(snapshot.evidenceFile.status)}`);
    if (snapshot.evidenceFile.filePath) {
      lines.push(`Evidence file: ${escapeMarkdown(snapshot.evidenceFile.filePath)}`);
    }
    if (snapshot.evidenceFile.error) {
      lines.push(`Evidence error: ${escapeMarkdown(snapshot.evidenceFile.error)}`);
    }
  }
  if (snapshot.status.detail) {
    lines.push("", escapeMarkdown(snapshot.status.detail));
  }
  lines.push("", "---", "", ...toolLines);
  return `${lines.join("\n").trimEnd()}\n`;
}

export class TraceableSubagentStatusDetailController implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  private snapshot: TraceableSubagentDetailSnapshot = {
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
    status: {
      phase: "idle",
      message: "idle"
    },
    evidenceFile: { status: "idle" },
    resultSummary: undefined,
    requestSummary: [],
    statusHistory: [],
    recentTools: [],
    startedAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };

  readonly onDidChange = this.onDidChangeEmitter.event;
  readonly uri = vscode.Uri.from({ scheme: TRACEABLE_STATUS_DETAIL_SCHEME, path: TRACEABLE_STATUS_DETAIL_PATH });

  provideTextDocumentContent(uri: vscode.Uri): string {
    if (uri.toString() !== this.uri.toString()) {
      return "# Traceable Subagent Status\n\n- Unknown detail document target.\n";
    }
    return renderTraceableSubagentDetailMarkdown(this.snapshot);
  }

  update(snapshot: TraceableSubagentDetailSnapshot): void {
    if (snapshot.startedAt === this.snapshot.startedAt) {
      const nextUpdatedAtMs = parseTraceableSnapshotTimestampMs(snapshot.updatedAt);
      const currentUpdatedAtMs = parseTraceableSnapshotTimestampMs(this.snapshot.updatedAt);
      if (nextUpdatedAtMs !== undefined && currentUpdatedAtMs !== undefined && nextUpdatedAtMs < currentUpdatedAtMs) {
        return;
      }
    }
    this.snapshot = snapshot;
    this.onDidChangeEmitter.fire(this.uri);
  }

  async exportToDocument(): Promise<void> {
    const document = await vscode.workspace.openTextDocument({
      language: "markdown",
      content: renderTraceableSubagentDetailMarkdown(this.snapshot)
    });
    await vscode.window.showTextDocument(document, {
      preview: false,
      preserveFocus: false
    });
  }

  async open(): Promise<void> {
    try {
      await vscode.commands.executeCommand("markdown.showPreview", this.uri);
      return;
    } catch {
      const document = await vscode.workspace.openTextDocument(this.uri);
      await vscode.window.showTextDocument(document, {
        preview: true,
        preserveFocus: false
      });
    }
  }

  dispose(): void {
    this.onDidChangeEmitter.dispose();
  }
}