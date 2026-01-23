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