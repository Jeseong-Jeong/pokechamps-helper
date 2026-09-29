// 모의 대전: 우리 추천 봇 vs 다른 AI, 쇼다운 대전 엔진(pokemon-showdown)으로 실제 대전을 돌려 봄
// 사용법: node scripts/sim/selfplay.mjs [판 수=50] [상대=greedy|random|bot] [시드=1]
//   - 형식: gen9championscustomgame (Lv.50, 챔피언스 능력치 규칙). 싱글, 6마리 보고 3마리 선출은 각 AI가 대전 전에 직접 고름
//   - 우리 팀: 팀 추천(autoFill)으로 사용률 상위 포켓몬 하나에서 시작해 6마리 / 상대 팀: 사용률 상위 30마리에서 사용률 비례로 6마리
//   - 우리 봇: 선출 추천 → 선봉 → 매 턴 배틀 도우미 1순위 행동 (메가진화는 나온 첫 행동에)
//   - 상대 AI: greedy(가장 센 기술, 교체 안 함) / random(무작위) / bot(우리 봇끼리)
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createModel} from '../../src/advisor/model.mjs';
import {createTeamAdvisor} from '../../src/advisor/team.mjs';
import {createPickAdvisor} from '../../src/advisor/pick.mjs';
import {createBattle, PROTECT} from '../../src/advisor/battle.mjs';
import {attachCalcNames} from '../calc_names.mjs';

const require = createRequire(import.meta.url);
const {Teams, Dex, PRNG} = require('pokemon-showdown');
const {Battle} = require('pokemon-showdown/dist/sim/battle');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [N = 50, OPP_AI = 'greedy', SEED = 1, WJSON = '{}'] = process.argv.slice(2);  // 4번째: 점수 가중치 JSON (예: '{"switchCost":0.12}')
const D = JSON.parse(readFileSync(join(ROOT, 'data/pokechamps_mc.json'), 'utf8'));
attachCalcNames(D);
const G = JSON.parse(readFileSync(join(ROOT, 'data/pokechamps_mc_singles.json'), 'utf8'));
const M = createModel({...D, mode: 'singles', usage: G.usage}), T = createTeamAdvisor(M), P = createPickAdvisor(M, T), B = createBattle(M, P, JSON.parse(WJSON));
const {byId} = M;
const toID = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const byCalc = new Map(D.entries.map(e => [toID(e.calc), e.id]));

// ---------- 난수 ----------
let rs = +SEED;
const rnd = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
const pickW = (items, w) => { const t = w.reduce((a, b) => a + b, 0); let r = rnd() * t; for (let i = 0; i < items.length; i++) { r -= w[i]; if (r <= 0) return items[i]; } return items[items.length - 1]; };

// ---------- 팀 ----------
const TOP = G.usage.slice(0, 30).filter(u => byId[u.id] && byId[u.id].calc);
function oppTeam() {
  const ids = [];
  while (ids.length < 6) {
    const u = pickW(TOP, TOP.map(x => x.pct));
    if (!ids.some(x => byId[x].no === byId[u.id].no)) ids.push(u.id);
  }
  return T.teamSets(ids);
}
function myTeam() {
  const seed = pickW(TOP.slice(0, 12), TOP.slice(0, 12).map(x => x.pct)).id;
  return T.teamSets(T.autoFill([seed]));
}
// 우리 세트 → 쇼다운 팀 텍스트 (메가 세트는 원래 모습 + 메가스톤, 특성은 원래 모습 것)
function exportSet(s) {
  const base = s.baseId && s.id !== s.baseId ? B.baseForm(s) : s;
  const sp = s.sp || {};
  const ev = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map((k, i) => (sp[k] ? `${sp[k]} ${['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe'][i]}` : '')).filter(Boolean).join(' / ');
  return `${byId[base.id].calc}${s.item ? ' @ ' + s.item : ''}\nAbility: ${base.ability}\nLevel: 50\n${ev ? 'EVs: ' + ev + '\n' : ''}${s.nature} Nature\n${s.moves.filter(Boolean).map(m => '- ' + m).join('\n')}\n`;
}

// ---------- 대전 상태 → 우리 엔진 입력 ----------
const idOf = poke => byCalc.get(toID(poke.species.name)) || byCalc.get(toID(poke.species.baseSpecies)) || null;
const baseIdOf = poke => { const id = idOf(poke); return id && byId[id].mega ? byId[id].parent : id; };
const hpPct = p => (p.fainted || p.hp <= 0 ? 0 : Math.max(1, Math.round(p.hp / p.maxhp * 100)));
const STATUS = {brn: 'brn', par: 'par', psn: 'psn', tox: 'tox', slp: 'slp', frz: 'frz'};
const boostsOf = p => ({atk: p.boosts.atk, def: p.boosts.def, spa: p.boosts.spa, spd: p.boosts.spd, spe: p.boosts.spe});
const WEATHER = {raindance: 'Rain', primordialsea: 'Rain', sunnyday: 'Sun', desolateland: 'Sun', sandstorm: 'Sand', snowscape: 'Snow', snow: 'Snow', hail: 'Snow'};
const TERRAIN = {electricterrain: 'Electric', grassyterrain: 'Grassy', psychicterrain: 'Psychic', mistyterrain: 'Misty'};
function fieldOf(b, me) {
  const other = me.foe;
  const hz = s => ({sr: !!s.sideConditions.stealthrock, spikes: s.sideConditions.spikes ? s.sideConditions.spikes.layers : 0});
  const scr = s => ({reflect: !!s.sideConditions.reflect, lightScreen: !!s.sideConditions.lightscreen, auroraVeil: !!s.sideConditions.auroraveil});
  return {weather: WEATHER[b.field.weather] || '', terrain: TERRAIN[b.field.terrain] || '', trickRoom: !!b.field.pseudoWeather.trickroom,
          tailwind: {me: !!me.sideConditions.tailwind, opp: !!other.sideConditions.tailwind}, screens: {me: scr(me), opp: scr(other)},
          hazards: {me: hz(me), opp: hz(other)}};
}

// 각 편 봇이 기억하는 것: 내 세트(우리 모델 형식), 상대 팀 미리보기 6마리, 상대가 보여준 기술, 본 포켓몬
function makeBrain(side, sets, oppPreview) {
  return {side, sets, oppPreview, revealed: {}, seen: new Set(), megaOpp: '', trace: [], decisions: {attack: 0, switch: 0, pivot: 0, setup: 0, hazard: 0, status: 0, recover: 0, protect: 0}};
}
function mySetFor(brain, poke) {
  const bid = baseIdOf(poke);
  const s = brain.sets.find(x => (x.baseId || x.id) === bid);
  if (!s) return null;
  const megaNow = byId[idOf(poke)] && byId[idOf(poke)].mega;
  return megaNow ? s : (s.baseId && s.id !== s.baseId ? B.baseForm(s) : s);
}
function stateFor(b, brain) {
  const me = brain.side, foe = me.foe;
  const act = me.active[0], oact = foe.active[0];
  const set = act && !act.fainted ? mySetFor(brain, act) : null;
  const meSlot = set ? {set, hpPct: hpPct(act), status: STATUS[act.status] || '', boosts: boostsOf(act), fresh: act.activeTurns === 0, protected: !!act.volatiles.stall,
                        lastMove: act.lastMove ? act.lastMove.name : ''} : null;
  const bench = me.pokemon.filter(p => p !== act && !p.fainted).map(p => ({id: baseIdOf(p), set: mySetFor(brain, p), hpPct: hpPct(p)}));
  let opp = null;
  if (oact && !oact.fainted) {
    const oid = baseIdOf(oact);
    opp = {id: oid, hpPct: hpPct(oact), status: STATUS[oact.status] || '', boosts: boostsOf(oact), fresh: oact.activeTurns === 0,
           protected: !!oact.volatiles.stall, drowsy: !!oact.volatiles.yawn, moves: (brain.revealed[oid] || []).slice(0, 4)};
    if (oact.item === '' && oact.lastItem) opp.item = '';
  }
  const fainted = new Set(foe.pokemon.filter(p => p.fainted).map(baseIdOf));
  const oppHp = {};
  for (const p of foe.pokemon) if (brain.seen.has(baseIdOf(p)) && p !== oact) oppHp[baseIdOf(p)] = hpPct(p);
  const oppBench = brain.oppPreview.filter(id => id !== (opp && opp.id) && !fainted.has(id));
  return {field: fieldOf(b, me), me: [meSlot, null], opp: [opp, null], bench, oppBench, oppHp, oppSeen: [...brain.seen], megaOpp: brain.megaOpp, planTR: false};
}

// ---------- 결정 ----------
const posOf = (req, id) => req.side.pokemon.findIndex(p => baseIdOf({species: Dex.species.get(p.details.split(',')[0])}) === id) + 1;
function moveChoice(req, move, mega) {
  const moves = req.active[0].moves;
  const k = moves.findIndex(m => toID(m.move) === toID(move) || m.id === toID(move));
  if (k < 0 || moves[k].disabled) return null;
  return `move ${k + 1}${mega && req.active[0].canMegaEvo ? ' mega' : ''}`;
}
function bestSwitch(b, brain, req) {
  // 쓰러졌거나 유턴 뒤: 지금 상대와의 대면이 가장 좋은 포켓몬 (선출 추천과 같은 대면 값)
  const foe = brain.side.foe.active[0];
  const cands = req.side.pokemon.map((p, i) => ({p, i})).filter(x => !x.p.active && x.p.condition !== '0 fnt' && !x.p.condition.endsWith('fnt'));
  if (!cands.length) return 'default';
  if (!foe || foe.fainted) return `switch ${cands[0].i + 1}`;
  const oppSet = B.oppSetOf({id: baseIdOf(foe), mega: !!byId[idOf(foe)].mega});
  let best = null;
  for (const c of cands) {
    const id = baseIdOf({species: Dex.species.get(c.p.details.split(',')[0])});
    const s = brain.sets.find(x => (x.baseId || x.id) === id) || brain.sets[c.i];
    if (!s) continue;
    const v = P.matrix([s], [oppSet])[0][0].v;
    if (!best || v > best.v) best = {v, i: c.i};
  }
  return `switch ${best.i + 1}`;
}
// 봇 판단 기록 (진 판 분석용)
function trace(b, brain, st, R, c, what) {
  const d = R.defense[0];
  const alt = R.top.filter(x => x !== c).slice(0, 2).map(x => `${x.acts[0].kind}:${x.acts[0].move || (R.bench[x.acts[0].to] || {}).id || ''} ${x.score.toFixed(2)}`).join(', ');
  const ko = id => (byId[id] ? byId[id].ko : id);
  brain.trace.push(`T${b.turn} ${ko(st.me[0].set.id)}(${st.me[0].hpPct}%) vs ${ko(st.opp[0].id)}(${st.opp[0].hpPct}%): ${what} ${c.score.toFixed(2)} | 대안 ${alt} | 상대예측 ${R.oppPred[0] && R.oppPred[0].move} 교체${Math.round(((d && d.pS) || 0) * 100)}%`);
}
function botChoice(b, brain, req, stats) {
  if (req.forceSwitch) {
    if (brain.pendingPivot) { const p = posOf(req, brain.pendingPivot); brain.pendingPivot = null; if (p > 0 && !req.side.pokemon[p - 1].condition.endsWith('fnt')) return `switch ${p}`; }
    return bestSwitch(b, brain, req);
  }
  const st = stateFor(b, brain);
  if (!st.me[0] || !st.opp[0]) return 'default';
  let R;
  try { R = B.advise(st); } catch (e) { stats.errors.push(String(e.stack || e).slice(0, 300)); return 'default'; }
  const canMega = req.active[0].canMegaEvo;
  for (const c of R.top.concat(R.all || [])) {
    const a = c.acts[0];
    if (!a || a.kind === 'none') continue;
    if (a.kind === 'switch') {
      const id = R.bench[a.to] && R.bench[a.to].id, p = id && posOf(req, id);
      if (p > 0 && !req.active[0].trapped) { brain.decisions.switch++; trace(b, brain, st, R, c, '교체→' + id); return `switch ${p}`; }
      continue;
    }
    const ch = moveChoice(req, a.move, canMega);
    if (!ch) continue;
    brain.decisions[a.pivot ? 'pivot' : a.kind === 'attack' ? 'attack' : a.kind] = (brain.decisions[a.pivot ? 'pivot' : a.kind === 'attack' ? 'attack' : a.kind] || 0) + 1;
    if (a.pivot && a.pivotTo != null && R.bench[a.pivotTo]) brain.pendingPivot = R.bench[a.pivotTo].id;
    trace(b, brain, st, R, c, a.kind + ':' + a.move + (a.pivot ? '→' + (R.bench[a.pivotTo] || {}).id : ''));
    return ch;
  }
  return 'default';
}
function greedyChoice(b, brain, req) {
  if (req.forceSwitch) return bestSwitch(b, brain, req);
  const me = brain.side.active[0], foe = brain.side.foe.active[0];
  const set = mySetFor(brain, me);
  const oppSet = {...B.oppSetOf({id: baseIdOf(foe), mega: !!byId[idOf(foe)].mega}), hpPct: hpPct(foe), boosts: boostsOf(foe)};
  const rows = M.damageTable({...set, boosts: boostsOf(me), hpPct: hpPct(me)}, oppSet, {doubles: false, L: {}, R: {}}, true, {fast: true});
  const moves = req.active[0].moves;
  let best = null;
  moves.forEach((m, k) => {
    if (m.disabled) return;
    const r = rows.find(x => toID(x.name) === m.id);
    const v = r && r.maxPct != null ? (r.minPct + r.maxPct) / 2 : 0;
    if (!best || v > best.v) best = {v, k};
  });
  return best ? `move ${best.k + 1}${req.active[0].canMegaEvo ? ' mega' : ''}` : 'default';
}
function randomChoice(req) {
  if (req.forceSwitch) {
    const c = req.side.pokemon.map((p, i) => i).filter(i => !req.side.pokemon[i].active && !req.side.pokemon[i].condition.endsWith('fnt'));
    return c.length ? `switch ${c[Math.floor(rnd() * c.length)] + 1}` : 'default';
  }
  const m = req.active[0].moves.map((x, i) => i).filter(i => !req.active[0].moves[i].disabled);
  return m.length ? `move ${m[Math.floor(rnd() * m.length)] + 1}` : 'default';
}

// ---------- 선출 (6 → 3) ----------
function botPick(mine, oppIds) {
  const R = P.recommend(mine, oppIds);
  const L = R.leads[0];
  return {order: [...L.lead, ...L.back], arch: R.arch};
}
function greedyPick(mine) {  // 사용률 높은 순 3마리, 첫째가 선봉
  const u = s => { const x = M.usageOf(byId[s.baseId || s.id]); return x ? x.pct : 0; };
  return {order: mine.map((s, i) => i).sort((a, b) => u(mine[b]) - u(mine[a])).slice(0, 3)};
}

// ---------- 한 판 ----------
// SWAP=1 이면 같은 두 팀으로 편을 바꿔 두 판씩 (팀 강약 차이를 빼고 판단력만 비교)
const SWAP = process.env.SWAP === '1';
let pair = null;
function playOne(g, stats, sample) {
  let A, Bt;
  if (SWAP) { if (g % 2 === 0) pair = [oppTeam(), oppTeam()]; [A, Bt] = g % 2 === 0 ? pair : [pair[1], pair[0]]; }
  else { A = myTeam(); Bt = oppTeam(); }
  const Aids = A.map(s => s.baseId || s.id), Bids = Bt.map(s => s.baseId || s.id);
  const pa = botPick(A, Bids), pb = OPP_AI === 'bot' ? botPick(Bt, Aids) : OPP_AI === 'greedy' ? greedyPick(Bt) : {order: [0, 1, 2]};
  const A3 = pa.order.map(i => A[i]), B3 = pb.order.map(i => Bt[i]);
  const battle = new Battle({formatid: 'gen9championscustomgame', seed: PRNG.generateSeed ? PRNG.generateSeed() : undefined});
  const pack = sets => Teams.pack(Teams.import(sets.map(exportSet).join('\n')));
  battle.setPlayer('p1', {name: 'bot', team: pack(A3)});
  battle.setPlayer('p2', {name: OPP_AI === 'bot' ? 'bot2' : OPP_AI, team: pack(B3)});  // 봇끼리면 이름이 같아 승자 판정이 틀림
  const brains = {p1: makeBrain(battle.p1, A3, Bids), p2: makeBrain(battle.p2, B3, Aids)};
  let logPos = 0, guard = 0;
  const scan = () => {  // 새 로그에서 상대가 보여준 기술·나온 포켓몬·메가진화 기록
    for (; logPos < battle.log.length; logPos++) {
      const l = battle.log[logPos].split('|');
      const who = l[2] && l[2].slice(0, 2);
      const other = who === 'p1' ? 'p2' : 'p1';
      if (!who || !brains[other]) continue;
      const poke = () => battle[who].active[0];
      if (l[1] === 'switch' || l[1] === 'drag') brains[other].seen.add(baseIdOf({species: Dex.species.get(l[3].split(',')[0])}));
      if (l[1] === 'move' && poke()) { const id = baseIdOf(poke()); const r = brains[other].revealed[id] ||= []; const m = Dex.moves.get(l[3]).name; if (!r.includes(m)) r.push(m); }
      if (l[1] === 'detailschange' && poke() && byId[idOf(poke())] && byId[idOf(poke())].mega) brains[other].megaOpp = baseIdOf(poke());
    }
  };
  while (!battle.ended && guard++ < 500) {
    scan();
    let acted = false;
    for (const sid of ['p1', 'p2']) {
      const side = battle[sid], req = side.activeRequest;
      if (!req || req.wait || side.isChoiceDone()) continue;
      let ch;
      if (req.teamPreview) ch = 'team 123';
      else if (sid === 'p1' || OPP_AI === 'bot') ch = botChoice(battle, brains[sid], req, stats);
      else ch = OPP_AI === 'greedy' ? greedyChoice(battle, brains[sid], req) : randomChoice(req);
      if (!battle.choose(sid, ch)) { stats.bad.push(`${sid} ${ch} → ${side.choice.error}`); battle.choose(sid, 'default'); }
      acted = true;
    }
    if (!acted) break;
  }
  const won = battle.winner === 'bot';
  stats.games++; if (won) stats.wins++; if (!battle.winner) stats.ties++;
  stats.turns += battle.turn;
  for (const [k, v] of Object.entries(brains.p1.decisions)) stats.dec[k] = (stats.dec[k] || 0) + v;
  const tag = pa.arch ? pa.arch.main.join('·') : '';
  stats.byArch[tag] = stats.byArch[tag] || {g: 0, w: 0}; stats.byArch[tag].g++; if (won) stats.byArch[tag].w++;
  for (const s of A3) { const k = byId[s.baseId || s.id].ko; stats.mon[k] = stats.mon[k] || {g: 0, w: 0}; stats.mon[k].g++; if (won) stats.mon[k].w++; }
  if (!won && sample.length < 8) sample.push(`=== ${g + 1}판: ${won ? '승' : '패'} (${battle.turn}턴) — 우리 ${A3.map(s => byId[s.id].ko).join('·')} vs ${B3.map(s => byId[s.id].ko).join('·')} (상대 성향 ${tag})\n[봇 판단]\n${brains.p1.trace.join('\n')}\n[로그]\n` +
    battle.log.filter(l => /^\|(switch|move|-damage|faint|-mega|detailschange|win|turn|-heal|-boost|-unboost|-status|-sidestart|cant|-activate|-enditem)\|/.test(l)).join('\n'));
}

const stats = {games: 0, wins: 0, ties: 0, turns: 0, bad: [], errors: [], dec: {}, byArch: {}, mon: {}};
const sample = [];
const t0 = Date.now();
for (let g = 0; g < +N; g++) {
  try { playOne(g, stats, sample); } catch (e) { stats.errors.push(String(e.stack || e).slice(0, 400)); }
}
const out = join(ROOT, 'raw', '_cache', 'sim');
mkdirSync(out, {recursive: true});
writeFileSync(join(out, `sample-${OPP_AI}.txt`), sample.join('\n\n'));
const pct = (w, g) => (g ? (100 * w / g).toFixed(1) + '%' : '-');
console.log(`상대 AI: ${OPP_AI} · ${stats.games}판 · 승률 ${pct(stats.wins, stats.games)} · 평균 ${(stats.turns / Math.max(1, stats.games)).toFixed(1)}턴 · ${((Date.now() - t0) / 1000).toFixed(0)}초`);
console.log('우리 봇 행동:', JSON.stringify(stats.dec));
console.log('상대 파티 성향별:', Object.entries(stats.byArch).map(([k, v]) => `${k} ${v.w}/${v.g}`).join(', '));
console.log('많이 낸 포켓몬:', Object.entries(stats.mon).sort((a, b) => b[1].g - a[1].g).slice(0, 10).map(([k, v]) => `${k} ${v.g}판 ${pct(v.w, v.g)}`).join(', '));
console.log('잘못된 선택:', stats.bad.length, stats.bad.slice(0, 5));
console.log('오류:', stats.errors.length, stats.errors.slice(0, 3));
