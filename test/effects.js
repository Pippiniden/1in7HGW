// 効果の部品（effects.js の EFFECTS）がゲームに届いているかを確かめる
// 使い方: node test/effects.js
//  1) どの部品も、エンジン（engine.js）か組み立て（build.js）のどこかで読まれている（読まれない部品は「反映されない」）
//  2) どの部品にも「誰に掛かるか・何が起きるか」の説明（EFFECT_INFO）がある
//  3) 宝具の効果：戦いの効果は使ったときだけ、昼・偵察などの効果は持っているだけで働く
//  4) 真名・クラスの手直し（CONTENT_OVERRIDES[Wikiの真名].identity）：組み立てると変わり、書き出すと Wiki の値に戻る
for (const f of ['config', 'rank', 'parser', 'effects', 'fgoskills', 'build', 'master', 'war', 'names', 'scenes', 'personas', 'engine']) require('../js/' + f + '.js');
const fs = require('fs'), H = HGW, E = H.effects, B = H.build;
let fail = 0;
const ok = (cond, msg) => { if (!cond) { fail++; console.error('NG:', msg); } };

// 1) 読まれているか（eff(c, 'id') などの形で名前が出てくるか）
const src = ['engine.js', 'build.js'].map(f => fs.readFileSync(__dirname + '/../js/' + f, 'utf8')).join('\n');
for (const id of Object.keys(E.EFFECTS)) ok(new RegExp(`['"]${id}['"]`).test(src), `効果「${E.EFFECTS[id].name}」（${id}）をエンジンも組み立ても読んでいない`);

// 2) 説明
for (const [id, d] of Object.entries(E.EFFECTS)) {
  const inf = E.EFFECT_INFO[id];
  ok(inf && E.WHO_JA[inf.who], `効果「${d.name}」（${id}）に、誰に掛かるかが無い`);
  const r = E.describe(E.instantiate([id, 1, id === 'master_buff' ? { stat: 'luck' } : id.endsWith('_vs') || id === 'weakness' || id === 'tag' ? { tag: '竜' } : null], H.rank.parseRank('B'), 'x', 'spec'), {});
  ok(r.text && !/undefined|NaN/.test(r.text), `効果「${d.name}」の説明が組めない：${r.text}`);
}
ok(/相手/.test(E.describe({ id: 'debuff', mag: 0.1 }).whoJa) && E.describe({ id: 'upkeep_up', mag: 0.3 }).bad && !E.describe({ id: 'guard', mag: 0.1 }).bad && E.describe({ id: 'guard', mag: -0.1 }).bad, '有利・不利の見分けが違う');

// 3) 宝具の効果の働く場面
const np = { id: 'territory', mag: 0.2 }, np2 = { id: 'instakill', mag: 0.1 };
ok(!E.npOnUse(np) && E.npOnUse(np2) && E.npOnUse({ id: 'np_boost', mag: 0.1 }) && E.npOnUse({ id: 'uncontrolled', mag: 0.1 }), '宝具の効果の働く場面の分け方が違う');
const lucan = B.importServant(fs.readFileSync(__dirname + '/lucan.txt', 'utf8'));
const t = JSON.parse(JSON.stringify(lucan)); t.nps[0].effects = [Object.assign({}, np, { from: 'x' }), Object.assign({}, np2, { from: 'x' })];
const sum = B.summarize(t);
ok(sum.territory.passive === 0.2 && sum.instakill.onNP === 0.1, '宝具の効果の集計（常時／使ったとき）が違う：' + JSON.stringify(sum));

// 4) 真名・クラスの手直し
E.CONTENT_OVERRIDES[lucan.trueName] = { identity: { trueName: 'ルーカン卿', cls: 'セイバー' } };
E.STAT_OVERRIDES['ルーカン卿'] = { str: 'A' };
const r = B.fromJSON(B.toLean(lucan));
ok(r.trueName === 'ルーカン卿' && r.class.key === 'saber' && r.id === 'saber:ルーカン卿' && (r.contentEdited || []).includes('identity'), '真名・クラスが変わっていない：' + r.id);
ok(r.ranks.str.base === 'A', '直した真名でステータスの手直しが引けていない');
ok(B.wikiName(r) === lucan.trueName && B.wikiId(r) === lucan.id, 'Wikiでの真名・id が分からない');
const lean = B.toLean(r);
ok(lean.trueName === lucan.trueName && lean.id === lucan.id && lean.class.key === lucan.class.key, '書き出すと Wiki の値に戻っていない：' + lean.id);
const exp = JSON.parse(JSON.stringify(r)); delete E.CONTENT_OVERRIDES[lucan.trueName];
B.harvestOverrides([exp]);
ok(JSON.stringify((E.CONTENT_OVERRIDES[lucan.trueName] || {}).identity) === JSON.stringify({ trueName: 'ルーカン卿', cls: 'セイバー' }), '書き出したJSONから真名・クラスの手直しを戻せない');
delete E.CONTENT_OVERRIDES[lucan.trueName]; delete E.STAT_OVERRIDES['ルーカン卿'];

console.log(fail ? `NG ${fail}件` : `OK：効果の部品 ${Object.keys(E.EFFECTS).length}種がすべてゲームに届き、説明がある／真名・クラスの手直し`);
process.exitCode = fail ? 1 : 0;
