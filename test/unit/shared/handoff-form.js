// Test helper: read the page shared/oauth-handoff.js toApp() answers with (a form POSTed to the app's socket) -> {status, action, method, fields, html, headers}.
const decode = text => text.replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => ({amp: '&', lt: '<', gt: '>', quot: '"', '#39': '\''}[name]));

export async function handedOff(response) {
  const html = await response.text();
  const form = /<form method="([^"]*)" action="([^"]*)">/.exec(html);
  const fields = {};
  for (const match of html.matchAll(/<input type="hidden" name="([^"]*)" value="([^"]*)">/g)) fields[decode(match[1])] = decode(match[2]);
  return {status: response.status, method: form?.[1] || '', action: form?.[2] || '', fields, html, headers: response.headers};
}
