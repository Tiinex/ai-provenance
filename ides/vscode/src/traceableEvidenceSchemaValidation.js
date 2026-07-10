const path = require("node:path");
const {
  addContractSectionShapeFindings,
  collectInheritedRootContractContext,
  collectContractVocabularyFindings,
  collectExpectedSchemaHeadingFindings,
  collectUnexpectedContinuityEnvelopeFieldFindings,
  evaluateContinuityIntegrity,
  getLatestNonSelfFooterTowardsTarget,
  getContractGroupCategoryItems,
  isCommitPinnedBrowseGitTarget,
  isTraceableContinuityTimestamp,
  parseSchemaNoteMarkdown,
  readSchemaFileSync,
  resolveRelativeSchemaPath
} = require("./traceableSchemaValidationShared.js");
const { validateTraceableRootSchemaSync } = require("./traceableRootSchemaValidation.js");

const EVIDENCE_SCHEMA_EXPECTED_SECTION_HEADINGS = [
  "Summary",
  "Schema Validation Contract",
  "Artifact Creation Contract",
  "Minimal Example",
  "Validation-Friendly Shape",
  "Interpretation Notes"
];

const EVIDENCE_SCHEMA_VALIDATION_GROUP_HEADINGS = [
  "Evidence Scope",
  "Parent Preservation Specialization",
  "Evidence Body",
  "Supported Claim Or Question",
  "Provenance",
  "Evidence Material",
  "Preservation And Fidelity",
  "Interpretation Limits",
  "File Naming",
  "Interpretation Boundaries"
];

const EVIDENCE_SCHEMA_VALIDATION_CATEGORY_LABELS = [
  "Allowed Shapes",
  "Applies To",
  "Optional Fields",
  "Optional Sections",
  "Required Fields",
  "Required Shape",
  "Rules"
];

const EVIDENCE_SCHEMA_ARTIFACT_CREATION_GROUP_HEADINGS = [
  "Creation Fields",
  "Creation Rules"
];

const EVIDENCE_SCHEMA_ARTIFACT_CREATION_CATEGORY_LABELS = [
  "Required Fields",
  "Rules"
];

function addMissingGroupFindings(findings, filePath, contract, options) {
  const presentGroupHeadings = new Set(contract.groups.map((group) => group.heading));
  const missingGroups = options.requiredGroupHeadings.filter((heading) => !presentGroupHeadings.has(heading));
  if (missingGroups.length === 0) {
    return;
  }
  findings.push({ code: `${options.codePrefix}-groups-missing`, category: options.category, filePath, message: `The ${options.displayName} is missing required groups: ${missingGroups.join(", ")}.`, severity: "error" });
}

function addRedeclaredInheritedContractCategoryFindings(findings, filePath, declaredCategoryLabels, inheritedCategoryLabels, overriddenCategoryLabels) {
  const overrideLabelSet = new Set(overriddenCategoryLabels);
  const inheritedLabelSet = new Set(inheritedCategoryLabels);
  const redeclaredLabels = declaredCategoryLabels.filter((label) => inheritedLabelSet.has(label) && !overrideLabelSet.has(label));
  if (redeclaredLabels.length === 0) {
    return;
  }
  findings.push({ code: "evidence-schema-contract-extension-redeclares-inherited-category-label", category: "schema-validation-contract", filePath, message: `Contract Category Extension redeclares inherited category labels without explicit override semantics: ${redeclaredLabels.join(", ")}.`, severity: "error" });
}

function collectEvidenceArtifactCreationContractFindings(findings, filePath, markdown) {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const startIndex = lines.findIndex((line) => line.trim() === "## Artifact Creation Contract");
  if (startIndex < 0) {
    findings.push({ code: "evidence-schema-artifact-creation-contract-missing", category: "artifact-creation-contract", filePath, message: "The evidence schema must include an Artifact Creation Contract section.", severity: "error" });
    return;
  }

  const seenGroupHeadings = [];
  const seenCategoryLabels = [];
  const unexpectedContentLines = [];
  const emptyCategories = [];
  const emptyGroups = [];
  let currentGroupHeading;
  let currentCategoryLabel;
  let currentCategoryItemCount = 0;

  const finalizeCurrentCategory = () => {
    if (currentCategoryLabel && currentCategoryItemCount === 0) {
      emptyCategories.push(currentCategoryLabel);
    }
  };

  const finalizeCurrentGroup = () => {
    if (currentGroupHeading && !currentCategoryLabel && currentGroupHeading !== "Creation Rules") {
      emptyGroups.push(currentGroupHeading);
    }
  };

  for (const line of lines.slice(startIndex + 1)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed === "---" || /^##\s+/u.test(trimmed) || /^#\s+/u.test(trimmed)) {
      break;
    }
    if (/^###\s+/u.test(trimmed)) {
      finalizeCurrentCategory();
      finalizeCurrentGroup();
      currentGroupHeading = trimmed.replace(/^###\s+/u, "").trim();
      currentCategoryLabel = undefined;
      currentCategoryItemCount = 0;
      seenGroupHeadings.push(currentGroupHeading);
      continue;
    }
    if (EVIDENCE_SCHEMA_ARTIFACT_CREATION_CATEGORY_LABELS.includes(trimmed)) {
      if (!currentGroupHeading) {
        unexpectedContentLines.push(trimmed);
        continue;
      }
      finalizeCurrentCategory();
      currentCategoryLabel = trimmed;
      currentCategoryItemCount = 0;
      seenCategoryLabels.push(currentCategoryLabel);
      continue;
    }
    if (/^-\s+/u.test(trimmed)) {
      if (!currentCategoryLabel) {
        unexpectedContentLines.push(trimmed);
        continue;
      }
      currentCategoryItemCount += 1;
      continue;
    }
    unexpectedContentLines.push(trimmed);
  }
  finalizeCurrentCategory();
  finalizeCurrentGroup();

  const missingGroups = EVIDENCE_SCHEMA_ARTIFACT_CREATION_GROUP_HEADINGS.filter((heading) => !seenGroupHeadings.includes(heading));
  if (missingGroups.length > 0) {
    findings.push({ code: "evidence-schema-artifact-creation-contract-groups-missing", category: "artifact-creation-contract", filePath, message: `The evidence schema artifact creation contract is missing required groups: ${missingGroups.join(", ")}.`, severity: "error" });
  }
  if (emptyGroups.length > 0) {
    findings.push({ code: "evidence-schema-artifact-creation-contract-groups-empty", category: "artifact-creation-contract", filePath, message: `The evidence schema artifact creation contract has empty groups: ${emptyGroups.join(", ")}.`, severity: "error" });
  }
  if (emptyCategories.length > 0) {
    findings.push({ code: "evidence-schema-artifact-creation-contract-category-list-missing", category: "artifact-creation-contract", filePath, message: `The evidence schema artifact creation contract has category labels without a following hyphen list: ${emptyCategories.join(", ")}.`, severity: "error" });
  }
  if (unexpectedContentLines.length > 0) {
    findings.push({ code: "evidence-schema-artifact-creation-contract-unexpected-content", category: "artifact-creation-contract", filePath, message: `The evidence schema artifact creation contract contains content outside the allowed heading/list shape: ${unexpectedContentLines.join(", ")}.`, severity: "error" });
  }
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

function validateTraceableEvidenceSchemaSync(input) {
  const markdown = readSchemaFileSync(input.filePath, input.readTextFileSync);
  const parsed = parseSchemaNoteMarkdown(markdown);
  const findings = [];
  const continuityIntegrity = evaluateContinuityIntegrity(markdown, parsed.footerIntegrity, { filePath: input.filePath, readTextFileSync: input.readTextFileSync });
  const envelopeSchemaPath = resolveRelativeSchemaPath(input.filePath, parsed.envelopeSchema?.target);
  const currentSchemaPath = resolveRelativeSchemaPath(input.filePath, parsed.currentSchema?.target);
  const declaredParentSchemaPath = resolveRelativeSchemaPath(input.filePath, parsed.parentSchema?.target);
  const parentSchemaPath = resolveRelativeSchemaPath(input.filePath, parsed.parentTrace?.target);
  const expectedParentCreatedAt = resolveExpectedParentCreatedAt(input.filePath, parsed, input.readTextFileSync);
  const unknownContractSeverity = parentSchemaPath ? "error" : "warning";
  const declaredContractCategoryLabels = parsed.schemaValidationContract?.groups.filter((group) => group.heading === "Contract Category Extension").flatMap((group) => group.declarations?.map((declaration) => declaration.name) ?? []) ?? [];
  const overriddenContractCategoryLabels = parsed.schemaValidationContract?.groups.filter((group) => group.heading === "Contract Category Override").flatMap((group) => group.declarations?.map((declaration) => declaration.name) ?? []) ?? [];
  const rootContractContext = collectInheritedRootContractContext(input.filePath, parsed, input.readTextFileSync, {
    authorityTarget: parsed.envelopeSchema?.target,
    validateRootSchemaSync: validateTraceableRootSchemaSync
  });
  let allowedEnvelopeFieldLabels = rootContractContext.allowedEnvelopeFieldLabels;
  let allowedParentFieldLabels = rootContractContext.allowedParentFieldLabels;
  let allowedCurrentFieldLabels = rootContractContext.allowedCurrentFieldLabels;
  let inheritedContractCategoryLabels = rootContractContext.inheritedContractCategoryLabels;

  if (!parsed.currentCreatedAt) {
    findings.push({ code: "continuity-current-created-at-missing", category: "continuity-integrity", filePath: input.filePath, message: "Current Created At is required by the continuity envelope.", severity: "error" });
  } else if (!isTraceableContinuityTimestamp(parsed.currentCreatedAt)) {
    findings.push({ code: "continuity-current-created-at-invalid", category: "continuity-integrity", filePath: input.filePath, message: "Current Created At is not in the expected YYYY-MM-DD hh:mm:ss shape.", severity: "error" });
  }
  if (parentSchemaPath && !parsed.parentCreatedAt) {
    findings.push({ code: "evidence-schema-parent-created-at-missing", category: "schema-note-lineage", filePath: input.filePath, message: "The evidence schema Parent Created At is required when a parent trace is declared.", severity: "error" });
  } else if (parsed.parentCreatedAt && !isTraceableContinuityTimestamp(parsed.parentCreatedAt)) {
    findings.push({ code: "evidence-schema-parent-created-at-invalid", category: "schema-note-lineage", filePath: input.filePath, message: "The evidence schema Parent Created At is not in the expected YYYY-MM-DD hh:mm:ss shape.", severity: "error" });
  } else if (parsed.parentCreatedAt && expectedParentCreatedAt && parsed.parentCreatedAt !== expectedParentCreatedAt) {
    findings.push({ code: "evidence-schema-parent-created-at-mismatch", category: "schema-note-lineage", filePath: input.filePath, message: `The evidence schema Parent Created At must match the parent artifact Current Created At: ${expectedParentCreatedAt}.`, severity: "error" });
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
  if ((parsed.currentSchema?.label ?? parsed.currentSchema?.target) !== "tiinex.evidence.v1") {
    findings.push({ code: "evidence-schema-current-schema-mismatch", category: "schema-note-lineage", filePath: input.filePath, message: "The evidence validator expects Current Schema to be tiinex.evidence.v1.", severity: "error" });
  }
  if ((parsed.envelopeSchema?.label ?? parsed.envelopeSchema?.target) !== "tiinex.root.v1") {
    findings.push({ code: "evidence-schema-envelope-schema-mismatch", category: "schema-note-lineage", filePath: input.filePath, message: "The evidence schema must declare tiinex.root.v1 as its Envelope Schema.", severity: "error" });
  }
  if (!canReadResolvedSchemaPath(envelopeSchemaPath, input.readTextFileSync)) {
    findings.push({ code: "evidence-schema-envelope-schema-unreadable", category: "schema-note-lineage", filePath: input.filePath, message: "The evidence schema Envelope Schema target could not be read.", severity: "error" });
  }
  if (!canReadResolvedSchemaPath(currentSchemaPath, input.readTextFileSync)) {
    findings.push({ code: "evidence-schema-current-schema-unreadable", category: "schema-note-lineage", filePath: input.filePath, message: "The evidence schema Current Schema target could not be read.", severity: "error" });
  }
  if ((parsed.parentSchema?.label ?? parsed.parentSchema?.target) !== "tiinex.preservation.v1") {
    findings.push({ code: "evidence-schema-parent-schema-mismatch", category: "schema-note-lineage", filePath: input.filePath, message: "The evidence schema must declare tiinex.preservation.v1 as its direct parent schema.", severity: "error" });
  }
  if (!canReadResolvedSchemaPath(declaredParentSchemaPath, input.readTextFileSync)) {
    findings.push({ code: "evidence-schema-parent-schema-unreadable", category: "schema-note-lineage", filePath: input.filePath, message: "The evidence schema Parent Schema target could not be read.", severity: "error" });
  }
  if (parsed.parentSchema?.label ?? parsed.parentSchema?.target ?? parsed.parentTrace?.label ?? parsed.parentTrace?.target) {
    if (!parsed.parentOrigin) {
      findings.push({ code: "evidence-schema-parent-origin-missing", category: "schema-note-lineage", filePath: input.filePath, message: "The evidence schema must declare Parent Origin when it declares a parent.", severity: "error" });
    } else if (!parsed.parentOrigin.browseGit) {
      findings.push({ code: "evidence-schema-parent-origin-browse-git-missing", category: "schema-note-lineage", filePath: input.filePath, message: "The evidence schema must include a commit-pinned Parent Origin browse + git permalink.", severity: "error" });
    } else if (!isCommitPinnedBrowseGitTarget(parsed.parentOrigin.browseGit)) {
      findings.push({ code: "evidence-schema-parent-origin-unpinned-browse-git", category: "schema-note-lineage", filePath: input.filePath, message: "The evidence schema Parent Origin browse + git target is not commit-pinned.", severity: "error" });
    }
  }
  const hasFooterIntegrityEntry = Boolean(
    parsed.footerIntegrity?.entries?.length
    || parsed.footerIntegrity?.method
    || parsed.footerIntegrity?.value
    || parsed.footerIntegrity?.towardsTarget
    || parsed.footerIntegrity?.towardsLabel
  );
  if (!hasFooterIntegrityEntry) {
    findings.push({ code: "evidence-schema-footer-missing", category: "continuity-integrity", filePath: input.filePath, message: "The evidence schema is missing a Continuity Integrity footer.", severity: "error" });
  } else {
    if ((parsed.footerIntegrity?.towardsLabel ?? parsed.footerIntegrity?.towardsTarget) !== "self"
      && parsed.footerIntegrity?.towardsTarget !== parsed.parentOrigin?.browseGit) {
      findings.push({ code: "evidence-schema-footer-target-mismatch", category: "schema-note-lineage", filePath: input.filePath, message: "The evidence schema footer should target the declared parent-schema permalink or self according to the active validation strategy.", severity: "error" });
    }
    const footerComparisonTarget = getLatestNonSelfFooterTowardsTarget(parsed.footerIntegrity);
    if (parsed.footerIntegrity?.towardsTarget === "self" && !footerComparisonTarget) {
      findings.push({ code: "evidence-schema-footer-target-mismatch", category: "schema-note-lineage", filePath: input.filePath, message: "The evidence schema footer must include the declared parent-schema permalink alongside the self entry.", severity: "error" });
    } else if (footerComparisonTarget && !isCommitPinnedBrowseGitTarget(footerComparisonTarget)) {
      findings.push({ code: "evidence-schema-footer-target-not-permalink", category: "schema-note-lineage", filePath: input.filePath, message: "The evidence schema footer Towards target must be a commit-pinned browse + git permalink when the parent schema permalink is available.", severity: "error" });
    } else if (parsed.parentOrigin?.browseGit && footerComparisonTarget && footerComparisonTarget !== parsed.parentOrigin.browseGit) {
      findings.push({ code: "evidence-schema-footer-target-mismatch", category: "schema-note-lineage", filePath: input.filePath, message: "The evidence schema footer Towards target must match the Parent Origin browse + git permalink.", severity: "error" });
    }
  }
  collectExpectedSchemaHeadingFindings(findings, input.filePath, parsed, { codePrefix: "evidence-schema-layout", displayName: "evidence schema", titleHeading: "Evidence", expectedSectionHeadings: EVIDENCE_SCHEMA_EXPECTED_SECTION_HEADINGS });
  if (!parsed.schemaValidationContract?.present) {
    findings.push({ code: "evidence-schema-validation-contract-missing", category: "schema-validation-contract", filePath: input.filePath, message: "The evidence schema must include a Schema Validation Contract section.", severity: "error" });
  } else {
    addContractSectionShapeFindings(findings, input.filePath, parsed.schemaValidationContract, { codePrefix: "evidence-schema-contract", category: "schema-validation-contract", displayName: "evidence schema validation contract" });
    collectContractVocabularyFindings(findings, input.filePath, parsed.schemaValidationContract, { codePrefix: "evidence-schema-contract", category: "schema-validation-contract", displayName: "evidence schema validation contract", allowedGroupHeadings: [...EVIDENCE_SCHEMA_VALIDATION_GROUP_HEADINGS, "Contract Category Extension", "Contract Category Override"], allowedCategoryLabels: [...EVIDENCE_SCHEMA_VALIDATION_CATEGORY_LABELS, ...declaredContractCategoryLabels], unexpectedSeverity: unknownContractSeverity });
    addMissingGroupFindings(findings, input.filePath, parsed.schemaValidationContract, { codePrefix: "evidence-schema-contract", category: "schema-validation-contract", displayName: "evidence schema validation contract", requiredGroupHeadings: EVIDENCE_SCHEMA_VALIDATION_GROUP_HEADINGS });
  }
  collectEvidenceArtifactCreationContractFindings(findings, input.filePath, markdown);
  if (!parentSchemaPath) {
    findings.push({ code: "evidence-schema-parent-trace-unresolvable", category: "schema-note-lineage", filePath: input.filePath, message: "The evidence schema must point to a resolvable parent schema trace.", severity: "error" });
  } else {
    if (rootContractContext.rootBlockingFindings.length > 0) {
      findings.push({ code: "evidence-schema-envelope-root-invalid", category: "schema-note-lineage", filePath: input.filePath, message: "The evidence schema points to an envelope root schema that does not satisfy the root validator.", severity: "error" });
    }
    addRedeclaredInheritedContractCategoryFindings(findings, input.filePath, declaredContractCategoryLabels, inheritedContractCategoryLabels, overriddenContractCategoryLabels);
  }
  collectUnexpectedContinuityEnvelopeFieldFindings(findings, input.filePath, parsed, { codePrefix: "evidence-schema-lineage", category: "schema-note-lineage", displayName: "evidence schema continuity envelope", severity: parentSchemaPath ? "warning" : undefined, allowedEnvelopeFieldLabels, allowedParentFieldLabels, allowedCurrentFieldLabels });
  return { filePath: input.filePath, parsed, findings };
}

module.exports = {
  validateTraceableEvidenceSchemaSync
};