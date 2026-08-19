/**
 * compose
 * -------
 * Renders each scene's image onto a canvas across its narration duration,
 * applying a Ken-Burns-style pan/zoom and a cross-fade at scene boundaries,
 * and exports the sequence as PNG frames ready for ffmpeg.wasm to encode.
 *
 * This is pure canvas/browser code — it needs a real DOM (document,
 * HTMLCanvasElement, Image) and cannot run in Node or be verified outside
 * an actual browser.
 */

export interface ComposeOptions {
  /** Output frame width in pixels. Default: 1024 */
  width?: number;
  /** Output frame height in pixels. Default: 1024 */
  height?: number;
  /** Frames per second for the output video. Default: 24 */
  fps?: number;
  /** Fraction of each scene (0–0.5) spent cross-fading into the next. Default: 0.15 */
  fadeFraction?: number;
  /** Maximum zoom applied over the course of a scene (1.0 = no zoom). Default: 1.12 */
  maxZoom?: number;
  onProgress?: (renderedFrames: number, totalFrames: number) => void;
}

export interface SceneWithMedia {
  /** URL (https:// or data:) of the scene's generated/stock image. */
  imageUrl: string;
  /** Narration duration in seconds for this scene, from VoiceSegment.durationSeconds. */
  durationSeconds: number;
}

export interface ComposedFrames {
  /** PNG bytes for each frame, in order. Filenames follow frame%05d.png convention. */
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

/** Draws an image into a canvas with "cover" scaling, offset by a pan/zoom progress value. */
function drawCoverFrame(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  width: number,
  height: number,
  zoomProgress: number, // 0 -> 1 across the scene
  maxZoom: number
): void {
  const zoom = 1 + (maxZoom - 1) * zoomProgress;

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

  // Slow pan from top-left-biased to centered as zoom increases, for a
  // subtle Ken Burns feel rather than a static center-zoom.
  const maxOffsetX = (drawWidth - width) / 2;
  const maxOffsetY = (drawHeight - height) / 2;
  const panX = -maxOffsetX + maxOffsetX * 2 * (zoomProgress * 0.5);
  const panY = -maxOffsetY + maxOffsetY * 2 * (zoomProgress * 0.5);

  const x = (width - drawWidth) / 2 + panX;
  const y = (height - drawHeight) / 2 + panY;

  ctx.drawImage(img, x, y, drawWidth, drawHeight);
}

/**
 * Renders every scene's image across its narration duration into a flat
 * sequence of PNG frames, with pan/zoom and cross-fade transitions.
 *
 * Requires a real browser DOM. Throws if `document` is unavailable.
 */
export async function composeFrames(
  scenes: SceneWithMedia[],
  options: ComposeOptions = {}
): Promise<ComposedFrames> {
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

  const frames: Uint8Array[] = [];
  let renderedFrames = 0;

  for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex++) {
    const scene = scenes[sceneIndex];
    const img = images[sceneIndex];
    const nextImg = images[sceneIndex + 1]; // undefined on the last scene

    const sceneFrameCount = Math.max(1, Math.round(scene.durationSeconds * fps));
    const fadeFrameCount = Math.round(sceneFrameCount * fadeFraction);

    for (let f = 0; f < sceneFrameCount; f++) {
      const zoomProgress = sceneFrameCount > 1 ? f / (sceneFrameCount - 1) : 0;

      ctx.clearRect(0, 0, width, height);
      drawCoverFrame(ctx, img, width, height, zoomProgress, maxZoom);

      // Cross-fade the last `fadeFrameCount` frames of this scene into the
      // first frame pose of the next scene's image.
      const framesFromEnd = sceneFrameCount - 1 - f;
      if (nextImg && fadeFrameCount > 0 && framesFromEnd < fadeFrameCount) {
        const fadeAlpha = 1 - framesFromEnd / fadeFrameCount;
        ctx.save();
        ctx.globalAlpha = fadeAlpha;
        drawCoverFrame(ctx, nextImg, width, height, 0, maxZoom);
        ctx.restore();
      }

      const blob = await new Promise<Blob | null>((resolve) =>
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
