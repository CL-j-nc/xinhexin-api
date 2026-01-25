import { now } from '../../utils/time';

export const confirmPayment = async (db: D1Database, applicationNo: string) => {
  await db.prepare(`
    UPDATE application
    SET status = ?, paid_at = ?
    WHERE application_no = ?
  `)
    .bind('PAID', now(), applicationNo)
    .run();

  return { success: true };
};
