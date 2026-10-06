#!/usr/bin/env python3
"""Bounded regression gate; reports paths/rules, never matching values. Not a full secret audit."""
import argparse
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# Public Solana addresses and program IDs are not secrets. Match credential context instead.
RULES = {
    'private-key': re.compile(rb'-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----'),
    'credential-url': re.compile(rb'https?://[^\s\x22\x27<>]*[?&](?:api[-_]?key|access[-_]?token|token|secret)=[A-Za-z0-9_%+./=-]{8,}', re.I),
    'url-password': re.compile(rb'https?://[^\s/:]+:[^\s/@]+@', re.I),
    'provider-path-key': re.compile(rb'https?://[^\s/]*(?:alchemy\.com|quiknode\.pro|quicknode\.com)/[^\s\x22\x27<>]{16,}', re.I),
    'secret-assignment': re.compile(rb'(?:private[_-]?key|secret[_-]?key|api[_-]?key|access[_-]?token|auth[_-]?token|password)[\x22\x27]?\s*[:=]\s*[\x22\x27][A-Za-z0-9_+/=-]{20,}[\x22\x27]', re.I),
}
BINARY = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.wav', '.mp3', '.mp4', '.ogg', '.ttf', '.otf', '.woff', '.woff2', '.so', '.dylib', '.pdf', '.zip', '.apk', '.aab'}
MAX_FILE = 64 * 1024 * 1024
MAX_TOTAL = 512 * 1024 * 1024


def findings(data):
    result = [name for name, pattern in RULES.items() if pattern.search(data)]
    try:
        value = json.loads(data)
        if isinstance(value, list) and len(value) == 64 and all(type(n) is int and 0 <= n <= 255 for n in value):
            result.append('solana-secret-key-array')
    except (ValueError, UnicodeDecodeError):
        pass
    return result


def self_test():
    assert findings(b'https://rpc.invalid/?api-' + b'key=0123456789abcdef') == ['credential-url']
    assert findings(b'-----BEGIN ' + b'PRIVATE KEY-----') == ['private-key']
    assert findings(b'https://name:' + b'pass@rpc.invalid') == ['url-password']
    assert findings(b'api_key="' + b'a' * 32 + b'"') == ['secret-assignment']
    assert findings(json.dumps(list(range(64))).encode()) == ['solana-secret-key-array']
    assert not findings(b'{"programId":"11111111111111111111111111111111"}')
    assert not findings(b'EXPO_PUBLIC_RPC_URL=https://rpc.example.invalid')
    assert not findings(b'api_key="YOUR_API_KEY"')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifacts', nargs='*', default=[])
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    self_test()
    if args.self_test:
        print('Secret gate self-test passed')
        return 0
    tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
    paths = {ROOT / name for name in tracked if name}
    # Include this gate before its first commit, too.
    paths.add(Path(__file__).resolve())
    for artifact in args.artifacts:
        path = Path(artifact).resolve()
        if not path.exists():
            parser.error('Artifact path does not exist')
        paths.update(path.rglob('*') if path.is_dir() else [path])
    total = checked = 0
    failed = False
    if len(paths) > 20000:
        parser.error('File-count scan bound exceeded')
    for path in sorted(paths):
        if path.is_symlink():
            print('FAIL: symlink excluded from scan')
            failed = True
            continue
        if not path.is_file() or path.suffix.lower() in BINARY:
            continue
        size = path.stat().st_size
        total += size
        if size > MAX_FILE or total > MAX_TOTAL:
            parser.error('Byte scan bound exceeded; scan smaller batches')
        data = path.read_bytes()
        checked += 1
        hits = findings(data)
        if hits:
            # JSON escaping prevents filenames injecting terminal control characters.
            label = str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else path.name
            print('FAIL:', json.dumps(label), ', '.join(hits))
            failed = True
    print(f'Secret gate: {checked} files checked; ' + ('FAILED' if failed else 'passed'))
    return int(failed)


if __name__ == '__main__':
    raise SystemExit(main())
