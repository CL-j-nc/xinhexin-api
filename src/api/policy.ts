// Policy Service API - 保单服务中心
// 提供保单查询、详情、批改保全等功能

import type { Env } from "../index";

interface PolicySearchResult {
    policyNo: string;
    status: string;
    ownerName: string;
    plate: string;
    effectiveDate: string;
    expiryDate: string;
}

interface EndorsementRequest {
    policyNo: string;
    type: string;
    changeData: Record<string, unknown>;
    reason?: string;
}

// 保单搜索
async function searchPolicies(
    env: Env,
    keyword: string
): Promise<PolicySearchResult[]> {
    const { results } = await env.DB.prepare(
        `
    SELECT policy_no, status, owner_name, plate, effective_date, expiry_date
    FROM policy
    WHERE policy_no LIKE ? OR owner_name LIKE ? OR owner_id_card LIKE ? OR plate LIKE ? OR vin LIKE ?
    ORDER BY issued_at DESC
    LIMIT 50
    `
    )
        .bind(
            `%${keyword}%`,
            `%${keyword}%`,
            `%${keyword}%`,
            `%${keyword}%`,
            `%${keyword}%`
        )
        .all();

    return (results || []).map((row: any) => ({
        policyNo: row.policy_no,
        status: row.status,
        ownerName: row.owner_name,
        plate: row.plate,
        effectiveDate: row.effective_date,
        expiryDate: row.expiry_date,
    }));
}

// 保单详情
async function getPolicyDetail(env: Env, policyNo: string) {
    const policy = await env.DB.prepare(
        `
    SELECT * FROM policy WHERE policy_no = ?
    `
    )
        .bind(policyNo)
        .first<any>();

    if (!policy) return null;

    // 获取关联的批改记录
    const { results: endorsements } = await env.DB.prepare(
        `
    SELECT endorsement_no, type, status, requested_at, processed_at
    FROM endorsement
    WHERE policy_no = ?
    ORDER BY requested_at DESC
    LIMIT 10
    `
    )
        .bind(policyNo)
        .all();

    // 获取关联的理赔记录
    const { results: claims } = await env.DB.prepare(
        `
    SELECT claim_no, status, claim_amount, approved_amount, created_at
    FROM claim
    WHERE policy_no = ?
    ORDER BY created_at DESC
    LIMIT 10
    `
    )
        .bind(policyNo)
        .all();

    // 解析coverages_data
    let coverages = [];
    try {
        coverages = JSON.parse(policy.coverages_data || "[]");
    } catch {
        coverages = [];
    }

    return {
        policyNo: policy.policy_no,
        applicationNo: policy.application_no,
        status: policy.status,
        effectiveDate: policy.effective_date,
        expiryDate: policy.expiry_date,
        plate: policy.plate,
        vin: policy.vin,
        brand: policy.brand,
        vehicleType: policy.vehicle_type,
        ownerName: policy.owner_name,
        ownerIdCard: policy.owner_id_card,
        ownerPhone: policy.owner_phone,
        coverages,
        totalPremium: policy.total_premium,
        issuedAt: policy.issued_at,
        endorsements: endorsements || [],
        claims: claims || [],
    };
}

// 保单状态查询（简化版，用于轻量级查询）
async function getPolicyStatus(env: Env, policyNo: string) {
    const policy = await env.DB.prepare(
        `
    SELECT policy_no, status, effective_date, expiry_date
    FROM policy WHERE policy_no = ?
    `
    )
        .bind(policyNo)
        .first<any>();

    if (!policy) return null;

    // 判断是否在有效期内
    const now = new Date();
    const effective = new Date(policy.effective_date);
    const expiry = new Date(policy.expiry_date);
    const isInForce = now >= effective && now <= expiry && policy.status === "ACTIVE";

    return {
        policyNo: policy.policy_no,
        status: policy.status,
        effectiveDate: policy.effective_date,
        expiryDate: policy.expiry_date,
        isInForce,
    };
}

// 提交批改申请
async function submitEndorsement(
    env: Env,
    request: EndorsementRequest
) {
    const endorsementNo = `END-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const now = new Date().toISOString();

    // 验证保单存在且有效
    const policy = await env.DB.prepare(
        `SELECT status FROM policy WHERE policy_no = ?`
    )
        .bind(request.policyNo)
        .first<any>();

    if (!policy) {
        return { success: false, error: "保单不存在" };
    }

    if (policy.status !== "ACTIVE") {
        return { success: false, error: "保单状态不允许批改" };
    }

    // 插入批改申请
    await env.DB.prepare(
        `
    INSERT INTO endorsement (endorsement_no, policy_no, type, change_data, status, requested_at)
    VALUES (?, ?, ?, ?, 'PENDING', ?)
    `
    )
        .bind(
            endorsementNo,
            request.policyNo,
            request.type,
            JSON.stringify(request.changeData),
            now
        )
        .run();

    // 记录审计日志
    await logAudit(env, "ENDORSEMENT_SUBMIT", "endorsement", endorsementNo, {
        policyNo: request.policyNo,
        type: request.type,
    });

    return {
        success: true,
        endorsementNo,
        message: "批改申请已提交，请等待审核",
    };
}

// 查询批改详情
async function getEndorsementDetail(env: Env, endorsementNo: string) {
    const endorsement = await env.DB.prepare(
        `SELECT * FROM endorsement WHERE endorsement_no = ?`
    )
        .bind(endorsementNo)
        .first<any>();

    if (!endorsement) return null;

    let changeData = {};
    try {
        changeData = JSON.parse(endorsement.change_data || "{}");
    } catch {
        changeData = {};
    }

    return {
        endorsementNo: endorsement.endorsement_no,
        policyNo: endorsement.policy_no,
        type: endorsement.type,
        changeData,
        status: endorsement.status,
        premiumAdjustment: endorsement.premium_adjustment,
        requestedAt: endorsement.requested_at,
        processedAt: endorsement.processed_at,
    };
}

// 审计日志
async function logAudit(
    env: Env,
    action: string,
    targetType: string,
    targetId: string,
    details: Record<string, unknown>
) {
    try {
        await env.DB.prepare(
            `
      INSERT INTO audit_log (action, target_type, target_id, operator_type, details, created_at)
      VALUES (?, ?, ?, 'CUSTOMER', ?, ?)
      `
        )
            .bind(action, targetType, targetId, JSON.stringify(details), new Date().toISOString())
            .run();
    } catch (e) {
        console.error("Audit log failed:", e);
    }
}

// 路由处理
export async function handlePolicyRoutes(
    request: Request,
    env: Env,
    pathname: string
): Promise<Response | null> {
    // GET /api/policy/search?keyword=xxx
    if (pathname === "/api/policy/search" && request.method === "GET") {
        const url = new URL(request.url);
        const keyword = url.searchParams.get("keyword")?.trim() || "";

        if (!keyword) {
            return jsonResponse({ error: "请输入搜索关键词" }, 400);
        }

        const results = await searchPolicies(env, keyword);
        return jsonResponse({ success: true, data: results });
    }

    // GET /api/policy/:policyNo
    const policyDetailMatch = pathname.match(/^\/api\/policy\/([A-Z0-9-]+)$/);
    if (policyDetailMatch && request.method === "GET") {
        const policyNo = policyDetailMatch[1];
        const detail = await getPolicyDetail(env, policyNo);

        if (!detail) {
            return jsonResponse({ error: "保单不存在" }, 404);
        }

        return jsonResponse({ success: true, data: detail });
    }

    // GET /api/policy/:policyNo/status
    const policyStatusMatch = pathname.match(/^\/api\/policy\/([A-Z0-9-]+)\/status$/);
    if (policyStatusMatch && request.method === "GET") {
        const policyNo = policyStatusMatch[1];
        const status = await getPolicyStatus(env, policyNo);

        if (!status) {
            return jsonResponse({ error: "保单不存在" }, 404);
        }

        return jsonResponse({ success: true, data: status });
    }

    // POST /api/endorsement/submit
    if (pathname === "/api/endorsement/submit" && request.method === "POST") {
        const body = await request.json().catch(() => ({})) as EndorsementRequest;

        if (!body.policyNo || !body.type || !body.changeData) {
            return jsonResponse({ error: "缺少必要参数" }, 400);
        }

        const result = await submitEndorsement(env, body);
        return jsonResponse(result, result.success ? 200 : 400);
    }

    // GET /api/endorsement/:endorsementNo
    const endorsementMatch = pathname.match(/^\/api\/endorsement\/([A-Z0-9-]+)$/);
    if (endorsementMatch && request.method === "GET") {
        const endorsementNo = endorsementMatch[1];
        const detail = await getEndorsementDetail(env, endorsementNo);

        if (!detail) {
            return jsonResponse({ error: "批改单不存在" }, 404);
        }

        return jsonResponse({ success: true, data: detail });
    }

    return null;
}

function jsonResponse(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        },
    });
}
