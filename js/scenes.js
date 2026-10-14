/* 情景（背景画像）の種類
 *
 * 画像は img/scenes/{種類}-day.webp と img/scenes/{種類}-night.webp に置く。
 * 置いていない種類は fallback の種類の画像を使い、それも無ければ画面側で描く街並み（SVG）になる。
 * まずは core: true の6種類×昼夜＝12枚があれば、すべての場面が画像で埋まる。
 *
 * 場所（names.js の WORLD.places）の scene でどの種類を使うか決める。
 * 新しい種類を足すときは、ここに1行足して画像を置き、場所の scene に書くだけでよい。
 */
(function (G) {
  'use strict';
  G.SCENES = {
    // ---- 基本の6種類 ----
    city:        { label: '市街地',   core: true, note: '駅前・繁華街・ビル街' },
    residential: { label: '住宅街',   core: true, note: '住宅地・坂道・公園' },
    waterside:   { label: '水辺',     core: true, note: '港・河川敷・海辺' },
    forest:      { label: '森',       core: true, note: '郊外の森・林道' },
    shrine:      { label: '山と寺社', core: true, note: '裏山・神社・石段' },
    industrial:  { label: '工場跡',   core: true, note: '工場・倉庫・廃墟' },
    // ---- あれば使う（無ければ fallback の画像） ----
    harbor:      { label: '港湾倉庫街', fallback: 'waterside' },
    river:       { label: '河川敷',     fallback: 'waterside' },
    beach:       { label: '海浜公園',   fallback: 'waterside' },
    temple:      { label: '廃寺',       fallback: 'shrine' },
    alley:       { label: '旧市街の路地', fallback: 'residential' },
    school:      { label: '学園',       fallback: 'residential' },
    rooftop:     { label: 'ビルの屋上', fallback: 'city' },
    mansion:     { label: '洋館',       fallback: 'forest' },
    underground: { label: '地下',       fallback: 'industrial' },
    church:      { label: '教会',       fallback: 'shrine' },
  };
  G.SCENE_CONFIG = {
    dir: 'img/scenes/',
    ext: 'webp',            // 画像の拡張子（jpg や png にしたいときはここを変える）
    defaultScene: 'city',   // 場所が分からない場面で使う種類
  };

  // 種類から、試す画像のURLを順に並べる（自分 → fallback → …）
  G.sceneCandidates = (scene, time) => {
    const out = [], seen = new Set();
    let s = G.SCENES[scene] ? scene : G.SCENE_CONFIG.defaultScene;
    while (s && !seen.has(s)) {
      seen.add(s);
      out.push(G.SCENE_CONFIG.dir + s + '-' + (time === 'day' ? 'day' : 'night') + '.' + G.SCENE_CONFIG.ext);
      s = G.SCENES[s] && G.SCENES[s].fallback;
    }
    return out;
  };
})(globalThis.HGW = globalThis.HGW || {});
