# Products in this repo

This monorepo builds **two products over one shared engine**.

| | Desktop App | Coastal.AI OS |
|---|---|---|
| Path | `apps/desktop/` | `os/` (`kiosk/` ISO, `node/` BC-250 image) |
| Engine | embedded as a local sidecar | installed via the apt lane |
| Shared UI | `packages/web` | `packages/web` (labwc kiosk) |
| Release | tag `desktop-v*` → `release-desktop-app.yml` | tag `os-v*` → `release-os.yml` |
| Version | `apps/desktop/src-tauri/tauri.conf.json` | `os/base/VERSION` |

**Shared engine** — the `packages/` pnpm/turbo workspace (`core`, `web`,
`daemon`, `architect`, the A2A multi-agent layer, optional verticals). Both
products are surfaces over this one engine. The `packer/` + `packaging/`
AMI/`.deb` path is a deployment of the engine, not a separate product.

> Migration in progress (see `docs/superpowers/plans/2026-06-18-two-product-split.md`).
> Until each phase lands, some paths above (`apps/desktop`, `os/…`) may still be at
> their pre-split locations (`packages/desktop`, `coastalos/`, `coastal-os/…`).
