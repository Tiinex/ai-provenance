const fs = require("node:fs");
const path = require("node:path");
const mod = require("../ides/vscode/src/traceableContinuityValidation.js");

const filePath = "c:/Users/micro/Documents/Repos/Tiinex/docs/.topics/.tools/tiinex.v1.tool.md";
const markdown = fs.readFileSync(filePath, "utf8");
const parsed = mod.parseTraceableContinuityMarkdown(markdown);
const hasParent = Boolean(
  parsed.parentCreatedAt?.trim()
  || parsed.parentTrace?.target?.trim()
  || parsed.parentSchema?.target?.trim()
  || parsed.parentSchema?.label?.trim()
  || parsed.parentOrigin?.relative?.trim()
  || parsed.parentOrigin?.absolute?.trim()
  || parsed.parentOrigin?.browseGit?.trim()
);
const comparisonTarget = hasParent
  ? parsed.parentOrigin?.browseGit?.trim() || parsed.parentTrace?.target?.trim() || parsed.currentSchema?.target?.trim()
  : undefined;
const comparisonLabel = comparisonTarget
  ? parsed.parentTrace?.label?.trim()
    || parsed.currentSchema?.label?.trim()
    || path.posix.basename(comparisonTarget.split("/").pop() ?? "target")
  : undefined;
const normalizedLines = markdown.replace(/\r\n?/gu, "\n").split("\n");
const integrityHeadingLineIndex = normalizedLines.findIndex((line) => line.trim() === "# Continuity Integrity");
let lastContentLineIndex = integrityHeadingLineIndex > 0 ? integrityHeadingLineIndex - 1 : normalizedLines.length - 1;
while (lastContentLineIndex >= 0) {
  const trimmed = normalizedLines[lastContentLineIndex]?.trim() ?? "";
  if (trimmed === "" || trimmed === "---") {
    lastContentLineIndex -= 1;
    continue;
  }
  break;
}
const footerStartLineIndex = integrityHeadingLineIndex >= 0 ? Math.max(lastContentLineIndex + 1, 0) : Math.max(lastContentLineIndex + 1, 0);
const prefix = normalizedLines.slice(0, footerStartLineIndex).join("\n");
const computeForTarget = (method, towards, markdownPayload) => mod.computeTargetedTraceableContinuityChecksumSha256(
  filePath,
  markdownPayload,
  { method, towardsTarget: towards },
  (candidatePath) => fs.readFileSync(candidatePath, "utf8"),
  [{ name: "docs", fsPath: "c:/Users/micro/Documents/Repos/Tiinex/docs" }]
);
const buildFooterLines = (targetValue, selfValue) => {
  const footerLines = [];
  if (lastContentLineIndex >= 0) {
    footerLines.push("");
  }
  footerLines.push("---", "", "# Continuity Integrity", "");
  if (comparisonTarget && comparisonLabel) {
    footerLines.push(
      "- sha256-base64url-c14n-v1",
      `  - Towards: [${comparisonLabel}](${comparisonTarget})`,
      `  - Value: ${targetValue}`,
      ""
    );
  }
  footerLines.push(
    "- sha256-base64url-c14n-v2",
    "  - Towards: self",
    `  - Value: ${selfValue}`
  );
  return footerLines.join("\n");
};
const initialFooterText = buildFooterLines("TARGET_PLACEHOLDER", "SELF_PLACEHOLDER");
const initialMarkdown = prefix.length === 0 ? initialFooterText : `${prefix}\n${initialFooterText}`;
const targetChecksum = comparisonTarget
  ? computeForTarget("sha256-base64url-c14n-v1", comparisonTarget, initialMarkdown) ?? "TARGET_PLACEHOLDER"
  : "TARGET_PLACEHOLDER";
const footerWithTargetText = buildFooterLines(targetChecksum, "SELF_PLACEHOLDER");
const markdownWithTarget = prefix.length === 0 ? footerWithTargetText : `${prefix}\n${footerWithTargetText}`;
const selfChecksum = computeForTarget("sha256-base64url-c14n-v2", "self", markdownWithTarget) ?? "SELF_PLACEHOLDER";
console.log(JSON.stringify({ targetChecksum, selfChecksum, footer: buildFooterLines(targetChecksum, selfChecksum) }, null, 2));
