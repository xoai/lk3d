// The figure's stylesheet, added to the page once. A page themes it with CSS variables (set on :root or any ancestor):
//   --lk3d-ink (lines, text, borders) · --lk3d-paper (label and button backgrounds) · --lk3d-muted (hints, credits)
//   --lk3d-accent (focus ring) · --lk3d-warn (the "not to scale" note) · --lk3d-highlight (pressed buttons)
//   --lk3d-font (labels in the drawn look)
function css() {
  if (document.getElementById('lk3d-css')) return;
  const s = document.createElement('style'); s.id = 'lk3d-css';
  s.textContent = `
.lk3d{position:relative; margin:24px 0 6px}
.lk3d-stage{position:relative; width:100%; overflow:hidden; border-radius:6px; touch-action:none; user-select:none; -webkit-user-select:none}
.lk3d-canvas{position:absolute; inset:0; width:100%; height:100%; display:block; cursor:grab; outline:none}
.lk3d-canvas:active{cursor:grabbing}
.lk3d-under{pointer-events:none}
.lk3d-canvas:focus-visible{box-shadow:inset 0 0 0 2px var(--lk3d-accent, #2f5fb3)}
.lk3d-lines{position:absolute; inset:0; width:100%; height:100%; pointer-events:none; overflow:visible}
.lk3d-lines line{stroke:var(--lk3d-ink, #1d1a1e); stroke-width:1.1}
.lk3d-lines circle{fill:var(--lk3d-ink, #1d1a1e)}
.lk3d-tags{position:absolute; inset:0; pointer-events:none}
.lk3d-tag{position:absolute; left:0; top:0; will-change:transform; white-space:nowrap; font-family:var(--lk3d-font, system-ui, sans-serif); font-size:14px; line-height:20px; padding:0 7px;
  background:var(--lk3d-paper, #f7f5ef); color:var(--lk3d-ink, #1d1a1e); border:1.2px solid var(--lk3d-ink, #1d1a1e); border-radius:4px 7px 5px 6px}
.lk3d-tag.on{background:#f3d78f}
.lk3d-stage[data-look="studio"] .lk3d-tag{background:rgba(14,18,24,.82); color:#eef2f7; border-color:rgba(255,255,255,.35); font-family:system-ui, sans-serif; font-size:12.5px; letter-spacing:.02em}
.lk3d-stage[data-look="studio"] .lk3d-tag.on{background:rgba(232,150,60,.9); color:#111}
.lk3d-stage[data-look="studio"] .lk3d-lines line{stroke:rgba(255,255,255,.55)} .lk3d-stage[data-look="studio"] .lk3d-lines circle{fill:#fff}
.lk3d-hint{position:absolute; left:10px; bottom:8px; font-size:13px; color:var(--lk3d-muted, #6b6670); background:rgba(247,245,239,.85); padding:1px 7px; border-radius:4px; pointer-events:none; transition:opacity .4s}
.lk3d-stage[data-look="studio"] .lk3d-hint{color:#c9d1dc; background:rgba(10,12,16,.6)}
.lk3d-hint.gone{opacity:0}
.lk3d-scale{position:absolute; right:10px; bottom:8px; max-width:62%; text-align:right; line-height:1.25; display:flex; flex-direction:column; align-items:flex-end; gap:2px; pointer-events:none; font-size:13px; color:var(--lk3d-ink, #1d1a1e)}
.lk3d-bar-line{display:block; width:100px; height:6px; border:1.5px solid currentColor; border-top:0; transform-origin:right center}
.lk3d-note{background:rgba(247,245,239,.88); padding:1px 7px; border-radius:4px; color:var(--lk3d-warn, #b8352b)}
.lk3d-stage[data-look="studio"] .lk3d-scale{color:#eef2f7} .lk3d-stage[data-look="studio"] .lk3d-note{background:rgba(10,12,16,.7); color:#ffb38a}
.lk3d-sr{position:absolute; width:1px; height:1px; margin:-1px; padding:0; border:0; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap}
.lk3d-stage.lk3d-kbd{box-shadow:0 0 0 2px var(--lk3d-accent, #2f5fb3)}
.lk3d-credit{font-size:13px; color:var(--lk3d-muted, #6b6670); margin:6px 0 0}
.lk3d-bar{display:flex; flex-wrap:wrap; gap:8px 10px; align-items:center; margin-top:10px}
.lk3d-bar .lk3d-btn.on{background:var(--lk3d-highlight, #f3d78f)}
.lk3d-plain{font:inherit; font-size:14px; line-height:1.3; padding:3px 10px; border:1.2px solid var(--lk3d-ink, #1d1a1e); border-radius:5px; background:var(--lk3d-paper, #f7f5ef); color:var(--lk3d-ink, #1d1a1e); cursor:pointer}
.lk3d-plain:hover{filter:brightness(.96)} .lk3d-plain:focus-visible{outline:2px solid var(--lk3d-accent, #2f5fb3); outline-offset:1px}
.lk3d-range{display:flex; gap:8px; align-items:center; font-size:15.5px}
.lk3d-range input{width:120px; accent-color:var(--lk3d-ink, #1d1a1e)}
.lk3d-views{display:inline-flex; gap:6px; flex-wrap:wrap}
@media (max-width:520px){.lk3d-tag{font-size:12px; line-height:17px; padding:0 5px} .lk3d-scale{font-size:11.5px; top:6px; bottom:auto; right:6px}}`;
  document.head.append(s);
}
export { css };
