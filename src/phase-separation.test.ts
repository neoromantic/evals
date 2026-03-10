import { afterEach, describe, expect, test } from "bun:test"
import { collector } from "./collector"
import { aggregateMetrics } from "./aggregate"
import { displayMetricName } from "./reporter"
import { createLLMJudgeScorer, wrapAutoeval } from "./llm-scorer"
import { createScorer } from "./scorer"
import { measure } from "./measure"
import type { TestMetrics } from "./types"

afterEach(() => {
  collector.reset()
})

// --- Helpers ---

function makeTestMetrics(
  metrics: Record<string, number | boolean>,
  passed = true,
): TestMetrics {
  return {
    suiteKey: "suite::key",
    suiteName: "suite",
    testName: "test",
    metrics,
    weight: 1,
    passed,
    scorerResults: [],
  }
}

// ---------------------------------------------------------------------------
// 1. collector phase routing
// ---------------------------------------------------------------------------

describe("collector phase routing", () => {
  test("recordTokens routes to tokens.* when phase is task (default)", () => {
    collector.beginTest("suite", "test")

    collector.recordTokens({ promptTokens: 10, completionTokens: 5 })

    collector.endTest()

    const [entry] = collector.getTestResults()
    expect(entry?.metrics["tokens.input"]).toBe(10)
    expect(entry?.metrics["tokens.output"]).toBe(5)
    expect(entry?.metrics["tokens.total"]).toBe(15)
    expect(entry?.metrics["tokens.scorer.input"]).toBeUndefined()
    expect(entry?.metrics["tokens.scorer.output"]).toBeUndefined()
    expect(entry?.metrics["tokens.scorer.total"]).toBeUndefined()
  })

  test("recordTokens routes to tokens.scorer.* when phase is scoring", () => {
    collector.beginTest("suite", "test")

    collector.setPhase("scoring")
    collector.recordTokens({ promptTokens: 20, completionTokens: 8 })

    collector.endTest()

    const [entry] = collector.getTestResults()
    expect(entry?.metrics["tokens.scorer.input"]).toBe(20)
    expect(entry?.metrics["tokens.scorer.output"]).toBe(8)
    expect(entry?.metrics["tokens.scorer.total"]).toBe(28)
    expect(entry?.metrics["tokens.input"]).toBeUndefined()
    expect(entry?.metrics["tokens.output"]).toBeUndefined()
    expect(entry?.metrics["tokens.total"]).toBeUndefined()
  })

  test("setPhase changes the phase for subsequent token recording", () => {
    collector.beginTest("suite", "test")

    collector.recordTokens({ promptTokens: 5, completionTokens: 3 })
    collector.setPhase("scoring")
    collector.recordTokens({ promptTokens: 12, completionTokens: 4 })

    collector.endTest()

    const [entry] = collector.getTestResults()
    expect(entry?.metrics["tokens.input"]).toBe(5)
    expect(entry?.metrics["tokens.output"]).toBe(3)
    expect(entry?.metrics["tokens.total"]).toBe(8)
    expect(entry?.metrics["tokens.scorer.input"]).toBe(12)
    expect(entry?.metrics["tokens.scorer.output"]).toBe(4)
    expect(entry?.metrics["tokens.scorer.total"]).toBe(16)
  })

  test("multiple token recordings accumulate correctly within each phase", () => {
    collector.beginTest("suite", "test")

    collector.recordTokens({ promptTokens: 10, completionTokens: 5 })
    collector.recordTokens({ promptTokens: 20, completionTokens: 10 })

    collector.setPhase("scoring")
    collector.recordTokens({ promptTokens: 3, completionTokens: 2 })
    collector.recordTokens({ promptTokens: 7, completionTokens: 4 })

    collector.endTest()

    const [entry] = collector.getTestResults()
    expect(entry?.metrics["tokens.input"]).toBe(30)
    expect(entry?.metrics["tokens.output"]).toBe(15)
    expect(entry?.metrics["tokens.total"]).toBe(45)
    expect(entry?.metrics["tokens.scorer.input"]).toBe(10)
    expect(entry?.metrics["tokens.scorer.output"]).toBe(6)
    expect(entry?.metrics["tokens.scorer.total"]).toBe(16)
  })

  test("phase defaults to task for new test entries", async () => {
    await collector.runTest("suite", "suite", "case-1", async () => {
      collector.recordTokens({ promptTokens: 1, completionTokens: 1 })
    })

    const [entry] = collector.getTestResults()
    expect(entry?.metrics["tokens.input"]).toBe(1)
    expect(entry?.metrics["tokens.output"]).toBe(1)
    expect(entry?.metrics["tokens.scorer.input"]).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 2. measure taskEnd()
// ---------------------------------------------------------------------------

describe("measure taskEnd()", () => {
  test("when taskEnd() is called, latency reflects task-only time", async () => {
    await collector.runTest("suite", "suite", "task-end", async () => {
      await measure(async (m) => {
        await sleep(50)
        m.taskEnd()
        await sleep(50)
      })
    })

    const [entry] = collector.getTestResults()
    const latency = entry?.metrics.latency as number
    const total = entry?.metrics["latency.total"] as number

    // Task latency should be roughly 50ms, total roughly 100ms
    expect(latency).toBeGreaterThan(30)
    expect(latency).toBeLessThan(total)
    expect(total).toBeGreaterThan(80)
  })

  test("when taskEnd() is called, latency.scoring and latency.total are recorded", async () => {
    await collector.runTest("suite", "suite", "scoring-latency", async () => {
      await measure(async (m) => {
        await sleep(30)
        m.taskEnd()
        await sleep(30)
      })
    })

    const [entry] = collector.getTestResults()
    expect(entry?.metrics.latency).toBeDefined()
    expect(entry?.metrics["latency.scoring"]).toBeDefined()
    expect(entry?.metrics["latency.total"]).toBeDefined()

    const scoring = entry?.metrics["latency.scoring"] as number
    expect(scoring).toBeGreaterThan(10)
  })

  test("when taskEnd() is NOT called, only single latency metric (backward compat)", async () => {
    await collector.runTest("suite", "suite", "no-task-end", async () => {
      await measure(async () => {
        await sleep(20)
      })
    })

    const [entry] = collector.getTestResults()
    expect(entry?.metrics.latency).toBeDefined()
    expect(entry?.metrics["latency.scoring"]).toBeUndefined()
    expect(entry?.metrics["latency.total"]).toBeUndefined()
  })

  test("taskEnd() called multiple times only records first timestamp", async () => {
    await collector.runTest("suite", "suite", "multi-task-end", async () => {
      await measure(async (m) => {
        await sleep(30)
        m.taskEnd()
        await sleep(50)
        m.taskEnd() // second call should be ignored
        await sleep(30)
      })
    })

    const [entry] = collector.getTestResults()
    const latency = entry?.metrics.latency as number
    const total = entry?.metrics["latency.total"] as number

    // Task latency should be ~30ms (first taskEnd), not ~80ms (second taskEnd)
    expect(latency).toBeLessThan(60)
    // Total should be ~110ms (30 + 50 + 30)
    expect(total).toBeGreaterThan(80)
  })
})

// ---------------------------------------------------------------------------
// 3. aggregateMetrics with new metric names
// ---------------------------------------------------------------------------

describe("aggregateMetrics with new metric names", () => {
  test("latency.scoring gets latency-kind aggregations", () => {
    const tests: TestMetrics[] = [
      makeTestMetrics({ "latency.scoring": 100 }),
      makeTestMetrics({ "latency.scoring": 200 }),
    ]

    const agg = aggregateMetrics(tests)

    expect(agg["latency.scoring.sum"]).toBe(300)
    expect(agg["latency.scoring.avg"]).toBe(150)
    expect(agg["latency.scoring.min"]).toBe(100)
    expect(agg["latency.scoring.max"]).toBe(200)
    expect(agg["latency.scoring.p50"]).toBeDefined()
    expect(agg["latency.scoring.p95"]).toBeDefined()
  })

  test("latency.total gets latency-kind aggregations", () => {
    const tests: TestMetrics[] = [
      makeTestMetrics({ "latency.total": 500 }),
      makeTestMetrics({ "latency.total": 700 }),
    ]

    const agg = aggregateMetrics(tests)

    expect(agg["latency.total.sum"]).toBe(1200)
    expect(agg["latency.total.avg"]).toBe(600)
    expect(agg["latency.total.min"]).toBe(500)
    expect(agg["latency.total.max"]).toBe(700)
    expect(agg["latency.total.p50"]).toBeDefined()
    expect(agg["latency.total.p95"]).toBeDefined()
  })

  test("tokens.scorer.input gets token-kind aggregations", () => {
    const tests: TestMetrics[] = [
      makeTestMetrics({ "tokens.scorer.input": 50 }),
      makeTestMetrics({ "tokens.scorer.input": 150 }),
    ]

    const agg = aggregateMetrics(tests)

    expect(agg["tokens.scorer.input.sum"]).toBe(200)
    expect(agg["tokens.scorer.input.avg"]).toBe(100)
    expect(agg["tokens.scorer.input.min"]).toBe(50)
    expect(agg["tokens.scorer.input.max"]).toBe(150)
    expect(agg["tokens.scorer.input.p50"]).toBeDefined()
    expect(agg["tokens.scorer.input.p95"]).toBeDefined()
  })

  test("existing latency and tokens.* aggregations still work", () => {
    const tests: TestMetrics[] = [
      makeTestMetrics({ latency: 100, "tokens.input": 10, "tokens.output": 5 }),
      makeTestMetrics({ latency: 200, "tokens.input": 20, "tokens.output": 15 }),
    ]

    const agg = aggregateMetrics(tests)

    expect(agg["latency.sum"]).toBe(300)
    expect(agg["latency.avg"]).toBe(150)
    expect(agg["tokens.input.sum"]).toBe(30)
    expect(agg["tokens.output.sum"]).toBe(20)
  })
})

// ---------------------------------------------------------------------------
// 4. displayMetricName for new names
// ---------------------------------------------------------------------------

describe("displayMetricName for new names", () => {
  test('latency.scoring -> "Scoring Latency"', () => {
    expect(displayMetricName("latency.scoring")).toBe("Scoring Latency")
  })

  test('latency.total -> "Total Latency"', () => {
    expect(displayMetricName("latency.total")).toBe("Total Latency")
  })

  test('tokens.scorer.input -> "Scorer Input Tokens"', () => {
    expect(displayMetricName("tokens.scorer.input")).toBe("Scorer Input Tokens")
  })

  test('tokens.scorer.output -> "Scorer Output Tokens"', () => {
    expect(displayMetricName("tokens.scorer.output")).toBe(
      "Scorer Output Tokens",
    )
  })

  test('tokens.scorer.total -> "Scorer Total Tokens"', () => {
    expect(displayMetricName("tokens.scorer.total")).toBe("Scorer Total Tokens")
  })

  test('tokens.scorer.input.sum -> "Scorer Input Tokens"', () => {
    expect(displayMetricName("tokens.scorer.input.sum")).toBe(
      "Scorer Input Tokens",
    )
  })
})

// ---------------------------------------------------------------------------
// 5. createLLMJudgeScorer
// ---------------------------------------------------------------------------

describe("createLLMJudgeScorer", () => {
  test('sets kind: "judge" on returned scorer', () => {
    const scorer = createLLMJudgeScorer({
      name: "TestJudge",
      judge: async () => 0.8,
    })

    expect(scorer.kind).toBe("judge")
    expect(scorer.name).toBe("TestJudge")
  })

  test("calls judge function and returns result", async () => {
    const scorer = createLLMJudgeScorer({
      name: "TestJudge",
      judge: async ({ input, output }) => ({
        score: 0.9,
        metadata: { detail: `${input}->${output}` },
      }),
    })

    const result = await scorer.scorer({
      input: "q",
      output: "a",
      expected: "a",
    })

    expect(result).toEqual({
      score: 0.9,
      metadata: { detail: "q->a" },
    })
  })

  test("retries on failure (default 2 retries)", async () => {
    let attempts = 0
    const scorer = createLLMJudgeScorer({
      name: "RetryJudge",
      retryDelayMs: 0,
      judge: async () => {
        attempts++
        if (attempts < 3) throw new Error("fail")
        return 0.7
      },
    })

    const result = await scorer.scorer({
      input: "x",
      output: "y",
    })

    expect(attempts).toBe(3)
    expect(result).toBe(0.7)
  })

  test("returns errorScore (default 0) with metadata when retries exhausted", async () => {
    const scorer = createLLMJudgeScorer({
      name: "FailJudge",
      retries: 1,
      retryDelayMs: 0,
      judge: async () => {
        throw new Error("always fails")
      },
    })

    const result = await scorer.scorer({
      input: "x",
      output: "y",
    })

    expect(result).toEqual({
      score: 0,
      metadata: {
        error: "always fails",
        retriesExhausted: true,
        attempts: 2,
      },
    })
  })

  test("passes ScorerInput correctly to judge function", async () => {
    let capturedInput: unknown

    const scorer = createLLMJudgeScorer({
      name: "InputCapture",
      judge: async (input) => {
        capturedInput = input
        return 1
      },
    })

    await scorer.scorer({
      input: "the-input",
      output: "the-output",
      expected: "the-expected",
    })

    expect(capturedInput).toEqual({
      input: "the-input",
      output: "the-output",
      expected: "the-expected",
    })
  })
})

// ---------------------------------------------------------------------------
// 6. wrapAutoeval
// ---------------------------------------------------------------------------

describe("wrapAutoeval", () => {
  test('wraps autoeval function into scorer with kind "judge"', () => {
    const scorer = wrapAutoeval({
      name: "TestAutoeval",
      autoeval: async () => ({ score: 0.5 }),
    })

    expect(scorer.kind).toBe("judge")
    expect(scorer.name).toBe("TestAutoeval")
  })

  test("calls normalizeScore when provided", async () => {
    const scorer = wrapAutoeval({
      name: "Normalized",
      retryDelayMs: 0,
      autoeval: async () => ({ score: 0.5, metadata: { choice: "B" } }),
      normalizeScore: (raw, metadata) => {
        // Custom normalization: map 0.5 to 1 when choice is "B"
        const choice = (metadata as Record<string, unknown>)?.choice
        return choice === "B" ? 1 : raw
      },
    })

    const result = await scorer.scorer({
      input: "q",
      output: "a",
      expected: "a",
    })

    expect(result).toEqual({
      score: 1,
      metadata: { choice: "B" },
    })
  })

  test("handles null score from autoeval (defaults to 0)", async () => {
    const scorer = wrapAutoeval({
      name: "NullScore",
      retryDelayMs: 0,
      autoeval: async () => ({ score: null, metadata: { reason: "unclear" } }),
    })

    const result = await scorer.scorer({
      input: "q",
      output: "a",
    })

    expect(result).toEqual({
      score: 0,
      metadata: { reason: "unclear" },
    })
  })

  test("passes input/output/expected as strings", async () => {
    let capturedArgs: { input: string; output: string; expected?: string } | undefined

    const scorer = wrapAutoeval({
      name: "StringCheck",
      retryDelayMs: 0,
      autoeval: async (args) => {
        capturedArgs = args
        return { score: 1 }
      },
    })

    await scorer.scorer({
      input: "in",
      output: "out",
      expected: "exp",
    })

    expect(capturedArgs).toEqual({
      input: "in",
      output: "out",
      expected: "exp",
    })
  })
})

// ---------------------------------------------------------------------------
// 7. ScorerKind propagation
// ---------------------------------------------------------------------------

describe("ScorerKind propagation", () => {
  test('createScorer with kind: "judge" sets kind on returned scorer', () => {
    const scorer = createScorer({
      name: "JudgeScorer",
      kind: "judge",
      scorer: () => 1,
    })

    expect(scorer.kind).toBe("judge")
  })

  test("createScorer without kind defaults to undefined", () => {
    const scorer = createScorer({
      name: "PlainScorer",
      scorer: () => 1,
    })

    expect(scorer.kind).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
