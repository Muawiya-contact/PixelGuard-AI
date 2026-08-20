# Sample gallery images

Three categories, three slots each. Drop files in and the gallery picks them up
on next load — no code change needed.

```
images/
├── ai-generated/   sample1  sample2  sample3
├── camera-exif/    sample1  sample2  sample3
└── composite/      sample1  sample2  sample3
```

Accepted extensions, probed in order: `.png`, `.jpg`, `.jpeg`, `.webp`.
So `sample2.jpg` and `sample2.png` both work, and slots are independent —
`sample3` alone is fine.

A slot with no file is skipped rather than rendered as a broken thumbnail.
An empty category still shows its heading with a prompt.

Titles and descriptions live in `frontend/src/constants/samples.js`; edit the
matching slot there when you add an image so the card describes it accurately.

The three bundled `sample1` files are procedurally generated fixtures with a
crafted metadata or compression history — they exist to make a specific
detector fire against known ground truth. They are not photographs, and the UI
says so. Category names describe what a sample is meant to exercise; PixelGuard
still reports whatever it actually finds, and it can disagree with the folder
name.
