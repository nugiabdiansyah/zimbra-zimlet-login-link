Backend contract — com_apink_login_sso, version 1.0.0
===================================================

Scope: one global optional manual link, all domains. No SSO protocol integration.
The Admin Console form is a separate Front-End deliverable. The deployed admin
zimlet currently contains its manifest and a reserved JS include only.

Storage
-------

Existing LDAP zimlet entry `com_apink_login_sso`, existing attribute
`zimbraZimletHandlerConfig`. No schema additions. XML:

```xml
<zimletConfig name="com_apink_login_sso" version="1.0.0">
  <global>
    <property name="enabled">false</property>
    <property name="label">Login via SSO</property>
    <property name="url"></property>
  </global>
</zimletConfig>
```

Only these three global properties are supported. No host overrides. Write the
whole config document; concurrent edits are last-writer-wins. Re-read on form
open and after save. The URL is public by design; never store credentials/tokens.

Validation
----------

`enabled` is exactly `true` or `false` (lowercase). URL: absolute HTTPS URI,
maximum 2048 UTF-16 code units; a Java URI host must exist, no userinfo, backslash,
whitespace, ASCII controls, or port greater than 65535. Label: at most 128 UTF-16
code units, no ASCII controls; missing/blank label falls back to `Login via SSO`.
Disabled or empty/invalid URL hides the link. Invalid/oversized label also hides
it. The JSP validates again even if an administrator bypasses form/CLI validation.
Use an XML serializer to escape property values; never concatenate untrusted XML.

Admin read (authenticated full administrator)
--------------------------------------------

The existing Console uses `AjxSoapDoc`, `ZaZimbraAdmin.URN`, and
`ZaRequestMgr.invoke` (see deployed `ZaZimlet.loadMethod`). Send the following in
sequence through the Console's authenticated SOAP machinery:

```xml
<FlushCacheRequest xmlns="urn:zimbraAdmin">
  <cache type="zimlet"><entry by="name">com_apink_login_sso</entry></cache>
</FlushCacheRequest>
```

```xml
<GetZimletRequest xmlns="urn:zimbraAdmin" attrs="zimbraZimletHandlerConfig">
  <zimlet name="com_apink_login_sso"/>
</GetZimletRequest>
```

Parse the XML text in `GetZimletResponse/zimlet/a[@n='zimbraZimletHandlerConfig']`,
then read `global/property`. Do not take the deployed ZIP's template as current
configuration. The flush is necessary because raw `zmzimletctl configure` writes
LDAP while mailboxd may retain an old zimlet entry. The CLI helper also flushes.
These operations require full admin privileges; delegated-admin support is not
part of this delivery. Do not put an admin credential into a JSP or browser code.

Admin write
-----------

1. Validate and serialize all three properties as the XML above.
2. Upload the XML to the same-origin Admin Console endpoint
   `/service/upload?fmt=extended,raw` using its authenticated upload machinery,
   admin session cookie and `X-Zimbra-Csrf-Token: window.csrfToken` when present.
   Existing reference: `js/zimbraAdmin/common/ZaUploader.js:58`. This is an XML
   config upload, not a Zimlet ZIP deployment.
3. Extract `aid` from the successful upload result. Do not use `eval` on an
   untrusted response. For legacy `fmt=raw`, the response
   contains the upload ID as the third quoted field; `extended,raw` has structured
   upload objects, as used by ZaUploader.
4. Send:

```xml
<ConfigureZimletRequest xmlns="urn:zimbraAdmin">
  <content aid="UPLOAD_ATTACHMENT_ID"/>
</ConfigureZimletRequest>
```

5. Require `ConfigureZimletResponse`, then repeat the read sequence and populate
   the form from persisted data. The handler consumes/deletes the uploaded blob.
   Surface upload/SOAP faults without claiming success.

`ConfigureZimletRequest` does not accept inline enabled/label/url properties. It
invokes the same ZimletUtil configuration writer as `zmzimletctl configure`.
Native SOAP accepts arbitrary properties/invalid URLs; the form must validate,
and rendering always fails closed. No new write endpoint is introduced.

CLI
---

As `zimbra`:

```sh
python3 /usr/local/share/zimbra-login-sso/sso-config.py get
python3 /usr/local/share/zimbra-login-sso/sso-config.py set --enabled true --label 'Login via SSO' --url 'https://YOUR-SSO-HOST/login'
python3 /usr/local/share/zimbra-login-sso/sso-config.py set --enabled false
```

The helper uses admin SOAP to read; it uses `zmzimletctl configure` to write and
`zmprov fc zimlet com_apink_login_sso` to invalidate cache. For raw CLI workflows:

```sh
zmzimletctl getConfigTemplate /usr/local/share/zimbra-login-sso/com_apink_login_sso.zip > /path/writable-by-zimbra/config.xml
# Edit the XML and validate it against the rules above.
zmzimletctl configure /path/writable-by-zimbra/config.xml
zmprov fc zimlet com_apink_login_sso
```

`getConfigTemplate` returns defaults from the ZIP, not live LDAP values. Use the
helper's `get` for current settings. LDAP remains the single source of truth.

Login reader
------------

`public/login.jsp` reads server-side via
`Provisioning.getInstance(CacheMode.OFF).getZimlet(NAME)`, then `reload(entry)`,
`getHandlerConfig()` and `new ZimletConfig(xml).getGlobalConf(key)`. Reload is
required even with CacheMode.OFF: runtime tests found the JSP classloader's
zimlet entry otherwise remained stale. No browser token, public endpoint,
extension JAR or per-domain lookup is needed. A failed read/parse hides only the
link; local password form code is unchanged. LDAP read adds work per login-page
render and can inherit LDAP timeouts during a directory outage; it is not an
independent availability layer. Existing local authentication also uses LDAP.

Rendered HTML is an ordinary same-tab anchor immediately under the Sign In
button; `c:out` escapes URL and label, and `rel=noreferrer` avoids sending the
login page URL. No auto-navigation or changes to Zimbra login/logout URL attrs.

References: https://wiki.zimbra.com/wiki/Extending_Admin_UI and
https://wiki.zimbra.com/wiki/ZimletUtil (legacy documentation).
