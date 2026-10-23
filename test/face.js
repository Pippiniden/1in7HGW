// 顔グラフィックのファイル名（config.js の faceNameOf / faceNameOfId / faceCandidates）を確かめる
// 使い方: node test/face.js
//  1) key の無い騎は「真名」、key のある騎は「真名#key」になる（手直し表の okey と同じ）
//  2) servantId（クラス:真名[#key]）から同じ名前が取れる
//  3) 候補の URL では # が %23 に直り、key 付きの騎が key 無しの同名の騎の画像を引かない
//  4) いまのデータの全員で、id → 名前 が faceNameOf と一致する
for (const f of ['config', 'rank', 'parser', 'effects', 'fgoskills', 'build']) require('../js/' + f + '.js');
const fs = require('fs'), H = HGW;
let fail = 0;
const ok = (cond, msg) => { if (!cond) { fail++; console.error('NG:', msg); } };

const plain = { trueName: 'アルトリア・ペンドラゴン', class: { key: 'saber' } };
const keyed = { trueName: 'アルトリア・ペンドラゴン', key: 'abc12', class: { key: 'lancer' } };
ok(H.faceNameOf(plain) === 'アルトリア・ペンドラゴン', 'key 無しは真名のまま');
ok(H.faceNameOf(keyed) === 'アルトリア・ペンドラゴン#abc12', 'key 付きは 真名#key');
ok(H.faceNameOf(null) === '', 'null は空');
ok(H.faceNameOf(plain) === H.effects.okey(plain) && H.faceNameOf(keyed) === H.effects.okey(keyed), 'effects.okey と同じ');
ok(H.faceNameOfId('saber:アルトリア・ペンドラゴン') === 'アルトリア・ペンドラゴン', 'id から（key 無し）');
ok(H.faceNameOfId('lancer:アルトリア・ペンドラゴン#abc12') === 'アルトリア・ペンドラゴン#abc12', 'id から（key 付き）');
ok(H.faceNameOfId('') === '' && H.faceNameOfId(undefined) === '', '空の id');

const c1 = H.faceCandidates(H.faceNameOf(keyed)), c0 = H.faceCandidates(H.faceNameOf(plain));
ok(c1.length === 3 && c1[0].endsWith('%23abc12.webp') && !c1.some(u => u.includes('#')), '# は %23 に直る：' + c1[0]);
ok(c1.every(u => !c0.includes(u)), 'key 付きの候補に、key 無しの同名の騎の画像が混ざらない');

const roster = JSON.parse(fs.readFileSync(__dirname + '/../data/servants.json', 'utf8')).servants.map(H.build.fromJSON);
let bad = 0; for (const sv of roster) if (H.faceNameOfId(sv.id) !== H.faceNameOf(sv)) { bad++; console.error('  不一致:', sv.id); }
ok(bad === 0, `データの ${roster.length} 騎で id から取った名前が faceNameOf と一致（不一致 ${bad}）`);

console.log(fail ? `NG ${fail}` : `OK（${roster.length}騎）`);
process.exit(fail ? 1 : 0);
