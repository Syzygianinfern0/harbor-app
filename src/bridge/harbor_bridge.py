#!/usr/bin/env python3
"""Host-local Harbor adapter. No dependencies, no credential/config edits, no prompt logging."""
import fcntl
import math
import argparse, base64, hashlib, json, os, pathlib, re, shutil, signal, socket, sqlite3, stat, struct, subprocess, sys, threading, time, uuid

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

def list_directories(value, show_hidden=False):
    """Complete one path segment on this host, without shell expansion or recursion."""
    import heapq
    home = os.path.expanduser('~')
    expanded = os.path.expanduser(value or '~')
    if not os.path.isabs(expanded): expanded = os.path.join(home, expanded)
    query = ''
    folder = os.path.normpath(expanded)
    if os.path.basename(expanded) == '.':
        folder, query = os.path.normpath(os.path.dirname(expanded)), '.'
    elif not os.path.isdir(folder) and not value.endswith('/'):
        folder, query = os.path.split(folder)
    try:
        with os.scandir(folder) as children:
            def matches():
                for child in children:
                    if child.name.startswith('.') and not show_hidden and not query.startswith('.'): continue
                    if query.casefold() not in child.name.casefold(): continue
                    try:
                        if child.is_dir(): yield {'name': child.name, 'path': child.path}
                    except OSError: continue
            # Keep the response bounded even on hosts with very large directories.
            entries = heapq.nsmallest(201, matches(), key=lambda item: (not item['name'].casefold().startswith(query.casefold()), item['name'].casefold(), item['name']))
        return {'directory': folder, 'parent': os.path.dirname(folder) if folder != '/' else None,
                'home': home, 'query': query, 'entries': entries[:200], 'truncated': len(entries) > 200}
    except PermissionError:
        return {'error': 'Permission denied. Choose a folder you can read.'}
    except (FileNotFoundError, NotADirectoryError):
        return {'error': 'Folder not found. Check the path or go to Home.'}
    except OSError as error:
        return {'error': 'Unable to read this folder: ' + str(error)}

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

_message_cache = {}

def claude_has_messages(file):
    """Only hide a transcript when a complete readable scan proves it empty."""
    try:
        stat = file.stat(); key = (str(file), stat.st_size, stat.st_mtime_ns)
        if key in _message_cache: return _message_cache[key]
        malformed = False; found = False
        with file.open() as stream:
            for line in stream:
                if not line.strip(): continue
                try: record = json.loads(line)
                except ValueError: malformed = True; continue
                if record.get('type') in ('user', 'assistant') and record.get('message', {}).get('content'):
                    found = True; break
        result = True if found else None if malformed else False
        if len(_message_cache) > 2048: _message_cache.clear()
        _message_cache[key] = result
        return result
    except (OSError, UnicodeError): return None

def codex_has_messages(row):
    # Paginated histories may leave has_user_event at zero even after a full turn.
    if row.get('has_user_event') or row.get('first_user_message') or row.get('preview'): return True
    try:
        malformed = False
        with pathlib.Path(row['rollout_path']).open() as stream:
            for line in stream:
                if not line.strip(): continue
                try: record = json.loads(line)
                except ValueError: malformed = True; continue
                payload = record.get('payload', {})
                if record.get('type') == 'event_msg':
                    if payload.get('type') in ('user_message','agent_message'): return True
                    if payload.get('type') == 'item_completed' and payload.get('item', {}).get('type') in ('userMessage','agentMessage'): return True
                if record.get('type') == 'response_item' and payload.get('role') == 'assistant' and payload.get('content'): return True
        return None if malformed else False
    except (OSError, UnicodeError, KeyError): return None

def permission_args(agent, mode, help_text=''):
    if agent == 'codex':
        sandbox = {'standard':'workspace-write', 'read-only':'read-only', 'full-access':'danger-full-access'}[mode]
        approval = 'never' if mode == 'full-access' else 'on-request'
        return ['--sandbox', sandbox, '--ask-for-approval', approval]
    if mode == 'full-access': return ['--dangerously-skip-permissions']
    # Claude renamed the normal mode from default to manual. Ask the actual host CLI.
    standard = 'manual' if re.search(r'["\']manual["\']', help_text) else 'default'
    return ['--permission-mode', {'standard':standard, 'accept-edits':'acceptEdits', 'plan':'plan'}[mode]]

def session_args(agent, resume=None, fork=None, identity=None):
    # A fork starts from the saved conversation under a new ID and leaves the original untouched.
    if agent == 'codex': return ['resume', resume] if resume else ['fork', fork] if fork else []
    return ['--resume', resume] if resume else ['--resume', fork, '--fork-session', '--session-id', identity] if fork else ['--session-id', identity]

def codex_thread(records, current=None, fork=None):
    # Subagent threads and the fork's source (if the server loads it) are never this chat's conversation.
    records = [r for r in records if not r.get('parentThreadId') and (not fork or r.get('id') != fork)]
    return next((r for r in records if r.get('id') == current), next((r for r in records if fork and r.get('forkedFromId') == fork), records[0] if records else None))

def codex_server_permissions(mode):
    flags = permission_args('codex', mode)
    return ['-c', 'sandbox_mode="'+flags[1]+'"', '-c', 'approval_policy="'+flags[3]+'"']

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
                for row in db.execute('select id,cwd,title,created_at,updated_at,source,rollout_path' + ''.join(','+field for field in ('name','has_user_event','first_user_message','preview') if field in columns) + ' from threads where cwd=?' + (' and id=?' if identity else '') + ' order by updated_at desc limit 500', (cwd,identity) if identity else (cwd,)):
                    r = dict(row)
                    if 'subagent' in r['source'].lower(): continue
                    result.append({'conversationId': r['id'], 'launcher': agent, 'name': title(r.get('name') or r['title']) or 'Untitled chat', 'cwd': cwd, 'updatedAt': r['updated_at'], 'createdAt': r['created_at'], 'hasMessages': codex_has_messages(r), 'transcript': r['rollout_path'], 'externalActive': conversation_busy('codex', r['id'])})
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
            result.append({'conversationId': file.stem, 'launcher': agent, 'name': title(current.get('name')) if current.get('nameSource') in ('user', 'generated', 'ai') else name or first or 'Untitled chat', 'cwd': cwd, 'updatedAt': file.stat().st_mtime, 'createdAt': created, 'externalActive': bool(current), 'transcript': str(file), 'hasMessages': claude_has_messages(file)})
    return result

def transcript_preview(file, agent):
    """Count displayable messages once; return only a bounded recent preview."""
    from collections import deque
    recent = deque(maxlen=4); count = 0; seen = set(); malformed = False
    try:
        with open(file) as stream:
            for line in stream:
                try: record = json.loads(line)
                except ValueError: malformed = True; continue
                message = record.get('message', {}) if agent == 'claude' else record.get('payload', {})
                if agent == 'claude':
                    if record.get('type') not in ('user', 'assistant') or record.get('isMeta'): continue
                    role = record['type']; identity = record.get('uuid')
                else:
                    # response_item is the canonical transcript; event_msg mirrors it.
                    if record.get('type') != 'response_item' or message.get('type', 'message') != 'message': continue
                    role = message.get('role'); identity = message.get('id')
                if role not in ('user','assistant'): continue
                content = message.get('content', '')
                text = content if isinstance(content, str) else '\n'.join(c.get('text','') for c in content if isinstance(c,dict) and c.get('type') in ('text','input_text','output_text')) if isinstance(content,list) else ''
                if not text.strip(): continue
                if identity and identity in seen: continue
                if identity: seen.add(identity)
                count += 1; recent.append({'role':role,'text':text[:1200]+('…' if len(text)>1200 else '')})
        return {'messageCount':None if malformed else count,'messages':list(recent)}
    except (OSError, UnicodeError): return {'messages':[], 'error':'Saved transcript is unavailable on this host.'}

def preview(agent, cwd, identity):
    if not UUID.match(identity): return {'messages':[], 'error':'Invalid conversation ID.'}
    conversations = history(agent,cwd,identity)
    conversation = next((c for c in conversations if c['conversationId']==identity), None)
    return transcript_preview(conversation['transcript'],agent) if conversation else {'messages':[], 'error':'Saved conversation could not be found.'}

def empty_tokens():
    # inputTokens includes cache reads and writes; outputTokens includes Codex reasoning.
    return dict(inputTokens=0, outputTokens=0, cacheReadTokens=0, cacheWriteTokens=0, reasoningTokens=0, totalTokens=0)

def inherited_snapshots(file):
    """Match a fork's leading snapshots against its parent, even when timestamps
    were rewritten at fork time. Only metric signatures are retained."""
    try:
        with open(file) as stream: meta = json.loads(next(stream)).get('payload', {})
        parent = meta.get('forked_from_id')
        if not parent or parent == meta.get('id') or not UUID.match(parent): return set(), False
        candidates = []
        for root in [home_for('codex')/'sessions', home_for('codex')/'archived_sessions']:
            candidates.extend(root.rglob('*'+parent+'.jsonl'))
        if not candidates: return set(), True
        signatures = set()
        with max(candidates, key=lambda p:p.stat().st_mtime_ns).open() as stream:
            for line in stream:
                try: record = json.loads(line)
                except ValueError: continue
                payload = record.get('payload') or {}
                if payload.get('type') == 'token_count' and payload.get('info'):
                    info = payload['info']
                    signatures.add(json.dumps([info.get('total_token_usage'),info.get('last_token_usage')], sort_keys=True))
        return signatures, False
    except (OSError, ValueError, StopIteration): return set(), True

def usage_record(file, agent):
    """Read metrics only. Cumulative Codex snapshots and Claude streaming chunks
    must not be summed as if each log line were a separate API request."""
    tokens = empty_tokens(); seen_usage = False; partial = False
    model = None; tier = 'default'; born = None; child = False; previous_snapshot = None
    inherited, uncertain_fork = inherited_snapshots(file) if agent == 'codex' else (set(), False)
    replaying = bool(inherited); partial = uncertain_fork
    requests = {}; events = []; compactions = set(); compact_events = set(); identity = str(file)
    def timestamp(value):
        from datetime import datetime
        try: return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
        except (ValueError, TypeError, AttributeError): return None
    def number(value):
        return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0
    try:
        with open(file) as stream:
            for index, line in enumerate(stream):
                if not line.strip(): continue
                try:
                    record = json.loads(line)
                    if not isinstance(record, dict): raise ValueError()
                except ValueError: partial = True; continue
                payload = record.get('payload') or {}
                if not isinstance(payload, dict): partial = True; continue
                if agent == 'codex':
                    if record.get('type') == 'session_meta':
                        identity = payload.get('id') or identity
                        born = timestamp(payload.get('timestamp') or record.get('timestamp'))
                        child = bool(payload.get('forked_from_id')) or 'subagent' in str(payload.get('source', '')).lower()
                    if record.get('type') == 'turn_context': model = payload.get('model') or model
                    if record.get('type') == 'event_msg' and payload.get('type') == 'thread_settings_applied':
                        settings = payload.get('thread_settings') or {}
                        model = settings.get('model') or model
                        tier = settings.get('service_tier') or tier
                    if record.get('type') == 'compacted':
                        compactions.add(payload.get('compaction_response_id') or payload.get('window_id') or record.get('ordinal') or record.get('timestamp') or index)
                    if record.get('type') == 'event_msg' and payload.get('type') == 'context_compacted':
                        compact_events.add(record.get('timestamp') or index)
                    if record.get('type') != 'event_msg' or payload.get('type') != 'token_count': continue
                    info = payload.get('info') or {}
                    if not isinstance(info, dict): partial = True; continue
                    usage = info.get('total_token_usage'); latest = info.get('last_token_usage')
                    if not isinstance(usage, dict) and not isinstance(latest, dict): continue
                    seen_usage = True
                    delta = empty_tokens()
                    if usage != previous_snapshot or usage is None:
                        for dest, source in [('inputTokens','input_tokens'),('outputTokens','output_tokens'),('cacheReadTokens','cached_input_tokens'),('cacheWriteTokens','cache_write_input_tokens'),('reasoningTokens','reasoning_output_tokens'),('totalTokens','total_tokens')]:
                            delta[dest] = number(latest.get(source)) if isinstance(latest, dict) else max(0,number(usage.get(source))-number((previous_snapshot or {}).get(source)))
                    if isinstance(usage, dict): previous_snapshot = usage
                    delta['totalTokens'] = max(delta['totalTokens'], delta['inputTokens']+delta['outputTokens'])
                    when = timestamp(record.get('timestamp'))
                    signature = json.dumps([usage,latest], sort_keys=True)
                    if replaying and signature in inherited: continue
                    if any(delta.values()): replaying = False
                    if child and born and when is not None and when < born: continue
                    # Missing parent history cannot be priced reliably during the
                    # rewritten burst at the fork instant. Keep coverage partial.
                    if uncertain_fork and born and when is not None and when-born <= 1: continue
                    for key in tokens: tokens[key] += delta[key]
                    if when is None: partial = True
                    elif any(delta.values()):
                        events.append({'at':when, 'tokens':delta, 'model':payload.get('model') or info.get('model') or model, 'tier':tier,
                                       'requestInput':number((latest or {}).get('input_tokens')) or delta['inputTokens']})
                else:
                    identity = record.get('sessionId') or identity
                    if record.get('type') == 'system' and record.get('subtype') == 'compact_boundary':
                        compactions.add(record.get('uuid') or record.get('timestamp') or index)
                    message = record.get('message') or {}
                    if record.get('type') != 'assistant' or not isinstance(message, dict): continue
                    usage = message.get('usage')
                    if message.get('model') == '<synthetic>': continue
                    if not isinstance(usage, dict) or not any(isinstance(usage.get(key), int) for key in ('input_tokens','output_tokens','total_tokens')): continue
                    seen_usage = True
                    key = (message.get('id') or record.get('uuid') or str(index), record.get('requestId'))
                    # Only a real message id identifies the request across files (forks, subagents).
                    event = requests.setdefault(key, {'at':timestamp(record.get('timestamp')), 'tokens':empty_tokens(), 'key':[message['id'], record.get('requestId')] if message.get('id') else None})
                    event.update(model=message.get('model'), tier=usage.get('service_tier', 'standard'), speed=usage.get('speed', 'standard'), geo=usage.get('inference_geo', 'global'))
                    creation = usage.get('cache_creation') or {}
                    event['cacheWrite1h'] = max(event.get('cacheWrite1h', 0), number(creation.get('ephemeral_1h_input_tokens')))
                    recorded_cost = record.get('costUSD')
                    if isinstance(recorded_cost, (int, float)) and not isinstance(recorded_cost, bool) and math.isfinite(recorded_cost) and recorded_cost >= 0:
                        event['recordedCost'] = max(event.get('recordedCost', 0), recorded_cost)
                    previous = event['tokens']
                    for dest, source in [('inputTokens','input_tokens'),('outputTokens','output_tokens'),('cacheReadTokens','cache_read_input_tokens'),('cacheWriteTokens','cache_creation_input_tokens')]:
                        previous[dest] = max(previous[dest], number(usage.get(source)))
        if agent == 'claude':
            for event in requests.values():
                usage = event['tokens']
                usage['inputTokens'] += usage['cacheReadTokens'] + usage['cacheWriteTokens']
                usage['totalTokens'] = usage['inputTokens'] + usage['outputTokens']
                for key in tokens: tokens[key] += usage[key]
                if event['at'] is None: partial = True
                else: events.append(event)
            tokens['totalTokens'] = tokens['inputTokens'] + tokens['outputTokens']
        elif seen_usage:
            tokens['totalTokens'] = max(tokens['totalTokens'], tokens['inputTokens'] + tokens['outputTokens'])
        return {'conversationId': identity, 'tokens': tokens if seen_usage else None,
                'compactionCount': max(len(compactions), len(compact_events)), 'partial': partial, 'events':events}
    except (OSError, UnicodeError):
        return {'tokens': None, 'compactionCount': None, 'partial': True, 'error': 'Saved transcript is unavailable on this host.'}

def cached_usage(file, agent, cache):
    stat = file.stat(); key = str(file.resolve()); fingerprint = [stat.st_size, stat.st_mtime_ns]
    previous = cache.get(key)
    if previous and previous.get('fingerprint') == fingerprint: return previous
    return {'fingerprint': fingerprint, 'data': usage_record(file, agent)}

def merge_usage(datas, seen=None):
    """Combine one conversation's transcripts (Claude subagents, Codex spawned
    threads). A Claude request copied into several files counts once, at its
    fullest copy: a subagent's copy of its parent's request may hold only an
    early streaming chunk."""
    seen = {} if seen is None else seen
    tokens = empty_tokens(); events = []; recorded = False; partial = False
    for data in datas:
        partial = partial or data.get('partial', False)
        if data.get('tokens') is None: continue
        recorded = True
        for field in tokens: tokens[field] += data['tokens'][field]
        for event in data.get('events', []):
            key = tuple(event['key']) if event.get('key') else None
            if key in seen:
                kept, owner = seen[key]
                for field in tokens:
                    grow = max(0, event['tokens'][field] - kept['tokens'][field])
                    kept['tokens'][field] += grow; owner[field] += grow
                    tokens[field] -= event['tokens'][field]
                for field in ('cacheWrite1h', 'recordedCost'):
                    if field in event: kept[field] = max(kept.get(field, 0), event[field])
                continue
            # Copy: kept events may grow, and the originals live in the usage cache.
            event = {**event, 'tokens': dict(event['tokens'])}
            if key: seen[key] = (event, tokens)
            events.append(event)
    return {'tokens':tokens if recorded else None, 'events':events, 'partial':partial}

def claude_session(file):
    try:
        with open(file) as stream:
            for _, line in zip(range(50), stream):
                try: session = json.loads(line).get('sessionId')
                except (ValueError, AttributeError): continue
                if session: return session
    except (OSError, UnicodeError): pass

def claude_transcript(file):
    # Chats are <project>/<uuid>.jsonl; subagents and Workflow agents are agent-*.jsonl
    # under <project>/<uuid>/subagents/ (legacy: beside the chat). Skip workflow journals.
    return file.name.startswith('agent-') or bool(UUID.match(file.stem))

def codex_pages(file, identity):
    """Codex paginates long threads: later pages are rollout-<time>-<id>_<page>.jsonl
    with a history_base, sharing the thread id and holding only their own usage.
    The same page may sit in sessions and archived_sessions; keep the newest copy."""
    pages = {file.name: file}
    if UUID.match(identity or ''):
        for root in [home_for('codex')/'sessions', home_for('codex')/'archived_sessions']:
            if not root.exists(): continue
            for page in [*root.rglob('rollout-*-'+identity+'.jsonl'), *root.rglob('rollout-*-'+identity+'_*.jsonl')]:
                if page.name not in pages or page.stat().st_mtime_ns > pages[page.name].stat().st_mtime_ns: pages[page.name] = page
    return [page for name, page in sorted(pages.items()) if page.resolve() != pathlib.Path(file).resolve()]

def related_transcripts(agent, file, identity):
    """Transcripts whose usage belongs to this chat: Claude subagent/Workflow agent
    logs, and Codex threads spawned from it (recursively)."""
    if agent == 'claude':
        files = sorted((file.parent/identity/'subagents').rglob('agent-*.jsonl'))
        return files + [legacy for legacy in sorted(file.parent.glob('agent-*.jsonl')) if claude_session(legacy) == identity]
    databases = sorted(home_for(agent).glob('state_*.sqlite'), key=lambda p: int(re.search(r'_(\d+)', p.name)[1]), reverse=True)
    if not databases: return []
    files = []; seen = {identity}; queue = [identity]
    with sqlite3.connect('file:' + str(databases[0]) + '?mode=ro', uri=True, timeout=2) as db:
        if not db.execute("select 1 from sqlite_master where type='table' and name='thread_spawn_edges'").fetchone(): return []
        while queue and len(seen) < 500:
            for child, rollout in db.execute('select e.child_thread_id, t.rollout_path from thread_spawn_edges e left join threads t on t.id=e.child_thread_id where e.parent_thread_id=?', (queue.pop(),)):
                if child in seen: continue
                seen.add(child); queue.append(child)
                if rollout and pathlib.Path(rollout).is_file(): files.extend([pathlib.Path(rollout), *codex_pages(pathlib.Path(rollout), child)])
    return files

def usage_periods(data, now):
    periods = {}
    for key, days in [('day',1),('week',7),('month',30)]:
        matched = [event for event in data.get('events', []) if now-days*86400 <= event['at'] <= now]
        totals = empty_tokens()
        for event in matched:
            for field in totals: totals[field] += event['tokens'][field]
        periods[key] = {'tokens':totals, 'sessions':1 if matched else 0}
    return periods

def event_cost(event, catalog):
    recorded = event.get('recordedCost')
    if recorded is not None: return recorded, 'recorded'
    model = event.get('model') or ''
    models = catalog.get('models', {})
    aliases = {'gpt-reserve':'gpt-5.6-luna'}
    model = aliases.get(model, model)
    rates = models.get(model) or models.get(model.removeprefix('openai/').removeprefix('anthropic/'))
    if not rates: return None, 'unavailable'
    tokens = event['tokens']; request_input = event.get('requestInput', tokens['inputTokens'])
    tier = event.get('tier', 'default')
    suffix = '_priority' if tier in ('priority', 'fast') else '_flex' if tier == 'flex' else ''
    if tier not in ('default','standard','priority','fast','flex',None): return None, 'unavailable'
    threshold = ''
    for key in rates:
        match = re.fullmatch(r'input_cost_per_token_above_(\d+)k_tokens', key)
        if match and request_input > int(match[1])*1000 and (not threshold or int(match[1]) > int(re.search(r'(\d+)', threshold)[1])):
            threshold = '_above_'+match[1]+'k_tokens'
    def rate(name, long=True):
        # A missing tier rate is unknown, never silently priced at the standard tier.
        return rates.get(name + (threshold if long else '') + suffix, rates.get(name + suffix))
    read_count = tokens['cacheReadTokens']; write_count = tokens['cacheWriteTokens']
    normal = max(0, tokens['inputTokens'] - read_count - write_count)
    one_hour = min(write_count, event.get('cacheWrite1h', 0))
    parts = [(normal, rate('input_cost_per_token')), (tokens['outputTokens'], rate('output_cost_per_token')),
             (read_count, rate('cache_read_input_token_cost')), (write_count-one_hour, rate('cache_creation_input_token_cost')),
             (one_hour, rates.get('cache_creation_input_token_cost_above_1hr'))]
    if any(count and price is None for count,price in parts): return None, 'unavailable'
    multiplier = 1
    provider = rates.get('provider_specific_entry', {})
    for option in [event.get('speed'), event.get('geo')]:
        # Haiku reports inference_geo "not_available": no regional pricing applies.
        if option not in (None, '', 'standard', 'global', 'not_available'):
            if option not in provider: return None, 'unavailable'
            multiplier *= provider[option]
    return sum(count*(price or 0) for count,price in parts)*multiplier, 'estimated'

def cost_summary(events, catalog):
    """Cost and the tokens behind it, in total, per model and per UTC day and model."""
    from datetime import datetime, timezone
    blank = lambda: {'usd':0, 'estimated':0, 'recorded':0, 'unpriced':0, 'tokens':empty_tokens()}
    result = {**blank(), 'models':[], 'days':[]}
    models = {}; days = {}
    for event in events:
        cost, kind = event_cost(event, catalog)
        model = event.get('model') or 'Unknown model'
        day = datetime.fromtimestamp(event['at'], timezone.utc).strftime('%Y-%m-%d') if event.get('at') else 'Unknown date'
        for row in (result, models.setdefault(model, {'model':model, **blank()}), days.setdefault((day,model), {'day':day, 'model':model, **blank()})):
            row['unpriced' if cost is None else kind] += 1
            if cost is not None: row['usd'] += cost
            for field in row['tokens']: row['tokens'][field] += event['tokens'].get(field, 0)
    result['models'] = sorted(models.values(), key=lambda row:-row['usd'])
    result['days'] = sorted(days.values(), key=lambda row:(row['day'],row['model']), reverse=True)
    return result

def host_usage(catalog=None):
    now = time.time(); catalog = catalog or {}
    agents = []; cache_file = ROOT / 'usage-cache-v7.json'; old_cache = read(cache_file, {}); cache = {}
    for agent in ('codex', 'claude'):
        home = home_for(agent); roots = [home/'sessions', home/'archived_sessions'] if agent == 'codex' else [home/'projects']
        totals = empty_tokens(); groups = {}; errors = []; files = set()
        for root in roots:
            try:
                if root.exists(): files.update(file for file in root.rglob('*.jsonl') if agent == 'codex' or claude_transcript(file))
            except OSError: errors.append('Some transcript folders could not be read.')
        for file in sorted(files):
            try:
                entry = cached_usage(file, agent, old_cache); cache[str(file.resolve())] = entry
                data = entry['data']; identity = data.get('conversationId') or str(file)
                # Claude subagents share the parent sessionId, so they join its chat. Codex
                # pages of one paginated thread share its id and all count; the same page
                # may exist in sessions and archived_sessions, so keep the newest copy.
                if agent == 'claude': groups.setdefault(identity, []).append(entry)
                else:
                    pages = groups.setdefault(identity, {})
                    if file.name not in pages or entry['fingerprint'][1] > pages[file.name]['fingerprint'][1]: pages[file.name] = entry
            except OSError: errors.append('Some transcript files could not be read.')
        seen = {}; conversations = [merge_usage([entry['data'] for entry in (group.values() if isinstance(group, dict) else group)], seen) for group in groups.values()]
        periods = {key:{'tokens':empty_tokens(), 'sessions':0} for key in ('day','week','month')}
        recorded = 0; partial = bool(errors); all_events = []
        for data in conversations:
            partial = partial or data.get('partial', False)
            all_events.extend(data.get('events', []))
            for key, period in usage_periods(data, now).items():
                periods[key]['sessions'] += period['sessions']
                for field in totals: periods[key]['tokens'][field] += period['tokens'][field]
            if data.get('tokens') is not None:
                recorded += 1
                for key in totals: totals[key] += data['tokens'][key]
        for key, days in [('day',1),('week',7),('month',30)]:
            periods[key]['cost'] = cost_summary([event for event in all_events if now-days*86400 <= event['at'] <= now], catalog)
        agents.append({'agent':agent, 'tokens':totals if recorded else None, 'sessions':len(conversations), 'recordedSessions':recorded, 'partial':partial, 'periods':periods,
                       'error': 'Some transcripts were incomplete or unreadable.' if partial else None})
    try: atomic(cache_file, cache)
    except OSError: pass
    return {'agents':agents, 'pricingUpdatedAt':catalog.get('fetchedAt')}

def chat_usage(agent, cwd, identity, catalog=None):
    if not UUID.match(identity): return {'error':'Invalid conversation ID.'}
    conversation = next((c for c in history(agent, cwd, identity) if c['conversationId'] == identity), None)
    if not conversation: return {'error':'No saved conversation is available yet.'}
    file = pathlib.Path(conversation['transcript'])
    # Per-file caching keeps polling active, large transcripts inexpensive.
    cache_file = ROOT / 'usage-chats-v7' / (agent+'-'+identity+'.json')
    try:
        old = read(cache_file, {}); cache = {}; entry = cached_usage(file, agent, old); cache[str(file.resolve())] = entry
        datas = [entry['data']]; partial = False
        try: pages = codex_pages(file, identity) if agent == 'codex' else []
        except OSError: pages = []; partial = True
        for page in pages:
            try: cache[str(page.resolve())] = cached_usage(page, agent, old); datas.append(cache[str(page.resolve())]['data'])
            except OSError: partial = True
        try: related = related_transcripts(agent, file, identity)
        except (OSError, sqlite3.Error): related = []; partial = True
        for extra in related:
            try: cache[str(extra.resolve())] = cached_usage(extra, agent, old); datas.append(cache[str(extra.resolve())]['data'])
            except OSError: partial = True
        try: atomic(cache_file, cache)
        except OSError: pass
        merged = merge_usage(datas)
        return {**{key:value for key,value in entry['data'].items() if key != 'events'}, 'tokens':merged['tokens'], 'partial':merged['partial'] or partial,
                'subagents':sum(1 for data in datas[1+len(pages):] if data.get('tokens') is not None),
                'cost':cost_summary(merged['events'], catalog or {}) if merged['tokens'] is not None else None, 'pricingUpdatedAt':(catalog or {}).get('fetchedAt')}
    except OSError: return {'error':'Saved transcript is unavailable on this host.'}

# ---- Plans and remaining limits ------------------------------------------------------------
# Only plan names, billing modes, limit percentages, reset times and a salted hash of the account
# ID ever leave this host. Tokens, emails and raw account IDs are never returned, logged or stored.

API_ENV = ('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN')
CLOUD_ENV = {'CLAUDE_CODE_USE_BEDROCK': 'Bedrock', 'CLAUDE_CODE_USE_VERTEX': 'Vertex', 'CLAUDE_CODE_USE_FOUNDRY': 'Foundry'}

def limits_dir():
    return ROOT / 'limits'

def account_key(agent, *parts):
    """Salted, truncated hash so one sign-in on several hosts shows as one account."""
    parts = [part for part in parts if isinstance(part, str) and part]
    if not parts: return None
    return hashlib.sha256(('harbor-account-v1\n' + agent + '\n' + '\n'.join(parts)).encode()).hexdigest()[:16]

def epoch(value):
    """Seconds since the epoch from seconds, milliseconds or an ISO 8601 string."""
    if isinstance(value, bool): return None
    if isinstance(value, (int, float)) and math.isfinite(value) and value > 0: return value / 1000 if value > 1e11 else float(value)
    if isinstance(value, str):
        from datetime import datetime
        try: return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
        except ValueError: return None
    return None

def limit_window(used, minutes=None, resets=None):
    if isinstance(used, bool) or not isinstance(used, (int, float)) or not math.isfinite(used): return None
    window = {'usedPercent': max(0.0, min(100.0, float(used)))}
    if isinstance(minutes, (int, float)) and not isinstance(minutes, bool) and math.isfinite(minutes) and minutes > 0: window['windowMinutes'] = int(minutes)
    reset = epoch(resets)
    if reset: window['resetsAt'] = reset
    return window

def plan_name(value):
    value = str(value or '').strip()
    if not value or value.lower() in ('unknown', 'none', 'null'): return None
    return re.sub(r'[^A-Za-z0-9 ._+-]', '', value.replace('_', ' ')).strip().title()[:30] or None

def claude_plan_name(kind, tier=''):
    kind = str(kind or '').lower().removeprefix('claude_')
    match = re.search(r'max_(\d+x)', str(tier or '').lower())
    return 'Max ' + match[1] if kind == 'max' and match else plan_name(kind)

def codex_limits(snapshot, base=None):
    """account/rateLimits/read (camelCase) or a session log's token_count.rate_limits (snake_case).
    Returns (limits, plan name) or None."""
    if not isinstance(snapshot, dict): return None
    windows = []
    for name in ('primary', 'secondary'):
        raw = snapshot.get(name)
        if not isinstance(raw, dict): continue
        reset = raw.get('resetsAt', raw.get('resets_at'))
        if reset is None and isinstance(raw.get('resets_in_seconds'), (int, float)) and base: reset = base + raw['resets_in_seconds']
        window = limit_window(raw.get('usedPercent', raw.get('used_percent')), raw.get('windowDurationMins', raw.get('window_minutes')), reset)
        if window: windows.append(window)
    reached = snapshot.get('rateLimitReachedType', snapshot.get('rate_limit_reached_type'))
    if not windows and not isinstance(reached, str): return None
    result = {'windows': windows}
    if isinstance(reached, str): result['reached'] = reached[:60]
    return result, plan_name(snapshot.get('planType', snapshot.get('plan_type')))

def locked_json(file, change):
    """Read-modify-write a small host-local JSON file under an exclusive lock."""
    file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with open(file.with_suffix('.lock'), 'a') as guard:
        os.chmod(guard.name, 0o600); fcntl.flock(guard, fcntl.LOCK_EX)
        try:
            value = read(file, {})
            value = change(value if isinstance(value, dict) else {})
            if value is not None: atomic(file, value)
        finally: fcntl.flock(guard, fcntl.LOCK_UN)

def codex_auth():
    """Billing mode from Codex's auth.json. Only auth_mode and the account ID's hash are kept."""
    file = home_for('codex') / 'auth.json'
    try: changed = file.stat().st_mtime
    except OSError: return {}
    data = read(file, {})
    if not isinstance(data, dict): return {}
    mode = str(data.get('auth_mode') or '').lower().replace('_', '')
    tokens = data.get('tokens') if isinstance(data.get('tokens'), dict) else {}
    result = {'mode': 'api' if mode in ('apikey', 'api') else 'subscription' if mode.startswith('chatgpt') else 'api' if data.get('OPENAI_API_KEY') and not tokens else 'subscription' if tokens else None,
              'account': account_key('codex', tokens.get('account_id'))}
    del data, tokens
    # auth.json is rewritten on every token refresh; only a change of mode or account counts as an auth change.
    seen = {}
    def remember(state):
        key = str(home_for('codex')); previous = state.get(key) or {}
        if previous.get('mode') == result['mode'] and previous.get('account') == result['account']: seen.update(previous); return None
        seen.update(mode=result['mode'], account=result['account'], changedAt=changed if not previous else max(changed, time.time()))
        state[key] = dict(seen); return state
    try: locked_json(limits_dir() / 'codex-auth.json', remember)
    except OSError: seen['changedAt'] = changed
    return {**result, 'changedAt': seen.get('changedAt', changed)}

def recent_codex_logs(limit=12):
    """Newest session logs first, walking only the latest YYYY/MM/DD folders."""
    found = []
    def walk(folder, depth):
        if len(found) >= limit: return
        try: entries = sorted(os.scandir(folder), key=lambda e: e.name, reverse=True)
        except OSError: return
        if depth == 3:
            files = []
            for entry in entries:
                try:
                    if entry.name.endswith('.jsonl') and entry.is_file(): files.append((entry.stat().st_mtime, pathlib.Path(entry.path)))
                except OSError: pass
            found.extend(sorted(files, reverse=True)); return
        for entry in entries:
            try:
                if entry.is_dir() and entry.name.isdigit(): walk(entry.path, depth + 1)
            except OSError: pass
    walk(home_for('codex') / 'sessions', 0)
    return sorted(found, reverse=True)[:limit]

def codex_log_limits(since=0):
    """Newest token_count.rate_limits in recent session logs, only when written after the last auth change.
    API-key threads log null rate limits, so an older ChatGPT snapshot never outlives a switch to an API key."""
    for mtime, file in recent_codex_logs():
        if mtime <= since: break
        try:
            with open(file, 'rb') as stream:
                stream.seek(0, 2); size = stream.tell(); stream.seek(max(0, size - 524288)); tail = stream.read()
        except OSError: continue
        for line in reversed(tail.splitlines()):
            if b'"token_count"' not in line or b'rate_limits' not in line: continue
            try: record = json.loads(line)
            except (ValueError, UnicodeError): continue
            payload = record.get('payload') if isinstance(record, dict) else None
            if not isinstance(payload, dict) or payload.get('type') != 'token_count': continue
            at = epoch(record.get('timestamp'))
            if not at or at <= since: break
            limits = payload.get('rate_limits')
            if limits is None: return None
            if isinstance(limits, dict) and limits.get('limit_id') not in (None, 'codex'): continue
            parsed = codex_limits(limits, at)
            if parsed: return {'limits': {**parsed[0], 'at': at, 'source': 'log'}, 'plan': parsed[1]}
    return None

CODEX_PROBE_INTERVAL = 300  # at most one short-lived app-server read per Codex home every 5 minutes
CODEX_LIVE_FRESH = 120      # a running chat's monitor refreshes about every minute
CODEX_PROBE_DEADLINE = 8    # seconds for the whole read, including start-up and shutdown

class StdioRPC:
    """JSON-RPC over a child's stdin/stdout (newline-delimited), with the same rpc() as WS."""
    def __init__(self, process, deadline):
        self.process = process; self.deadline = deadline; self.buffer = b''; self.counter = 0
    def line(self):
        import select
        while b'\n' not in self.buffer:
            remaining = self.deadline - time.monotonic()
            if remaining <= 0: raise TimeoutError('Agent request timed out')
            if not select.select([self.process.stdout], [], [], remaining)[0]: continue
            chunk = os.read(self.process.stdout.fileno(), 65536)
            if not chunk: raise EOFError()
            self.buffer += chunk
            if len(self.buffer) > 8000000: raise RuntimeError('Oversized agent message')
        line, self.buffer = self.buffer.split(b'\n', 1); return line
    def send(self, message):
        self.process.stdin.write((json.dumps(message) + '\n').encode()); self.process.stdin.flush()
    def rpc(self, method, params):
        self.counter += 1; number = self.counter; self.send({'id': number, 'method': method, 'params': params})
        while True:
            try: message = json.loads(self.line())
            except ValueError: continue
            if isinstance(message, dict) and message.get('id') == number:
                if 'error' in message: raise RuntimeError((message['error'] or {}).get('message', 'Agent request failed'))
                return message.get('result', {})

def codex_probe(auth, now=None):
    """With no running Codex chat feeding codex_limits_monitor, read the account and its limits from a
    short-lived `codex app-server` (stdio, no thread, so no session file and no model call), at most every
    CODEX_PROBE_INTERVAL per Codex home and never twice at once. Skipped without Codex, without a login,
    or on an API key. Stores the result where the live monitor does; returns True when it stored one."""
    now = time.time() if now is None else now; home = str(home_for('codex'))
    if auth.get('mode') != 'subscription': return False
    executable = shutil.which('codex')
    if not executable: return False
    live = (read(limits_dir() / 'codex.json', {}) or {}).get(home) or {}
    if isinstance(live, dict) and now - live.get('at', 0) < CODEX_LIVE_FRESH and live.get('at', 0) >= auth.get('changedAt', 0): return False
    limits_dir().mkdir(parents=True, exist_ok=True, mode=0o700)
    with open(limits_dir() / 'codex-probe.lock', 'a') as guard:
        os.chmod(guard.name, 0o600)
        try: fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError: return False  # another limits call is already reading
        try:
            stamps = read(limits_dir() / 'codex-probe.json', {}) or {}
            if not isinstance(stamps, dict): stamps = {}
            if now - stamps.get(home, 0) < CODEX_PROBE_INTERVAL: return False
            # Stamp before starting, so a failing or hanging Codex is also retried only every interval.
            stamps[home] = now; atomic(limits_dir() / 'codex-probe.json', stamps)
            state = codex_probe_read(executable)
            if not state.get('limits'): return False
            def save(value):
                value[home] = {**{key: state[key] for key in ('mode', 'plan', 'account', 'limits') if state.get(key)}, 'at': state['limits']['at']}; return value
            locked_json(limits_dir() / 'codex.json', save); return True
        finally: fcntl.flock(guard, fcntl.LOCK_UN)

def codex_probe_read(executable):
    """account/read and account/rateLimits/read on a private app-server, then stop it and its process group."""
    deadline = time.monotonic() + CODEX_PROBE_DEADLINE - 2; state = {}
    try: process = subprocess.Popen([executable, 'app-server'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True)
    except OSError: return state
    try:
        client = StdioRPC(process, deadline)
        client.rpc('initialize', {'clientInfo': {'name': 'harbor_limits', 'version': '0.3.0'}, 'capabilities': {'experimentalApi': True}}); client.send({'method': 'initialized'})
        state.update(codex_account(client))
        if state.get('mode') == 'subscription':
            response = client.rpc('account/rateLimits/read', {'excludeResetCreditDetails': True}) or {}
            parsed = codex_limits(response.get('rateLimits'))
            account = account_key('codex', response.get('accountId'))
            if account: state['account'] = account
            if parsed:
                state['limits'] = {**parsed[0], 'at': time.time(), 'source': 'live'}
                if parsed[1] and not state.get('plan'): state['plan'] = parsed[1]
    except (OSError, ValueError, EOFError, RuntimeError, TimeoutError): pass
    finally: stop_child(process)
    return state

def stop_child(process, grace=1.5):
    """Close stdin and let the child exit, then SIGTERM and SIGKILL its own process group, which
    start_new_session made (group ID = the child's PID, so never a name match or anyone else's process)."""
    def group_gone(wait):
        end = time.monotonic() + wait
        while True:
            process.poll()  # reap the child itself so it doesn't linger as a zombie group member
            try: os.killpg(process.pid, 0)
            except (ProcessLookupError, PermissionError): return True
            if time.monotonic() >= end: return False
            time.sleep(0.05)
    try: process.stdin.close()
    except OSError: pass
    try: process.wait(grace)
    except subprocess.TimeoutExpired: pass
    for signum in (signal.SIGTERM, signal.SIGKILL):
        if group_gone(0): break
        try: os.killpg(process.pid, signum)
        except (ProcessLookupError, PermissionError): break
        if group_gone(grace): break
    try: process.wait(grace)
    except subprocess.TimeoutExpired: pass
    try: process.stdout.close()
    except OSError: pass

def codex_host_limits():
    auth = codex_auth()
    try: codex_probe(auth)
    except OSError: pass
    live = (read(limits_dir() / 'codex.json', {}) or {}).get(str(home_for('codex'))) or {}
    if not isinstance(live, dict) or live.get('at', 0) < auth.get('changedAt', 0): live = {}
    result = {'agent': 'codex', 'mode': live.get('mode') or auth.get('mode') or 'unknown'}
    plan = live.get('plan'); account = live.get('account') or auth.get('account'); limits = live.get('limits')
    if result['mode'] != 'api' and not limits:
        log = codex_log_limits(auth.get('changedAt', 0))
        if log:
            limits = log['limits']; plan = plan or log['plan']
            if result['mode'] == 'unknown': result['mode'] = 'subscription'
    if result['mode'] == 'subscription':
        if plan: result['plan'] = plan
        if limits: result['limits'] = limits
    if account and result['mode'] != 'api': result['account'] = account
    return result

def claude_config():
    base = os.environ.get('CLAUDE_CONFIG_DIR')
    for file in ([pathlib.Path(base) / '.claude.json'] if base else [pathlib.Path.home() / '.claude.json']) + [home_for('claude') / '.config.json']:
        data = read(file, None)
        if isinstance(data, dict): return data
    return {}

def claude_settings(cwd=None):
    """The settings files Claude loads, lowest precedence first."""
    files = [home_for('claude') / 'settings.json']
    if cwd: files += [pathlib.Path(cwd) / '.claude' / 'settings.json', pathlib.Path(cwd) / '.claude' / 'settings.local.json']
    return [data for data in (read(file, None) for file in files) if isinstance(data, dict)]

def truthy(value):
    return str(value or '').strip().lower() not in ('', '0', 'false', 'no', 'off')

def claude_plan(environ=None, cwd=None):
    """Billing mode as Claude would decide it: cloud providers and API keys win over a claude.ai login.
    Reads only plan keys of the cached profile; never the OAuth token (on macOS it lives in the Keychain)."""
    environ = os.environ if environ is None else environ
    env = {key: environ[key] for key in (*API_ENV, *CLOUD_ENV) if environ.get(key)}
    helper = False
    for settings in claude_settings(cwd):
        helper = helper or bool(settings.get('apiKeyHelper'))
        overrides = settings.get('env') if isinstance(settings.get('env'), dict) else {}
        env.update({key: overrides[key] for key in (*API_ENV, *CLOUD_ENV) if key in overrides})
    for key, label in CLOUD_ENV.items():
        if truthy(env.get(key)): return {'mode': 'api', 'plan': label}
    if any(env.get(key) for key in API_ENV) or helper: return {'mode': 'api'}
    config = claude_config(); profile = config.get('oauthAccount')
    if isinstance(profile, dict):
        kind = str(profile.get('organizationType') or ''); billing = str(profile.get('billingType') or '')
        account = account_key('claude', profile.get('accountUuid'), profile.get('organizationUuid'))
        if kind.startswith('claude_') or 'subscription' in billing:
            result = {'mode': 'subscription', 'plan': claude_plan_name(kind, profile.get('organizationRateLimitTier') or profile.get('userRateLimitTier')), 'account': account}
            return {key: value for key, value in result.items() if value}
        if config.get('primaryApiKey'): return {'mode': 'api'}
        return {key: value for key, value in {'mode': 'unknown', 'account': account}.items() if value}
    credentials = read(home_for('claude') / '.credentials.json', {})
    oauth = credentials.get('claudeAiOauth') if isinstance(credentials, dict) else None
    kind, tier = (oauth.get('subscriptionType'), oauth.get('rateLimitTier')) if isinstance(oauth, dict) else (None, None)
    del credentials, oauth
    if kind: return {key: value for key, value in {'mode': 'subscription', 'plan': claude_plan_name(kind, tier)}.items() if value}
    if config.get('primaryApiKey'): return {'mode': 'api'}
    return {'mode': 'unknown'}

SAME_WINDOW = 120  # resetsAt within 2 minutes: the same limit window

def merge_limits(old, new):
    """Merge two snapshots window by window, so an idle chat's cached reading never overwrites a newer one:
    a later reset is a newer window; within the same window usage only grows, so the higher percentage
    wins; a window missing from one snapshot is kept from the other. Each window keeps its own time."""
    if not isinstance(old, dict) or not isinstance(old.get('windows'), list): return new
    if not isinstance(new, dict) or not isinstance(new.get('windows'), list): return old
    def windows(snapshot):
        return {w.get('windowMinutes'): {**w, 'at': w.get('at', snapshot.get('at', 0))} for w in snapshot['windows'] if isinstance(w, dict)}
    merged = windows(old)
    for key, window in windows(new).items():
        kept = merged.get(key)
        if not kept: merged[key] = window; continue
        a, b = kept.get('resetsAt'), window.get('resetsAt')
        if a and b and abs(a - b) > SAME_WINDOW: merged[key] = window if b > a else kept
        elif a and b: merged[key] = {**kept, 'usedPercent': max(kept['usedPercent'], window['usedPercent']), 'resetsAt': max(a, b), 'at': max(kept['at'], window['at'])}
        else: merged[key] = window if window['at'] >= kept['at'] else kept
    result = {**old, **new, 'windows': sorted(merged.values(), key=lambda w: w.get('windowMinutes') or 0)}
    result['at'] = max(w['at'] for w in result['windows']) if result['windows'] else max(old.get('at', 0), new.get('at', 0))
    return result

def reading_time(event, now):
    """When Claude last got a response in this chat: its transcript's mtime (never read), capped at now.
    Claude re-runs status lines in idle chats with the rate limits cached from that chat's last response,
    so the time the status line ran says nothing about how fresh they are."""
    path = event.get('transcript_path') if isinstance(event, dict) else None
    if isinstance(path, str) and path:
        try:
            info = os.stat(path)
            if stat.S_ISREG(info.st_mode): return min(info.st_mtime, now)
        except (OSError, ValueError): pass
    return now

def claude_host_limits():
    result = {'agent': 'claude', **claude_plan()}
    if result['mode'] == 'api': return result
    stored = read(limits_dir() / 'claude.json', {}) or {}
    prefix = str(home_for('claude')) + '|'
    candidates = [entry for key, entry in stored.items() if isinstance(entry, dict) and key.startswith(prefix) and (not result.get('account') or key in (prefix + result['account'], prefix))]
    limits = None
    for entry in candidates: limits = merge_limits(limits, entry.get('limits'))
    if limits and limits.get('windows'):
        result['limits'] = limits
        if result['mode'] == 'unknown': result['mode'] = 'subscription'
    return result

def host_limits():
    agents = []
    for agent, reader in (('codex', codex_host_limits), ('claude', claude_host_limits)):
        try: agents.append(reader())
        except Exception as error: agents.append({'agent': agent, 'mode': 'unknown', 'error': type(error).__name__})
    return {'agents': agents}

def store_claude_limits(chat_id, generation, event):
    """Merge the plan-limit reading from Claude's status line input into the chat's and the account's."""
    limits = event.get('rate_limits') if isinstance(event, dict) else None
    if not isinstance(limits, dict) or not UUID.match(chat_id) or not UUID.match(generation): return
    windows = [window for window in (limit_window((limits.get(name) or {}).get('used_percentage'), minutes, (limits.get(name) or {}).get('resets_at'))
                                     for name, minutes in (('five_hour', 300), ('seven_day', 10080)) if isinstance(limits.get(name), dict)) if window]
    if not windows: return
    now = time.time(); at = reading_time(event, now)
    snapshot = {'windows': [{**window, 'at': at} for window in windows], 'at': at, 'source': 'statusline'}
    file = ROOT / 'chats' / chat_id / 'metadata.json'; meta = read(file, {})
    if meta.get('generation') != generation: return
    previous = meta.get('limits') if isinstance(meta.get('limits'), dict) else None
    merged = merge_limits(previous, snapshot)
    billing = meta.get('billing') if isinstance(meta.get('billing'), dict) else {}
    if merged == previous and billing.get('mode') == 'subscription': return
    # A chat that reports plan limits is on a subscription, whatever its launch environment suggested.
    patch_metadata(file, generation, {'limits': merged, 'billing': {**billing, 'mode': 'subscription'}})
    key = str(home_for('claude')) + '|' + (billing.get('account') or '')
    def save(state):
        state = {k: v for k, v in state.items() if isinstance(v, dict) and now - v.get('at', 0) < 30 * 86400}
        combined = merge_limits((state.get(key) or {}).get('limits'), snapshot)
        if state.get(key, {}).get('limits') == combined: return None
        state[key] = {'limits': combined, 'at': combined['at']}; return state
    locked_json(limits_dir() / 'claude.json', save)

def user_statusline(project):
    """The status line Claude would run without Harbor's --settings: local, then project, then user settings."""
    for settings in reversed(claude_settings(project)):
        if 'statusLine' in settings: return settings['statusLine'] if isinstance(settings['statusLine'], dict) else None
    return None

def chainable(line):
    """Harbor only wraps a status line it can run exactly as Claude would (or none at all)."""
    if line is None: return True
    if not isinstance(line, dict) or line.get('type') != 'command' or not isinstance(line.get('command'), str) or not line['command'].strip(): return False
    if line.get('shell') not in (None, 'bash'): return False
    if 'args' in line and not (isinstance(line['args'], list) and all(isinstance(arg, str) for arg in line['args'])): return False
    return 'harbor_bridge' not in line['command'] and not re.search(r'bridge-[0-9a-f]{16}\.py', line['command'])

def statusline_settings(command, cwd):
    """Harbor's status line for --settings, carrying the user's own display options (padding, refreshInterval).
    None when the user's status line can't be run faithfully: then Harbor leaves it alone."""
    line = user_statusline(cwd)
    if not chainable(line): return None
    return {**{key: value for key, value in (line or {}).items() if key not in ('type', 'command', 'args', 'shell')}, 'type': 'command', 'command': command}

def statusline(chat_id, generation, stdin=None, stdout=None):
    """Record the rate-limit snapshot, then run the user's own status line with the same input,
    passing its output and exit code through. With no user status line, print nothing."""
    data = (stdin or sys.stdin.buffer).read(); project = None
    try:
        event = json.loads(data)
        if isinstance(event, dict):
            workspace = event.get('workspace') if isinstance(event.get('workspace'), dict) else {}
            project = workspace.get('project_dir') or event.get('cwd')
            store_claude_limits(chat_id, generation, event)
    except Exception: pass
    try: line = user_statusline(project if isinstance(project, str) else os.getcwd())
    except Exception: line = None
    if not line or not chainable(line): return 0
    shell = 'args' not in line
    child = subprocess.Popen(line['command'] if shell else [line['command'], *line['args']], shell=shell, stdin=subprocess.PIPE, stdout=stdout)
    def forward(signum, _frame):
        try: child.send_signal(signum)
        except OSError: pass
    for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP): signal.signal(signum, forward)
    try: child.communicate(data)
    except BrokenPipeError: child.wait()
    return child.returncode if child.returncode >= 0 else 128 - child.returncode

def codex_account(ws):
    """Billing mode and plan from the chat's own app server. The response's email is discarded."""
    try: account = (ws.rpc('account/read', {}) or {}).get('account')
    except (OSError, ValueError, EOFError, RuntimeError, TimeoutError, AttributeError): return {}
    if not isinstance(account, dict): return {'mode': 'unknown'}
    kind = account.get('type')
    if kind == 'chatgpt':
        plan = plan_name(account.get('planType'))
        return {'mode': 'subscription', **({'plan': plan} if plan else {})}
    if kind == 'amazonBedrock': return {'mode': 'api', 'plan': 'Bedrock'}
    return {'mode': 'api' if kind == 'apiKey' else 'unknown'}

def codex_limits_monitor(endpoint, stop, record):
    """A second app-server connection, so slow account calls never delay chat status. Reads the account
    every minute, rate limits when no other chat on this host refreshed them recently, and applies
    account/rateLimits/updated pushes in between."""
    ws = None; due = 0; state = {}
    def store():
        snapshot = dict(state)
        record({key: snapshot[key] for key in ('mode', 'plan', 'account') if snapshot.get(key)})
        if snapshot.get('mode') == 'subscription' and snapshot.get('limits'):
            def save(value):
                value[str(home_for('codex'))] = {**{key: snapshot[key] for key in ('mode', 'plan', 'account', 'limits') if snapshot.get(key)}, 'at': snapshot['limits']['at']}; return value
            try: locked_json(limits_dir() / 'codex.json', save)
            except OSError: pass
    def pushed(params):
        parsed = codex_limits((params or {}).get('rateLimits'))
        if parsed and parsed[0]['windows']:
            state['limits'] = {**parsed[0], 'at': time.time(), 'source': 'app-server'}
            if parsed[1]: state['plan'] = parsed[1]
            store()
    while not stop.is_set():
        try:
            if ws is None:
                ws = WS(endpoint); ws.listeners['account/rateLimits/updated'] = pushed; ws.initialize()
            if time.monotonic() >= due:
                due = time.monotonic() + 60
                info = codex_account(ws)
                if info.get('mode') and info['mode'] != 'subscription':
                    for key in ('plan', 'limits', 'account'): state.pop(key, None)
                state.update(info)
                shared = (read(limits_dir() / 'codex.json', {}) or {}).get(str(home_for('codex'))) or {}
                if state.get('mode') == 'subscription' and time.time() - shared.get('at', 0) >= 55:
                    try:
                        response = ws.rpc('account/rateLimits/read', {'excludeResetCreditDetails': True}) or {}
                        parsed = codex_limits(response.get('rateLimits'))
                        state['account'] = account_key('codex', response.get('accountId')) or state.get('account')
                        if parsed:
                            state['limits'] = {**parsed[0], 'at': time.time(), 'source': 'app-server'}
                            if parsed[1] and not state.get('plan'): state['plan'] = parsed[1]
                    except (RuntimeError, TimeoutError): pass
                elif state.get('mode') == 'subscription' and shared.get('account'):
                    state.setdefault('account', shared['account'])
                store()
            ws.wait(1)
        except (OSError, ValueError, EOFError, RuntimeError, TimeoutError):
            if ws:
                try: ws.sock.close()
                except OSError: pass
            ws = None; stop.wait(10)
    if ws:
        try: ws.sock.close()
        except OSError: pass

class WS:
    """Minimal bounded RFC6455 client on a private Unix socket (no network listener)."""
    def __init__(self, path):
        self.sock = socket.socket(socket.AF_UNIX); self.sock.settimeout(4); self.sock.connect(str(path)); self.pending = b''; self.counter = 0; self.listeners = {}
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
            if 'id' not in message: self.notify(message); continue
            if message.get('id') == number:
                if 'error' in message: raise RuntimeError(message['error'].get('message', 'Agent request failed'))
                return message.get('result', {})
        raise TimeoutError('Agent request timed out')
    def notify(self, message):
        listener = self.listeners.get(message.get('method'))
        if listener: listener(message.get('params'))
    def wait(self, seconds):
        """Deliver notifications that arrive within the given time."""
        import select
        deadline = time.monotonic() + seconds
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0: return
            if not self.pending and not select.select([self.sock], [], [], remaining)[0]: return
            message = self.receive()
            if isinstance(message, dict) and 'id' not in message: self.notify(message)
    def initialize(self):
        self.rpc('initialize', {'clientInfo': {'name': 'harbor_monitor', 'version': '0.3.0'}, 'capabilities': {'experimentalApi': True}}); self.send({'method':'initialized'})

def codex_activity(status):
    kind = status.get('type')
    if kind == 'systemError': return 'error', 'Codex reported a system error'
    if kind == 'active':
        flags = status.get('activeFlags', [])
        if 'waitingOnApproval' in flags: return 'attention', 'Approval requested'
        if 'waitingOnUserInput' in flags: return 'attention', 'Input requested'
        return 'working', ''
    if kind == 'idle': return 'idle', ''
    return 'unknown', 'Codex runtime status is unavailable'

def artifact_watch(task):
    # Claude flags artifact live-update watchers ambient, not activity: they wait indefinitely for comments or republishes.
    return str(task.get('description') or '').startswith('live updates for artifact ')

def running_background(event):
    tasks = event.get('background_tasks')
    return [t for t in tasks if isinstance(t, dict) and t.get('status', 'running') == 'running' and not artifact_watch(t)] if isinstance(tasks, list) else []

def background_reason(tasks, resumes=True):
    label = lambda t: str(t.get('description') or t.get('command') or t.get('agent_type') or t.get('type') or 'task').strip().splitlines()[0][:80]
    names = '; '.join(label(t) for t in tasks[:3]) + (f'; +{len(tasks)-3} more' if len(tasks) > 3 else '')
    noun = 'task' if resumes else 'terminal'
    count = f"{len(tasks)} background {noun}{'' if len(tasks) == 1 else 's'}"
    return (f'{count} running: {names}' if resumes else f'Turn finished; {count} still running: {names}')[:500]

def claude_background_idle(pid):
    # Background shells are direct children of claude; caffeinate is Claude's own sleep guard.
    try: rows = subprocess.check_output(['ps', '-A', '-o', 'pid=,ppid=,command='], text=True, timeout=5).splitlines()
    except (OSError, subprocess.SubprocessError): return False
    for row in rows:
        parts = row.split(None, 2)
        if len(parts) >= 2 and parts[1] == str(pid) and not (len(parts) > 2 and parts[2].split()[0].endswith('caffeinate')): return False
    return True

def claude_activity(event):
    kind = event.get('hook_event_name')
    activity = {'SessionStart':'idle','UserPromptSubmit':'working','PreToolUse':'working','PostToolUse':'working','PermissionRequest':'attention','Elicitation':'attention','ElicitationResult':'working','Stop':'idle','StopFailure':'error','SessionEnd':'closed'}.get(kind)
    reason = 'Approval requested' if kind == 'PermissionRequest' else 'Input requested' if kind == 'Elicitation' else ''
    if kind == 'PreToolUse' and event.get('tool_name') == 'AskUserQuestion': activity, reason = 'attention', 'Question requires your answer'
    if kind == 'StopFailure': reason = str(event.get('error_details') or event.get('error') or 'Claude could not complete its turn')[:500]
    if kind == 'Stop':
        pending = running_background(event)
        if pending: activity, reason = 'background', background_reason(pending)
    if kind == 'Notification':
        notification = event.get('notification_type')
        if notification == 'permission_prompt': activity, reason = 'attention', 'Approval requested'
        elif notification in ('elicitation_dialog','elicitation_url_dialog','agent_needs_input'): activity, reason = 'attention', 'Input requested'
        elif notification in ('idle_prompt','agent_completed'): activity = 'idle'
    return activity, reason

def run(args):
    chat = ROOT / 'chats' / args.chat; chat.mkdir(parents=True, exist_ok=True, mode=0o700)
    generation = args.generation; meta_file = chat / 'metadata.json'
    meta = {'generation': generation, 'launcher': args.agent, 'conversationId': args.resume, 'resumable': bool(args.resume), 'activity': 'starting', 'updatedAt': time.time(), 'cwd': os.getcwd(), **({'hasMessages':bool(args.fork)} if not args.resume else {}), **({'forkedFrom':args.fork} if args.fork else {})}
    atomic(meta_file, meta); stop = threading.Event(); server = None; terminal = None; ws = None
    def update(**values):
        if stop.is_set(): return
        previous = meta.get('activity'); meta.update(values); meta['updatedAt'] = time.time()
        if values.get('activity') in ('attention','error') and previous != values['activity']: meta['attentionAt'] = time.time()
        if values.get('activity') == 'idle' and previous in ('working','background'): meta['completedAt'] = time.time()
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
            server = subprocess.Popen(['codex', 'app-server', '--listen', 'unix://'+str(endpoint)] + codex_server_permissions(args.permission_mode), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
            for _ in range(160):
                if server.poll() is not None: raise RuntimeError('Codex app server could not start; check the installed agent version.')
                if endpoint.exists():
                    try: ws = WS(endpoint); ws.initialize(); break
                    except (OSError, RuntimeError): pass
                time.sleep(.1)
            if ws is None: raise RuntimeError('Timed out starting the Codex app server')
            command = ['codex'] + session_args('codex', args.resume, args.fork) + ['--remote', 'unix://'+str(endpoint)] + ([] if args.resume or args.fork else permission_args('codex', args.permission_mode))
            def monitor():
                while not stop.wait(1):
                    try:
                        ids = ws.rpc('thread/loaded/list', {})['data']
                        records = [ws.rpc('thread/read', {'threadId': i, 'includeTurns': False})['thread'] for i in ids]
                        record = codex_thread(records, meta.get('conversationId'), args.fork)
                        if not record: continue
                        activity, reason = codex_activity(record.get('status', {}))
                        if activity == 'idle':
                            try: terminals = ws.rpc('thread/backgroundTerminals/list', {'threadId': record['id']}).get('data') or []
                            except (RuntimeError, TimeoutError): terminals = []  # Older Codex without the experimental method.
                            # Codex does not resume the turn when these exit, so this is "finished, still running" rather than a pending wake-up.
                            if terminals: activity, reason = 'background', background_reason(terminals, resumes=False)
                        update(hasMessages=bool(record.get('preview')) or bool(meta.get('hasMessages')), conversationId=record['id'], name=title(record.get('name') or record.get('preview')), activity=activity, reason=reason, resumable=bool(args.resume or (record.get('path') and pathlib.Path(record['path']).exists())))
                    except (OSError, ValueError, EOFError, RuntimeError, KeyError): update(activity='unknown', reason='Codex runtime status could not be read')
            threading.Thread(target=monitor, daemon=True).start()
            threading.Thread(target=codex_limits_monitor, args=(endpoint, stop, lambda billing: update(billing=billing)), daemon=True).start()
        else:
            identity = args.resume or str(uuid.uuid4()); update(conversationId=identity)
            hook_command = 'python3 ' + __import__('shlex').quote(str(pathlib.Path(__file__).resolve())) + ' hook ' + args.chat + ' ' + generation
            events = ['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','PermissionRequest','Elicitation','ElicitationResult','Notification','Stop','StopFailure','SessionEnd']
            settings = {'hooks': {event: [{'hooks': [{'type': 'command', 'command': hook_command, 'timeout': 3}]}] for event in events}}
            # The pane's environment decides Claude's billing (an ANTHROPIC_API_KEY here beats the login), so record it at launch.
            try: update(billing=claude_plan(os.environ, os.getcwd()))
            except Exception: pass
            # Plan limits only reach status lines. Harbor's wraps the user's own, which it then runs unchanged.
            try: line = statusline_settings('python3 ' + __import__('shlex').quote(str(pathlib.Path(__file__).resolve())) + ' statusline ' + args.chat + ' ' + generation, os.getcwd())
            except Exception: line = None
            if line: settings['statusLine'] = line
            help_text = subprocess.check_output(['claude','--help'], text=True, timeout=15) if args.permission_mode == 'standard' else ''
            command = ['claude'] + session_args('claude', args.resume, args.fork, identity) + ['--settings', json.dumps(settings)] + permission_args('claude', args.permission_mode, help_text)
            def monitor():
                quiet_since = None
                while not stop.wait(2):
                    # A shell-only wait whose processes are gone (e.g. stopped from Claude's task list) will never produce another hook.
                    latest = read(meta_file, {})
                    if latest.get('activity') == 'background' and latest.get('backgroundKinds') == ['shell'] and terminal and claude_background_idle(terminal.pid):
                        quiet_since = quiet_since or time.time()
                        if time.time() - quiet_since >= 10: patch_metadata(meta_file, generation, {'activity':'idle','reason':'','completedAt':time.time(),'updatedAt':time.time()}); quiet_since = None
                    else: quiet_since = None
                    current = live_claude().get(identity, {})
                    records = history('claude', os.getcwd(), identity)
                    record = next((r for r in records if r['conversationId'] == identity), {})
                    patch = {'updatedAt': time.time()}
                    if record:
                        patch.update(name=record['name'], resumable=True)
                        if record.get('hasMessages') is not None: patch['hasMessages'] = record['hasMessages']
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
        kind = event.get('hook_event_name'); activity, reason = claude_activity(event)
        # Idle reminders arrive while Claude waits on background work; that wait is still pending.
        if kind == 'Notification' and activity == 'idle' and meta.get('activity') == 'background': activity, reason = 'background', meta.get('reason', '')
        if activity:
            if activity in ('attention','error'): meta['attentionAt'] = time.time()
            if kind == 'UserPromptSubmit': meta['hasMessages'] = True
            if kind == 'Stop' and activity == 'idle': meta['completedAt'] = time.time()
            if activity == 'background': meta['backgroundKinds'] = sorted({str(t.get('type') or 'task') for t in running_background(event)})
            if kind == 'Notification' and activity == 'idle' and not meta.get('completedAt'): meta['completedAt'] = time.time()
            meta.update(activity=activity, conversationId=event.get('session_id') or meta.get('conversationId'), updatedAt=time.time(), reason=reason)
            patch_metadata(file, generation, {key:meta[key] for key in ('activity','conversationId','updatedAt','reason','attentionAt','completedAt','hasMessages','backgroundKinds') if key in meta})
    except Exception: pass

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); sub = parser.add_subparsers(dest='action', required=True)
    launch = sub.add_parser('run'); launch.add_argument('agent', choices=['codex','claude']); launch.add_argument('chat'); launch.add_argument('generation'); launch.add_argument('--resume'); launch.add_argument('--fork'); launch.add_argument('--permission-mode', default='standard', choices=['standard','read-only','full-access','accept-edits','plan'])
    event = sub.add_parser('hook'); event.add_argument('chat'); event.add_argument('generation')
    status = sub.add_parser('statusline'); status.add_argument('chat'); status.add_argument('generation')
    sub.add_parser('limits')
    identification = sub.add_parser('identify'); identification.add_argument('agent', choices=['codex','claude']); identification.add_argument('pid', type=int)
    available = sub.add_parser('available'); available.add_argument('agent', choices=['codex','claude']); available.add_argument('identity')
    discovery = sub.add_parser('history'); discovery.add_argument('cwd')
    directories = sub.add_parser('directories'); directories.add_argument('path'); directories.add_argument('--hidden', action='store_true')
    preview_parser = sub.add_parser('preview'); preview_parser.add_argument('agent', choices=['codex','claude']); preview_parser.add_argument('cwd'); preview_parser.add_argument('identity')
    sub.add_parser('usage').add_argument('--prices')
    usage_parser = sub.add_parser('chat-usage'); usage_parser.add_argument('agent', choices=['codex','claude']); usage_parser.add_argument('cwd'); usage_parser.add_argument('identity'); usage_parser.add_argument('--prices')
    meta = sub.add_parser('metadata'); meta.add_argument('chats', nargs='+')
    args = parser.parse_args()
    if args.action == 'statusline': sys.exit(statusline(args.chat, args.generation))
    if args.action in ('run','hook') and (not UUID.match(args.chat) or not UUID.match(args.generation)): sys.exit(2)
    if args.action == 'run' and args.fork and (args.resume or not UUID.match(args.fork)): sys.exit(2)
    if args.action == 'run': sys.exit(run(args))
    elif args.action == 'hook': hook(args.chat, args.generation)
    elif args.action == 'identify': print(json.dumps({'conversationId': identify(args.agent,args.pid)}))
    elif args.action == 'directories': print(json.dumps(list_directories(args.path, args.hidden)))
    elif args.action == 'available':
        if not UUID.match(args.identity): sys.exit(2)
        print(json.dumps({'busy': conversation_busy(args.agent, args.identity)}))
    elif args.action == 'limits': print(json.dumps(host_limits()))
    elif args.action == 'usage': print(json.dumps(host_usage(read(pathlib.Path(args.prices), {}) if args.prices else {})))
    elif args.action == 'chat-usage': print(json.dumps(chat_usage(args.agent,args.cwd,args.identity,read(pathlib.Path(args.prices), {}) if args.prices else {})))
    elif args.action == 'preview': print(json.dumps(preview(args.agent,args.cwd,args.identity)))
    elif args.action == 'history':
        output = []; errors = []
        for agent in ('codex','claude'):
            try: output += history(agent, args.cwd)
            except Exception as error: errors.append(agent+': '+str(error))
        print(json.dumps({'conversations': output, 'errors': errors}))
    elif args.action == 'metadata': print(json.dumps({chat: read(ROOT/'chats'/chat/'metadata.json', {}) for chat in args.chats if UUID.match(chat)}))
