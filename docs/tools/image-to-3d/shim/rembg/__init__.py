"""Stand-in for rembg: TripoSR imports it at module level, but the inputs here are already cut to RGBA (cut_ref.py)."""
def new_session(*a, **k): raise RuntimeError('rembg is not installed; pass RGBA input')
def remove(*a, **k): raise RuntimeError('rembg is not installed; pass RGBA input')
