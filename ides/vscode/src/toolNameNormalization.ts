// Prompt-facing tool references and host runtime tool names do not share one
// stable spelling surface. Normalize both to one comparison key before
// selection so repo-facing aliases like tiinex.ai-vscode-tools/listAgentSessions
// still land on runtime tools such as list_agent_sessions.
const TOOL_REFERENCE_EQUIVALENT_GROUPS = [
  ["read_file", "copilot_read_file"],
  ["text_search", "copilot_find_text_in_files"],
  ["file_search", "copilot_find_files"],
  ["list_directory", "copilot_list_directory"]
];

const TOOL_REFERENCE_EQUIVALENTS = new Map<string, string[]>(
  TOOL_REFERENCE_EQUIVALENT_GROUPS.flatMap((group) =>
    group.map((key) => [key, group.filter((entry) => entry !== key)])
  )
);

export function normalizeToolReferenceKey(value: string): string {
  return value
    .replace(/^.*\//u, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .trim()
    .toLowerCase();
}

export function expandToolReferenceKeys(value: string): string[] {
  const normalized = normalizeToolReferenceKey(value);
  return [normalized, ...(TOOL_REFERENCE_EQUIVALENTS.get(normalized) ?? [])];
}
