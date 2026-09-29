# 포챔스 M-C 도감 데이터

Pokémon Champions(포켓몬 챔피언스) 레귤레이션 M-C 기준 데이터 묶음입니다.
참전 포켓몬, 종족값, 특성, 배울 수 있는 기술, 메가진화, 기술 수치, 사용률 순위가 들어 있습니다.
이 데이터로 만든 **추천 봇**도 함께 있습니다 — 더블(`site/advisor.html`)과 싱글(`site/singles.html`). 봇은 추천만 하고 게임 조작은 사람이 직접 합니다.

## 싱글 (site/singles.html)

더블과 같은 앱(탭 5개)을 싱글 규칙으로 돌립니다. 첫 화면(`site/index.html`)에서 **싱글 / 더블 / 도감** 중 골라 들어가고, 파티·배틀 기록은 싱글·더블 따로 저장됩니다(싱글은 `pcs-…` 키).

- **데이터**: Pikalytics·Smogon 월간 통계에 싱글 M-C가 아직 없어서, 쇼다운 `[Gen 9 Champions] BSS Reg M-C` 공개 대전 기록을 직접 모아 집계합니다
  (`scripts/fetch_bss_replays.mjs` → `raw/pchamps_bss_mc.json`, 받은 기록은 `raw/_cache/bss/`에 캐시·git 제외).
  - 기록에서: 사용률(파티에 넣은 비율)·승률·**선출률**(파티에 있을 때 데려온 비율)·**선봉률**·메가진화율·같이 쓰는 포켓몬, 드러난 기술·도구·특성.
  - 똑같은 6마리 파티(대여·복붙)가 30% 가까이 반복돼서 1/√(반복 수)로 가중치를 낮추고, 레이팅이 높은 판을 조금 더 믿습니다.
  - 성격·SP 배분·천적은 기록에 안 나와서 Smogon 싱글 통계(현재 `2026-08 gen9championsbssregmb 1630`, `scripts/fetch_smogon_bss.mjs` → `raw/smogon_bss.json`)로 채웁니다.
  - `scripts/build_singles.mjs`가 둘을 합쳐 `data/pokechamps_mc_singles.json`(더블 usage와 같은 모양 + pick·lead·mega·sp·cc)을 만듭니다. M-C 싱글 Smogon 통계가 나오면 `fetch_smogon_bss.mjs 2026-09 gen9championsbssregmc`로 바꾸세요.
- **팀 추천·진단**: 싱글 역할(스텔스록·압정, 유턴 교체, 랭크업 에이스, 선공기, 상태이상, 회복, 스카프·기합의띠, 위협)로 점수. 기본 세트의 능력치 배분은 Smogon 1순위 배분.
- **선출 추천**: 6마리 중 **3마리 + 선봉 1마리**. 상대 쪽은 선출률로 무게를 두고, 선봉은 상대의 선봉 확률(선출률×선봉률)과의 대면으로 고릅니다. 먼저 맞고 한 방에 쓰러지는 선봉은 감점(첫 KO를 내준 쪽 승률 31.6%).
  기합의띠·옹골참은 HP 가득일 때 한 방을 버티는 것으로 계산(연속기 제외).
- **상대 파티 성향**: 대면 / 사이클 / 랭크업 점수(도구·기술·특성 채용률 × 가중치, 일본·한국 BSS 커뮤니티 분류 기준)와 키워드 밑 한 줄 설명, ⓘ를 누르면 어떤 파티인지·강한/약한 상대·상대법.
  성향에 맞는 역할(랭크업 상대 → 선공기·상태이상, 사이클 상대 → 랭크업·설치기, 대면 상대 → 선공기·스카프)에 가산. 상성 삼각형은 대면 > 랭크업 > 사이클 > 대면.
- **배틀 도우미**: 1대1 화면. 교체 예측은 쇼다운 M-C 싱글 기록에서 잰 교체율(뒤가 있는 턴 12.9%, 4배 30%, 2배 17.5%, 능력 하락 21.8%, 설치기 직후 20.4%, 랭크업 직후 3.3% …)을 기준으로
  데미지 계산(먼저 잡힘·먼저 잡을 수 있음·기합의띠)과 뒤 포켓몬 대면으로 보정합니다(최대 60%). 교체해 들어올 후보는 두 마리로 나눠 계산하고, 아직 안 나온 상대는 선출률로 "데려왔을 확률"을 추정합니다.
  랭크업(다음 턴 화력 증가·흑안개/울부짖기/앵콜/천진 위험)·스텔스록·압정(3마리 싸움이라 가치 낮춤, 기합의띠·바위 4배면 가산)·상태이상(챔피언스: 마비 12.5%, 잠듦 최대 3턴)·회복·유턴을 행동 후보로 넣고,
  설치기는 교체해 들어올 때 피해를 줍니다(턴 결과에 기록하면 자동 반영). 상대가 아직 메가진화를 안 했으면 필드의 메가스톤 포켓몬이 이번 턴에 메가진화한다고 보고 계산("메가 안 함"으로 끌 수 있음).

## 추천 봇 — 더블 (site/advisor.html)

더블클릭해서 브라우저로 열면 됩니다(인터넷 없이 동작, 입력값은 브라우저에 저장).

| 기능 | 상태 |
|---|---|
| 데미지 계산 — 포켓몬·SP·성격·특성·도구·랭크·상태이상·날씨·필드·벽을 넣으면 기술별 데미지%와 확정 몇 타, 스피드 비교 | ✅ |
| 팀 추천 — 넣은 포켓몬에 맞춰 다음 팀원 후보를 점수·이유와 함께 추천, 6마리 자동 채우기, 팀 약점·역할·스피드 분석 | ✅ |
| 팀 진단 — 팀 점수·문제점, 가장 약한 1~2마리를 뺄 때 넣으면 좋은 포켓몬(2마리 동시 교체 포함), 포켓몬을 유지할 때 기술·도구·성격·SP 다듬기 (적용 버튼) | ✅ |
| 팀 진단 채팅·내보내기 — 추천이 의도와 다르면 말로 조건을 붙여 다시 추천(규칙 기반, 무료): "메가 말고", "풀 4배 싫어", "고릴타한테 안 죽는 애", "OO 빼지 마", "OO 대신", "왜 OO를 빼래?", "OO는 어때?", "다른 애". 진단 전체를 GPT에 붙여넣을 .md로 다운로드 | ✅ |
| 선출 추천 — 상대 6마리를 넣으면 낼 4마리·선봉 2마리·메가진화할 포켓몬, 게임 플랜(1턴 행동·후발), 상대별 대응 멤버·기술, 한 방에 여러 마리를 잡는 상대 경고, 6×6 상성표. 트릭룸·날씨 담당을 데려갈 때만 그 상황으로 계산. 상대 파티 성향(트릭룸·순풍·날씨·필드·유인+랭크업·밸런스) 키워드와 ⓘ 설명 | ✅ |
| 스크린샷으로 파티 불러오기 — 게임 팀 화면(능력·스테이터스 탭) 캡처를 올리면 종·특성·도구·기술·성격·SP를 읽어 팀에 넣음 | ✅ |
| 배틀 도우미 — 양쪽 필드 2마리·HP·상태·랭크·날씨·필드·트릭룸·순풍·벽을 넣으면 상대 행동 예측과 이번 턴 추천 행동 1~3순위(공격 대상·방어·속이다·트릭룸·순풍·유인·교체). 상대를 넣으면 사용률 기술·도구·특성·스피드 범위·같이 나오는 포켓몬 표시 | ✅ |

- 데미지 계산은 [@smogon/calc](https://github.com/smogon/damage-calc)의 챔피언스 규칙을 씁니다.
  Lv.50, 개체값 고정, SP(능력치당 최대 32, 합계 66). HP = 종족값+75+SP, 나머지 = ⌊(종족값+20+SP)×성격⌋.
- 기본 세트는 Pikalytics 사용률 1순위 특성·도구·기술입니다. 능력치 배분 데이터는 없어서 공격형 예시(공격 또는 특공 32, 스피드 32, HP 2)로 채웁니다.
- 위협, 필드 특성(그래스메이커 등)은 자동 적용되지 않으니 랭크·필드를 직접 맞추세요.
- 팀 진단(`src/advisor/improve.mjs`): 팀 점수 = 자주 만나는 상대(사용률 상위 20마리, 사용률 1순위 세트)와 서로 가장 센 기술로 주고받는 데미지·스피드
  + 타입 약점 + 약점으로 못 치는 상대 + 역할(속이다·스피드 조절·위협) + 파트너 궁합 − 메가 과다.
  교체 추천은 사용률 0.5% 이상 후보를 전부 넣어 보고(브라우저에서 약 5초), 트릭룸 팀의 트릭룸 사용자는 핵심으로 보고 빼지 않습니다.
  세트 다듬기는 방어 계열 누락, 채용률 낮은 기술·도구, 기술과 안 맞는 성격, 남는 SP, 스피드 기준점, 확정으로 버티는 내구 기준점을 찾고 적용 시 점수 변화를 보여줍니다.
  운영 방식: 트릭룸 기술이 있으면 "트릭룸 있을 때/없을 때" 반반, 날씨·필드 특성(잔비·가뭄·○○메이커 등)이 있으면 그 날씨·필드 위에서 계산합니다(자동 감지, 화면에서 켜고 끌 수 있음).
  상대가 날씨·필드를 까는 포켓몬이면 그 필드 위 싸움도 같이 계산하고(서로 다르면 평균), 아이언롤러·아이스스피너·자기 필드 특성으로 상대 필드에 대응하는 멤버는 가산합니다.
  "빼는 걸 추천하는 멤버"는 빼도 점수가 가장 덜 떨어지는 멤버와 그 이유(겹치는 약점·역할, 다른 멤버가 더 잘 받는 상대)·남길 이유(혼자 막는 상대·역할, 트릭룸·날씨에서 강해짐, 필드 제거)를 보여줍니다.
  방어·회복 효과는 점수에 반영되지 않습니다.
- 스크린샷 불러오기는 [Tesseract.js](https://github.com/naptha/tesseract.js)로 브라우저 안에서 글자를 읽습니다(이미지를 서버로 보내지 않음, 처음 쓸 때 엔진·한국어 데이터를 jsdelivr에서 내려받음).
  읽은 이름은 도감·기술·특성·도구 목록과 한글 자모 단위로 비교해 가장 비슷한 것으로 맞추고, 성격·SP는 실수치에서 역산합니다(`src/advisor/party-import.mjs`). 확신이 낮은 칸은 노란색으로 표시되니 확인 후 넣으세요.
- 배틀 도우미(`src/advisor/battle.mjs`): 상대는 가장 많이 들어가는 기술·대상을 고른다고 예측(기술을 가졌을 가능성 = 채용률 반영, 방금 나왔으면 속이다, 공격이 약한 서포터는 날 따르라·분노가루).
  상대 수비 선택도 규칙으로 예측: 내가 먼저 확정으로 잡거나 4배를 찌를 수 있으면 방어(방어가 있고 지난 턴에 안 썼으면) 또는 뒤의 포켓몬 중 내 공격을 가장 잘 받는 쪽으로 교체(방금 나왔거나 나를 잡을 수 있으면 확률 낮춤).
  상대마다 공격/방어/교체 확률로 경우의 수를 나누고, 내 두 마리 행동 조합을 경우마다 한 턴 모의 진행해 확률 평균 점수로 추천합니다.
  턴이 끝나면 "턴 결과 기록"에서 실제로 일어난 일(공격 기술·방어·교체 대상·쓰러짐·남은 HP)을 누르면(HP는 게이지를 누르거나 끌어서, 맨 왼쪽 = 1%·쓰러짐은 버튼) 다음 턴 필드가 자동으로 바뀌고, 배틀 기록에 예측과 실제(✓/✗)가 남습니다. 상대가 쓴 기술은 확인된 기술로 계산에 들어갑니다.
  행동 순서 = 우선도 → 스피드(트릭룸이면 반대), 속이다 풀죽음(정신력 제외)·유인·방어·와이드가드·도우미·지진류 아군 피격·사이코필드 선공기 봉쇄를 반영합니다. 방금 나온 포켓몬의 날씨·필드 특성은 자동 적용됩니다.
- 팀 추천 점수 = 파트너 궁합(Pikalytics 같이 쓰인 비율, 양방향 평균) + 팀 약점 보완 + 빠진 역할(속이다·스피드 조절·위협·유인·날씨/필드·전체 공격) + 사용률·승률 − 메가 과다.
  종 클로즈(같은 도감번호 1마리)와 아이템 클로즈(같은 도구 1개)를 지키고, 메가스톤 채용률 40% 이상이면 메가 세트로 넣습니다.

빌드·테스트 (Node 18+ 필요, 처음 한 번 `npm install`):

```bash
npm run build           # 싱글 데이터 → 도감 → 추천 봇(더블·싱글) 전부
npm run build:advisor   # site/advisor.html, site/singles.html 만들기
npm run fetch:singles   # 쇼다운 싱글 대전 기록 새로 받기 + Smogon 싱글 통계 (네트워크 필요)
npm test                # 계산 로직 테스트
```

- 레귤레이션 M-C: 2026-09-09 ~ 2026-12-02 / 랭크 시즌 M-6: 2026-09-09 ~ 2026-10-07
- 게임 버전 1.2.0(2026-09-09) 기준
- 수집일: 2026-09-28

## 웹사이트 (GitHub Pages)

- 주소: https://jeseong-jeong.github.io/pokechamps-mc/ (첫 화면 → 싱글 / 더블 / 도감)
- 저장소: https://github.com/Jeseong-Jeong/pokechamps-mc
- `site/` 폴더가 그대로 사이트가 됩니다. 고친 뒤에는 빌드 → 커밋 → 배포:

```bash
npm run build:advisor
git add -A && git commit -m "..." && git push
npm run deploy          # site/ 만 gh-pages 브랜치로 올림, 1~2분 뒤 반영
```

## 폴더 구성

```
pokechamps-mc/
├─ README.md                  이 파일
├─ 포챔스_M-C_도감.md          전체 데이터를 읽기 좋게 정리한 문서 (build.py가 생성)
├─ 포챔스_M-C_도감.xlsx        같은 내용의 엑셀 (시트 7개, build.py가 생성)
├─ data/
│  ├─ pokechamps_mc.json      가공된 전체 데이터 (도감·더블 사용률)
│  ├─ pokechamps_mc_singles.json 싱글 사용률 (build_singles.mjs가 생성)
│  └─ csv/                    같은 데이터를 표로 풀어놓은 것 (UTF-8 BOM, 엑셀에서 바로 열림)
│     ├─ pokemon.csv          340행: 포켓몬·폼·메가 1개당 1행
│     ├─ moves.csv            512행: 사용 가능 기술
│     ├─ learnsets.csv        포켓몬 × 배울 수 있는 기술 (1행 = 1쌍)
│     ├─ usage.csv            277행: 사용률 순위
│     └─ usage_details.csv    순위별 채용 기술/도구/특성/같이 쓰는 포켓몬 (long format)
├─ raw/                       사이트에서 긁어온 원본 (가공 전)
│  ├─ pchamps_serebii.json
│  ├─ pchamps_pikalytics.json
│  ├─ pchamps_abilities.json  더블 특성 (Pikalytics 대회 데이터 — M-C 페이지 특성 표가 틀려서 따로 받음)
│  ├─ pchamps_bss_mc.json     싱글 M-C 쇼다운 대전 기록 집계 (fetch_bss_replays.mjs)
│  ├─ smogon_bss.json         Smogon 싱글 통계 요약 (fetch_smogon_bss.mjs)
│  └─ ko_extra.json           PokeAPI REST에서 보충한 한글명 (fetch_ko_extra.js가 생성)
├─ package.json               추천 봇 빌드용 (npm install → @smogon/calc, esbuild)
├─ src/advisor/
│  ├─ model.mjs               계산·추천 로직 (DOM 없음, 테스트 대상)
│  └─ main.mjs                추천 봇 화면
├─ tests/model.test.mjs       node --test 로 도는 계산 테스트
├─ scripts/
│  ├─ build.py                raw → data/*.json, data/csv/*, site/*.html, 도감 md/xlsx 생성
│  ├─ export_docs.py          도감 md/xlsx 생성 (build.py가 호출, 단독 실행도 가능)
│  ├─ fetch_ko_extra.js       빠진 한글명 보충용 Node 스크립트
│  ├─ template.html           도감 페이지 템플릿 (/*DATA*/ 자리에 JSON 주입)
│  ├─ advisor.html            추천 봇 페이지 템플릿
│  ├─ build_advisor.mjs       추천 봇 빌드 (src + 데이터 → site/advisor.html 한 파일)
│  ├─ calc_names.mjs          도감 id → @smogon/calc 종 이름 매칭
│  ├─ scrape_serebii.js       원본 재수집용 브라우저 콘솔 스크립트
│  └─ scrape_pikalytics.js    원본 재수집용 브라우저 콘솔 스크립트
└─ site/
   ├─ index.html              첫 화면 (싱글 / 더블 / 도감)
   ├─ pokechamps-mc.html      완성된 단일 파일 도감 페이지 (싱글 | 더블 탭)
   ├─ advisor.html            추천 봇 — 더블
   └─ singles.html            추천 봇 — 싱글
```

## 다시 빌드하기

```bash
python scripts/build.py       # Python 3.8+, 외부 패키지 없음 (xlsx도 표준 라이브러리로 씀)
```

raw 폴더의 JSON을 읽어 `data/`, `site/`, `포챔스_M-C_도감.md`, `포챔스_M-C_도감.xlsx`를 모두 새로 만듭니다.
md/xlsx는 직접 고치지 말고 `scripts/export_docs.py`를 고친 뒤 다시 빌드하세요.

## 데이터를 새로 받기 (시즌·레귤레이션 갱신 시)

두 사이트 모두 서버에서 바로 받으면 막히는 경우가 있어서, 브라우저 콘솔에서 돌리는 방식으로 만들었습니다.

1. `https://www.serebii.net/pokemonchampions/pokemon.shtml` 열기 → F12 콘솔에 `scripts/scrape_serebii.js` 붙여넣기 → `pchamps_serebii.json` 다운로드
2. `https://www.pikalytics.com/pokedex/gen9championsvgc2026regmc/` 열기 → 콘솔에 `scripts/scrape_pikalytics.js` 붙여넣기 → 5~15분 뒤 `pchamps_pikalytics.json` 다운로드
3. 두 파일을 `raw/`에 덮어쓰고 `python scripts/build.py`
4. 한글명 보충: `node scripts/fetch_ko_extra.js` (Node 18+) → `python scripts/build.py` 한 번 더

레귤레이션이 바뀌면 확인할 것:
- `scrape_pikalytics.js`의 `FORMAT`, `API` 값 (Pikalytics 페이지 네트워크 탭의 `/api/l/...` 요청에서 확인)
- `build.py`의 `NEW_MC` 목록 (해당 패치의 추가 포켓몬, Serebii `patch.shtml` 참고)
- `build.py`의 `C3` (Pikalytics 메인의 3마리 코어, 손으로 옮겨 적은 값)
- `template.html` 상단의 레귤레이션/시즌 날짜 문구

## pokechamps_mc.json 스키마

```jsonc
{
  "entries": [            // 포켓몬·폼·메가 340개
    {
      "id": "Venusaur",     // 고유 키. 폼은 "Raichu-Alola", "Rotom-Wash", 메가는 "Mega Venusaur"
      "no": 3,              // 전국도감 번호
      "en": "Venusaur", "ko": "이상해꽃",
      "ty": ["grass","poison"],
      "st": [80,82,83,100,100,80],   // HP 공격 방어 특공 특방 스피드
      "bst": 525,
      "ab": [{"en":"Overgrow","ko":"심록","note":"(선택) 수컷 숨특 등"}],
      "mv": [2,12,46,...],  // moves 배열 인덱스. 메가는 메가 전 모습과 같은 기술폭
      "mega": false,        // 이 항목이 메가진화 형태인지
      "megas": ["Mega Venusaur"],   // (메가 가능할 때만) 메가 항목 id
      "parent": "Venusaur", // (메가일 때만) 메가진화 전 id
      "form": null,         // null | "메가" | "폼" | "성별"
      "new": false,         // M-C(1.2.0)에서 새로 추가됨
      "use": 49,            // (있으면) 사용률 순위
      "img": "003.png"      // Serebii 이미지 파일명 (폼 구분용: -a 알로라, -g 가라르, -h 히스이, -p 팔데아, -m 메가)
    }
  ],
  "moves": [              // 512개, entries[].mv / usage[].mv 가 이 인덱스를 참조
    {"en":"Accelerock","ko":"액셀록","t":"rock","c":"물리","pw":"40","acc":"100","pp":"20",
     "eff":"효과 설명(영문)","ch":null /* 또는 {"pw","acc","pp"}: 스칼렛·바이올렛 수치 */,"n":2 /* 배우는 포켓몬 수 */}
  ],
  "usage": [              // 277개, Pikalytics 순위
    {"rank":1,"name":"Rillaboom","id":"Rillaboom","pct":37.18,"win":51.803,"games":29118,
     "mv":[[moveIndex, pct]], "it":[["Life Orb",28.1]], "ab":[["Grassy Surge",99.2,"그래스메이커"]],
     "tm":[["Incineroar",39.1,"Incineroar"]]}   // tm 세 번째 값 = entries id (없으면 null)
  ],
  "itemko": {"Life Orb":"생명의구슬"},  // 사용률에 나온 도구의 한글명
  "typeko": {"grass":"풀"},
  "newab": ["Piercing Drill | 효과..."],  // 포챔스 신규 특성
  "meta": {"fetched":"...","pfetched":"..."}
}
```

## 알아둘 점

- **사용률은 게임 안 공식 순위가 아닙니다.** Pikalytics가 대전 시뮬레이터 더블배틀(레이팅 1760 이상)과 대회 데이터로 집계한 값입니다. 이름은 메가진화 전 모습으로 합산되고, 메가 사용 여부는 도구(메가스톤) 채용률로 확인합니다.
- 세부 채용 데이터(기술/도구/특성/파트너)는 사용률 0.3% 이상인 153종만 있고, 나머지는 사용률·승률만 있습니다.
- 참전 명단에 없는 10종(토네로스, 앤테이, 무쇠손, 팔데아 켄타로스 워터종·블레이즈종 등)은 사용률에서 뺐습니다.
- 한글명: 포켓몬은 Serebii, 기술·특성·도구는 PokeAPI 기준입니다. GraphQL(베타)에 없는 9세대 이름은 PokeAPI REST에서 받아 `raw/ko_extra.json`에 보충했습니다.
  - 그래도 없는 포챔스 신규 특성 3개(Aura Guard, Eelevate, Fire Mane)는 `ko`가 빈 문자열입니다(화면에는 영문 표시).
  - PokeAPI에 없는 신규 메가스톤은 공식 표기 규칙(`<포켓몬>나이트` + X/Y/Z)으로 만든 이름입니다. 예: Golisopite → 갑주무사나이트.
- 예전 `scrape_pikalytics.js`는 사용률 기술명 끝을 잘라먹는 버그가 있었습니다(Stealth Rock → Stealth). 수집 스크립트는 고쳤고, 기존 raw 데이터는 `build.py`가 복원합니다.
- 기술 효과 설명(`eff`)은 영문입니다.
- 로토무 가전 폼 5종은 Serebii에 종족값이 하나로만 나와 있어 같은 값을 쓰고, 각 폼 전용 기술(오버히트 등)을 더했습니다.

## 출처

- Serebii.net Pokémon Champions: https://www.serebii.net/pokemonchampions/ (참전 포켓몬, 도감 `/pokedex-champions/`, 사용 가능 기술, 변경 기술, 메가 특성, 신규 특성, 패치, 랭크배틀 일정)
- Pikalytics Champions VGC 2026 Reg M-C: https://www.pikalytics.com/pokedex/gen9championsvgc2026regmc/
- PokeAPI GraphQL: https://beta.pokeapi.co/graphql/v1beta (한글 기술·특성·도구명)
- 나무위키 Pokémon Champions (레귤레이션별 참전 정보 참고)
