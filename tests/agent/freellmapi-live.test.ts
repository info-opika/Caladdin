import { describe, it } from 'vitest';

const live = process.env.FREELLMAPI_LIVE === '1';

describe.skipIf(!live)('freellmapi live open routing', () => {
  it('placeholder — run agent harness against Railway when FREELLMAPI_LIVE=1', () => {
    // Intentionally skipped unless FREELLMAPI_LIVE=1 and credentials are set.
  });
});
