/* 聖杯戦争で試す：リストツール（roster.html）で、手元のリストと設定の数値のまま全自動の聖杯戦争をたくさん回し、
 * 英霊ごとの総合の優勝率（聖杯を手にした割合）と、半数が脱落する日を数える。公開しなくても調整の結果が分かる。
 *
 * 前半（core）は画面を使わない。Web Worker（js/simworker.js）と Node のテスト（test/simlab.js）からも同じものを使う。
 *   設定の差し替え：patch = { 'ENGINE.huntBase': 0.5, 'BATTLE_K': 18, 'NP_TYPE.anti_fort.power': 1.4, … }
 *     G.CONFIG の数値をその場で書き換える（applyConfig は元に戻す関数を返す）。数値でない所・無い所は無視。
 *   集計：survival.js の tally と同じ形（servants: { id: { n, w, d } }）に、決着（ends）・日数・戦闘と宝具の回数を足したもの。
 *   戦争の種は survival.js と同じ 'sv0', 'sv1', …（設定もリストも同じなら data/survival.json と同じ結果になる）。
 * 後半（mount）が画面。roster.html の「聖杯戦争で試す」に出す。
 */
(function (G) {
  'use strict';

  // ---------- core ----------
  function getPath(path) { return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), G.CONFIG); }
  function setPath(path, v) {
    const ks = String(path).split('.'); let o = G.CONFIG;
    for (const k of ks.slice(0, -1)) { o = o[k]; if (o == null || typeof o !== 'object') return false; }
    const last = ks[ks.length - 1];
    if (typeof o[last] !== 'number') return false;
    o[last] = v; return true;
  }
  /** 設定の数値を差し替える。戻り値を呼ぶと元に戻る */
  function applyConfig(patch) {
    const old = {};
    for (const [p, v] of Object.entries(patch || {})) {
      const cur = getPath(p);
      if (typeof cur === 'number' && typeof v === 'number' && isFinite(v) && setPath(p, v)) old[p] = cur;
    }
    return () => { for (const [p, v] of Object.entries(old)) setPath(p, v); };
  }
  /** 公開用と同じ軽い形のリストを、今の設定で組み直す。overrides を渡すと手直し表をそれに入れ替えてから組む */
  function buildRoster(lean, overrides) {
    if (overrides) {
      const T = G.effects.OVERRIDE_TABLES;
      for (const k in T) { for (const x of Object.keys(T[k])) delete T[k][x]; Object.assign(T[k], overrides[k] || {}); }
    }
    const byId = new Map(); let errors = 0;
    for (const s of lean || []) { try { const b = G.build.fromJSON(s); byId.set(b.id, b); } catch (e) { errors++; } }
    const roster = [...byId.values()];
    roster.errors = errors;
    return roster;
  }
  function emptyTally(days) {
    return { format: 'hgw-lab', wars: 0, errors: 0, days: days || G.CONFIG.ENGINE.maxDays, ends: { win: 0, wipe: 0, draw: 0 }, len: [], battles: 0, nps: 0, servants: {} };
  }
  /** i 回目の戦争を回して集計に足す（観測者として・固定のマスターなし） */
  function runOne(roster, i, t, seedBase) {
    let res;
    try { res = G.engine.runWar({ roster, seed: (seedBase || 'sv') + i, player: 'none', masters: [], engine: { maxDays: t.days } }); }
    catch (e) { t.wars++; t.errors++; return null; }
    G.survival.tally(t, res);
    t.ends[res.ending] = (t.ends[res.ending] || 0) + 1;
    const d = Math.max(1, Math.min(t.days, res.days || t.days)) - 1;
    while (t.len.length <= d) t.len.push(0);
    t.len[d]++;
    for (const c of res.camps) { t.battles += c.battles; t.nps += c.npUses; }
    return res;
  }
  /** list を ids の並び（公開中のリストの並び）にそろえる。ids に無いもの（未公開の追加）は後ろに、元の順で。
   *  聖杯戦争の顔ぶれはリストの並び順でも変わるので、並びが違うと同じ種でも別の戦争になり、公開中の集計と比べられない */
  function orderLike(list, ids, keyOf) {
    if (!ids || !ids.length) return list.slice();
    const at = new Map(ids.map((id, i) => [id, i])), key = keyOf || (s => s.id);
    return list.map((s, i) => [s, at.has(key(s)) ? at.get(key(s)) : ids.length + i]).sort((x, y) => x[1] - y[1]).map(x => x[0]);
  }
  /** 集計を足し合わせる（a に b を足す。並列に回した分をまとめる） */
  function merge(a, b) {
    a.wars += b.wars; a.errors += b.errors; a.battles += b.battles; a.nps += b.nps;
    for (const k in b.ends) a.ends[k] = (a.ends[k] || 0) + b.ends[k];
    b.len.forEach((v, i) => { a.len[i] = (a.len[i] || 0) + v; });
    for (const [id, s] of Object.entries(b.servants)) {
      const x = a.servants[id] || (a.servants[id] = { n: 0, w: 0, d: [] });
      x.n += s.n; x.w += s.w; s.d.forEach((v, i) => { x.d[i] = (x.d[i] || 0) + v; });
    }
    return a;
  }
  /** 英霊ごとの行：優勝率・ゆれ幅（95%）・半数が脱落する日 */
  function rowsOf(t) {
    const out = {};
    for (const [id, s] of Object.entries(t.servants || {})) {
      if (!s.n) continue;
      const p = s.w / s.n, q = Math.min(0.99, Math.max(p, 1 / s.n));
      const curve = G.survival.curveOf(s, t.days || 30);
      out[id] = { id, n: s.n, w: s.w, rate: p, margin: 1.96 * Math.sqrt(q * (1 - q) / s.n), med: curve ? G.survival.median(curve) : null };
    }
    return out;
  }
  /** 戦争全体のまとめ */
  function summaryOf(t) {
    const n = Math.max(1, t.wars - t.errors);
    let acc = 0, med = null; const half = n / 2;
    for (let i = 0; i < t.len.length; i++) { acc += t.len[i] || 0; if (acc >= half) { med = i + 1; break; } }
    return { wars: t.wars, errors: t.errors, win: t.ends.win / n, wipe: (t.ends.wipe || 0) / n, draw: t.ends.draw / n, medDays: med, battles: t.battles / 2 / n, nps: t.nps / n };
  }

  // ---------- 設定の数値の一覧（画面で変えられるもの） ----------
  // 観測者として回すので、プレイヤーにしか起きないもの（日常・作戦会議・巻き込まれ・令呪奪い）は出さない
  const SKIP = { 'ENGINE.lifeChance': 1, 'ENGINE.councilEvery': 1, 'ENGINE.fallenDeath': 1, 'ENGINE.stealBase': 1 };
  const LABEL = {
    'ENGINE.dmgBase': '打ち勝ったときに与える傷の基本値', 'ENGINE.dmgVar': '与える傷の揺れ幅（0〜この値を足す）',
    BATTLE_K: '戦闘の勝率曲線の幅（戦闘力の差がこの値で約73%:27%。大きいほど番狂わせが起きやすい）',
    'WAR.extraChance': '1回の戦争でエクストラクラスが1騎まぎれ込む確率',
  };
  const RANKS = ['E', 'D', 'C', 'B', 'A', 'EX'];
  const STAT_JA = { str: '筋力', end: '耐久', agi: '敏捷', mag: '魔力', luk: '幸運' };
  function groups() {
    const C = G.CONFIG, num = (o, pre) => Object.keys(o).filter(k => typeof o[k] === 'number' && !SKIP[pre + k]).map(k => pre + k);
    const gs = [
      { id: 'engine', title: '聖杯戦争の進み方（ENGINE）', paths: num(C.ENGINE, 'ENGINE.') },
      { id: 'battle', title: '戦闘の勝率曲線（BATTLE_K）', paths: ['BATTLE_K'] },
      { id: 'statScore', title: 'ステータスのスコア（STAT_SCORE：筋力〜幸運のランク）', paths: RANKS.filter(r => typeof C.STAT_SCORE[r] === 'number').map(r => 'STAT_SCORE.' + r), label: p => `ランク ${p.split('.')[1]}` },
      { id: 'statW', title: 'ステータスの重み（STAT_W：戦闘力への寄与）', paths: num(C.STAT_W, 'STAT_W.'), label: p => STAT_JA[p.split('.')[1]] || p },
      { id: 'statFx', title: 'ステータスの役割（STAT_FX）', paths: num(C.STAT_FX, 'STAT_FX.') },
      { id: 'npType', title: '宝具の種別（NP_TYPE：威力・魔力消費・露見しやすさ）', paths: [].concat(...Object.keys(C.NP_TYPE).map(k => ['power', 'cost', 'exposure'].filter(f => typeof C.NP_TYPE[k][f] === 'number').map(f => `NP_TYPE.${k}.${f}`))),
        label: p => { const [, k, f] = p.split('.'); return `${C.NP_TYPE[k].name} ${{ power: '威力', cost: '魔力消費', exposure: '露見' }[f]}`; } },
      { id: 'rankScore', title: 'ランクのスコア（RANK_SCORE：宝具の威力・マスターの能力値）', paths: RANKS.filter(r => typeof C.RANK_SCORE[r] === 'number').map(r => 'RANK_SCORE.' + r), label: p => `ランク ${p.split('.')[1]}` },
      { id: 'class', title: 'クラスの燃費（CLASS_DEFS の upkeep：維持魔力の倍率）', paths: Object.keys(C.CLASS_DEFS).filter(k => typeof C.CLASS_DEFS[k].upkeep === 'number').map(k => `CLASS_DEFS.${k}.upkeep`), label: p => C.CLASS_DEFS[p.split('.')[1]].label },
      { id: 'war', title: '聖杯戦争の組み方（WAR）', paths: ['WAR.extraChance'] },
    ];
    return gs.filter(g => g.paths.length);
  }
  /** js/config.js の行末の説明（// …）を、'ENGINE.huntBase' などの名前で引けるようにする */
  function commentsOf(src) {
    const out = {}; let block = '', last = null;
    for (const ln of String(src || '').split('\n')) {
      const b = ln.match(/^\s{4}(ENGINE|STAT_FX|WAR): \{/); if (b) { block = b[1]; last = null; continue; }
      if (block && /^\s{4}\},?\s*$/.test(ln)) { block = ''; last = null; continue; }
      if (!block) continue;
      const m = ln.match(/^\s*(\w+):\s*[-\d.]+,?\s*(?:\w+:\s*[-\d.]+,?\s*)*\/\/\s*(.+)$/);
      if (m) { last = block + '.' + m[1]; out[last] = m[2].trim(); continue; }
      const c = ln.match(/^\s*\/\/\s*(.+)$/);
      if (c && last) { out[last] += c[1].trim(); continue; }
      last = null;
    }
    return out;
  }

  // ---------- 画面 ----------
  /**
   * el に「聖杯戦争で試す」を組み立てる。api：
   *   roster(): 今のリスト（組み立て済み）／ overrides(): 手直し表
   *   order(): 公開中のリストの並び（Wiki での id の配列。無ければ null）／ pubFp(): 公開中のリストの指紋（無ければ null）
   *   grade(sv): 1対1の評価（S〜E）／ local(sv): 'new'|'changed'|null（未公開の変更）／ open(id): その騎を一覧で開く
   */
  function mount(el, api) {
    const $ = s => el.querySelector(s);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const KEY = 'hgw.lab.v1', LAST = 'hgw.lab.last', SAVED = 'hgw.lab.saved';
    const store = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v == null ? '' : JSON.stringify(v)); if (v == null) localStorage.removeItem(k); return true; } catch (e) { return false; } } };
    const st = Object.assign({ patch: {}, wars: 3000, cmp: 'pub', sort: 'rate', q: '', cls: '' }, store.get(KEY, {}));
    const keep = () => store.set(KEY, { patch: st.patch, wars: st.wars, cmp: st.cmp, sort: st.sort });
    const GS = groups(), DEF = {};
    for (const g of GS) for (const p of g.paths) DEF[p] = getPath(p);
    for (const p of Object.keys(st.patch)) if (!(p in DEF) || st.patch[p] === DEF[p]) delete st.patch[p];
    let notes = {};
    let last = store.get(LAST, null), saved = store.get(SAVED, null), pubT = null, pubErr = '';
    let job = null, runFp = null;

    el.innerHTML = `
<section class="panel">
  <h2>聖杯戦争で試す <span class="hint" style="font-weight:400;letter-spacing:0">総合の優勝率</span></h2>
  <p class="hint" style="margin:0 0 8px">このブラウザのリスト（未公開の追加・手直しも含む）と下の設定の数値で、全自動の聖杯戦争をたくさん回し、英霊ごとに聖杯を手にした割合（優勝率）と、半数が脱落する日を数えます。公開しなくても、調整した結果がここで分かります。リストを公開中の並びにそろえ、戦争の種も公開中の集計（data/survival.json：3000回）と同じにして回すので、3000回で何も変えていなければ公開中の数字とぴったりそろいます。回数が少ないと、登場の少ない英霊（エクストラクラスなど）ほど数字が大きく揺れます。</p>
  <div class="row">
    <label class="hint">回数 <select id="labN"><option>300</option><option>1000</option><option>3000</option><option>10000</option></select></label>
    <button class="primary" id="labRun">回す</button>
    <button id="labStop" hidden>止める</button>
    <span class="hint" id="labProg"></span>
  </div>
  <div class="labbar" id="labBar" hidden><i></i></div>
</section>
<section class="panel">
  <h2>設定の数値を試す <span class="hint" id="labPatchN" style="font-weight:400;letter-spacing:0"></span></h2>
  <p class="hint" style="margin:0 0 8px">ここで変えた数値は、この試しにだけ使います（ゲームにも公開中のリストにも効きません）。よい値が見つかったら、下の「config.js に書く値」を js/config.js に書き写してください。観戦（マスターなし）で回すので、プレイヤーにしか起きないもの（日常・作戦会議など）は出していません。</p>
  <div id="labCfg"></div>
  <div class="row" style="margin-top:8px">
    <button class="sm" id="labReset">すべて元に戻す</button>
    <button class="sm" id="labCopy">config.js に書く値をコピー</button>
  </div>
  <pre class="labdiff" id="labDiff" hidden></pre>
</section>
<section class="panel">
  <h2>結果</h2>
  <div id="labSum" class="hint"></div>
  <div class="row" style="margin:8px 0">
    <label class="hint">比べる相手 <select id="labCmp"><option value="pub">公開中の集計</option><option value="saved">保存した結果</option><option value="">比べない</option></select></label>
    <button class="sm" id="labSave">この結果を比べる相手として保存</button>
    <input type="search" id="labQ" placeholder="真名で探す" autocomplete="off" style="min-width:0;flex:1 1 140px">
    <select id="labCls" aria-label="クラスで絞る"></select>
  </div>
  <div class="hint" id="labCmpNote"></div>
  <div class="labwrap"><table class="labtbl" id="labTbl"></table></div>
  <p class="hint" style="margin:8px 0 0">優勝率の「±」は、回数が少ないことによる揺れの目安（95%）です。差は、両方の揺れを足した幅より大きいときだけ色を付けています（同じ種で回しているので、実際の揺れはこれより小さめです）。「1対1」はリストの評価（1対1の勝ちやすさ、S〜E）です。</p>
</section>`;

    // --- 設定の欄 ---
    function renderCfg() {
      $('#labCfg').innerHTML = GS.map(g => {
        const ch = g.paths.filter(p => p in st.patch).length;
        return `<details class="labgrp" data-g="${g.id}"${ch ? ' open' : ''}><summary>${esc(g.title)}${ch ? ` <b class="labch">${ch}件変更</b>` : ''}</summary><div class="labgrid">${g.paths.map(p => {
          const lab = LABEL[p] || notes[p] || '';
          const name = g.label ? g.label(p) : p.replace(/^[A-Z_]+\./, '');
          const v = p in st.patch ? st.patch[p] : DEF[p];
          return `<label class="labf${p in st.patch ? ' on' : ''}" title="${esc(p)}"><span class="lk">${esc(name)}${lab ? `<small>${esc(lab)}</small>` : ''}</span><span class="lv"><input type="number" step="any" data-p="${esc(p)}" value="${esc(v)}"><small>元 ${esc(DEF[p])}</small>${p in st.patch ? `<button class="sm ghost" data-undo="${esc(p)}" title="元に戻す">↺</button>` : ''}</span></label>`;
        }).join('')}</div></details>`;
      }).join('');
      const n = Object.keys(st.patch).length;
      $('#labPatchN').textContent = n ? `${n}件を変えています` : '';
      $('#labDiff').hidden = !n;
      $('#labDiff').textContent = diffText();
    }
    function diffText() {
      return Object.keys(st.patch).map(p => `${p}: ${DEF[p]} → ${st.patch[p]}`).join('\n');
    }
    $('#labCfg').addEventListener('change', e => {
      const i = e.target.closest('input[data-p]'); if (!i) return;
      const p = i.dataset.p, v = parseFloat(i.value);
      if (!isFinite(v) || v === DEF[p]) delete st.patch[p]; else st.patch[p] = v;
      keep(); renderCfg(); renderRes();
    });
    $('#labCfg').addEventListener('click', e => {
      const b = e.target.closest('[data-undo]'); if (!b) return;
      e.preventDefault(); delete st.patch[b.dataset.undo]; keep(); renderCfg(); renderRes();
    });
    $('#labReset').addEventListener('click', () => { st.patch = {}; keep(); renderCfg(); renderRes(); });
    $('#labCopy').addEventListener('click', async () => {
      const t = diffText() || '（変えた数値はありません）';
      try { await navigator.clipboard.writeText(t); $('#labCopy').textContent = 'コピーしました'; } catch (e) { $('#labDiff').hidden = false; }
      setTimeout(() => { $('#labCopy').textContent = 'config.js に書く値をコピー'; }, 1600);
    });
    if (/^https?:$/.test(location.protocol)) {
      fetch('js/config.js', { cache: 'no-cache' }).then(r => (r.ok ? r.text() : '')).then(t => { notes = commentsOf(t); renderCfg(); }).catch(() => {});
      fetch('data/survival.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).then(j => { pubT = j && j.servants ? j : null; if (!pubT) pubErr = '公開中の集計（data/survival.json）がありません'; renderRes(); }).catch(() => { pubErr = '公開中の集計を読めませんでした'; renderRes(); });
    } else pubErr = 'ファイルを直接開いているので、公開中の集計を読めません';

    // --- 回す ---
    $('#labN').value = String(st.wars);
    $('#labN').addEventListener('change', () => { st.wars = +$('#labN').value || 1000; keep(); });
    const fpNow = () => G.survival.fingerprint(api.roster());
    const patchKey = p => JSON.stringify(Object.keys(p || {}).sort().map(k => [k, p[k]]));
    function progress(done, total, t0, par) {
      const bar = $('#labBar'); bar.hidden = false; bar.firstChild.style.width = (100 * done / total).toFixed(1) + '%';
      $('#labProg').textContent = `${done} / ${total} 回${par > 1 ? `（${par}並列）` : ''}・${((Date.now() - t0) / 1000).toFixed(0)}秒`;
    }
    function finish(t, total, t0, stopped) {
      job = null;
      $('#labRun').hidden = false; $('#labStop').hidden = true; $('#labBar').hidden = true;
      $('#labProg').textContent = `${stopped ? '止めました：' : ''}${t.wars}回・${((Date.now() - t0) / 1000).toFixed(1)}秒${t.errors ? `・エラー ${t.errors}回` : ''}`;
      if (!t.wars) return;
      last = { at: Date.now(), fp: fpNow(), runFp, patch: Object.assign({}, st.patch), tally: t };
      if (!store.set(LAST, last)) store.set(LAST, null);
      renderRes();
    }
    function run() {
      if (job) return;
      const total = st.wars, roster = api.roster();
      if (roster.length < 2) { $('#labProg').textContent = 'リストに2騎以上必要です'; return; }
      // 公開中の並びにそろえる（並びが違うと、同じ種でも顔ぶれが変わって別の戦争になる）
      const ordered = orderLike(roster, api.order ? api.order() : null, G.build.wikiId);
      const lean = ordered.map(G.build.toLean), ov = api.overrides(), patch = Object.assign({}, st.patch);
      runFp = G.survival.fingerprint(ordered);
      const days = (patch['ENGINE.maxDays'] || DEF['ENGINE.maxDays'] || 30);
      const t = emptyTally(days), t0 = Date.now();
      $('#labRun').hidden = true; $('#labStop').hidden = false;
      let par = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1, Math.ceil(total / 50)));
      let workers = [];
      try { if (typeof Worker === 'undefined' || !/^https?:$/.test(location.protocol)) throw new Error('no worker'); for (let k = 0; k < par; k++) workers.push(new Worker('js/simworker.js')); }
      catch (e) { workers.forEach(w => w.terminate()); workers = []; }
      if (workers.length) {
        let left = workers.length;
        job = { stop() { workers.forEach(w => w.terminate()); finish(t, total, t0, true); } };
        workers.forEach((w, k) => {
          w.onmessage = e => {
            const m = e.data; if (!job) return;
            merge(t, m.tally); progress(t.wars, total, t0, workers.length);
            if (m.type === 'done') { w.terminate(); if (--left === 0) finish(t, total, t0, false); }
          };
          w.onerror = () => { w.terminate(); if (job && --left === 0) finish(t, total, t0, false); };
          w.postMessage({ type: 'run', lean, overrides: ov, patch, start: k, step: workers.length, total, days });
        });
        progress(0, total, t0, workers.length);
        return;
      }
      // Worker が使えないとき（ファイルを直接開いた等）：この画面のまま少しずつ回す
      const undo0 = applyConfig(patch); let built;
      try { built = buildRoster(lean, null); } finally { undo0(); }
      let i = 0, stopped = false;
      job = { stop() { stopped = true; } };
      const tick = () => {
        if (stopped) { finish(t, total, t0, true); return; }
        const undo = applyConfig(patch);
        try { const end = Math.min(total, i + 4); for (; i < end; i++) runOne(built, i, t); } finally { undo(); }
        progress(t.wars, total, t0, 1);
        if (i >= total) finish(t, total, t0, false); else setTimeout(tick, 0);
      };
      progress(0, total, t0, 1); setTimeout(tick, 0);
    }
    $('#labRun').addEventListener('click', run);
    $('#labStop').addEventListener('click', () => { if (job) job.stop(); });

    // --- 結果 ---
    $('#labCmp').value = st.cmp;
    $('#labCmp').addEventListener('change', () => { st.cmp = $('#labCmp').value; keep(); renderRes(); });
    $('#labSave').addEventListener('click', () => {
      if (!last) return;
      saved = { at: last.at, patch: last.patch, rows: rowsOf(last.tally), sum: summaryOf(last.tally) };
      store.set(SAVED, saved); st.cmp = 'saved'; $('#labCmp').value = 'saved'; keep(); renderRes();
    });
    $('#labQ').addEventListener('input', () => { st.q = $('#labQ').value; renderRes(); });
    $('#labCls').addEventListener('change', () => { st.cls = $('#labCls').value; renderRes(); });
    $('#labTbl').addEventListener('click', e => {
      const h = e.target.closest('[data-sort]'); if (h) { st.sort = st.sort === h.dataset.sort ? h.dataset.sort + '-' : h.dataset.sort; keep(); renderRes(); return; }
      const r = e.target.closest('[data-open]'); if (r && api.open) api.open(r.dataset.open);
    });
    const pc = x => (x == null ? '—' : (x * 100).toFixed(1) + '%');
    const fold = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/[\s・･=＝]/g, '');
    function cmpRows() {
      if (st.cmp === 'saved') return saved ? { rows: saved.rows, sum: saved.sum, label: `保存した結果（${new Date(saved.at).toLocaleString('ja-JP')}${Object.keys(saved.patch || {}).length ? `・数値を${Object.keys(saved.patch).length}件変えたもの` : ''}）` } : { rows: null, note: 'まだ保存した結果がありません。「この結果を比べる相手として保存」で置けます。' };
      if (st.cmp === 'pub') {
        if (!pubT) return { rows: null, note: pubErr || '公開中の集計を読んでいます…' };
        const pf = api.pubFp ? api.pubFp() : null, notes = [];
        if (pf && pubT.fp !== pf) notes.push('公開中の集計は、いま公開中のリストより古いものです（データの反映が集計を作り直すまで、差には古さも混じります）');
        if (last && last.tally.wars !== pubT.wars) notes.push(`回数が公開中の集計（${pubT.wars}回）と違うので、差には回数の少なさによる揺れも混じります。${pubT.wars}回で回すと、変えていない英霊はそろいます`);
        else if (last && last.runFp && last.runFp === pubT.fp && !Object.keys(last.patch || {}).length) notes.push('リストも設定も公開中と同じなので、公開中の集計と一致しています');
        return { rows: rowsOf(pubT), label: `公開中の集計（${pubT.wars}回）` + (notes.length ? '。' + notes.join('。') : '') };
      }
      return { rows: null };
    }
    function renderRes() {
      const roster = api.roster(), byId = new Map(roster.map(s => [s.id, s]));
      const clsKeys = [...new Set(roster.map(s => s.class.key))];
      const cs = $('#labCls'), cur = st.cls;
      cs.innerHTML = '<option value="">すべてのクラス</option>' + clsKeys.map(k => `<option value="${esc(k)}">${esc((G.CONFIG.CLASS_DEFS[k] || {}).label || roster.find(s => s.class.key === k).class.label)}</option>`).join('');
      cs.value = clsKeys.includes(cur) ? cur : '';
      const C = cmpRows();
      $('#labCmpNote').textContent = C.note || (C.label ? `比べる相手：${C.label}` : '');
      if (!last) { $('#labSum').textContent = 'まだ回していません。「回す」を押すと、ここに英霊ごとの優勝率が出ます（1000回で、並列なら十数秒ほど）。'; $('#labTbl').innerHTML = ''; return; }
      const S = summaryOf(last.tally), stale = [];
      if (last.fp !== G.survival.fingerprint(roster)) stale.push('リスト');
      if (patchKey(last.patch) !== patchKey(st.patch)) stale.push('設定の数値');
      const B0 = C.sum;
      const dl = (a, b, f) => (b == null ? '' : ` <small>(${f(a - b)})</small>`);
      const ppt = x => (x >= 0 ? '+' : '') + (x * 100).toFixed(1);
      $('#labSum').innerHTML = `${new Date(last.at).toLocaleString('ja-JP')}・${S.wars}回${Object.keys(last.patch || {}).length ? `・数値を${Object.keys(last.patch).length}件変えて` : ''}${S.errors ? `・<b class="neg">エラー ${S.errors}回</b>` : ''}<br>`
        + `勝者あり ${pc(S.win)}${dl(S.win, B0 && B0.win, ppt)}・全滅 ${pc(S.wipe)}${dl(S.wipe, B0 && B0.wipe, ppt)}・引き分け ${pc(S.draw)}${dl(S.draw, B0 && B0.draw, ppt)}・決着の日（中央） ${S.medDays || '—'}日・戦闘 ${S.battles.toFixed(1)}回／戦争・宝具 ${S.nps.toFixed(1)}回／戦争`
        + (stale.length ? `<br><b class="warn">結果を出したあとで${stale.join('と')}が変わっています。回し直すと今の状態の結果になります。</b>` : '');
      const rows = Object.values(rowsOf(last.tally)).filter(r => byId.has(r.id) || true);
      const base = C.rows;
      const all = rows.map(r => {
        const sv = byId.get(r.id), b = base ? base[r.id] : null;
        return Object.assign({}, r, { sv, name: sv ? sv.trueName : r.id.replace(/^[^:]*:/, ''), cls: sv ? sv.class.label : r.id.split(':')[0], key: sv ? sv.class.key : r.id.split(':')[0],
          b, diff: b ? r.rate - b.rate : null, noise: b ? Math.sqrt(r.margin * r.margin + (b.margin || 0) * (b.margin || 0)) : null, grade: sv && api.grade ? api.grade(sv) : '', local: sv && api.local ? api.local(sv) : null });
      });
      all.sort((x, y) => y.rate - x.rate || x.name.localeCompare(y.name, 'ja'));
      all.forEach((r, i) => { r.rank = i + 1; r.tier = G.gradeOfPct(i / Math.max(1, all.length - 1)); });
      const desc = !/-$/.test(st.sort), key = st.sort.replace(/-$/, '');
      const GO = { S: 0, A: 1, B: 2, C: 3, D: 4, E: 5 };
      const val = r => key === 'rate' ? r.rate : key === 'diff' ? (r.diff == null ? -9 : r.diff) : key === 'med' ? (r.med || 99) : key === 'n' ? r.n : key === 'grade' ? -(GO[r.grade] == null ? 9 : GO[r.grade]) : key === 'name' ? r.name : r.rate;
      const sorted = all.slice().sort((x, y) => { const a = val(x), b = val(y); const c = typeof a === 'string' ? a.localeCompare(b, 'ja') : a - b; return desc ? -c || x.rank - y.rank : c || x.rank - y.rank; });
      const q = fold(st.q);
      const shown = sorted.filter(r => (!q || fold(r.name).includes(q)) && (!st.cls || r.key === st.cls));
      const maxR = Math.max(0.01, ...all.map(r => r.rate));
      const th = (k, t, cls) => `<th class="${cls || ''}" data-sort="${k}" aria-sort="${key === k ? (desc ? 'descending' : 'ascending') : 'none'}">${t}${key === k ? (desc ? ' ▾' : ' ▴') : ''}</th>`;
      $('#labTbl').innerHTML = `<thead><tr><th class="n">#</th>${th('name', '英霊', 'nm')}${th('rate', '優勝率', 'r')}${base ? th('diff', '差', 'r') : ''}${th('med', '半数脱落', 'r')}${th('n', '登場', 'r')}${th('grade', '1対1', 'ce')}</tr></thead><tbody>`
        + shown.map(r => {
          const sig = r.diff != null && Math.abs(r.diff) > r.noise;
          return `<tr data-open="${esc(r.sv ? r.sv.id : '')}"><td class="n">${r.rank}<small>${r.tier}</small></td>`
            + `<td class="nm"><span title="${esc(r.name)}">${esc(r.name)}</span><small>${esc(r.cls)}${r.local ? ` <i class="lb">${r.local === 'new' ? '未公開の追加' : '未公開の変更'}</i>` : ''}</small></td>`
            + `<td class="r"><span class="lbar"><i style="width:${(100 * r.rate / maxR).toFixed(1)}%"></i></span>${pc(r.rate)}<small>±${(r.margin * 100).toFixed(1)}</small></td>`
            + (base ? `<td class="r${sig ? (r.diff > 0 ? ' up' : ' dn') : ''}">${r.diff == null ? '<small>—</small>' : ppt(r.diff)}<small>${r.b ? pc(r.b.rate) : ''}</small></td>` : '')
            + `<td class="r">${r.med ? r.med + '日' : '残る'}${r.b && r.b.med !== undefined && r.b.med !== r.med ? `<small>${r.b.med ? r.b.med + '日' : '残る'}</small>` : ''}</td>`
            + `<td class="r">${r.n}</td><td class="ce">${esc(r.grade)}</td></tr>`;
        }).join('') + '</tbody>';
    }
    renderCfg(); renderRes();
    return { refresh() { renderRes(); }, stop() { if (job) job.stop(); } };
  }

  G.simLab = { getPath, applyConfig, buildRoster, orderLike, emptyTally, runOne, merge, rowsOf, summaryOf, groups, commentsOf, mount };
})(globalThis.HGW = globalThis.HGW || {});
