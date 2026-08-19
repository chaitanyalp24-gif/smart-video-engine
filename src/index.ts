/**
 * smart-video-engine
 * -------------------
 * A free, browser-based script-to-video generator.
 *
 * Pipeline: script -> scenes -> (image per scene, cloud/free) +
 * (narration per scene, local WebGPU/WASM TTS) -> canvas compositing with
 * pan/zoom/fade -> ffmpeg.wasm muxing -> downloadable MP4.
 *
 * No server, no API key required for the default pipeline. Every stage is
 * swappable: bring your own image provider (e.g. a stock-photo API) or
 * scene splitter (e.g. an AI-assisted one) via constructor options.
 *
 * Requires a browser DOM throughout (canvas, Image, and — for muxing — a
 * page served with COOP/COEP headers for SharedArrayBuffer). Not intended
 * for server-side/Node use.
 */

import { splitScript, type Scene, type SceneSplitter } from "./scenes.js";
import {
  createPollinationsImageProvider,
  type ImageProvider,
} from "./imageProvider.js";
import { VoiceGenerator, type VoiceSegment } from "./voice.js";
import { composeFrames, type ComposedFrames } from "./compose.js";
import { muxFramesToMp4 } from "./mux.js";

export type { Scene, SceneSplitter } from "./scenes.js";
export type { ImageProvider } from "./imageProvider.js";
export { createPollinationsImageProvider } from "./imageProvider.js";
export type { VoiceSegment } from "./voice.js";
export { VoiceGenerator } from "./voice.js";
export type { ComposedFrames, SceneWithMedia } from "./compose.js";
export { composeFrames } from "./compose.js";
export { muxFramesToMp4 } from "./mux.js";

export interface SmartVideoEngineOptions {
  /** Custom scene-splitting strategy. Default: free client-side sentence grouping. */
  sceneSplitter?: SceneSplitter;
  /** Custom image provider (e.g. stock photos). Default: free Pollinations cloud images. */
  imageProvider?: ImageProvider;
  /** Kokoro voice preset. Default: "af_heart". */
  voice?: string;
  /** Skip downloading neural TTS model and use fast synthesized tones. Default: false */
  mockVoice?: boolean;
  /** Output frame width. Default: 1024 */
  width?: number;
  /** Output frame height. Default: 1024 */
  height?: number;
  /** Output frames per second. Default: 24 */
  fps?: number;
  /** Called with a coarse pipeline stage name and optional detail/progress. */
  onProgress?: (stage: string, detail?: string) => void;
}

export interface GenerateVideoResult {
  /** The final MP4 as a Blob. */
  blob: Blob;
  /** Object URL for the blob (revoke it yourself with URL.revokeObjectURL when done). */
  url: string;
  /** The scenes that were generated, for inspection/debugging. */
  scenes: Scene[];
  /** Per-scene narration audio, for inspection/debugging. */
  voiceSegments: VoiceSegment[];
}

export class SmartVideoEngine {
  private readonly sceneSplitter: SceneSplitter;
  private readonly imageProvider: ImageProvider;
  private readonly voiceGenerator: VoiceGenerator;
  private readonly width: number;
  private readonly height: number;
  private readonly fps: number;
  private readonly onProgress?: (stage: string, detail?: string) => void;

  constructor(options: SmartVideoEngineOptions = {}) {
    this.sceneSplitter = options.sceneSplitter ?? ((script: string) => splitScript(script));
    this.width = options.width ?? 1024;
    this.height = options.height ?? 1024;
    this.fps = options.fps ?? 24;
    this.onProgress = options.onProgress;
    this.imageProvider =
      options.imageProvider ??
      createPollinationsImageProvider({ width: this.width, height: this.height });

    this.voiceGenerator = new VoiceGenerator({
      voice: options.voice,
      mock: options.mockVoice,
      onProgress: (status, progress) =>
        this.onProgress?.("voice-model-loading", `${status}${progress != null ? ` (${progress}%)` : ""}`),
    });
  }

  /**
   * Runs the full pipeline end to end: split script -> generate images ->
   * generate narration -> composite frames -> mux to MP4.
   */
  async generate(script: string): Promise<GenerateVideoResult> {
    this.onProgress?.("splitting-scenes");
    const scenes = await this.sceneSplitter(script);
    if (scenes.length === 0) {
      throw new Error("Script produced zero scenes — nothing to generate.");
    }

    this.onProgress?.("loading-voice-model");
    await this.voiceGenerator.init();

    this.onProgress?.("generating-images", `0/${scenes.length}`);
    const imageUrls: string[] = [];
    for (let i = 0; i < scenes.length; i++) {
      imageUrls.push(await this.imageProvider(scenes[i].imagePrompt));
      this.onProgress?.("generating-images", `${i + 1}/${scenes.length}`);
    }

    this.onProgress?.("generating-narration", `0/${scenes.length}`);
    const voiceSegments = await this.voiceGenerator.generateAll(
      scenes.map((s) => s.text),
      (done, total) => this.onProgress?.("generating-narration", `${done}/${total}`)
    );

    this.onProgress?.("compositing-frames");
    const composed = await composeFrames(
      scenes.map((scene, i) => ({
        imageUrl: imageUrls[i],
        durationSeconds: Math.max(1, voiceSegments[i].durationSeconds),
      })),
      {
        width: this.width,
        height: this.height,
        fps: this.fps,
        onProgress: (done, total) =>
          this.onProgress?.("compositing-frames", `${done}/${total}`),
      }
    );

    this.onProgress?.("muxing-video");
    const audioWav = await concatenateWavSegments(voiceSegments);
    const blob = await muxFramesToMp4(composed.frames, audioWav, {
      fps: composed.fps,
      onProgress: (message) => this.onProgress?.("muxing-video", message),
    });

    const url = URL.createObjectURL(blob);

    this.onProgress?.("done");
    return { blob, url, scenes, voiceSegments };
  }
}

/**
 * Concatenates multiple mono/stereo PCM WAV segments (as produced by
 * VoiceGenerator) into a single WAV buffer, in order, back to back with no
 * gaps. Assumes all segments share the same format (true for Kokoro output
 * from a single model instance).
 */
async function concatenateWavSegments(segments: VoiceSegment[]): Promise<ArrayBuffer> {
  if (segments.length === 1) return segments[0].wav;

  const parsed = segments.map(parseWav);
  const { audioFormat, numChannels, sampleRate, bitsPerSample } = parsed[0];

  const totalDataLength = parsed.reduce((sum, p) => sum + p.data.length, 0);
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;

  const buffer = new ArrayBuffer(44 + totalDataLength);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + totalDataLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, audioFormat, true); // Preserve format (1 for PCM int, 3 for IEEE float)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, totalDataLength, true);

  let offset = 44;
  for (const p of parsed) {
    bytes.set(p.data, offset);
    offset += p.data.length;
  }

  return buffer;
}

interface ParsedWav {
  audioFormat: number;
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
  data: Uint8Array;
}

function parseWav(segment: VoiceSegment): ParsedWav {
  const view = new DataView(segment.wav);
  const bytes = new Uint8Array(segment.wav);
  const decoder = new TextDecoder("ascii");

  let offset = 12;
  let audioFormat = 1;
  let numChannels = 1;
  let sampleRate = 24000;
  let bitsPerSample = 32;
  let data = new Uint8Array(0);

  while (offset + 8 <= bytes.length) {
    const chunkId = decoder.decode(bytes.subarray(offset, offset + 4));
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === "fmt ") {
      audioFormat = view.getUint16(offset + 8, true);
      numChannels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (chunkId === "data") {
      data = bytes.subarray(offset + 8, offset + 8 + chunkSize);
    }

    offset += 8 + chunkSize + (chunkSize % 2);
  }

  return { audioFormat, numChannels, sampleRate, bitsPerSample, data };
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

export default SmartVideoEngine;
