export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // ===== CORS =====
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: cors() });
        }

        // ===== Health =====
        if (url.pathname === '/status') {
            return json({ status: 'ok' });
        }

        // =====================================================
        // 1️⃣ Salesman：记录投保意向
        // =====================================================
        if (url.pathname === '/api/intent' && request.method === 'POST') {
            const body = await request.json();

            const intentNo = generateNo('INTENT');
            const now = nowISO();

            const record = {
                intentNo,
                status: 'INTENT_RECEIVED',
                intentAt: now,
                applicationNo: null,
                policyNo: null,
                data: body
            };

            await env.POLICY_KV.put(`intent:${intentNo}`, JSON.stringify(record));

            return json({ success: true, intentNo, intentAt: now });
        }

        // =====================================================
        // 2️⃣ 投保确认（Applied）
        // =====================================================
        if (url.pathname === '/api/application/apply' && request.method === 'POST') {
            const body = await request.json();
            const now = nowISO();

            const applicationNo = generateNo('APP');

            const record = {
                applicationNo,
                status: 'APPLIED',
                applyAt: now,
                underwritingStartAt: null,
                underwritingAt: null,
                payConfirmedAt: null,
                policyPrintAt: null,
                policyNo: null,
                data: body
            };

            await env.POLICY_KV.put(
                `application:${applicationNo}`,
                JSON.stringify(record)
            );

            // D1 persistence
            await env.DB.prepare(`
                INSERT INTO application (
                    application_no, status,
                    apply_at,
                    holder_name, insured_name,
                    plate_no, vin, engine_no
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
                applicationNo,
                'APPLIED',
                now,
                body.proposer?.name || '',
                body.insured?.name || '',
                body.vehicle?.plate || '',
                body.vehicle?.vin || '',
                body.vehicle?.engineNo || ''
            ).run();

            return json({
                success: true,
                applicationNo,
                applyAt: now
            });
        }

        // =====================================================
        // 3️⃣ 核保中（未出码）
        // =====================================================
        if (url.pathname === '/api/underwriting/start' && request.method === 'POST') {
            const { applicationNo } = await request.json();

            const raw = await env.POLICY_KV.get(`application:${applicationNo}`);
            if (!raw) return json({ error: 'application_not_found' }, 404);

            const record = JSON.parse(raw);
            record.status = 'UNDERWRITING';
            record.underwritingStartAt = nowISO();

            await env.POLICY_KV.put(
                `application:${applicationNo}`,
                JSON.stringify(record)
            );

            // D1 update
            await env.DB.prepare(`
                UPDATE application
                SET status = ?, underwriting_start_at = ?
                WHERE application_no = ?
            `).bind(
                'UNDERWRITING',
                record.underwritingStartAt,
                applicationNo
            ).run();

            return json({ success: true, status: record.status });
        }

        // =====================================================
        // 4️⃣ 核保通过（出码）
        // =====================================================
        if (url.pathname === '/api/underwriting/approve' && request.method === 'POST') {
            const { applicationNo, coverages, premiumSummary } = await request.json();

            const raw = await env.POLICY_KV.get(`application:${applicationNo}`);
            if (!raw) return json({ error: 'application_not_found' }, 404);

            const record = JSON.parse(raw);

            record.coverages = coverages;
            record.premiumSummary = premiumSummary;
            record.status = 'UNDERWRITTEN';
            record.underwritingAt = nowISO();
            record.paymentCode = generateNo('PAY');

            await env.POLICY_KV.put(
                `application:${applicationNo}`,
                JSON.stringify(record)
            );

            // D1 update
            await env.DB.prepare(`
                UPDATE application
                SET status = ?, underwriting_at = ?
                WHERE application_no = ?
            `).bind(
                'UNDERWRITTEN',
                record.underwritingAt,
                applicationNo
            ).run();

            return json({
                success: true,
                paymentCode: record.paymentCode
            });
        }

        // =====================================================
        // 5️⃣ 成功承保（收付确认 + 打印）
        // =====================================================
        if (url.pathname === '/api/policy/issue' && request.method === 'POST') {
            const { applicationNo } = await request.json();

            const raw = await env.POLICY_KV.get(`application:${applicationNo}`);
            if (!raw) return json({ error: 'application_not_found' }, 404);

            const record = JSON.parse(raw);
            const now = nowISO();

            record.status = 'ISSUED';
            record.payConfirmedAt = now;
            record.policyPrintAt = now;
            record.policyNo = generateNo('CLPC');

            await env.POLICY_KV.put(
                `policy:${record.policyNo}`,
                JSON.stringify(record)
            );

            // D1 update
            await env.DB.prepare(`
                UPDATE application
                SET status = ?, policy_no = ?, pay_confirmed_at = ?, policy_print_at = ?
                WHERE application_no = ?
            `).bind(
                'ISSUED',
                record.policyNo,
                now,
                now,
                applicationNo
            ).run();

            return json({
                success: true,
                policyNo: record.policyNo,
                issuedAt: now
            });
        }

        // =====================================================
        // Salesman 查询投保/核保状态
        // =====================================================
        if (url.pathname === '/api/application/search' && request.method === 'GET') {
            const keyword = url.searchParams.get('keyword') || '';

            const list = [];

            const keys = await env.POLICY_KV.list({ prefix: 'application:' });
            for (const key of keys.keys) {
                const raw = await env.POLICY_KV.get(key.name);
                if (!raw) continue;
                const rec = JSON.parse(raw);

                const data = rec.data || {};
                const proposer = data.proposer || {};
                const insured = data.insured || {};
                const vehicle = data.vehicle || {};

                const hit =
                    proposer.name?.includes(keyword) ||
                    insured.name?.includes(keyword) ||
                    vehicle.plate?.includes(keyword) ||
                    vehicle.vin?.includes(keyword) ||
                    vehicle.engineNo?.includes(keyword);

                if (hit) {
                    list.push({
                        applicationNo: rec.applicationNo,
                        status: rec.status,
                        applyAt: rec.applyAt,
                        underwritingAt: rec.underwritingAt || null,
                        policyNo: rec.policyNo || null
                    });
                }
            }

            return json(list);
        }


        // =====================================================
        // 📱 手机验证码（由核保端生成）
        // =====================================================
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

        if (url.pathname === "/api/verify/check" && request.method === "POST") {
            const { applicationNo, code } = await request.json();
            const raw = await env.POLICY_KV.get(`verify:${applicationNo}`);
            if (!raw) return json({ success: false }, 400);

            const saved = JSON.parse(raw);
            return json({ success: saved.code === code });
        }

        return json({ error: 'not_found' }, 404);
    }
};

// ================= utils =================

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...cors() }
    });
}

function cors() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };
}

function nowISO() {
    return new Date().toISOString();
}

function generateNo(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}