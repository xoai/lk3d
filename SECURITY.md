# Security

lk3d runs in the reader's browser and draws scenes it is given. The parts that read untrusted input:

- **Words in the scene.** A part's name and note, and the `infoIdle` text, go through `safeHTML`: everything is escaped
  except bare `b i em strong sub sup br` tags, so they cannot run script.
- **A model's `url`.** It becomes the link of the model's credit under the figure, as given: lk3d does not check its
  scheme. In a scene you did not write, check that every `models.*.url` starts with `https://` or `http://` before
  you mount it.
- **The scene's form.** The engine expects a scene in the right form and does not validate it itself. Run
  `validate(scene)` (`lk3d/validate`) on a scene you did not write, and mount it only if there are no problems.
- **glTF models** are read with bounds checks; their images are decoded by the browser.

To report a vulnerability, please use the private security advisories of
[github.com/xoai/lk3d](https://github.com/xoai/lk3d) ("Report a vulnerability" on its Security tab) rather than a public
issue. You will get an answer within a week.
