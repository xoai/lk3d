// Whether what something was made from has changed since it was made (a part's matrix, a group of parts alike, the
// shadow map, the liquids' bodies), so it is made again only then. The values it was made from are kept in a list of
// the caller's: start(list) begins comparing with them (from place `at`), put(value) compares the next one and keeps it,
// end() says whether any differed (`any`: so far). No garbage: the same list is written over, frame after frame.
let kept, next;
export let any;
export const start = (list, at = 0) => {
  kept = list;
  next = at;
  any = false;
};
export const put = (value) => {
  if (kept[next] !== value) {
    kept[next] = value;
    any = true;
  }
  next++;
};
export const end = () => {
  if (kept.length !== next) any = true;
  kept.length = next;
  return any;
};
