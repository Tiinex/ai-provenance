export type TraceableLineageIntegrityStatus =
  | "ok"
  | "legacy-no-checksum"
  | "missing-parent"
  | "unreadable-parent"
  | "checksum-mismatch"
  | "cycle-detected"
  | "disabled";

export interface TraceableDirectParentIntegrityCoreResult {
  status: TraceableLineageIntegrityStatus;
  resolvedParentTracePath?: string;
  storedParentTraceChecksumSha256?: string;
  actualParentTraceChecksumSha256?: string;
}

export interface EvaluateTraceableDirectParentIntegrityCoreInput {
  childFilePath?: string;
  resolvedParentTracePath?: string;
  storedParentTraceChecksumSha256?: string;
  knownAncestorTracePaths?: string[];
  checksumEnabled?: boolean;
}

export interface TraceableContinuityFinding {
  code:
    | "continuity-checksum-mismatch"
    | "continuity-current-created-at-missing"
    | "continuity-current-created-at-invalid"
    | "traceable-parent-missing-parent"
    | "traceable-parent-created-at-invalid"
    | "traceable-parent-created-at-missing"
    | "traceable-parent-schema-missing"
    | "traceable-parent-schema-mismatch"
    | "traceable-parent-origin-unpinned-browse-git"
    | "traceable-parent-unreadable-parent"
    | "traceable-parent-checksum-mismatch"
    | "traceable-parent-cycle-detected"
    | "schema-definition-core-contract-missing"
    | "schema-machine-validation-contract-missing"
    | "schema-validation-contract-duplicate-groups"
    | "schema-validation-contract-category-list-missing"
    | "schema-validation-contract-unlabeled-list"
    | "schema-validation-contract-star-bullets-present"
    | "schema-validation-contract-unexpected-content"
    | "artifact-creation-contract-duplicate-groups"
    | "artifact-creation-contract-category-list-missing"
    | "artifact-creation-contract-unlabeled-list"
    | "artifact-creation-contract-star-bullets-present"
    | "artifact-creation-contract-unexpected-content"
    | "schema-validation-friendly-shape-missing"
    | "root-schema-validation-contract-missing"
    | "root-schema-contract-duplicate-groups"
    | "root-schema-contract-category-list-missing"
    | "root-schema-contract-unlabeled-list"
    | "root-schema-contract-star-bullets-present"
    | "root-schema-contract-unexpected-content"
    | "root-schema-contract-groups-missing"
    | "task-required-structure-missing"
    | "runtime-required-sections-missing"
    | "runtime-recommended-sections-missing"
    | "runtime-technical-detail-sections-missing"
    | "backward-validation-unreadable-parent"
    | "backward-validation-cycle-detected";
  category:
    | "continuity-integrity"
    | "direct-parent-integrity"
    | "schema-note-structure"
    | "schema-validation-contract"
    | "artifact-creation-contract"
    | "task-structure"
    | "runtime-trace-structure"
    | "backward-traversal";
  filePath: string;
  message: string;
  severity: "error" | "warning" | "information";
  surfaces: Array<"problems" | "report">;
}

export interface TraceableContinuityValidationResult {
  rootFilePath: string;
  nodes: Array<{
    filePath: string;
    backwardLink: {
      source: "traceable-state-parent" | "parent-trace" | "parent-origin-relative" | "external-only" | "none";
      rawTarget?: string;
      resolvedPath?: string;
    };
    continuityIntegrity: {
      status: "verified" | "missing" | "mismatch" | "unsupported-method";
      method?: string;
      towardsTarget?: string;
      storedValue?: string;
      actualValue?: string;
    };
    traceableParentIntegrity?: TraceableDirectParentIntegrityCoreResult;
    runtimeTraceStructure?: {
      requiredTopLevelSectionsMissing: string[];
      recommendedTopLevelSectionsMissing: string[];
      recommendedTechnicalDetailSectionsMissing: string[];
      optionalStateSectionsPresent: string[];
    };
    parsed: {
      currentSchema?: { id?: string; target?: string; label?: string };
      parentSchema?: { id?: string; target?: string; label?: string };
      parentCreatedAt?: string;
      currentCreatedAt?: string;
      currentWhy?: string;
      currentSummary?: string;
      footerIntegrity?: { method?: string; towardsTarget?: string; value?: string };
      schemaValidationContract?: {
        present: boolean;
        groups: Array<{
          heading: string;
          categories: Array<{
            label: string;
            items: string[];
          }>;
        }>;
        duplicateGroupHeadings: string[];
        categoriesMissingLists: string[];
        unlabeledHyphenListLines: string[];
        starBulletLines: string[];
        unexpectedContentLines: string[];
      };
      artifactCreationContract?: {
        present: boolean;
        groups: Array<{
          heading: string;
          categories: Array<{
            label: string;
            items: string[];
          }>;
        }>;
        duplicateGroupHeadings: string[];
        categoriesMissingLists: string[];
        unlabeledHyphenListLines: string[];
        starBulletLines: string[];
        unexpectedContentLines: string[];
      };
    };
  }>;
  findings: TraceableContinuityFinding[];
  stoppedBecause: "complete" | "external-parent" | "unreadable-parent" | "cycle-detected" | "max-depth";
}

export function canonicalizeTraceableContinuityChecksumSource(markdown: string): string;
export function computeTraceableContinuityChecksumSha256(markdown: string): string;
export function evaluateTraceableDirectParentIntegrityCoreSync(
  input: EvaluateTraceableDirectParentIntegrityCoreInput,
  options?: { readTextFileSync?: (filePath: string) => string }
): TraceableDirectParentIntegrityCoreResult;
export function validateTraceableContinuityArtifactChainSync(input: {
  filePath: string;
  maxDepth?: number;
  readTextFileSync?: (filePath: string) => string;
}): TraceableContinuityValidationResult;
export function renderTraceableContinuityValidationMarkdown(result: TraceableContinuityValidationResult): string;