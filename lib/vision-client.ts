import Anthropic from "@anthropic-ai/sdk";
import { PAGE_SCHEMA, PRICE, VISION_SYSTEM, type VisionAsk } from "./methoddoc/vision";

/**
 * 그림 → 글: 브라우저에서 사용자 본인의 API 키로 Claude 를 직접 부른다(서버 없음).
 * 키는 기본으로 이 창(sessionStorage)에만 두고, [이 브라우저에 기억]을 고를 때만 localStorage 에 둔다.
 * 조건 파일·JSON·내보내기에는 절대 싣지 않는다.
 */
export const VISION_MODEL = "claude-opus-5";
const KEY = "life_ins_doc_convert_studio:anthropic-key";

export const loadKey = (): { key: string; remembered: boolean } => {
  try {
    const kept = localStorage.getItem(KEY);
    return { key: sessionStorage.getItem(KEY) ?? kept ?? "", remembered: !!kept };
  } catch { return { key: "", remembered: false }; }
};
export const saveKey = (key: string, remember: boolean) => {
  try {
    sessionStorage.setItem(KEY, key);
    if (remember) localStorage.setItem(KEY, key); else localStorage.removeItem(KEY);
  } catch { /* 사생활 모드 — 이번 요청에만 쓴다 */ }
};
export const clearKey = () => { try { sessionStorage.removeItem(KEY); localStorage.removeItem(KEY); } catch { /* 없음 */ } };

export interface Usage { input: number; output: number; usd: number }

/** 쪽 그림 하나 → PAGE_SCHEMA JSON. 거절·잘림은 알 수 있게 오류로 */
export function askWithKey(apiKey: string, onUsage?: (u: Usage) => void): VisionAsk {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  return async (img, signal) => {
    const msg = await client.beta.messages.stream({
      model: VISION_MODEL,
      max_tokens: 16000,
      // 안전 분류기가 거절하면 서버가 권장 모델로 다시 돌린다
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: PAGE_SCHEMA as unknown as Record<string, unknown> } },
      system: VISION_SYSTEM,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } },
        { type: "text", text: `${img.page}쪽을 옮겨 적어 주세요.` },
      ] }],
    }, { signal }).finalMessage();
    const u = msg.usage;
    const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    onUsage?.({ input, output: u.output_tokens ?? 0, usd: input * PRICE.input + (u.output_tokens ?? 0) * PRICE.output });
    if (msg.stop_reason === "refusal") throw new Error(`${img.page}쪽: 모델이 이 쪽을 처리하지 않았습니다(거절). 그 쪽을 빼고 보내 주세요`);
    if (msg.stop_reason === "max_tokens") throw new Error(`${img.page}쪽: 글이 너무 많아 잘렸습니다`);
    const text = msg.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") throw new Error(`${img.page}쪽: 응답에 글이 없습니다`);
    return JSON.parse(text.text);
  };
}

/** SDK 오류를 사람 말로 */
export function explainError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "API 키가 맞지 않습니다 — 키를 다시 넣어 주세요";
  if (e instanceof Anthropic.PermissionDeniedError) return "이 API 키로는 이 모델을 쓸 수 없습니다";
  if (e instanceof Anthropic.RateLimitError) return "요청이 많아 잠시 막혔습니다 — 조금 뒤 다시 보내 주세요";
  if (e instanceof Anthropic.APIUserAbortError) return "멈췄습니다";
  if (e instanceof Anthropic.APIConnectionError) return "API 에 연결하지 못했습니다 — 인터넷 연결을 확인하세요";
  if (e instanceof Anthropic.APIError) return `API 오류 ${e.status ?? ""}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
