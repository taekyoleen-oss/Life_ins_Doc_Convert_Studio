import { PDF_WORKER_SRC } from "./methoddoc/pdf";
import type { PageImage } from "./methoddoc/vision";

/**
 * PDF·그림 파일 → 쪽 그림 (브라우저 전용 — canvas). 미리보기(작게)와 보낼 그림(긴 변 2000px, JPEG)을 만든다.
 * 긴 변 2000px 은 표의 작은 숫자까지 읽히면서 쪽당 입력 약 3,800 토큰이다(모델은 2576px 까지 그대로 본다).
 */
export interface PageSource {
  count: number;
  /** 보낼 그림 크기(비용 어림용) */
  size: { width: number; height: number };
  thumb(page: number): Promise<string>;
  image(page: number): Promise<PageImage>;
}

const EDGE = 2000;

function toImage(canvas: HTMLCanvasElement, page: number): PageImage {
  const url = canvas.toDataURL("image/jpeg", 0.9);
  return { page, mediaType: "image/jpeg", base64: url.slice(url.indexOf(",") + 1), width: canvas.width, height: canvas.height };
}

function blank(w: number, h: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w)); canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);   // 투명 배경은 JPEG 에서 검게 나온다
  return { canvas, ctx };
}

export async function pdfSource(buf: Uint8Array): Promise<PageSource> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
  const doc = await pdfjs.getDocument({ data: buf.slice() }).promise;     // pdf.js 가 버퍼를 가져가므로 사본을 넘긴다
  const draw = async (n: number, edge: number) => {
    const page = await doc.getPage(n);
    const one = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: edge / Math.max(one.width, one.height) });
    const { canvas } = blank(viewport.width, viewport.height);
    await page.render({ canvas, viewport }).promise;
    page.cleanup();
    return canvas;
  };
  const first = (await doc.getPage(1)).getViewport({ scale: 1 });
  const k = EDGE / Math.max(first.width, first.height);
  return {
    count: doc.numPages,
    size: { width: Math.round(first.width * k), height: Math.round(first.height * k) },
    thumb: async (n) => (await draw(n, 260)).toDataURL("image/jpeg", 0.7),
    image: async (n) => toImage(await draw(n, EDGE), n),
  };
}

export async function imageSource(file: File): Promise<PageSource> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 2576 / Math.max(bmp.width, bmp.height));
  const { canvas, ctx } = blank(bmp.width * k, bmp.height * k);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return {
    count: 1,
    size: { width: canvas.width, height: canvas.height },
    thumb: async () => canvas.toDataURL("image/jpeg", 0.7),
    image: async () => toImage(canvas, 1),
  };
}

export const IMAGE_EXT = /\.(png|jpe?g)$/i;
export const sourceOf = async (file: File) =>
  (IMAGE_EXT.test(file.name) ? imageSource(file) : pdfSource(new Uint8Array(await file.arrayBuffer())));
