/**
 * voice
 * -----
 * Local, free, keyless text-to-speech using Kokoro (82M params) via
 * kokoro-js / transformers.js. Runs on WebGPU when available, falls back
 * to WASM otherwise — unlike image diffusion, Kokoro is light enough that
 * the WASM fallback is genuinely usable, not just a graceful failure path.
 *
 * Crucially, this returns real decodable audio (WAV bytes), unlike the
 * browser's built-in SpeechSynthesis API, which only plays through the
 * OS's audio output and cannot be captured as a file — that's why
 * SpeechSynthesis isn't used here despite being "free" too.
 */

export interface VoiceGeneratorOptions {
  /** Hugging Face model id. Default: "onnx-community/Kokoro-82M-v1.0-ONNX" */
  modelId?: string;
  /** Voice preset. Run VoiceGenerator.listVoices() after init() for the full list. Default: "af_heart" */
  voice?: string;
  /** Skip model download and use synthesized speech tones (useful for instant pipeline tests). Default: false */
  mock?: boolean;
  /** Called with human-readable progress while the model downloads/loads. */
  onProgress?: (status: string, progress?: number) => void;
}

export interface VoiceSegment {
  /** The text this audio was generated from. */
  text: string;
  /** WAV file bytes. */
  wav: ArrayBuffer;
  /** Duration in seconds, computed from the WAV's PCM data. */
  durationSeconds: number;
}

// Minimal structural typing so we don't need kokoro-js's types as a hard
// dependency at the type-check level for consumers who never touch voice.
interface KokoroTTSLike {
  generate(
    text: string,
    options?: { voice?: string }
  ): Promise<{ toWav(): ArrayBuffer }>;
  list_voices?: () => string[];
}

interface NavigatorWithGPU {
  gpu?: { requestAdapter: () => Promise<unknown | null> };
}

export class VoiceGenerator {
  private tts: KokoroTTSLike | null = null;
  private readonly modelId: string;
  private readonly voice: string;
  private readonly mock: boolean;
  private readonly onProgress?: (status: string, progress?: number) => void;

  constructor(options: VoiceGeneratorOptions = {}) {
    this.modelId = options.modelId ?? "onnx-community/Kokoro-82M-v1.0-ONNX";
    this.voice = options.voice ?? "af_heart";
    this.mock = options.mock ?? false;
    this.onProgress = options.onProgress;
  }

  /** Loads the Kokoro model. Must be called (and awaited) before generate(). */
  async init(): Promise<void> {
    if (this.mock) {
      this.onProgress?.("Fast simulated voice mode ready.", 100);
      return;
    }

    const device = (await this.detectWebGPU()) ? "webgpu" : "wasm";
    const dtype = device === "webgpu" ? "fp32" : "q8";

    this.onProgress?.(`Loading Kokoro TTS model on ${device}…`, 0);

    try {
      const { KokoroTTS } = await import("kokoro-js");

      this.tts = (await KokoroTTS.from_pretrained(this.modelId, {
        dtype,
        device,
      } as never)) as unknown as KokoroTTSLike;

      this.onProgress?.("Kokoro TTS ready.", 100);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.onProgress?.(`Kokoro model load failed (${msg}). Using fallback voice tone.`, 100);
    }
  }

  /** Lists available voice presets. Call after init(). */
  listVoices(): string[] {
    if (!this.tts?.list_voices) return ["af_heart", "af_bella", "af_nicole", "af_sky", "am_adam"];
    return this.tts.list_voices();
  }

  async generate(text: string): Promise<VoiceSegment> {
    if (this.tts) {
      try {
        const audio = await this.tts.generate(text, { voice: this.voice });
        const wav = await toWavArrayBuffer(audio);

        return {
          text,
          wav,
          durationSeconds: estimateWavDurationSeconds(wav),
        };
      } catch (err) {
        console.warn("TTS generation error, falling back to tone audio:", err);
      }
    }

    // Fallback: create a timed melodic voice tone
    const words = text.trim().split(/\s+/).length;
    const durationSeconds = Math.max(2.5, words * 0.35);
    const wav = createToneWav(durationSeconds);

    return {
      text,
      wav,
      durationSeconds,
    };
  }

  /** Generates narration for every scene in order, reporting progress. */
  async generateAll(
    texts: string[],
    onSceneProgress?: (index: number, total: number) => void
  ): Promise<VoiceSegment[]> {
    const segments: VoiceSegment[] = [];
    for (let i = 0; i < texts.length; i++) {
      segments.push(await this.generate(texts[i]));
      onSceneProgress?.(i + 1, texts.length);
    }
    return segments;
  }

  private async detectWebGPU(): Promise<boolean> {
    if (typeof navigator === "undefined") return false;
    const nav = navigator as unknown as NavigatorWithGPU;
    if (!nav.gpu) return false;
    try {
      const adapter = await nav.gpu.requestAdapter();
      return adapter !== null && adapter !== undefined;
    } catch {
      return false;
    }
  }
}

async function toWavArrayBuffer(audio: unknown): Promise<ArrayBuffer> {
  if (!audio) throw new Error("No audio returned from TTS");
  const a = audio as Record<string, unknown>;

  // 1. Try audio.toWav()
  if (typeof a.toWav === "function") {
    const res = (a.toWav as () => unknown)();
    if (res instanceof ArrayBuffer) return res;
    if (res instanceof Uint8Array) return res.buffer.slice(res.byteOffset, res.byteOffset + res.byteLength);
    if (res && typeof (res as Record<string, unknown>).arrayBuffer === "function") {
      return await ((res as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer());
    }
    if (res instanceof Blob) return await new Response(res).arrayBuffer();
  }

  // 2. Try audio.toBlob()
  if (typeof a.toBlob === "function") {
    const blob = (a.toBlob as () => Blob)();
    if (blob && typeof blob.arrayBuffer === "function") return await blob.arrayBuffer();
    return await new Response(blob).arrayBuffer();
  }

  // 3. Try audio.arrayBuffer()
  if (typeof a.arrayBuffer === "function") {
    return await ((a as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer());
  }

  if (audio instanceof ArrayBuffer) return audio;
  if (audio instanceof Uint8Array) return audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength);

  throw new Error("Unable to extract WAV ArrayBuffer from TTS audio output");
}

/** Reads a standard WAV header to compute duration without decoding the full buffer. */
function estimateWavDurationSeconds(wav: ArrayBuffer): number {
  const view = new DataView(wav);
  // WAV header layout: byteRate at offset 28 (uint32 LE), dataSize follows
  // the "data" subchunk id, typically at offset 40 for a canonical 44-byte
  // header. We scan for the "data" chunk id to be robust to extra chunks.
  const bytes = new Uint8Array(wav);
  const decoder = new TextDecoder("ascii");

  let offset = 12; // skip "RIFF"+size+"WAVE"
  let byteRate = 0;
  let dataSize = 0;

  while (offset + 8 <= bytes.length) {
    const chunkId = decoder.decode(bytes.subarray(offset, offset + 4));
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === "fmt ") {
      byteRate = view.getUint32(offset + 12, true);
    } else if (chunkId === "data") {
      dataSize = chunkSize;
    }

    offset += 8 + chunkSize + (chunkSize % 2); // chunks are word-aligned
  }

  if (byteRate === 0) return 0;
  return dataSize / byteRate;
}

/** Generates a harmonious fallback tone WAV when TTS is simulated or offline. */
export function createToneWav(durationSeconds = 3, sampleRate = 24000): ArrayBuffer {
  const numSamples = Math.round(durationSeconds * sampleRate);
  const totalDataLength = numSamples * 2;
  const buffer = new ArrayBuffer(44 + totalDataLength);
  const view = new DataView(buffer);

  for (let i = 0; i < 4; i++) view.setUint8(i, "RIFF".charCodeAt(i));
  view.setUint32(4, 36 + totalDataLength, true);
  for (let i = 0; i < 4; i++) view.setUint8(8 + i, "WAVE".charCodeAt(i));
  for (let i = 0; i < 4; i++) view.setUint8(12 + i, "fmt ".charCodeAt(i));
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); // 16-bit
  for (let i = 0; i < 4; i++) view.setUint8(36 + i, "data".charCodeAt(i));
  view.setUint32(40, totalDataLength, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = (
      Math.sin(2 * Math.PI * 440 * t) * 0.12 +
      Math.sin(2 * Math.PI * 554.37 * t) * 0.08 +
      Math.sin(2 * Math.PI * 659.25 * t) * 0.06
    ) * Math.min(1, t * 2) * Math.min(1, (durationSeconds - t) * 2);

    const int16 = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return buffer;
}
