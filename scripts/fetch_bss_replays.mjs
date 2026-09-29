// 쇼다운 공개 대전 기록을 직접 모아 집계 (싱글 사용률은 Pikalytics·Smogon 월간 통계에 아직 없어서, 더블은 선봉·선출 조합용)
// 사용법: node scripts/fetch_bss_replays.mjs [시작일 YYYY-MM-DD] [형식] [결과 파일]
//   기본: 싱글 gen9championsbssregmc → raw/pchamps_bss_mc.json (캐시 raw/_cache/bss/)
//   더블: node scripts/fetch_bss_replays.mjs 2026-09-01 gen9championsvgc2026regmc raw/pchamps_vgc_mc.json (캐시 raw/_cache/<형식>/)
//   받은 기록은 캐시에 저장해 두므로 다시 돌리면 새 기록만 받음
// 기록에서 알 수 있는 것: 파티 6마리(팀 미리보기), 실제로 낸 3마리·선봉, 쓴 기술, 드러난 도구·특성, 메가진화, 승패
import {mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FORMAT = process.argv[3] || 'gen9championsbssregmc';
const OUTFILE = process.argv[4] || 'raw/pchamps_bss_mc.json';
const DOUBLES = /vgc|doubles/.test(FORMAT), NBRING = DOUBLES ? 4 : 3, NLEAD = DOUBLES ? 2 : 1;
const SINCE = new Date((process.argv[2] || '2026-09-01') + 'T00:00:00Z').getTime() / 1000;
const CACHE = join(ROOT, 'raw', '_cache', FORMAT === 'gen9championsbssregmc' ? 'bss' : FORMAT);
mkdirSync(CACHE, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url) {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(url, {headers: {'user-agent': 'pokechamps-mc usage (github.com/Jeseong-Jeong/pokechamps-helper)'}});
      if (r.status === 429 || r.status >= 500) { await sleep(5000 * (i + 1)); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { await sleep(3000 * (i + 1)); }
  }
  return null;
}

// 1) 목록: 최신부터 SINCE 까지
const list = [];
let before = '';
for (;;) {
  const j = await getJson(`https://replay.pokemonshowdown.com/search.json?format=${FORMAT}${before ? '&before=' + before : ''}`);
  if (!j || !j.length) break;
  const page = j.slice(0, 50);
  for (const x of page) if (x.uploadtime >= SINCE && !x.private && !x.password) list.push(x);
  before = page[page.length - 1].uploadtime;
  if (before < SINCE || j.length < 51) break;
  await sleep(300);
}
console.log('목록', list.length, '판');

// 2) 기록 받기 (캐시에 없는 것만, 동시에 4개)
const todo = list.filter(x => !existsSync(join(CACHE, x.id + '.json')));
let done = 0;
async function worker() {
  while (todo.length) {
    const x = todo.shift();
    const j = await getJson(`https://replay.pokemonshowdown.com/${x.id}.json`);
    if (j && j.log) writeFileSync(join(CACHE, x.id + '.json'), JSON.stringify({id: x.id, rating: x.rating || 0, uploadtime: x.uploadtime, log: j.log}));
    if (++done % 200 === 0) console.log('받음', done);
    await sleep(250);
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);

// 3) 집계
const S = {};
const sp = n => (S[n] ||= {teams: 0, wins: 0, brought: 0, broughtWins: 0, leads: 0, mega: 0, seen: 0, mvSeen: 0, itSeen: 0, abSeen: 0,
                             mv: {}, it: {}, ab: {}, tm: {}, megaForm: {}});
const inc = (o, k, v = 1) => { o[k] = (o[k] || 0) + v; };
let battles = 0;
const ratings = [];
// 가중치: 똑같은 6마리 파티(대여·복붙 파티)가 많이 반복되면 사용률이 쏠리므로 1/√(같은 파티 수)로 줄이고,
//         레이팅이 높은 판은 조금 더 믿음 (1000 → 0.6, 1300+ → 1.2)
const teamKey = log => ['p1', 'p2'].map(sd => log.split('\n').filter(l => l.startsWith(`|poke|${sd}|`)).map(l => l.split('|')[3].split(',')[0].trim()).sort().join('/'));
const teamFreq = {};
const files = readdirSync(CACHE);
for (const f of files) { const R = JSON.parse(readFileSync(join(CACHE, f), 'utf8')); if (R.uploadtime >= SINCE) for (const k of teamKey(R.log)) teamFreq[k] = (teamFreq[k] || 0) + 1; }
const rateW = r => 0.6 + 0.6 * Math.min(1, Math.max(0, ((r || 1000) - 1000) / 300));
let weightTotal = 0;
const combos = {bring: {}, lead: {}};
for (const f of files) {
  const R = JSON.parse(readFileSync(join(CACHE, f), 'utf8'));
  if (R.uploadtime < SINCE) continue;
  const L = R.log.split('\n');
  const names = {}, team = {p1: [], p2: []}, nick = {}, brought = {p1: new Set(), p2: new Set()}, lead = {p1: new Set(), p2: new Set()};
  let started = false;  // 1턴 전에 나온 포켓몬 = 선봉 (싱글 1마리, 더블 2마리)
  const per = {};   // 'p1|Species' → 이번 판에서 드러난 것
  const P = (side, s) => (per[side + '|' + s] ||= {mv: new Set(), it: null, ab: null, mega: null});
  const who = ref => { const m = /^(p[12])[ab]?: (.*)$/.exec((ref || '').trim()); return m ? [m[1], nick[m[1] + '|' + m[2]]] : [null, null]; };
  const from = (parts, key) => { const t = parts.find(p => p.startsWith('[from] ' + key + ':') || p.startsWith('[from]' + key + ':')); return t ? t.replace(/^\[from\] ?[a-z]+: ?/, '') : null; };
  const ofRef = parts => { const t = parts.find(p => p.startsWith('[of] ')); return t ? t.slice(5) : null; };
  let winner = null, transformed = new Set();
  for (const line of L) {
    const p = line.split('|');
    const cmd = p[1];
    if (cmd === 'player' && p[3]) names[p[2]] = p[3];
    else if (cmd === 'poke') team[p[2]].push(p[3].split(',')[0].trim());
    else if (cmd === 'switch' || cmd === 'drag') {
      const [side, nk] = [p[2].slice(0, 2), p[2].split(': ')[1]];
      const s = p[3].split(',')[0].trim();
      const base = team[side].find(t => s === t || s.startsWith(t + '-')) || s;  // 메가 모습 → 파티 이름
      nick[side + '|' + nk] = base;
      if (!started) lead[side].add(base);
      brought[side].add(base);
    } else if (cmd === 'detailschange' || cmd === '-mega') {
      const [side, s] = who(p[2]);
      if (side && s) { const x = P(side, s); x.mega = cmd === '-mega' ? (p[4] || x.mega) : x.mega; if (cmd === 'detailschange') x.megaForm = p[3].split(',')[0].trim(); }
    } else if (cmd === '-transform') { const [side, s] = who(p[2]); if (side) transformed.add(side + '|' + s); }
    else if (cmd === 'move') {
      const [side, s] = who(p[2]);
      if (!side || !s || transformed.has(side + '|' + s)) continue;
      if (p.slice(5).some(x => /^\[from\]/.test(x) && !/lockedmove/.test(x))) continue;  // 잠꼬대·매직미러 등으로 나간 기술 제외
      if (p[3] !== 'Struggle') P(side, s).mv.add(p[3]);
    } else if (cmd === '-item' || cmd === '-enditem') {
      if (p.slice(4).some(x => /\[from\] ?move:/.test(x))) continue;     // 트릭·도둑질로 바뀐 도구 제외
      const [side, s] = who(p[2]);
      if (side && s) P(side, s).it = p[3];
    } else if (cmd === '-ability') {
      const [side, s] = who(p[2]);
      const fa = from(p.slice(4), 'ability');
      if (side && s && !fa) P(side, s).ab = p[3];
      if (side && s && fa === 'Trace') P(side, s).ab = 'Trace';
    }
    if (cmd && cmd !== 'move') {
      // 다른 줄의 "[from] item: X" / "[from] ability: Y" — [of] 가 있으면 그 포켓몬 것
      const rest = p.slice(3);
      const it = from(rest, 'item'), ab = from(rest, 'ability');
      if ((it || ab) && cmd !== '-ability') {
        const [side, s] = who(ofRef(rest) || p[2]);
        if (side && s) { if (it && !ofRef(rest)) P(side, s).it = it; if (ab && cmd !== '-item') P(side, s).ab = ab; }
      }
    }
    if (cmd === 'turn') started = true;
    if (cmd === 'win') winner = p[2];
  }
  if (team.p1.length !== 6 || team.p2.length !== 6 || !brought.p1.size || !brought.p2.size) continue;
  battles++;
  const keys = teamKey(R.log);
  if (R.rating) ratings.push(R.rating);
  for (const side of ['p1', 'p2']) {
    const won = winner && names[side] === winner;
    const w = rateW(R.rating) / Math.sqrt(teamFreq[keys[side === 'p1' ? 0 : 1]] || 1);
    weightTotal += w;
    // 조합: 실제로 데려온 포켓몬들 / 선봉
    const addC = (tab, set) => { const k = [...set].sort().join('|'); const c = tab[k] ||= {w: 0, win: 0, n: 0}; c.w += w; c.n++; if (won) c.win += w; };
    if (brought[side].size === NBRING) addC(combos.bring, brought[side]);  // 기권 등으로 덜 나온 판은 빼고
    if (lead[side].size === NLEAD) addC(combos.lead, lead[side]);
    for (const s of team[side]) {
      const e = sp(s);
      e.teams += w; e.n = (e.n || 0) + 1; if (won) e.wins += w;
      for (const t of team[side]) if (t !== s) inc(e.tm, t, w);
      if (brought[side].has(s)) { e.brought += w; if (won) e.broughtWins += w; }
      if (lead[side].has(s)) e.leads += w;
      const x = per[side + '|' + s];
      if (!x) continue;
      if (x.mega && !x.it) x.it = x.mega;  // 메가진화 = 메가스톤 확인
      e.seen += w;
      if (x.mv.size) { e.mvSeen += w; for (const m of x.mv) inc(e.mv, m, w); }
      if (x.it) { e.itSeen += w; inc(e.it, x.it, w); }
      if (x.ab) { e.abSeen += w; inc(e.ab, x.ab, w); }
      if (x.megaForm) { e.mega += w; inc(e.megaForm, x.megaForm, w); }
    }
  }
}
ratings.sort((a, b) => a - b);
// 자주 나온 조합 상위 40개: [포켓몬들, 비율 %, 그 조합의 승률 %, 판 수]
//   '자주 보이는' 조합이 목적이라 가중치 없이 실제로 나온 횟수 순 (같은 파티 반복도 그대로 셈)
const topC = tab => Object.entries(tab).filter(([k, c]) => c.n >= 8).sort((a, b) => b[1].n - a[1].n).slice(0, 40)
  .map(([k, c]) => [k.split('|'), +(100 * c.n / Math.max(1, battles * 2)).toFixed(2), +(100 * c.win / c.w).toFixed(1), c.n]);
const out = {fetched: new Date().toISOString(), format: FORMAT, since: new Date(SINCE * 1000).toISOString().slice(0, 10), battles, weightTotal,
             topTeamShare: Math.max(...Object.values(teamFreq)) / Math.max(1, battles * 2),
             ratingMedian: ratings[ratings.length >> 1] || 0, species: S, combos: {bring: topC(combos.bring), lead: topC(combos.lead)}};
writeFileSync(join(ROOT, OUTFILE), JSON.stringify(out));
console.log('집계', battles, '판 · 포켓몬', Object.keys(S).length, '· 레이팅 중앙값', out.ratingMedian);
