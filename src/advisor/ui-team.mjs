// 팀 추천 탭 화면
import {skey} from './store.mjs';
import {NATURES, STATS, STAT_KO, SP_MAX, SP_TOTAL} from './model.mjs';


const STORE = skey('pc-team-v1');


export function initTeam({M, T, ty, esc, $, findMon, onSendToCalc, onChange}) {
  const {byId, D} = M;
  // ids: 원래 모습 id 6개까지, custom: {원래 id: 직접 넣은 세트} (스크린샷 불러오기 등)
  let {ids, custom} = load();
  let editing = null;  // 세트 수정 중: {i, set}
  const NATURE_ORDER = ['Adamant', 'Jolly', 'Brave', 'Modest', 'Timid', 'Quiet', 'Bold', 'Impish', 'Relaxed', 'Calm', 'Careful', 'Sassy',
                        'Lonely', 'Naughty', 'Hasty', 'Naive', 'Mild', 'Rash', 'Gentle', 'Lax', 'Serious', 'Hardy', 'Docile', 'Bashful', 'Quirky'];
  const STONE = /ite( [XYZ])?$/;

  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE));
      const list = Array.isArray(v) ? v : v && v.ids;  // 예전 형식은 id 배열
      if (Array.isArray(list)) {
        const c = (v && v.custom) || {};
        return {ids: list.filter(id => byId[id]).slice(0, 6), custom: Object.fromEntries(Object.entries(c).filter(([k, x]) => byId[k] && x && byId[x.id]))};
      }
    } catch (e) { /* 저장값 없음 */ }
    return {ids: [], custom: {}};
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify({ids, custom})); } catch (e) { /* 저장 불가 */ } }
  function setIds(next) {
    ids = next.map(T.baseOf).slice(0, 6);
    for (const k of Object.keys(custom)) if (!ids.includes(k)) delete custom[k];
    save(); render(); onChange && onChange();
  }
  // 기본 세트(아이템 클로즈 반영) 위에 직접 넣은 세트를 덮어씀
  function getSets() {
    return T.teamSets(ids).map((s, i) => (custom[ids[i]] ? {...custom[ids[i]], baseId: ids[i], custom: true} : s));
  }

  function add(id) {
    id = T.baseOf(id);
    const no = byId[id].no;
    if (ids.length >= 6) return '팀이 이미 6마리입니다.';
    if (ids.some(x => byId[x].no === no)) return '같은 도감번호의 포켓몬은 한 마리만 넣을 수 있습니다.';
    setIds(ids.concat(id));
    return '';
  }

  // ---------------- 그리기 ----------------
  function render() {
    const A = ids.length ? T.analyze(ids, getSets()) : null;
    $('team-slots').innerHTML = [0, 1, 2, 3, 4, 5].map(i => slot(i, A && A.sets[i])).join('');
    $('team-count').textContent = `${ids.length} / 6`;
    $('team-cands').innerHTML = ids.length < 6 ? candList() : '<p class="mini">팀이 다 찼습니다. 멤버를 빼면 다시 추천합니다.</p>';
    $('team-analysis').innerHTML = A ? analysis(A) : '<p class="mini">포켓몬을 넣으면 팀 약점과 역할을 분석합니다.</p>';
  }

  function slot(i, set) {
    if (set && editing && editing.i === i) return editor(i, editing.set);
    if (!set) {
      return `<div class="slot empty">
        <input class="pick" list="base-list" data-k="add" placeholder="${i === ids.length ? '포켓몬 추가 (이름 검색)' : ''}" aria-label="팀 ${i + 1}번 추가" autocomplete="off"${i === ids.length ? '' : ' disabled'}>
      </div>`;
    }
    const base = byId[set.baseId], e = byId[set.id];
    const u = M.usageOf(base);
    return `<div class="slot" data-i="${i}">
      <div class="slot-h"><b>${esc(base.ko)}</b>${set.id !== set.baseId ? `<span class="badge b-mega">${esc(e.ko)}</span>` : ''}${set.custom ? '<span class="badge b-mine">내 세트</span>' : ''}
        ${u ? `<span class="mini">${u.rank}위</span>` : ''}</div>
      <div class="types">${e.ty.map(ty).join('')}</div>
      <dl class="setl">
        <dt>도구</dt><dd>${esc(set.item ? M.itemKo(set.item) : '없음')}</dd>
        <dt>특성</dt><dd>${esc(abKo(e, set.ability))}</dd>
        <dt>기술</dt><dd>${set.moves.filter(Boolean).map(n => esc(M.moveKo(n))).join(', ')}</dd>
        ${set.custom ? `<dt>성격</dt><dd>${esc(D.natureko[set.nature] || set.nature)} · SP ${['hp', 'atk', 'def', 'spa', 'spd', 'spe'].map(k => set.sp[k] || 0).join('-')}</dd>` : ''}
      </dl>
      <div class="slot-a">
        <button class="link" data-k="edit" data-i="${i}">세트 수정</button>
        <button class="link" data-k="calc" data-i="${i}">데미지 계산 →</button>
        ${set.custom ? `<button class="link" data-k="uncustom" data-i="${i}">기본 세트로</button>` : ''}
        <button class="link danger" data-k="remove" data-i="${i}">빼기</button>
      </div>
    </div>`;
  }
  const abKo = (e, en) => { const a = e.ab.find(x => x.en === en); return a ? (a.ko || a.en) : en; };

  // ---------------- 세트 수정 (스크린샷으로 불러온 뒤, 팀 진단 추천대로 직접 고칠 때) ----------------
  function editor(i, set) {
    const base = byId[set.baseId], e = byId[set.id], u = M.usageOf(base);
    const pct = p => (p ? ` ${p.toFixed(0)}%` : '');
    const mvPct = new Map(u ? u.mv.map(([m, p]) => [typeof m === 'number' ? D.moves[m].en : m, p]) : []);
    const moves = M.learnset(e).sort((a, b) => (mvPct.get(b.en) || 0) - (mvPct.get(a.en) || 0) || (a.ko || a.en).localeCompare(b.ko || b.en, 'ko'));
    const itPct = new Map(u ? u.it : []);
    // 도구: 이 포켓몬이 쓰는 도구(채용률 순) + 전체, 메가스톤은 이 포켓몬 것만
    const own = (base.megas || []).length ? M.items.filter(n => STONE.test(n) && n !== 'Eviolite' && megaOf(base, n)) : [];
    const items = [...new Set([...(u ? u.it.map(x => x[0]) : []), ...own, ...M.items.filter(n => !(STONE.test(n) && n !== 'Eviolite'))])];
    if (set.item && !items.includes(set.item)) items.unshift(set.item);
    const abPct = new Map(u ? u.ab.map(([n, p]) => [n, p]) : []);
    const st = M.finalStats(set);
    const sum = STATS.reduce((a, k) => a + (+set.sp[k] || 0), 0);
    const dupItem = set.item && getSets().some((s, k) => k !== i && s.item === set.item);
    const mark = k => { const [up, down] = NATURES[set.nature] || []; return k === up ? ' up' : k === down ? ' down' : ''; };
    return `<div class="slot editing" data-i="${i}">
      <div class="slot-h"><b>${esc(base.ko)}</b>${set.id !== set.baseId ? `<span class="badge b-mega">${esc(e.ko)}</span>` : ''}<span class="mini">세트 수정</span></div>
      <div class="edit-grid">
        <label>특성<select data-e="ability">${e.ab.map(a => `<option value="${esc(a.en)}"${a.en === set.ability ? ' selected' : ''}>${esc(a.ko || a.en)}${pct(abPct.get(a.en))}</option>`).join('')}</select></label>
        <label>도구<select data-e="item"><option value="">없음</option>${items.map(n => `<option value="${esc(n)}"${n === set.item ? ' selected' : ''}>${esc(M.itemKo(n))}${pct(itPct.get(n))}</option>`).join('')}</select></label>
        ${dupItem ? '<p class="mini bad">다른 멤버와 도구가 겹칩니다 (같은 도구는 한 마리만).</p>' : ''}
        <label>성격<select data-e="nature">${NATURE_ORDER.map(n => { const [up, down] = NATURES[n]; return `<option value="${n}"${n === set.nature ? ' selected' : ''}>${esc(D.natureko[n] || n)} ${up ? `(${STAT_KO[up]}↑ ${STAT_KO[down]}↓)` : '(무보정)'}</option>`; }).join('')}</select></label>
      </div>
      <div class="sp edit-sp">
        <div class="sp-h"><span>능력치</span><span>SP</span><span>실수치</span></div>
        ${STATS.map(k => `<div class="sp-r${mark(k)}"><span>${STAT_KO[k]}</span>
          <input type="number" min="0" max="${SP_MAX}" inputmode="numeric" data-e="sp" data-s="${k}" value="${set.sp[k] || 0}" aria-label="${STAT_KO[k]} SP">
          <b class="num">${k === 'hp' ? st.maxHP : st[k]}</b></div>`).join('')}
        <div class="sp-sum${sum > SP_TOTAL ? ' over' : ''}">SP 합계 <b>${sum}</b> / ${SP_TOTAL}${sum > SP_TOTAL ? ' · 초과' : ''}</div>
      </div>
      <div class="moves">${[0, 1, 2, 3].map(n => `<select data-e="move" data-n="${n}" aria-label="기술 ${n + 1}"><option value="">(비움)</option>${moves.map(m => `<option value="${esc(m.en)}"${m.en === set.moves[n] ? ' selected' : ''}>${esc(m.ko || m.en)}${pct(mvPct.get(m.en))}</option>`).join('')}</select>`).join('')}</div>
      <div class="slot-a">
        <button class="btn sm primary" data-k="esave" data-i="${i}"${sum > SP_TOTAL ? ' disabled' : ''}>저장</button>
        <button class="btn sm" data-k="ecancel">취소</button>
      </div>
    </div>`;
  }
  // 메가스톤 → 이 포켓몬의 메가 모습 (X·Y·Z 맞춤)
  function megaOf(base, stone) {
    const suf = (stone.match(/ ([XYZ])$/) || [])[1];
    const cand = (base.megas || []).filter(m => ((m.match(/ ([XYZ])$/) || [])[1]) === suf);
    if (!cand.length) return null;
    // 스톤 이름이 이 포켓몬 것인지: 사용률 데이터에 있거나 영문 이름 앞부분이 같음
    const u = M.usageOf(base);
    const known = u && u.it.some(([n]) => n === stone);
    const stem = base.en.replace(/[^A-Za-z]/g, '').slice(0, 5).toLowerCase();
    return known || stone.toLowerCase().replace(/[^a-z]/g, '').startsWith(stem) ? cand[0] : null;
  }
  function editChange(el) {
    const s = editing.set, k = el.dataset.e;
    if (k === 'ability') s.ability = el.value;
    if (k === 'nature') s.nature = el.value;
    if (k === 'move') s.moves[+el.dataset.n] = el.value;
    if (k === 'sp') s.sp[el.dataset.s] = Math.max(0, Math.min(SP_MAX, Math.round(+el.value || 0)));
    if (k === 'item') {
      s.item = el.value;
      // 메가스톤을 들면 메가 모습, 빼면 원래 모습 (특성도 맞춤)
      const base = byId[s.baseId], mega = el.value && STONE.test(el.value) && el.value !== 'Eviolite' ? megaOf(base, el.value) : null;
      const next = mega || base.id;
      if (next !== s.id) {
        s.id = next;
        const e = byId[next];
        if (!e.ab.some(a => a.en === s.ability)) {
          const u = M.usageOf(base), top = u && u.ab.find(([n]) => e.ab.some(a => a.en === n));
          s.ability = mega ? e.ab[0].en : (top ? top[0] : e.ab[0].en);
        }
      }
    }
  }

  function candList() {
    const cs = T.candidates(ids, 10);
    const max = Math.max(...cs.map(c => c.score), 1);
    return `<ol class="cands">${cs.map(c => {
      const e = byId[c.id];
      return `<li>
        <div class="cand-h">
          <b>${esc(e.ko)}</b><span class="types">${e.ty.map(ty).join('')}</span>
          <span class="mini">사용률 ${c.rank}위</span>
          <button class="btn sm" data-k="pick" data-id="${esc(c.id)}">추가</button>
        </div>
        <div class="scorebar"><i style="width:${Math.max(4, c.score / max * 100).toFixed(0)}%"></i></div>
        <div class="chips">${c.reasons.slice(0, 5).map(r => `<span class="chip${r.bad ? ' bad' : ''}">${esc(r.text)}</span>`).join('')}</div>
      </li>`;
    }).join('')}</ol>`;
  }

  function analysis(A) {
    const ROLES = T.ROLES;
    const roles = Object.keys(ROLES).map(k => {
      const who = A.roles[k];
      return `<div class="role${who.length ? ' ok' : ' no'}"><span>${who.length ? '✓' : '—'} ${ROLES[k].ko}</span>
        <span class="mini">${who.length ? who.map(id => esc(byId[id].ko)).join(', ') : '없음'}</span></div>`;
    }).join('');
    const danger = A.types.filter(x => x.danger);
    const noHit = T.TYPES.filter(t => !A.hits[t]);
    const typeRows = A.types.map(x => `<tr class="${x.danger ? 'danger' : ''}">
      <td>${ty(x.t)}</td><td class="num">${x.weak || ''}</td><td class="num">${x.resist || ''}</td><td class="num">${x.immune || ''}</td>
      <td class="num">${A.hits[x.t] || '<span class="bad">0</span>'}</td></tr>`).join('');
    const notes = [];
    if (danger.length) notes.push(`<b>${danger.map(x => D.typeko[x.t]).join('·')}</b> 공격에 약한 멤버가 많습니다.`);
    if (noHit.length) notes.push(`기본 기술로 <b>${noHit.map(t => D.typeko[t]).join('·')}</b> 타입을 효과가 굉장하게 칠 수 없습니다.`);
    if (A.megas >= 3) notes.push(`메가진화 세트가 ${A.megas}마리입니다. 배틀당 한 번만 메가진화할 수 있습니다.`);
    if (M.doubles && !A.roles.fakeout.length && !A.roles.speed.length) notes.push('속이다·스피드 조절 담당이 없어 선공을 잡기 어렵습니다.');
    if (!M.doubles) {
      if (!A.roles.setup.length) notes.push('랭크업 에이스(칼춤·용춤 등)가 없어 끝내는 힘이 약할 수 있습니다.');
      if (!A.roles.priority.length && !A.roles.scarf.length) notes.push('선공기·스카프가 없어 빠른 상대를 마무리하기 어렵습니다.');
    }
    return `
      ${notes.length ? `<div class="notes">${notes.map(n => `<p>${n}</p>`).join('')}</div>` : '<div class="notes ok"><p>눈에 띄는 약점이 없습니다.</p></div>'}
      <h4>역할</h4><div class="roles">${roles}</div>
      <h4>스피드 순서 <span class="mini">(기본 배분 기준 실수치)</span></h4>
      <div class="speeds">${A.speeds.map(s => `<span>${esc(byId[s.id].ko)} <b class="num">${s.spe}</b></span>`).join('<span class="mini">›</span>')}</div>
      <h4>타입 상성</h4>
      <div class="tbl"><table class="typetbl"><thead><tr><th>공격 타입</th><th class="num">약점</th><th class="num">반감</th><th class="num">무효</th><th class="num">찌를 수 있는 멤버</th></tr></thead>
      <tbody>${typeRows}</tbody></table></div>`;
  }

  // ---------------- 입력 ----------------
  const root = $('p-team');
  // 세트 수정 이벤트 (팀 탭·팀 진단 탭 공용). 처리했으면 true. rerender: 그 화면을 다시 그리는 함수
  function handleEdit(ev, rerender) {
    const t = ev.target;
    if (!editing) return false;
    if (ev.type === 'input' && t.dataset.e === 'sp') {  // SP 입력 중에는 다시 그리지 않고 실수치·합계만
      editChange(t);
      const box = t.closest('.slot'), s = editing.set, st = M.finalStats(s);
      box.querySelectorAll('.sp-r').forEach((r, n) => { r.querySelector('b').textContent = n === 0 ? st.maxHP : st[STATS[n]]; });
      const sum = STATS.reduce((a, k) => a + (+s.sp[k] || 0), 0), el = box.querySelector('.sp-sum');
      el.className = 'sp-sum' + (sum > SP_TOTAL ? ' over' : '');
      el.innerHTML = `SP 합계 <b>${sum}</b> / ${SP_TOTAL}${sum > SP_TOTAL ? ' · 초과' : ''}`;
      box.querySelector('[data-k=esave]').disabled = sum > SP_TOTAL;
      return true;
    }
    if (ev.type === 'change' && t.dataset.e) { editChange(t); rerender(); return true; }
    if (ev.type === 'click') {
      const b = t.closest('button[data-k]');
      if (!b) return false;
      if (b.dataset.k === 'ecancel') { editing = null; rerender(); return true; }
      if (b.dataset.k === 'esave') {
        const {baseId, custom: _c, ...s} = editing.set;
        custom[ids[editing.i]] = {...s, moves: s.moves.slice(0, 4)};
        editing = null; save(); render(); onChange && onChange();
        $('team-msg').textContent = '세트를 저장했어요. 팀 진단·선출·배틀 도우미에 바로 반영됩니다.';
        return true;
      }
    }
    return false;
  }
  function startEdit(i) {
    const s = getSets()[i];
    if (!s) return;
    editing = {i, set: {...JSON.parse(JSON.stringify(s)), baseId: ids[i]}};
  }

  root.addEventListener('change', ev => {
    if (handleEdit(ev, render)) return;
    if (ev.target.dataset.k !== 'add') return;
    const id = findMon(ev.target.value);
    if (id && ids.includes(T.baseOf(id))) return;  // input 이벤트에서 이미 추가됨
    $('team-msg').textContent = id ? add(id) : '목록에서 포켓몬을 골라 주세요.';
  });
  root.addEventListener('input', ev => {  // 목록에서 고르면 바로 추가
    if (handleEdit(ev, render)) return;
    if (ev.target.dataset.k !== 'add') return;
    const id = findMon(ev.target.value);
    if (id) $('team-msg').textContent = add(id);
  });
  root.addEventListener('click', ev => {
    if (handleEdit(ev, render)) return;
    const b = ev.target.closest('button[data-k]');
    if (!b) return;
    const k = b.dataset.k;
    if (k === 'pick') $('team-msg').textContent = add(b.dataset.id);
    if (k === 'edit') { startEdit(+b.dataset.i); render(); }
    if (k === 'remove') { editing = null; setIds(ids.filter((_, i) => i !== +b.dataset.i)); }
    if (k === 'calc') onSendToCalc(getSets()[+b.dataset.i]);
    if (k === 'uncustom') { delete custom[ids[+b.dataset.i]]; save(); render(); onChange && onChange(); }
    if (k === 'auto') { setIds(T.autoFill(ids)); $('team-msg').textContent = ''; }
    if (k === 'clear') { setIds([]); $('team-msg').textContent = ''; }
  });

  render();
  return {
    getIds: () => ids.slice(), getSets,
    // 세트 수정 (팀 진단 탭에서도 같은 편집창)
    startEdit, handleEdit, isEditing: i => !!editing && editing.i === i, editorFor: i => (editing && editing.i === i ? editor(i, editing.set) : ''),
    // i번 멤버의 세트만 바꿈 (팀 진단 → 세트 다듬기)
    setSet(i, set) {
      if (!ids[i]) return;
      const {baseId, custom: _c, ...s} = set;
      custom[ids[i]] = s; save(); render(); onChange && onChange();
    },
    // i번 멤버를 다른 포켓몬으로 교체 (팀 진단 → 교체 추천)
    replaceAt(i, set) {
      editing = null;
      const base = T.baseOf(set.id);
      if (ids.some((x, k) => k !== i && byId[x].no === byId[base].no)) return;
      delete custom[ids[i]];
      ids[i] = base;
      const {baseId, custom: _c, ...s} = set;
      custom[base] = s; save(); render(); onChange && onChange();
    },
    // 불러온 세트로 팀 전체를 바꿈 (sets: model 세트 형식, id는 메가 형태여도 됨)
    importSets(sets) {
      const next = [], nextCustom = {};
      for (const s of sets) {
        const base = T.baseOf(s.id);
        if (next.length >= 6 || next.some(x => byId[x].no === byId[base].no)) continue;
        next.push(base);
        nextCustom[base] = s;
      }
      ids = next; custom = nextCustom; save(); render(); onChange && onChange();
    },
  };
}
