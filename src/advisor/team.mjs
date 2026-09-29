// 팀 추천 로직 (DOM 없음)
// 규칙: 같은 도감번호 1마리(종 클로즈), 같은 도구 1개(아이템 클로즈), 메가진화는 배틀당 1번
// 점수 = 파트너 궁합 + 타입 보완 + 빠진 역할 + 인기 + 승률 − 메가 과다
import {GEN} from './model.mjs';

const TYPES = ['normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground', 'flying',
               'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy'];
const cap = t => t[0].toUpperCase() + t.slice(1);
const toID = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const STONE = /ite( [XYZ])?$/;
const isStone = n => STONE.test(n) && n !== 'Eviolite';

// 받는 쪽 특성으로 바뀌는 상성
const ABILITY_DEF = {
  Levitate: {ground: 0}, 'Earth Eater': {ground: 0}, Eelevate: {ground: 0},
  'Flash Fire': {fire: 0}, 'Well-Baked Body': {fire: 0}, 'Water Absorb': {water: 0}, 'Storm Drain': {water: 0},
  'Dry Skin': {water: 0, fire: 1.25}, 'Volt Absorb': {electric: 0}, 'Lightning Rod': {electric: 0}, 'Motor Drive': {electric: 0},
  'Sap Sipper': {grass: 0}, 'Thick Fat': {fire: 0.5, ice: 0.5}, Heatproof: {fire: 0.5}, 'Purifying Salt': {ghost: 0.5},
  'Water Bubble': {fire: 0.5},
};

const ATE = {Aerilate: 'flying', Pixilate: 'fairy', Refrigerate: 'ice', Galvanize: 'electric', Dragonize: 'dragon'};

export const ROLES = {
  fakeout: {ko: '속이다', moves: ['Fake Out']},
  speed: {ko: '스피드 조절', moves: ['Tailwind', 'Trick Room', 'Icy Wind', 'Electroweb', 'Thunder Wave', 'Bleakwind Storm']},
  intimidate: {ko: '위협', abilities: ['Intimidate']},
  redirect: {ko: '유인', moves: ['Follow Me', 'Rage Powder']},
  setter: {ko: '날씨·필드', abilities: ['Drought', 'Drizzle', 'Sand Stream', 'Snow Warning', 'Grassy Surge',
                                      'Psychic Surge', 'Electric Surge', 'Misty Surge', 'Mega Sol']},
  spread: {ko: '전체 공격', spread: true},
};
const KEY_ROLES = ['fakeout', 'speed', 'intimidate'];  // 없으면 크게 아쉬운 역할

// 싱글: 한 마리씩 싸우므로 설치기·교체기·랭크업·선공기·상태이상·회복이 중요
export const ROLES_S = {
  hazard: {ko: '스텔스록·압정', moves: ['Stealth Rock', 'Spikes', 'Toxic Spikes', 'Sticky Web', 'Stone Axe', 'Ceaseless Edge']},
  pivot: {ko: '유턴 교체', moves: ['U-turn', 'Volt Switch', 'Flip Turn', 'Parting Shot', 'Teleport', 'Chilly Reception', 'Shed Tail', 'Baton Pass']},
  setup: {ko: '랭크업 에이스', moves: ['Swords Dance', 'Dragon Dance', 'Nasty Plot', 'Calm Mind', 'Bulk Up', 'Quiver Dance', 'Shell Smash',
                                   'Belly Drum', 'Agility', 'Coil', 'Iron Defense', 'Curse', 'Tidy Up', 'Victory Dance', 'Shift Gear', 'Growth', 'Tail Glow']},
  priority: {ko: '선공기', moves: ['Sucker Punch', 'Extreme Speed', 'Aqua Jet', 'Bullet Punch', 'Ice Shard', 'Mach Punch', 'Shadow Sneak',
                                  'Quick Attack', 'Vacuum Wave', 'Jet Punch', 'Accelerock', 'First Impression', 'Grassy Glide', 'Thunderclap'],
             abilities: ['Prankster', 'Gale Wings']},
  status: {ko: '상태이상', moves: ['Will-O-Wisp', 'Thunder Wave', 'Toxic', 'Spore', 'Sleep Powder', 'Yawn', 'Hypnosis', 'Glare', 'Nuzzle']},
  recovery: {ko: '회복', moves: ['Recover', 'Roost', 'Slack Off', 'Soft-Boiled', 'Moonlight', 'Morning Sun', 'Synthesis', 'Shore Up',
                                 'Milk Drink', 'Strength Sap', 'Wish', 'Rest', 'Pain Split'], abilities: ['Regenerator']},
  scarf: {ko: '스카프·기합의띠', items: ['Choice Scarf', 'Focus Sash'], abilities: ['Sturdy']},
  intimidate: {ko: '위협', abilities: ['Intimidate']},
};
const KEY_ROLES_S = ['hazard', 'setup', 'priority'];

export function effectiveness(atkType, defTypes, ability) {
  let m = 1;
  const t = GEN.types.get(toID(atkType));
  for (const d of defTypes) m *= t.effectiveness[cap(d)] ?? 1;
  const a = ABILITY_DEF[ability];
  if (a && a[atkType] != null) m = a[atkType] === 0 ? 0 : m * a[atkType];
  return m;
}

export function createTeamAdvisor(M) {
  const {D, byId} = M;
  const RL = M.doubles ? ROLES : ROLES_S, KEY = M.doubles ? KEY_ROLES : KEY_ROLES_S;
  const moveEn = i => (typeof i === 'number' ? D.moves[i].en : i);
  const usageById = Object.fromEntries(D.usage.map(u => [u.id, u]));
  const baseOf = id => { const e = byId[id]; return e && e.mega ? e.parent : id; };
  const pool = D.entries.filter(e => !e.mega && usageById[e.id]);  // 사용률 기록이 있는 종만 후보

  // 같이 쓰인 비율: a의 파트너 목록에서 b가 나온 비율(%)
  function tmPct(a, b) {
    const u = usageById[a];
    const t = u && u.tm.find(x => x[2] === b);
    return t ? t[1] : 0;
  }

  // ---------------- 세트 (아이템 클로즈 반영) ----------------
  function teamSets(ids) {
    const used = new Set();
    return ids.map(id => {
      const s = M.defaultSet(id);
      const u = usageById[id];
      const e = byId[id];
      // 메가스톤을 주로 쓰면(40%+) 메가 세트로
      const stone = u && u.it.find(([n, p]) => isStone(n) && p >= 40 && !used.has(n));
      let item = '';
      let megaId = null;
      if (stone && e.megas) {
        item = stone[0];
        const suf = (item.match(/ ([XYZ])$/) || [])[1];
        megaId = e.megas.find(m => ((m.match(/ ([XYZ])$/) || [])[1]) === suf) || null;
      } else if (u) {
        const it = u.it.find(([n]) => !isStone(n) && !used.has(n));
        item = it ? it[0] : '';
      }
      if (item) used.add(item);
      const set = {...s, item};
      if (megaId) Object.assign(set, {id: megaId, ability: byId[megaId].ab[0].en, baseId: id});
      else set.baseId = id;
      return set;
    });
  }

  // ---------------- 역할 ----------------
  function rolesOf(id, set) {
    const u = usageById[id];
    const mv = new Set((u ? u.mv.filter(([, p]) => p >= 15).map(([i]) => moveEn(i)) : []).concat(set ? set.moves : []));
    const abil = new Set([set ? set.ability : null, ...(u ? u.ab.filter(([, p]) => p >= 40).map(x => x[0]) : [])].filter(Boolean));
    const items = new Set([set ? set.item : null, ...(u ? u.it.filter(([, p]) => p >= 30).map(x => x[0]) : [])].filter(Boolean));
    const out = [];
    for (const [k, r] of Object.entries(RL)) {
      if (r.moves && r.moves.some(m => mv.has(m))) out.push(k);
      else if (r.abilities && r.abilities.some(a => abil.has(a))) out.push(k);
      else if (r.items && r.items.some(a => items.has(a))) out.push(k);
      else if (r.spread && [...mv].some(m => {
        const g = GEN.moves.get(toID(m));
        return g && g.category !== 'Status' && /^all/.test(g.target || '');
      })) out.push(k);
    }
    return out;
  }

  // ---------------- 방어 상성 ----------------
  function defProfile(set) {
    const e = byId[set.id];
    return Object.fromEntries(TYPES.map(t => [t, effectiveness(t, e.ty, set.ability)]));
  }

  function analyze(ids, givenSets) {
    const sets = givenSets || teamSets(ids);
    const prof = sets.map(defProfile);
    const types = TYPES.map(t => {
      const weak = prof.filter(p => p[t] > 1).length;
      const resist = prof.filter(p => p[t] < 1 && p[t] > 0).length;
      const immune = prof.filter(p => p[t] === 0).length;
      return {t, weak, resist, immune, danger: weak >= 3 || weak - resist - immune >= 2};
    });
    // 공격 범위: 각 멤버 기본 기술 중 공격기로 효과가 굉장한 타입
    const hits = Object.fromEntries(TYPES.map(t => [t, 0]));
    for (const s of sets) {
      const conv = ATE[s.ability];  // 스카이스킨 등: 노말 기술 타입 변환
      const atkTypes = new Set(s.moves.map(n => D.moves[M.moveByEn[n]]).filter(m => m && m.c !== '변화')
        .map(m => (conv && m.t === 'normal' ? conv : m.t)));
      for (const t of TYPES) if ([...atkTypes].some(a => effectiveness(a, [t]) > 1)) hits[t]++;
    }
    const roles = Object.fromEntries(Object.keys(RL).map(k => [k, []]));
    sets.forEach((s, i) => rolesOf(ids[i], s).forEach(r => roles[r].push(ids[i])));
    const megas = sets.filter(s => s.id !== s.baseId).length;
    const speeds = sets.map(s => ({id: s.id, spe: M.finalStats(s).spe})).sort((a, b) => b.spe - a.spe);
    return {sets, types, hits, roles, megas, speeds};
  }

  // ---------------- 후보 점수 ----------------
  function candidates(ids, n = 12) {
    ids = ids.map(baseOf);
    const taken = new Set(ids.map(id => byId[id].no));
    const A = ids.length ? analyze(ids) : null;
    const res = [];
    for (const e of pool) {
      if (taken.has(e.no)) continue;
      const u = usageById[e.id];
      const set = teamSets([e.id])[0];
      const reasons = [];
      let score = 0;

      // 인기·승률
      const pop = 8 * Math.log10(1 + u.pct);
      score += pop;
      if (u.games >= 500) score += Math.max(-4, Math.min(4, (u.win - 50) * 0.6));

      if (A) {
        // 파트너 궁합: 양방향 평균
        let syn = 0;
        const pairs = [];
        for (const t of ids) {
          const p = (tmPct(t, e.id) + tmPct(e.id, t)) / 2;
          syn += p;
          if (p >= 8) pairs.push([t, p]);
        }
        syn /= ids.length;
        score += syn * 0.9;
        pairs.sort((a, b) => b[1] - a[1]).slice(0, 2)
          .forEach(([t, p]) => reasons.push({k: 'syn', w: p, text: `${byId[t].ko}와 같이 ${p.toFixed(0)}%`}));

        // 타입 보완
        const prof = defProfile(set);
        let def = 0;
        const covers = [], shares = [];
        for (const x of A.types) {
          const gap = x.weak - x.resist - x.immune;
          if (gap >= 1 && prof[x.t] < 1) { def += (prof[x.t] === 0 ? 6 : 4) * gap; covers.push(x.t); }
          if (x.weak >= 2 && prof[x.t] > 1) { def -= 3 * (x.weak - 1) * (prof[x.t] > 2 ? 1.5 : 1); shares.push(x.t); }
        }
        score += def;
        if (covers.length) reasons.push({k: 'cover', w: def, text: `${covers.map(t => D.typeko[t]).join('·')} 약점 보완`});
        if (shares.length) reasons.push({k: 'share', w: -1, bad: true, text: `${shares.map(t => D.typeko[t]).join('·')} 약점 겹침`});

        // 빠진 역할
        const mine = rolesOf(e.id, set);
        for (const r of mine) {
          if (A.roles[r].length) continue;
          const w = KEY.includes(r) ? 9 : 4;
          score += w;
          reasons.push({k: 'role', w, text: `${RL[r].ko} 담당`});
        }

        // 메가 과다 (배틀당 1번이라 3마리째부터 손해)
        if (set.id !== set.baseId && A.megas >= 2) { score -= 12; reasons.push({k: 'mega', w: -1, bad: true, text: '메가가 이미 많음'}); }
      } else {
        reasons.push({k: 'pop', w: pop, text: `사용률 ${u.rank}위 (${u.pct.toFixed(1)}%)`});
      }
      reasons.sort((a, b) => (a.bad - b.bad) || b.w - a.w);
      res.push({id: e.id, score, set, reasons, pct: u.pct, rank: u.rank});
    }
    res.sort((a, b) => b.score - a.score);
    return res.slice(0, n);
  }

  // 1순위 후보로 6마리까지 채우기
  function autoFill(ids) {
    ids = ids.map(baseOf);
    while (ids.length < 6) {
      const [c] = candidates(ids, 1);
      if (!c) break;
      ids = ids.concat(c.id);
    }
    return ids;
  }

  return {candidates, autoFill, analyze, teamSets, rolesOf, baseOf, TYPES, ROLES: RL, KEY_ROLES: KEY};
}
