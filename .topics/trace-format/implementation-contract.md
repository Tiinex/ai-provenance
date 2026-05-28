# Trace Format Implementation Contract

This note captures the current implementation contract for the ongoing
trace-format redesign in `ai-provenance`.

It is derived from the latest dialogue rather than from older topic structure.

## Scope

The redesign covers two related concerns:

1. continuity header semantics for human-facing orientation
2. stable parent and reference storage across same-repo and cross-repo cases

The first driver to implement is a git driver.

## Header Contract

The target continuity header should support these fields in this order when
present:

1. `Parent Trace`
2. `Parent Origin`
3. `Parent Created At`
4. `Created At`
5. `Why`
6. `Summary`
7. `Type`
8. `Schema`

Working semantics:

- `Parent Trace`: direct logical continuity parent
- `Parent Origin`: adapter-bearing origin locator used when inherited origin is
  not safely local or when the parent trace lives in another repo
- `Parent Created At`: known creation timestamp for the parent trace rendered in
  the same shape when the parent relationship is present
- `Created At`: creation timestamp for the current trace artifact rendered as
  `YYYY-MM-DD hh:mm:ss` without milliseconds
- `Why`: short explanation of why the current trace exists
- `Summary`: short artifact-level fallback description for unsupported runtimes
  or viewers
- `Type`: coarse artifact type
- `Schema`: finer artifact schema

`Why` and `Summary` are optional, but when they exist the UI should present
them directly rather than deriving comparable coherence through an extra
interpretation layer.

`Created At` should be treated as expected trace metadata rather than as a soft
hint. Parent and reference timestamps are important because some drivers may be
able to resolve historical state by time rather than by commit id alone.

## Reference Direction

The redesign should not overfit references to ordinary files.

The more general model is:

- references are destinations reachable through a `driver://`-style locator or
  equivalent protocol-bearing origin form
- each stored reference should carry a timestamp in the same
  `YYYY-MM-DD hh:mm:ss` shape
- drivers may use that timestamp for historical lookup when supported

This keeps the model broad enough for git-backed storage now and other
historical or time-indexed backends later.

For the first implementation slice, git remains the first concrete driver.

## Storage Decision Table

### Case 1: Target is not a `.trace.md` file

Use current relative-or-absolute policy.

No origin driver is required.

### Case 2: Target is a `.trace.md` file in the same git repo

Persist the parent or reference as a relative path.

This should be stricter than the current workspace-root approximation. If both
files resolve to the same discovered git root, the stored trace relationship
should be relative.

### Case 3: Target is a `.trace.md` file in another git repo

Default behavior:

- require the target trace to be committed
- persist an adapter-bearing origin locator
- use the git driver to parse and render that locator
- persist the known parent creation time when available

Temporary override behavior:

- permit weaker relative storage even across repo boundaries
- treat that as a deliberate downgrade
- rely on later repair or integrity tooling to upgrade the chain when possible

Even in override mode, the stored relationship should still carry timestamps
when they are known.

## Git Root Discovery

The repo needs a helper that walks upward from a candidate path until one of
two conditions occurs:

1. a `.git` entry is found, establishing the git root
2. filesystem root is reached, establishing that the path is not currently in a
   git repo

This helper should become the basis for same-repo versus cross-repo decisions.

The current workspace-folder-based approximation is not strong enough for this
job.

## Git Driver Contract

The first driver should support at least these capabilities:

- classify whether a stored origin string belongs to the git driver
- render a commit-pinned origin locator from repo identity plus repo-relative
  path
- parse a stored origin locator back into structured git fields
- validate whether a target trace is committed before cross-origin storage is
  allowed by default
- surface or derive a stable timestamp that can be persisted with the
  relationship

Expected structured fields for a parsed git origin:

- protocol or scheme
- repository identity
- commit id
- repo-relative trace path
- timestamp when available or derivable

The exact textual grammar should stay compatible with the existing RFC-style
`git://...@commit:path` family unless a stronger reason appears.

## Override Contract

An explicit setting may temporarily allow cross-origin relative storage when a
target trace is not committed or when an operator intentionally accepts weaker
continuity during repo moves or repair work.

That override should not silently masquerade as strong continuity.

Operationally this means:

- default mode prefers commit-pinned origin-backed cross-origin storage
- override mode may fall back to relative storage
- integrity and repair tooling may later upgrade weakened links

## Checksum Direction

The redesign must not assume the current checksum model is already correct for
the new header and cross-origin model.

Before implementation is considered complete, verify:

- what portion of the file is covered by the stored parent checksum
- whether footer exclusion still matches the intended RFC direction
- whether cross-origin origin-backed parents need any change in integrity
  interpretation or diagnostics
- whether timestamp-bearing parents or references need canonicalization rules so
  checksum behavior stays stable and non-mystical

## First Implementation Slice

The smallest useful implementation slice looks like this:

1. add git-root discovery helper
2. replace same-repo detection with git-root comparison
3. add a git origin driver surface
4. add default block on uncommitted cross-origin `.trace.md` parents
5. add override setting for temporary weaker relative storage
6. extend parsing and rendering to include `Parent Origin`, `Why`, and
   `Summary`
7. revisit checksum handling against the new contract

## Open Questions

- Whether `Parent Trace` should remain populated in every cross-origin case or
  whether `Parent Origin` alone may carry the external recovery edge in some
  scenarios.
- Whether referenced trace files beyond the direct parent should reuse the same
  driver system immediately or land in a second pass.
- How much of the git repository identity should be derived from remotes versus
  local root naming when rendering a git origin locator.