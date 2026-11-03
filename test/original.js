// オリジナル特異点：シナリオの整合性チェック、全自動で回したときのエラーと結末、対話式の再現、文面の差し替えを確かめる
//   node test/original.js [回数] [シードを1つ表示]
//   node test/original.js 200 --file=data/scenarios/sample.json   （別のシナリオで回す）
const fs = require('fs');
for (const f of ['config', 'rank', 'parser', 'effects', 'fgoskills', 'build', 'master', 'war', 'names', 'scenes', 'personas', 'engine', 'singdata', 'scenario', 'original']) require('../js/' + f + '.js');
const H = globalThis.HGW, E = H.effects, SC = H.scenario;
const D = __dirname + '/../data/';
const man = JSON.parse(fs.readFileSync(D + 'manifest.json', 'utf8'));
for (const f of man.overrides || []) { const o = JSON.parse(fs.readFileSync(D + f, 'utf8')); for (const [k, t] of Object.entries(E.OVERRIDE_TABLES)) Object.assign(t, o[k] || {}); }
const raw = []; for (const f of man.servants) raw.push(...JSON.parse(fs.readFileSync(D + f, 'utf8')).servants);
H.build.harvestOverrides(raw);
const roster = raw.map(H.build.fromJSON);
const bspec = []; for (const f of man.bosses || []) bspec.push(...JSON.parse(fs.readFileSync(D + f, 'utf8')).bosses);
const { bosses } = H.build.prepareBosses(bspec);

const args = process.argv.slice(2), flag = k => (args.find(a => a.startsWith('--' + k + '=')) || '').split('=')[1];
const pos = args.filter(a => !a.startsWith('--'));
const N = +(pos[0] || 100), show = pos[1];
const sample = JSON.parse(fs.readFileSync(flag('file') || D + 'scenarios/sample.json', 'utf8'));
let fail = 0;
const bad = (...m) => { fail++; console.error('NG:', ...m); };

if (show) {
  const r = H.original.run({ scenario: sample, roster, bosses, seed: show });
  for (const e of r.entries) console.log(`[${e.day}${e.phase[0]}] ${e.kind.padEnd(8)} ${e.text}${e.quote ? '  「' + e.quote.text + '」' : ''}`);
  console.log(`\n${r.name}  結末: ${r.ending}  ${r.days}日  ${r.stageReached}/${r.stages}節  倒した敵 ${r.slain}/${r.foes}`);
  process.exit(0);
}

// ---------- 整合性チェック ----------
const chk = s => SC.check(s, { roster, bosses });
const clone = o => JSON.parse(JSON.stringify(o));
{
  const r = chk(sample);
  if (r.errors.length) bad('サンプルのシナリオに誤り', r.errors);
  const expect = (name, f, re) => { const s = clone(sample); f(s); const x = chk(s); if (!x.errors.some(e => re.test(e.msg))) bad(name + 'が誤りにならない', x.errors); };
  expect('リストにいない敵', s => { s.stages[0].enemies[1].servant = 'いないはずの英霊'; }, /サーヴァントリストにいません/);
  expect('リストにいないボス', s => { s.stages[1].boss.servant = 'いないはずの魔神'; }, /サーヴァントリストにいません/);
  expect('リストにいないはぐれ', s => { s.stray.servant = 'いないはずの射手'; }, /サーヴァントリストにいません/);
  expect('リストにいない候補', s => { s.stages[0].enemies[0].from = ['いないはずの英霊']; }, /サーヴァントリストにいません/);
  expect('敵の key の重なり', s => { s.stages[1].enemies[0].key = 'king'; }, /重なっています/);
  expect('期限の外の日', s => { s.stages[0].enemies[1].day = 99; }, /現れる日/);
  expect('無い敵 key の出来事', s => { s.events.list[2].after = 'nobody'; }, /がありません/);
  expect('空の節', s => { s.stages[1].enemies = []; s.stages[1].boss = null; }, /敵もボスもいません/);
  expect('違う形式', s => { s.format = 'hgw-records'; }, /形式が違います/);
  // 同じ真名が何騎もいれば id での指定を求める
  const dup = roster.filter(s => !s.bossOnly).find(s => roster.some(t => t !== s && t.trueName === s.trueName && !t.bossOnly));
  if (dup) {
    const s = clone(sample); s.stages[0].enemies[1].servant = dup.trueName;
    if (!chk(s).errors.some(e => /id で指定/.test(e.msg))) bad('同じ真名が何騎もいるのに誤りにならない', dup.trueName);
    s.stages[0].enemies[1].servant = dup.id;
    if (chk(s).errors.length) bad('id で指定しても誤りになる', chk(s).errors);
  }
  // 同じ英霊と何度も戦うのは誤りではない
  const s2 = clone(sample); s2.stages[0].enemies.push({ key: 'again', pick: 'fixed', servant: 'ヴォーティマー' });
  if (chk(s2).errors.length) bad('同じ英霊を何度も出すと誤りになる', chk(s2).errors);
  if (!chk({}).errors.length) bad('空のシナリオが誤りにならない');
  if (chk(SC.blank()).errors.length) bad('ひな形が誤りになる', chk(SC.blank()).errors);
  // 誤りのあるシナリオは始められない
  try { const s = clone(sample); s.stray.servant = 'いないはずの射手'; H.original.run({ scenario: s, roster, bosses, seed: 'x' }); bad('誤りのあるシナリオで始まった'); } catch (e) { /* 期待どおり */ }
}

// ---------- 全自動 ----------
// サンプルのほか、既定の出来事なし・節の期限・襲ってくる敵だけ・ボスだけの節・はぐれが決まった日に現れる、などの変種でも回す
const variants = [['sample', sample]];
{
  const v = clone(sample); v.events.defaults = false; v.stages[0].days = 6; v.stray = { pick: 'random', appear: 'day', day: 2 };
  v.stages[0].enemies = [{ key: 'r1', pick: 'random', count: 2, meet: 'raid' }]; v.events.list[2].after = 'r1';
  variants.push(['variant', v]);
  const w = SC.blank(); w.title = 'ボスだけ'; w.days = 20; w.party.size = 3; w.party.front = 2; w.stages = [{ name: '玉座', enemies: [], boss: { pick: 'random', gauges: 2 } }, { name: '奥の院', enemies: [{ pick: 'random', count: 1, meet: 'day', day: 15 }] }];
  variants.push(['bossOnly', w]);
}
for (const [name, scn] of variants) {
  if (chk(scn).errors.length) { bad(name + 'に誤り', chk(scn).errors); continue; }
  const ends = { clear: 0, wipe: 0, master: 0, timeout: 0 }, days = [], stage = [];
  let errs = 0, strays = 0;
  for (let i = 0; i < N; i++) {
    let r;
    try { r = H.original.run({ scenario: scn, roster, bosses, seed: name + i }); } catch (e) { errs++; if (errs < 4) console.error(e); continue; }
    ends[r.ending]++; days.push(r.days); stage.push(r.stageReached); strays += r.strayJoined ? 1 : 0;
    if (r.ending === 'clear' && r.bosses.some(b => b.alive)) bad(name, 'ボスが生きているのに成功', 'seed', name + i);
    if (r.enemies.some(c => c.stage === r.stages - 1 && c.alive) && r.ending === 'clear') bad(name, '敵が残っているのに成功');
  }
  if (errs) bad(name, 'エラー', errs);
  const ok = Math.max(1, N - errs), pct = x => (x / ok * 100).toFixed(1) + '%';
  days.sort((a, b) => a - b);
  console.log({ scenario: name, n: N, errs, clear: pct(ends.clear), wipe: pct(ends.wipe), master: pct(ends.master), timeout: pct(ends.timeout),
    daysMedian: days[days.length >> 1], stageAvg: (stage.reduce((t, x) => t + x, 0) / ok).toFixed(2), strayJoin: pct(strays) });
}

// ---------- 文面の差し替え ----------
{
  const v = clone(sample);
  v.lines = { ogTitle: ['【差し替えた見出し】{name}'], downNP: ['《宝具で倒れた》{c}'], blow: ['《とどめ》{c}'], downNPEarlier: ['《宝具のあと》{c}'], downInstakill: ['《即死》{c}'], downMutual: ['《相討ち》{c}'], guts: ['《踏みとどまり》{S}'] };
  let seenTitle = 0, deaths = 0, plain = 0;
  for (let i = 0; i < 20; i++) {
    const r = H.original.run({ scenario: v, roster, bosses, seed: 'ln' + i });
    if (r.entries.some(e => e.text === '【差し替えた見出し】' + v.title)) seenTitle++;
    for (const e of r.entries) if (e.kind === 'death' && e.fin) { deaths++; if (!/^《/.test(e.text)) plain++; }
  }
  if (seenTitle !== 20) bad('見出しが差し替わらない', seenTitle);
  if (!deaths || plain) bad('消滅の文が差し替わらない', { deaths, plain });
  // 個別の名乗り（決まった日に現れる敵）と、自作の出来事の文
  const r = H.original.run({ scenario: sample, roster, bosses, seed: 'ln0' });
  if (!r.entries.some(e => /竜の気配をまとった霧の竜王/.test(e.text))) bad('敵ごとの名乗りが出ない');
  if (!r.entries.some(e => /渡し守/.test(e.text))) bad('日の決まった出来事が起きない');
}

// ---------- 対話式の再現 ----------
const FOC = Object.keys(H.original.FOCUS);
let mismatch = 0, ierr = 0, asks = 0, oevent = 0;
function play(scn, seed, master, pickAns, pickTick) {
  const out = {}, n = SC.normalize(scn), L = H.original.compose({ scenario: n, roster, bosses, seed });
  const g = H.original.gen({ scenario: scn, roster, bosses, seed, lineup: L, master, ask: 'big', out });
  let r = g.next(); const log = [];
  while (!r.done) {
    if (r.value.type === 'tick') { const t = pickTick(r.value.day, out); log.push(t); r = g.next(t); }
    else { asks++; if (r.value.kind === 'oevent') oevent++; const k = pickAns(r.value); log.push(k); r = g.next(k); }
  }
  return { res: r.value, log };
}
const IN = Math.min(40, N);
for (let i = 0; i < IN; i++) {
  try {
    const scn = variants[i % variants.length][1], master = i % 2 ? { name: '試験 太郎', sex: '男', age: 20 + i, stats: { mana: 'A' } } : null;
    let k = 0;
    const tick = (d, out) => {
      const cmds = [];
      if (d % 7 === 3) cmds.push({ k: 'heal', t: i % 3 });
      if (d % 11 === 5) cmds.push({ k: 'mana' });
      const last = out.entries && out.entries.length ? out.entries[out.entries.length - 1].snap : null;
      const foe = last && last.c.find(c => c.side === 'foe' && c.alive && c.seen && !c.name);
      if (foe && d % 2) cmds.push({ k: 'guess', t: foe.id, sv: roster[(i * 13 + d) % roster.length].id });
      return { f: FOC[(i + Math.floor(d / 3)) % FOC.length], cmds };
    };
    const a = play(scn, 'oi' + i, master, q => q.options[(i * 5 + k++) % q.options.length].k, tick);
    let j = 0;
    const b = play(scn, 'oi' + i, master, () => a.log[j++], () => a.log[j++]);
    if (JSON.stringify(a.res.entries.map(e => e.text)) !== JSON.stringify(b.res.entries.map(e => e.text)) || a.res.ending !== b.res.ending) mismatch++;
    if (master && a.res.master !== '試験 太郎') bad('プレイヤーのマスター名が使われない', a.res.master);
  } catch (e) { ierr++; if (ierr < 4) console.error(e); }
}
console.log({ interactive: IN, ierr, mismatch, asksPerRun: (asks / IN / 2).toFixed(1), oevent });
if (!oevent) bad('自作の出来事の選択肢が問われない');
if (ierr || mismatch) bad('対話式', { ierr, mismatch });

// 特異点・聖杯戦争にシナリオの文面が漏れない（og* の既定の文はエンジンの既定の文と別のキー）
{
  const w = H.engine.runWar({ roster, seed: 'leak0' });
  if (w.entries.some(e => /^《/.test(e.text))) bad('聖杯戦争に差し替えた文面が漏れた');
}
if (fail) { console.error('NG', fail); process.exitCode = 1; } else console.log('OK');
