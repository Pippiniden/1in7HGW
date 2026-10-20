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
    berserker:  { label: 'バーサーカー',   aliases: ['バーサーカー', 'berserker'],       slot: 'standard', weights: { str: 1.3, end: 1.2, mag: 0.6, luk: 0.6 }, upkeep: 1.4 },
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
      battleMana: 5,        // 1回の戦いで使う魔力（× 維持魔力の倍率。CLASS_DEFS の upkeep と燃費のスキル）
      wildMana: 3,          // バーサーカーが打ち合いごとに食う魔力（× 維持魔力の倍率）
      wildAt: 0.1,          // 制御困難がこれ以上の英霊は、バーサーカーと同じく魔力が尽きても宝具を放つ（1回の戦いに一度）
      drainLife: 2,         // 魔力が足りないとき、足りない1につきマスターの体力をこれだけ削る
      sealMana: 30,         // マスターが倒れかけたとき、令呪一画を換えて得る魔力
      spiritSave: 0.6,      // 休んだ・潜んだ日（霊体化）の維持魔力の倍率
      allyJoin: 0.3,        // 同盟相手が戦いに加勢する基本確率（＋出撃中・拠点を守る戦い・統率）
      allyAssist: 0.45,     // 加勢した味方の戦闘力のうち、戦いに足される割合
      allyCover: 0.35,      // 押し負けたとき、加勢した味方が代わりに一撃を受ける確率
      manaBase: 60,         // マスターの魔力の上限＝manaBase＋魔力量スコア
      manaRegen: 12,        // 1日の魔力回復の基本値（＋魔力量×0.15＋工房×2）
      npCost: 18,           // 宝具の魔力消費＝宝具の消費倍率×npCost
      npPowerK: 0.5,        // 宝具の威力を戦闘力に足すときの係数
      huntBase: 0.56,        // 夜に出撃する基本確率
      findBase: 0.4,        // 出撃して相手を見つける基本確率
      rounds: 4,            // 1回の戦闘の打ち合い回数
      dmgBase: 28, dmgVar: 20,
      counterDmg: 0.25,      // 打ち合いに負けた側も、与えられた傷 ×（負けた側の戦闘力 ÷ 勝った側の戦闘力）× この値を返す。
                            // 守りの固い側が粘り、強い側も無傷では勝ち進めないようにするため（0 で以前と同じ）
      csEmergency: 0.4,     // 致命傷のとき令呪で離脱させる確率
      csSaveMaster: 0.5,    // マスターが殺されかけたとき令呪で呼び戻す確率
      recontract: 0.45,     // はぐれサーヴァントが脱落したマスターと再契約する確率（1日ごと）
      allianceBreakAt: 3,   // 残りがこの数以下になると同盟が解ける
      restHeal: 15,         // 休養での回復量
      regenHeal: 40,        // 自己回復（regen）：休養の回復量に 自己回復×この値 を足す（60 では同じ量の戦闘力上昇より強かった）
      lifeChance: 0.4,      // プレイヤーの陣営で1日に日常の出来事が起きる確率
      eventChance: 0.25,    // 1日に街の出来事（霊脈・雨・満月・討伐令など）が起きる確率
      councilEvery: 5,      // 何日ごとに作戦会議（大きな決断）を開くか
      fallenDeath: 0.12,    // プレイヤーのサーヴァントが消滅したとき、マスターも巻き込まれて死ぬ確率
      stealBase: 0.04,      // 他のマスターから令呪を奪う成功率の基本値（＋魔術・幸運）
      masterStrike: 0.006,  // 戦闘の打ち合い1回ごとに、勝った側の刃が相手マスターに届く基本確率（＋マスター狙いの効果・性格）
      personaReveal: 0.35,  // 戦ったあと、相手マスターの性格が分かる確率
      retreatBase: 0.2,     // 撤退の基本成功率（＋離脱−相手の逃走阻止）
      retreatAt: 35,        // 体力がこれを下回ると撤退を考える
      // 状態異常（effects.js の poison / stun / confuse / seal）
      poisonTick: 5,        // 毒：その戦いの打ち合いのたびに削る霊基（毒では倒れない。霊基1で止まる）
      poisonDay: 10,        // 毒：翌日に削る霊基（そこで毒は抜ける）
      stunPower: 0.5,       // スタン：その打ち合いの戦闘力の倍率（宝具も使えない）
      confusePower: 0.75,   // 混乱：その打ち合いの戦闘力の倍率
      confuseSelf: 0.4,     // 混乱：自分を傷つける確率
      confuseSelfDmg: 6,    // 混乱：自分を傷つけたときの霊基の減り
      pinchAt: 40,          // 霊基がこれを下回ると「瀕死のとき」の条件が付いた効果が働く（effects.js の COND_JA の文も合わせる）
      // 守りの効果（被ダメージ軽減 guard・回避 evade・魔術耐性 magic_guard）の効き方
      defSoft: 1,           // 重なったときの鈍り：合計 x を x ÷ (1 + x × この値) にしてから使う（0 で足したまま。1 なら 0.3→0.23、1.0→0.5）
      defPowerW: 0.4,       // 被ダメージ軽減を「守りとして戦闘力」に足す割合（受ける傷の軽減とは別に、打ち合いの勝ちやすさにも効く。0.5 では同じ量の戦闘力上昇より強かった）
      defCap: 0.6,          // 守りとして戦闘力に足す分の上限
      guardDmgW: 0.5,       // 被ダメージ軽減で受ける傷を減らす割合
      guardDmgCap: 0.5,     // 受ける傷を減らす上限
      // 精神耐性（mental_guard）の効き方。魅了・混乱を防ぐ（確率＝精神耐性）ほかに、次の三つにも効く（0 で効かない）
      mentalDebuff: 0.5,    // 相手の弱体化（威圧・幻惑・呪いなど）の効きを ×(1 − 精神耐性×この値) にする（最大6割減）
      mentalSurprise: 1,    // 相手の不意打ち（先手・強襲）の上乗せを ×(1 − 精神耐性×この値) にする（動じない）
      mentalWound: 0.3,     // 傷による戦闘力の落ち込みを ×(1 − 精神耐性×この値) にする（心が折れない。最大6割減）。精神耐性は重なると鈍る（defSoft）
      // 弱体化の種類：精神弱体（debuff_mind）は精神耐性とマスターの精神で、肉体弱体（debuff_body）・衰弱（wither）は耐久と対魔力で防ぐ
      mindDebuffGuard: 1,   // 精神弱体の効きを ×(1 − 精神耐性×この値) にする（最大8割減。種類なしの弱体化は mentalDebuff）
      bodyEndGuard: 0.3,    // 肉体弱体・衰弱の効きを ×(1 − 耐久の偏差×この値 − 対魔力×bodyMagicGuard)（最大8割減）
      bodyMagicGuard: 0.5,  // 同じく、対魔力（魔術耐性）の効き
      // 衰弱（wither）：押し勝つたびなどに相手へ重なり、戦いのあとも残る
      witherCap: 0.5,       // 衰弱で下がる戦闘力の上限
      witherFade: 0.25,     // 毎朝、相手から受けた衰弱が消える確率（休んだ日のあとは ×2。自分に掛けた衰弱は消えない）
      // 見切り（dodge）・クリティカル
      dodgeCap: 0.5,        // 押し負けた一撃をかわす確率の上限
      critMult: 2,          // クリティカルヒットで与える傷の倍率（1.5 だと確率10%で傷が平均5%増えるだけで、ほとんど効かなかった）
      // 索敵（detect）：夜に相手を先に見つけたとき、仕掛ける側の上乗せ（不意打ち）。昼の偵察の選びやすさ
      detectEdge: 0.3,      // 不意打ちの上乗せ ＝ (自分の索敵 − 相手の索敵×0.5) × この値
      detectEdgeCap: 0.1,   // その上限
      detectScout: 1,       // 昼の行動で偵察を選ぶ重み +索敵×この値（以前は3で、偵察ばかりして休養・工房の強化をしなくなっていた）
      // 宝具の発動のしかた（effects.js の NP_MODES）
      npAlwaysUpkeep: 0.15, // 常時発動の宝具：毎日の維持魔力に、その宝具の魔力消費 × この値を足す
      npAlwaysScale: 1,     // 常時発動の宝具：効果の強さの倍率（1＝Wikiどおり。強すぎるなら下げる。組み立て時に掛かる）
      npAutoCost: 0.6,      // 自動で発動する宝具（戦いの始め・瀕死など）：1回の発動の魔力消費 = その宝具の魔力消費 × この値
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
    // ランクのスコア。上のランクほど差が大きくなる（約1.35〜1.4倍ずつ）。宝具の威力・マスターの能力値に使う
    RANK_SCORE: { E: 10, D: 20, C: 32, B: 46, A: 62, EX: 80 },
    // サーヴァントのステータス（筋力〜幸運）のスコア。RANK_SCORE より幅を約半分に縮めてある。
    // RANK_SCORE のままだと1ランクの差（B→A で16）が BATTLE_K とほぼ同じになり、1ランク違うだけで打ち合いの勝率が
    // 73%:27% まで開いて、強い英霊ばかりが勝ち残っていた（全E近い英霊の優勝率がほぼ0%）。C=32 はそろえてある
    STAT_SCORE: { E: 21, D: 26, C: 32, B: 39, A: 47, EX: 56 },
    // スキル・宝具の効果倍率（Bランク＝1.0が基準）
    RANK_MULT: { E: 0.4, D: 0.6, C: 0.8, B: 1.0, A: 1.2, EX: 1.5 },
    // 「+」1つで常時の段階に足す量と、瞬間的な倍率（原作の「+は瞬間的に2倍」準拠）
    PLUS_STEP: 0.15,
    PLUS_BURST: [1, 2, 3, 4],   // +なし, +, ++, +++
    // 「-」1つで引く段階
    MINUS_STEP: 0.25,

    // ステータスの重み（戦闘力計算用）。宝具は戦闘力ではなく宝具威力に使う
    STAT_W: { str: 1.0, end: 0.9, agi: 1.0, mag: 0.7, luk: 0.4 },

    // ステータスごとの役割（戦闘力への寄与とは別に、それぞれの場面に効く）。
    // ランクの偏差 d = (スコア − C相当32) ÷ 30（E≒−0.7、C=0、B≒+0.5、A≒+1.0、EX≒+1.6。−1〜+1.6に収める）に、この係数を掛けて効かせる。
    // マスターの能力値（m で始まるもの）は、サーヴァントより小さめにしてある
    STAT_FX: {
      str: 0.12,          // 筋力：打ち勝ったときに与える傷 ×(1 + 係数×d)
      end: 0.12,          // 耐久：受ける傷 ×(1 − 係数×d)
      endGuts: 0.05,      // 耐久：致命傷で踏みとどまる確率 +係数×d
      agiRetreat: 0.08,   // 敏捷：撤退の成否 ±係数×（自分のd − 相手のd）。速い側は逃げ切り、追いすがる
      agiFind: 0.05,      // 敏捷：夜に相手を捕捉する／捕捉されない ±係数×（狩る側のd − 狩られる側のd）
      magNp: 0.10,        // 魔力：宝具の威力 ×(1 + 係数×d)
      magCost: 0.10,      // 魔力：宝具の魔力消費 ×(1 − 係数×d)
      lukCrit: 0.05,      // 幸運：クリティカルヒットの確率 +係数×d（0未満にはならない）
      lukInstakill: 0.25, // 幸運：即死の一撃を受ける確率 ×(1 − 係数×d)
      lukGuts: 0.03,      // 幸運：致命傷で踏みとどまる確率 +係数×d
      mCraftFort: 0.06,   // マスターの魔術：工房の強化の成否 +係数×d
      mCraftScout: 0.04,  // マスターの魔術：偵察の成否 +係数×d
      mCraftPower: 0.03,  // マスターの魔術：戦いの援護。戦闘力 ×(1 + 係数×d)（マスターが生きているとき）
      mMindCs: 0.25,      // マスターの精神：令呪で奮い立たせたときの回復と、令呪の強化 ×(1 + 係数×d)
      mMindCharm: 0.06,   // マスターの精神：サーヴァントが魅了に抗う確率 +係数×d
      mMindSeal: 0.08,    // マスターの精神：令呪が届かない確率 −係数×d（精神が低いと、抗うスキルが無くても令呪が揺らぐことがある）。令呪でマスターを守る確率も ±係数×d
      mMindDebuff: 0.25,  // マスターの精神：相手の弱体化（精神干渉・幻惑など）がサーヴァントに効く強さ ×(1 − 係数×d)
      mMindControl: 0.25, // マスターの精神：制御の難しいサーヴァントが勝手に動く確率 ×(1 − 係数×d)
      mLuckHide: 0.04,    // マスターの幸運：夜に捕捉されにくい・マスターへの刃や奇襲を避ける +係数×d
    },

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
  // クラスのアイコン（img/classes/{クラス}.webp）。七騎のクラス以外（ルーラーなどエクストラクラス）は星の印（extra.webp）
  // 顔グラフィック：img/faces/<真名>.webp（.png・.jpg も可）。無い英霊がほとんどなので、見つかったときだけ表示する（UI が順に試す）
  G.FACE_DIR = 'img/faces/';
  G.FACE_EXT = ['webp', 'png', 'jpg'];
  G.faceCandidates = name => { const n = String(name || '').trim(); return n ? G.FACE_EXT.map(x => G.FACE_DIR + encodeURIComponent(n) + '.' + x) : []; };
  // 一度だけ順に試して、見つかった URL を覚える（ブラウザ用。見つからなければ null）。onFound は見つかったときに呼ぶ
  const faceSeen = new Map();
  G.faceUrl = (name, onFound) => {
    const n = String(name || '').trim(); if (!n || typeof Image === 'undefined') return null;
    if (faceSeen.has(n)) { const v = faceSeen.get(n); if (v && v.then) { if (onFound) v.then(u => u && onFound(u)); return null; } return v; }
    const p = new Promise(res => {
      const list = G.faceCandidates(n); let i = 0;
      const next = () => { if (i >= list.length) return res(null); const u = list[i++], im = new Image(); im.onload = () => res(u); im.onerror = next; im.src = u; };
      next();
    }).then(u => { faceSeen.set(n, u); return u; });
    faceSeen.set(n, p); if (onFound) p.then(u => u && onFound(u));
    return null;
  };
  G.classIcon = key => 'img/classes/' + (CLASS_DEFS[key] && CLASS_DEFS[key].slot === 'standard' ? key : 'extra') + '.webp';

  // ---------- 評価（S〜E） ----------
  // 開戦時の評価・リストツール・申請フォーム・強さランキングで同じものを使う。リストの全騎と1対1で戦った平均勝率の順位が
  // 上から何割にいるか（pct：0＝一番上）で決める。Fateのランクに合わせて E まで。EX は「評価不能」の意味もあるので最高は S
  G.GRADES = [['S', 0.1], ['A', 0.25], ['B', 0.45], ['C', 0.65], ['D', 0.85], ['E', 1]];
  G.gradeOfPct = pct => (G.GRADES.find(([, cut]) => pct <= cut + 1e-12) || G.GRADES[G.GRADES.length - 1])[0];

  // ---------- セリフの見出し ----------
  // Wikiの【セリフ】は「見出し：「セリフ」」の形。見出しは書き手しだいなので、ゲームが使う場面（slot）ごとに
  // 受け付ける見出しをここにまとめる。key が代表の見出し、aliases の見出しの行も同じ場面の行として一緒に使う。
  // use はリストツールに出す「ゲームで使う場面」の説明。engine.js・index.html で say/voiceLines に渡す key は
  // かならずここにあるもの（test/voice.js で確かめる）。
  const VOICE_SLOTS = [
    { key: '召喚', aliases: ['自己紹介'], use: '開戦の日、あなたがこのサーヴァントを召喚した場面' },
    { key: '開始', aliases: ['戦闘開始'], use: '夜の戦いが始まる場面（仕掛けた側が言う）' },
    { key: '宝具', aliases: [], use: '宝具を解放した場面。その宝具の名前（か読み）を含む行を優先し、別の宝具の名前を含む行は使わない' },
    { key: '戦闘不能', aliases: ['消滅', '退場'], use: '倒れて脱落する場面。倒れて終わったときの最後の一言（結果の画面）' },
    { key: '敗北', aliases: [], use: '倒れて終わったときの最後の一言（戦闘不能が無いとき）' },
    { key: '勝利', aliases: [], use: '勝ち残ったときの最後の一言（結果の画面。聖杯についてが無ければ結末の記録にも）' },
    { key: '聖杯について', aliases: ['願い', '聖杯'], use: '日常（聖杯の話）・勝ち残って聖杯が降臨する結末の記録' },
    { key: '会話', aliases: ['マイルーム', '主従関係'], use: '日常（何気ない会話）・生き残って終わったときの最後の一言' },
    { key: '好きなこと', aliases: [], use: '日常（好きなものの話）' },
    { key: '嫌いなこと', aliases: [], use: '日常（好きなものの話。好きなことが無いとき）' },
    { key: '絆', aliases: [], use: '日常（絆が深まったとき）・終わったときの最後の一言（ほかの場面が無いとき）' },
  ];
  // ゲームでは使わないが、よく使われるテンプレートの見出し（リストツールで「使わない見出し」と分かるように）
  const VOICE_UNUSED = [
    ['戦闘中の掛け声', ['スキル', '選択', '攻撃', 'アタック', 'EX', '宝具選択', '小ダメージ', 'ダメージ', '大ダメージ']],
    ['成長', ['レベルアップ', '霊基再臨', '第一再臨', '第二再臨', '第三再臨', '最終']],
    ['行事・その他', ['イベント', '誕生日', '放置']],
  ];
  const VOICE_OF = {};
  for (const s of VOICE_SLOTS) for (const h of [s.key].concat(s.aliases)) VOICE_OF[h] = s.key;
  G.VOICE_SLOTS = VOICE_SLOTS;
  G.VOICE_UNUSED = VOICE_UNUSED;
  // 見出し → それを使う場面の key（使わない見出しは null）。「宝具2」「会話その3」のような番号付きも同じ場面
  G.voiceSlotOf = heading => { const h = String(heading || '').trim(); return VOICE_OF[h] || VOICE_OF[h.replace(/\s*(その)?[0-9０-９]+$/, '')] || null; };
  // その場面の見出し（代表の見出し → 別名 → 番号付きなど、ほかの見出しは Wiki の順）
  G.voiceHeadings = (voice, key) => {
    const s = VOICE_SLOTS.find(x => x.key === key), first = s ? [s.key].concat(s.aliases) : [key];
    const v = voice || {};
    return first.filter(h => v[h]).concat(Object.keys(v).filter(h => !first.includes(h) && G.voiceSlotOf(h) === key));
  };
  // 場面の行をすべて
  G.voiceLines = (sv, key) => {
    const v = (sv && sv.voice) || {};
    return [].concat(...G.voiceHeadings(v, key).map(h => v[h] || [])).filter(l => l && String(l).trim());
  };
  // 宝具を解放したときに使える行（その宝具の名前・読みを含む行を優先。別の宝具の名前を含む行は除く）
  G.npVoiceLines = (sv, np) => {
    const lines = G.voiceLines(sv, '宝具');
    const flat = l => String(l).replace(/[\s・]/g, '');
    const keys = [np.name, np.reading].filter(Boolean).map(flat);
    const others = ((sv && sv.nps) || []).filter(n => n !== np && n.name !== np.name).flatMap(n => [n.name, n.reading]).filter(x => x && x.length >= 2).map(flat);
    const mine = lines.filter(l => keys.some(k => flat(l).includes(k)));
    return mine.length ? { lines: mine, named: true } : { lines: lines.filter(l => !others.some(k => flat(l).includes(k))), named: false };
  };
})(globalThis.HGW = globalThis.HGW || {});
