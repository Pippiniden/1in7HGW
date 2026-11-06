// セリフの編集欄（場面ごと）。リストツール（roster.html）と申請フォーム（submit.html）で使う。
// 場面は config.js の VOICE_SLOTS。別名の見出しの行も同じ場面の行として使われる。
//   HGW.voiceEdit.mount(el, voice, { nps })  el の中に編集欄を作る
//   HGW.voiceEdit.read(el)                    → { voice: {見出し: [行]}, bad: [読めない行] }
//   HGW.voiceEdit.toText(voice) / parseText(text)   「見出し：「セリフ」」の形との行き来
// 画面の色は、使うページの :root の --rule --sub --ok --neg --warn-ink --accent --accent-ink を使う。
(function (G) {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CSS = `
.ve .vmode { display: flex; gap: 6px; margin-bottom: 8px; }
.ve .vmode button.on { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.ve .vcov { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 10px; }
.ve .vcov button { font-size: 12px; padding: 2px 8px; border-radius: 99px; }
.ve .vcov button.has { border-color: var(--ok); color: var(--ok); }
.ve .vcov button.none { border-style: dashed; color: var(--sub); }
.ve .vsec { font-size: 13px; margin: 14px 0 6px; }
.ve .vcard { border: 1px solid var(--rule); border-radius: 8px; padding: 8px; margin-bottom: 8px; min-width: 0; }
.ve .vcard.none { border-style: dashed; }
.ve .vcard.vflash { animation: veflash 1.2s; }
@keyframes veflash { from { box-shadow: 0 0 0 3px var(--accent); } to { box-shadow: none; } }
.ve .vh { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
.ve .vh b { font-size: 14px; }
.ve .vh .n { font-size: 12px; color: var(--sub); }
.ve .vh input { width: 9em; font-weight: 600; }
.ve .vh .sp { flex: 1; }
.ve .use { font-size: 12px; color: var(--sub); margin: 2px 0 6px; }
.ve .al { font-size: 11px; color: var(--sub); margin: 6px 0 2px; }
.ve .vcard textarea { width: 100%; min-height: 44px; font: inherit; font-size: 13px; line-height: 1.55; }
.ve .vtext textarea { width: 100%; min-height: 300px; }
.ve .npv { font-size: 12px; margin-top: 4px; }
.ve .npv .ng { color: var(--neg); }
.ve .vcard.odd { border-color: var(--warn-ink); }
.ve .vcard.odd .use { color: var(--warn-ink); }
.ve .vfoot { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 4px; }
.ve .vnote { font-size: 12px; color: var(--sub); margin: 0 0 8px; }`;
  let styled = false;
  function addStyle() {
    if (styled || typeof document === 'undefined') return;
    const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); styled = true;
  }

  // ---- テキストの形（Wikiと同じ「見出し：「セリフ」」）----
  function toText(v) { return Object.entries(v || {}).map(([k, ls]) => ls.map(l => `${k}：「${l}」`).join('\n')).join('\n\n'); }
  function parseText(t) {
    const voice = {}, bad = []; let last = null;
    for (const raw of String(t).split('\n')) {
      const l = raw.trim(); if (!l) continue;
      const m = l.match(/^([^：:「」]{1,48})\s*[:：]\s*(.+)$/);
      if (!m) { bad.push(l); continue; }
      let k = m[1].trim(), v = m[2].trim();
      const q = v.match(/^「([\s\S]*)」$/); if (q) v = q[1].trim();
      if (!v) continue;
      if (/^(その)?\d+$/.test(k) && last) k = last; else last = k;
      (voice[k] = voice[k] || []).push(v);
    }
    return { voice, bad };
  }

  const unusedGroup = h => { const g = (G.VOICE_UNUSED || []).find(([, hs]) => hs.includes(h)); return g ? g[0] : null; };
  const lines = t => String(t).split('\n').map(l => l.trim().replace(/^「([\s\S]*)」$/, '$1').trim()).filter(Boolean);
  const field = (h, ls) => `<div class="vf" data-h="${esc(h)}"><textarea rows="${Math.min(8, Math.max(2, ls.length + 1))}" placeholder="1行に1つ">${esc(ls.join('\n'))}</textarea></div>`;
  // 場面に当てはまらない見出しの説明（odd = どの表にも無い見出し）
  function why(h) {
    const sl = G.voiceSlotOf(h), g = unusedGroup(h);
    return !h ? { t: '見出しを入れてください。上の場面の名前（例：会話）にするとゲームで使います' } : sl ? { t: `「${sl}」の場面として使います` }
      : g ? { t: `${g}（Wikiのテンプレートの見出し。ゲームでは使いません）` } : { t: 'どの場面にも当てはまらない見出しです。名前を上の場面（例：会話・霊基再臨）に直すか、前の見出しにまとめてください', odd: true };
  }
  const extra = (h, ls) => `<div class="vcard extra"><div class="vh"><input type="text" data-vh value="${esc(h)}" placeholder="見出し" aria-label="見出し"><span class="n"></span><span class="sp"></span><button type="button" class="sm ghost danger" data-vrm title="この見出しを消す">×</button></div><div class="use"></div>${field(h, ls || [])}</div>`;

  function rows(el, v) {
    v = v || {};
    let html = '<h4 class="vsec">ゲームで使う場面</h4>';
    const nps = (el._veNps || []).filter(n => n && String(n.name || '').trim());
    for (const s of G.VOICE_SLOTS) {
      let present = G.voiceHeadings(v, s.key).filter(h => (v[h] || []).length), extraHtml = '';
      if (s.key === '宝具') {
        // 宝具ごとの欄：専用の見出し（宝具（名前））の行をその宝具の欄に集める。それ以外は共通の欄のまま
        const by = nps.map(() => []), orphan = [], keep = {};
        for (const h of present) {
          if (G.npHeadingName(h) != null) {
            const i = nps.findIndex(n => G.npHeadingMatch(h, n));
            if (i >= 0) by[i].push(...v[h]); else orphan.push(h);
            continue;
          }
          keep[h] = v[h]; // 名前入りの行も動かさない（動かすと、開いて保存しただけで「手直し」になってしまう）。どの宝具に当たるかは下の一覧に出す
        }
        present = Object.keys(keep).filter(h => keep[h].length);
        v = Object.assign({}, v); for (const h of present) v[h] = keep[h];
        extraHtml = nps.map((n, i) => `<div class="al npf">『${esc(n.name)}』専用（セリフに宝具の名前が無くても、この宝具を使ったときだけ使います）</div>` + field(G.npHeading(n), by[i])).join('')
          + orphan.map(h => `<div class="vf orph" data-h="${esc(h)}"><div class="al warn">対応する宝具がありません（宝具の名前を変えた・消した後の行です）。見出しの宝具名を今ある宝具に直すか、行ごと消してください。ゲームでは使いません。</div><div class="vh"><input type="text" data-vhf value="${esc(h)}" aria-label="見出し"><span class="sp"></span><button type="button" class="sm ghost danger" data-vorm title="この見出しを消す">×</button></div><textarea rows="2">${esc(v[h].join('\n'))}</textarea></div>`).join('');
      }
      const fields = (present.length ? present : [s.key]).map(h => (h !== s.key ? `<div class="al">見出し「${esc(h)}」（${esc(s.key)}として使う）</div>` : present.length > 1 || extraHtml ? `<div class="al">${s.key === '宝具' ? '共通（宝具の名前を含む行はその宝具のとき、含まない行はどの宝具のときも使います）' : `見出し「${esc(h)}」`}</div>` : '') + field(h, v[h] || [])).join('');
      html += `<div class="vcard" data-slot="${esc(s.key)}"><div class="vh"><b>${esc(s.key)}</b><span class="n"></span>${s.aliases.length ? `<span class="hint">別名：${esc(s.aliases.join('・'))}</span>` : ''}</div><div class="use">${esc(s.use)}</div>${fields}${extraHtml}${s.key === '宝具' ? '<div class="npv"></div>' : ''}</div>`;
    }
    const rest = Object.keys(v).filter(h => !G.voiceSlotOf(h) && (v[h] || []).length);
    const odd = rest.filter(h => !unusedGroup(h)), unused = rest.filter(h => unusedGroup(h));
    html += `<h4 class="vsec">ゲームでは使わない見出し（${rest.length}）</h4><div class="vextra">${odd.concat(unused).map(h => extra(h, v[h])).join('')}</div>`;
    el.querySelector('.vrows').innerHTML = html;
    update(el);
  }
  function read(el) {
    if (!el.querySelector('.vtext').hidden) return parseText(el.querySelector('.vtext textarea').value);
    const voice = {};
    for (const card of el.querySelectorAll('.vrows .vcard')) {
      const hi = card.querySelector('[data-vh]');
      for (const f of card.querySelectorAll('.vf')) {
        const hf = f.querySelector('[data-vhf]'), h = hi ? hi.value.trim().replace(/[：:]/g, '') : hf ? hf.value.trim().replace(/[：:]/g, '') : f.dataset.h, ls = lines(f.querySelector('textarea').value);
        if (h && ls.length) voice[h] = (voice[h] || []).concat(ls);
      }
    }
    return { voice, bad: [] };
  }
  // 場面ごとの数・宝具ごとに使える行・上の一覧
  function update(el) {
    const r = read(el), v = r.voice, nps = el._veNps || [];
    const tmp = { voice: v, nps };
    const cov = G.VOICE_SLOTS.map(s => ({ s, n: G.voiceLines(tmp, s.key).length }));
    el.querySelector('.vcov').innerHTML = cov.map(({ s, n }) => `<button type="button" class="sm ${n ? 'has' : 'none'}" data-vgo="${esc(s.key)}" title="${esc(s.use)}">${esc(s.key)} ${n || '—'}</button>`).join('');
    for (const card of el.querySelectorAll('.vrows .vcard')) {
      const n = Array.from(card.querySelectorAll('.vf textarea')).reduce((t, x) => t + lines(x.value).length, 0);
      card.querySelector('.n').textContent = n ? n + '行' : 'なし';
      if (card.dataset.slot) card.classList.toggle('none', !n);
      const hi = card.querySelector('[data-vh]');
      if (hi) { const w = why(hi.value.trim()); card.querySelector('.use').textContent = w.t; card.classList.toggle('odd', !!w.odd); }
    }
    const npv = el.querySelector('.npv');
    if (npv) npv.innerHTML = nps.length && G.voiceLines(tmp, '宝具').length ? nps.map(np => {
      const m = G.npVoiceLines(tmp, np);
      return `<div>『${esc(np.name)}』：${m.named ? `専用・名前を含む行 ${m.lines.length}${m.tagged ? `（うち宝具専用の見出し ${m.tagged}）` : ''}` : m.lines.length ? `名前を含む行が無いので、ほかの宝具の名前を含まない ${m.lines.length}行から選びます` : '<span class="ng">使える行がありません（どの行も別の宝具の名前を含んでいます）</span>'}</div>`;
    }).join('') : '';
    const used = cov.filter(x => x.n).length, all = Object.values(v).reduce((t, x) => t + x.length, 0);
    el.querySelector('[data-vcount]').textContent = `ゲームで使う場面 ${used}/${G.VOICE_SLOTS.length}・全${Object.keys(v).length}見出し${all}行` + (r.bad.length ? `　読めない行 ${r.bad.length}` : '');
    if (el._veChange) el._veChange();
  }
  function mode(el, m) {
    const txt = m === 'text', vt = el.querySelector('.vtext');
    if (txt === !vt.hidden) return;
    const rd = read(el), cur = rd.voice;
    if (!txt && rd.bad.length && !confirm(`次の${rd.bad.length}行は「見出し：「セリフ」」の形で読めないため、場面ごとの表示では消えます。よろしいですか？\n\n${rd.bad.slice(0, 6).join('\n')}`)) return;
    if (txt) vt.querySelector('textarea').value = toText(cur);
    vt.hidden = !txt; el.querySelector('.vrows').hidden = txt; el.querySelector('.vcov').hidden = txt; el.querySelector('[data-vadd]').hidden = txt;
    if (!txt) rows(el, cur);
    for (const b of el.querySelectorAll('[data-vmode]')) b.classList.toggle('on', b.dataset.vmode === m);
    update(el);
  }
  // el の中に編集欄を作る。opts.nps：宝具の一覧（宝具のセリフがどの宝具に当たるかを出す）、opts.onChange：入力のたびに呼ぶ
  function mount(el, voice, opts) {
    addStyle(); opts = opts || {};
    el.classList.add('ve'); el._veNps = opts.nps || []; el._veChange = opts.onChange || null;
    el.innerHTML = `<p class="vnote">場面ごとに、1行に1つセリフを書きます（カギかっこは要りません）。テンプレートのままの行や、別のキャラクターのセリフは行ごと消してください。点線の場面はセリフが無く、ゲームではその場面で何も言いません。</p>`
      + '<div class="vmode"><button type="button" class="sm on" data-vmode="rows">場面ごと</button><button type="button" class="sm" data-vmode="text">まとめてテキストで</button></div>'
      + '<div class="vcov"></div><div class="vrows"></div>'
      + '<div class="vtext" hidden><p class="vnote">1行に1つ「見出し：「セリフ」」の形（Wikiからの貼り付け用。「その2」は前の見出しにまとめます）。</p><textarea class="code" spellcheck="false"></textarea></div>'
      + '<div class="vfoot"><button type="button" class="sm" data-vadd>＋ 見出しを追加</button><span class="hint" data-vcount></span></div>';
    if (!el._veBound) {
      el._veBound = true;
      el.addEventListener('input', () => update(el));
      el.addEventListener('click', e => {
        const m = e.target.closest('[data-vmode]'); if (m) { mode(el, m.dataset.vmode); return; }
        const go = e.target.closest('[data-vgo]');
        if (go) {
          const c = el.querySelector(`.vcard[data-slot="${String(go.dataset.vgo).replace(/["\\]/g, '\\$&')}"]`);
          if (c) { c.scrollIntoView({ block: 'center', behavior: 'smooth' }); c.classList.remove('vflash'); void c.offsetWidth; c.classList.add('vflash'); c.querySelector('textarea').focus({ preventScroll: true }); }
          return;
        }
        if (e.target.closest('[data-vadd]')) { const x = el.querySelector('.vextra'); x.insertAdjacentHTML('beforeend', extra('', [])); x.lastElementChild.querySelector('input').focus(); update(el); return; }
        const orm = e.target.closest('[data-vorm]');
        if (orm) { const f = orm.closest('.vf'); if (!lines(f.querySelector('textarea').value).length || confirm('この見出しのセリフを消します')) { f.remove(); update(el); } return; }
        const rm = e.target.closest('[data-vrm]');
        if (rm) { const c = rm.closest('.vcard'); if (!lines(c.querySelector('textarea').value).length || confirm('この見出しのセリフを消します')) { c.remove(); update(el); } }
      });
    }
    rows(el, voice || {});
  }
  // 宝具の一覧が変わった（追加・削除・名前の変更）あとに呼ぶ。nps = [{ uid, orig, name, reading }]（uid = 宝具の欄を見分ける印、orig = 編集を始めたときの名前）。
  // 名前を変えた宝具の専用の見出しは新しい名前に付け替える。消えた宝具の行は残し、「対応する宝具がありません」として出す（セリフは失わない）。
  function setNps(el, nps) {
    const prev = el._veNps || [], rd = read(el), voice = {};
    const flat = s => String(s == null ? '' : s).replace(/[\s・]/g, '');
    const ren = [];
    for (const n of nps || []) {
      const p = prev.find(x => x.uid != null && x.uid === n.uid), pn = p ? p.name : n.orig;
      if (pn && n.name && flat(pn) !== flat(n.name)) ren.push([flat(pn), G.npHeading(n)]);
    }
    for (const [h, ls] of Object.entries(rd.voice)) {
      const t = G.npHeadingName(h), r = t != null && ren.find(x => x[0] === flat(t));
      const k = r ? r[1] : h;
      voice[k] = (voice[k] || []).concat(ls);
    }
    el._veNps = nps || [];
    if (!el.querySelector('.vtext').hidden) el.querySelector('.vtext textarea').value = toText(voice);
    else rows(el, voice);
  }
  G.voiceEdit = { mount, read, toText, parseText, lines, setNps };
})(globalThis.HGW = globalThis.HGW || {});
