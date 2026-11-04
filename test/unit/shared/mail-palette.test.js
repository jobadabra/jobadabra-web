// The e-mail colours are the app's (owner, 28 Oct 2026: "switch our email templates to website and desktop app color palette ... yellow instead of orange"):
// shared/mail-palette.js writes out the values of desktop/renderer/tokens.css (an e-mail cannot read CSS variables) and this test fails when one drifts, when any template
// still carries the old orange, and when the yellow button, the link or the pill would be hard to read. Renders to strings only; no mail is sent.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {SAMPLES} from '../../../admin/email-preview.js';
import {compose} from '../../../shared/mail.js';
import {DARK, LIGHT, TOKENS} from '../../../shared/mail-palette.js';
import {TEMPLATES} from '../../../shared/mail-templates.js';

const css = readFileSync(new URL('../../../desktop/renderer/tokens.css', import.meta.url), 'utf8');
const block = text => Object.fromEntries([...text.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
const light = block(css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)')));
const dark = {...light, ...block(css.slice(css.indexOf('@media (prefers-color-scheme: dark)')))};

test('every e-mail colour is the app token it names, light and dark', () => {
  for (const [name, [token, lightValue, darkValue]] of Object.entries(TOKENS)) {
    assert.equal(light[token], lightValue, `${name} (${token}) light`);
    assert.equal(dark[token], darkValue, `${name} (${token}) dark`);
  }
});

const luminance = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

test('the yellow button, the links and the pills are readable (4.5:1) in both themes', () => {
  assert.ok(contrast(LIGHT.onFill, LIGHT.fill) >= 4.5, 'dark ink on the yellow button');
  assert.ok(contrast(LIGHT.signal, LIGHT.card) >= 4.5, 'link on the light card');
  assert.ok(contrast(DARK.signal, DARK.card) >= 4.5, 'link on the dark card');
  assert.ok(contrast(LIGHT.softInk, LIGHT.soft) >= 4.5, 'pill, light');
  assert.ok(contrast(DARK.softInk, DARK.soft) >= 4.5, 'pill, dark');
  assert.ok(contrast(LIGHT.onHero, LIGHT.hero) >= 4.5 && contrast(LIGHT.onHeroMuted, LIGHT.hero) >= 4.5, 'text on the hero band');
});

test('no template carries the old orange, and a template with a button carries the yellow with dark ink', () => {
  const links = {stop: 'https://s/stop', settings: 'https://s/set'};
  let withButton = 0;
  for (const name of Object.keys(TEMPLATES)) {
    const {html} = compose(name, SAMPLES[name], links);
    assert.ok(!/d0612b/i.test(html), `${name} still has the old orange`);
    assert.ok(html.includes(LIGHT.signal), `${name}: links take the app's amber text colour`);
    if (html.includes(`background:${LIGHT.fill}`)) { withButton++; assert.ok(html.includes(`background:${LIGHT.fill};color:${LIGHT.onFill}`), `${name}: dark ink on the yellow`); }
  }
  assert.ok(withButton >= 3, 'the yellow button shows in the templates that have one');
});
