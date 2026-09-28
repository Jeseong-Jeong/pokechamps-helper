import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createModel} from '../src/advisor/model.mjs';
import {createChat} from '../src/advisor/chat.mjs';
import {attachCalcNames} from '../scripts/calc_names.mjs';

const D = JSON.parse(readFileSync(new URL('../data/pokechamps_mc.json', import.meta.url), 'utf8'));
attachCalcNames(D);
const M = createModel(D);
const C = createChat(M, D);
const TEAM = ['Oranguru', 'Incineroar', 'Golisopod', 'Pelipper', 'Archaludon', 'Metagross'];
const P = t => C.parse(t, {teamIds: TEAM});

test('사용자 예시 1: 대짱이로 바꾸면 메가 슬롯이 애매해', () => {
  const r = P('어 근데 대짱이로 바꾸면 메가진화를 줘야돼서 슬롯이 애매해');
  assert.equal(r.changes.noMega, true);
});

test('사용자 예시 2: 풀 네배라 별로야. 고릴타한테 죽어 대짱이 말고 다른애 추천해줘', () => {
  const r = P('풀 네배라 별로야. 고릴타한테 죽어 대짱이 말고 다른애 추천해줘');
  assert.deepEqual(r.changes.avoidWeak, [{type: 'grass', min: 4}]);
  assert.deepEqual(r.changes.mustSurvive, ['Rillaboom']);
  assert.deepEqual(r.changes.exclude, ['Swampert']);
  assert.equal(r.more, true);
});

test('내 팀 멤버: 유지 / 자리 교체', () => {
  assert.deepEqual(P('메타그로스는 빼지 마').changes.lock, ['Metagross']);
  assert.deepEqual(P('브리두라스 대신 넣을 애').changes.target, ['Archaludon']);
  assert.deepEqual(P('하랑우탄 빼고 싶어').changes.target, ['Oranguru']);
});

test('질문: 왜 / 어때', () => {
  assert.deepEqual(P('왜 메타그로스를 빼래?').ask, {kind: 'why', id: 'Metagross'});
  assert.deepEqual(P('한카리아스는 어때?').ask, {kind: 'how', id: 'Garchomp'});
});

test('역할·스피드·타입·공격 종류', () => {
  const r = P('속이다 있는 느린 물 타입으로 추천해줘');
  assert.deepEqual(r.changes.roles, ['fakeout']);
  assert.equal(r.changes.speed, 'slow');
  assert.deepEqual(r.changes.types, ['water']);
  assert.equal(P('특수 공격하는 애').changes.category, '특수');
  assert.deepEqual(P('땅 약점 있는 애는 싫어').changes.avoidWeak, [{type: 'ground', min: 2}]);
});

test('조건 합치기·지우기·초기화', () => {
  let cons = {};
  cons = C.merge(cons, P('대짱이 말고').changes);
  cons = C.merge(cons, P('한카리아스도 말고').changes);
  assert.deepEqual(cons.exclude, ['Swampert', 'Garchomp']);
  cons = C.removeOne(cons, 'exclude', 'Swampert');
  assert.deepEqual(cons.exclude, ['Garchomp']);
  assert.equal(P('처음부터 다시').reset, true);
  assert.ok(C.describe({noMega: true, exclude: ['Garchomp']}).length === 2);
});

test('모르는 말은 unknown', () => {
  assert.equal(P('ㅋㅋㅋ').unknown, true);
});
