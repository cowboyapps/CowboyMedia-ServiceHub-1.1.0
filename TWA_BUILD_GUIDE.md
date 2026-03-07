# CowboyMedia ServiceHub — Android TWA Build Guide

This guide walks you through building a native Android app from your existing PWA using a Trusted Web Activity (TWA). The resulting APK/AAB can be published on the Google Play Store.

Your PWA, desktop, and mobile web experience will remain completely unchanged.

---

## Prerequisites

Before you begin, make sure you have:

1. **A computer with Android Studio installed**
   - Download from https://developer.android.com/studio
   - During setup, ensure "Android SDK" and "Android SDK Command-line Tools" are installed

2. **Java Development Kit (JDK) 11 or higher**
   - Android Studio usually bundles this, but verify by running:
     ```bash
     java -version
     ```

3. **Node.js 18+** (for Bubblewrap CLI)

4. **A Google Play Developer account** ($25 one-time fee)
   - Sign up at https://play.google.com/console

5. **Your PWA deployed and accessible** at `https://cowboyhub.app`

---

## Option A: Using Bubblewrap (Recommended)

Bubblewrap is Google's official CLI tool for generating TWA Android projects.

### Step 1: Install Bubblewrap

On your local computer (not Replit), run:

```bash
npm install -g @bubblewrap/cli
```

Do NOT use `sudo` — it can cause permission issues.

If you prefer not to install globally, you can use `npx` instead (shown in Step 2).

**Note:** If you have trouble installing Bubblewrap, use **Option B (PWABuilder)** below instead — it's a web-based alternative that requires no CLI installation.

### Step 2: Initialize the TWA Project

Run the following command in an empty directory on your local machine:

```bash
bubblewrap init --manifest=https://cowboyhub.app/manifest.json
```

Bubblewrap will ask you several questions. Use these values:

| Setting | Value |
|---------|-------|
| **Domain** | `cowboyhub.app` |
| **Package name** | `app.cowboyhub.servicehub` |
| **App name** | `CowboyMedia ServiceHub` |
| **Short name** | `CowboyMedia` |
| **Display mode** | `standalone` |
| **Start URL** | `/` |
| **Theme color** | `#1a56db` |
| **Background color** | `#ffffff` |
| **Status bar color** | `#1a56db` |
| **Splash screen color** | `#ffffff` |
| **Icon URL** | `https://cowboyhub.app/icons/icon-512.png` |
| **Maskable icon URL** | `https://cowboyhub.app/icons/icon-512.png` |
| **Signing key** | Create a new one (see Step 3) |

### Step 3: Generate a Signing Key

If Bubblewrap doesn't prompt you to create one, generate it manually:

```bash
keytool -genkeypair \
  -alias cowboymedia \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -keystore cowboymedia-keystore.jks \
  -storepass YOUR_STORE_PASSWORD \
  -keypass YOUR_KEY_PASSWORD \
  -dname "CN=CowboyMedia, O=CowboyMedia, L=YourCity, ST=YourState, C=US"
```

**IMPORTANT: Keep this keystore file and passwords safe!** You'll need them for every future update to the app. If you lose the keystore, you cannot update the app on Google Play.

### Step 4: Get Your SHA-256 Fingerprint

Run this command to get the certificate fingerprint:

```bash
keytool -list -v -keystore cowboymedia-keystore.jks -alias cowboymedia
```

Look for the line that says **SHA256:** — it will look something like:

```
SHA256: AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90
```

### Step 5: Update the Digital Asset Links File

Back in your Replit project, open `client/public/.well-known/assetlinks.json` and replace `REPLACE_WITH_YOUR_SHA256_FINGERPRINT` with your actual fingerprint:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "app.cowboyhub.servicehub",
      "sha256_cert_fingerprints": [
        "AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90"
      ]
    }
  }
]
```

Then **republish the app** on Replit so the file is live at `https://cowboyhub.app/.well-known/assetlinks.json`.

### Step 6: Build the APK/AAB

```bash
bubblewrap build
```

This generates:
- `app-release-bundle.aab` — for Google Play Store upload
- `app-release-signed.apk` — for direct installation/testing

### Step 7: Test Before Publishing

Before uploading to the Play Store, test on a real Android device:

1. Transfer the `.apk` file to your Android phone
2. Open it to install (you may need to enable "Install from unknown sources")
3. Verify:
   - The app opens full-screen (no browser address bar)
   - Push notifications work
   - Login and all features work normally
   - The status bar matches your theme color (#1a56db)

If you see a browser address bar at the top, your `assetlinks.json` isn't set up correctly. Double-check:
- The file is accessible at `https://cowboyhub.app/.well-known/assetlinks.json`
- The SHA-256 fingerprint matches your signing key exactly
- The package name matches exactly (`app.cowboyhub.servicehub`)

---

## Option B: Using PWABuilder (No CLI Needed)

PWABuilder is a web-based tool by Microsoft that can generate an Android TWA project with no command-line setup.

### Step 1: Go to PWABuilder

1. Visit https://www.pwabuilder.com
2. Enter `https://cowboyhub.app` in the URL field
3. Click "Start"

### Step 2: Review Your PWA Score

PWABuilder will analyze your PWA and show a score. Your app should score well since it already has:
- A complete manifest with icons
- A service worker
- HTTPS

### Step 3: Package for Android

1. Click the **"Package for stores"** button
2. Select **"Android"**
3. Fill in the settings:
   - **Package ID**: `app.cowboyhub.servicehub`
   - **App name**: `CowboyMedia ServiceHub`
   - **App version**: `1`
   - **App version code**: `1`
   - **Host**: `cowboyhub.app`
   - **Start URL**: `/`
   - **Theme color**: `#1a56db`
   - **Background color**: `#ffffff`
   - **Status bar color**: `#1a56db`
   - **Splash screen color**: `#ffffff`
   - **Signing key**: Choose "Create new" or "Use existing"
   - **Display mode**: `standalone`
4. Click **"Generate"**

### Step 4: Download and Build

1. PWABuilder downloads a ZIP file containing the Android project
2. If PWABuilder generated an APK directly, skip to Step 6
3. Otherwise, open the project in Android Studio:
   - Unzip the downloaded file
   - Open Android Studio → "Open an existing project" → select the unzipped folder
   - Wait for Gradle sync to complete
   - Go to Build → Generate Signed Bundle/APK
   - Follow the wizard to sign and build

### Step 5: Get SHA-256 and Update Asset Links

Same as Option A, Steps 4-5. Get the SHA-256 fingerprint from your signing key and update the `assetlinks.json` file.

### Step 6: Test

Same as Option A, Step 7. Install the APK on your Android device and verify everything works.

---

## Publishing to Google Play Store

Once you've tested and everything works:

### Step 1: Create the App Listing

1. Go to https://play.google.com/console
2. Click "Create app"
3. Fill in:
   - **App name**: CowboyMedia ServiceHub
   - **Default language**: English
   - **App or game**: App
   - **Free or paid**: Free (or Paid if applicable)
4. Accept the declarations and click "Create app"

### Step 2: Complete the Store Listing

Fill out all required sections:
- **App details**: Description, short description
- **Graphics**: Screenshots (phone and tablet), feature graphic, icon
  - Take screenshots of your app running on a phone (or use Android emulator)
  - Feature graphic: 1024x500 px
  - Icon: 512x512 px (use your existing `/icons/icon-512.png`)
- **Categorization**: Category → Business or Utilities
- **Contact details**: Email, website (cowboyhub.app)

### Step 3: Complete the Content Rating Questionnaire

Google Play requires you to fill out a content rating questionnaire. For a service monitoring app, you'll likely get an "Everyone" rating.

### Step 4: Set Up Pricing and Distribution

- Select countries where the app will be available
- Confirm compliance declarations

### Step 5: Upload the AAB

1. Go to **Production** → **Create new release**
2. Upload your `app-release-bundle.aab` file
3. Add release notes (e.g., "Initial release of CowboyMedia ServiceHub")
4. Click "Review release" → "Start rollout to production"

### Step 6: Wait for Review

Google typically reviews new apps within 1-7 days. You'll receive an email when the app is approved and live on the Play Store.

---

## Updating the App

When you update your PWA (new features, bug fixes), the TWA automatically picks up the changes since it loads your live website. You do NOT need to rebuild the APK or push an update to Google Play for content changes.

You only need to rebuild and upload a new AAB to Google Play if you change:
- The Android app version
- The signing key
- TWA configuration (splash screen, theme colors, etc.)
- Google Play Store listing details

---

## Adding Google Play Upload Signing (Optional but Recommended)

Google Play App Signing allows Google to manage your upload key, adding extra security. When you create your first release, Google Play Console will guide you through this. If you opt in:

1. Google will provide its own SHA-256 fingerprint
2. You'll need to add that fingerprint to your `assetlinks.json` as a second entry:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "app.cowboyhub.servicehub",
      "sha256_cert_fingerprints": [
        "YOUR_UPLOAD_KEY_SHA256",
        "GOOGLE_PLAY_SIGNING_KEY_SHA256"
      ]
    }
  }
]
```

You can find Google's signing key fingerprint in:
Google Play Console → Your App → Setup → App signing → App signing key certificate → SHA-256 fingerprint

---

## Troubleshooting

### Browser bar shows at the top of the app
- Your `assetlinks.json` is not set up correctly
- Verify it's accessible at `https://cowboyhub.app/.well-known/assetlinks.json`
- Verify the SHA-256 fingerprint matches (check both your upload key AND Google Play's signing key)
- Clear Chrome's cache on your Android device, or uninstall and reinstall the app

### Push notifications don't work
- TWA uses Chrome under the hood, so Web Push should work exactly as it does in the browser
- Make sure the user has granted notification permission
- Check that Chrome is up to date on the device

### App crashes on launch
- Ensure Chrome is installed and up to date on the device (TWA requires Chrome 72+)
- Check that your website is accessible and loads correctly in Chrome

### "App not installed" error
- The device may have the same app from a different signing key installed
- Uninstall any existing version and try again

---

## Quick Reference

| Item | Value |
|------|-------|
| **Production URL** | `https://cowboyhub.app` |
| **Package name** | `app.cowboyhub.servicehub` |
| **Manifest URL** | `https://cowboyhub.app/manifest.json` |
| **Asset Links URL** | `https://cowboyhub.app/.well-known/assetlinks.json` |
| **Theme color** | `#1a56db` |
| **Background color** | `#ffffff` |
| **Icon (512px)** | `https://cowboyhub.app/icons/icon-512.png` |
| **Icon (1024px)** | `https://cowboyhub.app/icons/icon-1024.png` |
