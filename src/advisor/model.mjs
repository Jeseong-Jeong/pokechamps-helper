// 추천 봇의 데이터·계산 계층 (DOM 없음 → node --test 로 테스트 가능)
// 데미지 계산은 @smogon/calc 의 Champions 규칙(gen 0)을 씁니다.
//   - Lv.50, 개체값 고정, 노력치 대신 SP(능력치당 0~32, 합계 66) → calc의 evs 자리에 SP를 그대로 넣음
//   - HP = 종족값+75+SP, 나머지 = floor((종족값+20+SP) × 성격)
import {calculate, Generations, Pokemon, Move, Field} from '@smogon/calc';
import calcUtil from '@smogon/calc/dist/mechanics/util.js';

const {getFinalSpeed} = calcUtil;

export const GEN = Generations.get(0);
export const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
export const STAT_KO = {hp: 'HP', atk: '공격', def: '방어', spa: '특공', spd: '특방', spe: '스피드'};
export const SP_MAX = 32, SP_TOTAL = 66;

export const NATURES = {  // [올리는 능력치, 내리는 능력치]
  Hardy: [], Lonely: ['atk', 'def'], Brave: ['atk', 'spe'], Adamant: ['atk', 'spa'], Naughty: ['atk', 'spd'],
  Bold: ['def', 'atk'], Docile: [], Relaxed: ['def', 'spe'], Impish: ['def', 'spa'], Lax: ['def', 'spd'],
  Timid: ['spe', 'atk'], Hasty: ['spe', 'def'], Serious: [], Jolly: ['spe', 'spa'], Naive: ['spe', 'spd'],
  Modest: ['spa', 'atk'], Mild: ['spa', 'def'], Quiet: ['spa', 'spe'], Bashful: [], Rash: ['spa', 'spd'],
  Calm: ['spd', 'atk'], Gentle: ['spd', 'def'], Sassy: ['spd', 'spe'], Careful: ['spd', 'spa'], Quirky: [],
};

export const WEATHER = {'': '없음', Sun: '쾌청', Rain: '비', Sand: '모래바람', Snow: '설경'};
export const TERRAIN = {'': '없음', Electric: '일렉트릭필드', Grassy: '그래스필드', Psychic: '사이코필드', Misty: '미스트필드'};
export const STATUS = {'': '없음', brn: '화상', par: '마비', psn: '독', tox: '맹독', slp: '잠듦', frz: '얼음'};

const toID = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const STONE = /ite( [XYZ])?$/;

export function statValue(base, sp, stat, nature) {
  if (stat === 'hp') return base + 75 + sp;
  const [up, down] = NATURES[nature] || [];
  const m = stat === up ? 1.1 : stat === down ? 0.9 : 1;
  return Math.floor((base + 20 + sp) * m);
}

export function createModel(D) {
  const byId = Object.fromEntries(D.entries.map(e => [e.id, e]));
  const usageOf = e => e && D.usage.find(u => u.id === (e.mega ? e.parent : e.id));
  const moveByEn = Object.fromEntries(D.moves.map((m, i) => [m.en, i]));
  const itemKo = n => D.itemko[n] || n;
  const moveKo = n => { const i = moveByEn[n]; return i == null ? n : (D.moves[i].ko || n); };

  // 사용률에 나온 도구 전부 + 자주 쓰는 도구 (한글명 있는 것만 정렬)
  const items = [...new Set(D.usage.flatMap(u => u.it.map(x => x[0])))].sort((a, b) => itemKo(a).localeCompare(itemKo(b), 'ko'));

  function learnset(e) {
    const base = e.mega ? byId[e.parent] : e;
    return [...new Set(base.mv)].map(i => D.moves[i]);
  }

  // ---------------- 기본 세트 (사용률 1순위 기반) ----------------
  function defaultSet(id) {
    const e = byId[id];
    const u = usageOf(e);
    const abNames = e.ab.map(a => a.en);
    let ability = abNames[0] || '';
    if (!e.mega && u) {
      const top = u.ab.find(([n]) => abNames.includes(n));
      if (top) ability = top[0];
    }
    let item = '';
    if (u) {
      if (e.mega) {  // 메가 → 알맞은 메가스톤
        const suf = (e.id.match(/ ([XYZ])$/) || [])[1];
        const st = u.it.find(([n]) => STONE.test(n) && ((n.match(/ ([XYZ])$/) || [])[1] === suf));
        item = st ? st[0] : '';
      } else {
        const it = u.it.find(([n]) => !(STONE.test(n) && n !== 'Eviolite'));
        item = it ? it[0] : '';
      }
    }
    const ls = learnset(e);
    const lsNames = new Set(ls.map(m => m.en));
    let moves = u ? u.mv.map(([i]) => (typeof i === 'number' ? D.moves[i].en : i)).filter(n => lsNames.has(n)) : [];
    if (moves.length < 4) {  // 사용률 데이터 없음 → 자속 고위력 기술로 채움
      const extra = ls.filter(m => m.c !== '변화' && !moves.includes(m.en))
        .sort((a, b) => score(b) - score(a)).map(m => m.en);
      moves = moves.concat(extra);
    }
    function score(m) { return (+m.pw || 0) * (e.ty.includes(m.t) ? 1.5 : 1) * ((+m.acc || 100) / 100); }
    const physical = guessPhysical(e, moves.slice(0, 4));
    return {
      id, ability, item, moves: moves.slice(0, 4),
      ...preset(physical ? 'atk' : 'spa', e),
      boosts: {atk: 0, def: 0, spa: 0, spd: 0, spe: 0}, status: '', hpPct: 100,
    };
  }
  function guessPhysical(e, moves) {
    let p = 0, s = 0;
    for (const n of moves) { const i = moveByEn[n]; if (i == null) continue; const c = D.moves[i].c; if (c === '물리') p++; else if (c === '특수') s++; }
    return p === s ? e.st[1] >= e.st[3] : p > s;
  }

  // 능력치 배분 프리셋
  function preset(kind, e) {
    const z = {hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0};
    switch (kind) {
      case 'atk': return {nature: 'Adamant', sp: {...z, atk: 32, spe: 32, hp: 2}};
      case 'spa': return {nature: 'Modest', sp: {...z, spa: 32, spe: 32, hp: 2}};
      case 'atk-fast': return {nature: 'Jolly', sp: {...z, atk: 32, spe: 32, hp: 2}};
      case 'spa-fast': return {nature: 'Timid', sp: {...z, spa: 32, spe: 32, hp: 2}};
      case 'hb': return {nature: e && e.st[1] >= e.st[3] ? 'Impish' : 'Bold', sp: {...z, hp: 32, def: 32, spd: 2}};
      case 'hd': return {nature: e && e.st[1] >= e.st[3] ? 'Careful' : 'Calm', sp: {...z, hp: 32, spd: 32, def: 2}};
      default: return {nature: 'Serious', sp: z};
    }
  }

  // ---------------- 계산 ----------------
  function toCalcMon(set) {
    const e = byId[set.id];
    const mon = new Pokemon(GEN, e.calc, {
      level: 50, nature: set.nature, evs: set.sp, ability: set.ability || undefined,
      item: set.item || undefined, boosts: set.boosts, status: set.status || undefined,
    });
    if (set.hpPct < 100) mon.originalCurHP = Math.max(1, Math.floor(mon.maxHP() * set.hpPct / 100));
    return mon;
  }

  // field = {doubles, weather, terrain, crit, L: SIDE, R: SIDE}
  //   SIDE = {helpingHand, tailwind, reflect, lightScreen, auroraVeil, friendGuard}
  // L = 화면 왼쪽(내 포켓몬) 진영, R = 오른쪽(상대) 진영. 공격 방향에 따라 attacker/defender 쪽에 배치
  function side(s = {}) {
    return {isHelpingHand: !!s.helpingHand, isTailwind: !!s.tailwind, isReflect: !!s.reflect,
            isLightScreen: !!s.lightScreen, isAuroraVeil: !!s.auroraVeil, isFriendGuard: !!s.friendGuard};
  }
  function toField(f, attackerIsLeft) {
    const [a, d] = attackerIsLeft ? [f.L, f.R] : [f.R, f.L];
    return new Field({gameType: f.doubles ? 'Doubles' : 'Singles', weather: f.weather || undefined,
                      terrain: f.terrain || undefined, attackerSide: side(a), defenderSide: side(d)});
  }

  // 실제 스피드 (랭크·스카프·순풍·마비·날씨 특성 등 반영)
  function speed(set, f, isLeft) {
    const fld = toField(f, isLeft);
    return getFinalSpeed(GEN, toCalcMon(set), fld, fld.attackerSide);
  }

  // 한 방향(공격 세트 → 방어 세트)의 기술별 결과
  function damageTable(att, def, field, attackerIsLeft = true) {
    const out = [];
    for (const name of att.moves) {
      if (!name) continue;
      const i = moveByEn[name];
      const m = i == null ? null : D.moves[i];
      if (!m || m.c === '변화') { out.push({name, ko: moveKo(name), status: true}); continue; }
      if (!GEN.moves.get(toID(name))) { out.push({name, ko: moveKo(name), unsupported: true}); continue; }
      try {
        const r = calculate(GEN, toCalcMon(att), toCalcMon(def), new Move(GEN, name, {isCrit: field.crit}),
                            toField(field, attackerIsLeft));
        out.push(summarize(r, name));
      } catch (err) {
        out.push({name, ko: moveKo(name), error: String(err && err.message || err)});
      }
    }
    return out;
  }

  function summarize(r, name) {
    const hp = r.defender.maxHP();
    const [lo, hi] = r.range();
    let ko = null;
    try { ko = r.kochance(); } catch (e) { /* 0 데미지 등 */ }
    return {
      name, ko: moveKo(name), type: r.move.type, category: r.move.category,
      min: lo, max: hi, hp, minPct: lo / hp * 100, maxPct: hi / hp * 100,
      koText: koKo(ko, lo, hi, r.defender.curHP()), spread: r.move.target && /all/i.test(r.move.target) && r.field.gameType === 'Doubles',
      desc: r.desc && safe(() => r.desc()),
    };
  }

  function koKo(k, lo, hi, cur) {
    if (!hi) return '데미지 없음';
    if (!k || !k.n || !k.chance) {  // 4타 안에 못 잡으면 calc가 chance 0을 줌 → 필요한 타수 범위로 표시
      const n = Math.ceil(cur / hi), n2 = Math.ceil(cur / Math.max(lo, 1));
      return n === n2 ? `확정 ${n}타` : `${n}~${n2}타`;
    }
    const c = Math.round((k.chance || 0) * 1000) / 10;
    return c >= 100 ? `확정 ${k.n}타` : `난수 ${k.n}타 (${c}%)`;
  }

  function finalStats(set) {
    const m = toCalcMon(set);
    return {...m.stats, maxHP: m.maxHP()};
  }

  return {D, byId, usageOf, learnset, defaultSet, preset, damageTable, finalStats, speed, items, itemKo, moveKo, moveByEn};
}

function safe(f) { try { return f(); } catch (e) { return ''; } }
