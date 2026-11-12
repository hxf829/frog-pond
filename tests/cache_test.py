#!/usr/bin/env python3
import functools
import http.server
import os
import shutil
import sys
import tempfile
import threading
import time
import urllib.request

import browser_test


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from server import NoCacheHandler


class QuietNoCacheHandler(NoCacheHandler):
    def log_message(self, *args):
        pass


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def start_server(directory):
    handler = functools.partial(QuietNoCacheHandler, directory=directory)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def wait_for(cdp, expression, message, timeout=25):
    deadline = time.time() + timeout
    last_error = None
    while time.time() < deadline:
        try:
            if cdp.eval(expression):
                return
        except (RuntimeError, TimeoutError) as error:
            last_error = error
        time.sleep(.1)
    raise AssertionError('%s: %s' % (message, last_error))


def check_headers():
    server = start_server(ROOT)
    try:
        base = 'http://127.0.0.1:%d' % server.server_address[1]
        for path in ('/index.html', '/style.css', '/game.js', '/frog-croak.mp3', '/sw.js', '/manifest.json'):
            request = urllib.request.Request(base + path, headers={
                'If-Modified-Since': 'Wed, 31 Dec 2099 23:59:59 GMT'
            })
            with urllib.request.urlopen(request) as response:
                check(response.status == 200, '%s 应重新返回文件' % path)
                check('no-store' in response.headers.get('Cache-Control', ''), '%s 缺少 no-store' % path)
                check(response.headers.get('Pragma') == 'no-cache', '%s 缺少 Pragma' % path)
                check(response.headers.get('Expires') == '0', '%s 缺少 Expires' % path)
    finally:
        server.shutdown()
        server.server_close()
    print('PASS: HTML 和游戏资源均返回禁止缓存的 HTTP 响应头')


def check_legacy_migration():
    with tempfile.TemporaryDirectory(prefix='frog-cache-test-') as directory:
        fixture = os.path.join(directory, 'site')
        profile = os.path.join(directory, 'profile')
        os.mkdir(fixture)
        os.mkdir(profile)
        for name in ('index.html', 'game.js', 'style.css', 'manifest.json', 'icon.svg', 'frog-croak.mp3'):
            shutil.copyfile(os.path.join(ROOT, name), os.path.join(fixture, name))
        with open(os.path.join(fixture, 'index.html'), 'w', encoding='utf-8') as page:
            page.write('''<!doctype html><title>Legacy Game</title><script>
              let controlled=!!navigator.serviceWorker.controller;
              navigator.serviceWorker.addEventListener('controllerchange',()=>{
                if(controlled) location.reload(); else controlled=true;
              });
              navigator.serviceWorker.register('sw.js');
            </script>''')
        with open(os.path.join(fixture, 'sw.js'), 'w', encoding='utf-8') as worker:
            worker.write('''const CACHE='frogpond-legacy';
              self.addEventListener('install',e=>e.waitUntil(
                caches.open(CACHE).then(c=>c.addAll(['./index.html'])).then(()=>self.skipWaiting())));
              self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
              self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request))));''')
        with open(os.path.join(fixture, 'other.js'), 'w', encoding='utf-8') as worker:
            worker.write('self.addEventListener("install",event=>event.waitUntil(self.skipWaiting()));')

        server = start_server(fixture)
        base = 'http://127.0.0.1:%d' % server.server_address[1]
        proc = None
        cdp = None
        try:
            proc, port = browser_test.start_chrome(profile)
            cdp = browser_test.CDP(browser_test.page_ws_url(port))
            for method in ('Page.enable', 'Runtime.enable', 'Network.enable'):
                cdp.call(method)
            cdp.call('Network.setBypassServiceWorker', {'bypass': False})
            cdp.call('Network.setCacheDisabled', {'cacheDisabled': False})
            cdp.call('Page.navigate', {'url': base + '/index.html'})
            wait_for(cdp, '!!navigator.serviceWorker && !!navigator.serviceWorker.controller',
                     '旧版 Service Worker 未接管页面')
            cdp.eval('''(async()=>{
              await caches.open('frogpond-orphan');
              await caches.open('other-app-cache');
              await navigator.serviceWorker.register('/other.js',{scope:'/other/'});
            })()''')
            check(cdp.eval("document.title === 'Legacy Game'"), '旧页面没有加载')

            shutil.copyfile(os.path.join(ROOT, 'index.html'), os.path.join(fixture, 'index.html'))
            shutil.copyfile(os.path.join(ROOT, 'sw.js'), os.path.join(fixture, 'sw.js'))
            cdp.call('Page.navigate', {'url': base + '/index.html'})
            wait_for(cdp, '''(async()=>{
              if(typeof state!=='object'||navigator.serviceWorker.controller) return false;
              const names=await caches.keys();
              const registrations=await navigator.serviceWorker.getRegistrations();
              return !names.some(name=>name.startsWith('frogpond-'))
                &&names.includes('other-app-cache')
                &&!registrations.some(r=>r.active&&r.active.scriptURL.endsWith('/sw.js'))
                &&registrations.some(r=>[r.active,r.waiting,r.installing].some(w=>w&&w.scriptURL.endsWith('/other.js')));
            })()''', '旧缓存或旧 Service Worker 没有清除，或其他应用的数据被清除')
            check(cdp.eval("document.querySelector('meta[http-equiv=\"Cache-Control\"]').content.includes('no-store')"),
                  '新页面缺少禁止缓存的 meta 标签')
            cdp.call('Page.reload')
            wait_for(cdp, '''(async()=>typeof state==='object'&&!navigator.serviceWorker.controller
              &&!(await caches.keys()).some(name=>name.startsWith('frogpond-')))()''',
              '刷新后重新启用了游戏缓存')
            print('PASS: 旧 Service Worker 和游戏缓存自动清除，其他应用数据保留')
        finally:
            if cdp:
                try:
                    cdp.call('Browser.close', timeout=3)
                except Exception:
                    pass
                cdp.ws.close()
            if proc:
                try:
                    proc.wait(timeout=5)
                except Exception:
                    proc.kill()
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    check_headers()
    check_legacy_migration()
