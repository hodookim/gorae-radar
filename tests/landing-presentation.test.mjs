import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const base = new URL('../src/smart_money_radar/static/', import.meta.url);
const html = await readFile(new URL('index.html', base), 'utf8');
const source = await readFile(new URL('js/views/landing.js', base), 'utf8');
const context = vm.createContext({ document: { getElementById: () => null } });
vm.runInContext(source.replace(/^import .*;\r?\n/gm, '').replace(/export /g, ''), context);

test('promotion survives view replacement and identifies the separate Windows product', () => {
  assert.equal((html.match(/class="terminal-promo"/g) || []).length, 1);
  assert.ok(html.indexOf('class="terminal-promo"') < html.indexOf('<main id="app"'));
  assert.match(html, /운영자 프로젝트 · Windows 프로그램/);
  assert.match(html, /추천 가입 시 무료 제공 · 전략 엔진 지속 업데이트/);
  assert.match(html, /https:\/\/itsai-terminal.vercel.app\/\?utm_source=gorae_radar/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test('connection failure is not presented as no positions or no wallets', () => {
  assert.match(vm.runInContext('renderSignalRows(null)', context), /불러오지 못했습니다/);
  assert.match(vm.runInContext('renderWalletRows(null)', context), /불러오지 못했습니다/);
  assert.doesNotMatch(vm.runInContext('renderSignalRows(null)', context), /포지션이 없습니다/);
});

test('empty observed positions do not imply a long or short majority', () => {
  const pulse = vm.runInContext('renderHeroPulse({wallets: []}, null, null)', context);
  assert.match(pulse, /판단할 수 없습니다/);
  assert.doesNotMatch(pulse, /pulse-headline|exposure-balance|50%/);
});
