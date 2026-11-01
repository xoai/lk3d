# Security

lk3d runs in the reader's browser and draws scenes it is given. The parts that read untrusted input are the scene
itself (part notes may hold simple HTML: give lk3d only scenes you trust, or escape notes yourself) and glTF models
(read with bounds checks; images decoded by the browser).

To report a vulnerability, please use the repository's private security advisories ("Report a vulnerability" on its
GitHub Security tab) rather than a public issue. You will get an answer within a week.
