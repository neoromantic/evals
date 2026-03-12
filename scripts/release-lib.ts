export type VersionBump = "patch" | "minor" | "major"

export interface CommitEntry {
  hash: string
  subject: string
  body: string
}

const RELEASE_HEADING_RE = /^##\s+([0-9]+\.[0-9]+\.[0-9]+)\s+-\s+([0-9]{4}-[0-9]{2}-[0-9]{2})$/m

export function inferVersionBump(commits: CommitEntry[]): VersionBump {
  let bump: VersionBump = "patch"

  for (const commit of commits) {
    const message = `${commit.subject}\n${commit.body}`.trim()

    if (/\bBREAKING CHANGE\b/i.test(message) || /^[^:\n!]+!:/m.test(commit.subject)) {
      return "major"
    }

    if (/^feat(\(.+\))?:/i.test(commit.subject)) {
      bump = "minor"
    }
  }

  return bump
}

export function bumpVersion(version: string, bump: VersionBump): string {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/)

  if (!match) {
    throw new Error(`Unsupported semver version: ${version}`)
  }

  const [, majorRaw, minorRaw, patchRaw] = match
  const major = Number(majorRaw)
  const minor = Number(minorRaw)
  const patch = Number(patchRaw)

  switch (bump) {
    case "major":
      return `${major + 1}.0.0`
    case "minor":
      return `${major}.${minor + 1}.0`
    case "patch":
      return `${major}.${minor}.${patch + 1}`
  }
}

export function mergeChangelog(existing: string, section: string): string {
  const normalizedExisting = existing.trimEnd()
  const normalizedSection = section.trim()

  if (!normalizedSection.startsWith("## ")) {
    throw new Error("Changelog section must start with a level-2 heading")
  }

  if (!normalizedExisting.startsWith("# Changelog")) {
    return `# Changelog\n\n${normalizedSection}\n`
  }

  const headerMatch = normalizedExisting.match(/^# Changelog\s*\n\n?/)
  const prefix = headerMatch?.[0] ?? "# Changelog\n\n"
  const remainder = normalizedExisting.slice(prefix.length).trimStart()

  return `${prefix}${normalizedSection}\n\n${remainder}\n`
}

export function extractChangelogSection(content: string, version: string): string | null {
  const lines = content.split(/\r?\n/)
  const heading = `## ${version} - `
  const start = lines.findIndex((line) => line.startsWith(heading))

  if (start === -1) {
    return null
  }

  let end = lines.length

  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index]?.startsWith("## ")) {
      end = index
      break
    }
  }

  return lines.slice(start, end).join("\n").trim()
}

export function parseReleaseHeading(section: string): { version: string; date: string } {
  const match = section.trim().match(RELEASE_HEADING_RE)

  if (!match) {
    throw new Error("Release section must start with `## <version> - <YYYY-MM-DD>`")
  }

  return { version: match[1], date: match[2] }
}
