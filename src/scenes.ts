/**
 * scenes & keyword extraction
 * ---------------------------
 * Splits a script into scenes, extracts visual keywords, and derives
 * enhanced image prompts for AI and stock footage providers.
 */

export interface Scene {
  /** The narration text for this scene (fed to the TTS engine). */
  text: string;
  /** The prompt used for image generation. */
  imagePrompt: string;
  /** Extracted key visual search terms (for stock media search). */
  keywords?: string[];
}

export interface SplitScriptOptions {
  /** How many sentences to group into one scene. Default: 2. */
  sentencesPerScene?: number;
  /** Visual style enhancement to append to prompts (e.g. "cinematic", "anime", "lofi"). */
  style?: "cinematic" | "photorealistic" | "anime" | "cyberpunk" | "fantasy" | "none";
}

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

/**
 * Extracts salient search keywords from a sentence for stock photo/video retrieval.
 */
export function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  // Deduplicate and return top 5
  return Array.from(new Set(words)).slice(0, 5);
}

/**
 * Derives an enhanced prompt by applying a style preset.
 */
export function deriveEnhancedPrompt(
  text: string,
  style: SplitScriptOptions["style"] = "cinematic"
): string {
  const styleModifiers: Record<string, string> = {
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

/**
 * Splits raw text into sentences across multiple languages (supporting ASCII ., !, ? and CJK/Devanagari 。 ।).
 */
function splitIntoSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const raw = normalized.match(/[^.!?\u3002\u0964]+[.!?\u3002\u0964]+(?:\s|$)/gu) ?? [normalized];
  const sentences: string[] = [];
  for (const chunk of raw) {
    const trimmed = chunk.trim();
    if (trimmed) sentences.push(trimmed);
  }

  return sentences.length > 0 ? sentences : [normalized];
}

/**
 * Client-side scene splitter with keyword extraction and visual styling.
 */
export function splitScript(
  script: string,
  options: SplitScriptOptions = {}
): Scene[] {
  const sentencesPerScene = Math.max(1, options.sentencesPerScene ?? 2);
  const style = options.style ?? "cinematic";
  const sentences = splitIntoSentences(script);

  const scenes: Scene[] = [];
  for (let i = 0; i < sentences.length; i += sentencesPerScene) {
    const group = sentences.slice(i, i + sentencesPerScene);
    const text = group.join(" ");
    const imagePrompt = deriveEnhancedPrompt(text, style);
    const keywords = extractKeywords(text);

    scenes.push({ text, imagePrompt, keywords });
  }

  return scenes;
}

export type SceneSplitter = (script: string) => Scene[] | Promise<Scene[]>;
