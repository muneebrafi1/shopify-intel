/**
 * Launch flags. The site is open for now: no paywall, no sign-in, no Pro pitch. Accounts, boards and
 * Whop checkout stay in the code (the account and /pro routes work) but their entry points are hidden
 * until PUBLIC_PRO_ENABLED=1 is set at build time. The API and MCP server are free either way.
 */
export const PRO_ENABLED = import.meta.env.PUBLIC_PRO_ENABLED === '1';
