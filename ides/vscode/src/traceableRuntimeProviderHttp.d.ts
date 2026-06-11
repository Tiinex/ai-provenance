export function resolveTraceableOpenAiCompatibleBaseUrl(settings: {
  runtimeProvider?: string;
  openAiCompatibleBaseUrl?: string;
}): string | undefined;

export function buildTraceableOpenAiCompatibleEndpoint(settings: {
  runtimeProvider?: string;
  openAiCompatibleBaseUrl?: string;
}): string | undefined;

export function resolveTraceableOpenAiCompatibleApiKey(
  apiKeyEnv: string | undefined,
  env?: NodeJS.ProcessEnv
): { name: string; value: string };

export function buildTraceableOpenAiCompatibleHeaders(
  apiKeyEnv: string | undefined,
  env?: NodeJS.ProcessEnv
): { headers: Record<string, string>; missingApiKeyEnv?: string };

export function buildTraceableOpenAiCompatibleRequestBody(
  settings: {
    openAiCompatibleTemperature: number;
    openAiCompatibleMaxOutputTokens: number;
  },
  modelId: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
): {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature: number;
  max_tokens: number;
  stream: false;
};

export function extractTraceableOpenAiCompatibleText(payload: Record<string, unknown>): string;

export function extractTraceableOpenAiCompatibleUsage(payload: Record<string, unknown>): {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
} | undefined;

export function formatTraceableExternalProviderFailure(
  status: number,
  statusText: string,
  failureBody?: string
): string;