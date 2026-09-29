// 모의 대전 (더블): 우리 추천 봇 vs 다른 AI, 쇼다운 대전 엔진으로
// 사용법: node scripts/sim/selfplay-doubles.mjs [판 수=50] [상대=greedy|random] [시드=1] [가중치 JSON]
//   - 형식: gen9championsdoublescustomgame (Lv.50). 6마리 보고 4마리 선출·선봉 2마리는 각 AI가 대전 전에 고름
//   - 우리 봇: 선출 추천 → 선봉 → 매 턴 배틀 도우미 1순위 (두 마리 행동·대상), 메가진화는 가능한 첫 행동에
//   - 상대 AI: greedy(두 마리 각자 가장 센 기술을 가장 많이 들어가는 상대에게) / random
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createModel} from '../../src/advisor/model.mjs';
import {createTeamAdvisor} from '../../src/advisor/team.mjs';
import {createPickAdvisor} from '../../src/advisor/pick.mjs';
import {createBattle} from '../../src/advisor/battle.mjs';
import {attachCalcNames} from '../calc_names.mjs';

const require = createRequire(import.meta.url);
const {Teams, Dex} = require('pokemon-showdown');
const {Battle} = require('pokemon-showdown/dist/sim/battle');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [N = 50, OPP_AI = 'greedy', SEED = 1, WJSON = '{}'] = process.argv.slice(2);
const D = JSON.parse(readFileSync(join(ROOT, 'data/pokechamps_mc.json'), 'utf8'));
attachCalcNames(D);
const M = createModel(D), T = createTeamAdvisor(M), P = createPickAdvisor(M, T), B = createBattle(M, P, JSON.parse(WJSON));
const {byId} = M;
const toID = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const byCalc = new Map(D.entries.map(e => [toID(e.calc), e.id]));

let rs = +SEED;
const rnd = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
const pickW = (items, w) => { const t = w.reduce((a, b) => a + b, 0); let r = rnd() * t; for (let i = 0; i < items.length; i++) { r -= w[i]; if (r <= 0) return items[i]; } return items[items.length - 1]; };

const TOP = D.usage.slice(0, 30).filter(u => u.id && byId[u.id] && byId[u.id].calc);
const USAGE = D.usage.filter(u => u.id);
// ---------- 티어 모드 (TIER=1): 사용률 상위 60마리에서 두 팀 모두 균등하게 뽑아, 포켓몬마다 선출 시 승률을 잼 ----------
const TIER = process.env.TIER === '1';
const POOL = USAGE.slice(0, +(process.env.POOLN || 60)).filter(u => u.id && byId[u.id] && byId[u.id].calc);
function uniTeam() {
  const ids = [];
  while (ids.length < 6) { const u = POOL[Math.floor(rnd() * POOL.length)]; if (!ids.some(x => byId[x].no === byId[u.id].no)) ids.push(u.id); }
  return T.teamSets(ids);
}
const tier = {};
function tierRecord(team, brought, leadCount, won) {
  for (const s of team) { const k = s.baseId || s.id; const t = tier[k] ||= {team: 0, teamW: 0, br: 0, brW: 0, lead: 0, leadW: 0}; t.team++; if (won) t.teamW++; }
  brought.forEach((s, n) => { const t = tier[s.baseId || s.id]; t.br++; if (won) t.brW++; if (n < leadCount) { t.lead++; if (won) t.leadW++; } });
}
function tierReport(name) {
  const rank = Object.fromEntries(USAGE.map(u => [u.id, u.rank]));
  const rows = Object.entries(tier).filter(([, t]) => t.br >= 40).map(([id, t]) => {
    const p = t.brW / t.br, ci = 1.96 * Math.sqrt(p * (1 - p) / t.br);
    return {id, ko: byId[id].ko, rank: rank[id], br: t.br, pick: t.br / t.team, win: p, ci, teamWin: t.teamW / t.team};
  }).sort((a, b) => b.win - a.win);
  writeFileSync(join(ROOT, 'raw', '_cache', 'sim', `tier-${name}.json`), JSON.stringify(rows, null, 1));
  const f = x => (100 * x).toFixed(1);
  console.log(`\n[${name} 티어] 선출됐을 때 승률 순 (선출 ${40}판 이상, ±는 95% 오차) · 사용률 순위 · 파티에 있을 때 선출률`);
  rows.forEach((r, i) => console.log(`${String(i + 1).padStart(2)}. ${r.ko.padEnd(8)} 승률 ${f(r.win)}% ±${f(r.ci)} · 선출 ${r.br}판 · 선출률 ${f(r.pick)}% · 사용률 ${r.rank}위`));
}

function oppTeam() {
  const ids = [];
  while (ids.length < 6) { const u = pickW(TOP, TOP.map(x => x.pct)); if (!ids.some(x => byId[x].no === byId[u.id].no)) ids.push(u.id); }
  return T.teamSets(ids);
}
function myTeam() { const seed = pickW(TOP.slice(0, 12), TOP.slice(0, 12).map(x => x.pct)).id; return T.teamSets(T.autoFill([seed])); }
function exportSet(s) {
  const base = s.baseId && s.id !== s.baseId ? B.baseForm(s) : s;
  const sp = s.sp || {};
  const ev = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map((k, i) => (sp[k] ? `${sp[k]} ${['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe'][i]}` : '')).filter(Boolean).join(' / ');
  return `${byId[base.id].calc}${s.item ? ' @ ' + s.item : ''}\nAbility: ${base.ability}\nLevel: 50\n${ev ? 'EVs: ' + ev + '\n' : ''}${s.nature} Nature\n${s.moves.filter(Boolean).map(m => '- ' + m).join('\n')}\n`;
}

const idOf = poke => byCalc.get(toID(poke.species.name)) || byCalc.get(toID(poke.species.baseSpecies)) || null;
const baseIdOf = poke => { const id = idOf(poke); return id && byId[id].mega ? byId[id].parent : id; };
const hpPct = p => (p.fainted || p.hp <= 0 ? 0 : Math.max(1, Math.round(p.hp / p.maxhp * 100)));
const STATUS = {brn: 'brn', par: 'par', psn: 'psn', tox: 'tox', slp: 'slp', frz: 'frz'};
const boostsOf = p => ({atk: p.boosts.atk, def: p.boosts.def, spa: p.boosts.spa, spd: p.boosts.spd, spe: p.boosts.spe});
const WEATHER = {raindance: 'Rain', sunnyday: 'Sun', sandstorm: 'Sand', snowscape: 'Snow', snow: 'Snow'};
const TERRAIN = {electricterrain: 'Electric', grassyterrain: 'Grassy', psychicterrain: 'Psychic', mistyterrain: 'Misty'};
function fieldOf(b, me) {
  const o = me.foe, scr = s => ({reflect: !!s.sideConditions.reflect, lightScreen: !!s.sideConditions.lightscreen, auroraVeil: !!s.sideConditions.auroraveil});
  return {weather: WEATHER[b.field.weather] || '', terrain: TERRAIN[b.field.terrain] || '', trickRoom: !!b.field.pseudoWeather.trickroom,
          tailwind: {me: !!me.sideConditions.tailwind, opp: !!o.sideConditions.tailwind}, screens: {me: scr(me), opp: scr(o)}};
}
const makeBrain = (side, sets, oppPreview) => ({side, sets, oppPreview, revealed: {}, megaOpp: '', trace: [], dec: {}});
function mySetFor(brain, poke) {
  const bid = baseIdOf(poke), s = brain.sets.find(x => (x.baseId || x.id) === bid);
  if (!s) return null;
  return byId[idOf(poke)] && byId[idOf(poke)].mega ? s : (s.baseId && s.id !== s.baseId ? B.baseForm(s) : s);
}
function stateFor(b, brain) {
  const me = brain.side, foe = me.foe;
  const mine = [0, 1].map(k => { const p = me.active[k]; if (!p || p.fainted) return null; const set = mySetFor(brain, p);
    return set ? {set, hpPct: hpPct(p), status: STATUS[p.status] || '', boosts: boostsOf(p), fresh: p.activeTurns === 0, protected: !!p.volatiles.stall} : null; });
  const opp = [0, 1].map(k => { const p = foe.active[k]; if (!p || p.fainted) return null; const id = baseIdOf(p);
    return {id, hpPct: hpPct(p), status: STATUS[p.status] || '', boosts: boostsOf(p), fresh: p.activeTurns === 0, protected: !!p.volatiles.stall, moves: (brain.revealed[id] || []).slice(0, 4)}; });
  const bench = me.pokemon.filter(p => !me.active.includes(p) && !p.fainted).map(p => ({id: baseIdOf(p), set: mySetFor(brain, p), hpPct: hpPct(p)}));
  const fainted = new Set(foe.pokemon.filter(p => p.fainted).map(baseIdOf));
  const oppBench = brain.oppPreview.filter(id => !opp.some(o => o && o.id === id) && !fainted.has(id));
  return {field: fieldOf(b, me), me: mine, opp, bench, oppBench, megaOpp: brain.megaOpp, planTR: brain.sets.some(s => s.moves.includes('Trick Room'))};
}
const posOf = (req, id) => req.side.pokemon.findIndex(p => baseIdOf({species: Dex.species.get(p.details.split(',')[0])}) === id) + 1;
const needsTarget = mv => ['normal', 'any', 'adjacentFoe'].includes(Dex.moves.get(mv).target);
const allyTarget = mv => ['adjacentAlly', 'adjacentAllyOrSelf'].includes(Dex.moves.get(mv).target);  // 도우미 등: 우리 편 자리 (-1 / -2)

function botChoice(b, brain, req, stats) {
  if (req.forceSwitch) {
    const used = new Set();
    return req.forceSwitch.map((f, k) => {
      if (!f) return 'pass';
      const c = req.side.pokemon.map((p, i) => ({p, i})).filter(x => !x.p.active && !x.p.condition.endsWith('fnt') && !used.has(x.i));
      if (!c.length) return 'pass';
      used.add(c[0].i); return `switch ${c[0].i + 1}`;
    }).join(', ');
  }
  const st = stateFor(b, brain);
  if (st.field.weather) (brain.wxSeen ||= new Set()).add(st.field.weather);
  let R;
  try { R = B.advise(st); } catch (e) { stats.errors.push(String(e.stack || e).slice(0, 300)); return 'default'; }
  const top = R.top[0];
  if (!top) return 'default';
  let megaUsed = false;
  const parts = req.active.map((a, k) => {
    if (!a || !st.me[k]) return 'pass';
    const act = top.acts[k];
    if (!act || act.kind === 'none') return 'default';
    if (a.moves.length === 1) return 'move 1';  // 모으기 기술 두 번째 턴·고정: 대상 지정 없이
    if (act.kind === 'switch') { const id = R.bench[act.to] && R.bench[act.to].id, p = id ? posOf(req, id) : 0; if (p > 0 && !a.trapped && !a.maybeTrapped) { brain.dec.switch = (brain.dec.switch || 0) + 1; return `switch ${p}`; } }
    const moves = a.moves, n = moves.findIndex(m => m.id === toID(act.move));
    if (n < 0 || moves[n].disabled) { const e = moves.findIndex(m => !m.disabled); return e >= 0 ? `move ${e + 1}${needsTarget(moves[e].id) ? ' 1' : ''}` : 'default'; }
    brain.dec[act.kind] = (brain.dec[act.kind] || 0) + 1;
    let s = `move ${n + 1}`;
    if (needsTarget(moves[n].id)) s += typeof act.target === 'number' ? ` ${act.target + 1}` : ' 1';
    else if (allyTarget(moves[n].id)) s += ` ${k === 0 ? -2 : -1}`;
    if (a.canMegaEvo && !megaUsed) { s += ' mega'; megaUsed = true; }
    return s;
  });
  return parts.join(', ');
}
function greedyChoice(b, brain, req) {
  if (req.forceSwitch) {
    const used = new Set();
    return req.forceSwitch.map(f => { if (!f) return 'pass'; const c = req.side.pokemon.map((p, i) => i).filter(i => !req.side.pokemon[i].active && !req.side.pokemon[i].condition.endsWith('fnt') && !used.has(i)); if (!c.length) return 'pass'; used.add(c[0]); return `switch ${c[0] + 1}`; }).join(', ');
  }
  const me = brain.side, foe = me.foe;
  let megaUsed = false;
  return req.active.map((a, k) => {
    const p = me.active[k];
    if (!a || !p || p.fainted) return 'pass';
    if (a.moves.length === 1) return 'move 1';
    const set = mySetFor(brain, p);
    let best = null;
    [0, 1].forEach(j => {
      const o = foe.active[j];
      if (!o || o.fainted) return;
      const os = {...B.oppSetOf({id: baseIdOf(o), mega: !!byId[idOf(o)].mega}), hpPct: hpPct(o), boosts: boostsOf(o)};
      const rows = M.damageTable({...set, boosts: boostsOf(p), hpPct: hpPct(p)}, os, {doubles: true, L: {}, R: {}}, true, {fast: true});
      a.moves.forEach((m, n) => {
        if (m.disabled) return;
        const r = rows.find(x => toID(x.name) === m.id);
        const v = r && r.maxPct != null ? (r.minPct + r.maxPct) / 2 : 0;
        if (!best || v > best.v) best = {v, n, j, id: m.id};
      });
    });
    if (!best) return 'default';
    let s = `move ${best.n + 1}${needsTarget(best.id) ? ' ' + (best.j + 1) : ''}`;
    if (a.canMegaEvo && !megaUsed) { s += ' mega'; megaUsed = true; }
    return s;
  }).join(', ');
}
function randomChoice(req) {
  if (req.forceSwitch) return 'default';
  return req.active.map(a => { if (!a) return 'pass'; const m = a.moves.map((x, i) => i).filter(i => !a.moves[i].disabled); const n = m[Math.floor(rnd() * m.length)]; return `move ${n + 1}${needsTarget(a.moves[n].id) ? ' ' + (1 + Math.floor(rnd() * 2)) : ''}`; }).join(', ');
}

function botPick(mine, oppIds) { const R = P.recommend(mine, oppIds); const L = R.leads[0]; return {order: [...L.lead, ...L.back], arch: R.arch}; }
function greedyPick(mine) { const u = s => { const x = M.usageOf(byId[s.baseId || s.id]); return x ? x.pct : 0; }; return {order: mine.map((s, i) => i).sort((a, b) => u(mine[b]) - u(mine[a])).slice(0, 4)}; }

function playOne(g, stats, sample) {
  const A = TIER ? uniTeam() : myTeam(), Bt = TIER ? uniTeam() : oppTeam();
  const Aids = A.map(s => s.baseId || s.id), Bids = Bt.map(s => s.baseId || s.id);
  const pa = botPick(A, Bids), pb = OPP_AI === 'bot' ? botPick(Bt, Aids) : OPP_AI === 'greedy' ? greedyPick(Bt) : {order: [0, 1, 2, 3]};
  const A4 = pa.order.map(i => A[i]), B4 = pb.order.map(i => Bt[i]);
  const battle = new Battle({formatid: 'gen9championsdoublescustomgame'});
  const pack = sets => Teams.pack(Teams.import(sets.map(exportSet).join('\n')));
  battle.setPlayer('p1', {name: 'bot', team: pack(A4)});
  battle.setPlayer('p2', {name: OPP_AI === 'bot' ? 'bot2' : OPP_AI, team: pack(B4)});
  const brains = {p1: makeBrain(battle.p1, A4, Bids), p2: makeBrain(battle.p2, B4, Aids)};
  let logPos = 0, guard = 0;
  const scan = () => {
    for (; logPos < battle.log.length; logPos++) {
      const l = battle.log[logPos].split('|');
      if (!l[2] || !/^p[12][ab]/.test(l[2])) continue;
      const who = l[2].slice(0, 2), slot = l[2][2] === 'a' ? 0 : 1, other = who === 'p1' ? 'p2' : 'p1';
      const poke = battle[who].active[slot];
      if (l[1] === 'move' && poke) { const id = baseIdOf(poke); const r = brains[other].revealed[id] ||= []; const m = Dex.moves.get(l[3]).name; if (!r.includes(m)) r.push(m); }
      if (l[1] === 'detailschange' && poke && byId[idOf(poke)] && byId[idOf(poke)].mega) brains[other].megaOpp = baseIdOf(poke);
    }
  };
  while (!battle.ended && guard++ < 500) {
    scan();
    let acted = false;
    for (const sid of ['p1', 'p2']) {
      const side = battle[sid], req = side.activeRequest;
      if (!req || req.wait || side.isChoiceDone()) continue;
      let ch;
      if (req.teamPreview) ch = 'team 1234';
      else if (sid === 'p1') ch = botChoice(battle, brains.p1, req, stats);
      else ch = OPP_AI === 'bot' ? botChoice(battle, brains.p2, req, stats) : OPP_AI === 'greedy' ? greedyChoice(battle, brains.p2, req) : randomChoice(req);
      if (!battle.choose(sid, ch)) { stats.bad.push(`${sid} ${ch} → ${side.choice.error}`); battle.choose(sid, 'default'); }
      acted = true;
    }
    if (!acted) break;
  }
  const won = battle.winner === 'bot';
  if (TIER && battle.winner) { tierRecord(A, A4, 2, won); tierRecord(Bt, B4, 2, !won); }
  stats.games++; if (won) stats.wins++;
  stats.turns += battle.turn;
  for (const [k, v] of Object.entries(brains.p1.dec)) stats.dec[k] = (stats.dec[k] || 0) + v;
  // 성향 이름: 날씨·필드는 종류까지 (예: weather:Rain)
  const tag = pa.arch ? pa.arch.main.map(k => (k === 'weather' ? 'weather:' + pa.arch.detail.weather : k === 'terrain' ? 'terrain:' + pa.arch.detail.terrain : k)).join('·') : '';
  // 대전 중 날씨가 우리 봇 입력에 들어갔는지 (확인용)
  stats.wx = stats.wx || {};
  for (const w of brains.p1.wxSeen || []) stats.wx[w] = (stats.wx[w] || 0) + 1;
  stats.byArch[tag] = stats.byArch[tag] || {g: 0, w: 0}; stats.byArch[tag].g++; if (won) stats.byArch[tag].w++;
  if (!won && sample.length < 6) sample.push(`=== ${g + 1}판 패 (${battle.turn}턴) — 우리 ${A4.map(s => byId[s.id].ko).join('·')} vs ${B4.map(s => byId[s.id].ko).join('·')} (${tag})\n` +
    battle.log.filter(l => /^\|(switch|move|faint|-mega|win|turn|cant|-activate)\|/.test(l)).join('\n'));
}

const stats = {games: 0, wins: 0, turns: 0, bad: [], errors: [], dec: {}, byArch: {}};
const sample = [];
const t0 = Date.now();
for (let g = 0; g < +N; g++) { try { playOne(g, stats, sample); } catch (e) { stats.errors.push(String(e.stack || e).slice(0, 400)); } }
const out = join(ROOT, 'raw', '_cache', 'sim');
mkdirSync(out, {recursive: true});
writeFileSync(join(out, `doubles-sample-${OPP_AI}.txt`), sample.join('\n\n'));
const pct = (w, g) => (g ? (100 * w / g).toFixed(1) + '%' : '-');
console.log(`[더블] 상대 AI: ${OPP_AI} · ${stats.games}판 · 승률 ${pct(stats.wins, stats.games)} · 평균 ${(stats.turns / Math.max(1, stats.games)).toFixed(1)}턴 · ${((Date.now() - t0) / 1000).toFixed(0)}초`);
console.log('우리 봇 행동:', JSON.stringify(stats.dec));
console.log('상대 파티 성향별:', Object.entries(stats.byArch).map(([k, v]) => `${k} ${v.w}/${v.g}`).join(', '));
if (TIER) tierReport('doubles');
console.log('봇이 본 날씨(판 수):', JSON.stringify(stats.wx));
const groups = {};
for (const [k, v] of Object.entries(stats.byArch)) for (const part of k.split('·')) { const g = part.startsWith('weather') ? part : part.startsWith('terrain') ? 'terrain' : part; groups[g] = groups[g] || {g: 0, w: 0}; groups[g].g += v.g; groups[g].w += v.w; }
console.log('성향별(겹치면 각각 셈):', Object.entries(groups).sort((a, b) => b[1].g - a[1].g).map(([k, v]) => `${k} ${v.w}/${v.g}=${pct(v.w, v.g)}±${(196 * Math.sqrt((v.w / v.g) * (1 - v.w / v.g) / v.g)).toFixed(0)}%`).join(', '));
console.log('잘못된 선택:', stats.bad.length, stats.bad.slice(0, 5));
console.log('오류:', stats.errors.length, stats.errors.slice(0, 3));
