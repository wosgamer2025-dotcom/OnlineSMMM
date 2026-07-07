import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';

dotenv.config({ path: process.env.ONLINESMMM_ENV_FILE || '/var/www/onlinesmmm/.env', quiet: true });
dotenv.config({ quiet: true });

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production.');
}

const jwtSecret = process.env.JWT_SECRET || 'onlinesmmm-dev-secret';

export function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      email: user.email,
      permissions: user.permissions,
    },
    jwtSecret,
    { expiresIn: process.env.ADMIN_SESSION_TTL || '2h' },
  );
}

export function verifyToken(token) {
  return jwt.verify(token, jwtSecret);
}

export function sanitizeUser(user) {
  const safeUser = { ...user };
  delete safeUser.passwordHash;
  delete safeUser.twoFactorSecret;
  return safeUser;
}

export function generateTwoFactorSecret(email) {
  return speakeasy.generateSecret({
    name: `onlinesmmm (${email})`,
    issuer: 'onlinesmmm',
    length: 20,
  });
}

export function verifyTotp(secret, token) {
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token,
    window: 1,
  });
}
