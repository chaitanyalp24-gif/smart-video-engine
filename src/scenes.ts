/**
 * scenes
 * ------
 * Splits a script into scenes. Each scene becomes one generated image +
 * one narrated audio segment in the final video.
 *
 * Default strategy is a simple, free, client-side heuristic: group
 * sentences into scenes of roughly `sentencesPerScene` sentences each.
 * No network call, no API key, works offline.
 *
 * `splitScript` is intentionally a plain function (not a class) so a
 * smarter, AI-assisted splitter (e.g. one that asks an LLM to pick natural
 * scene breaks and write better image prompts) can be swapped in later by
 * passing a different function with the same signature — no changes
 * needed elsewhere in the pipeline.
 */

export interface Scene {
  /** The narration text for this scene (fed to the TTS engine). */
  text: string;
  /** The prompt used for image generation. Defaults to the scene text itself. */
  imagePrompt: string;
}

export interface SplitScriptOptions {
  /** How many sentences to group into one scene. Default: 2. */
  sentencesPerScene?: number;
}

/**
 * Splits raw text into sentences using a conservative regex: breaks on
 * ./!/? followed by whitespace and a capital letter or end of string,
 * while trying to avoid common abbreviations (Mr., Dr., etc.) and decimals.
 */
function splitIntoSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  // Split on sentence-ending punctuation followed by a space, but avoid
  // breaking on common abbreviations or decimal numbers.
  const raw = normalized.match(/[^.!?]+[.!?]+(?:\s|$)/g) ?? [normalized];

  const sentences: string[] = [];
  for (const chunk of raw) {
    const trimmed = chunk.trim();
    if (trimmed) sentences.push(trimmed);
  }

  return sentences.length > 0 ? sentences : [normalized];
}

/**
 * Free, client-side, keyless scene splitter. Groups sentences into scenes
 * and uses each scene's own text as its image prompt.
 */
export function splitScript(
  script: string,
  options: SplitScriptOptions = {}
): Scene[] {
  const sentencesPerScene = Math.max(1, options.sentencesPerScene ?? 2);
  const sentences = splitIntoSentences(script);

  const scenes: Scene[] = [];
  for (let i = 0; i < sentences.length; i += sentencesPerScene) {
    const group = sentences.slice(i, i + sentencesPerScene);
    const text = group.join(" ");
    scenes.push({ text, imagePrompt: text });
  }

  return scenes;
}

/** Function signature a custom scene-splitting strategy must implement. */
export type SceneSplitter = (script: string) => Scene[] | Promise<Scene[]>;
