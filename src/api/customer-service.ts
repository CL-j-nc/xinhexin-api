// Customer Service API - 团体客户服务管家（AI客服）
// 提供拟人态AI客服对话功能

import type { Env } from "../index";

// 会话状态
type SessionStatus = "active" | "escalated" | "closed";

// 消息角色
type MessageRole = "customer" | "assistant" | "system";

// 置信度阈值
const CONFIDENCE_THRESHOLD = 0.7;
const ESCALATION_THRESHOLD = 0.4;

// 创建会话
async function createSession(
    env: Env,
    customerName?: string,
    customerPhone?: string
) {
    const sessionId = `CS-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
    const now = new Date().toISOString();

    await env.DB.prepare(
        `
    INSERT INTO customer_service_session (session_id, customer_name, customer_phone, status, created_at, last_message_at)
    VALUES (?, ?, ?, 'active', ?, ?)
    `
    )
        .bind(sessionId, customerName || null, customerPhone || null, now, now)
        .run();

    // 发送欢迎消息
    const welcomeMessage = getWelcomeMessage();
    await saveMessage(env, sessionId, "assistant", welcomeMessage, 1.0);

    return {
        sessionId,
        welcomeMessage,
        createdAt: now,
    };
}

// 发送消息并获取回复
async function sendMessage(
    env: Env,
    sessionId: string,
    content: string
) {
    // 验证会话存在且活跃
    const session = await env.DB.prepare(
        `SELECT status FROM customer_service_session WHERE session_id = ?`
    )
        .bind(sessionId)
        .first<any>();

    if (!session) {
        return { success: false, error: "会话不存在" };
    }

    if (session.status === "closed") {
        return { success: false, error: "会话已结束" };
    }

    if (session.status === "escalated") {
        return {
            success: true,
            reply: "您的咨询已转交人工客服处理，请稍候。如需继续AI服务，请发起新会话。",
            isEscalated: true,
        };
    }

    // 保存用户消息
    await saveMessage(env, sessionId, "customer", content, null);

    // 检查是否请求人工
    if (isEscalationRequest(content)) {
        await escalateSession(env, sessionId, "客户主动请求人工服务");
        return {
            success: true,
            reply: "好的，我正在为您转接人工客服，请稍候。人工客服工作时间为工作日 9:00-18:00。",
            isEscalated: true,
        };
    }

    // 生成AI回复
    const { reply, confidence, matchedFaq } = await generateReply(env, content);

    // 保存AI回复
    await saveMessage(env, sessionId, "assistant", reply, confidence);

    // 更新最后消息时间
    await env.DB.prepare(
        `UPDATE customer_service_session SET last_message_at = ? WHERE session_id = ?`
    )
        .bind(new Date().toISOString(), sessionId)
        .run();

    // 如果置信度太低，自动升级
    if (confidence < ESCALATION_THRESHOLD) {
        await escalateSession(env, sessionId, "AI置信度过低，自动升级");
        return {
            success: true,
            reply: reply + "\n\n由于您的问题较为复杂，我已为您转接人工客服，请稍候。",
            isEscalated: true,
            confidence,
        };
    }

    // 如果置信度中等，提示可转人工
    let finalReply = reply;
    if (confidence < CONFIDENCE_THRESHOLD) {
        finalReply += "\n\n如果这没有解答您的问题，您可以说转人工获得进一步帮助。";
    }

    return {
        success: true,
        reply: finalReply,
        confidence,
        matchedFaq,
    };
}

// 生成回复
async function generateReply(
    env: Env,
    content: string
): Promise<{ reply: string; confidence: number; matchedFaq: string | null }> {
    // 首先尝试FAQ匹配
    const faqMatch = await matchFaq(env, content);

    if (faqMatch && faqMatch.confidence > 0.6) {
        // 增加FAQ命中次数
        await env.DB.prepare(
            `UPDATE faq_knowledge SET hit_count = hit_count + 1 WHERE id = ?`
        )
            .bind(faqMatch.id)
            .run();

        return {
            reply: faqMatch.answer,
            confidence: faqMatch.confidence,
            matchedFaq: faqMatch.question,
        };
    }

    // 使用基于规则的回复生成
    const ruleBasedReply = generateRuleBasedReply(content);

    return {
        reply: ruleBasedReply.reply,
        confidence: ruleBasedReply.confidence,
        matchedFaq: null,
    };
}

// FAQ匹配
async function matchFaq(
    env: Env,
    content: string
): Promise<{ id: number; question: string; answer: string; confidence: number } | null> {
    const { results } = await env.DB.prepare(
        `
    SELECT id, question, answer, keywords
    FROM faq_knowledge
    WHERE is_active = 1
    ORDER BY priority DESC
    `
    ).all();

    if (!results || results.length === 0) return null;

    const contentLower = content.toLowerCase();
    let bestMatch: { id: number; question: string; answer: string; confidence: number } | null = null;
    let highestScore = 0;

    for (const faq of results) {
        const f = faq as any;
        const keywords = (f.keywords || "").split(",").map((k: string) => k.trim().toLowerCase());
        const questionWords = f.question.toLowerCase().split(/\s+/);

        // 计算关键词匹配分数
        let matchCount = 0;
        for (const keyword of keywords) {
            if (keyword && contentLower.includes(keyword)) {
                matchCount++;
            }
        }
        for (const word of questionWords) {
            if (word.length > 1 && contentLower.includes(word)) {
                matchCount += 0.5;
            }
        }

        const confidence = Math.min(matchCount / Math.max(keywords.length, 1), 1);

        if (confidence > highestScore) {
            highestScore = confidence;
            bestMatch = {
                id: f.id,
                question: f.question,
                answer: f.answer,
                confidence,
            };
        }
    }

    return bestMatch;
}

// 基于规则的回复生成
function generateRuleBasedReply(content: string): { reply: string; confidence: number } {
    const contentLower = content.toLowerCase();

    // 意图识别规则
    const intents = [
        {
            keywords: ["保单", "查询", "查", "看", "我的"],
            reply: `您好，您可以在"保单服务中心"查询保单信息。

请准备好以下任一信息：
• 保单号
• 身份证号码
• 车牌号码

查询步骤：进入保单服务中心 → 输入查询信息 → 查看保单详情

请问您是否需要查询保单？我可以指引您操作。`,
            confidence: 0.85,
        },
        {
            keywords: ["理赔", "报案", "出险", "事故", "赔"],
            reply: `关于理赔报案，您可以通过"报案中心"进行在线报案。

报案流程：
1. 进入报案中心
2. 选择报案类型
3. 填写事故信息
4. 提交报案申请

报案后您将获得报案编号，可随时查询进度。

请问您是需要报案还是查询理赔进度？`,
            confidence: 0.85,
        },
        {
            keywords: ["进度", "到哪了", "什么时候", "多久"],
            reply: `您可以在"理赔进度"页面查询您的理赔案件状态。

请准备好您的：
• 理赔编号（CLM开头）
• 或报案编号（RPT开头）

理赔一般处理时间：
• 普通案件：材料齐全后30个工作日内
• 复杂案件：可能需要60个工作日

请问您有理赔编号吗？`,
            confidence: 0.8,
        },
        {
            keywords: ["材料", "需要", "准备", "什么"],
            reply: `理赔所需材料根据险种类型有所不同，一般包括：

基础材料：
• 身份证复印件
• 保单复印件
• 银行账户信息

具体材料清单将在报案后生成，您可以在"材料提交"页面查看详细要求。

请问您是什么类型的理赔？我可以告诉您更具体的材料要求。`,
            confidence: 0.8,
        },
        {
            keywords: ["续保", "续费", "到期", "缴费"],
            reply: `关于续保缴费，请注意：

• 请在保单到期前30天内办理续保
• 支持银行代扣、在线支付等方式
• 逾期可能导致保障中断

如需续保，请联系您的专属服务人员或前往服务网点办理。

请问您的保单即将到期吗？`,
            confidence: 0.8,
        },
    ];

    for (const intent of intents) {
        const matchCount = intent.keywords.filter(k => contentLower.includes(k)).length;
        if (matchCount >= 2 || (matchCount === 1 && content.length < 20)) {
            return { reply: intent.reply, confidence: intent.confidence };
        }
    }

    // 默认回复
    return {
        reply: `感谢您的咨询。我可以帮助您：

• 查询保单信息
• 办理理赔报案
• 查询理赔进度
• 了解投保续保

请告诉我您需要什么帮助？

如果您的问题比较复杂，可以说"转人工"获得专业客服的帮助。`,
        confidence: 0.5,
    };
}

// 获取欢迎消息
function getWelcomeMessage(): string {
    return `您好，欢迎使用SHIE人寿在线服务。

我是您的服务助手，可以帮助您：
• 📋 查询保单信息
• 📝 办理理赔报案
• 🔍 查询理赔进度
• 📄 查看服务条款

请问有什么可以帮您的？`;
}

// 检查是否请求人工
function isEscalationRequest(content: string): boolean {
    const keywords = ["人工", "转人工", "客服", "人工客服", "转接人工", "真人"];
    const contentLower = content.toLowerCase();
    return keywords.some(k => contentLower.includes(k));
}

// 升级到人工
async function escalateSession(env: Env, sessionId: string, reason: string) {
    const now = new Date().toISOString();

    await env.DB.prepare(
        `
    UPDATE customer_service_session
    SET status = 'escalated', escalation_reason = ?, escalated_at = ?
    WHERE session_id = ?
    `
    )
        .bind(reason, now, sessionId)
        .run();

    await saveMessage(
        env,
        sessionId,
        "system",
        `会话已升级至人工客服。原因：${reason}`,
        null
    );
}

// 保存消息
async function saveMessage(
    env: Env,
    sessionId: string,
    role: MessageRole,
    content: string,
    confidence: number | null
) {
    await env.DB.prepare(
        `
    INSERT INTO customer_service_message (session_id, role, content, confidence, created_at)
    VALUES (?, ?, ?, ?, ?)
    `
    )
        .bind(sessionId, role, content, confidence, new Date().toISOString())
        .run();
}

// 获取会话历史
async function getSessionHistory(env: Env, sessionId: string) {
    const session = await env.DB.prepare(
        `SELECT * FROM customer_service_session WHERE session_id = ?`
    )
        .bind(sessionId)
        .first<any>();

    if (!session) return null;

    const { results: messages } = await env.DB.prepare(
        `
    SELECT role, content, created_at
    FROM customer_service_message
    WHERE session_id = ?
    ORDER BY created_at ASC
    `
    )
        .bind(sessionId)
        .all();

    return {
        sessionId: session.session_id,
        status: session.status,
        customerName: session.customer_name,
        createdAt: session.created_at,
        lastMessageAt: session.last_message_at,
        messages: (messages || []).map((m: any) => ({
            role: m.role,
            content: m.content,
            createdAt: m.created_at,
        })),
    };
}

// 关闭会话
async function closeSession(env: Env, sessionId: string) {
    const now = new Date().toISOString();

    await env.DB.prepare(
        `
    UPDATE customer_service_session
    SET status = 'closed', closed_at = ?
    WHERE session_id = ? AND status != 'closed'
    `
    )
        .bind(now, sessionId)
        .run();

    await saveMessage(env, sessionId, "system", "会话已结束。感谢您使用SHIE人寿在线服务。", null);

    return { success: true };
}

// 路由处理
export async function handleCustomerServiceRoutes(
    request: Request,
    env: Env,
    pathname: string
): Promise<Response | null> {
    // POST /api/cs/session/create - 创建会话
    if (pathname === "/api/cs/session/create" && request.method === "POST") {
        const body = (await request.json().catch(() => ({}))) as {
            customerName?: string;
            customerPhone?: string;
        };

        const session = await createSession(env, body.customerName, body.customerPhone);
        return jsonResponse({ success: true, data: session });
    }

    // POST /api/cs/message - 发送消息
    if (pathname === "/api/cs/message" && request.method === "POST") {
        const body = (await request.json().catch(() => ({}))) as {
            sessionId: string;
            content: string;
        };

        if (!body.sessionId || !body.content) {
            return jsonResponse({ error: "缺少会话ID或消息内容" }, 400);
        }

        const result = await sendMessage(env, body.sessionId, body.content);
        return jsonResponse(result, result.success ? 200 : 400);
    }

    // GET /api/cs/session/:sessionId - 获取会话历史
    const sessionMatch = pathname.match(/^\/api\/cs\/session\/([A-Z0-9-]+)$/);
    if (sessionMatch && request.method === "GET") {
        const sessionId = sessionMatch[1];
        const history = await getSessionHistory(env, sessionId);

        if (!history) {
            return jsonResponse({ error: "会话不存在" }, 404);
        }

        return jsonResponse({ success: true, data: history });
    }

    // POST /api/cs/escalate - 升级到人工
    if (pathname === "/api/cs/escalate" && request.method === "POST") {
        const body = (await request.json().catch(() => ({}))) as {
            sessionId: string;
            reason?: string;
        };

        if (!body.sessionId) {
            return jsonResponse({ error: "缺少会话ID" }, 400);
        }

        await escalateSession(env, body.sessionId, body.reason || "客户请求人工服务");
        return jsonResponse({
            success: true,
            message: "已转接人工客服，请稍候",
        });
    }

    // POST /api/cs/session/:sessionId/close - 关闭会话
    const closeMatch = pathname.match(/^\/api\/cs\/session\/([A-Z0-9-]+)\/close$/);
    if (closeMatch && request.method === "POST") {
        const sessionId = closeMatch[1];
        const result = await closeSession(env, sessionId);
        return jsonResponse(result);
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
