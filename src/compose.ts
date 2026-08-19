/**
 * compose
 * -------
 * Composites scene images and synchronized text subtitles onto an HTML5
 * Canvas with Ken Burns pan/zoom animation, transitions, and export to PNG frames.
 */

export interface ComposeOptions {
  /** Output frame width in pixels. Default: 1024. */
  width?: number;
  /** Output frame height in pixels. Default: 1024. */
  height?: number;
  /** Frame rate for animation. Default: 24. */
  fps?: number;
  /** Maximum zoom scale factor for Ken Burns motion. Default: 1.15. */
  maxZoom?: number;
  /** Subtitle styling. Default: "pill". */
  subtitles?: "pill" | "cinematic" | "karaoke" | "none";
  /** Enable smooth crossfade transition between scenes. Default: true */
  crossfade?: boolean;
  /** Called periodically with compositing progress. */
  onProgress?: (currentFrame: number, totalFrames: number) => void;
}

export interface SceneWithMedia {
  /** Image URL (https:, blob:, or data:) generated for this scene. */
  imageUrl: string;
  /** Narration text for subtitles and timing. */
  text: string;
  /** Narration duration in seconds for this scene. */
  durationSeconds: number;
}

export interface ComposedFrames {
  /** PNG bytes for each frame, in order. */
  frames: Uint8Array[];
  fps: number;
  width: number;
  height: number;
}

function createFallbackImage(width = 512, height = 512): Promise<HTMLImageElement> {
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

/** Loads an <img> from a URL, waiting for full decode with fallback on network error. */
async function loadImage(url: string): Promise<HTMLImageElement> {
  try {
    let fetchUrl = url;
    const isLocalhost =
      typeof window !== "undefined" &&
      (window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1");

    if (
      isLocalhost &&
      !url.startsWith("blob:") &&
      !url.startsWith("data:") &&
      !url.startsWith("/")
    ) {
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
            return await new Promise<HTMLImageElement>((res) => {
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
    return await new Promise<HTMLImageElement>((resolve) => {
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

/** Draws an image into a canvas with "cover" scaling and varied Ken Burns motion patterns. */
function drawCoverFrame(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  width: number,
  height: number,
  zoomProgress: number, // 0 -> 1 across the scene
  maxZoom: number,
  motionPatternIndex = 0
): void {
  // 4 alternating motion patterns:
  // 0: Zoom In & slow pan right
  // 1: Zoom Out & slow pan left
  // 2: Zoom In & tilt up
  // 3: Pan left to right
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

  let drawWidth: number;
  let drawHeight: number;

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

/** Draws stylish burned-in subtitles with word wrapping and optional karaoke highlight. */
function drawSubtitles(
  ctx: CanvasRenderingContext2D,
  text: string,
  progress: number, // 0 to 1 in scene
  width: number,
  height: number,
  style: ComposeOptions["subtitles"] = "pill"
): void {
  if (style === "none" || !text.trim()) return;

  const fontSize = Math.max(18, Math.round(width * 0.038));
  ctx.save();
  ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const words = text.trim().split(/\s+/);
  const maxLineWidth = width * 0.85;

  // Wrap words into lines
  const lines: string[] = [];
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

  // Active word index for karaoke
  const activeWordIdx = Math.floor(progress * words.length);

  lines.forEach((line, lineIdx) => {
    const y = startY + lineIdx * lineHeight;
    const lineWidth = ctx.measureText(line).width;
    const x = width / 2;

    if (style === "pill") {
      // Dark rounded pill background
      const paddingX = fontSize * 0.7;
      const paddingY = fontSize * 0.25;
      const rectX = x - lineWidth / 2 - paddingX;
      const rectY = y - lineHeight / 2 - paddingY;
      const rectW = lineWidth + paddingX * 2;
      const rectH = lineHeight + paddingY * 2;
      const radius = 8;

      ctx.fillStyle = "rgba(10, 15, 25, 0.72)";
      ctx.beginPath();
      ctx.roundRect
        ? ctx.roundRect(rectX, rectY, rectW, rectH, radius)
        : ctx.rect(rectX, rectY, rectW, rectH);
      ctx.fill();

      // Border glow
      ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // White text
      ctx.fillStyle = "#ffffff";
      ctx.fillText(line, x, y);

    } else if (style === "cinematic") {
      // Bold text with drop shadow
      ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
      ctx.shadowBlur = 10;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 3;

      ctx.fillStyle = "#ffeb3b"; // Cinematic warm yellow
      ctx.fillText(line, x, y);

    } else if (style === "karaoke") {
      // Draw pill background
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

      // Draw word by word with active highlight
      const lineWords = line.split(/\s+/);
      let curX = x - lineWidth / 2;
      ctx.textAlign = "left";

      lineWords.forEach((word) => {
        const wordWidth = ctx.measureText(word).width;
        const spaceWidth = ctx.measureText(" ").width;

        // Is this word currently active?
        const isCurrent = words[activeWordIdx] === word;

        if (isCurrent) {
          ctx.fillStyle = "#38ef7d"; // Neon highlight green
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

/**
 * Renders every scene's image across its narration duration into a flat
 * sequence of PNG frames, with pan/zoom, subtitles, and transitions.
 */
export async function composeFrames(
  scenes: SceneWithMedia[],
  options: ComposeOptions = {}
): Promise<ComposedFrames> {
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

  // Pre-load all scene images in parallel
  const loadedImages: HTMLImageElement[] = await Promise.all(
    scenes.map((s) => loadImage(s.imageUrl))
  );

  const sceneFrameCounts = scenes.map((s) =>
    Math.max(1, Math.round(s.durationSeconds * fps))
  );
  const totalFrames = sceneFrameCounts.reduce((sum, n) => sum + n, 0);

  const frames: Uint8Array[] = [];
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

      // Render base scene frame
      drawCoverFrame(ctx, img, width, height, zoomProgress, maxZoom, sceneIdx);

      // Render crossfade into next scene
      if (crossfadeFrames > 0 && f >= sceneFrames - crossfadeFrames && nextImg) {
        const fadeAlpha = (f - (sceneFrames - crossfadeFrames)) / crossfadeFrames;
        ctx.save();
        ctx.globalAlpha = fadeAlpha;
        drawCoverFrame(ctx, nextImg, width, height, 0, maxZoom, sceneIdx + 1);
        ctx.restore();
      }

      // Render synchronized subtitles on top
      drawSubtitles(ctx, sceneText, zoomProgress, width, height, subtitles);

      // Export canvas frame as PNG Uint8Array
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
