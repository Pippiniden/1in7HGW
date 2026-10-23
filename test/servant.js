// tools/servant.js の確認：node test/servant.js
//   - core の切り出しが全体よりずっと小さい
//   - show → add（変更なし）で何も変わらない
//   - 1項目だけ直して add すると、その騎のその項目だけが変わる（セリフ・解説・原文・ほかの騎は元のまま）
//   - 新しい騎（最小のJSON）が足せて、ランクが読まれ、並びが整い、check が通る
//   - 足りない入力は何も書き込まずに断る
//   - 削除は packs からも消え、手直し表の取り残しも片付ける（--dry-run は何も書かない）
//   - 同じ真名の別の騎（同じクラス・別クラス）は印 key が付いて別の騎になり、手直しを共有しない
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
  // 6) 削除：servants.json だけでなく packs からも消え、手直し表の取り残しも消える
  const gone = 'saber:アルトリア・ペンドラゴン', goneName = 'アルトリア・ペンドラゴン';
  const cur6 = read(), victim = cur6.find(x => x.id === gone);
  const ovPath = path.join(tmp, 'overrides.json'), ov0 = JSON.parse(fs.readFileSync(ovPath, 'utf8'));
  const hasKey = (o, n) => ['servant', 'np', 'stats', 'content', 'pages', 'reviewed'].some(t => Object.keys(o[t] || {}).some(k => k === n || k.startsWith(n + '/')));
  ok(victim && hasKey(ov0, goneName), '前提：その騎は手直し表にも載っている');
  fs.mkdirSync(path.join(tmp, 'packs')); fs.mkdirSync(path.join(tmp, 'incoming'));
  fs.writeFileSync(path.join(tmp, 'packs', 'extra.json'), S({ format: 'hgw-servants', version: 2, lean: true, servants: [victim] }));
  fs.writeFileSync(path.join(tmp, 'incoming', 'pending.json'), S({ format: 'hgw-servants', version: 2, lean: true, servants: [victim] }));
  const man = JSON.parse(fs.readFileSync(path.join(tmp, 'manifest.json'), 'utf8')); man.servants.push('packs/extra.json');
  fs.writeFileSync(path.join(tmp, 'manifest.json'), S(man));
  const snap = () => ['servants.json', 'overrides.json', 'packs/extra.json'].map(f => fs.readFileSync(path.join(tmp, f), 'utf8')).join('\0');
  const s0 = snap();
  const rd = run('remove', goneName, '--dry-run');
  ok(rd.status === 0 && snap() === s0, '--dry-run は何も書き込まない');
  const rr = run('remove', goneName);
  ok(rr.status === 0, '削除が成功する');
  ok(!read().some(x => x.id === gone) && read().length === cur6.length - 1, 'servants.json から消え、ほかの騎は減らない');
  ok(!JSON.parse(fs.readFileSync(path.join(tmp, 'packs', 'extra.json'), 'utf8')).servants.some(x => x.id === gone), 'packs/extra.json からも消える');
  const ov1 = JSON.parse(fs.readFileSync(ovPath, 'utf8'));
  ok(!hasKey(ov1, goneName), '手直し表（servant・np・content・pages・reviewed）の取り残しが消える');
  ok(S(ov1.global) === S(ov0.global) && Object.keys(ov1.reviewed).includes('ルーカン'), '全員に効く手直しやほかの騎の手直しは残る');
  ok(/incoming\/?\s*の pending\.json|pending\.json/.test(rr.stdout), 'data/incoming/ に残ったファイルで復活することを知らせる');
  ok(read().filter(x => x.id !== id && x.id !== 'saber:テスト英霊').every(x => S(x) === S(b0.get(x.id))), '消した騎以外は1騎も変わらない');
  ok(run('show', gone).status !== 0, '消したあとは show でも見つからない');
  ok(run('remove', goneName).status !== 0, 'もう無い騎の削除は断られる');
  ok(!/エラー saber:アルトリア/.test(run('check').stdout), '消したあとの check に、その騎のエラーは出ない');
  // 7) wipe：その騎の手直しだけを消す（ページ名・全員に効く手直し・ほかの騎の手直しは残す）。真名を変えた騎も表示の真名で探す
  const ov7 = JSON.parse(fs.readFileSync(ovPath, 'utf8'));
  const renamed = Object.entries(ov7.content || {}).find(([k, v]) => v.identity && v.identity.trueName && k && read().some(x => x.trueName === k)
    && Object.keys(ov7.servant || {}).some(x => x.startsWith(v.identity.trueName + '/')));
  ok(!!renamed, `前提：真名を変えていて、変えたあとの名前で効果の手直しがある騎がいる（${renamed && renamed[0] + '→' + renamed[1].identity.trueName}）`);
  if (renamed) {
    const [wn, { identity: { trueName: dn } }] = renamed;
    const hadPage = ov7.pages && ov7.pages[dn] !== undefined;
    const rw = run('wipe', wn);
    const ov8 = JSON.parse(fs.readFileSync(ovPath, 'utf8'));
    ok(rw.status === 0 && !ov8.content[wn], 'wipe で内容（と真名の変更）の手直しが消える');
    ok(!Object.keys(ov8.servant).some(k => k.startsWith(dn + '/')) && !Object.keys(ov8.np).some(k => k.startsWith(dn + '/')), '変えたあとの真名で引く効果・宝具の手直しも消える');
    ok(!hadPage || ov8.pages[dn] === ov7.pages[dn], 'ページ名の手直しは残る');
    ok(S(ov8.global) === S(ov7.global), '全員に効く手直しは残る');
    const others = t => Object.keys(t || {}).filter(k => !k.startsWith(dn + '/') && k !== dn && k !== wn);
    ok(['servant', 'np', 'stats', 'content', 'reviewed'].every(t => S(others(ov8[t])) === S(others(ov7[t]))), 'ほかの騎の手直しは1件も変わらない');
    ok(read().length === list3.length - 1, 'wipe は servants.json の騎を消さない');
    ok(/手直しはありません/.test(run('wipe', wn).stdout), 'もう一度 wipe しても何もしない');
  }
  // 8) 同じ真名の別の騎：同じクラスでも別クラスでも、後から入るほうに印 key が付き、手直しを共有しない（既存の騎は印なしのまま）
  const L = require('../tools/datalib'), keyed = x => x.key && /^[0-9a-z]{5}$/.test(x.key);
  const twin = (extra, name) => { const f = path.join(tmp, 'twin.json'); fs.writeFileSync(f, S(Object.assign({}, fresh, { trueName: name || 'テスト双子' }, extra))); return run('add', f); };
  const n8 = read().length;
  const rA = twin({ page: '双子A' });
  ok(rA.status === 0 && /＋ saber:テスト双子\s/.test(rA.stdout), '同じ真名がいなければ、印なしで追加される');
  const rB = twin({ page: '双子B' });
  const twinB = read().find(x => x.trueName === 'テスト双子' && x.page === '双子B');
  ok(rB.status === 0 && twinB && keyed(twinB) && twinB.id === 'saber:テスト双子#' + twinB.key, `同じクラス・別ページは別の騎になり、印が付く（${twinB && twinB.id}）`);
  ok(read().filter(x => x.trueName === 'テスト双子').length === 2 && !read().find(x => x.page === '双子A').key, '先にいた騎は印なしのまま・2騎に増える');
  ok(/変更なし/.test(twin({ page: '双子A' }).stdout) && /変更なし/.test(twin({ page: '双子B' }).stdout), '同じページで足し直しても、それぞれの騎の取り直しになる（増えない）');
  ok(read().filter(x => x.trueName === 'テスト双子').length === 2, '足し直したあとも2騎のまま');
  const rC = twin({ class: 'ランサー', page: '双子C' });
  const twinC = read().find(x => x.trueName === 'テスト双子' && x.class.raw === 'ランサー');
  ok(rC.status === 0 && twinC && keyed(twinC) && twinC.id === 'lancer:テスト双子#' + twinC.key, `同じ真名で別クラスも印が付いて別の騎になる（${twinC && twinC.id}）`);
  ok(read().length === n8 + 3, '双子は合わせて3騎が増えただけ');
  ok(!/印 key の無い騎が/.test(run('check').stdout), 'check：印なしの同名は1騎までなので注意は出ない');
  const ovp = path.join(tmp, 'overrides.json'), ov9 = JSON.parse(fs.readFileSync(ovp, 'utf8'));
  ov9.stats = Object.assign({}, ov9.stats, { 'テスト双子': { str: 'E' }, ['テスト双子#' + twinB.key]: { end: 'E' } });
  fs.writeFileSync(ovp, S(ov9));
  const built = new Map(L.loadDir(tmp).roster.map(x => [x.id, x]));
  const bA = built.get('saber:テスト双子'), bB = built.get(twinB.id), bC = built.get(twinC.id);
  ok(bA && bA.ranks.str.base === 'E' && bA.ranks.end.base === 'B', '印なしの騎には、真名だけの手直しが効く');
  ok(bB && bB.ranks.str.base === 'A' && bB.ranks.end.base === 'E', '印付きの騎には、「真名#印」の手直しだけが効く');
  ok(bC && bC.ranks.str.base === 'A' && bC.ranks.end.base === 'B', '別クラスの同名には、どちらの手直しも掛からない');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(bad ? `\n${bad}件失敗` : '\nすべて通りました');
process.exit(bad ? 1 : 0);
