/**
 * NetSupabase Client Initialization
 * =================================
 * Initializes the Supabase JS client using SUPABASE_URL and SUPABASE_ANON_KEY.
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('[SUPABASE] ❌ Fatal error: SUPABASE_URL and SUPABASE_ANON_KEY environment variables are required.');
  process.exit(1);
}

// Initialize the Supabase Client
const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false, // Turn off session persistence for server-side APIs
    autoRefreshToken: false,
  }
});

console.log('[SUPABASE] ✅ Client initialized successfully.');

module.exports = {
  supabase,
};
export default supabase;
