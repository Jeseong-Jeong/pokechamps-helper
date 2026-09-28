// 팀 추천 탭 화면
import {ROLES} from './team.mjs';

const STORE = 'pc-team-v1';
const ROLE_ORDER = ['fakeout', 'speed', 'intimidate', 'redirect', 'setter', 'spread'];

export function initTeam({M, T, ty, esc, $, findMon, onSendToCalc, onChange}) {
  const {byId, D} = M;
  // ids: 원래 모습 id 6개까지, custom: {원래 id: 직접 넣은 세트} (스크린샷 불러오기 등)
  let {ids, custom} = load();

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
    if (!set) {
      return `<div class="slot empty">
        <input class="pick" list="mon-list" data-k="add" placeholder="${i === ids.length ? '포켓몬 추가 (이름 검색)' : ''}" aria-label="팀 ${i + 1}번 추가" autocomplete="off"${i === ids.length ? '' : ' disabled'}>
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
        <button class="link" data-k="calc" data-i="${i}">데미지 계산 →</button>
        ${set.custom ? `<button class="link" data-k="uncustom" data-i="${i}">기본 세트로</button>` : ''}
        <button class="link danger" data-k="remove" data-i="${i}">빼기</button>
      </div>
    </div>`;
  }
  const abKo = (e, en) => { const a = e.ab.find(x => x.en === en); return a ? (a.ko || a.en) : en; };

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
    const roles = ROLE_ORDER.map(k => {
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
    if (!A.roles.fakeout.length && !A.roles.speed.length) notes.push('속이다·스피드 조절 담당이 없어 선공을 잡기 어렵습니다.');
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
  root.addEventListener('change', ev => {
    if (ev.target.dataset.k !== 'add') return;
    const id = findMon(ev.target.value);
    if (id && ids.includes(T.baseOf(id))) return;  // input 이벤트에서 이미 추가됨
    $('team-msg').textContent = id ? add(id) : '목록에서 포켓몬을 골라 주세요.';
  });
  root.addEventListener('input', ev => {  // 목록에서 고르면 바로 추가
    if (ev.target.dataset.k !== 'add') return;
    const id = findMon(ev.target.value);
    if (id) $('team-msg').textContent = add(id);
  });
  root.addEventListener('click', ev => {
    const b = ev.target.closest('button[data-k]');
    if (!b) return;
    const k = b.dataset.k;
    if (k === 'pick') $('team-msg').textContent = add(b.dataset.id);
    if (k === 'remove') setIds(ids.filter((_, i) => i !== +b.dataset.i));
    if (k === 'calc') onSendToCalc(getSets()[+b.dataset.i]);
    if (k === 'uncustom') { delete custom[ids[+b.dataset.i]]; save(); render(); onChange && onChange(); }
    if (k === 'auto') { setIds(T.autoFill(ids)); $('team-msg').textContent = ''; }
    if (k === 'clear') { setIds([]); $('team-msg').textContent = ''; }
  });

  render();
  return {
    getIds: () => ids.slice(), getSets,
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
