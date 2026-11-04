// A workflow that runs a script of ops/jobs, ops/media or ops/hosted lays the joined tree first (tools/layout-map.txt), because those scripts import ../admin, ../shared, ../desktop.
// Why (layout 2/3, Gitar on #318, 2 Nov 2026): schedules-snapshot.yml ran its script on the raw checkout; after the move to ops/ its ../shared import would have failed every hour.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
const dir = path.join(root, '.github', 'workflows');

test('every workflow that runs a jobs/, media/ or hosted/ script has a tree.sh step before it', () => {
  const bad = [];
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.yml'))) {
    const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n').filter(line => !/^\s*#/.test(line));
    const runs = lines.findIndex(line => /\brun:.*\b(?:node|python3|docker build -f) (?:\S+ )*(?:ops\/)?(?:jobs|media|hosted)\//.test(line));
    if (runs < 0) continue;
    const laid = lines.findIndex(line => /\brun:.*(?:tree|overlay)\.sh/.test(line));
    if (laid < 0 || laid > runs) bad.push(file);
  }
  assert.deepEqual(bad, [], 'these workflows run a moved script without laying the joined tree first');
});
