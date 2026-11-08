"""Run a command while holding an exclusive machine-wide GPU lock (one 8 GB GTX 1070 Ti shared by parallel experiments).
Usage: python gpu_lock.py [--timeout SECONDS] -- <command> [args...]
Waits for the lock (polling), runs the command, releases the lock, and exits with the command's exit code."""
import msvcrt, os, subprocess, sys, time
LOCK = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'gpu.lock')
argv = sys.argv[1:]
timeout = 7200.0
if argv and argv[0] == '--timeout': timeout = float(argv[1]); argv = argv[2:]
if argv and argv[0] == '--': argv = argv[1:]
if not argv: sys.exit('usage: gpu_lock.py [--timeout S] -- command ...')
f = open(LOCK, 'a+'); t0 = time.time(); waited = False
while True:
    try:
        f.seek(0); msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1); break
    except OSError:
        if not waited: print(f'[gpu_lock] waiting for GPU lock ...', flush=True); waited = True
        if time.time() - t0 > timeout: sys.exit('[gpu_lock] timeout waiting for the GPU lock')
        time.sleep(3)
print(f'[gpu_lock] acquired after {time.time() - t0:.0f}s: {" ".join(argv)[:160]}', flush=True)
try: rc = subprocess.run(argv).returncode
finally:
    f.seek(0); msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1); f.close()
sys.exit(rc)
