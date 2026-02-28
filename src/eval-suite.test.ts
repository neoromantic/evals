import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { detectEvalFileFromStack, getAsyncSuiteTimeout } from "./eval-suite"

const textDecoder = new TextDecoder()

function combinedOutput(stdout: Uint8Array, stderr: Uint8Array): string {
  return `${textDecoder.decode(stdout)}${textDecoder.decode(stderr)}`
}

describe("detectEvalFileFromStack", () => {
  test("detects .eval.ts paths from stack lines", () => {
    const stack = [
      "Error",
      "  at suite (/Users/tester/evals/basic.eval.ts:12:34)",
    ].join("\n")

    expect(detectEvalFileFromStack(stack)).toBe(
      "/Users/tester/evals/basic.eval.ts",
    )
  })

  test("detects .eval.js paths from stack lines", () => {
    const stack = [
      "Error",
      "  at Object.<anonymous> (file:///Users/tester/evals/basic.eval.js:7:9)",
    ].join("\n")

    expect(detectEvalFileFromStack(stack)).toBe(
      "/Users/tester/evals/basic.eval.js",
    )
  })
})

describe("getAsyncSuiteTimeout", () => {
  test("scales timeout by number of cases", () => {
    expect(getAsyncSuiteTimeout(1_000, 4)).toBe(4_000)
  })

  test("uses at least one timeout window", () => {
    expect(getAsyncSuiteTimeout(1_000, 0)).toBe(1_000)
    expect(getAsyncSuiteTimeout(1_000, -2)).toBe(1_000)
    expect(getAsyncSuiteTimeout(1_000, Number.NaN)).toBe(1_000)
  })
})

describe("evalSuite async data integration", () => {
  test("rejected async data fails test without unhandled rejection", () => {
    const root = resolve(import.meta.dir, "../../..")
    const preloadPath = resolve(import.meta.dir, "preload.ts")
    const indexPath = resolve(import.meta.dir, "index.ts")
    const tempDir = mkdtempSync(join(tmpdir(), "jupid-evals-"))
    const evalPath = join(tempDir, "rejecting-data.eval.ts")

    try {
      writeFileSync(
        evalPath,
        [
          'process.on("unhandledRejection", () => {',
          '  console.error("UNHANDLED_REJECTION")',
          "  process.exit(91)",
          "})",
          `import { evalSuite, ExactMatch } from ${JSON.stringify(indexPath)}`,
          "",
          'evalSuite("async data rejection suite", {',
          "  data: async () => {",
          '    throw new Error("data source failed")',
          "  },",
          "  task: async (input: string) => input,",
          "  scorers: [ExactMatch],",
          "})",
          "",
        ].join("\n"),
      )

      const run = Bun.spawnSync(
        ["bun", "test", "--preload", preloadPath, evalPath],
        {
          cwd: root,
          env: process.env,
          stdout: "pipe",
          stderr: "pipe",
        },
      )

      const output = combinedOutput(run.stdout, run.stderr)

      expect(run.exitCode).toBe(1)
      expect(output).toContain("data source failed")
      expect(output).not.toContain("UNHANDLED_REJECTION")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("hanging async data fails with timeout message", () => {
    const root = resolve(import.meta.dir, "../../..")
    const preloadPath = resolve(import.meta.dir, "preload.ts")
    const indexPath = resolve(import.meta.dir, "index.ts")
    const tempDir = mkdtempSync(join(tmpdir(), "jupid-evals-"))
    const evalPath = join(tempDir, "hanging-data.eval.ts")

    try {
      writeFileSync(
        evalPath,
        [
          `import { evalSuite, ExactMatch } from ${JSON.stringify(indexPath)}`,
          "",
          'evalSuite("async data timeout suite", {',
          "  timeout: 100,",
          "  data: async () => new Promise(() => {}),",
          "  task: async (input: string) => input,",
          "  scorers: [ExactMatch],",
          "})",
          "",
        ].join("\n"),
      )

      const run = Bun.spawnSync(
        ["bun", "test", "--preload", preloadPath, evalPath],
        {
          cwd: root,
          env: process.env,
          stdout: "pipe",
          stderr: "pipe",
        },
      )

      const output = combinedOutput(run.stdout, run.stderr)

      expect(run.exitCode).toBe(1)
      expect(output).toContain("async data timeout suite")
      expect(output).toContain("timed out after 100ms")
      expect(output).toContain("while loading data")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("async-data cases overlap within one suite", () => {
    const root = resolve(import.meta.dir, "../../..")
    const preloadPath = resolve(import.meta.dir, "preload.ts")
    const indexPath = resolve(import.meta.dir, "index.ts")
    const tempDir = mkdtempSync(join(tmpdir(), "jupid-evals-"))
    const evalPath = join(tempDir, "parallel-async-cases.eval.ts")
    const tracePath = join(tempDir, "parallel-trace.json")

    try {
      writeFileSync(
        evalPath,
        [
          'import { afterAll } from "bun:test"',
          'import { writeFileSync } from "node:fs"',
          `import { evalSuite, ExactMatch } from ${JSON.stringify(indexPath)}`,
          "",
          "const sleep = (ms: number) =>",
          "  new Promise((resolve) => setTimeout(resolve, ms))",
          "let activeTasks = 0",
          "let maxActiveTasks = 0",
          "",
          'evalSuite("parallel async suite", {',
          "  data: async () => [",
          '    { input: "alpha", expected: "alpha" },',
          '    { input: "beta", expected: "beta" },',
          '    { input: "gamma", expected: "gamma" },',
          "  ],",
          "  task: async (input: string) => {",
          "    activeTasks += 1",
          "    maxActiveTasks = Math.max(maxActiveTasks, activeTasks)",
          "    await sleep(120)",
          "    activeTasks -= 1",
          "    return input",
          "  },",
          "  scorers: [ExactMatch],",
          "})",
          "",
          "afterAll(() => {",
          `  writeFileSync(${JSON.stringify(tracePath)},`,
          "    JSON.stringify({ maxActiveTasks }))",
          "})",
          "",
        ].join("\n"),
      )

      const run = Bun.spawnSync(
        ["bun", "test", "--preload", preloadPath, evalPath],
        {
          cwd: root,
          env: process.env,
          stdout: "pipe",
          stderr: "pipe",
        },
      )

      const output = combinedOutput(run.stdout, run.stderr)
      const trace = JSON.parse(readFileSync(tracePath, "utf-8")) as {
        maxActiveTasks: number
      }

      expect(run.exitCode).toBe(0)
      expect(output).toContain("parallel async suite")
      expect(output).toContain("evaluate all")
      expect(trace.maxActiveTasks).toBeGreaterThan(1)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("parallel async-data suite results are deterministic", () => {
    const root = resolve(import.meta.dir, "../../..")
    const preloadPath = resolve(import.meta.dir, "preload.ts")
    const indexPath = resolve(import.meta.dir, "index.ts")
    const tempDir = mkdtempSync(join(tmpdir(), "jupid-evals-"))
    const evalPath = join(tempDir, "parallel-deterministic.eval.ts")
    const outputPath = join(tempDir, "parallel-output.json")

    type Snapshot = {
      passRate: number | undefined
      averageScore: number | undefined
    }

    const runAndCapture = (): Snapshot => {
      rmSync(outputPath, { force: true })

      const run = Bun.spawnSync(
        ["bun", "test", "--preload", preloadPath, evalPath],
        {
          cwd: root,
          env: { ...process.env, EVAL_OUTPUT: outputPath },
          stdout: "pipe",
          stderr: "pipe",
        },
      )

      expect(run.exitCode).toBe(0)

      const output = combinedOutput(run.stdout, run.stderr)
      expect(output).toContain("deterministic mixed suite")

      const raw = JSON.parse(readFileSync(outputPath, "utf-8")) as Record<
        string,
        { aggregates?: Record<string, number> }
      >
      const suite = raw["deterministic mixed suite"]?.aggregates

      return {
        passRate: suite?.["test.pass_rate"],
        averageScore: suite?.["score.ExactMatch.avg"],
      }
    }

    try {
      writeFileSync(
        evalPath,
        [
          `import { evalSuite, ExactMatch } from ${JSON.stringify(indexPath)}`,
          "",
          "const sleep = (ms: number) =>",
          "  new Promise((resolve) => setTimeout(resolve, ms))",
          "",
          'evalSuite("deterministic mixed suite", {',
          "  data: async () => [",
          '    { input: "pass-a", expected: "pass-a" },',
          '    { input: "fail", expected: "pass" },',
          '    { input: "pass-b", expected: "pass-b" },',
          "  ],",
          "  task: async (input: string) => {",
          "    await sleep(80)",
          "    return input",
          "  },",
          "  scorers: [ExactMatch],",
          "})",
          "",
        ].join("\n"),
      )

      const first = runAndCapture()
      const second = runAndCapture()
      const third = runAndCapture()

      expect(first.passRate).toBeCloseTo(2 / 3, 8)
      expect(first.averageScore).toBeCloseTo(2 / 3, 8)
      expect(second).toEqual(first)
      expect(third).toEqual(first)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

describe("evalSuite sync data integration", () => {
  test("array data overlaps when Bun supports test.concurrent", () => {
    const root = resolve(import.meta.dir, "../../..")
    const preloadPath = resolve(import.meta.dir, "preload.ts")
    const indexPath = resolve(import.meta.dir, "index.ts")
    const tempDir = mkdtempSync(join(tmpdir(), "jupid-evals-"))
    const evalPath = join(tempDir, "parallel-sync-cases.eval.ts")
    const tracePath = join(tempDir, "parallel-sync-trace.json")

    try {
      writeFileSync(
        evalPath,
        [
          'import { afterAll, test } from "bun:test"',
          'import { writeFileSync } from "node:fs"',
          `import { evalSuite, ExactMatch } from ${JSON.stringify(indexPath)}`,
          "",
          "const sleep = (ms: number) =>",
          "  new Promise((resolve) => setTimeout(resolve, ms))",
          "let activeTasks = 0",
          "let maxActiveTasks = 0",
          "",
          'evalSuite("parallel sync suite", {',
          "  data: [",
          '    { input: "alpha", expected: "alpha" },',
          '    { input: "beta", expected: "beta" },',
          '    { input: "gamma", expected: "gamma" },',
          "  ],",
          "  task: async (input: string) => {",
          "    activeTasks += 1",
          "    maxActiveTasks = Math.max(maxActiveTasks, activeTasks)",
          "    await sleep(120)",
          "    activeTasks -= 1",
          "    return input",
          "  },",
          "  scorers: [ExactMatch],",
          "})",
          "",
          "afterAll(() => {",
          `  writeFileSync(${JSON.stringify(tracePath)},`,
          "    JSON.stringify({",
          '      supportsConcurrent: typeof (test as { concurrent?: unknown }).concurrent === "function",',
          "      maxActiveTasks,",
          "    }))",
          "})",
          "",
        ].join("\n"),
      )

      const run = Bun.spawnSync(
        ["bun", "test", "--preload", preloadPath, evalPath],
        {
          cwd: root,
          env: process.env,
          stdout: "pipe",
          stderr: "pipe",
        },
      )

      const output = combinedOutput(run.stdout, run.stderr)
      const trace = JSON.parse(readFileSync(tracePath, "utf-8")) as {
        supportsConcurrent: boolean
        maxActiveTasks: number
      }

      expect(run.exitCode).toBe(0)
      expect(output).toContain("parallel sync suite")

      if (trace.supportsConcurrent) {
        expect(trace.maxActiveTasks).toBeGreaterThan(1)
      } else {
        expect(trace.maxActiveTasks).toBe(1)
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
