// /admin/ai/engines: who answers the CI's AI calls (owner, 3 Nov 2026): the broker's chain Codex, Claude, Free AI with what each answered, ran out on or failed today, from its public /health (admin/ai-broker-card.js).
// Report only. Test: test/unit/admin/ai-section.test.js.
import {shell, chip} from './ai-section.js';
import {brokerCard} from './ai-broker-card.js';
import {problem} from '../shared/ai-broker.js';

/** The Engines page from the broker read ({chain, fallback, tally} or null when the broker could not be read). */
export function enginesPage(broker, now = new Date()) {
  const chain = broker?.chain || null, trouble = chain ? problem(chain) : null;
  const verdict = `<section class="card"><h2>Engines <span class="muted">· tried in this order; the next one answers when one is used up or fails</span></h2><div class="ai-chips">${!chain ? chip('wait', '… broker not readable') : trouble ? chip('warn', `▲ ${trouble}`) : chip('good', '🟢 every engine ready')}</div></section>`;
  return shell({title: 'Engines', icon: '🔌', heading: 'AI engines', age: now.toISOString(), verdict, body: brokerCard(chain, now.getTime())});
}
