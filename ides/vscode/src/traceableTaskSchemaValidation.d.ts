import type { TraceableSchemaValidationResult } from "./traceableRootSchemaValidation.js";

export function validateTraceableTaskSchemaSync(input: {
  filePath: string;
  readTextFileSync?: (filePath: string, encoding?: string) => string;
}): TraceableSchemaValidationResult;