# TRACEABLE Transfer Definition Of Done

This file defines the minimum transfer behavior that must be proven before TRACEABLE transfer work can be treated as complete.

The goal is not only that transfer helpers pass source tests. The goal is that both public tooling and VS Code UX produce the same persisted outcome on disk, with intact lineage and valid relative references inside the `.trace.md` files.

## Canonical Fixture

### Setup Before Running Any Transfer Suite

- Clear `.topics/transfer` completely before constructing a new fixture.
- Create these empty destination folders under `.topics/transfer`:
  - `move-tree-proof`
  - `move-tree-plus-seeds-proof`
  - `move-branch-proof`
  - `move-leaves-proof`
  - `move-alone-proof`
  - `copy-tree-proof`
  - `copy-tree-plus-seeds-proof`
  - `copy-branch-proof`
  - `copy-leaves-proof`
  - `copy-alone-proof`
- Use `#runTrace` with `Leo` as destination role and `Sigma` as sender role.
- Construct this exact follow-tree in `.topics/transfer`:
  - `001-leo.trace.md` with prompt `Hello`
  - `001-1-leo.trace.md` with prompt `What is your name?`
  - `001-1-1-leo.trace.md` with prompt `What is your role and what is its purpose?`
  - `001-1-1-1-leo.trace.md` with prompt `What is my role and what is its purpose?`
  - `001-2-leo.trace.md` with prompt `What time is it?`
  - `001-2-1-leo.trace.md` with prompt `What date is it?`

### Initial Fixture Proof

Before any transfer mutation, verify all of the following:

- Every file above exists on disk.
- `#viewTrace` reports intact lineage for each node.
- Parent-child relationships are:
  - `001` -> `001-1`, `001-2`
  - `001-1` -> `001-1-1`
  - `001-1-1` -> `001-1-1-1`
  - `001-2` -> `001-2-1`
- Relative references inside the markdown are valid before the suite begins.

If the fixture is not clean and valid before the first mutation, abort and repair the fixture first.

## Global Rules

- Abort on the first discovered issue that makes the current test fail.
- Diagnose the failure before continuing to later cases.
- Do not let a broken earlier test contaminate later tests.
- If any tooling defect is discovered during this work, fix it immediately even when it is not the original defect under investigation.
- Any code or logic-bearing file change invalidates the entire current validation status, not only the obviously affected checks.
- After any code or logic-bearing file change, the full transfer validation must be rerun from a clean fixture before prior status may be trusted again.
- After any code change, tests may continue only after a successful build and a human operator has performed `Reload Window`.
- `Reload Window` is a human-operator-only step and must not be treated as optional when validating post-change behavior.
- After each mutation, verify lineage with `#viewTrace` before treating the step as passed.
- After each mutation, inspect the moved or copied `.trace.md` files directly and confirm that relative paths inside markdown still resolve correctly.
- If any path inside the transferred markdown is broken, the test fails.
- If any lineage relation is lost unexpectedly, the test fails.
- If UX and tooling produce different persisted outcomes for the same scenario, the test fails.
- Tooling and UX must use shared transfer logic. UX-specific transfer behavior that diverges from `#transferTrace` semantics is a defect.
- UX copy parity may not be claimed from a host surface that exposes only created destination paths and does not expose the copied source path.
- Do not begin or pass UX copy scenarios until a trace-aware UX copy surface exists that can prove both source and destination for the same operation.
- Destination folders must be empty before each scenario unless the scenario explicitly tests collision handling.
- Native VS Code prompts such as overwrite or replace prompts must not appear for valid empty-destination scenarios.

## What Must Be Checked After Every Scenario

- The exact output file set on disk.
- The exact destination folder structure on disk.
- `#viewTrace surface: "lineage"` for each transferred output.
- `Parent Trace` rendering inside markdown.
- `Continuation parent:` rendering inside markdown when present.
- `Inherited from parent trace:` rendering inside markdown when present.
- `Export folder:` rendering inside markdown when present.
- The embedded `## Traceable State` block for `parentTracePath`, `continuedFromParent`, and lineage label consistency.
- The source tree, to confirm that move removed the correct files and copy preserved the correct files.

## Scope Boundary Decision

The maintained transfer target semantics now draw a hard directory boundary for the broader lineage-style scopes.

- `roots` means parent traces.
- `tree` must not pull in or mutate parent traces, sibling traces, or other lineage files from outside the source file's current directory.
- `tree + seeds` must not pull in or mutate roots from other directories. It may broaden inclusion beyond the source file's current directory only through the descendants of same-directory seed traces.
- When a moved or copied trace still depends on a parent trace outside the moved set, that external parent trace must remain in place.
- In that case, the transferred file content may still need reference rewrites so `parentTracePath` and visible markdown continue to resolve correctly from the new destination.
- Directory-local scope selection outranks workspace-wide connected-lineage closure for `tree` and future `tree + seeds`.

## Planned Scope Semantics

- `leaves` preserves the selected node and its descendant slice according to the maintained leaves semantics.
- `branch` preserves the selected node and the intended branch scope only.
- `tree` preserves the selected node plus descendants that live in the same directory as the selected source trace. It must not pull in external roots or other traces from different directories.
- `tree + seeds` preserves the maintained `tree` slice plus descendant closure from same-directory seed context. It must not pull in external roots from different directories.
- `alone` moves or copies only the selected file as the primary file mutation, but related metadata rewrites may still be required to preserve valid lineage continuity.

## Acceptance Invariants

These invariants must hold for both tooling and UX:

- Golden transfer rule: no transfer operation may leave the persisted `.trace.md` files with broken markdown path references or broken lineage references after the operation completes.
- `tree` preserves the selected node plus the maintained same-directory tree slice only.
- `branch` preserves the selected node and the intended branch scope only.
- `leaves` preserves the selected node and the minimum lineage-preserving descendant slice only.
- `tree + seeds` may broaden `tree` through descendant closure from same-directory seed context, but it must not pull in external roots.
- `alone` moves or copies only the selected file as the primary file mutation, but related metadata rewrites may still be required to preserve valid lineage continuity.
- `move` removes the transferred files from the source location.
- `copy` leaves the source location unchanged.
- `move alone` must preserve a valid `parentTracePath` when the original parent still exists and should remain part of the same logical chain.
- If descendants remain in place after `move alone`, their `parentTracePath` values must be rewritten so they still resolve to the moved node.
- `copy alone` semantics must be stated explicitly and tested independently; they must not be assumed to be identical to `move alone`.
- `copy alone` must leave the original parent and original descendants untouched.
- `copy alone` must still preserve a valid, resolvable `parentTracePath` inside the copied node when the original parent still exists.
- If a transferred file keeps an external parent outside the moved set, that parent must remain unmodified and the transferred file must rewrite its reference so the parent still resolves correctly.
- Persisted file content outranks panel rendering; panel output may not be treated as proof when it disagrees with markdown or `Traceable State`.

## Test Suite 1: Tooling Semantics

Use `#transferTrace` for all cases in this suite.

### Test 1: Tree Move

- Source: `001-1-leo.trace.md`
- Destination: `move-tree-proof`
- Operation: `move`
- Action: `lineage`
- Scope: `tree`
- Expected destination contents:
  - `001-leo.trace.md`
  - `001-1-leo.trace.md`
  - `001-1-1-leo.trace.md`
  - `001-1-1-1-leo.trace.md`
  - `001-2-leo.trace.md`
  - `001-2-1-leo.trace.md`
  - No extra files may appear in the destination.
- Must prove:
  - Expected lineage set is moved.
  - Source files no longer remain at the original location.
  - Relative references inside all moved files are correct from the new folder.
  - No unrelated source files are mutated.
  - Embedded `Traceable State` matches the visible markdown for all moved files.
  - `#viewTrace` reports the moved outputs with the expected tree relationships.

This canonical same-directory fixture does not distinguish `tree` from `tree + seeds` by itself. It only proves that `tree` still behaves correctly when every relevant trace co-resides in the same directory.

### Supplemental Boundary Proof For `tree` And `tree + seeds`

Before semantic completion may be claimed for either scope, run an additional boundary fixture that places:

- the selected trace in one source directory,
- one or more same-directory seeds or roots beside it,
- at least one descendant of those same-directory seeds in a different directory,
- and at least one external root or parent trace in a different directory that must remain untouched.

The boundary proof must establish all of the following:

- `tree` includes only the maintained same-directory tree slice.
- `tree` does not pull in roots or other traces from different directories.
- `tree + seeds` may broaden beyond the source directory through descendants of same-directory seeds.
- `tree + seeds` still does not pull in external roots from different directories.
- Any transferred file that keeps an external parent outside the moved set rewrites its reference correctly without mutating that external parent.
- The boundary proof is checked through both persisted markdown and `Traceable State`, not by panel output alone.

### Test 2: Branch Move

- Source: `001-1-1-leo.trace.md`
- Destination: `move-branch-proof`
- Operation: `move`
- Action: `lineage`
- Scope: `branch`
- Expected destination contents:
  - `001-1-leo.trace.md`
  - `001-1-1-leo.trace.md`
  - `001-1-1-1-leo.trace.md`
  - No extra tree files may appear in the destination.
- Must prove:
  - Branch-only lineage set is moved.
  - No extra tree files are moved.
  - Parent references remain correct for moved descendants.
  - No unrelated source files are mutated.
  - Embedded `Traceable State` matches the visible markdown for all moved files.
  - `#viewTrace` reports the moved outputs with the expected branch relationships.

### Test 3: Leaves Move

- Source: `001-1-1-leo.trace.md`
- Destination: `move-leaves-proof`
- Operation: `move`
- Action: `lineage`
- Scope: `leaves`
- Expected destination contents:
  - `001-1-1-leo.trace.md`
  - `001-1-1-1-leo.trace.md`
  - No additional ancestor or sibling files may appear in the destination unless the maintained leaves semantics explicitly requires them.
- Must prove:
  - Only the leaves semantics slice is moved.
  - No false parent loss occurs for the moved leaf when a valid moved parent remains.
  - No unrelated source files are mutated.
  - Relative references inside moved files remain valid from the new folder.
  - Embedded `Traceable State` matches the visible markdown for all moved files.
  - `#viewTrace` reports the moved outputs with the expected leaves relationships.

### Test 4: Alone Move

- Source: `001-2-leo.trace.md`
- Destination: `move-alone-proof`
- Operation: `move`
- Action: `alone`
- Expected destination contents:
  - `001-leo.trace.md` as the transferred file, unless maintained displacement or numbering rules explicitly require additional destination-side artifacts.
  - Any such additional destination-side artifacts must be named and justified by the maintained semantics rather than improvised by the tester.
- Must prove:
  - The moved file preserves a valid `parentTracePath` when the original parent still exists.
  - The moved file's relative parent reference is rewritten correctly from the new folder.
  - If the moved node has descendants that remain at the source side, their `parentTracePath` values are rewritten so the chain remains intact.
  - No unrelated source files are mutated beyond the minimum required descendant rewrites.
  - `#viewTrace` resolves the moved file's parent correctly from persisted evidence.
  - The embedded `Traceable State` and visible markdown agree about the moved file's parent reference.

### Test 5: Tree Copy

- Same structure as Tree Move, but with `operation: copy`.
- Expected destination contents:
  - `001-leo.trace.md`
  - `001-1-leo.trace.md`
  - `001-1-1-leo.trace.md`
  - `001-1-1-1-leo.trace.md`
  - `001-2-leo.trace.md`
  - `001-2-1-leo.trace.md`
  - No extra files may appear in the destination.
- Must prove the expected lineage set is copied.
- Must prove the source tree remains untouched.
- Must prove no source file is rewritten as a side effect of the copy.
- Must prove relative references inside all copied files are correct from the new folder.
- Must prove `#viewTrace` reports the copied outputs with the expected lineage relationships.

As with Tree Move, this canonical same-directory fixture does not distinguish `tree` from `tree + seeds` by itself. Boundary-proof coverage is still required before semantic completion may be claimed.

### Test 6: Branch Copy

- Same structure as Branch Move, but with `operation: copy`.
- Expected destination contents:
  - `001-1-leo.trace.md`
  - `001-1-1-leo.trace.md`
  - `001-1-1-1-leo.trace.md`
  - No extra tree files may appear in the destination.
- Must prove the expected branch-only lineage set is copied.
- Must prove no extra tree files are copied.
- Must prove the source tree remains untouched.
- Must prove no source file is rewritten as a side effect of the copy.
- Must prove parent references remain correct for copied descendants.
- Must prove `#viewTrace` reports the copied outputs with the expected branch relationships.

### Test 7: Leaves Copy

- Same structure as Leaves Move, but with `operation: copy`.
- Expected destination contents:
  - `001-1-1-leo.trace.md`
  - `001-1-1-1-leo.trace.md`
  - No additional ancestor or sibling files may appear in the destination unless the maintained leaves semantics explicitly requires them.
- Must prove only the intended leaves semantics slice is copied.
- Must prove the source tree remains untouched.
- Must prove no source file is rewritten as a side effect of the copy.
- Must prove copied outputs preserve valid parent references where the chosen leaves semantics requires them.
- Must prove copied outputs do not silently lose lineage continuity.
- Must prove `#viewTrace` reports the copied outputs with the expected leaves relationships.

### Test 8: Alone Copy

- Same structure as Alone Move, but with `operation: copy`.
- Expected destination contents:
  - `001-leo.trace.md` as the copied file unless maintained `copy alone` semantics explicitly require additional destination-side artifacts.
  - Parent and descendants from the original source tree must not be copied into the destination unless the maintained semantics explicitly say otherwise.
- Must prove the result follows the explicitly chosen `copy alone` semantics rather than inheriting assumptions from `move alone`.
- Must prove the source tree remains untouched.
- Must prove the original parent node is not moved or rewritten.
- Must prove original descendants are not moved or rewritten.
- Must prove the copied file still contains a valid, resolvable parent reference.
- Must prove the copied file does not require rewrites of the original source chain to remain valid.

## Test Suite 2: UX Parity

Use Explorer drag-and-drop or the normal VS Code rename/move UX for all cases in this suite.

Repeat the same scenarios as Test Suite 1.

UX copy scenarios have an additional prerequisite:

- The exercised UX surface must expose enough evidence to identify both the copied source trace and the created destination trace for the same operation.
- A host surface that exposes only destination-side create results is not sufficient evidence for TRACEABLE UX copy parity.
- If that prerequisite is not satisfied on the current host, UX copy scenarios remain not done rather than being treated as passed, silently skipped, or approximated through tooling evidence.

For each scenario, compare the UX result against the equivalent tooling result and require parity in all of the following:

- Output file set
- File names and lineage labels
- Embedded `Traceable State`
- Relative markdown path rendering
- `#viewTrace` lineage interpretation
- Source cleanup behavior for `move`
- Source preservation behavior for `copy`
- Whether any unrelated source files were rewritten
- Whether any native overwrite or replace prompt appeared during an otherwise valid scenario

If UX and tooling differ on any of those points, the scenario fails even if one path looks individually plausible.

## Test Suite 3: Failure Handling

These scenarios must fail safely and predictably:

- Moving or copying into a destination that already contains a conflicting target.
- Multi-select overlap where a descendant is already covered by an ancestor selection.
- Explicit scope request that is not meaningful for the chosen selection and destination.
- Attempting transfer when no readable `Traceable State` block exists.
- Attempting transfer where the selected file is already in the target location.
- Attempting a valid empty-destination transfer that incorrectly triggers a native overwrite or replace prompt.
- Attempting `move alone` where a remaining descendant chain would be left with unresolved parent references.
- Attempting `copy alone` where the copied node loses its resolvable parent reference.

Safe failure means:

- No partial silent mutation on disk.
- No broken intermediate staging files left behind.
- No native overwrite prompt in cases that should be owned and blocked by TRACEABLE logic.
- A specific diagnostic reason is available.
- Any partial mutation that already occurred is detectable and treated as a failed test rather than a soft warning.

## Test Suite 4: Shared-Helper Proof

Before transfer work is considered complete, prove that tooling and UX are not carrying separate semantic implementations for the same transfer mode.

At minimum, verify:

- Tooling `alone move` and UX `alone move` go through the same planning logic.
- Tooling `lineage move` and UX `lineage move` go through the same planning logic.
- Tooling `alone copy` and UX `alone copy` go through the same planning logic.
- Tooling `lineage copy` and UX `lineage copy` go through the same planning logic.
- Any claimed UX copy path is source-aware enough to prove which original trace produced each copied output.
- Tooling and UX do not rely on different parent-path rewrite rules.
- Tooling and UX do not rely on different markdown re-render rules.

If a mode still uses a separate UX-only or tool-only semantic planner, transfer is not done.

## Definition Of Done

TRACEABLE transfer is done only when all of the following are true:

- [ ] The canonical fixture can be built cleanly and verified cleanly.
- [ ] Every scenario in Test Suite 1 passes.
- [ ] Supplemental boundary proof for `tree` and `tree + seeds` passes.
- [ ] Every corresponding scenario in Test Suite 2 passes.
- [ ] Test Suite 3 fails safely for each covered error case.
- [ ] Shared-helper proof in Test Suite 4 is satisfied.
- [ ] Any tooling defects discovered during validation were fixed immediately rather than deferred as unrelated.
- [ ] Relative references inside the transferred markdown are explicitly checked after each scenario, not assumed.
- [ ] `#viewTrace` agrees with what the markdown and `Traceable State` claim.
- [ ] No unresolved parent-path regressions remain in moved or copied outputs.
- [ ] No UX-only drift remains relative to `#transferTrace`.
- [ ] No UX copy scenario was marked passed on a host surface that cannot identify both source and destination for the same copy operation.
- [ ] Every post-change validation round resumed only after a successful build and a human-run `Reload Window`.
- [ ] Any code or logic-bearing change invalidated the full prior validation status and triggered a full rerun from a clean fixture.
- [ ] The suite can be rerun from a clean fixture without hidden manual cleanup.

If any one of those conditions fails, TRACEABLE transfer is not done.

## Detailed DoD Checklist

Use this section as the progress-tracking checklist while validating transfer.

- [ ] Fixture And Baseline Complete
  - [ ] `.topics/transfer` was cleared fully before the run.
  - [ ] All destination proof folders, including `tree + seeds` proof folders, were recreated empty.
  - [ ] Canonical fixture nodes were rebuilt with the expected filenames.
  - [ ] Baseline `#viewTrace` lineage was verified for all fixture nodes.
  - [ ] Baseline markdown path references were checked before the first mutation.
- [ ] Change-Control Discipline Complete
  - [ ] Any tooling defect discovered during validation was fixed immediately even when outside the originally targeted defect.
  - [ ] After every code change, a successful build completed before validation resumed.
  - [ ] After every code change, a human operator performed `Reload Window` before validation resumed.
  - [ ] Any code or logic-bearing change invalidated the full prior validation status.
  - [ ] After any code or logic-bearing change, the full transfer validation was rerun from a clean fixture.
- [ ] Tooling Suite Complete
  - [ ] Test 1 Tree Move passed.
  - [ ] Test 1 destination file set matched exactly.
  - [ ] Test 1 source cleanup matched exactly.
  - [ ] Test 1 markdown and `Traceable State` stayed aligned.
  - [ ] Supplemental boundary proof for `tree` passed.
  - [ ] Supplemental boundary proof for `tree + seeds` passed.
  - [ ] Boundary proof confirmed that external roots were not moved or mutated.
  - [ ] Test 2 Branch Move passed.
  - [ ] Test 2 destination file set matched exactly.
  - [ ] Test 2 source cleanup matched exactly.
  - [ ] Test 2 markdown and `Traceable State` stayed aligned.
  - [ ] Test 3 Leaves Move passed.
  - [ ] Test 3 destination file set matched exactly.
  - [ ] Test 3 source cleanup matched exactly.
  - [ ] Test 3 markdown and `Traceable State` stayed aligned.
  - [ ] Test 4 Alone Move passed.
  - [ ] Test 4 destination file set matched exactly.
  - [ ] Test 4 parent continuity remained valid.
  - [ ] Test 4 descendant rewrites, if required, were validated correctly.
  - [ ] Test 5 Tree Copy passed.
  - [ ] Test 5 destination file set matched exactly.
  - [ ] Test 5 source tree stayed untouched.
  - [ ] Test 5 markdown and `Traceable State` stayed aligned.
  - [ ] Test 6 Branch Copy passed.
  - [ ] Test 6 destination file set matched exactly.
  - [ ] Test 6 source tree stayed untouched.
  - [ ] Test 6 markdown and `Traceable State` stayed aligned.
  - [ ] Test 7 Leaves Copy passed.
  - [ ] Test 7 destination file set matched exactly.
  - [ ] Test 7 source tree stayed untouched.
  - [ ] Test 7 markdown and `Traceable State` stayed aligned.
  - [ ] Test 8 Alone Copy passed.
  - [ ] Test 8 destination file set matched exactly.
  - [ ] Test 8 source tree stayed untouched.
  - [ ] Test 8 copied node still resolved its parent correctly.
- [ ] UX Parity Complete
  - [ ] UX Tree Move matched tooling exactly.
  - [ ] UX boundary proof for `tree` matched tooling exactly.
  - [ ] UX boundary proof for `tree + seeds` matched tooling exactly.
  - [ ] UX Branch Move matched tooling exactly.
  - [ ] UX Leaves Move matched tooling exactly.
  - [ ] UX Alone Move matched tooling exactly.
  - [ ] The UX copy surface under test could identify both source and destination for the same copy action.
  - [ ] UX Tree Copy matched tooling exactly.
  - [ ] UX Branch Copy matched tooling exactly.
  - [ ] UX Leaves Copy matched tooling exactly.
  - [ ] UX Alone Copy matched tooling exactly.
  - [ ] No valid empty-destination UX scenario triggered a native overwrite or replace prompt.
- [ ] Failure Handling Complete
  - [ ] Conflict target failure was exercised and failed safely.
  - [ ] Multi-select overlap failure was exercised and failed safely.
  - [ ] Non-meaningful explicit scope failure was exercised and failed safely.
  - [ ] Missing `Traceable State` failure was exercised and failed safely.
  - [ ] Already-in-target-location failure was exercised and failed safely.
  - [ ] False native overwrite or replace prompt behavior was checked as a failure condition.
  - [ ] Broken descendant-chain `move alone` failure was checked as a failure condition.
  - [ ] Broken parent-resolution `copy alone` failure was checked as a failure condition.
- [ ] Shared-Helper Proof Complete
  - [ ] Tooling and UX `alone move` were proven to use the same planning logic.
  - [ ] Tooling and UX `lineage move` were proven to use the same planning logic.
  - [ ] Tooling and UX `alone copy` were proven to use the same planning logic.
  - [ ] Tooling and UX `lineage copy` were proven to use the same planning logic.
  - [ ] Tooling and UX parent-path rewrite rules were proven identical.
  - [ ] Tooling and UX markdown re-render rules were proven identical.
- [ ] Final Closure Complete
  - [ ] Golden transfer rule held for every validated scenario.
  - [ ] Persisted markdown and `Traceable State` agreed for every validated scenario.
  - [ ] `#viewTrace` agreed with persisted evidence for every validated scenario.
  - [ ] No unresolved parent-path regressions remained.
  - [ ] No UX-only drift remained relative to tooling.
  - [ ] The full suite could be rerun cleanly without hidden manual cleanup.