/**
 * dex-3d: AI 3D models for Blender, free, on Hugging Face's ZeroGPU Spaces.
 *
 *   image → 3D   Hunyuan3D-2.1 (tencent/Hunyuan3D-2.1): mesh + PBR texture.
 *                TRELLIS (trellis-community/TRELLIS) as the alternative.
 *   text  → 3D   FLUX.1-schnell (black-forest-labs/FLUX.1-schnell, its own
 *                ZeroGPU Space — a few GPU seconds) makes a clean reference
 *                picture of the object, then image → 3D as above. (The old
 *                Inference API route for FLUX was retired by Hugging Face.)
 *
 * It spends the user's own free ZeroGPU quota — a few minutes a day, so
 * roughly one or two models on a free account (PRO: ~25 min/day). When it's
 * used up the Space says so and we pass that on plainly.
 *
 * Talks to the Spaces with Gradio's own JS client, so nothing (no Python)
 * has to be installed alongside DEX.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { mainLogger } from '../logger';
import { huggingFaceToken } from '../accounts/huggingface';

export type ThreeDModel = 'hunyuan' | 'trellis';

export interface Generate3DRequest {
  /** A local picture of the object (best: one object, plain background). */
  image?: string;
  /** Or a description; a reference picture is generated from it first. */
  prompt?: string;
  model?: ThreeDModel;
  /** Mesh only, no texture: faster and cheaper on quota. */
  shapeOnly?: boolean;
  outDir: string;
  /** Base name for the files written. */
  name?: string;
}

export interface Generate3DResult {
  glb: string;
  referenceImage?: string;
  model: string;
  textured: boolean;
  seconds: number;
}

const SPACES: Record<ThreeDModel, string> = {
  hunyuan: 'tencent/Hunyuan3D-2.1',
  trellis: 'trellis-community/TRELLIS',
};
const TEXT_TO_IMAGE_SPACE = 'black-forest-labs/FLUX.1-schnell';

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'model';
}

/** Turn a Space's quota/permission failure into something a person can act on. */
function explain(err: unknown): Error {
  const raw = (err as { message?: string })?.message ?? (typeof err === 'string' ? err : JSON.stringify(err));
  if (/ZeroGPU quota/i.test(raw)) {
    const wait = raw.match(/Try again in ([0-9:]+)/)?.[1];
    return new Error(`Today's free Hugging Face GPU time is used up${wait ? ` — it refills in ${wait}` : ''}. Hugging Face PRO gives ~25 min/day. Meanwhile, build the object in Blender or use Poly Haven / Sketchfab assets.`);
  }
  if (/sufficient permissions to call Inference Providers/i.test(raw)) {
    return new Error('Text-to-3D needs the Hugging Face sign-in (Settings → Accounts → Continue with Hugging Face) — a pasted token without Inference permission can only do image-to-3D. Or pass --image with a picture of the object.');
  }
  return new Error(raw.slice(0, 500));
}

async function referenceImage(prompt: string, token: string, file: string): Promise<void> {
  const { Client } = await import('@gradio/client');
  const app = await Client.connect(TEXT_TO_IMAGE_SPACE, { token: token as `hf_${string}` }).catch((e) => { throw explain(e); });
  let result: { data: unknown };
  try {
    result = await app.predict('/infer', {
      // Image-to-3D wants one object, whole, centred, on a clean background.
      prompt: `${prompt}. A single object, whole and centred, three-quarter view, plain light grey background, soft studio lighting, high detail, 3D render.`,
      seed: 0, randomize_seed: true, width: 1024, height: 1024, num_inference_steps: 4,
    });
  } catch (err) {
    throw explain(err);
  }
  const url = fileUrl(Array.isArray(result.data) ? result.data[0] : result.data);
  if (!url) throw new Error('The picture generator came back without a picture.');
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Couldn't download the reference picture (HTTP ${res.status}).`);
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
}

/** Pull the downloadable file URL out of a Gradio result entry (FileData or an update dict). */
function fileUrl(entry: unknown): string | null {
  const e = entry as { url?: string; value?: { url?: string; path?: string }; path?: string } | null;
  return e?.url ?? e?.value?.url ?? null;
}

export async function generate3D(req: Generate3DRequest): Promise<Generate3DResult> {
  const token = await huggingFaceToken();
  if (!token) throw new Error('Connect Hugging Face first: Settings → Accounts → Continue with Hugging Face (free).');
  if (!req.image && !req.prompt) throw new Error('Give a picture of the object (--image) or describe it.');

  const started = Date.now();
  await fs.mkdir(req.outDir, { recursive: true });
  const base = slug(req.name || req.prompt || path.basename(req.image ?? 'model', path.extname(req.image ?? '')));

  let imagePath = req.image;
  let referencePath: string | undefined;
  if (!imagePath) {
    referencePath = path.join(req.outDir, `${base}-reference.webp`);
    await referenceImage(req.prompt!, token, referencePath);
    imagePath = referencePath;
  }
  const bytes = await fs.readFile(imagePath).catch(() => {
    throw new Error(`No such picture: ${imagePath}`);
  });

  const model: ThreeDModel = req.model ?? 'hunyuan';
  const { Client, handle_file } = await import('@gradio/client');
  const app = await Client.connect(SPACES[model], { token: token as `hf_${string}` }).catch((e) => { throw explain(e); });
  const blob = new Blob([bytes]);

  let result: { data: unknown };
  let textured = !req.shapeOnly;
  try {
    if (model === 'trellis') {
      await app.predict('/start_session', {}).catch(() => undefined);
      result = await app.predict('/generate_and_extract_glb', {
        image: handle_file(blob), multiimages: [], seed: 0,
        ss_guidance_strength: 7.5, ss_sampling_steps: 12, slat_guidance_strength: 3, slat_sampling_steps: 12,
        multiimage_algo: 'stochastic',
      });
      textured = true;
    } else {
      result = await app.predict(req.shapeOnly ? '/shape_generation' : '/generation_all', {
        image: handle_file(blob), mv_image_front: null, mv_image_back: null, mv_image_left: null, mv_image_right: null,
        steps: 30, guidance_scale: 5, seed: 1234, octree_resolution: 256, check_box_rembg: true, num_chunks: 8000,
        randomize_seed: true,
      });
    }
  } catch (err) {
    throw explain(err);
  }

  // Hunyuan: [white mesh, textured mesh, …]; TRELLIS: [video, model, glb].
  const data = Array.isArray(result.data) ? result.data : [result.data];
  const urls = data.map(fileUrl).filter((u): u is string => Boolean(u));
  const url = (model === 'hunyuan' && !req.shapeOnly ? urls.find((u) => /textured/i.test(u)) : undefined)
    ?? urls.filter((u) => /\.glb(\?|$)/i.test(u)).pop()
    ?? urls.pop();
  if (!url) throw new Error('The model came back without a file to download.');

  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Couldn't download the model (HTTP ${res.status}).`);
  const glb = path.join(req.outDir, `${base}.glb`);
  await fs.writeFile(glb, Buffer.from(await res.arrayBuffer()));

  const seconds = Math.round((Date.now() - started) / 1000);
  mainLogger.info('threed.generated', { model: SPACES[model], textured, seconds });
  return { glb, referenceImage: referencePath, model: SPACES[model], textured, seconds };
}
