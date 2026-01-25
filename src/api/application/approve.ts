import { now } from '../../utils/time';

export const approveApplication = async (db: D1Database, applicationNo: string) => {
  const policyNo = `POLICY-${Date.now()}`;
  await db.prepare(`
    UPDATE applications
    SET status = ?, policy_no = ?, approved_at = ?
    WHERE application_no = ?
  `)
    .bind('APPROVED', policyNo, now(), applicationNo)
    .run();

  return { success: true, policyNo };
};