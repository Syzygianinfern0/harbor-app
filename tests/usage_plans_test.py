"""Plan detection, remaining limits and the Claude status line wrapper. Fake homes only."""
import fcntl, importlib.util, io, json, os, pathlib, signal, sys, tempfile, time, unittest
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('bridge', pathlib.Path(__file__).parents[1] / 'src/bridge/harbor_bridge.py')
bridge = importlib.util.module_from_spec(spec); spec.loader.exec_module(bridge)

CHAT = '11111111-1111-4111-8111-111111111111'
GEN = '22222222-2222-4222-8222-222222222222'

class Homes:
    """Throwaway HOME, CODEX_HOME, CLAUDE_CONFIG_DIR and Harbor state."""
    def __enter__(self):
        self.temp = tempfile.TemporaryDirectory(); d = pathlib.Path(self.temp.name)
        self.home, self.codex, self.claude, self.root = d / 'home', d / 'codex', d / 'claude', d / 'harbor'
        for folder in (self.home, self.codex, self.claude): folder.mkdir()
        self.patches = [patch.dict(os.environ, {'HOME': str(self.home), 'CODEX_HOME': str(self.codex), 'CLAUDE_CONFIG_DIR': str(self.claude)}), patch.object(bridge, 'ROOT', self.root), patch.object(bridge.shutil, 'which', return_value=None)]  # never a real Codex
        for item in self.patches: item.start()
        for key in (*bridge.API_ENV, *bridge.CLOUD_ENV): os.environ.pop(key, None)
        return self
    def __exit__(self, *_):
        for item in reversed(self.patches): item.stop()
        self.temp.cleanup()
    def write(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True); path.write_text(value if isinstance(value, str) else json.dumps(value)); return path

def token_count(stamp, limits):
    return {'timestamp': stamp, 'type': 'event_msg', 'payload': {'type': 'token_count', 'info': None, 'rate_limits': limits}}

SNAKE = {'limit_id': 'codex', 'plan_type': 'plus', 'primary': {'used_percent': 12.5, 'window_minutes': 300, 'resets_at': 1900000000}, 'secondary': {'used_percent': 44.0, 'window_minutes': 10080, 'resets_at': 1900300000}}

class PlanParsing(unittest.TestCase):
    def test_codex_snapshots_parse_from_app_server_and_logs(self):
        camel = {'planType': 'pro', 'primary': {'usedPercent': 62, 'windowDurationMins': 300, 'resetsAt': 1900000000}, 'secondary': None, 'rateLimitReachedType': None}
        limits, plan = bridge.codex_limits(camel)
        self.assertEqual(plan, 'Pro'); self.assertEqual(limits['windows'], [{'usedPercent': 62.0, 'windowMinutes': 300, 'resetsAt': 1900000000.0}])
        limits, plan = bridge.codex_limits(SNAKE)
        self.assertEqual(plan, 'Plus'); self.assertEqual([w['windowMinutes'] for w in limits['windows']], [300, 10080])
        # Old CLIs logged a relative reset time.
        limits, _ = bridge.codex_limits({'primary': {'used_percent': 5, 'window_minutes': 300, 'resets_in_seconds': 60}}, base=1000)
        self.assertEqual(limits['windows'][0]['resetsAt'], 1060)
        self.assertIsNone(bridge.codex_limits({'primary': None, 'secondary': None}))
        self.assertEqual(bridge.codex_limits({'primary': None, 'rateLimitReachedType': 'rate_limit_reached'})[0]['reached'], 'rate_limit_reached')
        self.assertEqual(bridge.limit_window(140)['usedPercent'], 100.0)
        self.assertIsNone(bridge.limit_window(True)); self.assertIsNone(bridge.limit_window(float('nan')))
        self.assertEqual(bridge.epoch('2030-03-17T17:46:40Z'), 1900000000.0); self.assertEqual(bridge.epoch(1900000000000), 1900000000.0)

    def test_account_keys_are_stable_hashes_never_raw_ids(self):
        key = bridge.account_key('claude', 'acct-raw-id', 'org-raw-id')
        self.assertRegex(key, r'^[0-9a-f]{16}$'); self.assertEqual(key, bridge.account_key('claude', 'acct-raw-id', 'org-raw-id'))
        self.assertNotEqual(key, bridge.account_key('codex', 'acct-raw-id', 'org-raw-id'))
        self.assertIsNone(bridge.account_key('codex', None, ''))

    def test_claude_plan_names(self):
        self.assertEqual(bridge.claude_plan_name('claude_max', 'default_claude_max_20x'), 'Max 20x')
        self.assertEqual(bridge.claude_plan_name('claude_pro', ''), 'Pro')
        self.assertEqual(bridge.claude_plan_name('team'), 'Team')
        self.assertIsNone(bridge.plan_name('unknown'))

class CodexLimits(unittest.TestCase):
    def test_api_key_mode_reports_no_limits_even_with_old_subscription_logs(self):
        with Homes() as h:
            h.write(h.codex / 'sessions/2026/09/01/rollout-a.jsonl', json.dumps(token_count('2026-09-01T00:00:00Z', SNAKE)))
            os.utime(h.codex / 'sessions/2026/09/01/rollout-a.jsonl', (1, 1))
            h.write(h.codex / 'auth.json', {'auth_mode': 'apikey', 'OPENAI_API_KEY': 'sk-test-not-real'})
            result = bridge.codex_host_limits()
            self.assertEqual(result, {'agent': 'codex', 'mode': 'api'})
            self.assertNotIn('sk-test', json.dumps(bridge.host_limits()))

    def test_subscription_falls_back_to_logs_newer_than_the_auth_change(self):
        with Homes() as h:
            auth = h.write(h.codex / 'auth.json', {'auth_mode': 'chatgpt', 'tokens': {'account_id': 'raw-account', 'access_token': 'secret-token'}})
            os.utime(auth, (1000, 1000))
            log = h.write(h.codex / 'sessions/2030/01/02/rollout-b.jsonl', '\n'.join(json.dumps(r) for r in [token_count('2030-01-02T00:00:00Z', SNAKE), token_count('2030-01-02T00:01:00Z', {**SNAKE, 'limit_id': 'other_model'})]))
            result = bridge.codex_host_limits()
            self.assertEqual((result['mode'], result['plan'], result['limits']['source']), ('subscription', 'Plus', 'log'))
            self.assertEqual(result['account'], bridge.account_key('codex', 'raw-account'))
            text = json.dumps(bridge.host_limits()); self.assertNotIn('raw-account', text); self.assertNotIn('secret-token', text)
            # A token refresh rewrites auth.json without changing the account: the log still counts.
            os.utime(auth, (time.time(), time.time()))
            self.assertIn('limits', bridge.codex_host_limits())
            # Switching to an API key is an auth change: older log snapshots no longer count.
            h.write(h.codex / 'auth.json', {'auth_mode': 'apikey', 'OPENAI_API_KEY': 'sk-test-not-real'})
            self.assertNotIn('limits', bridge.codex_host_limits())
            # A null rate_limits (an API-key thread) after the change ends the search.
            h.write(h.codex / 'auth.json', {'auth_mode': 'chatgpt', 'tokens': {'account_id': 'raw-account'}})
            time.sleep(0.01)
            log.write_text(json.dumps(token_count('2099-01-01T00:00:00Z', None)))
            self.assertNotIn('limits', bridge.codex_host_limits())

    def test_live_app_server_snapshot_wins_over_logs(self):
        with Homes() as h:
            h.write(h.codex / 'auth.json', {'auth_mode': 'chatgpt', 'tokens': {'account_id': 'raw-account'}})
            bridge.codex_auth()
            live = {'mode': 'subscription', 'plan': 'Pro', 'account': 'abcdef0123456789', 'limits': {'windows': [{'usedPercent': 90.0, 'windowMinutes': 300}], 'at': time.time() + 5, 'source': 'app-server'}}
            h.write(h.root / 'limits/codex.json', {str(h.codex): {**live, 'at': time.time() + 5}})
            result = bridge.codex_host_limits()
            self.assertEqual((result['plan'], result['account'], result['limits']['source']), ('Pro', 'abcdef0123456789', 'app-server'))

    def test_app_server_monitor_reads_account_and_limits_without_email(self):
        class FakeWS:
            def __init__(self, _endpoint): self.listeners = {}; self.sock = self
            def initialize(self): pass
            def close(self): pass
            def rpc(self, method, params):
                if method == 'account/read': return {'account': {'type': 'chatgpt', 'email': 'alice@example.invalid', 'planType': 'plus'}}
                return {'accountId': 'raw-account', 'rateLimits': {'primary': {'usedPercent': 30, 'windowDurationMins': 300, 'resetsAt': 1900000000}, 'secondary': None}}
            def wait(self, _seconds):
                self.listeners['account/rateLimits/updated']({'rateLimits': {'primary': {'usedPercent': 31, 'windowDurationMins': 300, 'resetsAt': 1900000000}}})
                stop.set()
        with Homes() as h, patch.object(bridge, 'WS', FakeWS):
            stop = bridge.threading.Event(); records = []
            bridge.codex_limits_monitor('unused', stop, records.append)
            self.assertEqual(records[-1], {'mode': 'subscription', 'plan': 'Plus', 'account': bridge.account_key('codex', 'raw-account')})
            stored = json.loads((h.root / 'limits/codex.json').read_text())[str(h.codex)]
            self.assertEqual(stored['limits']['windows'][0]['usedPercent'], 31.0)
            self.assertNotIn('alice', json.dumps(stored) + json.dumps(records)); self.assertNotIn('raw-account', json.dumps(stored))

# A stand-in `codex app-server` on stdio. It counts its launches, can leave a grandchild behind
# or hang, and answers the way a ChatGPT-plan account would, email and raw account ID included.
FAKE_CODEX = r"""#!%s
import json, os, subprocess, sys, time
here = os.path.dirname(os.path.abspath(__file__)); mode = open(os.path.join(here, 'mode')).read().strip()
with open(os.path.join(here, 'launches'), 'a') as f: f.write(' '.join(sys.argv[1:]) + '\n')
if mode in ('hang', 'orphan'):
    child = subprocess.Popen(['sleep', '60']); open(os.path.join(here, 'grandchild'), 'w').write(str(child.pid))
for line in sys.stdin:
    message = json.loads(line); method = message.get('method'); result = None
    if mode == 'hang': time.sleep(60)
    if method == 'initialize': result = {'userAgent': 'fake'}
    elif method == 'account/read': result = {'account': {'type': 'chatgpt', 'email': 'alice@example.invalid', 'planType': 'pro'}}
    elif method == 'account/rateLimits/read': result = {'accountId': 'raw-acct-id', 'rateLimits': {'primary': {'usedPercent': 37, 'windowDurationMins': 300, 'resetsAt': 1900000000}, 'secondary': None}}
    if 'id' in message: print(json.dumps({'id': message['id'], 'result': result}), flush=True)
""" % sys.executable

class CodexProbe(unittest.TestCase):
    def fake(self, h, mode='ok'):
        folder = h.root.parent / 'bin'; folder.mkdir(exist_ok=True)
        script = h.write(folder / 'codex', FAKE_CODEX); script.chmod(0o755); h.write(folder / 'mode', mode)
        h.patches.append(patch.object(bridge.shutil, 'which', return_value=str(script))); h.patches[-1].start()
        return folder
    def launches(self, folder):
        file = folder / 'launches'; return len(file.read_text().splitlines()) if file.exists() else 0
    def subscription(self, h):
        h.write(h.codex / 'auth.json', {'auth_mode': 'chatgpt', 'tokens': {'account_id': 'raw-account', 'access_token': 'secret-token'}})

    def test_reads_live_limits_from_a_short_lived_app_server_without_identifiers(self):
        with Homes() as h:
            self.subscription(h); folder = self.fake(h)
            result = bridge.codex_host_limits()
            self.assertEqual((result['mode'], result['plan'], result['limits']['source'], result['limits']['windows'][0]['usedPercent']), ('subscription', 'Pro', 'live', 37.0))
            self.assertEqual(result['account'], bridge.account_key('codex', 'raw-acct-id'))
            self.assertEqual((folder / 'launches').read_text().split(), ['app-server'])
            stored = (h.root / 'limits/codex.json').read_text() + json.dumps(bridge.host_limits())
            for secret in ('alice', 'raw-acct-id', 'raw-account', 'secret-token'): self.assertNotIn(secret, stored)
            # Fresh live data (a running chat or the last read) means no new app-server.
            bridge.codex_host_limits(); self.assertEqual(self.launches(folder), 1)

    def test_throttled_per_codex_home_and_never_concurrent(self):
        with Homes() as h:
            self.subscription(h); folder = self.fake(h); auth = bridge.codex_auth(); now = time.time()
            self.assertTrue(bridge.codex_probe(auth, now)); self.assertEqual(self.launches(folder), 1)
            later = now + bridge.CODEX_LIVE_FRESH + 1  # live data is stale, but the last read was recent
            self.assertFalse(bridge.codex_probe(auth, later)); self.assertEqual(self.launches(folder), 1)
            self.assertTrue(bridge.codex_probe(auth, now + bridge.CODEX_PROBE_INTERVAL + 1)); self.assertEqual(self.launches(folder), 2)
            with open(h.root / 'limits/codex-probe.lock', 'a') as guard:
                fcntl.flock(guard, fcntl.LOCK_EX)  # another limits call is mid-read
                self.assertFalse(bridge.codex_probe(auth, now + 10 * bridge.CODEX_PROBE_INTERVAL)); self.assertEqual(self.launches(folder), 2)

    def test_skipped_without_codex_login_or_on_an_api_key(self):
        with Homes() as h:
            folder = self.fake(h)
            bridge.codex_host_limits()  # no auth.json: no login
            h.write(h.codex / 'auth.json', {'auth_mode': 'apikey', 'OPENAI_API_KEY': 'sk-test-not-real'}); bridge.codex_host_limits()
            self.assertEqual(self.launches(folder), 0)
        with Homes() as h:
            self.subscription(h); self.assertNotIn('limits', bridge.codex_host_limits())  # Codex not installed

    def test_children_left_behind_by_the_app_server_are_stopped(self):
        with Homes() as h:
            self.subscription(h); folder = self.fake(h, 'orphan')
            self.assertTrue(bridge.codex_probe(bridge.codex_auth()))
            time.sleep(0.2)
            with self.assertRaises(ProcessLookupError): os.kill(int((folder / 'grandchild').read_text()), 0)

    def test_a_hanging_app_server_and_its_children_are_stopped_in_time(self):
        with Homes() as h:
            self.subscription(h); folder = self.fake(h, 'hang'); started = time.monotonic()
            self.assertFalse(bridge.codex_probe(bridge.codex_auth()))
            self.assertLess(time.monotonic() - started, bridge.CODEX_PROBE_DEADLINE + 4)
            grandchild = int((folder / 'grandchild').read_text())
            time.sleep(0.2)
            with self.assertRaises(ProcessLookupError): os.kill(grandchild, 0)
            # The failed attempt still counts toward the throttle.
            self.assertFalse(bridge.codex_probe(bridge.codex_auth())); self.assertEqual(self.launches(folder), 1)

class ClaudePlans(unittest.TestCase):
    def test_subscription_profile_and_overrides(self):
        with Homes() as h:
            h.write(h.claude / '.claude.json', {'oauthAccount': {'billingType': 'stripe_subscription', 'organizationType': 'claude_max', 'organizationRateLimitTier': 'default_claude_max_5x', 'accountUuid': 'raw-acct', 'organizationUuid': 'raw-org', 'emailAddress': 'alice@example.invalid'}})
            plan = bridge.claude_plan({})
            self.assertEqual((plan['mode'], plan['plan']), ('subscription', 'Max 5x')); self.assertRegex(plan['account'], r'^[0-9a-f]{16}$')
            self.assertNotIn('alice', json.dumps(bridge.host_limits())); self.assertNotIn('raw-acct', json.dumps(bridge.host_limits()))
            self.assertEqual(bridge.claude_plan({'ANTHROPIC_API_KEY': 'sk-ant-test'}), {'mode': 'api'})
            self.assertEqual(bridge.claude_plan({'CLAUDE_CODE_USE_BEDROCK': '1'}), {'mode': 'api', 'plan': 'Bedrock'})
            self.assertEqual(bridge.claude_plan({'CLAUDE_CODE_USE_VERTEX': '0'})['mode'], 'subscription')
            project = h.home / 'project'
            h.write(project / '.claude/settings.local.json', {'apiKeyHelper': '/bin/echo'})
            self.assertEqual(bridge.claude_plan({}, str(project)), {'mode': 'api'})
            h.write(h.claude / 'settings.json', {'env': {'CLAUDE_CODE_USE_VERTEX': 'true'}})
            self.assertEqual(bridge.claude_plan({})['plan'], 'Vertex')

    def test_linux_credentials_and_unknown(self):
        with Homes() as h:
            self.assertEqual(bridge.claude_plan({}), {'mode': 'unknown'})
            h.write(h.claude / '.credentials.json', {'claudeAiOauth': {'accessToken': 'secret-token', 'refreshToken': 'secret-refresh', 'subscriptionType': 'pro', 'rateLimitTier': 'default'}})
            self.assertEqual(bridge.claude_plan({}), {'mode': 'subscription', 'plan': 'Pro'})
            self.assertNotIn('secret', json.dumps(bridge.host_limits()))
            h.write(h.claude / '.claude.json', {'oauthAccount': {'organizationType': '', 'accountUuid': 'raw'}, 'primaryApiKey': 'sk-ant-test'})
            self.assertEqual(bridge.claude_plan({}), {'mode': 'api'})

    def test_status_line_snapshot_reaches_chat_and_host(self):
        with Homes() as h:
            h.write(h.claude / '.claude.json', {'oauthAccount': {'organizationType': 'claude_pro', 'accountUuid': 'raw-acct'}})
            account = bridge.claude_plan({})['account']
            meta = h.write(h.root / 'chats' / CHAT / 'metadata.json', {'generation': GEN, 'billing': {'mode': 'subscription', 'plan': 'Pro', 'account': account}})
            self.assertNotIn('limits', bridge.claude_host_limits())
            event = {'workspace': {'project_dir': str(h.home)}, 'rate_limits': {'five_hour': {'used_percentage': 38, 'resets_at': 1900000000}, 'seven_day': {'used_percentage': 61.5, 'resets_at': 1900300000}}}
            self.assertEqual(bridge.statusline(CHAT, GEN, io.BytesIO(json.dumps(event).encode())), 0)
            saved = json.loads(meta.read_text())
            self.assertEqual([w['usedPercent'] for w in saved['limits']['windows']], [38.0, 61.5]); self.assertEqual(saved['billing']['plan'], 'Pro')
            host = bridge.claude_host_limits()
            self.assertEqual(host['limits']['windows'][1]['windowMinutes'], 10080)
            # Another generation of the chat never takes the snapshot.
            bridge.store_claude_limits(CHAT, '33333333-3333-4333-8333-333333333333', {'rate_limits': {'five_hour': {'used_percentage': 99}}})
            self.assertEqual(json.loads(meta.read_text())['limits']['windows'][0]['usedPercent'], 38.0)

IDLE = '44444444-4444-4444-8444-444444444444'

class ClaudeReadings(unittest.TestCase):
    """Claude re-runs status lines in idle chats with the limits cached from their last response."""
    def chat(self, h, chat, account, transcript_age):
        h.write(h.root / 'chats' / chat / 'metadata.json', {'generation': GEN, 'billing': {'mode': 'subscription', 'account': account}})
        transcript = h.write(h.claude / 'projects' / (chat + '.jsonl'), '{}')
        os.utime(transcript, (time.time() - transcript_age,) * 2)
        return str(transcript)
    def windows(self):
        return {w['windowMinutes']: w for w in bridge.claude_host_limits()['limits']['windows']}

    def test_an_idle_chats_cached_reading_never_overwrites_a_fresh_one(self):
        with Homes() as h:
            h.write(h.claude / '.claude.json', {'oauthAccount': {'organizationType': 'claude_max', 'accountUuid': 'raw-acct'}}); account = bridge.claude_plan({})['account']
            fresh = self.chat(h, CHAT, account, 5); idle = self.chat(h, IDLE, account, 3 * 3600)
            bridge.store_claude_limits(CHAT, GEN, {'transcript_path': fresh, 'rate_limits': {'five_hour': {'used_percentage': 3, 'resets_at': 1900000000}, 'seven_day': {'used_percentage': 86, 'resets_at': 1900300000}}})
            # The idle chat's status line runs later, with an older reading that lacks the 5-hour window.
            bridge.store_claude_limits(IDLE, GEN, {'transcript_path': idle, 'rate_limits': {'seven_day': {'used_percentage': 80, 'resets_at': 1900300000}}})
            windows = self.windows()
            self.assertEqual((windows[300]['usedPercent'], windows[10080]['usedPercent']), (3.0, 86.0))
            self.assertLess(time.time() - windows[10080]['at'], 60); self.assertLess(time.time() - bridge.claude_host_limits()['limits']['at'], 60)
            # The idle chat's own record is timed by its transcript, so it reads as hours old.
            idle_limits = json.loads((h.root / 'chats' / IDLE / 'metadata.json').read_text())['limits']
            self.assertGreater(time.time() - idle_limits['at'], 3 * 3600 - 60)

    def test_a_newer_window_replaces_the_old_and_usage_only_grows_within_one(self):
        with Homes() as h:
            h.write(h.claude / '.claude.json', {'oauthAccount': {'organizationType': 'claude_max', 'accountUuid': 'raw-acct'}}); account = bridge.claude_plan({})['account']
            transcript = self.chat(h, CHAT, account, 0)
            store = lambda used, reset: bridge.store_claude_limits(CHAT, GEN, {'transcript_path': transcript, 'rate_limits': {'five_hour': {'used_percentage': used, 'resets_at': reset}}})
            store(91, 1900000000); store(40, 1900000060)  # same window, a stale lower copy: keep 91
            self.assertEqual(self.windows()[300]['usedPercent'], 91.0)
            store(2, 1900018000)  # the window reset: a later resetsAt is a newer window
            self.assertEqual((self.windows()[300]['usedPercent'], self.windows()[300]['resetsAt']), (2.0, 1900018000.0))
            store(95, 1900000000)  # a reading from the old window never comes back
            self.assertEqual(self.windows()[300]['usedPercent'], 2.0)
            meta = json.loads((h.root / 'chats' / CHAT / 'metadata.json').read_text())['limits']['windows']
            self.assertEqual([(w['usedPercent'], w['resetsAt']) for w in meta], [(2.0, 1900018000.0)])

    def test_bridges_from_an_older_harbor_cannot_flip_the_reading(self):
        """Chats launched before an update keep running their old bridge, which rewrites limits/claude.json
        and its chat's metadata wholesale with a cached reading stamped now and no per-window times."""
        def legacy_store(chat, account, limits):
            now = time.time(); snapshot = {'windows': limits, 'at': now, 'source': 'statusline'}
            bridge.patch_metadata(h.root / 'chats' / chat / 'metadata.json', GEN, {'limits': snapshot, 'billing': {'mode': 'subscription', 'account': account}})
            bridge.locked_json(h.root / 'limits/claude.json', lambda state: {**state, str(h.claude) + '|' + account: {'limits': snapshot, 'at': now}})
        with Homes() as h:
            h.write(h.claude / '.claude.json', {'oauthAccount': {'organizationType': 'claude_max', 'accountUuid': 'raw-acct'}}); account = bridge.claude_plan({})['account']
            fresh = self.chat(h, CHAT, account, 5); self.chat(h, IDLE, account, 3 * 3600)
            new = lambda: bridge.store_claude_limits(CHAT, GEN, {'transcript_path': fresh, 'rate_limits': {'five_hour': {'used_percentage': 3, 'resets_at': 1900000000}, 'seven_day': {'used_percentage': 86, 'resets_at': 1900300000}}})
            old = lambda: legacy_store(IDLE, account, [{'usedPercent': 80.0, 'windowMinutes': 10080, 'resetsAt': 1900300000.0}])
            for write in (new, old, new, old, old):
                write()
                windows = self.windows()
                self.assertEqual((windows[300]['usedPercent'], windows[10080]['usedPercent']), (3.0, 86.0))
            # Untimed windows merged into a known reading never look fresher or replace it.
            known = {'windows': [{'usedPercent': 40.0, 'windowMinutes': 60, 'at': time.time() - 900}], 'at': time.time() - 900}
            legacy = {'windows': [{'usedPercent': 10.0, 'windowMinutes': 60}], 'at': time.time()}
            for merged in (bridge.merge_limits(known, legacy), bridge.merge_limits(legacy, known)):
                self.assertEqual(merged['windows'], known['windows'])

    def test_reading_time_comes_from_the_transcript_without_reading_it(self):
        with Homes() as h:
            now = time.time(); file = h.write(h.claude / 't.jsonl', 'not json')
            os.utime(file, (now - 7200,) * 2); self.assertAlmostEqual(bridge.reading_time({'transcript_path': str(file)}, now), now - 7200, delta=1)
            os.utime(file, (now + 600,) * 2); self.assertEqual(bridge.reading_time({'transcript_path': str(file)}, now), now)  # capped
            for event in ({}, {'transcript_path': str(h.claude)}, {'transcript_path': str(h.claude / 'missing')}, {'transcript_path': 7}):
                self.assertEqual(bridge.reading_time(event, now), now)

class StatusLineChaining(unittest.TestCase):
    def run_line(self, h, event, stdout_path):
        with open(stdout_path, 'wb') as out:
            return bridge.statusline(CHAT, GEN, io.BytesIO(event), out)

    def test_runs_user_status_line_with_same_input_output_and_exit_code(self):
        with Homes() as h:
            h.write(h.claude / 'settings.json', {'statusLine': {'type': 'command', 'command': 'cat > "$HOME/seen.json"; printf "user line"; exit 3', 'padding': 2, 'refreshInterval': 5}})
            event = json.dumps({'workspace': {'project_dir': str(h.home / 'nowhere')}, 'model': {'id': 'x'}}).encode() + b'\n'
            out = h.home / 'out.txt'
            self.assertEqual(self.run_line(h, event, out), 3)
            self.assertEqual(out.read_bytes(), b'user line'); self.assertEqual((h.home / 'seen.json').read_bytes(), event)
            settings = bridge.statusline_settings('python3 bridge statusline', str(h.home))
            self.assertEqual(settings, {'padding': 2, 'refreshInterval': 5, 'type': 'command', 'command': 'python3 bridge statusline'})

    def test_no_user_status_line_prints_nothing(self):
        with Homes() as h:
            out = h.home / 'out.txt'
            self.assertEqual(self.run_line(h, b'{"rate_limits": null}', out), 0)
            self.assertEqual(out.read_bytes(), b'')
            self.assertEqual(bridge.statusline_settings('cmd', str(h.home)), {'type': 'command', 'command': 'cmd'})
            # Garbage input still never breaks the chain.
            self.assertEqual(self.run_line(h, b'not json', out), 0)

    def test_project_settings_take_precedence_and_exec_form_runs_directly(self):
        with Homes() as h:
            project = h.home / 'project'
            h.write(h.claude / 'settings.json', {'statusLine': {'type': 'command', 'command': 'printf user'}})
            h.write(project / '.claude/settings.json', {'statusLine': {'type': 'command', 'command': 'printf project'}})
            h.write(project / '.claude/settings.local.json', {'statusLine': {'type': 'command', 'command': sys.executable, 'args': ['-c', 'import sys; sys.stdout.write("local:" + str(len(sys.stdin.read())))']}})
            event = json.dumps({'workspace': {'project_dir': str(project)}}).encode()
            out = h.home / 'out.txt'
            self.assertEqual(self.run_line(h, event, out), 0)
            self.assertEqual(out.read_text(), 'local:' + str(len(event)))

    def test_status_lines_harbor_cannot_run_faithfully_are_left_alone(self):
        with Homes() as h:
            h.write(h.claude / 'settings.json', {'statusLine': {'type': 'command', 'command': 'Get-Date', 'shell': 'powershell'}})
            self.assertIsNone(bridge.statusline_settings('cmd', str(h.home)))
            h.write(h.claude / 'settings.json', {'statusLine': {'type': 'command', 'command': 'python3 ~/.local/share/harbor/bridge-0123456789abcdef.py statusline a b'}})
            self.assertIsNone(bridge.statusline_settings('cmd', str(h.home)))
            self.assertFalse(bridge.chainable({'type': 'other'})); self.assertTrue(bridge.chainable(None))

if __name__ == '__main__':
    unittest.main()
