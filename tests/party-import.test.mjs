// 사용자가 준 파티 화면 스크린샷(2000×923) 두 장의 글자 위치·내용을 OCR 결과처럼 재현해서 해석부를 검사
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createModel} from '../src/advisor/model.mjs';
import {createPartyReader, similarity} from '../src/advisor/party-import.mjs';
import {attachCalcNames, buildItemDict} from '../scripts/calc_names.mjs';

const D = JSON.parse(readFileSync(new URL('../data/pokechamps_mc.json', import.meta.url), 'utf8'));
const S = JSON.parse(readFileSync(new URL('../raw/pchamps_serebii.json', import.meta.url), 'utf8'));
attachCalcNames(D);
const M = createModel(D);
const R = createPartyReader(M, buildItemDict(D, S));

const W = (text, x, y, h = 30) => ({text, x0: x, y0: y - h / 2, x1: x + text.length * h * 0.95, y1: y + h / 2});
const CARD = [[0, 272], [1, 272], [0, 458], [1, 458], [0, 644], [1, 644]];  // [열, 이름 줄 y]
const X = [[405, 415, 765], [1095, 1102, 1453]];                          // [이름 x, 특성·도구 x, 기술 x]

function abilityShot(cards) {
  const words = [];
  cards.forEach(([name, ab, item, moves], i) => {
    const [c, y] = CARD[i], [xn, xa, xm] = X[c];
    words.push(W(name, xn, y), W(ab, xa, y + 39, 26), W(item, xa, y + 80, 26));
    moves.forEach((m, k) => words.push(W(m, xm, y + 1 + k * 39, 26)));
  });
  return {words, width: 2000, height: 923};
}
function statShot(cards) {
  const words = [];
  const LX = [[410, 525, 612, 713, 826, 912], [1098, 1213, 1300, 1400, 1527, 1600]];
  cards.forEach(([name, rows], i) => {
    const [c, y] = CARD[i], x = LX[c];
    words.push(W(name, X[c][0], y));
    rows.forEach(([l1, v1, s1, l2, v2, s2], k) => {
      const yy = y + 39 + k * 38;
      words.push(W(l1, x[0], yy, 24), W(String(v1), x[1], yy, 24), W(String(s1), x[2], yy, 24),
                 W(l2, x[3], yy, 24), W(String(v2), x[4], yy, 24), W(String(s2), x[5], yy, 24));
    });
  });
  return {words, width: 2000, height: 923};
}

const ABILITY = abilityShot([
  ['하랑우탄', '정신력', '멘탈허브', ['지휘', '트릭룸', '비바라기', '사이코키네시스']],
  ['어흥염', '위협', '생명의구슬', ['지옥찌르기', '플레어드라이브', '속이다', '막말내뱉기']],
  ['갑주무사', '위기회피', '갑주무사나이트', ['만나자마자', '흡혈', '아쿠아브레이크', '칼춤']],
  ['패리퍼', '잔비', '기합의띠', ['폭풍', '와이드가드', '유턴', '웨더볼']],
  ['브리두라스', '지구력', '먹다남은음식', ['일렉트로빔', '러스터캐논', '용의파동', '방어']],
  ['메타그로스', '클리어바디', '메타그로스나이트', ['아이언롤러', '불릿펀치', '냉동펀치', '사이코팽']],
]);
const STAT = statShot([
  ['하랑우탄', [['HP', 186, 21, '특수공격', 110, 0], ['공격', 72, 0, '특수방어', 130, 0], ['방어', 143, 30, '스피드', 95, 15]]],
  ['어흥염', [['HP', 202, 32, '특수공격', 90, 0], ['공격', 183, 32, '특수방어', 110, 0], ['방어', 112, 2, '스피드', 80, 0]]],
  ['갑주무사', [['HP', 182, 32, '특수공격', 80, 0], ['공격', 194, 32, '특수방어', 112, 2], ['방어', 160, 0, '스피드', 54, 0]]],
  ['패리퍼', [['HP', 137, 2, '특수공격', 161, 32], ['공격', 63, 0, '특수방어', 90, 0], ['방어', 120, 0, '스피드', 117, 32]]],
  ['브리두라스', [['HP', 197, 32, '특수공격', 161, 2], ['공격', 125, 0, '특수방어', 117, 32], ['방어', 150, 0, '스피드', 94, 0]]],
  ['메타그로스', [['HP', 187, 32, '특수공격', 103, 0], ['공격', 205, 32, '특수방어', 112, 2], ['방어', 150, 0, '스피드', 90, 0]]],
]);

test('자모 비교: 한 글자 틀려도 찾음', () => {
  assert.ok(similarity('메타그로스', '메타그로스') === 1);
  assert.equal(R.findMon('메타그로즈').value, '메타그로스');
  assert.equal(R.findMove('아이언롤라').value, 'Steel Roller');
  assert.equal(R.findItem('먹다남은움식').value, 'Leftovers');
});

test('능력 + 스테이터스 두 장 → 6마리 세트', () => {
  const out = R.read([ABILITY, STAT]);
  assert.equal(out.length, 6);
  const [o, inc, gol, pel, arc, meta] = out.map(x => x.set);
  assert.equal(o.id, 'Oranguru');
  assert.equal(o.ability, 'Inner Focus');
  assert.equal(o.item, 'Mental Herb');
  assert.deepEqual(o.moves, ['Instruct', 'Trick Room', 'Rain Dance', 'Psychic']);
  assert.equal(o.nature, 'Bold');                       // 방어↑ 공격↓
  assert.deepEqual(o.sp, {hp: 21, atk: 0, def: 30, spa: 0, spd: 0, spe: 15});
  assert.equal(inc.nature, 'Adamant');
  assert.deepEqual(inc.moves, ['Throat Chop', 'Flare Blitz', 'Fake Out', 'Parting Shot']);
  assert.equal(gol.id, 'Mega Golisopod');                // 메가스톤 → 메가 형태
  assert.equal(gol.item, 'Golisopite');
  assert.equal(pel.item, 'Focus Sash');
  assert.equal(pel.nature, 'Modest');
  assert.equal(arc.item, 'Leftovers');
  assert.equal(meta.id, 'Mega Metagross');
  assert.equal(meta.sp.atk, 32);
  for (const x of out) assert.deepEqual(x.warn, [], x.set.id + ' ' + x.warn.join(','));
});

test('한 장만 올려도 됨 (능력 화면만 → 성격·SP는 기본값)', () => {
  const out = R.read([ABILITY]);
  assert.equal(out.length, 6);
  assert.equal(out[0].found.stats, false);
  assert.equal(out[0].set.item, 'Mental Herb');
});

test('숫자를 잘못 읽어도 성격·SP 복원 (실제 OCR 오인식: HP→10, 110→10, 0→ㅇㅇ)', () => {
  // 브라우저 OCR이 어흥염 카드에서 실제로 낸 결과
  const w = (text, x0, x1, y0, y1) => ({text, x0, x1, y0, y1, conf: 80});
  const words = [
    w('어', 1095, 1119, 258, 286), w('흥', 1126, 1150, 258, 286), w('염', 1155, 1179, 259, 286),
    w('10', 1102, 1130, 303, 320), w('202', 1216, 1254, 303, 320), w('32', 1300, 1324, 303, 320),
    w('특', 1404, 1440, 300, 321), w('수', 1452, 1467, 300, 320), w('공격', 1477, 1517, 295, 328), w('90_', 1525, 1549, 303, 320), w('0', 1602, 1614, 303, 320),
    w('공격', 1101, 1144, 337, 360), w('183', 1218, 1253, 341, 358), w('32', 1300, 1324, 341, 358),
    w('특', 1404, 1440, 338, 360), w('수', 1454, 1467, 337, 359), w('방', 1477, 1495, 337, 360), w('어', 1494, 1515, 333, 366), w('10', 1513, 1549, 341, 358), w('ㅇㅇ', 1602, 1614, 341, 358),
    w('방어', 1102, 1144, 375, 397), w('112', 1217, 1254, 379, 395), w('2', 1313, 1324, 379, 395),
    w('스피드', 1404, 1473, 375, 397), w('80', 1525, 1549, 379, 395), w('0', 1602, 1614, 379, 395),
  ];
  const [r] = R.read([{words, width: 2000, height: 923}]);
  assert.equal(r.set.id, 'Incineroar');
  assert.equal(r.set.nature, 'Adamant');
  assert.deepEqual(r.set.sp, {hp: 32, atk: 32, def: 2, spa: 0, spd: 0, spe: 0});
  assert.ok(r.warn.includes('능력치'), '확신이 낮으면 확인 표시');
});

test('이름 줄에 아이콘 쓰레기 글자·첫 기술이 붙어도 이름을 떼어냄', () => {
  const w = (text, x0, x1, y0 = 258, y1 = 286) => ({text, x0, x1, y0, y1, conf: 70});
  // 캐릭터 아이콘→"로", 성별·타입 아이콘→"8","@","ㅎ" 로 읽혀 간격 없이 이어진 경우
  const words = [
    w('로', 1040, 1080), w('어', 1095, 1119), w('흥', 1126, 1150), w('염', 1155, 1179),
    w('8', 1200, 1225), w('@', 1235, 1260), w('ㅎ', 1270, 1300), w('U', 1330, 1360), w('지옥찌르기', 1390, 1560),
    w('위협', 1102, 1144, 300, 322), w('생명의구슬', 1102, 1210, 341, 363),
    w('플레어드라이브', 1453, 1600, 300, 322), w('속이다', 1453, 1520, 339, 361), w('막말내뱉기', 1453, 1560, 378, 400),
  ];
  const slots = R.readSlots([{words, width: 2000, height: 923}]);
  const inc = slots[1];
  assert.ok(inc, '2번 칸(오른쪽 위)에 어흥염');
  assert.equal(inc.set.id, 'Incineroar');
  assert.equal(inc.set.item, 'Life Orb');
  assert.deepEqual(inc.set.moves, ['Throat Chop', 'Flare Blitz', 'Fake Out', 'Parting Shot']);
  assert.equal(slots.filter(Boolean).length, 1);
});

test('화면 위쪽 플레이어 이름이 포켓몬 이름이어도 6번째 카드까지 제자리', () => {
  const top = [W('왕구리', 1215, 110), W('팀1', 760, 110), W('능력', 830, 207), W('스테이터스', 1090, 207)];
  const ab = {...ABILITY, words: [...top, ...ABILITY.words]};
  // 스테이터스 화면은 "스피드"를 "스미드"(샤미드와 비슷)로 잘못 읽었다고 가정
  const st = {...STAT, words: [...top, ...STAT.words.map(w => (w.text === '스피드' ? {...w, text: '스미드'} : w))]};
  const out = R.readSlots([ab, st]);
  assert.deepEqual(out.map(x => x && x.baseId), ['Oranguru', 'Incineroar', 'Golisopod', 'Pelipper', 'Archaludon', 'Metagross']);
  assert.equal(out[0].set.nature, 'Bold');      // 하랑우탄: 방어↑ 공격↓
  assert.equal(out[5].set.nature, 'Adamant');
});

test('위쪽 카드를 못 읽어도 아래 카드가 한 칸씩 밀리지 않음', () => {
  const drop = shot => ({...shot, words: shot.words.filter(w => !(w.x0 > 1000 && w.y0 < 420))});  // 2번(오른쪽 위) 카드 통째로 없음
  const out = R.readSlots([drop(ABILITY), drop(STAT)]);
  assert.equal(out[1], null);
  assert.equal(out[3].baseId, 'Pelipper');
  assert.equal(out[5].baseId, 'Metagross');
  assert.equal(out[3].set.nature, 'Modest');
});

test('실제 오인식: 메타그로스 특공 103→123, 특방 112→12 여도 고집 32-32-0-0-2-0', () => {
  const w = (text, x0, x1, y0, y1) => ({text, x0, x1, y0, y1, conf: 80});
  const words = [
    w('메', 1096, 1120, 259, 286), w('타', 1130, 1151, 259, 286), w('그로스', 1155, 1240, 259, 286), w('ㅎㅇ', 1300, 1315, 264, 279),
    w('10', 1102, 1130, 303, 320), w('187', 1218, 1254, 303, 320), w('32', 1300, 1324, 303, 320),
    w('특', 1404, 1440, 300, 321), w('수', 1452, 1467, 300, 320), w('공', 1477, 1495, 299, 321), w('격', 1494, 1515, 295, 328), w('123', 1513, 1548, 303, 320), w('ㅇ', 1602, 1614, 303, 320),
    w('공격', 1101, 1144, 337, 360), w('205', 1216, 1253, 341, 358), w('32', 1300, 1324, 341, 358),
    w('특', 1404, 1440, 338, 360), w('수', 1454, 1466, 337, 359), w('방', 1477, 1495, 337, 360), w('어', 1494, 1515, 333, 370), w('12_', 1513, 1549, 341, 358), w('2', 1603, 1614, 341, 358),
    w('방어', 1102, 1144, 375, 397), w('150', 1217, 1254, 379, 395), w('0', 1312, 1324, 379, 395),
    w('스피드', 1404, 1473, 375, 397), w('90', 1525, 1549, 379, 395), w('0', 1602, 1614, 379, 395),
  ];
  const [r] = R.read([{words, width: 2000, height: 923}]);
  assert.equal(r.baseId, 'Metagross');
  assert.equal(r.set.nature, 'Adamant');
  assert.deepEqual(r.set.sp, {hp: 32, atk: 32, def: 0, spa: 0, spd: 2, spe: 0});
});

test('실수치 역산: 무보정 성격', () => {
  const e = M.byId.Incineroar;
  const r = R.solve(e, {hp: 170, atk: 135, def: 110, spa: 100, spd: 110, spe: 80}, null);
  assert.equal(r.nature, 'Serious');
  assert.equal(r.total, 0);
});

test('실제 게임 스크린샷 두 장(능력·스테이터스)의 OCR 결과 → 6마리 세트 전부 정답, 경고 없음', () => {
  // tests/fixtures/real_shots.json: 사용자가 준 실제 팀 화면을 브라우저 Tesseract로 읽은 단어 목록 (맨 위 플레이어 이름 줄 제외)
  const shots = JSON.parse(readFileSync(new URL('./fixtures/real_shots.json', import.meta.url), 'utf8'));
  const out = R.readSlots(shots);
  const want = [
    ['Oranguru', 'Oranguru', 'Mental Herb', 'Inner Focus', ['Instruct', 'Trick Room', 'Rain Dance', 'Psychic'], 'Bold', [21, 0, 30, 0, 0, 15]],
    ['Incineroar', 'Incineroar', 'Life Orb', 'Intimidate', ['Throat Chop', 'Flare Blitz', 'Fake Out', 'Parting Shot'], 'Adamant', [32, 32, 2, 0, 0, 0]],
    ['Golisopod', 'Mega Golisopod', 'Golisopite', null, ['First Impression', 'Leech Life', 'Liquidation', 'Swords Dance'], 'Brave', [32, 32, 0, 0, 2, 0]],
    ['Pelipper', 'Pelipper', 'Focus Sash', 'Drizzle', ['Hurricane', 'Wide Guard', 'U-turn', 'Weather Ball'], 'Modest', [2, 0, 0, 32, 0, 32]],
    ['Archaludon', 'Archaludon', 'Leftovers', 'Stamina', ['Electro Shot', 'Flash Cannon', 'Dragon Pulse', 'Protect'], 'Quiet', [32, 0, 0, 2, 32, 0]],
    ['Metagross', 'Mega Metagross', 'Metagrossite', null, ['Steel Roller', 'Bullet Punch', 'Ice Punch', 'Psychic Fangs'], 'Adamant', [32, 32, 0, 0, 2, 0]],
  ];
  want.forEach(([base, id, item, ability, moves, nature, sp], i) => {
    const x = out[i];
    assert.ok(x, `${i + 1}번 칸`);
    assert.equal(x.baseId, base);
    assert.equal(x.set.id, id);
    assert.equal(x.set.item, item);
    if (ability) assert.equal(x.set.ability, ability);
    assert.deepEqual(x.set.moves, moves, base);
    assert.equal(x.set.nature, nature, base);
    assert.deepEqual(['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map(k => x.set.sp[k]), sp, base);
    assert.deepEqual(x.warn, [], base + ' 경고: ' + x.warn.join(','));
  });
});
