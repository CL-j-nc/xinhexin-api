// Claim Report API - 报案中心
// 提供报案提交、查询、更新功能

import type { Env } from "../index";

interface ClaimReportRequest {
    policyNo: string;
    claimType: "LIFE" | "MEDICAL" | "ACCIDENT" | "OTHER";
    accidentDate: string;
    accidentLocation?: string;
    accidentDescription: string;
    insuredName: string;
    insuredIdCard: string;
    insuredPhone?: string;
    reporterName: string;
    reporterPhone: string;
    reporterRelation?: string;
}

// 生成报案编号
function generateReportNo(): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const random = crypto.randomUUID().slice(0, 6).toUpperCase();
    return `RPT-${year}${month}${day}-${random}`;
}

// 验证保单并获取被保人信息
async function validatePolicy(env: Env, policyNo: string) {
    const policy = await env.DB.prepare(
        `
    SELECT policy_no, status, owner_name, owner_id_card, effective_date, expiry_date
    FROM policy WHERE policy_no = ?
    `
    )
        .bind(policyNo)
        .first<any>();

    if (!policy) {
        return { valid: false, error: "保单不存在" };
    }

    if (policy.status !== "ACTIVE") {
        return { valid: false, error: "保单状态无效，无法报案" };
    }

    const now = new Date();
    const effective = new Date(policy.effective_date);
    const expiry = new Date(policy.expiry_date);

    if (now < effective || now > expiry) {
        return { valid: false, error: "保单不在有效期内" };
    }

    return { valid: true, policy };
}

// 创建报案（草稿）
async function createClaimReport(
    env: Env,
    data: ClaimReportRequest,
    isDraft: boolean = false
) {
    // 验证保单
    const validation = await validatePolicy(env, data.policyNo);
    if (!validation.valid) {
        return { success: false, error: validation.error };
    }

    const reportNo = generateReportNo();
    const now = new Date().toISOString();
    const status = isDraft ? "draft" : "submitted";

    await env.DB.prepare(
        `
    INSERT INTO claim_report (
      report_no, policy_no, claim_type,
      accident_date, accident_location, accident_description,
      insured_name, insured_id_card, insured_phone,
      reporter_name, reporter_phone, reporter_relation,
      status, created_at, submitted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
        .bind(
            reportNo,
            data.policyNo,
            data.claimType,
            data.accidentDate,
            data.accidentLocation || null,
            data.accidentDescription,
            data.insuredName,
            data.insuredIdCard,
            data.insuredPhone || null,
            data.reporterName,
            data.reporterPhone,
            data.reporterRelation || null,
            status,
            now,
            isDraft ? null : now
        )
        .run();

    // 如果不是草稿，创建理赔记录
    if (!isDraft) {
        const claimNo = `CLM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
        await env.DB.prepare(
            `
      INSERT INTO claim (claim_no, report_no, policy_no, status, created_at)
      VALUES (?, ?, ?, 'reported', ?)
      `
        )
            .bind(claimNo, reportNo, data.policyNo, now)
            .run();

        // 创建所需材料清单
        await createRequiredDocuments(env, claimNo, data.claimType);
    }

    // 记录审计日志
    await logAudit(env, "CLAIM_REPORT_CREATE", "claim_report", reportNo, {
        policyNo: data.policyNo,
        claimType: data.claimType,
        status,
    });

    return {
        success: true,
        reportNo,
        message: isDraft
            ? "报案已保存为草稿"
            : "报案提交成功，我们会尽快处理您的报案",
    };
}

// 创建所需材料清单
async function createRequiredDocuments(
    env: Env,
    claimNo: string,
    claimType: string
) {
    const baseDocuments = [
        { docType: "ID_CARD", docName: "被保险人身份证复印件" },
        { docType: "POLICY_COPY", docName: "保单复印件" },
        { docType: "BANK_INFO", docName: "银行账户信息" },
    ];

    const typeSpecificDocs: Record<string, { docType: string; docName: string }[]> = {
        LIFE: [
            { docType: "DEATH_CERT", docName: "死亡证明" },
            { docType: "OTHER", docName: "户籍注销证明" },
        ],
        MEDICAL: [
            { docType: "MEDICAL_RECORD", docName: "病历资料" },
            { docType: "HOSPITAL_BILL", docName: "医疗费用发票原件" },
        ],
        ACCIDENT: [
            { docType: "ACCIDENT_REPORT", docName: "事故证明" },
            { docType: "MEDICAL_RECORD", docName: "诊断证明" },
        ],
        OTHER: [],
    };

    const allDocs = [...baseDocuments, ...(typeSpecificDocs[claimType] || [])];
    const now = new Date().toISOString();

    for (const doc of allDocs) {
        await env.DB.prepare(
            `
      INSERT INTO claim_document (claim_no, doc_type, doc_name, is_required, status, requested_at)
      VALUES (?, ?, ?, 1, 'pending', ?)
      `
        )
            .bind(claimNo, doc.docType, doc.docName, now)
            .run();
    }
}

// 查询报案
async function getClaimReport(env: Env, reportNo: string) {
    const report = await env.DB.prepare(
        `SELECT * FROM claim_report WHERE report_no = ?`
    )
        .bind(reportNo)
        .first<any>();

    if (!report) return null;

    // 获取关联的理赔记录
    const claim = await env.DB.prepare(
        `SELECT claim_no, status FROM claim WHERE report_no = ?`
    )
        .bind(reportNo)
        .first<any>();

    return {
        reportNo: report.report_no,
        policyNo: report.policy_no,
        claimType: report.claim_type,
        accidentDate: report.accident_date,
        accidentLocation: report.accident_location,
        accidentDescription: report.accident_description,
        insuredName: report.insured_name,
        insuredIdCard: maskIdCard(report.insured_id_card),
        insuredPhone: report.insured_phone,
        reporterName: report.reporter_name,
        reporterPhone: report.reporter_phone,
        reporterRelation: report.reporter_relation,
        status: report.status,
        rejectReason: report.reject_reason,
        createdAt: report.created_at,
        submittedAt: report.submitted_at,
        claimNo: claim?.claim_no || null,
        claimStatus: claim?.status || null,
    };
}

// 更新草稿报案
async function updateClaimReport(
    env: Env,
    reportNo: string,
    data: Partial<ClaimReportRequest>,
    submit: boolean = false
) {
    // 验证报案存在且为草稿状态
    const existing = await env.DB.prepare(
        `SELECT status FROM claim_report WHERE report_no = ?`
    )
        .bind(reportNo)
        .first<any>();

    if (!existing) {
        return { success: false, error: "报案不存在" };
    }

    if (existing.status !== "draft") {
        return { success: false, error: "只有草稿状态的报案可以修改" };
    }

    const now = new Date().toISOString();
    const newStatus = submit ? "submitted" : "draft";

    // 构建更新字段
    const updates: string[] = [];
    const values: any[] = [];

    if (data.claimType) {
        updates.push("claim_type = ?");
        values.push(data.claimType);
    }
    if (data.accidentDate) {
        updates.push("accident_date = ?");
        values.push(data.accidentDate);
    }
    if (data.accidentLocation !== undefined) {
        updates.push("accident_location = ?");
        values.push(data.accidentLocation);
    }
    if (data.accidentDescription) {
        updates.push("accident_description = ?");
        values.push(data.accidentDescription);
    }

    updates.push("status = ?");
    values.push(newStatus);

    if (submit) {
        updates.push("submitted_at = ?");
        values.push(now);
    }

    values.push(reportNo);

    await env.DB.prepare(
        `UPDATE claim_report SET ${updates.join(", ")} WHERE report_no = ?`
    )
        .bind(...values)
        .run();

    // 如果提交，创建理赔记录
    if (submit) {
        const report = await env.DB.prepare(
            `SELECT policy_no, claim_type FROM claim_report WHERE report_no = ?`
        )
            .bind(reportNo)
            .first<any>();

        const claimNo = `CLM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
        await env.DB.prepare(
            `
      INSERT INTO claim (claim_no, report_no, policy_no, status, created_at)
      VALUES (?, ?, ?, 'reported', ?)
      `
        )
            .bind(claimNo, reportNo, report.policy_no, now)
            .run();

        await createRequiredDocuments(env, claimNo, report.claim_type);
    }

    return {
        success: true,
        reportNo,
        message: submit ? "报案提交成功" : "报案草稿已更新",
    };
}

// 辅助函数：遮蔽身份证号
function maskIdCard(idCard: string): string {
    if (!idCard || idCard.length < 8) return idCard;
    return idCard.slice(0, 4) + "****" + idCard.slice(-4);
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
export async function handleClaimReportRoutes(
    request: Request,
    env: Env,
    pathname: string
): Promise<Response | null> {
    // POST /api/claim/report - 创建报案
    if (pathname === "/api/claim/report" && request.method === "POST") {
        const body = (await request.json().catch(() => ({}))) as ClaimReportRequest & {
            isDraft?: boolean;
        };

        // 验证必填字段
        if (
            !body.policyNo ||
            !body.claimType ||
            !body.accidentDate ||
            !body.accidentDescription ||
            !body.insuredName ||
            !body.insuredIdCard ||
            !body.reporterName ||
            !body.reporterPhone
        ) {
            return jsonResponse({ error: "请填写完整报案信息" }, 400);
        }

        const result = await createClaimReport(env, body, body.isDraft);
        return jsonResponse(result, result.success ? 200 : 400);
    }

    // GET /api/claim/report/:reportNo - 查询报案
    const reportMatch = pathname.match(/^\/api\/claim\/report\/([A-Z0-9-]+)$/);
    if (reportMatch && request.method === "GET") {
        const reportNo = reportMatch[1];
        const report = await getClaimReport(env, reportNo);

        if (!report) {
            return jsonResponse({ error: "报案不存在" }, 404);
        }

        return jsonResponse({ success: true, data: report });
    }

    // PUT /api/claim/report/:reportNo - 更新报案
    const updateMatch = pathname.match(/^\/api\/claim\/report\/([A-Z0-9-]+)$/);
    if (updateMatch && request.method === "PUT") {
        const reportNo = updateMatch[1];
        const body = (await request.json().catch(() => ({}))) as Partial<ClaimReportRequest> & {
            submit?: boolean;
        };

        const result = await updateClaimReport(env, reportNo, body, body.submit);
        return jsonResponse(result, result.success ? 200 : 400);
    }

    return null;
}

function jsonResponse(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        },
    });
}
