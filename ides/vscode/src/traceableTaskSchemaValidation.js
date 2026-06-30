const path = require("node:path");
const {
  addContractSectionShapeFindings,
  collectContractVocabularyFindings,
  collectExpectedSchemaHeadingFindings,
  collectUnexpectedContinuityEnvelopeFieldFindings,
  evaluateContinuityIntegrity,
  getContractGroupCategoryItems,
  isCommitPinnedBrowseGitTarget,
  isTraceableContinuityTimestamp,
  parseSchemaNoteMarkdown,
  readSchemaFileSync,
  resolveRelativeSchemaPath
} = require("./traceableSchemaValidationShared.js");
const { validateTraceableRootSchemaSync } = require("./traceableRootSchemaValidation.js");

const TASK_SCHEMA_EXPECTED_SECTION_HEADINGS = [
  "Summary",
  "Schema Validation Contract",
  "Minimal Example",
  "Validation-Friendly Shape",
  "Interpretation Notes",
  "Artifact Creation Contract"
];

const TASK_SCHEMA_VALIDATION_GROUP_HEADINGS = [
  "Task Scope",
  "Task Body",
  "Task Semantics",
  "Task Envelope Companions",
  "File Naming",
  "Interpretation Boundaries"
];

const TASK_SCHEMA_VALIDATION_CATEGORY_LABELS = [
  "Allowed Shapes",
  "Applies To",
  "Optional Fields",
  "Optional Sections",
  "Required Shape",
  "Rules"
];

const TASK_SCHEMA_ARTIFACT_CREATION_GROUP_HEADINGS = [
  "Prompt Fields",
  "Template Body"
];

const TASK_SCHEMA_ARTIFACT_CREATION_CATEGORY_LABELS = [
  "Optional Fields",
  "Required Fields",
  "Required Shape",
  "Rules"
];

function addMissingGroupFindings(findings, filePath, contract, options) {
  const presentGroupHeadings = new Set(contract.groups.map((group) => group.heading));
  const missingGroups = options.requiredGroupHeadings.filter((heading) => !presentGroupHeadings.has(heading));
  if (missingGroups.length === 0) {
    return;
  }
  findings.push({
    code: `${options.codePrefix}-groups-missing`,
    category: options.category,
    filePath,
    message: `The ${options.displayName} is missing required groups: ${missingGroups.join(", ")}.`,
    severity: "error"
  });
}

function addRedeclaredInheritedContractCategoryFindings(findings, filePath, declaredCategoryLabels, inheritedCategoryLabels, overriddenCategoryLabels) {
  const overrideLabelSet = new Set(overriddenCategoryLabels);
  const inheritedLabelSet = new Set(inheritedCategoryLabels);
  const redeclaredLabels = declaredCategoryLabels.filter((label) => inheritedLabelSet.has(label) && !overrideLabelSet.has(label));
  if (redeclaredLabels.length === 0) {
    return;
  }
  findings.push({
    code: "task-schema-contract-extension-redeclares-inherited-category-label",
    category: "schema-validation-contract",
    filePath,
    message: `Contract Category Extension redeclares inherited category labels without explicit override semantics: ${redeclaredLabels.join(", ")}.`,
    severity: "error"
  });
}

function canReadResolvedSchemaPath(resolvedSchemaPath, readTextFileSync) {
  if (!resolvedSchemaPath) {
    return true;
  }
  try {
    readSchemaFileSync(resolvedSchemaPath, readTextFileSync);
    return true;
  } catch {
    return false;
  }
}

function resolveExpectedParentCreatedAt(filePath, parsed, readTextFileSync) {
  const resolvedParentTracePath = resolveRelativeSchemaPath(filePath, parsed.parentTrace?.target);
  if (!resolvedParentTracePath) {
    return undefined;
  }
  try {
    return parseSchemaNoteMarkdown(readSchemaFileSync(resolvedParentTracePath, readTextFileSync)).currentCreatedAt;
  } catch {
    return undefined;
  }
}

function validateTraceableTaskSchemaSync(input) {
  const markdown = readSchemaFileSync(input.filePath, input.readTextFileSync);
  const parsed = parseSchemaNoteMarkdown(markdown);
  const findings = [];
  const continuityIntegrity = evaluateContinuityIntegrity(markdown, parsed.footerIntegrity, {
    filePath: input.filePath,
    readTextFileSync: input.readTextFileSync
  });
  const envelopeSchemaPath = resolveRelativeSchemaPath(input.filePath, parsed.envelopeSchema?.target);
  const currentSchemaPath = resolveRelativeSchemaPath(input.filePath, parsed.currentSchema?.target);
  const declaredParentSchemaPath = resolveRelativeSchemaPath(input.filePath, parsed.parentSchema?.target);
  const parentSchemaPath = resolveRelativeSchemaPath(input.filePath, parsed.parentTrace?.target);
  const expectedParentCreatedAt = resolveExpectedParentCreatedAt(input.filePath, parsed, input.readTextFileSync);
  const unknownContractSeverity = parentSchemaPath ? "error" : "warning";
  const declaredContractCategoryLabels = parsed.schemaValidationContract?.groups
    .filter((group) => group.heading === "Contract Category Extension")
    .flatMap((group) => group.declarations?.map((declaration) => declaration.name) ?? []) ?? [];
  const overriddenContractCategoryLabels = parsed.schemaValidationContract?.groups
    .filter((group) => group.heading === "Contract Category Override")
    .flatMap((group) => group.declarations?.map((declaration) => declaration.name) ?? []) ?? [];
  let allowedEnvelopeFieldLabels = [];
  let allowedParentFieldLabels = [];
  let allowedCurrentFieldLabels = [];
  let inheritedContractCategoryLabels = [];

  if (!parsed.currentCreatedAt) {
    findings.push({ code: "continuity-current-created-at-missing", category: "continuity-integrity", filePath: input.filePath, message: "Current Created At is required by the continuity envelope.", severity: "error" });
  } else if (!isTraceableContinuityTimestamp(parsed.currentCreatedAt)) {
    findings.push({ code: "continuity-current-created-at-invalid", category: "continuity-integrity", filePath: input.filePath, message: "Current Created At is not in the expected YYYY-MM-DD hh:mm:ss shape.", severity: "error" });
  }

  if (parentSchemaPath && !parsed.parentCreatedAt) {
    findings.push({ code: "task-schema-parent-created-at-missing", category: "schema-note-lineage", filePath: input.filePath, message: "The task schema Parent Created At is required when a parent trace is declared.", severity: "error" });
  } else if (parsed.parentCreatedAt && !isTraceableContinuityTimestamp(parsed.parentCreatedAt)) {
    findings.push({ code: "task-schema-parent-created-at-invalid", category: "schema-note-lineage", filePath: input.filePath, message: "The task schema Parent Created At is not in the expected YYYY-MM-DD hh:mm:ss shape.", severity: "error" });
  } else if (parsed.parentCreatedAt && expectedParentCreatedAt && parsed.parentCreatedAt !== expectedParentCreatedAt) {
    findings.push({ code: "task-schema-parent-created-at-mismatch", category: "schema-note-lineage", filePath: input.filePath, message: `The task schema Parent Created At must match the parent artifact Current Created At: ${expectedParentCreatedAt}.`, severity: "error" });
  }

  if (continuityIntegrity.status === "mismatch" || continuityIntegrity.status === "target-unreadable") {
    findings.push({ code: "continuity-checksum-mismatch", category: "continuity-integrity", filePath: input.filePath, message: continuityIntegrity.status === "target-unreadable" ? "Continuity footer checksum target could not be read." : "Continuity footer checksum does not match the declared target artifact.", severity: "error" });
  }

  if (parsed.footerIntegrity?.method === "sha256-base64url-c14n-v1") {
    findings.push({
      code: "continuity-checksum-v1-legacy",
      category: "continuity-integrity",
      filePath: input.filePath,
      message: "Continuity footer still uses legacy checksum method v1. Prefer upgrading this footer to v2.",
      severity: "warning"
    });
  }

  if ((parsed.currentSchema?.label ?? parsed.currentSchema?.target) !== "tiinex.task.v1") {
    findings.push({ code: "task-schema-current-schema-mismatch", category: "schema-note-lineage", filePath: input.filePath, message: "The task validator expects Current Schema to be tiinex.task.v1.", severity: "error" });
  }
  if ((parsed.envelopeSchema?.label ?? parsed.envelopeSchema?.target) !== "tiinex.root.v1") {
    findings.push({ code: "task-schema-envelope-schema-mismatch", category: "schema-note-lineage", filePath: input.filePath, message: "The task schema must declare tiinex.root.v1 as its Envelope Schema.", severity: "error" });
  }
  if (!canReadResolvedSchemaPath(envelopeSchemaPath, input.readTextFileSync)) {
    findings.push({ code: "task-schema-envelope-schema-unreadable", category: "schema-note-lineage", filePath: input.filePath, message: "The task schema Envelope Schema target could not be read.", severity: "error" });
  }
  if (!canReadResolvedSchemaPath(currentSchemaPath, input.readTextFileSync)) {
    findings.push({ code: "task-schema-current-schema-unreadable", category: "schema-note-lineage", filePath: input.filePath, message: "The task schema Current Schema target could not be read.", severity: "error" });
  }
  if ((parsed.parentSchema?.label ?? parsed.parentSchema?.target) !== "tiinex.root.v1") {
    findings.push({ code: "task-schema-parent-schema-mismatch", category: "schema-note-lineage", filePath: input.filePath, message: "The task schema must declare tiinex.root.v1 as its direct parent schema.", severity: "error" });
  }
  if (!canReadResolvedSchemaPath(declaredParentSchemaPath, input.readTextFileSync)) {
    findings.push({ code: "task-schema-parent-schema-unreadable", category: "schema-note-lineage", filePath: input.filePath, message: "The task schema Parent Schema target could not be read.", severity: "error" });
  }

  if (parsed.parentSchema?.label ?? parsed.parentSchema?.target ?? parsed.parentTrace?.label ?? parsed.parentTrace?.target) {
    if (!parsed.parentOrigin) {
      findings.push({ code: "task-schema-parent-origin-missing", category: "schema-note-lineage", filePath: input.filePath, message: "The task schema must declare Parent Origin when it declares a parent.", severity: "error" });
    } else if (!parsed.parentOrigin.browseGit) {
      findings.push({ code: "task-schema-parent-origin-browse-git-missing", category: "schema-note-lineage", filePath: input.filePath, message: "The task schema must include a commit-pinned Parent Origin browse + git permalink.", severity: "error" });
    } else if (!isCommitPinnedBrowseGitTarget(parsed.parentOrigin.browseGit)) {
      findings.push({ code: "task-schema-parent-origin-unpinned-browse-git", category: "schema-note-lineage", filePath: input.filePath, message: "The task schema Parent Origin browse + git target is not commit-pinned.", severity: "error" });
    }
  }

  if ((parsed.footerIntegrity?.towardsLabel ?? parsed.footerIntegrity?.towardsTarget) !== "self" && path.basename(parsed.footerIntegrity?.towardsTarget ?? "") !== "tiinex.root.v1.schema.md") {
    findings.push({ code: "task-schema-footer-target-mismatch", category: "schema-note-lineage", filePath: input.filePath, message: "The task schema footer should target the root schema or self according to the active validation strategy.", severity: "error" });
  }
  const footerComparisonTarget = parsed.footerIntegrity?.entries?.map((entry) => entry?.towardsTarget).filter((target) => target && target !== "self").at(-1)
    ?? (parsed.footerIntegrity?.towardsTarget && parsed.footerIntegrity.towardsTarget !== "self" ? parsed.footerIntegrity.towardsTarget : undefined);
  if (parsed.footerIntegrity?.towardsTarget === "self" && !footerComparisonTarget) {
    findings.push({ code: "task-schema-footer-target-mismatch", category: "schema-note-lineage", filePath: input.filePath, message: "The task schema footer must target the root schema permalink rather than self.", severity: "error" });
  } else if (footerComparisonTarget && !isCommitPinnedBrowseGitTarget(footerComparisonTarget)) {
    findings.push({ code: "task-schema-footer-target-not-permalink", category: "schema-note-lineage", filePath: input.filePath, message: "The task schema footer Towards target must be a commit-pinned browse + git permalink when the root schema permalink is available.", severity: "error" });
  } else if (parsed.parentOrigin?.browseGit && footerComparisonTarget && footerComparisonTarget !== parsed.parentOrigin.browseGit) {
    findings.push({ code: "task-schema-footer-target-mismatch", category: "schema-note-lineage", filePath: input.filePath, message: "The task schema footer Towards target must match the Parent Origin browse + git permalink.", severity: "error" });
  }

  collectExpectedSchemaHeadingFindings(findings, input.filePath, parsed, { codePrefix: "task-schema-layout", displayName: "task schema", titleHeading: "Task", expectedSectionHeadings: TASK_SCHEMA_EXPECTED_SECTION_HEADINGS });

  if (!parsed.schemaValidationContract?.present) {
    findings.push({ code: "task-schema-validation-contract-missing", category: "schema-validation-contract", filePath: input.filePath, message: "The task schema must include a Schema Validation Contract section.", severity: "error" });
  } else {
    addContractSectionShapeFindings(findings, input.filePath, parsed.schemaValidationContract, { codePrefix: "task-schema-contract", category: "schema-validation-contract", displayName: "task schema validation contract" });
    collectContractVocabularyFindings(findings, input.filePath, parsed.schemaValidationContract, {
      codePrefix: "task-schema-contract",
      category: "schema-validation-contract",
      displayName: "task schema validation contract",
      allowedGroupHeadings: [...TASK_SCHEMA_VALIDATION_GROUP_HEADINGS, "Contract Category Extension", "Contract Category Override"],
      allowedCategoryLabels: [...TASK_SCHEMA_VALIDATION_CATEGORY_LABELS, ...declaredContractCategoryLabels],
      unexpectedSeverity: unknownContractSeverity
    });
    addMissingGroupFindings(findings, input.filePath, parsed.schemaValidationContract, { codePrefix: "task-schema-contract", category: "schema-validation-contract", displayName: "task schema validation contract", requiredGroupHeadings: TASK_SCHEMA_VALIDATION_GROUP_HEADINGS });
  }

  if (!parsed.artifactCreationContract?.present) {
    findings.push({ code: "task-schema-artifact-creation-contract-missing", category: "artifact-creation-contract", filePath: input.filePath, message: "The task schema must include an Artifact Creation Contract section.", severity: "error" });
  } else {
    addContractSectionShapeFindings(findings, input.filePath, parsed.artifactCreationContract, { codePrefix: "task-schema-artifact-creation-contract", category: "artifact-creation-contract", displayName: "task schema artifact creation contract" });
    collectContractVocabularyFindings(findings, input.filePath, parsed.artifactCreationContract, {
      codePrefix: "task-schema-artifact-creation-contract",
      category: "artifact-creation-contract",
      displayName: "task schema artifact creation contract",
      allowedGroupHeadings: TASK_SCHEMA_ARTIFACT_CREATION_GROUP_HEADINGS,
      allowedCategoryLabels: TASK_SCHEMA_ARTIFACT_CREATION_CATEGORY_LABELS,
      unexpectedSeverity: unknownContractSeverity
    });
    addMissingGroupFindings(findings, input.filePath, parsed.artifactCreationContract, { codePrefix: "task-schema-artifact-creation-contract", category: "artifact-creation-contract", displayName: "task schema artifact creation contract", requiredGroupHeadings: TASK_SCHEMA_ARTIFACT_CREATION_GROUP_HEADINGS });
  }

  if (!parentSchemaPath) {
    findings.push({ code: "task-schema-parent-trace-unresolvable", category: "schema-note-lineage", filePath: input.filePath, message: "The task schema must point to a resolvable root schema trace.", severity: "error" });
  } else {
    const rootValidation = validateTraceableRootSchemaSync({ filePath: parentSchemaPath, readTextFileSync: input.readTextFileSync });
    inheritedContractCategoryLabels = getContractGroupCategoryItems(rootValidation.parsed.schemaValidationContract, "Contract Syntax", ["Known Category Labels"]);
    allowedEnvelopeFieldLabels = getContractGroupCategoryItems(rootValidation.parsed.schemaValidationContract, "Continuity Context", ["Required Fields", "Optional Fields"]);
    allowedParentFieldLabels = getContractGroupCategoryItems(rootValidation.parsed.schemaValidationContract, "Parent", ["Required Fields", "Optional Fields"]);
    allowedCurrentFieldLabels = getContractGroupCategoryItems(rootValidation.parsed.schemaValidationContract, "Current", ["Required Fields", "Optional Fields"]);
    const rootBlockingFindings = rootValidation.findings.filter((finding) => !finding.code.startsWith("continuity-"));
    if (rootBlockingFindings.length > 0) {
      findings.push({ code: "task-schema-parent-root-invalid", category: "schema-note-lineage", filePath: input.filePath, message: "The task schema points to a parent root schema that does not satisfy the root validator.", severity: "error" });
    }
    addRedeclaredInheritedContractCategoryFindings(findings, input.filePath, declaredContractCategoryLabels, inheritedContractCategoryLabels, overriddenContractCategoryLabels);
  }

  collectUnexpectedContinuityEnvelopeFieldFindings(findings, input.filePath, parsed, {
    codePrefix: "task-schema-lineage",
    category: "schema-note-lineage",
    displayName: "task schema continuity envelope",
    severity: parentSchemaPath ? "warning" : undefined,
    allowedEnvelopeFieldLabels,
    allowedParentFieldLabels,
    allowedCurrentFieldLabels
  });

  return { filePath: input.filePath, parsed, findings };
}

module.exports = {
  validateTraceableTaskSchemaSync
};