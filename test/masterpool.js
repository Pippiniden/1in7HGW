// 登録マスターの使い方（warGen の masters + masterMode）：random は使わない／mix は含める／only は尽きるまで必ず使う
//   node test/masterpool.js [N]
for (const f of ["config","rank","parser","effects","fgoskills","build","master","war","names","scenes","personas","engine"]) require("../js/"+f+".js");
const fs = require('fs');
const man = JSON.parse(fs.readFileSync(__dirname + '/../data/manifest.json', 'utf8'));
for (const f of man.overrides) { const o = JSON.parse(fs.readFileSync(__dirname + '/../data/' + f, 'utf8')); const E = HGW.effects; Object.assign(E.SKILL_OVERRIDES, o.global || {}); Object.assign(E.SERVANT_OVERRIDES, o.servant || {}); Object.assign(E.STAT_OVERRIDES, o.stats || {}); Object.assign(E.NP_OVERRIDES, o.np || {}); Object.assign(E.CONTENT_OVERRIDES, o.content || {}); }
let raw = []; for (const f of man.servants) raw.push(...JSON.parse(fs.readFileSync(__dirname + '/../data/' + f, 'utf8')).servants);
const roster = raw.map(HGW.build.fromJSON);
const N = +process.argv[2] || 30;

const POOL = ['登録 一', '登録 二', '登録 三', '登録 四'].map((name, i) => ({ name, origin: i % 2 ? 'noble' : 'mercenary', stats: { mana: 'B' } }));
const run = (seed, masters, masterMode, gw) => {
  const out = {}; const g = HGW.engine.warGen({ roster, seed, player: 1, ask: 'big', out, masters: masters && masters.slice(), masterMode, greatWar: gw || undefined });
  let r = g.next(); while (!r.done) r = g.next('auto');
  return { r: r.value, out };
};
const shape = o => JSON.stringify(o.out.entries.map(e => [e.kind, e.day, e.text]));
const used = o => Object.values(o.out.meta).filter(m => m && m.master && /^登録 /.test(m.master.name)).length;
let fail = 0, mixUsed = 0, camps = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.error('NG', msg); } };

for (let i = 0; i < N; i++) {
  const seed = 'mp' + i;
  const none = run(seed), rnd = run(seed, POOL, 'random'), mix = run(seed, POOL, 'mix'), only = run(seed, POOL, 'only');
  // random は登録マスターを渡さないのと同じ展開
  check(shape(none) === shape(rnd) && used(rnd) === 0, 'random differs from no pool ' + seed);
  // 既定（masterMode なし）は mix と同じ
  check(shape(mix) === shape(run(seed, POOL)), 'default is not mix ' + seed);
  // only は登録マスターを全員使う（七騎 > 4人）
  check(used(only) === POOL.length, 'only used ' + used(only) + ' ' + seed);
  // 同じ設定なら同じ展開
  check(shape(only) === shape(run(seed, POOL, 'only')) && shape(mix) === shape(run(seed, POOL, 'mix')), 'replay mismatch ' + seed);
  mixUsed += used(mix); camps += Object.keys(mix.out.meta).length;
}
// ランダムのマスターの割合（masterRandom）：0.5 は既定と同じ、少ないほど登録マスターが増える
{
  const runR = (seed, r) => { const out = {}; const g = HGW.engine.warGen({ roster, seed, player: 1, ask: 'big', out, masters: POOL.slice(), masterMode: 'mix', masterRandom: r }); let x = g.next(); while (!x.done) x = g.next('auto'); return { r: x.value, out }; };
  let lo = 0, hi = 0;
  for (let i = 0; i < N; i++) {
    const seed = 'mr' + i;
    check(shape(runR(seed, 0.5)) === shape(run(seed, POOL, 'mix')), 'masterRandom 0.5 differs from default ' + seed);
    lo += used(runR(seed, 0.1)); hi += used(runR(seed, 0.9));
  }
  check(lo > hi, `ランダムの割合を下げても登録マスターが増えない（10%: ${lo} / 90%: ${hi}）`);
  console.log(`masterRandom 10%: 登録マスター ${lo} 席 / 90%: ${hi} 席`);
}
// 大戦でも only は全員使う
{ const g = run('mpgw', POOL, 'only', true); check(used(g) === POOL.length, 'great war only used ' + used(g)); }

// 登録マスターのセリフ（MASTER_VOICE_SLOTS）：喋っても展開は変わらず、場面ごとに出てくる
const VOICE = Object.fromEntries(HGW.MASTER_VOICE_SLOTS.map(s => [s.key, ['「' + s.key + 'のテスト」']]));
VOICE['令呪2'] = ['「番号付きの令呪」'];
const POOL_V = POOL.map(m => Object.assign({}, m, { voice: VOICE }));
const outcome = o => JSON.stringify([o.r.winner, o.r.ending, o.out.entries.map(e => [e.kind, e.day, e.ids])]);
check(HGW.masterVoiceLines({ voice: VOICE }, '令呪').length === 2, '番号付きの見出しを読めていない');
const heard = {};
let mq = 0;
for (let i = 0; i < N; i++) {
  const seed = 'mv' + i;
  const a = run(seed, POOL, 'only'), b = run(seed, POOL_V, 'only');
  check(outcome(a) === outcome(b), 'master voice changed outcome ' + seed);
  check(shape(b) === shape(run(seed, POOL_V, 'only')), 'voice replay mismatch ' + seed);
  for (const e of b.out.entries) if (e.quote && e.quote.master) {
    mq++; const k = (e.quote.text.match(/「(.+?)のテスト」/) || [])[1] || '令呪'; heard[k] = (heard[k] || 0) + 1;
    check(/^登録 /.test(e.quote.who), 'speaker is not a registered master: ' + e.quote.who);
    if (e.kind === 'cs') check(!/令呪をもって命ずる/.test(e.text), 'chant left in seal text: ' + e.text);
  }
  check(!a.out.entries.some(e => e.quote && e.quote.master), 'master without voice spoke ' + seed);
}
for (const k of ['令呪（撤退）', '脱落', '同盟']) check(heard[k] > 0, `場面「${k}」のセリフが一度も出ていない`);
console.log(`wars ${N}  mix: 登録マスター ${mixUsed}/${camps} 席  マスターのセリフ ${mq} 回 ${JSON.stringify(heard)}  fail ${fail}`);
process.exit(fail ? 1 : 0);
