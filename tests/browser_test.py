#!/usr/bin/env python3
"""Frog Pond 浏览器回归测试（只用 Python 标准库）。

做法：
  * 在临时目录建 Chrome profile，启动 headless Chrome（默认沙箱，--remote-debugging-port=0）；
  * 用标准库 socket 手写一个最小的 WebSocket / CDP 客户端；
  * 用 http.server 在本地随机端口托管项目根目录（tests/ 的上一级，可用 FROG_ROOT 覆盖）；
  * 通过 Input.dispatchMouseEvent / Input.dispatchTouchEvent 做真实点按、拖动，
    通过 Runtime.evaluate 读取 game.js 的顶层 lexical state（state / LEVELS / ops）做断言；
  * 横屏(1024x768, 鼠标) 与竖屏(768x1024, 触摸) 两种视口各跑一遍；
  * 任何 console.error / 未捕获异常 / 失败的资源请求都算失败；
  * 结束时关闭 Chrome、HTTP 服务器并删除临时 profile。

用法：  python3 tests/browser_test.py [-k 名称关键字]
环境变量 CHROME 可覆盖 Chrome 路径。退出码 0 = 全部通过。
"""
import base64
import functools
import http.server
import json
import os
import select
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get("FROG_ROOT") or os.path.dirname(HERE)
CHROME = os.environ.get(
    "CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")


# --------------------------------------------------------------------------
# 最小 WebSocket 客户端 + CDP
# --------------------------------------------------------------------------
class WS:
    def __init__(self, url):
        assert url.startswith("ws://")
        hostport, _, path = url[5:].partition("/")
        host, _, port = hostport.partition(":")
        self.sock = socket.create_connection((host, int(port)), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((
            "GET /%s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\n"
            "Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n" % (path, hostport, key)).encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise RuntimeError("websocket handshake failed")
            buf += chunk
        head, _, rest = buf.partition(b"\r\n\r\n")
        if b" 101 " not in head.split(b"\r\n")[0]:
            raise RuntimeError("websocket handshake refused: %r" % head)
        self.buf = rest

    def _recv_exact(self, n, timeout):
        while len(self.buf) < n:
            r, _, _ = select.select([self.sock], [], [], timeout)
            if not r:
                return None
            chunk = self.sock.recv(1 << 20)
            if not chunk:
                raise RuntimeError("websocket closed")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def send(self, text):
        data = text.encode()
        n = len(data)
        hdr = bytearray([0x81])
        if n < 126:
            hdr.append(0x80 | n)
        elif n < 65536:
            hdr.append(0x80 | 126)
            hdr += struct.pack(">H", n)
        else:
            hdr.append(0x80 | 127)
            hdr += struct.pack(">Q", n)
        mask = os.urandom(4)
        hdr += mask
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
        self.sock.sendall(bytes(hdr) + masked)

    def recv(self, timeout):
        """返回一条完整文本消息；超时返回 None。"""
        payload = b""
        while True:
            h = self._recv_exact(2, timeout)
            if h is None:
                return None
            fin, opcode = h[0] & 0x80, h[0] & 0x0F
            n = h[1] & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._recv_exact(2, 10))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._recv_exact(8, 10))[0]
            data = self._recv_exact(n, 10) if n else b""
            if opcode == 8:
                raise RuntimeError("websocket closed by peer")
            if opcode == 9:
                continue
            if opcode in (0, 1, 2):
                payload += data
                if fin:
                    return payload.decode()

    def close(self):
        try:
            self.sock.close()
        except Exception:
            pass


class CDP:
    def __init__(self, ws_url):
        self.ws = WS(ws_url)
        self.next_id = 0
        self.events = []
        self.errors = []        # 控制台错误 / 异常 / 资源失败

    def _on_event(self, msg):
        self.events.append(msg)
        m, p = msg.get("method"), msg.get("params", {})
        if m == "Runtime.exceptionThrown":
            d = p["exceptionDetails"]
            text = (d.get("exception") or {}).get("description") or d.get("text")
            self.errors.append("exception: %s" % text)
        elif m == "Runtime.consoleAPICalled" and p.get("type") in ("error", "assert"):
            args = " ".join(str(a.get("value", a.get("description", ""))) for a in p.get("args", []))
            self.errors.append("console.error: %s" % args)
        elif m == "Log.entryAdded" and p["entry"].get("level") == "error":
            e = p["entry"]
            if "favicon" in (e.get("url") or "") or "favicon" in e.get("text", ""):
                return
            self.errors.append("log.error: %s %s" % (e.get("text"), e.get("url", "")))

    def pump(self, seconds):
        """读取消息 seconds 秒（期间收集事件）。"""
        end = time.time() + seconds
        while True:
            left = end - time.time()
            if left <= 0:
                return
            raw = self.ws.recv(left)
            if raw is None:
                return
            msg = json.loads(raw)
            if "id" not in msg:
                self._on_event(msg)

    def call(self, method, params=None, timeout=30):
        self.next_id += 1
        mid = self.next_id
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        end = time.time() + timeout
        while True:
            left = end - time.time()
            if left <= 0:
                raise TimeoutError("CDP timeout: " + method)
            raw = self.ws.recv(left)
            if raw is None:
                continue
            msg = json.loads(raw)
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError("CDP %s: %s" % (method, msg["error"]))
                return msg.get("result", {})
            if "id" not in msg:
                self._on_event(msg)

    def eval(self, expr):
        r = self.call("Runtime.evaluate", {
            "expression": expr, "returnByValue": True, "awaitPromise": True})
        if "exceptionDetails" in r:
            d = r["exceptionDetails"]
            raise RuntimeError("JS error: %s | %s" % (
                (d.get("exception") or {}).get("description") or d.get("text"), expr[:160]))
        return r["result"].get("value")


# --------------------------------------------------------------------------
# 本地 HTTP 服务器 / Chrome 进程
# --------------------------------------------------------------------------
class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def start_server():
    handler = functools.partial(QuietHandler, directory=ROOT)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def start_chrome(profile):
    proc = subprocess.Popen([
        CHROME, "--headless=new", "--remote-debugging-port=0",
        "--user-data-dir=" + profile, "--no-first-run",
        "--no-default-browser-check", "--mute-audio", "--disable-extensions", "--disable-gpu",
        "--disable-background-networking", "--window-size=1024,768", "about:blank",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    port_file = os.path.join(profile, "DevToolsActivePort")
    for _ in range(150):
        if proc.poll() is not None:
            raise RuntimeError("Chrome exited early (code %s)" % proc.returncode)
        if os.path.exists(port_file):
            lines = open(port_file).read().split("\n")
            if lines and lines[0].isdigit():
                return proc, int(lines[0])
        time.sleep(0.1)
    proc.kill()
    raise RuntimeError("Chrome did not start")


def page_ws_url(port):
    for _ in range(50):
        try:
            tabs = json.load(urllib.request.urlopen("http://127.0.0.1:%d/json" % port, timeout=3))
            for t in tabs:
                if t.get("type") == "page":
                    return t["webSocketDebuggerUrl"]
        except Exception:
            pass
        time.sleep(0.1)
    raise RuntimeError("no page target")


# --------------------------------------------------------------------------
# 测试驱动
# --------------------------------------------------------------------------
class Fail(AssertionError):
    pass


def check(cond, msg):
    if not cond:
        raise Fail(msg)


class Browser:
    def __init__(self, cdp, base_url, viewport):
        self.c = cdp
        self.base = base_url
        self.vp = viewport

    def setup(self):
        c, vp = self.c, self.vp
        for m in ("Page.enable", "Runtime.enable", "Log.enable", "Network.enable"):
            c.call(m)
        c.call("Network.setBypassServiceWorker", {"bypass": True})
        c.call("Network.setCacheDisabled", {"cacheDisabled": True})
        c.call("Emulation.setDeviceMetricsOverride", {
            "width": vp["width"], "height": vp["height"],
            "deviceScaleFactor": 2 if vp["mobile"] else 1, "mobile": vp["mobile"]})
        c.call("Emulation.setTouchEmulationEnabled", {"enabled": vp["mobile"], "maxTouchPoints": 5})

    def load(self, level=0, speed=None):
        """全新加载页面，可选直接进入某关（通过下拉框）与加快自动运行节奏。"""
        c = self.c
        c.events.clear()
        c.call("Page.navigate", {"url": self.base + "/index.html?t=%f" % time.time()})
        for _ in range(100):
            if self.eval("document.readyState === 'complete' && typeof state === 'object'"):
                break
            time.sleep(0.1)
        else:
            raise Fail("page load timeout")
        check(self.eval("typeof state === 'object' && typeof LEVELS === 'object'"),
              "game.js 的 state / LEVELS 不可读")
        if level:
            self.set_level(level)
        if speed:
            self.eval("state.speed = %s" % speed)   # 只加快自动运行节奏
        self.sleep(0.15)

    def set_level(self, n):
        """像用户一样操作下拉框：改 value 并触发 change。"""
        self.eval("(()=>{const s=document.querySelector('#modeSelect');"
                  "s.value='%d';s.dispatchEvent(new Event('change',{bubbles:true}));})()" % n)

    def eval(self, e):
        return self.c.eval(e)

    def sleep(self, s):
        self.c.pump(s)

    def wait_for(self, expr, timeout=10, msg=None):
        end = time.time() + timeout
        while time.time() < end:
            if self.eval(expr):
                return
            self.sleep(0.1)
        raise Fail(msg or ("等待超时: " + expr))

    # ---- 指针（桌面=鼠标；手机=触摸）----
    def _ptr(self, kind, x, y):
        c = self.c
        if self.vp["mobile"]:
            t = {"down": "touchStart", "move": "touchMove", "up": "touchEnd"}[kind]
            pts = [] if kind == "up" else [{"x": x, "y": y, "id": 1}]
            c.call("Input.dispatchTouchEvent", {"type": t, "touchPoints": pts})
        else:
            t = {"down": "mousePressed", "move": "mouseMoved", "up": "mouseReleased"}[kind]
            c.call("Input.dispatchMouseEvent", {
                "type": t, "x": x, "y": y, "button": "left",
                "buttons": 0 if kind == "up" else 1, "clickCount": 0 if kind == "move" else 1})

    def tap(self, x, y):
        if not self.vp["mobile"]:
            self.c.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y})
        self._ptr("down", x, y)
        self.sleep(0.03)
        self._ptr("up", x, y)
        self.sleep(0.05)

    def drag(self, p0, p1, steps=8):
        if not self.vp["mobile"]:
            self.c.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": p0[0], "y": p0[1]})
        self._ptr("down", *p0)
        self.sleep(0.03)
        for i in range(1, steps + 1):
            x = p0[0] + (p1[0] - p0[0]) * i / steps
            y = p0[1] + (p1[1] - p0[1]) * i / steps
            self._ptr("move", x, y)
            self.sleep(0.02)
        self._ptr("up", *p1)
        self.sleep(0.1)

    # ---- DOM 辅助 ----
    def center(self, sel, nth=0, scroll=True):
        js = """(()=>{const els=document.querySelectorAll(%s);const e=els[%d];
          if(!e) return null;
          if(%s) e.scrollIntoView({block:'center',inline:'center'});
          const r=e.getBoundingClientRect();
          return {x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height,
                  l:r.left,t:r.top,r:r.right,b:r.bottom}})()""" % (
            json.dumps(sel), nth, "true" if scroll else "false")
        r = self.eval(js)
        if r is None:
            raise Fail("找不到元素 %s[%d]" % (sel, nth))
        return r

    def assert_hittable(self, sel, nth=0):
        r = self.center(sel, nth)
        check(r["w"] > 0 and r["h"] > 0, "%s 尺寸为 0" % sel)
        vw, vh = self.vp["width"], self.vp["height"]
        check(r["l"] >= -1 and r["r"] <= vw + 1 and r["t"] >= -1 and r["b"] <= vh + 1,
              "%s 不在视口内: %s (视口 %dx%d)" % (sel, r, vw, vh))
        ok = self.eval("""(()=>{const e=document.querySelectorAll(%s)[%d];
          const h=document.elementFromPoint(%f,%f);return !!h&&(e===h||e.contains(h))})()"""
                       % (json.dumps(sel), nth, r["x"], r["y"]))
        check(ok, "%s 的中心点被别的元素挡住了" % sel)
        return r

    def click(self, sel, nth=0):
        r = self.assert_hittable(sel, nth)
        self.tap(r["x"], r["y"])

    def click_text(self, sel, text):
        idx = self.eval("[...document.querySelectorAll(%s)].findIndex(e=>e.textContent.trim()===%s)"
                        % (json.dumps(sel), json.dumps(text)))
        check(idx >= 0, "没有文字为 %r 的 %s" % (text, sel))
        self.click(sel, idx)

    def add(self, *keys):
        for k in keys:
            self.click('.pal[data-block="%s"]' % k)

    # ---- 游戏状态读取 ----
    def keys(self):
        return self.eval("""(()=>{const f=l=>l.map(c=>c.children?
           {k:c.key,c:c.children.map(x=>x.key),e:(c.elseChildren||[]).map(x=>x.key),
            n:c.count ?? null,cond:c.cond ?? null,hasElse:!!c.hasElse}:c.key);return f(state.program)})()""")

    def flat(self):
        return self.eval("state.program.map(c=>c.key)")

    def frog(self, i=0):
        return self.eval("(f=>f&&({q:f.q,r:f.r,dir:f.dir,pc:f.pc}))(state.frogs[%d])" % i)

    def overlay_visible(self):
        return self.eval("!document.querySelector('#overlay').classList.contains('hidden')")

    def toast(self):
        return self.eval("document.querySelector('#toast').textContent")

    def targets_left(self):
        return self.eval("state.beetles.filter(b=>b.target&&b.alive).length")


# --------------------------------------------------------------------------
# 测试用例
# --------------------------------------------------------------------------
TESTS = []
OVERLAY_SHOWN = "!document.querySelector('#overlay').classList.contains('hidden')"


def test(fn):
    TESTS.append(fn)
    return fn


@test
def layout_and_boot(b):
    """页面加载、无滚动溢出、关键控件在视口内且可点击、唯一一只青蛙"""
    b.load()
    check(b.eval("state.level") == 0, "默认应是自由池塘(level 0)")
    check(b.eval("document.querySelector('#modeSelect').value") == "0", "下拉框应显示自由池塘")
    check(b.eval("document.documentElement.scrollWidth <= window.innerWidth + 1"), "页面出现横向滚动")
    check(b.eval("document.documentElement.scrollHeight <= window.innerHeight + 1"), "页面出现纵向滚动")
    check(not b.overlay_visible(), "启动后不应有遮罩挡住操作")
    cv = b.center("#pond", scroll=False)
    check(cv["w"] > 150 and cv["h"] > 150, "池塘画布太小: %s" % cv)
    check(b.eval("hexR > 8"), "六边形半径异常: %s" % b.eval("hexR"))
    check(b.eval("CELLS.every(c=>{const p=cellCenter(c.q,c.r);return p.x>0&&p.x<W&&p.y>0&&p.y<H})"),
          "有荷叶画到了画布外")
    for sel in ['.pal[data-block="hop"]', '.pal[data-block="repeat"]', "#btnRun", "#btnStep",
                "#btnUndo", "#btnClear", "#btnReset", "#modeSelect"]:
        b.assert_hittable(sel)
    check(b.eval("document.querySelectorAll('.pal[data-block]').length") == 8, "调色板应有 8 张卡片")
    check(b.eval("!document.querySelector('[data-block=hatch]')"), "不应再有「孵」按钮")
    check(b.eval("state.frogs.length") == 1, "自由池塘应只有一只青蛙")


@test
def leaf_routes_match_pond(b):
    """荷叶路线：大荷叶容纳更多路径，较宽水面不可跳，所有关卡可走通"""
    b.load()
    result = b.eval("""(()=>{
      const counts=LEAVES.map(leaf=>CELLS.filter(c=>leafContains(leaf,c.q,c.r)).length);
      const variation=LEAVES.map(leaf=>{
        const radii=Array.from({length:36},(_,index)=>leafEdgeScale(leaf,index*Math.PI/18));
        return Math.max(...radii)-Math.min(...radii);
      });
      let shapeMismatches=0;
      ctx.save(); ctx.setTransform(1,0,0,1,0,0);
      for(const leaf of LEAVES){
        leafPath(0,0,leaf.radius*100,leaf);
        const angles=[...Array.from({length:36},(_,index)=>index*Math.PI/18),leaf.notch];
        for(const angle of angles) for(const fraction of [.3,.6,.85,.97,1.04]){
          const distance=leaf.radius*leafEdgeScale(leaf,angle)*fraction;
          const x=distance*Math.cos(angle),y=distance*Math.sin(angle);
          const r=leaf.r+y/1.5,q=leaf.q+x/Math.sqrt(3)-(r-leaf.r)/2;
          if(ctx.isPointInPath(x*100,y*100)!==leafCoversPoint(leaf,q,r)) shapeMismatches++;
        }
      }
      ctx.restore();
      const overlaps=[];
      for(let first=0;first<LEAVES.length;first++) for(let second=first+1;second<LEAVES.length;second++){
        const [small,other]=[LEAVES[first],LEAVES[second]].sort((a,b)=>a.radius-b.radius);
        const x=Math.sqrt(3)*(small.q+small.r/2), y=1.5*small.r, radius=small.radius*LEAF_MAX_SCALE;
        const ox=Math.sqrt(3)*(other.q+other.r/2), oy=1.5*other.r;
        if(Math.hypot(x-ox,y-oy)>(small.radius+other.radius)*LEAF_MAX_SCALE) continue;
        let inside=0,shared=0;
        for(let row=0;row<48;row++) for(let column=0;column<48;column++){
          const px=x-radius+2*radius*(column+.5)/48, py=y-radius+2*radius*(row+.5)/48;
          const r=py/1.5, q=px/Math.sqrt(3)-r/2;
          if(leafCoversPoint(small,q,r)){inside++;if(leafCoversPoint(other,q,r)) shared++;}
        }
        if(shared) overlaps.push(shared/inside);
      }
      const triangles=LEAVES.map(leaf=>CELLS.reduce((total,c)=>{
        if(!leafContains(leaf,c.q,c.r)) return total;
        return total+DIRS.filter((dir,index)=>{
          const next=DIRS[(index+1)%DIRS.length];
          const a={q:c.q+dir.dq,r:c.r+dir.dr}, b={q:c.q+next.dq,r:c.r+next.dr};
          return isCell(a.q,a.r)&&isCell(b.q,b.r)&&leafContains(leaf,a.q,a.r)
            &&leafContains(leaf,b.q,b.r)&&ROUTES.has(routeKey(c.q,c.r,a.q,a.r))
            &&ROUTES.has(routeKey(c.q,c.r,b.q,b.r))&&ROUTES.has(routeKey(a.q,a.r,b.q,b.r));
        }).length;
      },0)/3);
      const covered=CELLS.every(c=>LEAVES.some(leaf=>leafContains(leaf,c.q,c.r)));
      const levels=LEVELS.map(level=>{
        const blocked=new Set(level.holes.map(h=>cellKey(...h)));
        const start=level.frogs[0], seen=new Set([cellKey(start.q,start.r)]), queue=[start];
        while(queue.length){const p=queue.shift();for(const dir of DIRS){
          const q=p.q+dir.dq,r=p.r+dir.dr,key=cellKey(q,r);
          if(isCell(q,r)&&!blocked.has(key)&&!seen.has(key)
            &&ROUTES.has(routeKey(p.q,p.r,q,r))){seen.add(key);queue.push({q,r});}
        }}
        return isCell(start.q,start.r)&&level.holes.every(([q,r])=>isCell(q,r))
          &&level.beetles.every(([q,r])=>seen.has(cellKey(q,r)))
          &&CELLS.every(c=>blocked.has(cellKey(c.q,c.r))||seen.has(cellKey(c.q,c.r)));
      });
      const edge=CELLS.flatMap(c=>DIRS.map((d,dir)=>({q:c.q,r:c.r,dir,
        nextQ:c.q+d.dq,nextR:c.r+d.dr}))).find(p=>isCell(p.nextQ,p.nextR)
          &&!canHop(p.q,p.r,p.nextQ,p.nextR));
      if(edge) edge.gap=routeWaterGap(edge.q,edge.r,edge.nextQ,edge.nextR);
      return {counts,variation,shapeMismatches,overlaps,triangles,covered,levels,edge};})()""")
    check(result["covered"] and min(result["counts"]) <= 2 and max(result["counts"]) >= 10
          and max(result["triangles"]) >= 10,
          "落脚点必须在大小不同的荷叶上: %s" % result)
    check(min(result["variation"]) > .05, "荷叶边缘应有自然变化: %s" % result["variation"])
    check(result["shapeMismatches"] == 0, "路线判断应与荷叶实际轮廓一致: %s" % result)
    check(result["overlaps"] and max(result["overlaps"]) < .12,
          "荷叶边缘应有少量重叠，而不是相互覆盖: %s" % result["overlaps"])
    check(all(result["levels"]), "每个关卡的荷叶路线都应连通: %s" % result)
    edge = result["edge"]
    check(edge is not None and edge["gap"] > .3, "相邻荷叶间应有不能跳过的较宽水面")
    b.eval("Object.assign(state.frogs[0],%s)" % json.dumps(edge))
    check(b.eval("testCond(state.frogs[0], 'water')"), "较宽的水面应被判断为水")
    check(not b.eval("canHop(%d,%d,%d,%d)" %
                     (edge["nextQ"], edge["nextR"], edge["q"], edge["r"])), "路线应双向不可通过")
    point = _cell_px(b, edge["nextQ"], edge["nextR"])
    b.tap(point["x"], point["y"])
    check((b.frog()["q"], b.frog()["r"]) == (edge["q"], edge["r"]), "点按不能跨过较宽的水面")
    b.add("hop")
    b.click("#btnStep")
    check((b.frog()["q"], b.frog()["r"]) == (edge["q"], edge["r"]), "指令不能跨过较宽的水面")
    check(b.eval("Array.from({length:100},()=>freeCell()).every(c=>c&&walkable(c.q,c.r))"),
          "新虫只能出现在荷叶落脚点上")


@test
def long_program_layout(b):
    """长程序只在编辑区内滚动，池塘和控件位置保持不变"""
    original = b.vp
    try:
        for vp in [
            dict(name="iPad portrait", width=768, height=1024, mobile=True),
            dict(name="iPad landscape", width=1024, height=768, mobile=True),
            dict(name="compact landscape", width=600, height=450, mobile=False),
            dict(name="phone portrait", width=390, height=844, mobile=True),
        ]:
            b.vp = vp
            b.setup()
            b.load()
            stage = b.center("#stage", scroll=False)
            panel = b.center("#panel", scroll=False)
            if vp["width"] >= 600:
                check(panel["r"] <= stage["l"] + 1, "%s 编辑区应在左侧" % vp["name"])
            else:
                check(stage["b"] <= panel["t"] + 1, "%s 窄屏应上下排列" % vp["name"])
            canvas_size = b.eval("[pond.width, pond.height]")
            b.add(*(["hop"] * 16 + ["repeat"]))
            check(len(b.flat()) == 17, "%s 没有添加完整程序" % vp["name"])
            check(b.center("#stage", scroll=False) == stage, "%s 长程序改变了池塘大小" % vp["name"])
            check(b.eval("[pond.width, pond.height]") == canvas_size, "%s 画布尺寸改变" % vp["name"])
            check(b.eval("program.scrollHeight > program.clientHeight"), "%s 程序区没有溢出" % vp["name"])
            if vp["mobile"]:
                b.eval("program.scrollTop = 0")
                r = b.center("#program .card", 1, scroll=False)
                b.drag((r["x"], r["y"]), (r["x"], r["y"] - 70))
                check(b.eval("program.scrollTop > 0"), "%s 触摸滑动没有滚动" % vp["name"])
            b.eval("program.scrollTop = program.scrollHeight")
            check(b.eval("program.scrollTop > 0"), "%s 程序区不能滚动" % vp["name"])
            b.assert_hittable("#program .slot[data-k=repeat] > .slotHead .num")
            for sel in ['.pal[data-block="hop"]', '.pal[data-block="repeat"]', "#btnRun", "#btnStep"]:
                b.assert_hittable(sel)
            b.click("#program .slot[data-k=repeat] > .slotHead .num")
            b.assert_hittable("#pickerCancel")
            b.click_text("#pickerItems .pkItem", "2")
            check(b.eval("state.program[16].count") == 2, "%s 次数选择器不可用" % vp["name"])
            check(b.center("#stage", scroll=False) == stage, "%s 选择器改变了池塘大小" % vp["name"])
    finally:
        b.vp = original
        b.setup()


@test
def click_blocks_and_count(b):
    """点按积木加入程序，计数、卡片 DOM 与 state 同步"""
    b.load()
    b.add("hop", "chirp", "eat", "left", "right", "spin")
    check(b.flat() == ["hop", "chirp", "eat", "left", "right", "spin"], "程序顺序错误: %s" % b.flat())
    check(b.eval("document.querySelectorAll('#program .card').length") == 6, "DOM 卡片数不对")
    check(b.eval("document.querySelector('#progCount').textContent") == "6 张卡片", "计数文字不对")
    check(b.eval("document.querySelector('#statMoves').textContent") == "6", "顶栏卡片数不对")


@test
def insert_at_selected_point(b):
    """点一张卡片后，新积木插到它后面"""
    b.load()
    b.add("hop", "eat", "spin")
    b.click("#program .card", 0)
    b.add("chirp")
    check(b.flat() == ["hop", "chirp", "eat", "spin"], "插入位置错误: %s" % b.flat())


@test
def step_executes_one_op(b):
    """单步：每按一次只执行一条；跑完提示；编辑程序后从头开始"""
    b.load(level=1)  # 青蛙(-2,0)朝东，甲虫(-1,0),(0,0)
    check(b.frog() == {"q": -2, "r": 0, "dir": 0, "pc": 0}, "第一关初始青蛙: %s" % b.frog())
    b.add("hop", "eat")
    b.click("#btnStep")
    f = b.frog()
    check((f["q"], f["r"]) == (-1, 0) and f["pc"] == 1, "单步一次应只跳一格: %s" % f)
    check(b.eval("state.running") is False, "单步不应进入运行状态")
    check(b.eval("document.querySelectorAll('#program .card.active').length") == 1, "应高亮当前卡片")
    check(b.eval("state.eaten") == 0, "第一步不应吃到")
    b.click("#btnStep")
    check(b.eval("state.eaten") == 1 and b.targets_left() == 1, "第二步(吃)应吃到 1 只")
    b.click("#btnStep")
    check("跑完" in b.toast(), "跑完后再单步应提示，实际: %r" % b.toast())
    b.add("spin")                       # 编辑后 pc 复位
    check(b.frog()["pc"] == 0, "编辑程序后 pc 应复位")
    b.click("#btnStep")                 # 重新从 hop 开始：(-1,0)->(0,0)
    f = b.frog()
    check((f["q"], f["r"], f["pc"]) == (0, 0, 1), "编辑后单步应从头执行: %s" % f)


@test
def hop_into_water_blocked(b):
    """第二关：前面是水，跳不过去，青蛙不动并提示"""
    b.load(level=2)   # 青蛙(-2,1)朝东，(-1,1)是水
    b.add("hop")
    b.click("#btnStep")
    f = b.frog()
    check((f["q"], f["r"]) == (-2, 1), "不应跳进水里: %s" % f)
    check("水" in b.toast(), "应提示这里是水，实际 %r" % b.toast())


@test
def turn_directions(b):
    """左转 / 右转 / 转身的方向"""
    b.load(level=1)
    b.add("left", "right", "right", "spin")
    dirs = []
    for _ in range(4):
        b.click("#btnStep")
        dirs.append(b.frog()["dir"])
    check(dirs == [1, 0, 5, 2], "方向序列错误(应为 [1,0,5,2]): %s" % dirs)


@test
def level_mode_targets_stay_put(b):
    """关卡模式：目标甲虫一直停在荷叶上，不会飞走、不会新增"""
    b.load(level=1)
    check(b.eval("state.beetles.length") == 2 and b.targets_left() == 2, "第一关应恰有 2 只目标甲虫")
    check(b.eval("document.querySelector('#statBeetles').textContent") == "2", "顶栏剩余甲虫应为 2")
    b.eval("updateBeetles(Date.now() + 6500)")   # 超过 5s 的换虫周期
    st = b.eval("state.beetles.map(x=>[x.q,x.r,x.alive,x.flying,x.leaving,x.arriving,x.target])")
    check(st == [[-1, 0, True, False, False, False, True], [0, 0, True, False, False, False, True]],
          "关卡里的甲虫发生变化: %s" % st)
    check(b.eval("state.frogs.length") == 1, "关卡应只有一只青蛙")


@test
def level_win_no_respawn_and_next(b):
    """关卡模式：真实点「运行」，吃光目标后通关遮罩，之后不重生，点下一关"""
    b.load(level=1)
    b.add("eat", "hop", "eat")
    b.click("#btnRun")
    check(b.eval("state.running"), "点运行后应进入运行状态")
    check(b.eval("document.querySelector('#btnRun .nm').textContent") == "停止", "运行时按钮应变「停止」")
    b.wait_for("state.running === false", 15, "程序没有跑完")
    b.wait_for(OVERLAY_SHOWN, 3, "吃光后没有通关遮罩")
    check(b.eval("document.querySelector('#ovTitle').textContent") == "太棒啦！", "通关标题不对")
    check(b.eval("state.eaten") == 2 and b.eval("state.score") == 20, "吃了 2 只应得 20 分")
    check(b.targets_left() == 0, "目标甲虫应清零")
    check(b.eval("document.querySelector('#statBeetles').textContent") == "0", "顶栏剩余应为 0")
    check(b.eval("document.querySelector('#ovBtn').textContent") == "下一关", "按钮应为「下一关」")
    b.eval("updateBeetles(Date.now() + 6000)")    # 超过一个 5s 周期
    check(b.eval("state.beetles.length") == 0, "通关后甲虫又重生了: %s" % b.eval("state.beetles.length"))
    check(b.eval("state.beetles.filter(x=>x.target).length") == 0, "通关后目标甲虫重生")
    b.click("#ovBtn")
    check(b.eval("state.level") == 2, "点下一关后应进入第 2 关")
    check(not b.overlay_visible(), "进入下一关后遮罩应关闭")
    check(b.eval("document.querySelector('#modeSelect').value") == "2", "下拉框应同步为挑战 2")
    check(b.targets_left() == 2 and b.eval("state.frogs.length") == 1, "第 2 关应有 2 只目标和 1 只青蛙")
    check(b.flat() == [], "新关卡程序应为空")


@test
def win_via_step_mode(b):
    """单步也能通关（最后一步吃完时触发遮罩）"""
    b.load(level=1)
    b.add("eat", "hop", "eat")
    for _ in range(3):
        b.click("#btnStep")
    b.wait_for(OVERLAY_SHOWN, 3, "单步吃光后没有通关遮罩")
    check(b.targets_left() == 0, "目标应清零")


@test
def repeat_card_and_picker(b):
    """重复：积木塞进重复里；改次数；第三关三只虫通关"""
    b.load(level=3, speed=4)    # 青蛙(-1,1)朝东，甲虫 (0,1)(1,1)(2,1)
    b.add("repeat")
    check(b.eval("state.focus && state.focus.parent && state.focus.parent.key") == "repeat",
          "加入重复后焦点应在它的凹槽里")
    b.add("eat", "hop")
    k = b.keys()
    check(k == [{"k": "repeat", "c": ["eat", "hop"], "e": [], "n": 3, "cond": None, "hasElse": False}],
          "重复结构不对: %s" % k)
    check(b.eval("document.querySelector('#progCount').textContent") == "3 张卡片", "计数应为 3")
    b.click("#program .slot[data-k=repeat] > .slotHead .num")
    check(not b.eval("document.querySelector('#picker').classList.contains('hidden')"), "应弹出次数选择器")
    b.click_text("#pickerItems .pkItem", "2")
    check(b.keys()[0]["n"] == 2, "次数应改为 2: %s" % b.keys())
    check(b.eval("document.querySelector('#program .slot .num').textContent.startsWith('2')"), "DOM 次数没更新")
    b.click("#program .slot[data-k=repeat] > .slotHead .num")
    b.click_text("#pickerItems .pkItem", "3")
    check(b.keys()[0]["n"] == 3, "次数应改回 3")
    b.click("#btnRun")
    b.wait_for("state.running === false", 20, "程序没有跑完")
    b.wait_for(OVERLAY_SHOWN, 3, "重复程序没有通关")
    check(b.targets_left() == 0 and b.eval("state.eaten") == 3, "应吃到 3 只")
    check(b.frog()["q"] == 2, "青蛙最终应在 q=2: %s" % b.frog())


@test
def if_condition_run(b):
    """如果：repeat 4 { if 前面有虫 {吃}; 跳 } 吃光第四关四只虫"""
    b.load(level=4, speed=6)    # 青蛙(-2,0)朝东，甲虫 q=-1..2 (r=0)
    b.add("repeat", "if", "eat")
    b.click(".slot[data-k=repeat] > .socket > .stack > .insertPoint:last-child")   # if 之后、repeat 内
    b.add("hop")
    k = b.keys()
    check(k[0]["k"] == "repeat" and k[0]["c"] == ["if", "hop"], "结构应为 repeat[if, hop]: %s" % k)
    check(b.eval("state.program[0].children[0].children.map(c=>c.key)") == ["eat"], "if 里应是 eat")
    b.click("#program .slot[data-k=if] > .slotHead .cond")
    b.click_text("#pickerItems .pkItem", "脚下有虫")
    check(b.eval("state.program[0].children[0].cond") == "abug", "条件应改为 abug")
    b.click("#program .slot[data-k=if] > .slotHead .cond")
    b.click_text("#pickerItems .pkItem", "前面有虫")
    b.click("#program .slot[data-k=repeat] > .slotHead .num")
    b.click_text("#pickerItems .pkItem", "4")
    check(b.eval("state.program[0].count") == 4, "次数应为 4")
    b.click("#btnRun")
    b.wait_for("state.running === false", 40, "程序没有跑完")
    b.wait_for(OVERLAY_SHOWN, 3, "if 程序没有通关")
    check(b.eval("state.eaten") == 4 and b.targets_left() == 0, "应吃到 4 只")


@test
def if_else_branches(b):
    """如果/否则：条件真走 then，条件假走 else，关闭否则后不计数"""
    b.load(level=1)  # 青蛙(-2,0)朝东，正前方(-1,0)有虫
    b.add("if", "hop")
    b.click(".slot[data-k=if] > .slotHead .elseTgl")
    check(b.eval("state.program[0].hasElse") is True, "应开启否则")
    b.click(".slot[data-k=if] > .socket.elseSocket")      # 选中否则凹槽
    b.add("spin")
    k = b.keys()[0]
    check(k["c"] == ["hop"] and k["e"] == ["spin"] and k["cond"] == "bug", "if/else 结构不对: %s" % k)
    check(b.eval("document.querySelector('#progCount').textContent") == "3 张卡片", "含否则应数 3 张")
    b.click("#btnStep")   # test(bug)=真 -> hop
    b.click("#btnStep")
    f = b.frog()
    check((f["q"], f["dir"]) == (-1, 0), "条件为真应只执行 then(跳): %s" % f)
    b.click("#btnReset")
    b.add("if", "hop")
    b.click(".slot[data-k=if] > .slotHead .elseTgl")
    b.click(".slot[data-k=if] > .socket.elseSocket")
    b.add("spin")
    b.click(".slot[data-k=if] > .slotHead .cond")
    b.click_text("#pickerItems .pkItem", "前面是水")
    b.click("#btnStep")
    b.click("#btnStep")
    f = b.frog()
    check((f["q"], f["dir"]) == (-2, 3), "条件为假应执行 else(转身): %s" % f)
    b.click(".slot[data-k=if] > .slotHead .elseTgl")
    check(b.eval("document.querySelector('#progCount').textContent") == "2 张卡片", "关闭否则后应数 2 张")


@test
def level5_turn_and_win(b):
    """第五课：吃、右转、吃；最后一关回池塘"""
    b.load(level=5, speed=5)
    b.add("eat", "right", "eat")
    b.click("#btnRun")
    b.wait_for("state.running === false", 20, "程序没有跑完")
    b.wait_for(OVERLAY_SHOWN, 3, "第五课没有通关")
    check(b.eval("document.querySelector('#ovBtn').textContent") == "回池塘", "最后一关按钮应为「回池塘」")
    b.click("#ovBtn")
    check(b.eval("state.level") == 0 and not b.overlay_visible(), "回池塘后应是自由池塘且遮罩关闭")


@test
def stop_and_reset(b):
    """运行中点「停止」；运行中卡片不可编辑；重置恢复关卡"""
    b.load(level=3)
    b.add("repeat", "hop")
    b.click("#btnRun")
    b.sleep(0.5)
    check(b.eval("state.running"), "应在运行")
    b.eval("document.querySelector('.pal[data-block=chirp]').click()")  # 运行中点积木应被忽略
    check(b.flat() == ["repeat"], "运行中不应能添加卡片: %s" % b.flat())
    b.click("#btnRun")
    check(b.eval("state.running") is False, "点停止后应停下")
    check(b.eval("document.querySelector('#btnRun .nm').textContent") == "运行", "按钮应变回「运行」")
    b.click("#btnReset")
    f = b.frog()
    check((f["q"], f["r"], f["dir"]) == (-1, 1, 0), "重置后青蛙应回到起点: %s" % f)
    check(b.flat() == [] and b.targets_left() == 3, "重置后程序为空、甲虫满")


def _cell_px(b, q, r):
    return b.eval("(()=>{const p=cellCenter(%d,%d);const r=canvas.getBoundingClientRect();"
                  "return {x:r.left+p.x,y:r.top+p.y}})()" % (q, r))


@test
def free_mode_single_frog_and_click_move(b):
    """自由池塘：始终只有一只青蛙；点相邻荷叶跳过去；跑程序后仍只有一只"""
    b.load()
    check(b.eval("state.frogs.length") == 1, "初始应只有一只青蛙")
    pt = _cell_px(b, -1, 0)
    b.tap(pt["x"], pt["y"])
    f = b.frog()
    check((f["q"], f["r"]) == (-1, 0), "点相邻荷叶后青蛙应过去: %s" % f)
    pt = _cell_px(b, 2, 0)
    b.tap(pt["x"], pt["y"])
    check((b.frog()["q"], b.frog()["r"]) == (-1, 0), "点远处荷叶不应移动")
    b.add("hop", "chirp", "left", "hop", "spin")
    b.click("#btnRun")
    b.wait_for("state.running === false", 15, "程序没有跑完")
    check(b.eval("state.frogs.length") == 1, "运行后仍应只有一只青蛙，实际 %s" % b.eval("state.frogs.length"))
    for lv in range(0, 6):
        b.set_level(lv)
        check(b.eval("state.level") == lv and b.eval("state.frogs.length") == 1, "关卡 %d 应只有一只青蛙" % lv)
    check(not b.overlay_visible(), "切换玩法不应留下遮罩")


@test
def tongue_eats_only_ahead(b):
    """吃虫：只吃朝向前方一跳的虫，舌头伸出后把虫拉回"""
    b.load(level=1)
    result = b.eval("""(()=>{const f=state.frogs[0];
      f.dir=3; doAction(f,'eat'); const wrong=state.eaten;
      f.dir=0; f.q=-1; doAction(f,'eat');
      const sameAlive=state.beetles.find(x=>x.q===-1&&x.r===0).alive;
      const a=state.eatAnimations[0];
      const start=eatAnimationPoints(a,a.at);
      const reach=eatAnimationPoints(a,a.at+650*.35);
      const end=eatAnimationPoints(a,a.at+650);
      return {wrong,sameAlive,eaten:state.eaten,from:[a.q,a.r],to:[a.beetle.q,a.beetle.r],
        start:Math.hypot(start.tip.x-start.mouth.x,start.tip.y-start.mouth.y),
        reach:Math.hypot(reach.tip.x-reach.target.x,reach.tip.y-(reach.target.y-hexR*.07)),
        end:Math.hypot(end.tip.x-end.mouth.x,end.tip.y-end.mouth.y)};})()""")
    check(result["wrong"] == 0 and result["sameAlive"], "不能吃背后或脚下的虫: %s" % result)
    check(result["eaten"] == 1 and result["from"] == [-1, 0] and result["to"] == [0, 0],
          "应吃正前方的虫: %s" % result)
    check(result["start"] < .01 and result["reach"] < .01 and result["end"] < .01,
          "舌头应伸到虫子处再收回嘴边: %s" % result)
    b.click("#btnReset")
    check(b.eval("state.eatAnimations.length") == 0, "重置应清除吃虫动画")


@test
def free_mode_flying_beetle_not_edible(b):
    """自由池塘：飞行中的甲虫不能被吃；停在叶子上的可以，且不弹通关"""
    b.load()
    check(b.eval("state.beetles.length") == 3 and b.targets_left() == 0, "自由池塘开局 3 只、且都不是关卡目标")
    b.add("eat")
    b.wait_for("state.beetles.some(x=>x.alive&&x.flying&&!x.leaving&&!x.arriving)", 8, "没有甲虫起飞")
    done = False
    for _ in range(8):
        info = b.eval("""(()=>{const x=state.beetles.find(x=>x.alive&&x.flying&&!x.leaving&&!x.arriving);
            if(!x) return null; const f=state.frogs[0];
            const dir=DIRS.findIndex(d=>walkable(x.q-d.dq,x.r-d.dr));
            if(dir<0) return null; f.q=x.q-DIRS[dir].dq; f.r=x.r-DIRS[dir].dr; f.dir=dir;
            f.pc=0; ops=[]; state.eaten=0;
            return {q:x.q,r:x.r}})()""")
        if info is None:
            b.sleep(0.3)
            continue
        b.click("#btnStep")
        res = b.eval("""(()=>{const x=state.beetles.find(x=>x.q===%d&&x.r===%d&&x.alive);
            return {eaten:state.eaten, alive:!!x, flying:x?x.flying:null,
                    toast:document.querySelector('#toast').textContent}})()""" % (info["q"], info["r"]))
        if res["flying"]:
            check(res["eaten"] == 0, "吃到了飞行中的甲虫! %s" % res)
            check(res["alive"], "飞行中的甲虫被吃掉了: %s" % res)
            check("没有虫子" in res["toast"], "应提示这片荷叶上没有虫子: %r" % res["toast"])
            done = True
            break
        b.eval("state.eaten = 0")   # 单步期间刚好落地，换一只再试
    check(done, "没能在甲虫飞行期间完成断言")
    ok = False
    for _ in range(10):
        info = b.eval("""(()=>{const x=state.beetles.find(x=>x.alive&&!x.flying&&!x.leaving&&!x.arriving);
            if(!x) return null; const f=state.frogs[0];
            const dir=DIRS.findIndex(d=>walkable(x.q-d.dq,x.r-d.dr));
            if(dir<0) return null; f.q=x.q-DIRS[dir].dq; f.r=x.r-DIRS[dir].dr; f.dir=dir;
            ops=[]; f.pc=0; state.eaten=0;
            return {q:x.q,r:x.r}})()""")
        if info is None:
            b.sleep(0.3)
            continue
        b.click("#btnStep")
        if b.eval("state.eaten") == 1:
            ok = True
            break
        b.sleep(0.2)
    check(ok, "停在叶子上的甲虫应该能被吃掉")
    check(not b.overlay_visible(), "自由池塘吃虫不应弹出通关遮罩")
    check(b.eval("state.frogs.length") == 1, "仍应只有一只青蛙")


@test
def free_mode_pop_cap(b):
    """自由池塘：停在荷叶上的甲虫不超过 6 只（观察约 11 秒）"""
    b.load()
    worst = 0
    lo = 99
    for _ in range(22):
        b.sleep(0.5)
        n = b.eval("state.beetles.filter(x=>x.alive&&!x.leaving&&!x.arriving).length")
        worst = max(worst, n)
        lo = min(lo, n)
    check(worst <= 6, "荷叶上的甲虫超过 6 只: %d" % worst)
    check(lo >= 3, "自由池塘荷叶上的甲虫数量异常偏少: %d" % lo)


@test
def undo_behaviour(b):
    """撤销：逐步回退；删除/清空也可撤销；没有可撤销时提示"""
    b.load()
    b.add("hop", "eat", "spin")
    b.click("#btnUndo")
    check(b.flat() == ["hop", "eat"], "撤销 1 次: %s" % b.flat())
    b.click("#btnUndo")
    check(b.flat() == ["hop"], "撤销 2 次: %s" % b.flat())
    check(b.eval("document.querySelectorAll('#program .card').length") == 1, "DOM 应同步")
    b.click("#btnUndo")
    check(b.flat() == [], "撤销 3 次应为空")
    check(b.eval("document.querySelector('#progCount').textContent") == "0 张卡片", "计数应为 0")
    b.click("#btnUndo")
    check("没有可以撤销" in b.toast(), "空栈撤销应提示，实际 %r" % b.toast())
    b.add("hop", "eat", "spin")
    b.click("#program .card[data-k=eat] .del")
    check(b.flat() == ["hop", "spin"], "删除失败: %s" % b.flat())
    b.click("#btnUndo")
    check(b.flat() == ["hop", "eat", "spin"], "撤销删除失败: %s" % b.flat())
    b.click("#btnClear")
    check(b.flat() == [], "清空失败")
    b.click("#btnUndo")
    check(b.flat() == ["hop", "eat", "spin"], "撤销清空失败: %s" % b.flat())
    b.click("#btnClear")
    b.add("repeat", "hop")
    b.click("#btnUndo")
    check(b.keys() == [{"k": "repeat", "c": [], "e": [], "n": 3, "cond": None, "hasElse": False}],
          "撤销嵌套里的 hop: %s" % b.keys())


@test
def drag_reorder_cards(b):
    """拖动重排：第一张拖到最后；最后一张拖到最前；可撤销；轻点不重排"""
    b.load()
    b.add("hop", "eat", "left")
    b.center("#program .stack > .card", 2)
    dst = b.center("#program .stack > .card", 2, scroll=False)
    src = b.center("#program .stack > .card", 0, scroll=False)
    b.drag((src["x"], src["y"]), (dst["x"], dst["b"] - 3))
    check(b.flat() == ["eat", "left", "hop"], "拖到最后失败: %s" % b.flat())
    check(not b.eval("document.querySelector('.dragGhost')"), "拖动结束后不应残留拖影")
    ip = b.center("#program > .stack > .insertPoint", 0)
    src = b.center("#program .stack > .card", 2, scroll=False)
    b.drag((src["x"], src["y"]), (ip["x"], ip["y"]))
    check(b.flat() == ["hop", "eat", "left"], "拖到最前失败: %s" % b.flat())
    b.click("#btnUndo")
    check(b.flat() == ["eat", "left", "hop"], "撤销拖动失败: %s" % b.flat())
    c0 = b.assert_hittable("#program .stack > .card", 0)
    b.tap(c0["x"], c0["y"])
    check(b.flat() == ["eat", "left", "hop"], "轻点不应改变顺序")


@test
def drag_from_palette_and_into_slot(b):
    """从调色板拖进程序（开头、凹槽内）；容器不能拖进自己"""
    b.load()
    b.add("hop", "eat")
    ip = b.assert_hittable("#program > .stack > .insertPoint", 0)
    pal = b.assert_hittable('.pal[data-block="chirp"]')
    ip = b.assert_hittable("#program > .stack > .insertPoint", 0)   # 滚动后重新测量
    b.drag((pal["x"], pal["y"]), (ip["x"], ip["y"]))
    check(b.flat() == ["chirp", "hop", "eat"], "从调色板拖到最前失败: %s" % b.flat())
    b.click("#program > .stack > .insertPoint:last-child")
    b.add("repeat")
    check(b.flat()[-1] == "repeat", "repeat 位置: %s" % b.flat())
    sock = b.assert_hittable("#program .slot[data-k=repeat] > .socket")
    hop = b.assert_hittable("#program .stack > .card[data-k=hop]")
    sock = b.center("#program .slot[data-k=repeat] > .socket", scroll=False)
    b.drag((hop["x"], hop["y"]), (sock["x"], sock["y"]))
    k = b.keys()
    check(k[-1]["k"] == "repeat" and k[-1]["c"] == ["hop"]
          and k[:-1] == ["chirp", "eat"], "拖进凹槽失败: %s" % k)
    head = b.assert_hittable("#program .slot[data-k=repeat] > .slotHead")
    inner = b.center("#program .slot[data-k=repeat] > .socket .card[data-k=hop]", scroll=False)
    before = b.eval("JSON.stringify(state.program)")
    b.drag((head["x"] + 8, head["y"]), (inner["x"], inner["y"]))
    check(b.eval("JSON.stringify(state.program)") == before, "容器不应能被拖进自己里面")


@test
def drag_then_run(b):
    """拖动重排后按新顺序运行：先跳再吃"""
    b.load(level=1, speed=5)
    b.add("eat", "hop")
    dst = b.center("#program .stack > .card", 1)
    src = b.center("#program .stack > .card", 0, scroll=False)
    b.drag((src["x"], src["y"]), (dst["x"], dst["b"] - 3))
    check(b.flat() == ["hop", "eat"], "重排失败: %s" % b.flat())
    b.click("#btnRun")
    b.wait_for("state.running === false", 10)
    check(b.eval("state.eaten") == 1, "按新顺序应吃到 1 只")


@test
def help_and_sound_buttons(b):
    """帮助弹层与声音开关不报错"""
    b.load()
    b.click("#btnHelp")
    check(b.overlay_visible() and b.eval("document.querySelector('#ovTitle').textContent") == "怎么玩", "帮助弹层")
    b.click("#ovBtn")
    check(not b.overlay_visible(), "知道了应关闭弹层")
    b.click("#btnSound")
    check(b.eval("state.sound") is False, "声音应关闭")
    b.click("#btnSound")
    check(b.eval("state.sound") is True, "声音应打开")


# --------------------------------------------------------------------------
# 主流程
# --------------------------------------------------------------------------
VIEWPORTS = [
    dict(name="desktop 1024x768 (mouse)", width=1024, height=768, mobile=False),
    dict(name="iPad 768x1024 (touch)", width=768, height=1024, mobile=True),
]


def main():
    args = sys.argv[1:]
    keyword = args[args.index("-k") + 1] if "-k" in args else None
    if not os.path.exists(CHROME):
        print("找不到 Chrome: " + CHROME)
        return 2

    server = start_server()
    base = "http://127.0.0.1:%d" % server.server_address[1]
    profile = tempfile.mkdtemp(prefix="frogtest-chrome-")
    proc = None
    cdp = None
    results = []
    try:
        proc, port = start_chrome(profile)
        cdp = CDP(page_ws_url(port))
        for vp in VIEWPORTS:
            b = Browser(cdp, base, vp)
            b.setup()
            print("\n=== %s ===" % vp["name"])
            for fn in TESTS:
                if keyword and keyword not in fn.__name__:
                    continue
                cdp.errors.clear()
                t0 = time.time()
                try:
                    fn(b)
                    b.sleep(0.2)
                    check(not cdp.errors, "控制台错误: %s" % cdp.errors[:3])
                    ok, detail = True, ""
                except Exception as e:
                    ok = False
                    detail = "%s: %s" % (type(e).__name__, e)
                    if not isinstance(e, Fail):
                        detail += "\n" + traceback.format_exc()
                results.append((vp["name"], fn.__name__, ok, detail))
                print("  [%s] %-38s %5.1fs  %s" % ("PASS" if ok else "FAIL", fn.__name__,
                                                time.time() - t0, fn.__doc__.split("：")[0] if ok else ""))
                if not ok:
                    print("        " + detail.replace("\n", "\n        "))
    finally:
        if cdp:
            try:
                cdp.call("Browser.close", timeout=3)
            except Exception:
                pass
            cdp.ws.close()
        if proc:
            try:
                proc.wait(timeout=5)
            except Exception:
                proc.kill()
        server.shutdown()
        shutil.rmtree(profile, ignore_errors=True)

    failed = [r for r in results if not r[2]]
    print("\n%d passed, %d failed (共 %d)" % (len(results) - len(failed), len(failed), len(results)))
    for vp, name, _, detail in failed:
        print("FAILED %s / %s: %s" % (vp, name, detail.split("\n")[0]))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
