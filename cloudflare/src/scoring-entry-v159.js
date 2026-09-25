import portal from './scoring-entry-v158.js';

const MAX_CANYON_IMAGE_BYTES = 5_000_000;
const CANYON_CHUNK_BASE64_CHARS = 700_000;
const CANYON_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'th', label: 'ไทย · Thai' },
  { code: 'es', label: 'Español' },
  { code: 'de', label: 'Deutsch' },
  { code: 'el', label: 'Ελληνικά' },
  { code: 'bg', label: 'Български' }
];
const CANYON_LANGUAGE_MAP = Object.fromEntries(CANYON_LANGUAGES.map(row => [row.code, row]));

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/canyon-plan' && request.method === 'GET') {
      return handleCanyonMeta(request, env, ctx);
    }
    if (url.pathname === '/api/canyon-plan/image' && request.method === 'GET') {
      return handleCanyonImage(request, env, ctx);
    }
    if (url.pathname === '/api/admin/canyon-plan/image' && request.method === 'POST') {
      try {
        return await handleCanyonUpload(request, env, ctx);
      } catch (error) {
        console.error('Canyon Clash image upload failed', error);
        return json({ ok: false, error: 'Canyon Clash image upload failed on the server.' }, 500);
      }
    }

    return portal.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof portal.scheduled === 'function') return portal.scheduled(controller, env, ctx);
  }
};

async function handleCanyonMeta(request, env, ctx) {
  const auth = await authenticatedPlayer(request, env, ctx);
  if (auth.response) return auth.response;

  const rows = await env.DB.prepare(`
    SELECT language_code,language_label,mime_type,source_filename,byte_size,uploaded_by_name,uploaded_at,updated_at
    FROM canyon_plan_images
    ORDER BY updated_at DESC
  `).all();

  const byCode = Object.fromEntries((rows.results || []).map(row => [String(row.language_code || ''), row]));
  const languages = CANYON_LANGUAGES.map(language => {
    const row = byCode[language.code];
    return {
      code: language.code,
      label: language.label,
      available: Boolean(row),
      filename: String(row?.source_filename || ''),
      byteSize: Number(row?.byte_size || 0),
      uploadedBy: String(row?.uploaded_by_name || ''),
      uploadedAt: String(row?.uploaded_at || ''),
      updatedAt: String(row?.updated_at || '')
    };
  });

  const available = languages.filter(row => row.available);
  const defaultLanguage = byCode.en ? 'en' : String(available[0]?.code || 'en');
  const updatedAt = available.map(row => row.updatedAt).filter(Boolean).sort().at(-1) || '';

  return json({
    ok: true,
    title: 'Canyon Clash Battle Plan',
    defaultLanguage,
    updatedAt,
    languages,
    canManage: Boolean(auth.user.isAdmin)
  });
}

async function handleCanyonImage(request, env, ctx) {
  const auth = await authenticatedPlayer(request, env, ctx);
  if (auth.response) return auth.response;

  const url = new URL(request.url);
  const language = normalizeLanguage(url.searchParams.get('lang'));
  if (!language) return json({ ok: false, error: 'Unsupported Canyon Clash language.' }, 400);

  const row = await env.DB.prepare(`
    SELECT mime_type,source_filename,image_base64,updated_at
    FROM canyon_plan_images
    WHERE language_code=?
    LIMIT 1
  `).bind(language).first();

  if (!row) return json({ ok: false, error: 'That Canyon Clash language has not been uploaded yet.' }, 404);

  const chunkRows = await env.DB.prepare(`
    SELECT chunk_base64
    FROM canyon_plan_image_chunks
    WHERE language_code=?
    ORDER BY chunk_index ASC
  `).bind(language).all();
  const chunkBase64 = (chunkRows.results || []).map(item => String(item.chunk_base64 || '')).join('');
  const imageBase64 = chunkBase64 || String(row.image_base64 || '');
  if (!imageBase64) return json({ ok: false, error: 'This Canyon Clash image is missing its stored data.' }, 500);

  const bytes = base64ToBytes(imageBase64);
  const headers = new Headers({
    'content-type': String(row.mime_type || 'image/jpeg'),
    'content-length': String(bytes.byteLength),
    'cache-control': 'private, no-store',
    'content-disposition': `inline; filename="${safeFilename(row.source_filename) || `canyon-clash-${language}.jpg`}"`,
    'x-content-type-options': 'nosniff'
  });
  return new Response(bytes, { status: 200, headers });
}

async function handleCanyonUpload(request, env, ctx) {
  const auth = await authenticatedPlayer(request, env, ctx);
  if (auth.response) return auth.response;
  if (!auth.user.isAdmin) return json({ ok: false, error: 'Administrator access required.' }, 403);

  const contentType = String(request.headers.get('content-type') || '').toLowerCase();
  let language = '';
  let mimeType = '';
  let filename = '';
  let buffer;

  if (contentType.startsWith('multipart/form-data')) {
    let form;
    try {
      form = await request.formData();
    } catch (_) {
      return json({ ok: false, error: 'Could not read the selected image upload.' }, 400);
    }

    language = normalizeLanguage(form.get('language'));
    const image = form.get('image');
    if (!language) return json({ ok: false, error: 'Choose a supported Canyon Clash language.' }, 400);
    if (!image || typeof image.arrayBuffer !== 'function') {
      return json({ ok: false, error: 'Choose an image to upload.' }, 400);
    }

    mimeType = String(image.type || '').split(';')[0].trim().toLowerCase();
    filename = safeFilename(image.name);
    buffer = await image.arrayBuffer();
  } else {
    language = normalizeLanguage(request.headers.get('x-canyon-language'));
    if (!language) return json({ ok: false, error: 'Choose a supported Canyon Clash language.' }, 400);
    mimeType = contentType.split(';')[0].trim();
    filename = safeFilename(request.headers.get('x-file-name'));
    buffer = await request.arrayBuffer();
  }

  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    return json({ ok: false, error: 'Upload a JPG, PNG, or WebP image.' }, 415);
  }

  const byteSize = buffer.byteLength;
  if (!byteSize) return json({ ok: false, error: 'Choose an image to upload.' }, 400);
  if (byteSize > MAX_CANYON_IMAGE_BYTES) {
    return json({ ok: false, error: `Image is too large. Maximum supported upload is ${MAX_CANYON_IMAGE_BYTES.toLocaleString()} bytes.` }, 413);
  }

  const languageRow = CANYON_LANGUAGE_MAP[language];
  const now = new Date().toISOString();
  filename = filename || `canyon-clash-${language}.${extensionFor(mimeType)}`;
  const imageBase64 = bytesToBase64(new Uint8Array(buffer));
  const chunks = splitText(imageBase64, CANYON_CHUNK_BASE64_CHARS);

  const statements = [
    env.DB.prepare(`
      INSERT INTO canyon_plan_images(
        language_code,language_label,mime_type,source_filename,image_base64,byte_size,
        uploaded_by_uid,uploaded_by_name,uploaded_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(language_code) DO UPDATE SET
        language_label=excluded.language_label,
        mime_type=excluded.mime_type,
        source_filename=excluded.source_filename,
        image_base64=excluded.image_base64,
        byte_size=excluded.byte_size,
        uploaded_by_uid=excluded.uploaded_by_uid,
        uploaded_by_name=excluded.uploaded_by_name,
        updated_at=excluded.updated_at
    `).bind(
      language,
      languageRow.label,
      mimeType,
      filename,
      '',
      byteSize,
      auth.user.uid,
      auth.user.name,
      now,
      now
    ),
    env.DB.prepare('DELETE FROM canyon_plan_image_chunks WHERE language_code=?').bind(language),
    ...chunks.map((chunk, index) => env.DB.prepare(`
      INSERT INTO canyon_plan_image_chunks(language_code,chunk_index,chunk_base64)
      VALUES(?,?,?)
    `).bind(language, index, chunk))
  ];

  await env.DB.batch(statements);

  return json({
    ok: true,
    language,
    label: languageRow.label,
    byteSize,
    chunks: chunks.length,
    updatedAt: now
  });
}

async function authenticatedPlayer(request, env, ctx) {
  const authUrl = new URL(request.url);
  authUrl.pathname = '/api/auth/me';
  authUrl.search = '';

  const headers = new Headers();
  const cookie = request.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);
  const agent = request.headers.get('user-agent');
  if (agent) headers.set('user-agent', agent);

  const response = await portal.fetch(new Request(authUrl.toString(), {
    method: 'GET',
    headers
  }), env, ctx);

  if (!response.ok) {
    return { response: json({ ok: false, error: 'Authentication required.' }, response.status === 401 ? 401 : 403) };
  }

  let payload = {};
  try { payload = await response.json(); } catch (_) {}
  const publicUser = payload?.user || null;
  if (!publicUser || publicUser.isGuest) {
    return { response: json({ ok: false, error: 'Alliance member access is required for Canyon Clash plans.' }, 403) };
  }

  const publicId = String(publicUser.publicId || '').trim();
  if (!publicId) return { response: json({ ok: false, error: 'Player identity is unavailable.' }, 403) };

  const player = await env.DB.prepare(`
    SELECT uid,public_id,current_name,is_admin
    FROM players
    WHERE public_id=?
    LIMIT 1
  `).bind(publicId).first();

  if (!player) return { response: json({ ok: false, error: 'Player identity is unavailable.' }, 403) };

  return {
    user: {
      uid: String(player.uid || ''),
      publicId,
      name: String(player.current_name || publicUser.name || ''),
      isAdmin: Number(player.is_admin || 0) === 1 || Boolean(publicUser.isAdmin)
    }
  };
}

function normalizeLanguage(value) {
  const code = String(value || '').trim().toLowerCase();
  return CANYON_LANGUAGE_MAP[code] ? code : '';
}

function safeFilename(value) {
  return String(value || '').replace(/[^a-zA-Z0-9._ -]/g, '').trim().slice(0, 180);
}

function extensionFor(mimeType) {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function splitText(value, chunkSize) {
  const chunks = [];
  for (let i = 0; i < value.length; i += chunkSize) chunks.push(value.slice(i, i + chunkSize));
  return chunks;
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}
