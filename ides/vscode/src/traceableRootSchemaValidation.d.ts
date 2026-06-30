export interface TraceableSchemaContractSection {
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
}

export interface TraceableSchemaValidationFinding {
  code: string;
  category: string;
  filePath: string;
  message: string;
  severity: "error" | "warning" | "information";
  placement?: {
    expectedHeading?: string;
    actualHeading?: string;
    anchorBeforeHeading?: string;
    anchorAfterHeading?: string;
    headingLevel?: number;
    lineText?: string;
  };
}

export interface TraceableParsedSchemaNote {
  envelopeSchema?: { label?: string; target?: string };
  parentSchema?: { label?: string; target?: string };
  parentCreatedAt?: string;
  parentTrace?: { label?: string; target?: string };
  currentSchema?: { label?: string; target?: string };
  currentCreatedAt?: string;
  currentSummary?: string;
  footerIntegrity?: {
    method?: string;
    towardsLabel?: string;
    towardsTarget?: string;
    value?: string;
    entries?: Array<{ method?: string; towardsLabel?: string; towardsTarget?: string; value?: string }>;
  };
  schemaValidationContract?: TraceableSchemaContractSection;
  artifactCreationContract?: TraceableSchemaContractSection;
  headings: Array<{ level: number; text: string; lineNumber: number }>;
}

export interface TraceableSchemaValidationResult {
  filePath: string;
  parsed: TraceableParsedSchemaNote;
  findings: TraceableSchemaValidationFinding[];
}

export function validateTraceableRootSchemaSync(input: {
  filePath: string;
  readTextFileSync?: (filePath: string, encoding?: string) => string;
}): TraceableSchemaValidationResult;