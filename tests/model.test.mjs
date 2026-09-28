import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createModel, statValue} from '../src/advisor/model.mjs';
import {attachCalcNames} from '../scripts/calc_names.mjs';

const D = JSON.parse(readFileSync(new URL('../data/pokechamps_mc.json', import.meta.url), 'utf8'));
const missing = attachCalcNames(D);
const M = createModel(D);
const FIELD = {doubles: true, weather: '', terrain: '', crit: false, L: {}, R: {}};

test('모든 도감 항목이 계산 라이브러리 종과 매칭됨', () => {
  assert.deepEqual(missing, []);
});

test('Lv.50 SP 능력치 공식', () => {
  assert.equal(statValue(100, 0, 'hp', 'Adamant'), 175);        // 고릴타 HP
  assert.equal(statValue(125, 32, 'atk', 'Adamant'), 194);      // floor(177*1.1)
  assert.equal(statValue(95, 32, 'hp', 'Careful'), 202);        // 어흥염 HP
  assert.equal(statValue(90, 0, 'spa', 'Adamant'), 99);         // floor(110*0.9)
  const s = M.finalStats({...M.defaultSet('Rillaboom'), nature: 'Adamant', sp: {hp: 0, atk: 32, def: 0, spa: 0, spd: 0, spe: 0}});
  assert.equal(s.atk, 194);
  assert.equal(s.maxHP, 175);
});

test('기본 세트는 사용률 1순위 도구·특성·기술', () => {
  const s = M.defaultSet('Rillaboom');
  assert.equal(s.ability, 'Grassy Surge');
  assert.equal(s.item, 'Life Orb');
  assert.equal(s.moves[0], 'Fake Out');
  assert.equal(s.moves.length, 4);
  const mega = M.defaultSet('Mega Salamence');
  assert.equal(mega.item, 'Salamencite');
});

test('데미지: 생명의구슬 고릴타 우드해머 → H32 어흥염, 그래스필드 더블', () => {
  const att = {...M.defaultSet('Rillaboom'), nature: 'Adamant', sp: {hp: 0, atk: 32, def: 0, spa: 0, spd: 0, spe: 0}, moves: ['Wood Hammer']};
  const def = {...M.defaultSet('Incineroar'), nature: 'Careful', sp: {hp: 32, atk: 0, def: 0, spa: 0, spd: 32, spe: 0}};
  const [r] = M.damageTable(att, def, {...FIELD, terrain: 'Grassy'});
  assert.equal(r.min, 101);
  assert.equal(r.max, 120);
  assert.equal(r.hp, 202);
});

test('변화기·전체기 처리', () => {
  const att = {...M.defaultSet('Salamence'), moves: ['Protect', 'Hyper Voice']};
  const def = M.defaultSet('Rillaboom');
  const [p, hv] = M.damageTable(att, def, FIELD);
  assert.equal(p.status, true);
  assert.ok(hv.spread, '더블에서 하이퍼보이스는 전체기');
  const single = M.damageTable(att, def, {...FIELD, doubles: false})[1];
  assert.ok(single.max > hv.max, '싱글이 더블(0.75배)보다 셈');
});

test('4타 안에 못 잡는 기술은 필요 타수 범위로 표시', () => {
  const att = {...M.defaultSet('Rillaboom'), moves: ['Fake Out']};
  const def = {...M.defaultSet('Incineroar'), nature: 'Careful', sp: {hp: 32, atk: 0, def: 32, spa: 0, spd: 0, spe: 0}};
  const [r] = M.damageTable(att, def, FIELD);
  assert.match(r.koText, /^\d+(~\d+)?타$|^확정 \d+타$/);
  assert.doesNotMatch(r.koText, /0%/);
});

test('스피드: 순풍 2배', () => {
  const s = M.defaultSet('Rillaboom');
  const base = M.speed(s, FIELD, true);
  assert.equal(M.speed(s, {...FIELD, L: {tailwind: true}}, true), base * 2);
});
