// 선출 추천 (DOM 없음). 더블배틀: 6마리 보여주고 4마리 선출, 그중 2마리 선봉 / 싱글: 3마리 선출, 1마리 선봉
// 1) 내 6 × 상대 6 상성표: 서로 가장 센 기술의 평균 데미지%, 스피드
// 2) 4마리 조합 15개를 "상대 각 포켓몬에 대한 최선의 대답" 합으로 평가 (+역할·메가 보정)
// 3) 고른 4마리 안에서 선봉 2마리 6조합을 평가
const avg = r => (r.minPct + r.maxPct) / 2;
// 여러 번 때리는 기술 (기합의띠·옹골참을 뚫음)
const MULTI = new Set(['Scale Shot', 'Bullet Seed', 'Icicle Spear', 'Rock Blast', 'Pin Missile', 'Tail Slap', 'Triple Axel', 'Surging Strikes',
  'Population Bomb', 'Double Hit', 'Dual Wingbeat', 'Bone Rush', 'Water Shuriken', 'Arm Thrust', 'Double Kick', 'Dragon Darts', 'Triple Kick']);

export function createPickAdvisor(M, T) {
  const {byId} = M;
  const FIELD = {doubles: M.doubles, weather: '', terrain: '', crit: false, L: {}, R: {}};
  const PICK = M.doubles ? 4 : 3, LEAD = M.doubles ? 2 : 1;

  // 상대 세트: 사용률 1순위 (메가스톤 40%+ 이면 메가 형태)
  const oppSet = id => T.teamSets([T.baseOf(id)])[0];

  // 명중률: 빗나갈 수 있는 기술은 기댓값으로 (용성군 90%, 하이드로펌프 80% …)
  const accOf = (set, name, field) => {
    const m = M.D.moves[M.moveByEn[name]];
    if (set.ability === 'No Guard') return 1;
    if ((name === 'Thunder' || name === 'Hurricane') && field.weather === 'Rain') return 1;
    if (name === 'Blizzard' && field.weather === 'Snow') return 1;
    return Math.min(1, (m && +m.acc ? +m.acc / 100 : 1) * (set.ability === 'Compound Eyes' ? 1.3 : 1));
  };
  function best(att, def, attIsLeft, field = FIELD) {
    const rows = M.damageTable(att, def, field, attIsLeft, {fast: true}).filter(r => r.maxPct != null);
    if (!rows.length) return {pct: 0, eff: 0, move: null, row: null};
    const top = rows.reduce((a, b) => (avg(b) * accOf(att, b.name, field) > avg(a) * accOf(att, a.name, field) ? b : a));
    return {pct: avg(top), eff: avg(top) * accOf(att, top.name, field), move: top.name, row: top};
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
        // 기합의띠·옹골참: HP가 가득이면 한 방은 버팀 (연속기는 제외) → 대면 값은 99%로
        const sash = s => s.item === 'Focus Sash' || s.ability === 'Sturdy';
        const multi = r => r && r.row && MULTI.has(r.move);
        const offV = sash(b) && !multi(off) ? Math.min(off.eff, 99) : off.eff, defV = sash(a) && !multi(def) ? Math.min(def.eff, 99) : def.eff;
        return {off, def, sa, sb, faster, field: f, v: cellValue(offV, defV, faster)};
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
  //   싱글은 선출률(파티에 있을 때 실제로 데려오는 비율) 데이터가 있어서 그걸 씀
  function oppWeights(oppIds) {
    return oppIds.map(id => {
      const u = M.usageOf(byId[id]);
      if (!M.doubles && u && u.pick != null) return 0.35 + u.pick / 100;
      return 1 + (u ? Math.min(u.pct, 30) / 30 : 0) * 0.5;
    });
  }
  // 싱글: 상대가 선봉으로 낼 가능성 (선출률 × 선봉률), 합 1로
  function oppLeadOdds(oppIds) {
    const raw = oppIds.map(id => { const u = M.usageOf(byId[id]); return u && u.pick != null ? (u.pick / 100) * ((u.lead || 33) / 100) : 1 / 6; });
    const t = raw.reduce((a, b) => a + b, 0) || 1;
    return raw.map(x => x / t);
  }

  const isMega = s => s.baseId && s.id !== s.baseId;
  // 메가 세트의 "메가진화 안 한" 모습 (메가스톤 대신 다음 순위 도구)
  const unMega = s => ({...M.defaultSet(s.baseId), baseId: s.baseId});
  // 상대마다 메가진화할 확률 (메가 세트로 가정한 상대만, 아니면 null)
  const STONE_RE = /ite( [XYZ])?$/;
  const stoneRate = id => { const u = M.usageOf(byId[id]); return u ? Math.min(1, u.it.filter(([n]) => STONE_RE.test(n) && n !== 'Eviolite').reduce((a, [, p]) => a + p, 0) / 100) : 0; };
  function oppMegaOdds(oppIds, opp) {
    const st = oppIds.map(stoneRate), tot = st.reduce((a, b) => a + b, 0);
    return opp.map((s, j) => (isMega(s) ? Math.min(1, st[j] / Math.max(1, 1 + (tot - st[j]) * PICK / 6)) : null));
  }
  const TR_WEIGHT = 0.6;  // 트릭룸 담당을 데려가면 게임의 60% 정도를 트릭룸 아래에서 싸운다고 봄
  const PROTECT_TR = ['fakeout', 'redirect'];

  // 트릭룸 아래 칸: 데미지는 같고 행동 순서만 뒤집힘
  function trCell(c) {
    const f = x => { const faster = x.sa < x.sb; return {faster, v: cellValue(x.off.eff ?? x.off.pct, x.def.eff ?? x.def.pct, faster)}; };
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
    const arch = M.doubles ? archetypeD(oppIds) : archetype(oppIds);
    const plan = teamPlan(mineSets);
    // 상황별 상성표: 날씨·필드 담당을 데려갔을 때(W) / 안 데려갔을 때(0), 메가 세트는 메가 안 한 모습(B)도
    // 상대 메가진화: 팀 미리보기에서는 누가 메가진화할지 모름 → 메가 확률로 메가 모습·원래 모습 칸 값을 섞음
    //   확률 = 메가스톤 채용률 ÷ (1 + 다른 메가 후보들의 채용률 × 선출될 비율)  (한 배틀에 한 마리만 메가)
    const oppMega = oppMegaOdds(oppIds, opp);
    const megaCols = opp.map((s, j) => j).filter(j => oppMega[j] != null);
    const blend = (list, ctx) => {
      const full = matrix(list, opp, ctx);
      if (!megaCols.length) return full;
      const bm = matrix(list, megaCols.map(j => unMega(opp[j])), ctx);
      return full.map((row, i) => row.map((c, j) => {
        const n = megaCols.indexOf(j);
        if (n < 0) return c;
        const b = bm[i][n], p = oppMega[j];
        return {...c, v: p * c.v + (1 - p) * b.v, pMega: p, base: b};
      }));
    };
    const build = ctx => {
      const X = blend(mineSets, ctx);
      const XB = mineSets.map((s, i) => (isMega(s) ? blend([unMega(s)], ctx)[0] : X[i]));
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

    const picks = combos(mineSets.length, Math.min(PICK, mineSets.length)).map(idx => {
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
      if (M.doubles) {
        // 상대 파티 성향에 맞춰 역할 가산 (트릭룸 상대 → 속이다, 순풍 상대 → 스피드 조절, 유인 상대 → 전체 공격)
        const A = arch, lv = k => (A.main.includes(k) ? 1 : A.second.includes(k) ? 0.5 : 0);
        if (roles.has('fakeout')) score += 0.06 + 0.05 * lv('trickroom');
        if (roles.has('speed')) score += 0.06 + 0.04 * lv('tailwind');
        if (roles.has('intimidate')) score += 0.05;
        if (roles.has('spread')) score += 0.04 * lv('redirect');
        if (roles.has('setter')) score += 0.04 * lv('weather') + 0.04 * lv('terrain');
      } else {
        // 싱글: 상대 파티 성향에 맞는 역할 (랭크업 상대 → 선공기·상태이상, 사이클 상대 → 랭크업·설치기, 대면 상대 → 선공기·스카프)
        const A = arch;
        if (roles.has('priority')) score += 0.03 + 0.05 * (A.setup + A.face);
        if (roles.has('status')) score += 0.02 + 0.05 * A.setup;
        if (roles.has('setup')) score += 0.03 + 0.05 * A.cycle;
        if (roles.has('hazard')) score += 0.02 + 0.04 * A.cycle;
        if (roles.has('scarf')) score += 0.02 + 0.03 * A.face;
      }
      return {idx, score, roles, megaI: best.megaI, rows: best.rows, noTR: best.noTR, useW: best.useW, useTR: best.useTR, megaCount: megas.length};
    }).sort((a, b) => b.score - a.score);

    const top = picks[0];
    if (!top) return {opp, X: C0.X, weights: w, picks: [], leads: [], threats: [], plan, arch};
    const L = M.doubles ? leads(top, mineSets, w, plan) : leadsS(top, mineSets, oppIds);
    return {
      opp, X: C0.X, weights: w, plan, arch, oppMega, picks: picks.slice(0, 3), leads: L, oppLeads: M.doubles ? null : oppLeadOdds(oppIds),
      threats: threats(top.rows, opp, top.idx),
      answers: answers(top, opp),
      dangers: dangers(top, opp, mineSets),
      gamePlan: L[0] ? (M.doubles ? gamePlan(L[0], top, mineSets, opp, w, plan) : gamePlanS(L[0], top, mineSets, opp, oppIds, arch)) : [],
    };
  }

  // ---------------- 싱글 ----------------
  // 상대 파티 성향: 대면(기합의띠·스카프·고화력) / 사이클(교체기·회복·재생력·위협·단단한 포켓몬) / 랭크업(칼춤·용춤 등)
  //   사용률 데이터에서 각 포켓몬이 그 기술·도구·특성을 쓰는 비율로 점수를 매김 (0~1)
  const SETUP = ['Swords Dance', 'Dragon Dance', 'Nasty Plot', 'Calm Mind', 'Bulk Up', 'Quiver Dance', 'Shell Smash', 'Belly Drum', 'Agility',
                 'Coil', 'Iron Defense', 'Curse', 'Tidy Up', 'Victory Dance', 'Shift Gear', 'Growth', 'Tail Glow', 'Cosmic Power', 'Clangorous Soul'];
  const PIVOT = ['U-turn', 'Volt Switch', 'Flip Turn', 'Parting Shot', 'Teleport', 'Chilly Reception', 'Shed Tail'];
  const RECOVER = ['Recover', 'Roost', 'Slack Off', 'Soft-Boiled', 'Moonlight', 'Morning Sun', 'Synthesis', 'Shore Up', 'Milk Drink',
                   'Strength Sap', 'Wish', 'Rest', 'Pain Split', 'Leech Seed'];
  const moveRate = (u, list) => (u ? u.mv.reduce((a, [i, p]) => a + (list.includes(typeof i === 'number' ? M.D.moves[i].en : i) ? p : 0), 0) : 0);
  const itemRate = (u, list) => (u ? u.it.reduce((a, [n, p]) => a + (list.includes(n) ? p : 0), 0) : 0);
  const abRate = (u, list) => (u ? u.ab.reduce((a, [n, p]) => a + (list.includes(n) ? p : 0), 0) : 0);
  // 싱글 성향 점수: 신호마다 가중치 × 그 포켓몬이 그걸 쓸 확률(사용률 데이터), 6마리 합
  //   (일본·한국 BSS 커뮤니티 분류 + 쇼다운 M-C 싱글 기록 분석을 바탕으로 정한 가중치)
  const PRIO = ['Sucker Punch', 'Aqua Jet', 'Bullet Punch', 'Shadow Sneak', 'Ice Shard', 'Extreme Speed', 'Mach Punch', 'Jet Punch', 'Accelerock',
                'Vacuum Wave', 'Quick Attack', 'Grassy Glide', 'First Impression', 'Thunderclap'];
  const SPEED_SETUP = ['Dragon Dance', 'Shell Smash', 'Quiver Dance', 'Shift Gear', 'Victory Dance', 'Tidy Up', 'Agility'];
  const STATUSER = ['Will-O-Wisp', 'Toxic', 'Yawn', 'Thunder Wave', 'Salt Cure', 'Spore', 'Glare'];
  const PHAZE = ['Haze', 'Roar', 'Whirlwind', 'Dragon Tail', 'Circle Throw', 'Clear Smog'];
  const SCREENS = ['Reflect', 'Light Screen', 'Aurora Veil'];
  const ENABLE = ['Sticky Web', 'Memento', 'Healing Wish', 'Shed Tail', 'Baton Pass'];
  function archetype(oppIds) {
    const per = oppIds.map(id => {
      const e = byId[id], u = M.usageOf(e);
      const mv = l => Math.min(1, moveRate(u, l) / 100), it = l => Math.min(1, itemRate(u, l) / 100), ab = l => Math.min(1, abRate(u, l) / 100);
      const bulky = (e.st[0] * Math.max(e.st[2], e.st[4])) >= 95 * 100;
      const off = Math.max(e.st[1], e.st[3]);
      const sash = it(['Focus Sash']), scarf = it(['Choice Scarf']), sturdy = ab(['Sturdy', 'Disguise', 'Multiscale']);
      const setup = Math.min(1, moveRate(u, SETUP.filter(m => !SPEED_SETUP.includes(m))) / 30), spSetup = Math.min(1, moveRate(u, SPEED_SETUP) / 30);
      const pivot = Math.min(1, moveRate(u, PIVOT) / 30), recov = Math.min(1, moveRate(u, RECOVER) / 50);
      const sr = mv(['Stealth Rock', 'Spikes']), inti = ab(['Intimidate']), taunt = mv(['Taunt', 'Encore']);
      const face = 2 * sash + 1.5 * scarf + 1.5 * sturdy + 1 * mv(PRIO) + 1 * mv(['Destiny Bond', 'Endeavor', 'Counter', 'Mirror Coat'])
        + 0.5 * it(['Life Orb', 'Black Glasses', 'Charcoal', 'Mystic Water', 'Miracle Seed', 'Magnet', 'Never-Melt Ice', 'Black Belt', 'Poison Barb', 'Soft Sand',
                    'Sharp Beak', 'Twisted Spoon', 'Silver Powder', 'Hard Stone', 'Spell Tag', 'Dragon Fang', 'Metal Coat', 'Fairy Feather', 'Silk Scarf'])
        + (off >= 120 && e.st[5] >= 100 ? 0.5 : 0) + 0.5 * inti + 0.5 * sr + 0.5 * taunt;
      const cycle = 1.5 * pivot + 2 * ab(['Regenerator']) + 1.5 * recov + 1 * it(['Leftovers', 'Rocky Helmet', 'Black Sludge']) + 1 * inti + (bulky ? 1 : 0)
        + 1 * mv(STATUSER) + 1 * sr + 1 * Math.max(mv(PHAZE), ab(['Unaware'])) + (bulky ? 0.5 * setup : 0) + 0.5 * taunt + 0.5 * scarf * mv(['Trick']);
      const setupS = 2 * setup + 2.5 * spSetup + 1.5 * Math.max(mv(SCREENS), it(['Light Clay'])) + 1.5 * mv(ENABLE)
        + 0.5 * Math.max(setup, spSetup) * (sash + it(['White Herb', 'Weakness Policy', 'Lum Berry'])) + 0.5 * sturdy + 0.5 * mv(PRIO) * Math.max(setup, spSetup)
        + 0.5 * recov * Math.max(setup, spSetup) + 0.5 * mv(['Yawn']) + 0.5 * sr;
      const tags = [];
      if (face >= 2.5) tags.push('face');
      if (cycle >= 2.5) tags.push('cycle');
      if (setupS >= 2) tags.push('setup');
      return {id, face, cycle, setup: setupS, tags, ace: Math.max(setup, spSetup) * ((u && u.pick) || 30)};
    });
    const sum = k => per.reduce((a, x) => a + x[k], 0);
    const raw = {face: sum('face'), cycle: sum('cycle'), setup: sum('setup')};
    // 강제 판정: 대면(기합의띠·스카프·옹골참류 3마리 이상 + 교체기 1마리 이하) / 사이클(재생력·교체기·회복 3마리 이상) / 랭크업(랭크업 2마리 이상)
    const n = f => per.filter(f).length;
    const tot = raw.face + raw.cycle + raw.setup || 1;
    const S = {face: raw.face / tot, cycle: raw.cycle / tot, setup: raw.setup / tot};
    const order = Object.entries(raw).sort((a, b) => b[1] - a[1]);
    let main = order[0][1] >= 1.3 * order[1][1] ? [order[0][0]] : [order[0][0], order[1][0]];
    const uOf = id => M.usageOf(byId[id]);
    const force = [];
    if (n(x => { const u = uOf(x.id); return itemRate(u, ['Focus Sash', 'Choice Scarf']) + abRate(u, ['Sturdy', 'Disguise', 'Multiscale']) >= 50; }) >= 3
        && n(x => moveRate(uOf(x.id), PIVOT) >= 30) <= 1) force.push('face');
    if (n(x => { const u = uOf(x.id); return abRate(u, ['Regenerator']) >= 50 || moveRate(u, PIVOT) >= 30 || moveRate(u, RECOVER) >= 50; }) >= 3) force.push('cycle');
    if (n(x => moveRate(uOf(x.id), SETUP) >= 30) >= 2) force.push('setup');
    for (const k of force) if (!main.includes(k)) main.push(k);
    main = main.slice(0, 2);
    const aceX = per.filter(x => x.ace > 5).sort((a, b) => b.ace - a.ace)[0];
    return {...S, raw, main, per, keys: ['face', 'cycle', 'setup'], ace: aceX ? aceX.id : null};
  }
  // 더블: 설치 담당(세터) × 1.0 + 수혜자 × 0.5 (최대 1.5) + 짝 보너스 0.5 → "실제로 굴러갈 부품 수"
  //   주 성향 = 점수 1.5 이상 + 세터 채용 확률 0.5 이상, 보조 성향 = 0.75 이상 (여럿 가능)
  const WEATHER_AB = {Drizzle: 'Rain', Drought: 'Sun', 'Sand Stream': 'Sand', 'Snow Warning': 'Snow'};
  const WEATHER_STONE = {'Charizardite Y': 'Sun', Abomasite: 'Snow', Tyranitarite: 'Sand'};
  const WEATHER_USER = {Rain: {ab: ['Swift Swim', 'Rain Dish', 'Dry Skin'], mv: ['Electro Shot', 'Thunder', 'Hurricane', 'Weather Ball']},
                        Sun: {ab: ['Chlorophyll', 'Solar Power', 'Protosynthesis'], mv: ['Solar Beam', 'Eruption', 'Heat Wave', 'Weather Ball']},
                        Sand: {ab: ['Sand Rush', 'Sand Force'], mv: []}, Snow: {ab: ['Slush Rush'], mv: ['Blizzard', 'Aurora Veil']}};
  const TERRAIN_AB = {'Psychic Surge': 'Psychic', 'Grassy Surge': 'Grassy', 'Electric Surge': 'Electric', 'Misty Surge': 'Misty'};
  const TERRAIN_USER = {Psychic: {it: ['Psychic Seed'], mv: ['Expanding Force']}, Grassy: {it: ['Grassy Seed'], mv: ['Grassy Glide']},
                        Electric: {it: ['Electric Seed'], mv: ['Rising Voltage']}, Misty: {it: ['Misty Seed'], mv: ['Misty Explosion']}};
  function archetypeD(oppIds) {
    const U = oppIds.map(id => ({id, e: byId[id], u: M.usageOf(byId[id])}));
    const r = (x, list) => moveRate(x.u, list) / 100, ia = (x, list) => itemRate(x.u, list) / 100, aa = (x, list) => abRate(x.u, list) / 100;
    const score = {}, detail = {}, per = U.map(x => ({id: x.id, tags: []}));
    const tag = (i, k) => { if (!per[i].tags.includes(k)) per[i].tags.push(k); };
    const part = (setters, users, pair = 0.5) => {
      const s = setters.reduce((a, v) => a + v, 0), u = Math.min(1.5, users.reduce((a, v) => a + 0.5 * v, 0));
      return {s, v: s + u + (Math.max(0, ...setters) >= 0.5 && users.filter(v => v >= 0.5).length >= 1 ? pair : 0), top: Math.max(0, ...setters)};
    };
    // 트릭룸: 트릭룸 기술 / 느리고(스피드 55 이하) 센 포켓몬
    {
      const set = U.map(x => r(x, ['Trick Room'])), use = U.map(x => (x.e.st[5] <= 55 && Math.max(x.e.st[1], x.e.st[3]) >= 100 ? 1 : 0));
      const p = part(set, use.filter(v => v).length >= 2 ? use : use.map(() => 0));
      score.trickroom = p; U.forEach((x, i) => { if (set[i] >= 0.3 || (use[i] && p.top >= 0.5)) tag(i, 'trickroom'); });
    }
    // 순풍
    {
      const set = U.map(x => r(x, ['Tailwind'])), use = U.map(x => (x.e.st[5] >= 70 && x.e.st[5] <= 110 && Math.max(x.e.st[1], x.e.st[3]) >= 110 ? 1 : 0));
      const p = part(set, use); score.tailwind = p; U.forEach((x, i) => { if (set[i] >= 0.3) tag(i, 'tailwind'); });
    }
    // 날씨: 종류별로 계산해서 가장 높은 것
    {
      let best = null;
      for (const W of ['Rain', 'Sun', 'Sand', 'Snow']) {
        const set = U.map(x => Math.min(1, aa(x, Object.keys(WEATHER_AB).filter(a => WEATHER_AB[a] === W)) + ia(x, Object.keys(WEATHER_STONE).filter(a => WEATHER_STONE[a] === W))));
        const use = U.map(x => Math.min(1, aa(x, WEATHER_USER[W].ab) + r(x, WEATHER_USER[W].mv)));
        const p = part(set, use);
        if (!best || p.v > best.v) best = {...p, W, set};
      }
      score.weather = best; detail.weather = best.W;
      best.set.forEach((v, i) => { if (v >= 0.3) tag(i, 'weather'); });
    }
    // 필드
    {
      let best = null;
      for (const T of ['Psychic', 'Grassy', 'Electric', 'Misty']) {
        const set = U.map(x => aa(x, Object.keys(TERRAIN_AB).filter(a => TERRAIN_AB[a] === T)));
        const use = U.map(x => Math.min(1, ia(x, TERRAIN_USER[T].it) + r(x, TERRAIN_USER[T].mv)));
        const p = part(set, use);
        if (!best || p.v > best.v) best = {...p, T, set};
      }
      score.terrain = best; detail.terrain = best.T;
      best.set.forEach((v, i) => { if (v >= 0.3) tag(i, 'terrain'); });
    }
    // 유인 + 랭크업
    {
      const set = U.map(x => r(x, ['Follow Me', 'Rage Powder'])), use = U.map(x => Math.min(1, r(x, SETUP) * 1.5));
      const p = part(set, use); score.redirect = p; U.forEach((x, i) => { if (set[i] >= 0.3) tag(i, 'redirect'); });
    }
    const keys = ['trickroom', 'tailwind', 'weather', 'terrain', 'redirect'];
    const main = keys.filter(k => score[k].v >= 1.5 && score[k].top >= 0.5).sort((a, b) => score[b].v - score[a].v);
    const second = keys.filter(k => !main.includes(k) && score[k].v >= 0.75 && score[k].top >= 0.3).sort((a, b) => score[b].v - score[a].v);
    const out = {keys: [...main, ...second], main: main.length ? main : ['balance'], second, per, detail, doubles: true};
    for (const k of keys) out[k] = Math.min(1, score[k].v / 2.5);
    if (!main.length) { out.keys.unshift('balance'); out.balance = 1 - Math.max(...keys.map(k => out[k])); }
    return out;
  }
  const ARCH_KO = {face: '대면', cycle: '사이클', setup: '랭크업'};
  const ARCH_TIP = {
    face: '서로 한 마리씩 맞붙어 잡고 잡히는 파티 — 스피드·선공기·기합의띠가 중요. 먼저 때려서 잡을 수 있는 대면을 만들고, 불리하면 버리고 다음으로.',
    cycle: '교체를 자주 하며 버티는 파티 — 교체로 받는 포켓몬까지 크게 때리는 기술(약점 범위)·랭크업·도발이 좋음. 한 대면에 오래 머물지 말고 뒤를 보고 때리기.',
    setup: '랭크업 한 번 성공하면 끝나는 파티 — 선공기·상태이상(도깨비불·전기자석파)·앵콜·도발로 쌓기 전에 끊기. 랭크업할 틈(느린 교체·약한 공격)을 주지 않기.',
  };

  // 선봉 1마리: 상대가 선봉으로 낼 가능성 × 그 상대와의 대면 + 역할
  function leadsS(top, mineSets, oppIds) {
    const {idx, noTR} = top;
    const odds = oppLeadOdds(oppIds);
    return idx.map(a => {
      let score = 0;
      odds.forEach((p, j) => { score += p * noTR[a][j].v; });
      const r = T.rolesOf(mineSets[a].baseId || mineSets[a].id, mineSets[a]);
      const why = [];
      if (r.includes('hazard') && r.includes('scarf')) { score += 0.1; why.push('기합의띠로 버티며 스텔스록'); }
      else if (r.includes('hazard')) { score += 0.05; why.push('선봉 스텔스록'); }
      if (r.includes('pivot')) { score += 0.05; why.push('유턴으로 상대 보고 교체'); }
      if (r.includes('scarf') && !r.includes('hazard')) { score += 0.03; why.push('기합의띠·스카프로 대면 싸움'); }
      if (r.includes('intimidate')) { score += 0.03; why.push('위협'); }
      if (r.includes('setup')) score -= 0.04;  // 랭크업 에이스는 뒤에서 (상대가 줄어든 뒤)
      // 첫 KO를 내준 쪽은 31.6%만 이김 → 선봉 확률 20% 이상인 상대에게 먼저 맞고 한 방이면 감점 (기합의띠·옹골참·탈 제외)
      const safe = ['Focus Sash'].includes(mineSets[a].item) || ['Sturdy', 'Disguise', 'Multiscale'].includes(mineSets[a].ability);
      const risky = odds.map((p, j) => ({p, j, c: noTR[a][j]})).filter(x => x.p >= 0.2 && !x.c.faster && x.c.def.pct >= 100);
      if (risky.length && !safe) { score -= 0.15; why.push(`주의: ${risky.map(x => byId[oppIds[x.j]].ko).join('·')}에게 먼저 맞고 쓰러질 수 있음`); }
      const back = idx.filter(i => i !== a);
      return {lead: [a], back, score, why};
    }).sort((x, y) => y.score - x.score);
  }

  function gamePlanS(L, top, mineSets, opp, oppIds, arch) {
    const ko = i => byId[mineSets[i].id].ko;
    const odds = oppLeadOdds(oppIds);
    const likely = odds.map((p, j) => ({j, p})).sort((a, b) => b.p - a.p).slice(0, 2);
    const a = L.lead[0];
    const lines = [];
    lines.push(`상대 파티: ${arch.main.map(k => ARCH_KO[k]).join('·')} 성향`);
    const vsLead = likely.map(({j, p}) => {
      const c = top.noTR[a][j];
      const how = c.off.move ? `${M.moveKo(c.off.move)} ${c.off.pct >= 100 ? '한 방' : c.off.pct.toFixed(0) + '%'}` : '';
      return `${byId[opp[j].baseId || opp[j].id].ko}(${Math.round(p * 100)}%)${how ? ' → ' + how : ''}${c.v < 0 ? ' — 불리, 교체 고려' : ''}`;
    });
    lines.push(`선봉 ${ko(a)} · 예상 상대 선봉: ${vsLead.join(', ')}`);
    const backNote = L.back.map(i => {
      const good = top.rows[i].map((c, j) => ({j, v: c.v})).filter(x => x.v > 0.3).sort((x, y) => y.v - x.v).slice(0, 2);
      return `${ko(i)}${good.length ? `(${good.map(x => byId[opp[x.j].baseId || opp[x.j].id].ko).join('·')} 상대)` : ''}`;
    });
    lines.push(`뒤: ${backNote.join(', ')}`);
    if (top.megaI != null) lines.push(`메가진화: ${ko(top.megaI)}`);
    return lines;
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
      return c.off.move ? `${M.moveKo(c.off.move)} → ${byId[opp[j].baseId || opp[j].id].ko} (${c.off.pct >= 100 ? '한 방' : c.off.pct.toFixed(0) + '%'})` : '공격';
    };
    lines.push(`1턴: ${L.lead.map(i => `${ko(i)} ${act(i)}`).join(' / ')}`);
    const backNote = L.back.map(i => {
      const good = top.rows[i].map((c, j) => ({j, v: c.v})).filter(x => x.v > 0.3).sort((a, b) => b.v - a.v).slice(0, 2);
      return `${ko(i)}${good.length ? `(${good.map(x => byId[opp[x.j].baseId || opp[x.j].id].ko).join('·')} 상대)` : ''}`;
    });
    const trBack = L.back.find(i => plan.trIdx.includes(i));
    const trNote = !top.useTR ? '' : trBack != null ? ` — ${ko(trBack)} 등장 후 트릭룸, 그다음부터 느린 멤버가 먼저 움직임` : ' — 트릭룸 아래에서 느린 멤버가 먼저 움직임';
    lines.push(`후발: ${backNote.join(', ')}${trNote}`);
    if (top.megaI != null) lines.push(`메가진화: ${ko(top.megaI)}`);
    return lines;
  }

  const WEATHER_KO = {Rain: '비', Sun: '쾌청', Sand: '모래바람', Snow: '설경'};
  const TERRAIN_KO = {Grassy: '그래스필드', Psychic: '사이코필드', Electric: '일렉트릭필드', Misty: '미스트필드'};

  return {recommend, matrix, oppSet, cellValue, condOf, teamPlan, archetype, archetypeD, oppLeadOdds, ARCH_KO, ARCH_TIP, PICK, LEAD};
}
