// 도감 항목 id → @smogon/calc 종 이름. 종족값까지 같은지 확인해서 붙임
import {Generations} from '@smogon/calc';

const GEN = Generations.get(0);
const toID = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIAS = {'Mega Meowstic': 'Meowstic-M-Mega', 'Aegislash': 'Aegislash-Shield'};

export function calcName(e) {
  const cands = [ALIAS[e.id], e.id, e.en,
    e.id.replace(/^Mega (.+?)(?: ([XYZ]))?$/, (m, a, s) => a + '-Mega' + (s ? '-' + s : ''))].filter(Boolean);
  for (const c of cands) {
    const s = GEN.species.get(toID(c));
    if (s && Object.values(s.baseStats).join(',') === e.st.join(',')) return s.name;
  }
  return null;
}

export function attachCalcNames(D) {
  const missing = [];
  for (const e of D.entries) {
    e.calc = calcName(e);
    if (!e.calc) missing.push(e.id);
  }
  return missing;
}
