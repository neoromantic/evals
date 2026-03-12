import { parseCliArgs, runCli } from "./cli"

runCli(process.argv.slice(2))
  .then((exitCode) => {
    process.exit(exitCode)
  })
  .catch((error) => {
    const { jsonOutput } = parseCliArgs(process.argv.slice(2))
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
