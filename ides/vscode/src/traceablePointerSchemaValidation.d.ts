import type { TraceableSchemaValidationResult } from "./traceableRootSchemaValidation.js";

export function validateTraceablePointerSchemaSync(input: {
  filePath: string;
  readTextFileSync?: (filePath: string, encoding?: string) => string;
}): TraceableSchemaValidationResult;