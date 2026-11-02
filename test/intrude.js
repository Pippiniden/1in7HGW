// ボス乱入の確認。使い方: node test/intrude.js [回数] [開始シード] [--force] [--set=key:v,boss.power:v] [--log=シード]
//   既定は実際の確率（CONFIG.INTRUDE.chance）で回し、乱入の発生率と、乱入した戦争でボスを倒せた割合（目標は約 50%）を数える。
//   --force：条件を満たした戦争では必ず乱入させる（乱入した戦争の数を増やして、強さを測るとき）
for (const f of ['config', 'rank', 'parser', 'effects', 'fgoskills', 'build', 'master', 'war', 'names', 'scenes', 'personas', 'engine']) require('../js/' + f + '.js');
const fs = require('fs');
const H = globalThis.HGW, E = H.effects;
const man = JSON.parse(fs.readFileSync(__dirname + '/../data/manifest.json', 'utf8'));
for (const f of man.overrides) { const o = JSON.parse(fs.readFileSync(__dirname + '/../data/' + f, 'utf8')); Object.assign(E.SKILL_OVERRIDES, o.global || {}); Object.assign(E.SERVANT_OVERRIDES, o.servant || {}); Object.assign(E.STAT_OVERRIDES, o.stats || {}); Object.assign(E.NP_OVERRIDES, o.np || {}); Object.assign(E.CONTENT_OVERRIDES, o.content || {}); Object.assign(E.CONTENT_OVERRIDES, o.content || {}); if (o.attrs) Object.assign(E.ATTR_MASTER, o.attrs); if (o.attrOf) Object.assign(E.ATTR_OF, o.attrOf); if (o.boss) Object.assign(E.BOSS_PARAMS, o.boss); }
let raw = []; for (const f of man.servants) raw.push(...JSON.parse(fs.readFileSync(__dirname + '/../data/' + f, 'utf8')).servants);
const all = raw.map(H.build.fromJSON);
const res = { servants: all, bosses: [] };
for (const f of man.bosses || []) res.bosses.push(...(JSON.parse(fs.readFileSync(__dirname + '/../data/' + f, 'utf8')).bosses || []));
const roster = all.filter(s => !s.bossOnly);
const { bosses, errors: bossErr } = H.build.bossesOf(res);
if (bossErr.length) console.error(bossErr);

const args = process.argv.slice(2), flag = k => args.find(a => a.startsWith('--' + k));
const nums = args.filter(a => !a.startsWith('--'));
const n = +(nums[0] || 500), seed0 = +(nums[1] || 0), force = !!flag('force');
for (const kv of ((flag('set') || '').slice(6).split(',')).filter(Boolean)) {
  const [k, v] = kv.split(':'), path = k.split('.'); let o = H.CONFIG.INTRUDE;
  while (path.length > 1) o = o[path.shift()];
  o[path[0]] = +v;
}
const logSeed = (flag('log') || '').slice(6);
const intrude = { on: true, force, bosses };
if (logSeed) {
  const w = H.engine.runWar({ roster, seed: logSeed, intrude });
  for (const e of w.entries) console.log(`[${e.day}${e.phase[0]}] ${e.kind.padEnd(8)} ${e.text}`);
  console.log(w.ending, w.winners, w.camps.map(c => `${c.label} ${c.trueName}: ${c.fate ? c.fate.day + '日 ' + c.fate.text : '-'}`).join('\n'));
  process.exit(0);
}
let errors = 0, intr = 0, purge = 0, scorched = 0, wipe = 0, other = 0, joinN = 0, soloN = 0, kinds = { boss: 0, outsider: 0 }; const survivors = [], bdays = [];
const byBoss = {};
for (let i = 0; i < n; i++) {
  let w; try { w = H.engine.runWar({ roster, seed: 's' + (seed0 + i), intrude }); } catch (e) { errors++; if (errors < 3) console.error(e); continue; }
  const b = w.camps.find(c => c.boss);
  if (!b) { if (w.winner == null && w.ending === 'win') errors++; continue; }
  intr++;
  const isBoss = bosses.some(x => x.id === b.servantId); kinds[isBoss ? 'boss' : 'outsider']++;
  const first = w.entries.find(e => /intrudeAppear|汚染された/.test(e.text) && e.kind === 'event');
  if (first) bdays.push(first.day);
  if (w.ending === 'purge') { purge++; survivors.push(w.winners.length); (byBoss[b.trueName] = byBoss[b.trueName] || [0, 0])[0]++; }
  else if (w.ending === 'scorched') { scorched++; (byBoss[b.trueName] = byBoss[b.trueName] || [0, 0])[1]++; }
  else if (w.ending === 'wipe') { wipe++; (byBoss[b.trueName] = byBoss[b.trueName] || [0, 0])[0]++; } else other++;
  joinN += w.entries.filter(e => /同盟に加わった|手を結んだ/.test(e.text)).length;
  soloN += w.entries.filter(e => /加わらなかった|受け取らなかった|取らなかった/.test(e.text)).length;
}
const pct = x => (x / Math.max(1, intr) * 100).toFixed(1) + '%';
console.log({ n, errors, intruded: intr, rate: (intr / n * 100).toFixed(2) + '%', purge: pct(purge), wipeWithBoss: pct(wipe), scorched: pct(scorched), other, kinds, joinN, soloN, survivorsAvg: survivors.length ? (survivors.reduce((a, b) => a + b, 0) / survivors.length).toFixed(2) : '-', dayAvg: bdays.length ? (bdays.reduce((a, b) => a + b, 0) / bdays.length).toFixed(1) : '-' });
const top = Object.entries(byBoss).sort((a, b) => (b[1][0] + b[1][1]) - (a[1][0] + a[1][1])).slice(0, 10);
if (top.length) console.log(top.map(([k, [a, b]]) => `${k}:${a}/${a + b}`).join('  '));
if (errors) process.exitCode = 1;

// ---- 確認：決着の整合・乱入しない設定・乱入した戦争の再現 ----
{
  const ng = [];
  const a = H.engine.runWar({ roster, seed: 's7', intrude: { on: true, force: true, bosses } });
  const b = H.engine.runWar({ roster, seed: 's7', intrude: { on: true, force: true, bosses } });
  if (JSON.stringify(a.entries.map(e => e.text)) !== JSON.stringify(b.entries.map(e => e.text))) ng.push('同じシードで乱入した戦争が再現されない');
  for (let i = 0; i < 40; i++) {
    const off = H.engine.runWar({ roster, seed: 'o' + i, intrude: { on: false, force: true, bosses } });
    if (off.camps.some(c => c.boss) || off.ending === 'purge' || off.ending === 'scorched') ng.push('乱入しない設定なのに乱入した（シード o' + i + '）');
    const r = H.engine.runWar({ roster, seed: 'o' + i, intrude: { on: true, force: true, bosses } });
    const boss = r.camps.find(c => c.boss);
    if (!boss) continue;
    if (r.camps.length !== 8 || boss.id !== 7) ng.push('ボスが八番目の陣営になっていない');
    if (r.ending === 'purge' && !(r.winners && r.winners.length && boss.alive === false && r.winners.every(id => r.camps[id].alive))) ng.push('purge の勝者が生き残りと合わない（シード o' + i + '）');
    if (r.ending === 'scorched' && !boss.alive === true) ng.push('scorched なのにボスが倒れている（シード o' + i + '）');
    if (!['purge', 'scorched', 'wipe'].includes(r.ending)) ng.push('乱入した戦争の結末が想定外：' + r.ending);
    if (r.entries.some(e => e.kind === 'cs' && e.ids[0] === 7)) ng.push('ボスが令呪を使っている');
  }
  if (ng.length) { console.error('NG: ' + [...new Set(ng)].join('\n    ')); process.exitCode = 1; } else console.log('OK：乱入の再現・決着・設定');
}
