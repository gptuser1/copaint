// 鉴权中间件：验证所有 /api/* 请求的 Bearer token 或 ?token= 参数
// 令牌与绑定的 SECRET 比对；同时接受 HMAC 临时 token（cop_ 前缀，无存储验签+过期）
import type { Context, Next } from 'hono';
import { verifyTemporaryToken } from './token';

export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next): Promise<Response | void> {
  const auth = c.req.header('Authorization');
  let token = '';
  if (auth && auth.startsWith('Bearer ')) {
    token = auth.slice(7).trim();
  } else {
    token = c.req.query('token')?.trim() || '';
  }
  if (!token) {
    return c.json({ error: '缺少鉴权信息，格式: Bearer <token> 或 ?token=<token>' }, 401 as any);
  }
  const expected = await c.env.SECRET.get();
  // 原有字符串比较，或临时 token（验签 + 过期校验）
  const ok = token === expected || (await verifyTemporaryToken(token, expected));
  if (!ok) {
    return c.json({ error: '令牌无效' }, 401 as any);
  }
  await next();
}