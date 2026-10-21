# AGENTS.md

<!-- devkit:agents v1 -->
<!-- managed by devkit v1: edit in https://github.com/neoromantic/devkit/blob/main/agents/AGENTS.shared.md -->
## Shared rules (devkit)

These rules apply to people and coding agents in every repo that uses
[devkit](https://github.com/neoromantic/devkit). Project rules follow in `## Project` below.
Where they conflict, the project section wins.

### Data

- Use only made-up data in tests, fixtures, examples, docs and screenshots. No real people, chats,
  phone numbers, tokens, session files or local paths such as home directories.
- Never commit `.env` files or credentials. Tests run offline by default; live API tests are
  opt-in and read their credentials from the environment.

### Commands

Every repo exposes the same script names, so CI and agents need no per-repo knowledge:

| Script | What it does |
|---|---|
| `check` | lint and typecheck (or `lint` and `typecheck` separately) |
| `test` | offline unit tests |
| `test:e2e` | end-to-end tests, still offline |
| `build` | produce the shipped artifact, if any |

- Bun repos: `bun run <script>`. Python repos: `uv run …` (never bare `pip` or `python`).
  Go repos: `go` tooling from `go.mod`.
- Use Bun, uv or Go modules for installs. Use npm only for `npm publish` and `npm view`.

### Definition of done

- The change works end to end, tests cover it, and `check` and `test` pass locally.
- README and docs change in the same commit as the behaviour they describe.
- No new warnings, no commented-out code, no stray debug output.

### Commits and releases

- Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `ci:`.
  A breaking change adds `!` (`feat!:`) and a `BREAKING CHANGE:` footer.
- One logical change per commit. Never rewrite published history or force-push `main`.
- Releases happen only through the repo's Release PR or release workflow. Don't bump versions,
  edit `CHANGELOG.md` or push tags by hand.

### Files

- Don't add planning or progress files (`progress.md`, `docs/plans/`). Plans live in issues.
  `ROADMAP.md`, if present, is a short "Known gaps" list that links issues.
- Don't add agent hooks that rewrite tracked files.
- `AGENTS.md` is the canonical instruction file. `CLAUDE.md` contains only `@AGENTS.md`.
- Files marked "managed by devkit" (this block, `SECURITY.md`, `CONTRIBUTING.md`, the PR
  template, `.gitleaks.toml`, `.github/zizmor.yml`, `renovate.json`, `lefthook.yml` and the
  CI stub) are synced from devkit. Change them there, not here.
<!-- /devkit:agents -->

evals is in maintenance mode: bug fixes and dependency updates only, no new features, no promotion. Don't change the default `Facts()` judge model.

## Repo Workflows

- Runtime requirement: Bun `>=1.3.9` (see `README.md` and `src/run.ts`).
- Eval discovery runs `**/*.eval.ts` from the current working directory (`src/run.ts`).
- The runner loads `.env` and `.env.local` before starting Bun tests, with `.env.local` overriding `.env` (`src/runner.ts`).
- Local Bun self-imports must resolve to the `src` entrypoints so eval suites and `src/preload.ts` share the same collector singleton.
- Interactive selection mode is available via `bun run eval:select`, `goodit-evals select`, and `goodit-evals interactive` (alias).
- `bun run eval:select` requires a TTY (interactive terminal) because it renders the Ink selector.
- When saved baselines exist, the interactive selector shows per-file wall/work/token estimates and a focused suite breakdown (`src/selector.ts`).
- `--filter` / `--eval-filter` narrows discovered eval files by case-insensitive substring before running or opening the interactive selector (`src/cli.ts`).
- Eval-only flags accept `--flag=value` assignment syntax, e.g. `--filter=text`, `--verbose=true`, and `--json=no` (`src/cli.ts`, `src/cli.test.ts`).
- `bun run eval:select` still passes remaining args through to `bun test`, so interactive selection can be combined with flags like `--test-name-pattern` (`src/run.ts`, `src/cli.ts`).
- `bun run release` also accepts `--skip-push`, `--bump <patch|minor|major>`, and `--from-ref <ref>` for local-only release prep, manual bump override, and explicit release anchors (`scripts/release-args.ts`).
- If you touch `package.json` exports, `src/preload.ts`, `src/run.ts`, `src/runner.ts`, or reporting code, verify human-readable eval output with `bun run eval -- --test-name-pattern "Country Capitals"` against `examples/capitals.eval.ts`.

## Commands

- `bun run eval`
  - Runs `bun src/run.ts` and executes discovered eval suites.
- `bun run eval:select`
  - Opens the interactive selector, then runs only the chosen eval files.
- `bun run eval:select -- --test-name-pattern "<suite>"`
  - Opens the interactive selector, then runs the chosen eval files with Bun test name filtering.
- `bun run eval -- --test-name-pattern "<suite>"`
  - Filters eval tests by Bun test name pattern (pass-through args in `src/run.ts`).
- `bun run eval -- --filter "<text>"`
  - Narrows discovered eval files by case-insensitive substring before running them (`--eval-filter` also works).
- `bun run eval -- --verbose`
  - Enables verbose scorer diagnostics (`--verbose` / `--eval-verbose`).
- `bun run eval -- --json`
  - Emits machine-readable JSON report (`--json` / `--eval-json`).
- `bun run eval:update`
  - Updates baselines (`UPDATE_BASELINE=1 bun src/run.ts`).
- `bun run eval:update -- --test-name-pattern "<suite>"`
  - Updates baselines only for matching eval tests.
- `bun run test`
  - Runs framework and release tests (`bun test src/*.test.ts scripts/*.test.ts`).
- `bun run typecheck`
  - Runs TypeScript checks (`tsc --noEmit`).
- `bun run build`
  - Builds `dist` and rewrites emitted local import specifiers.
- `bun run clean`
  - Removes build/cache artifacts (`dist`, `.turbo`, `*.tsbuildinfo`).
- `bun run release -- --dry-run`
  - Previews the next release without changing files.
- `bun run release:dry-run`
  - Equivalent dry-run entrypoint for the release workflow.
- `bun run release`
  - Prepares changelog/docs, validates, commits, tags, and pushes a release from a clean `main` checkout.
- `bun run release -- --skip-push`
  - Prepares changelog/docs, validates, commits, and tags a release without pushing `main` or the tag.

## CLI Entrypoint

- `goodit-evals` maps to `bin/goodit-evals`, which shells into `bun src/run.ts`.
- `goodit-evals run` is an explicit alias for the default eval run flow.
- `goodit-evals select` opens the interactive selector flow from the published CLI.
- `goodit-evals interactive` is an alias for `goodit-evals select`.
