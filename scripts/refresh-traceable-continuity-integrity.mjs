import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  computeTargetedTraceableContinuityChecksumSha256,
  computeTraceableContinuityChecksumSha256,
  parseSchemaNoteMarkdown
} from "../ides/vscode/src/traceableSchemaValidationShared.js";

const TRACE_FILE_SUFFIX = ".trace.md";
const valueLinePattern = /(- Value:\s+)([^\r\n]+)/u;
const parentChecksumLinePattern = /("parentTraceChecksumSha256"\s*:\s*")([^"]*)(")/u;
const targetPaths = process.argv.slice(2);

function collectTraceFiles(targetPath) {
  const absolutePath = path.resolve(targetPath);
  const stats = statSync(absolutePath);
  if (stats.isFile()) {
    return absolutePath.endsWith(TRACE_FILE_SUFFIX) ? [absolutePath] : [];
  }
  if (!stats.isDirectory()) {
    return [];
  }

  const collected = [];
  for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
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

function extractTraceableState(markdown) {
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
        : undefined,
      parentTraceChecksumSha256: typeof result.parentTraceChecksumSha256 === "string" && result.parentTraceChecksumSha256.trim()
        ? result.parentTraceChecksumSha256.trim()
        : undefined
    };
  } catch {
    return {};
  }
}

function replaceParentChecksum(markdown, nextChecksum) {
  return parentChecksumLinePattern.test(markdown)
    ? markdown.replace(parentChecksumLinePattern, `$1${nextChecksum}$3`)
    : markdown;
}

async function refreshStoredParentChecksum(markdown, absolutePath, traceFileSet, inFlight) {
  const traceableState = extractTraceableState(markdown);
  if (!traceableState.parentTracePath) {
    return {
      markdown,
      parentChecksumUpdated: false
    };
  }

  const resolvedParentPath = path.resolve(path.dirname(absolutePath), traceableState.parentTracePath);
  if (traceFileSet.has(resolvedParentPath)) {
    await refreshTraceFile(resolvedParentPath, traceFileSet, inFlight);
  }
  if (!existsSync(resolvedParentPath)) {
    return {
      markdown,
      parentChecksumUpdated: false
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

async function refreshTraceFile(filePath, traceFileSet, inFlight) {
  const absolutePath = path.resolve(filePath);
  if (inFlight.has(absolutePath)) {
    return inFlight.get(absolutePath);
  }

  const refreshPromise = (async () => {
    let markdown = await readFile(absolutePath, "utf8");
    const originalMarkdown = markdown;
    let parentChecksumUpdated = false;
    let footerChecksumUpdated = false;

    const initialParentRefresh = await refreshStoredParentChecksum(markdown, absolutePath, traceFileSet, inFlight);
    markdown = initialParentRefresh.markdown;
    parentChecksumUpdated = initialParentRefresh.parentChecksumUpdated;

    const parsed = parseSchemaNoteMarkdown(markdown);
    const footerTarget = parsed.footerIntegrity?.towardsTarget?.trim();
    if (footerTarget && footerTarget !== "self" && !/^[a-z][a-z0-9+.-]*:\/\//iu.test(footerTarget)) {
      const resolvedFooterTargetPath = path.resolve(path.dirname(absolutePath), footerTarget);
      if (traceFileSet.has(resolvedFooterTargetPath)) {
        await refreshTraceFile(resolvedFooterTargetPath, traceFileSet, inFlight);
        const refreshedMarkdown = await readFile(absolutePath, "utf8");
        const secondParentRefresh = await refreshStoredParentChecksum(refreshedMarkdown, absolutePath, traceFileSet, inFlight);
        markdown = secondParentRefresh.markdown;
        parentChecksumUpdated = parentChecksumUpdated || secondParentRefresh.parentChecksumUpdated;
      }
    }
    const refreshedParsed = parseSchemaNoteMarkdown(markdown);
    const nextChecksum = computeTargetedTraceableContinuityChecksumSha256(absolutePath, markdown, refreshedParsed.footerIntegrity);
    if (!nextChecksum) {
      throw new Error(`Could not resolve the declared continuity integrity target for ${absolutePath}`);
    }
    if (!valueLinePattern.test(markdown)) {
      console.log(JSON.stringify({
        filePath: absolutePath,
        skipped: true,
        reason: "missing-footer-value-line"
      }));
      return;
    }
    const updatedMarkdown = markdown.replace(valueLinePattern, `$1${nextChecksum}`);
    footerChecksumUpdated = updatedMarkdown !== markdown;
    if (updatedMarkdown !== originalMarkdown) {
      await writeFile(absolutePath, updatedMarkdown, "utf8");
    }
    console.log(JSON.stringify({
      filePath: absolutePath,
      parentChecksumUpdated,
      footerChecksumUpdated,
      changed: updatedMarkdown !== originalMarkdown,
      checksum: nextChecksum
    }));
  })();

  inFlight.set(absolutePath, refreshPromise);
  return refreshPromise;
}

if (targetPaths.length === 0) {
  console.error("Usage: node scripts/refresh-traceable-continuity-integrity.mjs <file-or-directory> [moreTargets...]");
  process.exitCode = 1;
} else {
  const traceFiles = [...new Set(targetPaths.flatMap((targetPath) => collectTraceFiles(targetPath)))].sort();
  const traceFileSet = new Set(traceFiles.map((filePath) => path.resolve(filePath)));
  const inFlight = new Map();
  for (const traceFile of traceFiles) {
    await refreshTraceFile(traceFile, traceFileSet, inFlight);
  }
}
