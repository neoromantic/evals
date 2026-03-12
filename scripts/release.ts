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
  readmeSummary: string
  readmeContent: string
  tweetText: string
}

interface ReleasePlanDraft {
  releaseSummary: string
  highlights: string[]
  changelogSection: string
  readmeAction: "unchanged" | "replace"
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
}): Promise<ReleaseDraft> {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: [
      "releaseSummary",
      "highlights",
      "changelogSection",
      "readmeAction",
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
      readmeSummary: { type: "string" },
      tweetText: { type: "string" },
    },
  }

  const prompt = buildReleasePrompt(input)
  const provider = getLlmProvider()
  let planDraft: ReleasePlanDraft

  switch (provider) {
    case "codex":
      planDraft = await runCodex(prompt, schema)
      break
    case "claude":
      planDraft = await runClaude(prompt, schema)
      break
    case "command":
      planDraft = await runCustomCommand(prompt)
      break
  }

  if (planDraft.readmeAction === "replace") {
    const readmeContent = await generateReadmeRewrite({
      currentReadme: input.readme,
      currentVersion: input.currentVersion,
      nextVersion: input.nextVersion,
      releaseDate: input.releaseDate,
      commitLog: input.commitLog,
      changedFiles: input.changedFiles,
      releaseSummary: planDraft.releaseSummary,
      highlights: planDraft.highlights,
    })

    return {
      ...planDraft,
      readmeContent,
    }
  }

  return {
    ...planDraft,
    readmeContent: "",
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
}): string {
  return [
    "You are preparing a release draft for the npm package @goodit/evals.",
    "Use only the commit log, changed-file list, and release metadata provided here.",
    "Do not inspect the repository or infer details from source diffs.",
    "Return valid JSON only. Do not wrap the response in Markdown fences.",
    "",
    "Goals:",
    "1. Write a high-quality changelog section from git history commit messages.",
    "2. Decide whether README.md needs a follow-up rewrite pass.",
    "3. Draft a short release tweet for X/Twitter.",
    "4. Preserve correct documentation; do not invent APIs or commands.",
    "",
    "Output rules:",
    `- changelogSection must start with exactly: ## ${input.nextVersion} - ${input.releaseDate}`,
    "- Use concise, concrete release notes with short paragraphs and bullets only when useful.",
    "- If README should not change, set readmeAction to unchanged.",
    "- If README likely needs a rewrite, set readmeAction to replace and explain why in readmeSummary.",
    "- Prefer readmeAction=unchanged when README.md is already in the changed-file list for this release unless the commit log clearly describes an additional undocumented user-facing change.",
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
  ].join("\n")
}

async function generateReadmeRewrite(input: {
  currentReadme: string
  currentVersion: string
  nextVersion: string
  releaseDate: string
  commitLog: string
  changedFiles: string
  releaseSummary: string
  highlights: string[]
}): Promise<string> {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["readmeContent"],
    properties: {
      readmeContent: { type: "string" },
    },
  }

  const prompt = [
    "Rewrite README.md for the next release of @goodit/evals.",
    "Use only the provided README content, commit log, changed-file list, and release summary.",
    "Preserve correct sections and examples. Make the smallest necessary update.",
    "Return valid JSON only.",
    "",
    "Release context:",
    `- Current version: ${input.currentVersion}`,
    `- Next version: ${input.nextVersion}`,
    `- Release date: ${input.releaseDate}`,
    `- Summary: ${input.releaseSummary}`,
    `- Highlights: ${input.highlights.join(" | ") || "(none)"}`,
    "",
    "Changed files since the baseline ref:",
    input.changedFiles || "(none)",
    "",
    "Commits since the baseline ref:",
    input.commitLog,
    "",
    "Current README.md:",
    input.currentReadme,
  ].join("\n")

  const provider = getLlmProvider()

  switch (provider) {
    case "codex":
      return validateReadmeRewrite(await runCodex(prompt, schema))
    case "claude":
      return validateReadmeRewrite(await runClaude(prompt, schema))
    case "command":
      return validateReadmeRewrite(await runCustomCommand(prompt))
  }
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

async function runCodex(prompt: string, schema: object): Promise<any> {
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
      tempDir,
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
      cwd: tempDir,
      input: prompt,
      stdio: ["pipe", "inherit", "inherit"],
      encoding: "utf8",
      timeout: getLlmTimeoutMs(),
    })

    if (proc.error?.name === "TimeoutError" || proc.signal) {
      throw new Error(`Codex release draft timed out or was terminated (${proc.signal ?? "timeout"})`)
    }

    if (proc.status !== 0) {
      throw new Error(`Codex exited with code ${proc.status}`)
    }

    return validateReleasePlan(parseJsonPayload(readFileSync(outputPath, "utf8")))
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

async function runClaude(prompt: string, schema: object): Promise<any> {
  const tempDir = mkdtempSync(join(tmpdir(), "goodit-release-claude-"))
  const command = [
    "claude",
    "-p",
    "--output-format",
    "json",
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

  try {
    const proc = spawnSync(command[0]!, command.slice(1), {
      cwd: tempDir,
      input: prompt,
      stdio: ["pipe", "pipe", "inherit"],
      encoding: "utf8",
      timeout: getLlmTimeoutMs(),
    })

    if (proc.error?.name === "TimeoutError" || proc.signal) {
      throw new Error(`Claude release draft timed out or was terminated (${proc.signal ?? "timeout"})`)
    }

    if (proc.status !== 0) {
      throw new Error(`Claude exited with code ${proc.status}`)
    }

    return parseClaudeJsonPayload(proc.stdout ?? "")
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

async function runCustomCommand(prompt: string): Promise<any> {
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
    timeout: getLlmTimeoutMs(),
  })

  if (proc.error?.name === "TimeoutError" || proc.signal) {
    throw new Error(`Custom LLM command timed out or was terminated (${proc.signal ?? "timeout"})`)
  }

  if (proc.status !== 0) {
    throw new Error(`Custom LLM command exited with code ${proc.status}`)
  }

  return parseJsonPayload(proc.stdout ?? "")
}

function parseJsonPayload(raw: string): any {
  const trimmed = raw.trim()
  const direct = tryParseJson(trimmed)

  if (direct) {
    return direct
  }

  const wrapper = tryParseJson(trimmed.replace(/^[^{]*/, ""))

  if (wrapper) {
    if (typeof wrapper.result === "string") {
      const nested = tryParseJson(wrapper.result.trim())

      if (nested) {
        return nested
      }
    }

    return wrapper
  }

  throw new Error(`Could not parse LLM output as JSON:\n${trimmed}`)
}

function parseClaudeJsonPayload(raw: string): any {
  const payload = parseJsonPayload(raw)

  if (payload && typeof payload === "object") {
    if (payload.structured_output && typeof payload.structured_output === "object") {
      return payload.structured_output
    }

    if (typeof payload.result === "string" && payload.result.trim()) {
      return parseJsonPayload(payload.result)
    }
  }

  return payload
}

function tryParseJson(value: string): any {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function validateReleasePlan(value: any): ReleasePlanDraft {
  if (
    !value ||
    typeof value.releaseSummary !== "string" ||
    !Array.isArray(value.highlights) ||
    typeof value.changelogSection !== "string" ||
    (value.readmeAction !== "unchanged" && value.readmeAction !== "replace") ||
    typeof value.readmeSummary !== "string" ||
    typeof value.tweetText !== "string"
  ) {
    throw new Error(`Invalid release draft payload: ${JSON.stringify(value, null, 2)}`)
  }

  const tweetText = value.tweetText.trim()
  const npmLink = "https://www.npmjs.com/package/@goodit/evals"

  if (!tweetText) {
    throw new Error("Release draft tweetText cannot be empty")
  }

  if (tweetText.length > 280) {
    throw new Error(`Release draft tweetText exceeds 280 characters (${tweetText.length})`)
  }

  if (!tweetText.includes(npmLink)) {
    throw new Error(`Release draft tweetText must include ${npmLink}`)
  }

  return {
    releaseSummary: value.releaseSummary,
    highlights: value.highlights.map((item: unknown) => String(item)),
    changelogSection: ensureTrailingNewline(value.changelogSection.trim()),
    readmeAction: value.readmeAction,
    readmeSummary: value.readmeSummary,
    tweetText,
  }
}

function validateReadmeRewrite(value: any): string {
  if (!value || typeof value.readmeContent !== "string" || !value.readmeContent.trim()) {
    throw new Error(`Invalid README rewrite payload: ${JSON.stringify(value, null, 2)}`)
  }

  return ensureTrailingNewline(value.readmeContent.trim())
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

function getLlmTimeoutMs(): number {
  const raw = process.env.GOODIT_RELEASE_LLM_TIMEOUT_MS?.trim()
  const parsed = raw ? Number(raw) : NaN

  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed
  }

  return 60000
}

function maybePostTweet(text: string) {
  try {
    const status = spawnSync("twitter", ["status", "--json"], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 15000,
    })

    if (status.error?.code === "ENOENT") {
      console.warn("Warning: twitter CLI not found; skipping release tweet.")
      return
    }

    if (status.error?.name === "TimeoutError" || status.signal) {
      console.warn(
        `Warning: twitter status check timed out or was terminated (${status.signal ?? "timeout"}); skipping release tweet.`,
      )
      return
    }

    if (status.status !== 0) {
      console.warn("Warning: twitter status check failed; skipping release tweet.")

      const details = [status.stdout, status.stderr].filter(Boolean).join("\n").trim()

      if (details) {
        console.warn(details)
      }
      return
    }

    const auth = tryParseJson(status.stdout ?? "")

    if (!auth?.ok || auth?.data?.authenticated !== true) {
      console.warn("Warning: twitter CLI is not authenticated; skipping release tweet.")
      return
    }

    const post = spawnSync("twitter", ["post", "--json", text], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 30000,
    })

    if (post.error?.code === "ENOENT") {
      console.warn("Warning: twitter CLI disappeared before posting; skipping release tweet.")
      return
    }

    if (post.error?.name === "TimeoutError" || post.signal) {
      console.warn(
        `Warning: twitter post timed out or was terminated (${post.signal ?? "timeout"}); release will continue.`,
      )
      return
    }

    if (post.status !== 0) {
      console.warn("Warning: twitter post failed; release will continue.")

      const details = [post.stdout, post.stderr].filter(Boolean).join("\n").trim()
      const parsed = tryParseJson(post.stdout ?? "")
      const errorCode = parsed?.error?.details?.code ?? parsed?.error?.code
      const errorMessage = parsed?.error?.message

      if (errorCode === 187 || /duplicate/i.test(errorMessage ?? "")) {
        console.warn("Twitter rejected the tweet as a duplicate status.")
      }

      if (details) {
        console.warn(details)
      }
      return
    }

    const result = tryParseJson(post.stdout ?? "")
    const tweetId = result?.data?.id
    const screenName =
      result?.data?.author?.screenName ??
      result?.data?.author?.username ??
      auth?.data?.user?.screenName ??
      auth?.data?.user?.username

    if (tweetId && screenName) {
      console.log(`Release tweet posted: https://x.com/${screenName}/status/${tweetId}`)
      return
    }

    console.log("Release tweet posted.")
  } catch (error) {
    console.warn("Warning: unexpected twitter post error; release will continue.")
    console.warn(error instanceof Error ? error.message : String(error))
    return
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
