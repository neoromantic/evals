import { describe, expect, test } from "bun:test"
import { parseCliArgs } from "./cli"

describe("parseCliArgs", () => {
  test("defaults to run mode and passes through bun args", () => {
    expect(parseCliArgs(["--test-name-pattern", "Country"])).toEqual({
      command: "run",
      bunArgs: ["--test-name-pattern", "Country"],
      verboseReporting: false,
      jsonOutput: false,
    })
  })

  test("extracts select command before parsing runner flags", () => {
    expect(
      parseCliArgs(["select", "--verbose", "--test-name-pattern", "A"]),
    ).toEqual({
      command: "select",
      bunArgs: ["--test-name-pattern", "A"],
      verboseReporting: true,
      jsonOutput: false,
    })
  })

  test("supports boolean assignment syntax for eval flags", () => {
    expect(parseCliArgs(["interactive", "--json=no", "--verbose=true"])).toEqual(
      {
        command: "select",
        bunArgs: [],
        verboseReporting: true,
        jsonOutput: false,
      },
    )
  })
})
