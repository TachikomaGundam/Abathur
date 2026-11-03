def summarize(records):
    result = {}
    for record in records:
        key = record["kind"]
        result[key] = result.get(key, 0) + record["amount"]
    return result
