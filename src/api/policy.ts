import { jsonResponse, now, safeJsonParse } from "..";

interface Env {
    DB: D1Database;
    POLICY_KV: KVNamespace;
}

// Module 1: Policy Lookup
export async function handlePolicyLookup(request: Request, env: Env) {
    const url = new URL(request.url);
    const queryType = url.searchParams.get("queryType"); // policyNo | idNo | plateNo
    const queryValue = url.searchParams.get("queryValue");

    if (!queryType || !queryValue) {
        return jsonResponse({
            resultCode: "INVALID",
            message: "Missing query parameters",
            matchCount: 0
        }, 400);
    }

    try {
        let sql = "";
        let params: any[] = [];

        // Search logic: Join policy -> proposal -> vehicle
        if (queryType === "policyNo") {
            sql = `SELECT * FROM policy WHERE policy_id = ?`;
            params = [queryValue];
        } else if (queryType === "plateNo") {
            sql = `SELECT p.* FROM policy p 
               JOIN vehicle_underwritten v ON p.proposal_id = v.proposal_id 
               WHERE v.plate_number = ?`;
            params = [queryValue];
        } else if (queryType === "idNo") {
            // ID No is in JSON blob in proposal table. Heavy scan? 
            // For strictly "Policy Service", we might assume we index ID No or restrict this.
            // For MVP/Demo correctness on small data, we scan proposal table? No, slow.
            // We will restrict ID search to strict match if we stored it separate.
            // For now, return NOT_SUPPORTED for idNo if not indexed, or scan reasonable limit?
            // Let's assume we can't efficiently search ID No yet without index.
            // Return blank for now to avoid false promises, or Mock for specific test user?
            return jsonResponse({
                resultCode: "NOT_FOUND",
                message: "ID Number search not available yet",
                matchCount: 0
            });
        } else {
            return jsonResponse({ resultCode: "INVALID", message: "Invalid queryType", matchCount: 0 }, 400);
        }

        const results = await env.DB.prepare(sql).bind(...params).all<any>();
        const policies = results.results || [];

        if (policies.length === 0) {
            return jsonResponse({
                resultCode: "NOT_FOUND",
                matchCount: 0,
                message: "No policy found matching criteria"
            });
        }

        // Return the first match (or list if UI supports list, strict spec says matchCount)
        // spec: "policyId (if success)"
        const policy = policies[0];

        return jsonResponse({
            resultCode: "SUCCESS",
            policyId: policy.policy_id, // "policy_id" in DB
            matchCount: policies.length,
            message: "Policy found"
        });

    } catch (e: any) {
        return jsonResponse({
            resultCode: "ERROR",
            message: e.message || "Internal Error",
            matchCount: 0
        }, 500);
    }
}

// Module 2: Policy Summary
export async function handlePolicySummary(request: Request, env: Env, policyId: string) {
    const policy = await env.DB.prepare("SELECT * FROM policy WHERE policy_id = ?").bind(policyId).first<any>();
    if (!policy) return jsonResponse({ error: "Not Found" }, 404);

    // Get details from proposal to populate summary
    const proposal = await env.DB.prepare("SELECT proposal_data FROM proposal WHERE proposal_id = ?").bind(policy.proposal_id).first<any>();
    const data = proposal?.proposal_data ? safeJsonParse(proposal.proposal_data) : {};

    // Map status
    const dbStatus = policy.policy_status; // EFFECTIVE, EXPIRED...

    return jsonResponse({
        policyNo: policy.policy_id, // Use ID as No for now
        productName: "机动车商业保险 (2024版)", // Hardcoded or from data
        insuredName: data?.insured?.name || "Unknown",
        policyPeriod: `${new Date(policy.policy_effective_date).toLocaleDateString()} - ${new Date(policy.policy_expiry_date).toLocaleDateString()}`,
        policyStatus: dbStatus // "EFFECTIVE"
    });
}

// Module 3: Status & Risk
export async function handlePolicyStatus(request: Request, env: Env, policyId: string) {
    const policy = await env.DB.prepare("SELECT * FROM policy WHERE policy_id = ?").bind(policyId).first<any>();
    if (!policy) return jsonResponse({ error: "Not Found" }, 404);

    const nowTime = Date.now();
    const expiry = new Date(policy.policy_expiry_date).getTime();

    let status = policy.policy_status;
    let riskFlag = "NONE";
    let restrictions: string[] = [];
    let notices: string[] = [];

    // Logic: Expired?
    if (status === "EFFECTIVE" && nowTime > expiry) {
        status = "EXPIRED";
    }

    // Logic: Risk
    if (status === "LAPSED" || status === "TERMINATED") {
        riskFlag = "BLOCKED";
        restrictions.push("Policy is not active");
    } else if (status === "EXPIRED") {
        riskFlag = "WARNING";
        notices.push("Policy has expired, please renew immediately");
    } else {
        notices.push("Policy is in good standing");
    }

    // Coverage Summary (Mock/Static from data)
    // In real system, query coverage table.
    const coverageSummary = [
        { name: "机动车损失保险", amount: "15.5万", status: "EFFECTIVE" },
        { name: "第三者责任保险", amount: "200万", status: "EFFECTIVE" }
    ];

    return jsonResponse({
        policyStatus: status,
        riskFlag,
        coverageSummary,
        restrictions,
        notices
    });
}

// Module 4: Available Actions
export async function handleAvailableActions(request: Request, env: Env, policyId: string) {
    // 1. Get Status
    const statusRes = await handlePolicyStatus(request, env, policyId);
    const statusData = await statusRes.json() as any; // Re-use logic
    const status = statusData.policyStatus;

    const actions = [];

    // Action: RENEWAL
    // Enabled if EXPIRED or within 30 days of expiry
    // Simple logic: Always show, but disable if too early?
    actions.push({
        actionCode: "RENEWAL",
        actionName: "立即续保",
        enabled: status === "EXPIRED" || status === "EFFECTIVE",
        disabledReason: status === "TERMINATED" ? "Policy terminated" : undefined
    });

    // Action: CLAIM
    // Enabled if EFFECTIVE
    actions.push({
        actionCode: "CLAIM_REPORT",
        actionName: "由我报案", // Self-service claim
        enabled: status === "EFFECTIVE",
        disabledReason: status !== "EFFECTIVE" ? "Policy not effective" : undefined
    });

    // Action: MODIFY
    actions.push({
        actionCode: "MODIFY_INFO",
        actionName: "信息变更",
        enabled: status === "EFFECTIVE",
        disabledReason: status !== "EFFECTIVE" ? "Policy invalid" : undefined
    });

    return jsonResponse(actions); // Returns Array directly
}

// Module 5: Execute Action
export async function handlePolicyAction(request: Request, env: Env, actionCode: string) {
    const payload = await request.json() as any;
    const { policyId } = payload;

    if (!policyId) return jsonResponse({ success: false, message: "Missing policyId" }, 400);

    const traceId = `TRACE-${crypto.randomUUID()}`;

    // Mock execution
    // In real system, this triggers workflow, DB update, etc.
    // For "Service Portal" demo compliance:

    if (actionCode === "RENEWAL") {
        // Create renewal proposal...
        return jsonResponse({
            success: true,
            resultStatus: "INITIATED",
            message: "Renewal application started",
            traceId,
            nextSuggestion: "Please complete payment"
        });
    }

    if (actionCode === "CLAIM_REPORT") {
        return jsonResponse({
            success: true,
            resultStatus: "REPORTED",
            message: "Claim case created successfully",
            traceId
        });
    }

    return jsonResponse({
        success: false,
        resultStatus: "UNKNOWN_ACTION",
        message: "Action not supported",
        traceId
    });
}

export async function handlePolicyRoutes(request: Request, env: Env, pathname: string) {
    // GET /api/policy/query
    if (pathname === "/api/policy/query" && request.method === "GET") {
        return handlePolicyLookup(request, env);
    }

    // ID based routes
    const idMatch = pathname.match(/^\/api\/policy\/([^\/]+)\/(summary|status|available-actions)$/);
    if (idMatch && request.method === "GET") {
        const id = idMatch[1];
        const type = idMatch[2];
        if (type === "summary") return handlePolicySummary(request, env, id);
        if (type === "status") return handlePolicyStatus(request, env, id);
        if (type === "available-actions") return handleAvailableActions(request, env, id);
    }

    // Action Execute
    const actionMatch = pathname.match(/^\/api\/policy\/action\/([^\/]+)$/);
    if (actionMatch && request.method === "POST") {
        return handlePolicyAction(request, env, actionMatch[1]);
    }

    return null; // Not handled
}
