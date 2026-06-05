import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getUniqueWorkspaceFolderMatchByName,
  isPathWithinAnyWorkspaceRoot,
  resolveDriveLessAbsolutePathOnWindows,
  resolveRelativeOpenPathInWorkspace
} from "../src/traceableOpenPath.js";
import { planStandaloneMoveRetainedDescendantRewrites } from "../src/traceableStandaloneMoveRetainedDescendants.js";
import {
  computeTraceableContinuityChecksumSha256,
  parseTraceableContinuityMarkdown,
  renderTraceableContinuityValidationMarkdown,
  validateTraceableContinuityArtifactChainSync
} from "../src/traceableContinuityValidation.js";
import { validateTraceableRootSchemaSync } from "../src/traceableRootSchemaValidation.js";
import { validateTraceableDecisionSchemaSync } from "../src/traceableDecisionSchemaValidation.js";
import { validateTraceableEvidenceSchemaSync } from "../src/traceableEvidenceSchemaValidation.js";
import { validateTraceablePointerSchemaSync } from "../src/traceablePointerSchemaValidation.js";
import { validateTraceableTaskSchemaSync } from "../src/traceableTaskSchemaValidation.js";
import { validateTraceableTopicSchemaSync } from "../src/traceableTopicSchemaValidation.js";
import { runSchemaCompatibilityFixtures } from "./schemaCompatibilityFixtures.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");

function getContributedConfigurationProperties(packageJson) {
  const configuration = packageJson.contributes?.configuration;
  const configurationEntries = Array.isArray(configuration)
    ? configuration
    : configuration ? [configuration] : [];
  return configurationEntries.reduce((properties, entry) => ({
    ...properties,
    ...(entry?.properties ?? {})
  }), {});
}

function testStandaloneMoveRetainedDescendantRewrites() {
  const rewrites = planStandaloneMoveRetainedDescendantRewrites({
    destinationPath: "C:/repo/.topics/transfer/move-alone-proof/001-2-leo.trace.md",
    directChildren: [{
      path: "C:/repo/.topics/transfer/001-2-1-leo.trace.md",
      lineageLabel: "001-2-1"
    }]
  });

  assert.deepEqual(rewrites, [{
    oldPath: path.win32.normalize("C:/repo/.topics/transfer/001-2-1-leo.trace.md"),
    newPath: path.win32.normalize("C:/repo/.topics/transfer/001-2-1-leo.trace.md"),
    oldLineageLabel: "001-2-1",
    newLineageLabel: "001-2-1",
    parentPathOverride: path.win32.normalize("C:/repo/.topics/transfer/move-alone-proof/001-2-leo.trace.md")
  }], "Standalone move descendants should stay in place and only rewrite their parent reference to the moved node.");
}

function finalizeContinuityIntegrity(markdown) {
  const digest = computeTraceableContinuityChecksumSha256(markdown);
  return markdown.replace(/(- Value:\s+)([^\r\n]+)/u, `$1${digest}`);
}

function excludeSchemaTargetReadabilityFindings(findings) {
  return findings.filter((finding) => ![
    "continuity-footer-self-required-without-parent",
    "traceable-envelope-schema-permalink-required",
    "traceable-envelope-schema-unreadable",
    "traceable-current-schema-permalink-required",
    "traceable-current-schema-unreadable",
    "traceable-parent-schema-permalink-required",
    "traceable-parent-schema-unreadable"
  ].includes(finding.code));
}

function isUnderPath(candidatePath, rootPath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function testContinuityValidationCoreWithLocalFixtureChain() {
  const tempRoot = path.join(packageRoot, ".test-temp", "continuity-validation");
  const parentPath = path.join(tempRoot, "001-parent.trace.md");
  const childPath = path.join(tempRoot, "001-1-child.trace.md");
  const fileMap = new Map();

  const parentMarkdown = finalizeContinuityIntegrity(`# Continuity Context

- Envelope Schema: [tiinex.continuation.v1](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
- Current
  - Current Schema: [tiinex.topic.v1](../../docs/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Created At: 2026-05-30 00:00:00
  - Summary: Parent fixture.

---

# Parent Fixture

## Summary

- Fixture: parent

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [tiinex.topic.v1.schema.md](../../docs/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Value: PLACEHOLDER`);

  fileMap.set(path.resolve(parentPath), parentMarkdown);

  const childMarkdown = finalizeContinuityIntegrity(`# Continuity Context

- Envelope Schema: [tiinex.continuation.v1](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
- Parent
  - Parent Schema: [tiinex.topic.v1](../../docs/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Created At: 2026-05-30 00:00:00
  - Trace: [001-parent.trace.md](001-parent.trace.md)
  - Origin:
    - [relative](001-parent.trace.md)
- Current
  - Current Schema: [tiinex.topic.v1](../../docs/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Created At: 2026-05-30 00:00:01
  - Summary: Child fixture.

---

# Child Fixture

## Summary

- Fixture: child

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [tiinex.topic.v1.schema.md](../../docs/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Value: PLACEHOLDER`);

  fileMap.set(path.resolve(childPath), childMarkdown);

  const result = validateTraceableContinuityArtifactChainSync({
    filePath: childPath,
    readTextFileSync: (filePath) => {
      const markdown = fileMap.get(path.resolve(filePath));
      if (markdown) {
        return markdown;
      }
      if (/\.schema\.md$/iu.test(filePath)) {
        return "# Schema Fixture\n";
      }
      throw new Error(`Missing test fixture ${filePath}`);
    }
  });

  assert.equal(result.nodes.length, 2, "Continuity validator should follow a local parent trace chain backwards.");
  assert.equal(result.nodes[0].backwardLink.source, "parent-trace", "Continuity validator should prefer a local Parent Trace link when available.");
  assert.equal(result.nodes[0].continuityIntegrity.status, "verified", "Child continuity footer should verify against the shared checksum rule.");
  assert.equal(result.nodes[1].continuityIntegrity.status, "verified", "Parent continuity footer should also verify against the shared checksum rule.");
  assert.equal(result.stoppedBecause, "complete", "Continuity validator should stop cleanly at the root when no earlier local parent exists.");
}

function testValidatorFindsParentSchemaMismatch() {
  const tempRoot = path.join(packageRoot, ".test-temp", "continuity-parent-schema-mismatch");
  const parentPath = path.join(tempRoot, "001-parent.trace.md");
  const childPath = path.join(tempRoot, "001-1-child.trace.md");
  const fileMap = new Map();

  const parentMarkdown = finalizeContinuityIntegrity(`# Continuity Context

- Envelope Schema: [tiinex.continuation.v1](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
- Current
  - Current Schema: [tiinex.topic.v1](../../docs/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Created At: 2026-05-30 00:00:00
  - Summary: Parent fixture.

---

# Parent Fixture

## Summary

- Fixture: parent

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [tiinex.topic.v1.schema.md](../../docs/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Value: PLACEHOLDER`);
  const parentChecksum = computeTraceableContinuityChecksumSha256(parentMarkdown);
  fileMap.set(path.resolve(parentPath), parentMarkdown);

  const childMarkdown = finalizeContinuityIntegrity(`# Continuity Context

- Envelope Schema: [tiinex.continuation.v1](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
- Parent
  - Parent Schema: [tiinex.feedback.v1](../../docs/.topics/.schemas/tiinex.feedback.v1.schema.md)
  - Created At: 2026-05-30 00:00:00
  - Trace: [001-parent.trace.md](001-parent.trace.md)
  - Origin:
    - [relative](001-parent.trace.md)
- Current
  - Current Schema: [tiinex.topic.v1](../../docs/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Created At: 2026-05-30 00:00:01
  - Summary: Child fixture.

## Traceable State

\`\`\`json
{
  "schema": "tiinex.traceable-state.v1",
  "result": {
    "parentTracePath": "001-parent.trace.md",
    "parentTraceChecksumSha256": "${parentChecksum}",
    "lineageLabel": "001-1",
    "lineageDepth": 2
  }
}
\`\`\`

---

# Child Fixture

## Summary

- Fixture: child

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [tiinex.topic.v1.schema.md](../../docs/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Value: PLACEHOLDER`);
  fileMap.set(path.resolve(childPath), childMarkdown);

  const result = validateTraceableContinuityArtifactChainSync({
    filePath: childPath,
    readTextFileSync: (filePath) => {
      const markdown = fileMap.get(path.resolve(filePath));
      if (!markdown) {
        throw new Error(`Missing test fixture ${filePath}`);
      }
      return markdown;
    }
  });

  assert.equal(result.nodes.length, 2, "Continuity validator should still follow the local parent trace chain backwards.");
  assert.equal(result.nodes[0].traceableParentIntegrity?.status, "ok", "The direct-parent checksum should still be treated as valid for this schema mismatch fixture.");
  assert.ok(result.findings.some((finding) => finding.code === "traceable-parent-schema-mismatch"), "Validator should surface a parent-schema mismatch when the declared Parent Schema does not match the resolved parent artifact.");
  assert.equal(excludeSchemaTargetReadabilityFindings(result.findings).length, 1, "Only the schema-parent mismatch should be surfaced for this fixture outside the dedicated schema-target readability checks.");
}

function testValidatorFindsUnpinnedBrowseGitParentOrigin() {
  const tempRoot = path.join(packageRoot, ".test-temp", "continuity-unpinned-browse-git");
  const parentPath = path.join(tempRoot, "001-parent.trace.md");
  const childPath = path.join(tempRoot, "001-1-child.trace.md");
  const fileMap = new Map();

  const parentMarkdown = finalizeContinuityIntegrity(`# Continuity Context

- Envelope Schema: [tiinex.continuation.v1](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
- Current
  - Current Schema: [tiinex.topic.v1](../../docs/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Created At: 2026-05-30 00:00:00
  - Summary: Parent fixture.

---

# Parent Fixture

## Summary

- Fixture: parent

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [tiinex.topic.v1.schema.md](../../docs/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Value: PLACEHOLDER`);
  const parentChecksum = computeTraceableContinuityChecksumSha256(parentMarkdown);
  fileMap.set(path.resolve(parentPath), parentMarkdown);

  const childMarkdown = finalizeContinuityIntegrity(`# Continuity Context

- Envelope Schema: [tiinex.continuation.v1](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
- Parent
  - Parent Schema: [tiinex.topic.v1](../../docs/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Created At: 2026-05-30 00:00:00
  - Trace: [001-parent.trace.md](001-parent.trace.md)
  - Origin:
    - [relative](001-parent.trace.md)
    - [browse + git](https://github.com/Tiinex/docs/blob/main/.topics/example/001.trace.md)
- Current
  - Current Schema: [tiinex.topic.v1](../../docs/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Created At: 2026-05-30 00:00:01
  - Summary: Child fixture.

## Traceable State

\`\`\`json
{
  "schema": "tiinex.traceable-state.v1",
  "result": {
    "parentTracePath": "001-parent.trace.md",
    "parentTraceChecksumSha256": "${parentChecksum}",
    "lineageLabel": "001-1",
    "lineageDepth": 2
  }
}
\`\`\`

---

# Child Fixture

## Summary

- Fixture: child

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [tiinex.topic.v1.schema.md](../../docs/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Value: PLACEHOLDER`);
  fileMap.set(path.resolve(childPath), childMarkdown);

  const result = validateTraceableContinuityArtifactChainSync({
    filePath: childPath,
    readTextFileSync: (filePath) => {
      const markdown = fileMap.get(path.resolve(filePath));
      if (!markdown) {
        throw new Error(`Missing test fixture ${filePath}`);
      }
      return markdown;
    }
  });

  assert.equal(result.nodes.length, 2, "Continuity validator should still follow the local parent trace chain backwards.");
  assert.equal(result.nodes[0].traceableParentIntegrity?.status, "ok", "The direct-parent checksum should stay valid when only the browse+git target is malformed.");
  assert.ok(result.findings.some((finding) => finding.code === "traceable-parent-origin-unpinned-browse-git"), "Validator should surface a browse + git origin that is not commit-pinned.");
  assert.equal(excludeSchemaTargetReadabilityFindings(result.findings).length, 1, "Only the origin-lawfulness issue should be surfaced for this fixture outside the dedicated schema-target readability checks.");
}

function testValidatorFindsMissingValidationFriendlyShape() {
  const artifactPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", ".test-temp", "validation-friendly-shape", "001-schema-note.trace.md");
  const markdown = finalizeContinuityIntegrity(`# Continuity Context

- Envelope Schema: [tiinex.continuation.v1](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
- Current
  - Current Schema: [tiinex.evidence.v1](../../docs/.topics/.schemas/tiinex.evidence.v1.schema.md)
  - Created At: 2026-05-30 00:00:02
  - Summary: Schema note missing validation-friendly shape.

---

# Missing Validation-Friendly Shape

## Summary

- Fixture: schema-note
- Status: intentionally missing validation-friendly shape

## Required Body Expectations

- Fixture: present so only the Validation-Friendly Shape rule is under test

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [tiinex.evidence.v1.schema.md](../../docs/.topics/.schemas/tiinex.evidence.v1.schema.md)
  - Value: PLACEHOLDER`);
  const result = validateTraceableContinuityArtifactChainSync({
    filePath: artifactPath,
    readTextFileSync: () => markdown,
    maxDepth: 1
  });

  assert.ok(result.findings.some((finding) => finding.code === "schema-validation-friendly-shape-missing"), "Validator should surface a schema-note structure finding when a schema note omits the Validation-Friendly Shape section.");
  assert.equal(result.findings.length, 1, "Only the validation-friendly-shape issue should be surfaced for this fixture.");
}

function testValidatorFindsInvalidContinuityHeaderTimestamps() {
  const artifactPath = path.join(packageRoot, ".test-temp", "continuity-invalid-created-at", "001-invalid-created-at.trace.md");
  const markdown = finalizeContinuityIntegrity(`# Continuity Context

- Envelope Schema: [tiinex.continuation.v1](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
- Parent
  - Parent Schema: [tiinex.topic.v1](../../docs/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Created At: 2026-13-40 99:99:99
- Current
  - Current Schema: [tiinex.task.v1](../../docs/.topics/.schemas/tiinex.task.v1.schema.md)
  - Created At: 2026/06/03 03:10:05
  - Summary: Invalid timestamp fixture.

---

# Invalid Timestamp Fixture

## Objective

- Verify malformed continuity timestamps.

## Scope

- Timestamp validation only.

## Done Criteria

- validator surfaces only timestamp-shape findings.

## Summary

- Fixture: invalid-created-at

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [tiinex.task.v1.schema.md](../../docs/.topics/.schemas/tiinex.task.v1.schema.md)
  - Value: PLACEHOLDER`);

  const result = validateTraceableContinuityArtifactChainSync({
    filePath: artifactPath,
    readTextFileSync: () => markdown,
    maxDepth: 1
  });

  assert.ok(result.findings.some((finding) => finding.code === "traceable-parent-created-at-invalid"), "Validator should surface malformed Parent Created At values.");
  assert.ok(result.findings.some((finding) => finding.code === "continuity-current-created-at-invalid"), "Validator should surface malformed Current Created At values.");
  assert.equal(excludeSchemaTargetReadabilityFindings(result.findings).length, 2, "Only the malformed Created At findings should be surfaced for this fixture outside the dedicated schema-target readability checks.");
}

function testValidatorFindsMissingContinuityHeaderFields() {
  const artifactPath = path.join(packageRoot, ".test-temp", "continuity-missing-required-fields", "001-missing-header-fields.trace.md");
  const markdown = finalizeContinuityIntegrity(`# Continuity Context

- Envelope Schema: [tiinex.continuation.v1](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
- Parent
  - Trace: [001-parent.trace.md](001-parent.trace.md)
  - Origin:
    - [relative](001-parent.trace.md)
- Current
  - Current Schema: [tiinex.task.v1](../../docs/.topics/.schemas/tiinex.task.v1.schema.md)
  - Summary: Missing continuity fields fixture.

---

# Missing Header Fields Fixture

## Objective

- Verify missing continuity header findings.

## Scope

- Continuity header presence only.

## Done Criteria

- validator surfaces only the intended continuity-header findings.

## Summary

- Fixture: missing-header-fields

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [tiinex.task.v1.schema.md](../../docs/.topics/.schemas/tiinex.task.v1.schema.md)
  - Value: PLACEHOLDER`);

  const result = validateTraceableContinuityArtifactChainSync({
    filePath: artifactPath,
    readTextFileSync: () => markdown,
    maxDepth: 1
  });

  assert.ok(result.findings.some((finding) => finding.code === "continuity-current-created-at-missing"), "Validator should require Current Created At in the continuity header.");
  assert.ok(result.findings.some((finding) => finding.code === "traceable-parent-schema-missing"), "Validator should recommend Parent Schema when parent signal exists.");
  assert.ok(result.findings.some((finding) => finding.code === "traceable-parent-created-at-missing"), "Validator should recommend Parent Created At when parent signal exists.");
  assert.deepEqual(result.findings.find((finding) => finding.code === "traceable-parent-schema-missing")?.surfaces, ["problems", "report"], "Recommended Parent Schema findings should now also surface in Problems.");
  assert.deepEqual(result.findings.find((finding) => finding.code === "traceable-parent-created-at-missing")?.surfaces, ["problems", "report"], "Recommended Parent Created At findings should now also surface in Problems.");
  assert.equal(excludeSchemaTargetReadabilityFindings(result.findings).length, 3, "Only the missing continuity-header field findings should be surfaced for this fixture outside the dedicated schema-target readability checks.");
}

function testValidatorFindsMissingTaskStructure() {
  const artifactPath = path.join(packageRoot, ".test-temp", "task-structure-missing", "001-missing-task-structure.trace.md");
  const markdown = finalizeContinuityIntegrity(`# Continuity Context

- Envelope Schema: [tiinex.continuation.v1](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
- Current
  - Current Schema: [tiinex.task.v1](../../docs/.topics/.schemas/tiinex.task.v1.schema.md)
  - Created At: 2026-06-03 00:00:00
  - Summary: Missing task structure fixture.

---

# Missing Task Structure Fixture

This body intentionally omits objective, completion, and constraint sections.

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [tiinex.task.v1.schema.md](../../docs/.topics/.schemas/tiinex.task.v1.schema.md)
  - Value: PLACEHOLDER`);
  const result = validateTraceableContinuityArtifactChainSync({
    filePath: artifactPath,
    readTextFileSync: () => markdown,
    maxDepth: 1
  });

  assert.ok(result.findings.some((finding) => finding.code === "task-required-structure-missing"), "Validator should surface missing task body structure for ordinary task artifacts.");
  assert.equal(excludeSchemaTargetReadabilityFindings(result.findings).length, 1, "Only the missing task-structure finding should be surfaced for this fixture outside the dedicated schema-target readability checks.");
}

function testValidatorAcceptsTabIndentedCurrentContinuityFields() {
  const artifactPath = path.join(packageRoot, ".test-temp", "tab-indented-current-fields", "001-tab-indented.trace.md");
  const markdown = finalizeContinuityIntegrity(`# Continuity Context

- Envelope Schema: [tiinex.continuation.v1](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
- Current
	- Current Schema: [tiinex.topic.v1](../../docs/.topics/.schemas/tiinex.topic.v1.schema.md)
	- Created At: 2026-06-03 00:00:00
	- Summary: Tab-indented continuity header fixture.

---

# Tab-Indented Topic

## Current Read

This fixture uses tabs inside the continuity envelope.

## Design Direction

The validator should still read Current fields correctly.

## Relevance

This protects older trace files that mix tabs into the continuity header.`);
  const result = validateTraceableContinuityArtifactChainSync({
    filePath: artifactPath,
    readTextFileSync: () => markdown,
    maxDepth: 1
  });

  assert.ok(
    !result.findings.some((finding) => finding.code === "continuity-current-created-at-missing"),
    "Validator should not report Current Created At missing when the continuity envelope uses tab indentation."
  );
  assert.equal(result.nodes[0]?.parsed.currentCreatedAt, "2026-06-03 00:00:00", "Validator should parse tab-indented Current Created At values.");
}

function testValidatorFindsUnreadableOrdinaryTraceSchemaTargets() {
  const artifactPath = path.join(packageRoot, ".test-temp", "ordinary-trace-schema-targets-permalink-required", "001-permalink-required.trace.md");
  const markdown = finalizeContinuityIntegrity(`# Continuity Context

- Envelope Schema: [tiinex.continuation.v1](../../docs/.topics/.schemas/tiinex.continuation.v1.md)
- Parent
  - Parent Schema: [tiinex.topic.v1](../../docs/.topics/.schemas/tiinex.topic.v1.md)
  - Created At: 2026-06-01 03:15:00
  - Trace: [001-parent.trace.md](001-parent.trace.md)
- Current
  - Current Schema: [tiinex.topic.v1](../../docs/.topics/.schemas/tiinex.topic.v1.md)
  - Created At: 2026-06-02 22:38:22
  - Summary: Old schema target paths fixture.

---

# Old Schema Target Fixture

## Current Read

This fixture preserves old schema target paths that no longer resolve locally.

## Design Direction

Ordinary trace validation should surface unreadable schema targets.

## Relevance

This protects old traces that still point to obsolete .md schema files.`);
  const result = validateTraceableContinuityArtifactChainSync({
    filePath: artifactPath,
    readTextFileSync: () => markdown,
    maxDepth: 1
  });

  assert.ok(result.findings.some((finding) => finding.code === "traceable-envelope-schema-permalink-required"), "Validator should require commit-pinned Envelope Schema permalinks on ordinary traces.");
  assert.ok(result.findings.some((finding) => finding.code === "traceable-current-schema-permalink-required"), "Validator should require commit-pinned Current Schema permalinks on ordinary traces.");
  assert.ok(result.findings.some((finding) => finding.code === "traceable-parent-schema-permalink-required"), "Validator should require commit-pinned Parent Schema permalinks on ordinary traces.");
}

function testValidatorFindsUnresolvableGitHubSchemaPermalinks() {
  const artifactPath = path.join(packageRoot, ".test-temp", "ordinary-trace-schema-targets-github-unreadable", "001-github-unreadable.trace.md");
  const markdown = finalizeContinuityIntegrity(`# Continuity Context

- Envelope Schema: [tiinex.root.v1](https://github.com/Tiinex/docs/blob/0000000000000000000000000000000000000000/.topics/.schemas/tiinex.root.v1.schema.md)
- Parent
  - Parent Schema: [tiinex.topic.v1](https://github.com/Tiinex/docs/blob/0000000000000000000000000000000000000000/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Created At: 2026-06-01 03:15:00
  - Trace: [001-parent.trace.md](001-parent.trace.md)
- Current
  - Current Schema: [tiinex.topic.v1](https://github.com/Tiinex/docs/blob/0000000000000000000000000000000000000000/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Created At: 2026-06-02 22:38:22
  - Summary: Broken permalink fixture.

---

# Broken Permalink Fixture

## Current Read

This fixture uses commit-pinned schema links that cannot be resolved against local repo state.

## Design Direction

Ordinary trace validation should reject unreadable GitHub schema permalinks.

## Relevance

This protects traces that look pinned but actually point nowhere.`);
  const docsRoot = path.resolve(packageRoot, "..", "..", "..", "docs");
  const result = validateTraceableContinuityArtifactChainSync({
    filePath: artifactPath,
    readTextFileSync: () => markdown,
    workspaceRoots: [{ name: "docs", fsPath: docsRoot }],
    gitRevisionExistsSync: () => false,
    maxDepth: 1
  });

  assert.ok(result.findings.some((finding) => finding.code === "traceable-envelope-schema-unreadable"), "Validator should surface unreadable Envelope Schema permalinks on ordinary traces.");
  assert.ok(result.findings.some((finding) => finding.code === "traceable-current-schema-unreadable"), "Validator should surface unreadable Current Schema permalinks on ordinary traces.");
  assert.ok(result.findings.some((finding) => finding.code === "traceable-parent-schema-unreadable"), "Validator should surface unreadable Parent Schema permalinks on ordinary traces.");
}

function testValidatorFindsMissingContinuityIntegrityFooter() {
  const artifactPath = path.join(packageRoot, ".test-temp", "continuity-footer-missing", "001-footer-missing.trace.md");
  const markdown = `# Continuity Context

- Envelope Schema: [tiinex.root.v1](https://github.com/Tiinex/docs/blob/0e6d169685d56c913cb890ba568a96b366ebd4bf/.topics/.schemas/tiinex.root.v1.schema.md)
- Current
  - Current Schema: [tiinex.topic.v1](https://github.com/Tiinex/docs/blob/4a64e25b9d4dc657104bee51877d140ee93f4b2/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Created At: 2026-06-02 22:38:22
  - Summary: Missing footer fixture.

---

# Missing Footer Fixture

## Current Read

This fixture intentionally omits the continuity footer.

## Design Direction

Ordinary trace validation should surface missing continuity integrity sections.

## Relevance

This prevents traces from silently skipping checksum coverage.`;
  const docsRoot = path.resolve(packageRoot, "..", "..", "..", "docs");
  const result = validateTraceableContinuityArtifactChainSync({
    filePath: artifactPath,
    readTextFileSync: (filePath) => {
      if (path.resolve(filePath) === path.resolve(artifactPath)) {
        return markdown;
      }
      throw new Error(`Missing test fixture ${filePath}`);
    },
    workspaceRoots: [{ name: "docs", fsPath: docsRoot }],
    gitRevisionExistsSync: () => true,
    maxDepth: 1
  });

  assert.ok(result.findings.some((finding) => finding.code === "continuity-checksum-missing"), "Validator should surface missing continuity footers on ordinary traces.");
}

function testValidatorFindsMissingTopicStructure() {
  const artifactPath = path.join(packageRoot, ".test-temp", "topic-structure-missing", "001-topic-structure-missing.trace.md");
  const markdown = finalizeContinuityIntegrity(`# Continuity Context

- Envelope Schema: [tiinex.root.v1](https://github.com/Tiinex/docs/blob/0e6d169685d56c913cb890ba568a96b366ebd4bf/.topics/.schemas/tiinex.root.v1.schema.md)
- Current
  - Current Schema: [tiinex.topic.v1](https://github.com/Tiinex/docs/blob/4a64e25b9d4dc657104bee51877d140ee93f4b2/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Created At: 2026-06-02 22:38:22
  - Summary: Missing topic structure fixture.

---

Body content without a title or named topic sections.

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [tiinex.topic.v1](https://github.com/Tiinex/docs/blob/4a64e25b9d4dc657104bee51877d140ee93f4b2/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Value: PLACEHOLDER`);
  const docsRoot = path.resolve(packageRoot, "..", "..", "..", "docs");
  const result = validateTraceableContinuityArtifactChainSync({
    filePath: artifactPath,
    readTextFileSync: (filePath) => {
      if (path.resolve(filePath) === path.resolve(artifactPath)) {
        return markdown;
      }
      throw new Error(`Missing test fixture ${filePath}`);
    },
    workspaceRoots: [{ name: "docs", fsPath: docsRoot }],
    gitRevisionExistsSync: () => true,
    maxDepth: 1
  });

  assert.ok(result.findings.some((finding) => finding.code === "topic-required-structure-missing"), "Validator should surface missing body-title or topic-section structure on ordinary tiinex.topic.v1 traces.");
}

function testValidatorFindsUnreadableParentTraceTarget() {
  const artifactPath = path.join(packageRoot, ".test-temp", "continuity-parent-trace-unreadable", "001-parent-trace-unreadable.trace.md");
  const markdown = finalizeContinuityIntegrity(`# Continuity Context

- Envelope Schema: [tiinex.root.v1](https://github.com/Tiinex/docs/blob/0e6d169685d56c913cb890ba568a96b366ebd4bf/.topics/.schemas/tiinex.root.v1.schema.md)
- Parent
  - Parent Schema: [tiinex.topic.v1](https://github.com/Tiinex/docs/blob/4a64e25b9d4dc657104bee51877d140ee93f4b2/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Created At: 2026-06-01 03:15:00
  - Trace: [../001.trace.md](../001.trace.m)
- Current
  - Current Schema: [tiinex.topic.v1](https://github.com/Tiinex/docs/blob/4a64e25b9d4dc657104bee51877d140ee93f4b2/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Created At: 2026-06-02 22:38:22
  - Summary: Broken Parent Trace fixture.

---

# Broken Parent Trace

## Summary

- Fixture: unreadable-parent-trace

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [tiinex.topic.v1](https://github.com/Tiinex/docs/blob/4a64e25b9d4dc657104bee51877d140ee93f4b2/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Value: PLACEHOLDER`);
  const docsRoot = path.resolve(packageRoot, "..", "..", "..", "docs");
  const result = validateTraceableContinuityArtifactChainSync({
    filePath: artifactPath,
    readTextFileSync: (filePath) => {
      if (path.resolve(filePath) === path.resolve(artifactPath)) {
        return markdown;
      }
      throw new Error(`Missing test fixture ${filePath}`);
    },
    workspaceRoots: [{ name: "docs", fsPath: docsRoot }],
    gitRevisionExistsSync: () => true,
    maxDepth: 1
  });

  assert.ok(result.findings.some((finding) => finding.code === "traceable-parent-trace-unreadable"), "Validator should surface Parent Trace targets that cannot be read.");
}

function testValidatorFindsUnreadableCurrentOriginAndFooterPermalinks() {
  const artifactPath = path.join(packageRoot, ".test-temp", "continuity-current-origin-and-footer-unreadable", "001-current-origin-and-footer-unreadable.trace.md");
  const brokenRevision = "0000000000000000000000000000000000000000";
  const validDocsRevision = "0e6d169685d56c913cb890ba568a96b366ebd4bf";
  const markdown = finalizeContinuityIntegrity(`# Continuity Context

- Envelope Schema: [tiinex.root.v1](https://github.com/Tiinex/docs/blob/${validDocsRevision}/.topics/.schemas/tiinex.root.v1.schema.md)
- Current
  - Current Schema: [tiinex.topic.v1](https://github.com/Tiinex/docs/blob/${validDocsRevision}/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Created At: 2026-06-02 22:38:22
  - Summary: Broken Current Origin and footer permalink fixture.
  - Origin:
    - [browse + git](https://github.com/Tiinex/.github/blob/${brokenRevision}/.topics/rfc/001-1-1-1.trace.md)

---

# Broken Current Origin And Footer Permalink Fixture

## Current Read

This fixture uses commit-pinned links that cannot be resolved for Current Origin and footer Towards.

## Design Direction

Ordinary trace validation should reject unreadable Current Origin and footer permalinks.

## Relevance

This prevents traces from looking pinned while still pointing nowhere.

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [tiinex.topic.v1](https://github.com/Tiinex/docs/blob/${brokenRevision}/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Value: PLACEHOLDER`);
  const docsRoot = path.resolve(packageRoot, "..", "..", "..", "docs");
  const githubRoot = path.resolve(packageRoot, "..", "..", "..", ".github");
  const result = validateTraceableContinuityArtifactChainSync({
    filePath: artifactPath,
    readTextFileSync: (filePath) => {
      if (path.resolve(filePath) === path.resolve(artifactPath)) {
        return markdown;
      }
      if (isUnderPath(filePath, docsRoot) || isUnderPath(filePath, githubRoot)) {
        return "# stub";
      }
      throw new Error(`Missing test fixture ${filePath}`);
    },
    workspaceRoots: [
      { name: "docs", fsPath: docsRoot },
      { name: ".github", fsPath: githubRoot }
    ],
    gitRevisionExistsSync: (_repoRoot, revision) => revision !== brokenRevision,
    maxDepth: 1
  });

  assert.ok(result.findings.some((finding) => finding.code === "traceable-current-origin-browse-git-unreadable"), "Validator should surface Current Origin browse + git permalinks that cannot be resolved.");
  assert.ok(result.findings.some((finding) => finding.code === "continuity-footer-towards-unreadable"), "Validator should surface footer Towards permalinks that cannot be resolved.");
  assert.ok(result.findings.some((finding) => finding.code === "continuity-footer-self-required-without-parent"), "Validator should require self as footer Towards when an ordinary trace has no parent signal.");
}

function testTaskSchemaNoteDoesNotTriggerTaskArtifactRule() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.task.v1.schema.md");
  const result = validateTraceableContinuityArtifactChainSync({
    filePath: schemaPath,
    maxDepth: 1
  });

  assert.ok(!result.findings.some((finding) => finding.code === "task-required-structure-missing"), "Schema notes under .topics/.schemas should not be treated as ordinary task artifacts for task body validation.");
}

function testCurrentValidatorTaskLeafSatisfiesTaskStructureRule() {
  const taskLeafPath = path.join(packageRoot, "..", "..", ".topics", "tools", "validator", "001-4-validator-interop-profile-task.trace.md");
  const result = validateTraceableContinuityArtifactChainSync({
    filePath: taskLeafPath,
    maxDepth: 1
  });

  assert.ok(!result.findings.some((finding) => finding.code === "task-required-structure-missing"), "The current validator interop-profile task leaf should satisfy the bounded task-structure rule.");
}

function testRuntimeTraceStructureValidationAgainstTransferFixture() {
  const transferFixturePath = path.join(packageRoot, "..", "..", ".topics", ".templates", "transfer-test", "001-2-1-leo.trace.md");
  const result = validateTraceableContinuityArtifactChainSync({
    filePath: transferFixturePath,
    maxDepth: 1
  });
  const rootNode = result.nodes[0];
  assert.ok(rootNode, "Continuity validator should return the current transfer fixture node.");
  assert.deepEqual(rootNode.runtimeTraceStructure?.requiredTopLevelSectionsMissing ?? [], [], "Current ai-provenance runtime traces should expose the required top-level sections described by the owned schema.");
  assert.deepEqual(rootNode.runtimeTraceStructure?.recommendedTopLevelSectionsMissing ?? [], [], "Current transfer fixtures should expose the repeated runtime top-level sections that the owned schema now describes explicitly.");
  assert.ok((rootNode.runtimeTraceStructure?.optionalStateSectionsPresent ?? []).includes("sender adaptation state"), "Current transfer fixtures should surface sender adaptation state when present.");
  assert.ok((rootNode.runtimeTraceStructure?.optionalStateSectionsPresent ?? []).includes("traceable state"), "Current transfer fixtures should surface the embedded Traceable State block when present.");
  assert.ok((rootNode.runtimeTraceStructure?.optionalStateSectionsPresent ?? []).includes("activity timeline"), "Current transfer fixtures should surface the activity timeline when present.");
}

function testParseCurrentRuntimeSchemaContinuity() {
  const schemaPath = path.join(packageRoot, "..", "..", ".topics", ".schemas", "tiinex.runtime.trace.v1.schema.md");
  const parsed = parseTraceableContinuityMarkdown(readFileSync(schemaPath, "utf8"));
  assert.equal(parsed.currentSchema?.label, "tiinex.runtime.trace.v1", "Continuity parser should recover the current schema id from the owned ai-provenance runtime schema.");
  assert.equal(parsed.parentSchema?.label, "tiinex.ai.runtime.v1", "Continuity parser should recover the parent schema id from the owned ai-provenance runtime schema.");
  assert.equal(parsed.parentCreatedAt, "2026-05-29 23:21:06", "Continuity parser should recover the parent Created At value from the continuity header.");
  assert.equal(parsed.currentCreatedAt, "2026-05-28 19:01:45", "Continuity parser should recover the current Created At value from the continuity header.");
  assert.equal(parsed.currentSummary, "Shared schema for current Tiinex runtime-generated AI trace and evidence exports, layered on top of the broader AI runtime contract.", "Continuity parser should recover the current Summary value from the continuity header.");
  assert.equal(parsed.footerIntegrity?.method, "sha256-base64url-c14n-v1", "Continuity parser should recover the current footer checksum method.");
}

function testRootSchemaValidationContractSelfValidates() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.root.v1.schema.md");
  const result = validateTraceableRootSchemaSync({ filePath: schemaPath });

  assert.ok(
    !result.findings.some((finding) => finding.code.startsWith("root-schema-contract") || finding.code === "root-schema-validation-contract-missing"),
    "The maintained root schema should satisfy the bounded root contract validator without root-contract findings."
  );
}

function testRootSchemaValidatorRequiresRootEnvelopeSchema() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.root.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8").replace(
    "- Envelope Schema: [tiinex.root.v1](tiinex.root.v1.schema.md)",
    "- Envelope Schema: [tiinex.continuation.v1](tiinex.continuation.v1.schema.md)"
  );
  const result = validateTraceableRootSchemaSync({
    filePath: schemaPath,
    readTextFileSync: () => markdown
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "root-schema-envelope-schema-mismatch"),
    "The root validator should require tiinex.root.v1 as its Envelope Schema."
  );
}

function testRootSchemaValidatorRequiresReadableEnvelopeSchemaTarget() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.root.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8").replace(
    "- Envelope Schema: [tiinex.root.v1](tiinex.root.v1.schema.md)",
    "- Envelope Schema: [tiinex.root.v1](missing-root-schema.md)"
  );
  const result = validateTraceableRootSchemaSync({
    filePath: schemaPath,
    readTextFileSync: (targetPath) => {
      if (path.resolve(targetPath) === path.resolve(schemaPath)) {
        return markdown;
      }
      return readFileSync(targetPath, "utf8");
    }
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "root-schema-envelope-schema-unreadable"),
    "The root validator should fail when the Envelope Schema target cannot be read."
  );
}

function testRootSchemaValidatorRequiresReadableCurrentSchemaTarget() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.root.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8").replace(
    "- Current Schema: [tiinex.root.v1](tiinex.root.v1.schema.md)",
    "- Current Schema: [tiinex.root.v1](missing-root-schema.md)"
  );
  const result = validateTraceableRootSchemaSync({
    filePath: schemaPath,
    readTextFileSync: (targetPath) => {
      if (path.resolve(targetPath) === path.resolve(schemaPath)) {
        return markdown;
      }
      return readFileSync(targetPath, "utf8");
    }
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "root-schema-current-schema-unreadable"),
    "The root validator should fail when the Current Schema target cannot be read."
  );
}

function testRootSchemaValidationContractRejectsStarBullets() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.root.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8").replace(
    "- Schema Validation Contract",
    "* Schema Validation Contract"
  );
  const result = validateTraceableRootSchemaSync({
    filePath: schemaPath,
    readTextFileSync: () => markdown
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "root-schema-contract-star-bullets-present"),
    "The root contract validator should reject star bullets inside Schema Validation Contract."
  );
}

function testRootSchemaValidationContractRejectsPlusBullets() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.root.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8").replace(
    "- Schema Validation Contract",
    "+ Schema Validation Contract"
  );
  const result = validateTraceableRootSchemaSync({
    filePath: schemaPath,
    readTextFileSync: () => markdown
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "root-schema-contract-plus-bullets-present"),
    "The root contract validator should reject plus bullets inside Schema Validation Contract."
  );
}

function testRootSchemaValidationContractRequiresCategoryLists() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.root.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8").replace(
    /Validation Authority\r?\n\r?\n- Schema Validation Contract/u,
    "Validation Authority"
  );
  const result = validateTraceableRootSchemaSync({
    filePath: schemaPath,
    readTextFileSync: () => markdown
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "root-schema-contract-category-list-missing"),
    "The root contract validator should require each category label to have a following hyphen list."
  );
}

function testRootSchemaValidationContractRequiresPolicyGroups() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.root.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8").replace(/### Unknown Handling[\s\S]*?### Matching And Normalization/u, "### Matching And Normalization");
  const result = validateTraceableRootSchemaSync({
    filePath: schemaPath,
    readTextFileSync: () => markdown
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "root-schema-contract-groups-missing" && finding.message.includes("Unknown Handling")),
    "The root contract validator should require the maintained policy groups to remain present."
  );
}

function testRootSchemaValidationContractRejectsUnexpectedCategoryLabels() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.root.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8").replace(
    /(\r?\n)Severity Levels(\r?\n)(\r?\n)- error/u,
    "$1Severity Levelz$2$3- error"
  );
  const result = validateTraceableRootSchemaSync({
    filePath: schemaPath,
    readTextFileSync: () => markdown
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "root-schema-contract-unexpected-category-label" && finding.message.includes("Severity Levelz")),
    "The root contract validator should reject category labels that are not declared in Known Category Labels."
  );
}

function testRootSchemaValidationContractRejectsDuplicateNamedDeclarations() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.root.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8").replace(
    /### Extension\r?\n\r?\nRequired When/u,
    `### Extension

- Example Extension
  - Base Concept: Example base concept.
  - Interpretation: Example interpretation.
- Example Extension
  - Base Concept: Example base concept again.
  - Interpretation: Example interpretation again.

Required When`
  );
  const result = validateTraceableRootSchemaSync({
    filePath: schemaPath,
    readTextFileSync: () => markdown
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "root-schema-contract-duplicate-declarations" && finding.message.includes("Extension -> Example Extension")),
    "The root contract validator should reject duplicate named declaration entries within declaration-capable groups."
  );
  assert.ok(
    !result.findings.some((finding) => finding.code === "root-schema-contract-unlabeled-list" && finding.message.includes("Example Extension")),
    "Named declaration entries should no longer collapse into generic unlabeled-list findings."
  );
}

function testRootSchemaValidatorWarnsUnexpectedEnvelopeFields() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.root.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8").replace("- Summary: Root schema for Tiinex lineage artifacts.", "- Summmary: Root schema for Tiinex lineage artifacts.");
  const result = validateTraceableRootSchemaSync({
    filePath: schemaPath,
    readTextFileSync: () => markdown
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "root-schema-lineage-unexpected-envelope-field" && finding.message.includes("Summmary") && finding.severity === "warning"),
    "The root validator should warn when the continuity envelope contains undeclared fields."
  );
}

function testRootSchemaValidatorUsesRootDeclaredEnvelopeFieldLists() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.root.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8")
    .replace("- Summary: Root schema for Tiinex lineage artifacts.", "- Summmary: Root schema for Tiinex lineage artifacts.")
    .replace(/Optional Fields\r?\n\r?\n- Summary/u, "Optional Fields\n\n- Summmary");
  const result = validateTraceableRootSchemaSync({
    filePath: schemaPath,
    readTextFileSync: () => markdown
  });

  assert.ok(
    !result.findings.some((finding) => finding.code === "root-schema-lineage-unexpected-envelope-field" && finding.message.includes("Summmary")),
    "The root validator should follow root-declared envelope field lists when deciding whether a field is undeclared."
  );
}

function testRootSchemaValidatorRejectsUnexpectedSectionHeadings() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.root.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8").replace(
    "## Extension",
    "## Extra Section\n\nUnexpected prose.\n\n## Extension"
  );
  const result = validateTraceableRootSchemaSync({
    filePath: schemaPath,
    readTextFileSync: () => markdown
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "root-schema-layout-unexpected-heading" && finding.message.includes("Extra Section")),
    "The root validator should reject unexpected body section headings."
  );
}

function testRootSchemaValidatorFlagsMissingExpectedSectionHeading() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.root.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8").replace(/## Inheritance[\s\S]*?## Extension/u, "## Extension");
  const result = validateTraceableRootSchemaSync({
    filePath: schemaPath,
    readTextFileSync: () => markdown
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "root-schema-layout-missing-heading" && finding.message.includes("Inheritance")),
    "The root validator should warn when an expected body section heading is missing."
  );
}

function testModernSchemaNoteValidationContractCountsAsCoreContract() {
  const artifactPath = path.join(packageRoot, "..", "..", ".topics", ".schemas", ".test-temp", "schema-validation-contract", "001-modern-schema-note.md");
  const markdown = finalizeContinuityIntegrity(`# Continuity Context

- Envelope Schema: [tiinex.continuation.v1](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
- Parent
  - Parent Schema: [tiinex.continuation.v1](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
  - Created At: 2026-06-04 00:00:00
  - Trace: [tiinex.continuation.v1.schema.md](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
- Current
  - Current Schema: [tiinex.topic.v1](../../docs/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Created At: 2026-06-04 00:00:01
  - Summary: Modern schema contract fixture.

---

# Topic Fixture

## Summary

Modern topic-schema fixture.

## Schema Validation Contract

### Topic Scope

Applies To

- artifacts whose Current Schema is tiinex.topic.v1

Rules

- This fixture uses Schema Validation Contract as its machine validation surface.

## Validation-Friendly Shape

- Fixture: modern shape present.

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [tiinex.continuation.v1.schema.md](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
  - Value: PLACEHOLDER`);
  const result = validateTraceableContinuityArtifactChainSync({
    filePath: artifactPath,
    readTextFileSync: () => markdown,
    maxDepth: 1
  });

  assert.ok(
    !result.findings.some((finding) => finding.code === "schema-definition-core-contract-missing"),
    "Modern schema notes with Schema Validation Contract should satisfy the shared core-contract check."
  );
  assert.ok(
    !result.findings.some((finding) => finding.code.startsWith("schema-validation-contract-")),
    "A well-formed descendant Schema Validation Contract fixture should not raise generic contract-shape findings."
  );
}

function testModernSchemaNoteValidationContractRejectsStarBullets() {
  const artifactPath = path.join(packageRoot, "..", "..", ".topics", ".schemas", ".test-temp", "schema-validation-contract", "001-modern-schema-note-invalid.md");
  const markdown = finalizeContinuityIntegrity(`# Continuity Context

- Envelope Schema: [tiinex.continuation.v1](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
- Parent
  - Parent Schema: [tiinex.continuation.v1](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
  - Created At: 2026-06-04 00:00:00
  - Trace: [tiinex.continuation.v1.schema.md](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
- Current
  - Current Schema: [tiinex.topic.v1](../../docs/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Created At: 2026-06-04 00:00:01
  - Summary: Modern schema contract invalid fixture.

---

# Topic Fixture

## Summary

Modern topic-schema invalid fixture.

## Schema Validation Contract

### Topic Scope

Applies To

* artifacts whose Current Schema is tiinex.topic.v1

Rules

- This fixture intentionally breaks the list marker shape.

## Validation-Friendly Shape

- Fixture: modern shape present.

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [tiinex.continuation.v1.schema.md](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
  - Value: PLACEHOLDER`);
  const result = validateTraceableContinuityArtifactChainSync({
    filePath: artifactPath,
    readTextFileSync: () => markdown,
    maxDepth: 1
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "schema-validation-contract-star-bullets-present"),
    "A malformed descendant Schema Validation Contract should surface the generic star-bullet finding."
  );
}

function testPortedTopicSchemaSelfValidatesWhenChecksumIsRefreshed() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.topic.v1.schema.md");
  const markdown = finalizeContinuityIntegrity(readFileSync(schemaPath, "utf8"));
  const result = validateTraceableContinuityArtifactChainSync({
    filePath: schemaPath,
    readTextFileSync: (filePath) => filePath === schemaPath ? markdown : readFileSync(filePath, "utf8"),
    maxDepth: 2
  });

  assert.equal(result.nodes[0]?.parsed.parentSchema?.label, "tiinex.root.v1", "The ported topic schema should declare tiinex.root.v1 as its direct parent schema.");
  assert.ok(
    !result.findings.some((finding) => finding.code === "traceable-parent-schema-mismatch"),
    "The ported topic schema should not report a parent-schema mismatch when its checksum is refreshed."
  );
  assert.ok(
    !result.findings.some((finding) => finding.code.startsWith("schema-validation-contract-") || finding.code.startsWith("artifact-creation-contract-")),
    "The fully ported topic schema should satisfy both contract-shape validators once its footer checksum is refreshed."
  );
}

function testSubschemaValidatorAcceptsRotatedChecksum() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.topic.v1.schema.md");
  const result = validateTraceableTopicSchemaSync({ filePath: schemaPath });

  assert.equal(result.parsed.envelopeSchema?.label, "tiinex.root.v1", "The topic validator should now treat the root schema as the active envelope schema for the maintained topic schema.");
  assert.equal(result.parsed.parentSchema?.label, "tiinex.root.v1", "The topic validator should still follow the root parent schema for the current topic schema.");
  assert.equal(result.parsed.footerIntegrity?.towardsTarget, result.parsed.parentOrigin?.browseGit, "The maintained topic schema footer should target the same commit-pinned root-schema permalink as Parent Origin browse + git.");
  assert.ok(
    !result.findings.some((finding) => finding.code === "continuity-checksum-mismatch"),
    "The topic validator should accept the committed topic schema once its continuity checksum has been rotated."
  );
  assert.ok(
    !result.findings.some((finding) => finding.code.startsWith("topic-schema-") || finding.code === "topic-schema-parent-root-invalid"),
    "The current ported topic schema should pass the standalone topic validator on structure and root lineage."
  );
}

function testDecisionSchemaValidatorAcceptsCommittedSchema() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.decision.v1.schema.md");
  const result = validateTraceableDecisionSchemaSync({ filePath: schemaPath });

  assert.equal(result.parsed.envelopeSchema?.label, "tiinex.root.v1", "The decision validator should treat the root schema as the active envelope schema for the maintained decision schema.");
  assert.equal(result.parsed.parentSchema?.label, "tiinex.root.v1", "The decision validator should still follow the root parent schema for the maintained decision schema.");
  assert.equal(result.parsed.footerIntegrity?.towardsTarget, result.parsed.parentOrigin?.browseGit, "The maintained decision schema footer should target the same commit-pinned root-schema permalink as Parent Origin browse + git.");
  assert.ok(
    !result.findings.some((finding) => finding.code === "continuity-checksum-mismatch"),
    "The decision validator should accept the committed decision schema once its continuity checksum has been rotated."
  );
  assert.ok(
    !result.findings.some((finding) => finding.code.startsWith("decision-schema-") || finding.code === "decision-schema-parent-root-invalid"),
    "The current ported decision schema should pass the standalone decision validator on structure and root lineage."
  );
}

function testTaskSchemaValidatorAcceptsCommittedSchema() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.task.v1.schema.md");
  const result = validateTraceableTaskSchemaSync({ filePath: schemaPath });

  assert.equal(result.parsed.envelopeSchema?.label, "tiinex.root.v1", "The task validator should treat the root schema as the active envelope schema for the maintained task schema.");
  assert.equal(result.parsed.parentSchema?.label, "tiinex.root.v1", "The task validator should still follow the root parent schema for the maintained task schema.");
  assert.equal(result.parsed.footerIntegrity?.towardsTarget, result.parsed.parentOrigin?.browseGit, "The maintained task schema footer should target the same commit-pinned root-schema permalink as Parent Origin browse + git.");
  assert.ok(
    !result.findings.some((finding) => finding.code === "continuity-checksum-mismatch"),
    "The task validator should accept the committed task schema once its continuity checksum has been rotated."
  );
  assert.ok(
    !result.findings.some((finding) => finding.code.startsWith("task-schema-") || finding.code === "task-schema-parent-root-invalid"),
    "The current ported task schema should pass the standalone task validator on structure and root lineage."
  );
}

function testEvidenceSchemaValidatorAcceptsCommittedSchema() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.evidence.v1.schema.md");
  const result = validateTraceableEvidenceSchemaSync({ filePath: schemaPath });

  assert.equal(result.parsed.envelopeSchema?.label, "tiinex.root.v1", "The evidence validator should treat the root schema as the active envelope schema for the maintained evidence schema.");
  assert.equal(result.parsed.parentSchema?.label, "tiinex.root.v1", "The evidence validator should still follow the root parent schema for the maintained evidence schema.");
  assert.equal(result.parsed.footerIntegrity?.towardsTarget, result.parsed.parentOrigin?.browseGit, "The maintained evidence schema footer should target the same commit-pinned root-schema permalink as Parent Origin browse + git.");
  assert.ok(
    !result.findings.some((finding) => finding.code === "continuity-checksum-mismatch"),
    "The evidence validator should accept the committed evidence schema once its continuity checksum has been rotated."
  );
  assert.ok(
    !result.findings.some((finding) => finding.code.startsWith("evidence-schema-") || finding.code === "evidence-schema-parent-root-invalid"),
    "The current ported evidence schema should pass the standalone evidence validator on structure and root lineage."
  );
}

function testPointerSchemaValidatorAcceptsCommittedSchema() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.pointer.v1.schema.md");
  const result = validateTraceablePointerSchemaSync({ filePath: schemaPath });

  assert.equal(result.parsed.envelopeSchema?.label, "tiinex.root.v1", "The pointer validator should treat the root schema as the active envelope schema for the maintained pointer schema.");
  assert.equal(result.parsed.parentSchema?.label, "tiinex.root.v1", "The pointer validator should still follow the root parent schema for the maintained pointer schema.");
  assert.equal(result.parsed.footerIntegrity?.towardsTarget, result.parsed.parentOrigin?.browseGit, "The maintained pointer schema footer should target the same commit-pinned root-schema permalink as Parent Origin browse + git.");
  assert.ok(
    !result.findings.some((finding) => finding.code === "continuity-checksum-mismatch"),
    "The pointer validator should accept the committed pointer schema once its continuity checksum has been rotated."
  );
  assert.ok(
    !result.findings.some((finding) => finding.code.startsWith("pointer-schema-") || finding.code === "pointer-schema-parent-root-invalid"),
    "The current ported pointer schema should pass the standalone pointer validator on structure and root lineage."
  );
}

function testTopicSchemaValidatorRequiresRootEnvelopeSchema() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.topic.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8").replace(
    "- Envelope Schema: [tiinex.root.v1](tiinex.root.v1.schema.md)",
    "- Envelope Schema: [tiinex.continuation.v1](tiinex.continuation.v1.schema.md)"
  );
  const result = validateTraceableTopicSchemaSync({
    filePath: schemaPath,
    readTextFileSync: () => markdown
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "topic-schema-envelope-schema-mismatch"),
    "The topic validator should require tiinex.root.v1 as the maintained topic schema envelope."
  );
}

function testTopicSchemaValidatorRequiresReadableEnvelopeSchemaTarget() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.topic.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8").replace(
    "- Envelope Schema: [tiinex.root.v1](tiinex.root.v1.schema.md)",
    "- Envelope Schema: [tiinex.root.v1](missing-root-schema.md)"
  );
  const result = validateTraceableTopicSchemaSync({
    filePath: schemaPath,
    readTextFileSync: (targetPath) => {
      if (path.resolve(targetPath) === path.resolve(schemaPath)) {
        return markdown;
      }
      return readFileSync(targetPath, "utf8");
    }
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "topic-schema-envelope-schema-unreadable"),
    "The topic validator should fail when the Envelope Schema target cannot be read."
  );
}

function testTopicSchemaValidatorRequiresReadableParentSchemaTarget() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.topic.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8").replace(
    "- Parent Schema: [tiinex.root.v1](tiinex.root.v1.schema.md)",
    "- Parent Schema: [tiinex.root.v1](missing-root-schema.md)"
  );
  const result = validateTraceableTopicSchemaSync({
    filePath: schemaPath,
    readTextFileSync: (targetPath) => {
      if (path.resolve(targetPath) === path.resolve(schemaPath)) {
        return markdown;
      }
      return readFileSync(targetPath, "utf8");
    }
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "topic-schema-parent-schema-unreadable"),
    "The topic validator should fail when the Parent Schema target cannot be read."
  );
}

function testTopicSchemaValidatorRequiresReadableCurrentSchemaTarget() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.topic.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8").replace(
    "- Current Schema: [tiinex.topic.v1](tiinex.topic.v1.schema.md)",
    "- Current Schema: [tiinex.topic.v1](missing-topic-schema.md)"
  );
  const result = validateTraceableTopicSchemaSync({
    filePath: schemaPath,
    readTextFileSync: (targetPath) => {
      if (path.resolve(targetPath) === path.resolve(schemaPath)) {
        return markdown;
      }
      return readFileSync(targetPath, "utf8");
    }
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "topic-schema-current-schema-unreadable"),
    "The topic validator should fail when the Current Schema target cannot be read."
  );
}

function testTopicSchemaValidatorRejectsUnexpectedSectionHeading() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.topic.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8").replace(
    "## Interpretation Notes",
    "## Interpretasion Notes\n\nBroken heading.\n\n## Interpretation Notes"
  );
  const result = validateTraceableTopicSchemaSync({
    filePath: schemaPath,
    readTextFileSync: () => markdown
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "topic-schema-layout-unexpected-heading" && finding.message.includes("Interpretasion Notes")),
    "The topic validator should reject unexpected or misspelled section headings."
  );
}

function testTopicSchemaValidatorRequiresParentOriginWhenParentExists() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.topic.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8").replace(
    /\r?\n  - Origin:\r?\n    - \[relative\]\(tiinex\.root\.v1\.schema\.md\)\r?\n    - \[browse \+ git\]\([^\r\n]+\)/u,
    ""
  );
  const result = validateTraceableTopicSchemaSync({
    filePath: schemaPath,
    readTextFileSync: () => markdown
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "topic-schema-parent-origin-missing"),
    "The topic validator should require Parent Origin when a parent is declared."
  );
}

function testTopicSchemaValidatorRequiresParentOriginBrowseGitPermalink() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.topic.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8").replace(
    /\r?\n    - \[browse \+ git\]\([^\r\n]+\)/u,
    ""
  );
  const result = validateTraceableTopicSchemaSync({
    filePath: schemaPath,
    readTextFileSync: () => markdown
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "topic-schema-parent-origin-browse-git-missing"),
    "The topic validator should require a Parent Origin browse + git permalink."
  );
}

function testTopicSchemaValidatorRequiresCommitPinnedParentOriginBrowseGitPermalink() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.topic.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8").replace(
    /https:\/\/github\.com\/Tiinex\/docs\/blob\/[0-9a-f]{7,40}\/\.topics\/\.schemas\/tiinex\.root\.v1\.schema\.md/u,
    "https://github.com/Tiinex/docs/blob/master/.topics/.schemas/tiinex.root.v1.schema.md"
  );
  const result = validateTraceableTopicSchemaSync({
    filePath: schemaPath,
    readTextFileSync: () => markdown
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "topic-schema-parent-origin-unpinned-browse-git"),
    "The topic validator should reject a Parent Origin browse + git target that is not commit-pinned."
  );
}

function testTopicSchemaValidatorRejectsInvalidParentCreatedAtValue() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.topic.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8").replace(
    /- Created At: 2026-06-04 13:47:57/u,
    "- Created At: 20X6-05-28 18:11:47XXXXXXXXXXX"
  );
  const result = validateTraceableTopicSchemaSync({
    filePath: schemaPath,
    readTextFileSync: () => markdown
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "topic-schema-parent-created-at-invalid"),
    "The topic validator should reject Parent Created At values that are not in the expected YYYY-MM-DD hh:mm:ss shape."
  );
}

function testTopicSchemaValidatorRequiresParentCreatedAtWhenParentExists() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.topic.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8").replace(
    /\n  - Created At: 2026-06-04 13:47:57/u,
    ""
  );
  const result = validateTraceableTopicSchemaSync({
    filePath: schemaPath,
    readTextFileSync: () => markdown
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "topic-schema-parent-created-at-missing"),
    "The topic validator should require Parent Created At when a parent trace is declared."
  );
}

function testTopicSchemaValidatorRequiresParentCreatedAtToMatchParentArtifact() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.topic.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8").replace(
    /- Created At: 2026-06-04 13:47:57/u,
    "- Created At: 2026-06-04 13:47:58"
  );
  const result = validateTraceableTopicSchemaSync({
    filePath: schemaPath,
    readTextFileSync: () => markdown
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "topic-schema-parent-created-at-mismatch"),
    "The topic validator should require Parent Created At to match the parent artifact Current Created At."
  );
}

function testTopicSchemaValidatorRequiresFooterTargetPermalink() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.topic.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8").replace(
    /- Towards: \[tiinex\.root\.v1\.schema\.md\]\(https:\/\/github\.com\/Tiinex\/docs\/blob\/[0-9a-f]{7,40}\/\.topics\/\.schemas\/tiinex\.root\.v1\.schema\.md\)/u,
    "- Towards: [tiinex.root.v1.schema.md](tiinex.root.v1.schema.md)"
  );
  const result = validateTraceableTopicSchemaSync({
    filePath: schemaPath,
    readTextFileSync: () => markdown
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "topic-schema-footer-target-not-permalink"),
    "The topic validator should require a commit-pinned permalink in the topic-schema footer target."
  );
}

function testTopicSchemaValidatorRequiresFooterTargetToMatchParentOriginPermalink() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.topic.v1.schema.md");
  const currentMarkdown = readFileSync(schemaPath, "utf8");
  const currentCommitHash = currentMarkdown.match(/https:\/\/github\.com\/Tiinex\/docs\/blob\/([0-9a-f]{7,40})\/\.topics\/\.schemas\/tiinex\.root\.v1\.schema\.md/u)?.[1] ?? "HEAD";
  const markdown = currentMarkdown.replace(
    /- Towards: \[tiinex\.root\.v1\.schema\.md\]\(https:\/\/github\.com\/Tiinex\/docs\/blob\/[0-9a-f]{7,40}\/\.topics\/\.schemas\/tiinex\.root\.v1\.schema\.md\)/u,
    `- Towards: [tiinex.topic.v1.schema.md](https://github.com/Tiinex/docs/blob/${currentCommitHash}/.topics/.schemas/tiinex.topic.v1.schema.md)`
  );
  const result = validateTraceableTopicSchemaSync({
    filePath: schemaPath,
    readTextFileSync: () => markdown
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "topic-schema-footer-target-mismatch"),
    "The topic validator should require the footer target permalink to match the Parent Origin browse + git permalink."
  );
}

function testTopicSchemaValidatorUsesFooterTargetArtifactForChecksumVerification() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.topic.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8").replace(
    "This schema defines artifacts whose main job is to carry one bounded working\ntopic forward.",
    "This schema defines artifacts whose main job is to carry one bounded working\ntopic forward while the footer still targets the root schema artifact."
  );
  const result = validateTraceableTopicSchemaSync({
    filePath: schemaPath,
    readTextFileSync: (targetPath) => {
      if (path.resolve(targetPath) === path.resolve(schemaPath)) {
        return markdown;
      }
      return readFileSync(targetPath, "utf8");
    }
  });

  assert.ok(
    !result.findings.some((finding) => finding.code === "continuity-checksum-mismatch"),
    "The topic validator should verify the footer checksum against the declared footer target artifact rather than the current topic body when Towards points to the root schema."
  );
}

function testTopicSchemaValidatorRejectsUnexpectedContractVocabulary() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.topic.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8")
    .replace("### Topic Scope", "### Topi Scope")
    .replace("Applies To", "Applies T");
  const result = validateTraceableTopicSchemaSync({
    filePath: schemaPath,
    readTextFileSync: () => markdown
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "topic-schema-contract-unexpected-group" && finding.message.includes("Topi Scope")),
    "The topic validator should reject unexpected contract group headings inside Schema Validation Contract."
  );
  assert.ok(
    result.findings.some((finding) => finding.code === "topic-schema-contract-unexpected-category-label" && finding.message.includes("Applies T")),
    "The topic validator should reject unexpected contract category labels inside Schema Validation Contract."
  );
}

function testTopicSchemaValidatorWarnsUnexpectedVocabularyWhenLineageIsUnavailable() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.topic.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8")
    .replace("### Topic Scope", "### Topi Scope")
    .replace("Applies To", "Applies T")
    .replace("- Trace: [tiinex.root.v1.schema.md](tiinex.root.v1.schema.md)", "- Trace: self");
  const result = validateTraceableTopicSchemaSync({
    filePath: schemaPath,
    readTextFileSync: () => markdown
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "topic-schema-parent-trace-unresolvable"),
    "The topic validator should still surface that full root lineage is unavailable."
  );
  assert.ok(
    result.findings.some((finding) => finding.code === "topic-schema-contract-unexpected-group" && finding.message.includes("Topi Scope") && finding.severity === "warning"),
    "Unexpected contract groups should downgrade to warning when full schema lineage is unavailable."
  );
  assert.ok(
    result.findings.some((finding) => finding.code === "topic-schema-contract-unexpected-category-label" && finding.message.includes("Applies T") && finding.severity === "warning"),
    "Unexpected contract category labels should downgrade to warning when full schema lineage is unavailable."
  );
}

function testTopicSchemaValidatorAllowsDeclaredContractCategoryExtensions() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.topic.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8")
    .replace(
      "### Topic Scope",
      `### Contract Category Extension

- Extra Signal
  - Base Concept: Additional topic contract category label.
  - Interpretation: Carries schema-local extra signal.

### Topic Scope`
    )
    .replace(
      "Rules\n\n- `tiinex.topic.v1` identifies artifacts centered on one active topic thread.",
      "Extra Signal\n\n- schema-local extension payload\n\nRules\n\n- `tiinex.topic.v1` identifies artifacts centered on one active topic thread."
    );
  const result = validateTraceableTopicSchemaSync({
    filePath: schemaPath,
    readTextFileSync: (filePath) => filePath === schemaPath ? markdown : readFileSync(filePath, "utf8")
  });

  assert.ok(
    !result.findings.some((finding) => finding.code === "topic-schema-contract-unexpected-group" && finding.message.includes("Contract Category Extension")),
    "The topic validator should accept Contract Category Extension as a valid descendant extension group."
  );
  assert.ok(
    !result.findings.some((finding) => finding.code === "topic-schema-contract-unexpected-category-label" && finding.message.includes("Extra Signal")),
    "The topic validator should accept category labels declared through Contract Category Extension."
  );
}

function testTopicSchemaValidatorRejectsRedeclaredInheritedContractCategoryExtensions() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.topic.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8")
    .replace(
      "### Topic Scope",
      `### Contract Category Extension

- Rules
  - Base Concept: Attempts to redeclare an inherited label.
  - Interpretation: Should fail without explicit override semantics.

### Topic Scope`
    );
  const result = validateTraceableTopicSchemaSync({
    filePath: schemaPath,
    readTextFileSync: (filePath) => filePath === schemaPath ? markdown : readFileSync(filePath, "utf8")
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "topic-schema-contract-extension-redeclares-inherited-category-label" && finding.message.includes("Rules")),
    "The topic validator should reject Contract Category Extension entries that redeclare inherited category labels without explicit override semantics."
  );
}

function testTopicSchemaValidatorAllowsRedeclaredInheritedContractCategoryExtensionsWithExplicitOverride() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.topic.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8")
    .replace(
      "### Topic Scope",
      `### Contract Category Override

- Rules
  - Replacement Interpretation: Topic-local replacement meaning for Rules.

### Contract Category Extension

- Rules
  - Base Concept: Explicitly redeclared inherited label.
  - Interpretation: Allowed because override semantics are declared.

### Topic Scope`
    );
  const result = validateTraceableTopicSchemaSync({
    filePath: schemaPath,
    readTextFileSync: (filePath) => filePath === schemaPath ? markdown : readFileSync(filePath, "utf8")
  });

  assert.ok(
    !result.findings.some((finding) => finding.code === "topic-schema-contract-unexpected-group" && finding.message.includes("Contract Category Override")),
    "The topic validator should accept Contract Category Override as a valid override group."
  );
  assert.ok(
    !result.findings.some((finding) => finding.code === "topic-schema-contract-extension-redeclares-inherited-category-label" && finding.message.includes("Rules")),
    "The topic validator should allow inherited category label redeclaration when explicit override semantics are declared."
  );
}

function testTopicSchemaValidatorPreservesUnknownEnvelopeFieldsWhenLineageIsUnavailable() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.topic.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8")
    .replace("- Summary: Schema for bounded topic-oriented lineage artifacts.", "- Summmary: Schema for bounded topic-oriented lineage artifacts.")
    .replace("- Trace: [tiinex.root.v1.schema.md](tiinex.root.v1.schema.md)", "- Trace: self");
  const result = validateTraceableTopicSchemaSync({
    filePath: schemaPath,
    readTextFileSync: () => markdown
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "topic-schema-parent-trace-unresolvable"),
    "The topic validator should still surface missing full lineage in this preserve-mode envelope fixture."
  );
  assert.ok(
    !result.findings.some((finding) => finding.code === "topic-schema-lineage-unexpected-envelope-field"),
    "Unknown envelope fields should stay preserve-only when full schema lineage is unavailable."
  );
}

function testTopicSchemaValidatorWarnsUnexpectedEnvelopeFieldsWhenLineageIsAvailable() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.topic.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8").replace(
    "- Summary: Schema for bounded topic-oriented lineage artifacts.",
    "- Summmary: Schema for bounded topic-oriented lineage artifacts."
  );
  const result = validateTraceableTopicSchemaSync({
    filePath: schemaPath,
    readTextFileSync: () => markdown
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "topic-schema-lineage-unexpected-envelope-field" && finding.message.includes("Summmary") && finding.severity === "warning"),
    "Unknown envelope fields should warn once full schema lineage is available."
  );
}

function testTopicSchemaValidatorUsesRootDeclaredEnvelopeFieldLists() {
  const topicSchemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.topic.v1.schema.md");
  const rootSchemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.root.v1.schema.md");
  const topicMarkdown = readFileSync(topicSchemaPath, "utf8").replace(
    "- Summary: Schema for bounded topic-oriented lineage artifacts.",
    "- Summmary: Schema for bounded topic-oriented lineage artifacts."
  );
  const rootMarkdown = readFileSync(rootSchemaPath, "utf8").replace(/Optional Fields\r?\n\r?\n- Summary/u, "Optional Fields\n\n- Summmary");
  const result = validateTraceableTopicSchemaSync({
    filePath: topicSchemaPath,
    readTextFileSync: (filePath) => {
      if (path.resolve(filePath) === path.resolve(topicSchemaPath)) {
        return topicMarkdown;
      }
      if (path.resolve(filePath) === path.resolve(rootSchemaPath)) {
        return rootMarkdown;
      }
      return readFileSync(filePath, "utf8");
    }
  });

  assert.ok(
    !result.findings.some((finding) => finding.code === "topic-schema-lineage-unexpected-envelope-field" && finding.message.includes("Summmary")),
    "The topic validator should inherit allowed envelope field names from the resolved root contract."
  );
}

function testTopicSchemaValidatorRejectsDuplicateCategoryLabels() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.topic.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8").replace(
    "### Topic Body",
    "Rules\n\n- Duplicate rule marker.\n\n### Topic Body"
  );
  const result = validateTraceableTopicSchemaSync({
    filePath: schemaPath,
    readTextFileSync: () => markdown
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "topic-schema-contract-duplicate-category-labels" && finding.message.includes("Topic Scope -> Rules")),
    "The topic validator should reject duplicate contract category labels within the same group."
  );
}

function testTopicSchemaValidatorRequiresMaintainedValidationGroups() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.topic.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8").replace(/### File Naming[\s\S]*?### Interpretation Boundaries/u, "### Interpretation Boundaries");
  const result = validateTraceableTopicSchemaSync({
    filePath: schemaPath,
    readTextFileSync: () => markdown
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "topic-schema-contract-groups-missing" && finding.message.includes("File Naming")),
    "The topic validator should require the maintained Schema Validation Contract groups to remain present."
  );
}

function testTopicSchemaValidatorFlagsOutOfOrderSections() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.topic.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8")
    .replace("## Validation-Friendly Shape", "## TEMP-ORDER-MARKER")
    .replace("## Interpretation Notes", "## Validation-Friendly Shape")
    .replace("## TEMP-ORDER-MARKER", "## Interpretation Notes");
  const result = validateTraceableTopicSchemaSync({
    filePath: schemaPath,
    readTextFileSync: () => markdown
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "topic-schema-layout-heading-order" && finding.message.includes("Validation-Friendly Shape")),
    "The topic validator should warn when maintained body section headings move out of order."
  );
}

function testArtifactCreationContractRejectsStarBullets() {
  const artifactPath = path.join(packageRoot, "..", "..", ".topics", ".schemas", ".test-temp", "artifact-creation-contract", "001-topic-schema-invalid.md");
  const markdown = finalizeContinuityIntegrity(`# Continuity Context

- Envelope Schema: [tiinex.continuation.v1](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
- Parent
  - Parent Schema: [tiinex.continuation.v1](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
  - Created At: 2026-06-04 00:00:00
  - Trace: [tiinex.continuation.v1.schema.md](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
- Current
  - Current Schema: [tiinex.topic.v1](../../docs/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Created At: 2026-06-04 00:00:01
  - Summary: Artifact creation contract invalid fixture.

---

# Topic Fixture

## Summary

Artifact creation contract invalid fixture.

## Schema Validation Contract

### Topic Scope

Applies To

- artifacts whose Current Schema is tiinex.topic.v1

Rules

- This fixture only exists to exercise artifact creation contract validation.

## Artifact Creation Contract

### Prompt Fields

Required Fields

* version

Rules

- This fixture intentionally breaks the list marker shape.

## Validation-Friendly Shape

- Fixture: modern shape present.

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [tiinex.continuation.v1.schema.md](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
  - Value: PLACEHOLDER`);
  const result = validateTraceableTopicSchemaSync({
    filePath: artifactPath,
    readTextFileSync: () => markdown
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "topic-schema-artifact-creation-contract-star-bullets-present"),
    "A malformed topic Artifact Creation Contract should surface the topic-validator star-bullet finding."
  );
}

function testTopicSchemaValidatorRequiresArtifactCreationGroups() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.topic.v1.schema.md");
  const markdown = readFileSync(schemaPath, "utf8").replace(/### Template Body[\s\S]*?---/u, "---");
  const result = validateTraceableTopicSchemaSync({
    filePath: schemaPath,
    readTextFileSync: () => markdown
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "topic-schema-artifact-creation-contract-groups-missing" && finding.message.includes("Template Body")),
    "The topic validator should require the maintained Artifact Creation Contract groups to remain present."
  );
}

function testArtifactCreationContractRejectsPlusBullets() {
  const artifactPath = path.join(packageRoot, "..", "..", ".topics", ".schemas", ".test-temp", "artifact-creation-contract", "001-topic-schema-invalid.md");
  const markdown = finalizeContinuityIntegrity(`# Continuity Context

- Envelope Schema: [tiinex.continuation.v1](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
- Parent
  - Parent Schema: [tiinex.continuation.v1](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
  - Created At: 2026-06-04 00:00:00
  - Trace: [tiinex.continuation.v1.schema.md](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
- Current
  - Current Schema: [tiinex.topic.v1](../../docs/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Created At: 2026-06-04 00:00:01
  - Summary: Artifact creation contract invalid fixture.

---

# Topic Fixture

## Summary

Artifact creation contract invalid fixture.

## Schema Validation Contract

### Topic Scope

Applies To

- artifacts whose Current Schema is tiinex.topic.v1

Rules

- This fixture only exists to exercise artifact creation contract validation.

## Artifact Creation Contract

### Prompt Fields

Required Fields

+ version

Rules

- This fixture intentionally breaks the list marker shape.

## Validation-Friendly Shape

- Fixture: modern shape present.

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [tiinex.continuation.v1.schema.md](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
  - Value: PLACEHOLDER`);
  const result = validateTraceableTopicSchemaSync({
    filePath: artifactPath,
    readTextFileSync: () => markdown
  });

  assert.ok(
    result.findings.some((finding) => finding.code === "topic-schema-artifact-creation-contract-plus-bullets-present"),
    "A malformed topic Artifact Creation Contract should surface the topic-validator plus-bullet finding."
  );
}

function testParseContinuityHeaderMetadataFields() {
  const parsed = parseTraceableContinuityMarkdown(`# Continuity Context

- Envelope Schema: [tiinex.continuation.v1](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
- Parent
  - Parent Schema: [tiinex.topic.v1](../../docs/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Created At: 2026-06-03 03:10:00
  - Trace: [001-parent.trace.md](001-parent.trace.md)
  - Origin:
    - [relative](001-parent.trace.md)
- Current
  - Current Schema: [tiinex.task.v1](../../docs/.topics/.schemas/tiinex.task.v1.schema.md)
  - Created At: 2026-06-03 03:10:05
  - Why: Freeze the next validator-facing continuity slice.
  - Summary: Header metadata fixture.

---

# Header Metadata Fixture

## Summary

- Fixture: header-metadata

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [tiinex.task.v1.schema.md](../../docs/.topics/.schemas/tiinex.task.v1.schema.md)
  - Value: PLACEHOLDER`);

  assert.equal(parsed.parentCreatedAt, "2026-06-03 03:10:00", "Continuity parser should recover Parent Created At from the continuity header.");
  assert.equal(parsed.currentCreatedAt, "2026-06-03 03:10:05", "Continuity parser should recover Current Created At from the continuity header.");
  assert.equal(parsed.currentWhy, "Freeze the next validator-facing continuity slice.", "Continuity parser should recover Why from the continuity header.");
  assert.equal(parsed.currentSummary, "Header metadata fixture.", "Continuity parser should recover Summary from the continuity header.");
}

function testRenderContinuityValidationMarkdown() {
  const schemaPath = path.join(packageRoot, "..", "..", ".topics", ".schemas", "tiinex.runtime.trace.v1.schema.md");
  const result = validateTraceableContinuityArtifactChainSync({
    filePath: schemaPath,
    maxDepth: 2
  });
  const rendered = renderTraceableContinuityValidationMarkdown(result);
  assert.ok(rendered.includes("# Traceable Continuity Validation"), "Continuity validation report should include the validation heading.");
  assert.ok(rendered.includes("- Continuity Integrity: verified"), "Continuity validation report should surface verified footer status.");
  assert.ok(rendered.includes("- Current Schema: tiinex.runtime.trace.v1"), "Continuity validation report should show the current schema label.");
  assert.ok(rendered.includes("- Parent Created At: 2026-05-29 23:21:06"), "Continuity validation report should show the parsed parent Created At value.");
  assert.ok(rendered.includes("- Current Created At: 2026-05-28 19:01:45"), "Continuity validation report should show the parsed current Created At value.");
}

function testContinuityValidationProducesNormalizedFindings() {
  const tempRoot = path.join(packageRoot, ".test-temp", "continuity-findings");
  const artifactPath = path.join(tempRoot, "001-mismatch.trace.md");
  const markdown = `# Continuity Context

- Envelope Schema: [tiinex.continuation.v1](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
- Current
  - Current Schema: [tiinex.topic.v1](../../docs/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Created At: 2026-05-30 00:00:00
  - Summary: Mismatch fixture.

---

# Mismatch Fixture

This body intentionally does not match the stored footer checksum.

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [tiinex.topic.v1.schema.md](../../docs/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Value: definitely-not-the-real-checksum`;
  const result = validateTraceableContinuityArtifactChainSync({
    filePath: artifactPath,
    readTextFileSync: () => markdown,
    maxDepth: 1
  });

  assert.ok(result.findings.some((finding) => finding.code === "continuity-checksum-mismatch"), "Continuity validator should expose a normalized mismatch finding from the core validator surface.");
  assert.ok(result.findings.some((finding) => finding.surfaces.includes("problems")), "Normalized continuity findings should declare whether they belong on Problems surfaces.");
}

function testSchemaDefinitionRootSelfValidates() {
  const schemaPath = path.join(packageRoot, "..", "..", "..", "docs", ".topics", ".schemas", "tiinex.definition.v1.schema.md");
  const result = validateTraceableContinuityArtifactChainSync({
    filePath: schemaPath,
    maxDepth: 2
  });

  assert.equal(result.findings.length, 0, "The shared schema-definition root should self-validate without findings.");
  assert.equal(result.stoppedBecause, "complete", "The shared schema-definition root should stop cleanly at its canonical self-rooting anchor.");
}

function testSchemaNoteCoreContractFindingForBaseSchemaNote() {
  const artifactPath = path.join(packageRoot, "..", "..", ".topics", ".schemas", ".test-temp", "schema-core-contract", "001-base-schema-note.md");
  const markdown = finalizeContinuityIntegrity(`# Continuity Context

- Envelope Schema: [tiinex.continuation.v1](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
- Current
  - Current Schema: [tiinex.definition.v1](../../docs/.topics/.schemas/tiinex.definition.v1.schema.md)
  - Created At: 2026-06-02 00:00:00
  - Summary: Base schema-note fixture.

---

# Base Schema Note Fixture

## Summary

- Fixture: base schema note

## Required Structure

- Fixture: includes a normal contract-bearing section so only the root machine contract rule is under test

## Validation-Friendly Shape

- Fixture: intentionally missing a contract-bearing section

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [tiinex.definition.v1.schema.md](../../docs/.topics/.schemas/tiinex.definition.v1.schema.md)
  - Value: PLACEHOLDER`);
  const result = validateTraceableContinuityArtifactChainSync({
    filePath: artifactPath,
    readTextFileSync: () => markdown,
    maxDepth: 1
  });

  assert.ok(result.findings.some((finding) => finding.code === "schema-machine-validation-contract-missing"), "Schema-note validation should surface the missing root machine validation contract for tiinex.definition.v1.");
  assert.equal(result.findings.length, 1, "Only the root machine-validation-contract issue should be surfaced for this schema-root fixture.");
}

function testSchemaNoteCoreContractFindingForSubSchemaNote() {
  const artifactPath = path.join(packageRoot, "..", "..", ".topics", ".schemas", ".test-temp", "schema-core-contract", "001-sub-schema-note.md");
  const markdown = finalizeContinuityIntegrity(`# Continuity Context

- Envelope Schema: [tiinex.continuation.v1](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
- Current
  - Current Schema: [tiinex.evidence.v1](../../docs/.topics/.schemas/tiinex.evidence.v1.schema.md)
  - Created At: 2026-06-02 00:00:00
  - Summary: Sub-schema fixture.

---

# Sub Schema Note Fixture

## Summary

- Fixture: sub schema note

## Validation-Friendly Shape

- Fixture: intentionally missing a contract-bearing section

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [tiinex.evidence.v1.schema.md](../../docs/.topics/.schemas/tiinex.evidence.v1.schema.md)
  - Value: PLACEHOLDER`);
  const result = validateTraceableContinuityArtifactChainSync({
    filePath: artifactPath,
    readTextFileSync: () => markdown,
    maxDepth: 1
  });

  assert.ok(result.findings.some((finding) => finding.code === "schema-definition-core-contract-missing"), "Schema-note validation should surface a missing core contract section for a sub-schema note family.");
  assert.equal(result.findings.length, 1, "Only the core schema-note contract issue should be surfaced for this sub-schema fixture.");
}

function testValidatorPolicyKeepsLegacyNoChecksumInternal() {
  const tempRoot = path.join(packageRoot, ".test-temp", "continuity-legacy-no-checksum");
  const parentPath = path.join(tempRoot, "001-parent.trace.md");
  const childPath = path.join(tempRoot, "001-1-child.trace.md");
  const fileMap = new Map();

  const parentMarkdown = finalizeContinuityIntegrity(`# Continuity Context

- Envelope Schema: [tiinex.continuation.v1](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
- Current
  - Current Schema: [tiinex.topic.v1](../../docs/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Created At: 2026-05-30 00:00:00
  - Summary: Parent fixture.

---

# Parent Fixture

## Summary

- Fixture: parent

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [tiinex.topic.v1.schema.md](../../docs/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Value: PLACEHOLDER`);
  fileMap.set(path.resolve(parentPath), parentMarkdown);

  const childMarkdown = finalizeContinuityIntegrity(`# Continuity Context

- Envelope Schema: [tiinex.continuation.v1](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
- Parent
  - Parent Schema: [tiinex.topic.v1](../../docs/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Created At: 2026-05-30 00:00:00
  - Trace: [001-parent.trace.md](001-parent.trace.md)
  - Origin:
    - [relative](001-parent.trace.md)
- Current
  - Current Schema: [tiinex.topic.v1](../../docs/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Created At: 2026-05-30 00:00:01
  - Summary: Child fixture.

## Traceable State

\`\`\`json
{
  "schema": "tiinex.traceable-state.v1",
  "result": {
    "parentTracePath": "001-parent.trace.md",
    "lineageLabel": "001-1",
    "lineageDepth": 2
  }
}
\`\`\`

---

# Child Fixture

## Summary

- Fixture: child

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [tiinex.topic.v1.schema.md](../../docs/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Value: PLACEHOLDER`);
  fileMap.set(path.resolve(childPath), childMarkdown);

  const result = validateTraceableContinuityArtifactChainSync({
    filePath: childPath,
    readTextFileSync: (filePath) => {
      const markdown = fileMap.get(path.resolve(filePath));
      if (!markdown) {
        throw new Error(`Missing test fixture ${filePath}`);
      }
      return markdown;
    }
  });

  assert.equal(result.nodes[0].traceableParentIntegrity?.status, "legacy-no-checksum", "Missing direct-parent checksum should remain an internal legacy status, not a surfaced Problems finding.");
  assert.equal(excludeSchemaTargetReadabilityFindings(result.findings).length, 0, "Legacy no-checksum cases should not produce a Problems finding under the current policy outside the dedicated schema-target readability checks.");
}

function testValidatorPolicyKeepsUnsupportedFooterMethodsOutOfProblems() {
  const tempRoot = path.join(packageRoot, ".test-temp", "continuity-unsupported-method");
  const artifactPath = path.join(tempRoot, "001-unsupported.trace.md");
  const markdown = `# Continuity Context

- Envelope Schema: [tiinex.continuation.v1](../../docs/.topics/.schemas/tiinex.continuation.v1.schema.md)
- Current
  - Current Schema: [tiinex.topic.v1](../../docs/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Created At: 2026-05-30 00:00:00
  - Summary: Unsupported method fixture.

---

# Unsupported Method Fixture

## Summary

- Fixture: unsupported-method

---

# Continuity Integrity

- sha1-base64url-c14n-v1
  - Towards: [tiinex.topic.v1.schema.md](../../docs/.topics/.schemas/tiinex.topic.v1.schema.md)
  - Value: not-used-by-the-current-checker`;
  const result = validateTraceableContinuityArtifactChainSync({
    filePath: artifactPath,
    readTextFileSync: () => markdown,
    maxDepth: 1
  });

  assert.equal(result.nodes[0].continuityIntegrity.status, "unsupported-method", "Unsupported continuity footer methods should remain explicitly classified in the validator result.");
  assert.equal(excludeSchemaTargetReadabilityFindings(result.findings).length, 0, "Unsupported footer methods should not invent a Problems finding under the current policy outside the dedicated schema-target readability checks.");
}

async function main() {
  testStandaloneMoveRetainedDescendantRewrites();
  testContinuityValidationCoreWithLocalFixtureChain();
  testValidatorFindsParentSchemaMismatch();
  testValidatorFindsUnpinnedBrowseGitParentOrigin();
  testValidatorFindsMissingValidationFriendlyShape();
  testValidatorFindsInvalidContinuityHeaderTimestamps();
  testValidatorFindsMissingContinuityHeaderFields();
  testValidatorFindsMissingTaskStructure();
  testValidatorAcceptsTabIndentedCurrentContinuityFields();
  testValidatorFindsUnreadableOrdinaryTraceSchemaTargets();
  testValidatorFindsUnresolvableGitHubSchemaPermalinks();
  testValidatorFindsMissingContinuityIntegrityFooter();
  testValidatorFindsMissingTopicStructure();
  testValidatorFindsUnreadableParentTraceTarget();
  testValidatorFindsUnreadableCurrentOriginAndFooterPermalinks();
  testTaskSchemaNoteDoesNotTriggerTaskArtifactRule();
  testCurrentValidatorTaskLeafSatisfiesTaskStructureRule();
  testRuntimeTraceStructureValidationAgainstTransferFixture();
  testParseCurrentRuntimeSchemaContinuity();
  testRootSchemaValidationContractSelfValidates();
  testRootSchemaValidatorRequiresRootEnvelopeSchema();
  testRootSchemaValidatorRequiresReadableEnvelopeSchemaTarget();
  testRootSchemaValidatorRequiresReadableCurrentSchemaTarget();
  testRootSchemaValidationContractRejectsStarBullets();
  testRootSchemaValidationContractRejectsPlusBullets();
  testRootSchemaValidationContractRequiresCategoryLists();
  testRootSchemaValidationContractRequiresPolicyGroups();
  testRootSchemaValidationContractRejectsUnexpectedCategoryLabels();
  testRootSchemaValidationContractRejectsDuplicateNamedDeclarations();
  testRootSchemaValidatorWarnsUnexpectedEnvelopeFields();
  testRootSchemaValidatorUsesRootDeclaredEnvelopeFieldLists();
  testModernSchemaNoteValidationContractCountsAsCoreContract();
  testModernSchemaNoteValidationContractRejectsStarBullets();
  testPortedTopicSchemaSelfValidatesWhenChecksumIsRefreshed();
  testSubschemaValidatorAcceptsRotatedChecksum();
  testDecisionSchemaValidatorAcceptsCommittedSchema();
  testTaskSchemaValidatorAcceptsCommittedSchema();
  testEvidenceSchemaValidatorAcceptsCommittedSchema();
  testPointerSchemaValidatorAcceptsCommittedSchema();
  testTopicSchemaValidatorRequiresRootEnvelopeSchema();
  testTopicSchemaValidatorRequiresReadableEnvelopeSchemaTarget();
  testTopicSchemaValidatorRequiresReadableParentSchemaTarget();
  testTopicSchemaValidatorRequiresReadableCurrentSchemaTarget();
  testTopicSchemaValidatorRequiresParentOriginWhenParentExists();
  testTopicSchemaValidatorRequiresParentOriginBrowseGitPermalink();
  testTopicSchemaValidatorRequiresCommitPinnedParentOriginBrowseGitPermalink();
  testTopicSchemaValidatorRejectsInvalidParentCreatedAtValue();
  testTopicSchemaValidatorRequiresParentCreatedAtWhenParentExists();
  testTopicSchemaValidatorRequiresParentCreatedAtToMatchParentArtifact();
  testTopicSchemaValidatorRequiresFooterTargetPermalink();
  testTopicSchemaValidatorRequiresFooterTargetToMatchParentOriginPermalink();
  testTopicSchemaValidatorUsesFooterTargetArtifactForChecksumVerification();
  testTopicSchemaValidatorRejectsUnexpectedSectionHeading();
  testTopicSchemaValidatorRejectsUnexpectedContractVocabulary();
  testTopicSchemaValidatorWarnsUnexpectedVocabularyWhenLineageIsUnavailable();
  testTopicSchemaValidatorAllowsDeclaredContractCategoryExtensions();
  testTopicSchemaValidatorRejectsRedeclaredInheritedContractCategoryExtensions();
  testTopicSchemaValidatorAllowsRedeclaredInheritedContractCategoryExtensionsWithExplicitOverride();
  testTopicSchemaValidatorPreservesUnknownEnvelopeFieldsWhenLineageIsUnavailable();
  testTopicSchemaValidatorWarnsUnexpectedEnvelopeFieldsWhenLineageIsAvailable();
  testTopicSchemaValidatorUsesRootDeclaredEnvelopeFieldLists();
  testTopicSchemaValidatorRejectsDuplicateCategoryLabels();
  testTopicSchemaValidatorRequiresMaintainedValidationGroups();
  testTopicSchemaValidatorFlagsOutOfOrderSections();
  testArtifactCreationContractRejectsStarBullets();
  testArtifactCreationContractRejectsPlusBullets();
  testTopicSchemaValidatorRequiresArtifactCreationGroups();
  testParseContinuityHeaderMetadataFields();
  testRenderContinuityValidationMarkdown();
  testContinuityValidationProducesNormalizedFindings();
  testValidatorPolicyKeepsLegacyNoChecksumInternal();
  testValidatorPolicyKeepsUnsupportedFooterMethodsOutOfProblems();
  runSchemaCompatibilityFixtures(packageRoot);

  const workspaceFolders = [
    { name: "ai-provenance", fsPath: path.win32.normalize("C:/Users/micro/Documents/Repos/Tiinex/ai-provenance") },
    { name: "ai", fsPath: path.win32.normalize("C:/Users/micro/Documents/Repos/Tiinex/ai") },
    { name: "youtube", fsPath: path.win32.normalize("C:/Users/micro/Documents/Repos/Tiinex/youtube") }
  ];
  const existingPaths = new Set([
    path.win32.normalize("C:/Users/micro/Documents/Repos/Tiinex/ai-provenance/.topics"),
    path.win32.normalize("C:/Users/micro/Documents/Repos/Tiinex/ai"),
    path.win32.normalize("C:/Users/micro/Documents")
  ]);
  const pathExists = async (filePath) => existingPaths.has(path.win32.normalize(filePath));

  assert.equal(
    await resolveRelativeOpenPathInWorkspace(".topics", workspaceFolders, pathExists),
    path.win32.normalize("C:/Users/micro/Documents/Repos/Tiinex/ai-provenance/.topics"),
    "Relative open paths should resolve inside the current workspace folder when that target exists."
  );
  assert.equal(
    await resolveRelativeOpenPathInWorkspace("ai", workspaceFolders, pathExists),
    path.win32.normalize("C:/Users/micro/Documents/Repos/Tiinex/ai"),
    "Relative open paths that name another workspace root should resolve to that root in a multi-root workspace."
  );
  assert.equal(
    await resolveDriveLessAbsolutePathOnWindows("/Users/micro/Documents", workspaceFolders, "C:", pathExists, "win32"),
    path.win32.normalize("C:/Users/micro/Documents"),
    "Drive-less absolute Windows paths should recover to an existing drive-rooted path."
  );
  assert.equal(
    getUniqueWorkspaceFolderMatchByName("ai", workspaceFolders),
    path.win32.normalize("C:/Users/micro/Documents/Repos/Tiinex/ai"),
    "Workspace-root fallback should uniquely match repo names in a multi-root workspace."
  );
  assert.equal(
    isPathWithinAnyWorkspaceRoot(path.win32.normalize("C:/Users/micro/Documents/Repos/Tiinex/ai-provenance/.topics"), workspaceFolders),
    true,
    "Paths inside any workspace root should be recognized as workspace-contained targets."
  );
  assert.equal(
    isPathWithinAnyWorkspaceRoot(path.win32.normalize("C:/Users/micro/Documents"), workspaceFolders),
    false,
    "Paths outside all workspace roots should be recognized as external targets."
  );

  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const configurationProperties = getContributedConfigurationProperties(packageJson);
  const configurationEntries = Array.isArray(packageJson.contributes?.configuration)
    ? packageJson.contributes.configuration
    : packageJson.contributes?.configuration ? [packageJson.contributes.configuration] : [];
  assert.equal(packageJson.name, "ai-provenance", "Unexpected extension package name.");
  assert.equal(packageJson.publisher, "tiinex", "Unexpected publisher.");
  assert.equal(packageJson.icon, "assets/logo-transparent.png", "Provenance extension icon path is missing or stale.");
  assert.ok(packageJson.activationEvents?.includes("onStartupFinished"), "onStartupFinished activation is missing.");
  assert.ok(packageJson.activationEvents?.includes("onLanguageModelTool:list_traceable_agents"), "Provenance traceable agent catalog activation is missing.");
  assert.ok(packageJson.activationEvents?.includes("onLanguageModelTool:list_traceable_models"), "Provenance traceable model catalog activation is missing.");
  assert.ok(packageJson.activationEvents?.includes("onLanguageModelTool:show_traceable_traces"), "Provenance showTraces LM tool activation is missing.");
  assert.ok(packageJson.activationEvents?.includes("onLanguageModelTool:view_traceable_subagent"), "Provenance LM tool activation is missing.");
  assert.ok(packageJson.activationEvents?.includes("onLanguageModelTool:run_traceable_subagent"), "Provenance runtime LM tool activation is missing.");
  assert.ok(packageJson.activationEvents?.includes("onLanguageModelTool:transfer_trace"), "Provenance transfer LM tool activation is missing.");
  assert.ok(packageJson.activationEvents?.includes("onLanguageModelTool:validate_traceable_continuity"), "Provenance continuity validation LM tool activation is missing.");
  assert.ok(packageJson.contributes?.languageModelTools?.some((entry) => entry.name === "list_traceable_agents"), "Provenance traceable agent catalog contribution is missing.");
  assert.ok(packageJson.contributes?.languageModelTools?.some((entry) => entry.name === "list_traceable_models"), "Provenance traceable model catalog contribution is missing.");
  assert.ok(packageJson.contributes?.languageModelTools?.some((entry) => entry.name === "show_traceable_traces"), "Provenance showTraces LM tool contribution is missing.");
  assert.ok(packageJson.contributes?.languageModelTools?.some((entry) => entry.name === "run_traceable_subagent"), "Provenance runtime LM tool contribution is missing.");
  assert.ok(packageJson.contributes?.languageModelTools?.some((entry) => entry.name === "view_traceable_subagent"), "Provenance LM tool contribution is missing.");
  assert.ok(packageJson.contributes?.languageModelTools?.some((entry) => entry.name === "transfer_trace"), "Provenance transfer LM tool contribution is missing.");
  assert.ok(packageJson.contributes?.languageModelTools?.some((entry) => entry.name === "validate_traceable_continuity"), "Provenance continuity validation LM tool contribution is missing.");
  const runTraceableTool = packageJson.contributes?.languageModelTools?.find((entry) => entry.name === "run_traceable_subagent");
  const showTracesTool = packageJson.contributes?.languageModelTools?.find((entry) => entry.name === "show_traceable_traces");
  assert.equal(showTracesTool?.toolReferenceName, "showTraces", "show_traceable_traces should expose the public tool reference name showTraces.");
  assert.ok(showTracesTool?.inputSchema?.properties?.targetPath, "show_traceable_traces is missing the public targetPath input property.");
  assert.ok(showTracesTool?.inputSchema?.properties?.detailLevel?.enum?.includes("compact"), "show_traceable_traces is missing the compact detailLevel variant.");
  assert.ok(showTracesTool?.inputSchema?.properties?.detailLevel?.enum?.includes("full"), "show_traceable_traces is missing the full detailLevel variant.");
  assert.ok(showTracesTool?.inputSchema?.properties?.maxItems, "show_traceable_traces is missing the public maxItems input property.");
  assert.ok(showTracesTool?.inputSchema?.properties?.offset, "show_traceable_traces is missing the public offset input property.");
  assert.ok(showTracesTool?.inputSchema?.properties?.includeSchemas, "show_traceable_traces is missing the public includeSchemas input property.");
  assert.ok(showTracesTool?.modelDescription?.includes("detailLevel"), "show_traceable_traces should describe detailLevel guidance in the public tool description.");
  assert.ok(showTracesTool?.modelDescription?.includes("parent, sibling, child"), "show_traceable_traces should describe the target-trace structure view in the public tool description.");
  assert.ok(runTraceableTool?.inputSchema?.properties?.parentTracePath, "run_traceable_subagent is missing the public parentTracePath continuation input schema property.");
  assert.ok(runTraceableTool?.inputSchema?.properties?.parentRoles, "run_traceable_subagent is missing the public parentRoles input schema property.");
  assert.equal(runTraceableTool?.inputSchema?.properties?.parentRoles?.oneOf?.[0]?.type, "string", "run_traceable_subagent parentRoles should accept a single exact display name string.");
  assert.equal(runTraceableTool?.inputSchema?.properties?.parentRoles?.oneOf?.[1]?.type, "array", "run_traceable_subagent parentRoles should accept an array of exact display name strings.");
  assert.ok(runTraceableTool?.inputSchema?.properties?.exportToFolder, "run_traceable_subagent is missing the public exportToFolder input schema property.");
  assert.ok(runTraceableTool?.inputSchema?.properties?.outputMode, "run_traceable_subagent is missing the public outputMode input schema property.");
  assert.ok(runTraceableTool?.inputSchema?.properties?.inputMode, "run_traceable_subagent is missing the public inputMode input schema property.");
  assert.ok(runTraceableTool?.inputSchema?.properties?.validationMode, "run_traceable_subagent is missing the public validationMode input schema property.");
  assert.ok(runTraceableTool?.inputSchema?.properties?.reveal, "run_traceable_subagent is missing the public reveal input schema property.");
  assert.ok(runTraceableTool?.inputSchema?.properties?.inputMode?.enum?.includes("DIRECT"), "run_traceable_subagent is missing the public DIRECT inputMode variant.");
  assert.ok(runTraceableTool?.inputSchema?.properties?.inputMode?.enum?.includes("RESUME"), "run_traceable_subagent is missing the public RESUME inputMode variant.");
  assert.deepEqual(runTraceableTool?.inputSchema?.required ?? [], [], "run_traceable_subagent should not hard-require userInput and parentTask for every inputMode.");
  assert.ok(packageJson.contributes?.languageModelTools?.find((entry) => entry.name === "run_traceable_subagent")?.modelDescription?.includes("Canonical usage:"), "run_traceable_subagent is missing canonical usage guidance in the public tool description.");
  assert.ok(packageJson.contributes?.languageModelTools?.find((entry) => entry.name === "run_traceable_subagent")?.modelDescription?.includes("artifact-backed continuation"), "run_traceable_subagent is missing truthful continuation guidance in the public tool description.");
  assert.equal(runTraceableTool?.toolReferenceName, "runTrace", "run_traceable_subagent should expose the shorter public tool reference name runTrace.");
  assert.ok(packageJson.contributes?.languageModelTools?.find((entry) => entry.name === "list_traceable_models")?.modelDescription?.includes("sendableOnly: true"), "list_traceable_models is missing exact preflight guidance in the public tool description.");
  assert.ok(packageJson.contributes?.languageModelTools?.find((entry) => entry.name === "view_traceable_subagent")?.modelDescription?.includes("Prefer this over rerunning the same child lane"), "view_traceable_subagent is missing inspect-before-rerun guidance in the public tool description.");
  const viewTraceableTool = packageJson.contributes?.languageModelTools?.find((entry) => entry.name === "view_traceable_subagent");
  assert.ok(viewTraceableTool?.inputSchema?.properties?.surface?.enum?.includes("runtime-decision"), "view_traceable_subagent is missing the public runtime-decision surface enum value.");
  assert.ok(viewTraceableTool?.inputSchema?.properties?.surface?.enum?.includes("conversation-brief"), "view_traceable_subagent is missing the public conversation-brief surface enum value.");
  assert.ok(viewTraceableTool?.inputSchema?.properties?.surface?.enum?.includes("evidence-basis"), "view_traceable_subagent is missing the public evidence-basis surface enum value.");
  assert.ok(viewTraceableTool?.inputSchema?.properties?.surface?.enum?.includes("request-contract"), "view_traceable_subagent is missing the public request-contract surface enum value.");
  assert.ok(viewTraceableTool?.inputSchema?.properties?.surface?.enum?.includes("timeline"), "view_traceable_subagent is missing the public timeline surface enum value.");
  assert.ok(viewTraceableTool?.inputSchema?.properties?.surface?.enum?.includes("carry-handoff"), "view_traceable_subagent is missing the public carry-handoff surface enum value.");
  assert.ok(viewTraceableTool?.inputSchema?.properties?.surface?.enum?.includes("latest-role-state"), "view_traceable_subagent is missing the public latest-role-state surface enum value.");
  assert.ok(viewTraceableTool?.inputSchema?.properties?.surface?.enum?.includes("latest-carry-package"), "view_traceable_subagent is missing the public latest-carry-package surface enum value.");
  assert.ok(viewTraceableTool?.inputSchema?.properties?.surface?.enum?.includes("tool-forensics"), "view_traceable_subagent is missing the public tool-forensics surface enum value.");
  assert.ok(viewTraceableTool?.inputSchema?.properties?.surface?.enum?.includes("lineage"), "view_traceable_subagent is missing the public lineage surface enum value.");
  assert.ok(viewTraceableTool?.inputSchema?.properties?.roleName, "view_traceable_subagent is missing the public roleName input property for latest-role-state lookups.");
  assert.ok(viewTraceableTool?.inputSchema?.properties?.senderId, "view_traceable_subagent is missing the public senderId input property for latest-role-state lookups.");
  assert.ok(viewTraceableTool?.modelDescription?.includes("runtime-decision"), "view_traceable_subagent model description is missing runtime-decision guidance.");
  assert.ok(viewTraceableTool?.modelDescription?.includes("conversation brief"), "view_traceable_subagent model description is missing conversation-brief guidance.");
  assert.ok(viewTraceableTool?.modelDescription?.includes("evidence-basis"), "view_traceable_subagent model description is missing evidence-basis guidance.");
  assert.equal(configurationProperties["tiinex.aiProvenance.traceableFilenameTopLevelIndexDigits"]?.default, 3, "TRACEABLE top-level filename digit-width setting should default to 3.");
  assert.equal(configurationProperties["tiinex.aiProvenance.traceableFilenameTopLevelIndexDigits"]?.minimum, 1, "TRACEABLE top-level filename digit-width setting should allow single-digit filenames.");
  assert.equal(configurationProperties["tiinex.aiProvenance.traceableFilenameTopLevelIndexDigits"]?.maximum, 6, "TRACEABLE top-level filename digit-width setting should keep a bounded width.");
  assert.equal(configurationProperties["tiinex.aiProvenance.traceableFilenameSubIndexDigits"]?.default, 1, "TRACEABLE sub-index filename digit-width setting should default to 1.");
  assert.equal(configurationProperties["tiinex.aiProvenance.traceableFilenameSubIndexDigits"]?.minimum, 1, "TRACEABLE sub-index filename digit-width setting should allow single-digit filenames.");
  assert.equal(configurationProperties["tiinex.aiProvenance.traceableFilenameSubIndexDigits"]?.maximum, 6, "TRACEABLE sub-index filename digit-width setting should keep a bounded width.");
  assert.equal(configurationProperties["tiinex.aiProvenance.traceableRemoveZeroPaddingFromFilename"]?.default, false, "TRACEABLE zero-padding removal should default to disabled.");
  assert.equal(configurationProperties["tiinex.aiProvenance.traceableRemoveModelOrRoleFromFilename"]?.default, false, "TRACEABLE role/model slug removal should default to disabled.");
  assert.match(configurationProperties["tiinex.aiProvenance.traceableRemoveModelOrRoleFromFilename"]?.description ?? "", /lineage indexes only/i, "TRACEABLE role/model slug removal setting should explain the index-only filename outcome.");
  assert.ok(viewTraceableTool?.modelDescription?.includes("request-contract"), "view_traceable_subagent model description is missing request-contract guidance.");
  assert.ok(viewTraceableTool?.modelDescription?.includes("timeline"), "view_traceable_subagent model description is missing timeline guidance.");
  assert.ok(viewTraceableTool?.modelDescription?.includes("carry-handoff"), "view_traceable_subagent model description is missing carry-handoff guidance.");
  assert.ok(viewTraceableTool?.modelDescription?.includes("latest-role-state"), "view_traceable_subagent model description is missing latest-role-state guidance.");
  assert.ok(viewTraceableTool?.modelDescription?.includes("latest-carry-package"), "view_traceable_subagent model description is missing latest-carry-package guidance.");
  assert.ok(viewTraceableTool?.modelDescription?.includes("tool-forensics"), "view_traceable_subagent model description is missing tool-forensics guidance.");
  assert.ok(viewTraceableTool?.modelDescription?.includes("lineage"), "view_traceable_subagent model description is missing lineage guidance.");
  assert.equal(viewTraceableTool?.toolReferenceName, "viewTrace", "view_traceable_subagent should expose the shorter public tool reference name viewTrace.");
  const validateTraceTool = packageJson.contributes?.languageModelTools?.find((entry) => entry.name === "validate_traceable_continuity");
  assert.equal(validateTraceTool?.toolReferenceName, "validateTrace", "validate_traceable_continuity should expose the public tool reference name validateTrace.");
  assert.ok(validateTraceTool?.inputSchema?.properties?.filePath, "validate_traceable_continuity is missing the public filePath input property.");
  assert.ok(validateTraceTool?.inputSchema?.properties?.maxDepth, "validate_traceable_continuity is missing the public maxDepth input property.");
  assert.ok(validateTraceTool?.modelDescription?.includes("parent links"), "validate_traceable_continuity is missing backward parent-link guidance in the public tool description.");
  assert.ok(validateTraceTool?.modelDescription?.includes("high-confidence proof"), "validate_traceable_continuity should describe the proof-oriented validation intent.");
  const transferTraceTool = packageJson.contributes?.languageModelTools?.find((entry) => entry.name === "transfer_trace");
  assert.equal(transferTraceTool?.toolReferenceName, "transferTrace", "transfer_trace should expose the public tool reference name transferTrace.");
  assert.ok(transferTraceTool?.inputSchema?.properties?.operation?.enum?.includes("move"), "transfer_trace is missing the public move operation.");
  assert.ok(transferTraceTool?.inputSchema?.properties?.operation?.enum?.includes("copy"), "transfer_trace is missing the public copy operation.");
  assert.ok(transferTraceTool?.inputSchema?.properties?.action?.enum?.includes("alone"), "transfer_trace is missing the public alone action.");
  assert.ok(transferTraceTool?.inputSchema?.properties?.action?.enum?.includes("lineage"), "transfer_trace is missing the public lineage action.");
  assert.ok(transferTraceTool?.inputSchema?.properties?.lineageScope?.enum?.includes("tree"), "transfer_trace is missing the public tree lineage scope.");
  assert.ok(transferTraceTool?.inputSchema?.properties?.lineageScope?.enum?.includes("tree-plus-seeds"), "transfer_trace is missing the public tree-plus-seeds lineage scope.");
  assert.ok(configurationEntries.length >= 4, "Provenance settings should be split into grouped configuration sections instead of one flat block.");
  assert.ok(configurationEntries.some((entry) => entry?.title === "Tiinex Traceable Provenance" && entry?.id === "tiinex.aiProvenance" && entry?.order === 1), "Default provenance settings category should use the extension display name and lead the grouped settings order.");
  assert.ok(configurationEntries.some((entry) => entry?.title === "Traceable Chat" && entry?.id === "tiinex.aiProvenance.chat" && entry?.order === 2), "Traceable chat settings section is missing or unordered.");
  assert.ok(configurationEntries.some((entry) => entry?.title === "Traceable Models" && entry?.id === "tiinex.aiProvenance.models" && entry?.order === 3), "Traceable models settings section is missing or unordered.");
  assert.ok(configurationEntries.some((entry) => entry?.title === "Evidence Output" && entry?.id === "tiinex.aiProvenance.evidence" && entry?.order === 4), "Traceable evidence settings section is missing or unordered.");
  assert.ok(configurationProperties?.["tiinex.aiProvenance.evidenceMaxItems"], "Provenance namespaced settings are missing.");
  assert.ok(configurationProperties?.["tiinex.aiProvenance.defaultView"], "TRACEABLE default view setting is missing.");
  assert.ok(configurationProperties?.["tiinex.aiProvenance.defaultNewTraceableChatExportTo"], "Default New Traceable Chat export-folder setting is missing.");
  assert.ok(configurationProperties?.["tiinex.aiProvenance.traceableDefaultMoveAction"], "TRACEABLE default move-action setting is missing.");
  assert.ok(configurationProperties?.["tiinex.aiProvenance.traceableDefaultCopyAction"], "TRACEABLE default copy-action setting is missing.");
  assert.ok(configurationProperties?.["tiinex.aiProvenance.traceableDisableMoveCopyLogic"], "TRACEABLE move/copy override setting is missing.");
  assert.ok(configurationProperties?.["tiinex.aiProvenance.traceableLineageChecksumEnabled"], "TRACEABLE lineage checksum setting is missing.");
  assert.ok(configurationProperties?.["tiinex.aiProvenance.traceableDefaultMultiSelectLineageScope"], "TRACEABLE default multi-select lineage scope setting is missing.");
  assert.equal(configurationProperties["tiinex.aiProvenance.traceableDefaultMoveAction"]?.default, "ask", "TRACEABLE default move action should default to ask.");
  assert.equal(configurationProperties["tiinex.aiProvenance.traceableDefaultCopyAction"]?.default, "ask", "TRACEABLE default copy action should default to ask.");
  assert.equal(configurationProperties["tiinex.aiProvenance.traceableDisableMoveCopyLogic"]?.default, false, "TRACEABLE move/copy override should default to false.");
  assert.equal(configurationProperties["tiinex.aiProvenance.traceableLineageChecksumEnabled"]?.default, true, "TRACEABLE lineage checksum support should default to enabled.");
  assert.equal(configurationProperties["tiinex.aiProvenance.traceableDefaultMultiSelectLineageScope"]?.default, "ask", "TRACEABLE default multi-select lineage scope should default to ask.");
  assert.ok(configurationProperties["tiinex.aiProvenance.traceableDefaultMoveAction"]?.enum?.includes("alone"), "TRACEABLE default move action should include alone.");
  assert.ok(configurationProperties["tiinex.aiProvenance.traceableDefaultMoveAction"]?.enum?.includes("lineage"), "TRACEABLE default move action should include lineage.");
  assert.ok(!configurationProperties["tiinex.aiProvenance.traceableDefaultMoveAction"]?.enum?.includes("unmodified"), "TRACEABLE default move action should not include unmodified.");
  assert.ok(!configurationProperties["tiinex.aiProvenance.traceableDefaultCopyAction"]?.enum?.includes("unmodified"), "TRACEABLE default copy action should not include unmodified.");
  assert.ok(configurationProperties["tiinex.aiProvenance.traceableDefaultMultiSelectLineageScope"]?.enum?.includes("leaves"), "TRACEABLE default multi-select lineage scope should include leaves.");
  assert.ok(configurationProperties["tiinex.aiProvenance.traceableDefaultMultiSelectLineageScope"]?.enum?.includes("branch"), "TRACEABLE default multi-select lineage scope should include branch.");
  assert.ok(configurationProperties["tiinex.aiProvenance.traceableDefaultCopyAction"]?.description?.includes("TRACEABLE copy flows"), "TRACEABLE default copy action should describe the copy decision surface.");
  assert.ok(configurationProperties?.["tiinex.aiProvenance.allRolesAvailableAsChatSender"], "TRACEABLE chat sender-role setting is missing.");
  assert.ok(configurationProperties?.["tiinex.aiProvenance.hideRolesWithSameBody"], "TRACEABLE same-body sender-role dedupe setting is missing.");
  assert.ok(configurationProperties?.["tiinex.aiProvenance.defaultChatSenderRole"], "TRACEABLE default chat sender-role setting is missing.");
  assert.ok(configurationProperties?.["tiinex.aiProvenance.quickSelectRole"], "TRACEABLE quick sender-role selection setting is missing.");
  assert.ok(configurationProperties?.["tiinex.aiProvenance.traceableAutoReveal"], "Provenance TRACEABLE auto-reveal setting is missing.");
  assert.ok(configurationProperties?.["tiinex.aiProvenance.traceableAutoHide"], "Provenance TRACEABLE auto-hide setting is missing.");
  assert.equal(configurationProperties["tiinex.aiProvenance.traceableRenameMoveRewriteBehavior"]?.default, "ask", "TRACEABLE rename/move rewrite setting should default to ask.");
  assert.ok(configurationProperties["tiinex.aiProvenance.traceableRenameMoveRewriteBehavior"]?.enum?.includes("always"), "TRACEABLE rename/move rewrite setting should include always.");
  assert.ok(configurationProperties["tiinex.aiProvenance.traceableRenameMoveRewriteBehavior"]?.enum?.includes("never"), "TRACEABLE rename/move rewrite setting should include never.");
  assert.ok(configurationProperties["tiinex.aiProvenance.traceableRenameMoveRewriteBehavior"]?.description?.includes("traceableDisableMoveCopyLogic"), "TRACEABLE legacy rename/move rewrite setting should point users to the move/copy override.");
  assert.ok(configurationProperties?.["tiinex.aiProvenance.traceablePreferredModels"], "Provenance TRACEABLE preferred-models setting is missing.");
  assert.ok(configurationProperties?.["tiinex.aiProvenance.traceableBlockedModels"], "Provenance TRACEABLE blocked-models setting is missing.");
  assert.ok(configurationProperties?.["tiinex.aiProvenance.traceableUndeclaredMaxIterations"], "Provenance TRACEABLE undeclared max-iterations setting is missing.");
  assert.ok(configurationProperties?.["tiinex.aiProvenance.traceableUndeclaredMaxToolCalls"], "Provenance TRACEABLE undeclared max-tool-calls setting is missing.");
  assert.equal(packageJson.scripts?.["test:sender-adaptation-probes"], "node scripts/check-sender-adaptation-probes.mjs", "Sender adaptation probe harness script is missing from package.json.");
  assert.ok(packageJson.contributes?.views?.tiinexAiProvenanceTraceablePanel?.some((entry) => entry.id === "tiinex.aiProvenance.traceableStatus"), "Provenance TRACEABLE panel view contribution is missing.");
  assert.ok(packageJson.contributes?.commands?.some((entry) => entry.command === "tiinex.aiProvenance.openOverview"), "Overview command is missing.");
  assert.ok(packageJson.contributes?.commands?.some((entry) => entry.command === "tiinex.aiProvenance.newTraceableChat"), "New Traceable Chat command is missing.");
  assert.ok(packageJson.contributes?.commands?.some((entry) => entry.command === "tiinex.aiProvenance.resumeTraceableChat"), "Resume Traceable Chat command is missing.");
  assert.ok(packageJson.contributes?.commands?.some((entry) => entry.command === "tiinex.aiProvenance.rewriteMoveTrace"), "Rewrite Move Trace command is missing.");
  assert.ok(packageJson.contributes?.commands?.some((entry) => entry.command === "tiinex.aiProvenance.rewriteCopyTrace"), "Rewrite Copy Trace command is missing.");
  assert.ok(packageJson.contributes?.commands?.some((entry) => entry.command === "tiinex.aiProvenance.returnToParentTrace"), "Return to Parent Trace command is missing.");
  assert.ok(packageJson.contributes?.commands?.some((entry) => entry.command === "tiinex.aiProvenance.repairTraceLineage"), "Repair Trace Lineage command is missing.");
  assert.ok(packageJson.contributes?.commands?.some((entry) => entry.command === "tiinex.aiProvenance.validateTraceableContinuity"), "Validate Traceable Continuity command is missing.");
  assert.ok(packageJson.contributes?.commands?.some((entry) => entry.command === "tiinex.aiProvenance.addFileToTraceableChat"), "Add File to Traceable Chat command is missing.");
  assert.ok(packageJson.contributes?.menus?.["explorer/context"]?.some((entry) => entry.command === "tiinex.aiProvenance.openTraceableEvidenceEditor" && entry.group === "navigation@32"), "Open Reconstructed Traceable View should be anchored in the built-in Explorer navigation group just after Open in Integrated Terminal.");
  assert.ok(packageJson.contributes?.menus?.["explorer/context"]?.some((entry) => entry.command === "tiinex.aiProvenance.rewriteCopyTrace" && entry.when === "resourceExtname == .md && resourcePath =~ /\\.trace\\.md$/"), "Copy Trace should appear in Explorer for .trace.md files.");
  assert.ok(packageJson.contributes?.menus?.["explorer/context"]?.some((entry) => entry.command === "tiinex.aiProvenance.validateTraceableContinuity" && entry.when === "resourceExtname == .md && resourcePath =~ /\\.trace\\.md$/"), "Validate Traceable Continuity should appear in Explorer for .trace.md files.");
  assert.ok(packageJson.contributes?.menus?.["explorer/context"]?.some((entry) => entry.command === "tiinex.aiProvenance.validateTraceableContinuity" && entry.when === "resourceExtname == .md && resourcePath =~ /\\/\\.topics\\/\\.schemas\\/.*\\.md$/"), "Validate Traceable Continuity should appear in Explorer for schema markdown files under .topics/.schemas.");
  assert.ok(packageJson.contributes?.menus?.["explorer/context"]?.some((entry) => entry.command === "tiinex.aiProvenance.inspectTraceableEvidence" && entry.when === "resourceExtname == .md && resourcePath =~ /\\.trace\\.md$/"), "Inspect TRACEABLE Evidence should appear in Explorer for .trace.md files.");
  assert.ok(packageJson.contributes?.menus?.["editor/title"]?.some((entry) => entry.command === "tiinex.aiProvenance.openTraceableEvidenceEditor" && entry.when === "resourceExtname == .md && resourcePath =~ /\\.trace\\.md$/ && (activeWebviewPanelId == markdown.preview || activeCustomEditorId == vscode.markdown.preview.editor)"), "Open Reconstructed Traceable View should stay hidden for non-.trace markdown previews in the editor title.");
  assert.ok(packageJson.contributes?.menus?.["editor/title"]?.some((entry) => entry.command === "tiinex.aiProvenance.validateTraceableContinuity" && entry.when === "resourceExtname == .md && resourcePath =~ /\\.trace\\.md$/"), "Validate Traceable Continuity should appear in the editor title for .trace.md files.");
  assert.ok(packageJson.contributes?.menus?.["editor/title"]?.some((entry) => entry.command === "tiinex.aiProvenance.validateTraceableContinuity" && entry.when === "resourceExtname == .md && resourcePath =~ /\\/\\.topics\\/\\.schemas\\/.*\\.md$/"), "Validate Traceable Continuity should appear in the editor title for schema markdown files under .topics/.schemas.");
  assert.ok(packageJson.contributes?.menus?.["editor/context"]?.some((entry) => entry.command === "tiinex.aiProvenance.validateTraceableContinuity" && entry.when === "resourceExtname == .md && resourcePath =~ /\\.trace\\.md$/"), "Validate Traceable Continuity should appear in the editor context menu for .trace.md files.");
  assert.ok(packageJson.contributes?.menus?.["editor/context"]?.some((entry) => entry.command === "tiinex.aiProvenance.inspectTraceableEvidence" && entry.when === "resourceExtname == .md && resourcePath =~ /\\.trace\\.md$/"), "Inspect TRACEABLE Evidence should appear in the editor context menu for .trace.md files.");
  assert.ok(packageJson.contributes?.menus?.["editor/context"]?.some((entry) => entry.command === "tiinex.aiProvenance.validateTraceableContinuity" && entry.when === "resourceExtname == .md && resourcePath =~ /\\/\\.topics\\/\\.schemas\\/.*\\.md$/"), "Validate Traceable Continuity should appear in the editor context menu for schema markdown files under .topics/.schemas.");
  assert.ok(packageJson.contributes?.menus?.["explorer/context"]?.some((entry) => entry.command === "tiinex.aiProvenance.returnToParentTrace" && entry.when === "resourceExtname == .md && resourcePath =~ /\\.trace\\.md$/ && resourcePath in tiinex.aiProvenance.returnToParentEligibleResources"), "Return to Parent Trace should only appear in Explorer when an ancestor parent actually leaves the current folder.");
  assert.ok(packageJson.contributes?.menus?.["explorer/context"]?.some((entry) => entry.command === "tiinex.aiProvenance.repairTraceLineage" && entry.when === "resourceExtname == .md && resourcePath =~ /\\.trace\\.md$/"), "Repair Trace Lineage should appear in Explorer for .trace.md files.");
  assert.ok(packageJson.contributes?.commands?.some((entry) => entry.command === "tiinex.aiProvenance.setDefaultNewTraceableChatExportFolder"), "Default New Traceable Chat export-folder command is missing.");
  assert.ok(packageJson.contributes?.commands?.some((entry) => entry.command === "tiinex.aiProvenance.inspectTraceableEvidence"), "TRACEABLE evidence inspect command is missing.");
  assert.ok(packageJson.contributes?.commands?.some((entry) => entry.command === "tiinex.aiProvenance.stopTraceableSubagent"), "TRACEABLE stop command is missing.");
  assert.ok(packageJson.contributes?.commands?.some((entry) => entry.command === "tiinex.aiProvenance.openTraceableEvidenceEditor"), "TRACEABLE evidence editor command is missing.");
  assert.ok(packageJson.contributes?.commands?.some((entry) => entry.command === "tiinex.aiProvenance.reopenTraceableEvidenceSource"), "TRACEABLE evidence reopen-source command is missing.");
  assert.ok(packageJson.contributes?.commands?.some((entry) => entry.command === "tiinex.aiProvenance.reopenTraceableEvidencePreview"), "TRACEABLE evidence reopen-preview command is missing.");
  assert.ok(!("mcp" in (packageJson.scripts ?? {})), "This scaffold should not expose an MCP script.");
  assert.ok(!Object.keys(packageJson.devDependencies ?? {}).includes("@modelcontextprotocol/sdk"), "This scaffold should not pull in MCP dependencies.");
  const extensionMoveSource = await readFile(path.join(packageRoot, "src", "extension.ts"), "utf8");
  const lineageIntegritySource = await readFile(path.join(packageRoot, "src", "traceableLineageIntegrity.ts"), "utf8");
  const evidenceSource = await readFile(path.join(packageRoot, "src", "traceableSubagentEvidence.ts"), "utf8");
  const checksumContractSource = await readFile(path.join(packageRoot, "src", "traceableContract.ts"), "utf8");
  assert.ok(extensionMoveSource.includes("prepareTraceableRewriteRequestedMove"), "TRACEABLE move handling should precompute requested alone-move plans before host rename completes.");
  assert.ok(extensionMoveSource.includes("planTraceableRewriteRequestedRename"), "TRACEABLE rename or move UX should reuse the precomputed requested-rename planner instead of improvising a post-rename rewrite path.");
  assert.ok(!extensionMoveSource.includes("planTraceableRewriteAfterRename"), "TRACEABLE rename or move UX should not keep a separate post-rename rewrite planner in the extension flow.");
  assert.ok(extensionMoveSource.includes("additionalMoves"), "TRACEABLE alone-move UX should preserve dependent and displacement follow-up moves from the precomputed plan.");
  assert.ok(extensionMoveSource.includes("const promptTraceableLineageRepair = async (") && extensionMoveSource.includes('...actions') && extensionMoveSource.includes('"Detach"') && extensionMoveSource.includes('"Re-connect"') && extensionMoveSource.includes('"Manually connect"'), "TRACEABLE extension source should centralize the repair prompt and offer the initial repair actions Detach, Re-connect, and Manually connect.");
  assert.ok(extensionMoveSource.includes("const collectTraceableAncestorPathKeys = async (") && extensionMoveSource.includes("would create a lineage cycle") && extensionMoveSource.includes("repairTraceableParentConnection(candidate, selectedParent.fsPath)"), "TRACEABLE manual connect should reject simple lineage cycles before rewriting the selected file's parent edge.");
  assert.ok(extensionMoveSource.includes("const repairTraceableLineage = async (target?: vscode.Uri): Promise<void> => {") && extensionMoveSource.includes("TRACEABLE did not find broken lineage") && extensionMoveSource.includes('if (message.type === "repairTraceLineage") {') && extensionMoveSource.includes("vscode.commands.registerCommand(REPAIR_TRACE_LINEAGE_COMMAND"), "TRACEABLE extension source should expose an explicit repair command and let the evidence webview invoke it directly.");
  assert.ok(extensionMoveSource.includes('if (!(await ensureTraceableLineageReadyForCommand(candidate, "Move Trace"))) {') && extensionMoveSource.includes('if (!(await ensureTraceableLineageReadyForCommand(candidate, "Copy Trace"))) {') && extensionMoveSource.includes('if (!(await ensureTraceableLineageReadyForCommand(candidate, "Return to Parent Trace"))) {'), "TRACEABLE move, copy, and return commands should run the same broken-lineage preflight before continuing.");
  assert.ok(lineageIntegritySource.includes("TRACEABLE_LINEAGE_CHECKSUM_ENABLED_SETTING") && lineageIntegritySource.includes("canonicalizeTraceableParentChecksumSource") && lineageIntegritySource.includes("computeTraceableParentChecksumSha256") && lineageIntegritySource.includes("evaluateTraceableDirectParentIntegrity"), "TRACEABLE lineage checksum source should expose the shared setting key, canonicalization helper, hash helper, and direct-parent evaluator.");
  assert.ok(lineageIntegritySource.includes('status: "legacy-no-checksum"') && lineageIntegritySource.includes('status: "checksum-mismatch"') && lineageIntegritySource.includes('status: "cycle-detected"') && lineageIntegritySource.includes('status: "disabled"'), "TRACEABLE lineage checksum evaluator should expose the planned broken-lineage and disabled states.");
  assert.ok(lineageIntegritySource.includes('if (!storedParentTraceChecksumSha256) {') && lineageIntegritySource.includes('status: "ok"'), "TRACEABLE lineage checksum evaluator should treat parentless root traces without a stored parent checksum as valid instead of flagging broken lineage.");
  assert.ok(evidenceSource.includes("parentTraceChecksumSha256: result.parentTraceChecksumSha256"), "TRACEABLE evidence export should persist the parentTraceChecksumSha256 field inside the Traceable State block when present.");
  assert.ok(evidenceSource.includes("const checksumEnabled = isTraceableLineageChecksumEnabled(vscode.Uri.file(readyFilePath));") && evidenceSource.includes("await computeTraceableParentChecksumSha256ForFile(result.parentTracePath)"), "TRACEABLE continuation export should gate checksum writes by setting and compute the direct-parent checksum from the resolved parent artifact.");
  assert.ok(evidenceSource.includes("const nextParentOrigin = remapStoredParentOriginForExport(result.parentOrigin, nextStoredParentTracePath);") && evidenceSource.includes("const nextParentCreatedAt = result.parentCreatedAt?.trim() || undefined;") && evidenceSource.includes("parentCreatedAt: nextParentCreatedAt") && evidenceSource.includes("parentOrigin: nextParentOrigin"), "TRACEABLE evidence export should preserve parent-created-at and parent-origin metadata across export finalization.");
  assert.ok(checksumContractSource.includes("parentTraceChecksumSha256?: string"), "TRACEABLE public result contract is missing the parentTraceChecksumSha256 field.");
  const checksumFileOperationsSource = await readFile(path.join(packageRoot, "src", "traceableFileOperations.ts"), "utf8");
  assert.ok(checksumFileOperationsSource.includes("const checksumEnabled = isTraceableLineageChecksumEnabled(vscode.Uri.file(input.nextPath));") && checksumFileOperationsSource.includes("computeTraceableParentChecksumSha256ForFileSync(remappedParentPath)") && checksumFileOperationsSource.includes("parentTraceChecksumSha256: nextParentTraceChecksumSha256"), "TRACEABLE rewrite flows should preserve or recompute direct-parent checksums when parent linkage is rewritten.");
  assert.ok(checksumFileOperationsSource.includes("const nextParentOrigin = remapStoredParentOriginForRewrite(parsed.result.parentOrigin, remappedParentPath, nextStoredParentTracePath);") && checksumFileOperationsSource.includes("const nextParentCreatedAt = parsed.result.parentCreatedAt?.trim() || undefined;") && checksumFileOperationsSource.includes("parentCreatedAt: nextParentCreatedAt") && checksumFileOperationsSource.includes("parentOrigin: nextParentOrigin"), "TRACEABLE rewrite flows should preserve and rewrite parent-origin and parent-created-at metadata when parent linkage changes.");
  assert.ok(checksumFileOperationsSource.includes("export async function rewriteTraceableEvidenceParentConnection(input: {") && checksumFileOperationsSource.includes("parentPathOverride?: string | null;") && checksumFileOperationsSource.includes("nextPath: input.filePath") && checksumFileOperationsSource.includes("pathMapping: new Map()"), "TRACEABLE file-operations source should expose a same-file parent-edge rewrite helper for repair flows.");
  const bundle = await readFile(path.join(packageRoot, "dist", "extension.js"), "utf8");
  assert.ok(bundle.includes("inspectTraceableEvidence"), "Built bundle is missing the TRACEABLE evidence inspect command.");
  assert.ok(bundle.includes("newTraceableChat"), "Built bundle is missing the New Traceable Chat command wiring.");
  assert.ok(bundle.includes("resumeTraceableChat"), "Built bundle is missing the Resume Traceable Chat command wiring.");
  assert.ok(bundle.includes("rewriteMoveTrace"), "Built bundle is missing the Rewrite Move Trace command wiring.");
  assert.ok(bundle.includes("rewriteCopyTrace"), "Built bundle is missing the Rewrite Copy Trace command wiring.");
  assert.ok(bundle.includes("returnToParentTrace"), "Built bundle is missing the Return to Parent Trace command wiring.");
  assert.ok(bundle.includes("repairTraceLineage"), "Built bundle is missing the Repair Trace Lineage command wiring.");
  assert.ok(bundle.includes("validateTraceableContinuity"), "Built bundle is missing the Validate Traceable Continuity command wiring.");
  assert.ok(bundle.includes("addFileToTraceableChat"), "Built bundle is missing the Add File to Traceable Chat command wiring.");
  assert.ok(bundle.includes("traceableDefaultMoveAction"), "Built bundle is missing the TRACEABLE default move action setting wiring.");
  assert.ok(bundle.includes("setDefaultNewTraceableChatExportFolder"), "Built bundle is missing the default New Traceable Chat export-folder command wiring.");
  assert.ok(bundle.includes("openTraceableEvidenceEditor"), "Built bundle is missing the TRACEABLE evidence viewer command.");
  assert.ok(bundle.includes("reopenTraceableEvidenceSource"), "Built bundle is missing the TRACEABLE evidence reopen-source command.");
  assert.ok(bundle.includes("reopenTraceableEvidencePreview"), "Built bundle is missing the TRACEABLE evidence reopen-preview command.");
  assert.ok(bundle.includes("tiinexTraceableContinuity"), "Built bundle is missing the continuity diagnostic collection wiring.");
  assert.ok(bundle.includes("Continuity footer checksum does not match the current artifact body."), "Built bundle is missing the continuity mismatch diagnostic message.");
  assert.ok(!bundle.includes("Continuity footer is missing; backward proof for this artifact remains partial."), "Built bundle should no longer emit partial-proof info diagnostics into Problems by default.");
  assert.ok(bundle.includes("run_traceable_subagent"), "Built bundle is missing the provenance TRACEABLE runtime tool wiring.");
  assert.ok(bundle.includes("transfer_trace"), "Built bundle is missing the provenance TRACEABLE transfer tool wiring.");
  assert.ok(bundle.includes("validate_traceable_continuity"), "Built bundle is missing the provenance continuity validation tool wiring.");
  assert.ok(bundle.includes("show_traceable_traces"), "Built bundle is missing the showTraces provenance tool wiring.");
  assert.ok(bundle.includes("list_traceable_agents"), "Built bundle is missing the provenance traceable agent catalog tool wiring.");
  assert.ok(bundle.includes("list_traceable_models"), "Built bundle is missing the provenance traceable model catalog tool wiring.");
  assert.ok(bundle.includes("showTraces"), "Built bundle is missing the public showTraces reference name.");
  assert.ok(bundle.includes("Show Traces"), "Built bundle is missing the Show Traces public display label.");
  assert.ok(bundle.includes("Suspicious Coordinate Gaps"), "Built bundle is missing the showTraces gap-reporting surface.");
  assert.ok(bundle.includes("Preferred matches"), "Built bundle is missing the traceable model policy summary rendering.");
  assert.ok(bundle.includes("Policy:"), "Built bundle is missing per-model policy flag rendering.");
  assert.ok(bundle.includes("Recommended flow:"), "Built bundle is missing embedded workflow guidance for traceable catalog tools.");
  assert.ok(bundle.includes("Typical next step:"), "Built bundle is missing the canonical next-step guidance for the traceable model catalog.");
  assert.ok(bundle.includes("openTraceableSubagentStatusDetail"), "Built bundle is missing the provenance TRACEABLE panel reveal command.");
  assert.ok(bundle.includes("stopTraceableSubagent"), "Built bundle is missing the provenance TRACEABLE stop command.");
  assert.ok(bundle.includes("Choose TRACEABLE evidence folder"), "Built bundle is missing the shared export-folder chooser label for New Traceable Chat.");
  assert.ok(bundle.includes("no ancestor parent trace leaves the current folder"), "Built bundle is missing the Return to Parent Trace no-op guard message.");
  assert.ok(bundle.includes("Copy Trace Here"), "Built bundle is missing the TRACEABLE copy destination chooser label.");
  assert.ok(bundle.includes("Native Explorer copy/paste for .trace.md is not supported"), "Built bundle is missing the native copy/paste fail-closed warning.");
  assert.ok(!bundle.includes("Native Explorer drag/drop or cut/paste moves for .trace.md across folders are not supported"), "Built bundle should no longer carry the old native folder-move fail-closed warning now that same-workspace drag/drop and cut/paste moves reuse the trace-aware move takeover.");
  assert.ok(bundle.includes("TRACEABLE move/copy destinations must stay inside the same repo root as the source evidence file."), "Built bundle is missing the repo-root destination safety warning for native move/copy flows.");
  assert.ok(bundle.includes("Enter the first user message for this traceable chat"), "Built bundle is missing the first-message prompt for New Traceable Chat.");
  assert.ok(bundle.includes("tiinex.aiProvenance.traceableStatus"), "Built bundle is missing the provenance TRACEABLE panel view id.");
  assert.ok(bundle.includes("Tool Ledger"), "Built bundle is missing the TRACEABLE evidence surface picker labels.");
  assert.ok(bundle.includes("Rendered Output"), "Built bundle is missing the moved traceable rendered-output label.");
  assert.ok(bundle.includes("hideToolbarControls"), "Built bundle is missing the restored TRACEABLE evidence panel renderer wiring.");
  assert.ok(bundle.includes("tiinexTraceableEvidenceEditor"), "Built bundle is missing the restored TRACEABLE evidence editor view type.");
  assert.ok(bundle.includes("view_traceable_subagent"), "Built bundle is missing the provenance LM tool wiring.");
  assert.ok(bundle.includes("transferTrace"), "Built bundle is missing the public transferTrace reference name.");
  assert.ok(bundle.includes("validateTrace"), "Built bundle is missing the public validateTrace reference name.");
  assert.ok(bundle.includes("## Lineage"), "Built bundle is missing the evidence lineage observability section.");
  assert.ok(bundle.includes("### Direct Children"), "Built bundle is missing direct-child lineage rendering in evidence views.");
  assert.ok(bundle.includes("Carry State"), "Built bundle is missing the separate carry-state request summary label.");
  assert.ok(bundle.includes("Latest Role State"), "Built bundle is missing the latest-role-state surface label.");
  assert.ok(bundle.includes("Latest Carry Package"), "Built bundle is missing the latest-carry-package surface label.");
  assert.ok(bundle.includes("Parent Roles"), "Built bundle is missing parentRoles request-summary rendering.");
  assert.ok(bundle.includes("parentRoles"), "Built bundle is missing parentRoles runtime wiring.");
  assert.ok(bundle.includes("senderAdaptationObservations"), "Built bundle is missing sender adaptation child-payload wiring.");
  assert.ok(bundle.includes("Sender Adaptation State"), "Built bundle is missing sender adaptation evidence rendering.");
  assert.ok(bundle.includes("allRolesAvailableAsChatSender"), "Built bundle is missing the chat sender-role setting wiring.");
  assert.ok(bundle.includes("defaultChatSenderRole"), "Built bundle is missing the default chat sender-role setting wiring.");
  assert.ok(bundle.includes("bodySignature"), "Built bundle is missing sender-role body-signature dedupe wiring.");
  const source = await readFile(path.join(packageRoot, "src", "traceableEvidence.ts"), "utf8");
  assert.ok(source.includes("TRACEABLE_EVIDENCE_STATE_SCHEMA"), "Traceable evidence parser source is missing the schema constant.");
  assert.ok(source.includes("renderTraceableEvidenceToolLedgerMarkdown"), "Traceable evidence source is missing the bounded tool-ledger renderer.");
  assert.ok(source.includes("renderTraceableEvidenceRequestContractMarkdown"), "Traceable evidence source is missing the bounded request-contract renderer.");
  assert.ok(source.includes("renderTraceableEvidenceRuntimeDecisionMarkdown"), "Traceable evidence source is missing the bounded runtime-decision renderer.");
  assert.ok(source.includes("renderTraceableEvidenceBasisMarkdown"), "Traceable evidence source is missing the bounded evidence-basis renderer.");
  assert.ok(source.includes("renderTraceableEvidenceTimelineMarkdown"), "Traceable evidence source is missing the bounded timeline renderer.");
  assert.ok(source.includes("renderTraceableEvidenceCarryHandoffMarkdown"), "Traceable evidence source is missing the bounded carry-handoff renderer.");
  assert.ok(source.includes("renderTraceableEvidenceLatestRoleStateMarkdown"), "Traceable evidence source is missing the lineage-scoped latest-role-state renderer.");
  assert.ok(source.includes("renderTraceableEvidenceLatestCarryPackageMarkdown"), "Traceable evidence source is missing the lineage-scoped latest-carry-package renderer.");
  assert.ok(source.includes("renderTraceableEvidenceToolForensicsMarkdown"), "Traceable evidence source is missing the bounded tool-forensics renderer.");
  assert.ok(source.includes("renderTraceableEvidenceLineageMarkdown"), "Traceable evidence source is missing the bounded lineage renderer.");
  assert.ok(source.includes("renderViewTraceableSubagentMarkdown"), "Traceable evidence source is missing the moved traceable view renderer.");
  assert.ok(source.includes("buildTraceableEvidenceLineageLines"), "Traceable evidence source is missing the derived lineage observability helper.");
  assert.ok(source.includes("collectTraceableCurrentAndAncestorNodes"), "Traceable evidence source is missing the lineage backtracking helper for latest-state surfaces.");
  assert.ok(source.includes("Direct Children"), "Traceable evidence source is missing direct-child lineage labels.");
  assert.ok(source.includes("function extractTraceableEvidenceStateJson"), "Traceable evidence parser should extract the Traceable State JSON block with a dedicated helper.");
  assert.ok(source.includes("const closingMatch = /^```[ \\t]*$/um.exec(remainder);"), "Traceable evidence parser should close the Traceable State block only on a standalone fence line.");
  assert.ok(source.includes('case "runtime-decision":'), "Traceable evidence surface renderer is missing the runtime-decision case.");
  assert.ok(source.includes('case "evidence-basis":'), "Traceable evidence surface renderer is missing the evidence-basis case.");
  assert.ok(source.includes('case "request-contract":'), "Traceable evidence surface renderer is missing the request-contract case.");
  assert.ok(source.includes('case "timeline":'), "Traceable evidence surface renderer is missing the timeline case.");
  assert.ok(source.includes('case "carry-handoff":'), "Traceable evidence surface renderer is missing the carry-handoff case.");
  assert.ok(source.includes('case "latest-role-state":'), "Traceable evidence surface renderer is missing the latest-role-state case.");
  assert.ok(source.includes('case "latest-carry-package":'), "Traceable evidence surface renderer is missing the latest-carry-package case.");
  assert.ok(source.includes('case "tool-forensics":'), "Traceable evidence surface renderer is missing the tool-forensics case.");
  assert.ok(source.includes('case "lineage":'), "Traceable evidence surface renderer is missing the lineage case.");
  assert.ok(source.includes("senderAdaptationState: compatResult.senderAdaptationState"), "Traceable evidence parser should preserve sender adaptation state in compat snapshots.");
  const contractSource = await readFile(path.join(packageRoot, "src", "traceableContract.ts"), "utf8");
  assert.ok(contractSource.includes('const resolvedInputPath = path.isAbsolute(trimmed)') && contractSource.includes('path.resolve(baseDir, trimmed)') && contractSource.includes('resolveTraceablePathTargetFromAbsolutePath') && contractSource.includes('tryRemapAbsolutePathThroughRepoRootSnapshot') && contractSource.includes('path.relative(repoRootSnapshotPath, absolutePath)'), "Traceable markdown path rendering should resolve stored relative references against the evidence file directory and be able to remap persisted absolute paths through the repo-root snapshot before deciding whether to render them as relative markdown or absolute file URIs.");
  const extensionSource = await readFile(path.join(packageRoot, "src", "extension.ts"), "utf8");
  assert.ok(extensionSource.includes('label: "Parent Roles"'), "Traceable extension source is missing Parent Roles request-summary rendering.");
  assert.ok(extensionSource.includes("Latest Role State"), "Traceable extension source is missing the latest-role-state picker label.");
  assert.ok(extensionSource.includes("Latest Carry Package"), "Traceable extension source is missing the latest-carry-package picker label.");
  assert.ok(extensionSource.includes('vscode.workspace.onWillRenameFiles') && extensionSource.includes('vscode.workspace.onDidRenameFiles') && extensionSource.includes('traceableRenameMoveRewriteBehavior') && extensionSource.includes('confirmTraceableRenameMoveRewrite') && extensionSource.includes('performTraceableStagedFileMoveOperation') && extensionSource.includes('runTraceableOwnedMoveOperation') && extensionSource.includes('pendingTraceableRewriteRenames'), "Traceable extension source is missing the trace-aware rename/move wiring across staged lineage moves and host-owned alone rewrites.");
  assert.ok(extensionSource.includes('const RETURN_TO_PARENT_TRACE_ELIGIBLE_CONTEXT = "tiinex.aiProvenance.returnToParentEligibleResources";') && extensionSource.includes('buildTraceableExplorerResourceContextKeys(resource: vscode.Uri)') && extensionSource.includes('const uriPath = resource.path;') && extensionSource.includes('const decodedUriPath = decodeURIComponent(uriPath);') && extensionSource.includes('refreshReturnToParentTraceEligibleContext') && extensionSource.includes('vscode.workspace.findFiles("**/*.trace.md")'), "Traceable extension source should keep the return-to-parent eligibility context computation available for Explorer gating and command-side lineage checks.");
  assert.ok(extensionSource.includes('topic-schema-parent-origin-missing') && extensionSource.includes('topic-schema-parent-origin-browse-git-missing') && extensionSource.includes('topic-schema-parent-origin-unpinned-browse-git') && extensionSource.includes('topic-schema-parent-created-at-missing') && extensionSource.includes('topic-schema-parent-created-at-invalid') && extensionSource.includes('topic-schema-parent-created-at-mismatch') && extensionSource.includes('topic-schema-footer-target-mismatch') && extensionSource.includes('topic-schema-footer-target-not-permalink') && extensionSource.includes('topic-schema-lineage-unexpected-envelope-field') && extensionSource.includes('topic-schema-envelope-schema-mismatch') && extensionSource.includes('topic-schema-envelope-schema-unreadable') && extensionSource.includes('topic-schema-parent-schema-unreadable') && extensionSource.includes('topic-schema-current-schema-unreadable') && extensionSource.includes('root-schema-envelope-schema-mismatch') && extensionSource.includes('root-schema-envelope-schema-unreadable') && extensionSource.includes('root-schema-current-schema-unreadable') && extensionSource.includes('function createInsertTopicSchemaParentOriginEdit(') && extensionSource.includes('function createSetTopicSchemaParentCreatedAtEdit(') && extensionSource.includes('function createSetTopicSchemaFooterTowardsEdit(') && extensionSource.includes('function createInsertContinuityIntegrityFooterEdit(') && extensionSource.includes('function createSetContinuityParentCreatedAtEdit(') && extensionSource.includes('function createRefreshTraceablePermalinkFromLatestEdit(') && extensionSource.includes('REFRESH_TRACEABLE_PERMALINK_FROM_LATEST_COMMAND') && extensionSource.includes('Refresh permalink from latest') && extensionSource.includes('Insert Parent Created At from parent trace') && extensionSource.includes('Replace Parent Created At from parent trace') && extensionSource.includes('Insert Continuity Integrity footer') && extensionSource.includes('Insert Parent Origin scaffold') && extensionSource.includes('Insert browse + git permalink scaffold') && extensionSource.includes('Replace footer Towards permalink'), "Traceable extension source should map schema-envelope, footer-target, parent-created-at, and Parent Origin diagnostics to the right lines, expose scaffold quick fixes for missing or drifted origin metadata across both schema notes and ordinary traces, and offer a latest-origin permalink refresh fix for equivalent permalink diagnostics.");
  assert.ok(extensionSource.includes('computeTargetedTraceableContinuityChecksumSha256') && extensionSource.includes('parseSchemaNoteMarkdown(markdown).footerIntegrity') && extensionSource.includes('artifactUri.fsPath.endsWith(".schema.md")'), "Traceable extension checksum rotation should use the declared footer target when rotating schema-note checksums.");
  assert.ok(extensionSource.includes('const returnToParentTraceWatcher = vscode.workspace.createFileSystemWatcher("**/*.trace.md");') && extensionSource.includes('onDidSaveTextDocument((document) => {') && extensionSource.includes('onDidChangeWorkspaceFolders(() => {'), "Traceable extension source should keep the return-to-parent eligibility context refreshed as trace files change.");
  assert.ok(extensionSource.includes('function getConfiguredTraceableDefaultMoveAction(resource?: vscode.Uri): TraceableDefaultFileAction {') && extensionSource.includes('function getConfiguredTraceableMovePromptOutcome(') && extensionSource.includes('pickPreferredTraceableLineageScope'), "Traceable extension source is missing the configurable default move action readers and lineage-scope preference helper.");
  assert.ok(extensionSource.includes('"Alone",') && extensionSource.includes('"Lineage"') && !extensionSource.includes('"Unmodified"') && extensionSource.includes('function confirmTraceableLineageMoveScope(') && extensionSource.includes('getConfiguredTraceableDefaultMultiSelectLineageScope') && extensionSource.includes('scope !== "tree" && scope !== "tree-plus-seeds"') && extensionSource.includes('if (options.length === 1) {') && extensionSource.includes('return { action: "alone" };') && extensionSource.includes('if (selection === "Alone")'), "Traceable extension source should present the Alone/Lineage prompt, auto-select the only valid Alone action when no lineage option exists, support a multi-select lineage default, and restrict multi-select lineage choices to Leaves or Branch.");
  assert.ok(extensionSource.includes('return Promise.reject(new Error("TRACEABLE rename or move cancelled by user."));') && !extensionSource.includes('throw new vscode.CancellationError();'), "Traceable rename cancel handling should use a rejected waitUntil promise instead of throwing CancellationError directly.");
  assert.ok(extensionSource.includes('showOpenDialog({') && extensionSource.includes('Move Trace Here') && extensionSource.includes('Choose TRACEABLE move destination folder') && extensionSource.includes('planTraceableRewriteMove') && extensionSource.includes('REWRITE_MOVE_TRACE_COMMAND'), "Traceable extension source is missing the explicit Move Trace command flow.");
  assert.ok(extensionSource.includes('prepareTraceableRewriteRequestedMove') && extensionSource.includes('planTraceableStandaloneMoveDependencyRewrites') && extensionSource.includes('planTraceableStandaloneMoveReturnDisplacementMoves') && extensionSource.includes('additionalMoves: [...returnDisplacementMoves],') && extensionSource.includes('additionalRewrites: dependentRewrites') && extensionSource.includes('from "./traceableMutationPlan"') && extensionSource.includes('prepareTraceableRewriteMoveMutationPlan') && extensionSource.includes('ApplyTraceableMutationPlan') && extensionSource.includes('...preparedMove.additionalRewrites.map((rewrite) => createTraceableRewriteMutation(rewrite.fileUri, rewrite.nextContent))'), "Traceable extension source should precompute standalone requested moves, carry only destination displacements plus retained-descendant rewrites forward into one explicit mutation plan, and apply that plan through one apply surface.");
  assert.ok(extensionSource.includes('RETURN_TO_PARENT_TRACE_COMMAND') && extensionSource.includes('const resolveReturnToParentTraceDestinationFolder = async (candidate: vscode.Uri): Promise<string | undefined> => {') && extensionSource.includes('while (currentFilePath && !visitedPaths.has(path.resolve(currentFilePath).toLowerCase()))') && extensionSource.includes('Return to Parent Trace skipped because no ancestor parent trace leaves the current folder.') && extensionSource.includes('inspectTraceableLineageMoveScopes') && extensionSource.includes('filterMeaningfulTraceableLineageScopes') && extensionSource.includes('executeTraceableTransferSelection(candidate, destinationFolder, promptOutcome.action === "alone"') && extensionSource.includes('operation: "move"'), "Traceable extension source should resolve Return to Parent Trace against the first ancestor parent that actually leaves the current folder, not only the direct parent entry.");
  assert.ok(extensionSource.includes('buildTraceableStagedMoveUri') && extensionSource.includes('const stagedBaseName = `.${path.basename(targetUri.fsPath)}`;') && extensionSource.includes('stageUri: buildTraceableStagedMoveUri(move.oldUri)') && !extensionSource.includes('traceable-moving-') && extensionSource.includes('planTraceableRenameMoveOperation') && !extensionSource.includes('if (promptOutcome.action === "unmodified") {') && extensionSource.includes('if (promptOutcome.action === "alone") {') && extensionSource.includes('pendingTraceableRewriteRenames.set') && extensionSource.includes('function getConfiguredTraceableDisableMoveCopyLogic(resource?: vscode.Uri): boolean {') && extensionSource.includes('TRACEABLE move/copy logic is disabled for this resource.'), "Traceable extension source should stage lineage moves with dot-prefixed intermediate names, remove Unmodified from the normal move affordance, and expose an explicit move/copy override gate.");
  assert.ok(extensionSource.includes('async function closeNonDirtyRelatedTraceableTabs(resources: readonly vscode.Uri[]): Promise<void> {') && extensionSource.includes('hasDirtyOpenTraceableDocument(resource)') && extensionSource.includes('function collectOpenTraceableDocuments(resolvedUri: vscode.Uri): vscode.TextDocument[] {') && extensionSource.includes('async function saveAndCloseMatchingGeneratedDirtyTraceableDocuments(contentByResourceKey: ReadonlyMap<string, { resource: vscode.Uri; expectedContent: string }>): Promise<void> {') && extensionSource.includes('if (!document.isDirty || document.getText() !== expectedContent) {') && extensionSource.includes('await saveAndCloseMatchingGeneratedDirtyTraceableDocuments(generatedTraceableContentByResourceKey);') && extensionSource.includes('const generatedTraceableContentEntries: Array<readonly [string, { resource: vscode.Uri; expectedContent: string }]> = [') && extensionSource.includes('...moveMutations.flatMap((mutation) => [mutation.oldUri, mutation.newUri])') && extensionSource.includes('...rewriteMutations.map((mutation) => mutation.fileUri)'), "Traceable mutation application should settle extension-generated dirty .trace.md source tabs that already match the planned TRACEABLE output before and after external move or rewrite operations, instead of restoring them as confusing unsaved source editors later.");
  assert.ok(extensionSource.includes('ADD_FILE_TO_TRACEABLE_CHAT_COMMAND') && extensionSource.includes('Add File to Traceable Chat is not implemented yet'), "Traceable extension source is missing the Add File to Traceable Chat placeholder command.");
  assert.ok(extensionSource.includes('formatTraceableModelIdDisplayName') && extensionSource.includes('const haystack = [entry.displayName, entry.id, entry.vendor, entry.family, entry.version]') && extensionSource.includes('lines.push(`- ${entry.displayName ?? formatTraceableModelIdDisplayName(entry.id) ?? entry.id ?? "(missing id)"}`);') && extensionSource.includes('lines.push(`  - Exact Id: ${entry.id ?? "-"}`);'), "list_traceable_models should show the same human-readable model names as TRACEABLE while preserving the exact id separately for copyable model selection.");
  assert.ok(extensionSource.includes('const TRANSFER_TRACE_TOOL = "transfer_trace";'), "Extension source is missing the transfer_trace tool constant.");
  assert.ok(extensionSource.includes('function renderTransferTraceResultMarkdown('), "Extension source is missing transferTrace result rendering.");
  assert.ok(extensionSource.includes('async function performTraceablePreparedCopyOperation('), "Extension source is missing the TRACEABLE copy helper.");
  assert.ok(extensionSource.includes('const transferTrace = async (input: TransferTraceInput)'), "Extension source is missing the transferTrace execution helper.");
  assert.ok(extensionSource.includes('type TraceableTransferSelection =') && extensionSource.includes('const executeTraceableTransferSelection = async (') && extensionSource.includes('selection: TraceableTransferSelection') && extensionSource.includes('return selection.operation === "move"') && extensionSource.includes(': performTraceableRewriteCopyToFolder(candidate, destinationFolder);') && extensionSource.includes(': performTraceablePreserveCopyToFolder(candidate, destinationFolder, selection.scope);'), "Traceable extension source should funnel both tooling and Explorer move/copy dispatch through one shared transfer executor.");
  assert.ok(extensionSource.includes('const TRACEABLE_CROSS_WORKSPACE_DESTINATION_UNSUPPORTED_MESSAGE =') && extensionSource.includes('function assertTraceableDestinationWithinSourceWorkspace(sourceUri: vscode.Uri, destinationUri: vscode.Uri): void {') && extensionSource.includes('assertTraceableDestinationWithinSourceWorkspace(candidate, destinationFolder);') && extensionSource.includes('assertTraceableDestinationWithinSourceWorkspace(sourceUri, destinationFolderUri);') && extensionSource.includes('assertTraceableDestinationWithinSourceWorkspace(file.oldUri, file.newUri);'), "Traceable extension source should fail closed when a move/copy destination escapes the source workspace folder instead of allowing evidence files to land in another repo or org root.");
  assert.ok(extensionSource.includes('sourcePaths?: string[];') && extensionSource.includes('const requestedSourcePaths = [') && extensionSource.includes('...(Array.isArray(input.sourcePaths) ? input.sourcePaths : [])') && extensionSource.includes('const normalizedSelection = requestedFiles.length > 1') && extensionSource.includes('normalizeTraceableRenameMoveFileSelection({ files: requestedFiles, workspaceRoots })') && extensionSource.includes('droppedSourcePaths: normalizedSelection.droppedFiles.map((file) => file.oldUri.fsPath)'), "transfer_trace should accept multiple source paths, normalize overlapping selections, and report dropped sources from the normalized plan.");
  assert.ok(extensionSource.includes('`- Source Count: ${input.sourcePaths.length}`') && extensionSource.includes('## Source Paths') && extensionSource.includes('## Dropped Source Paths'), "transfer_trace result rendering should show planned source counts and dropped source paths for multi-file transfers.");
  assert.ok(extensionSource.includes('const lineageScope = requestedLineageScope') && extensionSource.includes('? await resolveTransferTraceLineageScope(plannedFiles[0].oldUri, destinationFolderUri, requestedLineageScope)') && extensionSource.includes(': sharedScopes[0]'), "transfer_trace multi-file scope resolution should preserve an explicit lineageScope request instead of silently falling back to the first shared scope.");
  assert.ok(extensionSource.includes('const nextOutputPaths = await executeTraceableTransferSelection(file.oldUri, destinationFolderUri, {') && extensionSource.includes('action: "alone",') && extensionSource.includes('action: "lineage",'), "transfer_trace should use the same shared transfer executor for both alone and lineage execution paths.");
  assert.ok(extensionSource.includes('const canPlanExplicitTraceableLineageScopeForDestination = async (') && extensionSource.includes('if (await canPlanExplicitTraceableLineageScopeForDestination(candidate, destinationFolder, requestedScope)) {') && extensionSource.includes('lineageScope: requestedScope,'), "Traceable extension source should validate explicit transferTrace lineage scopes against direct planner output when the preflight scope heuristic undercounts deeper connected lineage.");
  assert.ok(extensionSource.includes('function getConfiguredTraceableChatCollapse(resource?: vscode.Uri): "auto" | "always" {') && extensionSource.includes('get<string>("chatCollapse", "auto")') && extensionSource.includes('chatCollapseMode: getConfiguredTraceableChatCollapse(resolvedUri),') && extensionSource.includes('return getConfiguredTraceableChatCollapse(resource);'), "Traceable extension source should expose and thread the chatCollapse auto|always setting into both evidence editors and the bottom panel.");
  assert.ok(extensionSource.includes('function getConfiguredQuickSelectRole(resource?: vscode.Uri): boolean {') && extensionSource.includes('get<boolean>("quickSelectRole", true) === true') && extensionSource.includes('if (getConfiguredQuickSelectRole(resource) && resolvedDefaultSenderRole) {') && extensionSource.includes('return resolvedDefaultSenderRole;') && extensionSource.includes('const promptableOptions = buildPromptableChatSenderRoleOptions(availableRoles, resolvedDefaultSenderRole);'), "Traceable extension source should skip the New/Resume sender-role quick pick when quickSelectRole is enabled and a default sender role resolves cleanly.");
  assert.ok(extensionSource.includes('async function resolveTraceableTransferPromptOutcome(input: {') && extensionSource.includes('const meaningfulScopes = await filterMeaningfulTraceableLineageScopes(input.files, availableScopes, input.workspaceRoots);') && extensionSource.includes('const promptableScopes = resolvePromptableTraceableLineageScopes(availableScopes, meaningfulScopes);') && extensionSource.includes('? getConfiguredTraceableCopyPromptOutcome(input.resource, meaningfulScopes)') && extensionSource.includes(': getConfiguredTraceableMovePromptOutcome(input.resource, meaningfulScopes);') && extensionSource.includes('await resolveTraceableTransferPromptOutcome({') && extensionSource.includes('operationLabel: "move"') && extensionSource.includes('operationLabel: "copy"'), "Traceable extension source should centralize destination-viable lineage filtering, promptable-scope fallback, and move/copy prompt selection in one shared prompt resolver.");
  const traceableMovePlannerSource = await readFile(path.join(packageRoot, "src", "traceableFileOperations.ts"), "utf8");
  assert.ok(traceableMovePlannerSource.includes('const seedDirectoryKey = normalizeDirectoryPathKey(seedNode.path);') && traceableMovePlannerSource.includes('if (normalizeDirectoryPathKey(node.path) === seedDirectoryKey) {') && traceableMovePlannerSource.includes('connectedNodesByPathKey.set(node.pathKey, node);'), "Traceable move planner should include seed-directory peers in the connected lineage graph so deep-leaf tree scopes remain distinct from branch scopes.");
  assert.ok(extensionSource.includes('function ensureTraceableSenderTrackSuffix(') && extensionSource.includes('if (entry.experimental) {') && extensionSource.includes('`${trimmedDisplayName} (Experimental)`') && extensionSource.includes('if (entry.candidate) {') && extensionSource.includes('`${trimmedDisplayName} (Candidate)`') && extensionSource.includes('label: ensureTraceableSenderTrackSuffix(entry.displayName, entry),') && extensionSource.includes('value: ensureTraceableSenderTrackSuffix(entry.displayName, entry)'), "Traceable extension source should render sender-role variants with truthful candidate/experimental suffixes even when the raw role name omits the track marker.");
  assert.ok(extensionSource.includes('function getConfiguredHideRolesWithSameBody(resource?: vscode.Uri): boolean {') && extensionSource.includes('get<boolean>("hideRolesWithSameBody", false) === true') && extensionSource.includes('function buildTraceableSenderBodyToolsetIdentityKey(') && extensionSource.includes('entry.toolDeclarations') && extensionSource.includes('toolDeclarations: normalizedToolDeclarations') && extensionSource.includes('function maybeHideChatSenderRolesWithSameBody(') && extensionSource.includes('const dedupedEntriesByBodySignature = new Map<string, Awaited<ReturnType<typeof listTraceableAgentCatalogEntries>>[number]>();') && extensionSource.includes('const bodyToolsetIdentityKey = buildTraceableSenderBodyToolsetIdentityKey(entry);') && extensionSource.includes('return [...dedupedEntriesByBodySignature.values(), ...dedupedEntriesWithoutBodySignature].sort(comparePreferredChatSenderEntries);'), "Traceable extension source should expose a same-body sender-role dedupe setting that only collapses roles when both body and declared toolset match, keeping the first preferred variant from the normal sender ordering.");
  assert.ok(extensionSource.includes("const syncTraceableAuxiliaryViewsFromEvidenceSnapshot = (") && extensionSource.includes("options: { updatePanel?: boolean } = {}") && extensionSource.includes("traceableStatusDetail.update(snapshot);") && extensionSource.includes("if (options.updatePanel === true) {") && extensionSource.includes("traceableStatusPanel.update(snapshot);") && extensionSource.includes("syncTraceableAuxiliaryViewsFromEvidenceSnapshot(latestState.parsedState.snapshot);") && extensionSource.includes("syncTraceableAuxiliaryViewsFromEvidenceSnapshot(initialState.parsedState.snapshot);"), "Traceable extension source should refresh file-backed evidence into the detail controller without forcing historical editor snapshots into the live bottom panel.");
  assert.ok(extensionSource.includes('const finalizedEvidenceFilePath = finalized.evidenceFile?.filePath?.trim();') && extensionSource.includes('const latestState = await readTraceableEvidenceViewState(vscode.Uri.file(finalizedEvidenceFilePath));') && extensionSource.includes('const latestSnapshot = traceableEvidence.updateSnapshot(latestState.parsedState.snapshot);') && extensionSource.includes('syncTraceableAuxiliaryViewsFromEvidenceSnapshot(latestSnapshot, { updatePanel: true });'), "Traceable extension source should refresh panel/detail from the finalized evidence file at run completion so the bottom panel does not keep counting on a stale running snapshot.");
  assert.ok(extensionSource.includes('const openTraceableChatResultWhenPanelNotAutoRevealed = async (result: TraceableSubagentRunResult): Promise<void> => {') && extensionSource.includes('if (shouldAutoRevealTraceablePanel(true) || !result.evidenceFile?.filePath) {') && extensionSource.includes('initialChatViewEnabled: true,') && extensionSource.includes('applyConfiguredDefaultView: false') && extensionSource.includes('await openTraceableChatResultWhenPanelNotAutoRevealed(result);'), "Traceable New/Resume chat commands should open the evidence editor in chat mode when autoReveal does not open the panel.");
  assert.ok(extensionSource.includes('function getTraceableSenderTrackRank(entry: Awaited<ReturnType<typeof listTraceableAgentCatalogEntries>>[number]): number {') && extensionSource.includes('function getTraceableSenderOptionTrackRank(option: ChatSenderRoleOption): number {') && extensionSource.includes('function compareChatSenderRoleOptions(left: ChatSenderRoleOption, right: ChatSenderRoleOption): number {') && extensionSource.includes('stripTraceableSenderTrackSuffix') && extensionSource.includes('return filteredEntries.map((entry) => ({') && extensionSource.includes('})).sort(compareChatSenderRoleOptions);') && extensionSource.includes('.sort(compareChatSenderRoleOptions);'), "Traceable extension source should sort sender-role options alphabetically by simplified role name and then prefer stable, candidate, and experimental variants in that order within the same role family, even when the visible role suffix is the clearest track signal.");
  assert.ok(extensionSource.includes('type PromptableChatSenderRoleOption = {') && extensionSource.includes('function buildPromptableChatSenderRoleOptions(') && extensionSource.includes('const defaultOption = resolvedDefaultSenderRole') && extensionSource.includes('const remainingRoles = defaultOption') && extensionSource.includes('roleOption.value !== defaultOption.value') && extensionSource.includes('label: "No sender role"') && extensionSource.includes('options.push(...remainingRoles.map((roleOption) => ({'), "Traceable extension source should avoid duplicating the resolved default sender-role item when the sender quick pick is shown.");
  const subagentEvidenceSource = await readFile(path.join(packageRoot, "src", "traceableSubagentEvidence.ts"), "utf8");
  assert.ok(subagentEvidenceSource.includes("renderSenderAdaptationEvidenceLines") && subagentEvidenceSource.includes("senderAdaptationState: result.senderAdaptationState"), "Traceable evidence export source is missing sender adaptation persistence and markdown rendering.");
  assert.ok(subagentEvidenceSource.includes("resolveTraceableRepoRootSnapshotPath") && subagentEvidenceSource.includes("repoRootSnapshotPath") && subagentEvidenceSource.includes("environment: snapshot.environment ?? this.snapshot.environment") && subagentEvidenceSource.includes("resolveTraceableRepoRootSnapshotPath(folderPath)"), "Traceable evidence export source should capture a repo-root snapshot path from the current workspace environment and preserve it across live snapshot updates.");
  assert.ok(subagentEvidenceSource.includes("TRACEABLE_REQUEST_SUMMARY_PATH_PREFIXES") && subagentEvidenceSource.includes("rewriteTraceableRequestSummaryPathLines") && subagentEvidenceSource.includes("isTraceableMarkdownLink") && subagentEvidenceSource.includes('"Export folder:"') && subagentEvidenceSource.includes('"Inherited from parent trace:"') && subagentEvidenceSource.includes('"Continuation parent:"') && subagentEvidenceSource.includes('"Parent Trace:"') && subagentEvidenceSource.includes('"Role:"'), "Traceable evidence export source should normalize known request-summary path lines into stable markdown links while preserving already formatted links.");
  assert.ok(subagentEvidenceSource.includes("hasRequestedModelSelector") && subagentEvidenceSource.includes("const persistedRuntimeModelSelector = result.model ? normalizeModelSelector(result.model)") && subagentEvidenceSource.includes("!hasRequestedModelSelector(result.request?.modelSelector) && persistedRuntimeModelSelector.id"), "Traceable evidence export should persist the exact selected runtime model into the finalized request contract whenever the caller did not explicitly request a different model.");
  const fileOperationsSource = await readFile(path.join(packageRoot, "src", "traceableFileOperations.ts"), "utf8");
  assert.ok(fileOperationsSource.includes("buildTraceableRenameMoveWorkspaceEdit") && fileOperationsSource.includes("planTraceableRenameMoveOperation"), "Traceable file-operations source is missing the rename/move staging planners.");
  assert.ok(fileOperationsSource.includes("hostOwnsRequestedSourceRenames?: boolean;") && fileOperationsSource.includes("const hostOwnsRequestedSourceRenames = input.hostOwnsRequestedSourceRenames === true;") && fileOperationsSource.includes("(!planIsRequestedRoot || !hostOwnsRequestedSourceRenames)"), "Traceable file-operations source should let explicit preserve moves rename the requested root file while Explorer host renames keep owning that root move.");
  assert.ok(fileOperationsSource.includes("export type TraceableNormalizedRenameMoveFileSelection = {") && fileOperationsSource.includes("normalizeTraceableRenameMoveFileSelection") && fileOperationsSource.includes("hostOwnedRequestedFiles?: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[];"), "Traceable file-operations source should normalize overlapping multi-select trace roots while still honoring every host-owned requested move pair.");
  assert.ok(fileOperationsSource.includes("listTraceableEvidencePathsRecursively") && fileOperationsSource.includes("resolveTraceableSearchRoots") && fileOperationsSource.includes("buildConnectedTraceableLineageGraph") && fileOperationsSource.includes("const connectedChildrenByParentPathKey = new Map<string, ConnectedTraceableLineageNode[]>();") && fileOperationsSource.includes("inspectTraceableLineageMoveScopes") && fileOperationsSource.includes("if (normalizedWorkspaceRoots.length > 0) {") , "Traceable file-operations source should discover connected lineage graphs across all open workspace roots and expose the meaningful lineage scopes for the selected file.");
  assert.ok(fileOperationsSource.includes("parentLineageLabel?: string;") && fileOperationsSource.includes("compareTraceableLineageNodeAffinity") && fileOperationsSource.includes("canonicalNodesByLineageLabel") && fileOperationsSource.includes("const canonicalSeedNode = canonicalNodesByLineageLabel.get(seedNode.parsedFileName.lineageLabel) ?? seedNode;"), "Traceable file-operations source should dedupe connected lineage graphs by lineage label around the selected seed before planning rewrite moves.");
  assert.ok(fileOperationsSource.includes("planTraceableStandaloneMoveDependencyMoves") && fileOperationsSource.includes("planTraceableStandaloneMoveDependencyRewrites") && fileOperationsSource.includes("planStandaloneMoveRetainedDescendantRewrites") && fileOperationsSource.includes("const directChildren = graph.childrenByParentPathKey.get(sourcePathKey) ?? [];") && fileOperationsSource.includes("parentPathOverride: plan.parentPathOverride") , "Traceable file-operations source should keep retained standalone-move descendants in place and rewrite their parent references through a dedicated rewrite planner.");
  assert.ok(fileOperationsSource.includes('export type TraceableLineageMoveScope = "leaves" | "branch" | "tree" | "tree-plus-seeds";') && fileOperationsSource.includes('function resolveTraceableBranchRootNode(') && fileOperationsSource.includes('function collectTraceableDirectoryLocalPathKeys(') && fileOperationsSource.includes('function collectTraceableDescendantClosureFromSeeds(') && fileOperationsSource.includes('function buildTraceableLineageScopePathKeys(') && fileOperationsSource.includes('const commonPrefixLength = isSelectedFile'), "Traceable file-operations source should support Leaves, Branch, Tree, and Tree Plus Seeds scope planning through graph-aware lineage rebasing with a directory-local tree boundary.");
  assert.ok(fileOperationsSource.includes("adoptExistingTarget?: boolean;") && fileOperationsSource.includes("adoptExistingTarget: !isSelectedFile && await pathExists(nextPath)") && fileOperationsSource.includes("if (plan.adoptExistingTarget === true) {") && fileOperationsSource.includes("adoptExistingTarget") , "Traceable file-operations source should reuse already-present connected destination lineage nodes during preserve moves instead of treating every non-root preserve node as already adopted.");
  assert.ok(fileOperationsSource.includes("if (oldPathKey === newPathKey) {") && fileOperationsSource.includes("if (normalizePathKey(plan.oldPath) === normalizePathKey(plan.newPath) && (!rewrittenMarkdown || rewrittenMarkdown === markdown)) {") , "Traceable file-operations source should skip exact self-target lineage no-ops instead of surfacing a target-exists collision or preparing a useless staged move.");
  assert.ok(fileOperationsSource.includes("planTraceableRewriteAfterRename"), "Traceable file-operations source is missing the post-rename rewrite planner.");
  assert.ok(fileOperationsSource.includes("planTraceableRewriteMove"), "Traceable file-operations source is missing the pre-rename rewrite move planner.");
  assert.ok(fileOperationsSource.includes("allocateNextTraceableLineageLabel"), "Traceable file-operations source is missing destination top-level lineage allocation for rewrite.");
  assert.ok(fileOperationsSource.includes("shouldAllocateUnderParent") && fileOperationsSource.includes("destinationParentParts?.lineageLabel"), "Traceable file-operations source should restore child-dimension rewrite allocation when the parent trace is present in the destination folder.");
  assert.ok(fileOperationsSource.includes("tryExtractTraceableReferenceFileName") && fileOperationsSource.includes("destinationParentPath") && fileOperationsSource.includes("parentPathOverride") && fileOperationsSource.includes("const resolvedParentPath = resolveTraceableParentReferenceWithArtifactFallback(input.sourcePath, parsedState.result, parentReference);") && fileOperationsSource.includes("const inferredParentLineageLabel = tryGetTraceableParentLineageLabel(parsedFileName.lineageLabel);") && fileOperationsSource.includes("const inferredParentFileName = inferredParentLineageLabel") && fileOperationsSource.includes("const detachedOriginalTargetPath = path.join(") && fileOperationsSource.includes("const shouldPreserveDetachedOriginalLineage = Boolean(") && fileOperationsSource.includes("shouldAllocateUnderParent ? destinationParentParts?.lineageLabel : (resolvedParentParts?.lineageLabel ?? inferredParentLineageLabel)") && fileOperationsSource.includes("const originalTargetPath = shouldAllocateUnderParent") && fileOperationsSource.includes("const shouldReclaimOriginalLineageSlot = Boolean(") && fileOperationsSource.includes("? parsedFileName.lineageLabel"), "Traceable file-operations source should recover rewrite parent linkage from referenced, anchored, or lineage-inferred parent traces when detached standalone moves return to a folder that already contains the earlier parent trace, while preserving a free detached original lineage label when no destination parent exists.");
  assert.ok(fileOperationsSource.includes("planTraceableStandaloneMoveReturnDisplacementMoves") && fileOperationsSource.includes("const displacedRootLabel = `${destinationNode.parsedFileName.lineageLabel}-1`;") && fileOperationsSource.includes("parentPathOverride: normalizePathKey(plan.oldPath) === destinationPathKey ? input.destinationPath : undefined"), "Traceable file-operations source should stage a destination-subtree displacement when a returning standalone move reclaims its original lineage slot from a rebased replacement.");
  assert.ok(fileOperationsSource.includes("collectTraceableArtifactAnchorPaths") && fileOperationsSource.includes("resolveTraceableParentReferenceWithArtifactFallback"), "Traceable file-operations source should recover parent linkage from persisted artifact anchors when older move rewrites leave parentTracePath stale relative to the file's current folder.");
  assert.ok(fileOperationsSource.includes("computeStoredParentTracePath"), "Traceable file-operations source is missing parentTracePath rewrite support.");
  assert.ok(fileOperationsSource.includes("input.parentPathOverride === null") && fileOperationsSource.includes("continuedFromParent: Boolean(nextStoredParentTracePath || nextParentOrigin)") && fileOperationsSource.includes("parentTracePath: _ignoredParentTracePath,") && fileOperationsSource.includes("parentCreatedAt: _ignoredParentCreatedAt,") && fileOperationsSource.includes("parentOrigin: _ignoredParentOrigin,") && fileOperationsSource.includes('parentPathOverride: shouldAllocateUnderParent ? destinationParentPath : undefined') && !fileOperationsSource.includes('parentPathOverride: shouldAllocateUnderParent ? destinationParentPath : null'), "Traceable file-operations source should preserve a resolvable parent continuation during alone rewrite transfers when the destination does not carry a parent trace, while still supporting explicit parent detachment through the null override path when a caller intentionally clears it.");
  assert.ok(fileOperationsSource.includes("rewriteStoredRequestSummaryForMove") && fileOperationsSource.includes("renderEvidenceMarkdown(nextSnapshot") && fileOperationsSource.includes("renderTraceableSubagentMarkdown(finalizedResult") && fileOperationsSource.includes("evidenceFile: { ...nextEvidenceFile, outputMode }"), "Traceable file-operations source should fully regenerate moved evidence markdown so visible request-summary and final-output sections stay aligned with rewritten state.");
  assert.ok(fileOperationsSource.includes("edit.renameFile"), "Traceable file-operations source is missing descendant rename support.");
  const traceableSubagentSource = await readFile(path.join(packageRoot, "src", "traceableSubagent.ts"), "utf8");
  const traceableEvidenceSource = await readFile(path.join(packageRoot, "src", "traceableEvidence.ts"), "utf8");
  assert.ok(traceableSubagentSource.includes('const TRACEABLE_PREVIEW_MAX_BYTES_SETTING = "traceablePreviewMaxBytes";') && traceableSubagentSource.includes('boundTraceablePreviewBlock') && traceableSubagentSource.includes('<truncated due to file size being ${originalBytes} bytes and max configured was ${maxBytes} bytes>') && !traceableSubagentSource.includes('Preview bounded for chat readability.'), "Traceable subagent source should gate preview blocks by configured byte size and replace oversized blocks with an explicit whole-block truncation marker.");
  assert.ok(traceableSubagentSource.includes("resolveValidatedTraceableParentRoles"), "Traceable subagent source is missing parentRoles catalog validation.");
  assert.ok(traceableSubagentSource.includes('const maxToolCalls = Number.isInteger(input.budgetPolicy?.maxToolCalls) && (input.budgetPolicy?.maxToolCalls ?? 0) >= 0') && traceableSubagentSource.includes('const toolSelectionBudgetZero = budgetPolicy.maxToolCalls <= 0;') && traceableSubagentSource.includes('const selectedTools = toolSelectionBudgetZero || forceToolFreeDirectResponse') && traceableSubagentSource.includes('toolSelectionBudgetZero,') && traceableSubagentSource.includes('? []') && traceableSubagentSource.includes(': selectTraceableSubagentTools(vscode.lm.tools,') && traceableSubagentSource.includes('if (!toolSelectionBudgetZero && !forceToolFreeDirectResponse && selectedToolNames.length === 0'), "Traceable subagent source should honor explicit maxToolCalls=0, avoid exposing any tools on tool-free runs, and not fail tool selection just because the role declares tools.");
  assert.ok(traceableSubagentSource.includes('function isLightweightConversationalDirectTurn(input: TraceableSubagentInput)') && traceableSubagentSource.includes('const forceToolFreeDirectResponse = isLightweightConversationalDirectTurn(input);') && traceableSubagentSource.includes('normalized.length > 160') && traceableSubagentSource.includes('input.parentExpectations?.expectedToolFamilies?.length') && traceableSubagentSource.includes('const selectedTools = toolSelectionBudgetZero || forceToolFreeDirectResponse') && traceableSubagentSource.includes('if (!toolSelectionBudgetZero && !forceToolFreeDirectResponse && selectedToolNames.length === 0'), "Traceable subagent source should force lightweight conversational DIRECT turns onto a tool-free request surface using structural routing rather than a greeting wordlist, and avoid misclassifying that path as missing tools.");
  assert.ok(traceableSubagentSource.includes('normalized.startsWith("Continuation role referent:")') && traceableSubagentSource.includes('merged.findIndex((value) => value.startsWith("Continuation role referent:"))') && traceableSubagentSource.includes('merged.splice(existingIndex, 1);'), "Traceable carried reductions should replace older continuation role referents with the newest one instead of keeping contradictory sender-vs-agent referent hints alive across the chain.");
  assert.ok(traceableSubagentSource.includes('requestRouting?: {') && traceableSubagentSource.includes('const routingNote = toolSelectionBudgetZero') && traceableSubagentSource.includes('routingNote') && traceableSubagentSource.includes('requestRouting: {') && traceableSubagentSource.includes('mode: routingMode,'), "Traceable subagent source should persist explicit request-routing rationale and expose the chosen routing note to the live status header.");
  assert.ok(traceableEvidenceSource.includes('## Request Routing') && traceableEvidenceSource.includes('runtimeDecision.requestRouting') && traceableEvidenceSource.includes('Routing Mode:'), "Traceable evidence source should render the persisted request-routing decision in both runtime-decision and timeline views.");
  assert.ok(traceableSubagentSource.includes('const canSalvagePlainTextReply = Boolean(trimmed)') && traceableSubagentSource.includes('&& toolCalls.length === 0') && traceableSubagentSource.includes('&& allowedToolNames.length === 0;') && traceableSubagentSource.includes('The child returned a usable plain-text reply but omitted the required final JSON object, so TRACEABLE salvaged the reply as a partial completion.'), "Traceable subagent source should salvage plain-text replies from tool-free communication runs when the child misses the final JSON wrapper.");
  assert.ok(traceableSubagentSource.includes('modelDisplayName: extra.modelDisplayName ?? formatTraceableModelIdDisplayName(extra.model?.id),'), "Traceable fallback results should preserve the same human-readable model display name across failed or incomplete finalization paths.");
  assert.ok(traceableSubagentSource.includes("Traceable parent role") && traceableSubagentSource.includes("known traceable agent display name"), "Traceable subagent source is missing a truthful parentRoles validation error.");
  assert.ok(traceableSubagentSource.includes("Parent roles for the incoming turn:"), "Traceable subagent source is missing prompt-side parentRoles grounding.");
  assert.ok(traceableSubagentSource.includes('description: catalogEntry?.description') && traceableSubagentSource.includes('await listTraceableAgentCatalogEntries()') && traceableSubagentSource.includes('use that grounded role metadata before generic inference when explaining what that sender-side role is for or what it means'), "Traceable subagent source should ground sender-side role explanations in resolved parent-role metadata instead of only parent-role display names.");
  assert.ok(traceableSubagentSource.includes("senderAdaptationObservations") && traceableSubagentSource.includes("mergeTraceableSenderAdaptationState"), "Traceable subagent source is missing sender adaptation observation merge wiring.");
  assert.ok(traceableSubagentSource.includes("Sender-adaptation rule:"), "Traceable subagent source is missing prompt-side sender adaptation guidance.");
  assert.ok(traceableSubagentSource.includes("emit fresh bounded senderAdaptationObservations for the changed keys") && traceableSubagentSource.includes("Conflict example:") && traceableSubagentSource.includes("give a more expanded explanation") && traceableSubagentSource.includes("User asked for a more expanded explanation."), "Traceable subagent source is missing the carried-state conflict example for sender adaptation emission.");
  assert.ok(traceableSubagentSource.includes("getTrimmedString(entry.senderId) ?? getTrimmedString(entry.sender)") && traceableSubagentSource.includes("inferTraceableSenderAdaptationClaimsFromObservationText") && traceableSubagentSource.includes("getTraceableSenderObservationText"), "Traceable subagent source is missing tolerant sender adaptation salvage for common live child-output aliases.");
  assert.ok(traceableSubagentSource.includes("Array.isArray(entry.observations)") && traceableSubagentSource.includes("const rawClaimEntries = Array.isArray(entry.claims)"), "Traceable subagent source is missing object-array observation alias support for continued sender adaptation payloads.");
  assert.ok(traceableSubagentSource.includes("function deriveTraceableSenderAdaptationObservationsFromCurrentTurn(") && traceableSubagentSource.includes("deriveTraceableSenderAdaptationObservationsFromCurrentTurn(input.userInput, normalizedParentRoles)") && traceableSubagentSource.includes("const senderAdaptationObservations = combineTraceableSenderAdaptationObservations({"), "Traceable subagent source is missing current-turn fallback derivation for sender adaptation observations.");
  assert.ok(traceableSubagentSource.includes("function combineTraceableSenderAdaptationObservations(") && traceableSubagentSource.includes("explicitObservations: parsedPayload.senderAdaptationObservations ?? []") && traceableSubagentSource.includes("inferredObservations: deriveTraceableSenderAdaptationObservationsFromCurrentTurn(input.userInput, normalizedParentRoles)"), "Traceable subagent source is missing sender adaptation observation combination for partial child emissions.");
  assert.ok(traceableSubagentSource.includes("function buildTraceableContinuationRoleReferentReductions(") && traceableSubagentSource.includes("Continuation role referent: the immediately previous turn asked about the sender-side role") && traceableSubagentSource.includes("Carry reductions for this run:") && traceableSubagentSource.includes("When the current follow-up uses ambiguous anaphora such as \\\"den rollen\\\", \\\"that role\\\", or \\\"the role\\\""), "Traceable subagent source is missing carried role-referent continuity guidance for ambiguous follow-up turns.");
  assert.ok(traceableSubagentSource.includes('/\\bvem\\s+är\\s+jag\\b/u.test(normalized)') && traceableSubagentSource.includes('/\\bwho\\s+am\\s+i\\b/u.test(normalized)') && traceableSubagentSource.includes('/\\bvem\\s+är\\s+du\\b/u.test(normalized)') && traceableSubagentSource.includes('/\\bwho\\s+are\\s+you\\b/u.test(normalized)'), "Traceable continuation role referent inference should carry sender-vs-agent identity across identity questions like 'Who am I?' and 'Who are you?' in both English and Swedish.");
  assert.ok(traceableSubagentSource.includes('do not use it to override an explicit first-person sender-side question such as \\\"my role\\\" when parentRoles are present') && traceableSubagentSource.includes('If the current userInput explicitly asks about the sender-side role in first-person terms such as \\\"my role\\\"') && traceableSubagentSource.includes('Do not let a carried reduction override an explicit first-person sender-side role question such as \\\"my role\\\" or \\\"min roll\\\" when parentRoles are present.'), "Traceable subagent source should prefer sender-side parentRoles over carried lane-role reductions for explicit first-person role questions.");
  assert.ok(traceableSubagentSource.includes("Preferred shape example:") && traceableSubagentSource.includes("Asked for a brief direct recommendation.") && traceableSubagentSource.includes("Asked for tradeoffs explicitly."), "Traceable subagent source is missing the concrete sender adaptation shape example for reliable emission.");
  assert.ok(traceableSubagentSource.includes("const senderAdaptationObservations = normalizeTraceableSenderAdaptationObservations(value.senderAdaptationObservations);") && traceableSubagentSource.includes("senderAdaptationObservations,") && traceableSubagentSource.includes("carryStateDisposition,"), "Traceable subagent source is missing sender adaptation and carry-state preservation in salvaged child payloads.");
  const panelSource = await readFile(path.join(packageRoot, "src", "traceableSubagentStatusPanel.ts"), "utf8");
  assert.ok(panelSource.includes("export function renderTraceableSubagentPanelHtml"), "Traceable panel source is missing the restored committed viewer renderer.");
  assert.ok(panelSource.includes('event-request-heading-row') && !panelSource.includes('event-request-inline-chips') && panelSource.includes('${summaryMarkup}${metadataInlineMarkup}</div>') && panelSource.includes('<div class="event-body event-request-body"><div class="event-main event-request-heading-row">'), "Traceable request activities should render request badges as direct heading-row items so they wrap more like inline text than a nested badge block.");
  assert.ok(panelSource.includes("hideToolbarControls"), "Traceable panel source is missing the restored viewer toolbar-control behavior.");
  assert.ok(panelSource.includes("tiinex.aiProvenance.traceableStatus"), "Traceable panel source is missing the provenance panel view id.");
  assert.ok(panelSource.includes("type PanelOpenFilePayload ="), "Traceable panel source is missing the clearer open-file payload union.");
  assert.ok(panelSource.includes("baseDir?: string;") && panelSource.includes("baseDir: evidenceFilePath ? path.dirname(evidenceFilePath) : undefined") && panelSource.includes('if (normalizedLabel === "parent trace") {') && panelSource.includes("buildPanelOpenFilePayload("), "Traceable panel source should preserve the current evidence-file baseDir when Parent Trace and other relative path badges open moved TRACEABLE files.");
  assert.ok(panelSource.includes("ancestorGroupOpenById"), "Traceable panel source is missing persisted Earlier Trace disclosure state.");
  assert.ok(panelSource.includes("renderAncestorSummaryActionIcon"), "Traceable panel source is missing latest-step icon rendering for Earlier Trace summaries.");
  assert.ok(panelSource.includes("renderAncestorStatusChip"), "Traceable panel source is missing trace-status-aligned Earlier Trace badges.");
  assert.ok(panelSource.includes("buildActivityEntries(lineageSnapshot).filter((activity) => activity.kind !== \"ancestor\")"), "Traceable panel source is missing full activity-pipeline rendering for Earlier Trace expansions.");
  assert.ok(panelSource.includes("extractOutputEvidencePaths"), "Traceable panel source is missing structured output evidence extraction for expanded Output rows.");
  assert.ok(panelSource.includes("activity-request-badge-inherited"), "Traceable panel source is missing inherited-parameter badge styling for continuation summaries.");
  assert.ok(panelSource.includes("nextSuggestedStart"), "Traceable panel source is missing structured handoff detail rendering for expanded Handoff rows.");
  assert.ok(panelSource.includes('"loadToolDetail"'), "Traceable panel source is missing the on-demand tool-detail fetch message wiring.");
  assert.ok(panelSource.includes("loadedToolDetailsByCallId"), "Traceable panel source is missing cached loaded tool-detail state for expanded tool rows.");
  assert.ok(panelSource.includes("renderToolRawDisclosure"), "Traceable panel source is missing secondary raw input/output disclosures for tool rows.");
  assert.ok(panelSource.includes("isNestedInteractiveTarget") && panelSource.includes("target.closest('[data-message], button, a, summary, input, textarea, label')") && !panelSource.includes("target.closest('[data-message], button, a, summary, details, input, textarea, label')"), "Traceable panel source should keep the nested-interaction guard without blocking request toggles inside Earlier Trace details groups.");
  assert.ok(panelSource.includes("No persisted tool output is available for this call in the current trace view."), "Traceable panel source is missing a visible fallback when evidence views do not contain persisted tool output.");
  assert.ok(panelSource.includes("event-tool-main-toggle"), "Traceable panel source is missing an explicit main toggle control for tool rows.");
  assert.ok(panelSource.includes("data-tool-output-disclosure=\"true\""), "Traceable panel source is missing dedicated output disclosures for tool rows.");
  assert.ok(panelSource.includes("data-tool-input-disclosure=\"true\""), "Traceable panel source is missing dedicated input disclosures for tool rows.");
  assert.ok(panelSource.includes("requestToolOutputLoad"), "Traceable panel source is missing auto-load behavior when tool output disclosures open.");
  assert.ok(panelSource.includes("renderJsonHighlightedMarkup"), "Traceable panel source is missing syntax-highlighted JSON rendering for tool data.");
  assert.ok(panelSource.includes("Loading output..."), "Traceable panel source is missing a visible loading state while tool output is being fetched.");
  assert.ok(panelSource.includes("event-tool-section-copy"), "Traceable panel source is missing copy controls for tool input/output disclosures.");
  assert.ok(panelSource.includes("renderRequestDetailSection(\"Kind\", detail.outputKind.trim())"), "Traceable panel source is missing output-kind rendering for typed persisted tool output.");
  assert.ok(panelSource.includes('function formatPanelRequestSummaryCompactValue(item: PanelRequestSummaryItem): string {') && panelSource.includes('function formatPanelRequestSummaryCompactLabel(item: PanelRequestSummaryItem): string {') && panelSource.includes('case "parent trace":') && panelSource.includes('case "parent roles":') && panelSource.includes('case "context in":') && panelSource.includes('case "inherited":') && panelSource.includes('const compactLabel = formatPanelRequestSummaryCompactLabel(item);') && panelSource.includes('return renderHeaderBadge(compactLabel, formatPanelRequestSummaryCompactValue(item), "activity-request-badge", item.title);'), "Traceable panel source should compact long request badge labels and Parent Roles values while keeping the full tooltip content intact.");
  assert.ok(panelSource.includes('function requestSummaryInlineBadgePriority(item: PanelRequestSummaryItem): number {') && panelSource.includes('if (normalizedLabel === "parent roles") {') && panelSource.includes('return compactValue.length <= 20 ? 2 : 3;') && panelSource.includes('compactLength: formatPanelRequestSummaryCompactValue(item).replace(/\\s+/gu, " ").trim().length') && panelSource.includes('left.compactLength - right.compactLength') && panelSource.includes('const orderedMetadata = orderRequestSummaryItemsForInlineFlow([...prominentMetadata, ...secondaryMetadata]);') && panelSource.includes('<div class="event-body event-request-body"><div class="event-main event-request-heading-row">') && panelSource.includes('.event-request-body {') && panelSource.includes('display: grid;') && panelSource.includes('.event-request-heading-row {') && panelSource.includes('display: flex;') && panelSource.includes('flex-wrap: wrap;') && panelSource.includes('align-content: flex-start;') && panelSource.includes('.event-request .event-summary-inline {') && panelSource.includes('flex: 0 1 auto;') && panelSource.includes('max-width: min(100%, 38rem);') && panelSource.includes('.event-request-heading-row > .activity-request-badge {') && panelSource.includes('flex: 0 1 auto;') && panelSource.includes('.event-request .event-summary-inline + .activity-request-badge,') && panelSource.includes('margin-left: auto;'), "Traceable panel source should keep request badges in the same wrap flow while anchoring the first badge to the right edge of the heading row.");
  assert.ok(panelSource.includes("renderRequestDetailSection(\"Data\", detail.outputMetadataSummary.trim())"), "Traceable panel source is missing metadata rendering for data-like tool outputs.");
  assert.ok(panelSource.includes("data-copy-source-id"), "Traceable panel source is missing source-targeted copy wiring for large tool values.");
  assert.ok(panelSource.includes("navigator.clipboard?.writeText"), "Traceable panel source is missing direct clipboard support for copied tool values.");
  assert.ok(panelSource.includes("disclosure.dataset.toolOutputNeedsLoad !== 'true'"), "Traceable panel source should not reopen output disclosures that would auto-load on initial render or reopen.");
  assert.ok(panelSource.includes("disclosure.dataset.toolOutputArmed !== 'true'"), "Traceable panel source should require explicit user interaction before output loading starts.");
  assert.ok(panelSource.includes("event-tool-loading-fallback"), "Traceable panel source is missing a fallback message when tool output loading stalls.");
  assert.ok(panelSource.includes("max-height: calc(20 * 1.45em + 18px)"), "Traceable panel source should cap large input/output blocks to about 20 lines before scrolling.");
  assert.ok(panelSource.includes("white-space: pre;"), "Traceable panel source should preserve raw input/output formatting and rely on scroll instead of wrapping-truncation behavior.");
  assert.ok(panelSource.includes("<span class=\"event-tool-section-summary-label\">${escapeHtml(label)}</span><span class=\"event-expand-indicator\""), "Traceable panel source should keep the disclosure twistie adjacent to the section label.");
  assert.ok(panelSource.includes("No persisted tool output is available for this call in the current trace view."), "Traceable panel source is missing the truthful persisted-output fallback for trace views.");
  assert.ok(panelSource.includes("event-tool.tool-expanded .event-meta-chips"), "Traceable panel source should hide tool and parameter chips when an expanded tool row already shows those details.");
  assert.ok(panelSource.includes("includeDurationChip: event.count > 1"), "Traceable panel source should avoid duplicate duration badges for single tool calls.");
  assert.ok(panelSource.indexOf('"Input"') < panelSource.indexOf('renderToolOutputDetail(event, detail)'), "Traceable panel source should render tool input before tool output in expanded tool details.");
  assert.ok(panelSource.includes("data-ancestor-group-id"), "Traceable panel source is missing ancestor-group identity for persisted disclosure state.");
  assert.ok(panelSource.includes("describePathChipAction"), "Traceable panel source is missing descriptive path-chip action copy.");
  assert.ok(panelSource.includes("Open or reveal from workspace context"), "Traceable panel source is missing workspace-context path-chip guidance.");
  assert.ok(panelSource.includes("Reveal in Windows File Explorer"), "Traceable panel source is missing external Windows explorer path-chip guidance.");
  assert.ok(panelSource.includes("data-chat-toggle=\"true\""), "Traceable panel source is missing the chat-view toolbar toggle.");
  assert.ok(panelSource.includes("panel-root.chat-view-active"), "Traceable panel source is missing the chat-view projection styling hook.");
  assert.ok(panelSource.includes("data-chat-composer=\"true\""), "Traceable panel source is missing the bottom chat composer wiring.");
  assert.ok(panelSource.includes('chatCollapseMode?: "auto" | "always";') && panelSource.includes('const chatCollapseMode = options.chatCollapseMode === "always" ? "always" : "auto";') && panelSource.includes('data-chat-collapse-mode="${escapeHtml(chatCollapseMode)}"') && panelSource.includes('data-chat-input-compact="true"') && panelSource.includes('const CHAT_COMPOSER_COMPACT_HEIGHT_THRESHOLD_PX = 430;') && panelSource.includes('const resolveChatComposerCollapsed = () => {') && panelSource.includes('const getActiveChatInputControl = () => {') && panelSource.includes('const applyChatComposerCollapseState = () => {') && panelSource.includes("chatComposer.dataset.chatComposerCollapsed = collapsed ? 'true' : 'false';") && panelSource.includes('.chat-composer[data-chat-composer-collapsed="true"] .chat-composer-input {') && panelSource.includes('.chat-composer[data-chat-composer-collapsed="true"] .chat-composer-compact-input {') && panelSource.includes('if (chatCompactInput instanceof HTMLInputElement) {') && panelSource.includes('handleChatComposerInput(chatCompactInput.value);'), "Traceable panel source should support an auto/always compact chat composer with a single-line input that shares draft, focus, and send behavior with the textarea composer.");
  assert.ok(panelSource.includes('.chat-composer[data-chat-composer-collapsed="true"] .chat-composer-actions {') && panelSource.includes('flex-wrap: nowrap;') && panelSource.includes('justify-content: flex-start;') && panelSource.includes('.chat-composer[data-chat-composer-collapsed="true"] .chat-composer-submit-controls {') && panelSource.includes('min-width: max-content;') && panelSource.includes('.chat-composer[data-chat-composer-collapsed="true"] .chat-composer-sender-toggle {') && panelSource.includes('min-width: min(10rem, 30vw);'), "Traceable panel source should keep the compact input on the same row by letting it absorb remaining width while the sender controls shrink within bounded space.");
  assert.ok(panelSource.includes("data-chat-sender-role=\"true\""), "Traceable panel source is missing the sender-role dropdown wiring.");
  assert.ok(panelSource.includes("Sender role behind the current text, not the recipient agent role."), "Traceable panel source is missing the sender-role tooltip copy.");
  assert.ok(panelSource.includes("data-chat-sender-menu=\"true\"") && panelSource.includes("chat-composer-sender-option"), "Traceable panel source is missing the custom themed sender dropdown menu.");
  assert.ok(panelSource.includes("buildSenderAdaptationActivity") && panelSource.includes("renderSenderAdaptationActivity") && panelSource.includes("Sender State"), "Traceable panel source is missing sender adaptation detailed-view observability.");
  assert.ok(panelSource.includes("message.type === \"submitChatTurn\""), "Traceable panel source is missing the panel-side submitChatTurn message handling.");
  assert.ok(panelSource.includes("Chat composer requires a saved TRACEABLE evidence file for continuation."), "Traceable panel source is missing the truthful disabled-state hint for chat continuation.");
  assert.ok(panelSource.includes('const evidenceFileStatus = snapshot.evidenceFile?.status;') && panelSource.includes('const canSubmit = traceFilePath.length > 0 && !running;') && panelSource.includes('      ? "Please wait"') && panelSource.includes('      : evidenceFileStatus && evidenceFileStatus !== "ready"'), "Traceable panel source should allow continuation send for saved settled traces even when persisted evidence status lags behind as writing, while still showing the export wait hint during active runs.");
  assert.ok(panelSource.includes('const exportStillLive = evidenceFile?.status === "writing" && snapshot.status.phase === "running";') && panelSource.includes('if (evidenceFile.status === "ready" || evidenceFile.status === "writing") {'), "Traceable panel source should only keep live export styling while the snapshot is actually running and should treat post-run writing state as ready for toolbar UX.");
  assert.ok(panelSource.includes("snapshot.startedAt === this.snapshot.startedAt") && panelSource.includes("nextUpdatedAtMs < currentUpdatedAtMs"), "Traceable panel source is missing the stale-snapshot guard for same-run async updates.");
  assert.ok(panelSource.includes("showChatToggle?: boolean;"), "Traceable panel source is missing the explicit chat-toggle render option.");
  assert.ok(panelSource.includes("const showChatToggle = options.showChatToggle !== false;"), "Traceable panel source should keep the chat toggle available by default across renderer surfaces.");
  assert.ok(panelSource.includes("initialChatViewEnabled?: boolean;"), "Traceable panel source is missing the initial chat-view render option.");
  assert.ok(panelSource.includes("const initialChatViewEnabled = options.initialChatViewEnabled === true;"), "Traceable panel source should honor an initial chat-view render hint.");
  assert.ok(panelSource.includes("interface PanelChatSenderRoleOption") && panelSource.includes("chatSenderRoleOptions?: ReadonlyArray<PanelChatSenderRoleOption>;") && panelSource.includes("defaultChatSenderRole?: string;"), "Traceable panel source is missing the sender-role render options.");
  assert.ok(panelSource.includes("chatViewEnabled: ${initialChatViewEnabled ? \"true\" : \"false\"},"), "Traceable panel source should seed chat view from the initial render hint for new editor-hosted continuations.");
  assert.ok(panelSource.includes("grid-template-rows: minmax(0, 1fr) auto;"), "Traceable panel source should constrain chat view so the thread owns the scrollable 1fr area above the composer.");
  assert.ok(panelSource.includes(".panel-root.chat-view-active {") && panelSource.includes("height: calc(100vh - 18px);") && panelSource.includes("overflow: hidden;") && panelSource.includes(".panel-root.chat-view-active .chat-view {") && panelSource.includes(".chat-view {") , "Traceable panel source should hard-constrain chat view layout so the outer document stops stealing scroll from the chat thread.");
  assert.ok(panelSource.includes("renderChatProjectionAncestorMessage"), "Traceable panel source should render earlier traces inside chat view.");
  const detailSource = await readFile(path.join(packageRoot, "src", "traceableSubagentStatusDetail.ts"), "utf8");
  assert.ok(detailSource.includes("snapshot.startedAt === this.snapshot.startedAt") && detailSource.includes("nextUpdatedAtMs < currentUpdatedAtMs"), "Traceable detail source is missing the stale-snapshot guard for same-run async updates.");
  assert.ok(detailSource.includes("environment?: {") && detailSource.includes("repoRootSnapshotPath?: string;"), "Traceable detail snapshot type should expose the optional repo-root snapshot metadata carried in Traceable State.");
  assert.ok(panelSource.includes("renderChatTraceSeparator(entry.title, entry.filePath, true)") && panelSource.includes("renderChatTraceSeparator(snapshot.evidenceFile.fileName.trim(), snapshot.evidenceFile.filePath, false)"), "Traceable panel source should keep ancestor trace separators clickable while leaving the current trace separator static.");
  assert.ok(panelSource.includes('label: "Task"'), "Traceable panel source should render task input as a compact Task chat row.");
  assert.ok(panelSource.includes('return directParentRoles.length > 0 ? directParentRoles.join(", ") : "User";'), "Traceable panel source should label the primary prompt row with one or more direct parent role names and fall back to User.");
  assert.ok(panelSource.includes('function extractDirectParentRolesFromRequestSummary(summary: PanelRequestSummaryItem[]): string[] {') && panelSource.includes('.split(/[·,]/u)') && panelSource.includes('return explicitRoles;'), "Traceable panel source should support comma-separated multi-role DIRECT parentRoles labels from both expanded and compact request-summary forms.");
  assert.ok(panelSource.includes('function formatChatProjectionOutputLabel(') && panelSource.includes('return displayRole && displayRole.toLowerCase() !== "trace lane" ? displayRole : "Output";'), "Traceable panel source should label output rows with the speaking role when one is available and fall back to Output.");
  assert.ok(panelSource.includes("const previewSource = userInput ?? task;") && panelSource.includes("const noteText = summarizeChatProjectionText(userInput?.title)") && panelSource.includes("|| summarizeChatProjectionText(task?.title)") && panelSource.includes('|| "Compact launch parameters for this trace lane.";'), "Traceable panel source should make Input activity previews prefer User Input text, then Parent Task text, before falling back to generic launch parameters.");
  assert.ok(panelSource.includes('label: userInputLabel,') && panelSource.includes('occurredAt: snapshot.startedAt,') && !panelSource.includes('label: userInputLabel,\n      text: userInput,\n      role: "input",\n      occurredAt: snapshot.startedAt,\n      updatedAt: snapshot.updatedAt,'), "Traceable panel source should timestamp settled input rows from their own occurredAt rather than the final output updatedAt.");
  assert.ok(panelSource.includes("chat-trace-separator-title"), "Traceable panel source should style trace separators distinctly from message rows.");
  assert.ok(panelSource.includes("data-message='${escapeHtml(JSON.stringify({ type: \"openFile\", filePath: filePath.trim() }))}'"), "Traceable panel source should make trace separator titles clickable open-file targets.");
  assert.ok(panelSource.includes(".chat-trace-separator::before {"), "Traceable panel source should render a single divider line behind the trace separator title.");
  assert.ok(panelSource.includes("data-chat-timestamp=\"true\""), "Traceable panel source should render per-row chat timestamps beside message headers.");
  assert.ok(panelSource.includes("formatChatHeaderTimestamp"), "Traceable panel source should format chat-header timestamps with running and settled modes.");
  assert.ok(panelSource.includes("return formatPanelClockTime(updatedAt || occurredAt);") && !panelSource.includes("return formatPanelMinuteClockTime(updatedAt || occurredAt);"), "Traceable panel source should keep settled chat timestamps at second resolution so nearby input/output rows do not collapse to the same visible minute.");
  assert.ok(panelSource.includes("const formatFixedClockLabel = (value) => {") && panelSource.includes("second: '2-digit',"), "Traceable panel source should preserve second precision when hydrated chat timestamps are recomputed client-side.");
  assert.ok(panelSource.includes("var(--vscode-terminal-ansiGreen) 12%"), "Traceable panel source should give user-input rows a distinct green tone.");
  assert.ok(panelSource.includes("background: var(--bg);"), "Traceable panel source should keep the sticky chat composer visually opaque.");
  assert.ok(panelSource.includes("data-chat-base-disabled=\"${canSubmit ? \"false\" : \"true\"}\""), "Traceable panel source should persist the base composer disabled state in the DOM.");
  assert.ok(panelSource.includes("let chatSubmitPending = false;"), "Traceable panel source should track a pending chat-send lock.");
  assert.ok(panelSource.includes('function comparePanelChatSenderRoleOptions(left: PanelChatSenderRoleOption, right: PanelChatSenderRoleOption): number {') && panelSource.includes('? [...options.chatSenderRoleOptions].sort(comparePanelChatSenderRoleOptions)') && panelSource.includes("function extractDirectParentRolesFromRequestSummary(summary: PanelRequestSummaryItem[]): string[] {") && panelSource.includes("Declared input mode:\\s*DIRECT\\b") && panelSource.includes("function normalizePanelChatSenderRoleIdentity(value: string): string {") && panelSource.includes("function resolveAvailableChatSenderRoleValue(") && panelSource.includes("return identityMatches.length > 0 ? identityMatches[0].value : undefined;") && panelSource.includes("const previousDirectParentRole = extractDirectParentRolesFromRequestSummary(snapshot.requestSummary)[0];") && panelSource.includes("const resolvedPreviousDirectParentRole = resolveAvailableChatSenderRoleValue(previousDirectParentRole, chatSenderRoleOptions);") && panelSource.includes("chatSenderRole: ${JSON.stringify(initialChatSenderRole)}"), "Traceable panel source should sort sender-role options locally before rendering and derive the initial sender role from the first previous DIRECT parent role before falling back to the configured default, preferring the first ranked visible option when multiple variants share the same simplified role identity.");
  assert.ok(panelSource.includes("const normalizePanelChatSenderRoleIdentity = (value) => {") && panelSource.includes("value.replace(/\\s*\\([^)]*\\)\\s*/gu, ' ').trim().normalize('NFKC').toLowerCase()") && panelSource.includes("const reconcileRestoredChatSenderRole = (value) => {") && panelSource.includes("const preferredDefaultValue = typeof defaultPanelState.chatSenderRole === 'string'") && panelSource.includes("if (restoredIdentity && preferredIdentity && restoredIdentity === preferredIdentity) {") && panelSource.includes("chatSenderRole: reconcileRestoredChatSenderRole(state.chatSenderRole),"), "Traceable panel source should embed the sender-role identity normalizer in the webview script before restored-state reconciliation so the panel does not crash before click handlers bind.");
  assert.ok(panelSource.includes("persistPanelState({ chatSenderRole: option.dataset.value || '' });"), "Traceable panel source is missing sender-role state persistence.");
  assert.ok(panelSource.includes("chatComposerFocused: false,") && panelSource.includes("restoreChatComposerFocusOnRunChange: false,") && panelSource.includes("chatViewEnabled: restoreChatComposerFocusOnRunChange ? true : defaultPanelState.chatViewEnabled,") && panelSource.includes("if (panelState.restoreChatComposerFocusOnRunChange === true) {") , "Traceable panel source should preserve chat view and restore composer focus across run changes only when the composer owned focus before the new run replaced the current snapshot.");
  assert.ok(panelSource.includes("let suppressScrollStateSync = false;"), "Traceable panel source should suppress transient scroll-state writes while chat view activation is settling.");
  assert.ok(panelSource.includes("const CHAT_SCROLL_INTENT_WINDOW_MS = 1200;") && panelSource.includes("let lastManualChatScrollIntentAt = 0;") && panelSource.includes("const markManualChatScrollIntent = () => {") && panelSource.includes("hasRecentManualChatScrollIntent()") && panelSource.includes("panelState.chatViewEnabled === true && panelState.followLatest === true && !nearBottom && !hasRecentManualChatScrollIntent()"), "Traceable panel source should only let explicit recent user scroll intent break chat follow-latest during restore and layout settling.");
  assert.ok(panelSource.includes("chatSendButton.textContent = chatSubmitPending ? 'Sending...' : 'Send';"), "Traceable panel source should surface a pending send state in the composer.");
  assert.ok(panelSource.includes("chatInput.readOnly = false;"), "Traceable panel source should keep the chat textarea writable while only Send is locked.");
  assert.ok(panelSource.includes("let chatComposerHasFocus = false;") && panelSource.includes("let chatComposerHadFocusBeforeSubmit = false;") && panelSource.includes("let pendingChatComposerAutofocus = false;") && panelSource.includes("persistPanelState({ chatComposerFocused: chatComposerHasFocus });"), "Traceable panel source should track local composer focus ownership before restoring focus after reveals, sends, or run changes.");
  assert.ok(panelSource.includes("const syncChatComposerFocusState = () => {") && panelSource.includes("const requestChatComposerAutofocus = () => {") && panelSource.includes("if (!pendingChatComposerAutofocus) {") , "Traceable panel source should gate composer autofocus behind an explicit local intent flag instead of focusing on every render.");
  assert.ok(panelSource.includes("chatComposerHadFocusBeforeSubmit = document.activeElement === activeInput || chatComposerHasFocus;") && panelSource.includes("if (chatComposerHadFocusBeforeSubmit) {") && panelSource.includes("if (event.data.focusComposer === true) {") , "Traceable panel source should only restore composer focus when the user owned it before submit or the host explicitly requested focus on reveal.");
  assert.ok(panelSource.includes("const focusChatComposerInput = () => {"), "Traceable panel source should expose a dedicated composer autofocus helper.");
  const extensionContinuationSource = await readFile(path.join(packageRoot, "src", "extension.ts"), "utf8");
  assert.ok(extensionContinuationSource.includes('const { parsedState } = await readTraceableEvidenceViewState(resolvedUri);') && extensionContinuationSource.includes('const rawParentRequest = parsedState?.result?.request;') && extensionContinuationSource.includes('typeof rawParentRequest === "object"') && extensionContinuationSource.includes('does not expose a readable request contract.'), "Traceable evidence editor continuation should preflight the currently opened evidence state before starting a follow-up run.");
  assert.ok(extensionContinuationSource.includes('const revealTraceablePanel = async (reason: "auto" | "manual" = "manual", options: { focusComposer?: boolean } = {}): Promise<void> => {') && extensionContinuationSource.includes('await traceableStatusPanel.open({ reason, focusComposer: options.focusComposer === true });') && extensionContinuationSource.includes('revealReason: options.focusComposerOnReveal === true ? "manual" : "auto"') && extensionContinuationSource.includes('focusComposerOnReveal: true'), "Traceable extension source should reserve composer autofocus for explicit user-initiated New/Resume chat flows instead of generic auto-reveal updates.");
  assert.ok(panelSource.includes("const toggleChatView = () => {"), "Traceable panel source should centralize chat-toggle behavior so reload-safe bindings can reuse the same path.");
  assert.ok(panelSource.includes("const coerceBooleanLike = (value, fallback = false) => {"), "Traceable panel source should normalize boolean-like restored state values such as 1/0 and true/false strings.");
  assert.ok(panelSource.includes("function buildRequestActivityId(snapshot: TraceableSubagentDetailSnapshot): string {") && panelSource.includes('return `request-summary:${evidenceKey}`;') && panelSource.includes('id: buildRequestActivityId(snapshot),'), "Traceable panel source should give each snapshot its own request-summary expansion id so Earlier Trace inputs do not share expansion state.");
  assert.ok(panelSource.includes("function formatPanelTimestampForDisplay(") && panelSource.includes("hour12: false") && panelSource.includes('hourCycle: "h23"') && panelSource.includes('return `${formatPanelIsoLocalDate(value)} ${timeLabel}`;'), "Traceable panel source should render panel timestamps in 24-hour time and prefix non-today values with YYYY-MM-DD.");
  assert.ok(panelSource.includes("function formatPanelAbsoluteTimestamp(value: string | undefined, includeSeconds = true): string | undefined {") && panelSource.includes('renderHeaderBadge("Updated", updatedLabel, "header-badge-meta", `Updated ${formatPanelAbsoluteTimestamp(snapshot.updatedAt) || updatedLabel}`)') && panelSource.includes('const title = formatPanelAbsoluteTimestamp(options.updatedAt || options.occurredAt) || formatPanelClockTime(options.updatedAt || options.occurredAt);') && panelSource.includes('title="Started ${escapeHtml(clockTitle || clockLabel)}"'), "Traceable panel source should keep tooltip timestamps as absolute YYYY-MM-DD 24-hour truth-bearers even when visible labels stay compact.");
  assert.ok(panelSource.includes("chatViewEnabled: coerceBooleanLike(state.chatViewEnabled, defaultPanelState.chatViewEnabled)") && panelSource.includes("followLatest: coerceBooleanLike(state.followLatest, true)"), "Traceable panel source should read restored chat booleans through the boolean-like coercion helper and fall back to the configured initial view.");
  assert.ok(panelSource.includes("let initialChatViewApplyPending = true;") && panelSource.includes("requestAnimationFrame(() => {") && panelSource.includes("queueChatViewActivationScroll();"), "Traceable panel source should defer the first restored chat-view activation scroll instead of running it synchronously during initial restore.");
  assert.ok(panelSource.includes("const chatThread = document.querySelector('.chat-thread');"), "Traceable panel source should keep a direct handle to the chat scroll container.");
  assert.ok(panelSource.includes("const getActiveScrollingRoot = () => {") && panelSource.includes("if (eventsList instanceof HTMLElement) {") && panelSource.includes("return eventsList;"), "Traceable panel source should route detailed-view follow-latest through the events scroll container and chat follow-latest through the chat thread.");
  assert.ok(panelSource.includes("chatToggleButton.addEventListener('click', (event) => {") && panelSource.includes("document.addEventListener('click', (event) => {") && !panelSource.includes("document.addEventListener('pointerup'"), "Traceable panel source should keep a valid click-based Detailed toggle path without the broken pointerup fallback.");
  assert.ok(panelSource.includes("const scrollChatComposerIntoView = () => {") && panelSource.includes("chatComposer.scrollIntoView({ block: 'end', inline: 'nearest' });"), "Traceable panel source should anchor chat-bottom scrolling to the composer when chat view is visible.");
  assert.ok(panelSource.includes("const scrollChatThreadToBottom = () => {") && panelSource.includes("chatThread.scrollTop = maxScrollTop;"), "Traceable panel source should drive follow-latest against the dedicated chat-thread scroll container.");
  assert.ok(panelSource.includes("chatThread.addEventListener('scroll', handleActiveScroll, { passive: true });") && panelSource.includes("eventsList.addEventListener('scroll', handleActiveScroll, { passive: true });"), "Traceable panel source should update follow-latest from the dedicated detailed and chat scroll containers as well as window scrolling.");
  assert.ok(panelSource.includes("...(nextChatViewEnabled ? { followLatest: true } : {})"), "Traceable panel source should re-enable follow-latest when chat view is opened.");
  assert.ok(panelSource.includes("if (nextChatViewEnabled) {") && panelSource.includes("scheduleScrollToLatestEvent();"), "Traceable panel source should jump to the latest chat content when chat view opens.");
  assert.ok(panelSource.includes("function queueChatViewActivationScroll() {") && panelSource.includes("persistPanelState({ followLatest: true });"), "Traceable panel source should force follow-latest when chat view becomes visible.");
  assert.ok(panelSource.includes("setTimeout(applyActivationScroll, 320);") && panelSource.includes("setTimeout(applyActivationScroll, 640);"), "Traceable panel source should keep retrying chat-view activation scrolls long enough for restored layout to settle.");
  assert.ok(panelSource.includes("function scheduleScrollToLatestEvent() {"), "Traceable panel source should hoist the latest-scroll scheduler so rehydrated chat views can activate before later declarations are initialized.");
  assert.ok(panelSource.includes("setTimeout(applyScroll, 260);") && panelSource.includes("setTimeout(applyScroll, 520);"), "Traceable panel source should keep late follow-latest retries long enough for restored chat layout to settle.");
  assert.ok(panelSource.includes("const scheduleFollowLatestLayoutSync = () => {") && panelSource.includes("if (pendingFollowLatestLayoutSync || panelState.followLatest !== true) {") && panelSource.includes("if (eventsList instanceof HTMLElement) {") && panelSource.includes("followLatestLayoutObserver.observe(eventsList);") && panelSource.includes("window.addEventListener('resize', () => {"), "Traceable panel source should resync follow-latest for both detailed and chat scroll containers when layout changes after restore.");
  assert.ok(panelSource.includes("const formatFixedClockLabel = (value) => {") && panelSource.includes("const formatIsoLocalDate = (date) =>") && panelSource.includes("hour12: false") && panelSource.includes("hourCycle: 'h23'") && panelSource.includes("return formatIsoLocalDate(timestamp) + ' ' + timeLabel;"), "Traceable panel source should keep client-side chat timestamp refreshes in 24-hour time with YYYY-MM-DD on non-today values.");
  assert.ok(panelSource.includes("if (chatViewEnabled) {") && panelSource.includes("queueChatViewActivationScroll();"), "Traceable panel source should trigger activation scrolling from applyChatViewState.");
  assert.ok(panelSource.includes("followLatest: true,") && panelSource.includes("scrollTop: 0,"), "Traceable panel source should reset follow-latest state when a new TRACEABLE run replaces the current panel snapshot.");
  assert.ok(panelSource.includes("(?:\\.trace\\.md|\\.jsonl|\\.md|\\.json|\\.txt|\\.png|\\.jpe?g|\\.webp|\\.gif|\\.svg|\\.mjs|\\.cjs|\\.js|\\.ts)\\b"), "Traceable panel source should extract output evidence paths only through concrete file suffixes instead of swallowing trailing narrative text.");
  assert.ok(panelSource.includes("const messageTargets = Array.from(document.querySelectorAll('[data-message]'));"), "Traceable panel source should register explicit handlers for data-message targets.");
  assert.ok(panelSource.includes("const dispatchDataMessage = (target) => {"), "Traceable panel source should centralize webview message dispatch for clickable chips and separators.");
  assert.ok(panelSource.includes("const chatToggleTarget = target.closest('[data-chat-toggle=\"true\"]');") && panelSource.includes("toggleChatView();"), "Traceable panel source should support delegated chat-toggle clicks after restore or DOM rehydration.");
  assert.ok(panelSource.includes(".chip-button:hover,") && panelSource.includes("text-decoration: none;"), "Traceable panel source should keep clickable chips in chip styling instead of drawing hyperlink underlines through them.");
  assert.ok(panelSource.includes("if (suppressScrollStateSync) {") && panelSource.includes("return;"), "Traceable panel source should ignore transient scroll events while chat activation scrolling is settling.");
  assert.ok(panelSource.includes("scrollChatComposerIntoView();"), "Traceable panel source should explicitly bring the bottom composer into view when following the latest chat content.");
  assert.ok(panelSource.includes("event?.data?.type === 'chatSubmitState'"), "Traceable panel source is missing webview-side chat submit reset handling.");
  assert.ok(panelSource.includes("<div class=\"chat-thread\">"), "Traceable panel source should wrap chat content in a dedicated scrollable thread container.");
  assert.ok(panelSource.includes(".toolbar-button-chat-toggle {"), "Traceable panel source should define a fixed-width chat toggle style.");
  assert.ok(panelSource.includes("toolbar-button-warning") && panelSource.includes("repairTraceLineage") && panelSource.includes("chat-lineage-banner") && panelSource.includes("chat-trace-separator-title-static"), "Traceable panel source should surface a warning-styled repair affordance, a visible chat broken-lineage banner, and a non-clickable current trace separator.");
  assert.ok(panelSource.includes("min-width: 84px;"), "Traceable panel source should keep Chat and Detailed at a stable width.");
  assert.ok(panelSource.includes(".panel-root {") && panelSource.includes("grid-template-rows: auto auto minmax(0, 1fr);") && panelSource.includes(".events {") && panelSource.includes("min-height: 0;") && panelSource.includes("overflow: auto;") && panelSource.includes("border-radius: 12px;"), "Traceable panel source should give detailed activities their own boxed internal scroll region to match the chat-view scroll model.");
  assert.ok(panelSource.includes(".chat-thread {"), "Traceable panel source should define a dedicated scrollable chat thread.");
  assert.ok(panelSource.includes("overflow: auto;"), "Traceable panel source should make the chat thread independently scrollable.");
  assert.ok(panelSource.includes("metaSection.hidden = false"), "Traceable panel source should keep the header meta badges visible in chat view so header badges do not jump between modes.");
  assert.ok(panelSource.includes("toolsetDisclosure.hidden = chatViewEnabled"), "Traceable panel source should explicitly hide the toolset disclosure in chat view.");
  assert.ok(panelSource.includes("eventsList.hidden = chatViewEnabled"), "Traceable panel source should explicitly hide the event feed in chat view.");
  assert.ok(panelSource.includes("chatViewSection.hidden = !chatViewEnabled"), "Traceable panel source should explicitly reveal the chat projection section in chat view.");
  assert.ok(panelSource.includes(".event-status-group-toggle {") && panelSource.includes("color: color-mix(in srgb, var(--accent) 70%, var(--muted));") && !panelSource.includes(".status-group.status-group-severity-completed .event-status-group-toggle {") && !panelSource.includes(".status-group.status-group-severity-running .event-status-group-toggle {"), "Traceable panel source should keep status-group twisties on the neutral accent tone instead of severity colors.");
  assert.ok(panelSource.includes(".header-top {") && panelSource.includes("grid-template-columns: minmax(0, 1fr) auto;") && panelSource.includes(".title {") && panelSource.includes("flex-wrap: nowrap;") && panelSource.includes("overflow-x: auto;") && panelSource.includes(".toolbar {") && panelSource.includes("white-space: nowrap;"), "Traceable panel source should keep the top header badges and Chat/Detailed toggle on a stable non-wrapping row so they do not jump between view modes.");
  assert.ok(panelSource.includes("position: sticky;") && panelSource.includes("top: 0;") && panelSource.includes("box-shadow: none;"), "Traceable panel source should keep the sticky header flush to the top instead of adding artificial top offset in detailed view.");
  assert.ok(panelSource.includes("box-shadow: inset 0 0 0 1px"), "Traceable panel source should use a subtle neutral active treatment for the chat toggle instead of a bright accent fill.");
  assert.ok(extensionSource.includes("TRACEABLE_BUSY_MESSAGE"), "Extension source should define a shared busy-start message.");
  assert.ok(extensionSource.includes("continueTraceableChatFromEvidenceEditor"), "Extension source is missing the editor-view TRACEABLE continuation helper.");
  assert.ok(extensionSource.includes("const revealToPanel = revealMode === \"yes\" || revealMode === \"always\";"), "Extension source should branch editor-view continuation behavior on auto-reveal mode.");
  assert.ok(extensionSource.includes("traceableEvidencePanelInitialChatViewByKey"), "Extension source should track initial chat-view intent for editor-hosted TRACEABLE evidence panels.");
  assert.ok(extensionSource.includes("await prepared.beforeRun();"), "Extension source should begin editor-hosted TRACEABLE continuations before deciding how to switch editor tabs.");
  assert.ok(extensionSource.includes("await openTraceableEvidenceEditor(pendingEvidenceFilePath, { initialChatViewEnabled: true });"), "Extension source should open the next editor-hosted TRACEABLE file immediately in chat view when autoReveal is off.");
  assert.ok(extensionSource.includes("finalizedEvidenceFilePath !== pendingEvidenceFilePath"), "Extension source should detect when a reserved TRACEABLE evidence file was renamed before the run settled.");
  assert.ok(extensionSource.includes("traceableEvidencePanels.get(getTraceableEvidencePanelKey(vscode.Uri.file(pendingEvidenceFilePath)))?.dispose();"), "Extension source should close the stale reserved TRACEABLE evidence panel before reopening the finalized evidence file.");
  assert.ok(extensionSource.includes("await openTraceableEvidenceEditor(finalizedEvidenceFilePath, { initialChatViewEnabled: true });"), "Extension source should reopen the finalized TRACEABLE evidence file in chat view after a reserved filename is renamed.");
  assert.ok(extensionSource.includes("if (event.webviewPanel.active) {") && extensionSource.includes("void flushRefresh();"), "Extension source should force a host-side rerender when a restored TRACEABLE evidence tab becomes active again.");
  assert.ok(extensionSource.includes("traceableEvidenceProgrammaticOpenByKey.add(panelKey);") && extensionSource.includes("const openedProgrammatically = traceableEvidenceProgrammaticOpenByKey.delete(panelKey);"), "Extension source should distinguish normal TRACEABLE opens from restored tabs before applying startup recovery.");
  assert.ok(extensionSource.includes("if (isTraceableResolvedPathTarget(message.target)) {"), "Extension source should let the TRACEABLE evidence editor open resolved path targets from shared webview chips.");
  assert.ok(extensionSource.includes("workbench.action.toggleMaximizedPanel"), "Extension source should best-effort maximize the bottom panel for editor continuations that reveal there.");
  assert.ok(extensionSource.includes("options.rejectIfBusy !== false"), "Extension command runner should reject busy TRACEABLE starts by default.");
  assert.ok(extensionSource.includes("this.rejectIfBusy && this.mutex.isLocked()"), "Extension LM tool runner should reject busy TRACEABLE starts instead of queueing them.");
  assert.ok(!extensionSource.includes('reporter.update("queued")'), "Extension source should not inject a synthetic queued status for public TRACEABLE run preparation.");
  assert.ok(extensionSource.includes("promptForTraceableAgentRoleSelection"), "Extension source is missing the traceable agent-role picker for folder entry points.");
  assert.ok(extensionSource.includes("defaultNewTraceableChatExportTo"), "Extension source is missing the default New Traceable Chat export-folder setting wiring.");
  assert.ok(extensionSource.includes("allRolesAvailableAsChatSender"), "Extension source is missing the sender-role setting wiring.");
  assert.ok(extensionSource.includes("getConfiguredDefaultChatSenderRole") && extensionSource.includes("resolveConfiguredDefaultChatSenderRoleOption") && extensionSource.includes("resolveConfiguredDefaultChatSenderRole"), "Extension source is missing the UX-only default chat sender-role resolution helpers.");
  assert.ok(extensionSource.includes("listConfiguredChatSenderRoleOptions"), "Extension source is missing the filtered sender-role catalog helper.");
  assert.ok(extensionSource.includes("stripTraceableRoleModelSuffix"), "Extension source is missing human-only sender label simplification.");
  assert.ok(extensionSource.includes("comparePreferredChatSenderEntries"), "Extension source is missing stable sender-role preference ordering.");
  assert.ok(extensionSource.includes("promptForChatSenderRoleSelection"), "Extension source is missing the new chat sender-role picker.");
  assert.ok(extensionSource.includes("defaultChatSenderRole,") && extensionSource.includes("async (snapshot) => {") && extensionSource.includes("const evidenceFilePath = snapshot.evidenceFile?.filePath?.trim();") && extensionSource.includes("return listConfiguredChatSenderRoleOptions(resource);") && extensionSource.includes("return resolveConfiguredDefaultChatSenderRole(resource);") , "Extension source should pass the active TRACEABLE evidence resource into panel sender-role resolution so resource-scoped chat settings apply in the bottom panel.");
  assert.ok(extensionSource.includes('get<string>("defaultView", "detailed")') && extensionSource.includes('function getConfiguredTraceableDefaultView(resource?: vscode.Uri): "detailed" | "chat" {') && extensionSource.includes('options: { initialChatViewEnabled?: boolean; applyConfiguredDefaultView?: boolean } = {}') && extensionSource.includes('options.applyConfiguredDefaultView !== false && getConfiguredTraceableDefaultView(resolvedUri) === "chat"') && extensionSource.includes('if (!openedProgrammatically && getConfiguredTraceableDefaultView(resolvedUri) === "chat") {') && extensionSource.includes('await openTraceableEvidenceEditor(result.evidenceFile.filePath, { applyConfiguredDefaultView: false });'), "Extension source should apply the configurable default TRACEABLE view only to ordinary trace-file opens and rehydrates, not to explicit run-result opens.");
  assert.ok(extensionSource.includes("workspaceFolders.length !== 1"), "Extension source should refuse to guess a relative default export folder across multiple workspace roots.");
  assert.ok(extensionSource.includes("return path.resolve(folderPath);"), "Extension source should store the default New Traceable Chat export folder as an absolute path.");
  assert.ok(extensionSource.includes("New Traceable Chat currently supports .agent.md files, .trace.md files, and folders only."), "Extension source is missing the guarded target-type error for New Traceable Chat.");
  assert.ok(extensionSource.includes("if (options.openResult !== false)"), "Extension source should allow command flows to skip auto-opening TRACEABLE evidence results.");
  assert.ok(extensionSource.includes('reveal: true,'), "Extension source should keep TRACEABLE panel reveal enabled for New Traceable Chat command runs.");
  assert.ok(extensionSource.includes('"New Traceable Chat (agent)", { openResult: false, focusComposerOnReveal: true }'), "Extension source should skip auto-opening the evidence file after .agent.md New Traceable Chat runs while marking the reveal as user-initiated for composer focus.");
  assert.ok(extensionSource.includes('"New Traceable Chat (folder)", { openResult: false, focusComposerOnReveal: true }'), "Extension source should skip auto-opening the evidence file after folder New Traceable Chat runs while marking the reveal as user-initiated for composer focus.");
  assert.ok(extensionSource.includes('"New Traceable Chat (continuation)", { openResult: false, focusComposerOnReveal: true }'), "Extension source should skip auto-opening the evidence file after .trace.md continuation chat runs while marking the reveal as user-initiated for composer focus.");
  assert.ok(extensionSource.includes('"Traceable Panel Chat Turn"'), "Extension source is missing the panel chat-turn continuation path.");
  assert.ok(extensionSource.includes('exportToFolder: path.dirname(parentTracePath)'), "Extension source should continue panel chat turns into the current trace folder.");
  const runtimeSource = await readFile(path.join(packageRoot, "src", "traceableSubagent.ts"), "utf8");
  assert.ok(runtimeSource.includes("deriveContinuationInheritedModelSelector"), "Traceable runtime source should derive continuation model inheritance from the parent trace outcome.");
  assert.ok(runtimeSource.includes("const exactParentModel = normalizeInheritedModelSelector(isRecord(parentResult?.model) ? parentResult.model : undefined);"), "Traceable runtime source should prefer the parent trace's actual selected model for continuations.");
  assert.ok(runtimeSource.includes("tiinex.aiProvenance"), "Traceable runtime source is missing the provenance configuration namespace.");
  assert.ok(runtimeSource.includes("export async function runTraceableSubagent"), "Traceable runtime source is missing the moved runtime entrypoint.");
  assert.ok(runtimeSource.includes("export async function listTraceableAgentCatalogEntries"), "Traceable runtime source is missing the moved traceable agent catalog entries export.");
  assert.ok(runtimeSource.includes("export async function listTraceableModelCatalogEntries"), "Traceable runtime source is missing the moved traceable model catalog entries export.");
  assert.ok(runtimeSource.includes("copilot/gpt-4.1"), "Traceable runtime source is missing the supported copilot/gpt-4.1 declaration for preferred-model configuration.");
  assert.ok(runtimeSource.includes("\"gpt-5.5\", { vendor: \"copilot\", id: \"gpt-5.5\" }"), "Traceable runtime source is missing bare human-label support for role models such as GPT-5.5.");
  assert.ok(runtimeSource.includes("\"claude-sonnet-4.5\", { vendor: \"copilot\", id: \"claude-sonnet-4.5\" }"), "Traceable runtime source is missing bare human-label support for role models such as Claude Sonnet 4.5.");
  assert.ok(runtimeSource.includes("\"raptor-mini-preview\", { vendor: \"copilot\", id: \"oswe-vscode-prime\" }"), "Traceable runtime source is missing bare human-label support for role models such as Raptor mini (Preview).");
  assert.ok(runtimeSource.includes("copilotgpt-4.1"), "Traceable runtime source is missing the normalized exact lookup form for copilot/gpt-4.1 settings.");
  assert.ok(runtimeSource.includes("copilot/gpt-5.5"), "Traceable runtime source is missing the supported copilot/gpt-5.5 declaration for blocked-model configuration.");
  assert.ok(runtimeSource.includes("copilotgpt-5.5"), "Traceable runtime source is missing the normalized exact lookup form for copilot/gpt-5.5 settings.");
  assert.ok(runtimeSource.includes("copilot/oswe-vscode-prime"), "Traceable runtime source is missing the supported copilot/oswe-vscode-prime declaration for low-cost preferred-model configuration.");
  assert.ok(runtimeSource.includes("copilotoswe-vscode-prime"), "Traceable runtime source is missing the normalized exact lookup form for copilot/oswe-vscode-prime settings.");
  assert.ok(runtimeSource.includes("Explicit modelSelector.id is blocked by tiinex.aiProvenance.traceableBlockedModels"), "Traceable runtime source is missing explicit blocked-model rejection.");
  assert.ok(runtimeSource.includes('const TRACEABLE_MODEL_DISPLAY_NAME_BY_ID = new Map<string, string>([') && runtimeSource.includes('["gemini-2.5-pro", "Gemini 2.5 Pro"]') && runtimeSource.includes('["gpt-5.4", "GPT-5.4"]') && runtimeSource.includes('["oswe-vscode-prime", "Raptor mini (Preview)"]') && runtimeSource.includes('export function formatTraceableModelIdDisplayName(modelId: string | undefined): string | undefined {') && runtimeSource.includes('const humanizedId = formatTraceableModelIdDisplayName(model.id);') && runtimeSource.includes('return humanizedId;') && runtimeSource.includes('const selectedModelDisplayName = formatTraceableSelectedModelDisplayName(model);'), "Traceable runtime source should prefer a shared human-readable model display name for TRACEABLE headers and results so the UX matches the VS Code model picker.");
  assert.ok(runtimeSource.includes('Selected runtime model ${JSON.stringify(selectedModelDisplayName)}.') && runtimeSource.includes('selectedModelDisplayName,'), "Traceable runtime decision summaries should persist the same human-readable selected-model name shown in TRACEABLE badges.");
  assert.ok(runtimeSource.includes("Math.random() * (index + 1)"), "Traceable runtime source is missing selector shuffling for preferred and role model pools.");
  assert.ok(runtimeSource.includes("value === true"), "Traceable runtime source is missing boolean completion-claim normalization for child JSON payloads.");
  assert.ok(runtimeSource.includes("stopReason === \"budget_exhausted\" || stopReason === \"insufficient_grounding\""), "Traceable runtime source is missing completion-claim reconciliation for budget or grounding stops.");
  assert.ok(runtimeSource.includes("function reconcileCompletionClaimWithSteps"), "Traceable runtime source is missing step-aware completion-claim reconciliation.");
  assert.ok(runtimeSource.includes("done|complete|completed|success|successful|succeeded|verified|grounded|finished"), "Traceable runtime source is missing common child step-status normalization for completed work.");
  assert.ok(runtimeSource.includes('completed, ${attemptedStepCount} attempted'), "Traceable runtime source is missing clearer attempted-step reporting when no steps were completed.");
  assert.ok(runtimeSource.includes("user_cancelled"), "Traceable runtime source is missing the user_cancelled stop-reason handling for cancellation-aware runs.");
  assert.ok(runtimeSource.includes("options.token?.isCancellationRequested"), "Traceable runtime source is missing explicit cancellation checks for the active run token.");
  assert.ok(runtimeSource.includes("stoppedBy: extra.stoppedBy"), "Traceable runtime source is missing fallback stoppedBy preservation for cancellation-aware runs.");
  assert.ok(runtimeSource.includes("stopSource: extra.stopSource"), "Traceable runtime source is missing fallback stopSource preservation for cancellation-aware runs.");
  assert.ok(runtimeSource.includes("stopRequestedAt: extra.stopRequestedAt"), "Traceable runtime source is missing fallback stopRequestedAt preservation for cancellation-aware runs.");
  assert.ok(runtimeSource.includes("activeCarryForward?: TraceableCarryForwardState"), "Traceable runtime source is missing the separate active carry-forward contract.");
  assert.ok(runtimeSource.includes("Active carry-forward state for this run"), "Traceable runtime source is missing prompt grounding for active carry-forward state.");
  assert.ok(runtimeSource.includes("activeCarryForward: parsedPayload.activeCarryForward"), "Traceable runtime source is missing child-payload carry-forward mapping into the final run result.");
  assert.ok(runtimeSource.includes("recoverableCarryState: parsedPayload.recoverableCarryState"), "Traceable runtime source is missing child-payload recoverable carry-state mapping into the final run result.");
  assert.ok(runtimeSource.includes("carryStateDisposition: parsedPayload.carryStateDisposition"), "Traceable runtime source is missing child-payload carry disposition mapping into the final run result.");
  assert.ok(runtimeSource.includes("export async function prepareTraceableSubagentInput"), "Traceable runtime source is missing the public continuation-input preparation helper.");
  assert.ok(runtimeSource.includes('"DIRECT" | "RESUME"'), "Traceable runtime source is missing the DIRECT/RESUME inputMode contract.");
  assert.ok(runtimeSource.includes("TRACEABLE DIRECT mode requires a non-empty userInput."), "Traceable runtime source is missing DIRECT-mode userInput enforcement.");
  assert.ok(runtimeSource.includes("TRACEABLE RESUME mode requires parentTracePath."), "Traceable runtime source is missing RESUME-mode parentTracePath enforcement.");
  assert.ok(runtimeSource.includes("TRACEABLE RESUME mode does not allow userInput, parentTask, or parentFrame."), "Traceable runtime source is missing strict RESUME prompt rejection.");
  assert.ok(runtimeSource.includes("traceableUndeclaredMaxIterations"), "Traceable runtime source is missing the undeclared max-iterations runtime setting.");
  assert.ok(runtimeSource.includes("traceableUndeclaredMaxToolCalls"), "Traceable runtime source is missing the undeclared max-tool-calls runtime setting.");
  assert.ok(runtimeSource.includes("if (explicitBudgetPolicy)"), "Traceable runtime source should only expose budgetPolicy in the request envelope when it was explicitly declared.");
  assert.ok(runtimeSource.includes("parseTraceableEvidenceStateMarkdown"), "Traceable runtime source is missing readable parent evidence parsing for continuation.");
  assert.ok(runtimeSource.includes("continuedFromParent: true"), "Traceable runtime source is missing continuation metadata for child runs.");
  assert.ok(runtimeSource.includes("lineageLabel"), "Traceable runtime source is missing lineage metadata handling for continuation runs.");
  assert.ok(runtimeSource.includes("function canonicalizeExplicitTraceableModelSelector"), "Traceable runtime source is missing explicit model-selector canonicalization through the supported declaration map.");
  assert.ok(runtimeSource.includes("function classifyTraceableHostFailureStopReason"), "Traceable runtime source is missing refusal-vs-tool-blocked host failure classification.");
  assert.ok(runtimeSource.includes("\\b(filtered|filtering|content filter|content policy|policy|refus|cannot assist|can't assist|cannot help|can't help|not assist with that request)\\b"), "Traceable runtime source should classify host-side filtered/refusal responses as policy_stop through an actual word-boundary refusal pattern.");
  assert.ok(runtimeSource.includes('const combinedPrompt = promptSections.promptTexts.join("\\n\\n---\\n\\n")'), "Traceable runtime source should collapse wrapper prompt sections into one user message before sendRequest.");
  assert.ok(runtimeSource.includes('return [vscode.LanguageModelChatMessage.User(combinedPrompt)]'), "Traceable runtime source should send one combined user message for the initial TRACEABLE prompt package.");
  assert.ok(runtimeSource.includes("function sanitizeResolvedAgentRoleBodyForTraceablePrompt"), "Traceable runtime source is missing the role-body sanitization helper for redundant self-resolution bootstrap blocks.");
  assert.ok(runtimeSource.includes("function buildTraceableParentRoleIdentitySummary"), "Traceable runtime source is missing the structured parent-role identity summary helper.");
  assert.ok(runtimeSource.includes('if (!trimmed.includes("exact target-role file"))'), "Traceable runtime source should only sanitize resolved role bodies that contain exact-target self-resolution bootstrap text.");
  assert.ok(runtimeSource.includes('const marker = "Your role is to preserve meaning while structure changes.";'), "Traceable runtime source should preserve the main role mandate while trimming redundant exact-target bootstrap instructions from resolved role bodies.");
  assert.ok(runtimeSource.includes("const useLeanDirectPrompt = Boolean("), "Traceable runtime source is missing the lean DIRECT prompt mode gate for trivial top-level runs.");
  assert.ok(runtimeSource.includes("Role-grounding rule:"), "Traceable runtime source should ground the resolved role identity before weighing parent or carry context.");
  assert.ok(runtimeSource.includes("Parent role identities for the incoming turn:"), "Traceable runtime source should expose structured parent role identities before other continuity metadata.");
  assert.ok(runtimeSource.includes("Use roleName as the exact display identity"), "Traceable runtime source should distinguish display role identity from normalized sender identity for parent roles.");
  assert.ok(runtimeSource.includes("Lean direct-prompt rule:"), "Traceable runtime source should explain the lean DIRECT prompt mode when it suppresses redundant role metadata and request-envelope sections.");
  assert.ok(runtimeSource.includes("...(useLeanDirectPrompt") && runtimeSource.includes("`Request contract:"), "Traceable runtime source should omit request-contract and tool-inventory sections when lean DIRECT prompt mode is active.");
  assert.ok(runtimeSource.includes("function isAutomaticTraceableModelSelector"), "Traceable runtime source should recognize modelSelector.id=auto as a non-concrete selector.");
  assert.ok(runtimeSource.includes("if (isAutomaticTraceableModelSelector(normalizedSelector))"), "Traceable runtime source should not route modelSelector.id=auto through the explicit exact-model selector path.");
  assert.ok(runtimeSource.includes("const canUseImplicitAutoSelection = !resolvedAgentArtifact"), "Traceable runtime source should allow implicit auto selection only when no agent-role model source is present.");
  assert.ok(runtimeSource.includes("!input.parentTracePath?.trim()"), "Traceable runtime source should keep implicit auto selection disabled when a parent trace source exists.");
  assert.ok(runtimeSource.includes("allowedSendableModels[Math.floor(Math.random() * allowedSendableModels.length)]"), "Traceable runtime source should select from the unblocked broad runtime model pool for implicit auto selection.");
  assert.ok(runtimeSource.includes("inferModelSelectorFromDeclaration(selector.id)"), "Traceable runtime source is missing explicit selector fallback canonicalization by bare model id.");
  assert.ok(runtimeSource.includes("recordToolDetail?(detail: TraceableSubagentToolDetail)"), "Traceable runtime source is missing the separate on-demand tool-detail reporter contract.");
  assert.ok(runtimeSource.includes("summarizeToolResultContent(toolResult.content)"), "Traceable runtime source is missing bounded successful tool-output capture for on-demand panel loading.");
  assert.ok(runtimeSource.includes("const MAX_TOOL_DETAIL_TEXT_CHARS = 120000"), "Traceable runtime source should keep substantially larger tool-detail captures for debugging than the compact output preview cap.");
  assert.ok(runtimeSource.includes("modelDisplayName?: string;"), "Traceable runtime source is missing a separate selected-model display field on run results.");
  assert.ok(runtimeSource.includes("modelDisplayName: selectedModelDisplayName"), "Traceable runtime source should persist the actually selected runtime model display name in final run results.");
  assert.ok(runtimeSource.includes("interface TraceableRuntimeDecisionSummary"), "Traceable runtime source is missing a dedicated runtime-decision summary contract for provenance persistence.");
  assert.ok(runtimeSource.includes("interface TraceableRuntimeFingerprint"), "Traceable runtime source is missing a durable runtime fingerprint contract for future drift analysis.");
  assert.ok(runtimeSource.includes("interface TraceableEvidenceBasis"), "Traceable runtime source is missing a dedicated evidence-basis contract for provenance persistence.");
  assert.ok(runtimeSource.includes("function buildTraceableRuntimeDecisionSummary"), "Traceable runtime source is missing a helper that summarizes model-selection decisions for persisted provenance.");
  assert.ok(runtimeSource.includes("function buildTraceableRuntimeFingerprint"), "Traceable runtime source is missing a helper that persists relevant runtime and config context.");
  assert.ok(runtimeSource.includes("function buildTraceableEvidenceBasis"), "Traceable runtime source is missing a helper that derives evidence-basis anchors from the observed run.");
  assert.ok(runtimeSource.includes("function collectUnsupportedObservedStepClaims"), "Traceable runtime source is missing child-step grounding checks against observed readFile tool calls.");
  assert.ok(runtimeSource.includes("recorded no successful readFile tool call"), "Traceable runtime source is missing an explicit unsupported-claim reason when child steps overstate observed reads.");
  assert.ok(runtimeSource.includes("parsedPayload.expectedButMissing.some((item) => item.kind === \"toolCall\")"), "Traceable runtime source should downgrade trace status when child payloads carry unsupported tool-call claims.");
  assert.ok(runtimeSource.includes("function inferMissingStopReasonFromPayload"), "Traceable runtime source is missing conservative stop-reason inference for otherwise grounded child payloads.");
  assert.ok(runtimeSource.includes("runtimeFingerprint: continuationAwareResult.runtimeFingerprint ?? runtimeFingerprint"), "Traceable runtime finalization should preserve runtime fingerprints on the final run result.");
  assert.ok(runtimeSource.includes("evidenceBasis = continuationAwareResult.evidenceBasis"), "Traceable runtime finalization should derive or preserve evidence-basis state on the final run result.");
  assert.ok(runtimeSource.includes("function buildPersistedToolOutput"), "Traceable runtime source is missing bounded persisted tool-output construction for evidence export.");
  assert.ok(runtimeSource.includes("output: buildPersistedToolOutput(toolOutput)"), "Traceable runtime source should persist bounded successful tool output in the tool ledger.");
  assert.ok(runtimeSource.includes("function isBinaryLikeToolDataCandidate"), "Traceable runtime source is missing binary-like data detection for safer persisted tool output.");
  assert.ok(runtimeSource.includes("outputMetadataSummary"), "Traceable runtime source is missing metadata summaries for data-like tool outputs.");
  assert.ok(extensionSource.includes("traceableEvidenceLoadedToolDetails"), "Extension source is missing cached on-demand tool-detail state for evidence panels.");
  assert.ok(extensionSource.includes("readParsedTraceableEvidenceFromFileWithRetry"), "Extension source is missing bounded retry handling for freshly written TRACEABLE evidence files.");
  assert.ok(extensionSource.includes("const { markdown, parsed } = await readParsedTraceableEvidenceFromFileWithRetry(resolvedEvidenceFilePath);"), "Extension source should use bounded retry when the public view_traceable_subagent tool reads freshly written evidence files.");
  assert.ok(extensionSource.includes("vscode.lm.registerTool(TRANSFER_TRACE_TOOL"), "Extension source is missing transferTrace tool registration.");
  assert.ok(extensionSource.includes("Runtime Decision"), "Traceable extension source is missing the runtime-decision view option.");
  assert.ok(extensionSource.includes("Evidence Basis"), "Traceable extension source is missing the evidence-basis view option.");
  assert.ok(extensionSource.includes("Request Contract"), "Traceable extension source is missing the request-contract view option.");
  assert.ok(extensionSource.includes("Timeline"), "Traceable extension source is missing the timeline view option.");
  assert.ok(extensionSource.includes("Carry Handoff"), "Traceable extension source is missing the carry-handoff view option.");
  assert.ok(extensionSource.includes("Tool Forensics"), "Traceable extension source is missing the tool-forensics view option.");
  assert.ok(extensionSource.includes("Lineage"), "Traceable extension source is missing the lineage view option.");
  assert.ok(extensionSource.includes(": (await readParsedTraceableEvidenceFromFileWithRetry(resolvedUri.fsPath)).parsed;"), "Extension source should use bounded retry when the TRACEABLE custom editor rehydrates the latest evidence file state.");
  assert.ok(extensionSource.includes("const parentRead = await readParsedTraceableEvidenceFromFileWithRetry(normalizedParentPath)"), "Extension source should use bounded retry when TRACEABLE lineage rehydrates parent evidence files.");
  assert.ok(!extensionSource.includes("modelLabel: effectiveInput.modelSelector?.id"), "Extension source should not seed the TRACEABLE header model label from the requested selector before a runtime model is actually chosen.");
  assert.ok(extensionSource.includes("buildUnavailableToolDetail"), "Extension source is missing evidence-panel fallback rendering for unavailable tool output.");
  assert.ok(extensionSource.includes("tryBuildRehydratedReadToolDetail"), "Extension source is missing on-demand rehydration for readFile outputs in evidence views.");
  assert.ok(extensionSource.includes("buildPersistedToolDetailMap"), "Extension source is missing persisted tool-detail preloading for evidence views.");
  assert.ok(extensionSource.includes("buildPersistedToolDetail(initialSnapshot, parsedState.result, callId)"), "Extension source should consult persisted tool output before falling back to live or reconstructed evidence details.");
  assert.ok(extensionSource.includes("outputKind: matchingCall.output.kind"), "Extension source should propagate persisted output kind into panel-loaded tool details.");
  assert.ok(extensionSource.includes("copilot_readFile") && extensionSource.includes("read_file"), "Extension source should recognize both native readFile tool names when rehydrating evidence output.");
  assert.ok(extensionSource.includes("Could not rehydrate read output from the current workspace file."), "Extension source is missing a truthful fallback when readFile output cannot be rehydrated from the workspace.");
  assert.ok(extensionSource.includes("This evidence file does not contain persisted tool output for this call."), "Extension source should state plainly when trace files lack persisted tool output.");
  assert.ok(runtimeSource.includes("function normalizeFinalSummaryValue"), "Traceable runtime source is missing tolerant finalSummary normalization for child JSON payloads.");
  assert.ok(runtimeSource.includes("no further reads needed"), "Traceable runtime source is missing natural-language completed stop-reason normalization for child JSON payloads.");
  assert.ok(runtimeSource.includes("sufficient per contract"), "Traceable runtime source is missing completed stop-reason normalization for minimal-read contract phrasing.");
  assert.ok(runtimeSource.includes("\\bcomplete(?:d)?\\b"), "Traceable runtime source is missing the broader completed stop-reason normalization that accepts natural-language child summaries.");
  const evidenceExportSource = await readFile(path.join(packageRoot, "src", "traceableSubagentEvidence.ts"), "utf8");
  assert.ok(evidenceExportSource.includes("renameEvidenceFileForSnapshot"), "Traceable evidence export source is missing evidence-file rename support when the final role or model label becomes known after export begins.");
  assert.ok(evidenceExportSource.includes("getTraceableEvidenceFileNameFormatOptions"), "Traceable evidence export source should read TRACEABLE filename-format settings before allocating or renaming evidence files.");
  assert.ok(evidenceExportSource.includes("formatSelectedRuntimeModelLabel(result)"), "Traceable evidence export source should align renamed evidence files with the selected runtime model when available.");
  assert.ok(evidenceExportSource.includes("cleanupStaleEvidenceFile"), "Traceable evidence export source should clean up stale pre-rename evidence files after final export succeeds.");
  assert.ok(evidenceExportSource.includes("function collapseRepeatedTraceableModelSegments") && evidenceExportSource.includes('.split("/")') && evidenceExportSource.includes('.filter((segment, index, segments) => index === 0 || segment !== segments[index - 1])'), "Traceable evidence export source should collapse repeated slash-segment model labels before persisting evidence state.");
  assert.ok(evidenceExportSource.includes("const displayName = collapseRepeatedTraceableModelSegments(result?.modelDisplayName);"), "Traceable evidence export source should prefer the selected runtime model display name over synthesized selector ids.");
  assert.ok(evidenceExportSource.includes("function extractTraceableEvidenceStateJson"), "Traceable evidence export parser should extract the Traceable State JSON block with a dedicated helper.");
  assert.ok(evidenceExportSource.includes("const closingMatch = /^```[ \\t]*$/um.exec(remainder);"), "Traceable evidence export parser should close the Traceable State block only on a standalone fence line.");
  assert.ok(evidenceExportSource.includes("function formatSelectedRuntimeModelLabel"), "Traceable evidence export source is missing a helper that prefers the selected runtime model in evidence labels.");
  assert.ok(evidenceExportSource.includes("modelLabel: effectiveModelLabel"), "Traceable evidence state should overwrite the snapshot model label with the effective runtime model label when available.");
  assert.ok(evidenceExportSource.includes("runtimeDecisionSummary: result.runtimeDecisionSummary"), "Traceable evidence export source should persist runtime-decision summaries in the embedded Traceable State block.");
  assert.ok(evidenceExportSource.includes("runtimeFingerprint: result.runtimeFingerprint"), "Traceable evidence export source should persist runtime fingerprints in the embedded Traceable State block.");
  assert.ok(evidenceExportSource.includes("evidenceBasis: result.evidenceBasis"), "Traceable evidence export source should persist evidence-basis summaries in the embedded Traceable State block.");
  assert.ok(evidenceExportSource.includes("`- Model: ${effectiveModelLabel}`"), "Traceable evidence markdown should show the effective selected runtime model rather than a stale selector label.");
  assert.ok(evidenceExportSource.includes("stoppedBy: result.stoppedBy"), "Traceable evidence export source is missing stoppedBy persistence for cancellation-aware runs.");
  assert.ok(evidenceExportSource.includes("stopSource: result.stopSource"), "Traceable evidence export source is missing stopSource persistence for cancellation-aware runs.");
  assert.ok(evidenceExportSource.includes("stopRequestedAt: result.stopRequestedAt"), "Traceable evidence export source is missing stopRequestedAt persistence for cancellation-aware runs.");
  assert.ok(evidenceExportSource.includes("activeCarryForward: result.activeCarryForward"), "Traceable evidence export source is missing active carry-forward persistence.");
  assert.ok(evidenceExportSource.includes("recoverableCarryState: result.recoverableCarryState"), "Traceable evidence export source is missing recoverable carry-state persistence.");
  assert.ok(evidenceExportSource.includes("continuedFromParent: result.continuedFromParent"), "Traceable evidence export source is missing continuation metadata persistence for child runs.");
  assert.ok(evidenceExportSource.includes("allocateContinuationEvidenceFilePath"), "Traceable evidence export source is missing continuation-aware evidence file allocation.");
  assert.ok(evidenceExportSource.includes("evidenceFile: { ...exportState }"), "Traceable evidence export source is missing finalized export-state persistence in the embedded Traceable State block.");
  assert.ok(evidenceExportSource.includes("writeReadyEvidenceFile") && evidenceExportSource.includes("readPersistedEvidenceStatus"), "Traceable evidence export source should verify that finalized evidence persists as ready on disk.");
  assert.ok(evidenceExportSource.includes('still persisted with status \\\"writing\\\" after ready-state verification'), "Traceable evidence export source should fail loudly when finalized evidence still persists as writing.");
  const senderAdaptationProbeHarnessSource = await readFile(path.join(packageRoot, "scripts", "check-sender-adaptation-probes.mjs"), "utf8");
  assert.ok(senderAdaptationProbeHarnessSource.includes("05-anchor.trace.md") && senderAdaptationProbeHarnessSource.includes("05-02-anchor.trace.md") && senderAdaptationProbeHarnessSource.includes("05-07-anchor.trace.md"), "Sender adaptation probe harness is missing the expected observed/reinforced/weakened evidence anchors.");
  assert.ok(senderAdaptationProbeHarnessSource.includes("sender adaptation probe checks passed"), "Sender adaptation probe harness is missing its success marker.");
  const traceableLineageSource = await readFile(path.join(packageRoot, "src", "traceableLineage.ts"), "utf8");
  assert.ok(traceableLineageSource.includes("slug?: string;"), "Traceable lineage parsing should allow slugless `.trace.md` filenames when the filename format is configured to drop model or role slugs.");
  assert.ok(traceableLineageSource.includes("omitRoleSlug") && traceableLineageSource.includes("removeZeroPadding"), "Traceable lineage source is missing the configurable filename-format options for slug removal and zero-padding removal.");
  assert.ok(traceableLineageSource.includes("formatTraceableLineageIndex(nextIndex, normalizedOptions.removeZeroPadding ? 1 : normalizedOptions.topLevelMinDigits)"), "Traceable lineage source should apply the configurable top-level digit width when allocating filenames.");
  assert.ok(traceableLineageSource.includes('resolveTraceableGitRoot') && traceableLineageSource.includes('areTraceablePathsInSameGitRoot') && traceableLineageSource.includes('existsSync(path.join(currentPath, ".git"))'), "Traceable lineage source should include git-root helpers for repo-root detection.");
  const traceableFileNameConfigSource = await readFile(path.join(packageRoot, "src", "traceableEvidenceFileNameConfig.ts"), "utf8");
  assert.ok(traceableFileNameConfigSource.includes("traceableFilenameTopLevelIndexDigits"), "TRACEABLE filename config helper should read the top-level digit-width setting.");
  assert.ok(traceableFileNameConfigSource.includes("traceableFilenameSubIndexDigits"), "TRACEABLE filename config helper should read the sub-index digit-width setting.");
  assert.ok(traceableFileNameConfigSource.includes("traceableRemoveZeroPaddingFromFilename"), "TRACEABLE filename config helper should read the zero-padding removal setting.");
  assert.ok(traceableFileNameConfigSource.includes("traceableRemoveModelOrRoleFromFilename"), "TRACEABLE filename config helper should read the role/model slug removal setting.");
  assert.ok(traceableEvidenceSource.includes("renderTraceableEvidenceConversationBriefMarkdown"), "Traceable evidence source is missing the compact conversation-brief renderer.");
  assert.ok(traceableEvidenceSource.includes("## Grounding Gap") && traceableEvidenceSource.includes("Parent Final Summary"), "Traceable conversation-brief renderer should include compact grounding-gap and parent-context sections.");
  assert.ok(extensionSource.includes('label: "Conversation Brief"') && extensionSource.includes('surface: "conversation-brief"'), "Extension source is missing the conversation-brief quick-pick surface option.");
  const contractPayloadSource = await readFile(path.join(packageRoot, "src", "traceableContract.ts"), "utf8");
  assert.ok(contractPayloadSource.includes("output?: {") && contractPayloadSource.includes("kind?: \"text\" | \"structured\" | \"data\" | \"mixed\";") && contractPayloadSource.includes("rawTextTruncated?: boolean;"), "Traceable contract source is missing the typed persisted tool-output contract on tool-call records.");
  assert.ok(contractPayloadSource.includes("export interface TraceableSubagentRunResult"), "Traceable contract source is missing the run result contract.");
  assert.ok(contractPayloadSource.includes("normalizeTraceableOutputMode"), "Traceable contract source is missing output-mode normalization.");
  assert.ok(contractPayloadSource.includes("buildTraceableSubagentRequestEnvelope"), "Traceable contract source is missing request-envelope construction.");
  assert.ok(contractPayloadSource.includes("resolveTraceableParentFrame"), "Traceable contract source is missing parent-frame resolution.");
  assert.ok(contractPayloadSource.includes("extractTraceableSubagentPayload"), "Traceable contract source is missing payload extraction.");
  assert.ok(contractSource.includes("normalizeParsedPayload"), "Traceable contract source is missing payload normalization.");
  assert.ok(contractSource.includes("export function reconcileCompletionClaimWithSteps"), "Traceable contract source is missing step-aware completion-claim reconciliation.");
  assert.ok(contractSource.includes("done|complete|completed|success|successful|succeeded|verified|grounded|finished"), "Traceable contract source is missing common child step-status normalization for completed work.");
  assert.ok(contractSource.includes("function normalizeFinalSummaryValue"), "Traceable contract source is missing tolerant finalSummary normalization.");
  assert.ok(contractSource.includes("resolveTraceStatus"), "Traceable contract source is missing trace-status resolution.");
  assert.ok(contractSource.includes("user_cancelled"), "Traceable contract source is missing the user_cancelled stop-reason contract.");
  assert.ok(contractSource.includes("parentTracePath?: string"), "Traceable contract source is missing parentTracePath on the public continuation surface.");
  assert.ok(contractSource.includes("export interface TraceableParentOrigin") && contractSource.includes("parentCreatedAt?: string") && contractSource.includes("parentOrigin?: TraceableParentOrigin"), "Traceable contract source should expose parent-created-at and parent-origin fields on the public continuation surface.");
  assert.ok(contractSource.includes("continuedFromParent?: boolean"), "Traceable contract source is missing continuedFromParent metadata on the run result.");
  assert.ok(contractSource.includes("lineageDepth?: number"), "Traceable contract source is missing lineageDepth metadata on the run result.");
  assert.ok(contractSource.includes("lineageLabel?: string"), "Traceable contract source is missing lineageLabel metadata on the run result.");
  assert.ok(contractSource.includes("buildUnparseableChildPayloadFallback"), "Traceable contract source is missing unparseable-payload fallback construction.");
  assert.ok(contractSource.includes("collectTraceableInputValidationIssues"), "Traceable contract source is missing input validation helpers.");
  assert.ok(contractSource.includes('"DIRECT" | "RESUME"'), "Traceable contract source is missing the DIRECT/RESUME inputMode contract.");
  assert.ok(contractSource.includes("traceableUndeclaredMaxIterations"), "Traceable contract source is missing the undeclared max-iterations runtime setting.");
  assert.ok(contractSource.includes("traceableUndeclaredMaxToolCalls"), "Traceable contract source is missing the undeclared max-tool-calls runtime setting.");
  assert.ok(contractSource.includes("renderTraceableSubagentEvidencePathOnly"), "Traceable contract source is missing evidence-path-only markdown rendering.");
  assert.ok(contractSource.includes("formatTraceablePathReference"), "Traceable contract source is missing path-reference rendering.");
  assert.ok(contractSource.includes("renderTraceableSubagentMarkdown"), "Traceable contract source is missing full markdown rendering.");
  assert.ok(contractSource.includes("request.parentCreatedAt = parentCreatedAt;") && contractSource.includes("request.parentOrigin = parentOrigin;") && contractSource.includes("- Parent Created At:") && contractSource.includes("- Parent Origin:"), "Traceable contract source should persist and render parent-created-at and parent-origin continuation metadata.");
  assert.ok(contractSource.includes("appendBoundedJsonPreview"), "Traceable contract source is missing bounded JSON previews.");
  assert.ok(contractSource.includes("stoppedBy?: \"user\" | \"host\""), "Traceable contract source is missing stoppedBy metadata on the run result.");
  assert.ok(contractSource.includes("stopSource?: \"traceable-panel\" | \"host-cancel\" | \"unknown\""), "Traceable contract source is missing stopSource metadata on the run result.");
  assert.ok(contractSource.includes("stopRequestedAt?: string"), "Traceable contract source is missing stopRequestedAt metadata on the run result.");
  assert.ok(contractSource.includes("export interface TraceableCarryForwardState"), "Traceable contract source is missing the carry-forward state contract.");
  assert.ok(contractSource.includes("activeCarryForward?: TraceableCarryForwardState"), "Traceable contract source is missing the active carry-forward field.");
  assert.ok(contractSource.includes("carryStateDisposition?: TraceableCarryStateDisposition"), "Traceable contract source is missing carry-state disposition metadata.");
  assert.ok(contractSource.includes("Sender Adaptation State") && contractSource.includes("request.senderAdaptationState = input.senderAdaptationState"), "Traceable contract source is missing sender adaptation request and markdown wiring.");
  assert.ok(contractSource.includes("export interface TraceableEvidenceBasis"), "Traceable contract source is missing the evidence-basis run-result contract.");
  assert.ok(contractSource.includes("evidenceBasis?: TraceableEvidenceBasis"), "Traceable contract source is missing evidence-basis persistence on run results.");
  assert.ok(contractSource.includes("### Evidence Basis"), "Traceable contract source is missing evidence-basis rendering in TRACEABLE markdown output.");
  assert.ok(extensionSource.includes("async invoke(options: vscode.LanguageModelToolInvocationOptions<TInput>, token: vscode.CancellationToken)"), "Traceable extension source is missing cancellation-aware LM tool invoke wiring.");
  assert.ok(extensionSource.includes("this.invokeImpl(options.input, budget, preparedState, token)"), "Traceable extension source is missing token threading into queued tool invocations.");
  assert.ok(extensionSource.includes("prepareTraceableRunExecution"), "Traceable extension source is missing the shared pre-run preparation helper for command and tool execution.");
  assert.ok(extensionSource.includes("prepareTraceableSubagentInput(requestedInput)"), "Traceable extension source is missing pre-run continuation preparation before export and execution.");
  assert.ok(extensionSource.includes("buildInheritedRequestSummaryItem"), "Traceable extension source is missing inherited-request summary synthesis for continuation runs.");
  assert.ok(extensionSource.includes("label: \"Inherited\""), "Traceable extension source is missing inherited request-summary items for continuation runs.");
  assert.ok(extensionSource.includes("buildTraceableRequestSummary(effectiveInput, requestedInput)"), "Traceable extension source is missing request-summary rendering for effective input plus original override provenance.");
  assert.ok(extensionSource.includes("Declared input mode: DIRECT"), "Traceable extension source is missing DIRECT mode summary rendering.");
  assert.ok(extensionSource.includes("Declared input mode: RESUME"), "Traceable extension source is missing RESUME mode summary rendering.");
  assert.ok(extensionSource.includes("label: \"Carry State\""), "Traceable extension source is missing the separate carry-state request summary item.");
  assert.ok(extensionSource.includes("resolveRelativeOpenPathInWorkspace"), "Traceable extension source is missing the multi-root relative open-path resolver.");
  assert.ok(extensionSource.includes("resolveDriveLessAbsolutePathOnWindows"), "Traceable extension source is missing Windows drive-less absolute path recovery.");
  assert.ok(extensionSource.includes("revealFileInOS"), "Traceable extension source is missing OS-level reveal handling for targets outside workspace roots.");
  assert.ok(extensionSource.includes("isPathWithinAnyWorkspaceRoot"), "Traceable extension source is missing the workspace-root boundary check for open targets.");
  assert.ok(contractSource.includes("extractObservedReadTargets"), "Traceable contract source is missing observed-read target summaries.");
  console.log("ai-provenance vscode scaffold checks passed");
}

await main();