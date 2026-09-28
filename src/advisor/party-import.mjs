// 게임 파티 화면 스크린샷 → 세트 (글자 인식 결과 해석부, DOM·OCR 엔진 없음)
// 입력: OCR 단어 목록 [{text, x0, y0, x1, y1}] (Tesseract words)
// 화면: 카드 6장이 2열×3행, 번호는 왼→오, 위→아래 (1 2 / 3 4 / 5 6)
//   능력 화면: 카드 왼쪽 = 이름 / 특성 / 도구, 오른쪽 = 기술 4개
//   스테이터스 화면: 행마다 [실수치 SP 실수치 SP] → (HP, 특공) (공격, 특방) (방어, 스피드)
import {NATURES, statValue} from './model.mjs';

const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

// ---------------- 한글 자모 단위 비교 ----------------
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const JONG = ' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ';
export function jamo(s) {
  let out = '';
  for (const ch of String(s)) {
    const c = ch.charCodeAt(0);
    if (c >= 0xAC00 && c <= 0xD7A3) {
      const i = c - 0xAC00;
      out += CHO[Math.floor(i / 588)] + JUNG[Math.floor((i % 588) / 28)] + (i % 28 ? JONG[i % 28] : '');
    } else if (/[0-9a-zA-Zㄱ-ㅣ]/.test(ch)) out += ch.toLowerCase();
  }
  return out;
}
function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({length: n + 1}, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
export const similarity = (a, b) => { const x = jamo(a), y = jamo(b); return x && y ? 1 - lev(x, y) / Math.max(x.length, y.length) : 0; };

function makeDict(pairs) {  // [[한글, 값]] → 찾기 함수
  const list = pairs.filter(([k]) => k).map(([k, v]) => ({k, j: jamo(k), v}));
  return text => {
    const q = jamo(text);
    if (!q) return null;
    let best = null;
    for (const it of list) {
      const s = 1 - lev(q, it.j) / Math.max(q.length, it.j.length);
      if (!best || s > best.score) best = {value: it.v, label: it.k, score: s};
    }
    return best;
  };
}

// ---------------- 사전 ----------------
export function createPartyReader(M, itemDict) {
  const {D, byId} = M;
  // 게임은 지역폼·성별을 이름에 안 붙임 → "히스이 윈디" → "윈디"
  const plain = ko => ko.replace(/^(알로라|가라르|히스이|팔데아) /, '').replace(/ \(.*\)$/, '').replace(/^영원의 꽃 /, '');
  const byPlain = {};
  for (const e of D.entries) if (!e.mega) (byPlain[plain(e.ko)] = byPlain[plain(e.ko)] || []).push(e.id);
  const findMon = makeDict(Object.keys(byPlain).map(k => [k, k]));
  const findMove = makeDict(D.moves.map(m => [m.ko || m.en, m.en]));
  const abilities = new Map();
  for (const e of D.entries) for (const a of e.ab) abilities.set(a.ko || a.en, a.en);
  const findAbility = makeDict([...abilities]);
  const findItem = makeDict(Object.entries(itemDict));

  // ---------------- 단어 → 구절 ----------------
  // 같은 줄에서 간격이 넓으면 다른 구절 (이름 줄과 첫 기술이 같은 높이에 있음)
  function phrases(words) {
    let ws = words.filter(w => w.text && /[가-힣0-9a-zA-Z]/.test(w.text)).map(w => ({...w, cy: (w.y0 + w.y1) / 2, h: w.y1 - w.y0}));
    if (!ws.length) return [];
    // 기준 글자 높이 = 중앙값. 테두리·아이콘을 글자로 잘못 읽은 거대한 상자(확신도 낮음)는 버림
    const med = ws.map(w => w.h).sort((a, b) => a - b)[Math.floor(ws.length / 2)];
    // (확신도만 낮은 보통 크기 글자는 남김: 한 글자 틀려도 사전 비교로 맞출 수 있음)
    ws = ws.filter(w => !(w.conf != null && w.h > med * 2.2 && w.conf < 60))
      .sort((a, b) => a.cy - b.cy || a.x0 - b.x0);
    const lines = [];
    for (const w of ws) {
      const L = lines.find(l => Math.abs(l.cy - w.cy) < med * 0.6);
      if (L) L.ws.push(w); else lines.push({cy: w.cy, ws: [w]});
    }
    const out = [];
    for (const l of lines) {
      l.ws.sort((a, b) => a.x0 - b.x0);
      let cur = null;
      for (const w of l.ws) {
        // 한글은 글자마다 따로 잡히는 일이 많음 → 가까우면 한 구절, 멀면(열이 다르면) 새 구절
        if (cur && w.x0 - cur.x1 < med * 1.6) { cur.text += w.text; cur.x1 = w.x1; cur.parts.push(w); }
        else { cur = {text: w.text, x0: w.x0, x1: w.x1, y0: l.cy - med / 2, y1: l.cy + med / 2, cy: l.cy, parts: [w]}; out.push(cur); }
      }
    }
    return out;
  }

  // ---------------- 카드 나누기 ----------------
  // 이름 구절(포켓몬 사전과 잘 맞고 기술·도구보다 더 잘 맞는 것)을 기준으로 2열×3행
  function cards(ps, width) {
    const mid = width / 2;
    const heads = [];
    for (const p of ps) {
      const m = findMon(p.text);
      if (!m || m.score < 0.7) continue;
      const other = Math.max(findMove(p.text)?.score || 0, findItem(p.text)?.score || 0);
      if (other >= m.score) continue;
      heads.push({...p, mon: m, col: p.x0 < mid ? 0 : 1});
    }
    const cols = [0, 1].map(c => heads.filter(h => h.col === c).sort((a, b) => a.cy - b.cy)
      .filter((h, i, arr) => !arr.slice(0, i).some(o => Math.abs(o.cy - h.cy) < h.y1 - h.y0))  // 같은 줄 중복 제거
      .slice(0, 3));
    const out = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) {
      const h = cols[c][r];
      if (!h) continue;
      const next = cols[c][r + 1];
      const top = h.y0 - (h.y1 - h.y0) * 0.3;
      const bottom = next ? next.y0 - (next.y1 - next.y0) * 0.3 : Infinity;
      const inCol = p => (c === 0 ? p.x0 < mid : p.x0 >= mid);
      const body = ps.filter(p => p !== h && inCol(p) && p.cy > top && p.cy < bottom);
      out.push({slot: r * 2 + c, head: h, body});
    }
    return out;
  }

  // ---------------- 능력 화면 ----------------
  function readAbilityCard(card) {
    const h = card.head;
    const xs = card.body.map(p => p.x0).concat(h.x0);
    const x1s = card.body.map(p => p.x1).concat(h.x1);
    const left = Math.min(...xs), right = Math.max(...x1s);
    const split = left + (right - left) * 0.5;
    const L = card.body.filter(p => p.x0 < split).sort((a, b) => a.cy - b.cy);
    const R = card.body.filter(p => p.x0 >= split).sort((a, b) => a.cy - b.cy);
    const pick = (list, find, min) => {
      let best = null;
      for (const p of list) { const m = find(p.text); if (m && m.score >= min && (!best || m.score > best.score)) best = {...m, raw: p.text, p}; }
      return best;
    };
    const ability = pick(L.slice(0, 2), findAbility, 0.5);
    const item = pick(L.filter(p => !ability || p !== ability.p), findItem, 0.5);
    const moves = R.map(p => ({raw: p.text, m: findMove(p.text)})).filter(x => x.m && x.m.score >= 0.5).slice(0, 4);
    return {ability, item, moves: moves.map(x => ({...x.m, raw: x.raw}))};
  }

  // ---------------- 스테이터스 화면 ----------------
  function readStatCard(card) {
    // 숫자 토큰 (한 단어에 "186—21" 처럼 두 숫자가 붙어 있을 수 있음 → 글자 위치 비율로 나눔)
    const nums = [];
    const xs = card.body.flatMap(p => [p.x0, p.x1]);
    const split = (Math.min(...xs) + Math.max(...xs)) / 2;  // 카드 왼쪽(HP·공격·방어) / 오른쪽(특공·특방·스피드)
    for (const p of card.body) for (const w of p.parts) {
      const t = /^[ㅇoO]{1,2}$/.test(w.text) ? '0' : w.text;  // 0을 ㅇ·o로 읽는 경우
      const re = /\d+/g;
      let m;
      while ((m = re.exec(t))) {
        const f0 = m.index / t.length, f1 = (m.index + m[0].length) / t.length;
        nums.push({v: +m[0], x: w.x0 + (w.x1 - w.x0) * (f0 + f1) / 2, cy: (w.y0 + w.y1) / 2, h: w.y1 - w.y0});
      }
    }
    const rows = [];
    for (const n of nums.sort((a, b) => a.cy - b.cy)) {
      const r = rows.find(r => Math.abs(r.cy - n.cy) < n.h * 0.6);
      if (r) r.ns.push(n); else rows.push({cy: n.cy, ns: [n]});
    }
    // 행마다 왼쪽·오른쪽 절반에서 "실수치(20~400) 다음 SP(0~32)"를 찾음.
    // 글자("HP"→"10")나 막대가 숫자로 읽혀도 위치·크기로 걸러냄. 못 읽은 칸은 null
    const side = ns => {
      ns = ns.sort((a, b) => a.x - b.x).map(n => n.v);
      for (let i = 0; i < ns.length; i++) {
        if (ns[i] < 20 || ns[i] > 400) continue;
        return [ns[i], i + 1 < ns.length && ns[i + 1] <= 32 ? ns[i + 1] : null];
      }
      return [null, null];
    };
    const got = rows.filter(r => r.ns.length).slice(0, 3).map(r => [side(r.ns.filter(n => n.x < split)), side(r.ns.filter(n => n.x >= split))]);
    if (got.length < 3) return null;
    const val = {}, sp = {};
    [['hp', 'spa'], ['atk', 'spd'], ['def', 'spe']].forEach(([l, r], i) => {
      [val[l], sp[l]] = got[i][0];
      [val[r], sp[r]] = got[i][1];
    });
    if (STATS.filter(k => val[k] != null).length < 3) return null;
    return {val, sp};
  }

  // 실수치·SP → 성격·SP 역산. 틀린 숫자가 섞여도 맞는 증거가 가장 많은 성격을 고름
  //   실수치와 읽은 SP가 서로 맞음 2점 / 실수치만으로 SP가 나옴 1점 / 읽은 SP만 있음 0.5점
  function solve(entry, val, spRead) {
    let best = null;
    for (const nature of Object.keys(NATURES)) {
      if (!NATURES[nature].length && nature !== 'Serious') continue;  // 무보정은 하나만
      const sp = {};
      let points = 0;
      const unknown = [];
      for (const k of STATS) {
        const base = entry.st[STATS.indexOf(k)];
        const v = val[k], r = spRead ? spRead[k] : null;
        const cands = [];
        if (v != null) for (let s = 0; s <= 32; s++) if (statValue(base, s, k, nature) === v) cands.push(s);
        if (cands.length && cands.includes(r)) { sp[k] = r; points += 2; }
        else if (cands.length) { sp[k] = cands[0]; points += 1; }
        else if (r != null && r <= 32) { sp[k] = r; points += 0.5; }
        else { sp[k] = 0; unknown.push(k); }
      }
      let total = STATS.reduce((a, k) => a + sp[k], 0);
      if (unknown.length === 1 && total < 66) { sp[unknown[0]] = Math.min(32, 66 - total); total = STATS.reduce((a, k) => a + sp[k], 0); }
      if (total > 66) continue;
      if (!best || points > best.points) best = {nature, sp, points, total, sure: points >= 12, agree: points};
    }
    return best && best.points >= 6 ? best : null;
  }

  // ---------------- 전체 ----------------
  // shots: [{words, width, height}] (능력·스테이터스 어느 쪽이든, 한 장 또는 두 장)
  function read(shots) {
    const slots = Array.from({length: 6}, () => ({name: null}));
    for (const shot of shots) {
      const ps = phrases(shot.words);
      const cs = cards(ps, shot.width);
      const isStat = cs.filter(c => readStatCard(c)).length >= cs.length / 2 && cs.length > 0;
      for (const c of cs) {
        const s = slots[c.slot];
        if (!s.name || c.head.mon.score > s.name.score) s.name = c.head.mon;
        if (isStat) { s.statTried = true; s.stat = readStatCard(c); }
        else Object.assign(s, readAbilityCard(c));
      }
    }
    return slots.filter(s => s.name).map(s => resolve(s));
  }

  // 이름 후보(지역폼·성별) 중에서 특성·능력치가 맞는 항목 고르기 → 세트
  function resolve(s) {
    const ids = byPlain[s.name.value] || [];
    let pickId = ids[0], solved = null;
    const scored = ids.map(id => {
      const e = byId[id];
      let score = 0;
      if (s.ability && e.ab.some(a => a.en === s.ability.value)) score += 2;
      const sol = s.stat ? solve(e, s.stat.val, s.stat.sp) : null;
      if (sol) score += 3 + sol.agree * 0.1;
      return {id, score, sol};
    }).sort((a, b) => b.score - a.score);
    if (scored.length) { pickId = scored[0].id; solved = scored[0].sol; }
    const e = byId[pickId];
    const warn = [];
    if (s.name.score < 0.85) warn.push('이름');
    let item = s.item ? s.item.value : '';
    let ability = s.ability && e.ab.some(a => a.en === s.ability.value) ? s.ability.value : null;
    if (s.ability && !ability) warn.push('특성');
    const learn = new Set(M.learnset(e).map(m => m.en));
    const moves = (s.moves || []).map(m => m.value).filter(n => learn.has(n));
    if ((s.moves || []).length && moves.length < (s.moves || []).length) warn.push('기술');
    if (s.statTried && !(solved && solved.sure)) warn.push('능력치');  // 스테이터스 화면인데 확실히 못 읽음
    const base = M.defaultSet(pickId);
    // 메가스톤을 들고 있으면 메가 형태로 (특성은 메가 특성)
    let id = pickId;
    if (item && e.megas) {
      const suf = (item.match(/ ([XYZ])$/) || [])[1];
      const mega = e.megas.find(m => ((m.match(/ ([XYZ])$/) || [])[1]) === suf && /ite( [XYZ])?$/.test(item));
      if (mega) { id = mega; ability = byId[mega].ab[0].en; }
    }
    const set = {
      ...base, id, item: item || base.item, ability: ability || (id !== pickId ? byId[id].ab[0].en : base.ability),
      // 못 읽은 칸은 사용률 기술로 채움 (확인 화면에서 표시)
      moves: [...moves, ...base.moves.filter(m => !moves.includes(m))].slice(0, 4),
      ...(solved ? {nature: solved.nature, sp: solved.sp} : {}),
    };
    return {set, baseId: pickId, found: {name: s.name, ability: !!s.ability, item: !!s.item, moves: moves.length, stats: !!solved}, warn};
  }

  return {read, phrases, cards, solve, findMon, findMove, findItem, findAbility, byPlain};
}
