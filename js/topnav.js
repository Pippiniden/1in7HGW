/* 画面上部の「モード一覧」。各ページの先頭に、折りたたみのメニューを差し込む（ゲームの処理には関わらない） */
(function () {
  'use strict';
  const MODES = [
    { href: 'index.html', name: '7分の1の聖杯戦争', note: '七騎の戦いを見守る' },
    { href: 'taisen.html', name: '14分の1の聖杯大戦', note: '二色に分かれた十四騎の戦い（テスト中）' },
    { href: 'singularity.html', name: '46億分の1の特異点', note: '六騎を率いて敵とボスに挑む（テスト中）' },
    { href: 'original.html', name: 'オリジナル特異点', note: 'シナリオを読み込んで遊ぶ（テスト中）' },
    { href: 'zukan.html', name: '英霊図鑑', note: '解説・スキル・宝具を読む', spoil: true, local: true },
    { href: 'ranking.html', name: '強さランキング', note: '真名・強さ・優勝率を見比べる', spoil: true, local: true },
    { href: 'logview.html', name: '戦いのログビューア', note: '書き出したCSVを日ごとに読む', plain: true },
  ];
  // 開発者・管理者向けのエディタ類。画面の一番下に折りたたんで置く
  const DEV = [
    { href: 'roster.html', name: 'サーヴァントエディタ', note: '英霊データの取り込み・確認・手直し', local: true },
    { href: 'scenario.html', name: 'シナリオエディタ', note: 'オリジナル特異点のシナリオを書く', spoil: true, local: true },
  ];
  // クレジット（LICENSE 第5条）。原作者の表記は全ページの最下部に常に出る。派生ゲームを作る人は DERIVATIVE を埋める（原作の表記は消さずに、その上に改変版の情報が載る）
  const ORIGINAL = { author: 'Pippiniden', repo: 'https://github.com/Pippiniden/1in7HGW', license: 'https://github.com/Pippiniden/1in7HGW/blob/main/LICENSE' };
  const DERIVATIVE = { name: '', author: '', url: '' };
  const CREDITS = [
    { h: '原作・制作', rows: [['企画・プログラム・画像', ORIGINAL.author], ['リポジトリ', ORIGINAL.repo, ORIGINAL.repo]] },
    { h: '英霊データ', rows: [['サーヴァントの設定', 'kagemiya@ふたば（寄稿者のみなさん）', 'https://seesaawiki.jp/kagemiya/']] },
    { h: '着想', rows: [['人生シミュレーター', '80億分の1（1in8b.life）'], ['世界観', 'Fate シリーズ（TYPE-MOON）の二次創作・非公式']] },
    { h: '素材', rows: [['令呪の紋様', '令呪デザイナー', 'https://pippiniden.github.io/command-spell-maker/'], ['フォント', 'Google Fonts（Shippori Mincho / Zen Kaku Gothic New / Rajdhani）']] },
    { h: 'ライセンス', rows: [['非商用ライセンス（顔画像・サーヴァントデータは再利用不可）', 'LICENSE を読む', ORIGINAL.license]] },
  ];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const link = (t, u) => /^https?:\/\//.test(u || '') ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>` : esc(t);
  function creditsHtml() {
    const dv = DERIVATIVE.name || DERIVATIVE.author
      ? `<section><h3>この作品</h3><dl><dt>改変版</dt><dd>${link(DERIVATIVE.name || '（名称未設定）', DERIVATIVE.url)}</dd>${DERIVATIVE.author ? `<dt>改変・制作</dt><dd>${esc(DERIVATIVE.author)}</dd>` : ''}</dl><p class="cr-note">以下は、この作品の元になったゲームのクレジットです。</p></section>`
      : '';
    return dv + CREDITS.map(s => `<section><h3>${esc(s.h)}</h3><dl>${s.rows.map(r => `<dt>${esc(r[0])}</dt><dd>${link(r[1], r[2])}</dd>`).join('')}</dl></section>`).join('')
      + '<p class="cr-note">このクレジットは、原作者へのクレジット表示です。原作者がこのゲームの改変版や派生ゲームを承認・推奨・公式に関与していることを示すものではありません。</p>';
  }
  const crCss = `
.credits-bar { max-width: 1100px; margin: 0 auto; padding: 8px max(16px, env(safe-area-inset-right, 0px)) calc(28px + env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px)); font-size: 12px; color: var(--mute, #8fb0d8); line-height: 1.8; border-top: 1px solid var(--line, #1f4a8a); }
.credits-bar a, .credits-bar button { color: var(--cyan-2, #5ee0ff); background: none; border: 0; padding: 4px 2px; font: inherit; cursor: pointer; text-decoration: underline; min-height: 24px; }
.credits-bar a:focus-visible, .credits-bar button:focus-visible, .cr-dlg button:focus-visible, .cr-dlg a:focus-visible { outline: 2px solid var(--cyan, #38d6ff); outline-offset: 2px; }
.cr-dlg { width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 48px); padding: 0; border: 0; color: var(--ice, #dbeaff); background: var(--panel, #081a3c); box-shadow: 0 0 0 1px var(--line-hi, #3a78c8), 0 20px 60px rgba(0, 0, 0, .6); font-family: inherit; }
.cr-dlg::backdrop { background: rgba(2, 8, 24, .78); }
.cr-dlg .cr-in { padding: 20px 22px; max-height: calc(100vh - 48px); overflow-y: auto; box-sizing: border-box; }
.cr-dlg h2 { margin: 0 0 4px; font-size: 18px; letter-spacing: .3em; text-align: center; }
.cr-dlg h3 { margin: 18px 0 6px; font-size: 12px; letter-spacing: .2em; color: var(--gold, #f2c14e); font-weight: 400; }
.cr-dlg dl { margin: 0; display: grid; grid-template-columns: 1fr; gap: 0; }
.cr-dlg dt { font-size: 11px; color: var(--mute, #8fb0d8); margin-top: 6px; }
.cr-dlg dd { margin: 0; font-size: 15px; word-break: break-all; }
.cr-dlg a { color: var(--cyan-2, #5ee0ff); }
.cr-dlg .cr-note { margin: 16px 0 0; font-size: 11px; color: var(--mute, #8fb0d8); line-height: 1.7; }
.cr-dlg .cr-close { display: block; margin: 20px auto 0; padding: 8px 28px; min-height: 40px; cursor: pointer; color: var(--sel-ink, #04122c); border: 0; font: inherit; background: linear-gradient(90deg, var(--cyan, #38d6ff), var(--cyan-2, #5ee0ff)); }
`;
  function creditsBar() {
    const st = document.createElement('style');
    st.textContent = crCss;
    document.head.appendChild(st);
    const bar = document.createElement('footer');
    bar.className = 'credits-bar';
    const who = DERIVATIVE.name || DERIVATIVE.author
      ? `${esc(DERIVATIVE.name || '改変版')}　原作：` : '原作：';
    bar.innerHTML = `${who}<a href="${esc(ORIGINAL.repo)}" target="_blank" rel="noopener">${esc(ORIGINAL.author)}</a>（${esc(ORIGINAL.repo)}）　<button type="button" class="cr-open">クレジット</button>　<a href="${esc(ORIGINAL.license)}" target="_blank" rel="noopener">ライセンス</a>`;
    document.body.appendChild(bar);
    const dlg = document.createElement('dialog');
    dlg.className = 'cr-dlg';
    dlg.setAttribute('aria-label', 'クレジット');
    dlg.innerHTML = `<div class="cr-in"><h2>CREDITS</h2>${creditsHtml()}<button type="button" class="cr-close">閉じる</button></div>`;
    document.body.appendChild(dlg);
    const open = () => { if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', ''); };
    bar.querySelector('.cr-open').addEventListener('click', open);
    dlg.querySelector('.cr-close').addEventListener('click', () => { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); });
    dlg.addEventListener('click', e => { if (e.target === dlg && dlg.close) dlg.close(); });
  }
  const css = `
.topnav { max-width: 1100px; margin: 0 auto; padding: calc(8px + env(safe-area-inset-top, 0px)) max(16px, env(safe-area-inset-right, 0px)) 0 max(16px, env(safe-area-inset-left, 0px)); font-family: inherit; }
.topnav > summary { list-style: none; display: inline-flex; align-items: center; gap: 8px; cursor: pointer; padding: 6px 14px; min-height: 40px; box-sizing: border-box; font-size: 13px; letter-spacing: .08em; -webkit-tap-highlight-color: transparent;
  color: var(--ice, #dbeaff); background: linear-gradient(180deg, rgba(20, 60, 130, .9), rgba(8, 30, 74, .95)); box-shadow: inset 0 0 0 1px var(--line-hi, #3a78c8);
  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px); user-select: none; }
.topnav > summary::-webkit-details-marker { display: none; }
.topnav > summary::after { content: "▾"; font-size: 11px; }
.topnav[open] > summary::after { content: "▴"; }
.topnav > summary:hover { background: linear-gradient(180deg, rgba(40, 100, 180, .95), rgba(12, 44, 100, .95)); }
.topnav > summary:focus-visible, .topnav a:focus-visible { outline: 2px solid var(--cyan, #38d6ff); outline-offset: 2px; }
.topnav .tn-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 8px; margin: 8px 0 4px; }
.topnav a, .topnav .tn-cur { display: flex; flex-direction: column; gap: 2px; padding: 9px 14px; text-decoration: none; color: var(--ice, #dbeaff); line-height: 1.4; text-align: left;
  background: linear-gradient(180deg, rgba(20, 60, 130, .9), rgba(8, 30, 74, .95)); box-shadow: inset 0 0 0 1px var(--line-hi, #3a78c8);
  clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px); }
.topnav a:hover { background: linear-gradient(180deg, rgba(40, 100, 180, .95), rgba(12, 44, 100, .95)); }
.topnav b { font-size: 14px; }
.topnav small { font-size: 11px; color: var(--mute, #8fb0d8); }
.topnav .tn-cur { background: linear-gradient(90deg, var(--cyan, #38d6ff), var(--cyan-2, #5ee0ff)); color: var(--sel-ink, #04122c); }
.topnav .tn-cur small { color: var(--sel-ink, #04122c); opacity: .75; }
.topnav .spoil b::after { content: "ネタバレ注意"; margin-left: 8px; font-size: 10px; font-weight: 400; color: var(--gold, #f2c14e); }
.topnav .tn-cur.spoil b::after { color: var(--sel-ink, #04122c); }
.devnav { max-width: 1100px; margin: 28px auto 0; padding: 0 max(16px, env(safe-area-inset-right, 0px)) calc(24px + env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px)); }
.devnav > summary { cursor: pointer; font-size: 12px; color: var(--mute, #8fb0d8); letter-spacing: .08em; padding: 8px 0; min-height: 24px; user-select: none; background: none; box-shadow: none; clip-path: none; }
.devnav > summary:focus-visible { outline: 2px solid var(--cyan, #38d6ff); outline-offset: 2px; }
.devnav .tn-list { margin-top: 4px; }
.topnav .tn-note { margin: 4px 2px 0; font-size: 11px; color: var(--mute, #8fb0d8); }
`;
  function build() {
    const here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    let local = false;
    try { local = new URLSearchParams(location.search).get('data') === 'local'; } catch (e) { /* 読めなければ通常のリンク */ }
    const d = document.createElement('details');
    d.className = 'topnav';
    d.innerHTML = '<summary>モード一覧</summary><nav aria-label="ほかの遊び方・資料"><div class="tn-list">'
      + MODES.map(m => {
        const inner = `<b>${m.name}</b><small>${m.note}</small>`, cls = m.spoil ? 'spoil' : '';
        return m.href === here || (here === '' && m.href === 'index.html')
          ? `<span class="tn-cur ${cls}" aria-current="page">${inner}</span>`
          : `<a class="${cls}" href="${m.href}${local && !m.plain ? '?data=local' : ''}">${inner}</a>`;
      }).join('')
      + '</div><p class="tn-note">英霊図鑑と強さランキングには、すべての英霊の真名が載っています（戦いの中で推し量りたい人は開かないでください）。</p></nav>';
    const st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
    document.body.insertBefore(d, document.body.firstChild);
    // 開発者向けは画面の一番下。このスクリプトは body の先頭で動くので、ページが組み上がってから足す
    const dev = () => {
      const v = document.createElement('details');
      v.className = 'topnav devnav';
      v.innerHTML = '<summary>開発者向け</summary><nav aria-label="開発者向けのエディタ"><div class="tn-list">'
        + DEV.map(m => {
          const inner = `<b>${m.name}</b><small>${m.note}</small>`, cls = m.spoil ? 'spoil' : '';
          return m.href === here
            ? `<span class="tn-cur ${cls}" aria-current="page">${inner}</span>`
            : `<a class="${cls}" href="${m.href}${local && m.local ? '?data=local' : ''}">${inner}</a>`;
        }).join('')
        + '</div></nav>';
      document.body.appendChild(v);
      creditsBar();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', dev); else dev();
  }
  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();
