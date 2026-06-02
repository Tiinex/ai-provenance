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
    | "traceable-parent-missing-parent"
    | "traceable-parent-schema-mismatch"
    | "traceable-parent-origin-unpinned-browse-git"
    | "traceable-parent-unreadable-parent"
    | "traceable-parent-checksum-mismatch"
    | "traceable-parent-cycle-detected"
    | "schema-validation-friendly-shape-missing"
    | "runtime-required-sections-missing"
    | "runtime-recommended-sections-missing"
    | "runtime-technical-detail-sections-missing"
    | "backward-validation-unreadable-parent"
    | "backward-validation-cycle-detected";
  category:
    | "continuity-integrity"
    | "direct-parent-integrity"
    | "schema-note-structure"
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
      footerIntegrity?: { method?: string; towardsTarget?: string; value?: string };
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