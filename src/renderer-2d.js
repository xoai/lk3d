// The fallback where there is no WebGL: Canvas 2D, flat shading in the same bands, triangles sorted far to near.
// Same interface as the WebGL renderer; it draws the coarser geometry the scene was built with for it.
import { M, sub, cross, dot, norm } from './math.js';
import { rampAt, STREAK_POINTS, STRIDE } from './flow.js';

function canvasRenderer(canvas, scene) {
  const context = canvas.getContext('2d');
  // balls, without depth: in the three colour bands of the WebGL renderer, one fill each
  function balls(particleSet, frame, viewProjection, width, height) {
    /** @type {number[][]} */
    const bands = [[], [], []];
    for (let i = 0; i < particleSet.count; i++) {
      const position = [
          particleSet.positionsAndColors[4 * i],
          particleSet.positionsAndColors[4 * i + 1],
          particleSet.positionsAndColors[4 * i + 2],
        ],
        screen = M.project(viewProjection, position, width, height);
      if (!screen) continue;
      const distance = Math.hypot(position[0] - frame.eye[0], position[1] - frame.eye[1], position[2] - frame.eye[2]);
      const tone = particleSet.positionsAndColors[4 * i + 3];
      bands[tone < 0.35 ? 0 : tone < 0.65 ? 1 : 2].push(
        screen[0],
        screen[1],
        Math.max(1, (particleSet.radius * frame.pxPerUnit) / distance),
      );
    }
    bands.forEach((band, bandIndex) => {
      const color = particleSet.ramp[bandIndex];
      context.fillStyle = css(color);
      context.beginPath();
      for (let j = 0; j < band.length; j += 3) {
        context.moveTo(band[j] + band[j + 2], band[j + 1]);
        context.arc(band[j], band[j + 1], band[j + 2], 0, 6.3);
      }
      context.fill();
    });
  }
  // flow streaks: each one stroke from head to tail, in the ramp's colour at its head
  const css = (color) => `rgb(${color.map((channel) => Math.round(channel * 255)).join(',')})`;
  function streaks(flow, frame, viewProjection, width, height) {
    const vertices = flow.vertices;
    context.lineWidth = Math.max(1.25, flow.width) * frame.dpr;
    context.lineCap = 'round';
    context.globalCompositeOperation = frame.look.dark ? 'lighter' : 'source-over';
    for (let i = 0; i < flow.drawnCount; i++) {
      const offset = i * STREAK_POINTS * 2 * STRIDE;
      context.globalAlpha = flow.opacity * vertices[offset + 8] * 0.6;
      context.strokeStyle = css(rampAt(flow.colors, vertices[offset + 7]));
      context.beginPath();
      for (let k = 0; k < STREAK_POINTS; k++) {
        const screen = M.project(
          viewProjection,
          [
            vertices[offset + 2 * k * STRIDE],
            vertices[offset + 2 * k * STRIDE + 1],
            vertices[offset + 2 * k * STRIDE + 2],
          ],
          width,
          height,
        );
        if (screen) context.lineTo(screen[0], screen[1]);
      }
      context.stroke();
    }
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
  }
  return {
    kind: '2d',
    hifi: false,
    shadows: false,
    setAO() {},
    draw(frame) {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (frame.look.fill) {
        context.fillStyle = css(frame.look.fill);
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      const triangles = [],
        kind = frame.look.kind,
        light = frame.look.light,
        viewProjection = frame.viewProjection,
        width = canvas.width,
        height = canvas.height;
      for (const part of frame.parts) {
        if (part.drawAlpha < 0.05) continue;
        // pen: the part's colour mixed into the near-white solid (all of it for an accent part)
        const baseColor =
            kind === 1
              ? part.studioColor
              : kind === 2
                ? frame.look.solid.map((channel, i) => channel + (part.color[i] - channel) * part.tint)
                : part.color,
          highlighted = part.id === frame.hover || part.id === frame.selected;
        for (const batch of part.batches)
          for (const placement of batch.placements) {
            const matrix = M.mul(part.matrix, placement),
              positions = batch.mesh.positions,
              indices = batch.mesh.indices,
              vertexCount = batch.mesh.count,
              screenPoints = new Float32Array(vertexCount * 3),
              worldPoints = new Float32Array(vertexCount * 3);
            for (let k = 0; k < vertexCount; k++) {
              const world = M.pt(matrix, [positions[3 * k], positions[3 * k + 1], positions[3 * k + 2]]);
              worldPoints[3 * k] = world[0];
              worldPoints[3 * k + 1] = world[1];
              worldPoints[3 * k + 2] = world[2];
              const screen = M.project(viewProjection, world, width, height) || [0, 0, -1];
              screenPoints[3 * k] = screen[0];
              screenPoints[3 * k + 1] = screen[1];
              screenPoints[3 * k + 2] = screen[2];
            }
            for (let first = 0; first < indices.length; first += 3) {
              const a = indices[first],
                b = indices[first + 1],
                c = indices[first + 2];
              if (screenPoints[3 * a + 2] <= 0 || screenPoints[3 * b + 2] <= 0 || screenPoints[3 * c + 2] <= 0)
                continue;
              const away =
                (screenPoints[3 * b] - screenPoints[3 * a]) * (screenPoints[3 * c + 1] - screenPoints[3 * a + 1]) -
                  (screenPoints[3 * b + 1] - screenPoints[3 * a + 1]) * (screenPoints[3 * c] - screenPoints[3 * a]) >=
                0;
              if (away && !batch.mesh.twoSided) continue; // facing away (a two-sided surface shows its other face)
              const cornerA = [worldPoints[3 * a], worldPoints[3 * a + 1], worldPoints[3 * a + 2]];
              const normal = norm(
                  cross(
                    sub([worldPoints[3 * b], worldPoints[3 * b + 1], worldPoints[3 * b + 2]], cornerA),
                    sub([worldPoints[3 * c], worldPoints[3 * c + 1], worldPoints[3 * c + 2]], cornerA),
                  ),
                ),
                facing = away ? -dot(normal, light) : dot(normal, light);
              // the shaders' light: ink's three bands; pen's smooth ramp, deeper than on the GPU (here no outline
              // or edge shows the shape); studio's smooth light
              const level = Math.max(0, Math.min(1, (facing + 0.3) / 1)),
                brightness =
                  kind === 1
                    ? 0.35 + 0.65 * Math.max(0, facing)
                    : kind
                      ? 0.7 + 0.3 * level * level * (3 - 2 * level)
                      : facing > 0.55
                        ? 1
                        : facing > 0.05
                          ? 0.82
                          : 0.64;
              const vertexColors = batch.mesh.colors,
                // vertex colours, averaged (in pen, at most half of theirs unless the part is coloured in full)
                vertexAlpha = vertexColors
                  ? ((vertexColors[4 * a + 3] + vertexColors[4 * b + 3] + vertexColors[4 * c + 3]) / 765) *
                    (kind === 2 ? Math.max(part.tint, 0.7) : 1)
                  : 0;
              const ownColor = vertexAlpha
                ? baseColor.map(
                    (channel, i) =>
                      channel * (1 - vertexAlpha) +
                      ((vertexColors[4 * a + i] + vertexColors[4 * b + i] + vertexColors[4 * c + i]) / 765) *
                        vertexAlpha,
                  )
                : baseColor;
              const rgb = ownColor.map((channel, i) =>
                Math.round(Math.min(1, channel * brightness + part.emission[i] * 0.3 + (highlighted ? 0.12 : 0)) * 255),
              );
              triangles.push([
                screenPoints[3 * a],
                screenPoints[3 * a + 1],
                screenPoints[3 * b],
                screenPoints[3 * b + 1],
                screenPoints[3 * c],
                screenPoints[3 * c + 1],
                (screenPoints[3 * a + 2] + screenPoints[3 * b + 2] + screenPoints[3 * c + 2]) / 3,
                `rgb(${rgb.join(',')})`,
                part.drawAlpha,
              ]);
            }
          }
      }
      triangles.sort((a, b) => b[6] - a[6]);
      context.lineJoin = 'round';
      for (const triangle of triangles) {
        context.globalAlpha = triangle[8];
        context.beginPath();
        context.moveTo(triangle[0], triangle[1]);
        context.lineTo(triangle[2], triangle[3]);
        context.lineTo(triangle[4], triangle[5]);
        context.closePath();
        context.fillStyle = triangle[7];
        context.fill();
        context.strokeStyle = triangle[7];
        context.lineWidth = 0.6;
        context.stroke();
      }
      context.globalAlpha = 1;
      for (const particleSet of frame.particles) {
        if (!particleSet.visible) continue;
        particleSet.update();
        if (particleSet.solid) {
          balls(particleSet, frame, viewProjection, width, height);
          continue;
        }
        context.fillStyle = css(particleSet.color);
        for (let i = 0; i < particleSet.count; i++) {
          const screen = M.project(
            viewProjection,
            [
              particleSet.positionsAndColors[4 * i],
              particleSet.positionsAndColors[4 * i + 1],
              particleSet.positionsAndColors[4 * i + 2],
            ],
            width,
            height,
          );
          if (screen) {
            context.beginPath();
            context.arc(screen[0], screen[1], 2.5 * frame.dpr, 0, 6.3);
            context.fill();
          }
        }
      }
      for (const flow of frame.flows || []) streaks(flow, frame, viewProjection, width, height);
    },
    dispose() {},
  };
}

export { canvasRenderer };
