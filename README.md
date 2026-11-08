# Trade Journal

Static app, no build step. Supabase provides sign-in, private account data, and media storage. Before connecting a project, the app can no longer access journal data.

## Run / host
ES modules need http(s), not file://.  Locally: `python3 -m http.server 8000` → http://localhost:8000
Host: run `npm run package:site` to create a clean `dist/` folder, then deploy that folder to a static host. For a no-Git first deploy, Netlify Drop accepts a local project folder and publishes a `netlify.app` URL with HTTPS; each later update can be packaged and uploaded again. Configure that production URL in Supabase Auth's site URL / allowed redirect URLs.

## Supabase setup
1. Create a Supabase project and run `supabase/setup.sql` in its SQL Editor.
2. Copy the project URL and **publishable key** into `js/core/supabase.js`. Never use a `service_role` key in this browser app.
3. In Supabase Auth, enable email/password sign-in and set the site's URL / redirect URLs to the deployed site (and your local development URL).
4. Serve this folder over HTTP(S). Existing browser journal data is imported into the first account used on that browser. After sign-in, journal settings and entries sync to that account; media is stored in its private Storage bucket.

Username sign-in uses the Edge Function in `supabase/functions/sign-in-username`. Deploy it to the same Supabase project with `supabase functions deploy sign-in-username --no-verify-jwt`. It uses the project's `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_ANON_KEY` function secrets. Users can sign in with the part of their email before `@`; if more than one account has the same prefix, that username is ambiguous and those users must sign in with their email.

Market Phase Lab uses `supabase/functions/market-data` as a server-side Yahoo Finance proxy because Yahoo chart requests are blocked by browser CORS. Deploy it with `supabase functions deploy market-data` after signing in to Supabase. The offline Demo instrument does not require the function.

## Full Python Market Phase Lab

The exact scikit-learn version of Market Phase Lab is `phase_app.py`. To run it with all of its Streamlit tabs, walk-forward forecasts, time machine, accuracy report, and phase statistics:

1. Push this project to a GitHub repository.
2. In Streamlit Cloud, choose **Create app**, select the repository and branch, and set the main file to `phase_app.py`.
3. Streamlit Cloud installs the packages from `requirements.txt` automatically.
4. Open the generated `streamlit.app` URL to use the full Python model.

Run it locally with:

```sh
pip install -r requirements.txt
streamlit run phase_app.py
```

The native Phase Lab in the journal remains useful for quick browser-side context. The Streamlit app is the full-fidelity model and should be used when you need the same outputs as the Python source.

## Browser push reminders
Push reminders can arrive while the app is closed, after each browser/device has been enabled. The site must use HTTPS. On iPhone/iPad, install the site to the Home Screen before enabling web push; iOS supports web push for Home Screen web apps from iOS 16.4. Each device needs its own permission and subscription. Push subscriptions are tied to the site origin, so localhost subscriptions do not carry over to the deployed HTTPS origin; enable each device on the same public site URL.

1. Run `supabase/notifications.sql` in the Supabase SQL Editor.
2. To receive alerts through ntfy, also run `supabase/ntfy-settings.sql` there. In **Settings → Alerts**, enter the topic name you subscribed to in ntfy (leave it blank to disable ntfy), then save alert settings. The topic is not prefilled; choose a hard-to-guess name because anyone who knows it can publish to it.
3. Generate a VAPID key pair with `npx web-push generate-vapid-keys`. Put its **public** key in `SUPABASE_VAPID_PUBLIC_KEY` in `js/core/supabase.js`. Keep the private key out of browser code.
4. Generate a separate random scheduler secret (for example, `openssl rand -hex 32`) and set the Edge Function secrets:

   ```sh
   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com NOTIFICATION_SCHEDULER_SECRET=...
   supabase functions deploy scheduled-notifications --no-verify-jwt
   supabase functions deploy test-notification
   ```

5. In Supabase, enable `pg_cron`, `pg_net`, and Vault. Replace the project URL and scheduler secret placeholders in `supabase/notifications-cron.sql`, then run it in the SQL Editor. It calls the scheduler once per minute; the secret is stored in Vault so the scheduled request can authenticate.
6. Deploy both notification functions after changes: `supabase functions deploy scheduled-notifications --no-verify-jwt` and `supabase functions deploy test-notification`. Sign in on each device, open **Settings → Alerts**, enable browser notifications where supported, and save the schedule. Each device creates its own browser subscription; the saved ntfy topic and reminder schedule apply to the account. Save the ntfy topic with **Save ntfy topic**. **Send test notification** posts directly from the browser to ntfy and sends browser tests through Supabase. Scheduled ntfy alerts are sent by the scheduler. Alert settings include selectable weekdays for a weekly focus reminder and Sydney, Tokyo, London, and New York session alerts. Each session has a configurable alert time and lead time, using local time where that reminder is registered.

The browser must grant notification permission. Device/browser support varies; for example, Apple requires iOS/iPadOS web push to be enabled from a Home Screen web app. See [Apple's Web Push guide](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers) and [Supabase's scheduled Edge Function guide](https://supabase.com/docs/guides/functions/schedule-functions).

## Structure (data → behavior → presentation)
- `js/core/`     schema.js (every field), layout.js (sections/order), storage.js (only file that saves), entries.js, events.js
- `js/types/`    one file per field type + index.js registry
- `js/features/` conditions · annotations (🏷💬) · reorder (drag) · customFields — enabled in index.js
- `js/ui/`       form.js, entryCard.js (generic), dialog.js, themePicker.js
- `css/`         tokens.css (colors/spacing/motion/themes), components.css, animations.css

## Common changes
| Want to…                     | Edit                                        |
|------------------------------|---------------------------------------------|
| add/change a checklist item  | 1 object in core/schema.js                  |
| make an item conditional     | `showIf` on that object                     |
| move fields/sections         | drag in the UI, or core/layout.js defaults  |
| new field type               | new file in types/ + 1 line in types/index  |
| new feature                  | new file in features/ + 1 line in index     |
| new theme                    | block in css/tokens.css + swatch in themePicker.js |
| backend / sync               | core/storage.js only                        |
