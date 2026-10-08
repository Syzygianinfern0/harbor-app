import test from 'node:test';
import { execFileSync } from 'node:child_process';
test('Python bridge permissions and empty-history detection',()=>{execFileSync('python3',['tests/bridge_test.py'],{stdio:'pipe'});});
test('Python bridge plan detection, limits and status line chaining',()=>{execFileSync('python3',['tests/usage_plans_test.py'],{stdio:'pipe'});});
