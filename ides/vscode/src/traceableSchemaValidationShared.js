const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

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

function extractLabeledFieldName(line) {
  const match = line.match(/^-\s+([^:]+):\s+.*$/u);
  return match ? trimToUndefined(match[1]) : undefined;
}

function extractNestedLabeledValue(line, label) {
  const match = line.match(new RegExp(`^\\s{2,}-\\s+${label}:\\s+(.*)$`, "u"));
  return match ? trimToUndefined(match[1]) : undefined;
}

function extractNestedLabeledFieldName(line) {
  const match = line.match(/^\s{2,}-\s+([^:]+):\s+.*$/u);
  return match ? trimToUndefined(match[1]) : undefined;
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

function resolveGitRootForPath(filePath) {
  let currentPath = path.dirname(path.resolve(filePath));
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

function normalizeGitHubBrowseBaseUrl(remoteUrl) {
  const trimmed = trimToUndefined(remoteUrl);
  if (!trimmed) {
    return undefined;
  }
  const sshMatch = trimmed.match(/^git@github\.com:(.+?)(?:\.git)?$/iu);
  if (sshMatch) {
    return `https://github.com/${sshMatch[1]}`;
  }
  const httpsMatch = trimmed.match(/^https:\/\/github\.com\/(.+?)(?:\.git)?$/iu);
  if (httpsMatch) {
    return `https://github.com/${httpsMatch[1]}`;
  }
  return undefined;
}

function parseGitHubPermalinkTarget(target) {
  const trimmed = trimToUndefined(target);
  if (!trimmed) {
    return undefined;
  }
  const match = trimmed.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/(?:blob|raw)\/([0-9a-f]{7,40})\/(.+)$/iu);
  if (!match) {
    return undefined;
  }
  return {
    repoSlug: match[1],
    commitHash: match[2],
    relativePath: decodeURIComponent(match[3])
  };
}

function parseHeadings(markdown) {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const headings = [];
  let inFence = false;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (/^```/u.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    const match = line.match(/^(#{1,6})\s+(.+)$/u);
    if (!match) {
      continue;
    }
    headings.push({
      level: match[1].length,
      text: match[2].trim(),
      lineNumber: lineIndex + 1
    });
  }

  return headings;
}

function parseContinuityContext(lines) {
  const parsed = {
    envelopeFieldEntries: [],
    parentFieldEntries: [],
    currentFieldEntries: []
  };
  let inContext = false;
  let inParent = false;
  let inParentOrigin = false;
  let inCurrent = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!inContext) {
      if (trimmed === "# Continuity Context") {
        inContext = true;
      }
      continue;
    }
    if (trimmed === "---") {
      break;
    }

    const envelopeSchema = extractLabeledValue(trimmed, "Envelope Schema");
    if (envelopeSchema) {
      parsed.envelopeFieldEntries.push({ label: "Envelope Schema", lineText: trimmed });
      parsed.envelopeSchema = extractMarkdownLink(envelopeSchema);
      inParent = false;
      inCurrent = false;
      continue;
    }
    const blockFieldMatch = line.match(/^-\s+([^:]+)$/u);
    if (blockFieldMatch) {
      const blockLabel = trimToUndefined(blockFieldMatch[1]);
      if (blockLabel) {
        parsed.envelopeFieldEntries.push({ label: blockLabel, lineText: trimToUndefined(line) ?? trimmed });
      }
      inParent = blockLabel === "Parent";
      inParentOrigin = false;
      inCurrent = blockLabel === "Current";
      continue;
    }
    if (inParent) {
      if (/^\s{2,}-\s+Origin:\s*$/u.test(line)) {
        parsed.parentOrigin = {};
        inParentOrigin = true;
        continue;
      }
      if (inParentOrigin) {
        const originMatch = line.match(/^\s{4,}-\s+\[(relative|absolute|browse \+ git)\]\((.*?)\)\s*$/u);
        if (originMatch) {
          const key = originMatch[1] === "browse + git" ? "browseGit" : originMatch[1];
          parsed.parentOrigin[key] = trimToUndefined(originMatch[2]);
          continue;
        }
        if (!/^\s{4,}-\s+/u.test(line)) {
          inParentOrigin = false;
        }
      }
      const parentFieldName = extractNestedLabeledFieldName(line);
      if (parentFieldName) {
        parsed.parentFieldEntries.push({ label: parentFieldName, lineText: line.trim() });
      }
      const parentSchema = extractNestedLabeledValue(line, "Parent Schema");
      if (parentSchema) {
        parsed.parentSchema = extractMarkdownLink(parentSchema);
        continue;
      }
      const parentCreatedAt = extractNestedLabeledValue(line, "Created At");
      if (parentCreatedAt) {
        parsed.parentCreatedAt = parentCreatedAt;
        continue;
      }
      const parentTrace = extractNestedLabeledValue(line, "Trace");
      if (parentTrace) {
        parsed.parentTrace = extractMarkdownLink(parentTrace);
      }
      continue;
    }
    if (inCurrent) {
      const currentFieldName = extractNestedLabeledFieldName(line);
      if (currentFieldName) {
        parsed.currentFieldEntries.push({ label: currentFieldName, lineText: line.trim() });
      }
      const currentSchema = extractNestedLabeledValue(line, "Current Schema");
      if (currentSchema) {
        parsed.currentSchema = extractMarkdownLink(currentSchema);
        continue;
      }
      const currentCreatedAt = extractNestedLabeledValue(line, "Created At");
      if (currentCreatedAt) {
        parsed.currentCreatedAt = currentCreatedAt;
        continue;
      }
      const currentSummary = extractNestedLabeledValue(line, "Summary");
      if (currentSummary) {
        parsed.currentSummary = currentSummary;
      }
    }
  }

  return parsed;
}

function parseContinuityIntegrity(lines) {
  const parsed = {};
  const entries = [];
  let currentEntry;
  let inIntegrity = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!inIntegrity) {
      if (trimmed === "# Continuity Integrity") {
        inIntegrity = true;
      }
      continue;
    }
    if (!trimmed) {
      continue;
    }
    const methodMatch = trimmed.match(/^-\s+([^:]+)$/u);
    if (methodMatch) {
      currentEntry = { method: trimToUndefined(methodMatch[1]) };
      entries.push(currentEntry);
      continue;
    }
    const towards = extractNestedLabeledValue(line, "Towards");
    if (towards) {
      if (!currentEntry) {
        currentEntry = {};
        entries.push(currentEntry);
      }
      const link = extractMarkdownLink(towards);
      currentEntry.towardsLabel = link.label;
      currentEntry.towardsTarget = link.target;
      continue;
    }
    const value = extractNestedLabeledValue(line, "Value");
    if (value) {
      if (!currentEntry) {
        currentEntry = {};
        entries.push(currentEntry);
      }
      currentEntry.value = value;
    }
  }
  const preferredEntry = [...entries].reverse().find((entry) => entry?.method === "sha256-base64url-c14n-v2" && entry?.towardsTarget === "self")
    ?? entries[entries.length - 1];
  if (preferredEntry) {
    parsed.method = preferredEntry.method;
    parsed.towardsLabel = preferredEntry.towardsLabel;
    parsed.towardsTarget = preferredEntry.towardsTarget;
    parsed.value = preferredEntry.value;
  }
  if (entries.length > 0) {
    parsed.entries = entries;
  }
  return parsed;
}

function parseContractSection(markdown, sectionHeading) {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const startIndex = lines.findIndex((line) => line.trim() === `## ${sectionHeading}`);
  if (startIndex < 0) {
    return {
      present: false,
      groups: [],
      duplicateGroupHeadings: [],
      duplicateCategoryLabels: [],
      duplicateDeclarationNames: [],
      categoriesMissingLists: [],
      unlabeledHyphenListLines: [],
      starBulletLines: [],
      plusBulletLines: [],
      unexpectedContentLines: []
    };
  }

  const groups = [];
  const duplicateGroupHeadings = [];
  const duplicateCategoryLabels = [];
  const duplicateDeclarationNames = [];
  const categoriesMissingLists = [];
  const unlabeledHyphenListLines = [];
  const starBulletLines = [];
  const plusBulletLines = [];
  const unexpectedContentLines = [];
  const seenGroupHeadings = new Set();
  let currentGroup;
  let currentCategory;
  let currentDeclaration;
  let seenCategoryLabelsInGroup = new Set();
  let seenDeclarationNamesInGroup = new Set();

  function groupSupportsNamedDeclarations() {
    return currentGroup && ["Contract Category Extension", "Contract Category Override", "Envelope Extension", "Extension"].includes(currentGroup.heading);
  }

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
    const headingMatch = trimmed.match(/^###\s+(.+)$/u);
    if (headingMatch) {
      finalizePendingCategory();
      currentCategory = undefined;
      currentDeclaration = undefined;
      const heading = trimToUndefined(headingMatch[1]);
      if (!heading) {
        continue;
      }
      if (seenGroupHeadings.has(heading)) {
        duplicateGroupHeadings.push(heading);
      }
      seenGroupHeadings.add(heading);
      currentGroup = { heading, categories: [], declarations: [] };
      seenCategoryLabelsInGroup = new Set();
      seenDeclarationNamesInGroup = new Set();
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
    if (/^(\+|\s+\+)\s+/u.test(line)) {
      plusBulletLines.push(trimmed);
      continue;
    }

    if (currentDeclaration && /^\s{2,}-\s+/u.test(line)) {
      currentDeclaration.fields.push(trimmed.replace(/^\s*-\s+/u, ""));
      continue;
    }

    if (groupSupportsNamedDeclarations() && !currentCategory && /^-\s+(.+)$/u.test(line)) {
      const declarationName = trimToUndefined(trimmed.replace(/^-\s+/u, ""));
      if (declarationName) {
        if (seenDeclarationNamesInGroup.has(declarationName)) {
          duplicateDeclarationNames.push(`${currentGroup.heading} -> ${declarationName}`);
        }
        seenDeclarationNamesInGroup.add(declarationName);
        currentDeclaration = { name: declarationName, fields: [] };
        currentGroup.declarations.push(currentDeclaration);
        continue;
      }
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
      currentDeclaration = undefined;
      if (seenCategoryLabelsInGroup.has(trimmed)) {
        duplicateCategoryLabels.push(`${currentGroup.heading} -> ${trimmed}`);
      }
      seenCategoryLabelsInGroup.add(trimmed);
      currentCategory = { label: trimmed, items: [] };
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
    duplicateCategoryLabels,
    duplicateDeclarationNames,
    categoriesMissingLists,
    unlabeledHyphenListLines,
    starBulletLines,
    plusBulletLines,
    unexpectedContentLines
  };
}

function parseSchemaNoteMarkdown(markdown) {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const continuityContext = parseContinuityContext(lines);
  return {
    envelopeFieldEntries: continuityContext.envelopeFieldEntries,
    envelopeSchema: continuityContext.envelopeSchema,
    parentFieldEntries: continuityContext.parentFieldEntries,
    parentSchema: continuityContext.parentSchema,
    parentCreatedAt: continuityContext.parentCreatedAt,
    parentTrace: continuityContext.parentTrace,
    parentOrigin: continuityContext.parentOrigin,
    currentFieldEntries: continuityContext.currentFieldEntries,
    currentSchema: continuityContext.currentSchema,
    currentCreatedAt: continuityContext.currentCreatedAt,
    currentSummary: continuityContext.currentSummary,
    footerIntegrity: parseContinuityIntegrity(lines),
    schemaValidationContract: parseContractSection(markdown, "Schema Validation Contract"),
    artifactCreationContract: parseContractSection(markdown, "Artifact Creation Contract"),
    headings: parseHeadings(markdown)
  };
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

function canonicalizeTraceableContinuityChecksumSourceV1(markdown) {
  const normalizedNewlines = markdown.replace(/\r\n?/gu, "\n");
  const withoutTrailingWhitespace = normalizedNewlines.replace(/[ \t]+$/gmu, "").trimEnd();
  const lines = withoutTrailingWhitespace.split("\n");
  const integrityHeadingIndex = lines.findIndex((line) => line.trim() === "# Continuity Integrity");
  if (integrityHeadingIndex >= 0) {
    return lines.slice(0, integrityHeadingIndex).join("\n");
  }
  return withoutTrailingWhitespace;
}

function canonicalizeTraceableContinuityChecksumSourceV2(markdown) {
  const normalizedNewlines = markdown.replace(/\r\n?/gu, "\n");
  const withoutTrailingWhitespace = normalizedNewlines.replace(/[ \t]+$/gmu, "").trimEnd();
  const lines = withoutTrailingWhitespace.split("\n");
  const integrityHeadingIndex = lines.findIndex((line) => line.trim() === "# Continuity Integrity");
  if (integrityHeadingIndex < 0) {
    return withoutTrailingWhitespace;
  }

  const entries = [];
  let currentEntry;
  for (let index = integrityHeadingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const methodMatch = line.match(/^-\s+([^:]+)$/u);
    if (methodMatch) {
      currentEntry = {
        method: trimToUndefined(methodMatch[1]),
        valueLineIndex: undefined,
        towardsTarget: undefined
      };
      entries.push(currentEntry);
      continue;
    }
    const towardsValue = extractNestedLabeledValue(line, "Towards");
    if (towardsValue) {
      if (!currentEntry) {
        currentEntry = { method: undefined, valueLineIndex: undefined, towardsTarget: undefined };
        entries.push(currentEntry);
      }
      currentEntry.towardsTarget = extractMarkdownLink(towardsValue).target;
      continue;
    }
    if (/^\s*-\s+Value:\s*.*$/u.test(line)) {
      if (!currentEntry) {
        currentEntry = { method: undefined, valueLineIndex: undefined, towardsTarget: undefined };
        entries.push(currentEntry);
      }
      currentEntry.valueLineIndex = index;
    }
  }

  if (entries.length === 0) {
    return withoutTrailingWhitespace;
  }

  let preferredEntry = entries[entries.length - 1];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.method === "sha256-base64url-c14n-v2" && entry?.towardsTarget === "self") {
      preferredEntry = entry;
      break;
    }
  }

  if (Number.isInteger(preferredEntry?.valueLineIndex)) {
    lines[preferredEntry.valueLineIndex] = lines[preferredEntry.valueLineIndex].replace(/^(\s*-\s+Value:\s*).*$/u, "$1");
  }

  return lines.join("\n");
}

function computeTraceableContinuityChecksumSha256(markdown, method = "sha256-base64url-c14n-v1") {
  const canonicalSource = method === "sha256-base64url-c14n-v2"
    ? canonicalizeTraceableContinuityChecksumSourceV2(markdown)
    : canonicalizeTraceableContinuityChecksumSourceV1(markdown);
  return createHash("sha256")
    .update(canonicalSource, "utf8")
    .digest("base64url");
}

function readPermalinkTargetMarkdown(filePath, permalinkTarget) {
  const permalink = parseGitHubPermalinkTarget(permalinkTarget);
  if (!permalink) {
    return undefined;
  }
  const gitRoot = resolveGitRootForPath(filePath);
  if (!gitRoot) {
    return undefined;
  }
  try {
    const remoteUrl = execFileSync("git", ["-C", gitRoot, "config", "--get", "remote.origin.url"], { encoding: "utf8" }).trim();
    const browseBaseUrl = normalizeGitHubBrowseBaseUrl(remoteUrl);
    if (browseBaseUrl !== `https://github.com/${permalink.repoSlug}`) {
      return undefined;
    }
    return execFileSync("git", ["-C", gitRoot, "show", `${permalink.commitHash}:${permalink.relativePath}`], { encoding: "utf8" });
  } catch {
    return undefined;
  }
}

function computeTargetedTraceableContinuityChecksumSha256(filePath, markdown, footerIntegrity, readTextFileSync) {
  const method = trimToUndefined(footerIntegrity?.method) || "sha256-base64url-c14n-v1";
  const target = trimToUndefined(footerIntegrity?.towardsTarget);
  if (!target || target === "self") {
    return computeTraceableContinuityChecksumSha256(markdown, method);
  }
  if (isExternalUrl(target)) {
    const targetMarkdown = readPermalinkTargetMarkdown(filePath, target);
    if (!targetMarkdown) {
      return undefined;
    }
    if (method === "sha256-base64url-c14n-v2") {
      const targetParsed = parseSchemaNoteMarkdown(targetMarkdown);
      const targetMethod = trimToUndefined(targetParsed.footerIntegrity?.method);
      const targetTowards = trimToUndefined(targetParsed.footerIntegrity?.towardsTarget);
      if (targetMethod !== "sha256-base64url-c14n-v2" || (targetTowards && targetTowards !== "self")) {
        return undefined;
      }
      return computeTraceableContinuityChecksumSha256(targetMarkdown, "sha256-base64url-c14n-v2");
    }
    return computeTraceableContinuityChecksumSha256(targetMarkdown, method);
  }
  const resolvedTargetPath = resolveRelativeSchemaPath(filePath, target);
  if (!resolvedTargetPath) {
    return undefined;
  }
  try {
    const targetMarkdown = readSchemaFileSync(resolvedTargetPath, readTextFileSync);
    if (method === "sha256-base64url-c14n-v2") {
      const targetParsed = parseSchemaNoteMarkdown(targetMarkdown);
      const targetMethod = trimToUndefined(targetParsed.footerIntegrity?.method);
      const targetTowards = trimToUndefined(targetParsed.footerIntegrity?.towardsTarget);
      if (targetMethod !== "sha256-base64url-c14n-v2" || (targetTowards && targetTowards !== "self")) {
        return undefined;
      }
      return computeTraceableContinuityChecksumSha256(targetMarkdown, "sha256-base64url-c14n-v2");
    }
    return computeTraceableContinuityChecksumSha256(targetMarkdown, method);
  } catch {
    return undefined;
  }
}

function evaluateContinuityIntegrity(markdown, footerIntegrity, options = {}) {
  if (!footerIntegrity?.method && !footerIntegrity?.value) {
    return { status: "missing" };
  }
  if (footerIntegrity.method !== "sha256-base64url-c14n-v1" && footerIntegrity.method !== "sha256-base64url-c14n-v2") {
    return {
      status: "unsupported-method",
      method: footerIntegrity?.method,
      towardsTarget: footerIntegrity?.towardsTarget,
      storedValue: footerIntegrity?.value
    };
  }
  const actualValue = computeTargetedTraceableContinuityChecksumSha256(options.filePath, markdown, footerIntegrity, options.readTextFileSync);
  const storedValue = trimToUndefined(footerIntegrity.value);
  if (!storedValue) {
    return {
      status: "missing",
      method: footerIntegrity.method,
      towardsTarget: footerIntegrity.towardsTarget,
      actualValue
    };
  }
  if (!actualValue) {
    return {
      status: "target-unreadable",
      method: footerIntegrity.method,
      towardsTarget: footerIntegrity.towardsTarget,
      storedValue
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

function addContractSectionShapeFindings(findings, filePath, contract, options) {
  if (!contract?.present) {
    return;
  }
  const codePrefix = options.codePrefix;
  const category = options.category;
  const displayName = options.displayName;
  if (contract.duplicateGroupHeadings.length > 0) {
    findings.push({
      code: `${codePrefix}-duplicate-groups`,
      category,
      filePath,
      message: `The ${displayName} repeats group headings: ${contract.duplicateGroupHeadings.join(", ")}.`,
      severity: "error"
    });
  }
  if (contract.duplicateCategoryLabels.length > 0) {
    findings.push({
      code: `${codePrefix}-duplicate-category-labels`,
      category,
      filePath,
      message: `The ${displayName} repeats category labels within the same group: ${contract.duplicateCategoryLabels.join(", ")}.`,
      severity: "error"
    });
  }
  if (contract.duplicateDeclarationNames.length > 0) {
    findings.push({
      code: `${codePrefix}-duplicate-declarations`,
      category,
      filePath,
      message: `The ${displayName} repeats named declaration entries within the same group: ${contract.duplicateDeclarationNames.join(", ")}.`,
      severity: "error"
    });
  }
  if (contract.categoriesMissingLists.length > 0) {
    findings.push({
      code: `${codePrefix}-category-list-missing`,
      category,
      filePath,
      message: `The ${displayName} has category labels without a following hyphen list: ${contract.categoriesMissingLists.join(", ")}.`,
      severity: "error"
    });
  }
  if (contract.unlabeledHyphenListLines.length > 0) {
    findings.push({
      code: `${codePrefix}-unlabeled-list`,
      category,
      filePath,
      message: `The ${displayName} contains hyphen list items without a preceding category label: ${contract.unlabeledHyphenListLines.join(", ")}.`,
      severity: "error"
    });
  }
  if (contract.starBulletLines.length > 0) {
    findings.push({
      code: `${codePrefix}-star-bullets-present`,
      category,
      filePath,
      message: `The ${displayName} contains star bullets where hyphen bullets are required: ${contract.starBulletLines.join(", ")}.`,
      severity: "error"
    });
  }
  if (contract.plusBulletLines.length > 0) {
    findings.push({
      code: `${codePrefix}-plus-bullets-present`,
      category,
      filePath,
      message: `The ${displayName} contains plus bullets where hyphen bullets are required: ${contract.plusBulletLines.join(", ")}.`,
      severity: "error"
    });
  }
  if (contract.unexpectedContentLines.length > 0) {
    findings.push({
      code: `${codePrefix}-unexpected-content`,
      category,
      filePath,
      message: `The ${displayName} contains content outside the allowed heading/category/list shape: ${contract.unexpectedContentLines.join(", ")}.`,
      severity: "error"
    });
  }
}

function collectContractVocabularyFindings(findings, filePath, contract, options) {
  if (!contract?.present) {
    return;
  }
  const unexpectedSeverity = options.unexpectedSeverity ?? "error";
  const allowedGroupHeadings = new Set(options.allowedGroupHeadings ?? []);
  const allowedCategoryLabels = new Set(options.allowedCategoryLabels ?? []);
  for (const group of contract.groups) {
    if (allowedGroupHeadings.size > 0 && !allowedGroupHeadings.has(group.heading)) {
      findings.push({
        code: `${options.codePrefix}-unexpected-group`,
        category: options.category,
        filePath,
        message: `The ${options.displayName} contains an unexpected group heading: ${group.heading}.`,
        severity: unexpectedSeverity,
        placement: {
          lineText: `### ${group.heading}`,
          actualHeading: group.heading,
          headingLevel: 3
        }
      });
    }
    for (const contractCategory of group.categories) {
      if (allowedCategoryLabels.size > 0 && !allowedCategoryLabels.has(contractCategory.label)) {
        findings.push({
          code: `${options.codePrefix}-unexpected-category-label`,
          category: options.category,
          filePath,
          message: `The ${options.displayName} contains an unexpected category label in ${group.heading}: ${contractCategory.label}.`,
          severity: unexpectedSeverity,
          placement: {
            lineText: contractCategory.label
          }
        });
      }
    }
  }
}

function collectUnexpectedContinuityEnvelopeFieldFindings(findings, filePath, parsed, options) {
  const severity = options.severity;
  if (!severity) {
    return;
  }

  const fieldSurfaces = [{
    entries: parsed.envelopeFieldEntries ?? [],
    allowedLabels: new Set(options.allowedEnvelopeFieldLabels ?? []),
    surfaceName: "Continuity Context"
  }, {
    entries: parsed.parentFieldEntries ?? [],
    allowedLabels: new Set(options.allowedParentFieldLabels ?? []),
    surfaceName: "Parent"
  }, {
    entries: parsed.currentFieldEntries ?? [],
    allowedLabels: new Set(options.allowedCurrentFieldLabels ?? []),
    surfaceName: "Current"
  }];

  for (const surface of fieldSurfaces) {
    for (const entry of surface.entries) {
      if (surface.allowedLabels.has(entry.label)) {
        continue;
      }
      findings.push({
        code: `${options.codePrefix}-unexpected-envelope-field`,
        category: options.category,
        filePath,
        message: `The ${options.displayName} contains an unexpected ${surface.surfaceName} field: ${entry.label}.`,
        severity,
        placement: {
          lineText: entry.lineText
        }
      });
    }
  }
}

function getContractGroupCategoryItems(contract, groupHeading, categoryLabels) {
  const group = contract?.groups?.find((entry) => entry.heading === groupHeading);
  if (!group) {
    return [];
  }
  const values = [];
  for (const categoryLabel of categoryLabels) {
    const category = group.categories.find((entry) => entry.label === categoryLabel);
    if (!category) {
      continue;
    }
    values.push(...category.items);
  }
  return values;
}

function collectExpectedSchemaHeadingFindings(findings, filePath, parsed, options) {
  const titleHeading = options.titleHeading;
  const expectedSectionHeadings = options.expectedSectionHeadings;
  const displayName = options.displayName;
  const codePrefix = options.codePrefix;
  const bodyHeadings = parsed.headings.filter((heading) => heading.text !== "Continuity Context" && heading.text !== "Continuity Integrity");
  const bodyTitle = bodyHeadings.find((heading) => heading.level === 1);
  const extraBodyTitles = bodyHeadings.filter((heading) => heading.level === 1 && heading.text !== titleHeading);
  const sectionHeadings = bodyHeadings.filter((heading) => heading.level === 2);
  const allowedSectionHeadingSet = new Set(expectedSectionHeadings);

  if (!bodyTitle || bodyTitle.text !== titleHeading) {
    findings.push({
      code: `${codePrefix}-title-mismatch`,
      category: "schema-note-layout",
      filePath,
      message: `The ${displayName} should use \`# ${titleHeading}\` as the display heading.`,
      severity: "error",
      placement: {
        expectedHeading: titleHeading,
        actualHeading: bodyTitle?.text,
        anchorBeforeHeading: "Continuity Context",
        anchorAfterHeading: expectedSectionHeadings[0],
        headingLevel: 1
      }
    });
  }

  for (const heading of extraBodyTitles) {
    findings.push({
      code: `${codePrefix}-unexpected-heading`,
      category: "schema-note-layout",
      filePath,
      message: `The ${displayName} includes an unexpected top-level heading: \`${heading.text}\`.`,
      severity: "error",
      placement: {
        actualHeading: heading.text,
        headingLevel: heading.level
      }
    });
  }

  for (const heading of sectionHeadings) {
    if (allowedSectionHeadingSet.has(heading.text)) {
      continue;
    }
    findings.push({
      code: `${codePrefix}-unexpected-heading`,
      category: "schema-note-layout",
      filePath,
      message: `The ${displayName} includes an unexpected section heading: \`${heading.text}\`.`,
      severity: "error",
      placement: {
        actualHeading: heading.text,
        headingLevel: heading.level
      }
    });
  }

  const presentSectionIndexes = new Map();
  for (let index = 0; index < sectionHeadings.length; index += 1) {
    const heading = sectionHeadings[index];
    if (!allowedSectionHeadingSet.has(heading.text) || presentSectionIndexes.has(heading.text)) {
      continue;
    }
    presentSectionIndexes.set(heading.text, index);
  }

  for (let expectedIndex = 0; expectedIndex < expectedSectionHeadings.length; expectedIndex += 1) {
    const expectedHeading = expectedSectionHeadings[expectedIndex];
    if (presentSectionIndexes.has(expectedHeading)) {
      continue;
    }
    const anchorBeforeHeading = expectedIndex > 0 ? expectedSectionHeadings[expectedIndex - 1] : titleHeading;
    let anchorAfterHeading = "Continuity Integrity";
    for (let nextIndex = expectedIndex + 1; nextIndex < expectedSectionHeadings.length; nextIndex += 1) {
      const nextHeading = expectedSectionHeadings[nextIndex];
      if (presentSectionIndexes.has(nextHeading)) {
        anchorAfterHeading = nextHeading;
        break;
      }
    }
    findings.push({
      code: `${codePrefix}-missing-heading`,
      category: "schema-note-layout",
      filePath,
      message: `The ${displayName} is missing the expected section heading \`## ${expectedHeading}\`.`,
      severity: "warning",
      placement: {
        expectedHeading,
        anchorBeforeHeading,
        anchorAfterHeading,
        headingLevel: 2
      }
    });
  }

  let lastExpectedPresentIndex = -1;
  let lastExpectedHeading;
  for (const expectedHeading of expectedSectionHeadings) {
    const presentIndex = presentSectionIndexes.get(expectedHeading);
    if (presentIndex === undefined) {
      continue;
    }
    if (presentIndex < lastExpectedPresentIndex) {
      findings.push({
        code: `${codePrefix}-heading-order`,
        category: "schema-note-layout",
        filePath,
        message: `The ${displayName} section heading \`${expectedHeading}\` is out of order and should appear after \`${lastExpectedHeading}\`.`,
        severity: "warning",
        placement: {
          actualHeading: expectedHeading,
          anchorBeforeHeading: lastExpectedHeading,
          headingLevel: 2
        }
      });
      continue;
    }
    lastExpectedPresentIndex = presentIndex;
    lastExpectedHeading = expectedHeading;
  }
}

function readSchemaFileSync(filePath, readTextFileSync) {
  return (readTextFileSync ?? require("node:fs").readFileSync)(filePath, "utf8");
}

function resolveRelativeSchemaPath(filePath, relativeTarget) {
  const trimmed = trimToUndefined(relativeTarget);
  if (!trimmed || /^(https?:\/\/|[A-Za-z]:\/)/u.test(trimmed) || trimmed === "self") {
    return undefined;
  }
  return path.resolve(path.dirname(filePath), trimmed);
}

module.exports = {
  addContractSectionShapeFindings,
  collectContractVocabularyFindings,
  collectExpectedSchemaHeadingFindings,
  collectUnexpectedContinuityEnvelopeFieldFindings,
  computeTraceableContinuityChecksumSha256,
  computeTargetedTraceableContinuityChecksumSha256,
  evaluateContinuityIntegrity,
  getContractGroupCategoryItems,
  isCommitPinnedBrowseGitTarget,
  isTraceableContinuityTimestamp,
  parseContractSection,
  parseSchemaNoteMarkdown,
  readSchemaFileSync,
  resolveRelativeSchemaPath,
  trimToUndefined
};