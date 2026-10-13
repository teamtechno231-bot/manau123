const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Persistence, safeId } = require('./database');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const HTML = path.join(ROOT, 'public', 'index.html');
const DATA_FILE = process.env.WHIZZY_DATA_FILE || path.join(ROOT, 'whizzy-admin-data.json');
let SESSION_SECRET = process.env.WHIZZY_SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const ALLOW_DEMO_HEADER = process.env.NODE_ENV !== 'production' && process.env.WHIZZY_ALLOW_DEMO_HEADER === 'true';
const MAX_BODY = 1024 * 1024;
const FREE_DAILY_LIMIT = 50;
const AUDIT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const UPSTREAM_MODELS = { complex: ['cl','aude-sonnet-4-6'].join(''), quick: ['cl','aude-haiku-4-5'].join('') };
const ROLES = {
  owner: { label: 'Owner', permissions: ['dashboard:read','users:read','users:write','conversations:read','conversations:write','conversations:delete','settings:read','settings:write','keys:read','keys:write','activity:read','reports:read','reports:write','security:read','projects:read','catalog:read','catalog:write','billing:read'] },
  admin: { label: 'Admin', permissions: ['dashboard:read','users:read','users:write','conversations:read','conversations:write','conversations:delete','settings:read','settings:write','keys:read','keys:write','activity:read','reports:read','reports:write','security:read','projects:read','catalog:read','catalog:write','billing:read'] },
  moderator: { label: 'Moderator', permissions: ['dashboard:read','users:read','conversations:read','conversations:delete','activity:read','reports:read','reports:write'] },
  analyst: { label: 'Analyst', permissions: ['dashboard:read','users:read','conversations:read','activity:read','reports:read','security:read'] },
  member: { label: 'Member', permissions: [] }
};
const seed = {
  users: [
    { id: 'demo', name: 'Demo User', email: 'you@example.com', role: 'owner', plan: 'premium', status: 'active', lastActive: 'Just now' },
    { id: 'alex', name: 'Alex Smith', email: 'alex@example.com', role: 'member', plan: 'free', status: 'active', lastActive: '2 days ago' },
    { id: 'jamie', name: 'Jamie Rivera', email: 'jamie@example.com', role: 'member', plan: 'free', status: 'invited', lastActive: '1 week ago' },
    { id: 'analyst', name: 'Read Only Analyst', email: 'analyst@example.com', role: 'analyst', plan: 'free', status: 'active', lastActive: 'Just now' }
  ],
  settings: { voice: true, research: true, attachments: true, defaultModel: 'Prime Sonnet', retention: 'Until manually deleted', access: 'Invite only', maintenanceMode: false, announcement: '' },
  plans: [
    { id: 'free', name: 'Free', description: 'A calm place to start.', active: true, features: ['50 AI messages per day', 'Starter agents', 'Private history'], limits: { messagesPerDay: 50 }, prices: { INR: { amount: 0, stripePriceId: null }, USD: { amount: 0, stripePriceId: null } } },
    { id: 'pro', name: 'Pro', description: 'More room for serious work.', active: true, features: ['Higher AI capacity', 'Website previews', 'Image workflows'], limits: { messagesPerDay: 500 }, prices: { INR: { amount: 79900, stripePriceId: null }, USD: { amount: 999, stripePriceId: null } } },
    { id: 'max', name: 'Max', description: 'The highest individual limits.', active: true, features: ['Priority generation', 'Video workflows', 'Advanced agents'], limits: { messagesPerDay: 2000 }, prices: { INR: { amount: 199900, stripePriceId: null }, USD: { amount: 2499, stripePriceId: null } } },
    { id: 'team', name: 'Team', description: 'A shared workspace for small teams.', active: true, features: ['Shared projects', 'Team members', 'Admin controls'], limits: { members: 10 }, prices: { INR: { amount: 499900, stripePriceId: null }, USD: { amount: 5999, stripePriceId: null } } },
    { id: 'enterprise', name: 'Enterprise', description: 'Custom support and controls.', active: true, features: ['Custom limits', 'Security review', 'Dedicated support'], limits: {}, prices: { INR: { amount: null, stripePriceId: null }, USD: { amount: null, stripePriceId: null } } }
  ],
  agents: [
    { id: 'website-builder', name: 'Website Builder', description: 'Generate a responsive site and refine it beside a live preview.', enabled: true, order: 1 },
    { id: 'research', name: 'Research Agent', description: 'Turn a complex question into a structured brief.', enabled: true, order: 2 },
    { id: 'image-studio', name: 'Image Studio', description: 'Shape visual directions and campaign-ready assets.', enabled: true, order: 3 },
    { id: 'video-studio', name: 'Video Studio', description: 'Plan scenes, motion, and short-form video concepts.', enabled: true, order: 4 },
    { id: 'support-copilot', name: 'Support Copilot', description: 'Search help content and connect answers to the workspace.', enabled: true, order: 5 }
  ],
  content: { landing: { eyebrow: 'A more useful AI workspace', headline: 'Turn a brief into something you can see, use, and share.', subhead: 'Luma brings chat, AI agents, website creation, image and video workflows, and a live interactive preview into one calm command center.' }, faq: [{ id: 'faq-1', question: 'Can I preview websites before publishing?', answer: 'Yes. Website projects include an interactive preview inside Luma.' }, { id: 'faq-2', question: 'Is my Google login secure?', answer: 'Luma uses Manus Google OAuth and validates application sessions server-side.' }], resources: [{ id: 'resource-1', title: 'Website Builder guide', description: 'From first prompt to an interactive responsive preview.', kind: 'documentation', published: true }] },
  conversations: [],
  activity: [{ id: 1, event: 'Server initialized', actor: 'System', time: new Date().toISOString(), status: 'Success' }]
};
const persistence = new Persistence({ dataFile: DATA_FILE, seed });
let db = persistence.normalize(seed);
const rateBuckets = new Map();

function save() { return persistence.persist(db); }
function pruneActivity() { const cutoff = Date.now() - AUDIT_RETENTION_MS; db.activity = (db.activity || []).filter(a => new Date(a.time).getTime() >= cutoff).slice(0, 1000); }
function vaultKey() { return crypto.createHash('sha256').update(String(process.env.WHIZZY_VAULT_KEY || SESSION_SECRET)).digest(); }
function encryptSecret(value) { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', vaultKey(), iv); const enc = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.'); }
function today() { return new Date().toISOString().slice(0, 10); }
function usageFor(userId) { const d = today(); db.usage[d] = db.usage[d] || {}; return Number(db.usage[d][userId] || 0); }
function incrementUsage(userId) { const d = today(); db.usage[d] = db.usage[d] || {}; db.usage[d][userId] = usageFor(userId) + 1; }
function securityHeaders() { return {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https:; object-src 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), payment=(), usb=()'
}; }
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...securityHeaders() }); res.end(JSON.stringify(body)); }
function cookieValue(req, name) { const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]+)')); return m ? decodeURIComponent(m[1]) : ''; }
function sign(value) { return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url'); }
function sessionId(req) {
  const value = cookieValue(req, 'webdev_app_session') || cookieValue(req, 'wz_session');
  if (!value) return '';
  const [id, sig] = value.split('.'); if (!id || !sig) return '';
  const expected = sign(id); if (sig.length !== expected.length) return '';
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? id : '';
}
function identity(req) { return sessionId(req) || (ALLOW_DEMO_HEADER ? (req.headers['x-demo-user'] || '') : ''); }
function blocked(user) { return !user || user.status === 'banned' || (user.status === 'suspended' && user.suspendedUntil && new Date(user.suspendedUntil).getTime() > Date.now()); }
function actor(req) {
  const id = identity(req);
  const session = db.sessions.find(s => s.id === id && !s.revokedAt && new Date(s.expiresAt).getTime() > Date.now());
  const userId = session ? session.userId : id;
  const user = db.users.find(u => u.id === userId || u.email === userId);
  return blocked(user) ? null : user;
}
function can(user, permission) { const role = ROLES[user?.role]; return !!role && role.permissions.includes(permission); }
function deny(res) { return json(res, 403, { error: 'forbidden', message: 'Your role does not have permission for this action.' }); }
function record(event, user, metadata = {}) {
  pruneActivity();
  const entry = { id: Date.now() * 1000 + crypto.randomInt(0, 999), event: String(event).slice(0, 500), actorId: user?.id || null, actor: user?.name || 'System', time: new Date().toISOString(), status: 'Success', metadata };
  db.activity.unshift(entry); pruneActivity(); save(); persistence.addActivity(entry);
}
function body(req) { return new Promise((resolve, reject) => { let b = ''; req.on('data', c => { b += c; if (b.length > MAX_BODY) reject(Object.assign(new Error('payload_too_large'), { statusCode: 413 })); }); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(Object.assign(e, { statusCode: 400 })); } }); }); }
function stringField(value, max, fallback = '') { return typeof value === 'string' ? value.trim().slice(0, max) : fallback; }
function stats() { const messages = db.conversations.reduce((n, c) => n + Number(c.messages || 0), 0); const active = db.users.filter(u => u.status === 'active').length; return { users: db.users.length, activeUsers: active, conversations: db.conversations.length, messages, avgResponse: '1.8s', weekly: [18, 27, 22, 34, 41, 13, 19] }; }
function isSecure(req) { return req.headers['x-forwarded-proto'] === 'https' || req.headers['x-forwarded-ssl'] === 'on' || /manus\.(computer|space)$/.test(String(req.headers.host || '').split(':')[0]); }
function originFor(req) { const configured = process.env.PUBLIC_APP_ORIGIN; if (configured && /^https:\/\//.test(configured)) return configured.replace(/\/$/, ''); const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim(); return `https://${host}`; }
function cookieFlags(req, extra = '') { return `Path=/; HttpOnly; ${isSecure(req) ? 'SameSite=None; Secure' : 'SameSite=Lax'}${extra ? '; ' + extra : ''}`; }
function authCookies(req, value) { const flags = cookieFlags(req); return [`webdev_app_session=${encodeURIComponent(value)}; ${flags}`, `wz_session=${encodeURIComponent(value)}; ${flags}`]; }
async function createSession(req, user) { const session = await persistence.createSession(user.id, { ip: req.socket.remoteAddress, userAgent: req.headers['user-agent'] }); const value = `${session.id}.${sign(session.id)}`; return authCookies(req, value); }
function touch(user) { user.lastActive = 'Just now'; user.lastLoginAt = new Date().toISOString(); save(); }
async function findOrCreateOAuthUser(info) {
  const externalId = String(info.openId || info.email || '').slice(0, 140); if (!externalId) throw new Error('oauth_identity_missing');
  const id = `manus_${crypto.createHash('sha256').update(externalId).digest('hex').slice(0, 40)}`;
  const placeholder = u => ['demo','alex','jamie','analyst'].includes(u.id) || /@(example\.com|example\.org)$/i.test(u.email || '');
  let user = db.users.find(u => u.id === id) || (info.email && db.users.find(u => u.email === info.email && !placeholder(u)));
  if (!user) { const firstRealUser = !db.users.some(u => !placeholder(u)); user = { id, name: stringField(info.name, 200, 'New user'), email: stringField(info.email, 320), picture: stringField(info.picture, 1000), role: firstRealUser ? 'owner' : 'member', plan: firstRealUser ? 'premium' : 'free', status: 'active', lastActive: 'Just now', createdAt: new Date().toISOString() }; db.users.push(user); record('New account created', user, { source: 'oauth', firstUser: firstRealUser }); }
  else { user.name = stringField(info.name, 200, user.name); user.picture = stringField(info.picture, 1000, user.picture); }
  return user;
}
async function oauthExchange(req, code, redirectUri) {
  const base = process.env.MANUS_OAUTH_API_URL; if (!base || !process.env.MANUS_PROJECT_ID) throw new Error('oauth_not_configured');
  const endpoint = base.replace(/\/$/, '');
  const tokenResponse = await fetch(`${endpoint}/webdev.v1.WebDevAuthPublicService/ExchangeToken`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: process.env.MANUS_PROJECT_ID, grantType: 'authorization_code', code, redirectUri }) });
  const tokenBody = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || tokenBody.error || !(tokenBody.accessToken || tokenBody.access_token)) { const e = new Error('oauth_exchange_failed'); e.providerStatus = tokenResponse.status; e.providerCode = tokenBody.code || tokenBody.error || ''; throw e; }
  const accessToken = tokenBody.accessToken || tokenBody.access_token;
  const infoResponse = await fetch(`${endpoint}/webdev.v1.WebDevAuthPublicService/GetUserInfo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessToken }) });
  const infoBody = await infoResponse.json().catch(() => ({}));
  if (!infoResponse.ok || infoBody.error || !infoBody.openId && !infoBody.open_id && !infoBody.email) { const e = new Error('oauth_identity_failed'); e.providerStatus = infoResponse.status; e.providerCode = infoBody.code || infoBody.error || ''; throw e; }
  return { ...infoBody, openId: infoBody.openId || infoBody.open_id, picture: infoBody.picture || infoBody.avatarUrl || infoBody.avatar_url };
}
function rateLimit(req, key, limit, windowMs) { const now = Date.now(); const bucketKey = `${key}:${req.socket.remoteAddress || 'unknown'}`; const bucket = rateBuckets.get(bucketKey) || { start: now, count: 0 }; if (now - bucket.start > windowMs) { bucket.start = now; bucket.count = 0; } bucket.count++; rateBuckets.set(bucketKey, bucket); return bucket.count <= limit; }
function modelFor(tier) { return tier === 'complex' ? UPSTREAM_MODELS.complex : tier === 'quick' ? UPSTREAM_MODELS.quick : 'claude-sonnet-4-6'; }
async function completeChat(user, req, res) {
  if (!user) return json(res, 401, { error: 'auth', message: 'Please sign in again.' });
  if (!rateLimit(req, 'chat', 30, 60 * 1000)) return json(res, 429, { error: 'rate_limited', message: 'Too many requests. Try again in a moment.' });
  if (user.plan !== 'premium' && usageFor(user.id) >= FREE_DAILY_LIMIT) return json(res, 429, { error: 'daily_limit', message: 'You have reached the free daily message limit.' });
  let payload; try { payload = await body(req); } catch (e) { return json(res, e.statusCode || 400, { error: 'invalid_json' }); }
  if (!Array.isArray(payload.messages) || !payload.messages.length || payload.messages.length > 50) return json(res, 400, { error: 'invalid_messages', message: 'A conversation with 1–50 messages is required.' });
  const messages = payload.messages.map(m => ({ role: ['system','user','assistant','tool'].includes(m?.role) ? m.role : 'user', content: typeof m?.content === 'string' ? m.content.slice(0, 20000) : '' })).filter(m => m.content);
  if (!messages.length || messages.reduce((n, m) => n + m.content.length, 0) > 120000) return json(res, 413, { error: 'prompt_too_large', message: 'This conversation is too large. Start a new chat or shorten the prompt.' });
  const base = process.env.MANUS_API_URL || process.env.BUILT_IN_FORGE_API_URL;
  const key = process.env.MANUS_API_KEY || process.env.BUILT_IN_FORGE_API_KEY;
  if (!base || !key) return json(res, 503, { error: 'ai_not_configured', message: 'The Luma AI service is not configured for this deployment.' });
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 65000);
  try {
    const upstream = await fetch(`${base.replace(/\/$/, '')}/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: modelFor(payload.tier), messages, temperature: 0.7 }), signal: controller.signal });
    const raw = await upstream.text(); let result = {}; try { result = raw ? JSON.parse(raw) : {}; } catch { result = {}; }
    if (!upstream.ok || result.error) return json(res, upstream.status === 429 ? 429 : 502, { error: upstream.status === 429 ? 'rate_limited' : 'ai_failed', message: result.error?.message || 'The AI service could not complete this request.' });
    const text = result.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) return json(res, 502, { error: 'empty_completion', message: 'The AI service returned no answer. Please try again.' });
    incrementUsage(user.id); await save();
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...securityHeaders() }); res.end(text);
  } catch (e) { return json(res, e.name === 'AbortError' ? 504 : 502, { error: e.name === 'AbortError' ? 'ai_timeout' : 'ai_failed', message: 'The AI service could not complete this request.' }); }
  finally { clearTimeout(timer); }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, securityHeaders()); return res.end(); }
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); const p = url.pathname;
    if (p === '/api/auth/google' && req.method === 'GET') {
      if (ALLOW_DEMO_HEADER) { const demo = db.users.find(u => u.id === 'demo'); const value = 'demo.' + sign('demo'); record('User sign-in', demo, { source: 'test_demo' }); res.writeHead(302, { Location: '/', 'Set-Cookie': authCookies(req, value), 'Cache-Control': 'no-store', ...securityHeaders() }); return res.end(); }
      if (!rateLimit(req, 'login', 10, 15 * 60 * 1000)) return json(res, 429, { error: 'rate_limited', message: 'Too many login attempts. Try again later.' });
      if (!process.env.MANUS_OAUTH_PORTAL_URL || !process.env.MANUS_OAUTH_API_URL || !process.env.MANUS_PROJECT_ID) return json(res, 503, { error: 'oauth_not_configured', message: 'Account authentication is not configured for this deployment.' });
      const nonce = crypto.randomBytes(24).toString('base64url'); const redirectUri = `${originFor(req)}/api/auth/callback`; const state = Buffer.from(JSON.stringify({ nonce, redirectUri })).toString('base64url');
      res.writeHead(302, { Location: `${process.env.MANUS_OAUTH_PORTAL_URL.replace(/\/$/, '')}/app-auth?appId=${encodeURIComponent(process.env.MANUS_PROJECT_ID)}&redirectUri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}&responseType=code`, 'Set-Cookie': `wz_oauth_state=${encodeURIComponent(nonce)}; ${cookieFlags(req, 'Max-Age=600')}`, 'Cache-Control': 'no-store', ...securityHeaders() }); return res.end();
    }
    if (p === '/api/auth/callback' && req.method === 'GET') {
      const state = (() => { try { return JSON.parse(Buffer.from(url.searchParams.get('state') || '', 'base64url').toString('utf8')); } catch { return null; } })();
      if (!state || !state.nonce || state.nonce !== cookieValue(req, 'wz_oauth_state') || !url.searchParams.get('code')) return json(res, 400, { error: 'invalid_oauth_state', message: 'The sign-in request expired. Please try again.' });
      try { const info = await oauthExchange(req, url.searchParams.get('code'), state.redirectUri); const user = await findOrCreateOAuthUser(info); touch(user); const cookies = await createSession(req, user); res.writeHead(302, { Location: '/', 'Set-Cookie': cookies.concat(`wz_oauth_state=; ${cookieFlags(req, 'Max-Age=0')}`), 'Cache-Control': 'no-store', ...securityHeaders() }); return res.end(); }
      catch (e) { console.error('oauth_callback_failed', JSON.stringify({ code: e.message, providerStatus: e.providerStatus || null, providerCode: e.providerCode || null })); const msg = e.message === 'oauth_not_configured' ? 'Account authentication is not configured.' : 'Sign-in could not be completed. Please try again.'; res.writeHead(302, { Location: `/?auth_error=${encodeURIComponent(msg)}`, 'Set-Cookie': `wz_oauth_state=; ${cookieFlags(req, 'Max-Age=0')}`, 'Cache-Control': 'no-store', ...securityHeaders() }); return res.end(); }
    }
    if (p === '/api/auth/me' && req.method === 'GET') { const user = actor(req); return user ? json(res, 200, { user: { ...user, roleLabel: ROLES[user.role]?.label || user.role, onboardingCompleted: !!db.onboarding[user.id]?.completed } }) : json(res, 401, { error: 'auth' }); }
    if (p === '/api/auth/logout' && req.method === 'POST') { const user = actor(req); if (user) await persistence.revokeSessions(user.id); res.writeHead(204, { 'Set-Cookie': ['webdev_app_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax', 'wz_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax'], ...securityHeaders() }); return res.end(); }
    if (p === '/health' && req.method === 'GET') return json(res, 200, { ok: true, persistence: persistence.mode, database: persistence.mode === 'mysql' });

    const user = actor(req);
    if (p === '/api/chat' && req.method === 'POST') return completeChat(user, req, res);
    if (p === '/api/profile' && req.method === 'GET') { if (!user) return json(res, 401, { error: 'auth' }); return json(res, 200, { user, profile: db.profiles[user.id] || {} }); }
    if (p === '/api/profile' && req.method === 'PATCH') { if (!user) return json(res, 401, { error: 'auth' }); let b; try { b = await body(req); } catch (e) { return json(res, e.statusCode || 400, { error: 'invalid_json' }); } const allowed = ['name','picture','phone','timezone','bio']; const profile = { ...(db.profiles[user.id] || {}) }; for (const k of allowed) if (Object.prototype.hasOwnProperty.call(b, k)) profile[k] = stringField(b[k], k === 'bio' ? 1000 : 320); if (profile.name) user.name = profile.name; if (profile.picture) user.picture = profile.picture; db.profiles[user.id] = profile; record('Updated profile', user); return json(res, 200, { user, profile }); }
    if (p === '/api/onboarding' && req.method === 'GET') { if (!user) return json(res, 401, { error: 'auth' }); return json(res, 200, { completed: !!db.onboarding[user.id]?.completed, answers: db.onboarding[user.id]?.answers || {} }); }
    if (p === '/api/onboarding' && req.method === 'PUT') { if (!user) return json(res, 401, { error: 'auth' }); let b; try { b = await body(req); } catch (e) { return json(res, e.statusCode || 400, { error: 'invalid_json' }); } const answers = b.answers && typeof b.answers === 'object' ? b.answers : null; const completed = b.completed !== false; if (!answers || (completed && (!stringField(answers.role, 80) || !stringField(answers.discovery, 120)))) return json(res, 400, { error: 'invalid_onboarding', message: 'Role and discovery source are required.' }); const entry = { answers, completed, completedAt: completed ? new Date().toISOString() : null }; db.onboarding[user.id] = entry; user.onboardingCompleted = entry.completed; record(entry.completed ? 'Completed onboarding' : 'Saved onboarding progress', user); return json(res, 200, entry); }

    if (p === '/api/conversations' && req.method === 'GET') { if (!user) return json(res, 401, { error: 'auth' }); return json(res, 200, { conversations: db.conversations.filter(c => !c.ownerId || c.ownerId === user.id) }); }
    if (p === '/api/conversations' && req.method === 'PUT') { if (!user) return json(res, 401, { error: 'auth' }); let b; try { b = await body(req); } catch (e) { return json(res, e.statusCode || 400, { error: 'invalid_json' }); } if (!Array.isArray(b.conversations)) return json(res, 400, { error: 'invalid_conversations' }); db.conversations = db.conversations.filter(c => c.ownerId !== user.id && !(!c.ownerId && user.role === 'owner')); const incoming = b.conversations.slice(0, 100).map(c => ({ id: String(c.id).slice(0, 160), ownerId: user.id, title: stringField(c.title, 240, 'Untitled'), messages: Array.isArray(c.msgs) ? Math.min(c.msgs.length, 10000) : Number(c.messages || 0), updated: Number(c.ts || c.updated || Date.now()), payload: c })); db.conversations.push(...incoming); await save(); record('Synchronized conversations', user, { count: incoming.length }); return json(res, 200, { ok: true, stats: stats() }); }
    if (p.match(/^\/api\/conversations\/[^/]+$/) && req.method === 'DELETE') { if (!user) return json(res, 401, { error: 'auth' }); const id = decodeURIComponent(p.split('/').pop()); const found = db.conversations.find(c => String(c.id) === id && c.ownerId === user.id); if (!found) return json(res, 404, { error: 'not_found' }); db.conversations = db.conversations.filter(c => c !== found); await persistence.deleteConversation(id); record('Deleted conversation', user, { conversationId: id }); return json(res, 200, { ok: true }); }

    if (p === '/api/projects' && req.method === 'GET') { if (!user) return json(res, 401, { error: 'auth' }); return json(res, 200, { projects: db.projects.filter(x => x.userId === user.id) }); }
    if (p === '/api/projects' && req.method === 'POST') { if (!user) return json(res, 401, { error: 'auth' }); let b; try { b = await body(req); } catch (e) { return json(res, e.statusCode || 400, { error: 'invalid_json' }); } const project = { id: safeId('project'), userId: user.id, name: stringField(b.name, 200, 'Untitled project'), description: stringField(b.description, 5000), files: Array.isArray(b.files) ? b.files.slice(0, 200) : [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; db.projects.unshift(project); await save(); record('Created project', user, { projectId: project.id }); return json(res, 201, { project }); }
    if (p.match(/^\/api\/projects\/[^/]+$/) && ['PATCH','DELETE'].includes(req.method)) { if (!user) return json(res, 401, { error: 'auth' }); const project = db.projects.find(x => x.id === decodeURIComponent(p.split('/').pop()) && x.userId === user.id); if (!project) return json(res, 404, { error: 'not_found' }); if (req.method === 'DELETE') { project.deletedAt = new Date().toISOString(); db.projects = db.projects.filter(x => x !== project); if (persistence.mode === 'mysql') await persistence.pool.query('UPDATE whizzy_projects SET deleted_at=NOW() WHERE id=?', [project.id]); record('Deleted project', user, { projectId: project.id }); return json(res, 200, { ok: true }); } let b; try { b = await body(req); } catch (e) { return json(res, e.statusCode || 400, { error: 'invalid_json' }); } if (b.name != null) project.name = stringField(b.name, 200, project.name); if (b.description != null) project.description = stringField(b.description, 5000); if (Array.isArray(b.files)) project.files = b.files.slice(0, 200); project.updatedAt = new Date().toISOString(); await save(); record('Updated project', user, { projectId: project.id }); return json(res, 200, { project }); }
    if (p === '/api/reports' && req.method === 'POST') { if (!user) return json(res, 401, { error: 'auth' }); if (!rateLimit(req, 'report', 20, 60 * 60 * 1000)) return json(res, 429, { error: 'rate_limited' }); let b; try { b = await body(req); } catch (e) { return json(res, e.statusCode || 400, { error: 'invalid_json' }); } const description = stringField(b.description, 4000); if (!description || !stringField(b.type, 80)) return json(res, 400, { error: 'invalid_report' }); const report = { id: safeId('report'), reporterId: user.id, targetUserId: stringField(b.targetUserId, 160) || null, reportType: stringField(b.type, 80), description, status: 'open', createdAt: new Date().toISOString(), resolvedAt: null }; db.reports.unshift(report); await save(); record('Submitted report', user, { reportId: report.id, type: report.reportType }); return json(res, 201, { report: { id: report.id, status: report.status, createdAt: report.createdAt } }); }

    if (p.startsWith('/api/admin/')) {
      if (!user) return json(res, 401, { error: 'unauthorized', message: 'A recognized signed-in admin is required.' });
      if (p === '/api/admin/me' && req.method === 'GET') return json(res, 200, { user: { ...user, roleLabel: ROLES[user.role]?.label || user.role }, permissions: ROLES[user.role]?.permissions || [] });
      if (p === '/api/admin/dashboard' && req.method === 'GET') { if (!can(user, 'dashboard:read')) return deny(res); return json(res, 200, { stats: stats(), settings: db.settings }); }
      if (p === '/api/admin/users' && req.method === 'GET') { if (!can(user, 'users:read')) return deny(res); return json(res, 200, { users: db.users.map(u => ({ ...u, roleLabel: ROLES[u.role]?.label || u.role, dailyUsed: usageFor(u.id), dailyLimit: u.plan === 'premium' ? null : FREE_DAILY_LIMIT, onboardingCompleted: !!db.onboarding[u.id]?.completed })) }); }
      if (p.match(/^\/api\/admin\/users\/[^/]+$/) && req.method === 'PATCH') { if (!can(user, 'users:write')) return deny(res); const id = decodeURIComponent(p.split('/').pop()), target = db.users.find(u => u.id === id); if (!target) return json(res, 404, { error: 'not_found' }); let b; try { b = await body(req); } catch (e) { return json(res, e.statusCode || 400, { error: 'invalid_json' }); } if (b.role && !ROLES[b.role]) return json(res, 400, { error: 'invalid_role' }); if (b.plan && !['free','premium'].includes(b.plan)) return json(res, 400, { error: 'invalid_plan' }); if (b.status && !['active','suspended','banned','invited'].includes(b.status)) return json(res, 400, { error: 'invalid_status' }); if (b.role === 'owner' && user.role !== 'owner') return json(res, 403, { error: 'owner_only', message: 'Only the current owner can grant owner access.' }); if (b.role === 'owner' && target.id === user.id) return json(res, 409, { error: 'owner_self_promotion' }); if (target.role === 'owner' && b.role && b.role !== 'owner') return json(res, 409, { error: 'owner_protected' }); if (target.role === 'owner' && b.status && b.status !== 'active') return json(res, 409, { error: 'owner_protected' }); if (b.role) target.role = b.role; if (b.plan) target.plan = b.plan; if (b.status) { target.status = b.status; target.banReason = stringField(b.reason, 500) || null; if (b.status === 'suspended') target.suspendedUntil = new Date(Date.now() + Math.max(1, Number(b.durationHours || 24)) * 60 * 60 * 1000).toISOString(); else target.suspendedUntil = null; } await save(); record(`${b.status ? 'Changed account status' : b.plan ? 'Updated plan for' : 'Updated role for'} ${target.email}`, user, { targetUserId: target.id, reason: b.reason || null }); return json(res, 200, { user: target }); }
      if (p === '/api/admin/conversations' && req.method === 'GET') { if (!can(user, 'conversations:read')) return deny(res); return json(res, 200, { conversations: db.conversations }); }
      if (p.match(/^\/api\/admin\/conversations\/[^/]+$/) && req.method === 'DELETE') { if (!can(user, 'conversations:delete')) return deny(res); const id = decodeURIComponent(p.split('/').pop()); db.conversations = db.conversations.filter(c => String(c.id) !== id); await persistence.deleteConversation(id); record(`Deleted conversation ${id}`, user); return json(res, 200, { ok: true }); }
      if (p === '/api/admin/settings' && req.method === 'GET') { if (!can(user, 'settings:read')) return deny(res); return json(res, 200, { settings: db.settings }); }
      if (p === '/api/admin/settings' && req.method === 'PATCH') { if (!can(user, 'settings:write')) return deny(res); let b; try { b = await body(req); } catch (e) { return json(res, e.statusCode || 400, { error: 'invalid_json' }); } const allowed = ['voice','research','attachments','defaultModel','retention','access','maintenanceMode','announcement']; const next = {}; allowed.forEach(k => { if (Object.prototype.hasOwnProperty.call(b, k)) next[k] = typeof b[k] === 'string' ? stringField(b[k], 500) : !!b[k]; }); db.settings = { ...db.settings, ...next }; await save(); record('Updated assistant controls', user); return json(res, 200, { settings: db.settings }); }
      if (p === '/api/admin/api-keys' && req.method === 'GET') { if (!can(user, 'keys:read')) return deny(res); return json(res, 200, { keys: db.apiKeys.map(k => ({ id:k.id, provider:k.provider, label:k.label, active:k.active, createdAt:k.createdAt, lastUsed:k.lastUsed || null })) }); }
      if (p === '/api/admin/api-keys' && req.method === 'POST') { if (!can(user, 'keys:write')) return deny(res); if (!process.env.WHIZZY_VAULT_KEY && persistence.mode === 'mysql') return json(res, 503, { error: 'vault_not_configured', message: 'Configure the durable WHIZZY_VAULT_KEY secret before storing provider keys.' }); let b; try { b = await body(req); } catch (e) { return json(res, e.statusCode || 400, { error: 'invalid_json' }); } if (!['openai','anthropic','gemini','compatible'].includes(b.provider) || typeof b.key !== 'string' || !b.key.trim()) return json(res, 400, { error: 'invalid_key' }); if (b.key.length > 16384) return json(res, 413, { error: 'key_too_large' }); const item = { id: safeId('key'), provider:b.provider, label:stringField(b.label,80,b.provider), ciphertext:encryptSecret(b.key.trim()), active:true, createdAt:new Date().toISOString() }; db.apiKeys.unshift(item); await save(); record(`Added ${item.provider} API key`, user); return json(res, 201, { key: { id:item.id, provider:item.provider, label:item.label, active:item.active, createdAt:item.createdAt } }); }
      if (p.match(/^\/api\/admin\/api-keys\/[^/]+$/) && req.method === 'PATCH') { if (!can(user, 'keys:write')) return deny(res); const item = db.apiKeys.find(k => k.id === decodeURIComponent(p.split('/').pop())); if (!item) return json(res, 404, { error: 'not_found' }); let b; try { b = await body(req); } catch (e) { return json(res, e.statusCode || 400, { error: 'invalid_json' }); } if (typeof b.active === 'boolean') item.active = b.active; if (typeof b.label === 'string') item.label = stringField(b.label, 80, item.label); await save(); record(`${item.active ? 'Activated' : 'Deactivated'} ${item.provider} API key`, user); return json(res, 200, { ok: true }); }
      if (p.match(/^\/api\/admin\/api-keys\/[^/]+$/) && req.method === 'DELETE') { if (!can(user, 'keys:write')) return deny(res); const id = decodeURIComponent(p.split('/').pop()), before = db.apiKeys.length; db.apiKeys = db.apiKeys.filter(k => k.id !== id); if (before === db.apiKeys.length) return json(res, 404, { error: 'not_found' }); await persistence.deleteApiKey(id); record('Removed provider API key', user); return json(res, 200, { ok: true }); }
      if (p === '/api/admin/usage' && req.method === 'GET') { if (!can(user, 'dashboard:read')) return deny(res); return json(res, 200, { date:today(), freeDailyLimit:FREE_DAILY_LIMIT, users:db.users.map(u => ({ id:u.id,name:u.name,email:u.email,plan:u.plan||'free',used:usageFor(u.id),limit:u.plan==='premium'?null:FREE_DAILY_LIMIT })) }); }
      if (p === '/api/admin/activity' && req.method === 'GET') { if (!can(user, 'activity:read')) return deny(res); pruneActivity(); return json(res, 200, { retentionDays:90, activity:db.activity }); }
      if (p === '/api/admin/activity.csv' && req.method === 'GET') { if (!can(user, 'activity:read')) return deny(res); pruneActivity(); const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"'; const rows = [['Event','Actor','Time','Status'], ...db.activity.map(a => [a.event,a.actor,a.time,a.status])]; const csv = rows.map(r => r.map(esc).join(',')).join('\n') + '\n'; res.writeHead(200, { 'Content-Type':'text/csv; charset=utf-8', 'Content-Disposition':'attachment; filename="luma-audit-90-days.csv"', 'Cache-Control':'no-store', ...securityHeaders() }); return res.end(csv); }
      if (p === '/api/admin/reports' && req.method === 'GET') { if (!can(user, 'reports:read')) return deny(res); return json(res, 200, { reports: db.reports }); }
      if (p.match(/^\/api\/admin\/reports\/[^/]+$/) && req.method === 'PATCH') { if (!can(user, 'reports:write')) return deny(res); const report = db.reports.find(r => r.id === decodeURIComponent(p.split('/').pop())); if (!report) return json(res, 404, { error: 'not_found' }); let b; try { b = await body(req); } catch (e) { return json(res, e.statusCode || 400, { error: 'invalid_json' }); } if (!['open','investigating','resolved','rejected'].includes(b.status)) return json(res, 400, { error: 'invalid_status' }); report.status = b.status; report.resolution = stringField(b.resolution, 4000); report.resolvedAt = ['resolved','rejected'].includes(b.status) ? new Date().toISOString() : null; await save(); record('Updated user report', user, { reportId:report.id, status:report.status }); return json(res, 200, { report }); }
      if (p === '/api/admin/security' && req.method === 'GET') { if (!can(user, 'security:read')) return deny(res); return json(res, 200, { loginEvents: db.activity.filter(a => /sign-in|account|session/i.test(a.event)).slice(0,100), blockedUsers: db.users.filter(u => ['suspended','banned'].includes(u.status)).map(u => ({ id:u.id,email:u.email,status:u.status,reason:u.banReason })) }); }
      if (p === '/api/admin/onboarding' && req.method === 'GET') { if (!can(user, 'users:read')) return deny(res); return json(res, 200, { onboarding: Object.entries(db.onboarding).map(([userId, value]) => ({ userId, ...value })) }); }
      if (p === '/api/admin/sync' && req.method === 'POST') { if (!can(user, 'conversations:write')) return deny(res); let b; try { b = await body(req); } catch (e) { return json(res, e.statusCode || 400, { error: 'invalid_json' }); } if (Array.isArray(b.conversations)) { db.conversations = db.conversations.filter(c => c.ownerId && c.ownerId !== user.id); const incoming = b.conversations.slice(0,500).map(c => ({ id:String(c.id).slice(0,160), ownerId:user.id, title:stringField(c.title,240,'Untitled'), messages:Array.isArray(c.msgs) ? Math.min(c.msgs.length,10000) : 0, updated:Number(c.ts) || Date.now(), payload:c })); db.conversations.push(...incoming); await save(); record('Synchronized local conversations', user, { count:incoming.length }); } return json(res, 200, { ok:true, stats:stats() }); }
      if (p === '/api/admin/catalog' && req.method === 'GET') { if (!can(user, 'catalog:read')) return deny(res); return json(res, 200, { plans: db.plans, agents: db.agents, content: db.content }); }
      if (p === '/api/admin/catalog' && req.method === 'PATCH') { if (!can(user, 'catalog:write')) return deny(res); let b; try { b = await body(req); } catch (e) { return json(res, e.statusCode || 400, { error: 'invalid_json' }); } if (Array.isArray(b.plans)) { if (b.plans.length > 20) return json(res, 413, { error: 'too_many_plans' }); db.plans = b.plans.slice(0,20).map(x => ({ id:stringField(x.id,80), name:stringField(x.name,100), description:stringField(x.description,500), active:x.active !== false, features:Array.isArray(x.features) ? x.features.slice(0,20).map(v => stringField(v,240)).filter(Boolean) : [], limits:x.limits && typeof x.limits === 'object' ? x.limits : {}, prices:x.prices && typeof x.prices === 'object' ? x.prices : {} })).filter(x => x.id && x.name); } if (Array.isArray(b.agents)) { db.agents = b.agents.slice(0,20).map(x => ({ id:stringField(x.id,80), name:stringField(x.name,100), description:stringField(x.description,500), enabled:x.enabled !== false, order:Number.isFinite(Number(x.order)) ? Number(x.order) : 0 })).filter(x => x.id && x.name); } if (b.content && typeof b.content === 'object') { const c=b.content; db.content = { ...db.content, landing:c.landing && typeof c.landing === 'object' ? { ...db.content.landing, eyebrow:stringField(c.landing.eyebrow,160,db.content.landing.eyebrow), headline:stringField(c.landing.headline,300,db.content.landing.headline), subhead:stringField(c.landing.subhead,800,db.content.landing.subhead) } : db.content.landing, faq:Array.isArray(c.faq) ? c.faq.slice(0,100).map(x=>({id:stringField(x.id,100,safeId('faq')),question:stringField(x.question,300),answer:stringField(x.answer,2000)})).filter(x=>x.question&&x.answer) : db.content.faq, resources:Array.isArray(c.resources) ? c.resources.slice(0,100).map(x=>({id:stringField(x.id,100,safeId('resource')),title:stringField(x.title,200),description:stringField(x.description,1000),kind:stringField(x.kind,80,'documentation'),published:x.published !== false})).filter(x=>x.title) : db.content.resources }; } await save(); record('Updated platform catalog', user, { plans:db.plans.length, agents:db.agents.length }); return json(res, 200, { plans:db.plans, agents:db.agents, content:db.content }); }
    }
    if (p === '/api/public-content' && req.method === 'GET') return json(res, 200, { plans: db.plans.filter(x => x.active !== false), agents: db.agents.filter(x => x.enabled !== false).sort((a,b) => a.order-b.order), content: db.content });
    if (p === '/api/agents' && req.method === 'GET') return json(res, 200, { agents: db.agents.filter(x => x.enabled !== false).sort((a,b) => a.order-b.order) });
    if (p === '/api/plans' && req.method === 'GET') { const currency = new URL(req.url, 'http://localhost').searchParams.get('currency') || 'INR'; return json(res, 200, { currency, plans: db.plans.filter(x => x.active !== false).map(x => ({ ...x, price: x.prices?.[currency]?.amount ?? null })) }); }
    if (p === '/api/billing/status' && req.method === 'GET') { if (!user) return json(res, 401, { error:'auth' }); return json(res, 200, { plan:user.plan || 'free', currencies:['INR','USD'], paymentReady:!!(process.env.STRIPE_SECRET_KEY || process.env.RAZORPAY_KEY_ID || process.env.PAYPAL_CLIENT_ID) }); }
    if (p === '/api/payments/checkout' && req.method === 'POST') { if (!user) return json(res, 401, { error:'auth' }); let b; try { b = await body(req); } catch (e) { return json(res, e.statusCode || 400, { error:'invalid_json' }); } const planId=stringField(b.planId,80), currency=stringField(b.currency,3,'INR').toUpperCase(); const plan=db.plans.find(x=>x.id===planId&&x.active!==false); if (!plan) return json(res, 400, { error:'invalid_plan' }); if (!['INR','USD'].includes(currency)) return json(res, 400, { error:'invalid_currency', message:'Choose INR or USD.' }); const price=plan.prices?.[currency]?.amount; if (price == null) return json(res, 400, { error:'price_unavailable', message:'This plan does not have a price in the selected currency.' }); if (!(process.env.STRIPE_SECRET_KEY || process.env.RAZORPAY_KEY_ID || process.env.PAYPAL_CLIENT_ID)) return json(res, 503, { error:'payment_provider_not_configured', message:'No verified payment provider is configured. No membership was activated.' }); return json(res, 501, { error:'payment_provider_not_implemented', message:'Payment provider credentials are present, but checkout still requires provider-specific setup.' }); }
    if (p === '/manus-routes.json') return json(res, 200, { routes:[{path:'/',title:'Luma'},{path:'/admin',title:'Luma Admin Console'}] });
    if (p === '/luma-logo.svg' || p === '/luma-logo-on-dark.svg') { const asset = path.join(ROOT, 'public', path.basename(p)); res.writeHead(200, { 'Content-Type':'image/svg+xml; charset=utf-8', 'Cache-Control':'public, max-age=86400', ...securityHeaders() }); return fs.createReadStream(asset).pipe(res); }
    if (p === '/' || p === '/index.html' || p === '/admin') { res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-cache', ...securityHeaders() }); return fs.createReadStream(HTML).pipe(res); }
    res.writeHead(404, { 'Content-Type':'text/plain; charset=utf-8', ...securityHeaders() }); res.end('Not found');
  } catch (e) { console.error('request_error', e.code || e.message); if (!res.headersSent) json(res, 500, { error:'server_error', message:'The server could not complete this request.' }); }
});

async function start() {
  const state = await persistence.init();
  if (state.mode === 'mysql') {
    const storedSecret = await persistence.meta('session_secret');
    if (storedSecret) SESSION_SECRET = storedSecret;
    else { await persistence.setMeta('session_secret', SESSION_SECRET); }
  } else {
    if (persistence.db.sessionSecret) SESSION_SECRET = persistence.db.sessionSecret;
    else { persistence.db.sessionSecret = SESSION_SECRET; await save(); }
  }
  db = persistence.db; pruneActivity(); await save();
  server.listen(PORT, '0.0.0.0', () => console.log(`Luma admin API listening on port ${PORT} (${persistence.mode})`));
}
if (require.main === module) start().catch(err => { console.error('startup_failed', err.code || err.message); process.exit(1); });
module.exports = { server, ROLES, seed, start };
