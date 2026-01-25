import { now } from '../../utils/time';

export const applyApplication = async (db: D1Database, body: any) => {
  const applicationNo = crypto.randomUUID();

  await db.prepare(`
    INSERT INTO application (
      application_no,
      data,
      status,
      applied_at
    ) VALUES (?, ?, ?, ?)
  `)
    .bind(applicationNo, JSON.stringify(body), 'APPLIED', now())
    .run();

  return { applicationNo };
};
