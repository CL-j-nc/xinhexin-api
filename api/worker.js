/* === Xinhexin Worker (stable) === */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors() });
    }

    /* ---------- verify send ---------- */
    if (url.pathname === "/api/verify/send" && request.method === "POST") {
      const { applicationNo } = await request.json();
      const code = Math.floor(100000 + Math.random() * 900000).toString();

      await env.POLICY_KV.put(
        `verify:${applicationNo}`,
        JSON.stringify({ code, at: nowISO() }),
        { expirationTtl: 300 }
      );

      return json({ success: true, code });
    }

    /* ---------- verify check (WRITE BACK) ---------- */
    if (url.pathname === "/api/verify/check" && request.method === "POST") {
      const { applicationNo, code } = await request.json();

      const raw = await env.POLICY_KV.get(`verify:${applicationNo}`);
      if (!raw) return json({ success: false, reason: "expired" }, 400);

      const saved = JSON.parse(raw);
      if (saved.code !== code) {
        return json({ success: false, reason: "invalid" }, 400);
      }

      await env.DB.prepare(`
        UPDATE applications
        SET status = 'VERIFIED',
            verifiedAt = ?
        WHERE applicationNo = ?
      `).bind(nowISO(), applicationNo).run();

      return json({ success: true });
    }

    return json({ error: "not_found" }, 404);
  }
};

/* ---------- utils ---------- */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors() }
  });
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function nowISO() {
  return new Date().toISOString();
}
