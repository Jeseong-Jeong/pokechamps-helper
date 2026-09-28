import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createModel} from '../src/advisor/model.mjs';
import {createTeamAdvisor} from '../src/advisor/team.mjs';
import {createPickAdvisor} from '../src/advisor/pick.mjs';
import {createImprover} from '../src/advisor/improve.mjs';
import {attachCalcNames} from '../scripts/calc_names.mjs';

const D = JSON.parse(readFileSync(new URL('../data/pokechamps_mc.json', import.meta.url), 'utf8'));
attachCalcNames(D);
const M = createModel(D), T = createTeamAdvisor(M), P = createPickAdvisor(M, T);
const I = createImprover(M, T, P, {threatCount: 8, poolMinPct: 3});  // 테스트는 작게
const z = {hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0};
const mk = (id, baseId, ability, item, moves, nature, sp) => ({...M.defaultSet(id), id, baseId, ability, item, moves, nature, sp: {...z, ...sp}});

// 사용자 예시 파티 (트릭룸 하랑우탄 + 느린 멤버)
const TEAM = [
  mk('Oranguru', 'Oranguru', 'Inner Focus', 'Mental Herb', ['Instruct', 'Trick Room', 'Rain Dance', 'Psychic'], 'Bold', {hp: 21, def: 30, spe: 15}),
  mk('Incineroar', 'Incineroar', 'Intimidate', 'Life Orb', ['Throat Chop', 'Flare Blitz', 'Fake Out', 'Parting Shot'], 'Adamant', {hp: 32, atk: 32, def: 2}),
  mk('Mega Golisopod', 'Golisopod', 'Tough Claws', 'Golisopite', ['First Impression', 'Leech Life', 'Liquidation', 'Swords Dance'], 'Brave', {hp: 32, atk: 32, spd: 2}),
  mk('Pelipper', 'Pelipper', 'Drizzle', 'Focus Sash', ['Hurricane', 'Wide Guard', 'U-turn', 'Weather Ball'], 'Modest', {hp: 2, spa: 32, spe: 32}),
  mk('Archaludon', 'Archaludon', 'Stamina', 'Leftovers', ['Electro Shot', 'Flash Cannon', 'Dragon Pulse', 'Protect'], 'Quiet', {hp: 32, spa: 2, spd: 32}),
  mk('Mega Metagross', 'Metagross', 'Tough Claws', 'Metagrossite', ['Steel Roller', 'Bullet Punch', 'Ice Punch', 'Psychic Fangs'], 'Adamant', {hp: 32, atk: 32, spd: 2}),
];

test('팀 점수: 약한 팀보다 사용률 기반 팀이 높음', () => {
  const good = T.teamSets(T.autoFill(['Rillaboom']));
  const bad = T.teamSets(['Pikachu', 'Arbok', 'Beedrill', 'Pidgeot', 'Raichu', 'Wigglytuff'].filter(id => M.byId[id]));
  assert.ok(I.score(good).total > I.score(bad).total);
});

test('트릭룸 팀의 트릭룸 사용자는 핵심 → 교체 후보에서 빠짐', async () => {
  const r = await I.swaps(TEAM, {slots: 2, per: 2});
  assert.ok(r.core[0], '하랑우탄 = 핵심');
  assert.ok(!r.results.some(x => x.slot === 0));
  for (const x of r.results) {
    for (const o of x.options) {
      const others = TEAM.filter((_, k) => k !== x.slot);
      assert.ok(!others.some(s => M.byId[s.baseId].no === M.byId[o.set.baseId].no), '종 클로즈');
      assert.ok(!others.some(s => s.item && s.item === o.set.item), '아이템 클로즈');
    }
  }
});

test('세트 다듬기: 방어 없는 메타그로스에 방어 추천, 생명의구슬 어흥염에 자뭉열매', () => {
  const meta = I.tune(TEAM, 5);
  assert.ok(meta.some(x => x.kind === 'move' && x.set.moves.includes('Protect')));
  const inc = I.tune(TEAM, 1);
  assert.ok(inc.some(x => x.kind === 'item' && x.set.item === 'Sitrus Berry'));
  // 유턴은 보조기 → 조심 패리퍼에게 성격 바꾸라고 하지 않음
  assert.ok(!I.tune(TEAM, 3).some(x => x.kind === 'nature'));
  // 트릭룸 하랑우탄·냉정 브리두라스에게 스피드 올리라고 하지 않음
  assert.ok(!I.tune(TEAM, 0).some(x => /스피드 SP/.test(x.text)));
  assert.ok(!I.tune(TEAM, 4).some(x => /스피드 SP/.test(x.text)));
});

test('세트 다듬기 결과는 SP 합계 66 이하, 능력치당 32 이하', () => {
  for (let i = 0; i < TEAM.length; i++) {
    for (const x of I.tune(TEAM, i)) {
      const sum = Object.values(x.set.sp).reduce((a, b) => a + b, 0);
      assert.ok(sum <= 66, x.text);
      assert.ok(Object.values(x.set.sp).every(v => v >= 0 && v <= 32), x.text);
    }
  }
});
