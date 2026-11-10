-- "Report this form" (docs/superpowers/specs/2026-10-15-report-this-form.md §5 in jobadabra): waiting_told_at = when the owner was told the report waited 2 days unfetched ('' until then;
-- shared/report-waiting.js claims it before the send, once per report); why = the reason word the owner gave when closing it (status fixed or unreplayable, e.g. no-page), '' when none.
ALTER TABLE form_reports ADD COLUMN waiting_told_at TEXT NOT NULL DEFAULT '';
ALTER TABLE form_reports ADD COLUMN why TEXT NOT NULL DEFAULT '';
