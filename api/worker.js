export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/status" && request.method === "GET") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/verify-phone" && request.method === "POST") {
      const body = await request.json();
      const { mobile, verifyCode } = body;

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
