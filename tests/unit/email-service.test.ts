import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/config.js', () => ({
  config: {},
}));

import {
  sendEmail,
  platformInviteEmailHtml,
  schedulingLinkEmailHtml,
} from '../../src/services/email.js';

describe('email service', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    delete process.env.RESEND_API_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips send when RESEND_API_KEY missing', async () => {
    const result = await sendEmail({ to: 'a@b.com', subject: 'Hi', html: '<p>Hi</p>' });
    expect(result).toEqual({ ok: true, skipped: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('posts to Resend when API key configured', async () => {
    process.env.RESEND_API_KEY = 're_test';
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
    const result = await sendEmail({ to: 'a@b.com', subject: 'Hi', html: '<p>Hi</p>' });
    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('returns ok false on Resend error', async () => {
    process.env.RESEND_API_KEY = 're_test';
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'fail',
    } as Response);
    const result = await sendEmail({ to: 'a@b.com', subject: 'Hi', html: '<p>Hi</p>' });
    expect(result.ok).toBe(false);
  });

  it('builds HTML templates', () => {
    expect(platformInviteEmailHtml('Alex', 'https://x.test/i')).toMatch(/Alex invited you/i);
    expect(schedulingLinkEmailHtml('Host', 'https://x.test/s')).toMatch(/Pick a time/i);
  });
});
