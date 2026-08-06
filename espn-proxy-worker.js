/**
 * ESPN proxy — Cloudflare Worker.
 *
 * Why: ESPN 403s Google Apps Script's fixed user agent, and Apps Script won't let you
 * change it. This Worker refetches an ESPN URL from Cloudflare's network with a user
 * agent ESPN accepts, then returns the response. Locked to espn.com so it can't be
 * abused as an open proxy.
 *
 * Deploy (no command line needed):
 *   1. dash.cloudflare.com → Workers & Pages → Create → Worker → Deploy.
 *   2. Click "Edit code", replace everything with this file, click "Deploy".
 *   3. Copy the Worker URL (e.g. https://espn-proxy.yourname.workers.dev).
 *   4. In Code.gs set:  const ESPN_PROXY = 'https://espn-proxy.yourname.workers.dev/?url=';
 *
 * Usage:  https://<your-worker>/?url=<url-encoded ESPN url>
 */
export default {
  async fetch(request) {
    const reqUrl = new URL(request.url);
    const target = reqUrl.searchParams.get('url');
    if (!target) return new Response('missing ?url=', { status: 400 });

    let t;
    try { t = new URL(target); } catch (e) { return new Response('bad url', { status: 400 }); }

    // Only proxy ESPN hosts.
    if (!/(^|\.)espn\.com$/i.test(t.hostname)) {
      return new Response('forbidden host', { status: 403 });
    }
    t.protocol = 'https:'; // ESPN $ref links are often http://

    const upstream = await fetch(t.toString(), {
      headers: { 'User-Agent': 'curl/8.4.0', 'Accept': 'application/json' },
      redirect: 'follow',
    });

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') || 'application/json',
        'access-control-allow-origin': '*',
      },
    });
  },
};
