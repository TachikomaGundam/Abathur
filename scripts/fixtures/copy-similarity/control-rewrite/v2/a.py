def group_amounts(rows):
    buckets = {}
    for row in rows:
        bucket = row["category"]
        previous = buckets.get(bucket, 0)
        buckets[bucket] = previous + row["value"]
    return dict(sorted(buckets.items()))
