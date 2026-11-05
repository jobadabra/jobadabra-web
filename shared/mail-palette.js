// The colours of every e-mail (owner, 28 Oct 2026: "we should switch our email templates to website and desktop app color palette ... yellow instead of orange"). Each is the app's own
// token (desktop/renderer/tokens.css, public repo): [token, light value, dark value]. An e-mail cannot read CSS variables, so the values are written out here and
// test/unit/shared/mail-palette.test.js reads tokens.css and fails when one drifts, so there is never a second hand-typed palette. The dark value is the app's dark-theme value (the light one where the app does not redefine it).
export const TOKENS = {
  bg: ['--bg', '#eef3f7', '#0b1016'],                  // the page behind the card
  card: ['--surface', '#ffffff', '#121a23'],
  quiet: ['--surface-2', '#f8fafc', '#17212c'],        // a quieter box: the sign-in code
  ink: ['--ink', '#0f1b2d', '#e8ecf0'],
  muted: ['--muted', '#4c5d72', '#93a1b0'],
  line: ['--line', '#d3dde7', '#223040'],
  fill: ['--signal-solid', '#ffb224', '#ffb224'],      // the yellow: the one button, filled
  onFill: ['--on-signal', '#14110c', '#14110c'],       // dark ink on the yellow, never white
  signal: ['--signal', '#8a5700', '#ffb224'],          // yellow as text or a link: darker on light, the yellow itself on dark
  soft: ['--signal-soft', '#fff3d6', '#2a2111'],       // a pill behind the app's own words
  softInk: ['--signal-ink', '#6b4300', '#ffc95c'],
  good: ['--good', '#1f7a4d', '#5fd39a'],
  goodSoft: ['--good-soft', '#e3f4ea', '#0f2a1d'],
  hero: ['--navy', '#132439', '#0d131a'],              // the release mail's hero band
  onHero: ['--on-navy', '#e3ebf5', '#e3ebf5'],
  onHeroMuted: ['--on-navy-muted', '#93a4ba', '#93a4ba'],
};
const pick = index => Object.fromEntries(Object.entries(TOKENS).map(([name, token]) => [name, token[index]]));
export const LIGHT = pick(1);
export const DARK = pick(2);
