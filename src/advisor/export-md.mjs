// 팀 진단 → GPT 등 다른 AI에게 붙여넣을 상담 문서(마크다운)
const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const SK = {hp: 'H', atk: 'A', def: 'B', spa: 'C', spd: 'D', spe: 'S'};

export function teamReportMarkdown({M, I, sets, result, tunes = [], constraints = [], chatLog = []}) {
  const {byId, D} = M;
  const ko = id => byId[id].ko;
  const both = (koName, en) => (koName && koName !== en ? `${koName}(${en})` : en);
  const abKo = (e, en) => { const a = e.ab.find(x => x.en === en); return a ? both(a.ko, en) : en; };
  const NK = n => D.natureko ? D.natureko[n] || n : n;
  const {base, results, pair, members} = result;
  const plan = base.plan;
  const L = [];
  const today = new Date().toISOString().slice(0, 10);

  L.push('# 포켓몬 챔피언스 팀 상담 요청', '');
  L.push('> 아래 내용을 그대로 AI(ChatGPT 등)에게 붙여넣고, 맨 아래 "요청"에 하고 싶은 말을 덧붙이세요.', '');
  L.push('## 너의 역할', '');
  L.push('너는 Pokémon Champions(포켓몬 챔피언스) 더블배틀(VGC) 전문가야. 아래는 내 팀과, 계산기 기반 추천 봇이 자동으로 낸 진단이야.',
    '봇 진단은 데미지 계산으로 만든 숫자라 참고하되, 내 의도(아래 "내가 붙인 조건")와 실전 운영 감각을 더해서 조언해줘. 답은 한국어로.', '');
  L.push('## 게임 규칙 (레귤레이션 M-C, 2026-09-09 ~ 2026-12-02)', '');
  L.push('- 더블배틀, 6마리 보여주고 4마리 선출, Lv.50',
    '- 개체값 고정, 노력치 대신 SP: 능력치당 최대 32, 합계 66 (1 SP = 실수치 +1). HP = 종족값+75+SP, 나머지 = ⌊(종족값+20+SP)×성격⌋',
    '- 같은 도감번호 1마리(종 클로즈), 같은 도구 1개(아이템 클로즈), 메가진화는 배틀당 1번', '');

  L.push('## 내 팀', '');
  L.push('| # | 포켓몬 | 도구 | 특성 | 성격 | SP (H-A-B-C-D-S) | 기술 |', '|---|---|---|---|---|---|---|');
  sets.forEach((s, i) => {
    const e = byId[s.id];
    L.push(`| ${i + 1} | ${both(e.ko, e.en)} | ${s.item ? both(M.itemKo(s.item), s.item) : '-'} | ${abKo(e, s.ability)} | ${both(NK(s.nature), s.nature)} | ${STATS.map(k => s.sp[k] || 0).join('-')} | ${s.moves.filter(Boolean).map(m => both(M.moveKo(m), m)).join(', ')} |`);
  });
  const stats = sets.map(s => { const st = M.finalStats(s); return `${ko(s.id)} ${STATS.map(k => `${SK[k]}${k === 'hp' ? st.maxHP : st[k]}`).join(' ')}`; });
  L.push('', `실수치: ${stats.join(' / ')}`, '');

  const WK = {Rain: '비', Sun: '쾌청', Sand: '모래바람', Snow: '설경'}, TK = {Grassy: '그래스필드', Psychic: '사이코필드', Electric: '일렉트릭필드', Misty: '미스트필드'};
  L.push('## 운영 방식 (봇이 감지·가정한 것)', '');
  L.push(`- 트릭룸: ${plan.tr ? `고려함 (${plan.trUser ? ko(plan.trUser) : '설정'}) — 트릭룸 있을 때·없을 때 반반으로 계산` : '고려 안 함'}`);
  L.push(`- 날씨: ${plan.weather ? `${WK[plan.weather]} (${plan.wSetter ? ko(plan.wSetter) : ''})` : '없음'} / 필드: ${plan.terrain ? `${TK[plan.terrain]} (${plan.tSetter ? ko(plan.tSetter) : ''})` : '없음'}`);
  L.push(`- 자주 만나는 상대 = 사용률 상위 ${I.threats.length}마리(Pikalytics, 사용률 1순위 세트 가정): ${I.threatIds.map(ko).join(', ')}`, '');

  const PART = {meta: '자주 만나는 상대 대응', types: '타입 약점', cover: '공격 범위', roles: '역할', syn: '파트너 궁합', mega: '메가 수', field: '상대 필드·날씨 대응'};
  L.push('## 봇 진단 요약', '');
  L.push(`- 팀 점수: **${I.pretty(base.total)} / 100** (${Object.entries(base.parts).map(([k, v]) => `${PART[k]} ${v >= 0 ? '+' : ''}${Math.round(v * 60)}`).join(', ')})`);
  if (base.danger.length) L.push(`- 약점이 몰린 타입: ${base.danger.map(t => D.typeko[t]).join(', ')}`);
  if (base.noHit.length) L.push(`- 약점으로 칠 기술이 없는 상대: ${base.noHit.map(j => ko(I.threats[j].id)).join(', ')}`);
  if (base.missing.length) L.push(`- 없는 역할: ${base.missing.join(', ')}`);
  L.push('');

  L.push('## 멤버별 기여도 (빼면 떨어지는 점수, 낮을수록 뺄 후보)', '');
  members.slice().sort((a, b) => a.contrib - b.contrib).forEach(m => {
    L.push(`- **${ko(sets[m.i].id)}** ${Math.round(m.contrib * 60)}점${m.core ? ' (핵심)' : ''}`);
    if (m.drop.length) L.push(`  - 뺄 이유: ${m.drop.join(' / ')}`);
    if (m.keep.length) L.push(`  - 남길 이유: ${m.keep.join(' / ')}`);
  });
  L.push('');

  L.push('## 봇의 교체 추천', '');
  for (const r of results) {
    L.push(`- ${ko(sets[r.slot].id)} 자리 → ${r.options.map(o => `${ko(o.set.id)}(${o.delta >= 0 ? '+' : ''}${Math.round(o.delta * 60)}점: ${o.why.map(w => w.text).join(', ') || '전체적으로 조금씩'})`).join(' / ')}`);
  }
  if (pair) L.push(`- 두 마리 동시: ${pair.slots.map(i => ko(sets[i].id)).join('·')} → ${pair.sets.map(s => ko(s.id)).join('·')} (${Math.round(pair.delta * 60)}점)`);
  L.push('');

  if (tunes.some(t => t && t.length)) {
    L.push('## 봇의 세트 다듬기 추천 (포켓몬 유지 시)', '');
    tunes.forEach((list, i) => { for (const x of list || []) L.push(`- ${ko(sets[i].id)}: ${x.text} — ${x.why}`); });
    L.push('');
  }

  if (constraints.length || chatLog.length) {
    L.push('## 내가 붙인 조건 / 봇과 나눈 대화', '');
    if (constraints.length) L.push(`- 조건: ${constraints.join(', ')}`);
    for (const m of chatLog) L.push(`- ${m.who === 'me' ? '나' : '봇'}: ${m.text}`);
    L.push('');
  }

  L.push('## 메타 참고 (사용률 상위 20, 1순위 세트)', '');
  for (const u of D.usage.slice(0, 20)) {
    const e = byId[u.id];
    const it = u.it[0], ab = u.ab[0];
    const mv = u.mv.slice(0, 4).map(([m]) => M.moveKo(typeof m === 'number' ? D.moves[m].en : m));
    L.push(`- ${u.rank}. ${e.ko} ${u.pct.toFixed(1)}% · ${it ? M.itemKo(it[0]) : '-'} · ${ab ? (ab[2] || ab[0]) : '-'} · ${mv.join(', ')}`);
  }
  L.push('');

  L.push('## 요청', '');
  L.push('1. 봇 진단(특히 뺄 후보와 교체 추천)에 동의하는지, 틀렸다면 왜인지 설명해줘.',
    '2. "내가 붙인 조건"을 지키면서 바꿀 만한 포켓몬 2~3마리와 세트(도구·특성·성격·SP·기술)를 추천해줘.',
    '3. 포켓몬을 유지한다면 기술·도구·SP를 어떻게 바꾸면 좋을지 알려줘.',
    '4. (여기에 하고 싶은 말을 적으세요)', '');
  L.push(`---`, `포챔스 추천 봇에서 ${today}에 내보냄 · https://jeseong-jeong.github.io/pokechamps-helper/`);
  return L.join('\n');
}

export function downloadText(filename, text) {
  const blob = new Blob([text], {type: 'text/markdown;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
