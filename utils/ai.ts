/**
 * AI Utilities (Backend Only)
 * Phase-1 标准实现
 *
 * 说明：
 * - 只允许在 xinhexin-api 中存在
 * - 只通过 API 被前端调用
 * - 不允许被前端 import
 */

const API_KEY = (globalThis as any).API_KEY;

if (!API_KEY) {
    throw new Error('AI API_KEY is not configured');
}

/**
 * 证件识别（身份证 / 营业执照）
 */
export async function scanPersonDocument(imageBase64: string) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content:
                        '你是保险系统的证件识别助手，请从图片中提取姓名、证件类型、证件号、地址等结构化信息，仅返回 JSON。'
                },
                {
                    role: 'user',
                    content: imageBase64
                }
            ]
        })
    });

    if (!res.ok) {
        throw new Error('AI person document scan failed');
    }

    return res.json();
}

/**
 * 行驶证 / 车辆证件识别
 */
export async function scanVehicleDocument(imageBase64: string) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content:
                        '你是保险系统的车辆证件识别助手，请从图片中提取车牌号、VIN、发动机号、品牌型号、注册日期等结构化信息，仅返回 JSON。'
                },
                {
                    role: 'user',
                    content: imageBase64
                }
            ]
        })
    });

    if (!res.ok) {
        throw new Error('AI vehicle document scan failed');
    }

    return res.json();
}