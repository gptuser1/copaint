// Worker 入口：装配 Hono app、挂载路由、导出 fetch / queue / DO 类
import { Hono } from 'hono';
import { boardsApp } from './routes/boards';
import { aiApp } from './routes/ai';
import { configApp } from './routes/config';
import { mountWs } from './routes/ws';
import { BoardHub } from './realtime/board-hub';
import { queueConsumer } from './services/ai';
import { authMiddleware } from './services/auth';
import { AppError } from './domain/errors';

const app = new Hono<{ Bindings: Env }>();

// 统一错误映射（AppError → HTTP 响应）
app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json({ error: err.message, code: err.code }, err.status as any);
  }
  console.error('unhandled error:', err);
  return c.json({ error: 'internal error' }, 500);
});

// 全局鉴权：所有 /api/* 需携带令牌（与绑定的 SECRET 比对）
app.use('/api/*', authMiddleware);

// 鉴权验证
app.get('/api/verify', (c) => c.json({ ok: true, message: '令牌有效' }));

// 业务路由
app.route('/api/boards', boardsApp);
app.route('/api/boards', aiApp);
app.route('/api/config', configApp);
mountWs(app);

// 画布 API 参考：只讲怎么画
app.get('/api', (c) => {
  const doc = `CoPaint 画布 API
=================
所有接口：Authorization: Bearer $TOKEN
画板固定 400×300。

元素字段
  type: pen|eraser|rect|ellipse|line
  pen/eraser 用 points（成对坐标扁平数组）
  rect/ellipse 用 x,y,width,height
  line 用 x,y,x2,y2
  通用: color, strokeWidth, by(user|ai|api)

看画布现状
  GET /api/boards/{id}
    返回 {meta:{width,height,...}, elements:[...], version}
    不存在则自动创建(400×300)。

落笔（加元素）
  POST /api/boards/{id}/elements
    body: {"type":"rect","x":100,"y":80,"width":200,"height":120,
           "color":"#3498db","strokeWidth":3,"by":"api"}
    返回完整元素(201)。

改元素
  PATCH /api/boards/{id}/elements/{eid}
    body: {"color":"#ff0000"}  只改给出的字段

删元素
  DELETE /api/boards/{id}/elements/{eid}

清空画布
  POST /api/boards/{id}/clear

批量画
  POST /api/boards/{id}/ops
    body: {"ops":[
      {"action":"add","element":{...}},
      {"action":"update","eid":"...","patch":{...}},
      {"action":"delete","eid":"..."}]}
    返回 {ok:true, added:[...]}

导出
  GET /api/boards/{id}/png   返回 PNG 图片

错误: {"error":"...","code":"..."}   401未授权/404不存在/400参数错
`;
  return c.text(doc);
});

export default {
  fetch: app.fetch,
  queue: queueConsumer,
};

// Durable Object 类（wrangler.toml 已声明 BoardHub）
export { BoardHub };
