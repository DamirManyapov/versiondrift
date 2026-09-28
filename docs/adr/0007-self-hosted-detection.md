# ADR-0007: Self-hosted version detection: hosts, access profiles, agentless polling

Status: accepted · 2026-09-28

## Context
A self-hosted instance runs inside the customer's network (`docker compose up`). Typing versions by hand stops
working at the scale it is meant for: one company with 10 Debian servers, 7 Windows Servers, 10 MikroTik routers and
a Proxmox cluster. The instance should read the versions itself, with the least privileges each system allows, and
the admin should see the fleet by product ("Debian: 10 hosts, 3 behind"), by host and by site.

Options considered:
- **Agents on every host**: an install and an upgrade per machine, a new binary to trust. Rejected for v1.
- **Integrations first (Zabbix, vCenter, Ansible)**: one token for many hosts, but stock Zabbix templates report the
  OS family ("Debian GNU/Linux 12"), not the point release or Windows' update revision, which are the versions that
  matter, and every customer's templates differ. Kept for later as a *host list* import.
- **Agentless polling from the instance** (SSH, vendor APIs, SNMP) with shared read-only credentials: nothing to
  install on targets, works with the customer's existing access rules. Chosen.

## Decision
1. **Everything stays inside the customer's network.** The instance polls hosts from where it runs; hosts,
   addresses, credentials and results live only in its SQLite (ADR-0004). The only external traffic is the
   inbound download of the public feed, or none in offline mode.
2. **Hosts are an entity**: name, address, site (a free grouping such as "Moscow DC" or "Branch 2"), kind, access
   profile, detected products, last successful poll, last error. `instances` rows reference a host; manual
   instances without a host keep working.
3. **Access profiles** hold credentials once for many hosts ("SSH Linux read-only" for all Debian servers,
   "MikroTik read-only" for all routers). Secrets are sealed with the instance key already used for notification
   channels, never shown again after saving, never logged.
4. **Detectors v1**, each reading exact versions:
   - `ssh-linux`: `/etc/os-release`, `/etc/debian_version`, `dpkg-query -W` / `rpm -qa` (OS point release plus
     packages that map to products, e.g. `postgresql-16`, `nginx`, `docker-ce`);
   - `routeros`: API-SSL or SSH, `/system resource` and `/system routerboard` (RouterOS and firmware);
   - `windows`: OpenSSH (Server 2019+) or WinRM, registry `CurrentBuild` + `UBR` → `20348.5622`;
   - `proxmox`: API token, `/version` and per-node package versions (PVE and PBS).
   Unauthenticated HTTP version endpoints (`http` rules in modules) and the vSphere `about` info come next.
5. **Least privilege, documented next to the detector.** Each module's `detect` rule carries setup instructions
   (dedicated user, the exact read-only role, copy-paste commands). The UI shows them when creating a profile; the
   docs site renders the same text. A detector never needs root, sudo, Administrator or a write role.
6. **Polling**: on a schedule (default every 6 hours) and on demand; results are compared with the previous poll
   and kept as history ("srv-03: Debian 12.11 → 12.12 on 14 Sep"). A host that stops answering is a separate state,
   not a version change.
7. **One repository, one image.** The detector is a package in this monorepo and runs inside the web container by
   default. The same image can run as a separate `detector` service (`command: detector`) for segmented networks:
   the UI faces users, the poller sits in the server segment with the credentials.

## Consequences
+ The fleet view the product is sold on ("10 Debian, 7 Windows, 10 MikroTik — who is behind") without installing
  anything on the servers.
+ Instructions and detectors come with modules, so contributors extend detection the same way they add products.
− The instance holds read-only credentials to many hosts: sealing, audit of profile use, and clear guidance to
  create read-only accounts are part of the feature, not extras.
− SSH/WinRM/API clients add weight to the image; libraries are chosen for pure JS where possible.
− Zabbix, vCenter inventory and Ansible remain manual imports until the host model has proven itself.
