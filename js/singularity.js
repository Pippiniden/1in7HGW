/* 特異点攻略（テスト機能）
 *
 * 聖杯戦争のエンジン（engine.js）の戦闘・宝具・効果・記録・判断の仕組みをそのまま使い、日々の進め方と結末だけを差し替える。
 * マスターは六騎のサーヴァント（前衛三騎・控え三騎）を率い、特異点に巣くう七騎の敵サーヴァントを倒す。
 * 七騎をすべて倒すとボスが現れ、それを倒せば人理修復は成功。期限切れ・全滅・マスターの死で失敗。
 *
 *   const L = HGW.singularity.compose({ roster, bosses, seed, picks });   // 特異点の名前と顔ぶれ（始める前に画面に出せる）
 *   const out = {};
 *   const gen = HGW.singularity.gen({ roster, bosses, seed, lineup: L, front: [0, 1, 2], ask: 'big', out, playerName });
 *   let r = gen.next();
 *   while (!r.done) r = r.value.type === 'tick' ? gen.next({ f: 'advance', cmds: [] }) : gen.next(選んだ k);
 *   HGW.singularity.run({ roster, bosses, seed })                         // 全自動（すべておまかせ）
 *
 * tick への答え：方針のキー（FOCUS）か { f: 方針のキー, cmds: [{ k: 'heal', t: 陣営番号 } | { k: 'mana' } | { k: 'guess', t: 敵の陣営番号, sv: サーヴァントの id }] }。
 *   cmds は一時停止中に選んだ令呪・真名の推測で、その日の朝に働く。
 * 判断の種類：cs（消滅寸前に令呪で癒やすか：heal / none）、wipe（全滅：revive / give）、council（作戦会議）、stray（はぐれサーヴァント：yes / no）。
 * 同じシード・同じデータ・同じ顔ぶれ・同じ前衛・同じ選択なら、毎回同じ特異点になる。数値は config.js の SING、文面は singdata.js。
 */
(function (G) {
  'use strict';
  const B = G.build, E = G.effects, R = G.rank;
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const r1 = x => Math.round(x * 10) / 10;

  // 方針（特異点専用）。stance は戦い方（engine.js の battle と同じ：all 全力 / careful 慎重 / retreat すぐ退く）
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

  // ---------- ボスのデータ ----------
  // data/bosses.json（{ format: 'hgw-bosses', bosses: [...] }）の1騎を、ゲームのサーヴァントに組み立てる。
  // ランクは文字列のままでよい。スキル・宝具に effects（効果の配列）を書けば、そのボスだけの手直しとして登録する。
  // 宝具の attack（攻撃宝具か）・mode（発動のしかた）・aoe（全体攻撃の広がり）もここで決められる。
  // 組み立てたボスには bossOnly（ボス専用）が付き、聖杯戦争には呼ばれない（engine.js が roster から外す）。
  function prepareBoss(spec) {
    if (!spec || !spec.trueName || !spec.stats) throw new Error('ボスには trueName と stats が要ります');
    const r = B.leanFromSpec(spec);
    Object.assign(E.SERVANT_OVERRIDES, r.servantOv);
    Object.assign(E.NP_OVERRIDES, r.npOv);
    const sv = B.fromJSON(r.lean);
    sv.bossOnly = true;
    sv.boss = Object.assign({}, spec.boss || {});
    sv.boss.aoe = r.aoe;
    return sv;
  }
  // 名簿（servants.json）にいるボス専用の英霊を、ボスとして使えるようにする：手直し表 boss（BOSS_PARAMS）の設定を sv.boss にする。
  // 設定の無い項目は CONFIG.SING.boss の既定が使われる。宝具の全体攻撃の広がり（aoe）は、書いた宝具だけ。
  function bossFromRoster(sv) {
    const p = E.BOSS_PARAMS[sv.trueName] || {};
    sv.bossOnly = true;
    sv.boss = Object.assign({}, p);
    sv.boss.aoe = {};
    for (const [n, v] of Object.entries(p.aoe || {})) sv.boss.aoe[E.normName(n)] = +v;
    return sv;
  }
  // 読み込んだボスのデータ（{ bosses: [...] } か配列）を組み立てる。読めなかったものは errors に
  function prepareBosses(d) {
    const list = Array.isArray(d) ? d : (d && d.bosses) || [], out = [], errors = [];
    for (const s of list) { try { out.push(prepareBoss(s)); } catch (e) { errors.push((s && s.trueName || '?') + '：' + e.message); } }
    return { bosses: out, errors };
  }

  // ---------- 特異点の名前と顔ぶれ ----------
  const clsKey = s => s.class.key === 'extra' ? 'extra:' + s.class.label : s.class.key;
  const CLASS_ORDER = () => Object.keys(G.CONFIG.CLASS_DEFS);
  // クラスの順、同じクラスならリストの順（名前の並べ替えは環境で順序が変わりうるので使わない。並びが陣営の番号と乱数の順を決める）
  const byClass = order => (a, b) => { const o = CLASS_ORDER(), i = x => { const j = o.indexOf(x.class.key); return j < 0 ? 99 : j; }; return i(a) - i(b) || order.get(a.id) - order.get(b.id); };

  /**
   * 特異点の名前と顔ぶれを決める（シードから。エンジンの戦いの乱数とは別の流れなので、顔ぶれを指定しても名前は変わらない）。
   * picks: { party: [サーヴァントの id か null ×6], foes: [id か null ×7], boss: ボスの id | 'empower'（超強化）| null（くじ） }
   * o.bossMode: ボスの抽選（'both' 両方・既定 / 'boss' ボス専用だけ / 'empower' 既存の英霊だけ）。picks.boss を指定した席には効かない
   * 戻り値: { name, words, tag（敵の呼び名に付ける言葉）, city, region, party: [id], foes: [id], boss: { id, kind: 'boss'|'empower' }, stray: id|null, front: [前衛の番号] }
   */
  function compose(o) {
    const S = Object.assign({}, G.CONFIG.SING, o.sing || {});
    const wcfg = o.war || undefined;   // 七騎の組み方：{ extra:false, pick:'open' }（聖杯戦争と同じ指定）
    const roster = (o.roster || []).filter(s => s && s.score && !s.bossOnly && !(wcfg && wcfg.extra === false && G.classDef(s.class.key).slot === 'extra'));
    const bosses = (o.bosses || []).filter(s => s && s.score);
    const byId = new Map(roster.map(s => [s.id, s]));
    const picks = o.picks || {};
    const nameRnd = G.engine.makeRng(String(o.seed) + ':名'), rnd = G.engine.makeRng(String(o.seed) + ':顔ぶれ');
    const pickN = (r, a) => a[Math.floor(r() * a.length)];
    // 名前：三つの欄から二字熟語を一つずつ（同じ単語は使わない）、都市はすべての都市から同じ確率で
    const D = G.SING_DATA, W = D.WORDS, words = [];
    for (const k of ['state', 'anomaly', 'place']) { const c = W[k].filter(w => !words.includes(w)); words.push(pickN(nameRnd, c.length ? c : W[k])); }
    const all = []; for (const g of D.CITIES) for (const c of g.cities) all.push({ city: c, region: g.region });
    const at = all.length ? pickN(nameRnd, all) : { city: '冬木', region: '' };
    const name = words.join('') + ' ' + at.city;
    // 敵の呼び名に付ける言葉：都市名か、名前の熟語（『冬木のセイバー』『炎上のセイバー』）。特異点ごとに一つ
    const tag = nameRnd() < 0.5 ? at.city : nameRnd() < 0.6 ? words[0] : words[1];
    // 指定された英霊を先に押さえる
    const used = new Set();
    const fixedP = (picks.party || []).slice(0, S.party).map(id => byId.get(id) || null);
    const fixedF = (picks.foes || []).slice(0, S.foes).map(id => byId.get(id) || null);
    for (const s of fixedP.concat(fixedF)) if (s) used.add(s.id);
    let bossPick = null;
    if (picks.boss && picks.boss !== 'empower') { const b = bosses.find(x => x.id === picks.boss) || byId.get(picks.boss); if (b) { bossPick = { id: b.id, kind: b.bossOnly ? 'boss' : 'empower' }; if (!b.bossOnly) used.add(b.id); } }
    // 残りの席：聖杯戦争と同じ組み方（クラスごとに一騎、ときどきエクストラ）で七騎を引き、指定と同じクラスの席を外してから、
    // 足りない数だけ残す（六騎なら一つのクラスがあぶれる）。それでも足りなければリストから
    const fill = (fixed, size) => {
      const got = [];
      for (const s of fixed) if (s && !got.includes(s)) got.push(s);
      if (got.length >= size) return got.slice(0, size);
      const pool = roster.filter(s => !used.has(s.id));
      const comp = G.war.composeWar(pool, rnd, wcfg).filter(x => x.servant).map(x => x.servant);
      const have = new Set(got.map(clsKey));
      const cand = comp.filter(s => !have.has(clsKey(s)));
      while (cand.length > size - got.length) cand.splice(Math.floor(rnd() * cand.length), 1);
      for (const s of cand) { got.push(s); used.add(s.id); }
      for (const s of comp) if (got.length < size && !got.includes(s)) { got.push(s); used.add(s.id); }
      while (got.length < size) { const rest = roster.filter(s => !used.has(s.id)); if (!rest.length) break; const s = pickN(rnd, rest); got.push(s); used.add(s.id); }
      return got;
    };
    const order = new Map(roster.map((s, i) => [s.id, i]));
    const party = fill(fixedP, S.party).sort(byClass(order));
    const foes = fill(fixedF, S.foes).sort(byClass(order));
    // ボス：ボス専用のデータがあれば多くはそれ、ときどき（無ければ必ず）残りの英霊のうち一騎が超強化されて現れる
    if (!bossPick) {
      const rest = roster.filter(s => !used.has(s.id));
      // 抽選のしかた o.bossMode：'both'（既定。ボス専用が多め、ときどき超強化）／'boss'（ボス専用だけ）／'empower'（既存の英霊の超強化だけ）。
      // 'both' のときだけ、超強化にするかの乱数を引く（従来と同じ順序）。ボス専用が無ければ、どのモードでも超強化になる
      const mode = o.bossMode === 'boss' || o.bossMode === 'empower' ? o.bossMode : 'both';
      if (picks.boss !== 'empower' && bosses.length && (mode === 'boss' || (mode === 'both' && !(rnd() < S.empower.chance)))) bossPick = { id: pickN(rnd, bosses).id, kind: 'boss' };
      else if (rest.length) { const s = pickN(rnd, rest); used.add(s.id); bossPick = { id: s.id, kind: 'empower' }; }
      else if (bosses.length) bossPick = { id: bosses[0].id, kind: 'boss' };
    }
    // はぐれサーヴァント：残りから一騎（現れるかどうかは出来事しだい）
    const rest = roster.filter(s => !used.has(s.id));
    const stray = rest.length ? pickN(rnd, rest).id : null;
    // 前衛：戦闘力の高い順に三騎（画面で選び直せる）
    const front = party.map((s, i) => [i, s.power + s.npPeak * 0.3]).sort((a, b) => b[1] - a[1]).slice(0, S.front).map(x => x[0]).sort((a, b) => a - b);
    return { name, words, tag, city: at.city, region: at.region, party: party.map(s => s.id), foes: foes.map(s => s.id), boss: bossPick, stray, front };
  }

  // ---------- 進行 ----------
  function makePlugin(opts, L) {
    const S = Object.assign({}, G.CONFIG.SING, opts.sing || {});
    const maxDays = Math.max(5, Math.round(+opts.days || S.maxDays));
    const roster = opts.roster || [], bossList = opts.bosses || [];
    const find = id => roster.find(s => s.id === id) || bossList.find(s => s.id === id) || null;
    let A = null;   // engine.js から渡される道具（戦闘・記録・判断）
    const camps = [], party = [], foes = [];
    let boss = null, stray = null;
    // パーティーの共有の状態（マスター・魔力の蓄え・令呪・道具・陣地）
    const P = {
      master: null, mana: 0, manaMax: 0, cs: S.csMax, mhp: 0, mhpMax: 0, masterAlive: true, items: 0, camp: 0,
      front: [], front0: [], focus: 'auto', stage: 'hunt', seen: new Set(), lead: null, slain: 0, csDay: 0, guessDay: 0,
      strayJoined: false, strayAsked: false, masterDead: false, wiped: false, cleared: false, revived: 0, lastCouncil: 0, rested: false, cmdLog: [],
    };
    const GRAIL = { name: '聖杯', stats: { mana: 32, craft: 32, body: 32, mind: 32, luck: 32 }, originLabel: '', wish: '', origin: 'custom' };
    const NONE = { name: '（主なし）', stats: { mana: 32, craft: 32, body: 32, mind: 32, luck: 32 }, originLabel: '', wish: '', origin: 'custom' };
    const allIds = new Set();
    const shared = { knowName: new Set(), knowLoc: new Set(), clues: {} };

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
    // 同じクラスの名前が並ぶときは（一）（二）
    function labelAll(list, prefix) {
      const cnt = {}, seen = {};
      for (const c of list) { c.labelBase = c.sv.class.label; cnt[c.labelBase] = (cnt[c.labelBase] || 0) + 1; }
      for (const c of list) {
        let l = c.labelBase;
        if (cnt[l] > 1) { seen[l] = (seen[l] || 0) + 1; l += '（' + '一二三四五六七'[seen[l] - 1] + '）'; }
        c.label = prefix + l;
      }
    }
    const alive = list => list.filter(c => c.alive);
    const frontAlive = () => P.front.map(i => camps[i]).filter(c => c && c.alive);
    const reserveAlive = () => party.filter(c => c.alive && !P.front.includes(c.id));
    const foesAlive = () => alive(foes);
    const strayReady = () => stray && P.strayJoined && stray.alive;
    const over = () => P.masterDead || P.wiped || P.cleared;

    const plugin = {
      FOCUS,
      init(t) {
        const { rnd } = t;
        const D = G.SING_DATA;
        const places = D.PLACES.slice();
        // マスター（あなた）
        const m = G.master.createMaster({ origin: 'custom', originLabel: '人理の守り手', stats: { mana: 'C', craft: 'C', body: 'C', mind: 'B', luck: 'B' } }, rnd);
        if (!m.name) {
          const N = G.NAMES, female = /女/.test(m.sex);
          m.name = N && N.jpSurname ? N.jpSurname[Math.floor(rnd() * N.jpSurname.length)] + ' ' + (female ? N.jpFemale : N.jpMale)[Math.floor(rnd() * (female ? N.jpFemale : N.jpMale).length)] : 'あなた';
        }
        m.wish = '人理の修復';
        P.master = m;
        const start = places[Math.floor(rnd() * places.length)];
        P.place = start;
        // 味方（ids 0〜5）
        L.party.forEach(id => {
          const sv = find(id); if (!sv) throw new Error('味方のサーヴァントが見つかりません：' + id);
          const c = mkCamp(sv, camps.length, 'party', start, rnd);
          c.knowName = shared.knowName; c.knowLoc = shared.knowLoc; c.clues = shared.clues;
          for (const k of ['master', 'mana', 'manaMax', 'cs', 'mhp', 'mhpMax', 'masterAlive', 'items']) Object.defineProperty(c, k, { get: () => P[k], set: v => { P[k] = v; }, enumerable: true });
          // 陣地：エンジンは「拠点で戦うとき 工房×5%」を足すので、陣地1段が campEdge になるように換算して見せる
          Object.defineProperty(c, 'workshop', { get: () => P.camp * S.campEdge / 0.05, set: () => {}, enumerable: true });
          c.you = true; c.assistK = S.frontAssist;
          camps.push(c); party.push(c);
        });
        for (const c of party) shared.knowName.add(c.id);
        labelAll(party, '');
        P.manaMax = P.mana = Math.round((t.ENG.manaBase + m.stats.mana) * party.length * S.poolK);
        P.mhpMax = P.mhp = Math.round(50 + m.stats.body * 0.8);
        // 敵（7騎）
        const foePlace = () => places[Math.floor(rnd() * places.length)];
        L.foes.forEach(id => {
          const sv = find(id); if (!sv) throw new Error('敵のサーヴァントが見つかりません：' + id);
          const c = mkCamp(sv, camps.length, 'foe', foePlace(), rnd);
          Object.assign(c, { master: GRAIL, masterAlive: true, noMaster: true, cs: 0, mhp: 1, mhpMax: 1, mana: S.foeMana, manaMax: S.foeMana, workshop: 0, assistK: S.frontAssist });
          camps.push(c); foes.push(c);
        });
        labelAll(foes, (L.tag || L.city || '敵') + 'の');
        // ボス
        if (L.boss) {
          const sv = find(L.boss.id);
          if (sv) {
            const c = mkCamp(sv, camps.length, 'boss', foePlace(), rnd);
            const bs = Object.assign({}, S.boss, L.boss.kind === 'empower' ? S.empower : {}, sv.boss || {});
            Object.assign(c, { master: GRAIL, masterAlive: true, noMaster: true, cs: 0, mhp: 1, mhpMax: 1, mana: bs.mana || S.boss.mana, manaMax: bs.mana || S.boss.mana, workshop: 0 });
            c.bs = bs; c.gauges = c.gaugeMax = Math.max(1, Math.round(bs.gauges || 1)); c.empowered = L.boss.kind === 'empower';
            c.label = bs.label || (c.empowered ? '超越した' + sv.class.label : sv.class.label);
            camps.push(c); boss = c;
          }
        }
        // はぐれサーヴァント
        if (L.stray) {
          const sv = find(L.stray);
          if (sv) {
            const c = mkCamp(sv, camps.length, 'stray', start, rnd);
            Object.assign(c, { master: NONE, masterAlive: true, noMaster: true, cs: 0, mhp: 1, mhpMax: 1, mana: S.strayMana, manaMax: S.strayMana, workshop: 0, assistK: S.strayAssist * S.frontAssist });
            c.label = 'はぐれの' + sv.class.label;
            camps.push(c); stray = c;
          }
        }
        // 前衛
        const fr = (Array.isArray(opts.front) ? opts.front : L.front || []).map(Number).filter(i => i >= 0 && i < party.length);
        P.front = [...new Set(fr)].slice(0, S.front);
        for (const c of party) if (P.front.length < S.front && !P.front.includes(c.id)) P.front.push(c.id);
        P.front0 = P.front.slice();
        return { city: L.name, places, camps, you: party[0] };
      },
      snap() {
        return {
          p: { mana: Math.round(P.mana / Math.max(1, P.manaMax) * 100), cs: P.cs, mhp: Math.max(0, Math.round(P.mhp / Math.max(1, P.mhpMax) * 100)), alive: P.masterAlive, items: P.items, camp: P.camp,
            slain: P.slain, stage: P.stage, focus: P.focus, place: P.place ? P.place.name : '', scene: P.place ? P.place.scene : '' },
          c: camps.map(c => ({
            id: c.id, side: c.side, label: c.label, name: A.known(c) ? c.sv.trueName : null, cls: c.sv.class.label, hp: Math.max(0, Math.round(c.hp)), alive: c.alive,
            front: c.party ? P.front.includes(c.id) : false, seen: c.party || P.seen.has(c.id), gauges: c.gauges || 0, gaugeMax: c.gaugeMax || 0,
            joined: c === stray ? P.strayJoined : c.party, clues: !c.party && !A.known(c) ? (shared.clues[c.id] || 0) : 0, bond: c.party ? Math.round(c.bond) : null,
          })),
        };
      },
      // 全体攻撃の宝具か（押し勝った打ち合いで、傷が相手の側の全員に広がる割合）
      aoeOf(c, np) {
        if (c.sv.boss && c.sv.boss.aoe && c.sv.boss.aoe[E.normName(np.name)] != null) return c.sv.boss.aoe[E.normName(np.name)];
        return (S.aoe && S.aoe[np.typeKey]) || 0;
      },
      hooks: {
        // 魔力が足りないとき：蓄えは0のまま、生きている味方の霊基が少しずつ削れる（ここでは倒れない）
        drain(c) {
          if (!c.party) { c.mana = 0; return; }
          const short = -P.mana; P.mana = 0;
          for (const x of alive(party)) x.hp = Math.max(1, x.hp - Math.min(8, short * 0.15));
          if (!P.drainSaid || P.drainSaid < A.day) { P.drainSaid = A.day; A.log(A.phase === 'night' ? 'battle' : 'day', '魔力の蓄えが尽き、英霊たちの霊基が揺らいでいる。', alive(party).map(x => x.id)); }
        },
        down(c) {
          if (c.party) {
            P.front = P.front.filter(i => i !== c.id);
            if (P.lead === c.id) P.lead = null;
          } else if (c.foe) { P.slain++; if (P.lead === c.id) P.lead = null; }
          else if (c.boss) P.cleared = true;
        },
        masterDown() { P.masterDead = true; },
        // ブレイクゲージ：残っていれば霊基を組み直し、その戦いの間は少し力を増して立ち上がる
        gauge(l) {
          if (!l.boss || !(l.gauges > 1)) return null;
          l.gauges--; l.hp = 100; l.wither = 0; l.poison = null;
          if (l.temp) l.temp.push({ id: 'power', mag: 0.1, params: null, from: 'ブレイク' });
          A.log('battle', `${A.nm(l)}の霊基が砕け——なお、形を変えて立ち上がった。（残りのゲージ ${l.gauges}）`, [l.id], { big: true, quote: A.say(l, ['開始']) });
          return 'guts';
        },
        // 消滅寸前：令呪一画で霊基を癒やすか
        *seal(l, w) {
          if (!l.party || !P.masterAlive || P.cs < 1) return null;
          const k = yield* A.ask(l, 'cs', {
            title: `${A.sn(l)}が消えかけている`,
            body: `このままでは${A.sn(l)}は消滅する。令呪は残り${P.cs}画（全滅したとき全員を呼び戻すには${S.csWipe}画が要る）。`,
            options: [
              { k: 'heal', label: '令呪で霊基を癒やす', sub: '令呪一画。霊基を満たし、そのまま戦わせる' },
              { k: 'none', label: '令呪は使わない', sub: P.cs >= S.csWipe ? '全滅に備えて令呪を残す' : '残りの令呪を温存する' },
            ],
          }, () => autoSeal(l));
          if (k !== 'heal') return null;
          P.cs--; l.hp = S.csHealHp; l.wither = 0; l.poison = null; A.bondUp(l, 5);
          A.log('cs', `「令呪をもって命ずる——癒えよ、${A.sn(l)}！」砕けかけた霊基に、令呪の魔力が満ちる。（残り${P.cs}画）`, [l.id, w.id], { big: true });
          return 'rallied';
        },
        focus(c) {
          if (c.boss) return { stance: 'all' };
          if (!c.party) return null;
          const F = FOCUS[P.today || P.focus];
          return F && F.stance ? F : null;
        },
        // 並び立つ顔ぶれを一行で
        lineup(a, b, ha, hb) {
          const sideTxt = (x, h) => h.length ? `${A.sn(x)}・${h.map(A.sn).join('・')}` : A.sn(x);
          if (ha.length || hb.length) A.log('battle', `${sideTxt(a, ha)}——対するは${sideTxt(b, hb)}。`, [a.id, b.id].concat(ha.map(x => x.id), hb.map(x => x.id)));
        },
      },
      *run(api) { A = api; return yield* main(); },
    };

    // 令呪のおまかせ：全員を呼び戻せるだけ（csWipe 画）残っているうちは温存し、足りなくなったら惜しまず癒やす
    function autoSeal() {
      return P.cs > S.csWipe || P.cs < S.csWipe ? 'heal' : 'none';
    }

    // ---------- 数値 ----------
    const mean = a => a.length ? a.reduce((t, x) => t + x, 0) / a.length : 0;
    // パーティーの索敵・隠密・幸運（前衛と控え、生きている者から）
    function partyDetect() { const xs = alive(party); return xs.length ? Math.max(...xs.map(c => A.eff(c, 'detect'))) : 0; }
    function partyIntel() { const xs = alive(party); return xs.length ? Math.max(...xs.map(c => A.eff(c, 'intel'))) : 0; }
    // 遭いにくさ：隠密（いちばん隠れるのがうまい者×0.6＋平均×0.4）と幸運（英霊の幸運の偏差・幸運補正・マスターの幸運の半分）
    function mitigation(F) {
      const xs = frontAlive().length ? frontAlive() : alive(party);
      if (!xs.length) return 0;
      const st = xs.map(c => Math.max(0, A.eff(c, 'stealth')));
      const stealth = Math.max(...st) * 0.6 + mean(st) * 0.4;
      const luck = mean(xs.map(c => A.sd(c, 'luk') + A.eff(c, 'luck'))) + A.md(party[0], 'luck') * 0.5;
      return clamp(stealth * S.stealthK + luck * S.luckK + (F === 'stealth' ? S.stealthFocus : 0), 0, S.mitigateCap);
    }
    const hpOf = xs => mean(xs.map(c => c.hp));

    // ---------- 朝 ----------
    function morning(cmds) {
      const day = A.day;
      // 令呪は csEvery 日ごとに一画戻る（上限まで）
      if (day > 1 && (day - 1) % S.csEvery === 0 && P.cs < S.csMax && P.masterAlive) { P.cs++; A.log('cs', `${A.mn(party[0])}の手の甲に、令呪が一画よみがえった。（残り${P.cs}画）`, alive(party).map(c => c.id).slice(0, 1)); }
      // 一時停止中に選んだ令呪・推理
      for (const cmd of cmds || []) applyCmd(cmd);
      // 治療（heal_other）：治療の心得のある英霊が、毎朝ほかの味方全員（はぐれも）の霊基とマスターの傷を少し癒やす
      const team = alive(party).concat(strayReady() ? [stray] : []);
      let healed = 0, healer = null;
      for (const h of alive(party)) {
        const k = Math.max(0, A.eff(h, 'heal_other')); if (!(k > 0)) continue;
        for (const x of team) if (x !== h && x.hp < 100) { const v = Math.min(100 - x.hp, k * S.healOther); x.hp += v; healed += v; }
        P.mhp = Math.min(P.mhpMax, P.mhp + k * S.healOther * 0.5);
        if (!healer || k > A.eff(healer, 'heal_other')) healer = h;
      }
      if (healer && healed >= 8 && !(P.healSaid > day - 3)) { P.healSaid = day; A.log('day', `${A.sn(healer)}が、仲間たちの傷を手当てした。`, [healer.id]); }
      // 毎朝の効果・毒・衰弱・ボスの力
      for (const c of camps) {
        if (!c.alive || (c === stray && !P.strayJoined) || (c.boss && P.stage !== 'boss')) continue;
        c.fought = false;
        if (c.wither > 0 && A.chance(clamp(A.ENG.witherFade * (c.rested === day - 1 ? 2 : 1), 0, 1))) { c.wither = 0; if (c.party) A.log('day', `${A.sn(c)}を蝕んでいた衰えが、ようやく抜けた。`, [c.id]); }
        c.dayTemp = null; A.fireTrig(c, null, 'day', null);
        if (c.poison && c.poison.day < day) { c.hp = Math.max(1, c.hp - A.ENG.poisonDay); if (c.party) A.log('day', A.ailText('ailPoisonDay', 'poison', c.poison.p, null, c), [c.id]); c.poison = null; }
        const buff = [];
        if (c.foe && S.foePower) buff.push({ id: 'power', mag: S.foePower, params: null, src: '#foe', from: '聖杯の加護' });
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
        // 真名の推測：一度でも出会った、正体の分からない敵に。1日に一度まで
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

    // ---------- 作戦会議（数日ごと） ----------
    function* council() {
      const you = party[0], day = A.day;
      const opts2 = [];
      const unk = foesAlive().filter(t => P.seen.has(t.id) && !A.known(t));
      if (unk.length) {
        const t = unk.reduce((a, b) => ((shared.clues[a.id] || 0) >= (shared.clues[b.id] || 0) ? a : b)), n = shared.clues[t.id] || 0, p = deduce(t);
        opts2.push({ k: 'deduce:' + t.id, label: `${t.label}の真名を推理する`, sub: `手がかり${n}個・見込みは${p >= 0.6 ? '高い' : p >= 0.35 ? '五分' : '低い'}` });
      }
      opts2.push({ k: 'recover', label: '霊脈で力を蓄える', sub: '魔力と霊基を大きく回復する。今日は探索しない' });
      if (P.stage === 'hunt' && P.lead == null && P.mana >= 30) opts2.push({ k: 'familiar', label: '使い魔を放って敵を探す', sub: '魔力を使う。見つかるとは限らない' });
      const fr = frontAlive(), res = reserveAlive();
      const swap = fr.length && res.length ? (() => { const w = fr.reduce((a, b) => (a.hp <= b.hp ? a : b)), s = res.reduce((a, b) => (a.hp >= b.hp ? a : b)); return w.hp < 50 && s.hp > w.hp + 20 ? [w, s] : null; })() : null;
      if (swap) opts2.push({ k: 'swap', label: `前衛の${A.sn(swap[0])}を下げ、${A.sn(swap[1])}を前に出す`, sub: '傷の深い英霊を控えに回す' });
      const k = yield* A.ask(you, 'council', {
        title: `${day}日目、作戦会議`,
        body: `魔力 ${Math.round(P.mana / P.manaMax * 100)}%・令呪 ${P.cs}画・倒した敵 ${P.slain}/${foes.length}騎。残り${maxDays - day + 1}日。`,
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
        const t = A.pick(foesAlive());
        if (t && A.chance(clamp(0.45 + partyIntel() + A.md(you, 'craft') * 0.1 - A.eff(t, 'stealth') * 0.5, 0.1, 0.9))) { P.lead = t.id; A.clue(you, t, 1); A.log('scout', `放った使い魔が、${t.label}の居場所を突き止めた。`, [you.id, t.id]); }
        else A.log('council', '使い魔は手がかりを持ち帰れなかった。', [you.id]);
      } else if (k === 'swap') {
        const [w, s] = swap; P.front = P.front.map(i => (i === w.id ? s.id : i));
        A.log('council', `${A.sn(w)}を控えに下げ、${A.sn(s)}が前衛に立った。`, [w.id, s.id]);
      }
    }
    // 真名の推理の見込み（生きている味方のうち、いちばん見抜ける者で）
    function deduce(t) { return Math.max(...alive(party).map(c => A.deduceP(c, t)), 0.03); }

    // ---------- 前衛 ----------
    // 欠けた前衛を控えで埋める（並びの順に）
    function fillFront() {
      P.front = P.front.filter(i => camps[i].alive);
      for (const c of party) {
        if (P.front.length >= S.front) break;
        if (c.alive && !P.front.includes(c.id)) { P.front.push(c.id); A.log('event', `控えの${A.nm(c)}が前衛に立った。`, [c.id]); }
      }
    }
    // 戦う一騎：前衛のうち、傷を考えた戦闘力がいちばん高い者（乱数は使わない）
    const chooseMain = fr => fr.reduce((a, b) => ((b.sv.power + b.sv.npPeak * 0.3) * (0.4 + 0.6 * b.hp / 100) > (a.sv.power + a.sv.npPeak * 0.3) * (0.4 + 0.6 * a.hp / 100) ? b : a));

    // ---------- 全滅・失敗 ----------
    function* checkWipe() {
      if (P.wiped || P.masterDead || party.some(c => c.alive)) return;
      if (P.cs >= S.csWipe && P.masterAlive) {
        const k = yield* A.ask(party[0], 'wipe', {
          title: 'パーティーが全滅した',
          body: `六騎の英霊がすべて倒れた。令呪は残り${P.cs}画。`,
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
          A.log('cs', `「令呪をもって命ずる——還れ、我が英霊たちよ！」三画の令呪がすべて光となり、倒れた六騎が再び現界した。（残り${P.cs}画）`, party.map(c => c.id), { big: true });
          return;
        }
      }
      P.wiped = true;
      A.log('death', `${A.mn(party[0])}のもとに、戦える英霊は一騎も残っていない。`, party.map(c => c.id), { big: true });
    }

    // ---------- 遭遇と戦い ----------
    // group：出会った敵（1〜3騎）。how：'meet'（探索で出会う）/ 'raid'（夜襲を受ける）/ 'ambush'（待ち伏せ）/ 'boss'
    function* engage(group, how) {
      for (const g of group) if (!P.seen.has(g.id)) {
        P.seen.add(g.id);
        if (!g.boss) A.log('event', A.line('sgFirst', { T: g.label }), [g.id].concat(frontAlive().map(c => c.id).slice(0, 1)), { big: true });
      }
      const F = P.today;
      for (let bout = 1; bout <= S.maxBouts; bout++) {
        fillFront();
        const fr = frontAlive(), en = group.filter(c => c.alive);
        if (!fr.length || !en.length) break;
        const me = chooseMain(fr), foe = en[0];
        const helpP = fr.filter(x => x !== me).concat(strayReady() && stray.hp >= 30 ? [stray] : []), helpF = en.slice(1);
        const raid = how === 'raid' || how === 'ambush';
        // 先手：痕跡をつかんで踏み込んだ戦いはこちら、夜襲・待ち伏せは敵（索敵が高ければ打ち消す）
        if (bout === 1) {
          if (raid) { const v = clamp(0.12 - Math.max(0, partyDetect()) * 0.15, 0, 0.12); if (v > 0) foe.surprise = (foe.surprise || 0) + v; }
          else if (P.leadHit) me.surprise = (me.surprise || 0) + S.leadEdge;
        }
        const place = P.place;
        const home = how === 'raid' && (P.camp > 0 || F === 'defend') ? me : null;
        const ctx = { place, home, terrain: A.tonight.rain ? '水辺' : place.terrain, rain: A.tonight.rain,
          lines: A.phase === 'night' ? null : { clash: 'sgClashDay', retreat: 'sgRetreatDay', dawn: 'sgDawnDay' } };
        if (raid) yield* A.battle(foe, me, Object.assign(ctx, { helpA: helpF, helpB: helpP }));
        else yield* A.battle(me, foe, Object.assign(ctx, { helpA: helpP, helpB: helpF }));
        for (const c of [me, foe].concat(helpP, helpF)) if (c.alive) c.fought = true;
        yield* checkWipe();
        if (over()) break;
        const fr2 = frontAlive().concat(reserveAlive()), en2 = group.filter(c => c.alive);
        if (!fr2.length || !en2.length) break;
        if (me.alive && foe.alive) break;   // 夜明け・撤退：いったん引き分け
        const p = S.pressOn + (F === 'advance' ? 0.2 : 0) - (F === 'stealth' ? 0.3 : 0) + (raid ? 0.15 : 0);
        if (!A.chance(clamp(p, 0.05, 0.95))) break;
        A.log('battle', A.line('sgPress', { T: A.nm(en2[0]) }), [en2[0].id]);
      }
      P.leadHit = false;
      P.fought = true;
    }
    // 出会った敵の顔ぶれ：狙った一騎に、ときどき一〜二騎が加わる
    function groupWith(t) {
      const g = [t], rest = foesAlive().filter(c => c !== t);
      if (rest.length && A.chance(S.group2 + S.group3)) {
        const x = A.pick(rest); g.push(x);
        const r2 = rest.filter(c => c !== x);
        if (r2.length && A.chance(S.group3 / (S.group2 + S.group3))) g.push(A.pick(r2));
      }
      return g;
    }

    // ---------- ボスの出現 ----------
    function* bossAppears() {
      P.stage = 'boss'; P.lead = null;
      if (!boss) { P.cleared = true; return; }
      A.pubName.add(boss.id); P.seen.add(boss.id);
      const intro = boss.bs.intro || (boss.empowered ? `聖杯の力をその身に取り込み、${boss.sv.trueName}が特異点の主として姿を現した。` : `特異点の主、${boss.sv.trueName}が姿を現した。`);
      A.log('event', `七騎の英霊はすべて倒れた。歪みの中心から、圧倒的な魔力が立ち上る——${intro}`, [boss.id], { big: true, head: true, quote: A.say(boss, ['開始', '召喚']) });
    }

    // ---------- 昼 ----------
    function decideFocus() {
      if (P.focus !== 'auto') return P.focus;
      const xs = alive(party), fr = frontAlive();
      const hp = hpOf(fr.length ? fr : xs), manaR = P.mana / P.manaMax;
      if (P.stage === 'boss') return hp < 60 || manaR < 0.4 ? 'rest' : 'advance';
      if (hp < 45 || manaR < 0.25) return 'rest';
      if (P.lead != null) return 'advance';
      return A.day % 3 === 0 ? 'advance' : 'search';
    }
    function* dayPhase() {
      const F = P.today;
      A.phase = 'day';
      if (P.restDay === A.day) return;   // 作戦会議で休むと決めた
      if (F === 'rest') {
        for (const c of alive(party)) { c.hp = Math.min(100, c.hp + S.restHeal + A.eff(c, 'regen') * A.ENG.regenHeal); c.rested = A.day; }
        P.mhp = Math.min(P.mhpMax, P.mhp + 15); P.rested = true;
        A.log('day', A.line('sgRest', { M: A.mn(party[0]) }), alive(party).map(c => c.id).slice(0, 1));
        return;
      }
      if (F === 'defend') {
        P.camp = Math.min(5, P.camp + 1);
        A.log('day', A.line('sgCamp', { M: A.mn(party[0]) }) + `（陣地 ${P.camp}）`, alive(party).map(c => c.id).slice(0, 1));
        if (A.chance(0.4)) yield* eventRoll(F, true);   // 陣地の日も、ときどき出来事が起きる
        return;
      }
      // 進む：場所が変わり、陣地はたたむ。道中の出来事は、敵と出会うかどうかとは別に毎日起こりうる
      const prev = P.place;
      P.place = A.pick(G.SING_DATA.PLACES.filter(p => p !== prev));
      P.camp = 0;
      A.log('day', `一行は「${P.place.name}」へ進んだ。`, alive(party).map(c => c.id).slice(0, 1), { place: P.place.name, scene: P.place.scene });
      const ev = yield* eventRoll(F, true);
      if (over() || P.fought) return;
      // ボスとの戦い：特異点の主のもとへ
      if (P.stage === 'boss') {
        if (A.chance(clamp((boss.bs.find || S.boss.find) + (S.focusEnc[F] || 0), 0.05, 0.98))) yield* engage([boss], 'boss');
        else A.log('day', '特異点の主の気配は濃い。だが、その居城へ至る道はまだ見えない。', alive(party).map(c => c.id).slice(0, 1));
        return;
      }
      // 索敵：痕跡をつかめば、その敵と出会いやすい
      const live = foesAlive();
      if (!live.length) return;
      if (P.lead == null || !camps[P.lead].alive) {
        P.lead = null;
        const t = A.pick(live);
        const scout = alive(party).reduce((a, b) => (A.eff(b, 'detect') > A.eff(a, 'detect') ? b : a));
        const p = clamp(S.searchBase + Math.max(0, partyDetect()) * S.detectK + Math.max(0, partyIntel()) * S.intelK + A.md(party[0], 'craft') * 0.05
          + (F === 'search' ? S.searchFocus : F === 'advance' ? 0.05 : F === 'stealth' ? -0.05 : 0) - Math.max(0, A.eff(t, 'stealth')) * 0.4, 0.05, 0.92);
        if (A.chance(p)) { P.lead = t.id; A.clue(party[0], t, 1); A.log('scout', A.line('sgTrace', { S: A.sn(scout), T: t.label }), [scout.id, t.id]); }
        else if (F === 'search') A.log('day', A.line('sgTraceFail', { S: A.sn(scout) }), [scout.id]);
      }
      // 出会い
      const pE = clamp(S.encBase + (P.lead != null ? S.leadBonus : 0) + (S.focusEnc[F] || 0), 0.02, 0.95);
      if (A.chance(pE)) {
        const t = P.lead != null ? camps[P.lead] : A.pick(live);
        P.leadHit = P.lead != null; P.lead = null;
        yield* engage(groupWith(t), 'meet');
        return;
      }
      if (!ev) A.log('day', A.line('sgQuiet'), []);
    }

    // ---------- 出来事 ----------
    // 道中の出来事。silent なら、何も起きなかった日の文を書かない。起きたら true
    function* eventRoll(F, silent) {
      if (!A.chance(S.eventChance)) { if (!silent) A.log('day', A.line('sgQuiet'), []); return false; }
      const mit = mitigation(F);
      const W = S.eventW;
      const good = { leyline: 1.2, locals: 1, supplies: 0.9, relic: 0.8, spring: 1, omen: 0.7, talk: 0.9 };
      if (stray && !P.strayJoined && !P.strayAsked && A.day > S.strayAfter && P.stage === 'hunt') good.stray = 1.2;
      const bad = { trap: 1, miasma: 1, disturb: 0.8, curse: 0.8, masterHurt: 0.45, lost: 0.5, storm: 0.6, hunted: 0.7, refugee: 0.7 };
      if (foesAlive().length && P.stage === 'hunt') bad.ambush = 0.9;
      const w = {};
      const gt = Object.values(good).reduce((t, x) => t + x, 0), bt = Object.values(bad).reduce((t, x) => t + x, 0);
      for (const k in good) w['g:' + k] = W.good * good[k] / gt;
      for (const k in bad) w['b:' + k] = W.bad * (1 - mit) * bad[k] / bt;
      w['m:mob'] = W.mob * (1 - mit);
      w['s:scene'] = W.scene;
      const k = A.wpick(w);
      const ids = alive(party).map(c => c.id);
      const any = () => A.pick(alive(party));
      const V = { M: A.mn(party[0]) };
      if (k === 'g:leyline') { P.mana = Math.min(P.manaMax, P.mana + Math.round(P.manaMax * 0.35)); A.log('event', A.line('sgLeyline', V), ids.slice(0, 1)); }
      else if (k === 'g:locals') {
        for (const c of alive(party)) c.hp = Math.min(100, c.hp + 15);
        const live = foesAlive();
        if (live.length && A.chance(0.5)) { const t = A.pick(live); P.lead = t.id; A.clue(party[0], t, 1); A.log('event', A.line('sgLocals', V) + `${t.label}の目撃談を聞けた。`, ids.slice(0, 1).concat([t.id])); }
        else A.log('event', A.line('sgLocals', V), ids.slice(0, 1));
      } else if (k === 'g:supplies') { P.items = Math.min(3, P.items + 1); A.log('event', A.line('sgSupplies', V) + `（道具 ${P.items}）`, ids.slice(0, 1)); }
      else if (k === 'g:relic') {
        const cand = foesAlive().filter(t => !A.known(t)), c = any();
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
        const t = A.pick(foesAlive());
        A.log('event', A.line('sgAmbush', { T: t.label }), ids.slice(0, 1).concat([t.id]), { big: true });
        yield* engage(groupWith(t), 'ambush');
      } else if (k === 'm:mob') {
        const mob = A.pick(G.SING_DATA.MOBS), fr = frontAlive();
        for (const c of fr) c.hp = Math.max(1, c.hp - S.mobDmg * (0.5 + A.rnd()) * clamp(1.3 - c.sv.power / 60, 0.3, 1.2));
        P.mana = Math.max(0, P.mana - S.mobMana);
        const lead = fr.length ? fr.reduce((a, b) => (b.sv.power > a.sv.power ? b : a)) : any();
        A.log('event', A.line('sgMob', { mob, S: A.sn(lead) }), fr.map(c => c.id));
      } else if (k === 'g:omen') {
        const live = foesAlive();
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
    // はぐれサーヴァント：一度だけ。共に戦うか（パーティーとは別に、魔力を使わない控えめな加勢）
    function* strayEvent() {
      P.strayAsked = true;
      const c = stray;
      A.log('event', `主を持たない${c.label}が、一行の前に現れた。この特異点に呼ばれながら、どの陣営にも与しなかった英霊らしい。`, [c.id], { big: true, quote: A.say(c, ['召喚', '会話']) });
      const k = yield* A.ask(party[0], 'stray', {
        title: 'はぐれサーヴァント',
        body: `${c.label}が力を貸すと言っている。契約はできないが、戦いに加わってくれる。`,
        options: [{ k: 'yes', label: '共に戦う', sub: '魔力は使わないが、加勢の力は控えめ' }, { k: 'no', label: '断る', sub: '六騎だけで進む' }],
      }, () => 'yes');
      if (k === 'yes') { P.strayJoined = true; c.knowName.add(party[0].id); for (const x of party) x.knowName.add(c.id); A.log('ally', `${A.nm(c)}が一行に加わった。`, [c.id], { big: true }); }
      else A.log('event', `${c.label}は小さく頷き、どこかへ去っていった。`, [c.id]);
    }

    // ---------- 夜 ----------
    function* nightPhase() {
      A.phase = 'night';
      const F = P.today;
      if (P.stage !== 'hunt') return;
      const live = foesAlive(); if (!live.length) return;
      const mit = mitigation(F);
      let p = S.raidBase + S.raidPerFoe * live.length - mit * S.raidStealth + (F === 'advance' ? 0.05 : 0) + (F === 'stealth' ? -0.08 : 0) + (P.hunted === A.day ? 0.25 : 0) - (F === 'rest' || P.restDay === A.day ? S.restRaid : 0) - (F === 'defend' ? S.restRaid * (1 + P.camp * 0.5) : 0);
      if (P.fought) p *= 0.5;
      if (!A.chance(clamp(p, 0.02, 0.6))) return;
      const h = A.pick(live);
      // 気配に気づいてやり過ごすこともある（索敵）
      if (A.chance(clamp(Math.max(0, partyDetect()) * 0.3, 0, 0.4))) { A.log('night', A.line('sgRaidHide'), [h.id]); return; }
      A.log('night', A.line('sgRaid', { T: A.nm(h) }), [h.id].concat(alive(party).map(c => c.id).slice(0, 1)), { big: true });
      // マスターを直接狙う刃（マスター狙いの効果を持つ敵）
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
      yield* engage(groupWith(h), 'raid');
    }

    // ---------- 夜明け前：維持魔力と回復 ----------
    function upkeep() {
      const xs = alive(party);
      const spirit = P.today === 'rest' || P.today === 'stealth' || P.restDay === A.day;
      const cost = xs.reduce((t, c) => t + A.ENG.upkeep * A.upk(c) * (spirit ? A.ENG.spiritSave : 1) + (c.sv.nps || []).reduce((s, n) => s + (n.mode === 'always' && !n.disabled ? A.npCostOf(c, n) * A.ENG.npAlwaysUpkeep : 0), 0), 0);
      const regen = (A.ENG.manaRegen + P.master.stats.mana * 0.15) * xs.length * S.regenK + xs.reduce((t, c) => t + Math.max(0, A.eff(c, 'resource')) * 10, 0);
      P.mana = Math.min(P.manaMax, P.mana + regen) - cost;
      if (P.mana < 0) plugin.hooks.drain(party[0]);
      P.mhp = Math.min(P.mhpMax, P.mhp + 5);
      for (const c of xs) c.hp = Math.min(100, c.hp + S.dailyHeal + (spirit ? 0 : Math.max(0, A.eff(c, 'regen')) * 10));
      for (const c of foesAlive()) { c.hp = Math.min(100, c.hp + S.foeHeal); c.mana = Math.min(c.manaMax, c.mana + S.foeRegen); }
      if (boss && boss.alive && P.stage === 'boss') { boss.hp = Math.min(100, boss.hp + (boss.bs.heal || 0)); boss.mana = Math.min(boss.manaMax, boss.mana + (boss.bs.regen || S.boss.regen)); }
      if (strayReady()) { stray.hp = Math.min(100, stray.hp + S.dailyHeal); stray.mana = Math.min(stray.manaMax, stray.mana + S.strayRegen); }
    }
    function cleanDay() {
      for (const c of camps) { c.temp = []; c.npBoost = 0; c.bx = null; c.ail = null; c.armed = null; c.off = null; c.cleanse = 0; c.tUsed = null; c.tLog = null; c.autoUsed = null; c.autoQ = null; c.surprise = 0; }
    }

    // ---------- 本編 ----------
    function* main() {
      const you = party[0], V = { name: L.name, city: L.city, M: A.mn(you) };
      A.day = 0; A.phase = 'prologue';
      A.log('prologue', `特異点「${L.name}」`, [], { head: true });
      A.log('prologue', A.line('sgIntro', V), []);
      A.log('prologue', A.line('sgArrive', V), party.map(c => c.id).slice(0, 1));
      for (const c of party) A.log('summon', `${A.nm(c)}が召喚に応えた。`, [c.id], { quote: A.say(c, ['召喚']) });
      A.log('summon', `前衛は${frontAlive().map(A.sn).join('・')}。控えに${reserveAlive().map(A.sn).join('・')}。期限は${maxDays}日。`, P.front.slice());
      Object.assign(A.out, { sing: { name: L.name, words: L.words, city: L.city, region: L.region, days: maxDays } });
      for (const c of camps) Object.assign(A.out.meta[c.id], { side: c.side, label: c.label, servantId: c.sv.id, master: c.party ? { name: P.master.name, sex: P.master.sex, age: P.master.age, origin: P.master.origin, originLabel: P.master.originLabel, persona: P.master.persona, skills: P.master.skills, traits: P.master.traits, catalyst: P.master.catalyst, wish: P.master.wish, stats: Object.fromEntries(Object.entries(P.master.stats).map(([k, v]) => [k, Math.round(v)])), hpMax: P.mhpMax, manaMax: P.manaMax } : null });

      let day = 0;
      for (day = 1; day <= maxDays; day++) {
        A.day = day; A.phase = 'day'; A.tonight = {};
        const ans = yield { type: 'tick', day };
        const f = typeof ans === 'string' ? ans : ans && ans.f;
        P.focus = FOCUS[f] ? f : 'auto';
        P.fought = false; P.rested = false;
        A.log('dayhead', `${day}日目`, [], { head: true });
        morning(ans && typeof ans === 'object' ? ans.cmds : null);
        if (over()) break;
        if (P.stage === 'hunt' && !foesAlive().length) yield* bossAppears();
        if (over()) break;
        if (day - P.lastCouncil >= S.councilEvery && P.masterAlive && alive(party).length) { P.lastCouncil = day; yield* council(); }
        if (over()) break;
        P.today = decideFocus();
        if (P.focus === 'auto' && P.today !== 'auto') A.log('day', `今日は「${FOCUS[P.today].label}」で動く。`, [], { auto: true });
        yield* dayPhase();
        if (over()) break;
        if (P.stage === 'hunt' && !foesAlive().length) yield* bossAppears();
        if (over()) break;
        yield* nightPhase();
        if (over()) break;
        A.phase = 'night';
        upkeep();
        cleanDay();
        if (P.focus === 'auto' && P.today) P.today = null;
        if (over()) break;
        // 1日のうちの生き残った者の記録
        if (A.chance(A.ENG.lifeChance * 0.5) && alive(party).length) { A.phase = 'night'; const c = A.pick(alive(party)); yield* A.lifeEvent(c); }
      }
      day = Math.min(day, maxDays);
      A.day = day; A.phase = 'end';
      cleanDay();
      // ---------- 結末 ----------
      let ending;
      if (P.cleared) {
        ending = 'clear';
        A.log('end', `${day}日目。特異点の主は消滅した。歪みの核であった聖杯が回収され、{city}の空がほどけていく。`.replace('{city}', L.city), [boss ? boss.id : party[0].id], { big: true, quote: boss ? A.say(boss, ['戦闘不能', '敗北']) : null });
        A.log('end', `人理修復、成功。${alive(party).length ? '最後まで立っていたのは' + alive(party).map(A.sn).join('・') + '。' : ''}`, alive(party).map(c => c.id), { big: true, head: true, quote: alive(party).length ? A.say(alive(party)[0], ['勝利', '聖杯について']) : null });
      } else if (P.masterDead) {
        ending = 'master';
        A.log('end', `マスターを失い、英霊たちの現界は保てなくなった。人理修復は失敗に終わった。`, party.map(c => c.id), { big: true, head: true });
      } else if (P.wiped) {
        ending = 'wipe';
        A.log('end', `パーティーは全滅した。人理修復は失敗に終わった。`, party.map(c => c.id), { big: true, head: true });
      } else {
        ending = 'timeout';   // 画面では「人理定礎崩壊」
        A.log('end', A.line('sgTimeout') + `（倒した敵 ${P.slain}/${foes.length}騎${P.stage === 'boss' ? '・ボスに至った' : ''}）`, [], { big: true, head: true });
      }
      for (const c of camps) A.pubName.add(c.id);
      A.log('end', ending === 'clear' ? '——人理修復、完了。' : ending === 'timeout' ? '——人理定礎、崩壊。' : '——特異点、観測終了。', [], { head: true });
      const sideOf = c => ({ id: c.id, side: c.side, label: c.label, trueName: c.sv.trueName, cls: c.sv.class.label, servantId: c.sv.id, alive: c.alive, hp: Math.round(Math.max(0, c.hp)),
        fate: c.fate, kills: c.kills.map(i => camps[i].sv.trueName), npUses: c.npUses, battles: c.battles, power: r1(c.sv.power), bond: Math.round(c.bond), front: P.front0.includes(c.id) });
      const result = {
        seed: A.seed, name: L.name, city: L.city, region: L.region, words: L.words, days: day, maxDays, ending,
        slain: P.slain, foes: foes.length, stage: P.stage, cs: P.cs, revived: P.revived, strayJoined: P.strayJoined, master: P.master.name,
        party: party.map(sideOf), enemies: foes.map(sideOf), boss: boss ? Object.assign(sideOf(boss), { gauges: boss.gauges, gaugeMax: boss.gaugeMax, empowered: !!boss.empowered }) : null,
        stray: stray ? sideOf(stray) : null, entries: A.entries,
      };
      Object.assign(A.out, result);
      return result;
    }
    return plugin;
  }

  /** 特異点を始める（engine.js の warGen を特異点の進行で動かす）。opts: { roster, bosses, seed, lineup?, picks?, front?, ask, out, playerName, days?, sing? } */
  function gen(opts) {
    opts = Object.assign({}, opts);
    opts.seed = opts.seed || Math.random().toString(36).slice(2, 8);
    const lineup = opts.lineup || compose(opts);
    const plugin = makePlugin(opts, lineup);
    const S = Object.assign({}, G.CONFIG.SING, opts.sing || {});
    return G.engine.warGen({ roster: opts.roster, seed: opts.seed, ask: opts.ask || 'never', out: opts.out, sing: plugin, playerName: opts.playerName, engine: { knowNameMult: S.knowNameMult } });
  }
  /** 全自動で最後まで（方針は focus(day) か「おまかせ」、問いはすべておまかせ） */
  function run(opts) {
    const g = gen(Object.assign({}, opts, { ask: opts && opts.ask ? opts.ask : 'never' }));
    let r = g.next();
    while (!r.done) r = g.next(r.value && r.value.type === 'tick' ? (opts && opts.focus ? opts.focus(r.value.day) : 'auto') : 'auto');
    return r.value;
  }

  G.singularity = { compose, gen, run, prepareBoss, prepareBosses, bossFromRoster, FOCUS, FOCUS_BY_CODE, SIDE_JA };
})(globalThis.HGW = globalThis.HGW || {});
