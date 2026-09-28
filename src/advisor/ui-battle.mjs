// 배틀 도우미 탭: 필드 입력 → 상대 사용률 정보 → 이번 턴 추천 행동
import {STAT_KO, WEATHER, TERRAIN, STATUS} from './model.mjs';

const STORE = 'pc-battle-v1';
const BOOSTS = ['atk', 'def', 'spa', 'spd', 'spe'];
const SCREENS = [['reflect', '리플렉터'], ['lightScreen', '빛의장막'], ['auroraVeil', '오로라베일']];
const blankSlot = () => ({id: '', hpPct: 100, status: '', boosts: {}, fresh: true, protected: false});
const blankState = () => ({field: {weather: '', terrain: '', trickRoom: false, tailwind: {me: false, opp: false}, screens: {me: {}, opp: {}}},
  me: [blankSlot(), blankSlot()], opp: [blankSlot(), blankSlot()], bench: [], benchHp: {}, turn: 1});

export function initBattle({M, B, ty, esc, $, findMon, getMySets, getOppIds, getLead}) {
  const {byId, D} = M;
  let S = load();
  let note = '';

  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE));
      if (v && v.me && v.opp && v.field) return {...blankState(), ...v};
    } catch (e) { /* 없음 */ }
    return blankState();
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { /* 저장 불가 */ } }

  const mySets = () => getMySets();
  const mySetOf = id => mySets().find(s => (s.baseId || s.id) === id);
  const nm = id => esc(byId[id] ? byId[id].ko : id);

  // 처음 열 때: 선출 추천의 선봉·후발, 상대 목록 앞 2마리로 채움
  function prefill() {
    const sets = mySets();
    if (!S.me[0].id && sets.length) {
      const lead = getLead();
      const ids = sets.map(s => s.baseId || s.id);
      const L = lead && lead.lead ? lead.lead.map(i => ids[i]) : ids.slice(0, 2);
      const back = lead && lead.back ? lead.back.map(i => ids[i]) : ids.slice(2, 4);
      S.me = L.map(id => ({...blankSlot(), id}));
      S.bench = back;
    }
    const opp = getOppIds();
    let filled = false;
    if (!S.opp[0].id && opp.length >= 1) { S.opp = [0, 1].map(k => ({...blankSlot(), id: opp[k] || ''})); filled = true; }
    if (filled) { applyEntry(); save(); }
  }

  // 상태 → 계산 입력
  function toState() {
    const me = S.me.map(s => (s.id && mySetOf(s.id) ? {...s, set: mySetOf(s.id)} : null));
    const bench = S.bench.filter(id => mySetOf(id) && !S.me.some(s => s.id === id)).map(id => ({id, set: mySetOf(id), hpPct: S.benchHp[id] ?? 100}));
    const opp = S.opp.map(s => (s.id ? s : null));
    const planTR = mySets().some(s => s.moves.includes('Trick Room'));
    return {field: S.field, me, opp, bench, planTR};
  }

  // ---------------- 그리기 ----------------
  function boostRow(side, k, b) {
    return `<div class="bst">${BOOSTS.map(s => `<label>${STAT_KO[s]}<select data-f="boost" data-side="${side}" data-k="${k}" data-s="${s}">${[6, 5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5, -6]
      .map(v => `<option value="${v}"${v === (b[s] || 0) ? ' selected' : ''}>${v > 0 ? '+' + v : v}</option>`).join('')}</select></label>`).join('')}</div>`;
  }
  function common(side, k, s) {
    return `<div class="bt-row">
      <label>HP<input type="number" min="0" max="100" data-f="hp" data-side="${side}" data-k="${k}" value="${s.hpPct}">%</label>
      <label>상태<select data-f="status" data-side="${side}" data-k="${k}">${Object.entries(STATUS).map(([v, t]) => `<option value="${v}"${v === s.status ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="chk"><input type="checkbox" data-f="fresh" data-side="${side}" data-k="${k}"${s.fresh ? ' checked' : ''}> 방금 나옴</label>
      ${side === 'me' ? `<label class="chk"><input type="checkbox" data-f="protected" data-side="me" data-k="${k}"${s.protected ? ' checked' : ''}> 지난 턴 방어</label>` : ''}
    </div>${boostRow(side, k, s.boosts || {})}`;
  }

  function mySlot(k) {
    const s = S.me[k];
    const sets = mySets();
    const opts = sets.map(x => x.baseId || x.id);
    const set = s.id && mySetOf(s.id);
    return `<div class="bt-slot">
      <div class="bt-h"><span class="who">내 ${k === 0 ? '왼쪽' : '오른쪽'}</span>
        <select data-f="pick" data-side="me" data-k="${k}"><option value="">(비움)</option>${opts.map(id => `<option value="${id}"${id === s.id ? ' selected' : ''}>${nm(id)}</option>`).join('')}</select>
        ${set ? `<span class="types">${byId[set.id].ty.map(ty).join('')}</span>` : ''}</div>
      ${set ? `<p class="mini">${esc(M.itemKo(set.item) || '도구 없음')} · ${set.moves.filter(Boolean).map(m => esc(M.moveKo(m))).join(', ')}</p>${common('me', k, s)}` : '<p class="mini">팀 추천 탭의 내 팀에서 고르세요.</p>'}
    </div>`;
  }

  function oppSlot(k) {
    const s = S.opp[k];
    const quick = getOppIds().filter(id => !S.opp.some(o => o.id === id));
    let info = '';
    if (s.id && byId[s.id]) {
      const I = B.oppInfo(s.id);
      const set = B.oppSetOf(s);
      const u = I.usage;
      const pctTag = p => (p ? ` <span class="num">${p.toFixed(0)}%</span>` : '');
      info = `
        <div class="types">${byId[set.id].ty.map(ty).join('')}${set.id !== I.id ? `<span class="badge b-mega">${nm(set.id)}</span>` : ''}
          ${u ? `<span class="mini">사용률 ${u.rank}위 · ${u.pct.toFixed(1)}%</span>` : '<span class="mini">사용률 기록 없음</span>'}</div>
        <div class="usage-box">
          <div><b>기술</b><div class="uchips">${I.moves.slice(0, 8).map(([m, p]) => `<button class="uchip${set.moves.includes(m) ? ' on' : ''}" data-f="omove" data-k="${k}" data-v="${esc(m)}" title="켜진 기술 4개로 계산합니다. 게임에서 본 기술을 켜고 안 쓸 것 같은 기술을 끄세요">${esc(M.moveKo(m))}${pctTag(p)}</button>`).join('')}</div></div>
          <div class="u2">
            <label><b>도구</b><select data-f="oitem" data-k="${k}">${I.items.length ? '' : `<option value="">${esc(M.itemKo(set.item) || '없음')}</option>`}${I.items.slice(0, 8).map(([n, p]) => `<option value="${esc(n)}"${n === set.item ? ' selected' : ''}>${esc(M.itemKo(n))} ${p.toFixed(0)}%</option>`).join('')}</select></label>
            <label><b>특성</b><select data-f="oab" data-k="${k}">${(set.id !== I.id ? byId[set.id].ab.map(a => [a.en, 0]) : I.abilities).map(([n, p]) => { const a = byId[set.id].ab.find(x => x.en === n); return `<option value="${esc(n)}"${n === set.ability ? ' selected' : ''}>${esc(a ? a.ko || a.en : n)}${p ? ' ' + p.toFixed(0) + '%' : ''}</option>`; }).join('')}</select></label>
          </div>
          <p class="mini">스피드 실수치: 최저 ${I.speed.min} · 무보정 최대 ${I.speed.neutral} · 최속 ${I.speed.max} · <b>계산 가정 ${M.finalStats(set).spe}</b></p>
          ${I.mates.length ? `<p class="mini">같이 자주 나옴: ${I.mates.slice(0, 5).map(([id, p]) => `${nm(id)} ${p.toFixed(0)}%`).join(', ')}</p>` : ''}
        </div>
        ${common('opp', k, s)}`;
    }
    return `<div class="bt-slot opp">
      <div class="bt-h"><span class="who">상대 ${k === 0 ? '왼쪽' : '오른쪽'}</span>
        <input class="pick" list="mon-list" data-f="opick" data-k="${k}" value="${s.id && byId[s.id] ? esc(byId[s.id].ko + ' · ' + byId[s.id].en) : ''}" placeholder="상대 포켓몬 (이름 검색)" autocomplete="off">
        ${s.id ? `<button class="link danger" data-f="oclear" data-k="${k}">✕</button>` : ''}</div>
      ${quick.length ? `<div class="quick">${quick.map(id => `<button class="chip-ex" data-f="oquick" data-k="${k}" data-v="${id}">${nm(id)}</button>`).join('')}</div>` : ''}
      ${info}
    </div>`;
  }

  function benchBox() {
    const sets = mySets();
    const cand = sets.map(x => x.baseId || x.id).filter(id => !S.me.some(s => s.id === id));
    return `<div class="bench"><span class="mini">교체 가능 (데려온 멤버, 최대 2)</span>${cand.map(id => {
      const on = S.bench.includes(id);
      return `<span class="bench-item${on ? ' on' : ''}"><label class="chk"><input type="checkbox" data-f="bench" data-v="${id}"${on ? ' checked' : ''}> ${nm(id)}</label>
        ${on ? `<input type="number" min="0" max="100" data-f="bhp" data-v="${id}" value="${S.benchHp[id] ?? 100}" aria-label="${nm(id)} HP">%` : ''}</span>`;
    }).join('') || '<span class="mini">없음</span>'}</div>`;
  }

  function fieldBar() {
    const f = S.field;
    return `<div class="card bt-field">
      <b>${S.turn}턴</b>
      <select data-f="weather">${Object.entries(WEATHER).map(([k, v]) => `<option value="${k}"${k === f.weather ? ' selected' : ''}>날씨: ${v}</option>`).join('')}</select>
      <select data-f="terrain">${Object.entries(TERRAIN).map(([k, v]) => `<option value="${k}"${k === f.terrain ? ' selected' : ''}>필드: ${v}</option>`).join('')}</select>
      <label class="chk"><input type="checkbox" data-f="tr"${f.trickRoom ? ' checked' : ''}> 트릭룸</label>
      <label class="chk"><input type="checkbox" data-f="twme"${f.tailwind.me ? ' checked' : ''}> 우리 순풍</label>
      <label class="chk"><input type="checkbox" data-f="twopp"${f.tailwind.opp ? ' checked' : ''}> 상대 순풍</label>
      <span class="mini">우리 벽</span>${SCREENS.map(([k, t]) => `<label class="chk"><input type="checkbox" data-f="scr" data-side="me" data-v="${k}"${f.screens.me[k] ? ' checked' : ''}> ${t}</label>`).join('')}
      <span class="mini">상대 벽</span>${SCREENS.map(([k, t]) => `<label class="chk"><input type="checkbox" data-f="scr" data-side="opp" data-v="${k}"${f.screens.opp[k] ? ' checked' : ''}> ${t}</label>`).join('')}
      <span class="sp"></span>
      <button class="btn" data-f="next">다음 턴 →</button>
      <button class="btn" data-f="reset">새 배틀</button>
      ${note ? `<p class="mini bt-note">${note}</p>` : ''}
    </div>`;
  }

  // ---------------- 결과 ----------------
  function actText(a, R, c, i) {
    if (!a || a.kind === 'none') return '—';
    const on = j => nm(R.opps[j].set.id);
    if (a.kind === 'attack') {
      const red = c && c.log.find(x => x.k === 'redirected' && x.from === 'm' + i);
      if (red) return `<b>${esc(M.moveKo(a.move))}</b> → ${on(+red.to[1])} <span class="mini">(유인에 끌려감)</span>`;
      return `<b>${esc(M.moveKo(a.move))}</b> → ${a.target === 'spread' ? '상대 전체' : on(a.target)}`;
    }
    if (a.kind === 'switch') return `<b>교체</b> → ${nm(R.bench[a.to].set.baseId || R.bench[a.to].set.id)}`;
    return `<b>${esc(M.moveKo(a.move))}</b>`;
  }
  function logText(c, R) {
    const who = k => (k[0] === 'o' ? nm(R.opps[+k[1]].set.id) : k[0] === 'b' ? nm(R.bench[+k[1]].set.id) : nm(R.mine[+k[1]].set.id));
    const lines = [];
    for (const x of c.log) {
      if (x.k === 'hit' && x.from[0] !== 'o') lines.push(`${who(x.from)}의 ${esc(M.moveKo(x.move))} → ${who(x.to)} ${x.r.minPct.toFixed(0)}~${x.r.maxPct.toFixed(0)}%${x.mult > 1 ? ' (도우미)' : ''}${x.ko ? (x.sure ? ' <b class="good">확정으로 쓰러짐</b>' : ' <b class="good">쓰러질 가능성 큼</b>') : ''}`);
      if (x.k === 'redirected') lines.push(`${who(x.from)}의 공격이 ${who(x.to)}에게 끌려감 (유인)`);
      if (x.k === 'ally') lines.push(`<span class="bad">⚠ ${who(x.from)}의 ${esc(M.moveKo(x.move))}가 우리 편 ${who(x.to)}도 맞춤 ${x.r.minPct.toFixed(0)}~${x.r.maxPct.toFixed(0)}%</span>`);
      if (x.k === 'flinch') lines.push(`${who(x.who)} 풀죽어서 행동 못 함`);
      if (x.k === 'blocked') lines.push(`${who('o' + x.j)}의 ${esc(M.moveKo(x.move))}를 방어로 막음`);
      if (x.k === 'wide') lines.push(`${who('o' + x.j)}의 ${esc(M.moveKo(x.move))}를 와이드가드로 막음`);
      if (x.k === 'hit' && x.from[0] === 'o') lines.push(`<span class="mini">${who(x.from)}의 ${esc(M.moveKo(x.move))} → ${who(x.to)} ${x.r.minPct.toFixed(0)}~${x.r.maxPct.toFixed(0)}%${x.ko ? ' <b class="bad">쓰러짐 위험</b>' : ''}</span>`);
    }
    return lines;
  }

  function results() {
    const st = toState();
    if (!st.me.some(Boolean) || !st.opp.some(Boolean)) return '<p class="mini">내 포켓몬과 상대 포켓몬을 한 마리 이상 넣으면 추천이 나옵니다.</p>';
    const R = B.advise(st);
    window.__pcBattle = R;
    const pred = R.oppPred.filter(Boolean).map(p => {
      const o = nm(R.opps[p.j].set.id);
      if (!p.move) return `<li>${o}: 공격기 없음</li>`;
      if (p.redirect) return `<li>${o}: <b>${esc(M.moveKo(p.move))}</b> (우리 단일 공격을 끌어감)</li>`;
      const tgt = p.target === 'spread' ? '우리 전체' : nm(R.mine[p.target].set.id);
      return `<li>${o}: <b>${esc(M.moveKo(p.move))}</b> → ${tgt}${p.alts && p.alts.length ? ` <span class="mini">(또는 ${p.alts.map(a => esc(M.moveKo(a.move))).join(', ')})</span>` : ''}</li>`;
    }).join('');
    const order = [];
    R.mine.forEach((m, i) => m && order.push({n: nm(m.set.id), s: R.speeds.me[i], me: true}));
    R.opps.forEach((o, j) => o && order.push({n: nm(o.set.id), s: R.speeds.opp[j], me: false}));
    order.sort((a, b) => (R.trickRoom ? a.s - b.s : b.s - a.s));
    const top = R.top.map((c, k) => `<div class="bt-rec${k === 0 ? ' first' : ''}">
      <div class="bt-rec-h"><span class="tag">${k + 1}순위</span>${c.acts.map((a, i) => (R.mine[i] ? `<span>${nm(R.mine[i].set.id)}: ${actText(a, R, c, i)}</span>` : '')).join('')}</div>
      <ul>${logText(c, R).map(l => `<li>${l}</li>`).join('')}${c.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
    </div>`).join('');
    const pctCell = r => (r ? `${r.minPct.toFixed(0)}~${r.maxPct.toFixed(0)}` : '—');
    const grid = R.grid.map((rows, i) => (R.mine[i] ? `<table class="typetbl bt-grid"><thead><tr><th>${nm(R.mine[i].set.id)}</th>${R.opps.map(o => `<th>${o ? nm(o.set.id) : '—'}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(x => `<tr><td>${esc(M.moveKo(x.move))}${x.prio > 0 ? ` <span class="badge b-form">선공+${x.prio}</span>` : ''}${x.spread ? ' <span class="badge b-form">전체</span>' : ''}${x.ally ? ' <span class="badge b-form bad">우리 편도</span>' : ''}</td>${x.vs.map(r => `<td class="num">${pctCell(r)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '')).join('');
    const inc = R.incoming.map((rows, j) => (R.opps[j] ? `<table class="typetbl bt-grid"><thead><tr><th>${nm(R.opps[j].set.id)}</th>${R.mine.map(m => `<th>${m ? nm(m.set.id) : '—'}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(x => `<tr><td>${esc(M.moveKo(x.move))}${x.prio > 0 ? ` <span class="badge b-form">선공+${x.prio}</span>` : ''}${x.spread ? ' <span class="badge b-form">전체</span>' : ''}</td>${x.vs.map(r => `<td class="num">${pctCell(r)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '')).join('');
    return `
      <h3>이번 턴 추천</h3>
      <div class="bt-recs">${top || '<p class="mini">가능한 행동이 없습니다.</p>'}</div>
      <div class="bt-two">
        <div><h4>상대 예상 행동</h4><ul class="probs">${pred}</ul></div>
        <div><h4>행동 순서 (스피드${R.trickRoom ? ', 트릭룸이라 느린 쪽 먼저' : ''})</h4><p>${order.map(o => `<span class="${o.me ? 'good' : ''}">${o.n} ${o.s}</span>`).join(' › ')}</p>
          <p class="mini">선공기(속이다 +3, 불릿펀치 +1 등)는 스피드보다 먼저. 상대 세트는 위에서 고른 도구·특성과 사용률 1순위 가정.</p></div>
      </div>
      <details class="mrank"><summary>데미지표 보기 (%)</summary><h4>내가 주는 피해</h4><div class="bt-grids">${grid}</div><h4>내가 받는 피해</h4><div class="bt-grids">${inc}</div></details>`;
  }

  function render() {
    prefill();
    $('p-battle').innerHTML = `${fieldBar()}
      <div class="grid bt-sides">
        <div class="card"><h3>내 필드</h3>${mySlot(0)}${mySlot(1)}${benchBox()}</div>
        <div class="card"><h3>상대 필드</h3>${oppSlot(0)}${oppSlot(1)}</div>
      </div>
      <div class="card bt-res" id="bt-res">${results()}</div>`;
  }
  function renderResults() { const el = $('bt-res'); if (el) el.innerHTML = results(); }

  // 방금 나온 포켓몬의 날씨·필드 특성을 필드에 반영
  function applyEntry() {
    const st = toState();
    const conds = B.entryConditions({me: st.me.filter(Boolean).map(s => ({...s})), opp: S.opp.filter(s => s.id)});
    const msgs = [];
    for (const c of conds) {
      if (c.weather && S.field.weather !== c.weather) { S.field.weather = c.weather; msgs.push(`${nm(c.id)} 등장 → 날씨 ${WEATHER[c.weather]}`); }
      if (c.terrain && S.field.terrain !== c.terrain) { S.field.terrain = c.terrain; msgs.push(`${nm(c.id)} 등장 → ${TERRAIN[c.terrain]}`); }
    }
    note = msgs.length ? `${msgs.join(', ')} 자동 적용 (둘 다 깔리면 나중에 나온 쪽이 이김 — 실제와 다르면 바꾸세요)` : note;
  }

  // ---------------- 입력 ----------------
  const root = $('p-battle');
  function onChange(e) {
    const el = e.target, f = el.dataset.f;
    if (!f) return;
    const side = el.dataset.side, k = +el.dataset.k;
    const slot = side === 'me' ? S.me[k] : side === 'opp' ? S.opp[k] : null;
    let full = true;
    switch (f) {
      case 'pick': S.me[k] = {...blankSlot(), id: el.value}; S.bench = S.bench.filter(id => id !== el.value); applyEntry(); break;
      case 'opick': {
        const id = findMon(el.value);
        if (!id) return;
        const base = byId[id].mega ? byId[id].parent : id;
        S.opp[k] = {...blankSlot(), id: base}; applyEntry(); break;
      }
      case 'hp': slot.hpPct = Math.max(0, Math.min(100, Math.round(+el.value || 0))); full = false; break;
      case 'status': slot.status = el.value; full = false; break;
      case 'boost': slot.boosts = {...slot.boosts, [el.dataset.s]: +el.value}; full = false; break;
      case 'fresh': slot.fresh = el.checked; break;
      case 'protected': slot.protected = el.checked; full = false; break;
      case 'oitem': S.opp[k].item = el.value; break;
      case 'oab': S.opp[k].ability = el.value; full = false; break;
      case 'weather': S.field.weather = el.value; full = false; break;
      case 'terrain': S.field.terrain = el.value; full = false; break;
      case 'tr': S.field.trickRoom = el.checked; full = false; break;
      case 'twme': S.field.tailwind.me = el.checked; full = false; break;
      case 'twopp': S.field.tailwind.opp = el.checked; full = false; break;
      case 'scr': S.field.screens[side] = {...S.field.screens[side], [el.dataset.v]: el.checked}; full = false; break;
      case 'bench': {
        const id = el.dataset.v;
        S.bench = el.checked ? [...S.bench.filter(x => x !== id), id].slice(-2) : S.bench.filter(x => x !== id);
        break;
      }
      case 'bhp': S.benchHp[el.dataset.v] = Math.max(0, Math.min(100, Math.round(+el.value || 0))); full = false; break;
      default: return;
    }
    save();
    if (full) render(); else renderResults();
  }
  root.addEventListener('change', onChange);
  root.addEventListener('input', e => { if (['hp', 'bhp', 'opick'].includes(e.target.dataset.f)) onChange(e); });
  root.addEventListener('click', e => {
    const b = e.target.closest('button[data-f]');
    if (!b) return;
    const f = b.dataset.f, k = +b.dataset.k;
    if (f === 'oquick') { S.opp[k] = {...blankSlot(), id: b.dataset.v}; applyEntry(); }
    if (f === 'oclear') S.opp[k] = blankSlot();
    if (f === 'omove') {
      // 켜진 기술 = 계산에 쓰는 기술 4개. 누르면 빼거나(켜짐) 넣음(꺼짐, 4개 넘으면 마지막 것을 뺌)
      const s = S.opp[k], mv = b.dataset.v;
      const cur = B.oppSetOf(s).moves.filter(Boolean);
      s.moves = cur.includes(mv) ? cur.filter(x => x !== mv) : [mv, ...cur].slice(0, 4);
      if (!s.moves.length) s.moves = [mv];
    }
    if (f === 'next') {
      S.turn++;
      S.me.forEach(s => { s.fresh = false; }); S.opp.forEach(s => { s.fresh = false; });
      note = '다음 턴: "방금 나옴"을 해제했어요. HP·랭크·필드를 바꾸고, 교체된 포켓몬은 다시 고르세요.';
    }
    if (f === 'reset') { S = blankState(); note = ''; }
    save(); render();
  });

  return {render};
}
