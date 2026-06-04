import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  computeTargetedTraceableContinuityChecksumSha256,
  parseSchemaNoteMarkdown
} from "../ides/vscode/src/traceableSchemaValidationShared.js";

const targetPaths = process.argv.slice(2);

if (targetPaths.length === 0) {
  console.error("Usage: node scripts/refresh-traceable-continuity-integrity.mjs <file> [file...]");
  process.exitCode = 1;
} else {
  await Promise.all(targetPaths.map(async (targetPath) => {
    const absolutePath = path.resolve(targetPath);
    const markdown = await readFile(absolutePath, "utf8");
    const parsed = parseSchemaNoteMarkdown(markdown);
    const nextChecksum = computeTargetedTraceableContinuityChecksumSha256(absolutePath, markdown, parsed.footerIntegrity);
    if (!nextChecksum) {
      throw new Error(`Could not resolve the declared continuity integrity target for ${absolutePath}`);
    }
    const valueLinePattern = /(- Value:\s+)([^\r\n]+)/u;
    if (!valueLinePattern.test(markdown)) {
      throw new Error(`Could not locate a continuity integrity Value line in ${absolutePath}`);
    }
    const updatedMarkdown = markdown.replace(valueLinePattern, `$1${nextChecksum}`);
    await writeFile(absolutePath, updatedMarkdown, "utf8");
    console.log(`${absolutePath}: ${nextChecksum}`);
  }));
}
