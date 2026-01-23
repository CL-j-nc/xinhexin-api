export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;

        if (request.method !== 'POST') {
            return new Response('Method Not Allowed', { status: 405 });
        }

        const body = await request.json();

        // 1️⃣ 发送验证码
        if (path === '/sms/send') {
            const { mobile } = body;
            if (!mobile) {
                return json({ ok: false, msg: 'mobile required' }, 400);
            }

            const code = Math.floor(100000 + Math.random() * 900000).toString();
            const expireAt = Date.now() + 5 * 60 * 1000; // 5 分钟

            await env.DB.prepare(
                `INSERT INTO sms_codes (mobile, code, expire_at)
           VALUES (?, ?, ?)`
            ).bind(mobile, code, expireAt).run();

            // ⚠️ 这里先不接真实短信，直接 console
            console.log('[SMS CODE]', mobile, code);

            return json({ ok: true });
        }

        // 2️⃣ 校验验证码
        if (path === '/sms/verify') {
            const { mobile, code } = body;
            if (!mobile || !code) {
                return json({ ok: false, msg: 'invalid params' }, 400);
            }

            const row = await env.DB.prepare(
                `SELECT * FROM sms_codes
           WHERE mobile = ?
           ORDER BY id DESC
           LIMIT 1`
            ).bind(mobile).first();

            if (!row) {
                return json({ ok: false, msg: 'code not found' }, 401);
            }

            if (row.code !== code) {
                return json({ ok: false, msg: 'code incorrect' }, 401);
            }

            if (Date.now() > row.expire_at) {
                return json({ ok: false, msg: 'code expired' }, 401);
            }

            return json({ ok: true, pass: true });
        }

        return json({ ok: false, msg: 'not found' }, 404);
    }
};

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}