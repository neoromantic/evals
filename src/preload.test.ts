import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { compareMetrics, getBaselinePath } from "./baseline"
import { buildPerTestMetrics, resolveEvalFileForSuite } from "./preload"
import type { BaselineFile, TestMetrics } from "./types"

describe("resolveEvalFileForSuite", () => {
  test("keeps per-suite mapped file when available", () => {
    const env: NodeJS.ProcessEnv = {
      EVAL_FILE: "/tmp/from-eval-file.eval.ts",
      EVAL_FILES: "/tmp/a.eval.ts,/tmp/b.eval.ts",
    }

    expect(resolveEvalFileForSuite("/tmp/per-suite.eval.ts", env)).toBe(
      "/tmp/per-suite.eval.ts",
    )
  })

  test("falls back to EVAL_FILE first", () => {
    const env: NodeJS.ProcessEnv = {
      EVAL_FILE: "/tmp/from-eval-file.eval.ts",
      EVAL_FILES: "/tmp/a.eval.ts,/tmp/b.eval.ts",
    }

    expect(resolveEvalFileForSuite(undefined, env)).toBe(
      "/tmp/from-eval-file.eval.ts",
    )
  })

  test("falls back to first EVAL_FILES entry", () => {
    const env: NodeJS.ProcessEnv = {
      EVAL_FILES: " /tmp/a.eval.ts, /tmp/b.eval.ts ",
    }

    expect(resolveEvalFileForSuite(undefined, env)).toBe("/tmp/a.eval.ts")
  })
})

describe("buildPerTestMetrics", () => {
  test("uses stable readable keys for duplicate test names", () => {
    const tests: TestMetrics[] = [
      {
        suiteKey: "suite::suite",
        suiteName: "suite",
        testName: "duplicate",
        metrics: { latency: 10 },
        weight: 1,
        passed: true,
        scorerResults: [],
      },
      {
        suiteKey: "suite::suite",
        suiteName: "suite",
        testName: "duplicate",
        metrics: { latency: 20 },
        weight: 1,
        passed: true,
        scorerResults: [],
      },
      {
        suiteKey: "suite::suite",
        suiteName: "suite",
        testName: "duplicate",
        metrics: { latency: 30 },
        weight: 1,
        passed: true,
        scorerResults: [],
      },
    ]

    const perTest = buildPerTestMetrics(tests)

    expect(Object.keys(perTest)).toEqual([
      "duplicate",
      "duplicate (#2)",
      "duplicate (#3)",
    ])
    expect(perTest.duplicate?.latency).toBe(10)
    expect(perTest["duplicate (#2)"]?.latency).toBe(20)
    expect(perTest["duplicate (#3)"]?.latency).toBe(30)
  })

  test("avoids overwrite when raw names match generated suffix pattern", () => {
    const tests: TestMetrics[] = [
      {
        suiteKey: "suite::suite",
        suiteName: "suite",
        testName: "x",
        metrics: { latency: 11 },
        weight: 1,
        passed: true,
        scorerResults: [],
      },
      {
        suiteKey: "suite::suite",
        suiteName: "suite",
        testName: "x",
        metrics: { latency: 22 },
        weight: 1,
        passed: true,
        scorerResults: [],
      },
      {
        suiteKey: "suite::suite",
        suiteName: "suite",
        testName: "x (#2)",
        metrics: { latency: 33 },
        weight: 1,
        passed: true,
        scorerResults: [],
      },
    ]

    const perTest = buildPerTestMetrics(tests)
    const keys = Object.keys(perTest)

    expect(keys.length).toBe(3)
    expect(new Set(keys).size).toBe(3)
    expect(perTest.x?.latency).toBe(11)
    expect(perTest["x (#2)"]?.latency).toBe(22)
    expect(perTest["x (#2) (#2)"]?.latency).toBe(33)
  })
})

describe("duplicate test names integration", () => {
  test("raw output keeps all duplicated test entries", () => {
    const root = resolve(import.meta.dir, "../../..")
    const preloadPath = resolve(import.meta.dir, "preload.ts")
    const indexPath = resolve(import.meta.dir, "index.ts")
    const tempDir = mkdtempSync(join(tmpdir(), "jupid-evals-"))
    const evalPath = join(tempDir, "duplicate-names.eval.ts")
    const outputPath = join(tempDir, "eval-output.json")

    try {
      writeFileSync(
        evalPath,
        [
          `import { evalSuite, ExactMatch } from ${JSON.stringify(indexPath)}`,
          "",
          'evalSuite("duplicate name suite", {',
          "  data: [",
          '    { input: "same", expected: "same" },',
          '    { input: "same", expected: "same" },',
          "  ],",
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
          env: { ...process.env, EVAL_OUTPUT: outputPath },
          stdout: "pipe",
          stderr: "pipe",
        },
      )

      const output = `${new TextDecoder().decode(run.stdout)}${new TextDecoder().decode(run.stderr)}`

      expect(run.exitCode).toBe(0)
      expect(output).toContain("duplicate name suite")

      const raw = JSON.parse(readFileSync(outputPath, "utf-8")) as Record<
        string,
        { perTest: Record<string, Record<string, number>> }
      >
      const perTest = raw["duplicate name suite"]?.perTest
      expect(perTest).toBeDefined()
      expect(Object.keys(perTest ?? {})).toEqual(["same", "same (#2)"])
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

describe("custom test names integration", () => {
  test("uses EvalData.name as the per-test label", () => {
    const root = resolve(import.meta.dir, "../../..")
    const preloadPath = resolve(import.meta.dir, "preload.ts")
    const indexPath = resolve(import.meta.dir, "index.ts")
    const tempDir = mkdtempSync(join(tmpdir(), "jupid-evals-"))
    const evalPath = join(tempDir, "custom-names.eval.ts")
    const outputPath = join(tempDir, "eval-output.json")

    try {
      writeFileSync(
        evalPath,
        [
          `import { evalSuite, ExactMatch } from ${JSON.stringify(indexPath)}`,
          "",
          'evalSuite("custom names suite", {',
          "  data: [",
          '    { name: "name established", input: "a", expected: "a" },',
          '    { name: "email evidence", input: "b", expected: "b" },',
          "  ],",
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
          env: { ...process.env, EVAL_OUTPUT: outputPath },
          stdout: "pipe",
          stderr: "pipe",
        },
      )

      expect(run.exitCode).toBe(0)

      const raw = JSON.parse(readFileSync(outputPath, "utf-8")) as Record<
        string,
        { perTest: Record<string, Record<string, number>> }
      >
      const perTest = raw["custom names suite"]?.perTest
      expect(perTest).toBeDefined()
      expect(Object.keys(perTest ?? {})).toEqual([
        "name established",
        "email evidence",
      ])
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

describe("suite identity collision integration", () => {
  test("same suite name in different eval files is kept separate", () => {
    const root = resolve(import.meta.dir, "../../..")
    const preloadPath = resolve(import.meta.dir, "preload.ts")
    const indexPath = resolve(import.meta.dir, "index.ts")
    const tempDir = mkdtempSync(join(tmpdir(), "jupid-evals-"))
    const evalAPath = join(tempDir, "a.eval.ts")
    const evalBPath = join(tempDir, "b.eval.ts")
    const outputPath = join(tempDir, "eval-output.json")

    try {
      writeFileSync(
        evalAPath,
        [
          `import { evalSuite, ExactMatch } from ${JSON.stringify(indexPath)}`,
          "",
          'evalSuite("same suite", {',
          '  data: [{ input: "A", expected: "A" }],',
          "  task: async (input: string) => input,",
          "  scorers: [ExactMatch],",
          "})",
          "",
        ].join("\n"),
      )

      writeFileSync(
        evalBPath,
        [
          `import { evalSuite, ExactMatch } from ${JSON.stringify(indexPath)}`,
          "",
          'evalSuite("same suite", {',
          '  data: [{ input: "B", expected: "B" }],',
          "  task: async (input: string) => input,",
          "  scorers: [ExactMatch],",
          "})",
          "",
        ].join("\n"),
      )

      const run = Bun.spawnSync(
        ["bun", "test", "--preload", preloadPath, evalAPath, evalBPath],
        {
          cwd: root,
          env: { ...process.env, EVAL_OUTPUT: outputPath },
          stdout: "pipe",
          stderr: "pipe",
        },
      )

      expect(run.exitCode).toBe(0)

      const raw = JSON.parse(readFileSync(outputPath, "utf-8")) as Record<
        string,
        {
          suiteKey: string
          suiteName: string
          perTest: Record<string, Record<string, number>>
        }
      >
      const keyedEntries = Object.entries(raw)
        .filter(
          ([key, entry]) =>
            key === entry.suiteKey &&
            entry.suiteName === "same suite" &&
            entry.suiteKey.includes("::same suite"),
        )
        .map(([, entry]) => entry)

      expect(keyedEntries.length).toBe(2)
      expect(new Set(keyedEntries.map((entry) => entry.suiteKey)).size).toBe(2)
      expect(
        keyedEntries.some((entry) => Object.keys(entry.perTest).includes("A")),
      ).toBe(true)
      expect(
        keyedEntries.some((entry) => Object.keys(entry.perTest).includes("B")),
      ).toBe(true)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

describe("multi-suite baseline integration", () => {
  test("persists evalSuite.each variants and compares each suite independently", () => {
    const root = resolve(import.meta.dir, "../../..")
    const preloadPath = resolve(import.meta.dir, "preload.ts")
    const indexPath = resolve(import.meta.dir, "index.ts")
    const tempDir = mkdtempSync(join(tmpdir(), "jupid-evals-"))
    const evalPath = join(tempDir, "multi-suite.eval.ts")
    const outputPath = join(tempDir, "eval-output.json")

    const writeEvalFile = (variantOneOutput: string) => {
      writeFileSync(
        evalPath,
        [
          `import { evalSuite, ExactMatch } from ${JSON.stringify(indexPath)}`,
          "",
          "const variants = [",
          `  { name: "v1", output: ${JSON.stringify(variantOneOutput)} },`,
          '  { name: "v2", output: "ok" },',
          "] as const",
          "",
          'evalSuite.each(variants)("variant suite", {',
          '  data: [{ input: "x", expected: "ok" }],',
          "  task: async (_input: string, variant) => variant.output,",
          "  scorers: [ExactMatch],",
          "})",
          "",
        ].join("\n"),
      )
    }

    try {
      writeEvalFile("ok")

      const baselineRun = Bun.spawnSync(
        ["bun", "test", "--preload", preloadPath, evalPath],
        {
          cwd: root,
          env: { ...process.env, UPDATE_BASELINE: "1" },
          stdout: "pipe",
          stderr: "pipe",
        },
      )

      expect(baselineRun.exitCode).toBe(0)

      writeEvalFile("bad")

      const compareRun = Bun.spawnSync(
        ["bun", "test", "--preload", preloadPath, evalPath],
        {
          cwd: root,
          env: { ...process.env, EVAL_OUTPUT: outputPath },
          stdout: "pipe",
          stderr: "pipe",
        },
      )

      const output = `${new TextDecoder().decode(compareRun.stdout)}${new TextDecoder().decode(compareRun.stderr)}`

      expect(compareRun.exitCode).toBe(0)
      expect(output).toContain("variant suite [v1]")
      expect(output).toContain("variant suite [v2]")

      const baselinePath = getBaselinePath(evalPath)
      const baseline = JSON.parse(
        readFileSync(baselinePath, "utf-8"),
      ) as BaselineFile
      const suites = baseline._suites ?? {}
      const suiteKeys = Object.keys(suites)
      expect(suiteKeys.length).toBe(2)

      const raw = JSON.parse(readFileSync(outputPath, "utf-8")) as Record<
        string,
        {
          suiteKey: string
          suiteName: string
          aggregates: Record<string, number>
        }
      >

      for (const suiteKey of suiteKeys) {
        const suiteBaseline = suites[suiteKey]
        expect(suiteBaseline).toBeDefined()

        const current = raw[suiteKey]?.aggregates
        expect(current).toBeDefined()

        const comparisons = compareMetrics(
          current ?? {},
          suiteBaseline!._aggregate,
        )
        const scoreComparison = comparisons.find(
          (entry) => entry.metric === "score.ExactMatch.avg",
        )

        if (suiteKey.includes("[v1]")) {
          expect(scoreComparison?.regressed).toBe(true)
        } else {
          expect(scoreComparison?.regressed).toBe(false)
        }
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

describe("json output integration", () => {
  test("writes structured json payload with variant comparisons", () => {
    const root = resolve(import.meta.dir, "../../..")
    const preloadPath = resolve(import.meta.dir, "preload.ts")
    const indexPath = resolve(import.meta.dir, "index.ts")
    const tempDir = mkdtempSync(join(tmpdir(), "jupid-evals-"))
    const evalPath = join(tempDir, "json-output.eval.ts")
    const jsonOutputPath = join(tempDir, "eval-report.json")

    try {
      writeFileSync(
        evalPath,
        [
          `import { evalSuite, ExactMatch } from ${JSON.stringify(indexPath)}`,
          "",
          "const variants = [",
          '  { name: "a", output: "ok" },',
          '  { name: "b", output: "bad" },',
          "] as const",
          "",
          'evalSuite.each(variants)("json suite", {',
          '  data: [{ input: "x", expected: "ok" }],',
          "  task: async (_input: string, variant) => variant.output,",
          "  scorers: [ExactMatch],",
          "})",
          "",
        ].join("\n"),
      )

      const run = Bun.spawnSync(
        ["bun", "test", "--preload", preloadPath, evalPath],
        {
          cwd: root,
          env: {
            ...process.env,
            EVAL_JSON: "1",
            EVAL_JSON_OUTPUT_FILE: jsonOutputPath,
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      )

      expect(run.exitCode).toBe(0)

      const payload = JSON.parse(readFileSync(jsonOutputPath, "utf-8")) as {
        summary: { suiteCount: number }
        suites: Array<{ suiteName: string }>
        variantComparisons: Array<{
          baseSuiteName: string
          variants: Array<{ variantName: string }>
        }>
      }

      expect(payload.summary.suiteCount).toBe(2)
      expect(payload.suites.map((suite) => suite.suiteName)).toEqual([
        "json suite [a]",
        "json suite [b]",
      ])
      expect(payload.variantComparisons.length).toBe(1)
      expect(payload.variantComparisons[0]?.baseSuiteName).toBe("json suite")
      expect(
        payload.variantComparisons[0]?.variants.map(
          (variant) => variant.variantName,
        ),
      ).toEqual(["a", "b"])
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
