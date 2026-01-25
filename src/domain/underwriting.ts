// src/domain/underwriting.ts
// 承保状态（系统唯一事实源）

export type UnderwritingStatus =
  | 'APPLIED'        // 已提交投保
  | 'UNDERWRITING'   // 核保中
  | 'APPROVED'       // 核保通过（已出码）
  | 'REJECTED'       // 核保打回
  | 'PAID'           // 已确认收付
  | 'POLICY_ISSUED'; // 已出保单
