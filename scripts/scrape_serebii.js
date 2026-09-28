// Serebii 수집 스크립트 (브라우저 콘솔용)
// 사용법: 브라우저에서 https://www.serebii.net/pokemonchampions/pokemon.shtml 을 연 뒤
//        개발자 도구 콘솔에 이 파일 내용을 붙여넣고 실행 → pchamps_serebii.json 다운로드
// 결과 파일을 ../raw/pchamps_serebii.json 으로 옮기고 scripts/build.py 를 실행하세요.
(async () => {
  const norm = s => s.replace(/\s+/g, ' ').trim();
  const img = c => { const i = c.querySelector('img'); return i ? i.getAttribute('src').split('/').pop().replace(/\.(gif|png)$/, '') : ''; };
  const page = async u => new DOMParser().parseFromString(await fetch(u).then(r => r.text()), 'text/html');
  const biggest = d => [...d.querySelectorAll('table')].sort((a, b) => b.rows.length - a.rows.length)[0];

  // 1) 참전 포켓몬 목록: [도감번호, 이름, 이미지파일(폼 구분), 타입, 도감 링크]
  const roster = [];
  for (const r of biggest(document).rows) {
    const c = r.cells; if (c.length < 4) continue;
    const no = c[0].innerText.trim(); if (!no.startsWith('#')) continue;
    const a = r.querySelector('a'); const pic = c[1].querySelector('img');
    const types = [...c[3].querySelectorAll('img')].map(i => (i.src.split('/').pop() || '').replace(/\.(gif|png)$/, ''));
    roster.push([no.slice(1), c[2].innerText.trim(), pic ? pic.src.split('/').pop() : '', types.join('/'), a ? a.getAttribute('href') : '']);
  }

  // 2) 포켓몬별 도감 페이지: 한글명, 특성, 종족값(폼별), 기술표(폼별), 메가진화 섹션
  async function parse(slug) {
    const d = await page(slug);
    const res = { slug, sections: [] };
    let cur = { kind: 'base', name: 'base', stats: [], moves: [], abil: null, ko: null }; res.sections.push(cur);
    for (const t of d.querySelectorAll('table.dextable')) {
      const txt = norm(t.innerText);
      const m = txt.match(/^(Mega .+?) Picture/);
      if (m && t.rows.length <= 3) { cur = { kind: 'mega', name: m[1], stats: [], moves: [], abil: null, ko: null }; res.sections.push(cur); continue; }
      if (txt.startsWith('Name') && txt.includes('Korean:')) { const k = txt.match(/Korean: (.+?) National/); if (k) cur.ko = k[1].trim(); continue; }
      if (txt.startsWith('Abilities:')) { cur.abil = norm(t.rows[0].innerText).replace(/^Abilities:\s*/, ''); continue; }
      if (txt.includes('Base Stats - Total')) {
        const lab = norm(txt.split('HP')[0].replace(/^Stats/, '').replace(/^\s*-\s*/, ''));
        const row = [...t.rows].find(r => r.innerText.includes('Base Stats'));
        cur.stats.push({ label: lab, v: [...row.cells].slice(1).map(c => parseInt(c.innerText)).filter(n => !isNaN(n)) });
        continue;
      }
      const r0 = t.rows[0] ? norm(t.rows[0].innerText) : '';
      if (r0.includes('Moves') && t.querySelector('a[href*="attackdex-champions"]')) {
        const mv = [...t.querySelectorAll('a[href*="/attackdex-champions/"]')].map(a => norm(a.innerText)).filter(Boolean);
        cur.moves.push({ label: r0, list: [...new Set(mv)] });
      }
    }
    return res;
  }
  const slugs = [...new Set(roster.map(r => r[4]))];
  const dex = {}; let i = 0;
  await Promise.all(Array.from({ length: 6 }, async () => { while (i < slugs.length) { const s = slugs[i++]; dex[s] = await parse(s); } }));

  // 3) 사용 가능 기술 / 메가 특성 / 신규 특성 / 변경 기술
  const mt = biggest(await page('/pokemonchampions/moves.shtml'));
  const moves = [...mt.rows].slice(1).filter(r => r.cells.length >= 7).map(r => { const c = r.cells;
    return [c[0].innerText.trim(), img(c[1]), img(c[2]), c[3].innerText.trim(), c[4].innerText.trim(), c[5].innerText.trim(), c[6].innerText.trim()]; });
  const rowsOf = d => [...biggest(d).rows].map(r => [...r.cells].map(c => c.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | ')).filter(Boolean);
  const extra = {
    mega: rowsOf(await page('/pokemonchampions/megaabilities.shtml')),
    newab: rowsOf(await page('/pokemonchampions/newabilities.shtml')),
    upd: rowsOf(await page('/pokemonchampions/updatedattacks.shtml')),
  };

  // 4) 한글 기술·특성·도구·성격 이름 (PokeAPI GraphQL, language 3=ko, 9=en)
  const q = `{ mv: pokemon_v2_movename(where:{language_id:{_in:[3,9]}}){ name move_id language_id }
    ab: pokemon_v2_abilityname(where:{language_id:{_in:[3,9]}}){ name ability_id language_id }
    it: pokemon_v2_itemname(where:{language_id:{_in:[3,9]}}){ name item_id language_id }
    na: pokemon_v2_naturename(where:{language_id:{_in:[3,9]}}){ name nature_id language_id } }`;
  const g = await fetch('https://beta.pokeapi.co/graphql/v1beta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: q }) }).then(r => r.json());
  const grp = (arr, key) => { const o = {}; for (const x of arr) (o[x[key]] = o[x[key]] || {})[x.language_id] = x.name; const m = {}; for (const k in o) if (o[k][9] && o[k][3]) m[o[k][9]] = o[k][3]; return m; };
  const ko = { move: grp(g.data.mv, 'move_id'), ability: grp(g.data.ab, 'ability_id'), item: grp(g.data.it, 'item_id'), nature: grp(g.data.na, 'nature_id') };

  const blob = new Blob([JSON.stringify({ fetched: new Date().toISOString(), roster, dex, moves, extra, ko })], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'pchamps_serebii.json'; document.body.appendChild(a); a.click();
})();
