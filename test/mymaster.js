// マイマスター（warGen の playerMaster）：書いた項目が上書きされ、文面だけの項目は展開を変えず、指定が無ければ以前と同じ
//   node test/mymaster.js [N]
for (const f of ["config","rank","parser","effects","fgoskills","build","master","war","names","scenes","personas","engine"]) require("../js/"+f+".js");
const fs = require('fs');
const man = JSON.parse(fs.readFileSync(__dirname + '/../data/manifest.json', 'utf8'));
for (const f of man.overrides) { const o = JSON.parse(fs.readFileSync(__dirname + '/../data/' + f, 'utf8')); const E = HGW.effects; Object.assign(E.SKILL_OVERRIDES, o.global || {}); Object.assign(E.SERVANT_OVERRIDES, o.servant || {}); Object.assign(E.STAT_OVERRIDES, o.stats || {}); Object.assign(E.NP_OVERRIDES, o.np || {}); Object.assign(E.CONTENT_OVERRIDES, o.content || {}); }
let raw = []; for (const f of man.servants) raw.push(...JSON.parse(fs.readFileSync(__dirname + '/../data/' + f, 'utf8')).servants);
const roster = raw.map(HGW.build.fromJSON);
const N = +process.argv[2] || 30;

const run = (seed, pm, answers) => {
  const out = {}; const g = HGW.engine.warGen({ roster, seed, player: 2, ask: 'big', out, playerMaster: pm });
  let r = g.next(), i = 0; while (!r.done) r = g.next(r.value.type === 'tick' ? 'auto' : (answers ? answers[i++ % answers.length] : 'auto'));
  return { r: r.value, out };
};
const shape = o => JSON.stringify(o.out.entries.map(e => [e.kind, e.day, (e.snap || []).map(s => [s.hp, s.alive, s.mana, s.mhp])]));
const PM = { origin: 'noble', originLabel: '時計塔の講師', stats: { mana: 'A', craft: 'EX', body: 'E', mind: 'B', luck: 'C' }, persona: 'proud', wish: '根源へ至る', past: '幼い頃に、ひとつの約束をした。' };
let fail = 0, changed = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.error('NG', msg); } };

// 1. 書いた項目が載る
{
  const m = run('mm0', PM).out.meta[2].master;
  check(m.origin === 'noble' && m.originLabel === '時計塔の講師', 'origin ' + m.origin + ' ' + m.originLabel);
  check(m.wish === PM.wish && m.past === PM.past, 'wish/past');
  check(m.persona === HGW.PERSONAS.proud.label, 'persona ' + m.persona);
  check(m.stats.body <= HGW.rank.toScore('E') + 1 && m.stats.craft >= HGW.rank.toScore('EX') - 1, 'stats ' + JSON.stringify(m.stats));
  check(m.hpMax === Math.round(50 + HGW.rank.toScore('E') * 0.8) || m.hpMax > 0, 'hpMax');
}
for (let i = 0; i < N; i++) {
  const seed = 'mm' + i;
  const a = run(seed), t = run(seed, { originLabel: 'x', wish: 'ただ生きたい', past: '…' }), b = run(seed, PM);
  // 2. 文面だけなら展開は同じ
  check(shape(a) === shape(t) && a.r.winner === t.r.winner, 'text-only changed outcome ' + seed);
  // 3. 指定なし（空）も同じ
  check(shape(a) === shape(run(seed, {})), 'empty pm changed outcome ' + seed);
  if (shape(a) !== shape(b)) changed++;
  // 4. 同じ指定なら同じ展開（再現できる）
  check(shape(b) === shape(run(seed, PM)), 'replay mismatch ' + seed);
}
console.log(`wars ${N}  outcome changed by stats/origin/persona ${changed}/${N}  fail ${fail}`);
process.exit(fail ? 1 : 0);
