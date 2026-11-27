const crypto = require('crypto');
const { promisify } = require('util');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiResponse } = require('../utils/ApiResponse');
const { ApiError } = require('../utils/ApiError');
const { adminSupabase } = require('../config/supabase');
const logger = require('../utils/logger');

const scrypt = promisify(crypto.scrypt);
const PASSWORD_KEY_LENGTH = 64;
const SESSION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, PASSWORD_KEY_LENGTH, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt}$${derived.toString('hex')}`;
}

async function verifyPassword(password, encodedHash) {
  const [algorithm, n, r, p, salt, expectedHex] = String(encodedHash || '').split('$');
  if (algorithm !== 'scrypt' || !salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  if (expected.length !== PASSWORD_KEY_LENGTH) return false;
  const actual = await scrypt(password, salt, expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
  });
  return crypto.timingSafeEqual(actual, expected);
}

async function createSession(user) {
  const accessToken = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
  const tokenHash = crypto.createHash('sha256').update(accessToken).digest('hex');
  const { error } = await adminSupabase.from('app_sessions').insert({
    user_id: user.id,
    token_hash: tokenHash,
    expires_at: expiresAt.toISOString(),
  });
  if (error) throw new ApiError(503, 'Could not create a session. Apply the manual authentication database migration.', error.message);
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_at: Math.floor(expiresAt.getTime() / 1000),
    user: { id: user.id, email: user.email },
  };
}

const signUp = asyncHandler(async (req, res) => {
  const displayName = String(req.body?.displayName || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!displayName || displayName.length > 100) throw new ApiError(400, 'Enter a name up to 100 characters');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'Enter a valid email address');
  if (password.length < 8 || password.length > 128) throw new ApiError(400, 'Password must be between 8 and 128 characters');

  const passwordHash = await hashPassword(password);
  const { data: user, error } = await adminSupabase.from('app_users')
    .insert({ email, password_hash: passwordHash })
    .select('id, email')
    .single();
  if (error || !user) {
    if (error?.code === '23505') throw new ApiError(409, 'An account with this email already exists. Sign in instead.');
    if (error?.code === 'PGRST205' || error?.code === '42P01') {
      logger.error({
        message: 'Manual-auth tables are missing from the configured Supabase project',
        operation: 'create app user',
        code: error.code,
        databaseMessage: error.message,
        requestId: req.id,
      });
      throw new ApiError(503, 'The account table is missing from the configured database. Run server/database/manual_auth_migration.sql in the same Supabase project used by server/.env.');
    }
    if (error?.code === '42501') {
      throw new ApiError(503, 'Supabase denied account-table access. Re-run the complete manual-auth migration and confirm the server uses the service_role key.');
    }
    if (error?.code === 'PGRST204') {
      throw new ApiError(503, 'The account table schema cache is stale or its columns do not match. Re-run the complete manual-auth migration and reload the Supabase API schema.');
    }
    logger.error({
      message: 'Manual-auth account insert failed',
      operation: 'create app user',
      code: error?.code || null,
      databaseMessage: error?.message || 'Supabase returned no account row',
      databaseDetails: error?.details || null,
      databaseHint: error?.hint || null,
      requestId: req.id,
    });
    throw new ApiError(
      503,
      `Could not create your account${error?.code ? ` (database error ${error.code})` : ''}. Check that the manual-auth migration was fully applied to the configured Supabase project.`,
      error ? { code: error.code, message: error.message, details: error.details, hint: error.hint } : null,
    );
  }

  const { error: profileError } = await adminSupabase.from('profiles').insert({
    id: user.id,
    email,
    display_name: displayName,
  });
  if (profileError) {
    await adminSupabase.from('app_users').delete().eq('id', user.id);
    logger.error({
      message: 'Manual-auth profile insert failed',
      code: profileError.code,
      databaseMessage: profileError.message,
      databaseDetails: profileError.details,
      databaseHint: profileError.hint,
      requestId: req.id,
    });
    throw new ApiError(503, 'Could not create your profile. Check the personalization and manual-auth migrations.', {
      code: profileError.code, message: profileError.message, details: profileError.details, hint: profileError.hint,
    });
  }

  const session = await createSession(user);
  res.status(201).json(ApiResponse.success('Account created', { session, user }));
});

const signIn = asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || !password) throw new ApiError(400, 'Email and password are required');
  const { data: user, error } = await adminSupabase.from('app_users')
    .select('id, email, password_hash')
    .eq('email', email)
    .maybeSingle();
  if (error) throw new ApiError(503, 'Manual authentication is unavailable. Apply the manual authentication database migration.');
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw new ApiError(401, 'Email or password is incorrect');
  }
  const session = await createSession(user);
  res.json(ApiResponse.success('Signed in successfully', { session, user: { id: user.id, email: user.email } }));
});

const signOut = asyncHandler(async (req, res) => {
  const { error } = await adminSupabase.from('app_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', req.sessionId)
    .eq('token_hash', req.sessionTokenHash);
  if (error) throw new ApiError(503, 'Could not close this session');
  res.status(204).end();
});

module.exports = { signUp, signIn, signOut };
