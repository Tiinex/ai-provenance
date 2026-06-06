import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const {
  computeTargetedTraceableContinuityChecksumSha256,
  computeTraceableContinuityChecksumSha256
} = require("./traceableSchemaValidationShared.js") as {
  computeTargetedTraceableContinuityChecksumSha256: (
    filePath: string,
    markdown: string,
    footerIntegrity: unknown,
    readTextFileSync?: (filePath: string) => string
  ) => string | undefined;
  computeTraceableContinuityChecksumSha256: (markdown: string) => string | undefined;
};
const {
  parseTraceableContinuityMarkdown
} = require("./traceableContinuityValidation.js") as {
  parseTraceableContinuityMarkdown: (markdown: string) => {
    envelopeSchema?: { label?: string; target?: string };
    parentCreatedAt?: string;
    parentTrace?: { label?: string; target?: string };
    parentSchema?: { label?: string; target?: string };
    parentOrigin?: { relative?: string; absolute?: string; browseGit?: string };
    currentSchema?: { label?: string; target?: string };
  };
};

const TRACE_FILE_SUFFIX = ".trace.md";
const SKIPPED_DIRECTORY_NAMES = new Set([".git", "dist", "node_modules"]);
const LOCAL_TARGET_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//iu;
const DEFAULT_COMMIT_MESSAGE_PREFIX = "Repair trace lineage";
const valueLinePattern = /(- Value:\s+)([^\r\n]+)/u;
const parentChecksumLinePattern = /("parentTraceChecksumSha256"\s*:\s*")([^"]*)(")/u;

type ParseSchemaNoteMarkdown = (markdown: string) => {
  footerIntegrity?: unknown;
};

interface ParsedGitHubBlobPermalink {
  owner: string;
  repo: string;
  revision: string;
  relativePath: string;
}

type RepoRevisionSnapshots = Map<string, string>;

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
  skipped?: boolean;
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

function replaceParentChecksum(markdown: string, nextChecksum: string): string {
  return parentChecksumLinePattern.test(markdown)
    ? markdown.replace(parentChecksumLinePattern, `$1${nextChecksum}$3`)
    : markdown;
}

function parseGitHubBlobPermalink(target: string): ParsedGitHubBlobPermalink | undefined {
  try {
    const url = new URL(target);
    if (url.hostname !== "github.com") {
      return undefined;
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 5 || parts[2] !== "blob") {
      return undefined;
    }
    const [owner, repo, , revision, ...relativeParts] = parts;
    const relativePath = relativeParts.join("/");
    if (!owner || !repo || !revision || !relativePath) {
      return undefined;
    }
    return { owner, repo, revision, relativePath };
  } catch {
    return undefined;
  }
}

function readGitHeadRevision(repoRoot: string): string | undefined {
  try {
    return execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function gitRefExistsAtPath(repoRoot: string, revision: string, relativePath: string): boolean {
  try {
    execFileSync("git", ["-C", repoRoot, "cat-file", "-e", `${revision}:${relativePath}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function resolveGitOriginDefaultBranch(repoRoot: string): string | undefined {
  try {
    const symbolicRef = execFileSync("git", ["-C", repoRoot, "symbolic-ref", "refs/remotes/origin/HEAD"], { encoding: "utf8" }).trim();
    const match = symbolicRef.match(/^refs\/remotes\/origin\/(.+)$/u);
    return match?.[1]?.trim();
  } catch {
    return undefined;
  }
}

function resolveGitOriginHeadBranchViaRemote(repoRoot: string): string | undefined {
  try {
    const output = execFileSync("git", ["-C", repoRoot, "ls-remote", "--symref", "origin", "HEAD"], { encoding: "utf8" });
    const match = output.match(/^ref:\s+refs\/heads\/(.+)\s+HEAD$/mu);
    return match?.[1]?.trim();
  } catch {
    return undefined;
  }
}

function resolveGitUpstreamBranchName(repoRoot: string): string | undefined {
  try {
    const upstream = execFileSync("git", ["-C", repoRoot, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], { encoding: "utf8" }).trim();
    const match = upstream.match(/^origin\/(.+)$/u);
    return match?.[1]?.trim();
  } catch {
    return undefined;
  }
}

function listLatestBranchCandidates(repoRoot: string): string[] {
  const candidates = [
    "master",
    "main",
    resolveGitOriginDefaultBranch(repoRoot),
    resolveGitOriginHeadBranchViaRemote(repoRoot),
    resolveGitUpstreamBranchName(repoRoot)
  ];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function resolveCommitHashForBranch(repoRoot: string, branchName: string): string | undefined {
  for (const ref of [`origin/${branchName}`, `refs/remotes/origin/${branchName}`, branchName, `refs/heads/${branchName}`]) {
    try {
      const commitHash = execFileSync("git", ["-C", repoRoot, "rev-parse", ref], { encoding: "utf8" }).trim();
      if (/^[0-9a-f]{40}$/iu.test(commitHash)) {
        return commitHash;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

function buildRepoRevisionSnapshots(): RepoRevisionSnapshots {
  return new Map<string, string>();
}

function resolveStablePermalinkRevision(repoRoot: string, relativePath: string, repoRevisionSnapshots: RepoRevisionSnapshots): string | undefined {
  const cacheKey = `${normalizeComparableFsPath(repoRoot)}::${relativePath}`;
  const cachedRevision = repoRevisionSnapshots.get(cacheKey);
  if (cachedRevision) {
    return cachedRevision;
  }
  for (const branchName of listLatestBranchCandidates(repoRoot)) {
    const commitHash = resolveCommitHashForBranch(repoRoot, branchName);
    if (!commitHash || !gitRefExistsAtPath(repoRoot, commitHash, relativePath)) {
      continue;
    }
    repoRevisionSnapshots.set(cacheKey, commitHash);
    return commitHash;
  }
  const fallbackRevision = readGitHeadRevision(repoRoot);
  if (fallbackRevision) {
    repoRevisionSnapshots.set(cacheKey, fallbackRevision);
  }
  return fallbackRevision;
}

function resolveWorkspaceRepoRootForName(repoName: string, repoRoot: string, workspaceRoots: readonly string[]): string | undefined {
  const currentBaseName = path.basename(repoRoot).toLowerCase();
  if (currentBaseName === repoName.toLowerCase()) {
    return repoRoot;
  }
  return workspaceRoots.find((rootPath) => path.basename(rootPath).toLowerCase() === repoName.toLowerCase());
}

function deriveSchemaIdFromSchemaPath(schemaPath: string): string | undefined {
  const baseName = path.posix.basename(schemaPath.trim());
  const match = baseName.match(/^(.*)\.schema\.md$/u);
  return match?.[1]?.trim() || undefined;
}

function replaceFirstMarkdownLink(line: string, label: string, target: string): string {
  if (/\[[^\]]*\]\([^)]*\)/u.test(line)) {
    return line.replace(/\[[^\]]*\]\([^)]*\)/u, `[${label}](${target})`);
  }
  return line;
}

function tryRefreshSchemaPermalinkTarget(
  target: string | undefined,
  repoRoot: string,
  workspaceRoots: readonly string[],
  repoRevisionSnapshots: RepoRevisionSnapshots
): { label?: string; target?: string } | undefined {
  const trimmedTarget = target?.trim();
  if (!trimmedTarget) {
    return undefined;
  }
  const permalink = parseGitHubBlobPermalink(trimmedTarget);
  if (!permalink || !/\/\.topics\/\.schemas\//u.test(`/${permalink.relativePath}`)) {
    return undefined;
  }
  const localRepoRoot = resolveWorkspaceRepoRootForName(permalink.repo, repoRoot, workspaceRoots);
  if (!localRepoRoot) {
    return undefined;
  }
  const localSchemaPath = path.resolve(localRepoRoot, permalink.relativePath.replace(/\//g, path.sep));
  if (!existsSync(localSchemaPath)) {
    return undefined;
  }
  const latestRevision = resolveStablePermalinkRevision(localRepoRoot, permalink.relativePath, repoRevisionSnapshots);
  if (!latestRevision) {
    return undefined;
  }
  return {
    label: deriveSchemaIdFromSchemaPath(permalink.relativePath),
    target: `https://github.com/${permalink.owner}/${permalink.repo}/blob/${latestRevision}/${permalink.relativePath}`
  };
}

function normalizeSchemaReferenceLines(
  filePath: string,
  markdown: string,
  repoRoot: string,
  workspaceRoots: readonly string[],
  repoRevisionSnapshots: RepoRevisionSnapshots
): string {
  const parsed = parseTraceableContinuityMarkdown(markdown);
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const parentTraceTarget = parsed.parentTrace?.target?.trim();
  const resolvedParentTracePath = parentTraceTarget && !LOCAL_TARGET_PATTERN.test(parentTraceTarget)
    ? path.resolve(path.dirname(filePath), parentTraceTarget)
    : undefined;
  const parentTraceParsed = resolvedParentTracePath && existsSync(resolvedParentTracePath)
    ? parseTraceableContinuityMarkdown(readFileSync(resolvedParentTracePath, "utf8"))
    : undefined;
  let changed = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed.startsWith("- Envelope Schema:")) {
      const refreshed = tryRefreshSchemaPermalinkTarget(parsed.envelopeSchema?.target, repoRoot, workspaceRoots, repoRevisionSnapshots);
      if (refreshed?.target) {
        const nextLine = replaceFirstMarkdownLink(line, refreshed.label ?? parsed.envelopeSchema?.label?.trim() ?? "schema", refreshed.target);
        if (nextLine !== line) {
          lines[index] = nextLine;
          changed = true;
        }
      }
      continue;
    }
    if (trimmed.startsWith("- Current Schema:")) {
      const refreshed = tryRefreshSchemaPermalinkTarget(parsed.currentSchema?.target, repoRoot, workspaceRoots, repoRevisionSnapshots);
      if (refreshed?.target) {
        const nextLine = replaceFirstMarkdownLink(line, refreshed.label ?? parsed.currentSchema?.label?.trim() ?? "schema", refreshed.target);
        if (nextLine !== line) {
          lines[index] = nextLine;
          changed = true;
        }
      }
      continue;
    }
    if (trimmed.startsWith("- Parent Schema:")) {
      const refreshed = tryRefreshSchemaPermalinkTarget(parsed.parentSchema?.target, repoRoot, workspaceRoots, repoRevisionSnapshots);
      const parentCurrentSchema = parentTraceParsed?.currentSchema;
      const refreshedParentCurrentSchema = tryRefreshSchemaPermalinkTarget(parentCurrentSchema?.target, repoRoot, workspaceRoots, repoRevisionSnapshots);
      const parentSchemaLabel = refreshedParentCurrentSchema?.label
        ?? parentCurrentSchema?.label?.trim()
        ?? parentCurrentSchema?.target?.trim();
      const parentSchemaTarget = refreshedParentCurrentSchema?.target
        ?? parentCurrentSchema?.target?.trim();
      const parentLine = parentCurrentSchema?.target?.trim()
        ? `  - Parent Schema: [${parentSchemaLabel}](${parentSchemaTarget})`
        : refreshed?.target
          ? replaceFirstMarkdownLink(line, refreshed.label ?? parsed.parentSchema?.label?.trim() ?? "schema", refreshed.target)
          : line;
      if (parentLine !== line) {
        lines[index] = parentLine;
        changed = true;
      }
      continue;
    }
  }

  return changed ? lines.join("\n") : markdown;
}

function inferContinuityFooterTarget(markdown: string): { label: string; target: string } | undefined {
  const parsed = parseTraceableContinuityMarkdown(markdown);
  const hasParent = Boolean(
    parsed.parentCreatedAt?.trim()
    || parsed.parentTrace?.target?.trim()
    || parsed.parentSchema?.target?.trim()
    || parsed.parentSchema?.label?.trim()
    || parsed.parentOrigin?.relative?.trim()
    || parsed.parentOrigin?.absolute?.trim()
    || parsed.parentOrigin?.browseGit?.trim()
  );
  const target = hasParent
    ? parsed.parentOrigin?.browseGit?.trim() || parsed.parentTrace?.target?.trim() || parsed.currentSchema?.target?.trim()
    : "self";
  if (!target) {
    return undefined;
  }
  const label = target === "self"
    ? "self"
    : parsed.parentTrace?.label?.trim()
      || parsed.currentSchema?.label?.trim()
      || path.posix.basename(target.split("/").pop() ?? "target");
  return { label, target };
}

function buildCanonicalContinuityFooter(markdown: string, footerTarget: { label: string; target: string }, checksum: string): string {
  const endOfLine = markdown.includes("\r\n") ? "\r\n" : "\n";
  return `# Continuity Integrity${endOfLine}${endOfLine}- sha256-base64url-c14n-v1${endOfLine}  - Towards: [${footerTarget.label}](${footerTarget.target})${endOfLine}  - Value: ${checksum}`;
}

function replaceOrAppendContinuityFooter(markdown: string, footer: string): string {
  const endOfLine = markdown.includes("\r\n") ? "\r\n" : "\n";
  const integrityHeadingPattern = /^# Continuity Integrity\s*$/mu;
  const integrityMatch = integrityHeadingPattern.exec(markdown);
  if (integrityMatch?.index !== undefined) {
    const footerStart = integrityMatch.index;
    return `${markdown.slice(0, footerStart)}${footer}`;
  }
  const trimmedMarkdown = markdown.replace(/[\s\r\n]+$/u, "");
  return `${trimmedMarkdown}${endOfLine}${endOfLine}---${endOfLine}${endOfLine}${footer}`;
}

function normalizeContinuityFooterStructure(
  filePath: string,
  markdown: string,
  parseSchemaNoteMarkdown: ParseSchemaNoteMarkdown
): string | undefined {
  if (valueLinePattern.test(markdown)) {
    return markdown;
  }
  const footerTarget = inferContinuityFooterTarget(markdown);
  if (!footerTarget) {
    return undefined;
  }
  const placeholderFooter = buildCanonicalContinuityFooter(markdown, footerTarget, "PLACEHOLDER");
  const placeholderMarkdown = replaceOrAppendContinuityFooter(markdown, placeholderFooter);
  const checksum = computeTargetedTraceableContinuityChecksumSha256(
    filePath,
    placeholderMarkdown,
    { towardsTarget: footerTarget.target },
    (dependencyPath: string) => normalizeComparableFsPath(dependencyPath) === normalizeComparableFsPath(filePath)
      ? placeholderMarkdown
      : readFileSync(dependencyPath, "utf8")
  );
  if (!checksum) {
    return undefined;
  }
  const nextFooter = buildCanonicalContinuityFooter(markdown, footerTarget, checksum);
  return replaceOrAppendContinuityFooter(markdown, nextFooter);
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

function hasTrackedGitChangesForPath(filePath: string): boolean {
  const gitRoot = resolveTraceableLineageRepairGitRoot(filePath);
  if (!gitRoot) {
    return false;
  }
  const relativePath = path.relative(gitRoot, filePath);
  if (!relativePath || relativePath.startsWith("..")) {
    return false;
  }
  try {
    const status = execFileSync("git", ["-C", gitRoot, "status", "--porcelain", "--", relativePath], { encoding: "utf8" }).trim();
    return status.length > 0;
  } catch {
    return false;
  }
}

async function refreshStoredParentChecksum(
  markdown: string,
  absolutePath: string,
  traceFileSet: Set<string>,
  inFlight: Map<string, Promise<TraceableLineageRepairEntry | undefined>>,
  parseSchemaNoteMarkdown: ParseSchemaNoteMarkdown,
  repoRoot: string,
  workspaceRoots: readonly string[],
  repoRevisionSnapshots: RepoRevisionSnapshots
): Promise<{
  markdown: string;
  parentChecksumUpdated: boolean;
  blocked?: boolean;
  reason?: string;
  dependencyPath?: string;
}> {
  const traceableState = extractTraceableState(markdown) as { parentTracePath?: string; parentTraceChecksumSha256?: string };
  if (!traceableState.parentTracePath) {
    return {
      markdown,
      parentChecksumUpdated: false
    };
  }

  const resolvedParentPath = path.resolve(path.dirname(absolutePath), traceableState.parentTracePath);
  if (traceFileSet.has(resolvedParentPath)) {
    const parentRefresh = await refreshTraceFile(resolvedParentPath, traceFileSet, inFlight, parseSchemaNoteMarkdown, repoRoot, workspaceRoots, repoRevisionSnapshots);
    if (parentRefresh?.blocked) {
      return {
        markdown,
        parentChecksumUpdated: false,
        blocked: true,
        reason: parentRefresh.reason,
        dependencyPath: parentRefresh.dependencyPath ?? resolvedParentPath
      };
    }
  }
  if (!existsSync(resolvedParentPath)) {
    return {
      markdown,
      parentChecksumUpdated: false
    };
  }
  if (hasTrackedGitChangesForPath(resolvedParentPath)) {
    return {
      markdown,
      parentChecksumUpdated: false,
      blocked: true,
      reason: "dirty-direct-parent-requires-commit",
      dependencyPath: resolvedParentPath
    };
  }

  const parentMarkdown = await readFile(resolvedParentPath, "utf8");
  const nextParentChecksum = computeTraceableContinuityChecksumSha256(parentMarkdown);
  if (
    !nextParentChecksum
    || !traceableState.parentTraceChecksumSha256
    || traceableState.parentTraceChecksumSha256 === nextParentChecksum
  ) {
    return {
      markdown,
      parentChecksumUpdated: false
    };
  }

  const updatedMarkdown = replaceParentChecksum(markdown, nextParentChecksum);
  return {
    markdown: updatedMarkdown,
    parentChecksumUpdated: updatedMarkdown !== markdown
  };
}

async function refreshTraceFile(
  filePath: string,
  traceFileSet: Set<string>,
  inFlight: Map<string, Promise<TraceableLineageRepairEntry | undefined>>,
  parseSchemaNoteMarkdown: ParseSchemaNoteMarkdown,
  repoRoot: string,
  workspaceRoots: readonly string[],
  repoRevisionSnapshots: RepoRevisionSnapshots
): Promise<TraceableLineageRepairEntry | undefined> {
  const absolutePath = path.resolve(filePath);
  if (inFlight.has(absolutePath)) {
    return inFlight.get(absolutePath);
  }

  const refreshPromise = (async () => {
    let markdown = await readFile(absolutePath, "utf8");
    const originalMarkdown = markdown;
    let parentChecksumUpdated = false;

    markdown = normalizeSchemaReferenceLines(absolutePath, markdown, repoRoot, workspaceRoots, repoRevisionSnapshots);

    const initialParentRefresh = await refreshStoredParentChecksum(markdown, absolutePath, traceFileSet, inFlight, parseSchemaNoteMarkdown, repoRoot, workspaceRoots, repoRevisionSnapshots);
    if (initialParentRefresh.blocked) {
      return {
        filePath: absolutePath,
        blocked: true,
        reason: initialParentRefresh.reason,
        dependencyPath: initialParentRefresh.dependencyPath
      };
    }
    markdown = initialParentRefresh.markdown;
    parentChecksumUpdated = initialParentRefresh.parentChecksumUpdated;

    const parsed = parseSchemaNoteMarkdown(markdown);
    const footerIntegrity = parsed.footerIntegrity;
    const footerTarget = typeof footerIntegrity === "object"
      && footerIntegrity !== null
      && typeof (footerIntegrity as { towardsTarget?: unknown }).towardsTarget === "string"
      ? (footerIntegrity as { towardsTarget: string }).towardsTarget.trim()
      : undefined;
    if (footerTarget && footerTarget !== "self" && !LOCAL_TARGET_PATTERN.test(footerTarget)) {
      const resolvedFooterTargetPath = path.resolve(path.dirname(absolutePath), footerTarget);
      if (traceFileSet.has(resolvedFooterTargetPath)) {
        const footerTargetRefresh = await refreshTraceFile(resolvedFooterTargetPath, traceFileSet, inFlight, parseSchemaNoteMarkdown, repoRoot, workspaceRoots, repoRevisionSnapshots);
        if (footerTargetRefresh?.blocked) {
          return {
            filePath: absolutePath,
            blocked: true,
            reason: footerTargetRefresh.reason,
            dependencyPath: footerTargetRefresh.dependencyPath ?? resolvedFooterTargetPath
          };
        }
        const secondParentRefresh = await refreshStoredParentChecksum(markdown, absolutePath, traceFileSet, inFlight, parseSchemaNoteMarkdown, repoRoot, workspaceRoots, repoRevisionSnapshots);
        if (secondParentRefresh.blocked) {
          return {
            filePath: absolutePath,
            blocked: true,
            reason: secondParentRefresh.reason,
            dependencyPath: secondParentRefresh.dependencyPath
          };
        }
        markdown = secondParentRefresh.markdown;
        parentChecksumUpdated = parentChecksumUpdated || secondParentRefresh.parentChecksumUpdated;
      }
      if (existsSync(resolvedFooterTargetPath) && hasTrackedGitChangesForPath(resolvedFooterTargetPath)) {
        return {
          filePath: absolutePath,
          blocked: true,
          reason: "dirty-footer-target-requires-commit",
          dependencyPath: resolvedFooterTargetPath
        };
      }
    }
    if (!valueLinePattern.test(markdown)) {
      const normalizedMarkdown = normalizeContinuityFooterStructure(absolutePath, markdown, parseSchemaNoteMarkdown);
      if (!normalizedMarkdown) {
        return {
          filePath: absolutePath,
          skipped: true,
          reason: "missing-footer-value-line"
        };
      }
      markdown = normalizedMarkdown;
    }
    const repairedParsed = parseSchemaNoteMarkdown(markdown);
    const nextChecksum = computeTargetedTraceableContinuityChecksumSha256(absolutePath, markdown, repairedParsed.footerIntegrity);
    if (!nextChecksum) {
      throw new Error(`Could not resolve the declared continuity integrity target for ${absolutePath}`);
    }
    const updatedMarkdown = markdown.replace(valueLinePattern, `$1${nextChecksum}`);
    const footerChecksumUpdated = updatedMarkdown !== markdown;
    if (updatedMarkdown !== originalMarkdown) {
      await writeFile(absolutePath, updatedMarkdown, "utf8");
    }
    return {
      filePath: absolutePath,
      parentChecksumUpdated,
      footerChecksumUpdated,
      changed: updatedMarkdown !== originalMarkdown,
      checksum: nextChecksum
    };
  })();

  inFlight.set(absolutePath, refreshPromise);
  return refreshPromise;
}

async function runRefreshPass(
  filePaths: readonly string[],
  parseSchemaNoteMarkdown: ParseSchemaNoteMarkdown,
  repoRoot: string,
  workspaceRoots: readonly string[],
  repoRevisionSnapshots: RepoRevisionSnapshots
): Promise<{ exitCode: number; entries: TraceableLineageRepairEntry[] }> {
  const traceFileSet = new Set(filePaths.map((filePath) => path.resolve(filePath)));
  const inFlight = new Map<string, Promise<TraceableLineageRepairEntry | undefined>>();
  const entries: TraceableLineageRepairEntry[] = [];
  let exitCode = 0;
  for (const traceFile of filePaths) {
    const result = await refreshTraceFile(traceFile, traceFileSet, inFlight, parseSchemaNoteMarkdown, repoRoot, workspaceRoots, repoRevisionSnapshots);
    if (result) {
      entries.push(result);
      if (result.blocked) {
        exitCode = 2;
      }
    }
  }
  return { exitCode, entries };
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
    parseSchemaNoteMarkdown: ParseSchemaNoteMarkdown;
    workspaceRoots?: readonly string[];
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
  const workspaceRoots = dependencies.workspaceRoots ?? [repoRoot];
  const repoRevisionSnapshots = buildRepoRevisionSnapshots();
  let commitCount = 0;

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const refreshResult = await runRefreshPass(componentFiles, dependencies.parseSchemaNoteMarkdown, repoRoot, workspaceRoots, repoRevisionSnapshots);
    let dirtyFiles = getDirtyTrackedFiles(repoRoot, componentFiles);
    const blockedEntries = refreshResult.entries.filter((entry) => entry?.blocked);
    if (blockedEntries.length === 0) {
      if (autoCommit && dirtyFiles.length > 0) {
        commitCount += 1;
        commitFiles(repoRoot, dirtyFiles, `${commitMessagePrefix} finalize ${commitCount}`);
        dirtyFiles = getDirtyTrackedFiles(repoRoot, componentFiles);
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
        if (entry.reason) {
          lines.push(`  - Reason: ${entry.reason}`);
        }
        continue;
      }
      if (entry.skipped) {
        lines.push(`- skipped: ${entry.filePath}`);
        if (entry.reason) {
          lines.push(`  - Reason: ${entry.reason}`);
        }
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