def total_rows(rows):
    total = 0
    for row in rows:
        total += row["count"]
    return total
