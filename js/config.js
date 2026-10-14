/* 調整用の数値と、クラスの定義はすべてここに集める。
 * ゲームバランスを変えるとき・新しいクラスを足すときはこのファイルだけ触ればよい。 */
(function (G) {
  'use strict';

  /* ---------- クラスの定義 ----------
   * 新しいクラスを足すときは、ここに1項目追加するだけでよい。
   *   label   : 表示名
   *   aliases : Wikiの【CLASS】欄でこのクラスと判定する表記（部分一致。上から順に照合）
   *   slot    : 'standard' = 通常7騎の枠を持つクラス / 'extra' = エクストラ枠
   *   weights : 戦闘力計算でのステータスの重み補正（STAT_W に掛ける。省略した項目は1）
   *   tags    : そのクラスのサーヴァントに自動で付く属性タグ（特攻の判定に使う）
   * 【CLASS】欄がどれにも当てはまらない場合は 'extra'（エクストラ）として扱い、表示名はWikiの表記をそのまま使う。
   */
  const CLASS_DEFS = {
    saber:      { label: 'セイバー',       aliases: ['セイバー', 'saber'],              slot: 'standard', weights: { str: 1.1, mag: 0.8 } },
    archer:     { label: 'アーチャー',     aliases: ['アーチャー', 'archer'],            slot: 'standard', weights: { str: 0.9, end: 0.9, agi: 1.1, mag: 0.9, luk: 1.2 } },
    lancer:     { label: 'ランサー',       aliases: ['ランサー', 'lancer'],              slot: 'standard', weights: { end: 0.9, agi: 1.2, mag: 0.8 } },
    rider:      { label: 'ライダー',       aliases: ['ライダー', 'rider'],               slot: 'standard', weights: { agi: 1.1, mag: 0.9 } },
    caster:     { label: 'キャスター',     aliases: ['キャスター', 'caster'],            slot: 'standard', weights: { str: 0.6, end: 0.8, agi: 0.8, mag: 1.6 } },
    assassin:   { label: 'アサシン',       aliases: ['アサシン', 'assassin'],            slot: 'standard', weights: { str: 0.9, end: 0.8, agi: 1.3, mag: 0.8, luk: 1.1 } },
    berserker:  { label: 'バーサーカー',   aliases: ['バーサーカー', 'berserker'],       slot: 'standard', weights: { str: 1.3, end: 1.2, mag: 0.6, luk: 0.6 } },
    // ここから下はエクストラクラス
    saver:      { label: 'セイヴァー',     aliases: ['セイヴァー', 'savior', 'saver'],   slot: 'extra' },
    ruler:      { label: 'ルーラー',       aliases: ['ルーラー', 'ruler'],               slot: 'extra', weights: { mag: 1.1, luk: 1.1 } },
    avenger:    { label: 'アヴェンジャー', aliases: ['アヴェンジャー', 'アベンジャー', 'avenger'], slot: 'extra', weights: { str: 1.1, end: 1.1 } },
    shielder:   { label: 'シールダー',     aliases: ['シールダー', 'shielder'],          slot: 'extra', weights: { end: 1.4, str: 0.9 } },
    mooncancer: { label: 'ムーンキャンサー', aliases: ['ムーンキャンサー', 'moon cancer', 'mooncancer'], slot: 'extra', weights: { mag: 1.3 } },
    alterego:   { label: 'アルターエゴ',   aliases: ['アルターエゴ', 'アルタエゴ', 'alter ego', 'alterego'], slot: 'extra' },
    foreigner:  { label: 'フォーリナー',   aliases: ['フォーリナー', 'foreigner'],       slot: 'extra', weights: { mag: 1.3 } },
    pretender:  { label: 'プリテンダー',   aliases: ['プリテンダー', 'pretender'],       slot: 'extra' },
    beast:      { label: 'ビースト',       aliases: ['ビースト', 'beast'],               slot: 'extra', weights: { str: 1.2, end: 1.2 } },
    gunner:     { label: 'ガンナー',       aliases: ['ガンナー', 'gunner'],              slot: 'extra', weights: { agi: 1.1, luk: 1.2 } },
    // どれにも当てはまらないクラス（例：ルーカンの「サーヴァント」）
    extra:      { label: 'エクストラ',     aliases: [],                                  slot: 'extra' },
  };

  G.CONFIG = {
    CLASS_DEFS,

    // 聖杯戦争の進み方（engine.js が使う）
    ENGINE: {
      maxDays: 30,          // 最長日数
      finaleDays: 3,        // 最後の何日間は好戦的になるか
      upkeep: 8,            // サーヴァントの1日の維持魔力
      manaBase: 60,         // マスターの魔力の上限＝manaBase＋魔力量スコア
      manaRegen: 12,        // 1日の魔力回復の基本値（＋魔力量×0.15＋工房×2）
      npCost: 18,           // 宝具の魔力消費＝宝具の消費倍率×npCost
      npPowerK: 0.5,        // 宝具の威力を戦闘力に足すときの係数
      huntBase: 0.5,        // 夜に出撃する基本確率
      findBase: 0.4,        // 出撃して相手を見つける基本確率
      rounds: 4,            // 1回の戦闘の打ち合い回数
      dmgBase: 28, dmgVar: 20,
      csEmergency: 0.4,     // 致命傷のとき令呪で離脱させる確率
      csSaveMaster: 0.5,    // マスターが殺されかけたとき令呪で呼び戻す確率
      recontract: 0.45,     // はぐれサーヴァントが脱落したマスターと再契約する確率（1日ごと）
      allianceBreakAt: 3,   // 残りがこの数以下になると同盟が解ける
      restHeal: 15,         // 休養での回復量
      lifeChance: 0.4,      // プレイヤーの陣営で1日に日常の出来事が起きる確率
      eventChance: 0.25,    // 1日に街の出来事（霊脈・雨・満月・討伐令など）が起きる確率
      planEvery: 3,         // 「ときどき」のとき、何日ごとに方針を聞くか（自陣営が戦った翌日も聞く）
      retreatBase: 0.2,     // 撤退の基本成功率（＋離脱−相手の逃走阻止）
      retreatAt: 35,        // 体力がこれを下回ると撤退を考える
    },

    // 聖杯戦争の組み方
    WAR: {
      slots: ['saber', 'archer', 'lancer', 'rider', 'caster', 'assassin', 'berserker'],
      extraChance: 0.3,   // 1回の戦争でエクストラクラスが1騎まぎれ込む確率
      maxExtra: 1,        // エクストラの最大数
      fillWith: 'any',    // そのクラスの候補がいないとき：'any'＝別クラスから代役 / 'extra'＝エクストラだけから代役 / 'none'＝空席
    },

    // ランクの段階（E=1 … EX=6）
    RANK_STEP: { E: 1, D: 2, C: 3, B: 4, A: 5, EX: 6 },
    // ステータスのスコア。上のランクほど差が大きくなる（約1.35〜1.4倍ずつ）
    RANK_SCORE: { E: 10, D: 20, C: 32, B: 46, A: 62, EX: 80 },
    // スキル・宝具の効果倍率（Bランク＝1.0が基準）
    RANK_MULT: { E: 0.4, D: 0.6, C: 0.8, B: 1.0, A: 1.2, EX: 1.5 },
    // 「+」1つで常時の段階に足す量と、瞬間的な倍率（原作の「+は瞬間的に2倍」準拠）
    PLUS_STEP: 0.15,
    PLUS_BURST: [1, 2, 3, 4],   // +なし, +, ++, +++
    // 「-」1つで引く段階
    MINUS_STEP: 0.25,

    // ステータスの重み（戦闘力計算用）。宝具は戦闘力ではなく宝具威力に使う
    STAT_W: { str: 1.0, end: 0.9, agi: 1.0, mag: 0.7, luk: 0.4 },

    // 宝具の種別ごとの基本値（威力倍率・魔力消費・露見しやすさ）
    NP_TYPE: {
      anti_unit:   { name: '対人', power: 1.0, cost: 1.0, exposure: 0.5 },
      anti_army:   { name: '対軍', power: 1.25, cost: 1.6, exposure: 0.8 },
      anti_fort:   { name: '対城', power: 1.6, cost: 2.5, exposure: 1.0 },
      anti_nation: { name: '対国', power: 1.9, cost: 3.2, exposure: 1.0 },
      anti_world:  { name: '対界', power: 2.2, cost: 4.0, exposure: 1.0 },
      barrier:     { name: '結界', power: 1.1, cost: 1.8, exposure: 0.7 },
      self:        { name: '対己', power: 0.8, cost: 0.8, exposure: 0.3 },
      special:     { name: '特殊', power: 1.0, cost: 1.2, exposure: 0.6 },
    },

    // 戦闘の勝率曲線の幅（戦闘力の差がこの値で約73%:27%）
    BATTLE_K: 15,

    // ステータスが読めなかったときの代わり（C相当）
    MISSING_STAT: 'C',
  };

  // 補助：クラスの定義を引く（無ければエクストラ）
  G.classDef = key => CLASS_DEFS[key] || CLASS_DEFS.extra;
  // 補助：クラスごとのステータス重み（省略項目は1）
  G.classWeights = key => Object.assign({ str: 1, end: 1, agi: 1, mag: 1, luk: 1 }, G.classDef(key).weights || {});
  // 補助：通常7騎の枠を持つクラスの一覧
  G.standardClasses = () => Object.keys(CLASS_DEFS).filter(k => CLASS_DEFS[k].slot === 'standard');
})(globalThis.HGW = globalThis.HGW || {});
