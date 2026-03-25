async function errorHandler(context) {
  try {
    return await context.next();
  } catch (err) {
    return Response.json(
      { error: err.message },
      { status: 502 }
    );
  }
}

async function corsHandler(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }
  const response = await context.next();
  response.headers.set('Access-Control-Allow-Origin', '*');
  return response;
}

export const onRequest = [errorHandler, corsHandler];
