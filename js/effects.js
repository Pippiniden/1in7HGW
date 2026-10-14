/* スキル・宝具の「効果の部品」と、スキル名→部品の割り当て表
 *
 * 考え方：
 *   - ゲームのエンジンが理解するのは EFFECTS に並んだ部品だけ。
 *   - Wiki のスキルは名前も効果も自由なので、
 *       1) 手で直した上書き  2) 既知スキルの辞書  3) 説明文の解析（キーワード＋他スキルの参照）  4) 仮の効果
 *     の順で決める。
 *   - 後から手で直すときは SKILL_OVERRIDES（全体）か SERVANT_OVERRIDES（そのサーヴァントだけ）に書く。
 *     ステータスの手直しは STAT_OVERRIDES に書く。
 *
 * 効果の強さ = 部品の基準値(base) × 割り当て係数 × ランク倍率（B=1.0, A=1.2, EX=1.5 …）
 *   fixed: true の部品はランク倍率を掛けない。byRank がある部品はランクごとの表を使う。
 */
(function (G) {
  'use strict';
  const R = G.rank;

  // ---------- 効果の部品 ----------
  // phase: エンジンのどの場面で参照するか
  //   passive=常時 / battle=戦闘中 / damage=被ダメージ時 / lethal=致命傷時 / encounter=遭遇判定 / retreat=撤退判定
  //   scout=偵察・情報収集 / day=昼の行動 / upkeep=魔力の維持 / talk=交渉・同盟 / master=マスター関連 / np=宝具使用時
  // unit: rate=割合(+0.10 で10%) / chance=確率 / days=日数 / pt=ポイント / flag=有無
  // params.cond を持つ効果は、その条件（'水辺' など）を満たす場面でだけ働く
  const EFFECTS = {
    // 戦闘
    power:        { name: '戦闘力上昇',   phase: 'battle',    unit: 'rate',   base: 0.10, desc: '戦闘力に加算' },
    power_vs:     { name: '特攻',         phase: 'battle',    unit: 'rate',   base: 0.30, desc: '特定の相手（params.tag）にだけ戦闘力上昇' },
    debuff:       { name: '弱体化',       phase: 'battle',    unit: 'rate',   base: 0.10, desc: '相手の戦闘力を下げる' },
    crit:         { name: '会心',         phase: 'battle',    unit: 'chance', base: 0.10, desc: '大ダメージを与える確率' },
    pierce:       { name: '防御無視',     phase: 'battle',    unit: 'chance', base: 0.25, desc: '相手の回避・軽減・対魔力・致命傷耐性を無視する確率（必中など）' },
    instakill:    { name: '即死',         phase: 'battle',    unit: 'chance', base: 0.05, desc: '戦闘力に関係なく相手を倒す確率' },
    evade:        { name: '回避',         phase: 'battle',    unit: 'chance', base: 0.10, desc: '攻撃を避ける確率' },
    initiative:   { name: '先手',         phase: 'battle',    unit: 'chance', base: 0.15, desc: '先制できる確率' },
    charm:        { name: '魅了',         phase: 'battle',    unit: 'chance', base: 0.10, desc: '相手が攻撃をためらう確率' },
    rally:        { name: '統率',         phase: 'battle',    unit: 'rate',   base: 0.05, desc: '同盟中の味方の戦闘力を上げる' },
    anti_master:  { name: 'マスター狙い', phase: 'battle',    unit: 'chance', base: 0.15, desc: '敵マスターを直接狙える確率' },
    // 被ダメージ・生存
    guard:        { name: '被ダメージ軽減', phase: 'damage',  unit: 'rate',   base: 0.10, desc: '受けるダメージを減らす（マイナスなら打たれ弱い）' },
    magic_guard:  { name: '魔術耐性',     phase: 'damage',    unit: 'rate',   base: 0.30, desc: '魔術・魔力による攻撃を減らす。マスターの魔術による妨害も防ぐ' },
    mental_guard: { name: '精神耐性',     phase: 'battle',    unit: 'chance', base: 0.40, desc: '魅了・恐怖・説得に抵抗する確率' },
    guts:         { name: '致命傷耐性',   phase: 'lethal',    unit: 'chance', base: 0.35, desc: '倒れるはずの一撃で踏みとどまる確率' },
    weakness:     { name: '弱点',         phase: 'damage',    unit: 'rate',   base: 0.30, desc: '特定の相手（params.tag）から受けるダメージが増える（不利な効果）' },
    master_guard: { name: 'マスター護衛', phase: 'damage',    unit: 'chance', base: 0.20, desc: 'マスターが狙われたときに守る確率' },
    // 遭遇・情報
    stealth:      { name: '隠密',         phase: 'encounter', unit: 'chance', base: 0.25, desc: '敵に見つからない確率' },
    detect:       { name: '索敵',         phase: 'encounter', unit: 'chance', base: 0.20, desc: '敵を見つける・待ち伏せを見抜く確率' },
    intel:        { name: '情報収集',     phase: 'scout',     unit: 'rate',   base: 0.20, desc: '偵察で得られる情報量' },
    reveal:       { name: '看破',         phase: 'encounter', unit: 'chance', base: 0.15, desc: '遭遇時に相手の真名・宝具を見抜く確率' },
    conceal:      { name: '情報秘匿',     phase: 'encounter', unit: 'chance', base: 0.25, desc: '自分の真名を見抜かれにくくする（マイナスなら見抜かれやすい）' },
    escape:       { name: '離脱',         phase: 'retreat',   unit: 'chance', base: 0.20, desc: '撤退の成功率' },
    pin:          { name: '逃走阻止',     phase: 'retreat',   unit: 'chance', base: 0.25, desc: '相手の撤退を妨げる確率' },
    // 昼・維持
    regen:        { name: '自己回復',     phase: 'day',       unit: 'rate',   base: 0.10, desc: '1日ごとの自分の傷の回復量' },
    heal_other:   { name: '治療',         phase: 'day',       unit: 'rate',   base: 0.10, desc: 'マスターや味方の傷を回復' },
    territory:    { name: '陣地',         phase: 'day',       unit: 'rate',   base: 0.20, desc: '拠点で戦うときの有利と、工房強化の伸び' },
    craft:        { name: '道具作成',     phase: 'day',       unit: 'chance', base: 0.15, desc: '1日ごとに役立つ道具を得る確率' },
    resource:     { name: '資源獲得',     phase: 'day',       unit: 'rate',   base: 0.20, desc: '資金や物資が集まりやすい' },
    upkeep_down:  { name: '魔力効率',     phase: 'upkeep',    unit: 'rate',   base: 0.15, desc: '維持に必要な魔力を減らす' },
    upkeep_up:    { name: '魔力消費増',   phase: 'upkeep',    unit: 'rate',   base: 0.30, desc: '維持に必要な魔力が増える（不利な効果）' },
    solo:         { name: '単独行動',     phase: 'upkeep',    unit: 'days',   base: 2, byRank: { E: 0.5, D: 1, C: 1, B: 2, A: 7, EX: 30 }, desc: 'マスターを失っても現界できる日数' },
    uncontrolled: { name: '制御困難',     phase: 'day',       unit: 'chance', base: 0.10, desc: '命令に従わず勝手に動く確率（不利な効果）' },
    // 交渉・マスター
    negotiate:    { name: '交渉',         phase: 'talk',      unit: 'chance', base: 0.20, desc: '交渉・同盟・戦闘回避の成功率（マイナスなら交渉不能に近づく）' },
    cs_resist:    { name: '令呪耐性',     phase: 'master',    unit: 'chance', base: 0.25, desc: '令呪の強制力に抵抗する確率（命令が効きにくい）' },
    master_buff:  { name: 'マスター強化', phase: 'master',    unit: 'pt',     base: 10,   desc: 'マスターの能力値（params.stat）を上げる' },
    luck:         { name: '幸運補正',     phase: 'passive',   unit: 'chance', base: 0.10, desc: '失敗した判定をやり直せる確率（マイナスなら成功した判定が失敗に変わる）' },
    tag:          { name: '属性付与',     phase: 'passive',   unit: 'flag',   base: 1, fixed: true, desc: '特攻の対象になる属性（params.tag）を持つ' },
    // 宝具使用時
    np_boost:     { name: '宝具強化',     phase: 'np',        unit: 'rate',   base: 0.15, desc: '宝具の威力' },
    np_cost:      { name: '宝具消費',     phase: 'np',        unit: 'rate',   base: 0.30, desc: '宝具の魔力消費の増減（マイナスで軽くなる）' },
    backfire:     { name: '反動',         phase: 'np',        unit: 'rate',   base: 0.30, desc: '宝具を使うと自分も傷つく' },
    self_retire:  { name: '自滅',         phase: 'np',        unit: 'chance', base: 1.0, fixed: true, desc: '宝具を使うと自分が脱落する確率' },
    disabled:     { name: '使用不可',     phase: 'np',        unit: 'flag',   base: 1, fixed: true, desc: 'この宝具は今回の召喚では使えない' },
  };

  // ---------- 既知のスキル辞書 ----------
  // 書式: 'スキル名': [[部品ID, 係数, params], ...]  係数は省略すると1
  // 照合では括弧を無視する（「魔力放出(炎)」は「魔力放出」）。名前の一部一致も使う（最長一致）。
  const SKILL_DICT = {
    '対魔力':       [['magic_guard', 1.5]],
    '騎乗':         [['initiative', 0.5], ['escape', 0.7]],
    '陣地作成':     [['territory', 1]],
    '道具作成':     [['craft', 1]],
    '気配遮断':     [['stealth', 1.5], ['anti_master', 0.7]],
    '単独行動':     [['solo', 1], ['upkeep_down', 0.5]],
    '単独顕現':     [['solo', 2], ['upkeep_down', 0.8]],
    '狂化':         [['power', 1.5], ['upkeep_up', 1], ['uncontrolled', 1], ['mental_guard', 1], ['negotiate', -2]],
    '神性':         [['tag', 1, { tag: '神性' }], ['power', 0.3], ['magic_guard', 0.2]],
    '女神の神核':   [['tag', 1, { tag: '神性' }], ['mental_guard', 1], ['guard', 0.4]],
    '戦闘続行':     [['guts', 1]],
    '心眼(真)':     [['evade', 0.7], ['power', 0.5]],
    '心眼(偽)':     [['evade', 1], ['initiative', 0.4]],
    '直感':         [['evade', 1], ['initiative', 0.4]],
    '啓示':         [['evade', 0.5], ['detect', 0.5], ['intel', 0.5]],
    '千里眼':       [['detect', 1], ['reveal', 0.5], ['intel', 0.5]],
    '気配感知':     [['detect', 1]],
    '鑑識眼':       [['reveal', 1]],
    '人間観察':     [['reveal', 0.7], ['intel', 0.5]],
    '貧者の見識':   [['reveal', 1]],
    '魔力放出':     [['power', 1.2], ['upkeep_up', 0.4]],
    '怪力':         [['power', 0.8], ['upkeep_up', 0.2]],
    '勇猛':         [['mental_guard', 1], ['power', 0.3]],
    'カリスマ':     [['negotiate', 0.8], ['rally', 1]],
    '軍略':         [['intel', 0.5], ['guard', 0.4]],
    '黄金律':       [['resource', 1]],
    '黄金率':       [['resource', 1]],   // Wikiでよく見る表記
    '仕切り直し':   [['escape', 1.5]],
    '矢避けの加護': [['evade', 0.8]],
    '精神汚染':     [['mental_guard', 1.5], ['negotiate', -1]],
    '魅了':         [['charm', 1]],
    '魔術':         [['power', 0.6], ['craft', 0.3], ['territory', 0.3]],
    '原初のルーン': [['power', 0.5], ['magic_guard', 0.3], ['craft', 0.4]],
    'ルーン':       [['power', 0.4], ['craft', 0.3]],
    '高速詠唱':     [['np_boost', 0.3], ['power', 0.4], ['initiative', 0.5]],
    '高速神言':     [['np_boost', 0.5], ['power', 0.5], ['initiative', 0.7]],
    '自己改造':     [['power', 0.7], ['negotiate', -0.3]],
    '無窮の武練':   [['power', 0.6], ['mental_guard', 1]],
    '天性の肉体':   [['power', 0.4], ['guard', 0.5], ['regen', 0.3]],
    '天性の魔':     [['power', 0.8], ['guard', 0.4]],
    '鬼種の魔':     [['power', 0.7], ['mental_guard', 0.4], ['rally', 0.3], ['upkeep_up', 0.2]],
    '皇帝特権':     [['power', 0.5], ['negotiate', 0.5]],
    '専科百般':     [['power', 0.3], ['intel', 0.3], ['craft', 0.2]],
    '情報抹消':     [['conceal', 1.5]],
    '変化':         [['conceal', 0.8]],
    '無辜の怪物':   [['power', 0.4], ['conceal', -0.6]],
    '自己回復':     [['regen', 0.6], ['upkeep_down', 0.6]],
    '吸血':         [['regen', 0.8], ['power', 0.2]],
    '嵐の航海者':   [['rally', 0.6], ['escape', 0.5]],
    '竜殺し':       [['power_vs', 1, { tag: '竜' }]],
    '獣殺し':       [['power_vs', 1, { tag: '獣' }]],
    '獣狩り':       [['power_vs', 1, { tag: '獣' }]],
    '神殺し':       [['power_vs', 1, { tag: '神性' }]],
    '対英雄':       [['debuff', 1]],
    '透化':         [['mental_guard', 1], ['stealth', 0.5]],
    '圏境':         [['stealth', 1.2], ['evade', 0.5]],
    '縮地':         [['initiative', 1], ['escape', 0.8]],
    '守護騎士':     [['master_guard', 1.2], ['guard', 0.4]],
    '頑健':         [['guard', 0.8]],
    '被虐体質':     [['guard', 0.3]],
    '加虐体質':     [['power', 0.6], ['negotiate', -0.3]],
    '星の開拓者':   [['luck', 1], ['power', 0.3]],
    '宗和の心得':   [['conceal', 0.8], ['power', 0.3]],
    '二重召喚':     [['power', 0.3]],
    '話術':         [['negotiate', 1]],
    '扇動':         [['negotiate', 0.7]],
    '友誼の証明':   [['negotiate', 1]],
    '動物会話':     [['intel', 0.6], ['detect', 0.4]],
    '医術':         [['heal_other', 1.2]],
    '治癒魔術':     [['heal_other', 1], ['regen', 0.3]],
    '芸術審美':     [['reveal', 0.8]],
    '射撃':         [['power', 0.5], ['initiative', 0.3]],
    '投擲':         [['power', 0.4], ['initiative', 0.3]],
    '破壊工作':     [['anti_master', 0.5], ['debuff', 0.5]],
    '諜報':         [['intel', 1], ['stealth', 0.3]],
    '海賊の誉れ':   [['guts', 0.6], ['power', 0.3]],
    '幸運':         [['luck', 1]],
  };
  // 説明文で「〇〇と同等」と参照されても拾わない、一般的すぎる名前
  const COMPOUND_SKIP = new Set(['魔術', '幸運', '射撃', '投擲', '変化', '話術', '医術', 'ルーン', '吸血', '神性']);

  // ---------- 属性タグの正規化（特攻・弱点の照合用） ----------
  const TAG_CANON = [
    ['獣', /獣|動物|野生/], ['竜', /竜|龍|ドラゴン/], ['神性', /神性|神霊|神格|神々|神獣以外の神/], ['不死', /不死|アンデッド|死者|亡霊|吸血鬼/],
    ['魔性', /魔性|悪魔|魔物|妖怪|怪異/], ['英雄', /英雄|英霊/], ['人型', /人型|人間|人類/], ['女性', /女性|女/], ['男性', /男性|男/],
    ['騎乗', /騎乗|騎兵/], ['機械', /機械|機甲|ロボ/], ['王', /王|皇帝/],
  ];
  function canonTag(s) {
    const t = String(s || '').trim();
    for (const [tag, re] of TAG_CANON) if (re.test(t)) return tag;
    return t.replace(/^[をにへのと]|[にへのをと]$/g, '').slice(-6);
  }

  // ---------- 説明文の解析規則 ----------
  // 文（。や改行で区切った1文）ごとに上から順に照合する。上にあるものほど優先。
  //   re   : 当たる表現
  //   not  : 同じ文にこれがあれば当てない
  //   id,f : 部品と係数（f が関数なら文から計算）
  //   p    : params（関数なら文から計算）
  //   only : 'skill' / 'np' で対象を限定
  //   cond : true なら文中の場所の条件（水辺など）を params.cond に付ける
  const RULES = [
    { re: /脱落する|自爆|(?:自分|自身)が爆発|自身[^。]{0,6}爆発|連行/, id: 'self_retire', only: 'np', f: sen => /(?:と|ると|たら|れば|場合)[^。]{0,4}(?:自爆|脱落|爆発)/.test(sen) ? 0.2 : 1 },
    { re: /(?:この召喚|この霊基|今回の召喚|現界では)[^。]*(?:使用|発動)(?:することが|は)?(?:出来|でき)ない/, id: 'disabled', only: 'np' },
    { re: /反動|自身が耐えきれ|自分も傷|自傷|肛門が裂け/, id: 'backfire', only: 'np' },
    { re: /即死/, id: 'instakill', not: /打ち消|無効|耐性|防ぐ|防げ/ },
    { re: /必中|防御は無意味|防御を無視|対魔力[^。]{0,8}(?:影響を受けない|無視|貫)|(?:死|蘇生|戦闘続行|耐性|防御|再生)[^。]{0,12}(?:無効化|無意味|効果を発揮しない)/, id: 'pierce' },
    { re: /(?:相手|敵)[^。]{0,10}(?:逃走|撤退|離脱|逃げ)|逃走手段は無|逃さない|逃がさない|拘束|緊縛|閉じ込め|捕縛|引きずりこ/, id: 'pin', not: /令呪/ },
    { re: /(?:パラメーター|パラメータ|ステータス|能力)[^。]{0,8}(?:ダウン|低下させ|下げ)|弱体化|デバフ|判断力を鈍|生命力を[^。]{0,10}奪|呪いを(?:かけ|与え)|奪われる|恐怖へと変換/, id: 'debuff', not: /(?:自身|自分)[^。]{0,6}(?:ダウン|低下|下が|マイナス)|デバフ[^。]{0,10}(?:難し|至難|効かな|無効)/ },
    { re: /判定に失敗|ドジ|うっかり|ペナルティ/, id: 'luck', f: -1, not: /相手|敵/ },
    { re: /主人公補正|悪運|運命力|豪運|強運/, id: 'luck' },
    { re: /打たれ弱|虚弱|紙装甲|耐久[^。]{0,8}マイナス/, id: 'guard', f: -1.2 },
    { re: /令呪[^。]{0,12}(?:拘束力が弱|効かない|抵抗|無効)/, id: 'cs_resist' },
    { re: /会心|クリティカル|かいしん|与ダメージ向上/, id: 'crit' },
    { re: /生き延び|致命傷|瀕死|食いしば|ガッツ|蘇生|復活|消滅寸前/, id: 'guts', not: /即死[^。]*(?:付与|判定)|無効化する|効果を発揮しない|無意味/ },
    { re: /増殖|増えて|増えている|分裂|分身/, id: 'guts', f: 0.8 },
    { re: /特[攻効]/, id: 'power_vs', p: (sen, m) => ({ tag: canonTag(sen.slice(Math.max(0, m.index - 24), m.index)) }) },
    { re: /黄金律|黄金率|財産|財宝|宝物|宝石|貴金属|金品|金銭|資金|収入|財を/, id: 'resource', f: 0.8 },
    { re: /作成|製作|錬成|鍛冶|調合|生産|量産/, id: 'craft', f: 0.8, only: 'skill' },
    { re: /交渉|宥め|説得|外交|弁舌|接客|もてなし|意思疎通|証言誘導/, id: 'negotiate' },
    { re: /統率|指揮|鼓舞|士気|軍団|自軍|兵たち|演奏|歌唱|竪琴/, id: 'rally', f: 0.8 },
    { re: /魅了|魅惑|虜|誘惑|媚び/, id: 'charm' },
    { re: /(?:自身|自分)[^。]{0,8}(?:回復|再生)|自己回復|再生能力/, id: 'regen' },
    { re: /治療|治癒|回復|看護|手当|バッドステータスを除/, id: 'heal_other', f: 0.8, not: /(?:自身|自分)[^。]{0,8}(?:回復|再生)/ },
    { re: /(?:真名|正体|素性)を?(?:悟らせ|隠|偽|知られ)|隠蔽|偽装|秘匿|変装|見せかけ|表記のみ/, id: 'conceal' },
    { re: /気配[^。]{0,6}(?:消|断)|隠密|潜伏|姿を消|透明|潜ん|バレない|感知は[^。]*不可能/, id: 'stealth' },
    { re: /見抜|看破|見破|暴く|解析|識別|鑑定/, id: 'reveal' },
    { re: /探知|感知|索敵|察知|千里眼|遠くまで見|見通/, id: 'detect', not: /感知は[^。]*不可能/ },
    { re: /情報|諜報|調査|偵察|研究|観察/, id: 'intel', f: 0.8 },
    { re: /回避|避け|かわし|躱/, id: 'evade' },
    { re: /先手|先制|奇襲|俊敏|神速|高速移動|最高速|加速|跳躍|ジャンプ|脚力|機動力/, id: 'initiative', cond: true },
    { re: /逃走|撤退|離脱|逃げ|飛行|空を(?:飛|走)|天馬|跳び越/, id: 'escape', not: /(?:相手|敵)[^。]{0,10}(?:逃走|撤退|離脱|逃げ)|逃さない|逃がさない|逃走手段|逃げるしか/ },
    { re: /魔術[^。]{0,10}(?:無効|防|耐性|弾)|対魔力/, id: 'magic_guard', not: /対魔力[^。]{0,8}(?:影響を受けない|を?無視|を?貫)/ },
    { re: /精神[^。]{0,8}(?:耐性|干渉を|無効)|精神デバフ[^。]{0,6}(?:難|効かな|無効)|動じない|恐怖を(?:感じ|知ら)/, id: 'mental_guard' },
    { re: /防御|頑丈|堅牢|盾|守り|守る|鎧|防ぐ|胴丸|耐久[^。]{0,6}(?:上昇|ランクアップ|向上)/, id: 'guard', not: /防御は無意味|マイナス/, cond: true },
    { re: /陣地|工房|結界|拠点|神殿|戦闘空間|領域/, id: 'territory', not: /対界宝具で/ },
    { re: /燃費が(?:良|いい)|魔力消費[^。]{0,8}(?:少|軽|抑|格安)/, id: 'upkeep_down', only: 'skill' },
    { re: /魔力消費[^。]{0,8}(?:軽|少|格安|抑)/, id: 'np_cost', f: -1, only: 'np' },
    { re: /燃費(?:が|は)?(?:悪|すこぶる悪)|コスパが(?:悪|非常によろしくない)|魔力消費(?:が|も)?(?:高|大き|相応)|高い魔力を必要|魔力を大量/, id: 'np_cost', only: 'np' },
    { re: /燃費(?:が|は)?悪|魔力消費(?:が|も)?(?:高|大き)/, id: 'upkeep_up', only: 'skill' },
    { re: /単独|マスター不在|現界を維持/, id: 'solo', f: 0.7 },
    { re: /理性[^。]{0,8}(?:失|奪|引き換え|蒸発)|暴走|言うことを聞かない|勝手に/, id: 'uncontrolled', f: 0.7 },
    { re: /攻撃力|威力|膂力|怪力|筋力[^。]{0,8}(?:上昇|向上|ランクアップ)|ステータス[^。]{0,8}(?:上昇|向上|強化)|強化され|戦闘能力を向上|大幅に上昇/, id: 'power', f: 0.8, cond: true },
  ];
  // 場所などの条件
  const CONDS = [['水辺', /水場|水辺|海上|海で|海に|水中|川で/], ['森', /森の中|森で|樹木|木々/], ['山', /山中|山で/], ['夜', /夜間|夜に|暗闇/]];
  // マスターを強化する文（「マスターに幸運の加護を与える」など）
  const MASTER_STAT_WORDS = [['luck', /幸運/], ['mana', /魔力/], ['craft', /魔術/], ['body', /体力|肉体|身体/], ['mind', /精神/]];

  // 宝具の攻撃・非攻撃の判定
  const ATTACK_WORDS = /攻撃|ダメージ|破壊|斬|貫|焼き|焼却|灼き|薙ぎ|放つ|放たれ|砲撃|一撃|殲滅|消し飛|吹き飛|撃ち|殺す|殺害|穿|叩き|粉砕|蹂躙|射撃|呑み込|丸呑|飲み込|喰らい|陥没|溶か|溶断|爆発|爆撃|突撃|突進|踏み潰|掃射|投擲|投げつけ|ビーム|切り裂|引き裂|雷撃|ぶっ飛|一掃|連射|乱射|射出|発射/;
  const NON_ATTACK = /(?:破壊力|攻撃力|殺傷力|攻撃能力)(?:は|を)?(?:持たない|無い|ない)|攻撃(?:は|が)?(?:行えない|出来ない|できない)|戦いは出来ない|戦闘は出来ない/;
  const PERSIST_WORDS = /消滅しようとも|消滅後も|消滅しても|死後も|脱落後も|退去後も/;
  const LOST_WORDS = /失われ|喪失|消失|封じられ|持たない|使えない|機能しない/;

  // ---------- 手直し用の表（取り込みツールやゲーム側から追加する） ----------
  const SKILL_OVERRIDES = {};    // 'スキル名': [[部品ID, 係数, params], ...]
  const SERVANT_OVERRIDES = {};  // '真名/スキル名または宝具名': [[...]]
  const STAT_OVERRIDES = {};     // '真名': { str: 'B', end: 'C', ... }  書いた項目だけ置き換える
  const NP_OVERRIDES = {};       // '真名/宝具名': { attack: true|false }  攻撃宝具かどうかの手直し

  // ---------- 名前の正規化と照合 ----------
  function normName(s) {
    return R.normalize(s).replace(/[【】『』「」\s]/g, '').replace(/[（]/g, '(').replace(/[）]/g, ')');
  }
  const baseName = s => s.replace(/\(.*?\)/g, '');
  function lookupDict(name) {
    const n = normName(name);
    if (SKILL_DICT[n]) return { key: n, how: 'exact' };
    const b = baseName(n);
    if (SKILL_DICT[b]) return { key: b, how: 'base' };
    let best = null;
    for (const k of Object.keys(SKILL_DICT)) if (k.length >= 2 && b.includes(baseName(k)) && (!best || k.length > best.length)) best = k;
    return best ? { key: best, how: 'partial' } : null;
  }

  // 割り当て表の1行から効果インスタンスを作る
  function instantiate(spec, rank, from, source) {
    const [id, factor = 1, params] = spec;
    const def = EFFECTS[id];
    if (!def) return null;
    const rk = rank && rank.base ? rank : null;
    const mult = rk ? rk.mult : 0.8; // ランク無し・不明はC相当
    let mag;
    if (def.fixed) mag = def.base * factor;
    else if (def.byRank && rk) mag = (def.byRank[rk.base] != null ? def.byRank[rk.base] : def.base) * factor;
    else mag = def.base * factor * mult;
    return { id, name: def.name, phase: def.phase, unit: def.unit, mag: Math.round(mag * 1000) / 1000, factor, params: params || null, from, source };
  }

  const sentences = text => String(text || '').split(/[。\n]+/).map(s => s.trim()).filter(Boolean);

  // 説明文を1文ずつ解析して [部品ID, 係数, params] の並びを返す
  function analyzeText(text, kind, limit) {
    const out = [], seen = new Map();
    const push = (id, f, p) => {
      const key = id + (p ? JSON.stringify(p) : '');
      if (seen.has(key)) { const s = seen.get(key); s[1] = Math.abs(f) > Math.abs(s[1]) ? f : s[1]; return; }
      const spec = p ? [id, f, p] : [id, f]; seen.set(key, spec); out.push(spec);
    };
    for (const sen of sentences(text)) {
      // マスター強化
      if (/マスター(?:に|へ|の)/.test(sen) && /与え|上げ|上昇|加護|強化|高め|付与|アップ/.test(sen)) {
        const n = sen.match(/(\d+)\s*ランク/);
        for (const [stat, re] of MASTER_STAT_WORDS) if (re.test(sen)) push('master_buff', n ? Math.min(5, +n[1]) : 1, { stat });
      }
      const cond = (CONDS.find(([, re]) => re.test(sen)) || [])[0];
      for (const r of RULES) {
        if (r.only && r.only !== kind) continue;
        const m = sen.match(r.re);
        if (!m || (r.not && r.not.test(sen))) continue;
        let p = typeof r.p === 'function' ? r.p(sen, m) : r.p || null;
        if (r.cond && cond) p = Object.assign({}, p || {}, { cond });
        push(r.id, typeof r.f === 'function' ? r.f(sen, m) : (r.f == null ? 1 : r.f), p);
      }
    }
    return out.slice(0, limit || 4);
  }

  // 説明文で他のスキルが参照されていれば、その効果を借りる。拾うのは次のような書き方だけ：
  //   「直感」と同等 / 勇猛スキルとほぼ同効果 / 皇帝特権の亜種 / 狂化Bランク相当
  //   カリスマを与える / 黄金律の加護を与える / 対魔力を備え
  //   Dランク相当の戦闘続行とカリスマ / ランクCのカリスマ
  //   天性の魔、怪力、カリスマ、魔力放出、等との混合スキル
  // 「〇〇を持つ相手に」のように相手の話をしている場合は拾わない。
  const CLAUSE_SPLIT = /だが|けれど|しかし|ものの|ても|でも|が、/;
  function compoundSpecs(text, selfName) {
    const found = new Map();
    const self = baseName(normName(selfName || ''));
    const keys = Object.keys(SKILL_DICT).filter(k => k.length >= 2 && !COMPOUND_SKIP.has(k)).sort((a, b) => b.length - a.length);
    for (const sen of sentences(text)) for (const clause0 of sen.split(CLAUSE_SPLIT)) {
      const clause = R.normalize(clause0);
      for (const key of keys) {
        const bk = baseName(key);
        if (self && (self.includes(bk) || bk.includes(self))) continue;
        let at = clause.indexOf(bk);
        while (at >= 0) {
          const after = clause.slice(at + bk.length, at + bk.length + 24), before = clause.slice(Math.max(0, at - 18), at);
          if (/^(?:」)?(?:スキル)?を(?:持つ|有する)|^(?:」)?(?:スキル)?(?:に対して|を相手)/.test(after)) { at = clause.indexOf(bk, at + 1); continue; }
          let rank = null, ok = false;
          const eq = after.match(/^(?:」)?(?:スキル)?(?:と|に|の)?(?:ほぼ)?(?:[^。、]{0,6}?)(同等|同様|同効果|相当|亜種)/);
          if (eq) { ok = true; const rm = after.slice(0, eq.index + eq[0].length).match(/(EX|[A-E])[+]*ランク/); if (rm) rank = rm[1]; }
          if (/^(?:」)?(?:スキル)?(?:の加護)?を(?:与え|付与し|付与す|獲得|備え|内包)/.test(after)) ok = true;
          const pre = before.match(/(?:(EX|[A-E])[+]*ランク(?:相当)?の|ランク(EX|[A-E])の)([^。]{0,12})$/);
          if (pre && /^[^をがはにでへ]*$/.test(pre[3])) { ok = true; rank = rank || pre[1] || pre[2]; }
          if (/^[、・と,\s぀-ヿ一-鿿()]{0,24}?(?:等|など)?との?(?:混合|複合)/.test(after) && !/[をがは]/.test(after.split(/混合|複合/)[0])) ok = true;
          if (ok) { if (!found.has(key)) found.set(key, { key, rank: rank ? R.parseRank(rank) : null }); break; }
          at = clause.indexOf(bk, at + 1);
        }
      }
    }
    const out = Array.from(found.values());
    // 長い名前に含まれる短い名前（「勇猛」と「勇猛の戦乙女」など）は長い方だけ残す
    return out.filter(o => !out.some(x => x !== o && x.key.length > o.key.length && x.key.includes(baseName(o.key))));
  }

  /**
   * スキル1つに効果を割り当てる。
   * 優先順: サーヴァント個別の上書き > 全体の上書き > 辞書 > 説明文の解析（参照＋キーワード） > 仮
   * 戻り値: { effects, source, matched }
   *   source: 'servant-override' | 'override' | 'dict' | 'dict-partial' | 'compound' | 'keyword' | 'lost' | 'default'
   */
  function resolveSkill(skill, ctx) {
    ctx = ctx || {};
    const n = normName(skill.name);
    const own = ctx.trueName && (SERVANT_OVERRIDES[ctx.trueName + '/' + n] || SERVANT_OVERRIDES[ctx.trueName + '/' + skill.name]);
    const rank = skill.rank || R.parseRank(skill.rankRaw);
    const mk = (specs, source, extra) => {
      const effects = [];
      for (const s of specs) { const e = instantiate(s.spec || s, s.rank || rank, skill.name, source); if (e) effects.push(e); }
      if (PERSIST_WORDS.test(skill.desc || '')) effects.forEach(e => { e.persistent = true; });
      return Object.assign({ effects, source }, extra || {});
    };
    if (own) return mk(own, 'servant-override');
    if (SKILL_OVERRIDES[n] || SKILL_OVERRIDES[skill.name]) return mk(SKILL_OVERRIDES[n] || SKILL_OVERRIDES[skill.name], 'override');
    if (rank && rank.none && LOST_WORDS.test(skill.desc || '')) return { effects: [], source: 'lost' };
    const d = lookupDict(skill.name);
    if (d && d.how !== 'partial') return mk(SKILL_DICT[d.key], 'dict', { matched: d.key });

    // 説明文の解析
    const comp = compoundSpecs(skill.desc, skill.name);
    const kw = analyzeText(skill.name + '\n' + (skill.desc || ''), 'skill', 4);
    const specs = [];
    if (d) for (const s of SKILL_DICT[d.key]) specs.push({ spec: s }); // 部分一致した辞書の効果を土台に
    for (const c of comp) for (const s of SKILL_DICT[c.key]) specs.push({ spec: [s[0], (s[1] == null ? 1 : s[1]) * 0.6, s[2]], rank: c.rank });
    for (const s of kw) if (!specs.some(x => x.spec[0] === s[0] && JSON.stringify(x.spec[2] || null) === JSON.stringify(s[2] || null))) specs.push({ spec: s });
    if (!specs.length) return mk([['power', 0.3]], 'default');
    const source = d ? 'dict-partial' : comp.length ? 'compound' : 'keyword';
    return mk(specs.slice(0, 6), source, { matched: d ? d.key : comp.map(c => c.key).join('・') || null });
  }

  /**
   * 宝具に効果を割り当てる。攻撃宝具かどうか、威力・魔力消費・露見しやすさも計算する。
   * NP_OVERRIDES['真名/宝具名'].attack に true/false を入れておくと、その判定を優先する（手直し用）。
   */
  function resolveNP(np, ctx) {
    ctx = ctx || {};
    const CFG = G.CONFIG;
    const tk = np.typeKey || 'special', T = CFG.NP_TYPE[tk] || CFG.NP_TYPE.special;
    const n = normName(np.name);
    const desc = np.desc || '';
    const own = ctx.trueName && (SERVANT_OVERRIDES[ctx.trueName + '/' + n] || SERVANT_OVERRIDES[ctx.trueName + '/' + np.name]);
    let specs, source, matched = null;
    if (own) { specs = own.map(s => ({ spec: s })); source = 'servant-override'; }
    else if (SKILL_OVERRIDES[n]) { specs = SKILL_OVERRIDES[n].map(s => ({ spec: s })); source = 'override'; }
    else {
      const comp = compoundSpecs(desc, np.name);
      specs = [];
      for (const c of comp) for (const s of SKILL_DICT[c.key]) specs.push({ spec: [s[0], (s[1] == null ? 1 : s[1]) * 0.6, s[2]], rank: c.rank });
      for (const s of analyzeText(desc, 'np', 5)) if (!specs.some(x => x.spec[0] === s[0])) specs.push({ spec: s });
      if (tk === 'barrier' && !specs.some(s => s.spec[0] === 'territory')) specs.push({ spec: ['territory', 1.5] });
      if (tk === 'self' && !specs.length) specs = [{ spec: ['power', 2] }, { spec: ['guard', 1] }];
      source = specs.length ? (comp.length ? 'compound' : 'keyword') : 'type';
      matched = comp.map(c => c.key).join('・') || null;
    }
    const ids = new Set(specs.map(s => s.spec[0]));
    const disabled = ids.has('disabled');
    const hasAtk = ATTACK_WORDS.test(desc) && !NON_ATTACK.test(desc);
    let attack, basis;
    const npo = ctx.trueName && NP_OVERRIDES[ctx.trueName + '/' + n];
    if (npo && (npo.attack === true || npo.attack === false)) { attack = npo.attack; basis = 'override'; }
    else if (disabled) { attack = false; basis = 'disabled'; }
    else if (tk === 'self') { attack = false; basis = 'self'; }
    else if (NON_ATTACK.test(desc)) { attack = false; basis = 'non-attack-words'; }
    else if (hasAtk) { attack = true; basis = 'attack-words'; }
    else if (tk === 'barrier') { attack = false; basis = 'barrier'; }
    else if (specs.length) { attack = false; basis = 'support-effects'; } // 補助的な効果しか読み取れず、攻撃の表現も無い
    else { attack = true; basis = 'guess'; }                              // 手がかりが無いので種別どおり攻撃宝具とみなす
    // 攻撃宝具の「戦闘力上昇」は威力そのものなので効果からは外す
    if (attack) specs = specs.filter(s => s.spec[0] !== 'power' || (s.spec[2] && s.spec[2].cond));
    const rk = np.rank && np.rank.base ? np.rank : R.parseRank('C');
    const effects = specs.map(s => instantiate(s.spec, s.rank || rk, np.name, source)).filter(Boolean);
    if (PERSIST_WORDS.test(desc)) effects.forEach(e => { e.persistent = true; });
    const costMod = effects.filter(e => e.id === 'np_cost').reduce((t, e) => t + e.mag, 0);
    return {
      attack, basis,
      disabled,
      power: attack ? Math.round(rk.score * T.power * 10) / 10 : 0,   // 攻撃宝具の威力（ステータススコアと同じ尺度）
      burst: rk.burst,
      cost: Math.round(Math.max(0.1, T.cost * rk.mult * (1 + costMod)) * 100) / 100, // 魔力消費（1.0=標準）
      exposure: T.exposure,                                             // 使うと真名がばれやすい度合い
      multi: (np.maxTargets || 1) > 1,
      effects, source, matched,
    };
  }

  G.effects = { EFFECTS, SKILL_DICT, RULES, CONDS, TAG_CANON, SKILL_OVERRIDES, SERVANT_OVERRIDES, STAT_OVERRIDES, NP_OVERRIDES,
    normName, lookupDict, resolveSkill, resolveNP, instantiate, analyzeText, compoundSpecs, canonTag };
})(globalThis.HGW = globalThis.HGW || {});
