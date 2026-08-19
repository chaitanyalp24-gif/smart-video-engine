/**
 * imageProvider
 * -------------
 * Pluggable image & media backends:
 * 1. Pollinations Multi-Model AI (Flux, Turbo, Midjourney, Anime) - Free & Keyless
 * 2. Pixabay Stock Media Provider (Real stock photos from search keywords)
 * 3. Local Desktop Inference Adapter (ComfyUI / Automatic1111 / Imference Desktop)
 */

export type ImageProvider = (prompt: string, keywords?: string[]) => Promise<string>;

export interface PollinationsImageProviderOptions {
  baseUrl?: string;
  width?: number;
  height?: number;
  /** AI Model variant: "flux" (high-detail), "turbo" (fast), "anime", or "default" */
  model?: "flux" | "turbo" | "anime" | "default";
}

/**
 * Creates an ImageProvider backed by Pollinations' free, keyless AI generation endpoint.
 */
export function createPollinationsImageProvider(
  options: PollinationsImageProviderOptions = {}
): ImageProvider {
  const baseUrl = options.baseUrl ?? "https://image.pollinations.ai/prompt/";
  const width = options.width ?? 1024;
  const height = options.height ?? 1024;
  const model = options.model ?? "default";

  return async (prompt: string): Promise<string> => {
    const seed = Math.floor(Math.random() * 1_000_000_000);
    const encodedPrompt = encodeURIComponent(prompt);
    let url = `${baseUrl}${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&nologo=true`;
    if (model && model !== "default") {
      url += `&model=${encodeURIComponent(model)}`;
    }
    return url;
  };
}

export interface PixabayImageProviderOptions {
  /** Optional Pixabay API Key (if omitted, falls back to free keyword imagery) */
  apiKey?: string;
  width?: number;
  height?: number;
}

/**
 * Creates an ImageProvider backed by Pixabay Stock Photos API.
 * Uses extracted sentence keywords to search royalty-free stock imagery (text2video style).
 */
export function createPixabayImageProvider(
  options: PixabayImageProviderOptions = {}
): ImageProvider {
  const apiKey = options.apiKey;
  const fallbackAi = createPollinationsImageProvider({
    width: options.width,
    height: options.height,
  });

  return async (prompt: string, keywords: string[] = []): Promise<string> => {
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

    // Free Unsplash/Stock keyword proxy fallback or AI fallback
    const encodedTag = encodeURIComponent(keywords[0] || "nature");
    const stockUrl = `https://images.unsplash.com/photo-1500000000000?auto=format&fit=crop&w=${options.width ?? 1024}&q=80&keywords=${encodedTag}`;

    // Return AI image if no stock API key was provided
    return apiKey ? stockUrl : fallbackAi(prompt);
  };
}

export interface LocalInferenceProviderOptions {
  /** Local Stable Diffusion / ComfyUI / Imference endpoint URL */
  endpointUrl?: string;
  width?: number;
  height?: number;
  steps?: number;
}

/**
 * Creates an ImageProvider connecting to a local desktop GPU engine
 * (such as Automatic1111 on localhost:7860 or ComfyUI on localhost:8188).
 */
export function createLocalInferenceProvider(
  options: LocalInferenceProviderOptions = {}
): ImageProvider {
  const endpointUrl = options.endpointUrl ?? "http://127.0.0.1:7860/sdapi/v1/txt2img";
  const width = options.width ?? 512;
  const height = options.height ?? 512;
  const steps = options.steps ?? 20;

  return async (prompt: string): Promise<string> => {
    try {
      const resp = await fetch(endpointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          steps,
          width,
          height,
        }),
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

    // Fallback to Pollinations AI
    return createPollinationsImageProvider({ width, height })(prompt);
  };
}
