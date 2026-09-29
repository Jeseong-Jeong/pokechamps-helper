import json, re, sys, os
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
from collections import defaultdict

S = json.load(open(os.path.join(ROOT, 'raw', 'pchamps_serebii.json'), encoding='utf-8'))
P = json.load(open(os.path.join(ROOT, 'raw', 'pchamps_pikalytics.json'), encoding='utf-8'))
KO = S['ko']
# raw/ko_extra.json: GraphQL에 없던 한글명을 PokeAPI REST에서 보충한 것 (scripts/fetch_ko_extra.js)
_extra = os.path.join(ROOT, 'raw', 'ko_extra.json')
if os.path.exists(_extra):
    for _k, _v in json.load(open(_extra, encoding='utf-8')).items():
        KO.setdefault(_k, {}).update({n: ko for n, ko in _v.items() if ko})
KO_ALIAS = {'Compoundeyes': 'Compound Eyes'}  # Serebii 표기 → PokeAPI 표기

def ko_of(kind, n):
    # PokeAPI는 King’s Rock 처럼 굽은 따옴표를 씀
    for k in (n, n.replace("'", '’'), KO_ALIAS.get(n)):
        if k and KO[kind].get(k):
            return KO[kind][k]
    return ''

TYPE_KO = dict(normal='노말', fire='불꽃', water='물', grass='풀', electric='전기', ice='얼음', fighting='격투',
               poison='독', ground='땅', flying='비행', psychic='에스퍼', bug='벌레', rock='바위', ghost='고스트',
               dragon='드래곤', dark='악', steel='강철', fairy='페어리')
NEW_MC = ["Wigglytuff", "Persian", "Farfetch'd", "Mr. Mime", "Swalot", "Mega Absol Z", "Salamence", "Mega Salamence",
          "Mega Garchomp Z", "Mega Lucario Z", "Gogoat", "Golisopod", "Mega Golisopod", "Rillaboom", "Cinderace",
          "Inteleon", "Thievul", "Toxtricity", "Grapploct", "Perrserker", "Sirfetch'd", "Pincurchin", "Indeedee",
          "Pawmot", "Arboliva", "Squawkabilly", "Mabosstiff", "Baxcalibur", "Mega Baxcalibur"]
REGION = {'a': ('Alola', '알로라 '), 'g': ('Galar', '가라르 '), 'h': ('Hisui', '히스이 '), 'p': ('Paldea', '팔데아 '),
          'e': ('Eternal', '영원의 꽃 ')}
NEW_AB_KO = {}  # champions-only abilities: keep English

# ---------- moves ----------
moves = []
midx = {}
for name, typ, cat, pp, pw, acc, eff in S['moves']:
    midx[name] = len(moves)
    moves.append(dict(en=name, ko=ko_of('move', name), t=typ, c={'physical': '물리', 'special': '특수', 'other': '변화'}.get(cat, cat),
                      pp=pp, pw=pw, acc=('—' if acc == '101' else acc), eff=eff, ch=None, n=0))
# updated attacks (Champions vs S/V)
u = S['extra']['upd'][1:]
i = 0
while i < len(u) - 1:
    a = [x.strip() for x in u[i].split('|')]
    b = [x.strip() for x in u[i + 1].split('|')]
    if len(a) >= 5 and a[1] == 'Champions' and b[0] == 'S/V':
        nm = a[0]
        if nm in midx:
            moves[midx[nm]]['ch'] = dict(pp=b[1], pw=b[2], acc=b[3])
        i += 2
    else:
        i += 1

def ab_ko(n):
    return ko_of('ability', n)

# ---------- species ----------
roster = S['roster']
bys = defaultdict(list)
for r in roster:
    bys[r[4]].append(r)

entries = []

def mk(**kw):
    e = dict(**kw)
    e['bst'] = sum(e['st'])
    entries.append(e)
    return e

def parse_abil(raw):
    raw = (raw or '').strip()
    out = []
    pos = 0
    for m in re.finditer(r'\(([^)]+)\)', raw):
        grp = raw[pos:m.start()]
        pos = m.end()
        for nm in [x.strip() for x in grp.split('-') if x.strip()]:
            out.append((nm, m.group(1).strip()))
    for nm in [x.strip() for x in raw[pos:].split('-') if x.strip()]:
        out.append((nm, None))
    return out

def abil_for(parsed, species_en, form_label, is_base):
    res = []
    for nm, ann in parsed:
        if ann is None:
            res.append(dict(en=nm, ko=ab_ko(nm)))
            continue
        a = ann.replace(' Form', '')
        base_like = ann == species_en or ann in ('Midday Form', 'Male')
        if base_like:
            if is_base: res.append(dict(en=nm, ko=ab_ko(nm)))
        elif 'Hidden Ability' in ann or ann in ('Green & Blue', 'Yellow & White'):
            res.append(dict(en=nm, ko=ab_ko(nm), note=ann.replace('Male Hidden Ability','수컷 숨특').replace('Female Hidden Ability','암컷 숨특').replace('Green & Blue','그린·블루').replace('Yellow & White','옐로·화이트')))
        else:
            if not is_base and a[:4].lower() in (form_label or '').lower():
                res.append(dict(en=nm, ko=ab_ko(nm)))
    # dedupe
    seen=set(); r2=[]
    for x in res:
        k=(x['en'],x.get('note'))
        if k not in seen: seen.add(k); r2.append(x)
    return r2

def moves_for(sec, form_label, is_base):
    tables = sec['moves']
    chosen = None
    for t in tables:
        lab = t['label']
        if lab == 'Special Moves':
            continue
        is_std = lab in ('Standard Moves', 'Standard Moves - Male') or (lab.startswith('Standard Moves - ') and len(tables) == 1)
        if is_base and is_std:
            chosen = t; break
        if not is_base and form_label:
            key = form_label.replace('Alolan', 'Alola').replace('Galarian', 'Galar').replace('Hisuian', 'Hisui').replace('Paldean', 'Paldea').split()[0]
            if key.lower()[:4] in lab.lower() and lab != 'Standard Moves':
                chosen = t; break
    if chosen is None:
        chosen = next((t for t in tables if t['label'] in ('Standard Moves', 'Standard Moves - Male')), tables[0])
    return [x for x in chosen['list'] if x in midx]

EXTRA_FORMS = {
    'Blade Forme': ('Aegislash-Blade', '킬가르도 (블레이드폼)', ['steel', 'ghost']),
    'Hero Form': ('Palafin-Hero', '돌핀맨 (마이티폼)', ['water']),
    'Small Variety': ('Gourgeist-Small', '펌킨인 (작은 사이즈)', ['ghost', 'grass']),
    'Large Variety': ('Gourgeist-Large', '펌킨인 (큰 사이즈)', ['ghost', 'grass']),
    'Jumbo Variety': ('Gourgeist-Super', '펌킨인 (특대 사이즈)', ['ghost', 'grass']),
    'Midnight Form': ('Lycanroc-Midnight', '루가루암 (한밤중의 모습)', ['rock']),
    'Dusk Form': ('Lycanroc-Dusk', '루가루암 (황혼의 모습)', ['rock']),
}
ROTOM = [('Rotom-Heat', '히트로토무', 'fire', 'Overheat'), ('Rotom-Wash', '워시로토무', 'water', 'Hydro Pump'),
         ('Rotom-Frost', '프로스트로토무', 'ice', 'Blizzard'), ('Rotom-Fan', '스핀로토무', 'flying', 'Air Slash'),
         ('Rotom-Mow', '커트로토무', 'grass', 'Leaf Storm')]

for slug, rows in bys.items():
    dx = S['dex'][slug]
    secs = dx['sections']
    base = secs[0]
    megasecs = [s for s in secs if s['kind'] == 'mega']
    base_rows = [r for r in rows if not r[1].startswith('Mega ')]
    mega_rows = [r for r in rows if r[1].startswith('Mega ')]
    species_en = base_rows[0][1] if base_rows else rows[0][1]
    parsed = parse_abil(base['abil'])
    ids_this = []
    for k, r in enumerate(base_rows):
        no, en, img, types, _ = r
        st = base['stats'][k]
        suf = img.replace('.png', '').split('-')[1] if '-' in img else ''
        ko = base['ko'] or ''
        pid = en
        label = st['label']
        if suf in REGION:
            ko = REGION[suf][1] + ko
            pid = en + '-' + REGION[suf][0]
            if suf == 'p': pid = 'Tauros-Paldea-Combat'; ko = '팔데아 켄타로스 (컴뱃종)'
        is_base = (k == 0 and suf in ('', 'e'))
        ab = abil_for(parsed, species_en, label, is_base or suf == 'e')
        mv = moves_for(base, label, is_base or suf == 'e')
        e = mk(id=pid, no=int(no), en=en if not suf or suf == 'e' else f'{en} ({REGION[suf][0]})', ko=ko,
               ty=types.split('/'), st=st['v'], ab=ab, mv=[midx[m] for m in mv], mega=False, new=en in NEW_MC,
               img=img, form=None)
        ids_this.append(e)
    # gendered / extra forms
    for st in base['stats'][len(base_rows):]:
        lab = st['label']
        if lab == 'Female':
            nm = 'Indeedee-F' if 'indeedee' in slug else 'Basculegion-F'
            ko = (base['ko'] or '') + ' (암컷)'
            ab = abil_for(parsed, species_en, 'Female', False)
            ftable = next((t for t in base['moves'] if t['label'].endswith('Female')), base['moves'][0])
            mk(id=nm, no=ids_this[0]['no'], en=species_en + ' (Female)', ko=ko, ty=ids_this[0]['ty'], st=st['v'], ab=ab,
               mv=[midx[m] for m in ftable['list'] if m in midx], mega=False, new=ids_this[0]['new'], img=ids_this[0]['img'], form='성별')
            ids_this[0]['ko'] += ' (수컷)' if nm == 'Indeedee-F' or nm == 'Basculegion-F' else ''
            ids_this[0]['id'] = ids_this[0]['id']
        elif lab == 'Alternate Forms':  # Rotom
            special = next((t for t in base['moves'] if t['label'] == 'Special Moves'), {'list': []})
            for pid, ko, t2, sp in ROTOM:
                mk(id=pid, no=479, en=pid.replace('-', ' '), ko=ko, ty=['electric', t2], st=st['v'], ab=[dict(en='Levitate', ko=ab_ko('Levitate'))],
                   mv=ids_this[0]['mv'] + ([midx[sp]] if sp in midx else []), mega=False, new=False, img=ids_this[0]['img'], form='폼')
        elif lab in EXTRA_FORMS:
            pid, ko, ty = EXTRA_FORMS[lab]
            if pid.startswith('Lycanroc'):
                ab = abil_for(parsed, species_en, lab, False)
                mv = moves_for(base, lab.split()[0], False)
                mv = [midx[m] for m in mv]
            else:
                ab = ids_this[0]['ab']; mv = ids_this[0]['mv']
            mk(id=pid, no=ids_this[0]['no'], en=pid.replace('-', ' '), ko=ko, ty=ty, st=st['v'], ab=ab, mv=mv, mega=False,
               new=ids_this[0]['new'], img=ids_this[0]['img'], form='폼')
    if 'lycanroc' in slug: ids_this[0]['ko'] += ' (한낮의 모습)'
    if 'toxtricity' in slug:
        ids_this[0]['ab'] = [dict(en='Punk Rock', ko=ab_ko('Punk Rock')), dict(en='Plus', ko=ab_ko('Plus'), note='하이한 모습'),
                             dict(en='Minus', ko=ab_ko('Minus'), note='로우한 모습'), dict(en='Technician', ko=ab_ko('Technician'))]
    # megas
    for k, r in enumerate(mega_rows):
        no, en, img, types, _ = r
        sec = megasecs[k]
        st = sec['stats'][0]
        ko = sec['ko'] or ''
        m = re.search(r' ([XYZ])$', en)
        if m and not ko.endswith(m.group(1)): ko += ' ' + m.group(1)
        parent = ids_this[0]
        abn = sec['abil'] or ''
        e = mk(id=en, no=int(no), en=en, ko=ko, ty=types.split('/'), st=st['v'], ab=[dict(en=abn, ko=ab_ko(abn))],
               mv=parent['mv'], mega=True, new=en in NEW_MC, img=img, form='메가', parent=parent['id'])
        parent.setdefault('megas', []).append(en)

# learn counts
for e in entries:
    if not e['mega']:
        for m in set(e['mv']):
            moves[m]['n'] += 1

# ---------- usage ----------
usage = []
if P:
    def norm(s): return re.sub(r'[^a-z0-9]', '', s.lower().replace('’', '').replace("'", ''))
    byid = {norm(e['id']): e for e in entries}
    byid.update({norm(e['en']): e for e in entries if not e['mega']})
    alias = {'floetteeternal': 'Floette', 'indeedee': 'Indeedee', 'basculegion': 'Basculegion',
             'sirfetchd': "Sirfetch'd", 'farfetchd': "Farfetch'd", 'mrmime': 'Mr. Mime', 'mrrime': 'Mr. Rime',
             'aegislash': 'Aegislash', 'lycanroc': 'Lycanroc', 'toxtricity': 'Toxtricity', 'toxtricitylowkey': 'Toxtricity',
             'palafin': 'Palafin', 'gourgeist': 'Gourgeist', 'meowsticf': 'Meowstic', 'squawkabillyblue': 'Squawkabilly',
             'squawkabillyyellow': 'Squawkabilly', 'squawkabillywhite': 'Squawkabilly', 'mimikyu': 'Mimikyu',
             'tauros paldeacombat': 'Tauros-Paldea-Combat', 'maushold': 'Maushold', 'mausholdfour': 'Maushold',
             'vivillon': 'Vivillon', 'furfrou': 'Furfrou', 'alcremie': 'Alcremie', 'polteageist': 'Polteageist', 'sinistcha': 'Sinistcha'}
    itemko = {}
    def ek(name):
        k = norm(name)
        if k in byid: return byid[k]
        if k in alias and norm(alias[k]) in byid: return byid[norm(alias[k])]
        base = name.split('-')[0]
        if base in ('Vivillon','Alcremie','Maushold','Meowstic','Squawkabilly','Toxtricity','Gourgeist','Furfrou','Polteageist','Sinistcha','Mimikyu','Florges','Minior'):
            return byid.get(norm(base))
        return None
    mnorm = {norm(m['en']): i for i, m in enumerate(moves)}
    def move_idx(n):
        # 예전 scrape_pikalytics.js는 기술명 끝의 타입 글자를 지워 'Stealth'(Rock), 'Accele'(rock)처럼 잘린 이름을 남김
        if n in midx: return midx[n]
        for t in TYPE_KO:
            if norm(n) + t in mnorm: return mnorm[norm(n) + t]
        return n
    def stone_ko(n, e):
        # 신규 메가스톤은 PokeAPI에 한글명이 없는 경우가 많음 → 공식 표기 규칙 '<포켓몬>나이트' + X/Y/Z
        m = re.search(r'ite(?: ([XYZ]))?$', n)
        if not m or not e or not e.get('megas'): return ''
        suf = m.group(1) or ''
        cand = [x for x in e['megas'] if (re.search(r' ([XYZ])$', x) or [None, ''])[1] == suf]
        if len(cand) != 1: return ''
        mega_ko = next(x for x in entries if x['id'] == cand[0])['ko']  # '메가앱솔 Z'
        return re.sub(r'^메가|\s*[XYZ]$', '', mega_ko).strip() + '나이트' + suf
    unmatched = []
    D = P['detail']
    # Pikalytics M-C 페이지의 특성 표는 이름이 틀림 (엘풍 'Trace 82%' 등 — 원본 사이트 버그).
    # 대회 데이터(championstournaments) → M-B 랭크 순으로 받아 둔 특성을 쓰고, M-C 값은 그 포켓몬이 가질 수 있는 것만 남김.
    abp = os.path.join(ROOT, 'raw', 'pchamps_abilities.json')
    AB = json.load(open(abp, encoding='utf-8'))['data'] if os.path.exists(abp) else {}
    ab_src = {}
    def legal_ab(e):
        names = {a['en'] for a in e['ab']}
        for m in e.get('megas', []):
            names |= {a['en'] for a in next(x for x in entries if x['id'] == m)['ab']}
        return names
    def pick_ab(name, e, mc):
        ok = legal_ab(e)
        for src in ('championstournaments', 'gen9championsvgc2026regmb'):
            raw = [[n, p] for n, p in ((AB.get(name) or {}).get(src) or []) if p > 0]
            lst = [[n, p] for n, p in raw if n in ok]
            # 대부분이 가질 수 없는 특성이면 그 출처는 믿지 않음
            if lst and sum(p for _, p in lst) >= 0.5 * sum(p for _, p in raw):
                ab_src[src] = ab_src.get(src, 0) + 1
                return lst
        lst = [[n, p] for n, p in mc if n in ok]
        ab_src['mc' if lst else 'none'] = ab_src.get('mc' if lst else 'none', 0) + 1
        return lst
    for x in P['list']:
        if x['pct'] <= 0: continue
        e = ek(x['name'])
        if e is None:
            unmatched.append(x['name'])
            continue
        det = D.get(x['name'], {})
        for it, _ in det.get('Items', []):
            itemko[it] = itemko.get(it) or ko_of('item', it) or stone_ko(it, e)
        tm = []
        for n, p in det.get('Teammates', []):
            te = ek(n)
            tm.append([n, p, te['id'] if te else None])
        mvu = [[move_idx(n), p] for n, p in det.get('Moves', []) if n.strip()]
        abu = [[n, p, ab_ko(n)] for n, p in pick_ab(x['name'], e, det.get('Abilities', []))]
        usage.append(dict(rank=x['rank'], name=x['name'], id=e['id'] if e else None, pct=x['pct'], win=x['win'], games=x['games'],
                          mv=mvu, it=det.get('Items', []), ab=abu, tm=tm))
        if e is not None and 'use' not in e:
            e['use'] = x['rank']
    print('unmatched', unmatched, file=sys.stderr)
    print('ability source', ab_src, file=sys.stderr)
else:
    itemko = {}

out = dict(entries=entries, moves=moves, usage=usage, itemko={k: v for k, v in itemko.items() if v},
           teamko={}, typeko=TYPE_KO, newab=S['extra']['newab'][1:],
           meta=dict(fetched=S['fetched'], pfetched=(P or {}).get('fetched')))
with open(os.path.join(ROOT, 'data', 'pokechamps_mc.json'), 'w', encoding='utf-8', newline='\n') as f:
    json.dump(out, f, ensure_ascii=False, indent=1)

# ---------- page ----------
by = {e['id']: e for e in entries}
def kon(n):
    return by['Mega ' + n[:-5]]['ko'] if n.endswith('-Mega') else by[n]['ko']
C3 = [('Rillaboom / Salamence-Mega / Sneasler', '14.2%'), ('Incineroar / Rillaboom / Sneasler', '11.5%'),
      ('Gholdengo / Rillaboom / Salamence-Mega', '8.9%'), ('Kingambit / Rillaboom / Sneasler', '8.9%'),
      ('Kingambit / Rillaboom / Salamence-Mega', '8.8%')]  # Pikalytics 3-core list, copied by hand
cores = {'c3': [[' · '.join(kon(x) for x in a.split(' / ')), b] for a, b in C3]}
tpl = open(os.path.join(HERE, 'template.html'), encoding='utf-8').read()
# 싱글 사용률 (scripts/build_singles.mjs 가 만든 파일이 있으면 도감의 '싱글' 탭에 넣음)
sgp = os.path.join(ROOT, 'data', 'pokechamps_mc_singles.json')
sg = json.load(open(sgp, encoding='utf-8')) if os.path.exists(sgp) else None
if sg:
    sg = dict(meta=sg['meta'], usage=[{k: u[k] for k in ('rank', 'name', 'id', 'pct', 'win', 'games', 'pick', 'lead', 'mega', 'mv', 'it', 'ab', 'tm', 'sp', 'cc')} for u in sg['usage']])
html = (tpl.replace('/*DATA*/null', json.dumps(out, ensure_ascii=False, separators=(',', ':'))).replace('/*CORES*/null', json.dumps(cores, ensure_ascii=False))
        .replace('/*SINGLES*/null', json.dumps(sg, ensure_ascii=False, separators=(',', ':'))))
with open(os.path.join(ROOT, 'site', 'pokechamps-mc.html'), 'w', encoding='utf-8', newline='\n') as f:
    f.write(html)

# ---------- csv ----------
import csv
CSV = os.path.join(ROOT, 'data', 'csv')
os.makedirs(CSV, exist_ok=True)
def w(name, header, rows):
    with open(os.path.join(CSV, name), 'w', newline='', encoding='utf-8-sig') as f:
        c = csv.writer(f, lineterminator='\n'); c.writerow(header); c.writerows(rows)
w('pokemon.csv', ['id', 'dex_no', 'name_ko', 'name_en', 'type1', 'type2', 'hp', 'atk', 'def', 'spa', 'spd', 'spe', 'bst',
                  'abilities_en', 'abilities_ko', 'is_mega', 'mega_of', 'megas', 'form_kind', 'new_in_mc', 'usage_rank', 'learnset_size'],
  [[e['id'], e['no'], e['ko'], e['en'], e['ty'][0], e['ty'][1] if len(e['ty']) > 1 else '', *e['st'], e['bst'],
    ' / '.join(a['en'] + (f" ({a['note']})" if a.get('note') else '') for a in e['ab']),
    ' / '.join((a['ko'] or a['en']) for a in e['ab']), int(e['mega']), e.get('parent', ''), ' / '.join(e.get('megas', [])),
    e.get('form') or '', int(e['new']), e.get('use', ''), len(set(e['mv']))] for e in entries])
w('moves.csv', ['move_en', 'move_ko', 'type', 'category', 'power', 'accuracy', 'pp', 'effect', 'changed_vs_sv', 'sv_power', 'sv_accuracy', 'sv_pp', 'learner_count'],
  [[m['en'], m['ko'], m['t'], m['c'], m['pw'], m['acc'], m['pp'], m['eff'], int(bool(m['ch'])),
    *( [m['ch']['pw'], m['ch']['acc'], m['ch']['pp']] if m['ch'] else ['', '', ''] ), m['n']] for m in moves])
w('learnsets.csv', ['pokemon_id', 'pokemon_ko', 'move_en', 'move_ko'],
  [[e['id'], e['ko'], moves[i]['en'], moves[i]['ko']] for e in entries if not e['mega'] for i in sorted(set(e['mv']), key=lambda i: moves[i]['en'])])
w('usage.csv', ['rank', 'pikalytics_name', 'pokemon_id', 'pokemon_ko', 'usage_pct', 'win_pct', 'games'],
  [[u['rank'], u['name'], u['id'], by[u['id']]['ko'], u['pct'], u['win'], u['games']] for u in usage])
rows = []
for u in usage:
    for i, p in u['mv']: rows.append([u['rank'], u['id'], 'move', moves[i]['en'] if isinstance(i, int) else i, moves[i]['ko'] if isinstance(i, int) else '', p])
    for n, p in u['it']: rows.append([u['rank'], u['id'], 'item', n, out['itemko'].get(n, ''), p])
    for n, p, ko in u['ab']: rows.append([u['rank'], u['id'], 'ability', n, ko, p])
    for n, p, tid in u['tm']: rows.append([u['rank'], u['id'], 'teammate', n, by[tid]['ko'] if tid else '', p])
w('usage_details.csv', ['rank', 'pokemon_id', 'kind', 'name_en', 'name_ko', 'pct'], rows)

# ---------- md / xlsx ----------
sys.path.insert(0, HERE)
import export_docs
export_docs.export(out)
print(len(entries), 'entries', sum(1 for e in entries if e['mega']), 'megas', len(moves), 'moves', len(usage), 'usage', file=sys.stderr)
