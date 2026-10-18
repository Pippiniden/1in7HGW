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
  // params.cond を持つ効果は、その条件（'水辺' など）を満たす場面でだけ働く
  const EFFECTS = {
    // 戦闘
    power:        { name: '戦闘力上昇',   phase: 'battle',    unit: 'rate',   base: 0.10, desc: '戦闘力に加算' },
    power_vs:     { name: '特攻',         phase: 'battle',    unit: 'rate',   base: 0.30, desc: '特定の相手（params.tag）にだけ戦闘力上昇' },
    debuff:       { name: '弱体化',       phase: 'battle',    unit: 'rate',   base: 0.10, desc: '相手の戦闘力を下げる' },
    crit:         { name: 'クリティカル',         phase: 'battle',    unit: 'chance', base: 0.10, desc: '大ダメージを与える確率' },
    pierce:       { name: '防御無視',     phase: 'battle',    unit: 'chance', base: 0.25, desc: '相手の回避・軽減・対魔力・致命傷耐性を無視する確率（必中など）' },
    instakill:    { name: '即死',         phase: 'battle',    unit: 'chance', base: 0.05, desc: '戦闘力に関係なく相手を倒す確率' },
    evade:        { name: '回避',         phase: 'battle',    unit: 'chance', base: 0.10, desc: '攻撃を避ける確率' },
    initiative:   { name: '先手',         phase: 'battle',    unit: 'chance', base: 0.15, desc: '戦いの始めに先手を取り、その戦いで少し有利になる確率' },
    charm:        { name: '魅了',         phase: 'battle',    unit: 'chance', base: 0.10, desc: '相手が攻撃をためらう確率' },
    rally:        { name: '統率',         phase: 'battle',    unit: 'rate',   base: 0.05, desc: '同盟相手と並んで戦うときの連携（加勢の力）を強める' },
    anti_master:  { name: 'マスター狙い', phase: 'battle',    unit: 'chance', base: 0.15, desc: '敵マスターを直接狙える確率' },
    // 被ダメージ・生存
    guard:        { name: '被ダメージ軽減', phase: 'damage',  unit: 'rate',   base: 0.10, desc: '受けるダメージを減らす（マイナスなら打たれ弱い）' },
    magic_guard:  { name: '魔術耐性',     phase: 'damage',    unit: 'rate',   base: 0.30, desc: '魔力の高い相手（キャスターなど）との戦いで守りになる' },
    mental_guard: { name: '精神耐性',     phase: 'battle',    unit: 'chance', base: 0.40, desc: '魅了に抵抗する確率' },
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
    craft:        { name: '道具作成',     phase: 'day',       unit: 'chance', base: 0.15, desc: '1日ごとに道具を作る確率（道具は次の戦いで守りと戦闘力になる）。工房の強化も選びやすい' },
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
    np_boost:     { name: '宝具強化',     phase: 'np',        unit: 'rate',   base: 0.15, desc: '宝具の威力' },
    np_cost:      { name: '宝具消費',     phase: 'np',        unit: 'rate',   base: 0.30, desc: '宝具の魔力消費の増減（マイナスで軽くなる）' },
    backfire:     { name: '反動',         phase: 'np',        unit: 'rate',   base: 0.30, desc: '宝具を使うと自分も傷つく' },
    self_retire:  { name: '自滅',         phase: 'np',        unit: 'chance', base: 1.0, fixed: true, desc: '宝具を使うと自分が脱落する確率' },
    disabled:     { name: '使用不可',     phase: 'np',        unit: 'flag',   base: 1, fixed: true, desc: 'この宝具は今回の召喚では使えない' },
  };

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
  const EFFECT_INFO = {
    power:        { who: 'self', fx: m => `戦闘力 ${sg(m)}` },
    power_vs:     { who: 'self', fx: (m, p) => `「${tagOf(p)}」の相手と戦うとき戦闘力 ${sg(m)}` },
    debuff:       { who: 'enemy', fx: m => `相手の戦闘力 ${m < 0 ? '+' : '−'}${pc(Math.min(0.5, m))}（相手マスターの精神で増減・最大50%）` },
    crit:         { who: 'self', fx: m => `押し勝ったとき ${pc(m)} の確率で与える傷が1.5倍` },
    pierce:       { who: 'enemy', fx: m => `相手の守り（被ダメージ軽減・回避・魔術耐性）を ${pc(Math.min(0.9, m))} 打ち消し、同じ確率で踏みとどまりも許さない` },
    instakill:    { who: 'enemy', fx: m => `押し勝つたびに ${pc(Math.min(0.4, m))} の確率で相手を一撃で倒す（相手の幸運で減る）` },
    evade:        { who: 'self', fx: m => `守りとして戦闘力 ${sg(m * 0.5)}` },
    initiative:   { who: 'self', fx: m => `戦いの始めに ${pc(Math.min(0.5, m))} の確率で先手を取り、その戦いの戦闘力 +8%` },
    charm:        { who: 'enemy', fx: m => `打ち合いごとに ${pc(m)} の確率で相手の戦闘力を4割下げる（精神耐性・マスターの精神で防がれる）` },
    rally:        { who: 'ally', fx: m => `同盟相手と並んで戦うとき、加勢の力 ${sg(m)}（自分が加勢する側でもされる側でも）` },
    anti_master:  { who: 'enemyMaster', fx: m => `打ち合いで勝つたび相手マスターに刃が届く確率 ${sg(m * 0.3)}、拠点への夜襲でマスターを直接狙う確率 ${sg(Math.min(0.6, m * 1.5))}` },
    guard:        { who: 'self', fx: m => `受ける傷 ${m < 0 ? '+' : '−'}${pc(Math.min(0.5, m * 0.5))}、守りとして戦闘力 ${sg(m * 0.5)}` },
    magic_guard:  { who: 'self', fx: m => `魔力の高い相手（キャスターなど）と戦うとき、守りとして戦闘力 ${sg(m * 0.5)}` },
    mental_guard: { who: 'self', fx: m => `相手の魅了を ${pc(Math.min(0.95, m))} の確率で防ぐ` },
    guts:         { who: 'self', fx: m => `倒れるはずの一撃で ${pc(Math.min(0.85, m))} の確率で踏みとどまる（絆・耐久・幸運でも上がる）` },
    weakness:     { who: 'self', bad: true, fx: (m, p) => `「${tagOf(p)}」の相手と戦うとき戦闘力 ${m < 0 ? '+' : '−'}${pc(m * 0.5)}` },
    master_guard: { who: 'master', fx: m => `自分のマスターが狙われたとき、刃が届く確率 −${pc(Math.min(0.8, m))}` },
    stealth:      { who: 'self', fx: m => `夜に相手に見つかる確率 ${m < 0 ? '+' : '−'}${pc(m * 0.7)}、偵察・使い魔にも見つかりにくい` },
    detect:       { who: 'self', fx: m => `夜に相手を見つける確率 ${sg(m * 0.8)}、マスターを狙う奇襲を見抜きやすい` },
    intel:        { who: 'self', fx: m => `偵察・使い魔・噂の追跡の成功 ${sg(m)}、真名の推理 ${sg(m * 0.5)}` },
    reveal:       { who: 'enemy', fx: m => `相手の真名を見抜く確率 ${sg(m)}（戦い・偵察・推理）` },
    conceal:      { who: 'self', fx: m => `自分の真名を見抜かれる確率 ${m < 0 ? '+' : '−'}${pc(m * 0.6)}` },
    escape:       { who: 'self', fx: m => `撤退の成功 ${sg(m)}` },
    pin:          { who: 'enemy', fx: m => `相手の撤退の成功 ${m < 0 ? '+' : '−'}${pc(m * 0.8)}` },
    regen:        { who: 'self', fx: m => `休んだ日の霊基の回復 ${m < 0 ? '−' : '+'}${num(m * 60)}` },
    heal_other:   { who: 'master', fx: m => `休んだ日のマスターの傷の回復 ${m < 0 ? '−' : '+'}${num(m * 60)}` },
    territory:    { who: 'self', fx: m => `拠点で戦うとき戦闘力 ${sg(m)}、工房の強化の成功 ${sg(m)}` },
    craft:        { who: 'self', fx: m => `1日ごとに ${pc(m)} の確率で道具を作る（次の戦いで守りと戦闘力になる。3つまで）` },
    resource:     { who: 'master', fx: m => `毎日の魔力 ${m < 0 ? '−' : '+'}${num(m * 10)}、工房の強化の成功 ${sg(m * 0.5)}` },
    upkeep_down:  { who: 'master', fx: m => `マスターが払う維持魔力 ${m < 0 ? '+' : '−'}${pc(m)}` },
    upkeep_up:    { who: 'master', bad: true, fx: m => `マスターが払う維持魔力 ${sg(m)}（足りないとマスターの生命力が削られる）` },
    solo:         { who: 'self', fx: m => `マスターを失っても ${Math.floor(m)}日 現界を保つ` },
    uncontrolled: { who: 'self', bad: true, fx: m => `1日ごとに ${pc(m)} の確率で命令を聞かず出歩く（絆・マスターの精神で抑えられる）。魔力が足りなくても宝具を放つことがある` },
    negotiate:    { who: 'self', fx: m => `同盟・交渉の成功 ${sg(m)}` },
    cs_resist:    { who: 'self', bad: true, fx: m => `令呪が ${pc(Math.min(0.9, m))} の確率で効かない（絆で和らぐ）` },
    master_buff:  { who: 'master', fx: (m, p) => `マスターの${STAT_JA_M[p && p.stat] || '能力'} ${m < 0 ? '−' : '+'}${num(Math.abs(m))}` },
    luck:         { who: 'self', fx: m => `踏みとどまり ${sg(m * 0.5)}・撤退 ${sg(m * 0.3)}・即死を受ける確率 ${m < 0 ? '+' : '−'}${pc(Math.min(0.9, m))}` },
    tag:          { who: 'none', fx: (m, p) => `「${tagOf(p)}」の属性を持つ（相手の特攻・自分の弱点の対象になる）` },
    np_boost:     { who: 'self', fx: m => `攻撃宝具の威力 ${sg(m)}` },
    np_cost:      { who: 'self', fx: m => `宝具の魔力消費 ${sg(m)}` },
    backfire:     { who: 'self', bad: true, fx: m => `宝具を使うと自分の霊基 −${num(m * 40)}` },
    self_retire:  { who: 'self', bad: true, fx: m => `宝具を使うと ${pc(Math.min(1, m))} の確率で自分が脱落` },
    disabled:     { who: 'none', bad: true, fx: () => 'この宝具は使えない' },
  };
  // 宝具の効果のうち、宝具を使ったその戦いの間だけ働くもの（np の部品はその宝具を使ったときだけ）。
  // それ以外の場面（昼・偵察・交渉・維持魔力など）の効果は、宝具を持っているだけで常に働く
  const NP_BATTLE_PHASES = ['battle', 'damage', 'lethal', 'retreat', 'np'];
  // 制御困難・魔力消費増は、宝具の説明にあっても「使ったときの代償」なので常時にはしない（エンジンは戦いの間は読まないので、実際には効かない）
  const NP_USE_ONLY = ['uncontrolled', 'upkeep_up'];
  const npOnUse = e => (NP_BATTLE_PHASES.includes((EFFECTS[e.id] || {}).phase) || NP_USE_ONLY.includes(e.id)) && !e.persistent;
  const COND_JA = { 水辺: '水辺・雨の夜の戦いでだけ', 森: '森での戦いでだけ', 山: '山での戦いでだけ', 夜: '夜の戦い（満月の夜を除く）でだけ' };
  /**
   * 効果ひとつの説明。e は instantiate の結果（mag を持つ）か [id, factor, params] と rank。
   * ctx.np：宝具の効果 / ctx.attack：攻撃宝具
   * 戻り値 { name, who, whoJa, bad, when, text }
   */
  function describe(e, ctx) {
    ctx = ctx || {};
    const def = EFFECTS[e.id], inf = EFFECT_INFO[e.id];
    if (!def || !inf) return { name: e.id, who: 'none', whoJa: '—', bad: false, when: '', text: '（エンジンが知らない効果）' };
    const m = e.mag != null ? e.mag : def.base * (e.factor == null ? 1 : e.factor);
    const p = e.params || null;
    const bad = !!inf.bad === !(m < 0);
    const when = [ctx.np ? (!npOnUse(e) ? (e.persistent ? '宝具を持つ限り（消滅後も）' : '宝具を持っているだけで常に') : def.phase === 'np' ? 'この宝具を使ったとき' : '宝具を使ったその戦いの間') : '常に',
      p && p.cond ? COND_JA[p.cond] || p.cond + 'でだけ' : ''].filter(Boolean).join('・');
    return { name: def.name, who: inf.who, whoJa: WHO_JA[inf.who], bad, when, text: inf.fx(m, p) };
  }

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

    // ---- 原作（TYPE-MOON作品）のクラス別スキル ----
    '復讐者':       [['power', 0.5], ['mental_guard', 0.6], ['negotiate', -0.6]],
    '忘却補正':     [['crit', 1]],
    '真名看破':     [['reveal', 1.5]],
    '神明裁決':     [['debuff', 0.6], ['negotiate', 0.6], ['reveal', 0.3]],
    '聖人':         [['regen', 0.6], ['heal_other', 0.4], ['negotiate', 0.4]],
    '領域外の生命': [['mental_guard', 1], ['magic_guard', 0.3], ['debuff', 0.3]],
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
    '拷問技術':     [['debuff', 0.6], ['power', 0.3]],
    '魔眼':         [['debuff', 0.8], ['pin', 0.4]],
    '呪術':         [['debuff', 1], ['craft', 0.3]],
    '呪詛':         [['debuff', 1]],
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
    '鼓舞':         [['rally', 0.8], ['power', 0.2]],
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
    '正気喪失':     [['debuff', 1], ['charm', 0.4]],
    '黄金の杯':     [['debuff', 0.6], ['pierce', 0.4]],
    'アクセルターン': [['evade', 1], ['crit', 0.4]],
    'スケープゴート': [['master_guard', 1]],
    '耐毒':         [['guard', 0.4]],
    '病弱':         [['guard', -0.8], ['luck', -0.3]],
    '忍術':         [['stealth', 1], ['evade', 0.5]],
    '幻術':         [['conceal', 0.6], ['debuff', 0.5], ['charm', 0.3]],
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
    '神核', '叡智', '智慧', '武練', '審美', '航海者', '航海', '託宣', '神通力', '鬼道', '道術', '陰陽道', '数秘術', '狙撃', '商才', '生存', '変容', '戦略']);
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
    { re: /(?:パラメーター|パラメータ|ステータス|能力)[^。]{0,8}(?:ダウン|低下させ|下げ)|弱体化|弱体を付与|弱体付与|デバフ|判断力を鈍|生命力を[^。]{0,10}奪|呪いを(?:かけ|与え)|奪われる|恐怖へと変換/, id: 'debuff', not: /(?:自身|自分)[^。]{0,6}(?:ダウン|低下|下が|マイナス)|デバフ[^。]{0,10}(?:難し|至難|効かな|無効)|弱体化を受け|弱体化(?:が|も)?働く|弱体(?:化)?を[^。]{0,4}(?:受けた|跳ね|防|無効)/ },
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
    { re: /気配[^。]{0,6}(?:消|断)|隠密|潜伏|姿を消|透明|潜ん|バレない|感知は[^。]*不可能/, id: 'stealth', not: /気配遮断を[^。]{0,4}(?:察知|感知|見抜)/ },
    // 他者の持つスキルの話（「直感持ちのサーヴァントは看破可能」）や、見抜かれる側の話は除く
    { re: /見抜|看破|見破|暴く|解析|識別|鑑定|構造[^。]{0,6}を?理解/, id: 'reveal', not: /持ちの(?:サーヴァント|マスター)|を持つ(?:相手|者|サーヴァント)|看破(?:可能|され)|看破系[^。]{0,10}(?:に対|抵抗)|に対しては抵抗|見抜(?:く|け)(?:事|こと)?が?(?:出来|でき)な|見抜けな/ },
    { re: /探知|感知|索敵|察知|千里眼|遠くまで見|見通/, id: 'detect', not: /感知は[^。]*不可能|(?:察知|感知|探知)(?:する)?(?:事|こと)が?(?:出来|でき)な/ },
    { re: /情報|諜報|調査|偵察|研究|観察/, id: 'intel', f: 0.8, not: /持ちの(?:サーヴァント|マスター)|情報を?偽|偽造した情報|偽の情報/ },
    { re: /回避|避け|かわし|躱/, id: 'evade' },
    { re: /先手|先制|奇襲|俊敏|俊足|神速|高速移動|最高速|加速|跳躍|ジャンプ|脚力|機動力/, id: 'initiative', cond: true },
    { re: /逃走|撤退|離脱|逃げ|飛行|空を(?:飛|走)|天馬|跳び越/, id: 'escape', not: /(?:相手|敵)[^。]{0,10}(?:逃走|撤退|離脱|逃げ)|逃さない|逃がさない|逃走手段|逃げるしか/ },
    { re: /魔術[^。]{0,10}(?:無効|防|耐性|弾)|対魔力/, id: 'magic_guard', not: /対魔力[^。]{0,8}(?:影響を受けない|を?無視|を?貫)/ },
    { re: /精神[^。]{0,8}(?:耐性|干渉を|無効)|精神デバフ[^。]{0,6}(?:難|効かな|無効)|精神弱体を|精神[^。]{0,10}跳ね除け|動じない|恐怖を(?:感じ|知ら)/, id: 'mental_guard' },
    { re: /(?:神々|神)[^。]{0,8}(?:干渉|加護|権能)[^。]{0,16}(?:削減|軽減|防ぐ|打ち消)/, id: 'magic_guard' },
    { re: /防御|頑丈|堅牢|盾|守り|守る|鎧|防ぐ|胴丸|耐久[^。]{0,6}(?:上昇|ランクアップ|向上)/, id: 'guard', not: /防御は無意味|マイナス/, cond: true },
    { re: /陣地|工房|結界|拠点|神殿|戦闘空間|領域(?:を|に)?(?:展開|作成|形成|内)/, id: 'territory', not: /対界宝具で/ },
    { re: /燃費が(?:良|いい)|魔力消費[^。]{0,8}(?:少|軽|抑|格安)|魔力を[^。]{0,30}(?:補給|自前で賄|供給を得)/, id: 'upkeep_down', only: 'skill' },
    { re: /魔力消費[^。]{0,8}(?:軽|少|格安|抑)/, id: 'np_cost', f: -1, only: 'np' },
    { re: /燃費(?:が|は)?(?:悪|すこぶる悪)|コスパが(?:悪|非常によろしくない)|魔力消費(?:が|も)?(?:高|大き|相応)|高い魔力を必要|魔力を大量/, id: 'np_cost', only: 'np' },
    { re: /燃費(?:が|は)?悪|魔力消費(?:が|も)?(?:高|大き)/, id: 'upkeep_up', only: 'skill' },
    { re: /単独行動|単独で(?:も)?現界|マスター不在|現界を維持/, id: 'solo', f: 0.7 },
    { re: /理性[^。]{0,8}(?:失|奪|引き換え|蒸発)|暴走|言うことを聞かない|勝手に/, id: 'uncontrolled', f: 0.7, not: /暴走させた/ },
    { re: /攻撃力|威力|膂力|怪力|筋力[^。]{0,8}(?:上昇|向上|ランクアップ)|(?:ステータス|パラメーター|パラメータ)[^。]{0,10}(?:上昇|向上|強化|ランクアップ)|ランク(?:が)?上昇|強化され|戦闘能力(?:を向上|が増幅)|増幅させ|大幅に上昇|ボーナスを(?:獲得|得)|バフが発生|ブーストアップ|放出能力/, id: 'power', f: 0.8, cond: true, not: /(?:幸運|耐久|神性|黄金律)(?:の|値)?(?:パラメーター|パラメータ)?(?:を|は|が)[^。、・]{0,10}ランクアップ/ },
  ];
  // 場所などの条件
  const CONDS = [['水辺', /水場|水辺|海上|海で|海に|水中|川で/], ['森', /森の中|森で|樹木|木々/], ['山', /山中|山で/], ['夜', /夜間|夜に|暗闇/]];
  // マスターを強化する文（「マスターに幸運の加護を与える」など）
  const MASTER_STAT_WORDS = [['luck', /幸運/], ['mana', /魔力/], ['craft', /魔術/], ['body', /体力|肉体|身体/], ['mind', /精神/]];

  // 宝具の攻撃・非攻撃の判定
  const ATTACK_WORDS = /攻撃|ダメージ|破壊|斬|貫|焼き|焼却|灼き|薙ぎ|放つ|放たれ|砲撃|一撃|殲滅|消し飛|吹き飛|撃ち|殺す|殺害|穿|叩き|粉砕|蹂躙|射撃|呑み込|丸呑|飲み込|喰らい|陥没|溶か|溶断|爆発|爆撃|突撃|突進|踏み潰|掃射|投擲|投げつけ|ビーム|切り裂|引き裂|雷撃|ぶっ飛|一掃|連射|乱射|射出|発射/;
  const NON_ATTACK = /(?:破壊力|攻撃力|殺傷力|攻撃能力)(?:は|を)?(?:持たない|無い|ない)|攻撃(?:は|が)?(?:行えない|出来ない|できない)|戦いは出来ない|戦闘は出来ない/;
  const PERSIST_WORDS = /消滅しようとも|消滅後も|消滅しても|死後も|脱落後も|退去後も/;
  const LOST_WORDS = /失われ|喪失|消失|封じられ|持たない|使えない|機能しない|統合され/;

  // ---------- 手直し用の表（取り込みツールやゲーム側から追加する） ----------
  const SKILL_OVERRIDES = {};    // 'スキル名': [[部品ID, 係数, params], ...]
  const SERVANT_OVERRIDES = {};  // '真名/スキル名または宝具名': [[...]]
  const STAT_OVERRIDES = {};     // '真名': { str: 'B', end: 'C', ... }  書いた項目だけ置き換える
  const NP_OVERRIDES = {};       // '真名/宝具名': { attack: true|false }  攻撃宝具かどうかの手直し
  const CONTENT_OVERRIDES = {};  // '真名': { skills, nps, voice, text, profile, relations, base }  内容の手直し（build.js の applyContent）
  const PAGE_OVERRIDES = {};     // '真名': 'kagemiya のページ名'  ページ名が真名と違うとき（build.js の pageOf・取り込みツール）
  // overrides.json の表の名前 → 表。読み込む・書き出す・公開中と見比べるときはこれを使う
  const OVERRIDE_TABLES = { global: SKILL_OVERRIDES, servant: SERVANT_OVERRIDES, stats: STAT_OVERRIDES, np: NP_OVERRIDES, content: CONTENT_OVERRIDES, pages: PAGE_OVERRIDES };

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
    // （手で指定した効果は外さない：宝具を使ったその戦いの間、戦闘力として上乗せされる）
    if (attack && !own && !SKILL_OVERRIDES[n]) specs = specs.filter(s => s.spec[0] !== 'power' || (s.spec[2] && s.spec[2].cond));
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

  G.effects = { EFFECTS, SKILL_DICT, RULES, CONDS, TAG_CANON, SKILL_OVERRIDES, SERVANT_OVERRIDES, STAT_OVERRIDES, NP_OVERRIDES, CONTENT_OVERRIDES, PAGE_OVERRIDES, OVERRIDE_TABLES,
    normName, lookupDict, resolveSkill, resolveNP, instantiate, analyzeText, compoundSpecs, canonTag, EFFECT_INFO, WHO_JA, describe, npOnUse };
})(globalThis.HGW = globalThis.HGW || {});
