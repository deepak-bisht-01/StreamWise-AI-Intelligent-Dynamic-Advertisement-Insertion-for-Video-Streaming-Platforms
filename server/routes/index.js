const express = require('express');
const videoRoutes = require('./videoRoutes');
const { healthCheck: dbHealthCheck } = require('../config/supabase');
const { cloudinary } = require('../config/cloudinary');
const logger = require('../utils/logger');

const router = express.Router();

router.get('/health', async (req, res) => {
  const healthCheck = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    checks: {
      database: 'unknown',
      cloudinary: 'unknown',
    }
  };

  // Check database connection
  try {
    const dbHealth = await dbHealthCheck();
    healthCheck.checks.database = dbHealth;
  } catch (dbError) {
    healthCheck.checks.database = {
      status: 'unhealthy',
      latency: 'unknown',
      error: dbError.message
    };
    logger.error({ message: 'Database health check failed', error: dbError.message });
  }

  // Check Cloudinary connection
  try {
    const start = Date.now();
    await cloudinary.api.ping();
    const latency = Date.now() - start;
    healthCheck.checks.cloudinary = {
      status: 'healthy',
      latency: `${latency}ms`,
      error: null
    };
  } catch (cloudinaryError) {
    healthCheck.checks.cloudinary = {
      status: 'unhealthy',
      latency: 'unknown',
      error: cloudinaryError.message
    };
    logger.error({ message: 'Cloudinary health check failed', error: cloudinaryError.message });
  }

  const overallHealth = Object.values(healthCheck.checks).every(check => 
    typeof check === 'object' ? check.status === 'healthy' : check === 'healthy'
  );
  const statusCode = overallHealth ? 200 : 503;

  res.status(statusCode).json({
    success: overallHealth,
    message: overallHealth ? 'Lumina API is healthy' : 'Lumina API has degraded services',
    data: healthCheck,
  });
});

router.use('/videos', videoRoutes);

module.exports = router;
