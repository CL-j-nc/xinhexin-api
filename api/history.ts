import type { KVNamespace } from '@cloudflare/workers-types';

// 定义 Cloudflare Pages 函数的环境变量，包含 KV 命名空间
interface Env {
    // 您需要在 Cloudflare 仪表盘中将一个 KV 命名空间绑定到此变量
    // 例如，变量名为 JH_PCIC_KV
    JH_PCIC_KV: KVNamespace;
}

// 定义存储在 KV 中的键名
const HISTORY_KEY = "HISTORY_LOG";

/**
 * GET /api/history?action=get - 获取所有历史记录
 * POST /api/history?action=set - 保存所有历史记录
 */
export const onRequest = async ({ request, env }: { request: Request; env: Env }) => {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    try {
        // 处理获取请求
        if (request.method === 'GET' && action === 'get') {
            const historyJson = await env.JH_PCIC_KV.get(HISTORY_KEY);
            const history = historyJson ? JSON.parse(historyJson) : [];
            return new Response(JSON.stringify(history), {
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // 处理保存请求
        if (request.method === 'POST' && action === 'set') {
            const historyData = await request.text();
            JSON.parse(historyData); // 校验 JSON 格式
            await env.JH_PCIC_KV.put(HISTORY_KEY, historyData);
            return new Response(JSON.stringify({ success: true }), {
                headers: { 'Content-Type': 'application/json' },
            });
        }

        return new Response('无效的请求', { status: 400 });
    } catch (error) {
        console.error('KV 操作失败:', error);
        return new Response('服务器内部错误', { status: 500 });
    }
};
