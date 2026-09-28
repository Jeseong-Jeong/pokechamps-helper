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
