import path from "node:path";
import { existsSync, promises as fs } from "node:fs";
import * as vscode from "vscode";
import { parseTraceableEvidenceStateMarkdown } from "./traceableEvidence";
import {
  buildTraceableMarkdownPathRenderOptions,
  formatTraceablePathReference,
  renderTraceableSubagentMarkdown,
  type TraceableSubagentRunResult
} from "./traceableContract";
import {
  allocateNextTraceableLineageLabel,
  computeStoredParentTracePath,
  parseTraceableEvidenceFileName,
  type TraceableEvidenceFileNameFormatOptions
} from "./traceableLineage";
import { renderEvidenceMarkdown } from "./traceableSubagentEvidence";
import type { TraceableSubagentEvidenceFileState, TraceableSubagentRequestSummaryItem } from "./traceableSubagent";
import { planStandaloneMoveRetainedDescendantRewrites } from "./traceableStandaloneMoveRetainedDescendants.js";

export type TraceableRenameMoveRewriteBehavior = "ask" | "always" | "never";
export type TraceableLineageMoveScope = "leaves" | "branch" | "tree" | "tree-plus-seeds";
export type TraceableNormalizedRenameMoveFileSelection = {
  plannedFiles: Array<{ oldUri: vscode.Uri; newUri: vscode.Uri }>;
  droppedFiles: Array<{ oldUri: vscode.Uri; newUri: vscode.Uri }>;
};

export type TraceablePreparedRenameMove = {
  oldUri: vscode.Uri;
  newUri: vscode.Uri;
  rewrittenMarkdown?: string;
};

export type TraceablePreparedRewriteFile = {
  fileUri: vscode.Uri;
  nextContent: string;
};

type TraceableLineageMovePlan = {
  oldPath: string;
  newPath: string;
  oldLineageLabel: string;
  newLineageLabel: string;
  adoptExistingTarget?: boolean;
};

function isTraceableEvidencePath(filePath: string | undefined): boolean {
  return Boolean(filePath?.trim().toLowerCase().endsWith(".trace.md"));
}

function normalizePathKey(filePath: string): string {
  return path.resolve(filePath).replace(/\\+/g, "/").toLowerCase();
}

function buildTraceableEvidenceFileName(lineageLabel: string, slug?: string): string {
  return slug ? `${lineageLabel}-${slug}.trace.md` : `${lineageLabel}.trace.md`;
}

function tryGetTraceableParentLineageLabel(lineageLabel: string | undefined): string | undefined {
  const trimmed = lineageLabel?.trim();
  if (!trimmed) {
    return undefined;
  }
  const segments = trimmed.split("-").filter(Boolean);
  if (segments.length <= 1) {
    return undefined;
  }
  return segments.slice(0, -1).join("-");
}

function tryExtractTraceableReferenceFileName(referencePath: string | undefined): string | undefined {
  const trimmed = referencePath?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("file:///")) {
    const withoutScheme = trimmed.slice("file:///".length);
    const normalized = withoutScheme.replace(/\\+/g, "/");
    const decoded = decodeURIComponent(normalized);
    const segments = decoded.split("/").filter(Boolean);
    return segments.at(-1);
  }
  return path.basename(trimmed);
}

async function pathExists(filePath: string | undefined): Promise<boolean> {
  if (!filePath?.trim()) {
    return false;
  }
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function pathExistsSync(filePath: string | undefined): boolean {
  if (!filePath?.trim()) {
    return false;
  }
  return existsSync(filePath);
}

function resolveTraceableReference(currentFilePath: string, referencePath: string | undefined): string | undefined {
  const trimmed = referencePath?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("file:///")) {
    const withoutScheme = decodeURIComponent(trimmed.slice("file:///".length));
    const normalized = withoutScheme.replace(/\\+/g, "/");
    const maybeAbsolute = normalized.startsWith("/")
      ? normalized.slice(1)
      : normalized;
    const candidateName = path.basename(maybeAbsolute);
    return path.resolve(path.dirname(currentFilePath), candidateName);
  }
  return path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(path.dirname(currentFilePath), trimmed);
}

function collectTraceableArtifactAnchorPaths(result: TraceableSubagentRunResult | undefined): string[] {
  const anchorGroups = [result?.evidenceBasis?.primaryAnchors, result?.evidenceBasis?.secondaryAnchors];
  const paths: string[] = [];
  for (const anchors of anchorGroups) {
    for (const anchor of anchors ?? []) {
      if (anchor.kind !== "artifact" || !anchor.path?.trim()) {
        continue;
      }
      paths.push(anchor.path.trim());
    }
  }
  return [...new Set(paths.map((candidate) => path.resolve(candidate)))];
}

function resolveTraceableParentReferenceWithArtifactFallback(
  currentFilePath: string,
  result: TraceableSubagentRunResult | undefined,
  referencePath: string | undefined
): string | undefined {
  const resolvedDirect = resolveTraceableReference(currentFilePath, referencePath);
  if (pathExistsSync(resolvedDirect)) {
    return resolvedDirect;
  }
  const anchorPaths = collectTraceableArtifactAnchorPaths(result);
  if (anchorPaths.length === 0) {
    return resolvedDirect;
  }
  const targetBaseName = path.basename(resolvedDirect ?? referencePath?.trim() ?? "").toLowerCase();
  if (targetBaseName) {
    const matchingAnchor = anchorPaths.find((candidate) => path.basename(candidate).toLowerCase() === targetBaseName);
    if (matchingAnchor) {
      return matchingAnchor;
    }
  }
  const currentParts = parseTraceableEvidenceFileName(path.basename(currentFilePath));
  const parentCandidates: Array<{
    path: string;
    parts: NonNullable<ReturnType<typeof parseTraceableEvidenceFileName>>;
  }> = anchorPaths
    .map((candidate) => ({
      path: candidate,
      parts: parseTraceableEvidenceFileName(path.basename(candidate))
    }))
    .flatMap((candidate) => candidate.parts ? [{ path: candidate.path, parts: candidate.parts }] : [])
    .filter((candidate) => currentParts ? candidate.parts.lineageDepth < currentParts.lineageDepth : true)
    .sort((left, right) => {
      if (left.parts.lineageDepth !== right.parts.lineageDepth) {
        return right.parts.lineageDepth - left.parts.lineageDepth;
      }
      return left.path.localeCompare(right.path);
    });
  if (parentCandidates.length > 0) {
    return parentCandidates[0].path;
  }
  return resolvedDirect;
}

function replaceTraceableStateJson(markdown: string, nextStateJson: string): string | undefined {
  const startMatch = /## Traceable State\s+```json\s*\r?\n/u.exec(markdown);
  if (!startMatch) {
    return undefined;
  }
  const remainder = markdown.slice(startMatch.index + startMatch[0].length);
  const closingMatch = /^```[ \t]*$/um.exec(remainder);
  if (closingMatch?.index === undefined) {
    return undefined;
  }
  const lineEnding = markdown.includes("\r\n") ? "\r\n" : "\n";
  const prefix = markdown.slice(0, startMatch.index + startMatch[0].length);
  const suffix = remainder.slice(closingMatch.index);
  return `${prefix}${nextStateJson}${lineEnding}${suffix}`;
}

function replaceTraceableSummaryTitleLine(title: string | undefined, prefix: string, replacement: string): string | undefined {
  if (!title?.trim()) {
    return title;
  }
  let replaced = false;
  const nextTitle = title
    .split(/\r?\n/u)
    .map((line) => {
      if (!line.startsWith(prefix)) {
        return line;
      }
      replaced = true;
      return `${prefix}${replacement}`;
    })
    .join("\n");
  return replaced ? nextTitle : title;
}

function removeTraceableSummaryTitleLine(title: string | undefined, prefix: string): string | undefined {
  if (!title?.trim()) {
    return title;
  }
  const remainingLines = title
    .split(/\r?\n/u)
    .filter((line) => !line.startsWith(prefix));
  return remainingLines.length > 0 ? remainingLines.join("\n") : undefined;
}

function rewriteStoredRequestSummaryForMove(
  items: readonly TraceableSubagentRequestSummaryItem[] | undefined,
  result: TraceableSubagentRunResult,
  evidenceFilePath: string
): TraceableSubagentRequestSummaryItem[] | undefined {
  if (!Array.isArray(items)) {
    return undefined;
  }
  const pathRenderOptions = buildTraceableMarkdownPathRenderOptions(evidenceFilePath);
  const request = typeof result.request === "object" && result.request
    ? result.request as Record<string, unknown>
    : {};
  const parentTracePath = typeof request.parentTracePath === "string" ? request.parentTracePath.trim() : undefined;
  const exportToFolder = typeof request.exportToFolder === "string" ? request.exportToFolder.trim() : undefined;
  const agentRole = typeof request.agentRole === "object" && request.agentRole
    ? request.agentRole as Record<string, unknown>
    : undefined;
  const agentRoleName = typeof agentRole?.name === "string" ? agentRole.name.trim() : undefined;
  const agentRoleFilePath = typeof agentRole?.filePath === "string" ? agentRole.filePath.trim() : undefined;

  return items.flatMap((item) => {
    let value = item.value;
    let title = item.title;
    if (item.label === "Parent Trace" && !parentTracePath) {
      return [];
    }
    if (item.label === "Parent Trace" && parentTracePath) {
      value = path.basename(parentTracePath);
      title = formatTraceablePathReference(parentTracePath, pathRenderOptions, parentTracePath);
    }
    if (item.label === "Output" && exportToFolder) {
      title = replaceTraceableSummaryTitleLine(
        title,
        "Export folder: ",
        formatTraceablePathReference(exportToFolder, pathRenderOptions)
      );
    }
    if (item.label === "Context In" && parentTracePath) {
      title = replaceTraceableSummaryTitleLine(
        title,
        "Continuation parent: ",
        formatTraceablePathReference(parentTracePath, pathRenderOptions, parentTracePath)
      );
    }
    if (item.label === "Context In" && !parentTracePath) {
      title = removeTraceableSummaryTitleLine(title, "Continuation parent: ");
    }
    if (item.label === "Inherited") {
      if (parentTracePath) {
        title = replaceTraceableSummaryTitleLine(
          title,
          "Inherited from parent trace: ",
          formatTraceablePathReference(parentTracePath, pathRenderOptions, parentTracePath)
        );
      } else {
        title = removeTraceableSummaryTitleLine(title, "Inherited from parent trace: ");
      }
      if (agentRoleName) {
        title = replaceTraceableSummaryTitleLine(
          title,
          "Role: ",
          formatTraceablePathReference(agentRoleFilePath, pathRenderOptions, agentRoleName)
        );
      }
    }
    return {
      ...item,
      value,
      title
    };
  });
}

function fullDocumentRange(markdown: string): vscode.Range {
  const lines = markdown.split(/\r?\n/u);
  const lastLineIndex = Math.max(0, lines.length - 1);
  const lastLineLength = lines[lastLineIndex]?.length ?? 0;
  return new vscode.Range(0, 0, lastLineIndex, lastLineLength);
}

async function listSiblingTraceableEvidencePaths(folderPath: string): Promise<string[]> {
  const entries = await fs.readdir(folderPath, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && isTraceableEvidencePath(entry.name))
    .map((entry) => path.join(folderPath, entry.name));
}

async function listTraceableEvidencePathsRecursively(folderPath: string): Promise<string[]> {
  const results: string[] = [];
  const pendingFolders = [folderPath];
  while (pendingFolders.length > 0) {
    const currentFolder = pendingFolders.pop();
    if (!currentFolder) {
      continue;
    }
    const entries = await fs.readdir(currentFolder, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const entryPath = path.join(currentFolder, entry.name);
      if (entry.isDirectory()) {
        pendingFolders.push(entryPath);
        continue;
      }
      if (entry.isFile() && isTraceableEvidencePath(entry.name)) {
        results.push(entryPath);
      }
    }
  }
  return results;
}

function resolveTraceableSearchRoots(oldPath: string, workspaceRoots: readonly string[]): string[] {
  const normalizedWorkspaceRoots = [...new Set(
    workspaceRoots
      .map((workspaceRoot) => workspaceRoot?.trim())
      .filter((workspaceRoot): workspaceRoot is string => Boolean(workspaceRoot))
      .map((workspaceRoot) => path.resolve(workspaceRoot))
  )];
  if (normalizedWorkspaceRoots.length > 0) {
    return normalizedWorkspaceRoots;
  }
  return [path.dirname(oldPath)];
}

type ConnectedTraceableLineageNode = {
  path: string;
  pathKey: string;
  parsedFileName: NonNullable<ReturnType<typeof parseTraceableEvidenceFileName>>;
  parentLineageLabel?: string;
  parentPathKey?: string;
};

type ConnectedTraceableLineageGraph = {
  seedNode: ConnectedTraceableLineageNode;
  nodesByPathKey: Map<string, ConnectedTraceableLineageNode>;
  childrenByParentPathKey: Map<string, ConnectedTraceableLineageNode[]>;
};

async function readConnectedTraceableLineageNode(filePath: string): Promise<ConnectedTraceableLineageNode | undefined> {
  const parsedFileName = parseTraceableEvidenceFileName(path.basename(filePath));
  if (!parsedFileName) {
    return undefined;
  }
  const markdown = await fs.readFile(filePath, "utf8").catch(() => undefined);
  const parsedState = typeof markdown === "string"
    ? parseTraceableEvidenceStateMarkdown(markdown)
    : undefined;
  const parentReference = typeof parsedState?.result?.parentTracePath === "string"
    ? parsedState.result.parentTracePath
    : undefined;
  const resolvedParentPath = resolveTraceableParentReferenceWithArtifactFallback(filePath, parsedState?.result, parentReference);
  const parentParsedFileName = resolvedParentPath
    ? parseTraceableEvidenceFileName(path.basename(resolvedParentPath))
    : undefined;
  return {
    path: filePath,
    pathKey: normalizePathKey(filePath),
    parsedFileName,
    parentLineageLabel: parentParsedFileName?.lineageLabel,
    parentPathKey: resolvedParentPath ? normalizePathKey(resolvedParentPath) : undefined
  };
}

function countLeadingParentSegments(relativePath: string): number {
  const segments = relativePath.replace(/\\+/g, "/").split("/").filter(Boolean);
  let count = 0;
  for (const segment of segments) {
    if (segment !== "..") {
      break;
    }
    count += 1;
  }
  return count;
}

function compareTraceableLineageNodeAffinity(
  seedNode: ConnectedTraceableLineageNode,
  left: ConnectedTraceableLineageNode,
  right: ConnectedTraceableLineageNode
): number {
  if (left.pathKey === seedNode.pathKey) {
    return -1;
  }
  if (right.pathKey === seedNode.pathKey) {
    return 1;
  }
  const seedFolderPath = path.dirname(seedNode.path);
  const leftRelative = path.relative(seedFolderPath, left.path).replace(/\\+/g, "/");
  const rightRelative = path.relative(seedFolderPath, right.path).replace(/\\+/g, "/");
  const leftLeadingParents = countLeadingParentSegments(leftRelative);
  const rightLeadingParents = countLeadingParentSegments(rightRelative);
  if (leftLeadingParents !== rightLeadingParents) {
    return leftLeadingParents - rightLeadingParents;
  }
  const leftSegments = leftRelative.split("/").filter(Boolean);
  const rightSegments = rightRelative.split("/").filter(Boolean);
  if (leftSegments.length !== rightSegments.length) {
    return leftSegments.length - rightSegments.length;
  }
  return left.pathKey.localeCompare(right.pathKey);
}

async function buildConnectedTraceableLineageGraph(oldPath: string, searchRoots: readonly string[]): Promise<ConnectedTraceableLineageGraph | undefined> {
  const candidatePaths = [...new Map(
    (await Promise.all(searchRoots.map((workspaceRoot) => listTraceableEvidencePathsRecursively(workspaceRoot))))
      .flatMap((paths) => paths)
      .map((candidatePath) => [normalizePathKey(candidatePath), candidatePath] as const)
  ).values()];
  const nodes = (await Promise.all(candidatePaths.map((candidatePath) => readConnectedTraceableLineageNode(candidatePath))))
    .flatMap((node) => node ? [node] : []);
  const nodesByPathKey = new Map(nodes.map((node) => [node.pathKey, node] as const));
  const seedNode = nodesByPathKey.get(normalizePathKey(oldPath));
  if (!seedNode) {
    return undefined;
  }

  const childrenByParentPathKey = new Map<string, ConnectedTraceableLineageNode[]>();
  for (const node of nodes) {
    if (!node.parentPathKey) {
      continue;
    }
    const children = childrenByParentPathKey.get(node.parentPathKey) ?? [];
    children.push(node);
    childrenByParentPathKey.set(node.parentPathKey, children);
  }

  const connectedNodesByPathKey = new Map<string, ConnectedTraceableLineageNode>();
  const pendingNodes = [seedNode];
  while (pendingNodes.length > 0) {
    const currentNode = pendingNodes.pop();
    if (!currentNode || connectedNodesByPathKey.has(currentNode.pathKey)) {
      continue;
    }
    connectedNodesByPathKey.set(currentNode.pathKey, currentNode);
    if (currentNode.parentPathKey) {
      const parentNode = nodesByPathKey.get(currentNode.parentPathKey);
      if (parentNode) {
        pendingNodes.push(parentNode);
      }
    }
    const children = childrenByParentPathKey.get(currentNode.pathKey) ?? [];
    pendingNodes.push(...children);
  }

  const seedDirectoryKey = normalizeDirectoryPathKey(seedNode.path);
  for (const node of nodes) {
    if (normalizeDirectoryPathKey(node.path) === seedDirectoryKey) {
      connectedNodesByPathKey.set(node.pathKey, node);
    }
  }

  const connectedChildrenByParentPathKey = new Map<string, ConnectedTraceableLineageNode[]>();
  const canonicalNodesByLineageLabel = new Map<string, ConnectedTraceableLineageNode>();
  for (const node of connectedNodesByPathKey.values()) {
    const existing = canonicalNodesByLineageLabel.get(node.parsedFileName.lineageLabel);
    if (!existing || compareTraceableLineageNodeAffinity(seedNode, node, existing) < 0) {
      canonicalNodesByLineageLabel.set(node.parsedFileName.lineageLabel, node);
    }
  }

  const canonicalNodes = [...canonicalNodesByLineageLabel.values()].map((node) => {
    const canonicalParentNode = node.parentLineageLabel
      ? canonicalNodesByLineageLabel.get(node.parentLineageLabel)
      : undefined;
    return {
      ...node,
      parentPathKey: canonicalParentNode ? canonicalParentNode.pathKey : undefined
    };
  });
  const canonicalNodesByPathKey = new Map(canonicalNodes.map((node) => [node.pathKey, node] as const));
  const canonicalSeedNode = canonicalNodesByLineageLabel.get(seedNode.parsedFileName.lineageLabel) ?? seedNode;
  for (const node of canonicalNodesByPathKey.values()) {
    if (!node.parentPathKey || !connectedNodesByPathKey.has(node.parentPathKey)) {
      continue;
    }
    const children = connectedChildrenByParentPathKey.get(node.parentPathKey) ?? [];
    children.push(node);
    connectedChildrenByParentPathKey.set(node.parentPathKey, children);
  }

  return {
    seedNode: canonicalSeedNode,
    nodesByPathKey: canonicalNodesByPathKey,
    childrenByParentPathKey: connectedChildrenByParentPathKey
  };
}

function collectTraceableSubtreePathKeys(
  graph: ConnectedTraceableLineageGraph,
  rootPathKey: string
): Set<string> {
  const includedPathKeys = new Set<string>();
  const pendingNodes = [graph.nodesByPathKey.get(rootPathKey)];
  while (pendingNodes.length > 0) {
    const currentNode = pendingNodes.pop();
    if (!currentNode || includedPathKeys.has(currentNode.pathKey)) {
      continue;
    }
    includedPathKeys.add(currentNode.pathKey);
    const children = graph.childrenByParentPathKey.get(currentNode.pathKey) ?? [];
    pendingNodes.push(...children);
  }
  return includedPathKeys;
}

function normalizeDirectoryPathKey(filePath: string): string {
  return normalizePathKey(path.dirname(filePath));
}

function collectTraceableDirectoryLocalPathKeys(graph: ConnectedTraceableLineageGraph): Set<string> {
  const seedDirectoryKey = normalizeDirectoryPathKey(graph.seedNode.path);
  const includedPathKeys = new Set<string>();
  for (const node of graph.nodesByPathKey.values()) {
    if (normalizeDirectoryPathKey(node.path) === seedDirectoryKey) {
      includedPathKeys.add(node.pathKey);
    }
  }
  return includedPathKeys;
}

function collectTraceableDescendantClosureFromSeeds(
  graph: ConnectedTraceableLineageGraph,
  seedPathKeys: ReadonlySet<string>
): Set<string> {
  const includedPathKeys = new Set<string>();
  const pendingNodes = [...seedPathKeys].map((pathKey) => graph.nodesByPathKey.get(pathKey));
  while (pendingNodes.length > 0) {
    const currentNode = pendingNodes.pop();
    if (!currentNode || includedPathKeys.has(currentNode.pathKey)) {
      continue;
    }
    includedPathKeys.add(currentNode.pathKey);
    const children = graph.childrenByParentPathKey.get(currentNode.pathKey) ?? [];
    pendingNodes.push(...children);
  }
  return includedPathKeys;
}

function buildTraceableSeedAncestorChain(graph: ConnectedTraceableLineageGraph): ConnectedTraceableLineageNode[] {
  const chain: ConnectedTraceableLineageNode[] = [];
  let currentNode: ConnectedTraceableLineageNode | undefined = graph.seedNode;
  while (currentNode) {
    chain.push(currentNode);
    currentNode = currentNode.parentPathKey ? graph.nodesByPathKey.get(currentNode.parentPathKey) : undefined;
  }
  return [...chain].reverse();
}

function resolveTraceableBranchRootNode(graph: ConnectedTraceableLineageGraph): ConnectedTraceableLineageNode {
  const ancestorChain = buildTraceableSeedAncestorChain(graph);
  for (const node of ancestorChain) {
    if (!node.parentPathKey) {
      continue;
    }
    const siblings = graph.childrenByParentPathKey.get(node.parentPathKey) ?? [];
    if (siblings.length > 1) {
      return node;
    }
  }
  return ancestorChain[0] ?? graph.seedNode;
}

function arePathKeySetsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

function buildTraceableLineageScopePathKeys(
  graph: ConnectedTraceableLineageGraph,
  scope: TraceableLineageMoveScope
): Set<string> {
  if (scope === "leaves") {
    return collectTraceableSubtreePathKeys(graph, graph.seedNode.pathKey);
  }
  if (scope === "branch") {
    const branchRootNode = resolveTraceableBranchRootNode(graph);
    return collectTraceableSubtreePathKeys(graph, branchRootNode.pathKey);
  }
  const directoryLocalPathKeys = collectTraceableDirectoryLocalPathKeys(graph);
  if (scope === "tree-plus-seeds") {
    return collectTraceableDescendantClosureFromSeeds(graph, directoryLocalPathKeys);
  }
  return directoryLocalPathKeys;
}

export async function inspectTraceableLineageMoveScopes(oldPath: string, workspaceRoots: readonly string[]): Promise<TraceableLineageMoveScope[]> {
  const searchRoots = resolveTraceableSearchRoots(oldPath, workspaceRoots);
  const graph = await buildConnectedTraceableLineageGraph(oldPath, searchRoots);
  if (!graph) {
    return [];
  }
  const leavesPathKeys = buildTraceableLineageScopePathKeys(graph, "leaves");
  const branchPathKeys = buildTraceableLineageScopePathKeys(graph, "branch");
  const treePathKeys = buildTraceableLineageScopePathKeys(graph, "tree");
  const treePlusSeedsPathKeys = buildTraceableLineageScopePathKeys(graph, "tree-plus-seeds");
  const availableScopes: TraceableLineageMoveScope[] = [];
  if (leavesPathKeys.size > 1) {
    availableScopes.push("leaves");
  }
  if (branchPathKeys.size > 1 && !arePathKeySetsEqual(branchPathKeys, leavesPathKeys)) {
    availableScopes.push("branch");
  }
  if (
    treePathKeys.size > 1
    && !arePathKeySetsEqual(treePathKeys, leavesPathKeys)
    && !arePathKeySetsEqual(treePathKeys, branchPathKeys)
  ) {
    availableScopes.push("tree");
  }
  if (
    treePlusSeedsPathKeys.size > 1
    && !arePathKeySetsEqual(treePlusSeedsPathKeys, leavesPathKeys)
    && !arePathKeySetsEqual(treePlusSeedsPathKeys, branchPathKeys)
    && !arePathKeySetsEqual(treePlusSeedsPathKeys, treePathKeys)
  ) {
    availableScopes.push("tree-plus-seeds");
  }
  return availableScopes;
}

export async function normalizeTraceableRenameMoveFileSelection(input: {
  files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[];
  workspaceRoots: readonly string[];
}): Promise<TraceableNormalizedRenameMoveFileSelection> {
  const relevantFiles = input.files.filter(({ oldUri, newUri }) => (
    oldUri.scheme === "file"
    && newUri.scheme === "file"
    && isTraceableEvidencePath(oldUri.fsPath)
    && isTraceableEvidencePath(newUri.fsPath)
  ));
  if (relevantFiles.length <= 1) {
    return {
      plannedFiles: [...relevantFiles],
      droppedFiles: []
    };
  }

  const relevantEntries = (await Promise.all(relevantFiles.map(async (file) => {
    const searchRoots = resolveTraceableSearchRoots(file.oldUri.fsPath, input.workspaceRoots);
    const graph = await buildConnectedTraceableLineageGraph(file.oldUri.fsPath, searchRoots);
    const node = graph?.nodesByPathKey.get(normalizePathKey(file.oldUri.fsPath));
    return node ? { file, node } : undefined;
  }))).flatMap((entry) => entry ? [entry] : []);

  const sortedEntries = [...relevantEntries].sort((left, right) => {
    const leftDepth = left.node.parsedFileName.lineageDepth;
    const rightDepth = right.node.parsedFileName.lineageDepth;
    if (leftDepth !== rightDepth) {
      return leftDepth - rightDepth;
    }
    return left.node.pathKey.localeCompare(right.node.pathKey);
  });

  const plannedEntries: typeof sortedEntries = [];
  const droppedEntries: typeof sortedEntries = [];
  for (const candidateEntry of sortedEntries) {
    const candidateSegments = candidateEntry.node.parsedFileName.lineageLabel.split("-");
    const coveredByAncestor = plannedEntries.some((plannedEntry) => {
      const plannedSegments = plannedEntry.node.parsedFileName.lineageLabel.split("-");
      return plannedSegments.length <= candidateSegments.length
        && plannedSegments.every((segment, index) => candidateSegments[index] === segment);
    });
    if (coveredByAncestor) {
      droppedEntries.push(candidateEntry);
      continue;
    }
    plannedEntries.push(candidateEntry);
  }

  return {
    plannedFiles: plannedEntries.map(({ file }) => file),
    droppedFiles: droppedEntries.map(({ file }) => file)
  };
}

async function buildTraceableLineageMovePlans(
  oldPath: string,
  newPath: string,
  workspaceRoots: readonly string[],
  lineageScope: TraceableLineageMoveScope = "tree"
): Promise<TraceableLineageMovePlan[] | undefined> {
  const oldParsed = parseTraceableEvidenceFileName(path.basename(oldPath));
  const newParsed = parseTraceableEvidenceFileName(path.basename(newPath));
  if (!oldParsed || !newParsed) {
    return undefined;
  }

  const searchRoots = resolveTraceableSearchRoots(oldPath, workspaceRoots);
  const graph = await buildConnectedTraceableLineageGraph(oldPath, searchRoots);
  if (!graph) {
    return undefined;
  }
  const includedPathKeys = buildTraceableLineageScopePathKeys(graph, lineageScope);
  return (await Promise.all([...graph.nodesByPathKey.values()].map(async (candidateNode) => {
      if (!includedPathKeys.has(candidateNode.pathKey)) {
        return [];
      }
      const candidatePath = candidateNode.path;
      const candidateParsed = candidateNode.parsedFileName;
      const oldSegments = oldParsed.lineageLabel.split("-");
      const newSegments = newParsed.lineageLabel.split("-");
      const candidateSegments = candidateParsed.lineageLabel.split("-");
      const isSelectedFile = candidateNode.pathKey === normalizePathKey(oldPath);
      const commonPrefixLength = isSelectedFile
        ? oldSegments.length
        : oldSegments.findIndex((segment, index) => candidateSegments[index] !== segment) === -1
          ? Math.min(oldSegments.length, candidateSegments.length)
          : oldSegments.findIndex((segment, index) => candidateSegments[index] !== segment);
      const normalizedCommonPrefixLength = commonPrefixLength >= 0 ? commonPrefixLength : 0;
      const nextLineageLabel = isSelectedFile
        ? newParsed.lineageLabel
        : [...newSegments.slice(0, normalizedCommonPrefixLength), ...candidateSegments.slice(normalizedCommonPrefixLength)].join("-");
      const nextFileName = candidatePath === oldPath
        ? path.basename(newPath)
        : buildTraceableEvidenceFileName(nextLineageLabel, candidateParsed.slug);
      const nextPath = path.join(path.dirname(newPath), nextFileName);
      return [{
        oldPath: candidatePath,
        newPath: nextPath,
        oldLineageLabel: candidateParsed.lineageLabel,
        newLineageLabel: nextLineageLabel,
        adoptExistingTarget: !isSelectedFile && await pathExists(nextPath)
      }];
    }))).flatMap((plans) => plans)
    .sort((left, right) => left.oldLineageLabel.localeCompare(right.oldLineageLabel));
}

export async function planTraceableLineageMoveRetainedDescendantRewrites(input: {
  files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[];
  workspaceRoots: readonly string[];
  lineageScope?: TraceableLineageMoveScope;
}): Promise<TraceablePreparedRewriteFile[]> {
  const relevantFiles = input.files.filter(({ oldUri, newUri }) => (
    oldUri.scheme === "file"
    && newUri.scheme === "file"
    && isTraceableEvidencePath(oldUri.fsPath)
    && isTraceableEvidencePath(newUri.fsPath)
  ));
  if (relevantFiles.length === 0) {
    return [];
  }

  const plannedMoveGroups = await Promise.all(relevantFiles.map(({ oldUri, newUri }) => (
    buildTraceableLineageMovePlans(oldUri.fsPath, newUri.fsPath, input.workspaceRoots, input.lineageScope)
  )));
  const plannedMoves = plannedMoveGroups.flatMap((plans) => plans ?? []);
  if (plannedMoves.length === 0) {
    return [];
  }

  const pathMapping = new Map(plannedMoves.map((plan) => [normalizePathKey(plan.oldPath), plan.newPath] as const));
  const rewritesByPathKey = new Map<string, TraceablePreparedRewriteFile>();

  for (const file of relevantFiles) {
    const searchRoots = resolveTraceableSearchRoots(file.oldUri.fsPath, input.workspaceRoots);
    const graph = await buildConnectedTraceableLineageGraph(file.oldUri.fsPath, searchRoots);
    if (!graph) {
      continue;
    }
    const includedPathKeys = buildTraceableLineageScopePathKeys(graph, input.lineageScope ?? "tree");
    const retainedDirectChildren = [...graph.nodesByPathKey.values()].filter((node) => (
      !includedPathKeys.has(node.pathKey)
      && Boolean(node.parentPathKey)
      && includedPathKeys.has(node.parentPathKey as string)
    ));

    for (const retainedNode of retainedDirectChildren) {
      if (rewritesByPathKey.has(retainedNode.pathKey)) {
        continue;
      }
      const markdown = await fs.readFile(retainedNode.path, "utf8").catch(() => undefined);
      if (typeof markdown !== "string") {
        continue;
      }
      const rewrittenMarkdown = rewriteParsedTraceableStateForMove({
        markdown,
        currentPath: retainedNode.path,
        nextPath: retainedNode.path,
        nextLineageLabel: retainedNode.parsedFileName.lineageLabel,
        pathMapping,
        workspaceRoots: input.workspaceRoots
      });
      if (!rewrittenMarkdown || rewrittenMarkdown === markdown) {
        continue;
      }
      rewritesByPathKey.set(retainedNode.pathKey, {
        fileUri: vscode.Uri.file(retainedNode.path),
        nextContent: rewrittenMarkdown
      });
    }
  }

  return [...rewritesByPathKey.values()];
}

async function assertNoTraceableMoveConflicts(
  plans: readonly TraceableLineageMovePlan[],
  options?: { allowExistingNewPathKeys?: ReadonlySet<string> }
): Promise<void> {
  const oldPathKeys = new Set(plans.map((plan) => normalizePathKey(plan.oldPath)));
  const newPathKeys = new Set<string>();
  const allowExistingNewPathKeys = options?.allowExistingNewPathKeys ?? new Set<string>();
  for (const plan of plans) {
    const oldPathKey = normalizePathKey(plan.oldPath);
    const newPathKey = normalizePathKey(plan.newPath);
    if (newPathKeys.has(newPathKey)) {
      throw new Error(`TRACEABLE move would collide at ${plan.newPath}.`);
    }
    newPathKeys.add(newPathKey);
    if (oldPathKey === newPathKey) {
      continue;
    }
    if (allowExistingNewPathKeys.has(newPathKey)) {
      continue;
    }
    try {
      await fs.access(plan.newPath);
      if (plan.adoptExistingTarget === true) {
        continue;
      }
      if (!oldPathKeys.has(newPathKey)) {
        throw new Error(`TRACEABLE move target already exists at ${plan.newPath}.`);
      }
    } catch (error) {
      if (error instanceof Error && /already exists/u.test(error.message)) {
        throw error;
      }
    }
  }
}

function rewriteParsedTraceableStateForMove(input: {
  markdown: string;
  currentPath: string;
  nextPath: string;
  nextLineageLabel: string;
  pathMapping: ReadonlyMap<string, string>;
  workspaceRoots: readonly string[];
  parentPathOverride?: string | null;
}): string | undefined {
  const parsed = parseTraceableEvidenceStateMarkdown(input.markdown);
  if (!parsed?.result) {
    return undefined;
  }
  const parentReference = typeof parsed.result.parentTracePath === "string" ? parsed.result.parentTracePath : undefined;
  const resolvedParentPath = resolveTraceableParentReferenceWithArtifactFallback(input.currentPath, parsed.result, parentReference);
  const remappedParentPath = input.parentPathOverride === null
    ? undefined
    : input.parentPathOverride
      ?? (resolvedParentPath
        ? input.pathMapping.get(normalizePathKey(resolvedParentPath)) ?? resolvedParentPath
        : undefined);
  const nextStoredParentTracePath = remappedParentPath
    ? computeStoredParentTracePath(remappedParentPath, input.nextPath, [...input.workspaceRoots])
    : undefined;
  const priorRequest = typeof parsed.result.request === "object" && parsed.result.request
    ? parsed.result.request as Record<string, unknown>
    : {};
  const { parentTracePath: _ignoredParentTracePath, ...remainingRequest } = priorRequest;

  const nextEvidenceFile: TraceableSubagentEvidenceFileState = {
    status: parsed.snapshot.evidenceFile?.status ?? parsed.result.evidenceFile?.status ?? "ready",
    filePath: input.nextPath,
    fileName: path.basename(input.nextPath),
    error: parsed.snapshot.evidenceFile?.error ?? parsed.result.evidenceFile?.error,
    requestedBy: parsed.snapshot.evidenceFile?.requestedBy ?? parsed.result.evidenceFile?.requestedBy,
    outputMode: parsed.snapshot.evidenceFile?.outputMode ?? parsed.result.outputMode ?? parsed.result.evidenceFile?.outputMode
  };

  const nextResult: TraceableSubagentRunResult = {
    ...parsed.result,
    lineageLabel: input.nextLineageLabel,
    lineageDepth: input.nextLineageLabel.split("-").filter(Boolean).length,
    parentTracePath: nextStoredParentTracePath,
    continuedFromParent: Boolean(nextStoredParentTracePath),
    request: {
      ...remainingRequest,
      ...(nextStoredParentTracePath ? { parentTracePath: nextStoredParentTracePath } : {})
    },
    evidenceFile: { ...nextEvidenceFile }
  };

  const outputMode = nextEvidenceFile.outputMode ?? nextResult.outputMode ?? "summary-with-evidence-path";
  const finalizedResult: TraceableSubagentRunResult = {
    ...nextResult,
    outputMode,
    evidenceFile: { ...nextEvidenceFile, outputMode }
  };
  const nextSnapshot = {
    ...parsed.snapshot,
    evidenceFile: { ...nextEvidenceFile, outputMode },
    requestSummary: rewriteStoredRequestSummaryForMove(parsed.snapshot.requestSummary, finalizedResult, input.nextPath)
      ?? parsed.snapshot.requestSummary
  };
  const finalOutputMarkdown = renderTraceableSubagentMarkdown(finalizedResult, {
    ...buildTraceableMarkdownPathRenderOptions(input.nextPath),
    includeSupportArtifacts: false
  });
  return renderEvidenceMarkdown(nextSnapshot, { ...nextEvidenceFile, outputMode }, outputMode, finalOutputMarkdown, finalizedResult);
}

export async function buildTraceableRenameMoveWorkspaceEdit(input: {
  files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[];
  workspaceRoots: readonly string[];
  allowExistingRequestedTargets?: boolean;
  hostOwnsRequestedSourceRenames?: boolean;
  onPlannedRename?: (rename: { oldUri: vscode.Uri; newUri: vscode.Uri }) => void;
  lineageScope?: TraceableLineageMoveScope;
  hostOwnedRequestedFiles?: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[];
}): Promise<vscode.WorkspaceEdit | undefined> {
  const relevantFiles = input.files.filter(({ oldUri, newUri }) => (
    oldUri.scheme === "file"
    && newUri.scheme === "file"
    && isTraceableEvidencePath(oldUri.fsPath)
    && isTraceableEvidencePath(newUri.fsPath)
  ));
  if (relevantFiles.length === 0) {
    return undefined;
  }

  const plannedMoves = (await Promise.all(relevantFiles.map(({ oldUri, newUri }) => buildTraceableLineageMovePlans(oldUri.fsPath, newUri.fsPath, input.workspaceRoots, input.lineageScope))))
    .flatMap((plans) => plans ?? []);
  if (plannedMoves.length === 0) {
    return undefined;
  }

  const hostOwnedRequestedFiles = input.hostOwnedRequestedFiles?.length
    ? input.hostOwnedRequestedFiles.filter(({ oldUri, newUri }) => (
      oldUri.scheme === "file"
      && newUri.scheme === "file"
      && isTraceableEvidencePath(oldUri.fsPath)
      && isTraceableEvidencePath(newUri.fsPath)
    ))
    : relevantFiles;
  const requestedTargetPathKeys = input.allowExistingRequestedTargets === false
    ? new Set<string>()
    : new Set(hostOwnedRequestedFiles.map(({ newUri }) => normalizePathKey(newUri.fsPath)));
  await assertNoTraceableMoveConflicts(plannedMoves, { allowExistingNewPathKeys: requestedTargetPathKeys });
  const pathMapping = new Map(plannedMoves.map((plan) => [normalizePathKey(plan.oldPath), plan.newPath]));
  const requestedPathKeys = new Set(hostOwnedRequestedFiles.map(({ oldUri }) => normalizePathKey(oldUri.fsPath)));
  const hostOwnsRequestedSourceRenames = input.hostOwnsRequestedSourceRenames === true;
  const edit = new vscode.WorkspaceEdit();
  const retainedDescendantRewrites = await planTraceableLineageMoveRetainedDescendantRewrites({
    files: relevantFiles,
    workspaceRoots: input.workspaceRoots,
    lineageScope: input.lineageScope
  });

  for (const plan of plannedMoves) {
    if (plan.adoptExistingTarget === true) {
      continue;
    }
    const markdown = await fs.readFile(plan.oldPath, "utf8").catch(() => undefined);
    if (typeof markdown === "string") {
      const rewrittenMarkdown = rewriteParsedTraceableStateForMove({
        markdown,
        currentPath: plan.oldPath,
        nextPath: plan.newPath,
        nextLineageLabel: plan.newLineageLabel,
        pathMapping,
        workspaceRoots: input.workspaceRoots
      });
      if (rewrittenMarkdown && rewrittenMarkdown !== markdown) {
        edit.replace(vscode.Uri.file(plan.oldPath), fullDocumentRange(markdown), rewrittenMarkdown);
      }
    }
    const planIsRequestedRoot = requestedPathKeys.has(normalizePathKey(plan.oldPath));
    if (
      normalizePathKey(plan.oldPath) !== normalizePathKey(plan.newPath)
      && (!planIsRequestedRoot || !hostOwnsRequestedSourceRenames)
    ) {
      const oldUri = vscode.Uri.file(plan.oldPath);
      const newUri = vscode.Uri.file(plan.newPath);
      input.onPlannedRename?.({ oldUri, newUri });
      edit.renameFile(oldUri, newUri);
    }
  }

  for (const rewrite of retainedDescendantRewrites) {
    const currentMarkdown = await fs.readFile(rewrite.fileUri.fsPath, "utf8").catch(() => undefined);
    if (typeof currentMarkdown !== "string") {
      continue;
    }
    edit.replace(rewrite.fileUri, fullDocumentRange(currentMarkdown), rewrite.nextContent);
  }

  return edit.size > 0 ? edit : undefined;
}

export async function planTraceableRenameMoveOperation(input: {
  files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[];
  workspaceRoots: readonly string[];
  allowExistingRequestedTargets?: boolean;
  lineageScope?: TraceableLineageMoveScope;
  hostOwnedRequestedFiles?: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[];
}): Promise<TraceablePreparedRenameMove[] | undefined> {
  const relevantFiles = input.files.filter(({ oldUri, newUri }) => (
    oldUri.scheme === "file"
    && newUri.scheme === "file"
    && isTraceableEvidencePath(oldUri.fsPath)
    && isTraceableEvidencePath(newUri.fsPath)
  ));
  if (relevantFiles.length === 0) {
    return undefined;
  }

  const plannedMoves = (await Promise.all(relevantFiles.map(({ oldUri, newUri }) => buildTraceableLineageMovePlans(oldUri.fsPath, newUri.fsPath, input.workspaceRoots, input.lineageScope))))
    .flatMap((plans) => plans ?? []);
  if (plannedMoves.length === 0) {
    return undefined;
  }

  const hostOwnedRequestedFiles = input.hostOwnedRequestedFiles?.length
    ? input.hostOwnedRequestedFiles.filter(({ oldUri, newUri }) => (
      oldUri.scheme === "file"
      && newUri.scheme === "file"
      && isTraceableEvidencePath(oldUri.fsPath)
      && isTraceableEvidencePath(newUri.fsPath)
    ))
    : relevantFiles;
  const requestedTargetPathKeys = input.allowExistingRequestedTargets === false
    ? new Set<string>()
    : new Set(hostOwnedRequestedFiles.map(({ newUri }) => normalizePathKey(newUri.fsPath)));
  await assertNoTraceableMoveConflicts(plannedMoves, { allowExistingNewPathKeys: requestedTargetPathKeys });
  const pathMapping = new Map(plannedMoves.map((plan) => [normalizePathKey(plan.oldPath), plan.newPath]));
  const preparedMoves: TraceablePreparedRenameMove[] = [];

  for (const plan of plannedMoves) {
    if (plan.adoptExistingTarget === true) {
      continue;
    }
    const markdown = await fs.readFile(plan.oldPath, "utf8").catch(() => undefined);
    const rewrittenMarkdown = typeof markdown === "string"
      ? rewriteParsedTraceableStateForMove({
        markdown,
        currentPath: plan.oldPath,
        nextPath: plan.newPath,
        nextLineageLabel: plan.newLineageLabel,
        pathMapping,
        workspaceRoots: input.workspaceRoots
      })
      : undefined;
    if (normalizePathKey(plan.oldPath) === normalizePathKey(plan.newPath) && (!rewrittenMarkdown || rewrittenMarkdown === markdown)) {
      continue;
    }
    preparedMoves.push({
      oldUri: vscode.Uri.file(plan.oldPath),
      newUri: vscode.Uri.file(plan.newPath),
      rewrittenMarkdown: rewrittenMarkdown && rewrittenMarkdown !== markdown ? rewrittenMarkdown : undefined
    });
  }

  return preparedMoves;
}

export async function planTraceableRewriteAfterRename(input: {
  oldPath: string;
  newPath: string;
  workspaceRoots: readonly string[];
  fileNameFormatOptions?: TraceableEvidenceFileNameFormatOptions;
}): Promise<{ finalPath: string; rewrittenMarkdown: string } | undefined> {
  if (!isTraceableEvidencePath(input.newPath)) {
    return undefined;
  }
  const markdown = await fs.readFile(input.newPath, "utf8").catch(() => undefined);
  if (typeof markdown !== "string") {
    return undefined;
  }
  const parsedState = parseTraceableEvidenceStateMarkdown(markdown);
  const parsedFileName = parseTraceableEvidenceFileName(path.basename(input.newPath));
  if (!parsedFileName || !parsedState?.result) {
    return undefined;
  }
  const parentReference = typeof parsedState.result.parentTracePath === "string"
    ? parsedState.result.parentTracePath
    : undefined;
  const referencedParentFileName = tryExtractTraceableReferenceFileName(parentReference);
  const resolvedParentPath = resolveTraceableParentReferenceWithArtifactFallback(input.oldPath, parsedState.result, parentReference);
  const parentParts = resolvedParentPath ? parseTraceableEvidenceFileName(path.basename(resolvedParentPath)) : undefined;
  const destinationFolderPath = path.dirname(input.newPath);
  const destinationParentPath = referencedParentFileName
    ? path.join(destinationFolderPath, referencedParentFileName)
    : undefined;
  const destinationParentExists = await pathExists(destinationParentPath);
  const destinationParentParts = destinationParentPath && destinationParentExists
    ? parseTraceableEvidenceFileName(path.basename(destinationParentPath))
    : undefined;
  const shouldAllocateUnderParent = Boolean(
    destinationParentPath
    && destinationParentExists
    && destinationParentParts
  );
  const siblingPaths = await listSiblingTraceableEvidencePaths(path.dirname(input.newPath));
  const siblingFileNames = siblingPaths
    .filter((candidatePath) => normalizePathKey(candidatePath) !== normalizePathKey(input.newPath))
    .map((candidatePath) => path.basename(candidatePath));
  const nextLineageLabel = allocateNextTraceableLineageLabel(
    siblingFileNames,
    shouldAllocateUnderParent ? destinationParentParts?.lineageLabel : undefined,
    input.fileNameFormatOptions
  );
  const finalPath = path.join(
    path.dirname(input.newPath),
    buildTraceableEvidenceFileName(nextLineageLabel, parsedFileName.slug)
  );
  const finalPathKey = normalizePathKey(finalPath);
  if (finalPathKey !== normalizePathKey(input.newPath)) {
    try {
      await fs.access(finalPath);
      throw new Error(`TRACEABLE rewrite target already exists at ${finalPath}.`);
    } catch (error) {
      if (error instanceof Error && /already exists/u.test(error.message)) {
        throw error;
      }
    }
  }
  const rewrittenMarkdown = rewriteParsedTraceableStateForMove({
    markdown,
    currentPath: input.oldPath,
    nextPath: finalPath,
    nextLineageLabel,
    pathMapping: new Map<string, string>(),
    workspaceRoots: input.workspaceRoots,
    parentPathOverride: shouldAllocateUnderParent ? destinationParentPath : undefined
  });
  if (!rewrittenMarkdown) {
    return undefined;
  }
  return {
    finalPath,
    rewrittenMarkdown
  };
}

export async function planTraceableRewriteRequestedRename(input: {
  sourcePath: string;
  requestedPath: string;
  workspaceRoots: readonly string[];
  fileNameFormatOptions?: TraceableEvidenceFileNameFormatOptions;
}): Promise<{ finalPath: string; rewrittenMarkdown: string } | undefined> {
  if (!isTraceableEvidencePath(input.sourcePath) || !isTraceableEvidencePath(input.requestedPath)) {
    return undefined;
  }
  const markdown = await fs.readFile(input.sourcePath, "utf8").catch(() => undefined);
  if (typeof markdown !== "string") {
    return undefined;
  }
  const parsedState = parseTraceableEvidenceStateMarkdown(markdown);
  const parsedFileName = parseTraceableEvidenceFileName(path.basename(input.requestedPath));
  if (!parsedFileName || !parsedState?.result) {
    return undefined;
  }
  const parentReference = typeof parsedState.result.parentTracePath === "string"
    ? parsedState.result.parentTracePath
    : undefined;
  const referencedParentFileName = tryExtractTraceableReferenceFileName(parentReference);
  const resolvedParentPath = resolveTraceableParentReferenceWithArtifactFallback(input.sourcePath, parsedState.result, parentReference);
  const parentParts = resolvedParentPath ? parseTraceableEvidenceFileName(path.basename(resolvedParentPath)) : undefined;
  const destinationFolderPath = path.dirname(input.requestedPath);
  const destinationParentPath = referencedParentFileName
    ? path.join(destinationFolderPath, referencedParentFileName)
    : undefined;
  const destinationParentExists = await pathExists(destinationParentPath);
  const destinationParentParts = destinationParentPath && destinationParentExists
    ? parseTraceableEvidenceFileName(path.basename(destinationParentPath))
    : undefined;
  const shouldAllocateUnderParent = Boolean(
    destinationParentPath
    && destinationParentExists
    && destinationParentParts
  );
  const siblingPaths = await listSiblingTraceableEvidencePaths(destinationFolderPath);
  const siblingFileNames = siblingPaths
    .filter((candidatePath) => normalizePathKey(candidatePath) !== normalizePathKey(input.sourcePath))
    .map((candidatePath) => path.basename(candidatePath));
  const nextLineageLabel = allocateNextTraceableLineageLabel(
    siblingFileNames,
    shouldAllocateUnderParent ? destinationParentParts?.lineageLabel : parentParts?.lineageLabel,
    input.fileNameFormatOptions
  );
  const finalPath = path.join(
    destinationFolderPath,
    buildTraceableEvidenceFileName(nextLineageLabel, parsedFileName.slug)
  );
  if (normalizePathKey(finalPath) !== normalizePathKey(input.sourcePath) && await pathExists(finalPath)) {
    throw new Error(`TRACEABLE rewrite target already exists at ${finalPath}.`);
  }
  const rewrittenMarkdown = rewriteParsedTraceableStateForMove({
    markdown,
    currentPath: input.sourcePath,
    nextPath: finalPath,
    nextLineageLabel,
    pathMapping: new Map<string, string>(),
    workspaceRoots: input.workspaceRoots,
    parentPathOverride: shouldAllocateUnderParent ? destinationParentPath : undefined
  });
  if (!rewrittenMarkdown) {
    return undefined;
  }
  return {
    finalPath,
    rewrittenMarkdown
  };
}

export async function planTraceableRewriteMove(input: {
  sourcePath: string;
  destinationFolderPath: string;
  workspaceRoots: readonly string[];
  fileNameFormatOptions?: TraceableEvidenceFileNameFormatOptions;
}): Promise<{ finalPath: string; rewrittenMarkdown: string } | undefined> {
  if (!isTraceableEvidencePath(input.sourcePath)) {
    return undefined;
  }
  const markdown = await fs.readFile(input.sourcePath, "utf8").catch(() => undefined);
  if (typeof markdown !== "string") {
    return undefined;
  }
  const parsedState = parseTraceableEvidenceStateMarkdown(markdown);
  const parsedFileName = parseTraceableEvidenceFileName(path.basename(input.sourcePath));
  if (!parsedFileName || !parsedState?.result) {
    return undefined;
  }
  const parentReference = typeof parsedState.result.parentTracePath === "string"
    ? parsedState.result.parentTracePath
    : undefined;
  const resolvedParentPath = resolveTraceableParentReferenceWithArtifactFallback(input.sourcePath, parsedState.result, parentReference);
  const referencedParentFileName = tryExtractTraceableReferenceFileName(resolvedParentPath ?? parentReference);
  const inferredParentLineageLabel = tryGetTraceableParentLineageLabel(parsedFileName.lineageLabel);
  const inferredParentFileName = inferredParentLineageLabel
    ? buildTraceableEvidenceFileName(inferredParentLineageLabel, parsedFileName.slug)
    : undefined;
  const destinationParentPath = referencedParentFileName
    ? path.join(input.destinationFolderPath, referencedParentFileName)
    : inferredParentFileName
      ? path.join(input.destinationFolderPath, inferredParentFileName)
      : undefined;
  const destinationParentExists = await pathExists(destinationParentPath);
  const destinationParentParts = destinationParentPath && destinationParentExists
    ? parseTraceableEvidenceFileName(path.basename(destinationParentPath))
    : undefined;
  const resolvedParentParts = resolvedParentPath
    ? parseTraceableEvidenceFileName(path.basename(resolvedParentPath))
    : undefined;
  const shouldAllocateUnderParent = Boolean(
    destinationParentPath
    && destinationParentExists
    && destinationParentParts
  );
  const detachedOriginalTargetPath = path.join(
    input.destinationFolderPath,
    buildTraceableEvidenceFileName(parsedFileName.lineageLabel, parsedFileName.slug)
  );
  const shouldPreserveDetachedOriginalLineage = Boolean(
    !shouldAllocateUnderParent
    && normalizePathKey(detachedOriginalTargetPath) !== normalizePathKey(input.sourcePath)
    && !await pathExists(detachedOriginalTargetPath)
  );
  const originalTargetPath = shouldAllocateUnderParent
    ? path.join(
      input.destinationFolderPath,
      buildTraceableEvidenceFileName(parsedFileName.lineageLabel, parsedFileName.slug)
    )
    : undefined;
  const shouldReclaimOriginalLineageSlot = Boolean(
    !parentReference
    && originalTargetPath
    && destinationParentParts
    && destinationParentParts.lineageLabel === (resolvedParentParts?.lineageLabel ?? inferredParentLineageLabel)
    && parsedFileName.lineageLabel.startsWith(`${destinationParentParts.lineageLabel}-`)
    && normalizePathKey(originalTargetPath) !== normalizePathKey(input.sourcePath)
    && await pathExists(originalTargetPath)
  );
  const siblingPaths = await listSiblingTraceableEvidencePaths(input.destinationFolderPath);
  const siblingFileNames = siblingPaths
    .filter((candidatePath) => normalizePathKey(candidatePath) !== normalizePathKey(input.sourcePath))
    .map((candidatePath) => path.basename(candidatePath));
  const nextLineageLabel = shouldReclaimOriginalLineageSlot
    ? parsedFileName.lineageLabel
    : shouldPreserveDetachedOriginalLineage
      ? parsedFileName.lineageLabel
    : allocateNextTraceableLineageLabel(
      siblingFileNames,
      shouldAllocateUnderParent ? destinationParentParts?.lineageLabel : (resolvedParentParts?.lineageLabel ?? inferredParentLineageLabel),
      input.fileNameFormatOptions
    );
  const finalPath = shouldReclaimOriginalLineageSlot && originalTargetPath
    ? originalTargetPath
    : shouldPreserveDetachedOriginalLineage
      ? detachedOriginalTargetPath
    : path.join(
      input.destinationFolderPath,
      buildTraceableEvidenceFileName(nextLineageLabel, parsedFileName.slug)
    );
  if (!shouldReclaimOriginalLineageSlot && normalizePathKey(finalPath) !== normalizePathKey(input.sourcePath) && await pathExists(finalPath)) {
    throw new Error(`TRACEABLE rewrite target already exists at ${finalPath}.`);
  }
  const rewrittenMarkdown = rewriteParsedTraceableStateForMove({
    markdown,
    currentPath: input.sourcePath,
    nextPath: finalPath,
    nextLineageLabel,
    pathMapping: new Map<string, string>(),
    workspaceRoots: input.workspaceRoots,
    parentPathOverride: shouldAllocateUnderParent ? destinationParentPath : undefined
  });
  if (!rewrittenMarkdown) {
    return undefined;
  }
  return {
    finalPath,
    rewrittenMarkdown
  };
}

export async function planTraceableStandaloneMoveReturnDisplacementMoves(input: {
  sourcePath: string;
  destinationPath: string;
  workspaceRoots: readonly string[];
}): Promise<TraceablePreparedRenameMove[]> {
  if (!isTraceableEvidencePath(input.sourcePath) || !isTraceableEvidencePath(input.destinationPath)) {
    return [];
  }
  if (!await pathExists(input.destinationPath)) {
    return [];
  }
  const sourceFileName = parseTraceableEvidenceFileName(path.basename(input.sourcePath));
  const destinationFileName = parseTraceableEvidenceFileName(path.basename(input.destinationPath));
  if (!sourceFileName || !destinationFileName || sourceFileName.lineageLabel !== destinationFileName.lineageLabel) {
    return [];
  }
  const searchRoots = resolveTraceableSearchRoots(input.destinationPath, input.workspaceRoots);
  const graph = await buildConnectedTraceableLineageGraph(input.destinationPath, searchRoots);
  if (!graph) {
    return [];
  }
  const destinationPathKey = normalizePathKey(input.destinationPath);
  const destinationNode = graph.nodesByPathKey.get(destinationPathKey);
  if (!destinationNode) {
    return [];
  }
  const subtreePathKeys = collectTraceableSubtreePathKeys(graph, destinationPathKey);
  const displacedRootLabel = `${destinationNode.parsedFileName.lineageLabel}-1`;
  const destinationSegments = destinationNode.parsedFileName.lineageLabel.split("-");
  const displacementPlans: TraceableLineageMovePlan[] = [];
  for (const subtreePathKey of subtreePathKeys) {
    const subtreeNode = graph.nodesByPathKey.get(subtreePathKey);
    if (!subtreeNode) {
      continue;
    }
    const subtreeSegments = subtreeNode.parsedFileName.lineageLabel.split("-");
    const nextLineageLabel = [displacedRootLabel, ...subtreeSegments.slice(destinationSegments.length)].join("-");
    displacementPlans.push({
      oldPath: subtreeNode.path,
      newPath: path.join(path.dirname(subtreeNode.path), buildTraceableEvidenceFileName(nextLineageLabel, subtreeNode.parsedFileName.slug)),
      oldLineageLabel: subtreeNode.parsedFileName.lineageLabel,
      newLineageLabel: nextLineageLabel
    });
  }
  await assertNoTraceableMoveConflicts(displacementPlans);
  const pathMapping = new Map<string, string>([
    [normalizePathKey(input.sourcePath), input.destinationPath],
    ...displacementPlans.map((plan) => [normalizePathKey(plan.oldPath), plan.newPath] as const)
  ]);
  const preparedMoves = await Promise.all(displacementPlans
    .sort((left, right) => left.oldLineageLabel.localeCompare(right.oldLineageLabel))
    .map(async (plan) => {
      const markdown = await fs.readFile(plan.oldPath, "utf8").catch(() => undefined);
      if (typeof markdown !== "string") {
        return undefined;
      }
      const rewrittenMarkdown = rewriteParsedTraceableStateForMove({
        markdown,
        currentPath: plan.oldPath,
        nextPath: plan.newPath,
        nextLineageLabel: plan.newLineageLabel,
        pathMapping,
        workspaceRoots: input.workspaceRoots,
        parentPathOverride: normalizePathKey(plan.oldPath) === destinationPathKey ? input.destinationPath : undefined
      });
      if (!rewrittenMarkdown && normalizePathKey(plan.oldPath) === normalizePathKey(plan.newPath)) {
        return undefined;
      }
      return {
        oldUri: vscode.Uri.file(plan.oldPath),
        newUri: vscode.Uri.file(plan.newPath),
        rewrittenMarkdown: rewrittenMarkdown && rewrittenMarkdown !== markdown ? rewrittenMarkdown : undefined
      };
    }));
  return preparedMoves.flatMap((move) => move ? [move] : []);
}

export async function planTraceableStandaloneMoveDependencyMoves(input: {
  sourcePath: string;
  destinationPath: string;
  workspaceRoots: readonly string[];
}): Promise<TraceablePreparedRenameMove[]> {
  if (!isTraceableEvidencePath(input.sourcePath) || !isTraceableEvidencePath(input.destinationPath)) {
    return [];
  }
  const searchRoots = resolveTraceableSearchRoots(input.sourcePath, input.workspaceRoots);
  const graph = await buildConnectedTraceableLineageGraph(input.sourcePath, searchRoots);
  if (!graph) {
    return [];
  }
  const sourcePathKey = normalizePathKey(input.sourcePath);
  const sourceNode = graph.nodesByPathKey.get(sourcePathKey);
  if (!sourceNode) {
    return [];
  }
  const sourceParentNode = sourceNode.parentPathKey
    ? graph.nodesByPathKey.get(sourceNode.parentPathKey)
    : undefined;
  const directChildren = graph.childrenByParentPathKey.get(sourcePathKey) ?? [];
  if (directChildren.length === 0) {
    return [];
  }

  const siblingLabels = sourceParentNode
    ? (graph.childrenByParentPathKey.get(sourceParentNode.pathKey) ?? [])
      .filter((node) => node.pathKey !== sourcePathKey)
      .map((node) => node.parsedFileName.lineageLabel)
    : [...graph.nodesByPathKey.values()]
      .filter((node) => !node.parentPathKey && node.pathKey !== sourcePathKey)
      .map((node) => node.parsedFileName.lineageLabel);
  const reservedLabels = new Set(siblingLabels);
  const directChildRootLabels = new Map<string, string>();
  const sortedDirectChildren = [...directChildren].sort((left, right) => left.parsedFileName.lineageLabel.localeCompare(right.parsedFileName.lineageLabel));
  for (const [index, childNode] of sortedDirectChildren.entries()) {
    let nextRootLabel: string;
    if (index === 0 && !reservedLabels.has(sourceNode.parsedFileName.lineageLabel)) {
      nextRootLabel = sourceNode.parsedFileName.lineageLabel;
    } else {
      nextRootLabel = allocateNextTraceableLineageLabel(
        [...reservedLabels].map((label) => `${label}.trace.md`),
        sourceParentNode?.parsedFileName.lineageLabel
      );
    }
    reservedLabels.add(nextRootLabel);
    directChildRootLabels.set(childNode.pathKey, nextRootLabel);
  }

  const dependentPlans: TraceableLineageMovePlan[] = [];
  for (const childNode of sortedDirectChildren) {
    const subtreePathKeys = collectTraceableSubtreePathKeys(graph, childNode.pathKey);
    const childSegments = childNode.parsedFileName.lineageLabel.split("-");
    const reassignedRootSegments = (directChildRootLabels.get(childNode.pathKey) ?? childNode.parsedFileName.lineageLabel).split("-");
    for (const subtreePathKey of subtreePathKeys) {
      const subtreeNode = graph.nodesByPathKey.get(subtreePathKey);
      if (!subtreeNode) {
        continue;
      }
      const subtreeSegments = subtreeNode.parsedFileName.lineageLabel.split("-");
      const nextLineageLabel = [...reassignedRootSegments, ...subtreeSegments.slice(childSegments.length)].join("-");
      dependentPlans.push({
        oldPath: subtreeNode.path,
        newPath: path.join(path.dirname(subtreeNode.path), buildTraceableEvidenceFileName(nextLineageLabel, subtreeNode.parsedFileName.slug)),
        oldLineageLabel: subtreeNode.parsedFileName.lineageLabel,
        newLineageLabel: nextLineageLabel
      });
    }
  }

  await assertNoTraceableMoveConflicts(dependentPlans, {
    allowExistingNewPathKeys: new Set([sourcePathKey])
  });
  const pathMapping = new Map<string, string>([
    [sourcePathKey, input.destinationPath],
    ...dependentPlans.map((plan) => [normalizePathKey(plan.oldPath), plan.newPath] as const)
  ]);
  const preparedMoves = await Promise.all(dependentPlans
    .sort((left, right) => left.oldLineageLabel.localeCompare(right.oldLineageLabel))
    .map(async (plan) => {
      const markdown = await fs.readFile(plan.oldPath, "utf8").catch(() => undefined);
      if (typeof markdown !== "string") {
        return undefined;
      }
      const directChildRoot = sortedDirectChildren.find((node) => {
        const prefix = `${node.parsedFileName.lineageLabel}-`;
        return plan.oldLineageLabel === node.parsedFileName.lineageLabel || plan.oldLineageLabel.startsWith(prefix);
      });
      const rewrittenMarkdown = rewriteParsedTraceableStateForMove({
        markdown,
        currentPath: plan.oldPath,
        nextPath: plan.newPath,
        nextLineageLabel: plan.newLineageLabel,
        pathMapping,
        workspaceRoots: input.workspaceRoots,
        parentPathOverride: directChildRoot?.path === plan.oldPath
          ? sourceParentNode?.path ?? null
          : undefined
      });
      if (!rewrittenMarkdown && normalizePathKey(plan.oldPath) === normalizePathKey(plan.newPath)) {
        return undefined;
      }
      return {
        oldUri: vscode.Uri.file(plan.oldPath),
        newUri: vscode.Uri.file(plan.newPath),
        rewrittenMarkdown: rewrittenMarkdown && rewrittenMarkdown !== markdown ? rewrittenMarkdown : undefined
      };
    }));
  return preparedMoves.flatMap((move) => move ? [move] : []);
}

export async function planTraceableStandaloneMoveDependencyRewrites(input: {
  sourcePath: string;
  destinationPath: string;
  workspaceRoots: readonly string[];
}): Promise<TraceablePreparedRewriteFile[]> {
  if (!isTraceableEvidencePath(input.sourcePath) || !isTraceableEvidencePath(input.destinationPath)) {
    return [];
  }
  const searchRoots = resolveTraceableSearchRoots(input.sourcePath, input.workspaceRoots);
  const graph = await buildConnectedTraceableLineageGraph(input.sourcePath, searchRoots);
  if (!graph) {
    return [];
  }
  const sourcePathKey = normalizePathKey(input.sourcePath);
  const directChildren = graph.childrenByParentPathKey.get(sourcePathKey) ?? [];
  if (directChildren.length === 0) {
    return [];
  }
  const pathMapping = new Map<string, string>([[sourcePathKey, input.destinationPath]]);
  const rewritePlans = planStandaloneMoveRetainedDescendantRewrites({
    destinationPath: input.destinationPath,
    directChildren: directChildren.map((child) => ({
      path: child.path,
      lineageLabel: child.parsedFileName.lineageLabel
    }))
  });
  const preparedRewrites = await Promise.all(rewritePlans.map(async (plan) => {
    const markdown = await fs.readFile(plan.oldPath, "utf8").catch(() => undefined);
    if (typeof markdown !== "string") {
      return undefined;
    }
    const rewrittenMarkdown = rewriteParsedTraceableStateForMove({
      markdown,
      currentPath: plan.oldPath,
      nextPath: plan.newPath,
      nextLineageLabel: plan.newLineageLabel,
      pathMapping,
      workspaceRoots: input.workspaceRoots,
      parentPathOverride: plan.parentPathOverride
    });
    if (!rewrittenMarkdown || rewrittenMarkdown === markdown) {
      return undefined;
    }
    return {
      fileUri: vscode.Uri.file(plan.oldPath),
      nextContent: rewrittenMarkdown
    };
  }));
  return preparedRewrites.flatMap((rewrite) => rewrite ? [rewrite] : []);
}