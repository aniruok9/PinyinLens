import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    // Integration tests load ONNX models and run real inference.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
