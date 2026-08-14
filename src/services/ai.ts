// AI 用例层：执行 AI 绘制任务（单次）+ Queues 消费入口
// 读画板与写元素都走 BoardHub DO，配置走 Ocean
import { getState, addElement, broadcast, getAiEpoch, clearBoard } from '../realtime/board-client';
import { generateTurtleElements } from '../infrastructure/ai/client';
import { requireConfig } from './config';
import type { AiJob, BoardElement } from '../domain/types';

export async function runAiJob(env: Env, job: AiJob): Promise<void> {
  const board = await getState(env, job.boardId);
  if (!board) return;

  // 代次校验：任务入队后若队列被终止，则当前代次增大，旧任务不再执行
  const currentEpoch = await getAiEpoch(env, job.boardId);
  if (job.epoch < currentEpoch) {
    await broadcast(env, job.boardId, 'ai-log', {
      instruction: job.instruction,
      message: '⏹ 任务已被终止，跳过执行',
      success: true,
      cancelled: true,
    });
    return;
  }

  const stepHint = '参考 existing，用 <script> 包裹一条 turtle 脚本，画出指令要求的全部内容。';

  try {
    // LLM 必需配置，未配置即报错（无兜底）
    const [apiKey, baseUrl, model] = await Promise.all([
      requireConfig(env, 'openai_api_key'),
      requireConfig(env, 'openai_base_url'),
      requireConfig(env, 'openai_model'),
    ]);

    const { elements: partials, cleared } = await generateTurtleElements(
      { apiKey, baseUrl, model },
      {
        instruction: job.instruction,
        width: board.meta.width,
        height: board.meta.height,
        elements: board.elements,
        stepHint,
      },
      {
        temperature: job.temperature,
        maxTokens: job.maxTokens,
        thinking: job.thinking,
      },
    );

    const logMsg = `指令: "${job.instruction}" → 生成了 ${partials.length} 个元素`;

    // 广播 AI 日志（成功）
    await broadcast(env, job.boardId, 'ai-log', {
      instruction: job.instruction,
      elementCount: partials.length,
      message: logMsg,
      success: true,
    });

    // 脚本含 clear 指令：先清空画布已有内容再落新元素
    if (cleared) {
      await broadcast(env, job.boardId, 'ai-log', {
        instruction: job.instruction,
        message: '📋 脚本含 clear 指令，先清空画布',
        success: true,
      });
      // 通过 DO 的 clear 端点清空所有元素
      await clearBoard(env, job.boardId);
    }

    if (partials.length === 0) return;

    // 写入元素（DO 内部会广播 'add'）
    for (const p of partials) {
      await addElement(env, job.boardId, p as Omit<BoardElement, 'createdAt' | 'id'> & { id?: string });
    }
  } catch (e) {
    // 广播错误到前端日志以便查看
    const errMsg = String(e instanceof Error ? e.message : e);
    await broadcast(env, job.boardId, 'ai-log', {
      instruction: job.instruction,
      message: `❌ 失败: ${errMsg}`,
      success: false,
      error: errMsg,
    });
    // 重新抛出以便 queue 执行重试
    throw e;
  }
}

export async function queueConsumer(
  batch: MessageBatch<AiJob>,
  env: Env,
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      await runAiJob(env, msg.body);
    } catch (e) {
      console.error('AI job failed:', e instanceof Error ? e.message : e);
      // 失败/超时不再重试，直接消费丢弃（成功/失败均已广播 ai-log）
      msg.ack();
      continue;
    }
    msg.ack();
  }
}
