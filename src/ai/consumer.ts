// Queues Consumer：执行 AI 绘制任务（单次 / 多步链式）
import { getBoard, addElement } from '../services/store';
import { generateElements } from './llm';
import { broadcast } from '../routes/board';
import type { AiJob, BoardElement } from '../types';
import type { Env } from '../env';

// 多步任务：每步生成一小批元素并广播
export async function runAiJob(env: Env, job: AiJob): Promise<void> {
  const board = await getBoard(env, job.boardId);
  if (!board) return;

  const stepHint = job.mode === 'multi'
    ? `这是第 ${job.stepIndex + 1}/${job.totalSteps} 步。基于当前画布，本次只画出这一步需要的少量元素（1-2个）。`
    : '一次性画出指令描述的全部内容（可多个元素）。';

  const partials = await generateElements(env, job.instruction, { width: board.meta.width, height: board.meta.height, elements: board.elements }, stepHint);
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
