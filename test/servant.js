// tools/servant.js の確認：node test/servant.js
//   - core の切り出しが全体よりずっと小さい
//   - show → add（変更なし）で何も変わらない
//   - 1項目だけ直して add すると、その騎のその項目だけが変わる（セリフ・解説・原文・ほかの騎は元のまま）
//   - 新しい騎（最小のJSON）が足せて、ランクが読まれ、並びが整い、check が通る
//   - 足りない入力は何も書き込まずに断る
// data/ は書き換えず、一時フォルダに写して試す。
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync, spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..'), TOOL = path.join(ROOT, 'tools', 'servant.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hgw-servant-'));
for (const f of ['manifest.json', 'servants.json', 'overrides.json']) fs.copyFileSync(path.join(ROOT, 'data', f), path.join(tmp, f));

let bad = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) bad++; };
const run = (...a) => spawnSync('node', [TOOL, ...a, '--data', tmp], { encoding: 'utf8' });
const read = () => JSON.parse(fs.readFileSync(path.join(tmp, 'servants.json'), 'utf8')).servants;
const byId = list => new Map(list.map(s => [s.id, s]));
const S = JSON.stringify;

try {
  const before = read(), b0 = byId(before);
  const target = before.find(s => s.skills.length && s.voice && Object.keys(s.voice).length && s.sourceText) || before[0];
  const id = target.id;

  // 1) core は小さい
  const full = S(target).length, core = JSON.parse(run('show', id).stdout), coreLen = S(core).length;
  ok(coreLen < full * 0.5, `core(${coreLen}字) は全体(${full}字)の半分未満`);
  ok(!('voice' in core) && !('text' in core) && !('sourceText' in core), 'core にセリフ・解説・原文は入らない');
  ok(core.stats && core.stats.str === target.stats.str.raw, 'core のステータスは文字列のランク');

  // 2) 変更なし
  const f1 = path.join(tmp, 'core.json'); fs.writeFileSync(f1, S(core));
  const bytes0 = fs.readFileSync(path.join(tmp, 'servants.json'), 'utf8');
  const r1 = run('add', f1);
  ok(r1.status === 0 && /変更なし/.test(r1.stdout), 'show → add（そのまま）は「変更なし」');
  ok(fs.readFileSync(path.join(tmp, 'servants.json'), 'utf8') === bytes0, '変更なしのときファイルは1バイトも変わらない');

  // 3) 1項目だけ直す
  const edited = JSON.parse(S(core)); edited.skills[0].desc += '（確認用の追記）';
  const f2 = path.join(tmp, 'edit.json'); fs.writeFileSync(f2, S(edited));
  const r2 = run('add', f2);
  ok(r2.status === 0 && /更新（skills）/.test(r2.stdout), `skills だけの更新と報告される：${(r2.stdout.match(/更新（[^）]*）/) || [''])[0]}`);
  const after = read(), a0 = byId(after), t1 = a0.get(id);
  ok(after.length === before.length, '騎の数は変わらない');
  ok(t1.skills[0].desc.endsWith('（確認用の追記）'), '直した説明が入っている');
  ok(S(t1.voice) === S(target.voice) && S(t1.text) === S(target.text) && t1.sourceText === target.sourceText, '書かなかった項目（セリフ・解説・原文）は元のまま');
  ok(S(t1.nps) === S(target.nps) && S(t1.stats) === S(target.stats), '触れなかった宝具・ステータスも元のまま');
  ok(after.filter(s => s.id !== id).every(s => S(s) === S(b0.get(s.id))), '他の騎は1騎も変わらない');

  // 4) 新しい騎
  const fresh = {
    trueName: 'テスト英霊', class: 'セイバー', stats: { str: 'A', end: 'B', agi: 'C', mag: 'D', luk: 'E', np: 'A+' },
    classSkills: [{ name: '対魔力', rankRaw: 'A', desc: '魔術に対する抵抗力。' }],
    skills: [{ name: '戦闘続行', rankRaw: 'B', desc: '瀕死の傷でも戦闘を可能とする。' }],
    nps: [{ name: '約束された勝利の剣', reading: 'エクスカリバー', rankRaw: 'A++', typeRaw: '対城宝具', rangeRaw: '1~99', maxRaw: '1000人', desc: '光の斬撃を放つ。' }],
  };
  const f3 = path.join(tmp, 'new.json'); fs.writeFileSync(f3, S(fresh));
  const r3 = run('add', f3);
  ok(r3.status === 0 && /＋ saber:テスト英霊/.test(r3.stdout), '新しい騎が追加される');
  const list3 = read(), n = byId(list3).get('saber:テスト英霊');
  ok(n && n.stats.str.rank.base === 'A' && n.stats.np.rank.plus === 1, 'ステータスのランクが読まれている（A、A+）');
  ok(n && n.nps[0].typeKey === 'anti_fort', `宝具の種別が読まれている（${n && n.nps[0].typeKey}）`);
  ok(n && n.skills[0].rank.base === 'B' && n.classSkills[0].rank.base === 'A', 'スキルのランクが読まれている');
  ok(n && n.nps[0].range && n.nps[0].maxTargets === 1000, '宝具のレンジ・最大捕捉が読まれている');
  const sorted = JSON.parse(S(list3)); require('../tools/datalib').sortLean(sorted);
  ok(list3.every((s, i) => s.id === sorted[i].id), '並び（クラス順→真名）が整っている');
  ok(list3.filter(s => s.id !== 'saber:テスト英霊' && s.id !== id).every(s => S(s) === S(b0.get(s.id))), '足しても他の騎は変わらない');
  const r3b = run('add', f3);
  ok(/変更なし/.test(r3b.stdout), '同じJSONをもう一度 add しても変更なし');
  const c = run('check');
  ok(!/エラー saber:テスト英霊/.test(c.stdout), 'check が新しい騎でエラーを出さない');

  // 5) 足りない入力は断る（書き込まない）
  const bytes1 = fs.readFileSync(path.join(tmp, 'servants.json'), 'utf8');
  const noStats = path.join(tmp, 'nostats.json'); fs.writeFileSync(noStats, S({ trueName: 'だめな英霊', class: 'アーチャー' }));
  const r4 = run('add', noStats);
  ok(r4.status !== 0 && /stats/.test(r4.stderr), 'stats の無い新しい騎は断られる');
  const noClass = path.join(tmp, 'noclass.json'); fs.writeFileSync(noClass, S({ trueName: 'だめな英霊2', stats: fresh.stats }));
  ok(run('add', noClass).status !== 0, 'class の無い新しい騎は断られる');
  ok(fs.readFileSync(path.join(tmp, 'servants.json'), 'utf8') === bytes1, '断ったときは何も書き込まない');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(bad ? `\n${bad}件失敗` : '\nすべて通りました');
process.exit(bad ? 1 : 0);
