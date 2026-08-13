// HMAC 临时 token：格式 cop_<exp>.<sig>，无存储、不含真实 token、exp 驱动失效。
// 生成：owner 用 API 换取（POST /api/token）；
// 校验：后端验签（恒定时间比较）+ 过期判断，密钥复用现有 SECRET。

export const TEMP_TOKEN_PREFIX = 'cop_';

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 生成临时 token：exp = now + ttl（秒）。TTL 上下限由调用方保证。
export async function createTemporaryToken(
  secret: string,
  ttlSeconds: number,
): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = await hmacHex(secret, String(expiresAt));
  return { token: `${TEMP_TOKEN_PREFIX}${expiresAt}.${sig}`, expiresAt };
}

// 校验：格式 → 未过期 → 签名恒定时间比较
export async function verifyTemporaryToken(token: string, secret: string): Promise<boolean> {
  if (!token.startsWith(TEMP_TOKEN_PREFIX)) return false;
  const rest = token.slice(TEMP_TOKEN_PREFIX.length);
  const dot = rest.indexOf('.');
  if (dot <= 0) return false;
  const expStr = rest.slice(0, dot);
  const sig = rest.slice(dot + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= 0) return false;
  if (Date.now() / 1000 >= exp) return false; // 已过期
  const expected = await hmacHex(secret, expStr);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}