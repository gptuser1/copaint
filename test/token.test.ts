import { describe, it, expect } from 'vitest';
import { createTemporaryToken, verifyTemporaryToken } from '../src/services/token';

describe('temporary token (HMAC, stateless)', () => {
  it('creates and verifies a valid token', async () => {
    const { token, expiresAt } = await createTemporaryToken('s3cret', 3600);
    expect(token.startsWith('cop_')).toBe(true);
    expect(expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(await verifyTemporaryToken(token, 's3cret')).toBe(true);
  });

  it('rejects wrong secret', async () => {
    const { token } = await createTemporaryToken('s3cret', 3600);
    expect(await verifyTemporaryToken(token, 'other')).toBe(false);
  });

  it('rejects tampered signature', async () => {
    const { token } = await createTemporaryToken('s3cret', 3600);
    const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
    expect(await verifyTemporaryToken(tampered, 's3cret')).toBe(false);
  });

  it('rejects expired token', async () => {
    const { token } = await createTemporaryToken('s3cret', -10); // exp 在过去
    expect(await verifyTemporaryToken(token, 's3cret')).toBe(false);
  });

  it('rejects malformed and non-temp tokens', async () => {
    expect(await verifyTemporaryToken('raw-token', 's3cret')).toBe(false);
    expect(await verifyTemporaryToken('cop_notoken', 's3cret')).toBe(false);
    expect(await verifyTemporaryToken('', 's3cret')).toBe(false);
  });
});
