# Releasing

evals is in maintenance mode: releases are patch or minor, and they are not
announced.

## Pipeline

1. `bun run release` on a clean `main` prepares the release locally: version,
   `CHANGELOG.md` section, validation, a `release: vX.Y.Z` commit and the
   `vX.Y.Z` tag. It pushes `main` and the tag unless `--skip-push` is passed.
2. The tag push runs [`.github/workflows/publish.yml`](../.github/workflows/publish.yml):
   1. checks that the tag matches `package.json`;
   2. extracts the tag's section from `CHANGELOG.md` (the run stops here if the
      section is missing, before anything is published);
   3. runs `typecheck`, `test`, `build` and `npm pack --dry-run`;
   4. publishes to npm with trusted publishing (GitHub OIDC, Node 24), unless
      that version is already on npm;
   5. creates the GitHub Release with the extracted notes, unless it exists.

Every step can be re-run: if a run fails after `npm publish`, fix the cause on
`main` and re-run the workflow for the tag, or create the release by hand with
the same notes:

```bash
bun scripts/extract-changelog-entry.ts vX.Y.Z > notes.md
gh release create vX.Y.Z --verify-tag --title vX.Y.Z --notes-file notes.md
```

## `bun run release`

```bash
# preview the next release without changing files
bun run release -- --dry-run

# prepare changelog + docs, run validation, commit, tag, and push
bun run release

# prepare, commit and tag locally; push main and the tag yourself
bun run release -- --skip-push
```

What it does:

1. Requires a clean `main` branch checkout.
2. Finds commits since the latest `v*` tag (or `--from-ref <ref>`).
3. Infers the semver bump from commit messages, unless `--bump <patch|minor|major>`
   is passed:
   - `feat:` -> minor
   - `fix:`/`docs:`/`chore:` and similar -> patch
   - `!:` or `BREAKING CHANGE` -> major
4. Uses an LLM to draft the next `CHANGELOG.md` entry and optionally refresh
   `README.md`.
5. Runs `typecheck`, `test`, `build`, and `npm pack --dry-run`.
6. Commits `package.json`, `CHANGELOG.md`, and `README.md` as
   `release: vX.Y.Z`.
7. Creates tag `vX.Y.Z` and pushes `main` plus the tag.
8. Posts a short release tweet through the `twitter` CLI only when `--tweet` is
   passed. If the CLI is missing or fails, the release still succeeds.

A release prepared by hand works the same way: bump `version` in
`package.json`, add a `## X.Y.Z - YYYY-MM-DD` section to `CHANGELOG.md`, commit,
then push an annotated `vX.Y.Z` tag.

## Configuration

- npm trusted publishing for repo `neoromantic/evals` and workflow
  `.github/workflows/publish.yml`. No `NPM_TOKEN` secret is needed.
- `GOODIT_RELEASE_LLM_PROVIDER` locally: `codex` (default), `claude`, or
  `command`.
- Optional `GOODIT_RELEASE_LLM_MODEL` to pin a non-default model, and
  `GOODIT_RELEASE_LLM_TIMEOUT_MS` to change the LLM timeout.
- `GOODIT_RELEASE_LLM_COMMAND` when `GOODIT_RELEASE_LLM_PROVIDER=command`: a
  command that reads the prompt from stdin and prints JSON.

```bash
# use Codex CLI
export GOODIT_RELEASE_LLM_PROVIDER=codex

# use Claude Code CLI
export GOODIT_RELEASE_LLM_PROVIDER=claude

# use a custom command that reads the prompt from stdin and prints JSON
export GOODIT_RELEASE_LLM_PROVIDER=command
export GOODIT_RELEASE_LLM_COMMAND='my-release-llm'
```
