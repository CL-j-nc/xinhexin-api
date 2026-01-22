
export async function onRequestGet(context) {
  const kv = context.env.KV_BINDING;
  const hasKV = !!kv;
  
  return new Response(JSON.stringify({
    status: "ok",
    kv_bound: hasKV,
    timestamp: Date.now()
  }), {
    headers: { 
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache'
    }
  });
}
