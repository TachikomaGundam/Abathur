def clean(samples):
    out = []
    for s in samples:
        # moved comment, renamed everything
        if s > 0:
            out.append(s / 100)
    return out
