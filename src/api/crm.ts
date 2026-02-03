// CRM API 路由和控制器（符合 newcore-CRM 规范）
// 所有数据通过 vehicle_policy_uid 关联 vehicle_insurance_master

interface Env {
    DB: D1Database;
    POLICY_KV: KVNamespace;
}

// flag_type 枚举值
const VALID_FLAG_TYPES = ['VIP客户', '高风险', '欺诈嫌疑', '优质客户', '续保重点', '投诉敏感'];

export async function handleCRMRoutes(request: Request, env: Env, pathname: string) {
    // 健康检查
    if (pathname === "/api/health" && request.method === "HEAD") {
        return new Response(null, {
            status: 200,
            headers: { ...corsHeaders() }
        });
    }

    // ========== 规范接口 ==========

    // GET /api/crm/by-vehicle - 按车牌/VIN查询（核心入口）
    if (pathname === "/api/crm/by-vehicle" && request.method === "GET") {
        const url = new URL(request.url);
        const plate = url.searchParams.get("plate") || "";
        const vin = url.searchParams.get("vin") || "";

        if (!plate && !vin) {
            return jsonResponse({ error: "必须提供 plate 或 vin 参数" }, 400);
        }

        // 验证车牌格式
        if (plate && !isValidPlate(plate)) {
            return jsonResponse({ error: "车牌号格式非法" }, 400);
        }

        const profile = await getVehicleProfileByPlateOrVin(env, plate, vin);
        if (!profile) {
            return jsonResponse([], 200); // 规范：不存在返回空
        }
        return jsonResponse(profile);
    }

    // GET /api/crm/timeline - 获取时间轴
    if (pathname === "/api/crm/timeline" && request.method === "GET") {
        const url = new URL(request.url);
        const vehiclePolicyUid = url.searchParams.get("vehicle_policy_uid");

        if (!vehiclePolicyUid) {
            return jsonResponse({ error: "缺少 vehicle_policy_uid" }, 400);
        }

        // 验证 vehicle_policy_uid 存在于主表
        const exists = await checkVehiclePolicyExists(env, vehiclePolicyUid);
        if (!exists) {
            return jsonResponse([], 200); // 规范：不存在返回空
        }

        const timeline = await getTimeline(env, vehiclePolicyUid);
        return jsonResponse(timeline);
    }

    // POST /api/crm/interaction/add - 添加沟通记录
    if (pathname === "/api/crm/interaction/add" && request.method === "POST") {
        const body = await request.json() as any;

        // 验证必填字段
        if (!body.vehicle_policy_uid) {
            return jsonResponse({ error: "vehicle_policy_uid 必填" }, 400);
        }
        if (!body.topic) {
            return jsonResponse({ error: "topic 必填，沟通主题必须明确" }, 400);
        }
        if (!body.contact_method) {
            return jsonResponse({ error: "contact_method 必填" }, 400);
        }
        if (!body.operator_name) {
            return jsonResponse({ error: "operator_name 必填" }, 400);
        }

        // 验证 vehicle_policy_uid 存在于主表
        const exists = await checkVehiclePolicyExists(env, body.vehicle_policy_uid);
        if (!exists) {
            return jsonResponse({ error: "无主表不得写CRM：vehicle_policy_uid 不存在" }, 400);
        }

        const interaction = await addInteraction(env, body);
        return jsonResponse(interaction);
    }

    // POST /api/crm/flag/add - 添加风险标记
    if (pathname === "/api/crm/flag/add" && request.method === "POST") {
        const body = await request.json() as any;

        // 验证必填字段
        if (!body.vehicle_policy_uid) {
            return jsonResponse({ error: "CRM 必须挂车：vehicle_policy_uid 必填" }, 400);
        }
        if (!body.flag_type) {
            return jsonResponse({ error: "flag_type 必填" }, 400);
        }
        if (!body.created_by) {
            return jsonResponse({ error: "created_by 必填" }, 400);
        }

        // 验证 flag_type 枚举
        if (!VALID_FLAG_TYPES.includes(body.flag_type)) {
            return jsonResponse({
                error: `flag_type 非法值，必须为: ${VALID_FLAG_TYPES.join(', ')}`
            }, 400);
        }

        // 验证 vehicle_policy_uid 存在于主表
        const exists = await checkVehiclePolicyExists(env, body.vehicle_policy_uid);
        if (!exists) {
            return jsonResponse({ error: "CRM 必须挂车：vehicle_policy_uid 不存在" }, 400);
        }

        const flag = await addFlag(env, body);
        return jsonResponse(flag);
    }

    // ========== 兼容接口（保留旧路径） ==========

    // 获取沟通记录列表
    if (pathname.match(/^\/api\/crm\/vehicle\/[^/]+\/interactions$/) && request.method === "GET") {
        const vehiclePolicyUid = decodeURIComponent(pathname.split("/")[4]);
        const interactions = await getInteractions(env, vehiclePolicyUid);
        return jsonResponse(interactions);
    }

    // 获取标记列表
    if (pathname.match(/^\/api\/crm\/vehicle\/[^/]+\/flags$/) && request.method === "GET") {
        const vehiclePolicyUid = decodeURIComponent(pathname.split("/")[4]);
        const flags = await getFlags(env, vehiclePolicyUid);
        return jsonResponse(flags);
    }

    // 客户搜索
    if (pathname === "/api/crm/customers" && request.method === "GET") {
        const url = new URL(request.url);
        const query = url.searchParams.get("q") || "";
        const customers = await searchCustomers(env, query);
        return jsonResponse(customers);
    }

    // 车辆搜索
    if (pathname === "/api/crm/vehicles" && request.method === "GET") {
        const url = new URL(request.url);
        const query = url.searchParams.get("q") || "";
        const vehicles = await searchVehicles(env, query);
        return jsonResponse(vehicles);
    }

    return null;
}

// ========== 验证函数 ==========

function isValidPlate(plate: string): boolean {
    // 中国车牌号格式验证
    const plateRegex = /^[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼使领][A-Z][A-Z0-9]{5,6}$/;
    return plateRegex.test(plate);
}

async function checkVehiclePolicyExists(env: Env, vehiclePolicyUid: string): Promise<boolean> {
    const result = await env.DB.prepare(
        `SELECT 1 FROM vehicle_insurance_master WHERE vehicle_policy_uid = ? LIMIT 1`
    ).bind(vehiclePolicyUid).first();
    return !!result;
}

// ========== 数据库操作函数 ==========

async function getVehicleProfileByPlateOrVin(env: Env, plate: string, vin: string) {
    // 从主表查询车辆
    const vehicle = await env.DB.prepare(
        `SELECT vehicle_policy_uid, vehicle_plate_no, vehicle_vin, 
                policyholder_name, insured_name, underwriting_status, created_at
         FROM vehicle_insurance_master 
         WHERE vehicle_plate_no = ? OR vehicle_vin = ? 
         ORDER BY created_at DESC
         LIMIT 1`
    ).bind(plate || "", vin || "").first();

    if (!vehicle) return null;

    const vehiclePolicyUid = vehicle.vehicle_policy_uid as string;

    // 获取CRM扩展信息
    const crmProfile = await env.DB.prepare(
        `SELECT * FROM vehicle_crm_profile WHERE vehicle_policy_uid = ?`
    ).bind(vehiclePolicyUid).first();

    // 获取关系人
    const { results: contacts } = await env.DB.prepare(
        `SELECT * FROM vehicle_crm_contacts WHERE vehicle_policy_uid = ?`
    ).bind(vehiclePolicyUid).all();

    // 获取活跃标记
    const { results: flags } = await env.DB.prepare(
        `SELECT * FROM vehicle_crm_flags WHERE vehicle_policy_uid = ? AND is_active = 1`
    ).bind(vehiclePolicyUid).all();

    return {
        vehicle_policy_uid: vehiclePolicyUid,
        plate: vehicle.vehicle_plate_no,
        vin: vehicle.vehicle_vin,
        policyholder_name: vehicle.policyholder_name,
        insured_name: vehicle.insured_name,
        underwriting_status: vehicle.underwriting_status,
        current_status: crmProfile?.current_status || "ACTIVE",
        last_contact_time: crmProfile?.last_contact_time,
        remark: crmProfile?.remark,
        contacts: contacts || [],
        flags: flags || [],
    };
}

async function getTimeline(env: Env, vehiclePolicyUid: string) {
    const { results } = await env.DB.prepare(
        `SELECT * FROM vehicle_crm_timeline 
         WHERE vehicle_policy_uid = ? 
         ORDER BY event_time DESC`
    ).bind(vehiclePolicyUid).all();

    return results || [];
}

async function getInteractions(env: Env, vehiclePolicyUid: string) {
    const { results } = await env.DB.prepare(
        `SELECT * FROM vehicle_crm_interactions 
         WHERE vehicle_policy_uid = ? 
         ORDER BY interaction_time DESC`
    ).bind(vehiclePolicyUid).all();

    return results || [];
}

async function addInteraction(env: Env, data: any) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await env.DB.prepare(
        `INSERT INTO vehicle_crm_interactions 
         (interaction_id, vehicle_policy_uid, contact_method, topic, result, follow_up_status, interaction_time, operator_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        id,
        data.vehicle_policy_uid,
        data.contact_method,
        data.topic,
        data.result || "",
        data.follow_up_status || "待跟进",
        data.interaction_time || now,
        data.operator_name,
        now
    ).run();

    // 更新/创建CRM档案的最后联系时间
    await env.DB.prepare(
        `INSERT INTO vehicle_crm_profile (vehicle_policy_uid, last_contact_time, created_at)
         VALUES (?, ?, ?)
         ON CONFLICT(vehicle_policy_uid) DO UPDATE SET last_contact_time = ?`
    ).bind(data.vehicle_policy_uid, now, now, now).run();

    return {
        interaction_id: id,
        ...data,
        created_at: now,
    };
}

async function getFlags(env: Env, vehiclePolicyUid: string) {
    const { results } = await env.DB.prepare(
        `SELECT * FROM vehicle_crm_flags 
         WHERE vehicle_policy_uid = ? 
         ORDER BY created_at DESC`
    ).bind(vehiclePolicyUid).all();

    return results || [];
}

async function addFlag(env: Env, data: any) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await env.DB.prepare(
        `INSERT INTO vehicle_crm_flags 
         (flag_id, vehicle_policy_uid, flag_type, flag_note, is_active, created_at, created_by)
         VALUES (?, ?, ?, ?, 1, ?, ?)`
    ).bind(
        id,
        data.vehicle_policy_uid,
        data.flag_type,
        data.flag_note || "",
        now,
        data.created_by
    ).run();

    return {
        flag_id: id,
        ...data,
        is_active: true,
        created_at: now,
    };
}

async function searchCustomers(env: Env, query: string) {
    const sql = query
        ? `SELECT DISTINCT name, id_type, id_no, phone, role_type 
           FROM vehicle_crm_contacts 
           WHERE name LIKE ? OR phone LIKE ? OR id_no LIKE ?
           LIMIT 50`
        : `SELECT DISTINCT name, id_type, id_no, phone, role_type 
           FROM vehicle_crm_contacts 
           LIMIT 50`;

    const params = query ? [`%${query}%`, `%${query}%`, `%${query}%`] : [];
    const { results } = await env.DB.prepare(sql).bind(...params).all();

    return (results || []).map((r: any) => ({
        id: crypto.randomUUID(),
        name: r.name,
        idType: r.id_type || "身份证",
        idCard: r.id_no || "",
        mobile: r.phone || "",
        address: "",
        gender: "",
        identityType: "individual",
        tags: [r.role_type],
        usageCount: 0,
        isFavorite: false,
        createdAt: new Date().toISOString(),
    }));
}

async function searchVehicles(env: Env, query: string) {
    // 从主表搜索车辆
    const sql = query
        ? `SELECT vehicle_policy_uid, vehicle_plate_no, vehicle_vin, vehicle_model, created_at
           FROM vehicle_insurance_master 
           WHERE vehicle_plate_no LIKE ? OR vehicle_vin LIKE ?
           ORDER BY created_at DESC
           LIMIT 50`
        : `SELECT vehicle_policy_uid, vehicle_plate_no, vehicle_vin, vehicle_model, created_at
           FROM vehicle_insurance_master 
           ORDER BY created_at DESC
           LIMIT 50`;

    const params = query ? [`%${query}%`, `%${query}%`] : [];
    const { results } = await env.DB.prepare(sql).bind(...params).all();

    return (results || []).map((r: any) => ({
        id: r.vehicle_policy_uid,
        plate: r.vehicle_plate_no,
        vin: r.vehicle_vin,
        nickname: r.vehicle_plate_no,
        brand: r.vehicle_model || "",
        engineNo: "",
        registerDate: "",
        issueDate: "",
        useNature: "",
        vehicleType: "",
        curbWeight: "",
        approvedLoad: "",
        seats: 5,
        energyType: "FUEL",
        tags: [],
        usageCount: 0,
        isFavorite: false,
        createdAt: r.created_at,
    }));
}

function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,HEAD,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };
}

function jsonResponse(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
}
