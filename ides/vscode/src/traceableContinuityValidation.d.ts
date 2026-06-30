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
    | "continuity-checksum-missing"
    | "continuity-checksum-mismatch"
    | "continuity-checksum-v1-legacy"
    | "continuity-footer-self-required-without-parent"
    | "continuity-footer-towards-permalink-required"
    | "continuity-footer-towards-unreadable"
    | "continuity-current-created-at-missing"
    | "continuity-current-created-at-invalid"
    | "traceable-envelope-schema-permalink-required"
    | "traceable-envelope-schema-unreadable"
    | "traceable-current-origin-browse-git-permalink-required"
    | "traceable-current-origin-browse-git-unreadable"
    | "traceable-current-schema-permalink-required"
    | "traceable-current-schema-unreadable"
    | "traceable-parent-missing-parent"
    | "traceable-parent-created-at-invalid"
    | "traceable-parent-created-at-missing"
    | "traceable-parent-trace-unresolvable"
    | "traceable-parent-trace-unreadable"
    | "traceable-parent-schema-permalink-required"
    | "traceable-parent-schema-missing"
    | "traceable-parent-schema-unreadable"
    | "traceable-parent-schema-mismatch"
    | "traceable-parent-origin-unpinned-browse-git"
    | "traceable-parent-unreadable-parent"
    | "traceable-parent-checksum-mismatch"
    | "traceable-parent-cycle-detected"
    | "schema-note-core-contract-missing"
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
    | "topic-required-structure-missing"
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
    | "topic-structure"
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
      source: "traceable-state-parent" | "parent-trace" | "parent-origin-relative" | "parent-origin-absolute" | "external-only" | "none";
      rawTarget?: string;
      resolvedPath?: string;
    };
    continuityIntegrity: {
      status: "verified" | "missing" | "mismatch" | "unsupported-method" | "target-unreadable";
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
      envelopeSchema?: { id?: string; target?: string; label?: string };
      currentSchema?: { id?: string; target?: string; label?: string };
      parentSchema?: { id?: string; target?: string; label?: string };
      parentCreatedAt?: string;
      parentTrace?: { label?: string; target?: string };
      parentOrigin?: { relative?: string; absolute?: string; browseGit?: string };
      currentOrigin?: { relative?: string; absolute?: string; browseGit?: string };
      currentCreatedAt?: string;
      currentWhy?: string;
      currentSummary?: string;
      footerIntegrity?: { method?: string; towardsLabel?: string; towardsTarget?: string; value?: string };
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

export interface ParsedTraceableContinuityMarkdown {
  envelopeSchema?: { id?: string; target?: string; label?: string };
  currentSchema?: { id?: string; target?: string; label?: string };
  parentSchema?: { id?: string; target?: string; label?: string };
  parentCreatedAt?: string;
  parentTrace?: { label?: string; target?: string };
  parentOrigin?: { relative?: string; absolute?: string; browseGit?: string };
  currentOrigin?: { relative?: string; absolute?: string; browseGit?: string };
  currentCreatedAt?: string;
  currentWhy?: string;
  currentSummary?: string;
  footerIntegrity?: {
    method?: string;
    towardsLabel?: string;
    towardsTarget?: string;
    value?: string;
    entries?: Array<{ method?: string; towardsLabel?: string; towardsTarget?: string; value?: string }>;
  };
}

export function canonicalizeTraceableContinuityChecksumSource(markdown: string): string;
export function computeTraceableContinuityChecksumSha256(markdown: string, method?: string): string;
export function computeTargetedTraceableContinuityChecksumSha256(
  filePath: string | undefined,
  markdown: string,
  footerIntegrity: { method?: string; towardsLabel?: string; towardsTarget?: string; value?: string } | undefined,
  readTextFileSync?: (filePath: string) => string,
  workspaceRoots?: Array<{ name?: string; fsPath: string }>
): string | undefined;
export function evaluateTraceableDirectParentIntegrityCoreSync(
  input: EvaluateTraceableDirectParentIntegrityCoreInput,
  options?: { readTextFileSync?: (filePath: string) => string }
): TraceableDirectParentIntegrityCoreResult;
export function parseTraceableContinuityMarkdown(markdown: string): ParsedTraceableContinuityMarkdown;
export function validateTraceableContinuityArtifactChainSync(input: {
  filePath: string;
  maxDepth?: number;
  readTextFileSync?: (filePath: string) => string;
  workspaceRoots?: Array<{ name?: string; fsPath: string }>;
  gitRevisionExistsSync?: (repoRoot: string, revision: string) => boolean | undefined;
  gitRevisionPathReadableSync?: (repoRoot: string, revision: string, relativePath: string) => boolean | undefined;
}): TraceableContinuityValidationResult;
export function renderTraceableContinuityValidationMarkdown(result: TraceableContinuityValidationResult): string;