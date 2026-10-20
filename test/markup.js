// Wiki の記法の片付け（parser.js の stripMarkup・tidy）と、因縁キャラの読み取り（collectRelations）
// 使い方: node test/markup.js
//  1) 脚注の番号（*1）・折りたたみ（[+] [END]）・表・画像・飾り・実体参照・対になっていない太字を消す。何度掛けても同じ
//  2) ルビは、説明文では表記だけ・宝具の名前では読みとして取る
//  3) 因縁キャラ：名前だけの行（太字・リンク・「：」で終わる）と続く本文、1行の「名前：本文」。セリフの行は因縁にしない
//  4) 読み込み済みのデータ（finalize）にも掛かる：公開中のリストに記法が残らない
for (const f of ['config', 'rank', 'parser', 'effects', 'fgoskills', 'build']) require('../js/' + f + '.js');
const fs = require('fs'), P = HGW.parser, B = HGW.build;
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.error('NG:', m); } };
const eq = (a, b, m) => ok(a === b, `${m}：${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);

// 1) 記法の片付け
eq(P.stripMarkup('殺したとも言われる*1。'), '殺したとも言われる。', '脚注の番号');
eq(P.stripMarkup('付加＊2される'), '付加される', '全角の脚注の番号');
eq(P.stripMarkup('1~10 *1'), '1~10', '行末の脚注の番号');
eq(P.stripMarkup('5*3=15'), '5*3=15', '掛け算は残す');
eq(P.stripMarkup('[+]台詞例\n「本文」\n[END]'), '台詞例\n「本文」', '折りたたみ');
eq(P.stripMarkup('|center:|center:|c\n|~対象|可否|\n|セイバー|没収まで可~~第二宝具は不可|'), '対象：可否\nセイバー：没収まで可／第二宝具は不可', '表');
eq(P.stripMarkup("&align(center){''&color(#eee,#00f){「我らの剣は」}''}"), '「我らの剣は」', '入れ子の飾り');
eq(P.stripMarkup("利用価値：中。''"), '利用価値：中。', '対になっていない太字');
eq(P.stripMarkup('V&#339;ux'), 'Vœux', '数値の実体参照');
eq(P.stripMarkup('[+]初出\n&ref(https://x/y.jpg,300)\n本文'), '初出\n\n本文', '画像');
eq(P.stripMarkup('「分」((この「分」は時間の単位ではない))として'), '「分」として', '脚注の中身');
eq(P.stripMarkup('[[近藤勇]]をして外せと言わしめた[[(泥)>田中新兵衛(2)]]'), '近藤勇をして外せと言わしめた(泥)', 'リンク');
for (const s of ['殺したとも言われる*1。', '|~対象|可否|', "&align(center){''x''}", '[+]見出し']) { const a = P.tidy(s); eq(P.tidy(a), a, '二度掛けても同じ'); }

// 2) ルビ：説明文は表記だけ、宝具の名前は読み
eq(P.stripMarkup('&ruby(とうろう){蜻蛉}と呼ばれる構え'), '蜻蛉と呼ばれる構え', '説明文のルビ');
const nr = P.nameAndReading('『&ruby(ひとたち){碁盤斬り}』');
ok(nr.name === '碁盤斬り' && nr.reading === 'ひとたち', '宝具の名前のルビが読みにならない：' + JSON.stringify(nr));

// 3) 因縁キャラ
const rel = P.collectRelations([
  "''[[島津義弘（偽）]]''", '「チェェストォッ！(勝負、の意)」', '',
  "''[[武家 サルサ]]：''", '「チェェストォッ！(精進せよ、の意)」', '',
  '[+][[Extellaっぽい>まとめ]]において', '',
  "''[[トリスタン]]''：", '同陣営の仲間。', '剛弓を持った強者。', '[END]',
  '[[ヴォーティガーン]]：', '父。大げんかをしたようだ。', '',
  'ジャガーマン：謎のジャガー。', '',
  '|center:|c', '|宝具|『x』|',
  'レベルアップ：「これが昇り龍ってか？」', '霊基再臨：', '「衣が変わる」',
  '黒姫：', '親友。',
]);
const names = rel.map(r => r.name);
eq(names.join('、'), '島津義弘（偽）、武家 サルサ、トリスタン、ヴォーティガーン、ジャガーマン、黒姫', '因縁の名前');
eq((rel.find(r => r.name === 'トリスタン') || {}).text, '同陣営の仲間。\n剛弓を持った強者。', '因縁の本文（複数行）');
eq((rel.find(r => r.name === '島津義弘（偽）') || {}).text, '「チェェストォッ！(勝負、の意)」', '因縁の本文（台詞）');

// 4) 公開中のリスト：読み込むと記法が残らない
const roster = JSON.parse(fs.readFileSync(__dirname + '/../data/servants.json', 'utf8')).servants.map(B.fromJSON);
const MARK = /[*＊]\d|\[\+\]|\[END\]|&(?:ref|color|size|align|ruby)\(|\[\[|^\|/m;
let left = [];
for (const s of roster) {
  const fields = [].concat(...['classSkills', 'skills', 'nps', 'weapons'].map(k => (s[k] || []).map(it => [it.name, it.reading, it.desc, it.rangeRaw]))).flat()
    .concat(Object.values(s.text || {}), Object.values(s.profile || {}), ...(s.relations || []).map(r => [r.name, r.text]), ...Object.values(s.voice || {}));
  for (const f of fields) if (typeof f === 'string' && MARK.test(f)) left.push(s.trueName + '：' + f.slice(0, 40));
}
ok(!left.length, '読み込んだデータに記法が残っている：' + left.slice(0, 5).join(' / '));

console.log(fail ? `NG ${fail}件` : 'OK：脚注・折りたたみ・表・画像・飾りの片付け／ルビ（説明文は表記、宝具は読み）／因縁キャラの読み取り／公開中のリストに記法が残らない');
process.exitCode = fail ? 1 : 0;
