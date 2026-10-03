# Albert Sans provenance

Family and version come from the font's own `name` table; the hashes below are
of the exact files committed in this directory.

| Field | Value |
|---|---|
| Family (name ID 1) | `Albert Sans` |
| Subfamily (name ID 2) | `Regular` |
| Full name (name ID 4) | `Albert Sans Regular` |
| Version (name ID 5) | `Version 1.025` |
| Unique id (name ID 3) | `1.025;AFOU;AlbertSans-Regular` |
| Embedded copyright (name ID 0) | `Copyright 2021 The Albert Sans Project Authors (https://github.com/usted/Albert-Sans)` |
| License | SIL Open Font License 1.1 (name IDs 13/14; full text in `albert-sans-OFL.txt`) |
| File | `albert-sans-variable.ttf`, 128420 bytes |
| sha256 | `7300b6a75833a138f7398caa9e89f9eca85225edce1f82a336f5f0b87a67dfd4` |
| License file | `albert-sans-OFL.txt`, 4686 bytes |
| License sha256 | `8c39ab0df8c2fd9d7ad6acefde4a58b949e479f15a79eaefc5bdd0794293a187` |

## Where the bytes came from

Upstream project: <https://github.com/usted/Albert-Sans> (the copyright string
embedded in the font names this repository as the project home). The official
Google Fonts metadata at <https://github.com/google/fonts/blob/main/ofl/albertsans/METADATA.pb>
lists the same family, OFL license, and 2021 copyright, and points to the
upstream project.

The committed file is a 128420-byte variable build of the family at version
1.025: its `fvar` table declares a `wght` axis from 100 to 900 with nine named
instances (it is not a static instance). `layout.tsx` loads it through
`next/font/local` and never fetches a font at runtime. On 2026-10-03, the
corresponding official Google Fonts variable file was retrieved from
<https://raw.githubusercontent.com/google/fonts/main/ofl/albertsans/AlbertSans%5Bwght%5D.ttf>
for comparison only. It is 129000 bytes with sha256
`8fe5d4cf5822d7096d4d17ad781c90f97c745ac13a22be619db74966fba45fda`; it does
not match the committed file's 128420 bytes or sha256. The committed file was
left unchanged because it is a different artifact and replacement would
require a separate rendered-metrics review.

The CTO-0008 ticket and the CTO-0015 REV1 dispatch both say the embedded
copyright reads 2023. That claim is wrong: the font's own `name` table ID 0
says 2021, as does the OFL header, and the test reads the year out of the font
bytes rather than trusting either document.

## Status: unverified upstream match

The committed bytes are internally consistent (the embedded copyright, license
ids and version above are read from the file itself), but they have not been
matched to a downloadable official release artifact. The official comparison
file and retrieval are documented above, but do not establish a reproducible
source URL for these exact committed bytes. Ask Josh to decide between keeping
Albert Sans with this documented provenance or switching the display font.

The `albert-sans-OFL.txt` header year must match the font's embedded copyright
year; both say 2021.
