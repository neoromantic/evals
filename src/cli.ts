import { loadEvalEstimates } from "./estimates"
import { discoverEvalFiles, runEvalFiles } from "./runner"
import { selectEvalFilesInteractive } from "./selector"

const RUN_COMMANDS = new Set(["run"])
const SELECT_COMMANDS = new Set(["interactive", "select"])

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
    if (arg === "--verbose" || arg === "--eval-verbose") {
      verboseReporting = true
      continue
    }

    if (arg === "--json" || arg === "--eval-json") {
      jsonOutput = true
      continue
    }

    const [flag, rawValue] = arg.split("=", 2)
    if (flag === "--verbose" || flag === "--eval-verbose") {
      verboseReporting = parseBooleanFlagValue(rawValue)
      continue
    }

    if (flag === "--json" || flag === "--eval-json") {
      jsonOutput = parseBooleanFlagValue(rawValue)
      continue
    }

    bunArgs.push(arg)
  }

  return { command, bunArgs, verboseReporting, jsonOutput }
}

export async function runCli(args: string[]): Promise<number> {
  const cwd = process.cwd()
  const parsedArgs = parseCliArgs(args)
  const discoveredEvalFiles = await discoverEvalFiles(cwd)

  if (parsedArgs.command === "run" || discoveredEvalFiles.length === 0) {
    return runEvalFiles({
      cwd,
      evalFiles: discoveredEvalFiles,
      bunArgs: parsedArgs.bunArgs,
      verboseReporting: parsedArgs.verboseReporting,
      jsonOutput: parsedArgs.jsonOutput,
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
    bunArgs: parsedArgs.bunArgs,
    verboseReporting: parsedArgs.verboseReporting,
    jsonOutput: parsedArgs.jsonOutput,
  })
}
