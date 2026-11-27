const { adminSupabase } = require('../config/supabase');
const logger = require('../utils/logger');
const { createAdAnalysisService } = require('./adAnalysisService');

module.exports = createAdAnalysisService({ supabase: adminSupabase, logger });
