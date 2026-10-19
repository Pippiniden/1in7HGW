// 聖杯戦争で試す（js/simlab.js の core）：リストツールで回す集計が、公開中の集計（survival.js）と同じ式で数えられているか
// 使い方: node test/simlab.js
//  1) 同じリスト・同じ種なら survival.js の runner と英霊ごとの数が一致する（公開中の集計とそろう）
//  2) 並列に分けて回した集計を足すと、まとめて回したのと同じになる
//  3) 設定の差し替え：数値だけ書き換わり、元に戻せる。無い所・数値でない所は無視。差し替えると展開が変わる
//  4) 設定の一覧と、config.js の行末の説明の読み取り
for (const f of ['config', 'rank', 'parser', 'effects', 'fgoskills', 'build', 'master', 'war', 'names', 'scenes', 'personas', 'engine', 'survival', 'simlab']) require('../js/' + f + '.js');
const fs = require('fs'), H = HGW, L = H.simLab;
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.error('NG:', m); } };
const lean = JSON.parse(fs.readFileSync(__dirname + '/../data/servants.json', 'utf8')).servants;
const ov = JSON.parse(fs.readFileSync(__dirname + '/../data/overrides.json', 'utf8'));
const roster = L.buildRoster(lean, ov);
ok(roster.length > 50 && !roster.errors, '組み立てられない：' + roster.length + '騎・エラー' + roster.errors);
const N = 60;

// 1) survival.js と同じ数え方
const sv = H.survival.runner(roster).step(N);
const t = L.emptyTally(30); for (let i = 0; i < N; i++) L.runOne(roster, i, t);
ok(t.wars === N && sv.wars === N, '回数が違う');
ok(JSON.stringify(Object.entries(t.servants).sort()) === JSON.stringify(Object.entries(sv.servants).sort()), '英霊ごとの数が survival.js と違う');
ok(t.ends.win + t.ends.wipe + t.ends.draw === N - t.errors, '決着の数が合わない：' + JSON.stringify(t.ends));

// 2) 分けて回して足す
const a = L.emptyTally(30), b = L.emptyTally(30);
for (let i = 0; i < N; i += 2) L.runOne(roster, i, a);
for (let i = 1; i < N; i += 2) L.runOne(roster, i, b);
const m = L.merge(L.merge(L.emptyTally(30), a), b);
const norm = x => JSON.stringify({ e: x.ends, l: x.len, b: x.battles, n: x.nps, s: Object.entries(x.servants).sort() });
ok(norm(m) === norm(t), '並列に分けて足した集計が、まとめて回したものと違う');
const rows = L.rowsOf(t), S = L.summaryOf(t);
ok(Object.values(rows).every(r => r.rate >= 0 && r.rate <= 1 && r.margin > 0), '優勝率の行がおかしい');
ok(S.win > 0.5 && S.medDays >= 1 && S.battles > 0, 'まとめがおかしい：' + JSON.stringify(S));

// 2b) 並びをそろえる：リストツールの並び（クラス→名前順など）でも、公開中の並びにそろえれば同じ戦争になる
{
  const ids = roster.map(H.build.wikiId);
  const CO = Object.keys(H.CONFIG.CLASS_DEFS), ord = s => { const i = CO.indexOf(s.class.key); return i < 0 ? 99 : i; };
  const browser = roster.slice().sort((x, y) => ord(x) - ord(y) || x.trueName.localeCompare(y.trueName, 'ja')).reverse();
  const back = L.orderLike(browser, ids, H.build.wikiId);
  ok(H.survival.fingerprint(back) === H.survival.fingerprint(roster), '公開中の並びにそろえても指紋が戻らない');
  const extra = L.orderLike(browser.concat([{ id: 'x:new' }]), ids, s => s.id === 'x:new' ? s.id : H.build.wikiId(s));
  ok(extra[extra.length - 1].id === 'x:new' && L.orderLike(browser, null) !== browser && L.orderLike(browser, null).length === browser.length, '公開中に無い騎の扱いが違う');
}

// 3) 設定の差し替え
const K0 = H.CONFIG.BATTLE_K, h0 = H.CONFIG.ENGINE.huntBase, p0 = H.CONFIG.NP_TYPE.anti_fort.power;
const undo = L.applyConfig({ BATTLE_K: 40, 'ENGINE.huntBase': 0.3, 'NP_TYPE.anti_fort.power': 2, 'NP_TYPE.anti_fort.name': 9, 'ENGINE.nope': 1, 'WAR.slots': 3 });
ok(H.CONFIG.BATTLE_K === 40 && H.CONFIG.ENGINE.huntBase === 0.3 && H.CONFIG.NP_TYPE.anti_fort.power === 2, '数値が差し替わらない');
ok(H.CONFIG.NP_TYPE.anti_fort.name === '対城' && !('nope' in H.CONFIG.ENGINE) && Array.isArray(H.CONFIG.WAR.slots), '数値でない所・無い所まで書き換えた');
const r2 = L.buildRoster(lean, null), t2 = L.emptyTally(30); for (let i = 0; i < 20; i++) L.runOne(r2, i, t2);
undo();
ok(H.CONFIG.BATTLE_K === K0 && H.CONFIG.ENGINE.huntBase === h0 && H.CONFIG.NP_TYPE.anti_fort.power === p0, '元に戻らない');
const t3 = L.emptyTally(30); for (let i = 0; i < 20; i++) L.runOne(roster, i, t3);
ok(norm(t2) !== norm(t3), '設定を変えても展開が変わらない');

// 4) 設定の一覧と説明
const gs = L.groups(), paths = [].concat(...gs.map(g => g.paths));
ok(paths.length > 60 && paths.every(p => typeof L.getPath(p) === 'number'), '設定の一覧に数値でないものがある');
ok(!paths.includes('ENGINE.lifeChance') && paths.includes('ENGINE.counterDmg') && paths.includes('CLASS_DEFS.berserker.upkeep'), '設定の一覧の中身が違う');
const notes = L.commentsOf(fs.readFileSync(__dirname + '/../js/config.js', 'utf8'));
ok(/出撃/.test(notes['ENGINE.huntBase'] || '') && /筋力/.test(notes['STAT_FX.str'] || '') && /0 で以前と同じ/.test(notes['ENGINE.counterDmg'] || ''), 'config.js の説明が読めない：' + JSON.stringify([notes['ENGINE.huntBase'], notes['STAT_FX.str'], notes['ENGINE.counterDmg']]));

console.log(fail ? `NG ${fail}件` : `OK：聖杯戦争で試す（survival.js と同じ数え方／分けて足しても同じ／公開中の並びにそろえる／設定の差し替えと戻し／設定の一覧 ${paths.length}項目）`);
process.exitCode = fail ? 1 : 0;
