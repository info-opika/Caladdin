#!/usr/bin/env node
/**
 * Generate random secrets for Render production env.
 * Usage: node scripts/generate-secrets.mjs
 */
import { randomBytes } from 'crypto';

function secret(bytes) {
  return randomBytes(bytes).toString('base64url');
}

console.log('Paste these into Render Dashboard (caladdin-core env group):\n');
console.log(`SESSION_SECRET=${secret(32)}`);
console.log(`OAUTH_STATE_SECRET=${secret(32)}`);
console.log(`CALADDIN_API_KEY=${secret(24)}`);
