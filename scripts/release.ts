import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  bumpVersion,
  inferVersionBump,
  mergeChangelog,
  parseReleaseHeading,
  type CommitEntry,
  type VersionBump,
} from "./release-lib"

type LlmProvider = "codex" | "claude" | "command"

interface ReleaseDraft {
  releaseSummary: string
  highlights: string[]
  changelogSection: string
  readmeAction: "unchanged" | "replace"
  readmeContent: string
  readmeSummary: string
  tweetText: string
}

interface ReleaseAnchor {
  ref: string
  version: string | null
  source: "tag" | "commit" | "root"
}

interface Options {
  dryRun: boolean
  skipPush: boolean
  bump?: VersionBump
  fromRef?: string
}

const cwd = process.cwd()
const packageJsonPath = join(cwd, "package.json")
const readmePath = join(cwd, "README.md")
const changelogPath = join(cwd, "CHANGELOG.md")

async function main() {
  const options = parseArgs(Bun.argv.slice(2))
  ensureGitRepository()
  fetchTags()

  const packageJson = readJsonFile(packageJsonPath) as Record<string, unknown>
  const currentVersion = String(packageJson.version ?? "")

  if (!currentVersion) {
    throw new Error("package.json is missing a version")
  }

  const branch = git(["symbolic-ref", "--quiet", "--short", "HEAD"])

  if (!options.dryRun && branch !== "main") {
    throw new Error(`Release must run from main. Current branch: ${branch}`)
  }

  if (!options.dryRun) {
    ensureCleanWorktree()
  }

  const anchor = findReleaseAnchor(options.fromRef)
  const commits = getCommitsSince(anchor.ref)

  if (commits.length === 0) {
    throw new Error(`No commits to release since ${anchor.ref}`)
  }

  const bump = options.bump ?? inferVersionBump(commits)
  const nextVersion = bumpVersion(currentVersion, bump)
  const releaseDate = new Date().toISOString().slice(0, 10)
  const tagName = `v${nextVersion}`

  if (gitSuccess(["rev-parse", "--verify", "--quiet", tagName])) {
    throw new Error(`Tag ${tagName} already exists`)
  }

  const readme = readFileSync(readmePath, "utf8")
  const changelog = readFileSync(changelogPath, "utf8")
  const changedFiles = git(["diff", "--name-only", `${anchor.ref}..HEAD`])
  const commitLog = formatCommitLog(commits)

  const draft = await generateReleaseDraft({
    currentVersion,
    nextVersion,
    releaseDate,
    bump,
    anchor,
    commitLog,
    changedFiles,
    readme,
    changelog,
  })

  const heading = parseReleaseHeading(draft.changelogSection)

  if (heading.version !== nextVersion) {
    throw new Error(
      `LLM returned changelog for version ${heading.version}, expected ${nextVersion}`,
    )
  }

  if (heading.date !== releaseDate) {
    throw new Error(
      `LLM returned changelog date ${heading.date}, expected ${releaseDate}`,
    )
  }

  printPlan({
    anchor,
    bump,
    currentVersion,
    nextVersion,
    draft,
    tagName,
    dryRun: options.dryRun,
  })

  if (options.dryRun) {
    return
  }

  packageJson.version = nextVersion
  writeJsonFile(packageJsonPath, packageJson)
  writeFileSync(changelogPath, mergeChangelog(changelog, draft.changelogSection))

  if (draft.readmeAction === "replace" && draft.readmeContent.trim()) {
    writeFileSync(readmePath, ensureTrailingNewline(draft.readmeContent))
  }

  run("bun", ["run", "typecheck"])
  run("bun", ["run", "test"])
  run("bun", ["run", "build"])
  run("npm", ["pack", "--dry-run"])

  git(["add", "package.json", "README.md", "CHANGELOG.md"])
  git(["commit", "-m", `release: ${tagName}`])
  git(["tag", tagName])

  if (!options.skipPush) {
    git(["push", "origin", "main"])
    git(["push", "origin", tagName])
    maybePostTweet(draft.tweetText)
  }

  console.log(`Release prepared: ${tagName}`)
}

function parseArgs(argv: string[]): Options {
  const options: Options = { dryRun: false, skipPush: false }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    switch (arg) {
      case "--dry-run":
        options.dryRun = true
        break
      case "--skip-push":
        options.skipPush = true
        break
      case "--bump":
        index += 1
        options.bump = parseBump(argv[index])
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

function parseBump(value: string | undefined): VersionBump {
  if (value === "patch" || value === "minor" || value === "major") {
    return value
  }

  throw new Error(`Invalid --bump value: ${value ?? "<missing>"}`)
}

function ensureGitRepository() {
  if (!gitSuccess(["rev-parse", "--git-dir"])) {
    throw new Error("Release must run inside a git repository")
  }
}

function ensureCleanWorktree() {
  const status = git(["status", "--short"])

  if (status.trim()) {
    throw new Error("Release requires a clean worktree")
  }
}

function fetchTags() {
  if (!gitSuccess(["remote", "get-url", "origin"])) {
    return
  }

  const proc = spawnSync("git", ["fetch", "--tags", "origin"], {
    cwd,
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
  })

  if (proc.status !== 0) {
    console.warn("Warning: could not refresh tags from origin; continuing with local refs.")
  }
}

function findReleaseAnchor(fromRef?: string): ReleaseAnchor {
  if (fromRef) {
    return { ref: fromRef, version: null, source: "commit" }
  }

  const latestTag = gitOptional(["describe", "--tags", "--abbrev=0", "--match", "v*"])

  if (latestTag) {
    return { ref: latestTag, version: latestTag.replace(/^v/, ""), source: "tag" }
  }

  const log = gitOptional(["log", "--format=%H%x00%s", "-n", "200"])

  if (log) {
    const entries = log
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)

    for (const entry of entries) {
      const [hash, subject] = entry.split("\0")

      if (!hash || !subject) {
        continue
      }

      const match = subject.match(/\bv([0-9]+\.[0-9]+\.[0-9]+)\b/)

      if (match) {
        return { ref: hash, version: match[1], source: "commit" }
      }
    }
  }

  return { ref: git(["rev-list", "--max-parents=0", "HEAD"]).split("\n")[0], version: null, source: "root" }
}

function getCommitsSince(ref: string): CommitEntry[] {
  const raw = gitOptional([
    "log",
    `${ref}..HEAD`,
    "--format=%H%x00%s%x00%b%x00---END---",
  ])

  if (!raw) {
    return []
  }

  return raw
    .split("---END---")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [hash = "", subject = "", body = ""] = chunk.split("\0")
      return {
        hash: hash.trim(),
        subject: subject.trim(),
        body: body.trim(),
      }
    })
    .filter((entry) => entry.hash && entry.subject)
}

function formatCommitLog(commits: CommitEntry[]): string {
  return commits
    .map((commit) => {
      const body = commit.body ? `\n${indent(commit.body, "  ")}` : ""
      return `- ${commit.subject} (${commit.hash.slice(0, 7)})${body}`
    })
    .join("\n")
}

function indent(value: string, prefix: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => `${prefix}${line}`)
    .join("\n")
}

async function generateReleaseDraft(input: {
  currentVersion: string
  nextVersion: string
  releaseDate: string
  bump: VersionBump
  anchor: ReleaseAnchor
  commitLog: string
  changedFiles: string
  readme: string
  changelog: string
}): Promise<ReleaseDraft> {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: [
      "releaseSummary",
      "highlights",
      "changelogSection",
      "readmeAction",
      "readmeContent",
      "readmeSummary",
      "tweetText",
    ],
    properties: {
      releaseSummary: { type: "string" },
      highlights: {
        type: "array",
        items: { type: "string" },
        maxItems: 6,
      },
      changelogSection: { type: "string" },
      readmeAction: {
        type: "string",
        enum: ["unchanged", "replace"],
      },
      readmeContent: { type: "string" },
      readmeSummary: { type: "string" },
      tweetText: { type: "string" },
    },
  }

  const prompt = buildReleasePrompt(input)
  const provider = getLlmProvider()

  switch (provider) {
    case "codex":
      return await runCodex(prompt, schema)
    case "claude":
      return await runClaude(prompt, schema)
    case "command":
      return await runCustomCommand(prompt)
  }
}

function buildReleasePrompt(input: {
  currentVersion: string
  nextVersion: string
  releaseDate: string
  bump: VersionBump
  anchor: ReleaseAnchor
  commitLog: string
  changedFiles: string
  readme: string
  changelog: string
}): string {
  return [
    "You are preparing a release draft for the npm package @goodit/evals.",
    "Return valid JSON only. Do not wrap the response in Markdown fences.",
    "",
    "Goals:",
    "1. Write a high-quality changelog section from git history commit messages.",
    "2. Update README content only if the release materially changes user-facing behavior or if the current README contains stale repo-layout references that should be corrected.",
    "3. Draft a short release tweet for X/Twitter.",
    "3. Preserve correct documentation; do not invent APIs or commands.",
    "",
    "Output rules:",
    `- changelogSection must start with exactly: ## ${input.nextVersion} - ${input.releaseDate}`,
    "- Use concise, concrete release notes with short paragraphs and bullets only when useful.",
    "- If README should not change, set readmeAction to unchanged and readmeContent to an empty string.",
    "- If README should change, return the full rewritten README in readmeContent.",
    "- Keep the README structure familiar unless a section is clearly stale.",
    `- tweetText must be <= 280 characters, mention version ${input.nextVersion}, summarize the main changes, and include this exact npm link: https://www.npmjs.com/package/@goodit/evals`,
    "- tweetText should read like a natural release announcement, not a changelog bullet list.",
    "",
    "Release context:",
    `- Current version: ${input.currentVersion}`,
    `- Next version: ${input.nextVersion}`,
    `- Suggested semver bump from commit analysis: ${input.bump}`,
    `- Baseline ref: ${input.anchor.ref} (${input.anchor.source}${input.anchor.version ? `, version ${input.anchor.version}` : ""})`,
    "",
    "Commits since the baseline ref:",
    input.commitLog,
    "",
    "Changed files since the baseline ref:",
    input.changedFiles || "(none)",
    "",
    "Current CHANGELOG.md:",
    input.changelog,
    "",
    "Current README.md:",
    input.readme,
  ].join("\n")
}

function getLlmProvider(): LlmProvider {
  const value = process.env.GOODIT_RELEASE_LLM_PROVIDER?.trim() ?? "codex"

  if (value === "codex" || value === "claude" || value === "command") {
    return value
  }

  throw new Error(
    `Unsupported GOODIT_RELEASE_LLM_PROVIDER: ${value}. Use codex, claude, or command.`,
  )
}

async function runCodex(prompt: string, schema: object): Promise<ReleaseDraft> {
  const tempDir = mkdtempSync(join(tmpdir(), "goodit-release-codex-"))
  const schemaPath = join(tempDir, "schema.json")
  const outputPath = join(tempDir, "output.json")

  try {
    writeFileSync(schemaPath, JSON.stringify(schema, null, 2))

    const command = [
      "codex",
      "exec",
      "-",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--cd",
      cwd,
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outputPath,
      "--color",
      "never",
    ]

    const model = process.env.GOODIT_RELEASE_LLM_MODEL?.trim()

    if (model) {
      command.push("--model", model)
    }

    const proc = spawnSync(command[0]!, command.slice(1), {
      cwd,
      input: prompt,
      stdio: ["pipe", "inherit", "inherit"],
      encoding: "utf8",
    })

    if (proc.status !== 0) {
      throw new Error(`Codex exited with code ${proc.status}`)
    }

    return parseDraft(readFileSync(outputPath, "utf8"))
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

async function runClaude(prompt: string, schema: object): Promise<ReleaseDraft> {
  const command = [
    "claude",
    "-p",
    "--output-format",
    "text",
    "--permission-mode",
    "dontAsk",
    "--tools",
    "",
    "--json-schema",
    JSON.stringify(schema),
  ]

  const model = process.env.GOODIT_RELEASE_LLM_MODEL?.trim()

  if (model) {
    command.push("--model", model)
  }

  const proc = spawnSync(command[0]!, command.slice(1), {
    cwd,
    input: prompt,
    stdio: ["pipe", "pipe", "inherit"],
    encoding: "utf8",
  })

  if (proc.status !== 0) {
    throw new Error(`Claude exited with code ${proc.status}`)
  }

  return parseDraft(proc.stdout ?? "")
}

async function runCustomCommand(prompt: string): Promise<ReleaseDraft> {
  const llmCommand = process.env.GOODIT_RELEASE_LLM_COMMAND?.trim()

  if (!llmCommand) {
    throw new Error(
      "GOODIT_RELEASE_LLM_COMMAND is required when GOODIT_RELEASE_LLM_PROVIDER=command",
    )
  }

  const proc = spawnSync("sh", ["-lc", llmCommand], {
    cwd,
    input: prompt,
    stdio: ["pipe", "pipe", "inherit"],
    encoding: "utf8",
  })

  if (proc.status !== 0) {
    throw new Error(`Custom LLM command exited with code ${proc.status}`)
  }

  return parseDraft(proc.stdout ?? "")
}

function parseDraft(raw: string): ReleaseDraft {
  const trimmed = raw.trim()
  const direct = tryParseJson(trimmed)

  if (direct) {
    return validateDraft(direct)
  }

  const wrapper = tryParseJson(trimmed.replace(/^[^{]*/, ""))

  if (wrapper) {
    if (typeof wrapper.result === "string") {
      const nested = tryParseJson(wrapper.result.trim())

      if (nested) {
        return validateDraft(nested)
      }
    }

    return validateDraft(wrapper)
  }

  throw new Error(`Could not parse LLM output as JSON:\n${trimmed}`)
}

function tryParseJson(value: string): any {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function validateDraft(value: any): ReleaseDraft {
  if (
    !value ||
    typeof value.releaseSummary !== "string" ||
    !Array.isArray(value.highlights) ||
    typeof value.changelogSection !== "string" ||
    (value.readmeAction !== "unchanged" && value.readmeAction !== "replace") ||
    typeof value.readmeContent !== "string" ||
    typeof value.readmeSummary !== "string" ||
    typeof value.tweetText !== "string"
  ) {
    throw new Error(`Invalid release draft payload: ${JSON.stringify(value, null, 2)}`)
  }

  const tweetText = value.tweetText.trim()

  if (!tweetText) {
    throw new Error("Release draft tweetText cannot be empty")
  }

  if (tweetText.length > 280) {
    throw new Error(`Release draft tweetText exceeds 280 characters (${tweetText.length})`)
  }

  return {
    releaseSummary: value.releaseSummary,
    highlights: value.highlights.map((item: unknown) => String(item)),
    changelogSection: ensureTrailingNewline(value.changelogSection.trim()),
    readmeAction: value.readmeAction,
    readmeContent: value.readmeContent,
    readmeSummary: value.readmeSummary,
    tweetText,
  }
}

function printPlan(input: {
  anchor: ReleaseAnchor
  bump: VersionBump
  currentVersion: string
  nextVersion: string
  tagName: string
  dryRun: boolean
  draft: ReleaseDraft
}) {
  console.log(`${input.dryRun ? "Dry run" : "Preparing release"} ${input.tagName}`)
  console.log(`Current version: ${input.currentVersion}`)
  console.log(`Bump: ${input.bump}`)
  console.log(
    `Baseline: ${input.anchor.ref} (${input.anchor.source}${input.anchor.version ? `, version ${input.anchor.version}` : ""})`,
  )
  console.log("")
  console.log(input.draft.releaseSummary)

  if (input.draft.highlights.length > 0) {
    console.log("")

    for (const item of input.draft.highlights) {
      console.log(`- ${item}`)
    }
  }

  console.log("")
  console.log("README action:", input.draft.readmeAction, `(${input.draft.readmeSummary})`)
  console.log("")
  console.log(input.draft.changelogSection.trim())
  console.log("")
  console.log("Tweet preview:")
  console.log(input.draft.tweetText)
}

function git(args: string[]): string {
  return run("git", args)
}

function gitOptional(args: string[]): string {
  const proc = spawnSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  })

  if (proc.status !== 0) {
    return ""
  }

  return (proc.stdout ?? "").trim()
}

function gitSuccess(args: string[]): boolean {
  const proc = spawnSync("git", args, {
    cwd,
    stdio: ["ignore", "ignore", "ignore"],
  })
  return proc.status === 0
}

function run(bin: string, args: string[]): string {
  const proc = spawnSync(bin, args, {
    cwd,
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
  })

  if (proc.status !== 0) {
    throw new Error(`Command failed: ${bin} ${args.join(" ")}`)
  }

  return (proc.stdout ?? "").trim()
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"))
}

function writeJsonFile(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`
}

function maybePostTweet(text: string) {
  try {
    const status = spawnSync("twitter", ["status"], {
      cwd,
      stdio: ["ignore", "ignore", "ignore"],
    })

    if (status.status !== 0 || status.error) {
      return
    }

    spawnSync("twitter", ["post", text], {
      cwd,
      stdio: ["ignore", "ignore", "ignore"],
    })
  } catch {
    return
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
