/**
 * Typing for what the admin middleware puts on `Astro.locals`. Only set on admin routes.
 */
declare namespace App {
  interface Locals {
    /** The signed-in admin, set by src/middleware.ts on /admin/** and /api/v1/admin/**. */
    admin?: import('./guard.ts').AdminSession;
    /** Which sign-in method the admin uses (or why it is locked). Set on admin routes only. */
    adminAuth?: { mode: 'access' | 'password' | 'locked'; reason?: string };
  }
}
