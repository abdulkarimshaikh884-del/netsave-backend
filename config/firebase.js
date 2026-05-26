// ═══════════════════════════════════════════════════════
// Firebase Admin SDK Configuration
// ═══════════════════════════════════════════════════════

const admin = require('firebase-admin');

let db = null;

/**
 * Initialize Firebase Admin SDK with service account credentials
 * from environment variables (no JSON file needed on server).
 */
function initFirebase() {
  if (admin.apps.length > 0) {
    db = admin.firestore();
    return;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Missing Firebase credentials. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in .env'
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });

  db = admin.firestore();

  // Firestore settings optimized for Oracle Cloud
  db.settings({
    ignoreUndefinedProperties: true,
  });
}

/**
 * Get Firestore database instance.
 * @returns {admin.firestore.Firestore}
 */
function getDb() {
  if (!db) {
    throw new Error('Firebase not initialized. Call initFirebase() first.');
  }
  return db;
}

/**
 * Get Firebase Auth instance (for token verification).
 * @returns {admin.auth.Auth}
 */
function getAuth() {
  return admin.auth();
}

/**
 * Get a Firestore Timestamp for the current moment.
 * @returns {admin.firestore.Timestamp}
 */
function now() {
  return admin.firestore.Timestamp.now();
}

/**
 * Get the FieldValue helper for atomic operations.
 * @returns {admin.firestore.FieldValue}
 */
function fieldValue() {
  return admin.firestore.FieldValue;
}

module.exports = {
  initFirebase,
  getDb,
  getAuth,
  now,
  fieldValue,
};
