import type { CompleteSetupRequest, RotateTokenRequest } from '@chatcrystal/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getProviderWarnings, isCloudMode, isPublicApiPath } from '../runtime/cloud.js';
import {
  completeSetup,
  getOrCreateSetupCode,
  hasActiveToken,
  rotateStoredToken,
  setupRequired,
  TOKEN_MAX_LENGTH,
  TOKEN_MIN_LENGTH,
  verifyToken,
} from '../services/auth.js';

const SETUP_COMPLETE_BODY_LIMIT_BYTES = 8 * 1024;

function bearerToken(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1];
}

export function registerCloudAuthHook(app: FastifyInstance) {
  app.addHook('onRequest', async (req, reply) => {
    if (!isCloudMode()) return;
    if (!req.url.startsWith('/api/')) return;
    if (isPublicApiPath(req.url)) return;

    if (setupRequired()) {
      const code = getOrCreateSetupCode();
      req.log.warn({ setupCodePath: 'setup-code' }, `ChatCrystal setup required. Setup code: ${code}`);
      reply.status(403).send({
        success: false,
        error: 'Cloud setup required. Open the Web UI and enter the setup code from the container logs or /data/setup-code.',
      });
      return reply;
    }

    const ok = await verifyToken(bearerToken(req), req.ip);
    if (!ok) {
      reply.status(401).send({ success: false, error: 'Invalid or missing ChatCrystal API token' });
      return reply;
    }
  });
}

const setupCompleteRouteOptions = {
  bodyLimit: SETUP_COMPLETE_BODY_LIMIT_BYTES,
  schema: {
    body: {
      type: 'object',
      required: ['setupCode', 'token'],
      additionalProperties: false,
      properties: {
        setupCode: { type: 'string', minLength: 1, maxLength: 128 },
        token: { type: 'string', minLength: TOKEN_MIN_LENGTH, maxLength: TOKEN_MAX_LENGTH },
      },
    },
  },
} as const;

const rotateTokenRouteOptions = {
  bodyLimit: SETUP_COMPLETE_BODY_LIMIT_BYTES,
  schema: {
    body: {
      type: 'object',
      required: ['currentToken', 'nextToken'],
      additionalProperties: false,
      properties: {
        currentToken: { type: 'string', minLength: 1, maxLength: TOKEN_MAX_LENGTH },
        nextToken: { type: 'string', minLength: TOKEN_MIN_LENGTH, maxLength: TOKEN_MAX_LENGTH },
      },
    },
  },
} as const;

export async function authRoutes(app: FastifyInstance) {
  app.get('/api/setup/status', async (req) => {
    const token = bearerToken(req);
    const authenticated = !isCloudMode() || (token ? await verifyToken(token, req.ip) : false);
    if (isCloudMode() && setupRequired()) {
      const code = getOrCreateSetupCode();
      req.log.warn({ setupCodePath: 'setup-code' }, `ChatCrystal setup required. Setup code: ${code}`);
    }

    return {
      success: true,
      data: {
        cloudMode: isCloudMode(),
        setupRequired: isCloudMode() && setupRequired(),
        authenticated,
        providerWarnings: getProviderWarnings(),
      },
    };
  });

  app.post('/api/setup/complete', setupCompleteRouteOptions, async (req, reply) => {
    if (!isCloudMode()) {
      reply.status(400);
      return { success: false, error: 'Setup is only available in cloud mode' };
    }

    const body = req.body as Partial<CompleteSetupRequest>;
    if (!body.setupCode || !body.token) {
      reply.status(400);
      return { success: false, error: 'setupCode and token are required' };
    }

    try {
      const ok = await completeSetup(body.setupCode, body.token);
      if (!ok) {
        reply.status(401);
        return { success: false, error: 'Invalid setup code' };
      }
      return { success: true, data: { authenticated: true } };
    } catch (err) {
      reply.status(429);
      return { success: false, error: err instanceof Error ? err.message : 'Setup failed' };
    }
  });

  app.post('/api/auth/verify', async (req, reply) => {
    if (!isCloudMode()) {
      return { success: true, data: { authenticated: true } };
    }
    if (!hasActiveToken()) {
      reply.status(403);
      return { success: false, error: 'Setup required before token verification' };
    }
    const authenticated = await verifyToken(bearerToken(req), req.ip);
    if (!authenticated) {
      reply.status(401);
      return { success: false, error: 'Invalid or missing ChatCrystal API token' };
    }
    return { success: true, data: { authenticated } };
  });

  app.post('/api/auth/rotate', rotateTokenRouteOptions, async (req, reply) => {
    const body = req.body as Partial<RotateTokenRequest>;
    if (!body.currentToken || !body.nextToken) {
      reply.status(400);
      return { success: false, error: 'currentToken and nextToken are required' };
    }
    try {
      const ok = await rotateStoredToken(body.currentToken, body.nextToken);
      if (!ok) {
        reply.status(401);
        return { success: false, error: 'Current token is invalid' };
      }
    } catch (err) {
      reply.status(409);
      return { success: false, error: err instanceof Error ? err.message : 'Token rotation failed' };
    }
    return { success: true, data: { rotated: true } };
  });
}
