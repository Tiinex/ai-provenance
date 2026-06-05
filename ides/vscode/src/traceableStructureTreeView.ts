import path from "node:path";
import { access } from "node:fs/promises";
import * as vscode from "vscode";
import {
  buildTraceableStructureIndex,
  buildTraceableStructureParentChain,
  collectTraceableStructureGaps,
  collectTraceableStructureTopicFolderForest,
  compareTraceableStructureNodes,
  compareTraceableStructureSchemaEntries,
  type TraceableStructureDetailLevel,
  type TraceableStructureGap,
  type TraceableStructureIndex,
  type TraceableStructureNode,
  type TraceableStructureSchemaEntry,
  type TraceableStructureTopicFolderForest,
  type TraceableStructureWorkspaceFolder
} from "./traceableStructure";
import {
  getUniqueWorkspaceFolderMatchByName,
  resolveDriveLessAbsolutePathOnWindows,
  resolveRelativeOpenPathInWorkspace,
  type TraceableOpenWorkspaceFolder
} from "./traceableOpenPath.js";
import { validateTraceableContinuityArtifactChainSync } from "./traceableContinuityValidation.js";

export const TRACEABLE_STRUCTURE_VIEW_ID = "tiinex.aiProvenance.traceableStructure";

export type TraceableStructureSelectionSnapshot = {
  kind: "workspace-folder" | "folder" | "trace";
  workspaceFolderPath?: string;
  folderPath?: string;
  nodePathKey?: string;
  currentSchemaId?: string;
};

let currentTraceableStructureSelection: TraceableStructureSelectionSnapshot | undefined;

export function getSelectedTraceableStructureSnapshot(): TraceableStructureSelectionSnapshot | undefined {
  return currentTraceableStructureSelection;
}

const TRACEABLE_CREATE_MENU_CONTEXT_PREFIX = "tiinex.aiProvenance.traceableStructure.createAllowed";
const TRACEABLE_CREATE_MENU_SCHEMA_CONTEXTS = [
  { schemaId: "tiinex.topic.v1", contextKey: "topic" },
  { schemaId: "tiinex.zip.v1", contextKey: "zip" },
  { schemaId: "tiinex.signal.v1", contextKey: "signal" },
  { schemaId: "tiinex.task.v1", contextKey: "task" },
  { schemaId: "tiinex.reduction.v1", contextKey: "reduction" },
  { schemaId: "tiinex.runtime.v1", contextKey: "runtime" },
  { schemaId: "tiinex.feedback.v1", contextKey: "feedback" },
  { schemaId: "tiinex.machine.runtime.v1", contextKey: "machineRuntime" },
  { schemaId: "tiinex.evidence.v1", contextKey: "evidence" },
  { schemaId: "tiinex.encrypted.v1", contextKey: "encrypted" },
  { schemaId: "tiinex.decision.v1", contextKey: "decision" },
  { schemaId: "tiinex.continuation.v1", contextKey: "continuation" },
  { schemaId: "tiinex.capability.v1", contextKey: "capability" },
  { schemaId: "tiinex.broken.v1", contextKey: "broken" },
  { schemaId: "tiinex.archive.v1", contextKey: "archive" },
  { schemaId: "tiinex.ai.runtime.v1", contextKey: "aiRuntime" },
  { schemaId: "tiinex.pointer.v1", contextKey: "pointer" }
] as const;

const TRACEABLE_CREATE_MENU_ALWAYS_ALLOWED_SCHEMA_IDS = new Set<string>([
  "tiinex.evidence.v1",
  "tiinex.feedback.v1",
  "tiinex.reduction.v1",
  "tiinex.decision.v1",
  "tiinex.continuation.v1",
  "tiinex.archive.v1",
  "tiinex.pointer.v1"
]);

const TRACEABLE_CREATE_MENU_ALLOWED_BY_PARENT_SCHEMA = new Map<string, readonly string[]>([
  ["tiinex.topic.v1", ["tiinex.signal.v1", "tiinex.task.v1", "tiinex.capability.v1"]],
  ["tiinex.zip.v1", ["tiinex.task.v1"]],
  ["tiinex.signal.v1", ["tiinex.task.v1"]],
  ["tiinex.task.v1", ["tiinex.runtime.v1", "tiinex.machine.runtime.v1", "tiinex.ai.runtime.v1", "tiinex.broken.v1"]],
  ["tiinex.reduction.v1", ["tiinex.task.v1"]],
  ["tiinex.runtime.v1", ["tiinex.runtime.v1", "tiinex.machine.runtime.v1", "tiinex.ai.runtime.v1", "tiinex.broken.v1"]],
  ["tiinex.feedback.v1", ["tiinex.task.v1"]],
  ["tiinex.machine.runtime.v1", ["tiinex.runtime.v1", "tiinex.machine.runtime.v1", "tiinex.ai.runtime.v1", "tiinex.broken.v1"]],
  ["tiinex.evidence.v1", []],
  ["tiinex.encrypted.v1", ["tiinex.evidence.v1"]],
  ["tiinex.decision.v1", ["tiinex.task.v1"]],
  ["tiinex.continuation.v1", ["tiinex.task.v1", "tiinex.runtime.v1", "tiinex.machine.runtime.v1", "tiinex.ai.runtime.v1"]],
  ["tiinex.capability.v1", ["tiinex.task.v1", "tiinex.runtime.v1", "tiinex.machine.runtime.v1", "tiinex.ai.runtime.v1"]],
  ["tiinex.broken.v1", ["tiinex.task.v1", "tiinex.runtime.v1"]],
  ["tiinex.archive.v1", ["tiinex.decision.v1"]],
  ["tiinex.ai.runtime.v1", ["tiinex.runtime.v1", "tiinex.machine.runtime.v1", "tiinex.ai.runtime.v1", "tiinex.broken.v1"]],
  ["tiinex.pointer.v1", ["tiinex.task.v1", "tiinex.evidence.v1"]]
]);

function getTraceableCreateMenuAllowedSchemaIds(selectedSchemaId?: string): Set<string> {
  if (!selectedSchemaId) {
    return new Set(TRACEABLE_CREATE_MENU_SCHEMA_CONTEXTS.map((entry) => entry.schemaId));
  }
  return new Set([
    ...TRACEABLE_CREATE_MENU_ALWAYS_ALLOWED_SCHEMA_IDS,
    ...(TRACEABLE_CREATE_MENU_ALLOWED_BY_PARENT_SCHEMA.get(selectedSchemaId) ?? [])
  ]);
}

async function syncTraceableCreateMenuContexts(selectedSchemaId?: string): Promise<void> {
  const allowedSchemaIds = getTraceableCreateMenuAllowedSchemaIds(selectedSchemaId);
  await Promise.all(TRACEABLE_CREATE_MENU_SCHEMA_CONTEXTS.map(({ schemaId, contextKey }) => {
    return vscode.commands.executeCommand("setContext", `${TRACEABLE_CREATE_MENU_CONTEXT_PREFIX}.${contextKey}`, allowedSchemaIds.has(schemaId));
  }));
}

const STATE_KEY = "traceableStructureViewState";
const TRACEABLE_STRUCTURE_REFRESH_COMMAND = "tiinex.aiProvenance.traceableStructure.refresh";
const TRACEABLE_STRUCTURE_CONFIGURE_COMMAND = "tiinex.aiProvenance.traceableStructure.configure";
const TRACEABLE_STRUCTURE_OPEN_MARKDOWN_COMMAND = "tiinex.aiProvenance.traceableStructure.openMarkdownView";
const TRACEABLE_STRUCTURE_TOGGLE_TREE_VIEW_COMMAND = "tiinex.aiProvenance.traceableStructure.toggleTreeView";
const TRACEABLE_STRUCTURE_SET_TREE_VIEW_COMMAND = "tiinex.aiProvenance.traceableStructure.setTreeView";
const TRACEABLE_STRUCTURE_SET_LIST_VIEW_COMMAND = "tiinex.aiProvenance.traceableStructure.setListView";
const TRACEABLE_STRUCTURE_TOGGLE_LEAVES_ONLY_COMMAND = "tiinex.aiProvenance.traceableStructure.toggleLeavesOnly";
const TRACEABLE_STRUCTURE_SHOW_ALL_TOPICS_COMMAND = "tiinex.aiProvenance.traceableStructure.showAllTopics";
const TRACEABLE_STRUCTURE_SHOW_LEAF_TOPICS_COMMAND = "tiinex.aiProvenance.traceableStructure.showLeafTopics";
const TRACEABLE_STRUCTURE_TOGGLE_INCLUDE_SCHEMAS_COMMAND = "tiinex.aiProvenance.traceableStructure.toggleIncludeSchemas";
const TRACEABLE_STRUCTURE_SHOW_SCHEMA_NOTES_COMMAND = "tiinex.aiProvenance.traceableStructure.showSchemaNotes";
const TRACEABLE_STRUCTURE_HIDE_SCHEMA_NOTES_COMMAND = "tiinex.aiProvenance.traceableStructure.hideSchemaNotes";
const TRACEABLE_STRUCTURE_SET_DETAIL_LEVEL_COMMAND = "tiinex.aiProvenance.traceableStructure.setDetailLevel";
const TRACEABLE_STRUCTURE_SET_DETAIL_COMPACT_COMMAND = "tiinex.aiProvenance.traceableStructure.setDetailCompact";
const TRACEABLE_STRUCTURE_SET_DETAIL_STANDARD_COMMAND = "tiinex.aiProvenance.traceableStructure.setDetailStandard";
const TRACEABLE_STRUCTURE_SET_DETAIL_FULL_COMMAND = "tiinex.aiProvenance.traceableStructure.setDetailFull";
const TRACEABLE_STRUCTURE_SET_TARGET_PATH_COMMAND = "tiinex.aiProvenance.traceableStructure.setTargetPath";
const TRACEABLE_STRUCTURE_CLEAR_TARGET_PATH_COMMAND = "tiinex.aiProvenance.traceableStructure.clearTargetPath";
const TRACEABLE_STRUCTURE_SET_SCHEMA_FILTER_COMMAND = "tiinex.aiProvenance.traceableStructure.setSchemaFilter";
const TRACEABLE_STRUCTURE_CLEAR_SCHEMA_FILTER_COMMAND = "tiinex.aiProvenance.traceableStructure.clearSchemaFilter";
const TRACEABLE_STRUCTURE_SET_MAX_ITEMS_COMMAND = "tiinex.aiProvenance.traceableStructure.setMaxItems";
const TRACEABLE_STRUCTURE_SET_OFFSET_COMMAND = "tiinex.aiProvenance.traceableStructure.setOffset";
const TRACEABLE_STRUCTURE_SET_SORT_MODE_COMMAND = "tiinex.aiProvenance.traceableStructure.setSortMode";

type TraceableStructureViewMode = "tree" | "list";
type TraceableStructureSortMode = "modified-desc" | "modified-asc" | "created-desc" | "created-asc";
type TraceableStructureTimeFilterBasis = "none" | "created" | "modified";
type TraceableStructureTimeFilterPreset = "1h" | "2h" | "6h" | "24h" | "today";

const TRACEABLE_STRUCTURE_SORT_COMMANDS = [
  { command: "tiinex.aiProvenance.traceableStructure.sortModifiedNewest", sortMode: "modified-desc", title: "Newest Modified" },
  { command: "tiinex.aiProvenance.traceableStructure.sortModifiedOldest", sortMode: "modified-asc", title: "Oldest Modified" },
  { command: "tiinex.aiProvenance.traceableStructure.sortCreatedNewest", sortMode: "created-desc", title: "Newest Created" },
  { command: "tiinex.aiProvenance.traceableStructure.sortCreatedOldest", sortMode: "created-asc", title: "Oldest Created" }
] as const;

const TRACEABLE_STRUCTURE_TIME_FILTER_COMMANDS = [
  { command: "tiinex.aiProvenance.traceableStructure.filterCreated1h", basis: "created", preset: "1h", title: "1h" },
  { command: "tiinex.aiProvenance.traceableStructure.filterCreated2h", basis: "created", preset: "2h", title: "2h" },
  { command: "tiinex.aiProvenance.traceableStructure.filterCreated6h", basis: "created", preset: "6h", title: "6h" },
  { command: "tiinex.aiProvenance.traceableStructure.filterCreated24h", basis: "created", preset: "24h", title: "24h" },
  { command: "tiinex.aiProvenance.traceableStructure.filterCreatedToday", basis: "created", preset: "today", title: "Today" },
  { command: "tiinex.aiProvenance.traceableStructure.filterCreatedReset", basis: "none", title: "Reset" },
  { command: "tiinex.aiProvenance.traceableStructure.filterModified1h", basis: "modified", preset: "1h", title: "1h" },
  { command: "tiinex.aiProvenance.traceableStructure.filterModified2h", basis: "modified", preset: "2h", title: "2h" },
  { command: "tiinex.aiProvenance.traceableStructure.filterModified6h", basis: "modified", preset: "6h", title: "6h" },
  { command: "tiinex.aiProvenance.traceableStructure.filterModified24h", basis: "modified", preset: "24h", title: "24h" },
  { command: "tiinex.aiProvenance.traceableStructure.filterModifiedToday", basis: "modified", preset: "today", title: "Today" },
  { command: "tiinex.aiProvenance.traceableStructure.filterModifiedReset", basis: "none", title: "Reset" }
] as const;

interface TraceableStructureViewState {
  viewMode: TraceableStructureViewMode;
  detailLevel: TraceableStructureDetailLevel;
  sortMode: TraceableStructureSortMode;
  leavesOnly: boolean;
  includeSchemas: boolean;
  schemaFilterText: string;
  timeFilterBasis: TraceableStructureTimeFilterBasis;
  timeFilterPreset?: TraceableStructureTimeFilterPreset;
  maxItems: number;
  offset: number;
  targetPath?: string;
}

type TraceableStructureScope =
  | { kind: "workspace" }
  | { kind: "folder"; workspaceFolder: TraceableStructureWorkspaceFolder; folderPath: string }
  | { kind: "trace"; workspaceFolder: TraceableStructureWorkspaceFolder; targetNode: TraceableStructureNode }
  | { kind: "missing"; targetPath: string; reason: string };

type TraceableStructureTreeItemKind =
  | "section"
  | "group"
  | "structure-root"
  | "workspace-folder"
  | "folder"
  | "trace"
  | "schema"
  | "gap"
  | "info"
  | "action"
  | "checksum";

interface TraceableStructureTreeItemData {
  kind: TraceableStructureTreeItemKind;
  children?: TraceableStructureTreeItem[];
  modifiedAt?: number;
  workspaceFolderPath?: string;
  folderPath?: string;
  nodePathKey?: string;
  targetPath?: string;
  currentSchemaId?: string;
}

interface WorkspaceFolderSummary {
  workspaceFolder: TraceableStructureWorkspaceFolder;
  folderCount: number;
  traceCount: number;
  schemaCount: number;
  gapCount: number;
  latestModifiedAt: number;
  sortTimestamp: number;
}

interface TraceNodeContinuitySummary {
  severity: "ok" | "info" | "warning" | "error";
  directStatus: string;
  chainStatus: string;
  chainNodeCount: number;
  stoppedBecause: string;
  tooltip: string;
}

const DEFAULT_STATE: TraceableStructureViewState = {
  viewMode: "tree",
  detailLevel: "standard",
  sortMode: "modified-desc",
  leavesOnly: false,
  includeSchemas: false,
  schemaFilterText: "",
  timeFilterBasis: "none",
  maxItems: 20,
  offset: 0
};

class TraceableStructureTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    readonly data: TraceableStructureTreeItemData,
    description?: string,
    tooltip?: string,
    command?: vscode.Command
  ) {
    super(label, collapsibleState);
    this.description = description;
    this.tooltip = tooltip;
    this.command = command;
    this.contextValue = data.kind;
    this.iconPath = getIconForKind(data.kind);
  }
}

function getIconForKind(kind: TraceableStructureTreeItemKind): vscode.ThemeIcon {
  switch (kind) {
    case "section":
    case "group":
    case "structure-root":
      return new vscode.ThemeIcon("symbol-namespace");
    case "workspace-folder":
      return new vscode.ThemeIcon("root-folder");
    case "folder":
      return new vscode.ThemeIcon("folder");
    case "trace":
      return new vscode.ThemeIcon("symbol-file");
    case "schema":
      return new vscode.ThemeIcon("symbol-interface");
    case "gap":
      return new vscode.ThemeIcon("warning");
    case "checksum":
      return new vscode.ThemeIcon("check");
    case "action":
      return new vscode.ThemeIcon("gear");
    case "info":
    default:
      return new vscode.ThemeIcon("info");
  }
}

function getTraceSchemaIcon(schemaId: string | undefined): vscode.ThemeIcon {
  const normalized = (schemaId ?? "").toLowerCase();
  if (normalized.includes("topic")) {
    return new vscode.ThemeIcon("book");
  }
  if (normalized.includes("evidence")) {
    return new vscode.ThemeIcon("note");
  }
  if (normalized.includes("task")) {
    return new vscode.ThemeIcon("checklist");
  }
  if (normalized.includes("feedback")) {
    return new vscode.ThemeIcon("comment-discussion");
  }
  if (normalized.includes("pointer")) {
    return new vscode.ThemeIcon("link-external");
  }
  return new vscode.ThemeIcon("symbol-file");
}

function createActionCommand(command: string, title: string, args?: unknown[]): vscode.Command {
  return { command, title, arguments: args };
}

function getWorkspaceFolders(): TraceableStructureWorkspaceFolder[] {
  return (vscode.workspace.workspaceFolders ?? []).map((workspaceFolder) => ({
    name: workspaceFolder.name,
    fsPath: workspaceFolder.uri.fsPath
  }));
}

function normalizePathKey(filePath: string): string {
  return path.resolve(filePath).replace(/\\+/g, "/").toLowerCase();
}

function isPathWithinRoot(filePath: string, rootPath: string): boolean {
  const normalizedFile = normalizePathKey(filePath);
  const normalizedRoot = normalizePathKey(rootPath);
  return normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}/`);
}

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

function formatTimestampVerbose(value?: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  const timestamp = value as number;
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

function formatSortModeLabel(sortMode: TraceableStructureSortMode): string {
  switch (sortMode) {
    case "modified-asc":
      return "oldest modified";
    case "created-desc":
      return "newest created";
    case "created-asc":
      return "oldest created";
    case "modified-desc":
    default:
      return "newest modified";
  }
}

function formatTimeFilterPresetLabel(preset: TraceableStructureTimeFilterPreset): string {
  return preset === "today" ? "Today" : preset;
}

function formatTimeFilterSummary(basis: TraceableStructureTimeFilterBasis, preset?: TraceableStructureTimeFilterPreset): string {
  if (basis === "none" || !preset) {
    return "off";
  }
  return `${basis} ${formatTimeFilterPresetLabel(preset).toLowerCase()}`;
}

function parseTraceableCreatedAtTimestamp(value?: string): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/u.exec(trimmed);
  if (!match) {
    return undefined;
  }
  const [, year, month, day, hours, minutes, seconds] = match;
  return Date.UTC(
    Number.parseInt(year, 10),
    Number.parseInt(month, 10) - 1,
    Number.parseInt(day, 10),
    Number.parseInt(hours, 10),
    Number.parseInt(minutes, 10),
    Number.parseInt(seconds, 10)
  );
}

function getNodeCreatedAtTimestamp(node: TraceableStructureNode): number | undefined {
  const parsed = parseTraceableCreatedAtTimestamp(node.currentCreatedAt);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getNodeTimestampForBasis(node: TraceableStructureNode, basis: Exclude<TraceableStructureTimeFilterBasis, "none">): number | undefined {
  if (basis === "created") {
    return getNodeCreatedAtTimestamp(node);
  }
  return Number.isFinite(node.modifiedAt) ? node.modifiedAt : undefined;
}

function getSortDirection(sortMode: TraceableStructureSortMode): "asc" | "desc" {
  return sortMode.endsWith("-asc") ? "asc" : "desc";
}

function getSortBasis(sortMode: TraceableStructureSortMode): Exclude<TraceableStructureTimeFilterBasis, "none"> {
  return sortMode.startsWith("created") ? "created" : "modified";
}

function normalizeSortTimestamp(value: number | undefined, sortMode: TraceableStructureSortMode): number {
  if (Number.isFinite(value)) {
    return value as number;
  }
  return getSortDirection(sortMode) === "desc" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
}

function compareSortValues(left: number | undefined, right: number | undefined, sortMode: TraceableStructureSortMode): number {
  const normalizedLeft = normalizeSortTimestamp(left, sortMode);
  const normalizedRight = normalizeSortTimestamp(right, sortMode);
  return getSortDirection(sortMode) === "asc"
    ? normalizedLeft - normalizedRight
    : normalizedRight - normalizedLeft;
}

function getNodeSortTimestamp(node: TraceableStructureNode, sortMode: TraceableStructureSortMode): number | undefined {
  return getNodeTimestampForBasis(node, getSortBasis(sortMode));
}

function compareNodesBySortMode(left: TraceableStructureNode, right: TraceableStructureNode, sortMode: TraceableStructureSortMode): number {
  return compareSortValues(getNodeSortTimestamp(left, sortMode), getNodeSortTimestamp(right, sortMode), sortMode)
    || compareTraceableStructureNodes(left, right);
}

function resolveRepresentativeTimestamp(values: readonly number[], sortMode: TraceableStructureSortMode): number {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (finiteValues.length === 0) {
    return normalizeSortTimestamp(undefined, sortMode);
  }
  return getSortDirection(sortMode) === "asc"
    ? Math.min(...finiteValues)
    : Math.max(...finiteValues);
}

function resolveTimeFilterThreshold(preset: TraceableStructureTimeFilterPreset): number {
  const now = Date.now();
  switch (preset) {
    case "1h":
      return now - 3_600_000;
    case "2h":
      return now - 7_200_000;
    case "6h":
      return now - 21_600_000;
    case "24h":
      return now - 86_400_000;
    case "today": {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      return startOfDay.getTime();
    }
  }
}

function matchesNodeTimeFilter(
  node: TraceableStructureNode,
  basis: TraceableStructureTimeFilterBasis,
  preset?: TraceableStructureTimeFilterPreset
): boolean {
  if (basis === "none" || !preset) {
    return true;
  }
  const timestamp = getNodeTimestampForBasis(node, basis);
  if (!Number.isFinite(timestamp)) {
    return false;
  }
  return (timestamp as number) >= resolveTimeFilterThreshold(preset);
}

function parseSchemaFilterTokens(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/u).map((token) => token.trim()).filter(Boolean))];
}

function formatSchemaFilterLabel(value: string): string {
  const tokens = parseSchemaFilterTokens(value);
  return tokens.length === 0 ? "all" : tokens.join(", ");
}

function createSchemaFilterSet(value: string): Set<string> {
  return new Set(parseSchemaFilterTokens(value).map((token) => token.toLowerCase()));
}

function matchesSchemaFilterForNode(node: TraceableStructureNode, schemaFilter: Set<string>): boolean {
  if (schemaFilter.size === 0) {
    return true;
  }
  const candidates = [node.currentSchemaId, node.parentSchemaId, node.currentSchemaTarget, node.parentSchemaTarget]
    .flatMap((candidate) => candidate ? [candidate.toLowerCase()] : []);
  return candidates.some((candidate) => schemaFilter.has(candidate));
}

function matchesSchemaFilterForSchema(schemaEntry: TraceableStructureSchemaEntry, schemaFilter: Set<string>): boolean {
  if (schemaFilter.size === 0) {
    return true;
  }
  return schemaFilter.has(schemaEntry.id.toLowerCase());
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

function paginateEntries<T>(entries: readonly T[], offset: number, maxItems: number): { items: T[]; total: number; offset: number; maxItems: number } {
  const safeOffset = Math.max(0, Math.min(offset, entries.length));
  return {
    items: entries.slice(safeOffset, safeOffset + maxItems),
    total: entries.length,
    offset: safeOffset,
    maxItems
  };
}

function paginationInfoLabel(pagination: { total: number; offset: number; items: unknown[] }): string | undefined {
  if (pagination.total <= pagination.items.length) {
    return undefined;
  }
  const first = pagination.offset + 1;
  const last = pagination.offset + pagination.items.length;
  return `Showing ${first}-${last} of ${pagination.total}`;
}

function summarizeTraceNode(node: TraceableStructureNode): string {
  return [
    `Path: ${node.displayPath}`,
    `Lineage: ${node.parsedFileName.lineageLabel}`,
    `Schema: ${node.currentSchemaId ?? "-"}`,
    `Parent: ${node.parentTraceTarget ?? node.parentPathKey ?? "-"}`,
    `Modified: ${formatTimestampVerbose(node.modifiedAt)}`
  ].join("\n");
}

function summarizeTracePath(node: TraceableStructureNode): string {
  const workspaceFolder = findWorkspaceFolderForPath(getWorkspaceFolders(), node.workspaceFolderPath);
  if (!workspaceFolder) {
    return node.displayPath;
  }
  const relativePath = path.relative(workspaceFolder.fsPath, node.path).replace(/\\+/g, "/");
  return workspaceFolder.name === path.basename(node.workspaceFolderPath)
    ? relativePath
    : `${workspaceFolder.name}/${relativePath}`;
}

function truncateTreeLabel(value: string, maxLength = 30): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.substring(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function summarizeSchemaEntry(schemaEntry: TraceableStructureSchemaEntry): string {
  return [
    `Path: ${schemaEntry.displayPath}`,
    `Workspace Folder: ${schemaEntry.workspaceFolderName}`,
    `Schema Id: ${schemaEntry.id}`,
    `Modified: ${formatTimestampVerbose(schemaEntry.modifiedAt)}`
  ].join("\n");
}

function summarizeGap(gap: TraceableStructureGap): string {
  return [
    `Workspace Folder: ${gap.workspaceFolderName}`,
    `Folder: ${gap.folderPath}`,
    `Parent Prefix: ${gap.parentLineageLabel ?? "(root)"}`,
    `Missing: ${gap.missingLineageLabel}`,
    `Between: ${gap.previousLabel ?? "-"} and ${gap.nextLabel ?? "-"}`
  ].join("\n");
}

function findWorkspaceFolderForPath(workspaceFolders: readonly TraceableStructureWorkspaceFolder[], filePath: string): TraceableStructureWorkspaceFolder | undefined {
  return workspaceFolders.find((workspaceFolder) => isPathWithinRoot(filePath, workspaceFolder.fsPath));
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveTargetPath(targetPath: string | undefined, workspaceFolders: readonly TraceableStructureWorkspaceFolder[]): Promise<string | undefined> {
  const trimmed = targetPath?.trim();
  if (!trimmed) {
    return undefined;
  }

  const directWorkspaceFolder = workspaceFolders.find((workspaceFolder) => {
    return normalizePathKey(workspaceFolder.fsPath) === normalizePathKey(trimmed)
      || workspaceFolder.name.toLowerCase() === trimmed.toLowerCase();
  });
  if (directWorkspaceFolder) {
    return directWorkspaceFolder.fsPath;
  }

  const workspaceMatch = getUniqueWorkspaceFolderMatchByName(trimmed, workspaceFolders as unknown as TraceableOpenWorkspaceFolder[]);
  if (workspaceMatch) {
    return workspaceMatch;
  }

  const resolvedRelativePath = await resolveRelativeOpenPathInWorkspace(trimmed, workspaceFolders as unknown as TraceableOpenWorkspaceFolder[], pathExists);
  if (resolvedRelativePath) {
    return resolvedRelativePath;
  }

  const resolvedDriveLessAbsolutePath = await resolveDriveLessAbsolutePathOnWindows(trimmed, workspaceFolders as unknown as TraceableOpenWorkspaceFolder[], process.cwd(), pathExists);
  if (resolvedDriveLessAbsolutePath) {
    return resolvedDriveLessAbsolutePath;
  }

  const resolvedAbsolutePath = path.resolve(trimmed);
  if (await pathExists(resolvedAbsolutePath)) {
    return resolvedAbsolutePath;
  }

  return undefined;
}

function hasVisibleChild(
  node: TraceableStructureNode,
  index: TraceableStructureIndex,
  schemaFilter: Set<string>,
  timeFilterBasis: TraceableStructureTimeFilterBasis,
  timeFilterPreset?: TraceableStructureTimeFilterPreset
): boolean {
  return node.childPathKeys.some((childPathKey) => {
    const childNode = index.nodesByPathKey.get(childPathKey);
    return Boolean(
      childNode
      && normalizePathKey(childNode.workspaceFolderPath) === normalizePathKey(node.workspaceFolderPath)
      && normalizePathKey(childNode.folderPath) === normalizePathKey(node.folderPath)
      && matchesSchemaFilterForNode(childNode, schemaFilter)
      && matchesNodeTimeFilter(childNode, timeFilterBasis, timeFilterPreset)
    );
  });
}

function collectVisibleNodesInFolder(
  index: TraceableStructureIndex,
  workspaceFolderPath: string,
  folderPath: string,
  schemaFilter: Set<string>,
  leavesOnly: boolean,
  sortMode: TraceableStructureSortMode,
  timeFilterBasis: TraceableStructureTimeFilterBasis,
  timeFilterPreset?: TraceableStructureTimeFilterPreset
): TraceableStructureNode[] {
  const nodes = [...index.nodesByPathKey.values()].filter((node) => {
    return normalizePathKey(node.workspaceFolderPath) === normalizePathKey(workspaceFolderPath)
      && normalizePathKey(node.folderPath) === normalizePathKey(folderPath)
      && matchesSchemaFilterForNode(node, schemaFilter)
      && matchesNodeTimeFilter(node, timeFilterBasis, timeFilterPreset);
  });

  if (!leavesOnly) {
    return nodes.sort((left, right) => compareNodesBySortMode(left, right, sortMode));
  }

  return nodes
    .filter((node) => !hasVisibleChild(node, index, schemaFilter, timeFilterBasis, timeFilterPreset))
    .sort((left, right) => compareNodesBySortMode(left, right, sortMode));
}

function collectVisibleChildNodes(
  index: TraceableStructureIndex,
  node: TraceableStructureNode,
  schemaFilter: Set<string>,
  leavesOnly: boolean,
  sortMode: TraceableStructureSortMode,
  timeFilterBasis: TraceableStructureTimeFilterBasis,
  timeFilterPreset?: TraceableStructureTimeFilterPreset
): TraceableStructureNode[] {
  const children = node.childPathKeys
    .map((childPathKey) => index.nodesByPathKey.get(childPathKey))
    .flatMap((candidate) => candidate ? [candidate] : [])
    .filter((candidate) => normalizePathKey(candidate.workspaceFolderPath) === normalizePathKey(node.workspaceFolderPath))
    .filter((candidate) => normalizePathKey(candidate.folderPath) === normalizePathKey(node.folderPath))
    .filter((candidate) => matchesSchemaFilterForNode(candidate, schemaFilter))
    .filter((candidate) => matchesNodeTimeFilter(candidate, timeFilterBasis, timeFilterPreset));

  if (!leavesOnly) {
    return children.sort((left, right) => compareNodesBySortMode(left, right, sortMode));
  }

  return children
    .filter((candidate) => !hasVisibleChild(candidate, index, schemaFilter, timeFilterBasis, timeFilterPreset))
    .sort((left, right) => compareNodesBySortMode(left, right, sortMode));
}

function collectVisibleNodesUnderPath(
  index: TraceableStructureIndex,
  rootPath: string,
  schemaFilter: Set<string>,
  leavesOnly: boolean,
  sortMode: TraceableStructureSortMode,
  timeFilterBasis: TraceableStructureTimeFilterBasis,
  timeFilterPreset?: TraceableStructureTimeFilterPreset
): TraceableStructureNode[] {
  const nodes = [...index.nodesByPathKey.values()].filter((node) => {
    return isPathWithinRoot(node.folderPath, rootPath)
      && matchesSchemaFilterForNode(node, schemaFilter)
      && matchesNodeTimeFilter(node, timeFilterBasis, timeFilterPreset)
      && (!leavesOnly || !hasVisibleChild(node, index, schemaFilter, timeFilterBasis, timeFilterPreset));
  });
  return nodes.sort((left, right) => compareNodesBySortMode(left, right, sortMode));
}

function collectVisibleSchemaEntries(index: TraceableStructureIndex, workspaceFolderPath: string, schemaFilter: Set<string>): TraceableStructureSchemaEntry[] {
  return index.schemaEntries
    .filter((entry) => normalizePathKey(entry.workspaceFolderPath) === normalizePathKey(workspaceFolderPath))
    .filter((entry) => matchesSchemaFilterForSchema(entry, schemaFilter))
    .sort(compareTraceableStructureSchemaEntries);
}

function isTopicRootNode(node: TraceableStructureNode): boolean {
  return node.parsedFileName.lineageLabel === "001";
}

function hasTopicRoots(index: TraceableStructureIndex, workspaceFolderPath: string): boolean {
  return [...index.nodesByPathKey.values()].some((node) => normalizePathKey(node.workspaceFolderPath) === normalizePathKey(workspaceFolderPath) && isTopicRootNode(node));
}

function formatTopicFolderLabel(folderPath: string): string {
  return path.basename(folderPath.replace(/\+/g, "/")) || path.basename(folderPath);
}

function collectTopicFolderForest(
  index: TraceableStructureIndex,
  workspaceFolderPath: string,
  schemaFilter: Set<string>,
  leavesOnly: boolean,
  timeFilterBasis: TraceableStructureTimeFilterBasis,
  timeFilterPreset?: TraceableStructureTimeFilterPreset
): TraceableStructureTopicFolderForest {
  const normalizedWorkspaceFolderPath = normalizePathKey(workspaceFolderPath);
  const workspaceNodes = [...index.nodesByPathKey.values()].filter((node) => {
    return normalizePathKey(node.workspaceFolderPath) === normalizedWorkspaceFolderPath
      && matchesSchemaFilterForNode(node, schemaFilter)
      && matchesNodeTimeFilter(node, timeFilterBasis, timeFilterPreset)
      && (!leavesOnly || !hasVisibleChild(node, index, schemaFilter, timeFilterBasis, timeFilterPreset));
  });
  return collectTraceableStructureTopicFolderForest(workspaceNodes);
}

function summarizeChecksum(validation: ReturnType<typeof validateTraceableContinuityArtifactChainSync>): string {
  const topNode = validation.nodes[0];
  const directParentStatus = topNode?.traceableParentIntegrity?.status ?? topNode?.continuityIntegrity?.status ?? "unknown";
  return `${directParentStatus} | chain ${validation.nodes.length} | ${validation.stoppedBecause}`;
}

function collectDirectTopicNodesInFolder(
  index: TraceableStructureIndex,
  workspaceFolderPath: string,
  folderPath: string,
  schemaFilter: Set<string>,
  leavesOnly: boolean,
  sortMode: TraceableStructureSortMode,
  timeFilterBasis: TraceableStructureTimeFilterBasis,
  timeFilterPreset?: TraceableStructureTimeFilterPreset
): TraceableStructureNode[] {
  return collectVisibleNodesInFolder(index, workspaceFolderPath, folderPath, schemaFilter, leavesOnly, sortMode, timeFilterBasis, timeFilterPreset)
    .filter((node) => !isTopicRootNode(node));
}

function collectFolderSummaries(
  index: TraceableStructureIndex,
  workspaceFolder: TraceableStructureWorkspaceFolder,
  schemaFilter: Set<string>,
  leavesOnly: boolean,
  sortMode: TraceableStructureSortMode,
  timeFilterBasis: TraceableStructureTimeFilterBasis,
  timeFilterPreset?: TraceableStructureTimeFilterPreset
): Array<{ folderPath: string; nodes: TraceableStructureNode[]; latestModifiedAt: number; sortTimestamp: number }> {
  const nodes = [...index.nodesByPathKey.values()].filter((node) => {
    return normalizePathKey(node.workspaceFolderPath) === normalizePathKey(workspaceFolder.fsPath)
      && matchesSchemaFilterForNode(node, schemaFilter)
      && matchesNodeTimeFilter(node, timeFilterBasis, timeFilterPreset);
  });

  const summariesByFolderPath = new Map<string, TraceableStructureNode[]>();
  for (const node of nodes) {
    if (leavesOnly && hasVisibleChild(node, index, schemaFilter, timeFilterBasis, timeFilterPreset)) {
      continue;
    }
    const folderNodes = summariesByFolderPath.get(node.folderPath) ?? [];
    folderNodes.push(node);
    summariesByFolderPath.set(node.folderPath, folderNodes);
  }

  return [...summariesByFolderPath.entries()]
    .map(([folderPath, folderNodes]) => ({
      folderPath,
      nodes: folderNodes.sort((left, right) => compareNodesBySortMode(left, right, sortMode)),
      latestModifiedAt: Math.max(0, ...folderNodes.map((node) => node.modifiedAt ?? 0)),
      sortTimestamp: resolveRepresentativeTimestamp(folderNodes.map((node) => getNodeSortTimestamp(node, sortMode) ?? normalizeSortTimestamp(undefined, sortMode)), sortMode)
    }))
    .sort((left, right) => compareSortValues(left.sortTimestamp, right.sortTimestamp, sortMode) || formatFolderLabel(left.folderPath, workspaceFolder).localeCompare(formatFolderLabel(right.folderPath, workspaceFolder)));
}

function formatFolderLabel(folderPath: string, workspaceFolder: TraceableStructureWorkspaceFolder): string {
  const relativePath = path.relative(workspaceFolder.fsPath, folderPath).replace(/\\+/g, "/");
  return relativePath && relativePath !== "." ? relativePath : workspaceFolder.name;
}

class TraceableStructureTreeController implements vscode.TreeDataProvider<TraceableStructureTreeItem>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private state: TraceableStructureViewState;
  private indexPromise?: Promise<TraceableStructureIndex>;
  private readonly continuitySummaryByPathKey = new Map<string, TraceNodeContinuitySummary>();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.state = {
      ...DEFAULT_STATE,
      ...(context.workspaceState.get<Partial<TraceableStructureViewState>>(STATE_KEY) ?? {})
    };
  }

  readonly onDidChangeTreeData = this.changeEmitter.event;

  dispose(): void {
    this.changeEmitter.dispose();
  }

  getState(): TraceableStructureViewState {
    return this.state;
  }

  async refresh(rebuildIndex = false): Promise<void> {
    this.continuitySummaryByPathKey.clear();
    if (rebuildIndex) {
      this.indexPromise = undefined;
    }
    this.changeEmitter.fire();
  }

  async toggleTreeView(treeView?: boolean): Promise<void> {
    const nextMode: TraceableStructureViewMode = typeof treeView === "boolean"
      ? (treeView ? "tree" : "list")
      : (this.state.viewMode === "tree" ? "list" : "tree");
    await this.setViewMode(nextMode);
  }

  async setDetailLevel(detailLevel: TraceableStructureDetailLevel): Promise<void> {
    if (this.state.detailLevel === detailLevel) {
      return;
    }
    this.state = { ...this.state, detailLevel };
    await this.context.workspaceState.update(STATE_KEY, this.state);
    await this.refresh();
  }

  async setSortMode(sortMode: TraceableStructureSortMode): Promise<void> {
    if (this.state.sortMode === sortMode) {
      return;
    }
    this.state = { ...this.state, sortMode, offset: 0 };
    await this.context.workspaceState.update(STATE_KEY, this.state);
    await this.refresh();
  }

  async toggleLeavesOnly(leavesOnly?: boolean): Promise<void> {
    const nextValue = typeof leavesOnly === "boolean" ? leavesOnly : !this.state.leavesOnly;
    await this.setLeavesOnly(nextValue);
  }

  async toggleIncludeSchemas(): Promise<void> {
    await this.setIncludeSchemas(!this.state.includeSchemas);
  }

  async setViewMode(viewMode: TraceableStructureViewMode): Promise<void> {
    if (this.state.viewMode === viewMode) {
      return;
    }
    this.state = { ...this.state, viewMode, offset: 0 };
    await this.context.workspaceState.update(STATE_KEY, this.state);
    await this.refresh();
  }

  async setLeavesOnly(leavesOnly: boolean): Promise<void> {
    if (this.state.leavesOnly === leavesOnly) {
      return;
    }
    this.state = { ...this.state, leavesOnly, offset: 0 };
    await this.context.workspaceState.update(STATE_KEY, this.state);
    await this.refresh();
  }

  async setIncludeSchemas(includeSchemas: boolean): Promise<void> {
    if (this.state.includeSchemas === includeSchemas) {
      return;
    }
    this.state = { ...this.state, includeSchemas };
    await this.context.workspaceState.update(STATE_KEY, this.state);
    await this.refresh();
  }

  async setTargetPath(targetPath: string | undefined): Promise<void> {
    this.state = { ...this.state, targetPath: targetPath?.trim() || undefined, offset: 0 };
    await this.context.workspaceState.update(STATE_KEY, this.state);
    await this.refresh();
  }

  async clearTargetPath(): Promise<void> {
    await this.setTargetPath(undefined);
  }

  async setSchemaFilter(schemaFilterText: string | undefined): Promise<void> {
    this.state = { ...this.state, schemaFilterText: schemaFilterText?.trim() ?? "", offset: 0 };
    await this.context.workspaceState.update(STATE_KEY, this.state);
    await this.refresh();
  }

  async clearSchemaFilter(): Promise<void> {
    await this.setSchemaFilter("");
  }

  async setTimeFilter(basis: TraceableStructureTimeFilterBasis, preset?: TraceableStructureTimeFilterPreset): Promise<void> {
    const nextBasis = basis === "none" ? "none" : basis;
    const nextPreset = nextBasis === "none" ? undefined : preset;
    if (this.state.timeFilterBasis === nextBasis && this.state.timeFilterPreset === nextPreset) {
      return;
    }
    this.state = { ...this.state, timeFilterBasis: nextBasis, timeFilterPreset: nextPreset, offset: 0 };
    await this.context.workspaceState.update(STATE_KEY, this.state);
    await this.refresh();
  }

  async setMaxItems(maxItems: number): Promise<void> {
    this.state = { ...this.state, maxItems: clampMaxItems(maxItems), offset: 0 };
    await this.context.workspaceState.update(STATE_KEY, this.state);
    await this.refresh();
  }

  async setOffset(offset: number): Promise<void> {
    this.state = { ...this.state, offset: clampOffset(offset) };
    await this.context.workspaceState.update(STATE_KEY, this.state);
    await this.refresh();
  }

  async configure(): Promise<void> {
    const picked = await vscode.window.showQuickPick([
      { label: this.state.viewMode === "tree" ? "View: List View" : "View: Tree View", action: async () => this.toggleTreeView() },
      { label: "Detail level: Compact", action: async () => this.setDetailLevel("compact") },
      { label: "Detail level: Standard", action: async () => this.setDetailLevel("standard") },
      { label: "Detail level: Full", action: async () => this.setDetailLevel("full") },
      { label: `Sort: ${formatSortModeLabel(this.state.sortMode)}`, action: async () => this.promptAndSetSortMode() },
      { label: this.state.leavesOnly ? "Visibility: All" : "Visibility: Leaves only", action: async () => this.toggleLeavesOnly() },
      { label: this.state.includeSchemas ? "Schema notes: Off" : "Schema notes: On", action: async () => this.toggleIncludeSchemas() },
      { label: `Created filter: ${this.state.timeFilterBasis === "created" ? formatTimeFilterSummary(this.state.timeFilterBasis, this.state.timeFilterPreset) : "off"}`, action: async () => this.promptAndSetTimeFilter("created") },
      { label: `Modified filter: ${this.state.timeFilterBasis === "modified" ? formatTimeFilterSummary(this.state.timeFilterBasis, this.state.timeFilterPreset) : "off"}`, action: async () => this.promptAndSetTimeFilter("modified") },
      { label: "Set target path", action: async () => this.promptAndSetTargetPath() },
      { label: this.state.targetPath ? "Clear target path" : "No target path set", action: async () => this.clearTargetPath() },
      { label: "Set schema filter", action: async () => this.promptAndSetSchemaFilter() },
      { label: this.state.schemaFilterText ? "Clear schema filter" : "No schema filter", action: async () => this.clearSchemaFilter() },
      { label: `Max items: ${this.state.maxItems}`, action: async () => this.promptAndSetMaxItems() },
      { label: `Offset: ${this.state.offset}`, action: async () => this.promptAndSetOffset() },
      { label: "Refresh", action: async () => this.refresh(true) }
    ], {
      title: "Configure Lineage View",
      placeHolder: "Choose a lineage control"
    });

    if (picked) {
      await picked.action();
    }
  }

  async promptAndSetTargetPath(): Promise<void> {
    const nextTargetPath = await vscode.window.showInputBox({
      title: "Traceable Structure Target",
      prompt: "Enter a workspace-relative folder path or a .trace.md file path",
      value: this.state.targetPath ?? ""
    });
    if (nextTargetPath === undefined) {
      return;
    }
    const resolvedTargetPath = await resolveTargetPath(nextTargetPath, getWorkspaceFolders());
    if (!resolvedTargetPath) {
      void vscode.window.showErrorMessage(`Could not resolve ${JSON.stringify(nextTargetPath)} to an existing folder or .trace.md artifact.`);
      return;
    }
    await this.setTargetPath(resolvedTargetPath);
  }

  async promptAndSetSchemaFilter(): Promise<void> {
    const nextSchemaFilter = await vscode.window.showInputBox({
      title: "Traceable Structure Schema Filter",
      prompt: "Enter one or more schema ids separated by commas or spaces",
      value: this.state.schemaFilterText
    });
    if (nextSchemaFilter === undefined) {
      return;
    }
    await this.setSchemaFilter(nextSchemaFilter);
  }

  async promptAndSetSortMode(): Promise<void> {
    const picked = await vscode.window.showQuickPick(
      TRACEABLE_STRUCTURE_SORT_COMMANDS.map((entry) => ({
        label: entry.title,
        value: entry.sortMode,
        description: this.state.sortMode === entry.sortMode ? "current" : undefined
      })),
      { title: "Traceable Structure Sort Order" }
    );
    if (picked) {
      await this.setSortMode(picked.value);
    }
  }

  async promptAndSetTimeFilter(basis: Exclude<TraceableStructureTimeFilterBasis, "none">): Promise<void> {
    const picked = await vscode.window.showQuickPick([
      { label: "1h", preset: "1h" as const },
      { label: "2h", preset: "2h" as const },
      { label: "6h", preset: "6h" as const },
      { label: "24h", preset: "24h" as const },
      { label: "Today", preset: "today" as const },
      { label: "Reset", preset: undefined }
    ].map((entry) => ({
      ...entry,
      description: this.state.timeFilterBasis === basis && this.state.timeFilterPreset === entry.preset ? "current" : undefined
    })), {
      title: `Traceable Structure ${basis === "created" ? "Created" : "Modified"} Filter`
    });
    if (!picked) {
      return;
    }
    if (!picked.preset) {
      await this.setTimeFilter("none");
      return;
    }
    await this.setTimeFilter(basis, picked.preset);
  }

  async promptAndSetMaxItems(): Promise<void> {
    const nextValue = await vscode.window.showInputBox({
      title: "Traceable Structure Max Items",
      prompt: "Enter the maximum number of items to show per list",
      value: String(this.state.maxItems)
    });
    if (nextValue === undefined) {
      return;
    }
    const parsed = Number.parseInt(nextValue, 10);
    if (!Number.isFinite(parsed)) {
      void vscode.window.showErrorMessage(`Invalid max items value: ${JSON.stringify(nextValue)}`);
      return;
    }
    await this.setMaxItems(parsed);
  }

  async promptAndSetOffset(): Promise<void> {
    const nextValue = await vscode.window.showInputBox({
      title: "Traceable Structure Offset",
      prompt: "Enter the zero-based offset for bounded lists",
      value: String(this.state.offset)
    });
    if (nextValue === undefined) {
      return;
    }
    const parsed = Number.parseInt(nextValue, 10);
    if (!Number.isFinite(parsed)) {
      void vscode.window.showErrorMessage(`Invalid offset value: ${JSON.stringify(nextValue)}`);
      return;
    }
    await this.setOffset(parsed);
  }

  async getChildren(element?: TraceableStructureTreeItem): Promise<TraceableStructureTreeItem[]> {
    if (!element) {
      return this.buildRootItems();
    }

    if (element.data.children) {
      return element.data.children;
    }

    const index = await this.loadIndex();
    const schemaFilter = createSchemaFilterSet(this.state.schemaFilterText);
    switch (element.data.kind) {
      case "structure-root":
        return this.buildStructureRootChildren(index, schemaFilter);
      case "workspace-folder":
        return element.data.workspaceFolderPath ? this.buildWorkspaceFolderChildren(index, element.data.workspaceFolderPath, schemaFilter) : [];
      case "folder":
        return element.data.workspaceFolderPath && element.data.folderPath
          ? this.buildFolderChildren(index, element.data.workspaceFolderPath, element.data.folderPath, schemaFilter)
          : [];
      case "trace":
        return element.data.nodePathKey ? this.buildTraceNodeChildren(index, element.data.nodePathKey, schemaFilter) : [];
      default:
        return [];
    }
  }

  getTreeItem(element: TraceableStructureTreeItem): vscode.TreeItem {
    return element;
  }

  private async loadIndex(): Promise<TraceableStructureIndex> {
    if (!this.indexPromise) {
      this.indexPromise = buildTraceableStructureIndex(getWorkspaceFolders());
    }
    return this.indexPromise;
  }

  private async getResolvedScope(index: TraceableStructureIndex): Promise<TraceableStructureScope> {
    const workspaceFolders = getWorkspaceFolders();
    if (!this.state.targetPath) {
      return { kind: "workspace" };
    }

    const resolvedTargetPath = await resolveTargetPath(this.state.targetPath, workspaceFolders);
    if (!resolvedTargetPath) {
      return { kind: "missing", targetPath: this.state.targetPath, reason: `Could not resolve ${JSON.stringify(this.state.targetPath)} to an existing folder or .trace.md artifact.` };
    }

    const targetNode = index.nodesByPathKey.get(normalizePathKey(resolvedTargetPath));
    if (targetNode) {
      const workspaceFolder = findWorkspaceFolderForPath(workspaceFolders, targetNode.workspaceFolderPath) ?? {
        name: path.basename(targetNode.workspaceFolderPath),
        fsPath: targetNode.workspaceFolderPath
      };
      return { kind: "trace", workspaceFolder, targetNode };
    }

    try {
      const stats = await vscode.workspace.fs.stat(vscode.Uri.file(resolvedTargetPath));
      if (stats.type === vscode.FileType.Directory) {
        const workspaceFolder = findWorkspaceFolderForPath(workspaceFolders, resolvedTargetPath) ?? {
          name: path.basename(resolvedTargetPath),
          fsPath: resolvedTargetPath
        };
        return { kind: "folder", workspaceFolder, folderPath: resolvedTargetPath };
      }
    } catch {
      // Fall through to missing scope.
    }

    const workspaceFolder = findWorkspaceFolderForPath(workspaceFolders, resolvedTargetPath);
    if (workspaceFolder) {
      return { kind: "folder", workspaceFolder, folderPath: resolvedTargetPath };
    }

    return { kind: "missing", targetPath: resolvedTargetPath, reason: `Could not resolve ${JSON.stringify(resolvedTargetPath)} to an existing folder or .trace.md artifact.` };
  }

  private async buildRootItems(): Promise<TraceableStructureTreeItem[]> {
    const index = await this.loadIndex();
    return this.buildStructureRootChildren(index, createSchemaFilterSet(this.state.schemaFilterText));
  }

  private buildModesSection(): TraceableStructureTreeItem {
    return this.createSectionItem("Modes", `view: ${this.state.viewMode} | detail: ${this.state.detailLevel} | sort: ${formatSortModeLabel(this.state.sortMode)} | visibility: ${this.state.leavesOnly ? "leaves only" : "all"}`, [
      this.createGroupItem("View", this.state.viewMode === "tree" ? "tree view" : "list view", [
        this.createChoiceItem("Tree View", this.state.viewMode === "tree", "Show topic and folder hierarchy", TRACEABLE_STRUCTURE_TOGGLE_TREE_VIEW_COMMAND, [true]),
        this.createChoiceItem("List View", this.state.viewMode === "list", "Show a flat scan-oriented trace list", TRACEABLE_STRUCTURE_TOGGLE_TREE_VIEW_COMMAND, [false])
      ], true),
      this.createGroupItem("Sort", formatSortModeLabel(this.state.sortMode), TRACEABLE_STRUCTURE_SORT_COMMANDS.map((entry) => {
        return this.createChoiceItem(entry.title, this.state.sortMode === entry.sortMode, `Sort by ${entry.title.toLowerCase()}`, TRACEABLE_STRUCTURE_SET_SORT_MODE_COMMAND, [entry.sortMode]);
      }), true),
      this.createGroupItem("Detail level", this.state.detailLevel, [
        this.createChoiceItem("Compact", this.state.detailLevel === "compact", "Show the shortest possible tree summaries", TRACEABLE_STRUCTURE_SET_DETAIL_LEVEL_COMMAND, ["compact"]),
        this.createChoiceItem("Standard", this.state.detailLevel === "standard", "Show the default tree detail", TRACEABLE_STRUCTURE_SET_DETAIL_LEVEL_COMMAND, ["standard"]),
        this.createChoiceItem("Full", this.state.detailLevel === "full", "Show the richest tree detail", TRACEABLE_STRUCTURE_SET_DETAIL_LEVEL_COMMAND, ["full"])
      ], true),
      this.createGroupItem("Visibility", this.state.leavesOnly ? "leaves only" : "all", [
        this.createChoiceItem("Leaf only", this.state.leavesOnly, "Show only leaf .trace.md artifacts", TRACEABLE_STRUCTURE_TOGGLE_LEAVES_ONLY_COMMAND, [true]),
        this.createChoiceItem("Show all", !this.state.leavesOnly, "Show all matching .trace.md artifacts", TRACEABLE_STRUCTURE_TOGGLE_LEAVES_ONLY_COMMAND, [false])
      ], true)
    ]);
  }

  private buildFiltersSection(): TraceableStructureTreeItem {
    return this.createSectionItem("Filters", `schema: ${formatSchemaFilterLabel(this.state.schemaFilterText)} | time: ${formatTimeFilterSummary(this.state.timeFilterBasis, this.state.timeFilterPreset)} | schema notes: ${this.state.includeSchemas ? "on" : "off"}`, [
      this.createActionItem("Schema filter", formatSchemaFilterLabel(this.state.schemaFilterText), "Filter by schema ids", TRACEABLE_STRUCTURE_SET_SCHEMA_FILTER_COMMAND),
      this.createActionItem("Created filter", this.state.timeFilterBasis === "created" ? formatTimeFilterPresetLabel(this.state.timeFilterPreset ?? "today") : "off", "Filter visible traces by Created At", TRACEABLE_STRUCTURE_TIME_FILTER_COMMANDS[0].command),
      this.createActionItem("Modified filter", this.state.timeFilterBasis === "modified" ? formatTimeFilterPresetLabel(this.state.timeFilterPreset ?? "today") : "off", "Filter visible traces by modified time", TRACEABLE_STRUCTURE_TIME_FILTER_COMMANDS[6].command),
      this.createActionItem("Clear schema filter", undefined, "Clear the active schema filter", TRACEABLE_STRUCTURE_CLEAR_SCHEMA_FILTER_COMMAND),
      this.createActionItem("Include schema notes", this.state.includeSchemas ? "on" : "off", this.state.includeSchemas ? "Hide discovered schema notes" : "Include discovered schema notes", TRACEABLE_STRUCTURE_TOGGLE_INCLUDE_SCHEMAS_COMMAND),
      this.createActionItem("Max items", String(this.state.maxItems), "Set the paging limit for list-like groups", TRACEABLE_STRUCTURE_SET_MAX_ITEMS_COMMAND),
      this.createInfoItem("Sort order", formatSortModeLabel(this.state.sortMode), "Entries are sorted using the active sort mode before tree sections are built."),
      this.createInfoItem("Lineage basis", "parent trace + checksum chain", "Tree structure is derived from trace parent links and continuity checksum evidence.")
    ]);
  }

  private buildScopeSection(scope: TraceableStructureScope): TraceableStructureTreeItem {
    return this.createSectionItem("Scope", this.describeScope(scope), this.buildScopeSectionChildren(scope));
  }

  private buildStructureSection(scope: TraceableStructureScope): TraceableStructureTreeItem {
    return new TraceableStructureTreeItem("Lineage", vscode.TreeItemCollapsibleState.Expanded, { kind: "structure-root" }, this.describeScope(scope), `Workspace, folder, or trace lineage ordered by ${formatSortModeLabel(this.state.sortMode)}.`);
  }

  private describeScope(scope: TraceableStructureScope): string {
    if (scope.kind === "workspace") {
      return "workspace overview";
    }
    if (scope.kind === "folder") {
      return scope.folderPath;
    }
    if (scope.kind === "trace") {
      return scope.targetNode.displayPath;
    }
    return `missing: ${scope.targetPath}`;
  }

  private buildScopeSectionChildren(scope: TraceableStructureScope): TraceableStructureTreeItem[] {
    if (scope.kind === "folder") {
      return [this.createInfoItem("Current scope", scope.folderPath, "The tree is focused on one folder.")];
    }
    if (scope.kind === "trace") {
      return [this.createInfoItem("Current scope", scope.targetNode.displayPath, "The tree is focused on one trace and its upstream/downstream lineage.")];
    }
    if (scope.kind === "missing") {
      return [this.createInfoItem("Current scope", scope.targetPath, scope.reason)];
    }
    return [];
  }

  private async buildStructureRootChildren(index: TraceableStructureIndex, schemaFilter: Set<string>): Promise<TraceableStructureTreeItem[]> {
    const scope = await this.getResolvedScope(index);
    if (scope.kind === "workspace") {
      return this.state.viewMode === "tree"
        ? this.buildWorkspaceRootChildren(index, schemaFilter)
        : this.buildWorkspaceListChildren(index, schemaFilter);
    }
    if (scope.kind === "folder") {
      if (this.state.viewMode === "list") {
        return this.buildFolderListChildren(index, scope.workspaceFolder.fsPath, scope.folderPath, schemaFilter);
      }
      if (hasTopicRoots(index, scope.workspaceFolder.fsPath)) {
        const forest = collectTopicFolderForest(index, scope.workspaceFolder.fsPath, schemaFilter, this.state.leavesOnly, this.state.timeFilterBasis, this.state.timeFilterPreset);
        if (forest.latestModifiedAtByFolderPath.has(scope.folderPath)) {
          return [this.createTopicFolderItem(index, scope.workspaceFolder, scope.folderPath, forest, schemaFilter, this.state.leavesOnly, true)];
        }
      }
      return this.buildLegacyFolderChildren(index, scope.workspaceFolder.fsPath, scope.folderPath, schemaFilter);
    }
    if (scope.kind === "trace") {
      return this.buildTraceNodeChildren(index, scope.targetNode.pathKey, schemaFilter);
    }
    return [this.createInfoItem("No matching scope", scope.targetPath, scope.reason)];
  }

  private buildWorkspaceRootChildren(index: TraceableStructureIndex, schemaFilter: Set<string>): TraceableStructureTreeItem[] {
    const workspaceFolders = getWorkspaceFolders();
    if (workspaceFolders.length === 0) {
      return [this.createInfoItem("No workspace folders", "Open a workspace to inspect traceable structure", "No workspace folders are currently available.")];
    }

    const summaries = workspaceFolders
      .map((workspaceFolder) => this.collectWorkspaceFolderSummary(index, workspaceFolder, schemaFilter))
      .filter((summary) => summary.folderCount > 0 || summary.schemaCount > 0 || summary.gapCount > 0)
      .sort((left, right) => compareSortValues(left.sortTimestamp, right.sortTimestamp, this.state.sortMode) || left.workspaceFolder.name.localeCompare(right.workspaceFolder.name));

    if (summaries.length === 0) {
      return [this.createInfoItem("No traceable structure", "Open a workspace folder to inspect traceable structure", "No matching trace or schema items were found in the open workspace folders.")];
    }

    return summaries.map((summary) => this.createWorkspaceFolderItem(summary));
  }

  private buildWorkspaceListChildren(index: TraceableStructureIndex, schemaFilter: Set<string>): TraceableStructureTreeItem[] {
    const nodes = [...index.nodesByPathKey.values()]
      .filter((node) => matchesSchemaFilterForNode(node, schemaFilter))
      .filter((node) => matchesNodeTimeFilter(node, this.state.timeFilterBasis, this.state.timeFilterPreset))
      .filter((node) => !this.state.leavesOnly || !hasVisibleChild(node, index, schemaFilter, this.state.timeFilterBasis, this.state.timeFilterPreset))
      .sort((left, right) => compareNodesBySortMode(left, right, this.state.sortMode));
    return this.buildListItems(nodes, "No traceable structure", "No trace items matched the current filters.");
  }

  private buildFolderListChildren(index: TraceableStructureIndex, workspaceFolderPath: string, folderPath: string, schemaFilter: Set<string>): TraceableStructureTreeItem[] {
    const nodes = collectVisibleNodesUnderPath(index, folderPath, schemaFilter, this.state.leavesOnly, this.state.sortMode, this.state.timeFilterBasis, this.state.timeFilterPreset)
      .filter((node) => normalizePathKey(node.workspaceFolderPath) === normalizePathKey(workspaceFolderPath));
    return this.buildListItems(nodes, "No matching traceable structure", `No trace items matched the current filters in ${folderPath}.`);
  }

  private buildListItems(nodes: readonly TraceableStructureNode[], emptyLabel: string, emptyTooltip: string): TraceableStructureTreeItem[] {
    const pagination = paginateEntries(nodes, this.state.offset, this.state.maxItems);
    const items = pagination.items.map((node) => this.createTraceNodeItem(node));
    const footer = paginationInfoLabel(pagination);
    if (footer) {
      items.push(this.createInfoItem("Pagination", footer, "Increase max items or change the offset to see more traces."));
    }
    if (items.length === 0) {
      items.push(this.createInfoItem(emptyLabel, "", emptyTooltip));
    }
    return items;
  }

  private collectWorkspaceFolderSummary(index: TraceableStructureIndex, workspaceFolder: TraceableStructureWorkspaceFolder, schemaFilter: Set<string>): WorkspaceFolderSummary {
    const nodes = [...index.nodesByPathKey.values()].filter((node) => {
      return normalizePathKey(node.workspaceFolderPath) === normalizePathKey(workspaceFolder.fsPath)
        && matchesSchemaFilterForNode(node, schemaFilter)
        && matchesNodeTimeFilter(node, this.state.timeFilterBasis, this.state.timeFilterPreset)
        && (!this.state.leavesOnly || !hasVisibleChild(node, index, schemaFilter, this.state.timeFilterBasis, this.state.timeFilterPreset));
    });
    const folderPaths = new Set(nodes.map((node) => node.folderPath));
    const schemaEntries = collectVisibleSchemaEntries(index, workspaceFolder.fsPath, schemaFilter);
    const gaps = collectTraceableStructureGaps(nodes);
    const latestModifiedAt = Math.max(0, ...nodes.map((node) => node.modifiedAt ?? 0), ...schemaEntries.map((entry) => entry.modifiedAt ?? 0));
    return {
      workspaceFolder,
      folderCount: folderPaths.size,
      traceCount: nodes.length,
      schemaCount: schemaEntries.length,
      gapCount: gaps.length,
      latestModifiedAt,
      sortTimestamp: resolveRepresentativeTimestamp(nodes.map((node) => getNodeSortTimestamp(node, this.state.sortMode) ?? normalizeSortTimestamp(undefined, this.state.sortMode)), this.state.sortMode)
    };
  }

  private buildWorkspaceFolderChildren(index: TraceableStructureIndex, workspaceFolderPath: string, schemaFilter: Set<string>): TraceableStructureTreeItem[] {
    const workspaceFolder = getWorkspaceFolders().find((candidate) => normalizePathKey(candidate.fsPath) === normalizePathKey(workspaceFolderPath)) ?? {
      name: path.basename(workspaceFolderPath),
      fsPath: workspaceFolderPath
    };
    if (hasTopicRoots(index, workspaceFolder.fsPath)) {
      return this.buildTopicWorkspaceFolderChildren(index, workspaceFolder, schemaFilter);
    }
    return this.buildLegacyWorkspaceFolderChildren(index, workspaceFolder, schemaFilter);
  }

  private buildFolderChildren(index: TraceableStructureIndex, workspaceFolderPath: string, folderPath: string, schemaFilter: Set<string>): TraceableStructureTreeItem[] {
    const workspaceFolder = getWorkspaceFolders().find((candidate) => normalizePathKey(candidate.fsPath) === normalizePathKey(workspaceFolderPath)) ?? {
      name: path.basename(workspaceFolderPath),
      fsPath: workspaceFolderPath
    };
    if (hasTopicRoots(index, workspaceFolder.fsPath)) {
      return this.buildTopicFolderChildren(index, workspaceFolder, folderPath, schemaFilter);
    }
    return this.buildLegacyFolderChildren(index, workspaceFolderPath, folderPath, schemaFilter);
  }

  private buildTopicWorkspaceFolderChildren(index: TraceableStructureIndex, workspaceFolder: TraceableStructureWorkspaceFolder, schemaFilter: Set<string>): TraceableStructureTreeItem[] {
    const forest = collectTopicFolderForest(index, workspaceFolder.fsPath, schemaFilter, this.state.leavesOnly, this.state.timeFilterBasis, this.state.timeFilterPreset);
    const rootFolderPaths = this.sortTopicFolderPaths(index, workspaceFolder, forest, forest.rootFolderPaths, schemaFilter)
      .slice(this.state.offset, this.state.offset + this.state.maxItems);
    const items = rootFolderPaths
      .map((folderPath) => this.createTopicFolderItem(index, workspaceFolder, folderPath, forest, schemaFilter, this.state.leavesOnly, false));

    const footer = paginationInfoLabel({ total: forest.rootFolderPaths.length, offset: this.state.offset, items });
    if (footer) {
      items.push(this.createInfoItem("Pagination", footer, "Increase max items or change the offset to see more topic roots."));
    }

    if (items.length === 0) {
      items.push(this.createInfoItem("No traceable structure", workspaceFolder.name, "No matching .trace.md artifacts were found under this workspace folder."));
    }

    return items;
  }

  private buildLegacyWorkspaceFolderChildren(index: TraceableStructureIndex, workspaceFolder: TraceableStructureWorkspaceFolder, schemaFilter: Set<string>): TraceableStructureTreeItem[] {
    const folderSummaries = collectFolderSummaries(index, workspaceFolder, schemaFilter, this.state.leavesOnly, this.state.sortMode, this.state.timeFilterBasis, this.state.timeFilterPreset);
    const pagination = paginateEntries(folderSummaries, this.state.offset, this.state.maxItems);
    const items = pagination.items.map((summary) => this.createFolderItem(workspaceFolder, summary.folderPath, false, summary.nodes.length, summary.latestModifiedAt));

    const footer = paginationInfoLabel(pagination);
    if (footer) {
      items.push(this.createInfoItem("Pagination", footer, "Increase max items or change the offset to see more folders."));
    }

    if (this.state.detailLevel === "full") {
      if (this.state.includeSchemas) {
        const schemaEntries = collectVisibleSchemaEntries(index, workspaceFolder.fsPath, schemaFilter);
        if (schemaEntries.length > 0) {
          items.push(this.createGroupItem("Schema notes", formatCount(schemaEntries.length, "note"), schemaEntries.map((entry) => this.createSchemaItem(entry))));
        }
      }

      const nodes = [...index.nodesByPathKey.values()]
        .filter((node) => normalizePathKey(node.workspaceFolderPath) === normalizePathKey(workspaceFolder.fsPath))
        .filter((node) => matchesSchemaFilterForNode(node, schemaFilter))
        .filter((node) => matchesNodeTimeFilter(node, this.state.timeFilterBasis, this.state.timeFilterPreset))
        .filter((node) => !this.state.leavesOnly || !hasVisibleChild(node, index, schemaFilter, this.state.timeFilterBasis, this.state.timeFilterPreset));
      const gapNodes = collectTraceableStructureGaps(nodes);
      if (gapNodes.length > 0) {
        items.push(this.createGroupItem("Suspicious gaps", formatCount(gapNodes.length, "gap"), gapNodes.map((gap) => this.createGapItem(gap))));
      }
    }

    if (items.length === 0) {
      items.push(this.createInfoItem("No traceable structure", workspaceFolder.name, "No trace or schema items matched the current filters."));
    }

    return items;
  }

  private buildTopicFolderChildren(index: TraceableStructureIndex, workspaceFolder: TraceableStructureWorkspaceFolder, folderPath: string, schemaFilter: Set<string>): TraceableStructureTreeItem[] {
    const forest = collectTopicFolderForest(index, workspaceFolder.fsPath, schemaFilter, this.state.leavesOnly, this.state.timeFilterBasis, this.state.timeFilterPreset);
    const childFolderPaths = this.sortTopicFolderPaths(index, workspaceFolder, forest, forest.childrenByParentPath.get(folderPath) ?? [], schemaFilter);
    const childFolderItems = childFolderPaths
      .slice(this.state.offset, this.state.offset + this.state.maxItems)
      .map((childFolderPath) => this.createTopicFolderItem(index, workspaceFolder, childFolderPath, forest, schemaFilter, this.state.leavesOnly, false));

    const directTraceItems = collectVisibleNodesInFolder(index, workspaceFolder.fsPath, folderPath, schemaFilter, this.state.leavesOnly, this.state.sortMode, this.state.timeFilterBasis, this.state.timeFilterPreset)
      .map((node) => this.createTraceNodeItem(node));

    const items: TraceableStructureTreeItem[] = [...childFolderItems, ...directTraceItems];

    if (items.length === 0) {
      return [];
    }

    const footer = paginationInfoLabel({ total: childFolderPaths.length, offset: this.state.offset, items: childFolderItems });
    if (footer) {
      items.push(this.createInfoItem("Pagination", footer, `Showing nested topic roots under ${formatFolderLabel(folderPath, workspaceFolder)}.`));
    }

    return items;
  }

  private buildLegacyFolderChildren(index: TraceableStructureIndex, workspaceFolderPath: string, folderPath: string, schemaFilter: Set<string>): TraceableStructureTreeItem[] {
    const workspaceFolder = getWorkspaceFolders().find((candidate) => normalizePathKey(candidate.fsPath) === normalizePathKey(workspaceFolderPath)) ?? {
      name: path.basename(workspaceFolderPath),
      fsPath: workspaceFolderPath
    };

    const folderNodes = collectVisibleNodesInFolder(index, workspaceFolderPath, folderPath, schemaFilter, this.state.leavesOnly, this.state.sortMode, this.state.timeFilterBasis, this.state.timeFilterPreset);
    const pagination = paginateEntries(folderNodes, this.state.offset, this.state.maxItems);
    const items = pagination.items.map((node) => this.createTraceNodeItem(node));

    const footer = paginationInfoLabel(pagination);
    if (footer) {
      items.push(this.createInfoItem("Pagination", footer, `Showing a bounded slice of trace nodes in ${formatFolderLabel(folderPath, workspaceFolder)}.`));
    }

    if (items.length === 0) {
      items.push(this.createInfoItem("No matching traceable structure", formatFolderLabel(folderPath, workspaceFolder), "No trace or schema items matched the current filters."));
    }

    return items;
  }

  private buildTraceNodeChildren(index: TraceableStructureIndex, nodePathKey: string, schemaFilter: Set<string>): TraceableStructureTreeItem[] {
    const node = index.nodesByPathKey.get(nodePathKey);
    if (!node) {
      return [this.createInfoItem("Missing trace", nodePathKey, "The selected trace could not be found in the current structure index.")];
    }

    const items: TraceableStructureTreeItem[] = [];
    const continuity = this.getTraceNodeContinuitySummary(node);
    const parentChain = buildTraceableStructureParentChain(node, index.nodesByPathKey)
      .filter((candidate) => matchesSchemaFilterForNode(candidate, schemaFilter))
      .filter((candidate) => matchesNodeTimeFilter(candidate, this.state.timeFilterBasis, this.state.timeFilterPreset));
    if (parentChain.length > 0) {
      const upstreamGroup = this.createGroupItem("Upstream", `${continuity.chainStatus} · ${formatCount(parentChain.length, "node")}`, parentChain.map((candidate) => this.createTraceNodeItem(candidate)), false, continuity.tooltip);
      upstreamGroup.iconPath = continuity.severity === "error"
        ? new vscode.ThemeIcon("error")
        : continuity.severity === "warning"
          ? new vscode.ThemeIcon("warning")
          : new vscode.ThemeIcon("arrow-up");
      items.push(upstreamGroup);
    }

    const directChildren = collectVisibleChildNodes(index, node, schemaFilter, this.state.leavesOnly, this.state.sortMode, this.state.timeFilterBasis, this.state.timeFilterPreset);
    if (directChildren.length > 0) {
      const downstreamGroup = this.createGroupItem("Downstream", formatCount(directChildren.length, "node"), directChildren.map((candidate) => this.createTraceNodeItem(candidate)), false, `Direct downstream traces from ${node.displayPath}`);
      downstreamGroup.iconPath = new vscode.ThemeIcon("arrow-down");
      items.push(downstreamGroup);
    }

    if (this.state.detailLevel === "full") {
      const folderNodes = collectVisibleNodesInFolder(index, node.workspaceFolderPath, node.folderPath, schemaFilter, this.state.leavesOnly, this.state.sortMode, this.state.timeFilterBasis, this.state.timeFilterPreset);
      const gapNodes = collectTraceableStructureGaps(folderNodes);
      if (gapNodes.length > 0) {
        items.push(this.createGroupItem("Suspicious gaps", formatCount(gapNodes.length, "gap"), gapNodes.map((gap) => this.createGapItem(gap))));
      }
    }

    return items;
  }

  private createSectionItem(label: string, description: string, children: TraceableStructureTreeItem[]): TraceableStructureTreeItem {
    return new TraceableStructureTreeItem(label, vscode.TreeItemCollapsibleState.Expanded, { kind: "section", children }, description, description);
  }

  private createGroupItem(label: string, description: string, children: TraceableStructureTreeItem[], expanded = false, tooltip?: string): TraceableStructureTreeItem {
    return new TraceableStructureTreeItem(label, expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed, { kind: "group", children }, description, tooltip ?? description);
  }

  private createInfoItem(label: string, description: string, tooltip: string): TraceableStructureTreeItem {
    return new TraceableStructureTreeItem(label, vscode.TreeItemCollapsibleState.None, { kind: "info" }, description, tooltip);
  }

  private createActionItem(label: string, description: string | undefined, tooltip: string, commandId: string, args?: unknown[]): TraceableStructureTreeItem {
    return new TraceableStructureTreeItem(label, vscode.TreeItemCollapsibleState.None, { kind: "action" }, description, tooltip, createActionCommand(commandId, label, args));
  }

  private createChoiceItem(label: string, active: boolean, tooltip: string, commandId: string, args?: unknown[]): TraceableStructureTreeItem {
    const item = this.createActionItem(label, active ? "current" : undefined, tooltip, commandId, args);
    item.iconPath = new vscode.ThemeIcon(active ? "check" : "circle-outline");
    return item;
  }

  private createWorkspaceFolderItem(summary: WorkspaceFolderSummary): TraceableStructureTreeItem {
    const description = [
      formatCount(summary.folderCount, "folder"),
      formatCount(summary.traceCount, "trace"),
      summary.schemaCount > 0 ? formatCount(summary.schemaCount, "schema") : undefined,
      summary.gapCount > 0 ? formatCount(summary.gapCount, "gap") : undefined,
      Number.isFinite(summary.sortTimestamp) ? formatTimestamp(summary.sortTimestamp) : undefined
    ].filter(Boolean).join(" · ");

    return new TraceableStructureTreeItem(summary.workspaceFolder.name, vscode.TreeItemCollapsibleState.Collapsed, {
      kind: "workspace-folder",
      workspaceFolderPath: summary.workspaceFolder.fsPath,
      modifiedAt: summary.latestModifiedAt
    }, description, `Workspace folder: ${summary.workspaceFolder.fsPath}`);
  }

  private createFolderItem(workspaceFolder: TraceableStructureWorkspaceFolder, folderPath: string, expanded = false, traceCount?: number, latestModifiedAt?: number): TraceableStructureTreeItem {
    const description = [
      typeof traceCount === "number" ? formatCount(traceCount, "trace") : undefined,
      typeof latestModifiedAt === "number" && latestModifiedAt > 0 ? formatTimestamp(latestModifiedAt) : undefined
    ].filter(Boolean).join(" · ");

    return new TraceableStructureTreeItem(formatFolderLabel(folderPath, workspaceFolder), expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed, {
      kind: "folder",
      workspaceFolderPath: workspaceFolder.fsPath,
      folderPath,
      modifiedAt: latestModifiedAt
    }, description, `Folder: ${folderPath}`);
  }

  private createTopicFolderItem(
    index: TraceableStructureIndex,
    workspaceFolder: TraceableStructureWorkspaceFolder,
    folderPath: string,
    forest: TraceableStructureTopicFolderForest,
    schemaFilter: Set<string>,
    leavesOnly: boolean,
    expanded: boolean
  ): TraceableStructureTreeItem {
    const latestModifiedAt = forest.latestModifiedAtByFolderPath.get(folderPath) ?? 0;
    const directTopicNodes = collectVisibleNodesInFolder(index, workspaceFolder.fsPath, folderPath, schemaFilter, leavesOnly, this.state.sortMode, this.state.timeFilterBasis, this.state.timeFilterPreset);
    const childFolderCount = (forest.childrenByParentPath.get(folderPath) ?? []).length;
    const sortTimestamp = this.getTopicFolderSortTimestamp(index, workspaceFolder, forest, folderPath, schemaFilter);
    const description = [
      directTopicNodes.length > 0 ? formatCount(directTopicNodes.length, "trace") : undefined,
      childFolderCount > 0 ? formatCount(childFolderCount, "subtopic") : undefined,
      Number.isFinite(sortTimestamp) ? formatTimestamp(sortTimestamp) : latestModifiedAt > 0 ? formatTimestamp(latestModifiedAt) : undefined
    ].filter(Boolean).join(" · ");

    return new TraceableStructureTreeItem(formatTopicFolderLabel(folderPath), childFolderCount > 0 || directTopicNodes.length > 0 ? (expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed) : vscode.TreeItemCollapsibleState.None, {
      kind: "folder",
      workspaceFolderPath: workspaceFolder.fsPath,
      folderPath,
      modifiedAt: latestModifiedAt
    }, description, `Topic folder: ${folderPath}`);
  }

  private createTraceNodeItem(node: TraceableStructureNode, expanded = false): TraceableStructureTreeItem {
    const status = this.state.detailLevel === "compact" ? vscode.TreeItemCollapsibleState.Collapsed : expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
    const continuity = this.getTraceNodeContinuitySummary(node);
    const label = truncateTreeLabel(node.displaySummary?.trim() || node.parsedFileName.lineageLabel);
    const description = [
      node.currentSchemaId ?? "unknown",
      this.state.viewMode === "list" ? summarizeTracePath(node) : undefined,
      formatTimestamp(getNodeSortTimestamp(node, this.state.sortMode))
    ].filter(Boolean).join(" · ");
    const tooltip = [
      summarizeTraceNode(node),
      `Continuity: ${continuity.chainStatus}`,
      `Direct status: ${continuity.directStatus}`,
      `Traversal: ${continuity.chainNodeCount} nodes | ${continuity.stoppedBecause}`,
      node.currentCreatedAt ? `Created: ${node.currentCreatedAt}` : undefined
    ].filter(Boolean).join("\n");
    const item = new TraceableStructureTreeItem(label, status, {
      kind: "trace",
      workspaceFolderPath: node.workspaceFolderPath,
      nodePathKey: node.pathKey,
      targetPath: node.path,
      modifiedAt: node.modifiedAt,
      currentSchemaId: node.currentSchemaId
    }, description, tooltip);
    item.iconPath = continuity.severity === "error"
      ? new vscode.ThemeIcon("error")
      : continuity.severity === "warning"
        ? new vscode.ThemeIcon("warning")
        : getTraceSchemaIcon(node.currentSchemaId);
    return item;
  }

  private createSchemaItem(schemaEntry: TraceableStructureSchemaEntry): TraceableStructureTreeItem {
    return new TraceableStructureTreeItem(schemaEntry.id, vscode.TreeItemCollapsibleState.None, {
      kind: "schema",
      workspaceFolderPath: schemaEntry.workspaceFolderPath,
      targetPath: schemaEntry.path
    }, schemaEntry.displayPath, summarizeSchemaEntry(schemaEntry));
  }

  private createGapItem(gap: TraceableStructureGap): TraceableStructureTreeItem {
    return new TraceableStructureTreeItem(gap.missingLineageLabel, vscode.TreeItemCollapsibleState.None, {
      kind: "gap"
    }, `${gap.previousLabel ?? "-"} -> ${gap.nextLabel ?? "-"}`, summarizeGap(gap));
  }

  private sortTopicFolderPaths(
    index: TraceableStructureIndex,
    workspaceFolder: TraceableStructureWorkspaceFolder,
    forest: TraceableStructureTopicFolderForest,
    folderPaths: readonly string[],
    schemaFilter: Set<string>
  ): string[] {
    const cache = new Map<string, number>();
    return [...folderPaths].sort((left, right) => {
      return compareSortValues(
        this.getTopicFolderSortTimestamp(index, workspaceFolder, forest, left, schemaFilter, cache),
        this.getTopicFolderSortTimestamp(index, workspaceFolder, forest, right, schemaFilter, cache),
        this.state.sortMode
      ) || formatTopicFolderLabel(left).localeCompare(formatTopicFolderLabel(right));
    });
  }

  private getTopicFolderSortTimestamp(
    index: TraceableStructureIndex,
    workspaceFolder: TraceableStructureWorkspaceFolder,
    forest: TraceableStructureTopicFolderForest,
    folderPath: string,
    schemaFilter: Set<string>,
    cache = new Map<string, number>()
  ): number {
    const cached = cache.get(folderPath);
    if (typeof cached === "number") {
      return cached;
    }
    const directNodes = collectVisibleNodesInFolder(
      index,
      workspaceFolder.fsPath,
      folderPath,
      schemaFilter,
      this.state.leavesOnly,
      this.state.sortMode,
      this.state.timeFilterBasis,
      this.state.timeFilterPreset
    );
    const descendantValues = (forest.childrenByParentPath.get(folderPath) ?? []).map((childFolderPath) => {
      return this.getTopicFolderSortTimestamp(index, workspaceFolder, forest, childFolderPath, schemaFilter, cache);
    });
    const directValues = directNodes.map((node) => getNodeSortTimestamp(node, this.state.sortMode) ?? normalizeSortTimestamp(undefined, this.state.sortMode));
    const sortTimestamp = resolveRepresentativeTimestamp([...directValues, ...descendantValues], this.state.sortMode);
    cache.set(folderPath, sortTimestamp);
    return sortTimestamp;
  }

  private getTraceNodeContinuitySummary(node: TraceableStructureNode): TraceNodeContinuitySummary {
    const cached = this.continuitySummaryByPathKey.get(node.pathKey);
    if (cached) {
      return cached;
    }

    try {
      const validation = validateTraceableContinuityArtifactChainSync({
        filePath: node.path,
        maxDepth: 9000,
        workspaceRoots: vscode.workspace.workspaceFolders?.map((folder) => ({
          name: folder.name,
          fsPath: folder.uri.fsPath
        }))
      });
      const rootNode = validation.nodes[0];
      const integrity = rootNode?.traceableParentIntegrity;
      const directStatus = integrity?.status ?? rootNode?.continuityIntegrity?.status ?? "unknown";
      const chainBroken = validation.stoppedBecause !== "complete" && validation.stoppedBecause !== "max-depth";
      const directMismatch = !(directStatus === "ok" || directStatus === "disabled" || directStatus === "legacy-no-checksum");
      const severity: TraceNodeContinuitySummary["severity"] = chainBroken ? "error" : directMismatch ? "warning" : (directStatus === "disabled" || directStatus === "legacy-no-checksum" || validation.stoppedBecause === "max-depth") ? "info" : "ok";
      const chainStatus = chainBroken
        ? `broken at ${validation.nodes.length}`
        : validation.stoppedBecause === "max-depth"
          ? `depth limited at ${validation.nodes.length}`
          : directStatus === "ok"
            ? "verified"
            : directStatus === "disabled" || directStatus === "legacy-no-checksum"
              ? "unverified"
              : "needs review";
      const tooltip = [
        `Path: ${node.path}`,
        `Continuity: ${chainStatus}`,
        `Direct status: ${directStatus}`,
        `Traversal: ${validation.nodes.length} nodes`,
        `Stopped because: ${validation.stoppedBecause}`,
        integrity?.resolvedParentTracePath ? `Resolved parent: ${integrity.resolvedParentTracePath}` : undefined,
        integrity?.storedParentTraceChecksumSha256 ? `Stored parent checksum: ${integrity.storedParentTraceChecksumSha256}` : undefined,
        integrity?.actualParentTraceChecksumSha256 ? `Actual parent checksum: ${integrity.actualParentTraceChecksumSha256}` : undefined
      ].filter(Boolean).join("\n");
      const summary: TraceNodeContinuitySummary = {
        severity,
        directStatus,
        chainStatus,
        chainNodeCount: validation.nodes.length,
        stoppedBecause: validation.stoppedBecause,
        tooltip
      };
      this.continuitySummaryByPathKey.set(node.pathKey, summary);
      return summary;
    } catch (error) {
      const summary: TraceNodeContinuitySummary = {
        severity: "error",
        directStatus: "unavailable",
        chainStatus: "validation failed",
        chainNodeCount: 0,
        stoppedBecause: "error",
        tooltip: error instanceof Error ? error.message : "Traceable continuity validation failed"
      };
      this.continuitySummaryByPathKey.set(node.pathKey, summary);
      return summary;
    }
  }
}

export function registerTraceableStructureTreeView(context: vscode.ExtensionContext): vscode.Disposable[] {
  const controller = new TraceableStructureTreeController(context);
  void syncTraceableCreateMenuContexts(undefined);
  const view = vscode.window.createTreeView(TRACEABLE_STRUCTURE_VIEW_ID, {
    treeDataProvider: controller,
    showCollapseAll: true
  });

  view.onDidChangeSelection((event) => {
    const selectedItem = event.selection[0];
    if (!selectedItem) {
      currentTraceableStructureSelection = undefined;
      void syncTraceableCreateMenuContexts(undefined);
      return;
    }
    if (selectedItem.data.kind === "trace") {
      currentTraceableStructureSelection = {
        kind: "trace",
        workspaceFolderPath: selectedItem.data.workspaceFolderPath,
        nodePathKey: selectedItem.data.nodePathKey,
        currentSchemaId: selectedItem.data.currentSchemaId
      };
      void syncTraceableCreateMenuContexts(selectedItem.data.currentSchemaId);
      return;
    }
    if (selectedItem.data.kind === "folder") {
      currentTraceableStructureSelection = {
        kind: "folder",
        workspaceFolderPath: selectedItem.data.workspaceFolderPath,
        folderPath: selectedItem.data.folderPath
      };
      void syncTraceableCreateMenuContexts(undefined);
      return;
    }
    if (selectedItem.data.kind === "workspace-folder") {
      currentTraceableStructureSelection = {
        kind: "workspace-folder",
        workspaceFolderPath: selectedItem.data.workspaceFolderPath,
        folderPath: selectedItem.data.workspaceFolderPath
      };
      void syncTraceableCreateMenuContexts(undefined);
      return;
    }
    currentTraceableStructureSelection = undefined;
    void syncTraceableCreateMenuContexts(undefined);
  });

  const disposables: vscode.Disposable[] = [view, controller];
  disposables.push(
    vscode.commands.registerCommand(TRACEABLE_STRUCTURE_REFRESH_COMMAND, async () => {
      await controller.refresh(true);
    }),
    vscode.commands.registerCommand(TRACEABLE_STRUCTURE_CONFIGURE_COMMAND, async () => {
      await controller.configure();
    }),
    vscode.commands.registerCommand(TRACEABLE_STRUCTURE_TOGGLE_TREE_VIEW_COMMAND, async (treeView?: boolean) => {
      await controller.toggleTreeView(typeof treeView === "boolean" ? treeView : undefined);
    }),
    vscode.commands.registerCommand(TRACEABLE_STRUCTURE_SET_TREE_VIEW_COMMAND, async () => {
      await controller.setViewMode("tree");
    }),
    vscode.commands.registerCommand(TRACEABLE_STRUCTURE_SET_LIST_VIEW_COMMAND, async () => {
      await controller.setViewMode("list");
    }),
    vscode.commands.registerCommand(TRACEABLE_STRUCTURE_SET_SORT_MODE_COMMAND, async (sortMode?: TraceableStructureSortMode) => {
      if (sortMode === "modified-desc" || sortMode === "modified-asc" || sortMode === "created-desc" || sortMode === "created-asc") {
        await controller.setSortMode(sortMode);
        return;
      }
      await controller.promptAndSetSortMode();
    }),
    vscode.commands.registerCommand(TRACEABLE_STRUCTURE_TOGGLE_LEAVES_ONLY_COMMAND, async (leavesOnly?: boolean) => {
      if (typeof leavesOnly === "boolean") {
        const state = controller.getState();
        if (state.leavesOnly !== leavesOnly) {
          await controller.toggleLeavesOnly(leavesOnly);
        }
        return;
      }
      await controller.toggleLeavesOnly();
    }),
    vscode.commands.registerCommand(TRACEABLE_STRUCTURE_SHOW_ALL_TOPICS_COMMAND, async () => {
      await controller.setLeavesOnly(false);
    }),
    vscode.commands.registerCommand(TRACEABLE_STRUCTURE_SHOW_LEAF_TOPICS_COMMAND, async () => {
      await controller.setLeavesOnly(true);
    }),
    vscode.commands.registerCommand(TRACEABLE_STRUCTURE_TOGGLE_INCLUDE_SCHEMAS_COMMAND, async () => {
      await controller.toggleIncludeSchemas();
    }),
    vscode.commands.registerCommand(TRACEABLE_STRUCTURE_SHOW_SCHEMA_NOTES_COMMAND, async () => {
      await controller.setIncludeSchemas(true);
    }),
    vscode.commands.registerCommand(TRACEABLE_STRUCTURE_HIDE_SCHEMA_NOTES_COMMAND, async () => {
      await controller.setIncludeSchemas(false);
    }),
    vscode.commands.registerCommand(TRACEABLE_STRUCTURE_SET_DETAIL_LEVEL_COMMAND, async (detailLevel?: TraceableStructureDetailLevel) => {
      if (detailLevel === "compact" || detailLevel === "standard" || detailLevel === "full") {
        await controller.setDetailLevel(detailLevel);
        return;
      }
      const selection = await vscode.window.showQuickPick([
        { label: "Compact", value: "compact" as const },
        { label: "Standard", value: "standard" as const },
        { label: "Full", value: "full" as const }
      ], { title: "Traceable Structure Detail Level" });
      if (selection) {
        await controller.setDetailLevel(selection.value);
      }
    }),
    vscode.commands.registerCommand(TRACEABLE_STRUCTURE_SET_DETAIL_COMPACT_COMMAND, async () => {
      await controller.setDetailLevel("compact");
    }),
    vscode.commands.registerCommand(TRACEABLE_STRUCTURE_SET_DETAIL_STANDARD_COMMAND, async () => {
      await controller.setDetailLevel("standard");
    }),
    vscode.commands.registerCommand(TRACEABLE_STRUCTURE_SET_DETAIL_FULL_COMMAND, async () => {
      await controller.setDetailLevel("full");
    }),
    vscode.commands.registerCommand(TRACEABLE_STRUCTURE_SET_TARGET_PATH_COMMAND, async (targetPath?: string) => {
      if (typeof targetPath === "string" && targetPath.trim()) {
        const resolvedTargetPath = await resolveTargetPath(targetPath, getWorkspaceFolders());
        if (!resolvedTargetPath) {
          void vscode.window.showErrorMessage(`Could not resolve ${JSON.stringify(targetPath)} to an existing folder or .trace.md artifact.`);
          return;
        }
        await controller.setTargetPath(resolvedTargetPath);
        return;
      }
      await controller.promptAndSetTargetPath();
    }),
    vscode.commands.registerCommand(TRACEABLE_STRUCTURE_CLEAR_TARGET_PATH_COMMAND, async () => {
      await controller.clearTargetPath();
    }),
    vscode.commands.registerCommand(TRACEABLE_STRUCTURE_SET_SCHEMA_FILTER_COMMAND, async (schemaFilterText?: string) => {
      if (typeof schemaFilterText === "string") {
        await controller.setSchemaFilter(schemaFilterText);
        return;
      }
      await controller.promptAndSetSchemaFilter();
    }),
    vscode.commands.registerCommand(TRACEABLE_STRUCTURE_CLEAR_SCHEMA_FILTER_COMMAND, async () => {
      await controller.clearSchemaFilter();
    }),
    vscode.commands.registerCommand(TRACEABLE_STRUCTURE_SET_MAX_ITEMS_COMMAND, async (maxItems?: number) => {
      if (typeof maxItems === "number" && Number.isFinite(maxItems)) {
        await controller.setMaxItems(maxItems);
        return;
      }
      await controller.promptAndSetMaxItems();
    }),
    vscode.commands.registerCommand(TRACEABLE_STRUCTURE_SET_OFFSET_COMMAND, async (offset?: number) => {
      if (typeof offset === "number" && Number.isFinite(offset)) {
        await controller.setOffset(offset);
        return;
      }
      await controller.promptAndSetOffset();
    }),
    vscode.commands.registerCommand(TRACEABLE_STRUCTURE_OPEN_MARKDOWN_COMMAND, async (item?: TraceableStructureTreeItem | { data?: { targetPath?: string } } | string) => {
      const targetPath = typeof item === "string"
        ? item
        : item?.data?.targetPath;
      if (!targetPath) {
        void vscode.window.showErrorMessage("Open Trace requires a selected trace or schema note.");
        return;
      }
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(targetPath));
      await vscode.window.showTextDocument(document, { preview: false });
    }),
    ...TRACEABLE_STRUCTURE_SORT_COMMANDS.map((entry) => vscode.commands.registerCommand(entry.command, async () => {
      await controller.setSortMode(entry.sortMode);
    })),
    ...TRACEABLE_STRUCTURE_TIME_FILTER_COMMANDS.map((entry) => vscode.commands.registerCommand(entry.command, async () => {
      if (entry.basis === "none") {
        await controller.setTimeFilter("none");
        return;
      }
      await controller.setTimeFilter(entry.basis, entry.preset);
    }))
  );

  return disposables;
}
