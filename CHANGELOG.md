# Changelog

All notable changes to this package are documented in this file.

## 0.8.1 - 2026-10-19

- Fix truncated or repeated `--json` output when piping reports larger than 64 KiB on Bun 1.4.
- Fix verbose score alignment for long scorer names with the `[judge]` badge.
- Declare `ai` and `zod` as required peer dependencies and align the `zod` range with `ai` 6.
- Validate the release tag against `package.json` and extract changelog notes before publishing. Reruns skip versions already on npm and preserve existing GitHub Releases.
- Make release tweets opt-in with `--tweet`.
- Restore the missing 0.8.0 changelog section and insert new sections below the preamble.
- Refresh the README with existing 0.8.0 features, required peer installation instructions, synthetic screenshots, and maintenance-mode guidance. Move release workflow documentation to `docs/releasing.md`.

## 0.8.0 - 2026-03-17

**Features**

- `Facts([...])` checks: put a list of facts in `expected` and leave out `scorers`. Each fact is judged by an LLM (`gpt-4o-mini` through `AI_GATEWAY_API_KEY` or `OPENAI_API_KEY`, or the `model` you pass), and the case gets one `score.checks` metric.
- `scorers` is optional in `evalSuite` when every case uses `Facts()`.
- Scorers for a case now run in parallel.
- The report has a per-test `RESULTS` section with each case's scorers.
- `--filter <text>` (or `--eval-filter`) narrows the discovered eval files by a case-insensitive substring.

**Changes**

- `@ai-sdk/openai` is now a dependency, for the default `Facts()` judge model.
- Internal refactors across the CLI, selector, baseline, estimates and reporter code.

## 0.7.1 - 2026-03-12

**Fixes**

- Restored eval metrics reporting for Bun self-imports by aligning Bun package resolution with the source preload hook.
- Added a package self-import regression test to prevent reporter regressions.
- Added `--skip-tweet` to the release workflow so releases can be pushed without posting to X/Twitter.

## 0.7.0 - 2026-03-12

**Features**

- Automated release pipeline for streamlined version management and npm publishing
- Baseline estimates support in eval selector for improved CLI evaluation
- AGENTS workflow and command guide for agent integration

**Improvements**

- Optimized CLI argument parsing to compute and reuse results across entry points
- Reporter now computes boolean score mappings once per report instead of repeatedly
- Removed unreachable dead code and unused helper functions
- Simplified reporter iteration by directly accessing comparison values
- Streamlined command-set checking in argument parsing

## 0.6.0 - 2026-03-10

Added phase-separated task and scorer metrics, plus first-class LLM judge
scorer support.

- Added `createLLMJudgeScorer`, scorer `kind`, and judge-aware reporting.
- Split task and scoring latency/token metrics to make eval cost analysis more
  precise.
- Improved reporter PASS/FAIL output and distribution summaries.
- Hardened CLI/bin packaging for npm installs.

## Historical

Earlier pre-automation releases are summarized in git history. The current
release workflow appends new entries above this section.
