// 使い方: node test/rebuild.js <書き出したJSONのフォルダ> [出力先]
for (const f of ["config","rank","parser","effects","fgoskills","build","master","war"]) require("../js/"+f+".js");
const fs = require('fs'), path = require('path');
const dir = process.argv[2], out = process.argv[3];
let list = [];
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  list.push(...(Array.isArray(d) ? d : d.servants || [d]));
}
const harvested = HGW.build.harvestOverrides(list);
const L = HGW.rank.label;
const built = list.map(HGW.build.fromJSON).sort((a, b) => a.class.key.localeCompare(b.class.key) || a.trueName.localeCompare(b.trueName));
const fmt = e => e.name + (e.params ? '〔' + Object.values(e.params).join('/') + '〕' : '') + '=' + e.mag;
if (process.env.QUIET !== '1') for (const s of built) {
  console.log(`== ${s.class.label} ${s.trueName}  P=${s.power} NP=${s.npPeak}`);
  for (const k of s.allSkills) console.log(`   S ${k.name} ${L(k.rank)} <${k.effectSource}${k.matched ? ':' + k.matched : ''}> ${k.effects.map(fmt).join(', ')}`);
  for (const n of s.nps) console.log(`   N 「${n.name}」${n.reading ? '(' + n.reading + ')' : ''} ${L(n.rank)} ${n.typeKey} ${n.disabled ? 'DISABLED' : n.attackResolved ? 'ATK ' + n.power : 'SUP'} cost=${n.cost} <${n.effectSource}${n.matched ? ':' + n.matched : ''}> ${n.effects.map(fmt).join(', ')}`);
  for (const a of s.statsAlt) console.log(`   ALT ${a.label}: ${Object.entries(a.stats).map(([k, v]) => k + '=' + L(v.rank)).join(' ')}`);
}
console.log('harvested overrides:', harvested, JSON.stringify({ g: HGW.effects.SKILL_OVERRIDES, s: HGW.effects.SERVANT_OVERRIDES }));
if (out) fs.writeFileSync(out, JSON.stringify({ format: 'hgw-servants', version: 2, at: new Date().toISOString(), servants: built }, null, 1));
module.exports = built;
