// ═══════════════════════════════════════════════════════
// Supabase Auth Middleware
// Verifies bearer token using Supabase client auth service
// ═══════════════════════════════════════════════════════

const { supabase } = require('../config/supabase');

/**
 * Express middleware to authenticate requests using Supabase tokens.
 *
 * Expects header: Authorization: Bearer <jwt_token>
 *
 * On success, attaches `req.uid` and `req.user` to the request object.
 * On failure, returns 401/403 error.
 */
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Missing or invalid Authorization header. Use: Bearer <token>',
    });
  }

  const token = authHeader.split('Bearer ')[1];

  if (!token || token.trim().length === 0) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Empty token provided.',
    });
  }

  // Developer Bypass / testing mock users if secret is not set in development
  if (process.env.NODE_ENV !== 'production' && token === 'mock-dev-token') {
    req.uid = 'mock_user_12345';
    req.user = {
      id: 'mock_user_12345',
      email: 'karim.netsave@example.com',
      user_metadata: {
        full_name: 'Karim Tester',
      }
    };
    return next();
  }

  try {
    // Call Supabase core auth API to verify the JWT token
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      throw error || new Error('Auth user not found');
    }

    // Attach user info to request
    req.uid = user.id;
    req.user = user;

    next();
  } catch (err) {
    console.error('[AUTH] Supabase token verification failed:', {
      error: err.message,
      ip: req.ip,
    });

    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Invalid or expired authentication token.',
    });
  }
}

module.exports = { authenticate };
