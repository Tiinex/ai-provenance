import * as vscode from "vscode";
import {
  buildTraceableOpenAiCompatibleEndpoint,
  buildTraceableOpenAiCompatibleHeaders,
  buildTraceableOpenAiCompatibleRequestBody,
  extractTraceableOpenAiCompatibleText,
  extractTraceableOpenAiCompatibleUsage,
  formatTraceableExternalProviderFailure
} from "./traceableRuntimeProviderHttp.js";

export type TraceableRuntimeProviderRoute = "vscode-lm" | "openai-compatible" | "ollama";

export interface TraceableRuntimeProviderSettings {
  runtimeProvider: TraceableRuntimeProviderRoute;
  disableVscodeLmProviderForTraceableRuntime: boolean;
  openAiCompatibleBaseUrl: string;
  openAiCompatibleApiKeyEnv: string;
  openAiCompatibleModel: string;
  openAiCompatibleMaxOutputTokens: number;
  openAiCompatibleTemperature: number;
  externalProviderMaxRequestsPerRun: number;
}

export interface TraceableRuntimeProviderAvailability {
  available: boolean;
  route: TraceableRuntimeProviderRoute;
  hostSurface: "vscode-lm-tool" | "openai-compatible-chat-completions";
  reason?: string;
}

export type TraceableProviderId = TraceableRuntimeProviderRoute;

export interface TraceableProviderCapabilities {
  streaming: boolean;
  toolCalling: "native" | "none" | "unknown";
  usage: "exact" | "partial" | "unavailable";
}

export interface TraceableProviderModel {
  providerId: TraceableProviderId;
  id: string;
  displayName?: string;
  vendor?: string;
  family?: string;
  version?: string;
  sendable: boolean;
  capabilities: TraceableProviderCapabilities;
}

export interface TraceableProviderToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface TraceableProviderUsage {
  provenance: "exact" | "partial" | "unavailable";
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  note?: string;
}

export type TraceableProviderMessage =
  | {
      role: "system" | "user" | "assistant";
      content: string;
    }
  | {
      role: "tool";
      toolCallId: string;
      name: string;
      content: string;
    };

export interface TraceableProviderToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface TraceableProviderResponsePart {
  type: "text" | "toolCall" | "data";
  text?: string;
  toolCall?: TraceableProviderToolCall;
  data?: unknown;
}

export interface TraceableProviderRequest {
  model: TraceableProviderModel;
  messages: TraceableProviderMessage[];
  tools: TraceableProviderToolDefinition[];
  maxOutputTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface TraceableProviderResponse {
  parts: TraceableProviderResponsePart[];
  rawText: string;
  usage?: TraceableProviderUsage;
}

export interface TraceableModelProvider {
  id: TraceableProviderId;
  listModels(): Promise<TraceableProviderModel[]>;
  selectModel(selector: vscode.LanguageModelChatSelector): Promise<TraceableProviderModel | undefined>;
  sendRequest(request: TraceableProviderRequest): Promise<TraceableProviderResponse>;
}

const TRACEABLE_RUNTIME_PROVIDER_SETTING = "runtimeProvider";
const TRACEABLE_DISABLE_VSCODE_LM_PROVIDER_SETTING = "disableVscodeLmProviderForTraceableRuntime";
const TRACEABLE_OPENAI_COMPATIBLE_BASE_URL_SETTING = "openAiCompatibleBaseUrl";
const TRACEABLE_OPENAI_COMPATIBLE_API_KEY_ENV_SETTING = "openAiCompatibleApiKeyEnv";
const TRACEABLE_OPENAI_COMPATIBLE_MODEL_SETTING = "openAiCompatibleModel";
const TRACEABLE_OPENAI_COMPATIBLE_MAX_OUTPUT_TOKENS_SETTING = "openAiCompatibleMaxOutputTokens";
const TRACEABLE_OPENAI_COMPATIBLE_TEMPERATURE_SETTING = "openAiCompatibleTemperature";
const TRACEABLE_EXTERNAL_PROVIDER_MAX_REQUESTS_PER_RUN_SETTING = "externalProviderMaxRequestsPerRun";
const DEFAULT_TRACEABLE_OPENAI_COMPATIBLE_MAX_OUTPUT_TOKENS = 1200;
const DEFAULT_TRACEABLE_OPENAI_COMPATIBLE_TEMPERATURE = 0.2;
const DEFAULT_TRACEABLE_EXTERNAL_PROVIDER_MAX_REQUESTS_PER_RUN = 2;

export type TraceableRuntimeResponsePart =
  | vscode.LanguageModelTextPart
  | vscode.LanguageModelToolCallPart
  | vscode.LanguageModelDataPart;

export interface TraceableRuntimeChatResponse {
  stream: AsyncIterable<unknown>;
  text?: AsyncIterable<string>;
  usage?: unknown;
  tokenUsage?: unknown;
  modelUsage?: unknown;
  metadata?: unknown;
}

export interface TraceableRuntimeModel {
  name: string;
  vendor: string;
  family: string;
  id: string;
  version: string;
  countTokens?: vscode.LanguageModelChat["countTokens"];
  maxInputTokens?: vscode.LanguageModelChat["maxInputTokens"];
  sendRequest(
    messages: vscode.LanguageModelChatMessage[],
    options?: vscode.LanguageModelChatRequestOptions,
    token?: vscode.CancellationToken
  ): Promise<TraceableRuntimeChatResponse>;
}

export interface TraceableRuntimeModelCandidates {
  available: TraceableRuntimeModel[];
  sendable: TraceableRuntimeModel[];
}

export function getTraceableProviderCapabilities(providerId: TraceableProviderId): TraceableProviderCapabilities {
  if (providerId === "vscode-lm") {
    return {
      streaming: true,
      toolCalling: "native",
      usage: "exact"
    };
  }
  return {
    streaming: true,
    toolCalling: "unknown",
    usage: "partial"
  };
}

export function toTraceableProviderModel(
  model: Pick<TraceableRuntimeModel, "id" | "name" | "vendor" | "family" | "version">,
  providerId: TraceableProviderId,
  sendable: boolean
): TraceableProviderModel {
  return {
    providerId,
    id: model.id,
    displayName: model.name?.trim() || undefined,
    vendor: model.vendor,
    family: model.family,
    version: model.version,
    sendable,
    capabilities: getTraceableProviderCapabilities(providerId)
  };
}

export function buildTraceableProviderToolDefinitions(
  tools: readonly vscode.LanguageModelToolInformation[] = []
): TraceableProviderToolDefinition[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema
  }));
}

export function getConfiguredTraceableRuntimeProvider(
  config: vscode.WorkspaceConfiguration
): TraceableRuntimeProviderRoute {
  const configured = config.get<string>(TRACEABLE_RUNTIME_PROVIDER_SETTING, "vscode-lm").trim();
  if (configured === "openai-compatible" || configured === "ollama") {
    return configured;
  }
  return "vscode-lm";
}

export function readTraceableRuntimeProviderSettings(
  config = vscode.workspace.getConfiguration("tiinex.aiProvenance")
): TraceableRuntimeProviderSettings {
  return {
    runtimeProvider: getConfiguredTraceableRuntimeProvider(config),
    disableVscodeLmProviderForTraceableRuntime: config.get<boolean>(TRACEABLE_DISABLE_VSCODE_LM_PROVIDER_SETTING, false),
    openAiCompatibleBaseUrl: config.get<string>(TRACEABLE_OPENAI_COMPATIBLE_BASE_URL_SETTING, "").trim(),
    openAiCompatibleApiKeyEnv: config.get<string>(TRACEABLE_OPENAI_COMPATIBLE_API_KEY_ENV_SETTING, "").trim(),
    openAiCompatibleModel: config.get<string>(TRACEABLE_OPENAI_COMPATIBLE_MODEL_SETTING, "").trim(),
    openAiCompatibleMaxOutputTokens: config.get<number>(TRACEABLE_OPENAI_COMPATIBLE_MAX_OUTPUT_TOKENS_SETTING, DEFAULT_TRACEABLE_OPENAI_COMPATIBLE_MAX_OUTPUT_TOKENS),
    openAiCompatibleTemperature: config.get<number>(TRACEABLE_OPENAI_COMPATIBLE_TEMPERATURE_SETTING, DEFAULT_TRACEABLE_OPENAI_COMPATIBLE_TEMPERATURE),
    externalProviderMaxRequestsPerRun: config.get<number>(TRACEABLE_EXTERNAL_PROVIDER_MAX_REQUESTS_PER_RUN_SETTING, DEFAULT_TRACEABLE_EXTERNAL_PROVIDER_MAX_REQUESTS_PER_RUN)
  };
}

export function getTraceableRuntimeProviderAvailability(
  settings = readTraceableRuntimeProviderSettings()
): TraceableRuntimeProviderAvailability {
  if (settings.runtimeProvider === "vscode-lm") {
    if (settings.disableVscodeLmProviderForTraceableRuntime) {
      return {
        available: false,
        route: settings.runtimeProvider,
        hostSurface: "vscode-lm-tool",
        reason: "TRACEABLE runtimeProvider=vscode-lm is disabled by tiinex.aiProvenance.disableVscodeLmProviderForTraceableRuntime. Re-enable the VS Code LM route or choose an external provider route with implemented transport."
      };
    }
    return {
      available: true,
      route: settings.runtimeProvider,
      hostSurface: "vscode-lm-tool"
    };
  }

  if (!settings.openAiCompatibleModel.trim()) {
    return {
      available: false,
      route: settings.runtimeProvider,
      hostSurface: "openai-compatible-chat-completions",
      reason: `TRACEABLE runtimeProvider=${settings.runtimeProvider} requires tiinex.aiProvenance.openAiCompatibleModel to be configured.`
    };
  }

  if (!buildTraceableOpenAiCompatibleEndpoint(settings)) {
    return {
      available: false,
      route: settings.runtimeProvider,
      hostSurface: "openai-compatible-chat-completions",
      reason: `TRACEABLE runtimeProvider=${settings.runtimeProvider} requires tiinex.aiProvenance.openAiCompatibleBaseUrl or the built-in Ollama default endpoint.`
    };
  }

  return {
    available: true,
    route: settings.runtimeProvider,
    hostSurface: "openai-compatible-chat-completions"
  };
}

function wrapNativeRuntimeModel(model: vscode.LanguageModelChat): TraceableRuntimeModel {
  return {
    name: model.name,
    vendor: model.vendor,
    family: model.family,
    id: model.id,
    version: model.version,
    countTokens: model.countTokens.bind(model),
    maxInputTokens: model.maxInputTokens,
    sendRequest: async (messages, options, token) => {
      const response = await model.sendRequest(messages, options, token);
      const responseRecord = response as unknown as Record<string, unknown>;
      return {
        stream: response.stream,
        text: response.text,
        usage: responseRecord.usage,
        tokenUsage: responseRecord.tokenUsage,
        modelUsage: responseRecord.modelUsage,
        metadata: responseRecord.metadata
      };
    }
  };
}

function normalizeTraceableExternalRole(role: unknown): "system" | "user" | "assistant" {
  const normalized = String(role).trim().toLowerCase();
  if (normalized.includes("assistant")) {
    return "assistant";
  }
  if (normalized.includes("system")) {
    return "system";
  }
  return "user";
}

function flattenTraceableMessageContentForExternalProvider(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const part of content) {
    if (part instanceof vscode.LanguageModelTextPart) {
      parts.push(part.value);
      continue;
    }
    if (part instanceof vscode.LanguageModelToolResultPart) {
      parts.push(flattenTraceableMessageContentForExternalProvider(part.content));
    }
  }
  return parts.join("\n\n");
}

function normalizeTraceableOpenAiCompatibleMessages(
  messages: readonly vscode.LanguageModelChatMessage[]
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const normalized: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
  for (const message of messages) {
    const content = flattenTraceableMessageContentForExternalProvider(message.content).trim();
    if (!content) {
      continue;
    }
    normalized.push({
      role: normalizeTraceableExternalRole(message.role),
      content
    });
  }
  return normalized;
}

function createTraceableExternalRuntimeModel(settings: TraceableRuntimeProviderSettings): TraceableRuntimeModel | undefined {
  const modelId = settings.openAiCompatibleModel.trim();
  const endpoint = buildTraceableOpenAiCompatibleEndpoint(settings);
  if (!modelId || !endpoint) {
    return undefined;
  }
  const vendor = settings.runtimeProvider === "ollama" ? "ollama" : "openai-compatible";
  return {
    name: modelId,
    vendor,
    family: "external",
    id: modelId,
    version: "",
    maxInputTokens: undefined,
    countTokens: async (value) => {
      if (typeof value === "string") {
        return Math.max(1, Math.ceil(value.length / 4));
      }
      return 0;
    },
    sendRequest: async (messages, options, token) => {
      if (Array.isArray(options?.tools) && options.tools.length > 0) {
        throw new Error(`TRACEABLE runtimeProvider=${settings.runtimeProvider} currently supports text-only requests only. Disable tools for this run or switch back to vscode-lm.`);
      }
      const abortController = new AbortController();
      const cancellationSubscription = token?.onCancellationRequested(() => abortController.abort());
      try {
        const normalizedMessages = normalizeTraceableOpenAiCompatibleMessages(messages);
        const { headers, missingApiKeyEnv } = buildTraceableOpenAiCompatibleHeaders(settings.openAiCompatibleApiKeyEnv, process.env);
        if (missingApiKeyEnv) {
          throw new Error(`TRACEABLE runtimeProvider=${settings.runtimeProvider} requires environment variable ${missingApiKeyEnv} to contain an API key before external requests can run.`);
        }
        const response = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(buildTraceableOpenAiCompatibleRequestBody(settings, modelId, normalizedMessages)),
          signal: abortController.signal
        });
        if (!response.ok) {
          const failureBody = await response.text().catch(() => "");
          throw new Error(formatTraceableExternalProviderFailure(response.status, response.statusText, failureBody));
        }
        const payload = await response.json() as Record<string, unknown>;
        const rawText = extractTraceableOpenAiCompatibleText(payload);
        const usage = extractTraceableOpenAiCompatibleUsage(payload);
        return {
          stream: (async function* (): AsyncIterable<unknown> {
            if (rawText) {
              yield new vscode.LanguageModelTextPart(rawText);
            }
          })(),
          text: (async function* (): AsyncIterable<string> {
            if (rawText) {
              yield rawText;
            }
          })(),
          usage,
          metadata: payload
        };
      } finally {
        cancellationSubscription?.dispose();
      }
    }
  };
}

export async function listTraceableRuntimeModelCandidates(
  accessInformation?: vscode.LanguageModelAccessInformation,
  settings = readTraceableRuntimeProviderSettings()
): Promise<TraceableRuntimeModelCandidates> {
  const availability = getTraceableRuntimeProviderAvailability(settings);
  if (!availability.available) {
    return {
      available: [],
      sendable: []
    };
  }
  if (availability.route !== "vscode-lm") {
    const externalModel = createTraceableExternalRuntimeModel(settings);
    return externalModel
      ? { available: [externalModel], sendable: [externalModel] }
      : { available: [], sendable: [] };
  }
  try {
    const nativeAvailable = await vscode.lm.selectChatModels({});
    return {
      available: nativeAvailable.map(wrapNativeRuntimeModel),
      sendable: (accessInformation
        ? nativeAvailable.filter((candidate) => accessInformation.canSendRequest(candidate))
        : nativeAvailable).map(wrapNativeRuntimeModel)
    };
  } catch {
    return {
      available: [],
      sendable: []
    };
  }
}

export async function selectTraceableRuntimeModels(
  selector: vscode.LanguageModelChatSelector,
  accessInformation?: vscode.LanguageModelAccessInformation,
  settings = readTraceableRuntimeProviderSettings()
): Promise<TraceableRuntimeModelCandidates> {
  const availability = getTraceableRuntimeProviderAvailability(settings);
  if (!availability.available) {
    return {
      available: [],
      sendable: []
    };
  }
  if (availability.route !== "vscode-lm") {
    const externalModel = createTraceableExternalRuntimeModel(settings);
    if (!externalModel) {
      return {
        available: [],
        sendable: []
      };
    }
    const matches = (!selector.vendor || selector.vendor === externalModel.vendor)
      && (!selector.family || selector.family === externalModel.family)
      && (!selector.id || selector.id === externalModel.id)
      && (!selector.version || selector.version === externalModel.version);
    return matches
      ? { available: [externalModel], sendable: [externalModel] }
      : { available: [], sendable: [] };
  }
  const nativeAvailable = await vscode.lm.selectChatModels(selector);
  return {
    available: nativeAvailable.map(wrapNativeRuntimeModel),
    sendable: (accessInformation
      ? nativeAvailable.filter((candidate) => accessInformation.canSendRequest(candidate))
      : nativeAvailable).map(wrapNativeRuntimeModel)
  };
}