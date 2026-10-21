import { describe, expect, test } from "bun:test"
import { parseReleaseArgs } from "./release-args"

describe("parseReleaseArgs", () => {
  test("parses release flags", () => {
    expect(
      parseReleaseArgs([
        "--dry-run",
        "--skip-push",
        "--bump",
        "patch",
        "--from-ref",
        "v0.7.0",
      ]),
    ).toEqual({
      dryRun: true,
      skipPush: true,
      bump: "patch",
      fromRef: "v0.7.0",
    })
  })

  test("defaults to preparing and pushing a release", () => {
    expect(parseReleaseArgs([])).toEqual({ dryRun: false, skipPush: false })
  })

  test.each(["--nope", "--tweet", "--skip-tweet"])("rejects %s", (flag) => {
    expect(() => parseReleaseArgs([flag])).toThrow(`Unknown argument: ${flag}`)
  })
})
