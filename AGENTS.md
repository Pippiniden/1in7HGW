# AGENTS.md — Holy Grail War Simulator (1in7HGW)

Specification for AI coding agents (also loaded through `CLAUDE.md`, so it is kept short). Human-facing docs are Japanese:
`README.md` = player manual, `docs/DEVELOPER.md` = maintainer manual (publishing, data workflow, roster tool, engine tuning, UI
implementation notes), `img/scenes/README.md`. **The code wins over any number quoted here** (`js/config.js` holds the tuning values).

> Keep this file in sync when you change architecture, data formats, decision keys or the URL format. Do not add change history,
> measurements or "before/after" stories here — put them in the PR description.

---

## 1. What this is

A browser game: a **Fate-style "Holy Grail War" simulation** (fan fiction). Seven Servants and their Masters fight in one city for up
to **30 in-game days**; the last Servant standing wins. Inspired by the life-sim "1in8b.life" (80億分の1): mostly automatic, the
player watches a chronicle, changes a light **focus** any time and makes **big decisions** every ~5 days or at events.

- The player is **one Master** (or a neutral observer). Servants come from the owner's wiki **kagemiya@ふたば**
  (https://seesaawiki.jp/kagemiya/); pages are parsed into data, contributors send additions, the owner merges.
- **Static site on GitHub Pages**: https://github.com/Pippiniden/1in7HGW
- All UI text, log text, comments and human docs are **Japanese**; keep new user-facing strings Japanese in the existing literary,
  Fate-like tone. Never hard-code English text in the UI.

### Glossary

| JP | Code | Meaning |
|---|---|---|
| サーヴァント | `sv` | Heroic spirit: class, stats, skills, Noble Phantasms |
| マスター | `master` / `m` | Human contractor; stats `mana/craft/body/mind/luck` |
| 陣営 | camp `c` | One Master+Servant pair; the unit the engine simulates |
| 真名 | `trueName` | Hidden from other camps until learned |
| クラス | `class.key` | saber, archer, … (`CLASS_DEFS`) |
| 宝具 | NP (`nps`) | Noble Phantasm |
| 令呪 | `cs` | Command seals (3) |
| 霊基 / 魔力 / 絆 / 工房 / 拠点 | `hp` / `mana` / `bond` / `workshop` / `base` | Servant HP 0–100 / Master mana pool / bond 0–100 / fortification 0–5 / home place |
| 方針 | focus | Player's daily stance (UI term 方針) |
| 戦略 | policy | Camp's long-term strategy (AI and the player's "auto") |
| 作戦会議 | council | Big decision every `councilEvery` days |
| 性格 | persona | Master personality (biases behaviour) |
| 手がかり | clues | Evidence toward deducing an enemy's true name |
| はぐれ / 単独行動 | stray / `solo` | Servant whose Master died; effect that lets it persist |
| 討伐令 | bounty | Overseer's kill order (+1 command seal reward) |
| 因縁 / 日常 / 情景 | relations / life event / scene | Wiki-listed links / slice-of-life events / background image category |

---

## 2. Hard constraints

1. **No build step, bundler or runtime npm dependency.** Plain HTML/CSS/JS served statically. External resources: Google Fonts only.
2. **Classic scripts, not ES modules.** Every `js/*.js` is an IIFE attaching to the global `HGW`
   (`(function (G) { 'use strict'; … })(globalThis.HGW = globalThis.HGW || {});`) so the game runs from `file://` and Node tests `require()` the same files.
3. **Script load order matters:** `config → rank → parser → effects → fgoskills → build → master → war → names → scenes → personas → engine → data → survival`.
   `index.html`/`ranking.html` load all of them; `roster.html` and `submit.html` load subsets plus `voiceedit` (roster also `simlab`);
   `singularity.html` loads up to `data` (no `survival`) then `singdata → singularity`.
   When you add a file, add it to **index.html, roster.html (if needed), test/sim.js, test/interactive.js and `PRECACHE` in `sw.js`** (then bump `VERSION`).
4. **Determinism.** A war is fully determined by *(data, seed, focus per day, decision answers)*. All randomness inside `warGen` goes
   through its seeded `rnd()` (`chance`, `pick`, `wpick`, `shuffle`); never `Math.random()` in the engine. Adding/removing/reordering
   `rnd()` calls changes every seed's outcome (acceptable, but old shared links replay differently). Never iterate `Set`/object keys in
   an order that depends on anything but insertion.
5. `.nojekyll` stays at the repo root. Mobile support is required (breakpoint **820px**; no horizontal overflow at 390px).
6. **PWA:** `manifest.webmanifest` + `sw.js` (network-first for same-origin GETs). Bump `VERSION` in `sw.js` when `PRECACHE` or the worker logic changes.

---

## 3. Repository map

```
index.html          Game (inline CSS + UI script)          ranking.html   Strength ranking (spoiler page)
roster.html         Admin tool: import, review, edit, export   submit.html    Player request form (no server)
logview.html        Standalone CSV chronicle viewer (reads the CSVs of index.html / singularity.html; no game scripts)
singularity.html    Singularity mode (test feature, §7.11)
sw.js, manifest.webmanifest   PWA                          icons/ img/    App icons, class icons, optional faces/scenes (each has README.md)
data/
  manifest.json     Which data files to load
  servants.json     Servant pack (hgw-servants, lean). ~1.2M chars — NEVER read it whole; use tools/servant.js (§4.6)
  overrides.json    Hand-fix tables (hgw-overrides)
  survival.json     Survival tally (§7.10); regenerate with tools/survival.js after any data change
  bosses.json       Singularity bosses (hgw-bosses, hand-written raw ranks; never in Holy Grail Wars) (§7.11)
  incoming/         Upload drop folder consumed by data.yml (§4.5)
js/
  config.js         CLASS_DEFS, ENGINE tuning, WAR, rank tables, NP_TYPE, BATTLE_K, STAT_FX, VOICE_SLOTS, GRADES
  rank.js           Rank string ("A+", "C~A", "B(狂化時A)", "-", "EX") → numeric object
  parser.js         Wiki markup → structured servant (parsePage, parseServant, finalize, parseClass)
  effects.js        Effect primitives + descriptions, skill dictionary, keyword rules, override tables, resolveSkill/resolveNP
  fgoskills.js      GENERATED by tools/chaldea.js (FGO skill name → effects); do not hand-edit
  build.js          Parsed servant → game servant (scores, effects, power); toLean/fromJSON; battleOdds
  master.js, war.js, names.js, scenes.js, personas.js   Masters / composeWar / narration pools & places / scene fallbacks / personalities
  engine.js         The simulation (generator)
  data.js           Loading published data, browser-local roster, user-picked files
  survival.js       Survival curves: many auto wars → per-servant elimination days; roster fingerprint
  singdata.js       Singularity text: name words (3 lists), CITY_TEXT (one region per line), places, mobs, sg* LINES
  singularity.js    Singularity mode: compose (name + lineup), engine plugin, prepareBoss (§7.11)
  simlab.js, simworker.js, voiceedit.js   roster.html "聖杯戦争で試す" core + worker; per-scene voice editor
tools/              servant.js (per-servant CLI), kagemiya.js (fetch pages), incoming.js (apply uploads), datadiff.js, survival.js, datalib.js, chaldea.js
.github/workflows/  kagemiya.yml (import by name → PR), data.yml (apply uploads, check, rebuild survival, diff PR), data-cleanup.yml
test/               Plain Node scripts (§9)
```

---

## 4. Data pipeline

```
wiki text ─parsePage→ {info, sections, items} ─parseServant→ parsed servant ─finalize→ ─buildServant→ game servant ─toLean→ published JSON
published JSON ─fromJSON→ (re-parse class, finalize, buildServant)      ← done at every page load
```

The game **always rebuilds from lean data at load time**, so improving parser rules, the skill dictionary or `CLASS_DEFS` applies to
every previously imported servant. Stored `rank` objects (stats, skills, NPs) are used as-is at load — only content-override items are re-parsed (`mkSkill`/`mkNP`) — so hand-written JSON must carry them (`tools/servant.js add` fills them in).

### 4.1 Wiki page format

Seesaa markup with `【key】value` info lines (`【CLASS】 【真名】 【ステータス】筋力：D　耐久：C …`), sections `*【クラス別スキル】 *【保有スキル】
*【宝具】 *【解説】 *【人物・性格】 *【因縁キャラ】 *【セリフ】` (items as `**name：rank` + description lines; NPs as `**『name』` +
`ランク：A　種別：対城宝具　レンジ：1～99　最大捕捉：1000人`). Pages deviate often; the parser is deliberately tolerant (`SECTIONS`,
`INFO_KEYS`, `PROFILE_KEYS` in `parser.js`).

- `stripMarkup` → `tidy` clean ruby (kept as base text in descriptions, but the **reading** of NP/weapon headings), footnotes, fold markers,
  `&ref`/decorations, entities, tables. `tidy` is idempotent and also runs at every load (`finalize` → `tidyAll`), so old data is cleaned without re-import.
- `【FGO風性能】`-style blocks are not game data: `parsePage` skips them, and `finalize` → `cleanItems` removes FGO items/chant lines from old data.
  Everything dropped is recorded in `sv.skippedItems` (`{ list, name, why }`) and shown in the roster and PR body.
- Relations are read by `collectRelations`; published relations only change on a re-import.
- Fetching by name (`tools/kagemiya.js`, run from Actions because Seesaa sends no CORS headers): EUC-JP percent-encoded page URL, 1.5 s between requests;
  imported servants get `page`. Tests: `test/markup.js`, `test/fgo.js`, `test/kagemiya.js`.

### 4.2 Rank object (`rank.js`)

`parseRank(raw)` → `{ raw, base, plus, minus, step, score, mult, burst, range, alt, unknown, none }`. `score` interpolates `RANK_SCORE` (NPs, Masters);
**servant stats are rescored with `STAT_SCORE`** in `buildServant`. `mult` (from `RANK_MULT`) scales effect magnitude; `range` ("C~A") is rolled once per war;
`alt` holds "B(狂化時A)"; unreadable stats become `MISSING_STAT` ("C") and appear in `review`. Always `R.normalize()` text first (full-width → half-width).

### 4.3 Servant object (lean JSON)

`kind:'servant', id ('<classKey>:<trueName>'), trueName, aliases, class {key,label,raw,standard,sub}, origin, sex, alignment, attribute, traits,
stats {str,end,agi,mag,luk,np: {raw, rank}}, statsAlt, classSkills/skills [{name, rankRaw, rank, desc}], nps [{name, reading, rankRaw, rank,
typeRaw, typeKey, rangeRaw, range, maxRaw, maxTargets, desc, mode, modeBasis}], weapons, profile, relations [{name,text}], voice {heading:[lines]},
text {commentary, personality, comment, …}, info (all 【key】 pairs), warnings, body, sourceText (wiki original), page?, pageMissing?, skippedItems?`.
Derived fields added by `buildServant` and stripped by `toLean`: `ranks, score, statSource, tags, allSkills, effectSummary, power, npPeak, review, reviewDone, contentEdited`, and per-item `effects, effectSource, matched, attack*, power, cost, exposure, …`.
Derived `attrs` (`E.resolveAttrs`: traits mapped through `ATTR_MASTER`/`ATTR_OF`; `attrsUnknown` = spellings not in the master) feed `sv.tags`; an attribute `ボス専用` sets derived `sv.bossOnly`, which keeps the servant out of Holy Grail Wars (engine roster filter, `survival.fingerprint`, index/ranking loaders) and makes it a singularity boss candidate (`singularity.bossFromRoster`; a roster boss replaces a same-named `bosses.json` boss in place). `B.leanFromSpec` turns a `bosses.json` entry into a lean servant + override entries.
Identity = `class.key + trueName` (+ `#key` when the servant has a `key`, see below); later files win. `key` (5 chars, optional, stored in lean data) tells apart servants that share a true name — same class or different class. It is set **once at import time** (never at load, so ids stay stable and determinism/survival are untouched): `B.keyFor(sv, list)` / `B.assignKey(sv, list)` give the later servant `keyFromPage(page)` (hash of the wiki page name, so a re-import of the same page gets the same key; random only when there is no page), and a re-import of the same page inherits the existing key. `E.okey(sv)` (`'trueName'` or `'trueName#key'`) and `E.idOf(sv)` build the override-table key and the id — **always use them instead of `sv.trueName` when reading/writing override tables** (`B.wikiKey(sv)` for `content`). Servants without a key behave exactly as before. The browser roster may also hold `_wiki` (see 4.5).

### 4.4 Data files

`manifest.json`: `{ "servants": ["servants.json", "packs/x.json"], "overrides": ["overrides.json"], "masters": [], "bosses": ["bosses.json"] }` — all listed packs load (duplicates by id: last wins);
overrides merge in order; `masters` are JSON arrays of fixed-Master specs (each camp has a 50% chance to draw from this pool, §7.4); `bosses` are returned raw by `loadPublished` (built by `singularity.prepareBosses`).

`hgw-servants`: `{ format, version:2, lean:true, at, servants:[…] }`. `hgw-overrides`: `{ format, version:2, global, servant, stats, np, content, pages, reviewed }`;
`E.OVERRIDE_TABLES` maps these names to tables (data.js, kagemiya.js and roster.html all use it — add new tables there):

| Table | Key → value |
|---|---|
| `global` → `SKILL_OVERRIDES` | `'skillName'` → `[[effectId, factor, params?], …]` (all servants) |
| `servant` → `SERVANT_OVERRIDES` | `'trueName/skillOrNpName'` → specs (`[]` = no effects) |
| `stats` → `STAT_OVERRIDES` | `'trueName'` → `{ str:'B', … }` |
| `np` → `NP_OVERRIDES` | `'trueName/npName'` → `{ attack?: bool, mode?: ''｜always｜start｜win｜lose｜pinch｜lethal }` |
| `content` → `CONTENT_OVERRIDES` | `'wikiTrueName'` → `{ skills?, nps?, voice?, text?, profile?, relations?, identity?, base }` (4.5) |
| `pages` → `PAGE_OVERRIDES` | `'trueName'` → kagemiya page name (when the title differs from the true name), **or an `http(s)://` URL** = a non-kagemiya link (`B.linkOf`); such servants, and lean servants with `manual: true` (made from scratch in roster's 「英霊を一から作る」, `leanFromSpec({ plain: true })`), are skipped by `kagemiya.js refresh` (`B.isManual`) |
| `reviewed` → `REVIEWED` | `'trueName'` → review sigs the owner checked off; items whose `B.reviewSig` matches go to `sv.reviewDone` and are ignored by counts/filters; a changed rank/description/reason makes a new sig |
| `attrs` → `ATTR_MASTER` | `'attrName'` → `{ aliases: [raw spellings], note? }` — the attribute master (Wiki 特性 / その他属性 are spelled inconsistently). `E.BOSS_ATTR` (`ボス専用`) always exists |
| `attrOf` → `ATTR_OF` | `'trueName'` → `[attrName…]` — per-servant assignment replacing the Wiki traits (absent = Wiki traits read through the master) |
| `boss` → `BOSS_PARAMS` | `'trueName'` → `{ label?, gauges?, power?, guard?, mana?, regen?, heal?, find?, intro?, aoe?: { npName: v } }` — singularity boss settings for a `bossOnly` servant |

Overrides embedded in an exported servant JSON (`effectSource: 'override'|'servant-override'`, `_wiki`) are harvested back into the tables on load (`harvestOverrides`) without overwriting existing entries.

### 4.5 Uploads and content overrides

**Uploads.** The owner drops files into `data/incoming/` (any name); `data.yml` runs `tools/incoming.js`, which classifies each file **by content** and opens a PR
(`data/upload-N`) whose body is the `datadiff.js` report. Order: `hgw-overrides` (replaces overrides.json; only the newest is used) → servant lists (largest first) → `.txt` wiki
pages (`=====` separates pages). A list exported by roster's 「公開用に保存」 carries `patch: { base, add, upd, del }` (the browser's own changes since its last sync, by wiki id): only those servants are
added/replaced/removed and everything else stays as published, so servants imported by Actions after the browser synced are neither dropped nor reverted. Without `patch`, a list holding ≥ 80 % of the current ids **replaces** the list (missing servants are named in the report), otherwise it upserts by id; lean packs are taken
verbatim, full exports go through `harvestOverrides` + `toLean(fromJSON())`. Within one kind files apply **in upload order** (`git log` time, fallback the browser's 「(N)」 number, numerically).
Requests/records/survival files are left in place. The workflow then runs `test/sim.js 40` + `test/fgo.js`, rebuilds `survival.json` when `tools/survival.js --check` fails, and commits only the
rebuilt survival to main when data was replaced directly. `data-cleanup.yml` removes the files of an upload PR closed without merging. Details: `docs/DEVELOPER.md`.
**The owner sometimes uploads `data/servants.json` directly to `main`; always branch from the latest `origin/main` and never overwrite data files you were not asked to change.**

**Content overrides** (`build.js` `applyContent`, edited in roster's 「内容を編集」): each present section replaces the wiki value wholesale (`skills: [{group, name, rankRaw, desc}]`, `nps`, `voice`, `text`, `profile`,
`relations`, `identity {trueName?, cls?}`); keyed by the **wiki** true name (`B.wikiName(sv)`) while all other tables use the displayed name. `base[section]` = hash of the wiki value at edit time (a later wiki
change raises a `content` review item). `buildServant` stashes replaced wiki values in `sv._wiki`; **`toLean` restores them, so the published `servants.json` always holds wiki values and edits live only in `overrides.json`.**
Effect overrides stay keyed by skill name, so renaming a skill detaches its effect override.
**Overrides are keyed by `E.okey(sv)`** (true name, plus `#key` for keyed servants). A same-named servant from another wiki page or another class gets its own `key` on import (`kagemiya.js`, `incoming.js` upserts, `servant.js add`, roster `upsert`), so it no longer inherits the old one's overrides. Only a servant that still has no `key` shares overrides with an unkeyed same-named one (`servant.js check` warns about that); `kagemiya.js` lists leftovers in the PR body when a re-import of the *same* entry changes page or class; clear them with
roster's 「この騎の手直しをすべて消す」 or `tools/servant.js wipe`. Keep derived, override-dependent fields (e.g. NP `mode`/`modeBasis`) in `ITEM_DERIVED`: anything override-dependent in lean data makes the
roster count phantom local changes, which then overwrite the published side on export.

### 4.6 Working with `servants.json` (do not read it whole)

`data/servants.json` is ~1.2M characters (129 servants, ≈10k chars each). Most of that is wiki text (`text`, `sourceText`, `info`, `voice`) and derived rank objects that the game rebuilds anyway.
Use `tools/servant.js` instead of reading the file; its **core** view (identity, stats, skills, NPs, weapons) is ≈ 1.7k chars per servant.

```bash
node tools/servant.js index [--grep 語] [--names]            # one line per servant: id, stats, counts, chars (cost of printing it fully)
node tools/servant.js show ルーカン                          # core view (default); also: --part core,text,voice,profile,relations,meta,source | --all
node tools/servant.js add one.json [more.json …] [--dry-run] # add/update individual servant JSON in servants.json
node tools/servant.js remove 名前 [--dry-run] [--keep-overrides]  # delete from servants.json AND every pack, plus leftover override entries
node tools/servant.js wipe 名前 [--dry-run]                   # clear only that servant's overrides (content/identity, servant, np, stats, reviewed; keeps pages and global)
node tools/servant.js check                                  # structure + every servant rebuilds; exit 1 on errors
```
`--data <dir>` points all commands at another data folder (tests, scratch copies).

- **Edit loop:** `show` → edit the JSON → `add`. Only the keys you provide are replaced; everything else (voice, text, sourceText, …) stays byte-for-byte, and an unchanged input reports 「変更なし」 without touching the file.
- **New servant:** `trueName`, `class` (string or object) and `stats` (`{ str, end, agi, mag, luk, np }` as rank strings) are required; skills/NPs take raw fields (`name, rankRaw, desc`; NPs also `reading, typeRaw, rangeRaw, maxRaw`).
  Ranks, `typeKey`, `range` and the id are derived. The report prints power / NP peak and the review items (要確認) the game will show.
- **Deleting** goes through `remove`, not through uploads: `incoming.js` only *replaces* the list when the upload holds ≥ 80 % of the current ids, otherwise it upserts and never deletes. `remove` also clears the servant's entries in the override tables
  (`servant`, `np`, `stats`, `content`, `pages`, `reviewed`) and warns when a file left in `data/incoming/` would bring it back.
- `add` applies `overrides.json` while rebuilding (like the game) but never edits it, keeps the list sorted (class order → name) and the file format identical to `incoming.js`, so diffs stay small.
- Prefer **overrides over editing `servants.json`** for effect/stat/NP-mode fixes (§10). After a data change run `node tools/survival.js` (or let `data.yml` do it on push).
- Known data defects `check` reports: one record has an empty `trueName` (a page without 【真名】), several lack the `np` stat (loaded as `MISSING_STAT`).

---

## 5. Effects system (`effects.js`)

The engine understands only fixed **effect primitives**; every skill and NP is mapped onto them. **Effect spec** (used everywhere): `[effectId, factor = 1, params?]`;
magnitude `mag = base × factor × rank.mult` (`fixed` → no rank mult; `byRank` → table; unknown rank ×0.8).

### 5.1 Primitives (`EFFECTS`, each with `base`, `unit`, optional `fixed`/`byRank`/`trig`)

| Phase | IDs |
|---|---|
| battle | `power`, `power_vs`(`params.tag`), `debuff`/`debuff_mind`/`debuff_body`, `wither`, `crit`, `pierce`, `sure_hit`, `dmg_plus`, `instakill`, `evade`, `initiative`, `charm`, `rally`, `taunt`, `anti_master`, `mental_guard`; ailments `poison stun confuse seal skill_seal` + `ail_guard`; instants `heal drain_hp mana_gain drain_mana strip cleanse self_strip` |
| damage | `guard`, `magic_guard`, `dmg_cut`, `dodge`, `counter`, `weakness`, `master_guard` |
| lethal / encounter / scout / retreat | `guts` / `stealth detect reveal conceal` / `intel` / `escape pin` |
| day / upkeep / talk / master / passive | `regen heal_other territory craft resource uncontrolled` / `upkeep_down upkeep_up solo` / `negotiate` / `cs_resist master_buff` / `luck tag` |
| np | `np_boost np_charge np_cost backfire self_retire disabled` |

`E.EFFECT_GROUPS`/`GROUP_OF` group them into genres for the editors. `test/effects.js` fails if a primitive is not read by engine/build or lacks an `EFFECT_INFO` description (`E.describe` text must also read correctly for a **negative** magnitude).

- **Triggers** (`params.on`): `''` always, `start`, `round`, `win`, `lose`, `hit` (just before taking a lost exchange's hit), `pinch` (hp < `pinchAt`, once), `np`, `kill`, `day` (every morning).
  Extras: `params.cost` (mana per activation), `params.uses` (max per battle), `params.chance`. **Instant** ids (`E.INSTANT`) act on the spot (default trigger via `E.trigOf`); other triggered effects go to `c.temp`
  (battle), `c.dayTemp` (`day`, until next morning), or `c.carry` (`kill`, until the end of the next battle). NP effects without `on` fire at use; with `on` they are armed after the NP is used.
- **Self-inflicted** (`params.self`, only `E.SELF_IDS`): the effect hits its holder and cannot be resisted (drawbacks, servants that weaken over time).
- **Conditions** (any effect, combinable): `params.cond` (`水辺 森 山 夜 拠点 瀕死`), `params.vs` (opponent tag), `params.chance` (rolled once per battle at start). Engine: `condOk(c, params, terrain)`; without a passed
  terrain it falls back to the current battle's, then the base's. `c.bx = { opp, home, rolls }` exists only during a battle.
- `E.describe(effect, { np, attack, npMode })` → `{ name, who, whoJa, bad, when, text }` for roster/submit; `fx` must state what the engine actually does.

### 5.2 Skill resolution (`resolveSkill`)

1. `SERVANT_OVERRIDES['trueName/skill']` → `servant-override`. 2. `SKILL_OVERRIDES['skill']` → `override`. 3. rank "-" and the description says the skill is lost/merged → `lost`.
4. `SKILL_DICT` exact or base-name match → `dict` (variants like 「黄金律(体)」 also add keyword effects from the text; explicit references such as 「直感と同等」 are added at ×0.6; shared suffixes
   such as 〇〇の神核/叡智/武練/加護 are `GENERIC` partial-match bases). 5. Text analysis: partial dict match + references to other known skills (`compoundSpecs`, ×0.6) + per-sentence keyword `RULES` →
   `dict-partial`/`compound`/`keyword` (ordinary-word names in `GENERIC` take this path even on an exact match). When two sources give the same effect, the larger factor wins.
6. Nothing found → `G.FGO_SKILLS` (same name in FGO) → `fgo`, else `[['power', 0.3]]` → `default`.
Anything not from an override or exact dict hit is added to `review` (shown as 要確認).

### 5.3 NP resolution (`resolveNP`)

- Type from 種別 text → `NP_TYPE` key (`anti_unit anti_army anti_fort anti_nation anti_world barrier self special`) with `power`, `cost`, `exposure` multipliers.
- Attack or support: `NP_OVERRIDES` → disabled → self-type → non-attack wording → attack wording (`ATTACK_WORDS`) → barrier → support effects → otherwise guessed attack. On attack NPs, text-derived `power` effects are dropped
  (hand-set ones are kept). `power = rank.score × type.power`; `cost = type.cost × rank.mult × (1 + np_cost)`; `exposure` = chance that use reveals the true name (≥ 1 makes it public). `self_retire`, `backfire`, `disabled` are read from text.
- **NP modes** (`np.mode`, `NP_OVERRIDES[key].mode` wins, else `ALWAYS_WORDS` on a non-attack NP gives `always` + review item): `''` AI chooses; `always` = never "used", effects counted like a skill (scaled by `ENGINE.npAlwaysScale`) and extra
  daily upkeep (`npAlwaysUpkeep`); `start/win/lose/pinch/lethal` = fired automatically once per battle at that moment for `npAutoCost` × cost (`autoNP` in the engine; automatic attack NPs queue for the next round's head).

### 5.4 Summary and power (`build.js`)

`effectSummary` sums effects per `id[:tag|stat][@cond][>vs][%chance][#name][^self]` → `{ passive, onNP, from[] }`. `combatPower = weightedMean(str,end,agi,mag,luk scores; STAT_W × classWeights) × (1 + Σpower)`;
`npPeak` = strongest usable attack NP power × (1 + np_boost) × `npStatMult`; `battleOdds(a,b,opts)` is the quick logistic estimate used by roster/ranking/opening (not by the engine; keep it consistent with engine changes).

---

## 6. Classes and war composition

`CLASS_DEFS` in `config.js` is the single registry (`label`, `aliases` matched as substrings against the wiki 【CLASS】 field, `slot` `'standard'|'extra'`, optional stat `weights`, `tags`, `upkeep`). Unmatched classes become `extra` with the wiki's own label.
**To add a class: add one entry** — old data is reclassified on load. `composeWar` (`war.js`, `CONFIG.WAR`) fills the 7 standard slots; with `extraChance` one slot is taken by an extra-class servant (`fillWith` decides when a class has no
candidates); duplicate class labels get （一）（二）. `war: { pick: 'open' }` draws 7 distinct servants ignoring classes; `{ extra: false }` removes extra classes entirely.

---

## 7. Engine (`engine.js`)

### 7.1 API

```js
const out = {};
const gen = HGW.engine.warGen({ roster, seed, ask: 'big', masters, out /*, player, engine, war, city, playerName */ });
let r = gen.next();
while (!r.done) r = (r.value.type === 'tick') ? gen.next(focusKey) : gen.next(optionKey /* or 'auto' */);
const result = r.value;                                                       // also merged into `out`
const result2 = HGW.engine.runWar({ roster, seed, focus: day => 'auto' });    // fully automatic
```
`player`: camp index, `'none'` for observer, default random. `ask`: `'never'` = no decisions yielded. `playerName`, `playerSex` (`'男'|'女'`) and `playerAge` (10–99) fix the player Master's name/sex/age without any `rnd()` call (changing the sex of a randomly named Master re-picks the given name by a seed hash). `out` fills live with `entries, meta, city, seed, camps`.
Yields `{ type:'tick', day }` (answer with a `FOCUS` key) and `{ type:'decision', kind, day, phase, title, body, note, options:[{k,label,sub}], camp }` (unknown answers such as `'auto'` → the auto policy decides and the log says 「おまかせ」).
**All decisions go through `ask()`** so the player can be offered them and replays stay deterministic; only the player's non-retired camp actually yields. Exports: `HGW.engine = { runWar, warGen, makeRng, POLICIES, FOCUS }`.

### 7.2 Turn structure

```
prologue: compose war, create masters (+persona), assign policies, log summons
for day = 1..maxDays (30):
  yield tick → player focus
  dayPhase: pacts dissolve when alive ≤ allianceBreakAt; AI betrayal; world event; council for the player every councilEvery days;
            per alive camp: stray handling, uncontrolled wandering, day action (scout|fortify|rest|ally|hide; focus overrides), player's life event;
            upkeep (mana regen − upkeep × upk(c); a shortfall goes through drain() into the Master's HP)
  checkFallen
  nightPhase (skipped on festival nights): each camp decides to hunt → picks a target → find roll → battle at the target's base if it stayed home → checkFallen
  stop when ≤ 1 servant alive
end: win (1 alive with a living Master, or a stray with solo days left) / wipe (0 alive, or the last servant has no Master and no solo days) / draw (time out)  → result.ending
```
Camp ids are array indices; knowledge is per camp (`known(c)`, `nm/sn/mn` text helpers). Camp state keys: `sv (deep copy; ranges rolled), master, hp, mhp, mana, cs, alive, masterAlive, soloLeft, inChurch, retired, base, workshop, ally/pact, policy, focus, stance, bond, knowName/knowLoc/knowPersona, clues, kills, temp, …`.

### 7.3 Masters, policies, personas, focus

- **Master** (`master.js`): `createMaster(spec, rnd)` uses every field of `spec` as-is and rolls missing ones from the **origin** (`ORIGINS`: noble, newblood, mercenary, civilian, irregular, or a custom label). Stats accept rank strings or 0–100.
  `parseMasterText` reads wiki-style master pages; spec may include `persona: '<key>'`, `skills`, `custom`.
- **Policy** (`POLICIES`): aggressive, defensive, intel, diplomacy, balanced; chosen at start by `autoPolicy`. **Persona** (`personas.js`): additive biases `hunt, retreat, ally, np, ambush, betray, cs`, plus `bond`, `policy`, `origins`, `reveal`; read via `perv(c, key)`.
- **Focus** (`FOCUS`, player only, effective next morning): `auto attack defend scout rest hide ally`, one-char codes `o a d s r h l`; each fixes the day action, night hunting and battle stance.

### 7.4 Battle (`battle`, up to `rounds` = 4)

Battle start: participants pay `battleMana`; a stored item may be used; `initiative` may give `surprise`; an **opening NP** (`openingNP`) may be fired at the head of round 1. Per round: retreat-stance disengage → each side may use an NP
(`useNP` = activation roll + weighted pick; `fireNP` pays, applies, may reveal the name) → `power(c, o, ctx)` (combatPower × temp power × special-attack/weakness × defence × opponent debuff × territory × knows-name × hp factor × stance × seal boost × surprise + npBoost, ×(0.9–1.1) noise)
→ winner by logistic `p = 1/(1+exp(-(ea-eb)/BATTLE_K))` → `instakill` or damage (`dmgBase`+var × advantage, crit, guard reduction, then `dmg_plus − dmg_cut`; the exchange winner also takes `counterDmg` back; a winner at ≤ 0 hp goes through `lethal()` too → mutual kill)
→ HP ≤ 0 → `lethal()` (`guts`, else command seal decision `cs`, else `servantDown`) → rare **master strike** → retreat check for the weaker side.

Rules worth knowing before changing anything here:
- Defence-type sources (guard, evade, magic_guard, mental_guard) are summed per effect first, then softened by `B.softDef(x) = x/(1 + x·defSoft)`, weighted and capped; different categories multiply. `battleOdds` uses the same formulas.
- **Shared buffs**: when a side has 2+ fighters (ally helpers, singularity front), `shareTeam` copies each member's passive effects with `params.team` (0–1, ids in `E.TEAM_IDS`, editor field 「味方にも効く」) into the others' `c.temp` at magnitude × team, and `rally` gives the others `power` = rally × `ENGINE.rallyPower`. Lone fighters are unaffected. `knowNameMult` is the true-name edge.
- **Ailments** (`E.AILMENTS`, caps `E.AIL_CAP`): `tryAil` rolls min(cap, Σmag) (no `rnd()` for holders without one) then the target's `ailResist`; ailments never kill (hp floors at 1). Debuffs come in kinds (`debuff_mind` resisted by mind, `debuff_body` by end/magic_guard, plain `debuff`), capped at 0.5 total; `wither` stacks, persists, fades by `witherFade`.
- **Triggers** (`fireTrig(c, o, on, T)` → `applyTrig`) hook into battle start, each round, after each exchange, `fireNP`, and each morning; battle-scoped state (`tUsed, tLog, armed, pinched, cleanse, off, ail`) is reset in `cleanup`/`leave`/day end.
- **Stat roles** (`CONFIG.STAT_FX`, `d = B.statDev(score)`, C≈0, A≈+1): 筋力 damage dealt, 耐久 damage taken/guts, 敏捷 retreat and night finding, 魔力 NP cost and NP power, 幸運 crit/instakill/guts; Master 魔術/精神/幸運 smaller effects. None of these add `rnd()` calls.
  The 宝具 stat is an appraisal only and is **not** used in combat. If a stat's role changes, update `TIPS` in `index.html` (texts contain **no numbers or formulas**).
- **Alliances** (`c.pact`, up to `allianceMax` camps, `canPact/formPact/leavePact`): allies may join a fight (`joinAlly`, one helper), run **joint operations** (`pactOps`), support each other each morning (`pactSupport`), and a **coalition** forms against a kill leader (`leaderOf`).
- **Mana**: `upk(c)` = class upkeep × upkeep effects; `drain(c)` converts a shortfall into Master HP, then a command seal, then `masterDown`; `wildOf(c)` (berserker/uncontrolled) ignores the low-mana penalty.
- After battle: attacker learns the defender's base; persona reveal; chance to learn the true name; related servants (因縁) know each other.

### 7.5 Defeat and the player's fallen flow

`servantDown` marks death, breaks pacts, makes the name public; AI Masters go to the church or vanish; a dead Master's Servant becomes a **stray** (`soloLeft = floor(eff(solo))` days) and may **recontract** (`recontract`/day).
Player's Servant dies: with `fallenDeath` the Master dies too (game over); else decision **`fallen`** (`watch`, `skip`, `stray:<id>`, `steal`). Player's Master dies: decision **`gameover`** (`watch`/`skip`), camp `retired`.
`contract()`/`moveYou()` move the player's identity between camps; when the player's dead Master's Servant is taken by *another* Master, `releaseYou` clears `c.you` and sets `result.youTaken` (`test/taken.js`).

### 7.6 Big decisions (all through `ask`)

| kind | when | option keys |
|---|---|---|
| `council` | every 5 days, player alive with Master | `assault:<id>`, `boost`, `move`, `ally:<id>`, `betray`, `deduce:<id>`, `familiar`, `recover`, `pass` (max 3 + pass) |
| `cs` | servant about to die, seals left | `escape`, `rally`, `none` |
| `ally` / `recontract` | another camp proposes / a stray seeks a Master | `yes`, `no` |
| `event` | bounty / enemy Master spotted / rumor | `join`,`ignore` / `talk`,`follow`,`ignore` / `chase`,`ignore` |
| `fallen` | player's servant died | `watch`, `skip`, `stray:<id>`, `steal` |
| `gameover` | player's Master died | `watch`, `skip` |

`<id>` is the **camp index** (0–6). Option keys are persisted in the URL for replay — **never rename existing keys; add new ones.** The church **never** reveals true names (owner's design decision): names are learned by deduction, NPs, scouting, battle insight, relations, alliance or conversation.

### 7.7 Events, narration, voice

- **World events** (`worldEvent`) and **life events** (`lifeEvent`, player camp only; they raise bond) are weighted keys; rates are in `CONFIG.ENGINE`. New event → weighted key + `log()` + (if the player chooses) `ask()`; text in `G.LINES`.
- **Narration variants**: `G.LINES` in `names.js` (key → templates with `{S} {M} {city} …`). `line(key, vars)` picks one by an FNV hash of `seed:lineN:entries.length` — **not** `rnd()` — so adding or editing variants never changes a war's outcome. Only the vars a call passes are available.
- **Voice lines**: `sv.voice` is `{ wiki heading: [lines] }`; the game reads it only through **scenes** in `G.VOICE_SLOTS` (`{ key, aliases, use }`) via `G.voiceLines/voiceHeadings/npVoiceLines`. `say(c, [keys])` picks by hash (`vpick`), never `rnd()`, so editing lines never changes the outcome
  (only the *presence* of 会話/聖杯について/好きなこと/嫌いなこと/絆 matters: it enables life events). New use → add/reuse a slot; `test/voice.js` fails on unknown keys.

### 7.8 Log entries and result

Entry: `{ day, phase, kind, text, ids, you, quote?, big?, head?, place?, scene?, weather?, fin?, q?, dk?, auto?, snap }`; kinds: `prologue summon dayhead day night battle np cs death event world life scout ally council choice quiet end`.
`fin` (battle deaths): `{ by, how: 'np'|'np-earlier'|'instakill'|'blow', np }`. `snap` is a per-camp snapshot from the **player's knowledge view** (unknown names/personas are null) and is copied into every entry — keep it small and JSON-serialisable.
`out.meta[campId]` holds static display info (filled without `rnd()`). Result: `{ seed, city, days, you, winner, ending ('win'|'wipe'|'draw'), camps:[…], entries, youTaken? }`.

### 7.9 Survival curves (`survival.js`)

`HGW.survival = { fingerprint, empty, tally, runner, curveOf, overall, median }`. `runner` runs auto wars (`player:'none'`, default settings, seeds `sv0, sv1, …`) and counts each camp's elimination day (first snapshot with `alive:false`).
Format `{ format:'hgw-survival', version:1, fp, wars, days, seedBase, servants:{ '<class>:<trueName>': { n, w, d:[…] } } }`. `fingerprint(roster)` (hash of ids, power, npPeak in roster order) must equal the UI's `rosterFp()`.

### 7.11 Singularity mode (test feature: `singularity.js`, `singularity.html`)

Party of 6 (3 front + 3 reserve, one Master, **shared** mana pool / seals / items) vs 7 grail-summoned foes, then a boss; clear = boss down; fail = wipe, Master death, or `SING.maxDays`.
Tuning: `CONFIG.SING`. Text and name material: `singdata.js` (lines are registered into `G.LINES` with `sg*` keys).
- **Engine plugin.** `warGen({ sing: plugin })` hands setup and the main loop to the plugin: `init(tools)` → `{ city, places, camps, you }`, `snap()`, `aoeOf(c, np)`, `hooks` (`drain, down, masterDown, gauge, seal*, focus, lineup`) and `run*(api)` (getters/setters for `day/phase/tonight` plus `battle, lethal, ask, log, line, eff, …`).
  Every hook sits behind `if (SG)`; with `opts.sing` absent the engine is byte-for-byte the old one (verify by hashing many `runWar`/`warGen` logs against `origin/main`).
- **Battles** reuse `battle()`: `ctx.helpA/helpB` may be arrays (front-line mates, extra foes, the stray); `c.assistK` scales a helper's assist (`SING.frontAssist`, stray × `strayAssist`); `c.noMaster` blocks master strikes on foes;
  `ctx.lines` swaps the clash/retreat/dawn line keys for day fights; AoE NPs (`SING.aoe` by NP type, or the boss data's `aoe`) splash damage to the losing side. Party camps share `knowName/knowLoc/clues` and expose Master fields through accessors to the pool `P`.
- **Bosses**: `prepareBoss(spec)` registers inline `effects` in `SERVANT_OVERRIDES['name/skill']`, `attack`/`mode` in `NP_OVERRIDES`, sets `sv.bossOnly` (+ trait ボス専用). `warGen` drops `bossOnly` from the roster, so bosses never enter Holy Grail Wars.
  `boss.gauges` = break gauges (`hooks.gauge` refills HP in `lethal`). Without boss data (or by chance `SING.empower.chance`) a roster servant is empowered instead.
- **compose** (`{ roster, bosses, seed, picks }`) uses its own RNG streams (`seed+':名'`, `seed+':顔ぶれ'`), so picking servants does not change the name. `picks = { party: [id|null ×6], foes: [id|null ×7], boss: id|'empower'|null }`.
- **Tick answers**: a focus key (`FOCUS`: auto advance search stealth rest defend) or `{ f, cmds }` with `cmds` `{k:'heal',t}` / `{k:'mana'}` / `{k:'guess',t,sv}` (applied next morning; guess once a day, only foes met).
  **Decisions**: `cs` (`heal`/`none`), `wipe` (`revive`/`give`), `council` (`deduce:<id>`, `recover`, `familiar`, `swap`, `pass`), `stray` (`yes`/`no`). Never rename these keys (URLs).
- **URL**: `?seed=&fr=<front idx .>&d=<days>&pt=&en=<roster idx base36 . per slot>&bs=<boss idx|e>&f=<focus codes>&c=<answers .>&k=<cmds _: {day}h{camp} | {day}m | {day}g{camp}-{rosterIdx36}>`.
  Extra params: `ex=<excluded roster idx base36 .>`, `p=open`, `x=0` (same meaning as the Holy Grail War page; plus `bm=b|e` = boss lottery `boss` only / `empower` only, absent = `both`, `compose({ bossMode })`, which only affects the unpicked boss seat; `compose({ war })` takes `{ extra:false, pick:'open' }`), `n=<player name>` (passed as `playerName`), `sx=m|f` / `ag=<age>` (`playerSex` / `playerAge`), `dy=<last advanced day>` (a link with `dy` is caught up instantly without animation, then paused). Roster indices (`pt/en/ex/k`) are over the **whole** loaded roster, the exclusions are applied afterwards.
  The page keeps `hgw.sing.save.v1` (one suspended run), `hgw.sing.history.v1` (finished runs, query strings only; `keep` entries are protected), `hgw.sing.settings`, `hgw.sing.exclude.v1`; export file `{ format:'hgw-sing-records', version:1, history, save }`. `out.meta[0].master` carries the Master's sex/age/origin/persona/wish for the detail dialog. `hgw.sing.settings.last` = name used by the latest new run (「前回の名前」); `hgw.sing.focusCollapsed` = focus panel folded.
  UI on `singularity.html` that mirrors `index.html`: the **opening** (Master intro with name field → party appraisal S–E via `gradeMap` → first focus; shown only for new runs, never for replays/`dy` links; renaming rebuilds the generator through `makeGen()` with the same seed, no `rnd()` involved), the servant detail dialog doubles as the lore dialog (pauses playback while open), result-card PNGs (`result` / `party` / `both`, drawn on canvas, same helpers as `index.html`), the foldable focus panel, and a phone layout (≤ 820px): sticky `#strip` (Master bars, seals, party pips, foes left, focus chip → `#focusSheet`; filled by `renderStrip`), one-button speed cycle, ⋯ menu (auto / CSV / quit / stop on front death or command seal, `hgw.sing.autostop`), panels reordered with CSS `order` (scene → log → party → foes → Master → orders), `data-fold` panels folded by default (`hgw.sing.folds`) and the log trimmed to 8 entries until `#logMore`. None of these change the war's outcome or the URL format.
- Enemy labels are `<lineup.tag>の<class>` (tag = the city or one of the name words, chosen in `compose`). `heal_other` heals every other ally each morning (`SING.healOther`). Singularity passes `engine: { knowNameMult: SING.knowNameMult }`; `leadEdge`/`campEdge`/`restRaid` reward 索敵→進軍, 陣地 and 休息.
- Test: `node test/singularity.js [N] [seed] [--focus=k] [--set=key:v,boss.power:v] [--smart]` (errors, ending ratios incl. clear rate, interactive replay check, bosses never in wars).

---

## 8. UI (implementation notes live in `docs/DEVELOPER.md` and the code; this lists the invariants)

- **Data loading**: `HGW.data.loadPublished` reads `data/manifest.json`; `?data=local` uses the roster tool's browser storage; on `file://` the user picks JSON files.
- **index.html** (briefing → watching, `body.watching`): the generator runs ahead and `out.entries` are replayed with per-kind delays divided by speed. The **opening** (Master intro, servant rating, first focus) runs before day 1 for new wars; the servant rating
  (S–E, `H.gradeOfPct`, `G.GRADES`) is the mean `battleOdds` against the roster, and the recommended first focus `REC_FOCUS[grade]` must be re-measured with `node test/focus.js` after balance changes.
- **War settings** (length `d`, pick `p`, extra `x`, excluded servants `ex`) change the war, so they live in the URL, in the save and in records (part of `recordSig`); the player's name (`n`), sex (`sx`) and age (`ag`) (all in the URL) and 一言 (`w`, never in the URL) do not change the war and are not part of `recordSig`.
- **URL state**: `?seed=&view=you|all&c=<answers joined by '.'>&f=<focus codes per day>[&data=local][&d=][&p=open][&x=0][&ex=][&n=][&sx=m|f][&ag=<age>]`; the same seed + same data replays the identical war.
- **localStorage keys**: `hgw.save.v1` (one suspended war), `hgw.history.v1` (finished wars; `HIST_MAX`, protected `KEEP_MAX`), `hgw.settings` (war settings, last name, and the last-chosen log speed and 決断をおまかせ, which carry over to the next war; `hgw.sing.settings` likewise), `hgw.exclude.v1`, `hgw.survival.v1`, `hgw.roster.v2` (**lean** servants), `hgw.overrides.v1`, `hgw.roster.base/view/sel`, `hgw.lab.*`.
  Only seeds, decisions and focus codes are stored for wars; they are rebuilt on resume/replay (a roster fingerprint mismatch asks first). Export file: `{ format:'hgw-records', version:1, history, save }`.
- **Lore dialog** (index/singularity): shows `B.loreLead(text.commentary, 160)` — the commentary with Wiki-page leftovers removed for display only (`B.loreText`: セリフ集 blocks, `TRPGキャラシート` onward, divider lines) — and puts the remainder (never repeating the shown part) behind 「続きを読む」; the link button is 「設定元リンク」 (kagemiya page or the external URL of `B.linkOf`).
- **Spoilers**: servant lore (`canLore`), face portraits and class icons only show servants the player may know; `ranking.html` reveals everything and is linked only from the intro's last paragraph.
- **roster.html**: list/detail browser with review flags, effect/stat/content editors (all write override tables; the effect editor always opens on 「このサーヴァントだけ」, saving per-servant never touches
  `SKILL_OVERRIDES`, saving 「同じ名前のスキルすべて」 asks for confirmation with the holder count, and the global entry has its own delete button), 「全員に効く手直し」 list in 公開・保存, 「この騎の手直しをすべて消す」 per servant, 「聖杯戦争で試す」 (`simlab.js`: N auto wars over the browser roster + a config patch; the roster is first put in the published file order so
  seeds match `survival.json`), 試し戦い, name import (opens the GitHub workflow page). Published-roster sync is a three-way merge (`merge3`) between last-synced, current published and local state.
- **submit.html**: player request form; output `{ format:'hgw-request', version:1, kind:'add'|'adjust', … }` as a GitHub issue URL, a .json file or copied text; roster's 取り込み applies it (`findRequest`/`applyRequest`).
- **ranking.html**: per-servant grade, win rate, survival and five abilities from stats + `effectSummary`, using `survival.json` when its fingerprint matches.
- Scenes: `img/scenes/{scene}-{day|night}.webp` along the `G.sceneCandidates` fallback chain; with no image a procedural SVG skyline is used (404s are expected). Class icons: `H.classIcon(key)`; faces: `H.faceUrl(name)` where `name` is the **face file name** (`H.faceNameOf(sv)` / `H.faceNameOfId(servantId)` = `trueName` or `trueName#key`, same as `E.okey`). A keyed servant never falls back to the plain-name image of its unkeyed namesake. Pass these helpers' result to `fic()`/`data-face`, never a bare `trueName`.

---

## 9. Tests and verification

No framework; plain Node scripts (Node ≥ 18).

```bash
node test/sim.js 500            # 500 auto wars: errors, decided/draw ratio, medians, per-war counts, win rates;  `sim.js 1 <seed>` prints one war's log
node test/interactive.js 200    # random focus/answers through the generator; replays and checks mismatch
node test/servant.js            # tools/servant.js: core view, add round trip, new servant, refusal (works on a temp copy of data/)
node test/incoming.js           # tools/incoming.js: a roster export with `patch` changes only the browser's servants; old exports still replace (temp copy)
node test/skills.js | content.js | voice.js | effects.js | markup.js | fgo.js | kagemiya.js | survival.js | simlab.js | taken.js
node test/focus.js [N]          # is REC_FOCUS really the best constant focus per grade? (~40 s)
node test/singularity.js 300    # singularity mode: errors, clear rate (target ≈20% under おまかせ), replay mismatch 0
node test/run.js test/lucan.txt # parse a wiki .txt and show what was read;  node test/rebuild.js <dir> [out.json] rebuilds exported JSON
node tools/survival.js [N]      # rebuild data/survival.json (default 3000 wars); --check compares fingerprints
python3 -m http.server          # then open http://localhost:8000/
```
Before opening a PR run `sim.js` and `interactive.js` (must be `errors 0`, `mismatch 0`) and the tests that cover what you touched. Compare balance against `origin/main` if you touch the engine or config (a `git worktree` of main is handy).
For UI changes check at desktop width and **390px** (no horizontal overflow).

---

## 10. Recipes

| Task | Where / how |
|---|---|
| Look at / edit / add one servant | `tools/servant.js` (§4.6). Effect, stat and NP-mode fixes belong in `overrides.json` (roster tool or edit the file), not in `servants.json`. |
| New servant data from the wiki | Owner runs the Actions workflow 「kagemiya から取り込み」 (page names → PR), or imports in `roster.html` → 「公開用に保存」 → upload to `data/incoming/`, or `tools/servant.js add`. |
| Improve wiki reading for old data | Fix `parser.js`, then run the workflow in 取り直し mode (lean JSON has no source text for most entries). |
| Add a class | One entry in `CLASS_DEFS`. |
| Singularity balance / names / bosses | `CONFIG.SING` (re-run `test/singularity.js`); words, cities, places, lines in `js/singdata.js`; bosses in `data/bosses.json`. |
| Tune balance | `CONFIG.ENGINE`, `BATTLE_K`, `STAT_W`, `STAT_SCORE`, `RANK_SCORE`, `NP_TYPE`; re-run `sim.js`, `test/focus.js`, rebuild `survival.json`. Stat roles: `STAT_FX` (keep Master coefficients smaller; update `TIPS`). |
| Teach a skill name | `SKILL_DICT` in `effects.js` (`'名前': [['effect', factor, params?]]`); ordinary-word names also go in `GENERIC`; add canonical names to `test/skills.js`. |
| Teach a description pattern | Add a rule to `RULES` (`{ re, id, f?, not?, only? }`); check with `test/rebuild.js` that existing servants did not change unexpectedly. |
| New effect primitive | `EFFECTS` (+ genre in `EFFECT_GROUPS`, description in `EFFECT_INFO`), read it in `engine.js` via `eff(c, id, terrain)`/`effVs`; unread primitives do nothing. Instants also go in `E.INSTANT` (with `trig`) and `applyTrig`. |
| New persona / focus / decision / event | `G.PERSONAS` (keep magnitudes small) / `FOCUS` (unique one-char `code`) / `yield* ask(camp, kind, {title, body, options}, autoFn)` + the §7.6 table / weighted key in `worldEvent`/`lifeEvent`. |
| New voice use | Add a slot (or alias) in `VOICE_SLOTS` and a `say(c, ['key'])` call. |
| More narration | Add strings to the key's array in `G.LINES`; outcomes are unaffected. New places go in `WORLD.places` (`terrain` must match effect conds or be null; changes outcomes) with a scene in `scenes.js`. |
| Master wishes / fixed masters | `G.WISHES_BY_ORIGIN/COMMON/BY_PERSONA` in `names.js`; fixed masters: a JSON array file listed under `masters` in `manifest.json`. |
| Data changed by hand | `data.yml` rebuilds `survival.json` on push; locally `node tools/survival.js` (the game recomputes in the browser while it does not match). |

---

## 11. Workflow conventions

- The owner (GitHub `Pippiniden`) reviews and merges. **Do not push to `main`.** Work on a feature branch from the latest `origin/main` and open a PR; commit messages and PR descriptions are in Japanese.
- Keep changes focused; update the human docs and this file when behaviour or formats change. `README.md` is the **player manual** (no code identifiers, file paths or tuning numbers — those go in `docs/DEVELOPER.md`).
- Do not commit generated images, large temporary files or local test output.

## 12. Gotchas

- `data/servants.json` is ~1.2M characters: use `tools/servant.js` or load it with Node; never paste it into context.
- Variables used by `log()` must be declared before the first `log()` call (a TDZ bug happened once).
- A camp can change hands (`contract`, `steal`): the player's camp id can change mid-war; the UI finds it via `snap.find(c => c.you)`.
- Probabilities are clamped in many places; when adding terms, clamp the final value.
- Servant ids are `classKey:trueName`; camp ids are array indices, stable for the whole war.
