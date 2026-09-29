// 배틀 도우미 (DOM 없음): 필드 상황 → 이번 턴 추천 행동
// 1) 상대 행동 예측: 각 상대가 가장 많이 들어가는 기술·대상 (채용률 낮은 기술은 덜 믿음, 방금 나왔으면 속이다)
//    + 사람처럼 수비적인 선택: 내가 먼저 확정으로 잡거나 4배를 찌를 수 있으면 방어 또는 뒤의 포켓몬으로 교체
//    → 상대마다 공격/방어/교체 확률을 두고, 경우의 수마다 모의 진행한 점수를 확률로 평균
// 2) 내 두 마리 행동 조합(공격+대상, 방어, 속이다, 트릭룸, 순풍, 유인, 도우미, 와이드가드, 교체)을 전부 한 턴 모의 진행
//    행동 순서 = 우선도 → 스피드(트릭룸이면 반대, 같으면 상대 먼저로 보수적으로)
// 3) 점수 = 쓰러뜨린 상대(위협 가중) + 준 피해 + 막은 상대 행동 − 쓰러진 내 포켓몬 − 받은 피해 + 트릭룸·순풍 가치
import {GEN, STAT_KO} from './model.mjs';
import {effectiveness} from './team.mjs';

const toID = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
export const PROTECT = ['Protect', 'Detect', 'Spiky Shield', "King's Shield", 'Baneful Bunker', 'Silk Trap', 'Burning Bulwark', 'Obstruct'];
const REDIRECT = ['Follow Me', 'Rage Powder'];
const FIRST_TURN = ['Fake Out', 'First Impression'];  // 나온 첫 턴에만 성공
const NO_FLINCH = ['Inner Focus', 'Shield Dust'];
const avgOf = r => (r.minPct + r.maxPct) / 2;

// ---- 싱글 전용 ----
// 랭크업 기술 → 오르는 랭크
export const SETUP_BOOST = {
  'Swords Dance': {atk: 2}, 'Dragon Dance': {atk: 1, spe: 1}, 'Nasty Plot': {spa: 2}, 'Calm Mind': {spa: 1, spd: 1}, 'Bulk Up': {atk: 1, def: 1},
  'Quiver Dance': {spa: 1, spd: 1, spe: 1}, 'Shell Smash': {atk: 2, spa: 2, spe: 2, def: -1, spd: -1}, Agility: {spe: 2}, 'Iron Defense': {def: 2},
  Coil: {atk: 1, def: 1}, Curse: {atk: 1, def: 1, spe: -1}, 'Victory Dance': {atk: 1, def: 1, spe: 1}, 'Tidy Up': {atk: 1, spe: 1},
  Growth: {atk: 1, spa: 1}, 'Belly Drum': {atk: 6}, 'Shift Gear': {atk: 1, spe: 2}, 'Tail Glow': {spa: 3}, 'Cosmic Power': {def: 1, spd: 1},
  'Clangorous Soul': {atk: 1, def: 1, spa: 1, spd: 1, spe: 1}, 'Work Up': {atk: 1, spa: 1}, 'Hone Claws': {atk: 1},
};
export const HAZARD = ['Stealth Rock', 'Spikes', 'Toxic Spikes', 'Sticky Web'];
// 상태이상 기술 → 상태, 막히는 타입·특성
const STATUS_MOVE = {
  'Will-O-Wisp': {st: 'brn', types: ['fire'], abil: ['Flash Fire', 'Water Veil', 'Water Bubble', 'Thermal Exchange', 'Well-Baked Body', 'Guts']},
  'Thunder Wave': {st: 'par', types: ['ground', 'electric'], abil: ['Limber', 'Volt Absorb', 'Lightning Rod', 'Motor Drive']},
  Glare: {st: 'par', types: ['electric'], abil: ['Limber']},
  'Stun Spore': {st: 'par', types: ['grass', 'electric'], abil: ['Limber', 'Overcoat']},
  Toxic: {st: 'tox', types: ['poison', 'steel'], abil: ['Immunity', 'Poison Heal', 'Magic Guard'], anyUser: ['Corrosion']},
  Spore: {st: 'slp', types: ['grass'], abil: ['Insomnia', 'Vital Spirit', 'Sweet Veil', 'Overcoat', 'Purifying Salt']},
  'Sleep Powder': {st: 'slp', types: ['grass'], abil: ['Insomnia', 'Vital Spirit', 'Sweet Veil', 'Overcoat', 'Purifying Salt']},
  Hypnosis: {st: 'slp', types: [], abil: ['Insomnia', 'Vital Spirit', 'Sweet Veil', 'Purifying Salt'], acc: 0.6},
  Yawn: {st: 'yawn', types: [], abil: ['Insomnia', 'Vital Spirit', 'Sweet Veil', 'Purifying Salt']},
};
const RECOVER = {Recover: 50, Roost: 50, 'Slack Off': 50, 'Soft-Boiled': 50, 'Milk Drink': 50, 'Shore Up': 50, Moonlight: 50, 'Morning Sun': 50,
                 Synthesis: 50, 'Strength Sap': 35, Rest: 100};
const PIVOT = ['U-turn', 'Volt Switch', 'Flip Turn'];
// 여러 번 때리는 기술 (기합의띠·옹골참을 뚫음)
const MULTI = ['Scale Shot', 'Bullet Seed', 'Icicle Spear', 'Rock Blast', 'Pin Missile', 'Tail Slap', 'Triple Axel', 'Surging Strikes',
  'Population Bomb', 'Double Hit', 'Dual Wingbeat', 'Bone Rush', 'Water Shuriken', 'Arm Thrust', 'Double Kick', 'Dragon Darts', 'Triple Kick'];
// 기합의띠·옹골참: HP가 가득일 때 한 방에 쓰러질 피해를 받으면 1 남음
// 난수: 데미지는 최소~최대 사이 고르게(16단계), 급소 1/24 (1.5배). 명중률은 기술 수치
const CRIT = 1 / 24;
const pAtLeast = (lo, hi, h) => (hi < h ? 0 : lo >= h ? 1 : (hi - h) / Math.max(1e-9, hi - lo));
export const koChance = (r, h, mult = 1) => (1 - CRIT) * pAtLeast(r.minPct * mult, r.maxPct * mult, h) + CRIT * pAtLeast(r.minPct * mult * 1.5, r.maxPct * mult * 1.5, h);
// 상태이상으로 이번 턴 행동할 확률 (챔피언스: 마비로 못 움직일 확률 12.5%, 잠듦 최대 3턴, 얼음은 3번째 턴까지 반드시 풀림)
//   화상(물리 공격 반감)·마비(스피드 반감)는 데미지·스피드 계산에 이미 들어감
export const actChance = set => (set.status === 'par' ? 0.875 : set.status === 'slp' || set.status === 'frz' ? 1 / 3 : 1);
const sashSave = (set, cur, d, move) => (cur >= 100 && d >= cur && (set.item === 'Focus Sash' || set.ability === 'Sturdy') && !MULTI.includes(move) ? cur - 1 : d);
const ANTI_SETUP = ['Haze', 'Whirlwind', 'Roar', 'Dragon Tail', 'Circle Throw', 'Encore', 'Clear Smog', 'Perish Song'];

// 점수 가중치 (모의 대전으로 조정: scripts/sim/selfplay.mjs)
export const DEFAULT_W = {switchCost: 0.08, damageW: 0.45, recoverW: 0.4, setupW: 0.55, statusW: 1, hazardW: 1, repeatPenalty: 0.5, contW: 0.3};
export function createBattle(M, P, opts = {}) {
  const W = {...DEFAULT_W, ...opts};
  const {D, byId} = M;
  const usageById = Object.fromEntries(D.usage.map(u => [u.id, u]));
  const b0 = id => (byId[id] && byId[id].mega ? byId[id].parent : id);
  const moveEn = i => (typeof i === 'number' ? D.moves[i].en : i);
  const moveOf = n => D.moves[M.moveByEn[n]];
  const calcMove = n => GEN.moves.get(toID(n));
  // 명중률 (필중 기술·노가드·복안·날씨 반영)
  function accOf(set, move, f) {
    const m = moveOf(move);
    let a = m && +m.acc ? +m.acc / 100 : 1;
    if (set.ability === 'No Guard') return 1;
    if ((move === 'Thunder' || move === 'Hurricane') && f.weather === 'Rain') return 1;
    if (move === 'Blizzard' && f.weather === 'Snow') return 1;
    if (set.ability === 'Compound Eyes') a *= 1.3;
    return Math.min(1, a);
  }

  // ---------------- 상대 정보 (사용률) ----------------
  function oppInfo(id) {
    const e = byId[id], base = e.mega ? byId[e.parent] : e;
    const u = usageById[base.id];
    const set = P.oppSet(base.id);
    const speStat = (sp, nat) => M.finalStats({...set, sp: {...set.sp, spe: sp}, nature: nat, boosts: {atk: 0, def: 0, spa: 0, spd: 0, spe: 0}}).spe;
    const speed = {min: speStat(0, 'Brave'), neutral: speStat(32, 'Hardy'), max: speStat(32, 'Jolly'), assumed: M.finalStats(set).spe};
    return {
      id: base.id, set, usage: u || null, speed,
      moves: u ? u.mv.map(([m, p]) => [moveEn(m), p]) : set.moves.map(m => [m, 0]),
      items: u ? u.it : [], abilities: u && u.ab.length ? u.ab.map(([n, p]) => [n, p]) : base.ab.map(a => [a.en, 0]),  // 사용률 적은 포켓몬은 특성 통계 없음
      mates: u ? u.tm.filter(t => t[2]).map(t => [t[2], t[1]]) : [],
    };
  }

  // 메가진화 전 모습: 메가스톤은 들고 있지만 종족값·특성은 원래 포켓몬
  function baseForm(set) {
    const e = byId[set.id];
    if (!e || !e.mega) return set;
    const base = byId[e.parent], u = usageById[base.id];
    const ability = base.ab.some(a => a.en === set.ability) ? set.ability
      : ((u && u.ab.find(([n]) => base.ab.some(x => x.en === n))) || [base.ab[0].en])[0];
    return {...set, id: base.id, ability};
  }
  const canMega = set => !!(set && byId[set.id] && byId[set.id].mega);

  // 상대 세트 = 사용률 1순위 + 사용자가 확인한 도구·특성·기술
  // slot.mega === false 이면 (아직 메가진화 안 함) 메가 전 모습
  function oppSetOf(slot) {
    const info = oppInfo(slot.id);
    const s = JSON.parse(JSON.stringify(info.set));
    if (slot.item != null && slot.item !== s.item) {
      s.item = slot.item;
      // 메가스톤을 버리면 메가 전 모습, 메가스톤으로 바꾸면 메가 모습
      const base = byId[info.id];
      const suf = (slot.item.match(/ ([XYZ])$/) || [])[1];
      const mega = base.megas && /ite( [XYZ])?$/.test(slot.item) && slot.item !== 'Eviolite' && base.megas.find(m => ((m.match(/ ([XYZ])$/) || [])[1]) === suf);
      s.id = mega || info.id;
      if (s.id !== info.set.id) s.ability = byId[s.id].ab[0].en;
    }
    if (slot.ability) s.ability = slot.ability;
    if (slot.moves && slot.moves.length) s.moves = slot.moves.slice(0, 4);  // 화면에서 고른 기술 4개
    return slot.mega === false ? baseForm(s) : s;
  }

  // 상태(HP·상태이상·랭크)를 세트에 반영
  const withState = (set, slot) => ({...set, hpPct: Math.max(1, slot.hpPct ?? 100), status: slot.status || '', boosts: {atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...(slot.boosts || {})}});

  function toModelField(f) {
    return {doubles: M.doubles, weather: f.weather || '', terrain: f.terrain || '', crit: false,
            L: {tailwind: !!(f.tailwind && f.tailwind.me), ...(f.screens && f.screens.me || {})},
            R: {tailwind: !!(f.tailwind && f.tailwind.opp), ...(f.screens && f.screens.opp || {})}};
  }

  function priorityOf(set, move, field) {
    const m = calcMove(move);
    let p = (m && m.priority) || 0;
    if (move === 'Grassy Glide' && field.terrain === 'Grassy') p = 1;
    const mv = moveOf(move);
    if (set.ability === 'Prankster' && mv && mv.c === '변화') p += 1;
    if (set.ability === 'Gale Wings' && mv && mv.t === 'flying' && (set.hpPct ?? 100) >= 100) p += 1;
    return p;
  }
  const targetOf = move => { const m = calcMove(move); return m ? m.target : 'normal'; };
  const isSpread = move => /^all/.test(targetOf(move) || '') && (moveOf(move) || {}).c !== '변화';
  const hitsAlly = move => targetOf(move) === 'allAdjacent';

  // ---------------- 계산 ----------------
  // 방금 나온 포켓몬의 날씨·필드 특성 (화면에서 자동으로 필드에 반영할 때 씀)
  function entryConditions(state) {
    const out = [];
    const add = (s, side) => { if (!s || !s.fresh) return; const c = P.condOf(s.set || oppSetOf(s)); if (c.weather || c.terrain) out.push({side, id: (s.set || {}).id || s.id, ...c}); };
    (state.me || []).forEach(s => add(s, 'me'));
    (state.opp || []).forEach(s => add(s, 'opp'));
    return out;
  }

  function advise(state) {
    const f = state.field || {};
    const field = toModelField(f);
    const tr = !!f.trickRoom;
    const mine = state.me.map(s => (s && s.set && (s.hpPct ?? 100) > 0 ? {...s, set: withState(s.set, s)} : null));
    // state.megaOpp: 상대가 메가진화한 포켓몬 id ('' = 아직 안 함). 없으면 예전처럼 메가 모습으로 가정
    // 상대가 아직 메가진화를 안 했으면 필드의 메가스톤 포켓몬이 이번 턴에 메가진화한다고 봄
    //   (싱글 기록: 메가진화의 95%가 나온 뒤 첫 행동 때 / 더블: 메가 가능한 선봉이 하나면 1턴 메가 ~85%)
    const assumeMega = state.megaOpp === '' ? ((state.opp || []).find(s => s && s.id && (s.hpPct ?? 100) > 0 && !(state.megaNo || []).includes(s.id)
      && canMega(oppSetOf({...s, mega: true}))) || {}).id || null : null;
    const megaFlag = id => (state.megaOpp == null ? undefined : state.megaOpp === id || assumeMega === id);
    const opps = state.opp.map(s => (s && s.id && (s.hpPct ?? 100) > 0 ? {...s, set: withState(oppSetOf({...s, mega: megaFlag(s.id)}), s)} : null));
    const bench = (state.bench || []).map(s => (s && s.set && (s.hpPct ?? 100) > 0 ? {...s, set: withState(s.set, s)} : null)).filter(Boolean);
    // 상대 뒤에 있을 수 있는 포켓몬 (선출 탭의 상대 6마리 중 필드에 없는 것)
    const oppBench = (state.oppBench || []).filter(id => byId[id] && !opps.some(o => o && o.id === id))
      .map(id => { const hp = (state.oppHp || {})[id] ?? 100; return {id, hpPct: hp, set: withState(oppSetOf({id, mega: megaFlag(id)}), {hpPct: hp})}; })
      .filter(b => b.hpPct > 0);
    const spd = {me: mine.map(m => m && M.speed(m.set, field, true)), opp: opps.map(o => o && M.speed(o.set, field, false))};
    // 싱글: 상대는 6마리 중 3마리만 데려옴 → 이미 본 포켓몬은 확실, 못 본 포켓몬은 선출률로 남은 자리 수만큼 나눠 가짐
    const presence = oppBench.map(() => 1);
    if (!M.doubles) {
      const seen = new Set(state.oppSeen || []);
      const slots = Math.max(0, 3 - seen.size);
      const un = oppBench.map((b, k) => (seen.has(b.id) ? -1 : k)).filter(k => k >= 0);
      const w = un.map(k => { const u = usageById[b0(oppBench[k].id)]; return u && u.pick != null ? Math.max(5, u.pick) : 50; });
      const tw = w.reduce((a, b) => a + b, 0) || 1;
      un.forEach((k, n) => { presence[k] = Math.min(1, slots * w[n] / tw); });
    }
    const hz = (state.field && state.field.hazards) || {me: {}, opp: {}};
    // 설치기 피해 (스텔스록: 12.5% × 바위 상성, 압정: 1/2/3층 12.5/16.7/25%, 비행·부유 제외). 통굽부츠는 무효
    function hazardDmg(set, side) {
      const h = hz[side] || {}, e = byId[set.id];
      if (!e || set.item === 'Heavy-Duty Boots' || set.ability === 'Magic Guard') return 0;
      let d = 0;
      if (h.sr) d += 12.5 * effectiveness('rock', e.ty);
      const air = e.ty.includes('flying') || set.ability === 'Levitate' || set.item === 'Air Balloon';
      if (h.spikes && !air) d += [0, 12.5, 16.67, 25][Math.min(3, h.spikes)];
      return d;
    }

    // 데미지표 (최소·최대 %). key: 'm0','m1','o0','o1','b0','b1'
    const cache = new Map();
    function table(att, attIsLeft, def) {
      const k = JSON.stringify([att.set.id, att.set.moves, att.set.item, att.set.boosts, att.set.status, def.set.id, def.set.hpPct, def.set.item, def.set.boosts, attIsLeft]);
      if (!cache.has(k)) {
        const rows = M.damageTable(att.set, def.set, field, attIsLeft, {fast: true});
        cache.set(k, Object.fromEntries(rows.filter(r => r.maxPct != null).map(r => [r.name, r])));
      }
      return cache.get(k);
    }
    const dmg = (attKey, move, defKey) => {
      const pick = key => (key[0] === 'm' ? mine[+key.slice(1)] : key[0] === 'b' ? bench[+key.slice(1)] : key[0] === 'x' ? oppBench[+key.slice(1)] : opps[+key.slice(1)]);
      const A = pick(attKey), B = pick(defKey);
      if (!A || !B) return null;
      const t = table(A, attKey[0] !== 'o' && attKey[0] !== 'x', B);
      return t[move] || null;
    };

    // ---------- 상대 행동 예측 ----------
    // 기술을 정말 갖고 있을 가능성: 사용자가 확인한 기술 = 1, 아니면 채용률 기반
    const likeOf = (o, mv) => {
      if (state.opp[opps.indexOf(o)] && (state.opp[opps.indexOf(o)].moves || []).includes(mv)) return 1;
      const u = usageById[byId[o.set.id].mega ? byId[o.set.id].parent : o.set.id];
      const r = u && u.mv.find(([x]) => moveEn(x) === mv);
      return u ? Math.min(1, 0.45 + (r ? r[1] : 0) / 60) : 0.8;
    };
    const oppPred = opps.map((o, j) => {
      if (!o) return null;
      const opts = [];
      for (const mv of o.set.moves.filter(Boolean)) {
        const m = moveOf(mv);
        if (!m || m.c === '변화') continue;
        const like = likeOf(o, mv);
        if (FIRST_TURN.includes(mv) && !o.fresh) continue;
        if (isSpread(mv)) {
          const hits = [0, 1].map(i => (mine[i] ? dmg('o' + j, mv, 'm' + i) : null));
          const val = like * hits.reduce((a, r, i) => a + (r ? Math.min(avgOf(r), mine[i].hpPct) / 100 + (r.minPct >= mine[i].hpPct ? 0.4 : 0) : 0), 0);
          opts.push({move: mv, target: 'spread', val, hits, like});
        } else {
          for (const i of [0, 1]) {
            if (!mine[i]) continue;
            const r = dmg('o' + j, mv, 'm' + i);
            if (!r || !r.maxPct) continue;
            let val = Math.min(avgOf(r), mine[i].hpPct) / 100 + (r.minPct >= mine[i].hpPct ? 0.5 : avgOf(r) >= mine[i].hpPct ? 0.3 : 0);
            if (mv === 'Fake Out') val = 0.9;  // 방금 나온 상대의 속이다는 거의 확실
            else val *= like;
            opts.push({move: mv, target: i, val, r, like});
          }
        }
      }
      // 유인(날 따르라·분노가루)이 있는 서포터는 공격보다 유인을 쓴다고 봄 (공격이 약하면)
      const redir = o.set.moves.find(m => REDIRECT.includes(m));
      opts.sort((a, b) => b.val - a.val);
      if (redir && (!opts.length || opts[0].val < 0.6)) return {j, move: redir, target: 'redirect', val: 0.5, redirect: true, alts: opts.slice(0, 2)};
      if (!opts.length) return {j, move: null, target: null, val: 0};
      const alts = opts.slice(1).filter((o2, n, arr) => o2.move !== opts[0].move && arr.findIndex(x => x.move === o2.move) === n).slice(0, 2);
      return {j, ...opts[0], alts};
    });
    // 상대 위협도: 이 상대가 우리에게 주는 피해 (예측 기준)
    const threat = oppPred.map(p => (p ? Math.min(1.5, p.val) : 0));

    // ---------- 상대 수비 선택 (방어·교체) 확률 ----------
    const myHits = defKey => {  // 내 필드 두 마리가 이 상대에게 줄 수 있는 공격들
      const out = [];
      mine.forEach((m, i) => {
        if (!m) return;
        for (const mv of m.set.moves.filter(Boolean)) {
          const mm = moveOf(mv);
          if (!mm || mm.c === '변화' || (FIRST_TURN.includes(mv) && !m.fresh)) continue;
          const r = dmg('m' + i, mv, defKey);
          if (r && r.maxPct) out.push({i, move: mv, r, prio: priorityOf(m.set, mv, f), type: mm.t});
        }
      });
      return out;
    };
    const defense = !M.doubles ? opps.map((o, j) => (o ? singlesDefense(o, j) : null)) : opps.map((o, j) => {
      if (!o) return null;
      const hits = myHits('o' + j);
      const best = hits.reduce((a, h) => Math.max(a, avgOf(h.r)), 0);
      const oppPrio = oppPred[j] && oppPred[j].move ? priorityOf(o.set, oppPred[j].move, f) : 0;
      const before = h => h.prio > oppPrio || (h.prio === oppPrio && (tr ? spd.me[h.i] < spd.opp[j] : spd.me[h.i] > spd.opp[j]));
      const koFirst = hits.some(h => h.r.minPct >= o.hpPct && before(h));
      const fourX = hits.some(h => effectiveness(h.type, byId[o.set.id].ty, o.set.ability) >= 4 && avgOf(h.r) >= 60);
      const canKO = oppPred[j] && oppPred[j].val >= 1;
      // 교체 후보: 내 공격을 가장 잘 받는 뒤 포켓몬
      const swList = oppBench.map((b, k) => ({k, id: b.id, worst: myHits('x' + k).reduce((a, h) => Math.max(a, avgOf(h.r)), 0)}))
        .sort((a, b) => a.worst - b.worst);
      const sw = swList[0] || null;
      let pS = 0, pP = 0;
      const why = [];
      if (koFirst) why.push('먼저 확정으로 잡힘');
      if (fourX) why.push('4배 약점');
      if (sw && sw.worst < 60) {
        if (koFirst || fourX) pS = 0.45; else if (best >= 100) pS = 0.25;
        if (o.fresh) pS *= 0.6;
        if (canKO) pS *= 0.5;
      }
      const hasProtect = o.set.moves.find(m => PROTECT.includes(m));
      if (hasProtect && !o.protected) pP = koFirst || best >= 100 ? 0.3 : best >= 60 ? 0.15 : 0;
      const tot = pS + pP;
      if (tot > 0.75) { pS *= 0.75 / tot; pP *= 0.75 / tot; }
      return {j, pS, pP, pA: 1 - pS - pP, switchTo: pS > 0 ? sw : null, switchAlt: pS > 0 && swList[1] && swList[1].worst < 60 ? swList[1] : null,
              protectMove: hasProtect, why, best, koFirst, fourX};
    });
    // 싱글 교체 예측: 지금 대면이 불리할수록, 뒤에 이 대면을 잘 받는 포켓몬이 있을수록 교체
    //   대면 값 = P.cellValue(주는 %, 받는 %, 먼저 움직임) — 선출 추천과 같은 기준
    //   교체해 들어오는 포켓몬은 내 공격을 한 번 공짜로 맞으므로 그만큼 뺌
    //   유지하는 이유: 먼저 때려서 잡을 수 있음, 기합의띠(HP 가득), HP가 적음(버리는 카드), 방금 나옴
    function singlesDefense(o, j) {
      const hits = myHits('o' + j);
      const myBest = hits.reduce((a, h) => Math.max(a, avgOf(h.r)), 0);
      const theirMoves = o.set.moves.filter(mv => { const m = moveOf(mv); return m && m.c !== '변화'; });
      const theirBest = mine[0] ? theirMoves.reduce((a, mv) => { const r = dmg('o' + j, mv, 'm0'); return Math.max(a, r ? avgOf(r) : 0); }, 0) : 0;
      const meFirst = mine[0] && (tr ? spd.me[0] < spd.opp[j] : spd.me[0] > spd.opp[j]);
      const hpMe = mine[0] ? mine[0].hpPct : 100;
      const stay = P.cellValue(theirBest / hpMe * 100, myBest / o.hpPct * 100, !meFirst);
      const oppPrio = oppPred[j] && oppPred[j].move ? priorityOf(o.set, oppPred[j].move, f) : 0;
      const before = h => h.prio > oppPrio || (h.prio === oppPrio && meFirst);
      const koFirst = hits.some(h => h.r.minPct >= o.hpPct && before(h));
      const theyKOFirst = !meFirst && theirBest >= hpMe;
      const fourX = hits.some(h => effectiveness(h.type, byId[o.set.id].ty, o.set.ability) >= 4 && avgOf(h.r) >= 60);
      const cands = oppBench.map((b, k) => {
        const take = myHits('x' + k).reduce((a, h) => Math.max(a, avgOf(h.r)), 0) + hazardDmg(b.set, 'opp');
        const thr = mine[0] ? b.set.moves.filter(Boolean).reduce((a, mv) => { const m = moveOf(mv); if (!m || m.c === '변화') return a; const r = dmg('x' + k, mv, 'm0'); return Math.max(a, r ? avgOf(r) : 0); }, 0) : 0;
        const sB = M.speed(b.set, field, false);
        const fasterK = tr ? sB < spd.me[0] : sB > spd.me[0];
        const v = P.cellValue(thr / hpMe * 100, take / b.hpPct * 100, fasterK) - 0.25 * Math.min(1, take / b.hpPct);
        return {k, id: b.id, v, take, thr, presence: presence[k], worst: take};
      }).filter(c => c.presence > 0.05);
      const why = [];
      let pS = 0;
      const ranked = cands.map(c => ({...c, w: c.presence * Math.exp(3 * c.v)})).sort((a, b) => b.w - a.w);
      const top2 = ranked.slice(0, 2);
      const gain = top2.length ? Math.max(...top2.map(c => c.v)) - stay : -1;
      // 기준값: 쇼다운 M-C 싱글 기록 2,773판에서 뒤에 포켓몬이 있는 턴의 자진 교체 비율 12.9%
      //   상황별 배수도 같은 기록에서 잰 교체율 ÷ 12.9% (4배 30%, 2배 17.5%, 반감 9.5%, 내 자속이 안 통함 24.1%,
      //   상대에게 2배 8.2%·4배 5.7%, 능력 하락 21.8%, 능력 상승 6.2%, 설치기 직후 20.4%, 랭크업 직후 3.3%). HP·스피드는 거의 무관
      if (top2.length) {
        const stabOf = (set, defSet) => Math.max(0, ...byId[set.id].ty.map(t => effectiveness(t, byId[defSet.id].ty, defSet.ability)));
        const mine0 = mine[0] && mine[0].set;
        const hitThem = mine0 ? stabOf(mine0, o.set) : 1, hitMe = mine0 ? stabOf(o.set, mine0) : 1;
        let mult = 1;
        if (hitThem >= 4) { mult *= 2.3; why.push('4배 약점'); } else if (hitThem >= 2) { mult *= 1.36; why.push('약점을 찔림'); } else if (hitThem <= 0.5) mult *= 0.74;
        if (hitMe === 0) { mult *= 1.85; why.push('자속 기술이 안 통함'); }
        else if (hitMe >= 4) mult *= 0.45; else if (hitMe >= 2 && hitThem < 2) mult *= 0.64;
        if (hitThem >= 2 && hitMe < 2) mult *= 1.15;
        const bsum = Object.values(o.boosts || {}).reduce((a, v) => a + v, 0);
        if (bsum < 0) { mult *= 1.7; why.push('능력이 떨어짐'); } else if (bsum > 0) mult *= 0.48;
        if (o.lastMove && HAZARD.includes(o.lastMove)) { mult *= 1.6; why.push('설치기를 깔았음'); }
        if (o.lastMove && SETUP_BOOST[o.lastMove]) mult *= 0.25;
        // 데미지 계산으로 보정
        if (koFirst) { mult *= 1.3; why.push('먼저 잡힘'); }
        if (theyKOFirst) { mult *= 0.6; why.push('먼저 때려 잡을 수 있어서 버틸 수도'); }
        const sash = o.hpPct >= 100 && (o.set.item === 'Focus Sash' || ['Sturdy', 'Disguise', 'Multiscale'].includes(o.set.ability));
        if (sash) { mult *= 0.6; why.push('기합의띠·옹골참으로 버틸 수도'); }
        if (gain > 0.3) mult *= 1.3; else if (gain < -0.2) mult *= 0.5;  // 뒤에 이 대면을 잘 받는 포켓몬이 있나
        pS = Math.min(0.6, 0.129 * mult) * Math.min(1, Math.max(...top2.map(c => c.presence)));
      }
      const hasProtect = o.set.moves.find(m => PROTECT.includes(m));
      let pP = 0;
      if (hasProtect && !o.protected) pP = koFirst ? 0.2 : 0.08;  // 싱글 방어: 간보기·메가진화 턴
      const tot = pS + pP;
      if (tot > 0.8) { pS *= 0.8 / tot; pP *= 0.8 / tot; }
      const wsum = top2.reduce((a, c) => a + c.w, 0) || 1;
      const split = top2.map(c => pS * c.w / wsum);
      return {j, pS, pP, pA: 1 - pS - pP, switchTo: top2[0] || null, switchAlt: top2[1] || null, split, stay,
              cands: ranked.slice(0, 3).map(c => ({id: c.id, v: c.v, presence: c.presence})),
              protectMove: hasProtect, why, best: myBest, koFirst, fourX};
    }

    // 경우의 수: 상대마다 [공격, 방어, 교체] 중 확률 있는 것
    const branches = defense.map(d => {
      if (!d) return [{type: 'none', p: 1}];
      const b = [{type: 'attack', p: d.pA}];
      if (d.pP > 0) b.push({type: 'protect', p: d.pP});
      if (d.split) {  // 싱글: 교체 대상 두 후보로 나눔
        [d.switchTo, d.switchAlt].forEach((c, n) => { if (c && d.split[n] > 0.01) b.push({type: 'switch', p: d.split[n], k: c.k}); });
      } else if (d.pS > 0) b.push({type: 'switch', p: d.pS, k: d.switchTo.k});
      return b;
    });
    const scenarios = [];
    for (const a of branches[0]) for (const b0 of branches[1]) {
      let b = b0;
      // 둘 다 같은 포켓몬으로 교체할 수는 없음 → 두 번째는 다음으로 잘 받는 포켓몬, 없으면 이 경우는 뺌
      if (a.type === 'switch' && b.type === 'switch' && a.k === b.k) {
        if (!defense[1].switchAlt) continue;
        b = {...b, k: defense[1].switchAlt.k};
      }
      if (a.p * b.p >= 0.03) scenarios.push({s: [a, b], p: a.p * b.p});
    }
    const psum = scenarios.reduce((x, y) => x + y.p, 0);
    scenarios.forEach(x => { x.p /= psum; });

    // ---------- 내 행동 후보 ----------
    function optionsFor(i) {
      const me = mine[i];
      if (!me) return [{kind: 'none', i}];
      const out = [];
      for (const mv of me.set.moves.filter(Boolean)) {
        const m = moveOf(mv);
        if (!m) continue;
        if (PROTECT.includes(mv)) { if (!me.protected) out.push({kind: 'protect', i, move: mv}); continue; }
        if (FIRST_TURN.includes(mv)) {
          if (!me.fresh) continue;
          for (const j of [0, 1]) if (opps[j]) out.push({kind: 'attack', i, move: mv, target: j, fakeout: mv === 'Fake Out'});
          continue;
        }
        if (mv === 'Trick Room') { out.push({kind: 'trickroom', i, move: mv}); continue; }
        if (mv === 'Tailwind') { if (!(f.tailwind && f.tailwind.me)) out.push({kind: 'tailwind', i, move: mv}); continue; }
        if (REDIRECT.includes(mv)) { out.push({kind: 'redirect', i, move: mv}); continue; }
        if (mv === 'Helping Hand') { if (mine[1 - i]) out.push({kind: 'helping', i, move: mv}); continue; }
        if (mv === 'Wide Guard') { out.push({kind: 'wideguard', i, move: mv}); continue; }
        if (!M.doubles && m.c === '변화') {
          if (SETUP_BOOST[mv]) out.push({kind: 'setup', i, move: mv});
          else if (HAZARD.includes(mv)) { if (!hazardSet(mv)) out.push({kind: 'hazard', i, move: mv}); }
          else if (STATUS_MOVE[mv]) out.push({kind: 'status', i, move: mv});
          else if (RECOVER[mv] && me.hpPct < 75) out.push({kind: 'recover', i, move: mv});
          continue;
        }
        if (m.c === '변화') continue;
        // 유턴·볼트체인지: 뒤 포켓몬마다 따로 모의 진행 (들어온 포켓몬이 이번 턴 상대 공격을 대신 맞음)
        if (!M.doubles && PIVOT.includes(mv) && bench.length) { bench.forEach((b, k) => out.push({kind: 'attack', i, move: mv, target: 0, pivot: true, pivotTo: k})); continue; }
        if (isSpread(mv)) out.push({kind: 'attack', i, move: mv, target: 'spread'});
        else for (const j of [0, 1]) if (opps[j]) out.push({kind: 'attack', i, move: mv, target: j});
      }
      bench.forEach((b, k) => out.push({kind: 'switch', i, to: k}));
      return out;
    }

    const hazardSet = mv => { const h = hz.opp || {}; return mv === 'Stealth Rock' ? h.sr : mv === 'Spikes' ? (h.spikes || 0) >= 3 : mv === 'Toxic Spikes' ? (h.tspikes || 0) >= 2 : mv === 'Sticky Web' ? h.web : false; };
    // 랭크업하면 다음 턴에 얼마나 더 세게 때리나 (상대 자리의 포켓몬 기준, 캐시)
    const boostCache = new Map();
    function setupGain(i, mv, oppKey) {
      const k = i + mv + oppKey;
      if (boostCache.has(k)) return boostCache.get(k);
      const me = mine[i], B = SETUP_BOOST[mv];
      const def = oppKey[0] === 'x' ? oppBench[+oppKey.slice(1)] : opps[+oppKey.slice(1)];
      let g = 0;
      if (me && def) {
        const boosts = {...me.set.boosts};
        for (const [s, v] of Object.entries(B)) boosts[s] = Math.max(-6, Math.min(6, (boosts[s] || 0) + v));
        const up = {...me.set, boosts};
        const best = s => M.damageTable(s, def.set, field, true, {fast: true}).filter(r => r.maxPct != null).reduce((a, r) => Math.max(a, avgOf(r)), 0);
        const now = best(me.set), later = best(up);
        g = Math.min(1, later / def.hpPct) - Math.min(1, now / def.hpPct);
        // 스피드가 올라서 먼저 움직이게 되면 가산
        const s0 = M.speed(me.set, field, true), s1 = M.speed(up, field, true), so = M.speed(def.set, field, false);
        if (!tr && s0 <= so && s1 > so) g += 0.25;
        if (B.def || B.spd) g += 0.05;
      }
      boostCache.set(k, g);
      return g;
    }
    // 상대가 랭크업을 되돌릴 수단 (흑안개·울부짖기·앵콜·천진)을 가졌을 가능성
    const antiSetup = o => { if (!o) return 0; if (o.set.ability === 'Unaware') return 1; const u = usageById[b0(o.id)]; if (!u) return 0; return Math.min(1, u.mv.reduce((a, [x, p]) => a + (ANTI_SETUP.includes(moveEn(x)) ? p : 0), 0) / 100); };
    function statusValue(mv, target, me) {
      const S = STATUS_MOVE[mv], e = byId[target.set.id];
      if (target.set.status || target.drowsy || e.ty.some(t => S.types.includes(t)) || S.abil.includes(target.set.ability)) return 0;  // 이미 상태이상·졸음이면 소용없음
      if (mv === 'Thunder Wave' && moveOf(mv) && e.ty.includes('ground')) return 0;
      const st = M.finalStats(target.set);
      const acc = S.acc || 1;
      if (S.st === 'brn') return acc * (st.atk > st.spa * 1.1 ? 0.5 : 0.15);
      // 챔피언스: 마비로 못 움직일 확률 12.5%, 잠듦 최대 3턴 → 예전보다 낮게
      if (S.st === 'par') return acc * (M.speed(target.set, field, false) > M.speed(me.set, field, true) ? 0.25 : 0.08);
      if (S.st === 'tox') return acc * 0.22;
      if (S.st === 'slp') return acc * 0.4;
      if (S.st === 'yawn') return 0.15;
      return 0;
    }

    // ---------- 한 턴 모의 진행 ----------
    function simulate(a0, a1, scen = [{type: 'attack'}, {type: 'attack'}]) {
      const acts = [a0, a1];
      // 상대 자리: 교체하면 뒤 포켓몬('x'), 아니면 원래('o')
      const oKey = j => (scen[j] && scen[j].type === 'switch' ? 'x' + scen[j].k : 'o' + j);
      const oppProtect = [0, 1].map(j => scen[j] && scen[j].type === 'protect');
      const hp = {m0: mine[0] ? mine[0].hpPct : 0, m1: mine[1] ? mine[1].hpPct : 0,
                  o0: opps[0] ? (scen[0].type === 'switch' ? 100 : opps[0].hpPct) : 0, o1: opps[1] ? (scen[1].type === 'switch' ? 100 : opps[1].hpPct) : 0};
      const slotKey = i => (acts[i] && acts[i].kind === 'switch' ? 'b' + acts[i].to : 'm' + i);
      const who = {m0: slotKey(0), m1: slotKey(1)};  // 교체하면 그 자리에 들어온 포켓몬이 맞음
      const pivotLost = {};  // 유턴으로 빠지기 전에 받은 피해
      if (acts[0] && acts[0].kind === 'switch') hp.m0 = bench[acts[0].to].hpPct;
      if (acts[1] && acts[1].kind === 'switch') hp.m1 = bench[acts[1].to].hpPct;
      const hzLog = [];
      if (!M.doubles) {  // 교체해 들어올 때 설치기 피해
        [0, 1].forEach(i => { if (acts[i] && acts[i].kind === 'switch') { const d = hazardDmg(bench[acts[i].to].set, 'me'); if (d) { hp['m' + i] -= d; hzLog.push({k: 'hazard', to: 'm' + i, id: bench[acts[i].to].id, d}); } } });
        [0, 1].forEach(j => { if (scen[j] && scen[j].type === 'switch') { const b = oppBench[scen[j].k]; hp['o' + j] = b.hpPct; const d = hazardDmg(b.set, 'opp'); if (d) { hp['o' + j] -= d; hzLog.push({k: 'hazard', to: 'o' + j, id: b.id, d}); } } });
      }
      const startHp = {...hp};
      const cumLo = {}, cumHi = {};  // 이번 턴에 누적으로 받은 피해 (남은 HP 범위 표시용)
      const protecting = [0, 1].map(i => acts[i] && acts[i].kind === 'protect');
      const redirector = [0, 1].find(i => acts[i] && acts[i].kind === 'redirect');
      const wide = [0, 1].some(i => acts[i] && acts[i].kind === 'wideguard');
      const helped = [0, 1].map(i => acts[1 - i] && acts[1 - i].kind === 'helping');
      const flinched = {o0: false, o1: false, m0: false, m1: false};
      // 상대 유인: 유인한 상대가 살아 있으면 내 단일 공격이 그쪽으로 (분노가루는 풀 타입·방진에게 안 통함)
      const oppRedir = oppPred.findIndex(p => p && p.redirect);
      const acted = {};
      const log = [...hzLog];
      const dealt = {o0: 0, o1: 0};
      const koBefore = {};  // 상대가 행동하기 전에 쓰러졌을 확률
      // 난수: 이번 턴 끝까지 서 있을 확률 (빗나감·데미지 난수·급소). HP는 기댓값으로 깎음
      const alive = {m0: 1, m1: 1, o0: 1, o1: 1};

      // 행동 목록 (교체는 맨 먼저)
      const list = [];
      [0, 1].forEach(i => {
        const a = acts[i];
        if (!a || a.kind === 'none' || a.kind === 'switch') return;
        const set = mine[i].set;
        list.push({side: 'm', i, a, prio: priorityOf(set, a.move, f), spe: spd.me[i]});
      });
      oppPred.forEach((p, j) => {
        if (!p || !p.move || (scen[j] && scen[j].type !== 'attack')) return;  // 방어·교체한 상대는 공격 안 함
        list.push({side: 'o', i: j, a: p, prio: priorityOf(opps[j].set, p.move, f), spe: spd.opp[j]});
      });
      [0, 1].forEach(j => {
        if (scen[j] && scen[j].type === 'switch') log.push({k: 'oppSwitch', j, to: oppBench[scen[j].k].id});
        if (scen[j] && scen[j].type === 'protect') log.push({k: 'oppProtect', j});
      });
      list.sort((x, y) => (y.prio - x.prio) || (tr ? x.spe - y.spe : y.spe - x.spe) || (x.side === 'o' ? -1 : 1));

      for (const act of list) {
        const key = act.side + act.i;
        if (hp[key] <= 0 || alive[key] < 0.02) continue;
        if (flinched[key]) { log.push({k: 'flinch', who: key}); continue; }
        acted[key] = true;
        // 앞에서 맞고 쓰러졌을 수도 있고, 마비·잠듦·얼음이면 못 움직일 수도 있으니 그만큼만 행동
        const actorSet = act.side === 'm' ? (who[key][0] === 'b' ? bench[+who[key].slice(1)].set : mine[act.i].set) : opps[act.i].set;
        const w = alive[key] * (act.a && act.a.move === 'Sleep Talk' && actorSet.status === 'slp' ? 1 : actChance(actorSet));
        if (act.side === 'm') {
          const a = act.a;
          if (a.kind !== 'attack') continue;
          const mult = helped[act.i] ? 1.5 : 1;
          let targets = a.target === 'spread' ? [0, 1] : [a.target];
          if (a.target !== 'spread' && oppRedir >= 0 && scen[oppRedir].type === 'attack' && hp['o' + oppRedir] > 0 && a.target !== oppRedir) {
            const me = mine[act.i].set;
            const immune = oppPred[oppRedir].move === 'Rage Powder' && (byId[me.id].ty.includes('grass') || me.ability === 'Overcoat');
            if (!immune && !['Stalwart', 'Propeller Tail'].includes(me.ability)) { targets = [oppRedir]; log.push({k: 'redirected', from: 'm' + act.i, to: 'o' + oppRedir}); }
          }
          for (const j of targets) {
            const tk = 'o' + j;
            if (hp[tk] <= 0) continue;
            if (oppProtect[j]) { log.push({k: 'oppBlocked', from: 'm' + act.i, j, move: a.move}); continue; }
            const r = dmg('m' + act.i, a.move, oKey(j));
            if (!r) continue;
            const acc = accOf(mine[act.i].set, a.move, f);
            const d = avgOf(r) * mult;
            const tset = scen[j].type === 'switch' ? oppBench[scen[j].k].set : opps[j].set;
            const d2 = sashSave(tset, hp[tk], d, a.move);
            if (d2 < d) log.push({k: 'sash', to: tk, id: tset.id, item: tset.item === 'Focus Sash' ? 'sash' : 'sturdy'});
            const pKO = d2 < d ? 0 : acc * w * koChance(r, hp[tk], mult);
            const sure = d2 === d && acc >= 1 && r.minPct * mult >= hp[tk];
            if (!acted[tk]) koBefore[tk] = 1 - (1 - (koBefore[tk] || 0)) * (1 - pKO);
            alive[tk] *= 1 - pKO;
            const exp = d2 * acc * w;
            hp[tk] -= alive[tk] < 0.02 ? d2 : exp; dealt[tk] += exp;
            if (a.fakeout && r.maxPct > 0 && !acted[tk] && !NO_FLINCH.includes(opps[j].set.ability)) flinched[tk] = true;
            log.push({k: 'hit', from: 'm' + act.i, to: tk, toId: scen[j].type === 'switch' ? oppBench[scen[j].k].id : null, move: a.move, r, mult,
                      ko: 1 - alive[tk] >= 0.5, koP: 1 - alive[tk], acc, sure, left: Math.max(0, hp[tk])});
          }
          // 유턴·볼트체인지: 때린 뒤 뒤 포켓몬과 교체 → 아직 행동 안 한 상대의 공격은 들어온 포켓몬이 맞음
          if (a.pivot && a.pivotTo != null && bench[a.pivotTo] && hp[key] > 0) {
            const b = bench[a.pivotTo];
            pivotLost[key] = startHp[key] - hp[key];
            who[key] = 'b' + a.pivotTo;
            hp[key] = b.hpPct - hazardDmg(b.set, 'me');
            startHp[key] = hp[key];
            log.push({k: 'pivot', from: key, id: b.id});
          }
          if (hitsAlly(a.move)) {
            const ally = 1 - act.i;
            if (mine[ally] && !protecting[ally] && hp['m' + ally] > 0) {
              const r = dmg('m' + act.i, a.move, 'm' + ally);
              if (r) { hp['m' + ally] -= avgOf(r); log.push({k: 'ally', from: 'm' + act.i, to: 'm' + ally, move: a.move, r}); }
            }
          }
        } else {
          const p = act.a;
          if (p.redirect) { log.push({k: 'oppRedirect', j: act.i, move: p.move}); continue; }  // 유인은 데미지 없음 (효과는 내 공격 쪽에서 처리)
          const spread = p.target === 'spread';
          if (spread && wide) { log.push({k: 'wide', j: act.i, move: p.move}); continue; }
          let targets = spread ? [0, 1] : [p.target];
          if (!spread && redirector != null && hp['m' + redirector] > 0 && !protecting[redirector]) targets = [redirector];
          for (const i of targets) {
            const mk = 'm' + i;
            if (hp[mk] <= 0) continue;
            if (protecting[i]) { log.push({k: 'blocked', j: act.i, to: mk, move: p.move}); continue; }
            const r = dmg('o' + act.i, p.move, who[mk]);
            if (!r) continue;
            const mset = who[mk][0] === 'b' ? bench[+who[mk].slice(1)].set : mine[i].set;
            const acc = accOf(opps[act.i].set, p.move, f);
            const d0 = avgOf(r), d1 = sashSave(mset, hp[mk], d0, p.move);
            if (d1 < d0) log.push({k: 'sash', to: mk, id: mset.id, item: mset.item === 'Focus Sash' ? 'sash' : 'sturdy'});
            const pKO = d1 < d0 ? 0 : acc * w * koChance(r, hp[mk]);
            alive[mk] *= 1 - pKO;
            hp[mk] -= alive[mk] < 0.02 ? d1 : d1 * acc * w;
            // 상대 속이다: 아직 행동 안 한 내 포켓몬은 풀죽음 (정신력 등 제외)
            const target = who[mk][0] === 'b' ? bench[+who[mk][1]] : mine[i];
            if (p.move === 'Fake Out' && r.maxPct > 0 && !acted[mk] && !NO_FLINCH.includes(target.set.ability)) flinched[mk] = true;
            // 교체해 들어온 포켓몬이 맞으면 그 이름(toId)과 맞은 뒤 남은 HP도 기록
            log.push({k: 'hit', from: 'o' + act.i, to: mk, toId: who[mk][0] === 'b' ? bench[+who[mk].slice(1)].id : null, move: p.move, r,
                      ko: 1 - alive[mk] >= 0.5, koP: 1 - alive[mk], acc,
                      sure: d1 === d0 && r.minPct >= startHp[mk], left: Math.max(0, hp[mk]),
                      leftRange: d1 < d0 ? [1, 1] : [Math.max(0, startHp[mk] - (cumHi[mk] = (cumHi[mk] || 0) + r.maxPct)), Math.max(0, startHp[mk] - (cumLo[mk] = (cumLo[mk] || 0) + r.minPct))]});
          }
        }
      }

      // ---------- 점수 ----------
      let score = 0;
      const notes = [];
      [0, 1].forEach(j => {
        const k = 'o' + j;
        if (!opps[j]) return;
        const pk = 1 - alive[k];
        score += pk * (scen[j].type === 'switch' ? 0.9 : 1 + 0.3 * threat[j]) + 0.3 * threat[j] * (koBefore[k] || 0)
               + (1 - pk) * W.damageW * Math.min(1, dealt[k] / Math.max(1, startHp[k]));
        if (flinched[k] && oppPred[j] && oppPred[j].move && scen[j].type === 'attack') score += 0.4 * threat[j];
      });
      [0, 1].forEach(i => {
        const k = 'm' + i;
        if (!mine[i]) return;
        const lost = startHp[k] - Math.max(0, hp[k]);
        score -= (1 - alive[k]) * (acted[k] ? 0.7 : 1.0);
        score -= 0.25 * (lost + (pivotLost[k] || 0)) / 100;
        if (flinched[k] && acts[i] && acts[i].kind !== 'switch' && acts[i].kind !== 'protect') score -= 0.3;  // 속이다에 막힘
      });
      // 싱글: 턴이 끝난 뒤의 대면 (한 턴 더 내다보기) — 교체해 들어온 포켓몬이 다음 턴에 이 상대를 이길 수 있나
      if (!M.doubles && W.contW) {
        const mk = who.m0, ok = oKey(0);
        const meSet = mk[0] === 'b' ? bench[+mk.slice(1)] && bench[+mk.slice(1)].set : mine[0] && mine[0].set;
        const opSet = ok[0] === 'x' ? oppBench[+ok.slice(1)] && oppBench[+ok.slice(1)].set : opps[0] && opps[0].set;
        const up = alive.m0 * alive.o0;
        if (meSet && opSet && up > 0.05 && hp.m0 > 0 && hp.o0 > 0) {
          const bestOf = (att, set, def) => set.moves.filter(Boolean).reduce((a, mv) => { const m = moveOf(mv); if (!m || m.c === '변화') return a; const r = dmg(att, mv, def); return Math.max(a, r ? avgOf(r) * accOf(set, mv, f) : 0); }, 0);
          const give = bestOf(mk, meSet, ok), take = bestOf(ok, opSet, mk);
          const sMe = mk === 'm0' ? spd.me[0] : M.speed(meSet, field, true), sOp = ok === 'o0' ? spd.opp[0] : M.speed(opSet, field, false);
          const faster = tr ? sMe < sOp : sMe > sOp;
          score += W.contW * up * P.cellValue(give / Math.max(1, hp.o0) * 100, take / Math.max(1, hp.m0) * 100, faster);
        }
      }
      // 트릭룸·순풍: 행동 순서가 뒤집히는 쌍 수
      const pairs = (meSpe, oppSpe, trOn) => {
        let good = 0;
        [0, 1].forEach(i => [0, 1].forEach(j => {
          if (meSpe[i] == null || oppSpe[j] == null) return;
          if (trOn ? meSpe[i] < oppSpe[j] : meSpe[i] > oppSpe[j]) good++;
        }));
        return good;
      };
      const meS = spd.me.map((s, i) => (mine[i] ? s : null)), opS = spd.opp.map((s, j) => (opps[j] && hp['o' + j] > 0 ? s : null));
      [0, 1].forEach(i => {
        const a = acts[i];
        if (!a) return;
        if (a.kind === 'trickroom') {
          if (flinched['m' + i] || hp['m' + i] <= 0 && !acted['m' + i]) { notes.push('트릭룸 실패 위험 (속이다·먼저 쓰러짐)'); return; }
          const gain = pairs(meS, opS, !tr) - pairs(meS, opS, tr);
          score += 0.2 * gain + (state.planTR && !tr ? 0.35 : 0);
          notes.push(tr ? '트릭룸 해제' : `트릭룸 → 먼저 움직이는 쌍 ${pairs(meS, opS, tr)}→${pairs(meS, opS, !tr)}`);
        }
        if (a.kind === 'tailwind') {
          if (flinched['m' + i] || hp['m' + i] <= 0 && !acted['m' + i]) { notes.push('순풍 실패 위험'); return; }
          const doubled = meS.map(s => (s == null ? null : s * 2));
          const gain = pairs(doubled, opS, tr) - pairs(meS, opS, tr);
          score += 0.18 * gain + 0.1;
          notes.push(`순풍 → 먼저 움직이는 쌍 ${pairs(meS, opS, tr)}→${pairs(doubled, opS, tr)}`);
        }
        if (a.kind === 'protect') {
          const threatened = log.some(x => x.k === 'blocked' && x.to === 'm' + i);
          score += threatened ? 0 : -0.15;
          score -= 0.05;
        }
        if (a.kind === 'switch') score -= M.doubles ? 0.15 : W.switchCost;  // 싱글은 교체가 기본 전술이라 부담이 적음
        if (!M.doubles && acted['m' + i]) {
          const occ = scen[0] && scen[0].type === 'switch' ? 'x' + scen[0].k : 'o0';
          const target = occ[0] === 'x' ? oppBench[+occ.slice(1)] : opps[0];
          const up = alive['m' + i], left = Math.max(0, hp['m' + i]) / 100;  // up: 이번 턴을 버틸 확률
          // 같은 변화기를 연달아 쓰면 (회복·상태이상 반복) 가치를 낮춤 — 진행이 없는 무한 반복 방지
          const rep = mine[i].lastMove && mine[i].lastMove === a.move ? W.repeatPenalty : 1;
          if (a.kind === 'setup') {
            const g = up > 0.02 ? setupGain(i, a.move, occ) : 0;
            const v = g * (0.35 + 0.65 * left) * (1 - 0.7 * antiSetup(target)) * up;
            score += W.setupW * v * rep - 0.05;
            notes.push(up > 0.5 ? `${M.moveKo(a.move)} → 다음 턴 화력 +${Math.round(g * 100)}%${left < 0.4 ? ' (HP가 적어 위험)' : ''}` : `${M.moveKo(a.move)} 후 쓰러질 위험`);
          }
          if (a.kind === 'hazard') {
            // 3마리 싸움이라 6마리 싸움보다 가치가 1/3 정도 (들어오는 횟수가 적음). 기합의띠·옹골참·멀티스케일을 깨거나 바위 4배면 가산
            const left2 = oppBench.reduce((x, b, k) => x + presence[k], 0);  // 앞으로 교체해 들어올 상대 수
            let v = (a.move === 'Stealth Rock' ? 0.04 : a.move === 'Sticky Web' ? 0.05 : 0.03) * (1 + left2);
            if (a.move === 'Stealth Rock') oppBench.forEach((b, k) => {
              const u = usageById[b0(b.id)], e = byId[b.set.id];
              const sashy = ['Sturdy', 'Multiscale'].includes(b.set.ability) || (u && u.it.some(([n, p]) => n === 'Focus Sash' && p >= 30));
              v += presence[k] * ((sashy ? 0.06 : 0) + (effectiveness('rock', e.ty) >= 4 ? 0.06 : 0));
            });
            score += W.hazardW * (v + (scen[0] && scen[0].type === 'switch' ? 0.03 : 0));
            notes.push(`${M.moveKo(a.move)} 설치 — 상대가 교체해 들어올 때마다 피해`);
          }
          if (a.kind === 'status' && target && !oppProtect[0]) {
            const v = statusValue(a.move, target, mine[i]) * W.statusW * rep;
            score += v;
            if (v) notes.push(`${M.moveKo(a.move)} → ${byId[target.set.id].ko}`);
            else notes.push(`${M.moveKo(a.move)}이 통하지 않음`);
          }
          if (a.kind === 'recover' && up > 0.02) {
            const heal = Math.min(RECOVER[a.move], 100 - hp['m' + i]);
            score += W.recoverW * heal / 100 * up * rep;
            notes.push(`${M.moveKo(a.move)} → HP +${Math.round(heal)}%`);
          }
          if (a.pivot && up > 0.5) score += 0.05;  // 공격하고 유리한 포켓몬으로 교체
        }
        if (a.kind === 'redirect' && !log.some(x => x.k === 'hit' && x.to === 'm' + i && x.from[0] === 'o')) score -= 0.1;
        if (a.kind === 'helping') score += 0.02;
        if (a.kind === 'wideguard' && !log.some(x => x.k === 'wide')) score -= 0.15;
      });
      return {score, hp, alive, log, notes, koBefore, flinched};
    }

    const o0 = optionsFor(0), o1 = optionsFor(1);
    const combos = [];
    for (const a of o0) for (const b of o1) {
      if (a.kind === 'switch' && b.kind === 'switch' && a.to === b.to) continue;
      if (a.kind === 'trickroom' && b.kind === 'trickroom') continue;  // 둘 다 쓰면 원래대로
      const sims = scenarios.map(sc => ({...simulate(a, b, sc.s), p: sc.p, scen: sc.s}));
      const score = sims.reduce((x, y) => x + y.p * y.score, 0);
      const main = sims.reduce((x, y) => (y.p > x.p ? y : x));  // 가장 가능성 높은 경우를 화면에 보여줌
      combos.push({acts: [a, b], ...main, score, sims});
    }
    combos.sort((x, y) => y.score - x.score);
    // 비슷한 조합 중복 제거 (같은 행동 종류·기술이면 대상만 다른 것 하나만)
    const seen = new Set(), top = [];
    for (const c of combos) {
      // 유인에 끌려가서 결과가 같은 대상 차이는 하나로 봄
      const k = c.acts.map((a, i) => { const red = c.log.find(x => x.k === 'redirected' && x.from === 'm' + i); return [a.kind, a.move, a.to, a.pivotTo, red ? red.to : (typeof a.target === 'number' ? 'o' + a.target : a.target)].join(':'); }).join('|');
      if (seen.has(k)) continue;
      seen.add(k); top.push(c);
      if (top.length >= 3) break;
    }
    // 한 마리씩 본 기술별 데미지 (표시용)
    const grid = [0, 1].map(i => (mine[i] ? mine[i].set.moves.filter(Boolean).map(mv => ({
      move: mv, prio: priorityOf(mine[i].set, mv, f), spread: isSpread(mv), ally: hitsAlly(mv),
      vs: [0, 1].map(j => (opps[j] ? dmg('m' + i, mv, 'o' + j) : null)),
    })) : []));
    const incoming = [0, 1].map(j => (opps[j] ? opps[j].set.moves.filter(Boolean).map(mv => ({
      move: mv, prio: priorityOf(opps[j].set, mv, f), spread: isSpread(mv),
      vs: [0, 1].map(i => (mine[i] ? dmg('o' + j, mv, 'm' + i) : null)),
    })) : []));
    // dmg: 화면에서 기록한 기술로 교체해 들어온 포켓몬의 예상 HP를 구할 때 씀 ('b0' 내 뒤, 'x0' 상대 뒤)
    return {top, oppPred, defense, scenarios, speeds: spd, grid, incoming, mine, opps, bench, oppBench, presence, assumeMega, trickRoom: tr, count: combos.length, dmg,
            all: combos.map(c => ({acts: c.acts, score: c.score}))};  // all: 모든 행동 조합 점수 (확인용)
  }

  return {advise, oppInfo, oppSetOf, baseForm, canMega, priorityOf, isSpread, hitsAlly, entryConditions, SETUP_BOOST, HAZARD};
}

export {STAT_KO};
