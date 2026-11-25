#!/usr/bin/env node
// Builds the visual feature tracker page (HTML) from .factory/FEATURES.md.
// Why (product): Sohail wants to *see* every feature and its sub-checklist move as work lands, not open a file in
// the repo. The page is regenerated from the same file after every merge, so the two never disagree.
// Usage: node scripts/features-page.mjs [out.html]
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const md = fs.readFileSync(path.join(root, '.factory/FEATURES.md'), 'utf8');
const out = process.argv[2] || path.join(root, '.factory/features.html');

const GATES = ['كود', 'اختبار', 'مراجعة', 'جهاز', 'QA'];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');

const phases = [];
let phase = null;
let feat = null;
for (const line of md.split('\n')) {
  const ph = line.match(/^## (المرحلة \d+)[:：]?\s*(.*)$/);
  if (ph) { phase = { name: ph[1], title: ph[2], features: [] }; phases.push(phase); feat = null; continue; }
  if (/^## /.test(line)) { phase = null; feat = null; continue; }
  if (!phase) continue;
  const f = line.match(/^### (F\w+)\s+(.*)$/);
  if (f) { feat = { id: f[1], title: f[2], items: [], gates: null }; phase.features.push(feat); continue; }
  if (!feat) continue;
  const g = line.match(/^- بوابات:\s*(.*)$/);
  if (g) { feat.gates = GATES.map((name) => new RegExp(`\\[x\\]\\s*${name}`).test(g[1])); continue; }
  const it = line.match(/^- \[( |x)\]\s+(.*)$/);
  if (it) feat.items.push({ done: it[1] === 'x', text: it[2] });
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
let totItems = 0, totDone = 0, totGates = 0, totGatesDone = 0, totFeat = 0, totFeatDone = 0;
for (const p of phases) {
  p.items = 0; p.itemsDone = 0; p.gates = 0; p.gatesDone = 0; p.featDone = 0;
  for (const f of p.features) {
    f.itemsDone = f.items.filter((i) => i.done).length;
    f.gatesDone = (f.gates || []).filter(Boolean).length;
    f.done = f.gates && f.gatesDone === GATES.length;
    p.items += f.items.length; p.itemsDone += f.itemsDone;
    p.gates += GATES.length; p.gatesDone += f.gatesDone;
    if (f.done) p.featDone++;
  }
  totItems += p.items; totDone += p.itemsDone; totGates += p.gates; totGatesDone += p.gatesDone;
  totFeat += p.features.length; totFeatDone += p.featDone;
}

const state = (f) => (f.done ? 'done' : f.gatesDone || f.itemsDone ? 'wip' : 'todo');
const stateLabel = { done: 'اتعملت', wip: 'شغّالة', todo: 'لسه' };
const updated = new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' });

const featHtml = (f) => `
  <details class="feat ${state(f)}"${state(f) === 'wip' ? ' open' : ''}>
    <summary>
      <span class="fid">${f.id}</span>
      <span class="ftitle">${inline(f.title)}</span>
      <span class="chip ${state(f)}">${stateLabel[state(f)]}</span>
      <span class="gates" aria-label="البوابات">${GATES.map((g, i) => `<span class="gate ${f.gates && f.gates[i] ? 'on' : ''}" title="${g}">${g}</span>`).join('')}</span>
      <span class="count">${f.itemsDone}/${f.items.length}</span>
    </summary>
    <ul>${f.items.map((i) => `<li class="${i.done ? 'ok' : ''}"><span class="box" aria-hidden="true">${i.done ? '✓' : ''}</span>${inline(i.text)}</li>`).join('')}</ul>
  </details>`;

const html = `<title>تشيك ليست روايتي</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Readex+Pro:wght@400;500;600&display=swap">
<style>
/* Layout: a reader's ledger — one summary strip, then each phase as a section of feature rows with gate stamps. */
:root{
  --paper:#FAF7F0; --surface:#F3EDE2; --ink:#231F1A; --muted:#6E655A; --rule:#E3DACB;
  --crimson:#9E3E2F; --ok:#2F6B4F; --wip:#B7791F; --todo:#A69686;
  --display:'Amiri','Noto Naskh Arabic',serif; --ui:'Readex Pro','Noto Sans Arabic',system-ui,sans-serif;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){
  --paper:#181310; --surface:#221B17; --ink:#DECFC0; --muted:#A69686; --rule:#372C25;
  --crimson:#DF7863; --ok:#6FBF94; --wip:#E0A84A; --todo:#7C6E62; color-scheme:dark}}
:root[data-theme="dark"]{
  --paper:#181310; --surface:#221B17; --ink:#DECFC0; --muted:#A69686; --rule:#372C25;
  --crimson:#DF7863; --ok:#6FBF94; --wip:#E0A84A; --todo:#7C6E62; color-scheme:dark}
body{background:var(--paper);color:var(--ink);font-family:var(--ui);direction:rtl;line-height:1.7}
.wrap{max-width:980px;margin:0 auto;padding-block:28px 64px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:grid;gap:28px}
header h1{font-family:var(--display);font-size:2.4rem;margin:0;line-height:1.2;text-wrap:balance}
header p{margin:4px 0 0;color:var(--muted);font-size:.9rem}
.rule-note{font-size:.85rem;color:var(--muted);border-inline-start:3px solid var(--crimson);padding-inline-start:10px}
.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}
.stat{background:var(--surface);border:1px solid var(--rule);border-radius:10px;padding:14px 16px;display:grid;gap:4px;min-width:0}
.stat .lbl{font-size:.8rem;color:var(--muted)}
.stat .num{font-size:1.7rem;font-weight:600;font-variant-numeric:tabular-nums}
.bar{height:6px;background:var(--rule);border-radius:3px;overflow:hidden}
.bar i{display:block;height:100%;background:var(--crimson)}
section.phase{display:grid;gap:10px}
.phead{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 16px;border-bottom:1px solid var(--rule);padding-bottom:8px}
.phead h2{font-family:var(--display);font-size:1.6rem;margin:0}
.phead .meta{color:var(--muted);font-size:.85rem;font-variant-numeric:tabular-nums}
.phead .bar{flex:1 1 160px;min-width:120px}
details.feat{border:1px solid var(--rule);border-radius:8px;background:var(--paper)}
details.feat[open]{background:var(--surface)}
summary{list-style:none;cursor:pointer;display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:10px 12px}
summary::-webkit-details-marker{display:none}
summary:focus-visible{outline:2px solid var(--crimson);outline-offset:2px;border-radius:8px}
.fid{font-size:.75rem;color:var(--muted);font-variant-numeric:tabular-nums;min-width:3.2em}
.ftitle{flex:1 1 260px;font-weight:500;min-width:0}
.chip{font-size:.72rem;padding:1px 8px;border-radius:999px;border:1px solid currentColor}
.chip.done{color:var(--ok)} .chip.wip{color:var(--wip)} .chip.todo{color:var(--todo)}
.gates{display:flex;gap:3px}
.gate{font-size:.66rem;padding:0 5px;border-radius:4px;border:1px solid var(--rule);color:var(--todo)}
.gate.on{background:var(--ok);border-color:var(--ok);color:var(--paper)}
.count{font-size:.8rem;color:var(--muted);font-variant-numeric:tabular-nums}
ul{margin:0;padding:0 14px 12px;list-style:none;display:grid;gap:4px}
li{display:flex;gap:8px;align-items:flex-start;font-size:.92rem;min-width:0}
li .box{flex:none;width:1.1em;height:1.1em;margin-top:.3em;border:1.5px solid var(--todo);border-radius:3px;display:grid;place-items:center;font-size:.75em;color:var(--paper)}
li.ok .box{background:var(--ok);border-color:var(--ok)}
li.ok{color:var(--muted)}
code{font-family:ui-monospace,monospace;font-size:.85em;background:var(--rule);padding:0 4px;border-radius:3px;direction:ltr;unicode-bidi:isolate}
@media (prefers-reduced-motion:no-preference){details.feat{transition:background .2s}}
</style>
<div class="wrap">
  <header>
    <h1>تشيك ليست روايتي</h1>
    <p>آخر تحديث: ${esc(updated)} · المصدر: <code>.factory/FEATURES.md</code></p>
  </header>
  <p class="rule-note">الفيتشر بتتحسب «اتعملت» لما تعدّي البوابات الخمسة: كود · اختبار · مراجعة · جهاز · QA. والبنود الصغيرة تحت كل فيتشر هي شغلها الفعلي.</p>
  <div class="summary">
    <div class="stat"><span class="lbl">النسخة المبدأية (المرحلة 1): البنود</span><span class="num">${pct(phases[0].itemsDone, phases[0].items)}%</span><div class="bar"><i style="width:${pct(phases[0].itemsDone, phases[0].items)}%"></i></div></div>
    <div class="stat"><span class="lbl">المرحلة 1: البوابات</span><span class="num">${pct(phases[0].gatesDone, phases[0].gates)}%</span><div class="bar"><i style="width:${pct(phases[0].gatesDone, phases[0].gates)}%"></i></div></div>
    <div class="stat"><span class="lbl">كل البنود الصغيرة</span><span class="num">${totDone}/${totItems}</span><div class="bar"><i style="width:${pct(totDone, totItems)}%"></i></div></div>
    <div class="stat"><span class="lbl">فيتشرز عدّت الخمس بوابات</span><span class="num">${totFeatDone}/${totFeat}</span><div class="bar"><i style="width:${pct(totFeatDone, totFeat)}%"></i></div></div>
  </div>
  ${phases.map((p) => `
  <section class="phase">
    <div class="phead">
      <h2>${esc(p.name)}: ${inline(p.title)}</h2>
      <span class="meta">بنود ${p.itemsDone}/${p.items} · بوابات ${p.gatesDone}/${p.gates} · خلصت ${p.featDone}/${p.features.length}</span>
      <div class="bar"><i style="width:${pct(p.itemsDone, p.items)}%"></i></div>
    </div>
    ${p.features.map(featHtml).join('')}
  </section>`).join('')}
</div>
`;
fs.writeFileSync(out, html);
console.log(`wrote ${out}: ${phases.length} phases, ${totFeat} features, ${totDone}/${totItems} items`);
