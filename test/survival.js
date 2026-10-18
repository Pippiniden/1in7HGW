// 生存曲線の集計（js/survival.js）と、プレイヤーの名前が展開を変えないことを確かめる
// 使い方: node test/survival.js
for (const f of ['config', 'rank', 'parser', 'effects', 'build', 'master', 'war', 'names', 'scenes', 'personas', 'engine', 'survival']) require('../js/' + f + '.js');
const fs = require('fs');
const roster = JSON.parse(fs.readFileSync(__dirname + '/../data/servants.json', 'utf8')).servants.map(HGW.build.fromJSON);
const S = HGW.survival;
let fail = 0;
const ok = (cond, msg) => { if (!cond) { fail++; console.error('NG:', msg); } };

// 1) 名前を付けても、名前以外は同じ戦争になる
for (let i = 0; i < 30; i++) {
  const a = HGW.engine.runWar({ roster, seed: 'n' + i, ask: 'big' });
  const b = HGW.engine.runWar({ roster, seed: 'n' + i, ask: 'big', playerName: '衛宮 テスト' });
  // プレイヤーのマスター（再契約で陣営を移ることもある）の名前だけが違う
  const strip = (r, name) => JSON.stringify(r.camps.map(c => Object.assign({}, c, { master: c.master === name ? '' : c.master })));
  const rolled = a.camps[b.camps.findIndex(x => x.master === '衛宮 テスト')].master;
  ok(strip(a, rolled) === strip(b, '衛宮 テスト'), `名前で展開が変わった（シード n${i}）`);
  const y = b.camps.find(c => c.you);
  ok(y && y.master === '衛宮 テスト', `付けた名前が使われていない（シード n${i}）`);
  ok(b.entries.some(e => e.text.includes('衛宮 テスト')), `記録に名前が出ていない（シード n${i}）`);
}
// 制御文字は除き、20字まで
const c = HGW.engine.runWar({ roster, seed: 'n0', ask: 'big', playerName: 'あ\u0007'.repeat(30) }).camps.find(x => x.you);
ok(c.master === 'あ'.repeat(20), '名前の整え方が違う：' + c.master);

// 2) 集計：登場回数と脱落の数が合い、曲線は1から下がっていく
const run = S.runner(roster);
run.step(120);
const st = run.stats;
ok(st.wars === 120, '回数が違う');
ok(st.fp === S.fingerprint(roster), '指紋が違う');
const apps = Object.values(st.servants).reduce((t, x) => t + x.n, 0);
ok(apps >= 120 * 7 - 5 && apps <= 120 * 8, '登場回数の合計がおかしい：' + apps);
for (const [id, t] of Object.entries(st.servants)) {
  const dead = t.d.reduce((a, b) => a + b, 0);
  ok(dead + t.w <= t.n, `${id}: 脱落と勝利が登場回数を超えた`);
  const s = S.curveOf(t, st.days);
  ok(s[0] === 1 && s.every((v, i) => !i || v <= s[i - 1] + 1e-12) && s[st.days] >= t.w / t.n - 1e-9, `${id}: 曲線がおかしい`);
}
// 同じリスト・同じ回数なら同じ集計（続きからでも同じ）
const r2 = S.runner(roster); r2.step(60);
const r3 = S.runner(roster, { stats: JSON.parse(JSON.stringify(r2.stats)) }); r3.step(60);
ok(JSON.stringify(r3.stats.servants) === JSON.stringify(st.servants), '途中から続けた集計が一致しない');
// 公開している集計が今のリストと合っているか（合っていなくてもゲームは動く。作り直しは node tools/survival.js）
const pub = fs.existsSync(__dirname + '/../data/survival.json') ? JSON.parse(fs.readFileSync(__dirname + '/../data/survival.json', 'utf8')) : null;
console.log(pub ? `data/survival.json: ${pub.wars}回・指紋 ${pub.fp}` : 'data/survival.json はありません');
console.log(fail ? `NG ${fail}件` : 'OK：名前は展開を変えない／集計の数と曲線が合っている');
process.exitCode = fail ? 1 : 0;
