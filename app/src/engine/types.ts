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
  // Claude Code: no pairing code yet, a code the bridge turned down, or no bridge answering on this Mac
  | 'no-pairing'
  | 'bad-pairing'
  | 'no-bridge'
  | 'rate-limit'
  | 'busy'
  | 'network'
  | 'no-code'
  | 'too-long'
  | 'blocked'
  | 'cancelled'
  | 'other';

// code is set when the answer had code that was refused ('blocked'), so a repair request can send it back.
// session: the Claude Code session that wrote the code, so a later change can continue it.
// assumptions: what the engine says it assumed that the request did not say.
export type EngineAnswer =
  | { ok: true; code: string; model: string; ms: number; session?: string; assumptions?: string }
  | { ok: false; problem: EngineProblem; message: string; model?: string; code?: string; session?: string };

export type ModelChoice = { id: string; label: string; note?: string };

export type EngineId = 'gemini' | 'claude-code';

// session: continue this Claude Code session; onProgress: plain steps while the engine works
export type RunOptions = { model?: string; signal?: AbortSignal; session?: string; onProgress?: (step: string) => void };

export interface Engine {
  id: EngineId;
  label: string;
  models: ModelChoice[];
  run(req: EngineRequest, opts?: RunOptions): Promise<EngineAnswer>;
}
