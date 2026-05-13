// SOP library: permission helpers.
//
// Per the spec, only admins (role='admin' in app_users) can upload SOPs
// and manage departments/roles. Everyone else with /sop access can view
// and download.

import { auth } from "@/auth";
import type { Session } from "next-auth";
import type { SopPermissions } from "./types";

export async function getSessionOrThrow(): Promise<Session> {
  const session = await auth();
  if (!session?.user?.email) {
    throw new SopUnauthorizedError("not signed in");
  }
  return session;
}

export async function requireAdmin(): Promise<Session> {
  const session = await getSessionOrThrow();
  if (session.user?.role !== "admin") {
    throw new SopForbiddenError("admin role required");
  }
  return session;
}

export function permissionsFor(session: Session | null): SopPermissions {
  const isAdmin = session?.user?.role === "admin";
  return {
    canUpload: isAdmin,
    canManage: isAdmin,
  };
}

export class SopUnauthorizedError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "SopUnauthorizedError";
  }
}

export class SopForbiddenError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "SopForbiddenError";
  }
}
