"use client";

import { useEffect } from "react";

/**
 * Supabase sends its default email link back to the Site URL (the wall) when
 * the /auth/callback redirect is not in its allow list. Pass the token on to
 * /auth/callback instead of leaving the person on the wall, signed out.
 */
export function AuthHashRedirect() {
  useEffect(() => {
    const { hash, pathname } = window.location;
    if (pathname !== "/auth/callback" && /(^#|&)(access_token|error_code)=/.test(hash)) window.location.replace(`/auth/callback${hash}`);
  }, []);
  return null;
}
