// Document Center API - 文档中心
// 提供权威性声明、服务条款等制度文档的查询

import type { Env } from "../index";

// 文档分类映射
const categoryDisplay: Record<string, string> = {
    AUTHORITY: "平台权威性声明",
    TERMS: "服务条款",
    PRIVACY: "隐私政策",
    CLAIM_GUIDE: "理赔说明",
    RISK_NOTICE: "风险提示",
    REGULATION: "监管披露",
    OTHER: "其他",
};

// 获取文档分类列表
async function getDocumentCategories(env: Env) {
    const { results } = await env.DB.prepare(
        `
    SELECT category, COUNT(*) as count
    FROM document_center
    WHERE is_active = 1
    GROUP BY category
    ORDER BY MIN(sort_order)
    `
    ).all();

    return (results || []).map((row: any) => ({
        category: row.category,
        displayName: categoryDisplay[row.category] || row.category,
        count: row.count,
    }));
}

// 获取文档列表
async function getDocumentList(env: Env, category?: string) {
    let query = `
    SELECT doc_id, category, title, summary, version, published_at
    FROM document_center
    WHERE is_active = 1
  `;
    const values: string[] = [];

    if (category) {
        query += ` AND category = ?`;
        values.push(category);
    }

    query += ` ORDER BY sort_order ASC, published_at DESC`;

    const { results } = await env.DB.prepare(query).bind(...values).all();

    return (results || []).map((doc: any) => ({
        docId: doc.doc_id,
        category: doc.category,
        categoryDisplay: categoryDisplay[doc.category] || doc.category,
        title: doc.title,
        summary: doc.summary,
        version: doc.version,
        publishedAt: doc.published_at,
    }));
}

// 获取文档详情
async function getDocumentDetail(env: Env, docId: string) {
    const doc = await env.DB.prepare(
        `
    SELECT * FROM document_center WHERE doc_id = ? AND is_active = 1
    `
    )
        .bind(docId)
        .first<any>();

    if (!doc) return null;

    return {
        docId: doc.doc_id,
        category: doc.category,
        categoryDisplay: categoryDisplay[doc.category] || doc.category,
        title: doc.title,
        content: doc.content,
        summary: doc.summary,
        version: doc.version,
        publishedAt: doc.published_at,
        updatedAt: doc.updated_at,
    };
}

// 路由处理
export async function handleDocumentCenterRoutes(
    request: Request,
    env: Env,
    pathname: string
): Promise<Response | null> {
    // GET /api/docs/categories - 文档分类列表
    if (pathname === "/api/docs/categories" && request.method === "GET") {
        const categories = await getDocumentCategories(env);
        return jsonResponse({ success: true, data: categories });
    }

    // GET /api/docs/list?category=xxx - 文档列表
    if (pathname === "/api/docs/list" && request.method === "GET") {
        const url = new URL(request.url);
        const category = url.searchParams.get("category") || undefined;
        const documents = await getDocumentList(env, category);
        return jsonResponse({ success: true, data: documents });
    }

    // GET /api/docs/:docId - 文档详情
    const docMatch = pathname.match(/^\/api\/docs\/([A-Z0-9-]+)$/);
    if (docMatch && request.method === "GET") {
        const docId = docMatch[1];
        const doc = await getDocumentDetail(env, docId);

        if (!doc) {
            return jsonResponse({ error: "文档不存在" }, 404);
        }

        return jsonResponse({ success: true, data: doc });
    }

    return null;
}

function jsonResponse(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        },
    });
}
