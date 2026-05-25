import * as vscode from "vscode";
import type { TraceableEvidenceFileNameFormatOptions } from "./traceableLineage";

const DEFAULT_TRACEABLE_TOP_LEVEL_INDEX_DIGITS = 3;
const MAX_TRACEABLE_TOP_LEVEL_INDEX_DIGITS = 6;

function normalizeTraceableTopLevelIndexDigits(value: number | undefined): number {
  if (!Number.isInteger(value) || value === undefined) {
    return DEFAULT_TRACEABLE_TOP_LEVEL_INDEX_DIGITS;
  }
  return Math.min(Math.max(value, 1), MAX_TRACEABLE_TOP_LEVEL_INDEX_DIGITS);
}

export function getTraceableEvidenceFileNameFormatOptions(
  config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("tiinex.aiProvenance")
): TraceableEvidenceFileNameFormatOptions {
  return {
    topLevelMinDigits: normalizeTraceableTopLevelIndexDigits(config.get<number>("traceableFilenameTopLevelIndexDigits", DEFAULT_TRACEABLE_TOP_LEVEL_INDEX_DIGITS)),
    childMinDigits: normalizeTraceableTopLevelIndexDigits(config.get<number>("traceableFilenameSubIndexDigits", 1)),
    removeZeroPadding: config.get<boolean>("traceableRemoveZeroPaddingFromFilename", false) === true,
    omitRoleSlug: config.get<boolean>("traceableRemoveModelOrRoleFromFilename", false) === true
  };
}