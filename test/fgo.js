// FGO風の欄（【FGO風性能】の下のレア度・所有カード・Skill1〜・アペンドスキル・攻撃モーションなど）を
// スキル・宝具として読まないこと、宝具の説明の中の詠唱の行を宝具として読まないことを確かめる
// 使い方: node test/fgo.js
for (const f of ['config', 'rank', 'parser', 'effects', 'fgoskills', 'build']) require('../js/' + f + '.js');
const H = HGW, fs = require('fs');
let fail = 0;
const ok = (cond, msg) => { if (!cond) { fail++; console.error('NG:', msg); } };
const names = l => l.map(x => x.name);

const HEAD = `*基本情報
【CLASS】アサシン
【真名】テスト姫
【ステータス】筋力：C　耐久：D　敏捷：B　魔力：C　幸運：B　宝具：B

*【クラス別スキル】
**気配遮断：B+
自身の気配を消す。

*【保有スキル】
**神性：D
神霊適性。

**血濡れの花嫁：A
男性に対する魅了。

*【宝具】
**『紅の褥』
ランク：B　種別：対人宝具　レンジ：1　最大捕捉：1人
夫を殺した逸話。
「万物に聖あり、森に聖あり」
「では仕方あるまい」
`;
const FGO = `
*【解説】
ダナオスの娘。

*【FGO風性能】
**レア度☆4
クラス：アサシン
**霊基再臨
|段階|外見|
|第一|花嫁衣装|
**基本ステータス
|能力値|初期値|最大値|
|HP|1675|10473|
【ステータス】筋力：A　耐久：A　敏捷：A　魔力：A　幸運：A　宝具：A
**所有カード
|Buster|Quick|Arts|
|1|2|2|
**所有スキル
***Skill1：血濡れの花嫁 A
||CT|効果|Lv.1|
**クラススキル
***気配遮断：B+
|自身のスター発生率をアップ|
**アペンドスキル
***Skill1：追撃技巧向上
||効果|Lv.1|Lv.2|
***Skill2：魔力装填
||効果|Lv.1|Lv.2|
**宝具
『紅の褥』
種類：クイック 敵単体に強力な攻撃[Lv]
**攻撃モーション
|種類|Hit数|動作|

*【コメント】
作者のひとこと。
`;
const want = { skills: ['気配遮断', '神性', '血濡れの花嫁'], nps: ['紅の褥'] };
const check = (label, sv) => {
  ok(JSON.stringify(names(sv.classSkills.concat(sv.skills))) === JSON.stringify(want.skills), `${label}: スキルが違う：${names(sv.classSkills.concat(sv.skills)).join('、')}`);
  ok(JSON.stringify(names(sv.nps)) === JSON.stringify(want.nps), `${label}: 宝具が違う：${names(sv.nps).join('、')}`);
  ok(/万物に聖あり/.test(sv.nps[0] && sv.nps[0].desc), `${label}: 詠唱の行が宝具の説明に残っていない`);
};

// 1) 見出し【FGO風性能】の下はまるごと読み捨てる。前後の欄（解説・コメント）とステータスは今までどおり
const a = H.parser.parseServant(HEAD + FGO);
check('見出しあり', a);
ok(!a.statsAlt.length, 'FGO風の欄のステータスを別のステータスとして拾った');
ok(a.text.commentary === 'ダナオスの娘。' && /作者のひとこと/.test(a.text.comment || ''), '前後の欄が読めていない：' + JSON.stringify(a.text));
ok((a.skippedItems || []).some(x => x.list === 'section' && x.name === '【FGO風性能】') && !(a.skippedItems || []).some(x => x.list !== 'section' && x.why === 'fgo'), '読み飛ばした欄の記録が違う：' + JSON.stringify(a.skippedItems));

// 2) 見出しが無く、宝具の欄の続きにFGO風の項目が並ぶとき：最初のFGO風の項目から先を読み捨てる
const b = H.parser.parseServant(HEAD + FGO.replace('*【FGO風性能】\n', ''));
check('見出しなし', b);

// 3) すでに読み取ってしまったデータ（古い取り込み）も、読み込むときに取り除く
const old = H.parser.parseServant(HEAD);
old.classSkills.push({ name: 'アペンドスキル', rankRaw: '', desc: '[+]格納' }, { name: 'Skill1：追撃技巧向上', rankRaw: '', desc: '||効果|Lv.1|' });
old.nps.push({ name: 'レア度☆4', rankRaw: '', typeRaw: '', desc: 'クラス：アサシン' }, { name: '紅の褥', rankRaw: '', typeRaw: '', desc: '種類：クイック 自身のクイックカード性能をアップ(1T)' },
  { name: '攻撃モーション', rankRaw: '', typeRaw: '', desc: '|種類|Hit数|動作|' }, { name: '性能解説', rankRaw: '', typeRaw: '', desc: '周回向き。' });
const c = H.build.fromJSON(JSON.parse(JSON.stringify(old)));
ok(JSON.stringify(names(c.allSkills)) === JSON.stringify(want.skills) && JSON.stringify(names(c.nps)) === JSON.stringify(want.nps), '読み込み時に取り除けていない：' + names(c.allSkills).join('、') + ' / ' + names(c.nps).join('、'));
ok((c.skippedItems || []).filter(x => x.why === 'fgo').length === 6, '外した項目の記録が違う：' + JSON.stringify(c.skippedItems));
const c2 = H.build.fromJSON(H.build.toLean(c));
ok(JSON.stringify(c2.nps) === JSON.stringify(c.nps) && JSON.stringify(c2.skippedItems) === JSON.stringify(c.skippedItems), '書き出して組み直すと、内容か外した記録が変わる');

// 4) 詠唱の行が宝具として読まれた古いデータ：ひとつ前の宝具の説明に戻す
const d = H.parser.parseServant(HEAD);
d.nps.push({ name: '我が額よ叡智を引き出せ！', rankRaw: '', typeRaw: '', desc: '' });
const e = H.build.fromJSON(d);
ok(names(e.nps).join() === '紅の褥' && /我が額よ叡智を引き出せ！/.test(e.nps[0].desc), '詠唱の行が説明に戻っていない');

// 4b) ほかの欄のスキルをまとめた、説明の無い箇条書き（「・神性：A」）は一覧ごと外す。半分以上が新しい名前なら残す
{
  const sk = (name, rankRaw, desc) => ({ name, rankRaw, rank: H.rank.parseRank(rankRaw), desc });
  const base = { kind: 'servant', trueName: 'まとめ試験', class: { raw: 'アーチャー' }, stats: {}, nps: [],
    classSkills: [sk('対魔力', 'C', '魔術に対する抵抗力。'), sk('・対魔力', 'C', '')],
    skills: [sk('神性', 'A', '神の血を引く。'), sk('勇猛', 'B', '精神干渉を弱める。'), sk('・神性', 'A', ''), sk('・太陽弾', 'A-', ''), sk('・勇猛', 'B', '')] };
  const a = H.build.fromJSON(JSON.parse(JSON.stringify(base)));
  ok(names(a.classSkills).join() === '対魔力' && names(a.skills).join() === '神性,勇猛', 'まとめの箇条書きが外れていない：' + names(a.classSkills).concat(names(a.skills)).join());
  ok((a.skippedItems || []).filter(x => x.why === 'list').length === 4, 'まとめの箇条書きが skippedItems に残っていない');
  const fresh = JSON.parse(JSON.stringify(base)); fresh.skills = [sk('神性', 'A', '神の血を引く。'), sk('・太陽弾', 'A-', ''), sk('・ルーン', 'B', '')];
  const f2 = H.build.fromJSON(fresh);
  ok(names(f2.skills).join() === '神性,・太陽弾,・ルーン', '新しい名前ばかりの箇条書きまで外している：' + names(f2.skills).join());
}

// 5) ふつうのページは何も外さない
for (const f of ['lucan.txt', 'variant1.txt']) {
  const s = H.build.fromJSON(H.parser.parseServant(fs.readFileSync(__dirname + '/' + f, 'utf8')));
  ok(!(s.skippedItems || []).length, `${f}: 何かを外した：${JSON.stringify(s.skippedItems)}`);
}

// 6) いまのデータで外れるもの（参考）
const roster = JSON.parse(fs.readFileSync(__dirname + '/../data/servants.json', 'utf8')).servants.map(H.build.fromJSON);
const hit = roster.filter(s => (s.skippedItems || []).length);
console.log(`いまのデータ：${hit.length}騎から ${hit.reduce((t, s) => t + s.skippedItems.length, 0)}項目を外す（FGO風 ${hit.reduce((t, s) => t + s.skippedItems.filter(x => x.why === 'fgo').length, 0)}・詠唱を説明に戻す ${hit.reduce((t, s) => t + s.skippedItems.filter(x => x.why === 'merged').length, 0)}・まとめの箇条書き ${hit.reduce((t, s) => t + s.skippedItems.filter(x => x.why === 'list').length, 0)}）`);
console.log(fail ? `NG ${fail}件` : 'OK：FGO風の欄と詠唱の行をスキル・宝具として読まない');
process.exitCode = fail ? 1 : 0;
