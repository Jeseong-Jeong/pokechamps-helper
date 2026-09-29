import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createModel} from '../src/advisor/model.mjs';
import {createTeamAdvisor} from '../src/advisor/team.mjs';
import {createPickAdvisor} from '../src/advisor/pick.mjs';
import {createBattle} from '../src/advisor/battle.mjs';
import {attachCalcNames} from '../scripts/calc_names.mjs';

const D = JSON.parse(readFileSync(new URL('../data/pokechamps_mc.json', import.meta.url), 'utf8'));
attachCalcNames(D);
const G = JSON.parse(readFileSync(new URL('../data/pokechamps_mc_singles.json', import.meta.url), 'utf8'));
const M = createModel({...D, mode: 'singles', usage: G.usage}), T = createTeamAdvisor(M), P = createPickAdvisor(M, T), B = createBattle(M, P);

test('싱글 데이터: 사용률·선출률·선봉률, 똑같은 파티 반복으로 쏠리지 않음', () => {
  assert.ok(G.usage.length > 100);
  const u = G.usage[0];
  assert.ok(u.pick > 0 && u.pick <= 100 && u.lead >= 0 && u.lead <= 100);
  assert.ok(u.pct < 40, `1위 사용률 ${u.pct}% — 대여 파티 반복이 가중치로 줄어야 함`);
  // 특성은 그 포켓몬이 가질 수 있는 것만
  for (const x of G.usage) {
    const e = M.byId[x.id];
    const ok = new Set([e, ...(e.megas || []).map(m => M.byId[m])].flatMap(y => y.ab.map(a => a.en)));
    for (const [n] of x.ab) assert.ok(ok.has(n), `${x.id}: ${n}`);
  }
});

test('싱글 모드: 3마리 선출·선봉 1마리, 5초 안에', () => {
  assert.equal(M.doubles, false);
  const mine = T.teamSets(['Garchomp', 'Primarina', 'Corviknight', 'Meowscarada', 'Kingambit', 'Glimmora']);
  const t0 = Date.now();
  const R = P.recommend(mine, ['Salamence', 'Archaludon', 'Sneasler', 'Meowscarada', 'Pelipper', 'Swampert']);
  assert.ok(Date.now() - t0 < 5000);
  assert.equal(R.picks[0].idx.length, 3);
  assert.equal(R.leads[0].lead.length, 1);
  assert.equal(R.leads[0].back.length, 2);
  assert.ok(R.arch && R.arch.main.length >= 1);
  assert.ok(Math.abs(R.oppLeads.reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('싱글 파티 성향: 받기 파티는 사이클, 용춤 파티는 랭크업, 기합의띠·스카프 파티는 대면', () => {
  const ids = a => a.filter(i => M.byId[i]);
  assert.equal(P.archetype(ids(['Corviknight', 'Hippowdon', 'Rotom-Wash', 'Clefable', 'Toxapex', 'Garchomp'])).main[0], 'cycle');
  assert.equal(P.archetype(ids(['Hippowdon', 'Gyarados', 'Baxcalibur', 'Volcarona', 'Dragonite', 'Ninetales-Alola'])).main[0], 'setup');
  assert.equal(P.archetype(ids(['Glimmora', 'Meowscarada', 'Mimikyu', 'Basculegion', 'Kingambit', 'Sneasler'])).main[0], 'face');
});

test('싱글 배틀: 기합의띠로 버티고 공격, 교체 예측은 기록 기반 확률(최대 60%)', () => {
  const me = T.teamSets(['Glimmora'])[0];
  const bench = T.teamSets(['Garchomp', 'Meowscarada']).map(s => ({id: s.baseId, set: s, hpPct: 100}));
  const R = B.advise({field: {}, me: [{set: me, hpPct: 100, fresh: true}, null], opp: [{id: 'Archaludon', hpPct: 100, fresh: true}, null],
                      bench, oppBench: ['Salamence', 'Sneasler', 'Pelipper', 'Swampert', 'Meowscarada'], oppSeen: ['Archaludon'], megaOpp: ''});
  const top = R.top[0];
  assert.notEqual(top.acts[0].kind, 'switch', '기합의띠가 있으니 교체보다 공격·설치');
  assert.ok(top.log.some(x => x.k === 'sash'));
  const d = R.defense[0];
  assert.ok(d.pS >= 0 && d.pS <= 0.6);
  // 못 본 포켓몬 5마리가 남은 2자리를 나눠 가짐
  const sum = R.presence.reduce((a, b) => a + b, 0);
  assert.ok(sum > 1.5 && sum <= 2.01, `presence 합 ${sum}`);
});

test('싱글 배틀: 약점을 찔리면 교체 확률이 올라가고, 스텔스록이 깔려 있으면 들어올 때 피해', () => {
  const me = T.teamSets(['Garchomp'])[0];
  const opp = [{id: 'Salamence', hpPct: 100, fresh: false}, null];
  const R = B.advise({field: {hazards: {me: {}, opp: {sr: true}}}, me: [{set: me, hpPct: 100}, null], opp, bench: [],
                      oppBench: ['Archaludon', 'Primarina'], oppSeen: ['Salamence', 'Archaludon', 'Primarina'], megaOpp: 'Salamence'});
  const d = R.defense[0];
  assert.ok(d.why.includes('약점을 찔림'), d.why.join(','));
  assert.ok(d.pS > 0.2, `교체 확률 ${d.pS}`);
  const sw = R.top[0].sims.find(s => s.scen[0].type === 'switch');
  assert.ok(sw && sw.log.some(x => x.k === 'hazard'));
});

test('싱글 배틀: 유턴은 먼저 때리고 빠져서 상대 공격은 들어온 포켓몬이 맞음, 누구로 바꿀지도 추천', () => {
  const me = {id: 'Meowscarada', ability: 'Protean', item: 'Choice Scarf', moves: ['Flower Trick', 'Knock Off', 'U-turn', 'Triple Axel'],
              nature: 'Jolly', sp: {hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32}, boosts: {}, status: '', hpPct: 100};
  const bench = T.teamSets(['Garchomp', 'Glimmora']).map(s => ({id: s.baseId, set: s, hpPct: 100}));
  const R = B.advise({field: {}, me: [{set: me, hpPct: 100, fresh: true}, null], opp: [{id: 'Archaludon', hpPct: 100, fresh: true}, null],
                      bench, oppBench: [], oppSeen: ['Archaludon'], megaOpp: 'X'});
  const top = R.top[0], a = top.acts[0];
  assert.equal(a.move, 'U-turn');
  assert.equal(bench[a.pivotTo].id, 'Glimmora', '용성군을 대신 맞아도 기합의띠로 버티는 킬라플로르로');
  const order = top.log.map(x => x.k);
  assert.ok(order.indexOf('pivot') > order.indexOf('hit'));
  assert.equal(top.log.filter(x => x.k === 'hit' && x.from[0] === 'o')[0].toId, 'Glimmora');
});

test('상태이상: 잠든 상대는 대부분 행동 못 함 → 받는 피해 기댓값이 줄어듦 (챔피언스 잠듦 최대 3턴)', () => {
  const me = T.teamSets(['Primarina'])[0];
  const base = st => B.advise({field: {}, me: [{set: me, hpPct: 100, fresh: false}, null], opp: [{id: 'Garchomp', hpPct: 100, fresh: false, status: st}, null],
                               bench: [], oppBench: [], oppSeen: ['Garchomp'], megaOpp: 'X'});
  const lost = R => { const c = R.top[0]; return 100 - c.hp.m0; };
  assert.ok(lost(base('slp')) < lost(base('')) * 0.6, `잠듦 ${lost(base('slp'))} vs 정상 ${lost(base(''))}`);
  assert.ok(lost(base('par')) < lost(base('')));
});
