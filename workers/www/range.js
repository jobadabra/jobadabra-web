// Byte ranges for the site's videos: Workers static assets answer a Range request with the whole file (200), and Safari will not play a <video> that
// is not answered with 206 + Content-Range. Serves /media and /images/app (the landing's clips and stills) through the worker. Guarded by test/unit/workers/www/range.test.js.

// "bytes=0-99", "bytes=500-", "bytes=-200" -> {start, end} (end inclusive) | null (not a single satisfiable range). Pure.
export function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  let start, end;
  if (match[1] === '') { start = Math.max(0, size - Number(match[2])); end = size - 1; }
  else { start = Number(match[1]); end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1); }
  return start <= end && start < size ? {start, end} : null;
}

export async function mediaRange(request, env) {
  const asked = request.headers.get('range');
  const plain = new Request(request.url, {method: 'GET', headers: new Headers([...request.headers].filter(([name]) => name !== 'range'))});
  const asset = await env.ASSETS.fetch(plain);
  const headers = new Headers(asset.headers);
  headers.set('accept-ranges', 'bytes');
  if (!asset.ok || !asked || request.method !== 'GET') return new Response(request.method === 'HEAD' ? null : asset.body, {status: asset.status, headers});
  const bytes = await asset.arrayBuffer();
  const range = parseRange(asked, bytes.byteLength);
  if (!range) { headers.set('content-range', `bytes */${bytes.byteLength}`); return new Response(null, {status: 416, headers}); }
  headers.set('content-range', `bytes ${range.start}-${range.end}/${bytes.byteLength}`);
  headers.set('content-length', String(range.end - range.start + 1));
  return new Response(bytes.slice(range.start, range.end + 1), {status: 206, headers});
}
