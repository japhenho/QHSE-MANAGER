import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type AuthSessionResponse,
  type CurrentUserResponse,
  type LoginRequest,
  loginRequestSchema,
} from '@qhse/shared';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { ENV, type Env } from '../config/index.js';
import { forbiddenOrigin, retryAfterOf, tooManyAttempts, unauthenticated } from './auth.errors.js';
import type { AuthenticatedRequest } from './auth.guard.js';
import { AuthService, type IssuedSession } from './auth.service.js';
import { Public } from './public.decorator.js';
import { RateLimiter, type RateLimitRule } from './rate-limiter.service.js';
import { readCookie, REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from './refresh-token.js';
import { originOf } from './request-origin.js';

const LOGIN_LIMIT: RateLimitRule = { name: 'auth-login', limit: 20, windowSeconds: 60 };
const REFRESH_LIMIT: RateLimitRule = { name: 'auth-refresh', limit: 60, windowSeconds: 60 };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly auth: AuthService,
    private readonly rateLimiter: RateLimiter,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Log in with an organisation code, an e-mail and a password' })
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    return this.answer(response, async () => {
      this.limit(LOGIN_LIMIT, request);
      return this.auth.login(body, originOf(request));
    });
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange the refresh cookie for a new access token (rotation)' })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    this.assertTrustedOrigin(request);
    try {
      return await this.answer(response, async () => {
        this.limit(REFRESH_LIMIT, request);
        return this.auth.refresh(this.refreshCookieOf(request), originOf(request));
      });
    } catch (error) {
      // A refused token is useless: remove it from the browser.
      if (retryAfterOf(error) === undefined) this.clearRefreshCookie(response);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'End the session of the refresh cookie' })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    this.assertTrustedOrigin(request);
    await this.auth.logout(this.refreshCookieOf(request), originOf(request));
    this.clearRefreshCookie(response);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The authenticated user and their tenant' })
  me(@Req() request: AuthenticatedRequest): Promise<CurrentUserResponse> {
    const auth = request.auth;
    if (!auth) throw unauthenticated();
    return this.auth.currentIdentity(auth.tenantId, auth.userId);
  }

  // ---------------------------------------------------------------- helpers

  private async answer(
    response: Response,
    issue: () => Promise<IssuedSession>,
  ): Promise<AuthSessionResponse> {
    try {
      const session = await issue();
      response.cookie(REFRESH_COOKIE_NAME, session.refreshCookie, {
        ...this.cookieAttributes(),
        maxAge: session.refreshCookieMaxAgeSeconds * 1000,
      });
      // Tokens must never be stored by a proxy or by the browser cache.
      response.setHeader('Cache-Control', 'no-store');
      return session.body;
    } catch (error) {
      const retryAfter = retryAfterOf(error);
      if (retryAfter !== undefined) response.setHeader('Retry-After', String(retryAfter));
      throw error;
    }
  }

  private limit(rule: RateLimitRule, request: Request): void {
    const wait = this.rateLimiter.consume(rule, request.ip ?? 'unknown');
    if (wait > 0) throw tooManyAttempts(wait);
  }

  private cookieAttributes() {
    return {
      httpOnly: true,
      secure: this.env.AUTH_COOKIE_SECURE,
      sameSite: 'strict' as const,
      path: REFRESH_COOKIE_PATH,
    };
  }

  private clearRefreshCookie(response: Response): void {
    response.clearCookie(REFRESH_COOKIE_NAME, this.cookieAttributes());
  }

  private refreshCookieOf(request: Request): string | undefined {
    return readCookie(request.headers.cookie, REFRESH_COOKIE_NAME);
  }

  /**
   * CSRF defence in depth for the routes that act on the cookie alone (the cookie is
   * already SameSite=Strict): a browser request coming from an origin that is not in
   * the allow-list is refused. Requests without an Origin header are not browser
   * cross-site requests.
   */
  private assertTrustedOrigin(request: Request): void {
    const origin = request.headers.origin;
    if (origin === undefined) return;
    if (this.env.API_CORS_ORIGINS.includes(origin)) return;
    const host = request.headers.host;
    if (host !== undefined && origin === `${request.protocol}://${host}`) return;
    throw forbiddenOrigin();
  }
}
