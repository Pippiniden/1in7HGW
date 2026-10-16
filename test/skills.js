// スキル辞書の確認：原作の代表的なスキル名が辞書で決まるか、一般的な名前は説明文と合わせて決まるか
// 使い方: node test/skills.js
for (const f of ['config', 'rank', 'parser', 'effects']) require('../js/' + f + '.js');
const assert = require('assert');
const E = globalThis.HGW.effects, R = globalThis.HGW.rank;
const res = (name, desc, rank) => E.resolveSkill({ name, rankRaw: rank || 'B', rank: R.parseRank(rank || 'B'), desc: desc || '' }, {});
const ids = r => r.effects.map(e => e.id);

// 原作のクラス別スキル・保有スキル（名前だけで辞書が引ける）
const CANON = ['対魔力', '騎乗', '陣地作成', '道具作成', '気配遮断', '狂化', '単独行動', '神性', '復讐者', '忘却補正', '自己回復(魔力)',
  '真名看破', '神明裁決', '啓示', '聖人', '領域外の生命', '女神の神核', '自陣防御', '魔力放出(炎)', '直感', '心眼(真)', '心眼(偽)',
  '千里眼', '戦闘続行', '仕切り直し', '勇猛', 'カリスマ', '皇帝特権', '黄金律', '矢除けの加護', '天性の肉体', '怪力', '無窮の武練',
  '宗和の心得', '縮地', '圏境', '中国武術', '鷹の瞳', '軍略', '高速神言', '精神汚染', '変化', '嵐の航海者', '星の開拓者', '扇動',
  '拷問技術', '吸血', '無辜の怪物', '自己改造', '破壊工作', '情報抹消', '透化', '専科百般', '信仰の加護', '魅惑の美声', '芸術審美',
  '不屈の意志', '守護騎士', '反骨の相', '理性蒸発', '愛の黒子', '殺戮技巧(人)', '霧夜の殺人', '人体理解', '蔵知の司書', '天狗の兵法',
  '神秘殺し', '鋼鉄の決意', '明鏡止水', '殉教者の魂', '風除けの加護', '無冠の武芸', '鬼種の魔', '天性の魔'];
const miss = CANON.filter(n => res(n).source !== 'dict');
assert.deepStrictEqual(miss, [], '辞書で決まらない原作スキル：' + miss.join('、'));

// 一般的な言葉の名前は、辞書を土台に説明文の効果も足す
const r1 = res('海神の加護', '海の上では自身の傷を癒やす。');
assert.strictEqual(r1.source, 'dict-partial');
assert.ok(ids(r1).includes('luck') && ids(r1).includes('regen'), ids(r1).join());
const r2 = res('従者', '家事や接客に長け、看護もこなす。');
assert.strictEqual(r2.source, 'dict-partial');
assert.ok(ids(r2).includes('negotiate') && ids(r2).includes('heal_other'));

// 説明文に書かれた他スキルの参照：「〜の複合スキル」「〜として機能」「〜の類似スキル」
assert.ok(res('刀匠', '道具作成：B-と陣地作成：B、芸術審美(武器)：Dの複合スキル。').matched.includes('陣地作成'));
assert.ok(res('始まりの英雄', 'カリスマ、軍略、護国の鬼将スキルの効果を複合。').matched.includes('カリスマ'));
assert.ok(res('吝嗇家', '同ランクの黄金律として機能しつつ、浪費を抑制する。').matched.includes('黄金律'));
// 辞書どおりの名前でも、説明文に「〜と同等」とあれば足す。「〜との混合」は辞書がもともと混合なので足さない
assert.ok(res('理性蒸発', '戦闘では「直感」と同等の能力を持つ。').matched.includes('直感'));
assert.strictEqual(res('鬼種の魔', '天性の魔、怪力、カリスマ、魔力放出等との混合スキル。').matched, '鬼種の魔');

// ランク「-」で統合・喪失と書かれたスキルは効果なし
assert.strictEqual(res('理性蒸発', '本来有するスキルだが、狂化に統合される。', '-').source, 'lost');

console.log(`ok: スキル辞書（原作スキル ${CANON.length}種・辞書 ${Object.keys(E.SKILL_DICT).length}語）`);
