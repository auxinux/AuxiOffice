"""Diagnostic Windows : ouvre un document avec auxi-engine ; s'il ne répond pas,
capture les piles de tous les fils avec cdb."""
import glob, json, os, queue, struct, subprocess, sys, threading, time

root = os.getcwd()
prog = open(".engine/windows-x86_64/program-dir").read().strip()
doc = os.path.abspath(sys.argv[1])
mode = sys.argv[2] if len(sys.argv) > 2 else ""
env = dict(os.environ, AUXI_ENGINE_PROGRAM_DIR=prog, AUXI_ENGINE_PROFILE=os.path.join(root, "target", "diagprof-" + os.path.basename(doc)),
           AUXI_ENGINE_WINLOOP=mode)
p = subprocess.Popen([os.path.join(root, "target", "debug", "auxi-engine.exe")], stdin=subprocess.PIPE, stdout=subprocess.PIPE, env=env)
q = queue.Queue()

def reader():
    while True:
        h = p.stdout.read(8)
        if len(h) < 8:
            q.put({"event": "dead"}); return
        j, b = struct.unpack("<II", h)
        d = json.loads(p.stdout.read(j)); p.stdout.read(b)
        q.put(d)

threading.Thread(target=reader, daemon=True).start()
def call(n, **kw):
    kw["id"] = n
    j = json.dumps(kw).encode()
    p.stdin.write(struct.pack("<II", len(j), 0) + j); p.stdin.flush()
def wait(n, t):
    end = time.time() + t
    while time.time() < end:
        try: d = q.get(timeout=1)
        except queue.Empty: continue
        if d.get("id") == n: return d
        if d.get("event") in ("ready", "fatal", "dead"): print("événement", d.get("event"), flush=True)
    return None

time.sleep(15)
call(1, cmd="load", path=doc)
r = wait(1, 90)
print("load :", json.dumps(r)[:300] if r else "PAS DE RÉPONSE", flush=True)
if r and not r.get("error"):
    call(2, cmd="save_in_place")
    r2 = wait(2, 60)
    print("save_in_place :", json.dumps(r2)[:300] if r2 else "PAS DE RÉPONSE", flush=True)
    if r2: p.kill(); sys.exit(0)
cdb = (glob.glob(r"C:\Program Files (x86)\Windows Kits\10\Debuggers\x64\cdb.exe") or [None])[0]
print("cdb :", cdb, flush=True)
if cdb:
    out = subprocess.run([cdb, "-p", str(p.pid), "-c", ".symfix; ~*kn 40; qd"], capture_output=True, text=True, timeout=600, errors="replace")
    print(out.stdout[-60000:])
p.kill()
