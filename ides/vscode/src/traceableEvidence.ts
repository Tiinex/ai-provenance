import {
  normalizeTraceableOutputMode,
  renderTraceableSubagentMarkdown,
  type TraceableSubagentRunResult
} from "./traceableContract";
import type { TraceableSubagentDetailSnapshot } from "./traceableSubagentStatusDetail";

export const TRACEABLE_EVIDENCE_STATE_SCHEMA = "tiinex.traceable-state.v1";

export interface ParsedTraceableEvidenceState {
  snapshot: TraceableSubagentDetailSnapshot;
  result?: TraceableSubagentRunResult;
}

export type TraceableEvidenceSurface =
  | "rendered-output"
  | "request-summary"
  | "summary"
  | "outcome"
  | "traceable-markdown"
  | "tool-ledger"
  | "status-history"
  | "tool-summary"
  | "file-summary"
  | "state-json";

export interface ViewTraceableSubagentInput {
  evidenceFilePath: string;
  reveal?: boolean;
  outputMode?: "summary-with-evidence-path" | "full-markdown-with-evidence-path" | "evidence-path-only";
  surface?: TraceableEvidenceSurface;
  maxItems?: number;
  offset?: number;
  includeSupportArtifacts?: boolean;
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

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getArrayLength(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : undefined;
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function getArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function selectLatestWindow<T>(items: T[], maxItems: number): { items: T[]; label: string } {
  if (items.length === 0) {
    return { items: [], label: "Showing 0/0 items." };
  }
  const selected = items.slice(-maxItems);
  return {
    items: selected,
    label: selected.length < items.length
      ? `Showing latest ${selected.length}/${items.length} items.`
      : `Showing ${selected.length}/${items.length} items.`
  };
}

export function normalizeTraceableViewSurface(value: unknown): TraceableEvidenceSurface | undefined {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (normalized) {
    case "rendered-output":
    case "request-summary":
    case "summary":
    case "outcome":
    case "traceable-markdown":
    case "tool-ledger":
    case "status-history":
    case "tool-summary":
    case "file-summary":
    case "state-json":
      return normalized;
    default:
      return undefined;
  }
}

export function clampTraceableViewItems(maxItems: number | undefined, fallback = 8): number {
  if (!Number.isFinite(maxItems)) {
    return fallback;
  }
  return Math.max(1, Math.min(50, Math.floor(maxItems as number)));
}

export function clampTraceableViewOffset(offset: number | undefined): number | undefined {
  if (!Number.isFinite(offset)) {
    return undefined;
  }
  return Math.max(0, Math.floor(offset as number));
}

export function selectTraceableWindow<T>(items: T[], maxItems: number, offset: number | undefined): { items: T[]; label: string } {
  if (items.length === 0) {
    return { items: [], label: "Showing 0/0 items." };
  }
  if (offset === undefined) {
    return selectLatestWindow(items, maxItems);
  }
  const start = Math.min(offset, items.length);
  const selected = items.slice(start, start + maxItems);
  const endExclusive = Math.min(start + selected.length, items.length);
  return {
    items: selected,
    label: `Showing items ${selected.length === 0 ? start : start + 1}-${endExclusive} of ${items.length}.`
  };
}

function getToolCalls(parsed: ParsedTraceableEvidenceState): Array<Record<string, unknown>> {
  return getArray<Record<string, unknown>>(parsed.result?.toolCalls);
}

function getStatusHistory(parsed: ParsedTraceableEvidenceState): Array<Record<string, unknown>> {
  return getArray<Record<string, unknown>>(parsed.snapshot.statusHistory);
}

function summarizeTraceableToolCalls(toolCalls: Array<Record<string, unknown>>): Array<{
  toolName: string;
  totalCalls: number;
  successCount: number;
  failureCount: number;
  notRunCount: number;
}> {
  const summaries = new Map<string, {
    toolName: string;
    totalCalls: number;
    successCount: number;
    failureCount: number;
    notRunCount: number;
  }>();
  for (const toolCall of toolCalls) {
    const toolName = getString(toolCall.toolName) ?? "unknown";
    const result = getString(toolCall.result) ?? "failure";
    const existing = summaries.get(toolName) ?? {
      toolName,
      totalCalls: 0,
      successCount: 0,
      failureCount: 0,
      notRunCount: 0
    };
    existing.totalCalls += 1;
    if (result === "success") {
      existing.successCount += 1;
    } else if (result === "notRun") {
      existing.notRunCount += 1;
    } else {
      existing.failureCount += 1;
    }
    summaries.set(toolName, existing);
  }
  return [...summaries.values()].sort((left, right) => right.totalCalls - left.totalCalls || left.toolName.localeCompare(right.toolName));
}

function extractTraceableReadFilePath(argsSummary: string | undefined): string | undefined {
  if (!argsSummary) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(argsSummary);
    if (parsed && typeof parsed === "object" && typeof (parsed as { filePath?: unknown }).filePath === "string") {
      const filePath = (parsed as { filePath: string }).filePath.trim();
      return filePath || undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function summarizeTraceableReadTargets(toolCalls: Array<Record<string, unknown>>): Array<{
  filePath: string;
  readCount: number;
}> {
  const summaries = new Map<string, number>();
  for (const toolCall of toolCalls) {
    const toolName = getString(toolCall.toolName) ?? "";
    if (!/readfile/i.test(toolName)) {
      continue;
    }
    const filePath = extractTraceableReadFilePath(getString(toolCall.argsSummary));
    if (!filePath) {
      continue;
    }
    summaries.set(filePath, (summaries.get(filePath) ?? 0) + 1);
  }
  return [...summaries.entries()]
    .map(([filePath, readCount]) => ({ filePath, readCount }))
    .sort((left, right) => right.readCount - left.readCount || left.filePath.localeCompare(right.filePath));
}

export function renderTraceableEvidenceSummaryMarkdown(input: {
  filePath: string;
  parsed: ParsedTraceableEvidenceState;
}): string {
  const snapshot = input.parsed.snapshot;
  const header = getRecord(snapshot.header) ?? {};
  const evidenceFile = getRecord(snapshot.evidenceFile) ?? {};
  const toolCalls = getArrayLength(input.parsed.result?.toolCalls);
  const statusCount = getArrayLength(snapshot.statusHistory);
  const recentToolCount = getArrayLength(snapshot.recentTools);
  const stepCount = getArrayLength(input.parsed.result?.steps);

  const lines = [
    "# TRACEABLE Evidence Summary",
    "",
    `- File: ${input.filePath}`,
    `- Schema: ${TRACEABLE_EVIDENCE_STATE_SCHEMA}`,
    `- Title: ${getString(header.displayTitle) ?? getString(header.agentName) ?? "-"}`,
    `- Role: ${getString(header.roleDisplay) ?? "-"}`,
    `- Model: ${getString(header.modelLabel) ?? "-"}`,
    `- Updated: ${getString(snapshot.updatedAt) ?? "-"}`,
    `- Export status: ${getString(evidenceFile.status) ?? "-"}`,
    `- Trace status: ${getString(input.parsed.result?.traceStatus) ?? "-"}`,
    `- Completion claim: ${getString(input.parsed.result?.completionClaim) ?? "-"}`,
    `- Tool calls: ${toolCalls ?? 0}`,
    `- Status events: ${statusCount ?? 0}`,
    `- Recent tools: ${recentToolCount ?? 0}`,
    `- Steps: ${stepCount ?? 0}`,
    ""
  ];

  const finalSummary = getString(input.parsed.result?.finalSummary);
  if (finalSummary) {
    lines.push("## Final Summary", "", finalSummary, "");
  }

  const validationIssues = input.parsed.result?.validationIssues;
  if (Array.isArray(validationIssues) && validationIssues.length > 0) {
    lines.push("## Validation Issues", "");
    for (const issue of validationIssues) {
      if (typeof issue === "string" && issue.trim()) {
        lines.push(`- ${issue.trim()}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function renderTraceableEvidenceRequestSummaryMarkdown(input: {
  filePath: string;
  parsed: ParsedTraceableEvidenceState;
  maxItems?: number;
  offset?: number;
}): string {
  const requestSummary = getArray<Record<string, unknown>>(input.parsed.snapshot.requestSummary);
  const maxItems = clampTraceableViewItems(input.maxItems);
  const offset = clampTraceableViewOffset(input.offset);
  const lines = [
    "# Traceable Evidence Request Summary",
    "",
    `- Evidence File: ${input.filePath}`,
    `- Requested Summary Items: ${requestSummary.length}`
  ];
  const window = selectTraceableWindow(requestSummary, maxItems, offset);
  const items = offset === undefined ? requestSummary.slice(0, maxItems) : window.items;
  if (items.length === 0) {
    lines.push("", "No request summary items were captured in this evidence artifact.");
    return `${lines.join("\n")}\n`;
  }
  lines.push("");
  for (const item of items) {
    lines.push(`- ${getString(item.label) ?? "-"}: ${getString(item.title) ?? getString(item.value) ?? "-"}`);
  }
  if (items.length < requestSummary.length || offset !== undefined) {
    lines.push("", offset === undefined
      ? `Showing ${items.length}/${requestSummary.length} request summary items.`
      : window.label);
  }
  return `${lines.join("\n")}\n`;
}

export function renderTraceableEvidenceOutcomeMarkdown(input: {
  filePath: string;
  parsed: ParsedTraceableEvidenceState;
}): string {
  const snapshot = input.parsed.snapshot;
  const status = getRecord(snapshot.status) ?? {};
  const result = input.parsed.result;
  const evidenceFile = getRecord(snapshot.evidenceFile) ?? {};
  const lines = [
    "# Traceable Evidence Outcome",
    "",
    `- Evidence File: ${input.filePath}`,
    `- Updated At: ${getString(snapshot.updatedAt) ?? "-"}`,
    `- Current Status: ${getString(status.phase) ?? "-"} | ${getString(status.message) ?? "-"}`
  ];
  if (!result) {
    lines.push(
      `- Evidence File Status: ${getString(evidenceFile.status) ?? "idle"}`,
      "- Final Run Result: unavailable in this evidence artifact"
    );
    return `${lines.join("\n")}\n`;
  }
  const model = getRecord(result.model) ?? {};
  lines.push(
    `- Trace Status: ${getString(result.traceStatus) ?? "-"}`,
    `- Stop Reason: ${getString(result.stopReason) ?? "-"}`,
    `- Completion Claim: ${getString(result.completionClaim) ?? "-"}`,
    `- Final Summary: ${getString(result.finalSummary) ?? "-"}`,
    `- Model: ${getString(model.vendor) && getString(model.family) && getString(model.id) ? `${getString(model.vendor)}/${getString(model.family)}/${getString(model.id)}` : "-"}`,
    `- Evidence File Status: ${getString(getRecord(result.evidenceFile)?.status) ?? getString(evidenceFile.status) ?? "idle"}`
  );
  return `${lines.join("\n")}\n`;
}

export function renderTraceableEvidenceTraceableMarkdown(input: {
  filePath: string;
  parsed: ParsedTraceableEvidenceState;
  includeSupportArtifacts?: boolean;
}): string {
  const result = input.parsed.result;
  if (!result) {
    return [
      "# Traceable Evidence Markdown",
      "",
      `- Evidence File: ${input.filePath}`,
      "",
      "This evidence artifact does not contain a final TRACEABLE run result, so markdown reconstruction is unavailable.",
      ""
    ].join("\n");
  }

  return renderTraceableSubagentMarkdown(result, {
    mode: "absolute-file-uri-markdown",
    includeSupportArtifacts: input.includeSupportArtifacts ?? true
  });
}

export function renderTraceableEvidenceToolLedgerMarkdown(input: {
  filePath: string;
  parsed: ParsedTraceableEvidenceState;
  maxItems?: number;
  offset?: number;
}): string {
  const maxItems = clampTraceableViewItems(input.maxItems, 10);
  const offset = clampTraceableViewOffset(input.offset);
  const toolCalls = getToolCalls(input.parsed);
  const lines = [
    "# Traceable Evidence Tool Ledger",
    "",
    `- Evidence File: ${input.filePath}`,
    `- Tool Calls Recorded: ${toolCalls.length}`
  ];
  if (toolCalls.length === 0) {
    lines.push("", "No tool call ledger was captured in this evidence artifact.");
    return `${lines.join("\n")}\n`;
  }
  const window = selectTraceableWindow(toolCalls, maxItems, offset);
  lines.push("");
  for (const toolCall of window.items) {
    lines.push(`- ${getString(toolCall.toolName) ?? "unknown"}`);
    lines.push(`  - Result: ${getString(toolCall.result) ?? "-"}`);
    lines.push(`  - Call Id: ${getString(toolCall.callId) ?? "-"}`);
    lines.push(`  - Args: ${getString(toolCall.argsSummary) ?? "-"}`);
    lines.push(`  - Note: ${getString(toolCall.note) ?? "-"}`);
  }
  if (window.items.length < toolCalls.length || offset !== undefined) {
    lines.push("", window.label.replace("items", "tool calls"));
  }
  return `${lines.join("\n")}\n`;
}

export function renderTraceableEvidenceStatusHistoryMarkdown(input: {
  filePath: string;
  parsed: ParsedTraceableEvidenceState;
  maxItems?: number;
  offset?: number;
}): string {
  const maxItems = clampTraceableViewItems(input.maxItems, 10);
  const offset = clampTraceableViewOffset(input.offset);
  const history = getStatusHistory(input.parsed);
  const lines = [
    "# Traceable Evidence Status History",
    "",
    `- Evidence File: ${input.filePath}`,
    `- Status Events Recorded: ${history.length}`
  ];
  if (history.length === 0) {
    lines.push("", "No status history was captured in this evidence artifact.");
    return `${lines.join("\n")}\n`;
  }
  const window = selectTraceableWindow(history, maxItems, offset);
  lines.push("");
  for (const event of window.items) {
    lines.push(`- ${getString(event.phase) ?? "-"} | ${getString(event.message) ?? "-"}`);
    lines.push(`  - Occurred At: ${getString(event.occurredAt) ?? "-"}`);
    lines.push(`  - Detail: ${getString(event.detail) ?? "-"}`);
  }
  if (window.items.length < history.length || offset !== undefined) {
    lines.push("", window.label.replace("items", "status events"));
  }
  return `${lines.join("\n")}\n`;
}

export function renderTraceableEvidenceToolSummaryMarkdown(input: {
  filePath: string;
  parsed: ParsedTraceableEvidenceState;
  maxItems?: number;
  offset?: number;
}): string {
  const maxItems = clampTraceableViewItems(input.maxItems, 10);
  const offset = clampTraceableViewOffset(input.offset);
  const summaries = summarizeTraceableToolCalls(getToolCalls(input.parsed));
  const lines = [
    "# Traceable Evidence Tool Summary",
    "",
    `- Evidence File: ${input.filePath}`,
    `- Distinct Tools: ${summaries.length}`,
    `- Tool Calls Recorded: ${getToolCalls(input.parsed).length}`
  ];
  if (summaries.length === 0) {
    lines.push("", "No tool call summary was available in this evidence artifact.");
    return `${lines.join("\n")}\n`;
  }
  const window = selectTraceableWindow(summaries, maxItems, offset);
  lines.push("");
  for (const summary of window.items) {
    lines.push(`- ${summary.toolName}`);
    lines.push(`  - Total Calls: ${summary.totalCalls}`);
    lines.push(`  - Success: ${summary.successCount}`);
    lines.push(`  - Failure/Timeout/Input Needed: ${summary.failureCount}`);
    lines.push(`  - Not Run: ${summary.notRunCount}`);
  }
  if (window.items.length < summaries.length || offset !== undefined) {
    lines.push("", window.label.replace("items", "tool summaries"));
  }
  return `${lines.join("\n")}\n`;
}

export function renderTraceableEvidenceFileSummaryMarkdown(input: {
  filePath: string;
  parsed: ParsedTraceableEvidenceState;
  maxItems?: number;
  offset?: number;
}): string {
  const maxItems = clampTraceableViewItems(input.maxItems, 10);
  const offset = clampTraceableViewOffset(input.offset);
  const summaries = summarizeTraceableReadTargets(getToolCalls(input.parsed));
  const lines = [
    "# Traceable Evidence File Summary",
    "",
    `- Evidence File: ${input.filePath}`,
    `- Distinct Read Targets: ${summaries.length}`
  ];
  if (summaries.length === 0) {
    lines.push("", "No read-file targets were surfaced in this evidence artifact.");
    return `${lines.join("\n")}\n`;
  }
  const window = selectTraceableWindow(summaries, maxItems, offset);
  lines.push("");
  for (const summary of window.items) {
    lines.push(`- ${summary.filePath}`);
    lines.push(`  - Read Count: ${summary.readCount}`);
  }
  if (window.items.length < summaries.length || offset !== undefined) {
    lines.push("", window.label.replace("items", "file summaries"));
  }
  return `${lines.join("\n")}\n`;
}

export function renderTraceableEvidenceStateJsonMarkdown(input: {
  filePath: string;
  parsed: ParsedTraceableEvidenceState;
}): string {
  const envelope = {
    snapshot: input.parsed.snapshot,
    result: input.parsed.result
  };
  return [
    "# Traceable Evidence State JSON",
    "",
    `- Evidence File: ${input.filePath}`,
    "",
    "```json",
    JSON.stringify(envelope, null, 2),
    "```",
    ""
  ].join("\n");
}

export function renderTraceableEvidenceSurfaceMarkdown(input: {
  filePath: string;
  parsed: ParsedTraceableEvidenceState;
  surface: TraceableEvidenceSurface;
  maxItems?: number;
  offset?: number;
  includeSupportArtifacts?: boolean;
}): string {
  switch (input.surface) {
    case "request-summary":
      return renderTraceableEvidenceRequestSummaryMarkdown(input);
    case "outcome":
      return renderTraceableEvidenceOutcomeMarkdown(input);
    case "rendered-output":
    case "traceable-markdown":
      return renderTraceableEvidenceTraceableMarkdown(input);
    case "tool-ledger":
      return renderTraceableEvidenceToolLedgerMarkdown(input);
    case "status-history":
      return renderTraceableEvidenceStatusHistoryMarkdown(input);
    case "tool-summary":
      return renderTraceableEvidenceToolSummaryMarkdown(input);
    case "file-summary":
      return renderTraceableEvidenceFileSummaryMarkdown(input);
    case "state-json":
      return renderTraceableEvidenceStateJsonMarkdown(input);
    case "summary":
    default:
      return renderTraceableEvidenceSummaryMarkdown(input);
  }
}

export function renderViewTraceableSubagentMarkdown(input: {
  filePath: string;
  markdown: string;
  parsed: ParsedTraceableEvidenceState;
  view: ViewTraceableSubagentInput;
}): string {
  const surface = normalizeTraceableViewSurface(input.view.surface) ?? "rendered-output";
  const maxItems = clampTraceableViewItems(input.view.maxItems);
  const offset = clampTraceableViewOffset(input.view.offset);
  switch (surface) {
    case "rendered-output": {
      const result = input.parsed.result;
      if (!result) {
        return renderTraceableEvidenceOutcomeMarkdown({
          filePath: input.filePath,
          parsed: input.parsed
        });
      }
      const outputMode = normalizeTraceableOutputMode(input.view.outputMode)
        ?? normalizeTraceableOutputMode(result.outputMode)
        ?? normalizeTraceableOutputMode(getString(getRecord(result.request)?.outputMode))
        ?? "summary-with-evidence-path";
      if (outputMode === "full-markdown-with-evidence-path") {
        return `${input.markdown.trimEnd()}\n`;
      }
      return renderTraceableSubagentMarkdown({
        ...result,
        outputMode
      }, {
        mode: "absolute-file-uri-markdown",
        includeSupportArtifacts: input.view.includeSupportArtifacts ?? true
      });
    }
    default:
      return renderTraceableEvidenceSurfaceMarkdown({
        filePath: input.filePath,
        parsed: input.parsed,
        surface,
        maxItems,
        offset,
        includeSupportArtifacts: input.view.includeSupportArtifacts
      });
  }
}