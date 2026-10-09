# 🚀 Sub-Plan 06 — Production Polish, Security & Mobile Distribution

> **Document:** `docs/07_SUBPLAN_PRODUCTION_POLISH_AND_DEPLOYMENT.md`  
> **Parent Plan:** [`docs/00_MASTER_PLAN.md`](./00_MASTER_PLAN.md)  
> **Video Alignment:** Chapter `03:54:09 Wrap Up`

---

## 🎯 Objective & Scope

Finalize and polish all remaining tabs and user flows:
1. Connect the **Ideas Tab** templates directly to the Chat input loop.
2. Build out the **Feed Tab** to show autonomous agent digests and completed tasks.
3. Polish **Settings Tab** with dynamic usage tracking and account actions.
4. Enforce security hardening (zero secret leakage into mobile binaries).
5. Configure EAS Build for production Android (`.apk` / `.aab`) and iOS (`.ipa`) deployment.

---

## 🎨 Tab Polish & User Experience Upgrades

### 1. Ideas Tab to Chat Integration (`src/app/(tabs)/ideas.tsx`)
When a user selects an automation template (e.g., *"Hacker News Digest"*, *"Competitor Price Tracker"*), navigate to `/chat` and auto-populate the prompt:

```typescript
import { useRouter } from 'expo-router';

// Inside IdeasScreen
const router = useRouter();

const handleSelectIdea = (idea: IdeaItem) => {
  router.push({
    pathname: '/(tabs)/chat',
    params: { initialPrompt: idea.prompt },
  });
};
```

In `chat.tsx`, listen for `initialPrompt` query param and auto-fill the `inputText`.

### 2. Autonomous Intelligence Feed (`src/app/(tabs)/feed.tsx`)
Transform `feed.tsx` into an autonomous activity stream:
- Fetch recent entries from `agent_tool_runs` and completed `scheduled_agent_tasks`.
- Display card-based feed items:
  - Timestamp & Agent Avatar.
  - Action summary (e.g. *"Daily Tech Brief delivered to Slack"* or *"Amazon prices monitored"*).
  - Tap card to view full summary report.

### 3. Dynamic Plan Quota in Settings (`src/app/(tabs)/settings.tsx`)
- Compute percent used based on `agent_tool_runs` count in the current billing cycle.
- Render dynamic progress bar with upgrade CTA.
- "Sign Out" button cleanly calls `supabase.auth.signOut()` and navigates to `/`.

### 4. Mascot Customization Persistence (`EditAgentModal.tsx`)
- Save custom mascot name and aura color into `AsyncStorage` (`@muse_agent_profile`).
- Load saved profile on application launch in `TabLayout` (`src/app/(tabs)/_layout.tsx`).

---

## 🛡️ Security Hardening & Secret Isolation

Mobile app binaries can be decompiled. Strict isolation of keys is mandatory:

| Key | Location | Exposed to Mobile Client? |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Mobile `.env` / Client | ✅ Yes (Public by design) |
| `EXPO_PUBLIC_SUPABASE_KEY` | Mobile `.env` / Client | ✅ Yes (Anon key restricted by RLS) |
| `SUPABASE_SERVICE_ROLE_KEY`| Server / Edge Secrets only | ❌ **NEVER** |
| `OPENAI_API_KEY` | Server / Edge Secrets only | ❌ **NEVER** |
| `BROWSERBASE_API_KEY` | Server / Edge Secrets only | ❌ **NEVER** |
| `COMPOSIO_API_KEY` | Server / Edge Secrets only | ❌ **NEVER** |

All calls requiring `OPENAI_API_KEY`, `BROWSERBASE_API_KEY`, or `COMPOSIO_API_KEY` must execute exclusively inside:
- Expo Server API Routes (`src/app/api/*`)
- Supabase Edge Functions (`supabase/functions/*`)

---

## 📦 Mobile Production Build (EAS Build)

### 1. Install EAS CLI & Login
```bash
npm install -g eas-cli
eas login
```

### 2. Configure `eas.json`
Create `eas.json` at project root:

```json
{
  "cli": {
    "version": ">= 12.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    },
    "production": {
      "android": {
        "buildType": "app-bundle"
      },
      "ios": {
        "simulator": false
      }
    }
  }
}
```

### 3. Trigger Mobile Builds
```bash
# Build standalone Android APK for direct testing
eas build --platform android --profile preview

# Build iOS Simulator or Distribution
eas build --platform ios --profile preview
```

---

## 🏆 Final Acceptance Criteria & Definition of Done

- [ ] Complete 5-tab navigation operates without layout regressions or jitter.
- [ ] Google OAuth sign-in and sign-out cycle reliably across devices.
- [ ] Chat conversation supports token streaming and multi-turn context retention.
- [ ] Browserbase & Stagehand open live browser sessions with in-app WebView stream preview.
- [ ] Composio connects external tools (Gmail, Slack) and executes tools on user prompt.
- [ ] Autonomous scheduled tasks execute in the cloud via `agent-run` and `pg_cron`.
- [ ] Zero sensitive secrets are bundled in the client application.
- [ ] Standalone mobile build successfully compiles via Expo EAS.
