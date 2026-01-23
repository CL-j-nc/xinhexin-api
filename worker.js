// worker.js
export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // 健康检查
        if (url.pathname === "/" || url.pathname === "/health") {
            return new Response(
                JSON.stringify({
                    status: "ok",
                    service: "xinhexin-api",
                    env: env.ENV || "unknown",
                }),
                { headers: { "Content-Type": "application/json" } }
            );
        }

        // 示例：占位 API（后续你会接真实逻辑）
        if (url.pathname === "/api/ping") {
            return new Response(
                JSON.stringify({ message: "pong" }),
                { headers: { "Content-Type": "application/json" } }
            );
        }

        return new Response("Not Found", { status: 404 });
    }
};