// 配置管理路由：供前端界面读写 LLM 等配置
import { Hono } from 'hono';
import { getConfig, setConfig, deleteConfig, getConfigSchema } from '../services/config';
import { ValidationError } from '../domain/errors';

export const configApp = new Hono<{ Bindings: Env }>();

// 读取配置 schema + 当前值（敏感项只返回是否已配置）
configApp.get('/', async (c) => {
  const schema = getConfigSchema();
  const items = [];
  for (const f of schema) {
    const value = await getConfig(c.env, f.key);
    items.push({
      key: f.key,
      desc: f.desc,
      sensitive: f.sensitive,
      placeholder: f.placeholder,
      set: value !== null,
      value: f.sensitive ? undefined : value,
    });
  }
  return c.json({ items });
});

// 写入配置
configApp.put('/:key', async (c) => {
  const key = c.req.param('key');
  const body = await c.req.json().catch(() => ({}));
  const value = (body.value || '').trim();
  if (!value) throw new ValidationError('value required');
  await setConfig(c.env, key, value);
  return c.json({ ok: true });
});

// 删除配置
configApp.delete('/:key', async (c) => {
  const key = c.req.param('key');
  await deleteConfig(c.env, key);
  return c.json({ ok: true });
});