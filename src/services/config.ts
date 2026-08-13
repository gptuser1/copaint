// 配置用例层：schema 定义 + 增删改查
// 配置只从数据源读取，未配置返回 null / 抛错，无兜底
import { createConfigRepo } from '../infrastructure/db/config-repo';
import { ConfigMissingError } from '../domain/errors';

export interface ConfigField {
  key: string;
  desc: string;
  sensitive: boolean;
  placeholder?: string;
}

// 独立配置命名空间
export const COP_NS = 'copaint';

const COP_CONFIG_SCHEMA: ConfigField[] = [
  { key: 'openai_api_key',  desc: 'OpenAI API Key',    sensitive: true,  placeholder: 'sk-...' },
  { key: 'openai_base_url', desc: 'LLM API 地址',      sensitive: false, placeholder: 'https://api.siliconflow.cn/v1' },
  { key: 'openai_model',    desc: 'LLM 模型名',        sensitive: false, placeholder: 'THUDM/GLM-4-9B-0414' },
];

// 读配置；未配置返回 null
export async function getConfig(env: Env, key: string): Promise<string | null> {
  return createConfigRepo(env).get(COP_NS, key);
}

// 读配置；未配置抛错（给 LLM 等必需配置使用）
export async function requireConfig(env: Env, key: string): Promise<string> {
  const value = await createConfigRepo(env).get(COP_NS, key);
  if (!value) throw new ConfigMissingError(key);
  return value;
}

export async function setConfig(env: Env, key: string, value: string): Promise<void> {
  const field = COP_CONFIG_SCHEMA.find(f => f.key === key);
  if (!field) throw new Error('未知配置项: ' + key);
  await createConfigRepo(env).set(COP_NS, key, value, field.sensitive);
}

export async function deleteConfig(env: Env, key: string): Promise<void> {
  await createConfigRepo(env).remove(COP_NS, key);
}

export function getConfigSchema(): ConfigField[] {
  return COP_CONFIG_SCHEMA;
}
