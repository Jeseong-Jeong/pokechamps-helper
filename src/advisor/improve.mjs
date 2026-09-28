// 팀 진단 (DOM 없음)
// 1) 팀 점수 = 메타 대응력(사용률 상위 포켓몬을 얼마나 잘 받아치나, 실제 데미지 계산) + 타입 약점 + 공격 범위
//            + 역할(속이다·스피드 조절·위협) + 파트너 궁합 − 메가 과다
// 2) 가장 약한 멤버(빼면 점수가 가장 덜 떨어지는 멤버) → 그 자리에 넣으면 점수가 가장 오르는 포켓몬
// 3) 포켓몬 유지: 기술·도구·SP·성격 다듬기 (적용하면 바뀐 세트를 돌려줌)
import {NATURES, STAT_KO, statValue} from './model.mjs';
import {effectiveness} from './team.mjs';

const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const PROTECT = ['Protect', 'Detect', 'Spiky Shield', "King's Shield", 'Baneful Bunker', 'Silk Trap', 'Burning Bulwark', 'Obstruct'];
const KEY_ROLES = ['fakeout', 'speed', 'intimidate'];
const FIELD = {doubles: true, weather: '', terrain: '', crit: false, L: {}, R: {}};
const STONE = /ite( [XYZ])?$/;
const isStone = n => STONE.test(n) && n !== 'Eviolite';
// 화면 갱신용으로 잠깐 양보. setTimeout은 숨겨진 탭에서 1초 이상으로 늘어나므로 MessageChannel 사용
const yieldNow = () => new Promise(r => {
  if (typeof MessageChannel === 'undefined') return setTimeout(r, 0);
  const ch = new MessageChannel();
  ch.port1.onmessage = () => { ch.port1.close(); r(); };
  ch.port2.postMessage(0);
});
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const spSum = sp => STATS.reduce((a, k) => a + (sp[k] || 0), 0);
const clone = s => JSON.parse(JSON.stringify(s));
// 대체 기술로 추천하지 않을 것 (반동·충전·조건부·실전성 낮음)
const BAD_MOVES = new Set(['Focus Punch', 'Hyper Beam', 'Giga Impact', 'Solar Beam', 'Solar Blade', 'Sky Attack', 'Self-Destruct', 'Explosion',
  'Dream Eater', 'Belch', 'Last Resort', 'Synchronoise', 'Mind Blown', 'Steel Beam', 'Future Sight', 'Doom Desire', 'Blast Burn', 'Frenzy Plant',
  'Hydro Cannon', 'Rock Wrecker', 'Roar of Time', 'Prismatic Laser', 'Meteor Assault', 'Eternabeam', 'Razor Wind', 'Skull Bash',
  'Dig', 'Dive', 'Fly', 'Bounce', 'Phantom Force', 'Shadow Force', 'Sky Drop', 'Fling', 'Natural Gift', 'Snore', 'Round', 'Echoed Voice',
  'Spit Up', 'Stored Power', 'Power Trip', 'Punishment', 'Endeavor', 'Final Gambit', 'Memento', 'Counter', 'Mirror Coat', 'Metal Burst', 'Bide']);
const ROLE_MOVES = new Set(['Fake Out', 'Tailwind', 'Trick Room', 'Follow Me', 'Rage Powder', 'Icy Wind', 'Electroweb', 'Wide Guard', 'Parting Shot', 'Spore']);
// 데미지보다 부가 효과가 목적인 공격기 (성격·공격 종류 판단에서 뺌)
const UTILITY_ATTACKS = new Set(['U-turn', 'Volt Switch', 'Flip Turn', 'Fake Out', 'Icy Wind', 'Electroweb', 'Snarl', 'Rock Tomb', 'Mud Shot',
  'Bulldoze', 'Struggle Bug', 'Breaking Swipe', 'Lunge', 'Trop Kick', 'Mystical Fire', 'Spirit Break', 'Nuzzle', 'Pounce', 'Chilling Water',
  'Low Kick', 'Grass Knot', 'Night Shade', 'Seismic Toss', 'Super Fang', 'Ruination']);
const ATE = {Aerilate: 'flying', Pixilate: 'fairy', Refrigerate: 'ice', Galvanize: 'electric', Dragonize: 'dragon'};

// 팀 짜기 단계라 시간이 좀 걸려도 정확도 우선 (상대 20마리, 사용률 0.5% 이상 후보 전부)
export function createImprover(M, T, P, {threatCount = 20, poolMinPct = 0.5, natureko = {}} = {}) {
  const {D, byId} = M;
  const NK = n => natureko[n] || n;
  const usageById = Object.fromEntries(D.usage.map(u => [u.id, u]));
  const moveEn = i => (typeof i === 'number' ? D.moves[i].en : i);
  const moveOf = n => D.moves[M.moveByEn[n]];

  // 자주 만나는 상대: 사용률 상위 (메가스톤 40%+ 이면 메가 형태)
  const threatIds = D.usage.slice(0, threatCount).map(u => u.id);
  const threats = threatIds.map(id => P.oppSet(id));
  const threatTypes = threats.map(t => byId[t.id].ty);
  // 세트의 공격기 타입 (스카이스킨 등 변환 반영)
  const atkTypes = set => new Set(set.moves.filter(Boolean).map(n => moveOf(n)).filter(m => m && m.c !== '변화')
    .map(m => (ATE[set.ability] && m.t === 'normal' ? ATE[set.ability] : m.t)));
  // 팀에서 아무도 효과 굉장히 칠 수 없는 자주 만나는 상대 (실제 타입 조합 기준)
  const unhit = sets => {
    const types = [...new Set(sets.flatMap(s => [...atkTypes(s)]))];
    return threats.map((_, j) => j).filter(j => !types.some(t => effectiveness(t, threatTypes[j]) > 1));
  };
  const weights = threatIds.map(id => usageById[id].pct);
  const W = weights.reduce((a, b) => a + b, 0);

  // 세트별 상대 16마리 상성 줄 (캐시)
  const rowCache = new Map();
  const keyOf = s => JSON.stringify([s.id, s.item, s.ability, s.nature, s.sp, s.moves, s.boosts]);
  function row(set) {
    const k = keyOf(set);
    if (!rowCache.has(k)) rowCache.set(k, P.matrix([set], threats)[0]);
    return rowCache.get(k);
  }

  // ---------------- 팀 점수 ----------------
  function score(sets) {
    const rows = sets.map(row);
    // 메타 대응: 상대마다 가장 좋은 대답 + 두 번째 대답 약간
    const per = threats.map((_, j) => {
      const v = rows.map(r => r[j].v).sort((a, b) => b - a);
      return (v[0] ?? -1) + 0.3 * (v[1] ?? v[0] ?? -1);
    });
    const meta = per.reduce((a, x, j) => a + weights[j] * x, 0) / W;
    const ids = sets.map(s => s.baseId || s.id);
    const A = T.analyze(ids, sets);
    const danger = A.types.filter(x => x.danger);
    const gaps = A.types.reduce((a, x) => a + Math.max(0, x.weak - x.resist - x.immune - 1), 0);
    const noHit = unhit(sets);
    const missing = KEY_ROLES.filter(r => !A.roles[r].length);
    let syn = 0, pairs = 0;
    for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
      const tm = (x, y) => { const u = usageById[x]; const t = u && u.tm.find(q => q[2] === y); return t ? t[1] : 0; };
      syn += (tm(ids[a], ids[b]) + tm(ids[b], ids[a])) / 2; pairs++;
    }
    syn = pairs ? syn / pairs : 0;
    const parts = {
      meta, types: -0.12 * danger.length - 0.04 * gaps, cover: -0.04 * noHit.length,
      roles: -0.08 * missing.length, syn: syn / 100 * 0.4, mega: A.megas > 2 ? -0.1 * (A.megas - 2) : 0,
    };
    const total = Object.values(parts).reduce((a, b) => a + b, 0);
    return {total, parts, per, danger: danger.map(x => x.t), noHit, missing, A};
  }
  // 사람이 보기 좋은 0~100 점수
  const pretty = t => Math.max(0, Math.min(100, Math.round(t * 60)));

  // ---------------- 약한 멤버 ----------------
  // 트릭룸은 계산에 안 들어가므로, 느린 멤버가 2마리 이상인 팀의 트릭룸 사용자는 "핵심"으로 보고 교체 대상에서 뺌
  const slowish = s => (NATURES[s.nature] || [])[1] === 'spe' || M.finalStats(s).spe <= 70;
  function coreOf(sets) {
    return sets.map((s, i) => s.moves.includes('Trick Room') && sets.filter((o, k) => k !== i && slowish(o)).length >= 2);
  }
  function weakest(sets) {
    const full = score(sets).total;
    const core = coreOf(sets);
    return sets.map((s, i) => ({i, core: core[i], contrib: full - score(sets.filter((_, k) => k !== i)).total}))
      .sort((a, b) => (a.core - b.core) || a.contrib - b.contrib);
  }

  // 새 멤버 세트: 사용률 1순위, 팀 도구와 안 겹치게
  function setFor(id, usedItems) {
    const u = usageById[id], e = byId[id];
    const s = {...M.defaultSet(id), baseId: id};
    if (!u) return s;
    const stone = u.it.find(([n, p]) => isStone(n) && p >= 40 && !usedItems.has(n));
    if (stone && e.megas) {
      const suf = (stone[0].match(/ ([XYZ])$/) || [])[1];
      const mega = e.megas.find(m => ((m.match(/ ([XYZ])$/) || [])[1]) === suf);
      if (mega) return {...s, id: mega, item: stone[0], ability: byId[mega].ab[0].en};
    }
    const it = u.it.find(([n]) => !isStone(n) && !usedItems.has(n));
    return {...s, item: it ? it[0] : ''};
  }

  const pool = D.usage.filter(u => u.pct >= poolMinPct && byId[u.id]).map(u => u.id);
  // 후보의 대표 세트(도구 겹침 무시) — 상위 상대와의 상성 줄은 팀과 무관하므로 후보마다 한 번만 계산해서 재사용
  const freeCache = new Map();
  const freeSet = id => { if (!freeCache.has(id)) freeCache.set(id, setFor(id, new Set())); return freeCache.get(id); };

  // 가벼운 사전 점수: 인기 + 팀 약점 타입을 받아줌 + 빠진 역할 + 파트너 궁합 (무거운 데미지 계산 전에 후보를 추림)
  function quick(id, others) {
    const u = usageById[id], s = freeSet(id), e = byId[s.id];
    const A = T.analyze(others.map(o => o.baseId || o.id), others);
    let q = 8 * Math.log10(1 + u.pct);
    for (const x of A.types) {
      const gap = x.weak - x.resist - x.immune;
      const m = effectiveness(x.t, e.ty, s.ability);
      if (gap >= 1 && m < 1) q += 3 * gap;
      if (x.weak >= 2 && m > 1) q -= 3;
    }
    for (const r of T.rolesOf(id, s)) if (KEY_ROLES.includes(r) && !A.roles[r].length) q += 6;
    for (const o of others) {
      const t = u.tm.find(x => x[2] === (o.baseId || o.id));
      if (t) q += t[1] / 10;
    }
    return q;
  }

  // 교체 이유: 전후 비교
  function reasons(before, after) {
    const out = [];
    const better = threats.map((t, j) => ({j, d: after.per[j] - before.per[j]})).filter(x => x.d >= 0.35 && after.per[x.j] > 0.3)
      .sort((a, b) => b.d - a.d).slice(0, 3);
    if (better.length) out.push({good: true, text: `${better.map(x => byId[threats[x.j].id].ko).join('·')} 대응 좋아짐`});
    const worse = threats.map((t, j) => ({j, d: after.per[j] - before.per[j]})).filter(x => x.d <= -0.35 && after.per[x.j] < 0.2)
      .sort((a, b) => a.d - b.d).slice(0, 2);
    const fixed = before.danger.filter(t => !after.danger.includes(t));
    if (fixed.length) out.push({good: true, text: `${fixed.map(t => D.typeko[t]).join('·')} 약점 해소`});
    const newDanger = after.danger.filter(t => !before.danger.includes(t));
    const roles = before.missing.filter(r => !after.missing.includes(r));
    const T2 = {fakeout: '속이다', speed: '스피드 조절', intimidate: '위협'};
    if (roles.length) out.push({good: true, text: `${roles.map(r => T2[r]).join('·')} 담당 생김`});
    const lost = after.missing.filter(r => !before.missing.includes(r));
    const hit = before.noHit.filter(j => !after.noHit.includes(j));
    if (hit.length) out.push({good: true, text: `${hit.map(j => byId[threats[j].id].ko).join('·')}를 약점으로 칠 수 있음`});
    if (worse.length) out.push({good: false, text: `${worse.map(x => byId[threats[x.j].id].ko).join('·')} 대응 약해짐`});
    if (newDanger.length) out.push({good: false, text: `${newDanger.map(t => D.typeko[t]).join('·')} 약점 생김`});
    if (lost.length) out.push({good: false, text: `${lost.map(r => T2[r]).join('·')} 담당 없어짐`});
    return out;
  }

  // 한 자리 교체 후보. onProgress(done, total) 는 화면 갱신용
  async function swaps(sets, {slots = 2, per = 3, shortlist = Infinity, pairTop = 10, onProgress, yieldMs = 100} = {}) {
    let last = now();
    const base = score(sets);
    const weak = weakest(sets).filter(w => !w.core).slice(0, slots);
    const results = [];
    let done = 0;
    const total = weak.length * Math.min(shortlist, pool.length);
    for (const w of weak) {
      const others = sets.filter((_, k) => k !== w.i);
      const nos = new Set(others.map(s => byId[s.baseId || s.id].no));
      const used = new Set(others.map(s => s.item).filter(Boolean));
      const shortl = pool.filter(id => !nos.has(byId[id].no) && id !== (sets[w.i].baseId || sets[w.i].id))
        .map(id => ({id, q: quick(id, others)})).sort((a, b) => b.q - a.q).slice(0, shortlist);
      const cands = [];
      for (const {id} of shortl) {
        done++;
        const next = sets.slice(); next[w.i] = freeSet(id);   // 점수는 대표 세트로 (상성 줄 재사용)
        const sc = score(next);
        cands.push({id, set: setFor(id, used), delta: sc.total - base.total, after: sc});
        if (onProgress && now() - last > yieldMs) { onProgress(done, total); await yieldNow(); last = now(); }
      }
      cands.sort((a, b) => b.delta - a.delta);
      results.push({slot: w.i, contrib: w.contrib, options: cands.slice(0, per).map(c => ({...c, why: reasons(base, c.after)})), top: cands.slice(0, pairTop)});
    }
    // 두 자리 동시 교체: 각 자리 상위 6개끼리 조합
    let pair = null;
    if (results.length >= 2) {
      const [A, B] = results;
      for (const a of A.top) for (const b of B.top) {
        if (byId[a.id].no === byId[b.id].no) continue;
        const sA = a.set, sB = b.set.item && b.set.item === sA.item ? setFor(b.id, new Set([...sets.filter((_, k) => k !== A.slot && k !== B.slot).map(s => s.item), sA.item])) : b.set;
        const next = sets.slice(); next[A.slot] = sA; next[B.slot] = sB;
        const sc = score(next);
        const d = sc.total - base.total;
        if (!pair || d > pair.delta) pair = {slots: [A.slot, B.slot], sets: [sA, sB], delta: d, why: reasons(base, sc)};
      }
    }
    return {base, pretty: pretty(base.total), results, pair, core: coreOf(sets)};
  }

  // ---------------- 세트 다듬기 ----------------
  function usedCategories(set) {
    const c = new Set();
    for (const n of set.moves) { const m = moveOf(n); if (m && m.c !== '변화' && !UTILITY_ATTACKS.has(n)) c.add(m.c); }
    return c;
  }

  function tune(sets, i) {
    const set = sets[i], e = byId[set.id], baseId = set.baseId || set.id;
    const u = usageById[baseId];
    const out = [];
    const add = (kind, text, next, why) => out.push({kind, text, why, set: next});
    const baseTotal = score(sets).total;
    const learn = new Set(M.learnset(e).map(m => m.en));
    const mvPct = new Map(u ? u.mv.map(([m, p]) => [moveEn(m), p]) : []);
    const moves = set.moves.filter(Boolean);

    // --- 기술 ---
    const hasProtect = moves.some(m => PROTECT.includes(m));
    const protectPct = Math.max(0, ...PROTECT.map(p => mvPct.get(p) || 0));
    // 뺄 기술: 채용률 낮은 순, 자속 공격기·역할 기술·방어는 되도록 남김
    const keep = m => { const mv = moveOf(m); return (mvPct.get(m) || 0) + (mv && mv.c !== '변화' && e.ty.includes(mv.t) ? 15 : 0) + (ROLE_MOVES.has(m) ? 30 : 0) + (PROTECT.includes(m) ? 40 : 0); };
    const leastUsed = () => moves.slice().sort((a, b) => keep(a) - keep(b))[0];
    if (!hasProtect && protectPct >= 25 && moves.length) {
      const p = PROTECT.find(x => (mvPct.get(x) || 0) === protectPct);
      const out1 = leastUsed();
      const next = clone(set); next.moves = next.moves.map(m => (m === out1 ? p : m));
      add('move', `${M.moveKo(out1)} → ${M.moveKo(p)}`, next, `더블에서는 방어 계열이 거의 필수 (이 포켓몬 ${protectPct.toFixed(0)}% 채용)`);
    }
    if (u) {
      const popular = u.mv.map(([m, p]) => [moveEn(m), p]).filter(([m, p]) => p >= 20 && learn.has(m) && !moves.includes(m));
      for (const [m, p] of popular.slice(0, 2)) {
        const weakMove = leastUsed();
        if (!weakMove || (mvPct.get(weakMove) || 0) >= p / 2 || (mvPct.get(weakMove) || 0) >= 12) continue;
        if (out.some(o => o.kind === 'move' && o.set.moves.includes(m))) continue;
        const next = clone(set); next.moves = next.moves.map(x => (x === weakMove ? m : x));
        add('move', `${M.moveKo(weakMove)} → ${M.moveKo(m)}`, next, `채용률 ${(mvPct.get(weakMove) || 0).toFixed(0)}% → ${p.toFixed(0)}%`);
      }
    }
    // 팀에서 아무도 약점으로 못 치는 자주 만나는 상대를 이 포켓몬이 칠 수 있으면
    const noHit = unhit(sets);
    if (noHit.length) {
      const cats = usedCategories(set);
      const opts = M.learnset(e).filter(m => m.c !== '변화' && (cats.size === 0 || cats.has(m.c)) && !moves.includes(m.en)
          && +m.pw >= 60 && (+m.acc || 100) >= 85 && !BAD_MOVES.has(m.en))
        .map(m => ({m, hits: noHit.filter(j => effectiveness(m.t, threatTypes[j]) > 1),
                    val: +m.pw * (e.ty.includes(m.t) ? 1.5 : 1) * ((+m.acc || 100) / 100) * (1 + (mvPct.get(m.en) || 0) / 20)}))
        .filter(x => x.hits.length).sort((a, b) => b.hits.length - a.hits.length || b.val - a.val);
      if (opts.length) {
        const {m, hits} = opts[0];
        const weakMove = moves.filter(x => !PROTECT.includes(x) && !ROLE_MOVES.has(x)).sort((a, b) => keep(a) - keep(b))[0];
        if (weakMove && keep(weakMove) < 40) {
          const next = clone(set); next.moves = next.moves.map(x => (x === weakMove ? m.en : x));
          add('move', `${M.moveKo(weakMove)} → ${M.moveKo(m.en)}`, next, `팀에서 아무도 약점으로 못 치던 ${hits.map(j => byId[threats[j].id].ko).join('·')}를 효과 굉장히`);
        }
      }
    }

    // --- 도구 ---
    const teamItems = new Set(sets.filter((_, k) => k !== i).map(s => s.item).filter(Boolean));
    if (set.item && teamItems.has(set.item)) {
      const alt = u && u.it.find(([n]) => !isStone(n) && !teamItems.has(n) && n !== set.item);
      if (alt) { const next = clone(set); next.item = alt[0]; add('item', `${M.itemKo(set.item)} → ${M.itemKo(alt[0])}`, next, '같은 도구는 팀에 하나만 (아이템 클로즈)'); }
    } else if (u && set.id === baseId) {
      const cur = (u.it.find(([n]) => n === set.item) || [0, 0])[1];
      const top = u.it.find(([n]) => !isStone(n) && !teamItems.has(n));
      if (top && top[0] !== set.item && top[1] >= 15 && cur < 5) {
        const next = clone(set); next.item = top[0];
        add('item', `${set.item ? M.itemKo(set.item) : '없음'} → ${M.itemKo(top[0])}`, next, `채용률 ${cur.toFixed(0)}% → ${top[1].toFixed(0)}%`);
      }
    }

    // --- 성격 ---
    const cats = usedCategories(set);
    const [up, down] = NATURES[set.nature] || [];
    const usesAtk = cats.has('물리'), usesSpa = cats.has('특수');
    if ((down === 'atk' && usesAtk) || (down === 'spa' && usesSpa)) {
      const want = usesAtk && !usesSpa ? (up === 'spe' ? 'Jolly' : 'Adamant') : !usesAtk && usesSpa ? (up === 'spe' ? 'Timid' : 'Modest') : 'Hardy';
      const next = clone(set); next.nature = want;
      add('nature', `${NK(set.nature)} → ${NK(want)}`, next, `지금 성격이 쓰는 공격(${STAT_KO[down]})을 깎음`);
    } else if (usesAtk !== usesSpa && ((up === 'atk' && !usesAtk) || (up === 'spa' && !usesSpa))) {
      const want = usesAtk ? 'Adamant' : 'Modest';
      const next = clone(set); next.nature = want;
      add('nature', `${NK(set.nature)} → ${NK(want)}`, next, `안 쓰는 ${STAT_KO[up]}을 올리는 성격`);
    }

    // --- SP ---
    const total = spSum(set.sp);
    const offense = usesAtk && !usesSpa ? 'atk' : usesSpa && !usesAtk ? 'spa' : null;
    const unusedOff = offense === 'atk' ? 'spa' : offense === 'spa' ? 'atk' : null;
    if (total < 66) {
      const next = clone(set);
      next.sp.hp = Math.min(32, (next.sp.hp || 0) + (66 - total));
      const left = 66 - spSum(next.sp);
      if (left > 0) next.sp.def = Math.min(32, (next.sp.def || 0) + left);
      add('sp', `남은 SP ${66 - total} → HP${left > 0 ? '·방어' : ''}에`, next, 'SP는 66까지 쓸 수 있음');
    }
    if (unusedOff && (set.sp[unusedOff] || 0) > 0) {
      const next = clone(set); const n = next.sp[unusedOff]; next.sp[unusedOff] = 0; next.sp.hp = Math.min(32, (next.sp.hp || 0) + n);
      const left = n - (next.sp.hp - (set.sp.hp || 0));
      if (left > 0) next.sp.spd = Math.min(32, (next.sp.spd || 0) + left);
      add('sp', `안 쓰는 ${STAT_KO[unusedOff]} SP ${n} → 내구로`, next, `${STAT_KO[unusedOff]} 기술이 없음`);
    }

    // 스피드 기준점: 조금만 올리면 앞지를 수 있는 자주 만나는 상대
    const mySpe = M.finalStats(set).spe;
    const donors = STATS.filter(k => k !== 'spe' && k !== offense && k !== 'hp').concat(['hp']);
    const spare = () => (66 - total) + (unusedOff ? set.sp[unusedOff] || 0 : 0);
    // 트릭룸 쓰는 포켓몬·트릭룸 팀의 느린 포켓몬은 스피드를 올리라고 하지 않음
    const trickRoom = moves.includes('Trick Room') || (NATURES[set.nature] || [])[1] === 'spe'
      || (sets.some(s => s.moves.includes('Trick Room')) && mySpe < 80);
    const bench = trickRoom ? [] : threats.map((t, j) => ({j, spe: M.finalStats(t).spe})).filter(x => x.spe >= mySpe)
      .map(x => {
        let need = null;
        for (let s = set.sp.spe || 0; s <= 32; s++) if (statValue(e.st[5], s, 'spe', set.nature) > x.spe) { need = s; break; }
        return {...x, need, add: need == null ? null : need - (set.sp.spe || 0)};
      })
      .filter(x => x.add != null && x.add > 0 && x.add <= 12).sort((a, b) => a.add - b.add || weights[b.j] - weights[a.j]);
    if (bench.length) {
      const b = bench[0];
      const next = clone(set);
      next.sp.spe = b.need;
      let owe = Math.max(0, spSum(next.sp) - 66);
      const took = [];
      for (const k of donors) {
        if (!owe) break;
        const give = Math.min(owe, next.sp[k] || 0);
        if (give) { next.sp[k] -= give; owe -= give; took.push(`${STAT_KO[k]} −${give}`); }
      }
      if (!owe) {
        const beat = bench.filter(x => x.need <= b.need).map(x => byId[threats[x.j].id].ko);
        add('sp', `스피드 SP ${set.sp.spe || 0} → ${b.need}${took.length ? ` (${took.join(', ')})` : ''}`, next,
          `${beat.slice(0, 3).join('·')}보다 먼저 움직임 (${mySpe} → ${M.finalStats(next).spe})`);
      }
    }

    // 내구 기준점: 자주 만나는 상대의 가장 센 기술을 간당간당하게 못 버티면 HP·방어(특방)로 확정 버티기
    const tries = [];
    threats.forEach((t, j) => {
      const rows = M.damageTable(t, set, FIELD, false).filter(r => r.maxPct != null);
      if (!rows.length) return;
      const r = rows.reduce((a, b) => (b.maxPct > a.maxPct ? b : a));
      if (r.maxPct >= 100 && r.maxPct <= 125) tries.push({j, r});
    });
    tries.sort((a, b) => weights[b.j] - weights[a.j]);
    for (const {j, r} of tries.slice(0, 2)) {
      const defStat = r.category === 'Physical' ? 'def' : 'spd';
      const budgetFrom = [unusedOff, 'spe', defStat === 'def' ? 'spd' : 'def'].filter(Boolean);
      const t = threats[j];
      let found = null;
      for (let a = 0; a <= 32 - (set.sp.hp || 0) && !found; a += 2) {
        let lo = 0, hi = 32 - (set.sp[defStat] || 0), ok = null;
        const test = d => {
          const next = clone(set); next.sp.hp += a; next.sp[defStat] += d;
          const rr = M.damageTable({...t, moves: [r.name]}, next, FIELD, false)[0];
          return rr && rr.maxPct < 100 ? next : null;
        };
        if (!test(hi)) continue;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (test(mid)) hi = mid; else lo = mid + 1; }
        ok = test(lo);
        if (ok) found = {next: ok, a, d: lo};
      }
      if (!found || found.a + found.d > 20) continue;
      const next = found.next;
      let owe = Math.max(0, spSum(next.sp) - 66);
      const took = [];
      for (const k of budgetFrom) {
        if (!owe) break;
        const give = Math.min(owe, next.sp[k] || 0);
        if (give) { next.sp[k] -= give; owe -= give; took.push(`${STAT_KO[k]} −${give}`); }
      }
      if (owe) continue;
      add('sp', `${[found.a ? `HP +${found.a}` : '', found.d ? `${STAT_KO[defStat]} +${found.d}` : ''].filter(Boolean).join(', ')}${took.length ? ` (${took.join(', ')})` : ''}`, next,
        `${byId[t.id].ko}의 ${M.moveKo(r.name)}(${r.minPct.toFixed(0)}~${r.maxPct.toFixed(0)}%)를 확정으로 버팀`);
      break;
    }
    // 적용하면 팀 점수가 얼마나 바뀌는지. 점수(데미지 주고받기)에 안 잡히는 장점이 있는 추천은 표시만 하고,
    // 그 외에 점수를 눈에 띄게 떨어뜨리는 추천은 뺌
    for (const x of out) {
      const next = sets.slice(); next[i] = x.set;
      x.delta = score(next).total - baseTotal;
      x.offScore = (x.kind === 'move' && x.set.moves.some(m => PROTECT.includes(m)) && !set.moves.some(m => PROTECT.includes(m)))
        || (x.kind === 'item' && !isStone(x.set.item));
    }
    return out.filter(x => x.offScore || x.delta > -0.05).sort((a, b) => b.delta - a.delta);
  }

  return {score, pretty, weakest, swaps, tune, threats, threatIds, setFor};
}
