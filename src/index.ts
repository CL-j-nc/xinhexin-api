export interface Env {
  DB: D1Database;
  POLICY_KV: KVNamespace;
}

type TableKind = "applications" | "application";

const FILE_TTL = 90 * 24 * 3600;
const REQUEST_TTL = 90 * 24 * 3600;
const QR_TTL = 30 * 24 * 3600;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

let cachedTable: TableKind | null = null;

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      if (pathname === "/api/upload" && request.method === "POST") {
        const formData = await request.formData();
        const fileValue = formData.get("file");
        if (!fileValue || typeof fileValue === "string") {
          return jsonResponse({ error: "Missing file" }, 400);
        }

        const fileId = await storeFile(env, fileValue, "file");
        return jsonResponse({ fileId });
      }

      if (pathname === "/api/application/apply" && request.method === "POST") {
        const { data, files } = await parseApplyPayload(request, env);
        const applicationNo = await insertApplication(env, data, files);
        const requestId = `REQ-${crypto.randomUUID()}`;

        await env.POLICY_KV.put(`request:${requestId}`, applicationNo, {
          expirationTtl: REQUEST_TTL,
        });

        return jsonResponse({ success: true, requestId });
      }

      if (pathname === "/api/application/search" && request.method === "GET") {
        const keyword = url.searchParams.get("keyword")?.trim() || "";
        const table = await resolveTable(env);
        const results = await searchApplications(env, table, keyword);

        const payload = await Promise.all(
          results.map(async (item) => {
            if (item.status === "COMPLETED") {
              return { status: item.status, qr: null };
            }
            const qr = await env.POLICY_KV.get(`qr:${item.applicationNo}`);
            return { status: item.status, qr };
          })
        );

        return jsonResponse(payload);
      }

      if (pathname === "/api/application/list" && request.method === "GET") {
        const table = await resolveTable(env);
        const records = await listApplications(env, table);
        return jsonResponse(records);
      }

      if (pathname.match(/^\/api\/application\/[^/]+$/) && request.method === "GET") {
        const id = pathname.split("/")[3];
        const mapped = await env.POLICY_KV.get(`request:${id}`);
        const applicationNo = mapped || id;
        const table = await resolveTable(env);

        if (mapped) {
          const status = await getStatus(env, table, applicationNo);
          if (!status) return jsonResponse({ error: "Not Found" }, 404);
          if (status === "COMPLETED") return jsonResponse({ status, qr: null });
          const qr = await env.POLICY_KV.get(`qr:${applicationNo}`);
          return jsonResponse({ status, qr });
        }

        const record = await getApplicationDetail(env, table, applicationNo);
        if (!record) return jsonResponse({ error: "Not Found" }, 404);
        return jsonResponse(record);
      }

      if (pathname.match(/^\/api\/application\/[^/]+\/approve$/) && request.method === "POST") {
        const applicationNo = pathname.split("/")[3];
        const body = (await request.json().catch(() => ({}))) as {
          updatedData?: unknown;
        };
        const table = await resolveTable(env);
        const result = await approveApplication(env, table, applicationNo, body);
        return jsonResponse(result);
      }

      if (pathname.match(/^\/api\/application\/[^/]+\/reject$/) && request.method === "POST") {
        const applicationNo = pathname.split("/")[3];
        const body = (await request.json().catch(() => ({}))) as { reason?: string };
        const table = await resolveTable(env);
        await rejectApplication(env, table, applicationNo, body.reason);
        return jsonResponse({ success: true });
      }

      if (
        pathname.match(/^\/api\/application\/[^/]+\/upload-payment-screenshot$/) &&
        request.method === "POST"
      ) {
        const applicationNo = pathname.split("/")[3];
        const formData = await request.formData();
        const fileValue = formData.get("screenshot");
        if (!fileValue || typeof fileValue === "string") {
          return jsonResponse({ error: "Missing screenshot" }, 400);
        }

        const key = await storeFile(env, fileValue, `payment-screenshot:${applicationNo}`);
        const table = await resolveTable(env);
        await attachPaymentScreenshot(env, table, applicationNo, key);
        return jsonResponse({ success: true });
      }

      if (
        pathname.match(/^\/api\/application\/[^/]+\/payment-screenshot$/) &&
        request.method === "GET"
      ) {
        const applicationNo = pathname.split("/")[3];
        const key = `payment-screenshot:${applicationNo}`;
        const object = await env.POLICY_KV.getWithMetadata(key, { type: "arrayBuffer" });
        if (!object.value) return new Response("Not Found", { status: 404 });
        const metadata = object.metadata as { contentType?: string } | null;

        return new Response(object.value, {
          headers: {
            "Content-Type": metadata?.contentType || "image/png",
            ...corsHeaders(),
          },
        });
      }

      if (pathname === "/api/application/by-token" && request.method === "GET") {
        const token = url.searchParams.get("token");
        if (!token) return jsonResponse({ error: "Missing token" }, 400);

        const table = await resolveTable(env);
        const record = await getApplicationByToken(env, table, token);
        if (!record) return jsonResponse({ error: "Invalid or completed" }, 403);
        return jsonResponse(record);
      }

      if (
        pathname.match(/^\/api\/application\/[^/]+\/confirm-payment$/) &&
        request.method === "POST"
      ) {
        const applicationNo = pathname.split("/")[3];
        const table = await resolveTable(env);
        await confirmPayment(env, table, applicationNo);
        return jsonResponse({ success: true });
      }

      if (pathname.match(/^\/api\/application\/[^/]+\/complete$/) && request.method === "POST") {
        const applicationNo = pathname.split("/")[3];
        const table = await resolveTable(env);
        await completeApplication(env, table, applicationNo);
        await env.POLICY_KV.delete(`qr:${applicationNo}`);
        return jsonResponse({ success: true });
      }

      if (pathname === "/api/verify/send" && request.method === "POST") {
        const payload = (await request.json().catch(() => ({}))) as {
          applicationNo?: string;
        };
        const applicationNo = payload.applicationNo;
        if (!applicationNo) return jsonResponse({ error: "Missing applicationNo" }, 400);
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        await env.POLICY_KV.put(
          `verify:${applicationNo}`,
          JSON.stringify({ code, at: now() }),
          { expirationTtl: 300 }
        );
        return jsonResponse({ success: true, code });
      }

      if (pathname === "/api/verify/check" && request.method === "POST") {
        const payload = (await request.json().catch(() => ({}))) as {
          applicationNo?: string;
          code?: string;
        };
        const applicationNo = payload.applicationNo;
        const code = payload.code;
        if (!applicationNo || !code) return jsonResponse({ error: "Missing data" }, 400);
        const raw = await env.POLICY_KV.get(`verify:${applicationNo}`);
        if (!raw) return jsonResponse({ error: "Code expired" }, 400);
        const saved = safeJsonParse(raw) as { code?: string } | null;
        if (!saved?.code || saved.code !== code) return jsonResponse({ error: "Invalid code" }, 400);
        await markVerified(env, await resolveTable(env), applicationNo);
        return jsonResponse({ success: true });
      }

      return jsonResponse({ error: "Not Found" }, 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return jsonResponse({ success: false, error: message }, 500);
    }
  },
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function now() {
  return new Date().toISOString();
}

async function resolveTable(env: Env): Promise<TableKind> {
  if (cachedTable) return cachedTable;
  try {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('applications', 'application')"
    ).all();
    const names = (results || []).map((row: any) => row.name);
    if (names.includes("applications")) {
      cachedTable = "applications";
      return cachedTable;
    }
    if (names.includes("application")) {
      cachedTable = "application";
      return cachedTable;
    }
  } catch { }
  cachedTable = "applications";
  return cachedTable;
}

async function storeFile(env: Env, file: File, prefix: string) {
  if (file.size > MAX_UPLOAD_BYTES || !file.type.startsWith("image/")) {
    throw new Error("Invalid file");
  }
  const key = prefix.includes(":")
    ? prefix
    : `${prefix}:${crypto.randomUUID()}`;

  await env.POLICY_KV.put(key, await file.arrayBuffer(), {
    metadata: { contentType: file.type },
    expirationTtl: FILE_TTL,
  });
  return key;
}

async function parseApplyPayload(request: Request, env: Env) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const dataStr = formData.get("data");
    const data = dataStr ? safeJsonParse(String(dataStr)) || {} : {};
    const files: Record<string, string> = {};
    const fileFields = ["idFront", "idBack", "licenseFront", "licenseBack"];

    for (const field of fileFields) {
      const value = formData.get(field);
      if (value && typeof value !== "string") {
        files[field] = await storeFile(env, value, `file:${crypto.randomUUID()}`);
      }
    }

    return { data, files };
  }

  const data = await request.json().catch(() => ({}));
  return { data, files: {} };
}

async function insertApplication(env: Env, data: any, files: Record<string, string>) {
  const table = await resolveTable(env);
  const applicationNo = `APP-${crypto.randomUUID()}`;
  const appliedAt = now();
  const proposerName = data?.proposer?.name || "";
  const insuredName = data?.insured?.name || "";
  const plate = data?.vehicle?.plate || "";
  const vin = data?.vehicle?.vin || "";

  if (table === "applications") {
    await env.DB.prepare(
      `
      INSERT INTO applications
      (applicationNo, status, applyAt, proposerName, insuredName, plate, vin, dataJson, filesJson)
      VALUES (?, 'APPLIED', ?, ?, ?, ?, ?, ?, ?)
    `
    )
      .bind(
        applicationNo,
        appliedAt,
        proposerName,
        insuredName,
        plate,
        vin,
        JSON.stringify(data || {}),
        JSON.stringify(files || {})
      )
      .run();
    return applicationNo;
  }

  const payload = { ...(data || {}) };
  if (Object.keys(files).length) payload.files = files;

  await env.DB.prepare(
    `
    INSERT INTO application
    (application_no, data, status, applied_at)
    VALUES (?, ?, 'APPLIED', ?)
  `
  )
    .bind(applicationNo, JSON.stringify(payload), appliedAt)
    .run();

  return applicationNo;
}

async function searchApplications(env: Env, table: TableKind, keyword: string) {
  if (table === "applications") {
    const query = keyword
      ? `
        SELECT applicationNo, status, applyAt
        FROM applications
        WHERE proposerName LIKE ? OR insuredName LIKE ? OR plate LIKE ? OR vin LIKE ?
        ORDER BY applyAt DESC
        LIMIT 50
      `
      : `
        SELECT applicationNo, status, applyAt
        FROM applications
        ORDER BY applyAt DESC
        LIMIT 50
      `;

    const bindings = keyword
      ? [`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`]
      : [];
    const { results } = await env.DB.prepare(query).bind(...bindings).all();
    return (results || []).map((row: any) => ({
      applicationNo: row.applicationNo,
      status: row.status,
    }));
  }

  const query = keyword
    ? `
      SELECT application_no, status, applied_at, data
      FROM application
      WHERE data LIKE ? OR application_no LIKE ?
      ORDER BY applied_at DESC
      LIMIT 50
    `
    : `
      SELECT application_no, status, applied_at, data
      FROM application
      ORDER BY applied_at DESC
      LIMIT 50
    `;

  const bindings = keyword ? [`%${keyword}%`, `%${keyword}%`] : [];
  const { results } = await env.DB.prepare(query).bind(...bindings).all();

  return (results || []).map((row: any) => ({
    applicationNo: row.application_no,
    status: row.status,
  }));
}

async function listApplications(env: Env, table: TableKind) {
  if (table === "applications") {
    const { results } = await env.DB.prepare(
      `
        SELECT applicationNo, status, applyAt, proposerName, insuredName, plate, vin, policyNo
        FROM applications
        ORDER BY applyAt DESC
        LIMIT 50
      `
    ).all();
    return results || [];
  }

  const { results } = await env.DB.prepare(
    `
      SELECT application_no, status, applied_at, policy_no, data
      FROM application
      ORDER BY applied_at DESC
      LIMIT 50
    `
  ).all();

  return (results || []).map((row: any) => {
    const data = safeJsonParse(row.data) as any;
    return {
      applicationNo: row.application_no,
      status: row.status,
      applyAt: row.applied_at,
      proposerName: data?.proposer?.name || "",
      insuredName: data?.insured?.name || "",
      plate: data?.vehicle?.plate || "",
      vin: data?.vehicle?.vin || "",
      policyNo: row.policy_no || "",
    };
  });
}

async function getStatus(env: Env, table: TableKind, applicationNo: string) {
  if (table === "applications") {
    const record = await env.DB.prepare(
      "SELECT status FROM applications WHERE applicationNo = ?"
    )
      .bind(applicationNo)
      .first<any>();
    return record?.status || null;
  }

  const record = await env.DB.prepare(
    "SELECT status FROM application WHERE application_no = ?"
  )
    .bind(applicationNo)
    .first<any>();
  return record?.status || null;
}

async function getApplicationDetail(env: Env, table: TableKind, applicationNo: string) {
  if (table === "applications") {
    const record = await env.DB.prepare(
      "SELECT * FROM applications WHERE applicationNo = ?"
    )
      .bind(applicationNo)
      .first<any>();
    if (!record) return null;
    const data = safeJsonParse(record.dataJson) || {};
    const files = safeJsonParse(record.filesJson) || {};
    delete record.dataJson;
    delete record.filesJson;
    return { ...record, data, files };
  }

  const record = await env.DB.prepare(
    "SELECT * FROM application WHERE application_no = ?"
  )
    .bind(applicationNo)
    .first<any>();
  if (!record) return null;
  const data = safeJsonParse(record.data) || {};
  delete record.data;
  return { ...record, data };
}

async function approveApplication(
  env: Env,
  table: TableKind,
  applicationNo: string,
  body: any
) {
  const policyNo = `POL-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  const clientToken = `TOKEN-${Math.random().toString(36).slice(2, 12)}`;
  const qrUrl = `https://xinhexin-p-hebao.pages.dev/#/buffer?token=${clientToken}`;

  if (table === "applications") {
    let updatedData = body?.updatedData;
    if (!updatedData) {
      const existing = await env.DB.prepare(
        "SELECT dataJson FROM applications WHERE applicationNo = ?"
      )
        .bind(applicationNo)
        .first<any>();
      updatedData = safeJsonParse(existing?.dataJson) || {};
    }

    await env.DB.prepare(
      `
        UPDATE applications
        SET status = 'APPROVED', policyNo = ?, approvedAt = ?, clientToken = ?, dataJson = ?
        WHERE applicationNo = ?
      `
    )
      .bind(policyNo, now(), clientToken, JSON.stringify(updatedData), applicationNo)
      .run();
  } else {
    const existing = await env.DB.prepare(
      "SELECT data FROM application WHERE application_no = ?"
    )
      .bind(applicationNo)
      .first<any>();
    let payload = safeJsonParse(existing?.data) || {};
    if (body?.updatedData) {
      payload = body.updatedData;
    }
    payload.clientToken = clientToken;

    await env.DB.prepare(
      `
        UPDATE application
        SET status = 'APPROVED', policy_no = ?, approved_at = ?, data = ?
        WHERE application_no = ?
      `
    )
      .bind(policyNo, now(), JSON.stringify(payload), applicationNo)
      .run();
  }

  await env.POLICY_KV.put(`qr:${applicationNo}`, qrUrl, { expirationTtl: QR_TTL });
  return { success: true, policyNo, clientToken, qrUrl };
}

async function rejectApplication(
  env: Env,
  table: TableKind,
  applicationNo: string,
  reason?: string
) {
  const rejectReason = reason || "Rejected";
  if (table === "applications") {
    await env.DB.prepare(
      `
        UPDATE applications
        SET status = 'REJECTED', rejectReason = ?, rejectedAt = ?
        WHERE applicationNo = ?
      `
    )
      .bind(rejectReason, now(), applicationNo)
      .run();
    return;
  }

  const existing = await env.DB.prepare(
    "SELECT data FROM application WHERE application_no = ?"
  )
    .bind(applicationNo)
    .first<any>();
  const payload = safeJsonParse(existing?.data) || {};
  payload.rejectReason = rejectReason;
  await env.DB.prepare(
    `
      UPDATE application
      SET status = 'REJECTED', rejected_at = ?, data = ?
      WHERE application_no = ?
    `
  )
    .bind(now(), JSON.stringify(payload), applicationNo)
    .run();
}

async function attachPaymentScreenshot(
  env: Env,
  table: TableKind,
  applicationNo: string,
  key: string
) {
  if (table === "applications") {
    await env.DB.prepare(
      "UPDATE applications SET paymentScreenshotKey = ? WHERE applicationNo = ?"
    )
      .bind(key, applicationNo)
      .run();
    return;
  }

  const existing = await env.DB.prepare(
    "SELECT data FROM application WHERE application_no = ?"
  )
    .bind(applicationNo)
    .first<any>();
  const payload = safeJsonParse(existing?.data) || {};
  payload.paymentScreenshotKey = key;
  await env.DB.prepare(
    `
      UPDATE application
      SET data = ?
      WHERE application_no = ?
    `
  )
    .bind(JSON.stringify(payload), applicationNo)
    .run();
}

async function getApplicationByToken(env: Env, table: TableKind, token: string) {
  if (table === "applications") {
    const record = await env.DB.prepare(
      `
        SELECT * FROM applications
        WHERE clientToken = ? AND status NOT IN ('REJECTED', 'COMPLETED')
      `
    )
      .bind(token)
      .first<any>();
    if (!record) return null;
    const data = safeJsonParse(record.dataJson) || {};
    delete record.dataJson;
    return { ...record, data };
  }

  const { results } = await env.DB.prepare(
    `
      SELECT * FROM application
      WHERE status NOT IN ('REJECTED', 'COMPLETED') AND data LIKE ?
    `
  )
    .bind(`%${token}%`)
    .all();

  for (const row of results || []) {
    const data = safeJsonParse(row.data as string | null) || {};
    if (data?.clientToken === token) {
      return { ...row, data };
    }
  }

  return null;
}

async function confirmPayment(env: Env, table: TableKind, applicationNo: string) {
  if (table === "applications") {
    await env.DB.prepare(
      `
        UPDATE applications
        SET status = 'PAID', paidAt = ?
        WHERE applicationNo = ? AND status = 'APPROVED'
      `
    )
      .bind(now(), applicationNo)
      .run();
    return;
  }

  await env.DB.prepare(
    `
      UPDATE application
      SET status = 'PAID', paid_at = ?
      WHERE application_no = ? AND status = 'APPROVED'
    `
  )
    .bind(now(), applicationNo)
    .run();
}

async function completeApplication(env: Env, table: TableKind, applicationNo: string) {
  if (table === "applications") {
    await env.DB.prepare(
      `
        UPDATE applications
        SET status = 'COMPLETED', completedAt = ?
        WHERE applicationNo = ? AND status IN ('PAID', 'APPROVED')
      `
    )
      .bind(now(), applicationNo)
      .run();
    return;
  }

  await env.DB.prepare(
    `
      UPDATE application
      SET status = 'COMPLETED', policy_issued_at = ?
      WHERE application_no = ? AND status IN ('PAID', 'APPROVED')
    `
  )
    .bind(now(), applicationNo)
    .run();
}

async function markVerified(env: Env, table: TableKind, applicationNo: string) {
  if (table === "applications") {
    await env.DB.prepare(
      "UPDATE applications SET verifiedAt = ? WHERE applicationNo = ?"
    )
      .bind(now(), applicationNo)
      .run();
    return;
  }

  await env.DB.prepare(
    "UPDATE application SET verify_code = ? WHERE application_no = ?"
  )
    .bind("verified", applicationNo)
    .run();
}

function safeJsonParse(raw: string | null) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
