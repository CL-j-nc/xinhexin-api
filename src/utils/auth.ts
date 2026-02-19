
import { D1Database, KVNamespace } from '@cloudflare/workers-types';
import { Env } from '../index'; // Assuming Env interface is in index.ts

// 生成6位随机验证码
export const generateAuthCode = (): string => {
  return String(Math.floor(100000 + Math.random() * 900000));
};

// 获取当前时间，格式为 ISO 8601
export const now = (): string => {
  return new Date().toISOString();
};

// 计算验证码过期时间
export const calculateExpiresAt = (expiresInMinutes: number): string => {
  const expiryDate = new Date();
  expiryDate.setMinutes(expiryDate.getMinutes() + expiresInMinutes);
  return expiryDate.toISOString();
};

// 手机号标准化：移除非数字字符，处理+86前缀
export const normalizePhone = (phone: string | null | undefined): string => {
  if (!phone) return '';
  // 移除所有非数字字符
  let normalized = String(phone).replace(/\D/g, '');
  // 移除国际区号 86
  if (normalized.startsWith('86') && normalized.length === 13) {
    normalized = normalized.slice(2);
  }
  // 验证是否为11位手机号
  if (normalized.length !== 11 || !normalized.startsWith('1')) {
    return ''; // 无效手机号返回空
  }
  return normalized;
};

// 与 phone_auth_limits 表交互的类型定义
export interface PhoneAuthLimit {
  mobile_phone: string;
  auth_code: string;
  remaining_attempts: number;
  max_attempts: number;
  last_accessed_at: string | null;
  created_at: string;
  updated_at: string;
  proposal_id: string | null;
  expires_at: string;
}

// 查询 phone_auth_limits 记录
export const getPhoneAuthLimit = async (
  env: Env,
  mobile: string,
  proposalId: string | null = null
): Promise<PhoneAuthLimit | null> => {
  let query = 'SELECT * FROM phone_auth_limits WHERE mobile_phone = ?';
  const params: (string | null)[] = [mobile];

  if (proposalId) {
    query += ' AND proposal_id = ?';
    params.push(proposalId);
  }

  const stmt = env.DB.prepare(query);
  const record = await stmt.bind(...params).first<PhoneAuthLimit>();
  return record || null;
};

// 更新或插入 phone_auth_limits 记录
export const upsertPhoneAuthLimit = async (
  env: Env,
  data: Omit<PhoneAuthLimit, 'created_at' | 'updated_at' | 'last_accessed_at'> & {
    createdAt?: string;
    updatedAt?: string;
    lastAccessedAt?: string | null;
  }
): Promise<void> => {
  const current_time = now();
  const created_at = data.createdAt || current_time;
  const updated_at = current_time;
  const last_accessed_at = data.lastAccessedAt || null;

  await env.DB.prepare(
    `INSERT INTO phone_auth_limits (
      mobile_phone, auth_code, remaining_attempts, max_attempts,
      last_accessed_at, created_at, updated_at, proposal_id, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mobile_phone) DO UPDATE SET
      auth_code = excluded.auth_code,
      remaining_attempts = excluded.remaining_attempts,
      max_attempts = excluded.max_attempts,
      last_accessed_at = excluded.last_accessed_at,
      updated_at = excluded.updated_at,
      proposal_id = excluded.proposal_id,
      expires_at = excluded.expires_at`
  ).bind(
    data.mobile_phone,
    data.auth_code,
    data.remaining_attempts,
    data.max_attempts,
    last_accessed_at,
    created_at,
    updated_at,
    data.proposal_id,
    data.expires_at
  ).run();
};
