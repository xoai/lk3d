# Models made elsewhere (glTF)

For forms that generated shapes cannot draw faithfully (a heart, a skull, a scanned fossil), a scene can bring glTF 2.0
binary models (`.glb`), given as base64 so they are read at once, with no network and no decoder to wait for:

```js
scene.models = {
  skull: {
    data: base64OfTheGlb,
    title: 'Homo erectus: cranium (KNM-ER 3733)',
    author: 'Smithsonian Institution',
    license: 'CC0',
    source: 'scan',
    url: 'https://3d.si.edu/…',
  },
};
scene.parts = [{ id: 'skull', name: 'Skull', shapes: [{ model: 'skull' }] }]; // or { model, node: 'Jaw' }: one node
```

Each model is credited under the figure: its title (linked to `url`), author and licence.

## What is read

Triangle meshes; node transforms (TRS or matrix); positions and normals in any component type (quantized, normalized or
float: KHR_mesh_quantization); indices; vertex colours; materials' base colours; and the textures of one material per
model shape: texture coordinates (KHR_texture_transform applied), base colour, normal and metallic-roughness maps, as
embedded WebP, PNG or JPEG. Textures are decoded off the main thread (half size on phones) and drawn by the studio look
on WebGL 2 once ready; until then, and in the drawn look and the fallbacks, the part's `color` shows, so give it the
texture's main colour. Picking, labels, the cut, taking apart and see-through work as for any part. Pointed at or
chosen, a textured part lights at its rim and only faintly over its face, so its own colours still read.

- **Cut-outs** (feathers, leaves, hair or fins as cards): `alphaMode: MASK` drops the texels below `alphaCutoff`, in
  every look on WebGL 2 and in the shadow too; `BLEND` is drawn the same way at half (true blending would mean sorting
  every card). A `doubleSided` material shows from behind as well. In the Canvas 2D fallback, and until the map has
  loaded, a card shows whole.
- **Glass** (`KHR_materials_transmission`, a glass eye, a lens): its base colour map is left out (in a scan it is
  usually a white film) and it is painted its tint (`KHR_materials_volume`'s attenuation colour, else its base colour).
  A part made only of a model's glass is see-through glass (`opacity` 0.35, `material: glass`) unless it says
  otherwise; take the glass node apart for that: `{model: eye, node: Glass}`.
- **A colour of your own**: a model shape's `color` replaces its base colour map (its normal and metal-roughness maps
  are kept), for a map that misleads.

Not read: skins and animations, morph targets, sparse accessors, KTX2/Basis textures, and Draco or meshopt
compression (refused with a message, since they would need a decoder); a material's other extensions (sheen,
clearcoat, iridescence, emission maps) are left out.

## Preparing a model

Simplify and quantize it, and write it without compression, with [gltfpack](https://meshoptimizer.org/gltf/):

```sh
gltfpack -i scan.glb -o model.glb -si 0.3 -kn -km -tw     # 30 % of the triangles, named nodes kept, textures as WebP
```

A Draco-compressed file (scans often are) is first decompressed, e.g. with
[glTF-Transform](https://gltf-transform.dev/). A rigged model (an artist's animal or body usually is) is first posed:
each skinned vertex moved by its joints and the skin dropped, since lk3d draws a skinned mesh in its bind pose, often at
the wrong size or turned away. lessonkit's `./lk model add` does all three.

## Where a model comes from

`source` says how faithful it is: `scan` (a scan of a real specimen), `dataset` (a scientific dataset), `artist` (an
artist's model) or `ai` (made by an AI, which the credit line then calls an illustration, not a real specimen). For
teaching, prefer the first two: BodyParts3D (anatomy, CC BY-SA), the Smithsonian's 3D collection (many CC0; read each
object's terms), NIH 3D. [The fossil skull example](../examples/skull.html) uses the Smithsonian's scan of KNM-ER 3733.
