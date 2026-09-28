// 브라우저 글자 인식 (Tesseract.js, 처음 쓸 때 jsdelivr CDN에서 엔진·한국어 데이터를 받음)
// 이미지는 서버로 보내지 않고 브라우저 안에서만 처리
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let workerP = null;

function loadScript(src) {
  return new Promise((ok, fail) => {
    if (window.Tesseract) return ok();
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => fail(new Error('글자 인식 엔진을 불러오지 못했습니다 (인터넷 연결 확인)'));
    document.head.appendChild(s);
  });
}

async function getWorker(onProgress) {
  if (!workerP) {
    workerP = (async () => {
      await loadScript(TESSERACT_URL);
      return window.Tesseract.createWorker('kor', 1, {
        logger: m => onProgress && onProgress(m),
      });
    })();
    workerP.catch(() => { workerP = null; });
  }
  return workerP;
}

// 흰 글씨 + 보라색 카드 → 검은 글씨 + 흰 바탕 (배경의 연노랑은 채도로 걸러냄)
function preprocess(img) {
  const scale = Math.min(2, 2400 / img.width);
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', {willReadFrequently: true});
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i], gg = p[i + 1], b = p[i + 2];
    const mn = Math.min(r, gg, b), mx = Math.max(r, gg, b);
    const textness = mn - (mx - mn) * 1.5;  // 밝고 무채색일수록 글씨
    const v = textness > 165 ? 0 : 255;
    p[i] = p[i + 1] = p[i + 2] = v;
  }
  g.putImageData(d, 0, 0);
  return {canvas: c, scale};
}

function flattenWords(data) {
  if (data.words && data.words.length) return data.words;
  const out = [];
  for (const b of data.blocks || []) for (const pa of b.paragraphs || []) for (const l of pa.lines || []) for (const w of l.words || []) out.push(w);
  return out;
}

async function recognizeCanvas(worker, canvas, scale) {
  const {data} = await worker.recognize(canvas, {}, {blocks: true, text: true});
  return flattenWords(data).map(w => ({
    text: w.text, conf: w.confidence,
    x0: w.bbox.x0 / scale, y0: w.bbox.y0 / scale, x1: w.bbox.x1 / scale, y1: w.bbox.y1 / scale,
  }));
}

export function fileToImage(file) {
  return new Promise((ok, fail) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { ok(img); URL.revokeObjectURL(url); };
    img.onerror = () => fail(new Error('이미지를 열 수 없습니다'));
    img.src = url;
  });
}

// 이미지 → {words, width, height}. 전처리본으로 먼저 읽고, 카드가 적게 잡히면 원본으로 다시
export async function recognize(img, {onProgress, enough} = {}) {
  const worker = await getWorker(onProgress);
  const {canvas, scale} = preprocess(img);
  let words = await recognizeCanvas(worker, canvas, scale);
  const shot = {words, width: img.width, height: img.height};
  if (enough && !enough(shot)) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    words = await recognizeCanvas(worker, c, 1);
    const raw = {words, width: img.width, height: img.height};
    if (enough(raw)) return raw;
  }
  return shot;
}
