// 선출 추천 탭 화면
import {skey} from './store.mjs';
import {ARCH_INFO} from './archetypes.mjs';
const STORE = skey('pc-opp-v1');

export function initPick({M, T, P, ty, esc, $, findMon, getMySets, gotoTeam}) {
  const {byId} = M;
  const NEED = M.doubles ? 4 : 3;  // 선출 수
  let opp = load();
  let infoOpen = {};  // 파티 성향 ⓘ 펼침

  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE));
      if (Array.isArray(v)) return v.filter(id => byId[id]).slice(0, 6);
    } catch (e) { /* 저장값 없음 */ }
    return [];
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(opp)); } catch (e) { /* 저장 불가 */ } }

  function render() {
    const mine = getMySets();
    $('pick-mine').innerHTML = mine.length
      ? mine.map(s => `<span class="mon-chip">${esc(byId[s.id].ko)}</span>`).join('')
      : '<span class="mini">팀이 비어 있습니다.</span>';
    $('pick-mine-note').innerHTML = mine.length < NEED
      ? `내 팀이 ${NEED}마리 이상 있어야 합니다. <button class="link" data-k="goto-team">팀 추천 탭에서 만들기 →</button>` : '';
    $('pick-opp').innerHTML = [0, 1, 2, 3, 4, 5].map(i => {
      const id = opp[i];
      if (id) {
        const e = byId[id], u = M.usageOf(e);
        const odds = !M.doubles && u && u.pick != null ? `<span class="mini" title="파티에 있을 때 실제로 데려오는 비율 · 데려왔을 때 선봉으로 내는 비율">선출 ${u.pick.toFixed(0)}% · 선봉 ${(u.lead || 0).toFixed(0)}%</span>` : '';
        // 메가스톤: 어떤 메가가 될지는 게임이 시작돼야 알 수 있음 → 채용률만 표시
        const stones = u ? u.it.filter(([n]) => /ite( [XYZ])?$/.test(n) && n !== 'Eviolite' && n !== 'White Herb') : [];
        const megaHint = stones.length ? `<span class="mini" title="이 포켓몬이 메가스톤을 드는 비율">메가스톤 ${stones.map(([n, p]) => `${stones.length > 1 ? ((n.match(/ ([XYZ])$/) || [])[1] || '일반') + ' ' : ''}${p.toFixed(0)}%`).join(' · ')}</span>` : '';
        return `<div class="opp-slot"><span class="types">${e.ty.map(ty).join('')}</span><b>${esc(e.ko)}</b>${odds}${megaHint}
          <button class="link danger" data-k="opp-remove" data-i="${i}" aria-label="${esc(e.ko)} 빼기">✕</button></div>`;
      }
      return `<div class="opp-slot empty"><input class="pick" list="base-list" data-k="opp-add" placeholder="${i === opp.length ? '상대 포켓몬' : ''}"
        aria-label="상대 ${i + 1}번" autocomplete="off"${i === opp.length ? '' : ' disabled'}></div>`;
    }).join('');
    $('pick-result').innerHTML = mine.length >= NEED && opp.length ? result(mine) : '<p class="mini">상대 포켓몬을 입력하면 추천이 나옵니다. 6마리를 다 넣을수록 정확합니다.</p>';
  }

  function result(mine) {
    const t0 = performance.now();
    const R = P.recommend(mine, opp);
    window.__pcPickMs = performance.now() - t0;
    const top = R.picks[0], lead = R.leads[0];
    const nm = i => esc(byId[mine[i].id].ko);
    const megaNote = p => (p.megaI != null ? `메가진화: <b>${nm(p.megaI)}</b>` : '');
    const card = (i, tag) => {
      const s = mine[i], e = byId[s.id];
      const vs = R.opp.map((o, j) => ({j, v: top.rows[i][j].v})).sort((a, b) => b.v - a.v).filter(x => x.v > 0.3).slice(0, 3);
      return `<div class="pick-card"><span class="tag">${tag}</span><b>${nm(i)}</b><span class="types">${e.ty.map(ty).join('')}</span>
        <span class="mini">${vs.length ? '유리: ' + vs.map(x => on(x.j)).join(', ') : '받쳐주는 역할'}</span></div>`;
    };
    const pct = x => (x >= 100 ? '한 방' : `${x.toFixed(0)}%`);
    // 상대 이름은 메가 전 모습으로 (누가 메가진화할지는 모름), 메가 확률은 따로 표시
    function on(n) { const o = R.opp[n]; return esc(byId[o.baseId || o.id].ko); }
    const WK = {Rain: '비', Sun: '쾌청', Sand: '모래바람', Snow: '설경'}, TK = {Grassy: '그래스필드', Psychic: '사이코필드', Electric: '일렉트릭필드', Misty: '미스트필드'};
    const modeNote = [top.useTR ? `트릭룸(${esc(byId[mine[R.plan.trIdx.find(i => top.idx.includes(i))].id].ko)}) 있을 때 60%로 계산` : '',
      top.useW ? `${WK[R.plan.weather] || TK[R.plan.terrain]} 위에서 계산` : ''].filter(Boolean).join(' · ');
    // 상대 파티 성향 (키워드 + 한 줄 설명 + ⓘ 자세히)
    const archHtml = R.arch ? archBlock(R.arch) : '';
    // 게임 플랜
    const planHtml = R.gamePlan.length ? `<div class="gameplan"><h3>게임 플랜</h3><ol>${R.gamePlan.map(l => `<li>${esc(l)}</li>`).join('')}</ol>
      ${modeNote ? `<p class="mini">${modeNote}</p>` : ''}</div>` : '';
    // 상대별 대응
    const ansHtml = `<h4>상대별 대응 <span class="mini">(이 선출 기준, 가장 유리한 멤버)</span></h4><div class="answers">${R.answers.map(a => `
      <div class="ans${a.v < 0 ? ' bad-ans' : ''}"><b>${on(a.j)}</b><span class="arrow">→</span><b>${nm(a.i)}</b>
        <span class="mini">${a.move ? `${esc(M.moveKo(a.move))} ${pct(a.off)}` : '공격기 없음'} · 받는 피해 ${a.def >= 100 ? '<span class="bad">한 방</span>' : a.def.toFixed(0) + '%'}${a.faster ? (top.useTR ? ' · ↻트릭룸에서 먼저' : ' · ⚡먼저') : ''}</span>
        ${a.second != null ? `<span class="mini">다음 대안: ${nm(a.second)}</span>` : ''}</div>`).join('')}</div>`;
    // 주의할 상대
    const dangerHtml = R.dangers.length ? `<div class="notes"><p><b>주의</b> — 한 방에 여러 마리를 잡을 수 있는 상대:</p><ul>${R.dangers.map(d => `<li><b>${on(d.j)}</b>: ${d.list.map(x => `${nm(x.i)}(${esc(M.moveKo(x.move))}, ${x.sure ? '확정' : '난수'})`).join(', ')}</li>`).join('')}</ul></div>` : '';
    const alt = R.picks.slice(1).map(p => `<li>${p.idx.map(nm).join(' · ')} <span class="mini">${megaNote(p)}</span></li>`).join('');
    const altLeads = R.leads.slice(1).map(l => `<li>${l.lead.map(nm).join(' + ')} <span class="mini">${esc(l.why.join(' · '))}</span></li>`).join('');

    // 상성표
    const head = R.opp.map((o, j) => `<th>${on(j)}${R.oppMega && R.oppMega[j] != null ? `<br><span class="mini" title="메가진화할 확률 (메가스톤 채용률, 한 배틀에 한 마리)">메가 ${Math.round(R.oppMega[j] * 100)}%</span>` : ''}</th>`).join('');
    const rows = mine.map((s, i) => {
      const chosen = top.idx.includes(i);
      return `<tr class="${chosen ? 'chosen' : ''}"><th>${nm(i)}${i === top.megaI ? ' <span class="badge b-mega">메가</span>' : ''}</th>${top.rows[i].map(c => {
        const cls = c.v >= 0.6 ? 'g2' : c.v >= 0.15 ? 'g1' : c.v > -0.15 ? 'n' : c.v > -0.6 ? 'b1' : 'b2';
        const fast = top.useTR ? c.trFaster : c.faster;
        return `<td class="${cls}" title="${esc(M.moveKo(c.off.move || ''))} ${c.off.pct.toFixed(0)}% / 받는 ${esc(M.moveKo(c.def.move || ''))} ${c.def.pct.toFixed(0)}%">
          <span class="num">${c.off.pct.toFixed(0)}</span><span class="sep">/</span><span class="num">${c.def.pct.toFixed(0)}</span>${fast ? `<i class="fast" title="${top.useTR ? '트릭룸에서 ' : ''}내가 먼저">${top.useTR ? '↻' : '⚡'}</i>` : ''}</td>`;
      }).join('')}</tr>`;
    }).join('');

    return `
      <div class="pick-top">
        <div>
          <h3>선봉</h3>
          <div class="pick-row">${lead.lead.map(i => card(i, '선봉')).join('')}</div>
          ${lead.why.length ? `<p class="mini why">${esc(lead.why.join(' · '))}</p>` : ''}
        </div>
        <div>
          <h3>후발</h3>
          <div class="pick-row">${lead.back.map(i => card(i, '후발')).join('')}</div>
          <p class="mini why">${megaNote(top)}</p>
        </div>
      </div>
      ${archHtml}
      ${planHtml}
      ${dangerHtml}
      ${R.threats.length ? `<div class="notes"><p>이 선출로 유리하게 상대하기 어려운 포켓몬: <b>${R.threats.map(t => on(t.j)).join(', ')}</b>. 교체나 방어로 버티는 계획이 필요합니다.</p></div>` : ''}
      ${ansHtml}
      <div class="pick-alt">
        <div><h4>다른 선출 후보</h4><ol>${alt || '<li class="mini">없음</li>'}</ol></div>
        <div><h4>${M.doubles ? '다른 선봉 조합' : '다른 선봉 후보'}</h4><ol>${altLeads || '<li class="mini">없음</li>'}</ol></div>
      </div>
      <h4>상성표 <span class="mini">칸 = 내가 주는 % / 내가 받는 % (서로 가장 센 기술, 상대는 사용률 1순위 세트) · 메가스톤을 자주 드는 상대는 칸 숫자는 메가 모습, 유불리(색·추천)는 메가 확률로 섞어서 계산 · ${top.useTR ? '↻ 트릭룸에서 내가 먼저' : '⚡ 내가 먼저'}</span></h4>
      <div class="tbl"><table class="mxtbl"><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function archBlock(A) {
    const pct = v => Math.round(v * 100);
    const WK = {Rain: '비', Sun: '쾌청', Sand: '모래바람', Snow: '설경'}, TK = {Psychic: '사이코필드', Grassy: '그래스필드', Electric: '일렉트릭필드', Misty: '미스트필드'};
    const name = k => ARCH_INFO[k].ko + (k === 'weather' && A.detail ? `(${WK[A.detail.weather]})` : k === 'terrain' && A.detail ? `(${TK[A.detail.terrain]})` : '');
    const keys = (A.keys || ['face', 'cycle', 'setup']).filter(k => A[k] != null);
    const tags = keys.map(k => {
      const I = {...ARCH_INFO[k], ko: name(k)}, main = A.main.includes(k);
      const who = A.per.filter(x => x.tags.includes(k)).map(x => esc(byId[x.id].ko));
      return `<div class="arch${main ? ' main' : ''}">
        <div class="arch-h"><b>${I.ko}</b><span class="archbar"><i style="width:${pct(A[k])}%"></i></span><span class="mini num">${pct(A[k])}</span>
          <button class="info" data-k="arch-info" data-v="${k}" aria-expanded="${!!infoOpen[k]}" aria-label="${I.ko} 설명">i</button></div>
        <p class="mini">${I.short}${who.length ? ` · ${who.join(', ')}` : ''}</p>
        ${infoOpen[k] ? `<div class="arch-more">
          <p>${I.what}</p>
          <p><b class="good">강한 상대</b> ${I.strong}</p>
          <p><b class="bad">약한 상대</b> ${I.weak}</p>
          <p><b>이런 상대를 만나면</b></p><ul>${I.how.map(x => `<li>${x}</li>`).join('')}</ul>
        </div>` : ''}
      </div>`;
    }).join('');
    return `<div class="arch-box"><h3>상대 파티 성향 <span class="mini">— ${A.main.map(name).join('·')} 쪽 (막대 = 성향 점수, ⓘ 누르면 설명)</span></h3>${tags}</div>`;
  }

  // ---------------- 입력 ----------------
  const root = $('p-pick');
  function tryAdd(el) {
    const id = findMon(el.value);
    if (!id) return false;
    const base = T.baseOf(id);
    if (opp.length >= 6 || opp.includes(base)) return true;
    opp = opp.concat(base); save(); render();
    root.querySelector('input[data-k=opp-add]:not([disabled])')?.focus();
    return true;
  }
  root.addEventListener('input', ev => { if (ev.target.dataset.k === 'opp-add') tryAdd(ev.target); });
  root.addEventListener('change', ev => { if (ev.target.dataset.k === 'opp-add') tryAdd(ev.target); });
  root.addEventListener('click', ev => {
    const b = ev.target.closest('button[data-k]');
    if (!b) return;
    if (b.dataset.k === 'opp-remove') { opp = opp.filter((_, i) => i !== +b.dataset.i); save(); render(); }
    if (b.dataset.k === 'opp-clear') { opp = []; save(); render(); }
    if (b.dataset.k === 'goto-team') gotoTeam();
    if (b.dataset.k === 'arch-info') { infoOpen[b.dataset.v] = !infoOpen[b.dataset.v]; render(); }
  });

  render();
  return {render, getOpp: () => opp.slice(), setOpp(ids) { opp = ids.map(T.baseOf).filter(id => byId[id]).slice(0, 6); save(); render(); }};
}
