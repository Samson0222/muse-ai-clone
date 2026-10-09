# 🛠️ Muse AI Clone — Environment, Accounts & Prerequisites Guide

> **Document:** `docs/01_ENVIRONMENT_AND_SETUP.md`  
> **Parent Plan:** [`docs/00_MASTER_PLAN.md`](./00_MASTER_PLAN.md)  
> **Target Audience:** Developers & Coding Agents setting up the local runtime, cloud services, and mobile tools.

---

## 1. 💻 Local Developer Prerequisites

Ensure the following runtimes and tools are installed and verified in your operating system environment:

| Runtime / Tool | Required Version | Verification Command | Purpose |
|---|---|---|---|
| **Node.js** | `>= 20.x LTS` | `node -v` | JavaScript/TypeScript execution runtime |
| **npm** | `>= 10.x` | `npm -v` | Node package manager |
| **Git** | `>= 2.40` | `git --version` | Version control |
| **Python** | `>= 3.10` | `python --version` | Utility scripting and native build helpers |
| **Expo CLI** | Bundled with Expo | `npx expo -v` | Mobile app builder and Metro bundler |
| **Supabase CLI** | `>= 1.150` | `npx supabase --version` | Edge Function deployment & DB migrations |

---

## 2. 📱 Mobile Testing & Emulator Setup

### A. Android Setup (Windows / macOS / Linux)
1. **Install Android Studio:** Download from [developer.android.com/studio](https://developer.android.com/studio).
2. **Configure SDK Components:**
   - In SDK Manager, install **Android 14 (API 34)** or **Android 15 (API 35)** SDK platform.
   - Install **Android SDK Build-Tools**, **Android SDK Command-line Tools**, and **Android Emulator**.
3. **Set System Environment Variables (Windows):**
   - `ANDROID_HOME`: `C:\Users\<YourUser>\AppData\Local\Android\Sdk`
   - Add to `Path`:
     - `%ANDROID_HOME%\platform-tools`
     - `%ANDROID_HOME%\emulator`
     - `%ANDROID_HOME%\cmdline-tools\latest\bin`
4. **Create an Android Virtual Device (AVD):**
   - Device: Pixel 8 or Pixel 7 Pro
   - System Image: Vanilla Ice Cream (API 35) or Upside Down Cake (API 34) with Google APIs.
   - Start the emulator: verify with `adb devices`.

### B. iOS Setup (macOS only)
1. Install **Xcode** from the Mac App Store.
2. Install Command Line Tools: `xcode-select --install`.
3. Open Simulator: `open -a Simulator`.

### C. Web Testing (Fast Iteration)
- Expo SDK 57 supports universal web builds. Run `npx expo start --web` to immediately test UI layouts, styling, and API routes in Google Chrome or Edge.

---

## 3. ☁️ Required Cloud Services & API Keys

Before running agentic capabilities, register and retrieve the following credentials:

### A. Supabase (Backend, Auth & Database)
1. Go to [supabase.com](https://supabase.com) and create a new project (e.g., `muse-ai-clone`).
2. Navigate to **Project Settings -> API**:
   - Copy **Project URL** (`https://<project-ref>.supabase.co`)
   - Copy **anon public API key**
   - Copy **service_role secret key** (used by Supabase Edge Functions & server routes)
3. Navigate to **Authentication -> URL Configuration**:
   - Set **Site URL** to `http://localhost:8081` (for Expo local web dev).
   - Under **Redirect URLs**, add:
     - `https://<project-ref>.supabase.co/auth/v1/callback`
     - `museaiclone://auth/callback`
     - `exp://localhost:8081/--/auth/callback`

### B. Google Cloud Console (Google Sign-In OAuth)
1. Go to [Google Cloud Console](https://console.cloud.google.com).
2. Create or select a project.
3. Configure **OAuth consent screen**:
   - User Type: **External**
   - App Name: `Muse AI Clone`
   - Scopes: `email`, `profile`, `openid`.
4. Go to **Credentials -> Create Credentials -> OAuth client ID**:
   - Application type: **Web application**
   - Name: `Supabase Google Auth`
   - Authorized JavaScript origins: `https://<project-ref>.supabase.co`
   - Authorized redirect URIs: `https://<project-ref>.supabase.co/auth/v1/callback`
5. Copy **Client ID** and **Client Secret**.
6. In Supabase Dashboard, go to **Authentication -> Providers -> Google**:
   - Enable Google provider.
   - Paste **Client ID** and **Client Secret**.
   - Save changes.

### C. OpenAI (Agent LLM Engine)
1. Go to [platform.openai.com](https://platform.openai.com).
2. Generate an API Key with model access to `gpt-4o`.
3. Ensure adequate billing credits are available.

### D. Browserbase & Stagehand (Cloud Browser Automation)
1. Sign up at [browserbase.com](https://www.browserbase.com).
2. Create a new project.
3. Under **Settings / API Keys**:
   - Copy **API Key** (`BROWSERBASE_API_KEY`)
   - Copy **Project ID** (`BROWSERBASE_PROJECT_ID`)

### E. Composio (Tool Connectors & Tool Router)
1. Sign up at [composio.dev](https://composio.dev).
2. In the Composio Dashboard, go to **Settings -> API Keys**:
   - Generate and copy your **Composio API Key** (`COMPOSIO_API_KEY`).
3. Under **Integrations / Toolkits**, ensure access to:
   - Gmail
   - Slack
   - Google Calendar
   - Notion
   - GitHub

---

## 4. 📦 Package Dependencies Installation

The application requires specific libraries for agent orchestration, web automation, WebView rendering, and tool calling.

Run the following installation command in `C:\Coding\agent-project\muse-ai-clone`:

```bash
# 1. Native Expo compatible packages (Using npx expo install)
npx expo install react-native-webview expo-web-browser expo-linking @react-native-async-storage/async-storage

# 2. AI Agent and Automation SDKs
npm install @openai/agents @browserbasehq/sdk @browserbasehq/stagehand @composio/core @composio/openai-agents zod ws
npm install -D @types/ws
```

---

## 5. 🔐 Environment Variables Configuration (`.env`)

Create or update the `.env` file at the project root `C:\Coding\agent-project\muse-ai-clone\.env`:

```env
# ==========================================
# SUPABASE CONFIGURATION (Public & Private)
# ==========================================
EXPO_PUBLIC_SUPABASE_URL=https://<YOUR_PROJECT_REF>.supabase.co
EXPO_PUBLIC_SUPABASE_KEY=<YOUR_SUPABASE_ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<YOUR_SUPABASE_SERVICE_ROLE_KEY>

# ==========================================
# OPENAI AGENT CONFIGURATION
# ==========================================
OPENAI_API_KEY=sk-proj-...

# ==========================================
# BROWSERBASE & STAGEHAND AUTOMATION
# ==========================================
BROWSERBASE_API_KEY=bb_...
BROWSERBASE_PROJECT_ID=...

# ==========================================
# COMPOSIO TOOL ROUTER CONFIGURATION
# ==========================================
COMPOSIO_API_KEY=comp_...
```

---

## 6. ⚡ Supabase CLI Setup for Edge Functions

Supabase Edge Functions execute the autonomous agent tasks in the cloud.

```bash
# 1. Login to Supabase CLI
npx supabase login

# 2. Link your local project to your remote Supabase project
npx supabase link --project-ref <YOUR_PROJECT_REF>

# 3. Set remote secrets in Supabase Edge environment
npx supabase secrets set \
  SUPABASE_URL="https://<YOUR_PROJECT_REF>.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="<YOUR_SUPABASE_SERVICE_ROLE_KEY>" \
  OPENAI_API_KEY="<YOUR_OPENAI_API_KEY>" \
  BROWSERBASE_API_KEY="<YOUR_BROWSERBASE_API_KEY>" \
  BROWSERBASE_PROJECT_ID="<YOUR_BROWSERBASE_PROJECT_ID>" \
  COMPOSIO_API_KEY="<YOUR_COMPOSIO_API_KEY>"
```

---

## ✅ Environment Verification Checklist

- [ ] `node -v` outputs `>= 20.0.0`
- [ ] `npx expo -v` outputs valid version without errors
- [ ] Android Studio / Emulator launches and responds to `adb devices`
- [ ] Supabase project created with database accessible
- [ ] Google OAuth 2.0 credentials added to Supabase Google provider
- [ ] `.env` created with all valid keys (Supabase, OpenAI, Browserbase, Composio)
- [ ] `npm run start` boots the Metro development server cleanly
