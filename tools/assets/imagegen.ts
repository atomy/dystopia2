// Client for the image server on the GPU host (stable-diffusion.cpp sd-server
// with Z-Image Turbo, see tools/gpu-host/README.md). The server address comes
// from D2_IMAGE_SERVER in the repo's git-ignored .env.
//
//   npx tsx tools/assets/imagegen.ts --ping
//   npx tsx tools/assets/imagegen.ts "prompt" out.png [--size 1024x1024] [--seed 42] [--steps 8]

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
try {
  process.loadEnvFile(join(root, '.env'));
} catch {
  // No .env: fall back to the environment.
}

export interface ImageRequest {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  /** -1 picks a random seed; fix it to make a result reproducible. */
  seed?: number;
  steps?: number;
}

interface Job {
  id: string;
  status: 'queued' | 'generating' | 'completed' | 'failed' | 'cancelled';
  queue_position?: number;
  result: { output_format: string; images: { index: number; b64_json: string }[] } | null;
  error: { code: string; message: string } | null;
}

export function imageServer(): string {
  const url = process.env['D2_IMAGE_SERVER'];
  if (!url) throw new Error('D2_IMAGE_SERVER is not set: add it to .env (see tools/gpu-host/README.md)');
  return url.replace(/\/+$/, '');
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(imageServer() + path, { ...init, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path}: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export async function capabilities(): Promise<unknown> {
  return call('/sdcpp/v1/capabilities');
}

/** Generate one image and return its PNG bytes. */
export async function generateImage(req: ImageRequest): Promise<Buffer> {
  const job = await call<Job>('/sdcpp/v1/img_gen', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: req.prompt,
      negative_prompt: req.negativePrompt ?? '',
      width: req.width ?? 1024,
      height: req.height ?? 1024,
      seed: req.seed ?? -1,
      batch_count: 1,
      // Z-Image Turbo is distilled: few steps, no classifier-free guidance.
      sample_params: { sample_steps: req.steps ?? 8, guidance: { txt_cfg: 1.0 } },
      output_format: 'png',
    }),
  });
  const deadline = Date.now() + 15 * 60_000;
  for (;;) {
    const j = await call<Job>(`/sdcpp/v1/jobs/${encodeURIComponent(job.id)}`);
    if (j.status === 'completed' && j.result?.images[0]) return Buffer.from(j.result.images[0].b64_json, 'base64');
    if (j.status === 'failed' || j.status === 'cancelled') throw new Error(`job ${j.id} ${j.status}: ${j.error?.message ?? ''}`);
    if (Date.now() > deadline) throw new Error(`job ${j.id} timed out (${j.status})`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === '--ping') {
    console.log(`${imageServer()}:`, JSON.stringify(await capabilities()).slice(0, 400));
    return;
  }
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args.splice(i, 2)[1] : undefined;
  };
  const size = opt('--size');
  const seed = opt('--seed');
  const steps = opt('--steps');
  const [prompt, out] = args;
  if (!prompt || !out) {
    console.error('usage: imagegen.ts --ping | "prompt" out.png [--size WxH] [--seed N] [--steps N]');
    process.exit(2);
  }
  const [w, h] = (size ?? '1024x1024').split('x').map(Number);
  const t0 = Date.now();
  const png = await generateImage({ prompt, width: w, height: h, seed: seed ? Number(seed) : -1, steps: steps ? Number(steps) : undefined });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, png);
  console.log(`${out} (${(png.length / 1024).toFixed(0)} KiB, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
