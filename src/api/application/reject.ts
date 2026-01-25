import { now } from '../../utils/time';

export const rejectApplication = async (db: D1Database, applicationNo: string) => {
  await db.prepare(`
    UPDATE application
    SET status = ?, rejected_at = ?
    WHERE application_no = ?
  `)
    .bind('REJECTED', now(), applicationNo)
    .run();

  return { success: true };
};
