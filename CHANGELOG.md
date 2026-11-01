# Changelog

lk3d follows [semantic versioning](https://semver.org): before 1.0, a minor version (0.x.0) may change the scene
format or the API, and says how to move.

## 0.1.0 (unreleased)

The first release as its own package, after it grew as the 3D engine of lessonkit.

- **Scenes as data**: parts made of shapes, each with a name and a note; a JSON Schema
  (`schema/scene.schema.json`) and a validator (`lk3d/validate`) that says what is wrong where; TypeScript types.
- **Exploring**: turn, zoom and pan by mouse, touch, pen and keyboard; preset views; taking apart; cutting open with
  filled, hatched cut faces; see-through casings; labels with leader lines; a note for each part.
- **Moving parts by hand**: handles that turn, slide or follow a path, each also a range input for the keyboard and
  screen readers; lines for rays and field lines; particles along paths; solid balls for simulations.
- **Shapes**: 21 kinds, for machines (lathe, cylinder, box, sphere, torus, tube, helix, loop, blade) and for the
  sciences (ellipsoid, capsule, blob, shell, tree, molecule, dna, extrude, terrain, ring, orbit, scatter); glTF 2.0
  models, textured ones included (base colour, normal and metallic-roughness maps).
- **Looks**: a drawn look and a physically based studio look with generated environments (studio, warm, night),
  surface detail and glass that bends light; WebGL 2, WebGL 1 and a Canvas 2D fallback.
- **Accessible and international**: text descriptions, keyboard control, read-out handles, reduced motion; English and
  Vietnamese words; themes through CSS variables.
- **Small and fast**: 38 KB gzipped; draws only on change, pauses off screen, adapts its resolution.
