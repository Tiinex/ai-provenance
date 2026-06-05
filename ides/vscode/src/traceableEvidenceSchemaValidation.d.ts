import type { TraceableSchemaValidationResult } from "./traceableRootSchemaValidation.js";

export function validateTraceableEvidenceSchemaSync(input: {
  filePath: string;
  readTextFileSync?: (filePath: string, encoding?: string) => string;
}): TraceableSchemaValidationResult;