/* === Xinhexin Worker (stable) === */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors() });
    }

    /* ---------- apply ---------- */
    if (url.pathname === "/api/application/apply" && request.method === "POST") {
      const formData = await request.formData();
      const dataStr = formData.get('data');
      const data = JSON.parse(dataStr);

      const applicationNo = `APP-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
      const now = nowISO();

      // Handle files
      const fileKeys = {};
      for (const key of ['idFront', 'idBack', 'licenseFront', 'licenseBack']) {
        const file = formData.get(key);
        if (file) {
          const fileKey = `file:${applicationNo}:${key}`;
          await env.POLICY_KV.put(fileKey, await file.arrayBuffer(), { metadata: { contentType: file.type } });
          fileKeys[key] = fileKey;
        }
      }
      data.files = fileKeys;

      await env.DB.prepare(`
        INSERT INTO applications 
        (applicationNo, status, applyAt, proposerName, insuredName, plate, vin, data)
        VALUES (?, 'APPLIED', ?, ?, ?, ?, ?, ?)
      `).bind(
        applicationNo,
        now,
        data.proposer.name,
        data.insured.name,
        data.vehicle.plate,
        data.vehicle.vin,
        JSON.stringify(data)
      ).run();

      return json({ success: true, applicationNo });
    }

    /* ---------- search ---------- */
    if (url.pathname === "/api/application/search" && request.method === "GET") {
      const keyword = url.searchParams.get('keyword') || '';
      const results = await env.DB.prepare(`
        SELECT applicationNo, status, applyAt, policyNo
        FROM applications
        WHERE proposerName LIKE ? OR insuredName LIKE ? OR plate LIKE ? OR vin LIKE ?
      `).bind(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`).all();

      return json(results.rows);
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