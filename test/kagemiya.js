// tools/kagemiya.js の確認：表示用HTML → Wiki記法 → 解析 の結果が、Wiki記法を直接解析した結果と一致するか
// 使い方: node test/kagemiya.js
const fs = require('fs'), path = require('path'), assert = require('assert');
const K = require('../tools/kagemiya.js');
const H = globalThis.HGW;

// ページ名 → EUC-JP のURL
assert.strictEqual(K.pageUrl('ルーカン'), 'https://seesaawiki.jp/kagemiya/d/%A5%EB%A1%BC%A5%AB%A5%F3');
assert.strictEqual(K.nameFromInput('https://seesaawiki.jp/kagemiya/d/%a5%eb%a1%bc%a5%ab%a5%f3'), 'ルーカン');
assert.strictEqual(K.nameFromInput(' ペンテシレイア '), 'ペンテシレイア');

// HTML → Wiki記法
const html = fs.readFileSync(path.join(__dirname, 'kagemiya-lucan.html'), 'utf8');
assert.strictEqual(K.pageTitle(html), 'ルーカン');
const text = K.htmlToWiki(K.contentHtml(html));
const fromHtml = H.parser.parseServant(text, { noSource: true });
const fromWiki = H.parser.parseServant(fs.readFileSync(path.join(__dirname, 'lucan.txt'), 'utf8'), { noSource: true });
for (const k of ['trueName', 'class', 'stats', 'classSkills', 'skills', 'nps', 'profile', 'relations', 'voice']) {
  assert.deepStrictEqual(fromHtml[k], fromWiki[k], k + ' が一致しません');
}
// ルビ・取り消し線が Wiki 記法に戻っている
assert.ok(/&ruby\(バトラー・ザ・ラウンドテーブル\)\{円卓の忠実なる従者\}/.test(text));
assert.ok(/%%[^%]+%%/.test(text));
console.log('ok: kagemiya の変換', fromHtml.trueName, `スキル${fromHtml.classSkills.length + fromHtml.skills.length} 宝具${fromHtml.nps.length} セリフ${Object.keys(fromHtml.voice).length}種`);
