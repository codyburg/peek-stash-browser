# Plex sign-in (custom build)

Plex sign-in is optional and disabled by default. It verifies a full Plex account through Plex's [documented PIN flow](https://forums.plex.tv/t/authenticating-with-plex/609370/). Plex Home managed profiles are not independent Plex accounts. A Plex account, Plex Pass, or access to your Plex Media Server does not itself grant Peek access.

## Configuration

Keep an existing local administrator and its password available. Finish Peek's initial setup with that administrator before enabling Plex. Configure these container environment variables:

```dotenv
PLEX_AUTH_ENABLED=true
PLEX_CLIENT_IDENTIFIER=YOUR-GENERATED-STABLE-UUID
PLEX_PUBLIC_URL=https://peek.example.com
PLEX_PRODUCT=Peek Stash Browser
SECURE_COOKIES=true
TRUST_PROXY=1
```

Generate the client identifier once with `[guid]::NewGuid().ToString()` in PowerShell or `node -e "console.log(require('crypto').randomUUID())"`. Reuse it on upgrades; it identifies this installation in Plex Authorized Devices and is public. There is no Plex client secret to obtain. Never put a Plex token in the configuration.

`PLEX_PUBLIC_URL` is the exact origin users visit, without a path, query, or credentials. HTTPS is required except for HTTP localhost development. HTTPS requires `SECURE_COOKIES=true`; Peek validates this on startup. The feature uses a new tab and polls from the original Peek tab, so the normal `SameSite=Strict` session cookie remains intact. The user clicks **Sign in with Plex**, follows **Open Plex to authorize**, authorizes, and returns to the original tab.

Configure `TRUST_PROXY` for the actual proxy chain as described in [Configuration](configuration.md). The example assumes one reverse proxy in front of the production container's nginx. Preserve the public Host and Origin headers, serve Peek and its API on the same origin, and restrict direct backend access. Plex return URLs are not derived from forwarded headers. `PROXY_AUTH_HEADER` is a separate authentication method; leave it unset unless deliberately configured with trusted proxy addresses.

## Approve and link users

1. As a local administrator, open Settings → User Management → Plex approvals and account access.
2. Enter the full Plex account's numeric ID and approve it. A user who has verified with Plex but is unapproved receives their own account ID in Peek's denial message; they can give you that ID. Peek does not automatically create pending users.
3. An approved user's first Plex login creates a standard `USER` profile, with the normal first-login wizard. It never grants administrator privileges. The generated Peek username includes the Plex ID and a random suffix. Rename/display-name customization is outside this change.
4. To preserve an existing local profile, sign into that profile first, open Settings → Account, enter its current local password, and choose **Link Plex account**. Authorize the approved Plex account in the new tab. Do this before creating a separate Plex profile: identities already linked to another profile are refused. There is no automatic email or username matching, account merge, unlink, or admin reassignment.

Approval and identity linkage are stored in SQLite; no persistent Plex token is retained. Each Plex identity can link to only one Peek user. Revoking approval preserves the profile and its history and playlists. Reapproval returns the user to that same profile. Deleting a Peek user deliberately deletes its normal user data; a later approved login can create a new profile.

**Access scope:** a new user receives Peek's standard access. Under the existing model, a user without instance selections sees all enabled Stash instances, subject to content restrictions. Instance selection is a viewing preference, not a security boundary. Configure content restrictions explicitly where needed.

## Revocation and recovery

Revoke an ID in User Management to refuse new Plex sessions and reject existing Plex JWTs at their next authenticated request. Signed media requests for Plex-linked profiles also require current approval. A response or stream already in progress is not forcibly terminated. A linked local account can still sign in with its local password. This preserves administrator recovery; disabling a Peek account blocks all its authentication methods and signed links. The UI prevents self-disabling and disabling the last enabled local administrator.

Plex-only profiles cannot sign in with a local password or use recovery keys to create one, including through an admin password reset. To deny a linked person's access through every method, disable their Peek account as well as revoking the Plex ID.

Set `PLEX_AUTH_ENABLED=false` and restart to remove Plex login and deny Plex sessions; local accounts remain usable. Plex-only accounts have no local recovery route. Peek does not periodically contact Plex during a session: revoking a device at Plex affects future Plex verification, while Peek approval/deactivation controls existing Peek access.

PIN flows last at most ten minutes, are bound to an HTTP-only browser cookie, are single-use, and live only in the server process. A restart requires starting again. Deploy one Peek backend process; pending flows are not shared between replicas. Starting another flow in the same browser replaces the cookie, so complete one flow at a time. Start attempts and polling have separate rate limits; polling Plex is throttled per flow. The app retains no access token after account verification. Plex's short-lived PIN code and public client identifier appear in its required authorization URL fragment; persistent credentials do not.

## Build and deploy on Unraid

This feature requires your custom image; pulling the upstream image removes it. From the repository root, build a local image with a tag you control. The following tag is an example for your local build, not a published upstream image:

```sh
docker build -f Dockerfile.production -t peek-plex:local .
```

Build on Unraid or another machine with Docker. If built elsewhere, transfer it with `docker save -o peek-plex.tar peek-plex:local`, then `docker load -i peek-plex.tar` on Unraid. In the existing Unraid template, change Repository to `peek-plex:local`. Keep the current appdata host directory mapped to `/app/data`, keep the existing port mapping (the production image listens on container port **80**, with template host port **6969**), and preserve JWT secret, PUID/PGID, Stash settings, and other configuration. Add the Plex variables above. Do not use the root `docker-compose.yml` as a production deployment: it builds the development stack.

Before replacing the container, stop Peek and back up the entire existing appdata directory. Do not run two containers against the same live database. Test on a copy first, especially if your installed Peek release predates this checkout. This branch is based on `3.5.0-beta.2`; normal upstream upgrade requirements still apply.

The database is `/app/data/peek-stash-browser.db`. The server applies Prisma migrations before listening, using the existing pre-migration backup mechanism. This change adds default-false flags to User and a separate PlexIdentity table; it does not replace user IDs or delete user data. Preserve the whole `/app/data` volume, including database WAL files and persisted `.jwt-secret` if used.

For rollback, stop the custom container and restore the full pre-upgrade appdata backup, then restore the exact image version and configuration that used it. Switching images alone is not a database rollback. Settings/history written since the backup will be lost on restoration. For upgrades, update this feature branch against your chosen upstream release, rerun checks, rebuild and retag the custom image, back up, then replace the container. Avoid Unraid Force Update against an upstream tag for this custom feature.

## Developer checks

Use Node **22**, as specified by `.nvmrc` and the production Dockerfile. On Windows use `npm.cmd` where execution policy blocks `npm.ps1`. From the repository root:

```powershell
npm.cmd --prefix shared ci
npm.cmd --prefix server ci
npm.cmd --prefix client ci
npm.cmd --prefix shared run build
Push-Location server
npm.cmd exec -- prisma generate
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test:run -- tests/prisma/migrationFiles.test.ts tests/initializers/migrations.test.ts tests/services/PlexAuthService.test.ts tests/routes/auth.test.ts tests/middleware/authMiddleware.test.ts tests/middleware/auth.test.ts tests/middleware/streamAuth.test.ts tests/controllers/user.test.ts tests/controllers/userFeatures.test.ts
npm.cmd run build
Pop-Location
npm.cmd --prefix client run lint
npm.cmd --prefix client run typecheck
npm.cmd --prefix client run test:run -- tests/components/auth/PlexSignIn.test.tsx tests/components/settings/PlexAdminSection.test.tsx tests/components/pages/Login.test.tsx tests/components/settings/UserManagementSection.test.tsx tests/contexts/AuthContext.test.tsx
npm.cmd --prefix client run build
```

The Plex server tests create a temporary SQLite database, deploy real migrations, mock Plex HTTP responses, and exercise account creation, linkage, concurrent requests, denial, expiration, replay, token validation, cookies, session revocation and local login. No live Plex credentials or live Stash instance are required for these tests. Container smoke testing and a real HTTPS proxy/Plex authorization check remain required before deploying to the live instance.
