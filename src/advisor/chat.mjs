// 팀 진단 채팅: 사용자의 한국어 문장 → 추천 조건 (규칙 기반, DOM 없음)
// 조건은 대화 동안 쌓이고, 팀 진단 모델이 이 조건 안에서 다시 추천함
//   exclude: 후보에서 뺄 종        noMega: 메가 안 쓰는 후보만     avoidWeak: [{type, min}] 약점 타입 피하기
//   mustSurvive: 이 상대 공격을 버텨야 함   mustBeat: 이 상대에게 유리해야 함
//   lock: 교체하지 말 멤버(원래 id)   target: 이 멤버 자리만 교체   roles / speed / category / types
const NEG = /(말고|빼고|싫|별로|제외|아니|말구|노노|없는|없이|애매|안\s*돼|안돼|안\s*쓸|구려|거슬)/;
const KEEP = /(빼지\s*마|빼지마|유지|남겨|두고|고정|필수|꼭\s*(넣|써|쓰))/;
const REPLACE = /(대신|자리|바꿔|바꾸|교체|빼(고\s*싶|줘|자|려|는\s*게|면)|빼고\s*싶)/;
const DIE = /(한테|에게|상대로|만나면|앞에서)\s*(죽|약|털|잡혀|녹|못\s*버|못버|터지|한\s*방|한방|막혀)/;
const BEAT = /(잡을|잡는|이길|이기는|카운터|상대할|막을|막는|받을|받아칠|견제)/;
const WHY = /(왜|이유|어째서|근거)/;
const HOW = /(어때|어떰|어떄|괜찮|는\s*\?|넣으면|넣어보면|은\s*\?$|는\?$)/;
const MORE = /(다른\s*(애|거|포켓몬|후보|걸)|딴\s*(애|거)|다른거|또\s*없|더\s*없|다음\s*후보)/;
const RESET = /(처음부터|초기화|리셋|다\s*지워|조건\s*(없|지워|초기))/;
const ROLE_WORDS = [
  ['fakeout', /속이다|페이크아웃/], ['trickroom', /트릭룸|트룸/], ['tailwind', /순풍/], ['intimidate', /위협/],
  ['redirect', /유인|날\s*따르|분노가루|따라와/], ['speed', /스피드\s*조절|스피드\s*컨트롤|스컨/],
];

export function createChat(M, D) {
  const {byId} = M;
  const TK = D.typeko;
  const typeByKo = Object.fromEntries(Object.entries(TK).map(([en, ko]) => [ko, en]));
  const plain = ko => ko.replace(/^(알로라|가라르|히스이|팔데아) /, '').replace(/ \(.*\)$/, '').replace(/^(메가|영원의 꽃 )/, '').replace(/ [XYZ]$/, '');
  // 이름 사전: 도감 한글명, 지역폼·메가·성별 빼고 부르는 이름, 영문명 → 원래 모습 id
  const names = [];
  for (const e of D.entries) {
    const base = e.mega ? e.parent : e.id;
    for (const n of new Set([e.ko, plain(e.ko), e.en.toLowerCase()])) if (n && n.length >= 2) names.push([n, base]);
  }
  names.sort((a, b) => b[0].length - a[0].length);  // 긴 이름 먼저 ("메가보만다" > "보만다")

  function findNames(text) {
    const low = text.toLowerCase();
    const found = [];
    const used = new Array(low.length).fill(false);
    for (const [n, id] of names) {
      let k = low.indexOf(n);
      while (k >= 0) {
        if (!used.slice(k, k + n.length).some(Boolean)) {
          for (let q = k; q < k + n.length; q++) used[q] = true;
          found.push({id, at: k, end: k + n.length, name: n});
        }
        k = low.indexOf(n, k + 1);
      }
    }
    return found.sort((a, b) => a.at - b.at);
  }

  // 이름 뒤(또는 앞) 몇 글자에서 의도 판단
  const around = (text, f, before = 4, after = 14) => text.slice(Math.max(0, f.at - before), Math.min(text.length, f.end + after));
  const after = (text, f, n = 16) => text.slice(f.end, f.end + n);

  // text → {set: 조건 변경, ask: 질문 의도}
  function parse(text, {teamIds = []} = {}) {
    const t = text.trim();
    const out = {changes: {}, ask: null, notes: []};
    if (!t) return out;
    if (RESET.test(t)) { out.reset = true; return out; }
    const c = out.changes;
    const add = (k, v) => { (c[k] = c[k] || []).push(v); };
    const mons = findNames(t);

    for (const f of mons) {
      const inTeam = teamIds.includes(f.id);
      const ctx = around(t, f), aft = after(t, f);
      if (DIE.test(aft) || /한테|에게/.test(aft.slice(0, 3)) && /(죽|약|털|녹|한\s*방|한방)/.test(aft)) {
        add('mustSurvive', f.id);
      } else if (BEAT.test(ctx) && !inTeam) {
        add('mustBeat', f.id);
      } else if (inTeam && KEEP.test(aft)) {
        add('lock', f.id);
      } else if (inTeam && (REPLACE.test(aft) || NEG.test(aft))) {
        add('target', f.id);
      } else if (!inTeam && NEG.test(aft)) {
        add('exclude', f.id);
      } else if (WHY.test(t) && inTeam) {
        out.ask = {kind: 'why', id: f.id};
      } else if (!inTeam && (HOW.test(aft) || /\?$/.test(t))) {
        out.ask = {kind: 'how', id: f.id};
      } else if (BEAT.test(ctx)) {
        add('mustBeat', f.id);
      }
    }

    // 메가
    if (/메가/.test(t.replace(/메가(?=[가-힣]{2})/g, m => (mons.some(f => t.indexOf(f.name) >= 0 && f.name.startsWith('메가')) ? '' : m)))) {
      const seg = t.slice(t.indexOf('메가'), t.indexOf('메가') + 16);
      if (/(슬롯|애매|말고|빼고|싫|없는|없이|안|제외|별로|겹)/.test(seg)) c.noMega = true;
      else if (/(메가\s*(있는|되는|로|가능|쓰는))/.test(seg)) c.megaOnly = true;
    }

    // 타입: 약점 피하기 / 이 타입으로
    for (const [ko, en] of Object.entries(typeByKo)) {
      let k = t.indexOf(ko);
      while (k >= 0) {
        const seg = t.slice(k, k + ko.length + 12);
        const prev = t.slice(Math.max(0, k - 1), k);
        if (/[가-힣]/.test(prev) && !/[의은는이가]/.test(prev)) { k = t.indexOf(ko, k + 1); continue; }  // 다른 단어의 일부
        if (/(4배|네배|4\s*배|사배)/.test(seg)) add('avoidWeak', {type: en, min: 4});
        else if (/(약점|배\b|배라|배면|배인|에\s*약|한테\s*약|맞으면)/.test(seg)) add('avoidWeak', {type: en, min: 2});
        else if (/(타입|속성)\s*(으로|이면|인|넣|있는|추천|애)/.test(seg) || /(타입|속성)(으로|이면)/.test(seg)) add('types', en);
        k = t.indexOf(ko, k + 1);
      }
    }

    // 역할·스피드·공격 종류
    for (const [r, re] of ROLE_WORDS) if (re.test(t) && !/(말고|빼고|싫|없는)/.test(t.slice(t.search(re), t.search(re) + 8))) add('roles', r);
    if (/(느린|느려|트릭룸용|트룸용|저속)/.test(t)) c.speed = 'slow';
    else if (/(빠른|빨라|빠르|고속|스피드\s*좋)/.test(t)) c.speed = 'fast';
    if (/물리/.test(t) && !/특수/.test(t)) c.category = '물리';
    else if (/특수/.test(t) && !/물리/.test(t)) c.category = '특수';

    if (MORE.test(t)) out.more = true;
    if (!out.ask && WHY.test(t) && !mons.length) out.ask = {kind: 'why'};
    const any = Object.keys(c).length || out.more || out.ask || out.reset;
    if (!any) out.unknown = true;
    return out;
  }

  // 조건 합치기 (배열은 합집합, 값은 덮어씀)
  function merge(cons, changes) {
    const next = {...cons};
    for (const [k, v] of Object.entries(changes)) {
      if (Array.isArray(v)) {
        const prev = next[k] || [];
        const key = x => JSON.stringify(x);
        next[k] = [...prev, ...v.filter(x => !prev.some(p => key(p) === key(x)))];
      } else next[k] = v;
    }
    // 서로 모순: 같은 종을 target과 lock에 동시에 넣으면 나중 것만
    if (changes.lock) next.target = (next.target || []).filter(id => !changes.lock.includes(id));
    if (changes.target) next.lock = (next.lock || []).filter(id => !changes.target.includes(id));
    return next;
  }

  // 조건을 사람이 읽는 문장 조각으로 (칩 표시용)
  function describe(cons) {
    const nm = id => byId[id].ko;
    const RK = {fakeout: '속이다', trickroom: '트릭룸', tailwind: '순풍', intimidate: '위협', redirect: '유인', speed: '스피드 조절'};
    const out = [];
    for (const id of cons.exclude || []) out.push({k: 'exclude', v: id, text: `${nm(id)} 제외`});
    for (const id of cons.target || []) out.push({k: 'target', v: id, text: `${nm(id)} 자리 교체`});
    for (const id of cons.lock || []) out.push({k: 'lock', v: id, text: `${nm(id)} 유지`});
    if (cons.noMega) out.push({k: 'noMega', text: '메가 없이'});
    if (cons.megaOnly) out.push({k: 'megaOnly', text: '메가 가능한 후보'});
    for (const w of cons.avoidWeak || []) out.push({k: 'avoidWeak', v: w, text: `${TK[w.type]} ${w.min >= 4 ? '4배' : ''}약점 피하기`});
    for (const id of cons.mustSurvive || []) out.push({k: 'mustSurvive', v: id, text: `${nm(id)} 공격 버티기`});
    for (const id of cons.mustBeat || []) out.push({k: 'mustBeat', v: id, text: `${nm(id)}에게 유리`});
    for (const r of cons.roles || []) out.push({k: 'roles', v: r, text: `${RK[r]} 가능`});
    for (const ty of cons.types || []) out.push({k: 'types', v: ty, text: `${TK[ty]} 타입`});
    if (cons.speed) out.push({k: 'speed', text: cons.speed === 'slow' ? '느린 포켓몬' : '빠른 포켓몬'});
    if (cons.category) out.push({k: 'category', text: `${cons.category} 공격`});
    if ((cons.seen || []).length) out.push({k: 'seen', text: `이미 본 후보 ${cons.seen.length}마리 제외`});
    return out;
  }

  function removeOne(cons, k, v) {
    const next = {...cons};
    if (Array.isArray(next[k])) next[k] = next[k].filter(x => JSON.stringify(x) !== JSON.stringify(v));
    else delete next[k];
    return next;
  }

  return {parse, merge, describe, removeOne, findNames};
}
