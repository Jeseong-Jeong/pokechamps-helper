import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createModel} from '../src/advisor/model.mjs';
import {createTeamAdvisor, effectiveness} from '../src/advisor/team.mjs';
import {attachCalcNames} from '../scripts/calc_names.mjs';

const D = JSON.parse(readFileSync(new URL('../data/pokechamps_mc.json', import.meta.url), 'utf8'));
attachCalcNames(D);
const M = createModel(D);
const T = createTeamAdvisor(M);

test('상성 계산 + 특성', () => {
  assert.equal(effectiveness('ice', ['dragon', 'flying']), 4);
  assert.equal(effectiveness('ground', ['electric']), 2);
  assert.equal(effectiveness('ground', ['electric'], 'Levitate'), 0);
  assert.equal(effectiveness('fire', ['grass', 'steel'], 'Thick Fat'), 2);
});

test('빈 팀이면 사용률 순', () => {
  const c = T.candidates([], 3);
  assert.deepEqual(c.map(x => x.rank), [1, 2, 3]);
});

test('종 클로즈: 같은 도감번호는 후보에서 빠짐', () => {
  const c = T.candidates(['Indeedee-F'], 200);
  assert.ok(!c.some(x => D.entries.find(e => e.id === x.id).no === 876));
});

test('메가 항목을 넣어도 원래 종으로 취급', () => {
  const c = T.candidates(['Mega Salamence'], 200);
  assert.ok(!c.some(x => x.id === 'Salamence'));
});

test('자동 채우기: 6마리, 도감번호·도구 중복 없음', () => {
  const ids = T.autoFill(['Rillaboom']);
  assert.equal(ids.length, 6);
  const nos = ids.map(id => D.entries.find(e => e.id === id).no);
  assert.equal(new Set(nos).size, 6);
  const items = T.teamSets(ids).map(s => s.item).filter(Boolean);
  assert.equal(new Set(items).size, items.length);
});

test('파트너 궁합이 점수에 반영됨: 고릴타의 1순위 파트너가 상위 후보', () => {
  const top = T.candidates(['Rillaboom'], 5).map(x => x.id);
  assert.ok(top.includes('Incineroar') || top.includes('Sneasler') || top.includes('Salamence'), top.join(','));
});

test('팀 분석: 역할·약점', () => {
  const A = T.analyze(['Rillaboom', 'Incineroar', 'Salamence']);
  assert.ok(A.roles.fakeout.length >= 1);
  assert.ok(A.roles.intimidate.includes('Incineroar'));
  assert.equal(A.types.length, 18);
  assert.equal(A.sets.length, 3);
});
