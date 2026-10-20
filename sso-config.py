#!/usr/bin/env python3
"""Run as zimbra: read/write the same global LDAP config as Admin Console."""
import argparse
from pathlib import Path
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit

NAME = 'com_excellent_login_url_custom'
DEFAULTS = {'enabled': 'false', 'label': 'Login via SSO', 'url': ''}

def config_or_default(raw_xml=None):
    if raw_xml is None or not raw_xml.strip():
        config = ET.Element('zimletConfig', name=NAME, version='1.0.0')
    else:
        config = ET.fromstring(raw_xml)
        if config.tag != 'zimletConfig' or config.get('name') != NAME:
            raise SystemExit('Unexpected zimlet configuration document')
    group = config.find('global')
    if group is None:
        group = ET.SubElement(config, 'global')
    present = {e.get('name') for e in group.findall('property')}
    for key, value in DEFAULTS.items():
        if key not in present:
            ET.SubElement(group, 'property', name=key).text = value
    return config

def get_config():
    # Raw zmzimletctl configure writes LDAP without invalidating mailboxd's cache.
    subprocess.run(['/opt/zimbra/bin/zmprov', 'fc', '-a', 'zimlet', NAME], check=True, stdout=subprocess.DEVNULL)
    response = subprocess.check_output(['/opt/zimbra/bin/zmsoap', '-z', 'GetZimletRequest', '@attrs=zimbraZimletHandlerConfig', 'zimlet', '@name=' + NAME])
    root = ET.fromstring(response)
    zimlet = root.find('{urn:zimbraAdmin}zimlet')
    if root.tag != '{urn:zimbraAdmin}GetZimletResponse' or zimlet is None or zimlet.get('name') != NAME:
        raise SystemExit('Zimlet entry missing or invalid SOAP response')
    for e in zimlet:
        if e.tag.rsplit('}', 1)[-1] == 'a' and e.get('n') == 'zimbraZimletHandlerConfig':
            if e.get('pd') == '1':
                raise SystemExit('Permission denied reading zimlet configuration')
            return config_or_default(e.text)
    return config_or_default()

def valid_url(url):
    try:
        u = urlsplit(url)
        return (len(url) <= 2048 and u.scheme.lower() == 'https' and bool(u.hostname)
                and u.username is None and u.password is None and (u.port is None or 0 <= u.port <= 65535)
                and not any(ord(c) <= 32 or ord(c) == 127 for c in url) and '\\' not in url)
    except ValueError:
        return False

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=['get', 'set'])
    p.add_argument('--enabled', choices=['true', 'false'])
    p.add_argument('--label')
    p.add_argument('--url')
    a = p.parse_args()
    config = get_config()
    if a.action == 'get':
        print(ET.tostring(config, encoding='unicode'))
        return
    current = {e.get('name'): e.text or '' for e in config.findall('./global/property')}
    for key in ('enabled', 'label', 'url'):
        if getattr(a, key) is not None:
            current[key] = getattr(a, key)
    if current.get('enabled') not in ('true', 'false'):
        p.error('enabled must be true or false')
    if current.get('url') and not valid_url(current['url']):
        p.error('url must be an absolute HTTPS URL without credentials, whitespace or controls')
    if current['enabled'] == 'true' and not current.get('url'):
        p.error('enabled=true requires url')
    label = current.get('label', '')
    if len(label) > 128 or any(ord(c) < 32 or ord(c) == 127 for c in label):
        p.error('label must contain at most 128 characters without controls')
    new = ET.Element('zimletConfig', name=NAME, version='1.0.0')
    group = ET.SubElement(new, 'global')
    for key in ('enabled', 'label', 'url'):
        ET.SubElement(group, 'property', name=key).text = current.get(key, '')
    with tempfile.NamedTemporaryFile(suffix='.xml') as f:
        f.write(ET.tostring(new, encoding='utf-8', xml_declaration=True)); f.flush()
        subprocess.run(['/opt/zimbra/bin/zmzimletctl', 'configure', f.name], check=True)
    subprocess.run(['/opt/zimbra/bin/zmprov', 'fc', '-a', 'zimlet', NAME], check=True)
    print('Saved global config in LDAP')

if __name__ == '__main__':
    main()
