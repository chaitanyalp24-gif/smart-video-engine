/**
 * mux
 * ---
 * Encodes a PNG frame sequence + a WAV audio track into a single MP4 using
 * ffmpeg.wasm, entirely in the browser. Same underlying tool (@ffmpeg/ffmpeg
 * + @ffmpeg/core, requiring COOP/COEP cross-origin isolation headers) as
 * the audio/video extraction tool this project's author has already
 * deployed successfully on Cloudflare Pages.
 */

export interface MuxOptions {
  fps: number;
  /** Called with human-readable ffmpeg log lines and coarse progress. */
  onProgress?: (message: string) => void;
  /**
   * Base URL to load the ffmpeg-core.js/.wasm files from. Defaults to a
   * jsDelivr CDN build. Self-host these on your own static host if you'd
   * rather not depend on a third-party CDN at runtime.
   */
  coreBaseUrl?: string;
}

// Minimal structural typing so consumers who never call muxFramesToMp4()
// don't need @ffmpeg/ffmpeg's types as a hard dependency.
interface FFmpegLike {
  loaded: boolean;
  on(event: "log", cb: (data: { message: string }) => void): void;
  load(options: { coreURL: string; wasmURL: string }): Promise<void>;
  writeFile(name: string, data: Uint8Array): Promise<void>;
  exec(args: string[]): Promise<number>;
  readFile(name: string): Promise<Uint8Array>;
  deleteFile(name: string): Promise<void>;
}

const DEFAULT_CORE_BASE_URL =
  typeof import.meta !== "undefined" && import.meta.url
    ? new URL("../vendor/core", import.meta.url).href
    : "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";

/**
 * Muxes a sequence of PNG frames (in order) with a single WAV audio track
 * into an MP4 Blob. Requires a browser with SharedArrayBuffer available,
 * which requires the page to be served with:
 *   Cross-Origin-Opener-Policy: same-origin
 *   Cross-Origin-Embedder-Policy: require-corp
 */
export async function muxFramesToMp4(
  frames: Uint8Array[],
  audioWav: ArrayBuffer,
  options: MuxOptions
): Promise<Blob> {
  if (frames.length === 0) {
    throw new Error("muxFramesToMp4() called with zero frames.");
  }

  options.onProgress?.("Loading ffmpeg.wasm…");

  // Dynamic import: consumers who only use image/scene generation and
  // handle their own encoding never pay for this dependency.
  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const { toBlobURL } = await import("@ffmpeg/util");

  const ffmpeg = new FFmpeg() as unknown as FFmpegLike;
  ffmpeg.on("log", ({ message }) => options.onProgress?.(message));

  const baseURL = options.coreBaseUrl ?? DEFAULT_CORE_BASE_URL;
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });

  options.onProgress?.(`Writing ${frames.length} frames to virtual filesystem…`);

  const padWidth = String(frames.length).length;
  for (let i = 0; i < frames.length; i++) {
    const name = `frame${String(i).padStart(Math.max(5, padWidth), "0")}.png`;
    await ffmpeg.writeFile(name, frames[i]);
  }

  await ffmpeg.writeFile("audio.wav", new Uint8Array(audioWav));

  options.onProgress?.("Encoding video (this can take a while on CPU/WASM)…");

  const framePattern = `frame%0${Math.max(5, padWidth)}d.png`;
  await ffmpeg.exec([
    "-framerate", String(options.fps),
    "-i", framePattern,
    "-i", "audio.wav",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    "-movflags", "+faststart",
    "output.mp4",
  ]);

  options.onProgress?.("Reading encoded output…");
  const data = await ffmpeg.readFile("output.mp4");
  const rawBytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const copy = new Uint8Array(rawBytes.byteLength);
  copy.set(rawBytes);

  return new Blob([copy], { type: "video/mp4" });
}
