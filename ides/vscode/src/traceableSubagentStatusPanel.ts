import * as vscode from "vscode";
import path from "node:path";
import type { TraceableSubagentDetailSnapshot } from "./traceableSubagentStatusDetail";
import { expandToolReferenceKeys, normalizeToolReferenceKey } from "./toolNameNormalization";

export const TRACEABLE_SUBAGENT_PANEL_CONTAINER_ID = "tiinexAiProvenanceTraceablePanel";
export const TRACEABLE_SUBAGENT_PANEL_VIEW_ID = "tiinex.aiProvenance.traceableStatus";
const TRACEABLE_PANEL_CODICON_PATH = ["node_modules", "@vscode", "codicons", "dist", "codicon.css"] as const;

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

type PanelActivityEntry =
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

function formatPanelUpdatedAt(updatedAt: string): string {
  const parsed = new Date(updatedAt);
  if (Number.isNaN(parsed.getTime())) {
    return updatedAt;
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(parsed);
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

function formatPanelClockTime(value: string | undefined): string | undefined {
  const parsed = parsePanelTimestampMs(value);
  if (parsed === undefined) {
    return undefined;
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(parsed));
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

function buildEventChips(event: PanelDisplayEvent): string[] {
  const chips: string[] = [];
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
  const filePath = event.filePath ?? "";
  if (filePath) {
    const fileName = path.basename(filePath);
    const hasSingleRange = event.ranges.length === 1;
    const startLine = hasSingleRange ? event.ranges[0]?.startLine : undefined;
    const endLine = hasSingleRange ? event.ranges[0]?.endLine : undefined;
    const payload = escapeHtml(JSON.stringify({ type: "openFile", filePath, startLine, endLine }));
    chips.push(`<button class="chip chip-button" data-message="${payload}" title="${escapeHtml(filePath)}">${escapeHtml(fileName)}</button>`);
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

function renderRequestSummaryBadge(item: PanelRequestSummaryItem, snapshot?: TraceableSubagentDetailSnapshot): string {
  const normalizedLabel = item.label.trim().toLowerCase();
  if (normalizedLabel === "track") {
    const trackClassName = item.value.trim().toLowerCase() === "candidate"
      ? "activity-request-badge header-badge-track-candidate"
      : "activity-request-badge header-badge-track-experimental";
    return renderHeaderBadge(item.label, item.value, trackClassName, item.title);
  }
  if (normalizedLabel === "model") {
    return renderHeaderBadge(item.label, item.value, "activity-request-badge header-badge-model", item.title);
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
      item.label,
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
    return `${countBadge}${renderHeaderBadge(item.label, item.value, "activity-request-badge", item.title)}`;
  }
  return renderHeaderBadge(item.label, item.value, "activity-request-badge", item.title);
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

function renderRequestSummaryChips(summary: PanelRequestSummaryItem[], snapshot?: TraceableSubagentDetailSnapshot): string {
  return summary
    .map((item) => renderRequestSummaryBadge(item, snapshot))
    .join("");
}

function renderRequestDetailSection(label: string, value: string): string {
  return [
    `<div class="event-request-detail-section">`,
    `<div class="event-request-detail-label">${escapeHtml(label)}</div>`,
    `<div class="event-request-detail-value">${escapeHtml(value)}</div>`,
    `</div>`
  ].join("");
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

function buildActivityEntries(snapshot: TraceableSubagentDetailSnapshot): PanelActivityEntry[] {
  const activities: PanelActivityEntry[] = [];
  if (snapshot.requestSummary.length > 0) {
    activities.push({
      kind: "request",
      id: "request-summary",
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

  return activities.sort((left, right) => {
    const leftOccurredAtMs = parsePanelTimestampMs(left.occurredAt) ?? Number.MAX_SAFE_INTEGER;
    const rightOccurredAtMs = parsePanelTimestampMs(right.occurredAt) ?? Number.MAX_SAFE_INTEGER;
    if (leftOccurredAtMs !== rightOccurredAtMs) {
      return leftOccurredAtMs - rightOccurredAtMs;
    }
    const order = { request: 0, status: 1, tool: 2, output: 3 } as const;
    return order[left.kind] - order[right.kind];
  });
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
  const clockLabel = formatPanelClockTime(occurredAt);
  if (clockLabel) {
    chips.push(`<span class="chip chip-time" title="Started ${escapeHtml(clockLabel)}">${escapeHtml(clockLabel)}</span>`);
  }
  if (durationMarkup) {
    chips.push(durationMarkup);
  }
  return `<div class="event-chips">${chips.join("")}</div>`;
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
      grouped.push({
        kind: "status-group",
        id: `${statusEntries[0].id}:${statusEntries[statusEntries.length - 1].id}`,
        occurredAt: statusEntries[0].occurredAt,
        entries: statusEntries
      });
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

function renderStatusGroupActivity(entry: Extract<PanelRenderedEntry, { kind: "status-group" }>): string {
  const firstEntry = entry.entries[0];
  const severityClass = entry.entries.some((child) => child.phase === "error")
    ? "status-group-severity-error"
    : entry.entries.some((child) => child.phase === "warning")
      ? "status-group-severity-warning"
      : entry.entries.some((child) => child.phase === "running")
        ? "status-group-severity-running"
        : entry.entries.some((child) => child.phase === "completed")
          ? "status-group-severity-completed"
          : "";
  const labelText = compactStatusGroupText(entry.entries.map((child) => child.message), 80);
  const noteText = compactStatusGroupText(
    entry.entries
      .map((child) => child.detail || deriveStatusTransparencyNote(child) || "")
      .filter(Boolean),
    120
  );
  const titleText = entry.entries.map((child) => child.message).join(" ... ");
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
  if (clockLabel) {
    chips.push(`<span class="chip chip-time" title="Started ${escapeHtml(clockLabel)}">${escapeHtml(clockLabel)}</span>`);
  }
  chips.push(...durationChips);
  const childRows = entry.entries.map((child) => renderStatusActivity(child)).join("");
  return [
    `<li class="status-group-item">`,
    `<details class="status-group ${severityClass}" data-status-group-id="${escapeHtml(entry.id)}">`,
    `<summary class="event-row event-status-group-summary" title="${escapeHtml(titleText)}">`,
    `<div class="event-body"><div class="event-main"><span class="event-icon event-status-group-toggle">${renderCodicon("chevron-right")}</span><span class="event-label">${escapeHtml(labelText)}</span></div>${noteText ? `<div class="event-note">${escapeHtml(noteText)}</div>` : ""}</div>`,
    `<div class="event-chips">${chips.join("")}</div>`,
    `</summary>`,
    `<ul class="status-group-children">${childRows}</ul>`,
    `</details>`,
    `</li>`
  ].join("");
}

function renderRequestActivity(entry: Extract<PanelActivityEntry, { kind: "request" }>): string {
  const { task, userInput, prominentMetadata, secondaryMetadata } = splitRequestSummary(entry.requestSummary, entry.snapshot);
  const noteText = task?.value?.trim() || "Compact launch parameters for this trace lane.";
  const noteTitleAttribute = task?.title ? ` title="${escapeHtml(task.title)}"` : "";
  const prominentMetadataMarkup = prominentMetadata.length > 0
    ? `<div class="event-chips event-request-primary-chips">${renderRequestSummaryChips(prominentMetadata, entry.snapshot)}</div>`
    : "";
  const secondaryMetadataMarkup = secondaryMetadata.length > 0
    ? `<div class="event-chips event-request-secondary-chips">${renderRequestSummaryChips(secondaryMetadata, entry.snapshot)}</div>`
    : "";
  const metadataMarkup = prominentMetadataMarkup || secondaryMetadataMarkup
    ? `<div class="event-request-chip-stack">${[prominentMetadataMarkup, secondaryMetadataMarkup].filter(Boolean).join("")}</div>`
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
  const expandableAttributes = expandable ? ' data-request-expandable="true" tabindex="0" role="button" aria-expanded="false"' : "";
  const summaryMarkup = noteText
    ? `<span class="event-summary-inline"><span class="event-summary-preview"${noteTitleAttribute}>${escapeHtml(noteText)}</span>${expandable ? `<span class="event-expand-indicator" aria-hidden="true">▸</span>` : ""}</span>`
    : expandable ? `<span class="event-expand-indicator" aria-hidden="true">▸</span>` : "";
  return [
    `<li class="event-row event-request" title="Traceable input"${expandableAttributes}>`,
    `<div class="event-body"><div class="event-main"><span class="event-icon">${renderCodicon("mail")}</span><span class="event-label">Input</span>${summaryMarkup}</div><div class="event-note"${noteTitleAttribute}>${escapeHtml(noteText)}</div>${detailSections ? `<div class="event-request-detail">${detailSections}</div>` : ""}</div>`,
    metadataMarkup,
    `</li>`
  ].join("");
}

function renderOutputActivity(entry: Extract<PanelActivityEntry, { kind: "output" }>): string {
  return [
    `<li class="event-row event-output" title="Final output returned to the parent lane">`,
    `<div class="event-body"><div class="event-main"><span class="event-icon">↩</span><span class="event-label">Output</span></div><div class="event-note">${escapeHtml(entry.text)}</div></div>`,
    renderActivityMeta(undefined, "", []),
    `</li>`
  ].join("");
}

function renderToolActivity(entry: Extract<PanelActivityEntry, { kind: "tool" }>): string {
  const event = entry.displayEvent;
  const title = (event.note ?? "") || event.event.toolName;
  const noteRow = event.note ? `<div class="event-note">${escapeHtml(event.note)}</div>` : "";
  const durationMarkup = renderActivityDuration(
    event.running ? "Live" : "For",
    event.baseElapsedMs,
    event.occurredAt,
    event.running,
    event.running ? "Current tool duration" : "Recorded tool duration"
  );
  return [
    `<li class="event-row event-tool event-kind-${event.kind.toLowerCase()} event-outcome-${event.outcome}" title="${escapeHtml(title)}">`,
    `<div class="event-body"><div class="event-main"><span class="event-icon">${escapeHtml(eventIcon(event))}</span><span class="event-label">${escapeHtml(eventLabel(event))}</span></div>${noteRow}</div>`,
    renderActivityMeta(event.occurredAt, durationMarkup, buildEventChips(event)),
    "</li>"
  ].join("");
}

function renderActivityRow(entry: PanelRenderedEntry): string {
  if (entry.kind === "status-group") {
    return renderStatusGroupActivity(entry);
  }
  if (entry.kind === "request") {
    return renderRequestActivity(entry);
  }
  if (entry.kind === "status") {
    return renderStatusActivity(entry);
  }
  if (entry.kind === "output") {
    return renderOutputActivity(entry);
  }
  return renderToolActivity(entry);
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
  if (!evidenceFile || evidenceFile.status === "idle") {
    return {
      showExport: true,
      showView: false,
      buttonClass: "toolbar-button",
      buttonTitle: "Export raw markdown evidence",
      liveIndicator: false
    };
  }
  if (evidenceFile.status === "writing") {
    return {
      showExport: false,
      showView: readableArtifact,
      buttonClass: "toolbar-button toolbar-button-export-live",
      buttonTitle: "View RAW markdown evidence file",
      filePath,
      liveIndicator: readableArtifact
    };
  }
  if (evidenceFile.status === "ready") {
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
  options: { pinnedOpen?: boolean; hideToolbarControls?: boolean } = {}
): string {
  const activities = buildActivityEntries(snapshot);
  const renderedEntries = groupActivityEntries(activities);
  const hasActivityFeed = renderedEntries.length > 0;
  const pinnedOpen = options.pinnedOpen === true;
  const hideToolbarControls = options.hideToolbarControls === true;
  const evidenceState = evidenceViewState(snapshot);
  const eventRows = hasActivityFeed
    ? renderedEntries.map((event) => renderActivityRow(event)).join("")
    : renderPanelEmptyState(snapshot);
  const updatedLabel = formatPanelUpdatedAt(snapshot.updatedAt);
  const runningState = snapshot.status.phase === "running" ? "true" : "false";
  const totalElapsedMs = totalTraceElapsedMs(snapshot);
  const toolElapsedMs = totalToolElapsedMs(snapshot);
  const thinkElapsedMs = Math.max(0, totalElapsedMs - toolElapsedMs);
  const runningToolStarts = runningToolStartTimes(snapshot).join("|");
  const totalStopwatch = renderMetaStopwatch(
    "Total",
    formatToolElapsedMs(totalElapsedMs),
    {
      timerKind: "total",
      startedAt: snapshot.startedAt,
      updatedAt: snapshot.updatedAt,
      running: runningState
    },
    "Total elapsed wall-clock time for this trace"
  );
  const toolStopwatch = renderMetaStopwatch(
    "Tools",
    formatToolElapsedMs(toolElapsedMs),
    {
      timerKind: "tools",
      baseElapsedMs: String(totalToolElapsedMs(snapshot, snapshot.updatedAt) - activeToolElapsedMs(snapshot, snapshot.updatedAt)),
      activeStarts: runningToolStarts,
      updatedAt: snapshot.updatedAt,
      running: runningState
    },
    "Accumulated runtime tool time recorded in this trace"
  );
  const thinkStopwatch = renderMetaStopwatch(
    "Think",
    formatToolElapsedMs(thinkElapsedMs),
    {
      timerKind: "think",
      startedAt: snapshot.startedAt,
      updatedAt: snapshot.updatedAt,
      baseElapsedMs: String(totalToolElapsedMs(snapshot, snapshot.updatedAt) - activeToolElapsedMs(snapshot, snapshot.updatedAt)),
      activeStarts: runningToolStarts,
      running: runningState
    },
    "Derived time: total wall-clock minus recorded tool time"
  );
  const metaLead = hasActivityFeed
    ? [
      renderHeaderBadge("Activities", String(activities.length), "header-badge-meta", `${activities.length} activit${activities.length === 1 ? "y" : "ies"}`),
      renderHeaderBadge("Updated", updatedLabel, "header-badge-meta", `Updated ${updatedLabel}`)
    ].join("")
    : `<span>${snapshot.status.phase === "running" ? "Preparing trace lane..." : "Ready"}</span>`;
  const metaStopwatches = hasActivityFeed ? `${totalStopwatch}${toolStopwatch}${thinkStopwatch}` : "";

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
    body {
      margin: 0;
      padding: 8px 10px 10px;
      background: var(--bg);
      color: var(--fg);
      font: 12px/1.35 var(--vscode-font-family);
    }
    .panel-root {
      display: grid;
      gap: 8px;
    }
    .header {
      display: grid;
      gap: 6px;
      position: sticky;
      top: 8px;
      z-index: 2;
      background: var(--bg);
      box-shadow: 0 -8px 0 0 var(--bg);
      border-bottom: 1px solid var(--border);
      padding: 0 0 8px;
    }
    .header-top {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .title {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 5px;
      min-width: 0;
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
    .toolbar-button:hover { background: var(--chip-bg); }
    .toolbar-button-export-live {
      border-color: color-mix(in srgb, var(--vscode-errorForeground) 66%, var(--chip-border));
    }
    .toolbar-button-export-ready {
      border-color: color-mix(in srgb, var(--vscode-terminal-ansiGreen) 60%, var(--chip-border));
    }
    .toolbar-button-export-failed {
      border-color: color-mix(in srgb, var(--vscode-errorForeground) 40%, var(--chip-border));
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
      padding: 0;
    }
    .event-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
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
      color: color-mix(in srgb, var(--accent) 78%, var(--fg));
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
    }
    .event-request .event-label {
      color: color-mix(in srgb, var(--accent) 78%, var(--fg));
      letter-spacing: 0.02em;
    }
    .event-request-chip-stack {
      display: grid;
      gap: 6px;
      justify-items: end;
      min-width: 0;
    }
    .event-request-primary-chips,
    .event-request-secondary-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      justify-content: flex-end;
    }
    .status-group-item {
      list-style: none;
    }
    .status-group {
      display: grid;
      gap: 0;
    }
    .status-group > summary {
      list-style: none;
    }
    .status-group > summary::-webkit-details-marker {
      display: none;
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
      color: color-mix(in srgb, var(--muted) 92%, transparent);
      transition: transform 140ms ease;
    }
    .status-group.status-group-severity-running .event-status-group-toggle {
      color: var(--vscode-progressBar-background);
    }
    .status-group.status-group-severity-completed .event-status-group-toggle {
      color: var(--vscode-terminal-ansiGreen);
    }
    .status-group.status-group-severity-warning .event-status-group-toggle {
      color: var(--vscode-editorWarning-foreground);
    }
    .status-group.status-group-severity-error .event-status-group-toggle {
      color: var(--vscode-errorForeground);
    }
    .status-group[open] .event-status-group-toggle {
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
    .event-chips {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 6px;
      align-items: center;
      min-width: 0;
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
      justify-content: center;
    }
    .chip-tool.chip-collapsible,
    .chip-range.chip-collapsible {
      gap: 0;
    }
    .chip-collapsible .chip-hover-label {
      max-width: 0;
      opacity: 0;
      overflow: hidden;
      white-space: nowrap;
      transition: max-width 140ms ease, opacity 120ms ease;
    }
    .chip-tool.chip-collapsible:hover,
    .chip-tool.chip-collapsible:focus-within {
      gap: 5px;
    }
    .chip-range.chip-collapsible:hover,
    .chip-range.chip-collapsible:focus-within {
      gap: 4px;
    }
    .chip-collapsible:hover .chip-hover-label,
    .chip-collapsible:focus-within .chip-hover-label {
      max-width: 120px;
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
    .chip-status-phase-failure {
      color: var(--vscode-errorForeground);
      border-color: color-mix(in srgb, var(--vscode-errorForeground) 26%, var(--chip-border));
      background: color-mix(in srgb, var(--vscode-errorForeground) 8%, var(--chip-bg));
    }
    .activity-duration {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .activity-duration-label {
      color: color-mix(in srgb, var(--muted) 90%, transparent);
      text-transform: uppercase;
      font-size: 10px;
      letter-spacing: 0.04em;
    }
    .activity-duration-value {
      color: color-mix(in srgb, var(--fg) 86%, var(--muted));
      font-weight: 600;
    }
    .chip-button {
      cursor: pointer;
      color: var(--accent);
      font: inherit;
    }
    .chip-button:hover { text-decoration: underline; }
    .event-request .event-icon,
    .event-status .event-icon {
      color: color-mix(in srgb, var(--accent) 74%, var(--muted));
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
          ${evidenceState.showExport ? `<button class="toolbar-button" data-message='{"type":"exportMarkdown"}' title="Export raw markdown evidence">Export</button>` : ""}
          ${evidenceState.showView && evidenceState.filePath
            ? `<button class="${evidenceState.buttonClass}" data-message='${escapeHtml(JSON.stringify({ type: "openFile", filePath: evidenceState.filePath }))}' title="${escapeHtml(evidenceState.buttonTitle)}">View</button>`
            : ""}
          ${pinnedOpen
            ? `<button class="toolbar-button" data-message='{"type":"closePanel"}' title="Hide the traceable panel until it is reopened from the status bar">Close</button>`
            : `<button class="toolbar-button" data-message='{"type":"stayOpen"}' title="Keep TRACEABLE open and suppress auto-hide until you close it manually">Stay</button>`}`}
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
  </div>
  <script>
    const vscodeApi = acquireVsCodeApi();
    const BOTTOM_FOLLOW_THRESHOLD_PX = 24;
    const defaultPanelState = {
      followLatest: true,
      scrollTop: 0,
      toolsetDisclosureOpen: false,
      requestExpanded: false,
      namespaceOpenById: {},
      statusGroupOpenById: {},
      runId: ''
    };

    const readPanelState = () => {
      const state = vscodeApi.getState();
      return state && typeof state === 'object'
        ? {
            followLatest: state.followLatest !== false,
            scrollTop: typeof state.scrollTop === 'number' ? state.scrollTop : 0,
            toolsetDisclosureOpen: state.toolsetDisclosureOpen === true,
            requestExpanded: state.requestExpanded === true,
            namespaceOpenById: state.namespaceOpenById && typeof state.namespaceOpenById === 'object'
              ? Object.fromEntries(Object.entries(state.namespaceOpenById).filter(([key, value]) => typeof key === 'string' && typeof value === 'boolean'))
              : {},
            statusGroupOpenById: state.statusGroupOpenById && typeof state.statusGroupOpenById === 'object'
              ? Object.fromEntries(Object.entries(state.statusGroupOpenById).filter(([key, value]) => typeof key === 'string' && typeof value === 'boolean'))
              : {},
            runId: typeof state.runId === 'string' ? state.runId : ''
          }
        : defaultPanelState;
    };

    let panelState = readPanelState();
    const currentRunId = ${JSON.stringify(snapshot.startedAt)};
    const toolsetDisclosure = document.querySelector('.toolset-disclosure');
    const namespaceGroups = Array.from(document.querySelectorAll('.toolset-namespace-group[data-namespace-id]'));
    const statusGroups = Array.from(document.querySelectorAll('.status-group[data-status-group-id]'));
    const timerNodes = Array.from(document.querySelectorAll('[data-timer-kind]'));
    const requestRow = document.querySelector('.event-request[data-request-expandable="true"]');

    const persistPanelState = (nextState) => {
      panelState = { ...panelState, ...nextState };
      vscodeApi.setState(panelState);
    };

    if (panelState.runId !== currentRunId) {
      persistPanelState({
        runId: currentRunId,
        namespaceOpenById: {},
        statusGroupOpenById: {}
      });
    }

    const parseTimestampMs = (value) => {
      const parsed = new Date(value || '').getTime();
      return Number.isFinite(parsed) ? parsed : undefined;
    };

    const parseActiveStarts = (value) => typeof value === 'string' && value
      ? value.split('|').map((entry) => entry.trim()).filter(Boolean)
      : [];

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
      const activeStarts = parseActiveStarts(timerNode.dataset.activeStarts || '');
      if (timerKind === 'total') {
        const startedAtMs = parseTimestampMs(startedAt);
        const referenceAtMs = parseTimestampMs(effectiveReferenceIso);
        return Number.isFinite(startedAtMs) && Number.isFinite(referenceAtMs) ? Math.max(0, referenceAtMs - startedAtMs) : 0;
      }
      if (timerKind === 'tools') {
        return Math.max(0, baseElapsedMs + computeActiveToolElapsedMs(activeStarts, effectiveReferenceIso));
      }
      if (timerKind === 'think') {
        const startedAtMs = parseTimestampMs(startedAt);
        const referenceAtMs = parseTimestampMs(effectiveReferenceIso);
        const totalElapsedMs = Number.isFinite(startedAtMs) && Number.isFinite(referenceAtMs) ? Math.max(0, referenceAtMs - startedAtMs) : 0;
        const toolElapsedMs = Math.max(0, baseElapsedMs + computeActiveToolElapsedMs(activeStarts, effectiveReferenceIso));
        return Math.max(0, totalElapsedMs - toolElapsedMs);
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
    };

    applyTimers(new Date().toISOString());

    let timerInterval;
    if (timerNodes.some((timerNode) => timerNode instanceof HTMLElement && timerNode.dataset.running === 'true')) {
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
      if (!(requestRow instanceof HTMLElement)) {
        return;
      }
      requestRow.classList.toggle('request-expanded', panelState.requestExpanded === true);
      requestRow.setAttribute('aria-expanded', panelState.requestExpanded === true ? 'true' : 'false');
    };

    applyRequestExpansion();

    if (requestRow instanceof HTMLElement) {
      const toggleRequestExpansion = () => {
        persistPanelState({ requestExpanded: panelState.requestExpanded !== true });
        applyRequestExpansion();
      };
      requestRow.addEventListener('click', (event) => {
        const target = event.target;
        if (target instanceof HTMLElement && target.closest('[data-message], button, a')) {
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

    const getScrollingRoot = () => document.scrollingElement || document.documentElement || document.body;

    const isNearBottom = () => {
      const scrollingRoot = getScrollingRoot();
      if (!scrollingRoot) {
        return true;
      }
      return scrollingRoot.scrollHeight - scrollingRoot.clientHeight - scrollingRoot.scrollTop <= BOTTOM_FOLLOW_THRESHOLD_PX;
    };

    const scrollToLatestEvent = () => {
      const scrollingRoot = getScrollingRoot();
      if (scrollingRoot) {
        scrollingRoot.scrollTop = scrollingRoot.scrollHeight;
        scrollingRoot.scrollLeft = 0;
      }
      window.scrollTo({ top: document.body.scrollHeight, left: 0, behavior: 'auto' });
    };

    const restoreScrollPosition = () => {
      const scrollingRoot = getScrollingRoot();
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
      window.scrollTo({ top: restoredScrollTop, left: 0, behavior: 'auto' });
    };

    const scheduleScrollToLatestEvent = () => {
      const applyScroll = () => {
        if (panelState.followLatest) {
          scrollToLatestEvent();
          persistPanelState({ scrollTop: getScrollingRoot()?.scrollTop ?? panelState.scrollTop });
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
    };

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

    window.addEventListener('scroll', () => {
      const scrollingRoot = getScrollingRoot();
      persistPanelState({
        followLatest: isNearBottom(),
        scrollTop: scrollingRoot?.scrollTop ?? panelState.scrollTop
      });
    }, { passive: true });

    window.addEventListener('message', (event) => {
      if (event?.data?.type === 'revealLatest') {
        persistPanelState({ followLatest: true });
        scheduleScrollToLatestEvent();
      }
    });

    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
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
        vscodeApi.postMessage(JSON.parse(message));
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
      toolSelectionRestricted: false
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
    private readonly onOpenFile: (filePath: string, startLine?: number, endLine?: number) => Promise<void>,
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
      if (message.type === "closePanel") {
        await this.onClosePanel();
        return;
      }
      if (message.type === "stayOpen") {
        await this.onStayOpen();
        return;
      }
      if (message.type === "openFile" && typeof message.filePath === "string") {
        const startLine = typeof message.startLine === "number" ? message.startLine : undefined;
        const endLine = typeof message.endLine === "number" ? message.endLine : undefined;
        await this.onOpenFile(message.filePath, startLine, endLine);
      }
    });
    await this.render();
  }

  update(snapshot: TraceableSubagentDetailSnapshot): void {
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

  async open(): Promise<void> {
    if (!this.view) {
      await this.revealContainerUntilViewResolves();
    }
    const view = await this.waitForView();
    view?.show?.(true);
    await view?.webview.postMessage({ type: "revealLatest" });
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

  private async revealContainerUntilViewResolves(): Promise<void> {
    const startedAt = Date.now();
    while (!this.view && Date.now() - startedAt < 2000) {
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
    this.view.title = "Traceable";
    this.view.description = this.snapshot.status.message;
    this.view.webview.html = renderTraceableSubagentPanelHtml(this.snapshot, this.codiconCssHref, {
      pinnedOpen: this.pinnedOpen
    });
  }
}