// 스크린샷으로 파티 불러오기: 업로드 → 글자 인식 → 확인·수정 → 팀에 넣기
import {recognize, fileToImage} from './ocr.mjs';
import {createPartyReader} from './party-import.mjs';
import {NATURES, STAT_KO} from './model.mjs';

const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

export function initImport({M, itemDict, esc, ty, $, findMon, natureko, onImport}) {
  const {byId} = M;
  const reader = createPartyReader(M, itemDict);
  const itemsKo = Object.entries(itemDict).sort((a, b) => a[0].localeCompare(b[0], 'ko'));
  let rows = [];   // 6칸: {set, baseId, warn, found} 또는 못 읽은 칸 {empty: true}
  let rawText = '';
  let busy = false;

  const panel = $('import-panel');
  const status = t => { $('imp-status').innerHTML = t; };

  function open() { panel.hidden = false; panel.scrollIntoView({block: 'nearest'}); }
  function close() { panel.hidden = true; rows = []; rawText = ''; $('imp-review').innerHTML = ''; status(''); $('imp-file').value = ''; }

  async function handle(files) {
    files = [...files].filter(f => f.type.startsWith('image/')).slice(0, 2);
    if (!files.length || busy) return;
    busy = true;
    $('imp-review').innerHTML = '';
    try {
      const shots = [];
      for (const [i, f] of files.entries()) {
        const img = await fileToImage(f);
        status(`${i + 1}/${files.length}번째 이미지 읽는 중…`);
        const shot = await recognize(img, {
          onProgress: m => {
            if (m.status === 'recognizing text') status(`${i + 1}/${files.length}번째 이미지 읽는 중… ${Math.round(m.progress * 100)}%`);
            else if (/load|initializ/.test(m.status)) status('글자 인식 엔진 준비 중… (처음 한 번만, 수 MB 내려받음)');
          },
          enough: s => reader.cards(reader.phrases(s.words), s.width).length >= 4,
        });
        shots.push(shot);
      }
      window.__pcLastShots = shots;  // 인식 문제 확인용 (개발자 도구에서 볼 수 있음)
      rawText = shots.map((sh, k) => `[${k + 1}번째 이미지]\n` + reader.phrases(sh.words).map(p => p.text).join('\n')).join('\n\n');
      const out = reader.readSlots(shots);
      const found = out.filter(Boolean);
      if (!found.length) {
        status('<span class="bad">포켓몬 이름을 찾지 못했습니다.</span> 게임의 팀 화면(능력 또는 스테이터스 탭)을 잘리지 않게 캡처해서 올려 주세요.');
        rows = [];
        $('imp-review').innerHTML = rawBox();
      } else {
        rows = out.map(r => r || {empty: true});
        const miss = 6 - found.length;
        const warn = found.filter(r => r.warn.length).length;
        const hasStats = found.some(r => r.found.stats);
        status(`${found.length}마리를 읽었습니다.${miss ? ` <b>${miss}칸</b>은 못 읽어서 비워 두었습니다(이름을 직접 입력).` : ''}${warn ? ` <b>${warn}마리</b>는 확인이 필요합니다(노란 칸).` : ''}${hasStats ? '' : ' 스테이터스 화면도 올리면 성격·SP까지 들어갑니다.'} 틀린 곳을 고친 뒤 <b>팀에 넣기</b>를 누르세요.`);
        renderReview();
      }
    } catch (e) {
      status(`<span class="bad">${esc(e.message || e)}</span>`);
    } finally {
      busy = false;
    }
  }

  function natureLabel(n) {
    const [up, down] = NATURES[n];
    return `${natureko[n] || n}${up ? ` (${STAT_KO[up]}↑${STAT_KO[down]}↓)` : ''}`;
  }

  function rawBox() {
    return rawText ? `<details class="imp-raw"><summary>인식된 글자 보기 (잘 안 읽히면 이 내용을 복사해서 알려 주세요)</summary><textarea readonly rows="10">${esc(rawText)}</textarea></details>` : '';
  }

  function renderReview() {
    const n = rows.filter(r => !r.empty).length;
    $('imp-review').innerHTML = rows.map((r, i) => {
      if (r.empty) {
        return `<div class="imp-row" data-i="${i}"><div class="imp-h"><span class="num">${i + 1}</span>
          <input class="pick warn" list="mon-list" data-f="name" placeholder="못 읽음 · 포켓몬 이름 입력" aria-label="${i + 1}번 포켓몬"></div></div>`;
      }
      const s = r.set, e = byId[s.id], base = byId[r.baseId];
      const w = k => (r.warn.includes(k) ? ' warn' : '');
      const ls = M.learnset(e).slice().sort((a, b) => (a.ko || a.en).localeCompare(b.ko || b.en, 'ko'));
      const items = s.item && !itemsKo.some(([, en]) => en === s.item) ? [[M.itemKo(s.item), s.item], ...itemsKo] : itemsKo;
      return `<div class="imp-row" data-i="${i}">
        <div class="imp-h">
          <span class="num">${i + 1}</span>
          <input class="pick${w('이름')}" list="mon-list" data-f="name" value="${esc(base.ko)} · ${esc(base.en)}" aria-label="${i + 1}번 포켓몬">
          <span class="types">${e.ty.map(ty).join('')}</span>
          ${s.id !== r.baseId ? `<span class="badge b-mega">${esc(e.ko)}</span>` : ''}
          <span class="mini">${r.found.stats ? '성격·SP 읽음' : '성격·SP 기본값'}</span>
        </div>
        <div class="imp-g">
          <label>특성<select data-f="ability" class="${w('특성')}">${e.ab.map(a => `<option value="${esc(a.en)}"${a.en === s.ability ? ' selected' : ''}>${esc(a.ko || a.en)}</option>`).join('')}</select></label>
          <label>도구<select data-f="item"><option value="">없음</option>${items.map(([ko, en]) => `<option value="${esc(en)}"${en === s.item ? ' selected' : ''}>${esc(ko)}</option>`).join('')}</select></label>
          <label>성격<select data-f="nature" class="${w('능력치')}">${Object.keys(NATURES).map(n => `<option value="${n}"${n === s.nature ? ' selected' : ''}>${esc(natureLabel(n))}</option>`).join('')}</select></label>
        </div>
        <div class="imp-mv${w('기술')}">${[0, 1, 2, 3].map(k => `<select data-f="move" data-k="${k}" aria-label="기술 ${k + 1}"><option value="">(비움)</option>${ls.map(m => `<option value="${esc(m.en)}"${m.en === s.moves[k] ? ' selected' : ''}>${esc(m.ko || m.en)}</option>`).join('')}</select>`).join('')}</div>
        <div class="imp-sp">${STATS.map(k => `<label>${STAT_KO[k]}<input type="number" min="0" max="32" data-f="sp" data-k="${k}" value="${s.sp[k] || 0}"></label>`).join('')}</div>
      </div>`;
    }).join('') + `<div class="imp-actions"><button class="btn primary" data-k="imp-apply"${n ? '' : ' disabled'}>팀에 넣기 (${n}마리)</button><button class="btn" data-k="imp-close">취소</button></div>` + rawBox();
  }

  // ---------------- 이벤트 ----------------
  $('imp-file').addEventListener('change', e => handle(e.target.files));
  panel.addEventListener('dragover', e => { e.preventDefault(); panel.classList.add('drag'); });
  panel.addEventListener('dragleave', () => panel.classList.remove('drag'));
  panel.addEventListener('drop', e => { e.preventDefault(); panel.classList.remove('drag'); handle(e.dataTransfer.files); });
  document.addEventListener('paste', e => {  // PC: 캡처 후 Ctrl+V
    if (panel.hidden) return;
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) handle(files);
  });
  panel.addEventListener('change', e => {
    const el = e.target, f = el.dataset.f;
    const rowEl = el.closest('.imp-row');
    if (!f || !rowEl) return;
    const r = rows[+rowEl.dataset.i];
    if (f === 'name') {
      const id = findMon(el.value);
      if (!id) return;
      const base = byId[id].mega ? byId[id].parent : id;
      rows[+rowEl.dataset.i] = {baseId: base, set: M.defaultSet(id), warn: [], found: {stats: false}};
      renderReview(); return;
    }
    if (f === 'ability' || f === 'item' || f === 'nature') r.set[f] = el.value;
    if (f === 'move') r.set.moves[+el.dataset.k] = el.value;
    if (f === 'sp') r.set.sp[el.dataset.k] = Math.max(0, Math.min(32, Math.round(+el.value || 0)));
    if (f === 'item') {  // 메가스톤을 넣거나 빼면 메가 형태 전환
      const base = byId[r.baseId];
      const suf = (el.value.match(/ ([XYZ])$/) || [])[1];
      const mega = base.megas && /ite( [XYZ])?$/.test(el.value) && base.megas.find(m => ((m.match(/ ([XYZ])$/) || [])[1]) === suf);
      const nextId = mega || r.baseId;
      if (nextId !== r.set.id) { r.set.id = nextId; r.set.ability = byId[nextId].ab[0].en; renderReview(); }
    }
  });
  panel.addEventListener('click', e => {
    const b = e.target.closest('button[data-k]');
    if (!b) return;
    if (b.dataset.k === 'imp-close') close();
    if (b.dataset.k === 'imp-apply') {
      onImport(rows.filter(r => !r.empty).map(r => ({...r.set, moves: r.set.moves.filter(Boolean)})));
      close();
    }
  });

  return {open, close};
}
