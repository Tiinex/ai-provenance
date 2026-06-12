Integration test notes for external DIRECT provider runs

Quick steps to run a local mocked demonstration (no real network or secrets required):

1. From `ides/vscode` run:

```bash
node tests/manual_external_direct_run.mjs
```

This script uses the HTTP helpers to simulate a chat/completions response and prints
a pseudo `TraceableSubagent`-like run result. It's useful to verify parsing,
usage extraction and the shape of the preserved runtime fields without requiring
the full `vscode` host or real provider credentials.

To run a real integration test against an OpenAI-compatible endpoint:

1. Set an API key environment variable, e.g. `export MY_OPENAI_KEY=...` (Windows: `setx MY_OPENAI_KEY ...`)
2. Configure `tiinex.aiProvenance.openAiCompatibleApiKeyEnv` to `MY_OPENAI_KEY` and `tiinex.aiProvenance.openAiCompatibleBaseUrl` to your endpoint.
3. Use a manual runner that uses the extension host (recommended) or adapt `manual_external_direct_run.mjs` to call `fetch` instead of the mock.

Notes:
- Running a fully automated `runTraceableSubagent` end-to-end test in CI would require either mocking the `vscode` module or running inside an instrumented VS Code test host. Both are more invasive; I can add either approach if you prefer.
