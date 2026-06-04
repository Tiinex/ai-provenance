import path from "node:path";
import { promises as fs } from "node:fs";
import { parseTraceableEvidenceStateMarkdown } from "./traceableEvidence";
import { formatTraceableLineageIndex, parseTraceableEvidenceFileName } from "./traceableLineage";

export type ShowTracesDetailLevel = "compact" | "standard" | "full";

export interface ShowTracesInput {
  targetPath?: string;
  detailLevel?: ShowTracesDetailLevel;
  maxItems?: number;
  offset?: number;
  includeSchemas?: boolean;
}

export interface ShowTracesWorkspaceFolder {
  name: string;
  fsPath: string;
}

export type TraceableStructureDetailLevel = ShowTracesDetailLevel;
export type TraceableStructureWorkspaceFolder = ShowTracesWorkspaceFolder;

type ParsedContinuityContext = {
  currentSchemaLabel?: string;
  currentSchemaTarget?: string;
  currentSummary?: string;
  currentWhy?: string;
  parentSchemaLabel?: string;
  parentSchemaTarget?: string;
  parentTraceTarget?: string;
  currentCreatedAt?: string;
  parentCreatedAt?: string;
};

export type TraceIndexNode = {
  path: string;
  pathKey: string;
  displayPath: string;
  displaySummary?: string;
  modifiedAt?: number;
  workspaceFolderName: string;
  workspaceFolderPath: string;
  folderPath: string;
  parsedFileName: NonNullable<ReturnType<typeof parseTraceableEvidenceFileName>>;
  currentSchemaId?: string;
  currentSchemaTarget?: string;
  parentSchemaId?: string;
  parentSchemaTarget?: string;
  currentCreatedAt?: string;
  parentCreatedAt?: string;
  parentTraceTarget?: string;
  parentPathKey?: string;
  childPathKeys: string[];
  siblingPathKeys: string[];
};

export type SchemaIndexEntry = {
  path: string;
  displayPath: string;
  displayName: string;
  modifiedAt?: number;
  workspaceFolderName: string;
  workspaceFolderPath: string;
  id: string;
};

export type TraceableStructureSchemaEntry = SchemaIndexEntry;

export interface TraceableStructureTopicFolderForest {
  rootFolderPaths: string[];
  childrenByParentPath: Map<string, string[]>;
  latestModifiedAtByFolderPath: Map<string, number>;
}

export type TraceIndexScanResult = {
  nodesByPathKey: Map<string, TraceIndexNode>;
  schemaEntries: SchemaIndexEntry[];
};

export type SuspiciousGap = {
  workspaceFolderName: string;
  folderPath: string;
  parentLineageLabel?: string;
  missingLineageLabel: string;
  previousLabel?: string;
  nextLabel?: string;
};

const SKIPPED_DIRECTORY_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "out",
  "coverage"
]);

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizePathKey(filePath: string): string {
  return path.resolve(filePath).replace(/\\+/g, "/").toLowerCase();
}

function isPathWithinRoot(filePath: string, rootPath: string): boolean {
  const normalizedFile = normalizePathKey(filePath);
  const normalizedRoot = normalizePathKey(rootPath);
  return normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}/`);
}

function normalizeDetailLevel(value: ShowTracesInput["detailLevel"]): ShowTracesDetailLevel {
  return value === "compact" || value === "full" ? value : "standard";
}

function clampMaxItems(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 20;
  }
  return Math.max(1, Math.min(100, Math.floor(value ?? 20)));
}

function clampOffset(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value ?? 0));
}

function toDisplayPath(filePath: string, workspaceFolder: ShowTracesWorkspaceFolder): string {
  const relative = path.relative(workspaceFolder.fsPath, filePath).replace(/\\+/g, "/");
  return relative ? `${workspaceFolder.name}/${relative}` : workspaceFolder.name;
}

function deriveSchemaId(label: string | undefined, target: string | undefined): string | undefined {
  const trimmedLabel = trimToUndefined(label);
  if (trimmedLabel) {
    return trimmedLabel;
  }
  const trimmedTarget = trimToUndefined(target);
  if (!trimmedTarget) {
    return undefined;
  }
  return path.basename(trimmedTarget)
    .replace(/\.schema\.md$/iu, "")
    .replace(/\.md$/iu, "");
}

function humanizeSchemaId(schemaId: string): string {
  const segments = schemaId
    .replace(/^tiinex\./iu, "")
    .replace(/\.v\d+$/iu, "")
    .split(".")
    .filter(Boolean);
  return segments
    .map((segment) => segment.toLowerCase() === "ai"
      ? "AI"
      : `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`)
    .join(" ");
}

function resolveLocalReference(currentFilePath: string, referencePath: string | undefined): string | undefined {
  const trimmed = trimToUndefined(referencePath);
  if (!trimmed) {
    return undefined;
  }
  if (/^file:\/\//iu.test(trimmed)) {
    const withoutScheme = decodeURIComponent(trimmed.slice("file:///".length));
    const normalized = withoutScheme.replace(/\\+/g, "/");
    const maybeAbsolute = normalized.startsWith("/") ? normalized.slice(1) : normalized;
    return path.resolve(maybeAbsolute);
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed)) {
    return undefined;
  }
  return path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(path.dirname(currentFilePath), trimmed);
}

function extractMarkdownLinkValue(line: string, label: string): { label?: string; target?: string } | undefined {
  const match = line.match(new RegExp(`^\\s*-\\s*${label}:\\s+\\[([^\\]]+)\\]\\(([^)]+)\\)\\s*$`, "u"));
  if (!match) {
    return undefined;
  }
  return {
    label: trimToUndefined(match[1]),
    target: trimToUndefined(match[2])
  };
}

function extractScalarValue(line: string, label: string): string | undefined {
  const match = line.match(new RegExp(`^\\s*-\\s*${label}:\\s+(.+?)\\s*$`, "u"));
  return trimToUndefined(match?.[1]);
}

function parseContinuityContext(markdown: string): ParsedContinuityContext {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const result: ParsedContinuityContext = {};
  let currentSection: "parent" | "current" | undefined;
  for (const line of lines) {
    if (line.trim() === "---") {
      break;
    }
    if (line.trim() === "- Parent") {
      currentSection = "parent";
      continue;
    }
    if (line.trim() === "- Current") {
      currentSection = "current";
      continue;
    }
    if (currentSection === "parent") {
      const parentSchema = extractMarkdownLinkValue(line, "Parent Schema");
      if (parentSchema) {
        result.parentSchemaLabel = parentSchema.label;
        result.parentSchemaTarget = parentSchema.target;
        continue;
      }
      const parentTrace = extractMarkdownLinkValue(line, "Trace");
      if (parentTrace) {
        result.parentTraceTarget = parentTrace.target;
        continue;
      }
      const parentCreatedAt = extractScalarValue(line, "Created At");
      if (parentCreatedAt) {
        result.parentCreatedAt = parentCreatedAt;
        continue;
      }
    }
    if (currentSection === "current") {
      const currentSchema = extractMarkdownLinkValue(line, "Current Schema");
      if (currentSchema) {
        result.currentSchemaLabel = currentSchema.label;
        result.currentSchemaTarget = currentSchema.target;
        continue;
      }
      const currentCreatedAt = extractScalarValue(line, "Created At");
      if (currentCreatedAt) {
        result.currentCreatedAt = currentCreatedAt;
        continue;
      }
      const currentSummary = extractScalarValue(line, "Summary");
      if (currentSummary) {
        result.currentSummary = currentSummary;
        continue;
      }
      const currentWhy = extractScalarValue(line, "Why");
      if (currentWhy) {
        result.currentWhy = currentWhy;
      }
    }
  }
  return result;
}

function collapseSingleLine(value: string | undefined): string | undefined {
  const collapsed = value?.replace(/\s+/gu, " ").trim();
  if (!collapsed) {
    return undefined;
  }
  return collapsed.length > 120 ? `${collapsed.slice(0, 117).trimEnd()}...` : collapsed;
}

function extractMarkdownSectionBody(markdown: string, headingName: string): string | undefined {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  let inSection = false;
  const sectionLines: string[] = [];
  for (const line of lines) {
    const headingMatch = line.match(/^#{1,6}\s+(.+?)\s*$/u);
    if (headingMatch) {
      const normalizedHeading = headingMatch[1].trim().toLowerCase();
      if (inSection) {
        break;
      }
      if (normalizedHeading === headingName.toLowerCase()) {
        inSection = true;
      }
      continue;
    }
    if (!inSection) {
      continue;
    }
    sectionLines.push(line);
  }
  return collapseSingleLine(sectionLines.join(" "));
}

function extractTraceDisplaySummary(
  markdown: string,
  parsedState: ReturnType<typeof parseTraceableEvidenceStateMarkdown>,
  continuity?: ParsedContinuityContext
): string | undefined {
  const finalSummary = collapseSingleLine(parsedState?.result?.finalSummary);
  if (finalSummary) {
    return finalSummary;
  }
  const currentWhy = collapseSingleLine(continuity?.currentWhy);
  if (currentWhy) {
    return currentWhy;
  }
  const currentSummary = collapseSingleLine(continuity?.currentSummary);
  if (currentSummary) {
    return currentSummary;
  }
  const summarySection = extractMarkdownSectionBody(markdown, "Summary");
  if (summarySection) {
    return summarySection;
  }
  return extractMarkdownSectionBody(markdown, "Why");
}

async function collectWorkspaceTraceAndSchemaPaths(workspaceFolderPath: string): Promise<{
  tracePaths: string[];
  schemaPaths: string[];
}> {
  const tracePaths: string[] = [];
  const schemaPaths: string[] = [];
  const pendingFolders = [workspaceFolderPath];
  while (pendingFolders.length > 0) {
    const currentFolder = pendingFolders.pop();
    if (!currentFolder) {
      continue;
    }
    const entries = await fs.readdir(currentFolder, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORY_NAMES.has(entry.name)) {
          pendingFolders.push(path.join(currentFolder, entry.name));
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const entryPath = path.join(currentFolder, entry.name);
      if (entry.name.toLowerCase().endsWith(".trace.md")) {
        tracePaths.push(entryPath);
        continue;
      }
      if (path.basename(currentFolder) === ".schemas" && entry.name.toLowerCase().endsWith(".schema.md")) {
        schemaPaths.push(entryPath);
      }
    }
  }
  return { tracePaths, schemaPaths };
}

async function readTraceIndexNode(
  filePath: string,
  workspaceFolder: ShowTracesWorkspaceFolder
): Promise<TraceIndexNode | undefined> {
  const parsedFileName = parseTraceableEvidenceFileName(path.basename(filePath));
  if (!parsedFileName) {
    return undefined;
  }
  const markdown = await fs.readFile(filePath, "utf8").catch(() => undefined);
  if (typeof markdown !== "string") {
    return undefined;
  }
  const stat = await fs.stat(filePath).catch(() => undefined);
  const continuity = parseContinuityContext(markdown);
  const parsedState = parseTraceableEvidenceStateMarkdown(markdown);
  const parentReference = typeof parsedState?.result?.parentTracePath === "string"
    ? parsedState.result.parentTracePath
    : continuity.parentTraceTarget;
  const resolvedParentPath = resolveLocalReference(filePath, parentReference);
  return {
    path: filePath,
    pathKey: normalizePathKey(filePath),
    displayPath: toDisplayPath(filePath, workspaceFolder),
    displaySummary: extractTraceDisplaySummary(markdown, parsedState, continuity),
    modifiedAt: stat?.mtimeMs,
    workspaceFolderName: workspaceFolder.name,
    workspaceFolderPath: workspaceFolder.fsPath,
    folderPath: path.dirname(filePath),
    parsedFileName,
    currentSchemaId: deriveSchemaId(continuity.currentSchemaLabel, continuity.currentSchemaTarget),
    currentSchemaTarget: continuity.currentSchemaTarget,
    parentSchemaId: deriveSchemaId(continuity.parentSchemaLabel, continuity.parentSchemaTarget),
    parentSchemaTarget: continuity.parentSchemaTarget,
    currentCreatedAt: continuity.currentCreatedAt,
    parentCreatedAt: continuity.parentCreatedAt,
    parentTraceTarget: trimToUndefined(parentReference),
    parentPathKey: resolvedParentPath ? normalizePathKey(resolvedParentPath) : undefined,
    childPathKeys: [],
    siblingPathKeys: []
  };
}

export type TraceableStructureNode = TraceIndexNode;
export type TraceableStructureIndex = TraceIndexScanResult;
export type TraceableStructureGap = SuspiciousGap;

export const buildTraceableStructureIndex = buildTraceIndexScanResult;
export const collectTraceableStructureConnectedComponent = collectConnectedComponent;
export const buildTraceableStructureParentChain = buildParentChain;
export const collectTraceableStructureGaps = collectSuspiciousGaps;

export async function buildTraceIndexScanResult(workspaceFolders: readonly ShowTracesWorkspaceFolder[]): Promise<TraceIndexScanResult> {
  const nodesByPathKey = new Map<string, TraceIndexNode>();
  const schemaEntries: SchemaIndexEntry[] = [];

  for (const workspaceFolder of workspaceFolders) {
    const { tracePaths, schemaPaths } = await collectWorkspaceTraceAndSchemaPaths(workspaceFolder.fsPath);
    const nodes = await Promise.all(tracePaths.map((tracePath) => readTraceIndexNode(tracePath, workspaceFolder)));
    for (const node of nodes) {
      if (!node) {
        continue;
      }
      nodesByPathKey.set(node.pathKey, node);
    }
    for (const schemaPath of schemaPaths) {
      const schemaName = path.basename(schemaPath)
        .replace(/\.schema\.md$/iu, "")
        .replace(/\.md$/iu, "");
      const schemaStat = await fs.stat(schemaPath).catch(() => undefined);
      schemaEntries.push({
        path: schemaPath,
        displayPath: toDisplayPath(schemaPath, workspaceFolder),
        displayName: humanizeSchemaId(schemaName),
        modifiedAt: schemaStat?.mtimeMs,
        workspaceFolderName: workspaceFolder.name,
        workspaceFolderPath: workspaceFolder.fsPath,
        id: schemaName
      });
    }
  }

  const childrenByParentPathKey = new Map<string, string[]>();
  for (const node of nodesByPathKey.values()) {
    if (!node.parentPathKey || !nodesByPathKey.has(node.parentPathKey)) {
      continue;
    }
    const children = childrenByParentPathKey.get(node.parentPathKey) ?? [];
    children.push(node.pathKey);
    childrenByParentPathKey.set(node.parentPathKey, children);
  }
  for (const [parentPathKey, childPathKeys] of childrenByParentPathKey) {
    const sortedChildren = childPathKeys.sort((left, right) => {
      const leftNode = nodesByPathKey.get(left);
      const rightNode = nodesByPathKey.get(right);
      if (!leftNode || !rightNode) {
        return left.localeCompare(right);
      }
      return leftNode.parsedFileName.lineageLabel.localeCompare(rightNode.parsedFileName.lineageLabel)
        || leftNode.path.localeCompare(rightNode.path);
    });
    const parentNode = nodesByPathKey.get(parentPathKey);
    if (parentNode) {
      parentNode.childPathKeys = sortedChildren;
    }
    for (const childPathKey of sortedChildren) {
      const childNode = nodesByPathKey.get(childPathKey);
      if (!childNode) {
        continue;
      }
      childNode.siblingPathKeys = sortedChildren.filter((candidate) => candidate !== childPathKey);
    }
  }

  return { nodesByPathKey, schemaEntries };
}

export function compareTraceNodes(left: TraceIndexNode, right: TraceIndexNode): number {
  return (right.modifiedAt ?? 0) - (left.modifiedAt ?? 0)
    || left.workspaceFolderName.localeCompare(right.workspaceFolderName)
    || left.parsedFileName.lineageLabel.localeCompare(right.parsedFileName.lineageLabel)
    || left.path.localeCompare(right.path);
}

export function compareSchemaEntries(left: SchemaIndexEntry, right: SchemaIndexEntry): number {
  return (right.modifiedAt ?? 0) - (left.modifiedAt ?? 0)
    || left.workspaceFolderName.localeCompare(right.workspaceFolderName)
    || left.id.localeCompare(right.id)
    || left.path.localeCompare(right.path);
}

export const compareTraceableStructureNodes = compareTraceNodes;
export const compareTraceableStructureSchemaEntries = compareSchemaEntries;

function formatTimestamp(value?: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  const timestamp = value as number;
  const ageMs = Math.max(0, Date.now() - timestamp);
  if (ageMs < 60_000) {
    return `${Math.floor(ageMs / 1000)}s`;
  }
  if (ageMs < 3_600_000) {
    return `${Math.floor(ageMs / 60_000)}m`;
  }
  if (ageMs < 86_400_000) {
    return `${Math.floor(ageMs / 3_600_000)}h`;
  }

  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function formatCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function isTopicRootNode(node: TraceIndexNode): boolean {
  return node.parsedFileName.lineageLabel === "001";
}

function formatTopicFolderLabel(folderPath: string): string {
  const normalized = folderPath.replace(/\\+/g, "/");
  return path.basename(normalized) || path.basename(folderPath);
}

export function collectTraceableStructureTopicFolderForest(nodes: readonly TraceIndexNode[]): TraceableStructureTopicFolderForest {
  const qualifyingFolderPaths = [...new Set(nodes.filter((node) => isTopicRootNode(node)).map((node) => node.folderPath))];
  const qualifyingFolderPathSet = new Set(qualifyingFolderPaths.map(normalizePathKey));
  const parentByFolderPath = new Map<string, string | undefined>();

  for (const folderPath of qualifyingFolderPaths.sort((left, right) => left.localeCompare(right))) {
    const normalizedFolderPath = normalizePathKey(folderPath);
    let parentFolderPath: string | undefined;
    for (const candidateParentFolderPath of qualifyingFolderPaths) {
      if (normalizePathKey(candidateParentFolderPath) === normalizedFolderPath) {
        continue;
      }
      if (!isPathWithinRoot(folderPath, candidateParentFolderPath)) {
        continue;
      }
      if (!parentFolderPath || candidateParentFolderPath.length > parentFolderPath.length) {
        parentFolderPath = candidateParentFolderPath;
      }
    }
    parentByFolderPath.set(folderPath, parentFolderPath);
  }

  const childrenByParentPath = new Map<string, string[]>();
  for (const folderPath of qualifyingFolderPaths) {
    const parentFolderPath = parentByFolderPath.get(folderPath);
    const children = childrenByParentPath.get(parentFolderPath ?? "") ?? [];
    children.push(folderPath);
    childrenByParentPath.set(parentFolderPath ?? "", children);
  }

  const nodesByFolderPath = new Map<string, TraceIndexNode[]>();
  for (const node of nodes) {
    const folderNodes = nodesByFolderPath.get(node.folderPath) ?? [];
    folderNodes.push(node);
    nodesByFolderPath.set(node.folderPath, folderNodes);
  }

  const latestModifiedAtByFolderPath = new Map<string, number>();
  const computeLatestModifiedAt = (folderPath: string): number => {
    const cached = latestModifiedAtByFolderPath.get(folderPath);
    if (typeof cached === "number") {
      return cached;
    }
    const directNodes = nodesByFolderPath.get(folderPath) ?? [];
    const directLatestModifiedAt = Math.max(0, ...directNodes.map((node) => node.modifiedAt ?? 0));
    const childLatestModifiedAt = Math.max(0, ...(childrenByParentPath.get(folderPath) ?? []).map((childFolderPath) => computeLatestModifiedAt(childFolderPath)));
    const latestModifiedAt = Math.max(directLatestModifiedAt, childLatestModifiedAt);
    latestModifiedAtByFolderPath.set(folderPath, latestModifiedAt);
    return latestModifiedAt;
  };

  for (const folderPath of qualifyingFolderPaths) {
    computeLatestModifiedAt(folderPath);
  }

  const rootFolderPaths = (childrenByParentPath.get("") ?? [])
    .filter((folderPath) => qualifyingFolderPathSet.has(normalizePathKey(folderPath)))
    .sort((left, right) => (latestModifiedAtByFolderPath.get(right) ?? 0) - (latestModifiedAtByFolderPath.get(left) ?? 0) || left.localeCompare(right));

  return {
    rootFolderPaths,
    childrenByParentPath,
    latestModifiedAtByFolderPath
  };
}

function paginateEntries<T>(entries: readonly T[], offset: number, maxItems: number): {
  items: T[];
  total: number;
  offset: number;
  maxItems: number;
} {
  const safeOffset = Math.max(0, Math.min(offset, entries.length));
  return {
    items: entries.slice(safeOffset, safeOffset + maxItems),
    total: entries.length,
    offset: safeOffset,
    maxItems
  };
}

function appendPaginationFooter(lines: string[], pagination: { total: number; offset: number; items: unknown[] }): void {
  if (pagination.total <= pagination.items.length) {
    return;
  }
  const first = pagination.offset + 1;
  const last = pagination.offset + pagination.items.length;
  lines.push("", `Showing ${first}-${last} of ${pagination.total}.`);
}

export function renderTraceNodeSummary(lines: string[], node: TraceIndexNode, nodesByPathKey: Map<string, TraceIndexNode>, detailLevel: ShowTracesDetailLevel): void {
  const parentNode = node.parentPathKey ? nodesByPathKey.get(node.parentPathKey) : undefined;
  if (detailLevel === "compact") {
    const parentLabel = parentNode?.displayPath ?? node.parentTraceTarget ?? "-";
    lines.push(`- ${node.displayPath} | lineage ${node.parsedFileName.lineageLabel} | schema ${node.currentSchemaId ?? "-"} | parent ${parentLabel} | children ${node.childPathKeys.length}`);
    return;
  }
  lines.push(`- ${node.displayPath}`);
  lines.push(`  - Lineage: ${node.parsedFileName.lineageLabel}`);
  lines.push(`  - Current Schema: ${node.currentSchemaId ?? "-"}`);
  lines.push(`  - Parent: ${parentNode?.displayPath ?? node.parentTraceTarget ?? "-"}`);
  lines.push(`  - Parent Schema: ${node.parentSchemaId ?? "-"}`);
  lines.push(`  - Direct Children: ${node.childPathKeys.length}`);
  if (detailLevel === "full") {
    lines.push(`  - Siblings: ${node.siblingPathKeys.length}`);
    lines.push(`  - Current Created At: ${node.currentCreatedAt ?? "-"}`);
    lines.push(`  - Parent Created At: ${node.parentCreatedAt ?? "-"}`);
  }
}

function renderTopicFolderTraceEntry(lines: string[], node: TraceIndexNode, detailLevel: ShowTracesDetailLevel, depth: number): void {
  const indent = "  ".repeat(depth);
  const summary = trimToUndefined(node.displaySummary);
  const label = summary ? `${node.parsedFileName.lineageLabel} ${summary}` : node.parsedFileName.lineageLabel;
  const parts = [node.currentSchemaId ?? "-", formatTimestamp(node.modifiedAt)];
  lines.push(`${indent}- ${label} | ${parts.join(" | ")}`);
  if (detailLevel === "full") {
    lines.push(`${indent}  - Path: ${node.displayPath}`);
    lines.push(`${indent}  - Parent: ${node.parentTraceTarget ?? node.parentPathKey ?? "-"}`);
  }
}

function renderTopicFolderTree(lines: string[], input: {
  rootFolderPaths: readonly string[];
  forest: TraceableStructureTopicFolderForest;
  nodesByFolderPath: Map<string, TraceIndexNode[]>;
  detailLevel: ShowTracesDetailLevel;
  depth?: number;
}): void {
  const depth = input.depth ?? 0;
  for (const folderPath of input.rootFolderPaths) {
    const indent = "  ".repeat(depth);
    const directNodes = [...(input.nodesByFolderPath.get(folderPath) ?? [])].sort(compareTraceNodes);
    const childFolderPaths = [...(input.forest.childrenByParentPath.get(folderPath) ?? [])]
      .sort((left, right) => (input.forest.latestModifiedAtByFolderPath.get(right) ?? 0) - (input.forest.latestModifiedAtByFolderPath.get(left) ?? 0) || left.localeCompare(right));
    const description = [
      directNodes.length > 0 ? formatCount(directNodes.length, "trace") : undefined,
      childFolderPaths.length > 0 ? formatCount(childFolderPaths.length, "subtopic") : undefined,
      (input.forest.latestModifiedAtByFolderPath.get(folderPath) ?? 0) > 0 ? formatTimestamp(input.forest.latestModifiedAtByFolderPath.get(folderPath)) : undefined
    ].filter(Boolean).join(" | ");
    lines.push(`${indent}- ${formatTopicFolderLabel(folderPath)}${description ? ` | ${description}` : ""}`);
    for (const node of directNodes) {
      renderTopicFolderTraceEntry(lines, node, input.detailLevel, depth + 1);
    }
    renderTopicFolderTree(lines, {
      rootFolderPaths: childFolderPaths,
      forest: input.forest,
      nodesByFolderPath: input.nodesByFolderPath,
      detailLevel: input.detailLevel,
      depth: depth + 1
    });
  }
}

function renderTopicFolderTreeSection(lines: string[], input: {
  nodes: readonly TraceIndexNode[];
  detailLevel: ShowTracesDetailLevel;
  title: string;
}): void {
  const forest = collectTraceableStructureTopicFolderForest(input.nodes);
  if (forest.rootFolderPaths.length === 0) {
    return;
  }
  const nodesByFolderPath = new Map<string, TraceIndexNode[]>();
  for (const node of input.nodes) {
    const folderNodes = nodesByFolderPath.get(node.folderPath) ?? [];
    folderNodes.push(node);
    nodesByFolderPath.set(node.folderPath, folderNodes);
  }
  lines.push("", input.title);
  renderTopicFolderTree(lines, {
    rootFolderPaths: forest.rootFolderPaths,
    forest,
    nodesByFolderPath,
    detailLevel: input.detailLevel
  });
}

export function collectConnectedComponent(targetNode: TraceIndexNode, nodesByPathKey: Map<string, TraceIndexNode>): TraceIndexNode[] {
  const visited = new Set<string>();
  const pending = [targetNode.pathKey];
  while (pending.length > 0) {
    const currentPathKey = pending.pop();
    if (!currentPathKey || visited.has(currentPathKey)) {
      continue;
    }
    visited.add(currentPathKey);
    const currentNode = nodesByPathKey.get(currentPathKey);
    if (!currentNode) {
      continue;
    }
    if (currentNode.parentPathKey && nodesByPathKey.has(currentNode.parentPathKey)) {
      pending.push(currentNode.parentPathKey);
    }
    pending.push(...currentNode.childPathKeys.filter((childPathKey) => nodesByPathKey.has(childPathKey)));
  }
  return [...visited]
    .map((pathKey) => nodesByPathKey.get(pathKey))
    .flatMap((node) => node ? [node] : [])
    .sort(compareTraceNodes);
}

export function buildParentChain(targetNode: TraceIndexNode, nodesByPathKey: Map<string, TraceIndexNode>): TraceIndexNode[] {
  const chain: TraceIndexNode[] = [];
  let currentNode = targetNode.parentPathKey ? nodesByPathKey.get(targetNode.parentPathKey) : undefined;
  while (currentNode) {
    chain.push(currentNode);
    currentNode = currentNode.parentPathKey ? nodesByPathKey.get(currentNode.parentPathKey) : undefined;
  }
  return chain;
}

export function collectSuspiciousGaps(nodes: readonly TraceIndexNode[]): SuspiciousGap[] {
  const groups = new Map<string, {
    workspaceFolderName: string;
    folderPath: string;
    parentLineageLabel?: string;
    width: number;
    indexedEntries: Array<{ index: number; label: string }>;
  }>();
  for (const node of nodes) {
    const segments = node.parsedFileName.lineageLabel.split("-");
    const lastSegment = segments.at(-1);
    const numericIndex = lastSegment ? Number.parseInt(lastSegment, 10) : NaN;
    if (!Number.isInteger(numericIndex) || numericIndex <= 0) {
      continue;
    }
    const parentLineageLabel = segments.length > 1 ? segments.slice(0, -1).join("-") : undefined;
    const groupKey = `${normalizePathKey(node.folderPath)}::${parentLineageLabel ?? "root"}`;
    const group = groups.get(groupKey) ?? {
      workspaceFolderName: node.workspaceFolderName,
      folderPath: node.folderPath,
      parentLineageLabel,
      width: lastSegment?.length ?? 1,
      indexedEntries: []
    };
    group.width = Math.max(group.width, lastSegment?.length ?? 1);
    group.indexedEntries.push({
      index: numericIndex,
      label: node.parsedFileName.lineageLabel
    });
    groups.set(groupKey, group);
  }

  const gaps: SuspiciousGap[] = [];
  for (const group of groups.values()) {
    const dedupedEntries = [...new Map(group.indexedEntries.map((entry) => [entry.index, entry] as const)).values()]
      .sort((left, right) => left.index - right.index);
    for (let index = 1; index < dedupedEntries.length; index += 1) {
      const previous = dedupedEntries[index - 1];
      const next = dedupedEntries[index];
      for (let missing = previous.index + 1; missing < next.index; missing += 1) {
        const formattedIndex = formatTraceableLineageIndex(missing, group.width);
        gaps.push({
          workspaceFolderName: group.workspaceFolderName,
          folderPath: group.folderPath,
          parentLineageLabel: group.parentLineageLabel,
          missingLineageLabel: group.parentLineageLabel ? `${group.parentLineageLabel}-${formattedIndex}` : formattedIndex,
          previousLabel: previous.label,
          nextLabel: next.label
        });
      }
    }
  }
  return gaps.sort((left, right) => {
    return left.workspaceFolderName.localeCompare(right.workspaceFolderName)
      || left.folderPath.localeCompare(right.folderPath)
      || (left.parentLineageLabel ?? "").localeCompare(right.parentLineageLabel ?? "")
      || left.missingLineageLabel.localeCompare(right.missingLineageLabel);
  });
}

function renderGapSummary(lines: string[], gap: SuspiciousGap): void {
  const folderDisplay = gap.folderPath.replace(/\\+/g, "/");
  lines.push(`- ${gap.missingLineageLabel}`);
  lines.push(`  - Workspace Folder: ${gap.workspaceFolderName}`);
  lines.push(`  - Folder: ${folderDisplay}`);
  lines.push(`  - Parent Prefix: ${gap.parentLineageLabel ?? "(root)"}`);
  lines.push(`  - Between: ${gap.previousLabel ?? "-"} and ${gap.nextLabel ?? "-"}`);
}

function countRootNodes(nodesByPathKey: Map<string, TraceIndexNode>, scopedNodes: readonly TraceIndexNode[]): number {
  const scopedKeys = new Set(scopedNodes.map((node) => node.pathKey));
  return scopedNodes.filter((node) => !node.parentPathKey || !scopedKeys.has(node.parentPathKey) || !nodesByPathKey.has(node.parentPathKey)).length;
}

function countLeafNodes(scopedNodes: readonly TraceIndexNode[], scopedKeys: Set<string>): number {
  return scopedNodes.filter((node) => node.childPathKeys.filter((childPathKey) => scopedKeys.has(childPathKey)).length === 0).length;
}

export function renderWorkspaceOverview(input: {
  detailLevel: ShowTracesDetailLevel;
  maxItems: number;
  offset: number;
  includeSchemas: boolean;
  workspaceFolders: readonly ShowTracesWorkspaceFolder[];
  scanResult: TraceIndexScanResult;
}): string {
  const allNodes = [...input.scanResult.nodesByPathKey.values()].sort(compareTraceNodes);
  const allSchemas = [...input.scanResult.schemaEntries].sort(compareSchemaEntries);
  const lines = [
    "# Show Traces",
    "",
    "- Scope: workspace overview",
    `- Detail Level: ${input.detailLevel}`,
    `- Workspace Folders: ${input.workspaceFolders.length}`,
    `- Total Traces: ${allNodes.length}`,
    `- Total Schema Notes: ${allSchemas.length}`
  ];

  lines.push("", "## Workspace Folders");
  for (const workspaceFolder of input.workspaceFolders) {
    const folderNodes = allNodes.filter((node) => node.workspaceFolderPath === workspaceFolder.fsPath);
    const folderKeys = new Set(folderNodes.map((node) => node.pathKey));
    const folderSchemas = allSchemas.filter((entry) => entry.workspaceFolderPath === workspaceFolder.fsPath);
    lines.push(`- ${workspaceFolder.name}`);
    lines.push(`  - Root: ${workspaceFolder.fsPath.replace(/\\+/g, "/")}`);
    lines.push(`  - Traces: ${folderNodes.length}`);
    lines.push(`  - Root Traces: ${countRootNodes(input.scanResult.nodesByPathKey, folderNodes)}`);
    lines.push(`  - Leaf Traces: ${countLeafNodes(folderNodes, folderKeys)}`);
    lines.push(`  - Schema Notes: ${folderSchemas.length}`);
  }

  if (input.detailLevel !== "compact") {
    for (const workspaceFolder of input.workspaceFolders) {
      const folderNodes = allNodes.filter((node) => node.workspaceFolderPath === workspaceFolder.fsPath);
      renderTopicFolderTreeSection(lines, {
        nodes: folderNodes,
        detailLevel: input.detailLevel,
        title: `## Topic Folder Tree (${workspaceFolder.name})`
      });
    }
  }

  if (input.detailLevel !== "compact") {
    const rootNodes = allNodes.filter((node) => !node.parentPathKey || !input.scanResult.nodesByPathKey.has(node.parentPathKey));
    const pagination = paginateEntries(rootNodes, input.offset, input.maxItems);
    lines.push("", "## Trace Roots");
    if (pagination.items.length === 0) {
      lines.push("No trace roots found in the current workspace.");
    } else {
      for (const node of pagination.items) {
        renderTraceNodeSummary(lines, node, input.scanResult.nodesByPathKey, input.detailLevel);
      }
      appendPaginationFooter(lines, pagination);
    }
  }

  const gaps = collectSuspiciousGaps(allNodes);
  if (gaps.length > 0) {
    const pagination = paginateEntries(gaps, input.offset, input.maxItems);
    lines.push("", "## Suspicious Coordinate Gaps");
    for (const gap of pagination.items) {
      renderGapSummary(lines, gap);
    }
    appendPaginationFooter(lines, pagination);
  }

  if (input.includeSchemas && input.detailLevel === "full") {
    const pagination = paginateEntries(allSchemas, input.offset, input.maxItems);
    lines.push("", "## Schema Notes");
    if (pagination.items.length === 0) {
      lines.push("No schema notes found in the current workspace.");
    } else {
      for (const schemaEntry of pagination.items) {
        lines.push(`- ${schemaEntry.id}`);
        lines.push(`  - Path: ${schemaEntry.displayPath}`);
        lines.push(`  - Workspace Folder: ${schemaEntry.workspaceFolderName}`);
      }
      appendPaginationFooter(lines, pagination);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function renderFolderScope(input: {
  detailLevel: ShowTracesDetailLevel;
  maxItems: number;
  offset: number;
  includeSchemas: boolean;
  targetFolderPath: string;
  scanResult: TraceIndexScanResult;
}): string {
  const scopedNodes = [...input.scanResult.nodesByPathKey.values()]
    .filter((node) => isPathWithinRoot(node.path, input.targetFolderPath))
    .sort(compareTraceNodes);
  const scopedKeys = new Set(scopedNodes.map((node) => node.pathKey));
  const targetWorkspaceFolderPath = scopedNodes[0]?.workspaceFolderPath;
  const scopedSchemas = input.includeSchemas
    ? input.scanResult.schemaEntries
      .filter((entry) => entry.workspaceFolderPath === targetWorkspaceFolderPath)
      .sort(compareSchemaEntries)
    : [];
  const lines = [
    "# Show Traces",
    "",
    "- Scope: folder",
    `- Target: ${input.targetFolderPath.replace(/\\+/g, "/")}`,
    `- Detail Level: ${input.detailLevel}`,
    `- Traces In Scope: ${scopedNodes.length}`,
    `- Root Traces In Scope: ${countRootNodes(input.scanResult.nodesByPathKey, scopedNodes)}`,
    `- Leaf Traces In Scope: ${countLeafNodes(scopedNodes, scopedKeys)}`,
    `- Schema Notes In Scanned Workspace Folder: ${scopedSchemas.length}`
  ];

  if (input.detailLevel !== "compact") {
    renderTopicFolderTreeSection(lines, {
      nodes: scopedNodes,
      detailLevel: input.detailLevel,
      title: "## Topic Folder Tree"
    });
  }

  const pagination = paginateEntries(scopedNodes, input.offset, input.maxItems);
  lines.push("", input.detailLevel === "compact" ? "## Trace Summary" : "## Trace Entries");
  if (pagination.items.length === 0) {
    lines.push("No `.trace.md` artifacts found under the selected folder.");
  } else {
    for (const node of pagination.items) {
      renderTraceNodeSummary(lines, node, input.scanResult.nodesByPathKey, input.detailLevel);
    }
    appendPaginationFooter(lines, pagination);
  }

  const gaps = collectSuspiciousGaps(scopedNodes);
  if (gaps.length > 0) {
    const gapPagination = paginateEntries(gaps, input.offset, input.maxItems);
    lines.push("", "## Suspicious Coordinate Gaps");
    for (const gap of gapPagination.items) {
      renderGapSummary(lines, gap);
    }
    appendPaginationFooter(lines, gapPagination);
  }

  if (input.includeSchemas && input.detailLevel === "full") {
    const schemaPagination = paginateEntries(scopedSchemas, input.offset, input.maxItems);
    lines.push("", "## Schema Notes");
    if (schemaPagination.items.length === 0) {
      lines.push("No schema notes found for the scanned workspace folder.");
    } else {
      for (const schemaEntry of schemaPagination.items) {
        lines.push(`- ${schemaEntry.id}`);
        lines.push(`  - Path: ${schemaEntry.displayPath}`);
      }
      appendPaginationFooter(lines, schemaPagination);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function renderTraceScope(input: {
  detailLevel: ShowTracesDetailLevel;
  maxItems: number;
  offset: number;
  includeSchemas: boolean;
  targetNode: TraceIndexNode;
  scanResult: TraceIndexScanResult;
}): string {
  const connectedNodes = collectConnectedComponent(input.targetNode, input.scanResult.nodesByPathKey);
  const parentChain = buildParentChain(input.targetNode, input.scanResult.nodesByPathKey);
  const siblings = input.targetNode.siblingPathKeys
    .map((pathKey) => input.scanResult.nodesByPathKey.get(pathKey))
    .flatMap((node) => node ? [node] : [])
    .sort(compareTraceNodes);
  const directChildren = input.targetNode.childPathKeys
    .map((pathKey) => input.scanResult.nodesByPathKey.get(pathKey))
    .flatMap((node) => node ? [node] : [])
    .sort(compareTraceNodes);
  const workspaceSchemas = input.includeSchemas
    ? input.scanResult.schemaEntries
      .filter((entry) => entry.workspaceFolderPath === input.targetNode.workspaceFolderPath)
      .sort(compareSchemaEntries)
    : [];
  const lines = [
    "# Show Traces",
    "",
    "- Scope: connected lineage around one trace",
    `- Target: ${input.targetNode.displayPath}`,
    `- Detail Level: ${input.detailLevel}`,
    `- Connected Traces: ${connectedNodes.length}`,
    `- Parent Chain Depth: ${parentChain.length}`,
    `- Direct Children: ${directChildren.length}`,
    `- Siblings: ${siblings.length}`,
    `- Schema Notes In Scanned Workspace Folder: ${workspaceSchemas.length}`
  ];

  lines.push("", "## Target");
  renderTraceNodeSummary(lines, input.targetNode, input.scanResult.nodesByPathKey, input.detailLevel);

  if (input.detailLevel !== "compact") {
    if (parentChain.length > 0) {
      lines.push("", "## Parent Chain");
      for (const node of parentChain) {
        renderTraceNodeSummary(lines, node, input.scanResult.nodesByPathKey, input.detailLevel);
      }
    }
    if (siblings.length > 0) {
      const siblingPagination = paginateEntries(siblings, input.offset, input.maxItems);
      lines.push("", "## Siblings");
      for (const node of siblingPagination.items) {
        renderTraceNodeSummary(lines, node, input.scanResult.nodesByPathKey, input.detailLevel);
      }
      appendPaginationFooter(lines, siblingPagination);
    }
    if (directChildren.length > 0) {
      const childPagination = paginateEntries(directChildren, input.offset, input.maxItems);
      lines.push("", "## Direct Children");
      for (const node of childPagination.items) {
        renderTraceNodeSummary(lines, node, input.scanResult.nodesByPathKey, input.detailLevel);
      }
      appendPaginationFooter(lines, childPagination);
    }
  }

  const folderGaps = collectSuspiciousGaps(
    [...input.scanResult.nodesByPathKey.values()].filter((node) => normalizePathKey(node.folderPath) === normalizePathKey(input.targetNode.folderPath))
  );
  if (folderGaps.length > 0) {
    const gapPagination = paginateEntries(folderGaps, input.offset, input.maxItems);
    lines.push("", "## Suspicious Coordinate Gaps In Target Folder");
    for (const gap of gapPagination.items) {
      renderGapSummary(lines, gap);
    }
    appendPaginationFooter(lines, gapPagination);
  }

  if (input.detailLevel === "full") {
    const connectedPagination = paginateEntries(connectedNodes, input.offset, input.maxItems);
    lines.push("", "## Connected Component");
    for (const node of connectedPagination.items) {
      renderTraceNodeSummary(lines, node, input.scanResult.nodesByPathKey, "full");
    }
    appendPaginationFooter(lines, connectedPagination);
    if (input.includeSchemas) {
      const schemaPagination = paginateEntries(workspaceSchemas, input.offset, input.maxItems);
      lines.push("", "## Schema Notes");
      if (schemaPagination.items.length === 0) {
        lines.push("No schema notes found for the scanned workspace folder.");
      } else {
        for (const schemaEntry of schemaPagination.items) {
          lines.push(`- ${schemaEntry.id}`);
          lines.push(`  - Path: ${schemaEntry.displayPath}`);
        }
        appendPaginationFooter(lines, schemaPagination);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

export async function renderShowTracesMarkdown(input: {
  workspaceFolders: readonly ShowTracesWorkspaceFolder[];
  view: ShowTracesInput;
  resolvedTargetPath?: string;
}): Promise<string> {
  if (input.workspaceFolders.length === 0) {
    return "# Show Traces\n\nNo open workspace folders were available for trace inspection.\n";
  }

  const detailLevel = normalizeDetailLevel(input.view.detailLevel);
  const maxItems = clampMaxItems(input.view.maxItems);
  const offset = clampOffset(input.view.offset);
  const includeSchemas = input.view.includeSchemas !== false;
  const scanResult = await buildTraceIndexScanResult(input.workspaceFolders);

  if (!input.resolvedTargetPath) {
    return renderWorkspaceOverview({
      detailLevel,
      maxItems,
      offset,
      includeSchemas,
      workspaceFolders: input.workspaceFolders,
      scanResult
    });
  }

  const targetPath = path.resolve(input.resolvedTargetPath);
  if (targetPath.toLowerCase().endsWith(".trace.md")) {
    const targetNode = scanResult.nodesByPathKey.get(normalizePathKey(targetPath));
    if (!targetNode) {
      throw new Error(`showTraces could not find a readable .trace.md artifact at ${JSON.stringify(targetPath)} in the scanned workspace.`);
    }
    return renderTraceScope({
      detailLevel,
      maxItems,
      offset,
      includeSchemas,
      targetNode,
      scanResult
    });
  }

  return renderFolderScope({
    detailLevel,
    maxItems,
    offset,
    includeSchemas,
    targetFolderPath: targetPath,
    scanResult
  });
}