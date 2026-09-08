const { createClient } = require('@supabase/supabase-js');
const { env } = require('./env');
const logger = require('../utils/logger');

// Validate Supabase configuration
function validateSupabaseConfig() {
  if (!env.supabase.url || !env.supabase.anonKey) {
    throw new Error('Supabase URL and anon key are required');
  }

  try {
    new URL(env.supabase.url);
  } catch (error) {
    throw new Error('Invalid Supabase URL format');
  }

  if (env.supabase.anonKey.length < 20) {
    throw new Error('Invalid Supabase anon key format');
  }
}

validateSupabaseConfig();

const supabase = createClient(env.supabase.url, env.supabase.anonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  db: {
    schema: 'public',
  },
  global: {
    headers: {
      'X-Client-Info': 'lumina-api',
      'X-Client-Version': '1.0.0',
    },
  },
  // Add timeout configuration
  timeout: 30000, // 30 seconds default timeout
});

async function connectDatabase() {
  try {
    // Test connection with a simple query
    const { error } = await supabase
      .from('videos')
      .select('id')
      .limit(1);
    
    if (error) {
      throw new Error(`Supabase connection failed: ${error.message}`);
    }
    
    logger.info({ 
      message: 'Database connection established successfully',
      url: env.supabase.url.replace(/\/\/.*@/, '//***@') // Log masked URL
    });
  } catch (error) {
    logger.error({ 
      message: 'Database connection failed', 
      error: error.message,
      url: env.supabase.url.replace(/\/\/.*@/, '//***@')
    });
    throw error;
  }
}

async function healthCheck() {
  try {
    const start = Date.now();
    const { error } = await supabase
      .from('videos')
      .select('id')
      .limit(1);
    
    const duration = Date.now() - start;
    
    return {
      status: error ? 'unhealthy' : 'healthy',
      latency: `${duration}ms`,
      error: error?.message || null
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      latency: 'unknown',
      error: error.message
    };
  }
}

module.exports = {
  supabase,
  connectDatabase,
  healthCheck,
};