/**
 * imageProvider
 * -------------
 * Default image generation backend: free, keyless, cloud-based via
 * Pollinations. Uses the same endpoint verified to work without an API key
 * in smart-image-engine (image.pollinations.ai/prompt/ — note this is
 * distinct from gen.pollinations.ai, which now requires a key).
 *
 * ImageProvider is a plain function type so consumers can swap in
 * smart-image-engine's SmartImageEngine.generate(), a stock-photo API, or
 * anything else with the same shape — no changes needed elsewhere in the
 * pipeline.
 */

/** Function signature any image provider must implement. */
export type ImageProvider = (prompt: string) => Promise<string>;

export interface PollinationsImageProviderOptions {
  baseUrl?: string;
  width?: number;
  height?: number;
}

/**
 * Creates an ImageProvider backed by Pollinations' free, keyless image
 * endpoint. Returns a plain https:// URL per call (not a data: URL) — the
 * compositor fetches and decodes it into a canvas frame.
 */
export function createPollinationsImageProvider(
  options: PollinationsImageProviderOptions = {}
): ImageProvider {
  const baseUrl = options.baseUrl ?? "https://image.pollinations.ai/prompt/";
  const width = options.width ?? 1024;
  const height = options.height ?? 1024;

  return async (prompt: string): Promise<string> => {
    const seed = Math.floor(Math.random() * 1_000_000_000);
    const encodedPrompt = encodeURIComponent(prompt);
    return `${baseUrl}${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&nologo=true`;
  };
}
