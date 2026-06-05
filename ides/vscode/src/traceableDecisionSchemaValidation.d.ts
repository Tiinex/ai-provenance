import type { TraceableSchemaValidationResult } from "./traceableRootSchemaValidation.js";

export function validateTraceableDecisionSchemaSync(input: {
  filePath: string;
  readTextFileSync?: (filePath: string, encoding?: string) => string;
}): TraceableSchemaValidationResult;