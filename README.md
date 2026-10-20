# Zimbra Classic manual SSO login link

An optional manual link below the Sign In button of the Zimbra Classic login
page, pointing to a custom SSO login URL (for example Authentik or Keycloak).
Local username/password login remains the main path. There is no automatic
redirect, no SSO protocol implementation, and no change to Zimbra's login or
logout URL attributes. One LDAP configuration applies globally to all domains.

Tested on Zimbra **10.1.21 FOSS**. The admin zimlet
`com_excellent_login_url_custom` adds **Configure → Login via SSO** in the Admin
Console; the same settings can be changed from the CLI with `sso-config.py`.
The default is disabled, with label `Login via SSO` and an empty URL. The shared
Admin SOAP and CLI contract is in [CONTRACT.md](CONTRACT.md).

## Source layout

```text
zimlet/
  com_excellent_login_url_custom.xml   Admin-extension manifest
  com_excellent_login_url_custom.js    Admin Console form
  config_template.xml                  Default global settings
patch/
  link.jsp.fragment                    Server-side lookup and escaped manual link
  baseline.sha256                      SHA-256 of the unmodified vendor login.jsp
patch-login.py                         Guarded atomic apply / re-apply / rollback
sso-config.py                          Live LDAP configuration read/write helper
CONTRACT.md                            Fields, validation and Admin SOAP requests
README.md                              This file
```

Vendor JSPs, runtime `backups/`, test evidence, credentials, and generated ZIPs
are not stored in this repository. `patch-login.py` writes the original JSP to
`backups/` inside the server source directory before patching. Keep that
directory root-only and back it up independently; a repo checkout cannot
recreate the vendor backup.

## Build the zimlet ZIP

Run from a reviewed checkout of this repository (Python 3, no pip packages):

```sh
mkdir -p dist
(cd zimlet && python3 -m zipfile -c ../dist/com_excellent_login_url_custom.zip com_excellent_login_url_custom.xml com_excellent_login_url_custom.js config_template.xml)
python3 -m zipfile -l dist/com_excellent_login_url_custom.zip
```

The listing should show exactly three entries: the manifest XML, the JS, and
`config_template.xml`.

## Copy source to a server

Replace `YOUR-ZIMBRA-HOST` with the target host. Do not put SSH credentials in
the repository:

```sh
ssh root@YOUR-ZIMBRA-HOST 'install -d -m 0755 /usr/local/share/zimbra-login-sso'
scp -r zimlet patch patch-login.py sso-config.py CONTRACT.md README.md dist/com_excellent_login_url_custom.zip root@YOUR-ZIMBRA-HOST:/usr/local/share/zimbra-login-sso/
```

This only refreshes the source directory. It does not deploy the zimlet and does
not modify the active JSP. The copy leaves `backups/` alone. The `zimbra` user
must be able to read the ZIP and `sso-config.py`.

## Check the vendor baseline

Run as root on each server before the first apply, and again after any Zimbra
upgrade. The default target of `patch-login.py` is
`/opt/zimbra/jetty_base/webapps/zimbra/public/login.jsp`:

```sh
sha256sum /opt/zimbra/jetty_base/webapps/zimbra/public/login.jsp | awk '{print $1}'
awk '{print $1}' /usr/local/share/zimbra-login-sso/patch/baseline.sha256
```

The two values must match. If they do not, stop. The vendor JSP is not the
reviewed baseline; see [Re-apply after a Zimbra upgrade](#re-apply-after-a-zimbra-upgrade).

On a server that is already patched, the first hash is the patched file, so the
check does not match. Skip it and go straight to `patch-login.py apply`, which
verifies the vendor content itself.

## Single server

### Fresh install

1. Build the ZIP and copy the source to the server (sections above).
2. Check the vendor baseline (above).
3. Deploy the zimlet as `zimbra`. A first install has no existing config to
   export, so keep the disabled defaults:

   ```sh
   zmzimletctl deploy /usr/local/share/zimbra-login-sso/com_excellent_login_url_custom.zip
   zmprov fc -a zimlet com_excellent_login_url_custom
   ```

4. Apply the JSP patch as root:

   ```sh
   python3 /usr/local/share/zimbra-login-sso/patch-login.py apply
   ```

   The script checks the vendor checksum and a single insertion anchor, saves
   the original as `backups/login.jsp.<baseline-sha>`, preserves owner and
   permissions, then atomically replaces the JSP. A second run prints
   `Already applied; unchanged`. Unknown contents, a changed patch, or a damaged
   backup stop the operation without overwriting anything. The script does not
   restart services or change LDAP.

5. Restart `mailboxd` once, as `zimbra`. The JSP is compiled on the target, so
   a restart is required to load it. Record the start and end times and the
   login downtime:

   ```sh
   zmmailboxdctl restart
   ```

   On the demo server, the three restarts during testing took about 23 to 37
   seconds of login unavailability.

6. Verify (see [Verify a single server](#verify-a-single-server)). The link
   stays hidden until you enable it in step 7.
7. Enable the link, as `zimbra`. Use your real HTTPS login URL. Do not include
   credentials or tokens, because the enabled link is public:

   ```sh
   python3 /usr/local/share/zimbra-login-sso/sso-config.py set --enabled true --label 'Login via SSO' --url 'https://YOUR-SSO-HOST/login'
   ```

   You can also set the same values under **Configure → Login via SSO** in the
   Admin Console. Configuration changes take effect without a restart.

### Update the zimlet or the fragment

Use this when `zimlet/`, `patch/link.jsp.fragment`, or `patch-login.py` changes.
The patch can only be re-applied on top of itself, so roll back the installed
version before copying the new one.

1. Export the current config as `zimbra`. Stop if the export fails:

   ```sh
   umask 077
   python3 /usr/local/share/zimbra-login-sso/sso-config.py get > "$HOME/login-sso-before-deploy.xml"
   ```

   Do not commit this file. Remove it when you no longer need it.
2. If `patch/link.jsp.fragment` or `patch-login.py` changed, roll back the
   **installed** patch as root, before copying anything new:

   ```sh
   python3 /usr/local/share/zimbra-login-sso/patch-login.py rollback
   ```

3. Copy the new source (see [Copy source to a server](#copy-source-to-a-server)).
   `backups/` is not overwritten.
4. Deploy the new ZIP as `zimbra`, then restore the exported config and flush
   the cache. `deploy` can reset the config to ZIP defaults:

   ```sh
   zmzimletctl deploy /usr/local/share/zimbra-login-sso/com_excellent_login_url_custom.zip
   zmzimletctl configure "$HOME/login-sso-before-deploy.xml"
   zmprov fc -a zimlet com_excellent_login_url_custom
   ```

5. Apply the new patch as root:

   ```sh
   python3 /usr/local/share/zimbra-login-sso/patch-login.py apply
   ```

6. Restart `mailboxd` once, as `zimbra`: `zmmailboxdctl restart`. Record the
   times and downtime.
7. Verify (see [Verify a single server](#verify-a-single-server)).

If the Admin Console form changed but the patch did not, steps 2 and 5 can be
skipped, and no restart is needed after the deploy and cache flush. Verify the
Admin Console form and `sso-config.py get`.

### Change the configuration

No redeploy and no restart. Use the Admin Console (**Configure → Login via SSO**)
or the CLI, as `zimbra`:

```sh
python3 /usr/local/share/zimbra-login-sso/sso-config.py get
python3 /usr/local/share/zimbra-login-sso/sso-config.py set --enabled true --label 'Login via SSO' --url 'https://YOUR-SSO-HOST/login'
python3 /usr/local/share/zimbra-login-sso/sso-config.py set --enabled false --url ''
```

The helper reads live LDAP through admin SOAP and writes with
`zmzimletctl configure`, then flushes the zimlet cache. The URL must be an
absolute HTTPS URL with no credentials, whitespace, or control characters.
`enabled=true` requires a URL. Invalid input is rejected before anything is
written. The label is at most 128 characters.

For a raw CLI workflow, `zmzimletctl getConfigTemplate` reads the ZIP defaults,
not the live settings. Use it only for a new config, then run
`zmzimletctl configure <config.xml>` and
`zmprov fc -a zimlet com_excellent_login_url_custom`.

### Re-apply after a Zimbra upgrade

A Zimbra upgrade can overwrite the patched `login.jsp`. The LDAP config is kept,
but the link is only rendered again after a re-apply.

1. Before the upgrade, back up LDAP, `/usr/local/share/zimbra-login-sso`
   (including `backups/`), and the exported config.
2. After the upgrade, check that the zimlet is still listed:
   `zmzimletctl listZimlets | grep com_excellent_login_url_custom`. If it is
   missing, use [Update the zimlet or the fragment](#update-the-zimlet-or-the-fragment).
3. Check the vendor baseline (see [Check the vendor baseline](#check-the-vendor-baseline)).
   - **Unchanged:** run `patch-login.py apply` as root.
   - **Changed:** review the new vendor JSP, including the insertion anchor and
     any API changes, before doing anything else. Never overwrite a new vendor
     JSP with an old complete copy. After review, run
     `patch-login.py apply --expected-sha <new-vendor-sha>`. The script creates
     a separate backup. Update `patch/baseline.sha256` and the `BASELINE`
     constant in `patch-login.py` together in the repo, then copy the source to
     the server.
   If an old patch marker remains but its contents differ, the script stops for
   manual review.
4. Restart `mailboxd` once, as `zimbra`: `zmmailboxdctl restart`.
5. Verify (see [Verify a single server](#verify-a-single-server)).

### Rollback

1. Hide the link immediately, as `zimbra`:

   ```sh
   python3 /usr/local/share/zimbra-login-sso/sso-config.py set --enabled false --url ''
   ```

2. Restore the vendor JSP as root, using the same script and fragment version
   that is installed:

   ```sh
   python3 /usr/local/share/zimbra-login-sso/patch-login.py rollback
   ```

   Add `--expected-sha` only if the server was patched against a different
   reviewed baseline. `rollback` checks the backup and the current patched
   content before it overwrites anything.
3. Restart `mailboxd` once, as `zimbra`: `zmmailboxdctl restart`.
4. Verify that the login page has no SSO link and local login still works.

Keep the source directory, `backups/`, and the LDAP config for recovery. The
admin zimlet does not need to be removed for a rollback.

### Verify a single server

As `zimbra`, check the zimlet, the patch, and the config:

```sh
zmzimletctl listZimlets | grep com_excellent_login_url_custom
ls /opt/zimbra/zimlets-deployed/com_excellent_login_url_custom/
grep -n EXCELLENT_LOGIN_SSO /opt/zimbra/jetty_base/webapps/zimbra/public/login.jsp
python3 /usr/local/share/zimbra-login-sso/sso-config.py get
```

Then check the login page. `-k` is only for this smoke test, not for TLS
trust validation:

```sh
curl -sk https://YOUR-MAIL-HOST/ | grep -c excellentSsoButton
```

- **Disabled** (or empty URL): the local username/password form renders and the
  count is `0`.
- **Enabled** with an HTTPS URL: the local form still renders, there is one
  manual link below Sign In, and there is no automatic redirect.

## Multi server

Only the servers that run the `zimbra-store` mailbox service serve the login
page and the Admin Console, so only they need the patch. LDAP, MTA, and
proxy-only servers are not patched. The archive server runs `zimbra-store`, so
it is included.

The steps below are all manual. The scripts do not detect other servers and do
not install anything on them. Run each step on each node by hand, in order.

### Once vs per node

| Step | Scope | How often |
|---|---|---|
| Set `enabled` / `label` / `url` (CLI or Admin Console) | Global LDAP entry | **Once** |
| `zmzimletctl deploy <zip>` without `-l` | Starts on the node you run it on. By source inspection it also pushes to other eligible mailbox-class servers, asynchronously | **Once**, then check every mailbox node |
| Copy source to `/usr/local/share/zimbra-login-sso` | Each mailbox node | **Per node** (not distributed) |
| Check vendor baseline and run `patch-login.py apply` | Each mailbox node that renders login | **Per node** |
| `zmmailboxdctl restart` | Each mailbox node | **Per node**, one at a time |
| Export and restore config around `deploy` and `-l deploy` | Node where the deploy runs | Only when deploying |
| `zmprov fc -a zimlet com_excellent_login_url_custom` | Every server | After any config or deploy change |

Config changes need no restart. A restart is only needed after a JSP change
(apply, re-apply, rollback).

### Determine the login nodes

Check the proxy upstream settings, globally and on each proxy:

```sh
zmprov gcf zimbraReverseProxyUpstreamLoginServers
zmprov gs PROXY_HOST zimbraReverseProxyUpstreamLoginServers
zmprov gas mailbox
```

- For each proxy, use the effective value: the server's own value, or the
  global value if it is inherited. Combine the targets of all proxies. Every
  listed mailbox server must be patched.
- If the attribute is empty, the source disables the dedicated login upstream
  block, so general web routing applies. Patching every mailbox server is an
  operational policy chosen to be conservative. It is not the source's behavior.
  Routing also depends on the webclient/mailbox role,
  `zimbraReverseProxyLookupTarget`, the mail mode, and the ports. Cross-check
  against the upstream list in the nginx configuration generated on each proxy.
- Patch the archive server too when it runs `zimbra-store`, even if it is not
  in the upstream list. This keeps the login page the same on every mailbox node.
- Do not patch LDAP, MTA, or proxy-only servers.

Get the mailbox ports for each node before verifying it:

```sh
zmprov gs MAILBOX_HOST zimbraMailMode zimbraMailPort zimbraMailSSLPort
```

### Update, re-apply, and rollback across nodes

Use the same steps as single server, but run them per node:

- **Update:** the config export and restore, and the single `zmzimletctl deploy`,
  happen once from the node you chose. That node also runs the per-node steps
  below, in the same order as every other node. For each node, one at a time:
  1. If `patch/link.jsp.fragment` or `patch-login.py` changed, roll back the
     **installed** patch as root, using the script and fragment still on that
     node. Do this before copying anything new.
  2. Copy the new source to `/usr/local/share/zimbra-login-sso`.
  3. Run `patch-login.py apply` as root.
  4. Restart `mailboxd` as `zimbra`.
  5. Verify the node (see [Verify each node](#verify-each-node)). Finish and
     verify one node before starting the next.
- **Re-apply after a Zimbra upgrade:** check the vendor baseline per node. Each
  node can run a different Zimbra patch level.
- **Rollback:** set the config to disabled once. Then roll back and restart
  per node.

### Fix a node that is missing the zimlet files

Use this only when `ls /opt/zimbra/zimlets-deployed/com_excellent_login_url_custom/`
is empty on a node after the single deploy. Export the config first, then copy
the ZIP to that node and deploy locally, then restore the config and flush:

```sh
umask 077
python3 /usr/local/share/zimbra-login-sso/sso-config.py get > "$HOME/login-sso-before-deploy.xml"
zmzimletctl -l deploy /usr/local/share/zimbra-login-sso/com_excellent_login_url_custom.zip
zmzimletctl configure "$HOME/login-sso-before-deploy.xml"
zmprov fc -a zimlet com_excellent_login_url_custom
```

Local deploy with `-l` skips remote distribution, but it still writes local
deploy metadata and configuration to LDAP. Keep the export and the restore.

### Verify each node

Run these on every mailbox node. Tick each item before moving to the next node:

- [ ] `zmzimletctl listZimlets` includes `com_excellent_login_url_custom`.
- [ ] `ls /opt/zimbra/zimlets-deployed/com_excellent_login_url_custom/` lists the deployed files.
- [ ] `grep -n EXCELLENT_LOGIN_SSO` on this node's `login.jsp` finds the patch.
- [ ] `backups/` on this node holds the vendor copy, and the baseline check passed before apply.
- [ ] `mailboxd` is healthy after the restart, and the logs show no new errors.
- [ ] Direct request to this node's mailbox port returns the login page with the local username/password form:

  ```sh
  curl -k --resolve LOGIN_HOST:8443:127.0.0.1 https://LOGIN_HOST:8443/
  ```

  Replace `LOGIN_HOST` and `8443` with this node's host and `zimbraMailSSLPort`.
  `-k` is for this functional check only.
- [ ] Disabled: no SSO link. Enabled with HTTPS URL: one link, no redirect.
- [ ] `sso-config.py get` returns the expected global config on this node (the value is shared through LDAP).

## Not yet tested on a multi-server lab

The multi-server behavior above comes from the source code and from single-server
tests. It has not been run on a multi-server lab. Verify these before relying on
it in a client environment:

- **File fan-out:** whether `zmzimletctl deploy` without `-l` copies the zimlet to
  every eligible mailbox server.
- **Admin Console cache on other nodes:** whether another node's Admin Console
  shows old values until the cache flush takes effect.
- **Replication lag:** how long an LDAP config change takes to appear on each node.
- **Remote deploy failure:** what happens when a remote deploy fails or only
  partly completes.
- **Continuity during rolling restart:** whether login stays available while one
  node restarts. Proxy failover and draining are not configured by this package.
