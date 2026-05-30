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
 *   currentSchema?: { id?: string, target?: string },
 *   parentSchema?: { id?: string, target?: string },
 *   parentTrace?: { label?: string, target?: string },
 *   parentOrigin?: { relative?: string, absolute?: string, browseGit?: string },
 *   footerIntegrity?: { method?: string, towardsLabel?: string, towardsTarget?: string, value?: string },
 *   traceableState?: { schema?: string, parentTracePath?: string, parentTraceChecksumSha256?: string, lineageLabel?: string, lineageDepth?: number },
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
 *   readTextFileSync?: (filePath: string) => string
 * }} ValidateTraceableContinuityArtifactChainInput
 */

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

function extractLabeledValue(line, label) {
  const match = line.match(new RegExp(`^-\\s+${label}:\\s+(.*)$`, "u"));
  return match ? trimToUndefined(match[1]) : undefined;
}

function extractNestedLabeledValue(line, label) {
  const match = line.match(new RegExp(`^\\s{2,}-\\s+${label}:\\s+(.*)$`, "u"));
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

function parseContinuityContext(lines) {
  const result = {
    currentSchema: undefined,
    parentSchema: undefined,
    parentTrace: undefined,
    parentOrigin: {},
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

    if (currentTopLevel === "parent" && /^\s{2,}-\s+Origin:\s*$/u.test(line)) {
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
      const parentTraceValue = extractNestedLabeledValue(line, "Trace");
      if (parentTraceValue) {
        result.parentTrace = extractMarkdownLink(parentTraceValue);
        inParentOrigin = false;
        continue;
      }
      if (inParentOrigin) {
        const originMatch = line.match(/^\s{4,}-\s+\[(relative|absolute|browse \+ git)\]\((.*?)\)\s*$/u);
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

function normalizeHeadingToken(value) {
  return value.trim().toLowerCase();
}

function collectHeadingMap(headings, level) {
  return new Set(headings.filter((heading) => heading.level === level).map((heading) => normalizeHeadingToken(heading.text)));
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
    currentSchema: context.currentSchema,
    parentSchema: context.parentSchema,
    parentTrace: context.parentTrace,
    parentOrigin: context.parentOrigin,
    footerIntegrity,
    traceableState: parseTraceableState(markdown),
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
    const traceableParentIntegrity = parsed.traceableState?.parentTracePath
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
    stoppedBecause
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

  for (const node of result.nodes) {
    switch (node.continuityIntegrity?.status) {
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