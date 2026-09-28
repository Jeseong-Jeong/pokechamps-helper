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

test('운영 방식 자동 감지: 트릭룸(하랑우탄) + 비(패리퍼), 무시로 바꿀 수 있음', () => {
  const plan = I.planOf(TEAM);
  assert.equal(plan.tr, true);
  assert.equal(plan.weather, 'Rain');
  assert.equal(plan.trUser, 'Oranguru');
  I.setOverride({tr: 'off', weather: 'off'});
  assert.equal(I.planOf(TEAM).tr, false);
  assert.equal(I.planOf(TEAM).weather, '');
  I.setOverride({tr: 'auto', weather: 'auto'});
});

test('트릭룸일 때 느린 멤버가 먼저 움직이는 상대가 늘어남', () => {
  const ms = I.members(TEAM);
  const gol = ms[2];  // 용감 갑주무사 (스피드 54)
  assert.ok(gol.mode.trFirst[1] > gol.mode.trFirst[0], JSON.stringify(gol.mode));
  assert.ok(gol.keep.some(t => t.includes('트릭룸')));
});

test('아이언롤러 메타그로스: 상대 필드 제거가 남길 이유로 잡힘', () => {
  const meta = I.members(TEAM)[5];
  assert.ok(meta.keep.some(t => t.includes('필드')), meta.keep.join(' / '));
  const noRoller = TEAM.map((s, i) => (i === 5 ? {...s, moves: ['Iron Head', 'Bullet Punch', 'Ice Punch', 'Psychic Fangs']} : s));
  assert.ok(I.score(TEAM).parts.field > I.score(noRoller).parts.field);
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

test('선출: 트릭룸 팀은 트릭룸 담당 + 속이다 선봉, 게임 플랜·상대별 대응 6개', () => {
  const r = P.recommend(TEAM, ['Rillaboom', 'Sneasler', 'Incineroar', 'Salamence', 'Kingambit', 'Indeedee-F']);
  assert.equal(r.picks[0].idx.length, 4);
  assert.ok(r.picks[0].useTR, '트릭룸 담당을 데려감');
  const lead = r.leads[0].lead.map(i => TEAM[i].baseId);
  assert.ok(lead.includes('Oranguru') && lead.includes('Incineroar'), lead.join(','));
  assert.equal(r.answers.length, 6);
  assert.ok(r.gamePlan[0].startsWith('1턴'));
  // 메가는 선출 4마리 안에서 1마리만
  const megas = r.picks[0].idx.filter(i => TEAM[i].id !== TEAM[i].baseId);
  if (megas.length) assert.ok(megas.includes(r.picks[0].megaI));
});

test('GPT용 상세내용: 팀·규칙·진단·조건·요청이 들어간 마크다운', async () => {
  const {teamReportMarkdown} = await import('../src/advisor/export-md.mjs');
  const result = await I.swaps(TEAM, {slots: 1, per: 2});
  const md = teamReportMarkdown({M, I, sets: TEAM, result, constraints: ['메가 없이'], chatLog: [{who: 'me', text: '메가 슬롯이 애매해'}]});
  for (const h of ['## 내 팀', '## 게임 규칙', '## 봇 진단 요약', '## 멤버별 기여도', '## 봇의 교체 추천', '## 내가 붙인 조건', '## 요청']) assert.ok(md.includes(h), h);
  assert.ok(md.includes('하랑우탄(Oranguru)'));
  assert.ok(md.includes('21-0-30-0-0-15'));
  assert.ok(md.includes('메가 없이'));
});
