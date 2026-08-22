/**
 * smart-video-engine (ESM Bundle)
 * --------------------------------
 * Full client-side AI script-to-video studio generator.
 * Features:
 * - Subtitles & Caption Overlay (Pill, Cinematic, Karaoke)
 * - Multi-Model AI (Pollinations, Flux, SDXL) & Stock Photos (Pixabay)
 * - Kokoro-82M Neural TTS & Fast Test Mock Synth
 * - Procedural Background Music (BGM) with Automatic Volume Ducking
 * - Ken Burns Pan/Zoom Camera Motion & Scene Crossfades
 * - ffmpeg.wasm MP4 Video Muxer
 */

// --- scenes ---
const STOP_WORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are",
  "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but",
  "by", "could", "did", "do", "does", "doing", "down", "during", "each", "few", "for", "from",
  "further", "had", "has", "have", "having", "he", "her", "here", "hers", "herself", "him",
  "himself", "his", "how", "i", "if", "in", "into", "is", "it", "its", "itself", "just", "me",
  "more", "most", "my", "myself", "no", "nor", "not", "now", "of", "off", "on", "once", "only",
  "or", "other", "our", "ours", "ourselves", "out", "over", "own", "same", "she", "should", "so",
  "some", "such", "than", "that", "the", "their", "theirs", "them", "themselves", "then", "there",
  "these", "they", "this", "those", "through", "to", "too", "under", "until", "up", "very", "was",
  "we", "were", "what", "when", "where", "which", "while", "who", "whom", "why", "with", "would",
  "you", "your", "yours", "yourself", "yourselves"
]);

export function extractKeywords(text) {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return Array.from(new Set(words)).slice(0, 5);
}

export function deriveEnhancedPrompt(text, style = "cinematic") {
  const styleModifiers = {
    cinematic: "cinematic lighting, highly detailed, photorealistic 8k, award winning cinematography, masterpiece",
    photorealistic: "sharp focus, ultra detailed 8k photography, Hasselblad photo, realistic lighting",
    anime: "studio ghibli aesthetic, makoto shinkai style, vibrant colors, detailed anime digital art",
    cyberpunk: "cyberpunk, neon glow, holographic reflections, futuristic city, blade runner style",
    fantasy: "ethereal fantasy, mystical glowing atmosphere, epic digital matte painting, unreal engine 5",
    none: "",
  };
  const modifier = styleModifiers[style ?? "cinematic"] || "";
  return modifier ? `${text.trim()}, ${modifier}` : text.trim();
}

function splitIntoSentences(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const raw = normalized.match(/[^.!?\u3002\u0964]+[.!?\u3002\u0964]+(?:\s|$)/gu) ?? [normalized];
  const sentences = [];
  for (const chunk of raw) {
    const trimmed = chunk.trim();
    if (trimmed) sentences.push(trimmed);
  }
  return sentences.length > 0 ? sentences : [normalized];
}

export function splitScript(script, options = {}) {
  const sentencesPerScene = Math.max(1, options.sentencesPerScene ?? 2);
  const style = options.style ?? "cinematic";
  const sentences = splitIntoSentences(script);

  const scenes = [];
  for (let i = 0; i < sentences.length; i += sentencesPerScene) {
    const group = sentences.slice(i, i + sentencesPerScene);
    const text = group.join(" ");
    const imagePrompt = deriveEnhancedPrompt(text, style);
    const keywords = extractKeywords(text);
    scenes.push({ text, imagePrompt, keywords });
  }
  return scenes;
}

// --- image providers ---
export function createPollinationsImageProvider(options = {}) {
  const baseUrl = options.baseUrl ?? "https://image.pollinations.ai/prompt/";
  const width = options.width ?? 1024;
  const height = options.height ?? 1024;
  const model = options.model ?? "default";

  return async (prompt) => {
    const seed = Math.floor(Math.random() * 1_000_000_000);
    const encodedPrompt = encodeURIComponent(prompt);
    let url = `${baseUrl}${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&nologo=true`;
    if (model && model !== "default") {
      url += `&model=${encodeURIComponent(model)}`;
    }
    return url;
  };
}

export function createPixabayImageProvider(options = {}) {
  const apiKey = options.apiKey;
  const fallbackAi = createPollinationsImageProvider({
    width: options.width,
    height: options.height,
  });

  return async (prompt, keywords = []) => {
    const query = keywords.length > 0 ? keywords.join(" ") : prompt.slice(0, 40);
    if (apiKey) {
      try {
        const searchUrl = `https://pixabay.com/api/?key=${encodeURIComponent(
          apiKey
        )}&q=${encodeURIComponent(query)}&image_type=photo&per_page=3&safesearch=true`;
        const resp = await fetch(searchUrl);
        if (resp.ok) {
          const data = await resp.json();
          if (data.hits && data.hits.length > 0) {
            const hit = data.hits[0];
            return hit.largeImageURL || hit.webformatURL;
          }
        }
      } catch (err) {
        console.warn("[smart-video-engine] Pixabay search failed, falling back to AI:", err);
      }
    }
    return fallbackAi(prompt);
  };
}

export function createLocalInferenceProvider(options = {}) {
  const endpointUrl = options.endpointUrl ?? "http://127.0.0.1:7860/sdapi/v1/txt2img";
  const width = options.width ?? 512;
  const height = options.height ?? 512;
  const steps = options.steps ?? 20;

  return async (prompt) => {
    try {
      const resp = await fetch(endpointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, steps, width, height }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.images && data.images.length > 0) {
          return `data:image/png;base64,${data.images[0]}`;
        }
      }
    } catch (e) {
      console.warn("[smart-video-engine] Local inference unreachable, falling back to Pollinations AI");
    }
    return createPollinationsImageProvider({ width, height })(prompt);
  };
}

// --- bgm & audio mixer ---
export function generateBgmAudio(durationSeconds, options = {}) {
  const sampleRate = options.sampleRate ?? 24000;
  const style = options.style ?? "ambient";
  const numSamples = Math.max(1, Math.round(durationSeconds * sampleRate));
  const samples = new Float32Array(numSamples);

  if (style === "none" || durationSeconds <= 0) {
    return samples;
  }

  const ambientChords = [
    [130.81, 196.00, 246.94, 293.66, 329.63], // Cmaj9
    [110.00, 164.81, 220.00, 261.63, 329.63], // Am9
    [87.31, 130.81, 174.61, 220.00, 261.63],  // Fmaj7
    [98.00, 146.83, 196.00, 261.63, 293.66],  // Gsus4
  ];
  const lofiChords = [
    [146.83, 220.00, 261.63, 329.63, 349.23], // Dm9
    [98.00, 196.00, 246.94, 329.63, 392.00],  // G13
    [130.81, 196.00, 246.94, 293.66, 329.63], // Cmaj9
    [110.00, 174.61, 220.00, 261.63, 311.13], // A7b9
  ];
  const cinematicChords = [
    [82.41, 123.47, 164.81, 196.00, 246.94],  // Em
    [65.41, 130.81, 196.00, 261.63, 329.63],  // C
    [98.00, 146.83, 196.00, 246.94, 293.66],  // G
    [73.42, 146.83, 220.00, 293.66, 369.99],  // D
  ];

  const chordProgression =
    style === "lofi" ? lofiChords : style === "cinematic" ? cinematicChords : ambientChords;
  const chordDuration = 4.0;

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const chordIndex = Math.floor(t / chordDuration) % chordProgression.length;
    const chordTime = (t % chordDuration) / chordDuration;
    const freqs = chordProgression[chordIndex];
    const chordFade = Math.sin(Math.PI * chordTime);

    let sample = 0;
    for (let f = 0; f < freqs.length; f++) {
      const freq = freqs[f];
      const osc1 = Math.sin(2 * Math.PI * freq * t);
      const osc2 = Math.sin(2 * Math.PI * (freq * 1.002) * t + 0.5) * 0.5;
      const osc3 = Math.sin(2 * Math.PI * (freq * 0.5) * t) * 0.35;
      sample += (osc1 + osc2 + osc3) / freqs.length;
    }

    const fadeIn = Math.min(1.0, t / 1.5);
    const fadeOut = Math.min(1.0, (durationSeconds - t) / 2.0);
    samples[i] = sample * fadeIn * fadeOut * chordFade * 0.25;
  }
  return samples;
}

export function mixVoiceWithBgm(voiceSamples, bgmSamples, options = {}) {
  const length = Math.max(voiceSamples.length, bgmSamples.length);
  const mixed = new Float32Array(length);
  const baseVolume = options.volume ?? 0.22;
  const duckedVolume = options.duckedVolume ?? 0.12;

  for (let i = 0; i < length; i++) {
    const voice = i < voiceSamples.length ? voiceSamples[i] : 0;
    const bgm = i < bgmSamples.length ? bgmSamples[i] : 0;
    const voiceActive = Math.abs(voice) > 0.02;
    const bgmVol = voiceActive ? duckedVolume : baseVolume;
    const raw = voice + bgm * bgmVol;
    mixed[i] = Math.max(-1.0, Math.min(1.0, raw));
  }
  return mixed;
}

// --- voice ---
export class VoiceGenerator {
  constructor(options = {}) {
    this.modelId = options.modelId ?? "onnx-community/Kokoro-82M-v1.0-ONNX";
    this.dtype = options.dtype ?? "q8";
    this.voice = options.voice ?? "af_heart";
    this.mock = options.mock ?? false;
    this.onProgress = options.onProgress;
    this.tts = null;
    this.isReady = false;
  }

  async init() {
    if (this.isReady) return;
    if (this.mock) {
      this.isReady = true;
      this.onProgress?.("Fast test mode ready (synth tones)", 100);
      return;
    }

    this.onProgress?.("Loading Kokoro neural voice model…", 0);
    try {
      const { KokoroTTS } = await import("kokoro-js");
      let device = "wasm";
      if (typeof navigator !== "undefined" && "gpu" in navigator) {
        try {
          const adapter = await navigator.gpu.requestAdapter();
          if (adapter) device = "webgpu";
        } catch (_) {}
      }

      this.tts = await KokoroTTS.from_pretrained(this.modelId, {
        dtype: this.dtype,
        device,
        progress_callback: (p) => {
          if (p && typeof p.progress === "number") {
            this.onProgress?.(
              `Downloading Kokoro weights (${p.file || "model"})`,
              Math.round(p.progress * 100)
            );
          }
        },
      });

      this.isReady = true;
      this.onProgress?.("Kokoro TTS ready.", 100);
    } catch (err) {
      console.warn("[smart-video-engine] Kokoro neural TTS load failed, falling back to mock tones:", err);
      this.mock = true;
      this.isReady = true;
      this.onProgress?.("Using fallback speech tones", 100);
    }
  }

  async generate(text) {
    await this.init();
    if (this.mock || !this.tts) {
      const wordCount = Math.max(1, text.trim().split(/\s+/).length);
      const durationSeconds = Math.max(2.0, wordCount * 0.38);
      const wav = createToneWav(durationSeconds, 24000);
      return { wav, durationSeconds };
    }

    try {
      const audio = await this.tts.generate(text, { voice: this.voice });
      const wav = await toWavArrayBuffer(audio);
      const durationSeconds = parseWavDuration(wav);
      return { wav, durationSeconds };
    } catch (err) {
      console.warn("[smart-video-engine] Kokoro generation error, falling back to mock tone:", err);
      const wordCount = Math.max(1, text.trim().split(/\s+/).length);
      const durationSeconds = Math.max(2.0, wordCount * 0.38);
      const wav = createToneWav(durationSeconds, 24000);
      return { wav, durationSeconds };
    }
  }

  async generateAll(texts, onProgress) {
    const results = [];
    for (let i = 0; i < texts.length; i++) {
      results.push(await this.generate(texts[i]));
      onProgress?.(i + 1, texts.length);
    }
    return results;
  }
}

async function toWavArrayBuffer(audio) {
  if (!audio) throw new Error("No audio returned from TTS");

  // 1. Try audio.toWav()
  if (typeof audio.toWav === "function") {
    const res = audio.toWav();
    if (res instanceof ArrayBuffer) return res;
    if (res instanceof Uint8Array) return res.buffer.slice(res.byteOffset, res.byteOffset + res.byteLength);
    if (res && typeof res.arrayBuffer === "function") return await res.arrayBuffer();
    if (res instanceof Blob) return await new Response(res).arrayBuffer();
  }

  // 2. Try audio.toBlob()
  if (typeof audio.toBlob === "function") {
    const blob = audio.toBlob();
    if (blob && typeof blob.arrayBuffer === "function") return await blob.arrayBuffer();
    return await new Response(blob).arrayBuffer();
  }

  // 3. Try audio.arrayBuffer()
  if (typeof audio.arrayBuffer === "function") {
    return await audio.arrayBuffer();
  }

  if (audio instanceof ArrayBuffer) return audio;
  if (audio instanceof Uint8Array) return audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength);

  throw new Error("Unable to extract WAV ArrayBuffer from TTS audio");
}

function parseWavDuration(wav) {
  const header = parseWavHeader(wav);
  const totalSamples = header.dataBytes / (header.bitsPerSample / 8) / header.numChannels;
  return totalSamples / header.sampleRate;
}

function parseWavHeader(wav) {
  const view = new DataView(wav);
  return {
    numChannels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    bitsPerSample: view.getUint16(34, true),
    dataBytes: view.getUint32(40, true),
  };
}

function createToneWav(durationSeconds, sampleRate = 24000) {
  const numSamples = Math.round(durationSeconds * sampleRate);
  const dataByteLength = numSamples * 4;
  const buffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataByteLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); // IEEE float32
  view.setUint16(22, 1, true); // 1 channel
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 32, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataByteLength, true);

  const floatView = new Float32Array(buffer, 44, numSamples);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = (
      Math.sin(2 * Math.PI * 220 * t) * 0.15 +
      Math.sin(2 * Math.PI * 330 * t) * 0.08 +
      Math.sin(2 * Math.PI * 440 * t) * 0.05
    ) * Math.min(1, t * 4) * Math.min(1, (durationSeconds - t) * 4);
    floatView[i] = sample;
  }
  return buffer;
}

// --- compose & subtitles ---
function createFallbackImage(width = 512, height = 512) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, "#0f2027");
    grad.addColorStop(0.5, "#203a43");
    grad.addColorStop(1, "#2c5364");
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
    const isLocalhost =
      typeof window !== "undefined" &&
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

    if (isLocalhost && !url.startsWith("blob:") && !url.startsWith("data:") && !url.startsWith("/")) {
      fetchUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`;
    }

    const resp = await fetch(fetchUrl);
    if (!resp.ok) {
      if (fetchUrl !== url) {
        try {
          const directResp = await fetch(url);
          if (directResp.ok) {
            const b = await directResp.blob();
            const bUrl = URL.createObjectURL(b);
            const im = new Image();
            return await new Promise((res) => {
              im.onload = () => res(im);
              im.onerror = async () => res(await createFallbackImage(512, 512));
              im.src = bUrl;
            });
          }
        } catch (_) {}
      }
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

function drawCoverFrame(ctx, img, width, height, zoomProgress, maxZoom, motionPatternIndex = 0) {
  const pattern = motionPatternIndex % 4;
  let zoom = 1.0;
  let panFactorX = 0;
  let panFactorY = 0;

  if (pattern === 0) {
    zoom = 1 + (maxZoom - 1) * zoomProgress;
    panFactorX = zoomProgress * 0.5 - 0.25;
    panFactorY = zoomProgress * 0.3 - 0.15;
  } else if (pattern === 1) {
    zoom = maxZoom - (maxZoom - 1) * zoomProgress;
    panFactorX = -zoomProgress * 0.5 + 0.25;
    panFactorY = -zoomProgress * 0.3 + 0.15;
  } else if (pattern === 2) {
    zoom = 1 + (maxZoom - 1) * zoomProgress;
    panFactorX = 0;
    panFactorY = (1 - zoomProgress) * 0.4 - 0.2;
  } else {
    zoom = 1 + (maxZoom - 1) * 0.5;
    panFactorX = (zoomProgress - 0.5) * 0.6;
    panFactorY = 0;
  }

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
  const panX = maxOffsetX * panFactorX;
  const panY = maxOffsetY * panFactorY;

  const x = (width - drawWidth) / 2 + panX;
  const y = (height - drawHeight) / 2 + panY;

  ctx.drawImage(img, x, y, drawWidth, drawHeight);
}

function drawSubtitles(ctx, text, progress, width, height, style = "pill") {
  if (style === "none" || !text.trim()) return;

  const fontSize = Math.max(18, Math.round(width * 0.038));
  ctx.save();
  ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const words = text.trim().split(/\s+/);
  const maxLineWidth = width * 0.85;

  const lines = [];
  let currentLine = "";
  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(testLine).width > maxLineWidth) {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);

  const lineHeight = fontSize * 1.35;
  const totalTextHeight = lines.length * lineHeight;
  const bottomMargin = height * 0.12;
  const startY = height - bottomMargin - totalTextHeight / 2;
  const activeWordIdx = Math.floor(progress * words.length);

  lines.forEach((line, lineIdx) => {
    const y = startY + lineIdx * lineHeight;
    const lineWidth = ctx.measureText(line).width;
    const x = width / 2;

    if (style === "pill") {
      const paddingX = fontSize * 0.7;
      const paddingY = fontSize * 0.25;
      const rectX = x - lineWidth / 2 - paddingX;
      const rectY = y - lineHeight / 2 - paddingY;
      const rectW = lineWidth + paddingX * 2;
      const rectH = lineHeight + paddingY * 2;

      ctx.fillStyle = "rgba(10, 15, 25, 0.72)";
      ctx.beginPath();
      ctx.roundRect
        ? ctx.roundRect(rectX, rectY, rectW, rectH, 8)
        : ctx.rect(rectX, rectY, rectW, rectH);
      ctx.fill();

      ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = "#ffffff";
      ctx.fillText(line, x, y);

    } else if (style === "cinematic") {
      ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 3;
      ctx.fillStyle = "#ffeb3b";
      ctx.fillText(line, x, y);

    } else if (style === "karaoke") {
      const paddingX = fontSize * 0.7;
      const paddingY = fontSize * 0.25;
      const rectX = x - lineWidth / 2 - paddingX;
      const rectY = y - lineHeight / 2 - paddingY;
      const rectW = lineWidth + paddingX * 2;
      const rectH = lineHeight + paddingY * 2;

      ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
      ctx.beginPath();
      ctx.roundRect
        ? ctx.roundRect(rectX, rectY, rectW, rectH, 6)
        : ctx.rect(rectX, rectY, rectW, rectH);
      ctx.fill();

      const lineWords = line.split(/\s+/);
      let curX = x - lineWidth / 2;
      ctx.textAlign = "left";

      lineWords.forEach((word) => {
        const wordWidth = ctx.measureText(word).width;
        const spaceWidth = ctx.measureText(" ").width;
        const isCurrent = words[activeWordIdx] === word;

        if (isCurrent) {
          ctx.fillStyle = "#38ef7d";
          ctx.shadowColor = "rgba(56, 239, 125, 0.6)";
          ctx.shadowBlur = 8;
        } else {
          ctx.fillStyle = "#ffffff";
          ctx.shadowBlur = 0;
        }
        ctx.fillText(word, curX, y);
        curX += wordWidth + spaceWidth;
      });
    }
  });

  ctx.restore();
}

export async function composeFrames(scenes, options = {}) {
  if (typeof document === "undefined") {
    throw new Error("composeFrames() requires a browser DOM and cannot run in Node.");
  }

  const width = options.width ?? 1024;
  const height = options.height ?? 1024;
  const fps = options.fps ?? 24;
  const maxZoom = options.maxZoom ?? 1.15;
  const subtitles = options.subtitles ?? "pill";
  const crossfade = options.crossfade ?? true;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Failed to create 2D canvas rendering context.");
  }

  const loadedImages = [];
  for (let i = 0; i < scenes.length; i++) {
    const img = await loadImage(scenes[i].imageUrl);
    try {
      if (img.decode) await img.decode();
    } catch (_) {}
    loadedImages.push(img);
  }

  const sceneFrameCounts = scenes.map((s) => Math.max(1, Math.round(s.durationSeconds * fps)));
  const totalFrames = sceneFrameCounts.reduce((sum, n) => sum + n, 0);

  const frames = [];
  let frameIndex = 0;

  for (let sceneIdx = 0; sceneIdx < scenes.length; sceneIdx++) {
    const img = loadedImages[sceneIdx];
    const nextImg = sceneIdx + 1 < loadedImages.length ? loadedImages[sceneIdx + 1] : null;
    const sceneText = scenes[sceneIdx].text;
    const sceneFrames = sceneFrameCounts[sceneIdx];
    const crossfadeFrames = crossfade && nextImg ? Math.min(Math.round(fps * 0.4), Math.floor(sceneFrames * 0.3)) : 0;

    for (let f = 0; f < sceneFrames; f++) {
      const zoomProgress = f / Math.max(1, sceneFrames - 1);
      ctx.clearRect(0, 0, width, height);

      drawCoverFrame(ctx, img, width, height, zoomProgress, maxZoom, sceneIdx);

      if (crossfadeFrames > 0 && f >= sceneFrames - crossfadeFrames && nextImg) {
        const fadeAlpha = (f - (sceneFrames - crossfadeFrames)) / crossfadeFrames;
        ctx.save();
        ctx.globalAlpha = fadeAlpha;
        drawCoverFrame(ctx, nextImg, width, height, 0, maxZoom, sceneIdx + 1);
        ctx.restore();
      }

      drawSubtitles(ctx, sceneText, zoomProgress, width, height, subtitles);

      const dataUrl = canvas.toDataURL("image/png");
      const base64 = dataUrl.split(",")[1];
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      frames.push(bytes);

      frameIndex++;
      options.onProgress?.(frameIndex, totalFrames);
    }
  }

  return { frames, fps, width, height };
}

// --- mux ---
const DEFAULT_CORE_BASE_URL =
  typeof import.meta !== "undefined" && import.meta.url
    ? new URL("../vendor/core", import.meta.url).href
    : "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";

export async function muxFramesToMp4(frames, audioWav, options = {}) {
  if (frames.length === 0) {
    throw new Error("Cannot mux an empty frame array.");
  }

  const fps = options.fps ?? 24;
  const baseURL = options.coreBaseUrl ?? DEFAULT_CORE_BASE_URL;

  options.onProgress?.("Loading ffmpeg.wasm…");
  const { FFmpeg } = await import("@ffmpeg/ffmpeg");
  const { toBlobURL } = await import("@ffmpeg/util");

  const ffmpeg = new FFmpeg();
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });

  options.onProgress?.("Writing frame assets…");
  for (let i = 0; i < frames.length; i++) {
    const filename = `frame${String(i).padStart(5, "0")}.png`;
    await ffmpeg.writeFile(filename, frames[i]);
  }

  options.onProgress?.("Writing audio track…");
  await ffmpeg.writeFile("audio.wav", new Uint8Array(audioWav));

  options.onProgress?.("Encoding MP4…");
  const ffmpegArgs = [
    "-framerate", String(fps),
    "-i", "frame%05d.png",
    "-i", "audio.wav",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-shortest",
    "-movflags", "+faststart",
    "output.mp4",
  ];

  await ffmpeg.exec(ffmpegArgs);

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
      ((script) => splitScript(script, { style: options.style ?? "cinematic" }));

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

    if (this.bgm !== "none") {
      const totalDuration = voiceSegments.reduce((sum, seg) => sum + seg.durationSeconds, 0);
      const parsedWav = parseWav({ wav: audioWav, durationSeconds: totalDuration });

      if (parsedWav.audioFormat === 3) {
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

function encodeFloatWav(samples, sampleRate, numChannels) {
  const dataByteLength = samples.length * 4;
  const buffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataByteLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
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
