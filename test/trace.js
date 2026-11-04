// 効果の検証（engine.js の opts.trace）：出来事が届き、集計の鍵が effectSummary と合い、trace を付けても展開は変わらない
// 使い方: node test/trace.js
for (const f of ['config', 'rank', 'parser', 'effects', 'fgoskills', 'build', 'master', 'war', 'names', 'scenes', 'personas', 'engine']) require('../js/' + f + '.js');
const fs = require('fs');
const H = HGW, E = H.effects, B = H.build;
const roster = JSON.parse(fs.readFileSync(__dirname + '/../data/servants.json', 'utf8')).servants.map(B.fromJSON).filter(s => !s.bossOnly);
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.error('NG:', m); } };

// 発動する効果・常時の効果・宝具を持つ騎を選ぶ
const sv = roster.find(s => Object.values(s.effectSummary).some(x => x.trig) && Object.values(s.effectSummary).some(x => x.passive) && (s.nps || []).some(n => !n.disabled && n.mode !== 'always')) || roster[0];
const others = roster.filter(s => s.id !== sv.id).slice(0, 6);
const seven = [sv].concat(others);
const kinds = {}, keys = new Set(); let bad = 0, npEv = 0;
const logs = [];
for (let i = 0; i < 30; i++) {
  const r = H.engine.runWar({ roster: seven, seed: 'tr' + i, player: 'none', war: { pick: 'open' }, intrude: { on: false }, trace: { id: sv.id, on: ev => {
    kinds[ev.t] = (kinds[ev.t] || 0) + 1;
    if (typeof ev.day !== 'number' || typeof ev.camp !== 'number') bad++;
    if (ev.t === 'round') for (const k of Object.keys(ev.fx.fx)) keys.add(k);
    if (ev.t === 'trig') keys.add(ev.key);
    if (ev.t === 'np') { npEv++; if (!Array.isArray(ev.effects)) bad++; }
  } } });
  logs.push(r.entries.map(e => e.text).join('\n'));
}
ok(!bad, '出来事の形がおかしい');
ok(kinds.bstart > 0 && kinds.bend > 0 && kinds.round > 0 && (kinds.xw || 0) + (kinds.xl || 0) > 0 && kinds.dmg > 0, '戦いの出来事が届かない：' + JSON.stringify(kinds));
ok(kinds.trig > 0 && npEv > 0, '発動・宝具の出来事が届かない：' + JSON.stringify(kinds));
const sumKeys = new Set(Object.keys(sv.effectSummary));
ok([...keys].every(k => sumKeys.has(k)), '集計の鍵が effectSummary に無い：' + [...keys].filter(k => !sumKeys.has(k)).join(' '));
// trace の有無で記録が変わらない／別の騎を指定すると、その騎の出来事だけ
const plain = [];
for (let i = 0; i < 30; i++) plain.push(H.engine.runWar({ roster: seven, seed: 'tr' + i, player: 'none', war: { pick: 'open' }, intrude: { on: false } }).entries.map(e => e.text).join('\n'));
ok(plain.join('#') === logs.join('#'), 'trace を付けると展開が変わった');
let otherOnly = true;
H.engine.runWar({ roster: seven, seed: 'tr0', player: 'none', war: { pick: 'open' }, intrude: { on: false }, trace: { id: others[0].id, on: ev => { if (ev.t === 'bstart' && ev.camp === 0) otherOnly = false; } } });
ok(otherOnly, '指定した騎以外の出来事が届いた');
// 発動する効果の不発の理由が付く（魔力の要る効果を、魔力の無い状態で）
const me = B.fromJSON(B.toLean(sv));
const key = me.trueName + '/' + E.normName(me.allSkills[0].name);
E.SERVANT_OVERRIDES[key] = [['power', 2, { on: 'start', cost: 9999 }]];
const me2 = B.fromJSON(B.toLean(me)); delete E.SERVANT_OVERRIDES[key];
const skips = {};
H.engine.runWar({ roster: [me2].concat(others), seed: 'tr-cost', player: 'none', war: { pick: 'open' }, intrude: { on: false }, trace: { id: me2.id, on: ev => { if (ev.t === 'trig' && ev.skip) skips[ev.skip] = (skips[ev.skip] || 0) + 1; } } });
ok(skips.cost > 0, '不発の理由（魔力）が届かない：' + JSON.stringify(skips));

console.log(fail ? `NG ${fail}件` : `OK：効果の検証（trace）：出来事 ${Object.keys(kinds).join('・')}／記録は変わらない／指定した騎だけ／不発の理由`);
process.exitCode = fail ? 1 : 0;
