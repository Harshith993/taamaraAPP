"use client";

import { createAuthClient } from "better-auth/react";
import { phoneNumberClient } from "better-auth/client/plugins";

/** Browser-side auth calls (sign in, sign out). They go to /api/auth, where rate limits apply. */
export const authClient = createAuthClient({
  plugins: [phoneNumberClient()],
});
