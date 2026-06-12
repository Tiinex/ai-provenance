import {
  buildTraceableOpenAiCompatibleEndpoint,
  buildTraceableOpenAiCompatibleHeaders,
  buildTraceableOpenAiCompatibleRequestBody,
  extractTraceableOpenAiCompatibleText,
  extractTraceableOpenAiCompatibleUsage
} from "../src/traceableRuntimeProviderHttp.js";

async function main() {
  // Prepare settings for a DIRECT external run (mocked)
  const settings = {
    runtimeProvider: "openai-compatible",
    openAiCompatibleBaseUrl: "https://api.example.test/",
    openAiCompatibleApiKeyEnv: "TEST_OPENAI_KEY",
    openAiCompatibleModel: "test-model",
    openAiCompatibleMaxOutputTokens: 200,
    openAiCompatibleTemperature: 0.2
  };

  process.env.TEST_OPENAI_KEY = "fake-key-for-local-demo";

  const endpoint = buildTraceableOpenAiCompatibleEndpoint(settings);
  const { headers, missingApiKeyEnv } = buildTraceableOpenAiCompatibleHeaders(settings.openAiCompatibleApiKeyEnv, process.env);
  if (missingApiKeyEnv) {
    console.error("Missing api key env:", missingApiKeyEnv);
    process.exit(2);
  }

  const body = buildTraceableOpenAiCompatibleRequestBody(settings, settings.openAiCompatibleModel, [{ role: "user", content: "Säg hej" }]);

  // Mock fetch response similar to tests' approach
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: "Hej från extern modell!" } }],
      usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 }
    }),
    text: async () => JSON.stringify({})
  });

  const response = await fakeFetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
  if (!response.ok) {
    console.error("External request failed");
    process.exit(3);
  }
  const payload = await response.json();
  const rawText = extractTraceableOpenAiCompatibleText(payload);
  const usage = extractTraceableOpenAiCompatibleUsage(payload);

  const pseudoRunResult = {
    runtimeFingerprint: {
      providerRoute: settings.runtimeProvider,
      hostSurface: "openai-compatible-chat-completions"
    },
    finalSummary: rawText,
    completionClaim: "partial",
    stopReason: "completed",
    runtimeDecisionSummary: {
      modelSelection: {
        selectionMode: "explicit-selector",
        requestedModel: settings.openAiCompatibleModel
      }
    },
    usage
  };

  console.log(JSON.stringify(pseudoRunResult, null, 2));
}

if (import.meta.url === `file://${process.cwd()}/tests/manual_external_direct_run.mjs`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}