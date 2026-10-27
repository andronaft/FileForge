# Publishing a release

## Every release

1. Bump `version` in `manifest.json` (each store needs a higher version every time).
2. Add a `## X.Y.Z` section to `CHANGELOG.md`; it becomes the GitHub Release notes.
3. Commit and push, then either click **Actions → release → Run workflow** on GitHub (it creates the
   `vX.Y.Z` tag from the manifest version itself), or tag and push from a terminal:

   ```bash
   git tag v0.2.1
   git push origin v0.2.1
   ```

The [release workflow](../.github/workflows/release.yml) builds the ZIPs, lints the Firefox build, creates a
GitHub Release and submits the new version to every store whose secrets are set:

| Store              | Package                           | Goes live after review, usually |
| ------------------ | --------------------------------- | ------------------------------- |
| Chrome Web Store   | `fileforge-chrome-<version>.zip`  | a few days                      |
| addons.mozilla.org | `fileforge-firefox-<version>.zip` | a day to a few days             |

A store without secrets is skipped with a notice, and one store failing doesn't stop the other.

If a version is still waiting for review, a store refuses a new upload; wait for the review or cancel it in that
store's dashboard, then re-run **Actions → publish → Run workflow** with the tag and the store.

The web version at <https://andronaft.github.io/FileForge/> is deployed by the
[pages workflow](../.github/workflows/pages.yml) on every push to `main`; nothing to do there.

## One-time setup: Chrome Web Store

The first version has to be created in the dashboard by hand; the API only updates an existing item.

1. Register as a developer at [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole)
   (one-time $5 fee).
2. **New item** → upload `dist/fileforge-chrome-<version>.zip` (from `python3 scripts/package.py`).
3. Fill in the listing from [`store-listing.md`](store-listing.md): description, category, screenshots,
   icon, privacy practices (single purpose, permission justifications, "does not collect user data"),
   privacy policy URL `https://andronaft.github.io/FileForge/privacy.html`.
4. Submit for review. The item's 32-letter ID appears in the dashboard URL.
5. In this repository: _Settings → Secrets and variables → Actions → Variables → New repository variable_
   `CWS_EXTENSION_ID` = that ID.

### API access for the workflow (same as Logbeam)

The workflow needs three secrets. The Google OAuth client and refresh token from Logbeam work here too, because
they belong to the Google account, not to one extension: add the same `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET` and
`CWS_REFRESH_TOKEN` as secrets of this repository. If the refresh token is not saved anywhere, make a new one
with the same client:

```bash
CWS_CLIENT_ID=… CWS_CLIENT_SECRET=… node scripts/cws-token.mjs
```

Starting from scratch instead: a Google Cloud project with the **Chrome Web Store API** enabled, an OAuth
consent screen published to _In production_ (in _Testing_ the refresh token expires after 7 days), an OAuth
client of type **Desktop app**, then the command above.

| Name                | Where                              |
| ------------------- | ---------------------------------- |
| `CWS_CLIENT_ID`     | secret: the OAuth client ID        |
| `CWS_CLIENT_SECRET` | secret: the OAuth client secret    |
| `CWS_REFRESH_TOKEN` | secret: the token from the command |
| `CWS_EXTENSION_ID`  | variable: the item ID (not secret) |

## One-time setup: addons.mozilla.org (Firefox)

1. Sign in at [addons.mozilla.org/developers](https://addons.mozilla.org/developers/).
2. The API credentials at [Manage API Keys](https://addons.mozilla.org/developers/addon/api/key/) are per
   account, so the Logbeam ones work: add them as the secrets `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`.

The first release creates the listing from [`amo-metadata.json`](amo-metadata.json) (summary, description,
category, licence, notes for the reviewer); add screenshots on the add-on's page afterwards. The add-on ID is
`fileforge@andronaft.github.io` (set in `scripts/package.py`).

To check that the secrets work without publishing anything, run **Actions → check-stores → Run workflow**.

## Manual upload

`python3 scripts/package.py` creates `dist/fileforge-chrome-<version>.zip` and
`dist/fileforge-firefox-<version>.zip`; upload them in each store's dashboard.
