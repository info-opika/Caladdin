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

      'tests/unit/{adts,conversation-context,confirmation-copy,parsed-intent-validator-no-reask,email-confirmation,email-confirmation-gate,gcal-time,notifications,notifications-service,param-extract,parser,parser-llm,recurring-scheduling-user-scenarios,safety,safety-mutations,pilot-controls,pilot-controls-capacity,confirmation-actions,voice-route-errors,voice-route,waitlist-db,slot-scoring-protected-blocks,freebusy-cache,platform-invites-db,invite-platform-handler,fax-effect,fax-effect-messages,session-store,distributed-rate-limiter,guest-action-token,booking-responses,calendar-api,calendar-service,email-service,auth-service,google-token-exchange,google-https,gcal-service,graceful-failure,availability-engine,webhooks-ics,redis,lc10-wave1-v3-voice-pipeline,lc10-wave1-v2-voice-pipeline,lc10-wave1-v4-finish-wave1,lc10-wave1-v5-blocker-fix,lc10-wave1-haiku-form-filler,lc12-pending-scheduling-memory,destructive-prefilter,query-prefilter,scheduling-link-prefilter,voice-rate-limit-buckets,event-source,mutual-slot-engine,invitee-lookup,check-specific-slot,schedule-formatting,invitee-slot-conflicts}.test.ts',

      'tests/unit/handlers/**/*.test.ts',

      'tests/unit/db/**/*.test.ts',

      'tests/unit/intents/{offer-specific,protect-block}.test.ts',

      'tests/unit/speech-input.test.ts',

      'tests/unit/voice-ui-stt.test.ts',

      'tests/integration/{orchestrator,orchestrator-handlers,scheduling-public-routes,schedule-public-v3,schedule-public-conflicts,invite-grant,waitlist-routes,auth-oauth-mvp,invite-routes,event-types-routes,profile-api,user-data-api,guest-lifecycle,jobs-routes,book-public-routes,book-slots-routes,booking-flow-smoke,ceo-handoff-smoke,health,availability-engine,webhooks-dispatch,webhooks-routes,calendar-ics,calendar-week-api,check-slot-api,team-booking,contextual-setup,command-log,next-slots-mutual}.test.ts',

      'tests/integration/db/rls.integration.test.ts',

      'tests/system/ten-user-sim.test.ts',

      'tests/perf/**/*.perf.test.ts',

      'tests/agent/**/*.test.ts',

      'tests/e2e/v4-phase10-checklist.test.ts',

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


