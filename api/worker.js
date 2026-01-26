/* === Xinhexin Worker (完整优化版) === */
/* 支持完整三段式闭环：Salesman 提交 → Underwriting 核保/定价/生成二维码 → Client 确认支付 → Underwriting 完成 */
/* 所有接口联动：状态变更实时反映在查询/列表中，token 一车一码，支付截图支持 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // 统一 CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      // ──────────────────────────────────────────────
      // Salesman: 提交投保单 (POST /api/application/apply)
      // 支持 FormData（data JSON + 文件）
      // ──────────────────────────────────────────────
      if (pathname === '/api/application/apply' && request.method === 'POST') {
        const formData = await request.formData();
        const dataStr = formData.get('data');
        if (!dataStr) throw new Error('缺少 data 参数');

        const data = JSON.parse(dataStr);
        const applicationNo = `APP-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
        const now = new Date().toISOString();

        // 文件上传到 KV
        const fileKeys = {};
        const fileFields = ['idFront', 'idBack', 'licenseFront', 'licenseBack'];
        for (const key of fileFields) {
          const file = formData.get(key);
          if (file && file.size <= 5 * 1024 * 1024 && file.type.startsWith('image/')) {
            const fileKey = `file:${applicationNo}:${key}`;
            await env.POLICY_KV.put(fileKey, await file.arrayBuffer(), {
              metadata: { contentType: file.type },
              expirationTtl: 90 * 24 * 3600
            });
            fileKeys[key] = fileKey;
          }
        }

        // 写入 D1
        await env.DB.prepare(`
          INSERT INTO applications 
          (applicationNo, status, applyAt, proposerName, insuredName, plate, vin, dataJson, filesJson)
          VALUES (?, 'APPLIED', ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          applicationNo,
          now,
          data.proposer?.name || '',
          data.insured?.name || '',
          data.vehicle?.plate || '',
          data.vehicle?.vin || '',
          JSON.stringify(data),
          JSON.stringify(fileKeys)
        ).run();

        return jsonResponse({ success: true, applicationNo });
      }

      // ──────────────────────────────────────────────
      // Salesman: 历史查询 (GET /api/application/search)
      // ──────────────────────────────────────────────
      if (pathname === '/api/application/search' && request.method === 'GET') {
        const keyword = url.searchParams.get('keyword')?.trim() || '';
        if (!keyword) return jsonResponse({ error: '请提供查询关键词' }, 400);

        const { results } = await env.DB.prepare(`
          SELECT applicationNo, status, applyAt, policyNo
          FROM applications
          WHERE proposerName LIKE ? OR insuredName LIKE ? OR plate LIKE ? OR vin LIKE ?
          ORDER BY applyAt DESC
          LIMIT 50
        `).bind(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`).all();

        return jsonResponse(results);
      }

      // ──────────────────────────────────────────────
      // Underwriting: 待核保列表 (GET /api/application/list)
      // ──────────────────────────────────────────────
      if (pathname === '/api/application/list' && request.method === 'GET') {
        const { results } = await env.DB.prepare(`
          SELECT applicationNo, status, applyAt, proposerName, insuredName, plate, vin, policyNo
          FROM applications
          WHERE status IN ('APPLIED', 'UNDERWRITING')
          ORDER BY applyAt DESC
          LIMIT 50
        `).all();

        return jsonResponse(results);
      }

      // ──────────────────────────────────────────────
      // Underwriting: 单个详情 (GET /api/application/:no)
      // ──────────────────────────────────────────────
      if (pathname.match(/^\/api\/application\/[^\/]+$/) && request.method === 'GET') {
        const applicationNo = pathname.split('/')[3];
        const { results } = await env.DB.prepare(`SELECT * FROM applications WHERE applicationNo = ?`)
          .bind(applicationNo).all();

        if (results.length === 0) return jsonResponse({ error: '投保单不存在' }, 404);

        const record = results[0];
        record.data = JSON.parse(record.dataJson || '{}');
        record.files = JSON.parse(record.filesJson || '{}');
        delete record.dataJson;
        delete record.filesJson;

        return jsonResponse(record);
      }

      // ──────────────────────────────────────────────
      // Underwriting: 核保通过 + 生成 clientToken (POST /api/application/:no/approve)
      // ──────────────────────────────────────────────
      if (pathname.match(/^\/api\/application\/[^\/]+\/approve$/) && request.method === 'POST') {
        const applicationNo = pathname.split('/')[3];
        const body = await request.json();

        const policyNo = `POL-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
        const clientToken = `TOKEN-${Math.random().toString(36).substr(2, 12)}`;

        // 可选：核保员调整数据（如 coverages、totalPremium）
        const updatedData = body.updatedData ? JSON.stringify(body.updatedData) :
          (await env.DB.prepare('SELECT dataJson FROM applications WHERE applicationNo = ?').bind(applicationNo).first()).dataJson;

        await env.DB.prepare(`
          UPDATE applications
          SET status = 'APPROVED', policyNo = ?, approvedAt = ?, clientToken = ?, dataJson = ?
          WHERE applicationNo = ?
        `).bind(policyNo, new Date().toISOString(), clientToken, updatedData, applicationNo).run();

        const qrUrl = `https://xinhexin-p-hebao.pages.dev/#/buffer?token=${clientToken}`;  // 请替换为实际 Client 域名

        return jsonResponse({ success: true, policyNo, clientToken, qrUrl });
      }

      // ──────────────────────────────────────────────
      // Underwriting: 核保拒绝 (POST /api/application/:no/reject)
      // ──────────────────────────────────────────────
      if (pathname.match(/^\/api\/application\/[^\/]+\/reject$/) && request.method === 'POST') {
        const applicationNo = pathname.split('/')[3];
        const { reason = '未指定原因' } = await request.json();

        await env.DB.prepare(`
          UPDATE applications
          SET status = 'REJECTED', rejectReason = ?, rejectedAt = ?
          WHERE applicationNo = ?
        `).bind(reason, new Date().toISOString(), applicationNo).run();

        return jsonResponse({ success: true });
      }

      // ──────────────────────────────────────────────
      // Underwriting: 上传支付截图 (POST /api/application/:no/upload-payment-screenshot)
      // ──────────────────────────────────────────────
      if (pathname.match(/^\/api\/application\/[^\/]+\/upload-payment-screenshot$/) && request.method === 'POST') {
        const applicationNo = pathname.split('/')[3];
        const formData = await request.formData();
        const file = formData.get('screenshot');

        if (!file || file.size > 5 * 1024 * 1024 || !file.type.startsWith('image/')) {
          throw new Error('无效支付截图');
        }

        const key = `payment-screenshot:${applicationNo}`;
        await env.POLICY_KV.put(key, await file.arrayBuffer(), {
          metadata: { contentType: file.type },
          expirationTtl: 90 * 24 * 3600
        });

        await env.DB.prepare(`UPDATE applications SET paymentScreenshotKey = ? WHERE applicationNo = ?`)
          .bind(key, applicationNo).run();

        return jsonResponse({ success: true });
      }

      // ──────────────────────────────────────────────
      // 获取支付截图 (GET /api/application/:no/payment-screenshot)
      // ──────────────────────────────────────────────
      if (pathname.match(/^\/api\/application\/[^\/]+\/payment-screenshot$/) && request.method === 'GET') {
        const applicationNo = pathname.split('/')[3];
        const key = `payment-screenshot:${applicationNo}`;
        const object = await env.POLICY_KV.getWithMetadata(key, { type: 'arrayBuffer' });

        if (!object.value) return new Response('Not Found', { status: 404 });

        return new Response(object.value, {
          headers: { 'Content-Type': object.metadata?.contentType || 'image/png', ...corsHeaders() }
        });
      }

      // ──────────────────────────────────────────────
      // Client: 通过 token 获取详情 (GET /api/application/by-token?token=xxx)
      // ──────────────────────────────────────────────
      if (pathname === '/api/application/by-token' && request.method === 'GET') {
        const token = url.searchParams.get('token');
        if (!token) throw new Error('缺少 token');

        const { results } = await env.DB.prepare(`
          SELECT * FROM applications WHERE clientToken = ? AND status NOT IN ('REJECTED', 'COMPLETED')
        `).bind(token).all();

        if (results.length === 0) return jsonResponse({ error: '无效或已完成' }, 403);

        const record = results[0];
        record.data = JSON.parse(record.dataJson || '{}');
        delete record.dataJson;

        return jsonResponse(record);
      }

      // ──────────────────────────────────────────────
      // Client: 确认支付 (POST /api/application/:no/confirm-payment)
      // ──────────────────────────────────────────────
      if (pathname.match(/^\/api\/application\/[^\/]+\/confirm-payment$/) && request.method === 'POST') {
        const applicationNo = pathname.split('/')[3];
        await env.DB.prepare(`
          UPDATE applications SET status = 'PAID', paidAt = ? WHERE applicationNo = ? AND status = 'APPROVED'
        `).bind(new Date().toISOString(), applicationNo).run();

        return jsonResponse({ success: true });
      }

      // ──────────────────────────────────────────────
      // Underwriting: 完成投保 (POST /api/application/:no/complete)
      // ──────────────────────────────────────────────
      if (pathname.match(/^\/api\/application\/[^\/]+\/complete$/) && request.method === 'POST') {
        const applicationNo = pathname.split('/')[3];
        await env.DB.prepare(`
          UPDATE applications SET status = 'COMPLETED', completedAt = ? WHERE applicationNo = ? AND status = 'PAID'
        `).bind(new Date().toISOString(), applicationNo).run();

        return jsonResponse({ success: true });
      }

      // ──────────────────────────────────────────────
      // 验证码接口（保持原样）
      // ──────────────────────────────────────────────
      if (pathname === '/api/verify/send' && request.method === 'POST') {
        const { applicationNo } = await request.json();
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        await env.POLICY_KV.put(`verify:${applicationNo}`, JSON.stringify({ code, at: new Date().toISOString() }), { expirationTtl: 300 });
        return jsonResponse({ success: true, code });
      }

      if (pathname === '/api/verify/check' && request.method === 'POST') {
        const { applicationNo, code } = await request.json();
        const raw = await env.POLICY_KV.get(`verify:${applicationNo}`);
        if (!raw) throw new Error('验证码过期');
        const saved = JSON.parse(raw);
        if (saved.code !== code) throw new Error('验证码无效');

        await env.DB.prepare(`UPDATE applications SET verifiedAt = ? WHERE applicationNo = ?`)
          .bind(new Date().toISOString(), applicationNo).run();

        return jsonResponse({ success: true });
      }

      // 404
      return jsonResponse({ error: 'Not Found' }, 404);
    } catch (err) {
      return jsonResponse({ success: false, error: err.message }, 500);
    }
  }
};

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}