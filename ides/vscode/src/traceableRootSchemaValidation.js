const {
  addContractSectionShapeFindings,
  collectContractVocabularyFindings,
  collectExpectedSchemaHeadingFindings,
  collectUnexpectedContinuityEnvelopeFieldFindings,
  evaluateContinuityIntegrity,
  getContractGroupCategoryItems,
  isTraceableContinuityTimestamp,
  parseSchemaNoteMarkdown,
  readSchemaFileSync,
  resolveRelativeSchemaPath
} = require("./traceableSchemaValidationShared.js");

const ROOT_SCHEMA_REQUIRED_CONTRACT_GROUPS = [
  "Machine Authority Surfaces",
  "Contract Syntax",
  "Validator Response Policy",
  "Unknown Handling",
  "Matching And Normalization",
  "Inheritance And Override",
  "Contract Cardinality",
  "Named Declaration",
  "Contract Category Extension",
  "Contract Category Override",
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

const ROOT_SCHEMA_EXPECTED_SECTION_HEADINGS = [
  "Summary",
  "Root Semantics",
  "Contract Reading Model",
  "Inheritance",
  "Extension",
  "Schema Validation Contract"
];

function getRootKnownCategoryLabels(contract) {
  return getContractGroupCategoryItems(contract, "Contract Syntax", ["Known Category Labels"]);
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

function validateTraceableRootSchemaSync(input) {
  const markdown = readSchemaFileSync(input.filePath, input.readTextFileSync);
  const parsed = parseSchemaNoteMarkdown(markdown);
  const findings = [];
  const continuityIntegrity = evaluateContinuityIntegrity(markdown, parsed.footerIntegrity, {
    filePath: input.filePath,
    readTextFileSync: input.readTextFileSync
  });
  const envelopeSchemaPath = resolveRelativeSchemaPath(input.filePath, parsed.envelopeSchema?.target);
  const currentSchemaPath = resolveRelativeSchemaPath(input.filePath, parsed.currentSchema?.target);

  if (!parsed.currentCreatedAt) {
    findings.push({
      code: "continuity-current-created-at-missing",
      category: "continuity-integrity",
      filePath: input.filePath,
      message: "Current Created At is required by the continuity envelope.",
      severity: "error"
    });
  } else if (!isTraceableContinuityTimestamp(parsed.currentCreatedAt)) {
    findings.push({
      code: "continuity-current-created-at-invalid",
      category: "continuity-integrity",
      filePath: input.filePath,
      message: "Current Created At is not in the expected YYYY-MM-DD hh:mm:ss shape.",
      severity: "error"
    });
  }

  if (continuityIntegrity.status === "mismatch" || continuityIntegrity.status === "target-unreadable") {
    findings.push({
      code: "continuity-checksum-mismatch",
      category: "continuity-integrity",
      filePath: input.filePath,
      message: continuityIntegrity.status === "target-unreadable"
        ? "Continuity footer checksum target could not be read."
        : "Continuity footer checksum does not match the declared target artifact.",
      severity: "error"
    });
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

  if ((parsed.currentSchema?.label ?? parsed.currentSchema?.target) !== "tiinex.root.v1") {
    findings.push({
      code: "root-schema-current-schema-mismatch",
      category: "schema-note-lineage",
      filePath: input.filePath,
      message: "The root validator expects Current Schema to be tiinex.root.v1.",
      severity: "error"
    });
  }

  if ((parsed.envelopeSchema?.label ?? parsed.envelopeSchema?.target) !== "tiinex.root.v1") {
    findings.push({
      code: "root-schema-envelope-schema-mismatch",
      category: "schema-note-lineage",
      filePath: input.filePath,
      message: "The root validator expects Envelope Schema to be tiinex.root.v1.",
      severity: "error"
    });
  }

  if (!canReadResolvedSchemaPath(envelopeSchemaPath, input.readTextFileSync)) {
    findings.push({
      code: "root-schema-envelope-schema-unreadable",
      category: "schema-note-lineage",
      filePath: input.filePath,
      message: "The root schema Envelope Schema target could not be read.",
      severity: "error"
    });
  }

  if (!canReadResolvedSchemaPath(currentSchemaPath, input.readTextFileSync)) {
    findings.push({
      code: "root-schema-current-schema-unreadable",
      category: "schema-note-lineage",
      filePath: input.filePath,
      message: "The root schema Current Schema target could not be read.",
      severity: "error"
    });
  }

  if (parsed.parentSchema?.label || parsed.parentSchema?.target) {
    findings.push({
      code: "root-schema-parent-present",
      category: "schema-note-lineage",
      filePath: input.filePath,
      message: "The root schema should not declare a parent schema.",
      severity: "error"
    });
  }

  collectUnexpectedContinuityEnvelopeFieldFindings(findings, input.filePath, parsed, {
    codePrefix: "root-schema-lineage",
    category: "schema-note-lineage",
    displayName: "root schema continuity envelope",
    severity: "warning",
    allowedEnvelopeFieldLabels: getContractGroupCategoryItems(parsed.schemaValidationContract, "Continuity Context", ["Required Fields", "Optional Fields"]),
    allowedParentFieldLabels: getContractGroupCategoryItems(parsed.schemaValidationContract, "Parent", ["Required Fields", "Optional Fields"]),
    allowedCurrentFieldLabels: getContractGroupCategoryItems(parsed.schemaValidationContract, "Current", ["Required Fields", "Optional Fields"])
  });

  collectExpectedSchemaHeadingFindings(findings, input.filePath, parsed, {
    codePrefix: "root-schema-layout",
    displayName: "root schema",
    titleHeading: "Root",
    expectedSectionHeadings: ROOT_SCHEMA_EXPECTED_SECTION_HEADINGS
  });

  if (!parsed.schemaValidationContract?.present) {
    findings.push({
      code: "root-schema-validation-contract-missing",
      category: "schema-validation-contract",
      filePath: input.filePath,
      message: "The root schema must include a Schema Validation Contract section.",
      severity: "error"
    });
  } else {
    addContractSectionShapeFindings(findings, input.filePath, parsed.schemaValidationContract, {
      codePrefix: "root-schema-contract",
      category: "schema-validation-contract",
      displayName: "root schema validation contract"
    });
    const groupHeadings = new Set(parsed.schemaValidationContract.groups.map((group) => group.heading));
    const missingGroups = ROOT_SCHEMA_REQUIRED_CONTRACT_GROUPS.filter((heading) => !groupHeadings.has(heading));
    if (missingGroups.length > 0) {
      findings.push({
        code: "root-schema-contract-groups-missing",
        category: "schema-validation-contract",
        filePath: input.filePath,
        message: `The root schema contract is missing required groups: ${missingGroups.join(", ")}.`,
        severity: "error"
      });
    }

    const knownCategoryLabels = getRootKnownCategoryLabels(parsed.schemaValidationContract);
    if (knownCategoryLabels.length > 0) {
      collectContractVocabularyFindings(findings, input.filePath, parsed.schemaValidationContract, {
        codePrefix: "root-schema-contract",
        category: "schema-validation-contract",
        displayName: "root schema validation contract",
        allowedCategoryLabels: knownCategoryLabels
      });
    }
  }

  return {
    filePath: input.filePath,
    parsed,
    findings
  };
}

module.exports = {
  validateTraceableRootSchemaSync
};