import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  target: "es2020",
  // kokoro-js and @ffmpeg/* are large, browser/WebGPU-WASM-oriented packages.
  // Consumers install them themselves; we only dynamic-import them at the
  // point they're actually needed, so a consumer who never calls generate()
  // never pays for them.
  external: ["kokoro-js", "@ffmpeg/ffmpeg", "@ffmpeg/util"],
});
