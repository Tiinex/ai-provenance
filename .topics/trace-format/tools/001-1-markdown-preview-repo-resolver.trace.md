# Continuity Context

- Envelope Schema: [tiinex.root.v1](https://github.com/Tiinex/docs/blob/c81f1cddac7ec3d671fd11c26d871ecfd4952541/.topics/.schemas/tiinex.root.v1.schema.md)
- Parent
  - Parent Schema: [tiinex.task.v1](https://github.com/Tiinex/docs/blob/c81f1cddac7ec3d671fd11c26d871ecfd4952541/.topics/.schemas/tiinex.task.v1.schema.md)
  - Created At: 2026-05-28 21:23:20
  - Trace: [001.trace.md](001.trace.md)
  - Origin:
    - [relative](001.trace.md)
    - [absolute](C:/Users/micro/Documents/Repos/Tiinex/ai-provenance/.topics/trace-format/tools/001.trace.md)
- Current
  - Current Schema: [tiinex.task.v1](https://github.com/Tiinex/docs/blob/c81f1cddac7ec3d671fd11c26d871ecfd4952541/.topics/.schemas/tiinex.task.v1.schema.md)
  - Created At: 2026-05-28 21:31:52
  - Why: Carries the bounded task of resolving commit-pinned GitHub blob links to local workspace files in markdown preview when the same repo is already open.
  - Summary: Task for a markdown preview resolver that maps matching GitHub blob links to local workspace targets.

---

# Markdown Preview Repo Resolver

This artifact now acts as a concrete task rather than only a planning note.

The aim is still narrow: make commit-pinned GitHub links less disruptive when
the same repo is already open in the current multi-root workspace.

## Objective

Provide one bounded resolver task for rewriting matching GitHub blob links to
local workspace targets during markdown preview.

## Done Criteria

- the resolver task has a stable repo-identity matching contract
- the task keeps preview rewrite behavior narrow to matching GitHub blob links
- the same matching core can later be inspected outside the preview hook

## Requested Behavior

The intended behavior is narrow:

- if a markdown link points at a GitHub blob URL
- and that blob URL resolves to a repo already open in the current workspace
- prefer an internal local target instead of the external browser URL

This is primarily a continuity convenience and operator-focus improvement. It
reduces context switches without pretending that every GitHub URL should become
local.

## Scope And Constraints

The current task should separate the problem into one shared core and two
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

## Subtasks

- decide the smallest structured repo-identity shape the shared core should use
- confirm whether V1 should only rewrite `github.com/.../blob/...` URLs or also
  support nearby GitHub forms
- define a debug or audit surface that can explain why a given URL matched or
  did not match a local repo

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [001.trace.md](001.trace.md)
  - Value: dpqhgSJQ6t8os3BZFzJ-VS7_MIGaGJsB5Tn2tEFaYSw