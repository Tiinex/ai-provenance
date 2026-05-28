# Trace Format Validation Checklist

This checklist is for the current trace-format redesign topic.

It is intentionally aligned to the newer design dialogue rather than older
topic structure.

## Contract Checks

- Confirm same-repo `.trace.md` parent links always persist as relative paths.
- Confirm cross-repo `.trace.md` parents default to origin-backed storage
  rather than plain relative paths.
- Confirm the first driver is git-backed and commit-aware.
- Confirm uncommitted cross-origin parents are rejected by default.
- Confirm override mode permits weaker relative storage only when explicitly
  enabled.
- Confirm `Created At` is stored as `YYYY-MM-DD hh:mm:ss` without milliseconds.
- Confirm parent and reference timestamps use the same shape.

## Header Checks

- Confirm parser and renderer understand `Parent Origin`.
- Confirm parser and renderer understand `Created At`.
- Confirm parser and renderer understand `Parent Created At`.
- Confirm parser and renderer understand `Why`.
- Confirm parser and renderer understand `Summary`.
- Confirm chat and earlier-trace UX can display `Why` and `Summary` without
  inventing extra coherence through a viewer-only interpretation layer.
- Confirm unsupported schema or runtime cases still remain understandable when
  `Summary` is present.

## Git Driver Checks

- Confirm git-root discovery walks upward to a real `.git` boundary rather than
  using workspace-root as a proxy.
- Confirm same-repo detection depends on discovered git root.
- Confirm cross-repo detection depends on differing discovered git roots.
- Confirm rendered git origin locators are commit-pinned.
- Confirm parsed git origin locators round-trip without losing repo identity,
  commit id, or repo-relative path.
- Confirm git-backed parent or reference timestamps can be persisted from real
  historical data when available.

## Reference Checks

- Confirm references are modeled as driver-reachable destinations rather than
  as a file-only special case.
- Confirm each persisted reference can carry an attached timestamp.
- Confirm the model still allows future non-git drivers such as time-indexed or
  historical backends.

## Integrity Checks

- Confirm checksum behavior still matches the intended footer model.
- Confirm parent-integrity diagnostics remain truthful when the parent is
  origin-backed rather than only path-backed.
- Confirm override mode does not claim stronger integrity than it can support.
- Confirm repair tooling can later detect and improve weakened override links.

## Regression Checks

- Confirm existing same-repo trace spawning still works without reload-only
  validation.
- Confirm move or rewrite helpers do not regress ordinary non-trace path
  handling.
- Confirm stored parent rendering remains readable in markdown output.
- Confirm existing focused unit tests still pass after the first slice.
- Add focused tests for same-repo relative normalization, cross-repo default
  block, git-origin rendering, and override fallback.