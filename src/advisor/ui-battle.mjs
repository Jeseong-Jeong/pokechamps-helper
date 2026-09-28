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
      <label class="chk"><input type="checkbox" data-f="protected" data-side="${side}" data-k="${k}"${s.protected ? ' checked' : ''}> 지난 턴 방어</label>
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

  function oppBenchBox() {
    const ids = getOppIds().filter(id => !S.opp.some(o => o.id === id));
    if (!ids.length) return '<p class="mini">선출 추천 탭에 상대 6마리를 넣으면, 상대가 교체할 만한 포켓몬도 예측합니다.</p>';
    return `<div class="bench"><span class="mini">상대 뒤에 있을 수 있음 (교체 예측에 사용 · 누르면 쓰러짐/안 나옴으로 제외)</span>${ids.map(id => {
      const out = S.oppOut.includes(id);
      return `<button class="uchip${out ? '' : ' on'}" data-f="oout" data-v="${id}">${nm(id)}${out ? ' (제외)' : ''}</button>`;
    }).join('')}</div>`;
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
  function makeDraft(R) {
    return {
      opp: S.opp.map((s, j) => {
        if (!s.id) return null;
        const d = R && R.defense[j], p = R && R.oppPred[j];
        return {act: 'attack', move: p && p.move && !p.redirect ? p.move : (p && p.move) || '', to: d && d.switchTo ? d.switchTo.id : '', hp: s.hpPct, newHp: 100};
      }),
      me: S.me.map(s => (s.id ? {act: 'attack', to: '', hp: s.hpPct} : null)),
    };
  }
  function resultForm(R) {
    if (!draft) draft = makeDraft(R);
    const oppBack = getOppIds().filter(id => !S.opp.some(o => o.id === id) && !S.oppOut.includes(id));
    const myBack = S.bench.filter(id => !S.me.some(s => s.id === id));
    const btn = (side, k, act, label, cur) => `<button class="seg${cur === act ? ' on' : ''}" data-f="ract" data-side="${side}" data-k="${k}" data-v="${act}">${label}</button>`;
    const oppRows = S.opp.map((s, j) => {
      const a = draft.opp[j];
      if (!s.id || !a) return '';
      const I = B.oppInfo(s.id);
      return `<div class="rrow"><b>${nm(s.id)}</b>
        <span class="segs">${btn('opp', j, 'attack', '공격', a.act)}${btn('opp', j, 'protect', '방어', a.act)}${btn('opp', j, 'switch', '교체', a.act)}${btn('opp', j, 'faint', '쓰러짐', a.act)}</span>
        ${a.act === 'attack' ? `<select data-f="rmove" data-side="opp" data-k="${j}"><option value="">(기술 모름)</option>${I.moves.slice(0, 10).map(([m, p]) => `<option value="${esc(m)}"${m === a.move ? ' selected' : ''}>${esc(M.moveKo(m))} ${p ? p.toFixed(0) + '%' : ''}</option>`).join('')}</select>` : ''}
        ${a.act === 'switch' || a.act === 'faint' ? `<select data-f="rto" data-side="opp" data-k="${j}"><option value="">${a.act === 'faint' ? '(다음에 나온 포켓몬)' : '(누구로?)'}</option>${oppBack.map(id => `<option value="${id}"${id === a.to ? ' selected' : ''}>${nm(id)}</option>`).join('')}</select>` : ''}
        ${a.act !== 'faint' && a.act !== 'switch' ? `<label>남은 HP<input type="number" min="0" max="100" data-f="rhp" data-side="opp" data-k="${j}" value="${a.hp}">%</label>` : ''}
        ${(a.act === 'switch' || a.act === 'faint') && a.to ? `<label>들어온 쪽 HP<input type="number" min="0" max="100" data-f="rnew" data-side="opp" data-k="${j}" value="${a.newHp}">%</label>` : ''}
      </div>`;
    }).join('');
    const myRows = S.me.map((s, i) => {
      const a = draft.me[i];
      if (!s.id || !a) return '';
      return `<div class="rrow"><b>${nm(s.id)}</b>
        <span class="segs">${btn('me', i, 'attack', '공격·기타', a.act)}${btn('me', i, 'protect', '방어', a.act)}${btn('me', i, 'switch', '교체', a.act)}${btn('me', i, 'faint', '쓰러짐', a.act)}</span>
        ${a.act === 'switch' || a.act === 'faint' ? `<select data-f="rto" data-side="me" data-k="${i}"><option value="">${a.act === 'faint' ? '(다음에 낸 포켓몬)' : '(누구로?)'}</option>${myBack.map(id => `<option value="${id}"${id === a.to ? ' selected' : ''}>${nm(id)}</option>`).join('')}</select>` : ''}
        ${a.act !== 'faint' && a.act !== 'switch' ? `<label>남은 HP<input type="number" min="0" max="100" data-f="rhp" data-side="me" data-k="${i}" value="${a.hp}">%</label>` : ''}
      </div>`;
    }).join('');
    return `<div class="turnres">
      <h3>${S.turn}턴 결과 기록 <span class="mini">— 실제로 일어난 일을 누르면 다음 턴 필드가 자동으로 바뀌고, 배틀 기록에 예측과 함께 남습니다</span></h3>
      <div class="rcols"><div><h4>상대</h4>${oppRows}</div><div><h4>나</h4>${myRows}</div></div>
      <button class="btn primary" data-f="rsave">결과 저장 → ${S.turn + 1}턴</button>
    </div>`;
  }

  function historyBox() {
    if (!S.history.length) return '';
    let hit = 0, n = 0;
    const T2 = {attack: '공격', protect: '방어', switch: '교체', faint: '쓰러짐'};
    const rows = S.history.slice().reverse().map(h => `<li><b>${h.turn}턴</b> ${(h.opp || []).map(o => {
      const act = o.actual.act === 'switch' ? `교체 → ${nm(o.actual.to)}` : o.actual.act === 'attack' ? `공격${o.actual.move ? '(' + esc(M.moveKo(o.actual.move)) + ')' : ''}` : T2[o.actual.act];
      let mark = '';
      if (o.pred && o.actual.act !== 'faint') {
        n++;
        const ok = o.pred.likely === o.actual.act && (o.actual.act !== 'switch' || !o.pred.switchTo || o.pred.switchTo === o.actual.to);
        if (ok) hit++;
        mark = ` <span class="${ok ? 'good' : 'bad'}">${ok ? '✓' : '✗'}</span> <span class="mini">예측 ${T2[o.pred.likely]}${o.pred.likely !== 'attack' ? ' ' + Math.round((o.pred.likely === 'switch' ? o.pred.pS : o.pred.pP) * 100) + '%' : ''}</span>`;
      }
      return `${nm(o.id)}: ${act}${mark}`;
    }).join(' · ')}${h.me && h.me.length ? ` <span class="mini">| 나: ${h.me.map(m => `${nm(m.id)} ${T2[m.act]}${m.to ? '→' + nm(m.to) : ''}`).join(', ')}</span>` : ''}</li>`).join('');
    return `<details class="mrank" open><summary>배틀 기록 · 예측 적중 ${hit}/${n}</summary><ul class="histl">${rows}</ul></details>`;
  }

  function saveResult() {
    const R = lastR;
    const entry = {turn: S.turn, opp: [], me: []};
    S.opp.forEach((s, j) => {
      const a = draft.opp[j];
      if (!s.id || !a) return;
      const d = R && R.defense[j];
      entry.opp.push({id: s.id, actual: {act: a.act, move: a.move, to: a.to},
        pred: d ? {pA: d.pA, pP: d.pP, pS: d.pS, switchTo: d.switchTo ? d.switchTo.id : null, likely: likelyOf(d)} : null});
      if (a.act === 'switch' || a.act === 'faint') {
        if (a.act === 'faint') { if (!S.oppOut.includes(s.id)) S.oppOut.push(s.id); S.oppHp[s.id] = 0; }
        else S.oppHp[s.id] = s.hpPct;
        S.opp[j] = a.to ? {...blankSlot(), id: a.to, hpPct: a.newHp ?? S.oppHp[a.to] ?? 100, fresh: true} : blankSlot();
      } else {
        s.hpPct = a.hp; s.fresh = false; s.protected = a.act === 'protect';
        if (a.act === 'attack' && a.move) {  // 본 기술은 확인된 기술로
          const cur = B.oppSetOf(s).moves.filter(Boolean);
          if (!cur.includes(a.move)) s.moves = [a.move, ...cur].slice(0, 4);
          else s.moves = cur;
        }
      }
    });
    S.me.forEach((s, i) => {
      const a = draft.me[i];
      if (!s.id || !a) return;
      entry.me.push({id: s.id, act: a.act, to: a.to});
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
      <div class="grid bt-sides">
        <div class="card"><h3>내 필드</h3>${mySlot(0)}${mySlot(1)}${benchBox()}</div>
        <div class="card"><h3>상대 필드</h3>${oppSlot(0)}${oppSlot(1)}${oppBenchBox()}</div>
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
      case 'rmove': draft.opp[k].move = el.value; return;
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
    if (f === 'oquick') { S.opp[k] = {...blankSlot(), id: b.dataset.v}; applyEntry(); }
    if (f === 'ract') {
      const side = b.dataset.side, a = draft[side][k];
      a.act = b.dataset.v;
      if ((a.act === 'switch' || a.act === 'faint') && side === 'me' && !a.to) a.to = S.bench.find(id => !S.me.some(s => s.id === id)) || '';
      renderResults(); return;
    }
    if (f === 'rsave') { saveResult(); return; }
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
