export type ImageInput = {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  base64: string;
  width: number;
  height: number;
};

export type EngineRequest =
  | { kind: 'create'; prompt: string; image?: ImageInput }
  | { kind: 'edit'; instruction: string; code: string }
  | { kind: 'repair'; code: string; error: string; request: string };

export type EngineProblem =
  | 'no-key'
  | 'bad-key'
  | 'rate-limit'
  | 'busy'
  | 'network'
  | 'no-code'
  | 'too-long'
  | 'blocked'
  | 'cancelled'
  | 'other';

// code is set when the answer had code that was refused ('blocked'), so a repair request can send it back
export type EngineAnswer =
  | { ok: true; code: string; model: string; ms: number }
  | { ok: false; problem: EngineProblem; message: string; model?: string; code?: string };

export type ModelChoice = { id: string; label: string; note?: string };

export interface Engine {
  id: 'gemini';
  label: string;
  models: ModelChoice[];
  run(req: EngineRequest, opts?: { model?: string; signal?: AbortSignal }): Promise<EngineAnswer>;
}
