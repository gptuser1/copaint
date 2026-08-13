// 鉴权中间件：验证所有 /api/* 请求的 Bearer token 或 ?token= 参数
// 令牌与绑定的 SECRET 比对，未带或无效一律 401
import type { Context, Next } from 'hono';

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
  if (token !== expected) {
    return c.json({ error: '令牌无效' }, 401 as any);
  }
  await next();
}