import * as vscode from "vscode";
import path from "node:path";
import type { TraceableSubagentDetailSnapshot } from "./traceableSubagentStatusDetail";
import { buildTraceableMarkdownPathRenderOptions, resolveTraceablePathTarget, type TraceableResolvedPathTarget } from "./traceableContract";
import { expandToolReferenceKeys, normalizeToolReferenceKey } from "./toolNameNormalization";
import type { TraceableSubagentToolDetail } from "./traceableSubagent";

export const TRACEABLE_SUBAGENT_PANEL_CONTAINER_ID = "tiinexAiProvenanceTraceablePanel";
export const TRACEABLE_SUBAGENT_PANEL_VIEW_ID = "tiinex.aiProvenance.traceableStatus";
const TRACEABLE_PANEL_CODICON_PATH = ["node_modules", "@vscode", "codicons", "dist", "codicon.css"] as const;

interface PanelChatSenderRoleOption {
  label: string;
  value: string;
}

function stripPanelChatSenderTrackSuffix(value: string): string {
  return value.replace(/\s*\((?:candidate|experimental)\)\s*$/iu, "").trim();
}

function getPanelChatSenderTrackRank(option: PanelChatSenderRoleOption): number {
  const displayValue = `${option.label} ${option.value}`.trim();
  if (/\(experimental\)\s*$/iu.test(displayValue)) {
    return 2;
  }
  if (/\(candidate\)\s*$/iu.test(displayValue)) {
    return 1;
  }
  return 0;
}

function comparePanelChatSenderRoleOptions(left: PanelChatSenderRoleOption, right: PanelChatSenderRoleOption): number {
  const leftLabel = stripPanelChatSenderTrackSuffix(left.label.replace(/(?:\s*\([^)]*\))+\s*$/u, "").trim() || left.label.trim());
  const rightLabel = stripPanelChatSenderTrackSuffix(right.label.replace(/(?:\s*\([^)]*\))+\s*$/u, "").trim() || right.label.trim());
  const labelComparison = leftLabel.localeCompare(rightLabel, undefined, { sensitivity: "base" });
  if (labelComparison !== 0) {
    return labelComparison;
  }
  const trackComparison = getPanelChatSenderTrackRank(left) - getPanelChatSenderTrackRank(right);
  if (trackComparison !== 0) {
    return trackComparison;
  }
  return (left.value || left.label).localeCompare((right.value || right.label), undefined, { sensitivity: "base" });
}

type PanelEventKind = "Read" | "Search" | "Tool";
type PanelEventOutcome = "running" | "success" | "deferred" | "failure";
type PanelToolEvent = TraceableSubagentDetailSnapshot["recentTools"][number];
type PanelStatusEvent = TraceableSubagentDetailSnapshot["statusHistory"][number];
type PanelRequestSummaryItem = TraceableSubagentDetailSnapshot["requestSummary"][number];

interface PanelDisplayEvent {
  event: PanelToolEvent;
  kind: PanelEventKind;
  outcome: PanelEventOutcome;
  count: number;
  occurredAt?: string;
  baseElapsedMs: number;
  running: boolean;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  ranges: Array<{ startLine: number; endLine: number }>;
  note?: string;
}

type PanelLoadedToolDetail = TraceableSubagentToolDetail;

type PanelActivityEntry =
  | {
    kind: "lineage-warning";
    id: string;
    occurredAt: string;
    title: string;
    note: string;
    detail?: string;
  }
  | {
    kind: "ancestor";
    id: string;
    occurredAt: string;
    title: string;
    filePath: string;
    startedAt?: string;
    updatedAt?: string;
    environment?: TraceableSubagentDetailSnapshot["environment"];
    finalSummary?: string;
    completionClaim?: string;
    status?: TraceableSubagentDetailSnapshot["status"];
    header?: TraceableSubagentDetailSnapshot["header"];
    evidenceFile?: TraceableSubagentDetailSnapshot["evidenceFile"];
    requestSummary?: TraceableSubagentDetailSnapshot["requestSummary"];
    statusHistory?: TraceableSubagentDetailSnapshot["statusHistory"];
    recentTools?: TraceableSubagentDetailSnapshot["recentTools"];
    timingSummary?: TraceableSubagentDetailSnapshot["timingSummary"];
    resultSummary?: TraceableSubagentDetailSnapshot["resultSummary"];
  }
  | {
    kind: "request";
    id: string;
    occurredAt: string;
    requestSummary: PanelRequestSummaryItem[];
    snapshot: TraceableSubagentDetailSnapshot;
  }
  | {
    kind: "status";
    id: string;
    occurredAt: string;
    phase: PanelStatusEvent["phase"];
    message: string;
    detail?: string;
    baseElapsedMs: number;
    running: boolean;
    durationLabel?: string;
    durationTitle?: string;
  }
  | {
    kind: "output";
    id: string;
    occurredAt: string;
    text: string;
  }
  | {
    kind: "handoff";
    id: string;
    occurredAt: string;
    summary: string;
    note: string;
    detail?: string;
    disposition: "none" | "active" | "recoverable" | "consumed" | "expired";
    goalCount: number;
    questionCount: number;
    hasNextStart: boolean;
    nextSuggestedStart?: string;
    remainingGoals?: string[];
    openQuestions?: string[];
    constraints?: string[];
    relevantFileAnchors?: string[];
    relevantArtifactAnchors?: string[];
  }
  | {
    kind: "sender-adaptation";
    id: string;
    occurredAt: string;
    summary: string;
    note: string;
    detail?: string;
    senderCount: number;
    claimCount: number;
    reinforcedCount: number;
  }
  | {
    kind: "tool";
    id: string;
    occurredAt: string;
    displayEvent: PanelDisplayEvent;
  };

type PanelRenderedEntry =
  | PanelActivityEntry
  | {
    kind: "status-group";
    id: string;
    occurredAt: string;
    entries: Array<Extract<PanelActivityEntry, { kind: "status" }>>;
    latestToolActionLabel?: string;
    latestToolTitle?: string;
    latestToolEvent?: PanelDisplayEvent;
    groupedToolEntry?: Extract<PanelActivityEntry, { kind: "tool" }>;
  };

interface ToolsetListItem {
  rawName: string;
  displayName: string;
  iconName: string;
  matchKeys: string[];
}

interface ToolsetNamespaceGroup {
  namespace: string;
  childGroups: ToolsetNamespaceGroup[];
  items: ToolsetListItem[];
}

type ToolRuntimeStatus = "idle" | "inactive" | "running" | "success" | "warning" | "failure";

interface ToolRuntimeSummary {
  status: ToolRuntimeStatus;
  callCount: number;
  successCount: number;
  deferredCount: number;
  failureCount: number;
  totalElapsedMs: number;
}

type PanelOpenFilePayload = {
  type: "openFile";
  startLine?: number;
  endLine?: number;
} & (
  | {
    filePath: string;
    baseDir?: string;
    target?: never;
  }
  | {
    target: TraceableResolvedPathTarget;
    filePath?: never;
    baseDir?: never;
  }
);

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

function mergeMinLine(left: number | undefined, right: number | undefined): number | undefined {
  if (!Number.isInteger(left)) {
    return Number.isInteger(right) ? right : undefined;
  }
  if (!Number.isInteger(right)) {
    return left;
  }
  const safeLeft = left as number;
  const safeRight = right as number;
  return Math.min(safeLeft, safeRight);
}

function mergeMaxLine(left: number | undefined, right: number | undefined): number | undefined {
  if (!Number.isInteger(left)) {
    return Number.isInteger(right) ? right : undefined;
  }
  if (!Number.isInteger(right)) {
    return left;
  }
  const safeLeft = left as number;
  const safeRight = right as number;
  return Math.max(safeLeft, safeRight);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseTraceablePanelSnapshotTimestampMs(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatPanelUpdatedAt(updatedAt: string): string {
  const parsed = new Date(updatedAt);
  if (Number.isNaN(parsed.getTime())) {
    return updatedAt;
  }
  return formatPanelTimestampForDisplay(parsed, { includeSeconds: true });
}

function formatPanelElapsedClock(startedAt: string, updatedAt: string): string | undefined {
  const startedAtMs = new Date(startedAt).getTime();
  const updatedAtMs = new Date(updatedAt).getTime();
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(updatedAtMs)) {
    return undefined;
  }
  const elapsedSeconds = Math.max(0, Math.floor((updatedAtMs - startedAtMs) / 1000));
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  if (minutes <= 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function parsePanelTimestampMs(value: string | undefined): number | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatPanelIsoLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isSamePanelLocalDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function formatPanelTimestampForDisplay(
  value: Date,
  options?: { includeSeconds?: boolean; referenceNow?: Date }
): string {
  const referenceNow = options?.referenceNow ?? new Date();
  const timeLabel = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    ...(options?.includeSeconds ? { second: "2-digit" } : {}),
    hour12: false,
    hourCycle: "h23"
  }).format(value);
  if (isSamePanelLocalDay(value, referenceNow)) {
    return timeLabel;
  }
  return `${formatPanelIsoLocalDate(value)} ${timeLabel}`;
}

function formatPanelAbsoluteTimestamp(value: string | undefined, includeSeconds = true): string | undefined {
  const parsed = parsePanelTimestampMs(value);
  if (parsed === undefined) {
    return undefined;
  }
  return `${formatPanelIsoLocalDate(new Date(parsed))} ${new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" } : {}),
    hour12: false,
    hourCycle: "h23"
  }).format(new Date(parsed))}`;
}

function formatPanelClockTime(value: string | undefined): string | undefined {
  const parsed = parsePanelTimestampMs(value);
  if (parsed === undefined) {
    return undefined;
  }
  return formatPanelTimestampForDisplay(new Date(parsed), { includeSeconds: true });
}

function formatPanelMinuteClockTime(value: string | undefined): string | undefined {
  const parsed = parsePanelTimestampMs(value);
  if (parsed === undefined) {
    return undefined;
  }
  return formatPanelTimestampForDisplay(new Date(parsed));
}

function formatChatHeaderTimestamp(occurredAt: string | undefined, running: boolean, updatedAt?: string): string | undefined {
  if (!running) {
    return formatPanelClockTime(updatedAt || occurredAt);
  }
  const occurredAtMs = parsePanelTimestampMs(occurredAt);
  const referenceAtMs = parsePanelTimestampMs(updatedAt) ?? Date.now();
  if (!Number.isFinite(occurredAtMs) || !Number.isFinite(referenceAtMs)) {
    return undefined;
  }
  const elapsedSeconds = Math.max(0, Math.floor(((referenceAtMs as number) - (occurredAtMs as number)) / 1000));
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s`;
  }
  return `${Math.floor(elapsedSeconds / 60)}m`;
}

function panelStatusIcon(phase: TraceableSubagentDetailSnapshot["status"]["phase"]): string {
  switch (phase) {
    case "running":
      return "↻";
    case "completed":
      return "✓";
    case "warning":
      return "⚠";
    case "error":
      return "✕";
    case "idle":
      return "○";
  }
}

function panelStatusRowIcon(
  phase: TraceableSubagentDetailSnapshot["status"]["phase"],
  running: boolean
): string {
  if (phase === "running" && !running) {
    return "✓";
  }
  return panelStatusIcon(phase);
}

function detectEventKind(event: PanelToolEvent): PanelEventKind {
  switch (normalizeToolBadgeKey(event.toolName)) {
    case "read_file":
      return "Read";
    case "find_text_in_files":
    case "text_search":
    case "find_files":
    case "file_search":
    case "semantic_search":
    case "vscode_list_code_usages":
      return "Search";
    default:
      return "Tool";
  }
}

function detectEventOutcome(event: PanelToolEvent): PanelEventOutcome {
  if (event.phase === "deferred") {
    return "deferred";
  }
  if (event.phase === "failure") {
    return "failure";
  }
  if (event.phase === "running") {
    return "running";
  }
  return "success";
}

function runningEventIcon(kind: PanelEventKind): string {
  switch (kind) {
    case "Search":
      return "⌕";
    case "Read":
    case "Tool":
      return "•";
  }
}

function eventIcon(event: PanelDisplayEvent): string {
  switch (event.outcome) {
    case "success":
      return "✓";
    case "deferred":
      return "⚠";
    case "failure":
      return "✕";
    case "running":
      return runningEventIcon(event.kind);
  }
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

function formatToolActionLabel(displayEvent: PanelDisplayEvent): string {
  return `running ${humanizeToolName(displayEvent.event.toolName)}`;
}

function formatToolActionTitle(displayEvent: PanelDisplayEvent): string {
  const lines = [formatToolActionLabel(displayEvent)];
  const note = displayEvent.note?.trim();
  if (note) {
    lines.push(note);
  }
  return lines.join("\n");
}

function renderStatusGroupActionIcon(displayEvent: PanelDisplayEvent | undefined): string {
  if (!displayEvent) {
    return "";
  }
  const statusClass = `event-status-group-action-${displayEvent.outcome}`;
  return `<span class="event-icon event-status-group-action-icon ${statusClass}" style="color: ${statusGroupIconColorForOutcome(displayEvent.outcome)};" aria-hidden="true">${escapeHtml(eventIcon(displayEvent))}</span>`;
}

function ancestorSummaryIconColor(kind: "handoff" | "output" | "request" | "status"): string {
  switch (kind) {
    case "handoff":
      return "color-mix(in srgb, var(--accent-soft) 82%, var(--fg))";
    case "output":
      return "var(--vscode-terminal-ansiGreen)";
    case "request":
      return "color-mix(in srgb, var(--accent) 78%, var(--fg))";
    case "status":
      return "color-mix(in srgb, var(--accent) 74%, var(--muted))";
  }
}

function renderAncestorSummaryActionIcon(kind: "handoff" | "output" | "request" | "status"): string {
  if (kind === "request") {
    return `<span class="event-icon event-ancestor-action-icon" style="color: ${ancestorSummaryIconColor(kind)};" aria-hidden="true">${renderCodicon("mail")}</span>`;
  }
  const symbol = kind === "handoff" ? "↪" : kind === "output" ? "↩" : "↥";
  return `<span class="event-icon event-ancestor-action-icon" style="color: ${ancestorSummaryIconColor(kind)};" aria-hidden="true">${escapeHtml(symbol)}</span>`;
}

function renderAncestorStatusChip(entry: Extract<PanelActivityEntry, { kind: "ancestor" }>): string[] {
  const statusMessage = entry.status?.message?.trim();
  if (statusMessage) {
    const phaseClass = entry.status?.phase === "error"
      ? "failure"
      : (entry.status?.phase ?? "completed");
    return [`<span class="chip chip-status-phase chip-status-phase-${escapeHtml(phaseClass)}" title="Earlier trace status">${escapeHtml(statusMessage)}</span>`];
  }
  const completionClaim = entry.completionClaim?.trim();
  return completionClaim
    ? [`<span class="chip chip-status-phase" title="Earlier trace completion claim">${escapeHtml(completionClaim)}</span>`]
    : [];
}

function statusGroupIconColorForOutcome(outcome: PanelEventOutcome): string {
  switch (outcome) {
    case "running":
      return "var(--vscode-progressBar-background)";
    case "success":
      return "var(--vscode-terminal-ansiGreen)";
    case "deferred":
      return "var(--vscode-editorWarning-foreground)";
    case "failure":
      return "var(--vscode-errorForeground)";
  }
}

function statusGroupIconColorForStatus(phase: PanelStatusEvent["phase"], running: boolean): string {
  if (phase === "running") {
    return running ? "var(--vscode-progressBar-background)" : "var(--vscode-terminal-ansiGreen)";
  }
  if (phase === "completed") {
    return "var(--vscode-terminal-ansiGreen)";
  }
  if (phase === "warning") {
    return "var(--vscode-editorWarning-foreground)";
  }
  if (phase === "error") {
    return "var(--vscode-errorForeground)";
  }
  return "color-mix(in srgb, var(--accent) 74%, var(--muted))";
}

function deriveStatusGroupSummaryEvent(entry: Extract<PanelRenderedEntry, { kind: "status-group" }>):
  | { kind: "tool"; displayEvent: PanelDisplayEvent; label: string; note: string; title: string; severityClass: string; phaseClass: string }
  | { kind: "status"; entry: Extract<PanelActivityEntry, { kind: "status" }>; label: string; note: string; title: string; severityClass: string; phaseClass: string } {
  if (entry.groupedToolEntry) {
    const displayEvent = entry.groupedToolEntry.displayEvent;
    return {
      kind: "tool",
      displayEvent,
      label: formatToolActionLabel(displayEvent),
      note: displayEvent.note?.trim() || "",
      title: formatToolActionTitle(displayEvent),
      severityClass: `status-group-severity-${displayEvent.outcome}`,
      phaseClass: `event-status-group-phase-${displayEvent.outcome}`
    };
  }

  const latestNonCompleted = [...entry.entries].reverse().find((child) => child.phase !== "completed");
  const summaryEntry = latestNonCompleted ?? entry.entries[entry.entries.length - 1];
  const note = summaryEntry.detail || deriveStatusTransparencyNote(summaryEntry) || "";
  const title = [summaryEntry.message, note].filter(Boolean).join("\n");
  return {
    kind: "status",
    entry: summaryEntry,
    label: summaryEntry.message,
    note,
    title,
    severityClass: `status-group-severity-${summaryEntry.phase}`,
    phaseClass: `event-status-group-phase-${summaryEntry.phase}`
  };
}

function normalizeToolBadgeKey(toolName: string): string {
  const trimmed = toolName.trim();
  if (!trimmed) {
    return "";
  }
  const withoutCopilotPrefix = trimmed.startsWith("copilot_") ? trimmed.slice("copilot_".length) : trimmed;
  return withoutCopilotPrefix
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

function renderCodicon(iconName: string, extraClasses?: string): string {
  const classes = ["codicon", `codicon-${iconName}`, extraClasses].filter(Boolean).join(" ");
  return `<span class="${classes}" aria-hidden="true"></span>`;
}

function toolBadgeIcon(toolName: string): string | undefined {
  switch (normalizeToolBadgeKey(toolName)) {
    case "read_file":
      return "go-to-file";
    case "find_text_in_files":
    case "text_search":
      return "search";
    case "find_files":
    case "file_search":
      return "files";
    case "list_directory":
      return "folder-opened";
    case "run_in_terminal":
    case "run_in_terminal_command":
      return "terminal";
    case "run_traceable_subagent":
    case "run_subagent":
      return "hubot";
    default:
      return undefined;
  }
}

function toolRuntimeSeverity(status: ToolRuntimeStatus): number {
  switch (status) {
    case "failure":
      return 5;
    case "warning":
      return 4;
    case "running":
      return 3;
    case "success":
      return 2;
    case "idle":
      return 1;
    case "inactive":
      return 0;
  }
}

function formatToolElapsedMs(elapsedMs: number): string {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return "0ms";
  }
  if (elapsedMs < 1000) {
    return `${Math.round(elapsedMs)}ms`;
  }
  if (elapsedMs < 10_000) {
    return `${(elapsedMs / 1000).toFixed(1)}s`;
  }
  return `${Math.round(elapsedMs / 1000)}s`;
}

function activeToolElapsedMs(snapshot: TraceableSubagentDetailSnapshot, referenceAt: string): number {
  const referenceAtMs = parsePanelTimestampMs(referenceAt);
  if (referenceAtMs === undefined) {
    return 0;
  }
  let totalElapsedMs = 0;
  for (const event of snapshot.recentTools) {
    if (event.phase !== "running") {
      continue;
    }
    const startedAtMs = parsePanelTimestampMs(event.occurredAt);
    if (startedAtMs === undefined) {
      continue;
    }
    totalElapsedMs += Math.max(0, referenceAtMs - startedAtMs);
  }
  return totalElapsedMs;
}

function totalToolElapsedMs(snapshot: TraceableSubagentDetailSnapshot, referenceAt = snapshot.updatedAt): number {
  let totalElapsedMs = 0;
  for (const event of snapshot.recentTools) {
    if (event.phase === "running") {
      continue;
    }
    if (typeof event.elapsedMs === "number" && Number.isFinite(event.elapsedMs) && event.elapsedMs > 0) {
      totalElapsedMs += event.elapsedMs;
    }
  }
  totalElapsedMs += activeToolElapsedMs(snapshot, referenceAt);
  return totalElapsedMs;
}

function totalTraceElapsedMs(snapshot: TraceableSubagentDetailSnapshot, referenceAt = snapshot.updatedAt): number {
  const startedAtMs = parsePanelTimestampMs(snapshot.startedAt);
  const referenceAtMs = parsePanelTimestampMs(referenceAt);
  if (startedAtMs === undefined || referenceAtMs === undefined) {
    return 0;
  }
  return Math.max(0, referenceAtMs - startedAtMs);
}

function runningToolStartTimes(snapshot: TraceableSubagentDetailSnapshot): string[] {
  return snapshot.recentTools
    .filter((event) => event.phase === "running" && typeof event.occurredAt === "string" && event.occurredAt.trim())
    .map((event) => event.occurredAt!.trim());
}

function resolveTimingSummary(snapshot: TraceableSubagentDetailSnapshot): {
  provenance: "measured" | "derived";
  totalElapsedMs: number;
  runtimeElapsedMs: number;
  toolElapsedMs: number;
  llmElapsedMs: number;
  activeSegmentKind?: "runtime" | "tool" | "llm";
} {
  if (snapshot.timingSummary) {
    return {
      provenance: snapshot.timingSummary.provenance,
      totalElapsedMs: Math.max(0, snapshot.timingSummary.totalElapsedMs),
      runtimeElapsedMs: Math.max(0, snapshot.timingSummary.runtimeElapsedMs),
      toolElapsedMs: Math.max(0, snapshot.timingSummary.toolElapsedMs),
      llmElapsedMs: Math.max(0, snapshot.timingSummary.llmElapsedMs),
      activeSegmentKind: snapshot.timingSummary.activeSegmentKind
    };
  }
  const totalElapsedMs = totalTraceElapsedMs(snapshot);
  const toolElapsedMs = totalToolElapsedMs(snapshot);
  return {
    provenance: "derived",
    totalElapsedMs,
    runtimeElapsedMs: 0,
    toolElapsedMs,
    llmElapsedMs: Math.max(0, totalElapsedMs - toolElapsedMs),
    activeSegmentKind: undefined
  };
}

function isFinishedSnapshot(snapshot: TraceableSubagentDetailSnapshot): boolean {
  return snapshot.status.phase !== "running" && snapshot.status.phase !== "idle";
}

function summarizeToolRuntime(item: ToolsetListItem, snapshot: TraceableSubagentDetailSnapshot): ToolRuntimeSummary {
  const matchKeys = new Set(item.matchKeys);
  const selectedToolKeys = new Set((snapshot.header.selectedToolNames ?? []).map((toolName) => normalizeToolReferenceKey(toolName)));
  const policyRestricted = snapshot.header.toolSelectionRestricted === true;
  let callCount = 0;
  let successCount = 0;
  let deferredCount = 0;
  let failureCount = 0;
  let totalElapsedMs = 0;
  let hasFailure = false;
  let hasDeferred = false;
  let hasSuccess = false;
  let hasRunning = false;
  for (const event of snapshot.recentTools) {
    const eventKey = normalizeToolReferenceKey(event.toolName);
    if (!matchKeys.has(eventKey)) {
      continue;
    }
    callCount += 1;
    if (typeof event.elapsedMs === "number" && Number.isFinite(event.elapsedMs) && event.elapsedMs > 0) {
      totalElapsedMs += event.elapsedMs;
    }
    if (event.phase === "failure") {
      failureCount += 1;
      hasFailure = true;
    } else if (event.phase === "deferred") {
      deferredCount += 1;
      hasDeferred = true;
    } else if (event.phase === "success") {
      successCount += 1;
      hasSuccess = true;
    } else if (event.phase === "running") {
      hasRunning = true;
    }
  }
  if (hasFailure) {
    return { status: "failure", callCount, successCount, deferredCount, failureCount, totalElapsedMs };
  }
  if (hasDeferred) {
    return { status: "warning", callCount, successCount, deferredCount, failureCount, totalElapsedMs };
  }
  if (hasRunning) {
    return { status: "running", callCount, successCount, deferredCount, failureCount, totalElapsedMs };
  }
  if (hasSuccess) {
    return { status: "success", callCount, successCount, deferredCount, failureCount, totalElapsedMs };
  }
  const hiddenByPolicy = policyRestricted
    && item.matchKeys.every((matchKey) => !selectedToolKeys.has(matchKey));
  return {
    status: hiddenByPolicy || isFinishedSnapshot(snapshot) ? "inactive" : "idle",
    callCount: 0,
    successCount: 0,
    deferredCount: 0,
    failureCount: 0,
    totalElapsedMs: 0
  };
}

function combineRuntimeSummaries(summaries: ToolRuntimeSummary[], snapshot: TraceableSubagentDetailSnapshot): ToolRuntimeSummary {
  if (summaries.length === 0) {
    return {
      status: isFinishedSnapshot(snapshot) ? "inactive" : "idle",
      callCount: 0,
      successCount: 0,
      deferredCount: 0,
      failureCount: 0,
      totalElapsedMs: 0
    };
  }
  let combined = summaries[0];
  let callCount = 0;
  let successCount = 0;
  let deferredCount = 0;
  let failureCount = 0;
  let totalElapsedMs = 0;
  let sawIdle = false;
  let sawInactive = false;
  for (const summary of summaries) {
    callCount += summary.callCount;
    successCount += summary.successCount;
    deferredCount += summary.deferredCount;
    failureCount += summary.failureCount;
    totalElapsedMs += summary.totalElapsedMs;
    if (summary.status === "idle") {
      sawIdle = true;
    }
    if (summary.status === "inactive") {
      sawInactive = true;
    }
    if (toolRuntimeSeverity(summary.status) > toolRuntimeSeverity(combined.status)) {
      combined = summary;
    }
  }
  return {
    status: callCount === 0
      ? (isFinishedSnapshot(snapshot) || (!sawIdle && sawInactive) ? "inactive" : "idle")
      : combined.status,
    callCount,
    successCount,
    deferredCount,
    failureCount,
    totalElapsedMs
  };
}

function renderToolRuntimeBadges(runtime: ToolRuntimeSummary): string {
  const badges: string[] = [];
  if (runtime.failureCount > 0) {
    badges.push(`<span class="tool-runtime-badge tool-runtime-badge-failure" title="${escapeHtml(String(runtime.failureCount))} failed tool call${runtime.failureCount === 1 ? "" : "s"} in this run">${escapeHtml(eventCountChipLabel(runtime.failureCount))}</span>`);
  }
  if (runtime.deferredCount > 0) {
    badges.push(`<span class="tool-runtime-badge tool-runtime-badge-warning" title="${escapeHtml(String(runtime.deferredCount))} deferred tool call${runtime.deferredCount === 1 ? "" : "s"} in this run">${escapeHtml(eventCountChipLabel(runtime.deferredCount))}</span>`);
  }
  if (runtime.successCount > 0) {
    badges.push(`<span class="tool-runtime-badge tool-runtime-badge-success" title="${escapeHtml(String(runtime.successCount))} successful tool call${runtime.successCount === 1 ? "" : "s"} in this run">${escapeHtml(eventCountChipLabel(runtime.successCount))}</span>`);
  }
  if (runtime.totalElapsedMs > 0) {
    badges.push(`<span class="tool-runtime-badge tool-runtime-badge-time" title="Total tool time ${escapeHtml(formatToolElapsedMs(runtime.totalElapsedMs))}"><span class="tool-runtime-badge-icon">${renderCodicon("history")}</span><span class="tool-runtime-badge-value">${escapeHtml(formatToolElapsedMs(runtime.totalElapsedMs))}</span></span>`);
  }
  return badges.join("");
}

function eventLabel(event: PanelDisplayEvent): string {
  const kind = event.kind;
  if (kind === "Read") {
    const filePath = event.filePath ?? "";
    return filePath ? `read ${path.basename(filePath)}` : "read file";
  }
  if (kind === "Search") {
    switch (normalizeToolBadgeKey(event.event.toolName)) {
      case "find_files":
      case "file_search":
        return "found files";
      default:
        return "searched text";
    }
  }
  return event.event.toolName.startsWith("copilot_") ? event.event.toolName.slice("copilot_".length) : event.event.toolName;
}

function buildDerivedEventNote(event: PanelToolEvent, kind: PanelEventKind): string | undefined {
  if (kind !== "Search") {
    return undefined;
  }
  const query = typeof event.input?.query === "string" ? event.input.query.trim() : "";
  const maxResults = typeof event.input?.maxResults === "number" && Number.isFinite(event.input.maxResults)
    ? event.input.maxResults
    : undefined;
  if (!query) {
    return undefined;
  }
  switch (normalizeToolBadgeKey(event.toolName)) {
    case "find_files":
    case "file_search":
      return maxResults && maxResults > 0
        ? `Query: ${query} · up to ${maxResults} result${maxResults === 1 ? "" : "s"}`
        : `Query: ${query}`;
    case "find_text_in_files":
    case "text_search":
    case "semantic_search":
      return `Query: ${query}`;
    default:
      return undefined;
  }
}

function eventCountChipLabel(count: number): string {
  return `${count}x`;
}

function compactChipText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function normalizeInputString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeInputNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeInputBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function buildPanelOpenFilePayload(
  targetPath: string,
  evidenceFilePath: string | undefined,
  evidenceRepoRootSnapshotPath: string | undefined,
  startLine?: number,
  endLine?: number
): PanelOpenFilePayload {
  const trimmedTargetPath = targetPath.trim();
  if (!trimmedTargetPath) {
    return { type: "openFile", filePath: trimmedTargetPath, startLine, endLine };
  }
  if (!path.isAbsolute(trimmedTargetPath) && !/^file:\/\//iu.test(trimmedTargetPath)) {
    return {
      type: "openFile",
      filePath: trimmedTargetPath,
      baseDir: evidenceFilePath ? path.dirname(evidenceFilePath) : undefined,
      startLine,
      endLine
    };
  }
  return {
    type: "openFile",
    target: resolveTraceablePathTarget(trimmedTargetPath, buildTraceableMarkdownPathRenderOptions(evidenceFilePath, evidenceRepoRootSnapshotPath)),
    startLine,
    endLine
  };
}

function buildObservedOpenFilePayload(targetPath: string, startLine?: number, endLine?: number): PanelOpenFilePayload {
  return {
    type: "openFile",
    filePath: targetPath.trim(),
    startLine,
    endLine
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());
}

function summarizeChipPath(rawPath: string): string {
  const trimmed = rawPath.trim().replace(/[\\/]+$/, "");
  if (!trimmed) {
    return rawPath.trim();
  }
  const baseName = path.basename(trimmed);
  return baseName || trimmed;
}

function normalizeComparableWorkspacePath(value: string): string {
  return path.resolve(value)
    .replace(/\\+/g, "/")
    .replace(/\/+$/u, "")
    .toLowerCase();
}

function isPathWithinAnyWorkspaceRoot(targetPath: string): boolean {
  const normalizedTarget = normalizeComparableWorkspacePath(targetPath);
  return (vscode.workspace.workspaceFolders ?? []).some((folder) => {
    const normalizedRoot = normalizeComparableWorkspacePath(folder.uri.fsPath);
    return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
  });
}

function describePathChipAction(rawPath: string): string {
  const trimmedPath = rawPath.trim();
  if (!trimmedPath) {
    return "Open path";
  }
  if (path.isAbsolute(trimmedPath) || /^file:\/\//iu.test(trimmedPath)) {
    if (/^file:\/\//iu.test(trimmedPath)) {
      return `Open or reveal path: ${trimmedPath}`;
    }
    return isPathWithinAnyWorkspaceRoot(trimmedPath)
      ? `Open or reveal in VS Code: ${trimmedPath}`
      : `${process.platform === "win32" ? "Reveal in Windows File Explorer" : "Reveal in system file explorer"}: ${trimmedPath}`;
  }
  return `Open or reveal from workspace context: ${trimmedPath}`;
}

function renderParameterChip(
  label: string,
  value: string,
  title?: string,
  messagePayload?: PanelOpenFilePayload
): string {
  const tagName = messagePayload ? "button" : "span";
  const messageAttribute = messagePayload
    ? ` data-message="${escapeHtml(JSON.stringify(messagePayload))}"`
    : "";
  const buttonTypeAttribute = messagePayload ? ` type="button"` : "";
  const className = ["chip", "chip-param", "chip-collapsible", messagePayload ? "chip-button" : ""].filter(Boolean).join(" ");
  return [
    `<${tagName} class="${className}"${buttonTypeAttribute}${messageAttribute}${title ? ` title="${escapeHtml(title)}"` : ""}>`,
    `<span class="chip-hover-label">${escapeHtml(label)}</span>`,
    `<span class="chip-value">${escapeHtml(value)}</span>`,
    `</${tagName}>`
  ].join("");
}

function buildEventParameterChips(event: PanelDisplayEvent, evidenceFilePath?: string, evidenceRepoRootSnapshotPath?: string): string[] {
  const chips: string[] = [];
  const input = event.event.input ?? {};
  const normalizedToolName = normalizeToolBadgeKey(event.event.toolName);
  const pushPathChip = (label: string, rawPath: string | undefined) => {
    if (!rawPath) {
      return;
    }
    const payload = buildPanelOpenFilePayload(rawPath, evidenceFilePath, evidenceRepoRootSnapshotPath);
    chips.push(renderParameterChip(
      label,
      summarizeChipPath(rawPath),
      `${label}: ${rawPath}\n${describePathChipAction(rawPath)}`,
      payload
    ));
  };
  const pushQueryChip = (label: string, rawQuery: string | undefined) => {
    if (!rawQuery) {
      return;
    }
    chips.push(renderParameterChip(label, compactChipText(rawQuery, 26), `${label}: ${rawQuery}`));
  };

  switch (normalizedToolName) {
    case "list_directory": {
      pushPathChip("dir", normalizeInputString(input.path));
      break;
    }
    case "find_files":
    case "file_search": {
      pushQueryChip("find", normalizeInputString(input.query));
      pushQueryChip("in", normalizeInputString(input.includePattern));
      const maxResults = normalizeInputNumber(input.maxResults);
      if (maxResults !== undefined && maxResults > 0) {
        chips.push(renderParameterChip("top", String(maxResults), `top: ${maxResults} results`));
      }
      break;
    }
    case "find_text_in_files":
    case "text_search":
    case "semantic_search": {
      pushQueryChip("query", normalizeInputString(input.query));
      pushQueryChip("in", normalizeInputString(input.includePattern));
      const maxResults = normalizeInputNumber(input.maxResults);
      if (maxResults !== undefined && maxResults > 0) {
        chips.push(renderParameterChip("top", String(maxResults), `top: ${maxResults} results`));
      }
      break;
    }
    case "get_errors": {
      const filePaths = normalizeStringArray(input.filePaths);
      if (filePaths.length === 1) {
        pushPathChip("target", filePaths[0]);
      } else if (filePaths.length > 1) {
        chips.push(renderParameterChip("targets", String(filePaths.length), `${filePaths.length} explicit targets`));
      } else {
        chips.push(renderParameterChip("scope", "all", "Checking all available targets"));
      }
      break;
    }
    case "list_agent_sessions":
    case "survey_agent_sessions": {
      const scope = normalizeInputString(input.scope);
      if (scope) {
        chips.push(renderParameterChip("scope", scope, `scope: ${scope}`));
      }
      const limit = normalizeInputNumber(input.limit);
      if (limit !== undefined && limit > 0) {
        chips.push(renderParameterChip("limit", String(limit), `limit: ${limit}`));
      }
      break;
    }
    case "get_agent_session_snapshot":
    case "get_agent_session_index":
    case "get_agent_session_profile": {
      const scope = normalizeInputString(input.scope);
      if (scope) {
        chips.push(renderParameterChip("scope", scope, `scope: ${scope}`));
      }
      const sessionId = normalizeInputString(input.sessionId);
      if (sessionId) {
        chips.push(renderParameterChip("session", compactChipText(sessionId, 10), `session: ${sessionId}`));
      }
      if (normalizeInputBoolean(input.latest)) {
        chips.push(renderParameterChip("pick", "latest", "Using latest discovered session"));
      }
      break;
    }
    case "get_agent_session_window": {
      const scope = normalizeInputString(input.scope);
      if (scope) {
        chips.push(renderParameterChip("scope", scope, `scope: ${scope}`));
      }
      const sessionId = normalizeInputString(input.sessionId);
      if (sessionId) {
        chips.push(renderParameterChip("session", compactChipText(sessionId, 10), `session: ${sessionId}`));
      }
      if (normalizeInputBoolean(input.latest)) {
        chips.push(renderParameterChip("pick", "latest", "Using latest discovered session"));
      }
      pushQueryChip("anchor", normalizeInputString(input.anchorText));
      const before = normalizeInputNumber(input.before);
      const after = normalizeInputNumber(input.after);
      if (before !== undefined || after !== undefined) {
        chips.push(renderParameterChip("window", `${before ?? 0}/${after ?? 0}`, `window: ${before ?? 0} before, ${after ?? 0} after`));
      }
      break;
    }
    case "export_agent_evidence_transcript": {
      const scope = normalizeInputString(input.scope);
      if (scope) {
        chips.push(renderParameterChip("scope", scope, `scope: ${scope}`));
      }
      const sessionId = normalizeInputString(input.sessionId);
      if (sessionId) {
        chips.push(renderParameterChip("session", compactChipText(sessionId, 10), `session: ${sessionId}`));
      }
      if (normalizeInputBoolean(input.latest)) {
        chips.push(renderParameterChip("pick", "latest", "Using latest discovered session"));
      }
      pushQueryChip("anchor", normalizeInputString(input.anchorText));
      if (normalizeInputBoolean(input.afterLatestCompact)) {
        chips.push(renderParameterChip("slice", "compact+", "Restricted to the latest compact boundary"));
      }
      const maxBlocks = normalizeInputNumber(input.maxBlocks);
      if (maxBlocks !== undefined && maxBlocks > 0) {
        chips.push(renderParameterChip("blocks", String(maxBlocks), `max blocks: ${maxBlocks}`));
      }
      const detailLevel = normalizeInputString(input.detailLevel);
      if (detailLevel) {
        chips.push(renderParameterChip("detail", detailLevel, `detail: ${detailLevel}`));
      }
      break;
    }
  }

  return chips;
}

function mergeContiguousRanges(
  ranges: Array<{ startLine: number; endLine: number }>,
  startLine: number,
  endLine: number
): Array<{ startLine: number; endLine: number }> {
  const nextRanges = [...ranges, { startLine, endLine }]
    .sort((left, right) => left.startLine - right.startLine);
  const merged: Array<{ startLine: number; endLine: number }> = [];
  for (const range of nextRanges) {
    const previous = merged.at(-1);
    if (!previous || range.startLine > previous.endLine + 1) {
      merged.push({ ...range });
      continue;
    }
    previous.endLine = Math.max(previous.endLine, range.endLine);
  }
  return merged;
}

function buildEventChips(
  event: PanelDisplayEvent,
  options?: {
    durationPosition?: "before-file" | "after-file";
    evidenceFilePath?: string;
    evidenceRepoRootSnapshotPath?: string;
    includeDurationChip?: boolean;
  }
): string[] {
  const chips: string[] = [];
  const durationPosition = options?.durationPosition ?? "before-file";
  const includeDurationChip = options?.includeDurationChip !== false;
  const toolIcon = toolBadgeIcon(event.event.toolName);
  const toolLabel = humanizeToolName(event.event.toolName);
  const toolChipClasses = ["chip", "chip-tool", toolIcon ? "chip-collapsible" : ""].filter(Boolean).join(" ");
  chips.push([
    `<span class="${toolChipClasses}" title="Tool: ${escapeHtml(toolLabel)}">`,
    toolIcon ? `<span class="chip-icon">${renderCodicon(toolIcon)}</span>` : "",
    toolIcon
      ? `<span class="chip-hover-label">${escapeHtml(toolLabel)}</span>`
      : `<span class="chip-label">${escapeHtml(toolLabel)}</span>`,
    `</span>`
  ].join(""));
  if (event.count > 1) {
    chips.push(`<span class="chip" title="Merged ${escapeHtml(String(event.count))} tool calls">${escapeHtml(eventCountChipLabel(event.count))}</span>`);
  }
  chips.push(...buildEventParameterChips(event, options?.evidenceFilePath, options?.evidenceRepoRootSnapshotPath));
  for (const [index, range] of event.ranges.entries()) {
    if (index > 0) {
      chips.push(`<span class="chip-separator" aria-hidden="true">|</span>`);
    }
    chips.push([
      `<span class="chip chip-range chip-collapsible" title="Lines ${range.startLine}-${range.endLine}">`,
      `<span class="chip-hover-label">lines</span>`,
      `<span class="chip-value">${range.startLine}-${range.endLine}</span>`,
      `</span>`
    ].join(""));
  }
  const durationChip = renderActivityDuration(
    event.running ? "Live" : "For",
    event.baseElapsedMs,
    event.occurredAt,
    event.running,
    event.running ? "Current tool duration" : "Recorded tool duration"
  );
  if (includeDurationChip && durationPosition === "before-file") {
    chips.push(durationChip);
  }
  const filePath = event.filePath ?? "";
  if (filePath) {
    const fileName = path.basename(filePath);
    const hasSingleRange = event.ranges.length === 1;
    const startLine = hasSingleRange ? event.ranges[0]?.startLine : undefined;
    const endLine = hasSingleRange ? event.ranges[0]?.endLine : undefined;
    const payload = escapeHtml(JSON.stringify(buildPanelOpenFilePayload(filePath, options?.evidenceFilePath, options?.evidenceRepoRootSnapshotPath, startLine, endLine)));
    chips.push(`<button class="chip chip-button" data-message="${payload}" title="${escapeHtml(describePathChipAction(filePath))}">${escapeHtml(fileName)}</button>`);
  }
  if (includeDurationChip && durationPosition === "after-file") {
    chips.push(durationChip);
  }
  return chips;
}

function buildDisplayEvents(events: PanelToolEvent[]): PanelDisplayEvent[] {
  const displayEvents: PanelDisplayEvent[] = [];
  const sortedEvents = events.slice().sort((left, right) => {
    const leftOccurredAtMs = parsePanelTimestampMs(left.occurredAt) ?? Number.MAX_SAFE_INTEGER;
    const rightOccurredAtMs = parsePanelTimestampMs(right.occurredAt) ?? Number.MAX_SAFE_INTEGER;
    return leftOccurredAtMs - rightOccurredAtMs;
  });
  for (const event of sortedEvents) {
    const filePath = typeof event.input?.filePath === "string" ? event.input.filePath.trim() : "";
    const startLine = typeof event.input?.startLine === "number" ? event.input.startLine : undefined;
    const endLine = typeof event.input?.endLine === "number" ? event.input.endLine : undefined;
    const kind = detectEventKind(event);
    const note = (typeof event.note === "string" ? event.note.trim() : "") || buildDerivedEventNote(event, kind) || "";
    const outcome = detectEventOutcome(event);
    const previous = displayEvents.at(-1);
    const canMerge = previous
      && outcome === "success"
      && previous.event.toolName === event.toolName
      && previous.event.phase === event.phase
      && previous.kind === kind
      && previous.outcome === outcome
      && previous.note === note
      && Boolean(previous.filePath)
      && previous.filePath === filePath;

    if (canMerge) {
      previous.count += 1;
      previous.baseElapsedMs += typeof event.elapsedMs === "number" && Number.isFinite(event.elapsedMs) && event.elapsedMs > 0 ? event.elapsedMs : 0;
      previous.running = previous.running || event.phase === "running";
      previous.startLine = mergeMinLine(previous.startLine, startLine);
      previous.endLine = mergeMaxLine(previous.endLine, endLine);
      if (typeof startLine === "number" && typeof endLine === "number") {
        previous.ranges = mergeContiguousRanges(previous.ranges, startLine, endLine);
      }
      continue;
    }

    const ranges = typeof startLine === "number" && typeof endLine === "number"
      ? [{ startLine, endLine }]
      : [];

    displayEvents.push({
      event,
      kind,
      outcome,
      count: 1,
      occurredAt: event.occurredAt,
      baseElapsedMs: typeof event.elapsedMs === "number" && Number.isFinite(event.elapsedMs) && event.elapsedMs > 0 ? event.elapsedMs : 0,
      running: event.phase === "running",
      filePath: filePath || undefined,
      startLine,
      endLine,
      ranges,
      note
    });
  }
  return displayEvents;
}

function renderTimingChip(
  label: string,
  value: string,
  className: string,
  partClassName: string,
  dataset: Record<string, string | undefined> = {},
  title?: string
): string {
  const toDataAttributeName = (key: string): string => key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
  const dataAttributes = Object.entries(dataset)
    .filter(([, rawValue]) => typeof rawValue === "string" && rawValue.length > 0)
    .map(([key, rawValue]) => ` data-${toDataAttributeName(key)}="${escapeHtml(rawValue!)}"`)
    .join("");
  const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
  return `<span class="${className}"${dataAttributes}${titleAttribute}><span class="${partClassName}-label">${escapeHtml(label)}</span><span class="${partClassName}-value">${escapeHtml(value)}</span></span>`;
}

function formatPanelRequestSummaryCompactValue(item: PanelRequestSummaryItem): string {
  const normalizedLabel = item.label.trim().toLowerCase();
  if (normalizedLabel !== "parent roles") {
    return item.value;
  }
  const explicitRoles = (item.title || "")
    .split(/\r?\n/u)
    .slice(1)
    .map((line) => line.replace(/\s*\([^)]*\)\s*/gu, " ").replace(/\s+/gu, " ").trim())
    .filter(Boolean);
  if (explicitRoles.length > 0) {
    return explicitRoles.join(", ");
  }
  const compactRoles = item.value
    .split(/[·,]/u)
    .map((value) => value.replace(/\s*\([^)]*\)\s*/gu, " ").replace(/\s+/gu, " ").trim())
    .filter(Boolean);
  return compactRoles.length > 0 ? compactRoles.join(", ") : item.value;
}

function formatPanelRequestSummaryCompactLabel(item: PanelRequestSummaryItem): string {
  const normalizedLabel = item.label.trim().toLowerCase();
  switch (normalizedLabel) {
    case "parent trace":
      return "Trace";
    case "parent roles":
      return "Roles";
    case "context in":
      return "Context";
    case "inherited":
      return "From";
    default:
      return item.label;
  }
}

function renderRequestSummaryBadge(item: PanelRequestSummaryItem, snapshot?: TraceableSubagentDetailSnapshot): string {
  const normalizedLabel = item.label.trim().toLowerCase();
  const compactLabel = formatPanelRequestSummaryCompactLabel(item);
  if (normalizedLabel === "track") {
    const trackClassName = item.value.trim().toLowerCase() === "candidate"
      ? "activity-request-badge header-badge-track-candidate"
      : "activity-request-badge header-badge-track-experimental";
    return renderHeaderBadge(compactLabel, item.value, trackClassName, item.title);
  }
  if (normalizedLabel === "model") {
    return renderHeaderBadge(compactLabel, item.value, "activity-request-badge header-badge-model", item.title);
  }
  if (normalizedLabel === "inherited") {
    return renderHeaderBadge(compactLabel, item.value, "activity-request-badge activity-request-badge-inherited", item.title, "link");
  }
  if (normalizedLabel === "parent trace") {
    const parentTracePath = item.title?.trim() || item.value.trim();
    const openPayload = parentTracePath && /[\\/]|\.trace\.md$/i.test(parentTracePath)
      ? buildPanelOpenFilePayload(
        parentTracePath,
        snapshot?.evidenceFile?.filePath,
        snapshot?.environment?.repoRootSnapshotPath
      )
      : undefined;
    return renderHeaderBadge(
      compactLabel,
      item.value,
      "activity-request-badge",
      item.title,
      undefined,
      openPayload
    );
  }
  if (normalizedLabel === "role" && snapshot) {
    const isHuman = snapshot.header.humanRole;
    const isResolved = snapshot.header.agentResolved;
    const title = isResolved
      ? snapshot.header.agentFilePath
        ? `${isHuman ? "Human role" : "AI role"}\n${snapshot.header.agentFilePath}`
        : (isHuman ? "Human role" : "AI role")
      : `Requested ${isHuman ? "human" : "AI"} role\nNot yet resolved to a workspace .agent.md artifact.`;
    const className = `${isHuman ? "header-badge-role-human" : "header-badge-role-ai"} ${isResolved ? "header-badge-role-resolved" : "header-badge-role-pending"}`;
    const value = isResolved ? (snapshot.header.agentName || item.value) : `${snapshot.header.agentName || item.value} (requested)`;
    return renderHeaderBadge(
      compactLabel,
      value,
      `activity-request-badge ${className}`,
      title,
      isHuman ? "account" : "hubot",
      isResolved && snapshot.header.agentFilePath ? { type: "openFile", filePath: snapshot.header.agentFilePath } : undefined
    );
  }
  if (normalizedLabel === "allowlist") {
    const countMatch = item.value.match(/^(\d+)\s+tool/i);
    const countBadge = countMatch
      ? renderHeaderBadge("Tools", countMatch[1], "activity-request-badge activity-request-badge-count", `${countMatch[1]} allowed tool${countMatch[1] === "1" ? "" : "s"}`)
      : "";
    return `${countBadge}${renderHeaderBadge(compactLabel, item.value, "activity-request-badge", item.title)}`;
  }
  return renderHeaderBadge(compactLabel, formatPanelRequestSummaryCompactValue(item), "activity-request-badge", item.title);
}

function normalizePanelModelDisplayName(modelLabel: string | undefined): string {
  const trimmed = modelLabel?.trim();
  return trimmed || "model";
}

function decorateRequestSummaryItem(
  item: PanelRequestSummaryItem,
  snapshot: TraceableSubagentDetailSnapshot
): PanelRequestSummaryItem {
  const normalizedLabel = item.label.trim().toLowerCase();
  if (normalizedLabel === "model" && snapshot.header.modelLabel?.trim()) {
    return {
      ...item,
      value: normalizePanelModelDisplayName(snapshot.header.modelLabel),
      title: `Model: ${snapshot.header.modelLabel.trim()}`
    };
  }
  if (normalizedLabel === "role" && snapshot.header.agentName?.trim()) {
    return {
      ...item,
      value: snapshot.header.agentName.trim(),
      title: item.title || snapshot.header.agentFilePath?.trim() || snapshot.header.agentName.trim()
    };
  }
  return item;
}

function buildTrackRequestSummaryItems(snapshot: TraceableSubagentDetailSnapshot): PanelRequestSummaryItem[] {
  const items: PanelRequestSummaryItem[] = [];
  if (snapshot.header.candidate) {
    items.push({
      label: "Track",
      value: "Candidate",
      title: "Track: Candidate"
    });
  }
  if (snapshot.header.experimental) {
    items.push({
      label: "Track",
      value: "Experimental",
      title: "Track: Experimental"
    });
  }
  return items;
}

function splitRequestSummary(summary: PanelRequestSummaryItem[], snapshot: TraceableSubagentDetailSnapshot): {
  task?: PanelRequestSummaryItem;
  userInput?: PanelRequestSummaryItem;
  prominentMetadata: PanelRequestSummaryItem[];
  secondaryMetadata: PanelRequestSummaryItem[];
} {
  const hiddenLabels = new Set(["user input"]);
  const prominentMetadata: PanelRequestSummaryItem[] = [];
  const secondaryMetadata: PanelRequestSummaryItem[] = [];
  let task: PanelRequestSummaryItem | undefined;
  let userInput: PanelRequestSummaryItem | undefined;
  const augmentedSummary = [...summary.map((item) => decorateRequestSummaryItem(item, snapshot)), ...buildTrackRequestSummaryItems(snapshot)];
  for (const item of augmentedSummary) {
    const normalizedLabel = item.label.trim().toLowerCase();
    if (!task && (normalizedLabel === "task" || normalizedLabel === "parent frame")) {
      task = item;
      continue;
    }
    if (!userInput && normalizedLabel === "user input") {
      userInput = item;
      continue;
    }
    if (hiddenLabels.has(normalizedLabel)) {
      continue;
    }
    if (normalizedLabel === "role" || normalizedLabel === "model" || normalizedLabel === "track") {
      prominentMetadata.push(item);
      continue;
    }
    secondaryMetadata.push(item);
  }
  return { task, userInput, prominentMetadata, secondaryMetadata };
}

function requestSummaryInlineBadgePriority(item: PanelRequestSummaryItem): number {
  const normalizedLabel = item.label.trim().toLowerCase();
  const compactValue = formatPanelRequestSummaryCompactValue(item).replace(/\s+/gu, " ").trim();
  if (normalizedLabel === "role" || normalizedLabel === "model" || normalizedLabel === "track") {
    return 0;
  }
  if (normalizedLabel === "mode" || normalizedLabel === "output") {
    return 1;
  }
  if (normalizedLabel === "parent roles") {
    return compactValue.length <= 20 ? 2 : 3;
  }
  if (normalizedLabel === "carry" || normalizedLabel === "budget") {
    return 2;
  }
  if (normalizedLabel === "parent trace" || normalizedLabel === "context in" || normalizedLabel === "inherited") {
    return 5;
  }
  if (compactValue.length > 22) {
    return 4;
  }
  return 3;
}

function orderRequestSummaryItemsForInlineFlow(summary: PanelRequestSummaryItem[]): PanelRequestSummaryItem[] {
  return summary
    .map((item, index) => ({
      item,
      index,
      priority: requestSummaryInlineBadgePriority(item),
      compactLength: formatPanelRequestSummaryCompactValue(item).replace(/\s+/gu, " ").trim().length
    }))
    .sort((left, right) => left.priority - right.priority || left.compactLength - right.compactLength || left.index - right.index)
    .map((entry) => entry.item);
}

function renderRequestSummaryChips(summary: PanelRequestSummaryItem[], snapshot?: TraceableSubagentDetailSnapshot): string {
  return summary
    .map((item) => renderRequestSummaryBadge(item, snapshot))
    .join("");
}

function renderRequestDetailSection(label: string, value: string): string {
  return renderDetailSectionMarkup(label, escapeHtml(value));
}

function renderDetailSectionMarkup(label: string, valueMarkup: string): string {
  return [
    `<div class="event-request-detail-section">`,
    `<div class="event-request-detail-label">${escapeHtml(label)}</div>`,
    `<div class="event-request-detail-value">${valueMarkup}</div>`,
    `</div>`
  ].join("");
}

function extractOutputEvidencePaths(text: string): string[] {
  const matches = text.match(/[A-Za-z]:\\[^\r\n]*?(?:\.trace\.md|\.jsonl|\.md|\.json|\.txt|\.png|\.jpe?g|\.webp|\.gif|\.svg|\.mjs|\.cjs|\.js|\.ts)\b/giu) ?? [];
  return [...new Set(matches
    .map((match) => match.trim().replace(/[.,)\]]+$/u, ""))
    .filter(Boolean))];
}

function renderPathChipRow(paths: string[], evidenceFilePath: string | undefined, evidenceRepoRootSnapshotPath: string | undefined, label: string): string {
  return `<div class="event-detail-chip-row">${paths.map((rawPath) => renderParameterChip(
    label,
    summarizeChipPath(rawPath),
    `${label}: ${rawPath}\n${describePathChipAction(rawPath)}`,
    buildPanelOpenFilePayload(rawPath, evidenceFilePath, evidenceRepoRootSnapshotPath)
  )).join("")}</div>`;
}

function compactModeDetailText(title: string, fallbackValue: string): string {
  const lines = title
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const inputMode = lines.find((line) => line.startsWith("Declared input mode:"))?.replace(/^Declared input mode:\s*/u, "") || "";
  const validationMode = lines.find((line) => line.startsWith("Declared validation mode:"))?.replace(/^Declared validation mode:\s*/u, "") || "";
  const code = lines.find((line) => line.startsWith("Declared mode code:"))?.replace(/^Declared mode code:\s*/u, "") || fallbackValue;
  const inputSummary = lines.includes("Treat the bounded task contract as explicit operational direction.")
    ? "Operational direction."
    : lines.includes("Treat the input as inquiry-shaped framing rather than as a fixed target conclusion.")
      ? "Inquiry-shaped framing, not a fixed conclusion."
      : lines.includes("Treat the input as inquiry-shaped framing and avoid smuggling the target conclusion into the task contract.")
        ? "Inquiry-shaped framing; avoid leading the conclusion."
        : "";
  const validationSummary = lines.includes("Do not apply any extra input-mode mismatch gate by default.")
    ? "No extra mismatch gate."
    : lines.includes("Surface input-mode mismatches as trace-visible warnings while preserving the original userInput and parentFrame text unchanged.")
      ? "Warnings only; original text preserved."
      : lines.includes("Treat input-mode mismatches as hard validation errors and stop the lane before model execution.")
        ? "Hard-stop on mismatch."
        : lines.includes("NON_LEADING_EPISTEMIC requires validationMode WARN or ERROR.")
          ? "Requires WARN or ERROR."
          : "";
  const header = [inputMode, validationMode, code].filter(Boolean).join(" · ");
  const detail = [inputSummary, validationSummary].filter(Boolean).join(" ");
  return [header, detail].filter(Boolean).join("\n");
}

function renderRequestDetailValue(item: PanelRequestSummaryItem): string {
  const label = item.label.trim().toLowerCase();
  const title = item.title?.trim() || "";
  const value = item.value?.trim() || "";
  if (label === "mode") {
    return compactModeDetailText(title, value);
  }
  if (label === "allowlist") {
    return title.replace(/^Allowed tools:\s*/u, "") || value;
  }
  if (label === "blocklist") {
    return title.replace(/^Blocked tools:\s*/u, "") || value;
  }
  if (label === "reveal") {
    return value || title;
  }
  if (label === "model") {
    return title.replace(/^Model:\s*/u, "") || value;
  }
  if (label === "track") {
    return title.replace(/^Track:\s*/u, "") || value;
  }
  return title || value;
}

function buildRequestActivityId(snapshot: TraceableSubagentDetailSnapshot): string {
  const evidenceKey = snapshot.evidenceFile?.filePath?.trim();
  if (evidenceKey) {
    return `request-summary:${evidenceKey}`;
  }
  return `request-summary:${snapshot.startedAt}:${snapshot.updatedAt}`;
}

function getBrokenLineageWarning(snapshot: TraceableSubagentDetailSnapshot): {
  note: string;
  detail?: string;
} | undefined {
  if (!snapshot.lineageIntegrity || (
    snapshot.lineageIntegrity.status !== "missing-parent"
    && snapshot.lineageIntegrity.status !== "unreadable-parent"
    && snapshot.lineageIntegrity.status !== "checksum-mismatch"
    && snapshot.lineageIntegrity.status !== "cycle-detected"
  )) {
    return undefined;
  }
  const note = snapshot.lineageIntegrity.status === "missing-parent"
    ? "Stored parent trace could not be resolved."
    : snapshot.lineageIntegrity.status === "unreadable-parent"
      ? "Stored parent trace exists but could not be read."
      : snapshot.lineageIntegrity.status === "checksum-mismatch"
        ? "Stored parent checksum no longer matches the resolved parent artifact."
        : "The stored parent trace edge would create a lineage cycle.";
  return {
    note,
    detail: snapshot.lineageIntegrity.resolvedParentTracePath
  };
}

function buildActivityEntries(snapshot: TraceableSubagentDetailSnapshot): PanelActivityEntry[] {
  const activities: PanelActivityEntry[] = [];
  const lineageWarning = getBrokenLineageWarning(snapshot);
  if (lineageWarning) {
    activities.push({
      kind: "lineage-warning",
      id: `lineage-warning:${snapshot.updatedAt}`,
      occurredAt: snapshot.updatedAt,
      title: "Broken Lineage",
      note: lineageWarning.note,
      detail: lineageWarning.detail
    });
  }
  for (const lineageEntry of snapshot.lineageEntries ?? []) {
    activities.push({
      kind: "ancestor",
      id: `ancestor:${lineageEntry.filePath}`,
      occurredAt: lineageEntry.occurredAt,
      title: lineageEntry.title,
      filePath: lineageEntry.filePath,
      startedAt: lineageEntry.startedAt,
      updatedAt: lineageEntry.updatedAt,
      finalSummary: lineageEntry.finalSummary,
      completionClaim: lineageEntry.completionClaim,
      status: lineageEntry.status,
      header: lineageEntry.header,
      evidenceFile: lineageEntry.evidenceFile,
      requestSummary: lineageEntry.requestSummary,
      statusHistory: lineageEntry.statusHistory,
      recentTools: lineageEntry.recentTools,
      timingSummary: lineageEntry.timingSummary,
      resultSummary: lineageEntry.resultSummary
    });
  }
  if (snapshot.requestSummary.length > 0) {
    activities.push({
      kind: "request",
      id: buildRequestActivityId(snapshot),
      occurredAt: snapshot.startedAt,
      requestSummary: snapshot.requestSummary,
      snapshot
    });
  }

  const sortedStatusHistory = snapshot.statusHistory.slice().sort((left, right) => {
    const leftOccurredAtMs = parsePanelTimestampMs(left.occurredAt) ?? Number.MAX_SAFE_INTEGER;
    const rightOccurredAtMs = parsePanelTimestampMs(right.occurredAt) ?? Number.MAX_SAFE_INTEGER;
    return leftOccurredAtMs - rightOccurredAtMs;
  });
  for (let index = 0; index < sortedStatusHistory.length; index += 1) {
    const event = sortedStatusHistory[index];
    const nextEvent = sortedStatusHistory[index + 1];
    const occurredAtMs = parsePanelTimestampMs(event.occurredAt);
    const nextOccurredAtMs = parsePanelTimestampMs(nextEvent?.occurredAt);
    const running = index === sortedStatusHistory.length - 1 && snapshot.status.phase === "running";
    const baseElapsedMs = !running && Number.isFinite(occurredAtMs) && Number.isFinite(nextOccurredAtMs)
      ? Math.max(0, (nextOccurredAtMs as number) - (occurredAtMs as number))
      : 0;
    activities.push({
      kind: "status",
      id: event.id,
      occurredAt: event.occurredAt,
      phase: event.phase,
      message: event.message,
      detail: event.detail,
      baseElapsedMs: event.phase === "completed" ? totalTraceElapsedMs(snapshot, event.occurredAt) : baseElapsedMs,
      running,
      durationLabel: event.phase === "completed" ? "Total" : undefined,
      durationTitle: event.phase === "completed" ? "Total trace duration" : undefined
    });
  }

  for (const event of buildDisplayEvents(snapshot.recentTools)) {
    activities.push({
      kind: "tool",
      id: `${event.event.callId}:${event.kind}`,
      occurredAt: event.occurredAt || snapshot.updatedAt,
      displayEvent: event
    });
  }

  const completedOutput = snapshot.status.phase === "completed"
    ? snapshot.status.detail?.trim()
    : "";
  if (completedOutput) {
    activities.push({
      kind: "output",
      id: "final-output",
      occurredAt: snapshot.updatedAt,
      text: completedOutput
    });
  }

  const handoff = buildCarryHandoffActivity(snapshot);
  if (handoff) {
    activities.push(handoff);
  }

  const senderAdaptation = buildSenderAdaptationActivity(snapshot);
  if (senderAdaptation) {
    activities.push(senderAdaptation);
  }

  return activities.sort((left, right) => {
    const leftOccurredAtMs = parsePanelTimestampMs(left.occurredAt) ?? Number.MAX_SAFE_INTEGER;
    const rightOccurredAtMs = parsePanelTimestampMs(right.occurredAt) ?? Number.MAX_SAFE_INTEGER;
    if (leftOccurredAtMs !== rightOccurredAtMs) {
      return leftOccurredAtMs - rightOccurredAtMs;
    }
    const order = { ancestor: 0, "lineage-warning": 1, request: 2, status: 3, tool: 4, output: 5, "sender-adaptation": 6, handoff: 7 } as const;
    return order[left.kind] - order[right.kind];
  });
}

function renderAncestorActivity(entry: Extract<PanelActivityEntry, { kind: "ancestor" }>): string {
  const summaryText = entry.finalSummary?.trim() || "Earlier trace in this continuation chain.";
  const statusChip = renderAncestorStatusChip(entry);
  const lineageSnapshot: TraceableSubagentDetailSnapshot = {
    header: entry.header ?? {
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
    status: entry.status ?? {
      phase: "completed",
      message: entry.completionClaim?.trim() || "completed",
      detail: summaryText
    },
    environment: entry.environment,
    evidenceFile: entry.evidenceFile,
    requestSummary: entry.requestSummary ?? [],
    statusHistory: entry.statusHistory ?? [],
    recentTools: entry.recentTools ?? [],
    timingSummary: entry.timingSummary,
    startedAt: entry.startedAt ?? entry.occurredAt,
    updatedAt: entry.updatedAt ?? entry.occurredAt,
    resultSummary: entry.resultSummary
  };
  const lineageHandoff = buildCarryHandoffActivity(lineageSnapshot);
  const childRows = groupActivityEntries(buildActivityEntries(lineageSnapshot).filter((activity) => activity.kind !== "ancestor"))
    .map((activity) => renderActivityRow(activity, entry.filePath, entry.environment?.repoRootSnapshotPath));
  const latestAncestorSignal = lineageHandoff
    ? {
      kind: "handoff" as const,
      note: lineageHandoff.summary.trim() || lineageHandoff.note.trim() || summaryText,
      chips: [
        ...statusChip,
        `<span class="chip chip-handoff-kind" title="Carry package type">${escapeHtml(lineageHandoff.disposition)}</span>`,
        lineageHandoff.goalCount > 0 ? `<span class="chip chip-handoff-scope" title="Remaining goals carried forward">${escapeHtml(String(lineageHandoff.goalCount))} goal${lineageHandoff.goalCount === 1 ? "" : "s"}</span>` : "",
        lineageHandoff.questionCount > 0 ? `<span class="chip chip-handoff-scope" title="Open questions carried forward">${escapeHtml(String(lineageHandoff.questionCount))} question${lineageHandoff.questionCount === 1 ? "" : "s"}</span>` : "",
        lineageHandoff.hasNextStart ? `<span class="chip chip-handoff-scope" title="A next suggested start is included">next start</span>` : ""
      ].filter(Boolean)
    }
    : summaryText
      ? {
        kind: "output" as const,
        note: summaryText,
        chips: statusChip
      }
      : (entry.requestSummary?.length ?? 0) > 0
        ? {
          kind: "request" as const,
          note: "Earlier trace request context is available.",
          chips: statusChip
        }
        : {
          kind: "status" as const,
          note: summaryText,
          chips: statusChip
        };
  if (childRows.length === 0) {
    return [
      `<li class="event-row event-ancestor" title="${escapeHtml(entry.filePath)}">`,
      `<div class="event-body"><div class="event-main"><span class="event-icon">↥</span><span class="event-label">Earlier Trace</span><span class="event-summary-inline"><span class="event-summary-preview">${escapeHtml(entry.title)}</span></span></div><div class="event-note">${escapeHtml(latestAncestorSignal.note)}</div></div>`,
      renderActivityMeta(entry.occurredAt, "", latestAncestorSignal.chips),
      `</li>`
    ].join("");
  }
  return [
    `<li class="ancestor-group-item">`,
    `<details class="ancestor-group" data-ancestor-group-id="${escapeHtml(entry.id)}">`,
    `<summary class="event-row event-ancestor" title="${escapeHtml(entry.filePath)}">`,
    `<div class="event-body"><div class="event-main"><span class="event-icon event-ancestor-toggle">${renderCodicon("chevron-right")}</span>${renderAncestorSummaryActionIcon(latestAncestorSignal.kind)}<span class="event-label">Earlier Trace</span><span class="event-summary-inline"><span class="event-summary-preview">${escapeHtml(entry.title)}</span></span></div><div class="event-note">${escapeHtml(latestAncestorSignal.note)}</div></div>`,
    renderActivityMeta(entry.occurredAt, "", latestAncestorSignal.chips),
    `</summary>`,
    `<ul class="ancestor-group-children">${childRows.join("")}</ul>`,
    `</details>`,
    `</li>`
  ].join("");
}

function buildCarryHandoffActivity(snapshot: TraceableSubagentDetailSnapshot): Extract<PanelActivityEntry, { kind: "handoff" }> | undefined {
  const result = snapshot.resultSummary;
  if (!result) {
    return undefined;
  }
  const activeCarryForward = result.activeCarryForward;
  const recoverableCarryState = result.recoverableCarryState;
  const disposition = result.carryStateDisposition
    ?? (activeCarryForward ? "active" : recoverableCarryState ? "recoverable" : undefined);
  if (!disposition && !activeCarryForward && !recoverableCarryState) {
    return undefined;
  }
  const resolvedDisposition = disposition ?? "none";
  const summaryState = activeCarryForward ?? recoverableCarryState;
  if (resolvedDisposition === "none" && !summaryState) {
    return undefined;
  }
  const noteParts: string[] = [];
  let summary = "Carry state changed.";
  switch (resolvedDisposition) {
    case "active":
      summary = "Next trace inherits active carry-forward.";
      noteParts.push(summary);
      break;
    case "recoverable":
      summary = "Carry state was preserved for inspection, not auto-inheritance.";
      noteParts.push(summary);
      break;
    case "consumed":
      summary = "Carry state was consumed in this run.";
      noteParts.push(summary);
      break;
    case "expired":
      summary = "Carry state expired at this boundary.";
      noteParts.push(summary);
      break;
    case "none":
      summary = "No carry state remains after this run.";
      noteParts.push(summary);
      break;
  }
  const goalCount = Array.isArray(summaryState?.remainingGoals) ? summaryState.remainingGoals.length : 0;
  const questionCount = Array.isArray(summaryState?.openQuestions) ? summaryState.openQuestions.length : 0;
  const hasNextStart = Boolean(summaryState?.nextSuggestedStart?.trim());
  if (summaryState?.nextSuggestedStart?.trim()) {
    noteParts.push(`Next start: ${summaryState.nextSuggestedStart.trim()}`);
  }
  const detailParts: string[] = [];
  if (Array.isArray(activeCarryForward?.remainingGoals) && activeCarryForward.remainingGoals.length > 0) {
    detailParts.push(`Remaining goals: ${activeCarryForward.remainingGoals.join(" | ")}`);
  }
  if (Array.isArray(activeCarryForward?.openQuestions) && activeCarryForward.openQuestions.length > 0) {
    detailParts.push(`Open questions: ${activeCarryForward.openQuestions.join(" | ")}`);
  }
  if (Array.isArray(activeCarryForward?.constraints) && activeCarryForward.constraints.length > 0) {
    detailParts.push(`Constraints: ${activeCarryForward.constraints.join(" | ")}`);
  }
  if (Array.isArray(summaryState?.relevantFileAnchors) && summaryState.relevantFileAnchors.length > 0) {
    detailParts.push(`File anchors: ${summaryState.relevantFileAnchors.join(", ")}`);
  }
  if (Array.isArray(summaryState?.relevantArtifactAnchors) && summaryState.relevantArtifactAnchors.length > 0) {
    detailParts.push(`Artifact anchors: ${summaryState.relevantArtifactAnchors.join(", ")}`);
  }
  return {
    kind: "handoff",
    id: "carry-handoff",
    occurredAt: snapshot.updatedAt,
    summary,
    note: noteParts.join(" "),
    detail: detailParts.join("\n") || undefined,
    disposition: resolvedDisposition,
    goalCount,
    questionCount,
    hasNextStart,
    nextSuggestedStart: summaryState?.nextSuggestedStart?.trim() || undefined,
    remainingGoals: Array.isArray(summaryState?.remainingGoals) ? summaryState.remainingGoals.filter((value): value is string => typeof value === "string" && value.trim().length > 0) : [],
    openQuestions: Array.isArray(summaryState?.openQuestions) ? summaryState.openQuestions.filter((value): value is string => typeof value === "string" && value.trim().length > 0) : [],
    constraints: Array.isArray(summaryState?.constraints) ? summaryState.constraints.filter((value): value is string => typeof value === "string" && value.trim().length > 0) : [],
    relevantFileAnchors: Array.isArray(summaryState?.relevantFileAnchors) ? summaryState.relevantFileAnchors.filter((value): value is string => typeof value === "string" && value.trim().length > 0) : [],
    relevantArtifactAnchors: Array.isArray(summaryState?.relevantArtifactAnchors) ? summaryState.relevantArtifactAnchors.filter((value): value is string => typeof value === "string" && value.trim().length > 0) : []
  };
}

function buildSenderAdaptationActivity(snapshot: TraceableSubagentDetailSnapshot): Extract<PanelActivityEntry, { kind: "sender-adaptation" }> | undefined {
  const entries = snapshot.resultSummary?.senderAdaptationState?.entries ?? [];
  if (entries.length === 0) {
    return undefined;
  }
  const claimCount = entries.reduce((total, entry) => total + entry.claims.length, 0);
  const reinforcedCount = entries.reduce((total, entry) => total + entry.claims.filter((claim) => claim.status === "reinforced").length, 0);
  const summary = entries.length === 1
    ? `Observed receiver adaptation for ${entries[0].senderId}.`
    : `Observed receiver adaptation for ${entries.length} senders.`;
  const note = reinforcedCount > 0
    ? `${reinforcedCount} claim${reinforcedCount === 1 ? "" : "s"} reinforced across this chain.`
    : "Chain-local receiver guidance is available for the current sender set.";
  const detail = entries.map((entry) => {
    const lines = [`Sender: ${entry.senderId}`];
    if (entry.sourceRoles?.length) {
      lines.push(`Source roles: ${entry.sourceRoles.join(" | ")}`);
    }
    for (const claim of entry.claims) {
      lines.push(`${claim.key}=${claim.value} [${claim.status}${claim.observations > 1 ? ` x${claim.observations}` : ""}]${claim.evidence ? `: ${claim.evidence}` : ""}`);
    }
    return lines.join("\n");
  }).join("\n\n");
  return {
    kind: "sender-adaptation",
    id: "sender-adaptation",
    occurredAt: snapshot.updatedAt,
    summary,
    note,
    detail,
    senderCount: entries.length,
    claimCount,
    reinforcedCount
  };
}

function renderActivityDuration(
  label: string,
  baseElapsedMs: number,
  startedAt: string | undefined,
  running: boolean,
  title: string
): string {
  const elapsedLabel = formatToolElapsedMs(baseElapsedMs);
  return renderTimingChip(
    label,
    elapsedLabel,
    "chip activity-duration",
    "activity-duration",
    {
      timerKind: "event",
      startedAt,
      baseElapsedMs: String(baseElapsedMs),
      running: running ? "true" : "false"
    },
    title
  );
}

function renderActivityMeta(
  occurredAt: string | undefined,
  durationMarkup: string,
  extraChips: string[]
): string {
  const chips = [...extraChips];
  const timingChips: string[] = [];
  const clockLabel = formatPanelClockTime(occurredAt);
  const clockTitle = formatPanelAbsoluteTimestamp(occurredAt) || clockLabel;
  if (clockLabel) {
    timingChips.push(`<span class="chip chip-time" title="Started ${escapeHtml(clockTitle || clockLabel)}">${escapeHtml(clockLabel)}</span>`);
  }
  if (durationMarkup) {
    timingChips.push(durationMarkup);
  }
  return `<div class="event-chips">${chips.length > 0 ? `<span class="event-meta-chips">${chips.join("")}</span>` : ""}${timingChips.length > 0 ? `<span class="event-meta-timing">${timingChips.join("")}</span>` : ""}</div>`;
}

function compactStatusGroupText(parts: string[], maxLength: number): string {
  const compactParts = parts
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const combined = compactParts.join(" ... ");
  if (combined.length <= maxLength) {
    return combined;
  }
  return `${combined.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function groupActivityEntries(activities: PanelActivityEntry[]): PanelRenderedEntry[] {
  const grouped: PanelRenderedEntry[] = [];
  let index = 0;
  while (index < activities.length) {
    const current = activities[index];
    if (current.kind !== "status") {
      grouped.push(current);
      index += 1;
      continue;
    }
    const statusEntries: Array<Extract<PanelActivityEntry, { kind: "status" }>> = [current];
    let nextIndex = index + 1;
    while (nextIndex < activities.length && activities[nextIndex].kind === "status") {
      statusEntries.push(activities[nextIndex] as Extract<PanelActivityEntry, { kind: "status" }>);
      nextIndex += 1;
    }
    if (statusEntries.length >= 2) {
      const groupedToolEntry = nextIndex < activities.length && activities[nextIndex]?.kind === "tool"
        ? activities[nextIndex] as Extract<PanelActivityEntry, { kind: "tool" }>
        : undefined;
      grouped.push({
        kind: "status-group",
        id: `${statusEntries[0].id}:${groupedToolEntry?.id ?? statusEntries[statusEntries.length - 1].id}`,
        occurredAt: statusEntries[0].occurredAt,
        entries: statusEntries,
        latestToolActionLabel: groupedToolEntry ? formatToolActionLabel(groupedToolEntry.displayEvent) : undefined,
        latestToolEvent: groupedToolEntry?.displayEvent,
        latestToolTitle: groupedToolEntry ? formatToolActionTitle(groupedToolEntry.displayEvent) : undefined,
        groupedToolEntry
      });
      if (groupedToolEntry) {
        nextIndex += 1;
      }
    } else {
      grouped.push(statusEntries[0]);
    }
    index = nextIndex;
  }
  return grouped;
}

function deriveStatusTransparencyNote(entry: Extract<PanelActivityEntry, { kind: "status" }>): string | undefined {
  if (entry.detail) {
    return undefined;
  }
  switch (entry.message) {
    case "starting":
      return "Initializing trace lane state.";
    case "queued":
      return "Waiting for the traceable single-flight queue to hand this lane the active slot.";
    case "resolving role":
      return "Resolving the requested role artifact before the child lane starts.";
    case "selecting model":
      return "Selecting the grounded child model for this lane.";
    case "model ready":
      return "Grounded model selected; the child lane can begin.";
    case "requesting analysis":
      return "Awaiting the first child response.";
    case "continuing analysis":
      return "Awaiting the next child response.";
    case "synthesizing":
      return "No further tool work is scheduled; preparing the child result.";
    case "final recovery":
      return "Running the recovery turn after deferred-only progress.";
    case "finalizing":
      return "Rendering the final result for the parent lane.";
    default:
      return undefined;
  }
}

function renderStatusActivity(entry: Extract<PanelActivityEntry, { kind: "status" }>): string {
  const suppressNoteRow = entry.phase === "completed" && entry.message === "completed";
  const noteText = suppressNoteRow ? "" : (entry.detail || deriveStatusTransparencyNote(entry) || "");
  const noteRow = noteText ? `<div class="event-note">${escapeHtml(noteText)}</div>` : "";
  const phaseChips = entry.phase === "running"
    ? []
    : [`<span class="chip chip-status-phase chip-status-phase-${entry.phase}">${escapeHtml(entry.phase)}</span>`];
  const rowClasses = ["event-row", "event-status", `event-status-${entry.phase}`, entry.running ? "event-status-live" : "event-status-settled"].join(" ");
  const durationMarkup = entry.running || entry.baseElapsedMs >= 0
    ? renderActivityDuration(
      entry.durationLabel ?? (entry.running ? "Live" : "For"),
      entry.baseElapsedMs,
      entry.occurredAt,
      entry.running,
      entry.durationTitle ?? (entry.running ? "Current status duration" : "Status duration")
    )
    : "";
  return [
    `<li class="${rowClasses}" title="${escapeHtml(entry.message)}">`,
    `<div class="event-body"><div class="event-main"><span class="event-icon">${escapeHtml(panelStatusRowIcon(entry.phase, entry.running))}</span><span class="event-label">${escapeHtml(entry.message)}</span></div>${noteRow}</div>`,
    renderActivityMeta(entry.occurredAt, durationMarkup, phaseChips),
    `</li>`
  ].join("");
}

function renderLineageWarningActivity(entry: Extract<PanelActivityEntry, { kind: "lineage-warning" }>): string {
  const titleText = entry.detail?.trim()
    ? `${entry.title}\n${entry.note}\n${entry.detail}`
    : `${entry.title}\n${entry.note}`;
  return [
    `<li class="event-row event-lineage-warning" title="${escapeHtml(titleText)}">`,
    `<div class="event-body"><div class="event-main"><span class="event-icon" style="color: var(--vscode-editorWarning-foreground);">${renderCodicon("warning")}</span><span class="event-label">${escapeHtml(entry.title)}</span></div><div class="event-note">${escapeHtml(entry.note)}</div></div>`,
    `</li>`
  ].join("");
}

function renderStatusGroupActivity(entry: Extract<PanelRenderedEntry, { kind: "status-group" }>, evidenceFilePath?: string, evidenceRepoRootSnapshotPath?: string): string {
  const firstEntry = entry.entries[0];
  const summaryEvent = deriveStatusGroupSummaryEvent(entry);
  const severityClass = summaryEvent.severityClass;
  const summaryLabel = summaryEvent.label;
  const noteText = summaryEvent.note;
  const titleText = summaryEvent.title;
  const durationChips = entry.entries
    .filter((child) => child.running || child.baseElapsedMs >= 0)
    .map((child) => renderActivityDuration(
      child.durationLabel ?? (child.running ? "Live" : "For"),
      child.baseElapsedMs,
      child.occurredAt,
      child.running,
      child.durationTitle ?? (child.running ? "Current status duration" : "Status duration")
    ));
  const chips: string[] = [];
  const clockLabel = formatPanelClockTime(firstEntry.occurredAt);
  const clockTitle = formatPanelAbsoluteTimestamp(firstEntry.occurredAt) || clockLabel;
  if (clockLabel) {
    chips.push(`<span class="chip chip-time" title="Started ${escapeHtml(clockTitle || clockLabel)}">${escapeHtml(clockLabel)}</span>`);
  }
  chips.push(...durationChips);
  if (entry.latestToolEvent) {
    chips.push(...buildEventChips(entry.latestToolEvent, { durationPosition: "after-file", evidenceFilePath, evidenceRepoRootSnapshotPath }));
  }
  const childRows = [
    ...entry.entries.map((child) => renderStatusActivity(child)),
    entry.groupedToolEntry ? renderToolActivity(entry.groupedToolEntry, evidenceFilePath, evidenceRepoRootSnapshotPath) : ""
  ].filter(Boolean).join("");
  return [
    `<li class="status-group-item">`,
    `<details class="status-group ${severityClass}" data-status-group-id="${escapeHtml(entry.id)}">`,
    `<summary class="event-row event-status-group-summary" title="${escapeHtml(titleText)}">`,
    `<div class="event-body"><div class="event-main"><span class="event-icon event-status-group-toggle">${renderCodicon("chevron-right")}</span>${summaryEvent.kind === "tool"
      ? renderStatusGroupActionIcon(summaryEvent.displayEvent)
      : `<span class="event-icon event-status-group-action-icon ${summaryEvent.phaseClass}" style="color: ${statusGroupIconColorForStatus(summaryEvent.entry.phase, summaryEvent.entry.running)};" aria-hidden="true">${escapeHtml(panelStatusRowIcon(summaryEvent.entry.phase, summaryEvent.entry.running))}</span>`}<span class="event-label">${escapeHtml(summaryLabel)}</span></div>${noteText ? `<div class="event-note">${escapeHtml(noteText)}</div>` : ""}</div>`,
    `<div class="event-chips">${chips.join("")}</div>`,
    `</summary>`,
    `<ul class="status-group-children">${childRows}</ul>`,
    `</details>`,
    `</li>`
  ].join("");
}

function renderRequestActivity(entry: Extract<PanelActivityEntry, { kind: "request" }>): string {
  const { task, userInput, prominentMetadata, secondaryMetadata } = splitRequestSummary(entry.requestSummary, entry.snapshot);
  const previewSource = userInput ?? task;
  const noteText = summarizeChatProjectionText(userInput?.title)
    || summarizeChatProjectionText(userInput?.value)
    || summarizeChatProjectionText(task?.title)
    || summarizeChatProjectionText(task?.value)
    || "Compact launch parameters for this trace lane.";
  const noteTitleAttribute = previewSource?.title ? ` title="${escapeHtml(previewSource.title)}"` : "";
  const orderedMetadata = orderRequestSummaryItemsForInlineFlow([...prominentMetadata, ...secondaryMetadata]);
  const metadataInlineMarkup = orderedMetadata.length > 0
    ? renderRequestSummaryChips(orderedMetadata, entry.snapshot)
    : "";
  const metadataDetailSections = [...prominentMetadata, ...secondaryMetadata]
    .map((item) => {
      const detailText = renderRequestDetailValue(item);
      return detailText ? renderRequestDetailSection(item.label, detailText) : "";
    })
    .filter(Boolean);
  const detailSections = [
    task?.title?.trim() ? renderRequestDetailSection("Parent Frame", task.title) : "",
    userInput?.title?.trim() ? renderRequestDetailSection("User Input", userInput.title) : "",
    ...metadataDetailSections
  ].filter(Boolean).join("");
  const expandable = detailSections.length > 0;
  const expandableAttributes = expandable ? ` data-request-expandable="true" data-request-id="${escapeHtml(entry.id)}" tabindex="0" role="button" aria-expanded="false"` : "";
  const summaryMarkup = noteText
    ? `<span class="event-summary-inline"><span class="event-summary-preview"${noteTitleAttribute}>${escapeHtml(noteText)}</span>${expandable ? `<span class="event-expand-indicator" aria-hidden="true">▸</span>` : ""}</span>`
    : expandable ? `<span class="event-expand-indicator" aria-hidden="true">▸</span>` : "";
  return [
    `<li class="event-row event-request" title="Traceable input"${expandableAttributes}>`,
    `<div class="event-body event-request-body"><div class="event-main event-request-heading-row"><span class="event-icon">${renderCodicon("mail")}</span><span class="event-label">Input</span>${summaryMarkup}${metadataInlineMarkup}</div>${detailSections ? `<div class="event-request-detail">${detailSections}</div>` : ""}</div>`,
    `</li>`
  ].join("");
}

function renderOutputActivity(entry: Extract<PanelActivityEntry, { kind: "output" }>, evidenceFilePath?: string, evidenceRepoRootSnapshotPath?: string): string {
  const noteText = entry.text.trim();
  const evidencePaths = extractOutputEvidencePaths(noteText);
  const expandable = noteText.length > 0;
  const expandableAttributes = expandable ? ` data-output-expandable="true" data-output-id="${escapeHtml(entry.id)}" tabindex="0" role="button" aria-expanded="false"` : "";
  const summaryMarkup = noteText
    ? `<span class="event-summary-inline"><span class="event-summary-preview">${escapeHtml(noteText)}</span>${expandable ? `<span class="event-expand-indicator" aria-hidden="true">▸</span>` : ""}</span>`
    : expandable ? `<span class="event-expand-indicator" aria-hidden="true">▸</span>` : "";
  const detailSections = [
    noteText ? renderRequestDetailSection("Summary", noteText) : "",
    evidencePaths.length > 0 ? renderDetailSectionMarkup("Evidence Paths", renderPathChipRow(evidencePaths, evidenceFilePath, evidenceRepoRootSnapshotPath, "path")) : ""
  ].filter(Boolean).join("");
  return [
    `<li class="event-row event-output" title="Final output returned to the parent lane"${expandableAttributes}>`,
    `<div class="event-body"><div class="event-main"><span class="event-icon">↩</span><span class="event-label">Output</span>${summaryMarkup}</div>${expandable ? `<div class="event-output-detail">${detailSections}</div>` : ""}</div>`,
    renderActivityMeta(entry.occurredAt, "", []),
    `</li>`
  ].join("");
}

function renderHandoffActivity(entry: Extract<PanelActivityEntry, { kind: "handoff" }>, evidenceFilePath?: string, evidenceRepoRootSnapshotPath?: string): string {
  const detailText = [entry.note.trim(), entry.detail?.trim() || ""].filter(Boolean).join("\n\n");
  const expandable = detailText.length > 0;
  const expandableAttributes = expandable ? ` data-handoff-expandable="true" data-handoff-id="${escapeHtml(entry.id)}" tabindex="0" role="button" aria-expanded="false"` : "";
  const summaryMarkup = entry.summary
    ? `<span class="event-summary-inline"><span class="event-summary-preview">${escapeHtml(entry.summary)}</span>${expandable ? `<span class="event-expand-indicator" aria-hidden="true">▸</span>` : ""}</span>`
    : expandable ? `<span class="event-expand-indicator" aria-hidden="true">▸</span>` : "";
  const metaChips = [
    `<span class="chip chip-handoff-kind" title="Carry package type">${escapeHtml(entry.disposition)}</span>`,
    entry.goalCount > 0 ? `<span class="chip chip-handoff-scope" title="Remaining goals carried forward">${escapeHtml(String(entry.goalCount))} goal${entry.goalCount === 1 ? "" : "s"}</span>` : "",
    entry.questionCount > 0 ? `<span class="chip chip-handoff-scope" title="Open questions carried forward">${escapeHtml(String(entry.questionCount))} question${entry.questionCount === 1 ? "" : "s"}</span>` : "",
    entry.hasNextStart ? `<span class="chip chip-handoff-scope" title="A next suggested start is included">next start</span>` : ""
  ].filter(Boolean);
  const detailSections = [
    entry.note.trim() ? renderRequestDetailSection("Summary", entry.note.trim()) : "",
    entry.nextSuggestedStart ? renderRequestDetailSection("Next Start", entry.nextSuggestedStart) : "",
    entry.remainingGoals && entry.remainingGoals.length > 0 ? renderRequestDetailSection("Remaining Goals", entry.remainingGoals.join("\n")) : "",
    entry.openQuestions && entry.openQuestions.length > 0 ? renderRequestDetailSection("Open Questions", entry.openQuestions.join("\n")) : "",
    entry.constraints && entry.constraints.length > 0 ? renderRequestDetailSection("Constraints", entry.constraints.join("\n")) : "",
    entry.relevantFileAnchors && entry.relevantFileAnchors.length > 0 ? renderDetailSectionMarkup("File Anchors", renderPathChipRow(entry.relevantFileAnchors, evidenceFilePath, evidenceRepoRootSnapshotPath, "file")) : "",
    entry.relevantArtifactAnchors && entry.relevantArtifactAnchors.length > 0 ? renderDetailSectionMarkup("Artifact Anchors", renderPathChipRow(entry.relevantArtifactAnchors, evidenceFilePath, evidenceRepoRootSnapshotPath, "artifact")) : "",
    entry.detail?.trim() ? renderRequestDetailSection("Notes", entry.detail.trim()) : ""
  ].filter(Boolean).join("");
  const detailMarkup = detailSections
    ? `<div class="event-handoff-detail">${detailSections}</div>`
    : "";
  return [
    `<li class="event-row event-handoff" title="Carry state left behind for the next trace lane"${expandableAttributes}>`,
    `<div class="event-body"><div class="event-main"><span class="event-icon">↪</span><span class="event-label">Handoff</span>${summaryMarkup}</div>${detailMarkup}</div>`,
    renderActivityMeta(undefined, "", metaChips),
    `</li>`
  ].join("");
}

function renderSenderAdaptationActivity(entry: Extract<PanelActivityEntry, { kind: "sender-adaptation" }>): string {
  const detailText = [entry.note.trim(), entry.detail?.trim() || ""].filter(Boolean).join("\n\n");
  const expandable = detailText.length > 0;
  const expandableAttributes = expandable ? ` data-handoff-expandable="true" data-handoff-id="${escapeHtml(entry.id)}" tabindex="0" role="button" aria-expanded="false"` : "";
  const summaryMarkup = entry.summary
    ? `<span class="event-summary-inline"><span class="event-summary-preview">${escapeHtml(entry.summary)}</span>${expandable ? `<span class="event-expand-indicator" aria-hidden="true">▸</span>` : ""}</span>`
    : expandable ? `<span class="event-expand-indicator" aria-hidden="true">▸</span>` : "";
  const metaChips = [
    `<span class="chip chip-handoff-kind" title="Unique sender identities observed in this chain">${escapeHtml(String(entry.senderCount))} sender${entry.senderCount === 1 ? "" : "s"}</span>`,
    `<span class="chip chip-handoff-scope" title="Total bounded receiver-adaptation claims currently stored">${escapeHtml(String(entry.claimCount))} claim${entry.claimCount === 1 ? "" : "s"}</span>`,
    entry.reinforcedCount > 0 ? `<span class="chip chip-handoff-scope" title="Claims reinforced by repeated observation in this chain">${escapeHtml(String(entry.reinforcedCount))} reinforced</span>` : ""
  ].filter(Boolean);
  const detailSections = [
    entry.note.trim() ? renderRequestDetailSection("Summary", entry.note.trim()) : "",
    entry.detail?.trim() ? renderRequestDetailSection("Observed Claims", entry.detail.trim()) : ""
  ].filter(Boolean).join("");
  return [
    `<li class="event-row event-handoff" title="Chain-local receiver adaptation observed for known senders"${expandableAttributes}>`,
    `<div class="event-body"><div class="event-main"><span class="event-icon">◎</span><span class="event-label">Sender State</span>${summaryMarkup}</div>${detailSections ? `<div class="event-handoff-detail">${detailSections}</div>` : ""}</div>`,
    renderActivityMeta(undefined, "", metaChips),
    `</li>`
  ].join("");
}

function summarizeToolOutputHeading(toolName: string): string {
  switch (toolName.trim()) {
    case "copilot_readFile":
      return "Read Content";
    case "copilot_fileSearch":
    case "grep_search":
      return "Matches";
    case "list_dir":
      return "Directory Listing";
    case "get_errors":
      return "Diagnostics";
    default:
      return "Output";
  }
}

function renderToolRawDisclosure(label: string, value: string, truncated = false): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return [
    `<details class="event-raw-disclosure">`,
    `<summary class="event-raw-summary">${escapeHtml(label)}${truncated ? `<span class="event-raw-summary-note"> truncated</span>` : ""}</summary>`,
    `<pre class="event-raw-block">${escapeHtml(trimmed)}</pre>`,
    `</details>`
  ].join("");
}

function renderCopyValueButton(options: {
  sourceId?: string;
  value?: string;
  label: string;
}): string {
  const sourceId = options.sourceId?.trim();
  const value = options.value?.trim();
  if (!sourceId && !value) {
    return "";
  }
  const sourceAttribute = sourceId ? ` data-copy-source-id="${escapeHtml(sourceId)}"` : "";
  const valueAttribute = !sourceId && value ? ` data-copy-value="${escapeHtml(value)}"` : "";
  return `<button class="event-tool-section-copy" type="button"${sourceAttribute}${valueAttribute} data-copy-label="${escapeHtml(options.label)}" title="Copy ${escapeHtml(options.label).toLowerCase()}">Copy</button>`;
}

function tryParseJsonText(value: string): unknown | undefined {
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function renderJsonHighlightedMarkup(value: unknown, attributes = ""): string {
  const json = JSON.stringify(value, null, 2);
  const tokenPattern = /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"\s*:?)|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let cursor = 0;
  let markup = "";
  for (const match of json.matchAll(tokenPattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > cursor) {
      markup += escapeHtml(json.slice(cursor, index));
    }
    let className = "event-json-number";
    if (token.endsWith(":")) {
      className = "event-json-key";
    } else if (token.startsWith("\"")) {
      className = "event-json-string";
    } else if (token === "true" || token === "false") {
      className = "event-json-boolean";
    } else if (token === "null") {
      className = "event-json-null";
    }
    markup += `<span class="${className}">${escapeHtml(token)}</span>`;
    cursor = index + token.length;
  }
  if (cursor < json.length) {
    markup += escapeHtml(json.slice(cursor));
  }
  return `<pre class="event-raw-block event-json-block"${attributes}>${markup}</pre>`;
}

function renderStructuredValueMarkup(value: string, attributes = ""): string {
  const parsed = tryParseJsonText(value);
  if (parsed !== undefined) {
    return renderJsonHighlightedMarkup(parsed, attributes);
  }
  return `<pre class="event-raw-block"${attributes}>${escapeHtml(value)}</pre>`;
}

function renderToolSectionDisclosure(
  label: string,
  bodyMarkup: string,
  attributes = "",
  summaryNote?: string,
  copyButtonMarkup = ""
): string {
  return [
    `<details class="event-tool-section-disclosure"${attributes}>`,
    `<summary class="event-tool-section-summary"><span class="event-tool-section-summary-label">${escapeHtml(label)}</span><span class="event-expand-indicator" aria-hidden="true">▸</span>${summaryNote ? `<span class="event-tool-section-summary-note">${escapeHtml(summaryNote)}</span>` : ""}<span class="event-tool-section-summary-spacer"></span>${copyButtonMarkup}</summary>`,
    `<div class="event-tool-section-body">${bodyMarkup}</div>`,
    `</details>`
  ].join("");
}

function buildUnavailableToolDetail(event: PanelToolEvent): PanelLoadedToolDetail {
  return {
    callId: event.callId,
    toolName: event.toolName,
    phase: event.phase,
    input: event.input,
    note: event.note,
    outputSummary: event.phase === "running"
      ? "This tool call is still running."
      : "No captured tool output is available for this call.",
    partKinds: []
  };
}

function renderToolOutputDetail(
  event: PanelDisplayEvent,
  detail: PanelLoadedToolDetail | undefined
): string {
  const sections: string[] = [];
  let summaryNote: string | undefined;
  let copySourceId: string | undefined;
  let copyValue: string | undefined;
  if (event.running) {
    sections.push(renderRequestDetailSection("Status", "Waiting for the tool to finish."));
    summaryNote = "Pending";
  } else if (!detail) {
    sections.push(`<div class="event-tool-loading"><span class="event-tool-loading-spinner" aria-hidden="true"></span><span>Loading output...</span></div>`);
  } else {
    if (detail.outputKind?.trim()) {
      sections.push(renderRequestDetailSection("Kind", detail.outputKind.trim()));
    }
    if (detail.outputSummary?.trim()) {
      sections.push(renderRequestDetailSection(summarizeToolOutputHeading(event.event.toolName), detail.outputSummary.trim()));
    }
    if (detail.outputMetadataSummary?.trim()) {
      sections.push(renderRequestDetailSection("Data", detail.outputMetadataSummary.trim()));
    }
    if (detail.partKinds && detail.partKinds.length > 0) {
      sections.push(renderRequestDetailSection("Parts", detail.partKinds.join("\n")));
    }
    if (detail.note?.trim() && detail.note.trim() !== event.note?.trim()) {
      sections.push(renderRequestDetailSection("Tool Note", detail.note.trim()));
    }
    if (detail.rawOutput?.trim()) {
      copySourceId = `tool-output-${event.event.callId}`;
      copyValue = detail.rawOutput.trim();
      sections.push(renderStructuredValueMarkup(detail.rawOutput, ` id="${escapeHtml(copySourceId)}"`));
    }
    if (sections.length === 0) {
      sections.push(renderRequestDetailSection("Output", "No additional tool output was captured for this call."));
    }
    if (!copyValue) {
      copyValue = detail.outputSummary?.trim() || detail.note?.trim();
    }
    summaryNote = detail.rawOutputTruncated === true ? "Truncated" : undefined;
  }
  return renderToolSectionDisclosure(
    "Output",
    sections.join(""),
    ` data-tool-output-disclosure="true" data-tool-output-id="${escapeHtml(event.event.callId)}" data-tool-output-needs-load="${!event.running && !detail ? "true" : "false"}"`,
    summaryNote,
    renderCopyValueButton({ sourceId: copySourceId, value: copyValue, label: "output" })
  );
}

function renderToolDetailSections(
  event: PanelDisplayEvent,
  evidenceFilePath?: string,
  evidenceRepoRootSnapshotPath?: string,
  detail?: PanelLoadedToolDetail
): string {
  const detailSections: string[] = [];
  detailSections.push(renderRequestDetailSection("Tool", humanizeToolName(event.event.toolName)));
  detailSections.push(renderRequestDetailSection("Outcome", event.outcome));
  if (event.note?.trim()) {
    detailSections.push(renderRequestDetailSection("Note", event.note.trim()));
  }
  if (event.filePath) {
    detailSections.push(renderDetailSectionMarkup(
      "Target",
      renderPathChipRow([event.filePath], evidenceFilePath, evidenceRepoRootSnapshotPath, "path")
    ));
  }
  if (event.ranges.length > 0) {
    detailSections.push(renderRequestDetailSection(
      "Ranges",
      event.ranges.map((range) => `${range.startLine}-${range.endLine}`).join("\n")
    ));
  }
  if (event.count > 1) {
    detailSections.push(renderRequestDetailSection("Merged Calls", String(event.count)));
  }
  if (event.event.input && Object.keys(event.event.input).length > 0) {
    const inputSourceId = `tool-input-${event.event.callId}`;
    detailSections.push(renderToolSectionDisclosure(
      "Input",
      renderJsonHighlightedMarkup(event.event.input, ` id="${escapeHtml(inputSourceId)}"`),
      ` data-tool-input-disclosure="true" data-tool-input-id="${escapeHtml(event.event.callId)}"`,
      undefined,
      renderCopyValueButton({
        sourceId: inputSourceId,
        value: JSON.stringify(event.event.input, null, 2),
        label: "input"
      })
    ));
  }
  detailSections.push(renderToolOutputDetail(event, detail));
  return detailSections.join("");
}

function renderToolActivity(
  entry: Extract<PanelActivityEntry, { kind: "tool" }>,
  evidenceFilePath?: string,
  evidenceRepoRootSnapshotPath?: string,
  loadedDetailByCallId: ReadonlyMap<string, PanelLoadedToolDetail> = new Map()
): string {
  const event = entry.displayEvent;
  const title = (event.note ?? "") || event.event.toolName;
  const noteRow = event.note ? `<div class="event-note">${escapeHtml(event.note)}</div>` : "";
  const detailSections = renderToolDetailSections(event, evidenceFilePath, evidenceRepoRootSnapshotPath, loadedDetailByCallId.get(event.event.callId));
  const expandable = detailSections.length > 0;
  const expandableAttributes = expandable ? ` data-tool-expandable="true" data-tool-id="${escapeHtml(entry.id)}" tabindex="0" role="button" aria-expanded="false"` : "";
  const durationMarkup = renderActivityDuration(
    event.running ? "Live" : "For",
    event.baseElapsedMs,
    event.occurredAt,
    event.running,
    event.running ? "Current tool duration" : "Recorded tool duration"
  );
  return [
    `<li class="event-row event-tool event-kind-${event.kind.toLowerCase()} event-outcome-${event.outcome}" title="${escapeHtml(title)}"${expandableAttributes}>`,
    `<div class="event-body"><button class="event-main event-tool-main-toggle" type="button" data-tool-toggle-id="${escapeHtml(entry.id)}"><span class="event-icon">${escapeHtml(eventIcon(event))}</span><span class="event-label">${escapeHtml(eventLabel(event))}</span>${expandable ? `<span class="event-summary-inline"><span class="event-expand-indicator" aria-hidden="true">▸</span></span>` : ""}</button>${noteRow}${expandable ? `<div class="event-tool-detail">${detailSections}</div>` : ""}</div>`,
    renderActivityMeta(event.occurredAt, durationMarkup, buildEventChips(event, {
      evidenceFilePath,
      evidenceRepoRootSnapshotPath,
      includeDurationChip: event.count > 1
    })),
    "</li>"
  ].join("");
}

function renderActivityRow(entry: PanelRenderedEntry, evidenceFilePath?: string, evidenceRepoRootSnapshotPath?: string): string {
  if (entry.kind === "status-group") {
    return renderStatusGroupActivity(entry, evidenceFilePath, evidenceRepoRootSnapshotPath);
  }
  if (entry.kind === "ancestor") {
    return renderAncestorActivity(entry);
  }
  if (entry.kind === "lineage-warning") {
    return renderLineageWarningActivity(entry);
  }
  if (entry.kind === "request") {
    return renderRequestActivity(entry);
  }
  if (entry.kind === "status") {
    return renderStatusActivity(entry);
  }
  if (entry.kind === "output") {
    return renderOutputActivity(entry, evidenceFilePath, evidenceRepoRootSnapshotPath);
  }
  if (entry.kind === "sender-adaptation") {
    return renderSenderAdaptationActivity(entry);
  }
  if (entry.kind === "handoff") {
    return renderHandoffActivity(entry, evidenceFilePath, evidenceRepoRootSnapshotPath);
  }
  return renderToolActivity(entry, evidenceFilePath, evidenceRepoRootSnapshotPath);
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

const NATIVE_TOOL_NAMESPACE_TOKENS = new Set([
  "agent",
  "browser",
  "edit",
  "execute",
  "other",
  "read",
  "search",
  "todo",
  "vscode",
  "web"
]);

function isCustomToolReference(toolName: string): boolean {
  const trimmed = toolName.trim();
  if (!trimmed) {
    return false;
  }
  if (!trimmed.includes("/")) {
    return false;
  }
  const namespaceToken = trimmed.slice(0, trimmed.indexOf("/")).trim().toLowerCase();
  return !NATIVE_TOOL_NAMESPACE_TOKENS.has(namespaceToken);
}

function renderHeaderBadgeIcon(icon: string | undefined): string {
  return icon ? `<span class="header-badge-icon">${renderCodicon(icon)}</span>` : "";
}

function renderHeaderBadge(label: string, value: string, className?: string, title?: string, icon?: string, messagePayload?: Record<string, unknown>): string {
  const classes = ["header-badge", className].filter(Boolean).join(" ");
  const resolvedTitle = title ?? `${label}: ${value}`;
  const titleAttribute = resolvedTitle ? ` title="${escapeHtml(resolvedTitle)}"` : "";
  const dataMessageAttribute = messagePayload ? ` data-message="${escapeHtml(JSON.stringify(messagePayload))}"` : "";
  const tagName = messagePayload ? "button" : "span";
  const typeAttribute = messagePayload ? ` type="button"` : "";
  return [
    `<${tagName} class="${classes}"${typeAttribute}${titleAttribute}${dataMessageAttribute}>`,
    `<span class="header-badge-label">${escapeHtml(label)}</span>`,
    `<span class="header-badge-value">${renderHeaderBadgeIcon(icon)}${escapeHtml(value)}</span>`,
    `</${tagName}>`
  ].join("");
}

function renderHeaderMetadataBadges(snapshot: TraceableSubagentDetailSnapshot): string {
  const badges: string[] = [];
  if (snapshot.header.candidate) {
    badges.push(renderHeaderBadge("Track", "Candidate", "header-badge-track-candidate"));
  }
  if (snapshot.header.experimental) {
    badges.push(renderHeaderBadge("Track", "Experimental", "header-badge-track-experimental"));
  }
  return badges.join("");
}

function isImplicitTraceLane(snapshot: TraceableSubagentDetailSnapshot): boolean {
  return !snapshot.header.agentResolved
    && !(snapshot.header.agentFilePath ?? "").trim()
    && (snapshot.header.agentName ?? "").trim() === "Trace lane";
}

function renderRoleBadge(snapshot: TraceableSubagentDetailSnapshot): string {
  if (isImplicitTraceLane(snapshot)) {
    return "";
  }
  const isHuman = snapshot.header.humanRole;
  const isResolved = snapshot.header.agentResolved;
  const title = isResolved
    ? snapshot.header.agentFilePath
      ? `${isHuman ? "Human role" : "AI role"}\n${snapshot.header.agentFilePath}`
      : (isHuman ? "Human role" : "AI role")
    : `Requested ${isHuman ? "human" : "AI"} role\nNot yet resolved to a workspace .agent.md artifact.`;
  const className = `${isHuman ? "header-badge-role-human" : "header-badge-role-ai"} ${isResolved ? "header-badge-role-resolved" : "header-badge-role-pending"}`;
  const value = isResolved ? snapshot.header.agentName : `${snapshot.header.agentName} (requested)`;
  return renderHeaderBadge(
    "Role",
    value,
    className,
    title,
    isHuman ? "account" : "hubot",
    isResolved && snapshot.header.agentFilePath ? { type: "openFile", filePath: snapshot.header.agentFilePath } : undefined
  );
}

function metaStatusClass(phase: TraceableSubagentDetailSnapshot["status"]["phase"]): string {
  return `meta-status meta-status-${phase}`;
}

function renderMetaStatus(snapshot: TraceableSubagentDetailSnapshot): string {
  return `<span class="${metaStatusClass(snapshot.status.phase)}" title="${escapeHtml(snapshot.status.message)}">${escapeHtml(panelStatusIcon(snapshot.status.phase))} ${escapeHtml(snapshot.status.message)}</span>`;
}

function builtInToolNamespace(toolName: string): string {
  switch (normalizeToolBadgeKey(toolName)) {
    case "run_subagent":
    case "run_traceable_subagent":
      return "agent";
    case "fetch_webpage":
      return "web";
    case "manage_todo_list":
      return "todo";
    case "read_file":
    case "list_directory":
    case "view_image":
      return "read";
    case "find_text_in_files":
    case "text_search":
    case "find_files":
    case "file_search":
    case "semantic_search":
    case "vscode_list_code_usages":
      return "search";
    case "apply_patch":
    case "create_file":
    case "vscode_rename_symbol":
      return "edit";
    case "run_in_terminal":
    case "run_in_terminal_command":
    case "send_to_terminal":
    case "get_terminal_output":
    case "kill_terminal":
      return "execute";
    case "vscode_ask_questions":
    case "get_errors":
      return "vscode";
    default:
      return "other";
  }
}

function toolsetNamespaceParts(rawName: string, isCustom: boolean): { namespacePath: string[]; displayName: string } {
  const trimmed = rawName.trim();
  const slashIndex = trimmed.lastIndexOf("/");
  if (slashIndex >= 0) {
    const displayName = normalizeToolReferenceKey(trimmed);
    const namespace = trimmed.slice(0, slashIndex).trim();
    if (namespace) {
      const namespacePath = isCustom
        ? namespace.split(".").map((part) => part.trim()).filter(Boolean)
        : [namespace];
      return {
        namespacePath: namespacePath.length > 0 ? namespacePath : [namespace],
        displayName
      };
    }
  }
  const displayName = normalizeToolBadgeKey(trimmed) || normalizeToolReferenceKey(trimmed);
  return {
    namespacePath: [isCustom ? "custom" : builtInToolNamespace(displayName)],
    displayName
  };
}

function buildToolsetNamespaceGroups(rawItems: string[], isCustom: boolean): ToolsetNamespaceGroup[] {
  const groups: ToolsetNamespaceGroup[] = [];
  const getOrCreateGroup = (collection: ToolsetNamespaceGroup[], namespace: string): ToolsetNamespaceGroup => {
    let group = collection.find((entry) => entry.namespace === namespace);
    if (!group) {
      group = { namespace, childGroups: [], items: [] };
      collection.push(group);
    }
    return group;
  };
  for (const rawItem of rawItems) {
    const trimmed = rawItem.trim();
    if (!trimmed) {
      continue;
    }
    const parts = toolsetNamespaceParts(trimmed, isCustom);
    const iconName = toolBadgeIcon(parts.displayName) ?? (isCustom ? "tools" : "gear");
    let level = groups;
    let group: ToolsetNamespaceGroup | undefined;
    for (const namespacePart of parts.namespacePath) {
      group = getOrCreateGroup(level, namespacePart);
      level = group.childGroups;
    }
    if (!group) {
      continue;
    }
    if (!group.items.some((item) => item.rawName === trimmed)) {
      group.items.push({
        rawName: trimmed,
        displayName: parts.displayName,
        iconName,
        matchKeys: expandToolReferenceKeys(trimmed)
      });
    }
  }
  return groups;
}

function countToolsetGroupItems(group: ToolsetNamespaceGroup): number {
  return group.items.length + group.childGroups.reduce((total, childGroup) => total + countToolsetGroupItems(childGroup), 0);
}

function summarizeNamespaceRuntime(group: ToolsetNamespaceGroup, snapshot: TraceableSubagentDetailSnapshot): ToolRuntimeSummary {
  return combineRuntimeSummaries([
    ...group.items.map((item) => summarizeToolRuntime(item, snapshot)),
    ...group.childGroups.map((childGroup) => summarizeNamespaceRuntime(childGroup, snapshot))
  ], snapshot);
}

function renderToolsetItem(item: ToolsetListItem, snapshot: TraceableSubagentDetailSnapshot, isLast = false): string {
  const runtime = summarizeToolRuntime(item, snapshot);
  const runtimeBadges = renderToolRuntimeBadges(runtime);
  const lastClass = isLast ? " toolset-node-last" : "";
  return [
    `<li class="toolset-item toolset-tree-node toolset-runtime-${runtime.status}${lastClass}" title="${escapeHtml(item.rawName)}">`,
    `<span class="toolset-item-branch" aria-hidden="true"></span>`,
    `<span class="toolset-item-icon">${renderCodicon(item.iconName)}</span>`,
    `<span class="toolset-item-label">${escapeHtml(item.displayName)}</span>`,
    runtimeBadges ? `<span class="toolset-item-runtime">${runtimeBadges}</span>` : "",
    `</li>`
  ].join("");
}

function renderToolsetNamespaceGroup(
  group: ToolsetNamespaceGroup,
  snapshot: TraceableSubagentDetailSnapshot,
  isLast = false,
  ancestry: string[] = []
): string {
  const runtime = summarizeNamespaceRuntime(group, snapshot);
  const lastClass = isLast ? " toolset-node-last" : "";
  const namespacePath = [...ancestry, group.namespace];
  const namespaceId = namespacePath.join("/");
  const defaultOpen = runtime.callCount > 0 ? "true" : "false";
  const renderedChildGroups = group.childGroups.map((childGroup, index) => renderToolsetNamespaceGroup(
    childGroup,
    snapshot,
    group.items.length === 0 && index === group.childGroups.length - 1,
    namespacePath
  ));
  const renderedItems = group.items.length > 0
    ? `<ul class="toolset-list toolset-list-nested">${group.items.map((item, index) => renderToolsetItem(item, snapshot, index === group.items.length - 1)).join("")}</ul>`
    : "";
  const childContent = [
    ...renderedChildGroups,
    renderedItems
  ].join("");
  return [
    `<details class="toolset-namespace-group toolset-tree-node toolset-runtime-${runtime.status}${lastClass}" data-namespace-id="${escapeHtml(namespaceId)}" data-default-open="${defaultOpen}">`,
    `<summary class="toolset-namespace-heading"><span class="toolset-namespace-heading-main"><span class="toolset-namespace-branch" aria-hidden="true"></span><span class="toolset-namespace-twistie">${renderCodicon("chevron-right")}</span><span class="toolset-namespace-label">${escapeHtml(group.namespace)}</span></span><span class="toolset-namespace-metrics">${renderToolRuntimeBadges(runtime)}<span class="toolset-count" title="${escapeHtml(String(countToolsetGroupItems(group)))} selected tools">${countToolsetGroupItems(group)}</span></span></summary>`,
    `<div class="toolset-tree-children">${childContent}</div>`,
    `</details>`
  ].join("");
}

function renderToolsetColumn(
  label: string,
  count: number,
  groups: ToolsetNamespaceGroup[],
  snapshot: TraceableSubagentDetailSnapshot
): string {
  const hasTree = groups.length > 0;
  return [
    `<section class="toolset-column${hasTree ? "" : " toolset-column-empty"}">`,
    `<div class="toolset-root-heading"><span class="toolset-root-heading-main"><span class="toolset-root-label">${escapeHtml(label)}</span></span><span class="toolset-count">${count}</span></div>`,
    hasTree
      ? `<div class="toolset-tree-children toolset-tree-children-root">${groups.map((group, index) => renderToolsetNamespaceGroup(group, snapshot, index === groups.length - 1, [label])).join("")}</div>`
      : `<div class="toolset-empty">None</div>`,
    `</section>`
  ].join("");
}

function renderToolsetDisclosure(snapshot: TraceableSubagentDetailSnapshot): string {
  const declaredToolset = snapshot.header.toolsetNames.filter((value) => value.trim().length > 0);
  const observedToolset: string[] = [];
  for (const event of snapshot.recentTools) {
    const trimmed = event.toolName.trim();
    if (!trimmed || observedToolset.includes(trimmed)) {
      continue;
    }
    observedToolset.push(trimmed);
  }
  const rawToolset = declaredToolset.length > 0 ? declaredToolset : observedToolset;
  if (rawToolset.length === 0) {
    return "";
  }
  const nativeTools = rawToolset.filter((value) => !isCustomToolReference(value));
  const customTools = rawToolset.filter((value) => isCustomToolReference(value));
  const nativeGroups = buildToolsetNamespaceGroups(nativeTools, false);
  const customGroups = buildToolsetNamespaceGroups(customTools, true);
  const summaryLabel = declaredToolset.length > 0 ? "Tool access" : "Observed tools";
  const summary = `${summaryLabel} ${rawToolset.length} total${customTools.length > 0 ? ` · ${customTools.length} custom` : ""}`;
  return [
    `<details class="toolset-disclosure">`,
    `<summary class="toolset-summary">${escapeHtml(summary)}</summary>`,
    `<div class="toolset-grid">`,
    renderToolsetColumn("Native Tools", nativeTools.length, nativeGroups, snapshot),
    renderToolsetColumn("Extension Tools", customTools.length, customGroups, snapshot),
    `</div>`,
    `</details>`
  ].join("");
}

function renderEventRow(event: PanelDisplayEvent): string {
  const kind = event.kind;
  const note = event.note ?? "";
  const chips = buildEventChips(event).join("");
  const title = note || event.event.toolName;
  const noteRow = note ? `<div class="event-note">${escapeHtml(note)}</div>` : "";
  return [
    `<li class="event-row event-tool event-kind-${kind.toLowerCase()} event-outcome-${event.outcome}" title="${escapeHtml(title)}">`,
    `<div class="event-body"><div class="event-main"><span class="event-icon">${escapeHtml(eventIcon(event))}</span><span class="event-label">${escapeHtml(eventLabel(event))}</span></div>${noteRow}</div>`,
    `<div class="event-chips">${chips}</div>`,
    "</li>"
  ].join("");
}

function renderMetaStopwatch(
  label: string,
  value: string,
  dataset: Record<string, string | undefined>,
  title: string
): string {
  const toDataAttributeName = (key: string): string => key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
  const dataAttributes = Object.entries(dataset)
    .filter(([, rawValue]) => typeof rawValue === "string" && rawValue.length > 0)
    .map(([key, rawValue]) => ` data-${toDataAttributeName(key)}="${escapeHtml(rawValue!)}"`)
    .join("");
  return `<span class="meta-stopwatch"${dataAttributes} title="${escapeHtml(title)}"><span class="meta-stopwatch-label">${escapeHtml(label)}</span><span class="meta-stopwatch-value">${escapeHtml(value)}</span></span>`;
}

function renderPanelEmptyState(snapshot: TraceableSubagentDetailSnapshot): string {
  const title = snapshot.status.phase === "running"
    ? "Preparing trace lane"
    : "Waiting for a trace run";
  const copy = snapshot.status.phase === "running"
    ? "TRACEABLE opened before the first activity landed. Live updates will appear here as soon as the run starts recording."
    : "Start a TRACEABLE run, or reopen one from the status bar, to inspect live activity, tool usage, and the final child output here.";
  return [
    `<div class="empty-state">`,
    `<div class="empty-state-title">${escapeHtml(title)}</div>`,
    `<div class="empty-state-copy">${escapeHtml(copy)}</div>`,
    `</div>`
  ].join("");
}

function summarizeChatProjectionText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function extractChatProjectionRequestTexts(snapshot: TraceableSubagentDetailSnapshot): {
  taskInput?: string;
  userInput?: string;
} {
  const { task, userInput } = splitRequestSummary(snapshot.requestSummary, snapshot);
  return {
    taskInput: summarizeChatProjectionText(task?.title) || summarizeChatProjectionText(task?.value),
    userInput: summarizeChatProjectionText(userInput?.title) || summarizeChatProjectionText(userInput?.value)
  };
}

function extractChatProjectionOutputText(snapshot: TraceableSubagentDetailSnapshot): string | undefined {
  return snapshot.status.detail?.trim()
    || snapshot.resultSummary?.finalSummary?.trim()
    || undefined;
}

function extractChatProjectionRequestTextsFromSummary(summary: PanelRequestSummaryItem[]): {
  taskInput?: string;
  userInput?: string;
} {
  let taskInput: string | undefined;
  let userInput: string | undefined;
  for (const item of summary) {
    const normalizedLabel = item.label.trim().toLowerCase();
    const text = summarizeChatProjectionText(item.title) || summarizeChatProjectionText(item.value);
    if (!text) {
      continue;
    }
    if (!taskInput && (normalizedLabel === "task" || normalizedLabel === "parent frame")) {
      taskInput = text;
      continue;
    }
    if (!userInput && normalizedLabel === "user input") {
      userInput = text;
    }
  }
  return { taskInput, userInput };
}

function extractChatProjectionLineageOutputText(entry: NonNullable<TraceableSubagentDetailSnapshot["lineageEntries"]>[number]): string | undefined {
  return summarizeChatProjectionText(entry.status?.detail)
    || summarizeChatProjectionText(entry.resultSummary?.finalSummary)
    || summarizeChatProjectionText(entry.finalSummary)
    || undefined;
}

function renderChatProjectionTimestamp(options: {
  occurredAt?: string;
  updatedAt?: string;
  running?: boolean;
}): string {
  const label = formatChatHeaderTimestamp(options.occurredAt, options.running === true, options.updatedAt);
  if (!label) {
    return "";
  }
  const title = formatPanelAbsoluteTimestamp(options.updatedAt || options.occurredAt) || formatPanelClockTime(options.updatedAt || options.occurredAt);
  return `<span class="chat-message-time" data-chat-timestamp="true" data-occurred-at="${escapeHtml(options.occurredAt || "")}" data-updated-at="${escapeHtml(options.updatedAt || "")}" data-running="${options.running === true ? "true" : "false"}" title="${escapeHtml(title || label)}">${escapeHtml(label)}</span>`;
}

function renderChatProjectionMessage(options: {
  label: string;
  text: string;
  role: "task" | "input" | "output";
  occurredAt?: string;
  updatedAt?: string;
  running?: boolean;
}): string {
  const timestampMarkup = renderChatProjectionTimestamp({
    occurredAt: options.occurredAt,
    updatedAt: options.updatedAt,
    running: options.running
  });
  return [
    `<section class="chat-message chat-message-${escapeHtml(options.role)}">`,
    `<div class="chat-message-header">`,
    `<div class="chat-message-label-row"><div class="chat-message-label">${escapeHtml(options.label)}</div></div>`,
    timestampMarkup,
    `</div>`,
    `<div class="chat-message-bubble">${escapeHtml(options.text)}</div>`,
    `</section>`
  ].join("");
}

function formatChatProjectionUserInputLabel(summary: PanelRequestSummaryItem[]): string {
  const directParentRoles = extractDirectParentRolesFromRequestSummary(summary)
    .map((role) => role.replace(/\s*\([^)]*\)\s*/gu, " ").replace(/\s+/gu, " ").trim())
    .filter(Boolean);
  return directParentRoles.length > 0 ? directParentRoles.join(", ") : "User";
}

function formatChatProjectionOutputLabel(header: TraceableSubagentDetailSnapshot["header"] | NonNullable<TraceableSubagentDetailSnapshot["lineageEntries"]>[number]["header"]): string {
  const displayRole = header?.agentName
    ?.replace(/\s*\([^)]*\)\s*/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return displayRole && displayRole.toLowerCase() !== "trace lane" ? displayRole : "Output";
}

function renderChatTraceSeparator(title: string, filePath?: string, clickable = true): string {
  const trimmed = title.trim();
  if (!trimmed) {
    return "";
  }
  const messagePayload = clickable && filePath?.trim()
    ? ` data-message='${escapeHtml(JSON.stringify({ type: "openFile", filePath: filePath.trim() }))}'`
    : "";
  const titleMarkup = messagePayload
    ? `<button class="chat-trace-separator-title" type="button"${messagePayload} title="${escapeHtml(filePath?.trim() ? `Open ${trimmed}` : trimmed)}">${escapeHtml(trimmed)}</button>`
    : `<span class="chat-trace-separator-title chat-trace-separator-title-static" title="${escapeHtml(trimmed)}">${escapeHtml(trimmed)}</span>`;
  return [
    `<div class="chat-trace-separator" role="presentation">`,
    `<span class="chat-trace-separator-title-wrap">`,
    titleMarkup,
    `</span>`,
    `</div>`
  ].join("");
}

function renderChatLineageBanner(snapshot: TraceableSubagentDetailSnapshot): string {
  const warning = getBrokenLineageWarning(snapshot);
  const evidenceFilePath = snapshot.evidenceFile?.filePath?.trim();
  if (!warning) {
    return "";
  }
  const repairPayload = evidenceFilePath
    ? ` data-message='${escapeHtml(JSON.stringify({ type: "repairTraceLineage", filePath: evidenceFilePath }))}'`
    : "";
  return [
    `<section class="chat-lineage-banner">`,
    `<div class="chat-lineage-banner-copy">`,
    `<div class="chat-lineage-banner-title">Broken Lineage</div>`,
    `<div class="chat-lineage-banner-note">${escapeHtml(warning.note)}</div>`,
    warning.detail ? `<div class="chat-lineage-banner-detail">${escapeHtml(warning.detail)}</div>` : "",
    `</div>`,
    repairPayload ? `<button class="toolbar-button toolbar-button-warning" type="button"${repairPayload} title="Repair the current trace lineage">Repair</button>` : "",
    `</section>`
  ].join("");
}

function renderChatProjectionAncestorMessage(entry: NonNullable<TraceableSubagentDetailSnapshot["lineageEntries"]>[number]): string {
  const { taskInput, userInput } = extractChatProjectionRequestTextsFromSummary(entry.requestSummary ?? []);
  const outputText = extractChatProjectionLineageOutputText(entry);
  const userInputLabel = formatChatProjectionUserInputLabel(entry.requestSummary ?? []);
  const outputLabel = formatChatProjectionOutputLabel(entry.header);
  const running = entry.status?.phase === "running";
  const occurredAt = entry.startedAt ?? entry.occurredAt;
  const updatedAt = entry.updatedAt ?? entry.occurredAt;
  return [
    renderChatTraceSeparator(entry.title, entry.filePath, true),
    taskInput
      ? renderChatProjectionMessage({
        label: "Task",
        text: taskInput,
        role: "task",
        occurredAt,
        running
      })
      : "",
    userInput
      ? renderChatProjectionMessage({
        label: userInputLabel,
        text: userInput,
        role: "input",
        occurredAt,
        running
      })
      : "",
    outputText
      ? renderChatProjectionMessage({
        label: outputLabel,
        text: outputText,
        role: "output",
        occurredAt: updatedAt,
        updatedAt,
        running
      })
      : "",
    (!taskInput && !userInput && !outputText)
      ? renderChatProjectionMessage({
        label: outputLabel,
        text: "Earlier trace in this continuation chain.",
        role: "output",
        occurredAt: updatedAt,
        updatedAt,
        running
      })
      : ""
  ].filter(Boolean).join("");
}

function renderChatProjection(snapshot: TraceableSubagentDetailSnapshot): string {
  const sections: string[] = [];
  const lineageBanner = renderChatLineageBanner(snapshot);
  if (lineageBanner) {
    sections.push(lineageBanner);
  }
  for (const lineageEntry of snapshot.lineageEntries ?? []) {
    sections.push(renderChatProjectionAncestorMessage(lineageEntry));
  }
  const { taskInput, userInput } = extractChatProjectionRequestTexts(snapshot);
  const userInputLabel = formatChatProjectionUserInputLabel(snapshot.requestSummary);
  const outputLabel = formatChatProjectionOutputLabel(snapshot.header);
  const outputText = extractChatProjectionOutputText(snapshot);
  if (snapshot.evidenceFile?.fileName?.trim()) {
    sections.push(renderChatTraceSeparator(snapshot.evidenceFile.fileName.trim(), snapshot.evidenceFile.filePath, false));
  }
  if (taskInput) {
    sections.push(renderChatProjectionMessage({
      label: "Task",
      text: taskInput,
      role: "task",
      occurredAt: snapshot.startedAt,
      running: snapshot.status.phase === "running"
    }));
  }
  if (userInput) {
    sections.push(renderChatProjectionMessage({
      label: userInputLabel,
      text: userInput,
      role: "input",
      occurredAt: snapshot.startedAt,
      running: snapshot.status.phase === "running"
    }));
  }
  if (outputText) {
    sections.push(renderChatProjectionMessage({
      label: outputLabel,
      text: outputText,
      role: "output",
      occurredAt: snapshot.updatedAt,
      updatedAt: snapshot.updatedAt,
      running: snapshot.status.phase === "running"
    }));
  }
  if (sections.length === 0) {
    return `<div class="chat-thread">${renderPanelEmptyState(snapshot)}</div>`;
  }
  return `<div class="chat-thread">${sections.join("")}</div>`;
}

function renderChatComposer(
  snapshot: TraceableSubagentDetailSnapshot,
  chatSenderRoleOptions: ReadonlyArray<PanelChatSenderRoleOption> = [],
  chatCollapseMode: "auto" | "always" = "auto"
): string {
  const traceFilePath = snapshot.evidenceFile?.filePath?.trim() || "";
  const traceFilePathAttribute = escapeHtml(traceFilePath);
  const evidenceFileStatus = snapshot.evidenceFile?.status;
  const running = snapshot.status.phase === "running";
  const canSubmit = traceFilePath.length > 0 && !running;
  const senderOptionsMarkup = [
    `<button class="chat-composer-sender-option" type="button" role="option" data-chat-sender-option="true" data-value="" data-label=""><span class="chat-composer-sender-option-label">&nbsp;</span></button>`,
    ...chatSenderRoleOptions.map((roleOption) => `<button class="chat-composer-sender-option" type="button" role="option" data-chat-sender-option="true" data-value="${escapeHtml(roleOption.value)}" data-label="${escapeHtml(roleOption.label)}"><span class="chat-composer-sender-option-label">${escapeHtml(roleOption.label)}</span></button>`)
  ].join("");
  const hint = !traceFilePath
    ? "Chat composer requires a saved TRACEABLE evidence file for continuation."
    : running
      ? "Please wait"
      : evidenceFileStatus && evidenceFileStatus !== "ready"
        ? "Please wait for the evidence file to finish exporting."
        : "Enter sends the next turn. Shift+Enter adds a new line.";
  return [
    `<section class="chat-composer${canSubmit ? "" : " chat-composer-disabled"}" data-chat-composer="true" data-chat-trace-path="${traceFilePathAttribute}" data-chat-base-disabled="${canSubmit ? "false" : "true"}" data-chat-collapse-mode="${escapeHtml(chatCollapseMode)}" data-chat-composer-collapsed="false">`,
    `<div class="chat-composer-shell">`,
    `<textarea class="chat-composer-input" data-chat-input="true" rows="3" placeholder="Continue this trace..."${canSubmit ? "" : " readonly"}></textarea>`,
    `<div class="chat-composer-actions">`,
    `<input class="chat-composer-compact-input" data-chat-input-compact="true" type="text" placeholder="Continue this trace..."${canSubmit ? "" : " readonly"} hidden />`,
    `<div class="chat-composer-hint">${escapeHtml(hint)}</div>`,
    `<div class="chat-composer-submit-controls">`,
    `<div class="chat-composer-sender" title="Sender role behind the current text, not the recipient agent role." data-chat-sender-picker="true">`,
    `<span class="chat-composer-sender-label">AS</span>`,
    `<button class="chat-composer-sender-toggle" type="button" data-chat-sender-role="true" data-chat-sender-toggle="true" aria-haspopup="listbox" aria-expanded="false"${canSubmit ? "" : " disabled"}>`,
    `<span class="chat-composer-sender-current" data-chat-sender-current-label="true"></span>`,
    `<span class="codicon codicon-chevron-down chat-composer-sender-chevron" aria-hidden="true"></span>`,
    `</button>`,
    `<div class="chat-composer-sender-menu" role="listbox" data-chat-sender-menu="true" hidden>${senderOptionsMarkup}</div>`,
    `</div>`,
    `<button class="toolbar-button chat-composer-send" type="button" data-chat-send="true"${canSubmit ? "" : " disabled"}>Send</button>`,
    `</div>`,
    `</div>`,
    `</div>`,
    `</section>`
  ].join("");
}

function extractDirectParentRolesFromRequestSummary(summary: PanelRequestSummaryItem[]): string[] {
  let modeTitle = "";
  let parentRolesItem: PanelRequestSummaryItem | undefined;
  for (const item of summary) {
    const normalizedLabel = item.label.trim().toLowerCase();
    if (!modeTitle && normalizedLabel === "mode") {
      modeTitle = item.title?.trim() || item.value?.trim() || "";
      continue;
    }
    if (!parentRolesItem && normalizedLabel === "parent roles") {
      parentRolesItem = item;
    }
  }
  if (!/Declared input mode:\s*DIRECT\b/u.test(modeTitle)) {
    return [];
  }
  const titleLines = (parentRolesItem?.title || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const explicitRoles = titleLines.length > 1 ? titleLines.slice(1) : [];
  if (explicitRoles.length > 0) {
    return explicitRoles;
  }
  const compactValue = parentRolesItem?.value?.trim() || "";
  if (!compactValue) {
    return [];
  }
  return compactValue
    .split(/[·,]/u)
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizePanelChatSenderRoleIdentity(value: string): string {
  return value
    .replace(/\s*\([^)]*\)\s*/gu, " ")
    .trim()
    .normalize("NFKC")
    .toLowerCase();
}

function resolveAvailableChatSenderRoleValue(
  candidateValue: string | undefined,
  chatSenderRoleOptions: readonly PanelChatSenderRoleOption[]
): string | undefined {
  const normalizedCandidateValue = candidateValue?.trim();
  if (!normalizedCandidateValue) {
    return undefined;
  }
  const exactMatch = chatSenderRoleOptions.find((option) => option.value === normalizedCandidateValue);
  if (exactMatch) {
    return exactMatch.value;
  }
  const normalizedIdentity = normalizePanelChatSenderRoleIdentity(normalizedCandidateValue);
  if (!normalizedIdentity) {
    return undefined;
  }
  const identityMatches = chatSenderRoleOptions.filter((option) => normalizePanelChatSenderRoleIdentity(option.label) === normalizedIdentity);
  return identityMatches.length > 0 ? identityMatches[0].value : undefined;
}

function resolveInitialChatSenderRole(
  snapshot: TraceableSubagentDetailSnapshot,
  chatSenderRoleOptions: readonly PanelChatSenderRoleOption[],
  configuredDefaultValue: string | undefined
): string {
  const previousDirectParentRole = extractDirectParentRolesFromRequestSummary(snapshot.requestSummary)[0];
  const resolvedPreviousDirectParentRole = resolveAvailableChatSenderRoleValue(previousDirectParentRole, chatSenderRoleOptions);
  if (resolvedPreviousDirectParentRole) {
    return resolvedPreviousDirectParentRole;
  }
  return resolveAvailableChatSenderRoleValue(configuredDefaultValue, chatSenderRoleOptions) || "";
}

function evidenceViewState(snapshot: TraceableSubagentDetailSnapshot): {
  showExport: boolean;
  showView: boolean;
  buttonClass: string;
  buttonTitle: string;
  filePath?: string;
  liveIndicator: boolean;
} {
  const evidenceFile = snapshot.evidenceFile;
  const filePath = evidenceFile?.filePath?.trim();
  const readableArtifact = Boolean(filePath);
  const exportStillLive = evidenceFile?.status === "writing" && snapshot.status.phase === "running";
  if (!evidenceFile || evidenceFile.status === "idle") {
    return {
      showExport: true,
      showView: false,
      buttonClass: "toolbar-button",
      buttonTitle: "Export raw markdown evidence",
      liveIndicator: false
    };
  }
  if (exportStillLive) {
    return {
      showExport: false,
      showView: readableArtifact,
      buttonClass: "toolbar-button toolbar-button-export-live",
      buttonTitle: "View RAW markdown evidence file",
      filePath,
      liveIndicator: readableArtifact
    };
  }
  if (evidenceFile.status === "ready" || evidenceFile.status === "writing") {
    return {
      showExport: false,
      showView: readableArtifact,
      buttonClass: "toolbar-button toolbar-button-export-ready",
      buttonTitle: "View RAW markdown evidence file",
      filePath,
      liveIndicator: false
    };
  }
  return {
    showExport: !readableArtifact,
    showView: readableArtifact,
    buttonClass: "toolbar-button toolbar-button-export-failed",
    buttonTitle: readableArtifact ? "View RAW markdown evidence file" : "Export raw markdown evidence",
    filePath,
    liveIndicator: false
  };
}

export function renderTraceableSubagentPanelHtml(
  snapshot: TraceableSubagentDetailSnapshot,
  codiconCssHref?: string,
  options: {
    pinnedOpen?: boolean;
    hideToolbarControls?: boolean;
    showChatToggle?: boolean;
    initialChatViewEnabled?: boolean;
    chatCollapseMode?: "auto" | "always";
    chatSenderRoleOptions?: ReadonlyArray<PanelChatSenderRoleOption>;
    defaultChatSenderRole?: string;
    loadedToolDetailsByCallId?: ReadonlyMap<string, PanelLoadedToolDetail>;
  } = {}
): string {
  const activities = buildActivityEntries(snapshot);
  const renderedEntries = groupActivityEntries(activities);
  const hasActivityFeed = renderedEntries.length > 0;
  const pinnedOpen = options.pinnedOpen === true;
  const hideToolbarControls = options.hideToolbarControls === true;
  const showChatToggle = options.showChatToggle !== false;
  const initialChatViewEnabled = options.initialChatViewEnabled === true;
  const chatCollapseMode = options.chatCollapseMode === "always" ? "always" : "auto";
  const chatSenderRoleOptions = Array.isArray(options.chatSenderRoleOptions)
    ? [...options.chatSenderRoleOptions].sort(comparePanelChatSenderRoleOptions)
    : [];
  const initialChatSenderRole = resolveInitialChatSenderRole(
    snapshot,
    chatSenderRoleOptions,
    typeof options.defaultChatSenderRole === "string" ? options.defaultChatSenderRole : undefined
  );
  const loadedToolDetailsByCallId = options.loadedToolDetailsByCallId ?? new Map<string, PanelLoadedToolDetail>();
  const evidenceState = evidenceViewState(snapshot);
  const brokenLineageWarning = getBrokenLineageWarning(snapshot);
  const repairableEvidencePath = snapshot.evidenceFile?.filePath?.trim();
  const repairButtonMarkup = repairableEvidencePath
    ? `<button class="toolbar-button${brokenLineageWarning ? " toolbar-button-warning" : ""}" data-message='${escapeHtml(JSON.stringify({ type: "repairTraceLineage", filePath: repairableEvidencePath }))}' title="${escapeHtml(brokenLineageWarning ? "Repair broken lineage for this trace" : "Check or repair lineage for this trace")}">Repair</button>`
    : "";
  const eventRows = hasActivityFeed
    ? renderedEntries.map((event) => event.kind === "tool"
      ? renderToolActivity(event, snapshot.evidenceFile?.filePath, snapshot.environment?.repoRootSnapshotPath, loadedToolDetailsByCallId)
      : renderActivityRow(event, snapshot.evidenceFile?.filePath, snapshot.environment?.repoRootSnapshotPath)).join("")
    : renderPanelEmptyState(snapshot);
  const updatedLabel = formatPanelUpdatedAt(snapshot.updatedAt);
  const runningState = snapshot.status.phase === "running" ? "true" : "false";
  const timingSummary = resolveTimingSummary(snapshot);
  const totalElapsedMs = timingSummary.totalElapsedMs;
  const runtimeElapsedMs = timingSummary.runtimeElapsedMs;
  const toolElapsedMs = timingSummary.toolElapsedMs;
  const llmElapsedMs = timingSummary.llmElapsedMs;
  const activeSegmentKind = timingSummary.activeSegmentKind;
  const totalStopwatch = renderMetaStopwatch(
    "Total",
    formatToolElapsedMs(totalElapsedMs),
    {
      timerKind: "total",
      baseElapsedMs: String(totalElapsedMs),
      activeSegmentKind,
      updatedAt: snapshot.updatedAt,
      running: runningState
    },
    "Total elapsed wall-clock time for this trace"
  );
  const runtimeStopwatch = renderMetaStopwatch(
    "Runtime",
    formatToolElapsedMs(runtimeElapsedMs),
    {
      timerKind: "runtime",
      baseElapsedMs: String(runtimeElapsedMs),
      activeSegmentKind,
      updatedAt: snapshot.updatedAt,
      running: runningState
    },
    "Measured runtime orchestration time outside model waits and tool execution"
  );
  const toolStopwatch = renderMetaStopwatch(
    "Tools",
    formatToolElapsedMs(toolElapsedMs),
    {
      timerKind: "tools",
      baseElapsedMs: String(toolElapsedMs),
      activeSegmentKind,
      updatedAt: snapshot.updatedAt,
      running: runningState
    },
    timingSummary.provenance === "measured"
      ? "Measured tool execution time recorded in this trace"
      : "Derived tool time recorded in this trace"
  );
  const llmStopwatch = renderMetaStopwatch(
    "LLM",
    formatToolElapsedMs(llmElapsedMs),
    {
      timerKind: "llm",
      baseElapsedMs: String(llmElapsedMs),
      activeSegmentKind,
      updatedAt: snapshot.updatedAt,
      running: runningState
    },
    timingSummary.provenance === "measured"
      ? "Measured LLM wait time recorded in this trace"
      : "Derived LLM time: total wall-clock minus recorded tool time"
  );
  const metaLead = hasActivityFeed
    ? [
      renderHeaderBadge("Activities", String(activities.length), "header-badge-meta", `${activities.length} activit${activities.length === 1 ? "y" : "ies"}`),
      renderHeaderBadge("Updated", updatedLabel, "header-badge-meta", `Updated ${formatPanelAbsoluteTimestamp(snapshot.updatedAt) || updatedLabel}`)
    ].join("")
    : `<span>${snapshot.status.phase === "running" ? "Preparing trace lane..." : "Ready"}</span>`;
  const metaStopwatches = hasActivityFeed ? `${totalStopwatch}${runtimeStopwatch}${toolStopwatch}${llmStopwatch}` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${codiconCssHref ? `<link rel="stylesheet" href="${escapeHtml(codiconCssHref)}" />` : ""}
  <style>
    :root {
      color-scheme: dark;
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --muted: var(--vscode-descriptionForeground);
      --border: var(--vscode-panel-border);
      --chip-bg: color-mix(in srgb, var(--vscode-button-background) 18%, transparent);
      --chip-border: color-mix(in srgb, var(--vscode-focusBorder) 44%, transparent);
      --accent: var(--vscode-textLink-foreground);
      --toolset-tree-line: color-mix(in srgb, var(--border) 76%, transparent);
    }
    * { box-sizing: border-box; }
    html, body {
      height: 100%;
    }
    body {
      margin: 0;
      padding: 8px 10px 10px;
      min-height: 100%;
      background: var(--bg);
      color: var(--fg);
      font: 12px/1.35 var(--vscode-font-family);
    }
    .panel-root {
      display: grid;
      gap: 8px;
      height: calc(100vh - 18px);
      min-height: 0;
      grid-template-rows: auto auto minmax(0, 1fr);
      overflow: hidden;
    }
    .panel-root.chat-view-active {
      grid-template-rows: auto minmax(0, 1fr);
    }
    .panel-root.chat-view-active .toolset-disclosure,
    .panel-root.chat-view-active .events {
      display: none;
    }
    .panel-root.chat-view-active .chat-view {
      display: grid;
      min-height: 0;
      overflow: hidden;
    }
    .header {
      display: grid;
      gap: 6px;
      position: sticky;
      top: 0;
      z-index: 2;
      background: var(--bg);
      box-shadow: none;
      padding: 0 0 8px;
    }
    .header-top {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: start;
      gap: 8px;
    }
    .title {
      display: flex;
      flex-wrap: nowrap;
      align-items: center;
      gap: 5px;
      min-width: 0;
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: none;
      -ms-overflow-style: none;
      white-space: nowrap;
      align-self: start;
    }
    .title::-webkit-scrollbar {
      display: none;
    }
    .header-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      max-width: 100%;
      border: 1px solid var(--chip-border);
      background: var(--chip-bg);
      border-radius: 999px;
      padding: 1px 7px;
      min-height: 22px;
    }
    .header-badge[type="button"] {
      appearance: none;
      cursor: pointer;
      color: inherit;
      font: inherit;
      text-align: left;
    }
    .header-badge[type="button"]:hover {
      background: color-mix(in srgb, var(--chip-bg) 82%, transparent);
      border-color: color-mix(in srgb, var(--accent) 28%, var(--chip-border));
    }
    .header-badge-label {
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-size: 10px;
    }
    .header-badge-value {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-weight: 600;
    }
    .header-badge-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--muted);
      line-height: 1;
      flex: 0 0 auto;
    }
    .header-badge-role-human .header-badge-icon {
      color: color-mix(in srgb, var(--vscode-terminal-ansiGreen) 82%, var(--muted));
    }
    .header-badge-role-ai .header-badge-icon {
      color: color-mix(in srgb, var(--accent) 72%, var(--muted));
    }
    .header-badge-role-human,
    .header-badge-role-ai {
      padding-inline: 8px;
      border-color: color-mix(in srgb, var(--accent) 16%, var(--chip-border));
    }
    .header-badge-role-pending {
      border-style: dashed;
      opacity: 0.9;
    }
    .header-badge-role-pending .header-badge-value {
      color: color-mix(in srgb, var(--fg) 78%, var(--muted));
    }
    .header-badge-role-neutral {
      border-color: color-mix(in srgb, var(--border) 74%, var(--chip-border));
      background: color-mix(in srgb, var(--chip-bg) 54%, transparent);
    }
    .header-badge-role-neutral .header-badge-label {
      color: color-mix(in srgb, var(--muted) 88%, transparent);
    }
    .header-badge-role-neutral .header-badge-value {
      color: color-mix(in srgb, var(--fg) 78%, var(--muted));
      font-weight: 500;
    }
    .header-badge-role-neutral .header-badge-icon {
      color: color-mix(in srgb, var(--muted) 82%, transparent);
    }
    .header-badge-track-candidate {
      min-height: 20px;
      padding: 0 6px;
      gap: 3px;
      border-color: color-mix(in srgb, var(--vscode-terminal-ansiGreen) 26%, var(--chip-border));
      background: color-mix(in srgb, var(--vscode-terminal-ansiGreen) 8%, var(--chip-bg));
    }
    .header-badge-track-candidate .header-badge-label,
    .header-badge-track-experimental .header-badge-label {
      color: color-mix(in srgb, var(--muted) 92%, transparent);
    }
    .header-badge-track-candidate .header-badge-value {
      color: color-mix(in srgb, var(--vscode-terminal-ansiGreen) 74%, var(--fg));
    }
    .header-badge-track-experimental {
      min-height: 20px;
      padding: 0 6px;
      gap: 3px;
      border-color: color-mix(in srgb, var(--vscode-editorWarning-foreground) 24%, var(--chip-border));
      background: color-mix(in srgb, var(--vscode-editorWarning-foreground) 7%, var(--chip-bg));
    }
    .header-badge-track-experimental .header-badge-value {
      color: color-mix(in srgb, var(--vscode-editorWarning-foreground) 72%, var(--fg));
    }
    .header-badge-model {
      border-color: color-mix(in srgb, var(--border) 74%, var(--chip-border));
      background: color-mix(in srgb, var(--chip-bg) 54%, transparent);
    }
    .header-badge-model .header-badge-label {
      color: color-mix(in srgb, var(--muted) 88%, transparent);
    }
    .header-badge-model .header-badge-value {
      color: color-mix(in srgb, var(--fg) 78%, var(--muted));
      font-weight: 500;
    }
    .header-badge-meta {
      min-height: 20px;
      padding: 0 6px;
      gap: 4px;
      border-color: color-mix(in srgb, var(--border) 72%, var(--chip-border));
      background: color-mix(in srgb, var(--chip-bg) 46%, transparent);
    }
    .header-badge-meta .header-badge-label {
      color: color-mix(in srgb, var(--muted) 90%, transparent);
    }
    .header-badge-meta .header-badge-value {
      color: color-mix(in srgb, var(--fg) 84%, var(--muted));
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .header-badge-icon .codicon {
      font-size: 12px;
    }
    .toolbar {
      display: inline-flex;
      gap: 6px;
      flex: 0 0 auto;
      align-self: start;
      white-space: nowrap;
    }
    .toolbar-button {
      border: 1px solid var(--chip-border);
      background: transparent;
      color: var(--fg);
      border-radius: 999px;
      padding: 2px 8px;
      cursor: pointer;
      font: inherit;
    }
    .toolbar-button-chat-toggle {
      min-width: 84px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      text-align: center;
    }
    .toolbar-button:hover { background: var(--chip-bg); }
    .toolbar-button-chat-toggle[aria-pressed="true"] {
      border-color: color-mix(in srgb, var(--fg) 18%, var(--chip-border));
      background: color-mix(in srgb, var(--chip-bg) 92%, var(--bg));
      color: color-mix(in srgb, var(--fg) 94%, var(--muted));
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fg) 8%, transparent);
    }
    .toolbar-button-export-live {
      border-color: color-mix(in srgb, var(--vscode-errorForeground) 66%, var(--chip-border));
    }
    .toolbar-button-export-ready {
      border-color: color-mix(in srgb, var(--vscode-terminal-ansiGreen) 60%, var(--chip-border));
    }
    .toolbar-button-export-failed {
      border-color: color-mix(in srgb, var(--vscode-errorForeground) 40%, var(--chip-border));
    }
    .toolbar-button-warning {
      border-color: color-mix(in srgb, var(--vscode-editorWarning-foreground) 72%, var(--chip-border));
      background: color-mix(in srgb, var(--vscode-editorWarning-foreground) 10%, transparent);
    }
    .toolbar-button-warning:hover {
      background: color-mix(in srgb, var(--vscode-editorWarning-foreground) 16%, var(--chip-bg));
    }
    .toolbar-live-indicator {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: var(--vscode-errorForeground);
      align-self: center;
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--vscode-errorForeground) 20%, transparent);
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      color: var(--muted);
      align-items: center;
    }
    .meta-stopwatch {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 1px 7px;
      min-height: 20px;
      border: 1px solid color-mix(in srgb, var(--border) 68%, transparent);
      border-radius: 999px;
      background: color-mix(in srgb, var(--chip-bg) 38%, transparent);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .meta-stopwatch-label {
      color: color-mix(in srgb, var(--muted) 92%, transparent);
      font-size: 10px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .meta-stopwatch-value {
      color: color-mix(in srgb, var(--fg) 84%, var(--muted));
      font-weight: 600;
    }
    .activity-request-badge {
      min-height: 18px;
      padding: 0 5px;
      gap: 4px;
      background: color-mix(in srgb, var(--chip-bg) 52%, transparent);
      border-color: color-mix(in srgb, var(--border) 68%, var(--chip-border));
    }
    .activity-request-badge .header-badge-label {
      color: color-mix(in srgb, var(--muted) 90%, transparent);
    }
    .activity-request-badge .header-badge-value {
      color: color-mix(in srgb, var(--fg) 84%, var(--muted));
      font-weight: 600;
    }
    .activity-request-badge.header-badge-track-candidate .header-badge-label,
    .activity-request-badge.header-badge-track-experimental .header-badge-label {
      color: color-mix(in srgb, var(--muted) 92%, transparent);
    }
    .activity-request-badge.header-badge-track-candidate {
      border-color: color-mix(in srgb, var(--vscode-terminal-ansiGreen) 26%, var(--chip-border));
      background: color-mix(in srgb, var(--vscode-terminal-ansiGreen) 8%, var(--chip-bg));
    }
    .activity-request-badge.header-badge-track-candidate .header-badge-value {
      color: color-mix(in srgb, var(--vscode-terminal-ansiGreen) 74%, var(--fg));
    }
    .activity-request-badge.header-badge-track-experimental {
      border-color: color-mix(in srgb, var(--vscode-editorWarning-foreground) 24%, var(--chip-border));
      background: color-mix(in srgb, var(--vscode-editorWarning-foreground) 7%, var(--chip-bg));
    }
    .activity-request-badge.header-badge-track-experimental .header-badge-value {
      color: color-mix(in srgb, var(--vscode-editorWarning-foreground) 72%, var(--fg));
    }
    .activity-request-badge.activity-request-badge-inherited {
      border-color: color-mix(in srgb, var(--border) 68%, var(--chip-border));
      background: color-mix(in srgb, var(--chip-bg) 52%, transparent);
    }
    .activity-request-badge.activity-request-badge-inherited .header-badge-label {
      color: color-mix(in srgb, var(--muted) 90%, transparent);
    }
    .chip-request {
      gap: 5px;
    }
    .chip-request-label {
      color: color-mix(in srgb, var(--muted) 90%, transparent);
      text-transform: uppercase;
      font-size: 10px;
      letter-spacing: 0.04em;
    }
    .chip-request-value {
      color: color-mix(in srgb, var(--fg) 88%, var(--muted));
      font-weight: 600;
    }
    .meta-status {
      margin-left: auto;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .meta-status-running {
      color: var(--vscode-progressBar-background);
    }
    .meta-status-completed {
      color: var(--vscode-terminal-ansiGreen);
    }
    .meta-status-warning {
      color: var(--vscode-editorWarning-foreground);
    }
    .meta-status-error {
      color: var(--vscode-errorForeground);
    }
    .meta-status-idle {
      color: var(--muted);
    }
    .toolset-disclosure {
      border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
      border-radius: 10px;
      background: color-mix(in srgb, var(--chip-bg) 62%, transparent);
      padding: 0;
      overflow: hidden;
    }
    .toolset-summary {
      cursor: pointer;
      list-style: none;
      padding: 7px 10px;
      color: var(--muted);
      font-weight: 600;
    }
    .toolset-summary::-webkit-details-marker {
      display: none;
    }
    .toolset-disclosure[open] .toolset-summary {
      border-bottom: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
    }
    .toolset-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      padding: 10px;
      align-items: start;
    }
    .toolset-column {
      display: grid;
      gap: 8px;
      min-width: 0;
      align-content: start;
      align-self: start;
      position: relative;
    }
    .toolset-namespace-group {
      display: grid;
      gap: 0;
      min-width: 0;
    }
    .toolset-tree-children {
      display: grid;
      gap: 6px;
      min-width: 0;
      padding-top: 4px;
      padding-left: 16px;
      margin-left: 0;
    }
    .toolset-tree-children-root {
      margin-top: 2px;
      padding-top: 2px;
    }
    .toolset-root-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      color: var(--fg);
      font-weight: 600;
    }
    .toolset-root-heading-main {
      position: relative;
      display: inline-flex;
      align-items: center;
      min-width: 0;
      padding-left: 16px;
    }
    .toolset-root-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .toolset-namespace-metrics,
    .toolset-item-runtime {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex: 0 0 auto;
    }
    .toolset-tree-node {
      position: relative;
      min-width: 0;
    }
    .toolset-tree-node::before {
      content: "";
      position: absolute;
      left: -13px;
      top: -6px;
      bottom: -6px;
      width: 1px;
      background: var(--toolset-tree-line);
      pointer-events: none;
    }
    .toolset-tree-node.toolset-node-last::before {
      bottom: auto;
      height: calc(50% + 6px);
    }
    .toolset-tree-children-root > .toolset-tree-node::before {
      display: none;
    }
    .toolset-tree-children-root > .toolset-tree-node > .toolset-namespace-heading .toolset-namespace-branch,
    .toolset-tree-children-root > .toolset-item > .toolset-item-branch {
      opacity: 0;
    }
    .toolset-namespace-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      color: var(--muted);
      font-size: 11px;
      text-transform: none;
      list-style: none;
      cursor: default;
      padding: 0;
    }
    .toolset-namespace-heading::-webkit-details-marker {
      display: none;
    }
    .toolset-namespace-heading-main {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding-left: 16px;
      min-width: 0;
    }
    .toolset-namespace-branch {
      width: 8px;
      height: 1px;
      flex: 0 0 auto;
      position: absolute;
      left: -13px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--toolset-tree-line);
      margin-top: 0;
      opacity: 0.58;
    }
    .toolset-namespace-branch::before,
    .toolset-item-branch::before {
      content: "";
      position: absolute;
      display: block;
      pointer-events: none;
      background: currentColor;
    }
    .toolset-namespace-branch::before,
    .toolset-item-branch::before {
      left: 0;
      top: 0;
      width: 8px;
      height: 1px;
    }
    .toolset-namespace-twistie {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--muted);
      line-height: 1;
      flex: 0 0 auto;
    }
    .toolset-namespace-twistie .codicon {
      font-size: 11px;
      transition: transform 120ms ease;
    }
    .toolset-namespace-group[open] .toolset-namespace-twistie .codicon {
      transform: rotate(90deg);
    }
    .toolset-namespace-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      font-weight: 600;
    }
    .toolset-count {
      color: var(--muted);
      font-weight: 500;
    }
    .tool-runtime-badge {
      display: inline-flex;
      align-items: center;
      border: 1px solid color-mix(in srgb, var(--border) 76%, transparent);
      border-radius: 999px;
      padding: 0 6px;
      color: var(--muted);
      font-size: 10px;
      line-height: 1.6;
    }
    .tool-runtime-badge-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      flex: 0 0 auto;
    }
    .tool-runtime-badge-icon .codicon {
      font-size: 11px;
    }
    .tool-runtime-badge-value {
      font-variant-numeric: tabular-nums;
    }
    .tool-runtime-badge-success {
      color: var(--vscode-terminal-ansiGreen);
    }
    .tool-runtime-badge-warning {
      color: var(--vscode-editorWarning-foreground);
    }
    .tool-runtime-badge-failure {
      color: var(--vscode-errorForeground);
    }
    .tool-runtime-badge-time {
      gap: 4px;
      color: color-mix(in srgb, var(--muted) 88%, transparent);
      border-color: color-mix(in srgb, var(--border) 60%, transparent);
      background: color-mix(in srgb, var(--chip-bg) 38%, transparent);
    }
    .toolset-list {
      list-style: none;
      display: grid;
      gap: 6px;
      margin: 0;
      padding: 0;
    }
    .toolset-list-nested {
      padding-left: 0;
      margin-left: 0;
      border-left: 0;
    }
    .toolset-item {
      position: relative;
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      padding: 2px 0 2px 16px;
      color: var(--muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      border: 0;
      border-radius: 0;
      background: transparent;
    }
    .toolset-item:hover {
      color: var(--fg);
    }
    .toolset-item-branch {
      position: absolute;
      left: -13px;
      top: 50%;
      transform: translateY(-50%);
      width: 8px;
      height: 1px;
      flex: 0 0 auto;
      color: var(--toolset-tree-line);
      margin-top: 0;
    }
    .toolset-item-icon {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--accent);
      line-height: 1;
    }
    .toolset-item-icon .codicon {
      font-size: 12px;
    }
    .toolset-item-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .toolset-item.toolset-runtime-running .toolset-item-label,
    .toolset-item.toolset-runtime-running .toolset-item-icon,
    .toolset-namespace-group.toolset-runtime-running > .toolset-namespace-heading .toolset-namespace-label,
    .toolset-namespace-group.toolset-runtime-running > .toolset-namespace-heading .toolset-namespace-twistie {
      color: var(--accent);
    }
    .toolset-item.toolset-runtime-success .toolset-item-label,
    .toolset-item.toolset-runtime-success .toolset-item-icon,
    .toolset-namespace-group.toolset-runtime-success > .toolset-namespace-heading .toolset-namespace-label,
    .toolset-namespace-group.toolset-runtime-success > .toolset-namespace-heading .toolset-namespace-twistie {
      color: var(--vscode-terminal-ansiGreen);
    }
    .toolset-item.toolset-runtime-warning .toolset-item-label,
    .toolset-item.toolset-runtime-warning .toolset-item-icon,
    .toolset-namespace-group.toolset-runtime-warning > .toolset-namespace-heading .toolset-namespace-label,
    .toolset-namespace-group.toolset-runtime-warning > .toolset-namespace-heading .toolset-namespace-twistie {
      color: var(--vscode-editorWarning-foreground);
    }
    .toolset-item.toolset-runtime-failure .toolset-item-label,
    .toolset-item.toolset-runtime-failure .toolset-item-icon,
    .toolset-namespace-group.toolset-runtime-failure > .toolset-namespace-heading .toolset-namespace-label,
    .toolset-namespace-group.toolset-runtime-failure > .toolset-namespace-heading .toolset-namespace-twistie {
      color: var(--vscode-errorForeground);
    }
    .toolset-item.toolset-runtime-inactive .toolset-item-label,
    .toolset-item.toolset-runtime-inactive .toolset-item-icon,
    .toolset-namespace-group.toolset-runtime-inactive > .toolset-namespace-heading .toolset-namespace-label,
    .toolset-namespace-group.toolset-runtime-inactive > .toolset-namespace-heading .toolset-namespace-twistie {
      color: color-mix(in srgb, var(--muted) 72%, transparent);
    }
    .toolset-empty {
      color: var(--muted);
    }
    .events {
      display: grid;
      gap: 0;
      align-content: start;
      margin: 0;
      min-height: 0;
      overflow: auto;
      padding: 6px 8px 8px;
      border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
      border-radius: 12px;
      background: color-mix(in srgb, var(--bg) 92%, var(--chip-bg));
    }
    .chat-view {
      display: none;
      grid-template-rows: minmax(0, 1fr) auto;
      gap: 10px;
      align-content: stretch;
      min-height: 0;
      overflow: hidden;
    }
    .chat-thread {
      display: grid;
      gap: 10px;
      align-content: start;
      min-height: 0;
      overflow: auto;
      padding-right: 2px;
      padding-bottom: 8px;
    }
    .chat-message {
      display: grid;
      gap: 6px;
    }
    .chat-message-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
      min-width: 0;
    }
    .chat-message-label-row {
      display: flex;
      align-items: baseline;
      gap: 8px;
      min-width: 0;
    }
    .chat-trace-separator {
      position: relative;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 22px;
      margin: 4px 0 0;
    }
    .chat-trace-separator::before {
      content: "";
      position: absolute;
      inset: 50% 0 auto 0;
      height: 1px;
      background: color-mix(in srgb, var(--border) 74%, transparent);
      transform: translateY(-50%);
    }
    .chat-trace-separator-title-wrap {
      position: relative;
      z-index: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0 10px;
      background: var(--bg);
    }
    .chat-trace-separator-title {
      border: 0;
      padding: 0;
      background: transparent;
      color: color-mix(in srgb, var(--fg) 78%, var(--muted));
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
      cursor: pointer;
    }
    .chat-trace-separator-title:hover {
      color: color-mix(in srgb, var(--accent) 70%, var(--fg));
    }
    .chat-trace-separator-title-static {
      cursor: default;
    }
    .chat-trace-separator-title-static:hover {
      color: color-mix(in srgb, var(--fg) 78%, var(--muted));
    }
    .chat-trace-separator-title:focus-visible {
      outline: 1px solid color-mix(in srgb, var(--accent) 70%, transparent);
      outline-offset: 2px;
      border-radius: 4px;
    }
    .chat-lineage-banner {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: start;
      padding: 10px 12px;
      border: 1px solid color-mix(in srgb, var(--vscode-editorWarning-foreground) 56%, var(--chip-border));
      border-radius: 12px;
      background: color-mix(in srgb, var(--vscode-editorWarning-foreground) 10%, var(--chip-bg));
    }
    .chat-lineage-banner-copy {
      display: grid;
      gap: 3px;
      min-width: 0;
    }
    .chat-lineage-banner-title {
      color: color-mix(in srgb, var(--vscode-editorWarning-foreground) 86%, var(--fg));
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .chat-lineage-banner-note {
      color: color-mix(in srgb, var(--fg) 92%, var(--muted));
      white-space: normal;
    }
    .chat-lineage-banner-detail {
      color: color-mix(in srgb, var(--muted) 90%, transparent);
      font-size: 11px;
      word-break: break-all;
    }
    .chat-message-label {
      color: color-mix(in srgb, var(--muted) 90%, transparent);
      text-transform: uppercase;
      font-size: 10px;
      letter-spacing: 0.04em;
      font-weight: 600;
    }
    .chat-message-time {
      flex: 0 0 auto;
      color: color-mix(in srgb, var(--muted) 82%, transparent);
      font-size: 10px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .chat-message-bubble {
      padding: 10px 12px;
      border-radius: 14px;
      border: 1px solid color-mix(in srgb, var(--border) 76%, transparent);
      background: color-mix(in srgb, var(--chip-bg) 54%, transparent);
      color: color-mix(in srgb, var(--fg) 90%, var(--muted));
      white-space: pre-wrap;
      line-height: 1.45;
    }
    .chat-message-input .chat-message-bubble {
      border-color: color-mix(in srgb, var(--vscode-terminal-ansiGreen) 34%, var(--chip-border));
      background: color-mix(in srgb, var(--vscode-terminal-ansiGreen) 12%, var(--chip-bg));
    }
    .chat-message-task .chat-message-bubble {
      border-color: color-mix(in srgb, var(--vscode-errorForeground) 48%, var(--chip-border));
      background: color-mix(in srgb, var(--vscode-errorForeground) 12%, var(--chip-bg));
    }
    .chat-message-output .chat-message-bubble {
      border-color: color-mix(in srgb, var(--border) 82%, transparent);
    }
    .chat-composer {
      position: sticky;
      bottom: 0;
      z-index: 1;
      padding-top: 12px;
      margin-top: auto;
      background: var(--bg);
      box-shadow: 0 -10px 24px color-mix(in srgb, var(--bg) 88%, transparent);
    }
    .chat-composer-shell {
      display: grid;
      gap: 8px;
      padding: 10px;
      border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
      border-radius: 12px;
      background: color-mix(in srgb, var(--bg) 92%, var(--chip-bg));
    }
    .chat-composer-sender {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      max-width: min(100%, 22rem);
      color: color-mix(in srgb, var(--muted) 86%, var(--fg));
      font-size: 12px;
    }
    .chat-composer-sender-label {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 2.3rem;
      height: 28px;
      padding: 0 8px;
      border-radius: 999px;
      border: 1px solid var(--chip-border);
      background: var(--chip-bg);
      color: color-mix(in srgb, var(--accent) 72%, var(--fg));
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
    }
    .chat-composer-sender-toggle {
      min-width: min(14rem, 42vw);
      max-width: 100%;
      height: 30px;
      display: inline-flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 0 10px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: color-mix(in srgb, var(--bg-alt) 88%, var(--bg));
      color: var(--fg);
      font: inherit;
      cursor: pointer;
    }
    .chat-composer-sender-toggle:hover {
      border-color: color-mix(in srgb, var(--accent) 42%, var(--border));
    }
    .chat-composer-sender-toggle:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }
    .chat-composer-sender-toggle:disabled {
      opacity: 0.65;
      cursor: default;
    }
    .chat-composer-sender-current {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-align: left;
    }
    .chat-composer-sender-chevron {
      flex: 0 0 auto;
      opacity: 0.72;
      font-size: 12px;
    }
    .chat-composer-sender[data-open="true"] .chat-composer-sender-toggle {
      border-color: color-mix(in srgb, var(--accent) 58%, var(--border));
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 18%, transparent);
    }
    .chat-composer-sender-menu {
      position: absolute;
      right: 0;
      bottom: calc(100% + 6px);
      z-index: 5;
      min-width: 100%;
      max-width: min(20rem, 64vw);
      max-height: min(16rem, 45vh);
      overflow: auto;
      padding: 6px;
      border: 1px solid var(--vscode-widget-border, var(--border));
      border-radius: 10px;
      background: var(--vscode-editorWidget-background, var(--bg));
      opacity: 1;
      backdrop-filter: none;
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.42);
    }
    .chat-composer-sender-option {
      width: 100%;
      display: flex;
      align-items: center;
      min-height: 30px;
      padding: 0 10px;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: var(--fg);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .chat-composer-sender-option:hover,
    .chat-composer-sender-option:focus-visible {
      background: var(--vscode-list-hoverBackground, color-mix(in srgb, var(--accent) 18%, transparent));
      outline: none;
    }
    .chat-composer-sender-option[data-selected="true"] {
      background: var(--vscode-list-activeSelectionBackground, color-mix(in srgb, var(--accent) 24%, var(--chip-bg)));
      color: var(--vscode-list-activeSelectionForeground, var(--fg));
    }
    .chat-composer-sender-option-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .chat-composer-input {
      width: 100%;
      min-height: 74px;
      resize: vertical;
      border-radius: 10px;
      border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
      background: color-mix(in srgb, var(--bg) 94%, var(--chip-bg));
      color: var(--fg);
      font: inherit;
      padding: 9px 10px;
    }
    .chat-composer-input[readonly] {
      cursor: default;
    }
    .chat-composer-input:focus-visible {
      outline: 1px solid color-mix(in srgb, var(--accent) 72%, transparent);
      outline-offset: 1px;
    }
    .chat-composer-compact-input {
      display: none;
      flex: 1 1 18rem;
      min-width: 0;
      height: 34px;
      border-radius: 9px;
      border: 1px solid color-mix(in srgb, var(--border) 84%, transparent);
      background: color-mix(in srgb, var(--bg) 94%, var(--chip-bg));
      color: var(--fg);
      font: inherit;
      padding: 0 10px;
    }
    .chat-composer-compact-input:focus-visible {
      outline: 1px solid color-mix(in srgb, var(--accent) 72%, transparent);
      outline-offset: 1px;
    }
    .chat-composer-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .chat-composer-hint {
      color: var(--muted);
      line-height: 1.4;
      flex: 1 1 18rem;
      min-width: 0;
    }
    .chat-composer-submit-controls {
      display: inline-flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      margin-left: auto;
      flex: 0 1 auto;
      min-width: 0;
    }
    .chat-composer-disabled .chat-composer-shell {
      opacity: 0.78;
    }
    .chat-composer-pending .chat-composer-shell {
      opacity: 0.72;
    }
    .chat-composer[data-chat-composer-collapsed="true"] .chat-composer-input {
      display: none;
    }
    .chat-composer[data-chat-composer-collapsed="true"] .chat-composer-actions {
      flex-wrap: nowrap;
      justify-content: flex-start;
      align-items: center;
    }
    .chat-composer[data-chat-composer-collapsed="true"] .chat-composer-compact-input {
      display: block;
      flex: 1 1 auto;
      min-width: 10rem;
    }
    .chat-composer[data-chat-composer-collapsed="true"] .chat-composer-hint {
      display: none;
    }
    .chat-composer[data-chat-composer-collapsed="true"] .chat-composer-submit-controls {
      flex: 0 0 auto;
      min-width: max-content;
      margin-left: 0;
    }
    .chat-composer[data-chat-composer-collapsed="true"] .chat-composer-sender {
      max-width: min(16rem, 34vw);
      flex: 0 1 auto;
    }
    .chat-composer[data-chat-composer-collapsed="true"] .chat-composer-sender-toggle {
      min-width: min(10rem, 30vw);
      width: auto;
    }
    .chat-composer-send[disabled] {
      cursor: not-allowed;
      opacity: 0.65;
    }
    .event-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      align-items: start;
      padding: 8px 2px;
      border-bottom: 1px solid color-mix(in srgb, var(--border) 68%, transparent);
    }
    .event-main {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .event-summary-inline {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      flex: 1 1 auto;
    }
    .event-body {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .event-icon {
      width: 14px;
      min-height: 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      line-height: 1;
      flex: 0 0 auto;
    }
    .event-request .event-icon .codicon {
      font-size: 13px;
    }
    .event-label {
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .event-summary-preview {
      min-width: 0;
      color: color-mix(in srgb, var(--fg) 88%, var(--muted));
      font-size: 12px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .event-note {
      color: var(--muted);
      padding-left: 20px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-size: 11px;
    }
    .event-request .event-note {
      color: color-mix(in srgb, var(--fg) 84%, var(--muted));
      font-size: 12px;
      white-space: normal;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 1;
    }
    .event-expand-indicator {
      color: color-mix(in srgb, var(--muted) 90%, transparent);
      font-size: 11px;
      line-height: 1;
      transform-origin: 50% 50%;
      transition: transform 120ms ease, color 120ms ease;
    }
    .event-request[data-request-expandable="true"] {
      cursor: pointer;
    }
    .event-request[data-request-expandable="true"]:hover {
      background: color-mix(in srgb, var(--chip-bg) 42%, transparent);
    }
    .event-request[data-request-expandable="true"]:focus-visible {
      outline: 1px solid color-mix(in srgb, var(--accent) 72%, transparent);
      outline-offset: 2px;
    }
    .event-output[data-output-expandable="true"] {
      cursor: pointer;
    }
    .event-output[data-output-expandable="true"]:hover {
      background: color-mix(in srgb, var(--chip-bg) 42%, transparent);
    }
    .event-output[data-output-expandable="true"]:focus-visible {
      outline: 1px solid color-mix(in srgb, var(--accent) 72%, transparent);
      outline-offset: 2px;
    }
    .event-request-detail {
      display: none;
      gap: 8px;
      padding-left: 20px;
      margin-top: 6px;
    }
    .event-request.request-expanded .event-request-detail {
      display: grid;
    }
    .event-request.request-expanded .event-note {
      display: none;
    }
    .event-request.request-expanded .event-summary-preview {
      display: none;
    }
    .event-request.request-expanded .event-chips {
      display: none;
    }
    .event-request.request-expanded .event-expand-indicator {
      transform: rotate(90deg);
    }
    .event-output .event-note {
      color: color-mix(in srgb, var(--fg) 84%, var(--muted));
      font-size: 12px;
      white-space: normal;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 1;
    }
    .event-output-detail {
      display: none;
      padding-left: 20px;
      margin-top: 6px;
      gap: 8px;
    }
    .event-output.output-expanded .event-note {
      display: none;
    }
    .event-output.output-expanded .event-summary-preview {
      display: none;
    }
    .event-output.output-expanded .event-output-detail {
      display: grid;
    }
    .event-output.output-expanded .event-expand-indicator {
      transform: rotate(90deg);
    }
    .event-handoff[data-handoff-expandable="true"] {
      cursor: pointer;
    }
    .event-handoff[data-handoff-expandable="true"]:hover {
      background: color-mix(in srgb, var(--chip-bg) 42%, transparent);
    }
    .event-handoff[data-handoff-expandable="true"]:focus-visible {
      outline: 1px solid color-mix(in srgb, var(--accent) 72%, transparent);
      outline-offset: 2px;
    }
    .event-handoff .event-label {
      color: color-mix(in srgb, var(--accent-soft) 82%, var(--fg));
      letter-spacing: 0.02em;
    }
    .event-handoff .event-note {
      color: color-mix(in srgb, var(--fg) 86%, var(--muted));
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 1;
      white-space: normal;
    }
    .event-handoff-detail {
      display: none;
      margin-top: 6px;
      padding-left: 20px;
      gap: 8px;
    }
    .event-handoff.handoff-expanded .event-note {
      display: none;
    }
    .event-handoff.handoff-expanded .event-summary-preview {
      display: none;
    }
    .event-handoff.handoff-expanded .event-handoff-detail {
      display: grid;
    }
    .chip-handoff-kind,
    .chip-handoff-scope {
      color: color-mix(in srgb, var(--accent-soft) 82%, var(--fg));
      border-color: color-mix(in srgb, var(--accent-soft) 24%, var(--chip-border));
      background: color-mix(in srgb, var(--accent-soft) 10%, var(--chip-bg));
    }
    .event-handoff.handoff-expanded .event-expand-indicator {
      transform: rotate(90deg);
    }
    .event-tool[data-tool-expandable="true"] {
      cursor: pointer;
    }
    .event-tool[data-tool-expandable="true"]:hover {
      background: color-mix(in srgb, var(--chip-bg) 42%, transparent);
    }
    .event-tool[data-tool-expandable="true"]:focus-visible {
      outline: 1px solid color-mix(in srgb, var(--accent) 72%, transparent);
      outline-offset: 2px;
    }
    .event-tool-detail {
      display: none;
      gap: 8px;
      padding-left: 20px;
      margin-top: 6px;
    }
    .event-tool.tool-expanded .event-tool-detail {
      display: grid;
    }
    .event-tool.tool-expanded .event-note {
      display: none;
    }
    .event-tool.tool-expanded .event-meta-chips {
      display: none;
    }
    .event-tool.tool-expanded .event-expand-indicator {
      transform: rotate(90deg);
    }
    .event-tool-main-toggle {
      width: 100%;
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      text-align: left;
      font: inherit;
      cursor: pointer;
    }
    .event-raw-disclosure {
      display: grid;
      gap: 6px;
      margin: 0;
      padding: 0;
    }
    .event-raw-summary {
      color: color-mix(in srgb, var(--muted) 90%, transparent);
      cursor: pointer;
      list-style: none;
      font-size: 11px;
    }
    .event-raw-summary::-webkit-details-marker {
      display: none;
    }
    .event-raw-summary-note {
      color: color-mix(in srgb, var(--muted) 78%, transparent);
      font-size: 10px;
      text-transform: uppercase;
      margin-left: 4px;
    }
    .event-raw-block {
      margin: 0;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
      background: color-mix(in srgb, var(--panel) 88%, var(--chip-bg));
      color: color-mix(in srgb, var(--fg) 90%, var(--muted));
      white-space: pre;
      word-break: normal;
      overflow-wrap: normal;
      font: inherit;
      line-height: 1.45;
      width: 100%;
      box-sizing: border-box;
      max-height: calc(20 * 1.45em + 18px);
      overflow: auto;
    }
    .event-json-block {
      font-family: var(--vscode-editor-font-family, Consolas, monospace);
      font-size: 12px;
    }
    .event-json-key {
      color: var(--vscode-symbolIcon-propertyForeground, #9cdcfe);
    }
    .event-json-string {
      color: var(--vscode-terminal-ansiGreen, #ce9178);
    }
    .event-json-number {
      color: var(--vscode-debugTokenExpression-number, #b5cea8);
    }
    .event-json-boolean {
      color: var(--vscode-symbolIcon-keywordForeground, #569cd6);
    }
    .event-json-null {
      color: var(--vscode-symbolIcon-keywordForeground, #569cd6);
      font-style: italic;
    }
    .event-tool-section-disclosure {
      display: grid;
      gap: 6px;
      margin: 0;
    }
    .event-tool-section-summary {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      list-style: none;
      color: color-mix(in srgb, var(--muted) 92%, transparent);
      font-size: 11px;
      user-select: none;
      width: 100%;
    }
    .event-tool-section-summary::-webkit-details-marker {
      display: none;
    }
    .event-tool-section-summary-label {
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .event-tool-section-summary-spacer {
      flex: 1 1 auto;
      min-width: 0;
    }
    .event-tool-section-summary-note {
      color: color-mix(in srgb, var(--muted) 74%, transparent);
      font-size: 10px;
    }
    .event-tool-section-copy {
      border: 1px solid color-mix(in srgb, var(--border) 76%, transparent);
      background: color-mix(in srgb, var(--panel) 82%, var(--chip-bg));
      color: color-mix(in srgb, var(--fg) 90%, var(--muted));
      border-radius: 999px;
      padding: 1px 8px;
      font: inherit;
      font-size: 10px;
      line-height: 1.5;
      cursor: pointer;
    }
    .event-tool-section-copy:hover {
      border-color: color-mix(in srgb, var(--accent) 60%, var(--border));
      color: var(--fg);
    }
    .event-tool-section-copy.is-copied {
      border-color: color-mix(in srgb, var(--accent) 72%, transparent);
      color: var(--accent);
    }
    .event-tool-section-disclosure[open] .event-expand-indicator {
      transform: rotate(90deg);
    }
    .event-tool-section-body {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 8px;
      padding-left: 10px;
      width: 100%;
      min-width: 0;
    }
    .event-tool-loading {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: color-mix(in srgb, var(--fg) 84%, var(--muted));
    }
    .event-tool-loading-fallback {
      color: color-mix(in srgb, var(--fg) 84%, var(--muted));
      line-height: 1.45;
    }
    .event-tool-loading-spinner {
      width: 12px;
      height: 12px;
      border-radius: 999px;
      border: 2px solid color-mix(in srgb, var(--border) 82%, transparent);
      border-top-color: var(--accent);
      animation: event-tool-spin 720ms linear infinite;
      flex: 0 0 auto;
    }
    @keyframes event-tool-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .event-request-detail-section {
      display: grid;
      gap: 3px;
    }
    .event-request-detail-label {
      color: color-mix(in srgb, var(--muted) 90%, transparent);
      text-transform: uppercase;
      font-size: 10px;
      letter-spacing: 0.04em;
    }
    .event-request-detail-value {
      color: color-mix(in srgb, var(--fg) 88%, var(--muted));
      white-space: pre-wrap;
      line-height: 1.45;
    }
    .event-request {
      align-items: start;
      grid-template-columns: minmax(0, 1fr);
    }
    .event-request-body {
      display: grid;
      gap: 6px;
      align-items: start;
    }
    .event-request-heading-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: flex-start;
      align-content: flex-start;
      min-width: 0;
    }
    .event-request-copy {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .event-request .event-main {
      align-items: flex-start;
      min-width: 0;
      flex: 1 1 24rem;
    }
    .event-request .event-label,
    .event-output .event-label {
      flex: 0 0 auto;
      padding-right: 2px;
    }
    .event-request .event-summary-inline {
      flex: 0 1 auto;
      min-width: 0;
      max-width: min(100%, 38rem);
      padding-left: 4px;
    }
    .event-output .event-summary-inline {
      flex: 1 1 auto;
      min-width: 0;
      padding-left: 4px;
    }
    .event-request .event-label {
      color: color-mix(in srgb, var(--accent) 78%, var(--fg));
      letter-spacing: 0.02em;
    }
    .event-detail-chip-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: flex-start;
    }
    .event-request-heading-row > .activity-request-badge {
      flex: 0 1 auto;
      min-width: 0;
      max-width: 100%;
    }
    .event-request .event-summary-inline + .activity-request-badge,
    .event-request .event-expand-indicator + .activity-request-badge,
    .event-request .event-label + .activity-request-badge {
      margin-left: auto;
    }
    .event-request .event-request-detail {
      padding-left: 20px;
    }
    .event-request.request-expanded .event-request-body {
      grid-template-columns: minmax(0, 1fr);
    }
    .status-group-item {
      list-style: none;
    }
    .ancestor-group-item {
      list-style: none;
    }
    .ancestor-group {
      display: grid;
      gap: 0;
    }
    .ancestor-group > summary {
      list-style: none;
      cursor: pointer;
    }
    .ancestor-group > summary::-webkit-details-marker {
      display: none;
    }
    .status-group {
      display: grid;
      gap: 0;
    }
    .status-group > summary {
      list-style: none;
      cursor: pointer;
    }
    .status-group > summary::-webkit-details-marker {
      display: none;
    }
    .ancestor-group > summary:hover,
    .status-group > summary:hover {
      background: color-mix(in srgb, var(--chip-bg) 42%, transparent);
    }
    .ancestor-group > summary:focus-visible,
    .status-group > summary:focus-visible {
      outline: 1px solid color-mix(in srgb, var(--accent) 72%, transparent);
      outline-offset: 2px;
    }
    .event-status-group-summary {
      cursor: pointer;
      grid-template-columns: minmax(16rem, 1fr) auto;
    }
    .event-status-group-summary .event-body {
      min-width: 0;
    }
    .event-status-group-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: color-mix(in srgb, var(--accent) 70%, var(--muted));
      transition: transform 140ms ease;
    }
    .event-ancestor-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: color-mix(in srgb, var(--accent) 70%, var(--muted));
      transition: transform 140ms ease;
    }
    .event-ancestor-action-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      flex: 0 0 auto;
    }
    .event-ancestor-action-icon .codicon {
      font-size: 13px;
    }
    .status-group[open] .event-status-group-toggle {
      transform: rotate(90deg);
    }
    .ancestor-group[open] .event-ancestor-toggle {
      transform: rotate(90deg);
    }
    .status-group-children {
      display: grid;
      gap: 0;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .status-group-children .event-row {
      padding-left: 22px;
    }
    .ancestor-group-children {
      display: grid;
      gap: 0;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .ancestor-group-children .event-row {
      padding-left: 22px;
    }
    .event-chips {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 6px;
      align-self: start;
      align-items: flex-start;
      align-content: flex-start;
      min-width: 0;
    }
    .event-meta-chips,
    .event-meta-timing {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: flex-start;
    }
    .event-meta-timing {
      justify-content: flex-end;
      margin-left: auto;
    }
    .chip-separator {
      color: color-mix(in srgb, var(--muted) 88%, transparent);
      font-size: 11px;
      line-height: 1;
      align-self: center;
      margin: 0 -1px;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border: 1px solid var(--chip-border);
      background: var(--chip-bg);
      border-radius: 999px;
      padding: 2px 7px;
      color: var(--muted);
      max-width: 100%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .chip-tool {
      gap: 5px;
    }
    .chip-collapsible {
      position: relative;
      justify-content: center;
      overflow: visible;
    }
    .chip-tool.chip-collapsible,
    .chip-range.chip-collapsible {
      gap: 0;
    }
    .chip-collapsible .chip-hover-label {
      position: absolute;
      left: 50%;
      bottom: calc(100% + 6px);
      transform: translateX(-50%);
      z-index: 3;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 2px 7px;
      border: 1px solid var(--chip-border);
      background: color-mix(in srgb, var(--bg) 94%, var(--chip-bg));
      border-radius: 999px;
      box-shadow: 0 4px 14px color-mix(in srgb, black 22%, transparent);
      color: color-mix(in srgb, var(--fg) 84%, var(--muted));
      font-size: 10px;
      line-height: 1.1;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      white-space: nowrap;
      pointer-events: none;
      opacity: 0;
      transition: opacity 120ms ease;
    }
    .chip-collapsible:hover .chip-hover-label,
    .chip-collapsible:focus-within .chip-hover-label {
      opacity: 1;
    }
    .chip-icon {
      flex: 0 0 auto;
      line-height: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .chip-icon .codicon {
      font-size: 12px;
    }
    .chip-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .chip-param {
      max-width: min(20rem, 36vw);
    }
    .chip-time,
    .chip-status-phase,
    .activity-duration {
      font-variant-numeric: tabular-nums;
    }
    .chip-status-phase-warning {
      color: var(--vscode-editorWarning-foreground);
      border-color: color-mix(in srgb, var(--vscode-editorWarning-foreground) 26%, var(--chip-border));
      background: color-mix(in srgb, var(--vscode-editorWarning-foreground) 8%, var(--chip-bg));
    }
    .chip-status-phase-running {
      color: var(--vscode-progressBar-background);
      border-color: color-mix(in srgb, var(--vscode-progressBar-background) 26%, var(--chip-border));
      background: color-mix(in srgb, var(--vscode-progressBar-background) 8%, var(--chip-bg));
    }
    .chip-status-phase-completed {
      color: var(--vscode-terminal-ansiGreen);
      border-color: color-mix(in srgb, var(--vscode-terminal-ansiGreen) 26%, var(--chip-border));
      background: color-mix(in srgb, var(--vscode-terminal-ansiGreen) 8%, var(--chip-bg));
    }
    .chip-status-phase-error {
      color: var(--vscode-errorForeground);
      border-color: color-mix(in srgb, var(--vscode-errorForeground) 26%, var(--chip-border));
      background: color-mix(in srgb, var(--vscode-errorForeground) 8%, var(--chip-bg));
    }
    .chip-status-phase-failure {
      color: var(--vscode-errorForeground);
      border-color: color-mix(in srgb, var(--vscode-errorForeground) 26%, var(--chip-border));
      background: color-mix(in srgb, var(--vscode-errorForeground) 8%, var(--chip-bg));
    }
    .activity-duration {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      justify-content: flex-end;
    }
    .activity-duration-label {
      color: color-mix(in srgb, var(--muted) 90%, transparent);
      text-transform: uppercase;
      font-size: 10px;
      letter-spacing: 0.04em;
      min-width: 3.6ch;
      text-align: right;
    }
    .activity-duration-value {
      display: inline-block;
      color: color-mix(in srgb, var(--fg) 86%, var(--muted));
      font-weight: 600;
      min-width: 4.8ch;
      text-align: right;
    }
    .chip-button {
      cursor: pointer;
      color: var(--accent);
      font: inherit;
      text-decoration: none;
    }
    .chip-button:hover,
    .chip-button:focus-visible {
      text-decoration: none;
      color: color-mix(in srgb, var(--accent) 72%, var(--fg));
      border-color: color-mix(in srgb, var(--accent) 34%, var(--chip-border));
      background: color-mix(in srgb, var(--accent) 10%, var(--chip-bg));
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 14%, transparent);
    }
    .event-request .event-icon,
    .event-ancestor .event-icon,
    .event-status .event-icon {
      color: color-mix(in srgb, var(--accent) 74%, var(--muted));
    }
    .event-ancestor .event-label {
      color: color-mix(in srgb, var(--accent-soft) 76%, var(--fg));
      letter-spacing: 0.02em;
    }
    .event-status-running.event-status-live .event-icon {
      color: var(--vscode-progressBar-background);
    }
    .event-status-running.event-status-settled .event-icon {
      color: var(--vscode-terminal-ansiGreen);
    }
    .event-status-warning .event-icon {
      color: var(--vscode-editorWarning-foreground);
    }
    .event-status-error .event-icon {
      color: var(--vscode-errorForeground);
    }
    .event-status-completed .event-icon {
      color: var(--vscode-terminal-ansiGreen);
    }
    .event-tool.event-outcome-success .event-icon { color: var(--vscode-terminal-ansiGreen); }
    .event-tool.event-outcome-running.event-kind-search .event-icon { color: var(--vscode-terminal-ansiGreen); }
    .event-tool.event-outcome-deferred .event-icon { color: var(--vscode-editorWarning-foreground); }
    .event-tool.event-outcome-failure .event-icon { color: var(--vscode-errorForeground); }
    .event-status-group-action-icon.event-status-group-phase-running,
    .event-status-group-action-icon.event-status-group-action-running {
      color: var(--vscode-progressBar-background);
    }
    .event-status-group-action-icon.event-status-group-phase-completed,
    .event-status-group-action-icon.event-status-group-action-success {
      color: var(--vscode-terminal-ansiGreen);
    }
    .event-status-group-action-icon.event-status-group-phase-warning,
    .event-status-group-action-icon.event-status-group-action-deferred {
      color: var(--vscode-editorWarning-foreground);
    }
    .event-status-group-action-icon.event-status-group-phase-error,
    .event-status-group-action-icon.event-status-group-action-failure {
      color: var(--vscode-errorForeground);
    }
    .empty-state {
      color: var(--muted);
      padding: 10px 2px;
      display: grid;
      gap: 6px;
    }
    .empty-state-title {
      color: color-mix(in srgb, var(--fg) 88%, var(--muted));
      font-weight: 600;
    }
    .empty-state-copy {
      max-width: 64ch;
      line-height: 1.45;
    }
    @media (max-width: 640px) {
      .toolset-grid {
        grid-template-columns: minmax(0, 1fr);
      }
      .event-row {
        grid-template-columns: minmax(0, 1fr);
        gap: 5px;
      }
      .event-chips {
        justify-content: flex-start;
      }
      .meta-status {
        width: 100%;
        margin-left: 0;
      }
    }
  </style>
</head>
<body>
  <div class="panel-root">
    <section class="header">
      <div class="header-top">
        <div class="title">
          ${renderRoleBadge(snapshot)}
          ${renderHeaderBadge("Model", snapshot.header.modelLabel, "header-badge-model")}
          ${renderHeaderMetadataBadges(snapshot)}
        </div>
        <div class="toolbar">
          ${hideToolbarControls
            ? ""
            : `${evidenceState.liveIndicator ? `<span class="toolbar-live-indicator" title="Evidence export is actively updating"></span>` : ""}
          ${snapshot.status.phase === "running" ? `<button class="toolbar-button" data-message='{"type":"stopRun"}' title="Request stop for the active TRACEABLE run">Stop</button>` : ""}
          ${evidenceState.showExport ? `<button class="toolbar-button" data-message='{"type":"exportMarkdown"}' title="Export raw markdown evidence">Export</button>` : ""}
          ${evidenceState.showView && evidenceState.filePath
            ? `<button class="${evidenceState.buttonClass}" data-message='${escapeHtml(JSON.stringify({ type: "openFile", filePath: evidenceState.filePath }))}' title="${escapeHtml(evidenceState.buttonTitle)}">View</button>`
            : ""}
          ${repairButtonMarkup}
          ${pinnedOpen
            ? `<button class="toolbar-button" data-message='{"type":"closePanel"}' title="Hide the traceable panel until it is reopened from the status bar">Close</button>`
            : `<button class="toolbar-button" data-message='{"type":"stayOpen"}' title="Keep TRACEABLE open and suppress auto-hide until you close it manually">Stay</button>`}`}
          ${showChatToggle ? `<button class="toolbar-button toolbar-button-chat-toggle" type="button" data-chat-toggle="true" aria-pressed="false" title="Toggle simplified chat projection">Chat</button>` : ""}
        </div>
      </div>
      <div class="meta">
        ${metaLead}
        ${metaStopwatches}
        ${renderMetaStatus(snapshot)}
      </div>
    </section>
    ${renderToolsetDisclosure(snapshot)}
    <ul class="events">${eventRows}</ul>
    <section class="chat-view">${renderChatProjection(snapshot)}${renderChatComposer(snapshot, chatSenderRoleOptions, chatCollapseMode)}</section>
  </div>
  <script>
    const vscodeApi = acquireVsCodeApi();
    const BOTTOM_FOLLOW_THRESHOLD_PX = 24;
    const CHAT_SCROLL_INTENT_WINDOW_MS = 1200;
    const defaultPanelState = {
      followLatest: true,
      scrollTop: 0,
      toolsetDisclosureOpen: false,
      requestExpandedById: {},
      outputExpandedById: {},
      handoffExpandedById: {},
      toolExpandedById: {},
      toolInputOpenById: {},
      toolOutputOpenById: {},
      ancestorGroupOpenById: {},
      namespaceOpenById: {},
      statusGroupOpenById: {},
      chatViewEnabled: ${initialChatViewEnabled ? "true" : "false"},
      chatComposerDraft: '',
      chatComposerFocused: false,
      restoreChatComposerFocusOnRunChange: false,
      chatSenderRole: ${JSON.stringify(initialChatSenderRole)},
      runId: ''
    };

    const coerceBooleanLike = (value, fallback = false) => {
      if (typeof value === 'boolean') {
        return value;
      }
      if (typeof value === 'number') {
        if (value === 1) {
          return true;
        }
        if (value === 0) {
          return false;
        }
      }
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1') {
          return true;
        }
        if (normalized === 'false' || normalized === '0') {
          return false;
        }
      }
      return fallback;
    };

    const normalizePanelChatSenderRoleIdentity = (value) => {
      return typeof value === 'string'
        ? value.replace(/\s*\([^)]*\)\s*/gu, ' ').trim().normalize('NFKC').toLowerCase()
        : '';
    };

    const reconcileRestoredChatSenderRole = (value) => {
      const restoredValue = typeof value === 'string' ? value.trim() : '';
      if (!restoredValue) {
        return '';
      }
      const preferredDefaultValue = typeof defaultPanelState.chatSenderRole === 'string'
        ? defaultPanelState.chatSenderRole.trim()
        : '';
      if (!preferredDefaultValue || restoredValue === preferredDefaultValue) {
        return restoredValue;
      }
      const restoredIdentity = normalizePanelChatSenderRoleIdentity(restoredValue);
      const preferredIdentity = normalizePanelChatSenderRoleIdentity(preferredDefaultValue);
      if (restoredIdentity && preferredIdentity && restoredIdentity === preferredIdentity) {
        return preferredDefaultValue;
      }
      return restoredValue;
    };

    const readPanelState = () => {
      const state = vscodeApi.getState();
      return state && typeof state === 'object'
        ? {
            followLatest: coerceBooleanLike(state.followLatest, true),
            scrollTop: typeof state.scrollTop === 'number' ? state.scrollTop : 0,
            toolsetDisclosureOpen: state.toolsetDisclosureOpen === true,
            requestExpandedById: state.requestExpandedById && typeof state.requestExpandedById === 'object'
              ? Object.fromEntries(Object.entries(state.requestExpandedById).filter(([key, value]) => typeof key === 'string' && typeof value === 'boolean'))
              : {},
            outputExpandedById: state.outputExpandedById && typeof state.outputExpandedById === 'object'
              ? Object.fromEntries(Object.entries(state.outputExpandedById).filter(([key, value]) => typeof key === 'string' && typeof value === 'boolean'))
              : {},
            handoffExpandedById: state.handoffExpandedById && typeof state.handoffExpandedById === 'object'
              ? Object.fromEntries(Object.entries(state.handoffExpandedById).filter(([key, value]) => typeof key === 'string' && typeof value === 'boolean'))
              : {},
            toolExpandedById: state.toolExpandedById && typeof state.toolExpandedById === 'object'
              ? Object.fromEntries(Object.entries(state.toolExpandedById).filter(([key, value]) => typeof key === 'string' && typeof value === 'boolean'))
              : {},
            toolInputOpenById: state.toolInputOpenById && typeof state.toolInputOpenById === 'object'
              ? Object.fromEntries(Object.entries(state.toolInputOpenById).filter(([key, value]) => typeof key === 'string' && typeof value === 'boolean'))
              : {},
            toolOutputOpenById: state.toolOutputOpenById && typeof state.toolOutputOpenById === 'object'
              ? Object.fromEntries(Object.entries(state.toolOutputOpenById).filter(([key, value]) => typeof key === 'string' && typeof value === 'boolean'))
              : {},
            ancestorGroupOpenById: state.ancestorGroupOpenById && typeof state.ancestorGroupOpenById === 'object'
              ? Object.fromEntries(Object.entries(state.ancestorGroupOpenById).filter(([key, value]) => typeof key === 'string' && typeof value === 'boolean'))
              : {},
            namespaceOpenById: state.namespaceOpenById && typeof state.namespaceOpenById === 'object'
              ? Object.fromEntries(Object.entries(state.namespaceOpenById).filter(([key, value]) => typeof key === 'string' && typeof value === 'boolean'))
              : {},
            statusGroupOpenById: state.statusGroupOpenById && typeof state.statusGroupOpenById === 'object'
              ? Object.fromEntries(Object.entries(state.statusGroupOpenById).filter(([key, value]) => typeof key === 'string' && typeof value === 'boolean'))
              : {},
            chatViewEnabled: coerceBooleanLike(state.chatViewEnabled, defaultPanelState.chatViewEnabled),
            chatComposerDraft: typeof state.chatComposerDraft === 'string' ? state.chatComposerDraft : '',
            chatComposerFocused: coerceBooleanLike(state.chatComposerFocused, false),
            restoreChatComposerFocusOnRunChange: coerceBooleanLike(state.restoreChatComposerFocusOnRunChange, false),
            chatSenderRole: reconcileRestoredChatSenderRole(state.chatSenderRole),
            runId: typeof state.runId === 'string' ? state.runId : ''
          }
        : defaultPanelState;
    };

    let panelState = readPanelState();
    let chatSubmitPending = false;
    let chatComposerHasFocus = false;
    let chatComposerHadFocusBeforeSubmit = false;
    let pendingChatComposerAutofocus = false;
    let suppressScrollStateSync = false;
    let initialChatViewApplyPending = true;
    let pendingFollowLatestLayoutSync = false;
    let lastManualChatScrollIntentAt = 0;
    const CHAT_COMPOSER_COMPACT_HEIGHT_THRESHOLD_PX = 430;
    const currentRunId = ${JSON.stringify(snapshot.startedAt)};
    const panelRoot = document.querySelector('.panel-root');
    const toolsetDisclosure = document.querySelector('.toolset-disclosure');
    const metaSection = document.querySelector('.meta');
    const eventsList = document.querySelector('.events');
    const chatViewSection = document.querySelector('.chat-view');
    const chatThread = document.querySelector('.chat-thread');
    const chatToggleButton = document.querySelector('[data-chat-toggle="true"]');
    const chatComposer = document.querySelector('[data-chat-composer="true"]');
    const chatInput = document.querySelector('[data-chat-input="true"]');
    const chatCompactInput = document.querySelector('[data-chat-input-compact="true"]');
    const chatSenderRolePicker = document.querySelector('[data-chat-sender-picker="true"]');
    const chatSenderRoleToggle = document.querySelector('[data-chat-sender-toggle="true"]');
    const chatSenderRoleCurrentLabel = document.querySelector('[data-chat-sender-current-label="true"]');
    const chatSenderRoleMenu = document.querySelector('[data-chat-sender-menu="true"]');
    const chatSenderRoleOptions = Array.from(document.querySelectorAll('[data-chat-sender-option="true"]'));
    const chatSendButton = document.querySelector('[data-chat-send="true"]');
    const messageTargets = Array.from(document.querySelectorAll('[data-message]'));
    const namespaceGroups = Array.from(document.querySelectorAll('.toolset-namespace-group[data-namespace-id]'));
    const statusGroups = Array.from(document.querySelectorAll('.status-group[data-status-group-id]'));
    const ancestorGroups = Array.from(document.querySelectorAll('.ancestor-group[data-ancestor-group-id]'));
    const timerNodes = Array.from(document.querySelectorAll('[data-timer-kind]'));
    const chatTimestampNodes = Array.from(document.querySelectorAll('[data-chat-timestamp]'));
    const requestRows = Array.from(document.querySelectorAll('.event-request[data-request-expandable="true"][data-request-id]'));
    const outputRows = Array.from(document.querySelectorAll('.event-output[data-output-expandable="true"][data-output-id]'));
    const handoffRows = Array.from(document.querySelectorAll('.event-handoff[data-handoff-expandable="true"][data-handoff-id]'));
    const toolRows = Array.from(document.querySelectorAll('.event-tool[data-tool-expandable="true"][data-tool-id]'));
    const toolToggleButtons = Array.from(document.querySelectorAll('.event-tool-main-toggle[data-tool-toggle-id]'));
    const toolInputDisclosures = Array.from(document.querySelectorAll('.event-tool-section-disclosure[data-tool-input-disclosure="true"][data-tool-input-id]'));
    const toolOutputDisclosures = Array.from(document.querySelectorAll('.event-tool-section-disclosure[data-tool-output-disclosure="true"][data-tool-output-id]'));
    const toolOutputSummaries = Array.from(document.querySelectorAll('.event-tool-section-disclosure[data-tool-output-disclosure="true"] > .event-tool-section-summary'));
    const copyButtons = Array.from(document.querySelectorAll('.event-tool-section-copy[data-copy-source-id], .event-tool-section-copy[data-copy-value]'));
    const isNestedInteractiveTarget = (target) => target instanceof HTMLElement
      && Boolean(target.closest('[data-message], button, a, summary, input, textarea, label'));

    const persistPanelState = (nextState) => {
      panelState = { ...panelState, ...nextState };
      vscodeApi.setState(panelState);
    };

    const syncChatComposerFocusState = () => {
      chatComposerHasFocus = document.activeElement === chatInput || document.activeElement === chatCompactInput;
      persistPanelState({ chatComposerFocused: chatComposerHasFocus });
    };

    const requestChatComposerAutofocus = () => {
      pendingChatComposerAutofocus = true;
    };

    const chatCollapseMode = chatComposer instanceof HTMLElement && chatComposer.dataset.chatCollapseMode === 'always' ? 'always' : 'auto';

    const syncChatComposerDraftControls = (value) => {
      if (chatInput instanceof HTMLTextAreaElement && chatInput.value !== value) {
        chatInput.value = value;
      }
      if (chatCompactInput instanceof HTMLInputElement && chatCompactInput.value !== value) {
        chatCompactInput.value = value;
      }
    };

    const resolveChatComposerCollapsed = () => {
      if (chatCollapseMode === 'always') {
        return true;
      }
      if (panelState.chatViewEnabled !== true) {
        return false;
      }
      const candidateHeights = [];
      if (chatViewSection instanceof HTMLElement && !chatViewSection.hidden && chatViewSection.clientHeight > 0) {
        candidateHeights.push(chatViewSection.clientHeight);
      }
      if (panelRoot instanceof HTMLElement && panelRoot.clientHeight > 0) {
        candidateHeights.push(panelRoot.clientHeight);
      }
      if (window.innerHeight > 0) {
        candidateHeights.push(window.innerHeight);
      }
      const availableHeight = candidateHeights.length > 0 ? Math.min(...candidateHeights) : 0;
      return availableHeight > 0 && availableHeight <= CHAT_COMPOSER_COMPACT_HEIGHT_THRESHOLD_PX;
    };

    const getActiveChatInputControl = () => {
      const collapsed = chatComposer instanceof HTMLElement && chatComposer.dataset.chatComposerCollapsed === 'true';
      if (collapsed && chatCompactInput instanceof HTMLInputElement) {
        return chatCompactInput;
      }
      if (chatInput instanceof HTMLTextAreaElement) {
        return chatInput;
      }
      return chatCompactInput instanceof HTMLInputElement ? chatCompactInput : undefined;
    };

    const applyChatComposerCollapseState = () => {
      const collapsed = resolveChatComposerCollapsed();
      if (chatComposer instanceof HTMLElement) {
        chatComposer.dataset.chatComposerCollapsed = collapsed ? 'true' : 'false';
      }
      if (chatCompactInput instanceof HTMLInputElement) {
        chatCompactInput.hidden = !collapsed;
      }
      if (chatInput instanceof HTMLTextAreaElement) {
        chatInput.hidden = collapsed;
      }
      syncChatComposerDraftControls(panelState.chatComposerDraft);
    };

    const dispatchDataMessage = (target) => {
      if (!(target instanceof HTMLElement)) {
        return false;
      }
      const message = target.getAttribute('data-message');
      if (!message) {
        return false;
      }
      try {
        vscodeApi.postMessage(JSON.parse(message));
        return true;
      } catch {
        return false;
      }
    };

    if (panelState.runId !== currentRunId) {
      const restoreChatComposerFocusOnRunChange = panelState.chatComposerFocused === true;
      persistPanelState({
        runId: currentRunId,
        followLatest: true,
        scrollTop: 0,
        requestExpandedById: {},
        outputExpandedById: {},
        handoffExpandedById: {},
        toolExpandedById: {},
        toolInputOpenById: {},
        toolOutputOpenById: {},
        ancestorGroupOpenById: {},
        namespaceOpenById: {},
        statusGroupOpenById: {},
        chatViewEnabled: restoreChatComposerFocusOnRunChange ? true : defaultPanelState.chatViewEnabled,
        chatComposerDraft: '',
        chatComposerFocused: false,
        restoreChatComposerFocusOnRunChange,
        chatSenderRole: defaultPanelState.chatSenderRole
      });
    }

    if (panelState.restoreChatComposerFocusOnRunChange === true) {
      requestChatComposerAutofocus();
      persistPanelState({ restoreChatComposerFocusOnRunChange: false });
    }

    for (const messageTarget of messageTargets) {
      if (!(messageTarget instanceof HTMLElement)) {
        continue;
      }
      messageTarget.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void dispatchDataMessage(messageTarget);
      });
    }

    const requestToolOutputLoad = (disclosure) => {
      if (!(disclosure instanceof HTMLDetailsElement)) {
        return;
      }
      if (disclosure.dataset.toolOutputNeedsLoad !== 'true') {
        return;
      }
      if (disclosure.dataset.toolOutputArmed !== 'true') {
        return;
      }
      const callId = disclosure.dataset.toolOutputId || '';
      if (!callId || disclosure.dataset.toolOutputRequested === 'true') {
        return;
      }
      disclosure.dataset.toolOutputRequested = 'true';
      try {
        vscodeApi.postMessage({ type: 'loadToolDetail', callId });
        window.setTimeout(() => {
          if (!disclosure.isConnected) {
            return;
          }
          if (disclosure.dataset.toolOutputRequested !== 'true' || disclosure.dataset.toolOutputNeedsLoad !== 'true') {
            return;
          }
          const body = disclosure.querySelector('.event-tool-section-body');
          if (!(body instanceof HTMLElement)) {
            return;
          }
          body.innerHTML = '<div class="event-tool-loading-fallback">No persisted tool output is available for this call in the current trace view.</div>';
          disclosure.dataset.toolOutputRequested = 'false';
        }, 1500);
      } catch {
        disclosure.dataset.toolOutputRequested = 'false';
      }
    };

    const parseTimestampMs = (value) => {
      const parsed = new Date(value || '').getTime();
      return Number.isFinite(parsed) ? parsed : undefined;
    };

    const parseActiveStarts = (value) => typeof value === 'string' && value
      ? value.split('|').map((entry) => entry.trim()).filter(Boolean)
      : [];

    const formatIsoLocalDate = (date) => String(date.getFullYear())
      + '-' + String(date.getMonth() + 1).padStart(2, '0')
      + '-' + String(date.getDate()).padStart(2, '0');

    const isSameLocalDay = (left, right) => left.getFullYear() === right.getFullYear()
      && left.getMonth() === right.getMonth()
      && left.getDate() === right.getDate();

    const formatElapsedMs = (elapsedMs) => {
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
        return '';
      }
      if (elapsedMs < 1000) {
        return String(Math.round(elapsedMs)) + 'ms';
      }
      if (elapsedMs < 60000) {
        const seconds = elapsedMs / 1000;
        return Number.isInteger(seconds) ? String(seconds) + 's' : seconds.toFixed(1) + 's';
      }
      const totalSeconds = Math.round(elapsedMs / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return String(minutes) + 'm ' + String(seconds).padStart(2, '0') + 's';
    };

    const formatFixedClockLabel = (value) => {
      const parsedAtMs = parseTimestampMs(value);
      if (!Number.isFinite(parsedAtMs)) {
        return '';
      }
      const timestamp = new Date(parsedAtMs);
      const timeLabel = new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        hourCycle: 'h23'
      }).format(timestamp);
      if (isSameLocalDay(timestamp, new Date())) {
        return timeLabel;
      }
      return formatIsoLocalDate(timestamp) + ' ' + timeLabel;
    };

    const formatChatRelativeLabel = (elapsedMs) => {
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
        return '';
      }
      const elapsedSeconds = Math.floor(elapsedMs / 1000);
      if (elapsedSeconds < 60) {
        return String(elapsedSeconds) + 's';
      }
      return String(Math.floor(elapsedSeconds / 60)) + 'm';
    };

    const computeActiveToolElapsedMs = (activeStarts, referenceIso) => {
      const referenceAtMs = parseTimestampMs(referenceIso);
      if (!Number.isFinite(referenceAtMs)) {
        return 0;
      }
      return activeStarts.reduce((total, startedAt) => {
        const startedAtMs = parseTimestampMs(startedAt);
        return total + (Number.isFinite(startedAtMs) ? Math.max(0, referenceAtMs - startedAtMs) : 0);
      }, 0);
    };

    const computeTimerElapsedMs = (timerNode, referenceIso) => {
      const timerKind = timerNode.dataset.timerKind || '';
      const startedAt = timerNode.dataset.startedAt || '';
      const updatedAt = timerNode.dataset.updatedAt || referenceIso;
      const effectiveReferenceIso = timerNode.dataset.running === 'true'
        ? (referenceIso || updatedAt || new Date().toISOString())
        : (updatedAt || referenceIso || new Date().toISOString());
      const baseElapsedMs = Number(timerNode.dataset.baseElapsedMs || '0');
      const activeSegmentKind = timerNode.dataset.activeSegmentKind || '';
      const updatedAtMs = parseTimestampMs(updatedAt);
      const referenceAtMs = parseTimestampMs(effectiveReferenceIso);
      const activeSegmentExtraMs = timerNode.dataset.running === 'true'
        && activeSegmentKind
        && Number.isFinite(updatedAtMs)
        && Number.isFinite(referenceAtMs)
        ? Math.max(0, referenceAtMs - updatedAtMs)
        : 0;
      if (timerKind === 'total') {
        return Math.max(0, baseElapsedMs + activeSegmentExtraMs);
      }
      if (timerKind === 'runtime') {
        return Math.max(0, baseElapsedMs + (activeSegmentKind === 'runtime' ? activeSegmentExtraMs : 0));
      }
      if (timerKind === 'tools') {
        return Math.max(0, baseElapsedMs + (activeSegmentKind === 'tool' ? activeSegmentExtraMs : 0));
      }
      if (timerKind === 'llm') {
        return Math.max(0, baseElapsedMs + (activeSegmentKind === 'llm' ? activeSegmentExtraMs : 0));
      }
      if (timerKind === 'event') {
        if (timerNode.dataset.running === 'true') {
          const startedAtMs = parseTimestampMs(startedAt);
          const referenceAtMs = parseTimestampMs(effectiveReferenceIso);
          return Number.isFinite(startedAtMs) && Number.isFinite(referenceAtMs) ? Math.max(0, referenceAtMs - startedAtMs) : 0;
        }
        return Math.max(0, baseElapsedMs);
      }
      return 0;
    };

    const applyTimers = (referenceIso) => {
      for (const timerNode of timerNodes) {
        if (!(timerNode instanceof HTMLElement)) {
          continue;
        }
        const valueNode = timerNode.querySelector('.meta-stopwatch-value, .activity-duration-value');
        const nextValue = formatElapsedMs(computeTimerElapsedMs(timerNode, referenceIso || timerNode.dataset.updatedAt || new Date().toISOString()));
        if (valueNode instanceof HTMLElement && nextValue) {
          valueNode.textContent = nextValue;
        }
      }
      for (const timestampNode of chatTimestampNodes) {
        if (!(timestampNode instanceof HTMLElement)) {
          continue;
        }
        const occurredAt = timestampNode.dataset.occurredAt || timestampNode.dataset.updatedAt || '';
        const updatedAt = timestampNode.dataset.updatedAt || occurredAt;
        const running = timestampNode.dataset.running === 'true';
        const referenceAtMs = parseTimestampMs(referenceIso || new Date().toISOString()) || Date.now();
        const occurredAtMs = parseTimestampMs(occurredAt) || referenceAtMs;
        const nextValue = running
          ? formatChatRelativeLabel(Math.max(0, referenceAtMs - occurredAtMs))
          : formatFixedClockLabel(updatedAt || occurredAt);
        if (nextValue) {
          timestampNode.textContent = nextValue;
        }
      }
    };

    applyTimers(new Date().toISOString());

    let timerInterval;
    if (
      timerNodes.some((timerNode) => timerNode instanceof HTMLElement && timerNode.dataset.running === 'true')
      || chatTimestampNodes.some((timestampNode) => timestampNode instanceof HTMLElement && timestampNode.dataset.running === 'true')
    ) {
      timerInterval = window.setInterval(() => {
        applyTimers(new Date().toISOString());
      }, 1000);
      window.addEventListener('beforeunload', () => {
        window.clearInterval(timerInterval);
      }, { once: true });
    }

    if (toolsetDisclosure instanceof HTMLDetailsElement) {
      toolsetDisclosure.open = panelState.toolsetDisclosureOpen;
      toolsetDisclosure.addEventListener('toggle', () => {
        persistPanelState({ toolsetDisclosureOpen: toolsetDisclosure.open });
      });
    }

    let applyingNamespaceDisclosureState = false;
    const applyNamespaceDisclosureState = () => {
      applyingNamespaceDisclosureState = true;
      try {
        for (const groupNode of namespaceGroups) {
          if (!(groupNode instanceof HTMLDetailsElement)) {
            continue;
          }
          const namespaceId = groupNode.dataset.namespaceId || '';
          const hasStoredState = Object.prototype.hasOwnProperty.call(panelState.namespaceOpenById, namespaceId);
          const defaultOpen = groupNode.dataset.defaultOpen === 'true';
          groupNode.open = hasStoredState ? panelState.namespaceOpenById[namespaceId] === true : defaultOpen;
        }
      } finally {
        applyingNamespaceDisclosureState = false;
      }
    };

    applyNamespaceDisclosureState();

    for (const groupNode of namespaceGroups) {
      if (!(groupNode instanceof HTMLDetailsElement)) {
        continue;
      }
      groupNode.addEventListener('toggle', () => {
        if (applyingNamespaceDisclosureState) {
          return;
        }
        const namespaceId = groupNode.dataset.namespaceId || '';
        persistPanelState({
          namespaceOpenById: {
            ...panelState.namespaceOpenById,
            [namespaceId]: groupNode.open
          }
        });
      });
    }

    let applyingAncestorGroupState = false;
    const applyAncestorGroupState = () => {
      applyingAncestorGroupState = true;
      try {
        for (const groupNode of ancestorGroups) {
          if (!(groupNode instanceof HTMLDetailsElement)) {
            continue;
          }
          const groupId = groupNode.dataset.ancestorGroupId || '';
          const hasStoredState = Object.prototype.hasOwnProperty.call(panelState.ancestorGroupOpenById, groupId);
          groupNode.open = hasStoredState ? panelState.ancestorGroupOpenById[groupId] === true : false;
        }
      } finally {
        applyingAncestorGroupState = false;
      }
    };

    applyAncestorGroupState();

    for (const groupNode of ancestorGroups) {
      if (!(groupNode instanceof HTMLDetailsElement)) {
        continue;
      }
      groupNode.addEventListener('toggle', () => {
        if (applyingAncestorGroupState) {
          return;
        }
        const groupId = groupNode.dataset.ancestorGroupId || '';
        persistPanelState({
          ancestorGroupOpenById: {
            ...panelState.ancestorGroupOpenById,
            [groupId]: groupNode.open
          }
        });
      });
    }


    const findChatSenderRoleOption = (value) => chatSenderRoleOptions.find((option) => option instanceof HTMLElement && (option.dataset.value || '') === value);

    const closeChatSenderMenu = ({ restoreFocus = false } = {}) => {
      if (chatSenderRolePicker instanceof HTMLElement) {
        chatSenderRolePicker.dataset.open = 'false';
      }
      if (chatSenderRoleToggle instanceof HTMLButtonElement) {
        chatSenderRoleToggle.setAttribute('aria-expanded', 'false');
      }
      if (chatSenderRoleMenu instanceof HTMLElement) {
        chatSenderRoleMenu.hidden = true;
      }
      if (restoreFocus && chatSenderRoleToggle instanceof HTMLButtonElement) {
        chatSenderRoleToggle.focus({ preventScroll: true });
      }
    };

    const applyChatSenderRoleState = () => {
      const selectedValue = findChatSenderRoleOption(panelState.chatSenderRole) ? panelState.chatSenderRole : '';
      const selectedOption = findChatSenderRoleOption(selectedValue) ?? findChatSenderRoleOption('');
      if (selectedValue !== panelState.chatSenderRole) {
        persistPanelState({ chatSenderRole: selectedValue });
      }
      if (chatSenderRoleCurrentLabel instanceof HTMLElement) {
        chatSenderRoleCurrentLabel.textContent = selectedOption?.dataset.label || '';
      }
      if (chatSenderRoleToggle instanceof HTMLButtonElement) {
        chatSenderRoleToggle.title = selectedValue || 'Sender role behind the current text, not the recipient agent role.';
      }
      for (const option of chatSenderRoleOptions) {
        if (!(option instanceof HTMLElement)) {
          continue;
        }
        const optionValue = option.dataset.value || '';
        option.dataset.selected = optionValue === selectedValue ? 'true' : 'false';
        option.setAttribute('aria-selected', optionValue === selectedValue ? 'true' : 'false');
      }
    };

    const updateChatComposerState = () => {
      if (!(chatSendButton instanceof HTMLButtonElement)) {
        return;
      }
      const baseDisabled = chatComposer instanceof HTMLElement && chatComposer.dataset.chatBaseDisabled === 'true';
      const isDisabled = baseDisabled || chatSubmitPending;
      syncChatComposerDraftControls(panelState.chatComposerDraft);
      if (chatInput instanceof HTMLTextAreaElement) {
        chatInput.readOnly = false;
      }
      if (chatCompactInput instanceof HTMLInputElement) {
        chatCompactInput.readOnly = false;
      }
      if (chatSenderRoleToggle instanceof HTMLButtonElement) {
        chatSenderRoleToggle.disabled = baseDisabled || chatSubmitPending;
        if (baseDisabled || chatSubmitPending) {
          closeChatSenderMenu();
        }
      }
      if (chatComposer instanceof HTMLElement) {
        chatComposer.classList.toggle('chat-composer-pending', chatSubmitPending);
      }
      applyChatSenderRoleState();
      const activeInput = getActiveChatInputControl();
      const hasDraft = (activeInput?.value || '').trim().length > 0;
      chatSendButton.disabled = isDisabled || !hasDraft;
      chatSendButton.textContent = chatSubmitPending ? 'Sending...' : 'Send';
    };

    const focusChatComposerInput = () => {
      if (panelState.chatViewEnabled !== true) {
        return;
      }
      if (chatSubmitPending) {
        return;
      }
      if (!pendingChatComposerAutofocus) {
        return;
      }
      requestAnimationFrame(() => {
        const activeInput = getActiveChatInputControl();
        if (!(activeInput instanceof HTMLTextAreaElement) && !(activeInput instanceof HTMLInputElement)) {
          return;
        }
        if (document.activeElement === activeInput) {
          pendingChatComposerAutofocus = false;
          syncChatComposerFocusState();
          return;
        }
        try {
          activeInput.focus({ preventScroll: true });
          const valueLength = activeInput.value.length;
          activeInput.setSelectionRange(valueLength, valueLength);
          pendingChatComposerAutofocus = false;
          syncChatComposerFocusState();
        } catch {
          activeInput.focus();
          pendingChatComposerAutofocus = false;
          syncChatComposerFocusState();
        }
      });
    };

    const applyChatViewState = () => {
      const chatViewEnabled = panelState.chatViewEnabled === true;
      try {
        if (panelRoot instanceof HTMLElement) {
          panelRoot.classList.toggle('chat-view-active', chatViewEnabled);
        }
        if (metaSection instanceof HTMLElement) {
          metaSection.hidden = false;
        }
        if (toolsetDisclosure instanceof HTMLElement) {
          toolsetDisclosure.hidden = chatViewEnabled;
        }
        if (eventsList instanceof HTMLElement) {
          eventsList.hidden = chatViewEnabled;
        }
        if (chatViewSection instanceof HTMLElement) {
          chatViewSection.hidden = !chatViewEnabled;
          chatViewSection.style.display = chatViewEnabled ? 'grid' : 'none';
        }
        if (chatToggleButton instanceof HTMLButtonElement) {
          chatToggleButton.setAttribute('aria-pressed', chatViewEnabled ? 'true' : 'false');
          chatToggleButton.textContent = chatViewEnabled ? 'Detailed' : 'Chat';
        }
        applyChatComposerCollapseState();
        updateChatComposerState();
        focusChatComposerInput();
        if (chatViewEnabled) {
          if (initialChatViewApplyPending) {
            requestAnimationFrame(() => {
              queueChatViewActivationScroll();
            });
          } else {
            queueChatViewActivationScroll();
          }
        }
      } finally {
        initialChatViewApplyPending = false;
      }
    };

    const toggleChatView = () => {
      const nextChatViewEnabled = panelState.chatViewEnabled !== true;
      if (nextChatViewEnabled) {
        requestChatComposerAutofocus();
      }
      persistPanelState({
        chatViewEnabled: nextChatViewEnabled,
        ...(nextChatViewEnabled ? { followLatest: true } : {})
      });
      applyChatViewState();
      if (nextChatViewEnabled) {
        scheduleScrollToLatestEvent();
      }
    };

    applyChatViewState();

    const handleChatComposerInput = (value) => {
      persistPanelState({ chatComposerDraft: value });
      syncChatComposerDraftControls(value);
      updateChatComposerState();
    };

    if (chatToggleButton instanceof HTMLButtonElement) {
      chatToggleButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleChatView();
      });
      chatToggleButton.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        toggleChatView();
      });
    }

    if (chatInput instanceof HTMLTextAreaElement) {
      chatInput.addEventListener('input', () => {
        handleChatComposerInput(chatInput.value);
      });
      chatInput.addEventListener('focus', () => {
        syncChatComposerFocusState();
      });
      chatInput.addEventListener('blur', () => {
        requestAnimationFrame(() => {
          syncChatComposerFocusState();
        });
      });
      chatInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.shiftKey) {
          return;
        }
        event.preventDefault();
        if (chatSendButton instanceof HTMLButtonElement && !chatSendButton.disabled) {
          chatSendButton.click();
        }
      });
    }

    if (chatCompactInput instanceof HTMLInputElement) {
      chatCompactInput.addEventListener('input', () => {
        handleChatComposerInput(chatCompactInput.value);
      });
      chatCompactInput.addEventListener('focus', () => {
        syncChatComposerFocusState();
      });
      chatCompactInput.addEventListener('blur', () => {
        requestAnimationFrame(() => {
          syncChatComposerFocusState();
        });
      });
      chatCompactInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') {
          return;
        }
        event.preventDefault();
        if (chatSendButton instanceof HTMLButtonElement && !chatSendButton.disabled) {
          chatSendButton.click();
        }
      });
    }

    if (chatSenderRoleToggle instanceof HTMLButtonElement) {
      chatSenderRoleToggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (chatSenderRoleToggle.disabled) {
          return;
        }
        const nextOpen = chatSenderRolePicker instanceof HTMLElement && chatSenderRolePicker.dataset.open === 'true' ? 'false' : 'true';
        if (chatSenderRolePicker instanceof HTMLElement) {
          chatSenderRolePicker.dataset.open = nextOpen;
        }
        chatSenderRoleToggle.setAttribute('aria-expanded', nextOpen === 'true' ? 'true' : 'false');
        if (chatSenderRoleMenu instanceof HTMLElement) {
          chatSenderRoleMenu.hidden = nextOpen !== 'true';
        }
      });
      chatSenderRoleToggle.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          chatSenderRoleToggle.click();
        }
      });
    }

    for (const option of chatSenderRoleOptions) {
      if (!(option instanceof HTMLButtonElement)) {
        continue;
      }
      option.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        persistPanelState({ chatSenderRole: option.dataset.value || '' });
        applyChatSenderRoleState();
        closeChatSenderMenu({ restoreFocus: true });
      });
      option.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return;
        }
        event.preventDefault();
        option.click();
      });
    }

    document.addEventListener('click', (event) => {
      if (!(event.target instanceof HTMLElement)) {
        closeChatSenderMenu();
        return;
      }
      if (!event.target.closest('[data-chat-sender-picker="true"]')) {
        closeChatSenderMenu();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeChatSenderMenu({ restoreFocus: true });
      }
    });

    applyChatSenderRoleState();

    if (chatSendButton instanceof HTMLButtonElement) {
      chatSendButton.addEventListener('click', () => {
        const activeInput = getActiveChatInputControl();
        if (((!(activeInput instanceof HTMLTextAreaElement)) && (!(activeInput instanceof HTMLInputElement))) || !(chatComposer instanceof HTMLElement)) {
          return;
        }
        const prompt = activeInput.value.trim();
        const tracePath = chatComposer.dataset.chatTracePath || '';
        const parentRoles = typeof panelState.chatSenderRole === 'string' && panelState.chatSenderRole.trim()
          ? panelState.chatSenderRole.trim()
          : undefined;
        if (!prompt || !tracePath || chatSubmitPending) {
          updateChatComposerState();
          return;
        }
        chatComposerHadFocusBeforeSubmit = document.activeElement === activeInput || chatComposerHasFocus;
        pendingChatComposerAutofocus = false;
        chatSubmitPending = true;
        closeChatSenderMenu();
        updateChatComposerState();
        persistPanelState({ chatComposerDraft: '' });
        syncChatComposerDraftControls('');
        vscodeApi.postMessage({ type: 'submitChatTurn', prompt, ...(parentRoles ? { parentRoles } : {}) });
      });
    }

    let applyingStatusGroupState = false;
    const applyStatusGroupState = () => {
      applyingStatusGroupState = true;
      try {
        for (const groupNode of statusGroups) {
          if (!(groupNode instanceof HTMLDetailsElement)) {
            continue;
          }
          const groupId = groupNode.dataset.statusGroupId || '';
          const hasStoredState = Object.prototype.hasOwnProperty.call(panelState.statusGroupOpenById, groupId);
          groupNode.open = hasStoredState ? panelState.statusGroupOpenById[groupId] === true : false;
        }
      } finally {
        applyingStatusGroupState = false;
      }
    };

    applyStatusGroupState();

    for (const groupNode of statusGroups) {
      if (!(groupNode instanceof HTMLDetailsElement)) {
        continue;
      }
      groupNode.addEventListener('toggle', () => {
        if (applyingStatusGroupState) {
          return;
        }
        const groupId = groupNode.dataset.statusGroupId || '';
        persistPanelState({
          statusGroupOpenById: {
            ...panelState.statusGroupOpenById,
            [groupId]: groupNode.open
          }
        });
      });
      for (const childStatusRow of Array.from(groupNode.querySelectorAll('.status-group-children .event-status'))) {
        if (!(childStatusRow instanceof HTMLElement)) {
          continue;
        }
        childStatusRow.addEventListener('click', () => {
          groupNode.open = false;
          const groupId = groupNode.dataset.statusGroupId || '';
          persistPanelState({
            statusGroupOpenById: {
              ...panelState.statusGroupOpenById,
              [groupId]: false
            }
          });
        });
      }
    }

    const applyRequestExpansion = () => {
      for (const requestRow of requestRows) {
        if (!(requestRow instanceof HTMLElement)) {
          continue;
        }
        const requestId = requestRow.dataset.requestId || '';
        const expanded = panelState.requestExpandedById?.[requestId] === true;
        requestRow.classList.toggle('request-expanded', expanded);
        requestRow.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      }
    };

    applyRequestExpansion();

    for (const requestRow of requestRows) {
      if (!(requestRow instanceof HTMLElement)) {
        continue;
      }
      const toggleRequestExpansion = () => {
        const requestId = requestRow.dataset.requestId || '';
        persistPanelState({
          requestExpandedById: {
            ...panelState.requestExpandedById,
            [requestId]: panelState.requestExpandedById?.[requestId] !== true
          }
        });
        applyRequestExpansion();
      };
      requestRow.addEventListener('click', (event) => {
        const target = event.target;
        if (isNestedInteractiveTarget(target)) {
          return;
        }
        toggleRequestExpansion();
      });
      requestRow.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return;
        }
        event.preventDefault();
        toggleRequestExpansion();
      });
    }

    const applyOutputExpansion = () => {
      for (const outputRow of outputRows) {
        if (!(outputRow instanceof HTMLElement)) {
          continue;
        }
        const outputId = outputRow.dataset.outputId || '';
        const expanded = panelState.outputExpandedById?.[outputId] === true;
        outputRow.classList.toggle('output-expanded', expanded);
        outputRow.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      }
    };

    applyOutputExpansion();

    for (const outputRow of outputRows) {
      if (!(outputRow instanceof HTMLElement)) {
        continue;
      }
      const toggleOutputExpansion = () => {
        const outputId = outputRow.dataset.outputId || '';
        persistPanelState({
          outputExpandedById: {
            ...panelState.outputExpandedById,
            [outputId]: panelState.outputExpandedById?.[outputId] !== true
          }
        });
        applyOutputExpansion();
      };
      outputRow.addEventListener('click', (event) => {
        const target = event.target;
        if (isNestedInteractiveTarget(target)) {
          return;
        }
        toggleOutputExpansion();
      });
      outputRow.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return;
        }
        event.preventDefault();
        toggleOutputExpansion();
      });
    }

    const applyHandoffExpansion = () => {
      for (const handoffRow of handoffRows) {
        if (!(handoffRow instanceof HTMLElement)) {
          continue;
        }
        const handoffId = handoffRow.dataset.handoffId || '';
        const expanded = panelState.handoffExpandedById?.[handoffId] === true;
        handoffRow.classList.toggle('handoff-expanded', expanded);
        handoffRow.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      }
    };

    applyHandoffExpansion();

    for (const handoffRow of handoffRows) {
      if (!(handoffRow instanceof HTMLElement)) {
        continue;
      }
      const toggleHandoffExpansion = () => {
        const handoffId = handoffRow.dataset.handoffId || '';
        persistPanelState({
          handoffExpandedById: {
            ...panelState.handoffExpandedById,
            [handoffId]: panelState.handoffExpandedById?.[handoffId] !== true
          }
        });
        applyHandoffExpansion();
      };
      handoffRow.addEventListener('click', (event) => {
        const target = event.target;
        if (isNestedInteractiveTarget(target)) {
          return;
        }
        toggleHandoffExpansion();
      });
      handoffRow.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return;
        }
        event.preventDefault();
        toggleHandoffExpansion();
      });
    }

    const applyToolExpansion = () => {
      for (const toolRow of toolRows) {
        if (!(toolRow instanceof HTMLElement)) {
          continue;
        }
        const toolId = toolRow.dataset.toolId || '';
        const expanded = panelState.toolExpandedById?.[toolId] === true;
        toolRow.classList.toggle('tool-expanded', expanded);
        toolRow.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      }
    };

    applyToolExpansion();

    const toggleToolExpansionById = (toolId) => {
      persistPanelState({
        toolExpandedById: {
          ...panelState.toolExpandedById,
          [toolId]: panelState.toolExpandedById?.[toolId] !== true
        }
      });
      applyToolExpansion();
    };

    for (const toolRow of toolRows) {
      if (!(toolRow instanceof HTMLElement)) {
        continue;
      }
      toolRow.addEventListener('click', (event) => {
        const target = event.target;
        if (isNestedInteractiveTarget(target)) {
          return;
        }
        toggleToolExpansionById(toolRow.dataset.toolId || '');
      });
      toolRow.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
          return;
        }
        event.preventDefault();
        toggleToolExpansionById(toolRow.dataset.toolId || '');
      });
    }

    for (const toggleButton of toolToggleButtons) {
      if (!(toggleButton instanceof HTMLButtonElement)) {
        continue;
      }
      toggleButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleToolExpansionById(toggleButton.dataset.toolToggleId || '');
      });
    }

    const applyToolInputDisclosureState = () => {
      for (const disclosure of toolInputDisclosures) {
        if (!(disclosure instanceof HTMLDetailsElement)) {
          continue;
        }
        const disclosureId = disclosure.dataset.toolInputId || '';
        disclosure.open = panelState.toolInputOpenById?.[disclosureId] === true;
      }
    };

    applyToolInputDisclosureState();

    for (const disclosure of toolInputDisclosures) {
      if (!(disclosure instanceof HTMLDetailsElement)) {
        continue;
      }
      disclosure.addEventListener('toggle', () => {
        const disclosureId = disclosure.dataset.toolInputId || '';
        persistPanelState({
          toolInputOpenById: {
            ...panelState.toolInputOpenById,
            [disclosureId]: disclosure.open
          }
        });
      });
    }

    const applyToolOutputDisclosureState = () => {
      for (const disclosure of toolOutputDisclosures) {
        if (!(disclosure instanceof HTMLDetailsElement)) {
          continue;
        }
        const disclosureId = disclosure.dataset.toolOutputId || '';
        disclosure.open = panelState.toolOutputOpenById?.[disclosureId] === true
          && disclosure.dataset.toolOutputNeedsLoad !== 'true';
      }
    };

    applyToolOutputDisclosureState();

    for (const summary of toolOutputSummaries) {
      if (!(summary instanceof HTMLElement)) {
        continue;
      }
      const disclosure = summary.closest('.event-tool-section-disclosure[data-tool-output-disclosure="true"]');
      if (!(disclosure instanceof HTMLDetailsElement)) {
        continue;
      }
      const armDisclosureLoad = () => {
        disclosure.dataset.toolOutputArmed = 'true';
      };
      summary.addEventListener('click', armDisclosureLoad);
      summary.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          armDisclosureLoad();
        }
      });
    }

    for (const disclosure of toolOutputDisclosures) {
      if (!(disclosure instanceof HTMLDetailsElement)) {
        continue;
      }
      disclosure.addEventListener('toggle', () => {
        const disclosureId = disclosure.dataset.toolOutputId || '';
        persistPanelState({
          toolOutputOpenById: {
            ...panelState.toolOutputOpenById,
            [disclosureId]: disclosure.open
          }
        });
        if (disclosure.open) {
          requestToolOutputLoad(disclosure);
          disclosure.dataset.toolOutputArmed = 'false';
        }
      });
    }

    const copyTextToClipboard = async (text) => {
      if (typeof text !== 'string' || text.length === 0) {
        return false;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      const fallback = document.createElement('textarea');
      fallback.value = text;
      fallback.setAttribute('readonly', 'true');
      fallback.style.position = 'fixed';
      fallback.style.opacity = '0';
      fallback.style.pointerEvents = 'none';
      document.body.appendChild(fallback);
      fallback.focus();
      fallback.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(fallback);
      return copied;
    };

    const markManualChatScrollIntent = () => {
      lastManualChatScrollIntentAt = Date.now();
    };

    const hasRecentManualChatScrollIntent = () => Date.now() - lastManualChatScrollIntentAt <= CHAT_SCROLL_INTENT_WINDOW_MS;

    for (const copyButton of copyButtons) {
      if (!(copyButton instanceof HTMLButtonElement)) {
        continue;
      }
      copyButton.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const sourceId = copyButton.dataset.copySourceId || '';
        const sourceNode = sourceId ? document.getElementById(sourceId) : null;
        const copyValue = sourceNode?.textContent || copyButton.dataset.copyValue || '';
        try {
          const copied = await copyTextToClipboard(copyValue);
          if (!copied) {
            return;
          }
          copyButton.classList.add('is-copied');
          const originalText = copyButton.textContent || 'Copy';
          copyButton.textContent = 'Copied';
          window.setTimeout(() => {
            copyButton.classList.remove('is-copied');
            copyButton.textContent = originalText;
          }, 1200);
        } catch {
          // ignore clipboard failures in the view layer
        }
      });
    }

    const getDocumentScrollingRoot = () => document.scrollingElement || document.documentElement || document.body;

    const getActiveScrollingRoot = () => {
      if (panelState.chatViewEnabled === true && chatThread instanceof HTMLElement) {
        return chatThread;
      }
      if (eventsList instanceof HTMLElement) {
        return eventsList;
      }
      return getDocumentScrollingRoot();
    };

    const scrollChatComposerIntoView = () => {
      if (panelState.chatViewEnabled !== true || !(chatComposer instanceof HTMLElement)) {
        return;
      }
      try {
        chatComposer.scrollIntoView({ block: 'end', inline: 'nearest' });
      } catch {
        chatComposer.scrollIntoView(false);
      }
    };

    const scrollChatThreadToBottom = () => {
      if (panelState.chatViewEnabled !== true || !(chatThread instanceof HTMLElement)) {
        return false;
      }
      const maxScrollTop = Math.max(0, chatThread.scrollHeight - chatThread.clientHeight);
      chatThread.scrollTop = maxScrollTop;
      chatThread.scrollLeft = 0;
      scrollChatComposerIntoView();
      return Math.abs(chatThread.scrollTop - maxScrollTop) <= 2;
    };

    const isNearBottom = () => {
      const scrollingRoot = getActiveScrollingRoot();
      if (!scrollingRoot) {
        return true;
      }
      return scrollingRoot.scrollHeight - scrollingRoot.clientHeight - scrollingRoot.scrollTop <= BOTTOM_FOLLOW_THRESHOLD_PX;
    };

    const scrollToLatestEvent = () => {
      if (scrollChatThreadToBottom()) {
        return;
      }
      const scrollingRoot = getActiveScrollingRoot();
      if (scrollingRoot) {
        scrollingRoot.scrollTop = scrollingRoot.scrollHeight;
        scrollingRoot.scrollLeft = 0;
      }
      if (!(scrollingRoot instanceof HTMLElement) || scrollingRoot === getDocumentScrollingRoot()) {
        window.scrollTo({ top: document.body.scrollHeight, left: 0, behavior: 'auto' });
      }
      scrollChatComposerIntoView();
    };

    const restoreScrollPosition = () => {
      const scrollingRoot = getActiveScrollingRoot();
      if (!scrollingRoot) {
        return;
      }
      if (panelState.followLatest) {
        scrollToLatestEvent();
        return;
      }
      const maxScrollTop = Math.max(0, scrollingRoot.scrollHeight - scrollingRoot.clientHeight);
      const restoredScrollTop = Math.max(0, Math.min(panelState.scrollTop, maxScrollTop));
      scrollingRoot.scrollTop = restoredScrollTop;
      scrollingRoot.scrollLeft = 0;
      if (!(scrollingRoot instanceof HTMLElement) || scrollingRoot === getDocumentScrollingRoot()) {
        window.scrollTo({ top: restoredScrollTop, left: 0, behavior: 'auto' });
      }
    };

    function queueChatViewActivationScroll() {
      if (panelState.chatViewEnabled !== true) {
        return;
      }
      persistPanelState({ followLatest: true });
      const applyActivationScroll = () => {
        suppressScrollStateSync = true;
        scheduleScrollToLatestEvent();
        persistPanelState({
          followLatest: true,
          scrollTop: getActiveScrollingRoot()?.scrollTop ?? panelState.scrollTop
        });
      };
      applyActivationScroll();
      requestAnimationFrame(() => applyActivationScroll());
      setTimeout(applyActivationScroll, 0);
      setTimeout(applyActivationScroll, 64);
      setTimeout(applyActivationScroll, 160);
      setTimeout(applyActivationScroll, 320);
      setTimeout(applyActivationScroll, 640);
      setTimeout(() => {
        suppressScrollStateSync = false;
      }, 760);
    }

    function scheduleScrollToLatestEvent() {
      const applyScroll = () => {
        if (panelState.followLatest) {
          scrollToLatestEvent();
          persistPanelState({ scrollTop: getActiveScrollingRoot()?.scrollTop ?? panelState.scrollTop });
          return;
        }
        restoreScrollPosition();
      };
      applyScroll();
      requestAnimationFrame(() => applyScroll());
      requestAnimationFrame(() => requestAnimationFrame(() => applyScroll()));
      setTimeout(applyScroll, 0);
      setTimeout(applyScroll, 32);
      setTimeout(applyScroll, 120);
      setTimeout(applyScroll, 260);
      setTimeout(applyScroll, 520);
    }

    const scheduleFollowLatestLayoutSync = () => {
      if (pendingFollowLatestLayoutSync || panelState.followLatest !== true) {
        return;
      }
      pendingFollowLatestLayoutSync = true;
      requestAnimationFrame(() => {
        pendingFollowLatestLayoutSync = false;
        if (panelState.followLatest !== true) {
          return;
        }
        scheduleScrollToLatestEvent();
      });
    };

    if (typeof ResizeObserver === 'function') {
      const followLatestLayoutObserver = new ResizeObserver(() => {
        applyChatComposerCollapseState();
        scheduleFollowLatestLayoutSync();
      });
      if (panelRoot instanceof HTMLElement) {
        followLatestLayoutObserver.observe(panelRoot);
      }
      if (chatViewSection instanceof HTMLElement) {
        followLatestLayoutObserver.observe(chatViewSection);
      }
      if (chatThread instanceof HTMLElement) {
        followLatestLayoutObserver.observe(chatThread);
      }
      if (eventsList instanceof HTMLElement) {
        followLatestLayoutObserver.observe(eventsList);
      }
      if (chatComposer instanceof HTMLElement) {
        followLatestLayoutObserver.observe(chatComposer);
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', scheduleScrollToLatestEvent, { once: true });
    } else {
      scheduleScrollToLatestEvent();
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && panelState.followLatest) {
        scheduleScrollToLatestEvent();
      }
    });

    window.addEventListener('focus', () => {
      if (panelState.followLatest) {
        scheduleScrollToLatestEvent();
      }
    });

    window.addEventListener('resize', () => {
      scheduleFollowLatestLayoutSync();
    });

    if (chatThread instanceof HTMLElement) {
      chatThread.addEventListener('wheel', () => {
        markManualChatScrollIntent();
      }, { passive: true });
      chatThread.addEventListener('touchmove', () => {
        markManualChatScrollIntent();
      }, { passive: true });
      chatThread.addEventListener('pointerdown', () => {
        markManualChatScrollIntent();
      }, { passive: true });
    }

    document.addEventListener('keydown', (event) => {
      if (panelState.chatViewEnabled !== true) {
        return;
      }
      if (!(chatThread instanceof HTMLElement)) {
        return;
      }
      if (!chatThread.matches(':hover') && !chatThread.contains(document.activeElement)) {
        return;
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'PageUp' || event.key === 'PageDown' || event.key === 'Home' || event.key === 'End' || event.key === ' ') {
        markManualChatScrollIntent();
      }
    });

    const handleActiveScroll = () => {
      if (suppressScrollStateSync) {
        return;
      }
      const scrollingRoot = getActiveScrollingRoot();
      const nearBottom = isNearBottom();
      if (panelState.chatViewEnabled === true && panelState.followLatest === true && !nearBottom && !hasRecentManualChatScrollIntent()) {
        persistPanelState({
          followLatest: true,
          scrollTop: scrollingRoot?.scrollTop ?? panelState.scrollTop
        });
        scheduleFollowLatestLayoutSync();
        return;
      }
      persistPanelState({
        followLatest: nearBottom,
        scrollTop: scrollingRoot?.scrollTop ?? panelState.scrollTop
      });
    };

    window.addEventListener('scroll', handleActiveScroll, { passive: true });

    if (chatThread instanceof HTMLElement) {
      chatThread.addEventListener('scroll', handleActiveScroll, { passive: true });
    }

    if (eventsList instanceof HTMLElement) {
      eventsList.addEventListener('scroll', handleActiveScroll, { passive: true });
    }

    window.addEventListener('message', (event) => {
      if (event?.data?.type === 'revealLatest') {
        if (event.data.focusComposer === true) {
          requestChatComposerAutofocus();
        }
        persistPanelState({ followLatest: true });
        scheduleScrollToLatestEvent();
        focusChatComposerInput();
        return;
      }
      if (event?.data?.type === 'chatSubmitState' && event.data.pending === false) {
        chatSubmitPending = false;
        if (chatComposerHadFocusBeforeSubmit) {
          requestChatComposerAutofocus();
        }
        chatComposerHadFocusBeforeSubmit = false;
        if (chatInput instanceof HTMLTextAreaElement) {
          chatInput.value = panelState.chatComposerDraft;
        }
        updateChatComposerState();
        focusChatComposerInput();
      }
    });

    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      const chatToggleTarget = target.closest('[data-chat-toggle="true"]');
      if (chatToggleTarget instanceof HTMLElement) {
        event.preventDefault();
        event.stopPropagation();
        toggleChatView();
        return;
      }
      const clickTarget = target.closest('[data-message]');
      if (!(clickTarget instanceof HTMLElement)) {
        return;
      }
      const message = clickTarget.getAttribute('data-message');
      if (!message) {
        return;
      }
      try {
        if (!dispatchDataMessage(clickTarget)) {
          return;
        }
      } catch {
        // ignore malformed payloads in the view layer
      }
    });
  </script>
</body>
</html>`;
}

export class TraceableSubagentStatusPanelProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private codiconCssHref: string | undefined;
  private pendingViewResolvers: Array<(view: vscode.WebviewView | undefined) => void> = [];
  private pinnedOpen = false;
  private loadedToolDetailsByCallId = new Map<string, PanelLoadedToolDetail>();
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
    status: { phase: "idle", message: "idle" },
    requestSummary: [],
    statusHistory: [],
    recentTools: [],
    startedAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onExportMarkdown: () => Promise<void>,
    private readonly onOpenFile: (target: string | TraceableResolvedPathTarget, startLine?: number, endLine?: number, baseDir?: string) => Promise<void>,
    private readonly onSubmitChatTurn: (input: { parentTracePath: string; userInput: string; parentRoles?: string | string[] }) => Promise<void>,
    private readonly getInitialChatViewEnabled: (snapshot: TraceableSubagentDetailSnapshot) => boolean,
    private readonly getChatCollapseMode: (snapshot: TraceableSubagentDetailSnapshot) => "auto" | "always",
    private readonly getChatSenderRoleOptions: (snapshot: TraceableSubagentDetailSnapshot) => Promise<PanelChatSenderRoleOption[]>,
    private readonly getDefaultChatSenderRole: (snapshot: TraceableSubagentDetailSnapshot) => Promise<string | undefined>,
    private readonly onLoadToolDetail: (callId: string) => Promise<PanelLoadedToolDetail | undefined>,
    private readonly onStopRun: () => Promise<void>,
    private readonly onClosePanel: () => Promise<void>,
    private readonly onStayOpen: () => Promise<void>
  ) {}

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;
    this.resolvePendingViewResolvers(webviewView);
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, ...TRACEABLE_PANEL_CODICON_PATH.slice(0, -1))]
    };
    this.codiconCssHref = webviewView.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, ...TRACEABLE_PANEL_CODICON_PATH)).toString();
    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = undefined;
      }
    });
    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (!message || typeof message.type !== "string") {
        return;
      }
      if (message.type === "exportMarkdown") {
        await this.onExportMarkdown();
        return;
      }
      if (message.type === "stopRun") {
        await this.onStopRun();
        return;
      }
      if (message.type === "closePanel") {
        await this.onClosePanel();
        return;
      }
      if (message.type === "stayOpen") {
        await this.onStayOpen();
        return;
      }
      if (message.type === "openFile") {
        const startLine = typeof message.startLine === "number" ? message.startLine : undefined;
        const endLine = typeof message.endLine === "number" ? message.endLine : undefined;
        if (isTraceableResolvedPathTarget(message.target)) {
          await this.onOpenFile(message.target, startLine, endLine);
          return;
        }
        if (typeof message.filePath !== "string") {
          return;
        }
        const baseDir = typeof message.baseDir === "string" ? message.baseDir : undefined;
        await this.onOpenFile(message.filePath, startLine, endLine, baseDir);
        return;
      }
      if (message.type === "submitChatTurn" && typeof message.prompt === "string") {
        const parentTracePath = this.snapshot.evidenceFile?.filePath?.trim();
        const userInput = message.prompt.trim();
        if (!parentTracePath || !userInput) {
          await this.view?.webview.postMessage({ type: "chatSubmitState", pending: false });
          return;
        }
        try {
          await this.onSubmitChatTurn({
            parentTracePath,
            userInput,
            parentRoles: typeof message.parentRoles === "string" || Array.isArray(message.parentRoles)
              ? message.parentRoles
              : undefined
          });
        } catch {
          await this.view?.webview.postMessage({ type: "chatSubmitState", pending: false });
          return;
        }
        return;
      }
      if (message.type === "loadToolDetail" && typeof message.callId === "string") {
        const callId = message.callId.trim();
        if (!callId) {
          return;
        }
        const detail = await this.onLoadToolDetail(callId);
        const resolvedDetail = detail ?? buildUnavailableToolDetail(
          this.snapshot.recentTools.find((entry) => entry.callId === callId) ?? {
            callId,
            toolName: "tool",
            phase: "failure"
          }
        );
        this.loadedToolDetailsByCallId.set(callId, resolvedDetail);
        await this.render();
      }
    });
    await this.render();
  }

  update(snapshot: TraceableSubagentDetailSnapshot): void {
    if (snapshot.startedAt === this.snapshot.startedAt) {
      const nextUpdatedAtMs = parseTraceablePanelSnapshotTimestampMs(snapshot.updatedAt);
      const currentUpdatedAtMs = parseTraceablePanelSnapshotTimestampMs(this.snapshot.updatedAt);
      if (nextUpdatedAtMs !== undefined && currentUpdatedAtMs !== undefined && nextUpdatedAtMs < currentUpdatedAtMs) {
        return;
      }
    }
    if (snapshot.startedAt !== this.snapshot.startedAt) {
      this.loadedToolDetailsByCallId.clear();
    }
    this.snapshot = snapshot;
    void this.render();
  }

  setPinnedOpen(pinnedOpen: boolean): void {
    if (this.pinnedOpen === pinnedOpen) {
      return;
    }
    this.pinnedOpen = pinnedOpen;
    void this.render();
  }

  async open(options: { reason?: "auto" | "manual"; focusComposer?: boolean } = {}): Promise<void> {
    const reason = options.reason === "manual" ? "manual" : "auto";
    if (!this.view) {
      await this.revealContainerUntilViewResolves(reason);
    }
    const view = await this.waitForView();
    view?.show?.(reason !== "manual");
    await view?.webview.postMessage({ type: "revealLatest", focusComposer: options.focusComposer === true });
  }

  dispose(): void {
    this.resolvePendingViewResolvers(undefined);
    this.view = undefined;
  }

  private waitForView(timeoutMs = 1500): Promise<vscode.WebviewView | undefined> {
    if (this.view) {
      return Promise.resolve(this.view);
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (view: vscode.WebviewView | undefined) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(view);
      };
      const timeout = setTimeout(() => {
        this.pendingViewResolvers = this.pendingViewResolvers.filter((candidate) => candidate !== finish);
        finish(this.view);
      }, timeoutMs);
      this.pendingViewResolvers.push(finish);
    });
  }

  private async revealContainerUntilViewResolves(reason: "auto" | "manual" = "manual"): Promise<void> {
    const startedAt = Date.now();
    while (!this.view && Date.now() - startedAt < 2000) {
      if (reason === "manual") {
        try {
          await vscode.commands.executeCommand("workbench.action.focusPanel");
        } catch {
          // Some hosts may not expose a direct panel focus command.
        }
        try {
          await vscode.commands.executeCommand(`${TRACEABLE_SUBAGENT_PANEL_VIEW_ID}.focus`);
        } catch {
          // Some hosts do not expose a direct focus command for contributed views.
        }
      }
      await vscode.commands.executeCommand(`workbench.view.extension.${TRACEABLE_SUBAGENT_PANEL_CONTAINER_ID}`);
      if (this.view) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
  }

  private resolvePendingViewResolvers(view: vscode.WebviewView | undefined): void {
    if (this.pendingViewResolvers.length === 0) {
      return;
    }
    const resolvers = [...this.pendingViewResolvers];
    this.pendingViewResolvers = [];
    for (const resolve of resolvers) {
      resolve(view);
    }
  }

  private async render(): Promise<void> {
    if (!this.view) {
      return;
    }
    const chatSenderRoleOptions = await this.getChatSenderRoleOptions(this.snapshot);
    const defaultChatSenderRole = await this.getDefaultChatSenderRole(this.snapshot);
    this.view.title = "Traceable";
    this.view.description = this.snapshot.status.message;
    this.view.webview.html = renderTraceableSubagentPanelHtml(this.snapshot, this.codiconCssHref, {
      initialChatViewEnabled: this.getInitialChatViewEnabled(this.snapshot),
      chatCollapseMode: this.getChatCollapseMode(this.snapshot),
      pinnedOpen: this.pinnedOpen,
      chatSenderRoleOptions,
      defaultChatSenderRole,
      loadedToolDetailsByCallId: this.loadedToolDetailsByCallId
    });
  }
}