# @goodit/evals

Pragmatic eval framework for LLM features.

It runs eval files as Bun tests, records scorer metrics and token/latency data,
compares results against baselines, and prints a report that is useful during
iteration.

## Installation

```bash
# bun
bun add @goodit/evals

# npm
npm install @goodit/evals

# pnpm
pnpm add @goodit/evals
```

Requires Bun `>= 1.3.9` as the test runner.

Optional peer dependency: `ai >= 6` (for `traceModel()` token tracking with AI SDK).

## What this package gives you

- Declarative eval API (`evalSuite`) for multi-case checks.
- Built-in and custom scorers.
- LLM tracing via `traceModel()` for token metrics.
- Baseline files (`*.eval.baseline.json`) with regression comparison.
- Verbose diagnostics mode for low/failing scorer details.
- Variant eval support via `evalSuite.each(...)`.
- Variant comparison tables for multi-option eval suites.

## Quick Start

```bash
# from repo root
bun run eval

# run only tests whose name matches a regex
bun run eval -- --test-name-pattern "Country Briefings"

# include per-test scorer diagnostics
bun run eval -- --verbose --test-name-pattern "Country Briefings"

# machine-readable output for agents/tooling
bun run eval -- --json --test-name-pattern "Country Briefings"

# update baselines
bun run eval:update
```

## Runner Behavior

`bun run eval` executes `packages/evals/src/run.ts`, which:

1. Discovers all `**/*.eval.ts` files in the repo.
2. Starts `bun test` with preload hook `@goodit/evals/preload`.
3. Aggregates metrics and prints suite reports.
4. Optionally compares against baselines.
5. Loads `.env` and `.env.local` from the current working directory and passes
   them to eval test execution.

Important:

- Bun `>= 1.3.9` is required for per-case concurrent test registration.
- If an older Bun is detected, the runner prints a warning.

## Add an Eval in 5 Steps

### 1. Write the task function

```ts
// packages/evals/examples/capitals.ts
import { openai } from "@ai-sdk/openai"
import { traceModel } from "@goodit/evals"
import { generateText } from "ai"

export async function getCapital(country: string): Promise<string> {
  const { text } = await generateText({
    model: traceModel(openai("gpt-4o-mini")),
    prompt: `What is the capital of ${country}? Answer with just the city name.`,
  })

  return text.trim()
}
```

### 2. Create an eval file (`*.eval.ts`)

```ts
// packages/evals/examples/capitals.eval.ts
import { ExactMatch, evalSuite } from "@goodit/evals"
import { getCapital } from "./capitals"

evalSuite("Country Capitals", {
  data: () => [
    { input: "France", expected: "Paris" },
    { input: "Japan", expected: "Tokyo" },
    { input: "Brazil", expected: "Brasilia" },
  ],
  task: async (input: string) => await getCapital(input),
  scorers: [ExactMatch],
  passThreshold: 0.8,
})
```

### 3. Run it

```bash
bun run eval -- --test-name-pattern "Country Capitals"
```

### 4. Inspect verbose diagnostics if needed

```bash
bun run eval -- --verbose --test-name-pattern "Country Capitals"
```

### 5. Snapshot baseline when intentional changes are accepted

```bash
bun run eval:update -- --test-name-pattern "Country Capitals"
```

## API

### `evalSuite(name, config)`

```ts
evalSuite(name: string, config: {
  data:
    | EvalData<TInput, TExpected>[]
    | (() => EvalData<TInput, TExpected>[]
      | Promise<EvalData<TInput, TExpected>[]>)
  task: (input: TInput) => Promise<TOutput>
  scorers: Scorer<TInput, TOutput, TExpected>[]
  passThreshold?: number // default 0.5
  aggregations?: Record<string, (entries: AggregationEntry[]) => number>
  timeout?: number // per-case timeout, default 30000ms
})
```

`EvalData`:

```ts
{
  name?: string // Optional explicit test label in reports/output
  input: TInput
  expected?: TExpected
  weight?: number
  only?: boolean
}
```

Execution model:

- `data: []` or sync `data: () => []`
  - Registers one Bun test per case.
  - Uses `test.concurrent` when Bun supports it.
- `data: async () => []`
  - Registers one Bun test named `evaluate all`.
  - Cases run in parallel internally.

### `evalSuite.each(variants)(name, config)`

Run same eval with variant-specific task behavior.

```ts
evalSuite.each([
  { name: "mini", model: openai("gpt-4o-mini") },
  { name: "full", model: openai("gpt-4o") },
])("Country Capitals", {
  data: () => [{ input: "France", expected: "Paris" }],
  task: async (input, variant) => {
    // variant-aware task
    return input
  },
  scorers: [ExactMatch],
})
```

Each variant gets separate suite metrics and baseline entries.

### `createScorer(...)`

```ts
const scorer = createScorer({
  name: "MyScorer",
  description: "What this score means",
  scorer: async ({ input, output, expected }) => {
    return {
      score: 0.9,
      metadata: { reason: "diagnostics" },
    }
  },
})
```

Return forms supported:

- `number`
- `{ score: number, metadata?: unknown }`
- async versions of both

### Imperative APIs (`measure`, `score`, `suite`)

Use imperative APIs when eval flow does not fit `evalSuite`.

`measure(fn)` wraps your test logic and provides a context:

```ts
const { result } = await measure(async (m) => {
  m.weight(0.9) // optional, default 1
  m.metric("ttfb", 420, "ms")
  m.tokens({
    promptTokens: 120,
    completionTokens: 80,
  })
  m.score("completeness", 0.95)
  return "ok"
})
```

Context methods:

- `m.metric(name, value, unit?)`
- `m.score(name, value)` (stored as `score.<name>`)
- `m.tokens({ promptTokens, completionTokens, totalTokens? })`
- `m.weight(weight)`

`score(name, value)` is shorthand when you are already inside a measured test.

`suite(name, config)` sets optional suite-level config for imperative suites:

- `passThreshold?: number`
- `aggregations?: Record<string, (entries) => number>`

## Aggregation Semantics

Built-in aggregate keys are inferred by metric name:

| Metric pattern | Aggregates |
| --- | --- |
| `latency`, `ttfb*` | `.sum`, `.avg` |
| `throughput*` | `.avg` |
| `tokens.*` | `.sum` |
| `score.*` | `.avg`, `.min` |
| `error` | `.count`, `.rate` |
| always | `test.count`, `test.pass_rate` |

Weight behavior:

- Weighted: `*.avg`, `*.rate`, `test.pass_rate`
- Unweighted: `*.sum`, `*.min`, `*.count`, `test.count`

`test.pass_rate` semantics:

- A case fails if the test throws.
- If a case has `score.*` metrics, it passes only when all are `>= passThreshold`.
- If a case has no `score.*` metrics, pass/fail follows test success only.

## Built-in Scorers

- `ExactMatch`
- `Contains`
- `ContainsAll`
- `ContainsAny`
- `JsonMatch`
- `NumericCloseness`
- `LengthRatio`

## Trace and Tokens

Use `traceModel(...)` around AI SDK models inside tasks.

This records:

- `tokens.input`
- `tokens.output`
- `tokens.total`

The report aggregates these automatically.

## CLI Flags and Env Vars

### Runner-only flags

- `--verbose`
- `--eval-verbose`
- `--json`
- `--eval-json`

`--verbose` and `--eval-verbose` enable scorer diagnostics
(same as `EVAL_VERBOSE=1`).
`--json` and `--eval-json` print only structured JSON output (no human report).

### Bun test flags (pass-through)

Any other flags are passed to `bun test`, for example:

- `--test-name-pattern "..."`
- `--timeout 120000`
- `--bail 1`

### Environment variables

- `UPDATE_BASELINE=1`
  - Save/update baseline files after run.
- `EVAL_OUTPUT=<path>`
  - Write raw suite aggregates and per-test metrics JSON.
- `EVAL_TRACE=1`
  - Force trace capture outside standard eval-runner flow.
- `EVAL_VERBOSE=1`
  - Enable verbose scorer diagnostics.
- `EVAL_JSON=1`
  - Emit structured JSON report instead of terminal report.
- `EVAL_JSON_OUTPUT_FILE=<path>`
  - Write the structured JSON payload to file.

## Verbose Diagnostics

`--verbose` mode adds a `SCORER DETAILS` block and prints, per interesting
(non-perfect) case:

- `Input`
- `Expected`
- `Output`
- scorer status and threshold margin
- full scorer metadata (including multiline judge rationale)

This is the primary mode to debug why a score is low.

## Baselines

Baseline files live next to eval files:

- `foo.eval.ts` -> `foo.eval.baseline.json`

Use:

```bash
bun run eval:update
```

Comparisons are informational:

- regressions are shown in the report
- they do not fail the test run
- only actual test failures/exceptions fail CI

Comparison rule per metric:

- lower-is-better metrics regress when:
  `current > baseline * (1 + tolerance)`
- higher-is-better metrics regress when:
  `current < baseline * (1 - tolerance)`

Direction defaults:

- higher is better: `score.*`, `throughput*`, `test.pass_rate`
- lower is better: everything else

Default tolerances used when baseline entry is a plain number:

| Metric pattern | Default tolerance |
| --- | --- |
| `latency*`, `ttfb*` | `0.20` |
| `tokens.*` | `0.10` |
| `score.*` | `0.05` |
| `throughput*` | `0.15` |
| `error*` | `0.00` |
| `test.pass_rate` | `0.05` |
| `test.count` | `0.00` |
| other metrics | `0.10` |

## Metric Naming Conventions

Use consistent names so aggregation and baseline comparison behave as expected.

| Category | Metric name(s) | Unit | Direction |
| --- | --- | --- | --- |
| Latency | `latency`, `ttfb*` | `ms` | lower |
| Throughput | `throughput*` | custom (`items/s`, `chars/s`) | higher |
| Tokens | `tokens.input`, `tokens.output`, `tokens.total` | count | lower |
| Quality | `score.<name>` | `0..1` | higher |
| Errors | `error` | `0` or `1` | lower |

## LLM-based Scorers and Score Semantics

`packages/evals/examples/country-briefing.eval.ts` demonstrates LLM judging
with `autoevals` `Factuality`.

Important semantics:

- `Factuality` is rubric-based, not linear quality.
- Raw score buckets map to rubric choices.
- Example mapping used in docs:
  - `1.00` -> `C/E`
  - `0.60` -> `B`
  - `0.40` -> `A`
  - `0.00` -> `D`

In the country briefing example, consistent supersets are normalized as
acceptable for the specific task contract.

## Guidelines for Good Evals

- Keep task output format constrained and explicit.
- Prefer several narrow scorers over one opaque scorer.
- Put diagnostics in scorer `metadata`.
- Use `requiredTerms` or schema checks for deterministic invariants.
- Set `passThreshold` to reflect product acceptance, not model vanity metrics.
- Use `--verbose` before changing thresholds.
- Normalize text where needed (case, accents) if semantics are equivalent.

## Agent Playbook

When adding evals in this repo:

1. Add a task file under `packages/evals/examples` or the target feature folder.
2. Add `*.eval.ts` with at least one deterministic scorer.
3. If using LLM judges, include explicit metadata and rubric interpretation.
4. Run:
   - `bun run eval -- --test-name-pattern "<suite>"`
   - `bun run eval -- --verbose --test-name-pattern "<suite>"`
5. Confirm diagnostics are actionable.
6. Update baseline only after expected behavior is agreed.

## Package Scripts

From `packages/evals`:

```bash
bun run eval         # run eval discovery + report
bun run eval:update  # run and update baselines
bun run test         # unit/integration tests for framework
bun run typecheck
bun run lint
```

From repo root:

```bash
bun run eval
bun run eval:update
```

## Project Layout

```text
packages/evals/
  src/
    aggregate.ts
    baseline.ts
    collector.ts
    eval-suite.ts
    measure.ts
    preload.ts
    reporter.ts
    run.ts
    scorer.ts
    trace.ts
    types.ts
  examples/
    capitals.ts
    capitals.eval.ts
    country-briefing.ts
    country-briefing.eval.ts
```
