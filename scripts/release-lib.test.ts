import { describe, expect, test } from "bun:test"
import {
  bumpVersion,
  extractChangelogSection,
  inferVersionBump,
  mergeChangelog,
  parseReleaseHeading,
} from "./release-lib"

describe("inferVersionBump", () => {
  test("returns patch for non-feature commits", () => {
    expect(
      inferVersionBump([
        { hash: "a", subject: "fix: tighten parser", body: "" },
        { hash: "b", subject: "docs: refresh README", body: "" },
      ]),
    ).toBe("patch")
  })

  test("returns minor when a feat commit is present", () => {
    expect(
      inferVersionBump([
        { hash: "a", subject: "fix: tighten parser", body: "" },
        { hash: "b", subject: "feat: add release workflow", body: "" },
      ]),
    ).toBe("minor")
  })

  test("returns major for breaking changes", () => {
    expect(
      inferVersionBump([
        {
          hash: "a",
          subject: "feat!: remove deprecated API",
          body: "",
        },
      ]),
    ).toBe("major")
  })
})

describe("bumpVersion", () => {
  test("bumps patch", () => {
    expect(bumpVersion("0.6.0", "patch")).toBe("0.6.1")
  })

  test("bumps minor", () => {
    expect(bumpVersion("0.6.0", "minor")).toBe("0.7.0")
  })

  test("bumps major", () => {
    expect(bumpVersion("0.6.0", "major")).toBe("1.0.0")
  })
})

describe("mergeChangelog", () => {
  test("prepends a release section below the title", () => {
    const merged = mergeChangelog(
      "# Changelog\n\n## 0.6.0 - 2026-03-10\n\nExisting release.\n",
      "## 0.7.0 - 2026-03-12\n\nNew release.\n",
    )

    expect(merged).toBe(
      "# Changelog\n\n## 0.7.0 - 2026-03-12\n\nNew release.\n\n## 0.6.0 - 2026-03-10\n\nExisting release.\n",
    )
  })
})

describe("extractChangelogSection", () => {
  test("returns a single release entry", () => {
    expect(
      extractChangelogSection(
        "# Changelog\n\n## 0.7.0 - 2026-03-12\n\nNew release.\n\n## 0.6.0 - 2026-03-10\n\nOld release.\n",
        "0.7.0",
      ),
    ).toBe("## 0.7.0 - 2026-03-12\n\nNew release.")
  })
})

describe("parseReleaseHeading", () => {
  test("extracts version and date", () => {
    expect(parseReleaseHeading("## 0.7.0 - 2026-03-12\n\nRelease body.")).toEqual({
      version: "0.7.0",
      date: "2026-03-12",
    })
  })
})
