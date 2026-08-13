// AI 用例层：执行 AI 绘制任务（单次 / 多步链式）+ Queues 消费入口
import { getBoard, addElement } from '../infrastructure/db/board-repo';
import { generateElements } from '../infrastructure/ai/client';
import { requireConfig } from './config';
import { broadcast } from '../realtime/broadcaster';
import type { AiJob, BoardElement } from '../domain/types';

// 多步任务：每步生成一小批元素并广播
export async function runAiJob(env: Env, job: AiJob): Promise<void> {
  const board = await getBoard(env, job.boardId);
  if (!board) return;

  const stepHint = job.mode === 'multi'
    ? `这是第 ${job.stepIndex + 1}/${job.totalSteps} 步。基于当前画布，本次只画出这一步需要的少量元素（1-2个）。`
    : '一次性画出指令描述的全部内容（可多个元素）。';

  // LLM 必需配置，未配置即报错（无兜底）
  const [apiKey, baseUrl, model] = await Promise.all([
    requireConfig(env, 'openai_api_key'),
    requireConfig(env, 'openai_base_url'),
    requireConfig(env, 'openai_model'),
  ]);

  const partials = await generateElements(
    { apiKey, baseUrl, model },
    {
      instruction: job.instruction,
      width: board.meta.width,
      height: board.meta.height,
      elements: board.elements,
      stepHint,
    },
  );
  if (partials.length === 0) return;

  // 写入元素并逐个广播
  for (const p of partials) {
    const el = await addElement(env, job.boardId, p as Omit<BoardElement, 'createdAt' | 'id'> & { id?: string });
    await broadcast(env, job.boardId, 'add', el);
  }

  // 多步：若还有后续步，延迟重投递（delayMs 秒后）
  if (job.mode === 'multi' && job.stepIndex + 1 < job.totalSteps) {
    const next: AiJob = { ...job, stepIndex: job.stepIndex + 1 };
    await env.AI_QUEUE.send(next, { delaySeconds: Math.max(1, job.delayMs / 1000) });
  }
}

export async function queueConsumer(
  batch: MessageBatch<AiJob>,
  env: Env,
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      await runAiJob(env, msg.body);
      msg.ack();
    } catch (e) {
      console.error('AI job failed:', e instanceof Error ? e.message : e);
      msg.retry();
    }
  }
}
