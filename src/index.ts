/**
 * smart-video-engine
 * -------------------
 * A free, client-side script-to-video studio engine in JavaScript & TypeScript.
 *
 * Pipeline:
 * 1. Script Parsing & Keyword Extraction (NLP)
 * 2. Visual Synthesis (Multi-Model AI / Stock Media / Local GPU Inference)
 * 3. Neural Speech Narration (Kokoro-82M WebGPU / WASM)
 * 4. Ambient Background Music (BGM) & Dynamic Audio Ducking
 * 5. Canvas Compositor with Ken Burns Motion, Crossfades & Subtitles
 * 6. ffmpeg.wasm Video Muxer -> Downloadable MP4
 */

import { splitScript, type Scene, type SceneSplitter, type SplitScriptOptions } from "./scenes.js";
import {
  createPollinationsImageProvider,
  createPixabayImageProvider,
  createLocalInferenceProvider,
  type ImageProvider,
} from "./imageProvider.js";
import { VoiceGenerator, type VoiceSegment } from "./voice.js";
import { composeFrames, type ComposedFrames, type ComposeOptions } from "./compose.js";
import { muxFramesToMp4 } from "./mux.js";
import { generateBgmAudio, mixVoiceWithBgm, type BgmTrackOptions } from "./bgm.js";

export type { Scene, SceneSplitter, SplitScriptOptions } from "./scenes.js";
export { splitScript, extractKeywords, deriveEnhancedPrompt } from "./scenes.js";
export type { ImageProvider } from "./imageProvider.js";
export {
  createPollinationsImageProvider,
  createPixabayImageProvider,
  createLocalInferenceProvider,
} from "./imageProvider.js";
export type { VoiceSegment } from "./voice.js";
export { VoiceGenerator } from "./voice.js";
export type { ComposedFrames, SceneWithMedia, ComposeOptions } from "./compose.js";
export { composeFrames } from "./compose.js";
export { muxFramesToMp4 } from "./mux.js";
export { generateBgmAudio, mixVoiceWithBgm, type BgmTrackOptions } from "./bgm.js";

export interface SmartVideoEngineOptions {
  /** Custom scene-splitting strategy. Default: free client-side sentence grouping. */
  sceneSplitter?: SceneSplitter;
  /** Custom image provider. Default: free Pollinations cloud images. */
  imageProvider?: ImageProvider;
  /** Voice language code: "en" | "es" | "fr" | "it" | "hi" | "ja" | "zh". Default: "en" */
  language?: "en" | "es" | "fr" | "it" | "hi" | "ja" | "zh";
  /** Kokoro voice preset. Default: "af_heart". */
  voice?: string;
  /** Skip downloading neural TTS model and use fast synthesized tones. Default: false */
  mockVoice?: boolean;
  /** Output frame width in pixels. Default: 1024 */
  width?: number;
  /** Output frame height in pixels. Default: 1024 */
  height?: number;
  /** Output frames per second. Default: 24 */
  fps?: number;
  /** Subtitle styling: "pill" | "cinematic" | "karaoke" | "none". Default: "pill" */
  subtitles?: "pill" | "cinematic" | "karaoke" | "none";
  /** Background Music style: "ambient" | "lofi" | "cinematic" | "none". Default: "ambient" */
  bgm?: "ambient" | "lofi" | "cinematic" | "none";
  /** Background Music base volume (0.0 to 1.0). Default: 0.22 */
  bgmVolume?: number;
  /** Enable crossfade transitions between scenes. Default: true */
  crossfade?: boolean;
  /** Visual style preset for prompt enhancement: "cinematic" | "anime" | "cyberpunk" | "fantasy" | "none" */
  style?: "cinematic" | "photorealistic" | "anime" | "cyberpunk" | "fantasy" | "none";
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
  /** Generated image URLs per scene. */
  imageUrls: string[];
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
  private readonly subtitles: "pill" | "cinematic" | "karaoke" | "none";
  private readonly bgm: "ambient" | "lofi" | "cinematic" | "none";
  private readonly bgmVolume: number;
  private readonly crossfade: boolean;
  private readonly onProgress?: (stage: string, detail?: string) => void;

  constructor(options: SmartVideoEngineOptions = {}) {
    this.width = options.width ?? 1024;
    this.height = options.height ?? 1024;
    this.fps = options.fps ?? 24;
    this.subtitles = options.subtitles ?? "pill";
    this.bgm = options.bgm ?? "ambient";
    this.bgmVolume = options.bgmVolume ?? 0.22;
    this.crossfade = options.crossfade ?? true;
    this.onProgress = options.onProgress;

    this.sceneSplitter =
      options.sceneSplitter ??
      ((script: string) => splitScript(script, { style: options.style ?? "cinematic" }));

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
   * Runs the full end-to-end studio pipeline:
   * 1. Split script & extract keywords
   * 2. Generate/fetch scene visual media
   * 3. Synthesize speech narration
   * 4. Generate & mix background music (BGM) with audio ducking
   * 5. Composite frames (Ken Burns + Crossfades + Subtitles)
   * 6. Encode & mux into final MP4 video
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
      imageUrls.push(await this.imageProvider(scenes[i].imagePrompt, scenes[i].keywords));
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
        text: scene.text,
        durationSeconds: Math.max(1, voiceSegments[i].durationSeconds),
      })),
      {
        width: this.width,
        height: this.height,
        fps: this.fps,
        subtitles: this.subtitles,
        crossfade: this.crossfade,
        onProgress: (done, total) =>
          this.onProgress?.("compositing-frames", `${done}/${total}`),
      }
    );

    this.onProgress?.("mixing-audio");
    let audioWav = await concatenateWavSegments(voiceSegments);

    // If BGM is enabled, synthesize and mix background track
    if (this.bgm !== "none") {
      const totalDuration = voiceSegments.reduce((sum, seg) => sum + seg.durationSeconds, 0);
      const parsedWav = parseWav({ wav: audioWav, durationSeconds: totalDuration });

      if (parsedWav.audioFormat === 3) {
        // IEEE Float32 audio from Kokoro
        const floatSamples = new Float32Array(
          parsedWav.data.buffer,
          parsedWav.data.byteOffset,
          parsedWav.data.byteLength / 4
        );
        const bgmFloat = generateBgmAudio(totalDuration, {
          style: this.bgm,
          sampleRate: parsedWav.sampleRate,
        });
        const mixed = mixVoiceWithBgm(floatSamples, bgmFloat, {
          volume: this.bgmVolume,
          duckedVolume: this.bgmVolume * 0.5,
        });
        audioWav = encodeFloatWav(mixed, parsedWav.sampleRate, parsedWav.numChannels);
      }
    }

    this.onProgress?.("muxing-video");
    const blob = await muxFramesToMp4(composed.frames, audioWav, {
      fps: composed.fps,
      onProgress: (message) => this.onProgress?.("muxing-video", message),
    });

    const url = URL.createObjectURL(blob);

    this.onProgress?.("done");
    return { blob, url, scenes, voiceSegments, imageUrls };
  }
}

/**
 * Encodes Float32 samples into a standard IEEE Float32 WAV ArrayBuffer.
 */
function encodeFloatWav(samples: Float32Array, sampleRate: number, numChannels: number): ArrayBuffer {
  const dataByteLength = samples.length * 4;
  const buffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataByteLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); // IEEE float format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 4, true);
  view.setUint16(32, numChannels * 4, true);
  view.setUint16(34, 32, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataByteLength, true);

  const floatView = new Float32Array(buffer, 44, samples.length);
  floatView.set(samples);

  return buffer;
}

/** Concatenates multiple WAV segments into a single WAV buffer. */
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
  view.setUint32(16, 16, true);
  view.setUint16(20, audioFormat, true);
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
