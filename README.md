# Zimbra Classic manual SSO login link

An optional manual link below Sign In for a custom Authentik/Keycloak login URL.
Local username/password login remains the main path. There is no automatic
redirect, SSO protocol implementation, or change to Zimbra login/logout URL
attributes. One LDAP zimlet configuration applies globally to all domains.

The backend targets Zimbra **10.1.21 FOSS**. The admin zimlet currently has a
manifest and reserved JS include; its **Admin Console form is pending**. See
[CONTRACT.md](CONTRACT.md) for the shared Admin SOAP/CLI read/write contract.
Default configuration is disabled, with label `Login via SSO` and an empty URL.

## Source layout

```text
zimlet/
  com_excellent_login_url_custom.xml       Admin-extension manifest
  com_excellent_login_url_custom.js        Reserved for the Admin Console form
  config_template.xml          Default global settings
patch/
  link.jsp.fragment            Server-side lookup and escaped manual link
  baseline.sha256              SHA-256 of the unmodified vendor login.jsp
patch-login.py                 Guarded atomic apply/re-apply/rollback
sso-config.py                  Live LDAP configuration read/write helper
CONTRACT.md                    Fields, validation and Admin SOAP requests
README.md                      Build, deploy, upgrade and rollback
```

Vendor JSPs, runtime backups, test evidence, credentials and generated ZIPs are
not stored in this repository. The original JSP backup is created on the server
before patching; keep it outside `/opt/zimbra` and back it up independently.

## Build and copy to the server

Requirements: Python 3 on the build host and server; SSH administration access;
Zimbra's existing `zmzimletctl`, `zmsoap`, and `zmprov`. No pip packages needed.

From a reviewed checkout of this repository, build the zimlet ZIP:

```sh
mkdir -p dist
(cd zimlet && python3 -m zipfile -c ../dist/com_excellent_login_url_custom.zip com_excellent_login_url_custom.xml com_excellent_login_url_custom.js config_template.xml)
```

Copy only the selected source files and the generated ZIP. Replace
`YOUR-ZIMBRA-HOST` with the target host (do not put SSH credentials in the repo):

```sh
ssh root@YOUR-ZIMBRA-HOST 'install -d -m 0755 /usr/local/share/zimbra-login-sso'
scp -r zimlet patch patch-login.py sso-config.py CONTRACT.md README.md dist/com_excellent_login_url_custom.zip root@YOUR-ZIMBRA-HOST:/usr/local/share/zimbra-login-sso/
```

These commands repopulate `/usr/local/share/zimbra-login-sso` from repo source;
they do not deploy the zimlet or modify the active JSP. They preserve existing
`backups/`. Retain the installed fragment/script version until rollback is no
longer needed: rollback verifies against that exact fragment. On an already
patched host, restore the original `backups/` from your protected backup if the
source directory was lost. A repo checkout cannot recreate the vendor backup.

## Deploy

For an existing installation, export the current config **before** redeploying
the zimlet; `deploy` can reset it to ZIP defaults. As user `zimbra`:

```sh
umask 077
python3 /usr/local/share/zimbra-login-sso/sso-config.py get > "$HOME/login-sso-before-deploy.xml"
```

Skip that export on the first installation, when the LDAP entry does not exist.
Never commit this runtime export. Then, as `zimbra`:

```sh
zmzimletctl deploy /usr/local/share/zimbra-login-sso/com_excellent_login_url_custom.zip
# Existing installations only: restore the exported settings.
zmzimletctl configure "$HOME/login-sso-before-deploy.xml"
zmprov fc zimlet com_excellent_login_url_custom
```

On first installation, omit `configure` and retain the disabled defaults. Source
files must be readable by `zimbra`; keep backup files root-only. As root, apply:

```sh
python3 /usr/local/share/zimbra-login-sso/patch-login.py apply
```

The script checks the vendor checksum and a unique insertion anchor, saves the
original as `backups/login.jsp.<baseline-sha>`, preserves owner/permissions, then
atomically replaces the JSP. Re-applying the same patch is a no-op. Unknown
contents, changed patches or damaged backups stop the operation without an
overwrite. It does not restart services or change LDAP.

The target's Jasper configuration (`development=false`, `checkInterval=0`)
requires one scheduled `mailboxd` restart to reload an already compiled JSP.
After all deployment changes, as `zimbra`, run `zmmailboxdctl restart` once.
Record start/end timestamps and observed login HTTP unavailability for the
deployment. Verify HTTP readiness, the local password form, disabled/invalid
config handling, and the enabled manual link. Normal config changes need no
restart. Do not redeploy the zimlet merely to edit these settings.

## Configure via CLI

As `zimbra`:

```sh
python3 /usr/local/share/zimbra-login-sso/sso-config.py get
python3 /usr/local/share/zimbra-login-sso/sso-config.py set --enabled true --label 'Login via SSO' --url 'https://YOUR-SSO-HOST/login'
python3 /usr/local/share/zimbra-login-sso/sso-config.py set --enabled false --url ''
```

Use your real HTTPS login URL. Never include credentials or secret tokens in the
URL: the enabled link is public. The helper reads live LDAP via admin SOAP and
writes with `zmzimletctl configure`, invalidating the zimlet cache afterwards.
For a raw CLI workflow, extract defaults with `zmzimletctl getConfigTemplate
/usr/local/share/zimbra-login-sso/com_excellent_login_url_custom.zip`, edit the XML, then run
`zmzimletctl configure <config.xml>` and `zmprov fc zimlet com_excellent_login_url_custom`.
`getConfigTemplate` reads ZIP defaults, not the current live settings.

## Upgrade and re-apply

When replacing a previous package identifier, retain its LDAP entry and deployed
files until the Admin Console form has moved. Copy only `enabled`, `label`, and
`url` into a config document named `com_excellent_login_url_custom`, then install
that document after deploying the new package. Before replacing the installed
fragment, use the installed `patch-login.py rollback` with its matching fragment
to restore the vendor JSP. Retain that script/fragment in a protected migration
backup, install the new source, then apply the new fragment. Keep the original
vendor backup and schedule only one restart after both steps. Configs in the two
LDAP entries are independent after the copy; future edits target the new entry.

Back up LDAP, this source directory and its runtime `backups/` before upgrading.
After an upgrade, review the new vendor JSP, insertion anchor and API
compatibility. Never overwrite a new vendor JSP with an old complete JSP.

If the unmodified vendor checksum is unchanged, run `patch-login.py apply`.
Otherwise, after review, pass `--expected-sha <new-vendor-sha>`; a separate backup
will be created. Update `patch/baseline.sha256` and the default `BASELINE` constant
in `patch-login.py` together when supporting a new baseline. If an old patch
marker remains but contents differ, the script stops for manual review.

If admin zimlet files need redeployment, export/restore LDAP settings as above.
Schedule one restart only after all changes, then repeat login/config checks.
Vendor upgrades may overwrite the JSP; re-apply is maintained customization.

## Rollback

To immediately hide the link, as `zimbra`:

```sh
python3 /usr/local/share/zimbra-login-sso/sso-config.py set --enabled false
```

Then, as root, using the same script/fragment version that was installed:

```sh
python3 /usr/local/share/zimbra-login-sso/patch-login.py rollback
```

Use the corresponding `--expected-sha` if deployed against a different reviewed
baseline. Rollback verifies the baseline backup and current patched content
before restoring. Schedule one `mailboxd` restart to reload the restored JSP,
then verify local login and absence of the link. Retain source, backup and LDAP
config for recovery. Removing the admin zimlet is not required for rollback.
