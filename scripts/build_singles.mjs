// 싱글(BSS Reg M-C) 사용률 데이터 만들기: node scripts/build_singles.mjs
//   raw/pchamps_bss_mc.json (쇼다운 M-C 싱글 대전 기록 집계, fetch_bss_replays.mjs)
// + raw/smogon_bss.json     (Smogon 월간 통계 — 기술·도구·특성·능력치 배분·천적, fetch_smogon_bss.mjs)
// → data/pokechamps_mc_singles.json  (usage 모양은 더블과 같음 + pick 선출률, lead 선봉률, sp 배분, cc 천적)
//
// 사용률·승률·선출률·선봉률·동료는 M-C 기록에서, 기술·도구·특성은 M-C 기록(드러난 것)과 Smogon을 표본 수로 섞음,
// 성격·SP 배분은 기록에 안 나오므로 Smogon 것만 씀.
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {attachCalcNames} from './calc_names.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = p => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const D = rd('data/pokechamps_mc.json');
attachCalcNames(D);
const R = rd('raw/pchamps_bss_mc.json');
const G = existsSync(join(ROOT, 'raw/smogon_bss.json')) ? rd('raw/smogon_bss.json') : {data: {}};
const toID = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------- 이름 → 도감 id ----------
const byId = Object.fromEntries(D.entries.map(e => [e.id, e]));
const nameIdx = new Map();
for (const e of D.entries) for (const n of [e.calc, e.en, e.id]) if (n && !nameIdx.has(toID(n))) nameIdx.set(toID(n), e.id);
for (const u of D.usage) if (u.id && !nameIdx.has(toID(u.name))) nameIdx.set(toID(u.name), u.id);
function idOf(name) {
  let n = name;
  for (;;) {
    const id = nameIdx.get(toID(n));
    if (id) return id;
    if (!n.includes('-')) return null;
    n = n.slice(0, n.lastIndexOf('-'));  // 모습 이름을 떼어 가며 (Maushold-Four → Maushold)
  }
}
const baseOf = id => (byId[id] && byId[id].mega ? byId[id].parent : id);
const moveIdx = new Map(D.moves.map((m, i) => [toID(m.en), i]));
const itemName = new Map(Object.keys(D.itemko).map(n => [toID(n), n]));
const ITEMS_EXTRA = ['Choice Scarf', 'Choice Band', 'Choice Specs', 'Focus Sash', 'Leftovers', 'Life Orb', 'Sitrus Berry', 'Lum Berry',
  'Assault Vest', 'Rocky Helmet', 'Air Balloon', 'Weakness Policy', 'White Herb', 'Mental Herb', 'Expert Belt', 'Heavy-Duty Boots',
  'Black Sludge', 'Light Clay', 'Shuca Berry', 'Chople Berry', 'Occa Berry', 'Yache Berry', 'Kee Berry', 'Maranga Berry', 'King\'s Rock',
  'Quick Claw', 'Scope Lens', 'Bright Powder', 'Shell Bell', 'Mirror Herb', 'Throat Spray', 'Eject Button', 'Red Card', 'Covert Cloak'];
for (const n of ITEMS_EXTRA) if (!itemName.has(toID(n))) itemName.set(toID(n), n);
const itemOf = n => itemName.get(toID(n)) || n;
const legalAb = id => new Set([byId[id], ...(byId[id].megas || []).map(m => byId[m])].flatMap(e => e.ab.map(a => a.en)));
const abName = (id, n) => { for (const a of legalAb(id)) if (toID(a) === toID(n)) return a; return null; };
const abKo = en => { for (const e of D.entries) for (const a of e.ab) if (a.en === en && a.ko) return a.ko; return ''; };
const learn = id => new Set(byId[id].mv);

// ---------- Smogon (메가 모습은 원래 포켓몬에 합침, 표본 수로 가중 평균) ----------
const smog = {};
for (const [name, d] of Object.entries(G.data)) {
  const id = idOf(name);
  if (!id) continue;
  const b = baseOf(id);
  (smog[b] ||= []).push(d);
}
function mergeLists(parts, key, map) {
  const tot = parts.reduce((a, d) => a + d.raw, 0) || 1, acc = {};
  for (const d of parts) for (const [k, p] of d[key] || []) { const n = map(k); if (n != null) acc[n] = (acc[n] || 0) + p * d.raw / tot; }
  return acc;
}

// ---------- 합치기 ----------
const teamsTotal = R.weightTotal || R.battles * 2;  // 가중치 합 (같은 파티 반복·레이팅 반영)
const usage = [];
const unmatched = [];
for (const [name, s] of Object.entries(R.species)) {
  const id = idOf(name);
  if (!id) { unmatched.push(name); continue; }
  const b = baseOf(id);
  if (usage.find(u => u.id === b)) continue;
  const L = learn(b), parts = smog[b] || [];
  const smogRaw = parts.reduce((a, d) => a + d.raw, 0);

  // 기술: M-C 기록에서 드러난 비율(합을 400%로 맞춤)과 Smogon 비율을 섞음
  const blend = (mc, seen, sm, wFull, norm) => {
    const w = Math.min(1, seen / wFull) * (Object.keys(sm).length ? 1 : 0) + (Object.keys(sm).length ? 0 : 1);
    const out = {};
    const sumMc = Object.values(mc).reduce((a, c) => a + c, 0) || 1;
    for (const [k, c] of Object.entries(mc)) out[k] = (out[k] || 0) + w * Math.min(100, c / sumMc * norm);
    for (const [k, p] of Object.entries(sm)) out[k] = (out[k] || 0) + (1 - w) * p;
    return Object.entries(out).filter(([, p]) => p >= 0.3).sort((x, y) => y[1] - x[1]);
  };
  const mcMv = {};
  for (const [m, c] of Object.entries(s.mv)) { const i = moveIdx.get(toID(m)); if (i != null && L.has(i)) mcMv[i] = c; }
  const smMv = mergeLists(parts, 'mv', k => { const i = moveIdx.get(toID(k)); return i != null && L.has(i) ? i : null; });
  const mv = blend(mcMv, s.mvSeen, smMv, 60, 400).slice(0, 12).map(([i, p]) => [+i, +p.toFixed(2)]);

  const mcIt = {};
  for (const [n, c] of Object.entries(s.it)) mcIt[itemOf(n)] = (mcIt[itemOf(n)] || 0) + c;
  const it = blend(mcIt, s.itSeen, mergeLists(parts, 'it', itemOf), 50, 100).slice(0, 8).map(([n, p]) => [n, +p.toFixed(2)]);

  const mcAb = {};
  for (const [n, c] of Object.entries(s.ab)) { const a = abName(b, n); if (a) mcAb[a] = (mcAb[a] || 0) + c; }
  const smAb = mergeLists(parts, 'ab', k => abName(b, k));
  let ab = blend(mcAb, s.abSeen, smAb, 30, 100).slice(0, 4);
  if (!ab.length && byId[b].ab.length === 1) ab = [[byId[b].ab[0].en, 100]];
  ab = ab.map(([n, p]) => [n, +p.toFixed(2), abKo(n)]);

  // 능력치 배분: Smogon "Jolly:2/32/0/0/0/32"
  const spAcc = {};
  for (const d of parts) for (const [k, p] of d.sp || []) spAcc[k] = (spAcc[k] || 0) + p * d.raw / (smogRaw || 1);
  const sp = Object.entries(spAcc).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, p]) => {
    const [nat, v] = k.split(':'), n = v.split('/').map(Number);
    return [nat, {hp: n[0], atk: n[1], def: n[2], spa: n[3], spd: n[4], spe: n[5]}, +p.toFixed(1)];
  });

  if ((s.n || s.teams) < 8) continue;  // 표본이 너무 적은 포켓몬은 뺌
  const tm = Object.entries(s.tm).sort((x, y) => y[1] - x[1]).slice(0, 10).map(([n, c]) => [n, +(100 * c / s.teams).toFixed(2), idOf(n) ? baseOf(idOf(n)) : null]);
  // 천적 (Smogon): 이 포켓몬이 지는 비율이 높은 상대
  const ccAcc = {};
  for (const d of parts) for (const [n, p, cnt] of d.cc || []) { const i = idOf(n); if (i) { const k = baseOf(i); if (!ccAcc[k] || ccAcc[k][0] < p) ccAcc[k] = [p, cnt]; } }
  const cc = Object.entries(ccAcc).sort((x, y) => y[1][0] - x[1][0]).slice(0, 8).map(([k, [p, n]]) => [k, p, n]);

  usage.push({name, id: b, pct: +(100 * s.teams / teamsTotal).toFixed(3), win: +(100 * s.wins / Math.max(1e-9, s.teams)).toFixed(2), games: s.n || Math.round(s.teams),
              pick: +(100 * s.brought / Math.max(1, s.teams)).toFixed(1), lead: +(100 * s.leads / Math.max(1, s.brought)).toFixed(1),
              mega: +(100 * s.mega / Math.max(1, s.brought)).toFixed(1), seen: s.seen, mv, it, ab, tm, sp, cc});
}
usage.sort((a, b) => b.pct - a.pct);
usage.forEach((u, i) => { u.rank = i + 1; });
const out = {mode: 'singles', usage,
  meta: {source: `Showdown ${R.format} ${R.since}~ 공개 대전 ${R.battles}판 (레이팅 중앙값 ${R.ratingMedian}, 같은 파티 반복은 가중치 낮춤) + Smogon ${G.format || '-'} ${G.month || ''} ${G.rating || ''}`,
         fetched: R.fetched, battles: R.battles, since: R.since, smogon: G.month ? {month: G.month, format: G.format, rating: G.rating, battles: G.battles} : null}};
writeFileSync(join(ROOT, 'data', 'pokechamps_mc_singles.json'), JSON.stringify(out, null, 1));
console.log('싱글 사용률', usage.length, '마리 ·', R.battles, '판 · 못 찾은 이름', unmatched.join(', ') || '없음');
