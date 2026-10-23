/* スキル・宝具の「効果の部品」と、スキル名→部品の割り当て表
 *
 * 考え方：
 *   - ゲームのエンジンが理解するのは EFFECTS に並んだ部品だけ。
 *   - Wiki のスキルは名前も効果も自由なので、
 *       1) 手で直した上書き  2) 既知スキルの辞書  3) 説明文の解析（キーワード＋他スキルの参照）  4) 仮の効果
 *     の順で決める。
 *   - 後から手で直すときは SKILL_OVERRIDES（全体）か SERVANT_OVERRIDES（そのサーヴァントだけ）に書く。
 *     ステータスの手直しは STAT_OVERRIDES に書く。スキル・宝具・セリフなど内容そのものの手直しは CONTENT_OVERRIDES。
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
  // 効果の条件（params。どの部品にも付けられる。engine.js の condOk、build.js の condW と合わせる）
  //   cond  : 場面 — '水辺' '森' '山' '夜'（その場所・時間の戦い）／ '拠点'（自分の拠点で戦うとき）／ '瀕死'（自分の霊基が ENGINE.pinchAt 未満）
  //   vs    : 相手の属性（'男性' '竜' など）— その属性を持つ相手と戦うときだけ
  //   chance: 発動確率（0〜1）— 戦いごとに一度判定し、当たった戦いの間だけ働く（戦い以外の場面では強さ×確率）
  //   特攻（power_vs）・弱点（weakness）の相手は従来どおり tag、マスター強化の能力は stat
  const EFFECTS = {
    // 戦闘
    power:        { name: '戦闘力上昇',   phase: 'battle',    unit: 'rate',   base: 0.10, desc: '戦闘力に加算' },
    power_vs:     { name: '特攻',         phase: 'battle',    unit: 'rate',   base: 0.30, desc: '特定の相手（params.tag）にだけ戦闘力上昇' },
    debuff:       { name: '弱体化',       phase: 'battle',    unit: 'rate',   base: 0.10, desc: '相手の戦闘力を下げる（種類を決めていない弱体化。精神耐性で少し防がれる）' },
    debuff_mind:  { name: '精神弱体',     phase: 'battle',    unit: 'rate',   base: 0.10, desc: '相手の戦闘力を下げる（威圧・恐怖・幻惑など心への干渉）。精神耐性とマスターの精神で防がれる' },
    debuff_body:  { name: '肉体弱体',     phase: 'battle',    unit: 'rate',   base: 0.10, desc: '相手の戦闘力を下げる（呪い・衰え・重圧など体への干渉）。耐久と対魔力（魔術耐性）で防がれる' },
    wither:       { name: '衰弱',         phase: 'battle',    unit: 'rate',   base: 0.12, trig: 'win', selfTrig: 'day', desc: '相手の戦闘力を少しずつ削り、重なっていく（既定は押し勝つたび）。戦いが終わっても残り、毎朝一定の確率で消える。耐久と対魔力で防がれる' },
    crit:         { name: 'クリティカル',         phase: 'battle',    unit: 'chance', base: 0.15, desc: '大ダメージを与える確率' },
    pierce:       { name: '防御無視',     phase: 'battle',    unit: 'chance', base: 0.25, desc: '相手の回避・軽減・対魔力・致命傷耐性を無視する確率（必中など）' },
    instakill:    { name: '即死',         phase: 'battle',    unit: 'chance', base: 0.05, desc: '戦闘力に関係なく相手を倒す確率' },
    evade:        { name: '回避',         phase: 'battle',    unit: 'chance', base: 0.10, desc: '攻撃を避ける確率' },
    initiative:   { name: '先手',         phase: 'battle',    unit: 'chance', base: 0.15, desc: '戦いの始めに先手を取り、その戦いで少し有利になる確率' },
    charm:        { name: '魅了',         phase: 'battle',    unit: 'chance', base: 0.10, desc: '相手が攻撃をためらう確率' },
    // 状態異常（params.name で表示名、params.msg で記録の文を変えられる。AILMENTS）
    poison:       { name: '毒',           phase: 'battle',    unit: 'chance', base: 0.20, desc: '押し勝ったとき相手を毒にする確率。毒の英霊は打ち合いのたびと翌日に霊基を削られる（毒では倒れない）' },
    stun:         { name: 'スタン',       phase: 'battle',    unit: 'chance', base: 0.10, desc: '打ち合いごとに相手の動きを止める確率。止まった相手は宝具を使えず、その打ち合いの戦闘力が下がる' },
    confuse:      { name: '混乱',         phase: 'battle',    unit: 'chance', base: 0.10, desc: '打ち合いごとに相手を混乱させる確率。混乱した相手は戦闘力が下がり、自分を傷つけることもある' },
    seal:         { name: '宝具封印',     phase: 'battle',    unit: 'chance', base: 0.15, desc: '押し勝ったとき、相手の宝具をその戦いの間封じる確率' },
    ail_guard:    { name: '状態異常耐性', phase: 'battle',    unit: 'chance', base: 0.40, desc: '毒・スタン・混乱・宝具封印・魅了を防ぐ確率' },
    sure_hit:     { name: '必中',         phase: 'battle',    unit: 'chance', base: 0.50, desc: '相手の回避を打ち消す（回避の効果を割合で消す）' },
    dmg_plus:     { name: 'ダメージプラス', phase: 'battle',  unit: 'pt',     base: 4,    desc: '押し勝ったときに与える傷を固定値で増やす' },
    skill_seal:   { name: 'スキル封印',   phase: 'battle',    unit: 'chance', base: 0.30, trig: 'win', desc: '相手の「発動するスキル」（発動のしかたが「常に」以外の効果）を、その戦いの間止める確率。状態異常耐性で防がれる' },
    rally:        { name: '統率',         phase: 'battle',    unit: 'rate',   base: 0.05, desc: '同盟相手と並んで戦うときの連携（加勢の力）を強め、並んで戦う味方の戦闘力も上げる' },
    anti_master:  { name: 'マスター狙い', phase: 'battle',    unit: 'chance', base: 0.15, desc: '敵マスターを直接狙える確率' },
    // 被ダメージ・生存
    guard:        { name: '被ダメージ軽減', phase: 'damage',  unit: 'rate',   base: 0.10, desc: '受けるダメージを減らす（マイナスなら打たれ弱い）' },
    magic_guard:  { name: '魔術耐性',     phase: 'damage',    unit: 'rate',   base: 0.30, desc: '魔力の高い相手（キャスターなど）との戦いで守りになる' },
    mental_guard: { name: '精神耐性',     phase: 'battle',    unit: 'chance', base: 0.40, desc: '魅了・混乱に抵抗する確率。相手の弱体化や不意打ちに動じず、傷を負っても戦闘力が落ちにくい' },
    guts:         { name: '致命傷耐性',   phase: 'lethal',    unit: 'chance', base: 0.20, desc: '倒れるはずの一撃で踏みとどまる確率' },
    dmg_cut:      { name: 'ダメージカット', phase: 'damage',  unit: 'pt',     base: 4,    desc: '押し負けたときに受ける傷を固定値で減らす' },
    dodge:        { name: '見切り',       phase: 'damage',    unit: 'chance', base: 0.10, desc: '押し負けたとき、その一撃をかわして傷を受けない確率（必中で打ち消される）' },
    counter:      { name: '反撃',         phase: 'damage',    unit: 'rate',   base: 0.15, desc: '押し負けて傷を受けたとき、その傷の一部を相手に返す' },
    taunt:        { name: 'かばう',       phase: 'battle',    unit: 'chance', base: 0.20, desc: '同盟相手に加勢したとき、味方の代わりに一撃を受ける確率を上げる（ターゲット集中）' },
    weakness:     { name: '弱点',         phase: 'damage',    unit: 'rate',   base: 0.30, desc: '特定の相手（params.tag）から受けるダメージが増える（不利な効果）' },
    master_guard: { name: 'マスター護衛', phase: 'damage',    unit: 'chance', base: 0.20, desc: 'マスターが狙われたときに守る確率' },
    // 回復・吸収（その場で働く効果。発動のしかた params.on が無いときは trig の場面で発動する）
    heal:         { name: '回復',         phase: 'battle',    unit: 'pt',     base: 20,   trig: 'pinch', desc: 'その場で自分の霊基を回復する（既定は瀕死になったとき）' },
    drain_hp:     { name: '体力吸収',     phase: 'battle',    unit: 'pt',     base: 10,   trig: 'win',   desc: '相手の霊基を吸い取って自分を回復する（既定は押し勝ったとき。吸い取りでは倒れない）' },
    mana_gain:    { name: '魔力回復',     phase: 'battle',    unit: 'pt',     base: 20,   trig: 'start', desc: 'その場でマスターの魔力（魔力の蓄え）を回復する（既定は戦いの始め）' },
    drain_mana:   { name: '魔力吸収',     phase: 'battle',    unit: 'pt',     base: 10,   trig: 'win',   desc: '相手の魔力を吸い取って自分の魔力にする（既定は押し勝ったとき）' },
    // 解除
    strip:        { name: '強化解除',     phase: 'battle',    unit: 'chance', base: 0.50, trig: 'start', desc: '相手がその戦いで得た強化（補助宝具・発動したスキル・道具・先手など）を消す確率。消す効果（params.eff）を選ぶと、相手のその効果だけを、常に持っている分も含めてその戦いの間止める' },
    cleanse:      { name: '弱体解除',     phase: 'battle',    unit: 'rate',   base: 0.50, trig: 'start', desc: '自分の状態異常（毒・スタン・混乱・宝具封印・スキル封印）を消し、その戦いの間は相手の弱体化・状態異常を弱める' },
    self_strip:   { name: '自己強化解除', phase: 'battle',    unit: 'flag',   base: 1, fixed: true, trig: 'start', desc: '自分の効果を外す。params.tag に書いたスキル・宝具の、params.eff の効果（どちらかだけでもよい）を、その戦いの間止める（両方空なら、その戦いで得た強化を消す）。両立しない効果の切り替えに' },
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
    craft:        { name: '道具作成',     phase: 'day',       unit: 'chance', base: 0.15, desc: '工房を強化した日に道具を作る確率（道具は次の戦いで守りと戦闘力になる）。工房の強化も選びやすい' },
    resource:     { name: '資源獲得',     phase: 'day',       unit: 'rate',   base: 0.20, desc: '資金や物資から魔力を補う。工房の強化も成功しやすい' },
    upkeep_down:  { name: '魔力効率',     phase: 'upkeep',    unit: 'rate',   base: 0.15, desc: '維持に必要な魔力を減らす' },
    upkeep_up:    { name: '魔力消費増',   phase: 'upkeep',    unit: 'rate',   base: 0.30, desc: '維持に必要な魔力が増える（不利な効果）' },
    solo:         { name: '単独行動',     phase: 'upkeep',    unit: 'days',   base: 2, byRank: { E: 0.5, D: 1, C: 1, B: 2, A: 7, EX: 30 }, desc: 'マスターを失っても現界できる日数' },
    uncontrolled: { name: '制御困難',     phase: 'day',       unit: 'chance', base: 0.10, desc: '命令に従わず勝手に動く確率。魔力が足りなくても宝具を放ち、マスターの生命力を削ることがある（不利な効果）' },
    // 交渉・マスター
    negotiate:    { name: '交渉',         phase: 'talk',      unit: 'chance', base: 0.20, desc: '交渉・同盟・戦闘回避の成功率（マイナスなら交渉不能に近づく）' },
    cs_resist:    { name: '令呪耐性',     phase: 'master',    unit: 'chance', base: 0.25, desc: '令呪の強制力に抵抗する確率（命令が効きにくい）' },
    master_buff:  { name: 'マスター強化', phase: 'master',    unit: 'pt',     base: 10,   desc: 'マスターの能力値（params.stat）を上げる' },
    luck:         { name: '幸運補正',     phase: 'passive',   unit: 'chance', base: 0.10, desc: '運に左右される場面（踏みとどまり・撤退・即死を免れる）で有利になる（マイナスなら不利）' },
    tag:          { name: '属性付与',     phase: 'passive',   unit: 'flag',   base: 1, fixed: true, desc: '特攻の対象になる属性（params.tag）を持つ' },
    // 宝具使用時
    np_boost:     { name: '宝具強化',     phase: 'np',        unit: 'rate',   base: 0.25, desc: '宝具の威力（宝具を切った打ち合いはもともと勝ちやすいので、強めにしてある）' },
    np_charge:    { name: '宝具チャージ', phase: 'np',        unit: 'chance', base: 0.15, desc: '打ち合いごとに宝具を放つ確率を上げる' },
    np_cost:      { name: '宝具消費',     phase: 'np',        unit: 'rate',   base: 0.30, desc: '宝具の魔力消費の増減（マイナスで軽くなる）' },
    backfire:     { name: '反動',         phase: 'np',        unit: 'rate',   base: 0.30, desc: '宝具を使うと自分も傷つく' },
    self_retire:  { name: '自滅',         phase: 'np',        unit: 'chance', base: 1.0, fixed: true, desc: '宝具を使うと自分が脱落する確率' },
    disabled:     { name: '使用不可',     phase: 'np',        unit: 'flag',   base: 1, fixed: true, desc: 'この宝具は今回の召喚では使えない' },
  };

  // ---------- ジャンル（リストツール・申請フォームの効果の選択肢と凡例を分ける） ----------
  const EFFECT_GROUPS = [
    ['atk', '攻め', ['power', 'power_vs', 'crit', 'pierce', 'sure_hit', 'dmg_plus', 'instakill', 'initiative']],
    ['def', '守り', ['guard', 'evade', 'dodge', 'counter', 'magic_guard', 'dmg_cut', 'guts', 'luck', 'weakness']],
    ['heal', '回復・吸収', ['heal', 'drain_hp', 'mana_gain', 'drain_mana', 'regen', 'heal_other']],
    ['ail', '弱体・状態異常', ['debuff', 'debuff_mind', 'debuff_body', 'wither', 'charm', 'poison', 'stun', 'confuse', 'seal', 'skill_seal']],
    ['resist', '耐性', ['ail_guard', 'mental_guard', 'cs_resist']],
    ['clear', '解除', ['strip', 'cleanse', 'self_strip']],
    ['np', '宝具', ['np_boost', 'np_charge', 'np_cost', 'backfire', 'self_retire', 'disabled']],
    ['intel', '索敵・情報', ['stealth', 'detect', 'intel', 'reveal', 'conceal']],
    ['move', '撤退・追撃', ['escape', 'pin']],
    ['camp', '陣営・魔力', ['territory', 'craft', 'resource', 'upkeep_down', 'upkeep_up', 'solo', 'uncontrolled']],
    ['team', '同盟・マスター', ['rally', 'taunt', 'negotiate', 'anti_master', 'master_guard', 'master_buff']],
    ['other', 'その他', ['tag']],
  ];
  const GROUP_OF = {};
  for (const [g, , ids] of EFFECT_GROUPS) for (const id of ids) GROUP_OF[id] = g;
  for (const id of Object.keys(EFFECTS)) if (!GROUP_OF[id]) { GROUP_OF[id] = 'other'; EFFECT_GROUPS[EFFECT_GROUPS.length - 1][2].push(id); }

  // ---------- 発動のしかた（params.on。どの効果にも付けられる。engine.js の fireTrig と合わせる） ----------
  //   ''     ：常に（いままでの常時効果）
  //   start  ：戦いの始めに      round：打ち合いのたびに     win：押し勝ったとき     lose：押し負けたとき（傷を受けたあと）
  //   hit    ：攻撃を受ける直前（押し負けが決まり、傷を受ける前。ここで得た守り・見切りはその一撃から効く）
  //   pinch  ：瀕死になったとき（霊基が ENGINE.pinchAt を切ったとき。1回の戦いに一度）
  //   np     ：宝具を使ったとき  kill：相手を倒したとき     day：毎朝（戦いの外）
  // 一緒に付けられるもの：cost＝発動ごとの魔力（払えなければ発動しない。「打ち合いのたびに」と組めば「魔力がある限り自動発動」）／
  //   uses＝1回の戦いで何回まで（戦いの始め・瀕死・相手を倒したときは、もともと一度）／chance＝発動のたびに判定する確率
  // 発動して得た強化（戦闘力・守りなど）は、その戦いの終わりまで続く（同じスキルからは重ねない）。打ち合いのたびに発動したものはその打ち合いの間だけ
  //   （魔力を払い続ければ毎回掛かる）。毎朝得た強化は、その日の終わりまで（夜の戦い・夜の索敵にも効く）。相手を倒したときの強化は、次の戦いの終わりまで。
  // 回復・吸収・解除・スキル封印は、発動したその場で働く（instant）。これらは params.on が無ければ EFFECTS の trig の場面で発動する。
  // 宝具の効果は、params.on が無ければ使ったときに働く（いままでどおり）。params.on があれば、使ったあとその場面のたびに発動する。
  const TRIGGERS = [['', '常に'], ['start', '戦いの始めに'], ['round', '打ち合いのたびに'], ['win', '押し勝ったとき'], ['hit', '攻撃を受ける直前に'], ['lose', '押し負けたとき'],
    ['pinch', '瀕死になったとき'], ['np', '宝具を使ったとき'], ['kill', '相手を倒したとき'], ['day', '毎朝（戦いの外）']];
  const TRIG_JA = Object.fromEntries(TRIGGERS);
  const INSTANT = ['heal', 'drain_hp', 'mana_gain', 'drain_mana', 'strip', 'cleanse', 'self_strip', 'skill_seal', 'wither'];
  // 自分にも掛けられる不利な効果（params.self）。デメリットや「日ごとに弱っていく」英霊に。自分に掛けた分は防げない
  const SELF_IDS = ['debuff', 'debuff_mind', 'debuff_body', 'wither', 'poison', 'stun', 'confuse', 'seal'];
  // 効果の発動の場面（スキル）。'' は常時。自分に掛ける衰弱は既定で毎朝
  const trigOf = e => (e && e.params && e.params.on) || (e && e.params && e.params.self && EFFECTS[e.id] && EFFECTS[e.id].selfTrig) || (EFFECTS[e.id] && EFFECTS[e.id].trig) || '';
  // 見積もり（評価・試し戦い）での発動の重み：その場面がどのくらい起きるか
  const TRIG_W = { '': 1, start: 1, round: 1, win: 0.5, hit: 0.4, lose: 0.4, pinch: 0.3, np: 0.4, kill: 0.15, day: 0.8 };
  const trigText = (p, id, np) => {
    const on = (p && p.on) || '', def = (p && p.self && (EFFECTS[id] || {}).selfTrig) || (EFFECTS[id] || {}).trig;
    const t = [];
    if (on) t.push(TRIG_JA[on] + '発動' + (np ? '（宝具を使ったあと）' : ''));
    else if (def && !np) t.push(TRIG_JA[def] + '発動');
    if (p && p.cost > 0) t.push(`魔力${p.cost}を払って`);
    if (p && p.uses > 0) t.push(`1回の戦いに${p.uses}回まで`);
    return t.join('・');
  };

  // ---------- 編集画面の部品（roster.html・submit.html で共通。文字列を作るだけで、画面には触らない） ----------
  // 効果の選択肢：ジャンルごとの <optgroup>。label(id) で「名前（誰に）」を作る
  const effOptionsHtml = (sel, esc, label) => EFFECT_GROUPS.map(([, title, ids]) => `<optgroup label="${esc(title)}">`
    + ids.map(id => `<option value="${id}"${id === sel ? ' selected' : ''}>${esc(label(id))}</option>`).join('') + '</optgroup>').join('');
  // 発動のしかた・魔力・回数の欄。宝具では空欄が「使ったとき」（使ったあとでは起きない「戦いの始め」「毎朝」は出さない）
  const trigFieldsHtml = (p, esc, np) => { p = p || {}; return `<div class="etrig"><label>発動<select data-e="on">`
    + TRIGGERS.filter(([k]) => !np || !['start', 'day'].includes(k) || k === p.on).map(([k, t]) => `<option value="${k}"${k === (p.on || '') ? ' selected' : ''}>${esc(k ? t + (np ? '（使ったあと）' : '') : np ? '使ったとき' : '既定（常に／効果ごと）')}</option>`).join('')
    + `</select></label><label>魔力<input type="number" data-e="cost" min="0" step="5" value="${p.cost > 0 ? p.cost : ''}" placeholder="0"></label>`
    + `<label>回数<input type="number" data-e="uses" min="0" step="1" value="${p.uses > 0 ? p.uses : ''}" placeholder="制限なし">回まで</label></div>`; };
  const readTrig = (q, p) => {
    const on = q('on') ? q('on').value : ''; if (on) p.on = on;
    const c = parseFloat(q('cost') ? q('cost').value : ''); if (isFinite(c) && c > 0) p.cost = Math.round(c * 10) / 10;
    const u = parseInt(q('uses') ? q('uses').value : '', 10); if (isFinite(u) && u > 0) p.uses = u;
  };
  // 解除する効果の欄（強化解除・自己強化解除だけ）。空なら「すべて」
  const STRIP_IDS = ['strip', 'self_strip'];
  const stripFieldsHtml = (id, p, esc) => `<div class="estrip"${STRIP_IDS.includes(id) ? '' : ' hidden'}><label>止める効果<select data-e="eff"><option value="">${esc('指定しない（すべて）')}</option>`
    + effOptionsHtml((p && p.eff) || '', esc, x => EFFECTS[x].name) + '</select></label></div>';
  const readStrip = (q, id, p) => { if (!STRIP_IDS.includes(id) || !q('eff')) return; const v = q('eff').value; if (v) p.eff = v; };
  // 自分に掛ける欄（SELF_IDS の不利な効果だけ）
  const selfFieldsHtml = (id, p, esc) => `<div class="eself"${SELF_IDS.includes(id) ? '' : ' hidden'}><label><input type="checkbox" data-e="self"${p && p.self ? ' checked' : ''}>${esc('自分に掛ける（不利な効果・デメリット）')}</label></div>`;
  const readSelf = (q, id, p) => { if (SELF_IDS.includes(id) && q('self') && q('self').checked) p.self = true; };
  // 味方にも効く欄（params.team：0〜1）。並んで戦う味方（同盟の加勢・特異点の前衛）にも、その戦いの間 強さ×この割合 が働く。
  // 常時の強化だけ（発動のしかたのある効果・自分に掛ける効果は分けない）。エンジンは engine.js の battle で分ける
  const TEAM_IDS = ['power', 'power_vs', 'guard', 'evade', 'magic_guard', 'mental_guard', 'ail_guard', 'crit', 'pierce', 'sure_hit', 'dmg_plus', 'dmg_cut', 'dodge', 'counter', 'guts', 'luck', 'np_boost', 'np_charge', 'escape', 'initiative'];
  const teamFieldsHtml = (id, p, esc) => `<div class="eteam"${TEAM_IDS.includes(id) ? '' : ' hidden'}><label>${esc('味方にも効く')}<input type="number" data-e="team" min="0" max="100" step="10" value="${p && p.team > 0 ? Math.round(p.team * 100) : ''}" placeholder="0">%</label></div>`;
  const readTeam = (q, id, p) => { if (!TEAM_IDS.includes(id) || !q('team')) return; const v = parseFloat(q('team').value); if (isFinite(v) && v > 0) p.team = Math.min(1, Math.round(v) / 100); };
  // 「特攻・弱点の相手」欄の書き方の例（自己強化解除は止めるスキル・宝具の名前）
  const paramHint = id => id === 'master_buff' ? 'mana / craft / body / mind / luck' : id === 'self_strip' ? '止めるスキル・宝具の名前（空ならどれでも）' : id === 'power_vs' || id === 'weakness' || id === 'tag' ? '竜 / 男性 など' : '';

  // ---------- 効果の意味（リストツール・申請フォームの表示用） ----------
  // who: 誰に掛かるか（self=自分 / enemy=相手 / ally=同盟相手 / master=自分のマスター / enemyMaster=相手のマスター / none=—）
  // bad: 自分に不利な効果（マイナスの強さなら逆に有利）
  // fx(mag, params): エンジンでの実際の働き（engine.js の式と合わせる。式を変えたらここも直す）
  const WHO_JA = { self: '自分', enemy: '相手', ally: '同盟相手', master: '自分のマスター', enemyMaster: '相手のマスター', none: '—' };
  const STAT_JA_M = { mana: '魔力量', craft: '魔術', body: '体力', mind: '精神', luck: '幸運' };
  const pc = v => Math.round(Math.abs(v) * 1000) / 10 + '%';
  const sg = v => (v < 0 ? '−' : '+') + pc(v);
  const num = v => Math.round(v * 10) / 10;
  const tagOf = p => (p && p.tag) || '特定の相手';
  const ENG = () => G.CONFIG.ENGINE;
  // 状態異常：既定の名前と、確率の上限（engine.js も同じ表を使う）。params.name があればその名前で呼ぶ
  const AILMENTS = { charm: '魅了', poison: '毒', stun: 'スタン', confuse: '混乱', seal: '宝具封印' };
  const AIL_CAP = { charm: 1, poison: 0.6, stun: 0.5, confuse: 0.5, seal: 0.5 };
  const ailName = (p, id) => '「' + ((p && p.name) || AILMENTS[id]) + '」';
  // 記録の文の例（編集画面の入力欄に出す。実際の既定の文は names.js の G.LINES の ail*）
  const AIL_MSG_HINT = { charm: '{O}の刃が一瞬鈍った。{N}だ。', poison: '{O}は{N}に冒された。', stun: '{O}は体の自由を奪われた。{N}だ。', confuse: '{O}の目が焦点を失う。{N}だ。', seal: '{S}の一撃が{O}の宝具を封じた。{N}だ。' };
  // 確率の効果がマイナスのとき：その確率が下がる（同じ効果のほかのスキルや幸運などと合わせて、0%未満にはならない）
  const less = (what, m) => `${what} −${pc(m)}（ほかの効果と合わせて0%未満にはならない）`;
  const pm = v => (v < 0 ? '−' : '+') + num(Math.abs(v));
  const effName = id => (EFFECTS[id] || {}).name || id;
  const EFFECT_INFO = {
    power:        { who: 'self', fx: m => `戦闘力 ${sg(m)}` },
    power_vs:     { who: 'self', fx: (m, p) => `「${tagOf(p)}」の相手と戦うとき戦闘力 ${sg(m)}` },
    debuff:       { who: 'enemy', fx: m => `相手の戦闘力 ${m < 0 ? '+' : '−'}${pc(Math.min(0.5, m))}（相手の精神耐性で少し減り、相手マスターの精神で増減する。弱体化は合わせて最大50%）` },
    debuff_mind:  { who: 'enemy', fx: m => `相手の戦闘力 ${m < 0 ? '+' : '−'}${pc(Math.min(0.5, m))}（心への干渉。相手の精神耐性と相手マスターの精神で防がれる。弱体化は合わせて最大50%）` },
    debuff_body:  { who: 'enemy', fx: m => `相手の戦闘力 ${m < 0 ? '+' : '−'}${pc(Math.min(0.5, m))}（体への干渉。相手の耐久と対魔力で防がれる。弱体化は合わせて最大50%）` },
    wither:       { who: 'enemy', fx: m => m < 0 ? `相手の衰弱を ${pc(m)} 和らげる` : `発動するたびに相手の戦闘力を ${pc(m)} ずつ削る（重なって最大 ${pc(ENG().witherCap)}。戦いが終わっても残り、毎朝 ${pc(ENG().witherFade)} の確率で消える（休んだ翌朝は2倍）。相手の耐久と対魔力で防がれる）` },
    dodge:        { who: 'self', fx: m => m < 0 ? less('押し負けた一撃をかわす確率', m) : `押し負けたとき ${pc(Math.min(ENG().dodgeCap, m))} の確率でその一撃をかわし、傷を受けない（相手の必中で減る）` },
    counter:      { who: 'enemy', fx: m => m < 0 ? `押し負けたとき、相手から受ける傷が ${pc(m)} 増える` : `押し負けて傷を受けても倒れなければ、その傷の ${pc(Math.min(1, m))} を相手に返す` },
    crit:         { who: 'self', fx: m => m < 0 ? less(`クリティカルヒット（与える傷${ENG().critMult}倍）の確率`, m) : `押し勝ったとき ${pc(m)} の確率で与える傷が${ENG().critMult}倍。それが致命傷なら、相手が踏みとどまる確率がもとの ${pc(1 - ENG().critGuts)} になる` },
    pierce:       { who: 'enemy', fx: m => m < 0 ? `相手の守り（被ダメージ軽減・回避・魔術耐性）が ${pc(m)} 強まる（打ち消しや踏みとどまりの封じは起きない）` : `相手の守り（被ダメージ軽減・回避・魔術耐性）を ${pc(Math.min(0.9, m))} 打ち消し、同じ確率で踏みとどまりも許さない` },
    instakill:    { who: 'enemy', fx: m => m < 0 ? less('押し勝ったときに相手を一撃で倒す確率', m) : `押し勝つたびに ${pc(Math.min(0.4, m))} の確率で相手を一撃で倒す（相手の幸運で減る）` },
    evade:        { who: 'self', fx: m => `守りとして戦闘力 ${sg(m * 0.5)}（相手の必中で減り、ほかの回避と重なると鈍る）` },
    initiative:   { who: 'self', fx: (m, p) => (m < 0 ? less('戦いの始めに先手を取る確率', m) : `戦いの始めに ${pc(Math.min(0.5, m))} の確率で先手を取り、その戦いの戦闘力 +8%（ほかのスキル・宝具の先手と足し合わせて判定。上限50%）`)
      + (p && p.on ? '。※先手は戦いの始めにしか判定しないので、「発動」を付けると働かない' : '') },
    charm:        { who: 'enemy', fx: (m, p) => m < 0 ? less(`相手を${ailName(p, 'charm')}にする（戦闘力を4割下げる）確率`, m) : `打ち合いごとに ${pc(m)} の確率で相手を${ailName(p, 'charm')}にし、その打ち合いの戦闘力を4割下げる（精神耐性・状態異常耐性・マスターの精神で防がれる）` },
    poison:       { who: 'enemy', fx: (m, p) => m < 0 ? less(`相手を${ailName(p, 'poison')}にする確率`, m) : `押し勝ったとき ${pc(Math.min(AIL_CAP.poison, m))} の確率で相手を${ailName(p, 'poison')}にする。その戦いの打ち合いのたびに霊基 −${ENG().poisonTick}、翌日にも −${ENG().poisonDay}（これでは倒れない。状態異常耐性・耐久で防がれる）` },
    stun:         { who: 'enemy', fx: (m, p) => m < 0 ? less(`相手を${ailName(p, 'stun')}にする確率`, m) : `打ち合いごとに ${pc(Math.min(AIL_CAP.stun, m))} の確率で相手を${ailName(p, 'stun')}にする。その打ち合いは宝具を使えず、戦闘力 −${pc(1 - ENG().stunPower)}（状態異常耐性・耐久で防がれる）` },
    confuse:      { who: 'enemy', fx: (m, p) => m < 0 ? less(`相手を${ailName(p, 'confuse')}させる確率`, m) : `打ち合いごとに ${pc(Math.min(AIL_CAP.confuse, m))} の確率で相手を${ailName(p, 'confuse')}させる。その打ち合いの戦闘力 −${pc(1 - ENG().confusePower)}、${pc(ENG().confuseSelf)} の確率で自分を傷つける（霊基 −${ENG().confuseSelfDmg}）（精神耐性・状態異常耐性・マスターの精神で防がれる）` },
    seal:         { who: 'enemy', fx: (m, p) => m < 0 ? less(`相手の宝具を封じる確率`, m) : `押し勝ったとき ${pc(Math.min(AIL_CAP.seal, m))} の確率で相手の宝具を封じ（${ailName(p, 'seal')}）、その戦いの間は使わせない（状態異常耐性で防がれる）` },
    ail_guard:    { who: 'self', fx: m => m < 0 ? `毒・スタン・混乱・宝具封印・魅了を防ぐ確率 −${pc(m)}（ほかの耐性と合わせて0%未満にはならない）` : `毒・スタン・混乱・宝具封印・魅了を ${pc(Math.min(0.95, m))} の確率で防ぐ` },
    sure_hit:     { who: 'enemy', fx: m => m < 0 ? `相手の回避が ${pc(m)} 強まる` : `相手の回避を ${pc(Math.min(1, m))} 打ち消す` },
    dmg_plus:     { who: 'enemy', fx: m => `押し勝ったときに与える傷 ${pm(m)}` },
    dmg_cut:      { who: 'self', fx: m => `押し負けたときに受ける傷 ${pm(-m)}（1未満にはならない）` },
    taunt:        { who: 'ally', fx: m => m < 0 ? less('加勢したときに味方の代わりに一撃を受ける確率', m) : `同盟相手に加勢したとき、味方の代わりに一撃を受ける確率 +${pc(m)}` },
    skill_seal:   { who: 'enemy', fx: m => m < 0 ? less('相手のスキルを封じる確率', m) : `${pc(Math.min(0.8, m))} の確率で、相手の「発動するスキル」をその戦いの間止める（状態異常耐性で防がれる）` },
    heal:         { who: 'self', fx: m => `その場で霊基 ${pm(m)}（最大100）` },
    drain_hp:     { who: 'enemy', fx: m => `相手の霊基を ${num(Math.abs(m))} 吸い取り、自分の霊基を同じだけ回復（相手は霊基1より下にならない）` },
    mana_gain:    { who: 'master', fx: m => `その場で魔力 ${pm(m)}（上限まで）` },
    drain_mana:   { who: 'enemyMaster', fx: m => `相手の魔力を ${num(Math.abs(m))} 吸い取り、自分の魔力にする` },
    strip:        { who: 'enemy', fx: (m, p) => p && p.eff ? `${pc(Math.min(1, m))} の確率で、相手の「${effName(p.eff)}」を、常に持っている分も含めてその戦いの間止める` : `${pc(Math.min(1, m))} の確率で、相手がその戦いで得た強化（補助宝具・発動したスキル・道具・先手）を消す` },
    cleanse:      { who: 'self', fx: m => `自分の毒・スタン・混乱・宝具封印・スキル封印をその場で消し、その戦いの間は相手の弱体化と状態異常の確率 −${pc(Math.min(1, m))}` },
    self_strip:   { who: 'self', fx: (m, p) => p && p.tag && p.eff ? `自分の「${p.tag}」の「${effName(p.eff)}」を、その戦いの間止める（ほかの効果はそのまま）`
      : p && p.tag ? `自分の「${p.tag}」の効果を、その戦いの間止める` : p && p.eff ? `自分の「${effName(p.eff)}」を（どのスキル・宝具のものも）、その戦いの間止める`
      : '自分がその戦いで得た強化（補助宝具・発動したスキル・道具）を消す' },
    np_charge:    { who: 'self', fx: m => `打ち合いごとに宝具を放つ確率 ${sg(m)}` },
    rally:        { who: 'ally', fx: m => `同盟相手と並んで戦うとき、加勢の力 ${sg(m)}（自分が加勢する側でもされる側でも）、並んで戦う味方の戦闘力 ${sg(m * ENG().rallyPower)}。同盟相手が加勢に来る確率と、同盟で共同作戦を決める確率も ${sg(m)}` },
    anti_master:  { who: 'enemyMaster', fx: m => `打ち合いで勝つたび相手マスターに刃が届く確率 ${sg(m * 0.3)}、拠点への夜襲でマスターを直接狙う確率 ${sg(Math.min(0.6, m * 1.5))}` },
    guard:        { who: 'self', fx: m => `受ける傷 ${m < 0 ? '+' : '−'}${pc(Math.min(ENG().guardDmgCap, m * ENG().guardDmgW))}、守りとして戦闘力 ${sg(m * ENG().defPowerW)}（ほかの被ダメージ軽減と重なると鈍る）` },
    magic_guard:  { who: 'self', fx: m => `魔力の高い相手（キャスターなど）と戦うとき、守りとして戦闘力 ${sg(m * 0.5)}。相手の肉体弱体・衰弱を防ぐ（耐久と合わせて）` },
    mental_guard: { who: 'self', fx: m => {
      if (m < 0) return `精神への干渉に弱い：相手の魅了・混乱を防ぐ確率 −${pc(-m)}（マスターの精神と合わせて0%未満にはならない）。相手の弱体化がよく効き、傷を負うと戦闘力がより落ちる`;
      const K = ENG(), part = (k, cap, t) => K[k] ? `${t} −${pc(Math.min(cap, m * K[k]))}` : '';
      const more = [part('mentalDebuff', 0.6, '相手の弱体化の効き'), part('mentalSurprise', 1, '相手の不意打ち（先手・強襲）の上乗せ'), part('mentalWound', 0.6, '傷による戦闘力の落ち込み')].filter(Boolean);
      return `相手の魅了・混乱を ${pc(Math.min(0.95, m))} の確率で防ぐ` + (more.length ? `。${more.join('、')}（ほかの精神耐性と重なると鈍る）` : '');
    } },
    guts:         { who: 'self', fx: m => m < 0 ? `倒れるはずの一撃で踏みとどまる確率 −${pc(m)}（絆・耐久・幸運と合わせて0%未満にはならない）` : `倒れるはずの一撃で ${pc(Math.min(0.85, m))} の確率で踏みとどまる（絆・耐久・幸運でも上がる）` },
    weakness:     { who: 'self', bad: true, fx: (m, p) => `「${tagOf(p)}」の相手と戦うとき戦闘力 ${m < 0 ? '+' : '−'}${pc(m * 0.5)}` },
    master_guard: { who: 'master', fx: m => m < 0 ? `自分のマスターの守り −${pc(m)}（工房・幸運などの守りを打ち消す。守りが0%を下回ることはない）` : `自分のマスターが狙われたとき、刃が届く確率 −${pc(Math.min(0.8, m))}` },
    stealth:      { who: 'self', fx: m => `夜に相手に見つかる確率 ${m < 0 ? '+' : '−'}${pc(m * 0.7)}、偵察・使い魔にも見つかり${m < 0 ? 'やすい' : 'にくい'}` },
    detect:       { who: 'self', fx: m => `夜に相手を見つける確率 ${sg(m * ENG().detectFind)}、迫る相手に気づいて見つかる確率 ${m < 0 ? '+0%' : '−' + pc(m * ENG().detectWary)}、先に見つけて仕掛けたとき戦闘力 +${pc(Math.max(0, Math.min(ENG().detectEdgeCap, m * ENG().detectEdge)))}（相手の索敵で減る）、マスターを狙う奇襲を見抜き${m < 0 ? 'にくい' : 'やすい'}` },
    intel:        { who: 'self', fx: m => `偵察・使い魔・噂の追跡の成功 ${sg(m)}、真名の推理 ${sg(m * 0.5)}` },
    reveal:       { who: 'enemy', fx: m => `相手の真名を見抜く確率 ${sg(m)}（戦い・偵察・推理）` },
    conceal:      { who: 'self', fx: m => `自分の真名を見抜かれる確率 ${m < 0 ? '+' : '−'}${pc(m * 0.6)}` },
    escape:       { who: 'self', fx: m => `撤退の成功 ${sg(m)}` },
    pin:          { who: 'enemy', fx: m => `相手の撤退の成功 ${m < 0 ? '+' : '−'}${pc(m * 0.8)}` },
    regen:        { who: 'self', fx: m => `休んだ日の霊基の回復 ${pm(m * ENG().regenHeal)}` },
    heal_other:   { who: 'master', fx: m => `休んだ日のマスターの傷の回復 ${pm(m * 60)}。同盟を組んでいれば、毎朝、同盟相手の霊基 ${pm(m * ENG().allyHeal)}（特異点では、毎朝ほかの味方全員の霊基 ${pm(m * ((G.CONFIG.SING || {}).healOther || 0))}）` },
    territory:    { who: 'self', fx: m => `拠点で戦うとき戦闘力 ${sg(m)}、工房の強化の成功 ${sg(m)}` },
    craft:        { who: 'self', fx: m => m < 0 ? less('工房を強化した日に道具を作る確率', m) : `工房を強化した日に ${pc(m)} の確率で道具を作る（次の戦いで守りと戦闘力になる。3つまで）。工房の強化も選びやすい` },
    resource:     { who: 'master', fx: m => `毎日の魔力 ${pm(m * 10)}、工房の強化の成功 ${sg(m * 0.5)}` },
    upkeep_down:  { who: 'master', fx: m => `マスターが払う維持魔力 ${m < 0 ? '+' : '−'}${pc(m)}` },
    upkeep_up:    { who: 'master', bad: true, fx: m => m < 0 ? `マスターが払う維持魔力 ${sg(m)}` : `マスターが払う維持魔力 ${sg(m)}（足りないとマスターの生命力が削られる）` },
    solo:         { who: 'self', fx: m => m < 0 ? `マスターを失ったときに現界を保てる日数 −${Math.abs(Math.floor(m))}日（ほかの効果と合わせて0日未満にはならない）` : `マスターを失っても ${Math.floor(m)}日 現界を保つ` },
    uncontrolled: { who: 'self', bad: true, fx: m => m < 0 ? `命令を聞かず出歩く確率 −${pc(m)}（ほかの効果と合わせて0%未満にはならない）` : `1日ごとに ${pc(m)} の確率で命令を聞かず出歩く（絆・マスターの精神で抑えられる）。魔力が足りなくても宝具を放つことがある` },
    negotiate:    { who: 'self', fx: m => `同盟・交渉の成功 ${sg(m)}` },
    cs_resist:    { who: 'self', bad: true, fx: m => m < 0 ? `令呪が効かない確率 −${pc(m)}（ほかの効果と合わせて0%未満にはならない）` : `令呪が ${pc(Math.min(0.9, m))} の確率で効かない（絆で和らぐ）` },
    master_buff:  { who: 'master', fx: (m, p) => `マスターの${STAT_JA_M[p && p.stat] || '能力'} ${m < 0 ? '−' : '+'}${num(Math.abs(m))}` },
    luck:         { who: 'self', fx: m => `踏みとどまり ${sg(m * 0.5)}・撤退 ${sg(m * 0.3)}・即死を受ける確率 ${m < 0 ? '+' : '−'}${pc(Math.min(0.9, m))}` },
    tag:          { who: 'none', fx: (m, p) => `「${tagOf(p)}」の属性を持つ（相手の特攻・自分の弱点の対象になる）` },
    np_boost:     { who: 'self', fx: m => `攻撃宝具の威力 ${sg(m)}` },
    np_cost:      { who: 'self', fx: m => `宝具の魔力消費 ${sg(m)}` },
    backfire:     { who: 'self', bad: true, fx: m => `宝具を使うと自分の霊基 ${pm(-m * 40)}` },
    self_retire:  { who: 'self', bad: true, fx: m => m < 0 ? '宝具を使っても脱落しない（マイナスの値は働かない）' : `宝具を使うと ${pc(Math.min(1, m))} の確率で自分が脱落` },
    disabled:     { who: 'none', bad: true, fx: () => 'この宝具は使えない' },
  };
  // 宝具の効果のうち、宝具を使ったその戦いの間だけ働くもの（np の部品はその宝具を使ったときだけ）。
  // それ以外の場面（昼・偵察・交渉・維持魔力など）の効果は、宝具を持っているだけで常に働く
  const NP_BATTLE_PHASES = ['battle', 'damage', 'lethal', 'retreat', 'np'];
  // 制御困難・魔力消費増は、宝具の説明にあっても「使ったときの代償」なので常時にはしない（エンジンは戦いの間は読まないので、実際には効かない）
  const NP_USE_ONLY = ['uncontrolled', 'upkeep_up'];
  const npOnUse = e => (NP_BATTLE_PHASES.includes((EFFECTS[e.id] || {}).phase) || NP_USE_ONLY.includes(e.id)) && !e.persistent;
  const COND_JA = { 水辺: '水辺・雨の夜の戦いでだけ', 森: '森での戦いでだけ', 山: '山での戦いでだけ', 夜: '夜の戦い（満月の夜を除く）でだけ',
    拠点: '自分の拠点で戦うときだけ', 瀕死: '霊基が4割を切っているときだけ' };
  // 条件欄の選択肢（リストツール・申請フォーム）。[値, 表示]
  const COND_OPTS = [['', 'いつでも'], ['水辺', '水辺・雨の夜'], ['森', '森'], ['山', '山'], ['夜', '夜（満月を除く）'], ['拠点', '自分の拠点で'], ['瀕死', '瀕死のとき（霊基4割未満）']];
  const hasCond = p => !!(p && (p.cond || p.vs || (p.chance != null && p.chance < 1)));
  // 条件の説明（「いつ働くか」に足す）
  function condText(p, id) {
    if (!p) return '';
    const each = p.on || (id && EFFECTS[id] && EFFECTS[id].trig);
    return [p.cond ? COND_JA[p.cond] || p.cond + 'でだけ' : '', p.vs ? `「${p.vs}」の相手と戦うときだけ` : '',
      p.chance != null && p.chance < 1 ? `${each ? '発動のたびに' : '戦いごとに'} ${pc(Math.max(0, p.chance))} の確率で${each ? '' : '発動'}` : ''].filter(Boolean).join('・');
  }
  // 短い表記（一覧の札など）：（水辺）〔対 竜〕（30%）
  const condShort = p => !p ? '' : (p.on ? '〈' + TRIG_JA[p.on] + (p.cost > 0 ? '・魔力' + p.cost : '') + '〉' : '') + (p.cond ? '（' + p.cond + '）' : '') + (p.vs ? '〔対 ' + p.vs + '〕' : '') + (p.chance != null && p.chance < 1 ? '（' + pc(Math.max(0, p.chance)) + '）' : '');
  /**
   * 効果ひとつの説明。e は instantiate の結果（mag を持つ）か [id, factor, params] と rank。
   * ctx.np：宝具の効果 / ctx.attack：攻撃宝具
   * 戻り値 { name, who, whoJa, bad, when, text }
   */
  // 自分に掛ける不利な効果（params.self）の働き
  const SELF_FX = {
    debuff: m => `自分の戦闘力 −${pc(Math.min(0.5, m))}（自分に掛かる不利な効果。防げない）`,
    debuff_mind: m => `自分の戦闘力 −${pc(Math.min(0.5, m))}（心の乱れ。自分に掛かる不利な効果で、防げない）`,
    debuff_body: m => `自分の戦闘力 −${pc(Math.min(0.5, m))}（体の不調。自分に掛かる不利な効果で、防げない）`,
    wither: m => `発動するたびに自分の戦闘力が ${pc(m)} ずつ落ちていく（重なって最大 ${pc(ENG().witherCap)}。自分に掛けた衰弱は朝になっても消えず、弱体解除でだけ消える）`,
    poison: (m, p) => `打ち合いごとに ${pc(Math.min(AIL_CAP.poison, m))} の確率で自分が${ailName(p, 'poison')}になる（防げない。これでは倒れない）`,
    stun: (m, p) => `打ち合いごとに ${pc(Math.min(AIL_CAP.stun, m))} の確率で自分が${ailName(p, 'stun')}になり、その打ち合いは宝具を使えず戦闘力 −${pc(1 - ENG().stunPower)}（防げない）`,
    confuse: (m, p) => `打ち合いごとに ${pc(Math.min(AIL_CAP.confuse, m))} の確率で自分が${ailName(p, 'confuse')}し、戦闘力 −${pc(1 - ENG().confusePower)}（防げない）`,
    seal: (m, p) => `打ち合いごとに ${pc(Math.min(AIL_CAP.seal, m))} の確率で自分の宝具が封じられ（${ailName(p, 'seal')}）、その戦いの間は使えない（防げない）`,
  };
  function describe(e, ctx) {
    ctx = ctx || {};
    const def = EFFECTS[e.id], inf0 = EFFECT_INFO[e.id];
    if (!def || !inf0) return { name: e.id, who: 'none', whoJa: '—', bad: false, when: '', text: '（エンジンが知らない効果）' };
    const m = e.mag != null ? e.mag : def.base * (e.factor == null ? 1 : e.factor);
    const p = e.params || null;
    // 自分に掛ける不利な効果：誰に＝自分、不利な効果として書く
    const inf = p && p.self && SELF_FX[e.id] ? { who: 'self', bad: true, fx: SELF_FX[e.id] } : inf0;
    const bad = !!inf.bad === !(m < 0);
    // 常時発動の宝具の効果はスキルと同じに、自動で発動する宝具の効果は「その場面で自動で発動したその戦いの間」として書く
    if (ctx.np && ctx.npMode === 'always') ctx = Object.assign({}, ctx, { np: false, always: true });
    const tt = trigText(p, e.id, ctx.np), inst = INSTANT.includes(e.id);
    if (ctx.np && ctx.npMode && NP_MODE_JA[ctx.npMode] && !(p && p.on)) {
      const w = NP_MODE_JA[ctx.npMode] + (npOnUse(e) && !inst && def.phase !== 'np' ? '（その戦いの間）' : '');
      return { name: p && p.name && AILMENTS[e.id] ? `${p.name}（${def.name}）` : def.name, who: inf.who, whoJa: WHO_JA[inf.who], bad,
        when: [!npOnUse(e) && !inst ? (e.persistent ? '宝具を持つ限り（消滅後も）' : '宝具を持っているだけで常に') : w, condText(p, e.id)].filter(Boolean).join('・'), text: inf.fx(m, p) };
    }
    const when = [ctx.np ? (p && p.on ? tt : !npOnUse(e) ? (e.persistent ? '宝具を持つ限り（消滅後も）' : '宝具を持っているだけで常に') : def.phase === 'np' || inst ? 'この宝具を使ったとき' : e.id === 'initiative' ? '戦いの始めの先手の判定に足す（それで先手を取れたら、この宝具を開幕に放つ）' : '宝具を使ったその戦いの間')
      : tt ? tt + (inst ? '' : { day: '（その日の終わりまで）', kill: '（次の戦いの終わりまで）', round: '（その打ち合いの間）' }[p && p.on] || '（その戦いの終わりまで）') : hasCond(p) ? '' : '常に',
      condText(p, e.id)].filter(Boolean).join('・');
    let text = inf.fx(m, p);
    if (e.id === 'disabled' && !ctx.np) text = 'このスキルの効果は働かない';
    if (p && p.team > 0 && TEAM_IDS.includes(e.id)) text += `。並んで戦う味方にも、その戦いの間 ${Math.round(p.team * 100)}% の強さで働く`;
    // 戦いの外で働く効果に、戦いの中の発動（戦いの始め・押し勝ったとき…）を付けても効かない
    if (p && p.on && BATTLE_ONS.includes(p.on) && OUTSIDE_IDS.includes(e.id)) text += '。※戦いの外（昼・夜の索敵）で働く効果なので、戦いの中で発動しても効かない（「常に」か「毎朝」に）';
    return { name: p && p.name && AILMENTS[e.id] ? `${p.name}（${def.name}）` : def.name, who: inf.who, whoJa: WHO_JA[inf.who], bad, when, text };
  }
  // 戦いの中の発動と、戦いの外でだけ読まれる効果（engine.js で戦いの外で読む：索敵・偵察・休養・工房・交渉・維持など）
  const BATTLE_ONS = ['start', 'round', 'win', 'hit', 'lose', 'pinch', 'np'];
  const OUTSIDE_IDS = ['stealth', 'detect', 'intel', 'regen', 'heal_other', 'craft', 'resource', 'solo', 'uncontrolled', 'negotiate', 'master_buff', 'upkeep_down'];

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
    '軍略':         [['intel', 0.5], ['guard', 0.4, { team: 0.5 }]],
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
    '吸血':         [['regen', 0.8], ['power', 0.2], ['drain_hp', 0.6]],
    '魔力吸収':     [['drain_mana', 1]],
    'エナジードレイン': [['drain_hp', 0.8], ['drain_mana', 0.6]],
    '嵐の航海者':   [['rally', 0.6], ['escape', 0.5]],
    '竜殺し':       [['power_vs', 1, { tag: '竜' }]],
    '獣殺し':       [['power_vs', 1, { tag: '獣' }]],
    '獣狩り':       [['power_vs', 1, { tag: '獣' }]],
    '神殺し':       [['power_vs', 1, { tag: '神性' }]],
    '対英雄':       [['debuff_body', 1]],
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

    // ---- 原作（TYPE-MOON作品）のクラス別スキル ----
    '復讐者':       [['power', 0.5], ['mental_guard', 0.6], ['negotiate', -0.6]],
    '忘却補正':     [['crit', 1]],
    '真名看破':     [['reveal', 1.5]],
    '神明裁決':     [['debuff', 0.6], ['negotiate', 0.6], ['reveal', 0.3]],
    '聖人':         [['regen', 0.6], ['heal_other', 0.4], ['negotiate', 0.4]],
    '領域外の生命': [['mental_guard', 1], ['magic_guard', 0.3], ['debuff_mind', 0.3]],
    '獣の権能':     [['power_vs', 1, { tag: '人型' }], ['guard', 0.4]],
    '自己保存':     [['guard', 0.8], ['escape', 0.6]],
    '自陣防御':     [['master_guard', 1.2], ['guard', 0.6]],
    '神殿作成':     [['territory', 1.4]],
    '工房作成':     [['territory', 1], ['craft', 0.3]],
    // ---- 原作の保有スキル ----
    '矢除けの加護': [['evade', 0.8]],
    '風除けの加護': [['evade', 0.5], ['initiative', 0.3]],
    '信仰の加護':   [['mental_guard', 1.2], ['power', 0.3]],
    '精霊の加護':   [['luck', 1]],
    '女神の加護':   [['luck', 0.8], ['guard', 0.3]],
    '聖杯の寵愛':   [['luck', 1.5], ['guard', 0.3]],
    '殉教者の魂':   [['mental_guard', 1], ['guts', 0.4]],
    '不屈の意志':   [['guts', 0.8], ['mental_guard', 1]],
    '不撓不屈':     [['guts', 0.8], ['mental_guard', 0.8]],
    'オーバーロード': [['power', 1.2], ['guard', -0.3]],
    '陰陽術':       [['power', 0.6], ['craft', 0.4], ['territory', 0.4]],
    'コレクター':   [['luck', 0.5], ['resource', 0.5]],
    // TYPE-MOON Wiki のスキル一覧（typemoon.wiki.cre.jp）と原作から足した、名前で意味の決まるスキル
    'アイテム作成': [['craft', 1]],
    '異界作成':     [['territory', 1.2]],
    '暗器':         [['initiative', 0.5], ['crit', 0.4], ['anti_master', 0.3]],
    'クイックドロウ': [['initiative', 1.2], ['crit', 0.3]],
    '戦闘加速':     [['initiative', 1], ['evade', 0.4], ['power', 0.2]],
    '神速':         [['initiative', 1.2], ['evade', 0.5], ['escape', 0.5]],
    '行動予測':     [['evade', 0.7], ['initiative', 0.5]],
    '新陰流':       [['evade', 0.8], ['power', 0.5], ['mental_guard', 0.3]],
    '甲賀流':       [['stealth', 1], ['intel', 0.5]],
    '蛮勇':         [['power', 0.8], ['mental_guard', 1], ['guard', -0.3]],
    '獅子心':       [['mental_guard', 0.6], ['rally', 0.6], ['debuff_mind', 0.3]],
    '至誠':         [['rally', 1], ['negotiate', 0.4]],
    '王佐の才':     [['intel', 0.6], ['rally', 0.6]],
    '英雄の介添':   [['rally', 0.8], ['heal_other', 0.3]],
    '支援砲撃':     [['power', 0.5], ['rally', 0.5]],
    '砲撃':         [['power', 0.7]],
    '護国の鬼将':   [['territory', 1.2], ['power', 0.5]],
    '仁王立ち':     [['guts', 1.2], ['master_guard', 0.8], ['pin', 0.4]],
    '金剛体':       [['guard', 1.2]],
    '献身の覚悟':   [['guts', 0.6], ['master_guard', 0.6]],
    '堅忍の老境':   [['guts', 0.6], ['mental_guard', 0.5]],
    '血脈励起':     [['power', 0.8], ['guts', 0.3]],
    '自己進化':     [['power', 0.6], ['regen', 0.4]],
    '自己変革':     [['np_boost', 0.5], ['mental_guard', 0.5]],
    '重力操作':     [['power', 0.6], ['pin', 0.5]],
    '召喚術':       [['craft', 0.5], ['rally', 0.5], ['intel', 0.3]],
    '受肉精霊':     [['guts', 0.5], ['upkeep_down', 0.6], ['regen', 0.3]],
    '個体増殖':     [['guts', 1]],
    '増殖':         [['guts', 0.8]],
    '医神':         [['heal_other', 1.2], ['regen', 0.5], ['reveal', 0.3]],
    '竜の心臓':     [['upkeep_down', 1.2], ['power', 0.5]],
    '竜の炉心':     [['upkeep_down', 1.2], ['power', 0.5]],
    '魔力炉心':     [['upkeep_down', 1.2], ['power', 0.3]],
    '魔力装填':     [['np_boost', 0.6]],
    'エンチャント': [['master_buff', 1, { stat: 'body' }], ['craft', 0.5]],
    '空想具現化':   [['territory', 1.2], ['power', 0.6]],
    '凶化':         [['power', 0.8], ['upkeep_up', 0.3]],
    '大量生産':     [['craft', 0.8], ['resource', 0.4]],
    '傾国の寵姫':   [['charm', 0.8], ['negotiate', 0.4], ['debuff_mind', 0.3]],
    '毒婦':         [['charm', 0.8], ['conceal', 0.4]],
    '千変万化':     [['conceal', 1], ['evade', 0.4]],
    '未来視':       [['evade', 0.8], ['initiative', 0.6], ['detect', 0.4]],
    '予言':         [['intel', 0.8], ['evade', 0.4]],
    '占星術':       [['intel', 0.8], ['luck', 0.4]],
    '鋼鉄の決意':   [['guard', 0.5], ['mental_guard', 0.5], ['initiative', 0.4]],
    '明鏡止水':     [['mental_guard', 1.2], ['evade', 0.4]],
    '自己暗示':     [['mental_guard', 1]],
    '反骨の相':     [['cs_resist', 1], ['mental_guard', 0.5]],
    '理性蒸発':     [['mental_guard', 1], ['conceal', -0.6], ['negotiate', -0.3]],
    '精神異常':     [['mental_guard', 1.2], ['negotiate', -0.8]],
    '頭痛持ち':     [['mental_guard', -0.5]],
    '獣化':         [['power', 0.8]],
    '混血':         [['power', 0.4], ['guard', 0.2]],
    '竜種':         [['tag', 1, { tag: '竜' }], ['power', 0.5]],
    '神秘殺し':     [['pierce', 0.5], ['power_vs', 0.6, { tag: '魔性' }]],
    '鬼殺し':       [['power_vs', 1, { tag: '魔性' }]],
    '対邪悪':       [['power_vs', 1, { tag: '魔性' }]],
    '殺戮技巧':     [['power_vs', 1, { tag: '人型' }]],
    '霧夜の殺人':   [['crit', 0.8, { cond: '夜' }], ['anti_master', 0.4]],
    '人体理解':     [['crit', 0.8], ['heal_other', 0.4]],
    '拷問技術':     [['debuff_body', 0.6], ['power', 0.3]],
    '魔眼':         [['debuff', 0.8], ['pin', 0.4]],
    '呪術':         [['debuff_body', 1], ['craft', 0.3]],
    '呪詛':         [['debuff_body', 0.6], ['wither', 1]],
    '錬金術':       [['craft', 1], ['resource', 0.5]],
    '薬学':         [['heal_other', 0.8], ['craft', 0.4]],
    '看護':         [['heal_other', 1.2]],
    '蔵知の司書':   [['intel', 1], ['reveal', 0.5]],
    '中国武術':     [['power', 0.8], ['evade', 0.4]],
    '武術':         [['power', 0.6]],
    '剣術':         [['power', 0.6]],
    '槍術':         [['power', 0.6]],
    '弓術':         [['power', 0.5], ['initiative', 0.3]],
    '棍棒術':       [['power', 0.6]],
    '天狗の兵法':   [['initiative', 0.8], ['power', 0.4]],
    '兵法':         [['intel', 0.5], ['guard', 0.4]],
    '軍師':         [['intel', 0.6], ['rally', 0.4]],
    '戦術':         [['intel', 0.4], ['power', 0.3]],
    '指揮':         [['rally', 1]],
    '統率':         [['rally', 1]],
    '鼓舞':         [['rally', 0.8], ['power', 0.2, { team: 1 }]],
    '激励':         [['rally', 0.6]],
    '演説':         [['negotiate', 0.6], ['rally', 0.4]],
    '弁舌':         [['negotiate', 1]],
    '交渉術':       [['negotiate', 1]],
    '鷹の瞳':       [['detect', 1], ['initiative', 0.3]],
    '気配察知':     [['detect', 1]],
    '審美眼':       [['reveal', 0.8]],
    '観察眼':       [['reveal', 0.7], ['intel', 0.3]],
    '野生の勘':     [['evade', 0.6], ['detect', 0.4]],
    '野生の感':     [['evade', 0.6], ['detect', 0.4]],   // Wikiで見かけた表記
    '予知':         [['evade', 0.8], ['initiative', 0.5]],
    '神託':         [['evade', 0.5], ['detect', 0.5], ['intel', 0.5]],
    '見切り':       [['evade', 1]],
    '受け流し':     [['guard', 0.6], ['evade', 0.3]],
    '鉄壁':         [['guard', 1]],
    '不死身':       [['guts', 1], ['guard', 0.4]],
    '再生':         [['regen', 1]],
    '剛力':         [['power', 0.8]],
    '巨躯':         [['guard', 0.6], ['power', 0.4]],
    '俊足':         [['initiative', 0.6], ['escape', 0.6]],
    '跳躍':         [['initiative', 0.5], ['escape', 0.4]],
    '飛行':         [['escape', 1], ['initiative', 0.3]],
    '航海術':       [['escape', 0.5], ['intel', 0.3]],
    '狩猟':         [['detect', 0.5], ['power_vs', 0.5, { tag: '獣' }]],
    '追跡':         [['detect', 1], ['pin', 0.5]],
    '隠密':         [['stealth', 1]],
    '暗殺':         [['anti_master', 1], ['stealth', 0.5]],
    '奇襲':         [['initiative', 1]],
    '偽装工作':     [['conceal', 1]],
    '変身':         [['conceal', 0.8], ['power', 0.2]],
    '無冠の武芸':   [['conceal', 1], ['power', 0.3]],
    '己が栄光の為でなく': [['conceal', 1.2]],
    '騎士は徒手にて死せず': [['power', 0.6]],
    '守護':         [['master_guard', 0.8]],
    '護衛':         [['master_guard', 1]],
    '忠義':         [['master_guard', 0.5], ['mental_guard', 0.3]],
    '従者':         [['master_guard', 0.5], ['heal_other', 0.4], ['resource', 0.3]],
    '老練':         [['mental_guard', 0.8], ['power', 0.2]],
    '愛の黒子':     [['charm', 1.2]],
    '魅惑の美声':   [['charm', 1]],
    '美声':         [['charm', 0.6], ['rally', 0.3]],
    '美貌':         [['charm', 0.8]],
    '美少年':       [['charm', 0.8]],
    '美丈夫':       [['charm', 0.6], ['negotiate', 0.3]],
    '麗しの姫君':   [['charm', 0.6], ['master_guard', 0.5]],
    '百発百中':     [['crit', 1], ['pierce', 0.4]],
    // ---- 原作で複数の英霊が持つスキル・一般的な技能（FGO実装470騎の集計で確認） ----
    'ハイ・サーヴァント': [['power', 0.3], ['guard', 0.3]],
    '狂気':         [['power', 0.6], ['mental_guard', 0.8], ['negotiate', -0.6]],
    '妖精眼':       [['reveal', 1.2], ['mental_guard', 0.4]],
    '無限の魔力供給': [['upkeep_down', 1.5], ['np_cost', -0.5]],
    '霊媒体質':     [['upkeep_down', 0.5], ['magic_guard', 0.3]],
    '天賦の叡智':   [['guard', 0.4], ['np_boost', 0.5], ['guts', 0.5]],
    '天賦の見識':   [['reveal', 0.8], ['intel', 0.5]],
    '自然の嬰児':   [['guard', 0.4], ['upkeep_down', 0.6]],
    '直死の魔眼':   [['pierce', 1], ['instakill', 0.8]],
    '投影魔術':     [['power', 0.6], ['craft', 0.6]],
    'ルーン魔術':   [['power', 0.4], ['magic_guard', 0.4], ['craft', 0.3]],
    '軍師の忠言':   [['guard', 0.6], ['intel', 0.5], ['rally', 0.3]],
    '最果ての加護': [['crit', 0.8], ['guts', 0.3]],
    '紅顔の美少年': [['charm', 1]],
    '聖者の数字':   [['power', 0.6]],
    '治癒の竪琴':   [['heal_other', 1], ['rally', 0.3]],
    '正気喪失':     [['debuff_mind', 1], ['charm', 0.4]],
    '黄金の杯':     [['debuff_mind', 0.6], ['pierce', 0.4]],
    'アクセルターン': [['evade', 1], ['crit', 0.4]],
    'スケープゴート': [['master_guard', 1]],
    '耐毒':         [['guard', 0.4], ['ail_guard', 0.8]],
    '対毒':         [['ail_guard', 1]],
    '毒耐性':       [['ail_guard', 1]],
    '病弱':         [['guard', -0.8], ['luck', -0.3]],
    '忍術':         [['stealth', 1], ['evade', 0.5]],
    '幻術':         [['conceal', 0.6], ['debuff_mind', 0.5], ['charm', 0.3]],
    '外科手術':     [['heal_other', 1.2]],
    '人体研究':     [['crit', 0.8], ['heal_other', 0.4]],
    '一意専心':     [['mental_guard', 0.8], ['power', 0.4]],
    '沈着冷静':     [['mental_guard', 1]],
    '傍若無人':     [['power', 0.3], ['negotiate', -0.6]],
    '処刑人':       [['crit', 0.6], ['instakill', 0.4]],
    'フェロモン':   [['charm', 1]],
    'ストーキング': [['detect', 0.8], ['stealth', 0.4]],
    '先の先':       [['initiative', 1.2]],
    '無刀取り':     [['evade', 0.6], ['guard', 0.4]],
    '天眼':         [['crit', 0.8], ['pierce', 0.5]],
    '中国拳法':     [['power', 0.8], ['evade', 0.4]],
    'エイミング':   [['crit', 0.6], ['power', 0.3]],
    '戦闘撤退':     [['escape', 1.2]],
    '英雄作成':     [['power', 0.5], ['rally', 0.3]],
    '家事百般':     [['heal_other', 0.4], ['resource', 0.4], ['negotiate', 0.3]],
    '要塞構築':     [['territory', 1.2], ['guard', 0.3]],
    '都市改造':     [['territory', 1]],
    '水泳上手':     [['escape', 0.6, { cond: '水辺' }], ['power', 0.3, { cond: '水辺' }]],
    '洗礼詠唱':     [['power_vs', 1.2, { tag: '不死' }]],
    '対霊戦闘':     [['power_vs', 1, { tag: '不死' }]],
    '代行者':       [['power_vs', 1, { tag: '不死' }], ['power_vs', 0.6, { tag: '魔性' }]],
    // ---- 名前の一部によく使われる言葉（部分一致で土台にし、説明文で補う） ----
    '神核':         [['tag', 1, { tag: '神性' }], ['mental_guard', 0.8], ['guard', 0.3]],   // 海神の神核・蛇神の神核…
    '叡智':         [['intel', 0.5], ['power', 0.3]],                                       // 魔神の叡智・大神の叡智…
    '智慧':         [['intel', 0.5], ['power', 0.3]],                                       // 魔境の智慧・神授の智慧…
    '武練':         [['power', 0.5], ['mental_guard', 0.5]],                                // 源氏の武練・蒼穹の武練…
    '審美':         [['reveal', 0.8]],                                                      // 刀剣審美・冒涜審美…
    '航海者':       [['escape', 0.5], ['rally', 0.4]],                                      // 星の航海者・救世の航海者…
    '航海':         [['escape', 0.5], ['intel', 0.3]],
    '託宣':         [['evade', 0.5], ['detect', 0.5], ['intel', 0.5]],                      // 光の託宣・闇の託宣
    '神通力':       [['power', 0.4], ['intel', 0.3]],
    '鬼道':         [['debuff', 0.6], ['charm', 0.4]],
    '道術':         [['power', 0.4], ['craft', 0.4], ['magic_guard', 0.3]],
    '陰陽道':       [['debuff', 0.6], ['territory', 0.4]],
    '数秘術':       [['craft', 0.4], ['intel', 0.4]],
    '狙撃':         [['crit', 0.6], ['initiative', 0.4]],
    '商才':         [['resource', 1]],
    '生存':         [['regen', 0.4], ['guts', 0.3]],
    '変容':         [['power', 0.5]],
    '戦略':         [['intel', 0.6], ['rally', 0.3]],
    '加護':         [['luck', 0.6], ['guard', 0.3]],
    '寵愛':         [['luck', 0.8]],
    '恩寵':         [['luck', 0.5], ['power', 0.2]],
    '恩恵':         [['luck', 0.5], ['power', 0.2]],
    '祝福':         [['luck', 0.6], ['regen', 0.3]],
    '特権':         [['power', 0.4], ['negotiate', 0.4]],
  };
  // 説明文で「〇〇と同等」と参照されても拾わない、一般的すぎる名前
  // 一般的な言葉の名前（「従者」「加護」など）は、名前が一致しても辞書だけで決めず、説明文の解析と合わせる
  const GENERIC = new Set(['加護', '寵愛', '恩寵', '恩恵', '祝福', '特権', '指揮', '統率', '鼓舞', '激励', '演説', '弁舌', '守護', '護衛', '忠義', '従者', '老練',
    '武術', '剣術', '槍術', '弓術', '兵法', '軍師', '戦術', '呪術', '呪詛', '錬金術', '薬学', '看護', '魔眼', '再生', '剛力', '巨躯',
    '鉄壁', '俊足', '跳躍', '飛行', '狩猟', '追跡', '隠密', '暗殺', '奇襲', '変身', '予知', '神託', '見切り', '受け流し', '美声', '美貌',
    '美少年', '美丈夫', '混血', '獣化', '竜種', '交渉術', '航海術',
    '神核', '叡智', '智慧', '武練', '審美', '航海者', '航海', '託宣', '神通力', '鬼道', '道術', '陰陽道', '数秘術', '狙撃', '商才', '生存', '変容', '戦略',
    // 名前は原作のスキルでも、Wikiごとに中身の書き方が違うもの（説明文の効果も足す）
    '砲撃', '大量生産', '増殖', '傾国の寵姫', '受肉精霊', '凶化', '毒婦', 'エンチャント']);
  const COMPOUND_SKIP = new Set(['魔術', '幸運', '射撃', '投擲', '変化', '話術', '医術', 'ルーン', '吸血', '神性', '聖人', '復讐者', ...GENERIC]);

  // ---------- 属性タグの正規化（特攻・弱点の照合用） ----------
  const TAG_CANON = [
    ['獣', /獣|動物|野生/], ['竜', /竜|龍|ドラゴン/], ['神性', /神性|神霊|神格|神々|神獣以外の神/], ['不死', /不死|アンデッド|死者|亡霊|吸血鬼/],
    ['魔性', /魔性|悪魔|魔物|妖怪|怪異|鬼|邪悪/], ['英雄', /英雄|英霊/], ['人型', /人型|人間|人類/], ['女性', /女性|女/], ['男性', /男性|男/],
    ['騎乗', /騎乗|騎兵/], ['機械', /機械|機甲|ロボ/], ['王', /王|皇帝/],
  ];
  function canonTag(s) {
    const t = String(s || '').trim();
    for (const [tag, re] of TAG_CANON) if (re.test(t)) return tag;
    // 「歴史研究家と吟遊詩人に対して」→「吟遊詩人」（並びの最後の語を使う）
    const last = t.replace(/[「」『』]/g, '').replace(/(?:に対して|に対する|に対し|への|には)$/, '').split(/[とや、・,]/).filter(Boolean).pop() || t;
    return last.replace(/[にへをと]$/, '').slice(-6).replace(/^[をにへのと]/, '');
  }

  // ---------- 説明文の解析規則 ----------
  // 文（。や改行で区切った1文）ごとに上から順に照合する。上にあるものほど優先。
  //   re   : 当たる表現
  //   not  : 同じ文にこれがあれば当てない
  //   id,f : 部品と係数（f が関数なら文から計算）
  //   p    : params（関数なら文から計算）
  //   only : 'skill' / 'np' で対象を限定
  //   cond : true なら文中の場所の条件（水辺など）を params.cond に付ける
  // 弱体化の種類：心への干渉（威圧・恐怖・幻惑…）は精神弱体、体への干渉（呪い・衰え・重圧・毒気…）は肉体弱体、どちらとも言えなければ種類なし
  const MIND_WORDS = /恐怖|威圧|畏怖|萎縮|気圧|幻惑|幻覚|幻術|錯乱|判断力|精神|戦意|士気を|心を|動揺|洗脳|魅了|狂気|正気/;
  const BODY_WORDS = /呪い|呪詛|呪術|生命力|衰弱|衰え|重圧|毒|病|腐|疲労|筋力|耐久|敏捷|身体|肉体|体力|鈍化|老化|枯/;
  const debuffKind = sen => MIND_WORDS.test(sen) ? 'debuff_mind' : BODY_WORDS.test(sen) ? 'debuff_body' : 'debuff';
  const RULES = [
    { re: /脱落する|自爆|(?:自分|自身)が爆発|自身[^。]{0,6}爆発|連行/, id: 'self_retire', only: 'np', f: sen => /(?:と|ると|たら|れば|場合)[^。]{0,4}(?:自爆|脱落|爆発)/.test(sen) ? 0.2 : 1 },
    { re: /(?:この召喚|この霊基|今回の召喚|現界では)[^。]*(?:使用|発動)(?:することが|は)?(?:出来|でき)ない/, id: 'disabled', only: 'np' },
    { re: /反動|自身が耐えきれ|自分も傷|自傷|肛門が裂け/, id: 'backfire', only: 'np' },
    { re: /即死/, id: 'instakill', not: /打ち消|無効|耐性|防ぐ|防げ/ },
    // 「見抜くことが出来ない」「察知する事が出来ない」：情報の面で不利
    { re: /(?:見抜く|看破する|見破る)(?:事|こと)?が?(?:出来|でき)な|見抜けな|見破れな/, id: 'reveal', f: -1 },
    { re: /(?:察知|感知|探知)(?:する)?(?:事|こと)が?(?:出来|でき)な/, id: 'detect', f: -1 },
    { re: /必中|防御は無意味|防御を無視|対魔力[^。]{0,8}(?:影響を受けない|無視|貫)|(?:死|蘇生|戦闘続行|耐性|防御|再生)[^。]{0,12}(?:無効化|無意味|効果を発揮しない)/, id: 'pierce' },
    { re: /(?:相手|敵)[^。]{0,10}(?:逃走|撤退|離脱|逃げ)|逃走手段は無|逃さない|逃がさない|拘束|緊縛|閉じ込め|捕縛|引きずりこ/, id: 'pin', not: /令呪/ },
    { re: /(?:パラメーター|パラメータ|ステータス|能力)[^。]{0,8}(?:ダウン|低下させ|下げ)|弱体化|弱体を付与|弱体付与|デバフ|判断力を鈍|生命力を[^。]{0,10}奪|呪いを(?:かけ|与え)|奪われる|恐怖へと変換/, id: debuffKind, not: /(?:自身|自分)[^。]{0,6}(?:ダウン|低下|下が|マイナス)|デバフ[^。]{0,10}(?:難し|至難|効かな|無効|遮断|防)|弱体化を受け|弱体化(?:が|も)?働く|弱体(?:化)?を[^。]{0,4}(?:受けた|跳ね|防|無効)/ },
    { re: /判定に失敗|ドジ|うっかり|ペナルティ/, id: 'luck', f: -1, not: /相手|敵/ },
    { re: /主人公補正|悪運|運命力|豪運|強運|幸運を呼び込/, id: 'luck' },
    { re: /打たれ弱|虚弱|紙装甲|耐久[^。]{0,8}マイナス/, id: 'guard', f: -1.2 },
    { re: /令呪[^。]{0,12}(?:拘束力が弱|効かない|抵抗|無効)/, id: 'cs_resist' },
    { re: /会心|クリティカル|かいしん|与ダメージ向上/, id: 'crit' },
    { re: /生き延び|生還|致命傷|瀕死|食いしば|ガッツ|蘇生|復活|消滅寸前|不老不死|不死身|霊基を?再構築|残っていれば[^。]{0,20}(?:再構築|再生|蘇)/, id: 'guts', not: /即死[^。]*(?:付与|判定)|無効化する|効果を発揮しない|無意味|(?:蘇生|復活)(?:は|が|も)?[^。]{0,4}(?:不可能|出来ない|できない)/ },
    { re: /増殖|増えて|増えている|分裂|分身/, id: 'guts', f: 0.8 },
    { re: /特[攻効]/, id: 'power_vs', p: (sen, m) => ({ tag: canonTag(sen.slice(Math.max(0, m.index - 24), m.index)) }) },
    { re: /(?:に対する|への)攻撃(?:判定)?に(?:ボーナス|補正|プラス)/, id: 'power_vs', f: 0.6, p: (sen, m) => ({ tag: canonTag(sen.slice(Math.max(0, m.index - 12), m.index)) }) },
    { re: /黄金律|黄金率|財産|財宝|宝物|宝石|貴金属|金品|金銭|資金|収入|財を/, id: 'resource', f: 0.8 },
    { re: /作成|製作|錬成|鍛冶|調合|生産|量産/, id: 'craft', f: 0.8, only: 'skill', not: /魔力を?生産|魔力の生産/ },
    { re: /交渉|宥め|説得|外交|弁舌|接客|もてなし|意思疎通|証言誘導/, id: 'negotiate' },
    { re: /統率|指揮|鼓舞|士気|軍団|自軍|兵たち|演奏|歌唱|竪琴|周囲の[^。]{0,20}(?:英霊|サーヴァント|味方)[^。]{0,24}(?:上昇|強化|分け与え)/, id: 'rally', f: 0.8, not: /指揮する能力ではなく/ },
    { re: /乱戦|多対多|一対多|多人数戦闘/, id: 'power', f: 0.6 },
    { re: /戦術(?:面|眼|的|を立て|に長け)|策略|謀略|計略|知略|采配/, id: 'intel', f: 0.6 },
    { re: /魅了|魅惑|虜|誘惑|媚び/, id: 'charm' },
    { re: /(?:自身|自分)[^。]{0,8}(?:回復|再生|癒)|自己回復|再生能力|即時復元|自己修復|肉体を[^。]{0,10}復元/, id: 'regen', not: /修復不可能/ },
    { re: /治療|治癒|回復|看護|手当|癒[やすし]|バッドステータスを除/, id: 'heal_other', f: 0.8, not: /(?:自身|自分)[^。]{0,8}(?:回復|再生|癒)/ },
    { re: /(?:真名|正体|素性)を?(?:悟らせ|隠|偽|知られ)|隠蔽|偽装|秘匿|変装|見せかけ|表記のみ/, id: 'conceal', not: /偽装[^。]{0,6}(?:を|や|も)?[^。]{0,8}(?:察知|見抜|看破)(?:する|す)?(?:事|こと)?が?(?:出来|でき)な/ },
    { re: /気配[^。]{0,6}(?:消|断)|隠密|潜伏|姿を消|透明|潜ん|バレない|感知は[^。]*不可能/, id: 'stealth', not: /気配遮断を[^。]{0,4}(?:察知|感知|見抜)|(?:隠密|隠匿)[^。]{0,12}(?:皆無|向かない|不向き|無い|ない)/ },
    { re: /(?:隠密|隠匿)[^。]{0,12}(?:皆無|向かない|不向き)/, id: 'stealth', f: -0.5 },
    // 他者の持つスキルの話（「直感持ちのサーヴァントは看破可能」）や、見抜かれる側の話は除く
    { re: /見抜|看破|見破|暴く|解析|識別|鑑定|構造[^。]{0,6}を?理解/, id: 'reveal', not: /持ちの(?:サーヴァント|マスター)|を持つ(?:相手|者|サーヴァント)|看破(?:可能|され)|看破系[^。]{0,10}(?:に対|抵抗)|に対しては抵抗|見抜(?:く|け)(?:事|こと)?が?(?:出来|でき)な|見抜けな/ },
    { re: /探知|感知|索敵|察知|千里眼|遠くまで見|見通/, id: 'detect', not: /感知は[^。]*不可能|(?:察知|感知|探知)(?:する)?(?:事|こと)が?(?:出来|でき)な/ },
    { re: /情報|諜報|調査|偵察|研究|観察/, id: 'intel', f: 0.8, not: /持ちの(?:サーヴァント|マスター)|情報を?偽|偽造した情報|偽の情報/ },
    // 反撃（カウンター）・衰弱（重なっていく弱体化）
    { re: /反撃|カウンター|倍返し|返り討ち|迎え撃つ|やり返す/, id: 'counter', not: /反撃(?:を)?(?:許さ|させ|受け|され)|カウンターを(?:受け|取られ)|反撃するよう|逸話から/ },
    { re: /衰弱|徐々に[^。]{0,12}(?:弱|蝕|衰|削|奪)|じわじわと[^。]{0,8}(?:蝕|削|弱)|蝕んでいく|重ねるごとに[^。]{0,8}(?:弱|低下)/, id: 'wither', not: /(?:自身|自分)[^。]{0,8}(?:衰弱|弱|蝕|衰)|衰弱(?:を|から)?[^。]{0,4}(?:防|無効|回復|治)/ },
    { re: /回避|避け|かわし|躱/, id: 'evade' },
    { re: /先手|先制|奇襲|俊敏|俊足|神速|高速移動|最高速|加速|跳躍|ジャンプ|脚力|機動力/, id: 'initiative', cond: true },
    { re: /逃走|撤退|離脱|逃げ|飛行|空を(?:飛|走)|天馬|跳び越/, id: 'escape', not: /(?:相手|敵)[^。]{0,10}(?:逃走|撤退|離脱|逃げ)|逃さない|逃がさない|逃走手段|逃げるしか/ },
    { re: /魔術[^。]{0,10}(?:無効|防|耐性|弾)|対魔力/, id: 'magic_guard', not: /対魔力[^。]{0,8}(?:影響を受けない|を?無視|を?貫)/ },
    { re: /精神[^。]{0,8}(?:耐性|干渉を|無効)|精神デバフ[^。]{0,6}(?:難|効かな|無効|遮断|防)|精神弱体を|精神[^。]{0,10}跳ね除け|動じない|恐怖を(?:感じ|知ら)/, id: 'mental_guard' },
    { re: /(?:神々|神)[^。]{0,8}(?:干渉|加護|権能)[^。]{0,16}(?:削減|軽減|防ぐ|打ち消)/, id: 'magic_guard' },
    { re: /防御|頑丈|堅牢|盾|守り|守る|鎧|防ぐ|胴丸|耐久[^。]{0,6}(?:上昇|ランクアップ|向上)/, id: 'guard', not: /防御は無意味|マイナス/, cond: true },
    { re: /陣地|工房|結界|拠点|神殿|戦闘空間|領域(?:を|に)?(?:展開|作成|形成|内)/, id: 'territory', not: /対界宝具で/ },
    { re: /燃費が(?:良|いい)|魔力消費[^。]{0,8}(?:少|軽|抑|格安)|魔力を[^。]{0,30}(?:補給|自前で賄|供給を得)/, id: 'upkeep_down', only: 'skill' },
    { re: /魔力消費[^。]{0,8}(?:軽|少|格安|抑)/, id: 'np_cost', f: -1, only: 'np' },
    { re: /燃費(?:が|は)?(?:悪|すこぶる悪)|コスパが(?:悪|非常によろしくない)|魔力消費(?:が|も)?(?:高|大き|相応)|高い魔力を必要|魔力を大量/, id: 'np_cost', only: 'np' },
    { re: /燃費(?:が|は)?悪|魔力消費(?:が|も)?(?:高|大き)/, id: 'upkeep_up', only: 'skill' },
    { re: /単独行動|単独で(?:も)?現界|マスター不在|現界を維持/, id: 'solo', f: 0.7 },
    { re: /理性[^。]{0,8}(?:失|奪|引き換え|蒸発)|暴走|言うことを聞かない|勝手に/, id: 'uncontrolled', f: 0.7, not: /暴走させた|奪われていようとも|奪われても/ },
    { re: /攻撃力|威力|膂力|怪力|筋力[^。]{0,8}(?:上昇|向上|ランクアップ)|(?:ステータス|パラメーター|パラメータ)[^。]{0,10}(?:上昇|向上|強化|ランクアップ)|ランク(?:が)?上昇|強化され|戦闘能力(?:を向上|が増幅)|増幅させ|大幅に上昇|ボーナスを(?:獲得|得)|バフが発生|ブーストアップ|放出能力|攻撃(?:時|判定)?に補正|攻撃時[^。]{0,6}補正|(?:耐久|敏捷|魔力|幸運)[^。]{0,12}(?:を|が)?上昇させ/, id: 'power', f: 0.8, cond: true, not: /(?:幸運|耐久|神性|黄金律)(?:の|値)?(?:パラメーター|パラメータ)?(?:を|は|が)[^。、・]{0,10}ランクアップ/ },
    // 状態異常（毒・スタン・混乱・宝具封印）と、その耐性。言い回しがはっきりしたものだけ（防ぐ・治す話は除く）
    { re: /毒[^。]{0,12}(?:付与|与え|蝕|冒|侵|回る|塗|を持つ|を武器)|猛毒|毒の(?:刃|矢|牙|霧|息)|毒素が|毒性(?:と|の|を持)/, id: 'poison', not: /耐性|抵抗|無効|効かな|切除|取り除|消毒|解毒|治療|対毒|耐毒|毒婦/ },
    { re: /(?:相手|敵|対象)[^。]{0,12}(?:行動不能|身動きが取れな|動きを封じ|動けなく)|麻痺させ|痺れさせ|硬直させ|石化させ|凍りつかせ|気絶させ|昏倒させ|スタン(?:を付与|させ)/, id: 'stun', not: /自身|自分|耐性|無効|防ぐ/ },
    { re: /(?:相手|敵|対象)[^。]{0,12}(?:混乱|錯乱|幻惑)させ|混乱を(?:付与|与え|招)|錯乱させ|幻覚(?:を見せ|作用|に陥)|幻惑の効果/, id: 'confuse', not: /無効化|弱体化し|耐性|防ぐ|効かな/ },
    { re: /宝具[^。]{0,10}(?:を封じ|を封印す|の使用を(?:封|禁|妨)|を使えなく)|真名解放を(?:封|阻|させな)/, id: 'seal', not: /自身|自分|この宝具/ },
    { re: /毒[^。]{0,6}(?:耐性|無効|効かな)|(?:状態異常|バッドステータス|病毒)[^。]{0,8}(?:耐性|無効|効かな|防|抵抗)/, id: 'ail_guard', not: /(?:相手|敵)の|引き下げ|下げ|低下|弱め/ },
    // 回復・吸収・解除（その場で働く効果。発動の場面は効果ごとの既定）。言い回しがはっきりしたものだけ
    { re: /(?:生命力|精気|体力|霊基|血液?|命)[^。]{0,6}(?:を)?(?:吸収|吸い取|吸い上げ|啜|奪い取)|吸血(?:し|を行|によ)|エナジードレイン/, id: 'drain_hp', not: /吸収され|奪われ|吸われ/ },
    { re: /魔力[^。]{0,8}(?:を)?(?:吸収|吸い取|吸い上げ|奪い取|奪う|簒奪)|魔力(?:の)?(?:略奪|強奪)/, id: 'drain_mana', not: /吸収され|奪われ|吸われ|大気|大地|マナ|霊脈|地脈|周囲の魔力|自然/ },
    { re: /(?:強化|バフ|加護|祝福)(?:状態|効果)?[^。]{0,4}(?:を)?(?:解除|打ち消|剥ぎ取|剥が)/, id: 'strip', not: /自身|自分|されない|受けない/ },
    { re: /(?:弱体|状態異常|呪い|呪詛|バッドステータス)(?:効果)?[^。]{0,6}(?:を)?(?:解除|解呪|浄化|祓|消し去|取り除)|解呪/, id: 'cleanse', not: /(?:相手|敵)の/ },
    { re: /スキル[^。]{0,8}(?:を封じ|を封印|の使用を(?:封|禁|妨)|を使えなく|を無力化)/, id: 'skill_seal', not: /自身|自分|このスキル/ },
    { re: /ダメージカット|(?:攻撃|ダメージ)を[^。]{0,6}(?:一定量|一定値)(?:軽減|減ら|カット)/, id: 'dmg_cut' },
    { re: /ターゲット集中|攻撃を(?:引き付け|引きつけ|一身に)|(?:味方|仲間|マスター)を(?:かば|庇)/, id: 'taunt' },
    { re: /宝具(?:の)?(?:連続(?:使用|解放)|連発|再使用|チャージ|充填)/, id: 'np_charge', not: /できない|不可|出来ない/ },
  ];
  // 場所などの条件
  // 文の場面の言葉 → 効果の条件。「山中や海で」のように複数あれば、それぞれの条件で足す（どちらの場面でも働く）
  const CONDS = [['水辺', /水場|水辺|海上|水上|海で|海に|水中|川で/], ['森', /森の中|森で|樹木|木々/], ['山', /山中|山で|山間|山岳/], ['夜', /夜間|夜に|暗闇/],
    ['瀕死', /瀕死の?(?:時|際|状態)|窮地(?:に陥|である|に立)[^。]{0,4}ほど|追い詰められ(?:た時|るほど)|劣勢(?:である|になる)ほど/], ['拠点', /陣地内|工房内|自陣で|拠点(?:内|で戦)/]];
  // マスターを強化する文（「マスターに幸運の加護を与える」など）
  const MASTER_STAT_WORDS = [['luck', /幸運/], ['mana', /魔力/], ['craft', /魔術/], ['body', /体力|肉体|身体/], ['mind', /精神/]];

  // 宝具の攻撃・非攻撃の判定
  const ATTACK_WORDS = /攻撃|ダメージ|破壊|斬|貫|焼き|焼却|灼き|薙ぎ|放つ|放たれ|砲撃|一撃|殲滅|消し飛|吹き飛|撃ち|殺す|殺害|穿|叩き|粉砕|蹂躙|射撃|呑み込|丸呑|飲み込|喰らい|陥没|溶か|溶断|爆発|爆撃|突撃|突進|踏み潰|掃射|投擲|投げつけ|ビーム|切り裂|引き裂|雷撃|ぶっ飛|一掃|連射|乱射|射出|発射/;
  const NON_ATTACK = /(?:破壊力|攻撃力|殺傷力|攻撃能力)(?:は|を)?(?:持たない|無い|ない)|攻撃(?:は|が)?(?:行えない|出来ない|できない)|戦いは出来ない|戦闘は出来ない/;
  const PERSIST_WORDS = /消滅しようとも|消滅後も|消滅しても|死後も|脱落後も|退去後も/;
  const LOST_WORDS = /失われ|喪失|消失|封じられ|持たない|使えない|機能しない|統合され/;

  // ---------- 手直し用の表（取り込みツールやゲーム側から追加する） ----------
  const SKILL_OVERRIDES = {};    // 'スキル名': [[部品ID, 係数, params], ...]
  // 以下の表の「真名」は、同じ真名の別の騎がいて印 key があるときは '真名#印'（okey）
  const SERVANT_OVERRIDES = {};  // '真名/スキル名または宝具名': [[...]]
  const STAT_OVERRIDES = {};     // '真名': { str: 'B', end: 'C', ... }  書いた項目だけ置き換える
  const NP_OVERRIDES = {};       // '真名/宝具名': { attack?: true|false, mode?: NP_MODES のキー }  攻撃宝具かどうか・発動のしかたの手直し
  const CONTENT_OVERRIDES = {};  // '真名': { skills, nps, voice, text, profile, relations, base }  内容の手直し（build.js の applyContent）
  const PAGE_OVERRIDES = {};     // '真名': 'kagemiya のページ名'  ページ名が真名と違うとき（build.js の pageOf・取り込みツール）
  // overrides.json の表の名前 → 表。読み込む・書き出す・公開中と見比べるときはこれを使う
  // 確認済みの「要確認」：'真名': [要確認の目印（build.js の reviewSig）…]。取り直しても、同じ内容の要確認なら確認済みのまま
  const REVIEWED = {};
  // 属性マスタ：Wikiの「その他属性（特性）」は書き方がばらばら（神／神性、獣／魔獣…）なので、正規の名前と別名を決めて、どの騎にも同じ名前で付ける
  const ATTR_MASTER = {};        // '属性名': { aliases: ['別の書き方', ...], note?: '説明' }
  const ATTR_OF = {};            // '真名': ['属性名', ...]  この騎の属性を直接決める（Wikiの特性の代わりに使う。無ければ Wikiの特性をマスタで読み替える）
  const BOSS_PARAMS = {};        // '真名': { label?, gauges?, power?, guard?, mana?, regen?, heal?, find?, intro?, aoe?: { 宝具名: 値 } }  ボス専用の英霊の設定（特異点攻略）
  const BOSS_ATTR = 'ボス専用';  // この属性を持つ英霊は聖杯戦争には呼ばれず、特異点攻略のボスになる
  // 同じ真名の別の騎（同じクラスでも、別のクラスでも）を見分ける印 sv.key。手直し表は真名だけで引くため、印があるときは '真名#印' で引く。
  // 印が無い騎は今までどおり真名のまま（既存の手直しはそのまま効く）
  /** 手直し表で引くときの名前（効果・ステータス・宝具の扱い・ページ名・確認済み・属性・ボス設定。内容の手直しは Wiki の真名で、同じ形） */
  const okey = sv => !sv ? '' : sv.key ? sv.trueName + '#' + sv.key : sv.trueName;
  /** サーヴァントの id（'クラス:真名'、印があれば 'クラス:真名#印'） */
  const idOf = sv => ((sv.class && sv.class.key) || 'extra') + ':' + (okey(sv) || 'unknown');
  const OVERRIDE_TABLES = { global: SKILL_OVERRIDES, servant: SERVANT_OVERRIDES, stats: STAT_OVERRIDES, np: NP_OVERRIDES, content: CONTENT_OVERRIDES, pages: PAGE_OVERRIDES, reviewed: REVIEWED, attrs: ATTR_MASTER, attrOf: ATTR_OF, boss: BOSS_PARAMS };
  // 属性名の照合用（全角半角・大小・前後の空白とかっこを無視）
  const attrFold = s => String(s == null ? '' : s).normalize('NFKC').trim().replace(/^[(（\[【〔]+|[)）\]】〕]+$/g, '').trim().toLowerCase();
  // 書き方 → 属性名の表（マスタの名前・別名。ボス専用は常にある）
  let attrCache = null;
  function attrIndex() {
    const sig = JSON.stringify(ATTR_MASTER);
    if (attrCache && attrCache.sig === sig) return attrCache.map;
    const map = new Map();
    const put = (k, n) => { k = attrFold(k); if (k && !map.has(k)) map.set(k, n); };
    put(BOSS_ATTR, BOSS_ATTR); put('ボス', BOSS_ATTR); put('ボスキャラ', BOSS_ATTR);
    for (const [n, v] of Object.entries(ATTR_MASTER)) put(n, n);
    for (const [n, v] of Object.entries(ATTR_MASTER)) for (const a of (v && v.aliases) || []) put(a, n);
    attrCache = { sig, map };
    return map;
  }
  /** 属性の一覧：{ attrs: 属性名の並び, unknown: マスタにない書き方 }。attrOf があればそれを、無ければ Wikiの特性を読み替える */
  function resolveAttrs(sv) {
    const own = ATTR_OF[okey(sv)], map = attrIndex(), attrs = [], unknown = [];
    for (const t of Array.isArray(own) ? own : (sv.traits || [])) {
      const raw = String(t == null ? '' : t).trim(); if (!raw) continue;
      const hit = map.get(attrFold(raw)), n = hit || raw;
      if (!attrs.includes(n)) attrs.push(n);
      if (!hit && !Array.isArray(own) && !unknown.includes(n)) unknown.push(n);
    }
    return { attrs, unknown };
  }

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
      if (/マスター(?:に|へ|の|を)/.test(sen) && /与え|上げ|上昇|加護|強化|高め|付与|アップ/.test(sen)) {
        const n = sen.match(/(\d+)\s*ランク/);
        let hit = false;
        for (const [stat, re] of MASTER_STAT_WORDS) if (re.test(sen)) { push('master_buff', n ? Math.min(5, +n[1]) : 1, { stat }); hit = true; }
        if (!hit && /マスターを[^。]{0,10}(?:戦わせ|強化)/.test(sen)) push('master_buff', 1, { stat: 'body' }); // 「マスターを戦わせるための強化」
      }
      const conds = CONDS.filter(([, re]) => re.test(sen)).map(x => x[0]);
      for (const r of RULES) {
        if (r.only && r.only !== kind) continue;
        const m = sen.match(r.re);
        if (!m || (r.not && r.not.test(sen))) continue;
        let p = typeof r.p === 'function' ? r.p(sen, m) : r.p || null;
        const id = typeof r.id === 'function' ? r.id(sen, m) : r.id, f = typeof r.f === 'function' ? r.f(sen, m) : (r.f == null ? 1 : r.f);
        if (r.cond && conds.length) for (const cond of conds) push(id, f, Object.assign({}, p || {}, { cond }));
        else push(id, f, p);
      }
    }
    // 上限は効果の種類で数える（同じ効果の場面違い——山中や海で——は1つとして数える）
    const keep = new Set(); for (const s of out) { if (keep.size >= (limit || 4) && !keep.has(s[0])) continue; keep.add(s[0]); }
    return out.filter(s => keep.has(s[0]));
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
          let rank = null, ok = false, mix = false;
          const eq = after.match(/^(?:」)?(?:スキル)?(?:と|に|の)?(?:ほぼ)?(?:[^。、]{0,6}?)(同等|同様|同効果|相当|亜種|類似|として機能)/);
          if (eq) { ok = true; const rm = after.slice(0, eq.index + eq[0].length).match(/(EX|[A-E])[+]*ランク/); if (rm) rank = rm[1]; }
          if (/^(?:」)?(?:スキル)?(?:の加護)?を(?:与え|付与し|付与す|獲得|備え|内包)/.test(after)) ok = true;
          const pre = before.match(/(?:(EX|[A-E])[+]*ランク(?:相当)?の|ランク(EX|[A-E])の)([^。]{0,12})$/);
          if (pre && /^[^をがはにでへ]*$/.test(pre[3])) { ok = true; rank = rank || pre[1] || pre[2]; }
          // 「A、B、Cの複合スキル」「A：B-とB：Cの複合スキル」「A、Bスキルの効果を複合」
          const mm = clause.slice(at + bk.length, at + bk.length + 40).match(/^([、・と,\s぀-ヿ一-鿿()（）：:A-Z+\-~]{0,36}?)(?:等|など)?(?:との?|の)?(?:スキル)?(?:の効果)?を?(?:混合|複合)/);
          if (!ok && mm && !/[をがは]/.test(mm[1])) ok = mix = true;
          if (ok) { if (!found.has(key)) found.set(key, { key, rank: rank ? R.parseRank(rank) : null, mix }); break; }
          at = clause.indexOf(bk, at + 1);
        }
      }
    }
    // 「多種多様なスキルを内包する複合スキル。……「心眼（真）」、「戦闘続行」…」「父娘の絆(重)、狂信、啓示が歪んだ形で複合」：
    //   複合・内包と書かれた説明では、かぎかっこで挙げたスキルと、複合・内包と同じ文に並べたスキルを借りる
    if (/内包|複合スキル|複合され|を複合|の複合|混合スキル/.test(text)) {
      const qs = (R.normalize(String(text || '')).match(/[「『"“][^」』"”]{2,16}[」』"”]/g) || []).map(q => normName(q.slice(1, -1)));
      const qFull = new Set(qs), qBase = new Set(qs.map(baseName));
      const listSen = sentences(text).filter(x => /内包|複合|混合/.test(x)).map(x => R.normalize(x)).join('。');
      const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const inList = k => new RegExp('(?:^|[、・,\\s「『"“やと])' + esc(k) + '(?=[、・,\\s」』"”とがやのを…]|$)').test(listSen);
      for (const key of keys) {
        const nk = normName(key), bk = baseName(key);
        if (found.has(key) || (self && (self.includes(bk) || bk.includes(self)))) continue;
        // 「心眼（真）」は 心眼(真) だけに当てる（「魔力放出（光）」のように辞書に無い括弧なら、括弧を外した 魔力放出 に）
        const hit = qFull.has(nk) || (qBase.has(bk) && !keys.some(k2 => k2 !== key && baseName(k2) === bk && qFull.has(normName(k2)))) || inList(nk);
        if (hit) found.set(key, { key, rank: null, mix: true });
      }
    }
    const out = Array.from(found.values());
    // 長い名前に含まれる短い名前（「勇猛」と「勇猛の戦乙女」など）は長い方だけ残す
    return out.filter(o => !out.some(x => x !== o && x.key.length > o.key.length && x.key.includes(baseName(o.key))));
  }

  const sameSpec = (a, b) => a[0] === b[0] && JSON.stringify(a[2] || null) === JSON.stringify(b[2] || null);

  /**
   * スキル1つに効果を割り当てる。
   * 優先順: サーヴァント個別の上書き > 全体の上書き > 辞書 > 説明文の解析（参照＋キーワード） > 仮
   * 戻り値: { effects, source, matched }
   *   source: 'servant-override' | 'override' | 'dict' | 'dict-partial' | 'compound' | 'keyword' | 'fgo' | 'lost' | 'default'
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
    if (/^(?:なし|無し|-|―|ー)?$/.test(n) && !String(skill.desc || '').trim()) return mk([], 'lost'); // 「なし」とだけ書かれた欄
    if (rank && rank.none && LOST_WORDS.test(skill.desc || '')) return { effects: [], source: 'lost' };
    const d = lookupDict(skill.name);
    const comp = compoundSpecs(skill.desc, skill.name);
    const refOf = list => list.map(c => SKILL_DICT[c.key].map(s => ({ spec: [s[0], (s[1] == null ? 1 : s[1]) * 0.6, s[2]], rank: c.rank }))).flat();
    const refSpecs = refOf(comp);
    // 辞書どおりの名前：辞書の効果＋説明文で「〇〇と同等」などと明記された他スキルの効果
    // （「〇〇との混合スキル」は辞書の効果がもともとその混合なので足さない）
    if (d && d.how !== 'partial' && !GENERIC.has(d.key)) {
      const extra = comp.filter(c => !c.mix), specs = SKILL_DICT[d.key].map(s => ({ spec: s }));
      for (const r of refOf(extra)) if (!specs.some(x => sameSpec(x.spec, r.spec))) specs.push(r);
      // 「黄金律(体)」「最果ての加護(羅馬)」のような変種は、説明文から読んだ効果も足す（辞書の効果は消さない）
      const variant = d.how === 'base' && n !== d.key;
      if (variant) for (const s of analyzeText(skill.desc || '', 'skill', 3)) { const x = specs.find(x => sameSpec(x.spec, s)); if (!x) specs.push({ spec: s }); else if (Math.abs(s[1]) > Math.abs(x.spec[1] == null ? 1 : x.spec[1])) x.spec = s; }
      return mk(specs.slice(0, 6), 'dict', { matched: d.key + (extra.length ? '＋' + extra.map(c => c.key).join('・') : '') + (variant ? '（変種：説明文で補足）' : '') });
    }

    // 説明文の解析
    const kw = analyzeText(skill.name + '\n' + (skill.desc || ''), 'skill', 4);
    const specs = [];
    if (d) for (const s of SKILL_DICT[d.key]) specs.push({ spec: s }); // 部分一致した辞書（一般的な言葉の名前）の効果を土台に
    specs.push(...refSpecs);
    // 説明文から読んだ効果：同じ部品がもうあれば強い方の係数を使う
    for (const s of kw) { const x = specs.find(x => sameSpec(x.spec, s)); if (!x) specs.push({ spec: s }); else if (Math.abs(s[1]) > Math.abs(x.spec[1] == null ? 1 : x.spec[1])) x.spec = s; }
    if (!specs.length) {
      // 辞書にも説明文にも手がかりが無い：FGO の同名スキル（js/fgoskills.js、Chaldea のデータから）があればその働きを借りる
      const F = G.FGO_SKILLS || {}, fk = F[n] ? n : F[baseName(n)] ? baseName(n) : null;
      if (fk) return mk(F[fk].map(s => ({ spec: s })), 'fgo', { matched: fk });
      return mk([['power', 0.3]], 'default');
    }
    const source = d ? 'dict-partial' : comp.length ? 'compound' : 'keyword';
    return mk(specs.slice(0, 6), source, { matched: d ? d.key : comp.map(c => c.key).join('・') || null });
  }

  // 宝具の発動のしかた（np.mode）。'' は AI が状況を見て使う（いままでどおり）。
  //   always：常時発動。宝具を「使う」ことはなく、効果は持っているだけでスキルと同じように働く。代わりに毎日の維持魔力が
  //           宝具の魔力消費 × ENGINE.npAlwaysUpkeep だけ増える（攻撃宝具にはしない）
  //   start / win / lose / pinch / lethal：その場面になった瞬間に自動で発動する（AI は選ばない。1回の戦いに一度）。
  //           魔力消費は宝具の魔力消費 × ENGINE.npAutoCost（払えなければ発動しない）。lethal は致命傷を受けた瞬間（踏みとどまりの判定の前）
  const NP_MODES = [['', 'AIが選んで使う'], ['always', '常時発動（持っているだけで働く・毎日の魔力が増える）'], ['start', '戦いの始めに自動で発動'],
    ['win', '押し勝ったときに自動で発動'], ['lose', '押し負けたときに自動で発動'], ['pinch', '瀕死になったときに自動で発動'], ['lethal', '致命傷を受けた瞬間に自動で発動']];
  const NP_MODE_JA = { always: '常時発動', start: '戦いの始めに自動で発動', win: '押し勝ったときに自動で発動', lose: '押し負けたときに自動で発動',
    pinch: '瀕死になったときに自動で発動', lethal: '致命傷を受けた瞬間に自動で発動' };
  // 見積もりでの重み（その場面がどのくらい起きるか）
  const NP_MODE_W = { start: 1, win: 0.5, lose: 0.4, pinch: 0.3, lethal: 0.3 };
  // 説明文からの読み取り：「常時発動型」「常時展開型」など（補助宝具だけ。攻撃宝具は真名解放で撃つものとして AI に任せる）
  const ALWAYS_WORDS = /常時発動|常時展開|常時(?:効果|型)の宝具|常に(?:発動|展開)して|常時(?:発揮|機能)/;

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
      // 同じ部品は1つまで（ただし場面の違う条件付きのもの——山中や海で——は別に足す）
      const condOf = s => (s[2] && s[2].cond) || '';
      //   条件の無い同じ部品がもうあれば、場面つきのものは足さない（常に働くので）
      for (const s of analyzeText(desc, 'np', 5)) if (!specs.some(x => x.spec[0] === s[0] && (condOf(x.spec) === condOf(s) || !condOf(x.spec)))) specs.push({ spec: s });
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
    // 発動のしかた：手直し（NP_OVERRIDES の mode）が優先。無ければ説明文の「常時発動型」などを読む（補助宝具だけ）
    let mode = npo && npo.mode != null ? npo.mode : null, modeBasis = mode != null ? 'override' : null;
    if (npo && (npo.attack === true || npo.attack === false)) { attack = npo.attack; basis = 'override'; }
    else if (mode === 'always') { attack = false; basis = 'always'; }
    else if (disabled) { attack = false; basis = 'disabled'; }
    else if (tk === 'self') { attack = false; basis = 'self'; }
    else if (NON_ATTACK.test(desc)) { attack = false; basis = 'non-attack-words'; }
    else if (hasAtk) { attack = true; basis = 'attack-words'; }
    else if (tk === 'barrier') { attack = false; basis = 'barrier'; }
    else if (specs.length) { attack = false; basis = 'support-effects'; } // 補助的な効果しか読み取れず、攻撃の表現も無い
    else { attack = true; basis = 'guess'; }                              // 手がかりが無いので種別どおり攻撃宝具とみなす
    if (mode == null) { mode = !attack && !disabled && ALWAYS_WORDS.test(desc) ? 'always' : ''; modeBasis = mode ? 'words' : null; }
    if (mode === 'always' && attack) mode = '';                           // 攻撃宝具は常時発動にしない（撃つもの）
    // 攻撃宝具の「戦闘力上昇」は威力そのものなので効果からは外す
    // （手で指定した効果は外さない：宝具を使ったその戦いの間、戦闘力として上乗せされる）
    if (attack && !own && !SKILL_OVERRIDES[n]) specs = specs.filter(s => s.spec[0] !== 'power' || (s.spec[2] && s.spec[2].cond));
    const rk = np.rank && np.rank.base ? np.rank : R.parseRank('C');
    const effects = specs.map(s => instantiate(s.spec, s.rank || rk, np.name, source)).filter(Boolean);
    if (PERSIST_WORDS.test(desc)) effects.forEach(e => { e.persistent = true; });
    // 宝具消費：条件の付いたもの（水辺でだけ重い、など）は使うときにエンジンが条件を見て足す（engine.js の npCostOf）
    const costMod = effects.filter(e => e.id === 'np_cost' && !(e.params && e.params.cond)).reduce((t, e) => t + e.mag, 0);
    return {
      attack, basis,
      disabled,
      power: attack ? Math.round(rk.score * T.power * 10) / 10 : 0,   // 攻撃宝具の威力（ステータススコアと同じ尺度）
      burst: rk.burst,
      cost: Math.round(Math.max(0.1, T.cost * rk.mult * (1 + costMod)) * 100) / 100, // 魔力消費（1.0=標準）
      exposure: T.exposure,                                             // 使うと真名がばれやすい度合い
      multi: (np.maxTargets || 1) > 1,
      effects, source, matched,
      mode: mode || '', modeBasis,
    };
  }

  G.effects = { EFFECTS, SKILL_DICT, RULES, CONDS, TAG_CANON, SKILL_OVERRIDES, SERVANT_OVERRIDES, STAT_OVERRIDES, NP_OVERRIDES, CONTENT_OVERRIDES, PAGE_OVERRIDES, REVIEWED, OVERRIDE_TABLES, ATTR_MASTER, ATTR_OF, BOSS_PARAMS, BOSS_ATTR, okey, idOf, attrFold, attrIndex, resolveAttrs,
    COND_JA, COND_OPTS, condText, condShort, hasCond, NP_MODES, NP_MODE_JA, NP_MODE_W, EFFECT_GROUPS, GROUP_OF, TRIGGERS, TRIG_JA, TRIG_W, INSTANT, trigOf, trigText, effOptionsHtml, trigFieldsHtml, readTrig, paramHint, STRIP_IDS, stripFieldsHtml, readStrip, SELF_IDS, selfFieldsHtml, readSelf, TEAM_IDS, teamFieldsHtml, readTeam, AILMENTS, AIL_CAP, AIL_MSG_HINT, normName, lookupDict, resolveSkill, resolveNP, instantiate, analyzeText, compoundSpecs, canonTag, EFFECT_INFO, WHO_JA, describe, npOnUse };
})(globalThis.HGW = globalThis.HGW || {});
