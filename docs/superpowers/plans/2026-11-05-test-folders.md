# Web tests by kind, then area

The owner chose "Kind first" on 5 Nov 2026. Sketch: https://claude.ai/artifact/6UJ2goFukYmgSoJJeWxrda. Target layout: [TESTS.md](../../../TESTS.md).

| PR | What | Proof |
|---|---|---|
| 1/2 | Every test into `unit/<area>`, `guards`, `integration`, `tooling`, `media`; `TESTS.md`; the folder guard | Same tests pass on CI; relative paths resolve the same |
| 2/2 | Topic sub-folders of 3 or more tests in `unit/admin`, `unit/shared`, `unit/api` | Same count again |

## Progress
- [ ] 1/2 kinds and areas (proof: test/guards/test-folders.test.js)
- [ ] 2/2 topic sub-folders (proof: none: not started)
