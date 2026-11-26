/**
 * Plans and what they unlock. The plan is derived from Whop memberships only; the defaults are the
 * drafted ones in HANDOFF.md (Free = home-page screenshots + basic data; Pro = every page type,
 * full-page and section screenshots, exports; Team = Pro for 3 seats).
 */
export type Plan = 'free' | 'pro' | 'team';

/** Whop statuses that keep access. 'canceling' and cancel_at_period_end keep it until the end. */
export const ACCESS_STATUSES = new Set(['active', 'trialing', 'canceling', 'past_due']);

export interface MembershipLike {
  productId: string;
  status: string;
  currentPeriodEnd?: string | null;
}

export function planFor(
  memberships: MembershipLike[],
  products: { pro: string | null; team: string | null },
): Plan {
  let plan: Plan = 'free';
  for (const m of memberships) {
    if (!ACCESS_STATUSES.has(m.status)) continue;
    if (products.team && m.productId === products.team) return 'team';
    if (products.pro && m.productId === products.pro) plan = 'pro';
  }
  return plan;
}

export const isPaid = (plan: string | null | undefined) =>
  plan === 'pro' || plan === 'team' || plan === 'lifetime';

export const PLAN_LABEL: Record<string, string> = {
  free: 'Free',
  pro: 'Pro',
  team: 'Team',
  lifetime: 'Pro (lifetime)',
};
