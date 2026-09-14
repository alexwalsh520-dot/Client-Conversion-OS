export function hasInboxAccess(user: { role?: string; allowedTabs?: string[] } | null | undefined) {
  return !!user && (user.role === "admin" || user.allowedTabs?.includes("/coaching") === true);
}
