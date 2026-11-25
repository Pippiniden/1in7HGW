// 聖杯戦争（index.html）と聖杯大戦（taisen.html）の画面。二つのページが同じこのファイルを読み、違いは GW（window.HGW_PAGE.gw）で分ける
(function () {
  'use strict';
  const H = window.HGW;
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // このスクリプトは index.html（聖杯戦争）と taisen.html（聖杯大戦）の両方が読む。taisen.html は先に window.HGW_PAGE = { gw: true } を置く
  const GW = !!(window.HGW_PAGE && window.HGW_PAGE.gw);
  const WAR = GW ? '聖杯大戦' : '聖杯戦争', TITLE = GW ? '14分の1の聖杯大戦' : '7分の1の聖杯戦争', N_JA = GW ? '十四' : '七';
  const NS = GW ? 'hgw.gw.' : 'hgw.', REC_FMT = GW ? 'hgw-gw-records' : 'hgw-records';   // 保存領域の名前の頭と、記録ファイルの形式（大戦は別に持つ）
  const DEF_DAYS = GW ? H.CONFIG.GREAT_WAR.days : H.CONFIG.ENGINE.maxDays, MIN_DAYS = 10, MAX_DAYS = 100;
  let maxDays = DEF_DAYS, extraOn = true, pickMode = 'class'; // この戦争の長さ、エクストラクラスを加えるか、七騎の選び方（class / open）
  let castEx = [];                                            // この戦争で参戦から外したサーヴァントの id
  let intrOn = true, intrForce = false, bossPool = [];        // ボス乱入を起こすか／条件を満たしたら必ず起こすか／乱入しうるボス専用の英霊
  let excluded = new Set(), exInited = false;                 // 最初の画面で参戦から外している id（設定）と、URL の ex を読んだか
  const FOCUS = H.engine.FOCUS, FOCUS_BY_CODE = Object.fromEntries(Object.entries(FOCUS).map(([k, v]) => [v.code, k]));
  const qs = new URLSearchParams(location.search);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let roster = [], masters = [], source = '';

  // ---------- データ ----------
  function dataReady(res, label) {
    roster = res.servants.filter(s => !s.bossOnly); masters = res.masters || []; source = label;   // ボス専用の英霊は聖杯戦争に呼ばれない（乱入するボスにはなる）
    bossPool = H.build.bossesOf(res).bosses;
    initExcluded();
    const err = res.errors && res.errors.length ? `<div class="err">読めなかったもの：${esc(res.errors.join('、'))}</div>` : '';
    const local = H.data.hasLocal() && label !== 'local' ? ` ・ <a href="#" id="useLocal">リストツールで作ったリスト（${H.data.hasLocal()}騎）を使う</a>` : '';
    const pub = label === 'local' ? ` ・ <a href="#" id="usePub">公開データに戻す</a>` : '';
    const retry = label === 'pub' && (roster.length < 2 || (res.errors && res.errors.length)) ? ` <button class="btn" type="button" id="reloadData">再読み込み</button>` : '';
    $('#data').innerHTML = roster.length >= 2 ? `<span id="castTxt"></span>（${label === 'local' ? 'このブラウザのリスト' : label === 'files' ? '選んだファイル' : '公開データ'}）${local}${pub}${err}${retry}`
      : `サーヴァントが足りません（${roster.length}騎）。${err}${retry}`;
    const ul = $('#useLocal'); if (ul) ul.onclick = e => { e.preventDefault(); dataReady(H.data.loadLocal(), 'local'); };
    const up = $('#usePub'); if (up) up.onclick = e => { e.preventDefault(); const u = new URL(location.href); u.searchParams.delete('data'); location.href = u; };
    const rl = $('#reloadData'); if (rl) rl.onclick = loadPub;
    buildCast(); syncCast();
  }

  // ---------- 参戦サーヴァントの設定 ----------
  // 戦争に呼ばれるサーヴァントを絞る。ゲームのコンセプトに反するので、最下部に目立たせずに置く。
  // 外した騎の id は excluded（画面の設定）に入れ、戦争には roster から外した castRosterOf() を渡す。
  // 何も外さなければ roster そのものを渡すので、今までと同じ戦争になる。
  const EX_KEY = NS + 'exclude.v1', MIN_CAST = GW ? 14 : 7;
  const exLoad = () => { try { const a = JSON.parse(localStorage.getItem(EX_KEY) || '[]'); return Array.isArray(a) ? a.filter(x => typeof x === 'string') : []; } catch (e) { return []; } };
  const exSave = () => { try { if (excluded.size) localStorage.setItem(EX_KEY, JSON.stringify([...excluded])); else localStorage.removeItem(EX_KEY); } catch (e) { /* 保存できなくても動く */ } };
  // URL の ex は、リスト（読み込んだ順）の番号を36進数にして . でつないだもの
  const exParam = ids => ids.map(id => roster.findIndex(s => s.id === id)).filter(i => i >= 0).map(i => i.toString(36)).join('.');
  const exFromParam = p => String(p || '').split('.').map(t => parseInt(t, 36)).filter(i => i >= 0 && i < roster.length).map(i => roster[i].id);
  const exIds = ids => (Array.isArray(ids) ? ids : []).filter(id => typeof id === 'string' && roster.some(s => s.id === id));
  // 共有リンク（seed あり）で開いたときは、リンクの ex だけを見る（保存した設定は使わない。長さ・クラスの選び方と同じ）
  function initExcluded() {
    const fromUrl = !exInited && qs.has('seed'); exInited = true;
    const have = new Set(roster.map(s => s.id));
    excluded = new Set((fromUrl ? exFromParam(qs.get('ex')) : exLoad()).filter(id => have.has(id)));
  }
  const castCount = () => roster.length - excluded.size;
  const castMin = () => Math.max(2, Math.min(MIN_CAST, roster.length)); // 七騎そろえるのに要る数（リストが少ないときはそれに合わせる）
  const castRosterOf = ids => { if (!ids.length) return roster; const x = new Set(ids); return roster.filter(s => !x.has(s.id)); };
  // クラスごとのまとまり（標準クラスは config.js の並び、エクストラはクラス名ごと）
  const castKey = s => s.class.key === 'extra' ? 'extra:' + (s.class.label || '') : s.class.key;
  function castGroups() {
    const defs = Object.keys(H.CONFIG.CLASS_DEFS), g = new Map();
    roster.forEach((s, i) => {
      const k = castKey(s);
      if (!g.has(k)) g.set(k, { key: k, label: (k.indexOf('extra:') === 0 ? s.class.label : (H.CONFIG.CLASS_DEFS[k] || {}).label) || s.class.label || k, idx: [] });
      g.get(k).idx.push(i);
    });
    const rank = k => { const j = defs.indexOf(k.indexOf('extra:') === 0 ? 'extra' : k); return j < 0 ? 999 : j; };
    return [...g.values()].sort((a, b) => rank(a.key) - rank(b.key));
  }
  let castG = [];
  function buildCast() {
    $('#castBox').hidden = roster.length < 2;
    castG = castGroups();
    $('#castList').innerHTML = castG.map((g, gi) => `<div class="cast-cls" role="group" aria-label="${esc(g.label)}">
      <div class="cast-hd"><b>${esc(g.label)}</b><span class="n" data-n="${gi}"></span><button class="btn" type="button" data-g="${gi}" data-on="1">全選択</button><button class="btn" type="button" data-g="${gi}" data-on="0">全解除</button></div>
      <div class="cast-list">${g.idx.map(i => `<label class="cast-sv"><input type="checkbox" data-i="${i}"><span>${esc(roster[i].trueName)}</span></label>`).join('')}</div></div>`).join('');
  }
  // 画面を今の設定に合わせる（チェック・人数・開戦ボタン）
  function syncCast() {
    const n = castCount(), min = castMin();
    $('#castBox').querySelectorAll('input[data-i]').forEach(cb => { const on = !excluded.has(roster[+cb.dataset.i].id); cb.checked = on; cb.parentNode.classList.toggle('off', !on); });
    castG.forEach((g, gi) => { const el = $(`#castList [data-n="${gi}"]`); if (el) el.textContent = `${g.idx.filter(i => !excluded.has(roster[i].id)).length} / ${g.idx.length}`; });
    const sum = $('#castSum');
    sum.textContent = n < min ? `参戦するのは ${n} 騎です。開戦するには ${min} 騎以上が必要です。`
      : excluded.size ? `参戦するのは ${n} 騎です（全 ${roster.length} 騎のうち ${excluded.size} 騎を外しています）。` : `全 ${roster.length} 騎が参戦します（既定）。`;
    sum.classList.toggle('warn', n < min);
    const tx = $('#castTxt');
    if (tx) tx.innerHTML = excluded.size ? `参戦に設定した <b>${n}</b> 騎（全${roster.length}騎）から${N_JA}騎が選ばれる` : `<b>${roster.length}</b> 騎のサーヴァントから${N_JA}騎が選ばれる`;
    $('#go').disabled = n < min;
  }
  function setCast(idxs, on) {
    for (const i of idxs) { const id = roster[i].id; if (on) excluded.delete(id); else excluded.add(id); }
    exSave(); syncCast();
  }
  $('#castBox').addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('button'); if (!b) return;
    if (b.id === 'castAllOn') setCast(roster.map((s, i) => i), true);
    else if (b.id === 'castAllOff') setCast(roster.map((s, i) => i), false);
    else if (b.dataset.g != null && castG[+b.dataset.g]) setCast(castG[+b.dataset.g].idx, b.dataset.on === '1');
  });
  $('#castBox').addEventListener('change', e => { const t = e.target; if (t.matches && t.matches('input[data-i]')) setCast([+t.dataset.i], t.checked); });
  // ---------- 英霊図鑑の見え方（発見した英霊だけ／全公開）。表示だけの設定で、戦争には関わらない ----------
  const ZK = H.data.zukan;
  function syncZukan() {
    const el = $('#zkSum'); if (!el) return;
    const found = ZK.load(), all = roster.concat(bossPool.filter(b => !roster.includes(b)));
    const n = all.filter(s => found.has(s.id)).length;
    el.textContent = all.length ? `いま発見しているのは ${n} 騎（全 ${all.length} 騎）です。` : '';
    $('#zkOpen').checked = ZK.isOpen();
    $('#zkReset').disabled = !found.size;
  }
  if ($('#zkOpen')) {
    $('#zkOpen').addEventListener('change', e => { ZK.setOpen(e.target.checked); toast(e.target.checked ? '英霊図鑑を全公開にしました' : '英霊図鑑を、発見した英霊だけの表示に戻しました'); });
    $('#zkReset').addEventListener('click', () => {
      if (!confirm('英霊図鑑の発見をすべて消して、最初からにします。元には戻せません（戦争の記録や中断中の戦争は消えません）。よろしいですか？')) return;
      ZK.reset(); syncZukan(); toast('英霊図鑑の発見を消しました');
    });
    $('#castBox').addEventListener('toggle', syncZukan);
  }
  // 真名を知った英霊（自分のサーヴァントを含む）を図鑑に載せる
  function discover(sn) {
    const ids = [];
    for (const c of sn || []) if (c && (c.name || c.you)) { const id = metaOf(c.id).servantId; if (id) ids.push(id); }
    if (ids.length) ZK.add(ids);
  }
  function askFiles(msg) {
    $('#data').innerHTML = `${esc(msg)} <label class="file" for="pick">データのJSONファイルを選ぶ</label><input type="file" id="pick" accept=".json" multiple>`
      + (H.data.hasLocal() ? ` ・ <a href="#" id="useLocal">リストツールで作ったリスト（${H.data.hasLocal()}騎）を使う</a>` : '')
      + (location.protocol === 'file:' ? '' : ` <button class="btn" type="button" id="reloadData">再読み込み</button>`);
    $('#pick').onchange = async e => dataReady(await H.data.loadFiles(e.target.files), 'files');
    const rl = $('#reloadData'); if (rl) rl.onclick = loadPub;
    const ul = $('#useLocal'); if (ul) ul.onclick = e => { e.preventDefault(); dataReady(H.data.loadLocal(), 'local'); };
  }
  // 公開データを読む。通信が途切れて読めなかったときは、「再読み込み」ボタンからやり直せる
  async function loadPub() {
    $('#data').textContent = '読み込み中…';
    try { dataReady(await H.data.loadPublished('data/'), 'pub'); }
    catch (e) { askFiles(location.protocol === 'file:' ? 'ファイルを直接開いているため、公開データを自動で読めません。' : '公開データを読めませんでした（' + e.message + '）。'); }
  }
  (async () => {
    if (qs.get('data') === 'local' && H.data.hasLocal()) return dataReady(H.data.loadLocal(), 'local');
    await loadPub();
  })();
  if (qs.get('seed')) $('#seed').value = qs.get('seed');
  if (qs.get('view')) { const el = document.querySelector(`input[name=view][value="${qs.get('view')}"]`); if (el) el.checked = true; }
  // 戦争の長さとエクストラクラス：前回選んだものを覚えておく（共有リンクに書いてあればそちらが優先）
  // 令呪の紋様。読み込んだSVG（令呪デザイナー）か、シードで選ぶ既定の8種。見た目だけなので、URL・保存した戦争・記録には入らない
  const SEAL_KEY = 'hgw.seal.v1';
  let mySeal = null, sealRev = 0, sealMarkKey = '', sealN = 3;
  try { mySeal = H.sealmark.normalize(JSON.parse(localStorage.getItem(SEAL_KEY) || 'null')); } catch (e) { /* 読めなければ元の紋様 */ }
  const previewSeal = H.SEAL_DEFAULTS[Math.floor(Math.random() * H.SEAL_DEFAULTS.length)]; // 開戦前の見本。戦争の中身には関わらない
  const warSeal = () => mySeal || H.sealmark.defaultFor(out && out.seed);
  function setSeal(seal) {
    mySeal = seal; sealRev++;
    try { if (seal) localStorage.setItem(SEAL_KEY, JSON.stringify(seal)); else localStorage.removeItem(SEAL_KEY); }
    catch (e) { toast('令呪を保存できませんでした（この画面を閉じると元に戻ります）'); }
    renderSealField();
  }
  function renderSealField() {
    $('#sealPreview').innerHTML = H.sealmark.markup(mySeal || previewSeal, 3, 84);
    $('#sealReset').hidden = !mySeal;
    $('#sealName').textContent = !mySeal ? '' : (mySeal.name || 'あなたの令呪') + (H.sealmark.tagged(mySeal) ? '' : '（画の区別がないSVGなので、全画を使い切ると消える）');
  }
  const renderSealBig = () => { $('#sealBig').innerHTML = H.sealmark.markup(warSeal(), sealN, 360); $('#sealDlgTitle').textContent = `${mySeal && mySeal.name || '令呪'}（残り${sealN}画）`; };
  const closeSealDlg = () => $('#sealDlg').classList.remove('on');
  $('#sealFile').onchange = async e => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    const seal = H.sealmark.parse(await file.text(), file.name.replace(/\.svg$/i, ''));
    if (seal.error) return toast(seal.error);
    setSeal(seal);
    toast('令呪を刻みました');
  };
  $('#sealReset').onclick = () => setSeal(null);
  $('#sealZoom').onclick = () => { renderSealBig(); $('#sealDlg').classList.add('on'); };
  $('#sealClose').onclick = closeSealDlg;
  $('#sealDlg').addEventListener('click', e => { if (e.target.id === 'sealDlg') closeSealDlg(); });
  renderSealField();

  const SET_KEY = NS + 'settings';
  const clampDays = v => Math.max(MIN_DAYS, Math.min(MAX_DAYS, Math.round(+v) || DEF_DAYS));
  const formDays = () => clampDays($('#days').value);
  const formExtra = () => document.querySelector('input[name=extra]:checked').value !== '0';
  const formPick = () => document.querySelector('input[name=pick]:checked').value === 'open' ? 'open' : 'class';
  const formWords = () => document.querySelector('input[name=words]:checked').value !== '0';
  const formIntr = () => document.querySelector('input[name=intr]:checked').value !== '0';
  const formForce = () => $('#intrForce').checked;
  function setForm(days, extra, pick, intr, force) {
    const ie = document.querySelector(`input[name=intr][value="${intr === false ? 0 : 1}"]`); if (ie) ie.checked = true;
    $('#intrForce').checked = force === true;
    $('#days').value = clampDays(days); $('#daysOut').textContent = clampDays(days) + '日';
    const el = document.querySelector(`input[name=extra][value="${extra === false ? 0 : 1}"]`); if (el) el.checked = true;
    const pe = document.querySelector(`input[name=pick][value="${pick === 'open' ? 'open' : 'class'}"]`); if (pe) pe.checked = true;
  }
  let settings0 = null; // 前回の設定（名前の候補にも使う）
  (() => {
    let st = null; try { st = JSON.parse(localStorage.getItem(SET_KEY) || 'null'); } catch (e) { /* 読めなくてもよい */ }
    settings0 = st || {};
    if (st && st.words === false) document.querySelector('input[name=words][value="0"]').checked = true;
    // 最後に選んだ速さと「決断をおまかせ」は、別の聖杯戦争に移っても引き継ぐ
    const sp = document.querySelector(`input[name=speed][value="${+(st && st.speed)}"]`); if (sp) sp.checked = true;
    const d = qs.get('d') || (!GW && st && st.days) || DEF_DAYS, x = qs.has('x') ? qs.get('x') !== '0' : !(st && st.extra === false);
    const pk = qs.has('seed') ? (qs.get('p') === 'open' ? 'open' : 'class') : (st && st.pick) || 'class';
    const ib = qs.has('seed') ? qs.get('bj') !== '0' : !(st && st.intr === false), fc = qs.has('seed') ? qs.get('bf') === '1' : !!(st && st.force);
    setForm(d, x, pk, ib, fc);
  })();
  // 一言を聞くか・前回つけた名前も一緒に覚えておく（どちらも戦争の展開は変えない）
  const saveSettings = () => { try { localStorage.setItem(SET_KEY, JSON.stringify({ days: formDays(), extra: formExtra(), pick: formPick(), intr: formIntr(), force: formForce() || undefined, words: formWords(), name: settings0.name || undefined, master: settings0.master || undefined, speed: settings0.speed, auto: settings0.auto || undefined })); } catch (e) { /* 保存できなくても動く */ } };
  $('#days').addEventListener('input', () => { $('#daysOut').textContent = formDays() + '日'; });
  $('#days').addEventListener('change', saveSettings);
  document.querySelectorAll('input[name=extra], input[name=pick], input[name=words], input[name=intr], #intrForce').forEach(r => r.addEventListener('change', saveSettings));

  // ---------- 進行 ----------
  // エンジンは1日ごと（tick）と大きな決断（decision）で戻ってくる。
  // 七騎の組み方（エクストラクラスの有無と、選び方）
  const warOpts = () => { const w = {}; if (!extraOn) w.extra = false; if (pickMode === 'open') w.pick = 'open'; return Object.keys(w).length ? w : undefined; };
  // 記録（out.entries）を順に再生し、追いついたら tick には今の方針を渡して進め、decision なら問いを出す
  let gen = null, out = null, pending = null, done = false, result = null;
  let idx = 0, timer = null, speed = [1, 2, 4, 8].includes(+settings0.speed) ? +settings0.speed : 2, paused = false, view = 'you', seed = '';
  let choices = [], replay = [], focus = 'auto', focusLog = '', replayFocus = '', autoAll = settings0.auto === true, youId = null, curDay = 0, mode = 'new';
  // playerName：プレイヤーが付けた名前（空ならランダムで決まった名前）。words：残した一言 [{ key, at: 何件目の記録のあとか, day, q, text }]
  let playerName = '', playerSex = '', playerAge = 0, playerAli = '', playerPM = null, playerMM = '', words = [], wordAsked = new Set(), wordArm = [], wordsOn = true, catching = false;
  const DELAY = { quiet: 900, death: 2200, np: 1800, end: 1900, cs: 1600, summon: 1100, prologue: 1300, choice: 500, council: 900, life: 1400, world: 1400, ally: 1400 };

  function pump(answer) {
    const r = gen.next(answer);
    if (r.done) { done = true; result = r.value; pending = null; } else pending = r.value;
  }
  // 名前は20字まで（制御文字は除く）。空ならランダムで決まった名前
  const cleanPName = v => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 20);
  // 性別（'男' '女'、空ならランダム）と年齢（10〜99、0ならランダム）。URL では sx=m|f と ag=年齢
  const cleanSex = v => ({ m: '男', f: '女', '男': '男', '女': '女' })[String(v == null ? '' : v)] || '';
  const cleanAge = v => { const n = Math.round(Number(v)); return isFinite(n) && n >= 10 && n <= 99 ? n : 0; };
  // 属性（'LG' など2字、空ならランダム）。URL では al=lg
  const cleanAli = v => H.master.ALIGN.clean(v);
  // ---------- マイマスター（自分で決めたマスターの中身） ----------
  // 出自・出自の呼び名・能力値（ランク）・性格・願い・経歴。書いていない項目はランダムのまま（engine.js の playerMaster）。
  //   出自・能力値・性格は戦争の展開を変えるので、URL（mo ol ms mp wi pa）・中断・記録に一緒に残し、記録の照合（recordSig）にも入れる
  const MM_RANKS = ['EX', 'A+', 'A', 'B+', 'B', 'C+', 'C', 'D+', 'D', 'E+', 'E'];
  const MM_STATS = Object.keys(H.master.MASTER_STATS);
  const cleanRank = v => { const t = String(v == null ? '' : v).trim().toUpperCase(); return MM_RANKS.includes(t) ? t : ''; };
  const cleanTxt = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim().slice(0, n);
  function cleanPM(p) {
    if (!p || typeof p !== 'object') return null;
    const st = {}; for (const k of MM_STATS) { const r = cleanRank(p.stats && p.stats[k]); if (r) st[k] = r; }
    const o = { origin: H.master.ORIGINS[p.origin] ? p.origin : '', originLabel: cleanTxt(p.originLabel, 30), stats: st, persona: H.PERSONAS[p.persona] ? p.persona : '', wish: cleanTxt(p.wish, 60), past: cleanTxt(p.past, 200) };
    const r = {}; for (const [k, v] of Object.entries(o)) if (k === 'stats' ? Object.keys(v).length : v) r[k] = v;
    return Object.keys(r).length ? r : null;
  }
  // 展開を変える部分だけ（記録の照合用）
  const pmSig = pm => { pm = cleanPM(pm); if (!pm || !(pm.origin || pm.stats || pm.persona)) return ''; return 'pm:' + (pm.origin || '') + '/' + MM_STATS.map(k => (pm.stats && pm.stats[k]) || '').join('.') + '/' + (pm.persona || ''); };
  function pmFromQs() {
    const ms = String(qs.get('ms') || '').split('.');
    return cleanPM({ origin: qs.get('mo'), originLabel: qs.get('ol'), stats: Object.fromEntries(MM_STATS.map((k, i) => [k, ms[i]])), persona: qs.get('mp'), wish: qs.get('wi'), past: qs.get('pa') });
  }
  function pmToUrl(url, pm) {
    pm = pm || {};
    const set = (k, v) => { if (v) url.searchParams.set(k, v); else url.searchParams.delete(k); };
    const ms = MM_STATS.map(k => (pm.stats && pm.stats[k]) || '').join('.');
    set('mo', pm.origin); set('ol', pm.originLabel); set('ms', ms.replace(/\./g, '') ? ms : ''); set('mp', pm.persona); set('wi', pm.wish); set('pa', pm.past);
  }
  // 保存したマスターの一覧（聖杯戦争と聖杯大戦で共有）。{ on: 新しい戦争で使うか, sel: 使う一人の id, list: [{ id, name, sex, age, ali, pm }] }
  const MM_KEY = 'hgw.mymaster.v1', MM_MAX = 12;
  function cleanProfile(p) {
    if (!p || typeof p !== 'object') return null;
    return { id: cleanTxt(p.id, 20) || Math.random().toString(36).slice(2, 10), name: cleanPName(p.name), sex: cleanSex(p.sex), age: cleanAge(p.age), ali: cleanAli(p.ali), pm: cleanPM(p.pm) };
  }
  function loadMM() {
    let s = null; try { s = JSON.parse(localStorage.getItem(MM_KEY) || 'null'); } catch (e) { /* 読めなくてもよい */ }
    const list = (s && Array.isArray(s.list) ? s.list : []).map(cleanProfile).filter(Boolean).slice(0, MM_MAX);
    const sel = s && list.some(p => p.id === s.sel) ? s.sel : (list[0] || {}).id || '';
    return { on: !!(s && s.on) && !!list.length, sel, list };
  }
  let mm = loadMM();
  const saveMM = () => { try { localStorage.setItem(MM_KEY, JSON.stringify(mm)); } catch (e) { /* 保存できなくても動く */ } };
  const mmCur = () => mm.list.find(p => p.id === mm.sel) || null;
  const mmTitle = p => p.name || '名無しのマスター';
  // 新しく開戦するときのマスター（マイマスターを使う設定なら、その中身）
  const mmStartOpts = () => { const p = mm.on ? mmCur() : null; return p ? { name: p.name, sex: p.sex, age: p.age, ali: p.ali, pm: p.pm, mm: p.id } : {}; };
  const validWord = w => w && typeof w.text === 'string' && w.text && typeof w.at === 'number';
  // 戦争を組み立てる（名前を付け直すときも、同じシードで組み直す。名前は乱数を使わないので展開は変わらない）
  function makeGen() {
    out = {};
    gen = H.engine.warGen({ roster: castRosterOf(castEx), seed, player: view === 'all' ? 'none' : undefined, ask: GW || view !== 'all' ? 'big' : 'never', masters: masters.slice(), out, engine: { maxDays }, war: warOpts(), ...(GW ? { greatWar: true } : { intrude: { on: intrOn, force: intrForce, bosses: bossPool } }), playerSex: playerSex || undefined, playerAge: playerAge || undefined, playerAlign: playerAli || undefined, playerName: playerName || undefined, playerMaster: playerPM || undefined });
    pump();
  }
  // o: { seed, view, speed, days: 戦争の長さ, extra: エクストラクラスを加えるか, c: 決断の列, f: 方針の列, to: ここまで記録を一気に表示（続きから）, focus, auto, mode,
  //      name: 付けた名前, words: 残した一言 }
  //   mode … 'new'（開戦） / 'url'（共有リンクの再現） / 'resume'（続きから） / 'replay'（これまでの記録を再生）
  function start(o) {
    o = o || {};
    // 参戦を絞った戦争（記録・中断・共有リンクの再現では o.ex、新しく始めるときは画面の設定）
    const cx = Array.isArray(o.ex) ? exIds(o.ex) : [...excluded];
    if (roster.length - cx.length < castMin()) { toast(`参戦するサーヴァントが足りません（${castMin()}騎以上が必要です）`); return; }
    castEx = cx;
    mode = o.mode || 'new';
    seed = o.seed || $('#seed').value.trim() || Math.random().toString(36).slice(2, 8);
    view = o.view || document.querySelector('input[name=view]:checked').value;
    speed = +(o.speed || document.querySelector('input[name=speed]:checked').value);
    maxDays = clampDays(o.days || formDays());
    extraOn = o.extra != null ? o.extra !== false : formExtra();
    pickMode = o.pick ? (o.pick === 'open' ? 'open' : 'class') : formPick();
    intrOn = o.intr != null ? o.intr !== false : formIntr();
    intrForce = o.force != null ? o.force === true : formForce();
    replay = (o.c || []).filter(Boolean);
    replayFocus = o.f || '';
    $('#pause').disabled = false; $('#skip').disabled = false;
    choices = []; focusLog = ''; focus = 'auto'; out = {}; done = false; result = null; pending = null; idx = 0; paused = false; curDay = 0;
    playerName = view === 'all' ? '' : cleanPName(o.name);
    playerSex = view === 'all' ? '' : cleanSex(o.sex); playerAge = view === 'all' ? 0 : cleanAge(o.age); playerAli = view === 'all' ? '' : cleanAli(o.ali);
    playerPM = view === 'all' ? null : cleanPM(o.pm); playerMM = view === 'all' ? '' : o.mm || '';
    words = Array.isArray(o.words) ? o.words.filter(validWord) : []; wordAsked = new Set(words.map(w => w.key)); wordArm = [];
    // 一言は、記録の再生や共有リンクの再現では聞かない（残っている言葉は出す）
    wordsOn = formWords() && view !== 'all' && mode !== 'replay' && !(mode === 'url' && (replay.length || replayFocus));
    try { makeGen(); }
    catch (e) { $('#data').innerHTML = `<span class="err">開戦できませんでした：${esc(e.message)}</span>`; return; }
    youId = (out.entries.find(e => e.snap && e.snap.some(c => c.you)) || { snap: [] }).snap.findIndex(c => c.you);
    if (youId < 0) youId = null;
    document.body.classList.add('watching');
    document.body.classList.toggle('observer', youId == null);
    $('#log').innerHTML = ''; $('#result').innerHTML = ''; $('#logWrap').classList.remove('open'); lastSnap = []; setLogFilter('all'); $('#wordDlg').classList.remove('on'); $('#imgDlg').classList.remove('on');
    $('#lfYou').hidden = youId == null; $('#lore').classList.remove('on');
    $('#csvBtn').hidden = true; // CSVは戦争が終わってから
    $('#dayMax').textContent = '/' + maxDays; $('#calLbl').textContent = maxDays + '日の暦';
    drawSkyline(seed); lastScene = null; renderFocus(); syncCtl(); updateURL();
    hideDlg(); closeOpening(); toTop();
    // 続きから：中断したところまで、記録を一気に表示する（決断と方針は保存したものを使う）
    if (o.to) {
      if (FOCUS[o.focus]) focus = o.focus;
      if (o.auto != null) autoAll = !!o.auto;
      catchUp(o.to); renderFocus(); syncCtl(); updateURL();
      toast(`${curDay ? curDay + '日目' : '開戦'}から再開します`);
      timer = setTimeout(step, 600);
      return;
    }
    // マスターとして遊ぶときは、開戦の案内（マスター → サーヴァント → 方針）を出してから進める。記録の再現では出さない
    const replaying = replay.length || replayFocus || mode === 'replay';
    if (youId != null && !replaying) { board(out.entries.find(e => e.snap)); if (openOpening()) return; }
    step();
  }
  $('#go').onclick = () => {
    const same = qs.get('seed') && qs.get('seed') === $('#seed').value.trim();
    start(same ? { mode: 'url', c: qs.get('c') ? qs.get('c').split('.') : [], f: qs.get('f') || '', name: qs.get('n') || '', sex: qs.get('sx'), age: qs.get('ag'), ali: qs.get('al'), pm: pmFromQs() } : mmStartOpts());
  };
  // 記録を target 件目まで、待たずに表示する（途中の決断は replay から答える）
  function catchUp(target) {
    let guard = 0; catching = true;
    while (idx < target && guard++ < 50000) {
      if (idx < out.entries.length) { show(out.entries[idx++], true); continue; }
      if (pending && pending.type === 'tick') { advanceTick(); continue; }
      if (pending && pending.type === 'decision' && replay.length) { const k = replay.shift(); choices.push(k); pump(k); continue; }
      break;
    }
    catching = false;
    if (idx) board(out.entries[idx - 1]);
    syncLog();
  }

  function updateURL() {
    const url = new URL(location.href);
    url.searchParams.set('seed', seed); url.searchParams.set('view', view);
    if (choices.length) url.searchParams.set('c', choices.join('.')); else url.searchParams.delete('c');
    if (focusLog.replace(/o/g, '')) url.searchParams.set('f', focusLog); else url.searchParams.delete('f');
    if (source === 'local') url.searchParams.set('data', 'local'); else url.searchParams.delete('data');
    if (maxDays !== DEF_DAYS) url.searchParams.set('d', maxDays); else url.searchParams.delete('d');
    if (!extraOn) url.searchParams.set('x', '0'); else url.searchParams.delete('x');
    if (pickMode === 'open') url.searchParams.set('p', 'open'); else url.searchParams.delete('p');
    if (!intrOn) url.searchParams.set('bj', '0'); else url.searchParams.delete('bj');
    if (intrOn && intrForce) url.searchParams.set('bf', '1'); else url.searchParams.delete('bf');
    if (castEx.length) url.searchParams.set('ex', exParam(castEx)); else url.searchParams.delete('ex');
    if (playerName) url.searchParams.set('n', playerName); else url.searchParams.delete('n');
    if (playerSex) url.searchParams.set('sx', playerSex === '女' ? 'f' : 'm'); else url.searchParams.delete('sx');
    if (playerAge) url.searchParams.set('ag', playerAge); else url.searchParams.delete('ag');
    if (playerAli) url.searchParams.set('al', playerAli.toLowerCase()); else url.searchParams.delete('al');
    pmToUrl(url, playerPM);
    history.replaceState(null, '', url);
  }

  function syncCtl() {
    $('#pause').textContent = paused ? '▸ 再開' : '❚❚ 一時停止';
    document.querySelectorAll('[data-sp]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.sp === speed)));
    $('#autoBtn').setAttribute('aria-pressed', String(autoAll));
    $('#autoBtn2').setAttribute('aria-checked', String(autoAll)); $('#autoBtn2').setAttribute('aria-pressed', String(autoAll));
  }
  $('#pause').onclick = () => { paused = !paused; syncCtl(); clearTimeout(timer); if (!paused) step(); };
  // 速さと「決断をおまかせ」を、このブラウザに残す（次の戦争の開始時の既定になる）
  const rememberCtl = () => { settings0.speed = speed; settings0.auto = autoAll || undefined; saveSettings(); };
  document.querySelectorAll('[data-sp]').forEach(b => b.onclick = () => { speed = +b.dataset.sp; syncCtl(); rememberCtl(); });
  document.querySelectorAll('input[name=speed]').forEach(r => r.addEventListener('change', () => { speed = +r.value; rememberCtl(); }));
  const toggleAuto = () => { autoAll = !autoAll; syncCtl(); rememberCtl(); toast(autoAll ? '大きな決断はおまかせで進みます' : '大きな決断で止まります'); if (autoAll && pending && pending.type === 'decision' && $('#dlg').classList.contains('on')) answer('auto'); };
  $('#autoBtn').onclick = toggleAuto; $('#autoBtn2').onclick = () => { closeMenu(); toggleAuto(); };
  const quit = () => {
    if (wordKey === 'end') closeWord(''); // 終幕の一言の途中なら、聞かずに結末まで済ませて記録に残す
    const saved = saveProgress();
    clearTimeout(timer); hideDlg(); closeOpening(); loreResume = false; $('#lore').classList.remove('on'); $('#wordDlg').classList.remove('on'); wordKey = null; wordArm = []; closeImg(); document.body.classList.remove('watching'); toTop();
    renderIntroRecords();
    if (saved) toast('中断しました。「続きから」で再開できます');
  };
  $('#quitBtn').onclick = quit; $('#quitBtn2').onclick = () => { closeMenu(); quit(); };
  const closeMenu = () => { $('#menu').classList.remove('on'); $('#moreBtn').setAttribute('aria-expanded', 'false'); };
  $('#moreBtn').onclick = e => { e.stopPropagation(); const on = $('#menu').classList.toggle('on'); $('#moreBtn').setAttribute('aria-expanded', String(on)); };
  document.addEventListener('click', e => { if (!e.target.closest('#menu')) closeMenu(); if (!e.target.closest('#focusSheet') && !e.target.closest('#focusChip')) $('#focusSheet').classList.remove('on'); });

  // 次の決断（なければ最後）まで一気に進める
  $('#skip').onclick = () => {
    if (op || $('#wordDlg').classList.contains('on')) return;
    if ($('#dlg').classList.contains('on')) { $('#dlg').classList.remove('min'); return; }
    clearTimeout(timer);
    let guard = 0;
    while (guard++ < 5000) {
      if (idx < out.entries.length) { show(out.entries[idx++], true); continue; }
      if (pending && pending.type === 'tick') { advanceTick(); continue; }
      break;
    }
    if (idx) board(out.entries[idx - 1]);
    syncLog();
    if (pending && pending.type === 'decision') present(pending); else if (done) finish();
  };

  function advanceTick() {
    const d = pending.abs || pending.day;
    const code = replayFocus && replayFocus[d - 1] ? replayFocus[d - 1] : FOCUS[focus].code;
    const f = FOCUS_BY_CODE[code] || 'auto';
    focusLog = (focusLog + 'o'.repeat(Math.max(0, d - 1 - focusLog.length))).slice(0, d - 1) + FOCUS[f].code;
    pump(f);
  }

  function step() {
    if (!gen || paused || op || $('#lore').classList.contains('on') || $('#wordDlg').classList.contains('on')) return;
    clearTimeout(timer);
    if (idx < out.entries.length) {
      // 節目の一言は、次の日に移る前に聞く
      if (out.entries[idx].kind === 'dayhead') { armWord(out.entries[idx]); if (wordArm.length) return askWord(); }
      const e = out.entries[idx++];
      show(e, false);
      const base = DELAY[e.kind] || (e.big ? 1500 : e.kind === 'dayhead' ? 300 : 850);
      timer = setTimeout(step, base / speed + (e.quote ? 700 / speed : 0));
      return;
    }
    if (pending && pending.type === 'tick') { advanceTick(); updateURL(); saveProgress(); return step(); }
    if (pending && pending.type === 'decision') return present(pending);
    if (done) return finish();
  }

  // ---------- 大きな決断 ----------
  function present(q) {
    clearTimeout(timer);
    if (replay.length) return answer(replay.shift(), true);
    if (q.system) return presentGWEnd(q);   // 進行の選択は決断ではないので、おまかせでも必ず止まる
    if (autoAll) return answer('auto', true);
    $('#dlgWhen').textContent = `${q.day ? 'DAY ' + q.day + ' ・ ' : '開戦前 ・ '}${{ day: '昼', night: '夜', prologue: '' }[q.phase] || ''}`;
    $('#dlgTitle').textContent = q.title;
    $('#dlgBody').textContent = q.body || '';
    $('#dlgOpts').innerHTML = q.options.map((o, i) => `<button data-k="${esc(o.k)}"><span class="n">${i + 1}</span><b>${esc(o.label)}</b>${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</button>`).join('');
    $('#dlg').classList.remove('min'); $('#dlg').classList.add('on'); $('#dlgMin').textContent = 'いったん下ろす ▾';
    const first = $('#dlgOpts button'); if (first) first.focus({ preventScroll: true });
  }
  // 聖杯大戦の結果を出してから、この先の進め方を選んでもらう
  function presentGWEnd(q) {
    const c = q.colors[q.sideWinner], me = q.camps.find(x => x.you), left = q.camps.filter(x => x.alive && !x.overseer);
    const mine = me ? (me.alive && me.side === q.sideWinner ? 'あなたの陣営は生き残り、勝利を手にした。' : 'あなたの戦いは、ここまでに終わっていた。') : '';
    $('#result').innerHTML = `<section class="panel result" aria-label="聖杯大戦の結果"><div class="hd"><i class="chev"></i><span class="en">Result</span><span class="ja">聖杯大戦の結果・${q.day}日間</span></div><div class="body">
      <h4>${esc(c.name)}の陣営が聖杯大戦を制した</h4>
      <p>${esc(mine)}生き残りは${left.length}騎。</p>
      <table><tr><th>CLASS</th><th>真名</th><th>MASTER</th><th>結末</th></tr>
        ${q.camps.map(x => `<tr class="${x.alive && x.side === q.sideWinner ? 'win' : ''}"><td>${esc(x.label)}</td><td>${canLore(x.id) ? `<button class="namebtn" data-lore="${x.id}" title="解説を見る">${esc(x.trueName)}</button>` : esc(x.trueName)}</td><td>${esc(x.master)}</td><td>${esc(x.overseer ? (x.alive ? '監督役' : x.fate || '') : x.alive ? '生き残った' : x.fate || '')}${x.kills.length ? `<br><small>倒した相手：${esc(x.kills.join('、'))}</small>` : ''}</td></tr>`).join('')}
      </table>
      <p>この先の進め方を選んでください。${esc(q.options[0].sub)}。</p>
      <div class="acts">${q.options.map((o, i) => `<button class="btn${i ? '' : ' primary'}" data-gw="${esc(o.k)}">${esc(o.label)}</button>`).join('')}</div>
    </div></section>`;
    $('#result').querySelectorAll('[data-lore]').forEach(b => b.onclick = () => openLore(+b.dataset.lore));
    $('#result').querySelectorAll('[data-gw]').forEach(b => b.onclick = () => { $('#result').innerHTML = ''; window.scrollTo(0, 0); answer(b.dataset.gw); });
    $('#result').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  function hideDlg() { $('#dlg').classList.remove('on', 'min'); }
  function answer(k, silent) {
    hideDlg();
    choices.push(k); updateURL();
    pump(k); saveProgress();
    if (k === 'skip' || (GW && forwarding && !silent)) return fastForward();
    timer = setTimeout(step, silent ? 30 : 250);
  }
  // 聖杯戦争から降りたとき：結末まで一気に進める（残りの決断はおまかせ）
  let forwarding = false;   // 早送りの途中で大戦の結果に止まっても、選んだあとは早送りを続ける
  function fastForward() {
    clearTimeout(timer);
    forwarding = true;
    let guard = 0;
    while (!done && guard++ < 20000) {
      if (pending && pending.type === 'tick') advanceTick();
      else if (pending && pending.type === 'decision' && pending.system && !replay.length) {
        while (idx < out.entries.length) show(out.entries[idx++], true);
        board(out.entries[idx - 1]); syncLog(); updateURL();
        return presentGWEnd(pending);
      }
      else if (pending && pending.type === 'decision') { const k = replay.length ? replay.shift() : 'auto'; choices.push(k); pump(k); }
    }
    while (idx < out.entries.length) show(out.entries[idx++], true);
    updateURL(); toast('結末まで早送りしました');
    finish();
  }
  $('#dlgOpts').addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (b) answer(b.dataset.k); });
  $('#dlgMin').onclick = () => { const m = $('#dlg').classList.toggle('min'); $('#dlgMin').textContent = m ? '決断に戻る ▴' : 'いったん下ろす ▾'; };
  $('#dlgAuto').onclick = () => { autoAll = true; syncCtl(); rememberCtl(); answer('auto'); toast('これからの決断はおまかせで進みます。上の「決断をおまかせ」で戻せます'); };
  document.addEventListener('keydown', e => {
    if (e.target.closest('input, textarea')) return;
    if ($('#mmDlg').classList.contains('on')) { if (e.key === 'Escape') { e.preventDefault(); closeMM(); } return; }
    if ($('#sealDlg').classList.contains('on')) { if (e.key === 'Escape') { e.preventDefault(); closeSealDlg(); } return; }
    if ($('#imgDlg').classList.contains('on')) { if (e.key === 'Escape') { e.preventDefault(); closeImg(); } return; }
    if ($('#wordDlg').classList.contains('on')) { if (e.key === 'Escape') { e.preventDefault(); closeWord(''); } return; }
    if ($('#lore').classList.contains('on')) { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); closeLore(); } return; }
    if (op) {
      if (e.key === 'Enter') { e.preventDefault(); opNext(); }
      else if (op.step === 3 && +e.key >= 1) { const k = Object.keys(FOCUS)[+e.key - 1]; if (k) { e.preventDefault(); opPick(k); } }
      return;
    }
    if ($('#dlg').classList.contains('on') && !$('#dlg').classList.contains('min')) {
      const n = +e.key; if (n >= 1) { const b = document.querySelectorAll('#dlgOpts button')[n - 1]; if (b) { e.preventDefault(); answer(b.dataset.k); } }
      return;
    }
    if (e.key === ' ' && document.body.classList.contains('watching')) { e.preventDefault(); $('#pause').click(); }
  });

  // ---------- 方針 ----------
  function renderFocus() {
    const html = Object.entries(FOCUS).map(([k, f]) => `<button data-f="${k}" role="radio" aria-pressed="${k === focus}" aria-checked="${k === focus}"><span class="ico"></span>${esc(f.label)}</button>`).join('');
    $('#focusSeg').innerHTML = html; $('#focusSeg2').innerHTML = html;
    $('#focusDesc').textContent = FOCUS[focus].desc; $('#focusDesc2').textContent = FOCUS[focus].desc;
    $('#focusChipLabel').textContent = FOCUS[focus].label; $('#focusNow').textContent = FOCUS[focus].label;
  }
  function setFocus(k) { if (!FOCUS[k]) return; focus = k; replayFocus = ''; renderFocus(); }
  ['#focusSeg', '#focusSeg2'].forEach(sel => $(sel).addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (b) setFocus(b.dataset.f); }));
  $('#focusChip').onclick = e => { e.stopPropagation(); $('#focusSheet').classList.toggle('on'); };
  // パソコンでも方針の欄をたためる（スマホの「方針：○○ ▾」と同じく一行に格納）。たたんだかどうかはこのブラウザに残す
  const FC_KEY = 'hgw.focusCollapsed';
  function setFocusCollapsed(on, save) {
    $('#focusPanel').classList.toggle('collapsed', on);
    $('#focusToggle').setAttribute('aria-expanded', String(!on));
    $('#focusToggle').textContent = on ? 'ひらく ▾' : 'たたむ ▴';
    if (save) try { localStorage.setItem(FC_KEY, on ? '1' : '0'); } catch (e) { /* 保存できなくても動く */ }
  }
  try { setFocusCollapsed(localStorage.getItem(FC_KEY) === '1'); } catch (e) { setFocusCollapsed(false); }
  $('#focusToggle').onclick = e => { e.stopPropagation(); setFocusCollapsed(!$('#focusPanel').classList.contains('collapsed'), true); };
  $('#focusHead').onclick = () => { if ($('#focusPanel').classList.contains('collapsed')) setFocusCollapsed(false, true); };

  // ---------- 開戦の案内 ----------
  // マスターとして遊ぶとき、記録を流す前に「マスターの紹介 → サーヴァントの評価 → 最初の方針」を順に出す。
  // 方針を決めるまで1日目は始まらない（以前は「おまかせ」のまま1日目が進んでいた）
  let op = null; // { step, focus, rec, meta, snap }
  const ORIGIN_DESC = {
    noble: '魔術の名門に生まれ、豊かな魔力と家伝の知識を受け継いだ魔術師。拠点にははじめから工房がある。',
    newblood: '歴史の浅い家系の魔術師。腕も魔力も人並みだが、この戦いに家の名を賭けている。',
    mercenary: '魔術を道具として使う実戦の人。体と度胸で修羅場をくぐってきた。',
    civilian: '魔術とは縁のない暮らしから、偶然この戦いに巻き込まれた。魔力は乏しいが、運だけはある。',
    irregular: '生まれついての異能を持つ者。魔術師の常識には収まらない。',
  };
  const GRADE = {
    S: '聖杯に最も近い一騎。正面からの勝負で後れを取る相手はほとんどいない',
    A: '有力な優勝候補。多くの英霊と互角以上に渡り合える',
    B: '並み以上の力を持つ。戦い方しだいで十分に勝ち残れる',
    C: '多くの英霊と五分に渡り合う。戦い方と巡り合わせが勝敗を分ける',
    D: '正面からでは分の悪い相手も多い。策と運が要る',
    E: '勝ち残るのは至難。戦いを避けて機を待つ戦い方が向く',
  };
  // 最初の方針のおすすめ。同じ戦争を方針だけ変えて回し、方針を変えずに最後まで戦ったときに最も勝ちやすかったもの
  // （node test/focus.js で確かめられる。2000戦では、おまかせ 16% に対して、以前の特徴ごとのおすすめは 10% だった）。
  // おまかせは陣営の戦略に沿って、その晩の霊基や相手との力の差を見て出撃を決めるので、方針で毎晩の動きを固定するより強い。
  // 評価B〜Dの英霊は、休養（出撃せずに傷を癒やす）で他の陣営どうしの潰し合いを待つほうが勝ちやすい。評価Eはどれでも
  // ほとんど勝てないが、潜伏がいちばん長く残れる（評価は S〜E の6段階。区切りは config.js の GRADES）
  const REC_FOCUS = {
    S: ['auto', '戦略どおりに動かすのが最も勝ちやすい。攻めに固定すると、傷を負った夜まで出撃してしまう'],
    A: ['auto', '戦略どおりに動かすのが最も勝ちやすい。攻めや守りに固定すると、勝てる戦いを逃しやすい'],
    B: ['rest', '無理に出撃せず力を蓄え、ほかの陣営が潰し合うのを待つほうが、わずかに勝ちやすい'],
    C: ['rest', '正面から挑むより、力を蓄えてほかの陣営が潰し合うのを待つほうが勝ちやすい'],
    D: ['rest', '分の悪い相手が多い。出撃を控えて傷を癒やし、残りが減るのを待つのがまだ見込みがある'],
    E: ['hide', 'どの方針でも勝ち残るのは難しい。潜伏して見つからずにいれば、最も長く戦いに残れる'],
  };
  // マスターの能力値（0〜100）をランクの表記に
  function scoreRank(v) {
    const S = H.CONFIG.RANK_SCORE, L = H.rank.LEVELS;
    if (v < S.E - 4) return 'E-';
    let best = L[0]; for (const l of L) if (v >= S[l] - 4) best = l;
    return best + (v - S[best] >= 7 ? '+' : '');
  }
  // リストの全騎と1対1で戦ったときの平均勝率（宝具あり・なしの平均）。リストごとに一度だけ計算する
  // 64騎で約0.1秒。リストが大きいときは、比べる相手をリストから等間隔に選んだ REF_MAX 騎に絞る（計算量は 騎数×REF_MAX）
  const strengthCache = new WeakMap(), REF_MAX = 120;
  function strengthTable() {
    if (strengthCache.has(roster)) return strengthCache.get(roster);
    const B = H.build, rates = new Map();
    const sortedIds = roster.slice().sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    const refs = sortedIds.length <= REF_MAX ? sortedIds : Array.from({ length: REF_MAX }, (_, i) => sortedIds[Math.floor(i * sortedIds.length / REF_MAX)]);
    for (const a of roster) {
      let t = 0, n = 0;
      for (const b of refs) { if (a === b) continue; t += (B.battleOdds(a, b, {}).pA + B.battleOdds(a, b, { np: true }).pA) / 2; n++; }
      rates.set(a.id, n ? t / n : 0.5);
    }
    const T = { rates, sorted: [...rates.values()].sort((x, y) => y - x), powers: roster.map(s => s.power).sort((x, y) => y - x), nps: roster.map(s => s.npPeak || 0).sort((x, y) => y - x) };
    strengthCache.set(roster, T); return T;
  }
  const rankIn = (sorted, v) => sorted.filter(x => x > v + 1e-9).length + 1;
  function evaluate(sv) {
    const T = strengthTable(), n = roster.length, rate = T.rates.has(sv.id) ? T.rates.get(sv.id) : 0.5;
    const rank = rankIn(T.sorted, rate), pct = (rank - 1) / Math.max(1, n - 1);
    const grade = H.gradeOfPct(pct);
    const eff = id => Object.values(sv.effectSummary || {}).filter(e => e.id === id && !H.effects.hasCond(e.params)).reduce((t, e) => t + e.passive, 0);
    const good = [], bad = [];
    const STJA = H.build.STAT_JA, high = H.build.STAT_KEYS.filter(k => k !== 'np' && sv.score[k] >= 46).sort((a, b) => sv.score[b] - sv.score[a]).slice(0, 2);
    if (high.length) good.push(`${high.map(k => STJA[k]).join('・')}が高い`);
    const atk = (sv.nps || []).filter(x => x.attackResolved && !x.disabled).sort((a, b) => b.power - a.power)[0];
    const npRank = rankIn(T.nps, sv.npPeak || 0);
    if (atk && npRank / n <= 0.3) good.push(`宝具『${atk.name}』の威力はリストでも上位（${npRank}位）`);
    if (eff('instakill') > 0) good.push('一撃で決着をつける手段を持つ');
    if (eff('guts') >= 0.25) good.push('致命傷を受けても踏みとどまりやすい');
    if (eff('magic_guard') >= 0.3) good.push('魔術に対する守りが固い');
    if (eff('evade') >= 0.12) good.push('攻撃をかわす勘に優れる');
    if (eff('stealth') >= 0.3) good.push('気配を断つのが得意で、見つかりにくい');
    if (eff('detect') >= 0.2 || eff('intel') >= 0.2) good.push('索敵・偵察に長ける');
    if (eff('territory') >= 0.2) good.push('拠点で戦えば強い');
    if (eff('escape') >= 0.2) good.push('不利になっても逃げ切りやすい');
    if (eff('charm') > 0) good.push('相手の攻撃をためらわせる魅了を持つ');
    const ails = ['poison', 'stun', 'confuse', 'seal'].filter(id => eff(id) > 0).map(id => H.effects.AILMENTS[id]);
    if (ails.length) good.push(`相手を${ails.join('・')}にする状態異常を持つ`);
    if (eff('ail_guard') >= 0.3) good.push('状態異常に強い');
    if (eff('solo') >= 2) good.push('マスターを失っても長く現界できる');
    const vs = Object.values(sv.effectSummary || {}).filter(e => e.id === 'power_vs' && e.passive > 0).map(e => H.effects.tagJa(e.params.tag));
    if (vs.length) good.push(`〔${vs.slice(0, 2).join('〕〔')}〕への特攻を持つ`);
    if (!atk) bad.push('攻撃に使える宝具を持たない（決め手に欠ける）');
    if (eff('uncontrolled') > 0) bad.push('制御が難しく、勝手に動くことがある');
    if (eff('upkeep_up') > 0) bad.push('燃費が悪く、魔力の消費が激しい');
    if (eff('guard') < 0) bad.push('打たれ弱い');
    if (eff('luck') < 0) bad.push('運に見放されがち');
    if (eff('conceal') < 0) bad.push('真名を見抜かれやすい');
    if ((sv.nps || []).some(x => (x.effects || []).some(e => e.id === 'self_retire' && H.effects.retireP(e) >= 0.5))) bad.push('宝具を使うと自らも消える');
    // 最初の方針のおすすめ（評価ごと。REC_FOCUS を参照。根拠は test/focus.js のシミュレーション）
    const rec = REC_FOCUS[grade] || REC_FOCUS.C;
    return { rate, rank, n, grade, power: sv.power, powerRank: rankIn(T.powers, sv.power), npPeak: sv.npPeak || 0, npRank, maxPower: T.powers[0] || 1, maxNp: T.nps[0] || 1, good: good.slice(0, 4), bad: bad.slice(0, 2), rec };
  }

  function openOpening() {
    const first = out.entries.find(e => e.snap) || { snap: [] };
    const snap = first.snap.find(c => c.you);
    if (!snap) return false;
    const meta = metaOf(snap.id), sv = roster.find(s => s.id === meta.servantId);
    const ev = sv ? evaluate(sv) : null;
    op = { step: 1, focus: focus, meta, snap, sv, ev, rec: ev ? ev.rec[0] : 'auto' };
    $('#opening').classList.add('on');
    renderOpening();
    return true;
  }
  const meterRow = (k, v, max, label, rank, tip) => `<div${tip ? tipAttr(tip) : ''}><span>${k}</span><span class="bar"><i style="width:${Math.max(2, Math.min(100, v / max * 100))}%;background:var(--cyan);color:var(--cyan)"></i></span><span>${esc(label)}${rank ? `<small>${rank}位</small>` : ''}</span></div>`;
  function renderOpening() {
    const { step, meta, snap, sv, ev } = op, m = meta.master || {};
    $('#opStep').textContent = `${step} / 3`;
    $('#opBack').hidden = step === 1;
    $('#opNext').textContent = step === 3 ? 'この方針で一日目を始める' : '次へ';
    $('#opKeys').innerHTML = step === 3 ? '<i>1</i>〜 で選ぶ ・ Enter で始める' : 'Enter で次へ';
    if (step === 1) {
      $('#opEn').textContent = 'Master'; $('#opBand').textContent = 'あなたのマスター';
      $('#opTitle').textContent = m.name || snap.master;
      const stats = Object.entries(m.stats || {}).map(([k, v]) => `<div${tipAttr('m.' + k)}><span>${esc(H.master.MASTER_STATS[k].name)}</span><b>${esc(scoreRank(v))}</b><span class="bar"><i style="width:${Math.max(3, Math.min(100, v / 80 * 100))}%;background:var(--mana);color:var(--mana)"></i></span></div>`).join('');
      const lm = lastMaster();
      const mine = playerMM && mm.list.find(x => x.id === playerMM);
      $('#opBody').innerHTML = `${playerPM || mine ? `<p class="mmbadge">マイマスター${mine ? `「${esc(mmTitle(mine))}」` : ''}の設定で${WAR}に臨む。決めていない項目はランダムで決まった。</p>` : ''}<div class="namefield"><label class="lbl" for="opName">マスターの呼び名（20字まで。空欄にすると、ランダムで決まったものになる）</label>
          <div class="row"><input type="text" id="opName" name="hgw-handle" maxlength="20" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="next" value="${esc(m.name || snap.master)}">
            ${playerName ? '<button class="btn" id="opNameReset" type="button">ランダムな名前に戻す</button>' : ''}
            ${lm && !sameMaster(lm) ? `<button class="btn" id="opNameLast" type="button">前回のマスター設定「${esc(masterBrief(lm))}」</button>` : ''}</div>
          <div class="row" style="margin-top:6px"><label class="lbl" for="opSex">性別</label><select id="opSex"><option value=""${playerSex ? '' : ' selected'}>ランダム</option><option value="男"${playerSex === '男' ? ' selected' : ''}>男</option><option value="女"${playerSex === '女' ? ' selected' : ''}>女</option></select>
            <label class="lbl" for="opAge">年齢</label><input type="number" id="opAge" min="10" max="99" step="1" inputmode="numeric" value="${playerAge || ''}" placeholder="ランダム">
            <label class="lbl" for="opAli">属性</label><select id="opAli"><option value=""${playerAli ? '' : ' selected'}>ランダム</option>${H.master.ALIGN.all.map(a => `<option value="${a}"${playerAli === a ? ' selected' : ''}>${esc(H.master.ALIGN.label(a))}</option>`).join('')}</select>
            ${playerSex || playerAge || playerAli ? '<button class="btn" id="opProfReset" type="button">性別・年齢・属性をランダムに戻す</button>' : ''}</div>
          <p class="hint2">名前・性別・年齢・属性を決めても、戦争の展開は変わらない（年齢は10〜99歳、空欄ならランダム。属性はいまのところ飾りで、戦いには効かない）。</p></div>
        <div class="opseal">${H.sealmark.markup(warSeal(), 3, 120)}</div>
        <p class="say">${esc(out.city)}。${esc(meta.base)}を拠点に、あなたは${WAR}に臨む。手の甲には三画の令呪が刻まれている。</p>
        <dl class="opkv">
          <dt>素性</dt><dd>${esc([m.sex, m.age ? m.age + '歳' : ''].filter(Boolean).join('・'))}</dd>
          ${m.align ? `<dt>属性</dt><dd>${esc(H.master.ALIGN.label(m.align))}</dd>` : ''}
          <dt>出自</dt><dd><b>${esc(m.originLabel || snap.origin)}</b>${ORIGIN_DESC[m.origin] ? '<br>' + esc(ORIGIN_DESC[m.origin]) : ''}</dd>
          ${m.persona ? `<dt>性格</dt><dd><b>${esc(m.persona)}</b>${m.personaDesc ? '<br>' + esc(m.personaDesc) : ''}</dd>` : ''}
          <dt>願い</dt><dd>${esc(m.wish || snap.wish)}</dd>
          ${m.past ? `<dt>経歴</dt><dd class="mmpast">${esc(m.past)}</dd>` : ''}
          <dt>触媒</dt><dd>${m.catalyst ? '縁の品を用意して召喚に臨んだ（サーヴァントとの絆が深まりやすい）' : '触媒なしの召喚。応えたのは、相性で選ばれた英霊だ'}</dd>
          ${m.skills && m.skills.length ? `<dt>スキル</dt><dd>${esc(m.skills.join('、'))}</dd>` : ''}
          ${m.traits && m.traits.length ? `<dt>特徴</dt><dd>${esc(m.traits.join('、'))}</dd>` : ''}
        </dl>
        <div class="opstats">${stats}</div>
        <div class="links"><button class="btn" id="opSaveMM" type="button">このマスターをマイマスターとして保存する</button></div>
        <p class="note2">能力値やステータスにマウスを重ねる・タップすると、戦いの何に効くかが出ます。</p>
        <p class="note2">方針を「おまかせ」にしている日は、陣営の戦略「${esc(meta.policyLabel || '臨機応変')}」に沿って動く。</p>`;
    } else if (step === 2) {
      $('#opEn').textContent = 'Servant'; $('#opBand').textContent = 'あなたのサーヴァント';
      $('#opTitle').innerHTML = `${fic(faceOf(snap.id), keyOf(snap.id), true)}${esc(snap.label)}「${esc(meta.trueName)}」`; fillFaces($('#opTitle'));
      const ranks = `<div class="ranks">${meta.ranks.map(([k, v]) => `<div${tipAttr('sv.' + STAT_KEY_BY_JA[k], sv ? sv.class.key : '')}><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>`;
      $('#opBody').innerHTML = ev ? `
        <div class="grade"><span class="g ${ev.grade}">${ev.grade}</span><span class="verdict">${esc(GRADE[ev.grade])}</span>
          <span class="gsub">リストの${ev.n}騎と1対1で戦った場合の平均勝率 ${Math.round(ev.rate * 100)}%（${ev.rank}位）</span></div>
        <div class="meters">
          ${meterRow('平均勝率', ev.rate, 1, Math.round(ev.rate * 100) + '%', ev.rank, 'ev.rate')}
          ${meterRow('基礎戦闘力', ev.power, ev.maxPower, String(ev.power), ev.powerRank, 'ev.power')}
          ${meterRow('宝具の威力', ev.npPeak, ev.maxNp, ev.npPeak ? String(ev.npPeak) : '—', ev.npPeak ? ev.npRank : 0, 'ev.np')}
        </div>
        ${ranks}
        <ul class="notes">${ev.good.map(t => `<li>${esc(t)}</li>`).join('')}${ev.bad.map(t => `<li class="neg">${esc(t)}</li>`).join('')}</ul>
        ${sv && sv.text && sv.text.commentary ? `<p class="txt2">${esc(excerpt(H.build.loreText(sv.text.commentary), 90))}</p>` : ''}
        <div class="links"><button class="btn" id="opLore">解説と生存曲線を見る</button></div>
        <p class="note2">ステータス・スキル・宝具から見た、この英霊そのものの強さの目安です。今回の顔ぶれとの相性は含みません。</p>`
        : `${ranks}<p class="note2">この英霊はリストに見当たらないため、評価を出せません。</p>`;
    } else {
      $('#opEn').textContent = 'Focus'; $('#opBand').textContent = '最初の方針';
      $('#opTitle').textContent = '一日目をどう動くか';
      $('#opBody').innerHTML = `<p class="say">方針はいつでも変えられ、次の朝から反映される。まずは一日目の動き方を決めよう。</p>
        <div class="rowsel" id="opFocus" role="radiogroup">${Object.entries(FOCUS).map(([k, f], i) => `<button data-f="${k}" role="radio" aria-pressed="${k === op.focus}" aria-checked="${k === op.focus}"><span class="n">${i + 1}</span><b>${esc(f.label)}${k === op.rec ? '<span class="rec">★おすすめ</span>' : ''}</b><small>${esc(f.desc)}</small></button>`).join('')}</div>
        ${ev ? `<p class="note2">★おすすめ：${esc(FOCUS[op.rec].label)} ― ${esc(ev.rec[1])}</p>
          <p class="note2">おすすめは、同じ戦争を方針だけ変えて何千回も戦わせ、方針を変えずに最後まで戦ったときに最も勝ちやすかったもの（評価${esc(ev.grade)}の英霊について）。</p>` : ''}`;
    }
    $('#opening .dlg-in').scrollTop = 0;
    const f = step === 3 ? document.querySelector('#opFocus [aria-pressed="true"]') : $('#opNext');
    if (step === 1) { const ni = $('#opName'); ni.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); opNext(); } }); }
    if (f) f.focus({ preventScroll: true });
  }
  function opPick(k) {
    if (!op || !FOCUS[k]) return;
    op.focus = k;
    document.querySelectorAll('#opFocus [data-f]').forEach(b => { const on = b.dataset.f === k; b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-checked', String(on)); });
  }
  function closeOpening() { $('#opening').classList.remove('on'); op = null; }
  // 前回のマスター設定（名前・性別・年齢・属性）。新しい形式が無ければ、前回の名前だけを使う
  const lastMaster = () => {
    const s = settings0.master || { name: settings0.name };
    const lm = { name: cleanPName(s.name), sex: cleanSex(s.sex), age: cleanAge(s.age), ali: cleanAli(s.ali) };
    return lm.name || lm.sex || lm.age || lm.ali ? lm : null;
  };
  const sameMaster = lm => lm.name === playerName && lm.sex === playerSex && lm.age === playerAge && lm.ali === playerAli;
  const masterBrief = lm => [lm.name.length > 10 ? lm.name.slice(0, 10) + '…' : lm.name, lm.sex, lm.age ? lm.age + '歳' : '', H.master.ALIGN.label(lm.ali)].filter(Boolean).join('・');
  const rememberMaster = () => {
    if (!(playerName || playerSex || playerAge || playerAli)) return;
    settings0.master = { name: playerName, sex: playerSex, age: playerAge, ali: playerAli };
    if (playerName) settings0.name = playerName;
    saveSettings();
  };
  // 名前・性別・年齢・属性を決める（付け直す）。同じシードで組み直すので、マスターの紹介も出し直す。undefined の項目は今のまま
  function applyMaster(v) {
    if (!op) return;
    let name = v.name === undefined ? playerName : cleanPName(v.name);
    const sex = v.sex === undefined ? playerSex : cleanSex(v.sex), age = v.age === undefined ? playerAge : cleanAge(v.age), ali = v.ali === undefined ? playerAli : cleanAli(v.ali);
    // ランダムで決まった名前のまま進めるなら、付け直さない
    if (!playerName && name === (op.meta.master || {}).name) name = '';
    if (name === playerName && sex === playerSex && age === playerAge && ali === playerAli) return;
    playerName = name; playerSex = sex; playerAge = age; playerAli = ali;
    makeGen();
    const first = out.entries.find(e => e.snap) || { snap: [] };
    op.snap = first.snap.find(c => c.you) || op.snap; op.meta = metaOf(op.snap.id);
    board(first); updateURL();
    rememberMaster();
  }
  const applyName = v => applyMaster({ name: v });
  // 開いている紹介の入力欄から読む
  const opFields = () => ({ name: $('#opName').value, sex: $('#opSex').value, age: $('#opAge').value, ali: $('#opAli').value });
  function opNext() {
    if (!op) return;
    if (op.step === 1 && $('#opName')) applyMaster(opFields());
    if (op.step < 3) { op.step++; return renderOpening(); }
    const k = op.focus;
    closeOpening(); setFocus(k);
    toast(`方針「${FOCUS[k].label}」で一日目を始めます`);
    step();
  }
  $('#opBody').addEventListener('change', e => {
    if (!op || op.step !== 1 || !e.target.closest('#opSex, #opAge, #opAli')) return;
    const f = opFields(), id = e.target.id; applyMaster(f); renderOpening(); $('#' + id).focus();
  });
  $('#opNext').onclick = opNext;
  $('#opBack').onclick = () => { if (op && op.step > 1) { op.step--; renderOpening(); } };
  $('#opBody').addEventListener('click', e => {
    if (e.target.closest('#opLore')) { const me = lastSnap.find(c => c.you); if (me) openLore(me.id); return; }
    if (e.target.closest('#opSaveMM')) { if ($('#opName')) { applyMaster(opFields()); renderOpening(); } openMM(null, profileFromOpening()); return; }
    if (e.target.closest('#opProfReset')) { applyMaster({ sex: '', age: 0, ali: '' }); renderOpening(); $('#opSex').focus(); return; }
    if (e.target.closest('#opNameReset')) { applyName(''); renderOpening(); $('#opName').focus(); return; }
    if (e.target.closest('#opNameLast')) { applyMaster(lastMaster()); renderOpening(); $('#opName').focus(); return; }
    const b = e.target.closest('#opFocus [data-f]'); if (b) opPick(b.dataset.f);
  });
  $('#opBody').addEventListener('dblclick', e => { const b = e.target.closest('#opFocus [data-f]'); if (b) { opPick(b.dataset.f); opNext(); } });

  // ---------- マイマスターの設定（開戦の準備の欄と、編集のダイアログ） ----------
  const PERSONA_KEYS = Object.keys(H.PERSONAS);
  const toRank = v => { const r = scoreRank(v); return cleanRank(r) || cleanRank(r.replace(/[+-]$/, '')) || 'E'; };
  // 一言で：名前・素性・出自・性格・決めた能力値
  function mmBrief(p) {
    const pm = p.pm || {}, st = pm.stats || {};
    const ks = MM_STATS.filter(k => st[k]);
    return [p.sex, p.age ? p.age + '歳' : '', H.master.ALIGN.label(p.ali), pm.originLabel || (pm.origin ? H.master.ORIGINS[pm.origin].name : ''), pm.persona ? H.PERSONAS[pm.persona].label : '',
      ks.length ? ks.map(k => H.master.MASTER_STATS[k].name + st[k]).join(' ') : ''].filter(Boolean).join('・');
  }
  function renderMMField() {
    const has = mm.list.length;
    $('#mmSel').innerHTML = has ? mm.list.map(p => `<option value="${esc(p.id)}"${p.id === mm.sel ? ' selected' : ''}>${esc(mmTitle(p))}</option>`).join('') : '<option value="">（まだいない）</option>';
    $('#mmSel').disabled = !has; $('#mmEdit').disabled = !has;
    $('#mmNew').disabled = has >= MM_MAX;
    const r = document.querySelector(`input[name=mm][value="${mm.on ? 1 : 0}"]`); if (r) r.checked = true;
    const p = mmCur();
    $('#mmHint').textContent = mm.on && p
      ? `新しい戦争は「${mmTitle(p)}」${mmBrief(p) ? `（${mmBrief(p)}）` : ''}として始まる。決めていない項目はランダム。観測者のときと、共有リンク・記録の再生では使わない。`
      : `名前・性別・年齢・属性・出自・能力値・性格・願い・経歴を自分で決めたマスターを${MM_MAX}人まで保存しておき、新しい戦争の既定にできる。決めなかった項目は、今まで通りランダムで決まる。`;
  }
  document.querySelectorAll('input[name=mm]').forEach(r => r.addEventListener('change', () => {
    const on = document.querySelector('input[name=mm]:checked').value === '1';
    if (on && !mm.list.length) { const r0 = document.querySelector('input[name=mm][value="0"]'); if (r0) r0.checked = true; openMM(null); return; }
    mm.on = on; saveMM(); renderMMField();
  }));
  $('#mmSel').addEventListener('change', () => { mm.sel = $('#mmSel').value; saveMM(); renderMMField(); });
  $('#mmEdit').onclick = () => openMM(mmCur());
  $('#mmNew').onclick = () => openMM(null);

  // 編集のダイアログ。p が null なら新しく作る（init があればそれを下書きにする）
  let mmEdit = null; // { id: 編集中の id（新しいなら null） }
  function openMM(p, init) {
    if (!p && mm.list.length >= MM_MAX) { toast(`マイマスターは${MM_MAX}人までです`); return; }
    mmEdit = { id: p ? p.id : null };
    const d = p || init || { name: '', sex: '', age: 0, ali: '', pm: null }, pm = d.pm || {}, st = pm.stats || {};
    const opt = (v, label, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(label)}</option>`;
    $('#mmCount').textContent = p ? '' : `${mm.list.length + 1} / ${MM_MAX}`;
    $('#mmTitle').textContent = p ? `「${mmTitle(p)}」を編集` : '新しいマイマスター';
    $('#mmDel').hidden = !p;
    $('#mmBody').innerHTML = `<p class="say">空欄や「ランダム」のままの項目は、戦争ごとにランダムで決まる。名前・性別・年齢・属性・出自の呼び名・願い・経歴は文面だけ、出自・能力値・性格は戦いの展開も変える。</p>
      <div class="namefield">
        <label class="lbl" for="mmName">呼び名（20字まで）</label>
        <div class="row"><input type="text" id="mmName" maxlength="20" autocomplete="off" spellcheck="false" value="${esc(d.name)}" placeholder="空欄ならランダム"></div>
        <div class="row"><label class="lbl" for="mmSex">性別</label><select id="mmSex">${opt('', 'ランダム', d.sex)}${opt('男', '男', d.sex)}${opt('女', '女', d.sex)}</select>
          <label class="lbl" for="mmAge">年齢</label><input type="number" id="mmAge" min="10" max="99" step="1" inputmode="numeric" value="${d.age || ''}" placeholder="ランダム">
          <label class="lbl" for="mmAli">属性</label><select id="mmAli">${opt('', 'ランダム', d.ali)}${H.master.ALIGN.all.map(a => opt(a, H.master.ALIGN.label(a), d.ali)).join('')}</select></div>
      </div>
      <div class="namefield">
        <div class="row"><label class="lbl" for="mmOrigin">出自</label><select id="mmOrigin">${opt('', 'ランダム', pm.origin || '')}${Object.entries(H.master.ORIGINS).map(([k, o]) => opt(k, o.name, pm.origin || '')).join('')}</select></div>
        <p class="hint2" id="mmOriginDesc"></p>
        <label class="lbl" for="mmOl">出自の呼び名（30字まで。空欄なら上の出自の名前）</label>
        <div class="row"><input type="text" id="mmOl" maxlength="30" autocomplete="off" value="${esc(pm.originLabel || '')}" placeholder="例：時計塔の講師"></div>
      </div>
      <div class="namefield">
        <span class="lbl">能力値（ランダムなら出自に合わせて抽選）</span>
        <div class="mmstats">${MM_STATS.map(k => `<label${tipAttr('m.' + k)}><span>${esc(H.master.MASTER_STATS[k].name)}</span><select data-mms="${k}">${opt('', 'ランダム', st[k] || '')}${MM_RANKS.map(r => opt(r, r, st[k] || '')).join('')}</select></label>`).join('')}</div>
      </div>
      <div class="namefield">
        <div class="row"><label class="lbl" for="mmPersona">性格</label><select id="mmPersona">${opt('', 'ランダム', pm.persona || '')}${PERSONA_KEYS.map(k => opt(k, H.PERSONAS[k].label, pm.persona || '')).join('')}</select></div>
        <p class="hint2" id="mmPersonaDesc"></p>
      </div>
      <div class="namefield">
        <label class="lbl" for="mmWish">聖杯に託す願い（60字まで）</label>
        <div class="row"><input type="text" id="mmWish" maxlength="60" autocomplete="off" value="${esc(pm.wish || '')}" placeholder="空欄なら出自と性格に合わせてランダム"></div>
        <label class="lbl" for="mmPast">経歴（200字まで）</label>
        <textarea id="mmPast" maxlength="200" rows="4" placeholder="どんな人生を歩んで、この戦いに来たのか（空欄でもよい）">${esc(pm.past || '')}</textarea>
      </div>
      <label class="cast-force"><input type="checkbox" id="mmUse"${!p || (mm.on && mm.sel === p.id) ? ' checked' : ''}> 新しい戦争は、このマスターで始める</label>`;
    syncMMDesc();
    $('#mmDlg').classList.add('on');
    $('#mmDlg .dlg-in').scrollTop = 0;
    $('#mmName').focus({ preventScroll: true });
  }
  function syncMMDesc() {
    const o = $('#mmOrigin').value, pk = $('#mmPersona').value;
    $('#mmOriginDesc').textContent = o ? ORIGIN_DESC[o] || '' : '名門の魔術師・新興の魔術師・魔術使い・巻き込まれた一般人・異能者のどれか。';
    $('#mmPersonaDesc').textContent = pk ? H.PERSONAS[pk].desc || '' : '出自に合わせて選ばれる。';
  }
  function closeMM() { $('#mmDlg').classList.remove('on'); mmEdit = null; }
  function readMM() {
    const st = {}; document.querySelectorAll('#mmBody [data-mms]').forEach(s => { st[s.dataset.mms] = s.value; });
    return cleanProfile({ id: mmEdit && mmEdit.id, name: $('#mmName').value, sex: $('#mmSex').value, age: $('#mmAge').value, ali: $('#mmAli').value,
      pm: { origin: $('#mmOrigin').value, originLabel: $('#mmOl').value, stats: st, persona: $('#mmPersona').value, wish: $('#mmWish').value, past: $('#mmPast').value } });
  }
  $('#mmBody').addEventListener('change', e => { if (e.target.closest('#mmOrigin, #mmPersona')) syncMMDesc(); });
  $('#mmDlg').addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMM(); } });
  $('#mmDlg').addEventListener('click', e => { if (e.target.id === 'mmDlg') closeMM(); });
  $('#mmCancel').onclick = closeMM;
  $('#mmSave').onclick = () => {
    if (!mmEdit) return;
    const p = readMM(), use = $('#mmUse').checked;
    const i = mm.list.findIndex(x => x.id === mmEdit.id);
    if (i >= 0) mm.list[i] = p; else mm.list.push(p);
    if (use) { mm.sel = p.id; mm.on = true; } else if (mm.sel === p.id) mm.on = false;
    if (!mm.list.some(x => x.id === mm.sel)) mm.sel = p.id;
    saveMM(); renderMMField(); closeMM();
    toast(use ? `「${mmTitle(p)}」を保存しました。新しい戦争はこのマスターで始まります` : `「${mmTitle(p)}」を保存しました`);
  };
  $('#mmDel').onclick = () => {
    const p = mmEdit && mm.list.find(x => x.id === mmEdit.id); if (!p) return;
    if (!confirm(`マイマスター「${mmTitle(p)}」を消します。よろしいですか？（終わった戦争の記録は残ります）`)) return;
    mm.list = mm.list.filter(x => x !== p);
    if (mm.sel === p.id) { mm.sel = (mm.list[0] || {}).id || ''; if (!mm.list.length) mm.on = false; }
    saveMM(); renderMMField(); closeMM(); toast(`「${mmTitle(p)}」を消しました`);
  };
  // 開戦の案内に出ている今のマスターを、マイマスターの下書きにする（能力値はランクに丸める）
  function profileFromOpening() {
    const m = (op && op.meta.master) || {};
    const st = {}; for (const k of MM_STATS) if (m.stats && m.stats[k] != null) st[k] = toRank(m.stats[k]);
    const pk = PERSONA_KEYS.find(k => H.PERSONAS[k].label === m.persona) || '';
    const origin = H.master.ORIGINS[m.origin] ? m.origin : '';
    return { name: playerName || m.name || '', sex: m.sex || '', age: m.age || 0, ali: m.align || '',
      pm: { origin, originLabel: origin && m.originLabel === H.master.ORIGINS[origin].name ? '' : m.originLabel || '', stats: st, persona: pk, wish: m.wish || '', past: m.past || '' } };
  }
  renderMMField();

  // ---------- 情景 ----------
  // 背景画像（img/scenes/）があれば使い、無ければシードから描いた街並み（SVG）を出す
  const imgOk = new Map(); // URL → true / false / Promise
  function probe(url) {
    if (imgOk.has(url)) return Promise.resolve(imgOk.get(url));
    const p = new Promise(res => { const im = new Image(); im.onload = () => { imgOk.set(url, true); res(true); }; im.onerror = () => { imgOk.set(url, false); res(false); }; im.src = url; });
    imgOk.set(url, p); return p;
  }
  let lastScene = null, sceneReq = 0;
  async function setScene(scene, time, weather) {
    const key = scene + '|' + time;
    $('#view').classList.toggle('rainy', weather === 'rain');
    $('#sceneTag').textContent = time === 'day' ? 'DAY' : 'NIGHT'; $('#sceneTag').classList.toggle('day', time === 'day');
    $('#sceneSvg').style.filter = time === 'day' ? 'brightness(1.7) saturate(.7) hue-rotate(-10deg)' : '';
    $('#sceneSvg').querySelector('#stars').setAttribute('opacity', time === 'day' ? 0 : .8);
    if (key === lastScene) return; lastScene = key;
    const req = ++sceneReq;
    for (const url of H.sceneCandidates(scene, time)) {
      const ok = await (imgOk.get(url) === true ? true : imgOk.get(url) === false ? false : probe(url));
      if (req !== sceneReq) return;
      if (ok) { const im = $('#sceneImg'); if (im.getAttribute('src') !== url) { im.classList.remove('on'); im.src = url; } requestAnimationFrame(() => im.classList.add('on')); return; }
    }
    $('#sceneImg').classList.remove('on');
  }
  function drawSkyline(sd) {
    const rnd = H.engine.makeRng('scene' + sd);
    let x = 0, b = '', w = '';
    while (x < 300) {
      const bw = 10 + Math.floor(rnd() * 22), bh = 22 + Math.floor(rnd() * 50), y = 100 - bh;
      b += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}"/>`;
      for (let wy = y + 4; wy < 96; wy += 6) for (let wx = x + 2; wx < x + bw - 3; wx += 5) if (rnd() < 0.26) w += `<rect x="${wx}" y="${wy}" width="2" height="3"/>`;
      if (rnd() < 0.18) b += `<rect x="${x + bw / 2 - 0.5}" y="${y - 9}" width="1" height="9"/>`;
      x += bw + (rnd() < 0.3 ? 2 : 0);
    }
    const stars = Array.from({ length: 50 }, () => `<rect x="${Math.floor(rnd() * 300)}" y="${Math.floor(rnd() * 55)}" width="1" height="1"/>`).join('');
    $('#sceneSvg').innerHTML = `
      <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050d26"/><stop offset=".7" stop-color="#123a7a"/><stop offset="1" stop-color="#1c64a8"/></linearGradient></defs>
      <rect width="300" height="100" fill="url(#sky)"/>
      <g id="stars" fill="#cfefff" opacity=".8" shape-rendering="crispEdges">${stars}</g>
      <circle cx="${40 + Math.floor(rnd() * 220)}" cy="22" r="8" fill="#e9f6ff" opacity=".9"/>
      <g fill="#071a3c" shape-rendering="crispEdges">${b}</g>
      <g fill="#59e3ff" opacity=".85" shape-rendering="crispEdges">${w}</g>`;
  }
  function flash(color) {
    if (reduceMotion) return;
    const r = $('#fx'); r.style.background = `radial-gradient(circle at 50% 60%, ${color}, transparent 70%)`;
    r.classList.remove('flash'); void r.offsetWidth; r.classList.add('flash');
  }

  // ---------- 表示 ----------
  // クラスのアイコン（陣営の一覧・サーヴァントの欄・開戦の案内・結末）。key はクラスのキー（servantId の前半）
  const keyOf = id => String((metaOf(id) || {}).servantId || '').split(':')[0];
  // 顔グラフィックのファイル名（真名、同名の別の騎なら 真名#key）。陣営の id から
  const faceOf = id => { const m = metaOf(id) || {}; return H.faceNameOfId(m.servantId) || m.trueName || ''; };
  const ci = (key, big) => key ? `<img class="ci${big ? ' big' : ''}" src="${H.classIcon(key)}" alt="" width="20" height="20" loading="lazy" decoding="async">` : '';
  // 顔グラフィックがあればクラスのアイコンの代わりに出す（真名が分かっている英霊だけに使う。無ければアイコンのまま）
  const fic = (name, key, big) => name ? `<span class="fic${big ? ' big' : ''}">${ci(key, big)}<img class="face" data-face="${esc(name)}" alt="" hidden></span>` : ci(key, big);
  // 描いたあとに呼ぶ：見つかっている顔を入れる。まだ試していない名前は試し、見つかったらもう一度入れる
  function fillFaces(root) {
    for (const im of (root || document).querySelectorAll('img[data-face]')) {
      const u = H.faceUrl(im.dataset.face, () => fillFaces());
      if (!u) continue;
      if (im.getAttribute('src') !== u) im.src = u;
      im.hidden = false; if (im.parentNode && im.parentNode.classList) im.parentNode.classList.add('has');
    }
  }
  // 記録の台詞：話し手の札をつけ、その時点で真名を知っている英霊（と自分の英霊）には顔も出す。話し手は ids の先頭
  function quoteHtml(e) {
    const q = e.quote, id = e.ids && e.ids[0], c = id != null && e.snap ? e.snap[id] : null;
    const known = !!c && (!!c.name || c.you) && !!servantOf(id) && !!q.who && q.who.indexOf(c.label) >= 0;
    return `<span class="q say">${known ? `<span class="qface"><img class="face" data-face="${esc(faceOf(id))}" alt="" hidden></span>` : ''}<span class="qbody">${q.who ? `<span class="qwho">${esc(q.who)}</span>` : ''}<span class="qt">${esc(q.text)}</span></span></span>`;
  }
  const PH = { day: '昼', night: '夜', prologue: '開戦', end: '終幕' };
  const KIND_JA = { prologue: '開幕', summon: '召喚', day: '昼の行動', night: '夜の行動', battle: '戦闘', np: '宝具', cs: '令呪', death: '脱落', event: '出来事',
    world: '街の出来事', life: '日常', scout: '偵察', ally: '同盟', council: '作戦会議', choice: '決断', quiet: '静かな日', end: '終幕' };
  // ハイライト：勝敗が決まったとき（脱落。とどめと決め手の宝具は脱落の記録に一緒に書かれる）・令呪・同盟と裏切り・
  // 討伐令・因縁・真名の看破・結末など大きな出来事。宝具の解放そのものは入れない（それだけでは勝敗は決まらない）
  function hlCheck(e) {
    if (e.kind === 'death' || e.kind === 'end') return true;
    return !!e.big && e.kind !== 'np';
  }
  let logFilter = 'all';
  function show(e, fast) {
    armWord(e);
    if (e.kind === 'dayhead') { curDay = e.day; if (!fast) board(e); return; }
    const hl = hlCheck(e);
    const li = document.createElement('li');
    li.className = ['k-' + e.kind, e.you ? 'is-you' : '', hl ? 'hl' : '', e.fin && e.fin.np ? 'fin-np' : '', fast ? '' : 'new'].filter(Boolean).join(' ');
    li.innerHTML = `<span class="when">${e.day ? `<b>D${String(e.day).padStart(2, '0')}</b>` : '<b>—</b>'}<span>${PH[e.phase] || ''}</span></span><div class="txt">${hl && logFilter !== 'hl' ? '<span class="hlmark" title="ハイライト">★</span>' : ''}${esc(e.text)}${e.quote ? quoteHtml(e) : ''}</div>`;
    if (e.quote) fillFaces(li);
    $('#log').prepend(li);
    for (const w of words) if (w.at === idx) putWord(w, fast); // この記録のあとに残した一言
    if (!fast) {
      syncLog();
      board(e);
      if (e.kind === 'np') flash('rgba(255, 216, 74, .9)'); else if (e.kind === 'death') flash(e.fin && e.fin.how === 'np' ? 'rgba(255, 190, 90, .95)' : 'rgba(255, 79, 114, .9)'); else if (e.kind === 'cs') flash('rgba(255, 120, 150, .7)');
    }
  }

  // ---------- 一言を残す ----------
  // 節目（初めての戦い・折り返し・サーヴァントを失ったとき・終幕）で、マスターとして一言を残せる。
  // 節目の出来事が出たら印を付け（armWord）、次の日に移る前に聞く（step → askWord）。終幕は結末を出す前に聞く。
  // 残した言葉は戦争の展開に関わらない。中断の保存と記録（w）に入り、記録の中でその位置に出る
  const WORD_Q = {
    first: { t: '初めての戦いを終えて', b: () => `${svNameNow()}と共に、初めて刃を交えた。いま胸にあることを一言。` },
    half: { t: '戦いの折り返し', b: () => `${maxDays}日のうち、半ばが過ぎた。ここまでの戦いを振り返って一言。` },
    loss: { t: '別れ', b: () => `${svNameNow()}は消えた。去っていった英霊に、一言。` },
    end: { t: '終幕', b: () => WAR + 'が終わった。この戦いの最後に一言。' },
  };
  const WORD_ORDER = ['loss', 'first', 'half'];
  const svNameNow = () => { const me = lastSnap.find(c => c.you); return me ? (metaOf(me.id).trueName || me.label) : 'サーヴァント'; };
  function armWord(e) {
    if (!wordsOn || catching || youId == null || !e) return;
    const arm = k => { if (!wordAsked.has(k) && !wordArm.includes(k)) wordArm.push(k); };
    if (e.kind === 'battle' && e.you && e.head) arm('first');
    else if (e.kind === 'dayhead' && e.day > 1 && e.day >= Math.ceil(maxDays / 2)) arm('half');
    else if (e.kind === 'death' && e.you && e.snap) { const c = e.snap[e.ids[0]]; if (c && c.you && !c.alive) arm('loss'); }
  }
  let wordKey = null;
  // 印の付いた節目のうち、いちばん大事なもの1つだけを聞く（同じ日に重なったほかの節目は聞かずに済ませる）
  function askWord(key) {
    clearTimeout(timer);
    if (!key) { key = WORD_ORDER.find(k => wordArm.includes(k)) || wordArm[0]; for (const k of wordArm) wordAsked.add(k); wordArm = []; }
    wordKey = key;
    const Q = WORD_Q[key];
    $('#wordWhen').textContent = curDay ? `DAY ${curDay}` : '';
    $('#wordTitle').textContent = Q.t; $('#wordBody').textContent = Q.b();
    $('#wordText').value = '';
    $('#wordDlg').classList.add('on');
    setTimeout(() => $('#wordText').focus({ preventScroll: true }), 30);
  }
  function closeWord(text, off) {
    const k = wordKey; wordKey = null;
    $('#wordDlg').classList.remove('on');
    if (!k) return;
    wordAsked.add(k);
    const t = cleanWord(text);
    if (t) { const w = { key: k, at: idx, day: curDay, q: WORD_Q[k].t, text: t }; words.push(w); putWord(w, false); }
    if (off) {
      wordsOn = false; wordArm = [];
      const r = document.querySelector('input[name=words][value="0"]'); if (r) r.checked = true; saveSettings();
      toast('これからは一言を聞きません。最初の画面の「一言を残す」で戻せます');
    } else if (t) toast('一言を残しました');
    saveProgress();
    if (k === 'end') return finish();
    timer = setTimeout(step, 250);
  }
  const cleanWord = v => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 60);
  // 記録の欄に、残した一言を出す
  function putWord(w, fast) {
    const li = document.createElement('li');
    li.className = 'k-words is-you hl' + (fast ? '' : ' new');
    li.innerHTML = `<span class="when"><b>${w.day ? 'D' + String(w.day).padStart(2, '0') : '—'}</b><span>一言</span></span><div class="txt"><small>${esc(w.q || '')}・あなたの一言</small>「${esc(w.text)}」</div>`;
    $('#log').prepend(li);
    if (!fast) syncLog();
  }
  $('#wordOk').onclick = () => closeWord($('#wordText').value);
  $('#wordSkip').onclick = () => closeWord('');
  $('#wordOff').onclick = () => closeWord($('#wordText').value, true);
  $('#wordText').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); closeWord($('#wordText').value); } else if (e.key === 'Escape') { e.preventDefault(); closeWord(''); } });

  // 絞り込みと「新しいものだけ表示」を、表示中の記録に掛け直す
  function syncLog() {
    const open = $('#logWrap').classList.contains('open');
    const lim = matchMedia('(max-width: 820px)').matches ? 5 : 10;
    let n = 0;
    for (const li of $('#log').children) {
      const ok = logFilter === 'all' || (logFilter === 'hl' ? li.classList.contains('hl') : li.classList.contains('is-you'));
      li.classList.toggle('fo', !ok);
      if (ok) n++;
      li.classList.toggle('past', ok && n > lim);
      const mk = li.querySelector('.hlmark'); if (mk) mk.hidden = logFilter === 'hl';
    }
    $('#logMore').hidden = n <= lim && !open;
    $('#logMore').textContent = open ? '記録をたたむ ▴' : `${logFilter === 'all' ? 'すべての記録' : logFilter === 'hl' ? 'ハイライトをすべて' : '自陣営の記録をすべて'}見る（${n}件） ▾`;
    const empty = $('#log').children.length && !n;
    $('#logEmpty').hidden = !empty;
    if (empty) $('#logEmpty').textContent = logFilter === 'hl' ? 'まだ大きな出来事は起きていない。' : 'まだあなたの陣営の記録はない。';
  }
  function setLogFilter(f) {
    logFilter = f;
    document.querySelectorAll('[data-lf]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lf === f)));
    syncLog();
  }
  document.querySelectorAll('[data-lf]').forEach(b => b.onclick = () => setLogFilter(b.dataset.lf));
  matchMedia('(max-width: 820px)').addEventListener('change', () => syncLog());
  $('#logMore').onclick = () => {
    const open = $('#logWrap').classList.toggle('open');
    $('#logMore').setAttribute('aria-expanded', String(open));
    $('#log').scrollTop = 0;
    syncLog();
  };

  // ---------- 記録の書き出し（CSV） ----------
  // ここまでに表示した記録だけを書き出す（先の展開は含めない）。Excel で文字化けしないよう BOM を付ける
  function shownEntries() { return out.entries.slice(0, idx).filter(e => e.kind !== 'dayhead'); }
  function exportCsv() {
    if (!out || !out.entries) return;
    const list = shownEntries();
    const q = v => { const t = String(v == null ? '' : v); return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const who = (e, id) => { const c = e.snap && e.snap[id]; return c ? c.label + (c.name ? '「' + c.name + '」' : '') : ''; };
    const rows = [['日', '時間帯', '種類', 'ハイライト', '自陣営', '関わった陣営', '本文', 'セリフの主', 'セリフ', '場所']];
    for (const e of list) rows.push([e.day || 0, PH[e.phase] || '', KIND_JA[e.kind] || e.kind, hlCheck(e) ? '★' : '', e.you ? '○' : '',
      (e.ids || []).map(id => who(e, id)).filter(Boolean).join(' / '), e.text, e.quote ? e.quote.who : '', e.quote ? e.quote.text : '', e.place || '']);
    const csv = '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n') + '\r\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${WAR}_${out.city}_${seed}_${done && idx >= out.entries.length ? '全記録' : curDay + '日目まで'}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`記録を${list.length}件、CSVで保存しました`);
  }
  $('#csvBtn').onclick = exportCsv;

  // ---------- サーヴァントの解説 ----------
  // 自分のサーヴァントと、真名が分かったサーヴァントだけ見られる（まだ知らない真名は出さない）
  let lastSnap = [];
  const servantOf = id => roster.find(s => s.id === metaOf(id).servantId) || bossPool.find(s => s.id === metaOf(id).servantId) || null;
  const canLore = id => { const c = lastSnap[id]; return !!c && (!!c.name || c.you) && !!servantOf(id); };
  // kagemiya のURL（ページ名は EUC-JP でパーセント符号化する）。対応表は初回に作る
  let eucMap = null;
  function eucEncode(str) {
    if (!eucMap) {
      eucMap = new Map(); const dec = new TextDecoder('euc-jp');
      for (let a = 0xa1; a <= 0xfe; a++) for (let b = 0xa1; b <= 0xfe; b++) { const ch = dec.decode(Uint8Array.of(a, b)); if (ch.length === 1 && ch !== '�' && !eucMap.has(ch)) eucMap.set(ch, [a, b]); }
      for (let b = 0xa1; b <= 0xdf; b++) { const ch = dec.decode(Uint8Array.of(0x8e, b)); if (!eucMap.has(ch)) eucMap.set(ch, [0x8e, b]); }
    }
    let out2 = '';
    for (const ch of String(str)) {
      const c = ch.codePointAt(0);
      if (c < 0x80) { out2 += /[A-Za-z0-9\-_.~]/.test(ch) ? ch : '%' + c.toString(16).toUpperCase().padStart(2, '0'); continue; }
      const bs = eucMap.get(ch); if (!bs) return null;
      out2 += bs.map(x => '%' + x.toString(16).toUpperCase()).join('');
    }
    return out2;
  }
  const wikiSearch = q => 'https://ja.wikipedia.org/w/index.php?search=' + encodeURIComponent(q) + '&go=Go';
  const cleanName = n => String(n || '').replace(/[（(〔\[【].*?[)）〕\]】]/g, '').trim();
  function loreLinks(sv) {
    const links = [];
    const name = cleanName(sv.trueName);
    if (name) links.push(`<a class="btn" href="${wikiSearch(name)}" target="_blank" rel="noopener">「${esc(name)}」をWikipediaで調べる</a>`);
    const og = String(sv.origin || '').split(/[、,，／/]/)[0].replace(/^史実|[『』「」]/g, '').trim();
    if (og && og !== name) links.push(`<a class="btn" href="${wikiSearch(og)}" target="_blank" rel="noopener">元ネタ「${esc(og)}」</a>`);
    if (H.build.linkOf(sv)) links.push(`<a class="btn" href="${esc(H.build.linkOf(sv))}" target="_blank" rel="noopener">設定元リンク</a>`);
    else if (!sv.manual) try { const u = eucEncode(H.build.pageOf(sv) || sv.trueName); if (u) links.push(`<a class="btn" href="https://seesaawiki.jp/kagemiya/d/${u}" target="_blank" rel="noopener">設定元リンク</a>`); } catch (e) { /* EUC-JP が使えない環境 */ }
    links.push(`<a class="btn" href="submit.html?servant=${encodeURIComponent(sv.trueName)}" target="_blank" rel="noopener">この英霊の調整を希望する</a>`);
    return `<div class="links">${links.join('')}</div>`;
  }
  // 解説の冒頭（文の切れ目で limit 字まで）
  function excerpt(text, limit) {
    const flat = String(text || '').replace(/\s*\n\s*/g, '').trim();
    if (flat.length <= limit) return flat;
    let s = ''; for (const part of flat.split(/(?<=。)/)) { if (s && (s + part).length > limit) break; s += part; }
    return s.length > limit * 1.4 ? s.slice(0, limit) + '…' : s;
  }
  // 解説の本文：最初の部分を出し、続きがあれば「続きを読む」で開く（最初の部分は繰り返さない）。人物・性格は別に折りたたむ
  function loreBlock(body, person) {
    const lead = H.build.loreLead(body, 160), pl = H.build.loreLead(person, 160);
    if (lead.head) return `<p class="txt2">${esc(lead.head)}</p>${lead.rest ? `<details><summary>続きを読む</summary><p class="txt2">${esc(lead.rest)}</p></details>` : ''}`
      + (person ? `<details><summary>人物・性格</summary><p class="txt2">${esc(H.build.loreText(person))}</p></details>` : '');
    if (pl.head) return `<p class="txt2">${esc(pl.head)}</p>${pl.rest ? `<details><summary>続きを読む</summary><p class="txt2">${esc(pl.rest)}</p></details>` : ''}`;
    return '<p class="note2">この英霊の解説はリストにありません。下のリンクから調べられます。</p>';
  }
  let loreResume = false;
  function openLore(id) {
    if (!canLore(id)) return;
    const sv = servantOf(id), c = lastSnap[id], t = sv.text || {};
    const body = (t.commentary || '').trim(), person = (t.personality || '').trim();
    $('#loreSub').textContent = c.you ? 'あなたのサーヴァント' : '真名判明';
    $('#loreTitle').textContent = `${c.label}「${sv.trueName}」`;
    $('#loreBody').innerHTML = `<img class="face xl" data-face="${esc(faceOf(id))}" alt="" hidden><dl class="opkv">
        ${sv.origin ? `<dt>元ネタ</dt><dd>${esc(sv.origin)}</dd>` : ''}
        ${sv.aliases && sv.aliases.length ? `<dt>異名</dt><dd>${esc(sv.aliases.join('、'))}</dd>` : ''}
        ${sv.alignment ? `<dt>属性</dt><dd>${esc(sv.alignment)}</dd>` : ''}
        ${sv.profile && sv.profile.wish ? `<dt>願い</dt><dd>${esc(sv.profile.wish)}</dd>` : ''}
      </dl>
      ${loreBlock(body, person)}
      <section class="surv" id="survBox" aria-label="生存曲線"></section>
      ${loreLinks(sv)}`;
    fillFaces($('#loreBody'));
    loreSv = sv; renderSurvival(); loadSurvival();
    loreResume = !!gen && !paused && !op && !done && !$('#dlg').classList.contains('on');
    clearTimeout(timer);
    $('#lore').classList.add('on');
    $('#loreClose').focus({ preventScroll: true });
  }
  function closeLore() {
    if (!$('#lore').classList.contains('on')) return;
    $('#lore').classList.remove('on'); loreSv = null;
    if (loreResume) { loreResume = false; step(); }
  }
  $('#loreClose').onclick = closeLore;
  $('#lore').addEventListener('click', e => { if (e.target.id === 'lore') closeLore(); });
  $('#svLore').onclick = () => { const me = lastSnap.find(c => c.you); if (me) openLore(me.id); };
  $('#camps').addEventListener('click', e => { const li = e.target.closest('li[data-lore]'); if (li) openLore(+li.dataset.lore); });
  $('#camps').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('li[data-lore]')) { e.preventDefault(); openLore(+e.target.dataset.lore); } });

  // ---------- 生存曲線 ----------
  // 英霊ごとに「何日目まで生き残れるか」。リストから毎回ランダムに七騎を選んで全自動で戦わせた、総合的な見込み（js/survival.js）。
  // 集計は data/survival.json（tools/survival.js で作る）を使い、リストが違えば（指紋が合わなければ）ここで少しずつ回して作り、
  // このブラウザに残す（hgw.survival.v1）。回している間も、途中までの集計で曲線を出す
  const SURV_KEY = 'hgw.survival.v1', SURV_TARGET = 800, SURV_CHUNK = 3;
  let survStats = null, survRunning = false, survFileTried = null, loreSv = null;
  // 今のリストに合った集計（無ければ null）。描くときに使う
  function survReady() { return survStats && survStats.fp === H.survival.fingerprint(roster) ? survStats : null; }
  // すぐ手に入る集計（公開している集計か、このブラウザに残した集計）を読む。回しはしない
  async function survQuick() {
    const fp = H.survival.fingerprint(roster);
    if (survReady() && (survStats.wars >= SURV_TARGET || survRunning)) return survReady();
    // 1) 公開している集計
    if (survFileTried !== fp && /^https?:$/.test(location.protocol)) {
      survFileTried = fp;
      try { const r = await fetch('data/survival.json', { cache: 'no-cache' }); if (r.ok) { const d = await r.json(); if (d && d.fp === fp && d.format === 'hgw-survival') { survStats = d; return d; } } } catch (e) { /* 手元で集計する */ }
    }
    // 2) このブラウザに残した集計（途中まででも）
    const c = store.get(SURV_KEY);
    if (c && c.fp === fp && c.format === 'hgw-survival' && !survRunning && !(survReady() && survStats.wars >= c.wars)) survStats = c;
    return survReady();
  }
  async function loadSurvival() {
    const fp = H.survival.fingerprint(roster);
    await survQuick();
    if (survReady() && survStats.wars >= SURV_TARGET) { renderSurvival(); return; }
    // 3) 足りなければ少しずつ回す（画面を止めないよう、数戦ごとに間を空ける。途中までの集計からの続き）
    if (survRunning) return;
    survRunning = true;
    const run = H.survival.runner(roster, { stats: survStats && survStats.fp === fp ? survStats : null, masters });
    survStats = run.stats; renderSurvival();
    let lastSave = run.stats.wars;
    while (survRunning && run.stats.wars < SURV_TARGET && H.survival.fingerprint(roster) === fp) {
      run.step(SURV_CHUNK);
      if (run.stats.wars - lastSave >= 60) { store.set(SURV_KEY, run.stats); lastSave = run.stats.wars; }
      if (loreSv) renderSurvival();
      await new Promise(r => setTimeout(r, gen && !done && !paused ? 40 : 0));
    }
    survRunning = false;
    if (survStats === run.stats) store.set(SURV_KEY, run.stats);
    renderSurvival();
  }
  function renderSurvival() {
    const box = $('#survBox'); if (!box || !loreSv) return;
    const st = survReady(), t = st && st.servants[loreSv.id];
    const head = '<h5>生存曲線 ― 何日目まで生き残れるか</h5>';
    if (!st || (!t && survRunning)) { box.innerHTML = `${head}<p class="snote">集計を準備しています…</p>`; return; }
    const prog = st.wars < SURV_TARGET && survRunning ? `<div class="sprog" role="progressbar" aria-valuemin="0" aria-valuemax="${SURV_TARGET}" aria-valuenow="${st.wars}"><i style="width:${st.wars / SURV_TARGET * 100}%"></i></div><p class="snote">このブラウザで集計しています（${st.wars} / ${SURV_TARGET}回）。途中までの結果で描いています。</p>` : '';
    if (!t || !t.n) { box.innerHTML = `${head}${prog}<p class="snote">まだこの英霊が呼ばれた戦争がありません。</p>`; return; }
    const days = st.days, s = H.survival.curveOf(t, days), avg = H.survival.curveOf(H.survival.overall(st), days);
    const md = H.survival.median(s), mdAvg = H.survival.median(avg);
    const W = 560, Hh = 170, L = 34, R = 10, T = 10, Bm = 24, iw = W - L - R, ih = Hh - T - Bm;
    const x = d => L + d / days * iw, y = v => T + (1 - v) * ih;
    const path = arr => arr.map((v, d) => `${d ? 'L' : 'M'}${x(d).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const grid = [0, 0.25, 0.5, 0.75, 1].map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(141,174,212,.18)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" fill="var(--mute)" font-size="10">${Math.round(v * 100)}%</text>`).join('');
    const xt = []; for (let d = 0; d <= days; d += days > 20 ? 5 : 2) xt.push(`<text x="${x(d)}" y="${Hh - 6}" text-anchor="middle" fill="var(--mute)" font-size="10">${d === 0 ? '開戦' : d}</text>`);
    const area = `${path(s)}L${x(days)},${y(0)}L${x(0)},${y(0)}Z`;
    const mdMark = md ? `<line x1="${x(md)}" x2="${x(md)}" y1="${y(0.5)}" y2="${y(0)}" stroke="var(--cyan)" stroke-dasharray="2 3"/>` : '';
    box.innerHTML = `${head}
      <p class="ssum">${md ? `半数が脱落するのは <b>${md}</b> 日目` : `${days}日目まで半数以上が残る`}（リスト全体では${mdAvg ? mdAvg + '日目' : days + '日を超える'}）。${days}日目まで残る見込み <b>${Math.round(s[days] * 100)}%</b>、聖杯を手にする見込み <b>${Math.round(t.w / t.n * 100)}%</b>。</p>
      ${prog}
      <svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="生存曲線。${md ? '半数が脱落するのは' + md + '日目' : ''}。${days}日目まで残る見込み${Math.round(s[days] * 100)}%">
        ${grid}${xt.join('')}${mdMark}
        <path d="${area}" fill="var(--cyan)" fill-opacity=".08"/>
        <path d="${path(avg)}" fill="none" stroke="var(--mute)" stroke-width="1.5" stroke-dasharray="5 4"/>
        <path d="${path(s)}" fill="none" stroke="var(--cyan)" stroke-width="2.5" stroke-linejoin="round"/>
      </svg>
      <div class="slegend"><span><i></i>${esc(cleanName(loreSv.trueName))}</span><span><i class="avg"></i>リスト全体の平均</span></div>
      <p class="snote">今回の戦争ではなく、リストから毎回ランダムに七騎を選んで全自動で戦わせた${st.wars}回の${WAR}（${days}日・クラスごとに一騎）のうち、この英霊が呼ばれた${t.n}回の集計。曲線は、その日の終わりにまだ脱落していない割合。</p>
      <details class="num"><summary>日ごとの値を見る</summary><p>${s.map((v, d) => `${d ? 'D' + d : '開戦'}:${Math.round(v * 100)}%`).join('　')}</p></details>`;
  }

  // ---------- ステータスの解説（マウスを重ねる・タップ・キーボードで見る） ----------
  // 要素に data-tip="キー"（と必要なら data-cls="クラスのキー"）を付けると、解説が出る。
  // 文はエンジン（engine.js）と config.js の実際の計算に合わせてある。計算を変えたらここも直す
  // 具体的な数値や計算式は出さず、何に効くかだけを書く（計算は config.js の STAT_W・STAT_FX と engine.js）
  const TIPS = {
    'sv.str': { t: '筋力', d: '白兵戦の膂力。打ち勝ったとき、相手に深い傷を負わせる。戦闘力にも大きく関わる。', w: 'str' },
    'sv.end': { t: '耐久', d: '打たれ強さ。受ける傷が浅くなり、致命傷を受けても踏みとどまりやすい。戦闘力にも大きく関わる。', w: 'end' },
    'sv.agi': { t: '敏捷', d: '身のこなしの速さ。不利な戦いから逃げ切り、逃げる敵には追いすがる。夜の街で敵を捉えやすく、追っ手にも捉えられにくい。戦闘力にも大きく関わる。', w: 'agi' },
    'sv.mag': { t: '魔力', d: '魔術の力。宝具の威力が増し、宝具発動に要する魔力も少なくて済む。戦闘力にも関わる。魔力による攻撃は、対魔力による影響を受けやすい。', w: 'mag' },
    'sv.luk': { t: '幸運', d: '運の強さ。クリティカルヒットが出やすく、即死の一撃を免れやすく、致命傷でも命拾いしやすい。戦闘力にも少し関わる。', w: 'luk' },
    'sv.np': { t: '宝具', d: '宝具そのものの評価。戦いでの宝具の強さは、宝具それぞれのランクと種別、そして魔力で決まる。' },
    'st.hp': { t: '霊基', d: 'サーヴァントの体力。尽きると消滅する（踏みとどまったり、令呪で退かせたりできることもある）。減るほど戦いで力を出せなくなり、夜の出撃も控えるようになる。休養や霊脈で回復する。' },
    'st.mana': { t: '魔力', d: 'マスターがサーヴァントに送れる魔力の残り。日々の現界・戦い・宝具の解放で減り、毎日少しずつ戻る。燃費の悪い英霊（バーサーカーなど）ほど減りが早い。足りないと宝具を撃てず、尽きかけると戦う力が落ちる。足りない分はマスターの生命力から吸い上げられ、令呪でしのげなければマスターが倒れることもある。休養・潜伏の日は霊体化して節約する。' },
    'st.bond': { t: '絆', d: 'マスターとサーヴァントの信頼。深いほど、致命傷で踏みとどまりやすく、撤退が成功しやすく、令呪が拒まれにくく、制御の難しい英霊も言うことを聞きやすい。日常の出来事や、共に過ごす日々で深まる。' },
    'st.ws': { t: '工房', d: '拠点の守り。固いほど、拠点で迎え撃つ戦いが有利になり、マスターを狙う奇襲や刃も防ぎやすく、魔力の戻りもよくなる。方針「守り」で固められ、拠点を移すと一から作り直しになる。' },
    'st.cs': { t: '令呪', d: 'サーヴァントへの絶対命令。致命傷のときに退かせる・奮い立たせる、作戦会議で数日のあいだ力を引き上げる、マスター自身が殺されかけたときに呼び戻す、魔力を吸い尽くされかけたときに魔力に換えてしのぐ、といった使い道がある。討伐令の標的を倒すと増える。抗う英霊や、マスターの心が揺らいでいるときは、届かないこともある。' },
    'm.mana': { t: '魔力量', d: 'マスターの魔力の器。大きいほど蓄えが多く、毎日の戻りも早い。宝具を何度撃てるかに直結する。' },
    'm.craft': { t: '魔術', d: '魔術の腕。拠点の工房を固めやすく、偵察や使い魔で敵を探りやすく、真名の推理も当たりやすい。戦いでも、わずかに援護になる。' },
    'm.body': { t: '体力', d: 'マスター自身の命の強さ。刃や奇襲が届いても、生き延びやすい。' },
    'm.mind': { t: '精神', d: '心の強さ。令呪が揺らがずに届き、奮い立たせる令呪の力も増す。サーヴァントが魅了や幻惑に呑まれにくく、制御の難しい英霊も抑えやすい。' },
    'm.luck': { t: '幸運', d: '巡り合わせ。夜の街で敵に見つかりにくく、マスターを狙う刃や奇襲をかわしやすい。' },
    'ev.rate': { t: '平均勝率', d: 'リストの全騎と1対1で戦った場合の勝ちやすさ。S〜Eの評価はこれで決まる。今回の顔ぶれとの相性は含まない。' },
    'ev.power': { t: '基礎戦闘力', d: 'ステータスとスキルから見た、英霊そのものの戦闘力。夜の戦いでは、この差が勝ちやすさを大きく左右する。' },
    'ev.np': { t: '宝具の威力', d: '攻撃に使える最も強い宝具の力。宝具のランクと種別に、魔力や宝具を強めるスキルが加わる。解放した打ち合いで、戦闘力に上乗せされる。' },
  };
  const STAT_KEY_BY_JA = Object.fromEntries(Object.entries(H.build.STAT_JA).map(([k, v]) => [v, k]));
  // 要素に付ける属性（キーボードでも開けるように tabindex を付ける）
  const tipAttr = (key, cls) => ` data-tip="${key}"${cls ? ` data-cls="${esc(cls)}"` : ''} tabindex="0"`;
  const tipPop = document.createElement('div');
  tipPop.id = 'tipPop'; tipPop.className = 'tipop panel'; tipPop.setAttribute('role', 'tooltip'); tipPop.hidden = true;
  document.body.appendChild(tipPop);
  let tipEl = null, tipPinned = false;
  function tipBody(el) {
    const T = TIPS[el.dataset.tip]; if (!T) return null;
    let note = '';
    // クラスで重く見られるステータスが違う（セイバーの筋力など）
    if (T.w && el.dataset.cls) {
      const cw = H.classWeights(el.dataset.cls)[T.w], def = H.classDef(el.dataset.cls);
      if (cw > 1) note = `<p class="tn2">${esc(def.label || '')}のクラスでは、${esc(T.t)}が戦闘力として重く見られる。</p>`;
      else if (cw < 1) note = `<p class="tn2">${esc(def.label || '')}のクラスでは、${esc(T.t)}は戦闘力としてはやや軽く見られる。</p>`;
    }
    return `<b>${esc(T.t)}</b><p>${esc(T.d)}</p>${note}`;
  }
  function showTip(el, pinned) {
    const html = tipBody(el); if (!html) return;
    tipPop.innerHTML = html; tipPop.hidden = false; tipEl = el; tipPinned = !!pinned;
    el.setAttribute('aria-describedby', 'tipPop');
    // 要素の下（入らなければ上）に、画面からはみ出さないよう置く
    const r = el.getBoundingClientRect(), w = Math.min(320, innerWidth - 16);
    tipPop.style.width = w + 'px';
    tipPop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
    const h = tipPop.offsetHeight;
    tipPop.style.top = (r.bottom + 8 + h > innerHeight - 8 && r.top - 8 - h > 8 ? r.top - 8 - h : Math.min(innerHeight - h - 8, r.bottom + 8)) + 'px';
  }
  function hideTip() { if (tipEl) tipEl.removeAttribute('aria-describedby'); tipPop.hidden = true; tipEl = null; tipPinned = false; }
  document.addEventListener('pointerover', e => { if (e.pointerType !== 'mouse' || tipPinned) return; const el = e.target.closest('[data-tip]'); if (el && el !== tipEl) showTip(el, false); });
  document.addEventListener('pointerout', e => { if (e.pointerType !== 'mouse' || tipPinned) return; const el = e.target.closest('[data-tip]'); if (el && !(e.relatedTarget && el.contains(e.relatedTarget))) hideTip(); });
  // タップ（とクリック）で開いて固定、もう一度か、ほかの場所で閉じる
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-tip]');
    if (el) { if (tipPinned && tipEl && tipEl.dataset.tip === el.dataset.tip) hideTip(); else showTip(el, true); return; }
    if (!e.target.closest('#tipPop')) hideTip();
  }, true);
  document.addEventListener('focusin', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) showTip(el, false); });
  document.addEventListener('focusout', e => { if (!tipPinned && e.target.closest && e.target.closest('[data-tip]')) hideTip(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !tipPop.hidden) { hideTip(); e.stopPropagation(); } }, true);
  addEventListener('scroll', () => { if (!tipPop.hidden) hideTip(); }, { passive: true, capture: true });
  addEventListener('resize', () => { if (!tipPop.hidden) hideTip(); });

  // ---------- 途中セーブ・これまでの記録 ----------
  // 戦争はシード・データ・決断・方針で決まるので、保存するのはそれだけ（記録の本文は持たない）。
  //   中断中の戦争：hgw.save.v1（1つだけ）／ 終わった戦争：hgw.history.v1（新しい順に HIST_MAX 件）
  //   保護した記録（keep）は HIST_MAX に数えず、KEEP_MAX 件まで残す
  const SAVE_KEY = NS + 'save.v1', HIST_KEY = NS + 'history.v1', HIST_MAX = 10, KEEP_MAX = 30;
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };
  // リストの指紋。リストが変わると同じシードでも別の戦争になるので、再現の前に見比べる
  // （式は js/survival.js の fingerprint。生存曲線の集計の照合にも使う）
  const rosterFp = () => H.survival.fingerprint(roster);
  const loadHistory = () => { const l = store.get(HIST_KEY); return Array.isArray(l) ? l.filter(validRecord) : []; };
  const validRecord = r => r && typeof r.seed === 'string' && (r.view === 'you' || r.view === 'all') && Array.isArray(r.c) && typeof r.f === 'string' && r.sum;
  // 長さ・エクストラの無い古い記録は、既定（30日・あり）として扱う
  const recDays = r => clampDays(r.days || DEF_DAYS), recExtra = r => r.extra !== false, recPick = r => r.pick === 'open' ? 'open' : 'class';
  // 参戦から外したサーヴァントの id（無い古い記録は、外していないものとして扱う）
  const recEx = r => Array.isArray(r.ex) ? r.ex.filter(x => typeof x === 'string') : [];
  // ボス乱入の設定（無い古い記録は、起こりうる・必ずではない として扱う）
  const recIntr = r => r.intr !== false, recForce = r => r.intr !== false && r.force === true;
  const recordSig = r => [r.seed, r.view, r.fp || '', r.c.join('.'), r.f, recDays(r), recExtra(r) ? 1 : 0].concat(recPick(r) === 'open' ? ['open'] : [], recIntr(r) ? [] : ['nobj'], recForce(r) ? ['bf'] : [], recEx(r).length ? ['ex:' + recEx(r).slice().sort().join(',')] : [], pmSig(r.pm) ? [pmSig(r.pm)] : []).join('|');
  const fmtAt = t => { const d = new Date(t); return isNaN(d) ? '' : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

  // 中断に備えて今の位置を保存する（1日の始め・決断のあと・中断・ページを離れるとき）
  function saveProgress() {
    if (!gen || done || !out || !out.entries || !document.body.classList.contains('watching')) return false;
    if (op && !idx) return false; // 開戦の案内の途中は、まだ始まっていない
    const me = lastSnap.find(c => c.you);
    return store.set(SAVE_KEY, {
      v: 1, at: Date.now(), seed, view, data: source, fp: rosterFp(), days: maxDays, extra: extraOn, pick: pickMode, intr: intrOn ? undefined : false, force: intrOn && intrForce ? true : undefined, ex: castEx.length ? castEx.slice() : undefined,
      c: choices.concat(replay), f: replayFocus.length > focusLog.length ? replayFocus : focusLog,
      idx, focus, auto: autoAll, speed, name: playerName || undefined, sex: playerSex || undefined, age: playerAge || undefined, ali: playerAli || undefined, pm: playerPM || undefined, w: words.length ? words : undefined,
      sum: { city: out.city, day: curDay, label: me ? me.label : null, name: me ? metaOf(me.id).trueName : null, master: me ? me.master : null, alive: lastSnap.filter(c => c.alive).length },
    });
  }
  addEventListener('pagehide', saveProgress);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveProgress(); });

  // 結末の見出し。勝者あり（マスターを失って単独で勝ち残った場合も）／全滅（相討ちなど）／期限切れ
  // ボス乱入でボスを倒したときの勝者は、生き残り全員（暫定）。聖杯は壊れたので、願いは叶わない
  const isWin = id => !!result && (id === result.winner || (result.winners || []).includes(id));
  const hasBoss = r => !!r && r.camps.some(c => c.boss);
  const winText = () => result && result.ending === 'purge' ? '汚染された聖杯を砕いた' : result && result.ending === 'side' ? '聖杯大戦を生き残った' : '聖杯を手にした';
  function endHead(r) {
    const w = r.winner != null ? r.camps[r.winner] : null;
    if (r.ending === 'purge') return `汚染された聖杯は砕かれた。${r.camps.filter(c => (r.winners || []).includes(c.id)).map(c => `${c.cls}「${c.trueName}」`).join('、')}が、街を災厄から救った`;
    if (r.ending === 'side') return `${r.colors[r.sideWinner].name}の陣営が聖杯大戦を制した。${r.camps.filter(c => (r.winners || []).includes(c.id)).map(c => `${c.cls}「${c.trueName}」`).join('、')}が生き残った`;
    if (r.ending === 'scorched') return '汚染された聖杯の力が街を焼き尽くした。舞台は焦土と化した';
    if (r.ending === 'wipe' && hasBoss(r)) return '汚染された聖杯は砕かれたが、生き残った者はいなかった';
    if (w) return w.masterAlive === false ? `${w.cls}「${w.trueName}」が、マスターを失いながらもただ一騎で聖杯を手にした` : `${w.cls}「${w.trueName}」とマスター${w.master}が聖杯を手にした`;
    return r.ending === 'wipe' ? '最後の一騎までが斃れ、聖杯を手にした者はいなかった' : '聖杯を手にした者はいなかった';
  }
  // 終わった戦争を記録に足す（同じ戦争の再生なら足さない）
  function addHistory() {
    const w = result.winner != null ? result.camps[result.winner] : null, y = result.you != null ? result.camps[result.you] : null;
    const wins = result.winners ? result.winners.map(i => result.camps[i]).filter(Boolean).map(c => ({ label: c.label, name: c.trueName })) : null;
    const rec = {
      v: 1, at: Date.now(), seed, view, data: source, fp: rosterFp(), days: maxDays, extra: extraOn, pick: pickMode, intr: intrOn ? undefined : false, force: intrOn && intrForce ? true : undefined, ex: castEx.length ? castEx.slice() : undefined, c: choices.slice(), f: focusLog,
      name: playerName || undefined, sex: playerSex || undefined, age: playerAge || undefined, ali: playerAli || undefined, pm: playerPM || undefined, w: words.length ? words : undefined,
      sum: {
        city: result.city, days: result.days,
        winner: w ? { label: w.label, name: w.trueName, master: w.master, alone: w.masterAlive === false || undefined } : null, ending: result.ending, winners: wins || undefined, boss: hasBoss(result) ? result.camps.find(c => c.boss).trueName : undefined,
        you: y ? { label: y.label, name: y.trueName, master: y.master, won: isWin(y.id) && !result.youTaken, fate: y.fate ? y.fate.text : '', taken: result.youTaken ? { master: result.youTaken.master, won: isWin(y.id) } : undefined } : null,
        decided: choices.filter(k => k !== 'auto' && k !== 'shift' && k !== 'end').length,
      },
    };
    const list = loadHistory();
    const same = list.find(r => recordSig(r) === recordSig(rec));
    // 同じ戦争の再生なら足さない（新しく残した一言があれば、その記録に入れる）
    if (same) { if (!same.w && rec.w) { same.w = rec.w; store.set(HIST_KEY, list); } return; }
    list.unshift(rec);
    store.set(HIST_KEY, trimHistory(list));
  }
  // 新しい順に並べ、保護していない記録は HIST_MAX 件、保護した記録は KEEP_MAX 件まで残す
  function trimHistory(list) {
    list.sort((a, b) => (b.at || 0) - (a.at || 0));
    let n = 0, k = 0;
    return list.filter(r => (r.keep ? ++k <= KEEP_MAX : ++n <= HIST_MAX));
  }

  // 記録を作ったときとデータが違えば、切り替えるか確かめる
  function checkData(r) {
    if (r.data === 'local' && source !== 'local' && H.data.hasLocal()) dataReady(H.data.loadLocal(), 'local');
    if (roster.length < 2) { toast('サーヴァントのデータがまだ読み込まれていません'); return false; }
    if (r.fp && r.fp !== rosterFp()) return confirm('サーヴァントのリストが、この記録のときから変わっています。同じ展開にならないことがありますが、続けますか？');
    return true;
  }
  function resume() {
    const s = store.get(SAVE_KEY);
    if (!s || !validRecord(Object.assign({ sum: {} }, s)) || !checkData(s)) return;
    start({ mode: 'resume', seed: s.seed, view: s.view, speed: s.speed, days: recDays(s), extra: recExtra(s), pick: recPick(s), intr: recIntr(s), force: recForce(s), ex: recEx(s), c: s.c, f: s.f, to: Math.max(1, s.idx | 0), focus: s.focus, auto: s.auto, name: s.name, sex: s.sex, age: s.age, ali: s.ali, pm: s.pm, words: s.w });
  }
  function playRecord(r, how) {
    if (!checkData(r)) return;
    start({ mode: 'replay', seed: r.seed, view: r.view, days: recDays(r), extra: recExtra(r), pick: recPick(r), intr: recIntr(r), force: recForce(r), ex: recEx(r), c: r.c, f: r.f, name: r.name, sex: r.sex, age: r.age, ali: r.ali, pm: r.pm, words: r.w });
    if (how === 'end') fastForward();
    else toast('記録を再生しています。方針を変えると、そこから別の展開に分かれます');
  }
  function recordUrl(r) {
    const u = new URL(location.href); u.search = '';
    u.searchParams.set('seed', r.seed); u.searchParams.set('view', r.view);
    if (r.c.length) u.searchParams.set('c', r.c.join('.'));
    if (r.f.replace(/o/g, '')) u.searchParams.set('f', r.f);
    if (r.data === 'local') u.searchParams.set('data', 'local');
    if (recDays(r) !== DEF_DAYS) u.searchParams.set('d', recDays(r));
    if (!recExtra(r)) u.searchParams.set('x', '0');
    if (recPick(r) === 'open') u.searchParams.set('p', 'open');
    if (!recIntr(r)) u.searchParams.set('bj', '0');
    if (recForce(r)) u.searchParams.set('bf', '1');
    if (recEx(r).length) u.searchParams.set('ex', exParam(recEx(r)));
    if (r.name) u.searchParams.set('n', r.name);
    if (r.sex) u.searchParams.set('sx', r.sex === '女' ? 'f' : 'm');
    if (r.age) u.searchParams.set('ag', r.age);
    if (r.ali) u.searchParams.set('al', String(r.ali).toLowerCase());
    return u.href;
  }

  // 最初の画面：中断中の戦争と、これまでの記録
  function renderIntroRecords() {
    const s = store.get(SAVE_KEY);
    $('#resumeBox').hidden = !s; $('#overNote').hidden = !s;
    if (s && s.sum) {
      const who = s.sum.label ? `${s.sum.label}${s.sum.name ? '「' + s.sum.name + '」' : ''}のマスター、${s.sum.master || ''}` : 'すべてを知る観測者';
      $('#resumeInfo').innerHTML = `${esc(s.sum.city || '')}の${WAR}、${s.sum.day ? esc(s.sum.day) + '日目' : '開戦直後'}。${esc(who)}${s.sum.alive ? `。残り${esc(s.sum.alive)}騎` : ''}。<small>中断 ${esc(fmtAt(s.at))} ・ SEED ${esc(s.seed)}</small>`;
    }
    const list = loadHistory();
    $('#recMax').textContent = $('#recMax2').textContent = HIST_MAX; $('#keepMax').textContent = KEEP_MAX;
    $('#recEmpty').hidden = list.length > 0;
    $('#recExport').disabled = !list.length && !s; $('#recClear').disabled = !list.length && !s;
    $('#recList').innerHTML = list.map((r, i) => {
      const y = r.sum.you, w = r.sum.winner;
      const title = y ? `${y.label}「${y.name}」のマスター、${y.taken ? y.taken.master : y.master}` : 'すべてを知る観測者として';
      const res = y ? (y.taken ? (y.taken.won ? `マスターは命を落としたが、再契約した${y.label}「${y.name}」が聖杯を手にした。` : `マスターは命を落とした。再契約した${y.label}「${y.name}」は、${y.fate || '最後まで生き残った'}。`) : y.won ? (r.sum.ending === 'purge' ? '汚染された聖杯を砕いた。' : '聖杯を手にした。') : `${y.fate || '最後まで生き残った'}。`) + (w && !y.won && !(y.taken && y.taken.won) ? `勝者は${w.label}「${w.name}」。` : !w ? (r.sum.ending === 'purge' ? '' : '聖杯を手にした者はいなかった。') : '')
        : r.sum.ending === 'purge' ? `汚染された聖杯を砕き、${(r.sum.winners || []).map(x => `${x.label}「${x.name}」`).join('、')}が生き残った。`
        : r.sum.ending === 'side' ? `${(r.sum.winners || []).map(x => `${x.label}「${x.name}」`).join('、')}が、聖杯大戦を生き残った。`
        : r.sum.ending === 'scorched' ? `汚染された聖杯の力に敗れ、舞台は焦土と化した。`
        : w ? (w.alone ? `${w.label}「${w.name}」が、マスターを失いながらもただ一騎で聖杯を手にした。` : `${w.label}「${w.name}」とマスター${w.master}が聖杯を手にした。`) : r.sum.ending === 'wipe' ? '最後の一騎までが斃れ、聖杯を手にした者はいなかった。' : '聖杯を手にした者はいなかった。';
      const lastW = Array.isArray(r.w) && r.w.length ? r.w[r.w.length - 1] : null;
      return `<li class="${y && y.won ? 'won' : ''}${r.keep ? ' kept' : ''}"><div class="rt">${esc(title)}${r.keep ? '<span class="keepmark">保護</span>' : ''}</div>
        <div class="rm">${esc(fmtAt(r.at))} ・ ${esc(r.sum.city || '')} ・ ${esc(r.sum.days)}日間${recDays(r) !== DEF_DAYS ? `（最長${recDays(r)}日）` : ''}${recExtra(r) ? '' : ' ・ エクストラなし'}${recPick(r) === 'open' ? ' ・ 全騎から均等' : ''}${recEx(r).length ? ' ・ 参戦を絞った' : ''}${r.sum.decided ? ` ・ 決断${esc(r.sum.decided)}回` : ''}${r.data === 'local' ? ' ・ リストツールで作ったリスト' : ''}</div>
        <p class="rr">${esc(res)}</p>
        ${lastW ? `<p class="rw">「${esc(lastW.text)}」</p>` : ''}
        <div class="ra"><button class="btn" data-rec="${i}" data-how="full">最初から見る</button><button class="btn" data-rec="${i}" data-how="end">結末だけ見る</button><button class="btn" data-rec="${i}" data-how="link">リンクをコピー</button>
          <button class="btn" data-rec="${i}" data-how="keep" aria-pressed="${!!r.keep}" title="保護した記録は、新しい戦争が増えても消えずに残ります">${r.keep ? '★ 保護中' : '☆ 保護する'}</button><button class="btn del" data-rec="${i}" data-how="del">消す</button></div></li>`;
    }).join('');
  }
  $('#recList').addEventListener('click', async e => {
    const b = e.target.closest('[data-rec]'); if (!b) return;
    const list = loadHistory(), r = list[+b.dataset.rec]; if (!r) return;
    if (b.dataset.how === 'keep') {
      if (!r.keep && list.filter(x => x.keep).length >= KEEP_MAX) return toast(`保護できるのは${KEEP_MAX}件までです。ほかの記録の保護を外してください`);
      r.keep = !r.keep;
      store.set(HIST_KEY, trimHistory(list)); renderIntroRecords();
      return toast(r.keep ? 'この記録を保護しました。新しい戦争が増えても消えません' : '保護を外しました。新しい戦争が増えると、古いものから消えます');
    }
    if (b.dataset.how === 'del') {
      if (!confirm(`この記録を消します。元には戻せません。よろしいですか？\n\n${fmtAt(r.at)} ・ ${r.sum.city || ''} ・ ${r.sum.you ? r.sum.you.label + '「' + r.sum.you.name + '」' : '観測者'}`)) return;
      list.splice(+b.dataset.rec, 1); store.set(HIST_KEY, list); renderIntroRecords();
      return toast('記録を1件消しました');
    }
    if (b.dataset.how === 'link') { try { await navigator.clipboard.writeText(recordUrl(r)); toast('リンクをコピーしました'); } catch (err) { toast('コピーできませんでした'); } return; }
    playRecord(r, b.dataset.how);
  });
  $('#resumeBtn').onclick = resume;
  $('#resumeDrop').onclick = () => { if (confirm('中断中の' + WAR + 'を破棄します。よろしいですか？')) { store.set(SAVE_KEY, null); renderIntroRecords(); } };

  // 書き出し・読み込み（別の端末やブラウザへ移す）
  $('#recExport').onclick = () => {
    const data = { format: REC_FMT, version: 1, at: new Date().toISOString(), history: loadHistory(), save: store.get(SAVE_KEY) };
    const a = document.createElement('a'), d = new Date();
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    a.download = `${WAR}の記録_${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`記録${data.history.length}件${data.save ? 'と中断中の戦争' : ''}を書き出しました`);
  };
  $('#recImport').onchange = async e => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch (err) { return toast('読み込めませんでした（JSONではありません）'); }
    if (!data || data.format !== REC_FMT) return toast(WAR + 'の記録のファイルではありません');
    const incoming = (Array.isArray(data.history) ? data.history : []).filter(validRecord);
    const list = loadHistory(), sigs = new Set(list.map(recordSig));
    let added = 0;
    for (const r of incoming) if (!sigs.has(recordSig(r))) { list.push(r); sigs.add(recordSig(r)); added++; }
    const kept = trimHistory(list), dropped = list.length - kept.length;
    store.set(HIST_KEY, kept);
    let saveMsg = '';
    if (data.save && validRecord(Object.assign({ sum: {} }, data.save))) {
      const cur = store.get(SAVE_KEY);
      if (!cur || (cur.at !== data.save.at && confirm('ファイルに中断中の' + WAR + 'が入っています。今の中断中の戦争と置き換えますか？'))) { store.set(SAVE_KEY, data.save); saveMsg = 'と中断中の戦争'; }
    }
    renderIntroRecords();
    toast(`記録${added}件${saveMsg}を読み込みました${incoming.length - added ? `（同じ記録${incoming.length - added}件は省略）` : ''}${dropped ? `。古い${dropped}件は、残せる数（保護していないもの${HIST_MAX}件）を超えたので外しました` : ''}`);
  };
  $('#recClear').onclick = () => {
    if (!confirm('これまでの' + WAR + 'の記録（保護したものも含む）と、中断中の戦争をすべて消します。元には戻せません。よろしいですか？')) return;
    store.set(HIST_KEY, null); store.set(SAVE_KEY, null); renderIntroRecords(); toast('記録をすべて消しました');
  };
  renderIntroRecords();

  // ---------- 結末：陣営の目的と歩み・絆の推移・決断の一覧 ----------
  const AIM = {
    aggressive: '先手を取り、敵を一騎ずつ減らしていく',
    defensive: '拠点を固め、攻め込んでくる敵を迎え撃つ',
    intel: '敵の拠点と真名を探り、勝てる相手を選んで戦う',
    diplomacy: '同盟を結び、数の利で勝ち残る',
    balanced: '情勢を見て、攻めと守りを使い分ける',
  };
  // プレイヤー以外の陣営（観測者なら七陣営すべて）が、何を求め、どう戦い、どう終わったか
  function purposeSection() {
    const youEver = new Set();
    for (const e of out.entries) if (e.snap) for (const c of e.snap) if (c.you) youEver.add(c.id);
    const camps = result.camps.filter(c => !youEver.has(c.id) && !c.boss && !c.overseer);   // 乱入したボスは、陣営ではない
    if (!camps.length) return '';
    const PL = H.engine.POLICIES;
    const items = camps.map(c => {
      const meta = metaOf(c.id), m = meta.master || {}, sv = servantOf(c.id);
      const svWish = sv && sv.profile && sv.profile.wish;
      // 最も多く刃を交えた相手
      const foes = {};
      for (const e of out.entries) if (e.kind === 'battle' && e.head && e.ids.includes(c.id)) for (const id of e.ids) if (id !== c.id) foes[id] = (foes[id] || 0) + 1;
      const top = Object.entries(foes).sort((a, b) => b[1] - a[1])[0];
      const topC = top ? result.camps[+top[0]] : null;
      // 歩み：この陣営が主役の大きな出来事（自分の令呪・同盟・とどめを刺した相手・自分の脱落など）。古い順に、終わりに近い4つ
      const moments = out.entries.filter(e => e.ids && hlCheck(e) && e.kind !== 'end'
        && (e.ids[0] === c.id || (e.kind === 'ally' && e.ids.includes(c.id)) || (e.fin && e.fin.by === c.id))).slice(-4);
      const won = isWin(c.id);
      const st = won ? winText() : c.alive ? '生き残った' : c.fate ? c.fate.day + '日目に脱落' : '脱落';
      return `<li class="${won ? 'win' : c.alive ? 'alive' : ''}">
        <div class="ph"><span>${ci(String(c.servantId || '').split(':')[0])}${esc(c.label)}「${esc(c.trueName)}」</span><span class="st">${esc(st)}</span></div>
        <dl>
          <dt>マスター</dt><dd>${esc(c.master)}<br><small>${esc([c.origin, c.persona].filter(Boolean).join('・'))}</small></dd>
          <dt>願い</dt><dd class="wish">「${esc(m.wish || c.wish)}」${svWish ? `<br><small>英霊の願い：「${esc(svWish)}」</small>` : ''}</dd>
          <dt>狙い</dt><dd>${esc((PL[c.policy] || {}).label || '')}。${esc(AIM[c.policy] || '')}</dd>
          <dt>戦い</dt><dd>${c.battles}戦・宝具${c.npUses}回${c.kills.length ? `・倒した相手：${esc(c.kills.join('、'))}` : ''}${topC ? `<br><small>最も多く刃を交えた相手：${esc(topC.label)}「${esc(topC.trueName)}」（${top[1]}回）</small>` : ''}</dd>
          ${!won && c.fate ? `<dt>結末</dt><dd>${esc(c.fate.text)}</dd>` : ''}
        </dl>
        ${moments.length ? `<ol>${moments.map(e => `<li><b>D${String(e.day).padStart(2, '0')}</b>${esc(e.text)}</li>`).join('')}</ol>` : ''}
      </li>`;
    }).join('');
    return `<details class="rsec"><summary><h5>${youId != null ? `他の${!GW && camps.length === 6 ? '六' : camps.length}陣営` : N_JA + '陣営'}の目的と歩み</h5></summary>
      <p class="lead3">それぞれのマスターが聖杯に託した願いと、戦い方の狙い。歩みの文は、あなたがその時点で知っていたことで書かれています。</p>
      <ul class="purp">${items}</ul></details>`;
  }

  // 絆の推移（あなたの陣営。再契約などで陣営が変わったら、そのときの陣営の絆）
  function bondSeries() {
    const byDay = [];
    for (const e of out.entries) { if (!e.snap) continue; const me = e.snap.find(c => c.you); if (me) byDay[e.day || 0] = { bond: me.bond, label: me.label, alive: me.alive }; }
    const pts = []; let last = null;
    for (let d = 0; d <= result.days; d++) { if (byDay[d]) last = byDay[d]; if (last) pts.push(Object.assign({ d }, last)); }
    return pts;
  }
  function bondSection() {
    if (youId == null) return '';
    const pts = bondSeries();
    if (pts.length < 2) return '';
    // 描く幅を画面に合わせる（縮小で目盛りの文字が小さくなりすぎないように）
    const narrow = matchMedia('(max-width: 820px)').matches;
    const W = narrow ? 360 : 600, Hh = narrow ? 160 : 170, L = 28, R = 10, T = 12, Bm = 24, iw = W - L - R, ih = Hh - T - Bm, n = result.days;
    const x = d => L + d / Math.max(1, n) * iw, y = v => T + (1 - v / 100) * ih;
    const grid = [0, 25, 50, 75, 100].map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(141,174,212,.18)" stroke-width="1"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" fill="var(--mute)" font-size="10">${v}</text>`).join('');
    const step = n > 20 ? 5 : n > 10 ? 2 : 1;
    const xt = []; for (let d = 0; d <= n; d += step) xt.push(`<text x="${x(d)}" y="${Hh - 6}" text-anchor="middle" fill="var(--mute)" font-size="10">${d === 0 ? '開戦' : d}</text>`);
    const P = p => `${x(p.d).toFixed(1)},${y(p.bond).toFixed(1)}`;
    // サーヴァントがいる間は実線、消滅してからは点線（再契約すればまた実線）
    let solid = '', faint = '';
    pts.forEach((p, i) => {
      if (!i) { solid = 'M' + P(p); return; }
      const seg = `M${P(pts[i - 1])}L${P(p)}`;
      if (p.alive) solid += pts[i - 1].alive ? 'L' + P(p) : seg; else faint += seg;
    });
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${P(p)}`).join('');
    const area = `${line}L${x(pts[pts.length - 1].d).toFixed(1)},${y(0)}L${x(pts[0].d).toFixed(1)},${y(0)}Z`;
    // 自分のサーヴァントが消滅した日に印を付ける
    const fell = out.entries.find(e => e.kind === 'death' && e.you && e.snap && e.snap.some(c => c.you && !c.alive && e.ids[0] === c.id));
    const mark = fell ? `<line x1="${x(fell.day)}" x2="${x(fell.day)}" y1="${T}" y2="${T + ih}" stroke="var(--seal)" stroke-width="1" stroke-dasharray="3 3"/><text x="${x(fell.day) + 4}" y="${T + 10}" fill="var(--seal)" font-size="10">消滅</text>` : '';
    const first = pts[0], lastP = pts[pts.length - 1], peak = pts.reduce((a, b) => (b.bond > a.bond ? b : a));
    bondPts = pts; bondGeo = { x, y, L, iw, n, W };
    return `<details class="rsec"><summary><h5>絆の推移</h5></summary>
      <p class="bondsum">開戦時 <b>${first.bond}</b> → 最も深まったのは${peak.d ? peak.d + '日目' : '開戦時'}の <b>${peak.bond}</b> → 結末で <b>${lastP.bond}</b></p>
      <div class="bondbox"><svg id="bondSvg" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="絆の推移。開戦時${first.bond}、最高${peak.bond}、結末${lastP.bond}">
        ${grid}${xt.join('')}${mark}
        <path d="${area}" fill="var(--bond)" fill-opacity=".10"/>
        <path d="${solid}" fill="none" stroke="var(--bond)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${faint ? `<path d="${faint}" fill="none" stroke="var(--bond)" stroke-opacity=".45" stroke-width="2" stroke-dasharray="4 4"/>` : ''}
        <g id="bondHover" visibility="hidden"><line id="bondCross" y1="${T}" y2="${T + ih}" stroke="rgba(232,247,255,.35)" stroke-width="1"/><circle id="bondDot" r="5" fill="var(--bond)" stroke="var(--void)" stroke-width="2"/></g>
        <rect x="${L}" y="${T}" width="${iw}" height="${ih}" fill="transparent" id="bondHit"/>
      </svg><div class="tip" id="bondTip" hidden></div></div>
      <details class="num"><summary>日ごとの値を見る</summary><p>${pts.map(p => `${p.d ? 'D' + p.d : '開戦'}:${p.bond}`).join('　')}</p></details></details>`;
  }
  let bondPts = [], bondGeo = null;
  function bindBondHover() {
    const svg = $('#bondSvg'); if (!svg || !bondGeo) return;
    const G = bondGeo;
    const move = ev => {
      const r = svg.getBoundingClientRect(), sx = (ev.clientX - r.left) / r.width * G.W;
      const d = Math.round((sx - G.L) / G.iw * G.n);
      const p = bondPts.find(q => q.d === Math.max(0, Math.min(G.n, d))); if (!p) return;
      $('#bondHover').setAttribute('visibility', 'visible');
      $('#bondCross').setAttribute('x1', G.x(p.d)); $('#bondCross').setAttribute('x2', G.x(p.d));
      $('#bondDot').setAttribute('cx', G.x(p.d)); $('#bondDot').setAttribute('cy', G.y(p.bond));
      const tip = $('#bondTip'); tip.hidden = false;
      tip.textContent = `${p.d ? p.d + '日目' : '開戦'} ・ 絆 ${p.bond}${p.alive ? '' : '（消滅後）'}`;
      tip.style.left = Math.max(60, Math.min(r.width - 60, G.x(p.d) / G.W * r.width)) + 'px';
    };
    const leave = () => { $('#bondHover').setAttribute('visibility', 'hidden'); $('#bondTip').hidden = true; };
    svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move); svg.addEventListener('pointerleave', leave);
  }

  // 決断の一覧と、方針の移り変わり
  function decisionSection() {
    if (youId == null) return '';
    const list = out.entries.filter(e => e.kind === 'choice');
    const runs = [];
    for (let i = 0; i < Math.min(focusLog.length, result.days); i++) {
      const k = FOCUS_BY_CODE[focusLog[i]] || 'auto', lastR = runs[runs.length - 1];
      if (lastR && lastR.k === k) lastR.to = i + 1; else runs.push({ k, from: i + 1, to: i + 1 });
    }
    const runTxt = runs.map(r => `<b>${r.from === r.to ? r.from + '日目' : r.from + '〜' + r.to + '日目'} ${esc(FOCUS[r.k].label)}</b>`).join(' → ');
    if (!list.length && !runs.length) return '';
    return `<details class="rsec"><summary><h5>決断の一覧（${list.length}件）</h5></summary>
      ${list.length ? `<ol class="declist">${list.map(e => `<li class="${e.auto ? 'auto' : ''}"><b>D${String(e.day || 0).padStart(2, '0')} ${PH[e.phase] || ''}</b><span>${e.q ? `<span class="dq">${esc(e.q)}</span>` : ''}<span class="da">${esc(e.text)}</span></span></li>`).join('')}</ol>` : '<p class="lead3">大きな決断を迫られることはなかった。</p>'}
      ${runTxt ? `<p class="focusrun">方針の移り変わり：${runTxt}</p>` : ''}</details>`;
  }

  // 上部バー：目標値へ向けて常になめらかに近づき続ける（ログ1件ごとの階段状にならない）
  function glideProg(el, pct) {
    el._t = pct;
    if (el._v == null || pct < el._v - 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) { el._v = pct; el.style.width = pct + '%'; return; }
    if (el._raf) return;
    let last = performance.now();
    const f = now => {
      const dt = Math.min(100, now - last); last = now;
      el._v += (el._t - el._v) * (1 - Math.exp(-dt / 700));
      if (Math.abs(el._t - el._v) < 0.02) { el._v = el._t; el._raf = 0; } else el._raf = requestAnimationFrame(f);
      el.style.width = el._v + '%';
    };
    el._raf = requestAnimationFrame(f);
  }

  function board(e) {
    if (!e || !e.snap) return;
    lastSnap = e.snap;
    discover(e.snap);
    curDay = e.day || curDay;
    $('#dayNo').textContent = String(curDay).padStart(2, '0');
    const youNow = e.snap.find(c => c.you) || (youId != null ? e.snap[youId] : null);
    const fin = done && idx >= out.entries.length;
    $('#hudSub').textContent = `${out.city} ・ ${PH[e.phase] || ''} ・ ${youNow ? 'マスター ' + youNow.master : '観測者'} ・ SEED ${seed}`;
    const dayEntries = out.entries.filter(x => x.day === curDay);
    const pos = out.entries.slice(0, idx).filter(x => x.day === curDay).length;
    // その日の進み具合（1日で満タン、翌日は0から。ログ件数ごとの階段にならないよう滑らかに追う）
    glideProg($('#prog'), fin ? 100 : Math.min(100, pos / Math.max(1, dayEntries.length) * 100));
    // 情景：戦いの場所 → 自分の拠点 → 街
    const scene = e.scene || (youNow && youNow.scene) || H.SCENE_CONFIG.defaultScene;
    const place = e.place || (youNow ? `${youNow.base}（あなたの拠点）` : out.city);
    $('#sceneCap').textContent = `${out.city} ・ ${place}`;
    setScene(scene, e.phase === 'day' ? 'day' : 'night', e.weather);

    if (youNow) {
      $('#idCity').textContent = out.city;
      $('#mName').textContent = youNow.master;
      sealN = youNow.cs;
      const sealKey = sealN + '|' + sealRev + '|' + out.seed; // 細かい紋様を毎回描き直さない
      if (sealKey !== sealMarkKey) { sealMarkKey = sealKey; $('#sealMark').innerHTML = sealSvg(sealN); if ($('#sealDlg').classList.contains('on')) renderSealBig(); }
      const meta = metaOf(youNow.id);
      $('#mKv').innerHTML = `<dt>出自</dt><dd>${esc(youNow.origin)}</dd>${youNow.persona ? `<dt>性格</dt><dd>${esc(youNow.persona)}</dd>` : ''}<dt${tipAttr('st.cs')}>令呪</dt><dd>残り${youNow.cs}画</dd><dt>状態</dt><dd>${youNow.masterAlive ? '健在' : '死亡'}</dd><dt>願い</dt><dd>${esc(youNow.wish)}</dd>`;
      $('#svClass').innerHTML = ci(keyOf(youNow.id)) + esc(youNow.label); $('#svLore').hidden = !canLore(youNow.id);
      $('#svName').innerHTML = `${esc(meta.trueName)}${youNow.alive ? '' : '<small>消滅</small>'}`;
      if ($('#svFace').dataset.face !== faceOf(youNow.id)) { $('#svFace').dataset.face = faceOf(youNow.id); $('#svFace').hidden = true; $('#svFace').removeAttribute('src'); }
      fillFaces($('#svFace').parentNode);
      const svNow = servantOf(youNow.id), clsKey = svNow ? svNow.class.key : '';
      $('#svRanks').innerHTML = meta.ranks.map(([k, v]) => `<div${tipAttr('sv.' + STAT_KEY_BY_JA[k], clsKey)} data-r="${(/EX|[A-E]/.exec(String(v)) || ['-'])[0]}"><span>${k}</span><b>${esc(v)}</b></div>`).join('');
      $('#svSkills').innerHTML = `<b>スキル</b>${esc(meta.skills)}<br><b>宝具</b>${esc(meta.nps)}`;
      const bars = [['霊基', youNow.alive ? youNow.hp : 0, 'var(--hp)', 'st.hp'], ['魔力', youNow.masterAlive ? youNow.mana : 0, 'var(--mana)', 'st.mana'], ['絆', youNow.bond, 'var(--bond)', 'st.bond'], ['工房', youNow.workshop * 10, 'var(--ws)', 'st.ws']];
      $('#bars').innerHTML = bars.map(([k, v, c, t]) => `<div${tipAttr(t)}><span>${k}</span><span class="bar"><i style="width:${v}%;background:${c};color:${c}"></i></span><span>${k === '工房' ? Math.ceil(youNow.workshop / 2) : v}</span></div>`).join('');
      $('#stripBars').innerHTML = bars.slice(0, 3).map(([k, v, c, t]) => `<span class="s"${tipAttr(t)}><span>${k}<b>${v}</b></span><span class="bar"><i style="width:${v}%;background:${c};color:${c}"></i></span></span>`).join('') + `<span class="s"${tipAttr('st.cs')}><span>令呪</span>${sealsInline(youNow.cs)}</span>`;
    }
    const alive = e.snap.filter(c => c.alive && !c.boss && !c.overseer).length, bossUp = e.snap.some(c => c.boss && c.alive), inWar = e.snap.some(c => c.side != null), colors = out.colors || [];
    $('#aliveCount').textContent = inWar ? colors.map((x, i) => `${x.name} ${e.snap.filter(c => c.alive && c.side === i).length}`).join(' ・ ') : `残り ${alive} 騎${bossUp ? '＋汚染' : ''}`;
    // 大戦の間は色ごとに。移行してからは生き残りの戦いなので、並びはそのまま
    const order = inWar ? [0, 1].flatMap(i => e.snap.filter(c => c.side === i)).concat(e.snap.filter(c => c.side == null)) : e.snap;
    let lastSide = -1;
    $('#camps').innerHTML = order.map(c => {
      const groupHead = inWar && (c.side != null ? c.side : 2) !== lastSide ? (lastSide = c.side != null ? c.side : 2, `<li class="sidehead" style="--side:${c.side != null ? colors[c.side].hex : 'var(--gold)'}">${c.side != null ? esc(colors[c.side].name) + 'の陣営' : '監督役'}</li>`) : '';
      const sideStyle = c.side != null ? ` style="--side:${colors[c.side].hex}"` : '';
      const win = fin && result && isWin(c.id);
      const st = win ? winText() : c.overseer ? (c.alive ? '裁定者' : '討たれた') : c.boss ? (c.alive ? '汚染された英霊' : '討たれた') : c.alive ? (!c.masterAlive ? `はぐれ（あと${c.soloLeft}日）` : c.bounty ? '討伐令' : '健在') : (c.fate ? c.fate.replace(/^(\d+日目).*$/, '$1に脱落') : '脱落');
      const can = canLore(c.id);
      return groupHead + `<li${sideStyle} class="${c.side != null ? 'sided ' : ''}${c.you ? 'you' : ''}${c.alive ? '' : ' down'}${win ? ' win' : ''}${c.boss || c.overseer ? ' boss' : ''}${can ? ' can' : ''}"${can ? ` data-lore="${c.id}" tabindex="0" role="button" aria-label="${esc(c.label + '「' + c.name + '」の解説')}"` : ''}>
        <div class="cf">${can ? fic(faceOf(c.id), keyOf(c.id), true) : ci(keyOf(c.id), true)}</div>
        <div class="row1"><b>${esc(c.label)}${c.name ? '「' + esc(c.name) + '」' : ''}</b><span class="st">${esc(st)}</span></div>
        <div class="sub">${c.overseer ? 'マスターなし' : esc(c.master)}${c.you ? ' ・ あなた' : c.persona ? '（' + esc(c.persona) + '）' : ''}${!c.name && c.clues && c.alive ? ' ・ 手がかり' + c.clues : ''}${(() => { const al = (c.allies && c.allies.length ? c.allies : c.ally != null ? [c.ally] : []).filter(i => e.snap[i]); return !inWar && al.length ? ' ・ ' + al.map(i => esc(e.snap[i].label)).join('・') + 'と同盟' : ''; })()} ${c.boss || c.overseer ? '' : sealsInline(c.cs)}</div>
        ${c.alive ? `<div class="hpb"><i style="width:${c.hp}%"></i></div>` : ''}
      </li>`;
    }).join('');
    const shiftAt = out.entries.slice(0, idx).findIndex(x => x.shift);
    const seen = out.entries.slice(shiftAt < 0 ? 0 : shiftAt, idx);
    const deaths = new Set(seen.filter(x => x.kind === 'death').map(x => x.day));
    const fought = new Set(seen.filter(x => x.kind === 'battle' && x.you).map(x => x.day));
    fillFaces($('#camps'));
    $('#cal').innerHTML = Array.from({ length: shiftAt < 0 ? maxDays : H.CONFIG.GREAT_WAR.warDays }, (_, i) => { const d = i + 1; return `<span class="${d < curDay ? 'past' : ''}${d === curDay ? ' now' : ''}${fought.has(d) ? ' fought' : ''}${deaths.has(d) ? ' death' : ''}" title="${d}日目"></span>`; }).join('');
  }
  const sealsInline = n => `<span class="seals-inline" aria-label="令呪 残り${n}画">${[0, 1, 2].map(i => `<i class="${i < n ? '' : 'used'}"></i>`).join('')}${n > 3 ? '+' + (n - 3) : ''}</span>`;
  // 令呪の紋様（残りの画数だけ光る）
  function sealSvg(n) {
    return H.sealmark.markup(warSeal(), n, 84) + (n > 3 ? `<span class="more">+${n - 3}</span>` : '');
  }
  function metaOf(id) { return (out && out.meta && out.meta[id]) || { trueName: '', ranks: [], skills: '', nps: '' }; }

  function finish() {
    clearTimeout(timer);
    $('#pause').textContent = '終幕'; $('#pause').disabled = true; $('#skip').disabled = true;
    if ($('#result').innerHTML) return;
    board(out.entries[out.entries.length - 1]);
    syncLog();
    // 結末を出す前に、最後の一言を聞く
    if (wordsOn && youId != null && !wordAsked.has('end')) { wordArm = []; return askWord('end'); }
    const w = result.winner != null ? result.camps[result.winner] : null;
    const you = result.you != null ? result.camps[result.you] : null;
    const head = endHead(result), purge = result.ending === 'purge', burnt = result.ending === 'scorched';
    const yours = you ? (result.ending === 'side' && isWin(you.id) ? 'あなたの陣営は、聖杯大戦を勝ち残った。' : purge && isWin(you.id) ? `あなたの陣営は、同盟の仲間とともに汚染された聖杯を砕き、生き残った。` : burnt ? `あなたの${you.label}「${you.trueName}」は、${you.alive ? '焦土の中で生き延びた。' : (you.fate ? you.fate.text : '焦土に消えた') + '。'}` : result.youTaken ? `あなたは命を落としたが、再契約した${you.label}「${you.trueName}」は${you.id === result.winner ? '勝ち残り、聖杯を手にした。' : `、${you.fate ? you.fate.text : '最後まで生き残った'}。`}` : you.id === result.winner ? 'あなたの陣営が勝ち残った。' : `あなたの${you.label}「${you.trueName}」は、${you.fate ? you.fate.text : '最後まで生き残った'}。`) : '';
    const decided = choices.filter(k => k !== 'auto' && k !== 'shift' && k !== 'end').length;
    $('#result').innerHTML = `<section class="panel result" aria-label="結末"><div class="hd"><i class="chev"></i><span class="en">Result</span><span class="ja">結末・${result.shiftDay != null ? `大戦${result.shiftDay}日＋聖杯戦争${result.days}日` : result.days + '日間'}</span></div><div class="body">
      <h4>${esc(head)}</h4>
      <p>${esc(yours)}${decided ? `あなたが下した大きな決断は${decided}回。` : ''}</p>
      ${lastWordHtml()}
      <table><tr><th>CLASS</th><th>真名</th><th>MASTER</th><th>結末</th></tr>
        ${result.camps.map(c => `<tr class="${isWin(c.id) ? 'win' : ''}"><td>${canLore(c.id) ? fic(H.faceNameOfId(c.servantId) || c.trueName, String(c.servantId || '').split(':')[0]) : ci(String(c.servantId || '').split(':')[0])}${esc(c.label)}</td><td>${canLore(c.id) ? `<button class="namebtn" data-lore="${c.id}" title="解説を見る">${esc(c.trueName)}</button>` : esc(c.trueName)}</td><td>${esc(c.master)}<br><small>${esc(c.origin)}${c.persona ? '・' + esc(c.persona) : ''}</small></td><td>${esc(isWin(c.id) ? winText() : c.fate ? c.fate.text : '')}${c.kills.length ? `<br><small>倒した相手：${esc(c.kills.join('、'))}</small>` : ''}</td></tr>`).join('')}
      </table>
      ${reviewSection()}
      ${purposeSection()}
      ${bondSection()}
      ${decisionSection()}
      ${wordsSection()}
      ${hlTimeline()}
      <div class="acts"><button class="btn primary" id="again">別の${WAR}を始める</button><button class="btn" id="share">この戦争のリンクをコピー</button>${youId != null ? '<button class="btn" id="mine">自陣営の記録を見る</button>' : ''}<button class="btn" id="csv2">記録をCSVで保存</button><button class="btn" id="cardBtn">画像にする</button><button class="btn" id="back">最初の画面へ</button></div>
    </div></section>`;
    $('#result').querySelectorAll('[data-lore]').forEach(b => b.onclick = () => openLore(+b.dataset.lore));
    fillFaces($('#result'));
    bindBondHover();
    $('#csvBtn').hidden = false;
    // 終わった戦争は記録に残し、中断の保存は消す
    store.set(SAVE_KEY, null);
    addHistory();
    // 結末の表で全員の真名が明かされるので、参戦した英霊はみな図鑑に載せる
    ZK.add(result.camps.map(c => c.servantId));
    $('#csv2').onclick = exportCsv;
    $('#cardBtn').onclick = openImages;
    const mine = $('#mine'); if (mine) mine.onclick = () => { setLogFilter('you'); $('#logWrap').classList.add('open'); $('#logMore').setAttribute('aria-expanded', 'true'); syncLog(); $('#logWrap').scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' }); };
    $('#again').onclick = () => { $('#seed').value = ''; start(); };
    $('#back').onclick = quit;
    $('#share').onclick = async () => { try { await navigator.clipboard.writeText(location.href); toast('リンクをコピーしました。同じデータなら、同じ選択で同じ戦争が再現されます'); } catch (e) { toast('コピーできませんでした。アドレスバーのURLを共有してください'); } };
    toTop(true);
  }
  // サーヴァントの最後の一言（セリフから。勝てば勝利・聖杯、消えていれば戦闘不能・消滅、残っていれば絆・会話）
  // 選び方は乱数ではなくシードで決まる（再生しても同じ一言）
  function finalQuote() {
    if (youId == null || !result) return null;
    const me = lastSnap.find(c => c.you) || (result.youTaken ? lastSnap[result.you] : null); if (!me) return null;
    const sv = servantOf(me.id); if (!sv || !sv.voice) return null;
    // 場面の名前は config.js の VOICE_SLOTS（戦闘不能には消滅も含む）
    const keys = isWin(me.id) ? ['勝利', '聖杯について', '絆'] : me.alive ? ['絆', '聖杯について', '会話'] : ['戦闘不能', '敗北', '絆'];
    for (const k of keys) {
      const lines = H.voiceLines(sv, k); if (!lines.length) continue;
      let h = 2166136261; const t = seed + ':last:' + k; for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
      return { who: `${me.label}「${sv.trueName}」`, text: lines[(h >>> 0) % lines.length] };
    }
    return null;
  }
  function lastWordHtml() {
    const q = finalQuote(), w = words.length ? words[words.length - 1] : null;
    return (q ? `<div class="lastword"><span class="who">最後に、${esc(q.who)}から一言</span><p>「${esc(q.text)}」</p></div>` : '')
      + (w ? `<div class="lastword" style="border-color:var(--bond)"><span class="who">あなたの一言（${esc(w.q || '')}）</span><p style="color:var(--bond)">「${esc(w.text)}」</p></div>` : '');
  }
  // あなたが残した言葉の一覧
  function wordsSection() {
    if (!words.length) return '';
    return `<details class="rsec"><summary><h5>あなたが残した言葉（${words.length}）</h5></summary><ol class="wordlist">${words.map(w =>
      `<li><b>${w.day ? 'D' + String(w.day).padStart(2, '0') : '開戦'}</b><span><span class="wq">${esc(w.q || '')}</span><span class="wt">「${esc(w.text)}」</span></span></li>`).join('')}</ol></details>`;
  }
  // ---------- 戦後の振り返り（数字・戦況の推移・転機・目立った陣営） ----------
  // 記録（out.entries）と結末（result）から作る。表示だけで、戦争の中身には関わらない
  function reviewData() {
    // 通しの日数（聖杯大戦は、聖杯戦争へ移ると日付が1日目に戻る）
    const abs = new Map(); let off = 0, prev = 0, shiftAbs = null;
    for (const e of out.entries) {
      const d = e.day || 0;
      if (d >= 1 && d < prev) { off += prev; if (shiftAbs == null) shiftAbs = off; }
      if (d) prev = d;
      abs.set(e, off + (d || prev));
    }
    const total = off + prev;
    const dayJa = a => !a ? '開戦' : shiftAbs != null && a > shiftAbs ? `聖杯戦争${a - shiftAbs}日目` : `${a}日目`;
    // 日ごとの様子（その日の最後の記録のもの）：残っている英霊の数と、あなたのサーヴァントの霊基
    const days = [];
    for (const e of out.entries) {
      if (!e.snap) continue;
      const me = e.snap.find(c => c.you);
      days[abs.get(e)] = { alive: e.snap.filter(c => c.alive && !c.boss && !c.overseer).length, hp: me && me.alive ? me.hp : me ? 0 : null };
    }
    let last = null; for (let d = 0; d <= total; d++) { if (days[d]) last = days[d]; else if (last) days[d] = last; }
    const deaths = out.entries.filter(e => e.kind === 'death');
    return { abs, total, shiftAbs, dayJa, days, deaths };
  }
  function reviewSection() {
    if (!out || !out.entries.length || !result) return '';
    const R = reviewData(), E = out.entries, n = Math.max(1, R.total);
    const camps = result.camps.filter(c => !c.overseer), you = result.you != null ? result.camps[result.you] : null;
    const cnt = f => E.filter(f).length;
    const tiles = [
      ['戦いの日数', R.total, '日'],
      ['戦闘', cnt(e => e.kind === 'battle' && e.head), '回'],
      ['宝具の解放', cnt(e => e.kind === 'np'), '回'],
      ['令呪', cnt(e => e.kind === 'cs'), '画'],
      ['消えた英霊', camps.filter(c => !c.alive).length, '騎'],
    ];
    // ---- 転機（古い順） ----
    const turns = [];
    const put = (e, tag, text, cls) => { if (e && !turns.some(t => t.e === e)) turns.push({ e, a: R.abs.get(e) || 0, tag, text: text || e.text, cls: cls || '' }); };
    put(R.deaths[0], '最初の脱落');
    const perDay = {}; for (const e of R.deaths) { const a = R.abs.get(e); (perDay[a] = perDay[a] || []).push(e); }
    const worst = Object.keys(perDay).map(Number).sort((a, b) => perDay[b].length - perDay[a].length || a - b)[0];
    if (worst != null && perDay[worst].length >= 2) put(perDay[worst][perDay[worst].length - 1], '最も多くが斃れた日', `${R.dayJa(worst)}のうちに、${perDay[worst].length}騎の英霊が消えた。`, 'bad');
    if (you) {
      put(E.find(e => e.kind === 'cs' && e.you), 'あなたの令呪', '', 'you');
      // 霊基が最も削られた日（消滅した日は別に出るので、生きて越えた日だけ）
      let low = null;
      for (const e of E) { if (!e.snap || !e.day) continue; const me = e.snap.find(c => c.you); if (me && me.alive && me.hp > 0 && (!low || me.hp < low.hp)) low = { e, hp: me.hp }; }
      if (low && low.hp <= 40) put(low.e, 'あなたの最大の危機', `${R.dayJa(R.abs.get(low.e))}、あなたのサーヴァントの霊基は ${low.hp} まで削られた。`, 'you');
      put(E.find(e => e.kind === 'death' && e.you && e.snap && e.snap.some(c => c.you && !c.alive && e.ids[0] === c.id)), 'あなたのサーヴァントの消滅', '', 'bad');
    }
    if (R.deaths.length > 1) put(R.deaths[R.deaths.length - 1], result.winner != null || result.winners ? '決着' : '最後の脱落', '', 'end');
    turns.sort((a, b) => a.a - b.a || E.indexOf(a.e) - E.indexOf(b.e));
    // ---- 目立った陣営 ----
    const who = c => `${c.label}「${c.trueName}」`;
    const top = (f, min) => { const m = Math.max(...camps.map(f)); return m >= min ? { m, list: camps.filter(c => f(c) === m) } : null; };
    const names = t => t.list.slice(0, 3).map(who).join('、') + (t.list.length > 3 ? ' ほか' : '');
    const recs = [];
    const tk = top(c => c.kills.length, 1); if (tk) recs.push(['最も多く倒した', `${names(tk)}（${tk.m}騎）`]);
    const tb = top(c => c.battles, 1); if (tb) recs.push(['最も多く戦った', `${names(tb)}（${tb.m}戦）`]);
    const tn = top(c => c.npUses, 1); if (tn) recs.push(['宝具を最も放った', `${names(tn)}（${tn.m}回）`]);
    const still = camps.filter(c => c.alive && c.battles === 0);
    if (still.length) recs.push(['一度も戦わずに残った', still.slice(0, 3).map(who).join('、')]);
    if (you) recs.push(['あなたの陣営', `${you.battles}戦・宝具${you.npUses}回${you.kills.length ? `・倒した相手：${you.kills.join('、')}` : '・倒した相手はなし'}`]);
    // ---- 戦況の推移（残っている英霊の数の階段と、あなたの霊基の線） ----
    const narrow = matchMedia('(max-width: 820px)').matches;
    const W = narrow ? 360 : 600, Hh = narrow ? 170 : 180, L = 28, Rm = you ? 30 : 10, T = 12, Bm = 24, iw = W - L - Rm, ih = Hh - T - Bm;
    const max = Math.max(1, ...R.days.filter(Boolean).map(d => d.alive));
    const x = d => L + d / n * iw, yA = v => T + (1 - v / max) * ih, yH = v => T + (1 - v / 100) * ih;
    const gStep = max > 8 ? Math.ceil(max / 4) : max > 4 ? 2 : 1;
    let grid = ''; for (let v = 0; v <= max; v += gStep) grid += `<line x1="${L}" x2="${W - Rm}" y1="${yA(v)}" y2="${yA(v)}" stroke="rgba(141,174,212,.18)" stroke-width="1"/><text x="${L - 6}" y="${yA(v) + 4}" text-anchor="end" fill="var(--mute)" font-size="10">${v}</text>`;
    const step = n > 40 ? 10 : n > 20 ? 5 : n > 10 ? 2 : 1;
    let xt = ''; for (let d = 0; d <= n; d += step) xt += `<text x="${x(d)}" y="${Hh - 6}" text-anchor="middle" fill="var(--mute)" font-size="10">${d === 0 ? '開戦' : d}</text>`;
    let pa = '', ph = '', seg = false;
    for (let d = 0; d <= R.total; d++) {
      const v = R.days[d]; if (!v) continue;
      pa += pa ? `H${x(d).toFixed(1)}V${yA(v.alive).toFixed(1)}` : `M${x(d).toFixed(1)},${yA(v.alive).toFixed(1)}`;
      if (v.hp != null) { ph += `${seg ? 'L' : 'M'}${x(d).toFixed(1)},${yH(v.hp).toFixed(1)}`; seg = true; }
    }
    const marks = R.deaths.map(e => { const a = R.abs.get(e), v = R.days[a]; return v ? `<circle cx="${x(a).toFixed(1)}" cy="${yA(v.alive).toFixed(1)}" r="3" fill="var(--seal)" stroke="var(--void)" stroke-width="1"/>` : ''; }).join('');
    const shift = R.shiftAbs != null ? `<line x1="${x(R.shiftAbs)}" x2="${x(R.shiftAbs)}" y1="${T}" y2="${T + ih}" stroke="var(--gold)" stroke-width="1" stroke-dasharray="3 3"/><text x="${x(R.shiftAbs) + 4}" y="${T + 10}" fill="var(--gold)" font-size="10">聖杯戦争へ</text>` : '';
    const hpAxis = ph ? [0, 50, 100].map(v => `<text x="${W - Rm + 6}" y="${yH(v) + 4}" fill="var(--gold)" font-size="10">${v}</text>`).join('') : '';
    const first = R.days.find(Boolean) || { alive: 0 }, lastD = R.days[R.total] || first;
    const chart = `<div class="revbox"><svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="戦況の推移。開戦時は${first.alive}騎、結末では${lastD.alive}騎が残った">
        ${grid}${xt}${hpAxis}${shift}
        ${ph ? `<path d="${ph}" fill="none" stroke="var(--gold)" stroke-opacity=".8" stroke-width="1.5" stroke-linejoin="round"/>` : ''}
        <path d="${pa}" fill="none" stroke="var(--cyan)" stroke-width="2"/>${marks}
      </svg></div>
      <p class="revkey"><span class="k-a">残っている英霊の数</span><span class="k-d">英霊の消滅</span>${ph ? '<span class="k-h">あなたのサーヴァントの霊基（右の目盛り）</span>' : ''}</p>`;
    return `<div class="rev" aria-label="戦後の振り返り">
      <h5>戦後の振り返り</h5>
      <ul class="revtiles">${tiles.map(([l, v, u]) => `<li><span>${l}</span><b>${v}</b><i>${u}</i></li>`).join('')}</ul>
      <h6>戦況の推移</h6>${chart}
      ${turns.length ? `<h6>転機</h6><ol class="revturn">${turns.map(t => `<li class="${t.cls}"><b>${esc(R.dayJa(t.a))}</b><span><em>${esc(t.tag)}</em>${esc(t.text)}</span></li>`).join('')}</ol>` : ''}
      ${recs.length ? `<h6>目立った陣営</h6><dl class="revrec">${recs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
    </div>`;
  }
  // 結末の画面に出す振り返り（ハイライトを古い順に）
  function hlTimeline() {
    const list = shownEntries().filter(e => hlCheck(e));
    if (!list.length) return '';
    return `<details class="hl"><summary><h5 style="display:inline">主な出来事を順に読む（${list.length}件）</h5></summary><ol>${list.map(e =>
      `<li class="k-${e.kind}${e.you ? ' is-you' : ''}"><b>${e.day ? 'D' + String(e.day).padStart(2, '0') + ' ' + (PH[e.phase] || '') : '開戦'}</b><span>${esc(e.text)}</span></li>`).join('')}</ol></details>`;
  }
  // ---------- 画像にする（結末のまとめ・呼んだサーヴァントの評価） ----------
  // canvas に描いて PNG にする。サーバーは使わない。共有できる端末では「共有する」も出す
  const CV = { W: 1200, P: 64 };
  const CF = { en: '"Rajdhani", "Zen Kaku Gothic New", sans-serif', go: '"Zen Kaku Gothic New", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif', mi: '"Shippori Mincho", "Hiragino Mincho ProN", "Yu Mincho", serif' };
  const CC = { void: '#050d22', ice: '#e8f7ff', mute: '#8daed4', cyan: '#3ee6ff', cyan2: '#8ff4ff', gold: '#ffd84a', seal: '#ff4f72', bond: '#ff8fc8', ink: '#04152e', line: 'rgba(80, 196, 255, .30)' };
  // Webフォントを使う文字だけ読み込んでから描く（つながらないときは端末の字体で描く）
  async function cardFonts(text) {
    if (!document.fonts || !document.fonts.load) return;
    const t = String(text).slice(0, 6000) + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789%／・';
    const faces = ['700 40px "Zen Kaku Gothic New"', '500 40px "Zen Kaku Gothic New"', '500 40px "Shippori Mincho"', '700 40px "Shippori Mincho"', '700 40px "Rajdhani"', '600 40px "Rajdhani"'];
    try { await Promise.race([Promise.all(faces.map(f => document.fonts.load(f, t))), new Promise(r => setTimeout(r, 5000))]); } catch (e) { /* 端末の字体で描く */ }
  }
  const setFont = (ctx, w, size, fam) => { ctx.font = `${w} ${size}px ${fam}`; };
  const spacing = (ctx, px) => { if ('letterSpacing' in ctx) ctx.letterSpacing = px + 'px'; };
  // 1文字ずつ折り返す（句読点や閉じ括弧は行頭に来ないよう、前の行にぶら下げる）
  function wrapText(ctx, text, maxW) {
    const lines = []; let cur = '';
    for (const ch of String(text || '')) {
      if (ch === '\n') { lines.push(cur); cur = ''; continue; }
      const t = cur + ch;
      if (cur && ctx.measureText(t).width > maxW) {
        if (/[、。，．・：；？！」』）〕】…ー]/.test(ch)) { lines.push(t); cur = ''; } else { lines.push(cur); cur = ch; }
      } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  }
  function para(ctx, text, x, y, maxW, lh, maxLines) {
    let lines = wrapText(ctx, text, maxW);
    if (maxLines && lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…'; }
    for (const l of lines) { ctx.fillText(l, x, y + lh * 0.78); y += lh; }
    return y;
  }
  function cardBg(ctx, W, H) {
    ctx.fillStyle = CC.void; ctx.fillRect(0, 0, W, H);
    let g = ctx.createRadialGradient(W * 0.8, -H * 0.1, 0, W * 0.8, -H * 0.1, Math.max(W, H) * 0.75);
    g.addColorStop(0, '#15367a'); g.addColorStop(1, 'rgba(21, 54, 122, 0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    g = ctx.createRadialGradient(-W * 0.05, H * 1.05, 0, -W * 0.05, H * 1.05, Math.max(W, H) * 0.65);
    g.addColorStop(0, '#0d2a62'); g.addColorStop(1, 'rgba(13, 42, 98, 0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(62, 230, 255, .05)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = 0.5; x < W; x += 48) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = 0.5; y < H; y += 48) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    ctx.strokeStyle = CC.line; ctx.strokeRect(24.5, 24.5, W - 49, H - 49);
    ctx.strokeStyle = CC.cyan; ctx.lineWidth = 3; ctx.shadowColor = 'rgba(62, 230, 255, .6)'; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.moveTo(24, 58); ctx.lineTo(24, 24); ctx.lineTo(58, 24); ctx.moveTo(W - 24, H - 58); ctx.lineTo(W - 24, H - 24); ctx.lineTo(W - 58, H - 24); ctx.stroke();
    ctx.shadowBlur = 0;
  }
  // 見出し（英字の帯・金の山形・題）。戻り値は次に描く位置
  // 見出し（英字の帯・金の山形・題）。top は帯の上端（つなげた画像の2枚目では途中から描く）。戻り値は次に描く位置
  function cardHead(ctx, en, right, title, top) {
    const { W, P } = CV, T = top == null ? P : top;
    setFont(ctx, 700, 22, CF.en); spacing(ctx, 4); ctx.fillStyle = CC.cyan; ctx.textAlign = 'left';
    ctx.shadowColor = 'rgba(62, 230, 255, .55)'; ctx.shadowBlur = 10; ctx.fillText(en, P, T + 20); ctx.shadowBlur = 0;
    spacing(ctx, 0); setFont(ctx, 500, 20, CF.go); ctx.fillStyle = CC.mute; ctx.textAlign = 'right'; ctx.fillText(right, W - P, T + 20); ctx.textAlign = 'left';
    // 金の山形
    const cx = P, cy = T + 48;
    ctx.fillStyle = CC.gold; ctx.beginPath();
    for (const ox of [0, 14]) { ctx.moveTo(cx + ox, cy); ctx.lineTo(cx + ox + 9, cy); ctx.lineTo(cx + ox + 20, cy + 14); ctx.lineTo(cx + ox + 9, cy + 28); ctx.lineTo(cx + ox, cy + 28); ctx.lineTo(cx + ox + 11, cy + 14); ctx.closePath(); }
    ctx.fill();
    setFont(ctx, 700, 40, CF.go); spacing(ctx, 6); ctx.fillStyle = CC.ice; ctx.fillText(title, P + 46, cy + 28); spacing(ctx, 0);
    const y = cy + 52;
    ctx.strokeStyle = CC.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(P, y + 0.5); ctx.lineTo(W - P, y + 0.5); ctx.stroke();
    return y + 28;
  }
  // つなげた画像の区切り（シアンの二重線と、中央の菱形）
  function cardDivider(ctx, y) {
    const { W, P } = CV;
    ctx.strokeStyle = 'rgba(62, 230, 255, .55)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(P, y); ctx.lineTo(W - P, y); ctx.stroke();
    ctx.strokeStyle = CC.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(P, y + 6.5); ctx.lineTo(W - P, y + 6.5); ctx.stroke();
    ctx.fillStyle = CC.gold; ctx.save(); ctx.translate(W / 2, y + 3); ctx.rotate(Math.PI / 4); ctx.fillRect(-7, -7, 14, 14); ctx.restore();
    return y + 34;
  }
  function cardFoot(ctx, y, left) {
    const { W, P } = CV;
    ctx.strokeStyle = CC.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(P, y + 0.5); ctx.lineTo(W - P, y + 0.5); ctx.stroke();
    setFont(ctx, 600, 18, CF.en); spacing(ctx, 3); ctx.fillStyle = CC.mute; ctx.textAlign = 'left'; ctx.fillText(left, P, y + 34);
    spacing(ctx, 0); setFont(ctx, 500, 18, CF.go); ctx.textAlign = 'right';
    ctx.fillText(TITLE + (/^https?:$/.test(location.protocol) ? ' ・ ' + location.host + location.pathname.replace(/index\.html$/, '') : ''), W - P, y + 34);
    ctx.textAlign = 'left';
    return y + 56;
  }
  // 引用の帯（左に色の線）
  function quoteBlock(ctx, y, who, text, color) {
    const { W, P } = CV, x = P + 22, w = W - P * 2 - 22;
    setFont(ctx, 500, 26, CF.mi);
    const lines = Math.min(4, wrapText(ctx, '「' + text + '」', w).length);
    const h = 30 + lines * 40 + 14;
    const g = ctx.createLinearGradient(P, 0, W - P, 0); g.addColorStop(0, color === CC.bond ? 'rgba(255, 143, 200, .14)' : 'rgba(62, 230, 255, .14)'); g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g; ctx.fillRect(P, y, W - P * 2, h);
    ctx.fillStyle = color; ctx.fillRect(P, y, 4, h);
    setFont(ctx, 500, 19, CF.go); ctx.fillStyle = CC.mute; ctx.fillText(who, x, y + 26);
    setFont(ctx, 500, 26, CF.mi); ctx.fillStyle = color;
    para(ctx, '「' + text + '」', x, y + 34, w, 40, 4);
    return y + h + 14;
  }
  const GRADE_BG = { S: [CC.gold, '#fff3c4'], A: [CC.cyan, CC.cyan2], B: [CC.cyan, CC.cyan2], C: ['#9fb7d8', '#dfe9f7'], D: ['#b9a6d9', '#e9e0f8'], E: [CC.seal, '#ff9db1'] };
  function bar(ctx, x, y, w, h, ratio, color) {
    ctx.fillStyle = 'rgba(3, 14, 38, .85)'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = CC.line; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 8; ctx.fillRect(x, y, Math.max(3, Math.min(1, ratio) * w), h); ctx.shadowBlur = 0;
  }

  // 結末のまとめ（o.foot === false なら下の帯を描かずに、次に描く位置を返す）
  function drawResultCard(ctx, o) {
    o = o || {};
    const { W, P } = CV;
    const w = result.winner != null ? result.camps[result.winner] : null, you = result.you != null ? result.camps[result.you] : null;
    let y = cardHead(ctx, 'HOLY GRAIL WAR ／ RESULT', `${out.city} ・ ${result.days}日間`, TITLE);
    setFont(ctx, 700, 34, CF.go); ctx.fillStyle = CC.gold; ctx.shadowColor = 'rgba(255, 216, 74, .35)'; ctx.shadowBlur = 12;
    y = para(ctx, endHead(result), P, y, W - P * 2, 48) + 6;
    ctx.shadowBlur = 0;
    const decided = choices.filter(k => k !== 'auto' && k !== 'shift' && k !== 'end').length;
    // 呼んだサーヴァント（再契約や令呪を奪って陣営が移っていれば、最後に契約していたサーヴァントも）
    const first = youId != null ? result.camps[youId] : null, moved = you && first && first.id !== you.id;
    const tail = you ? (result.youTaken ? (you.id === result.winner ? 'は勝ち残り、聖杯を手にした。' : `は、${you.fate ? you.fate.text : '最後まで生き残った'}。`) : you.id === result.winner ? '最後まで勝ち残った。' : `${moved ? `${you.label}「${you.trueName}」` : ''}は、${you.fate ? you.fate.text : '最後まで生き残った'}。`) : '';
    const yours = you && result.youTaken ? `マスター${result.youTaken.master}は命を落としたが、再契約した${you.label}「${you.trueName}」${tail}${decided ? `下した大きな決断は${decided}回。` : ''}`
      : you ? `マスター${you.master}が${moved ? `呼んだ${first.label}「${first.trueName}」を失い、のちに${you.label}「${you.trueName}」と契約した。${tail}` : `呼んだ${you.label}「${you.trueName}」${you.id === result.winner ? 'が、' : ''}${tail}`}${decided ? `下した大きな決断は${decided}回。` : ''}`
      : 'すべてを知る観測者として、' + N_JA + '騎の戦いを見届けた。';
    setFont(ctx, 500, 26, CF.mi); ctx.fillStyle = CC.ice;
    y = para(ctx, yours, P, y, W - P * 2, 42) + 14;
    const pts = youId != null ? bondSeries() : [];
    if (pts.length > 1) {
      const peak = pts.reduce((a, b) => (b.bond > a.bond ? b : a));
      setFont(ctx, 500, 21, CF.go); ctx.fillStyle = CC.mute;
      ctx.fillText(`絆　開戦時 ${pts[0].bond} → 最も深まったとき ${peak.bond} → 結末 ${pts[pts.length - 1].bond}`, P, y + 20); y += 40;
    }
    const q = finalQuote(), lw = words.length ? words[words.length - 1] : null;
    if (q) y = quoteBlock(ctx, y, `最後に、${q.who}から一言`, q.text, CC.cyan2);
    if (lw) y = quoteBlock(ctx, y, `あなたの一言（${lw.q || ''}）`, lw.text, CC.bond);
    y += 6;
    // 七陣営の表
    const cols = [P, P + 200, P + 520, P + 790], widths = [180, 300, 250, W - P - (P + 790)];
    setFont(ctx, 600, 18, CF.en); spacing(ctx, 3); ctx.fillStyle = CC.mute;
    ['CLASS', '真名', 'MASTER', '結末'].forEach((t, i) => ctx.fillText(t, cols[i], y + 18)); spacing(ctx, 0);
    y += 30;
    for (const c of result.camps) {
      const won = isWin(c.id), mine = !!(lastSnap[c.id] && lastSnap[c.id].you) || c.id === youId;
      const fate = won ? winText() : c.fate ? c.fate.text : '';
      setFont(ctx, 500, 22, CF.go);
      const icon = cardIcons.get(String(c.servantId || '').split(':')[0]), iw = icon ? 34 : 0;
      const cells = [c.label, c.trueName, c.master, fate].map((t, i) => { const max = i === 3 ? 4 : 2, l = wrapText(ctx, t, widths[i] - (i ? 0 : iw)); if (l.length > max) { l.length = max; l[max - 1] = l[max - 1].slice(0, -1) + '…'; } return l; });
      const h = Math.max(...cells.map(l => l.length)) * 31 + 16;
      if (mine) { ctx.fillStyle = 'rgba(62, 230, 255, .12)'; ctx.fillRect(P - 12, y, W - P * 2 + 24, h); ctx.fillStyle = CC.cyan; ctx.fillRect(P - 12, y, 4, h); }
      ctx.strokeStyle = 'rgba(80, 196, 255, .16)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(P, y + h + 0.5); ctx.lineTo(W - P, y + h + 0.5); ctx.stroke();
      cells.forEach((lines, i) => {
        ctx.fillStyle = won && i < 2 ? CC.gold : i === 3 ? (won ? CC.gold : c.alive ? CC.cyan2 : CC.seal) : i === 2 ? CC.mute : mine && i === 1 ? CC.cyan2 : CC.ice;
        setFont(ctx, i === 1 ? 700 : 500, i === 3 ? 20 : 22, CF.go);
        lines.forEach((l, j) => ctx.fillText(l, cols[i] + (i ? 0 : iw), y + 30 + j * 31));
      });
      if (icon) ctx.drawImage(icon, cols[0], y + 9, 26, 26);
      y += h;
    }
    return o.foot === false ? y + 24 : cardFoot(ctx, y + 24, `SEED ${seed}`);
  }
  // 呼んだサーヴァントの評価（開戦の案内の2枚目と同じ内容と、生存曲線）。o.top を渡すと、その位置から続けて描く
  function drawServantCard(ctx, o) {
    o = o || {};
    const { W, P } = CV;
    const id = youId, meta = metaOf(id), m = meta.master || {};
    const sv = servantOf(id), ev = sv ? evaluate(sv) : null;
    const label = (out.camps[id] || {}).label || (sv ? sv.class.label : '');
    let y = cardHead(ctx, 'SERVANT APPRAISAL', o.top != null ? '開戦時の評価' : `${out.city} ・ SEED ${seed}`, '呼んだサーヴァント', o.top);
    const icon = cardIcons.get(keyOf(id)), iw = icon ? 70 : 0;
    if (icon) ctx.drawImage(icon, P, y + 4, 56, 56);
    setFont(ctx, 700, 46, CF.go); ctx.fillStyle = CC.ice; y = para(ctx, `${label}「${meta.trueName}」`, P + iw, y, W - P * 2 - iw, 60);
    setFont(ctx, 500, 22, CF.go); ctx.fillStyle = CC.mute; y = para(ctx, `マスター ${m.name || ''}${m.originLabel ? '・' + m.originLabel : ''}`, P, y + 2, W - P * 2, 34) + 18;
    if (ev) {
      // 評価の印
      const gs = 168, [g1, g2] = GRADE_BG[ev.grade] || GRADE_BG.B, gx = P, gy = y;
      const gr = ctx.createLinearGradient(gx, gy, gx + gs, gy + gs); gr.addColorStop(0, g1); gr.addColorStop(1, g2);
      ctx.fillStyle = gr; ctx.shadowColor = g1; ctx.shadowBlur = 22;
      ctx.beginPath(); ctx.moveTo(gx + 24, gy); ctx.lineTo(gx + gs, gy); ctx.lineTo(gx + gs, gy + gs - 24); ctx.lineTo(gx + gs - 24, gy + gs); ctx.lineTo(gx, gy + gs); ctx.lineTo(gx, gy + 24); ctx.closePath(); ctx.fill(); ctx.shadowBlur = 0;
      setFont(ctx, 700, 128, CF.en); ctx.fillStyle = CC.ink; ctx.textAlign = 'center'; ctx.fillText(ev.grade, gx + gs / 2, gy + gs / 2 + 46); ctx.textAlign = 'left';
      const rx = P + gs + 32, rw = W - P - rx;
      setFont(ctx, 700, 30, CF.go); ctx.fillStyle = CC.ice;
      let ry = para(ctx, GRADE[ev.grade], rx, gy + 6, rw, 44, 3) + 8;
      setFont(ctx, 500, 20, CF.go); ctx.fillStyle = CC.mute;
      ry = para(ctx, `リストの${ev.n}騎と1対1で戦った場合の平均勝率 ${Math.round(ev.rate * 100)}%（${ev.rank}位）`, rx, ry, rw, 30);
      y = Math.max(gy + gs, ry) + 28;
      // 三つの目安
      const rows = [['平均勝率', ev.rate, 1, Math.round(ev.rate * 100) + '%', ev.rank], ['基礎戦闘力', ev.power, ev.maxPower, String(ev.power), ev.powerRank], ['宝具の威力', ev.npPeak, ev.maxNp, ev.npPeak ? String(ev.npPeak) : '—', ev.npPeak ? ev.npRank : 0]];
      for (const [k, v, max, lab, rank] of rows) {
        setFont(ctx, 500, 22, CF.go); ctx.fillStyle = CC.ice; ctx.fillText(k, P, y + 22);
        bar(ctx, P + 170, y + 6, W - P * 2 - 170 - 200, 16, v / (max || 1), CC.cyan);
        setFont(ctx, 700, 26, CF.en); ctx.textAlign = 'right'; ctx.fillStyle = CC.ice; ctx.fillText(lab, W - P - 70, y + 24);
        if (rank) { setFont(ctx, 500, 18, CF.go); ctx.fillStyle = CC.mute; ctx.fillText(rank + '位', W - P, y + 24); }
        ctx.textAlign = 'left'; y += 42;
      }
      y += 10;
    }
    // ステータス（この戦争で確定したランク）
    const cw = (W - P * 2 - 16) / 3;
    meta.ranks.forEach(([k, v], i) => {
      const x = P + (i % 3) * (cw + 8), yy = y + Math.floor(i / 3) * 62;
      ctx.fillStyle = 'rgba(3, 14, 38, .8)'; ctx.fillRect(x, yy, cw, 54); ctx.strokeStyle = CC.line; ctx.strokeRect(x + 0.5, yy + 0.5, cw - 1, 53);
      setFont(ctx, 500, 22, CF.go); ctx.fillStyle = CC.ice; ctx.fillText(k, x + 18, yy + 35);
      setFont(ctx, 700, 34, CF.en); ctx.fillStyle = CC.cyan; ctx.textAlign = 'right'; ctx.shadowColor = 'rgba(62, 230, 255, .5)'; ctx.shadowBlur = 8; ctx.fillText(v, x + cw - 18, yy + 39); ctx.shadowBlur = 0; ctx.textAlign = 'left';
    });
    y += Math.ceil(meta.ranks.length / 3) * 62 + 16;
    if (ev) {
      setFont(ctx, 500, 23, CF.go);
      for (const [t, col] of ev.good.map(t => [t, CC.cyan]).concat(ev.bad.map(t => [t, CC.seal]))) {
        ctx.fillStyle = col; ctx.fillText('◆', P, y + 26); ctx.fillStyle = CC.ice; y = para(ctx, t, P + 34, y, W - P * 2 - 34, 36);
      }
      y += 8;
    }
    // 生存曲線（集計がもう手元にあるときだけ）
    const st = survReady();
    const t = st && st.wars >= 100 && sv && st.servants[sv.id];
    if (t && t.n >= 10) {
      const s = H.survival.curveOf(t, st.days), avg = H.survival.curveOf(H.survival.overall(st), st.days), md = H.survival.median(s);
      setFont(ctx, 700, 22, CF.go); ctx.fillStyle = CC.cyan; ctx.fillText('生存曲線', P, y + 26);
      setFont(ctx, 500, 20, CF.go); ctx.fillStyle = CC.mute;
      ctx.fillText(`${md ? '半数が脱落するのは' + md + '日目' : st.days + '日目まで半数以上が残る'} ・ ${st.days}日目まで残る ${Math.round(s[st.days] * 100)}% ・ 聖杯を手にする ${Math.round(t.w / t.n * 100)}%`, P + 120, y + 26);
      y += 62;
      const ch = 150, x0 = P + 64, x1 = W - P, X = d => x0 + d / st.days * (x1 - x0), Y = v => y + (1 - v) * ch;
      ctx.strokeStyle = 'rgba(141, 174, 212, .18)'; ctx.lineWidth = 1; ctx.beginPath();
      for (const v of [0, 0.5, 1]) { ctx.moveTo(x0, Y(v) + 0.5); ctx.lineTo(x1, Y(v) + 0.5); } ctx.stroke();
      const path = arr => { ctx.beginPath(); arr.forEach((v, d) => (d ? ctx.lineTo(X(d), Y(v)) : ctx.moveTo(X(d), Y(v)))); };
      ctx.setLineDash([8, 7]); ctx.strokeStyle = CC.mute; ctx.lineWidth = 2; path(avg); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = CC.cyan; ctx.lineWidth = 4; ctx.shadowColor = CC.cyan; ctx.shadowBlur = 8; path(s); ctx.stroke(); ctx.shadowBlur = 0;
      setFont(ctx, 500, 16, CF.go); ctx.fillStyle = CC.mute; ctx.textAlign = 'right';
      ctx.fillText('100%', x0 - 12, Y(1) + 6); ctx.fillText('50%', x0 - 12, Y(0.5) + 6); ctx.fillText('0%', x0 - 12, Y(0) + 6);
      ctx.fillText(`${st.days}日目`, x1, Y(0) + 24); ctx.fillText('点線：リスト全体の平均', x1, Y(1) - 10); ctx.textAlign = 'left';
      ctx.fillText('開戦', x0, Y(0) + 24);
      y += ch + 34;
    }
    return cardFoot(ctx, y + 10, `SEED ${seed}`);
  }
  // 画像は3パターン（結末のまとめ・サーヴァントの評価・両方をつなげた一枚）。戦争が終わってから作れる
  const CARD_KINDS = {
    result: { title: '結末のまとめ', desc: '勝者・あなたの歩み・最後の一言・' + N_JA + '陣営の結末', file: '結末' },
    servant: { title: 'サーヴァントの評価', desc: '呼んだ英霊の開戦時の評価と、生存曲線', file: '評価' },
    both: { title: '両方をつなげた一枚', desc: '結末のまとめの下に、サーヴァントの評価をつなげる', file: '結末と評価' },
  };
  // 描いた内容の高さに合わせて、背景つきの画像にする
  async function makeCard(kind) {
    const draft = document.createElement('canvas'); draft.width = CV.W; draft.height = 4400;
    const dctx = draft.getContext('2d'); dctx.textBaseline = 'alphabetic';
    let h;
    if (kind === 'result') h = drawResultCard(dctx);
    else if (kind === 'servant') h = drawServantCard(dctx);
    else { const y = cardDivider(dctx, drawResultCard(dctx, { foot: false }) + 6); h = drawServantCard(dctx, { top: y }); }
    const cv = document.createElement('canvas'); cv.width = CV.W; cv.height = Math.min(draft.height, Math.ceil(h) + 30);
    const ctx = cv.getContext('2d'); cardBg(ctx, cv.width, cv.height); ctx.drawImage(draft, 0, 0);
    const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
    if (!blob) throw new Error('PNGにできませんでした');
    return { kind, blob, url: URL.createObjectURL(blob), name: `${WAR}_${CARD_KINDS[kind].file}_${out.city}_${seed}.png`, title: CARD_KINDS[kind].title };
  }
  let cards = {}, imgCur = null;
  // 画像に描くクラスのアイコン（読み込めなければ描かない）
  const cardIcons = new Map();
  async function loadCardIcons() {
    const keys = new Set(result.camps.map(c => String(c.servantId || '').split(':')[0]).filter(Boolean));
    await Promise.all([...keys].map(async k => {
      if (cardIcons.has(k)) return;
      const im = new Image(); im.src = H.classIcon(k);
      try { await im.decode(); cardIcons.set(k, im); } catch (e) { /* アイコンなしで描く */ }
    }));
  }
  // 「画像にする」：作れるものをまとめて作り、小さな見本から選んでもらう（観測者は結末のまとめだけ）
  async function openImages() {
    if (!out || !result) return;
    const kinds = youId != null ? ['result', 'servant', 'both'] : ['result'];
    $('#imgTitle').textContent = '画像にする'; $('#imgSub').textContent = 'PNG';
    $('#imgPick').innerHTML = '<p class="note2">画像を作っています…</p>'; showImgPick(true);
    $('#imgDlg').classList.add('on');
    await survQuick(); await loadCardIcons();
    const sv = youId != null ? servantOf(youId) : null, ev = sv ? evaluate(sv) : null;
    await cardFonts(JSON.stringify(out.meta) + JSON.stringify(result.camps) + words.map(w => w.text).join('') + (finalQuote() || { text: '' }).text
      + (ev ? ev.good.join('') + ev.bad.join('') : '') + Object.values(GRADE).join('')
      + TITLE + '呼んだサーヴァント開戦時の評価リスト騎と1対1で戦った場合の平均勝率位基礎戦闘力宝具の威力生存曲線半数が脱落するのは日目まで残る聖杯を手にする点線全体の平均最後に、から一言あなたの一言絆開戦時最も深まったとき結末として' + N_JA + '騎の戦いを見届けたすべてを知る観測者下した大きな決断は回のちにと契約した失い');
    for (const c of Object.values(cards)) URL.revokeObjectURL(c.url);
    cards = {};
    try { for (const k of kinds) cards[k] = await makeCard(k); }
    catch (e) { $('#imgPick').innerHTML = `<p class="note2">画像を作れませんでした：${esc(e.message)}</p>`; return; }
    if (!$('#imgDlg').classList.contains('on')) return;
    if (kinds.length === 1) return showCard('result', true);
    $('#imgPick').innerHTML = `<div class="imgpick"><p class="lead4">どの画像にするか選んでください。</p>${kinds.map(k =>
      `<button class="imgopt" data-card="${k}"><img src="${cards[k].url}" alt=""><b>${esc(CARD_KINDS[k].title)}</b><small>${esc(CARD_KINDS[k].desc)}</small></button>`).join('')}</div>`;
    const first = $('#imgPick .imgopt'); if (first) first.focus({ preventScroll: true });
  }
  function showImgPick(on) {
    $('#imgPick').hidden = !on; $('#imgView').hidden = on;
    $('#imgSave').hidden = on; $('#imgShare').hidden = true; $('#imgBack').hidden = true;
  }
  function showCard(kind, only) {
    const c = cards[kind]; if (!c) return;
    imgCur = c; showImgPick(false);
    $('#imgPrev').src = c.url; $('#imgPrev').alt = c.title; $('#imgTitle').textContent = c.title;
    let can = false;
    try { can = !!(navigator.canShare && navigator.canShare({ files: [new File([c.blob], c.name, { type: 'image/png' })] })); } catch (e) { can = false; }
    $('#imgShare').hidden = !can; $('#imgBack').hidden = !!only;
    $('#imgDlg .dlg-in').scrollTop = 0;
    $('#imgSave').focus({ preventScroll: true });
  }
  $('#imgPick').addEventListener('click', e => { const b = e.target.closest('[data-card]'); if (b) showCard(b.dataset.card); });
  $('#imgBack').onclick = () => { $('#imgTitle').textContent = '画像にする'; showImgPick(true); const b = $('#imgPick .imgopt'); if (b) b.focus({ preventScroll: true }); };
  function closeImg() { $('#imgDlg').classList.remove('on'); }
  $('#imgClose').onclick = closeImg;
  $('#imgDlg').addEventListener('click', e => { if (e.target.id === 'imgDlg') closeImg(); });
  $('#imgSave').onclick = () => {
    if (!imgCur) return;
    const a = document.createElement('a'); a.href = imgCur.url; a.download = imgCur.name;
    document.body.appendChild(a); a.click(); a.remove();
    toast('画像を保存しました');
  };
  $('#imgShare').onclick = async () => {
    if (!imgCur) return;
    try { await navigator.share({ files: [new File([imgCur.blob], imgCur.name, { type: 'image/png' })], title: TITLE }); }
    catch (e) { if (e && e.name !== 'AbortError') toast('共有できませんでした。「保存する」を使ってください'); }
  };

  // ---------- PWA ----------
  // サービスワーカー（sw.js）を登録する。ファイルを直接開いたとき（file://）は使えないので何もしない
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  // 「アプリとして追加」：ブラウザが追加を勧められるとき（Chrome・Edge など）だけボタンを出す。iPhone・iPad は手順を案内
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let installEv = null;
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEv = e; $('#installBox').hidden = false; $('#installBtn').hidden = false; });
  $('#installBtn').onclick = async () => {
    if (!installEv) return;
    installEv.prompt();
    try { await installEv.userChoice; } catch (e) { /* 閉じられた */ }
    installEv = null; $('#installBtn').hidden = true; $('#installBox').hidden = $('#installIos').hidden;
  };
  addEventListener('appinstalled', () => { $('#installBox').hidden = true; toast('ホーム画面に追加しました'); });
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  if (ios && !standalone) { $('#installBox').hidden = false; $('#installIos').hidden = false; }

  // 画面いっぱいの問い（.dlg.on。下ろした決断 .min は除く）が出ている間は、後ろの画面を固定する。
  // iPhone の Safari は overflow: hidden だけでは後ろがスクロールするので、position: fixed で今の位置に留める
  let lockY = null;
  function syncLock() {
    const open = !!document.querySelector('.dlg.on:not(.min)');
    if (open && lockY == null) { lockY = scrollY; document.body.style.top = -lockY + 'px'; document.body.classList.add('locked'); }
    else if (!open && lockY != null) { const y = lockY; lockY = null; document.body.classList.remove('locked'); document.body.style.top = ''; scrollTo(0, y); }
  }
  // いちばん上へ。後ろを固定している間は、固定を解いたときに上へ戻るようにする
  function toTop(smooth) {
    if (lockY != null) { lockY = 0; return; }
    window.scrollTo({ top: 0, behavior: smooth && !reduceMotion ? 'smooth' : 'auto' });
  }
  const lockObs = new MutationObserver(syncLock);
  document.querySelectorAll('.dlg').forEach(d => lockObs.observe(d, { attributes: true, attributeFilter: ['class'] }));
  function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2800); }
})();
