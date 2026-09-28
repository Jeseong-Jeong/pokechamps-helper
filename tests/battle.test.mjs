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
const M = createModel(D), T = createTeamAdvisor(M), P = createPickAdvisor(M, T), B = createBattle(M, P);
const z = {hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0};
const mk = (id, baseId, ability, item, moves, nature, sp) => ({...M.defaultSet(id), id, baseId, ability, item, moves, nature, sp: {...z, ...sp}});
const ora = mk('Oranguru', 'Oranguru', 'Inner Focus', 'Mental Herb', ['Instruct', 'Trick Room', 'Rain Dance', 'Psychic'], 'Bold', {hp: 21, def: 30, spe: 15});
const inc = mk('Incineroar', 'Incineroar', 'Intimidate', 'Life Orb', ['Throat Chop', 'Flare Blitz', 'Fake Out', 'Parting Shot'], 'Adamant', {hp: 32, atk: 32, def: 2});
const gol = mk('Mega Golisopod', 'Golisopod', 'Tough Claws', 'Golisopite', ['First Impression', 'Leech Life', 'Liquidation', 'Swords Dance'], 'Brave', {hp: 32, atk: 32, spd: 2});
const met = mk('Mega Metagross', 'Metagross', 'Tough Claws', 'Metagrossite', ['Steel Roller', 'Bullet Punch', 'Ice Punch', 'Psychic Fangs'], 'Adamant', {hp: 32, atk: 32, spd: 2});
const slot = (set, extra = {}) => ({set, hpPct: 100, ...extra});

test('상대 사용률 정보: 기술·도구·특성·스피드 범위', () => {
  const i = B.oppInfo('Rillaboom');
  assert.equal(i.moves[0][0], 'Fake Out');
  assert.equal(i.items[0][0], 'Life Orb');
  assert.ok(i.speed.min < i.speed.assumed && i.speed.assumed <= i.speed.max);
  assert.ok(i.mates.length > 0);
});

test('방금 나온 상대의 속이다 예측 + 유인 서포터 예측', () => {
  const r = B.advise({field: {}, me: [slot(ora, {fresh: true}), slot(inc, {fresh: true})], bench: [],
    opp: [{id: 'Rillaboom', hpPct: 100, fresh: true}, {id: 'Indeedee-F', hpPct: 100, fresh: true}]});
  assert.equal(r.oppPred[0].move, 'Fake Out');
  assert.ok(r.oppPred[1].redirect);
});

test('정신력 하랑우탄은 속이다에 안 풀죽음 → 트릭룸 추천', () => {
  const r = B.advise({field: {}, planTR: true, me: [slot(ora, {fresh: true}), slot(inc, {fresh: true})], bench: [],
    opp: [{id: 'Rillaboom', hpPct: 100, fresh: true}, {id: 'Indeedee-F', hpPct: 100, fresh: true}]});
  assert.equal(r.top[0].acts[0].kind, 'trickroom');
  assert.equal(r.top[0].flinched.m0, false);
});

test('만나자마자·속이다는 방금 나온 턴에만', () => {
  const r = B.advise({field: {trickRoom: true}, me: [slot(gol), slot(met)], bench: [],
    opp: [{id: 'Rillaboom', hpPct: 60}, {id: 'Sneasler', hpPct: 100}]});
  for (const c of r.top) assert.ok(!c.acts.some(a => a.move === 'First Impression' || a.move === 'Fake Out'));
});

test('트릭룸이면 느린 쪽이 먼저: 갑주무사(54)가 포푸니크보다 먼저 공격', () => {
  const r = B.advise({field: {trickRoom: true}, me: [slot(gol), slot(met)], bench: [],
    opp: [{id: 'Rillaboom', hpPct: 60}, {id: 'Sneasler', hpPct: 100}]});
  const c = r.top[0];
  const firstHit = c.log.find(x => x.k === 'hit');
  assert.equal(firstHit.from[0], 'm');
});

test('사이코필드에서는 상대 속이다가 막힘', () => {
  const r = B.advise({field: {terrain: 'Psychic'}, me: [slot(inc, {fresh: true}), slot(met, {fresh: true})], bench: [],
    opp: [{id: 'Rillaboom', hpPct: 100, fresh: true}, {id: 'Sneasler', hpPct: 100, fresh: true}]});
  assert.notEqual(r.oppPred[0].move, 'Fake Out');
});

test('사람처럼 교체 예측: 4배·먼저 확정으로 잡히는 포푸니크는 뒤의 대도각참으로 교체 가능성', () => {
  const r = B.advise({field: {trickRoom: true}, me: [slot(met), slot(gol)], bench: [],
    opp: [{id: 'Sneasler', hpPct: 100}, {id: 'Rillaboom', hpPct: 100}], oppBench: ['Kingambit', 'Salamence', 'Incineroar', 'Indeedee-F']});
  const d = r.defense[0];
  assert.ok(d.pS > 0.2, JSON.stringify(d));
  assert.equal(d.switchTo.id, 'Kingambit');
  assert.ok(d.why.includes('4배 약점'));
  // 두 상대가 같은 포켓몬으로 동시에 교체하는 경우는 없음
  for (const sc of r.scenarios) {
    const sw = sc.s.filter(x => x.type === 'switch').map(x => x.k);
    assert.equal(new Set(sw).size, sw.length);
  }
  const total = r.scenarios.reduce((a, x) => a + x.p, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
});

test('뒤 포켓몬 정보가 없으면 교체 예측 안 함, 방금 나온 상대는 교체 확률 낮음', () => {
  const r0 = B.advise({field: {trickRoom: true}, me: [slot(met), slot(gol)], bench: [], opp: [{id: 'Sneasler', hpPct: 100}, {id: 'Rillaboom', hpPct: 100}]});
  assert.equal(r0.defense[0].pS, 0);
  const r1 = B.advise({field: {trickRoom: true}, me: [slot(met), slot(gol)], bench: [],
    opp: [{id: 'Sneasler', hpPct: 100, fresh: true}, {id: 'Rillaboom', hpPct: 100}], oppBench: ['Kingambit']});
  const r2 = B.advise({field: {trickRoom: true}, me: [slot(met), slot(gol)], bench: [],
    opp: [{id: 'Sneasler', hpPct: 100}, {id: 'Rillaboom', hpPct: 100}], oppBench: ['Kingambit']});
  assert.ok(r1.defense[0].pS < r2.defense[0].pS);
});

test('교체해 들어온 포켓몬이 대신 맞고, 맞은 뒤 남은 HP가 기록됨', () => {
  const r = B.advise({field: {terrain: 'Grassy'}, me: [slot(inc, {fresh: true}), slot(gol, {fresh: true})], bench: [{id: 'Oranguru', set: ora, hpPct: 100}],
    opp: [{id: 'Rillaboom', hpPct: 100, fresh: true}, {id: 'Sneasler', hpPct: 100, fresh: true}]});
  const c = r.top.find(x => x.acts.some(a => a.kind === 'switch'));
  assert.ok(c, '교체가 들어간 추천');
  const hit = c.log.find(x => x.k === 'hit' && x.from[0] === 'o' && x.toId === 'Oranguru');
  assert.ok(hit, '하랑우탄이 대신 맞음');
  assert.ok(hit.leftRange[0] <= hit.leftRange[1] && hit.leftRange[1] < 100);
  // 화면에서 기록한 공격으로 들어온 쪽 HP를 구할 때 쓰는 계산
  const d = r.dmg('o1', 'Close Combat', 'b0');
  assert.ok(d && d.maxPct > 0);
});

test('메가진화 전에는 원래 모습으로 계산 (메가스톤만 들고 있음)', () => {
  const b = B.baseForm(gol);
  assert.equal(b.id, 'Golisopod');
  assert.equal(b.item, 'Golisopite');
  assert.ok(M.byId.Golisopod.ab.some(a => a.en === b.ability));
  assert.ok(B.canMega(gol) && !B.canMega(b) && !B.canMega(inc));
  assert.ok(M.finalStats(b).atk < M.finalStats(gol).atk);
  // 상대: megaOpp 가 비어 있으면 메가 전, 그 포켓몬 id 면 메가
  const s = {id: 'Metagross', item: 'Metagrossite'};
  assert.equal(B.oppSetOf({...s, mega: false}).id, 'Metagross');
  assert.equal(B.oppSetOf({...s, mega: true}).id, 'Mega Metagross');
  const st = megaOpp => ({field: {}, me: [slot(inc), slot(ora)], bench: [], opp: [{id: 'Metagross', item: 'Metagrossite', hpPct: 100}, {id: 'Rillaboom', hpPct: 100}], megaOpp});
  assert.equal(B.advise(st('')).opps[0].set.id, 'Metagross');
  assert.equal(B.advise(st('Metagross')).opps[0].set.id, 'Mega Metagross');
});
