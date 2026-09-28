// 선출 추천 (DOM 없음). 더블배틀: 6마리 보여주고 4마리 선출, 그중 2마리 선봉
// 1) 내 6 × 상대 6 상성표: 서로 가장 센 기술의 평균 데미지%, 스피드
// 2) 4마리 조합 15개를 "상대 각 포켓몬에 대한 최선의 대답" 합으로 평가 (+역할·메가 보정)
// 3) 고른 4마리 안에서 선봉 2마리 6조합을 평가
const avg = r => (r.minPct + r.maxPct) / 2;

export function createPickAdvisor(M, T) {
  const {byId} = M;
  const FIELD = {doubles: true, weather: '', terrain: '', crit: false, L: {}, R: {}};

  // 상대 세트: 사용률 1순위 (메가스톤 40%+ 이면 메가 형태)
  const oppSet = id => T.teamSets([T.baseOf(id)])[0];

  function best(att, def, attIsLeft, field = FIELD) {
    const rows = M.damageTable(att, def, field, attIsLeft, {fast: true}).filter(r => r.maxPct != null);
    if (!rows.length) return {pct: 0, move: null, row: null};
    const top = rows.reduce((a, b) => (avg(b) > avg(a) ? b : a));
    return {pct: avg(top), move: top.name, row: top};
  }

  // 등장하면 날씨·필드를 까는 특성
  const WEATHER_OF = {Drought: 'Sun', Drizzle: 'Rain', 'Sand Stream': 'Sand', 'Snow Warning': 'Snow'};
  const TERRAIN_OF = {'Grassy Surge': 'Grassy', 'Psychic Surge': 'Psychic', 'Electric Surge': 'Electric', 'Misty Surge': 'Misty'};
  const condOf = s => ({weather: WEATHER_OF[s.ability] || '', terrain: TERRAIN_OF[s.ability] || ''});
  // 한 칸에서 싸우는 필드: 내 쪽(내 특성 → 팀 운영 ctx) vs 상대 특성. 서로 다르면 두 경우 모두 계산해서 평균
  function fieldsFor(a, b, ctx) {
    const mine = condOf(a), theirs = condOf(b);
    const my = {weather: mine.weather || ctx.weather || '', terrain: mine.terrain || ctx.terrain || ''};
    const out = [{...my}];
    if ((theirs.weather && theirs.weather !== my.weather) || (theirs.terrain && theirs.terrain !== my.terrain)) {
      out.push({weather: theirs.weather || my.weather, terrain: theirs.terrain || my.terrain});
    }
    return out.map(f => ({...FIELD, ...f}));
  }

  // 한 칸의 유불리 (+ 유리, − 불리). 데미지는 150%에서 자름
  function cellValue(off, def, faster) {
    const o = Math.min(off, 150) / 100, d = Math.min(def, 150) / 100;
    let v = o - 0.85 * d;
    if (off >= 100 && faster) v += 0.5;          // 먼저 때려서 잡음
    else if (def >= 100 && !faster) v -= 0.5;    // 먼저 맞고 쓰러짐
    else v += faster ? 0.12 : -0.05;
    return v;
  }

  // ctx = {weather, terrain, trickRoom}: 내 팀 운영(트릭룸이면 느린 쪽이 먼저)
  function matrix(mine, opp, ctx = {}) {
    return mine.map(a => opp.map(b => {
      const cells = fieldsFor(a, b, ctx).map(f => {
        const off = best(a, b, true, f), def = best(b, a, false, f);
        const sa = M.speed(a, f, true), sb = M.speed(b, f, false);
        const faster = ctx.trickRoom ? sa < sb : sa > sb;
        return {off, def, sa, sb, faster, field: f, v: cellValue(off.pct, def.pct, faster)};
      });
      if (cells.length === 1) return cells[0];
      // 날씨·필드 싸움: 두 경우 평균 (표시는 첫 번째 = 내 필드)
      return {...cells[0], v: (cells[0].v + cells[1].v) / 2, alt: cells[1]};
    }));
  }

  const combos = (n, k) => {
    const out = [];
    const go = (s, acc) => {
      if (acc.length === k) { out.push(acc); return; }
      for (let i = s; i < n; i++) go(i + 1, acc.concat(i));
    };
    go(0, []);
    return out;
  };

  function roleSet(idx, mineSets) {
    const r = new Set();
    idx.forEach(i => T.rolesOf(mineSets[i].baseId || mineSets[i].id, mineSets[i]).forEach(x => r.add(x)));
    return r;
  }

  // 상대 쪽 가중치: 사용률 높을수록 실제로 나올 가능성이 높다고 봄
  function oppWeights(oppIds) {
    return oppIds.map(id => {
      const u = M.usageOf(byId[id]);
      return 1 + (u ? Math.min(u.pct, 30) / 30 : 0) * 0.5;
    });
  }

  const isMega = s => s.baseId && s.id !== s.baseId;
  // 메가 세트의 "메가진화 안 한" 모습 (메가스톤 대신 다음 순위 도구)
  const unMega = s => ({...M.defaultSet(s.baseId), baseId: s.baseId});
  const TR_WEIGHT = 0.6;  // 트릭룸 담당을 데려가면 게임의 60% 정도를 트릭룸 아래에서 싸운다고 봄
  const PROTECT_TR = ['fakeout', 'redirect'];

  // 트릭룸 아래 칸: 데미지는 같고 행동 순서만 뒤집힘
  function trCell(c) {
    const f = x => { const faster = x.sa < x.sb; return {faster, v: cellValue(x.off.pct, x.def.pct, faster)}; };
    const a = f(c);
    return c.alt ? {faster: a.faster, v: (a.v + f(c.alt).v) / 2} : a;
  }

  // 내 팀 운영: 트릭룸 기술, 날씨·필드 특성
  function teamPlan(mine) {
    const trIdx = mine.map((s, i) => (s.moves.includes('Trick Room') ? i : -1)).filter(i => i >= 0);
    const wI = mine.findIndex(s => condOf(s).weather), tI = mine.findIndex(s => condOf(s).terrain);
    return {trIdx, wIdx: wI, tIdx: tI, weather: wI >= 0 ? condOf(mine[wI]).weather : '', terrain: tI >= 0 ? condOf(mine[tI]).terrain : ''};
  }

  function recommend(mineSets, oppIds) {
    const opp = oppIds.map(oppSet);
    const plan = teamPlan(mineSets);
    // 상황별 상성표: 날씨·필드 담당을 데려갔을 때(W) / 안 데려갔을 때(0), 메가 세트는 메가 안 한 모습(B)도
    const build = ctx => {
      const X = matrix(mineSets, opp, ctx);
      const XB = mineSets.map((s, i) => (isMega(s) ? matrix([unMega(s)], opp, ctx)[0] : X[i]));
      return {X, XB};
    };
    const C0 = build({});
    const CW = plan.weather || plan.terrain ? build({weather: plan.weather, terrain: plan.terrain}) : C0;
    const w = oppWeights(oppIds);
    const W = w.reduce((a, b) => a + b, 0);

    // 선출 조합에 맞는 칸 (날씨 담당 포함 여부, 트릭룸 담당 포함 여부, 메가진화할 멤버)
    function rowsFor(idx, megaI) {
      const useW = (plan.wIdx >= 0 && idx.includes(plan.wIdx)) || (plan.tIdx >= 0 && idx.includes(plan.tIdx));
      const useTR = plan.trIdx.some(i => idx.includes(i));
      const C = useW ? CW : C0;
      const megas = idx.filter(i => isMega(mineSets[i]));
      const rows = mineSets.map((_, i) => {
        const base = megas.includes(i) && i !== megaI ? C.XB[i] : C.X[i];
        return base.map(c => {
          if (!useTR) return c;
          const t = trCell(c);
          return {...c, trFaster: t.faster, v: (1 - TR_WEIGHT) * c.v + TR_WEIGHT * t.v};
        });
      });
      return {rows, useW, useTR, noTR: mineSets.map((_, i) => (megas.includes(i) && i !== megaI ? C.XB[i] : C.X[i]))};
    }

    function evalWith(idx, rows) {
      let score = 0;
      opp.forEach((_, j) => {
        const vals = idx.map(i => rows[i][j].v).sort((a, b) => b - a);
        // 최선의 대답 + 두 번째 대답 약간 (한 마리에 의존하지 않게)
        score += w[j] * (vals[0] + 0.3 * (vals[1] ?? vals[0]));
      });
      return score / W;
    }

    const picks = combos(mineSets.length, Math.min(4, mineSets.length)).map(idx => {
      const megas = idx.filter(i => isMega(mineSets[i]));
      // 누구를 메가진화시킬지까지 골라서 가장 좋은 경우로 평가
      let best = null;
      for (const m of (megas.length ? megas : [null])) {
        const R = rowsFor(idx, m);
        const sc = evalWith(idx, R.rows);
        if (!best || sc > best.score) best = {score: sc, megaI: m, ...R};
      }
      let score = best.score;
      const roles = roleSet(idx, mineSets);
      if (roles.has('fakeout')) score += 0.06;
      if (roles.has('speed')) score += 0.06;
      if (roles.has('intimidate')) score += 0.05;
      return {idx, score, roles, megaI: best.megaI, rows: best.rows, noTR: best.noTR, useW: best.useW, useTR: best.useTR, megaCount: megas.length};
    }).sort((a, b) => b.score - a.score);

    const top = picks[0];
    if (!top) return {opp, X: C0.X, weights: w, picks: [], leads: [], threats: [], plan};
    const L = leads(top, mineSets, w, plan);
    return {
      opp, X: C0.X, weights: w, plan, picks: picks.slice(0, 3), leads: L,
      threats: threats(top.rows, opp, top.idx),
      answers: answers(top, opp),
      dangers: dangers(top, opp, mineSets),
      gamePlan: L[0] ? gamePlan(L[0], top, mineSets, opp, w, plan) : [],
    };
  }

  // 선봉 2마리: 1턴은 트릭룸이 아직 없으므로 트릭룸 없는 상성으로 압박을 보고, 역할 조합을 더함
  function leads(top, mineSets, w, plan) {
    const {idx, noTR, useTR} = top;
    const W = w.reduce((a, b) => a + b, 0);
    const rolesOfI = i => T.rolesOf(mineSets[i].baseId || mineSets[i].id, mineSets[i]);
    return combos(idx.length, 2).map(([p, q]) => {
      const a = idx[p], b = idx[q];
      let score = 0;
      noTR[0].forEach((_, j) => { score += w[j] * Math.max(noTR[a][j].v, noTR[b][j].v); });
      score /= W;
      const ra = rolesOfI(a), rb = rolesOfI(b);
      const has = r => ra.includes(r) || rb.includes(r);
      const why = [];
      const trA = plan.trIdx.includes(a), trB = plan.trIdx.includes(b);
      if (useTR && (trA || trB)) {
        score += 0.22; why.push('1턴 트릭룸');  // 트릭룸 팀은 트릭룸 담당 선봉이 정석
        const partner = trA ? rb : ra;
        if (PROTECT_TR.some(r => partner.includes(r))) { score += 0.1; why.push(`${partner.includes('fakeout') ? '속이다' : '유인'}로 트릭룸 보호`); }
      } else if (useTR) {
        score -= 0.1;  // 트릭룸 담당이 뒤에 있으면 트릭룸을 늦게 깜
      }
      if (!(useTR && (trA || trB))) {
        if (has('fakeout') && has('speed')) { score += 0.15; why.push('속이다 + 스피드 조절'); }
        else if (has('fakeout')) { score += 0.08; why.push('속이다로 첫 턴 견제'); }
        else if (has('speed')) { score += 0.08; why.push('첫 턴 스피드 조절'); }
      }
      if ((plan.wIdx === a || plan.wIdx === b || plan.tIdx === a || plan.tIdx === b) && top.useW) {
        score += 0.06; why.push(`1턴부터 ${WEATHER_KO[plan.weather] || TERRAIN_KO[plan.terrain]}`);
      }
      if (has('intimidate')) { score += 0.05; why.push('위협'); }
      if (has('spread')) { score += 0.04; why.push('전체 공격'); }
      if (ra.includes('fakeout') && rb.includes('fakeout')) score -= 0.05;  // 속이다 둘은 낭비
      const back = idx.filter(i => i !== a && i !== b);
      return {lead: [a, b], back, score, why};
    }).sort((x, y) => y.score - x.score).slice(0, 3);
  }

  // 고른 4마리로 유리하게 상대할 수 없는 상대
  function threats(X, opp, idx) {
    return opp.map((o, j) => ({j, best: Math.max(...idx.map(i => X[i][j].v))}))
      .filter(t => t.best < 0).sort((a, b) => a.best - b.best);
  }

  // 상대마다 누가 어떤 기술로 받는지
  function answers(top, opp) {
    return opp.map((o, j) => {
      const order = top.idx.map(i => ({i, c: top.rows[i][j]})).sort((a, b) => b.c.v - a.c.v);
      const b = order[0];
      return {j, i: b.i, move: b.c.off.move, off: b.c.off.pct, def: b.c.def.pct, defMove: b.c.def.move, v: b.c.v,
              faster: top.useTR ? b.c.trFaster : b.c.faster, second: order[1] && order[1].c.v > 0.15 ? order[1].i : null};
    });
  }

  // 내 선출 중 2마리 이상을 한 방에 쓰러뜨릴 수 있는 상대
  function dangers(top, opp, mineSets) {
    const out = [];
    opp.forEach((o, j) => {
      const hit = top.idx.map(i => ({i, r: top.rows[i][j].def})).filter(x => x.r.row && x.r.row.maxPct >= 100);
      if (hit.length >= 2) {
        out.push({j, list: hit.map(x => ({i: x.i, move: x.r.move, sure: x.r.row.minPct >= 100}))});
      }
    });
    return out;
  }

  // 한 줄씩 읽는 게임 플랜
  function gamePlan(L, top, mineSets, opp, w, plan) {
    const ko = i => byId[mineSets[i].id].ko;
    const lines = [];
    const likely = opp.map((o, j) => j).sort((a, b) => w[b] - w[a]);  // 사용률 높은 순 = 나올 가능성 높은 순
    const act = i => {
      const s = mineSets[i], r = T.rolesOf(s.baseId || s.id, s);
      if (plan.trIdx.includes(i) && top.useTR) return '트릭룸';
      if (r.includes('fakeout')) return '속이다로 견제';
      if (s.moves.includes('Tailwind')) return '순풍';
      if (r.includes('redirect')) return '유인(날 따르라 등)';
      // 가장 유리한 상대에게 가장 센 기술
      const j = likely.slice(0, 4).sort((a, b) => top.noTR[i][b].off.pct - top.noTR[i][a].off.pct)[0];
      const c = top.noTR[i][j];
      return c.off.move ? `${M.moveKo(c.off.move)} → ${byId[opp[j].id].ko} (${c.off.pct >= 100 ? '한 방' : c.off.pct.toFixed(0) + '%'})` : '공격';
    };
    lines.push(`1턴: ${L.lead.map(i => `${ko(i)} ${act(i)}`).join(' / ')}`);
    const backNote = L.back.map(i => {
      const good = top.rows[i].map((c, j) => ({j, v: c.v})).filter(x => x.v > 0.3).sort((a, b) => b.v - a.v).slice(0, 2);
      return `${ko(i)}${good.length ? `(${good.map(x => byId[opp[x.j].id].ko).join('·')} 상대)` : ''}`;
    });
    const trBack = L.back.find(i => plan.trIdx.includes(i));
    const trNote = !top.useTR ? '' : trBack != null ? ` — ${ko(trBack)} 등장 후 트릭룸, 그다음부터 느린 멤버가 먼저 움직임` : ' — 트릭룸 아래에서 느린 멤버가 먼저 움직임';
    lines.push(`후발: ${backNote.join(', ')}${trNote}`);
    if (top.megaI != null) lines.push(`메가진화: ${ko(top.megaI)}`);
    return lines;
  }

  const WEATHER_KO = {Rain: '비', Sun: '쾌청', Sand: '모래바람', Snow: '설경'};
  const TERRAIN_KO = {Grassy: '그래스필드', Psychic: '사이코필드', Electric: '일렉트릭필드', Misty: '미스트필드'};

  return {recommend, matrix, oppSet, cellValue, condOf, teamPlan};
}
