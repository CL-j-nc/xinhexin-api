export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (request.method === "POST" && url.pathname === "/sms/send") {
            const body = await request.json().catch(() => ({}));
            const mobile = body.mobile;

            if (!mobile) {
                return new Response(
                    JSON.stringify({ error: "mobile required" }),
                    { status: 400, headers: { "Content-Type": "application/json" } }
                );
            }

            const code = Math.floor(100000 + Math.random() * 900000).toString();

            await env.SMS_KV.put(`sms:${mobile}`, code, { expirationTtl: 300 });

            return new Response(
                JSON.stringify({ status: "ok", code }),
                { headers: { "Content-Type": "application/json" } }
            );
        }

        if (request.method === "POST" && url.pathname === "/sms/verify") {
            const body = await request.json().catch(() => ({}));
            const { mobile, code } = body;

            if (!mobile || !code) {
                return new Response(
                    JSON.stringify({ error: "mobile and code required" }),
                    { status: 400, headers: { "Content-Type": "application/json" } }
                );
            }

            const saved = await env.SMS_KV.get(`sms:${mobile}`);

            if (saved === code) {
                return new Response(
                    JSON.stringify({ status: "verified" }),
                    { headers: { "Content-Type": "application/json" } }
                );
            }

            return new Response(
                JSON.stringify({ status: "invalid" }),
                { status: 401, headers: { "Content-Type": "application/json" } }
            );
        }

        return new Response(
            JSON.stringify({ error: "Not Found" }),
            { status: 404, headers: { "Content-Type": "application/json" } }
        );
    }
};