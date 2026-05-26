// ═══════════════════════════════════════════════════════
// Firebase Auth Middleware
// Verifies the Firebase ID token from Authorization header
// ═══════════════════════════════════════════════════════

const { getAuth } = require('../config/firebase');

/**
 * Express middleware to authenticate requests using Firebase ID tokens.
 *
 * Expects header: Authorization: Bearer <firebase_id_token>
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

  const idToken = authHeader.split('Bearer ')[1];

  if (!idToken || idToken.trim().length === 0) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Empty token provided.',
    });
  }

  try {
    // Verify the token and check if it's been revoked
    const decodedToken = await getAuth().verifyIdToken(idToken, true);

    // Attach user info to request for downstream use
    req.uid = decodedToken.uid;
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email || null,
      phone: decodedToken.phone_number || null,
      name: decodedToken.name || null,
      emailVerified: decodedToken.email_verified || false,
    };

    next();
  } catch (err) {
    console.error('[AUTH] Token verification failed:', {
      error: err.code || err.message,
      ip: req.ip,
    });

    // Differentiate between expired and invalid tokens
    if (err.code === 'auth/id-token-expired') {
      return res.status(401).json({
        success: false,
        error: 'TokenExpired',
        message: 'Your session has expired. Please sign in again.',
      });
    }

    if (err.code === 'auth/id-token-revoked') {
      return res.status(401).json({
        success: false,
        error: 'TokenRevoked',
        message: 'Your session has been revoked. Please sign in again.',
      });
    }

    return res.status(403).json({
      success: false,
      error: 'Forbidden',
      message: 'Invalid authentication token.',
    });
  }
}

module.exports = { authenticate };
