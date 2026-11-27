const crypto = require('crypto');
const { adminSupabase } = require('../config/supabase');
const { ApiError } = require('../utils/ApiError');

async function requireAuth(req, _res, next) {
  try {
    const token = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw new ApiError(401, 'Sign in to continue');

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const { data: session, error: sessionError } = await adminSupabase
      .from('app_sessions')
      .select('id, user_id')
      .eq('token_hash', tokenHash)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (sessionError) throw new ApiError(503, 'Manual authentication is unavailable. Apply the manual authentication database migration.');
    if (!session) throw new ApiError(401, 'Your session is invalid or expired. Please sign in again.');

    const { data: user, error: userError } = await adminSupabase
      .from('app_users')
      .select('id, email')
      .eq('id', session.user_id)
      .single();
    if (userError || !user) throw new ApiError(401, 'Your account is unavailable. Please sign in again.');

    const { data: profile, error: profileError } = await adminSupabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    if (profileError || !profile) throw new ApiError(403, 'Your account profile is not available. Contact an administrator.');

    req.user = { ...user, role: profile.role };
    req.profile = profile;
    req.sessionId = session.id;
    req.sessionTokenHash = tokenHash;
    req.db = adminSupabase;
    next();
  } catch (error) {
    next(error);
  }
}

async function requireAdmin(req, _res, next) {
  try {
    if (!req.user || !req.db) throw new ApiError(401, 'Sign in to continue');
    if (req.profile?.role !== 'admin') throw new ApiError(403, 'Administrator access is required');
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { requireAuth, requireAdmin };
