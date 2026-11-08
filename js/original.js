/* オリジナル特異点（シナリオを読み込んで遊ぶ特異点。テスト機能）
 *
 * 特異点（singularity.js）とは別のモード。engine.js の戦闘・宝具・効果・記録・判断の仕組みを使い、
 * 日々の進め方・顔ぶれ・出来事・文面をシナリオ（scenario.js の形式）から決める。
 *   - 節（ステージ）を順に越えていく。節の敵をすべて倒すと、その節のボスが現れる（いなければ次の節へ）
 *   - 最後の節を越えれば人理修復は成功。期限切れ（全体・節ごと）・全滅・マスターの死で失敗
 *   - 味方は名簿からランダム（候補・除外はシナリオで決める）。敵・ボス・はぐれは名指しか候補からの抽選
 *
 *   const n = HGW.scenario.normalize(scn);
 *   const L = HGW.original.compose({ scenario: n, roster, bosses, seed });     // 顔ぶれ（始める前に画面に出せる）
 *   const gen = HGW.original.gen({ scenario: n, roster, bosses, seed, lineup: L, front, master, ask: 'big', out });
 *   tick への答え・令呪や推測の cmds は特異点と同じ（{ f: 方針, cmds: [...] }）
 *   判断の種類：cs（heal / none）、wipe（revive / give）、council（deduce:<id> / recover / familiar / swap / pass）、stray（yes / no）、
 *     oevent（自作の出来事の選択肢：c0 / c1 / c2）。キーは記録に残るので名前を変えない
 * 同じシナリオ・同じシード・同じデータ・同じマスターの設定・同じ選択なら、毎回同じ特異点になる。
 */
(function (G) {
  'use strict';
  const B = G.build, E = G.effects, R = G.rank, SC = G.scenario;
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const r1 = x => Math.round(x * 10) / 10;

  // 方針。stance は戦い方（engine.js の battle と同じ：all 全力 / careful 慎重 / retreat すぐ退く）
  const FOCUS = {
    auto:    { code: 'o', label: 'おまかせ', desc: '傷が深ければ休み、手がかりがあれば踏み込み、なければ探る。状況に任せて進む', stance: null },
    advance: { code: 'a', label: '進軍', desc: '特異点の奥へ踏み込み、敵サーヴァントを探して戦う。宝具も惜しまない。出会いも危険も増える', stance: 'all' },
    search:  { code: 's', label: '索敵', desc: '敵の痕跡を追い、居場所と正体を探る。手がかりをつかめば、その敵と出会いやすい', stance: 'careful' },
    stealth: { code: 'h', label: '隠密', desc: '気配を断って進む。悪い出来事・雑魚・夜襲に遭いにくい。戦いになればすぐ退く', stance: 'retreat' },
    rest:    { code: 'r', label: '休息', desc: '霊脈の上で傷と魔力を癒やす。探索はしない', stance: 'careful' },
    defend:  { code: 'd', label: '陣地', desc: '陣地を固めて夜襲に備える。陣地で迎え撃つ戦いは有利になる', stance: 'careful' },
  };
  const FOCUS_BY_CODE = Object.fromEntries(Object.entries(FOCUS).map(([k, v]) => [v.code, k]));
  const SIDE_JA = { party: '味方', foe: '敵', boss: 'ボス', stray: 'はぐれ' };
  const TERRAINS = ['水辺', '森', '山', '夜'];

  const clsKey = s => s.class.key === 'extra' ? 'extra:' + s.class.label : s.class.key;
  const CLASS_ORDER = () => Object.keys(G.CONFIG.CLASS_DEFS);
  const byClass = order => (a, b) => { const o = CLASS_ORDER(), i = x => { const j = o.indexOf(x.class.key); return j < 0 ? 99 : j; }; return i(a) - i(b) || order.get(a.id) - order.get(b.id); };
  // シナリオの数値の上書き（上書きできるキーだけ）と味方の数
  function settingsOf(n) {
    const S = Object.assign({}, G.CONFIG.SING);
    for (const [k, v] of Object.entries(n.settings || {})) if (SC.SETTING_KEYS.has(k) && typeof v === 'number' && isFinite(v)) S[k] = v;
    S.party = n.party.size; S.front = Math.min(n.party.front, n.party.size);
    return S;
  }

  // ---------- 顔ぶれ ----------
  /**
   * シナリオから顔ぶれを決める（シードから。エンジンの戦いの乱数とは別の流れ）。
   * o: { scenario（normalize 済み）, roster, bosses, seed }
   * 戻り値: { name, city, tag, party: [id], stages: [{ enemies: [{ key, id }], boss: id|null }], stray: id|null, front: [前衛の番号] }
   */
  function compose(o) {
    const n = o.scenario, S = settingsOf(n);
    const wd = SC.withServants(n, o.roster, o.bosses);   // シナリオ専用のサーヴァントを加える（無ければそのまま）
    const all = wd.roster.filter(s => s && s.score);
    const players = all.filter(s => !s.bossOnly);
    const bosses = wd.bosses.filter(s => s && s.score);
    const rnd = G.engine.makeRng(String(o.seed) + ':顔ぶれ');
    const pickN = a => a[Math.floor(rnd() * a.length)];
    const res = ref => SC.resolve(ref, all, bosses).sv || null;
    // 名指しされた英霊（味方にはしない）
    const fixed = new Set();
    for (const st of n.stages) {
      for (const e of st.enemies) if (e.pick === 'fixed') { const s = res(e.servant); if (s) fixed.add(s.id); }
      if (st.boss && st.boss.pick === 'fixed') { const s = res(st.boss.servant); if (s) fixed.add(s.id); }
    }
    if (n.stray && n.stray.pick === 'fixed') { const s = res(n.stray.servant); if (s) fixed.add(s.id); }
    // 味方：候補（無ければ全員）から除外と名指しを外し、聖杯戦争と同じ組み方（クラスごとに一騎）で引く
    const from = new Set(n.party.from.map(x => (res(x) || {}).id).filter(Boolean));
    const ex = new Set(n.party.exclude.map(x => (res(x) || {}).id).filter(Boolean));
    const pool = players.filter(s => (from.size ? from.has(s.id) : !s.scenarioOnly) && !ex.has(s.id) && !fixed.has(s.id));   // シナリオ専用の英霊は候補に名指ししたときだけ
    const used = new Set();
    const got = [];
    const comp = pool.length >= 2 ? G.war.composeWar(pool, rnd).filter(x => x.servant).map(x => x.servant) : pool.slice();
    while (comp.length > S.party) comp.splice(Math.floor(rnd() * comp.length), 1);
    for (const s of comp) { got.push(s); used.add(s.id); }
    while (got.length < S.party) { const rest = pool.filter(s => !used.has(s.id)); if (!rest.length) break; const s = pickN(rest); got.push(s); used.add(s.id); }
    const order = new Map(all.map((s, i) => [s.id, i]));
    const party = got.sort(byClass(order));
    // 敵・ボス：名指しはそのまま（同じ英霊が何度出てもよい）。抽選は味方と、すでに抽選で出た英霊を避ける（候補が尽きれば重なる）
    const draw = (e, extra) => {
      const cand = SC.poolOf(e, all, bosses).concat(extra || []);
      const fresh = cand.filter(s => !used.has(s.id) && !fixed.has(s.id));
      const s = fresh.length ? pickN(fresh) : cand.length ? pickN(cand) : null;
      if (s) used.add(s.id);
      return s;
    };
    const stages = n.stages.map(st => {
      const enemies = [];
      for (const e of st.enemies) {
        if (e.pick === 'fixed') { const s = res(e.servant); if (s) enemies.push({ key: e.key, id: s.id }); continue; }
        for (let k = 0; k < e.count; k++) { const s = draw(e); if (s) enemies.push({ key: e.key, id: s.id }); }
      }
      let boss = null;
      if (st.boss) { const s = st.boss.pick === 'fixed' ? res(st.boss.servant) : draw(st.boss, st.boss.from.length ? [] : bosses.filter(b => !b.scenarioOnly)); if (s) boss = s.id; }
      return { enemies, boss };
    });
    let stray = null;
    if (n.stray) { const s = n.stray.pick === 'fixed' ? res(n.stray.servant) : draw(n.stray); if (s) stray = s.id; }
    const front = party.map((s, i) => [i, s.power + s.npPeak * 0.3]).sort((a, b) => b[1] - a[1]).slice(0, S.front).map(x => x[0]).sort((a, b) => a - b);
    return { name: n.title, city: n.city || '', tag: n.tag || n.city || '', party: party.map(s => s.id), stages, stray, front };
  }

  // ---------- 進行 ----------
  function makePlugin(opts, n, L, LN) {
    const S = settingsOf(n);
    const maxDays = n.days;
    const roster = opts.roster || [], bossList = opts.bosses || [];
    const find = id => roster.find(s => s.id === id) || bossList.find(s => s.id === id) || null;
    const has = k => !!(LN[k] && LN[k].length);
    let A = null;
    const camps = [], party = [], foes = [], bosses = [];
    let stray = null;
    const P = {
      master: null, mana: 0, manaMax: 0, cs: S.csMax, mhp: 0, mhpMax: 0, masterAlive: true, items: 0, camp: 0,
      front: [], front0: [], focus: 'auto', si: 0, stage: 'hunt', stageDay: 1, seen: new Set(), lead: null, slain: 0, csDay: 0, guessDay: 0,
      strayJoined: false, strayAsked: false, masterDead: false, wiped: false, cleared: false, timeout: false, revived: 0, lastCouncil: 0, rested: false, cmdLog: [],
      evDone: new Set(),
    };
    const GRAIL = { name: '聖杯', stats: { mana: 32, craft: 32, body: 32, mind: 32, luck: 32 }, originLabel: '', wish: '', origin: 'custom' };
    const NONE = { name: '（主なし）', stats: { mana: 32, craft: 32, body: 32, mind: 32, luck: 32 }, originLabel: '', wish: '', origin: 'custom' };
    const allIds = new Set();
    const shared = { knowName: new Set(), knowLoc: new Set(), clues: {} };
    const placeOf = p => ({ name: String(p.name), terrain: TERRAINS.includes(p.terrain) ? p.terrain : null, scene: p.scene || 'city' });
    const placesOf = i => { const st = n.stages[i]; const l = st && st.places.length ? st.places : n.places.length ? n.places : G.SING_DATA.PLACES; return l.map(placeOf); };

    function mkCamp(sv0, id, side, place, rnd) {
      const sv = JSON.parse(JSON.stringify(sv0));
      for (const k of B.STAT_KEYS) if (sv.ranks[k] && sv.ranks[k].range) { sv.ranks[k] = R.rollRange(sv.ranks[k], rnd, G.CONFIG.STAT_SCORE); sv.score[k] = sv.ranks[k].score; }
      sv.power = B.combatPower(sv);
      allIds.add(id);
      return {
        id, side, sv, label: '', labelBase: '', hp: 100, alive: true, out: false, fate: null, soloLeft: null, inChurch: false, merged: false,
        base: place, items: 0, pact: null, op: null, knowName: new Set([id]), knowLoc: new Set([id]), temp: [], npBoost: 0, kills: [], npUses: 0, battles: 0,
        hunting: false, hidden: false, wander: false, fought: false, stance: null, usedSup: new Set(), bond: 30, policy: 'balanced', plan: null, warned: 0,
        bounty: false, dreams: 0, lifeSeen: new Set(), knowPersona: allIds, clues: {}, party: side === 'party', foe: side === 'foe', boss: side === 'boss',
      };
    }
    function labelAll(list, prefix) {
      const cnt = {}, seen = {};
      for (const c of list) { c.labelBase = c.sv.class.label; cnt[c.labelBase] = (cnt[c.labelBase] || 0) + 1; }
      for (const c of list) {
        let l = c.labelBase;
        if (cnt[l] > 1) { seen[l] = (seen[l] || 0) + 1; l += '（' + (seen[l] <= 10 ? '一二三四五六七八九十'[seen[l] - 1] : seen[l]) + '）'; }
        c.label = prefix + l;
      }
    }
    const alive = list => list.filter(c => c.alive);
    const frontAlive = () => P.front.map(i => camps[i]).filter(c => c && c.alive);
    const reserveAlive = () => party.filter(c => c.alive && !P.front.includes(c.id));
    const foesAlive = () => foes.filter(c => c.alive && c.stage === P.si);
    const shown = c => c.meet !== 'day' || c.appeared;
    const findable = () => foesAlive().filter(c => shown(c) && c.meet !== 'raid');
    const raiders = () => foesAlive().filter(c => shown(c) && c.meet !== 'search');
    const bossNow = () => bosses[P.si] || null;
    const strayReady = () => stray && P.strayJoined && stray.alive;
    const over = () => P.masterDead || P.wiped || P.cleared || P.timeout;
    const curStage = () => n.stages[P.si];

    const plugin = {
      FOCUS,
      init(t) {
        const { rnd } = t;
        // マスター（あなた）：シナリオの既定に、プレイヤーの設定を重ねる（masterOf）。空の能力は乱数で決まる。
        // 名前・性別・年齢は乱数を使わずにエンジンが後から付ける（warGen の playerName など）ので、変えても展開は変わらない
        const mo = masterOf(n, opts.master);
        const spec = { origin: 'custom', stats: mo.stats };
        if (mo.originLabel) spec.originLabel = mo.originLabel;
        if (mo.wish) spec.wish = mo.wish;
        const m = G.master.createMaster(spec, rnd);
        if (!m.name) {
          const N = G.NAMES, female = /女/.test(m.sex);
          m.name = N && N.jpSurname ? N.jpSurname[Math.floor(rnd() * N.jpSurname.length)] + ' ' + (female ? N.jpFemale : N.jpMale)[Math.floor(rnd() * (female ? N.jpFemale : N.jpMale).length)] : 'あなた';
        }
        m.wish = m.wish || '人理の修復';
        P.master = m;
        const places = placesOf(0);
        const start = places[Math.floor(rnd() * places.length)];
        P.place = start;
        // 味方
        L.party.forEach(id => {
          const sv = find(id); if (!sv) throw new Error('味方のサーヴァントが見つかりません：' + id);
          const c = mkCamp(sv, camps.length, 'party', start, rnd);
          c.knowName = shared.knowName; c.knowLoc = shared.knowLoc; c.clues = shared.clues;
          for (const k of ['master', 'mana', 'manaMax', 'cs', 'mhp', 'mhpMax', 'masterAlive', 'items']) Object.defineProperty(c, k, { get: () => P[k], set: v => { P[k] = v; }, enumerable: true });
          Object.defineProperty(c, 'workshop', { get: () => P.camp * S.campEdge / 0.05, set: () => {}, enumerable: true });
          c.you = true; c.assistK = S.frontAssist;
          camps.push(c); party.push(c);
        });
        if (!party.length) throw new Error('味方のサーヴァントがいません');
        for (const c of party) shared.knowName.add(c.id);
        labelAll(party, '');
        P.manaMax = P.mana = Math.round((t.ENG.manaBase + m.stats.mana) * party.length * S.poolK);
        P.mhpMax = P.mhp = Math.round(50 + m.stats.body * 0.8);
        const tag = L.tag ? L.tag + 'の' : '';
        // 節ごとの敵とボス
        L.stages.forEach((ls, i) => {
          const st = n.stages[i], pl = placesOf(i), here = () => pl[Math.floor(rnd() * pl.length)];
          const list = [];
          ls.enemies.forEach(x => {
            const sv = find(x.id); if (!sv) throw new Error('敵のサーヴァントが見つかりません：' + x.id);
            const e = st.enemies.find(y => y.key === x.key) || {};
            const c = mkCamp(sv, camps.length, 'foe', here(), rnd);
            Object.assign(c, { master: GRAIL, masterAlive: true, noMaster: true, cs: 0, mhp: 1, mhpMax: 1, mana: S.foeMana, manaMax: S.foeMana, workshop: 0, assistK: S.frontAssist,
              stage: i, key: x.key, meet: e.meet || 'mixed', day: e.day, appeared: false, powerAdd: e.power, fixedLabel: e.label || '', revealed: !!e.revealed });
            camps.push(c); foes.push(c); list.push(c);
          });
          labelAll(list.filter(c => !c.fixedLabel), tag);
          for (const c of list) {
            if (c.fixedLabel) c.label = c.fixedLabel;
            if (c.revealed) shared.knowName.add(c.id);
          }
          if (ls.boss) {
            const sv = find(ls.boss); if (!sv) throw new Error('ボスのサーヴァントが見つかりません：' + ls.boss);
            const bo = st.boss || {};
            const c = mkCamp(sv, camps.length, 'boss', here(), rnd);
            const own = {}; for (const k of Object.keys(SC.BOSS_KEYS)) if (bo[k] != null && isFinite(bo[k])) own[k] = bo[k];
            const bs = Object.assign({}, S.boss, sv.bossOnly ? {} : S.empower, sv.boss || {}, own);
            Object.assign(c, { master: GRAIL, masterAlive: true, noMaster: true, cs: 0, mhp: 1, mhpMax: 1, mana: bs.mana || S.boss.mana, manaMax: bs.mana || S.boss.mana, workshop: 0, stage: i, revealed: bo.revealed !== false });
            c.bs = bs; c.gauges = c.gaugeMax = Math.max(1, Math.round(bs.gauges || 1)); c.empowered = !sv.bossOnly;
            c.label = bo.label || bs.label || (c.empowered ? '超越した' + sv.class.label : sv.class.label);
            camps.push(c); bosses[i] = c;
          } else bosses[i] = null;
        });
        // はぐれサーヴァント
        if (L.stray) {
          const sv = find(L.stray);
          if (sv) {
            const c = mkCamp(sv, camps.length, 'stray', start, rnd);
            Object.assign(c, { master: NONE, masterAlive: true, noMaster: true, cs: 0, mhp: 1, mhpMax: 1, mana: S.strayMana, manaMax: S.strayMana, workshop: 0, assistK: S.strayAssist * S.frontAssist });
            c.label = (n.stray && n.stray.label) || 'はぐれの' + sv.class.label;
            // 無敵（SC.STRAY_GUARD）：noBattle 戦いに加わらず後ろから支える／noDamage 傷を負わない（engine の nodmg）／noTarget 敵の攻撃の的にならない（engine の nohit）
            c.guard = (n.stray && n.stray.guard) || '';
            if (c.guard === 'noDamage') c.nodmg = true;
            if (c.guard === 'noTarget') c.nohit = true;
            camps.push(c); stray = c;
          }
        }
        // 前衛
        const fr = (Array.isArray(opts.front) ? opts.front : L.front || []).map(Number).filter(i => i >= 0 && i < party.length);
        P.front = [...new Set(fr)].slice(0, S.front);
        for (const c of party) if (P.front.length < S.front && !P.front.includes(c.id)) P.front.push(c.id);
        P.front0 = P.front.slice();
        P.places = places;
        return { city: n.title, places: placesOf(0), camps, you: party[0] };
      },
      snap() {
        return {
          p: { mana: Math.round(P.mana / Math.max(1, P.manaMax) * 100), cs: P.cs, mhp: Math.max(0, Math.round(P.mhp / Math.max(1, P.mhpMax) * 100)), alive: P.masterAlive, items: P.items, camp: P.camp,
            slain: P.slain, si: P.si, stage: P.stage, focus: P.focus, place: P.place ? P.place.name : '', scene: P.place ? P.place.scene : '' },
          c: camps.map(c => ({
            id: c.id, side: c.side, label: c.label, name: A.known(c) ? c.sv.trueName : null, cls: c.sv.class.label, hp: Math.max(0, Math.round(c.hp)), alive: c.alive,
            front: c.party ? P.front.includes(c.id) : false, seen: c.party || P.seen.has(c.id), gauges: c.gauges || 0, gaugeMax: c.gaugeMax || 0, stage: c.stage != null ? c.stage : null,
            joined: c === stray ? P.strayJoined : c.party, clues: !c.party && !A.known(c) ? (shared.clues[c.id] || 0) : 0, bond: c.party ? Math.round(c.bond) : null,
          })),
        };
      },
      aoeOf(c, np) {
        if (c.sv.boss && c.sv.boss.aoe && c.sv.boss.aoe[E.normName(np.name)] != null) return c.sv.boss.aoe[E.normName(np.name)];
        return (S.aoe && S.aoe[np.typeKey]) || 0;
      },
      hooks: {
        drain(c) {
          if (!c.party) { c.mana = 0; return; }
          const short = -P.mana; P.mana = 0;
          for (const x of alive(party)) x.hp = Math.max(1, x.hp - Math.min(8, short * 0.15));
          if (!P.drainSaid || P.drainSaid < A.day) { P.drainSaid = A.day; A.log(A.phase === 'night' ? 'battle' : 'day', A.line('ogDrain', {}), alive(party).map(x => x.id)); }
        },
        down(c) {
          if (c.party) {
            P.front = P.front.filter(i => i !== c.id);
            if (P.lead === c.id) P.lead = null;
          } else if (c.foe) {
            P.slain++; if (P.lead === c.id) P.lead = null;
            const k = `@e:${c.key}:defeat`;
            if (has(k)) A.log('event', A.line(k, { T: c.label, S: A.sn(c), M: A.mn(party[0]) }), [c.id]);
          } else if (c.boss) {
            P.bossDown = true;
            const k = `@b:${c.stage}:defeat`;
            if (has(k)) A.log('event', A.line(k, { B: A.sn(c), T: c.label, M: A.mn(party[0]), stage: n.stages[c.stage].name }), [c.id], { big: true });
          }
        },
        masterDown() { P.masterDead = true; },
        gauge(l) {
          if (!l.boss || !(l.gauges > 1)) return null;
          l.gauges--; l.hp = 100; l.wither = 0; l.poison = null;
          if (l.temp) l.temp.push({ id: 'power', mag: 0.1, params: null, from: 'ブレイク' });
          A.log('battle', A.line('ogBreak', { S: A.nm(l), n: l.gauges }), [l.id], { big: true, quote: A.say(l, ['開始']) });
          return 'guts';
        },
        *seal(l, w) {
          if (!l.party || !P.masterAlive || P.cs < 1) return null;
          const k = yield* A.ask(l, 'cs', {
            title: `${A.sn(l)}が消えかけている`,
            body: `このままでは${A.sn(l)}は倒れる。令呪は残り${P.cs}画（全滅したとき全員を呼び戻すには${S.csWipe}画が要る）。`,
            options: [
              { k: 'heal', label: '令呪で霊基を癒やす', sub: '令呪一画。霊基を満たし、そのまま戦わせる' },
              { k: 'none', label: '令呪は使わない', sub: P.cs >= S.csWipe ? '全滅に備えて令呪を残す' : '残りの令呪を温存する' },
            ],
          }, () => autoSeal(l));
          if (k !== 'heal') return null;
          P.cs--; l.hp = S.csHealHp; l.wither = 0; l.poison = null; A.bondUp(l, 5);
          A.log('cs', A.line('ogSeal', { S: A.sn(l), n: P.cs }), [l.id, w.id], { big: true });
          return 'rallied';
        },
        focus(c) {
          if (c.boss) return { stance: 'all' };
          if (!c.party) return null;
          const F = FOCUS[P.today || P.focus];
          return F && F.stance ? F : null;
        },
        lineup(a, b, ha, hb) {
          const sideTxt = (x, h) => h.length ? `${A.sn(x)}・${h.map(A.sn).join('・')}` : A.sn(x);
          if (ha.length || hb.length) A.log('battle', `${sideTxt(a, ha)}——対するは${sideTxt(b, hb)}。`, [a.id, b.id].concat(ha.map(x => x.id), hb.map(x => x.id)));
        },
      },
      *run(api) { A = api; return yield* main(); },
    };

    function autoSeal() { return P.cs > S.csWipe || P.cs < S.csWipe ? 'heal' : 'none'; }

    // ---------- 数値 ----------
    const mean = a => a.length ? a.reduce((t, x) => t + x, 0) / a.length : 0;
    function partyDetect() { const xs = alive(party); return xs.length ? Math.max(...xs.map(c => A.eff(c, 'detect'))) : 0; }
    function partyIntel() { const xs = alive(party); return xs.length ? Math.max(...xs.map(c => A.eff(c, 'intel'))) : 0; }
    function mitigation(F) {
      const xs = frontAlive().length ? frontAlive() : alive(party);
      if (!xs.length) return 0;
      const st = xs.map(c => Math.max(0, A.eff(c, 'stealth')));
      const stealth = Math.max(...st) * 0.6 + mean(st) * 0.4;
      const luck = mean(xs.map(c => A.sd(c, 'luk') + A.eff(c, 'luck'))) + A.md(party[0], 'luck') * 0.5;
      return clamp(stealth * S.stealthK + luck * S.luckK + (F === 'stealth' ? S.stealthFocus : 0), 0, S.mitigateCap);
    }
    const hpOf = xs => mean(xs.map(c => c.hp));
    function weakMult(c) {
      const ref = mean(party.map(x => x.sv.power));
      return ref > 0 ? clamp(1 + S.weakBonus * (ref - c.sv.power) / ref, S.weakMin, S.weakMax) : 1;
    }
    const V0 = () => ({ M: A.mn(party[0]), name: n.title, city: L.city || n.title, day: A.day });

    // ---------- 朝 ----------
    function morning(cmds) {
      const day = A.day;
      if (day > 1 && (day - 1) % S.csEvery === 0 && P.cs < S.csMax && P.masterAlive) { P.cs++; A.log('cs', A.line('ogCsBack', { M: A.mn(party[0]), n: P.cs }), alive(party).map(c => c.id).slice(0, 1)); }
      for (const cmd of cmds || []) applyCmd(cmd);
      const team = alive(party).concat(strayReady() ? [stray] : []);
      let healed = 0, healer = null;
      for (const h of alive(party)) {
        const k = Math.max(0, A.eff(h, 'heal_other')) * weakMult(h); if (!(k > 0)) continue;
        for (const x of team) if (x !== h && x.hp < 100) { const v = Math.min(100 - x.hp, k * S.healOther); x.hp += v; healed += v; }
        P.mhp = Math.min(P.mhpMax, P.mhp + k * S.healOther * 0.5);
        if (!healer || k > A.eff(healer, 'heal_other') * weakMult(healer)) healer = h;
      }
      if (healer && healed >= 8 && !(P.healSaid > day - 3)) { P.healSaid = day; A.log('day', A.line('ogHeal', { S: A.sn(healer) }), [healer.id]); }
      for (const c of camps) c.dayTemp = null;
      for (const c of camps) {
        if (!c.alive || (c === stray && !P.strayJoined) || (c.boss && (P.stage !== 'boss' || c !== bossNow())) || (c.foe && c.stage !== P.si)) continue;
        c.fought = false;
        if (c.wither > 0 && A.chance(clamp(A.ENG.witherFade * (c.rested === day - 1 ? 2 : 1), 0, 1))) { c.wither = 0; if (c.party) A.log('day', `${A.sn(c)}を蝕んでいた衰えが、ようやく抜けた。`, [c.id]); }
        A.fireTrig(c, null, 'day', null);
        if (c.poison && c.poison.day < day) { c.hp = Math.max(1, c.hp - A.ENG.poisonDay); if (c.party) A.log('day', A.ailText('ailPoisonDay', 'poison', c.poison.p, null, c), [c.id]); c.poison = null; }
        const buff = [];
        const fp = c.foe ? (c.powerAdd != null ? c.powerAdd : S.foePower) : 0;
        if (c.foe && fp) buff.push({ id: 'power', mag: fp, params: null, src: '#foe', from: '聖杯の加護' });
        if (c.boss) { if (c.bs.power) buff.push({ id: 'power', mag: c.bs.power, params: null, src: '#boss', from: '特異点の主' }); if (c.bs.guard) buff.push({ id: 'guard', mag: c.bs.guard, params: null, src: '#bossg', from: '特異点の主' }); }
        if (buff.length) c.dayTemp = (c.dayTemp || []).concat(buff);
      }
    }
    function applyCmd(cmd) {
      if (!cmd || !P.masterAlive) return;
      const day = A.day;
      if (cmd.k === 'heal') {
        const c = camps[+cmd.t];
        if (!c || !c.party || !c.alive || P.cs < 1 || c.hp >= 100) return;
        P.cs--; c.hp = 100; c.wither = 0; c.poison = null; A.bondUp(c, 3);
        P.cmdLog.push({ day, k: 'heal', t: c.id });
        A.log('cs', `「令呪をもって命ずる——癒えよ」${A.mn(c)}の令呪が輝き、${A.sn(c)}の霊基が満ちた。（残り${P.cs}画）`, [c.id], { big: true });
      } else if (cmd.k === 'mana') {
        if (P.cs < 1 || P.mana >= P.manaMax) return;
        P.cs--; P.mana = P.manaMax;
        P.cmdLog.push({ day, k: 'mana' });
        A.log('cs', `「令呪をもって命ずる——満ちよ」令呪一画が魔力に変わり、蓄えが満たされた。（残り${P.cs}画）`, alive(party).map(c => c.id).slice(0, 1), { big: true });
      } else if (cmd.k === 'guess') {
        const t = camps[+cmd.t];
        if (!t || t.party || t === stray || !t.alive || !P.seen.has(t.id) || A.known(t) || P.guessDay === day) return;
        P.guessDay = day;
        const g = find(cmd.sv);
        P.cmdLog.push({ day, k: 'guess', t: t.id, sv: cmd.sv });
        if (g && g.id === t.sv.id) {
          for (const c of party) c.knowName.add(t.id);
          A.log('scout', `${A.mn(party[0])}は${t.label}の正体を言い当てた——「${t.sv.trueName}」。真名を知った英霊たちの刃が鋭くなる。`, [party[0].id, t.id], { big: true });
        } else {
          A.clue(party[0], t, 1);
          A.log('scout', `${t.label}は「${g ? g.trueName : '？'}」ではないようだ。推理は外れた。`, [party[0].id, t.id]);
        }
      }
    }

    // ---------- 作戦会議 ----------
    function* council() {
      const you = party[0], day = A.day;
      const opts2 = [];
      const unk = foesAlive().concat(P.stage === 'boss' && bossNow() && bossNow().alive ? [bossNow()] : []).filter(t => P.seen.has(t.id) && !A.known(t));
      if (unk.length) {
        const t = unk.reduce((a, b) => ((shared.clues[a.id] || 0) >= (shared.clues[b.id] || 0) ? a : b)), k = shared.clues[t.id] || 0, p = deduce(t);
        opts2.push({ k: 'deduce:' + t.id, label: `${t.label}の真名を推理する`, sub: `手がかり${k}個・見込みは${p >= 0.6 ? '高い' : p >= 0.35 ? '五分' : '低い'}` });
      }
      opts2.push({ k: 'recover', label: '霊脈で力を蓄える', sub: '魔力と霊基を大きく回復する。今日は探索しない' });
      if (P.stage === 'hunt' && P.lead == null && P.mana >= 30 && findable().length) opts2.push({ k: 'familiar', label: '使い魔を放って敵を探す', sub: '魔力を使う。見つかるとは限らない' });
      const fr = frontAlive(), res = reserveAlive();
      const swap = fr.length && res.length ? (() => { const w = fr.reduce((a, b) => (a.hp <= b.hp ? a : b)), s = res.reduce((a, b) => (a.hp >= b.hp ? a : b)); return w.hp < 50 && s.hp > w.hp + 20 ? [w, s] : null; })() : null;
      if (swap) opts2.push({ k: 'swap', label: `前衛の${A.sn(swap[0])}を下げ、${A.sn(swap[1])}を前に出す`, sub: '傷の深い英霊を控えに回す' });
      const k = yield* A.ask(you, 'council', {
        title: `${day}日目、作戦会議`,
        body: `魔力 ${Math.round(P.mana / P.manaMax * 100)}%・令呪 ${P.cs}画・${curStage().name}・倒した敵 ${P.slain}騎。残り${maxDays - day + 1}日。`,
        options: opts2.slice(0, 3).concat([{ k: 'pass', label: '今は動かない', sub: '方針のとおりに過ごす' }]),
      }, () => {
        const avg = hpOf(alive(party));
        if (swap) return 'swap';
        if (avg < 55 || P.mana < P.manaMax * 0.35) return 'recover';
        if (unk.length && (shared.clues[unk[0].id] || 0) >= 2) return 'deduce:' + unk.reduce((a, b) => ((shared.clues[a.id] || 0) >= (shared.clues[b.id] || 0) ? a : b)).id;
        return opts2.some(o => o.k === 'familiar') ? 'familiar' : 'pass';
      });
      if (k.startsWith('deduce:')) {
        const t = camps[+k.split(':')[1]];
        if (!t) return;
        if (A.chance(deduce(t))) { for (const c of party) c.knowName.add(t.id); A.log('scout', `これまでの手がかりを突き合わせ、${A.mn(you)}は${t.label}の真名にたどり着いた——「${t.sv.trueName}」。`, [you.id, t.id], { big: true }); }
        else { A.clue(you, t, 1); A.log('council', `${t.label}の真名を推理したが、決め手に欠けた。`, [you.id, t.id]); }
      } else if (k === 'recover') {
        P.mana = Math.min(P.manaMax, P.mana + P.manaMax * 0.5);
        for (const c of alive(party)) c.hp = Math.min(100, c.hp + 25);
        P.mhp = Math.min(P.mhpMax, P.mhp + 15);
        P.restDay = day;
        A.log('council', '一行は霊脈の上で力を蓄えた。今日は動かない。', alive(party).map(c => c.id).slice(0, 1));
      } else if (k === 'familiar') {
        P.mana -= 30;
        const t = A.pick(findable());
        if (t && A.chance(clamp(0.45 + partyIntel() + A.md(you, 'craft') * 0.1 - A.eff(t, 'stealth') * 0.5, 0.1, 0.9))) { P.lead = t.id; A.clue(you, t, 1); A.log('scout', `放った使い魔が、${t.label}の居場所を突き止めた。`, [you.id, t.id]); }
        else A.log('council', '使い魔は手がかりを持ち帰れなかった。', [you.id]);
      } else if (k === 'swap' && swap) {
        const [w, s] = swap; P.front = P.front.map(i => (i === w.id ? s.id : i));
        A.log('council', `${A.sn(w)}を控えに下げ、${A.sn(s)}が前衛に立った。`, [w.id, s.id]);
      }
    }
    function deduce(t) { return Math.max(...alive(party).map(c => A.deduceP(c, t)), 0.03); }

    // ---------- 前衛 ----------
    function fillFront() {
      P.front = P.front.filter(i => camps[i].alive);
      for (const c of party) {
        if (P.front.length >= S.front) break;
        if (c.alive && !P.front.includes(c.id)) { P.front.push(c.id); A.log('event', A.line('ogFront', { S: A.nm(c) }), [c.id]); }
      }
    }
    const chooseMain = fr => fr.reduce((a, b) => ((b.sv.power + b.sv.npPeak * 0.3) * (0.4 + 0.6 * b.hp / 100) > (a.sv.power + a.sv.npPeak * 0.3) * (0.4 + 0.6 * a.hp / 100) ? b : a));

    // ---------- 全滅 ----------
    function* checkWipe() {
      if (P.wiped || P.masterDead || party.some(c => c.alive)) return;
      if (P.cs >= S.csWipe && P.masterAlive) {
        const k = yield* A.ask(party[0], 'wipe', {
          title: 'パーティーが全滅した',
          body: `${party.length}騎の英霊がすべて倒れた。令呪は残り${P.cs}画。`,
          options: [
            { k: 'revive', label: `令呪${S.csWipe}画で全員を呼び戻す`, sub: '英霊たちの霊基を組み直し、魔力も満たす' },
            { k: 'give', label: '諦める', sub: '人理修復はここで終わる' },
          ],
        }, () => 'revive');
        if (k === 'revive') {
          P.cs -= S.csWipe; P.revived++;
          for (const c of party) { c.alive = true; c.out = false; c.fate = null; c.hp = 100; c.wither = 0; c.witherSelf = 0; c.poison = null; c.dayTemp = null; }
          P.mana = P.manaMax;
          P.front = P.front0.slice();
          A.log('cs', A.line('ogRevive', { n: P.cs }), party.map(c => c.id), { big: true });
          return;
        }
      }
      P.wiped = true;
      A.log('death', A.line('ogWiped', { M: A.mn(party[0]) }), party.map(c => c.id), { big: true });
    }

    // ---------- 遭遇と戦い ----------
    function meetFirst(g) {
      if (P.seen.has(g.id)) return;
      P.seen.add(g.id);
      if (g.boss) return;
      const k = `@e:${g.key}:intro`;
      A.log('event', has(k) ? A.line(k, { T: g.label, S: A.sn(g), M: A.mn(party[0]) }) : A.line('sgFirst', { T: g.label }), [g.id].concat(frontAlive().map(c => c.id).slice(0, 1)), { big: true, quote: A.say(g, ['開始', '召喚']) });
    }
    function* engage(group, how) {
      for (const g of group) { if (g.meet === 'day') g.appeared = true; meetFirst(g); }
      const F = P.today;
      for (let bout = 1; bout <= S.maxBouts; bout++) {
        fillFront();
        const fr = frontAlive(), en = group.filter(c => c.alive);
        if (!fr.length || !en.length) break;
        const me = chooseMain(fr), foe = en[0];
        const strayBack = strayReady() && stray.guard === 'noBattle';   // 戦いに加わらないはぐれは、控えと同じく後ろから支える
        const helpP = fr.filter(x => x !== me).concat(strayReady() && !strayBack && stray.hp >= 30 ? [stray] : []), helpF = en.slice(1);
        const raid = how === 'raid' || how === 'ambush';
        if (bout === 1) {
          if (raid) { const v = clamp(0.12 - Math.max(0, partyDetect()) * 0.15, 0, 0.12); if (v > 0) foe.surprise = (foe.surprise || 0) + v; }
          else if (P.leadHit) me.surprise = (me.surprise || 0) + S.leadEdge;
        }
        const place = P.place;
        const home = how === 'raid' && (P.camp > 0 || F === 'defend') ? me : null;
        const sup = reserveAlive().filter(x => !helpP.includes(x) && x !== me).concat(strayBack ? [stray] : []);
        const strayHp = stray ? stray.hp : 0;
        const ctx = { place, home, terrain: A.tonight.rain ? '水辺' : place.terrain, rain: A.tonight.rain,
          teamK: S.teamBoost, supportK: S.reserveSupport, weak: { ref: mean(party.map(c => c.sv.power)), bonus: S.weakBonus, min: S.weakMin, max: S.weakMax },
          lines: A.phase === 'night' ? null : { clash: 'sgClashDay', retreat: 'sgRetreatDay', dawn: 'sgDawnDay' } };
        if (raid) yield* A.battle(foe, me, Object.assign(ctx, { helpA: helpF, helpB: helpP, supportB: sup }));
        else yield* A.battle(me, foe, Object.assign(ctx, { helpA: helpP, helpB: helpF, supportA: sup }));
        if (stray && stray.nodmg && stray.alive && stray.hp < strayHp) stray.hp = strayHp;   // 傷を負わないはぐれ（宝具の反動など、戦いの外から来る傷も残さない）
        for (const c of [me, foe].concat(helpP, helpF)) if (c.alive) c.fought = true;
        yield* checkWipe();
        if (over()) break;
        const fr2 = frontAlive().concat(reserveAlive()), en2 = group.filter(c => c.alive);
        if (!fr2.length || !en2.length) break;
        if (me.alive && foe.alive) break;
        const p = S.pressOn + (F === 'advance' ? 0.2 : 0) - (F === 'stealth' ? 0.3 : 0) + (raid ? 0.15 : 0);
        if (!A.chance(clamp(p, 0.05, 0.95))) break;
        A.log('battle', A.line('sgPress', { T: A.nm(en2[0]) }), [en2[0].id]);
      }
      P.leadHit = false;
      P.fought = true;
    }
    // 出会った敵の顔ぶれ：狙った一騎に、ときどき同じ節の一〜二騎が加わる（加われるのは同じく出会える敵だけ）
    function groupWith(t, pool) {
      const g = [t], rest = pool.filter(c => c !== t);
      if (rest.length && A.chance(S.group2 + S.group3)) {
        const x = A.pick(rest); g.push(x);
        const r2 = rest.filter(c => c !== x);
        if (r2.length && A.chance(S.group3 / Math.max(1e-9, S.group2 + S.group3))) g.push(A.pick(r2));
      }
      return g;
    }

    // ---------- 節とボス ----------
    function* bossAppears() {
      const boss = bossNow();
      P.stage = 'boss'; P.lead = null;
      if (!boss) return;
      if (boss.revealed) A.pubName.add(boss.id);
      P.seen.add(boss.id);
      const k = `@b:${P.si}:intro`, V = { B: A.sn(boss), T: boss.label, M: A.mn(party[0]), stage: curStage().name };
      const intro = has(k) ? A.line(k, V) : boss.sv.boss && boss.sv.boss.intro && boss.revealed ? boss.sv.boss.intro : A.line('ogBossIntro', V);
      const pre = foes.some(c => c.stage === P.si) ? A.line('ogBossAppear', { stage: curStage().name }) : '';
      A.log('event', pre + intro, [boss.id], { big: true, head: true, quote: A.say(boss, ['開始', '召喚']) });
    }
    function startStage() {
      const st = curStage(), V = { n: P.si + 1, stage: st.name, M: A.mn(party[0]) };
      P.stage = 'hunt'; P.stageDay = A.day; P.lead = null;
      P.places = placesOf(P.si);
      if (n.stages.length > 1 || st.intro.length) A.log('prologue', A.line('ogStage', V), [], { head: true });
      if (has(`@st:${P.si}:intro`)) A.log('event', A.line(`@st:${P.si}:intro`, V), alive(party).map(c => c.id).slice(0, 1), { big: true });
    }
    // 節の敵が尽きたらボス、ボスが倒れたら次の節（最後の節なら修復の成功）
    function* progress() {
      for (let guard = 0; guard < n.stages.length * 2 + 2 && !over(); guard++) {
        if (P.stage === 'hunt') {
          if (foesAlive().length) return;
          if (bossNow() && bossNow().alive) { yield* bossAppears(); return; }
        } else if (bossNow() && bossNow().alive) return;
        // この節を越えた
        const st = curStage(), V = { n: P.si + 1, stage: st.name, M: A.mn(party[0]) };
        const last = P.si >= n.stages.length - 1;
        if (has(`@st:${P.si}:clear`)) A.log('event', A.line(`@st:${P.si}:clear`, V), alive(party).map(c => c.id).slice(0, 1), { big: true });
        else if (!last) A.log('event', A.line('ogStageClear', V), alive(party).map(c => c.id).slice(0, 1));
        if (last) { P.cleared = true; return; }
        P.si++;
        startStage();
      }
    }

    // ---------- 昼 ----------
    function decideFocus() {
      if (P.focus !== 'auto') return P.focus;
      const xs = alive(party), fr = frontAlive();
      const hp = hpOf(fr.length ? fr : xs), manaR = P.mana / P.manaMax;
      if (P.stage === 'boss') return hp < 60 || manaR < 0.4 ? 'rest' : 'advance';
      if (hp < 45 || manaR < 0.25) return 'rest';
      if (P.lead != null) return 'advance';
      if (!findable().length) return hp < 70 ? 'rest' : 'defend';   // 探しても見つからない敵ばかり：待ち構える
      return A.day % 3 === 0 ? 'advance' : 'search';
    }
    // 決まった日に現れる敵（休息や陣地の日でも、向こうから現れる）
    function* arrivals() {
      for (const c of foesAlive()) {
        if (over() || P.fought) return;
        if (c.meet !== 'day' || c.appeared || !(A.day >= c.day)) continue;
        c.appeared = true;
        yield* engage(groupWith(c, []), 'meet');
      }
    }
    function* dayPhase() {
      const F = P.today;
      A.phase = 'day';
      if (P.restDay === A.day) return;
      if (F === 'rest') {
        for (const c of alive(party)) { c.hp = Math.min(100, c.hp + S.restHeal + A.eff(c, 'regen') * A.ENG.regenHeal); c.rested = A.day; }
        P.mhp = Math.min(P.mhpMax, P.mhp + 15); P.rested = true;
        A.log('day', A.line('sgRest', { M: A.mn(party[0]) }), alive(party).map(c => c.id).slice(0, 1));
        return;
      }
      if (F === 'defend') {
        P.camp = Math.min(5, P.camp + 1);
        A.log('day', A.line('sgCamp', { M: A.mn(party[0]) }) + `（陣地 ${P.camp}）`, alive(party).map(c => c.id).slice(0, 1));
        if (A.chance(0.4)) yield* eventRoll(F, true);
        return;
      }
      const prev = P.place, pl = P.places.filter(p => p.name !== (prev && prev.name));
      P.place = pl.length ? A.pick(pl) : P.places[0];
      P.camp = 0;
      A.log('day', A.line('ogMove', { place: P.place.name, M: A.mn(party[0]) }), alive(party).map(c => c.id).slice(0, 1), { place: P.place.name, scene: P.place.scene });
      const ev = yield* eventRoll(F, true);
      if (over() || P.fought) return;
      if (P.stage === 'boss') {
        const boss = bossNow();
        if (!boss || !boss.alive) return;
        if (A.chance(clamp((boss.bs.find || S.boss.find) + (S.focusEnc[F] || 0), 0.05, 0.98))) yield* engage([boss], 'boss');
        else A.log('day', A.line('ogBossFar', { B: A.sn(boss) }), alive(party).map(c => c.id).slice(0, 1));
        return;
      }
      const live = findable();
      if (!live.length) { if (!ev) A.log('day', A.line('sgQuiet'), []); return; }
      if (P.lead == null || !camps[P.lead].alive || !live.includes(camps[P.lead])) {
        P.lead = null;
        const t = A.pick(live);
        const scout = alive(party).reduce((a, b) => (A.eff(b, 'detect') > A.eff(a, 'detect') ? b : a));
        const p = clamp(S.searchBase + Math.max(0, partyDetect()) * S.detectK + Math.max(0, partyIntel()) * S.intelK + A.md(party[0], 'craft') * 0.05
          + (F === 'search' ? S.searchFocus : F === 'advance' ? 0.05 : F === 'stealth' ? -0.05 : 0) - Math.max(0, A.eff(t, 'stealth')) * 0.4, 0.05, 0.92);
        if (A.chance(p)) { P.lead = t.id; A.clue(party[0], t, 1); A.log('scout', A.line('sgTrace', { S: A.sn(scout), T: t.label }), [scout.id, t.id]); }
        else if (F === 'search') A.log('day', A.line('sgTraceFail', { S: A.sn(scout) }), [scout.id]);
      }
      const pE = clamp(S.encBase + (P.lead != null ? S.leadBonus : 0) + (S.focusEnc[F] || 0), 0.02, 0.95);
      if (A.chance(pE)) {
        const t = P.lead != null ? camps[P.lead] : A.pick(live);
        P.leadHit = P.lead != null; P.lead = null;
        yield* engage(groupWith(t, live), 'meet');
        return;
      }
      if (!ev) A.log('day', A.line('sgQuiet'), []);
    }

    // ---------- 出来事 ----------
    // 自作の出来事が起きる条件（日を決めたものは、その日の朝に別に起きる）
    function evOk(ev) {
      const d = A.day;
      if (ev.once && P.evDone.has(ev.id)) return false;
      if (ev.from != null && d < ev.from) return false;
      if (ev.to != null && d > ev.to) return false;
      if (ev.stage != null && P.si !== ev.stage - 1) return false;
      if (ev.after) { const xs = foes.filter(c => c.key === ev.after); if (!xs.length || xs.some(c => c.alive)) return false; }
      return true;
    }
    function* eventRoll(F, silent) {
      if (!A.chance(S.eventChance)) { if (!silent) A.log('day', A.line('sgQuiet'), []); return false; }
      const mit = mitigation(F);
      const W = S.eventW, w = {};
      const strayOk = stray && !P.strayJoined && !P.strayAsked && n.stray.appear === 'random' && A.day > (n.stray.after != null ? n.stray.after : S.strayAfter);
      if (n.events.defaults) {
        const good = { leyline: 1.2, locals: 1, supplies: 0.9, relic: 0.8, spring: 1, omen: 0.7, talk: 0.9 };
        if (strayOk) good.stray = 1.2;
        const bad = { trap: 1, miasma: 1, disturb: 0.8, curse: 0.8, masterHurt: 0.45, lost: 0.5, storm: 0.6, hunted: 0.7, refugee: 0.7 };
        if (raiders().length && P.stage === 'hunt') bad.ambush = 0.9;
        const gt = Object.values(good).reduce((t, x) => t + x, 0), bt = Object.values(bad).reduce((t, x) => t + x, 0);
        for (const k in good) w['g:' + k] = W.good * good[k] / gt;
        for (const k in bad) w['b:' + k] = W.bad * (1 - mit) * bad[k] / bt;
        w['m:mob'] = W.mob * (1 - mit);
        w['s:scene'] = W.scene;
      } else if (strayOk) w['g:stray'] = W.good * 0.15;
      n.events.list.forEach((ev, i) => { if (ev.day == null && ev.weight > 0 && evOk(ev)) w['c:' + i] = ev.weight; });
      if (!Object.keys(w).length) { if (!silent) A.log('day', A.line('sgQuiet'), []); return false; }
      const k = A.wpick(w);
      if (k.startsWith('c:')) { yield* fireEvent(n.events.list[+k.slice(2)]); return true; }
      const ids = alive(party).map(c => c.id);
      const any = () => A.pick(alive(party));
      const V = { M: A.mn(party[0]) };
      if (k === 'g:leyline') { P.mana = Math.min(P.manaMax, P.mana + Math.round(P.manaMax * 0.35)); A.log('event', A.line('sgLeyline', V), ids.slice(0, 1)); }
      else if (k === 'g:locals') {
        for (const c of alive(party)) c.hp = Math.min(100, c.hp + 15);
        const live = findable();
        if (live.length && A.chance(0.5)) { const t = A.pick(live); P.lead = t.id; A.clue(party[0], t, 1); A.log('event', A.line('sgLocals', V) + `${t.label}の目撃談を聞けた。`, ids.slice(0, 1).concat([t.id])); }
        else A.log('event', A.line('sgLocals', V), ids.slice(0, 1));
      } else if (k === 'g:supplies') { P.items = Math.min(3, P.items + 1); A.log('event', A.line('sgSupplies', V) + `（道具 ${P.items}）`, ids.slice(0, 1)); }
      else if (k === 'g:relic') {
        const cand = foesAlive().filter(t => shown(t) && !A.known(t)), c = any();
        if (cand.length) { const t = A.pick(cand); A.clue(party[0], t, 2); P.seen.add(t.id); A.log('scout', A.line('sgRelic', Object.assign({ S: A.sn(c) }, V)) + `${t.label}の正体に近づいた。`, [c.id, t.id]); }
        else A.log('event', A.line('sgScene', Object.assign({ S: A.sn(c) }, V)), [c.id]);
      } else if (k === 'g:spring') { for (const c of alive(party)) c.hp = Math.min(100, c.hp + 20); P.mhp = Math.min(P.mhpMax, P.mhp + 15); A.log('event', A.line('sgSpring', V), ids.slice(0, 1)); }
      else if (k === 'g:stray') yield* strayEvent();
      else if (k === 'b:trap') {
        const c = any(); const d = (15 + A.rnd() * 15) * clamp(1 - A.sd(c, 'luk') * 0.2 - Math.max(0, A.eff(c, 'luck')), 0.4, 1.3);
        c.hp = Math.max(1, c.hp - d); A.log('event', A.line('sgTrap', { S: A.sn(c) }), [c.id]);
      } else if (k === 'b:miasma') { for (const c of alive(party)) c.hp = Math.max(1, c.hp - (6 + A.rnd() * 6) * clamp(1 - A.sd(c, 'end') * 0.2, 0.5, 1.3)); A.log('event', A.line('sgMiasma', V), ids.slice(0, 1)); }
      else if (k === 'b:disturb') { P.mana = Math.max(0, P.mana - Math.round(P.manaMax * 0.15)); A.log('event', A.line('sgDisturb', V), ids.slice(0, 1)); }
      else if (k === 'b:curse') { const c = any(); c.dayTemp = (c.dayTemp || []).concat([{ id: 'power', mag: -0.15, params: null, src: '#curse', from: '呪詛' }]); A.log('event', A.line('sgCurse', { S: A.sn(c) }), [c.id]); }
      else if (k === 'b:masterHurt') {
        const [lo, hi] = S.masterHurt;
        P.mhp -= (lo + A.rnd() * (hi - lo)) * clamp(1 - A.md(party[0], 'body') * 0.25, 0.5, 1.3);
        A.log('event', A.line('sgMasterHurt', V), ids.slice(0, 1));
        if (P.mhp <= 0) A.masterDown(party[0], `${A.day}日目、特異点の歪みに巻き込まれた`);
      } else if (k === 'b:lost') A.log('event', A.line('sgLost', V), ids.slice(0, 1));
      else if (k === 'b:ambush') {
        const live = raiders(), t = A.pick(live);
        A.log('event', A.line('sgAmbush', { T: t.label }), ids.slice(0, 1).concat([t.id]), { big: true });
        yield* engage(groupWith(t, live), 'ambush');
      } else if (k === 'm:mob') mob(A.pick(G.SING_DATA.MOBS));
      else if (k === 'g:omen') {
        const live = findable();
        if (live.length) { const t = A.pick(live); P.lead = t.id; A.clue(party[0], t, 1); A.log('scout', A.line('sgOmen', Object.assign({ T: t.label }, V)), ids.slice(0, 1).concat([t.id])); }
        else A.log('event', A.line('sgScene', Object.assign({ S: A.sn(any()) }, V)), ids.slice(0, 1));
      } else if (k === 'g:talk') {
        const c = any(); for (const x of alive(party)) { A.bondUp(x, 3); x.hp = Math.min(100, x.hp + 5); }
        A.log('life', A.line('sgTalk', Object.assign({ S: A.sn(c) }, V)), [c.id], { quote: A.say(c, ['会話', '絆']) });
      } else if (k === 'b:storm') { A.tonight.rain = true; P.mana = Math.max(0, P.mana - Math.round(P.manaMax * 0.05)); A.log('event', A.line('sgStorm', V), ids.slice(0, 1)); }
      else if (k === 'b:hunted') { P.hunted = A.day; A.log('event', A.line('sgHunted', V), ids.slice(0, 1)); }
      else if (k === 'b:refugee') {
        const fr = frontAlive(); for (const c of fr) { c.hp = Math.max(1, c.hp - 8); A.bondUp(c, 3); }
        A.log('event', A.line('sgRefugee', Object.assign({ S: A.sn(fr[0] || any()) }, V)), fr.map(c => c.id));
      } else { const c = any(); A.log('life', A.line('sgScene', Object.assign({ S: A.sn(c) }, V)), [c.id]); }
      return true;
    }
    // 雑魚との小競り合い（戦闘にはならない）
    function mob(name) {
      const fr = frontAlive().length ? frontAlive() : alive(party);
      if (!fr.length) return;
      for (const c of fr) c.hp = Math.max(1, c.hp - S.mobDmg * (0.5 + A.rnd()) * clamp(1.3 - c.sv.power / 60, 0.3, 1.2));
      P.mana = Math.max(0, P.mana - S.mobMana);
      const lead = fr.reduce((a, b) => (b.sv.power > a.sv.power ? b : a));
      A.log('event', A.line('sgMob', { mob: name, S: A.sn(lead) }), fr.map(c => c.id));
    }
    // 自作の出来事：文を書き、効果を働かせ、選択肢があれば問う
    function* fireEvent(ev) {
      P.evDone.add(ev.id);
      const any = alive(party).length ? A.pick(alive(party)) : party[0];
      const V = Object.assign(V0(), { S: A.sn(any) });
      const ids = alive(party).map(c => c.id).slice(0, 1);
      const text = has('@ev:' + ev.id) ? A.line('@ev:' + ev.id, V) : '';
      if (text) A.log('event', text, ids, { big: !!ev.choices.length });
      yield* effects(ev.effects);
      if (over() || !ev.choices.length) return;
      const k = yield* A.ask(party[0], 'oevent', {
        title: ev.title || '出来事',
        body: text || ev.title || '',
        options: ev.choices.map((c, i) => ({ k: 'c' + i, label: c.label, sub: c.sub })),
      }, () => 'c' + ev.auto);
      const i = Math.max(0, Math.min(ev.choices.length - 1, +String(k).slice(1) || 0));
      const ch = ev.choices[i];
      if (has(`@ev:${ev.id}:${i}`)) A.log('event', A.line(`@ev:${ev.id}:${i}`, V), ids);
      yield* effects(ch.effects);
    }
    function enemyOf(key) {
      const live = foesAlive().concat(P.stage === 'boss' && bossNow() && bossNow().alive ? [bossNow()] : []);
      if (!key) return live.length ? A.pick(live.filter(c => !c.boss).length ? live.filter(c => !c.boss) : live) : null;
      return foes.find(c => c.key === key && c.alive) || null;
    }
    function* effects(list) {
      for (const x of list || []) {
        if (over()) return;
        const who = x.target === 'front' ? frontAlive() : x.target === 'one' ? (alive(party).length ? [A.pick(alive(party))] : []) : alive(party);
        const a = +x.amount || 0;
        if (x.type === 'heal') for (const c of who) c.hp = clamp(c.hp + a, 1, 100);
        else if (x.type === 'damage') for (const c of who) c.hp = clamp(c.hp - a, 1, 100);
        else if (x.type === 'mana') P.mana = clamp(P.mana + P.manaMax * a / 100, 0, P.manaMax);
        else if (x.type === 'masterHp') { P.mhp = Math.min(P.mhpMax, P.mhp + a); if (P.mhp <= 0) A.masterDown(party[0], `${A.day}日目、特異点で命を落とした`); }
        else if (x.type === 'cs') P.cs = clamp(P.cs + Math.round(a), 0, Math.max(S.csMax, P.cs));
        else if (x.type === 'item') P.items = clamp(P.items + Math.round(a), 0, 3);
        else if (x.type === 'bond') for (const c of alive(party)) A.bondUp(c, a);
        else if (x.type === 'camp') P.camp = clamp(P.camp + Math.round(a), 0, 5);
        else if (x.type === 'power') for (const c of who) c.dayTemp = (c.dayTemp || []).concat([{ id: 'power', mag: a, params: null, src: '#oev', from: '出来事' }]);
        else if (x.type === 'clue' || x.type === 'lead' || x.type === 'reveal') {
          const t = enemyOf(x.enemy); if (!t) continue;
          if (x.type === 'clue') { A.clue(party[0], t, Math.max(1, Math.round(a))); P.seen.add(t.id); }
          else if (x.type === 'lead') { if (!t.boss) { if (t.meet === 'day') t.appeared = true; P.lead = t.id; } }
          else { for (const c of party) c.knowName.add(t.id); P.seen.add(t.id); A.log('scout', `${t.label}の真名が明らかになった——「${t.sv.trueName}」。`, [party[0].id, t.id], { big: true }); }
        } else if (x.type === 'battle') {
          const t = enemyOf(x.enemy); if (!t) continue;
          yield* engage([t], t.boss ? 'boss' : 'meet');
        } else if (x.type === 'mob') mob(x.name || A.pick(G.SING_DATA.MOBS));
        else if (x.type === 'stray') { if (stray && !P.strayAsked && !P.strayJoined) yield* strayEvent(); }
      }
    }
    function* strayEvent() {
      P.strayAsked = true;
      const c = stray, V = { T: c.label, M: A.mn(party[0]) };
      A.log('event', has('@s:intro') ? A.line('@s:intro', V) : A.line('ogStrayMeet', V), [c.id], { big: true, quote: A.say(c, ['召喚', '会話']) });
      const k = yield* A.ask(party[0], 'stray', {
        title: 'はぐれサーヴァント',
        body: `${c.label}が力を貸すと言っている。契約はできないが、戦いに加わってくれる。`,
        options: [{ k: 'yes', label: '共に戦う', sub: { noBattle: '魔力は使わない。戦いには加わらず、後ろから支えてくれる', noDamage: '魔力は使わない。加勢の力は控えめだが、傷を負わない', noTarget: '魔力は使わない。加勢の力は控えめだが、敵の攻撃の的にならない' }[c.guard] || '魔力は使わないが、加勢の力は控えめ' }, { k: 'no', label: '断る', sub: `${party.length}騎だけで進む` }],
      }, () => 'yes');
      if (k === 'yes') { P.strayJoined = true; c.knowName.add(party[0].id); for (const x of party) x.knowName.add(c.id); A.log('ally', A.line('ogStrayJoin', { T: A.nm(c) }), [c.id], { big: true }); }
      else A.log('event', A.line('ogStrayLeave', { T: c.label }), [c.id]);
    }

    // ---------- 夜 ----------
    function* nightPhase() {
      A.phase = 'night';
      const F = P.today;
      if (P.stage !== 'hunt') return;
      const live = raiders(); if (!live.length) return;
      const mit = mitigation(F);
      // 探しても見つからない敵しかいない節では、向こうから来やすい
      const only = !findable().length ? 0.15 : 0;
      let p = S.raidBase + only + S.raidPerFoe * live.length - mit * S.raidStealth + (F === 'advance' ? 0.05 : 0) + (F === 'stealth' ? -0.08 : 0) + (P.hunted === A.day ? 0.25 : 0) - (F === 'rest' || P.restDay === A.day ? S.restRaid : 0) - (F === 'defend' ? S.restRaid * (1 + P.camp * 0.5) : 0);
      if (P.fought) p *= 0.5;
      if (!A.chance(clamp(p, 0.02, 0.6))) return;
      const h = A.pick(live);
      if (A.chance(clamp(Math.max(0, partyDetect()) * 0.3, 0, 0.4))) { A.log('night', A.line('sgRaidHide'), [h.id]); return; }
      A.log('night', A.line('sgRaid', { T: A.nm(h) }), [h.id].concat(alive(party).map(c => c.id).slice(0, 1)), { big: true });
      const am = A.eff(h, 'anti_master');
      if (am > 0 && A.chance(Math.min(0.5, am * S.ambushMaster))) {
        const guard = Math.max(0, partyDetect()) * 0.5 + P.camp * 0.06 + A.md(party[0], 'luck') * 0.1 + Math.max(...alive(party).map(c => A.eff(c, 'master_guard')), 0);
        if (A.chance(clamp(guard, 0, 0.85))) A.log('battle', `${A.mn(party[0])}を狙った刃は、英霊たちに阻まれた。`, [h.id].concat(alive(party).map(c => c.id).slice(0, 1)));
        else {
          P.mhp -= 30 + A.rnd() * 50 - P.master.stats.body * 0.3;
          if (P.mhp <= 0) { A.masterDown(party[0], `${A.day}日目の夜、${A.nm(h)}の奇襲だった`, h); return; }
          A.log('battle', `${A.nm(h)}の刃が${A.mn(party[0])}に届いた。深手だ。`, [h.id, party[0].id], { big: true });
        }
      }
      yield* engage(groupWith(h, live), 'raid');
    }

    // ---------- 夜明け前 ----------
    function upkeep() {
      const xs = alive(party);
      const spirit = P.today === 'rest' || P.today === 'stealth' || P.restDay === A.day;
      const cost = xs.reduce((t, c) => t + A.ENG.upkeep * A.upk(c) * (spirit ? A.ENG.spiritSave : 1) + (c.sv.nps || []).reduce((s, np) => s + (np.mode === 'always' && !np.disabled ? A.npCostOf(c, np) * A.ENG.npAlwaysUpkeep : 0), 0), 0);
      const regen = (A.ENG.manaRegen + P.master.stats.mana * 0.15) * xs.length * S.regenK + xs.reduce((t, c) => t + Math.max(0, A.eff(c, 'resource')) * 10, 0);
      P.mana = Math.min(P.manaMax, P.mana + regen) - cost;
      if (P.mana < 0) plugin.hooks.drain(party[0]);
      P.mhp = Math.min(P.mhpMax, P.mhp + 5);
      for (const c of xs) c.hp = Math.min(100, c.hp + S.dailyHeal + (spirit ? 0 : Math.max(0, A.eff(c, 'regen')) * 10));
      for (const c of foesAlive()) { c.hp = Math.min(100, c.hp + S.foeHeal); c.mana = Math.min(c.manaMax, c.mana + S.foeRegen); }
      const boss = bossNow();
      if (boss && boss.alive && P.stage === 'boss') { boss.hp = Math.min(100, boss.hp + (boss.bs.heal || 0)); boss.mana = Math.min(boss.manaMax, boss.mana + (boss.bs.regen || S.boss.regen)); }
      if (strayReady()) { stray.hp = Math.min(100, stray.hp + S.dailyHeal); stray.mana = Math.min(stray.manaMax, stray.mana + S.strayRegen); }
    }
    function cleanDay() {
      for (const c of camps) { c.temp = []; c.npBoost = 0; c.bx = null; c.ail = null; c.armed = null; c.off = null; c.cleanse = 0; c.tUsed = null; c.tLog = null; c.autoUsed = null; c.autoQ = null; c.surprise = 0; }
    }

    // ---------- 本編 ----------
    function* main() {
      const you = party[0], V = Object.assign(V0(), { M: A.mn(you) });
      A.day = 0; A.phase = 'prologue';
      A.log('prologue', A.line('ogTitle', V), [], { head: true });
      A.log('prologue', A.line('sgIntro', V), []);
      A.log('prologue', A.line('sgArrive', V), party.map(c => c.id).slice(0, 1));
      for (const c of party) A.log('summon', A.line('ogSummon', { S: A.nm(c) }), [c.id], { quote: A.say(c, ['召喚']) });
      A.log('summon', A.line('ogFormation', { front: frontAlive().map(A.sn).join('・'), reserve: reserveAlive().map(A.sn).join('・') || 'なし', days: maxDays }), P.front.slice());
      Object.assign(A.out, { orig: { title: n.title, city: L.city, days: maxDays, stages: n.stages.map(s => s.name) } });
      for (const c of camps) Object.assign(A.out.meta[c.id], c.guard ? { guard: c.guard } : {}, { side: c.side, label: c.label, servantId: c.sv.id, stage: c.stage != null ? c.stage : null, key: c.key || null, meet: c.meet || null, master: c.party ? { name: P.master.name, sex: P.master.sex, age: P.master.age, origin: P.master.origin, originLabel: P.master.originLabel, persona: P.master.persona, skills: P.master.skills, traits: P.master.traits, catalyst: P.master.catalyst, wish: P.master.wish, stats: Object.fromEntries(Object.entries(P.master.stats).map(([k, v]) => [k, Math.round(v)])), hpMax: P.mhpMax, manaMax: P.manaMax } : null });
      A.day = 1;
      startStage();

      let day = 0;
      for (day = 1; day <= maxDays; day++) {
        A.day = day; A.phase = 'day'; A.tonight = {};
        const ans = yield { type: 'tick', day };
        const f = typeof ans === 'string' ? ans : ans && ans.f;
        P.focus = FOCUS[f] ? f : 'auto';
        P.fought = false; P.rested = false;
        A.log('dayhead', `${day}日目`, [], { head: true });
        // 節の期限
        const st = curStage();
        if (st.days && day - P.stageDay + 1 > st.days) { P.timeout = true; P.stageTimeout = true; break; }
        morning(ans && typeof ans === 'object' ? ans.cmds : null);
        if (over()) break;
        yield* progress();
        if (over()) break;
        // 日の決まった出来事とはぐれ
        for (const ev of n.events.list) {
          if (over()) break;
          if (ev.day === day && evOk(ev) && (ev.chance == null || ev.chance >= 1 || A.chance(ev.chance))) yield* fireEvent(ev);
        }
        if (over()) break;
        if (stray && n.stray.appear === 'day' && n.stray.day === day && !P.strayAsked && !P.strayJoined) yield* strayEvent();
        if (over()) break;
        if (day - P.lastCouncil >= S.councilEvery && P.masterAlive && alive(party).length) { P.lastCouncil = day; yield* council(); }
        if (over()) break;
        P.today = decideFocus();
        if (P.focus === 'auto' && P.today !== 'auto') A.log('day', `今日は「${FOCUS[P.today].label}」で動く。`, [], { auto: true });
        yield* arrivals();
        if (over()) break;
        yield* progress();
        if (over()) break;
        if (!P.fought) yield* dayPhase();
        if (over()) break;
        yield* progress();
        if (over()) break;
        yield* nightPhase();
        if (over()) break;
        yield* progress();
        if (over()) break;
        A.phase = 'night';
        upkeep();
        cleanDay();
        if (P.focus === 'auto' && P.today) P.today = null;
        if (over()) break;
        if (A.chance(A.ENG.lifeChance * 0.5) && alive(party).length) { A.phase = 'night'; const c = A.pick(alive(party)); yield* A.lifeEvent(c); }
      }
      day = Math.min(day, maxDays);
      A.day = day; A.phase = 'end';
      cleanDay();
      // ---------- 結末 ----------
      let ending;
      const boss = bossNow();
      if (P.cleared) {
        ending = 'clear';
        A.log('end', `${day}日目。` + A.line('ogClear', { city: L.city || n.title, name: n.title }), [boss ? boss.id : party[0].id], { big: true, quote: boss ? A.say(boss, ['戦闘不能', '敗北']) : null });
        const al = alive(party);
        A.log('end', A.line('ogClear2', { survivors: al.length ? '最後まで立っていたのは' + al.map(A.sn).join('・') + '。' : '' }), al.map(c => c.id), { big: true, head: true, quote: al.length ? A.say(al[0], ['勝利', '聖杯について']) : null });
      } else if (P.masterDead) {
        ending = 'master';
        A.log('end', A.line('ogFailMaster', {}), party.map(c => c.id), { big: true, head: true });
      } else if (P.wiped) {
        ending = 'wipe';
        A.log('end', A.line('ogFailWipe', {}), party.map(c => c.id), { big: true, head: true });
      } else {
        ending = 'timeout';
        A.log('end', A.line('sgTimeout') + `（${P.stageTimeout ? curStage().name + 'の期限を越えた・' : ''}${curStage().name}まで到達・倒した敵 ${P.slain}騎${P.stage === 'boss' ? '・ボスに至った' : ''}）`, [], { big: true, head: true });
      }
      for (const c of camps) A.pubName.add(c.id);
      A.log('end', A.line(ending === 'clear' ? 'ogFinClear' : ending === 'timeout' ? 'ogFinTimeout' : 'ogFinFail', {}), [], { head: true });
      const sideOf = c => ({ id: c.id, side: c.side, label: c.label, trueName: c.sv.trueName, cls: c.sv.class.label, servantId: c.sv.id, alive: c.alive, hp: Math.round(Math.max(0, c.hp)),
        fate: c.fate, kills: c.kills.map(i => camps[i].sv.trueName), npUses: c.npUses, battles: c.battles, power: r1(c.sv.power), bond: Math.round(c.bond), front: P.front0.includes(c.id),
        stage: c.stage != null ? c.stage : null, key: c.key || null });
      const result = {
        seed: A.seed, name: n.title, city: L.city, days: day, maxDays, ending,
        stages: n.stages.length, stageReached: P.si + 1, stageName: curStage().name, stageTimeout: !!P.stageTimeout,
        slain: P.slain, foes: foes.length, stage: P.stage, cs: P.cs, revived: P.revived, strayJoined: P.strayJoined, master: P.master.name,
        party: party.map(sideOf), enemies: foes.map(sideOf),
        bosses: bosses.filter(Boolean).map(b => Object.assign(sideOf(b), { gauges: b.gauges, gaugeMax: b.gaugeMax, empowered: !!b.empowered })),
        stray: stray ? sideOf(stray) : null, entries: A.entries,
      };
      result.boss = result.bosses.length ? result.bosses[result.bosses.length - 1] : null;   // 最後に立ちはだかったボス（画面の要約用）
      Object.assign(A.out, result);
      return result;
    }
    return plugin;
  }

  /**
   * マスターの設定：シナリオの既定（n.master）に、プレイヤーの設定（pm）を重ねる。空の欄は既定のまま（既定も空なら乱数・ランダム）
   * 戻り値 { name, sex（'男'|'女'|''）, age（10〜99|0）, originLabel, wish, stats: { mana, … }（空の能力は入れない） }
   */
  function masterOf(n, pm) {
    pm = pm || {};
    const d = n.master || {}, v = k => (pm[k] != null && pm[k] !== '' ? pm[k] : d[k]);
    const sex = v('sex'), age = Math.round(+v('age'));
    const stats = {};
    for (const k of ['mana', 'craft', 'body', 'mind', 'luck']) { const x = pm.stats && pm.stats[k] != null && pm.stats[k] !== '' ? pm.stats[k] : d.stats && d.stats[k]; if (x != null && x !== '') stats[k] = x; }
    return { name: String(v('name') || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 20), sex: sex === '男' || sex === '女' ? sex : '', age: age >= 10 && age <= 99 ? age : 0,
      originLabel: String(v('originLabel') || '').trim().slice(0, 30), wish: String(v('wish') || '').trim().slice(0, 60), stats };
  }

  /**
   * オリジナル特異点を始める。opts: { scenario（生のままでも normalize 済みでもよい）, roster, bosses, seed, lineup?, front?, master?（プレイヤーのマスター設定）, ask, out }
   * 整合性チェックに誤りがあれば例外を投げる（画面では先に HGW.scenario.check を見せる）
   */
  function gen(opts) {
    opts = Object.assign({}, opts);
    opts.seed = opts.seed || Math.random().toString(36).slice(2, 8);
    const chk = SC.check(opts.scenario, { roster: opts.roster, bosses: opts.bosses });
    if (chk.errors.length) throw new Error('シナリオに誤りがあります：' + chk.errors.map(e => e.msg).join('／'));
    const n = chk.n;
    // シナリオ専用のサーヴァント（同梱）を名簿とボスに加える。ここから先（顔ぶれ・進行・エンジン）はこの名簿を使う
    const wd = SC.withServants(n, opts.roster, opts.bosses);
    opts.roster = wd.roster; opts.bosses = wd.bosses;
    const lineup = opts.lineup || compose({ scenario: n, roster: opts.roster, bosses: opts.bosses, seed: opts.seed });
    const LN = SC.linesOf(n);
    const plugin = makePlugin(opts, n, lineup, LN);
    const S = settingsOf(n), mo = masterOf(n, opts.master);
    return G.engine.warGen({ roster: opts.roster, seed: opts.seed, ask: opts.ask || 'never', out: opts.out, sing: plugin, lines: LN, engine: { knowNameMult: S.knowNameMult, rallyPower: S.rallyPower },
      playerName: mo.name || undefined, playerSex: mo.sex || undefined, playerAge: mo.age || undefined });
  }
  /** 全自動で最後まで（方針は focus(day) か「おまかせ」、問いはすべておまかせ） */
  function run(opts) {
    const g = gen(Object.assign({}, opts, { ask: opts && opts.ask ? opts.ask : 'never' }));
    let r = g.next();
    while (!r.done) r = g.next(r.value && r.value.type === 'tick' ? (opts && opts.focus ? opts.focus(r.value.day) : 'auto') : 'auto');
    return r.value;
  }

  G.original = { compose, gen, run, settingsOf, masterOf, FOCUS, FOCUS_BY_CODE, SIDE_JA };
})(globalThis.HGW = globalThis.HGW || {});
