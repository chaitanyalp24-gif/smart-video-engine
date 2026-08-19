export interface Scene {
  text: string;
  imagePrompt: string;
}

export interface SplitScriptOptions {
  sentencesPerScene?: number;
}

export type SceneSplitter = (script: string) => Scene[] | Promise<Scene[]>;

export declare function splitScript(
  script: string,
  options?: SplitScriptOptions
): Scene[];

export type ImageProvider = (prompt: string) => Promise<string>;

export interface PollinationsImageProviderOptions {
  baseUrl?: string;
  width?: number;
  height?: number;
}

export declare function createPollinationsImageProvider(
  options?: PollinationsImageProviderOptions
): ImageProvider;

export interface VoiceGeneratorOptions {
  modelId?: string;
  voice?: string;
  onProgress?: (status: string, progress?: number) => void;
}

export interface VoiceSegment {
  text: string;
  wav: ArrayBuffer;
  durationSeconds: number;
}

export declare class VoiceGenerator {
  constructor(options?: VoiceGeneratorOptions);
  init(): Promise<void>;
  listVoices(): string[];
  generate(text: string): Promise<VoiceSegment>;
  generateAll(
    texts: string[],
    onSceneProgress?: (index: number, total: number) => void
  ): Promise<VoiceSegment[]>;
}

export interface ComposeOptions {
  width?: number;
  height?: number;
  fps?: number;
  fadeFraction?: number;
  maxZoom?: number;
  onProgress?: (renderedFrames: number, totalFrames: number) => void;
}

export interface SceneWithMedia {
  imageUrl: string;
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
  fps: number;
  onProgress?: (message: string) => void;
  coreBaseUrl?: string;
}

export declare function muxFramesToMp4(
  frames: Uint8Array[],
  audioWav: ArrayBuffer,
  options: MuxOptions
): Promise<Blob>;

export interface SmartVideoEngineOptions {
  sceneSplitter?: SceneSplitter;
  imageProvider?: ImageProvider;
  voice?: string;
  width?: number;
  height?: number;
  fps?: number;
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
