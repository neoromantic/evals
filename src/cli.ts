import { loadEvalEstimates } from "./estimates"
import { discoverEvalFiles, runEvalFiles } from "./runner"
import { selectEvalFilesInteractive } from "./selector"

const RUN_COMMANDS = new Set(["run"])
const SELECT_COMMANDS = new Set(["interactive", "select"])
const VERBOSE_FLAGS = new Set(["--verbose", "--eval-verbose"])
const JSON_FLAGS = new Set(["--json", "--eval-json"])
const FILTER_FLAGS = new Set(["--filter", "--eval-filter"])

export interface ParsedCliArgs {
  command: "run" | "select"
  bunArgs: string[]
  verboseReporting: boolean
  jsonOutput: boolean
  fileFilter?: string
}

function parseBooleanFlagValue(rawValue: string | undefined): boolean {
  const normalizedValue = rawValue?.trim().toLowerCase()
  return (
    normalizedValue === undefined ||
    normalizedValue === "1" ||
    normalizedValue === "true" ||
    normalizedValue === "yes" ||
    normalizedValue === "on"
  )
}

function parseValueFlag(
  arg: string,
  flags: Set<string>,
): string | undefined {
  const eqIndex = arg.indexOf("=")
  if (eqIndex <= 0) return undefined
  const flag = arg.slice(0, eqIndex)
  if (!flags.has(flag)) return undefined
  return arg.slice(eqIndex + 1)
}

function parseOptionalBooleanFlag(
  arg: string,
  flags: Set<string>,
): boolean | undefined {
  const [flag = "", rawValue] = arg.split("=", 2)
  if (!flags.has(flag)) {
    return undefined
  }

  return rawValue === undefined ? true : parseBooleanFlagValue(rawValue)
}

export function parseCliArgs(args: string[]): ParsedCliArgs {
  const firstArg = args[0] ?? ""
  const isSelectCommand = SELECT_COMMANDS.has(firstArg)
  const isRunnerCommand = isSelectCommand || RUN_COMMANDS.has(firstArg)
  const command = isSelectCommand ? "select" : "run"
  const runnerArgs = isRunnerCommand ? args.slice(1) : args
  const bunArgs: string[] = []
  let verboseReporting = false
  let jsonOutput = false
  let fileFilter: string | undefined

  for (let i = 0; i < runnerArgs.length; i++) {
    const arg = runnerArgs[i]!

    const verboseValue = parseOptionalBooleanFlag(arg, VERBOSE_FLAGS)
    if (verboseValue !== undefined) {
      verboseReporting = verboseValue
      continue
    }

    const jsonValue = parseOptionalBooleanFlag(arg, JSON_FLAGS)
    if (jsonValue !== undefined) {
      jsonOutput = jsonValue
      continue
    }

    if (FILTER_FLAGS.has(arg)) {
      fileFilter = runnerArgs[++i]
      continue
    }

    const filterAssignment = parseValueFlag(arg, FILTER_FLAGS)
    if (filterAssignment !== undefined) {
      fileFilter = filterAssignment
      continue
    }

    bunArgs.push(arg)
  }

  return { command, bunArgs, verboseReporting, jsonOutput, fileFilter }
}

export async function runCli(args: string[]): Promise<number> {
  const cwd = process.cwd()
  const { command, bunArgs, verboseReporting, jsonOutput, fileFilter } =
    parseCliArgs(args)
  let discoveredEvalFiles = await discoverEvalFiles(cwd)

  if (fileFilter) {
    const pattern = fileFilter.toLowerCase()
    discoveredEvalFiles = discoveredEvalFiles.filter((f) =>
      f.toLowerCase().includes(pattern),
    )
  }

  if (command === "run" || discoveredEvalFiles.length === 0) {
    return runEvalFiles({
      cwd,
      evalFiles: discoveredEvalFiles,
      bunArgs,
      verboseReporting,
      jsonOutput,
    })
  }

  const selection = await selectEvalFilesInteractive({
    cwd,
    evalFiles: discoveredEvalFiles,
    estimates: loadEvalEstimates(discoveredEvalFiles),
  })

  if (selection.kind === "cancel") {
    console.log("Selection cancelled.")
    return 0
  }

  return runEvalFiles({
    cwd,
    evalFiles: selection.evalFiles,
    bunArgs,
    verboseReporting,
    jsonOutput,
  })
}
