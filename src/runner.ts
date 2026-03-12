import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"
import { Glob } from "bun"

export const MIN_BUN_VERSION_FOR_CONCURRENT_CASES = "1.3.9"
const DOTENV_FILENAMES = [".env", ".env.local"] as const

export interface RunEvalFilesOptions {
  cwd: string
  evalFiles: string[]
  bunArgs: string[]
  verboseReporting: boolean
  jsonOutput: boolean
}

function parseVersion(version: string): [number, number, number] {
  const [major = "0", minor = "0", patch = "0"] = version.split(".")
  return [Number(major), Number(minor), Number(patch)]
}

export function isVersionLessThan(version: string, minimum: string): boolean {
  const current = parseVersion(version)
  const target = parseVersion(minimum)

  for (let index = 0; index < 3; index += 1) {
    const left = current[index] ?? 0
    const right = target[index] ?? 0
    if (left < right) return true
    if (left > right) return false
  }

  return false
}

export function loadDotenvEnv(cwd: string): Record<string, string> {
  const loaded: Record<string, string> = {}

  for (const filename of DOTENV_FILENAMES) {
    const filepath = join(cwd, filename)
    if (!existsSync(filepath)) {
      continue
    }

    const content = readFileSync(filepath, "utf-8")
    const parsed = parseDotenvContent(content)
    Object.assign(loaded, parsed)
  }

  return loaded
}

function parseDotenvContent(content: string): Record<string, string> {
  const parsed: Record<string, string> = {}

  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith("#")) {
      continue
    }

    const line = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length)
      : trimmed
    const separatorIndex = line.indexOf("=")
    if (separatorIndex <= 0) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue
    }

    const rawValue = line.slice(separatorIndex + 1).trim()
    parsed[key] = parseDotenvValue(rawValue)
  }

  return parsed
}

function parseDotenvValue(rawValue: string): string {
  const quote = rawValue[0]
  if ((quote === '"' || quote === "'") && rawValue.endsWith(quote)) {
    const inner = rawValue.slice(1, -1)
    if (quote === '"') {
      return inner
        .replaceAll("\\n", "\n")
        .replaceAll("\\r", "\r")
        .replaceAll('\\"', '"')
    }
    return inner
  }

  const uncommented = rawValue.replace(/\s+#.*$/, "").trim()
  return uncommented
}

export async function discoverEvalFiles(cwd: string): Promise<string[]> {
  const glob = new Glob("**/*.eval.ts")
  const evalFiles: string[] = []

  for await (const file of glob.scan({ cwd, absolute: true })) {
    if (
      file.includes("/node_modules/") ||
      file.includes("\\node_modules\\") ||
      file.startsWith("node_modules/")
    ) {
      continue
    }

    evalFiles.push(file)
  }

  evalFiles.sort((left, right) => left.localeCompare(right))
  return evalFiles
}

export function buildBunTestArgs(
  evalFiles: string[],
  bunArgs: string[],
  preloadPath = resolve(import.meta.dir, "preload.ts"),
): string[] {
  return [
    "test",
    "--preload",
    preloadPath,
    "--timeout",
    "60000",
    ...evalFiles,
    ...bunArgs,
  ]
}

function emitNoEvalFilesFound(jsonOutput: boolean): void {
  if (jsonOutput) {
    console.log(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          summary: {
            suiteCount: 0,
            hasBaseline: false,
            regressions: 0,
            metricsOk: 0,
          },
          suites: [],
          variantComparisons: [],
        },
        null,
        2,
      ),
    )
    return
  }

  console.log("No eval files found (*.eval.ts)")
}

function printDiscoveredEvalFiles(cwd: string, evalFiles: string[]): void {
  console.log(`Found ${evalFiles.length} eval file(s):`)
  for (const evalFile of evalFiles) {
    console.log(`  ${relative(cwd, evalFile)}`)
  }
  console.log()
}

export async function runEvalFiles(
  options: RunEvalFilesOptions,
): Promise<number> {
  const { cwd, evalFiles, bunArgs, verboseReporting, jsonOutput } = options

  if (
    !jsonOutput &&
    isVersionLessThan(Bun.version, MIN_BUN_VERSION_FOR_CONCURRENT_CASES)
  ) {
    console.warn(
      `Warning: Bun ${Bun.version} detected. ` +
        `Per-case concurrent eval execution requires Bun ${MIN_BUN_VERSION_FOR_CONCURRENT_CASES}+.`,
    )
  }

  if (evalFiles.length === 0) {
    emitNoEvalFilesFound(jsonOutput)
    return 0
  }

  if (!jsonOutput) {
    printDiscoveredEvalFiles(cwd, evalFiles)
  }

  const dotenvEnv = loadDotenvEnv(cwd)
  const args = buildBunTestArgs(evalFiles, bunArgs)
  const jsonOutputDir = jsonOutput
    ? mkdtempSync(join(tmpdir(), "goodit-evals-json-"))
    : null
  const jsonOutputPath = jsonOutputDir
    ? join(jsonOutputDir, "eval-results.json")
    : null

  try {
    const proc = Bun.spawn(["bun", ...args], {
      cwd,
      stdio: jsonOutput
        ? ["ignore", "pipe", "pipe"]
        : ["inherit", "inherit", "inherit"],
      env: {
        ...dotenvEnv,
        ...process.env,
        EVAL_FILES: evalFiles.join(","),
        ...(verboseReporting ? { EVAL_VERBOSE: "1" } : {}),
        ...(jsonOutput
          ? {
              EVAL_JSON: "1",
              EVAL_JSON_OUTPUT_FILE: jsonOutputPath!,
            }
          : {}),
      },
    })

    const stdoutPromise =
      jsonOutput && proc.stdout
        ? new Response(proc.stdout).text()
        : Promise.resolve("")
    const stderrPromise =
      jsonOutput && proc.stderr
        ? new Response(proc.stderr).text()
        : Promise.resolve("")
    const exitCode = await proc.exited

    if (!jsonOutput) {
      return exitCode
    }

    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])

    let payload: unknown
    if (jsonOutputPath && existsSync(jsonOutputPath)) {
      try {
        payload = JSON.parse(readFileSync(jsonOutputPath, "utf-8"))
      } catch (error) {
        payload = {
          generatedAt: new Date().toISOString(),
          error:
            error instanceof Error
              ? `Failed to parse JSON report: ${error.message}`
              : "Failed to parse JSON report",
        }
      }
    } else {
      payload = {
        generatedAt: new Date().toISOString(),
        error: "Eval run did not produce JSON output",
        bunStdout: stdout.trim(),
        bunStderr: stderr.trim(),
      }
    }

    if (exitCode !== 0 && payload && typeof payload === "object") {
      payload = {
        ...payload,
        success: false,
        exitCode,
        bunStdout: stdout.trim(),
        bunStderr: stderr.trim(),
      }
    }

    console.log(JSON.stringify(payload, null, 2))
    return exitCode
  } finally {
    if (jsonOutputDir) {
      rmSync(jsonOutputDir, { recursive: true, force: true })
    }
  }
}
