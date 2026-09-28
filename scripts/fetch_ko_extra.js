// 한글명 보충 스크립트 (Node 18+): node scripts/fetch_ko_extra.js
// PokeAPI GraphQL(scrape_serebii.js)에서 빠진 9세대 기술·특성·도구 한글명을 PokeAPI REST에서 받아
// raw/ko_extra.json 에 합칩니다. 순서: build.py → 이 스크립트 → build.py 다시 실행.
// 기존 값은 유지하고, 새로 찾은 것만 더합니다. PokeAPI에도 없는 이름은 영문 그대로 둡니다.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'raw', 'ko_extra.json');
const D = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'pokechamps_mc.json'), 'utf8'));
const extra = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
for (const k of ['move', 'ability', 'item']) extra[k] = extra[k] || {};

const slug = s => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const want = {
  move: D.moves.filter(m => !m.ko).map(m => m.en),
  ability: [...new Set(D.entries.flatMap(e => e.ab).filter(a => !a.ko).map(a => a.en))],
  item: [...new Set(D.usage.flatMap(u => u.it).map(i => i[0]).filter(n => !D.itemko[n]))],
};

(async () => {
  for (const [kind, names] of Object.entries(want)) {
    let found = 0;
    for (const n of names) {
      const r = await fetch(`https://pokeapi.co/api/v2/${kind}/${slug(n)}`);
      const ko = r.ok ? ((await r.json()).names.find(x => x.language.name === 'ko') || {}).name : null;
      if (ko) { extra[kind][n] = ko; found++; }
    }
    console.log(`${kind}: ${names.length}개 중 ${found}개 찾음`);
  }
  fs.writeFileSync(OUT, JSON.stringify(extra, null, 1) + '\n');
})();
