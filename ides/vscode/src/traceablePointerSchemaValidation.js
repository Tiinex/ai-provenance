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

const POINTER_SCHEMA_EXPECTED_SECTION_HEADINGS = [
  "Summary",
  "Schema Validation Contract",
  "Minimal Example",
  "Validation-Friendly Shape",
  "Interpretation Notes",
  "Artifact Creation Contract"
];

const POINTER_SCHEMA_VALIDATION_GROUP_HEADINGS = [
  "Pointer Role",
  "Pointer Modes",
  "Pointer Body",
  "Destination List",
  "Pointer Envelope Companions",
  "File Naming",
  "Interpretation Boundaries"
];

const POINTER_SCHEMA_VALIDATION_CATEGORY_LABELS = [
  "Allowed Shapes",
  "Applies To",
  "Entry Shape",
  "Optional Fields",
  "Optional Sections",
  "Required Shape",
  "Required When",
  "Rules"
];

const POINTER_SCHEMA_ARTIFACT_CREATION_GROUP_HEADINGS = [
  "Prompt Fields",
  "Template Body"
];

const POINTER_SCHEMA_ARTIFACT_CREATION_CATEGORY_LABELS = [
  "Optional Fields",
  "Optional Sections",
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
    code: "pointer-schema-contract-extension-redeclares-inherited-category-label",
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

function validateTraceablePointerSchemaSync(input) {
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
    findings.push({ code: "pointer-schema-parent-created-at-missing", category: "schema-note-lineage", filePath: input.filePath, message: "The pointer schema Parent Created At is required when a parent trace is declared.", severity: "error" });
  } else if (parsed.parentCreatedAt && !isTraceableContinuityTimestamp(parsed.parentCreatedAt)) {
    findings.push({ code: "pointer-schema-parent-created-at-invalid", category: "schema-note-lineage", filePath: input.filePath, message: "The pointer schema Parent Created At is not in the expected YYYY-MM-DD hh:mm:ss shape.", severity: "error" });
  } else if (parsed.parentCreatedAt && expectedParentCreatedAt && parsed.parentCreatedAt !== expectedParentCreatedAt) {
    findings.push({ code: "pointer-schema-parent-created-at-mismatch", category: "schema-note-lineage", filePath: input.filePath, message: `The pointer schema Parent Created At must match the parent artifact Current Created At: ${expectedParentCreatedAt}.`, severity: "error" });
  }

  if (continuityIntegrity.status === "mismatch" || continuityIntegrity.status === "target-unreadable") {
    findings.push({ code: "continuity-checksum-mismatch", category: "continuity-integrity", filePath: input.filePath, message: continuityIntegrity.status === "target-unreadable" ? "Continuity footer checksum target could not be read." : "Continuity footer checksum does not match the declared target artifact.", severity: "error" });
  }

  if ((parsed.currentSchema?.label ?? parsed.currentSchema?.target) !== "tiinex.pointer.v1") {
    findings.push({ code: "pointer-schema-current-schema-mismatch", category: "schema-note-lineage", filePath: input.filePath, message: "The pointer validator expects Current Schema to be tiinex.pointer.v1.", severity: "error" });
  }
  if ((parsed.envelopeSchema?.label ?? parsed.envelopeSchema?.target) !== "tiinex.root.v1") {
    findings.push({ code: "pointer-schema-envelope-schema-mismatch", category: "schema-note-lineage", filePath: input.filePath, message: "The pointer schema must declare tiinex.root.v1 as its Envelope Schema.", severity: "error" });
  }
  if (!canReadResolvedSchemaPath(envelopeSchemaPath, input.readTextFileSync)) {
    findings.push({ code: "pointer-schema-envelope-schema-unreadable", category: "schema-note-lineage", filePath: input.filePath, message: "The pointer schema Envelope Schema target could not be read.", severity: "error" });
  }
  if (!canReadResolvedSchemaPath(currentSchemaPath, input.readTextFileSync)) {
    findings.push({ code: "pointer-schema-current-schema-unreadable", category: "schema-note-lineage", filePath: input.filePath, message: "The pointer schema Current Schema target could not be read.", severity: "error" });
  }
  if ((parsed.parentSchema?.label ?? parsed.parentSchema?.target) !== "tiinex.root.v1") {
    findings.push({ code: "pointer-schema-parent-schema-mismatch", category: "schema-note-lineage", filePath: input.filePath, message: "The pointer schema must declare tiinex.root.v1 as its direct parent schema.", severity: "error" });
  }
  if (!canReadResolvedSchemaPath(declaredParentSchemaPath, input.readTextFileSync)) {
    findings.push({ code: "pointer-schema-parent-schema-unreadable", category: "schema-note-lineage", filePath: input.filePath, message: "The pointer schema Parent Schema target could not be read.", severity: "error" });
  }

  if (parsed.parentSchema?.label ?? parsed.parentSchema?.target ?? parsed.parentTrace?.label ?? parsed.parentTrace?.target) {
    if (!parsed.parentOrigin) {
      findings.push({ code: "pointer-schema-parent-origin-missing", category: "schema-note-lineage", filePath: input.filePath, message: "The pointer schema must declare Parent Origin when it declares a parent.", severity: "error" });
    } else if (!parsed.parentOrigin.browseGit) {
      findings.push({ code: "pointer-schema-parent-origin-browse-git-missing", category: "schema-note-lineage", filePath: input.filePath, message: "The pointer schema must include a commit-pinned Parent Origin browse + git permalink.", severity: "error" });
    } else if (!isCommitPinnedBrowseGitTarget(parsed.parentOrigin.browseGit)) {
      findings.push({ code: "pointer-schema-parent-origin-unpinned-browse-git", category: "schema-note-lineage", filePath: input.filePath, message: "The pointer schema Parent Origin browse + git target is not commit-pinned.", severity: "error" });
    }
  }

  if ((parsed.footerIntegrity?.towardsLabel ?? parsed.footerIntegrity?.towardsTarget) !== "self" && path.basename(parsed.footerIntegrity?.towardsTarget ?? "") !== "tiinex.root.v1.schema.md") {
    findings.push({ code: "pointer-schema-footer-target-mismatch", category: "schema-note-lineage", filePath: input.filePath, message: "The pointer schema footer should target the root schema or self according to the active validation strategy.", severity: "error" });
  }
  if (parsed.footerIntegrity?.towardsTarget === "self") {
    findings.push({ code: "pointer-schema-footer-target-mismatch", category: "schema-note-lineage", filePath: input.filePath, message: "The pointer schema footer must target the root schema permalink rather than self.", severity: "error" });
  } else if (parsed.footerIntegrity?.towardsTarget && !isCommitPinnedBrowseGitTarget(parsed.footerIntegrity.towardsTarget)) {
    findings.push({ code: "pointer-schema-footer-target-not-permalink", category: "schema-note-lineage", filePath: input.filePath, message: "The pointer schema footer Towards target must be a commit-pinned browse + git permalink when the root schema permalink is available.", severity: "error" });
  } else if (parsed.parentOrigin?.browseGit && parsed.footerIntegrity?.towardsTarget && parsed.footerIntegrity.towardsTarget !== parsed.parentOrigin.browseGit) {
    findings.push({ code: "pointer-schema-footer-target-mismatch", category: "schema-note-lineage", filePath: input.filePath, message: "The pointer schema footer Towards target must match the Parent Origin browse + git permalink.", severity: "error" });
  }

  collectExpectedSchemaHeadingFindings(findings, input.filePath, parsed, { codePrefix: "pointer-schema-layout", displayName: "pointer schema", titleHeading: "Pointer", expectedSectionHeadings: POINTER_SCHEMA_EXPECTED_SECTION_HEADINGS });

  if (!parsed.schemaValidationContract?.present) {
    findings.push({ code: "pointer-schema-validation-contract-missing", category: "schema-validation-contract", filePath: input.filePath, message: "The pointer schema must include a Schema Validation Contract section.", severity: "error" });
  } else {
    addContractSectionShapeFindings(findings, input.filePath, parsed.schemaValidationContract, { codePrefix: "pointer-schema-contract", category: "schema-validation-contract", displayName: "pointer schema validation contract" });
    collectContractVocabularyFindings(findings, input.filePath, parsed.schemaValidationContract, {
      codePrefix: "pointer-schema-contract",
      category: "schema-validation-contract",
      displayName: "pointer schema validation contract",
      allowedGroupHeadings: [...POINTER_SCHEMA_VALIDATION_GROUP_HEADINGS, "Contract Category Extension", "Contract Category Override"],
      allowedCategoryLabels: [...POINTER_SCHEMA_VALIDATION_CATEGORY_LABELS, ...declaredContractCategoryLabels],
      unexpectedSeverity: unknownContractSeverity
    });
    addMissingGroupFindings(findings, input.filePath, parsed.schemaValidationContract, { codePrefix: "pointer-schema-contract", category: "schema-validation-contract", displayName: "pointer schema validation contract", requiredGroupHeadings: POINTER_SCHEMA_VALIDATION_GROUP_HEADINGS });
  }

  if (!parsed.artifactCreationContract?.present) {
    findings.push({ code: "pointer-schema-artifact-creation-contract-missing", category: "artifact-creation-contract", filePath: input.filePath, message: "The pointer schema must include an Artifact Creation Contract section.", severity: "error" });
  } else {
    addContractSectionShapeFindings(findings, input.filePath, parsed.artifactCreationContract, { codePrefix: "pointer-schema-artifact-creation-contract", category: "artifact-creation-contract", displayName: "pointer schema artifact creation contract" });
    collectContractVocabularyFindings(findings, input.filePath, parsed.artifactCreationContract, {
      codePrefix: "pointer-schema-artifact-creation-contract",
      category: "artifact-creation-contract",
      displayName: "pointer schema artifact creation contract",
      allowedGroupHeadings: POINTER_SCHEMA_ARTIFACT_CREATION_GROUP_HEADINGS,
      allowedCategoryLabels: POINTER_SCHEMA_ARTIFACT_CREATION_CATEGORY_LABELS,
      unexpectedSeverity: unknownContractSeverity
    });
    addMissingGroupFindings(findings, input.filePath, parsed.artifactCreationContract, { codePrefix: "pointer-schema-artifact-creation-contract", category: "artifact-creation-contract", displayName: "pointer schema artifact creation contract", requiredGroupHeadings: POINTER_SCHEMA_ARTIFACT_CREATION_GROUP_HEADINGS });
  }

  if (!parentSchemaPath) {
    findings.push({ code: "pointer-schema-parent-trace-unresolvable", category: "schema-note-lineage", filePath: input.filePath, message: "The pointer schema must point to a resolvable root schema trace.", severity: "error" });
  } else {
    const rootValidation = validateTraceableRootSchemaSync({ filePath: parentSchemaPath, readTextFileSync: input.readTextFileSync });
    inheritedContractCategoryLabels = getContractGroupCategoryItems(rootValidation.parsed.schemaValidationContract, "Contract Syntax", ["Known Category Labels"]);
    allowedEnvelopeFieldLabels = getContractGroupCategoryItems(rootValidation.parsed.schemaValidationContract, "Continuity Context", ["Required Fields", "Optional Fields"]);
    allowedParentFieldLabels = getContractGroupCategoryItems(rootValidation.parsed.schemaValidationContract, "Parent", ["Required Fields", "Optional Fields"]);
    allowedCurrentFieldLabels = getContractGroupCategoryItems(rootValidation.parsed.schemaValidationContract, "Current", ["Required Fields", "Optional Fields"]);
    const rootBlockingFindings = rootValidation.findings.filter((finding) => !finding.code.startsWith("continuity-"));
    if (rootBlockingFindings.length > 0) {
      findings.push({ code: "pointer-schema-parent-root-invalid", category: "schema-note-lineage", filePath: input.filePath, message: "The pointer schema points to a parent root schema that does not satisfy the root validator.", severity: "error" });
    }
    addRedeclaredInheritedContractCategoryFindings(findings, input.filePath, declaredContractCategoryLabels, inheritedContractCategoryLabels, overriddenContractCategoryLabels);
  }

  collectUnexpectedContinuityEnvelopeFieldFindings(findings, input.filePath, parsed, {
    codePrefix: "pointer-schema-lineage",
    category: "schema-note-lineage",
    displayName: "pointer schema continuity envelope",
    severity: parentSchemaPath ? "warning" : undefined,
    allowedEnvelopeFieldLabels,
    allowedParentFieldLabels,
    allowedCurrentFieldLabels
  });

  return { filePath: input.filePath, parsed, findings };
}

module.exports = {
  validateTraceablePointerSchemaSync
};