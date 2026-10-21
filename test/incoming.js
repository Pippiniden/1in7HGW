// tools/incoming.js の確認：node test/incoming.js
//   リストツールの「公開用に保存」が付ける patch（このブラウザで変えた騎の一覧）があるときは、その騎だけを反映し、
//   書き出したあとに公開側で取り込まれた騎・直された騎はそのまま残る（以前はまるごと置き換えで、消えたり古い版に戻ったりした）。
//   patch の無い古い書き出しは、今までどおり 8割以上ならまるごと置き換え。
// リポジトリの js・tools・data を一時フォルダに写して試す（data/ は書き換えない）。
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
let bad = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) bad++; };
const S = JSON.stringify;

function sandbox() {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'hgw-incoming-'));
  for (const d of ['js', 'tools']) fs.cpSync(path.join(ROOT, d), path.join(t, d), { recursive: true });
  fs.mkdirSync(path.join(t, 'data', 'incoming'), { recursive: true });
  for (const f of ['manifest.json', 'servants.json', 'overrides.json']) fs.copyFileSync(path.join(ROOT, 'data', f), path.join(t, 'data', f));
  return t;
}
const readList = t => JSON.parse(fs.readFileSync(path.join(t, 'data', 'servants.json'), 'utf8')).servants;
const run = t => spawnSync('node', [path.join(t, 'tools', 'incoming.js')], { cwd: t, encoding: 'utf8' });

const published = readList(sandbox());   // 書き出した時点の公開中のリスト（＝ブラウザが最後にそろえた状態）
const [A, Bsv, C] = [published[0], published[1], published[2]];

// --- patch あり
{
  const t = sandbox();
  // ブラウザ：A の説明を直し、B を外し、新しい騎 N を足した。書き出しには、ほかの騎も（そのときの版で）全部入る
  const N = JSON.parse(S(A)); N.trueName = 'テスト追加騎'; N.id = A.id.split(':')[0] + ':テスト追加騎';
  const A2 = JSON.parse(S(A)); A2.skills = (A2.skills || []).concat([{ name: 'テスト用スキル', rankRaw: 'C', desc: '' }]);
  const browser = published.filter(s => s.id !== Bsv.id).map(s => s.id === A.id ? A2 : s).concat([N]);
  // 書き出したあと、公開側では C が取り直され（説明が変わった）、別の騎 X が取り込まれた
  const pubNow = readList(t), X = JSON.parse(S(C)); X.trueName = 'あとから取り込まれた騎'; X.id = C.id.split(':')[0] + ':あとから取り込まれた騎';
  const C2 = JSON.parse(S(C)); C2.origin = (C2.origin || '') + '（取り直しで変わった）';
  const pack = JSON.parse(fs.readFileSync(path.join(t, 'data', 'servants.json'), 'utf8'));
  pack.servants = pubNow.map(s => s.id === C.id ? C2 : s).concat([X]);
  fs.writeFileSync(path.join(t, 'data', 'servants.json'), S(pack));
  fs.writeFileSync(path.join(t, 'data', 'incoming', 'servants (3).json'), S({ format: 'hgw-servants', version: 2, lean: true, servants: browser,
    patch: { base: 'x', add: [N.id], upd: [A.id], del: [Bsv.id] } }));
  const r = run(t), after = readList(t), by = new Map(after.map(s => [s.id, s]));
  ok(r.status === 0 && /このブラウザで変えた騎だけを反映（追加 1・更新 1・削除 1/.test(r.stdout), `patch の分だけ反映と報告される`);
  ok(by.has(N.id) && !by.has(Bsv.id) && S(by.get(A.id).skills) === S(A2.skills), 'ブラウザの追加・削除・変更が入る');
  ok(by.has(X.id), '書き出したあとに公開側で取り込まれた騎は消えない');
  ok(by.get(C.id).origin === C2.origin, '書き出したあとに公開側で取り直された騎は、古い版に戻らない');
  ok(after.length === pack.servants.length + 1 - 1, `騎の数：公開中 ${pack.servants.length} ＋ 追加1 − 削除1 = ${after.length}`);
  fs.rmSync(t, { recursive: true, force: true });
}

// --- patch なし（古い書き出し）：今までどおり、8割以上ならまるごと置き換え
{
  const t = sandbox();
  const browser = published.filter(s => s.id !== Bsv.id);
  fs.writeFileSync(path.join(t, 'data', 'incoming', 'old.json'), S({ format: 'hgw-servants', version: 2, lean: true, servants: browser }));
  const r = run(t), after = readList(t);
  ok(r.status === 0 && /まるごと置き換え/.test(r.stdout) && !after.some(s => s.id === Bsv.id), 'patch の無い書き出しは今までどおりまるごと置き換え');
  fs.rmSync(t, { recursive: true, force: true });
}

console.log(bad ? `\n${bad}件失敗` : '\nすべて通りました');
process.exit(bad ? 1 : 0);
