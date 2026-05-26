# TRACEABLE Reference And Rewrite Helpers Design

This note captures the current design read for two reusable TRACEABLE helper surfaces before implementation work resumes.

The goal is not to add another narrow patch for one transfer symptom.

The goal is to introduce a stronger shared helper layer that can support copy, move, and later provenance-safe rewrite work without relying on weak host guesses.

## Current Read

The current native host surface is asymmetric.

- Native rename or move events expose both `oldUri` and `newUri`.
- Native create or copy observation exposes destination-side created files more readily than source-side provenance.
- TRACEABLE parity requires more than observing that a destination file now exists.
- TRACEABLE parity requires being able to connect source, operation, and output strongly enough that a tooling result and a UX result can be compared as the same semantic action.

The repo already contains useful building blocks for this:

- traceable filename parsing and lineage labels
- parent path storage and rewriting
- graph-aware lineage planning
- planner-backed move and copy semantics
- workspace-wide `.trace.md` discovery

What is missing is a reusable helper layer that answers two questions cleanly:

1. Which `.trace.md` files currently refer to a given source path?
2. Given an old path and a new path, which files need persisted reference rewrites, and what should those rewrites be?

## Main Risks

- Filename-only source matching is too weak and will create false positives.
- Destination files must be excluded from source discovery or the helper can self-confirm the copy result incorrectly.
- Multi-root workspaces increase ambiguity unless search order and fail-fast rules stay explicit.
- A helper that guesses when several candidates remain will create silent drift instead of reducing it.
- A rewrite helper that does not share the same path-rendering logic as the rest of TRACEABLE will create a second reference dialect.

## Confidence Estimate

Current confidence in the helper direction itself is 96%.

Current confidence in filename-only matching being sufficient is below 40%.

Current confidence in a planner-backed, fail-fast helper layer being strong enough for future parity work is about 90%.

## Recommendation

Build two shared helpers:

- `FindAllReferences`
- `RewriteAllReferences`

and one internal rendering helper:

- `intoRelativeOrAbsolute`

Both helpers should be generic enough to support transfer work beyond one current bug, but narrow enough that they only reason about `.trace.md` provenance references rather than becoming a general-purpose repo indexer.

## Operational Stance

Remain deliberative until these helpers are written as maintained shared surfaces.

Do not claim UX copy parity from native host behavior alone.

Do claim stronger future parity once UX observation can be combined with these helpers and fail-fast ambiguity handling.

## Helper 1: `FindAllReferences`

### Purpose

Given one exact source trace path, return every `.trace.md` file in the open workspace set that currently refers to that source path through persisted TRACEABLE references.

This helper is not only for copy.

It should also be usable for move, reference audits, integrity checks, and future repair commands.

### Input

- `sourcePath`: exact absolute path to the trace file whose incoming references should be found
- `workspaceRoots`: all open workspace roots
- optional `excludePaths`: absolute paths that must be removed from the candidate set before matching

### Output

Return a bounded structured result rather than raw paths alone:

- `matches`: files that unambiguously refer to `sourcePath`
- `ambiguousMatches`: files whose stored reference could resolve to more than one candidate under current workspace state
- `scannedRoots`: workspace roots actually searched
- `excludedPaths`: normalized excluded targets that were removed before matching

Each match row should include at least:

- `filePath`
- `referenceField` such as `parentTracePath` or another future reference carrier
- `storedReference`
- `resolvedReferencePath`
- optional observed storage form for diagnostics only

The search helper must not require the caller to say whether it is looking for relative or absolute references.

It must search for both.

That detection happens from the stored content in each referencing file, resolved against the source path being investigated.

### Search Scope

Search all open workspace roots.

Prefer deterministic ordering:

1. the workspace root containing the source path
2. the workspace root containing the destination or invoking file when one is relevant
3. the remaining open workspace roots in stable order

This ordering may influence diagnostics and tie-break presentation, but it must not override the uniqueness rule.

### Hard Rules

- Search only `.trace.md` files.
- Filter out all excluded paths before matching.
- Treat destination paths as excluded when the helper is used for copy observation.
- Match by persisted reference resolution, not by basename alone.
- Cover both relative and absolute stored references during the same search pass.
- If a stored relative or absolute reference resolves to `sourcePath`, that is a real match.
- If the same stored reference could resolve to more than one plausible target under current workspace state, classify it as ambiguous rather than guessing.

### Matching Model

The helper should look for persisted references such as:

- `parentTracePath`
- future persisted provenance references that explicitly target another `.trace.md`

Resolution should use the same practical rules as TRACEABLE evidence reading:

- relative path from the referencing file directory
- absolute path when explicitly stored
- normalized Windows path handling

The helper must not silently invent lineage by filename alone.

Filename or lineage label may be used only as bounded secondary evidence for diagnostics, not as the primary truth signal.

## Helper 2: `RewriteAllReferences`

### Purpose

Given one old source path and one new source path, find all persisted TRACEABLE references that still point to the old path and rewrite them to the new path.

This helper should be used after a move or any other operation that changes the canonical location of a trace artifact while preserving continuity.

### Input

- `oldPath`: exact absolute source path before the move
- `newPath`: exact absolute source path after the move
- `workspaceRoots`: all open workspace roots
- optional `candidateFilePaths`: if provided, rewrite only these files instead of all discovered matches

The caller should not decide whether rewritten references become relative or absolute.

That choice belongs to maintained TRACEABLE path-policy logic that already knows how references should be stored for the current file, workspace, and settings state.

The caller also should not predeclare the current stored style.

Rewrite must detect each current occurrence from the source side as it exists now, then recompute the new stored form from the destination side where the target will live after the operation.

### Output

Return a structured rewrite plan before mutation:

- `plannedFiles`
- `unchangedFiles`
- `ambiguousFiles`
- `failedFiles`

Each planned file should include:

- `filePath`
- `oldStoredReference`
- `newStoredReference`
- optional observed storage form before rewrite
- optional derived storage form after rewrite
- `reason`

### Rewrite Strategy

This helper should call `FindAllReferences` first rather than rediscovering the same search semantics independently.

Then it should compute replacement references using the same persisted path policy that TRACEABLE already uses.

The rewrite helper should not become its own path-format authority.

It should reuse the maintained rules for when relative or absolute storage is appropriate.

That means the helper must be able to find files that currently use either style and rewrite them toward whatever style the maintained TRACEABLE rules now consider correct for the new destination.

This is especially important because rewrite is not only about fixing inbound references in destination-side files.

It also has to fix references inside the source trace file itself when those references now need to point at new destination paths after the transfer.

## Helper 3: `intoRelativeOrAbsolute`

### Purpose

Given one referencing trace file and one resolved target trace file, return the stored reference string that TRACEABLE would persist for that relationship.

This helper is internal policy reuse.

It exists so reference rewrites reuse the same rendering rules as the rest of TRACEABLE instead of creating a second dialect.

### Relative Versus Absolute Choice

The helper should be able to choose the right stored form intelligently, but that intelligence must remain grounded in the same maintained rendering and storage rules already used elsewhere.

This choice is not a public parameter.

It is an internal decision derived from the same helper or policy surface TRACEABLE already uses when it decides how a persisted reference should be stored.

That decision cannot be made globally in advance for the whole operation.

It has to be derived per rewritten occurrence from the actual referencing file location and the rewritten target location.

Priority order:

1. preserve the current stored style when that remains valid and policy-compatible
2. if a setting or maintained helper dictates a preferred stored style, follow that
3. if both styles are legal, prefer the style that TRACEABLE would already compute for the same parent-child relationship
4. do not flip reference style purely for aesthetics during unrelated rewrites

Because this choice is recomputed from maintained policy rather than passed in, a rewrite may legitimately go:

- from relative to absolute
- from absolute to relative
- or remain unchanged in style while still updating the target path

This is important because a rewrite helper that randomly turns relative paths into absolute paths, or vice versa, will create unnecessary drift and make diffs noisier than the semantic change itself.

## How These Helpers Support Copy

Native copy observation can become much stronger if it is combined with these helpers.

The native host may expose only created destination files, but copy has one important advantage over move:

- the original source file still exists after the copy

That means a copy observer can:

1. exclude all destination paths from the candidate pool
2. search for possible source traces among preexisting `.trace.md` files
3. use planner-backed output comparison and persisted reference checks to resolve a unique source or fail as ambiguous

`FindAllReferences` does not solve source resolution by itself, but it provides a stronger reference graph layer that future copy observation can use for cross-checks and post-copy rewrites.

## How These Helpers Support Move

Move already has stronger native event evidence because the host gives both source and destination.

Even so, the helpers remain useful because move can still require follow-up rewrites in other files that refer to the moved trace.

That means move can use the same helper pair like this:

1. perform the move with the authoritative planner
2. call `FindAllReferences(oldPath, ...)` to discover inbound references that still point to the old location
3. call `RewriteAllReferences(oldPath, newPath, ...)` to update those references consistently

This gives move and copy a shared follow-up rewrite layer instead of one-off local repair logic.

## Multi-Copy And Multi-Move Implications

These helpers should support batch use.

For multi-copy or multi-move, do not resolve each file in isolation when the operation is naturally one batch.

Prefer set-wise matching when possible:

- compare the observed destination set against the planned output set
- require a unique matching candidate set
- fail when more than one source set could explain the same destination set

This is especially important once overlapping lineage scopes are involved.

## Lineage Scope Boundary

Overlapping lineage scopes need an explicit locality rule, otherwise a scope label such as `tree` can silently drift from a directory-local move into a workspace-wide connected-lineage closure.

The maintained direction for transfer semantics is:

- `tree` is directory-local. It may include the selected trace plus its intended same-directory tree slice, but it must not pull in or mutate traces from other directories.
- `tree + seeds` may broaden the maintained `tree` slice through descendants of same-directory seed context, but it must not pull in or mutate parent traces or other roots from different directories.
- External parent traces may remain outside the moved set. In that case the transfer planner should preserve those parents in place and rewrite moved or copied references so they still resolve from the new destination.

This boundary matters because "connected lineage" and "directory-local tree" are both valid concepts, but they are not the same user promise.

## Fail-Fast Rules

These helpers should be strict.

- No candidate: fail explicitly.
- More than one plausible candidate: fail explicitly.
- Ambiguous stored reference: report ambiguity explicitly.
- Existing rewrite conflict: fail explicitly.
- Destination accidentally left in the candidate pool: treat that as helper misuse and fail loudly.

Do not downgrade these cases to warnings when the caller is trying to claim parity or safe rewrite completion.

## Suggested Contracts

### `FindAllReferences`

```ts
export type TraceableReferenceStyle = "relative" | "absolute";

export interface FindAllReferencesParams {
  sourcePath: string;
  workspaceRoots: readonly string[];
  excludePaths?: readonly string[];
}

export interface TraceableReferenceMatch {
  filePath: string;
  referenceField: string;
  storedReference: string;
  resolvedReferencePath: string;
  observedReferenceStyle?: TraceableReferenceStyle;
}

export interface TraceableAmbiguousReference {
  filePath: string;
  referenceField: string;
  storedReference: string;
  candidatePaths: string[];
}

export interface FindAllReferencesResult {
  matches: TraceableReferenceMatch[];
  ambiguousMatches: TraceableAmbiguousReference[];
  scannedRoots: string[];
  excludedPaths: string[];
}

export async function FindAllReferences(
  params: FindAllReferencesParams
): Promise<FindAllReferencesResult>;
```

### `intoRelativeOrAbsolute`

```ts
export interface IntoRelativeOrAbsoluteParams {
  fromFilePath: string;
  toFilePath: string;
  workspaceRoots: readonly string[];
}

export interface IntoRelativeOrAbsoluteResult {
  storedReference: string;
  derivedReferenceStyle?: TraceableReferenceStyle;
  reason: string;
}

export function intoRelativeOrAbsolute(
  params: IntoRelativeOrAbsoluteParams
): IntoRelativeOrAbsoluteResult;
```

### `RewriteAllReferences`

```ts
export interface RewriteAllReferencesParams {
  oldPath: string;
  newPath: string;
  workspaceRoots: readonly string[];
  candidateFilePaths?: readonly string[];
}

export interface TraceableReferenceRewrite {
  filePath: string;
  oldStoredReference: string;
  newStoredReference: string;
  observedReferenceStyleBefore?: TraceableReferenceStyle;
  derivedReferenceStyleAfter?: TraceableReferenceStyle;
  reason: string;
}

export interface TraceableReferenceRewriteProblem {
  filePath: string;
  reason: string;
}

export interface RewriteAllReferencesPlan {
  plannedFiles: TraceableReferenceRewrite[];
  unchangedFiles: string[];
  ambiguousFiles: TraceableReferenceRewriteProblem[];
  failedFiles: TraceableReferenceRewriteProblem[];
}

export async function RewriteAllReferences(
  params: RewriteAllReferencesParams
): Promise<RewriteAllReferencesPlan>;
```

## Recommended Implementation Order

1. Implement `FindAllReferences` as a read-only helper.
2. Add focused tests for relative and absolute source-path discovery across multiroot workspaces.
3. Implement `intoRelativeOrAbsolute` as the shared rendering helper that reuses existing TRACEABLE path rules.
4. Implement `RewriteAllReferences` on top of `FindAllReferences` and `intoRelativeOrAbsolute`.
5. Add focused tests for move-driven inbound reference rewrites.
6. Only then reintroduce native UX copy observation on top of those helpers.

This order matters because it builds the durable shared layer first instead of hiding more logic in event callbacks.

## Recommended Execution Model

The design becomes much stronger if rewrite planning and rewrite application are separated explicitly.

That means the shared helper layer should not stop at “find references” and “compute replacement strings”.

It should also define one shared mutation plan shape that both UX and agent flows can consume.

Recommended split:

1. `FindAllReferences` discovers current persisted references from source-side truth.
2. `RewriteAllReferences` computes all required rewrites and returns a mutation plan.
3. A separate apply surface executes that mutation plan.

This separation matters because it gives one semantic plan for:

- UX-driven move or copy
- agent-driven move or copy
- future review, accept, reject, or undo-friendly flows

## Shared Mutation Plan

The mutation plan should describe all intended filesystem and markdown changes before execution.

That means the plan should not only contain replacement strings for one target file.

It should contain the full set of intended mutations across all affected `.trace.md` files.

At minimum the plan should be able to express:

- file move from source path to destination path
- file copy from source path to destination path
- full-document rewrite for a specific `.trace.md` file
- no-op entries that explain why a candidate file was inspected but left unchanged
- explicit ambiguity or failure entries that block apply

The important property is not the exact type names.

The important property is that copy and move both produce the same class of mutation plan even when the source evidence they start from is different.

### Suggested TypeScript Shape

```ts
export type TraceableMutationKind =
  | "move-file"
  | "copy-file"
  | "rewrite-file"
  | "noop"
  | "blocked";

export interface TraceableMoveFileMutation {
  kind: "move-file";
  sourcePath: string;
  destinationPath: string;
  reason: string;
}

export interface TraceableCopyFileMutation {
  kind: "copy-file";
  sourcePath: string;
  destinationPath: string;
  reason: string;
}

export interface TraceableRewriteFileMutation {
  kind: "rewrite-file";
  filePath: string;
  nextContent: string;
  reason: string;
}

export interface TraceableNoopMutation {
  kind: "noop";
  filePath: string;
  reason: string;
}

export interface TraceableBlockedMutation {
  kind: "blocked";
  filePath?: string;
  reason: string;
}

export type TraceableMutation =
  | TraceableMoveFileMutation
  | TraceableCopyFileMutation
  | TraceableRewriteFileMutation
  | TraceableNoopMutation
  | TraceableBlockedMutation;

export interface TraceableMutationPlan {
  mutations: TraceableMutation[];
  blocked: boolean;
  summary: {
    moveCount: number;
    copyCount: number;
    rewriteCount: number;
    noopCount: number;
    blockedCount: number;
  };
}
```

This shape is only a suggested contract.

The important part is that all intended actions are represented explicitly before apply begins.

## Why This Helps UX And Agent Parity

If both UX and agent surfaces consume the same mutation plan, then parity no longer depends on each surface reimplementing rewrite semantics locally.

Instead the surfaces differ only in how they trigger planning and how they apply the already-computed plan.

That gives a cleaner division:

- planning logic decides what should happen
- apply logic decides how to execute it safely on the current host
- UX and agent surfaces become orchestration layers over the same semantic core

This directly reduces the current risk that move and copy drift apart, or that UX and agent transfer paths slowly become separate products.

## Future Apply Surfaces

This design should not require one specific apply mechanism on day one.

The first implementation may still use direct VS Code filesystem operations where that is the most practical path.

But the plan shape should be designed so it can later be applied through a host surface that preserves stronger editor history.

That means the plan should stay explicit enough that a future apply layer could map it into:

- VS Code workspace edits
- operator-reviewed file actions
- undo-friendly host history where the platform supports it

This is one of the strongest reasons to prefer a plan-first model.

It keeps the semantic decision about mutation separate from the host-specific mechanism used to carry it out.

## Suggested Apply Split

If the planning layer returns a `TraceableMutationPlan`, the apply layer can stay narrow.

Suggested shape:

```ts
export interface ApplyTraceableMutationPlanParams {
  plan: TraceableMutationPlan;
}

export interface ApplyTraceableMutationPlanResult {
  appliedMutations: TraceableMutation[];
  skippedMutations: TraceableMutation[];
}

export async function ApplyTraceableMutationPlan(
  params: ApplyTraceableMutationPlanParams
): Promise<ApplyTraceableMutationPlanResult>;
```

Core rule:

- if `plan.blocked` is true, apply must stop before mutating files

That keeps ambiguity and safety decisions in the plan phase rather than rediscovering them during execution.

## Impact On Current Implementation

If this model is adopted, the current implementation should become more layered.

Expected direction:

- existing host IO surfaces remain, because something still has to perform file moves, copies, writes, rollback, and conflict handling
- command handlers should become thinner orchestration layers that request a plan and then apply it
- rewrite-specific logic that is currently scattered across separate move and copy paths should move toward the shared planning layer
- move and copy should stop carrying separate local rewrite semantics when they can instead produce the same mutation-plan form

In practice that likely means some current `planTraceableRewrite...` entry points either shrink into internal helpers or collapse into fewer public planning surfaces.

The desired end state is not “more helpers”.

The desired end state is one semantic planning layer and one apply layer, with less command-local rewrite logic.

## Current To Future Mapping

The current implementation already contains pieces of this split, but they are not expressed as one explicit contract yet.

Likely direction:

- `performTraceableStagedFileMoveOperation`
  future role: apply-layer host IO for `move-file` plus follow-up `rewrite-file` mutations
- `performTraceablePreparedCopyOperation`
  future role: apply-layer host IO for `copy-file` plus follow-up `rewrite-file` mutations
- `runTraceableOwnedMoveOperation`
  future role: serialized execution wrapper around apply, not planning
- `performTraceableRewriteMoveToFolder`
  future role: thin orchestration that requests a plan and applies it
- `performTraceableRewriteCopyToFolder`
  future role: thin orchestration that requests a plan and applies it
- `planTraceableRewriteMove`
  future role: partial precursor to shared planning, but likely reduced or folded into a broader mutation-plan builder
- `planTraceableRewriteRequestedRename`
  future role: internal planning helper or folded into the same mutation-plan builder
- `planTraceableRewriteAfterRename`
  future role: likely reduced to a narrower internal rename-repair helper, or removed if the shared plan fully replaces post-hoc rename-specific rewrite logic

The main simplification is this:

- command paths stop deciding rewrite behavior locally
- planning returns one explicit mutation plan
- apply becomes the only place that performs file mutation

That is the architectural change most likely to reduce drift between copy, move, UX, and agent flows.

## Example Mutation Plans

These examples are illustrative only.

They exist to make the intended plan shape easier to reason about before implementation.

### Example: Copy Plan

Scenario:

- source trace: `C:\repo\traces\1-root.trace.md`
- requested copy destination: `C:\repo\archive\1-root.trace.md`
- planned final copied file: `C:\repo\archive\1-1-root.trace.md`
- one inbound reference in another trace file still needs to point at the original source
- one internal reference inside the copied file must now point at the copied destination-side child

Possible mutation plan:

```ts
const plan: TraceableMutationPlan = {
  blocked: false,
  summary: {
    moveCount: 0,
    copyCount: 1,
    rewriteCount: 1,
    noopCount: 1,
    blockedCount: 0
  },
  mutations: [
    {
      kind: "copy-file",
      sourcePath: "C:\\repo\\traces\\1-root.trace.md",
      destinationPath: "C:\\repo\\archive\\1-1-root.trace.md",
      reason: "Create copied trace artifact at destination lineage slot."
    },
    {
      kind: "rewrite-file",
      filePath: "C:\\repo\\archive\\1-1-root.trace.md",
      nextContent: "...copied markdown with destination-side rewritten references...",
      reason: "Recompute persisted references inside the copied trace for destination-side continuity."
    },
    {
      kind: "noop",
      filePath: "C:\\repo\\traces\\2-child.trace.md",
      reason: "Inbound reference still intentionally points at the original source trace."
    }
  ]
};
```

Important read:

- copy does not imply that every discovered reference should now point at the copied artifact
- the copied file itself may still require internal rewrites
- a no-op can be a meaningful planned outcome rather than an absence of planning

### Example: Move Plan

Scenario:

- source trace: `C:\repo\traces\1-root.trace.md`
- requested move destination: `C:\repo\archive\1-root.trace.md`
- planned final moved file: `C:\repo\archive\1-1-root.trace.md`
- two other trace files currently refer to the old source path and must now follow the moved file

Possible mutation plan:

```ts
const plan: TraceableMutationPlan = {
  blocked: false,
  summary: {
    moveCount: 1,
    copyCount: 0,
    rewriteCount: 2,
    noopCount: 0,
    blockedCount: 0
  },
  mutations: [
    {
      kind: "move-file",
      sourcePath: "C:\\repo\\traces\\1-root.trace.md",
      destinationPath: "C:\\repo\\archive\\1-1-root.trace.md",
      reason: "Relocate trace artifact into destination folder with allocated lineage label."
    },
    {
      kind: "rewrite-file",
      filePath: "C:\\repo\\traces\\2-child.trace.md",
      nextContent: "...markdown rewritten to point at C:\\repo\\archive\\1-1-root.trace.md...",
      reason: "Inbound persisted reference must follow the moved parent trace."
    },
    {
      kind: "rewrite-file",
      filePath: "C:\\repo\\traces\\3-sibling.trace.md",
      nextContent: "...markdown rewritten to point at moved trace using maintained path policy...",
      reason: "Second inbound reference must follow the moved target."
    }
  ]
};
```

Important read:

- move more often implies that inbound references should follow the relocated artifact
- the plan still lists those rewrites explicitly instead of treating them as implicit side effects
- UX and agent should both be able to inspect this same plan before apply begins

### Example: Blocked Plan

Scenario:

- the planner finds more than one plausible source candidate or more than one valid rewrite target for a stored reference

Possible mutation plan:

```ts
const plan: TraceableMutationPlan = {
  blocked: true,
  summary: {
    moveCount: 0,
    copyCount: 0,
    rewriteCount: 0,
    noopCount: 0,
    blockedCount: 1
  },
  mutations: [
    {
      kind: "blocked",
      filePath: "C:\\repo\\traces\\2-child.trace.md",
      reason: "Stored reference is ambiguous under current workspace state; apply must not guess."
    }
  ]
};
```

Important read:

- blocked is a first-class plan outcome
- apply should stop before making any file changes
- this is how ambiguity becomes visible to both UX and agent without inventing success

## Definition Of Success

This helper design is successful only if all of the following become true in implementation:

- copy source resolution does not rely on basename alone
- destination paths are excluded before source matching begins
- move and copy can both reuse the same inbound-reference discovery helper
- rewrite planning uses the same maintained path-style rules as the rest of TRACEABLE
- ambiguity produces explicit failure, not guessed success
- the resulting helpers are reusable for transfer, audits, and repair flows beyond one current bug
- all intended mutations are available as a plan before execution begins
- UX and agent flows can consume the same plan shape even if they later use different host apply surfaces

If those conditions are not met, the helper layer will become another narrow patch rather than the stronger provenance substrate this repo actually needs.