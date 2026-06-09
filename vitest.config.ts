import { defineConfig } from 'vitest/config';



/** Active CI suite: core + MVP features + CEO handoff coverage expansion. */

export default defineConfig({

  test: {

    globals: true,

    environment: 'node',

    include: [

      'tests/contracts/**/*.test.ts',

      'tests/jobs/{improvement-loop,reminders,session-expiry,compensation-worker}.test.ts',

      'tests/security/**/*.test.ts',

      'tests/unit/{adts,conversation-context,email-confirmation,email-confirmation-gate,gcal-time,notifications,notifications-service,param-extract,parser,parser-llm,recurring-scheduling-user-scenarios,safety,safety-mutations,pilot-controls,pilot-controls-capacity,confirmation-actions,voice-route-errors,voice-route,waitlist-db,slot-scoring-protected-blocks,freebusy-cache,platform-invites-db,invite-platform-handler,fax-effect,fax-effect-messages,session-store,distributed-rate-limiter,guest-action-token,booking-responses,calendar-api,calendar-service,email-service,auth-service,gcal-service,graceful-failure,availability-engine,webhooks-ics,redis}.test.ts',

      'tests/unit/handlers/**/*.test.ts',

      'tests/unit/db/**/*.test.ts',

      'tests/unit/intents/offer-specific.test.ts',

      'tests/unit/speech-input.test.ts',

      'tests/unit/voice-ui-stt.test.ts',

      'tests/integration/{orchestrator,orchestrator-handlers,scheduling-public-routes,waitlist-routes,auth-oauth-mvp,invite-routes,event-types-routes,profile-api,user-data-api,guest-lifecycle,jobs-routes,book-public-routes,book-slots-routes,booking-flow-smoke,ceo-handoff-smoke,health,availability-engine,webhooks-dispatch,webhooks-routes,calendar-ics,team-booking}.test.ts',

      'tests/integration/db/rls.integration.test.ts',

      'tests/system/ten-user-sim.test.ts',

      'tests/perf/**/*.perf.test.ts',

    ],

    exclude: [

      '**/node_modules/**',

      '**/dist/**',

    ],

    coverage: {

      provider: 'v8',

      include: ['src/**/*.ts'],

      exclude: ['src/index.ts'],

      reporter: ['text', 'json-summary', 'html'],

      reportsDirectory: './coverage',

      thresholds: {

        statements: 80,

        lines: 80,

        functions: 55,

        branches: 65,

      },

    },

  },

});


