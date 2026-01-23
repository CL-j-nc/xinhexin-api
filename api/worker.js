export default {
    async fetch(request, env) {
        try {
            const url = new URL(request.url);
            const { pathname } = url;

            const headers = {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
                "Content-Type": "application/json",
            };

            if (request.method === "OPTIONS") {
                return new Response(null, { headers });
            }

            if (request.method === "GET" && pathname === "/") {
                return new Response(
                    JSON.stringify({ status: "ok", service: "xinhexin-api" }),
                    { headers }
                );
            }

            if (request.method === "POST" && pathname === "/status") {
                return new Response(
                    JSON.stringify({ status: "ok" }),
                    { headers }
                );
            }

            // 核保通过：生成并返回验证码
            if (request.method === "POST" && pathname === "/policy/approve") {
                const body = await request.json();
                const { policyId } = body;

                if (!policyId) {
                    return new Response(JSON.stringify({ error: "policyId required" }), {
                        status: 400,
                        headers,
                    });
                }

                const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();

                await env.DB.prepare(
                    `UPDATE policies SET verify_code = ? WHERE policy_id = ?`
                ).bind(verifyCode, policyId).run();

                return new Response(
                    JSON.stringify({ ok: true, verifyCode }),
                    { headers }
                );
            }

            // Client 校验验证码（一次性）
            if (request.method === "POST" && pathname === "/policy/verify-code") {
                const body = await request.json();
                const { policyId, code } = body;

                if (!policyId || !code) {
                    return new Response(JSON.stringify({ pass: false }), {
                        status: 400,
                        headers,
                    });
                }

                const row = await env.DB.prepare(
                    `SELECT verify_code FROM policies WHERE policy_id = ?`
                ).bind(policyId).first();

                if (!row || row.verify_code !== code) {
                    return new Response(JSON.stringify({ pass: false }), {
                        status: 401,
                        headers,
                    });
                }

                // 一次性失效
                await env.DB.prepare(
                    `UPDATE policies SET verify_code = NULL WHERE policy_id = ?`
                ).bind(policyId).run();

                return new Response(
                    JSON.stringify({ pass: true }),
                    { headers }
                );
            }

            return new Response(
                JSON.stringify({ error: "Not Found" }),
                { status: 404, headers }
            );
        } catch (e) {
            return new Response(
                JSON.stringify({ error: "internal_error", message: String(e) }),
                { status: 500, headers: { "Content-Type": "application/json" } }
            );
        }
    },
};