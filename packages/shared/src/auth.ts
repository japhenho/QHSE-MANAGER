import { z } from 'zod';

/** Organisation code typed on the login screen (identifies the tenant, decision D-12). */
export const organizationCodeSchema = z.string().trim().toLowerCase().min(3).max(50);

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const loginRequestSchema = z.object({
  organization: organizationCodeSchema,
  email: emailSchema,
  /** Never trimmed nor transformed: a password is taken exactly as typed. */
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Policy for a password being chosen: length only, no arbitrary composition rule. */
export const newPasswordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

export interface AuthenticatedUser {
  id: string;
  email: string;
}

export interface AuthenticatedTenant {
  id: string;
  /** Organisation code. */
  slug: string;
  name: string;
}

/** `GET /auth/me` */
export interface CurrentUserResponse {
  user: AuthenticatedUser;
  tenant: AuthenticatedTenant;
}

/** `POST /auth/login` and `POST /auth/refresh` */
export interface AuthSessionResponse extends CurrentUserResponse {
  /** Short-lived bearer token. Keep it in memory only. */
  accessToken: string;
  /** Lifetime of the access token, in seconds. */
  expiresIn: number;
}
