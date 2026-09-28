// 추천 봇 페이지 빌드: node scripts/build_advisor.mjs
// data/pokechamps_mc.json + src/advisor/*.mjs(@smogon/calc 포함) → site/advisor.html (단일 파일, 오프라인 동작)
import {readFileSync, writeFileSync} from 'node:fs';
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
const data = {
  entries: D.entries.map(e => ({id: e.id, no: e.no, en: e.en, ko: e.ko, ty: e.ty, st: e.st, ab: e.ab, mv: e.mv,
    mega: e.mega, parent: e.parent, megas: e.megas, use: e.use, calc: e.calc})),
  moves: D.moves.map(m => ({en: m.en, ko: m.ko, t: m.t, c: m.c, pw: m.pw, acc: m.acc})),
  usage: D.usage.map(u => ({rank: u.rank, id: u.id, pct: u.pct, win: u.win, mv: u.mv, it: u.it, ab: u.ab, tm: u.tm})),
  itemko: D.itemko, typeko: D.typeko, natureko: S.ko.nature, meta: D.meta,
  itemdict: buildItemDict(D, S),  // 스크린샷 불러오기: 도구 한글명 → 영문명
};

const out = await build({
  entryPoints: [rel('src/advisor/main.mjs')], bundle: true, minify: true, format: 'iife',
  target: ['es2020'], write: false, legalComments: 'none',
});
const js = out.outputFiles[0].text;
const noClose = s => s.replace(/<\/(script)/gi, '<\\/$1');  // 인라인 스크립트 안전 처리

const html = readFileSync(rel('scripts/advisor.html'), 'utf8')
  .replace('/*DATA*/null', () => noClose(JSON.stringify(data)))
  .replace('/*APP*/', () => noClose(js));
writeFileSync(rel('site/advisor.html'), html);
console.log(`site/advisor.html ${(html.length / 1024).toFixed(0)} KB (앱 ${(js.length / 1024).toFixed(0)} KB)`);
