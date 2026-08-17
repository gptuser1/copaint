// AES-256-GCM 加解密，用于敏感配置存储。
// 主密钥(SECRET)是已随机的高熵 token，直接经 SHA-256 派生 AES 密钥，
// 无需 PBKDF2 慢 KDF（那是给低熵口令准备的，对高熵 token 是纯开销）。
const KEY_LENGTH = 256;
const IV_LENGTH = 12;

// 加密结果格式（v2：去掉 v1 的 salt，安全等级不变）
interface EncryptedPayload {
  encrypted: true;
  iv: string;   // base64
  data: string; // base64 密文 + auth tag
}

export function isEncrypted(value: any): boolean {
  return !!value && typeof value === 'object' && value.encrypted === true
    && typeof value.iv === 'string' && typeof value.data === 'string';
}

function bufToB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBuf(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// 由主 token 的 SHA-256 派生 AES-256 密钥（微秒级，替代 PBKDF2 100k 迭代）
async function deriveKey(password: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(password));
  return crypto.subtle.importKey(
    'raw',
    digest,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encrypt(password: string, plaintext: string): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password);
  const enc = new TextEncoder();
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext)
  );
  return {
    encrypted: true,
    iv: bufToB64(iv),
    data: bufToB64(cipherBuf),
  };
}

export async function decrypt(password: string, payload: EncryptedPayload): Promise<string> {
  const iv = b64ToBuf(payload.iv);
  const data = b64ToBuf(payload.data);
  const key = await deriveKey(password);
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );
  const dec = new TextDecoder();
  return dec.decode(plainBuf);
}
