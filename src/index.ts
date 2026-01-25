// src/index.ts （完整版，包含销售端 + 核保端所需接口）

interface Env {
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // 统一处理 CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(),
      });
    }

    // ──────────────────────────────────────────────
    // 销售端：提交投保单
    // ──────────────────────────────────────────────
    if (pathname === '/api/application/apply' && request.method === 'POST') {
      try {
        const body: any = await request.json();

        const applicationNo = `APP-${Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 7).toUpperCase()}`;

        const now = new Date().toISOString();

        await env.DB.prepare(`
          INSERT INTO applications (
            applicationNo,
            status,
            applyAt,
            proposerName,
            insuredName,
            plate,
            vin,
            dataJson
          ) VALUES (?, 'APPLIED', ?, ?, ?, ?, ?, ?)
        `).bind(
          applicationNo,
          now,
          body.proposer?.name || '',
          body.insured?.name || '',
          body.vehicle?.plate || '',
          body.vehicle?.vin || '',
          JSON.stringify(body)
        ).run();

        return jsonResponse({ success: true, applicationNo }, 201);
      } catch (err: any) {
        return jsonResponse({ success: false, error: err.message }, 400);
      }
    }

    // ──────────────────────────────────────────────
    // 核保端：获取待核保列表
    // ──────────────────────────────────────────────
    if (pathname === '/api/application/list' && request.method === 'GET') {
      try {
        const { results } = await env.DB.prepare(`
          SELECT 
            applicationNo,
            status,
            applyAt,
            proposerName,
            insuredName,
            plate,
            vin,
            policyNo
          FROM applications
          WHERE status IN ('APPLIED', 'UNDERWRITING')
          ORDER BY applyAt DESC
          LIMIT 50
        `).all();

        return jsonResponse(results);
      } catch (err: any) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // ──────────────────────────────────────────────
    // 核保端：获取单个投保单详情
    // ──────────────────────────────────────────────
    if (pathname.startsWith('/api/application/') && request.method === 'GET') {
      const applicationNo = pathname.split('/')[3];
      if (!applicationNo) return jsonResponse({ error: '缺少 applicationNo' }, 400);

      try {
        const { results } = await env.DB.prepare(`
          SELECT * FROM applications WHERE applicationNo = ?
        `).bind(applicationNo).all();

        if (results.length === 0) {
          return jsonResponse({ error: '投保单不存在' }, 404);
        }

        const record: any = results[0];
        record.data = JSON.parse(record.dataJson || '{}');
        delete record.dataJson;

        return jsonResponse(record);
      } catch (err: any) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // ──────────────────────────────────────────────
    // 核保端：核保通过
    // ──────────────────────────────────────────────
    if (pathname.startsWith('/api/application/') && pathname.endsWith('/approve') && request.method === 'POST') {
      const applicationNo = pathname.split('/')[3];
      if (!applicationNo) return jsonResponse({ error: '缺少 applicationNo' }, 400);

      try {
        const policyNo = `POL-${Date.now().toString(36).toUpperCase()}`;

        await env.DB.prepare(`
          UPDATE applications
          SET 
            status = 'APPROVED',
            policyNo = ?,
            approvedAt = ?
          WHERE applicationNo = ? AND status = 'APPLIED'
        `).bind(policyNo, new Date().toISOString(), applicationNo).run();

        return jsonResponse({ success: true, policyNo });
      } catch (err: any) {
        return jsonResponse({ success: false, error: err.message }, 500);
      }
    }

    // ──────────────────────────────────────────────
    // 核保端：核保拒绝（可带原因）
    // ──────────────────────────────────────────────
    if (pathname.startsWith('/api/application/') && pathname.endsWith('/reject') && request.method === 'POST') {
      const applicationNo = pathname.split('/')[3];
      if (!applicationNo) return jsonResponse({ error: '缺少 applicationNo' }, 400);

      let rejectReason = '';
      try {
        const body: { reason?: string } = await request.json();
        rejectReason = body.reason || '未说明原因';
      } catch { }

      try {
        await env.DB.prepare(`
          UPDATE applications
          SET 
            status = 'REJECTED',
            rejectReason = ?,
            rejectedAt = ?
          WHERE applicationNo = ? AND status = 'APPLIED'
        `).bind(rejectReason, new Date().toISOString(), applicationNo).run();

        return jsonResponse({ success: true });
      } catch (err: any) {
        return jsonResponse({ success: false, error: err.message }, 500);
      }
    }

    // 404
    return jsonResponse({ error: 'Not Found' }, 404);
  }
};

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
    },
  });
}