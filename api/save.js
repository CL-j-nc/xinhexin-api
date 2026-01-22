
export async function onRequestPost(context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    const data = await context.request.json();
    const id = crypto.randomUUID(); 
    const timestamp = Date.now();

    const storageRecord = {
      id,
      timestamp,
      data
    };

    // 优先使用用户在 Cloudflare 控制台看到的 KV_BINDING
    const kv = context.env.KV_BINDING || context.env.JHPCIC_STORE;

    if (kv) {
      // 存储数据，有效期 30 天 (2592000秒)
      await kv.put(`order:${id}`, JSON.stringify(storageRecord), { expirationTtl: 2592000 });
      return new Response(JSON.stringify({ success: true, id }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    } else {
      return new Response(JSON.stringify({ 
        error: "KV_BINDING not found. Please bind your KV namespace in Pages Settings." 
      }), { 
        status: 500, 
        headers: corsHeaders 
      });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500, 
      headers: corsHeaders 
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
}
