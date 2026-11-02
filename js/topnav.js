/* 画面上部の「モード一覧」。各ページの先頭に、折りたたみのメニューを差し込む（ゲームの処理には関わらない） */
(function () {
  'use strict';
  const MODES = [
    { href: 'index.html', name: '7分の1の聖杯戦争', note: '七騎の戦いを見守る' },
    { href: 'taisen.html', name: '14分の1の聖杯大戦', note: '二色に分かれた十四騎の戦い（テスト中）' },
    { href: 'singularity.html', name: '46億分の1の特異点', note: '六騎を率いて敵とボスに挑む（テスト中）' },
    { href: 'zukan.html', name: '英霊図鑑', note: '解説・スキル・宝具を読む', spoil: true, local: true },
    { href: 'ranking.html', name: '強さランキング', note: '真名・強さ・優勝率を見比べる', spoil: true, local: true },
    { href: 'logview.html', name: '戦いのログビューア', note: '書き出したCSVを日ごとに読む', plain: true },
  ];
  const css = `
.topnav { max-width: 1100px; margin: 0 auto; padding: 8px 16px 0; font-family: inherit; }
.topnav > summary { list-style: none; display: inline-flex; align-items: center; gap: 8px; cursor: pointer; padding: 6px 14px; font-size: 13px; letter-spacing: .08em;
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
  }
  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();
