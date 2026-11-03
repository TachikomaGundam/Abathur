function sum(items) {
  // a totally different comment with other words
  let total = 0;
  for (const item of items) { total += item; }
  console.log("brand new phrasing");
  return total;
}
