import { parseCliArgs, runCli } from "./cli"

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const { jsonOutput } = parseCliArgs(args)

  try {
    process.exit(await runCli(args))
  } catch (error) {
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
    } else {
      console.error("Eval runner failed:", error)
    }

    process.exit(1)
  }
}

void main()
