// The one import for charts on the admin pages (owner, 5 Nov 2026: tables that are summaries become charts). A page draws none of its own: it calls these and wraps each in figure().
// Forms today: bars, meters, stacks, split (admin/viz-bars.js), columns and line (admin/viz-time.js), ranges (admin/viz-range.js); heat and tiles arrive with the first page that needs them.
// Spec: docs/superpowers/specs/2026-11-05-admin-charts-design.md. The files stay small on purpose: split by form, never by page.
export {VIZ_STYLE, VIZ_TOOLTIP, figure, tipOf, count} from './viz-core.js';
export {bars, meter, meters, stacks, split} from './viz-bars.js';
export {columns, line} from './viz-time.js';
export {ranges} from './viz-range.js';
