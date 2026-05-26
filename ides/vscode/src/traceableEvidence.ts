import { readFileSync, readdirSync } from "node:fs";
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

function buildTraceableEvidencePathRenderOptions(
  evidenceFilePath: string | undefined,
  parsed: ParsedTraceableEvidenceState
) {
  return buildTraceableMarkdownPathRenderOptions(evidenceFilePath, parsed.snapshot.environment?.repoRootSnapshotPath);
}

export type TraceableEvidenceSurface =
  | "rendered-output"
  | "conversation-brief"
  | "request-summary"
  | "request-contract"
  | "summary"
  | "outcome"
  | "runtime-decision"
  | "evidence-basis"
  | "timeline"
  | "carry-handoff"
  | "tool-forensics"
  | "lineage"
  | "traceable-markdown"
  | "tool-ledger"
  | "status-history"
  | "tool-summary"
  | "file-summary"
  | "latest-role-state"
  | "latest-carry-package"
  | "state-json";

export interface ViewTraceableSubagentInput {
  evidenceFilePath: string;
  reveal?: boolean;
  outputMode?: "summary-with-evidence-path" | "full-markdown-with-evidence-path" | "evidence-path-only";
  surface?: TraceableEvidenceSurface;
  roleName?: string;
  senderId?: string;
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
          senderAdaptationState: compatResult.senderAdaptationState,
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
  const pathRenderOptions = buildTraceableEvidencePathRenderOptions(input.filePath, input.parsed);
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

type TraceableEvidenceLineageNode = {
  filePath: string;
  parsed: ParsedTraceableEvidenceState;
};

function readParsedTraceableEvidenceAtPath(filePath: string): ParsedTraceableEvidenceState | undefined {
  try {
    const markdown = readFileSync(filePath, "utf8");
    return parseTraceableEvidenceStateMarkdown(markdown);
  } catch {
    return undefined;
  }
}

function collectTraceableCurrentAndAncestorNodes(input: {
  filePath: string;
  parsed: ParsedTraceableEvidenceState;
}): TraceableEvidenceLineageNode[] {
  const nodes: TraceableEvidenceLineageNode[] = [{ filePath: input.filePath, parsed: input.parsed }];
  const visited = new Set([path.resolve(input.filePath).toLowerCase()]);
  let current: TraceableEvidenceLineageNode | undefined = nodes[0];
  while (current) {
    const parentReference = getString(getRecord(current.parsed.result)?.parentTracePath);
    const resolvedParentPath = resolveTraceableEvidenceReference(current.filePath, parentReference);
    if (!resolvedParentPath) {
      break;
    }
    const normalizedParentPath = path.resolve(resolvedParentPath).toLowerCase();
    if (visited.has(normalizedParentPath)) {
      break;
    }
    visited.add(normalizedParentPath);
    const parsedParent = readParsedTraceableEvidenceAtPath(resolvedParentPath);
    if (!parsedParent) {
      break;
    }
    current = { filePath: resolvedParentPath, parsed: parsedParent };
    nodes.push(current);
  }
  return nodes;
}

function normalizeTraceableLookupToken(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : undefined;
}

function getSenderAdaptationEntries(parsed: ParsedTraceableEvidenceState): Record<string, unknown>[] {
  const result = getRecord(parsed.result) ?? {};
  const senderAdaptationState = getRecord(result.senderAdaptationState) ?? getRecord(parsed.snapshot.resultSummary?.senderAdaptationState);
  return getArray(senderAdaptationState?.entries).flatMap((entry) => {
    const record = getRecord(entry);
    return record ? [record] : [];
  });
}

function isMatchingTraceableSenderEntry(input: {
  entry: Record<string, unknown>;
  senderId?: string;
  roleName?: string;
}): boolean {
  const normalizedSenderId = normalizeTraceableLookupToken(input.senderId);
  const normalizedRoleName = normalizeTraceableLookupToken(input.roleName);
  if (!normalizedSenderId && !normalizedRoleName) {
    return false;
  }
  const entrySenderId = normalizeTraceableLookupToken(getString(input.entry.senderId));
  const sourceRoles = getArray(input.entry.sourceRoles)
    .map((value) => normalizeTraceableLookupToken(getString(value)))
    .filter((value): value is string => Boolean(value));
  if (normalizedSenderId && entrySenderId === normalizedSenderId) {
    return true;
  }
  if (normalizedRoleName && sourceRoles.includes(normalizedRoleName)) {
    return true;
  }
  return false;
}

function hasTraceableSenderEntryConflict(entry: Record<string, unknown>): boolean {
  const valuesByKey = new Map<string, Set<string>>();
  for (const claim of getArray(entry.claims)) {
    const claimRecord = getRecord(claim);
    const key = getString(claimRecord?.key);
    const value = getString(claimRecord?.value);
    if (!key || !value) {
      continue;
    }
    const bucket = valuesByKey.get(key) ?? new Set<string>();
    bucket.add(value);
    valuesByKey.set(key, bucket);
  }
  return Array.from(valuesByKey.values()).some((bucket) => bucket.size > 1);
}

function renderTraceableSenderEntryClaims(lines: string[], entry: Record<string, unknown>): void {
  for (const claim of getArray(entry.claims)) {
    const claimRecord = getRecord(claim);
    const key = getString(claimRecord?.key) ?? "unknown";
    const value = getString(claimRecord?.value) ?? "-";
    const status = getString(claimRecord?.status) ?? "-";
    const observations = getPositiveInteger(claimRecord?.observations);
    const evidence = getString(claimRecord?.evidence);
    lines.push(`- ${key}=${value} [${status}${observations && observations > 1 ? ` x${observations}` : ""}]${evidence ? `: ${evidence}` : ""}`);
  }
}

function renderTraceableEvidenceLatestRoleStateMarkdown(input: {
  filePath: string;
  parsed: ParsedTraceableEvidenceState;
  roleName?: string;
  senderId?: string;
}): string {
  const pathRenderOptions = buildTraceableEvidencePathRenderOptions(input.filePath, input.parsed);
  const querySenderId = getString(input.senderId);
  const queryRoleName = getString(input.roleName);
  const lines = [
    "# Traceable Evidence Latest Role State",
    "",
    `- Evidence File: ${formatTraceablePathReference(input.filePath, pathRenderOptions)}`,
    "- Scope: Current lineage only",
    `- Query Sender Id: ${querySenderId ?? "-"}`,
    `- Query Role Name: ${queryRoleName ?? "-"}`
  ];
  if (!querySenderId && !queryRoleName) {
    lines.push("", "Provide senderId or roleName to inspect the latest known role state in this lineage.", "");
    return lines.join("\n");
  }
  const nodes = collectTraceableCurrentAndAncestorNodes({ filePath: input.filePath, parsed: input.parsed });
  lines.push(`- Lineage Nodes Checked: ${nodes.length}`);
  const matchIndex = nodes.findIndex((node) => getSenderAdaptationEntries(node.parsed).some((entry) => isMatchingTraceableSenderEntry({ entry, senderId: querySenderId, roleName: queryRoleName })));
  if (matchIndex < 0) {
    lines.push("", "- Latest Match: no", "- Status: not-found", "", "No sender adaptation state for the requested role was found in this lineage.", "");
    return lines.join("\n");
  }
  const matchedNode = nodes[matchIndex];
  const matchedEntry = getSenderAdaptationEntries(matchedNode.parsed).find((entry) => isMatchingTraceableSenderEntry({ entry, senderId: querySenderId, roleName: queryRoleName }));
  if (!matchedEntry) {
    lines.push("", "- Latest Match: no", "- Status: not-found", "", "No sender adaptation state for the requested role was found in this lineage.", "");
    return lines.join("\n");
  }
  const conflicted = hasTraceableSenderEntryConflict(matchedEntry);
  const sourceRoles = getArray(matchedEntry.sourceRoles)
    .map((value) => getString(value))
    .filter((value): value is string => Boolean(value));
  lines.push(`- Latest Match: yes`);
  lines.push(`- Status: ${conflicted ? "conflicted" : matchIndex === 0 ? "current" : "stale"}`);
  lines.push(`- Match Source: ${formatTraceablePathReference(matchedNode.filePath, pathRenderOptions)}`);
  lines.push(`- Newer Nodes Checked Since Match: ${matchIndex}`);
  lines.push(`- Conflict Present: ${conflicted ? "yes" : "no"}`);
  lines.push(`- Sender Id: ${getString(matchedEntry.senderId) ?? "-"}`);
  lines.push(`- Source Roles: ${sourceRoles.length ? sourceRoles.join(" | ") : "-"}`);
  lines.push("", "## Latest Known State", "");
  renderTraceableSenderEntryClaims(lines, matchedEntry);
  if (matchIndex > 0) {
    lines.push("", `Checked ${matchIndex} newer lineage node${matchIndex === 1 ? "" : "s"} before reaching this latest known match.`);
  }
  lines.push("");
  return lines.join("\n");
}

function renderTraceableEvidenceLatestCarryPackageMarkdown(input: {
  filePath: string;
  parsed: ParsedTraceableEvidenceState;
}): string {
  const pathRenderOptions = buildTraceableEvidencePathRenderOptions(input.filePath, input.parsed);
  const nodes = collectTraceableCurrentAndAncestorNodes({ filePath: input.filePath, parsed: input.parsed });
  const currentDisposition = getTraceableCarryStateDisposition(input.parsed) ?? "none";
  const lines = [
    "# Traceable Evidence Latest Carry Package",
    "",
    `- Evidence File: ${formatTraceablePathReference(input.filePath, pathRenderOptions)}`,
    "- Scope: Current lineage only",
    `- Lineage Nodes Checked: ${nodes.length}`,
    `- Current Boundary Disposition: ${currentDisposition}`
  ];
  const matchIndex = nodes.findIndex((node) => Boolean(getRecord(getRecord(node.parsed.result)?.activeCarryForward) || getRecord(getRecord(node.parsed.result)?.recoverableCarryState)));
  if (matchIndex < 0) {
    lines.push("- Status: not-found", "", "No active or recoverable carry package was found in this lineage.", "");
    return lines.join("\n");
  }
  const matchedNode = nodes[matchIndex];
  const matchedResult = getRecord(matchedNode.parsed.result) ?? {};
  const activeCarryForward = getRecord(matchedResult.activeCarryForward);
  const recoverableCarryState = getRecord(matchedResult.recoverableCarryState);
  const packageKind = activeCarryForward ? "active" : "recoverable";
  const status = matchIndex === 0
    ? packageKind
    : currentDisposition === "consumed"
      ? "consumed"
      : currentDisposition === "expired"
        ? "expired"
        : "stale";
  const summaryCounts = summarizeTraceableCarryState(activeCarryForward ?? recoverableCarryState);
  lines.push(`- Status: ${status}`);
  lines.push(`- Latest Package Kind: ${packageKind}`);
  lines.push(`- Match Source: ${formatTraceablePathReference(matchedNode.filePath, pathRenderOptions)}`);
  lines.push(`- Newer Nodes Checked Since Match: ${matchIndex}`);
  lines.push(`- Remaining Goals: ${summaryCounts.goalCount}`);
  lines.push(`- Open Questions: ${summaryCounts.questionCount}`);
  lines.push(`- Next Suggested Start Present: ${summaryCounts.hasNextStart ? "yes" : "no"}`);
  renderTraceableCarryStateSection(lines, activeCarryForward ? "Latest Active Carry Forward" : "Latest Recoverable Carry State", activeCarryForward ?? recoverableCarryState, pathRenderOptions);
  if (matchIndex > 0) {
    lines.push("", `Checked ${matchIndex} newer lineage node${matchIndex === 1 ? "" : "s"} before reaching this latest carry package.`);
  }
  lines.push("");
  return lines.join("\n");
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
    case "conversation-brief":
    case "request-summary":
    case "request-contract":
    case "summary":
    case "outcome":
    case "runtime-decision":
    case "evidence-basis":
    case "timeline":
    case "carry-handoff":
    case "tool-forensics":
    case "lineage":
    case "traceable-markdown":
    case "tool-ledger":
    case "status-history":
    case "tool-summary":
    case "file-summary":
    case "latest-role-state":
    case "latest-carry-package":
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

function parseTraceableTimestampMs(value: unknown): number | undefined {
  const text = getString(value);
  if (!text) {
    return undefined;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatTraceableElapsed(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }
  const seconds = value / 1000;
  if (seconds < 60) {
    return `${seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1)} s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainderSeconds = Math.round(seconds % 60);
  if (minutes < 60) {
    return `${minutes}m ${remainderSeconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  return `${hours}h ${remainderMinutes}m`;
}

function formatTraceableTimestamp(value: unknown): string | undefined {
  const text = getString(value);
  if (!text) {
    return undefined;
  }
  const date = new Date(text);
  return Number.isNaN(date.valueOf()) ? text : date.toISOString();
}

function buildTraceableTimelineEntries(input: {
  filePath: string;
  parsed: ParsedTraceableEvidenceState;
}): Array<{ occurredAtMs: number; line: string; order: number }> {
  const pathRenderOptions = buildTraceableEvidencePathRenderOptions(input.filePath, input.parsed);
  const entries: Array<{ occurredAtMs: number; line: string; order: number }> = [];
  const history = getStatusHistory(input.parsed)
    .map((event, index) => ({
      event,
      index,
      occurredAtMs: parseTraceableTimestampMs(event.occurredAt) ?? Number.MAX_SAFE_INTEGER,
      occurredAtLabel: formatTraceableTimestamp(event.occurredAt) ?? getString(event.occurredAt) ?? "pending"
    }))
    .sort((left, right) => left.occurredAtMs === right.occurredAtMs ? left.index - right.index : left.occurredAtMs - right.occurredAtMs);

  for (const [index, item] of history.entries()) {
    const nextMs = history[index + 1]?.occurredAtMs;
    const duration = Number.isFinite(item.occurredAtMs) && Number.isFinite(nextMs)
      ? formatTraceableElapsed(Math.max(0, (nextMs as number) - item.occurredAtMs))
      : undefined;
    const detail = getString(item.event.detail);
    entries.push({
      occurredAtMs: item.occurredAtMs,
      order: index,
      line: `- ${item.occurredAtLabel} · Status · ${getString(item.event.phase) ?? "-"} · ${getString(item.event.message) ?? "-"}${detail ? ` · ${detail}` : ""}${duration ? ` · for ${duration}` : ""}`
    });
  }

  const recentTools = getArray<Record<string, unknown>>(input.parsed.snapshot.recentTools)
    .map((event, index) => ({
      event,
      index,
      occurredAtMs: parseTraceableTimestampMs(event.occurredAt) ?? Number.MAX_SAFE_INTEGER,
      occurredAtLabel: formatTraceableTimestamp(event.occurredAt) ?? getString(event.occurredAt) ?? "pending"
    }));
  for (const item of recentTools) {
    const inputRecord = getRecord(item.event.input) ?? {};
    const filePath = getString(inputRecord.filePath);
    const target = filePath
      ? ` · ${formatTraceablePathReference(filePath, pathRenderOptions, filePath)}`
      : "";
    const note = getString(item.event.note);
    const duration = typeof item.event.elapsedMs === "number" && Number.isFinite(item.event.elapsedMs)
      ? formatTraceableElapsed(item.event.elapsedMs)
      : undefined;
    entries.push({
      occurredAtMs: item.occurredAtMs,
      order: history.length + item.index,
      line: `- ${item.occurredAtLabel} · Tool · ${getString(item.event.toolName) ?? "-"} · ${getString(item.event.phase) ?? "-"}${target}${note ? ` · ${note}` : ""}${duration ? ` · ${duration}` : ""}`
    });
  }

  return entries.sort((left, right) => left.occurredAtMs === right.occurredAtMs ? left.order - right.order : left.occurredAtMs - right.occurredAtMs);
}

function getTraceableCarryStateDisposition(parsed: ParsedTraceableEvidenceState): string | undefined {
  const result = getRecord(parsed.result) ?? {};
  const disposition = getString(result.carryStateDisposition);
  if (disposition) {
    return disposition;
  }
  if (getRecord(result.activeCarryForward)) {
    return "active";
  }
  if (getRecord(result.recoverableCarryState)) {
    return "recoverable";
  }
  return undefined;
}

function summarizeTraceableCarryState(state: Record<string, unknown> | undefined): {
  goalCount: number;
  questionCount: number;
  hasNextStart: boolean;
} {
  const remainingGoals = getArray(state?.remainingGoals)
    .map((value) => getString(value))
    .filter((value): value is string => Boolean(value));
  const openQuestions = getArray(state?.openQuestions)
    .map((value) => getString(value))
    .filter((value): value is string => Boolean(value));
  return {
    goalCount: remainingGoals.length,
    questionCount: openQuestions.length,
    hasNextStart: Boolean(getString(state?.nextSuggestedStart))
  };
}

function renderTraceableCarryStateSection(lines: string[], title: string, state: Record<string, unknown> | undefined, pathRenderOptions: ReturnType<typeof buildTraceableMarkdownPathRenderOptions>): void {
  if (!state || Object.keys(state).length === 0) {
    return;
  }
  const renderStringList = (label: string, values: unknown[], formatter?: (value: string) => string) => {
    const normalized = values
      .map((value) => getString(value))
      .filter((value): value is string => Boolean(value));
    if (normalized.length === 0) {
      return;
    }
    lines.push(`- ${label}: ${normalized.map((value) => formatter ? formatter(value) : value).join(" | ")}`);
  };

  lines.push("", `## ${title}`, "");
  renderStringList("Remaining Goals", getArray(state.remainingGoals));
  renderStringList("Open Questions", getArray(state.openQuestions));
  renderStringList("Constraints", getArray(state.constraints));
  renderStringList("Decisions Made", getArray(state.decisionsMade));
  const nextSuggestedStart = getString(state.nextSuggestedStart);
  if (nextSuggestedStart) {
    lines.push(`- Next Suggested Start: ${nextSuggestedStart}`);
  }
  renderStringList("Relevant File Anchors", getArray(state.relevantFileAnchors), (value) => formatTraceablePathReference(value, pathRenderOptions, value));
  renderStringList("Relevant Artifact Anchors", getArray(state.relevantArtifactAnchors), (value) => formatTraceablePathReference(value, pathRenderOptions, value));
  renderStringList("Keep Reasons", getArray(state.keepReasons));
  renderStringList("Drop Reasons", getArray(state.dropReasons));
}

function describeTraceableViewedEvidenceStatus(parsed: ParsedTraceableEvidenceState): { value: string; reconciled: boolean } {
  const snapshotEvidence = getRecord(parsed.snapshot.evidenceFile) ?? {};
  const resultEvidence = getRecord(getRecord(parsed.result)?.evidenceFile) ?? {};
  const persistedStatus = getString(resultEvidence.status) ?? getString(snapshotEvidence.status) ?? "-";
  const currentPhase = getString(getRecord(parsed.snapshot.status)?.phase);
  const stopReason = getString(getRecord(parsed.result)?.stopReason);
  if (persistedStatus === "writing" && (currentPhase === "completed" || stopReason === "completed")) {
    return {
      value: "writing (persisted status on an otherwise completed artifact)",
      reconciled: true
    };
  }
  return {
    value: persistedStatus,
    reconciled: false
  };
}

function getTraceableRequestUserInput(parsed: ParsedTraceableEvidenceState): string | undefined {
  const request = getRecord(parsed.result?.request);
  const direct = getString(request?.userInput)?.trim();
  if (direct) {
    return direct;
  }
  const requestSummary = getArray<Record<string, unknown>>(parsed.snapshot.requestSummary);
  const userInputItem = requestSummary.find((item) => (getString(item.label) ?? "").trim().toLowerCase() === "user input");
  return getString(userInputItem?.title) ?? getString(userInputItem?.value) ?? undefined;
}

function getTraceableRequestParentRoles(parsed: ParsedTraceableEvidenceState): string[] {
  const request = getRecord(parsed.result?.request);
  const parentRoles = request?.parentRoles;
  if (typeof parentRoles === "string") {
    return parentRoles.trim() ? [parentRoles.trim()] : [];
  }
  return getArray(parentRoles)
    .map((value) => getString(value)?.trim())
    .filter((value): value is string => Boolean(value));
}

function normalizeTraceableConversationBriefGap(value: string): { key: string; display: string } {
  const trimmed = value.trim();
  const withoutPrefix = trimmed.replace(/^Unsupported claim:\s*/iu, "");
  const withoutMissingSuffix = withoutPrefix.replace(/:\s*Reported as a plain-text missing item by the child lane\.?$/iu, "");
  const display = withoutMissingSuffix.trim() || trimmed;
  const key = display.toLowerCase();
  return { key, display };
}

function collectTraceableConversationBriefGaps(parsed: ParsedTraceableEvidenceState): string[] {
  const result = getRecord(parsed.result) ?? {};
  const evidenceBasis = getRecord(result.evidenceBasis) ?? {};
  const unsupportedClaims = getArray(evidenceBasis.unsupportedClaims)
    .map((value) => getString(value)?.trim())
    .filter((value): value is string => Boolean(value))
    .map((value) => `Unsupported claim: ${value}`);
  const expectedButMissing = getArray(result.expectedButMissing)
    .map((value) => getString(value)?.trim())
    .filter((value): value is string => Boolean(value));
  const carryState = getRecord(result.activeCarryForward) ?? getRecord(result.recoverableCarryState);
  const remainingGoals = getArray(carryState?.remainingGoals)
    .map((value) => getString(value)?.trim())
    .filter((value): value is string => Boolean(value));
  const nextSuggestedStart = getString(carryState?.nextSuggestedStart)?.trim();
  const seen = new Set<string>();
  const candidates: string[] = [...expectedButMissing, ...remainingGoals, ...(nextSuggestedStart ? [nextSuggestedStart] : []), ...unsupportedClaims];
  return candidates
    .flatMap((value) => {
      const normalized = normalizeTraceableConversationBriefGap(value);
      if (seen.has(normalized.key)) {
        return [];
      }
      seen.add(normalized.key);
      return [normalized.display];
    })
    .slice(0, 4);
}

export function renderTraceableEvidenceConversationBriefMarkdown(input: {
  filePath: string;
  parsed: ParsedTraceableEvidenceState;
}): string {
  const pathRenderOptions = buildTraceableEvidencePathRenderOptions(input.filePath, input.parsed);
  const snapshot = input.parsed.snapshot;
  const result = getRecord(input.parsed.result) ?? {};
  const header = getRecord(snapshot.header) ?? {};
  const runtimeDecision = getRecord(result.runtimeDecisionSummary) ?? {};
  const requestRouting = getRecord(runtimeDecision.requestRouting) ?? {};
  const evidenceFile = getRecord(getRecord(result.evidenceFile) ?? getRecord(snapshot.evidenceFile)) ?? {};
  const evidenceStatus = describeTraceableViewedEvidenceStatus(input.parsed);
  const requestUserInput = getTraceableRequestUserInput(input.parsed);
  const parentRoles = getTraceableRequestParentRoles(input.parsed);
  const parentTraceReference = getString(result.parentTracePath);
  const parentTracePath = resolveTraceableEvidenceReference(input.filePath, parentTraceReference);
  const parentParsed = parentTracePath ? readParsedTraceableEvidenceAtPath(parentTracePath) : undefined;
  const parentFinalSummary = getString(parentParsed?.result?.finalSummary)?.trim();
  const groundingGaps = collectTraceableConversationBriefGaps(input.parsed);

  const lines = [
    "# Traceable Evidence Conversation Brief",
    "",
    `- Evidence File: ${formatTraceablePathReference(input.filePath, pathRenderOptions)}`,
    `- Role: ${getString(header.roleDisplay) ?? getString(header.agentName) ?? "-"}`,
    `- Model: ${getString(header.modelLabel) ?? "-"}`,
    `- Routing Mode: ${getString(requestRouting.mode) ?? "-"}`,
    `- Carry Disposition: ${getTraceableCarryStateDisposition(input.parsed) ?? "-"}`,
    `- Evidence File Status: ${evidenceStatus.value}`,
    ""
  ];

  lines.push("## Current Turn", "");
  lines.push(`- User Input: ${requestUserInput ?? "-"}`);
  lines.push(`- Final Answer: ${getString(result.finalSummary) ?? "-"}`);
  if (parentRoles.length > 0) {
    lines.push(`- Parent Roles: ${parentRoles.join(" | ")}`);
  }

  lines.push("", "## Parent Context", "");
  lines.push(`- Parent Trace: ${parentTracePath ? formatTraceablePathReference(parentTracePath, pathRenderOptions) : "-"}`);
  lines.push(`- Parent Final Summary: ${parentFinalSummary ?? "-"}`);

  lines.push("", "## Grounding Gap", "");
  if (groundingGaps.length === 0) {
    lines.push("- No explicit grounding gap was persisted in this evidence artifact.");
  } else {
    for (const gap of groundingGaps) {
      lines.push(`- ${gap}`);
    }
  }
  if (evidenceStatus.reconciled) {
    lines.push("", "Current evidence-file status looks stale relative to the completed run result.");
  } else if (getString(evidenceFile.status) && getString(evidenceFile.status) !== "ready") {
    lines.push("", `Current evidence-file status is ${getString(evidenceFile.status)} rather than ready.`);
  }
  lines.push("");
  return lines.join("\n");
}

function formatTraceableBoundedTextPreview(value: string | undefined, maxChars = 800): string | undefined {
  const text = value?.trim();
  if (!text) {
    return undefined;
  }
  return text.length <= maxChars
    ? text
    : `${text.slice(0, Math.max(0, maxChars)).trimEnd()}... [truncated]`;
}

export function renderTraceableEvidenceSummaryMarkdown(input: {
  filePath: string;
  parsed: ParsedTraceableEvidenceState;
}): string {
  const pathRenderOptions = buildTraceableEvidencePathRenderOptions(input.filePath, input.parsed);
  const snapshot = input.parsed.snapshot;
  const header = getRecord(snapshot.header) ?? {};
  const evidenceFile = getRecord(snapshot.evidenceFile) ?? {};
  const evidenceStatus = describeTraceableViewedEvidenceStatus(input.parsed);
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
    `- Export status: ${evidenceStatus.value}`,
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
  const pathRenderOptions = buildTraceableEvidencePathRenderOptions(input.filePath, input.parsed);
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

function classifyRequestSummaryItems(requestSummary: Record<string, unknown>[]): {
  explicit: Record<string, unknown>[];
  inherited: Record<string, unknown>[];
  contextual: Record<string, unknown>[];
} {
  const explicit: Record<string, unknown>[] = [];
  const inherited: Record<string, unknown>[] = [];
  const contextual: Record<string, unknown>[] = [];
  for (const item of requestSummary) {
    const label = (getString(item.label) ?? "").trim().toLowerCase();
    if (label === "inherited") {
      inherited.push(item);
      continue;
    }
    if (label === "context in") {
      contextual.push(item);
      continue;
    }
    explicit.push(item);
  }
  return { explicit, inherited, contextual };
}

function describeImplicitRequestDefaults(parsed: ParsedTraceableEvidenceState): string[] {
  const result = getRecord(parsed.result) ?? {};
  const runtimeDecision = getRecord(result.runtimeDecisionSummary) ?? {};
  const modelSelection = getRecord(runtimeDecision.modelSelection) ?? {};
  const request = getRecord(result.request) ?? {};
  const lines: string[] = [];
  const selectionMode = getString(modelSelection.selectionMode);
  if (selectionMode === "implicit-default") {
    lines.push(`Model selection defaulted implicitly to ${getString(modelSelection.selectedModelDisplayName) ?? getString(modelSelection.selectedModelId) ?? "the resolved runtime model"}.`);
  }
  if (!getString(request.inputMode) && !getString(request.validationMode)) {
    lines.push("Input mode and validation mode were not explicitly persisted in the request envelope.");
  }
  return lines;
}

export function renderTraceableEvidenceRequestContractMarkdown(input: {
  filePath: string;
  parsed: ParsedTraceableEvidenceState;
  maxItems?: number;
}): string {
  const pathRenderOptions = buildTraceableEvidencePathRenderOptions(input.filePath, input.parsed);
  const requestSummary = getArray<Record<string, unknown>>(input.parsed.snapshot.requestSummary);
  const { explicit, inherited, contextual } = classifyRequestSummaryItems(requestSummary);
  const implicitDefaults = describeImplicitRequestDefaults(input.parsed);
  const lines = [
    "# Traceable Evidence Request Contract",
    "",
    `- Evidence File: ${formatTraceablePathReference(input.filePath, pathRenderOptions)}`,
    `- Explicit Request Items: ${explicit.length}`,
    `- Inherited Items: ${inherited.length}`,
    `- Contextual Inputs: ${contextual.length}`,
    `- Implicit Defaults Noted: ${implicitDefaults.length}`
  ];
  if (explicit.length === 0 && inherited.length === 0 && contextual.length === 0 && implicitDefaults.length === 0) {
    lines.push("", "No request-contract detail was captured in this evidence artifact.");
    return `${lines.join("\n")}\n`;
  }
  if (explicit.length > 0) {
    lines.push("", "## Explicit Request", "");
    for (const item of explicit) {
      lines.push(`- ${getString(item.label) ?? "-"}: ${getString(item.title) ?? getString(item.value) ?? "-"}`);
    }
  }
  if (inherited.length > 0) {
    lines.push("", "## Inherited State", "");
    for (const item of inherited) {
      lines.push(`- ${getString(item.label) ?? "-"}: ${getString(item.title) ?? getString(item.value) ?? "-"}`);
    }
  }
  if (contextual.length > 0) {
    lines.push("", "## Contextual Inputs", "");
    for (const item of contextual) {
      lines.push(`- ${getString(item.label) ?? "-"}: ${getString(item.title) ?? getString(item.value) ?? "-"}`);
    }
  }
  if (implicitDefaults.length > 0) {
    lines.push("", "## Implicit Defaults", "");
    for (const line of implicitDefaults) {
      lines.push(`- ${line}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

export function renderTraceableEvidenceOutcomeMarkdown(input: {
  filePath: string;
  parsed: ParsedTraceableEvidenceState;
}): string {
  const pathRenderOptions = buildTraceableEvidencePathRenderOptions(input.filePath, input.parsed);
  const snapshot = input.parsed.snapshot;
  const status = getRecord(snapshot.status) ?? {};
  const result = input.parsed.result;
  const evidenceFile = getRecord(snapshot.evidenceFile) ?? {};
  const evidenceStatus = describeTraceableViewedEvidenceStatus(input.parsed);
  const lines = [
    "# Traceable Evidence Outcome",
    "",
    `- Evidence File: ${formatTraceablePathReference(input.filePath, pathRenderOptions)}`,
    `- Updated At: ${getString(snapshot.updatedAt) ?? "-"}`,
    `- Current Status: ${getString(status.phase) ?? "-"} | ${getString(status.message) ?? "-"}`
  ];
  if (!result) {
    lines.push(
      `- Evidence File Status: ${evidenceStatus.value}`,
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
    `- Evidence File Status: ${evidenceStatus.value}`
  );
  lines.push("", ...buildTraceableEvidenceLineageLines(input));
  return `${lines.join("\n")}\n`;
}

export function renderTraceableEvidenceRuntimeDecisionMarkdown(input: {
  filePath: string;
  parsed: ParsedTraceableEvidenceState;
}): string {
  const pathRenderOptions = buildTraceableEvidencePathRenderOptions(input.filePath, input.parsed);
  const result = input.parsed.result;
  const runtimeDecision = getRecord(result?.runtimeDecisionSummary) ?? {};
  const runtimeFingerprint = getRecord(result?.runtimeFingerprint) ?? {};
  const lines = [
    "# Traceable Evidence Runtime Decision",
    "",
    `- Evidence File: ${formatTraceablePathReference(input.filePath, pathRenderOptions)}`,
    `- Runtime Decision Present: ${Object.keys(runtimeDecision).length > 0 ? "yes" : "no"}`,
    `- Runtime Fingerprint Present: ${Object.keys(runtimeFingerprint).length > 0 ? "yes" : "no"}`
  ];
  if (Object.keys(runtimeDecision).length === 0 && Object.keys(runtimeFingerprint).length === 0) {
    lines.push("", "No runtime-decision or runtime-fingerprint slice was persisted in this evidence artifact.");
    return `${lines.join("\n")}\n`;
  }
  lines.push("", "## Model Selection", "", "```json", JSON.stringify(runtimeDecision.modelSelection ?? {}, null, 2), "```");
  lines.push("", "## Request Routing", "", "```json", JSON.stringify(runtimeDecision.requestRouting ?? {}, null, 2), "```");
  lines.push("", "## Runtime Fingerprint", "", "```json", JSON.stringify(runtimeFingerprint, null, 2), "```");
  lines.push("");
  return lines.join("\n");
}

export function renderTraceableEvidenceBasisMarkdown(input: {
  filePath: string;
  parsed: ParsedTraceableEvidenceState;
  maxItems?: number;
  offset?: number;
}): string {
  const pathRenderOptions = buildTraceableEvidencePathRenderOptions(input.filePath, input.parsed);
  const maxItems = clampTraceableViewItems(input.maxItems, 10);
  const offset = clampTraceableViewOffset(input.offset);
  const evidenceBasis = getRecord(input.parsed.result?.evidenceBasis) ?? {};
  const primaryAnchors = getArray(evidenceBasis.primaryAnchors);
  const secondaryAnchors = getArray(evidenceBasis.secondaryAnchors);
  const unsupportedClaims = getArray(evidenceBasis.unsupportedClaims)
    .map((value) => getString(value))
    .filter((value): value is string => Boolean(value));
  const lines = [
    "# Traceable Evidence Basis",
    "",
    `- Evidence File: ${formatTraceablePathReference(input.filePath, pathRenderOptions)}`,
    `- Primary Anchors: ${primaryAnchors.length}`,
    `- Secondary Anchors: ${secondaryAnchors.length}`,
    `- Unsupported Claims: ${unsupportedClaims.length}`
  ];
  if (Object.keys(evidenceBasis).length === 0) {
    lines.push("", "No evidence-basis slice was persisted in this evidence artifact.");
    return `${lines.join("\n")}\n`;
  }
  const note = getString(evidenceBasis.note);
  if (note) {
    lines.push("", `- Note: ${note}`);
  }
  if (primaryAnchors.length > 0) {
    const window = selectTraceableWindow(primaryAnchors, maxItems, offset);
    lines.push("", "## Primary Anchors", "");
    for (const anchor of window.items) {
      const record = getRecord(anchor) ?? {};
      const anchorPath = getString(record.path) ?? "-";
      const usedFor = getArray(record.usedFor)
        .map((value) => getString(value))
        .filter((value): value is string => Boolean(value));
      const readCount = typeof record.readCount === "number" && Number.isFinite(record.readCount)
        ? record.readCount
        : undefined;
      lines.push(`- ${formatTraceablePathReference(anchorPath, pathRenderOptions, anchorPath)}`);
      lines.push(`  - Kind: ${getString(record.kind) ?? "-"}`);
      lines.push(`  - Used For: ${usedFor.join(", ") || "-"}`);
      lines.push(`  - Read Count: ${readCount ?? "-"}`);
    }
    if (window.items.length < primaryAnchors.length || offset !== undefined) {
      lines.push("", window.label.replace("items", "primary anchors"));
    }
  }
  if (secondaryAnchors.length > 0) {
    lines.push("", "## Secondary Anchors", "");
    for (const anchor of secondaryAnchors) {
      const record = getRecord(anchor) ?? {};
      const anchorPath = getString(record.path) ?? "-";
      const usedFor = getArray(record.usedFor)
        .map((value) => getString(value))
        .filter((value): value is string => Boolean(value));
      lines.push(`- ${formatTraceablePathReference(anchorPath, pathRenderOptions, anchorPath)}`);
      lines.push(`  - Kind: ${getString(record.kind) ?? "-"}`);
      lines.push(`  - Used For: ${usedFor.join(", ") || "-"}`);
    }
  }
  if (unsupportedClaims.length > 0) {
    lines.push("", "## Unsupported Claims", "");
    for (const claim of unsupportedClaims) {
      lines.push(`- ${claim}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

export function renderTraceableEvidenceTimelineMarkdown(input: {
  filePath: string;
  parsed: ParsedTraceableEvidenceState;
  maxItems?: number;
  offset?: number;
}): string {
  const pathRenderOptions = buildTraceableEvidencePathRenderOptions(input.filePath, input.parsed);
  const snapshot = input.parsed.snapshot;
  const result = getRecord(input.parsed.result) ?? {};
  const runtimeDecision = getRecord(result.runtimeDecisionSummary) ?? {};
  const modelSelection = getRecord(runtimeDecision.modelSelection) ?? {};
  const maxItems = clampTraceableViewItems(input.maxItems, 10);
  const offset = clampTraceableViewOffset(input.offset);
  const startedAtMs = parseTraceableTimestampMs(snapshot.startedAt);
  const updatedAtMs = parseTraceableTimestampMs(snapshot.updatedAt);
  const duration = startedAtMs !== undefined && updatedAtMs !== undefined
    ? formatTraceableElapsed(Math.max(0, updatedAtMs - startedAtMs))
    : undefined;
  const timelineEntries = buildTraceableTimelineEntries(input);
  const window = selectTraceableWindow(timelineEntries, maxItems, offset);
  const stepCount = getArrayLength(input.parsed.result?.steps) ?? 0;
  const lines = [
    "# Traceable Evidence Timeline",
    "",
    `- Evidence File: ${formatTraceablePathReference(input.filePath, pathRenderOptions)}`,
    `- Started At: ${formatTraceableTimestamp(snapshot.startedAt) ?? getString(snapshot.startedAt) ?? "-"}`,
    `- Updated At: ${formatTraceableTimestamp(snapshot.updatedAt) ?? getString(snapshot.updatedAt) ?? "-"}`,
    `- Duration: ${duration ?? "-"}`,
    `- Timeline Entries: ${timelineEntries.length}`,
    `- Status Events: ${getStatusHistory(input.parsed).length}`,
    `- Recent Tools: ${getArrayLength(snapshot.recentTools) ?? 0}`,
    `- Tool Calls Recorded: ${getArrayLength(input.parsed.result?.toolCalls) ?? 0}`,
    `- Steps Recorded: ${stepCount}`
  ];
  if (Object.keys(result).length > 0 || Object.keys(modelSelection).length > 0) {
    const requestRouting = getRecord(runtimeDecision.requestRouting ?? {}) ?? {};
    lines.push(
      "",
      "## Decision Points",
      "",
      `- Trace Status: ${getString(result.traceStatus) ?? "-"}`,
      `- Stop Reason: ${getString(result.stopReason) ?? "-"}`,
      `- Completion Claim: ${getString(result.completionClaim) ?? "-"}`,
      `- Selection Mode: ${getString(modelSelection.selectionMode) ?? "-"}`,
      `- Selected Model: ${getString(modelSelection.selectedModelDisplayName) ?? getString(modelSelection.selectedModelId) ?? "-"}`,
      `- Routing Mode: ${getString(requestRouting.mode) ?? "-"}`
    );
  }
  if (timelineEntries.length === 0) {
    lines.push("", "No replay-oriented timeline entries were captured in this evidence artifact.", "");
    return lines.join("\n");
  }
  lines.push("", "## Activity Timeline", "");
  for (const entry of window.items) {
    lines.push(entry.line);
  }
  if (window.items.length < timelineEntries.length || offset !== undefined) {
    lines.push("", window.label.replace("items", "timeline entries"));
  }
  lines.push("");
  return lines.join("\n");
}

export function renderTraceableEvidenceCarryHandoffMarkdown(input: {
  filePath: string;
  parsed: ParsedTraceableEvidenceState;
}): string {
  const pathRenderOptions = buildTraceableEvidencePathRenderOptions(input.filePath, input.parsed);
  const result = getRecord(input.parsed.result) ?? {};
  const activeCarryForward = getRecord(result.activeCarryForward);
  const recoverableCarryState = getRecord(result.recoverableCarryState);
  const disposition = getTraceableCarryStateDisposition(input.parsed) ?? "none";
  const summaryState = activeCarryForward ?? recoverableCarryState;
  const summaryCounts = summarizeTraceableCarryState(summaryState);
  const lines = [
    "# Traceable Evidence Carry Handoff",
    "",
    `- Evidence File: ${formatTraceablePathReference(input.filePath, pathRenderOptions)}`,
    `- Carry State Disposition: ${disposition}`,
    `- Active Carry Forward Present: ${activeCarryForward ? "yes" : "no"}`,
    `- Recoverable Carry State Present: ${recoverableCarryState ? "yes" : "no"}`,
    `- Remaining Goals: ${summaryCounts.goalCount}`,
    `- Open Questions: ${summaryCounts.questionCount}`,
    `- Next Suggested Start Present: ${summaryCounts.hasNextStart ? "yes" : "no"}`
  ];

  switch (disposition) {
    case "active":
      lines.push("", "- Summary: Next trace inherits active carry-forward.");
      break;
    case "recoverable":
      lines.push("", "- Summary: Carry state was preserved for inspection, not auto-inheritance.");
      break;
    case "consumed":
      lines.push("", "- Summary: Carry state was consumed in this run.");
      break;
    case "expired":
      lines.push("", "- Summary: Carry state expired at this boundary.");
      break;
    case "none":
      lines.push("", "- Summary: No carry state remains after this run.");
      break;
  }

  if (!activeCarryForward && !recoverableCarryState && !getString(result.carryStateDisposition)) {
    lines.push("", "No carry-handoff detail was captured in this evidence artifact.", "");
    return lines.join("\n");
  }

  renderTraceableCarryStateSection(lines, "Active Carry Forward", activeCarryForward, pathRenderOptions);
  renderTraceableCarryStateSection(lines, "Recoverable Carry State", recoverableCarryState, pathRenderOptions);
  lines.push("");
  return lines.join("\n");
}

export function renderTraceableEvidenceToolForensicsMarkdown(input: {
  filePath: string;
  parsed: ParsedTraceableEvidenceState;
  maxItems?: number;
  offset?: number;
}): string {
  const pathRenderOptions = buildTraceableEvidencePathRenderOptions(input.filePath, input.parsed);
  const maxItems = clampTraceableViewItems(input.maxItems, 6);
  const offset = clampTraceableViewOffset(input.offset);
  const toolCalls = getToolCalls(input.parsed);
  const lines = [
    "# Traceable Evidence Tool Forensics",
    "",
    `- Evidence File: ${formatTraceablePathReference(input.filePath, pathRenderOptions)}`,
    `- Tool Calls Recorded: ${toolCalls.length}`
  ];
  if (toolCalls.length === 0) {
    lines.push("", "No persisted tool-call forensics were captured in this evidence artifact.");
    return `${lines.join("\n")}\n`;
  }
  const window = selectTraceableWindow(toolCalls, maxItems, offset);
  for (const toolCall of window.items) {
    const output = getRecord(toolCall.output);
    const partKinds = getArray(output?.partKinds)
      .map((value) => getString(value))
      .filter((value): value is string => Boolean(value));
    const rawOutputPreview = formatTraceableBoundedTextPreview(getString(output?.rawText));
    lines.push("", `## ${getString(toolCall.toolName) ?? "unknown"}`, "");
    lines.push(`- Result: ${getString(toolCall.result) ?? "-"}`);
    lines.push(`- Call Id: ${getString(toolCall.callId) ?? "-"}`);
    lines.push(`- Note: ${getString(toolCall.note) ?? "-"}`);
    lines.push(`- Args: ${getString(toolCall.argsSummary) ?? "-"}`);
    lines.push(`- Output Kind: ${getString(output?.kind) ?? "-"}`);
    lines.push(`- Output Summary: ${formatTraceableBoundedTextPreview(getString(output?.summary), 400) ?? "-"}`);
    lines.push(`- Output Metadata: ${formatTraceableBoundedTextPreview(getString(output?.metadataSummary), 400) ?? "-"}`);
    lines.push(`- Part Kinds: ${partKinds.join(", ") || "-"}`);
    lines.push(`- Raw Output Captured: ${getString(output?.rawText) ? "yes" : "no"}`);
    lines.push(`- Raw Output Truncated: ${output?.rawTextTruncated === true ? "yes" : "no"}`);
    if (rawOutputPreview) {
      lines.push("", "### Raw Output Preview", "", "```text", rawOutputPreview, "```");
    }
  }
  if (window.items.length < toolCalls.length || offset !== undefined) {
    lines.push("", window.label.replace("items", "tool calls"));
  }
  lines.push("");
  return lines.join("\n");
}

export function renderTraceableEvidenceLineageMarkdown(input: {
  filePath: string;
  parsed: ParsedTraceableEvidenceState;
}): string {
  const pathRenderOptions = buildTraceableEvidencePathRenderOptions(input.filePath, input.parsed);
  const result = getRecord(input.parsed.result) ?? {};
  const parsedFileName = parseTraceableEvidenceFileName(path.basename(input.filePath));
  const lineageLabel = getString(result.lineageLabel) ?? parsedFileName?.lineageLabel;
  const lineageDepth = getPositiveInteger(result.lineageDepth) ?? parsedFileName?.lineageDepth;
  const parentTracePath = resolveTraceableEvidenceReference(input.filePath, getString(result.parentTracePath));
  const directChildren = lineageLabel ? listDirectChildTraceableEvidencePaths(input.filePath, lineageLabel) : [];
  const continuedFromParent = getString(result.continuedFromParent) ?? (result.continuedFromParent === true ? "yes" : result.continuedFromParent === false ? "no" : undefined);
  const lines = [
    "# Traceable Evidence Lineage",
    "",
    `- Evidence File: ${formatTraceablePathReference(input.filePath, pathRenderOptions)}`,
    `- Current Trace: ${formatTraceablePathReference(input.filePath, pathRenderOptions)}`,
    `- Continued From Parent: ${continuedFromParent ?? (parentTracePath ? "yes" : "no")}`,
    `- Parent Trace Present: ${parentTracePath ? "yes" : "no"}`,
    `- Lineage Label: ${lineageLabel ?? "-"}`,
    `- Lineage Depth: ${lineageDepth ?? "-"}`,
    `- Direct Children: ${directChildren.length}`
  ];
  if (!lineageLabel && !parentTracePath && directChildren.length === 0) {
    lines.push("", "No lineage detail was available in this evidence artifact.", "");
    return lines.join("\n");
  }
  lines.push("", "## Relationships", "");
  lines.push(`- Parent Trace: ${formatTraceablePathReference(parentTracePath, pathRenderOptions)}`);
  if (directChildren.length > 0) {
    lines.push("", "## Direct Children", "");
    for (const childPath of directChildren) {
      lines.push(`- ${formatTraceablePathReference(childPath, pathRenderOptions)}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

export function renderTraceableEvidenceTraceableMarkdown(input: {
  filePath: string;
  parsed: ParsedTraceableEvidenceState;
  includeSupportArtifacts?: boolean;
}): string {
  const pathRenderOptions = buildTraceableEvidencePathRenderOptions(input.filePath, input.parsed);
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
  const pathRenderOptions = buildTraceableEvidencePathRenderOptions(input.filePath, input.parsed);
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
  const pathRenderOptions = buildTraceableEvidencePathRenderOptions(input.filePath, input.parsed);
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
  const pathRenderOptions = buildTraceableEvidencePathRenderOptions(input.filePath, input.parsed);
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
  const pathRenderOptions = buildTraceableEvidencePathRenderOptions(input.filePath, input.parsed);
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
  const pathRenderOptions = buildTraceableEvidencePathRenderOptions(input.filePath, input.parsed);
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
  roleName?: string;
  senderId?: string;
  maxItems?: number;
  offset?: number;
  includeSupportArtifacts?: boolean;
}): string {
  switch (input.surface) {
    case "conversation-brief":
      return renderTraceableEvidenceConversationBriefMarkdown(input);
    case "request-summary":
      return renderTraceableEvidenceRequestSummaryMarkdown(input);
    case "request-contract":
      return renderTraceableEvidenceRequestContractMarkdown(input);
    case "outcome":
      return renderTraceableEvidenceOutcomeMarkdown(input);
    case "runtime-decision":
      return renderTraceableEvidenceRuntimeDecisionMarkdown(input);
    case "evidence-basis":
      return renderTraceableEvidenceBasisMarkdown(input);
    case "timeline":
      return renderTraceableEvidenceTimelineMarkdown(input);
    case "carry-handoff":
      return renderTraceableEvidenceCarryHandoffMarkdown(input);
    case "tool-forensics":
      return renderTraceableEvidenceToolForensicsMarkdown(input);
    case "lineage":
      return renderTraceableEvidenceLineageMarkdown(input);
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
    case "latest-role-state":
      return renderTraceableEvidenceLatestRoleStateMarkdown(input);
    case "latest-carry-package":
      return renderTraceableEvidenceLatestCarryPackageMarkdown(input);
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
        ...buildTraceableEvidencePathRenderOptions(input.filePath, input.parsed),
        includeSupportArtifacts: input.view.includeSupportArtifacts ?? true
      });
    }
    default:
      return renderTraceableEvidenceSurfaceMarkdown({
        filePath: input.filePath,
        parsed: input.parsed,
        surface,
        roleName: input.view.roleName,
        senderId: input.view.senderId,
        maxItems,
        offset,
        includeSupportArtifacts: input.view.includeSupportArtifacts
      });
  }
}