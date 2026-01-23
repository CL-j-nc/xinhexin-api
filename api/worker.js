export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // health
        if (url.pathname === "/status" && request.method === "GET") {
            return new Response(JSON.stringify({ status: "ok" }), {
                headers: { "Content-Type": "application/json" },
            });
        }

        // 1️⃣ salesman 生成验证码（不接短信）
        if (url.pathname === "/generate-code" && request.method === "POST") {
            const { mobile } = await request.json();

            if (!mobile) {
                return new Response(JSON.stringify({ error: "mobile required" }), { status: 400 });
            }

            // 6 位数字码
            const code = Math.floor(100000 + Math.random() * 900000).toString();

            // 写入 KV，5 分钟失效
            await env.SMS_KV.put(mobile, code, { expirationTtl: 300 });

            return new Response(
                JSON.stringify({
                    mobile,
                    verifyCode: code
                }),
                { headers: { "Content-Type": "application/json" } }
            );
        }

        // 2️⃣ buffer / 核保 校验验证码
        if (url.pathname === "/verify-phone" && request.method === "POST") {
            const { mobile, verifyCode } = await request.json();

            if (!mobile || !verifyCode) {
                return new Response(JSON.stringify({ error: "missing params" }), { status: 400 });
            }

            const record = await env.SMS_KV.get(mobile);

            if (record !== verifyCode) {
                return new Response(JSON.stringify({ error: "invalid code" }), { status: 403 });
            }

            return new Response(
                JSON.stringify({ verified: true }),
                { headers: { "Content-Type": "application/json" } }
            );
        }

        return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    }
};