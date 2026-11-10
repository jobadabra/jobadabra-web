// The shared owner-message card: one copy, in the public repo (desktop/e2e/lib/tg-card.mjs), which the CI senders there and the Workers here both use (the same pattern as admin/ai-refusal.js).
// Why (10 Nov 2026, owner: every message reads like the Central scout one): a second copy would drift; private reads public, so the public PR lands first.
export * from '../desktop/e2e/lib/tg-card.mjs';
