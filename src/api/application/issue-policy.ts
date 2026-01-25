export const issuePolicy = async (
  db: D1Database,
  applicationNo: string
) => {
  const policyNo = `P${Date.now()}`;

  await db
    .prepare(`
      UPDATE applications
      SET status = 'POLICY_ISSUED',
          policy_no = ?,
          issue_at = CURRENT_TIMESTAMP
      WHERE application_no = ?
    `)
    .bind(policyNo, applicationNo)
    .run();

  return { policyNo };
};
