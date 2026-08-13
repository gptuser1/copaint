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

app.get('/api', (c) => {
  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CoPaint API Reference</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 16px 24px; font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; max-width: 920px; margin-left: auto; margin-right: auto; }
    h1 { border-bottom: 1px solid #eee; padding-bottom: 8px; }
    h2 { margin-top: 2em; padding-top: 8px; border-top: 1px solid #eee; color: #2c3e50; }
    pre { background: #f6f8fa; padding: 12px 16px; border-radius: 6px; overflow-x: auto; }
    code { background: #f6f8fa; padding: 2px 5px; border-radius: 3px; }
    ul { margin: 8px 0; padding-left: 20px; }
    .error-codes { margin: 12px 0; }
    .error-codes > div { margin: 4px 0; }
  </style>
</head>
<body>
<h1>🖌️ CoPaint API Reference</h1>
<p>CoPaint 是一个在线协作画板，支持用户手绘 + AI 生成几何图形。所有 <code>/api/*</code> 接口都需要<strong>令牌鉴权</strong>：在 <code>Authorization</code> 请求头携带 <code>Bearer $TOKEN</code>。</p>

<h2>GET <code>/api/verify</code></h2>
<p>验证访问令牌是否有效。</p>

<p>成功响应（200 OK）：</p>
<pre>{
  "ok": true,
  "message": "令牌有效"
}
</pre>

<p>失败状态码：</p>
<div class="error-codes">
<div><code>401</code> Unauthorized — 令牌无效或缺失</div>
</div>

<p>Usage example:</p>
<pre>curl -H "Authorization: Bearer \$COP_TOKEN" "http://localhost:8787/api/verify"
</pre>

<h2>GET <code>/api/boards/{id}</code></h2>
<p>读取画板完整状态（元素 + 元信息）。若画板不存在，则自动创建（固定尺寸 400×300）。</p>

<p>成功响应（200 OK）：</p>
<pre>{
  "meta": {
    "id": "default",
    "width": 400,
    "height": 300,
    "createdAt": 1718000000000,
    "updatedAt": 1718000000000
  },
  "elements": [
    {
      "id": "abc123",
      "type": "rect",
      "x": 100,
      "y": 80,
      "width": 200,
      "height": 120,
      "x2": null,
      "y2": null,
      "color": "#3498db",
      "strokeWidth": 3,
      "by": "ai",
      "createdAt": 1718000000000
    }
  ],
  "version": 1
}
</pre>

<p>Usage example:</p>
<pre>curl -H "Authorization: Bearer \$COP_TOKEN" "http://localhost:8787/api/boards/default"
</pre>

<h2>GET <code>/api/boards/{id}/png</code></h2>
<p>导出画板为 PNG 图片。</p>

<p>成功响应（200 OK）：<code>Content-Type: image/png</code>，直接保存即可。</p>

<p>失败状态码：</p>
<div class="error-codes">
<div><code>404</code> — 画板不存在</div>
</div>

<p>Usage example:</p>
<pre>curl -H "Authorization: Bearer \$COP_TOKEN" -o board.png \\
  "http://localhost:8787/api/boards/default/png"
</pre>

<h2>POST <code>/api/boards/{id}/elements</code></h2>
<p>新增一个元素到画板。</p>

<p>请求 JSON body：</p>
<pre>{
  "type": "rect",
  "x": 100,
  "y": 80,
  "width": 200,
  "height": 120,
  "color": "#3498db",
  "strokeWidth": 3,
  "by": "api"
}
</pre>

<p>元素类型 <code>type</code>：</p>
<ul>
  <li><code>pen</code> / <code>eraser</code> — 自由曲线，需要 <code>points</code> 数组：<code>[x0, y0, x1, y1, ...]</code></li>
  <li><code>rect</code> — 矩形，需要 <code>x, y, width, height</code></li>
  <li><code>ellipse</code> — 椭圆，需要 <code>x, y, width, height</code></li>
  <li><code>line</code> — 直线，需要 <code>x, y, x2, y2</code></li>
</ul>

<p>成功响应（201 Created）返回完整元素（含生成的 id）。</p>

<p>失败状态码：</p>
<div class="error-codes">
<div><code>400</code> Bad Request — <code>type</code> 必填</div>
<div><code>404</code> — 画板不存在</div>
</div>

<p>Usage example:</p>
<pre>curl -X POST -H "Authorization: Bearer \$COP_TOKEN" -H "Content-Type: application/json" \\
  -d '{"type":"rect","x":100,"y":80,"width":200,"height":120,"color":"#3498db","strokeWidth":3,"by":"api"}' \\
  "http://localhost:8787/api/boards/default/elements"
</pre>

<h2>PATCH <code>/api/boards/{id}/elements/{eid}</code></h2>
<p>修改指定元素的部分属性（仅修改你给出的字段）。</p>

<p>请求 JSON body：需要修改的字段键值对。</p>

<p>成功响应返回修改后的完整元素。</p>

<p>失败状态码：</p>
<div class="error-codes">
<div><code>404</code> — 画板或元素不存在</div>
</div>

<h2>DELETE <code>/api/boards/{id}/elements/{eid}</code></h2>
<p>从画板删除指定元素。</p>

<p>成功响应：</p>
<pre>{
  "ok": true
}
</pre>

<p>失败状态码：</p>
<div class="error-codes">
<div><code>404</code> — 画板或元素不存在</div>
</div>

<h2>POST <code>/api/boards/{id}/clear</code></h2>
<p>清空画板上所有元素，保留画板尺寸。</p>

<p>成功响应：</p>
<pre>{
  "ok": true
}
</pre>

<h2>POST <code>/api/boards/{id}/ops</code></h2>
<p>批量执行多个操作（原子提交，适合外部 API 批量导入）。</p>

<p>请求 JSON body：</p>
<pre>{
  "ops": [
    {"action": "add", "element": { ... }},
    {"action": "update", "eid": "abc123", "patch": { "color": "#ff0000" }},
    {"action": "delete", "eid": "abc123"}
  ]
}
</pre>

<p>支持的操作：<code>add</code> / <code>update</code> / <code>delete</code>，含义同上述单个接口。</p>

<p>成功响应：</p>
<pre>{
  "ok": true,
  "added": [ ... array of added full elements ... ]
}
</pre>

<h2>POST <code>/api/boards/{id}/ai</code></h2>
<p>提交 AI 绘制任务到后台队列，异步执行，结果通过 WebSocket 实时广播到所有连接。</p>

<p>请求 JSON body：</p>
<pre>{
  "instruction": "画一个红色的太阳在左上角",
  "mode": "once",
  "steps": 5,
  "delayMs": 2000
}
</pre>

<p>参数说明：</p>
<ul>
  <li><code>instruction</code>: string — 必填，自然语言绘制指令</li>
  <li><code>mode</code>: <code>"once"</code> | <code>"multi"</code> — 单次绘制/分步绘制，默认 <code>once</code></li>
  <li><code>steps</code>: number — 分步模式下总步数（1~10），默认 5</li>
  <li><code>delayMs</code>: number — 分步模式下步间延迟（毫秒），默认 2000</li>
</ul>

<p>成功响应：</p>
<pre>{
  "ok": true,
  "mode": "multi",
  "totalSteps": 5
}
</pre>

<p>执行过程中 AI 会通过 WebSocket 广播 <code>"ai-log"</code> 事件，前端可实时显示执行日志。</p>

<p>Usage example:</p>
<pre>curl -X POST -H "Authorization: Bearer \$COP_TOKEN" -H "Content-Type: application/json" \\
  -d '{"instruction":"画一个红色太阳","mode":"multi","steps":3}' \\
  "http://localhost:8787/api/boards/default/ai"
</pre>

<h2>GET <code>/api/config</code></h2>
<p>读取配置 schema 和当前配置状态（敏感配置只返回"已配置/未配置"，不返回值）。</p>

<p>成功响应：</p>
<pre>{
  "items": [
    {
      "key": "openai_api_key",
      "desc": "OpenAI API Key",
      "sensitive": true,
      "placeholder": "sk-...",
      "set": true
    }
  ]
}
</pre>

<h2>PUT <code>/api/config/{key}</code></h2>
<p>写入配置项（用于前端 UI 保存 LLM 配置）。</p>

<p>请求 JSON body：</p>
<pre>{
  "value": "..."
}
</pre>

<p>成功响应：<code>{ "ok": true }</code></p>

<h2>DELETE <code>/api/config/{key}</code></h2>
<p>删除指定配置项。</p>

<p>成功响应：<code>{ "ok": true }</code></p>

<h2>WebSocket <code>/{boards}/{id}/ws</code></h2>
<p>实时同步：所有连接到该画板的客户端会收到画板变更广播（添加/修改/删除/清空/AI 日志）。</p>

<p>认证：令牌通过查询参数传递：</p>
<pre>ws://localhost:8787/boards/default/ws?token=\$TOKEN
</pre>

<p>消息格式（服务器 → 客户端）：</p>
<pre>{
  "event": "add",
  "payload": { element object }
}
</pre>

<p>事件类型：</p>
<ul>
  <li><code>"add"</code> — 新增元素</li>
  <li><code>"update"</code> — 修改元素</li>
  <li><code>"delete"</code> — 删除元素</li>
  <li><code>"clear"</code> — 清空画板</li>
  <li><code>"ai-log"</code> — AI 执行日志，payload 包含 <code>step</code>, <code>totalSteps</code>, <code>message</code> 等</li>
</ul>

<p>客户端 → 服务器不需要发消息，所有变更走 HTTP API。</p>

<p>If error occurs, the server closes the connection with 1008 policy violation if token is invalid.</p>

</body>
</html>
  `;
  return c.html(html);
});

export default {
  fetch: app.fetch,
  queue: queueConsumer,
};

// Durable Object 类（wrangler.toml 已声明 BoardHub）
export { BoardHub };
