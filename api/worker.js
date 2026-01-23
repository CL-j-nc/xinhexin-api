export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // health
        if (url.pathname === "/status" && request.method === "GET") {
            return new Response(JSON.stringify({ status: "ok" }), {
                headers: { "Content-Type": "application/json" },
            });
        }

        // ===============================
        // 1️⃣ 生成验证码（防刷 + D1 记录）
        // ===============================
        if (url.pathname === "/generate-code" && request.method === "POST") {
            const { mobile, policyId } = await request.json();

            if (!mobile) {
                return new Response(
                    JSON.stringify({ error: "mobile required" }),
                    { status: 400 }
                );
            }

            // 防刷：5 分钟 1 次
            const last = await env.SMS_KV.get(`LIMIT:${mobile}`);
            if (last) {
                return new Response(
                    JSON.stringify({ error: "too many requests" }),
                    { status: 429 }
                );
            }

            // 生成 6 位验证码
            const code = Math.floor(100000 + Math.random() * 900000).toString();

            // KV：验证码 5 分钟
            await env.SMS_KV.put(mobile, code, { expirationTtl: 300 });

            // KV：防刷标记
            await env.SMS_KV.put(`LIMIT:${mobile}`, "1", { expirationTtl: 300 });

            // D1 记录
            await env.DB.prepare(
                `INSERT INTO phone_verify_log (mobile, policy_id, verify_code)
           VALUES (?, ?, ?)`
            )
                .bind(mobile, policyId || null, code)
                .run();

            return new Response(
                JSON.stringify({
                    mobile,
                    verifyCode: code
                }),
                { headers: { "Content-Type": "application/json" } }
            );
        }

        // ===============================
        // 2️⃣ 校验验证码（更新 D1）
        // ===============================
        if (url.pathname === "/verify-phone" && request.method === "POST") {
            const { mobile, verifyCode } = await request.json();

            if (!mobile || !verifyCode) {
                return new Response(
                    JSON.stringify({ error: "missing params" }),
                    { status: 400 }
                );
            }

            const record = await env.SMS_KV.get(mobile);
            if (record !== verifyCode) {
                return new Response(
                    JSON.stringify({ error: "invalid code" }),
                    { status: 403 }
                );
            }

            // 更新 D1
            await env.DB.prepare(
                `UPDATE phone_verify_log
           SET verified = 1, verified_at = CURRENT_TIMESTAMP
           WHERE mobile = ? AND verify_code = ?`
            )
                .bind(mobile, verifyCode)
                .run();

            return new Response(
                JSON.stringify({ verified: true }),
                { headers: { "Content-Type": "application/json" } }
            );
        }

        return new Response(
            JSON.stringify({ error: "not_found" }),
            { status: 404 }
        );
    }
};