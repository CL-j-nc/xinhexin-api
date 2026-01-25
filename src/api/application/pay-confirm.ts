export const confirmPayment = async (
  db: D1Database,
  applicationNo: string
) => {
  await db
    .prepare(`
      UPDATE applications
      SET status = 'PAID',
          pay_at = CURRENT_TIMESTAMP
      WHERE application_no = ?
    `)
    .bind(applicationNo)
    .run();

  return { success: true };
};
