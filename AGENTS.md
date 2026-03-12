# AGENTS.md

## Repo Workflows

- Runtime requirement: Bun `>=1.3.9` (see `README.md` and `src/run.ts`).
- Eval discovery runs `**/*.eval.ts` from the current working directory (`src/run.ts`).
- The runner loads `.env` and `.env.local` before starting Bun tests (`src/run.ts`).

## Commands

- `bun run eval`
  - Runs `bun src/run.ts` and executes discovered eval suites.
- `bun run eval -- --test-name-pattern "<suite>"`
  - Filters eval tests by Bun test name pattern (pass-through args in `src/run.ts`).
- `bun run eval -- --verbose`
  - Enables verbose scorer diagnostics (`--verbose` / `--eval-verbose`).
- `bun run eval -- --json`
  - Emits machine-readable JSON report (`--json` / `--eval-json`).
- `bun run eval:update`
  - Updates baselines (`UPDATE_BASELINE=1 bun src/run.ts`).
- `bun run test`
  - Runs framework tests (`bun test src/*.test.ts`).
- `bun run typecheck`
  - Runs TypeScript checks (`tsc --noEmit`).
- `bun run clean`
  - Removes build/cache artifacts (`dist`, `.turbo`, `*.tsbuildinfo`).

## CLI Entrypoint

- `goodit-evals` maps to `bin/goodit-evals`, which shells into `bun src/run.ts`.

## TODO

- `README.md` references `bun run lint`, but `package.json` currently has no `lint` script.
