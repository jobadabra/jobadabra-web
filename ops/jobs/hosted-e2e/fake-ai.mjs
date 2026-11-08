// A stand-in for Workers AI (env.AI) in the hosted e2e: no model, no cost. A structured ask (response_format json_schema) is answered with a value that fits the schema
// (numbers high, text "ok", the first allowed answer), so every AI step the engine takes in a scheduled search gets a valid answer; the calls are counted for the debit check.
// The two place questions (src/geo.py: where a string is; src/ai/place_triage.py: is a job location in the person's places) get one entry per numbered item, a fixed
// answer for the fixture's places (Zurich, Switzerland), "unknown"/"out" for the rest (26 Oct 2026: answered with [], no job was placed once places were the AI's first,
// and no match reached the inbox). The title question (src/ai/title_triage.py: the numbers of the titles that fit) gets the titles holding one of the search's own
// role words and none of its ruled-out words, read from the question. Other lists stay empty: the first allowed answer for each item made "zurich" the Geneva metro.
// Test: test/unit/jobs/hosted-fake-ai.test.js.
const ZURICH = {kind: 'city', cc: 'CH', lat: 47.37, lon: 8.54, r_km: 20, where: 'Zurich', country: 'Switzerland', nearest: 'zurich', km: 0, answer: 'best'};
const SWISS = {kind: 'country', cc: 'CH', lat: 0, lon: 0, r_km: 0, where: '', country: 'Switzerland', nearest: 'zurich', km: -1, answer: 'inside'};
const REMOTE = {kind: 'remote', cc: '', lat: 0, lon: 0, r_km: 0, where: '', country: '', nearest: 'none', km: -1, answer: 'out'};
const ELSEWHERE = {kind: 'unknown', cc: '', lat: 0, lon: 0, r_km: 0, where: '', country: '', nearest: 'none', km: -1, answer: 'out'};

function place(text) {
  if (/z(u|ü|ue)ri/i.test(text)) return ZURICH;
  if (/remote/i.test(text)) return REMOTE;
  if (/switzerland|schweiz|suisse|svizzera|\bCH\b|\bBern\b/i.test(text)) return SWISS;
  return ELSEWHERE;
}

export function listed(text) {
  const blocks = [...String(text).matchAll(/^### Item (\d+)\n([^\n]*)/gm)].map(m => ({n: Number(m[1]), text: m[2]}));
  return blocks.length ? blocks : [...String(text).matchAll(/^(\d+)\. (.+)$/gm)].map(m => ({n: Number(m[1]), text: m[2]}));
}

function fitting(items, asked) {
  const search = JSON.parse(String(asked).match(/^The search \(JSON\): (.+)$/m)?.[1] || '{}');
  const has = (text, words) => (words || []).some(word => { try { return new RegExp(word, 'i').test(text); } catch { return text.toLowerCase().includes(String(word).toLowerCase()); } });
  return items.filter(item => has(item.text, search.role_words) && !has(item.text, search.words_ruled_out)).map(item => item.n);
}

export function fromSchema(schema, items = [], asked = '') {
  if (!schema || typeof schema !== 'object') return null;
  if ('const' in schema) return schema.const;
  if (schema.enum) return schema.enum[0];
  const pick = schema.anyOf || schema.oneOf;
  if (pick) return fromSchema(pick.find(part => part.type !== 'null') || pick[0], items, asked);
  const type = Array.isArray(schema.type) ? schema.type.find(t => t !== 'null') : schema.type;
  if (type === 'object') return Object.fromEntries(Object.entries(schema.properties || {}).map(([key, part]) =>
    [key, key === 'fit' && part.type === 'array' ? fitting(items, asked) : fromSchema(part, items, asked)]));
  if (type === 'array') {
    const props = schema.items?.properties || {};
    const key = ['n', 'index'].find(name => name in props);
    if (!key || !('cc' in props || 'nearest' in props)) return [];
    return items.map(item => {
      const facts = place(item.text);
      return Object.fromEntries(Object.entries(props).map(([name, part]) => [name, name === key ? item.n : name in facts ? facts[name] : fromSchema(part)]));
    });
  }
  if (type === 'integer' || type === 'number') return Math.min(schema.maximum ?? 85, Math.max(schema.minimum ?? 0, 85));
  if (type === 'boolean') return true;
  return 'ok';
}

const textOf = content => typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => part?.text || '').join('\n') : '';

// Why (8 Nov 2026, fr; code review of the Gemma 4 move): Gemma 4 gets its schema written at the end of the user message, not as `response_format` (desktop/lib/free-ai-translate.js SCHEMA_ASK), and answers in a markdown fence.
// Without this the fake saw no schema and answered {"ok":true} to every ask: no job placed, the 26 Oct incident (test/unit/jobs/hosted-fake-ai.test.js). Both shapes work, so the order of the two repos' merges does not matter.
const SCHEMA_MARK = 'matching this JSON schema exactly: ';
function schemaOf(input) {
  const forced = input.response_format?.json_schema?.schema;
  if (forced) return {schema: forced, asked: null};
  for (const message of [...(input.messages || [])].reverse()) {
    const text = textOf(message.content), at = text.lastIndexOf(SCHEMA_MARK);
    if (message.role !== 'user' || at < 0) continue;
    try { return {schema: JSON.parse(text.slice(at + SCHEMA_MARK.length)), asked: text.slice(0, at)}; } catch { /* not ours: no schema */ }
  }
  return {schema: null, asked: null};
}

export function fakeAi() {
  const calls = [];
  return {
    calls,
    async run(model, input) {
      const {schema, asked: beforeSchema} = schemaOf(input);
      calls.push({model, structured: !!schema});
      const asked = (input.messages || []).filter(message => message.role === 'user').map(message => textOf(message.content)).join('\n').replace(/\n*Reply with ONE JSON object only, no other text, matching this JSON schema exactly: [\s\S]*$/, '');
      const json = JSON.stringify(schema ? fromSchema(schema, listed(asked), asked) : {ok: true});
      return {response: beforeSchema != null ? '```json\n' + json + '\n```' : json, usage: {prompt_tokens: 1200, completion_tokens: 80}};   // fenced only when the schema came in the prompt, as Gemma 4 answers
    },
    async toMarkdown() { return [{data: ''}]; },
  };
}
