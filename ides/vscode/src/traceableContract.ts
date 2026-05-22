import path from "node:path";
import { pathToFileURL } from "node:url";

export type TraceableStopReason =
  | "completed"
  | "budget_exhausted"
  | "insufficient_grounding"
  | "tool_blocked"
  | "awaiting_input"
  | "policy_stop";

export type TraceableCompletionClaim = "complete" | "partial" | "unresolved";
export type TraceableStepStatus = "planned" | "attempted" | "completed" | "failed" | "skipped";
export type TraceableToolResult = "success" | "failure" | "timeout" | "inputNeeded" | "notRun";
export type TraceableStatus = "trace-supported" | "trace-incomplete" | "trace-conflicted";

export type TraceableSubagentInputMode = "OPERATIVE" | "EPISTEMIC" | "NON_LEADING_EPISTEMIC";
export type TraceableSubagentValidationMode = "NONE" | "WARN" | "ERROR";
export type TraceableSubagentOutputMode = "summary-with-evidence-path" | "full-markdown-with-evidence-path" | "evidence-path-only";

export interface TraceableMarkdownPathRenderOptions {
  mode?: "plain" | "relative-markdown" | "absolute-file-uri-markdown";
  baseDir?: string;
}

export interface TraceableMarkdownRenderOptions extends TraceableMarkdownPathRenderOptions {
  includeSupportArtifacts?: boolean;
}

export interface TraceableSubagentStatusHeader {
  agentName?: string;
  agentFilePath?: string;
  agentResolved?: boolean;
  modelLabel?: string;
  candidate?: boolean;
  experimental?: boolean;
  humanRole?: boolean;
  toolsetNames?: string[];
  selectedToolNames?: string[];
  toolSelectionRestricted?: boolean;
}

export interface TraceableSubagentRequestSummaryItem {
  label: string;
  value: string;
  title?: string;
}

export interface TraceableSubagentToolStatusEvent {
  callId: string;
  toolName: string;
  phase: "running" | "success" | "deferred" | "failure";
  input?: Record<string, unknown>;
  note?: string;
  elapsedMs?: number;
  occurredAt?: string;
}

export interface TraceableAgentRole {
  name: string;
  filePath?: string;
}

export interface TraceableSubagentEvidenceFileState {
  status: "idle" | "writing" | "ready" | "failed";
  filePath?: string;
  fileName?: string;
  error?: string;
  requestedBy?: "tool-input" | "ui-export";
  outputMode?: TraceableSubagentOutputMode;
}

export interface TraceableModelSelector {
  vendor?: string;
  family?: string;
  id?: string;
  version?: string;
}

export interface TraceableRequestExpectations {
  expectedSteps?: string[];
  expectedToolFamilies?: string[];
  disallowStrongConclusionWithoutEvidence?: boolean;
}

export interface TraceableCarriedContext {
  priorTurnsSummary?: string;
  fileContext?: string[];
  reductions?: string[];
}

export interface TraceableWrapperPolicy {
  name?: string;
  closureMode?: "open" | "bounded-summary" | "explicit-final";
}

export interface TraceableBudgetPolicy {
  maxIterations?: number;
  maxToolCalls?: number;
}

export interface TraceableSubagentInput {
  userInput: string;
  parentFrame?: string;
  parentTask?: string;
  outputMode?: TraceableSubagentOutputMode;
  exportToFolder?: string;
  inputMode?: TraceableSubagentInputMode;
  validationMode?: TraceableSubagentValidationMode;
  reveal?: boolean;
  agentRole?: TraceableAgentRole;
  parentExpectations?: TraceableRequestExpectations;
  carriedContext?: TraceableCarriedContext;
  wrapperPolicy?: TraceableWrapperPolicy;
  budgetPolicy?: TraceableBudgetPolicy;
  modelSelector?: TraceableModelSelector;
  allowedToolNames?: string[];
  blockedToolNames?: string[];
}

export interface TraceableSubagentStep {
  id: string;
  intent: string;
  status: TraceableStepStatus;
  note?: string;
}

export interface TraceableSubagentMissingItem {
  kind: "step" | "toolCall";
  label: string;
  reason: string;
}

export interface TraceableOpaqueDelegation {
  toolName: string;
  note: string;
}

export interface TraceableSubagentChildPayload {
  steps: TraceableSubagentStep[];
  expectedButMissing: TraceableSubagentMissingItem[];
  stopReason: TraceableStopReason;
  completionClaim: TraceableCompletionClaim;
  finalSummary: string;
  opaqueDelegations?: TraceableOpaqueDelegation[];
}

export interface TraceableSubagentToolCallRecord {
  callId: string;
  toolName: string;
  argsSummary: string;
  result: TraceableToolResult;
  note?: string;
}

export interface TraceableSubagentUsageSummary {
  provenance: "exact" | "partial" | "unavailable";
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  note?: string;
}

export interface TraceableSubagentIterationMetric {
  iteration: number;
  isFinalRecoveryIteration: boolean;
  elapsedMs: number;
  assistantTextLength: number;
  toolCallCount: number;
  requestedToolCallCount?: number;
  executedToolCallCount?: number;
  deferredToolCallCount?: number;
  nonConsumingRetryGranted?: boolean;
  remainingToolCalls?: number;
  usage?: TraceableSubagentUsageSummary;
}

export interface TraceableSubagentRunResult {
  request: Record<string, unknown>;
  outputMode?: TraceableSubagentOutputMode;
  model: {
    vendor: string;
    family: string;
    id: string;
    version: string;
  } | null;
  allowedToolNames: string[];
  toolCalls: TraceableSubagentToolCallRecord[];
  traceStatus: TraceableStatus;
  steps: TraceableSubagentStep[];
  expectedButMissing: TraceableSubagentMissingItem[];
  stopReason: TraceableStopReason;
  completionClaim: TraceableCompletionClaim;
  finalSummary: string;
  validationIssues: string[];
  opaqueDelegations: TraceableOpaqueDelegation[];
  usage?: TraceableSubagentUsageSummary;
  iterationMetrics?: TraceableSubagentIterationMetric[];
  rawModelText?: string;
  debugLogPath?: string;
  elapsedMs?: number;
  evidenceFile?: TraceableSubagentEvidenceFileState;
  evidenceMarkdown?: string;
}

const DEFAULT_MAX_ITERATIONS = 4;
const DEFAULT_MAX_TOOL_CALLS = 6;
const DEFAULT_OUTPUT_TEXT_CHARS = 1600;

export function normalizeTraceableOutputMode(mode: unknown): TraceableSubagentOutputMode | undefined {
  const normalized = typeof mode === "string" ? mode.trim().toLowerCase() : "";
  switch (normalized) {
    case "summary-with-evidence-path":
    case "full-markdown-with-evidence-path":
    case "evidence-path-only":
      return normalized;
    default:
      return undefined;
  }
}

export function normalizeTraceableInputMode(mode: unknown): TraceableSubagentInputMode | undefined {
  const normalized = typeof mode === "string" ? mode.trim().toUpperCase() : "";
  switch (normalized) {
    case "OPERATIVE":
    case "EPISTEMIC":
    case "NON_LEADING_EPISTEMIC":
      return normalized;
    default:
      return undefined;
  }
}

export function normalizeTraceableValidationMode(mode: unknown): TraceableSubagentValidationMode | undefined {
  const normalized = typeof mode === "string" ? mode.trim().toUpperCase() : "";
  switch (normalized) {
    case "NONE":
    case "WARN":
    case "ERROR":
      return normalized;
    default:
      return undefined;
  }
}

export function normalizeModelSelector(selector: TraceableModelSelector | undefined): TraceableModelSelector {
  return {
    vendor: selector?.vendor?.trim() || undefined,
    family: selector?.family?.trim() || undefined,
    id: selector?.id?.trim() || undefined,
    version: selector?.version?.trim() || undefined
  };
}

export function normalizeAgentRole(input: TraceableAgentRole | undefined): TraceableAgentRole | undefined {
  const name = input?.name?.trim();
  const filePath = input?.filePath?.trim();
  if (!name && !filePath) {
    return undefined;
  }

  const fallbackName = filePath
    ?.split(/[\\/]/u)
    .pop()
    ?.replace(/\.agent\.md$/u, "")
    .trim();

  return {
    name: name || fallbackName || "unknown-agent",
    filePath: filePath || undefined
  };
}

export function normalizeBudgetPolicy(input: TraceableSubagentInput): Required<TraceableBudgetPolicy> {
  const maxIterations = Number.isInteger(input.budgetPolicy?.maxIterations) && (input.budgetPolicy?.maxIterations ?? 0) > 0
    ? input.budgetPolicy!.maxIterations!
    : DEFAULT_MAX_ITERATIONS;
  const maxToolCalls = Number.isInteger(input.budgetPolicy?.maxToolCalls) && (input.budgetPolicy?.maxToolCalls ?? 0) > 0
    ? input.budgetPolicy!.maxToolCalls!
    : DEFAULT_MAX_TOOL_CALLS;
  return {
    maxIterations,
    maxToolCalls
  };
}

export function normalizedWrapperPolicy(input: TraceableSubagentInput): Required<TraceableWrapperPolicy> {
  return {
    name: input.wrapperPolicy?.name?.trim() || "tiinex-traceable-subagent-v1",
    closureMode: input.wrapperPolicy?.closureMode || "bounded-summary"
  };
}

export function resolveTraceableParentFrame(input: Pick<TraceableSubagentInput, "parentFrame" | "parentTask">): string {
  return input.parentFrame?.trim() || input.parentTask?.trim() || "";
}

export function uniqueStrings(values: string[] | undefined): string[] {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

export function buildTraceableSubagentRequestEnvelope(input: TraceableSubagentInput): Record<string, unknown> {
  const wrapperPolicy = normalizedWrapperPolicy(input);
  const budgetPolicy = normalizeBudgetPolicy(input);
  const normalizedModelSelector = normalizeModelSelector(input.modelSelector);
  const normalizedAgentRole = normalizeAgentRole(input.agentRole);
  const normalizedInputMode = normalizeTraceableInputMode(input.inputMode);
  const normalizedValidationMode = normalizeTraceableValidationMode(input.validationMode);
  const normalizedOutputMode = normalizeTraceableOutputMode(input.outputMode);
  const exportToFolder = input.exportToFolder?.trim();
  const parentFrame = resolveTraceableParentFrame(input);
  const request: Record<string, unknown> = {
    userInput: input.userInput,
    parentFrame,
    wrapperPolicy,
    budgetPolicy
  };

  if (normalizedInputMode) {
    request.inputMode = normalizedInputMode;
  }
  if (normalizedValidationMode) {
    request.validationMode = normalizedValidationMode;
  }
  if (normalizedOutputMode) {
    request.outputMode = normalizedOutputMode;
  }
  if (exportToFolder) {
    request.exportToFolder = exportToFolder;
  }
  if (normalizedAgentRole) {
    request.agentRole = normalizedAgentRole;
  }
  if (input.parentExpectations) {
    request.parentExpectations = input.parentExpectations;
  }
  if (input.carriedContext) {
    request.carriedContext = input.carriedContext;
  }
  if (normalizedModelSelector.vendor || normalizedModelSelector.family || normalizedModelSelector.id || normalizedModelSelector.version) {
    request.modelSelector = normalizedModelSelector;
  }

  const allowedToolNames = uniqueStrings(input.allowedToolNames);
  const blockedToolNames = uniqueStrings(input.blockedToolNames);
  if (allowedToolNames.length > 0) {
    request.allowedToolNames = allowedToolNames;
  }
  if (blockedToolNames.length > 0) {
    request.blockedToolNames = blockedToolNames;
  }

  return request;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeMissingItems(value: unknown): TraceableSubagentMissingItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (!trimmed) {
        return [];
      }
      return [{
        kind: "step" as const,
        label: trimmed,
        reason: "Reported as a plain-text missing item by the child lane."
      }];
    }
    if (!isRecord(item)) {
      return [];
    }
    return [{
      kind: item.kind === "toolCall" ? "toolCall" : "step",
      label: typeof item.label === "string" ? item.label : "unknown",
      reason: typeof item.reason === "string" ? item.reason : "No reason provided."
    }];
  });
}

export function normalizeSteps(value: unknown): TraceableSubagentStep[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item, index) => {
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (!trimmed) {
        return [];
      }
      return [{
        id: `step-${index + 1}`,
        intent: trimmed,
        status: "attempted" as const,
        note: undefined
      }];
    }
    if (!isRecord(item)) {
      return [];
    }
    return [{
      id: typeof item.id === "string" ? item.id : `step-${index + 1}`,
      intent: typeof item.intent === "string" ? item.intent : "unspecified",
      status: item.status === "planned"
        || item.status === "attempted"
        || item.status === "completed"
        || item.status === "failed"
        || item.status === "skipped"
        ? item.status
        : "attempted",
      note: typeof item.note === "string" ? item.note : undefined
    }];
  });
}

export function normalizeOpaqueDelegations(value: unknown): TraceableOpaqueDelegation[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(isRecord)
    .map((item) => ({
      toolName: typeof item.toolName === "string" ? item.toolName : "unknown",
      note: typeof item.note === "string" ? item.note : "Opaque delegation was reported without a note."
    }));
}

export function normalizeStopReasonValue(value: unknown): TraceableStopReason | undefined {
  if (value === "completed"
    || value === "budget_exhausted"
    || value === "insufficient_grounding"
    || value === "tool_blocked"
    || value === "awaiting_input"
    || value === "policy_stop") {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (/(^|[\s_:-])complete(?:d)?([\s_:-]|$)|\bsummary produced\b|\bfinished\b/u.test(normalized)) {
    return "completed";
  }
  if (/\bbudget\b|\bexhausted\b/u.test(normalized)) {
    return "budget_exhausted";
  }
  if (/\btool\b.*\bblocked\b|\bblocked\b.*\btool\b/u.test(normalized)) {
    return "tool_blocked";
  }
  if (/\bawaiting input\b|\bneeds input\b|\binput required\b/u.test(normalized)) {
    return "awaiting_input";
  }
  if (/\bpolicy\b.*\bstop\b|\bstopped by policy\b/u.test(normalized)) {
    return "policy_stop";
  }
  if (/\binsufficient\b|\bnot enough\b|\bpartial evidence\b|\bunresolved\b/u.test(normalized)) {
    return "insufficient_grounding";
  }
  if (/\bas requested\b|\bno further reads needed\b|\bbounded-read-complete\b|\bfound and reported\b|\breported as requested\b|\bminimal read sufficient\b|\bread sufficient\b|\bsufficient per contract\b/u.test(normalized)) {
    return "completed";
  }
  return undefined;
}

export function normalizeCompletionClaimValue(value: unknown, stopReason: TraceableStopReason | undefined): TraceableCompletionClaim | undefined {
  const reconcileWithStopReason = (claim: TraceableCompletionClaim | undefined): TraceableCompletionClaim | undefined => {
    if (!claim || !stopReason) {
      return claim;
    }
    if (stopReason === "completed") {
      return claim;
    }
    if (stopReason === "budget_exhausted" || stopReason === "insufficient_grounding") {
      return claim === "complete" ? "partial" : claim;
    }
    if (stopReason === "tool_blocked" || stopReason === "awaiting_input" || stopReason === "policy_stop") {
      return claim === "complete" ? "unresolved" : claim;
    }
    return claim;
  };

  if (value === true) {
    return reconcileWithStopReason(stopReason === "insufficient_grounding" ? "partial" : "complete");
  }
  if (value === false) {
    return reconcileWithStopReason("unresolved");
  }
  const rawCompletionClaim = typeof value === "string" ? value.trim() : "";
  if (rawCompletionClaim === "complete"
    || rawCompletionClaim === "partial"
    || rawCompletionClaim === "unresolved") {
    return reconcileWithStopReason(rawCompletionClaim);
  }
  if (!rawCompletionClaim) {
    return undefined;
  }
  const normalized = rawCompletionClaim.toLowerCase();
  if (normalized === "partial_evidence_only" || /\bpartial\b|\bpartial evidence\b/u.test(normalized)) {
    return reconcileWithStopReason("partial");
  }
  if (/\bunresolved\b|\bnot verified\b|\bnot confirmed\b|\binsufficient\b/u.test(normalized)) {
    return reconcileWithStopReason("unresolved");
  }
  if (/\bconfirmed\b|\bcomplete\b|\bcompleted\b|\bgrounded\b|\bderived\b|\bverified\b|\bsucceeded\b|\bsuccessful\b|\bsuccess\b/u.test(normalized)) {
    return reconcileWithStopReason("complete");
  }
  return reconcileWithStopReason(stopReason === "completed"
    ? "complete"
    : "unresolved");
}

export function normalizeFinalSummaryValue(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeFinalSummaryValue(entry))
      .filter((entry) => entry.length > 0)
      .map((entry) => `- ${entry}`)
      .join("\n");
  }
  if (!isRecord(value)) {
    return "";
  }

  return Object.entries(value)
    .flatMap(([key, entry]) => {
      const label = key.replace(/[_-]+/g, " ").toUpperCase();
      const normalizedEntry = normalizeFinalSummaryValue(entry);
      if (!normalizedEntry) {
        return [];
      }
      if (Array.isArray(entry) || isRecord(entry)) {
        return [label, normalizedEntry];
      }
      return [`${label}: ${normalizedEntry}`];
    })
    .join("\n");
}

export function normalizeParsedPayload(value: unknown): TraceableSubagentChildPayload | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const normalizedStopReason = normalizeStopReasonValue(value.stopReason);
  const stopReason = normalizedStopReason ?? (normalizeCompletionClaimValue(value.completionClaim, normalizedStopReason) === "complete"
    ? "completed"
    : undefined);
  const completionClaim = normalizeCompletionClaimValue(value.completionClaim, stopReason);
  const finalSummary = normalizeFinalSummaryValue(value.finalSummary);
  if (!stopReason || !completionClaim || !finalSummary) {
    return undefined;
  }
  return {
    steps: normalizeSteps(value.steps),
    expectedButMissing: normalizeMissingItems(value.expectedButMissing),
    stopReason,
    completionClaim,
    finalSummary,
    opaqueDelegations: normalizeOpaqueDelegations(value.opaqueDelegations)
  };
}

export function extractBalancedJsonObjectCandidates(rawText: string): string[] {
  const candidates: string[] = [];
  let startIndex = -1;
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = 0; index < rawText.length; index += 1) {
    const char = rawText[index];

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === "\\") {
        escaping = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        startIndex = index;
      }
      depth += 1;
      continue;
    }

    if (char !== "}" || depth === 0) {
      continue;
    }

    depth -= 1;
    if (depth === 0 && startIndex >= 0) {
      candidates.push(rawText.slice(startIndex, index + 1).trim());
      startIndex = -1;
    }
  }

  return candidates;
}

export function extractTraceableSubagentPayload(rawText: string): TraceableSubagentChildPayload | undefined {
  const candidates = [rawText.trim()];
  const fencedMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    candidates.push(fencedMatch[1].trim());
  }
  const firstBrace = rawText.indexOf("{");
  const lastBrace = rawText.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(rawText.slice(firstBrace, lastBrace + 1).trim());
  }
  candidates.push(...extractBalancedJsonObjectCandidates(rawText));

  for (const candidate of [...new Set(candidates)]) {
    if (!candidate) {
      continue;
    }
    try {
      const parsed = JSON.parse(candidate);
      const normalized = normalizeParsedPayload(parsed);
      if (normalized) {
        return normalized;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

export function resolveTraceStatus(
  parsedPayload: TraceableSubagentChildPayload | undefined,
  toolCalls: TraceableSubagentToolCallRecord[],
  opaqueDelegations: TraceableOpaqueDelegation[]
): TraceableStatus {
  if (!parsedPayload) {
    return "trace-incomplete";
  }
  if (parsedPayload.completionClaim === "complete" && toolCalls.some((entry) => entry.result === "failure" || entry.result === "notRun" || entry.result === "timeout")) {
    return "trace-conflicted";
  }
  if (opaqueDelegations.length > 0 || toolCalls.some((entry) => entry.result === "failure" || entry.result === "timeout" || entry.result === "inputNeeded")) {
    return "trace-incomplete";
  }
  return "trace-supported";
}

export function fallbackResult(
  input: TraceableSubagentInput,
  toolCalls: TraceableSubagentToolCallRecord[],
  finalSummary: string,
  stopReason: TraceableStopReason,
  completionClaim: TraceableCompletionClaim,
  extra: Partial<TraceableSubagentRunResult> = {}
): TraceableSubagentRunResult {
  return {
    request: buildTraceableSubagentRequestEnvelope(input),
    outputMode: normalizeTraceableOutputMode(input.outputMode) ?? (input.exportToFolder?.trim() ? "summary-with-evidence-path" : undefined),
    model: extra.model ?? null,
    allowedToolNames: extra.allowedToolNames ?? [],
    toolCalls,
    traceStatus: extra.traceStatus ?? "trace-incomplete",
    steps: extra.steps ?? [],
    expectedButMissing: extra.expectedButMissing ?? [],
    stopReason,
    completionClaim,
    finalSummary,
    validationIssues: extra.validationIssues ?? [],
    opaqueDelegations: extra.opaqueDelegations ?? [],
    rawModelText: extra.rawModelText,
    debugLogPath: extra.debugLogPath,
    elapsedMs: extra.elapsedMs,
    evidenceFile: extra.evidenceFile,
    evidenceMarkdown: extra.evidenceMarkdown,
    usage: extra.usage,
    iterationMetrics: extra.iterationMetrics
  };
}

export function normalizeTraceableComparisonText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function collectTraceableInputValidationIssues(input: TraceableSubagentInput): string[] {
  const inputMode = normalizeTraceableInputMode(input.inputMode);
  if (inputMode !== "NON_LEADING_EPISTEMIC") {
    return [];
  }

  const issues: string[] = [];
  const validationMode = normalizeTraceableValidationMode(input.validationMode);
  const normalizedUserInput = normalizeTraceableComparisonText(input.userInput);
  const parentFrame = resolveTraceableParentFrame(input);
  const normalizedParentFrame = normalizeTraceableComparisonText(parentFrame);

  if (validationMode !== "WARN" && validationMode !== "ERROR") {
    issues.push("Declared NON_LEADING_EPISTEMIC mode requires validationMode WARN or ERROR; NONE or omitted is invalid.");
  }

  if (normalizedUserInput && normalizedParentFrame && normalizedUserInput === normalizedParentFrame) {
    issues.push("Declared NON_LEADING_EPISTEMIC mode expects parentFrame to add a bounded investigative contract rather than mirroring userInput verbatim.");
  }

  if (/\b(prove|confirm|establish|demonstrate|show|argue|make the case)\b(?:\s+\w+){0,3}\s+that\b/i.test(parentFrame)) {
    issues.push("Declared NON_LEADING_EPISTEMIC mode conflicts with a leading parentFrame phrased as proving or confirming a target conclusion.");
  }

  return uniqueStrings(issues);
}

export function buildUnparseableChildPayloadFallback(
  input: TraceableSubagentInput,
  toolCalls: TraceableSubagentToolCallRecord[],
  rawModelText: string,
  model: TraceableSubagentRunResult["model"],
  allowedToolNames: string[],
  validationIssues: string[] = []
): TraceableSubagentRunResult {
  const trimmed = rawModelText.trim();
  const askedForMoreReads = /\b(i will read|read the remainder|read more|going to read more)\b/i.test(trimmed)
    || /"filePath"\s*:/i.test(trimmed);

  return fallbackResult(
    input,
    toolCalls,
    askedForMoreReads
      ? "Child lane did not emit a final JSON payload and instead attempted to continue reading. See Raw Child Output for the exact text."
      : "Child lane returned no parseable final JSON payload. See Raw Child Output for the exact text.",
    "insufficient_grounding",
    "unresolved",
    {
      model,
      allowedToolNames,
      validationIssues,
      rawModelText,
      expectedButMissing: [
        {
          kind: "step",
          label: "Final JSON payload",
          reason: askedForMoreReads
            ? "The child attempted to continue reading instead of emitting the required final JSON object."
            : "The child stopped without emitting a parseable final JSON object."
        }
      ]
    }
  );
}

export function buildEmptyChildResponseFallback(
  input: TraceableSubagentInput,
  toolCalls: TraceableSubagentToolCallRecord[],
  model: TraceableSubagentRunResult["model"],
  allowedToolNames: string[],
  validationIssues: string[] = []
): TraceableSubagentRunResult {
  return fallbackResult(
    input,
    toolCalls,
    "Child lane returned an empty response stream and no final trace payload. Host may have surfaced a no-choices response before any text or tool calls were emitted.",
    "tool_blocked",
    "unresolved",
    {
      model,
      allowedToolNames,
      validationIssues,
      rawModelText: "",
      expectedButMissing: [
        {
          kind: "step",
          label: "Final JSON payload",
          reason: "The child response stream ended before any text, tool calls, or parseable final JSON payload were emitted."
        }
      ]
    }
  );
}

export function encodeMarkdownHrefPath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment === "." || segment === ".." ? segment : encodeURIComponent(segment))
    .join("/");
}

export function formatTraceablePathReference(
  filePath: string | undefined,
  options: TraceableMarkdownPathRenderOptions | undefined,
  fallback = "-"
): string {
  const trimmed = filePath?.trim();
  if (!trimmed) {
    return fallback;
  }
  const mode = options?.mode ?? "plain";
  if (mode === "plain") {
    return trimmed;
  }
  const label = path.basename(trimmed);
  if (mode === "absolute-file-uri-markdown") {
    return `[${label}](${pathToFileURL(trimmed).toString()})`;
  }
  const baseDir = options?.baseDir?.trim();
  if (!baseDir) {
    return trimmed;
  }
  const relativePath = path.relative(baseDir, trimmed);
  if (!relativePath) {
    return `[${label}](${encodeMarkdownHrefPath(path.join("..", label))})`;
  }
  if (path.isAbsolute(relativePath)) {
    return `[${label}](${pathToFileURL(trimmed).toString()})`;
  }
  return `[${label}](${encodeMarkdownHrefPath(relativePath)})`;
}

export function collectTraceableTextRewritePaths(value: unknown, paths = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectTraceableTextRewritePaths(entry, paths);
    }
    return paths;
  }
  if (!value || typeof value !== "object") {
    return paths;
  }
  const record = value as Record<string, unknown>;
  for (const [key, entry] of Object.entries(record)) {
    const normalizedKey = key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
    if (typeof entry === "string" && /(?:^|_)(file_path|filepath|debug_log_path|debuglogpath|export_to_folder|exporttofolder)$/iu.test(normalizedKey)) {
      const trimmed = entry.trim();
      if (trimmed) {
        paths.add(trimmed);
      }
      continue;
    }
    collectTraceableTextRewritePaths(entry, paths);
  }
  return paths;
}

export function rewriteTraceableTextPathMentions(
  text: string,
  result: TraceableSubagentRunResult,
  options: TraceableMarkdownPathRenderOptions | undefined
): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return trimmed;
  }
  const candidatePaths = Array.from(collectTraceableTextRewritePaths(result.request));
  if (result.debugLogPath?.trim()) {
    candidatePaths.push(result.debugLogPath.trim());
  }
  if (result.evidenceFile?.filePath?.trim()) {
    const evidenceFilePath = result.evidenceFile.filePath.trim();
    candidatePaths.push(evidenceFilePath, path.dirname(evidenceFilePath));
  }
  const uniqueCandidates = Array.from(new Set(candidatePaths
    .filter(Boolean)
    .flatMap((candidatePath) => candidatePath.includes("\\")
      ? [candidatePath, candidatePath.replace(/\\/g, "\\\\")]
      : [candidatePath]))).sort((left, right) => right.length - left.length);
  let rewritten = trimmed;
  for (const candidatePath of uniqueCandidates) {
    const rendered = formatTraceablePathReference(candidatePath.replace(/\\\\/g, "\\"), options, candidatePath);
    rewritten = rewritten.split(candidatePath).join(rendered);
  }
  return rewritten;
}

export function summarizeEvidenceFile(state: TraceableSubagentEvidenceFileState | undefined, options?: TraceableMarkdownPathRenderOptions): string {
  if (!state || state.status === "idle") {
    return "-";
  }
  const parts: string[] = [state.status];
  if (state.filePath) {
    parts.push(formatTraceablePathReference(state.filePath, options));
  }
  if (state.error) {
    parts.push(state.error);
  }
  return parts.join(" | ");
}

export function renderTraceableSubagentEvidencePathOnly(result: TraceableSubagentRunResult, options?: TraceableMarkdownPathRenderOptions): string {
  const evidenceFile = result.evidenceFile;
  const finalSummary = rewriteTraceableTextPathMentions(result.finalSummary, result, options);
  const lines = [
    "# Traceable Subagent Result",
    "",
    `- Stop Reason: ${result.stopReason}`,
    `- Completion Claim: ${result.completionClaim}`,
    `- Final Summary: ${finalSummary}`,
    `- Evidence File Status: ${evidenceFile?.status ?? "idle"}`,
    `- Evidence File: ${formatTraceablePathReference(evidenceFile?.filePath, options)}`
  ];
  if (evidenceFile?.error) {
    lines.push(`- Evidence File Error: ${evidenceFile.error}`);
  }
  return `${lines.join("\n")}\n`;
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 16))}... [truncated]`;
}

export function summarizeJson(value: unknown, maxChars = 180): string {
  try {
    return truncate(JSON.stringify(value), maxChars);
  } catch {
    return truncate(String(value), maxChars);
  }
}

export function appendBoundedJsonPreview(lines: string[], title: string, value: unknown, maxChars = DEFAULT_OUTPUT_TEXT_CHARS): void {
  const preview = truncate(JSON.stringify(value, null, 2), maxChars);
  lines.push(
    title,
    "```json",
    preview,
    "```"
  );

  if (preview.includes("[truncated]")) {
    lines.push("- Preview bounded for chat readability.");
  }
}

export function mapPathLikeFields(value: unknown, options: TraceableMarkdownPathRenderOptions | undefined): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => mapPathLikeFields(entry, options));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  const mapped: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "string" && /(?:^|_)(file_path|filepath|debug_log_path|debuglogpath|export_to_folder|exporttofolder)$/iu.test(key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`))) {
      mapped[key] = options?.mode === "relative-markdown"
        ? (() => {
          const relativePath = path.relative(options.baseDir ?? path.dirname(entry), entry).replace(/\\/g, "/") || path.basename(entry);
          return path.isAbsolute(relativePath) ? pathToFileURL(entry).toString() : relativePath;
        })()
        : options?.mode === "absolute-file-uri-markdown"
          ? pathToFileURL(entry).toString()
          : entry;
      continue;
    }
    mapped[key] = mapPathLikeFields(entry, options);
  }
  return mapped;
}

export function extractObservedReadTargets(toolCalls: TraceableSubagentToolCallRecord[]): string[] {
  const filePaths = toolCalls.flatMap((entry) => {
    if (!/readfile/i.test(entry.toolName)) {
      return [];
    }
    try {
      const parsed = JSON.parse(entry.argsSummary);
      if (isRecord(parsed) && typeof parsed.filePath === "string" && parsed.filePath.trim()) {
        return [parsed.filePath.trim()];
      }
    } catch {
      return [];
    }
    return [];
  });
  const uniquePaths = [...new Set(filePaths)];
  const basenameCounts = new Map<string, number>();

  for (const filePath of uniquePaths) {
    const basename = path.basename(filePath);
    basenameCounts.set(basename, (basenameCounts.get(basename) ?? 0) + 1);
  }

  return uniquePaths.map((filePath) => {
    const basename = path.basename(filePath);
    if ((basenameCounts.get(basename) ?? 0) <= 1) {
      return basename;
    }
    const parent = path.basename(path.dirname(filePath));
    return parent ? `${parent}/${basename}` : basename;
  });
}

export function summarizeObservedScope(targets: string[]): string {
  if (targets.length === 0) {
    return "No concrete read targets surfaced.";
  }
  if (targets.length <= 3) {
    return targets.join(", ");
  }
  return `${targets.slice(0, 3).join(", ")} +${targets.length - 3} more`;
}

export function summarizeMissingSignal(items: TraceableSubagentMissingItem[]): string {
  if (items.length === 0) {
    return "No explicit missing item was recorded.";
  }
  const first = items[0];
  return truncate(`${first.label}: ${first.reason}`, 140);
}

export function formatElapsedMs(elapsedMs: number | undefined): string {
  if (!Number.isFinite(elapsedMs) || (elapsedMs ?? 0) < 0) {
    return "-";
  }
  const totalMilliseconds = Math.round(elapsedMs ?? 0);
  if (totalMilliseconds < 1000) {
    return `${totalMilliseconds}ms`;
  }
  const totalSeconds = totalMilliseconds / 1000;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${seconds}s`;
}

export function summarizeUsage(result: TraceableSubagentRunResult): string {
  const usage = result.usage;
  if (!usage || usage.provenance === "unavailable") {
    return usage?.note ?? "unavailable on this surface";
  }

  if (usage.provenance === "partial") {
    return usage.note ?? "partial exact usage only";
  }

  const parts: string[] = [];
  if (usage.promptTokens !== undefined) {
    parts.push(`prompt ${usage.promptTokens}`);
  }
  if (usage.completionTokens !== undefined) {
    parts.push(`completion ${usage.completionTokens}`);
  }
  if (usage.totalTokens !== undefined) {
    parts.push(`total ${usage.totalTokens}`);
  }
  return parts.length > 0 ? `exact: ${parts.join(", ")}` : "exact usage surfaced";
}

export function renderTraceableSubagentMarkdown(result: TraceableSubagentRunResult, options?: TraceableMarkdownRenderOptions): string {
  const outputMode = normalizeTraceableOutputMode(result.outputMode ?? result.request.outputMode);
  if (outputMode === "full-markdown-with-evidence-path" && result.evidenceMarkdown?.trim()) {
    return `${result.evidenceMarkdown.trimEnd()}\n`;
  }
  if (outputMode === "evidence-path-only") {
    return renderTraceableSubagentEvidencePathOnly(result, options);
  }
  const validationIssues = result.validationIssues ?? [];
  const recentSteps = result.steps.slice(0, 6);
  const completedStepCount = result.steps.filter((step) => step.status === "completed").length;
  const successfulToolCallCount = result.toolCalls.filter((toolCall) => toolCall.result === "success").length;
  const iterationCount = result.iterationMetrics?.length ?? 0;
  const observedReadTargets = extractObservedReadTargets(result.toolCalls);
  const quickReadScope = summarizeObservedScope(observedReadTargets);
  const rewrittenFinalSummary = rewriteTraceableTextPathMentions(result.finalSummary, result, options);
  const quickReadConclusion = truncate(rewrittenFinalSummary || "No final summary recorded.", 180);
  const quickReadMissing = rewriteTraceableTextPathMentions(summarizeMissingSignal(result.expectedButMissing), result, options);
  const usageSummary = summarizeUsage(result);
  const elapsedSummary = formatElapsedMs(result.elapsedMs);
  const completedStepsSummary = result.steps.length > 0
    ? `${completedStepCount}/${result.steps.length}`
    : "- (no final child steps captured)";
  const lines = [
    "# Traceable Subagent Result",
    "",
    "## Quick Read",
    "",
    `- Read: ${quickReadScope}`,
    `- Took: ${elapsedSummary}`,
    `- Usage: ${usageSummary}`,
    `- Concluded: ${quickReadConclusion}`,
    `- Missing: ${quickReadMissing}`,
    "",
    "## At a Glance",
    "",
    `- Completed Steps: ${completedStepsSummary}`,
    `- Successful Tool Calls: ${successfulToolCallCount}/${result.toolCalls.length}`,
    `- Iterations: ${iterationCount > 0 ? iterationCount : "-"}`,
    `- Elapsed: ${elapsedSummary}`,
    `- Observed Read Targets: ${observedReadTargets.length > 0 ? `${observedReadTargets.length} unique` : "-"}`,
    `- Outstanding Gaps: ${result.expectedButMissing.length}`,
    `- Validation Issues: ${validationIssues.length}`,
    `- Opaque Delegations: ${result.opaqueDelegations.length}`,
    "",
    "## Outcome",
    "",
    `- Trace Status: ${result.traceStatus}`,
    `- Stop Reason: ${result.stopReason}`,
    `- Completion Claim: ${result.completionClaim}`,
    `- Final Summary: ${rewrittenFinalSummary}`,
    `- Validation Issues: ${validationIssues.length > 0 ? validationIssues.join(" | ") : "-"}`,
    `- Model: ${result.model ? `${result.model.vendor}/${result.model.family}/${result.model.id}` : "-"}`,
    `- Usage: ${usageSummary}`,
    `- Elapsed: ${elapsedSummary}`,
    `- Output Mode: ${outputMode ?? "summary-without-export"}`,
    `- Evidence File: ${summarizeEvidenceFile(result.evidenceFile, options)}`,
    `- Allowed Tool Count: ${result.allowedToolNames.length}`,
    `- Runtime Tool Calls: ${result.toolCalls.length}`,
    ""
  ];

  if (observedReadTargets.length > 0) {
    lines.push("## Observed Scope", "");
    for (const target of observedReadTargets.slice(0, 8)) {
      lines.push(`- ${target}`);
    }
    if (observedReadTargets.length > 8) {
      lines.push(`- ${observedReadTargets.length - 8} more observed target(s) omitted.`);
    }
    lines.push("");
  }

  if (recentSteps.length > 0) {
    lines.push("## Recent Steps", "");
    for (const step of recentSteps) {
      const note = step.note?.trim();
      lines.push(`- ${step.intent} [${step.status}]${note ? `: ${note}` : ""}`);
    }
    if (result.steps.length > recentSteps.length) {
      lines.push(`- ${result.steps.length - recentSteps.length} more step(s) in technical details.`);
    }
    lines.push("");
  }

  if (result.toolCalls.length > 0) {
    lines.push("## Tool Activity", "");
    for (const toolCall of result.toolCalls) {
      const note = typeof toolCall.note === "string" ? toolCall.note.trim() : "";
      lines.push(`- ${toolCall.toolName} [${toolCall.result}]${note ? `: ${note}` : ""}`);
    }
    lines.push("");
  }

  if (result.expectedButMissing.length > 0) {
    lines.push("", "## Expected But Missing");
    for (const item of result.expectedButMissing) {
      const label = rewriteTraceableTextPathMentions(item.label?.trim() || item.kind, result, options);
      const reason = item.reason?.trim() ? rewriteTraceableTextPathMentions(item.reason.trim(), result, options) : undefined;
      lines.push(`- ${label}${reason ? `: ${reason}` : ""}`);
    }
  }

  if (validationIssues.length > 0) {
    lines.push("", "## Validation Issues");
    for (const issue of validationIssues) {
      lines.push(`- ${issue}`);
    }
  }

  if (result.opaqueDelegations.length > 0) {
    lines.push("", "## Opaque Delegations");
    for (const delegation of result.opaqueDelegations) {
      const note = delegation.note?.trim();
      lines.push(`- ${delegation.toolName}${note ? `: ${note}` : ""}`);
    }
  }

  lines.push("", "## Technical Details", "");

  if (options?.includeSupportArtifacts !== false && result.debugLogPath?.trim()) {
    lines.push("### Support Artifacts", `- Debug Log: ${formatTraceablePathReference(result.debugLogPath, options)}`, "");
  }

  appendBoundedJsonPreview(lines, "### Request Contract Preview", mapPathLikeFields(result.request, options));
  lines.push("");
  appendBoundedJsonPreview(lines, "### Runtime Tool Ledger Preview", result.toolCalls);
  lines.push("");
  appendBoundedJsonPreview(lines, "### Usage Summary", result.usage ?? { provenance: "unavailable", note: "No token usage surfaced on this surface." });
  lines.push("");
  appendBoundedJsonPreview(lines, "### Iteration Metrics Preview", result.iterationMetrics ?? []);
  lines.push("");
  appendBoundedJsonPreview(lines, "### Child Trace Preview", {
    steps: result.steps,
    expectedButMissing: result.expectedButMissing,
    validationIssues,
    opaqueDelegations: result.opaqueDelegations,
    stopReason: result.stopReason,
    completionClaim: result.completionClaim,
    finalSummary: rewrittenFinalSummary
  });

  if (result.rawModelText?.trim()) {
    lines.push("", "### Raw Child Output", "```text", truncate(result.rawModelText.trim(), DEFAULT_OUTPUT_TEXT_CHARS), "```");
  }

  return `${lines.join("\n")}\n`;
}