export interface Env {
  DB: D1Database;
  POLICY_KV: KVNamespace;
}

export async function onRequestGet({ env }: { env: Env }) {
  const { results } = await env.DB
    .prepare(
      "SELECT application_no, status, apply_at, policy_no FROM applications ORDER BY apply_at DESC"
    )
    .all();

  return new Response(
    JSON.stringify(
      results.map((r: any) => ({
        applicationNo: r.application_no,
        status: r.status,
        applyAt: r.apply_at,
        policyNo: r.policy_no,
      }))
    ),
    {
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
}
