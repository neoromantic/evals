import { loadEvalEstimates } from "./estimates"
import { discoverEvalFiles, runEvalFiles } from "./runner"
import { selectEvalFilesInteractive } from "./selector"

const RUN_COMMANDS = new Set(["run"])
const SELECT_COMMANDS = new Set(["interactive", "select"])
const VERBOSE_FLAGS = new Set(["--verbose", "--eval-verbose"])
const JSON_FLAGS = new Set(["--json", "--eval-json"])

export interface ParsedCliArgs {
  command: "run" | "select"
  bunArgs: string[]
  verboseReporting: boolean
  jsonOutput: boolean
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

function parseOptionalBooleanFlag(
  arg: string,
  flags: Set<string>,
): boolean | undefined {
  const [rawFlag, rawValue] = arg.split("=", 2)
  const flag = rawFlag ?? ""
  if (!flags.has(flag)) {
    return undefined
  }

  return rawValue === undefined ? true : parseBooleanFlagValue(rawValue)
}

export function parseCliArgs(args: string[]): ParsedCliArgs {
  const firstArg = args[0] ?? ""
  const command = SELECT_COMMANDS.has(firstArg) ? "select" : "run"
  const runnerArgs =
    SELECT_COMMANDS.has(firstArg) || RUN_COMMANDS.has(firstArg)
      ? args.slice(1)
      : args
  const bunArgs: string[] = []
  let verboseReporting = false
  let jsonOutput = false

  for (const arg of runnerArgs) {
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

    bunArgs.push(arg)
  }

  return { command, bunArgs, verboseReporting, jsonOutput }
}

export async function runCli(args: string[]): Promise<number> {
  const cwd = process.cwd()
  const { command, bunArgs, verboseReporting, jsonOutput } = parseCliArgs(args)
  const discoveredEvalFiles = await discoverEvalFiles(cwd)
  const runSelection = (evalFiles: string[]) =>
    runEvalFiles({
      cwd,
      evalFiles,
      bunArgs,
      verboseReporting,
      jsonOutput,
    })

  if (command === "run" || discoveredEvalFiles.length === 0) {
    return runSelection(discoveredEvalFiles)
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

  return runSelection(selection.evalFiles)
}
