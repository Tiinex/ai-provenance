# Continuity Context

- Envelope Schema: [tiinex.continuation.v1](https://github.com/Tiinex/docs/blob/d26b73c3f83a618cc04338c49ca10b62bc91e876/.topics/.schemas/tiinex.continuation.v1.md)
- Parent
  - Parent Schema: [tiinex.topic.v1](https://github.com/Tiinex/docs/blob/d26b73c3f83a618cc04338c49ca10b62bc91e876/.topics/.schemas/tiinex.topic.v1.md)
  - Created At: 2026-05-28 21:23:20
  - Trace: [001.trace.md](001.trace.md)
  - Origin:
    - [relative](001.trace.md)
    - [absolute](C:/Users/micro/Documents/Repos/Tiinex/ai-provenance/.topics/trace-format/tools/001.trace.md)
- Current
  - Current Schema: [tiinex.topic.v1](https://github.com/Tiinex/docs/blob/d26b73c3f83a618cc04338c49ca10b62bc91e876/.topics/.schemas/tiinex.topic.v1.md)
  - Created At: 2026-05-28 21:31:52
  - Why: Captures the initial plan for a tooling slice that rewrites GitHub repo links toward already-open workspace repos during markdown preview, so the idea can be refined as part of the tools lineage instead of floating in chat.
  - Summary: Plan for resolving commit-pinned GitHub links to local workspace targets in VS Code markdown preview when the same repo is already open.

---

# Markdown Preview Repo Resolver Plan

This note captures the first grounded plan for the markdown-preview link
resolution idea.

The aim is not to teach the markdown preview every possible remote driver at
once. The aim is to make commit-pinned GitHub links less disruptive when the
same repo is already open in the current multi-root workspace.

## Current Read

The useful intervention point appears to be just before markdown preview
render, where GitHub links can be rewritten rather than always opened in an
external browser.

The intended behavior is narrow:

- if a markdown link points at a GitHub blob URL
- and that blob URL resolves to a repo already open in the current workspace
- prefer an internal local target instead of the external browser URL

This is primarily a continuity convenience and operator-focus improvement. It
reduces context switches without pretending that every GitHub URL should become
local.

## Working Plan

The current plan is to separate the problem into one shared core and two
possible operator surfaces.

Shared core responsibilities:

1. inspect current workspace folders and discover repo roots
2. read or normalize repo remote identity from git metadata
3. parse GitHub blob URLs into structured repo identity plus repo-relative path
4. match those URLs against already-open repos
5. produce either a local workspace target or a deliberate no-match result

Possible operator surfaces:

1. markdown-preview rewrite surface inside VS Code
2. standalone audit or debug surface for testing the same resolver behavior

The key point is that matching logic should not live only inside a preview hook
if we also expect agents or operators to inspect and debug the same decisions.

## Matching Contract

The resolver should prefer exact repo identity over broad organizational
heuristics.

Working matching rules:

- normalize remote forms such as HTTPS and SSH into the same repo identity
- match on exact host plus owner plus repo
- only attempt local path resolution after repo identity matches
- preserve line anchors when they can be translated safely

The resolver should not assume that every repo in the same organization is safe
to fold into one namespace. That would be too weak and too easy to mis-resolve.

## V1 Decision

The first slice should ignore commit-accurate historical rendering and instead
open the current local file when repo identity and repo-relative path match.

That gives a high-utility first step because it:

- keeps the user inside VS Code
- avoids unnecessary external browser hops
- preserves one shared matching core that can later be reused elsewhere

What V1 does not guarantee:

- exact historical content from the referenced commit
- full driver support beyond GitHub blob links
- automatic repair of schema traces or other markdown documents yet

## Risks

- a local open-file match may differ from the exact historical commit linked in
  markdown
- remote normalization may drift if repo identity logic is duplicated in more
  than one place
- preview rewrite logic could become hard to trust if there is no matching
  audit surface for the same decisions

## Next Steps

- decide the smallest structured repo-identity shape the shared core should use
- confirm whether V1 should only rewrite `github.com/.../blob/...` URLs or also
  support nearby GitHub forms
- define a debug or audit surface that can explain why a given URL matched or
  did not match a local repo

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [001.trace.md](001.trace.md)
  - Value: KctA6GImmmSoOsQRsXBhkWHFwN2EVIKYHgdeWKhiY8w