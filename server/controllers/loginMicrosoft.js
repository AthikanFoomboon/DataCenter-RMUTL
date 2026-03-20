const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { ConfidentialClientApplication } = require('@azure/msal-node');

// Prisma setup using pg adapter
let prisma;
const getPrisma = () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured');
  }
  if (!prisma) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });
  }
  return prisma;
};

// Microsoft identity config (supports RMUTL env names with dashes or underscores)
const msalConfig = () => {
  const clientId =
    process.env['MS-RMUTL_CLIENT_ID'] ||
    process.env.MS_CLIENT_ID ||
    process.env.MS_RMUTL_CLIENT_ID;
  const clientSecret =
    process.env['MS-RMUTL_CLIENT_SECRET'] ||
    process.env.MS_CLIENT_SECRET ||
    process.env.MS_RMUTL_CLIENT_SECRET;
  const tenantId =
    process.env['MS-RMUTL_TENANT_ID'] ||
    process.env['MS-RMURL_TENANT_ID'] ||
    process.env.MS_TENANT_ID ||
    process.env.MS_RMUTL_TENANT_ID;
  const redirectUri =
    process.env['MS-RMUTL_REDIRECT_URI'] ||
    process.env.MS_REDIRECT_URI ||
    process.env.MS_RMUTL_REDIRECT_URI ||
    'http://localhost:5173/auth/microsoft';

  if (!clientId || !clientSecret || !tenantId) {
    throw new Error(
      'MS_CLIENT_ID/MS_CLIENT_SECRET/MS_TENANT_ID (or RMUTL-prefixed variants) are not configured'
    );
  }

  return {
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      clientSecret
    },
    system: { loggerOptions: { loggerCallback() {} } },
    redirectUri
  };
};

const graphScopes = ['openid', 'profile', 'email', 'User.Read', 'offline_access'];

const encodeState = (data) => Buffer.from(JSON.stringify(data)).toString('base64url');
const decodeState = (state) => JSON.parse(Buffer.from(state, 'base64url').toString());

const truncateLongString = (value, { head = 80, tail = 20, max = 140 } = {}) => {
  if (typeof value !== 'string') return value;
  if (value.length <= max) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
};

const fetchGraphJson = async (url, accessToken) => {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`Graph request failed (${r.status}) ${text}`);
  }
  return r.json();
};

const fetchGraphPhotoDataUri = async (accessToken) => {
  // Returns null if user has no photo or Graph rejects the request.
  const r = await fetch('https://graph.microsoft.com/v1.0/me/photo/$value', {
    headers: { Authorization: `Bearer ${accessToken}` }
  }).catch(() => null);

  if (!r) return null;
  if (r.status === 404) return null;
  if (!r.ok) return null;

  const contentType = r.headers.get('content-type') || 'image/jpeg';
  const buf = Buffer.from(await r.arrayBuffer());
  const b64 = buf.toString('base64');
  return `data:${contentType};base64,${b64}`;
};

exports.loginMicrosoftStart = async (req, res, next) => {
  try {
    const { client_URL } = req.body || {};
    if (!client_URL) return res.status(400).json({ error: 'client_URL is required' });

    let clientUrl;
    try {
      clientUrl = new URL(client_URL);
    } catch {
      return res.status(400).json({ error: 'client_URL must be a valid URL' });
    }

    const finalRedirect =
      process.env.MS_RMUTL_REDIRECT_URI ||
      process.env['MS-RMUTL_REDIRECT_URI'] ||
      'http://localhost:5173/auth/microsoft';

    const state = encodeState({ clientUrl: clientUrl.toString(), finalRedirect });
    const config = msalConfig();
    const cca = new ConfidentialClientApplication(config);
    const authUrl = await cca.getAuthCodeUrl({
      scopes: graphScopes,
      redirectUri: config.redirectUri,
      state
    });

    return res.json({ authUrl, state });
  } catch (err) {
    return next(err);
  }
};

exports.loginMicrosoftCallback = async (req, res, next) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).json({ error: 'code and state are required' });

    let parsedState;
    try {
      parsedState = decodeState(state);
    } catch {
      return res.status(400).json({ error: 'invalid state' });
    }

    const config = msalConfig();
    const cca = new ConfidentialClientApplication(config);
    const tokenResponse = await cca.acquireTokenByCode({
      code,
      scopes: graphScopes,
      redirectUri: config.redirectUri
    });

    const profile = await fetchGraphJson(
      'https://graph.microsoft.com/v1.0/me',
      tokenResponse.accessToken
    );
    const profileImage = await fetchGraphPhotoDataUri(tokenResponse.accessToken);

    const userEmail = profile.mail || profile.userPrincipalName || null;
    const userName = profile.displayName || null;
    const sessionToken = crypto.randomUUID();

    if (!userEmail) {
      return res.status(500).json({ error: 'Microsoft profile did not include an email/UPN' });
    }

    let db;
    try {
      db = getPrisma();
    } catch (configErr) {
      return res.status(500).json({ error: configErr.message });
    }

    const userUpsertUpdate = {
      email: userEmail,
      fullNameTh: userName
    };
    if (profileImage) userUpsertUpdate.profileImage = profileImage;

    const user = await db.user.upsert({
      where: { username: userEmail },
      update: userUpsertUpdate,
      create: {
        username: userEmail,
        email: userEmail,
        fullNameTh: userName,
        profileImage: profileImage || null,
        // User.password is required by schema; generate a random secret for Microsoft-created users.
        password: `microsoft:${crypto.randomBytes(32).toString('hex')}`
      }
    });

    const record = await db.loginHistory.create({
      data: {
        userId: user.id,
        clientUrl: parsedState.clientUrl,
        status: 'success'
      }
    });

    const payload = {
      loginId: record.id,
      userId: user.id,
      provider: 'microsoft',
      userEmail,
      userName,
      loginAt: record.createdAt.toISOString(),
      sessionToken
    };

    const finalRedirect =
      parsedState.finalRedirect ||
      process.env.MS_RMUTL_REDIRECT_URI ||
      process.env['MS-RMUTL_REDIRECT_URI'] ||
      'http://localhost:5173/auth/microsoft';

    const payloadParam = encodeState(payload);
    const redirectUrl = new URL(finalRedirect);
    redirectUrl.searchParams.set('payload', payloadParam);
    redirectUrl.searchParams.set('state', state);

    return res.redirect(302, redirectUrl.toString());
  } catch (err) {
    return next(err);
  }
};

// Decode the payload that was sent to the client after successful login
exports.getMicrosoftPayload = async (req, res) => {
  const { payload } = req.query;
  if (!payload) return res.status(400).json({ error: 'payload is required' });
  try {
    const data = decodeState(payload);
    let db;
    try {
      db = getPrisma();
    } catch (configErr) {
      return res.status(500).json({ error: configErr.message });
    }

    const userId = typeof data.userId === 'number' ? data.userId : null;
    const loginId = typeof data.loginId === 'number' ? data.loginId : null;

    const [user, loginHistory] = await Promise.all([
      userId
        ? db.user.findUnique({
            where: { id: userId },
            select: {
              id: true,
              username: true,
              role: true,
              profileImage: true,
              fullNameTh: true,
              prefixTh: true,
              prefixEn: true,
              province: true,
              area: true,
              email: true,
              phone: true,
              address: true,
              createdAt: true,
              updatedAt: true
            }
          })
        : null,
      loginId
        ? db.loginHistory.findUnique({
            where: { id: loginId },
            select: {
              id: true,
              userId: true,
              clientUrl: true,
              status: true,
              createdAt: true,
              user: {
                select: {
                  id: true,
                  username: true,
                  email: true,
                  fullNameTh: true,
                  profileImage: true
                }
              }
            }
          })
        : null
    ]);

    const safeUser = user ? { ...user, profileImage: truncateLongString(user.profileImage) } : null;
    const safeLoginHistory = loginHistory
      ? {
          ...loginHistory,
          user: loginHistory.user
            ? { ...loginHistory.user, profileImage: truncateLongString(loginHistory.user.profileImage) }
            : null
        }
      : null;

    return res.json({ payload: data, user: safeUser, loginHistory: safeLoginHistory });
  } catch {
    return res.status(400).json({ error: 'invalid payload' });
  }
};

// Single entrypoint for Microsoft auth:
// - If Microsoft redirects back with ?code=...&state=... => complete login then redirect with payload
// - If frontend lands with ?payload=... => decode and return payload JSON
exports.microsoftAuth = async (req, res, next) => {
  if (req.query && req.query.code) return exports.loginMicrosoftCallback(req, res, next);
  if (req.query && req.query.payload) return exports.getMicrosoftPayload(req, res);
  return res.status(400).json({ error: 'code/state or payload is required' });
};
