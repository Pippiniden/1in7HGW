/* マスターの性格
 *
 * 性格は陣営の戦い方を偏らせる。他の陣営の性格は最初は分からず、戦ううちに見えてくる。
 * 数値はどれも「ふつう」を0とした上乗せ。
 *   policy  : 方針の選ばれやすさ（engine.js の POLICIES と同じ名前。掛け算）
 *   hunt    : 夜に出撃する確率
 *   retreat : 撤退を試みる確率と、撤退を考え始める早さ
 *   ally    : 同盟の申し出を受ける・持ちかける確率
 *   np      : 宝具を使う確率
 *   ambush  : マスターを狙う確率（拠点への奇襲・戦闘中の一撃）
 *   betray  : 終盤に同盟を破る確率（1日ごと）
 *   cs      : 致命傷のときに令呪を切る確率
 *   bond    : サーヴァントとの絆の深まりやすさ（掛け算）
 *   origins : 出自ごとの選ばれやすさ（master.js の ORIGINS と同じ名前）
 *   reveal  : 正体が分かったときの一文（{m} はマスターの名前）
 */
(function (G) {
  'use strict';
  G.PERSONAS = {
    rational: {
      label: '冷徹な合理主義者', desc: '勝つためなら手段を選ばない。弱った相手から狙い、同盟も使い捨てる',
      policy: { aggressive: 1.5, intel: 1.5, diplomacy: 0.6 }, hunt: 0.05, retreat: 0.05, ally: 0.05, np: 0, ambush: 0.4, betray: 0.25, cs: 0.03, bond: 0.8,
      origins: { mercenary: 3, noble: 1, newblood: 1.5, civilian: 0.3, irregular: 1 },
      reveal: '{m}の采配には迷いがない。勝つためだけに駒を動かす、冷徹な合理主義者だ。',
    },
    proud: {
      label: '誇り高い魔術師', desc: '正面からの勝負を好み、同盟や撤退を恥と考える',
      policy: { aggressive: 1.4, diplomacy: 0.3 }, hunt: 0.08, retreat: -0.15, ally: -0.2, np: 0.1, ambush: -0.5, betray: 0, cs: -0.05, bond: 1,
      origins: { noble: 4, newblood: 1.5, mercenary: 0.3, civilian: 0.2, irregular: 0.8 },
      reveal: '{m}は小細工を嫌い、真っ向から挑んでくる。誇り高い魔術師だ。',
    },
    cautious: {
      label: '慎重な策略家', desc: '情報を集めて確実な勝ちを狙う。危なくなればすぐ退く',
      policy: { defensive: 1.6, intel: 1.8, aggressive: 0.6 }, hunt: -0.12, retreat: 0.15, ally: 0.05, np: -0.05, ambush: 0.1, betray: 0.1, cs: 0.06, bond: 1,
      origins: { newblood: 2.5, noble: 1.5, mercenary: 1.5, civilian: 0.8, irregular: 1 },
      reveal: '{m}は深追いせず、常に退路を残している。慎重な策略家だ。',
    },
    warmonger: {
      label: '好戦的な戦闘狂', desc: '戦いそのものを楽しむ。傷を負っても夜の街に出る',
      policy: { aggressive: 3, defensive: 0.4 }, hunt: 0.25, retreat: -0.2, ally: -0.15, np: 0.2, ambush: 0, betray: 0.1, cs: -0.1, bond: 1.1,
      origins: { irregular: 3, mercenary: 1.5, noble: 0.8, newblood: 0.8, civilian: 0.4 },
      reveal: '{m}は笑っていた。この戦いを心から楽しんでいる、好戦的な戦闘狂だ。',
    },
    kind: {
      label: '情に厚いお人好し', desc: '人を巻き込むことを嫌い、手を組める相手を探す。サーヴァントとの絆が深まりやすい',
      policy: { diplomacy: 3, defensive: 1.3, aggressive: 0.5 }, hunt: -0.1, retreat: 0.05, ally: 0.25, np: -0.1, ambush: -0.6, betray: -0.2, cs: 0.08, bond: 1.6,
      origins: { civilian: 3, newblood: 1, irregular: 1, noble: 0.5, mercenary: 0.4 },
      reveal: '{m}は戦いの最中にも、周りの人々を気にかけていた。情に厚いお人好しだ。',
    },
    timid: {
      label: '臆病な素人', desc: '戦いに慣れていない。隠れて、逃げて、令呪に頼る',
      policy: { defensive: 2, intel: 1.2, aggressive: 0.3 }, hunt: -0.2, retreat: 0.25, ally: 0.15, np: -0.05, ambush: -0.3, betray: -0.1, cs: 0.1, bond: 1.2,
      origins: { civilian: 4, newblood: 1, irregular: 0.8, noble: 0.3, mercenary: 0.2 },
      reveal: '{m}の指示は震えていた。戦いに慣れていない、臆病な素人だ。',
    },
    assassin: {
      label: '狡猾な暗殺者', desc: 'サーヴァントより先にマスターを狙う。闇討ちを好む',
      policy: { intel: 2, aggressive: 1.3, diplomacy: 0.5 }, hunt: 0.05, retreat: 0.1, ally: -0.05, np: -0.1, ambush: 1.2, betray: 0.2, cs: 0, bond: 0.9,
      origins: { mercenary: 3, irregular: 1.5, newblood: 0.8, noble: 0.4, civilian: 0.2 },
      reveal: '{m}の狙いはサーヴァントではなく、マスターの命だった。狡猾な暗殺者だ。',
    },
    ambitious: {
      label: '野心家', desc: '聖杯の先にある栄光しか見ていない。討伐令や終盤の好機を逃さない',
      policy: { aggressive: 1.6, diplomacy: 1.2 }, hunt: 0.1, retreat: 0, ally: 0.1, np: 0.05, ambush: 0.2, betray: 0.3, cs: 0, bond: 0.9,
      origins: { noble: 2, newblood: 2.5, mercenary: 1, irregular: 1, civilian: 0.5 },
      reveal: '{m}の目は、聖杯の先にある栄光を見ている。手段を選ばない野心家だ。',
    },
  };
})(globalThis.HGW = globalThis.HGW || {});
