// Pikalytics 수집 스크립트 (브라우저 콘솔용)
// 사용법: https://www.pikalytics.com/pokedex/gen9championsvgc2026regmc/ 를 연 뒤 콘솔에 붙여넣고 실행.
//        요청 간격을 두고 한 마리씩 받으므로 5~15분 걸립니다(빠르게 보내면 429로 막힘).
//        끝나면 pchamps_pikalytics.json 이 다운로드됩니다 → ../raw/ 로 옮기고 build.py 실행.
// FORMAT / API_KEY 는 페이지 네트워크 요청(/api/l/...)에서 확인한 값. 레귤레이션이 바뀌면 여기만 수정.
(async () => {
  const FORMAT = 'gen9championsvgc2026regmc';
  const API = '/api/l/2026-05/' + FORMAT + '-1760';
  const MIN_PCT = 0.3;          // 이 사용률 이상만 세부 데이터 수집
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const L = await fetch(API).then(r => r.json());
  const list = L.map(x => ({ name: x.name, rank: +x.rank, pct: +x.percent, win: +x.winPercent, games: x.games, types: x.types, stats: x.stats || null }));

  function parse(d) {
    const out = {};
    for (const h of d.querySelectorAll('h2')) {
      const m = h.textContent.trim().match(/^Best (Moves|Teammates|Items|Abilities)/); if (!m) continue;
      let sec = h.parentElement;
      while (sec && sec.querySelectorAll('h2').length === 1 && !sec.querySelector('.pokedex-inline-right')) sec = sec.parentElement;
      out[m[1]] = [...sec.querySelectorAll('.pokedex-inline-right')].map(r => {
        const e = r.parentElement; const pct = parseFloat(r.textContent);
        // 비율·타입 표시는 요소째 빼고 이름만 읽음 (끝 글자를 정규식으로 지우면 Stealth Rock → Stealth 처럼 잘림)
        const c = (e.querySelector('.pokedex-inline-text-offset') || e.querySelector('.pokedex-inline-text') || e).cloneNode(true);
        c.querySelectorAll('.pokedex-inline-right, .type').forEach(x => x.remove());
        return [c.textContent.replace(/\s+/g, ' ').trim(), pct];
      });
    }
    return out;
  }
  const cut = (a, n) => (a || []).filter(x => x[1] >= 0.3).slice(0, n);
  const detail = {};
  for (const x of list.filter(x => x.pct >= MIN_PCT)) {
    for (let tries = 0; tries < 4; tries++) {
      const r = await fetch('/pokedex/' + FORMAT + '/' + encodeURIComponent(x.name));
      if (r.status === 429) { await sleep(30000); continue; }
      const o = parse(new DOMParser().parseFromString(await r.text(), 'text/html'));
      detail[x.name] = { Moves: cut(o.Moves, 12), Items: cut(o.Items, 8), Abilities: cut(o.Abilities, 4), Teammates: cut(o.Teammates, 8) };
      break;
    }
    console.log('done', x.rank, x.name);
    await sleep(1800);
  }
  const blob = new Blob([JSON.stringify({ fetched: new Date().toISOString(), list, detail })], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'pchamps_pikalytics.json'; document.body.appendChild(a); a.click();
})();
