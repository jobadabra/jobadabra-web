// The one HTML escaper every page and mail uses. Guarded by test/unit/workers/www/stats.test.js.
export const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
// The lighter one for plain text in a message or a list (& < > only): the Telegram note of a new feedback and the feedback page.
export const escTags = text => String(text).replace(/[&<>]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c]));
