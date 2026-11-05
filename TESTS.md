# Where each test lives

The path says what a test is: first its kind, then the area it tests. File names don't change when a test moves.

| Folder | Holds | Runs where |
|---|---|---|
| `test/unit/<area>/` | code of one area, no browser | Site tests |
| `test/guards/` | rules that hold across the whole repo | Site tests |
| `test/integration/` | a real browser on real pages | Site tests |
| `test/tooling/` | our own tools | Site tests |
| `test/media/` | run inside `jobadabra`'s desktop harness: joined tree `desktop/test` | `tools/site-guards.sh` |
| `test/python/` | run inside `jobadabra`'s Python harness: joined tree `tests` | `tools/site-guards.sh` |

Areas: `admin`, `api`, `jobs`, `shared`, `website`, `workers/ai-broker`, `workers/www`. A topic with 3 or more tests in a big area gets its own sub-folder, like `test/unit/admin/applying/`.

- **Helpers:** `test/lib/` and `test/fixtures/`; a helper of one area sits beside its tests.
- **A new test:** pick the kind first, then the area of the code it imports.
- **Guard:** `test/guards/test-folders.test.js` fails on a test outside these folders.
