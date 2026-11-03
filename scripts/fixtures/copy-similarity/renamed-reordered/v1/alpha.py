def normalize(values):
    result = []
    for value in values:
        if value > 0:
            result.append(value / 100)
    return result
