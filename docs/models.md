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
texture's main colour. Picking, labels, the cut, taking apart and see-through work as for any part.

Not read: skins and animations, morph targets, sparse accessors, KTX2/Basis textures, and Draco or meshopt
compression (refused with a message, since they would need a decoder).

## Preparing a model

Simplify and quantize it, and write it without compression, with [gltfpack](https://meshoptimizer.org/gltf/):

```sh
gltfpack -i scan.glb -o model.glb -si 0.3 -kn -km -tw     # 30 % of the triangles, named nodes kept, textures as WebP
```

A Draco-compressed file (scans often are) is first decompressed, e.g. with
[glTF-Transform](https://gltf-transform.dev/). lessonkit's `./lk model add` does both.

## Where a model comes from

`source` says how faithful it is: `scan` (a scan of a real specimen), `dataset` (a scientific dataset), `artist` (an
artist's model) or `ai` (made by an AI, which the credit line then calls an illustration, not a real specimen). For
teaching, prefer the first two: BodyParts3D (anatomy, CC BY-SA), the Smithsonian's 3D collection (many CC0; read each
object's terms), NIH 3D. [The fossil skull example](../examples/skull.html) uses the Smithsonian's scan of KNM-ER 3733.
