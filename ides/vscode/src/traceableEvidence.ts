import { readdirSync } from "node:fs";
import path from "node:path";
import {
  buildTraceableMarkdownPathRenderOptions,
  formatTraceablePathReference,
  normalizeTraceableOutputMode,
  renderTraceableSubagentMarkdown,
  type TraceableSubagentRunResult
} from "./traceableContract";
import { parseTraceableEvidenceFileName } from "./traceableLineage";
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

function normalizeLegacyStopReason(value: unknown): TraceableSubagentRunResult["stopReason"] | undefined {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!normalized) {
    return undefined;
  }
  if (normalized === "completed" || normalized === "completed_normally" || normalized === "completed normally") {
    return "completed";
  }
  if (normalized === "budget_exhausted") {
    return "budget_exhausted";
  }
  if (normalized === "insufficient_grounding") {
    return "insufficient_grounding";
  }
  if (normalized === "tool_blocked") {
    return "tool_blocked";
  }
  if (normalized === "awaiting_input") {
    return "awaiting_input";
  }
  if (normalized === "user_cancelled") {
    return "user_cancelled";
  }
  if (normalized === "policy_stop") {
    return "policy_stop";
  }
  return undefined;
}

function normalizeLegacyCompletionClaim(
  value: unknown,
  stopReason: TraceableSubagentRunResult["stopReason"] | undefined
): TraceableSubagentRunResult["completionClaim"] | undefined {
  const reconcile = (claim: TraceableSubagentRunResult["completionClaim"] | undefined): TraceableSubagentRunResult["completionClaim"] | undefined => {
    if (!claim || !stopReason) {
      return claim;
    }
    if (stopReason === "completed") {
      return claim;
    }
    if (stopReason === "budget_exhausted" || stopReason === "insufficient_grounding") {
      return claim === "complete" ? "partial" : claim;
    }
    if (stopReason === "tool_blocked" || stopReason === "awaiting_input" || stopReason === "user_cancelled" || stopReason === "policy_stop") {
      return claim === "complete" ? "unresolved" : claim;
    }
    return claim;
  };

  if (value === true) {
    return reconcile(stopReason === "insufficient_grounding" ? "partial" : "complete");
  }
  if (value === false) {
    return reconcile("unresolved");
  }
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!normalized) {
    return undefined;
  }
  if (normalized === "complete" || normalized === "partial" || normalized === "unresolved") {
    return reconcile(normalized);
  }
  if (normalized === "partial_evidence_only" || /\bpartial\b|\bpartial evidence\b/u.test(normalized)) {
    return reconcile("partial");
  }
  if (/(?:^|\b)(artifact|continuation|handoff|seed)(?:_|\s)+(?:created|prepared|ready)(?:\b|$)/u.test(normalized)) {
    return reconcile("complete");
  }
  if (/\bunresolved\b|\bnot verified\b|\bnot confirmed\b|\binsufficient\b/u.test(normalized)) {
    return reconcile("unresolved");
  }
  if (/\bconfirmed\b|\bcomplete\b|\bcompleted\b|\bgrounded\b|\bderived\b|\bverified\b|\bsucceeded\b|\bsuccessful\b|\bsuccess\b/u.test(normalized)) {
    return reconcile("complete");
  }
  return reconcile(stopReason === "completed" ? "complete" : "unresolved");
}

function extractLegacyRawChildOutputText(markdown: string, result: TraceableSubagentRunResult | undefined): string | undefined {
  const embedded = result?.rawModelText?.trim();
  if (embedded) {
    return embedded;
  }
  const match = markdown.match(/### Raw Child Output\s+```text\s*([\s\S]*?)\s*```/u);
  return match?.[1]?.trim() || undefined;
}

function extractLegacyRawChildOutputFields(rawText: string): {
  stopReason?: string;
  completionClaim?: string;
  finalSummary?: string;
} {
  const fromJson = (() => {
    try {
      const parsed = JSON.parse(rawText) as Record<string, unknown>;
      return {
        stopReason: getString(parsed.stopReason),
        completionClaim: getString(parsed.completionClaim),
        finalSummary: getString(parsed.finalSummary)
      };
    } catch {
      return undefined;
    }
  })();
  if (fromJson?.stopReason || fromJson?.completionClaim || fromJson?.finalSummary) {
    return fromJson;
  }
  const extractQuotedField = (fieldName: string): string | undefined => {
    const fieldIndex = rawText.indexOf(`"${fieldName}"`);
    if (fieldIndex < 0) {
      return undefined;
    }
    const colonIndex = rawText.indexOf(":", fieldIndex + fieldName.length + 2);
    if (colonIndex < 0) {
      return undefined;
    }
    const openingQuoteIndex = rawText.indexOf('"', colonIndex + 1);
    if (openingQuoteIndex < 0) {
      return undefined;
    }
    let escaped = false;
    let value = "";
    for (let index = openingQuoteIndex + 1; index < rawText.length; index += 1) {
      const character = rawText[index];
      if (escaped) {
        value += character === "n"
          ? "\n"
          : character === "r"
            ? "\r"
            : character === "t"
              ? "\t"
              : character;
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === '"') {
        return value;
      }
      value += character;
    }
    return undefined;
  };
  return {
    stopReason: extractQuotedField("stopReason"),
    completionClaim: extractQuotedField("completionClaim"),
    finalSummary: extractQuotedField("finalSummary")
  };
}

function synthesizeLegacyCarryState(
  result: TraceableSubagentRunResult,
  rawChildOutput: string | undefined,
  compatFinalSummary: string | undefined
): Pick<TraceableSubagentRunResult, "carryStateDisposition" | "activeCarryForward" | "recoverableCarryState"> {
  if (result.activeCarryForward || result.recoverableCarryState || result.carryStateDisposition) {
    return {
      carryStateDisposition: result.carryStateDisposition,
      activeCarryForward: result.activeCarryForward,
      recoverableCarryState: result.recoverableCarryState
    };
  }
  const evidenceText = [compatFinalSummary?.trim() || "", rawChildOutput?.trim() || ""]
    .filter(Boolean)
    .join("\n");
  if (!evidenceText) {
    return {};
  }
  const normalized = evidenceText.toLowerCase();
  if (/\bactive carry-forward\b|\bactivecarryforward\b|\bactivecarryforward"\b|\bactivecarryforward\s*[:=]|\bactivecarryforward\b|\bactive carry forward\b/u.test(normalized)) {
    return {
      carryStateDisposition: "active",
      activeCarryForward: {}
    };
  }
  if (/\brecoverable carry\b|\brecoverablecarrystate\b|\brecoverable carry state\b/u.test(normalized)) {
    return {
      carryStateDisposition: "recoverable",
      recoverableCarryState: {}
    };
  }
  return {};
}

function backfillLegacyParsedResult(result: TraceableSubagentRunResult | undefined, markdown: string): TraceableSubagentRunResult | undefined {
  if (!result) {
    return result;
  }
  const existingStopReason = normalizeLegacyStopReason(result.stopReason);
  const existingCompletionClaim = normalizeLegacyCompletionClaim(result.completionClaim, existingStopReason);
  const rawChildOutput = extractLegacyRawChildOutputText(markdown, result);
  if (!rawChildOutput) {
    return result;
  }
  const extractedFields = extractLegacyRawChildOutputFields(rawChildOutput);
  const compatStopReason = normalizeLegacyStopReason(extractedFields.stopReason);
  const compatCompletionClaim = normalizeLegacyCompletionClaim(extractedFields.completionClaim, compatStopReason);
  const compatFinalSummary = extractedFields.finalSummary?.trim();
  const isStaleSalvageResult = (result.stopReason === "insufficient_grounding" || result.completionClaim === "unresolved")
    && (result.finalSummary.includes("omitted one or more required TRACEABLE top-level fields")
      || result.finalSummary.includes("salvaged the observed evidence"));
  const needsCompatBackfill = (!existingStopReason || !existingCompletionClaim)
    || (isStaleSalvageResult
      && compatStopReason === "completed"
      && compatCompletionClaim === "complete");
  if (!needsCompatBackfill) {
    return result;
  }
  if (!compatStopReason || !compatCompletionClaim || !compatFinalSummary) {
    return result;
  }
  const synthesizedCarryState = synthesizeLegacyCarryState(result, rawChildOutput, compatFinalSummary);

  return {
    ...result,
    stopReason: compatStopReason,
    completionClaim: compatCompletionClaim,
    finalSummary: compatFinalSummary,
    carryStateDisposition: synthesizedCarryState.carryStateDisposition ?? result.carryStateDisposition,
    activeCarryForward: synthesizedCarryState.activeCarryForward ?? result.activeCarryForward,
    recoverableCarryState: synthesizedCarryState.recoverableCarryState ?? result.recoverableCarryState
  };
}

function extractTraceableEvidenceStateJson(markdown: string): string | undefined {
  const startMatch = /## Traceable State\s+```json\s*\r?\n/u.exec(markdown);
  if (!startMatch) {
    return undefined;
  }
  const remainder = markdown.slice(startMatch.index + startMatch[0].length);
  const closingMatch = /^```[ \t]*$/um.exec(remainder);
  if (closingMatch?.index === undefined) {
    return undefined;
  }
  return remainder.slice(0, closingMatch.index).trim();
}

export function parseTraceableEvidenceStateMarkdown(markdown: string): ParsedTraceableEvidenceState | undefined {
  const jsonBlock = extractTraceableEvidenceStateJson(markdown);
  if (!jsonBlock) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBlock);
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
  const parsedResult = record.result && typeof record.result === "object"
    ? record.result as TraceableSubagentRunResult
    : undefined;
  const compatResult = backfillLegacyParsedResult(parsedResult, markdown);
  const parsedSnapshot = snapshot as TraceableSubagentDetailSnapshot;
  return {
    snapshot: compatResult
      ? {
        ...parsedSnapshot,
        resultSummary: parsedSnapshot.resultSummary ?? {
          finalSummary: compatResult.finalSummary,
          carryStateDisposition: compatResult.carryStateDisposition,
          activeCarryForward: compatResult.activeCarryForward,
          recoverableCarryState: compatResult.recoverableCarryState
        }
      }
      : parsedSnapshot,
    result: compatResult
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

function getPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function resolveTraceableEvidenceReference(currentFilePath: string, reference: string | undefined): string | undefined {
  const normalized = reference?.trim();
  if (!normalized) {
    return undefined;
  }
  return path.isAbsolute(normalized)
    ? path.resolve(normalized)
    : path.resolve(path.dirname(currentFilePath), normalized);
}

function listDirectChildTraceableEvidencePaths(currentFilePath: string, lineageLabel: string): string[] {
  const parentSegments = lineageLabel.split("-").filter((segment) => segment.length > 0);
  if (parentSegments.length === 0) {
    return [];
  }
  try {
    return readdirSync(path.dirname(currentFilePath), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name !== path.basename(currentFilePath))
      .flatMap((entry) => {
        const parsed = parseTraceableEvidenceFileName(entry.name);
        return parsed ? [{ entry, parsed }] : [];
      })
      .filter(({ parsed }) => {
        const candidateSegments = parsed.lineageLabel.split("-");
        return candidateSegments.length === parentSegments.length + 1
          && parentSegments.every((segment, index) => candidateSegments[index] === segment);
      })
      .sort((left, right) => left.parsed.lineageLabel.localeCompare(right.parsed.lineageLabel) || left.entry.name.localeCompare(right.entry.name))
      .map(({ entry }) => path.join(path.dirname(currentFilePath), entry.name));
  } catch {
    return [];
  }
}

function buildTraceableEvidenceLineageLines(input: {
  filePath: string;
  parsed: ParsedTraceableEvidenceState;
}): string[] {
  const pathRenderOptions = buildTraceableMarkdownPathRenderOptions(input.filePath);
  const result = getRecord(input.parsed.result) ?? {};
  const parsedFileName = parseTraceableEvidenceFileName(path.basename(input.filePath));
  const lineageLabel = getString(result.lineageLabel) ?? parsedFileName?.lineageLabel;
  const lineageDepth = getPositiveInteger(result.lineageDepth) ?? parsedFileName?.lineageDepth;
  const parentTracePath = resolveTraceableEvidenceReference(input.filePath, getString(result.parentTracePath));
  const directChildren = lineageLabel ? listDirectChildTraceableEvidencePaths(input.filePath, lineageLabel) : [];
  const continuedFromParent = getString(result.continuedFromParent) ?? (result.continuedFromParent === true ? "yes" : result.continuedFromParent === false ? "no" : undefined);
  if (!lineageLabel && !parentTracePath && directChildren.length === 0) {
    return [];
  }
  const lines = [
    "## Lineage",
    "",
    `- Current Trace: ${formatTraceablePathReference(input.filePath, pathRenderOptions)}`,
    `- Continued From Parent: ${continuedFromParent ?? (parentTracePath ? "yes" : "no")}`,
    `- Parent Trace: ${formatTraceablePathReference(parentTracePath, pathRenderOptions)}`,
    `- Lineage Label: ${lineageLabel ?? "-"}`,
    `- Lineage Depth: ${lineageDepth ?? "-"}`,
    `- Direct Children: ${directChildren.length}`
  ];
  if (directChildren.length > 0) {
    lines.push("", "### Direct Children", "");
    for (const childPath of directChildren) {
      lines.push(`- ${formatTraceablePathReference(childPath, pathRenderOptions)}`);
    }
  }
  lines.push("");
  return lines;
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
  const pathRenderOptions = buildTraceableMarkdownPathRenderOptions(input.filePath);
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
    `- File: ${formatTraceablePathReference(input.filePath, pathRenderOptions)}`,
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

  lines.push(...buildTraceableEvidenceLineageLines(input));

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
  const pathRenderOptions = buildTraceableMarkdownPathRenderOptions(input.filePath);
  const requestSummary = getArray<Record<string, unknown>>(input.parsed.snapshot.requestSummary);
  const maxItems = clampTraceableViewItems(input.maxItems);
  const offset = clampTraceableViewOffset(input.offset);
  const lines = [
    "# Traceable Evidence Request Summary",
    "",
    `- Evidence File: ${formatTraceablePathReference(input.filePath, pathRenderOptions)}`,
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
  const pathRenderOptions = buildTraceableMarkdownPathRenderOptions(input.filePath);
  const snapshot = input.parsed.snapshot;
  const status = getRecord(snapshot.status) ?? {};
  const result = input.parsed.result;
  const evidenceFile = getRecord(snapshot.evidenceFile) ?? {};
  const lines = [
    "# Traceable Evidence Outcome",
    "",
    `- Evidence File: ${formatTraceablePathReference(input.filePath, pathRenderOptions)}`,
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
  lines.push("", ...buildTraceableEvidenceLineageLines(input));
  return `${lines.join("\n")}\n`;
}

export function renderTraceableEvidenceTraceableMarkdown(input: {
  filePath: string;
  parsed: ParsedTraceableEvidenceState;
  includeSupportArtifacts?: boolean;
}): string {
  const pathRenderOptions = buildTraceableMarkdownPathRenderOptions(input.filePath);
  const result = input.parsed.result;
  if (!result) {
    return [
      "# Traceable Evidence Markdown",
      "",
      `- Evidence File: ${formatTraceablePathReference(input.filePath, pathRenderOptions)}`,
      "",
      "This evidence artifact does not contain a final TRACEABLE run result, so markdown reconstruction is unavailable.",
      ""
    ].join("\n");
  }

  const rendered = renderTraceableSubagentMarkdown(result, {
    ...pathRenderOptions,
    includeSupportArtifacts: input.includeSupportArtifacts ?? true
  });
  const lineageLines = buildTraceableEvidenceLineageLines(input);
  return lineageLines.length > 0
    ? `${rendered.trimEnd()}\n\n${lineageLines.join("\n")}`
    : rendered;
}

export function renderTraceableEvidenceToolLedgerMarkdown(input: {
  filePath: string;
  parsed: ParsedTraceableEvidenceState;
  maxItems?: number;
  offset?: number;
}): string {
  const pathRenderOptions = buildTraceableMarkdownPathRenderOptions(input.filePath);
  const maxItems = clampTraceableViewItems(input.maxItems, 10);
  const offset = clampTraceableViewOffset(input.offset);
  const toolCalls = getToolCalls(input.parsed);
  const lines = [
    "# Traceable Evidence Tool Ledger",
    "",
    `- Evidence File: ${formatTraceablePathReference(input.filePath, pathRenderOptions)}`,
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
  const pathRenderOptions = buildTraceableMarkdownPathRenderOptions(input.filePath);
  const maxItems = clampTraceableViewItems(input.maxItems, 10);
  const offset = clampTraceableViewOffset(input.offset);
  const history = getStatusHistory(input.parsed);
  const lines = [
    "# Traceable Evidence Status History",
    "",
    `- Evidence File: ${formatTraceablePathReference(input.filePath, pathRenderOptions)}`,
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
  const pathRenderOptions = buildTraceableMarkdownPathRenderOptions(input.filePath);
  const maxItems = clampTraceableViewItems(input.maxItems, 10);
  const offset = clampTraceableViewOffset(input.offset);
  const summaries = summarizeTraceableToolCalls(getToolCalls(input.parsed));
  const lines = [
    "# Traceable Evidence Tool Summary",
    "",
    `- Evidence File: ${formatTraceablePathReference(input.filePath, pathRenderOptions)}`,
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
  const pathRenderOptions = buildTraceableMarkdownPathRenderOptions(input.filePath);
  const maxItems = clampTraceableViewItems(input.maxItems, 10);
  const offset = clampTraceableViewOffset(input.offset);
  const summaries = summarizeTraceableReadTargets(getToolCalls(input.parsed));
  const lines = [
    "# Traceable Evidence File Summary",
    "",
    `- Evidence File: ${formatTraceablePathReference(input.filePath, pathRenderOptions)}`,
    `- Distinct Read Targets: ${summaries.length}`
  ];
  if (summaries.length === 0) {
    lines.push("", "No read-file targets were surfaced in this evidence artifact.");
    return `${lines.join("\n")}\n`;
  }
  const window = selectTraceableWindow(summaries, maxItems, offset);
  lines.push("");
  for (const summary of window.items) {
    lines.push(`- ${formatTraceablePathReference(summary.filePath, pathRenderOptions, summary.filePath)}`);
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
  const pathRenderOptions = buildTraceableMarkdownPathRenderOptions(input.filePath);
  const envelope = {
    snapshot: input.parsed.snapshot,
    result: input.parsed.result
  };
  return [
    "# Traceable Evidence State JSON",
    "",
    `- Evidence File: ${formatTraceablePathReference(input.filePath, pathRenderOptions)}`,
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
        ...buildTraceableMarkdownPathRenderOptions(input.filePath),
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