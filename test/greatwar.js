// 聖杯大戦の確認：node test/greatwar.js [回数] [シード頭] [--days=30,40,50] [--log=シード]
//   規定日数を決めるための終結率（どちらかの色が全滅した割合）、移行のようす、エラーの有無、再現性を見る
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
for (const f of ['config', 'rank', 'parser', 'effects', 'fgoskills', 'build', 'master', 'war', 'names', 'scenes', 'personas', 'engine']) require(path.join(ROOT, 'js', f + '.js'));
const H = globalThis.HGW;
const args = process.argv.slice(2), nums = args.filter(a => !a.startsWith('--'));
const N = +nums[0] || 300, seed0 = nums[1] || 'gw';
const opt = k => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : null; };
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/servants.json'), 'utf8'));
const ov = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/overrides.json'), 'utf8'));
for (const [k, t] of Object.entries(H.effects.OVERRIDE_TABLES)) if (ov[k]) Object.assign(t, ov[k]);
const roster = data.servants.map(s => H.build.fromJSON(s)).filter(s => s && s.score && !s.bossOnly);

if (opt('log')) {
  const r = H.engine.runWar({ roster, seed: opt('log'), player: 'none', greatWar: true, engine: { maxDays: H.CONFIG.GREAT_WAR.days } });
  for (const e of r.entries) console.log(`[${e.day}${e.phase[0]}:${e.kind}] ${e.text}`);
  console.log(r.ending, r.sideWinner, r.shiftDay);
  process.exit(0);
}
const med = a => { a = a.slice().sort((x, y) => x - y); return a.length ? a[a.length >> 1] : 0; };
let errors = 0;
for (const d of (opt('days') || '30,40,50').split(',').map(Number)) {
  const end = {}, settled = [], left = [], ruler = { raid: 0, dead: 0 }, sides = [0, 0];
  let decided = 0, turn = 0;
  for (let i = 0; i < N; i++) {
    try {
      const r = H.engine.runWar({ roster, seed: seed0 + i, player: 'none', greatWar: true, engine: { maxDays: d } });
      const cs = r.camps.filter(c => !c.overseer);
      if (cs.length !== 14) throw new Error('14騎でない');
      if (cs.some(c => c.servantId.startsWith('ruler:'))) throw new Error('ルーラーが陣営にいる');
      if (new Set(cs.map(c => c.servantId)).size !== 14) throw new Error('英霊が重なっている');
      end[r.ending] = (end[r.ending] || 0) + 1;
      if (r.sideWinner != null) { decided++; sides[r.sideWinner]++; settled.push(r.shiftDay != null ? r.shiftDay : r.days); }
      else if (r.ending === 'wipe') decided++;
      for (const e of r.entries) {
        if (e.kind === 'ally' && /色を捨て|味方を裏切/.test(e.text)) turn++;
        if (e.kind === 'event' && /教会へ押し入|裁定者を邪魔/.test(e.text)) ruler.raid++;
        if (e.kind === 'world' && /騎の聖杯戦争が始まる/.test(e.text)) left.push(+e.text.match(/(\d+)騎の聖杯戦争/)[1]);
      }
      if (r.camps.some(c => c.overseer && !c.alive)) ruler.dead++;
    } catch (e) { errors++; console.log('error', seed0 + i, e.stack); }
  }
  console.log(`${d}日: 終結率 ${(decided / N * 100).toFixed(1)}%（決着日の中央値 ${med(settled)}）色の勝ち ${sides.join(':')} 移行時の生き残り中央値 ${med(left)} 結末 ${JSON.stringify(end)} 寝返り/戦 ${(turn / N).toFixed(2)} 襲撃 ${ruler.raid} 監督役討死 ${ruler.dead}`);
}
// 再現性：同じ決断と方針で同じ戦争になるか
let mismatch = 0;
for (let i = 0; i < Math.min(N, 40); i++) {
  const run = ans => {
    const g = H.engine.warGen({ roster, seed: 'gwr' + i, ask: 'big', greatWar: true, engine: { maxDays: H.CONFIG.GREAT_WAR.days } }), log = [];
    let r = g.next(), n = 0;
    while (!r.done) {
      let a;
      if (r.value.type === 'tick') a = 'auto';
      else { a = ans ? ans[log.length] : r.value.options[(n++) % r.value.options.length].k; log.push(a); }
      r = g.next(a);
    }
    return { log, t: r.value.entries.map(e => e.text).join('\n') };
  };
  const a = run(), b = run(a.log);
  if (a.t !== b.t) mismatch++;
}
console.log(`errors ${errors} mismatch ${mismatch}`);
process.exit(errors || mismatch ? 1 : 0);
