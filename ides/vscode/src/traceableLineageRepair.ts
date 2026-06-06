import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const TRACE_FILE_SUFFIX = ".trace.md";
const SKIPPED_DIRECTORY_NAMES = new Set([".git", "dist", "node_modules"]);
const LOCAL_TARGET_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//iu;
const DEFAULT_COMMIT_MESSAGE_PREFIX = "Repair trace lineage";

type ParseSchemaNoteMarkdown = (markdown: string) => {
  footerIntegrity?: unknown;
};

export interface TraceableLineageRepairInput {
  repoRoot: string;
  targets: string[];
  autoCommit?: boolean;
  commitMessagePrefix?: string;
  maxIterations?: number;
}

export interface TraceableLineageRepairEntry {
  filePath: string;
  parentChecksumUpdated?: boolean;
  footerChecksumUpdated?: boolean;
  changed?: boolean;
  checksum?: string;
  blocked?: boolean;
  reason?: string;
  dependencyPath?: string;
}

export interface TraceableLineageRepairResult {
  tool: "repair-trace-lineage";
  repoRoot: string;
  startFileCount: number;
  componentFileCount: number;
  iterationCount: number;
  commitCount: number;
  autoCommit: boolean;
  blockedCount: number;
  blockedEntries: TraceableLineageRepairEntry[];
  dirtyFileCount: number;
  dirtyFiles: string[];
  refreshEntries: TraceableLineageRepairEntry[];
}

function normalizeComparableFsPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function resolveTraceableLineageRepairGitRoot(startPath: string): string | undefined {
  let currentPath = path.resolve(startPath);
  while (true) {
    if (existsSync(path.join(currentPath, ".git"))) {
      return currentPath;
    }
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return undefined;
    }
    currentPath = parentPath;
  }
}

function collectTraceFiles(targetPath: string): string[] {
  const absolutePath = path.resolve(targetPath);
  const stats = statSync(absolutePath);
  if (stats.isFile()) {
    return absolutePath.endsWith(TRACE_FILE_SUFFIX) ? [absolutePath] : [];
  }
  if (!stats.isDirectory()) {
    return [];
  }

  const collected: string[] = [];
  for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIPPED_DIRECTORY_NAMES.has(entry.name)) {
      continue;
    }
    const entryPath = path.join(absolutePath, entry.name);
    if (entry.isDirectory()) {
      collected.push(...collectTraceFiles(entryPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(TRACE_FILE_SUFFIX)) {
      collected.push(entryPath);
    }
  }
  return collected;
}

function collectRepoTraceFiles(repoRoot: string): string[] {
  return collectTraceFiles(repoRoot).sort();
}

function extractTraceableState(markdown: string): { parentTracePath?: string } {
  const match = markdown.match(/## Traceable State\s+```json\s*\r?\n([\s\S]*?)\r?\n```/u);
  if (!match) {
    return {};
  }
  try {
    const parsed = JSON.parse(match[1]);
    const result = parsed?.result ?? {};
    return {
      parentTracePath: typeof result.parentTracePath === "string" && result.parentTracePath.trim()
        ? result.parentTracePath.trim()
        : undefined
    };
  } catch {
    return {};
  }
}

function resolveLocalTraceTarget(sourcePath: string, target: string | undefined): string | undefined {
  const trimmed = typeof target === "string" ? target.trim() : "";
  if (!trimmed || trimmed === "self" || LOCAL_TARGET_PATTERN.test(trimmed)) {
    return undefined;
  }
  const resolvedTargetPath = path.resolve(path.dirname(sourcePath), trimmed);
  return resolvedTargetPath.endsWith(TRACE_FILE_SUFFIX) ? resolvedTargetPath : undefined;
}

function collectTraceDependencies(
  filePath: string,
  normalizedFileSet: Set<string>,
  parseSchemaNoteMarkdown: ParseSchemaNoteMarkdown
): string[] {
  const markdown = readFileSync(filePath, "utf8");
  const dependencies = new Set<string>();
  const traceableState = extractTraceableState(markdown);
  const parentTraceDependency = resolveLocalTraceTarget(filePath, traceableState.parentTracePath);
  if (parentTraceDependency && normalizedFileSet.has(normalizeComparableFsPath(parentTraceDependency))) {
    dependencies.add(path.resolve(parentTraceDependency));
  }

  const footerIntegrity = parseSchemaNoteMarkdown(markdown).footerIntegrity;
  const footerTarget = typeof footerIntegrity === "object"
    && footerIntegrity !== null
    && typeof (footerIntegrity as { towardsTarget?: unknown }).towardsTarget === "string"
    ? (footerIntegrity as { towardsTarget: string }).towardsTarget.trim()
    : undefined;
  const footerDependency = resolveLocalTraceTarget(filePath, footerTarget);
  if (footerDependency && normalizedFileSet.has(normalizeComparableFsPath(footerDependency))) {
    dependencies.add(path.resolve(footerDependency));
  }
  return [...dependencies].sort();
}

function buildTraceGraph(repoRoot: string, parseSchemaNoteMarkdown: ParseSchemaNoteMarkdown) {
  const repoTraceFiles = collectRepoTraceFiles(repoRoot).map((filePath) => path.resolve(filePath));
  const normalizedFileSet = new Set(repoTraceFiles.map((filePath) => normalizeComparableFsPath(filePath)));
  const dependenciesByFile = new Map<string, Set<string>>();
  const dependentsByFile = new Map<string, Set<string>>();
  for (const filePath of repoTraceFiles) {
    dependenciesByFile.set(filePath, new Set());
    dependentsByFile.set(filePath, new Set());
  }
  for (const filePath of repoTraceFiles) {
    const dependencies = collectTraceDependencies(filePath, normalizedFileSet, parseSchemaNoteMarkdown);
    for (const dependencyPath of dependencies) {
      dependenciesByFile.get(filePath)?.add(dependencyPath);
      dependentsByFile.get(dependencyPath)?.add(filePath);
    }
  }
  return { dependenciesByFile, dependentsByFile };
}

function collectStartTraceFiles(targets: readonly string[]): string[] {
  return [...new Set(targets.flatMap((targetPath) => collectTraceFiles(targetPath).map((filePath) => path.resolve(filePath))))].sort();
}

function collectLineageComponent(
  startFiles: readonly string[],
  dependenciesByFile: Map<string, Set<string>>,
  dependentsByFile: Map<string, Set<string>>
): string[] {
  const queue = [...startFiles];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const currentPath = queue.shift();
    if (!currentPath || visited.has(currentPath)) {
      continue;
    }
    visited.add(currentPath);
    for (const dependencyPath of dependenciesByFile.get(currentPath) ?? []) {
      if (!visited.has(dependencyPath)) {
        queue.push(dependencyPath);
      }
    }
    for (const dependentPath of dependentsByFile.get(currentPath) ?? []) {
      if (!visited.has(dependentPath)) {
        queue.push(dependentPath);
      }
    }
  }
  return [...visited].sort();
}

function chunkArray<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function getDirtyTrackedFiles(repoRoot: string, filePaths: readonly string[]): string[] {
  const dirtyFiles = new Set<string>();
  const relativePaths = filePaths
    .map((filePath) => path.relative(repoRoot, filePath))
    .filter((relativePath) => relativePath && !relativePath.startsWith(".."));
  for (const pathChunk of chunkArray(relativePaths, 100)) {
    if (pathChunk.length === 0) {
      continue;
    }
    const statusOutput = execFileSync("git", ["-C", repoRoot, "status", "--porcelain", "--", ...pathChunk], { encoding: "utf8" });
    for (const rawLine of statusOutput.split(/\r?\n/u)) {
      const line = rawLine.trimEnd();
      if (!line) {
        continue;
      }
      let relativePath = line.slice(3);
      if (relativePath.includes(" -> ")) {
        relativePath = relativePath.split(" -> ").at(-1) ?? relativePath;
      }
      dirtyFiles.add(path.resolve(repoRoot, relativePath));
    }
  }
  return [...dirtyFiles].sort();
}

function parseRefreshOutput(output: string): TraceableLineageRepairEntry[] {
  const entries: TraceableLineageRepairEntry[] = [];
  for (const rawLine of output.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line.startsWith("{")) {
      continue;
    }
    try {
      entries.push(JSON.parse(line));
    } catch {
      continue;
    }
  }
  return entries;
}

function runRefreshPass(refreshScriptPath: string, repoRoot: string, filePaths: readonly string[]) {
  const result = spawnSync(process.execPath, [refreshScriptPath, ...filePaths], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  if (result.error) {
    throw result.error;
  }
  const entries = parseRefreshOutput(result.stdout ?? "");
  if (result.status && result.status !== 2) {
    throw new Error((result.stderr || result.stdout || `refresh-traceable-continuity-integrity failed with code ${result.status}`).trim());
  }
  return {
    exitCode: result.status ?? 0,
    entries
  };
}

function commitFiles(repoRoot: string, filePaths: readonly string[], message: string): void {
  if (filePaths.length === 0) {
    return;
  }
  const relativePaths = filePaths.map((filePath) => path.relative(repoRoot, filePath));
  execFileSync("git", ["-C", repoRoot, "add", "--", ...relativePaths], { stdio: "ignore" });
  execFileSync("git", ["-C", repoRoot, "commit", "-m", message], { stdio: "ignore" });
}

function createSummary(input: Omit<TraceableLineageRepairResult, "tool">): TraceableLineageRepairResult {
  return {
    tool: "repair-trace-lineage",
    ...input
  };
}

export async function runTraceableLineageRepair(
  input: TraceableLineageRepairInput,
  dependencies: {
    refreshScriptPath: string;
    parseSchemaNoteMarkdown: ParseSchemaNoteMarkdown;
  }
): Promise<TraceableLineageRepairResult> {
  const repoRoot = path.resolve(input.repoRoot);
  const startFiles = collectStartTraceFiles(input.targets.map((targetPath) => path.resolve(targetPath)));
  if (startFiles.length === 0) {
    throw new Error("No .trace.md files were found under the requested targets.");
  }
  const { dependenciesByFile, dependentsByFile } = buildTraceGraph(repoRoot, dependencies.parseSchemaNoteMarkdown);
  const componentFiles = collectLineageComponent(startFiles, dependenciesByFile, dependentsByFile);
  const autoCommit = input.autoCommit === true;
  const commitMessagePrefix = input.commitMessagePrefix?.trim() || DEFAULT_COMMIT_MESSAGE_PREFIX;
  const maxIterations = Number.isInteger(input.maxIterations) && (input.maxIterations ?? 0) > 0 ? (input.maxIterations as number) : 64;
  let commitCount = 0;

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const refreshResult = runRefreshPass(dependencies.refreshScriptPath, repoRoot, componentFiles);
    const dirtyFiles = getDirtyTrackedFiles(repoRoot, componentFiles);
    const blockedEntries = refreshResult.entries.filter((entry) => entry?.blocked);
    if (blockedEntries.length === 0) {
      if (autoCommit && dirtyFiles.length > 0) {
        commitCount += 1;
        commitFiles(repoRoot, dirtyFiles, `${commitMessagePrefix} finalize ${commitCount}`);
      }
      return createSummary({
        repoRoot,
        startFileCount: startFiles.length,
        componentFileCount: componentFiles.length,
        iterationCount: iteration,
        commitCount,
        autoCommit,
        blockedCount: blockedEntries.length,
        blockedEntries,
        dirtyFileCount: dirtyFiles.length,
        dirtyFiles,
        refreshEntries: refreshResult.entries
      });
    }

    if (!autoCommit) {
      return createSummary({
        repoRoot,
        startFileCount: startFiles.length,
        componentFileCount: componentFiles.length,
        iterationCount: iteration,
        commitCount,
        autoCommit,
        blockedCount: blockedEntries.length,
        blockedEntries,
        dirtyFileCount: dirtyFiles.length,
        dirtyFiles,
        refreshEntries: refreshResult.entries
      });
    }

    if (dirtyFiles.length === 0) {
      throw new Error(`Blocked lineage repair could not progress because no dirty trace files were available to commit. First blocked dependency: ${blockedEntries[0]?.dependencyPath ?? "unknown"}`);
    }

    commitCount += 1;
    commitFiles(repoRoot, dirtyFiles, `${commitMessagePrefix} checkpoint ${commitCount}`);
  }

  throw new Error(`Trace lineage repair exceeded the max iteration budget of ${maxIterations}.`);
}

export function renderTraceableLineageRepairMarkdown(result: TraceableLineageRepairResult): string {
  const lines = [
    "# Trace Lineage Repair",
    "",
    `- Repo Root: ${result.repoRoot}`,
    `- Start Files: ${result.startFileCount}`,
    `- Component Files: ${result.componentFileCount}`,
    `- Iterations: ${result.iterationCount}`,
    `- Auto Commit: ${result.autoCommit ? "yes" : "no"}`,
    `- Commits Created: ${result.commitCount}`,
    `- Dirty Files Remaining: ${result.dirtyFileCount}`,
    `- Blocked Entries: ${result.blockedCount}`
  ];
  if (result.dirtyFiles.length > 0) {
    lines.push("", "## Dirty Files", "");
    for (const filePath of result.dirtyFiles) {
      lines.push(`- ${filePath}`);
    }
  }
  if (result.blockedEntries.length > 0) {
    lines.push("", "## Blocked Entries", "");
    for (const entry of result.blockedEntries) {
      lines.push(`- ${entry.filePath}`);
      lines.push(`  - Reason: ${entry.reason ?? "blocked"}`);
      if (entry.dependencyPath) {
        lines.push(`  - Dependency: ${entry.dependencyPath}`);
      }
    }
  }
  if (result.refreshEntries.length > 0) {
    lines.push("", "## Refresh Entries", "");
    for (const entry of result.refreshEntries) {
      if (entry.blocked) {
        lines.push(`- blocked: ${entry.filePath}`);
        continue;
      }
      lines.push(`- ${entry.filePath}`);
      lines.push(`  - Changed: ${entry.changed ? "yes" : "no"}`);
      lines.push(`  - Parent Checksum Updated: ${entry.parentChecksumUpdated ? "yes" : "no"}`);
      lines.push(`  - Footer Checksum Updated: ${entry.footerChecksumUpdated ? "yes" : "no"}`);
      if (entry.checksum) {
        lines.push(`  - Checksum: ${entry.checksum}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}