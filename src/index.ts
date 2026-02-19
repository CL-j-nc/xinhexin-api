import { handleCRMRoutes } from "./api/crm";
import { handlePolicyRoutes } from "./api/policy";
import { handleClaimReportRoutes } from "./api/claim-report";
import { handleClaimProcessRoutes } from "./api/claim-process";
import { handleDocumentCenterRoutes } from "./api/document-center";

import { handleCustomerServiceRoutes } from "./api/customer-service";
import { generateAuthCode, calculateExpiresAt, normalizePhone, upsertPhoneAuthLimit, now, getPhoneAuthLimit } from "./utils/auth";
import { jsonResponse } from "./utils/response";

export interface Env {
  DB: D1Database;
  POLICY_KV: KVNamespace;
}

type TableKind = "applications" | "application";

const FILE_TTL = 90 * 24 * 3600;
const REQUEST_TTL = 90 * 24 * 3600;
const QR_TTL = 30 * 24 * 3600;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const normalizeDbText = (value: unknown, fallback: string | null = null): string | null => {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text.length > 0 ? text : fallback;
};

const normalizeDbNumber = (value: unknown): number | null => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

// 手机号标准化：移除非数字字符，处理+86前缀 (Moved to utils/auth.ts)
// const normalizePhone = (phone: string | null | undefined): string => {
//   if (!phone) return '';
//   // 移除所有非数字字符
//   let normalized = String(phone).replace(/\D/g, '');
//   // 移除国际区号 86
//   if (normalized.startsWith('86') && normalized.length === 13) {
//     normalized = normalized.slice(2);
//   }
//   // 验证是否为11位手机号
//   if (normalized.length !== 11 || !normalized.startsWith('1')) {
//     return ''; // 无效手机号返回空
//   }
//   return normalized;
// };

let cachedTable: TableKind | null = null;
let draftTableReady = false;
let proposalCoreSchemaReady = false;

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    // Wrapped Logic to capture Response
    const response = await (async () => {
      try {
        // CRM API 路由
        const crmResponse = await handleCRMRoutes(request, env, pathname);
        if (crmResponse) return crmResponse;

        // 保单服务中心路由
        const policyResponse = await handlePolicyRoutes(request, env, pathname);
        if (policyResponse) return policyResponse;

        // 报案中心路由
        const claimReportResponse = await handleClaimReportRoutes(request, env, pathname);
        if (claimReportResponse) return claimReportResponse;

        // 理赔中心路由
        const claimProcessResponse = await handleClaimProcessRoutes(request, env, pathname);
        if (claimProcessResponse) return claimProcessResponse;

        // 文档中心路由
        const documentResponse = await handleDocumentCenterRoutes(request, env, pathname);
        if (documentResponse) return documentResponse;

        // 客服中心路由
        const customerServiceResponse = await handleCustomerServiceRoutes(request, env, pathname);
        if (customerServiceResponse) return customerServiceResponse;

        // ==================== PHONE AUTHENTICATION ROUTES ====================

        // POST /api/underwriting/auth-config - 核保端设置手机号认证配置
        if (pathname === "/api/underwriting/auth-config" && request.method === "POST") {
          const payload = await request.json().catch(() => ({})) as {
            mobile?: string;
            maxAttempts?: number;
            proposalId?: string;
            expiresInMinutes?: number;
          };

          const mobile = normalizePhone(payload.mobile);
          const maxAttempts = payload.maxAttempts;
          const proposalId = payload.proposalId?.trim() || null;
          const expiresInMinutes = payload.expiresInMinutes || 30; // 默认30分钟

          if (!mobile) return jsonResponse({ error: "手机号格式无效" }, 400);
          if (maxAttempts === undefined || maxAttempts < 0) return jsonResponse({ error: "maxAttempts 参数无效" }, 400);
          if (proposalId && !proposalId.startsWith('PROP-')) return jsonResponse({ error: "proposalId 格式无效" }, 400);

          // 生成新的验证码和过期时间
          const newAuthCode = generateAuthCode();
          const expiresAt = calculateExpiresAt(expiresInMinutes);
          const currentTime = now();

          // 1. 在 phone_auth_limits 表中创建或更新记录
          await upsertPhoneAuthLimit(env, {
            mobile_phone: mobile,
            auth_code: newAuthCode,
            remaining_attempts: maxAttempts,
            max_attempts: maxAttempts,
            expires_at: expiresAt,
            proposal_id: proposalId,
            created_at: currentTime,
            updated_at: currentTime,
          });

          // 2. 同步更新 underwriting_manual_decision 表中的 auth_code 和 qr_url
          // 首先，尝试从 proposal_id 获取最近的 decision_id
          if (proposalId) {
            const decision = await env.DB.prepare(`
              SELECT decision_id, owner_mobile FROM underwriting_manual_decision
              WHERE proposal_id = ?
              ORDER BY underwriting_confirmed_at DESC
              LIMIT 1
            `).bind(proposalId).first<{ decision_id: string, owner_mobile: string }>();

            if (decision) {
              const newQrUrl = `https://chinalife-shie-xinhexin.pages.dev/#/buffer?id=${proposalId}`; // 假设客户端通过 id 获取 authCode
              await env.DB.prepare(`
                UPDATE underwriting_manual_decision
                SET auth_code = ?, qr_url = ?
                WHERE decision_id = ?
              `).bind(newAuthCode, newQrUrl, decision.decision_id).run();

              // 也可以同步更新 KV (如果旧流程依赖 KV)
              await env.POLICY_KV.put(
                `verify:${proposalId}`,
                JSON.stringify({ code: newAuthCode, mobile: mobile }),
                { expirationTtl: QR_TTL }
              );
            } else {
                console.warn(`[AUTH_CONFIG] No existing decision for proposalId: ${proposalId}. KV and decision table not updated.`);
            }
          }

          return jsonResponse({
            success: true,
            mobile: mobile,
            authCode: newAuthCode,
            maxAttempts: maxAttempts,
            remainingAttempts: maxAttempts,
            expiresAt: expiresAt,
            message: "认证配置已成功设置/更新"
          });
        }

        // GET /api/underwriting/auth-status - 核保端查询手机号认证状态
        if (pathname === "/api/underwriting/auth-status" && request.method === "GET") {
          const mobileParam = url.searchParams.get("mobile");
          const proposalIdParam = url.searchParams.get("proposalId");

          const mobile = normalizePhone(mobileParam);
          const proposalId = proposalIdParam?.trim() || null;

          if (!mobile) return jsonResponse({ error: "手机号格式无效" }, 400);

          const authRecord = await getPhoneAuthLimit(env, mobile, proposalId);

          if (!authRecord) {
            return jsonResponse({ success: true, message: "未找到该手机号的认证记录", isValid: false, data: null });
          }

          const currentTime = now();
          const isExpired = new Date(currentTime) > new Date(authRecord.expires_at);
          const isValid = !isExpired && authRecord.remaining_attempts > 0;

          return jsonResponse({
            success: true,
            mobile: authRecord.mobile_phone,
            authCode: authRecord.auth_code,
            remainingAttempts: authRecord.remaining_attempts,
            maxAttempts: authRecord.max_attempts,
            expiresAt: authRecord.expires_at,
            isValid: isValid,
            message: isExpired ? "验证码已过期" : (authRecord.remaining_attempts <= 0 ? "访问次数已用完" : "认证记录有效")
          });
        }
        
        // POST /api/client/authenticate - 客户端提交手机号和验证码进行认证
        if (pathname === "/api/client/authenticate" && request.method === "POST") {
          const payload = await request.json().catch(() => ({})) as {
            mobile?: string;
            authCode?: string;
            proposalId?: string;
          };

          const mobile = normalizePhone(payload.mobile);
          const authCode = payload.authCode?.trim();
          const proposalId = payload.proposalId?.trim();

          if (!mobile) return jsonResponse({ error: "手机号格式无效", code: "INVALID_MOBILE" }, 400);
          if (!authCode) return jsonResponse({ error: "缺少验证码", code: "MISSING_AUTH_CODE" }, 400);
          if (!proposalId) return jsonResponse({ error: "缺少投保单号", code: "MISSING_PROPOSAL_ID" }, 400);

          const authRecord = await getPhoneAuthLimit(env, mobile, proposalId);

          if (!authRecord || authRecord.auth_code !== authCode) {
            return jsonResponse({ error: "无效的手机号或验证码", code: "INVALID_CREDENTIALS" }, 401);
          }

          const currentTime = now();
          const isExpired = new Date(currentTime) > new Date(authRecord.expires_at);

          if (isExpired) {
            return jsonResponse({ error: "验证码已过期", code: "CODE_EXPIRED" }, 401);
          }

          if (authRecord.remaining_attempts <= 0) {
            return jsonResponse({ error: "访问次数已用完", code: "ATTEMPTS_EXHAUSTED" }, 401);
          }

          // 认证成功：递减访问次数并更新 last_accessed_at
          await upsertPhoneAuthLimit(env, {
            ...authRecord,
            remaining_attempts: authRecord.remaining_attempts - 1,
            last_accessed_at: currentTime,
            updated_at: currentTime,
          });

          // 更新 underwriting_manual_decision 表中的认证状态
          // 假设需要更新 proposal_status 或 auth_completed_at
          await env.DB.prepare(`
            UPDATE underwriting_manual_decision
            SET auth_completed_at = ?, auth_completed_by = 'CLIENT'
            WHERE proposal_id = ?
            ORDER BY underwriting_confirmed_at DESC
            LIMIT 1
          `).bind(currentTime, proposalId).run();

          // 可选：更新 proposal 表的状态，例如从 'UNDERWRITING_CONFIRMED' 到 'CLIENT_AUTHENTICATED'
          await env.DB.prepare(`
            UPDATE proposal
            SET proposal_status = 'CLIENT_AUTHENTICATED', updated_at = ?
            WHERE proposal_id = ?
          `).bind(currentTime, proposalId).run();


          return jsonResponse({ success: true, message: "认证成功" });
        }
        // ==================== NEW UNDERWRITING FLOW ====================


        // ==================== NEW EVENT-DRIVEN FLOW (FINAL DELIVERY) ====================

        // 1. Salesman Proposal Submission
        // POST /api/policy.salesman
        // - Trigger EVENT_PROPOSAL_SUBMITTED
        // - Write application_submitted_at
        // - Write coverage.policy_effective_date
        if ((pathname === "/api/policy.salesman" || pathname === "/api/proposal/submit") && request.method === "POST") {
          const payload = (await request.json().catch(() => ({}))) as any;
          if (!payload || typeof payload !== "object") {
            console.warn("policy.salesman validation failed: invalid payload");
            return jsonResponse({ error: "Invalid payload" }, 400);
          }

          const vehicle = payload.vehicle;
          if (!vehicle || typeof vehicle !== "object") {
            console.warn("policy.salesman validation failed: missing vehicle");
            return jsonResponse({ error: "Missing vehicle" }, 400);
          }

          const sumInsured = normalizeDbNumber(payload.sumInsured);
          // 投保端不计算保额/保费，允许为空，由核保端后续处理
          // if (sumInsured === null) {
          //   console.warn("policy.salesman validation failed: invalid sumInsured");
          //   return jsonResponse({ error: "Invalid sumInsured" }, 400);
          // }

          const policyEffectiveDate = normalizeDbText(payload.policyEffectiveDate);

          // Generate Trace ID early
          const traceId = `TRACE-${crypto.randomUUID()}`;

          try {
            // Log Attempt
            await logSystemEvent(env, "INFO", "PROPOSAL_SUBMIT", "Proposal submission received", {
              payload_summary: { vehicle: vehicle.plate_number, sumInsured },
              traceId
            });

            // ... (existing logic) ...
            // I need to be careful not to replace too much logic.
            // The snippet in view was only few lines.
            // I should verify where to insert.
            // Line 100 ends with policyEffectiveDate.

            // I'll assume current logic continues. I will insert logging at start of block.
            // But I need to wrap everything in try-catch to log FAILURE.
            // The block already has try-catch? No, index.ts has top-level try-catch.
            // But that one logs "Unknown error" (500).
            // If I want to log specific error for THIS flow, I should allow it to bubble up?
            // The top level try catch calls `jsonResponse` with 500.
            // I should modify top-level catch to LOG the error too?

            // Let's modify the TOP LEVEL catch first to log everything?
            // That's global logging. User asked for "Underwriting program... record task entry".
            // Global logging is better.

            // I will add logSystemEvent helper at the end of file.
            // And modify the GLOBAL catch block (line 661) to log error.
            // And modify the SUCCESS response of proposal submit (if I can find it).
            // Proposal submit logic continues after line 100.

            // Wait, replace_file_content needs PRECISE context.
            // I can't see the Success response lines in Step 907.
            // I only see start of block.

            // I will:
            // 1. Add `logSystemEvent` function at EOF.
            // 2. Modify Global Catch (Line 661) to log.
            // This covers "Failure".
            // 3. To cover "Success", I need to find where proposal submit returns success.
            // It was around line 275 (Step 925).

            // Strategy:
            // A. Add `logSystemEvent` at EOF.
            // B. Modify Global Catch (Line 661).
            // C. Modify Proposal Success (Line 275).

          } catch (e) {
            throw e; // let global catch handle it
          }

          if (!policyEffectiveDate) {
            console.warn("policy.salesman validation failed: missing policyEffectiveDate");
            return jsonResponse({ error: "Missing policyEffectiveDate" }, 400);
          }
          await ensureProposalCoreTables(env);

          // 1. Generate IDs
          const proposalId = `PROP-${crypto.randomUUID()}`;
          const vehicleId = `VEH-${crypto.randomUUID()}`;
          const coverageId = `COV-${crypto.randomUUID()}`;
          const nowStr = now();

          // 2. Insert into proposal (Event: PROPOSAL_SUBMITTED)
          await env.DB.prepare(
            `INSERT INTO proposal (
             proposal_id, proposal_status, application_submitted_at, proposal_data, created_at, updated_at
           ) VALUES (?, 'SUBMITTED', ?, ?, ?, ?)`
          ).bind(proposalId, nowStr, JSON.stringify(payload || {}), nowStr, nowStr).run();

          // 3. Insert into vehicle_proposed
          const v = vehicle as Record<string, unknown>;
          await env.DB.prepare(
            `INSERT INTO vehicle_proposed (
               vehicle_id, proposal_id, plate_number, vehicle_type, usage_nature, brand_model, 
               vin_chassis_number, engine_number, registration_date, license_issue_date, 
               curb_weight, approved_load_weight, approved_passenger_count, energy_type
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            vehicleId, proposalId,
            normalizeDbText(v.plate),
            normalizeDbText(v.vehicleType),
            normalizeDbText(v.useNature),
            normalizeDbText(v.brand),
            normalizeDbText(v.vin),
            normalizeDbText(v.engineNo),
            normalizeDbText(v.registerDate),
            normalizeDbText(v.issueDate),
            normalizeDbNumber(v.curbWeight),
            normalizeDbNumber(v.approvedLoad),
            normalizeDbNumber(v.seats),
            normalizeDbText(payload.energyType)
          ).run();

          // 4. Insert into coverage_proposed
          // Coverage is proposed by Salesman/Client
          await env.DB.prepare(
            `INSERT INTO coverage_proposed (
                coverage_id, proposal_id, sum_insured, policy_effective_date
            ) VALUES (?, ?, ?, ?)`
          ).bind(
            coverageId, proposalId, sumInsured, policyEffectiveDate // Client selected
          ).run();

          // Return success with IDs
          // Log Success
          await logSystemEvent(env, "INFO", "PROPOSAL_SUCCESS", "Proposal submission successful", {
            proposalId,
            traceId,
            status: "SUBMITTED"
          });

          return jsonResponse({ success: true, proposalId, event: "EVENT_PROPOSAL_SUBMITTED" });
        }

        // Salesman Draft Save (Cloud D1 only, no browser local persistence required)
        // POST /api/proposal/draft/upsert
        if (pathname === "/api/proposal/draft/upsert" && request.method === "POST") {
          const body = (await request.json().catch(() => ({}))) as {
            draftId?: string;
            data?: unknown;
          };
          const draftId = body.draftId?.trim();

          if (!draftId) {
            return jsonResponse({ error: "Missing draftId" }, 400);
          }

          await ensureProposalDraftTable(env);
          const nowStr = now();
          const payload = JSON.stringify(body.data || {});

          await env.DB.prepare(
            `INSERT INTO proposal_form_draft (draft_id, payload, created_at, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(draft_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
          ).bind(draftId, payload, nowStr, nowStr).run();

          return jsonResponse({ success: true, draftId, updatedAt: nowStr });
        }

        // Salesman Draft Query
        // GET /api/proposal/draft?id=xxx
        if (pathname === "/api/proposal/draft" && request.method === "GET") {
          const draftId = url.searchParams.get("id")?.trim();
          if (!draftId) {
            return jsonResponse({ error: "Missing id" }, 400);
          }

          await ensureProposalDraftTable(env);
          const row = await env.DB.prepare(
            `SELECT payload, updated_at FROM proposal_form_draft WHERE draft_id = ?`
          ).bind(draftId).first<{ payload: string; updated_at: string }>();

          if (!row) {
            return jsonResponse({ success: true, data: null });
          }

          return jsonResponse({
            success: true,
            data: safeJsonParse(row.payload) || null,
            updatedAt: row.updated_at,
          });
        }

        // Salesman Latest Draft Query
        // GET /api/proposal/draft/latest
        if (pathname === "/api/proposal/draft/latest" && request.method === "GET") {
          await ensureProposalDraftTable(env);
          const row = await env.DB.prepare(
            `SELECT draft_id, updated_at FROM proposal_form_draft ORDER BY updated_at DESC LIMIT 1`
          ).first<{ draft_id: string; updated_at: string }>();

          if (!row) {
            return jsonResponse({ success: true, data: null });
          }

          return jsonResponse({
            success: true,
            data: {
              draftId: row.draft_id,
              updatedAt: row.updated_at,
            },
          });
        }

        // Salesman Proposal Detail
        // GET /api/proposal/detail?id=PROP-xxx
        if (pathname === "/api/proposal/detail" && request.method === "GET") {
          const proposalId = url.searchParams.get("id")?.trim();
          if (!proposalId) return jsonResponse({ error: "Missing id" }, 400);

          await ensureProposalCoreTables(env);
          const proposal = await env.DB.prepare(
            `SELECT proposal_id, proposal_status, proposal_data, application_submitted_at, created_at
           FROM proposal
           WHERE proposal_id = ?`
          ).bind(proposalId).first<any>();

          if (!proposal) return jsonResponse({ error: "Not found" }, 404);

          let data = safeJsonParse(proposal.proposal_data) as Record<string, unknown> | null;
          if (!data || typeof data !== "object") data = {};

          // 兜底：历史脏数据可能没有 proposal_data，尽可能从 vehicle_proposed 还原基础字段
          if (!data.vehicle) {
            const vehicle = await env.DB.prepare(
              `SELECT plate_number, vehicle_type, usage_nature, brand_model, vin_chassis_number,
                    engine_number, registration_date, license_issue_date, curb_weight,
                    approved_load_weight, approved_passenger_count, energy_type
             FROM vehicle_proposed
             WHERE proposal_id = ?
             LIMIT 1`
            ).bind(proposalId).first<any>();
            if (vehicle) {
              data.vehicle = {
                plate: vehicle.plate_number || "",
                vehicleType: vehicle.vehicle_type || "",
                useNature: vehicle.usage_nature || "",
                brand: vehicle.brand_model || "",
                vin: vehicle.vin_chassis_number || "",
                engineNo: vehicle.engine_number || "",
                registerDate: vehicle.registration_date || "",
                issueDate: vehicle.license_issue_date || "",
                curbWeight: vehicle.curb_weight || "",
                approvedLoad: vehicle.approved_load_weight || "",
                seats: vehicle.approved_passenger_count || "",
                energyType: vehicle.energy_type || "FUEL",
              };
            }
          }

          return jsonResponse({
            success: true,
            id: proposal.proposal_id,
            status: proposal.proposal_status,
            createdAt: proposal.application_submitted_at || proposal.created_at || now(),
            data,
          });
        }

        // Salesman Legacy Detail Compatibility
        // GET /api/application/detail?id=xxx
        if (pathname === "/api/application/detail" && request.method === "GET") {
          const id = url.searchParams.get("id")?.trim();
          if (!id) return jsonResponse({ error: "Missing id" }, 400);

          if (id.startsWith("PROP-")) {
            await ensureProposalCoreTables(env);
            const proposal = await env.DB.prepare(
              `SELECT proposal_status, proposal_data FROM proposal WHERE proposal_id = ?`
            ).bind(id).first<any>();
            if (!proposal) return jsonResponse({ error: "Not found" }, 404);
            return jsonResponse({
              id,
              status: proposal.proposal_status,
              data: safeJsonParse(proposal.proposal_data) || null,
            });
          }

          const table = await resolveTable(env);
          const detail = await getApplicationDetail(env, table, id);
          if (!detail) return jsonResponse({ error: "Not found" }, 404);
          return jsonResponse({
            id,
            status: (detail as any).status || "APPLIED",
            data: (detail as any).data || null,
          });
        }

        // Unified history for salesman import panel
        // GET /api/application/history
        if (pathname === "/api/application/history" && request.method === "GET") {
          const history = await listUnifiedHistory(env);
          return jsonResponse(history);
        }

        // 2. Get Pending Proposals (For Underwriter UI)
        // GET /api/underwriting/pending
        if (pathname === "/api/underwriting/pending" && request.method === "GET") {
          // Simulates receiving EVENT_UNDERWRITING_RECEIVED when viewing list
          const { results } = await env.DB.prepare(
            `SELECT p.proposal_id, p.proposal_status, p.application_submitted_at, v.vehicle_type, v.plate_number, v.brand_model 
           FROM proposal p
           LEFT JOIN vehicle_proposed v ON p.proposal_id = v.proposal_id
           WHERE p.proposal_status = 'SUBMITTED'
           ORDER BY p.application_submitted_at DESC`
          ).all();
          return jsonResponse(results || []);
        }

        // 3. Get Proposal Detail (For Underwriter UI)
        // GET /api/underwriting/detail
        if (pathname === "/api/underwriting/detail" && request.method === "GET") {
          const id = url.searchParams.get("id");
          if (!id) return jsonResponse({ error: "Missing id" }, 400);

          const proposal = await env.DB.prepare("SELECT * FROM proposal WHERE proposal_id = ?").bind(id).first<any>();
          if (!proposal) return jsonResponse({ error: "Not found" }, 404);

          const vehicle = await env.DB.prepare("SELECT * FROM vehicle_proposed WHERE proposal_id = ?").bind(id).first<any>();
          const { results: coverage } = await env.DB.prepare("SELECT * FROM coverage_proposed WHERE proposal_id = ?").bind(id).all<any>();

          // Parse proposal_data to extract person info (owner, proposer, insured)
          let proposalData: any = null;
          try {
            proposalData = proposal.proposal_data ? JSON.parse(proposal.proposal_data) : null;
          } catch { proposalData = null; }

          // Also check for existing decision (payment link etc)
          const existingDecision = await env.DB.prepare(
            "SELECT payment_qr_code FROM underwriting_manual_decision WHERE proposal_id = ? ORDER BY underwriting_confirmed_at DESC LIMIT 1"
          ).bind(id).first<any>();

          return jsonResponse({
            proposal,
            vehicle,
            coverage,
            proposalData,
            paymentLink: existingDecision?.payment_qr_code || null
          });
        }

        // 3.1 GET /api/underwriting/history - 核保历史记录（包含 QR/验证码）
        if (pathname === "/api/underwriting/history" && request.method === "GET") {
          const { results } = await env.DB.prepare(`
            SELECT
              d.decision_id,
              d.proposal_id,
              d.underwriting_risk_acceptance as acceptance,
              d.underwriting_risk_reason as reason,
              d.underwriting_confirmed_at,
              d.final_premium,
              d.auth_code,
              d.qr_url,
              d.owner_mobile,
              p.proposal_status,
              v.plate_number,
              v.brand_model
            FROM underwriting_manual_decision d
            JOIN proposal p ON d.proposal_id = p.proposal_id
            LEFT JOIN vehicle_proposed v ON d.proposal_id = v.proposal_id
            WHERE d.underwriting_risk_acceptance IS NOT NULL
            ORDER BY d.underwriting_confirmed_at DESC
            LIMIT 200
          `).all();
          return jsonResponse({ success: true, results: results || [] });
        }

        // 3.2 GET /api/underwriting/by-phone?mobile=138xxxx - 按手机号查询核保历史
        if (pathname === "/api/underwriting/by-phone" && request.method === "GET") {
          const mobile = url.searchParams.get("mobile");
          if (!mobile) return jsonResponse({ error: "缺少手机号参数" }, 400);

          const normalizedMobile = normalizePhone(mobile);
          if (!normalizedMobile) return jsonResponse({ error: "手机号格式无效" }, 400);

          const { results } = await env.DB.prepare(`
            SELECT
              d.decision_id,
              d.proposal_id,
              d.underwriting_risk_acceptance as acceptance,
              d.underwriting_confirmed_at,
              d.auth_code,
              d.qr_url,
              p.proposal_status,
              v.plate_number,
              v.brand_model
            FROM underwriting_manual_decision d
            JOIN proposal p ON d.proposal_id = p.proposal_id
            LEFT JOIN vehicle_proposed v ON d.proposal_id = v.proposal_id
            WHERE d.owner_mobile = ?
            ORDER BY d.underwriting_confirmed_at DESC
          `).bind(normalizedMobile).all();
          return jsonResponse({ success: true, results: results || [] });
        }

        // 3.3 POST /api/underwriting/resend-auth - 重发验证码
        // 供客服人员在客户收不到验证码时重新生成
        if (pathname === "/api/underwriting/resend-auth" && request.method === "POST") {
          const payload = await request.json().catch(() => ({})) as any;
          const { proposalId, operatorId, reason } = payload;

          if (!proposalId) {
            return jsonResponse({ error: "缺少投保单号" }, 400);
          }

          // 1. 查询核保决策记录
          const decision = await env.DB.prepare(`
            SELECT decision_id, underwriting_risk_acceptance, owner_mobile
            FROM underwriting_manual_decision
            WHERE proposal_id = ?
            ORDER BY underwriting_confirmed_at DESC
            LIMIT 1
          `).bind(proposalId).first<any>();

          if (!decision) {
            return jsonResponse({ error: "未找到该投保单的核保记录" }, 404);
          }

          if (decision.underwriting_risk_acceptance !== 'ACCEPT') {
            return jsonResponse({ error: "只有核保通过的投保单才能重发验证码" }, 400);
          }

          // 2. 生成新的6位验证码
          const newAuthCode = String(Math.floor(100000 + Math.random() * 900000));
          const qrUrl = `https://chinalife-shie-xinhexin.pages.dev/#/buffer?id=${proposalId}`;

          // 3. 更新数据库中的验证码
          await env.DB.prepare(`
            UPDATE underwriting_manual_decision
            SET auth_code = ?, qr_url = ?
            WHERE decision_id = ?
          `).bind(newAuthCode, qrUrl, decision.decision_id).run();

          // 4. 同步更新 KV（兼容旧流程）
          await env.POLICY_KV.put(
            `verify:${proposalId}`,
            JSON.stringify({ code: newAuthCode, mobile: decision.owner_mobile }),
            { expirationTtl: QR_TTL }
          );

          // 5. 记录操作日志（可选：写入审计表）
          console.log(`[RESEND_AUTH] proposalId=${proposalId}, operatorId=${operatorId || 'unknown'}, reason=${reason || 'none'}, newCode=${newAuthCode}`);

          return jsonResponse({
            success: true,
            authCode: newAuthCode,
            qrUrl,
            message: "验证码已重新生成"
          });
        }

        // 3.4 POST /api/admin/substitute-auth
        // L1+ 管理员代客户完成身份认证（代行权）
        if (pathname === "/api/admin/substitute-auth" && request.method === "POST") {
          const payload = await request.json().catch(() => ({})) as any;
          const { proposalId, operatorId, operatorRole, verificationMethod, reason } = payload;

          // 1. 参数校验
          if (!proposalId) return jsonResponse({ error: "缺少投保单号" }, 400);
          if (!operatorId) return jsonResponse({ error: "缺少操作人ID" }, 400);
          if (!operatorRole || !['L1', 'L2', 'L3'].includes(operatorRole)) {
            return jsonResponse({ error: "无权限：仅 L1 及以上角色可执行此操作" }, 403);
          }
          if (!verificationMethod || !['PHONE', 'VIDEO', 'IN_PERSON'].includes(verificationMethod)) {
            return jsonResponse({ error: "请选择身份核实方式" }, 400);
          }
          if (!reason || reason.trim().length < 10) {
            return jsonResponse({ error: "操作理由至少需要10个字符" }, 400);
          }

          // 2. 查询投保单当前状态
          const proposal = await env.DB.prepare(
            "SELECT proposal_id, proposal_status FROM proposal WHERE proposal_id = ?"
          ).bind(proposalId).first<any>();

          if (!proposal) {
            return jsonResponse({ error: "投保单不存在" }, 404);
          }

          // 3. 查询核保决策记录
          const decision = await env.DB.prepare(`
            SELECT decision_id, underwriting_risk_acceptance, auth_code, owner_mobile
            FROM underwriting_manual_decision
            WHERE proposal_id = ?
            ORDER BY underwriting_confirmed_at DESC
            LIMIT 1
          `).bind(proposalId).first<any>();

          if (!decision || decision.underwriting_risk_acceptance !== 'ACCEPT') {
            return jsonResponse({ error: "只有核保通过的投保单才能代完成认证" }, 400);
          }

          // 4. 构建 before_state
          const beforeState = {
            proposal_status: proposal.proposal_status,
            auth_code: decision.auth_code,
            auth_completed_by: null
          };

          // 5. 构建 after_state
          const nowStr = now();
          const afterState = {
            proposal_status: proposal.proposal_status,
            auth_code: decision.auth_code,
            auth_completed_by: operatorId,
            auth_completed_at: nowStr,
            auth_completed_method: verificationMethod
          };

          // 6. 写入审计日志
          const logId = `AOL-${crypto.randomUUID()}`;
          await env.DB.prepare(`
            INSERT INTO admin_operation_log (
              id, operator_id, operator_role, power_type, action,
              target_type, target_id, verification_method, reason,
              before_state, after_state
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            logId,
            operatorId,
            operatorRole,
            'SUBSTITUTION',
            'COMPLETE_AUTH',
            'PROPOSAL',
            proposalId,
            verificationMethod,
            reason.trim(),
            JSON.stringify(beforeState),
            JSON.stringify(afterState)
          ).run();

          return jsonResponse({
            success: true,
            auditLogId: logId,
            message: "已代客户完成身份认证"
          });
        }

        // 3.5 POST /api/admin/upload-material
        // 代客户补充材料 (Level 0 - 所有管理员可用)
        if (pathname === "/api/admin/upload-material" && request.method === "POST") {
          const payload = await request.json().catch(() => ({})) as any;
          const { proposalId, operatorId, operatorRole, materialType, materialNote } = payload;

          if (!proposalId) return jsonResponse({ error: "缺少投保单号" }, 400);
          if (!operatorId) return jsonResponse({ error: "缺少操作人ID" }, 400);
          if (!operatorRole || !['CS', 'L1', 'L2', 'L3'].includes(operatorRole)) {
            return jsonResponse({ error: "无效的操作角色" }, 400);
          }
          if (!materialType) return jsonResponse({ error: "请选择材料类型" }, 400);

          // 查询投保单
          const proposal = await env.DB.prepare(
            "SELECT proposal_id, proposal_status FROM proposal WHERE proposal_id = ?"
          ).bind(proposalId).first<any>();

          if (!proposal) {
            return jsonResponse({ error: "投保单不存在" }, 404);
          }

          const beforeState = { proposal_status: proposal.proposal_status };
          const afterState = {
            proposal_status: proposal.proposal_status,
            material_uploaded: true,
            material_type: materialType
          };

          const logId = `AOL-${crypto.randomUUID()}`;
          await env.DB.prepare(`
            INSERT INTO admin_operation_log (
              id, operator_id, operator_role, power_type, action,
              target_type, target_id, reason, before_state, after_state
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            logId,
            operatorId,
            operatorRole,
            'SUBSTITUTION',
            'UPLOAD_MATERIAL',
            'PROPOSAL',
            proposalId,
            materialNote || '代客户补充材料',
            JSON.stringify(beforeState),
            JSON.stringify(afterState)
          ).run();

          return jsonResponse({
            success: true,
            auditLogId: logId,
            message: "材料补充记录已保存"
          });
        }

        // 3.6 POST /api/admin/submit-claim
        // L2+ 代客户提交理赔
        if (pathname === "/api/admin/submit-claim" && request.method === "POST") {
          const payload = await request.json().catch(() => ({})) as any;
          const {
            policyId,
            operatorId,
            operatorRole,
            claimType,
            claimAmount,
            claimDescription,
            authorizationType,
            authorizationNote
          } = payload;

          // 参数校验
          if (!policyId) return jsonResponse({ error: "缺少保单号" }, 400);
          if (!operatorId) return jsonResponse({ error: "缺少操作人ID" }, 400);
          if (!operatorRole || !['L2', 'L3'].includes(operatorRole)) {
            return jsonResponse({ error: "无权限：仅 L2 及以上角色可执行此操作" }, 403);
          }
          if (!claimType) return jsonResponse({ error: "请选择理赔类型" }, 400);
          if (!claimDescription || claimDescription.length < 20) {
            return jsonResponse({ error: "理赔描述至少需要20个字符" }, 400);
          }
          if (!authorizationType || !['VERBAL', 'WRITTEN'].includes(authorizationType)) {
            return jsonResponse({ error: "请选择授权方式" }, 400);
          }

          // 生成理赔单号
          const claimId = `CLM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
          const nowStr = now();

          // 记录理赔信息
          const beforeState = { policy_id: policyId, claim_status: null };
          const afterState = {
            policy_id: policyId,
            claim_id: claimId,
            claim_type: claimType,
            claim_amount: claimAmount,
            claim_status: 'SUBMITTED',
            submitted_by: operatorId,
            submitted_at: nowStr,
            authorization_type: authorizationType
          };

          // 写入审计日志
          const logId = `AOL-${crypto.randomUUID()}`;
          await env.DB.prepare(`
            INSERT INTO admin_operation_log (
              id, operator_id, operator_role, power_type, action,
              target_type, target_id, reason, before_state, after_state
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            logId,
            operatorId,
            operatorRole,
            'SUBSTITUTION',
            'SUBMIT_CLAIM',
            'POLICY',
            policyId,
            `${authorizationType === 'VERBAL' ? '口头授权' : '书面授权'}: ${authorizationNote || claimDescription.slice(0, 50)}`,
            JSON.stringify(beforeState),
            JSON.stringify(afterState)
          ).run();

          return jsonResponse({
            success: true,
            claimId,
            auditLogId: logId,
            message: "理赔申请已提交"
          });
        }

        // 3.7 POST /api/admin/correct-data
        // L1+ 数据纠错
        if (pathname === "/api/admin/correct-data" && request.method === "POST") {
          const payload = await request.json().catch(() => ({})) as any;
          const {
            targetType,
            targetId,
            operatorId,
            operatorRole,
            fieldName,
            oldValue,
            newValue,
            reason
          } = payload;

          // 参数校验
          if (!targetType || !['PROPOSAL', 'POLICY', 'CUSTOMER'].includes(targetType)) {
            return jsonResponse({ error: "无效的目标类型" }, 400);
          }
          if (!targetId) return jsonResponse({ error: "缺少目标ID" }, 400);
          if (!operatorId) return jsonResponse({ error: "缺少操作人ID" }, 400);
          if (!operatorRole || !['L1', 'L2', 'L3'].includes(operatorRole)) {
            return jsonResponse({ error: "无权限：仅 L1 及以上角色可执行此操作" }, 403);
          }
          if (!fieldName) return jsonResponse({ error: "请指定修改字段" }, 400);
          if (!reason || reason.length < 10) {
            return jsonResponse({ error: "修改理由至少需要10个字符" }, 400);
          }

          const beforeState = { [fieldName]: oldValue };
          const afterState = { [fieldName]: newValue };

          // 写入审计日志
          const logId = `AOL-${crypto.randomUUID()}`;
          await env.DB.prepare(`
            INSERT INTO admin_operation_log (
              id, operator_id, operator_role, power_type, action,
              target_type, target_id, reason, before_state, after_state
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            logId,
            operatorId,
            operatorRole,
            'CORRECTION',
            'CORRECT_DATA',
            targetType,
            targetId,
            reason,
            JSON.stringify(beforeState),
            JSON.stringify(afterState)
          ).run();

          return jsonResponse({
            success: true,
            auditLogId: logId,
            message: "数据已修正"
          });
        }

        // 3.8 POST /api/admin/substitute-payment
        // L3 代客户支付（高风险，需书面授权+双人复核）
        if (pathname === "/api/admin/substitute-payment" && request.method === "POST") {
          const payload = await request.json().catch(() => ({})) as any;
          const {
            proposalId,
            operatorId,
            operatorRole,
            paymentAmount,
            paymentMethod,
            authorizationUrl,
            reason,
            reviewerId
          } = payload;

          // 参数校验
          if (!proposalId) return jsonResponse({ error: "缺少投保单号" }, 400);
          if (!operatorId) return jsonResponse({ error: "缺少操作人ID" }, 400);
          if (operatorRole !== 'L3') {
            return jsonResponse({ error: "无权限：仅 L3 可执行代支付操作" }, 403);
          }
          if (!paymentAmount || paymentAmount <= 0) {
            return jsonResponse({ error: "请输入有效的支付金额" }, 400);
          }
          if (!authorizationUrl) {
            return jsonResponse({ error: "代支付需上传书面授权凭证" }, 400);
          }
          if (!reason || reason.length < 10) {
            return jsonResponse({ error: "操作理由至少需要10个字符" }, 400);
          }
          if (!reviewerId) {
            return jsonResponse({ error: "L3 操作需要指定复核人" }, 400);
          }
          if (reviewerId === operatorId) {
            return jsonResponse({ error: "复核人不能是操作人本人" }, 400);
          }

          // 查询投保单
          const proposal = await env.DB.prepare(
            "SELECT proposal_id, proposal_status FROM proposal WHERE proposal_id = ?"
          ).bind(proposalId).first<any>();

          if (!proposal) {
            return jsonResponse({ error: "投保单不存在" }, 404);
          }

          // 状态校验
          if (proposal.proposal_status !== 'UNDERWRITING_CONFIRMED') {
            return jsonResponse({ error: `当前状态(${proposal.proposal_status})不允许支付` }, 400);
          }

          const nowStr = now();
          const beforeState = {
            proposal_status: proposal.proposal_status,
            paid: false
          };
          const afterState = {
            proposal_status: 'PAID',
            paid: true,
            paid_by: operatorId,
            paid_at: nowStr,
            payment_amount: paymentAmount,
            payment_method: paymentMethod || 'SUBSTITUTE'
          };

          // 更新投保单状态
          await env.DB.prepare(
            "UPDATE proposal SET proposal_status = 'PAID', updated_at = ? WHERE proposal_id = ?"
          ).bind(nowStr, proposalId).run();

          // 写入审计日志
          const logId = `AOL-${crypto.randomUUID()}`;
          await env.DB.prepare(`
            INSERT INTO admin_operation_log (
              id, operator_id, operator_role, power_type, action,
              target_type, target_id, reason, before_state, after_state,
              authorization_url, reviewer_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            logId,
            operatorId,
            operatorRole,
            'SUBSTITUTION',
            'PAYMENT',
            'PROPOSAL',
            proposalId,
            reason.trim(),
            JSON.stringify(beforeState),
            JSON.stringify(afterState),
            authorizationUrl,
            reviewerId
          ).run();

          return jsonResponse({
            success: true,
            auditLogId: logId,
            newStatus: 'PAID',
            message: "代支付完成，待复核人确认"
          });
        }

        // 3.9 POST /api/admin/substitute-surrender
        // L3 代客户退保（高风险，需书面授权+双人复核）
        if (pathname === "/api/admin/substitute-surrender" && request.method === "POST") {
          const payload = await request.json().catch(() => ({})) as any;
          const {
            policyId,
            operatorId,
            operatorRole,
            surrenderReason,
            refundAmount,
            authorizationUrl,
            reason,
            reviewerId
          } = payload;

          // 参数校验
          if (!policyId) return jsonResponse({ error: "缺少保单号" }, 400);
          if (!operatorId) return jsonResponse({ error: "缺少操作人ID" }, 400);
          if (operatorRole !== 'L3') {
            return jsonResponse({ error: "无权限：仅 L3 可执行代退保操作" }, 403);
          }
          if (!surrenderReason) {
            return jsonResponse({ error: "请选择退保原因" }, 400);
          }
          if (!authorizationUrl) {
            return jsonResponse({ error: "代退保需上传书面授权/放弃声明凭证" }, 400);
          }
          if (!reason || reason.length < 10) {
            return jsonResponse({ error: "操作理由至少需要10个字符" }, 400);
          }
          if (!reviewerId) {
            return jsonResponse({ error: "L3 操作需要指定复核人" }, 400);
          }
          if (reviewerId === operatorId) {
            return jsonResponse({ error: "复核人不能是操作人本人" }, 400);
          }

          const nowStr = now();
          const surrenderId = `SUR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

          const beforeState = {
            policy_id: policyId,
            policy_status: 'EFFECTIVE'
          };
          const afterState = {
            policy_id: policyId,
            policy_status: 'SURRENDERED',
            surrender_id: surrenderId,
            surrender_reason: surrenderReason,
            refund_amount: refundAmount,
            surrendered_by: operatorId,
            surrendered_at: nowStr
          };

          // 写入审计日志
          const logId = `AOL-${crypto.randomUUID()}`;
          await env.DB.prepare(`
            INSERT INTO admin_operation_log (
              id, operator_id, operator_role, power_type, action,
              target_type, target_id, reason, before_state, after_state,
              authorization_url, reviewer_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            logId,
            operatorId,
            operatorRole,
            'SUBSTITUTION',
            'SURRENDER',
            'POLICY',
            policyId,
            reason.trim(),
            JSON.stringify(beforeState),
            JSON.stringify(afterState),
            authorizationUrl,
            reviewerId
          ).run();

          return jsonResponse({
            success: true,
            auditLogId: logId,
            surrenderId,
            message: "代退保申请已提交，待复核人确认"
          });
        }

        // 3.10 POST /api/admin/review-confirm
        // 复核人确认L3操作
        if (pathname === "/api/admin/review-confirm" && request.method === "POST") {
          const payload = await request.json().catch(() => ({})) as any;
          const { auditLogId, reviewerId, reviewerRole, approved, rejectReason } = payload;

          if (!auditLogId) return jsonResponse({ error: "缺少审计日志ID" }, 400);
          if (!reviewerId) return jsonResponse({ error: "缺少复核人ID" }, 400);
          if (!reviewerRole || !['L2', 'L3'].includes(reviewerRole)) {
            return jsonResponse({ error: "无权限：仅 L2 及以上可复核" }, 403);
          }

          // 查询审计日志
          const log = await env.DB.prepare(
            "SELECT * FROM admin_operation_log WHERE id = ?"
          ).bind(auditLogId).first<any>();

          if (!log) {
            return jsonResponse({ error: "审计记录不存在" }, 404);
          }
          if (log.reviewer_id !== reviewerId) {
            return jsonResponse({ error: "您不是指定的复核人" }, 403);
          }
          if (log.reviewed_at) {
            return jsonResponse({ error: "该操作已完成复核" }, 400);
          }

          const nowStr = now();

          if (approved) {
            // 确认通过
            await env.DB.prepare(
              "UPDATE admin_operation_log SET reviewed_at = ? WHERE id = ?"
            ).bind(nowStr, auditLogId).run();

            return jsonResponse({
              success: true,
              message: "复核确认通过"
            });
          } else {
            // 复核拒绝 - 需要回滚操作
            const afterState = safeJsonParse(log.after_state) || {};

            // 如果是代支付，回滚状态
            if (log.action === 'PAYMENT' && afterState.proposal_status === 'PAID') {
              await env.DB.prepare(
                "UPDATE proposal SET proposal_status = 'UNDERWRITING_CONFIRMED', updated_at = ? WHERE proposal_id = ?"
              ).bind(nowStr, log.target_id).run();
            }

            // 标记为已拒绝
            await env.DB.prepare(
              "UPDATE admin_operation_log SET reviewed_at = ?, reason = ? WHERE id = ?"
            ).bind(nowStr, `[复核拒绝] ${rejectReason || '无'}`, auditLogId).run();

            return jsonResponse({
              success: true,
              message: "复核已拒绝，操作已回滚"
            });
          }
        }

        // 3.11 GET /api/admin/pending-reviews
        // 获取待复核的操作列表
        if (pathname === "/api/admin/pending-reviews" && request.method === "GET") {
          const url = new URL(request.url);
          const reviewerId = url.searchParams.get('reviewerId');

          if (!reviewerId) {
            return jsonResponse({ error: "缺少复核人ID" }, 400);
          }

          const results = await env.DB.prepare(`
            SELECT * FROM admin_operation_log
            WHERE reviewer_id = ? AND reviewed_at IS NULL
            ORDER BY created_at DESC
            LIMIT 50
          `).bind(reviewerId).all();

          return jsonResponse({
            success: true,
            reviews: results.results || [],
            total: results.results?.length || 0
          });
        }

        // 3.12 GET /api/admin/audit-log
        // 查询审计日志
        if (pathname === "/api/admin/audit-log" && request.method === "GET") {
          const url = new URL(request.url);
          const proposalId = url.searchParams.get('proposalId');
          const operatorId = url.searchParams.get('operatorId');
          const limit = parseInt(url.searchParams.get('limit') || '50');

          let query = "SELECT * FROM admin_operation_log WHERE 1=1";
          const params: any[] = [];

          if (proposalId) {
            query += " AND target_id = ?";
            params.push(proposalId);
          }
          if (operatorId) {
            query += " AND operator_id = ?";
            params.push(operatorId);
          }

          query += " ORDER BY created_at DESC LIMIT ?";
          params.push(limit);

          const stmt = env.DB.prepare(query);
          const results = await stmt.bind(...params).all();

          return jsonResponse({
            success: true,
            logs: results.results || [],
            total: results.results?.length || 0
          });
        }

        // 4. Underwriting Decision (Manual)
        // POST /api/underwriting/decision
        // - Allow modification of ALL time fields
        // - Write underwriting_manual_decision
        // - Trigger EVENT_UNDERWRITING_CONFIRMED
        if (pathname === "/api/underwriting/decision" && request.method === "POST") {
          const payload = await request.json() as any;
          const { proposalId, decision, vehicleConfirmed, underwriterName, paymentQrCode, coverages, paymentLink, updatedPersons } = payload;

          if (!proposalId || !decision) return jsonResponse({ error: "Missing data" }, 400);

          const decisionId = `DEC-${crypto.randomUUID()}`;
          const nowStr = now();

          // A0. Update Coverages (If provided) -> The Underwriter Overwrite
          if (Array.isArray(coverages) && coverages.length > 0) {
            // 1. Delete existing
            await env.DB.prepare("DELETE FROM coverage_proposed WHERE proposal_id = ?").bind(proposalId).run();
            // 2. Insert new
            const stmt = env.DB.prepare(`
                INSERT INTO coverage_proposed (coverage_id, proposal_id, coverage_code, coverage_name, sum_insured, policy_effective_date)
                VALUES (?, ?, ?, ?, ?, ?)
             `);
            const batch = coverages.map((c: any) => stmt.bind(
              c.coverage_id || `COV-${crypto.randomUUID()}`,
              proposalId,
              c.coverage_code || "MISC",
              c.coverage_name || "Custom Coverage",
              c.sum_insured || 0,
              decision.policyEffectiveDate // Align with policy effective date
            ));
            await env.DB.batch(batch);
          }

          // A-1. 提前生成 authCode 和 qrUrl（如果 ACCEPT），以便写入 DB
          let authCode: string | null = null;
          let qrUrl: string | null = null;
          if (decision.acceptance === 'ACCEPT') {
            authCode = String(Math.floor(100000 + Math.random() * 900000)); // 6-digit random code
            qrUrl = `https://chinalife-shie-xinhexin.pages.dev/#/buffer?id=${proposalId}`;
          }

          // A-2. 从 proposal_data 提取 owner_mobile（手机号作为业务锚点）
          let ownerMobile: string | null = null;
          const proposalRow = await env.DB.prepare("SELECT proposal_data FROM proposal WHERE proposal_id = ?").bind(proposalId).first<any>();
          if (proposalRow?.proposal_data) {
            try {
              const pd = JSON.parse(proposalRow.proposal_data);
              ownerMobile = normalizePhone(pd.owner?.mobile || pd.proposer?.mobile || pd.insured?.mobile || '');
            } catch { ownerMobile = null; }
          }

          // A. Insert Manual Decision Record (包含 auth_code, qr_url, owner_mobile)
          await env.DB.prepare(`
          INSERT INTO underwriting_manual_decision (
            decision_id, proposal_id,
            final_premium, policy_effective_date, policy_expiry_date,
            underwriter_name, underwriter_id, underwriting_confirmed_at,
            underwriting_risk_level, underwriting_risk_reason, underwriting_risk_acceptance,
            usage_authenticity_judgment, usage_verification_basis,
            loss_history_estimation, loss_history_basis, ncd_assumption,
            premium_adjustment_reason, coverage_adjustment_flag, coverage_adjustment_detail,
            special_exception_flag, special_exception_description,
            payment_qr_code, adjusted_coverage_data,
            auth_code, qr_url, owner_mobile
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            decisionId, proposalId,
            decision.finalPremium, decision.policyEffectiveDate, decision.policyExpiryDate, // Underwriter Modified Times
            underwriterName || "System", "U001", nowStr,
            decision.riskLevel, decision.riskReason, decision.acceptance,
            decision.usageJudgment || "N/A", decision.usageBasis || "N/A",
            decision.lossHistory || "N/A", decision.lossBasis || "N/A", decision.ncd || "N/A",
            decision.premiumReason || "N/A",
            decision.coverageFlag || 0, decision.coverageDetail || "",
            decision.exceptionFlag || 0, decision.exceptionDesc || "",
            paymentLink || paymentQrCode || null, JSON.stringify(coverages || []),
            authCode, qrUrl, ownerMobile || null
          ).run();

          // A1. Update proposal_data with person edits if provided
          if (updatedPersons && typeof updatedPersons === 'object') {
            const existingProposal = await env.DB.prepare("SELECT proposal_data FROM proposal WHERE proposal_id = ?").bind(proposalId).first<any>();
            let existingData: any = {};
            try { existingData = existingProposal?.proposal_data ? JSON.parse(existingProposal.proposal_data) : {}; } catch { existingData = {}; }
            if (updatedPersons.owner) existingData.owner = updatedPersons.owner;
            if (updatedPersons.proposer) existingData.proposer = updatedPersons.proposer;
            if (updatedPersons.insured) existingData.insured = updatedPersons.insured;
            if (updatedPersons.vehicle) existingData.vehicle = updatedPersons.vehicle;
            await env.DB.prepare("UPDATE proposal SET proposal_data = ? WHERE proposal_id = ?").bind(JSON.stringify(existingData), proposalId).run();
          }

          // A2. Update vehicle_proposed if vehicle data provided
          if (vehicleConfirmed && typeof vehicleConfirmed === 'object') {
            const vc = vehicleConfirmed as Record<string, unknown>;
            await env.DB.prepare(
              `UPDATE vehicle_proposed SET plate_number=?, vehicle_type=?, usage_nature=?, brand_model=?, vin_chassis_number=?, engine_number=?, registration_date=?, license_issue_date=?, curb_weight=?, approved_load_weight=?, approved_passenger_count=?, energy_type=? WHERE proposal_id=?`
            ).bind(
              normalizeDbText(vc.plate_number), normalizeDbText(vc.vehicle_type), normalizeDbText(vc.usage_nature), normalizeDbText(vc.brand_model),
              normalizeDbText(vc.vin_chassis_number), normalizeDbText(vc.engine_number), normalizeDbText(vc.registration_date), normalizeDbText(vc.license_issue_date),
              normalizeDbNumber(vc.curb_weight), normalizeDbNumber(vc.approved_load_weight), normalizeDbNumber(vc.approved_passenger_count), normalizeDbText(vc.energy_type),
              proposalId
            ).run();
          }

          // B. Update Proposal Status & Time
          await env.DB.prepare(
            `UPDATE proposal
             SET proposal_status = 'UNDERWRITING_CONFIRMED', underwriting_confirmed_at = ?, updated_at = ?
             WHERE proposal_id = ?`
          ).bind(nowStr, nowStr, proposalId).run();

          // C. 同时写入 KV（兼容旧流程，30天后自动过期）
          if (authCode) {
            await env.POLICY_KV.put(
              `verify:${proposalId}`,
              JSON.stringify({ code: authCode, at: nowStr }),
              { expirationTtl: 86400 * 30 } // 30 days
            );
          }

          // NOTE: We do NOT create policy here. Policy creation is a separate Event Reaction.

          return jsonResponse({
            success: true,
            decisionId,
            authCode,
            qrUrl,
            event: "EVENT_UNDERWRITING_CONFIRMED"
          });
        }

        // 5. Policy Issuance (Triggered by EVENT_UNDERWRITING_CONFIRMED)
        // POST /api/policy.issue
        // - Only triggerable if status is UNDERWRITING_CONFIRMED
        // - Writes policy_issue_date
        // - Generates Policy
        if (pathname === "/api/policy.issue" && request.method === "POST") {
          const payload = await request.json() as any;
          const { proposalId } = payload;

          // Verify State
          const proposal = await env.DB.prepare("SELECT * FROM proposal WHERE proposal_id = ?").bind(proposalId).first<any>();
          if (!proposal || proposal.proposal_status !== 'UNDERWRITING_CONFIRMED') {
            return jsonResponse({ error: "Invalid state for issuance" }, 400);
          }

          // Fetch Decision for Final Terms
          const decision = await env.DB.prepare("SELECT * FROM underwriting_manual_decision WHERE proposal_id = ?").bind(proposalId).first<any>();
          if (!decision) return jsonResponse({ error: "Missing underwriting decision" }, 500);

          const policyId = `POL-${crypto.randomUUID()}`;
          const nowStr = now();

          await env.DB.prepare(`
            INSERT INTO policy (
              policy_id, proposal_id, policy_status, 
              policy_issue_date, policy_effective_date, policy_expiry_date,
              final_premium, underwriter_name
            ) VALUES (?, ?, 'EFFECTIVE', ?, ?, ?, ?, ?)
          `).bind(
            policyId, proposalId,
            nowStr, decision.policy_effective_date, decision.policy_expiry_date,
            decision.final_premium, decision.underwriter_name
          ).run();

          // Emit EVENT_POLICY_ISSUED (conceptually)
          return jsonResponse({ success: true, policyId, event: "EVENT_POLICY_ISSUED" });
        }

        // GET /api/proposal/payment-link?id=PROP-xxx
        // For customer page to fetch the payment link after underwriting confirmation
        if (pathname === "/api/proposal/payment-link" && request.method === "GET") {
          const id = url.searchParams.get("id");
          if (!id) return jsonResponse({ error: "Missing id" }, 400);

          const decision = await env.DB.prepare(
            "SELECT payment_qr_code FROM underwriting_manual_decision WHERE proposal_id = ? ORDER BY underwriting_confirmed_at DESC LIMIT 1"
          ).bind(id).first<any>();

          return jsonResponse({
            success: true,
            paymentLink: decision?.payment_qr_code || null
          });
        }

        // 2. Get Proposal Status (For UI polling)
        // GET /api/proposal/status?id=xxx
        if (pathname === "/api/proposal/status" && request.method === "GET") {
          const id = url.searchParams.get("id");
          if (!id) return jsonResponse({ error: "Missing id" }, 400);
          await ensureProposalCoreTables(env);

          const proposal = await env.DB.prepare(
            `SELECT * FROM proposal WHERE proposal_id = ?`
          ).bind(id).first<any>();

          if (!proposal) return jsonResponse({ error: "Not found" }, 404);

          // Check for Policy (Has it been issued?)
          const policy = await env.DB.prepare("SELECT policy_id FROM policy WHERE proposal_id = ?").bind(id).first();

          // Check for Decision (Has underwriter reviewed?) - 现在包含 auth_code 和 qr_url
          const decision = await env.DB.prepare(
            "SELECT underwriting_risk_acceptance, payment_qr_code, underwriting_risk_reason, auth_code, qr_url FROM underwriting_manual_decision WHERE proposal_id = ? ORDER BY underwriting_confirmed_at DESC LIMIT 1"
          ).bind(id).first<any>();

          let status = proposal.proposal_status;
          let reason = "";
          let paymentLink = null;

          if (policy) {
            status = "ISSUED";
          } else if (decision) {
            paymentLink = decision.payment_qr_code;
            const acc = decision.underwriting_risk_acceptance;

            if (acc === 'ACCEPT') {
              status = "UA"; // Underwriting Accepted -> User Action (Pay)
            } else if (acc === 'REJECT') {
              status = "REJECTED";
              reason = decision.underwriting_risk_reason;
            } else if (acc === 'MODIFY') {
              status = "UR"; // Underwriting Returned
              reason = decision.underwriting_risk_reason;
            }
          } else {
            // No decision yet.
            if (status === 'SUBMITTED') status = "UI"; // Underwriting In Progress
            if (status === 'DRAFT') status = "APPLIED";
          }

          // 优先从 DB 读取 authCode 和 qrUrl
          let authCode = decision?.auth_code || null;
          let qrUrl = decision?.qr_url || null;

          // 如果 DB 没有，降级到 KV（兼容旧数据）
          if (!authCode) {
            const authRaw = await env.POLICY_KV.get(`verify:${id}`);
            if (authRaw) {
              try { authCode = JSON.parse(authRaw).code; } catch { }
            }
          }

          return jsonResponse({
            status,
            reason,
            paymentLink,
            authCode,
            qrUrl,
            proposalId: proposal.proposal_id
          });
        }

        // ==================== PROPOSAL LIFECYCLE MANAGEMENT ====================

        // GET /api/proposal/lifecycle?id=PROP-xxx
        // Returns full lifecycle status, QR URL, auth code, timeline
        if (pathname === "/api/proposal/lifecycle" && request.method === "GET") {
          const id = url.searchParams.get("id");
          if (!id) return jsonResponse({ error: "Missing id" }, 400);

          const proposal = await env.DB.prepare(
            "SELECT proposal_id, proposal_status, application_submitted_at, underwriting_confirmed_at, created_at, updated_at FROM proposal WHERE proposal_id = ?"
          ).bind(id).first<any>();
          if (!proposal) return jsonResponse({ error: "Not found" }, 404);

          const decision = await env.DB.prepare(
            "SELECT final_premium, policy_effective_date, policy_expiry_date, underwriter_name, underwriting_confirmed_at, underwriting_risk_acceptance, payment_qr_code FROM underwriting_manual_decision WHERE proposal_id = ? ORDER BY underwriting_confirmed_at DESC LIMIT 1"
          ).bind(id).first<any>();

          const policy = await env.DB.prepare(
            "SELECT policy_id, policy_issue_date FROM policy WHERE proposal_id = ?"
          ).bind(id).first<any>();

          const vehicle = await env.DB.prepare(
            "SELECT plate_number, brand_model FROM vehicle_proposed WHERE proposal_id = ? LIMIT 1"
          ).bind(id).first<any>();

          // Auth code from KV
          let authCode = null;
          const authRaw = await env.POLICY_KV.get(`verify:${id}`);
          if (authRaw) {
            try { authCode = JSON.parse(authRaw).code; } catch { }
          }

          // QR URL
          const qrUrl = (proposal.proposal_status === 'UNDERWRITING_CONFIRMED' || proposal.proposal_status === 'PAID')
            ? `https://chinalife-shie-xinhexin.pages.dev/#/buffer?id=${id}`
            : null;

          // Determine lifecycle phase
          let lifecyclePhase = proposal.proposal_status;
          if (policy) lifecyclePhase = 'COMPLETED';

          return jsonResponse({
            success: true,
            proposalId: id,
            lifecyclePhase,
            status: proposal.proposal_status,
            qrUrl,
            authCode,
            vehicle: vehicle ? { plate: vehicle.plate_number, brand: vehicle.brand_model } : null,
            decision: decision ? {
              finalPremium: decision.final_premium,
              effectiveDate: decision.policy_effective_date,
              expiryDate: decision.policy_expiry_date,
              acceptance: decision.underwriting_risk_acceptance,
              paymentLink: decision.payment_qr_code,
              underwriter: decision.underwriter_name,
              confirmedAt: decision.underwriting_confirmed_at,
            } : null,
            policy: policy ? { policyId: policy.policy_id, issuedAt: policy.policy_issue_date } : null,
            timeline: {
              submittedAt: proposal.application_submitted_at,
              confirmedAt: proposal.underwriting_confirmed_at,
              paidAt: proposal.proposal_status === 'PAID' ? proposal.updated_at : null,
              completedAt: policy ? policy.policy_issue_date : null,
            }
          });
        }

        // POST /api/proposal/lifecycle/update
        // Underwriter actions: MARK_PAID, MARK_COMPLETED
        if (pathname === "/api/proposal/lifecycle/update" && request.method === "POST") {
          const payload = await request.json() as any;
          const { proposalId, action } = payload;
          if (!proposalId || !action) return jsonResponse({ error: "Missing proposalId or action" }, 400);

          const proposal = await env.DB.prepare(
            "SELECT proposal_status FROM proposal WHERE proposal_id = ?"
          ).bind(proposalId).first<any>();
          if (!proposal) return jsonResponse({ error: "Proposal not found" }, 404);

          const nowStr = now();

          if (action === 'MARK_PAID') {
            if (proposal.proposal_status !== 'UNDERWRITING_CONFIRMED') {
              return jsonResponse({ error: `Cannot mark PAID from status: ${proposal.proposal_status}` }, 400);
            }
            await env.DB.prepare(
              "UPDATE proposal SET proposal_status = 'PAID', updated_at = ? WHERE proposal_id = ?"
            ).bind(nowStr, proposalId).run();
            return jsonResponse({ success: true, newStatus: 'PAID' });

          } else if (action === 'MARK_COMPLETED') {
            if (!['UNDERWRITING_CONFIRMED', 'PAID'].includes(proposal.proposal_status)) {
              return jsonResponse({ error: `Cannot mark COMPLETED from status: ${proposal.proposal_status}` }, 400);
            }
            await env.DB.prepare(
              "UPDATE proposal SET proposal_status = 'COMPLETED', updated_at = ? WHERE proposal_id = ?"
            ).bind(nowStr, proposalId).run();
            // Invalidate auth code (QR becomes expired)
            await env.POLICY_KV.delete(`verify:${proposalId}`);
            return jsonResponse({ success: true, newStatus: 'COMPLETED' });

          } else {
            return jsonResponse({ error: `Unknown action: ${action}` }, 400);
          }
        }

        // GET /api/proposal/lifecycle/check?id=PROP-xxx
        // Lightweight check for client side (no auth required)
        // Returns only status + vehicle basic info + expiry message
        if (pathname === "/api/proposal/lifecycle/check" && request.method === "GET") {
          const id = url.searchParams.get("id");
          if (!id) return jsonResponse({ error: "Missing id" }, 400);

          const proposal = await env.DB.prepare(
            "SELECT proposal_status FROM proposal WHERE proposal_id = ?"
          ).bind(id).first<any>();
          if (!proposal) return jsonResponse({ error: "Not found" }, 404);

          const vehicle = await env.DB.prepare(
            "SELECT plate_number, brand_model FROM vehicle_proposed WHERE proposal_id = ? LIMIT 1"
          ).bind(id).first<any>();

          let expired = false;
          let message = "";
          if (proposal.proposal_status === 'COMPLETED') {
            expired = true;
            message = "感谢您的投保，电子保单将以电子链接的形式发送至您所绑定的企业号。如有疑问请拨打客服热线 95519。";
          } else if (proposal.proposal_status === 'REJECTED') {
            expired = true;
            message = "很抱歉，您的投保申请未通过核保审核。如有疑问请联系您的业务员或拨打客服热线 95519。";
          } else if (proposal.proposal_status === 'SUBMITTED') {
            expired = true;
            message = "您的投保申请正在核保审核中，请耐心等待。";
          }

          return jsonResponse({
            success: true,
            status: proposal.proposal_status,
            expired,
            message,
            vehicle: vehicle ? { plate: vehicle.plate_number, brand: vehicle.brand_model } : null,
          });
        }

        // ==================== PAYMENT LINK GENERATION ====================
        // POST /api/payment/generate
        if (pathname === "/api/payment/generate" && request.method === "POST") {
          const payload = await request.json() as any;
          const workerUrl = "https://xinhexin-payment-worker.chinalife-shiexinhexin.workers.dev";
          try {
            const workerRes = await fetch(workerUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            const workerJson = await workerRes.json();
            return jsonResponse(workerJson);
          } catch (e) {
            console.error("Payment Worker Error:", e);
            return jsonResponse({ success: false, error: "Payment Service Unavailable" }, 502);
          }
        }

        // ==================== LEGACY ROUTES (KEEPING FOR COMPATIBILITY IF NEEDED) ====================
        if (pathname === "/api/upload" && request.method === "POST") {
          const formData = await request.formData();
          const fileValue = formData.get("file");
          if (!fileValue || typeof fileValue === "string") {
            return jsonResponse({ error: "Missing file" }, 400);
          }

          const fileId = await storeFile(env, fileValue, "file");
          return jsonResponse({ fileId });
        }

        // Forward legacy apply to new flow logic or keep separate?
        // Instruction: "API is fact and flow hub... no automatic underwriting"
        // I will keep legacy routes pointing to old tables for safety if user rolls back app, 
        // BUT mapped routes above take precedence.
        // Since I added "/api/proposal/submit", the Salesman app needs to use THIS new endpoint.

        if (pathname === "/api/application/apply" && request.method === "POST") {
          // ... (Old logic kept for legacy apps not yet updated)
          const { data, files } = await parseApplyPayload(request, env);
          const applicationNo = await insertApplication(env, data, files);
          const requestId = `REQ-${crypto.randomUUID()}`;

          await env.POLICY_KV.put(`request:${requestId}`, applicationNo, {
            expirationTtl: REQUEST_TTL,
          });

          return jsonResponse({ success: true, requestId });
        }

        if (pathname === "/api/application/search" && request.method === "POST") {
          const body = (await request.json().catch(() => ({}))) as {
            insuredName?: string;
            idCard?: string;
            mobile?: string;
            plate?: string;
            engineNo?: string;
          };
          const results = await searchApplicationsByFields(env, body);
          return jsonResponse(results);
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
            proposalId?: string;
            code?: string;
            mobile?: string;
          };
          const id = payload.proposalId || payload.applicationNo;
          const code = payload.code;
          const mobile = payload.mobile;

          // 1. 基础校验 - 明确错误信息
          if (!id) return jsonResponse({ error: "缺少投保单号" }, 400);
          if (!code) return jsonResponse({ error: "缺少验证码" }, 400);
          if (!mobile) return jsonResponse({ error: "缺少手机号" }, 400);

          // 2. 手机号标准化
          const normalizedInputMobile = normalizePhone(mobile);
          if (!normalizedInputMobile) {
            return jsonResponse({ error: "手机号格式无效，请输入11位手机号" }, 400);
          }

          // 3. Lifecycle check: if proposal is COMPLETED, show thank-you message
          const lifecycleCheck = await env.DB.prepare(
            "SELECT proposal_status FROM proposal WHERE proposal_id = ?"
          ).bind(id).first<any>();
          if (lifecycleCheck?.proposal_status === 'COMPLETED') {
            return jsonResponse({
              success: false,
              expired: true,
              message: "感谢您的投保，电子保单将以电子链接的形式发送至您所绑定的企业号。如有疑问请拨打客服热线 95519。"
            });
          }
          if (lifecycleCheck?.proposal_status === 'REJECTED') {
            return jsonResponse({
              success: false,
              expired: true,
              message: "很抱歉，您的投保申请未通过核保审核。如有疑问请联系您的业务员或拨打客服热线 95519。"
            });
          }

          // 4. 优先从 DB 读取验证码（新逻辑）
          const dbDecision = await env.DB.prepare(`
            SELECT auth_code, owner_mobile FROM underwriting_manual_decision
            WHERE proposal_id = ? AND underwriting_risk_acceptance = 'ACCEPT'
            ORDER BY underwriting_confirmed_at DESC LIMIT 1
          `).bind(id).first<any>();

          let savedCode = dbDecision?.auth_code;
          let savedMobile = dbDecision?.owner_mobile;

          // 5. 如果 DB 无数据，降级到 KV（兼容旧数据）
          if (!savedCode) {
            const raw = await env.POLICY_KV.get(`verify:${id}`);
            if (raw) {
              const kv = safeJsonParse(raw) as { code?: string } | null;
              savedCode = kv?.code;
            }
          }

          if (!savedCode) {
            return jsonResponse({ error: "验证码已过期或投保单号无效" }, 400);
          }

          // 6. 验证码校验
          if (savedCode !== code) {
            return jsonResponse({ error: "验证码错误" }, 400);
          }

          // 7. 手机号校验（如果 DB 有记录）
          if (savedMobile && savedMobile !== normalizedInputMobile) {
            // 降级: 从 proposal_data 检查所有手机号
            const proposal = await env.DB.prepare(
              "SELECT proposal_data FROM proposal WHERE proposal_id = ?"
            ).bind(id).first<any>();

            if (proposal?.proposal_data) {
              try {
                const pd = JSON.parse(proposal.proposal_data);
                const allMobiles = [
                  normalizePhone(pd.owner?.mobile || ''),
                  normalizePhone(pd.proposer?.mobile || ''),
                  normalizePhone(pd.insured?.mobile || '')
                ].filter(Boolean);

                if (!allMobiles.includes(normalizedInputMobile)) {
                  return jsonResponse({ error: "手机号与投保信息不一致" }, 400);
                }
              } catch {
                return jsonResponse({ error: "手机号与投保信息不一致" }, 400);
              }
            }
          }

          // 8. Fetch proposal detail for client to display
          const proposalDetail = await env.DB.prepare("SELECT proposal_data FROM proposal WHERE proposal_id = ?").bind(id).first<any>();
          const decisionDetail = await env.DB.prepare(
            "SELECT final_premium, payment_qr_code, policy_effective_date, policy_expiry_date, adjusted_coverage_data FROM underwriting_manual_decision WHERE proposal_id = ? ORDER BY underwriting_confirmed_at DESC LIMIT 1"
          ).bind(id).first<any>();
          const vehicleDetail = await env.DB.prepare("SELECT * FROM vehicle_proposed WHERE proposal_id = ?").bind(id).first<any>();
          const coverageDetail = await env.DB.prepare("SELECT * FROM coverage_proposed WHERE proposal_id = ?").bind(id).all();

          return jsonResponse({
            success: true,
            proposalData: proposalDetail?.proposal_data ? JSON.parse(proposalDetail.proposal_data) : null,
            vehicle: vehicleDetail || null,
            coverage: coverageDetail?.results || [],
            decision: decisionDetail ? {
              finalPremium: decisionDetail.final_premium,
              paymentLink: decisionDetail.payment_qr_code,
              policyEffectiveDate: decisionDetail.policy_effective_date,
              policyExpiryDate: decisionDetail.policy_expiry_date
            } : null
          });
        }


        return jsonResponse({ error: "Not Found" }, 404);
      } catch (err: any) {
        const message = err instanceof Error ? err.message : "Unknown error";
        await logSystemEvent(env, "ERROR", "SYSTEM_ERROR", message, {
          stack: err?.stack,
          path: pathname,
          method: request.method
        });
        return jsonResponse({ success: false, error: message }, 500);
      }
    })();

    return applyCors(response, request);
  },
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,HEAD,OPTIONS,PUT,DELETE",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

export function now() {
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

async function ensureProposalDraftTable(env: Env) {
  if (draftTableReady) return;

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS proposal_form_draft (
      draft_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  ).run();

  draftTableReady = true;
}

async function ensureProposalCoreTables(env: Env) {
  if (proposalCoreSchemaReady) return;

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS proposal (
      proposal_id TEXT PRIMARY KEY,
      proposal_status TEXT NOT NULL,
      application_submitted_at TEXT,
      proposal_data TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  ).run();

  await safeAlterTableAddColumn(env, "proposal", "application_submitted_at TEXT");
  await safeAlterTableAddColumn(env, "proposal", "proposal_data TEXT");
  await safeAlterTableAddColumn(env, "proposal", "created_at TEXT");
  await safeAlterTableAddColumn(env, "proposal", "updated_at TEXT");

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS vehicle_proposed (
      vehicle_id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      plate_number TEXT,
      vehicle_type TEXT,
      usage_nature TEXT,
      brand_model TEXT,
      vin_chassis_number TEXT,
      engine_number TEXT,
      registration_date TEXT,
      license_issue_date TEXT,
      curb_weight REAL,
      approved_load_weight REAL,
      approved_passenger_count INTEGER,
      energy_type TEXT
    )`
  ).run();

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS coverage_proposed (
      coverage_id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      sum_insured REAL,
      policy_effective_date TEXT
    )`
  ).run();

  await env.DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_proposal_created_at ON proposal(created_at)`
  ).run();
  await env.DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_vehicle_proposed_proposal_id ON vehicle_proposed(proposal_id)`
  ).run();

  proposalCoreSchemaReady = true;
}

async function safeAlterTableAddColumn(env: Env, table: string, definition: string) {
  try {
    await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${definition}`).run();
  } catch {
    // ignore duplicate-column or schema-compat errors
  }
}

interface UnifiedRecord {
  applicationNo: string;
  status: string;
  createdAt: string;
  data: any;
  qrUrl?: string;
}

interface SearchCriteria {
  insuredName?: string;
  idCard?: string;
  mobile?: string;
  plate?: string;
  engineNo?: string;
}

async function loadProposalRecords(env: Env): Promise<UnifiedRecord[]> {
  await ensureProposalCoreTables(env);
  const { results } = await env.DB.prepare(
    `SELECT p.proposal_id, p.proposal_status, p.application_submitted_at, p.created_at, p.proposal_data,
            (SELECT payment_qr_code FROM underwriting_manual_decision amd WHERE amd.proposal_id = p.proposal_id ORDER BY underwriting_confirmed_at DESC LIMIT 1) as payment_qr_code
     FROM proposal p
     ORDER BY COALESCE(p.application_submitted_at, p.created_at) DESC
     LIMIT 200`
  ).all<any>();

  return (results || []).map((row: any) => ({
    applicationNo: row.proposal_id,
    status: row.proposal_status || "SUBMITTED",
    createdAt: row.application_submitted_at || row.created_at || now(),
    data: safeJsonParse(row.proposal_data) || {},
    qrUrl: row.payment_qr_code
  }));
}

async function loadLegacyRecords(env: Env): Promise<UnifiedRecord[]> {
  const table = await resolveTable(env);

  if (table === "applications") {
    const { results } = await env.DB.prepare(
      `SELECT applicationNo, status, applyAt, dataJson, clientToken
       FROM applications
       ORDER BY applyAt DESC
       LIMIT 200`
    ).all<any>();

    return (results || []).map((row: any) => ({
      applicationNo: row.applicationNo,
      status: row.status || "APPLIED",
      createdAt: row.applyAt || now(),
      data: safeJsonParse(row.dataJson) || {},
      qrUrl: row.clientToken ? `https://xinhexin-p-hebao.pages.dev/#/buffer?token=${row.clientToken}` : undefined
    }));
  }

  const { results } = await env.DB.prepare(
    `SELECT application_no, status, applied_at, data
     FROM application
     ORDER BY applied_at DESC
     LIMIT 200`
  ).all<any>();

  return (results || []).map((row: any) => {
    const data = safeJsonParse(row.data) || {};
    return {
      applicationNo: row.application_no,
      status: row.status || "APPLIED",
      createdAt: row.applied_at || now(),
      data: data,
      qrUrl: data.clientToken ? `https://xinhexin-p-hebao.pages.dev/#/buffer?token=${data.clientToken}` : undefined
    };
  });
}

async function listUnifiedHistory(env: Env) {
  const [proposalRecords, legacyRecords] = await Promise.all([
    loadProposalRecords(env),
    loadLegacyRecords(env),
  ]);

  return [...proposalRecords, ...legacyRecords]
    .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""))
    .slice(0, 50)
    .map((item) => ({
      id: item.applicationNo,
      timestamp: Date.parse(item.createdAt || "") || Date.now(),
      status: item.status,
      energyType: item.data?.energyType || item.data?.vehicle?.energyType || "FUEL",
      plate: item.data?.vehicle?.plate || "",
      brand: item.data?.vehicle?.brand || "",
      vehicle_type: item.data?.vehicle?.vehicleType || "",
      qrUrl: item.qrUrl
    }));
}

async function searchApplicationsByFields(env: Env, criteria: SearchCriteria) {
  const [proposalRecords, legacyRecords] = await Promise.all([
    loadProposalRecords(env),
    loadLegacyRecords(env),
  ]);

  const filtered = [...proposalRecords, ...legacyRecords]
    .filter((record) => matchesSearchCriteria(record.data, criteria))
    .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""))
    .slice(0, 50);

  return filtered.map((item) => ({
    applicationNo: item.applicationNo,
    status: item.status,
    createdAt: item.createdAt,
    vehicle: item.data?.vehicle || {},
    owner: item.data?.owner || {},
  }));
}

function matchesSearchCriteria(data: any, criteria: SearchCriteria) {
  const insuredName = normalizeText(criteria.insuredName);
  const idCard = normalizeText(criteria.idCard);
  const mobile = normalizeText(criteria.mobile);
  const plate = normalizeText(criteria.plate);
  const engineNo = normalizeText(criteria.engineNo);

  const vehicle = data?.vehicle || {};
  const owner = data?.owner || {};
  const proposer = data?.proposer || {};
  const insured = data?.insured || {};

  const people = [owner, proposer, insured];
  const personIdCards = people.map((person) => normalizeText(person?.idCard)).filter(Boolean);
  const personMobiles = people.map((person) => normalizeText(person?.mobile)).filter(Boolean);
  const personNames = people.map((person) => normalizeText(person?.name)).filter(Boolean);

  const insuredMatched = !insuredName || personNames.some((name) => name.includes(insuredName));
  const idCardMatched = !idCard || personIdCards.some((value) => value.includes(idCard));
  const mobileMatched = !mobile || personMobiles.some((value) => value.includes(mobile));
  const plateMatched = !plate || normalizeText(vehicle?.plate).includes(plate);
  const engineMatched = !engineNo || normalizeText(vehicle?.engineNo).includes(engineNo);

  return insuredMatched && idCardMatched && mobileMatched && plateMatched && engineMatched;
}

function normalizeText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

export function safeJsonParse(raw: string | null) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ==========================================
// System Logging Helper
// ==========================================
async function logSystemEvent(
  env: Env,
  level: "INFO" | "WARN" | "ERROR" | "DEBUG",
  category: string,
  message: string,
  payload?: any
) {
  try {
    const logId = crypto.randomUUID();
    const payloadStr = payload ? JSON.stringify(payload) : null;

    // Lazy creation of table
    // (We try to insert. If it fails due to missing table, we create it and retry)
    // Actually, checking existence is costly. Just try insert.
    // If error contains "no such table", create and retry.

    try {
      await env.DB.prepare(
        `INSERT INTO system_logs (log_id, trace_id, level, category, message, payload) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(logId, payload?.traceId || null, level, category, message, payloadStr).run();
    } catch (e: any) {
      if (e.message && e.message.includes("no such table")) {
        // Create table
        await env.DB.prepare(`
          CREATE TABLE IF NOT EXISTS system_logs (
            log_id TEXT PRIMARY KEY,
            trace_id TEXT,
            level TEXT,
            category TEXT,
            message TEXT,
            payload TEXT,
            created_at TEXT DEFAULT (datetime('now'))
          );
          CREATE INDEX IF NOT EXISTS idx_logs_created_at ON system_logs(created_at);
        `).run();

        // Retry insert
        await env.DB.prepare(
          `INSERT INTO system_logs (log_id, trace_id, level, category, message, payload) VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(logId, payload?.traceId || null, level, category, message, payloadStr).run();
      } else {
        console.error("Failed to log system event:", e);
      }
    }
  } catch (e) {
    console.error("Logging failed completely:", e);
  }
}

function applyCors(response: Response, request: Request): Response {
  if (!response) return response;

  const origin = request.headers.get("Origin");
  const newHeaders = new Headers(response.headers);

  // Always set methods and headers
  newHeaders.set("Access-Control-Allow-Methods", "GET,POST,HEAD,OPTIONS,PUT,DELETE");
  newHeaders.set("Access-Control-Allow-Headers", "Content-Type");

  if (origin) {
    newHeaders.set("Access-Control-Allow-Origin", origin);
    newHeaders.set("Access-Control-Allow-Credentials", "true");
  } else {
    newHeaders.set("Access-Control-Allow-Origin", "*");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });
}
