import { describe, expect, test } from "bun:test"
import { parseReleaseArgs } from "./release-args"

describe("parseReleaseArgs", () => {
  test("parses skip tweet alongside other release flags", () => {
    expect(
      parseReleaseArgs([
        "--dry-run",
        "--skip-push",
        "--skip-tweet",
        "--bump",
        "patch",
        "--from-ref",
        "v0.7.0",
      ]),
    ).toEqual({
      dryRun: true,
      skipPush: true,
      skipTweet: true,
      bump: "patch",
      fromRef: "v0.7.0",
    })
  })

  test("skips the release tweet unless --tweet is passed", () => {
    expect(parseReleaseArgs([]).skipTweet).toBe(true)
    expect(parseReleaseArgs(["--tweet"]).skipTweet).toBe(false)
  })

  test("rejects unknown flags", () => {
    expect(() => parseReleaseArgs(["--nope"])).toThrow(
      "Unknown argument: --nope",
    )
  })
})
