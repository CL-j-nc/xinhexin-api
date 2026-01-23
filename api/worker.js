export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const { pathname } = url;

        const headers = {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        };

        if (request.method === "OPTIONS") {
            return new Response(null, { headers });
        }

        if (request.method === "POST" && pathname === "/status") {
            return new Response(JSON.stringify({ status: "ok" }), { headers });
        }

        // 核保通过：生成验证码
        if (request.method === "POST" && pathname === "/policy/approve") {
            const { policyId } = await request.json();
            if (!policyId) {
                return new Response(JSON.stringify({ error: "policyId required" }), {
                    status: 400,
                    headers,
                });
            }

            const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();

            await env.DB.prepare(
                `INSERT OR REPLACE INTO policies (policy_id, verify_code) VALUES (?, ?)`
            ).bind(policyId, verifyCode).run();

            return new Response(
                JSON.stringify({ ok: true, verifyCode }),
                { headers }
            );
        }

        // 客户校验验证码（一次性）
        if (request.method === "POST" && pathname === "/policy/verify-code") {
            const { policyId, code } = await request.json();

            const row = await env.DB.prepare(
                `SELECT verify_code FROM policies WHERE policy_id = ?`
            ).bind(policyId).first();

            if (!row || row.verify_code !== code) {
                return new Response(JSON.stringify({ pass: false }), { headers });
            }

            await env.DB.prepare(
                `UPDATE policies SET verify_code = NULL WHERE policy_id = ?`
            ).bind(policyId).run();

            return new Response(JSON.stringify({ pass: true }), { headers });
        }

        return new Response(JSON.stringify({ error: "not_found" }), {
            status: 404,
            headers,
        });
    },
};