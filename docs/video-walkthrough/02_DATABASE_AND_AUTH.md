# 🔐 Chapter 02 — Database & Authentication (Google OAuth)

> **Video Timestamp:** `00:21:27 - 00:50:17`  
> **Parent Track:** [`docs/video-walkthrough/00_VIDEO_CHAPTERS_OVERVIEW.md`](./00_VIDEO_CHAPTERS_OVERVIEW.md)

---

## 🎯 What the Video Covers in this Chapter

1. Creating a new Supabase project.
2. Configuring Google Cloud OAuth Credentials (Web Client ID & Secret) with Supabase redirect URL:
   `https://<project-ref>.supabase.co/auth/v1/callback`
3. Setting up the Supabase Client with `AsyncStorage` session persistence.
4. Implementing the Google OAuth login button in `src/app/index.tsx`.
5. Testing the Google login popup flow and verifying the authenticated user session in Supabase Dashboard.

> [!NOTE]
> In this video chapter, **no chat or task database tables are created yet**. Only user authentication is configured. Chat persistence tables are created later in Chapter 04 (`01:14:33`).

---

## 🛠️ Step-by-Step Implementation

### 1. Supabase Client (`src/lib/supabase.ts`)

```typescript
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_KEY!,
  {
    auth: {
      storage: AsyncStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  }
);
```

### 2. Google OAuth Handshake (`src/app/index.tsx`)

```typescript
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { supabase } from "@/lib/supabase";

WebBrowser.maybeCompleteAuthSession();

export async function handleGoogleSignIn(router: any) {
  const redirectTo = Linking.createURL("/auth/callback");

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error) throw error;
  if (!data?.url) return;

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== "success") return;

  // Extract access token and refresh token from URL fragment
  const params = new URLSearchParams(result.url.split("#")[1]);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");

  if (accessToken && refreshToken) {
    const { data: sessionData, error: sessionError } =
      await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

    if (sessionError) throw sessionError;

    if (sessionData.session) {
      router.replace("/(tabs)/chat");
    }
  }
}
```

---

## ✅ Chapter Verification Gate

- User taps "Sign in with Google" on `src/app/index.tsx`.
- Google consent sheet opens in browser window.
- Upon successful authentication, user is redirected into `/(tabs)/chat`.
- The user appears in the **Supabase Dashboard -> Authentication -> Users** list.
