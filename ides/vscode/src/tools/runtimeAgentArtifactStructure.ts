import { readFileSync } from "node:fs";

// This module defines the currently supported workspace runtime-agent artifact shape.
// It does not make the parked historical repo-owned agent pack authoritative for this checkout.

export type StructureVerdict = "PASS" | "FAIL";

export interface RuntimeArtifactAuditResult {
  structureVerdict: StructureVerdict;
  frontmatterKeys: string[];
  sectionFindings: string[];
  failureReasons: string[];
  supportEvidenceMarkers: string[];
}

const ALWAYS_ALLOWED_RUNTIME_FIELDS = new Set([
  "name",
  "description",
  "model",
  "models",
  "target",
  "disable-model-invocation",
  "tools",
  "user-invocable"
]);
const CONDITIONALLY_ALLOWED_RUNTIME_FIELDS = new Set(["handoffs"]);

// This is the current contract for workspace runtime-agent artifacts that use
// the supported `.github/agents/*.agent.md` mechanism. It is intentionally
// strict for validation and evidence purposes, but it should not be mistaken
// for a claim that no future runtime-agent shape could ever exist.
const CANONICAL_SECTION_TITLES = [
  "IDENTITY",
  "PURPOSE",
  "SCOPE",
  "NON-GOALS",
  "OPERATING MODEL",
  "INPUTS",
  "OUTPUTS",
  "PROCESS",
  "DECISION RULES",
  "CONSTRAINTS",
  "HANDOFF RULES",
  "VALIDATION",
  "MAINTENANCE RULES"
] as const;

const WORKSPACE_RUNTIME_AGENT_PATH_RE = /(?:^|\/)\.github\/agents\/(?!companions\/)[^/]+\.agent\.md$/u;
const WORKSPACE_COMPANION_PATH_RE = /(?:^|\/)\.github\/agents\/companions\/[^/]+$/u;
const ALLOWED_WORKSPACE_COMPANION_PATH_RE = /(?:^|\/)\.github\/agents\/companions\/[^/]+\.agent\.(design|test|testdata)\.md$/u;

export function normalizeArtifactPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function isRuntimeAgentArtifactPath(filePath: string): boolean {
  return WORKSPACE_RUNTIME_AGENT_PATH_RE.test(normalizeArtifactPath(filePath));
}

export function isCompanionArtifactPath(filePath: string): boolean {
  return WORKSPACE_COMPANION_PATH_RE.test(normalizeArtifactPath(filePath));
}

export function isAllowedCompanionArtifactPath(filePath: string): boolean {
  return ALLOWED_WORKSPACE_COMPANION_PATH_RE.test(normalizeArtifactPath(filePath));
}

export function auditRuntimeAgentArtifactFile(filePath: string): RuntimeArtifactAuditResult {
  const text = readFileSync(filePath, "utf-8");
  return auditRuntimeAgentArtifactText(text);
}

export function auditRuntimeAgentArtifactText(text: string): RuntimeArtifactAuditResult {
  const failureReasons: string[] = [];
  const sectionFindings: string[] = [];
  const frontmatterKeys: string[] = [];

  // The audit checks the current supported workspace runtime-agent contract.
  // Parked historical repo artifacts remain useful lineage, but they are not
  // the authority for this contract in the current checkout.
  const frontmatterMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!frontmatterMatch) {
    failureReasons.push("missing_yaml_frontmatter");
  } else {
    for (const rawLine of frontmatterMatch[1].split(/\r?\n/u)) {
      if (!/^[A-Za-z][A-Za-z0-9-]*\s*:/u.test(rawLine)) {
        continue;
      }
      const [key] = rawLine.split(":", 1);
      frontmatterKeys.push(key.trim());
    }

    for (const key of frontmatterKeys) {
      if (!ALWAYS_ALLOWED_RUNTIME_FIELDS.has(key) && !CONDITIONALLY_ALLOWED_RUNTIME_FIELDS.has(key)) {
        failureReasons.push(`unsupported_frontmatter_field:${key}`);
      }
    }
    if (frontmatterKeys.includes("model") && frontmatterKeys.includes("models")) {
      failureReasons.push("conflicting_model_and_models_frontmatter");
    }
  }

  const headings = [...text.matchAll(/^##\s+(\d+)\s+(.+)$/gmu)].map((match) => ({
    number: Number(match[1]),
    title: match[2].trim(),
    full: match[0].trim()
  }));

  for (let index = 0; index < CANONICAL_SECTION_TITLES.length; index += 1) {
    const expectedLine = `## ${index} ${CANONICAL_SECTION_TITLES[index]}`;
    const matching = headings.filter((heading) => heading.number === index);
    if (matching.length !== 1) {
      sectionFindings.push(`section_${index}:expected_once_found_${matching.length}`);
      failureReasons.push(`section_${index}_missing_or_duplicated`);
      continue;
    }

    if (matching[0].full !== expectedLine) {
      sectionFindings.push(`section_${index}:found_${matching[0].full}:expected_${expectedLine}`);
      failureReasons.push(`section_${index}_title_mismatch`);
    } else {
      sectionFindings.push(`section_${index}:PASS`);
    }
  }

  let previousHeadingIndex = -1;
  for (let index = 0; index < CANONICAL_SECTION_TITLES.length; index += 1) {
    const headingIndex = headings.findIndex((heading) => heading.number === index);
    if (headingIndex !== -1 && headingIndex <= previousHeadingIndex) {
      failureReasons.push("section_order_invalid");
      break;
    }
    if (headingIndex !== -1) {
      previousHeadingIndex = headingIndex;
    }
  }

  const validationSectionMatch = text.match(/## 11 VALIDATION\r?\n([\s\S]*?)(?:\r?\n## 12 MAINTENANCE RULES|$)/u);
  const validationSection = validationSectionMatch?.[1] ?? "";
  const supportEvidenceMarkers: string[] = [];

  if (/^Creation evidence:\s*$/mu.test(validationSection)) {
    supportEvidenceMarkers.push("creation_evidence_block");
  }
  if (/^\s*-?\s*created_by\s*:/mu.test(validationSection)) {
    supportEvidenceMarkers.push("created_by_field");
  }
  if (/^\s*-?\s*created_path\s*:/mu.test(validationSection)) {
    supportEvidenceMarkers.push("created_path_field");
  }
  if (/^\s*-?\s*basis\s*:/mu.test(validationSection)) {
    supportEvidenceMarkers.push("basis_field");
  }

  if (supportEvidenceMarkers.length > 0) {
    failureReasons.push("runtime_support_evidence_embedded_in_validation_section");
  }

  return {
    structureVerdict: failureReasons.length === 0 ? "PASS" : "FAIL",
    frontmatterKeys,
    sectionFindings,
    failureReasons,
    supportEvidenceMarkers
  };
}