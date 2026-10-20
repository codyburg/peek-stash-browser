# Plex implementation validation

Validated on Windows/PowerShell on 20 October 2026, from upstream `e5bbcecb` (`3.5.0-beta.2`), on branch `feature/plex-login`. Local runtime: Node `v24.16.0`, npm `11.13.0`. The repository and production image target Node **22**; repeat the checks with that runtime before deployment.

## Build, types and lint

Run directory and exact command:

| Directory | Command                                                                     | Result                                                                |
| --------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `shared`  | `npm.cmd ci --no-audit --no-fund`                                           | Passed                                                                |
| `server`  | `npm.cmd ci --no-audit --no-fund`                                           | Passed                                                                |
| `client`  | `npm.cmd ci --no-audit --no-fund`                                           | Passed                                                                |
| `shared`  | `npm.cmd run build`                                                         | Passed                                                                |
| `server`  | `npm.cmd exec -- prisma generate`                                           | Passed                                                                |
| `server`  | `$env:DATABASE_URL='file:./validation.db'; npm.cmd exec -- prisma validate` | Passed; validation does not create this database                      |
| `server`  | `npm.cmd run typecheck`                                                     | Passed, including test types                                          |
| `client`  | `npm.cmd run typecheck`                                                     | Passed                                                                |
| `server`  | `$env:NODE_OPTIONS='--max-old-space-size=8192'; npm.cmd run lint`           | Passed                                                                |
| `client`  | `npm.cmd run lint`                                                          | Passed                                                                |
| `server`  | `npm.cmd run build`                                                         | Passed                                                                |
| `client`  | `npm.cmd run build`                                                         | Passed, with the existing large-chunk warning for the video/VR bundle |

The backend's first full lint run exhausted the default 2 GB JavaScript heap; increasing the heap resolved it. Initial dependency installation was blocked by inherited folder permissions and the sandbox's network/cache access; the locked dependency installs succeeded after scoped access was granted. No dependency manifests or lockfiles were changed. Prisma emits its existing `package.json#prisma` deprecation warning.

## Automated tests

From `server`:

```powershell
npm.cmd run test:run -- tests/prisma/migrationFiles.test.ts tests/initializers/migrations.test.ts tests/services/PlexAuthService.test.ts tests/routes/auth.test.ts tests/middleware/authMiddleware.test.ts tests/middleware/auth.test.ts tests/middleware/streamAuth.test.ts tests/controllers/user.test.ts tests/controllers/userFeatures.test.ts
```

Result: **426 tests passed**, across nine files, including 17 Plex tests.

The selection covers migration wrapping/recovery, local authentication and recovery regressions, Plex approval/linking, real migrated SQLite provisioning, concurrent polls, invalid/replayed state, expiration, cancellation during verification, failed Plex token validation, cookie protections, authorization, disabled users, JWT refresh, media-link revocation, deleted profiles, and preservation of existing users/playlists on migration. Plex HTTP responses are mocked; no live credentials are used. The migration initializer test had two hardcoded Unix path expectations; these now use `path.join` so they also work on Windows.

From `client`:

```powershell
npm.cmd run test:run -- tests/components/auth/PlexSignIn.test.tsx tests/components/settings/PlexAdminSection.test.tsx tests/components/pages/Login.test.tsx tests/components/settings/UserManagementSection.test.tsx tests/contexts/AuthContext.test.tsx
```

Result: **38 tests passed**, across five files. Covers the disabled button, authorization/pending/cancel/expiration/error states, linking, admin approval/revocation, and existing login/auth context behavior.

## Deployment checks still needed

- `docker --version` failed because Docker is not installed/on PATH here. A production image build and container smoke test have not been run.
- No live Plex account, HTTPS reverse proxy, Unraid host, or live Peek database was used or changed. Perform a real authorization round trip against a copy of the existing appdata before deployment.
- The Stash-dependent full integration and browser E2E suites were not run. The existing user-deletion integration fixture was extended for the Plex allowlist; the isolated SQLite test verifies deletion clears its link while preserving approval.
- A user with no selected Stash instances retains Peek's existing default access to all enabled instances, subject to content restrictions. Plex server-sharing checks are deferred.

See [Plex deployment and rollback](../getting-started/plex-authentication.md).
