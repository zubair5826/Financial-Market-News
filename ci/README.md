# CI workflow — one manual step needed

`github-actions-test.yml` in this folder is the continuous-integration
workflow for this project. It runs `npm test` on every push and pull
request, against Node 18 and Node 22, and fails the build if a test
wrote to the production `data/runs.jsonl`.

It could not be written to `.github/workflows/` automatically — that
path is protected against remote writes, which is a sensible guard, not
an error. To activate it, copy it there yourself:

```powershell
New-Item -ItemType Directory -Force .github\workflows
Copy-Item ci\github-actions-test.yml .github\workflows\test.yml
git add .github/workflows/test.yml
git commit -m "Add CI workflow"
git push
```

The next push will show a "tests" check on the repository's Actions tab.
Nothing else in the project depends on this file — the suite runs the
same way locally with `npm test`.
