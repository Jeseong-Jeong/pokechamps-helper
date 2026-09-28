// 팀 진단 채팅 (규칙 기반): 말 → 조건 → 모델로 다시 추천
const STORE = 'pc-chat-cons-v1';
const EXAMPLES = ['메가 슬롯이 애매해, 메가 말고', '풀 4배 약점은 싫어', '고릴타한테 안 죽는 애로', '메타그로스는 빼지 마',
  '브리두라스 대신 넣을 애', '속이다 있는 애', '왜 메타그로스를 빼래?', '한카리아스는 어때?', '다른 애 추천해줘', '처음부터'];
const FAIL_KO = {exclude: '제외한 포켓몬', megaOnly: '메가 가능', avoidWeak: '약점 피하기', types: '타입', roles: '역할',
  speed: '스피드', category: '공격 종류', mustSurvive: '공격 버티기', mustBeat: '유리한 상대'};

export function initChat({M, I, C, ty, esc, root, getSets, getResult, teamUI}) {
  const {byId} = M;
  let cons = load();
  const log = [];          // {who: 'me'|'bot', html, text}
  let lastShown = [];      // 방금 보여준 후보 id ("다른 애" 용)
  let optionMap = {};      // 버튼 → 세트
  let busy = false;

  function load() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(cons)); } catch (e) { /* 저장 불가 */ } }
  const nm = id => esc(byId[id].ko);
  const pts = d => { const n = Math.round(d * 60); return n > 0 ? `<span class="num good">+${n}점</span>` : n < 0 ? `<span class="num bad">−${-n}점</span>` : '<span class="num">±0점</span>'; };

  function render() {
    const chips = C.describe(cons);
    root.innerHTML = `
      <div class="chat-log" id="chat-log">${log.length ? log.map(m => `<div class="msg ${m.who}">${m.html}</div>`).join('')
        : `<div class="msg bot">추천이 내 의도와 다르면 말로 알려 주세요. 조건으로 바꿔서 같은 계산 모델로 다시 찾아볼게요.<br><span class="mini">예: "대짱이로 바꾸면 메가 슬롯이 애매해", "풀 4배라 별로야, 고릴타한테 죽어. 다른 애 추천해줘"</span></div>`}</div>
      <div class="chat-cons">${chips.length ? `<span class="mini">지금 조건</span>${chips.map((c, k) => `<button class="chip-x" data-k="cons-x" data-n="${k}" title="이 조건 지우기">${esc(c.text)} ✕</button>`).join('')}` : '<span class="mini">붙인 조건 없음</span>'}</div>
      <form class="chat-in" id="chat-form"><input id="chat-text" type="text" placeholder="예: 메가 말고, 고릴타한테 안 죽는 애로" autocomplete="off" aria-label="채팅 입력"${busy ? ' disabled' : ''}><button class="btn primary"${busy ? ' disabled' : ''}>보내기</button></form>
      <div class="chat-ex">${EXAMPLES.map(t => `<button class="chip-ex" data-k="ex" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div>`;
    const lg = root.querySelector('#chat-log');
    lg.scrollTop = lg.scrollHeight;
  }

  const bot = (html, text) => { log.push({who: 'bot', html, text: text || html.replace(/<[^>]+>/g, '')}); render(); };

  function optionsHtml(S) {
    optionMap = {};
    lastShown = [];
    const blocks = S.results.map(r => {
      const s = getSets()[r.slot];
      if (!r.options.length) return `<p><b>${nm(s.id)}</b> 자리: 조건에 맞는 후보가 없어요.</p>`;
      const good = r.options.some(o => Math.round(o.delta * 60) > 0);
      return `<p><b>${nm(s.id)}</b> 자리${good ? '' : ' <span class="mini">(바꾸면 점수가 오히려 떨어짐)</span>'}</p><ol>${r.options.map(o => {
        const key = `${r.slot}:${o.id}`;
        optionMap[key] = {slot: r.slot, set: o.set};
        lastShown.push(o.id);
        return `<li><b>${nm(o.set.id)}</b> ${pts(o.delta)} <button class="btn sm" data-k="chat-swap" data-key="${esc(key)}">교체</button>
          <br><span class="mini">${o.why.map(w => (w.good ? '' : '⚠ ') + esc(w.text)).join(' · ') || '전체적으로 조금씩 나아짐'} · ${esc(M.itemKo(o.set.item) || '도구 없음')}</span></li>`;
      }).join('')}</ol>`;
    }).join('');
    const empty = S.results.every(r => !r.options.length);
    if (empty) {
      const top = Object.entries(S.failCount || {}).sort((a, b) => b[1] - a[1])[0];
      return `조건에 맞는 후보가 없어요.${top ? ` 주로 <b>${FAIL_KO[top[0]] || top[0]}</b> 조건에서 걸렸어요.` : ''} 위 조건 칩에서 하나를 지워 보세요.`;
    }
    return blocks;
  }

  async function recompute(prefix) {
    busy = true;
    bot(`${prefix}<br><span class="mini">조건에 맞게 다시 찾는 중… (몇 초)</span>`);
    try {
      const S = await I.swaps(getSets(), {constraints: cons});
      log.pop();
      bot(`${prefix}<div class="chat-opts">${optionsHtml(S)}</div>`);
    } catch (e) {
      log.pop();
      bot(`<span class="bad">계산 중 오류: ${esc(e.message || e)}</span>`);
    } finally {
      busy = false; render();
      root.querySelector('#chat-text')?.focus();
    }
  }

  async function send(text) {
    text = text.trim();
    if (!text || busy) return;
    log.push({who: 'me', html: esc(text), text});
    const sets = getSets();
    const teamIds = sets.map(s => s.baseId || s.id);
    const r = C.parse(text, {teamIds});
    if (r.reset) { cons = {}; save(); bot('조건을 모두 지웠어요. 기본 추천으로 돌아갑니다.'); return; }
    if (r.ask && r.ask.kind === 'why') {
      const res = getResult();
      if (!res) { bot('먼저 진단이 끝나야 설명할 수 있어요.'); return; }
      const i = r.ask.id ? teamIds.indexOf(r.ask.id) : res.members.slice().sort((a, b) => (a.core - b.core) || a.contrib - b.contrib)[0].i;
      const m = res.members.find(x => x.i === i);
      if (!m) { bot('그 포켓몬은 지금 팀에 없어요.'); return; }
      bot(`<b>${nm(sets[i].id)}</b>: 빼면 팀 점수가 ${Math.round(m.contrib * 60)}점 떨어져요 (6마리 중 ${res.members.slice().sort((a, b) => a.contrib - b.contrib).findIndex(x => x.i === i) + 1}번째로 적음).
        ${m.drop.length ? `<br>뺄 이유: ${m.drop.map(esc).join(' / ')}` : ''}${m.keep.length ? `<br>남길 이유: ${m.keep.map(esc).join(' / ')}` : ''}
        <br><span class="mini">남기고 싶으면 "${nm(sets[i].id)}는 빼지 마"라고 해 주세요.</span>`);
      return;
    }
    if (r.ask && r.ask.kind === 'how') {
      const id = r.ask.id;
      const fail = I.failsOf(id, cons, I.planOf(sets));
      const ev = I.evalCandidate(sets, id, cons);
      if (!ev) { bot(`${nm(id)}는 넣을 수 있는 자리가 없어요 (같은 도감번호가 이미 있거나 모든 자리가 유지·핵심).`); return; }
      const key = `${ev.slot}:${id}`;
      optionMap[key] = {slot: ev.slot, set: ev.set};
      bot(`<b>${nm(id)}</b>를 넣는다면 <b>${nm(sets[ev.slot].id)}</b> 자리가 가장 좋아요: ${pts(ev.delta)}
        <br><span class="mini">${ev.why.map(w => (w.good ? '' : '⚠ ') + esc(w.text)).join(' · ') || '큰 변화 없음'} · ${esc(M.itemKo(ev.set.item) || '도구 없음')} · ${ev.set.moves.map(x => esc(M.moveKo(x))).join(', ')}</span>
        ${fail ? `<br><span class="bad">단, 지금 조건(${FAIL_KO[fail] || fail})에는 맞지 않아요.</span>` : ''}
        <br><button class="btn sm" data-k="chat-swap" data-key="${esc(key)}">이걸로 교체</button>`);
      return;
    }
    if (r.unknown) {
      bot(`잘 못 알아들었어요. 이런 식으로 말해 주세요:<br><span class="mini">"OO 말고", "메가 말고", "풀 4배 약점 싫어", "OO한테 안 죽는 애", "OO 잡을 수 있는 애", "OO는 빼지 마", "OO 대신", "속이다/트릭룸/순풍 있는 애", "느린/빠른 애", "물 타입으로", "왜 OO를 빼래?", "OO는 어때?", "다른 애", "처음부터"</span>`);
      return;
    }
    if (r.more) cons = C.merge(cons, {seen: lastShown});
    cons = C.merge(cons, r.changes);
    save();
    const got = C.describe(cons).map(c => `<span class="chip">${esc(c.text)}</span>`).join(' ');
    await recompute(`이렇게 이해했어요: ${got || '(조건 없음)'}`);
  }

  root.addEventListener('submit', e => {
    e.preventDefault();
    const inp = root.querySelector('#chat-text');
    const t = inp.value; inp.value = '';
    send(t);
  });
  root.addEventListener('click', e => {
    const b = e.target.closest('button[data-k]');
    if (!b) return;
    const k = b.dataset.k;
    if (k === 'ex') send(b.dataset.t);
    if (k === 'cons-x') {
      const c = C.describe(cons)[+b.dataset.n];
      if (!c) return;
      cons = c.k === 'seen' ? {...cons, seen: []} : C.removeOne(cons, c.k, c.v);
      save();
      recompute(`조건을 지웠어요: <span class="chip">${esc(c.text)}</span>`);
    }
    if (k === 'chat-swap') {
      const o = optionMap[b.dataset.key];
      if (!o) return;
      teamUI.replaceAt(o.slot, o.set);
      bot(`${nm(o.set.id)}로 교체했어요. 팀 진단을 다시 계산합니다.`);
    }
  });

  render();
  return {
    render,
    constraintsText: () => C.describe(cons).map(c => c.text),
    log: () => log.map(m => ({who: m.who, text: m.text})),
  };
}
