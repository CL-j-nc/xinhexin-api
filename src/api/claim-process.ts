// Claim Process API - 理赔中心
// 提供理赔进度查询、材料通知、结果查询功能

import type { Env } from "../index";

// 理赔状态映射（客户可见）
const claimStatusDisplay: Record<string, string> = {
    reported: "已报案",
    materials_required: "待补材料",
    reviewing: "审核中",
    approved: "已批准",
    denied: "未通过",
    closed: "已结案",
};

// 获取理赔进度
async function getClaimProgress(env: Env, claimNo: string) {
    const claim = await env.DB.prepare(
        `
    SELECT claim_no, report_no, policy_no, status, claim_amount, approved_amount,
           created_at, materials_requested_at, review_started_at, decided_at, closed_at
    FROM claim WHERE claim_no = ?
    `
    )
        .bind(claimNo)
        .first<any>();

    if (!claim) return null;

    // 构建进度时间线
    const timeline = buildTimeline(claim);

    // 获取材料提交状态概览
    const { results: docs } = await env.DB.prepare(
        `
    SELECT status, COUNT(*) as count
    FROM claim_document
    WHERE claim_no = ?
    GROUP BY status
    `
    )
        .bind(claimNo)
        .all();

    const docSummary = {
        total: 0,
        pending: 0,
        submitted: 0,
        approved: 0,
        rejected: 0,
    };

    for (const doc of docs || []) {
        const d = doc as any;
        docSummary.total += d.count;
        if (d.status === "pending") docSummary.pending = d.count;
        if (d.status === "submitted") docSummary.submitted = d.count;
        if (d.status === "approved") docSummary.approved = d.count;
        if (d.status === "rejected") docSummary.rejected = d.count;
    }

    return {
        claimNo: claim.claim_no,
        reportNo: claim.report_no,
        policyNo: claim.policy_no,
        status: claim.status,
        statusDisplay: claimStatusDisplay[claim.status] || claim.status,
        timeline,
        documentSummary: docSummary,
        // 不暴露内部金额信息，除非已决定
        claimAmount: claim.status === "approved" || claim.status === "closed"
            ? claim.approved_amount
            : null,
    };
}

// 构建时间线
function buildTimeline(claim: any) {
    const timeline: { stage: string; status: string; time: string | null }[] = [];

    timeline.push({
        stage: "报案",
        status: "completed",
        time: claim.created_at,
    });

    if (claim.materials_requested_at) {
        timeline.push({
            stage: "材料收集",
            status: claim.status === "materials_required" ? "current" : "completed",
            time: claim.materials_requested_at,
        });
    }

    if (claim.review_started_at) {
        timeline.push({
            stage: "审核",
            status: claim.status === "reviewing" ? "current" : "completed",
            time: claim.review_started_at,
        });
    }

    if (claim.decided_at) {
        timeline.push({
            stage: claim.status === "approved" ? "批准" : "决定",
            status: "completed",
            time: claim.decided_at,
        });
    }

    if (claim.closed_at) {
        timeline.push({
            stage: "结案",
            status: "completed",
            time: claim.closed_at,
        });
    }

    // 添加待完成阶段
    const stages = ["报案", "材料收集", "审核", "决定", "结案"];
    const completedStages = timeline.map((t) =>
        t.stage === "批准" ? "决定" : t.stage
    );

    for (const stage of stages) {
        if (!completedStages.includes(stage)) {
            timeline.push({
                stage,
                status: "pending",
                time: null,
            });
        }
    }

    return timeline;
}

// 获取材料补交通知
async function getClaimMaterials(env: Env, claimNo: string) {
    const { results } = await env.DB.prepare(
        `
    SELECT doc_type, doc_name, is_required, status, reject_reason, requested_at, submitted_at, reviewed_at
    FROM claim_document
    WHERE claim_no = ?
    ORDER BY is_required DESC, requested_at ASC
    `
    )
        .bind(claimNo)
        .all();

    if (!results || results.length === 0) {
        return null;
    }

    const materials = (results || []).map((doc: any) => ({
        docType: doc.doc_type,
        docName: doc.doc_name,
        isRequired: !!doc.is_required,
        status: doc.status,
        statusDisplay: getMaterialStatusDisplay(doc.status),
        rejectReason: doc.reject_reason,
        requestedAt: doc.requested_at,
        submittedAt: doc.submitted_at,
    }));

    // 计算整体提交状态
    const pendingCount = materials.filter((m) => m.status === "pending").length;
    const rejectedCount = materials.filter((m) => m.status === "rejected").length;

    let overallStatus = "complete";
    let message = "所有材料已提交完成";

    if (pendingCount > 0) {
        overallStatus = "incomplete";
        message = `还有 ${pendingCount} 项材料待提交`;
    } else if (rejectedCount > 0) {
        overallStatus = "rejected";
        message = `有 ${rejectedCount} 项材料需要重新提交`;
    }

    return {
        claimNo,
        materials,
        overallStatus,
        message,
        uploadInstructions: getUploadInstructions(),
    };
}

// 获取材料状态显示文本
function getMaterialStatusDisplay(status: string): string {
    const map: Record<string, string> = {
        pending: "待提交",
        submitted: "已提交",
        approved: "已通过",
        rejected: "需重新提交",
    };
    return map[status] || status;
}

// 获取上传说明
function getUploadInstructions(): string {
    return `请将以下材料准备好后，通过以下方式提交：
1. 邮寄至公司理赔部门（地址请咨询客服）
2. 前往最近的服务网点提交
3. 扫描或拍照后发送至理赔专员

【温馨提示】
- 请确保材料清晰可辨
- 复印件需加盖公章或本人签字
- 如有疑问，请联系客服热线`;
}

// 获取理赔结果
async function getClaimResult(env: Env, claimNo: string) {
    const claim = await env.DB.prepare(
        `
    SELECT claim_no, status, claim_amount, approved_amount, decision_reason, decided_at, closed_at
    FROM claim WHERE claim_no = ?
    `
    )
        .bind(claimNo)
        .first<any>();

    if (!claim) return null;

    // 只有已决定的案件才返回结果
    if (!["approved", "denied", "closed"].includes(claim.status)) {
        return {
            claimNo: claim.claim_no,
            hasResult: false,
            message: "您的理赔案件正在处理中，请耐心等待",
        };
    }

    const isApproved = claim.status === "approved" ||
        (claim.status === "closed" && claim.approved_amount > 0);

    return {
        claimNo: claim.claim_no,
        hasResult: true,
        isApproved,
        approvedAmount: claim.approved_amount,
        decisionReason: claim.decision_reason || (isApproved
            ? "经审核，您的理赔申请符合保险合同约定，已予以批准。"
            : "经审核，您的理赔申请不符合保险合同约定，详情请咨询客服。"),
        decidedAt: claim.decided_at,
        closedAt: claim.closed_at,
        nextSteps: isApproved
            ? "理赔款项将在3-5个工作日内转入您指定的银行账户"
            : "如有异议，您可以在15个工作日内提出复议申请",
    };
}

// 路由处理
export async function handleClaimProcessRoutes(
    request: Request,
    env: Env,
    pathname: string
): Promise<Response | null> {
    // GET /api/claim/progress/:claimNo - 理赔进度
    const progressMatch = pathname.match(/^\/api\/claim\/progress\/([A-Z0-9-]+)$/);
    if (progressMatch && request.method === "GET") {
        const claimNo = progressMatch[1];
        const progress = await getClaimProgress(env, claimNo);

        if (!progress) {
            return jsonResponse({ error: "理赔案件不存在" }, 404);
        }

        return jsonResponse({ success: true, data: progress });
    }

    // GET /api/claim/materials/:claimNo - 材料补交通知
    const materialsMatch = pathname.match(/^\/api\/claim\/materials\/([A-Z0-9-]+)$/);
    if (materialsMatch && request.method === "GET") {
        const claimNo = materialsMatch[1];
        const materials = await getClaimMaterials(env, claimNo);

        if (!materials) {
            return jsonResponse({ error: "理赔案件不存在或无材料要求" }, 404);
        }

        return jsonResponse({ success: true, data: materials });
    }

    // GET /api/claim/result/:claimNo - 理赔结果
    const resultMatch = pathname.match(/^\/api\/claim\/result\/([A-Z0-9-]+)$/);
    if (resultMatch && request.method === "GET") {
        const claimNo = resultMatch[1];
        const result = await getClaimResult(env, claimNo);

        if (!result) {
            return jsonResponse({ error: "理赔案件不存在" }, 404);
        }

        return jsonResponse({ success: true, data: result });
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
