export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (request.method === "POST" && url.pathname === "/sms/send") {
            const { mobile } = await request.json();

            if (!mobile) {
                return new Response("mobile required", { status: 400 });
            }

            const code = Math.floor(100000 + Math.random() * 900000).toString();

            await env.SMS_KV.put(`sms:${mobile}`, code, { expirationTtl: 300 });

            return Response.json({ status: "ok", code });
        }

        if (request.method === "POST" && url.pathname === "/sms/verify") {
            const { mobile, code } = await request.json();
            const saved = await env.SMS_KV.get(`sms:${mobile}`);

            if (saved === code) {
                return Response.json({ status: "verified" });
            }

            return Response.json({ status: "invalid" }, { status: 401 });
        }

        return new Response("Not Found", { status: 404 });
    }
};