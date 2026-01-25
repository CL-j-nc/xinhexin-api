/// <reference types="@cloudflare/workers-types" />
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function ensureSchema(env: Env) {
  // Make sure the applications table exists in both preview/remote D1.
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS applications (
      application_no TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      apply_at TEXT,
      policy_no TEXT
    );`
  ).run();
}

export interface Env {
  DB: D1Database
  POLICY_KV: KVNamespace
}

interface ApplicationItem {
  applicationNo: string
  status: string
  applyAt: string
  policyNo: string | null
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const { pathname } = url

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // 获取投保列表
    if (pathname === "/api/application/list" && req.method === "GET") {
      try {
        await ensureSchema(env);
        const { results } = await env.DB
          .prepare(
            `SELECT application_no as applicationNo,
                    status,
                    apply_at as applyAt,
                    policy_no as policyNo
             FROM applications
             ORDER BY apply_at DESC`
          )
          .all<ApplicationItem>();

        return json(results);
      } catch (e) {
        return json({ error: String(e) }, 500);
      }
    }

    // 核保通过
    if (
      pathname.startsWith('/api/application/') &&
      pathname.endsWith('/approve') &&
      req.method === 'POST'
    ) {
      await ensureSchema(env);
      const applicationNo = pathname.split('/')[3]
      const policyNo = `POLICY-${Date.now()}`

      await env.DB
        .prepare(
          `UPDATE applications
           SET status = 'APPROVED',
               policy_no = ?
           WHERE application_no = ?`
        )
        .bind(policyNo, applicationNo)
        .run()

      return json({ success: true, policyNo })
    }

    return new Response('Not Found', { status: 404 })
  },
}
