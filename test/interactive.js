// 対話式の流れを、ランダムな重点と選択で大量に試す（再現性も確認）
for (const f of ["config","rank","parser","effects","build","master","war","names","scenes","engine"]) require("../js/"+f+".js");
const fs = require('fs');
const raw = JSON.parse(fs.readFileSync(__dirname + '/../data/servants.json', 'utf8')).servants;
const roster = raw.map(HGW.build.fromJSON);
const FOCI = Object.keys(HGW.engine.FOCUS);
const n = +(process.argv[2] || 200);
const kinds = {}; let asks = 0, errs = 0, mismatch = 0;
function play(seed, pickAns, pickFocus) {
  const out = {}; const g = HGW.engine.warGen({ roster, seed, ask: 'big', out });
  let r = g.next(), log = [];
  while (!r.done) {
    const q = r.value;
    if (q.type === 'tick') { const f = pickFocus(q.day); log.push({ t: f }); r = g.next(f); }
    else { asks++; kinds[q.kind] = (kinds[q.kind] || 0) + 1; const k = pickAns(q); log.push(k); r = g.next(k); }
  }
  return { res: r.value, log };
}
for (let i = 0; i < n; i++) {
  try {
    let k = 0;
    const a = play('i' + i, q => q.options[(i * 7 + k++) % q.options.length].k, d => FOCI[(i + Math.floor(d / 4)) % FOCI.length]);
    if (i < 50) {
      const ans = a.log.filter(x => typeof x === 'string'); let j = 0;
      const b = play('i' + i, () => ans[j++], d => FOCI[(i + Math.floor(d / 4)) % FOCI.length]);
      if (JSON.stringify(a.res.camps) !== JSON.stringify(b.res.camps)) mismatch++;
    }
  } catch (e) { errs++; if (errs < 4) console.error(e); }
}
console.log({ wars: n, errs, mismatch, asksPerWar: (asks / n).toFixed(1), kinds });
