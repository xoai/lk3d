// @ts-check
// A molecule's chemistry, as the geometry check reads it (lk3d/lint): each bond against the length its two atoms'
// covalent radii give for its order, and each atom's bonds against the valences its element (or, charged, the element
// with as many electrons) usually has. Not part of the runtime bundle: science.js draws molecules without it.
//
// Covalent radii in pm, for single, double and triple bonds (null where none is given): P. Pyykkö and M. Atsumi,
// "Molecular single-bond covalent radii for elements 1–118", Chem. Eur. J. 15 (2009) 186–197; "Molecular double-bond
// covalent radii for elements Li–E112", Chem. Eur. J. 15 (2009) 12770–12779; P. Pyykkö, S. Riedel and M. Patzschke,
// "Triple-bond covalent radii", Chem. Eur. J. 11 (2005) 3511–3520. Each set fits its primary distances to about 3 pm.
// Only the elements lk3d draws in their own colours (science.js's table) are here.
/** @type {Record<string, [number, number | null, number | null]>} */
export const RADII = {
  H: [32, null, null],
  He: [46, null, null],
  Li: [133, 124, null],
  Be: [102, 90, 85],
  B: [85, 78, 73],
  C: [75, 67, 60],
  N: [71, 60, 54],
  O: [63, 57, 53],
  F: [64, 59, 53],
  Ne: [67, 96, null],
  Na: [155, 160, null],
  Mg: [139, 132, 127],
  Al: [126, 113, 111],
  Si: [116, 107, 102],
  P: [111, 102, 94],
  S: [103, 94, 95],
  Cl: [99, 95, 93],
  Ar: [96, 107, 96],
  K: [196, 193, null],
  Ca: [171, 147, 133],
  Fe: [116, 109, 102],
  Cu: [112, 115, 120],
  Zn: [118, 120, null],
  Br: [114, 109, 110],
  I: [133, 129, 125],
};
/** each element's atomic number (to find the element a charged atom has as many electrons as) */
export const Z = {
  H: 1,
  He: 2,
  Li: 3,
  Be: 4,
  B: 5,
  C: 6,
  N: 7,
  O: 8,
  F: 9,
  Ne: 10,
  Na: 11,
  Mg: 12,
  Al: 13,
  Si: 14,
  P: 15,
  S: 16,
  Cl: 17,
  Ar: 18,
  K: 19,
  Ca: 20,
  Fe: 26,
  Cu: 29,
  Zn: 30,
  Br: 35,
  I: 53,
};
/** the usual valences (bond orders added) of the elements whose bonds are counted; metals, whose bonds are ionic, not */
export const VALENCES = {
  H: [1],
  B: [3],
  C: [4],
  N: [3],
  O: [2],
  F: [1],
  Si: [4],
  P: [3, 5],
  S: [2, 4, 6],
  Cl: [1],
  Br: [1],
  I: [1],
};
const NOBLE = ['He', 'Ne', 'Ar'];
const ORDER = ['', 'single', 'double', 'triple'];
/** how far a bond may be from its radii's sum: real bonds stray both ways (BF3's B–F 12 % short, H2O2's O–O 17 % long) */
export const TOLERANCE = 0.2;

/** the valences an atom may have: its element's, or a charged atom's as the element with as many electrons (N⁺ as C) */
function valencesOf(/** @type {string} */ el, /** @type {number} */ charge) {
  if (!charge) return VALENCES[/** @type {keyof typeof VALENCES} */ (el)] || null;
  const z = Z[/** @type {keyof typeof Z} */ (el)];
  if (!z) return null;
  const like = Object.keys(Z).find((other) => Z[/** @type {keyof typeof Z} */ (other)] === z - charge);
  return (like && VALENCES[/** @type {keyof typeof VALENCES} */ (like)]) || null;
}

/**
 * What is wrong with a scene's molecules, and the elements whose bonds could not be checked (no radius for them).
 * @param {any} scene
 * @returns {{ problems: { path: string, message: string }[], unchecked: string[] }}
 */
export function chemistry(scene) {
  const problems = [],
    unchecked = new Set(),
    parts = Array.isArray(scene.parts) ? scene.parts : [],
    excused = Array.isArray(scene.check?.molecule) ? scene.check.molecule : [];
  // what check.molecule names must be a molecule shape: a part with one, or one of its shapes ("id.shapes[j]")
  excused.forEach((name, k) => {
    const one = /^(.+)\.shapes\[(\d+)\]$/.exec(name),
      part = parts.find((each) => each && each.id === (one ? one[1] : name)),
      shapes = (part && Array.isArray(part.shapes) ? part.shapes : []).filter(Boolean);
    const named = one ? shapes[+one[2]] && shapes[+one[2]].molecule : shapes.some((shape) => shape.molecule);
    if (!named)
      problems.push({
        path: `check.molecule[${k}]`,
        message: `${name} is not a molecule shape: name a part that has one, or "id.shapes[j]" for one of them`,
      });
  });
  parts.forEach((part, i) => {
    if (!part || !Array.isArray(part.shapes) || part.mirrorOf !== undefined) return; // (a mirror: checked at its source)
    part.shapes.forEach((/** @type {any} */ shape, j) => {
      const molecule = shape && shape.molecule;
      if (!molecule || excused.includes(part.id) || excused.includes(`${part.id}.shapes[${j}]`)) return;
      const atoms = Array.isArray(molecule.atoms) ? molecule.atoms : [],
        bonds = Array.isArray(molecule.bonds) ? molecule.bonds : [];
      if (!bonds.length) return; // (no bonds: a space-filling picture, or atoms on their own)
      const at = `parts[${i}].shapes[${j}].molecule`,
        sums = atoms.map(() => 0),
        name = (k) => `atoms[${k}] (${atoms[k].el}${atoms[k].charge ? (atoms[k].charge > 0 ? '⁺' : '⁻') : ''})`;
      bonds.forEach((/** @type {any} */ bond, b) => {
        const [first, second, order = 1] = bond,
          a = atoms[first],
          c = atoms[second];
        if (!a || !c || !Array.isArray(a.at) || !Array.isArray(c.at)) return; // (validate says so)
        sums[first] += order;
        sums[second] += order;
        const ra = RADII[a.el]?.[order - 1],
          rc = RADII[c.el]?.[order - 1];
        if (ra == null || rc == null) {
          for (const atom of [a, c]) if (RADII[atom.el]?.[order - 1] == null) unchecked.add(atom.el);
          return;
        }
        const length = Math.hypot(c.at[0] - a.at[0], c.at[1] - a.at[1], c.at[2] - a.at[2]),
          expected = (ra + rc) / 100;
        if (Math.abs(length - expected) > TOLERANCE * expected)
          problems.push({
            path: `${at}.bonds[${b}]`,
            message: `${part.id}: the bond from ${name(first)} to ${name(second)} is ${+length.toFixed(3)} Å, but an ${a.el}–${c.el} ${ORDER[order]} bond is about ${+expected.toFixed(2)} Å (covalent radii): move the atom, or change the bond's order`,
          });
      });
      atoms.forEach((/** @type {any} */ atom, k) => {
        if (!atom) return;
        if (sums[k] === 0) {
          if (!NOBLE.includes(atom.el))
            problems.push({
              path: `${at}.atoms[${k}]`,
              message: `${part.id}: ${name(k)} has no bond, in a molecule whose other atoms are bonded: bond it, or draw it as its own molecule`,
            });
          return;
        }
        const allowed = valencesOf(atom.el, atom.charge || 0);
        if (allowed && !allowed.includes(sums[k]))
          problems.push({
            path: `${at}.atoms[${k}]`,
            message: `${part.id}: ${name(k)} has bonds adding to ${sums[k]}, but ${atom.charge ? `a charged ${atom.el}` : atom.el} makes ${allowed.join(' or ')}: check its bonds and their orders${atom.charge ? '' : ', or give it a charge'}`,
          });
      });
    });
  });
  return { problems, unchecked: [...unchecked].sort() };
}
