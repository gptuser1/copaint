// Cloudflare Worker 环境变量与绑定类型
import type { AiJob } from './types';

export interface Env {
  // Ocean (D1 REST) 访问凭据（wrangler secret / binding 注入）
  COP_OCEAN_TOKEN: string;
  COP_OCEAN_BASE?: string;

  // LLM 配置（env 兜底，主要存 Ocean copaint ns）
  COP_OPENAI_API_KEY?: string;
  COP_OPENAI_BASE_URL?: string;
  COP_OPENAI_MODEL?: string;

  // Queues 绑定
  AI_QUEUE: Queue<AiJob>;
  DLQ_PRODUCER: Queue<AiJob>;

  // Durable Object 绑定
  BOARD_HUB: DurableObjectNamespace;

  // DO 内通过 env 访问 Ocean（同一批凭据）
}
