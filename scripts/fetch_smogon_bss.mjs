// Smogon 월간 통계(싱글 BSS)에서 기술·도구·특성·능력치 배분·동료·천적을 받아 raw/smogon_bss.json 으로 줄여 저장
// 쇼다운 기록으로는 성격·SP 배분을 알 수 없어서 이걸로 채움.
// 사용법: node scripts/fetch_smogon_bss.mjs [월 YYYY-MM] [형식] [레이팅]
//   기본값: 2026-08 gen9championsbssregmb 1630  (M-C 싱글 통계가 나오면 형식을 gen9championsbssregmc 로)
import {writeFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [MONTH = '2026-08', FORMAT = 'gen9championsbssregmb', RATING = '1630'] = process.argv.slice(2);
const url = `https://www.smogon.com/stats/${MONTH}/chaos/${FORMAT}-${RATING}.json`;
const j = await fetch(url).then(r => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });

const top = (o, n) => {
  const tot = Object.values(o || {}).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(o || {}).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => [k, +(100 * v / tot).toFixed(2)]);
};
const data = {};
for (const [name, d] of Object.entries(j.data)) {
  if (d.usage < 0.001) continue;
  const raw = d['Raw count'] || 1;
  data[name] = {
    usage: +(100 * d.usage).toFixed(3), raw,
    // 기술은 한 마리가 4개라 합이 400% → 판 수 대비 비율로
    mv: Object.entries(d.Moves || {}).filter(([k]) => k).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => [k, +(100 * v / raw).toFixed(2)]),
    it: top(d.Items, 8), ab: top(d.Abilities, 4), sp: top(d.Spreads, 6),
    tm: Object.entries(d.Teammates || {}).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => [k, +(100 * v / raw).toFixed(2)]),
    // 천적: [상대, 이 포켓몬이 지는 비율 p] — 표본(n) 20 이상만
    cc: Object.entries(d['Checks and Counters'] || {}).filter(([, v]) => v.n >= 20).sort((a, b) => b[1].p - a[1].p).slice(0, 10)
      .map(([k, v]) => [k, +(100 * v.p).toFixed(1), Math.round(v.n)]),
  };
}
writeFileSync(join(ROOT, 'raw', 'smogon_bss.json'), JSON.stringify({fetched: new Date().toISOString(), month: MONTH, format: FORMAT, rating: +RATING,
  battles: j.info['number of battles'], data}));
console.log(FORMAT, MONTH, RATING, '→', Object.keys(data).length, '마리,', j.info['number of battles'], '판');
