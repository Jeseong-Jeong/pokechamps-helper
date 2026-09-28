// 배틀 도우미 탭: 필드 입력 → 상대 사용률 정보 → 이번 턴 추천 행동
import {STAT_KO, WEATHER, TERRAIN, STATUS} from './model.mjs';

const STORE = 'pc-battle-v1';
const BOOSTS = ['atk', 'def', 'spa', 'spd', 'spe'];
const SCREENS = [['reflect', '리플렉터'], ['lightScreen', '빛의장막'], ['auroraVeil', '오로라베일']];
const blankSlot = () => ({id: '', hpPct: 100, status: '', boosts: {}, fresh: true, protected: false});
const blankState = () => ({field: {weather: '', terrain: '', trickRoom: false, tailwind: {me: false, opp: false}, screens: {me: {}, opp: {}}},
  me: [blankSlot(), blankSlot()], opp: [blankSlot(), blankSlot()], bench: [], benchHp: {}, oppOut: [], oppHp: {}, history: [], turn: 1});

export function initBattle({M, B, ty, esc, $, findMon, getMySets, getOppIds, getLead}) {
  const {byId, D} = M;
  let S = load();
  let note = '';
  let draft = null;     // 이번 턴 결과 입력 중인 값
  let lastR = null;     // 이번 턴 추천 계산 결과 (예측 비교용)

  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE));
      if (v && v.me && v.opp && v.field) return {...blankState(), ...v, oppOut: v.oppOut || [], oppHp: v.oppHp || {}, history: v.history || []};
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
    const oppBench = getOppIds().filter(id => !S.opp.some(o => o.id === id) && !S.oppOut.includes(id));
    return {field: S.field, me, opp, bench, planTR, oppBench, oppHp: S.oppHp};
  }

  // ---------------- 그리기 (게임 화면처럼: 위 상대 두 마리, 아래 내 두 마리) ----------------
  let pickOpen = {};  // 'opp0' 등: 포켓몬 고르기 칸 열림
  const hpColor = p => (p > 50 ? 'var(--good)' : p > 20 ? 'var(--gold)' : 'var(--bad)');
  const boostSummary = b => BOOSTS.filter(s => b && b[s]).map(s => `${STAT_KO[s]}${b[s] > 0 ? '+' : ''}${b[s]}`).join(' ');

  function boostRow(side, k, b) {
    return `<div class="bst">${BOOSTS.map(s => `<label>${STAT_KO[s]}<select data-f="boost" data-side="${side}" data-k="${k}" data-s="${s}">${[6, 5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5, -6]
      .map(v => `<option value="${v}"${v === (b[s] || 0) ? ' selected' : ''}>${v > 0 ? '+' + v : v}</option>`).join('')}</select></label>`).join('')}</div>`;
  }

  // 칸 공통: HP 막대·숫자, 상태이상, 방금 나옴·지난 턴 방어, 랭크(접힘)
  function stateRows(side, k, s) {
    const bs = boostSummary(s.boosts);
    return `
      <div class="hp-row"><span class="hpbar"><i style="width:${s.hpPct}%;background:${hpColor(s.hpPct)}"></i></span>
        <input type="number" min="0" max="100" data-f="hp" data-side="${side}" data-k="${k}" value="${s.hpPct}" aria-label="남은 HP">%</div>
      <div class="tog-row">
        <select data-f="status" data-side="${side}" data-k="${k}" aria-label="상태이상">${Object.entries(STATUS).map(([v, t]) => `<option value="${v}"${v === s.status ? ' selected' : ''}>${v ? t : '상태 정상'}</option>`).join('')}</select>
        <button class="tog${s.fresh ? ' on' : ''}" data-f="tog" data-side="${side}" data-k="${k}" data-v="fresh" title="이번 턴에 나옴 (속이다·만나자마자 가능)">방금 나옴</button>
        <button class="tog${s.protected ? ' on' : ''}" data-f="tog" data-side="${side}" data-k="${k}" data-v="protected" title="지난 턴에 방어를 써서 이번엔 방어 불가">지난 턴 방어</button>
      </div>
      <details class="fold"><summary>랭크${bs ? ` <b>${bs}</b>` : ''}</summary>${boostRow(side, k, s.boosts || {})}</details>`;
  }

  // 포켓몬 고르기 버튼들
  function picker(side, k) {
    if (side === 'opp') {
      const ids = getOppIds().filter(id => !S.opp.some((o, j) => j !== k && o.id === id) && !S.oppOut.includes(id));
      return `<div class="pickgrid">${ids.map(id => `<button class="pk${S.opp[k].id === id ? ' on' : ''}" data-f="oquick" data-k="${k}" data-v="${id}">${nm(id)}</button>`).join('')}
        <input class="pick" list="mon-list" data-f="opick" data-k="${k}" placeholder="${ids.length ? '다른 포켓몬 검색' : '상대 포켓몬 검색'}" autocomplete="off"></div>
        ${ids.length ? '' : '<p class="mini">선출 추천 탭에 상대 6마리를 넣어두면 여기서 누르기만 하면 됩니다.</p>'}`;
    }
    const ids = mySets().map(x => x.baseId || x.id).filter(id => !S.me.some((o, j) => j !== k && o.id === id) && (S.benchHp[id] ?? 100) > 0);
    return `<div class="pickgrid">${ids.map(id => `<button class="pk${S.me[k].id === id ? ' on' : ''}" data-f="mquick" data-k="${k}" data-v="${id}">${nm(id)}${S.bench.includes(id) ? ' <span class="mini">뒤</span>' : ''}</button>`).join('')}</div>`;
  }

  function oppBox(k) {
    const s = S.opp[k];
    const open = pickOpen['opp' + k] || !s.id;
    let body = '';
    if (s.id && byId[s.id]) {
      const I = B.oppInfo(s.id);
      const set = B.oppSetOf(s);
      const u = I.usage;
      const abKo = n => { const a = byId[set.id].ab.find(x => x.en === n); return a ? a.ko || a.en : n; };
      const pctTag = p => (p ? ` <span class="num">${p.toFixed(0)}%</span>` : '');
      body = `
        <p class="mini sum">스피드 ${M.finalStats(set).spe} · ${esc(M.itemKo(set.item) || '도구 ?')} · ${esc(abKo(set.ability))}${u ? ` · 사용률 ${u.rank}위` : ''}</p>
        ${stateRows('opp', k, s)}
        <details class="fold"><summary>사용률 정보 (기술·도구·특성·스피드)</summary>
          <div class="usage-box">
            <div><b>기술</b> <span class="mini">켜진 4개로 계산 · 게임에서 본 기술을 켜세요</span><div class="uchips">${I.moves.slice(0, 8).map(([m, p]) => `<button class="uchip${set.moves.includes(m) ? ' on' : ''}" data-f="omove" data-k="${k}" data-v="${esc(m)}">${esc(M.moveKo(m))}${pctTag(p)}</button>`).join('')}</div></div>
            <div class="u2">
              <label><b>도구</b><select data-f="oitem" data-k="${k}">${I.items.length ? '' : `<option value="">${esc(M.itemKo(set.item) || '없음')}</option>`}${I.items.slice(0, 8).map(([n, p]) => `<option value="${esc(n)}"${n === set.item ? ' selected' : ''}>${esc(M.itemKo(n))} ${p.toFixed(0)}%</option>`).join('')}</select></label>
              <label><b>특성</b><select data-f="oab" data-k="${k}">${(set.id !== I.id ? byId[set.id].ab.map(a => [a.en, 0]) : I.abilities).map(([n, p]) => `<option value="${esc(n)}"${n === set.ability ? ' selected' : ''}>${esc(abKo(n))}${p ? ' ' + p.toFixed(0) + '%' : ''}</option>`).join('')}</select></label>
            </div>
            <p class="mini">스피드: 최저 ${I.speed.min} · 무보정 최대 ${I.speed.neutral} · 최속 ${I.speed.max}</p>
            ${I.mates.length ? `<p class="mini">같이 자주 나옴: ${I.mates.slice(0, 5).map(([id, p]) => `${nm(id)} ${p.toFixed(0)}%`).join(', ')}</p>` : ''}
          </div>
        </details>`;
    }
    const e = s.id && byId[s.id] ? byId[B.oppSetOf(s).id] : null;
    return `<div class="mon-box opp">
      <div class="mb-h"><span class="who">상대 ${k === 0 ? '왼쪽' : '오른쪽'}</span>
        ${e ? `<b class="mb-name">${nm(e.id)}</b><span class="types">${e.ty.map(ty).join('')}</span>` : '<b class="mb-name mini">누가 나왔나요?</b>'}
        ${s.id ? `<button class="link" data-f="pickopen" data-v="opp${k}">${open ? '닫기' : '바꾸기'}</button>` : ''}</div>
      ${open ? picker('opp', k) : ''}
      ${body}
    </div>`;
  }

  function myBox(k) {
    const s = S.me[k];
    const set = s.id && mySetOf(s.id);
    const open = pickOpen['me' + k] || !set;
    return `<div class="mon-box me">
      <div class="mb-h"><span class="who">내 ${k === 0 ? '왼쪽' : '오른쪽'}</span>
        ${set ? `<b class="mb-name">${nm(set.id)}</b><span class="types">${byId[set.id].ty.map(ty).join('')}</span>` : '<b class="mb-name mini">누구를 냈나요?</b>'}
        ${set ? `<button class="link" data-f="pickopen" data-v="me${k}">${open ? '닫기' : '바꾸기'}</button>` : ''}</div>
      ${open ? picker('me', k) : ''}
      ${set ? `<p class="mini sum">스피드 ${M.finalStats(set).spe} · ${esc(M.itemKo(set.item) || '도구 없음')} · ${set.moves.filter(Boolean).map(m => esc(M.moveKo(m))).join(', ')}</p>${stateRows('me', k, s)}` : ''}
    </div>`;
  }

  // 뒤에 있는 포켓몬: 내 쪽(교체 후보, 최대 2) / 상대 쪽(교체 예측용)
  function backRow() {
    const mine = mySets().map(x => x.baseId || x.id).filter(id => !S.me.some(s => s.id === id));
    const opp = getOppIds().filter(id => !S.opp.some(o => o.id === id));
    return `<div class="back-row">
      <div><span class="who">내 뒤 (교체 가능, 최대 2)</span><div class="uchips">${mine.map(id => {
        const on = S.bench.includes(id), hp = S.benchHp[id] ?? 100;
        return `<span class="bench-item"><button class="uchip${on ? ' on' : ''}${hp <= 0 ? ' dead' : ''}" data-f="benchtog" data-v="${id}">${nm(id)}</button>${on ? `<input type="number" min="0" max="100" data-f="bhp" data-v="${id}" value="${hp}" aria-label="${nm(id)} HP">%` : ''}</span>`;
      }).join('') || '<span class="mini">없음</span>'}</div></div>
      <div><span class="who">상대 뒤 (교체 예측에 사용 · 누르면 제외)</span><div class="uchips">${opp.map(id => {
        const out = S.oppOut.includes(id);
        return `<button class="uchip${out ? ' dead' : ' on'}" data-f="oout" data-v="${id}">${nm(id)}${out ? ' ✕' : ''}</button>`;
      }).join('') || '<span class="mini">선출 추천 탭에 상대 6마리를 넣으면 표시됩니다</span>'}</div></div>
    </div>`;
  }

  function fieldBar() {
    const f = S.field;
    const scr = side => SCREENS.filter(([k]) => f.screens[side][k]).map(([, t]) => t).join('·');
    return `<div class="card bt-field">
      <b>${S.turn}턴</b>
      <select data-f="weather">${Object.entries(WEATHER).map(([k, v]) => `<option value="${k}"${k === f.weather ? ' selected' : ''}>날씨: ${v}</option>`).join('')}</select>
      <select data-f="terrain">${Object.entries(TERRAIN).map(([k, v]) => `<option value="${k}"${k === f.terrain ? ' selected' : ''}>필드: ${v}</option>`).join('')}</select>
      <button class="tog${f.trickRoom ? ' on' : ''}" data-f="ftog" data-v="tr">트릭룸</button>
      <button class="tog${f.tailwind.me ? ' on' : ''}" data-f="ftog" data-v="twme">우리 순풍</button>
      <button class="tog${f.tailwind.opp ? ' on' : ''}" data-f="ftog" data-v="twopp">상대 순풍</button>
      <details class="fold inline"><summary>벽${scr('me') || scr('opp') ? ` <b>${[scr('me') && '우리 ' + scr('me'), scr('opp') && '상대 ' + scr('opp')].filter(Boolean).join(' / ')}</b>` : ''}</summary>
        <span class="mini">우리</span>${SCREENS.map(([k, t]) => `<label class="chk"><input type="checkbox" data-f="scr" data-side="me" data-v="${k}"${f.screens.me[k] ? ' checked' : ''}> ${t}</label>`).join('')}
        <span class="mini">상대</span>${SCREENS.map(([k, t]) => `<label class="chk"><input type="checkbox" data-f="scr" data-side="opp" data-v="${k}"${f.screens.opp[k] ? ' checked' : ''}> ${t}</label>`).join('')}
      </details>
      <span class="sp"></span>
      <button class="btn" data-f="next" title="결과 기록 없이 턴만 넘김">기록 없이 다음 턴</button>
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
      if (x.k === 'oppSwitch') lines.push(`상대 ${nm(R.opps[x.j].set.id)} 교체 → ${nm(x.to)}`);
      if (x.k === 'oppProtect') lines.push(`상대 ${nm(R.opps[x.j].set.id)} 방어`);
      if (x.k === 'oppBlocked') lines.push(`<span class="mini">${who(x.from)}의 ${esc(M.moveKo(x.move))}는 방어에 막힘</span>`);
      if (x.k === 'hit' && x.from[0] !== 'o') lines.push(`${who(x.from)}의 ${esc(M.moveKo(x.move))} → ${x.toId ? nm(x.toId) + '(교체해 들어옴)' : who(x.to)} ${rng(x.r)}${x.mult > 1 ? ' (도우미)' : ''}${x.ko ? (x.sure ? ' <b class="good">확정으로 쓰러짐</b>' : ' <b class="good">쓰러질 가능성 큼</b>') : ''}`);
      if (x.k === 'redirected') lines.push(`${who(x.from)}의 공격이 ${who(x.to)}에게 끌려감 (유인)`);
      if (x.k === 'ally') lines.push(`<span class="bad">⚠ ${who(x.from)}의 ${esc(M.moveKo(x.move))}가 우리 편 ${who(x.to)}도 맞춤 ${x.r.minPct.toFixed(0)}~${x.r.maxPct.toFixed(0)}%</span>`);
      if (x.k === 'flinch') lines.push(`${who(x.who)} 풀죽어서 행동 못 함`);
      if (x.k === 'blocked') lines.push(`${who('o' + x.j)}의 ${esc(M.moveKo(x.move))}를 방어로 막음`);
      if (x.k === 'wide') lines.push(`${who('o' + x.j)}의 ${esc(M.moveKo(x.move))}를 와이드가드로 막음`);
      if (x.k === 'hit' && x.from[0] === 'o') lines.push(`<span class="mini">${who(x.from)}의 ${esc(M.moveKo(x.move))} → ${who(x.to)} ${x.r.minPct.toFixed(0)}~${x.r.maxPct.toFixed(0)}%${x.ko ? ' <b class="bad">쓰러짐 위험</b>' : ''}</span>`);
    }
    return lines;
  }

  const rng = r => (r.maxPct <= 0 ? '효과 없음' : `${r.minPct.toFixed(0)}~${r.maxPct.toFixed(0)}%`);
  // 가장 가능성 높은 경우 말고, 상대가 교체·방어하는 경우의 결과 요약
  function ifElse(c, R) {
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const alts = (c.sims || []).filter(x => !same(x.scen, c.scen) && x.p >= 0.1)
      .sort((a, b) => b.p - a.p).slice(0, 2);
    if (!alts.length) return '';
    return `<p class="mini">${alts.map(x => {
      const what = x.scen.map((y, j) => (y.type === 'switch' ? `${nm(R.opps[j].set.id)} 교체 → ${nm(R.oppBench[y.k].id)}` : y.type === 'protect' ? `${nm(R.opps[j].set.id)} 방어` : '')).filter(Boolean).join(', ') || '상대가 그대로 공격';
      const hits = x.log.filter(l => l.k === 'hit' && l.from[0] !== 'o').map(l => `${esc(M.moveKo(l.move))} → ${l.toId ? nm(l.toId) : nm(R.opps[+l.to[1]].set.id)} ${rng(l.r)}`);
      const blocked = x.log.filter(l => l.k === 'oppBlocked').length;
      return `만약 ${what} (${Math.round(x.p * 100)}%): ${hits.join(', ') || '공격 없음'}${blocked ? ` · ${blocked}번 방어에 막힘` : ''}`;
    }).join('<br>')}</p>`;
  }

  // ---------------- 이번 턴 결과 기록 ----------------
  const likelyOf = d => (!d ? 'attack' : d.pS >= d.pA && d.pS >= d.pP ? 'switch' : d.pP > d.pA ? 'protect' : 'attack');
  const tgtOf = t => (t === 'spread' ? 'spread' : typeof t === 'number' ? t : '');
  // 기본값: 내 쪽은 추천 1순위, 상대 쪽은 예상 행동
  function makeDraft(R) {
    const top = R && R.top[0];
    return {
      opp: S.opp.map((s, j) => {
        if (!s.id) return null;
        const d = R && R.defense[j], p = R && R.oppPred[j];
        const move = p && p.move ? p.move : '';
        return {act: 'attack', move, target: p && !p.redirect ? tgtOf(p.target) : '', to: d && d.switchTo ? d.switchTo.id : '', hp: s.hpPct, newHp: 100};
      }),
      me: S.me.map((s, i) => {
        if (!s.id) return null;
        const a = top && top.acts[i];
        const base = {act: 'attack', move: '', target: '', to: '', hp: s.hpPct};
        if (!a || a.kind === 'none') return base;
        if (a.kind === 'protect') return {...base, act: 'protect', move: a.move};
        if (a.kind === 'switch') return {...base, act: 'switch', to: R.bench[a.to] ? R.bench[a.to].id : ''};
        return {...base, move: a.move || '', target: a.kind === 'attack' ? tgtOf(a.target) : ''};
      }),
      rec: top ? top.acts.map(a => [a.kind, a.move || '', a.target ?? '', a.to ?? ''].join(':')) : null,
    };
  }

  // 기록한 기술·대상으로 예상 남은 HP (표시용)
  function expectHp(R, side, k) {
    if (!R) return null;
    let lo = 0, hi = 0, any = false;
    const src = side === 'opp' ? draft.me : draft.opp;
    src.forEach((a, i) => {
      if (!a || a.act !== 'attack' || !a.move) return;
      if (!(a.target === 'spread' || a.target === k)) return;
      const rows = side === 'opp' ? R.grid[i] : R.incoming[i];
      const row = rows && rows.find(x => x.move === a.move);
      const r = row && row.vs[k];
      if (!r) return;
      lo += r.minPct; hi += r.maxPct; any = true;
    });
    if (!any) return null;
    const cur = (side === 'opp' ? S.opp[k] : S.me[k]).hpPct;
    return [Math.max(0, Math.round(cur - hi)), Math.max(0, Math.round(cur - lo))];
  }

  function resultForm(R) {
    if (!draft) draft = makeDraft(R);
    const oppBack = getOppIds().filter(id => !S.opp.some(o => o.id === id) && !S.oppOut.includes(id));
    const myBack = S.bench.filter(id => !S.me.some(s => s.id === id));
    const btn = (side, k, act, label, cur) => `<button class="seg${cur === act ? ' on' : ''}" data-f="ract" data-side="${side}" data-k="${k}" data-v="${act}">${label}</button>`;
    const tgtSel = (side, k, a, names) => `<select data-f="rtgt" data-side="${side}" data-k="${k}" aria-label="대상">
      <option value="">(대상)</option>${names.map((n, t) => (n ? `<option value="${t}"${a.target === t ? ' selected' : ''}>→ ${n}</option>` : '')).join('')}
      <option value="spread"${a.target === 'spread' ? ' selected' : ''}>→ 전체</option></select>`;
    const hpBox = (side, k, a) => {
      const e = expectHp(R, side, k);
      return `<label>남은 HP<input type="number" min="0" max="100" data-f="rhp" data-side="${side}" data-k="${k}" value="${a.hp}">%</label>${e ? `<span class="mini">예상 ${e[0]}~${e[1]}% <button class="link" data-f="rexp" data-side="${side}" data-k="${k}" data-v="${Math.round((e[0] + e[1]) / 2)}">넣기</button></span>` : ''}`;
    };
    const myNames = S.me.map(s => (s.id ? nm(s.id) : ''));
    const oppNames = S.opp.map(s => (s.id ? nm(s.id) : ''));
    const oppRows = S.opp.map((s, j) => {
      const a = draft.opp[j];
      if (!s.id || !a) return '';
      const I = B.oppInfo(s.id);
      const known = B.oppSetOf(s).moves.filter(Boolean);
      const list = [...new Set([...known, ...I.moves.slice(0, 10).map(x => x[0])])];
      const pctOf = m => { const x = I.moves.find(y => y[0] === m); return x && x[1] ? ` ${x[1].toFixed(0)}%` : ''; };
      return `<div class="rrow"><b>${nm(s.id)}</b>
        <span class="segs">${btn('opp', j, 'attack', '공격·기타', a.act)}${btn('opp', j, 'protect', '방어', a.act)}${btn('opp', j, 'switch', '교체', a.act)}${btn('opp', j, 'faint', '쓰러짐', a.act)}</span>
        ${a.act === 'attack' ? `<select data-f="rmove" data-side="opp" data-k="${j}"><option value="">(기술 모름)</option>${list.map(m => `<option value="${esc(m)}"${m === a.move ? ' selected' : ''}>${esc(M.moveKo(m))}${pctOf(m)}</option>`).join('')}</select>${tgtSel('opp', j, a, myNames)}` : ''}
        ${a.act === 'switch' || a.act === 'faint' ? `<select data-f="rto" data-side="opp" data-k="${j}"><option value="">${a.act === 'faint' ? '(다음에 나온 포켓몬)' : '(누구로?)'}</option>${oppBack.map(id => `<option value="${id}"${id === a.to ? ' selected' : ''}>${nm(id)}</option>`).join('')}</select>` : ''}
        ${a.act !== 'faint' && a.act !== 'switch' ? hpBox('opp', j, a) : ''}
        ${(a.act === 'switch' || a.act === 'faint') && a.to ? `<label>들어온 쪽 HP<input type="number" min="0" max="100" data-f="rnew" data-side="opp" data-k="${j}" value="${a.newHp}">%</label>` : ''}
      </div>`;
    }).join('');
    const myRows = S.me.map((s, i) => {
      const a = draft.me[i];
      if (!s.id || !a) return '';
      const set = mySetOf(s.id);
      return `<div class="rrow"><b>${nm(s.id)}</b>
        <span class="segs">${btn('me', i, 'attack', '공격·기타', a.act)}${btn('me', i, 'protect', '방어', a.act)}${btn('me', i, 'switch', '교체', a.act)}${btn('me', i, 'faint', '쓰러짐', a.act)}</span>
        ${a.act === 'attack' && set ? `<select data-f="rmove" data-side="me" data-k="${i}"><option value="">(기술)</option>${set.moves.filter(Boolean).map(m => `<option value="${esc(m)}"${m === a.move ? ' selected' : ''}>${esc(M.moveKo(m))}</option>`).join('')}</select>${tgtSel('me', i, a, oppNames)}` : ''}
        ${a.act === 'switch' || a.act === 'faint' ? `<select data-f="rto" data-side="me" data-k="${i}"><option value="">${a.act === 'faint' ? '(다음에 낸 포켓몬)' : '(누구로?)'}</option>${myBack.map(id => `<option value="${id}"${id === a.to ? ' selected' : ''}>${nm(id)}</option>`).join('')}</select>` : ''}
        ${a.act !== 'faint' && a.act !== 'switch' ? hpBox('me', i, a) : ''}
      </div>`;
    }).join('');
    return `<div class="turnres">
      <h3>${S.turn}턴 결과 기록 <span class="mini">— 내 쪽은 추천 1순위, 상대 쪽은 예상 행동으로 미리 채워져 있어요. 실제와 다른 곳만 고치고 남은 HP를 적은 뒤 저장하세요</span></h3>
      <div class="rcols"><div><h4>상대</h4>${oppRows}</div><div><h4>나</h4>${myRows}</div></div>
      <button class="btn primary" data-f="rsave">결과 저장 → ${S.turn + 1}턴</button>
    </div>`;
  }

  function historyBox() {
    if (!S.history.length) return '';
    let hit = 0, n = 0, follow = 0, fn = 0;
    const T2 = {attack: '공격', protect: '방어', switch: '교체', faint: '쓰러짐'};
    const tname = (h, side, t) => (t === 'spread' ? '전체' : t === '' || t == null ? '' : nm((side === 'me' ? h.oppIds : h.meIds)[t] || ''));
    const actText = (h, side, x) => {
      if (x.act === 'switch') return `교체 → ${nm(x.to)}`;
      if (x.act === 'faint') return `쓰러짐${x.to ? ' → ' + nm(x.to) : ''}`;
      if (x.act === 'protect') return '방어';
      const t = tname(h, side, x.target);
      return x.move ? `${esc(M.moveKo(x.move))}${t ? ' → ' + t : ''}` : '공격';
    };
    const rows = S.history.slice().reverse().map(h => {
      const opp = (h.opp || []).map(o => {
        let mark = '';
        if (o.pred && o.actual.act !== 'faint') {
          n++;
          const ok = o.pred.likely === o.actual.act && (o.actual.act !== 'switch' || !o.pred.switchTo || o.pred.switchTo === o.actual.to);
          if (ok) hit++;
          mark = ` <span class="${ok ? 'good' : 'bad'}">${ok ? '✓' : '✗'}</span><span class="mini">(예측 ${T2[o.pred.likely]}${o.pred.likely !== 'attack' ? ' ' + Math.round((o.pred.likely === 'switch' ? o.pred.pS : o.pred.pP) * 100) + '%' : ''})</span>`;
        }
        return `${nm(o.id)} ${actText(h, 'opp', o.actual)}${mark}`;
      }).join(' · ');
      const mine = (h.me || []).map(m => `${nm(m.id)} ${actText(h, 'me', m)}`).join(' · ');
      if (h.followed != null) { fn++; if (h.followed) follow++; }
      return `<li><b>${h.turn}턴</b> <span class="mini">상대</span> ${opp}<br><span class="mini">나</span> ${mine}${h.followed != null ? ` <span class="mini">${h.followed ? '(추천 1순위대로)' : '(추천과 다르게)'}</span>` : ''}</li>`;
    }).join('');
    return `<details class="mrank" open><summary>배틀 기록 · 상대 행동 예측 적중 ${hit}/${n}${fn ? ` · 추천대로 한 턴 ${follow}/${fn}` : ''}</summary><ul class="histl">${rows}</ul></details>`;
  }

  function saveResult() {
    const R = lastR;
    // HP 0으로 적은 포켓몬은 쓰러짐으로
    for (const side of ['opp', 'me']) for (const a of draft[side]) if (a && a.act !== 'switch' && a.act !== 'faint' && a.hp <= 0) a.act = 'faint';
    const entry = {turn: S.turn, opp: [], me: [], meIds: S.me.map(s => s.id), oppIds: S.opp.map(s => s.id)};
    // 추천 1순위대로 했는지
    if (draft.rec) {
      const top = R && R.top[0];
      entry.followed = !!top && S.me.every((s, i) => {
        const a = draft.me[i], r = top.acts[i];
        if (!s.id || !a || !r || r.kind === 'none') return true;
        if (r.kind === 'protect') return a.act === 'protect';
        if (r.kind === 'switch') return a.act === 'switch' && R.bench[r.to] && a.to === R.bench[r.to].id;
        return a.act === 'attack' && a.move === r.move && (r.kind !== 'attack' || tgtOf(r.target) === a.target || a.target === '');
      });
    }
    S.opp.forEach((s, j) => {
      const a = draft.opp[j];
      if (!s.id || !a) return;
      const d = R && R.defense[j];
      entry.opp.push({id: s.id, actual: {act: a.act, move: a.move, target: a.target, to: a.to},
        pred: d ? {pA: d.pA, pP: d.pP, pS: d.pS, switchTo: d.switchTo ? d.switchTo.id : null, likely: likelyOf(d)} : null});
      if (a.act === 'switch' || a.act === 'faint') {
        if (a.act === 'faint') { if (!S.oppOut.includes(s.id)) S.oppOut.push(s.id); S.oppHp[s.id] = 0; }
        else S.oppHp[s.id] = s.hpPct;
        S.opp[j] = a.to ? {...blankSlot(), id: a.to, hpPct: a.newHp ?? S.oppHp[a.to] ?? 100, fresh: true} : blankSlot();
      } else {
        s.hpPct = a.hp; s.fresh = false; s.protected = a.act === 'protect';
        if (a.act === 'attack' && a.move) {  // 본 기술은 확인된 기술로
          const cur = B.oppSetOf(s).moves.filter(Boolean);
          s.moves = cur.includes(a.move) ? cur : [a.move, ...cur].slice(0, 4);
        }
      }
    });
    S.me.forEach((s, i) => {
      const a = draft.me[i];
      if (!s.id || !a) return;
      entry.me.push({id: s.id, act: a.act, move: a.move, target: a.target, to: a.to});
      if (a.act === 'switch' || a.act === 'faint') {
        if (a.act === 'faint') { S.bench = S.bench.filter(x => x !== s.id); S.benchHp[s.id] = 0; }
        else { S.benchHp[s.id] = s.hpPct; if (!S.bench.includes(s.id)) S.bench.push(s.id); }
        S.me[i] = a.to ? {...blankSlot(), id: a.to, hpPct: S.benchHp[a.to] ?? 100, fresh: true} : blankSlot();
        if (a.to) S.bench = S.bench.filter(x => x !== a.to);
      } else {
        s.hpPct = a.hp; s.fresh = false; s.protected = a.act === 'protect';
      }
    });
    S.history.push(entry);
    S.turn++;
    note = `${entry.turn}턴 결과를 저장했어요. 랭크·날씨·필드가 바뀌었다면 위에서 고쳐 주세요.`;
    draft = null;
    save(); render();
  }

  function results() {
    const st = toState();
    if (!st.me.some(Boolean) || !st.opp.some(Boolean)) return '<p class="mini">내 포켓몬과 상대 포켓몬을 한 마리 이상 넣으면 추천이 나옵니다.</p>';
    const R = B.advise(st);
    window.__pcBattle = R;
    lastR = R;
    const pct = x => `${Math.round(x * 100)}%`;
    const pred = R.oppPred.filter(Boolean).map(p => {
      const o = nm(R.opps[p.j].set.id);
      const d = R.defense[p.j];
      let atk;
      if (!p.move) atk = '공격기 없음';
      else if (p.redirect) atk = `<b>${esc(M.moveKo(p.move))}</b> (우리 단일 공격을 끌어감)`;
      else atk = `<b>${esc(M.moveKo(p.move))}</b> → ${p.target === 'spread' ? '우리 전체' : nm(R.mine[p.target].set.id)}${p.like != null && p.like < 1 ? ` <span class="mini">(이 기술을 가졌을 가능성 ${pct(p.like)})</span>` : ''}${p.alts && p.alts.length ? ` <span class="mini">또는 ${p.alts.map(a => esc(M.moveKo(a.move))).join(', ')}</span>` : ''}`;
      const def = d && (d.pP > 0 || d.pS > 0) ? `<br><span class="mini">공격 ${pct(d.pA)}${d.pP > 0 ? ` · 방어 ${pct(d.pP)}` : ''}${d.pS > 0 ? ` · <b>교체 ${pct(d.pS)} → ${nm(d.switchTo.id)}</b>` : ''}${d.why.length ? ` (이유: ${d.why.join(', ')})` : ''}</span>` : '';
      return `<li>${o}: ${atk}${def}</li>`;
    }).join('');
    const order = [];
    R.mine.forEach((m, i) => m && order.push({n: nm(m.set.id), s: R.speeds.me[i], me: true}));
    R.opps.forEach((o, j) => o && order.push({n: nm(o.set.id), s: R.speeds.opp[j], me: false}));
    order.sort((a, b) => (R.trickRoom ? a.s - b.s : b.s - a.s));
    const top = R.top.map((c, k) => `<div class="bt-rec${k === 0 ? ' first' : ''}">
      <div class="bt-rec-h"><span class="tag">${k + 1}순위</span>${c.acts.map((a, i) => (R.mine[i] ? `<span>${nm(R.mine[i].set.id)}: ${actText(a, R, c, i)}</span>` : '')).join('')}</div>
      <ul>${logText(c, R).map(l => `<li>${l}</li>`).join('')}${c.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
      ${ifElse(c, R)}
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
      ${resultForm(R)}
      ${historyBox()}
      <details class="mrank"><summary>데미지표 보기 (%)</summary><h4>내가 주는 피해</h4><div class="bt-grids">${grid}</div><h4>내가 받는 피해</h4><div class="bt-grids">${inc}</div></details>`;
  }

  function render() {
    prefill();
    $('p-battle').innerHTML = `${fieldBar()}
      <div class="card board">
        <div class="board-grid">${oppBox(0)}${oppBox(1)}${myBox(0)}${myBox(1)}</div>
        ${backRow()}
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
      case 'rmove': draft[side][k].move = el.value; renderResults(); return;
      case 'rtgt': draft[side][k].target = el.value === 'spread' ? 'spread' : el.value === '' ? '' : +el.value; renderResults(); return;
      case 'rto': draft[side][k].to = el.value; renderResults(); return;
      case 'rhp': draft[side][k].hp = Math.max(0, Math.min(100, Math.round(+el.value || 0))); if (draft[side][k].hp === 0) { draft[side][k].act = 'faint'; renderResults(); } return;
      case 'rnew': draft.opp[k].newHp = Math.max(0, Math.min(100, Math.round(+el.value || 0))); return;
      default: return;
    }
    draft = null;  // 필드가 바뀌면 결과 입력 초기화
    save();
    if (full) render(); else renderResults();
  }
  root.addEventListener('change', onChange);
  root.addEventListener('input', e => { if (['hp', 'bhp', 'opick'].includes(e.target.dataset.f)) onChange(e); });
  root.addEventListener('click', e => {
    const b = e.target.closest('button[data-f]');
    if (!b) return;
    const f = b.dataset.f, k = +b.dataset.k;
    if (f === 'oquick') {
      const id = b.dataset.v, old = S.opp[k].id;
      if (old && old !== id) S.oppHp[old] = S.opp[k].hpPct;  // 들어갔다 나온 상대 HP 기억
      if (old !== id) { S.opp[k] = {...blankSlot(), id, hpPct: S.oppHp[id] ?? 100}; applyEntry(); }
      pickOpen['opp' + k] = false;
    }
    if (f === 'mquick') {
      const id = b.dataset.v, old = S.me[k].id;
      if (old !== id) {
        if (old) { S.benchHp[old] = S.me[k].hpPct; if (!S.bench.includes(old) && S.me[k].hpPct > 0) S.bench = [...S.bench, old].slice(-2); }
        S.bench = S.bench.filter(x => x !== id);
        S.me[k] = {...blankSlot(), id, hpPct: S.benchHp[id] ?? 100};
        applyEntry();
      }
      pickOpen['me' + k] = false;
    }
    if (f === 'pickopen') { pickOpen[b.dataset.v] = !pickOpen[b.dataset.v]; render(); return; }
    if (f === 'tog') { const sl = b.dataset.side === 'me' ? S.me[k] : S.opp[k]; sl[b.dataset.v] = !sl[b.dataset.v]; draft = null; save(); b.dataset.v === 'fresh' ? render() : (b.classList.toggle('on'), renderResults()); return; }
    if (f === 'ftog') {
      const v = b.dataset.v;
      if (v === 'tr') S.field.trickRoom = !S.field.trickRoom;
      if (v === 'twme') S.field.tailwind.me = !S.field.tailwind.me;
      if (v === 'twopp') S.field.tailwind.opp = !S.field.tailwind.opp;
      draft = null; save(); b.classList.toggle('on'); renderResults(); return;
    }
    if (f === 'benchtog') { const id = b.dataset.v; S.bench = S.bench.includes(id) ? S.bench.filter(x => x !== id) : [...S.bench, id].slice(-2); }
    if (f === 'ract') {
      const side = b.dataset.side, a = draft[side][k];
      a.act = b.dataset.v;
      if ((a.act === 'switch' || a.act === 'faint') && side === 'me' && !a.to) a.to = S.bench.find(id => !S.me.some(s => s.id === id)) || '';
      renderResults(); return;
    }
    if (f === 'rsave') { saveResult(); return; }
    if (f === 'rexp') { const a = draft[b.dataset.side][k]; a.hp = +b.dataset.v; if (a.hp <= 0) a.act = 'faint'; renderResults(); return; }
    if (f === 'oout') { const id = b.dataset.v; S.oppOut = S.oppOut.includes(id) ? S.oppOut.filter(x => x !== id) : [...S.oppOut, id]; }
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
      // 쓰러진 상대(HP 0)는 뒤 목록에서도 제외
      S.opp.forEach(s => { if (s.id && s.hpPct <= 0 && !S.oppOut.includes(s.id)) S.oppOut.push(s.id); });
      note = '다음 턴: "방금 나옴"을 해제했어요. HP·랭크·필드를 바꾸고, 교체된 포켓몬은 다시 고르세요.';
    }
    if (f === 'reset') { S = blankState(); note = ''; draft = null; }
    if (f === 'next') draft = null;
    save(); render();
  });

  return {render};
}
