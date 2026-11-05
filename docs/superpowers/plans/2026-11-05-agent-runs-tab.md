# Agent runs tab

Goal: keep Agent harness limited to context layers and sources, and put CI run outcomes on a separate Agent runs tab, as requested by the owner on 5 Nov 2026.

Use the existing admin navigation, cards, owner authentication and stored harness upload. No new data source or schema. Remove the implementation-plan checklist from these pages; its source remains in the repository.

## Progress

- [ ] Add regression coverage for the harness/run separation and the new protected route.
- [ ] Move the existing run summary and cards to `admin/ai-runs.js`; leave context layers and sources in `admin/ai-harness.js`.
- [ ] Register `/admin/ai/runs` in the Worker and admin navigation, with separate page descriptions.
- [ ] Run the affected test files and render both pages at desktop/mobile widths in light/dark themes.
- [ ] Commit and open one PR through `tools/ship.sh` for the owner's merge.

Verification: `tools/site-run.sh node --test test/unit/admin/ai/ai-harness.test.js test/unit/admin/ai/ai-section.test.js`; previews use the existing `ai-harness` fictional seed for both routes.
