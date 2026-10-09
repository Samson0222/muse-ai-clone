# 🚀 Chapter 01 — Project Setup & Environment

> **Video Timestamp:** `00:06:18 - 00:21:27`  
> **Parent Track:** [`docs/video-walkthrough/00_VIDEO_CHAPTERS_OVERVIEW.md`](./00_VIDEO_CHAPTERS_OVERVIEW.md)

---

## 🎯 What the Video Covers in this Chapter

1. Cloning / initializing the React Native Expo app with Expo Router.
2. Setting up the 5 core tabs in `src/app/(tabs)/`:
   - `chat.tsx` — Conversational interface
   - `feed.tsx` — Activity feed
   - `ideas.tsx` — Automation templates
   - `tasks.tsx` — Scheduled goals manager
   - `settings.tsx` — Account settings & connectors
3. Integrating `@hugeicons/react-native` and `@hugeicons/core-free-icons`.
4. Setting up Android Virtual Device (AVD) in Android Studio and testing the app.

---

## 📦 Key Dependencies Used

```bash
# Expo core dependencies
npx expo install expo-router react-native-safe-area-context react-native-screens react-native-svg
npm install @hugeicons/react-native @hugeicons/core-free-icons
```

---

## ✅ Chapter Verification Gate

- App builds cleanly via `npx expo start`.
- 5 tabs are switchable from the bottom navigation bar.
- Cooper's 3D mascot header renders at the top of the screen.
