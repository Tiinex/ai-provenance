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
  - Created At: 2026-05-28 21:48:32
  - Why: Captures the direction that some tooling work may need a generic human task schema, but that task nesting should carry the structure before any separate container schema is introduced.
  - Summary: Direction for a generic task schema where tasks may contain subtasks recursively, without adding a separate parent container schema yet.

---

# Generic Task Schema Direction

This topic captures a possible parallel direction: introducing a more generic
task schema that humans and tools can both follow.

The motivation is not to replace topics. The motivation is that some work is
less like a long-form design thread and more like a clearly scoped unit of
action that still deserves continuity, clarity, and later execution support.

The current decision is to keep that shape simple: a task may contain subtasks,
and those subtasks may themselves contain further subtasks. That means we do
not need a separate container schema above task yet.

## Current Read

The current topic schema is strong for design direction, reasoning, and
longer-form working threads.

What may still be missing is a more neutral schema for work that needs to be
defined clearly enough to execute, review, or hand off without forcing the
artifact to look like either a schema definition or a sprawling topic note.

The important refinement is that this missing shape does not currently imply a
separate `project`, `epic`, `track`, or `node` layer. Recursive task nesting is
currently the simpler and more stable read.

## Working Shape

The hypothetical task schema would likely need to make these things easy to
express:

- what concrete work is being asked for
- what counts as done
- what constraints or non-goals still apply
- what artifacts, files, or repos are in scope
- what risks or dependencies could block execution
- what subtasks exist beneath the current task

This would make it easier to describe bounded tasks in a way that remains human
first while still being structured enough for later tool support.

The intended shape is therefore not just a flat task record. It is a task that
can branch into smaller tasks without forcing a separate container artifact type
for every intermediate node.

## Why This May Belong Under Tools

This direction is relevant to tools because repair, audit, and resolver work do
not only need domain logic. They also need a good way to define the work to be
performed without forcing every execution plan into ad hoc prose.

If that hypothesis holds, a generic task schema could become a useful child
artifact for tooling workflows rather than a replacement for the main topic
schema.

It would let tools reason about concrete units of work while preserving a human
readable hierarchy through nested subtasks.

## Risks

- a generic task schema can become a vague catch-all if it is not bounded
- it can duplicate too much of `tiinex.topic.v1` if the distinction is not kept
  sharp
- it can drift into agent-facing prompt scaffolding instead of staying a stable
  artifact contract
- task nesting can become a hidden container layer if the recursion rules stay
  implicit instead of being made explicit in the schema

## Next Steps

- decide whether the missing shape is truly a new schema need or just a better
  disciplined use of `tiinex.topic.v1`
- identify the minimum fields that would distinguish a task artifact from a
  normal topic artifact
- make task recursion explicit so subtasks do not become an informal side
  convention
- keep this as a design direction until there is a clearer boundary between
  topic, schema, pointer, runtime trace, and future task artifacts

---

# Continuity Integrity

- sha256-base64url-c14n-v1
  - Towards: [001.trace.md](001.trace.md)
  - Value: V6q8zyJUNMK0t86SiGcUgydQIfzP6oRi9ghZcFLF1Mc