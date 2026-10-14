// 使い方: node test/sim.js [回数] [シードを1つ表示]
for (const f of ["config","rank","parser","effects","build","master","war","names","engine"]) require("../js/"+f+".js");
const fs = require('fs');
const man = JSON.parse(fs.readFileSync(__dirname + '/../data/manifest.json', 'utf8'));
for (const f of man.overrides) { const o = JSON.parse(fs.readFileSync(__dirname + '/../data/' + f, 'utf8')); const E = HGW.effects; Object.assign(E.SKILL_OVERRIDES, o.global || {}); Object.assign(E.SERVANT_OVERRIDES, o.servant || {}); Object.assign(E.STAT_OVERRIDES, o.stats || {}); Object.assign(E.NP_OVERRIDES, o.np || {}); }
let raw = []; for (const f of man.servants) raw.push(...JSON.parse(fs.readFileSync(__dirname + '/../data/' + f, 'utf8')).servants);
const roster = raw.map(HGW.build.fromJSON);
const n = +(process.argv[2] || 500), show = process.argv[3];
if (show) {
  const w = HGW.engine.runWar({ roster, seed: show });
  for (const e of w.entries) console.log(`[${e.day}${e.phase[0]}] ${e.kind.padEnd(8)} ${e.you ? '★' : ' '} ${e.text}${e.quote ? '  「' + e.quote.text + '」' : ''}`);
  console.log(w.camps.map(c => `${c.label} ${c.trueName} / ${c.master}: ${c.fate ? c.fate.day + '日 ' + c.fate.text : '-'}`).join('\n'));
  process.exit(0);
}
const wins = {}, apps = {}, days = [], ends = { win: 0, none: 0, draw: 0 }; let entries = 0, errors = 0, npTot = 0, battles = 0, cs = 0, recon = 0, ally = 0, ambush = 0;
for (let i = 0; i < n; i++) {
  let w; try { w = HGW.engine.runWar({ roster, seed: 's' + i }); } catch (e) { errors++; if (errors < 3) console.error(e); continue; }
  days.push(w.days); entries += w.entries.length;
  for (const c of w.camps) { apps[c.trueName] = (apps[c.trueName] || 0) + 1; npTot += c.npUses; battles += c.battles; }
  if (w.winner != null) { ends.win++; const t = w.camps[w.winner].trueName; wins[t] = (wins[t] || 0) + 1; } else if (w.camps.some(c => c.alive)) ends.draw++; else ends.none++;
  cs += w.entries.filter(e => e.kind === 'cs').length; recon += w.entries.filter(e => /再契約/.test(e.text)).length; ally += w.entries.filter(e => e.kind === 'ally' && /同盟だ/.test(e.text)).length; ambush += w.entries.filter(e => /奇襲/.test(e.text)).length;
}
days.sort((a, b) => a - b);
console.log({ n, errors, ends, daysMedian: days[days.length >> 1], daysP10: days[Math.floor(days.length * 0.1)], daysP90: days[Math.floor(days.length * 0.9)], entriesAvg: Math.round(entries / n), npPerWar: (npTot / n).toFixed(1), battlesPerWar: (battles / 2 / n).toFixed(1), csPerWar: (cs / n).toFixed(2), reconPerWar: (recon / n).toFixed(2), allyPerWar: (ally / n).toFixed(2), ambushPerWar: (ambush / n).toFixed(2) });
const rate = Object.keys(apps).map(k => [k, (wins[k] || 0) / apps[k], apps[k]]).sort((a, b) => b[1] - a[1]);
console.log(rate.map(([k, r, a]) => `${k}:${Math.round(r * 100)}%`).join('  '));
