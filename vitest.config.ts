import { defineConfig } from 'vitest/config';

/** Active CI suite: core + MVP features only (excludes legacy tests for missing src modules). */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'tests/contracts/**/*.test.ts',
      'tests/jobs/**/*.test.ts',
      'tests/security/**/*.test.ts',
      'tests/unit/{adts,conversation-context,email-confirmation,email-confirmation-gate,gcal-time,notifications,param-extract,parser,safety,pilot-controls,pilot-controls-capacity,waitlist-db,slot-scoring-protected-blocks,platform-invites-db,invite-platform-handler,fax-effect,fax-effect-messages}.test.ts',
      'tests/unit/intents/offer-specific.test.ts',
      'tests/unit/speech-input.test.ts',
      'tests/unit/voice-ui-stt.test.ts',
      'tests/integration/{orchestrator,scheduling-public-routes,waitlist-routes,auth-oauth-mvp,invite-routes}.test.ts',
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
