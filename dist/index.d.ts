export interface Scene {
  text: string;
  imagePrompt: string;
  keywords?: string[];
}

export interface SplitScriptOptions {
  sentencesPerScene?: number;
  style?: "cinematic" | "photorealistic" | "anime" | "cyberpunk" | "fantasy" | "none";
}

export declare function extractKeywords(text: string): string[];
export declare function deriveEnhancedPrompt(text: string, style?: SplitScriptOptions["style"]): string;
export declare function splitScript(script: string, options?: SplitScriptOptions): Scene[];
export type SceneSplitter = (script: string) => Scene[] | Promise<Scene[]>;

export type ImageProvider = (prompt: string, keywords?: string[]) => Promise<string>;

export interface PollinationsImageProviderOptions {
  baseUrl?: string;
  width?: number;
  height?: number;
  model?: "flux" | "turbo" | "anime" | "default";
}

export declare function createPollinationsImageProvider(
  options?: PollinationsImageProviderOptions
): ImageProvider;

export interface PixabayImageProviderOptions {
  apiKey?: string;
  width?: number;
  height?: number;
}

export declare function createPixabayImageProvider(
  options?: PixabayImageProviderOptions
): ImageProvider;

export interface LocalInferenceProviderOptions {
  endpointUrl?: string;
  width?: number;
  height?: number;
  steps?: number;
}

export declare function createLocalInferenceProvider(
  options?: LocalInferenceProviderOptions
): ImageProvider;

export interface BgmTrackOptions {
  style?: "ambient" | "lofi" | "cinematic" | "none";
  volume?: number;
  duckedVolume?: number;
  sampleRate?: number;
}

export declare function generateBgmAudio(durationSeconds: number, options?: BgmTrackOptions): Float32Array;
export declare function mixVoiceWithBgm(
  voiceSamples: Float32Array,
  bgmSamples: Float32Array,
  options?: BgmTrackOptions
): Float32Array;

export interface VoiceSegment {
  wav: ArrayBuffer;
  durationSeconds: number;
}

export interface VoiceGeneratorOptions {
  modelId?: string;
  dtype?: string;
  voice?: string;
  mock?: boolean;
  onProgress?: (status: string, progress?: number) => void;
}

export declare class VoiceGenerator {
  constructor(options?: VoiceGeneratorOptions);
  init(): Promise<void>;
  generate(text: string): Promise<VoiceSegment>;
  generateAll(texts: string[], onProgress?: (done: number, total: number) => void): Promise<VoiceSegment[]>;
}

export interface ComposeOptions {
  width?: number;
  height?: number;
  fps?: number;
  maxZoom?: number;
  subtitles?: "pill" | "cinematic" | "karaoke" | "none";
  crossfade?: boolean;
  onProgress?: (currentFrame: number, totalFrames: number) => void;
}

export interface SceneWithMedia {
  imageUrl: string;
  text: string;
  durationSeconds: number;
}

export interface ComposedFrames {
  frames: Uint8Array[];
  fps: number;
  width: number;
  height: number;
}

export declare function composeFrames(
  scenes: SceneWithMedia[],
  options?: ComposeOptions
): Promise<ComposedFrames>;

export interface MuxOptions {
  fps?: number;
  coreBaseUrl?: string;
  onProgress?: (message: string) => void;
}

export declare function muxFramesToMp4(
  frames: Uint8Array[],
  audioWav: ArrayBuffer,
  options?: MuxOptions
): Promise<Blob>;

export interface SmartVideoEngineOptions {
  sceneSplitter?: SceneSplitter;
  imageProvider?: ImageProvider;
  language?: "en" | "es" | "fr" | "it" | "hi" | "ja" | "zh";
  voice?: string;
  mockVoice?: boolean;
  width?: number;
  height?: number;
  fps?: number;
  subtitles?: "pill" | "cinematic" | "karaoke" | "none";
  bgm?: "ambient" | "lofi" | "cinematic" | "none";
  bgmVolume?: number;
  crossfade?: boolean;
  style?: "cinematic" | "photorealistic" | "anime" | "cyberpunk" | "fantasy" | "none";
  onProgress?: (stage: string, detail?: string) => void;
}

export interface GenerateVideoResult {
  blob: Blob;
  url: string;
  scenes: Scene[];
  voiceSegments: VoiceSegment[];
}

export declare class SmartVideoEngine {
  constructor(options?: SmartVideoEngineOptions);
  generate(script: string): Promise<GenerateVideoResult>;
}

export default SmartVideoEngine;
