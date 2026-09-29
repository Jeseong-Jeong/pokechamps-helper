// 추천 봇 페이지 진입점. DATA는 build_advisor.mjs 가 페이지에 넣어 줌
import {skey} from './store.mjs';
import {createModel, STATS, STAT_KO, SP_MAX, SP_TOTAL, NATURES, WEATHER, TERRAIN, STATUS} from './model.mjs';
import {createTeamAdvisor} from './team.mjs';
import {initTeam} from './ui-team.mjs';
import {createPickAdvisor} from './pick.mjs';
import {initPick} from './ui-pick.mjs';
import {initImport} from './ui-import.mjs';
import {createImprover} from './improve.mjs';
import {initImprove} from './ui-improve.mjs';
import {createChat} from './chat.mjs';
import {createBattle} from './battle.mjs';
import {initBattle} from './ui-battle.mjs';

const DATA = window.__DATA__;
const M = createModel(DATA);
const T = createTeamAdvisor(M);
const P = createPickAdvisor(M, T);
const I = createImprover(M, T, P, {natureko: DATA.natureko});
let improveUI = null, battleUI = null;
const {byId} = M;
const TK = DATA.typeko, NK = DATA.natureko;
const TYC = {normal:'#9A9A7C',fire:'#E0662E',water:'#4A7FE0',grass:'#4E9F3D',electric:'#E9C21A',ice:'#6CC3C4',fighting:'#B8322A',poison:'#9243A0',ground:'#C9A24A',flying:'#8C8AE8',psychic:'#E5487A',bug:'#95A11E',rock:'#AD9437',ghost:'#6450A0',dragon:'#5A3CE8',dark:'#5E4A3E',steel:'#8E8EAA',fairy:'#D77FB0'};
const LIGHT = new Set(['electric','ice','ground','normal','steel','fairy','bug','rock','flying']);
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const ty = t => `<span class="ty${LIGHT.has(t) ? ' light' : ''}" style="background:${TYC[t]}">${TK[t]}</span>`;
const tyEn = t => ty(t.toLowerCase());
const SIDE_OPTS = [['helpingHand', '도우미'], ['tailwind', '순풍'], ['reflect', '리플렉터'], ['lightScreen', '빛의장막'],
                   ['auroraVeil', '오로라베일'], ['friendGuard', '프렌드가드']];
const NATURE_ORDER = ['Adamant', 'Jolly', 'Brave', 'Modest', 'Timid', 'Quiet', 'Bold', 'Impish', 'Relaxed', 'Calm', 'Careful', 'Sassy',
                      'Lonely', 'Naughty', 'Hasty', 'Naive', 'Mild', 'Rash', 'Gentle', 'Lax', 'Serious', 'Hardy', 'Docile', 'Bashful', 'Quirky'];

// ---------------- 상태 ----------------
const STORE = skey('pc-advisor-v1');
const blankField = () => ({doubles: M.doubles, weather: '', terrain: '', crit: false, L: {}, R: {}});
let S = load() || {L: M.defaultSet('Rillaboom'), R: M.defaultSet('Incineroar'), field: blankField()};
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (s && byId[s.L?.id] && byId[s.R?.id]) return s;
  } catch (e) { /* 저장값 없음 */ }
  return null;
}
function save() { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { /* 저장 불가 환경 */ } }

// ---------------- 탭 ----------------
function showTab(p) {
  document.querySelectorAll('nav.tabs button').forEach(x => x.setAttribute('aria-selected', x.dataset.p === p));
  document.querySelectorAll('.panel').forEach(el => { el.hidden = el.id !== 'p-' + p; });
  try { localStorage.setItem(skey('pc-advisor-tab'), p); } catch (e) { /* 저장 불가 */ }
  if (p === 'improve' && improveUI) improveUI.run();
  if (p === 'battle' && battleUI) battleUI.render();
}
document.querySelectorAll('nav.tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.p)));
try { const t = localStorage.getItem(skey('pc-advisor-tab')); if (t && $('p-' + t)) showTab(t); } catch (e) { /* 저장값 없음 */ }

// ---------------- 포켓몬 선택 목록 ----------------
const label = e => `${e.ko} · ${e.en}`;
const labelMap = new Map();
for (const e of DATA.entries) {
  labelMap.set(label(e), e.id);
  labelMap.set(e.ko, labelMap.get(e.ko) || e.id);
  labelMap.set(e.en.toLowerCase(), e.id);
}
// 자동완성 순서: 이 페이지(싱글/더블)의 사용률 순위 → 도감번호. 메가는 원래 포켓몬 순위 바로 뒤
const rankOf = Object.fromEntries(DATA.usage.map(u => [u.id, u.rank]));
const useRank = e => rankOf[e.mega ? e.parent : e.id] || 999;
const sortedEntries = [...DATA.entries].sort((a, b) => useRank(a) - useRank(b) || !!a.mega - !!b.mega || a.no - b.no);
$('mon-list').innerHTML = sortedEntries.map(e => `<option value="${esc(label(e))}">`).join('');
function findMon(v) {
  v = v.trim();
  return labelMap.get(v) || labelMap.get(v.toLowerCase()) || null;
}

// ---------------- 카드 ----------------
function card(side) {
  const set = S[side], e = byId[set.id];
  const u = M.usageOf(e);
  const ls = M.learnset(e);
  const usedPct = new Map(u ? u.mv.map(([i, p]) => [typeof i === 'number' ? DATA.moves[i].en : i, p]) : []);
  const moveOpts = [...ls].sort((a, b) => (usedPct.get(b.en) || 0) - (usedPct.get(a.en) || 0) || (a.ko || a.en).localeCompare(b.ko || b.en, 'ko'));
  const itemPct = new Map(u ? u.it : []);
  const items = [...M.items].sort((a, b) => (itemPct.get(b) || 0) - (itemPct.get(a) || 0));
  if (set.item && !items.includes(set.item)) items.unshift(set.item);
  const abPct = new Map(u ? u.ab.map(([n, p]) => [n, p]) : []);
  const stats = M.finalStats(set);
  const spSum = STATS.reduce((a, k) => a + (+set.sp[k] || 0), 0);
  const who = side === 'L' ? '내 포켓몬' : '상대 포켓몬';
  const sideOpts = S.field[side];
  const pctTag = p => p ? ` (${p.toFixed(0)}%)` : '';

  return `
  <div class="card mon" data-side="${side}">
    <div class="mon-head">
      <span class="who">${who}</span>
      ${u ? `<span class="mini">사용률 ${u.rank}위</span>` : ''}
    </div>
    <input class="pick" list="mon-list" data-k="pick" value="${esc(label(e))}" aria-label="${who} 선택" autocomplete="off">
    <div class="types">${e.ty.map(ty).join('')}${e.mega ? '<span class="badge b-mega">메가</span>' : ''}
      <span class="mini base">종족값 ${e.st.join('-')}</span></div>
    ${e.megas ? `<div class="mega-links">${e.megas.map(m => `<button class="link" data-k="goto" data-id="${esc(m)}">${esc(byId[m].ko)}로 바꾸기</button>`).join(' · ')}</div>` : ''}
    ${e.mega ? `<div class="mega-links"><button class="link" data-k="goto" data-id="${esc(e.parent)}">${esc(byId[e.parent].ko)}(메가 전)로 바꾸기</button></div>` : ''}

    <div class="row2">
      <label>특성<select data-k="ability">${e.ab.map(a => `<option value="${esc(a.en)}"${a.en === set.ability ? ' selected' : ''}>${esc(a.ko || a.en)}${pctTag(abPct.get(a.en))}</option>`).join('')}</select></label>
      <label>도구<select data-k="item"><option value="">없음</option>${items.map(n => `<option value="${esc(n)}"${n === set.item ? ' selected' : ''}>${esc(M.itemKo(n))}${pctTag(itemPct.get(n))}</option>`).join('')}</select></label>
    </div>

    <div class="row2">
      <label>성격<select data-k="nature">${NATURE_ORDER.map(n => `<option value="${n}"${n === set.nature ? ' selected' : ''}>${natureLabel(n)}</option>`).join('')}</select></label>
      <label>상태이상<select data-k="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${k === set.status ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
    </div>

    <div class="presets" role="group" aria-label="능력치 배분 예시">
      <span class="mini">배분</span>
      ${[['atk', '공격형'], ['atk-fast', '공격·최속'], ['spa', '특공형'], ['spa-fast', '특공·최속'], ['hb', '물리 내구'], ['hd', '특수 내구']]
        .map(([k, t]) => `<button data-k="preset" data-v="${k}">${t}</button>`).join('')}
    </div>

    <div class="sp">
      <div class="sp-h"><span>능력치</span><span>SP</span><span>실수치</span><span>랭크</span></div>
      ${STATS.map(k => `
      <div class="sp-r${natureMark(set.nature, k)}">
        <span>${STAT_KO[k]}</span>
        <input type="number" min="0" max="${SP_MAX}" step="1" inputmode="numeric" data-k="sp" data-s="${k}" value="${set.sp[k] || 0}" aria-label="${STAT_KO[k]} SP">
        <b class="num">${k === 'hp' ? stats.maxHP : stats[k]}</b>
        ${k === 'hp'
          ? `<label class="hp hpg">HP<input type="range" min="1" max="100" data-k="hpPct" value="${set.hpPct}" style="--p:${set.hpPct}%;--c:${set.hpPct > 50 ? 'var(--good)' : set.hpPct > 20 ? 'var(--gold)' : 'var(--bad)'}" aria-label="남은 HP %"><b class="num hpv">${set.hpPct}%</b></label>`
          : `<select data-k="boost" data-s="${k}" aria-label="${STAT_KO[k]} 랭크">${[6,5,4,3,2,1,0,-1,-2,-3,-4,-5,-6].map(v => `<option value="${v}"${v === (set.boosts[k] || 0) ? ' selected' : ''}>${v > 0 ? '+' + v : v}</option>`).join('')}</select>`}
      </div>`).join('')}
      <div class="sp-sum${spSum > SP_TOTAL ? ' over' : ''}">SP 합계 <b>${spSum}</b> / ${SP_TOTAL}${spSum > SP_TOTAL ? ' · 초과' : ''}</div>
    </div>

    <div class="moves">
      ${[0, 1, 2, 3].map(i => `<select data-k="move" data-i="${i}" aria-label="기술 ${i + 1}"><option value="">(비움)</option>${moveOpts.map(m => `<option value="${esc(m.en)}"${m.en === set.moves[i] ? ' selected' : ''}>${esc(m.ko || m.en)}${usedPct.get(m.en) ? ` ${usedPct.get(m.en).toFixed(0)}%` : ''}</option>`).join('')}</select>`).join('')}
    </div>

    <div class="sidebox">
      <span class="mini">${side === 'L' ? '우리 편' : '상대 편'} 효과</span>
      ${SIDE_OPTS.map(([k, t]) => `<label class="chk"><input type="checkbox" data-k="side" data-s="${k}"${sideOpts[k] ? ' checked' : ''}> ${t}</label>`).join('')}
    </div>
  </div>`;
}
function natureLabel(n) {
  const [up, down] = NATURES[n];
  return `${NK[n] || n} ${up ? `(${STAT_KO[up]}↑ ${STAT_KO[down]}↓)` : '(무보정)'}`;
}
function natureMark(n, k) {
  const [up, down] = NATURES[n] || [];
  return k === up ? ' up' : k === down ? ' down' : '';
}

// ---------------- 결과 ----------------
function resultBlock(from, to) {
  const att = S[from], def = S[to];
  const rows = M.damageTable(att, def, S.field, from === 'L');
  const title = `${esc(byId[att.id].ko)} → ${esc(byId[def.id].ko)}`;
  return `<div class="card res"><h3>${title}</h3>${rows.length ? rows.map(r => {
    if (r.status) return `<div class="res-r muted"><span class="mv">${esc(r.ko)}</span><span class="mini">변화 기술</span></div>`;
    if (r.unsupported || r.error) return `<div class="res-r muted"><span class="mv">${esc(r.ko)}</span><span class="mini">계산 불가</span></div>`;
    const lo = Math.min(100, r.minPct), hi = Math.min(100, r.maxPct);
    const kill = r.minPct >= 100 ? ' kill' : r.maxPct >= 100 ? ' maybe' : '';
    return `<div class="res-r${kill}">
      <span class="mv">${tyEn(r.type)}${esc(r.ko)}${r.spread ? '<span class="badge b-form">전체기</span>' : ''}</span>
      <span class="dmg"><span class="track"><i class="lo" style="width:${lo}%"></i><i class="hi" style="left:${lo}%;width:${Math.max(0, hi - lo)}%"></i></span>
        <span class="num pct">${r.minPct.toFixed(1)}–${r.maxPct.toFixed(1)}%</span></span>
      <span class="ko">${esc(r.koText)}</span>
      <span class="mini raw">${r.min}–${r.max} / ${r.hp}</span>
    </div>`;
  }).join('') : '<p class="mini">기술을 골라 주세요.</p>'}</div>`;
}

function speedLine() {
  const a = M.speed(S.L, S.field, true), b = M.speed(S.R, S.field, false);
  const ka = byId[S.L.id].ko, kb = byId[S.R.id].ko;
  const verdict = a > b ? `<b>${esc(ka)}</b>가 먼저 움직입니다` : a < b ? `<b>${esc(kb)}</b>가 먼저 움직입니다` : '스피드가 같아서 순서는 무작위입니다';
  return `<div class="speed card"><span>스피드</span><span class="num">${esc(ka)} <b>${a}</b></span><span class="mini">vs</span><span class="num">${esc(kb)} <b>${b}</b></span><span class="verdict">${verdict}</span></div>`;
}

// ---------------- 그리기 ----------------
function render() {
  $('card-L').innerHTML = card('L');
  $('card-R').innerHTML = card('R');
  renderResults();
  renderField();
}
function renderResults() {
  $('results').innerHTML = speedLine() + resultBlock('L', 'R') + resultBlock('R', 'L');
}
function renderField() {
  const f = S.field;
  $('f-doubles').checked = f.doubles;
  $('f-crit').checked = f.crit;
  $('f-weather').value = f.weather;
  $('f-terrain').value = f.terrain;
}
$('f-weather').innerHTML = Object.entries(WEATHER).map(([k, v]) => `<option value="${k}">날씨: ${v}</option>`).join('');
$('f-terrain').innerHTML = Object.entries(TERRAIN).map(([k, v]) => `<option value="${k}">필드: ${v}</option>`).join('');

// ---------------- 입력 처리 ----------------
function onCardInput(ev) {
  const el = ev.target, k = el.dataset.k;
  if (!k) return;
  const side = el.closest('.mon').dataset.side, set = S[side];
  let full = false;  // true면 카드를 다시 그림(선택지 자체가 바뀌는 경우)
  switch (k) {
    case 'pick': {
      const id = findMon(el.value);
      if (!id || id === set.id) return;
      S[side] = M.defaultSet(id); full = true; break;
    }
    case 'ability': case 'item': case 'status': set[k] = el.value; break;
    case 'nature': set.nature = el.value; full = true; break;
    case 'sp': set.sp[el.dataset.s] = clamp(+el.value || 0, 0, SP_MAX); full = ev.type === 'change'; break;
    case 'hpPct': {
      set.hpPct = clamp(+el.value || 100, 1, 100);
      el.style.setProperty('--p', set.hpPct + '%');
      el.style.setProperty('--c', set.hpPct > 50 ? 'var(--good)' : set.hpPct > 20 ? 'var(--gold)' : 'var(--bad)');
      el.parentElement.querySelector('.hpv').textContent = set.hpPct + '%';
      break;
    }
    case 'boost': set.boosts[el.dataset.s] = +el.value; full = true; break;
    case 'move': set.moves[+el.dataset.i] = el.value; break;
    case 'side': S.field[side][el.dataset.s] = el.checked; break;
    default: return;
  }
  save();
  if (full) { $('card-' + side).innerHTML = card(side); }
  else if (k === 'sp') { updateStats(side); }
  renderResults();
}
function onCardClick(ev) {
  const el = ev.target.closest('button[data-k]');
  if (!el) return;
  const side = el.closest('.mon').dataset.side;
  if (el.dataset.k === 'preset') Object.assign(S[side], M.preset(el.dataset.v, byId[S[side].id]));
  if (el.dataset.k === 'goto') S[side] = {...M.defaultSet(el.dataset.id), nature: S[side].nature, sp: S[side].sp};
  save();
  $('card-' + side).innerHTML = card(side);
  renderResults();
}
function updateStats(side) {  // SP 입력 중에는 포커스를 잃지 않게 숫자만 갱신
  const set = S[side], st = M.finalStats(set), root = $('card-' + side);
  root.querySelectorAll('.sp-r').forEach((r, i) => { r.querySelector('b').textContent = i === 0 ? st.maxHP : st[STATS[i]]; });
  const sum = STATS.reduce((a, k) => a + (+set.sp[k] || 0), 0), el = root.querySelector('.sp-sum');
  el.className = 'sp-sum' + (sum > SP_TOTAL ? ' over' : '');
  el.innerHTML = `SP 합계 <b>${sum}</b> / ${SP_TOTAL}${sum > SP_TOTAL ? ' · 초과' : ''}`;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, Math.round(v)));

for (const s of ['L', 'R']) {
  $('card-' + s).addEventListener('input', onCardInput);
  $('card-' + s).addEventListener('change', onCardInput);
  $('card-' + s).addEventListener('click', onCardClick);
}
$('f-doubles').addEventListener('change', e => { S.field.doubles = e.target.checked; save(); renderResults(); });
$('f-crit').addEventListener('change', e => { S.field.crit = e.target.checked; save(); renderResults(); });
$('f-weather').addEventListener('change', e => { S.field.weather = e.target.value; save(); renderResults(); });
$('f-terrain').addEventListener('change', e => { S.field.terrain = e.target.value; save(); renderResults(); });
$('swap').addEventListener('click', () => {
  [S.L, S.R] = [S.R, S.L]; [S.field.L, S.field.R] = [S.field.R, S.field.L]; save(); render();
});
$('reset').addEventListener('click', () => {
  S = {L: M.defaultSet(S.L.id), R: M.defaultSet(S.R.id), field: blankField()}; save(); render();
});

render();

// ---------------- 팀 추천 / 선출 추천 탭 ----------------
let pickUI = null;
const teamUI = initTeam({
  M, T, ty, esc, $, findMon,
  onSendToCalc(set) {  // 팀 멤버를 계산기 왼쪽(내 포켓몬)으로
    const {baseId, custom, ...s} = set;
    S.L = s; save(); render(); showTab('calc'); scrollTo(0, 0);
  },
  onChange: () => {
    if (pickUI) pickUI.render();
    if (improveUI && !$('p-improve').hidden) improveUI.run();  // 팀 진단 탭을 보고 있으면 바로 다시 진단
  },
});
const importUI = initImport({
  M, itemDict: DATA.itemdict, esc, ty, $, findMon, natureko: NK,
  onImport: sets => { teamUI.importSets(sets); $('team-msg').textContent = `스크린샷에서 ${sets.length}마리를 불러왔습니다.`; },
});
$('import-open').addEventListener('click', () => importUI.open());
improveUI = initImprove({M, T, I, C: createChat(M, DATA), ty, esc, $, getSets: () => teamUI.getSets(), teamUI, gotoTeam: () => showTab('team')});
if (!$('p-improve').hidden) improveUI.run();
pickUI = initPick({
  M, T, P, ty, esc, $, findMon,
  getMySets: () => teamUI.getSets(),
  gotoTeam: () => showTab('team'),
});

// ---------------- 배틀 도우미 탭 ----------------
battleUI = initBattle({
  M, B: createBattle(M, P), ty, esc, $, findMon,
  getMySets: () => teamUI.getSets(),
  getOppIds: () => pickUI.getOpp(),
  getLead: () => {  // 선출 추천의 1순위 선봉·후발
    const mine = teamUI.getSets(), opp = pickUI.getOpp();
    if (mine.length < 4 || !opp.length) return null;
    try { return P.recommend(mine, opp).leads[0] || null; } catch (e) { return null; }
  },
});
if (!$('p-battle').hidden) battleUI.render();
