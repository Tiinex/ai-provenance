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

When available, a cheap provisional validation path is to use `runSubagent` with a neutral low-cost model for a cold-read interpretation pass.

Good uses of that pass include checking whether the model:

- identifies the named schema correctly
- distinguishes topic, decision, evidence, and feedback without being led
- preserves the difference between parent and origin
- avoids stronger validation or provenance claims than the file supports

Treat that as bounded interpretive evidence, not as proof that the schema is correct or that machine validation is no longer needed.

If stronger validator support does not yet exist, preserve interpretive stability and avoid overclaiming machine guarantees.

## Suggested runSubagent Probe

When a cheap cold-read check is useful, prefer a prompt shape close to this one and swap only the file path and schema-specific section labels as needed.

```text
You are doing a cold read of one Tiinex trace artifact in a workspace that may contain file instructions and skills.

Read the file <ABSOLUTE_TRACE_PATH> and return exactly these sections:
1. Current schema
2. What this artifact is primarily for
3. Parent vs origin read
4. What can be stated with confidence
5. What must NOT be overclaimed
6. Whether this reads more like topic, decision, evidence, or feedback, and why

Keep the answer concise and grounded only in the file and any automatically applied workspace guidance.
The task is research only; do not edit files.
```

For schema-specific probes, it is acceptable to replace section 2 or section 3 with a more precise question such as:

- `What governs here`
- `What the preserved material is`
- `What source and target are present`
- `What role Authors and Why play`

Keep the probe non-leading.

Do not ask the subagent whether the schema is good.

Ask it what it reads, what it can support, and what it must not overclaim.