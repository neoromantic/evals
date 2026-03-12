import { parseCliArgs, runCli } from "./cli"

const args = process.argv.slice(2)
const { jsonOutput } = parseCliArgs(args)

runCli(args)
  .then((exitCode) => {
    process.exit(exitCode)
  })
  .catch((error) => {
    if (jsonOutput) {
      console.log(
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            success: false,
            exitCode: 1,
            error: error instanceof Error ? error.message : String(error),
          },
          null,
          2,
        ),
      )
      process.exit(1)
      return
    }

    console.error("Eval runner failed:", error)
    process.exit(1)
  })
