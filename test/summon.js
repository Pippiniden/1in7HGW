// 軍勢召喚（summon）：同盟に空きがあるときだけ、戦いの間だけの味方が現れ、加勢して一撃を受け止める
// 使い方: node test/summon.js [戦争の数]
for (const f of ['config', 'rank', 'parser', 'effects', 'fgoskills', 'build', 'master', 'war', 'names', 'scenes', 'personas', 'engine']) require('../js/' + f + '.js');
const fs = require('fs');
const H = HGW, E = H.effects, B = H.build;
const N = +process.argv[2] || 60;
const roster = JSON.parse(fs.readFileSync(__dirname + '/../data/servants.json', 'utf8')).servants.map(B.fromJSON).filter(s => !s.bossOnly);
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.error('NG:', m); } };

// 宝具を1つ持つ騎に、補助宝具として軍勢召喚を付ける
const base = roster.find(s => (s.nps || []).length && !s.nps[0].disabled);
const np = base.nps[0], key = E.okey(base) + '/' + E.normName(np.name);
E.SERVANT_OVERRIDES[key] = [['summon', 1.5, { tag: '無双の軍勢' }]];
E.NP_OVERRIDES[key] = { attack: false };
const me = B.fromJSON(B.toLean(base));
delete E.SERVANT_OVERRIDES[key]; delete E.NP_OVERRIDES[key];
const mine = me.nps[0];
ok(!mine.attackResolved && (mine.effects || []).some(e => e.id === 'summon' && e.mag > 0), '軍勢召喚の宝具ができていない');
ok(E.describe(mine.effects.find(e => e.id === 'summon'), { np: true }).text.includes('同盟に空き'), '説明が読めない');
ok(E.describe({ id: 'summon', mag: -1, params: null }, { np: true }).text.length > 0, 'マイナスの説明が読めない');

const others = roster.filter(s => s.id !== base.id).slice(0, 6);
const seven = [me].concat(others);
let appear = 0, none = 0, block = 0, gone = 0, errors = 0;
for (let i = 0; i < N; i++) {
  try {
    const r = H.engine.runWar({ roster: seven, seed: 'sm' + i, player: 'none', war: { pick: 'open' }, intrude: { on: false } });
    for (const e of r.entries) {
      if (/無双の軍勢が現れた/.test(e.text)) appear++;
      if (/同盟に空きが無く/.test(e.text)) none++;
      if (/無双の軍勢が.*受け止めた/.test(e.text)) block++;
      if (/無双の軍勢は霧散した/.test(e.text)) gone++;
    }
    // 再現：同じ種なら同じ展開
    if (i < 5) { const r2 = H.engine.runWar({ roster: seven, seed: 'sm' + i, player: 'none', war: { pick: 'open' }, intrude: { on: false } }); ok(r.entries.map(e => e.text).join('#') === r2.entries.map(e => e.text).join('#'), '同じ種で展開が変わった'); }
  } catch (e) { errors++; console.error(e.stack); }
}
ok(!errors, 'エラー ' + errors);
ok(appear > 0, '軍勢が一度も現れなかった');
ok(block > 0, '軍勢が一撃を受け止めたことが一度も無い');
// 同盟が上限のとき（三者同盟）は、軍勢を呼ぶだけの宝具は使われない（現れない記録が出ない）
ok(none === 0, '空きが無いのに宝具が使われた：' + none);
console.log(fail ? `NG ${fail}件` : `OK：軍勢召喚 ${N}戦で 出現${appear}・受け止め${block}・霧散${gone}／同盟に空きが無いとき使われない／展開は再現する`);
process.exitCode = fail ? 1 : 0;
