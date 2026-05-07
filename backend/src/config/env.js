import dotenv from 'dotenv';
dotenv.config();

const env = {
  NODE_ENV:    process.env.NODE_ENV || 'development',
  PORT:        parseInt(process.env.PORT, 10) || 5000,
  MONGO_URI:   process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/dpes_agl',

  JWT_SECRET:     process.env.JWT_SECRET     || 'fallback-secret',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',

  COMPANY_NAME:    process.env.COMPANY_NAME    || 'M/s AMBIKA GLOBAL',
  COMPANY_CODE:    process.env.COMPANY_CODE    || 'AGL',
  COMPANY_ADDRESS: process.env.COMPANY_ADDRESS || '',
  COMPANY_PHONE:   process.env.COMPANY_PHONE   || '',
  COMPANY_EMAIL:   process.env.COMPANY_EMAIL   || '',

  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: parseInt(process.env.SMTP_PORT, 10) || 587,
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',

  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 900000,
  RATE_LIMIT_MAX:       parseInt(process.env.RATE_LIMIT_MAX, 10)       || 200,
};

export default env;
