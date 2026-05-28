import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import * as vscode from "vscode";

export const TRACEABLE_LINEAGE_CHECKSUM_ENABLED_SETTING = "traceableLineageChecksumEnabled";

export type TraceableLineageIntegrityStatus =
  | "ok"
  | "legacy-no-checksum"
  | "missing-parent"
  | "unreadable-parent"
  | "checksum-mismatch"
  | "cycle-detected"
  | "disabled";

export interface TraceableDirectParentIntegrityResult {
  status: TraceableLineageIntegrityStatus;
  resolvedParentTracePath?: string;
  storedParentTraceChecksumSha256?: string;
  actualParentTraceChecksumSha256?: string;
}

export interface EvaluateTraceableDirectParentIntegrityInput {
  childFilePath?: string;
  resolvedParentTracePath?: string;
  storedParentTraceChecksumSha256?: string;
  knownAncestorTracePaths?: string[];
  checksumEnabled?: boolean;
}

function normalizePathForComparison(candidate: string | undefined): string | undefined {
  const trimmed = candidate?.trim();
  if (!trimmed) {
    return undefined;
  }
  const resolved = path.resolve(trimmed);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function canonicalizeTraceableParentChecksumSource(markdown: string): string {
  const normalizedNewlines = markdown.replace(/\r\n?/gu, "\n");
  const withoutTrailingWhitespace = normalizedNewlines.replace(/[ \t]+$/gmu, "").trimEnd();
  const lines = withoutTrailingWhitespace.split("\n");
  if (lines.length <= 1) {
    return "";
  }
  return lines.slice(0, -1).join("\n");
}

export function computeTraceableParentChecksumSha256(markdown: string): string {
  const canonical = canonicalizeTraceableParentChecksumSource(markdown);
  return createHash("sha256").update(canonical, "utf8").digest("base64url");
}

export async function computeTraceableParentChecksumSha256ForFile(filePath: string): Promise<string> {
  return computeTraceableParentChecksumSha256(await readFile(filePath, "utf8"));
}

export function computeTraceableParentChecksumSha256ForFileSync(filePath: string): string {
  return computeTraceableParentChecksumSha256(readFileSync(filePath, "utf8"));
}

export function isTraceableLineageChecksumEnabled(resource?: vscode.Uri): boolean {
  return vscode.workspace
    .getConfiguration("tiinex.aiProvenance", resource)
    .get<boolean>(TRACEABLE_LINEAGE_CHECKSUM_ENABLED_SETTING, true) === true;
}

export async function evaluateTraceableDirectParentIntegrity(
  input: EvaluateTraceableDirectParentIntegrityInput
): Promise<TraceableDirectParentIntegrityResult> {
  if (input.checksumEnabled === false) {
    return {
      status: "disabled",
      resolvedParentTracePath: input.resolvedParentTracePath,
      storedParentTraceChecksumSha256: input.storedParentTraceChecksumSha256
    };
  }
  const resolvedParentTracePath = input.resolvedParentTracePath?.trim();
  if (!resolvedParentTracePath) {
    const storedParentTraceChecksumSha256 = input.storedParentTraceChecksumSha256?.trim();
    if (!storedParentTraceChecksumSha256) {
      return {
        status: "ok"
      };
    }
    return {
      status: "missing-parent",
      storedParentTraceChecksumSha256
    };
  }

  const normalizedChildPath = normalizePathForComparison(input.childFilePath);
  const normalizedParentPath = normalizePathForComparison(resolvedParentTracePath);
  const normalizedAncestors = new Set(
    (input.knownAncestorTracePaths ?? [])
      .map((candidate) => normalizePathForComparison(candidate))
      .filter((candidate): candidate is string => Boolean(candidate))
  );
  if (
    normalizedParentPath
    && (normalizedParentPath === normalizedChildPath || normalizedAncestors.has(normalizedParentPath))
  ) {
    return {
      status: "cycle-detected",
      resolvedParentTracePath,
      storedParentTraceChecksumSha256: input.storedParentTraceChecksumSha256
    };
  }

  let parentMarkdown: string;
  try {
    parentMarkdown = await readFile(resolvedParentTracePath, "utf8");
  } catch {
    return {
      status: "unreadable-parent",
      resolvedParentTracePath,
      storedParentTraceChecksumSha256: input.storedParentTraceChecksumSha256
    };
  }

  const actualParentTraceChecksumSha256 = computeTraceableParentChecksumSha256(parentMarkdown);
  const storedParentTraceChecksumSha256 = input.storedParentTraceChecksumSha256?.trim();
  if (!storedParentTraceChecksumSha256) {
    return {
      status: "legacy-no-checksum",
      resolvedParentTracePath,
      actualParentTraceChecksumSha256
    };
  }
  if (storedParentTraceChecksumSha256 !== actualParentTraceChecksumSha256) {
    return {
      status: "checksum-mismatch",
      resolvedParentTracePath,
      storedParentTraceChecksumSha256,
      actualParentTraceChecksumSha256
    };
  }
  return {
    status: "ok",
    resolvedParentTracePath,
    storedParentTraceChecksumSha256,
    actualParentTraceChecksumSha256
  };
}

export function evaluateTraceableDirectParentIntegritySync(
  input: EvaluateTraceableDirectParentIntegrityInput
): TraceableDirectParentIntegrityResult {
  if (input.checksumEnabled === false) {
    return {
      status: "disabled",
      resolvedParentTracePath: input.resolvedParentTracePath,
      storedParentTraceChecksumSha256: input.storedParentTraceChecksumSha256
    };
  }
  const resolvedParentTracePath = input.resolvedParentTracePath?.trim();
  if (!resolvedParentTracePath) {
    const storedParentTraceChecksumSha256 = input.storedParentTraceChecksumSha256?.trim();
    if (!storedParentTraceChecksumSha256) {
      return {
        status: "ok"
      };
    }
    return {
      status: "missing-parent",
      storedParentTraceChecksumSha256
    };
  }

  const normalizedChildPath = normalizePathForComparison(input.childFilePath);
  const normalizedParentPath = normalizePathForComparison(resolvedParentTracePath);
  const normalizedAncestors = new Set(
    (input.knownAncestorTracePaths ?? [])
      .map((candidate) => normalizePathForComparison(candidate))
      .filter((candidate): candidate is string => Boolean(candidate))
  );
  if (
    normalizedParentPath
    && (normalizedParentPath === normalizedChildPath || normalizedAncestors.has(normalizedParentPath))
  ) {
    return {
      status: "cycle-detected",
      resolvedParentTracePath,
      storedParentTraceChecksumSha256: input.storedParentTraceChecksumSha256
    };
  }

  let parentMarkdown: string;
  try {
    parentMarkdown = readFileSync(resolvedParentTracePath, "utf8");
  } catch {
    return {
      status: "unreadable-parent",
      resolvedParentTracePath,
      storedParentTraceChecksumSha256: input.storedParentTraceChecksumSha256
    };
  }

  const actualParentTraceChecksumSha256 = computeTraceableParentChecksumSha256(parentMarkdown);
  const storedParentTraceChecksumSha256 = input.storedParentTraceChecksumSha256?.trim();
  if (!storedParentTraceChecksumSha256) {
    return {
      status: "legacy-no-checksum",
      resolvedParentTracePath,
      actualParentTraceChecksumSha256
    };
  }
  if (storedParentTraceChecksumSha256 !== actualParentTraceChecksumSha256) {
    return {
      status: "checksum-mismatch",
      resolvedParentTracePath,
      storedParentTraceChecksumSha256,
      actualParentTraceChecksumSha256
    };
  }
  return {
    status: "ok",
    resolvedParentTracePath,
    storedParentTraceChecksumSha256,
    actualParentTraceChecksumSha256
  };
}