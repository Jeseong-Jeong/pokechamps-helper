// 팀 진단 탭: 팀 점수·문제점 → 교체 추천 → (포켓몬 유지 시) 세트 다듬기
const KIND = {move: '기술', item: '도구', nature: '성격', sp: 'SP'};
const PART = {meta: '자주 만나는 상대 대응', types: '타입 약점', cover: '공격 범위', roles: '역할', syn: '파트너 궁합', mega: '메가 수', field: '상대 필드·날씨 대응'};
const WK = {Rain: '비', Sun: '쾌청', Sand: '모래바람', Snow: '설경'}, TK = {Grassy: '그래스필드', Psychic: '사이코필드', Electric: '일렉트릭필드', Misty: '미스트필드'};
const CORE = {tr: '트릭룸 핵심', weather: '날씨 핵심', terrain: '필드 핵심'};

export function initImprove({M, I, ty, esc, $, getSets, teamUI, gotoTeam}) {
  const {byId, D} = M;
  let key = null, result = null, running = false, tuneCache = [];

  const nm = s => esc(byId[s.id].ko);
  const pts = d => {  // 점수 변화 표시 (+3점 / −2점 / ±0점)
    const n = Math.round(d * 60);
    return n > 0 ? `<span class="num good">+${n}점</span>` : n < 0 ? `<span class="num bad">−${-n}점</span>` : '<span class="num">±0점</span>';
  };
  // 점수 변화 표시. 방어·열매처럼 데미지 계산에 안 잡히는 장점은 따로 표시
  const deltaTag = x => {
    const d = Math.round(x.delta * 60);
    if (d > 0) return `<span class="num good">+${d}점</span>`;
    if (x.offScore) return `<span class="mini" title="팀 점수는 데미지를 주고받는 것만 재기 때문에 방어·회복 같은 효과는 반영되지 않습니다">점수 밖 장점${d < 0 ? ` (${d}점)` : ''}</span>`;
    return d < 0 ? `<span class="num bad">${d}점</span>` : '';
  };
  const teamKey = sets => JSON.stringify([I.getOverride(), sets.map(s => [s.id, s.item, s.ability, s.nature, s.sp, s.moves])]);

  async function run() {
    const sets = getSets();
    if (sets.length < 6) {
      $('imp2-body').innerHTML = `<div class="card todo"><b>팀이 ${sets.length}마리입니다</b>6마리를 채우면 진단합니다. <button class="link" data-k="goto-team">팀 추천 탭으로 →</button></div>`;
      return;
    }
    const k = teamKey(sets);
    if (k === key && result) { draw(sets); return; }
    if (running) return;
    running = true;
    $('imp2-body').innerHTML = `<div class="card"><p>팀을 진단하는 중… <span class="num" id="imp2-prog">0%</span></p><div class="scorebar"><i id="imp2-bar" style="width:0%"></i></div>
      <p class="mini">자주 만나는 상대 ${I.threats.length}마리와의 데미지를 운영 방식(트릭룸·날씨·필드)별로 계산하고, 교체 후보를 하나씩 넣어 봅니다. 10~30초 걸릴 수 있습니다.</p></div>`;
    await new Promise(r => setTimeout(r, 30));
    try {
      const t0 = performance.now();
      result = await I.swaps(sets, {
        onProgress: (d, t) => {
          const p = Math.round(d / t * 100);
          const a = $('imp2-prog'), b = $('imp2-bar');
          if (a) a.textContent = p + '%';
          if (b) b.style.width = p + '%';
        },
      });
      tuneCache = sets.map((_, i) => I.tune(sets, i));
      result.ms = performance.now() - t0;
      window.__pcImproveMs = result.ms;
      key = k;
      draw(sets);
    } catch (e) {
      $('imp2-body').innerHTML = `<div class="card"><p class="bad">진단 중 오류: ${esc(e.message || e)}</p></div>`;
    } finally {
      running = false;
    }
  }

  function draw(sets) {
    const {base, results, pair, core} = result;
    const plan = base.plan, ov = I.getOverride();
    const sc = I.pretty(base.total);
    const problems = [];
    if (base.danger.length) problems.push(`<b>${base.danger.map(t => D.typeko[t]).join('·')}</b> 공격에 약한 멤버가 많음`);
    if (base.noHit.length) problems.push(`<b>${base.noHit.map(j => esc(byId[I.threats[j].id].ko)).join('·')}</b>를 약점으로 칠 기술이 없음`);
    const RK = {fakeout: '속이다', speed: '스피드 조절', intimidate: '위협'};
    if (base.missing.length) problems.push(`<b>${base.missing.map(r => RK[r]).join('·')}</b> 담당이 없음`);
    const hard = I.threats.map((t, j) => ({j, v: base.per[j]})).filter(x => x.v < 0.2).sort((a, b) => a.v - b.v).slice(0, 4);
    if (hard.length) problems.push(`<b>${hard.map(x => esc(byId[I.threats[x.j].id].ko)).join('·')}</b> 상대로 확실한 대답이 없음`);
    const partRows = Object.entries(base.parts).filter(([k]) => k !== 'mega' || base.parts.mega)
      .map(([k, v]) => `<div class="part"><span>${PART[k]}</span><span class="num ${v < 0 ? 'bad' : ''}">${v >= 0 ? '+' : ''}${(v * 60).toFixed(0)}</span></div>`).join('');

    const swapCards = results.map(r => {
      const s = sets[r.slot];
      const worth = r.options[0] && Math.round(r.options[0].delta * 60) > 0;
      return `<div class="swap">
        <div class="swap-h"><span class="mini">빼 볼 멤버</span><b>${nm(s)}</b><span class="mini">빼도 점수가 ${Math.max(0, Math.round(r.contrib * 60))}점만 떨어짐</span></div>
        ${worth ? '' : '<p class="mini">이 자리는 바꿔도 크게 나아지지 않습니다. 지금 멤버를 유지하는 것을 추천합니다.</p>'}
        <ol class="cands">${r.options.map((o, k) => `<li>
          <div class="cand-h"><b>${nm(o.set)}</b><span class="types">${byId[o.set.id].ty.map(ty).join('')}</span>
            ${pts(o.delta)}
            <button class="btn sm" data-k="swap" data-slot="${r.slot}" data-o="${k}">이걸로 교체</button></div>
          <div class="chips">${o.why.map(w => `<span class="chip${w.good ? '' : ' bad'}">${esc(w.text)}</span>`).join('') || '<span class="mini">전체적으로 조금씩 나아짐</span>'}</div>
          <p class="mini setline">${esc(M.itemKo(o.set.item) || '도구 없음')} · ${o.set.moves.map(m => esc(M.moveKo(m))).join(', ')}</p>
        </li>`).join('')}</ol>
      </div>`;
    }).join('');
    // 빼는 걸 추천하는 멤버 (핵심 제외, 기여도 낮은 순) + 멤버별 기여도
    const ms = result.members.slice().sort((a, b) => (a.core - b.core) || a.contrib - b.contrib);
    const dropCard = (m, rank) => {
      const s = sets[m.i];
      const r = results.find(x => x.slot === m.i);
      const top = r && r.options[0];
      const c = Math.round(m.contrib * 60);
      return `<div class="drop${rank === 1 && anyGain ? ' first' : ''}">
        <div class="drop-h"><span class="tag">${rank}순위</span><b>${nm(s)}</b><span class="types">${byId[s.id].ty.map(ty).join('')}</span>
          <span class="mini">${c <= 0 ? `빼도 점수가 안 떨어짐${c < 0 ? ` (오히려 +${-c}점)` : ''}` : `빼면 ${c}점 떨어짐`}</span></div>
        ${m.drop.length ? `<ul class="why-list">${m.drop.map(t => `<li class="minus">${esc(t)}</li>`).join('')}</ul>` : ''}
        ${m.keep.length ? `<p class="mini">그래도 남길 이유: ${m.keep.map(esc).join(' · ')}</p>` : ''}
        ${top && Math.round(top.delta * 60) > 0 ? `<p class="instead">대신 <b>${nm(top.set)}</b> ${pts(top.delta)} <button class="btn sm" data-k="swap" data-slot="${m.i}" data-o="0">교체</button></p>` : ''}
      </div>`;
    };
    const cands = ms.filter(m => !m.core).slice(0, 2);
    // 어느 자리를 바꿔도 점수가 안 오르면: 뺄 멤버가 딱히 없다고 안내 (강조 없이)
    const anyGain = results.some(r => r.options[0] && Math.round(r.options[0].delta * 60) > 0);
    const maxC = Math.max(0.01, ...ms.map(m => m.contrib));
    const ranking = result.members.slice().sort((a, b) => b.contrib - a.contrib).map(m => {
      const c = Math.round(m.contrib * 60);
      const chips = [];
      if (m.mode && m.mode.trFirst) chips.push(`트릭룸 선공 ${m.mode.trFirst[0]}→${m.mode.trFirst[1]}`);
      if (m.mode && m.mode.condGain != null && Math.abs(m.mode.condGain) >= 0.1) chips.push(`${[WK[plan.weather], TK[plan.terrain]].filter(Boolean).join('·')} ${m.mode.condGain > 0 ? '강해짐' : '약해짐'}`);
      return `<div class="mrow"><b>${nm(sets[m.i])}</b>${m.core ? `<span class="badge b-mine">${CORE[m.core]}</span>` : ''}${chips.map(c => `<span class="badge b-form">${esc(c)}</span>`).join('')}
        <span class="mbar"><i style="width:${Math.max(2, Math.min(100, m.contrib / maxC * 100)).toFixed(0)}%"></i></span>
        <span class="num ${c <= 0 ? 'bad' : ''}">${c > 0 ? '+' : c < 0 ? '−' : '±'}${Math.abs(c)}</span>
        <span class="mini">${esc(m.keep[0] || m.drop[0] || '')}</span></div>`;
    }).join('');
    const dropHtml = `<section class="card">
        <h3>${anyGain ? '빼는 걸 추천하는 멤버' : '지금 팀에서는 뺄 멤버가 딱히 없어요'}</h3>
        <p class="mini">${anyGain ? '한 마리씩 빼 보고 팀 점수가 가장 덜 떨어지는(또는 오히려 오르는) 멤버입니다.'
          : '어느 자리를 바꿔도 팀 점수가 오르지 않습니다. 굳이 한 마리를 바꾼다면 아래 순서로 보세요.'}</p>
        <div class="drops">${cands.map((m, k) => dropCard(m, k + 1)).join('')}</div>
        <details class="mrank"><summary>멤버별 기여도 보기 (빼면 떨어지는 점수)</summary>${ranking}</details>
      </section>`;

    const bestSingle = Math.max(-1, ...results.map(r => (r.options[0] ? r.options[0].delta : -1)));
    const pairHtml = pair && pair.delta > bestSingle + 0.05 ? `<div class="notes ok"><p>두 마리를 같이 바꾼다면: <b>${pair.slots.map(i => nm(sets[i])).join(' · ')}</b> → <b>${pair.sets.map(nm).join(' · ')}</b>
      ${pts(pair.delta)} <button class="btn sm" data-k="pair">둘 다 교체</button></p>
      <p class="mini">${pair.why.map(w => esc(w.text)).join(' · ')}</p></div>` : '';

    const tuneHtml = sets.map((s, i) => {
      const list = tuneCache[i] || [];
      return `<div class="tune">
        <div class="tune-h"><b>${nm(s)}</b>${core[i] ? `<span class="badge b-mine">${CORE[core[i]]}</span>` : ''}
          <span class="mini">${esc(M.itemKo(s.item) || '도구 없음')} · ${esc(D.natureko[s.nature] || s.nature)} · SP ${['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map(k => s.sp[k] || 0).join('-')}</span></div>
        ${list.length ? `<ul>${list.map((x, k) => `<li><span class="kind">${KIND[x.kind]}</span><span class="what">${esc(x.text)} ${deltaTag(x)}</span>
          <span class="mini why">${esc(x.why)}</span><button class="btn sm" data-k="tune" data-i="${i}" data-t="${k}">적용</button></li>`).join('')}</ul>`
          : '<p class="mini">특별히 고칠 곳이 없습니다.</p>'}
      </div>`;
    }).join('');

    const opt = (k, v, t) => `<option value="${v}"${ov[k] === v ? ' selected' : ''}>${t}</option>`;
    const planBar = `<div class="card planbar">
        <b>운영 방식</b>
        <label>트릭룸<select data-plan="tr">${opt('tr', 'auto', plan.trUser ? `자동 (켜짐: ${esc(byId[plan.trUser].ko)})` : '자동 (트릭룸 없음)')}${opt('tr', 'on', '항상 고려')}${opt('tr', 'off', '무시')}</select></label>
        <label>날씨<select data-plan="weather">${opt('weather', 'auto', plan.wSetter ? `자동 (${WK[P_cond(plan.wSetter).weather]}: ${esc(byId[plan.wSetter].ko)})` : '자동 (없음)')}${opt('weather', 'off', '무시')}</select></label>
        <label>필드<select data-plan="terrain">${opt('terrain', 'auto', plan.tSetter ? `자동 (${TK[P_cond(plan.tSetter).terrain]}: ${esc(byId[plan.tSetter].ko)})` : '자동 (없음)')}${opt('terrain', 'off', '무시')}</select></label>
        <span class="mini">${plan.tr ? '트릭룸 있을 때·없을 때를 반반으로 계산합니다. ' : ''}${plan.weather || plan.terrain ? `${[WK[plan.weather], TK[plan.terrain]].filter(Boolean).join('·')} 위에서 계산합니다. ` : ''}상대가 필드·날씨를 까는 포켓몬이면 그 필드 위에서의 싸움도 함께 계산합니다.</span>
      </div>`;
    $('imp2-body').innerHTML = planBar + `
      <div class="imp2-top">
        <div class="card score-card"><span class="mini">팀 점수</span><b class="big">${sc}</b><span class="mini">/ 100 · 계산 ${(result.ms / 1000).toFixed(1)}초</span>
          <div class="parts">${partRows}</div></div>
        <div class="card"><h3>문제점</h3>${problems.length ? `<ul class="probs">${problems.map(p => `<li>${p}</li>`).join('')}</ul>` : '<p>눈에 띄는 문제가 없습니다.</p>'}
          <p class="mini">자주 만나는 상대 = 사용률 상위 ${I.threats.length}마리(${I.threatIds.slice(0, 6).map(id => esc(byId[id].ko)).join(', ')} …), 사용률 1순위 세트 가정. 방어·회복 효과는 점수에 반영되지 않습니다.</p></div>
      </div>
      ${dropHtml}
      <section class="card">
        <h3>1. 교체 추천</h3>
        <p class="mini">빼도 팀 점수가 가장 덜 떨어지는 멤버 자리에, 넣었을 때 점수가 가장 많이 오르는 포켓몬입니다. 같은 도감번호·같은 도구는 피합니다.</p>
        ${pairHtml}
        <div class="swaps">${swapCards || '<p class="mini">교체할 만한 자리가 없습니다.</p>'}</div>
      </section>
      <section class="card">
        <h3>2. 포켓몬은 그대로 쓴다면 — 세트 다듬기</h3>
        <p class="mini">기술·도구·성격·SP를 바꾸는 방법입니다. 옆의 점수는 적용했을 때 팀 점수 변화입니다(방어·회복 열매처럼 데미지 계산에 안 잡히는 장점은 "점수 밖 장점"). <b>적용</b>을 누르면 팀에 바로 반영되고 다시 진단합니다.</p>
        <div class="tunes">${tuneHtml}</div>
      </section>`;
  }

  const P_cond = id => {
    const s = getSets().find(x => x.id === id);
    const W2 = {Drought: 'Sun', Drizzle: 'Rain', 'Sand Stream': 'Sand', 'Snow Warning': 'Snow'};
    const T2 = {'Grassy Surge': 'Grassy', 'Psychic Surge': 'Psychic', 'Electric Surge': 'Electric', 'Misty Surge': 'Misty'};
    return {weather: s ? W2[s.ability] : '', terrain: s ? T2[s.ability] : ''};
  };
  $('p-improve').addEventListener('change', ev => {
    const k = ev.target.dataset.plan;
    if (!k) return;
    I.setOverride({[k]: ev.target.value});
    try { localStorage.setItem('pc-plan-v1', JSON.stringify(I.getOverride())); } catch (e) { /* 저장 불가 */ }
    run();
  });
  try { const o = JSON.parse(localStorage.getItem('pc-plan-v1')); if (o) I.setOverride(o); } catch (e) { /* 없음 */ }
  $('p-improve').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-k]');
    if (!b || !result) { if (b && b.dataset.k === 'goto-team') gotoTeam(); return; }
    const k = b.dataset.k;
    if (k === 'goto-team') gotoTeam();
    if (k === 'swap') {
      const r = result.results.find(x => x.slot === +b.dataset.slot);
      teamUI.replaceAt(r.slot, r.options[+b.dataset.o].set);
    }
    if (k === 'pair') result.pair.slots.forEach((slot, n) => teamUI.replaceAt(slot, result.pair.sets[n]));
    if (k === 'tune') teamUI.setSet(+b.dataset.i, tuneCache[+b.dataset.i][+b.dataset.t].set);
  });

  return {run, invalidate() { key = null; }};
}
