import { now } from '../../utils/time';

export const getApplication = async (db: D1Database, applicationNo: string) => {
  const record = await db
    .prepare(`SELECT * FROM application WHERE application_no = ?`)
    .bind(applicationNo)
    .first<any>();

  if (!record) throw new Error('Application not found');

  if (record.status === 'APPLIED') {
    await db.prepare(`
      UPDATE application
      SET status = ?, underwriting_at = ?
      WHERE application_no = ?
    `)
      .bind('UNDERWRITING', now(), applicationNo)
      .run();

    record.status = 'UNDERWRITING';
  }

  return record;
};
