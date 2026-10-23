## 背景
同じ真名の騎（同じクラスでも別のクラスでも）は、id も手直し表（真名だけで引く）も共有していた。そのため、同名の別の英霊を取り込むと前の騎を上書きしたり、前の騎の手直しがそのまま掛かったりした。

## 変更
- 騎に任意の印 `key`（5文字）を足した。取り込むときに**一度だけ**、後から入るほうに付けて公開用データに保存する。読み込みのたびには決めないので、id・決定論・生存曲線の指紋は変わらない。
  - kagemiya のページ名から決まる（同じページの取り直しなら同じ印。ページが無い手書きのときだけ乱数）。
  - 同じクラスで、ページ名が食い違わない騎がいれば同じ騎として置き換える。ページが違う、またはクラスが違えば別の騎として印を付ける。
- id は `クラス:真名#印`、手直し表は `真名#印` で引く（`E.okey` / `E.idOf` / `B.wikiKey`）。**印の無い騎は今までどおり**。
- 印を付ける取り込み口：`tools/kagemiya.js`、`tools/incoming.js`（足し込み）、`tools/servant.js add`、リストツールの取り込み。報告にも出す。
- 手直し表を読み書きする箇所を `E.okey` に置き換え（`roster.html`・`submit.html`・`js/build.js`・`js/effects.js`・`js/singularity.js`）。
- `servant.js check` は、印の無い同名が2騎以上いると注意を出す。`wipe` / `remove` は印付きの騎を単独で扱う。
- `AGENTS.md`・`docs/DEVELOPER.md` を更新。

## 確認
Node が無い環境のため、VS Code 同梱の Node（v24）で実行した。
- `test/sim.js 200`：errors 0。出力（200戦・シード固定の1戦ログ2本）が `origin/main` と一致 → 既存データの展開は変わらない。
- `test/interactive.js 100`：errors 0・mismatch 0。`test/singularity.js 60`：errors 0・mismatch 0。
- `test/servant.js`（同名の追加・別ページ・別クラス・手直しが共有されないことを追加）、`test/incoming.js`（足し込みで印が付く・同じページの再アップは置き換えを追加）、`content` `skills` `voice` `fgo` `kagemiya` `taken` `survival`：通る。`tools/survival.js --check`：一致。
- 以下は **`origin/main` でも同じく落ちる**（この PR とは無関係）：`test/effects.js`（先手の宝具・倒したときの強化の2件）、`test/markup.js`（ヴラド三世の記法）、`test/simlab.js`（config.js の説明）。
- `roster.html` の取り込み（`upsert`）は同じ処理を Node で再現して確認した。画面そのものは未確認なので、デスクトップ幅と 390px で見てもらえると助かる。

## 注意
- ページ名が残っていない騎（今は152騎のうち約半数）は、同じクラス・同じ真名の取り込みを「同じ騎」として置き換える（今までと同じ）。ページ名が食い違うときだけ別の騎になる。
- 印が付く前に取り違えて取り込んだ分は、これまでどおり `wipe` などで片付ける。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
