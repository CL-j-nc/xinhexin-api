import { now } from '../../utils/time';

const genPolicyNo = () =>
  'P' + Date.now().toString() + Math.floor(Math.random() * 1000);

export const issuePolicy = async (db: D1Database, applicationNo: string) => {
  const policyNo = genPolicyNo();

  await db.prepare(`
    UPDATE application
    SET status = ?, policy_issued_at = ?, policy_no = ?
    WHERE application_no = ?
  `)
    .bind('POLICY_ISSUED', now(), policyNo, applicationNo)
    .run();

  return { policyNo };
};
