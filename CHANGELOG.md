# Changelog

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

All notable changes to this package are documented in this file.

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
