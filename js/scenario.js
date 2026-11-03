/* オリジナル特異点のシナリオ（形式・既定の文面・整合性チェック）
 *
 * シナリオは JSON の一つのファイル（format: 'hgw-scenario'）。original.js がこれを読んで特異点を進め、
 * scenario.html（エディタ）が編集し、original.html（遊ぶページ）が読み込む。
 *
 *   const r = HGW.scenario.check(scn, { roster, bosses });   // { errors: [{ path, msg }], warnings: [...] }
 *   const n = HGW.scenario.normalize(scn);                    // 足りない値を既定で埋めた写し（敵の key もここで決まる）
 *   const lines = HGW.scenario.linesOf(n);                    // engine.js の opts.lines に渡す文面の差し替え
 *
 * 形式の詳細は docs/DEVELOPER.md の「オリジナル特異点」。
 */
(function (G) {
  'use strict';
  const FORMAT = 'hgw-scenario', VERSION = 1;

  // ---------- 上書きできる数値（CONFIG.SING のうち主なもの） ----------
  const SETTINGS = [
    { k: 'foePower', label: '敵の強さの上乗せ', min: 0, max: 5, step: 0.05, note: '0.1 で +10%' },
    { k: 'foeHeal', label: '敵が毎朝取り戻す霊基', min: 0, max: 100, step: 1 },
    { k: 'eventChance', label: '探索の日に出来事が起きる確率', min: 0, max: 1, step: 0.05 },
    { k: 'encBase', label: '探索の日に敵と出会う基本確率', min: 0, max: 1, step: 0.01 },
    { k: 'searchBase', label: '敵の痕跡をつかむ基本確率', min: 0, max: 1, step: 0.01 },
    { k: 'raidBase', label: '夜襲を受ける基本確率', min: 0, max: 1, step: 0.01 },
    { k: 'group2', label: '敵が2騎そろって現れる確率', min: 0, max: 1, step: 0.01 },
    { k: 'group3', label: '敵が3騎そろって現れる確率', min: 0, max: 1, step: 0.01 },
    { k: 'csMax', label: '令呪の上限', min: 0, max: 10, step: 1 },
    { k: 'csEvery', label: '令呪が一画戻るまでの日数', min: 1, max: 365, step: 1 },
    { k: 'csWipe', label: '全滅から呼び戻すのに使う令呪', min: 1, max: 10, step: 1 },
    { k: 'dailyHeal', label: '毎晩戻る霊基', min: 0, max: 100, step: 1 },
    { k: 'restHeal', label: '休息の日に戻る霊基', min: 0, max: 100, step: 1 },
    { k: 'mobDmg', label: '雑魚との小競り合いの傷', min: 0, max: 100, step: 1 },
    { k: 'councilEvery', label: '作戦会議の間隔（日）', min: 1, max: 365, step: 1 },
    { k: 'strayAfter', label: 'はぐれサーヴァントが現れうる日（この日より後）', min: 0, max: 365, step: 1 },
  ];
  const SETTING_KEYS = new Set(SETTINGS.map(s => s.k));
  // ボスごとに決められる値（CONFIG.SING.boss と同じ意味）
  const BOSS_KEYS = { gauges: 'ブレイクゲージ', power: '戦闘力の上乗せ', guard: '守りの上乗せ', mana: '魔力', regen: '毎朝の魔力の戻り', heal: '毎朝戻る霊基', find: '出会いやすさ' };

  // 敵の出会い方
  const MEET = {
    mixed: '探して見つけることも、向こうから襲ってくることもある',
    search: '探して見つける（向こうからは来ない）',
    raid: '向こうから襲ってくる（探しても見つからない）',
    day: '決まった日に現れる',
  };
  // はぐれサーヴァントの現れ方
  const STRAY_APPEAR = { random: '道中の出来事としてランダムに', day: '決まった日に', event: '自作の出来事（効果「はぐれ」）でだけ' };

  // ---------- 自作の出来事の効果 ----------
  // fields: amount（数値）/ target（all 全員・front 前衛・one 一騎）/ enemy（敵の key。空ならランダム）/ name（文字）
  const EFFECTS = {
    heal: { label: '霊基を癒やす', fields: ['amount', 'target'], note: '霊基は 0〜100' },
    damage: { label: '霊基を削る', fields: ['amount', 'target'], note: 'これでは倒れない（1 で止まる）' },
    mana: { label: '魔力の蓄え', fields: ['amount'], note: '蓄えの上限に対する %（負なら減る）' },
    masterHp: { label: 'マスターの体力', fields: ['amount'], note: '負なら傷。尽きればゲームオーバー' },
    cs: { label: '令呪', fields: ['amount'], note: '上限を越えない' },
    item: { label: '道具', fields: ['amount'], note: '最大3' },
    bond: { label: '絆', fields: ['amount'] },
    camp: { label: '陣地', fields: ['amount'], note: '0〜5' },
    power: { label: 'その日の戦闘力', fields: ['amount', 'target'], note: '0.1 で +10%（負なら弱る）。その日だけ' },
    clue: { label: '手がかり', fields: ['enemy', 'amount'] },
    lead: { label: '居場所をつかむ', fields: ['enemy'], note: 'その日のうちに出会いやすくなる' },
    reveal: { label: '真名を知る', fields: ['enemy'] },
    battle: { label: '敵と戦う', fields: ['enemy'], note: 'いまの節の、生きている敵に限る' },
    mob: { label: '雑魚と戦う', fields: ['name'] },
    stray: { label: 'はぐれサーヴァントが現れる', fields: [] },
  };
  const TARGETS = { all: '味方全員', front: '前衛', one: 'ランダムな一騎' };

  // ---------- 文面 ----------
  // vars は文の中で使える {…}。def は既定の文（G.LINES に無いもの）。group は編集画面の分類
  const LINE_DEFS = [
    // 始まり
    { key: 'ogTitle', group: '始まり', label: '見出し', vars: ['name'], def: ['特異点「{name}」'] },
    { key: 'sgIntro', group: '始まり', label: '導入', vars: ['name', 'city', 'M'] },
    { key: 'sgArrive', group: '始まり', label: '到着', vars: ['name', 'city', 'M'] },
    { key: 'ogSummon', group: '始まり', label: '味方の召喚（一騎ずつ）', vars: ['S'], def: ['{S}が召喚に応えた。'] },
    { key: 'ogFormation', group: '始まり', label: '隊列と期限', vars: ['front', 'reserve', 'days'], def: ['前衛は{front}。控えに{reserve}。期限は{days}日。'] },
    { key: 'ogStage', group: '始まり', label: '節の見出し', vars: ['n', 'stage'], def: ['第{n}節「{stage}」'] },
    // 日々
    { key: 'ogMove', group: '日々', label: '移動', vars: ['place', 'M'], def: ['一行は「{place}」へ進んだ。'] },
    { key: 'sgQuiet', group: '日々', label: '何も起きない日', vars: [] },
    { key: 'sgRest', group: '日々', label: '休息', vars: ['M'] },
    { key: 'sgCamp', group: '日々', label: '陣地', vars: ['M'] },
    { key: 'sgTrace', group: '日々', label: '痕跡をつかむ', vars: ['S', 'T'] },
    { key: 'sgTraceFail', group: '日々', label: '痕跡が見つからない', vars: ['S'] },
    { key: 'ogHeal', group: '日々', label: '治療', vars: ['S'], def: ['{S}が、仲間たちの傷を手当てした。'] },
    { key: 'ogCsBack', group: '日々', label: '令呪が戻る', vars: ['M', 'n'], def: ['{M}の手の甲に、令呪が一画よみがえった。（残り{n}画）'] },
    { key: 'ogDrain', group: '日々', label: '魔力が尽きる', vars: [], def: ['魔力の蓄えが尽き、英霊たちの霊基が揺らいでいる。'] },
    { key: 'ogFront', group: '日々', label: '控えが前衛に出る', vars: ['S'], def: ['控えの{S}が前衛に立った。'] },
    { key: 'ogBossFar', group: '日々', label: 'ボスが見つからない', vars: ['B'], def: ['特異点の主の気配は濃い。だが、その居城へ至る道はまだ見えない。'] },
    // 出来事（既定）
    { key: 'sgLeyline', group: '出来事', label: '霊脈', vars: ['M'] },
    { key: 'sgLocals', group: '出来事', label: '現地の人々', vars: ['M'] },
    { key: 'sgSupplies', group: '出来事', label: '物資', vars: ['M'] },
    { key: 'sgRelic', group: '出来事', label: '遺物', vars: ['S', 'M'] },
    { key: 'sgSpring', group: '出来事', label: '泉', vars: ['M'] },
    { key: 'sgOmen', group: '出来事', label: '予兆', vars: ['T', 'M'] },
    { key: 'sgTalk', group: '出来事', label: '語らい', vars: ['S', 'M'] },
    { key: 'sgTrap', group: '出来事', label: '罠', vars: ['S'] },
    { key: 'sgMiasma', group: '出来事', label: '瘴気', vars: ['M'] },
    { key: 'sgDisturb', group: '出来事', label: '霊脈の乱れ', vars: ['M'] },
    { key: 'sgCurse', group: '出来事', label: '呪い', vars: ['S'] },
    { key: 'sgMasterHurt', group: '出来事', label: 'マスターの負傷', vars: ['M'] },
    { key: 'sgLost', group: '出来事', label: '道に迷う', vars: ['M'] },
    { key: 'sgStorm', group: '出来事', label: '嵐', vars: ['M'] },
    { key: 'sgHunted', group: '出来事', label: '追われる気配', vars: ['M'] },
    { key: 'sgRefugee', group: '出来事', label: '逃げ遅れた人々', vars: ['S', 'M'] },
    { key: 'sgAmbush', group: '出来事', label: '待ち伏せ', vars: ['T'] },
    { key: 'sgMob', group: '出来事', label: '雑魚', vars: ['mob', 'S'] },
    { key: 'sgScene', group: '出来事', label: '景色', vars: ['S', 'M'] },
    // 敵と戦い
    { key: 'sgFirst', group: '戦い', label: '敵との初めての遭遇（敵ごとの名乗りが無いとき）', vars: ['T'] },
    { key: 'sgRaid', group: '戦い', label: '夜襲', vars: ['T'] },
    { key: 'sgRaidHide', group: '戦い', label: '夜襲をやり過ごす', vars: [] },
    { key: 'clash', group: '戦い', label: '夜の戦いの始まり', vars: ['where', 'A', 'B'] },
    { key: 'sgClashDay', group: '戦い', label: '昼の戦いの始まり', vars: ['where', 'A', 'B'] },
    { key: 'retreat', group: '戦い', label: '夜の撤退', vars: ['W', 'O'] },
    { key: 'sgRetreatDay', group: '戦い', label: '昼の撤退', vars: ['W', 'O'] },
    { key: 'dawn', group: '戦い', label: '夜明けで引き分け', vars: [] },
    { key: 'sgDawnDay', group: '戦い', label: '日暮れで引き分け', vars: [] },
    { key: 'sgPress', group: '戦い', label: '戦いが続く', vars: ['T'] },
    { key: 'guts', group: '戦い', label: '致命傷に踏みとどまる', vars: ['S', 'O'], def: ['致命の一撃を受けながら、{S}は踏みとどまった。'] },
    { key: 'gutsNP', group: '戦い', label: '宝具で踏みとどまる', vars: ['S', 'O'], def: ['宝具の力が、消えかけた{S}の霊基をつなぎ止めた。'] },
    { key: 'ogBreak', group: '戦い', label: 'ボスのゲージが砕ける', vars: ['S', 'n'], def: ['{S}の霊基が砕け——なお、形を変えて立ち上がった。（残りのゲージ {n}）'] },
    { key: 'ogSeal', group: '戦い', label: '令呪で癒やす（消滅寸前）', vars: ['S', 'n'], def: ['「令呪をもって命ずる——癒えよ、{S}！」砕けかけた霊基に、令呪の魔力が満ちる。（残り{n}画）'] },
    // 消滅（倒れた英霊）
    { key: 'blow', group: '消滅', label: 'とどめ', vars: ['by', 'c', 'c0'] },
    { key: 'downNP', group: '消滅', label: '宝具が決め手', vars: ['by', 'c', 'c0', 'np'], def: ['{by}の宝具『{np}』が勝敗を決定づけた。{c}は消滅した。'] },
    { key: 'downNPEarlier', group: '消滅', label: '宝具で追い詰めてとどめ', vars: ['by', 'c', 'c0', 'np'], def: ['宝具『{np}』で追い詰めた{by}が、とどめを刺した。{c}は消滅した。'] },
    { key: 'downInstakill', group: '消滅', label: '即死の一撃', vars: ['by', 'c', 'c0'], def: ['{by}の一撃が霊核を穿ち、勝敗は決した。{c}は消滅した。'] },
    { key: 'downMutual', group: '消滅', label: '相討ち', vars: ['by', 'c', 'c0'], def: ['{by}を討った{c}もまた、受けた傷に崩れ落ちた。相討ちだった。'] },
    { key: 'downPlain', group: '消滅', label: 'そのほかの消滅', vars: ['c', 'c0', 'text'], def: ['{c}が消滅した。{text}。'] },
    { key: 'masterDown', group: '消滅', label: 'マスターが倒れる', vars: ['M', 'text'], def: ['マスターの{M}が倒れた。{text}。'] },
    // ボス・節
    { key: 'ogBossAppear', group: '節とボス', label: 'ボスの出現（ボスの名乗りの前）', vars: ['stage'], def: ['敵はすべて倒れた。歪みの中心から、圧倒的な魔力が立ち上る——'] },
    { key: 'ogBossIntro', group: '節とボス', label: 'ボスの名乗り（ボスごとの名乗りが無いとき）', vars: ['B', 'T'], def: ['特異点の主、{B}が姿を現した。'] },
    { key: 'ogStageClear', group: '節とボス', label: '節を越えた（節ごとの文が無いとき）', vars: ['n', 'stage'], def: ['「{stage}」の戦いは終わった。一行は先へ進む。'] },
    // はぐれ
    { key: 'ogStrayMeet', group: 'はぐれ', label: '現れる（はぐれの名乗りが無いとき）', vars: ['T'], def: ['主を持たない{T}が、一行の前に現れた。この特異点に呼ばれながら、どの陣営にも与しなかった英霊らしい。'] },
    { key: 'ogStrayJoin', group: 'はぐれ', label: '加わる', vars: ['T'], def: ['{T}が一行に加わった。'] },
    { key: 'ogStrayLeave', group: 'はぐれ', label: '断る', vars: ['T'], def: ['{T}は小さく頷き、どこかへ去っていった。'] },
    // 全滅と結末
    { key: 'ogRevive', group: '結末', label: '令呪で全員を呼び戻す', vars: ['n'], def: ['「令呪をもって命ずる——還れ、我が英霊たちよ！」令呪が光となり、倒れた英霊たちが再び現界した。（残り{n}画）'] },
    { key: 'ogWiped', group: '結末', label: '全滅', vars: ['M'], def: ['{M}のもとに、戦える英霊は一騎も残っていない。'] },
    { key: 'ogClear', group: '結末', label: '修復の成功（主の消滅）', vars: ['city', 'name'], def: ['特異点の主は消滅した。歪みの核であった聖杯が回収され、{city}の空がほどけていく。'] },
    { key: 'ogClear2', group: '結末', label: '修復の成功（締め）', vars: ['survivors'], def: ['人理修復、成功。{survivors}'] },
    { key: 'ogFailMaster', group: '結末', label: '失敗：マスターの死', vars: [], def: ['マスターを失い、英霊たちの現界は保てなくなった。人理修復は失敗に終わった。'] },
    { key: 'ogFailWipe', group: '結末', label: '失敗：全滅', vars: [], def: ['パーティーは全滅した。人理修復は失敗に終わった。'] },
    { key: 'sgTimeout', group: '結末', label: '失敗：期限切れ', vars: [] },
    { key: 'ogFinClear', group: '結末', label: '最後の一行（成功）', vars: [], def: ['——人理修復、完了。'] },
    { key: 'ogFinTimeout', group: '結末', label: '最後の一行（期限切れ）', vars: [], def: ['——人理定礎、崩壊。'] },
    { key: 'ogFinFail', group: '結末', label: '最後の一行（そのほかの失敗）', vars: [], def: ['——特異点、観測終了。'] },
  ];
  const LINE_BY_KEY = Object.fromEntries(LINE_DEFS.map(d => [d.key, d]));
  // og* の既定の文は G.LINES にも入れる（original.js が line() で使う）。聖杯戦争・特異点では使われない
  if (G.LINES) for (const d of LINE_DEFS) if (d.def && /^og/.test(d.key) && !G.LINES[d.key]) G.LINES[d.key] = d.def;
  // 既定の文（エディタの表示と「既定に追加」に使う）
  const defaultLines = key => (G.LINES && G.LINES[key] && G.LINES[key].length ? G.LINES[key] : (LINE_BY_KEY[key] && LINE_BY_KEY[key].def) || []).slice();
  // 敵・ボス・はぐれ・節・出来事ごとの文で使える {…}
  const ITEM_VARS = { enemy: ['T', 'S', 'M'], boss: ['B', 'T', 'M', 'stage'], stray: ['T', 'M'], stage: ['n', 'stage', 'M'], event: ['M', 'S', 'T', 'day'] };

  // ---------- ひな形 ----------
  function blank() {
    return {
      format: FORMAT, version: VERSION,
      title: '新しい特異点', author: '', description: '',
      city: '', tag: '',
      days: 30,
      master: { name: '', sex: '', age: null, originLabel: '人理の守り手', wish: '人理の修復', stats: { mana: 'C', craft: 'C', body: 'C', mind: 'B', luck: 'B' } },
      party: { size: 6, front: 3, from: [], exclude: [] },
      settings: {},
      places: [],
      stages: [{ name: '第一節', days: null, intro: [], clear: [], places: [], enemies: [{ key: 'e1', pick: 'random', from: [], classes: [], count: 7, meet: 'mixed' }], boss: null }],
      stray: null,
      events: { defaults: true, list: [] },
      lines: {},
    };
  }

  // ---------- 読み取り ----------
  const str = v => typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  const arr = v => Array.isArray(v) ? v : v == null || v === '' ? [] : [v];
  const textList = v => arr(v).map(str).filter(Boolean);
  const num = (v, d) => v === '' || v == null || !isFinite(+v) ? d : +v;

  /** 足りない値を既定で埋めた写しを返す（元のオブジェクトは変えない）。敵の key が無ければ s{節}e{番号} を付ける */
  function normalize(scn) {
    const s = JSON.parse(JSON.stringify(scn || {}));
    const b = blank();
    s.format = FORMAT; s.version = VERSION;
    s.title = str(s.title) || '名もなき特異点';
    s.city = str(s.city); s.tag = str(s.tag);
    s.days = Math.round(num(s.days, b.days));
    s.master = Object.assign({}, b.master, s.master || {});
    s.master.stats = Object.assign({}, b.master.stats, (s.master && s.master.stats) || {});
    s.party = Object.assign({}, b.party, s.party || {});
    s.party.size = Math.round(num(s.party.size, 6)); s.party.front = Math.round(num(s.party.front, 3));
    s.party.from = textList(s.party.from); s.party.exclude = textList(s.party.exclude);
    s.settings = s.settings && typeof s.settings === 'object' ? s.settings : {};
    s.places = arr(s.places).filter(p => p && str(p.name));
    s.stages = arr(s.stages).map((st, i) => {
      st = Object.assign({ name: '', days: null, intro: [], clear: [], places: [], enemies: [], boss: null }, st || {});
      st.name = str(st.name) || '第' + (i + 1) + '節';
      st.days = st.days == null || st.days === '' ? null : Math.round(num(st.days, null));
      st.intro = textList(st.intro); st.clear = textList(st.clear);
      st.places = arr(st.places).filter(p => p && str(p.name));
      st.enemies = arr(st.enemies).map((e, j) => {
        e = Object.assign({ pick: 'fixed', servant: '', from: [], classes: [], count: 1, meet: 'mixed', day: null, label: '', revealed: false, power: null, intro: [], defeat: [] }, e || {});
        e.key = str(e.key) || 's' + (i + 1) + 'e' + (j + 1);
        e.pick = e.pick === 'random' ? 'random' : 'fixed';
        e.servant = str(e.servant); e.from = textList(e.from); e.classes = textList(e.classes);
        e.count = Math.max(1, Math.round(num(e.count, 1)));
        if (!MEET[e.meet]) e.meet = 'mixed';
        e.day = e.day == null || e.day === '' ? null : Math.round(num(e.day, null));
        e.label = str(e.label); e.revealed = !!e.revealed;
        e.power = e.power == null || e.power === '' ? null : num(e.power, null);
        e.intro = textList(e.intro); e.defeat = textList(e.defeat);
        return e;
      });
      if (st.boss && (str(st.boss.servant) || st.boss.pick === 'random')) {
        const bo = Object.assign({ pick: 'fixed', servant: '', from: [], label: '', revealed: true, intro: [], defeat: [] }, st.boss);
        bo.pick = bo.pick === 'random' ? 'random' : 'fixed';
        bo.servant = str(bo.servant); bo.from = textList(bo.from); bo.label = str(bo.label); bo.revealed = bo.revealed !== false;
        bo.intro = textList(bo.intro); bo.defeat = textList(bo.defeat);
        for (const k of Object.keys(BOSS_KEYS)) if (bo[k] === '' || bo[k] == null) delete bo[k]; else bo[k] = num(bo[k], undefined);
        st.boss = bo;
      } else st.boss = null;
      return st;
    });
    if (s.stray && (str(s.stray.servant) || s.stray.pick === 'random')) {
      const y = Object.assign({ pick: 'fixed', servant: '', from: [], appear: 'random', day: null, after: null, label: '', intro: [] }, s.stray);
      y.pick = y.pick === 'random' ? 'random' : 'fixed';
      y.servant = str(y.servant); y.from = textList(y.from); y.label = str(y.label); y.intro = textList(y.intro);
      if (!STRAY_APPEAR[y.appear]) y.appear = 'random';
      y.day = y.day == null || y.day === '' ? null : Math.round(num(y.day, null));
      y.after = y.after == null || y.after === '' ? null : Math.round(num(y.after, null));
      s.stray = y;
    } else s.stray = null;
    const ev = s.events && typeof s.events === 'object' ? s.events : {};
    s.events = { defaults: ev.defaults !== false, list: arr(ev.list).map((e, i) => normEvent(e, i)) };
    s.lines = s.lines && typeof s.lines === 'object' ? s.lines : {};
    return s;
  }
  function normEffects(list) {
    return arr(list).filter(x => x && EFFECTS[x.type]).map(x => ({ type: x.type, amount: num(x.amount, x.type === 'heal' || x.type === 'damage' ? 20 : 1), target: TARGETS[x.target] ? x.target : 'all', enemy: str(x.enemy), name: str(x.name) }));
  }
  function normEvent(e, i) {
    e = Object.assign({ id: '', title: '', day: null, from: null, to: null, stage: null, after: '', chance: null, weight: 1, once: true, text: [], effects: [], choices: [], auto: 0 }, e || {});
    e.id = str(e.id) || 'ev' + (i + 1);
    e.title = str(e.title);
    for (const k of ['day', 'from', 'to', 'stage']) e[k] = e[k] == null || e[k] === '' ? null : Math.round(num(e[k], null));
    e.after = str(e.after);
    e.chance = e.chance == null || e.chance === '' ? null : num(e.chance, null);
    e.weight = num(e.weight, 1);
    e.once = e.once !== false;
    e.text = textList(e.text);
    e.effects = normEffects(e.effects);
    e.choices = arr(e.choices).filter(Boolean).slice(0, 3).map(c => ({ label: str(c.label) || '選ぶ', sub: str(c.sub), text: textList(c.text), effects: normEffects(c.effects) }));
    e.auto = Math.max(0, Math.min(e.choices.length - 1, Math.round(num(e.auto, 0))));
    return e;
  }

  // ---------- サーヴァントの指定 ----------
  // 指定のしかた：id（'saber:真名'）／真名／'真名#key'。同じ真名が何騎もいれば id で指定する
  function resolve(ref, roster, bosses) {
    ref = str(ref);
    if (!ref) return { error: '未指定' };
    const norm = x => (G.rank && G.rank.normalize ? G.rank.normalize(x) : x).replace(/\s+/g, '');
    const all = (roster || []).concat((bosses || []).filter(b => !(roster || []).some(s => s.id === b.id)));
    const byId = all.find(s => s.id === ref);
    if (byId) return { sv: byId };
    const okey = s => G.effects && G.effects.okey ? G.effects.okey(s) : s.trueName;
    const r = norm(ref);
    const exact = all.filter(s => norm(okey(s)) === r);
    if (exact.length === 1) return { sv: exact[0] };
    const named = exact.length ? exact : all.filter(s => norm(s.trueName) === r);
    if (named.length === 1) return { sv: named[0] };
    if (named.length > 1) return { error: `「${ref}」は${named.length}騎います。id で指定してください（${named.map(s => s.id).join('／')}）`, cands: named };
    return { error: `「${ref}」はサーヴァントリストにいません` };
  }

  // ---------- 整合性チェック ----------
  /** data: { roster（組み立て済み）, bosses（組み立て済みのボス専用）}。戻り値 { errors, warnings, n（normalize 済み） } */
  function check(raw, data) {
    data = data || {};
    const errors = [], warnings = [];
    const E = (path, msg) => errors.push({ path, msg }), W = (path, msg) => warnings.push({ path, msg });
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { E('', 'シナリオのファイルではありません（JSON のオブジェクトが必要です）'); return { errors, warnings, n: null }; }
    if (raw.format && raw.format !== FORMAT) E('format', `形式が違います（${raw.format}）。オリジナル特異点のシナリオ（${FORMAT}）を読み込んでください`);
    if (raw.version != null && +raw.version > VERSION) W('version', `新しい版（${raw.version}）のシナリオです。一部が読めないかもしれません`);
    const n = normalize(raw);
    const roster = (data.roster || []).filter(s => s && s.score), bosses = (data.bosses || []).filter(s => s && s.score);
    const players = roster.filter(s => !s.bossOnly);
    if (!str(raw.title)) E('title', '特異点の名前がありません');
    if (!(n.days >= 1 && n.days <= 365)) E('days', '期限（日数）は 1〜365 にしてください');
    // マスター
    for (const k of ['mana', 'craft', 'body', 'mind', 'luck']) {
      const v = n.master.stats[k];
      if (v != null && v !== '' && G.rank && G.rank.toScore && G.rank.toScore(v) == null) W('master.stats.' + k, `マスターの能力「${v}」が読めません（A〜E か 0〜100）`);
    }
    if (n.master.age != null && n.master.age !== '' && !(+n.master.age >= 10 && +n.master.age <= 99)) W('master.age', 'マスターの年齢は 10〜99 にしてください');
    // 数値の上書き
    for (const [k, v] of Object.entries(n.settings)) {
      const d = SETTINGS.find(x => x.k === k);
      if (!d) { W('settings.' + k, `「${k}」は上書きできる数値ではありません（無視されます）`); continue; }
      if (typeof v !== 'number' || !isFinite(v)) E('settings.' + k, `${d.label}が数ではありません`);
      else if (v < d.min || v > d.max) W('settings.' + k, `${d.label}（${v}）が範囲 ${d.min}〜${d.max} の外です`);
    }
    const ref = (path, x, what, withBoss) => {
      const r = resolve(x, withBoss ? roster : players, withBoss ? bosses : []);
      if (r.error) E(path, `${what}：${r.error}`);
      return r.sv || null;
    };
    const fixedIds = new Set();
    const refList = (path, list, what) => list.forEach((x, i) => ref(`${path}[${i}]`, x, what, false));
    // 味方
    if (!(n.party.size >= 1 && n.party.size <= 6)) E('party.size', '味方の数は 1〜6 にしてください');
    if (!(n.party.front >= 1 && n.party.front <= n.party.size)) E('party.front', '前衛の数は 1〜味方の数にしてください');
    refList('party.from', n.party.from, '味方の候補');
    refList('party.exclude', n.party.exclude, '味方から外す英霊');
    // 節と敵
    if (!n.stages.length) E('stages', '節が一つもありません');
    const keys = new Map();
    let total = 0;
    n.stages.forEach((st, i) => {
      const P = `stages[${i}]`;
      if (!st.enemies.length && !st.boss) E(P, `${st.name}：敵もボスもいません`);
      if (st.days != null && !(st.days >= 1 && st.days <= n.days)) E(P + '.days', `${st.name}：節の期限は 1〜${n.days} 日にしてください`);
      st.enemies.forEach((e, j) => {
        const Q = `${P}.enemies[${j}]`, what = `${st.name}の敵「${e.label || e.servant || e.key}」`;
        if (keys.has(e.key)) E(Q + '.key', `${what}：key「${e.key}」が重なっています（${keys.get(e.key)}）`); else keys.set(e.key, what);
        if (e.pick === 'fixed') { const sv = ref(Q + '.servant', e.servant, what, true); if (sv) fixedIds.add(sv.id); total++; }
        else {
          e.from.forEach((x, k) => ref(`${Q}.from[${k}]`, x, what + 'の候補', true));
          const pool = poolOf(e, roster, bosses);
          if (!pool.length) E(Q, `${what}：候補が一騎もいません`);
          else if (pool.length < e.count) W(Q, `${what}：候補（${pool.length}騎）が人数（${e.count}）より少ないので、同じ英霊が何度も出ます`);
          total += e.count;
        }
        if (e.meet === 'day' && !(e.day >= 1 && e.day <= n.days)) E(Q + '.day', `${what}：現れる日を 1〜${n.days} で決めてください`);
        if (e.power != null && !(e.power >= -0.9 && e.power <= 10)) W(Q + '.power', `${what}：強さの上乗せ（${e.power}）が大きすぎるか小さすぎます`);
        lineVars(Q + '.intro', e.intro, ITEM_VARS.enemy, W); lineVars(Q + '.defeat', e.defeat, ITEM_VARS.enemy, W);
      });
      if (st.boss) {
        const bo = st.boss, Q = P + '.boss', what = `${st.name}のボス`;
        if (bo.pick === 'fixed') { const sv = ref(Q + '.servant', bo.servant, what, true); if (sv) fixedIds.add(sv.id); }
        else { bo.from.forEach((x, k) => ref(`${Q}.from[${k}]`, x, what + 'の候補', true)); if (!poolOf(bo, roster, bosses).length) E(Q, `${what}：候補が一騎もいません`); }
        for (const k of Object.keys(BOSS_KEYS)) if (bo[k] != null && !isFinite(bo[k])) E(Q + '.' + k, `${what}：${BOSS_KEYS[k]}が数ではありません`);
        if (bo.gauges != null && !(bo.gauges >= 1 && bo.gauges <= 20)) W(Q + '.gauges', `${what}：ブレイクゲージは 1〜20 にしてください`);
        lineVars(Q + '.intro', bo.intro, ITEM_VARS.boss, W); lineVars(Q + '.defeat', bo.defeat, ITEM_VARS.boss, W);
      }
      lineVars(P + '.intro', st.intro, ITEM_VARS.stage, W); lineVars(P + '.clear', st.clear, ITEM_VARS.stage, W);
    });
    if (total > 60) W('stages', `敵が多すぎます（${total}騎）。重くなるかもしれません`);
    if (n.stray) {
      const y = n.stray, what = 'はぐれサーヴァント';
      if (y.pick === 'fixed') { const sv = ref('stray.servant', y.servant, what, false); if (sv) fixedIds.add(sv.id); }
      else { y.from.forEach((x, k) => ref(`stray.from[${k}]`, x, what + 'の候補', false)); if (!poolOf(y, players, []).length) E('stray', `${what}：候補が一騎もいません`); }
      if (y.appear === 'day' && !(y.day >= 1 && y.day <= n.days)) E('stray.day', `${what}：現れる日を 1〜${n.days} で決めてください`);
      if (y.appear === 'event' && !n.events.list.some(ev => ev.effects.concat(...ev.choices.map(c => c.effects)).some(x => x.type === 'stray'))) W('stray.appear', `${what}：「自作の出来事でだけ」現れますが、効果「はぐれ」を持つ出来事がありません`);
      lineVars('stray.intro', y.intro, ITEM_VARS.stray, W);
    }
    // 味方に回せる英霊の数（敵・ボス・はぐれに名指しされた英霊は味方にしない）
    const fromIds = new Set(n.party.from.map(x => (resolve(x, players).sv || {}).id).filter(Boolean));
    const exIds = new Set(n.party.exclude.map(x => (resolve(x, players).sv || {}).id).filter(Boolean));
    const avail = players.filter(s => (!fromIds.size || fromIds.has(s.id)) && !exIds.has(s.id) && !fixedIds.has(s.id));
    if (players.length && avail.length < n.party.size) E('party', `味方に選べる英霊が足りません（${avail.length}騎／${n.party.size}騎）`);
    // 出来事
    const evIds = new Set();
    n.events.list.forEach((ev, i) => {
      const P = `events.list[${i}]`, what = `出来事「${ev.title || ev.id}」`;
      if (evIds.has(ev.id)) E(P + '.id', `${what}：id「${ev.id}」が重なっています`); evIds.add(ev.id);
      if (ev.day != null && !(ev.day >= 1 && ev.day <= n.days)) E(P + '.day', `${what}：日は 1〜${n.days} にしてください`);
      if (ev.from != null && ev.to != null && ev.from > ev.to) E(P, `${what}：「何日目から」が「何日目まで」より後です`);
      if (ev.stage != null && !(ev.stage >= 1 && ev.stage <= n.stages.length)) E(P + '.stage', `${what}：節は 1〜${n.stages.length} にしてください`);
      if (ev.after && !keys.has(ev.after)) E(P + '.after', `${what}：「倒した後」の敵 key「${ev.after}」がありません`);
      if (ev.chance != null && !(ev.chance >= 0 && ev.chance <= 1)) E(P + '.chance', `${what}：確率は 0〜1 にしてください`);
      if (ev.day == null && !(ev.weight > 0)) W(P + '.weight', `${what}：日が決まっておらず重みも 0 なので、起きません`);
      if (!ev.text.length && !ev.choices.length) W(P + '.text', `${what}：文がありません`);
      const effs = ev.effects.concat(...ev.choices.map(c => c.effects));
      for (const x of effs) if (x.enemy && !keys.has(x.enemy)) E(P, `${what}：効果「${EFFECTS[x.type].label}」の敵 key「${x.enemy}」がありません`);
      if (effs.some(x => x.type === 'stray') && !n.stray) W(P, `${what}：はぐれサーヴァントが決まっていないので、効果「はぐれ」は何もしません`);
      lineVars(P + '.text', ev.text, ITEM_VARS.event, W);
      ev.choices.forEach((c, k) => lineVars(`${P}.choices[${k}].text`, c.text, ITEM_VARS.event, W));
    });
    // 文面の差し替え
    for (const [k, v] of Object.entries(n.lines)) {
      const P = 'lines.' + k;
      const list = Array.isArray(v) ? v : v && Array.isArray(v.add) ? v.add : null;
      if (!list) { E(P, `文面「${k}」は文の配列か { "add": [...] } にしてください`); continue; }
      if (list.some(x => typeof x !== 'string')) E(P, `文面「${k}」に文字でないものが入っています`);
      const d = LINE_BY_KEY[k];
      if (!d) W(P, `文面「${k}」はこのモードで使われないキーです`);
      else lineVars(P, list.filter(x => typeof x === 'string'), d.vars, W);
    }
    n.places.concat(...n.stages.map(s => s.places)).forEach(p => { if (p.terrain && !['水辺', '森', '山', '夜'].includes(p.terrain)) W('places', `場所「${p.name}」の地形「${p.terrain}」は効果の条件にありません（水辺・森・山・夜）`); });
    return { errors, warnings, n };
  }
  // 文の中の {…} が使えるものか
  function lineVars(path, list, vars, W) {
    const ok = new Set(vars || []);
    for (const t of list || []) for (const m of String(t).matchAll(/\{(\w+)\}/g)) if (!ok.has(m[1])) { W(path, `「{${m[1]}}」はここでは使えません（使えるのは ${vars.length ? vars.map(v => '{' + v + '}').join(' ') : 'なし'}）`); return; }
  }
  // ランダムの候補（from が空ならリストの全員。classes でクラスを絞る）
  function poolOf(e, roster, bosses) {
    const all = (roster || []).filter(s => s && s.score && !s.bossOnly);
    let pool = e.from && e.from.length ? e.from.map(x => resolve(x, roster, bosses).sv).filter(Boolean) : all;
    if (e.classes && e.classes.length) pool = pool.filter(s => e.classes.includes(s.class.key) || e.classes.includes(s.class.label));
    return [...new Map(pool.map(s => [s.id, s])).values()];
  }

  // ---------- 文面の差し替え ----------
  /** engine.js の opts.lines に渡す { キー: [文…] }（normalize 済みのシナリオから）。敵などの個別の文は '@' で始まるキー */
  function linesOf(n) {
    const out = {};
    for (const [k, v] of Object.entries(n.lines || {})) {
      if (Array.isArray(v)) { const l = v.filter(x => typeof x === 'string' && x.trim()); if (l.length) out[k] = l; }
      else if (v && Array.isArray(v.add)) { const l = defaultLines(k).concat(v.add.filter(x => typeof x === 'string' && x.trim())); if (l.length) out[k] = l; }
    }
    const put = (k, l) => { if (l && l.length) out[k] = l; };
    n.stages.forEach((st, i) => {
      put(`@st:${i}:intro`, st.intro); put(`@st:${i}:clear`, st.clear);
      for (const e of st.enemies) { put(`@e:${e.key}:intro`, e.intro); put(`@e:${e.key}:defeat`, e.defeat); }
      if (st.boss) { put(`@b:${i}:intro`, st.boss.intro); put(`@b:${i}:defeat`, st.boss.defeat); }
    });
    if (n.stray) put('@s:intro', n.stray.intro);
    for (const ev of n.events.list) { put(`@ev:${ev.id}`, ev.text); ev.choices.forEach((c, k) => put(`@ev:${ev.id}:${k}`, c.text)); }
    return out;
  }

  // シナリオの指紋（記録と同じシナリオかを確かめる。キーの並びに左右されない）
  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    return JSON.stringify(v);
  }
  function hashOf(scn) {
    const t = stable(normalize(scn));
    let h = 2166136261;
    for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }

  G.scenario = { FORMAT, VERSION, SETTINGS, SETTING_KEYS, BOSS_KEYS, MEET, STRAY_APPEAR, EFFECTS, TARGETS, LINE_DEFS, ITEM_VARS, blank, normalize, resolve, poolOf, check, linesOf, defaultLines, hashOf };
})(globalThis.HGW = globalThis.HGW || {});
