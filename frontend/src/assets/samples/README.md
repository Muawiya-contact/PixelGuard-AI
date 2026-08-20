# Sample gallery images

Three categories. **Every image file in a category folder appears in the
gallery automatically** — enumerated at build time via `import.meta.glob`, so
there is no list to keep in sync.

```
src/assets/samples/
├── ai-generated/
├── camera-exif/
└── composite/
```

Accepted extensions: `.png`, `.jpg`, `.jpeg`, `.webp` (any case). Filenames with
spaces are fine. Drop a file in and it shows on next reload; delete one and its
card disappears.

Optional titles/descriptions live in `frontend/src/constants/samples.js`
(`DESCRIPTIONS`, keyed by filename). A file with no entry captions itself from
its filename. When you add an image, write copy that says what the file
*actually* contains — run it through the analyzer first rather than assuming
from the folder name.

Category names describe what a group is meant to exercise; PixelGuard still
reports whatever it finds, and it is allowed to disagree with the folder an
image came from. Note the camera-exif folder currently holds photographs whose
EXIF was stripped in transit — the copy says so. An image with intact capture
EXIF (straight off a camera or phone, not re-saved) is the missing piece if you
want the exif_visual_media_conflict finding on display.

Keep files a few hundred KB where possible: everything here ships in the build.
