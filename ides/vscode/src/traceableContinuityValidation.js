const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");

/**
 * @typedef {"ok" | "legacy-no-checksum" | "missing-parent" | "unreadable-parent" | "checksum-mismatch" | "cycle-detected" | "disabled"} TraceableLineageIntegrityStatus
 */

/**
 * @typedef {{
 *   status: TraceableLineageIntegrityStatus,
 *   resolvedParentTracePath?: string,
 *   storedParentTraceChecksumSha256?: string,
 *   actualParentTraceChecksumSha256?: string
 * }} TraceableDirectParentIntegrityCoreResult
 */

/**
 * @typedef {{
 *   childFilePath?: string,
 *   resolvedParentTracePath?: string,
 *   storedParentTraceChecksumSha256?: string,
 *   knownAncestorTracePaths?: string[],
 *   checksumEnabled?: boolean
 * }} EvaluateTraceableDirectParentIntegrityCoreInput
 */

/**
 * @typedef {{ level: number, text: string }} TraceableMarkdownHeading
 */

/**
 * @typedef {{
 *   label: string,
 *   items: string[]
 * }} TraceableContractCategory
 */

/**
 * @typedef {{
 *   heading: string,
 *   categories: TraceableContractCategory[]
 * }} TraceableContractGroup
 */

/**
 * @typedef {{
 *   present: boolean,
 *   groups: TraceableContractGroup[],
 *   duplicateGroupHeadings: string[],
 *   categoriesMissingLists: string[],
 *   unlabeledHyphenListLines: string[],
 *   starBulletLines: string[],
 *   unexpectedContentLines: string[]
 * }} ParsedTraceableSchemaValidationContract
 */

/**
 * @typedef {{
 *   currentSchema?: { id?: string, target?: string },
 *   parentSchema?: { id?: string, target?: string },
 *   parentCreatedAt?: string,
 *   parentTrace?: { label?: string, target?: string },
 *   parentOrigin?: { relative?: string, absolute?: string, browseGit?: string },
 *   currentCreatedAt?: string,
 *   currentWhy?: string,
 *   currentSummary?: string,
 *   footerIntegrity?: { method?: string, towardsLabel?: string, towardsTarget?: string, value?: string },
 *   traceableState?: { schema?: string, parentTracePath?: string, parentTraceChecksumSha256?: string, lineageLabel?: string, lineageDepth?: number },
 *   schemaValidationContract?: ParsedTraceableSchemaValidationContract,
 *   headings: TraceableMarkdownHeading[]
 * }} ParsedTraceableContinuityMarkdown
 */

/**
 * @typedef {{
 *   requiredTopLevelSectionsMissing: string[],
 *   recommendedTopLevelSectionsMissing: string[],
 *   recommendedTechnicalDetailSectionsMissing: string[],
 *   optionalStateSectionsPresent: string[]
 * }} TraceableRuntimeStructureValidation
 */

/**
 * @typedef {{
 *   status: "verified" | "missing" | "mismatch" | "unsupported-method",
 *   method?: string,
 *   towardsTarget?: string,
 *   storedValue?: string,
 *   actualValue?: string
 * }} TraceableContinuityIntegrityValidation
 */

/**
 * @typedef {{
 *   source: "traceable-state-parent" | "parent-trace" | "parent-origin-relative" | "external-only" | "none",
 *   rawTarget?: string,
 *   resolvedPath?: string
 * }} TraceableBackwardParentLink
 */

/**
 * @typedef {{
 *   filePath: string,
 *   parsed: ParsedTraceableContinuityMarkdown,
 *   backwardLink: TraceableBackwardParentLink,
 *   continuityIntegrity: TraceableContinuityIntegrityValidation,
 *   traceableParentIntegrity?: TraceableDirectParentIntegrityCoreResult,
 *   runtimeTraceStructure?: TraceableRuntimeStructureValidation
 * }} TraceableContinuityValidationNode
 */

/**
 * @typedef {{
 *   rootFilePath: string,
 *   nodes: TraceableContinuityValidationNode[],
 *   stoppedBecause: "complete" | "external-parent" | "unreadable-parent" | "cycle-detected" | "max-depth"
 * }} TraceableContinuityValidationResult
 */

/**
 * @typedef {{
 *   filePath: string,
 *   maxDepth?: number,
 *   readTextFileSync?: (filePath: string) => string,
 *   workspaceRoots?: Array<{ name?: string, fsPath: string }>,
 *   gitRevisionExistsSync?: (repoRoot: string, revision: string) => boolean | undefined
 * }} ValidateTraceableContinuityArtifactChainInput
 */

const gitRevisionExistsCache = new Map();

function normalizePathForComparison(candidate) {
  const trimmed = typeof candidate === "string" ? candidate.trim() : "";
  if (!trimmed) {
    return undefined;
  }
  const resolved = path.resolve(trimmed);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function trimToUndefined(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || undefined;
}

function extractMarkdownLink(value) {
  const trimmed = trimToUndefined(value);
  if (!trimmed) {
    return {};
  }
  const match = trimmed.match(/^\[(.*?)\]\((.*?)\)$/u);
  if (!match) {
    return { label: trimmed, target: trimmed };
  }
  return {
    label: trimToUndefined(match[1]),
    target: trimToUndefined(match[2])
  };
}

function extractSchemaIdentity(schema) {
  return trimToUndefined(schema?.label) || trimToUndefined(schema?.target);
}

function extractLabeledValue(line, label) {
  const match = line.match(new RegExp(`^-\\s+${label}:\\s+(.*)$`, "u"));
  return match ? trimToUndefined(match[1]) : undefined;
}

function extractNestedLabeledValue(line, label) {
  const match = line.match(new RegExp(`^(?: {2,}|\\t+)-\\s+${label}:\\s+(.*)$`, "u"));
  return match ? trimToUndefined(match[1]) : undefined;
}

function extractTraceableStateJson(markdown) {
  const startMatch = /## Traceable State\s+```json\s*\r?\n/u.exec(markdown);
  if (!startMatch) {
    return undefined;
  }
  const remainder = markdown.slice(startMatch.index + startMatch[0].length);
  const closingMatch = /^```[ \t]*$/um.exec(remainder);
  if (closingMatch?.index === undefined) {
    return undefined;
  }
  return remainder.slice(0, closingMatch.index).trim();
}

function parseTraceableState(markdown) {
  const jsonBlock = extractTraceableStateJson(markdown);
  if (!jsonBlock) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(jsonBlock);
    const result = parsed && typeof parsed === "object" && parsed.result && typeof parsed.result === "object"
      ? parsed.result
      : undefined;
    if (!result) {
      return undefined;
    }
    return {
      schema: trimToUndefined(typeof parsed.schema === "string" ? parsed.schema : undefined),
      parentTracePath: trimToUndefined(typeof result.parentTracePath === "string" ? result.parentTracePath : undefined),
      parentTraceChecksumSha256: trimToUndefined(typeof result.parentTraceChecksumSha256 === "string" ? result.parentTraceChecksumSha256 : undefined),
      lineageLabel: trimToUndefined(typeof result.lineageLabel === "string" ? result.lineageLabel : undefined),
      lineageDepth: Number.isInteger(result.lineageDepth) ? result.lineageDepth : undefined
    };
  } catch {
    return undefined;
  }
}

function parseHeadings(markdown) {
  return Array.from(markdown.matchAll(/^(#{1,6})\s+(.+)$/gmu)).map((match) => ({
    level: match[1].length,
    text: match[2].trim()
  }));
}

function parseContractSection(markdown, sectionHeading) {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const startIndex = lines.findIndex((line) => line.trim() === `## ${sectionHeading}`);
  if (startIndex < 0) {
    return {
      present: false,
      groups: [],
      duplicateGroupHeadings: [],
      categoriesMissingLists: [],
      unlabeledHyphenListLines: [],
      starBulletLines: [],
      unexpectedContentLines: []
    };
  }

  const groups = [];
  const duplicateGroupHeadings = [];
  const categoriesMissingLists = [];
  const unlabeledHyphenListLines = [];
  const starBulletLines = [];
  const unexpectedContentLines = [];
  const seenGroupHeadings = new Set();
  let currentGroup;
  let currentCategory;

  function finalizePendingCategory() {
    if (currentCategory && currentCategory.items.length === 0) {
      categoriesMissingLists.push(`${currentGroup?.heading ?? "<unknown group>"} -> ${currentCategory.label}`);
    }
  }

  for (const line of lines.slice(startIndex + 1)) {
    const trimmed = line.trim();
    if (trimmed === "---" || /^##\s+/u.test(trimmed) || /^#\s+/u.test(trimmed)) {
      break;
    }
    if (!trimmed) {
      continue;
    }

    const levelThreeHeading = trimmed.match(/^###\s+(.+)$/u);
    if (levelThreeHeading) {
      finalizePendingCategory();
      currentCategory = undefined;
      const heading = trimToUndefined(levelThreeHeading[1]);
      if (!heading) {
        continue;
      }
      if (seenGroupHeadings.has(heading)) {
        duplicateGroupHeadings.push(heading);
      }
      seenGroupHeadings.add(heading);
      currentGroup = {
        heading,
        categories: []
      };
      groups.push(currentGroup);
      continue;
    }

    if (!currentGroup) {
      unexpectedContentLines.push(trimmed);
      continue;
    }

    if (/^(\*|\s+\*)\s+/u.test(line)) {
      starBulletLines.push(trimmed);
      continue;
    }

    if (/^(-|\s+-)\s+/u.test(line)) {
      if (!currentCategory) {
        unlabeledHyphenListLines.push(trimmed);
        continue;
      }
      currentCategory.items.push(trimmed.replace(/^\s*-\s+/u, ""));
      continue;
    }

    if (!/^#/u.test(trimmed)) {
      finalizePendingCategory();
      currentCategory = {
        label: trimmed,
        items: []
      };
      currentGroup.categories.push(currentCategory);
      continue;
    }

    unexpectedContentLines.push(trimmed);
  }

  finalizePendingCategory();

  return {
    present: true,
    groups,
    duplicateGroupHeadings,
    categoriesMissingLists,
    unlabeledHyphenListLines,
    starBulletLines,
    unexpectedContentLines
  };
}

function parseSchemaValidationContract(markdown) {
  return parseContractSection(markdown, "Schema Validation Contract");
}

function parseArtifactCreationContract(markdown) {
  return parseContractSection(markdown, "Artifact Creation Contract");
}

function parseContinuityContext(lines) {
  const result = {
    envelopeSchema: undefined,
    currentSchema: undefined,
    parentSchema: undefined,
    parentCreatedAt: undefined,
    parentTrace: undefined,
    parentOrigin: {},
    currentCreatedAt: undefined,
    currentWhy: undefined,
    currentSummary: undefined,
    footerIntegrity: undefined
  };

  let inContinuityContext = false;
  let currentTopLevel = undefined;
  let inParentOrigin = false;

  for (const line of lines) {
    if (!inContinuityContext) {
      if (line.trim() === "# Continuity Context") {
        inContinuityContext = true;
      }
      continue;
    }
    if (line.trim() === "---") {
      break;
    }

    const envelopeSchemaValue = extractLabeledValue(line, "Envelope Schema");
    if (envelopeSchemaValue) {
      result.envelopeSchema = extractMarkdownLink(envelopeSchemaValue);
      continue;
    }

    if (/^-\s+Parent\s*$/u.test(line)) {
      currentTopLevel = "parent";
      inParentOrigin = false;
      continue;
    }
    if (/^-\s+Current\s*$/u.test(line)) {
      currentTopLevel = "current";
      inParentOrigin = false;
      continue;
    }

    if (currentTopLevel === "parent" && /^(?: {2,}|\t+)-\s+Origin:\s*$/u.test(line)) {
      inParentOrigin = true;
      continue;
    }

    if (currentTopLevel === "parent") {
      const parentSchemaValue = extractNestedLabeledValue(line, "Parent Schema");
      if (parentSchemaValue) {
        result.parentSchema = extractMarkdownLink(parentSchemaValue);
        inParentOrigin = false;
        continue;
      }
      const parentCreatedAtValue = extractNestedLabeledValue(line, "Created At");
      if (parentCreatedAtValue) {
        result.parentCreatedAt = parentCreatedAtValue;
        inParentOrigin = false;
        continue;
      }
      const parentTraceValue = extractNestedLabeledValue(line, "Trace");
      if (parentTraceValue) {
        result.parentTrace = extractMarkdownLink(parentTraceValue);
        inParentOrigin = false;
        continue;
      }
      if (inParentOrigin) {
        const originMatch = line.match(/^(?: {4,}|\t{2,})-\s+\[(relative|absolute|browse \+ git)\]\((.*?)\)\s*$/u);
        if (originMatch) {
          const key = originMatch[1] === "browse + git"
            ? "browseGit"
            : originMatch[1];
          result.parentOrigin[key] = trimToUndefined(originMatch[2]);
          continue;
        }
      }
    }

    if (currentTopLevel === "current") {
      const currentSchemaValue = extractNestedLabeledValue(line, "Current Schema");
      if (currentSchemaValue) {
        result.currentSchema = extractMarkdownLink(currentSchemaValue);
        continue;
      }
      const currentCreatedAtValue = extractNestedLabeledValue(line, "Created At");
      if (currentCreatedAtValue) {
        result.currentCreatedAt = currentCreatedAtValue;
        continue;
      }
      const currentWhyValue = extractNestedLabeledValue(line, "Why");
      if (currentWhyValue) {
        result.currentWhy = currentWhyValue;
        continue;
      }
      const currentSummaryValue = extractNestedLabeledValue(line, "Summary");
      if (currentSummaryValue) {
        result.currentSummary = currentSummaryValue;
      }
    }
  }

  return result;
}

function parseContinuityIntegrity(lines) {
  const startIndex = lines.findIndex((line) => line.trim() === "# Continuity Integrity");
  if (startIndex < 0) {
    return undefined;
  }
  let method;
  let towardsLabel;
  let towardsTarget;
  let value;
  for (const line of lines.slice(startIndex + 1)) {
    if (!method) {
      const methodMatch = line.match(/^-\s+([^:]+)$/u);
      if (methodMatch) {
        method = trimToUndefined(methodMatch[1]);
        continue;
      }
    }
    const towardsValue = extractNestedLabeledValue(line, "Towards");
    if (towardsValue) {
      const link = extractMarkdownLink(towardsValue);
      towardsLabel = link.label;
      towardsTarget = link.target;
      continue;
    }
    const storedValue = extractNestedLabeledValue(line, "Value");
    if (storedValue) {
      value = storedValue;
      continue;
    }
  }
  if (!method && !towardsTarget && !value) {
    return undefined;
  }
  return { method, towardsLabel, towardsTarget, value };
}

function isExternalUrl(target) {
  return /^[a-z][a-z0-9+.-]*:\/\//iu.test(target);
}

function isCommitPinnedBrowseGitTarget(target) {
  const trimmed = trimToUndefined(target);
  if (!trimmed || !isExternalUrl(trimmed)) {
    return false;
  }
  return /\/(?:blob|commit)\/[0-9a-f]{7,40}(?:\/|$)/iu.test(trimmed);
}

function isTraceableContinuityTimestamp(value) {
  const trimmed = trimToUndefined(value);
  if (!trimmed) {
    return false;
  }
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/u);
  if (!match) {
    return false;
  }
  const [, year, month, day, hour, minute, second] = match;
  const candidate = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  return Number.isFinite(candidate.getTime())
    && candidate.getUTCFullYear() === Number(year)
    && candidate.getUTCMonth() + 1 === Number(month)
    && candidate.getUTCDate() === Number(day)
    && candidate.getUTCHours() === Number(hour)
    && candidate.getUTCMinutes() === Number(minute)
    && candidate.getUTCSeconds() === Number(second);
}

function resolveLocalReference(currentFilePath, reference) {
  const trimmed = trimToUndefined(reference);
  if (!trimmed) {
    return undefined;
  }
  if (isExternalUrl(trimmed)) {
    if (/^file:\/\//iu.test(trimmed)) {
      try {
        return fileURLToPath(trimmed);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
  return path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(path.dirname(currentFilePath), trimmed);
}

function isReadableLocalReferenceCandidate(reference) {
  const trimmed = trimToUndefined(reference);
  if (!trimmed) {
    return false;
  }
  if (/^file:\/\//iu.test(trimmed)) {
    return true;
  }
  if (isExternalUrl(trimmed)) {
    return false;
  }
  if (path.isAbsolute(trimmed)) {
    return true;
  }
  return /^[.]{1,2}(?:[\\/]|$)/u.test(trimmed) || trimmed.includes("/") || trimmed.includes("\\");
}

function canReadResolvedLocalReference(filePath, reference, readTextFileSync) {
  if (!isReadableLocalReferenceCandidate(reference)) {
    return true;
  }
  const resolvedPath = resolveLocalReference(filePath, reference);
  if (!resolvedPath) {
    return false;
  }
  try {
    readTextFileSync(resolvedPath);
    return true;
  } catch {
    return false;
  }
}

function parseGitHubSchemaPermalink(reference) {
  const trimmed = trimToUndefined(reference);
  if (!trimmed || !isExternalUrl(trimmed)) {
    return undefined;
  }
  try {
    const parsedUrl = new URL(trimmed);
    const pathnameParts = parsedUrl.pathname.split("/").filter(Boolean);
    if (parsedUrl.hostname === "github.com") {
      if (pathnameParts.length < 5 || pathnameParts[2] !== "blob") {
        return undefined;
      }
      const revision = trimToUndefined(pathnameParts[3]);
      const relativePath = trimToUndefined(pathnameParts.slice(4).join("/"));
      if (!revision || !relativePath || !/^[0-9a-f]{7,40}$/iu.test(revision)) {
        return undefined;
      }
      return {
        repoOwner: trimToUndefined(pathnameParts[0]),
        repoName: trimToUndefined(pathnameParts[1]),
        revision,
        relativePath
      };
    }
    if (parsedUrl.hostname === "raw.githubusercontent.com") {
      if (pathnameParts.length < 4) {
        return undefined;
      }
      const revision = trimToUndefined(pathnameParts[2]);
      const relativePath = trimToUndefined(pathnameParts.slice(3).join("/"));
      if (!revision || !relativePath || !/^[0-9a-f]{7,40}$/iu.test(revision)) {
        return undefined;
      }
      return {
        repoOwner: trimToUndefined(pathnameParts[0]),
        repoName: trimToUndefined(pathnameParts[1]),
        revision,
        relativePath
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function normalizeWorkspaceRootEntry(root) {
  if (!root || typeof root.fsPath !== "string") {
    return undefined;
  }
  return {
    name: trimToUndefined(root.name) ?? path.basename(root.fsPath),
    fsPath: path.resolve(root.fsPath)
  };
}

function findAncestorRepoRoot(filePath, repoName) {
  const normalizedRepoName = trimToUndefined(repoName)?.toLowerCase();
  if (!normalizedRepoName) {
    return undefined;
  }
  let currentDirectory = path.dirname(path.resolve(filePath));
  while (true) {
    if (path.basename(currentDirectory).toLowerCase() === normalizedRepoName) {
      return currentDirectory;
    }
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return undefined;
    }
    currentDirectory = parentDirectory;
  }
}

function listCandidateRepoRoots(filePath, repoName, workspaceRoots) {
  const normalizedRepoName = trimToUndefined(repoName)?.toLowerCase();
  if (!normalizedRepoName) {
    return [];
  }
  const results = [];
  const seen = new Set();
  for (const candidate of Array.isArray(workspaceRoots) ? workspaceRoots : []) {
    const normalized = normalizeWorkspaceRootEntry(candidate);
    if (!normalized) {
      continue;
    }
    const candidateName = trimToUndefined(normalized.name)?.toLowerCase();
    const candidateBaseName = path.basename(normalized.fsPath).toLowerCase();
    if (candidateName !== normalizedRepoName && candidateBaseName !== normalizedRepoName) {
      continue;
    }
    const key = normalizePathForComparison(normalized.fsPath);
    if (key && !seen.has(key)) {
      seen.add(key);
      results.push(normalized.fsPath);
    }
  }
  const ancestorMatch = findAncestorRepoRoot(filePath, repoName);
  const ancestorKey = ancestorMatch ? normalizePathForComparison(ancestorMatch) : undefined;
  if (ancestorMatch && ancestorKey && !seen.has(ancestorKey)) {
    seen.add(ancestorKey);
    results.push(ancestorMatch);
  }
  return results;
}

function defaultGitRevisionExistsSync(repoRoot, revision) {
  const normalizedRoot = normalizePathForComparison(repoRoot);
  const normalizedRevision = trimToUndefined(revision)?.toLowerCase();
  if (!normalizedRoot || !normalizedRevision) {
    return undefined;
  }
  const cacheKey = `${normalizedRoot}::${normalizedRevision}`;
  if (gitRevisionExistsCache.has(cacheKey)) {
    return gitRevisionExistsCache.get(cacheKey);
  }
  try {
    execFileSync("git", ["-C", repoRoot, "rev-parse", "--verify", `${revision}^{commit}`], { stdio: "ignore" });
    gitRevisionExistsCache.set(cacheKey, true);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      gitRevisionExistsCache.set(cacheKey, undefined);
      return undefined;
    }
    gitRevisionExistsCache.set(cacheKey, false);
    return false;
  }
}

function canReadResolvedSchemaPermalink(filePath, reference, readTextFileSync, workspaceRoots, gitRevisionExistsSync) {
  const permalink = parseGitHubSchemaPermalink(reference);
  if (!permalink) {
    return false;
  }
  for (const repoRoot of listCandidateRepoRoots(filePath, permalink.repoName, workspaceRoots)) {
    const revisionKnown = typeof gitRevisionExistsSync === "function"
      ? gitRevisionExistsSync(repoRoot, permalink.revision)
      : defaultGitRevisionExistsSync(repoRoot, permalink.revision);
    if (revisionKnown === false) {
      continue;
    }
    const resolvedPath = path.resolve(repoRoot, ...permalink.relativePath.split("/"));
    try {
      readTextFileSync(resolvedPath);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

function chooseBackwardLink(filePath, parsed) {
  const traceableParentTarget = trimToUndefined(parsed.traceableState?.parentTracePath);
  if (traceableParentTarget) {
    return {
      source: "traceable-state-parent",
      rawTarget: traceableParentTarget,
      resolvedPath: resolveLocalReference(filePath, traceableParentTarget)
    };
  }
  const parentTraceTarget = trimToUndefined(parsed.parentTrace?.target);
  const resolvedParentTrace = parentTraceTarget ? resolveLocalReference(filePath, parentTraceTarget) : undefined;
  if (resolvedParentTrace) {
    return {
      source: "parent-trace",
      rawTarget: parentTraceTarget,
      resolvedPath: resolvedParentTrace
    };
  }
  const parentOriginRelative = trimToUndefined(parsed.parentOrigin?.relative);
  const resolvedParentOriginRelative = parentOriginRelative ? resolveLocalReference(filePath, parentOriginRelative) : undefined;
  if (resolvedParentOriginRelative) {
    return {
      source: "parent-origin-relative",
      rawTarget: parentOriginRelative,
      resolvedPath: resolvedParentOriginRelative
    };
  }
  if (parentTraceTarget || trimToUndefined(parsed.parentOrigin?.browseGit) || trimToUndefined(parsed.parentOrigin?.absolute)) {
    return {
      source: "external-only",
      rawTarget: parentTraceTarget || trimToUndefined(parsed.parentOrigin?.browseGit) || trimToUndefined(parsed.parentOrigin?.absolute)
    };
  }
  return { source: "none" };
}

function hasParentSignal(parsed) {
  return Boolean(
    trimToUndefined(parsed.parentCreatedAt)
    || trimToUndefined(parsed.parentTrace?.target)
    || trimToUndefined(parsed.parentSchema?.target)
    || trimToUndefined(parsed.parentSchema?.label)
    || trimToUndefined(parsed.parentOrigin?.relative)
    || trimToUndefined(parsed.parentOrigin?.absolute)
    || trimToUndefined(parsed.parentOrigin?.browseGit)
    || trimToUndefined(parsed.traceableState?.parentTracePath)
  );
}

function normalizeHeadingToken(value) {
  return value.trim().toLowerCase();
}

function collectHeadingMap(headings, level) {
  return new Set(headings.filter((heading) => heading.level === level).map((heading) => normalizeHeadingToken(heading.text)));
}

function hasAnyHeading(headingMap, candidates) {
  return candidates.some((candidate) => headingMap.has(normalizeHeadingToken(candidate)));
}

const SCHEMA_NOTE_CORE_CONTRACT_HEADING_GROUP = [
  "Schema Validation Contract",
  "Required Structure",
  "Required Fields",
  "Required Body Expectations",
  "Envelope Expectations"
];

const TASK_WORK_SIGNAL_HEADING_GROUP = [
  "Objective",
  "Requested Work",
  "Goal",
  "Target"
];

const TASK_COMPLETION_SIGNAL_HEADING_GROUP = [
  "Done Criteria",
  "Acceptance Criteria",
  "Completion Criteria",
  "Review Gate"
];

const TASK_CONSTRAINT_SIGNAL_HEADING_GROUP = [
  "Scope",
  "Scope And Constraints",
  "Constraints",
  "Non-Goals",
  "Scope And Non-Goals"
];

const TOPIC_BODY_SIGNAL_HEADING_GROUP = [
  "Summary",
  "Current Read",
  "Design Direction",
  "Relevance",
  "Risks",
  "Open Questions",
  "Next Artifacts",
  "Next Steps"
];

const ROOT_SCHEMA_REQUIRED_CONTRACT_GROUPS = [
  "Machine Authority Surfaces",
  "Contract Syntax",
  "Named Declaration",
  "Contract Category Extension",
  "Document Layout",
  "Continuity Context",
  "Parent",
  "Parent Origin",
  "Current",
  "Schema Reference Fields",
  "Trace Field",
  "Created At",
  "Envelope Extension",
  "Continuity Integrity Footer",
  "Method Entry",
  "Extension",
  "Optional Machine Sections"
];

function collectOrdinaryTraceSchemaTargetReadabilityFindings(node, readTextFileSync, workspaceRoots, gitRevisionExistsSync) {
  if (isSchemaNoteFilePath(node.filePath)) {
    return [];
  }

  const findings = [];
  const schemaTargets = [
    {
      target: node.parsed.envelopeSchema?.target,
      nonPermalinkCode: "traceable-envelope-schema-permalink-required",
      unreadableCode: "traceable-envelope-schema-unreadable",
      category: "continuity-integrity",
      label: "Envelope Schema"
    },
    {
      target: node.parsed.currentSchema?.target,
      nonPermalinkCode: "traceable-current-schema-permalink-required",
      unreadableCode: "traceable-current-schema-unreadable",
      category: "continuity-integrity",
      label: "Current Schema"
    },
    {
      target: node.parsed.parentSchema?.target,
      nonPermalinkCode: "traceable-parent-schema-permalink-required",
      unreadableCode: "traceable-parent-schema-unreadable",
      category: "direct-parent-integrity",
      label: "Parent Schema"
    }
  ];

  for (const schemaTarget of schemaTargets) {
    const target = trimToUndefined(schemaTarget.target);
    if (!target) {
      continue;
    }
    if (!parseGitHubSchemaPermalink(target)) {
      findings.push({
        code: schemaTarget.nonPermalinkCode,
        category: schemaTarget.category,
        filePath: node.filePath,
        message: `${schemaTarget.label} must use a commit-pinned schema permalink on ordinary trace artifacts.`,
        severity: "error",
        surfaces: ["problems", "report"]
      });
      continue;
    }
    if (!canReadResolvedSchemaPermalink(node.filePath, target, readTextFileSync, workspaceRoots, gitRevisionExistsSync)) {
      findings.push({
        code: schemaTarget.unreadableCode,
        category: schemaTarget.category,
        filePath: node.filePath,
        message: `${schemaTarget.label} points to a schema permalink that could not be resolved against the local repo/workspace state.`,
        severity: "error",
        surfaces: ["problems", "report"]
      });
    }
  }
  return findings;
}

function isSchemaNoteFilePath(filePath) {
  return /[\\/]\.topics[\\/]\.schemas[\\/]/u.test(path.resolve(filePath)) && !/README\.md$/iu.test(filePath);
}

function collectSchemaNoteStructureFindings(node) {
  if (!isSchemaNoteFilePath(node.filePath)) {
    return [];
  }
  const levelTwoHeadings = collectHeadingMap(node.parsed.headings, 2);
  const schemaIdentity = extractSchemaIdentity(node.parsed.currentSchema);
  const findings = [];

  if (!levelTwoHeadings.has("summary") || !hasAnyHeading(levelTwoHeadings, SCHEMA_NOTE_CORE_CONTRACT_HEADING_GROUP)) {
    const missingParts = [];
    if (!levelTwoHeadings.has("summary")) {
      missingParts.push("Summary");
    }
    if (!hasAnyHeading(levelTwoHeadings, SCHEMA_NOTE_CORE_CONTRACT_HEADING_GROUP)) {
      missingParts.push("at least one contract-bearing section such as Required Structure, Required Fields, Required Body Expectations, or Envelope Expectations");
    }
    findings.push({
      code: "schema-definition-core-contract-missing",
      category: "schema-note-structure",
      filePath: node.filePath,
      message: `Schema notes in .topics/.schemas should include ${missingParts.join(" and ")}.`,
      severity: "error",
      surfaces: ["problems", "report"]
    });
  }

  if (levelTwoHeadings.has("validation-friendly shape")) {
    if (schemaIdentity === "tiinex.definition.v1" && !levelTwoHeadings.has("machine validation contract")) {
      findings.push({
        code: "schema-machine-validation-contract-missing",
        category: "schema-note-structure",
        filePath: node.filePath,
        message: "The shared definition root should include a Machine Validation Contract section so later schema notes can reuse the same machine-facing rule set.",
        severity: "error",
        surfaces: ["problems", "report"]
      });
    }
    return findings;
  }
  findings.push({
    code: "schema-validation-friendly-shape-missing",
    category: "schema-note-structure",
    filePath: node.filePath,
    message: "Schema notes in .topics/.schemas should include a Validation-Friendly Shape section so humans and validators can scan them the same way.",
    severity: "warning",
    surfaces: ["problems", "report"]
  });
  if (schemaIdentity === "tiinex.definition.v1" && !levelTwoHeadings.has("machine validation contract")) {
    findings.push({
      code: "schema-machine-validation-contract-missing",
      category: "schema-note-structure",
      filePath: node.filePath,
      message: "The shared definition root should include a Machine Validation Contract section so later schema notes can reuse the same machine-facing rule set.",
      severity: "error",
      surfaces: ["problems", "report"]
    });
  }
  return findings;
}

function collectTaskStructureFindings(node) {
  if (isSchemaNoteFilePath(node.filePath) || extractSchemaIdentity(node.parsed.currentSchema) !== "tiinex.task.v1") {
    return [];
  }

  const levelOneHeadings = node.parsed.headings
    .filter((heading) => heading.level === 1)
    .map((heading) => normalizeHeadingToken(heading.text))
    .filter((heading) => heading !== normalizeHeadingToken("Continuity Context") && heading !== normalizeHeadingToken("Continuity Integrity"));
  const levelTwoHeadings = collectHeadingMap(node.parsed.headings, 2);
  const missingParts = [];

  if (levelOneHeadings.length === 0) {
    missingParts.push("a body title");
  }
  if (!hasAnyHeading(levelTwoHeadings, TASK_WORK_SIGNAL_HEADING_GROUP)) {
    missingParts.push("a concrete work section such as Objective or Requested Work");
  }
  if (!hasAnyHeading(levelTwoHeadings, TASK_COMPLETION_SIGNAL_HEADING_GROUP)) {
    missingParts.push("a completion section such as Done Criteria or Acceptance Criteria");
  }
  if (!hasAnyHeading(levelTwoHeadings, TASK_CONSTRAINT_SIGNAL_HEADING_GROUP)) {
    missingParts.push("a constraints section such as Scope, Scope And Constraints, or Non-Goals");
  }

  if (missingParts.length === 0) {
    return [];
  }

  return [{
    code: "task-required-structure-missing",
    category: "task-structure",
    filePath: node.filePath,
    message: `Task artifacts using tiinex.task.v1 should include ${missingParts.join(", ")}.`,
    severity: "error",
    surfaces: ["problems", "report"]
  }];
}

function collectTopicStructureFindings(node) {
  if (isSchemaNoteFilePath(node.filePath) || extractSchemaIdentity(node.parsed.currentSchema) !== "tiinex.topic.v1") {
    return [];
  }

  const levelOneHeadings = node.parsed.headings
    .filter((heading) => heading.level === 1)
    .map((heading) => normalizeHeadingToken(heading.text))
    .filter((heading) => heading !== normalizeHeadingToken("Continuity Context") && heading !== normalizeHeadingToken("Continuity Integrity"));
  const levelTwoHeadings = collectHeadingMap(node.parsed.headings, 2);
  const missingParts = [];

  if (levelOneHeadings.length === 0) {
    missingParts.push("a body title");
  }
  if (!hasAnyHeading(levelTwoHeadings, TOPIC_BODY_SIGNAL_HEADING_GROUP)) {
    missingParts.push("at least one reader-facing topic section such as Summary, Current Read, Design Direction, or Relevance");
  }

  if (missingParts.length === 0) {
    return [];
  }

  return [{
    code: "topic-required-structure-missing",
    category: "topic-structure",
    filePath: node.filePath,
    message: `Topic artifacts using tiinex.topic.v1 should include ${missingParts.join(" and ")}.`,
    severity: "error",
    surfaces: ["problems", "report"]
  }];
}

function collectContinuityParentTraceFindings(node, readTextFileSync) {
  if (isSchemaNoteFilePath(node.filePath)) {
    return [];
  }

  const parentTraceTarget = trimToUndefined(node.parsed.parentTrace?.target);
  if (!parentTraceTarget) {
    return [];
  }

  const resolvedParentTrace = resolveLocalReference(node.filePath, parentTraceTarget);
  if (!resolvedParentTrace) {
    return [{
      code: "traceable-parent-trace-unresolvable",
      category: "direct-parent-integrity",
      filePath: node.filePath,
      message: "Parent Trace should point to a locally readable trace artifact so the declared parent can be looked up directly.",
      severity: "error",
      surfaces: ["problems", "report"]
    }];
  }

  try {
    readTextFileSync(resolvedParentTrace);
    return [];
  } catch {
    return [{
      code: "traceable-parent-trace-unreadable",
      category: "direct-parent-integrity",
      filePath: node.filePath,
      message: "Parent Trace points to a trace artifact that could not be read.",
      severity: "error",
      surfaces: ["problems", "report"]
    }];
  }
}

function collectContractSectionShapeFindings(node, contract, options = {}) {
  const codePrefix = trimToUndefined(options.codePrefix) ?? "schema-validation-contract";
  const category = trimToUndefined(options.category) ?? "schema-validation-contract";
  const displayName = trimToUndefined(options.displayName) ?? "schema validation contract";

  if (!contract?.present) {
    return [];
  }

  const findings = [];

  if (contract.duplicateGroupHeadings.length > 0) {
    findings.push({
      code: `${codePrefix}-duplicate-groups`,
      category,
      filePath: node.filePath,
      message: `The ${displayName} repeats group headings: ${contract.duplicateGroupHeadings.join(", ")}.`,
      severity: "error",
      surfaces: ["problems", "report"]
    });
  }

  if (contract.categoriesMissingLists.length > 0) {
    findings.push({
      code: `${codePrefix}-category-list-missing`,
      category,
      filePath: node.filePath,
      message: `The ${displayName} has category labels without a following hyphen list: ${contract.categoriesMissingLists.join(", ")}.`,
      severity: "error",
      surfaces: ["problems", "report"]
    });
  }

  if (contract.unlabeledHyphenListLines.length > 0) {
    findings.push({
      code: `${codePrefix}-unlabeled-list`,
      category,
      filePath: node.filePath,
      message: `The ${displayName} contains hyphen list items without a preceding category label: ${contract.unlabeledHyphenListLines.join(", ")}.`,
      severity: "error",
      surfaces: ["problems", "report"]
    });
  }

  if (contract.starBulletLines.length > 0) {
    findings.push({
      code: `${codePrefix}-star-bullets-present`,
      category,
      filePath: node.filePath,
      message: `The ${displayName} contains star bullets where hyphen bullets are required: ${contract.starBulletLines.join(", ")}.`,
      severity: "error",
      surfaces: ["problems", "report"]
    });
  }

  if (contract.unexpectedContentLines.length > 0) {
    findings.push({
      code: `${codePrefix}-unexpected-content`,
      category,
      filePath: node.filePath,
      message: `The ${displayName} contains content outside the allowed heading/category/list shape: ${contract.unexpectedContentLines.join(", ")}.`,
      severity: "error",
      surfaces: ["problems", "report"]
    });
  }

  return findings;
}

function collectDeclaredSchemaValidationContractFindings(node) {
  if (!isSchemaNoteFilePath(node.filePath) || extractSchemaIdentity(node.parsed.currentSchema) === "tiinex.root.v1") {
    return [];
  }

  return collectContractSectionShapeFindings(node, node.parsed.schemaValidationContract, {
    codePrefix: "schema-validation-contract",
    category: "schema-validation-contract",
    displayName: "schema validation contract"
  });
}

function collectDeclaredArtifactCreationContractFindings(node) {
  if (!isSchemaNoteFilePath(node.filePath)) {
    return [];
  }

  return collectContractSectionShapeFindings(node, node.parsed.artifactCreationContract, {
    codePrefix: "artifact-creation-contract",
    category: "artifact-creation-contract",
    displayName: "artifact creation contract"
  });
}

function collectRootSchemaContractFindings(node) {
  if (extractSchemaIdentity(node.parsed.currentSchema) !== "tiinex.root.v1") {
    return [];
  }

  const contract = node.parsed.schemaValidationContract;
  if (!contract?.present) {
    return [{
      code: "root-schema-validation-contract-missing",
      category: "schema-validation-contract",
      filePath: node.filePath,
      message: "The root schema must include a Schema Validation Contract section.",
      severity: "error",
      surfaces: ["problems", "report"]
    }];
  }

  const findings = [];
  const groupHeadings = new Set(contract.groups.map((group) => group.heading));
  const missingGroups = ROOT_SCHEMA_REQUIRED_CONTRACT_GROUPS.filter((heading) => !groupHeadings.has(heading));

  findings.push(...collectContractSectionShapeFindings(node, contract, {
    codePrefix: "root-schema-contract",
    category: "schema-validation-contract"
  }));

  if (missingGroups.length > 0) {
    findings.push({
      code: "root-schema-contract-groups-missing",
      category: "schema-validation-contract",
      filePath: node.filePath,
      message: `The root schema contract is missing required groups: ${missingGroups.join(", ")}.`,
      severity: "error",
      surfaces: ["problems", "report"]
    });
  }

  return findings;
}

function validateRuntimeTraceStructure(parsed) {
  const currentSchemaId = trimToUndefined(parsed.currentSchema?.label) || trimToUndefined(parsed.currentSchema?.target);
  if (currentSchemaId !== "tiinex.runtime.trace.v1") {
    return undefined;
  }
  const levelTwoHeadings = collectHeadingMap(parsed.headings, 2);
  const levelThreeHeadings = collectHeadingMap(parsed.headings, 3);
  const requiredTopLevelSections = ["metadata", "request contract summary", "final output", "technical details"];
  const recommendedTopLevelSections = ["quick read", "at a glance", "outcome", "recent steps"];
  const recommendedTechnicalDetailSections = [
    "request contract preview",
    "runtime tool ledger preview",
    "usage summary",
    "evidence basis",
    "runtime decision summary",
    "runtime fingerprint",
    "iteration metrics preview",
    "child trace preview",
    "raw child output"
  ];
  const optionalStateSections = ["sender adaptation state", "traceable state", "activity timeline"];
  return {
    requiredTopLevelSectionsMissing: requiredTopLevelSections.filter((section) => !levelTwoHeadings.has(section)),
    recommendedTopLevelSectionsMissing: recommendedTopLevelSections.filter((section) => !levelTwoHeadings.has(section)),
    recommendedTechnicalDetailSectionsMissing: recommendedTechnicalDetailSections.filter((section) => !levelThreeHeadings.has(section)),
    optionalStateSectionsPresent: optionalStateSections.filter((section) => levelTwoHeadings.has(section))
  };
}

function evaluateContinuityIntegrity(markdown, footerIntegrity) {
  if (!footerIntegrity?.method && !footerIntegrity?.value) {
    return { status: "missing" };
  }
  if (footerIntegrity.method !== "sha256-base64url-c14n-v1") {
    return {
      status: "unsupported-method",
      method: footerIntegrity?.method,
      towardsTarget: footerIntegrity?.towardsTarget,
      storedValue: footerIntegrity?.value
    };
  }
  const actualValue = computeTraceableContinuityChecksumSha256(markdown);
  const storedValue = trimToUndefined(footerIntegrity.value);
  if (!storedValue) {
    return {
      status: "missing",
      method: footerIntegrity.method,
      towardsTarget: footerIntegrity.towardsTarget,
      actualValue
    };
  }
  return storedValue === actualValue
    ? {
      status: "verified",
      method: footerIntegrity.method,
      towardsTarget: footerIntegrity.towardsTarget,
      storedValue,
      actualValue
    }
    : {
      status: "mismatch",
      method: footerIntegrity.method,
      towardsTarget: footerIntegrity.towardsTarget,
      storedValue,
      actualValue
    };
}

function parseTraceableContinuityMarkdown(markdown) {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const context = parseContinuityContext(lines);
  const footerIntegrity = parseContinuityIntegrity(lines);
  return {
    envelopeSchema: context.envelopeSchema,
    currentSchema: context.currentSchema,
    parentSchema: context.parentSchema,
    parentCreatedAt: context.parentCreatedAt,
    parentTrace: context.parentTrace,
    parentOrigin: context.parentOrigin,
    currentCreatedAt: context.currentCreatedAt,
    currentWhy: context.currentWhy,
    currentSummary: context.currentSummary,
    footerIntegrity,
    traceableState: parseTraceableState(markdown),
    schemaValidationContract: parseSchemaValidationContract(markdown),
    artifactCreationContract: parseArtifactCreationContract(markdown),
    headings: parseHeadings(markdown)
  };
}

function canonicalizeTraceableContinuityChecksumSource(markdown) {
  const normalizedNewlines = markdown.replace(/\r\n?/gu, "\n");
  const withoutTrailingWhitespace = normalizedNewlines.replace(/[ \t]+$/gmu, "").trimEnd();
  const lines = withoutTrailingWhitespace.split("\n");
  if (lines.length <= 1) {
    return "";
  }
  return lines.slice(0, -1).join("\n");
}

function computeTraceableContinuityChecksumSha256(markdown) {
  return createHash("sha256")
    .update(canonicalizeTraceableContinuityChecksumSource(markdown), "utf8")
    .digest("base64url");
}

function evaluateTraceableDirectParentIntegrityCoreSync(input, options = {}) {
  if (input.checksumEnabled === false) {
    return {
      status: "disabled",
      resolvedParentTracePath: input.resolvedParentTracePath,
      storedParentTraceChecksumSha256: input.storedParentTraceChecksumSha256
    };
  }
  const resolvedParentTracePath = trimToUndefined(input.resolvedParentTracePath);
  if (!resolvedParentTracePath) {
    const storedParentTraceChecksumSha256 = trimToUndefined(input.storedParentTraceChecksumSha256);
    if (!storedParentTraceChecksumSha256) {
      return { status: "ok" };
    }
    return {
      status: "missing-parent",
      storedParentTraceChecksumSha256
    };
  }

  const normalizedChildPath = normalizePathForComparison(input.childFilePath);
  const normalizedParentPath = normalizePathForComparison(resolvedParentTracePath);
  const normalizedAncestors = new Set(
    (Array.isArray(input.knownAncestorTracePaths) ? input.knownAncestorTracePaths : [])
      .map((candidate) => normalizePathForComparison(candidate))
      .filter(Boolean)
  );
  if (normalizedParentPath && (normalizedParentPath === normalizedChildPath || normalizedAncestors.has(normalizedParentPath))) {
    return {
      status: "cycle-detected",
      resolvedParentTracePath,
      storedParentTraceChecksumSha256: input.storedParentTraceChecksumSha256
    };
  }

  const readTextFileSync = typeof options.readTextFileSync === "function" ? options.readTextFileSync : (filePath) => readFileSync(filePath, "utf8");
  let parentMarkdown;
  try {
    parentMarkdown = readTextFileSync(resolvedParentTracePath);
  } catch {
    return {
      status: "unreadable-parent",
      resolvedParentTracePath,
      storedParentTraceChecksumSha256: input.storedParentTraceChecksumSha256
    };
  }

  const actualParentTraceChecksumSha256 = computeTraceableContinuityChecksumSha256(parentMarkdown);
  const storedParentTraceChecksumSha256 = trimToUndefined(input.storedParentTraceChecksumSha256);
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

function validateTraceableContinuityArtifactChainSync(input) {
  const readTextFileSync = typeof input.readTextFileSync === "function" ? input.readTextFileSync : (filePath) => readFileSync(filePath, "utf8");
  const maxDepth = Number.isInteger(input.maxDepth) && input.maxDepth > 0 ? input.maxDepth : 32;
  const rootFilePath = path.resolve(input.filePath);
  const nodes = [];
  const visited = new Set();
  let currentFilePath = rootFilePath;
  let stoppedBecause = "complete";

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const normalizedCurrentPath = normalizePathForComparison(currentFilePath);
    if (normalizedCurrentPath && visited.has(normalizedCurrentPath)) {
      stoppedBecause = "cycle-detected";
      break;
    }
    if (normalizedCurrentPath) {
      visited.add(normalizedCurrentPath);
    }
    let markdown;
    try {
      markdown = readTextFileSync(currentFilePath);
    } catch {
      stoppedBecause = "unreadable-parent";
      break;
    }

    const parsed = parseTraceableContinuityMarkdown(markdown);
    const backwardLink = chooseBackwardLink(currentFilePath, parsed);
    const currentSchemaIdentity = extractSchemaIdentity(parsed.currentSchema);
    const selfRootSchemaNote = currentSchemaIdentity === "tiinex.definition.v1"
      && normalizePathForComparison(backwardLink.resolvedPath) === normalizedCurrentPath;
    const traceableParentIntegrity = parsed.traceableState?.parentTracePath && !selfRootSchemaNote
      ? evaluateTraceableDirectParentIntegrityCoreSync({
        childFilePath: currentFilePath,
        resolvedParentTracePath: resolveLocalReference(currentFilePath, parsed.traceableState.parentTracePath),
        storedParentTraceChecksumSha256: parsed.traceableState.parentTraceChecksumSha256,
        knownAncestorTracePaths: nodes.map((node) => node.filePath),
        checksumEnabled: true
      }, { readTextFileSync })
      : undefined;
    const node = {
      filePath: currentFilePath,
      parsed,
      backwardLink,
      continuityIntegrity: evaluateContinuityIntegrity(markdown, parsed.footerIntegrity),
      traceableParentIntegrity,
      runtimeTraceStructure: validateRuntimeTraceStructure(parsed)
    };
    nodes.push(node);

    if (selfRootSchemaNote) {
      stoppedBecause = "complete";
      break;
    }

    if (!backwardLink.resolvedPath) {
      stoppedBecause = backwardLink.source === "external-only" ? "external-parent" : "complete";
      break;
    }
    const normalizedParentPath = normalizePathForComparison(backwardLink.resolvedPath);
    if (normalizedParentPath && visited.has(normalizedParentPath)) {
      stoppedBecause = "cycle-detected";
      break;
    }
    currentFilePath = backwardLink.resolvedPath;
  }

  if (nodes.length >= maxDepth && stoppedBecause === "complete") {
    stoppedBecause = "max-depth";
  }

  const findings = collectTraceableContinuityFindings({
    nodes,
    stoppedBecause,
    readTextFileSync,
    workspaceRoots: input.workspaceRoots,
    gitRevisionExistsSync: input.gitRevisionExistsSync
  });

  return {
    rootFilePath,
    nodes,
    findings,
    stoppedBecause
  };
}

function collectTraceableContinuityFindings(result) {
  const findings = [];
  const readTextFileSync = typeof result.readTextFileSync === "function" ? result.readTextFileSync : (filePath) => readFileSync(filePath, "utf8");
  const workspaceRoots = Array.isArray(result.workspaceRoots) ? result.workspaceRoots : [];
  const gitRevisionExistsSync = typeof result.gitRevisionExistsSync === "function" ? result.gitRevisionExistsSync : undefined;

  for (let index = 0; index < result.nodes.length; index += 1) {
    const node = result.nodes[index];
    const parentNode = result.nodes[index + 1];
    const parentSignalPresent = hasParentSignal(node.parsed);

    findings.push(...collectSchemaNoteStructureFindings(node));
    findings.push(...collectDeclaredSchemaValidationContractFindings(node));
    findings.push(...collectDeclaredArtifactCreationContractFindings(node));
    findings.push(...collectRootSchemaContractFindings(node));
    findings.push(...collectTaskStructureFindings(node));
    findings.push(...collectTopicStructureFindings(node));
    findings.push(...collectOrdinaryTraceSchemaTargetReadabilityFindings(node, readTextFileSync, workspaceRoots, gitRevisionExistsSync));
    findings.push(...collectContinuityParentTraceFindings(node, readTextFileSync));

    if (!trimToUndefined(node.parsed.currentCreatedAt)) {
      findings.push({
        code: "continuity-current-created-at-missing",
        category: "continuity-integrity",
        filePath: node.filePath,
        message: "Current Created At is required by the continuity envelope.",
        severity: "error",
        surfaces: ["problems", "report"]
      });
    }

    if (parentSignalPresent && !extractSchemaIdentity(node.parsed.parentSchema)) {
      findings.push({
        code: "traceable-parent-schema-missing",
        category: "direct-parent-integrity",
        filePath: node.filePath,
        message: "Parent signal is present but Parent Schema is missing from the continuity header.",
        severity: "warning",
        surfaces: ["problems", "report"]
      });
    }

    if (parentSignalPresent && !trimToUndefined(node.parsed.parentCreatedAt)) {
      findings.push({
        code: "traceable-parent-created-at-missing",
        category: "direct-parent-integrity",
        filePath: node.filePath,
        message: "Parent signal is present but Parent Created At is missing from the continuity header.",
        severity: "warning",
        surfaces: ["problems", "report"]
      });
    }

    switch (node.continuityIntegrity?.status) {
      case "missing":
        findings.push({
          code: "continuity-checksum-missing",
          category: "continuity-integrity",
          filePath: node.filePath,
          message: "Continuity Integrity footer is missing or incomplete.",
          severity: "error",
          surfaces: ["problems", "report"]
        });
        break;
      case "mismatch":
        findings.push({
          code: "continuity-checksum-mismatch",
          category: "continuity-integrity",
          filePath: node.filePath,
          message: "Continuity footer checksum does not match the current artifact body.",
          severity: "error",
          surfaces: ["problems", "report"]
        });
        break;
      default:
        break;
    }

    const declaredParentSchemaIdentity = extractSchemaIdentity(node.parsed.parentSchema);
    const resolvedParentSchemaIdentity = extractSchemaIdentity(parentNode?.parsed.currentSchema);
    if (declaredParentSchemaIdentity && resolvedParentSchemaIdentity && declaredParentSchemaIdentity !== resolvedParentSchemaIdentity) {
      findings.push({
        code: "traceable-parent-schema-mismatch",
        category: "direct-parent-integrity",
        filePath: node.filePath,
        message: "Parent Schema does not match the resolved parent artifact's current schema.",
        severity: "error",
        surfaces: ["problems", "report"]
      });
    }

    if (trimToUndefined(node.parsed.parentCreatedAt) && !isTraceableContinuityTimestamp(node.parsed.parentCreatedAt)) {
      findings.push({
        code: "traceable-parent-created-at-invalid",
        category: "direct-parent-integrity",
        filePath: node.filePath,
        message: "Parent Created At is not in the expected YYYY-MM-DD hh:mm:ss shape.",
        severity: "error",
        surfaces: ["problems", "report"]
      });
    }

    if (trimToUndefined(node.parsed.currentCreatedAt) && !isTraceableContinuityTimestamp(node.parsed.currentCreatedAt)) {
      findings.push({
        code: "continuity-current-created-at-invalid",
        category: "continuity-integrity",
        filePath: node.filePath,
        message: "Current Created At is not in the expected YYYY-MM-DD hh:mm:ss shape.",
        severity: "error",
        surfaces: ["problems", "report"]
      });
    }

    if (trimToUndefined(node.parsed.parentOrigin?.browseGit) && !isCommitPinnedBrowseGitTarget(node.parsed.parentOrigin.browseGit)) {
      findings.push({
        code: "traceable-parent-origin-unpinned-browse-git",
        category: "direct-parent-integrity",
        filePath: node.filePath,
        message: "Parent Origin browse + git target is not commit-pinned.",
        severity: "error",
        surfaces: ["problems", "report"]
      });
    }

    switch (node.traceableParentIntegrity?.status) {
      case "missing-parent":
        findings.push({
          code: "traceable-parent-missing-parent",
          category: "direct-parent-integrity",
          filePath: node.filePath,
          message: "Traceable State parentTracePath points to a missing parent artifact.",
          severity: "error",
          surfaces: ["problems", "report"]
        });
        break;
      case "unreadable-parent":
        findings.push({
          code: "traceable-parent-unreadable-parent",
          category: "direct-parent-integrity",
          filePath: node.filePath,
          message: "Traceable State parentTracePath points to a parent artifact that could not be read.",
          severity: "error",
          surfaces: ["problems", "report"]
        });
        break;
      case "checksum-mismatch":
        findings.push({
          code: "traceable-parent-checksum-mismatch",
          category: "direct-parent-integrity",
          filePath: node.filePath,
          message: "Direct-parent checksum does not match the resolved parent artifact.",
          severity: "error",
          surfaces: ["problems", "report"]
        });
        break;
      case "cycle-detected":
        findings.push({
          code: "traceable-parent-cycle-detected",
          category: "direct-parent-integrity",
          filePath: node.filePath,
          message: "Traceable parent linkage would create a lineage cycle.",
          severity: "error",
          surfaces: ["problems", "report"]
        });
        break;
      default:
        break;
    }

    if (node.runtimeTraceStructure?.requiredTopLevelSectionsMissing.length > 0) {
      findings.push({
        code: "runtime-required-sections-missing",
        category: "runtime-trace-structure",
        filePath: node.filePath,
        message: `Required runtime sections are missing: ${node.runtimeTraceStructure.requiredTopLevelSectionsMissing.join(", ")}.`,
        severity: "warning",
        surfaces: ["problems", "report"]
      });
    }

    if (node.runtimeTraceStructure?.recommendedTopLevelSectionsMissing.length > 0) {
      findings.push({
        code: "runtime-recommended-sections-missing",
        category: "runtime-trace-structure",
        filePath: node.filePath,
        message: `Recommended runtime sections are missing: ${node.runtimeTraceStructure.recommendedTopLevelSectionsMissing.join(", ")}.`,
        severity: "information",
        surfaces: ["problems", "report"]
      });
    }

    if (node.runtimeTraceStructure?.recommendedTechnicalDetailSectionsMissing.length > 0) {
      findings.push({
        code: "runtime-technical-detail-sections-missing",
        category: "runtime-trace-structure",
        filePath: node.filePath,
        message: `Recommended technical-detail sections are missing: ${node.runtimeTraceStructure.recommendedTechnicalDetailSectionsMissing.join(", ")}.`,
        severity: "information",
        surfaces: ["problems", "report"]
      });
    }
  }

  switch (result.stoppedBecause) {
    case "unreadable-parent":
      findings.push({
        code: "backward-validation-unreadable-parent",
        category: "backward-traversal",
        filePath: result.nodes[0]?.filePath ?? "",
        message: "Backward validation stopped because an ancestor parent artifact could not be read.",
        severity: "warning",
        surfaces: ["problems", "report"]
      });
      break;
    case "cycle-detected":
      findings.push({
        code: "backward-validation-cycle-detected",
        category: "backward-traversal",
        filePath: result.nodes[0]?.filePath ?? "",
        message: "Backward validation stopped because the lineage contains a cycle.",
        severity: "error",
        surfaces: ["problems", "report"]
      });
      break;
    default:
      break;
  }

  return findings;
}

function formatContinuityIntegrityStatus(validation) {
  switch (validation?.status) {
    case "verified":
      return "verified";
    case "missing":
      return "missing";
    case "mismatch":
      return "mismatch";
    case "unsupported-method":
      return validation.method ? `unsupported method (${validation.method})` : "unsupported method";
    default:
      return "-";
  }
}

function formatDirectParentIntegrityStatus(validation) {
  switch (validation?.status) {
    case "ok":
      return "verified";
    case "legacy-no-checksum":
      return "legacy-unverified";
    case "missing-parent":
      return "missing parent";
    case "unreadable-parent":
      return "unreadable parent";
    case "checksum-mismatch":
      return "checksum mismatch";
    case "cycle-detected":
      return "cycle detected";
    case "disabled":
      return "disabled";
    default:
      return "-";
  }
}

function formatBackwardLinkSource(source) {
  switch (source) {
    case "traceable-state-parent":
      return "Traceable State parentTracePath";
    case "parent-trace":
      return "Continuity Parent Trace";
    case "parent-origin-relative":
      return "Continuity Parent Origin relative";
    case "external-only":
      return "external-only parent reference";
    case "none":
    default:
      return "none";
  }
}

function renderTraceableContinuityValidationMarkdown(result) {
  const lines = [
    "# Traceable Continuity Validation",
    "",
    `- Root File: ${result.rootFilePath}`,
    `- Nodes Read: ${result.nodes.length}`,
    `- Stopped Because: ${result.stoppedBecause}`,
    `- Findings: ${result.findings.length}`,
    ""
  ];

  if (result.findings.length > 0) {
    lines.push("## Findings", "");
    for (const finding of result.findings) {
      lines.push(`- [${finding.severity}] ${finding.code}: ${finding.message}`);
    }
    lines.push("");
  }

  for (let index = 0; index < result.nodes.length; index += 1) {
    const node = result.nodes[index];
    const runtimeStructure = node.runtimeTraceStructure;
    lines.push(`## Node ${index + 1}`, "");
    lines.push(`- File: ${node.filePath}`);
    lines.push(`- Current Schema: ${node.parsed.currentSchema?.label ?? node.parsed.currentSchema?.target ?? "-"}`);
    lines.push(`- Parent Schema: ${node.parsed.parentSchema?.label ?? node.parsed.parentSchema?.target ?? "-"}`);
    lines.push(`- Parent Created At: ${node.parsed.parentCreatedAt ?? "-"}`);
    lines.push(`- Current Created At: ${node.parsed.currentCreatedAt ?? "-"}`);
    lines.push(`- Current Why: ${node.parsed.currentWhy ?? "-"}`);
    lines.push(`- Current Summary: ${node.parsed.currentSummary ?? "-"}`);
    lines.push(`- Backward Link Source: ${formatBackwardLinkSource(node.backwardLink.source)}`);
    lines.push(`- Backward Link Target: ${node.backwardLink.rawTarget ?? "-"}`);
    lines.push(`- Resolved Parent Path: ${node.backwardLink.resolvedPath ?? "-"}`);
    lines.push(`- Continuity Integrity: ${formatContinuityIntegrityStatus(node.continuityIntegrity)}`);
    if (node.continuityIntegrity?.status === "mismatch") {
      lines.push(`- Stored Continuity Checksum: ${node.continuityIntegrity.storedValue ?? "-"}`);
      lines.push(`- Actual Continuity Checksum: ${node.continuityIntegrity.actualValue ?? "-"}`);
    }
    if (node.traceableParentIntegrity) {
      lines.push(`- Direct Parent Integrity: ${formatDirectParentIntegrityStatus(node.traceableParentIntegrity)}`);
      if (node.traceableParentIntegrity.status === "checksum-mismatch") {
        lines.push(`- Stored Parent Checksum: ${node.traceableParentIntegrity.storedParentTraceChecksumSha256 ?? "-"}`);
        lines.push(`- Actual Parent Checksum: ${node.traceableParentIntegrity.actualParentTraceChecksumSha256 ?? "-"}`);
      }
    }
    if (runtimeStructure) {
      lines.push(`- Missing Required Runtime Sections: ${runtimeStructure.requiredTopLevelSectionsMissing.length > 0 ? runtimeStructure.requiredTopLevelSectionsMissing.join(" | ") : "-"}`);
      lines.push(`- Missing Recommended Runtime Sections: ${runtimeStructure.recommendedTopLevelSectionsMissing.length > 0 ? runtimeStructure.recommendedTopLevelSectionsMissing.join(" | ") : "-"}`);
      lines.push(`- Missing Recommended Technical Detail Sections: ${runtimeStructure.recommendedTechnicalDetailSectionsMissing.length > 0 ? runtimeStructure.recommendedTechnicalDetailSectionsMissing.join(" | ") : "-"}`);
      lines.push(`- Optional State Sections Present: ${runtimeStructure.optionalStateSectionsPresent.length > 0 ? runtimeStructure.optionalStateSectionsPresent.join(" | ") : "-"}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

module.exports = {
  canonicalizeTraceableContinuityChecksumSource,
  computeTraceableContinuityChecksumSha256,
  evaluateTraceableDirectParentIntegrityCoreSync,
  parseTraceableContinuityMarkdown,
  renderTraceableContinuityValidationMarkdown,
  validateTraceableContinuityArtifactChainSync
};