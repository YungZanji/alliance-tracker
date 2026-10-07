const NOTICE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <meta name="theme-color" content="#0b1220">
  <title>Tracker unavailable</title>
  <style>
    :root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;background:#0b1220;color:#edf3fc}
    *{box-sizing:border-box}body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px;background:radial-gradient(ellipse at 50% 0%,#1b3553 0,transparent 55%),#0b1220}
    main{width:min(100%,560px);padding:clamp(28px,6vw,52px);border:1px solid #ffffff20;border-radius:24px;background:#111c2bdc;box-shadow:0 24px 80px #0006;text-align:center}
    .mark{width:54px;height:54px;margin:0 auto 26px;display:grid;place-items:center;border-radius:16px;background:#d9f99d;color:#18320d;font-size:22px;font-weight:900;letter-spacing:-.06em}
    h1{margin:0;font-size:clamp(30px,7vw,42px);letter-spacing:-.045em}p{margin:14px 0 0;color:#b8c6d8;font-size:16px;line-height:1.65}
  </style>
</head>
<body>
  <main>
    <div class="mark" aria-hidden="true">AT</div>
    <h1>Tracker unavailable</h1>
    <p>If you’re interested in taking over the project, contact Zanji in Last Z.</p>
  </main>
</body>
</html>`;

const NO_INDEX = {
  'x-robots-tag': 'noindex, nofollow, noarchive',
  'cache-control': 'no-store, max-age=0',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff'
};

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/robots.txt') {
      return new Response('User-agent: *\nAllow: /\n', {
        status: 200,
        headers: { ...NO_INDEX, 'content-type': 'text/plain; charset=utf-8' }
      });
    }

    // Keep the existing deployment health check green while making every
    // application endpoint unavailable. No D1 binding is read or changed.
    if (url.pathname === '/api/health') {
      return Response.json({ ok: true, service: 'Alliance Tracker', status: 'unavailable' }, {
        headers: NO_INDEX
      });
    }

    if (url.pathname.startsWith('/api/')) {
      return Response.json({ ok: false, error: 'Tracker unavailable.' }, {
        status: 410,
        headers: NO_INDEX
      });
    }

    return new Response(NOTICE, {
      status: 410,
      headers: { ...NO_INDEX, 'content-type': 'text/html; charset=utf-8' }
    });
  }
};
