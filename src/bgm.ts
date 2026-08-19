/**
 * Background Music (BGM) Generator & Audio Mixer
 * ==============================================
 * Generates ambient background music tracks programmatically and mixes
 * voiceover narration with BGM using automatic volume ducking.
 */

export interface BgmTrackOptions {
  /** Style of background music. Default: "ambient" */
  style?: "ambient" | "lofi" | "cinematic" | "none";
  /** Base volume of BGM relative to voiceover (0.0 to 1.0). Default: 0.22 */
  volume?: number;
  /** Ducking level when narration is speaking (0.0 to 1.0). Default: 0.12 */
  duckedVolume?: number;
  /** Sample rate in Hz. Default: 24000 */
  sampleRate?: number;
}

/**
 * Procedurally generates an ambient background music WAV buffer of the specified duration.
 */
export function generateBgmAudio(
  durationSeconds: number,
  options: BgmTrackOptions = {}
): Float32Array {
  const sampleRate = options.sampleRate ?? 24000;
  const style = options.style ?? "ambient";
  const numSamples = Math.max(1, Math.round(durationSeconds * sampleRate));
  const samples = new Float32Array(numSamples);

  if (style === "none" || durationSeconds <= 0) {
    return samples;
  }

  // Chord progressions in frequencies (Hz)
  // Ambient: Cmaj9 -> Am9 -> Fmaj7 -> Gsus4
  const ambientChords = [
    [130.81, 196.00, 246.94, 293.66, 329.63], // C, G, B, D, E (Cmaj9)
    [110.00, 164.81, 220.00, 261.63, 329.63], // A, E, A, C, E (Am9)
    [87.31, 130.81, 174.61, 220.00, 261.63],  // F, C, F, A, C (Fmaj7)
    [98.00, 146.83, 196.00, 261.63, 293.66],  // G, D, G, C, D (Gsus4)
  ];

  // Lo-Fi: Dm9 -> G13 -> Cmaj9 -> A7b9
  const lofiChords = [
    [146.83, 220.00, 261.63, 329.63, 349.23], // Dm9
    [98.00, 196.00, 246.94, 329.63, 392.00],  // G13
    [130.81, 196.00, 246.94, 293.66, 329.63], // Cmaj9
    [110.00, 174.61, 220.00, 261.63, 311.13], // A7b9
  ];

  // Cinematic: Em -> C -> G -> D
  const cinematicChords = [
    [82.41, 123.47, 164.81, 196.00, 246.94],  // Em
    [65.41, 130.81, 196.00, 261.63, 329.63],  // C
    [98.00, 146.83, 196.00, 246.94, 293.66],  // G
    [73.42, 146.83, 220.00, 293.66, 369.99],  // D
  ];

  const chordProgression =
    style === "lofi"
      ? lofiChords
      : style === "cinematic"
      ? cinematicChords
      : ambientChords;

  const chordDuration = 4.0; // 4 seconds per chord

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const chordIndex = Math.floor(t / chordDuration) % chordProgression.length;
    const chordTime = (t % chordDuration) / chordDuration; // 0 to 1 inside current chord
    const freqs = chordProgression[chordIndex];

    // Smooth chord crossfade envelope
    const chordFade = Math.sin(Math.PI * chordTime);

    let sample = 0;
    for (let f = 0; f < freqs.length; f++) {
      const freq = freqs[f];
      // Warm layered sine + soft triangle harmonics
      const osc1 = Math.sin(2 * Math.PI * freq * t);
      const osc2 = Math.sin(2 * Math.PI * (freq * 1.002) * t + 0.5) * 0.5;
      const osc3 = Math.sin(2 * Math.PI * (freq * 0.5) * t) * 0.35; // Sub bass
      sample += (osc1 + osc2 + osc3) / freqs.length;
    }

    // Overall track fade in (first 1.5s) and fade out (last 2s)
    const fadeIn = Math.min(1.0, t / 1.5);
    const fadeOut = Math.min(1.0, (durationSeconds - t) / 2.0);
    const masterEnvelope = fadeIn * fadeOut * chordFade;

    samples[i] = sample * masterEnvelope * 0.25;
  }

  return samples;
}

/**
 * Mixes voiceover Float32 audio with background music Float32 audio.
 * Applies volume ducking so narration is always crisp and audible.
 */
export function mixVoiceWithBgm(
  voiceSamples: Float32Array,
  bgmSamples: Float32Array,
  options: BgmTrackOptions = {}
): Float32Array {
  const length = Math.max(voiceSamples.length, bgmSamples.length);
  const mixed = new Float32Array(length);
  const baseVolume = options.volume ?? 0.22;
  const duckedVolume = options.duckedVolume ?? 0.12;

  for (let i = 0; i < length; i++) {
    const voice = i < voiceSamples.length ? voiceSamples[i] : 0;
    const bgm = i < bgmSamples.length ? bgmSamples[i] : 0;

    // Detect voice presence for dynamic ducking
    const voiceActive = Math.abs(voice) > 0.02;
    const bgmVol = voiceActive ? duckedVolume : baseVolume;

    // Sum and soft-limit to prevent clipping
    const raw = voice + bgm * bgmVol;
    mixed[i] = Math.max(-1.0, Math.min(1.0, raw));
  }

  return mixed;
}
