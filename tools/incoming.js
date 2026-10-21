#!/usr/bin/env node
/* data/incoming/ に置かれたファイルを、中身を見て data/servants.json・data/overrides.json に反映する
 *
 *   node tools/incoming.js [--summary 報告.md]
 *
 * ファイル名は何でもよい（ダウンロードを繰り返して付いた「servants (3).json」のままでよい）。種類は中身で見分ける：
 *   - リスト（format: 'hgw-servants'・英霊の配列）……リストツールの「公開用に保存」「リストをJSONで保存」。
 *       patch（このブラウザで変えた騎の id の一覧。「公開用に保存」が付ける）があれば、その騎だけを足す・置き換える・消す。
 *       patch が無い古い書き出しは、次のとおり：
 *       今のリストの8割以上の騎を含むなら「まるごと置き換え」、それより少なければ「足す・置き換える」（同じクラス・真名）
 *       書き出しに残っていた手直し（効果・内容）は手直し表に引き継ぐ
 *   - 手直し表（format: 'hgw-overrides'）……リストツールの「手直し表を保存」。overrides.json をまるごと置き換える
 *   - Wikiのページのテキスト（.txt）……英霊を足す・置き換える（複数ページは ===== だけの行で区切る）
 *   - 申請（hgw-request）・記録（hgw-records）・集計（hgw-survival）などは反映せず、そのまま残して報告する
 * 反映したファイルは data/incoming/ から消す。GitHub Actions の「データの反映」（.github/workflows/data.yml）から使う。
 */
'use strict';
const fs = require('fs'), path = require('path');
const L = require('./datalib');
const { B, H } = L;
const DATA = path.join(L.ROOT, 'data'), IN = path.join(DATA, 'incoming');
const SV = path.join(DATA, 'servants.json'), OV = path.join(DATA, 'overrides.json');
const REPLACE_SHARE = 0.8;
// 上げた順：git でそのファイルが入った時刻（Actions は履歴をすべて取ってくる）。分からなければ名前の数字の順（「(9)」<「(10)」）
const { execFileSync } = require('child_process');
function uploadedAt(f) {
  try { const t = +execFileSync('git', ['log', '-1', '--format=%ct', '--', path.relative(L.ROOT, path.join(IN, f))], { cwd: L.ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); return t > 0 ? t : null; }
  catch (e) { return null; }
}
const dlNum = f => +((f.match(/\((\d+)\)\.[^.]+$/) || [0, 0])[1]);   // ブラウザが付ける「(3)」。付いていない最初のファイルは 0
const natural = (a, b) => dlNum(a) - dlNum(b) || a.localeCompare(b, 'ja', { numeric: true });

function main() {
  const args = process.argv.slice(2), summary = args.includes('--summary') ? args[args.indexOf('--summary') + 1] : null;
  const files = fs.existsSync(IN) ? fs.readdirSync(IN).filter(f => !/^readme/i.test(f) && !f.startsWith('.') && fs.statSync(path.join(IN, f)).isFile()).sort() : [];
  const notes = [], kept = [];
  let applied = 0;
  if (files.length) {
    // 今のリストと手直し表（手直しはゲームと同じく読み込んだ状態から始める）
    L.clearOverrides();
    if (fs.existsSync(OV)) L.applyOverrides(L.readJSON(OV));
    const pack = fs.existsSync(SV) ? L.readJSON(SV) : { format: 'hgw-servants', version: 2, lean: true, servants: [] };
    let list = L.listOf(pack);
    const idOf = s => (s.class && s.class.key ? s.class.key : H.parser.parseClass((s.class && (s.class.raw || s.class.label)) || '').key) + ':' + s.trueName;
    const upsert = (incoming, label) => {
      let add = 0, rep = 0;
      for (const s of incoming) {
        const id = s.id || idOf(s), i = list.findIndex(x => (x.id || idOf(x)) === id);
        if (i >= 0) { if (!s.page && list[i].page) s.page = list[i].page; list[i] = s; rep++; } // Wikiのページのテキストにはページ名が無いので、前のものを引き継ぐ
        else { list.push(s); add++; }
      }
      notes.push(`- ${label}：足す・置き換える（追加 ${add}・置き換え ${rep}）`);
    };
    // 書き出しの形（中身を組み立てた形でも）を、公開用の軽い形に直す
    const toLean = raw => { const n = B.harvestOverrides(raw); return { lean: raw.map(s => B.toLean(B.fromJSON(s))), harvested: n }; };
    // 反映する順：手直し表 → リスト（多い方から。まるごと置き換えを先に）→ Wikiのページ・少ないリスト
    //   手直し表を先にするのは、同じときに上げたリストの書き出しに残っていた手直しを、あとから消してしまわないため。
    //   まるごと置き換えを先にするのは、一緒に上げた1騎分のページなどが、置き換えで消えてしまわないため
    const rankOf = f => {
      if (!/\.json$/i.test(f)) return [2, 0];
      try {
        const d = L.readJSON(path.join(IN, f));
        if (d && (d.format === 'hgw-overrides' || (!d.format && !Array.isArray(d) && !d.servants && (d.global || d.servant || d.content || d.stats || d.np || d.pages || d.reviewed)))) return [0, 0];
        const n = L.listOf(d).length; return n ? [1, -n] : [3, 0];
      } catch (e) { return [3, 0]; }
    };
    // 同じ種類の中では、上げた順（古いもの → 新しいもの）。名前の順だと「(10)」が「(9)」より先になり、古いものがあとから上書きしていた
    const rk = new Map(files.map(f => [f, rankOf(f)])), at = new Map(files.map(f => [f, uploadedAt(f)]));
    const byTime = (a, b) => (at.get(a) != null && at.get(b) != null ? at.get(a) - at.get(b) : 0) || natural(a, b);
    files.sort((a, b) => rk.get(a)[0] - rk.get(b)[0] || rk.get(a)[1] - rk.get(b)[1] || byTime(a, b));
    // 手直し表はまるごと置き換えなので、いちばん新しいものだけを使う（古いものは片付ける。閉じたプルリクエストの取り残しなど）
    const ovFiles = files.filter(f => rk.get(f)[0] === 0), newestOv = ovFiles[ovFiles.length - 1];
    const fmtAt = f => at.get(f) ? new Date(at.get(f) * 1000).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '';
    for (const f of files) {
      const p = path.join(IN, f), label = `「${f}」`;
      try {
        if (/\.(txt|text|wiki)$/i.test(f)) {
          const pages = fs.readFileSync(p, 'utf8').split(/^\s*={5,}\s*$/m).map(t => t.trim()).filter(Boolean);
          const got = pages.map(t => B.importServant(t, { title: pages.length > 1 ? null : f.replace(/\.[^.]+$/, '').replace(/\s*\(\d+\)$/, '') })).filter(s => s.trueName);
          if (!got.length) throw new Error('英霊として読めるページがありません');
          upsert(got.map(s => B.toLean(s)), label + `（Wikiのページ ${got.length}件）`);
        } else {
          const d = JSON.parse(fs.readFileSync(p, 'utf8'));
          const fmt = d && !Array.isArray(d) ? d.format : null;
          if (fmt === 'hgw-overrides' || (!fmt && d && (d.global || d.servant || d.content || d.stats || d.np || d.pages || d.reviewed) && !d.servants)) {
            if (f !== newestOv) { notes.push(`- ${label}${fmtAt(f) ? `（${fmtAt(f)}）` : ''}：より新しい手直し表「${newestOv}」があるので使わず、片付けました`); fs.unlinkSync(p); applied++; continue; }
            L.clearOverrides(); L.applyOverrides(d);
            notes.push(`- ${label}${fmtAt(f) ? `（${fmtAt(f)}）` : ''}：手直し表（overrides.json）をまるごと置き換え`);
          } else if (fmt === 'hgw-servants' || Array.isArray(d) || (d && d.kind === 'servant')) {
            const raw = L.listOf(d);
            if (!raw.length) throw new Error('英霊が入っていません');
            // 公開用の軽い形（lean）はそのまま使う（並びや書き方を変えず、差分を小さく）。中身を組み立てた書き出しは軽い形に直す
            const { lean, harvested } = d.lean === true ? { lean: raw, harvested: 0 } : toLean(raw);
            const cur = new Set(list.map(s => s.id || idOf(s))), hit = lean.filter(s => cur.has(s.id || idOf(s))).length;
            const patch = d && d.patch && ['add', 'upd', 'del'].every(k => Array.isArray(d.patch[k])) ? d.patch : null;
            if (patch) {
              // リストツールの「公開用に保存」：このブラウザで変えた騎だけを反映する。そのあいだに公開側で取り込んだ・直した騎は
              // そのまま（以前はまるごと置き換えで、ブラウザが知らない騎が消えたり、古い版に戻ったりしていた）
              const byId = new Map(lean.map(s => [s.id || idOf(s), s]));
              const put = patch.add.concat(patch.upd).map(id => byId.get(id)).filter(Boolean);
              const del = new Set(patch.del), gone = list.filter(s => del.has(s.id || idOf(s))).map(s => s.trueName);
              list = list.filter(s => !del.has(s.id || idOf(s)));
              let add = 0, rep = 0;
              for (const s of put) { const i = list.findIndex(x => (x.id || idOf(x)) === s.id); if (i >= 0) { list[i] = s; rep++; } else { list.push(s); add++; } }
              const missing = patch.add.concat(patch.upd).filter(id => !byId.has(id));
              notes.push(`- ${label}：このブラウザで変えた騎だけを反映（追加 ${add}・更新 ${rep}・削除 ${gone.length}${gone.length ? `：${gone.join('、')}` : ''}）。ほかの騎は公開中のまま`
                + (missing.length ? `\n  - ⚠ 変えたことになっているのにファイルに入っていない騎：${missing.join('、')}` : ''));
            } else if (list.length && hit >= list.length * REPLACE_SHARE) {
              const gone = list.filter(s => !lean.some(x => (x.id || idOf(x)) === (s.id || idOf(s)))).map(s => s.trueName);
              list = lean;
              notes.push(`- ${label}：リストをまるごと置き換え（${lean.length}騎${gone.length ? `。入っていなかったので外れる騎：${gone.join('、')}` : ''}）`);
            } else upsert(lean, label);
            if (harvested) notes.push(`  - 書き出しに残っていた手直し ${harvested}件を手直し表に引き継ぎ`);
          } else {
            kept.push(f);
            notes.push(`- ${label}：${{ 'hgw-request': '申請のファイル（リストツールの「取り込み」で読んでください）', 'hgw-records': '聖杯戦争の記録（ゲームの「記録を読み込む」用）', 'hgw-survival': '生存曲線の集計（自動で作り直すので不要）' }[fmt] || '何のファイルか分かりません'}。反映せずに残しました`);
            continue;
          }
        }
        fs.unlinkSync(p); applied++;
      } catch (e) { kept.push(f); notes.push(`- ${label}：読めませんでした（${e.message}）。そのまま残しました`); }
    }
    if (applied) {
      pack.servants = L.sortLean(list); pack.format = 'hgw-servants'; pack.version = 2; pack.lean = true; pack.at = new Date().toISOString();
      fs.writeFileSync(SV, JSON.stringify(pack, null, 1) + '\n');
      const ov = L.currentOverrides(); for (const k of Object.keys(ov)) if (ov[k] && typeof ov[k] === 'object' && !Object.keys(ov[k]).length && !['global', 'servant', 'stats', 'np'].includes(k)) delete ov[k];
      fs.writeFileSync(OV, JSON.stringify(ov, null, 1) + '\n');
    }
  }
  const md = files.length ? ['### アップロードされたファイル', ...notes].join('\n') : '';
  if (summary) fs.writeFileSync(summary, md ? md + '\n' : '');
  if (md) console.log(md); else console.log('data/incoming/ にファイルはありません');
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `incoming=${files.length}\napplied=${applied}\nkept=${kept.length}\n`);
}
main();
