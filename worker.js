export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const { pathname } = url;

        // 允许跨域（前端直接调）
        if (request.method === "OPTIONS") {
            return new Response(null, {
                headers: corsHeaders(),
            });
        }

        try {
            // 发送验证码
            if (pathname === "/sms/send" && request.method === "POST") {
                const { mobile } = await request.json();

                if (!mobile || !/^1\d{10}$/.test(mobile)) {
                    return json({ error: "手机号格式不正确" }, 400);
                }

                const code = Math.floor(100000 + Math.random() * 900000).toString();
                const expiresAt = Date.now() + 5 * 60 * 1000; // 5分钟

                await env.KV.put(
                    `sms:${mobile}`,
                    JSON.stringify({ code, expiresAt }),
                    { expirationTtl: 300 }
                );

                // ⚠️ 实战阶段这里接短信服务
                return json({
                    status: "ok",
                    message: "验证码已发送（测试环境直接返回）",
                    code, // 测试用，正式删掉
                });
            }

            // 校验验证码
            if (pathname === "/sms/verify" && request.method === "POST") {
                const { mobile, code } = await request.json();

                const raw = await env.KV.get(`sms:${mobile}`);
                if (!raw) {
                    return json({ error: "验证码不存在或已过期" }, 400);
                }

                const data = JSON.parse(raw);

                if (Date.now() > data.expiresAt) {
                    return json({ error: "验证码已过期" }, 400);
                }

                if (data.code !== code) {
                    return json({ error: "验证码错误" }, 400);
                }

                // 验证成功，清除验证码
                await env.KV.delete(`sms:${mobile}`);

                return json({
                    status: "ok",
                    verified: true,
                });
            }

            // 健康检查
            return json({ status: "ok" });
        } catch (err) {
            return json(
                { error: err.message || "server error" },
                500
            );
        }
    },
};

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            ...corsHeaders(),
            "Content-Type": "application/json",
        },
    });
}

function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };
}