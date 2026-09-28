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

  function best(att, def, attIsLeft) {
    const rows = M.damageTable(att, def, FIELD, attIsLeft).filter(r => r.maxPct != null);
    if (!rows.length) return {pct: 0, move: null, row: null};
    const top = rows.reduce((a, b) => (avg(b) > avg(a) ? b : a));
    return {pct: avg(top), move: top.name, row: top};
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

  function matrix(mine, opp) {
    return mine.map(a => opp.map(b => {
      const off = best(a, b, true), def = best(b, a, false);
      const sa = M.speed(a, FIELD, true), sb = M.speed(b, FIELD, false);
      return {off, def, sa, sb, faster: sa > sb, v: cellValue(off.pct, def.pct, sa > sb)};
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

  function recommend(mineSets, oppIds) {
    const opp = oppIds.map(oppSet);
    const X = matrix(mineSets, opp);
    // 메가 세트는 메가진화 안 한 모습의 상성도 따로 계산 (메가가 2마리 이상 뽑히면 1마리만 진화)
    const XB = mineSets.map((s, i) => (isMega(s) ? matrix([unMega(s)], opp)[0] : X[i]));
    const w = oppWeights(oppIds);
    const W = w.reduce((a, b) => a + b, 0);

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
      let bestScore = -Infinity, megaI = megas[0] ?? null, rows = X;
      for (const m of (megas.length > 1 ? megas : [megas[0] ?? null])) {
        const r = mineSets.map((_, i) => (megas.includes(i) && i !== m ? XB[i] : X[i]));
        const sc = evalWith(idx, r);
        if (sc > bestScore) { bestScore = sc; megaI = m; rows = r; }
      }
      let score = bestScore;
      const roles = roleSet(idx, mineSets);
      if (roles.has('fakeout')) score += 0.06;
      if (roles.has('speed')) score += 0.06;
      if (roles.has('intimidate')) score += 0.05;
      return {idx, score, roles, megaI, rows, megaCount: megas.length};
    }).sort((a, b) => b.score - a.score);

    const top = picks[0];
    return {opp, X, weights: w, picks: picks.slice(0, 3), leads: top ? leads(top.idx, mineSets, top.rows, w) : [],
            threats: threats(top ? top.rows : X, opp, top ? top.idx : [])};
  }

  // 선봉 2마리: 상대 전체에 대한 압박 + 속이다/스피드 조절/전체기 조합 + 파트너 궁합
  function leads(idx, mineSets, X, w) {
    const W = w.reduce((a, b) => a + b, 0);
    return combos(idx.length, 2).map(([p, q]) => {
      const a = idx[p], b = idx[q];
      let score = 0;
      X[0].forEach((_, j) => { score += w[j] * Math.max(X[a][j].v, X[b][j].v); });
      score /= W;
      const ra = T.rolesOf(mineSets[a].baseId || mineSets[a].id, mineSets[a]);
      const rb = T.rolesOf(mineSets[b].baseId || mineSets[b].id, mineSets[b]);
      const has = r => ra.includes(r) || rb.includes(r);
      const why = [];
      if (has('fakeout') && has('speed')) { score += 0.15; why.push('속이다 + 스피드 조절'); }
      else if (has('fakeout')) { score += 0.08; why.push('속이다로 첫 턴 견제'); }
      else if (has('speed')) { score += 0.08; why.push('첫 턴 스피드 조절'); }
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

  return {recommend, matrix, oppSet, cellValue};
}
