export function resolveTraceableOpenAiCompatibleBaseUrl(settings) {
  const configured = String(settings?.openAiCompatibleBaseUrl ?? "").trim();
  if (configured) {
    return configured;
  }
  return settings?.runtimeProvider === "ollama"
    ? "http://127.0.0.1:11434/v1"
    : undefined;
}

export function buildTraceableOpenAiCompatibleEndpoint(settings) {
  const baseUrl = resolveTraceableOpenAiCompatibleBaseUrl(settings);
  if (!baseUrl) {
    return undefined;
  }
  return /\/chat\/completions\/?$/iu.test(baseUrl)
    ? baseUrl.replace(/\/$/u, "")
    : `${baseUrl.replace(/\/$/u, "")}/chat/completions`;
}

export function resolveTraceableOpenAiCompatibleApiKey(apiKeyEnv, env = process.env) {
  const name = String(apiKeyEnv ?? "").trim();
  if (!name) {
    return {
      name: "",
      value: ""
    };
  }
  const value = typeof env?.[name] === "string" ? env[name].trim() : "";
  return {
    name,
    value
  };
}

export function buildTraceableOpenAiCompatibleHeaders(apiKeyEnv, env = process.env) {
  const apiKey = resolveTraceableOpenAiCompatibleApiKey(apiKeyEnv, env);
  return {
    headers: {
      "content-type": "application/json",
      ...(apiKey.value ? { authorization: `Bearer ${apiKey.value}` } : {})
    },
    missingApiKeyEnv: apiKey.name && !apiKey.value ? apiKey.name : undefined
  };
}

export function buildTraceableOpenAiCompatibleRequestBody(settings, modelId, messages) {
  return {
    model: modelId,
    messages,
    temperature: settings.openAiCompatibleTemperature,
    max_tokens: settings.openAiCompatibleMaxOutputTokens,
    stream: false
  };
}

export function extractTraceableOpenAiCompatibleText(payload) {
  const choices = Array.isArray(payload?.choices) ? payload.choices : [];
  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== "object") {
    return "";
  }
  const message = firstChoice.message;
  if (!message || typeof message !== "object") {
    return "";
  }
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content.map((entry) => {
    if (!entry || typeof entry !== "object") {
      return "";
    }
    if (typeof entry.text === "string") {
      return entry.text;
    }
    return typeof entry.content === "string" ? entry.content : "";
  }).filter(Boolean).join("\n\n");
}

export function extractTraceableOpenAiCompatibleUsage(payload) {
  const usage = payload?.usage;
  if (!usage || typeof usage !== "object") {
    return undefined;
  }
  const promptTokens = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : undefined;
  const completionTokens = typeof usage.completion_tokens === "number" ? usage.completion_tokens : undefined;
  const totalTokens = typeof usage.total_tokens === "number" ? usage.total_tokens : undefined;
  if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined) {
    return undefined;
  }
  return {
    promptTokens,
    completionTokens,
    totalTokens
  };
}

export function formatTraceableExternalProviderFailure(status, statusText, failureBody = "") {
  return `TRACEABLE external provider request failed (${status} ${statusText}). ${String(failureBody).trim()}`.trim();
}