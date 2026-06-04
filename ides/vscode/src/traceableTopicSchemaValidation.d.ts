import type { TraceableSchemaValidationResult } from "./traceableRootSchemaValidation.js";

export function validateTraceableTopicSchemaSync(input: {
  filePath: string;
  readTextFileSync?: (filePath: string, encoding?: string) => string;
}): TraceableSchemaValidationResult;