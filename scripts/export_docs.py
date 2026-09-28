"""data/pokechamps_mc.json → 포챔스_M-C_도감.md / 포챔스_M-C_도감.xlsx

build.py 끝에서 불립니다. 단독 실행도 됩니다: python scripts/export_docs.py
xlsx는 외부 패키지 없이 zipfile로 직접 씁니다.
"""
import json, os, re, zipfile
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TITLE = '포챔스 M-C 도감'
PERIOD = 'Pokémon Champions 레귤레이션 M-C (2026-09-09 ~ 2026-12-02)'
SEASON = '랭크 시즌 M-6 (2026-09-09 ~ 2026-10-07)'
VERSION = '게임 버전 1.2.0'
SOURCES = [
    ('Serebii', 'https://www.serebii.net/pokemonchampions/', '참전 포켓몬, 도감, 기술, 변경 기술, 메가 특성, 패치, 랭크배틀 일정'),
    ('Pikalytics', 'https://www.pikalytics.com/pokedex/gen9championsvgc2026regmc/', '사용률'),
    ('PokeAPI', 'https://pokeapi.co/', '한글 기술·특성·도구명'),
    ('나무위키', 'https://namu.wiki/w/Pok%C3%A9mon%20Champions', '참고'),
]
STONE = re.compile(r'ite( [XYZ])?$')


class Ctx:
    def __init__(self, d):
        self.d = d
        self.E, self.M, self.U = d['entries'], d['moves'], d['usage']
        self.by = {e['id']: e for e in self.E}
        self.tk = d['typeko']

    def ty(self, e): return '/'.join(self.tk[t] for t in e['ty'])
    def mv(self, i): return (self.M[i]['ko'] or self.M[i]['en']) if isinstance(i, int) else i
    def mv_en(self, i): return self.M[i]['en'] if isinstance(i, int) else i
    def item(self, n): return self.d['itemko'].get(n) or n
    def ab(self, a): return a['ko'] or a['en']
    def ab_note(self, a): return self.ab(a) + (f'({a["note"]})' if a.get('note') else '')
    def mon(self, u): return self.by[u['id']]['ko']

    def learnset(self, e):
        """타입(영문) → 한글명 순. 사이트 상세 패널과 같은 순서."""
        return sorted(set(e['mv']), key=lambda i: (self.M[i]['t'], self.M[i]['ko'] or self.M[i]['en']))

    def stones(self, u, minpct=0):
        return [(n, p) for n, p in u['it'] if STONE.search(n) and n != 'Eviolite' and p >= minpct]

    def untranslated(self):
        mv = sum(1 for m in self.M if not m['ko'])
        ab = sorted({a['en'] for e in self.E for a in e['ab'] if not a['ko']})
        return mv, ab


def pct(p, nd=1): return f'{p:.{nd}f}%'


# ---------------------------------------------------------------- markdown
def markdown(c):
    E, M, U = c.E, c.M, c.U
    species = len({e['no'] for e in E if not e['mega']})
    megas = [e for e in E if e['mega']]
    changed = sum(1 for m in M if m['ch'])
    mv_missing, ab_missing = c.untranslated()
    L = [f'# {TITLE}', '',
         f'{PERIOD} · {SEASON} · {VERSION} · 수집일 {c.d["meta"]["fetched"][:10]}', '',
         f'- 참전 포켓몬 {species}종, 폼·메가 포함 {len(E)}개 항목 (메가진화 {len(megas)}개)',
         f'- 사용 가능 기술 {len(M)}개 (스칼렛·바이올렛 대비 수치 변경 {changed}개)',
         '- 사용률: Pikalytics 집계(시뮬레이터 더블배틀 레이팅 1760+ · 대회). 게임 안 공식 랭크배틀 순위가 아님. 이름은 메가진화 전 모습으로 합산']
    if mv_missing or ab_missing:
        L.append(f'- 한글명이 확인되지 않은 기술 {mv_missing}개, 특성 {len(ab_missing)}개는 영문 표기')
    L += ['', '## 목차', '',
          '1. M-C 신규 추가 포켓몬', '2. 사용률 순위 (상위 50 세부 / 전체 목록)', '3. 메가진화',
          '4. 참전 포켓몬 종족값', '5. 기술', '6. 포켓몬별 배울 수 있는 기술', '7. 출처', '',
          '## 1. M-C 신규 추가 포켓몬 (버전 1.2.0)', '',
          ', '.join(e['ko'] for e in E if e['new']), '',
          '## 2. 사용률 순위', '', '### 상위 50 세부', '']
    for u in U[:50]:
        e = c.by[u['id']]
        L += [f'#### {u["rank"]}. {e["ko"]} ({u["id"]}) — 사용률 {u["pct"]:.2f}% · 승률 {u["win"]:.1f}%', '',
              f'- 타입: {c.ty(e)} · 종족값 {"/".join(map(str, e["st"]))} (합계 {e["bst"]})']
        if u['mv']: L.append('- 기술: ' + ', '.join(f'{c.mv(i)} {pct(p)}' for i, p in u['mv'][:8]))
        if u['it']: L.append('- 도구: ' + ', '.join(f'{c.item(n)} {pct(p)}' for n, p in u['it'][:5]))
        if u['ab']: L.append('- 특성: ' + ', '.join(f'{ko or n} {pct(p)}' for n, p, ko in u['ab'][:3]))
        if u['tm']: L.append('- 파트너: ' + ', '.join(f'{c.by[t]["ko"] if t else n} {pct(p)}' for n, p, t in u['tm'][:6]))
        L.append('')
    L += ['### 전체 순위', '', '| 순위 | 포켓몬 | 영문 | 타입 | 사용률 | 승률 |', '|---:|---|---|---|---:|---:|']
    L += [f'| {u["rank"]} | {c.mon(u)} | {u["name"]} | {c.ty(c.by[u["id"]])} | {u["pct"]:.2f}% | {u["win"]:.1f}% |' for u in U]
    L += ['', '## 3. 메가진화', '',
          '| 메가진화 | 원래 | 타입 | 특성 | HP | 공격 | 방어 | 특공 | 특방 | 스피드 | 합계 |',
          '|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|']
    L += [f'| {e["ko"]}{" (M-C 신규)" if e["new"] else ""} | {c.by[e["parent"]]["ko"]} | {c.ty(e)} | {c.ab(e["ab"][0])} | '
          + ' | '.join(map(str, e['st'])) + f' | {e["bst"]} |' for e in megas]
    L += ['', '### 포챔스 신규 특성', '']
    for x in c.d['newab']:
        n, _, desc = x.partition(' | ')
        ko = next((a['ko'] for e in E for a in e['ab'] if a['en'] == n and a['ko']), '')
        L.append(f'- {n}{f" ({ko})" if ko else ""}: {desc}')
    L += ['', '## 4. 참전 포켓몬 종족값', '',
          '| No | 포켓몬 | 영문 | 타입 | HP | 공격 | 방어 | 특공 | 특방 | 스피드 | 합계 | 특성 | 메가 |',
          '|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|']
    L += [f'| {e["no"]} | {e["ko"]} | {e["en"]} | {c.ty(e)} | ' + ' | '.join(map(str, e['st']))
          + f' | {e["bst"]} | {" / ".join(c.ab_note(a) for a in e["ab"])} | {", ".join(c.by[m]["ko"] for m in e.get("megas", []))} |'
          for e in E if not e['mega']]
    L += ['', '## 5. 기술', '',
          '| 기술 | 영문 | 타입 | 분류 | 위력 | 명중 | PP | 효과 | SV 대비 변경 |',
          '|---|---|---|---|---:|---:|---:|---|---|']
    for m in M:
        ch = m['ch']
        chs = f'SV: 위력 {ch["pw"]} / 명중 {"—" if ch["acc"] == "101" else ch["acc"]} / PP {ch["pp"]}' if ch else ''
        L.append(f'| {m["ko"] or m["en"]} | {m["en"]} | {c.tk[m["t"]]} | {m["c"]} | {m["pw"]} | {m["acc"]} | {m["pp"]} | {m["eff"].replace("|", "/")} | {chs} |')
    L += ['', '## 6. 포켓몬별 배울 수 있는 기술', '', '메가진화는 메가진화 전 모습과 같은 기술을 씁니다.', '']
    for e in E:
        if e['mega']: continue
        ls = c.learnset(e)
        L += [f'**{e["ko"]} ({e["en"]})** — {len(ls)}개: ' + ', '.join(c.mv(i) for i in ls), '']
    s = {n: (url, note) for n, url, note in SOURCES}
    L += ['## 7. 출처', '',
          f'- Serebii.net Pokémon Champions: {s["Serebii"][0]} ({s["Serebii"][1]})',
          f'- Pikalytics Champions VGC 2026 Reg M-C: {s["Pikalytics"][0]}',
          f'- PokeAPI ({s["PokeAPI"][1]}): {s["PokeAPI"][0]}',
          f'- 나무위키 Pokémon Champions ({s["나무위키"][1]}): {s["나무위키"][0]}']
    return '\n'.join(L) + '\n'


# ---------------------------------------------------------------- xlsx
# 스타일 번호 (cellXfs 순서와 맞춤)
S_TEXT, S_TITLE, S_HEAD, S_LABEL, S_PCT2, S_PCT1, S_INT, S_WRAP = range(8)
STYLES = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="165" formatCode="0.00%"/><numFmt numFmtId="166" formatCode="0.0%"/></numFmts>
<fonts count="4"><font><sz val="10"/><name val="맑은 고딕"/><family val="2"/></font><font><b/><sz val="14"/><name val="맑은 고딕"/><family val="2"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/><family val="2"/></font><font><b/><sz val="10"/><name val="맑은 고딕"/><family val="2"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2446B5"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>'''


def col(n):
    s = ''
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


class Sheet:
    """rows: 셀 목록. 셀은 값 또는 (값, 스타일). 표 형태면 첫 행을 머리글로 굵게·틀 고정·필터."""
    def __init__(self, name, widths, rows, table=True, styles=None):
        self.name, self.widths, self.rows, self.table = name, widths, rows, table
        self.styles = styles or {}  # 열 번호(0부터) → 기본 스타일

    def xml(self):
        out = []
        for r, row in enumerate(self.rows, 1):
            cells = []
            for k, v in enumerate(row):
                st = self.styles.get(k, S_TEXT)
                if isinstance(v, tuple): v, st = v
                if self.table and r == 1: st = S_HEAD
                if v is None or v == '':
                    continue
                ref = f'{col(k + 1)}{r}'
                if isinstance(v, bool): v = 'Y' if v else ''
                if isinstance(v, (int, float)):
                    cells.append(f'<c r="{ref}" s="{st}"><v>{v}</v></c>')
                else:
                    cells.append(f'<c r="{ref}" s="{st}" t="inlineStr"><is><t xml:space="preserve">{escape(str(v))}</t></is></c>')
            out.append(f'<row r="{r}">{"".join(cells)}</row>')
        ncol = max(len(r) for r in self.rows)
        dim = f'A1:{col(ncol)}{len(self.rows)}'
        pane = ('<pane xSplit="2" ySplit="1" topLeftCell="C2" activePane="bottomRight" state="frozen"/>'
                '<selection pane="bottomRight" activeCell="C2" sqref="C2"/>') if self.table else ''
        cols = ''.join(f'<col min="{i}" max="{i}" width="{w}" customWidth="1"/>' for i, w in enumerate(self.widths, 1))
        af = f'<autoFilter ref="{dim}"/>' if self.table else ''
        return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                f'<dimension ref="{dim}"/><sheetViews><sheetView workbookViewId="0">{pane}</sheetView></sheetViews>'
                f'<sheetFormatPr defaultRowHeight="15"/><cols>{cols}</cols><sheetData>{"".join(out)}</sheetData>{af}</worksheet>'), dim


def write_xlsx(path, sheets):
    ns = 'http://schemas.openxmlformats.org/'
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml',
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   f'<Types xmlns="{ns}package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                   '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
                   + ''.join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                             for i in range(1, len(sheets) + 1)) + '</Types>')
        z.writestr('_rels/.rels',
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   f'<Relationships xmlns="{ns}package/2006/relationships">'
                   f'<Relationship Id="rId1" Type="{ns}officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        defined, sh = [], []
        for i, s in enumerate(sheets, 1):
            xml, dim = s.xml()
            z.writestr(f'xl/worksheets/sheet{i}.xml', xml)
            sh.append(f'<sheet name="{escape(s.name)}" sheetId="{i}" r:id="rId{i}"/>')
            if s.table:
                a, b = dim.split(':')
                ref = "'%s'!$%s$%s:$%s$%s" % (s.name, *re.match(r'([A-Z]+)(\d+)', a).groups(), *re.match(r'([A-Z]+)(\d+)', b).groups())
                defined.append(f'<definedName name="_xlnm._FilterDatabase" localSheetId="{i - 1}" hidden="1">{escape(ref)}</definedName>')
        z.writestr('xl/workbook.xml',
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   f'<workbook xmlns="{ns}spreadsheetml/2006/main" xmlns:r="{ns}officeDocument/2006/relationships">'
                   f'<sheets>{"".join(sh)}</sheets><definedNames>{"".join(defined)}</definedNames></workbook>')
        z.writestr('xl/_rels/workbook.xml.rels',
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   f'<Relationships xmlns="{ns}package/2006/relationships">'
                   + ''.join(f'<Relationship Id="rId{i}" Type="{ns}officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>'
                             for i in range(1, len(sheets) + 1))
                   + f'<Relationship Id="rId{len(sheets) + 1}" Type="{ns}officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
        z.writestr('xl/styles.xml', STYLES)


def workbook(c):
    E, M, U = c.E, c.M, c.U
    species = len({e['no'] for e in E if not e['mega']})
    megas = [e for e in E if e['mega']]
    detail = sum(1 for u in U if u['mv'])
    mv_missing, ab_missing = c.untranslated()
    L = lambda s: (s, S_LABEL)
    guide = [[(TITLE, S_TITLE)], [],
             [L('기준'), f'{PERIOD}, {SEASON}, {VERSION}'], [L('수집일'), c.d['meta']['fetched'][:10]], [],
             [L('시트'), L('내용')],
             ['사용률순위', f'Pikalytics 기준 {len(U)}종 사용률·승률·주요 기술·도구·특성 (메가진화 전 이름으로 합산)'],
             ['포켓몬', f'참전 포켓몬 {len(E)}개 항목 ({species}종 + 지역폼·폼·메가). 종족값·특성·메가 여부·M-C 신규 여부'],
             ['메가진화', f'메가진화 {len(megas)}종과 원래 모습 대비 종족값 증가량'],
             ['기술', f'포챔스 사용 가능 기술 {len(M)}개. 스칼렛·바이올렛 대비 바뀐 수치 표시'],
             ['기술폭', '포켓몬별 배울 수 있는 기술 전체 목록'],
             ['사용률상세', f'순위별 채용 기술/도구/특성/같이 쓰이는 포켓몬 채용률 (사용률 0.3% 이상 {detail}종)'], [],
             [L('주의'), ''],
             ['', '사용률은 게임 안 공식 랭크배틀 순위가 아니라 Pikalytics의 시뮬레이터 더블배틀(레이팅 1760+)·대회 집계입니다.'],
             ['', f'한글명이 확인되지 않은 기술 {mv_missing}개, 특성 {len(ab_missing)}개는 영문으로 표시됩니다. 기술 효과 설명은 영문입니다.'
                  if mv_missing or ab_missing else '기술 효과 설명은 영문입니다.'],
             ['', '참전 명단에 없는 10종(토네로스, 앤테이, 무쇠손 등)은 사용률에서 제외했습니다.'], [],
             [L('출처'), '']] + [[n, f'{url} ({note})'] for n, url, note in SOURCES]

    rank = [['순위', '포켓몬', '영문', '타입', '사용률', '승률', '표본 게임수', '기술1', '기술2', '기술3', '기술4',
             '주요 도구', '도구 채용률', '주요 특성', '메가스톤(20%+)', 'M-C 신규']]
    for u in U:
        e = c.by[u['id']]
        mv = [c.mv(i) for i, _ in u['mv'][:4]] + [''] * 4
        it = u['it'][0] if u['it'] else ('', '')
        ab = u['ab'][0] if u['ab'] else ('', '', '')
        rank.append([u['rank'], e['ko'], u['name'], c.ty(e), u['pct'] / 100, u['win'] / 100, u['games'], *mv[:4],
                     c.item(it[0]) if it[0] else '', it[1] / 100 if it[0] else '', ab[2] or ab[0],
                     ' / '.join(c.item(n) for n, _ in c.stones(u, 20)), e['new']])

    mons = [['도감No', '포켓몬', '영문', '타입1', '타입2', 'HP', '공격', '방어', '특공', '특방', '스피드', '합계',
             '특성', '특성(영문)', '구분', '메가진화', 'M-C 신규', '사용률 순위', '배우는 기술 수']]
    for e in E:
        mons.append([e['no'], e['ko'], e['en'], c.tk[e['ty'][0]], c.tk[e['ty'][1]] if len(e['ty']) > 1 else '', *e['st'], e['bst'],
                     ' / '.join(c.ab(a) for a in e['ab']),
                     ' / '.join(a['en'] + (f' ({a["note"]})' if a.get('note') else '') for a in e['ab']),
                     e.get('form') or '', ' / '.join(c.by[m]['ko'] for m in e.get('megas', [])), e['new'],
                     e.get('use', ''), len(set(e['mv']))])

    mg = [['도감No', '메가진화', '원래 포켓몬', '타입', '특성', '특성(영문)', 'HP', '공격', '방어', '특공', '특방', '스피드',
           '합계', '원래 합계', '증가량', 'M-C 신규', '원래 사용률 순위']]
    for e in megas:
        p = c.by[e['parent']]
        mg.append([e['no'], e['ko'], p['ko'], c.ty(e), c.ab(e['ab'][0]), e['ab'][0]['en'], *e['st'], e['bst'], p['bst'],
                   e['bst'] - p['bst'], e['new'], p.get('use', '')])

    mv = [['기술', '영문', '타입', '분류', '위력', '명중', 'PP', '효과', '포챔스 변경', 'SV 위력', 'SV 명중', 'SV PP', '배우는 포켓몬 수']]
    for m in M:
        ch = m['ch'] or {}
        mv.append([m['ko'] or m['en'], m['en'], c.tk[m['t']], m['c'], m['pw'], m['acc'], m['pp'], m['eff'], bool(ch),
                   ch.get('pw', ''), '—' if ch.get('acc') == '101' else ch.get('acc', ''), ch.get('pp', ''), m['n']])

    ls = [['도감No', '포켓몬', '영문', '기술 수', '배울 수 있는 기술 (타입순)', '영문 기술명']]
    for e in E:
        if e['mega']: continue
        s = c.learnset(e)
        ls.append([e['no'], e['ko'], e['en'], len(s), ', '.join(c.mv(i) for i in s), ', '.join(c.mv_en(i) for i in s)])

    det = [['순위', '포켓몬', '구분', '이름', '영문', '채용률']]
    for u in U:
        ko = c.mon(u)
        det += [[u['rank'], ko, '기술', c.mv(i), c.mv_en(i), p / 100] for i, p in u['mv']]
        det += [[u['rank'], ko, '도구', c.item(n), n, p / 100] for n, p in u['it']]
        det += [[u['rank'], ko, '특성', k or n, n, p / 100] for n, p, k in u['ab']]
        det += [[u['rank'], ko, '파트너', c.by[t]['ko'] if t else n, n, p / 100] for n, p, t in u['tm']]

    return [
        Sheet('안내', [14, 110], guide, table=False),
        Sheet('사용률순위', [6, 18, 18, 12, 9, 8, 11, 14, 14, 14, 14, 16, 10, 16, 26, 8], rank,
              styles={4: S_PCT2, 5: S_PCT1, 6: S_INT, 12: S_PCT1}),
        Sheet('포켓몬', [8, 22, 24, 8, 8, 6, 6, 6, 6, 6, 7, 7, 34, 34, 7, 22, 8, 9, 10], mons),
        Sheet('메가진화', [8, 20, 16, 14, 18, 18, 6, 6, 6, 6, 6, 7, 7, 9, 8, 8, 10], mg),
        Sheet('기술', [16, 20, 8, 7, 6, 6, 5, 70, 9, 8, 8, 7, 10], mv, styles={7: S_WRAP}),
        Sheet('기술폭', [8, 22, 22, 8, 120, 120], ls, styles={4: S_WRAP, 5: S_WRAP}),
        Sheet('사용률상세', [6, 18, 8, 20, 22, 9], det, styles={5: S_PCT1}),
    ]


def export(data=None):
    if data is None:
        data = json.load(open(os.path.join(ROOT, 'data', 'pokechamps_mc.json'), encoding='utf-8'))
    c = Ctx(data)
    with open(os.path.join(ROOT, f'{TITLE.replace(" ", "_")}.md'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(markdown(c))
    write_xlsx(os.path.join(ROOT, f'{TITLE.replace(" ", "_")}.xlsx'), workbook(c))


if __name__ == '__main__':
    export()
