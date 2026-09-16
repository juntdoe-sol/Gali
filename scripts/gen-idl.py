"""Build target/idl/gali.json without the Anchor CLI (uses anchor-lang's idl-build test hook)."""
import hashlib, json, os, re, subprocess, sys
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env = dict(os.environ, ANCHOR_IDL_BUILD_PROGRAM_PATH=os.path.join(root, 'programs/gali'))
out = subprocess.run(['cargo', 'test', '-p', 'gali', '--features', 'idl-build', '__anchor_private_print_idl', '--', '--show-output', '--quiet'],
                     cwd=root, env=env, capture_output=True, text=True)
if out.returncode:
    sys.stderr.write(out.stderr); sys.exit(1)
secs = re.findall(r'--- IDL begin (\w+) ---\n(.*?)\n--- IDL end \1 ---', out.stdout, re.S)
idl, events, errors, address, extra = None, [], [], None, []
for name, body in secs:
    v = json.loads(body)
    if name == 'program': idl = v
    elif name == 'address': address = json.loads(v)
    elif name == 'errors': errors = v
    elif name == 'event': events.append(v['event']); extra.extend(v['types'])
names = {t['name'] for t in idl.get('types', [])}
for t in extra:
    if t['name'] not in names: idl.setdefault('types', []).append(t); names.add(t['name'])
for e in events:
    e.setdefault('discriminator', list(hashlib.sha256(f"event:{e['name'].split('::')[-1]}".encode()).digest()[:8]))
idl.update(address=address, events=sorted(events, key=lambda e: e['name']), errors=errors,
           metadata={'name': 'gali', 'version': '0.1.0', 'spec': '0.1.0', 'description': 'Gali: a mining game for Solana Seeker'})
idl['types'] = sorted(idl['types'], key=lambda t: t['name'])
order = ['address', 'metadata', 'instructions', 'accounts', 'events', 'errors', 'types']
text = json.dumps({k: idl[k] for k in order}, indent=2).replace('"gali::', '"')
os.makedirs(os.path.join(root, 'target/idl'), exist_ok=True)
for dest in ['target/idl/gali.json', 'app/src/chain/idl.json']:
    with open(os.path.join(root, dest), 'w') as f: f.write(text)
print('IDL written:', [i['name'] for i in idl['instructions']])
