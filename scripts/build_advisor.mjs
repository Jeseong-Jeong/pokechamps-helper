// 추천 봇 페이지 빌드: node scripts/build_advisor.mjs
// data/pokechamps_mc.json + src/advisor/*.mjs(@smogon/calc 포함) → site/doubles.html (더블, 단일 파일, 오프라인 동작)
// data/pokechamps_mc_singles.json 이 있으면 같은 앱에 싱글 사용률을 넣어 → site/singles.html (싱글)
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {build} from 'esbuild';
import {attachCalcNames, buildItemDict} from './calc_names.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = p => path.join(ROOT, p);

const D = JSON.parse(readFileSync(rel('data/pokechamps_mc.json'), 'utf8'));
const S = JSON.parse(readFileSync(rel('raw/pchamps_serebii.json'), 'utf8'));
const missing = attachCalcNames(D);
if (missing.length) throw new Error('계산 라이브러리에 없는 포켓몬: ' + missing.join(', '));

// 페이지에 필요한 필드만
const slimUsage = U => U.map(u => ({rank: u.rank, id: u.id, pct: u.pct, win: u.win, mv: u.mv, it: u.it, ab: u.ab, tm: u.tm,
  ...(u.pick != null ? {pick: u.pick, lead: u.lead, mega: u.mega, sp: u.sp, cc: u.cc, games: u.games} : {})}));
const common = {
  entries: D.entries.map(e => ({id: e.id, no: e.no, en: e.en, ko: e.ko, ty: e.ty, st: e.st, ab: e.ab, mv: e.mv,
    mega: e.mega, parent: e.parent, megas: e.megas, use: e.use, calc: e.calc})),
  moves: D.moves.map(m => ({en: m.en, ko: m.ko, t: m.t, c: m.c, pw: m.pw, acc: m.acc})),
  itemko: D.itemko, typeko: D.typeko, natureko: S.ko.nature,
  itemdict: buildItemDict(D, S),  // 스크린샷 불러오기: 도구 한글명 → 영문명
};

const out = await build({
  entryPoints: [rel('src/advisor/main.mjs')], bundle: true, minify: !process.env.DEBUG, format: 'iife',
  target: ['es2020'], write: false, legalComments: 'none',
});
const js = out.outputFiles[0].text;
const noClose = s => s.replace(/<\/(script)/gi, '<\\/$1');  // 인라인 스크립트 안전 처리
const tpl = readFileSync(rel('scripts/advisor.html'), 'utf8');

function page(file, data, swaps = []) {
  let html = tpl;
  for (const [a, b] of swaps) {
    if (!html.includes(a)) throw new Error(`${file}: 바꿀 문구를 못 찾음 — ${a.slice(0, 60)}`);
    html = html.split(a).join(b);
  }
  html = html.replace('/*DATA*/null', () => noClose(JSON.stringify(data))).replace('/*APP*/', () => noClose(js));
  writeFileSync(rel('site/' + file), html);
  console.log(`site/${file} ${(html.length / 1024).toFixed(0)} KB (앱 ${(js.length / 1024).toFixed(0)} KB)`);
}

page('doubles.html', {...common, mode: 'doubles', usage: slimUsage(D.usage), meta: D.meta});

if (existsSync(rel('data/pokechamps_mc_singles.json'))) {
  const G = JSON.parse(readFileSync(rel('data/pokechamps_mc_singles.json'), 'utf8'));
  const m = G.meta;
  page('singles.html', {...common, mode: 'singles', usage: slimUsage(G.usage), meta: {...D.meta, singles: m}}, [
    ['<title>더블배틀 · 포챔스 배틀 도우미</title>', '<title>싱글배틀 · 포챔스 배틀 도우미</title>'],
    ['<h1>더블배틀<small>레귤레이션 M-C · 2 대 2, 6마리 중 4마리 선출 · 추천만 하고 조작은 직접</small></h1>', '<h1>싱글배틀<small>레귤레이션 M-C · 1 대 1, 6마리 중 3마리 선출 · 추천만 하고 조작은 직접</small></h1>'],
    ['<nav class="sitenav" aria-label="페이지"><a class="brand" href="index.html"><svg xmlns=\'http://www.w3.org/2000/svg\' aria-hidden=\'true\' viewBox=\'0 0 32 32\'><circle cx=\'16\' cy=\'16\' r=\'14.5\' fill=\'#fff\' stroke=\'#151A25\' stroke-width=\'2\'/><path d=\'M1.5 16a14.5 14.5 0 0 1 29 0z\' fill=\'#E3350D\' stroke=\'#151A25\' stroke-width=\'2\'/><path d=\'M1.5 16h29\' stroke=\'#151A25\' stroke-width=\'3\'/><circle cx=\'16\' cy=\'16\' r=\'4.6\' fill=\'#fff\' stroke=\'#151A25\' stroke-width=\'2.4\'/></svg>포챔스 배틀 도우미</a><a class="pillbtn" href="singles.html">싱글배틀</a><a class="pillbtn on" aria-current="page" href="doubles.html">더블배틀</a><a class="pillbtn" href="dex.html">도감</a></nav>', '<nav class="sitenav" aria-label="페이지"><a class="brand" href="index.html"><svg xmlns=\'http://www.w3.org/2000/svg\' aria-hidden=\'true\' viewBox=\'0 0 32 32\'><circle cx=\'16\' cy=\'16\' r=\'14.5\' fill=\'#fff\' stroke=\'#151A25\' stroke-width=\'2\'/><path d=\'M1.5 16a14.5 14.5 0 0 1 29 0z\' fill=\'#E3350D\' stroke=\'#151A25\' stroke-width=\'2\'/><path d=\'M1.5 16h29\' stroke=\'#151A25\' stroke-width=\'3\'/><circle cx=\'16\' cy=\'16\' r=\'4.6\' fill=\'#fff\' stroke=\'#151A25\' stroke-width=\'2.4\'/></svg>포챔스 배틀 도우미</a><a class="pillbtn on" aria-current="page" href="singles.html">싱글배틀</a><a class="pillbtn" href="doubles.html">더블배틀</a><a class="pillbtn" href="dex.html#singles">도감</a></nav>'],
    ['빠진 역할(속이다·스피드 조절·위협 등)', '빠진 역할(스텔스록·랭크업 에이스·선공기 등)'],
    ['4마리 조합 15개를 "상대 각 포켓몬에 대한 가장 좋은 대답"으로 평가하고, 메가가 2마리 이상이면 누구를 메가진화할지까지 골라 계산합니다. 선봉은 상대 전체 압박과 속이다·스피드 조절·위협 조합으로 고릅니다.',
     '3마리 조합 20개를 "상대 각 포켓몬에 대한 가장 좋은 대답"으로 평가합니다. 상대가 실제로 데려올 확률(선출률)이 높은 포켓몬일수록 크게 봅니다. 선봉은 상대가 선봉으로 낼 확률(선봉률)이 높은 포켓몬과의 대면으로 고르고, 상대 파티 성향(대면·사이클·랭크업)에 맞는 역할에 점수를 더합니다.'],
    ['<a href="https://www.pikalytics.com/pokedex/gen9championsvgc2026regmc/" target="_blank" rel="noopener">Pikalytics</a>\n    사용률 1순위 특성·도구·기술이며, 능력치 배분은 사용률 데이터에 없어서 공격형 예시로 채웁니다.',
     `쇼다운 싱글 M-C(BSS Reg M-C) 공개 대전 ${m.battles}판(${m.since}~)을 직접 모은 사용률·선출률·선봉률과, <a href="https://www.smogon.com/stats/" target="_blank" rel="noopener">Smogon 통계</a>(${m.smogon ? m.smogon.month + ' ' + m.smogon.format : '-'})의 능력치 배분·기술·도구입니다.`],
  ]);
}
