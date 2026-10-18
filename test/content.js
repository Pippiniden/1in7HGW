// 内容の手直し（overrides.json の content / effects.js の CONTENT_OVERRIDES）の確認
// 使い方: node test/content.js
for (const f of ['config', 'rank', 'parser', 'effects', 'fgoskills', 'build']) require('../js/' + f + '.js');
const fs = require('fs'), path = require('path'), assert = require('assert');
const H = globalThis.HGW, B = H.build, E = H.effects;

const wikiText = fs.readFileSync(path.join(__dirname, 'lucan.txt'), 'utf8');
const plain = B.importServant(wikiText, { noSource: true });
const name = plain.trueName;
const skillNames = sv => sv.allSkills.map(s => s.name);

// 1) スキルを1つ消して1つ足す・宝具を1つ消す・セリフと解説を書き換える
const wiki = B.wikiOf(plain);
const skills = B.contentOf(wiki, 'skills').filter(s => s.name !== '騎乗');
skills.push({ group: 'own', name: '黄金律', rankRaw: 'B', desc: '手で足したスキル' });
E.CONTENT_OVERRIDES[name] = {
  skills,
  nps: B.contentOf(wiki, 'nps').slice(0, 1),
  voice: { 召喚: ['テスト用のセリフ'] },
  text: Object.assign(B.contentOf(wiki, 'text'), { commentary: '書き換えた解説' }),
  base: { skills: B.hashOf(B.contentOf(wiki, 'skills')), nps: B.hashOf(B.contentOf(wiki, 'nps')) },
};
const edited = B.fromJSON(B.toLean(plain));
assert.ok(!skillNames(edited).includes('騎乗'), '消したスキルが残っている');
assert.ok(skillNames(edited).includes('黄金律'), '足したスキルが無い');
assert.strictEqual(edited.allSkills.find(s => s.name === '黄金律').effectSource, 'dict', '足したスキルに辞書の効果が付いていない');
assert.strictEqual(edited.nps.length, 1);
assert.deepStrictEqual(edited.voice, { 召喚: ['テスト用のセリフ'] });
assert.strictEqual(edited.text.commentary, '書き換えた解説');
assert.deepStrictEqual(edited.contentEdited.sort(), ['nps', 'skills', 'text', 'voice']);
assert.ok(!edited.review.some(r => r.kind === 'content'), 'Wikiが変わっていないのに警告が出ている');

// 2) 公開用（toLean）は Wiki の値で書き出す
const lean = B.toLean(edited);
assert.ok(!('_wiki' in lean) && !('contentEdited' in lean));
assert.deepStrictEqual(lean.voice, plain.voice);
assert.strictEqual(lean.nps.length, plain.nps.length);

// 3) リストに保存した形（_wiki 付き）から組み直しても同じ
const again = B.fromJSON(JSON.parse(JSON.stringify(edited)));
assert.deepStrictEqual(skillNames(again), skillNames(edited));

// 4) 手直しを消すと Wiki の内容に戻る
const saved = E.CONTENT_OVERRIDES[name];
delete E.CONTENT_OVERRIDES[name];
const reset = B.fromJSON(JSON.parse(JSON.stringify(edited)));
assert.deepStrictEqual(skillNames(reset), skillNames(plain));
assert.deepStrictEqual(reset.voice, plain.voice);

// 5) 手直し込みで書き出したJSONを別のブラウザで読むと、手直し表に戻る
assert.strictEqual(B.harvestOverrides([JSON.parse(JSON.stringify(edited))]), 1);
assert.deepStrictEqual(E.CONTENT_OVERRIDES[name].skills, saved.skills);
assert.strictEqual(E.CONTENT_OVERRIDES[name].base.skills, saved.base.skills);

// 6) 手直しの後に Wiki 側が変わったら要確認に出る
E.CONTENT_OVERRIDES[name].base.skills = 'old';
assert.ok(B.fromJSON(lean).review.some(r => r.kind === 'content' && r.target === 'スキル'));
delete E.CONTENT_OVERRIDES[name];

// 7) 同じ名前のスキルが2つあると要確認に出る
const dup = B.importServant(wikiText.replace('*【保有スキル】', '*【保有スキル】\n**戦闘続行：B\n二重に書かれた同じスキル'), { noSource: true });
assert.ok(dup.review.some(r => r.kind === 'skill' && r.target === '戦闘続行' && /複数/.test(r.why)));

console.log('ok: 内容の手直し');
