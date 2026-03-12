import type { VersionBump } from "./release-lib"

export interface ReleaseOptions {
  dryRun: boolean
  skipPush: boolean
  skipTweet: boolean
  bump?: VersionBump
  fromRef?: string
}

export function parseReleaseArgs(argv: string[]): ReleaseOptions {
  const options: ReleaseOptions = {
    dryRun: false,
    skipPush: false,
    skipTweet: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    switch (arg) {
      case "--dry-run":
        options.dryRun = true
        break
      case "--skip-push":
        options.skipPush = true
        break
      case "--skip-tweet":
        options.skipTweet = true
        break
      case "--bump":
        index += 1
        options.bump = parseReleaseBump(argv[index])
        break
      case "--from-ref":
        index += 1
        options.fromRef = argv[index]
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function parseReleaseBump(value: string | undefined): VersionBump {
  if (value === "patch" || value === "minor" || value === "major") {
    return value
  }

  throw new Error(`Invalid --bump value: ${value ?? "<missing>"}`)
}
