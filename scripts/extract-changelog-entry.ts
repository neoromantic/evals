import { extractChangelogSection } from "./release-lib"

const version = Bun.argv[2]

if (!version) {
  console.error("Usage: bun scripts/extract-changelog-entry.ts <version>")
  process.exit(1)
}

const normalizedVersion = version.replace(/^v/, "")
const changelog = await Bun.file("CHANGELOG.md").text()
const section = extractChangelogSection(changelog, normalizedVersion)

if (!section) {
  console.error(`No changelog section found for version ${normalizedVersion}`)
  process.exit(1)
}

console.log(section)
