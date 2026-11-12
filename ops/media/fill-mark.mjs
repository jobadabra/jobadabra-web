// The address mark the app's Apply puts on the tab it opens; the extension fills only a tab that carries it (public extension/tab-pages.js tabArmed).
// Why (owner, 12 Nov 2026, the /how-it-works redo): the app kept "#jobpilotto-fill" through the 2 Nov rename (public #2926), but this repo's rename
// (#309) made it "jobadabra-fill" here, so every extension recording since waited for a panel that never opened. Guard: desktop/test/media-fill-mark.test.js.
// Its own file, no imports: the guard reads it on CI, where the recorder's browser package is not installed.
export const FILL_MARK = 'jobpilotto-fill';
