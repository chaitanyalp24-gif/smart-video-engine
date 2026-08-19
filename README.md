# 🎬 smart-video-engine

[![License: MPL 2.0](https://img.shields.io/badge/License-MPL_2.0-brightgreen.svg)](https://opensource.org/licenses/MPL-2.0)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![WebGPU / WASM](https://img.shields.io/badge/Runtime-WebGPU%20%2F%20WASM-orange.svg)]()
[![Zero API Keys](https://img.shields.io/badge/Cost-100%25%20Free%20%26%20Keyless-purple.svg)]()

> **100% Client-Side AI Script-to-Video Generator in JavaScript/TypeScript.**  
> Transforms raw text scripts into styled, narrated, animated MP4 videos directly inside the user's browser with **zero backend servers** and **zero paid API keys**.

---

## 🚀 Live Demo

Experience the engine in your browser:  
👉 **[Live Demo on GitHub Pages](https://chaitanyalp24-gif.github.io/smart-video-engine/)**

*(Or run locally with one command: `py demo/serve.py`)*

---

## ✨ Features & Architecture

```
                       ┌─────────────────────────┐
                       │   Raw Script / Story    │
                       └────────────┬────────────┘
                                    │
                         [ 1. Scene Splitter ]
                                    │
                  ┌─────────────────┴─────────────────┐
                  ▼                                   ▼
        [ 2. Image Generation ]             [ 3. Local TTS Narration ]
        Pollinations.ai (Free/No-Key)       Kokoro-82M (WebGPU / WASM)
                  │                                   │
                  └─────────────────┬─────────────────┘
                                    │
                        [ 4. Canvas Compositor ]
                        Ken Burns Pan & Zoom, 24 FPS
                                    │
                          [ 5. Video Muxer ]
                          ffmpeg.wasm → .MP4 Blob
                                    │
                                    ▼
                         🎬 Downloadable MP4 Video
```

1. **✂️ Client-Side Scene Splitting**: Intelligently breaks long narrative scripts into scenes and derives cinematic image prompts.
2. **🎨 Free AI Image Generation**: Integrated with Pollinations.ai for keyless image synthesis with automatic resolution matching and procedural fallback protection.
3. **🗣️ In-Browser Neural TTS**: Powered by **Kokoro-82M** via WebGPU/WASM (`kokoro-js`) for human-quality voiceover generation with automatic IEEE Float32 audio format preservation.
4. **🎥 Cinematic Canvas Compositing**: Ken Burns camera pan and zoom interpolation across scene frames at 15–60 FPS.
5. **🎞️ Client-Side MP4 Encoding**: Uses `@ffmpeg/ffmpeg` with self-hosted WebAssembly binaries to mux PNG frame streams and WAV audio into an MP4 container.

---

## 📦 Installation

```bash
npm install smart-video-engine
```

Or clone the repository:

```bash
git clone https://github.com/chaitanyalp24-gif/smart-video-engine.git
cd smart-video-engine
```

---

## 💻 Quick Start

### 1. Simple JavaScript / TypeScript Usage

```typescript
import { SmartVideoEngine } from "smart-video-engine";

const engine = new SmartVideoEngine({
  voice: "af_heart",     // Kokoro voice preset
  width: 768,            // Video width
  height: 768,           // Video height
  fps: 24,               // Framerate
  onProgress: (stage, detail) => {
    console.log(`[${stage}] ${detail ?? ""}`);
  }
});

const script = `
  A lone fox walks through a quiet snowy forest at dawn.
  Sunlight breaks through tall frosted trees, casting long golden shadows.
  In the distance, a crystal-clear river sparkles under the crisp morning air.
`;

const result = await engine.generate(script);

// Set video player source or download
const videoEl = document.querySelector("video");
videoEl.src = result.url;
videoEl.play();
```

---

## 🛠️ Running the Interactive Demo Locally

Because WebAssembly and Web Workers require `SharedArrayBuffer`, pages need cross-origin isolation headers (`COOP` and `COEP`). The repository comes with a built-in dev server:

### Using Python:
```bash
py demo/serve.py
```

### Using Node.js:
```bash
node demo/serve.mjs
```

Then open your browser to:
👉 **[http://localhost:8080/demo/index.html](http://localhost:8080/demo/index.html)**

---

## 📖 API Reference

### `new SmartVideoEngine(options)`

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `voice` | `string` | `"af_heart"` | Voice preset (`af_heart`, `af_bella`, `af_nicole`, `af_sarah`, `af_sky`, `am_adam`, `am_michael`) |
| `mockVoice` | `boolean` | `false` | Enable instant tone synthesis for fast ~3-second testing without downloading the neural model |
| `width` | `number` | `1024` | Video frame width in pixels |
| `height` | `number` | `1024` | Video frame height in pixels |
| `fps` | `number` | `24` | Video frames per second (15, 24, 30, 60) |
| `sceneSplitter` | `function` | Default splitter | Custom function `(script: string) => Promise<Scene[]>` |
| `imageProvider` | `function` | Pollinations | Custom function `(prompt: string) => Promise<string>` |
| `onProgress` | `function` | `undefined` | Callback `(stage: string, detail?: string) => void` |

### `engine.generate(script: string): Promise<GenerateVideoResult>`

Returns:
- `blob`: The generated MP4 file as a standard `Blob`.
- `url`: A `blob:...` Object URL ready for `<video src="...">` or downloading.
- `scenes`: Array of parsed scenes and derived visual prompts.
- `voiceSegments`: Array of audio WAV buffers and calculated scene durations.

---

## 📄 License

This project is licensed under the **Mozilla Public License 2.0 (MPL-2.0)**.  
See the [LICENSE](LICENSE) file for details.
