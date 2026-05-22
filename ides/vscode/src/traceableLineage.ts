import path from "node:path";

export interface TraceableEvidenceFileNameParts {
  lineageLabel: string;
  lineageDepth: number;
  slug: string;
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

export function formatTraceableLineageIndex(index: number): string {
  return String(index).padStart(2, "0");
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
  if (lineageSegments.length === 0 || slugParts.length === 0) {
    return undefined;
  }
  return {
    lineageLabel: lineageSegments.join("-"),
    lineageDepth: lineageSegments.length,
    slug: slugParts.join("-")
  };
}

export function buildTraceableEvidenceFileName(lineageLabel: string, roleSlug: string): string {
  return `${lineageLabel}-${roleSlug}.trace.md`;
}

export function allocateNextTraceableLineageLabel(existingFileNames: string[], parentLineageLabel?: string): string {
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
    return `${parentLineageLabel.trim()}-${formatTraceableLineageIndex(nextIndex)}`;
  }

  const topLevelIndexes = parsedEntries
    .map((entry) => Number.parseInt(entry.lineageLabel.split("-")[0], 10))
    .filter((value) => Number.isInteger(value) && value > 0);
  const nextIndex = topLevelIndexes.length > 0 ? Math.max(...topLevelIndexes) + 1 : 1;
  return formatTraceableLineageIndex(nextIndex);
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