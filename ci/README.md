# CI workflow — already active; this folder is a historical copy

The continuous-integration workflow for this project is **live** at
[`.github/workflows/test.yml`](../.github/workflows/test.yml). It runs
`npm test` on every push and pull request, against Node 18 and Node 22,
and fails the build if a test wrote to the production `data/runs.jsonl`.

`github-actions-test.yml` in this folder is the copy it was authored as,
from a time when `.github/workflows/` could not be written to directly.
That copy step has since been done (see `PROJECT_PROGRESS.md`, Step 117),
and the two files are byte-for-byte identical today.

**Do not edit this copy.** `.github/workflows/test.yml` is the only file
GitHub Actions reads; a change made here alone has no effect, and a
change made here *as well* just gives the project two workflow
definitions that can silently drift apart. Edit the live workflow.

This folder is kept only so the authored-here history stays traceable.
Nothing in the project depends on it, and it can be deleted whenever
that history is no longer wanted — the suite runs the same way locally
with `npm test` either way.
