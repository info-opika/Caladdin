import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'tests/contracts/**/*.test.ts',
      'tests/jobs/**/*.test.ts',
      'tests/security/**/*.test.ts',
      'tests/unit/{adts,conversation-context,gcal-time,notifications,param-extract,parser,safety}.test.ts',
      'tests/unit/speech-input.test.ts',
      'tests/unit/voice-ui-stt.test.ts',
      'tests/integration/orchestrator.test.ts',
      'tests/system/ten-user-sim.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/tests/tests/**',
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
    },
  },
});
