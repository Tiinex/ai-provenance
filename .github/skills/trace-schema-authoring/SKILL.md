---
name: trace-schema-authoring
description: Use when creating, extending, or repairing Tiinex schema notes or when a trace edit seems to require a schema change instead of a local one-off convention. Helps agents treat schema development as an allowed path and keep schema evolution separate from ad hoc trace mutation.
---

# Trace Schema Authoring

Use this skill when the right fix is to evolve schema guidance rather than to improvise a local pattern inside one trace artifact.

Primary schema home:

- `docs/.topics/.schemas/`

## Core Rule

If a trace change needs a new structural meaning, a new envelope expectation, or a new reusable field rule, prefer changing or adding a schema note instead of smuggling that rule into one trace body.

## When To Use This Skill

Use this skill when:

- a trace artifact needs a field that existing schema notes do not explain
- multiple traces are starting to carry the same local convention
- an agent is tempted to add ad hoc structure outside the named schema
- a schema note is almost enough but needs sharper required, recommended, or conditional rules
- schema lineage or schema authority needs to be clarified for later agents

Do not use this skill just because a single trace needs ordinary content edits.

## Working Method

1. identify the current schema named by the artifact
2. read the nearest relevant schema note in `docs/.topics/.schemas/`
3. decide whether the need is:
   - a content change inside the current schema
   - a clarification to an existing schema note
   - a genuinely new schema note
4. preserve the current envelope and lineage meanings while evolving the schema note
5. prefer small explicit contract language such as required, recommended, conditional, optional, or non-goals

## Schema Evolution Rules

- keep one primary home for each reusable rule
- prefer English structural field names even when example payloads are multilingual
- do not turn a repair convenience into a universal schema claim without evidence
- do not let a body example quietly become the only place a rule exists
- if a new rule changes interpretation materially, update the schema note instead of only updating examples

## Output Shape

Good schema work usually leaves behind:

- a clearer schema note in `docs/.topics/.schemas/`
- minimal matching adjustments to affected trace artifacts
- explicit language about what is required versus recommended versus optional

## Validation Posture

After schema edits, prefer checking that:

- the changed trace still names a valid schema home
- the schema note still reads as an operational contract rather than loose prose
- no local trace now relies on a rule that exists only implicitly

If stronger validator support does not yet exist, preserve interpretive stability and avoid overclaiming machine guarantees.