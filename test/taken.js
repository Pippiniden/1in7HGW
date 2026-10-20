// あなたのマスターが死に、サーヴァントが他のマスターと再契約したとき：あなたの陣営ではなくなり、その陣営が勝ってもあなたの勝ちにならない
// 使い方: node test/taken.js [戦争の数]
const L = require('../tools/datalib');
for (const f of ['scenes', 'names', 'personas', 'engine']) require('../js/' + f + '.js');
const H = globalThis.HGW, N = +process.argv[2] || 3000;
const roster = L.loadDir(__dirname + '/../data').roster;
let fail = 0; const ng = m => { fail++; console.error('NG:', m); };
let taken = 0, takenWin = 0;
for (let i = 0; i < N; i++) {
  const out = {}, res = H.engine.runWar({ roster, seed: 'tk' + i, player: i % 7, out });
  const me = res.you == null ? null : res.camps[res.you];
  if (res.youTaken) {
    taken++;
    if (!me || me.you) ng(`seed tk${i}: 再契約したのに「あなた」の印が残っている`);
    if (typeof res.youTaken.master !== 'string' || !res.youTaken.master) ng(`seed tk${i}: 死んだマスターの名前が無い`);
    if (res.winner === res.you) takenWin++;
    if (me && me.master === res.youTaken.master) ng(`seed tk${i}: マスターが入れ替わっていない`);
  } else if (me && !me.you) ng(`seed tk${i}: 印が無いのに youTaken も無い`);
}
console.log(`${N}戦：あなたのマスターが死んで再契約された ${taken}回（そのまま優勝 ${takenWin}回）`);
if (!taken) ng('再契約の場面が一度も出なかった（戦争の数を増やす）');
if (fail) { console.error(fail + '件失敗'); process.exit(1); }
console.log('OK');
