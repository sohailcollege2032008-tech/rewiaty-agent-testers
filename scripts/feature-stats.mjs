#!/usr/bin/env node
// Counts .factory/FEATURES.md: a feature is DONE only when all 5 gates are ticked.
import { readFileSync } from 'node:fs';
const md = readFileSync(new URL('../.factory/FEATURES.md', import.meta.url), 'utf8');
const phases = []; let phase = null, feat = null;
for (const line of md.split('\n')) {
  if (line.startsWith('## المرحلة')) { phase = { name: line.slice(3).trim(), feats: [] }; phases.push(phase); continue; }
  if (line.startsWith('## ')) { phase = null; continue; }
  if (!phase) continue;
  if (line.startsWith('### ')) { feat = { name: line.slice(4).trim(), sub: [0, 0], gates: [0, 5] }; phase.feats.push(feat); continue; }
  if (!feat) continue;
  if (line.startsWith('- بوابات:')) { feat.gates[0] = (line.match(/\[x\]/g) || []).length; continue; }
  const m = line.match(/^- \[( |x)\]/); if (m) { feat.sub[1]++; if (m[1] === 'x') feat.sub[0]++; }
}
let all = [0, 0, 0, 0];
for (const p of phases) {
  const done = p.feats.filter(f => f.gates[0] === 5).length;
  const sub = p.feats.reduce((a, f) => [a[0] + f.sub[0], a[1] + f.sub[1]], [0, 0]);
  const gates = p.feats.reduce((a, f) => a + f.gates[0], 0);
  const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);
  console.log(`${p.name}\n  فيتشرز خلصت (5/5 بوابات): ${done}/${p.feats.length}  ·  بنود صغيرة: ${sub[0]}/${sub[1]} (${pct(sub[0], sub[1])}%)  ·  بوابات: ${gates}/${p.feats.length * 5} (${pct(gates, p.feats.length * 5)}%)`);
  all = [all[0] + done, all[1] + p.feats.length, all[2] + sub[0], all[3] + sub[1]];
}
console.log(`\nالإجمالي: ${all[0]}/${all[1]} فيتشر خلصت · ${all[2]}/${all[3]} بند صغير`);
