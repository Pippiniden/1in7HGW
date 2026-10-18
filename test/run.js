for (const f of ["config","rank","parser","effects","fgoskills","master","build"]) { try { require("../js/"+f+".js"); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; } }
const L=HGW.rank.label, fs=require('fs');
for (const f of process.argv.slice(2)) {
  const sv=HGW.parser.parseServant(fs.readFileSync(f,"utf8"));
  console.log("==", f, sv.trueName, sv.class.key, sv.class.sub);
  console.log(" stats", Object.entries(sv.stats).map(([k,v])=>k+"="+L(v.rank)+"("+v.rank.score+")").join(" "));
  for (const a of sv.statsAlt) console.log(" alt["+a.label+"]", Object.entries(a.stats).map(([k,v])=>k+"="+L(v.rank)).join(" "));
  for (const s of sv.classSkills.concat(sv.skills)) console.log(" skill", s.name, "|", L(s.rank));
  for (const n of sv.nps) console.log(" np", n.name, "|", L(n.rank), n.typeKey, n.range, n.maxTargets);
  console.log(" warn", sv.warnings);
}
