# Changelog

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
