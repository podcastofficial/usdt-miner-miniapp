# More ad networks (GigaPub + OnClickA)

New networks added next to Adsgram and Monetag, for both Popup Ads and Watch & Earn.

- Admin -> Settings -> Popup Ads: new fields **GigaPub project ID** and **OnClickA ad unit ID**.
- `Popup type` and `Watch & Earn ad network` now accept `gigapub`, `onclicka` and `all`.
  `all` = Adsgram, Monetag, GigaPub, OnClickA (popup: then your own popup). If one network has no ad, the next one is tried.
- Frontend: all networks live in one `AD_NETS` table in `public/app.js`. To add another network later, add one entry there.
- Existing settings keep working (`own / adsgram / monetag / both` behave as before). No DB migration needed.
- CSP unchanged (`script-src https:` already allows the new SDK hosts).

NOTE: GigaPub / OnClickA SDK calls (`window.showGiga()`, `window.initCdTma({id})`) were written from their public docs without live testing here.
Test each network once inside Telegram before going live (admins see a short "Popup ad not shown" reason on screen if one fails).
