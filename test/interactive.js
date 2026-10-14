// 対話式の流れを、ランダムな選択で大量に試す
for (const f of ["config","rank","parser","effects","build","master","war","names","engine"]) require("../js/"+f+".js");
const fs = require('fs');
const raw = JSON.parse(fs.readFileSync(__dirname + '/../data/servants.json', 'utf8')).servants;
const roster = raw.map(HGW.build.fromJSON);
const n = +(process.argv[2] || 200);
const kinds = {}; let asks = 0, errs = 0;
for (let i = 0; i < n; i++) {
  for (const level of ['often', 'sometimes']) {
    try {
      const out = {}; const g = HGW.engine.warGen({ roster, seed: 'i' + i, ask: level, out });
      let r = g.next(), k = 0, seq = [];
      while (!r.done) {
        asks++; kinds[r.value.kind] = (kinds[r.value.kind] || 0) + 1;
        const o = r.value.options; const ch = o[(i * 7 + k++) % o.length].k; seq.push(ch);
        r = g.next(ch);
      }
      // 同じ選択で再現できるか
      if (level === 'sometimes' && i < 40) {
        const out2 = {}; const g2 = HGW.engine.warGen({ roster, seed: 'i' + i, ask: level, out: out2 });
        let r2 = g2.next(), j = 0; while (!r2.done) r2 = g2.next(seq[j++]);
        if (JSON.stringify(r2.value.camps) !== JSON.stringify(r.value.camps)) console.log('replay mismatch', i);
      }
    } catch (e) { errs++; if (errs < 4) console.error(e); }
  }
}
console.log({ wars: n * 2, errs, asksPerWar: (asks / n / 2).toFixed(1), kinds });
