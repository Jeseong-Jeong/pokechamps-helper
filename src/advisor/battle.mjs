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

export function createBattle(M, P) {
  const {D, byId} = M;
  const usageById = Object.fromEntries(D.usage.map(u => [u.id, u]));
  const moveEn = i => (typeof i === 'number' ? D.moves[i].en : i);
  const moveOf = n => D.moves[M.moveByEn[n]];
  const calcMove = n => GEN.moves.get(toID(n));

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
      items: u ? u.it : [], abilities: u ? u.ab.map(([n, p]) => [n, p]) : base.ab.map(a => [a.en, 0]),
      mates: u ? u.tm.filter(t => t[2]).map(t => [t[2], t[1]]) : [],
    };
  }

  // 상대 세트 = 사용률 1순위 + 사용자가 확인한 도구·특성·기술
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
    return s;
  }

  // 상태(HP·상태이상·랭크)를 세트에 반영
  const withState = (set, slot) => ({...set, hpPct: Math.max(1, slot.hpPct ?? 100), status: slot.status || '', boosts: {atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...(slot.boosts || {})}});

  function toModelField(f) {
    return {doubles: true, weather: f.weather || '', terrain: f.terrain || '', crit: false,
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
    const opps = state.opp.map(s => (s && s.id && (s.hpPct ?? 100) > 0 ? {...s, set: withState(oppSetOf(s), s)} : null));
    const bench = (state.bench || []).map(s => (s && s.set && (s.hpPct ?? 100) > 0 ? {...s, set: withState(s.set, s)} : null)).filter(Boolean);
    // 상대 뒤에 있을 수 있는 포켓몬 (선출 탭의 상대 6마리 중 필드에 없는 것)
    const oppBench = (state.oppBench || []).filter(id => byId[id] && !opps.some(o => o && o.id === id))
      .map(id => ({id, hpPct: 100, set: withState(oppSetOf({id}), {hpPct: 100})}));
    const spd = {me: mine.map(m => m && M.speed(m.set, field, true)), opp: opps.map(o => o && M.speed(o.set, field, false))};

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
    const defense = opps.map((o, j) => {
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
    // 경우의 수: 상대마다 [공격, 방어, 교체] 중 확률 있는 것
    const branches = defense.map(d => {
      if (!d) return [{type: 'none', p: 1}];
      const b = [{type: 'attack', p: d.pA}];
      if (d.pP > 0) b.push({type: 'protect', p: d.pP});
      if (d.pS > 0) b.push({type: 'switch', p: d.pS, k: d.switchTo.k});
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
        if (m.c === '변화') continue;
        if (isSpread(mv)) out.push({kind: 'attack', i, move: mv, target: 'spread'});
        else for (const j of [0, 1]) if (opps[j]) out.push({kind: 'attack', i, move: mv, target: j});
      }
      bench.forEach((b, k) => out.push({kind: 'switch', i, to: k}));
      return out;
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
      if (acts[0] && acts[0].kind === 'switch') hp.m0 = bench[acts[0].to].hpPct;
      if (acts[1] && acts[1].kind === 'switch') hp.m1 = bench[acts[1].to].hpPct;
      const startHp = {...hp};
      const protecting = [0, 1].map(i => acts[i] && acts[i].kind === 'protect');
      const redirector = [0, 1].find(i => acts[i] && acts[i].kind === 'redirect');
      const wide = [0, 1].some(i => acts[i] && acts[i].kind === 'wideguard');
      const helped = [0, 1].map(i => acts[1 - i] && acts[1 - i].kind === 'helping');
      const flinched = {o0: false, o1: false, m0: false, m1: false};
      // 상대 유인: 유인한 상대가 살아 있으면 내 단일 공격이 그쪽으로 (분노가루는 풀 타입·방진에게 안 통함)
      const oppRedir = oppPred.findIndex(p => p && p.redirect);
      const acted = {};
      const log = [];
      const dealt = {o0: 0, o1: 0};
      const koBefore = {};  // 상대가 행동하기 전에 쓰러짐

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
        if (hp[key] <= 0) continue;
        if (flinched[key]) { log.push({k: 'flinch', who: key}); continue; }
        acted[key] = true;
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
            const d = avgOf(r) * mult;
            const sure = r.minPct * mult >= hp[tk];
            hp[tk] -= d; dealt[tk] += d;
            if (hp[tk] <= 0 && !acted[tk]) koBefore[tk] = true;
            if (a.fakeout && r.maxPct > 0 && !acted[tk] && !NO_FLINCH.includes(opps[j].set.ability)) flinched[tk] = true;
            log.push({k: 'hit', from: 'm' + act.i, to: tk, toId: scen[j].type === 'switch' ? oppBench[scen[j].k].id : null, move: a.move, r, mult, ko: hp[tk] <= 0, sure});
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
            hp[mk] -= avgOf(r);
            // 상대 속이다: 아직 행동 안 한 내 포켓몬은 풀죽음 (정신력 등 제외)
            const target = who[mk][0] === 'b' ? bench[+who[mk][1]] : mine[i];
            if (p.move === 'Fake Out' && r.maxPct > 0 && !acted[mk] && !NO_FLINCH.includes(target.set.ability)) flinched[mk] = true;
            log.push({k: 'hit', from: 'o' + act.i, to: mk, move: p.move, r, ko: hp[mk] <= 0, sure: r.minPct >= startHp[mk]});
          }
        }
      }

      // ---------- 점수 ----------
      let score = 0;
      const notes = [];
      [0, 1].forEach(j => {
        const k = 'o' + j;
        if (!opps[j]) return;
        if (hp[k] <= 0) score += scen[j].type === 'switch' ? 0.9 : 1 + 0.3 * threat[j] + (koBefore[k] ? 0.3 * threat[j] : 0);
        else score += 0.45 * Math.min(1, dealt[k] / Math.max(1, startHp[k]));
        if (flinched[k] && oppPred[j] && oppPred[j].move && scen[j].type === 'attack') score += 0.4 * threat[j];
      });
      [0, 1].forEach(i => {
        const k = 'm' + i;
        if (!mine[i]) return;
        const lost = startHp[k] - Math.max(0, hp[k]);
        if (hp[k] <= 0) score -= acted[k] ? 0.7 : 1.0;
        score -= 0.25 * lost / 100;
        if (flinched[k] && acts[i] && acts[i].kind !== 'switch' && acts[i].kind !== 'protect') score -= 0.3;  // 속이다에 막힘
      });
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
        if (a.kind === 'switch') score -= 0.15;
        if (a.kind === 'redirect' && !log.some(x => x.k === 'hit' && x.to === 'm' + i && x.from[0] === 'o')) score -= 0.1;
        if (a.kind === 'helping') score += 0.02;
        if (a.kind === 'wideguard' && !log.some(x => x.k === 'wide')) score -= 0.15;
      });
      return {score, hp, log, notes, koBefore, flinched};
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
      const k = c.acts.map((a, i) => { const red = c.log.find(x => x.k === 'redirected' && x.from === 'm' + i); return [a.kind, a.move, a.to, red ? red.to : (typeof a.target === 'number' ? 'o' + a.target : a.target)].join(':'); }).join('|');
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
    return {top, oppPred, defense, scenarios, speeds: spd, grid, incoming, mine, opps, bench, oppBench, trickRoom: tr, count: combos.length};
  }

  return {advise, oppInfo, oppSetOf, priorityOf, isSpread, hitsAlly, entryConditions};
}

export {STAT_KO};
