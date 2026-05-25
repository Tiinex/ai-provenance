import path from "node:path";

export interface TraceableEvidenceFileNameParts {
  lineageLabel: string;
  lineageDepth: number;
  slug?: string;
}

export interface TraceableEvidenceFileNameFormatOptions {
  topLevelMinDigits?: number;
  childMinDigits?: number;
  removeZeroPadding?: boolean;
  omitRoleSlug?: boolean;
}

function normalizeComparablePath(value: string): string {
  return path.resolve(value)
    .replace(/\\+/g, "/")
    .replace(/\/+$/u, "")
    .toLowerCase();
}

function isPathWithinRoot(filePath: string, rootPath: string): boolean {
  const normalizedFile = normalizeComparablePath(filePath);
  const normalizedRoot = normalizeComparablePath(rootPath);
  return normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}/`);
}

function normalizeTraceableEvidenceFileNameFormatOptions(
  options?: TraceableEvidenceFileNameFormatOptions
): Required<TraceableEvidenceFileNameFormatOptions> {
  const topLevelMinDigits = Number.isInteger(options?.topLevelMinDigits) && (options?.topLevelMinDigits ?? 0) > 0
    ? Number(options?.topLevelMinDigits)
    : 2;
  const childMinDigits = Number.isInteger(options?.childMinDigits) && (options?.childMinDigits ?? 0) > 0
    ? Number(options?.childMinDigits)
    : 2;
  return {
    topLevelMinDigits,
    childMinDigits,
    removeZeroPadding: options?.removeZeroPadding === true,
    omitRoleSlug: options?.omitRoleSlug === true
  };
}

export function formatTraceableLineageIndex(index: number, minDigits = 2): string {
  const normalized = String(index);
  return minDigits > 1 ? normalized.padStart(minDigits, "0") : normalized;
}

export function parseTraceableEvidenceFileName(fileName: string | undefined): TraceableEvidenceFileNameParts | undefined {
  const trimmed = fileName?.trim();
  if (!trimmed || !trimmed.toLowerCase().endsWith(".trace.md")) {
    return undefined;
  }
  const stem = trimmed.slice(0, -".trace.md".length);
  const parts = stem.split("-").filter((part) => part.length > 0);
  const lineageSegments: string[] = [];
  let index = 0;
  while (index < parts.length && /^\d+$/u.test(parts[index])) {
    lineageSegments.push(parts[index]);
    index += 1;
  }
  const slugParts = parts.slice(index);
  if (lineageSegments.length === 0) {
    return undefined;
  }
  return {
    lineageLabel: lineageSegments.join("-"),
    lineageDepth: lineageSegments.length,
    slug: slugParts.length > 0 ? slugParts.join("-") : undefined
  };
}

export function buildTraceableEvidenceFileName(
  lineageLabel: string,
  roleSlug: string,
  options?: TraceableEvidenceFileNameFormatOptions
): string {
  const normalizedOptions = normalizeTraceableEvidenceFileNameFormatOptions(options);
  if (normalizedOptions.omitRoleSlug || !roleSlug.trim()) {
    return `${lineageLabel}.trace.md`;
  }
  return `${lineageLabel}-${roleSlug}.trace.md`;
}

export function allocateNextTraceableLineageLabel(
  existingFileNames: string[],
  parentLineageLabel?: string,
  options?: TraceableEvidenceFileNameFormatOptions
): string {
  const normalizedOptions = normalizeTraceableEvidenceFileNameFormatOptions(options);
  const parsedEntries = existingFileNames
    .map((entry) => parseTraceableEvidenceFileName(path.basename(entry)))
    .flatMap((entry) => entry ? [entry] : []);

  if (parentLineageLabel?.trim()) {
    const parentSegments = parentLineageLabel.trim().split("-");
    const directChildIndexes = parsedEntries
      .map((entry) => entry.lineageLabel.split("-"))
      .filter((segments) => segments.length === parentSegments.length + 1 && parentSegments.every((segment, index) => segments[index] === segment))
      .map((segments) => Number.parseInt(segments[segments.length - 1], 10))
      .filter((value) => Number.isInteger(value) && value > 0);
    const nextIndex = directChildIndexes.length > 0 ? Math.max(...directChildIndexes) + 1 : 1;
    return `${parentLineageLabel.trim()}-${formatTraceableLineageIndex(nextIndex, normalizedOptions.removeZeroPadding ? 1 : normalizedOptions.childMinDigits)}`;
  }

  const topLevelIndexes = parsedEntries
    .map((entry) => Number.parseInt(entry.lineageLabel.split("-")[0], 10))
    .filter((value) => Number.isInteger(value) && value > 0);
  const nextIndex = topLevelIndexes.length > 0 ? Math.max(...topLevelIndexes) + 1 : 1;
  return formatTraceableLineageIndex(nextIndex, normalizedOptions.removeZeroPadding ? 1 : normalizedOptions.topLevelMinDigits);
}

export function computeStoredParentTracePath(parentTracePath: string, childEvidenceFilePath: string, workspaceRoots: string[]): string {
  const resolvedParent = path.resolve(parentTracePath);
  const resolvedChild = path.resolve(childEvidenceFilePath);
  const sharedRoot = workspaceRoots.find((rootPath) => isPathWithinRoot(resolvedParent, rootPath) && isPathWithinRoot(resolvedChild, rootPath));
  if (!sharedRoot) {
    return resolvedParent;
  }
  const relative = path.relative(path.dirname(resolvedChild), resolvedParent);
  return relative ? relative.replace(/\\+/g, "/") : path.basename(resolvedParent);
}