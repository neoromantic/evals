import { describe, expect, test } from "bun:test"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { buildBunTestArgs, discoverEvalFiles, loadDotenvEnv } from "./runner"

describe("discoverEvalFiles", () => {
  test("finds eval files under cwd and skips node_modules", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "goodit-evals-discovery-"))
    const rootEvalFile = join(tempDir, "a.eval.ts")
    const nestedEvalFile = join(tempDir, "nested", "b.eval.ts")

    try {
      mkdirSync(join(tempDir, "nested"), { recursive: true })
      mkdirSync(join(tempDir, "node_modules", "pkg"), { recursive: true })
      writeFileSync(rootEvalFile, "")
      writeFileSync(nestedEvalFile, "")
      writeFileSync(join(tempDir, "node_modules", "pkg", "ignored.eval.ts"), "")

      expect(await discoverEvalFiles(tempDir)).toEqual([
        rootEvalFile,
        nestedEvalFile,
      ])
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

describe("buildBunTestArgs", () => {
  test("includes preload path, timeout, eval files, and passthrough args", () => {
    const preloadPath = resolve(import.meta.dir, "preload.ts")
    expect(
      buildBunTestArgs(
        ["/tmp/a.eval.ts"],
        ["--test-name-pattern", "suite"],
        preloadPath,
      ),
    ).toEqual([
      "test",
      "--preload",
      preloadPath,
      "--timeout",
      "60000",
      "/tmp/a.eval.ts",
      "--test-name-pattern",
      "suite",
    ])
  })
})

describe("loadDotenvEnv", () => {
  test(".env.local overrides .env values", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "goodit-evals-dotenv-"))

    try {
      writeFileSync(
        join(tempDir, ".env"),
        ["API_KEY=from-env", "PLAIN=value # comment", ""].join("\n"),
      )
      writeFileSync(
        join(tempDir, ".env.local"),
        ['export API_KEY="from-local"', "FEATURE_FLAG=yes", ""].join("\n"),
      )

      expect(loadDotenvEnv(tempDir)).toEqual({
        API_KEY: "from-local",
        PLAIN: "value",
        FEATURE_FLAG: "yes",
      })
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

describe("--json output", () => {
  test("prints the whole report when stdout is a pipe", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "evals-json-pipe-"))
    const indexPath = resolve(import.meta.dir, "index.ts")
    const runPath = resolve(import.meta.dir, "run.ts")

    try {
      writeFileSync(
        join(tempDir, "big.eval.ts"),
        [
          `import { ExactMatch, evalSuite } from ${JSON.stringify(indexPath)}`,
          "",
          'evalSuite("big report", {',
          "  data: () =>",
          "    Array.from({ length: 200 }, (_, i) => ({",
          '      input: `case-${i}-${"x".repeat(200)}`,',
          '      expected: `case-${i}-${"x".repeat(200)}`,',
          "    })),",
          "  task: async (input: string) => input,",
          "  scorers: [ExactMatch],",
          "})",
          "",
        ].join("\n"),
      )

      // A shell pipe reproduces the truncation; Bun.spawn's own pipe drains
      // too fast to hit it.
      const outPath = join(tempDir, "out.json")
      const proc = Bun.spawn(
        ["sh", "-c", 'bun "$0" --json 2>/dev/null | cat > "$1"', runPath, outPath],
        { cwd: tempDir, env: process.env, stdin: "ignore" },
      )
      await proc.exited
      const stdout = readFileSync(outPath, "utf-8")

      expect(stdout.length).toBeGreaterThan(64 * 1024)
      const payload = JSON.parse(stdout) as { summary: { suiteCount: number } }
      expect(payload.summary.suiteCount).toBe(1)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  }, 30000)
})
