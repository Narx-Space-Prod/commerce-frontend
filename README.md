# commerce-frontend

Owner: Frontend team.

Customer and admin views; authentication flows; catalogue browsing, cart, checkout and order history. This service calls the catalogue and orders APIs and does not own their databases.

Project guide: [DOC.md](https://github.com/Narx-Space-Prod/platform-infrastructure/blob/main/DOC.md).

## Current state

Application migration: Node.js storefront and backend-for-frontend source is in `src/`,
with browser assets in `public/` and tests in `tests/`. Features include registration,
login, cart, checkout, order history, admin products/orders, refunds and sales views.
AWS deployment and GitOps promotion are separate implementation milestones.
All changes after repository initialization go through feature branches and pull requests.
These private repositories use GitHub Free; review enforcement requires the planned Team upgrade.

## Application delivery contract

- Build and release this service independently; preserve existing commerce features during migration.
- Serve health endpoints at `/health/live` and `/health/ready` on an unprivileged port.
- Run as a non-root user with a read-only root filesystem; use `/tmp` for temporary data.
- Handle SIGTERM gracefully and report logs to stdout/stderr without secrets or payment data.
- Expose metrics; propagate request/event IDs across API and queue boundaries.
- Publish immutable images to ECR and promote the same digest between environments.

## Build and preview

```bash
docker build --target runtime -t narx-local/frontend:dev .
```

The runtime build runs the Node test suite first. The server listens on port 8080 and
requires `SESSION_SECRET` (at least 32 characters), `PUBLIC_ORIGIN`, `CATALOGUE_URL`,
`CART_URL` and `ORDERS_URL`. Set `COOKIE_SECURE=true` behind production HTTPS.
Use the integrated preview in `platform-gitops/local/compose.yaml` for all services.

Imported with its license from [boutique-frontend, revision 574e47b](https://github.com/Local-Narx-Space/boutique-frontend/tree/574e47b788fe94357cb424cc37d5429f581f0680).
