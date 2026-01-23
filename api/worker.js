export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // ===== CORS 预检 =====
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: cors() });
        }

        // ===== 健康检查 =====
        if (url.pathname === '/status') {
            return json({ status: 'ok' });
        }

        // ===== 提交投保 / 生成保单 =====
        if (url.pathname === '/api/policies' && request.method === 'POST') {
            try {
                const policy = await request.json();

                // === 极简必要校验（防空壳）===
                if (!policy.policyHolder || !policy.vehicle || !policy.coverages) {
                    return json({ error: 'missing_core_fields' }, 400);
                }

                const policyNo = generatePolicyNo();
                const now = new Date().toISOString();

                const record = {
                    policyNo,
                    createdAt: now,
                    status: 'SUBMITTED', // 已提交，可直接制单
                    data: policy,
                };

                // === 持久化（KV）===
                await env.POLICY_KV.put(
                    `policy:${policyNo}`,
                    JSON.stringify(record),
                    { expirationTtl: 60 * 60 * 24 * 365 } // 1 年
                );

                return json({
                    success: true,
                    policyNo,
                    createdAt: now,
                });
            } catch (e) {
                return json({ error: 'invalid_json' }, 400);
            }
        }

        // ===== 查询保单（制单 / 打印用）=====
        if (url.pathname === '/api/policies/get' && request.method === 'GET') {
            const policyNo = url.searchParams.get('policyNo');
            if (!policyNo) {
                return json({ error: 'policyNo_required' }, 400);
            }

            const raw = await env.POLICY_KV.get(`policy:${policyNo}`);
            if (!raw) {
                return json({ error: 'policy_not_found' }, 404);
            }

            return json(JSON.parse(raw));
        }

        // ===== 未命中 =====
        return json({ error: 'not_found' }, 404);
    },
};

// ================= 工具函数 =================

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            ...cors(),
        },
    });
}

function cors() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
}

function generatePolicyNo() {
    const d = new Date();
    const ymd =
        d.getFullYear().toString() +
        String(d.getMonth() + 1).padStart(2, '0') +
        String(d.getDate()).padStart(2, '0');

    return `CLPC-${ymd}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}