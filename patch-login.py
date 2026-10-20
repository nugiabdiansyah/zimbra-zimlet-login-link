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
ANCHOR = b'<button id="loginButton" type="submit" tabindex="5" class="loginButton"><fmt:message key="login"/></button>'
def digest(data):
    return hashlib.sha256(data).hexdigest()

def replace(target, data):
    stat = target.stat()
    fd, name = tempfile.mkstemp(prefix='.apink-sso-', dir=target.parent)
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
    if a.action == 'apply':
        if b'BEGIN APINK_LOGIN_SSO' in current:
            if not backup.exists() or digest(backup.read_bytes()) != a.expected_sha:
                raise SystemExit('Missing or damaged baseline backup; refusing')
            expected = backup.read_bytes().replace(ANCHOR, ANCHOR + b'\n' + fragment)
            if current != expected:
                raise SystemExit('Existing patch differs; review before applying')
            print('Already applied; unchanged')
            return
        if digest(current) != a.expected_sha or current.count(ANCHOR) != 1:
            raise SystemExit('Baseline/checkpoint mismatch; review vendor changes first')
        if backup.exists():
            if backup.read_bytes() != current:
                raise SystemExit('Backup mismatch; refusing')
        else:
            shutil.copy2(target, backup)
            backup.chmod(0o600)
        updated = current.replace(ANCHOR, ANCHOR + b'\n' + fragment)
    else:
        original = backup.read_bytes()
        if digest(original) != a.expected_sha:
            raise SystemExit('Backup checksum mismatch; refusing')
        expected = original.replace(ANCHOR, ANCHOR + b'\n' + fragment)
        if current == original:
            print('Already rolled back; unchanged')
            return
        if current != expected:
            raise SystemExit('Current JSP changed since patch; refusing to overwrite')
        updated = original
    replace(target, updated)
    print(a.action + ': SHA256=' + digest(updated))

if __name__ == '__main__':
    main()
