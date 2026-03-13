# AGENTS.md

## Repo Workflows

- Runtime requirement: Bun `>=1.3.9` (see `README.md` and `src/run.ts`).
- Eval discovery runs `**/*.eval.ts` from the current working directory (`src/run.ts`).
- The runner loads `.env` and `.env.local` before starting Bun tests (`src/runner.ts`).
- Local Bun self-imports must resolve to the `src` entrypoints so eval suites and `src/preload.ts` share the same collector singleton.
- Interactive selection mode is available via `bun run eval:select`, `goodit-evals select`, and `goodit-evals interactive` (alias).
- `bun run eval:select` requires a TTY (interactive terminal) because it renders the Ink selector.
- If you touch `package.json` exports, `src/preload.ts`, `src/run.ts`, `src/runner.ts`, or reporting code, verify human-readable eval output with `bun run eval -- --test-name-pattern "Country Capitals"` against `examples/capitals.eval.ts`.

## Commands

- `bun run eval`
  - Runs `bun src/run.ts` and executes discovered eval suites.
- `bun run eval:select`
  - Opens the interactive selector, then runs only the chosen eval files.
- `bun run eval -- --test-name-pattern "<suite>"`
  - Filters eval tests by Bun test name pattern (pass-through args in `src/run.ts`).
- `bun run eval -- --verbose`
  - Enables verbose scorer diagnostics (`--verbose` / `--eval-verbose`).
- `bun run eval -- --json`
  - Emits machine-readable JSON report (`--json` / `--eval-json`).
- `bun run eval:update`
  - Updates baselines (`UPDATE_BASELINE=1 bun src/run.ts`).
- `bun run test`
  - Runs framework and release tests (`bun test src/*.test.ts scripts/*.test.ts`).
- `bun run typecheck`
  - Runs TypeScript checks (`tsc --noEmit`).
- `bun run clean`
  - Removes build/cache artifacts (`dist`, `.turbo`, `*.tsbuildinfo`).
- `bun run release -- --dry-run`
  - Previews the next release without changing files.
- `bun run release:dry-run`
  - Equivalent dry-run entrypoint for the release workflow.
- `bun run release -- --skip-tweet`
  - Prepares, validates, commits, tags, and pushes a release without posting to X/Twitter.

## CLI Entrypoint

- `goodit-evals` maps to `bin/goodit-evals`, which shells into `bun src/run.ts`.
- `goodit-evals interactive` is an alias for `goodit-evals select`.

## TODO

- `README.md` references `bun run lint`, but `package.json` currently has no `lint` script.
