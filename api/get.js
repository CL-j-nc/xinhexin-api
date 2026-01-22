export async function onRequestGet(context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  const url = new URL(context.request.url);
  const id = url.searchParams.get('id');

  if (!id) return new Response('Missing ID', { status: 400, headers: corsHeaders });

  try {
    const kv = context.env.KV_BINDING || context.env.JHPCIC_STORE;

    if (!kv) {
       return new Response('KV Storage Not Configured', { status: 500, headers: corsHeaders });
    }

    const rawData = await kv.get(`order:${id}`);
    if (!rawData) return new Response('Order Not Found or Expired', { status: 404, headers: corsHeaders });
    
    const record = JSON.parse(rawData);
    return new Response(JSON.stringify(record.data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
}