import * as vscode from "vscode";
import path from "node:path";
import type {
  TraceableSubagentRequestSummaryItem,
  TraceableSubagentStatusHeader,
  TraceableSubagentStatusReporter,
  TraceableSubagentToolStatusEvent
} from "./traceableSubagent";
import type {
  TraceableSubagentDetailSnapshot,
  TraceableSubagentDetailStatusState,
  TraceableSubagentStatusHistoryEvent
} from "./traceableSubagentStatusDetail";

const DEFAULT_KEEP_MS = 8000;
const MAIN_ITEM_PRIORITY = -100;
const TRAIL_ITEM_BASE_PRIORITY = -110;

function normalizeAgentDisplayName(agentName: string | undefined): string {
  const trimmed = agentName?.trim();
  if (!trimmed) {
    return "Trace lane";
  }
  const withoutParentheticals = trimmed.replace(/\s*\([^)]*\)/g, "").trim();
  return withoutParentheticals || trimmed;
}

function normalizeModelDisplayName(modelLabel: string | undefined): string {
  const trimmed = modelLabel?.trim();
  return trimmed || "model";
}

function normalizeAgentFilePath(agentFilePath: string | undefined): string {
  const trimmed = agentFilePath?.trim();
  return trimmed || "";
}

function defaultHeaderState(): Required<TraceableSubagentStatusHeader> {
  return {
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
  };
}

function dedupeHeaderToolsetNames(toolsetNames: readonly string[] | undefined): string[] {
  if (!Array.isArray(toolsetNames)) {
    return [];
  }
  const deduped: string[] = [];
  for (const value of toolsetNames) {
    const trimmed = value?.trim();
    if (!trimmed) {
      continue;
    }
    if (!deduped.includes(trimmed)) {
      deduped.push(trimmed);
    }
  }
  return deduped;
}

function summarizeHeaderFlags(header: Required<TraceableSubagentStatusHeader>): string[] {
  const flags: string[] = [];
  if (header.agentName !== "Trace lane" && !header.agentResolved) {
    flags.push("Role pending resolution");
  }
  if (header.candidate) {
    flags.push("Candidate");
  }
  if (header.experimental) {
    flags.push("Experimental");
  }
  if (header.humanRole) {
    flags.push("Human role");
  }
  return flags;
}

function humanizeToolName(toolName: string): string {
  const trimmed = toolName.trim();
  if (!trimmed) {
    return "tool";
  }
  if (trimmed === "copilot_readFile") {
    return "readFile";
  }
  if (trimmed.startsWith("copilot_")) {
    return trimmed.slice("copilot_".length);
  }
  return trimmed;
}

function iconForToolPhase(phase: TraceableSubagentToolStatusEvent["phase"]): string {
  switch (phase) {
    case "running":
      return "$(sync~spin)";
    case "success":
      return "$(check)";
    case "deferred":
      return "$(warning)";
    case "failure":
      return "$(error)";
  }
}

function summarizeToolCallLabel(event: TraceableSubagentToolStatusEvent): string {
  const filePath = typeof event.input?.filePath === "string" ? event.input.filePath.trim() : "";
  if (event.toolName === "copilot_readFile" && filePath) {
    const fileName = path.basename(filePath);
    return event.phase === "deferred" ? `defer ${fileName}` : `read ${fileName}`;
  }
  const toolName = humanizeToolName(event.toolName);
  return event.phase === "deferred" ? `defer ${toolName}` : toolName;
}

function buildToolCallTooltip(event: TraceableSubagentToolStatusEvent): string {
  const lines = [
    `Tool: ${event.toolName}`,
    `Phase: ${event.phase}`,
    `Call ID: ${event.callId}`
  ];
  const filePath = typeof event.input?.filePath === "string" ? event.input.filePath.trim() : "";
  if (filePath) {
    lines.push(`File: ${filePath}`);
  }
  const startLine = typeof event.input?.startLine === "number" ? event.input.startLine : undefined;
  const endLine = typeof event.input?.endLine === "number" ? event.input.endLine : undefined;
  if (Number.isInteger(startLine) && Number.isInteger(endLine)) {
    lines.push(`Lines: ${startLine}-${endLine}`);
  }
  if (event.note?.trim()) {
    lines.push(`Note: ${event.note.trim()}`);
  }
  return lines.join("\n");
}

interface TrailItemState {
  event: TraceableSubagentToolStatusEvent;
  item: vscode.StatusBarItem;
}

interface ObservedToolState {
  event: TraceableSubagentToolStatusEvent;
  priority: number;
}

interface StatusPresentationState {
  phase: "running" | "completed" | "warning" | "error";
  message: string;
  detail?: string;
}

function sameStatusPresentation(left: StatusPresentationState, right: StatusPresentationState): boolean {
  return left.phase === right.phase
    && left.message === right.message
    && left.detail === right.detail;
}

interface TraceableSubagentStatusBarOptions {
  openDetailView?: () => Thenable<void> | Promise<void>;
  updateDetailView?: (snapshot: TraceableSubagentDetailSnapshot) => void;
  detailCommandId?: string;
  onDidAutoHide?: () => Thenable<void> | Promise<void>;
}

function formatStatusSegments(message: string): string[] {
  const trimmed = message.trim();
  if (!trimmed) {
    return ["working"];
  }
  if (/^queued$/i.test(trimmed)) {
    return ["queued"];
  }
  const readingMatch = /^reading\s+(.+)$/i.exec(trimmed);
  if (readingMatch) {
    return ["reading", readingMatch[1].trim()];
  }
  const runningMatch = /^running\s+(.+)$/i.exec(trimmed);
  if (runningMatch) {
    return ["tool", humanizeToolName(runningMatch[1])];
  }
  switch (trimmed) {
    case "requesting analysis":
    case "continuing analysis":
    case "synthesizing":
    case "finalizing":
    case "final recovery":
      return ["reasoning", trimmed === "final recovery" ? "recovery" : trimmed.replace(/\s+analysis$/, "")];
    case "resolving role":
    case "selecting model":
    case "model ready":
    case "starting":
      return ["setup", trimmed];
    default:
      return [trimmed];
  }
}

export class TraceableSubagentStatusBarController implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly openDetailView: (() => Thenable<void> | Promise<void>) | undefined;
  private readonly updateDetailView: ((snapshot: TraceableSubagentDetailSnapshot) => void) | undefined;
  private readonly detailCommandId: string | undefined;
  private readonly onDidAutoHide: (() => Thenable<void> | Promise<void>) | undefined;
  private activeRunId = 0;
  private clearTimer: NodeJS.Timeout | undefined;
  private trailItems = new Map<string, TrailItemState>();
  private observedTools = new Map<string, ObservedToolState>();
  private nextTrailPriority = TRAIL_ITEM_BASE_PRIORITY;
  private currentStatus: StatusPresentationState = {
    phase: "running",
    message: "starting"
  };
  private currentStartedAt = new Date(0).toISOString();
  private currentHeader: Required<TraceableSubagentStatusHeader> = defaultHeaderState();
  private currentRequestSummary: TraceableSubagentRequestSummaryItem[] = [];
  private statusHistory: TraceableSubagentStatusHistoryEvent[] = [];
  private nextStatusHistoryId = 1;

  constructor(options: TraceableSubagentStatusBarOptions = {}) {
    this.openDetailView = options.openDetailView;
    this.updateDetailView = options.updateDetailView;
    this.detailCommandId = options.detailCommandId;
    this.onDidAutoHide = options.onDidAutoHide;
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, MAIN_ITEM_PRIORITY);
    this.item.name = "Traceable Subagent Status";
    this.item.tooltip = "Latest traceable subagent status";
    this.item.command = this.detailCommandId;
    this.publishDetailView();
  }

  startRun(initialHeader: TraceableSubagentStatusHeader = {}): TraceableSubagentStatusReporter {
    const runId = ++this.activeRunId;
    this.clearPendingTimer();
    this.resetToolState(false);
    this.currentStartedAt = new Date().toISOString();
    this.currentHeader = defaultHeaderState();
    this.currentRequestSummary = [];
    this.statusHistory = [];
    this.nextStatusHistoryId = 1;
    this.setHeaderState(initialHeader);
    this.showSpinner(runId, "starting");

    return {
      setRequestSummary: (summary: TraceableSubagentRequestSummaryItem[]) => {
        if (runId !== this.activeRunId) {
          return;
        }
        this.setRequestSummary(summary);
      },
      setHeader: (header: TraceableSubagentStatusHeader) => {
        if (runId !== this.activeRunId) {
          return;
        }
        this.setHeaderState(header);
      },
      update: (message: string) => {
        this.showSpinner(runId, message);
      },
      recordToolCall: (event: TraceableSubagentToolStatusEvent) => {
        if (runId !== this.activeRunId) {
          return;
        }
        this.recordToolEvent(event);
      },
      finish: (message: string, options?: { error?: boolean; warning?: boolean; keepMs?: number; detail?: string }) => {
        if (runId !== this.activeRunId) {
          return;
        }
        const icon = options?.error ? "$(error)" : options?.warning ? "$(warning)" : "$(check)";
        this.item.text = `${icon} ${this.formatStatusText(message)}`;
        const nextStatus: StatusPresentationState = {
          phase: options?.error ? "error" : options?.warning ? "warning" : "completed",
          message,
          detail: options?.detail?.trim() || undefined
        };
        this.currentStatus = nextStatus;
        this.recordStatusEvent(nextStatus);
        this.item.tooltip = this.buildMainTooltip();
        this.publishDetailView();
        this.item.show();
        this.scheduleHide(runId, options?.keepMs ?? DEFAULT_KEEP_MS);
      }
    };
  }

  dispose(): void {
    this.clearPendingTimer();
    this.resetToolState(false);
    this.item.dispose();
  }

  hideNow(): void {
    this.clearPendingTimer();
    this.item.hide();
    for (const entry of this.trailItems.values()) {
      entry.item.hide();
    }
  }

  private showSpinner(runId: number, message: string): void {
    if (runId !== this.activeRunId) {
      return;
    }
    const nextStatus: StatusPresentationState = {
      phase: "running",
      message,
      detail: undefined
    };
    this.currentStatus = nextStatus;
    this.recordStatusEvent(nextStatus);
    this.item.text = `$(sync~spin) ${this.formatStatusText(message)}`;
    this.item.tooltip = this.buildMainTooltip();
    this.publishDetailView();
    this.item.show();
  }

  private setRequestSummary(summary: TraceableSubagentRequestSummaryItem[]): void {
    this.currentRequestSummary = summary
      .filter((item) => typeof item.label === "string" && item.label.trim() && typeof item.value === "string" && item.value.trim())
      .map((item) => ({
        label: item.label.trim(),
        value: item.value.trim(),
        title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : undefined
      }));
    this.publishDetailView();
  }

  private setHeaderState(header: TraceableSubagentStatusHeader): void {
    if (header.agentName) {
      this.currentHeader.agentName = normalizeAgentDisplayName(header.agentName);
    }
    if (typeof header.agentFilePath === "string") {
      this.currentHeader.agentFilePath = normalizeAgentFilePath(header.agentFilePath);
    }
    if (typeof header.agentResolved === "boolean") {
      this.currentHeader.agentResolved = header.agentResolved;
    }
    if (header.modelLabel) {
      this.currentHeader.modelLabel = normalizeModelDisplayName(header.modelLabel);
    }
    if (typeof header.candidate === "boolean") {
      this.currentHeader.candidate = header.candidate;
    }
    if (typeof header.experimental === "boolean") {
      this.currentHeader.experimental = header.experimental;
    }
    if (typeof header.humanRole === "boolean") {
      this.currentHeader.humanRole = header.humanRole;
    }
    if (Array.isArray(header.toolsetNames)) {
      this.currentHeader.toolsetNames = dedupeHeaderToolsetNames(header.toolsetNames);
    }
    if (Array.isArray(header.selectedToolNames)) {
      this.currentHeader.selectedToolNames = dedupeHeaderToolsetNames(header.selectedToolNames);
    }
    if (typeof header.toolSelectionRestricted === "boolean") {
      this.currentHeader.toolSelectionRestricted = header.toolSelectionRestricted;
    }
    this.item.tooltip = this.buildMainTooltip();
    this.publishDetailView();
  }

  private formatStatusText(message: string): string {
    const segments = [
      this.currentHeader.agentName,
      this.currentHeader.modelLabel,
      ...formatStatusSegments(message)
    ].filter((segment) => typeof segment === "string" && segment.trim().length > 0);
    return segments.join(": ");
  }

  private recordToolEvent(event: TraceableSubagentToolStatusEvent): void {
    const existing = this.trailItems.get(event.callId);
    const existingObserved = this.observedTools.get(event.callId);
    const normalizedEvent: TraceableSubagentToolStatusEvent = {
      ...event,
      occurredAt: event.occurredAt?.trim() || existing?.event.occurredAt || existingObserved?.event.occurredAt || new Date().toISOString()
    };
    const priority = existingObserved?.priority ?? this.nextTrailPriority++;
    existing?.item.hide();
    existing?.item.dispose();
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, priority);
    item.name = "Traceable Subagent Tool Call";
    item.text = `${iconForToolPhase(normalizedEvent.phase)} ${summarizeToolCallLabel(normalizedEvent)}`;
    item.tooltip = buildToolCallTooltip(normalizedEvent);
    item.command = this.detailCommandId;
    item.show();
    this.trailItems.set(normalizedEvent.callId, { event: normalizedEvent, item });
    this.observedTools.set(normalizedEvent.callId, { event: normalizedEvent, priority });
    this.item.tooltip = this.buildMainTooltip();
    this.publishDetailView();
  }

  private recordStatusEvent(status: StatusPresentationState): void {
    const previous = this.statusHistory.at(-1);
    if (previous && previous.phase === status.phase && previous.message === status.message && previous.detail === status.detail) {
      return;
    }
    this.statusHistory.push({
      id: `status-${this.nextStatusHistoryId++}`,
      phase: status.phase,
      message: status.message,
      detail: status.detail,
      occurredAt: new Date().toISOString()
    });
  }

  private resetToolState(publish = true): void {
    for (const entry of this.trailItems.values()) {
      entry.item.hide();
      entry.item.dispose();
    }
    this.trailItems.clear();
    this.observedTools.clear();
    this.nextTrailPriority = TRAIL_ITEM_BASE_PRIORITY;
    if (publish) {
      this.publishDetailView();
    }
  }

  private getObservedToolEvents(): TraceableSubagentToolStatusEvent[] {
    return [...this.observedTools.values()]
      .sort((left, right) => right.priority - left.priority)
      .map(({ event }) => event);
  }

  private scheduleHide(runId: number, keepMs: number): void {
    this.clearPendingTimer();
    this.clearTimer = setTimeout(() => {
      if (runId !== this.activeRunId) {
        return;
      }
      this.hideNow();
      void this.onDidAutoHide?.();
    }, keepMs);
  }

  private clearPendingTimer(): void {
    if (!this.clearTimer) {
      return;
    }
    clearTimeout(this.clearTimer);
    this.clearTimer = undefined;
  }

  private buildMainTooltip(): string {
    const lines = [
      `${this.currentHeader.agentName}: ${this.currentHeader.modelLabel}`,
      `Status: ${this.currentStatus.message}`
    ];
    if (this.currentHeader.agentName !== "Trace lane") {
      lines.push(`Role resolution: ${this.currentHeader.agentResolved ? "resolved" : "requested only"}`);
    }
    const headerFlags = summarizeHeaderFlags(this.currentHeader);
    if (headerFlags.length > 0) {
      lines.push(`Flags: ${headerFlags.join(", ")}`);
    }
    if (this.currentHeader.toolsetNames.length > 0) {
      lines.push(`Toolset: ${this.currentHeader.toolsetNames.join(", ")}`);
    }
    if (this.currentStatus.detail) {
      lines.push(`Detail: ${this.currentStatus.detail}`);
    }
    const recentEvents = this.getObservedToolEvents()
      .slice(0, 3)
      .map((event) => `${iconForToolPhase(event.phase)} ${summarizeToolCallLabel(event)}`);
    if (recentEvents.length > 0) {
      lines.push("Recent tools:");
      lines.push(...recentEvents.map((entry) => `- ${entry}`));
    }
    return lines.join("\n");
  }

  private publishDetailView(): void {
    this.updateDetailView?.({
      header: { ...this.currentHeader },
      status: this.toDetailStatus(this.currentStatus),
      requestSummary: [...this.currentRequestSummary],
      statusHistory: [...this.statusHistory],
      recentTools: this.getObservedToolEvents(),
      startedAt: this.currentStartedAt,
      updatedAt: new Date().toISOString()
    });
  }

  private toDetailStatus(status: StatusPresentationState): TraceableSubagentDetailStatusState {
    return {
      phase: status.phase,
      message: status.message,
      detail: status.detail
    };
  }
}