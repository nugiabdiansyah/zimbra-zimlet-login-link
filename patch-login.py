#!/usr/bin/env python3
"""Root: guarded atomic patch/rollback. No service restart and no LDAP writes."""
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import tempfile

ROOT = Path(__file__).resolve().parent
BASELINE = 'be483e682a7ecabd5a500fabe26d2b292f01aa5cebc42b22296a95af559eab40'
ANCHOR = (
    b'                                    <div class="signInAndLabel">\n'
    b'                                        <div>\n'
    b'                                            <button id="loginButton" type="submit" tabindex="5" class="loginButton"><fmt:message key="login"/></button>\n'
    b'                                        </div>\n'
    b'                                        <c:set var="isSignedInDisabled" value="${domainInfo.attrs.zimbraWebClientStaySignedInDisabled}"/>\n'
    b'                                        <c:if test="${isSignedInDisabled eq false}">\n'
    b'                                            <div class="rememberCheckWrapper"> \n'
    b'                                                <input id="remember" tabindex="6" value="1" type="checkbox" name="zrememberme" />\n'
    b'                                                <label id="remember" for="remember"><fmt:message key="rememberMe"/></label>\n'
    b'                                            </div>\n'
    b'                                        </c:if>\n'
    b'                                    </div>'
)

LEGACY_ID = bytes.fromhex('4150494e4b')
LEGACY_MARKER = b'BEGIN ' + LEGACY_ID + b'_LOGIN_SSO'

def digest(data):
    return hashlib.sha256(data).hexdigest()

def strip_patch(data):
    if b'BEGIN EXCELLENT_LOGIN_SSO' in data:
        start_idx = data.find(b'\n<%-- BEGIN EXCELLENT_LOGIN_SSO')
        end_str = b'<%-- END EXCELLENT_LOGIN_SSO --%>\n'
        end_idx = data.find(end_str)
        if start_idx != -1 and end_idx != -1:
            return data[:start_idx] + data[end_idx + len(end_str):], 'new'
    if LEGACY_MARKER in data:
        start_idx = data.find(b'\n<%-- BEGIN ' + LEGACY_ID + b'_LOGIN_SSO')
        end_str = b'<%-- END ' + LEGACY_ID + b'_LOGIN_SSO --%>\n'
        end_idx = data.find(end_str)
        if start_idx != -1 and end_idx != -1:
            return data[:start_idx] + data[end_idx + len(end_str):], 'legacy'
    return data, None

def replace(target, data):
    stat = target.stat()
    fd, name = tempfile.mkstemp(prefix='.excellent-sso-', dir=target.parent)
    try:
        with os.fdopen(fd, 'wb') as f:
            os.fchmod(f.fileno(), stat.st_mode)
            os.fchown(f.fileno(), stat.st_uid, stat.st_gid)
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(name, target)
    finally:
        if os.path.exists(name):
            os.unlink(name)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['apply', 'rollback'])
    parser.add_argument('--target', type=Path, default=Path('/opt/zimbra/jetty_base/webapps/zimbra/public/login.jsp'))
    parser.add_argument('--expected-sha', default=BASELINE, help='Only override after reviewing the new vendor JSP after upgrade')
    a = parser.parse_args()
    if len(a.expected_sha) != 64 or any(c not in '0123456789abcdef' for c in a.expected_sha):
        parser.error('expected-sha must be lowercase SHA-256')
    target = a.target.resolve(strict=True)
    backups = ROOT / 'backups'
    backups.mkdir(mode=0o700, exist_ok=True)
    backup = backups / ('login.jsp.' + a.expected_sha)
    fragment = (ROOT / 'patch/link.jsp.fragment').read_bytes().rstrip() + b'\n'
    current = target.read_bytes()

    stripped, kind = strip_patch(current)

    if a.action == 'apply':
        if kind == 'new':
            if not backup.exists() or digest(backup.read_bytes()) != a.expected_sha:
                raise SystemExit('Missing or damaged baseline backup; refusing')
            expected = backup.read_bytes().replace(ANCHOR, ANCHOR + b'\n' + fragment)
            if current != expected:
                raise SystemExit('Existing patch differs; review before applying')
            print('Already applied; unchanged')
            return

        if kind == 'legacy':
            if not backup.exists() or digest(backup.read_bytes()) != a.expected_sha:
                raise SystemExit('Missing or damaged baseline backup; refusing to migrate')
            if digest(stripped) != a.expected_sha:
                raise SystemExit('Legacy patched file differs from baseline; refusing to migrate')
            updated = stripped.replace(ANCHOR, ANCHOR + b'\n' + fragment)
            replace(target, updated)
            print('migrated: SHA256=' + digest(updated))
            return

        # Not patched yet
        if digest(current) != a.expected_sha or current.count(ANCHOR) != 1:
            raise SystemExit('Baseline/checkpoint mismatch; review vendor changes first')
        if backup.exists():
            if backup.read_bytes() != current:
                raise SystemExit('Backup mismatch; refusing')
        else:
            shutil.copy2(target, backup)
            backup.chmod(0o600)
        updated = current.replace(ANCHOR, ANCHOR + b'\n' + fragment)
        replace(target, updated)
        print(a.action + ': SHA256=' + digest(updated))

    else:  # rollback
        if not backup.exists():
            raise SystemExit('Missing baseline backup; refusing')
        original = backup.read_bytes()
        if digest(original) != a.expected_sha:
            raise SystemExit('Backup checksum mismatch; refusing')

        if kind is not None:
            if digest(stripped) != a.expected_sha:
                raise SystemExit('Current JSP changed since patch; refusing to overwrite')
            updated = original
            replace(target, updated)
            print(a.action + ': SHA256=' + digest(updated))
            return

        if current == original:
            print('Already rolled back; unchanged')
            return

        raise SystemExit('Current JSP does not contain patch or match baseline; refusing to overwrite')

if __name__ == '__main__':
    main()
