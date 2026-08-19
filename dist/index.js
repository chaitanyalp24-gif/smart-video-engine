/**
 * smart-video-engine (dist/index.js)
 * ---------------------------------
 * Free, browser-based script-to-video generator:
 * - Pollinations AI image generation (free & keyless)
 * - Local Kokoro TTS (WebGPU/WASM) with graceful audio fallback
 * - Canvas compositing with Ken Burns pan/zoom and cross-fades
 * - ffmpeg.wasm muxing to MP4
 */

// --- scenes ---
function splitIntoSentences(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const raw = normalized.match(/[^.!?]+[.!?]+(?:\s|$)/g) ?? [normalized];
  const sentences = [];
  for (const chunk of raw) {
    const trimmed = chunk.trim();
    if (trimmed) sentences.push(trimmed);
  }
  return sentences.length > 0 ? sentences : [normalized];
}

export function splitScript(script, options = {}) {
  const sentencesPerScene = Math.max(1, options.sentencesPerScene ?? 2);
  const sentences = splitIntoSentences(script);
  const scenes = [];
  for (let i = 0; i < sentences.length; i += sentencesPerScene) {
    const group = sentences.slice(i, i + sentencesPerScene);
    const text = group.join(" ");
    scenes.push({ text, imagePrompt: text });
  }
  return scenes;
}

// --- imageProvider ---
export function createPollinationsImageProvider(options = {}) {
  const baseUrl = options.baseUrl ?? "https://image.pollinations.ai/prompt/";
  const width = options.width ?? 1024;
  const height = options.height ?? 1024;

  return async (prompt) => {
    const seed = Math.floor(Math.random() * 1_000_000_000);
    const encodedPrompt = encodeURIComponent(prompt);
    return `${baseUrl}${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&nologo=true`;
  };
}

// --- voice ---
export class VoiceGenerator {
  constructor(options = {}) {
    this.tts = null;
    this.modelId = options.modelId ?? "onnx-community/Kokoro-82M-v1.0-ONNX";
    this.voice = options.voice ?? "af_heart";
    this.mock = options.mock ?? false;
    this.onProgress = options.onProgress;
  }

  async init() {
    if (this.mock) {
      this.onProgress?.("Fast simulated voice mode ready.", 100);
      return;
    }

    const device = (await this.detectWebGPU()) ? "webgpu" : "wasm";
    const dtype = device === "webgpu" ? "fp32" : "q8";

    this.onProgress?.(`Loading Kokoro TTS model on ${device}…`, 0);

    try {
      const { KokoroTTS } = await import("kokoro-js");
      this.tts = await KokoroTTS.from_pretrained(this.modelId, {
        dtype,
        device,
      });

      this.onProgress?.("Kokoro TTS ready.", 100);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.onProgress?.(`Kokoro model load failed (${msg}). Using fallback voice tone.`, 100);
    }
  }

  listVoices() {
    if (!this.tts?.list_voices) return ["af_heart", "af_bella", "af_nicole", "af_sky", "am_adam"];
    return this.tts.list_voices();
  }

  async generate(text) {
    if (this.tts) {
      try {
        const audio = await this.tts.generate(text, { voice: this.voice });
        const wav = audio.toWav();

        return {
          text,
          wav,
          durationSeconds: estimateWavDurationSeconds(wav),
        };
      } catch (err) {
        console.warn("TTS generation error, using fallback audio:", err);
      }
    }

    const words = text.trim().split(/\s+/).length;
    const durationSeconds = Math.max(2.5, words * 0.35);
    const wav = createToneWav(durationSeconds);

    return {
      text,
      wav,
      durationSeconds,
    };
  }

  async generateAll(texts, onSceneProgress) {
    const segments = [];
    for (let i = 0; i < texts.length; i++) {
      segments.push(await this.generate(texts[i]));
      onSceneProgress?.(i + 1, texts.length);
    }
    return segments;
  }

  async detectWebGPU() {
    if (typeof navigator === "undefined") return false;
    const nav = navigator;
    if (!nav.gpu) return false;
    try {
      const adapter = await nav.gpu.requestAdapter();
      return adapter !== null && adapter !== undefined;
    } catch {
      return false;
    }
  }
}

function estimateWavDurationSeconds(wav) {
  const view = new DataView(wav);
  const bytes = new Uint8Array(wav);
  const decoder = new TextDecoder("ascii");

  let offset = 12;
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

    offset += 8 + chunkSize + (chunkSize % 2);
  }

  if (byteRate === 0) return 0;
  return dataSize / byteRate;
}

export function createToneWav(durationSeconds = 3, sampleRate = 24000) {
  const numSamples = Math.round(durationSeconds * sampleRate);
  const totalDataLength = numSamples * 2;
  const buffer = new ArrayBuffer(44 + totalDataLength);
  const view = new DataView(buffer);

  for (let i = 0; i < 4; i++) view.setUint8(i, "RIFF".charCodeAt(i));
  view.setUint32(4, 36 + totalDataLength, true);
  for (let i = 0; i < 4; i++) view.setUint8(8 + i, "WAVE".charCodeAt(i));
  for (let i = 0; i < 4; i++) view.setUint8(12 + i, "fmt ".charCodeAt(i));
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
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

// --- compose ---
function createFallbackImage(width = 512, height = 512) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, "#1e3c72");
    grad.addColorStop(0.5, "#2a5298");
    grad.addColorStop(1, "#f77737");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "rgba(255,255,255,0.7)";
    for (let i = 0; i < 35; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const r = Math.random() * 2 + 1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const img = new Image();
  img.src = canvas.toDataURL("image/jpeg", 0.9);
  return new Promise((resolve) => {
    img.onload = () => resolve(img);
  });
}

async function loadImage(url) {
  try {
    let fetchUrl = url;
    if (
      typeof window !== "undefined" &&
      !url.startsWith("blob:") &&
      !url.startsWith("data:") &&
      !url.startsWith("/")
    ) {
      fetchUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`;
    }

    const resp = await fetch(fetchUrl);
    if (!resp.ok) {
      console.warn(`[smart-video-engine] Image request failed (${resp.status}), using scenic fallback.`);
      return await createFallbackImage(512, 512);
    }
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);

    const img = new Image();
    return await new Promise((resolve) => {
      img.onload = () => resolve(img);
      img.onerror = async () => {
        URL.revokeObjectURL(blobUrl);
        console.warn(`[smart-video-engine] Image decode failed, using scenic fallback.`);
        resolve(await createFallbackImage(512, 512));
      };
      img.src = blobUrl;
    });
  } catch (err) {
    console.warn(`[smart-video-engine] Image load error (${err}), using scenic fallback.`);
    return await createFallbackImage(512, 512);
  }
}

function drawCoverFrame(ctx, img, width, height, zoomProgress, maxZoom) {
  const zoom = 1 + (maxZoom - 1) * zoomProgress;
  const imgRatio = img.width / img.height;
  const canvasRatio = width / height;

  let drawWidth;
  let drawHeight;

  if (imgRatio > canvasRatio) {
    drawHeight = height * zoom;
    drawWidth = drawHeight * imgRatio;
  } else {
    drawWidth = width * zoom;
    drawHeight = drawWidth / imgRatio;
  }

  const maxOffsetX = (drawWidth - width) / 2;
  const maxOffsetY = (drawHeight - height) / 2;
  const panX = -maxOffsetX + maxOffsetX * 2 * (zoomProgress * 0.5);
  const panY = -maxOffsetY + maxOffsetY * 2 * (zoomProgress * 0.5);

  const x = (width - drawWidth) / 2 + panX;
  const y = (height - drawHeight) / 2 + panY;

  ctx.drawImage(img, x, y, drawWidth, drawHeight);
}

export async function composeFrames(scenes, options = {}) {
  if (typeof document === "undefined") {
    throw new Error(
      "composeFrames() requires a browser DOM (document, canvas, Image) and cannot run in Node."
    );
  }

  const width = options.width ?? 1024;
  const height = options.height ?? 1024;
  const fps = options.fps ?? 24;
  const fadeFraction = Math.min(0.5, Math.max(0, options.fadeFraction ?? 0.15));
  const maxZoom = options.maxZoom ?? 1.12;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to acquire 2D canvas context.");

  const totalFrames = scenes.reduce(
    (sum, s) => sum + Math.max(1, Math.round(s.durationSeconds * fps)),
    0
  );

  const images = await Promise.all(scenes.map((s) => loadImage(s.imageUrl)));

  const frames = [];
  let renderedFrames = 0;

  for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex++) {
    const scene = scenes[sceneIndex];
    const img = images[sceneIndex];
    const nextImg = images[sceneIndex + 1];

    const sceneFrameCount = Math.max(1, Math.round(scene.durationSeconds * fps));
    const fadeFrameCount = Math.round(sceneFrameCount * fadeFraction);

    for (let f = 0; f < sceneFrameCount; f++) {
      const zoomProgress = sceneFrameCount > 1 ? f / (sceneFrameCount - 1) : 0;

      ctx.clearRect(0, 0, width, height);
      drawCoverFrame(ctx, img, width, height, zoomProgress, maxZoom);

      const framesFromEnd = sceneFrameCount - 1 - f;
      if (nextImg && fadeFrameCount > 0 && framesFromEnd < fadeFrameCount) {
        const fadeAlpha = 1 - framesFromEnd / fadeFrameCount;
        ctx.save();
        ctx.globalAlpha = fadeAlpha;
        drawCoverFrame(ctx, nextImg, width, height, 0, maxZoom);
        ctx.restore();
      }

      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/png")
      );
      if (!blob) throw new Error("canvas.toBlob() returned null while rendering a frame.");

      frames.push(new Uint8Array(await blob.arrayBuffer()));
      renderedFrames++;
      options.onProgress?.(renderedFrames, totalFrames);
    }
  }

  return { frames, fps, width, height };
}

// --- mux ---
const DEFAULT_CORE_BASE_URL =
  typeof window !== "undefined" && window.location.origin
    ? `${window.location.origin}/vendor/core`
    : "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";

export async function muxFramesToMp4(frames, audioWav, options) {
  if (frames.length === 0) {
    throw new Error("muxFramesToMp4() called with zero frames.");
  }

  options.onProgress?.("Loading ffmpeg.wasm…");

  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const { toBlobURL } = await import("@ffmpeg/util");

  const ffmpeg = new FFmpeg();
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

// --- orchestrator ---
export class SmartVideoEngine {
  constructor(options = {}) {
    this.sceneSplitter = options.sceneSplitter ?? ((script) => splitScript(script));
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

  async generate(script) {
    this.onProgress?.("splitting-scenes");
    const scenes = await this.sceneSplitter(script);
    if (scenes.length === 0) {
      throw new Error("Script produced zero scenes — nothing to generate.");
    }

    this.onProgress?.("loading-voice-model");
    await this.voiceGenerator.init();

    this.onProgress?.("generating-images", `0/${scenes.length}`);
    const imageUrls = [];
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

async function concatenateWavSegments(segments) {
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

function parseWav(segment) {
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

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

export default SmartVideoEngine;
