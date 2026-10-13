const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');

const TABLES = {
  meta: 'whizzy_meta',
  users: 'whizzy_users',
  sessions: 'whizzy_sessions',
  settings: 'whizzy_settings',
  conversations: 'whizzy_conversations',
  activity: 'whizzy_activity',
  apiKeys: 'whizzy_api_keys',
  usage: 'whizzy_usage',
  profiles: 'whizzy_profiles',
  onboarding: 'whizzy_onboarding',
  projects: 'whizzy_projects',
  reports: 'whizzy_reports'
};

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function iso(value) { if (value == null) return null; return value instanceof Date ? value.toISOString() : value; }
function asJson(value, fallback) { try { return value == null ? fallback : (typeof value === 'string' ? JSON.parse(value) : value); } catch { return fallback; } }
function safeId(prefix) { return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`; }

class Persistence {
  constructor({ dataFile, seed }) {
    this.dataFile = dataFile;
    this.seed = seed;
    this.pool = null;
    this.db = null;
    this.mode = process.env.DATABASE_URL && !(process.env.WHIZZY_DATA_FILE && process.env.WHIZZY_ALLOW_DEMO_HEADER === 'true') ? 'mysql' : 'json';
    this.writeChain = Promise.resolve();
  }

  loadJson() {
    try { return JSON.parse(fs.readFileSync(this.dataFile, 'utf8')); }
    catch { fs.writeFileSync(this.dataFile, JSON.stringify(this.seed, null, 2)); return clone(this.seed); }
  }

  normalize(db) {
    db.users = (db.users || []).map(u => ({ plan: u.role === 'owner' ? 'premium' : 'free', status: 'active', ...u }));
    db.settings = db.settings || clone(this.seed.settings || {});
    db.conversations = db.conversations || [];
    db.activity = db.activity || [];
    db.apiKeys = db.apiKeys || [];
    db.usage = db.usage || {};
    db.sessions = db.sessions || [];
    db.profiles = db.profiles || {};
    db.onboarding = db.onboarding || {};
    db.projects = db.projects || [];
    db.reports = db.reports || [];
    db.plans = db.plans || clone(this.seed.plans || []);
    db.agents = db.agents || clone(this.seed.agents || []);
    db.content = db.content || clone(this.seed.content || { landing: {}, faq: [], resources: [] });
    return db;
  }

  async init() {
    if (this.mode === 'json') { this.db = this.normalize(this.loadJson()); return { mode: this.mode }; }
    this.pool = mysql.createPool({
      uri: process.env.DATABASE_URL,
      waitForConnections: true,
      connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 8),
      enableKeepAlive: true,
      connectTimeout: 10000,
      ssl: process.env.DATABASE_SSL_CA ? { ca: process.env.DATABASE_SSL_CA, rejectUnauthorized: true } : { rejectUnauthorized: process.env.DATABASE_SSL_INSECURE !== 'true' }
    });
    await this.pool.query('SELECT 1');
    await this.migrate();
    await this.seedIfEmpty();
    this.db = await this.loadMysql();
    return { mode: this.mode };
  }

  async migrate() {
    const q = async sql => this.pool.query(sql);
    await q(`CREATE TABLE IF NOT EXISTS ${TABLES.meta} (meta_key VARCHAR(100) PRIMARY KEY, meta_value TEXT NOT NULL)`);
    await q(`CREATE TABLE IF NOT EXISTS ${TABLES.users} (
      id VARCHAR(160) PRIMARY KEY, email VARCHAR(320) NOT NULL UNIQUE, name VARCHAR(200) NOT NULL,
      picture TEXT NULL, role VARCHAR(40) NOT NULL DEFAULT 'member', plan VARCHAR(40) NOT NULL DEFAULT 'free',
      status VARCHAR(40) NOT NULL DEFAULT 'active', last_active VARCHAR(120) NULL, last_login_at DATETIME NULL,
      suspended_until DATETIME NULL, ban_reason VARCHAR(500) NULL, onboarding_completed TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
      INDEX users_status_idx(status), INDEX users_active_idx(last_login_at)
    )`);
    await q(`CREATE TABLE IF NOT EXISTS ${TABLES.sessions} (
      id VARCHAR(160) PRIMARY KEY, user_id VARCHAR(160) NOT NULL, created_at DATETIME NOT NULL,
      expires_at DATETIME NOT NULL, revoked_at DATETIME NULL, ip VARCHAR(80) NULL, user_agent VARCHAR(500) NULL,
      INDEX sessions_user_idx(user_id), INDEX sessions_expiry_idx(expires_at),
      CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES ${TABLES.users}(id) ON DELETE CASCADE
    )`);
    await q(`CREATE TABLE IF NOT EXISTS ${TABLES.settings} (setting_key VARCHAR(100) PRIMARY KEY, value_json JSON NOT NULL)`);
    await q(`CREATE TABLE IF NOT EXISTS ${TABLES.conversations} (
      id VARCHAR(160) PRIMARY KEY, owner_id VARCHAR(160) NULL, title VARCHAR(500) NOT NULL,
      messages INT NOT NULL DEFAULT 0, updated_at DATETIME NOT NULL, payload_json JSON NULL,
      INDEX conversations_owner_idx(owner_id), INDEX conversations_updated_idx(updated_at)
    )`);
    await q(`CREATE TABLE IF NOT EXISTS ${TABLES.activity} (
      id BIGINT PRIMARY KEY, event VARCHAR(500) NOT NULL, actor_id VARCHAR(160) NULL, actor VARCHAR(200) NOT NULL,
      event_time DATETIME NOT NULL, status VARCHAR(40) NOT NULL DEFAULT 'Success', metadata_json JSON NULL,
      INDEX activity_time_idx(event_time), INDEX activity_actor_idx(actor_id)
    )`);
    await q(`CREATE TABLE IF NOT EXISTS ${TABLES.apiKeys} (
      id VARCHAR(160) PRIMARY KEY, provider VARCHAR(50) NOT NULL, label VARCHAR(120) NOT NULL,
      ciphertext TEXT NOT NULL, active TINYINT(1) NOT NULL DEFAULT 1, created_at DATETIME NOT NULL, last_used DATETIME NULL
    )`);
    await q(`CREATE TABLE IF NOT EXISTS ${TABLES.usage} (
      date_key DATE NOT NULL, user_id VARCHAR(160) NOT NULL, used INT NOT NULL DEFAULT 0,
      PRIMARY KEY(date_key, user_id)
    )`);
    await q(`CREATE TABLE IF NOT EXISTS ${TABLES.profiles} (
      user_id VARCHAR(160) PRIMARY KEY, data_json JSON NOT NULL, updated_at DATETIME NOT NULL,
      CONSTRAINT profiles_user_fk FOREIGN KEY (user_id) REFERENCES ${TABLES.users}(id) ON DELETE CASCADE
    )`);
    await q(`CREATE TABLE IF NOT EXISTS ${TABLES.onboarding} (
      user_id VARCHAR(160) PRIMARY KEY, answers_json JSON NOT NULL, completed_at DATETIME NULL, updated_at DATETIME NOT NULL,
      CONSTRAINT onboarding_user_fk FOREIGN KEY (user_id) REFERENCES ${TABLES.users}(id) ON DELETE CASCADE
    )`);
    await q(`CREATE TABLE IF NOT EXISTS ${TABLES.projects} (
      id VARCHAR(160) PRIMARY KEY, user_id VARCHAR(160) NOT NULL, name VARCHAR(200) NOT NULL,
      description TEXT NULL, files_json JSON NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL, deleted_at DATETIME NULL,
      INDEX projects_user_idx(user_id), CONSTRAINT projects_user_fk FOREIGN KEY (user_id) REFERENCES ${TABLES.users}(id) ON DELETE CASCADE
    )`);
    await q(`CREATE TABLE IF NOT EXISTS ${TABLES.reports} (
      id VARCHAR(160) PRIMARY KEY, reporter_id VARCHAR(160) NOT NULL, target_user_id VARCHAR(160) NULL,
      report_type VARCHAR(80) NOT NULL, description TEXT NOT NULL, status VARCHAR(40) NOT NULL DEFAULT 'open',
      resolution TEXT NULL, created_at DATETIME NOT NULL, resolved_at DATETIME NULL,
      INDEX reports_status_idx(status), INDEX reports_reporter_idx(reporter_id),
      CONSTRAINT reports_reporter_fk FOREIGN KEY (reporter_id) REFERENCES ${TABLES.users}(id) ON DELETE CASCADE
    )`);
  }

  async meta(key) {
    if (this.mode === 'json') return this.db.meta?.[key] || null;
    const [rows] = await this.pool.query(`SELECT meta_value FROM ${TABLES.meta} WHERE meta_key=?`, [key]);
    return rows[0]?.meta_value || null;
  }

  async setMeta(key, value) {
    if (this.mode === 'json') { this.db.meta = this.db.meta || {}; this.db.meta[key] = value; return; }
    await this.pool.query(`INSERT INTO ${TABLES.meta}(meta_key,meta_value) VALUES(?,?) ON DUPLICATE KEY UPDATE meta_value=VALUES(meta_value)`, [key, value]);
  }

  async seedIfEmpty() {
    const [rows] = await this.pool.query(`SELECT COUNT(*) AS count FROM ${TABLES.users}`);
    if (Number(rows[0].count) > 0) return;
    const now = new Date();
    for (const user of this.seed.users || []) {
      await this.pool.query(`INSERT INTO ${TABLES.users}(id,email,name,picture,role,plan,status,last_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`, [user.id, user.email, user.name, user.picture || null, user.role || 'member', user.plan || 'free', user.status || 'active', user.lastActive || null, now, now]);
    }
    for (const [key, value] of Object.entries(this.seed.settings || {})) await this.pool.query(`INSERT INTO ${TABLES.settings}(setting_key,value_json) VALUES(?,?)`, [key, JSON.stringify(value)]);
    for (const c of this.seed.conversations || []) await this.pool.query(`INSERT INTO ${TABLES.conversations}(id,owner_id,title,messages,updated_at,payload_json) VALUES(?,?,?,?,?,?)`, [String(c.id), c.ownerId || null, c.title || 'Untitled', Number(c.messages || 0), new Date(c.updated || now), JSON.stringify(c)]);
    for (const a of this.seed.activity || []) await this.pool.query(`INSERT INTO ${TABLES.activity}(id,event,actor_id,actor,event_time,status,metadata_json) VALUES(?,?,?,?,?,?,?)`, [String(a.id), a.event, a.actorId || null, a.actor || 'System', new Date(a.time || now), a.status || 'Success', JSON.stringify(a.metadata || {})]);
  }

  async loadMysql() {
    const [users] = await this.pool.query(`SELECT * FROM ${TABLES.users} ORDER BY created_at`);
    const [sessions] = await this.pool.query(`SELECT id,user_id,created_at,expires_at,revoked_at FROM ${TABLES.sessions} WHERE revoked_at IS NULL AND expires_at > NOW()`);
    const [settings] = await this.pool.query(`SELECT setting_key,value_json FROM ${TABLES.settings}`);
    const [conversations] = await this.pool.query(`SELECT * FROM ${TABLES.conversations} ORDER BY updated_at DESC`);
    const [activity] = await this.pool.query(`SELECT * FROM ${TABLES.activity} ORDER BY event_time DESC LIMIT 1000`);
    const [apiKeys] = await this.pool.query(`SELECT * FROM ${TABLES.apiKeys} ORDER BY created_at DESC`);
    const [usage] = await this.pool.query(`SELECT DATE_FORMAT(date_key,'%Y-%m-%d') AS date_key,user_id,used FROM ${TABLES.usage}`);
    const [profiles] = await this.pool.query(`SELECT user_id,data_json FROM ${TABLES.profiles}`);
    const [onboarding] = await this.pool.query(`SELECT user_id,answers_json,completed_at FROM ${TABLES.onboarding}`);
    const [projects] = await this.pool.query(`SELECT * FROM ${TABLES.projects} WHERE deleted_at IS NULL ORDER BY updated_at DESC`);
    const [reports] = await this.pool.query(`SELECT * FROM ${TABLES.reports} ORDER BY created_at DESC`);
    const db = { users: users.map(u => ({ id:u.id,email:u.email,name:u.name,picture:u.picture || undefined,role:u.role,plan:u.plan,status:u.status,lastActive:u.last_active,lastLoginAt:iso(u.last_login_at),suspendedUntil:iso(u.suspended_until),banReason:u.ban_reason })), settings:{}, conversations:conversations.map(c => ({ ...(asJson(c.payload_json, {})), id:c.id, ownerId:c.owner_id, title:c.title, messages:Number(c.messages), updated:c.updated_at ? new Date(c.updated_at).getTime() : Date.now() })), activity:activity.map(a => ({ id:String(a.id), event:a.event, actorId:a.actor_id, actor:a.actor, time:iso(a.event_time), status:a.status, metadata:asJson(a.metadata_json,{}) })), apiKeys:apiKeys.map(k => ({ id:k.id,provider:k.provider,label:k.label,ciphertext:k.ciphertext,active:!!k.active,createdAt:iso(k.created_at),lastUsed:iso(k.last_used) })), usage:{}, sessions:sessions.map(s => ({ id:s.id,userId:s.user_id,createdAt:iso(s.created_at),expiresAt:iso(s.expires_at),revokedAt:s.revoked_at ? iso(s.revoked_at) : null })), profiles:{}, onboarding:{}, projects:projects.map(p => ({ id:p.id,userId:p.user_id,name:p.name,description:p.description || '',files:asJson(p.files_json,[]),createdAt:iso(p.created_at),updatedAt:iso(p.updated_at) })), reports:reports.map(r => ({ id:r.id,reporterId:r.reporter_id,targetUserId:r.target_user_id,reportType:r.report_type,description:r.description,status:r.status,resolution:r.resolution,createdAt:iso(r.created_at),resolvedAt:r.resolved_at ? iso(r.resolved_at) : null })) };
    for (const s of settings) db.settings[s.setting_key] = asJson(s.value_json, s.value_json);
    db.plans = asJson(db.settings.__catalog_plans, this.seed.plans || []);
    db.agents = asJson(db.settings.__catalog_agents, this.seed.agents || []);
    db.content = asJson(db.settings.__catalog_content, this.seed.content || { landing: {}, faq: [], resources: [] });
    for (const u of usage) { db.usage[u.date_key] = db.usage[u.date_key] || {}; db.usage[u.date_key][u.user_id] = Number(u.used); }
    for (const p of profiles) db.profiles[p.user_id] = asJson(p.data_json, {});
    for (const o of onboarding) db.onboarding[o.user_id] = { answers:asJson(o.answers_json,{}), completed:!!o.completed_at, completedAt:o.completed_at ? iso(o.completed_at) : null };
    return this.normalize(db);
  }

  async persist(db) {
    if (this.mode === 'json') { fs.writeFileSync(this.dataFile, JSON.stringify(db, null, 2)); return; }
    const operation = this.writeChain.then(async () => {
      const c = this.pool;
      for (const u of db.users || []) await c.query(`INSERT INTO ${TABLES.users}(id,email,name,picture,role,plan,status,last_active,last_login_at,suspended_until,ban_reason,onboarding_completed,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE email=VALUES(email),name=VALUES(name),picture=VALUES(picture),role=VALUES(role),plan=VALUES(plan),status=VALUES(status),last_active=VALUES(last_active),last_login_at=VALUES(last_login_at),suspended_until=VALUES(suspended_until),ban_reason=VALUES(ban_reason),onboarding_completed=VALUES(onboarding_completed),updated_at=VALUES(updated_at)`, [u.id,u.email,u.name,u.picture||null,u.role||'member',u.plan||'free',u.status||'active',u.lastActive||null,u.lastLoginAt && u.lastLoginAt !== 'Invalid Date' ? new Date(u.lastLoginAt) : null,u.suspendedUntil && u.suspendedUntil !== 'Invalid Date' ? new Date(u.suspendedUntil) : null,u.banReason||null,db.onboarding?.[u.id]?.completed?1:0,new Date(),new Date()]);
      const settings = { ...(db.settings || {}), __catalog_plans: db.plans || [], __catalog_agents: db.agents || [], __catalog_content: db.content || {} };
      for (const [key,value] of Object.entries(settings)) await c.query(`INSERT INTO ${TABLES.settings}(setting_key,value_json) VALUES(?,?) ON DUPLICATE KEY UPDATE value_json=VALUES(value_json)`, [key,JSON.stringify(value)]);
      for (const conv of db.conversations || []) await c.query(`INSERT INTO ${TABLES.conversations}(id,owner_id,title,messages,updated_at,payload_json) VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE owner_id=VALUES(owner_id),title=VALUES(title),messages=VALUES(messages),updated_at=VALUES(updated_at),payload_json=VALUES(payload_json)`, [String(conv.id),conv.ownerId||null,conv.title||'Untitled',Number(conv.messages||0),new Date(conv.updated||Date.now()),JSON.stringify(conv)]);
      for (const key of db.apiKeys || []) await c.query(`INSERT INTO ${TABLES.apiKeys}(id,provider,label,ciphertext,active,created_at,last_used) VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE provider=VALUES(provider),label=VALUES(label),ciphertext=VALUES(ciphertext),active=VALUES(active),last_used=VALUES(last_used)`, [key.id,key.provider,key.label,key.ciphertext, key.active?1:0,new Date(key.createdAt || Date.now()),key.lastUsed ? new Date(key.lastUsed) : null]);
      for (const [date,users] of Object.entries(db.usage || {})) for (const [userId,used] of Object.entries(users || {})) await c.query(`INSERT INTO ${TABLES.usage}(date_key,user_id,used) VALUES(?,?,?) ON DUPLICATE KEY UPDATE used=VALUES(used)`, [date,userId,Number(used)]);
      for (const [userId,profile] of Object.entries(db.profiles || {})) await c.query(`INSERT INTO ${TABLES.profiles}(user_id,data_json,updated_at) VALUES(?,?,?) ON DUPLICATE KEY UPDATE data_json=VALUES(data_json),updated_at=VALUES(updated_at)`, [userId,JSON.stringify(profile),new Date()]);
      for (const [userId,entry] of Object.entries(db.onboarding || {})) await c.query(`INSERT INTO ${TABLES.onboarding}(user_id,answers_json,completed_at,updated_at) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE answers_json=VALUES(answers_json),completed_at=VALUES(completed_at),updated_at=VALUES(updated_at)`, [userId,JSON.stringify(entry.answers||{}),entry.completedAt ? new Date(entry.completedAt) : null,new Date()]);
      for (const p of db.projects || []) await c.query(`INSERT INTO ${TABLES.projects}(id,user_id,name,description,files_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),description=VALUES(description),files_json=VALUES(files_json),updated_at=VALUES(updated_at),deleted_at=NULL`, [p.id,p.userId,p.name,p.description||'',JSON.stringify(p.files||[]),new Date(p.createdAt||Date.now()),new Date(p.updatedAt||Date.now())]);
    });
    this.writeChain = operation.catch(err => { console.error('persistence_write_failed', err.code || err.message); });
    return operation;
  }

  async addActivity(entry) {
    if (this.mode === 'json') return;
    try { await this.pool.query(`INSERT INTO ${TABLES.activity}(id,event,actor_id,actor,event_time,status,metadata_json) VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE event=VALUES(event)`, [String(entry.id),entry.event,entry.actorId||null,entry.actor||'System',new Date(entry.time||Date.now()),entry.status||'Success',JSON.stringify(entry.metadata||{})]); } catch (e) { console.error('activity_write_failed',e.code||e.message); }
  }

  async createSession(userId, { ip, userAgent, ttlMs = 30 * 24 * 60 * 60 * 1000 } = {}) {
    const id = safeId('sess');
    const createdAt = new Date();
    const expiresAt = new Date(Date.now() + ttlMs);
    const session = { id, userId, createdAt:createdAt.toISOString(), expiresAt:expiresAt.toISOString(), revokedAt:null };
    this.db.sessions = (this.db.sessions || []).filter(s => s.expiresAt > new Date().toISOString() && !s.revokedAt);
    this.db.sessions.push(session);
    if (this.mode === 'mysql') await this.pool.query(`INSERT INTO ${TABLES.sessions}(id,user_id,created_at,expires_at,ip,user_agent) VALUES(?,?,?,?,?,?)`, [id,userId,createdAt,expiresAt,ip||null,userAgent||null]);
    return session;
  }

  async revokeSessions(userId) {
    this.db.sessions = (this.db.sessions || []).map(s => s.userId === userId ? {...s,revokedAt:new Date().toISOString()} : s);
    if (this.mode === 'mysql') await this.pool.query(`UPDATE ${TABLES.sessions} SET revoked_at=NOW() WHERE user_id=? AND revoked_at IS NULL`, [userId]);
  }

  async deleteConversation(id) { if (this.mode === 'mysql') await this.pool.query(`DELETE FROM ${TABLES.conversations} WHERE id=?`, [String(id)]); }
  async deleteApiKey(id) { if (this.mode === 'mysql') await this.pool.query(`DELETE FROM ${TABLES.apiKeys} WHERE id=?`, [String(id)]); }
  async close() { if (this.pool) await this.pool.end(); }
}

module.exports = { Persistence, TABLES, safeId };
