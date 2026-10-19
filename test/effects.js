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

// 5) 効果の条件（params.cond／vs／chance）：説明・見積もり・エンジン
{
  const d = E.describe({ id: 'power', mag: 0.2, params: { cond: '拠点', vs: '竜', chance: 0.3 } });
  ok(/拠点/.test(d.when) && /「竜」の相手/.test(d.when) && /30%/.test(d.when), '条件の説明が出ていない：' + d.when);
  ok(E.hasCond({ chance: 0.5 }) && !E.hasCond({ chance: 1 }) && !E.hasCond({ tag: '竜' }), 'hasCond の見分けが違う');
  const roster = JSON.parse(fs.readFileSync(__dirname + '/../data/servants.json', 'utf8')).servants.map(B.fromJSON);
  const foe = roster.find(s => s.tags.includes('男性')), other = roster.find(s => !s.tags.includes('男性') && s.id !== foe.id);
  const me = B.fromJSON(B.toLean(roster.find(s => s.id !== foe.id && s.id !== other.id)));
  const withSpec = spec => { const key = me.trueName + '/' + E.normName(me.allSkills[0].name); E.SERVANT_OVERRIDES[key] = [spec]; const s = B.fromJSON(B.toLean(me)); delete E.SERVANT_OVERRIDES[key]; return s; };
  const plain = withSpec(['guard', 0.0001]), vsMale = withSpec(['power', 5, { vs: '男性' }]), half = withSpec(['power', 5, { chance: 0.5 }]), home = withSpec(['power', 5, { cond: '拠点' }]);
  const odds = (a, b, o) => B.battleOdds(a, b, o).a;
  ok(odds(vsMale, foe) > odds(plain, foe) * 1.2 && Math.abs(odds(vsMale, other) - odds(plain, other)) < 1e-9, '相手の属性の条件が見積もりに効いていない');
  ok(odds(half, other) > odds(plain, other) && odds(half, other) < odds(withSpec(['power', 5]), other), '発動確率が見積もりで強さ×確率になっていない');
  ok(Math.abs(odds(home, other) - odds(plain, other)) < 1e-9 && odds(home, other, { home: true }) > odds(plain, other, { home: true }), '拠点の条件が見積もりに効いていない');
  // エンジン：誰も持たない属性が条件の効果は、戦争の展開を変えない（判定に乱数を使わない）
  const ros = roster.filter(s => s.id !== me.id), sig = r => r.winner + ':' + r.days + ':' + r.entries.length;
  const ghost = withSpec(['power', 5, { vs: 'だれも持たない属性' }]);
  let same = true, errs = 0;
  for (let i = 0; i < 30; i++) {
    const a = H.engine.runWar({ roster: ros.concat([plain]), seed: 'cnd' + i }), g = H.engine.runWar({ roster: ros.concat([ghost]), seed: 'cnd' + i });
    if (sig(a) !== sig(g)) same = false;
    try { H.engine.runWar({ roster: ros.concat([half, home, withSpec(['guard', 2, { cond: '瀕死', chance: 0.4 }])]), seed: 'cnd' + i }); } catch (e) { errs++; console.error(e); }
  }
  ok(same, '誰も持たない属性が条件の効果で、戦争の展開が変わった');
  ok(!errs, '条件付きの効果を持つ英霊で戦争がエラーになった');
}

// 5b) 状態異常（毒・スタン・混乱・宝具封印）と名前・記録の文の差し替え
{
  const d = E.describe({ id: 'poison', mag: 0.3, params: { name: '火傷' } });
  ok(d.name === '火傷（毒）' && /「火傷」/.test(d.text), '状態異常の名前が説明に出ていない：' + d.name + ' / ' + d.text);
  const roster = JSON.parse(fs.readFileSync(__dirname + '/../data/servants.json', 'utf8')).servants.map(B.fromJSON);
  const base = roster[0], key = base.trueName + '/' + E.normName(base.allSkills[0].name);
  E.SERVANT_OVERRIDES[key] = [['stun', 5, { name: '石化', msg: '{S}の眼差しに、{O}の手足が石と化した。' }], ['poison', 5], ['confuse', 5], ['seal', 5]];
  const me = B.fromJSON(B.toLean(base)); delete E.SERVANT_OVERRIDES[key];
  ok(me.effectSummary['stun#石化'] && me.effectSummary['poison'], '状態異常が集計に入っていない：' + Object.keys(me.effectSummary).join(','));
  const ros = roster.filter(s => s.id !== base.id).concat([me]);
  const seen = { stun: 0, poison: 0, confuse: 0, seal: 0, tick: 0 }; let errs = 0;
  for (let i = 0; i < 60; i++) {
    let r; try { r = H.engine.runWar({ roster: ros, seed: 'ail' + i }); } catch (e) { errs++; console.error(e); continue; }
    for (const e of r.entries) {
      if (/手足が石と化した/.test(e.text)) seen.stun++;
      if (/毒/.test(e.text) && /蝕み始めた|冒された|回る/.test(e.text)) seen.poison++;
      if (/混乱/.test(e.text)) seen.confuse++;
      if (/宝具を封じ|真名解放が、何かに阻まれた/.test(e.text)) seen.seal++;
      if (/霊基を削っていく|じわじわと蝕む/.test(e.text)) seen.tick++;
      ok(!/\{[SON]\}/.test(e.text), '記録の文の差し込みが残っている：' + e.text);
    }
  }
  ok(!errs, '状態異常を持つ英霊で戦争がエラーになった');
  ok(seen.stun && seen.poison && seen.confuse && seen.seal && seen.tick, '状態異常が戦いで起きていない：' + JSON.stringify(seen));
  // 状態異常耐性：とても高ければ、ほぼ掛からない
  const gkey = roster[1].trueName + '/' + E.normName(roster[1].allSkills[0].name);
  E.SERVANT_OVERRIDES[gkey] = [['ail_guard', 10]]; const guard = B.fromJSON(B.toLean(roster[1])); delete E.SERVANT_OVERRIDES[gkey];
  ok(B.battleOdds(guard, me, {}).a > B.battleOdds(roster[1], me, {}).a, '状態異常耐性が見積もりに効いていない');
}

// 5c) 先手の付いた宝具は、戦いの始めに切る（先手を取れたら、1回目の打ち合いの頭でその宝具を放つ）
{
  ok(/戦いの始め/.test(E.describe({ id: 'initiative', mag: 0.3 }, { np: true }).when), '宝具の先手の働く場面の説明が違う');
  const roster = JSON.parse(fs.readFileSync(__dirname + '/../data/servants.json', 'utf8')).servants.map(B.fromJSON);
  const base = roster.find(s => s.nps.some(n => n.attackResolved && !n.disabled) && !s.nps.some(n => (n.effects || []).some(e => e.id === 'initiative')));
  const np = base.nps.find(n => n.attackResolved && !n.disabled), key = base.trueName + '/' + E.normName(np.name);
  E.SERVANT_OVERRIDES[key] = [['initiative', 5]];
  const me = B.fromJSON(B.toLean(base)); delete E.SERVANT_OVERRIDES[key];
  const foe = roster.find(s => s.id !== base.id);
  ok(B.battleOdds(me, foe, { np: true }).a > B.battleOdds(base, foe, { np: true }).a && B.battleOdds(me, foe, {}).a === B.battleOdds(base, foe, {}).a, '宝具の先手が見積もり（宝具あり）に効いていない');
  const ros = roster.filter(s => s.id !== base.id).concat([me]);
  let opened = 0, fired = 0, errs = 0;
  for (let i = 0; i < 60; i++) {
    let r; try { r = H.engine.runWar({ roster: ros, seed: 'open' + i }); } catch (e) { errs++; console.error(e); continue; }
    const es = r.entries;
    es.forEach((e, j) => {
      if (!e.text.includes(`宝具『${np.name}』で先手を取った`)) return;
      opened++;
      const next = es.slice(j + 1).find(x => x.kind === 'np' || x.kind === 'death' || x.head);
      if (next && next.kind === 'np' && next.ids[0] === e.ids[0] && next.text.includes(np.name)) fired++;
    });
  }
  ok(!errs, '先手の宝具を持つ英霊で戦争がエラーになった');
  ok(opened > 0 && fired >= opened * 0.9, `先手を取った宝具が開幕に放たれていない（先手 ${opened}・開幕の宝具 ${fired}）`);
}

// 5d) 発動する効果（params.on・cost・uses）と、回復・吸収・解除などその場で働く効果
{
  // 説明と集計：発動する効果は常時に数えない
  ok(/押し勝ったとき/.test(E.describe({ id: 'power', mag: 0.1, params: { on: 'win' } }).when) && /打ち合いの間/.test(E.describe({ id: 'power', mag: 0.1, params: { on: 'round', cost: 10 } }).when), '発動のしかたの説明が違う');
  ok(/瀕死/.test(E.describe({ id: 'heal', mag: 20 }).when) && /使ったとき/.test(E.describe({ id: 'heal', mag: 20 }, { np: true }).when), '回復の既定の場面の説明が違う');
  ok(E.EFFECT_GROUPS.reduce((t, g) => t + g[2].length, 0) === Object.keys(E.EFFECTS).length, 'どのジャンルにも入っていない効果がある');
  const roster = JSON.parse(fs.readFileSync(__dirname + '/../data/servants.json', 'utf8')).servants.map(B.fromJSON);
  const base = roster.find(s => s.nps.some(n => n.attackResolved && !n.disabled) && s.allSkills.length >= 2);
  const sk = base.allSkills[0].name, sk2 = base.allSkills[1].name;
  const mk = (specs, npSpecs) => {
    const k = base.trueName + '/' + E.normName(sk), k2 = base.trueName + '/' + E.normName(sk2);
    const np = base.nps.find(n => n.attackResolved && !n.disabled), kn = base.trueName + '/' + E.normName(np.name);
    E.SERVANT_OVERRIDES[k] = specs; E.SERVANT_OVERRIDES[k2] = [['power', 3]]; if (npSpecs) E.SERVANT_OVERRIDES[kn] = npSpecs;
    const me = B.fromJSON(B.toLean(base)); delete E.SERVANT_OVERRIDES[k]; delete E.SERVANT_OVERRIDES[k2]; delete E.SERVANT_OVERRIDES[kn]; return me;
  };
  const me = mk([['heal', 1], ['drain_hp', 1], ['mana_gain', 1], ['drain_mana', 1], ['cleanse', 1], ['skill_seal', 2], ['power', 2, { on: 'round', cost: 5 }], ['self_strip', 1, { on: 'pinch', tag: sk2 }]],
    [['drain_hp', 1, { on: 'win' }], ['heal', 1]]);
  const S = me.effectSummary;
  ok(S['heal!pinch'] && S['heal!pinch'].trig > 0 && !S['heal!pinch'].passive && S['power!round$5'] && S['power!round$5'].trig > 0, '発動する効果が集計で分かれていない：' + Object.keys(S).join(','));
  ok(S['drain_hp!win'] && S['drain_hp!win'].npTrig > 0 && S['heal'] && S['heal'].onNP > 0, '宝具の発動する効果・その場の効果が集計で分かれていない');
  // 7騎のうち1騎がほぼ必ず出るように、少ない顔ぶれから選ぶ戦争で回す
  const ros = roster.filter(s => s.id !== base.id).slice(0, 7).concat([me]);
  const seen = {}, keys = { heal: '癒やした', drain: '吸い上げた', mana: '満たした', dmana: '奪い取った', seal: 'スキルを封じた', strip: '力を収めた', round: 'が発動した' };
  let errs = 0;
  for (let i = 0; i < 40; i++) {
    let r; try { r = H.engine.runWar({ roster: ros, seed: 'trig' + i, player: 'none', war: { pick: 'open' } }); } catch (e) { errs++; console.error(e); continue; }
    for (const e of r.entries) for (const [k, w] of Object.entries(keys)) if (e.text.includes(w)) seen[k] = (seen[k] || 0) + 1;
    ok(r.entries.every(e => !/undefined|NaN/.test(e.text)), '記録に undefined / NaN：' + (r.entries.find(e => /undefined|NaN/.test(e.text)) || {}).text);
  }
  ok(!errs, '発動する効果を持つ英霊で戦争がエラーになった');
  ok(Object.keys(keys).every(k => seen[k] > 0), '発動していない効果がある：' + JSON.stringify(seen));
  // 発動する効果を持つ英霊がいても、同じ種なら同じ展開（乱数の使い方が決まっている）
  const r1 = H.engine.runWar({ roster: ros, seed: 'trig-det', player: 'none', war: { pick: 'open' } }), r2 = H.engine.runWar({ roster: ros, seed: 'trig-det', player: 'none', war: { pick: 'open' } });
  ok(JSON.stringify(r1.entries.map(e => e.text)) === JSON.stringify(r2.entries.map(e => e.text)), '発動する効果で展開が決まらない');
  // 見積もり：回復・ダメージカットは強さとして数える
  const plain = mk([['power', 0]]), tough = mk([['heal', 2], ['dmg_cut', 2]]);
  ok(B.battleOdds(tough, roster[1], {}).a > B.battleOdds(plain, roster[1], {}).a, '回復・ダメージカットが見積もりに効いていない');
}

// 6) 要確認の消し込み（手直し表 reviewed）：同じ内容なら確認済みのまま、中身が変われば戻る
{
  const lean = JSON.parse(fs.readFileSync(__dirname + '/../data/servants.json', 'utf8')).servants.find(s => B.fromJSON(s).review.some(r => r.kind === 'skill'));
  const s0 = B.fromJSON(lean), r0 = s0.review.find(r => r.kind === 'skill');
  ok(r0 && r0.sig, '要確認に目印が無い');
  E.REVIEWED[s0.trueName] = [r0.sig];
  const s1 = B.fromJSON(JSON.parse(JSON.stringify(lean)));
  ok(!s1.review.some(r => r.sig === r0.sig) && s1.reviewDone.some(r => r.sig === r0.sig), '確認済みにした要確認が消えていない');
  ok(s1.review.length === s0.review.length - 1, '確認済みにしていない要確認まで消えた');
  const edited = JSON.parse(JSON.stringify(lean));
  for (const k of ['classSkills', 'skills']) for (const x of edited[k] || []) if (x.name === r0.target) x.desc = (x.desc || '') + '（Wikiで書き足した）';
  const s2 = B.fromJSON(edited);
  ok(s2.review.some(r => r.target === r0.target && r.why === r0.why), 'スキルの説明が変わったのに、要確認に戻らない');
  ok(!('reviewDone' in B.toLean(s1)), '書き出したデータに reviewDone が残る');
  delete E.REVIEWED[s0.trueName];
}

console.log(fail ? `NG ${fail}件` : `OK：効果の部品 ${Object.keys(E.EFFECTS).length}種がすべてゲームに届き、説明がある／真名・クラスの手直し／効果の条件／状態異常／開幕の宝具／発動する効果／要確認の消し込み`);
process.exitCode = fail ? 1 : 0;
