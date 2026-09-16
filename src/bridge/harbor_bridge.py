#!/usr/bin/env python3
"""Host-local Harbor adapter. No dependencies, no credential/config edits, no prompt logging."""
import fcntl
import argparse, base64, hashlib, json, os, pathlib, re, signal, socket, sqlite3, struct, subprocess, sys, threading, time, uuid

ROOT = pathlib.Path.home() / '.local/share/harbor'
UUID = re.compile(r'^[0-9a-fA-F-]{36}$')

def atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + '.' + str(os.getpid()) + '.' + str(threading.get_ident()) + '.tmp')
    with open(temporary, 'w') as out:
        os.chmod(temporary, 0o600); json.dump(value, out)
    os.replace(temporary, path)

def read(path, fallback=None):
    try: return json.loads(path.read_text())
    except (OSError, ValueError): return fallback

def home_for(agent):
    return pathlib.Path(os.environ.get('CODEX_HOME' if agent == 'codex' else 'CLAUDE_CONFIG_DIR', str(pathlib.Path.home() / ('.codex' if agent == 'codex' else '.claude'))))

def title(value):
    return ' '.join(str(value or '').split())[:100]

def live_claude():
    results = {}
    rows = subprocess.check_output(['ps','-axo','pid,stat,comm'], text=True).splitlines()[1:]
    processes = {parts[0]: parts[1:] for line in rows if len(parts := line.split(None,2)) == 3}
    for p in (home_for('claude') / 'sessions').glob('*.json'):
        d = read(p, {})
        process = processes.get(str(d.get('pid')), [])
        if len(process) != 2 or 'Z' in process[0] or 'claude' not in process[1].lower(): continue
        if d.get('sessionId'): results[d['sessionId']] = d
    return results

def claude_records(file):
    try:
        with open(file, 'rb') as f:
            head = f.read(131072); f.seek(0, 2); size = f.tell()
            f.seek(max(0, size - 524288)); tail = f.read()
        result = []
        for line in (head + b'\n' + tail).splitlines():
            try: result.append(json.loads(line))
            except (ValueError, UnicodeError): pass
        return result
    except OSError: return []

def identify(agent, pane_pid):
    lines = subprocess.check_output(['ps','-axo','pid,ppid'], text=True).splitlines()[1:]
    pairs = [line.split() for line in lines]; owned = {str(pane_pid)}
    for _ in range(20):
        next_owned = owned | {pid for pid,parent in pairs if parent in owned}
        if next_owned == owned: break
        owned = next_owned
    if agent == 'claude':
        return next((identity for identity,record in live_claude().items() if str(record.get('pid')) in owned), None)
    files = []
    if pathlib.Path('/proc').exists():
        for pid in owned:
            for fd in pathlib.Path('/proc',pid,'fd').glob('*'):
                try: files.append(os.readlink(fd))
                except OSError: pass
    else:
        output = subprocess.run(['/usr/sbin/lsof','-n','-Fn','-p',','.join(owned)], capture_output=True, text=True)
        files = [line[1:] for line in output.stdout.splitlines() if line.startswith('n')]
    identities = {pathlib.Path(file).stem for file in files if '/thread-writer-locks/' in file and UUID.match(pathlib.Path(file).stem)}
    return next(iter(identities)) if len(identities) == 1 else None

def conversation_busy(agent, identity):
    if agent == 'claude': return identity in live_claude()
    lock = home_for('codex') / 'thread-writer-locks' / (identity + '.lock')
    try:
        with open(lock, 'rb') as handle:
            try: fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError: return True
            fcntl.flock(handle, fcntl.LOCK_UN)
    except FileNotFoundError: pass
    return False

def history(agent, cwd, identity=None):
    cwd = os.path.realpath(os.path.expanduser(cwd)); result = []
    if agent == 'codex':
        databases = sorted(home_for(agent).glob('state_*.sqlite'), key=lambda p: int(re.search(r'_(\d+)', p.name)[1]), reverse=True)
        for database in databases[:1]:
            with sqlite3.connect('file:' + str(database) + '?mode=ro', uri=True, timeout=2) as db:
                db.row_factory = sqlite3.Row
                columns = {r[1] for r in db.execute('pragma table_info(threads)')}
                for row in db.execute('select id,cwd,title,created_at,updated_at,source,rollout_path' + (',name' if 'name' in columns else '') + ' from threads where cwd=? order by updated_at desc limit 500', (cwd,)):
                    r = dict(row)
                    if 'subagent' in r['source'].lower(): continue
                    result.append({'conversationId': r['id'], 'launcher': agent, 'name': title(r.get('name') or r['title']) or 'Untitled chat', 'cwd': cwd, 'updatedAt': r['updated_at'], 'createdAt': r['created_at'], 'transcript': r['rollout_path'], 'externalActive': conversation_busy('codex', r['id'])})
    else:
        live = live_claude()
        project_dir = home_for(agent) / 'projects' / re.sub(r'[^a-zA-Z0-9]', '-', cwd)
        for file in ([project_dir/(identity+'.jsonl')] if identity else project_dir.glob('*.jsonl')):
            if not file.exists(): continue
            if not UUID.match(file.stem): continue
            records = claude_records(file)
            if not any(os.path.realpath(r.get('cwd', '')) == cwd for r in records if r.get('cwd')): continue
            name = ''; first = ''; created = file.stat().st_ctime
            for r in records:
                if r.get('type') in ('custom-title', 'ai-title', 'summary'):
                    name = title(r.get('customTitle') or r.get('aiTitle') or r.get('summary')) or name
                if r.get('type') == 'user' and not first:
                    content = r.get('message', {}).get('content', '')
                    if isinstance(content, str): first = title(content)
                    elif isinstance(content, list): first = title(' '.join(c.get('text', '') for c in content if c.get('type') == 'text'))
            current = live.get(file.stem, {})
            result.append({'conversationId': file.stem, 'launcher': agent, 'name': title(current.get('name')) if current.get('nameSource') in ('user', 'generated', 'ai') else name or first or 'Untitled chat', 'cwd': cwd, 'updatedAt': file.stat().st_mtime, 'createdAt': created, 'externalActive': bool(current), 'transcript': str(file)})
    return result

class WS:
    """Minimal bounded RFC6455 client on a private Unix socket (no network listener)."""
    def __init__(self, path):
        self.sock = socket.socket(socket.AF_UNIX); self.sock.settimeout(4); self.sock.connect(str(path)); self.pending = b''; self.counter = 0
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(('GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n').encode())
        while b'\r\n\r\n' not in self.pending:
            self.pending += self.sock.recv(4096)
            if len(self.pending) > 16384: raise RuntimeError('Invalid socket handshake')
        headers, self.pending = self.pending.split(b'\r\n\r\n', 1)
        expected = base64.b64encode(hashlib.sha1((key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest())
        if b' 101 ' not in headers or expected not in headers: raise RuntimeError('Socket handshake rejected')
    def exact(self, n):
        while len(self.pending) < n:
            chunk = self.sock.recv(max(4096, n-len(self.pending)))
            if not chunk: raise EOFError()
            self.pending += chunk
        data, self.pending = self.pending[:n], self.pending[n:]; return data
    def send(self, message, opcode=1):
        data = json.dumps(message).encode() if opcode == 1 else message
        mask = os.urandom(4); length = len(data)
        header = bytes([128 | opcode]) + (bytes([128 | length]) if length < 126 else bytes([254]) + struct.pack('!H', length) if length < 65536 else bytes([255]) + struct.pack('!Q', length))
        self.sock.sendall(header + mask + bytes(b ^ mask[i % 4] for i,b in enumerate(data)))
    def receive(self):
        fragments = b''
        while True:
            first, second = self.exact(2); n = second & 127
            if n == 126: n = struct.unpack('!H', self.exact(2))[0]
            if n == 127: n = struct.unpack('!Q', self.exact(8))[0]
            if n > 8000000: raise RuntimeError('Oversized socket frame')
            mask = self.exact(4) if second & 128 else None; data = self.exact(n)
            if mask: data = bytes(b ^ mask[i % 4] for i,b in enumerate(data))
            opcode = first & 15
            if opcode == 8: raise EOFError()
            if opcode == 9: self.send(data, 10); continue
            if opcode == 10: continue
            fragments += data
            if first & 128: return json.loads(fragments)
    def rpc(self, method, params):
        self.counter += 1; number = self.counter; self.send({'id': number, 'method': method, 'params': params})
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            message = self.receive()
            if message.get('id') == number:
                if 'error' in message: raise RuntimeError(message['error'].get('message', 'Agent request failed'))
                return message.get('result', {})
        raise TimeoutError('Agent request timed out')
    def initialize(self):
        self.rpc('initialize', {'clientInfo': {'name': 'harbor_monitor', 'version': '0.3.0'}, 'capabilities': {'experimentalApi': True}}); self.send({'method':'initialized'})

def run(args):
    chat = ROOT / 'chats' / args.chat; chat.mkdir(parents=True, exist_ok=True, mode=0o700)
    generation = args.generation; meta_file = chat / 'metadata.json'
    meta = {'generation': generation, 'launcher': args.agent, 'conversationId': args.resume, 'resumable': bool(args.resume), 'activity': 'starting', 'updatedAt': time.time(), 'cwd': os.getcwd()}
    atomic(meta_file, meta); stop = threading.Event(); server = None; terminal = None; ws = None
    def update(**values):
        if stop.is_set(): return
        previous = meta.get('activity'); meta.update(values); meta['updatedAt'] = time.time()
        if values.get('activity') in ('attention','error') and previous != values['activity']: meta['attentionAt'] = time.time()
        if values.get('activity') == 'idle' and previous == 'working': meta['completedAt'] = time.time()
        atomic(meta_file, meta)
    def shutdown(_signum=None, _frame=None):
        stop.set()
        if terminal and terminal.poll() is None: terminal.terminate()
        if server and server.poll() is None:
            try: os.killpg(server.pid, signal.SIGTERM)
            except ProcessLookupError: pass
    signal.signal(signal.SIGHUP, shutdown); signal.signal(signal.SIGTERM, shutdown)
    try:
        if args.agent == 'codex':
            socket_root = pathlib.Path('/tmp') / ('harbor-agent-' + str(os.getuid()))
            socket_root.mkdir(mode=0o700, exist_ok=True)
            if socket_root.is_symlink() or socket_root.stat().st_uid != os.getuid(): raise RuntimeError('Unsafe socket directory')
            os.chmod(socket_root, 0o700)
            endpoint = socket_root / (hashlib.sha256((args.chat+generation).encode()).hexdigest()[:24] + '.sock')
            server = subprocess.Popen(['codex', 'app-server', '--listen', 'unix://'+str(endpoint)], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
            for _ in range(160):
                if server.poll() is not None: raise RuntimeError('Codex app server could not start; check the installed agent version.')
                if endpoint.exists():
                    try: ws = WS(endpoint); ws.initialize(); break
                    except (OSError, RuntimeError): pass
                time.sleep(.1)
            if ws is None: raise RuntimeError('Timed out starting the Codex app server')
            command = ['codex'] + (['resume', args.resume] if args.resume else []) + ['--remote', 'unix://'+str(endpoint)]
            def monitor():
                while not stop.wait(1):
                    try:
                        ids = ws.rpc('thread/loaded/list', {})['data']
                        records = [ws.rpc('thread/read', {'threadId': i, 'includeTurns': False})['thread'] for i in ids]
                        records = [r for r in records if not r.get('parentThreadId')]
                        if not records: continue
                        record = next((r for r in records if r['id'] == meta.get('conversationId')), records[0])
                        status = record.get('status', {}); flags = status.get('activeFlags', [])
                        activity = 'attention' if flags else 'working' if status.get('type') == 'active' else 'error' if status.get('type') == 'systemError' else 'idle'
                        update(conversationId=record['id'], name=title(record.get('name') or record.get('preview')), activity=activity, reason='Approval or input requested' if flags else '', resumable=bool(args.resume or (record.get('path') and pathlib.Path(record['path']).exists())))
                    except (OSError, ValueError, EOFError, RuntimeError, KeyError): pass
            threading.Thread(target=monitor, daemon=True).start()
        else:
            identity = args.resume or str(uuid.uuid4()); update(conversationId=identity)
            hook_command = 'python3 ' + __import__('shlex').quote(str(pathlib.Path(__file__).resolve())) + ' hook ' + args.chat + ' ' + generation
            events = ['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','PermissionRequest','Notification','Stop','StopFailure','SessionEnd']
            settings = {'hooks': {event: [{'hooks': [{'type': 'command', 'command': hook_command, 'timeout': 3}]}] for event in events}}
            command = ['claude', '--resume' if args.resume else '--session-id', identity, '--settings', json.dumps(settings)]
            def monitor():
                while not stop.wait(2):
                    current = live_claude().get(identity, {})
                    records = history('claude', os.getcwd(), identity)
                    record = next((r for r in records if r['conversationId'] == identity), {})
                    patch = {'updatedAt': time.time()}
                    if record: patch.update(name=record['name'], resumable=True)
                    if not stop.is_set(): patch_metadata(meta_file, generation, patch)
            threading.Thread(target=monitor, daemon=True).start()
        terminal = subprocess.Popen(command)
        code = terminal.wait(); stop.set()
        latest = read(meta_file, meta); latest.update(activity='closed', exitCode=code, updatedAt=time.time()); atomic(meta_file, latest)
        return code
    except Exception as error:
        update(activity='error', reason=str(error)); print('\r\nHarbor: '+str(error)+'\r\n', flush=True); return 1
    finally:
        shutdown()
        if server:
            try: server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try: os.killpg(server.pid, signal.SIGKILL)
                except ProcessLookupError: pass
        if ws: ws.sock.close()

def patch_metadata(file, generation, patch):
    with open(file.with_suffix('.lock'), 'a') as guard:
        os.chmod(guard.name, 0o600); fcntl.flock(guard, fcntl.LOCK_EX)
        meta = read(file, {})
        if meta.get('generation') == generation:
            meta.update(patch); atomic(file, meta)
        fcntl.flock(guard, fcntl.LOCK_UN)

def hook(chat_id, generation):
    try:
        event = json.load(sys.stdin)
        if event.get('agent_id'): return
        file = ROOT / 'chats' / chat_id / 'metadata.json'; meta = read(file, {})
        if meta.get('generation') != generation: return
        kind = event.get('hook_event_name'); activity = {'SessionStart':'idle','UserPromptSubmit':'working','PreToolUse':'working','PostToolUse':'working','PermissionRequest':'attention','Stop':'idle','StopFailure':'error','SessionEnd':'closed'}.get(kind)
        if kind == 'Notification' and event.get('notification_type') in ('permission_prompt','idle_prompt','elicitation_dialog'): activity='attention'
        if activity:
            if activity in ('attention','error'): meta['attentionAt'] = time.time()
            if kind == 'Stop': meta['completedAt'] = time.time()
            meta.update(activity=activity, conversationId=event.get('session_id') or meta.get('conversationId'), updatedAt=time.time(), reason='Approval or input requested' if activity == 'attention' else '')
            patch_metadata(file, generation, {key:meta[key] for key in ('activity','conversationId','updatedAt','reason','attentionAt','completedAt') if key in meta})
    except Exception: pass

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); sub = parser.add_subparsers(dest='action', required=True)
    launch = sub.add_parser('run'); launch.add_argument('agent', choices=['codex','claude']); launch.add_argument('chat'); launch.add_argument('generation'); launch.add_argument('--resume')
    event = sub.add_parser('hook'); event.add_argument('chat'); event.add_argument('generation')
    identification = sub.add_parser('identify'); identification.add_argument('agent', choices=['codex','claude']); identification.add_argument('pid', type=int)
    available = sub.add_parser('available'); available.add_argument('agent', choices=['codex','claude']); available.add_argument('identity')
    discovery = sub.add_parser('history'); discovery.add_argument('cwd')
    meta = sub.add_parser('metadata'); meta.add_argument('chats', nargs='+')
    args = parser.parse_args()
    if args.action in ('run','hook') and (not UUID.match(args.chat) or not UUID.match(args.generation)): sys.exit(2)
    if args.action == 'run': sys.exit(run(args))
    elif args.action == 'hook': hook(args.chat, args.generation)
    elif args.action == 'identify': print(json.dumps({'conversationId': identify(args.agent,args.pid)}))
    elif args.action == 'available':
        if not UUID.match(args.identity): sys.exit(2)
        print(json.dumps({'busy': conversation_busy(args.agent, args.identity)}))
    elif args.action == 'history':
        output = []; errors = []
        for agent in ('codex','claude'):
            try: output += history(agent, args.cwd)
            except Exception as error: errors.append(agent+': '+str(error))
        print(json.dumps({'conversations': output, 'errors': errors}))
    elif args.action == 'metadata': print(json.dumps({chat: read(ROOT/'chats'/chat/'metadata.json', {}) for chat in args.chats if UUID.match(chat)}))
