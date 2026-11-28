// gkod batch: one long-running process for the benchmark harness. It reads jobs as JSON lines and answers each with
// one JSON line, so thousands of compiles share one Node process. Compiles run in parallel worker threads (each
// with the site's 10 second limit); replies come back as jobs finish, carrying the job's id.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { type Bed, checkStl } from '@gkod/checks';
import { SYSTEM_INSTRUCTION, userText } from '../../app/src/engine/prompts.ts';
import { answerOf } from '../../datagen/src/splits/tokens.ts';
import { compileScad, DEFINE_NAME } from './compile.ts';

export const OVERHANG_DEG = 45;
const LOG_TAIL = 20;

export type CompileJob = {
  id: string;
  op: 'compile';
  code: string;
  /** named sizes set with -D, as the site's sliders set them (and $fn, for the benchmark's overlap) */
  defines?: Record<string, number>;
  /** where to write the STL when it compiles; nothing is written without it */
  stl?: string | null;
  /** run the print checks on the mesh (default true) */
  check?: boolean;
};

export type PromptJob = {
  id: string;
  op: 'prompt';
  /** a create or an edit request, as the site sends it */
  request: { kind: 'create'; prompt: string } | { kind: 'edit'; instruction: string; code: string };
  /** code to write as an answer, the way a training row's answer is written */
  answer?: string;
};

export type Job = CompileJob | PromptJob;

const round = (value: number, places = 4) => Number(value.toFixed(places));

function isDefines(value: unknown): value is Record<string, number> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.entries(value).every(([name, v]) => DEFINE_NAME.test(name) && typeof v === 'number' && Number.isFinite(v))
  );
}

/** The job on one line, or the reason it cannot be run. */
export function parseJob(line: string): { job: Job } | { id: string | null; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(line);
  } catch {
    return { id: null, error: 'A job must be one JSON object per line.' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { id: null, error: 'A job must be one JSON object per line.' };
  const job = data as Record<string, unknown>;
  const id = typeof job.id === 'string' ? job.id : null;
  if (id === null) return { id: null, error: 'Every job needs a string id.' };
  if (job.op === 'compile') {
    if (typeof job.code !== 'string') return { id, error: 'A compile job needs its code as a string.' };
    if (job.defines !== undefined && !isDefines(job.defines)) return { id, error: 'defines takes names and numbers, like {"width": 80}.' };
    if (job.stl !== undefined && job.stl !== null && typeof job.stl !== 'string') return { id, error: 'stl takes a file path.' };
    return { job: job as CompileJob };
  }
  if (job.op === 'prompt') {
    const req = job.request as Record<string, unknown> | undefined;
    const create = req?.kind === 'create' && typeof req.prompt === 'string';
    const edit = req?.kind === 'edit' && typeof req.instruction === 'string' && typeof req.code === 'string';
    if (!create && !edit) return { id, error: 'A prompt job needs a create request {kind, prompt} or an edit request {kind, instruction, code}.' };
    if (job.answer !== undefined && typeof job.answer !== 'string') return { id, error: 'answer takes the code as a string.' };
    return { job: job as PromptJob };
  }
  return { id, error: `Unknown op ${JSON.stringify(job.op)}; use compile or prompt.` };
}

/** The site's system prompt and the words it sends for a request, read from the site's own code. */
export function promptReply(job: PromptJob) {
  const reply: Record<string, unknown> = { id: job.id, op: 'prompt', system: SYSTEM_INSTRUCTION, user: userText(job.request) };
  if (job.answer !== undefined) reply.answer = answerOf(job.answer);
  return reply;
}

/** Compiles one job with the site's compiler and, when it compiles, runs the print checks for the bed. */
export async function compileReply(job: CompileJob, bed: Bed) {
  const result = await compileScad(job.code, job.defines ?? {});
  const reply: Record<string, unknown> = {
    id: job.id,
    op: 'compile',
    ok: result.ok,
    error: result.error,
    triangles: result.triangles,
    params: result.params,
    ms: round(result.ms, 1),
    log_tail: result.log.slice(-LOG_TAIL),
    stl: null,
    stl_sha256: null,
    checks: null,
  };
  if (!result.ok || !result.stl) return reply;
  reply.stl_sha256 = createHash('sha256').update(result.stl).digest('hex');
  if (job.stl) {
    writeFileSync(job.stl, result.stl);
    reply.stl = job.stl;
  }
  if (job.check !== false) {
    const report = checkStl(result.stl, { bed, overhangDeg: OVERHANG_DEG });
    reply.checks = {
      ok: report.ok,
      results: report.results.map((r) => (r.ok ? { id: r.id, ok: true } : { id: r.id, ok: false, detail: r.detail })),
      stats: { triangles: report.stats.triangles, volume: round(report.stats.volume, 2), size: report.stats.size.map((v) => round(v)), min: report.stats.min.map((v) => round(v)) },
      ms: round(report.ms, 1),
    };
  }
  return reply;
}

/** Runs every job from `lines`, at most `workers` compiles at a time, and writes one reply line per job. */
export async function runBatch(lines: AsyncIterable<string>, write: (line: string) => void, opts: { workers: number; bed: Bed }): Promise<number> {
  const running = new Set<Promise<void>>();
  let done = 0;
  const send = (reply: unknown) => {
    write(JSON.stringify(reply));
    done++;
  };
  for await (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const parsed = parseJob(line);
    if ('error' in parsed) {
      send({ id: parsed.id, op: null, error: parsed.error });
      continue;
    }
    const { job } = parsed;
    if (job.op === 'prompt') {
      send(promptReply(job));
      continue;
    }
    while (running.size >= opts.workers) await Promise.race(running);
    const task: Promise<void> = compileReply(job, opts.bed)
      .then(send, (error: Error) => send({ id: job.id, op: 'compile', ok: false, error: `The batch could not run this job: ${error.message}` }))
      .finally(() => running.delete(task));
    running.add(task);
  }
  await Promise.all(running);
  return done;
}
